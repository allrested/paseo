import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFakeProc, type FakePidSpace } from "./local/fake-proc.js";
import { FakeAgents, FakeWorkspaces } from "./fake-ports.js";
import type { PaseoPorts } from "./paseo-ports.js";
import { createResourceManager, UNKNOWN_SERVER_MESSAGE, type ResourceManager } from "./plugin.js";
import { FakeStarter, FakeTimers } from "./remote/fakes.js";
import { serverId } from "./remote/discovery.js";
import { REMOTE_SNAPSHOT_SAMPLE } from "./remote/remote-output-sample.js";
import { SHUTDOWN_MESSAGE } from "./remote/sessions.js";

const SPACE: FakePidSpace = { pidNamespace: "pid:[4026531836]", bootId: "boot-1" };

let root: string;
let home: string;
let project: string;
let agents: FakeAgents;
let workspaces: FakeWorkspaces;
let ports: PaseoPorts;
let starter: FakeStarter;
let timers: FakeTimers;
let logs: string[];
let manager: ResourceManager;

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value)}\n`);
}

function writeUserConfig(host: string): void {
  writeJson(join(home, ".claude.json"), {
    mcpServers: {
      "prod-box": {
        command: "npx",
        args: ["ssh-mcp", "-y", "--", `--host=${host}`, "--password=hunter2"],
      },
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
    },
    projects: { [project]: { hasTrustDialogAccepted: true } },
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-plugin-"));
  home = join(root, "home");
  project = join(root, "project");
  mkdirSync(home);
  mkdirSync(project);
  writeFakeProc(
    join(root, "proc"),
    [
      { pid: 1, ppid: 0, startTime: 10 },
      { pid: 164, ppid: 1, startTime: 200, rssKb: 286020 },
      { pid: 300, ppid: 164, startTime: 3000, rssKb: 307200, env: { PASEO_AGENT_ID: "agent-a" } },
    ],
    SPACE,
  );
  writeUserConfig("10.0.0.1");
  writeJson(join(project, ".mcp.json"), {
    mcpServers: { "db-box": { command: "/opt/ssh-mcp/bin/ssh-mcp", args: ["--host=db"] } },
  });
  agents = new FakeAgents([
    {
      id: "agent-a",
      title: "Fix login",
      provider: "claude",
      status: "idle",
      updatedAt: "2026-11-06T08:50:00.000Z",
      persistence: { sessionId: "session-a" },
    },
  ]);
  workspaces = new FakeWorkspaces([{ projectRootPath: project }]);
  ports = { agents, workspaces };
  starter = new FakeStarter();
  timers = new FakeTimers();
  logs = [];
  manager = createResourceManager({
    env: { PASEO_HOME: join(root, "paseo-home") },
    home,
    procRoot: join(root, "proc"),
    cgroupRoot: join(root, "no-cgroup"),
    daemonPid: 164,
    cores: 2,
    now: () => timers.now(),
    sleep: () => Promise.resolve(),
    timers,
    log: (message) => logs.push(message),
    startClient: starter.start,
  });
});

afterEach(async () => {
  await manager.stop();
  rmSync(root, { recursive: true, force: true });
});

describe("createResourceManager", () => {
  it("reads this instance with the live agents from the SDK", async () => {
    const reading = await manager.local(ports);

    expect(reading.agents.map((agent) => [agent.agentId, agent.rssBytes])).toEqual([
      ["agent-a", 307200 * 1024],
    ]);
    expect(reading.groups.find((group) => group.kind === "daemon")?.rssBytes).toBe(286020 * 1024);
    expect(agents.requests[0].includeBackground).toBe(true);
  });

  it("lists ssh-mcp servers by id, name and source only, and caches the list for 60 s", async () => {
    const list = await manager.servers(ports);

    expect(list).toEqual({
      servers: [
        { id: serverId("user", "prod-box"), name: "prod-box", source: "User config" },
        {
          id: serverId(`project:${join(project, ".mcp.json")}`, "db-box"),
          name: "db-box",
          source: join(project, ".mcp.json"),
        },
      ],
      problems: [],
    });
    expect(JSON.stringify(list)).not.toContain("hunter2");

    rmSync(join(project, ".mcp.json"));
    timers.advance(59_000);
    await expect(manager.servers(ports)).resolves.toEqual(list);
    timers.advance(1_000);
    await expect(manager.servers(ports)).resolves.toMatchObject({
      servers: [{ name: "prod-box" }],
    });
    expect(workspaces.requests).toHaveLength(2);
  });

  it("reads a configured server and refuses an unknown id", async () => {
    await expect(manager.server(ports, serverId("user", "prod-box"))).resolves.toEqual({
      id: serverId("user", "prod-box"),
      snapshot: REMOTE_SNAPSHOT_SAMPLE,
      readAt: "2026-11-06T09:00:00.000Z",
      error: null,
    });
    expect(starter.started[0].server.args).toContain("--host=10.0.0.1");

    await expect(manager.server(ports, "ffffffffffffffff")).resolves.toEqual({
      id: "ffffffffffffffff",
      snapshot: null,
      readAt: null,
      error: UNKNOWN_SERVER_MESSAGE,
    });
    expect(starter.started).toHaveLength(1);
  });

  it("restarts a server's session when its config changes", async () => {
    const id = serverId("user", "prod-box");
    await manager.server(ports, id);

    writeUserConfig("10.0.0.2");
    timers.advance(60_000);
    await manager.server(ports, id);

    expect(starter.clients[0].closed).toBe(true);
    expect(starter.started[1].server.args).toContain("--host=10.0.0.2");
  });

  it("shows user-scope servers when the workspace list fails, and logs that problem once", async () => {
    workspaces.listError = new Error("daemon unavailable");

    const first = await manager.servers(ports);
    timers.advance(60_000);
    const second = await manager.servers(ports);

    expect(first.servers.map((entry) => entry.name)).toEqual(["prod-box"]);
    expect(second.problems).toEqual(["Unable to list workspaces: daemon unavailable"]);
    expect(logs).toEqual(["resource-manager: Unable to list workspaces: daemon unavailable"]);
  });

  it("expands config variables against the env ssh-mcp gets, never Paseo's own", async () => {
    writeJson(join(home, ".claude.json"), {
      mcpServers: {
        "prod-box": {
          command: "npx",
          args: ["ssh-mcp", "--", "--host=${PROD_HOST}", "--password=${PASEO_PASSWORD:-none}"],
        },
      },
    });
    const withSecret = createResourceManager({
      env: {
        PASEO_HOME: join(root, "paseo-home"),
        PASEO_PASSWORD: "daemon-secret",
        PROD_HOST: "10.0.0.9",
      },
      home,
      procRoot: join(root, "proc"),
      cgroupRoot: join(root, "no-cgroup"),
      daemonPid: 164,
      cores: 2,
      now: () => timers.now(),
      sleep: () => Promise.resolve(),
      timers,
      log: (message) => logs.push(message),
      startClient: starter.start,
    });

    await withSecret.server(ports, serverId("user", "prod-box"));
    await withSecret.stop();

    expect(starter.started[0].server.args).toEqual([
      "ssh-mcp",
      "--",
      "--host=10.0.0.9",
      "--password=none",
    ]);
    expect(starter.started[0].server.missingVariables).toEqual([]);
  });

  it("closes an idle agent's runtime through the SDK", async () => {
    await expect(manager.closeAgent(ports, "agent-a")).resolves.toEqual({ ok: true, error: null });
    expect(agents.closed).toEqual(["agent-a"]);
  });

  it("stop() closes every session, and later reads get the shutdown message", async () => {
    const id = serverId("user", "prod-box");
    await manager.server(ports, id);

    await manager.stop();

    expect(starter.clients[0].closeCount).toBe(1);
    await expect(manager.server(ports, id)).resolves.toMatchObject({ error: SHUTDOWN_MESSAGE });
  });
});
