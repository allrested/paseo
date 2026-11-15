import { homedir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { errorMessage } from "./server/errors.js";
import { attributionRoot } from "./server/paths.js";
import { listFiles, readFile } from "./server/reader.js";
import { record } from "./server/record.js";
import { findShadow, openShadow, removeOrphans } from "./server/shadow.js";
import { snapshot } from "./server/snapshot.js";
import { createTracker, type TurnAgent } from "./server/tracker.js";
import { findWorkTree } from "./server/work-tree.js";
import { attributionChanges, fileRpc, filesRpc } from "./shared/contracts.js";

/** What the plugin needs from outside the daemon's plugin API. */
export interface AttributionPluginDeps {
  /** The folder that holds every checkout's store. */
  root: string;
  /** Now, in milliseconds. */
  now(): number;
  log(message: string): void;
}

interface Subscriber {
  push(event: { type: "changed"; workspaceIds: string[] }): Promise<void>;
  signal: AbortSignal;
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

// Runs inside the daemon process: every hook catches its own errors.
export function createAttributionPlugin(
  server: PluginServerContext,
  deps: AttributionPluginDeps,
): () => void {
  const { root, log } = deps;
  const subscribers = new Set<Subscriber>();
  const tracker = createTracker({
    findWorkTree,
    openShadow: (top) => openShadow(root, top),
    snapshot,
    record,
    now: deps.now,
    log,
    changed(workspaceIds) {
      for (const subscriber of subscribers) {
        // A subscriber that left does not stop the others.
        subscriber.push({ type: "changed", workspaceIds }).catch(() => undefined);
      }
    },
  });
  const guard = (name: string, work: () => Promise<void>) =>
    work().catch((error) => log(`[attribution] ${name} failed: ${errorMessage(error)}`));

  /** The checkout of the workspace's folder, or null when it has none. */
  async function workTreeOf(
    workspaceId: string,
    paseo: Parameters<Parameters<PluginServerContext["handle"]>[1]>[1]["paseo"],
  ) {
    const workspace = await paseo.workspaces.ref(workspaceId).refresh();
    const folder = workspace?.workspaceDirectory ?? workspace?.projectRootPath;
    return folder ? findWorkTree(folder) : null;
  }

  server.handle(filesRpc, async ({ workspaceId }, { paseo }) => {
    const workTree = await workTreeOf(workspaceId, paseo);
    if (!workTree) return { status: "no_checkout" as const };
    const shadow = await findShadow(root, workTree.top);
    return { status: "ready" as const, files: shadow ? await listFiles(shadow, workTree) : [] };
  });
  server.handle(fileRpc, async ({ workspaceId, path }, { paseo }) => {
    const workTree = await workTreeOf(workspaceId, paseo);
    if (!workTree) return { status: "untracked" as const };
    const shadow = await findShadow(root, workTree.top);
    return shadow ? readFile(shadow, workTree, path) : { status: "untracked" as const };
  });
  server.handle(attributionChanges, async (_input, subscriber) => {
    if (subscriber.signal.aborted) return;
    subscribers.add(subscriber);
    await waitForAbort(subscriber.signal);
    subscribers.delete(subscriber);
  });

  const turnAgent = (agent: TurnAgent): TurnAgent => ({
    id: agent.id,
    parentAgentId: agent.parentAgentId,
    background: agent.background,
    cwd: agent.cwd,
    title: agent.title,
    provider: agent.provider,
    workspaceId: agent.workspaceId,
  });
  const removeHooks = [
    server.addHook("agent.turn.before", ({ agent }) =>
      guard("agent.turn.before", () => tracker.started(turnAgent(agent))),
    ),
    server.addHook("agent.turn.after", ({ agent }) =>
      guard("agent.turn.after", () => tracker.ended(agent.id)),
    ),
    server.addHook("agent.close.after", ({ agent }) =>
      guard("agent.close.after", () => tracker.gone(agent.id)),
    ),
    server.addHook("agent.archive.after", ({ agent }) =>
      guard("agent.archive.after", () => tracker.gone(agent.id)),
    ),
  ];
  // A store outlives its folder until the next start.
  void guard("clean-up", async () => {
    const removed = await removeOrphans(root);
    if (removed > 0) log(`[attribution] removed ${removed} stores of folders that are gone`);
  });

  return () => {
    for (const remove of removeHooks) remove();
  };
}

export default function contribute(server: PluginServerContext): () => void {
  return createAttributionPlugin(server, {
    // Built-ins run in the daemon process, so process.env is the daemon's env.
    root: attributionRoot(process.env, homedir()),
    now: () => Date.now(),
    log: (message) => console.error(message),
  });
}
