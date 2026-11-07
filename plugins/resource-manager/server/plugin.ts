import type { CloseAgentResult, LocalReading, ServerList, ServerReading } from "../shared/rpc.js";
import { LocalReader } from "./local/local-reader.js";
import {
  closeIdleAgent,
  listLiveAgents,
  listWorkspaceDirectories,
  type PaseoPorts,
} from "./paseo-ports.js";
import {
  claudeConfigFile,
  heavyGateBinDir,
  resourceManagerRunDir,
  sharedMcpRunDir,
} from "./paths.js";
import { discoverSshServers, type Discovery } from "./remote/discovery.js";
import { serverEnv, startMcpStdioClient } from "./remote/mcp-stdio-client.js";
import { RemoteSessions, type StartClient, type TimerPort } from "./remote/sessions.js";

// Start: the first npx run downloads ssh-mcp. Request: ssh-mcp's own command timeout is 60 s.
export const MCP_TIMING = { startTimeoutMs: 120_000, requestTimeoutMs: 70_000 } as const;
export const DISCOVERY_TTL_MS = 60_000;
export const UNKNOWN_SERVER_MESSAGE = "No ssh-mcp server with this id is configured any more";

export interface ResourceManagerOptions {
  env: NodeJS.ProcessEnv;
  home: string;
  procRoot: string;
  cgroupRoot: string;
  daemonPid: number;
  cores: number;
  now(): number;
  sleep(ms: number): Promise<void>;
  timers: TimerPort;
  log(message: string): void;
  /** Starts an ssh-mcp client. Tests pass a fake; the default spawns the configured command. */
  startClient?: StartClient;
}

export interface ResourceManager {
  local(ports: PaseoPorts): Promise<LocalReading>;
  servers(ports: PaseoPorts): Promise<ServerList>;
  server(ports: PaseoPorts, id: string): Promise<ServerReading>;
  closeAgent(ports: PaseoPorts, agentId: string): Promise<CloseAgentResult>;
  stop(): Promise<void>;
}

interface CachedDiscovery {
  at: number;
  discovery: Promise<Discovery>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createResourceManager(options: ResourceManagerOptions): ResourceManager {
  const { env, home } = options;
  const runDir = resourceManagerRunDir(env, home);
  const reader = new LocalReader({
    procRoot: options.procRoot,
    cgroupRoot: options.cgroupRoot,
    sharedMcpRunDir: sharedMcpRunDir(env, home),
    heavyGateBinDir: heavyGateBinDir(env, home),
    daemonPid: options.daemonPid,
    cores: options.cores,
    now: options.now,
    sleep: options.sleep,
  });
  const startClient: StartClient =
    options.startClient ??
    ((server, signal) =>
      startMcpStdioClient(
        { command: server.command, args: server.args, env: server.env },
        {
          runDir,
          name: server.id,
          procRoot: options.procRoot,
          baseEnv: env,
          startTimeoutMs: MCP_TIMING.startTimeoutMs,
          requestTimeoutMs: MCP_TIMING.requestTimeoutMs,
        },
        signal,
      ));
  // The only work at start: reclaiming ssh-mcp groups a dead daemon left (decision 16).
  const sessions = new RemoteSessions({
    runDir,
    procRoot: options.procRoot,
    startClient,
    timers: options.timers,
    log: options.log,
  });
  const loggedProblems = new Set<string>();
  let cached: CachedDiscovery | null = null;

  async function findServers(ports: PaseoPorts): Promise<Discovery> {
    const problems: string[] = [];
    let directories: string[] = [];
    try {
      directories = await listWorkspaceDirectories(ports.workspaces);
    } catch (error) {
      problems.push(`Unable to list workspaces: ${errorMessage(error)}`);
    }
    const found = await discoverSshServers({
      claudeConfigFile: claudeConfigFile(env, home),
      workspaceDirectories: directories,
      // The env ssh-mcp gets: a variable Paseo strips at spawn reads as unset here too.
      env: serverEnv({}, env),
    });
    const all = [...problems, ...found.problems];
    for (const problem of all) {
      if (loggedProblems.has(problem)) continue;
      loggedProblems.add(problem);
      options.log(`resource-manager: ${problem}`);
    }
    return { servers: found.servers, problems: all };
  }

  function discover(ports: PaseoPorts): Promise<Discovery> {
    if (cached !== null && options.now() - cached.at < DISCOVERY_TTL_MS) return cached.discovery;
    const entry: CachedDiscovery = { at: options.now(), discovery: findServers(ports) };
    cached = entry;
    // A failed discovery is not kept: the next call tries again.
    entry.discovery.catch(() => {
      if (cached === entry) cached = null;
    });
    return entry.discovery;
  }

  return {
    local: (ports) => reader.read(() => listLiveAgents(ports.agents)),
    async servers(ports) {
      const { servers, problems } = await discover(ports);
      return {
        servers: servers.map((server) => ({
          id: server.id,
          name: server.name,
          source: server.source,
        })),
        problems,
      };
    },
    async server(ports, id) {
      const { servers } = await discover(ports);
      const server = servers.find((candidate) => candidate.id === id);
      if (server === undefined)
        return { id, snapshot: null, readAt: null, error: UNKNOWN_SERVER_MESSAGE };
      return sessions.read(server);
    },
    closeAgent: (ports, agentId) => closeIdleAgent(ports.agents, agentId),
    stop: () => sessions.closeAll(),
  };
}
