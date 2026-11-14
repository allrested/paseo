import { randomUUID, createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { readFile, realpath, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath, sep } from "node:path";
import type {
  AgentToolResult,
  PluginHandlerContext,
  PluginHookAgent,
  PluginSessionOpenRequest,
} from "@getpaseo/plugin/server";
import type { DesignConfig } from "./config.js";
import type { FileRow, PublicFile, ViewEvent } from "../shared/contracts.js";
import { BRIDGE_AUTHOR, Bridge, type TokensPort } from "./bridge.js";
import { createBridges, type Bridges } from "./bridges.js";
import { createCommentRouter, type CommentRouter } from "./comments.js";
import { FigcraftSession } from "./figcraft-session.js";
import { createFilesStore, publicFile, type DesignFile, type FilesStore } from "./files-store.js";
import { designPaths, type DesignPaths } from "./paths.js";
import { sendSelection } from "./send-to-agent.js";
import type { TokenFile } from "./tokens.js";
import { designTools } from "./agent-tools.js";

// The packaged app resolves only the plugin SDK, so the API type comes from it, not @getpaseo/client.
type PaseoApi = PluginHandlerContext["paseo"];

const IDLE_MS = 5 * 60_000;
// FigCraft puts server addresses and links in some error texts; a key or token never leaves here.
const SECRET_PARAM = /\b(key|token)=[^&\s"']+/g;

function redact(text: string): string {
  return text.replace(SECRET_PARAM, "$1=<redacted>");
}

function messageOf(error: unknown): string {
  return redact(error instanceof Error ? error.message : String(error));
}

/** The name other members see for the agent; the guard adds " (agent)". */
function agentLabel(request: { title: string | null; provider: string }): string {
  const title = request.title?.trim();
  if (title) return title.slice(0, 40);
  return request.provider.charAt(0).toUpperCase() + request.provider.slice(1);
}

export interface DesignDeps {
  config: DesignConfig | { disabled: string };
  env: NodeJS.ProcessEnv;
  home: string;
  /** bin/figcraft-guard.mjs in the plugin's own directory (the daemon gives built-ins theirs). */
  guardPath: string;
  /** server/paseo-tokens.json in the plugin's directory: the tokens for a repo without its own. */
  defaultTokensPath?: string;
  /** How to start figcraft-cli: the CLI itself, or node + the fake in tests. */
  cliCommand?: { command: string; argsBefore: string[] };
  paseo(): PaseoApi;
  log(line: string): void;
  clock?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
  /** How often an open view re-reads threads and the picture. */
  viewPollMs?: number;
}

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

export interface DesignService {
  files(
    workspaceId: string,
  ): Promise<{ enabled: true; files: FileRow[] } | { enabled: false; reason: string }>;
  create(workspaceId: string, name: string): Promise<Result<{ file: PublicFile }>>;
  rename(fileId: string, name: string): Promise<Result<{ file: PublicFile }>>;
  remove(fileId: string): Promise<Result>;
  editorLink(fileId: string, workspaceId: string): Promise<Result<{ url: string }>>;
  comment(fileId: string, x: number, y: number, text: string): Promise<Result>;
  send(fileId: string, agentId: string, note: string): Promise<Result>;
  agents(workspaceId: string): Promise<{ agents: { id: string; title: string }[] }>;
  view(
    input: { fileId: string; workspaceId: string; pictures: boolean },
    push: (event: ViewEvent) => Promise<void>,
    signal: AbortSignal,
  ): Promise<void>;
  join(agent: PluginHookAgent, input: { file?: string; name?: string }): Promise<AgentToolResult>;
  compare(
    agent: PluginHookAgent,
    input: { file: string; frame: string; image: string },
  ): Promise<AgentToolResult>;
  openSession(request: PluginSessionOpenRequest): Promise<PluginSessionOpenRequest | null>;
  turnEnded(agentId: string): Promise<void>;
  agentGone(agentId: string): void;
  /** Every 10 s: comments to agents, token edits back to the repo. */
  tick(): Promise<void>;
  /** Tests only. */
  debugImportVariables(fileId: string, json: unknown): Promise<void>;
  stop(): Promise<void>;
}

const IMAGE = /\.(png|jpe?g|webp)$/i;

/** The image's real path, which must be inside the workspace folder. */
async function workspaceImage(directory: string, image: string): Promise<string> {
  if (!IMAGE.test(image)) throw new Error("image must be a .png, .jpg or .webp file");
  const root = await realpath(directory);
  let path: string;
  try {
    path = await realpath(resolvePath(root, image));
  } catch {
    throw new Error(`No file ${image} in this workspace`);
  }
  if (path !== root && !path.startsWith(`${root}${sep}`)) {
    throw new Error("image must be inside this workspace");
  }
  return path;
}

function disabledService(reason: string): DesignService {
  const off = { ok: false as const, error: reason };
  return {
    files: async () => ({ enabled: false, reason }),
    create: async () => off,
    rename: async () => off,
    remove: async () => off,
    editorLink: async () => off,
    comment: async () => off,
    send: async () => off,
    agents: async () => ({ agents: [] }),
    view: async (_input, push) => {
      await push({ type: "status", status: "failed", error: reason });
    },
    join: async () => ({ isError: true, text: `Design mode is off: ${reason}` }),
    compare: async () => ({ isError: true, text: `Design mode is off: ${reason}` }),
    openSession: async () => null,
    turnEnded: async () => {},
    agentGone: () => {},
    tick: async () => {},
    debugImportVariables: async () => {},
    stop: async () => {},
  };
}

/** The page's picture when it changed since the last one; null for no change or a failed render. */
async function pictureEvent(
  bridge: Bridge,
  last: { hash: string; seq: number },
): Promise<ViewEvent | null> {
  let picture: Awaited<ReturnType<Bridge["picture"]>>;
  try {
    picture = await bridge.picture();
  } catch {
    return null;
  }
  const hash = createHash("sha1")
    .update(picture?.data ?? "")
    .digest("hex");
  if (hash === last.hash) return null;
  last.hash = hash;
  last.seq += 1;
  return {
    type: "picture",
    seq: last.seq,
    uri: picture ? `data:${picture.mimeType};base64,${picture.data}` : null,
  };
}

export function createDesignService(given: DesignDeps): DesignService {
  if ("disabled" in given.config) return disabledService(given.config.disabled);
  const deps: DesignDeps = { ...given, log: (line) => given.log(redact(line)) };
  const config = given.config;
  const paths: DesignPaths = designPaths(deps.env, deps.home);
  const store: FilesStore = createFilesStore({ file: paths.filesJson, log: deps.log });
  const cli = deps.cliCommand ?? { command: config.cliPath, argsBefore: [] };
  /** The workspace directory each running file reads its tokens from (its first opener's). */
  const tokenDirs = new Map<string, string>();
  const viewers = new Map<string, Set<(event: ViewEvent) => Promise<void>>>();
  const serverWithKey = `${config.serverUrl}${config.serverUrl.includes("?") ? "&" : "?"}key=${encodeURIComponent(config.serverKey)}`;

  async function workspace(
    workspaceId: string,
  ): Promise<{ projectKey: string; directory: string | null }> {
    const snapshot = await deps.paseo().workspaces.ref(workspaceId).refresh();
    if (!snapshot) throw new Error(`No workspace ${workspaceId}`);
    return {
      projectKey: snapshot.projectId,
      directory: snapshot.workspaceDirectory ?? snapshot.projectRootPath ?? null,
    };
  }

  const childEnv = Object.fromEntries(
    Object.entries(deps.env).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])),
  );

  async function session(name: string): Promise<FigcraftSession> {
    mkdirSync(paths.runDir, { recursive: true });
    // No automation roots: FigCraft 0.18.1 turns live sessions off in a confined process.
    return FigcraftSession.start({
      command: cli.command,
      args: [...cli.argsBefore, "mcp"],
      env: childEnv,
      runDir: paths.runDir,
      name,
    });
  }

  function tokensPort(fileId: string): TokensPort {
    const file = () => {
      const dir = tokenDirs.get(fileId);
      return dir ? join(dir, "design", "tokens.json") : null;
    };
    return {
      async read() {
        const path = file();
        if (path === null || !existsSync(path)) return null;
        return JSON.parse(await readFile(path, "utf8")) as TokenFile;
      },
      async write(next) {
        const path = file();
        if (path === null) return;
        await writeFile(path, `${JSON.stringify(next, null, 2)}\n`);
        for (const push of viewers.get(fileId) ?? [])
          await push({ type: "tokens-written" }).catch(() => undefined);
      },
      async defaults() {
        if (!deps.defaultTokensPath) return null;
        return JSON.parse(await readFile(deps.defaultTokensPath, "utf8")) as unknown;
      },
    };
  }

  const bridges: Bridges = createBridges({
    max: config.maxBridges,
    idleMs: IDLE_MS,
    clock: deps.clock ?? {
      setTimeout: (fn, ms) => setTimeout(fn, ms).unref(),
      clearTimeout: (h) => clearTimeout(h as NodeJS.Timeout),
    },
    log: deps.log,
    async openBridge(fileId) {
      const file = await store.get(fileId);
      if (!file) throw new Error("This design is no longer listed");
      return Bridge.open({
        session: await session(`bridge-${fileId}`),
        file,
        tokens: tokensPort(fileId),
        log: deps.log,
      });
    },
    onStatus(fileId, status) {
      for (const push of viewers.get(fileId) ?? []) {
        void push({
          type: "status",
          status: status.status,
          error: status.status === "failed" ? status.error : null,
        }).catch(() => undefined);
      }
    },
  });

  // Background reads peek: holding the bridge would restart its idle timer every tick.
  async function runningBridge(fileId: string): Promise<Bridge> {
    const bridge = bridges.peek(fileId);
    if (bridge === null) throw new Error("the bridge is not running");
    return bridge;
  }

  const comments: CommentRouter = createCommentRouter({
    openThreads: async (fileId) => (await runningBridge(fileId)).openThreads(),
    prompt: async (fileId, ids) => (await runningBridge(fileId)).commentPrompt(ids),
    agentOf: async (fileId) => (await store.get(fileId))?.lastAgentId ?? null,
    agentIdle: async (agentId) => {
      const result = await deps.paseo().agents.ref(agentId).refresh();
      const agent = result?.agent;
      return (
        !!agent &&
        !agent.archivedAt &&
        agent.pendingPermissions.length === 0 &&
        (agent.status === "idle" || agent.status === "error")
      );
    },
    send: (agentId, text) =>
      deps.paseo().agents.ref(agentId).send(text, { activeTurnBehavior: "steer" }),
    log: deps.log,
  });

  async function row(file: DesignFile): Promise<FileRow> {
    const status = bridges.status(file.id);
    let outOfStep = false;
    const running = bridges.peek(file.id);
    if (running !== null) {
      try {
        outOfStep = await (await running).outOfStep();
      } catch {
        outOfStep = false;
      }
    }
    return {
      ...publicFile(file),
      status: status.status,
      error: status.status === "failed" ? status.error : null,
      outOfStep,
    };
  }

  async function publishNew(projectKey: string, name: string): Promise<DesignFile> {
    const publisher = await session(`publish-${randomUUID().slice(0, 8)}`);
    try {
      const links = await publisher.publish(serverWithKey, name);
      const file: DesignFile = {
        id: randomUUID(),
        projectKey,
        name,
        createdAt: Date.now(),
        lastAgentId: null,
        secrets: { ...links },
      };
      await store.add(file);
      return file;
    } finally {
      await publisher.close();
    }
  }

  async function holdFor(
    fileId: string,
    workspaceId: string,
    holder: { kind: "viewer" | "agent"; id: string },
  ): Promise<Bridge> {
    if (!tokenDirs.has(fileId)) {
      const { directory } = await workspace(workspaceId);
      if (directory) tokenDirs.set(fileId, directory);
    }
    return bridges.acquire(fileId, holder);
  }

  const failure = (error: unknown) => ({ ok: false as const, error: messageOf(error) });

  const service: DesignService = {
    async files(workspaceId) {
      const { projectKey } = await workspace(workspaceId);
      return { enabled: true, files: await Promise.all((await store.list(projectKey)).map(row)) };
    },
    async create(workspaceId, name) {
      try {
        const { projectKey } = await workspace(workspaceId);
        return { ok: true, file: publicFile(await publishNew(projectKey, name)) };
      } catch (error) {
        deps.log(`[design] create failed: ${messageOf(error)}`);
        return failure(error);
      }
    },
    async rename(fileId, name) {
      try {
        return { ok: true, file: publicFile(await store.update(fileId, { name })) };
      } catch (error) {
        return failure(error);
      }
    },
    async remove(fileId) {
      try {
        comments.forget(fileId);
        await store.remove(fileId);
        return { ok: true };
      } catch (error) {
        return failure(error);
      }
    },
    async editorLink(fileId, workspaceId) {
      try {
        const file = await store.get(fileId);
        const { projectKey } = await workspace(workspaceId);
        if (!file || file.projectKey !== projectKey) {
          return { ok: false, error: "This design is no longer listed" };
        }
        // Holds nothing: the editor tab's own view holds the bridge while the tab is open.
        return {
          ok: true,
          url: `${config.webUrl}#join=${encodeURIComponent(file.secrets.editLink)}`,
        };
      } catch (error) {
        return failure(error);
      }
    },
    async comment(fileId, x, y, text) {
      try {
        const bridge = await bridges.acquire(fileId, { kind: "viewer", id: "comment" });
        try {
          const bounds = (await bridge.pageBounds()) ?? { x: 0, y: 0, width: 1, height: 1 };
          await bridge.addComment(bounds.x + x * bounds.width, bounds.y + y * bounds.height, text);
        } finally {
          bridges.release(fileId, { kind: "viewer", id: "comment" });
        }
        return { ok: true };
      } catch (error) {
        return failure(error);
      }
    },
    async send(fileId, agentId, note) {
      const file = await store.get(fileId);
      if (!file) return { ok: false, error: "This design is no longer listed" };
      try {
        const bridge = await bridges.acquire(fileId, { kind: "viewer", id: "send" });
        try {
          const result = await sendSelection({
            bridge,
            file,
            agentId,
            note,
            send: (id, text, images) =>
              deps.paseo().agents.ref(id).send(text, { activeTurnBehavior: "steer", images }),
          });
          if (result.ok) await store.update(fileId, { lastAgentId: agentId });
          return result;
        } finally {
          bridges.release(fileId, { kind: "viewer", id: "send" });
        }
      } catch (error) {
        return failure(error);
      }
    },
    async agents(workspaceId) {
      const { entries } = await deps.paseo().agents.list();
      return {
        agents: entries
          .map((entry) => entry.agent)
          .filter((agent) => agent.workspaceId === workspaceId && !agent.archivedAt)
          .map((agent) => ({ id: agent.id, title: agent.title ?? agent.id.slice(0, 8) })),
      };
    },
    async view(input, push, signal) {
      const holder = { kind: "viewer" as const, id: `view-${randomUUID()}` };
      const set = viewers.get(input.fileId) ?? new Set();
      set.add(push);
      viewers.set(input.fileId, set);
      const pictures = { hash: "", seq: 0 };
      try {
        const bridge = await holdFor(input.fileId, input.workspaceId, holder);
        await push({ type: "status", status: "running", error: null });
        await push({ type: "tokens", tokens: bridge.tokens });
        while (!signal.aborted) {
          // The bridge may have restarted since the last pass; a failed one ends the view, and
          // the client starts a new one (its `attempt`) instead of a retry loop here.
          const status = bridges.status(input.fileId);
          if (status.status === "failed") {
            await push({ type: "status", status: "failed", error: status.error });
            return;
          }
          const current = await bridges.acquire(input.fileId, holder);
          const threads = await current.openThreads().catch(() => []);
          await push({
            type: "threads",
            // The user's own comments from the phone are posted by the bridge, under its name.
            threads: threads.map(({ id, author, preview }) => ({
              id,
              author: author === BRIDGE_AUTHOR ? "You" : author,
              preview,
            })),
          });
          if (input.pictures) {
            const event = await pictureEvent(current, pictures);
            if (event) await push(event);
          }
          if (signal.aborted) break;
          await new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, deps.viewPollMs ?? 3000);
            timer.unref();
            signal.addEventListener("abort", () => resolve(), { once: true });
          });
        }
      } catch (error) {
        await push({ type: "status", status: "failed", error: messageOf(error) }).catch(
          () => undefined,
        );
      } finally {
        set.delete(push);
        bridges.release(input.fileId, holder);
      }
    },
    async join(agent, input) {
      if (!agent.workspaceId)
        return { isError: true, text: "design_join needs an agent in a workspace" };
      try {
        const { projectKey } = await workspace(agent.workspaceId);
        let file = input.file ? await store.get(input.file) : null;
        if (input.file && (!file || file.projectKey !== projectKey)) {
          return {
            isError: true,
            text: "No such design in this project: pass the file id from a Send to agent prompt or an earlier design_join",
          };
        }
        file ??= await publishNew(projectKey, input.name?.trim() || "Design");
        const bridge = await holdFor(file.id, agent.workspaceId, { kind: "agent", id: agent.id });
        await store.update(file.id, { lastAgentId: agent.id });
        return {
          text: [
            bridge.tokens.status === "default"
              ? `Design "${file.name}" (file ${file.id}) is open. This repo has no design/tokens.json, so the FigCraft variables (collection Tokens) hold Paseo's design system, one mode per Paseo theme; edits to them stay in this file.`
              : `Design "${file.name}" (file ${file.id}) is open; its tokens are imported as FigCraft variables (collection Tokens).`,
            `Join it with FigCraft: run_command collab.join {"link": "${file.secrets.editLink}"}, then poll collab.peers until status is "live".`,
            "Use the Tokens variables for colours, sizes and type. Do not share, publish or host files: Paseo does that.",
            "To check what you built against a frame, save a screenshot of the running app in the workspace (android_screenshot, or a Playwright screenshot) and call design_compare.",
            "Do not repeat this link in chat.",
          ].join("\n"),
        };
      } catch (error) {
        return { isError: true, text: `design_join failed: ${messageOf(error)}` };
      }
    },
    async compare(agent, input) {
      if (!agent.workspaceId)
        return { isError: true, text: "design_compare needs an agent in a workspace" };
      try {
        const { projectKey, directory } = await workspace(agent.workspaceId);
        const file = await store.get(input.file);
        if (!file || file.projectKey !== projectKey) {
          return {
            isError: true,
            text: "No such design in this project: pass the file id from design_join",
          };
        }
        if (!directory) return { isError: true, text: "This workspace has no folder" };
        const image = await workspaceImage(directory, input.image);
        const bridge = await holdFor(file.id, agent.workspaceId, { kind: "agent", id: agent.id });
        const placed = await bridge.compare(input.frame, image, new Date());
        return {
          text: `Placed ${JSON.stringify(placed.name)} (layer ${placed.id}) right of ${JSON.stringify(placed.frame)} at its width. Compare them: screenshot {"ids": [${input.frame}, ${placed.id}]}.`,
        };
      } catch (error) {
        return { isError: true, text: `design_compare failed: ${messageOf(error)}` };
      }
    },
    async openSession(request) {
      if (request.purpose !== "interactive" || request.background || !request.workspaceId) {
        return null;
      }
      // Unconfined, as the bridge: the agent's own tools reach the same files anyway.
      const args = [
        deps.guardPath,
        "--server",
        config.serverUrl,
        "--name",
        agentLabel(request),
        "--",
        cli.command,
        ...cli.argsBefore,
        "mcp",
      ];
      return {
        ...request,
        tools: [...request.tools, ...designTools(service)],
        mcpServers: {
          ...request.mcpServers,
          figcraft: { type: "stdio", command: process.execPath, args },
        },
      };
    },
    turnEnded: (agentId) => comments.turnEnded(agentId),
    agentGone: (agentId) => bridges.releaseAgent(agentId),
    async tick() {
      for (const fileId of bridges.running()) {
        const bridge = bridges.peek(fileId);
        if (bridge === null) continue; // Still starting.
        try {
          await comments.poll(fileId);
          const open = await bridge;
          // The repo first: an edit there wins over a FigCraft edit made in the same tick.
          if (await open.syncTokensFromRepo()) {
            for (const push of viewers.get(fileId) ?? [])
              await push({ type: "tokens", tokens: open.tokens }).catch(() => undefined);
          }
          await open.syncTokensBack();
        } catch (error) {
          deps.log(`[design] ${fileId}: tick failed: ${messageOf(error)}`);
        }
      }
    },
    async debugImportVariables(fileId, json) {
      const bridge = await bridges.acquire(fileId, { kind: "viewer", id: "debug" });
      await (bridge as unknown as { session: FigcraftSession }).session.importVariables(json);
      bridges.release(fileId, { kind: "viewer", id: "debug" });
    },
    stop: () => bridges.stopAll(),
  };
  return service;
}
