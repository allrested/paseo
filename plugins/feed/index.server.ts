import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { errorMessage } from "./server/errors.js";
import { createFeed } from "./server/feed.js";
import { createFeedStore, type FeedStore } from "./server/feed-store.js";
import { feedFile } from "./server/paths.js";
import { TAIL_LIMIT, permissionEntry, turnEntry } from "./server/recorder.js";
import { listRunning } from "./server/running.js";
import { feedSubscription, markRpc, seenRpc } from "./shared/contracts.js";

/** What the feed needs from outside the daemon's plugin API. */
export interface FeedPluginDeps {
  store: FeedStore;
  /** Now, as an ISO time. */
  now(): string;
  newId(): string;
  log(message: string): void;
}

// Runs inside the daemon process: every hook catches its own errors.
export function createFeedPlugin(server: PluginServerContext, deps: FeedPluginDeps): () => void {
  const { log } = deps;
  const feed = createFeed({ store: deps.store, log });

  // The plugin may start while agents are in a turn: the first device that opens the feed has
  // the host's API, and those turns are found then, once.
  let caughtUp = false;
  server.handle(feedSubscription, (_input, context) => {
    if (!caughtUp) {
      caughtUp = true;
      feed
        .catchUp(() => listRunning((request) => context.paseo.agents.list(request)))
        .catch((error: unknown) => {
          log(`[feed] the running agents could not be listed: ${errorMessage(error)}`);
        });
    }
    return feed.attach(context);
  });
  server.handle(seenRpc, () => feed.seen(deps.now()));
  server.handle(markRpc, async ({ id, unread }) => {
    await feed.mark(id, unread);
    return {};
  });

  const removeHooks = [
    server.addHook("agent.turn.before", async ({ agent }) => {
      try {
        // A helper is hidden from tabs and lists, and from here.
        if (agent.background) return;
        await feed.started({
          agentId: agent.id,
          title: agent.title,
          folder: agent.cwd,
          since: deps.now(),
        });
      } catch (error) {
        log(`[feed] agent.turn.before failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.turn.after", async ({ agent, turnId, outcome }, { paseo }) => {
      try {
        // However the turn ended, the agent runs no more and waits for no answer.
        await feed.released(agent.id);
        const entry = await turnEntry(
          {
            ...deps,
            async tail(agentId) {
              const page = await paseo.agents
                .ref(agentId)
                .timeline.refetch({ direction: "tail", limit: TAIL_LIMIT });
              return page.entries;
            },
          },
          { agent, turnId, outcome },
        );
        if (entry !== null) await feed.add(entry);
      } catch (error) {
        log(`[feed] agent.turn.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.permission.before", async ({ agent, request }) => {
      try {
        const entry = permissionEntry(deps, { agent, request });
        if (entry !== null) await feed.add(entry);
      } catch (error) {
        log(`[feed] agent.permission.before failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.permission.after", async ({ requestId }) => {
      try {
        await feed.answered(requestId);
      } catch (error) {
        log(`[feed] agent.permission.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.close.after", async ({ agent }) => {
      try {
        await feed.released(agent.id);
      } catch (error) {
        log(`[feed] agent.close.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.archive.after", async ({ agent }) => {
      try {
        await feed.released(agent.id);
      } catch (error) {
        log(`[feed] agent.archive.after failed: ${errorMessage(error)}`);
      }
    }),
  ];

  return () => {
    for (const remove of removeHooks) remove();
  };
}

export default function contribute(server: PluginServerContext): () => void {
  const log = (message: string) => console.error(message);
  return createFeedPlugin(server, {
    // Built-ins run in the daemon process, so process.env is the daemon's env.
    store: createFeedStore({ file: feedFile(process.env, homedir()), log }),
    now: () => new Date().toISOString(),
    newId: randomUUID,
    log,
  });
}
