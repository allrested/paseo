import type { AgentToolDefinition } from "@getpaseo/plugin/server";
import {
  USER_AUTHOR,
  type DeleteResult,
  type Post,
  type PostKind,
  type PostResult,
  type UpdateAction,
  type WakeState,
} from "../shared/contracts.js";
import { officeTools, type ToolAgent } from "./agent-tools.js";
import { createBoardService } from "./board-service.js";
import type { BoardStore } from "./board-store.js";
import { errorMessage } from "./errors.js";
import type { Hub } from "./hub.js";
import { createMentionQueue, type MentionQueue, type WakeTarget } from "./mention-queue.js";
import { oneLine } from "./prompt-text.js";
import type { Clock } from "./timers.js";

export const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export interface OfficeAgentPorts {
  status(agentId: string): Promise<WakeTarget>;
  /** The full id of the agent that `agentId` names or starts, or null when it can get no post. */
  resolve(agentId: string): Promise<string | null>;
  /** `source` is the agent whose posts the prompt carries, or null for a prompt as from the user. */
  send(agentId: string, prompt: string, source: string | null): Promise<void>;
}

export type OfficeHub = Pick<Hub, "setBoards" | "setBoard" | "removeBoard" | "setWake">;

export interface OfficeDeps {
  store: BoardStore;
  clock: Clock;
  hub: OfficeHub;
  agents: OfficeAgentPorts;
  log(message: string): void;
}

export interface Office {
  /** Settles once boards.json is loaded; never rejects (a failure is logged). */
  ready: Promise<void>;
  tools: AgentToolDefinition[];
  noteAgent(agent: ToolAgent): void;
  post(input: { board: string; kind: PostKind; text: string; to?: string }): Promise<PostResult>;
  update(input: { id: string; action: UpdateAction }): Promise<PostResult>;
  remove(id: string): Promise<DeleteResult>;
  setWakesPaused(paused: boolean): Promise<WakeState>;
  turnEnded(agentId: string): void;
  agentGone(agentId: string): void;
  workspaceArchived(workspaceId: string): Promise<void>;
  stop(): void;
}

/** How a wake prompt names a post's author; the id lets the woken agent answer with `to`. */
export function wakeAuthorLabel(author: string, title: string | undefined): string {
  if (author === USER_AUTHOR) return "the user";
  return title ? `${title} (${author})` : `agent ${author}`;
}

export function createOffice(deps: OfficeDeps): Office {
  const { clock, hub, log } = deps;
  // Filled by the session-open and turn-end hooks and by tool calls. After a daemon restart an
  // agent is named by its bare id until one of those sees it again.
  const titles = new Map<string, string>();
  let queue: MentionQueue | null = null;
  let stopped = false;
  let cancelPrune: (() => void) | null = null;

  const label = (author: string) =>
    author === USER_AUTHOR ? "the user" : (titles.get(author) ?? author);

  const service = createBoardService({
    store: deps.store,
    clock,
    log,
    label,
    onBoard: (board, posts) => hub.setBoard(board, posts),
    onBoardRemoved: (board) => hub.removeBoard(board),
  });

  function noteAgent(agent: ToolAgent): void {
    // One line, so a name cannot start a line that reads as another post or another entry.
    const title = oneLine(agent.title ?? "");
    if (title) titles.set(agent.id, title);
  }

  function mentioned(post: Post): void {
    if (post.to === undefined || queue === null) return;
    queue.enqueue(post.to, {
      postId: post.id,
      author: post.author,
      authorLabel: wakeAuthorLabel(post.author, titles.get(post.author)),
      text: post.text,
    });
  }

  function schedulePrune(): void {
    if (stopped) return;
    cancelPrune = clock.setTimeout(() => {
      cancelPrune = null;
      service
        .prune()
        .catch((error: unknown) => log(`[office] prune failed: ${errorMessage(error)}`))
        .finally(schedulePrune);
    }, PRUNE_INTERVAL_MS);
  }

  async function begin(): Promise<void> {
    try {
      await service.start();
      if (stopped) return;
      queue = createMentionQueue(
        {
          clock,
          status: (agentId) => deps.agents.status(agentId),
          send: (agentId, prompt, source) => deps.agents.send(agentId, prompt, source),
          log,
          onChange: (wake) => hub.setWake(wake),
        },
        service.wakesPaused(),
      );
      hub.setBoards(service.boards());
      hub.setWake(queue.state());
      schedulePrune();
    } catch (error) {
      log(`[office] unable to start the boards: ${errorMessage(error)}`);
    }
  }

  const ready = begin();

  async function requireQueue(): Promise<MentionQueue> {
    await ready;
    if (queue === null) throw new Error("The office boards did not start");
    return queue;
  }

  return {
    ready,
    tools: officeTools({
      service,
      resolveAgent: (id) => deps.agents.resolve(id),
      mentioned,
      seen: noteAgent,
      label,
    }),
    noteAgent,
    async post(input) {
      await ready;
      const result = await service.post({ ...input, author: USER_AUTHOR });
      if (result.ok) mentioned(result.post);
      return result;
    },
    async update(input) {
      await ready;
      return service.update({ ...input, actor: USER_AUTHOR });
    },
    async remove(id) {
      await ready;
      return service.remove(id);
    },
    async setWakesPaused(paused) {
      const wakeQueue = await requireQueue();
      await service.setWakesPaused(paused);
      wakeQueue.setPaused(paused);
      return wakeQueue.state();
    },
    turnEnded(agentId) {
      queue?.turnEnded(agentId);
    },
    agentGone(agentId) {
      queue?.agentGone(agentId);
    },
    async workspaceArchived(workspaceId) {
      await ready;
      await service.removeBoard(workspaceId);
    },
    stop() {
      stopped = true;
      cancelPrune?.();
      cancelPrune = null;
      queue?.stop();
    },
  };
}
