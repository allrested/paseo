import type { PluginTurnOutcome } from "@getpaseo/plugin/server";
import {
  CHAT_MESSAGE_MAX,
  CHAT_TEXT_MAX,
  ChatMessageSchema,
  type ChatChange,
  type ChatMessage,
  type ChatRequest,
  type ChatResult,
  type ChatSnapshot,
  type OfficeAgent,
  type OfficeWorkspace,
} from "../shared/contracts.js";
import { agentTitle } from "../shared/model.js";
import {
  createChatEngine,
  type ChatEngine,
  type ChatMember,
  type EngineMessage,
  type Translate,
} from "../vendor/my-office/src/shared/chat-engine.js";
import type { ChatData, ChatStore } from "./chat-store.js";
import { errorMessage } from "./errors.js";
import type { DirectoryView } from "./hub.js";
import type { Clock } from "./timers.js";

/** How often the engine's clock runs: the morning hello, the lunch poll, reminders. */
export const CHAT_CLOCK_MS = 30_000;
export const RECALL_WINDOW_MS = 2 * 60 * 1000;
export const ANSWER_MAX = 1200;
export const PROMPT_PREFIX = "Team chat message from you: ";

const DIRECTOR = "__director";
const USAGE_LIMIT =
  /usage limit|rate limit|quota|limit (?:reached|exceeded|resets)|out of (?:usage|credits)/i;
const NAME_CHAR = /[\p{L}\p{N}_-]/u;

export interface ChatServicePorts {
  store: ChatStore;
  clock: Clock;
  tr: Translate;
  /** Sends a prompt that steers a running turn. */
  send(agentId: string, prompt: string): Promise<void>;
  /** The last assistant message of the turn `turnId`, read from the agent's timeline; null when there is none. */
  lastAnswer(agentId: string, turnId: string | null): Promise<string | null>;
  emit(change: ChatChange): void;
  log(message: string): void;
}

export interface ChatService {
  snapshot(): ChatSnapshot;
  /** The directory's view; null when it stops. The first view after null is a baseline and makes no lines. */
  view(view: DirectoryView | null): void;
  turnEnded(
    agent: { id: string },
    outcome: PluginTurnOutcome,
    turnId: string | null,
  ): Promise<void>;
  archived(agentId: string): void;
  request(input: ChatRequest): Promise<ChatResult>;
  /** Cancels the clock and the engine's timers and waits for the last save. */
  stop(): Promise<void>;
}

/** Of upstream's staff only the director speaks; the others have nobody on the floor. */
export function staffNameOf(key: string, tr: Translate): string | null {
  return key === DIRECTOR ? tr("people.director") : null;
}

export function isUsageLimit(message: string): boolean {
  return USAGE_LIMIT.test(message);
}

// Copied from packages/protocol/src/agent-attention-notification.ts findLatestAssistantMessageFromTimeline:
// a plugin cannot import the protocol package.
export function lastAssistantText(
  items: readonly { type: string; text?: unknown }[],
): string | null {
  const chunks: string[] = [];
  for (const item of items.toReversed()) {
    if (item.type === "assistant_message" && typeof item.text === "string") {
      chunks.push(item.text);
      continue;
    }
    if (chunks.length > 0) break;
  }
  const text = chunks.toReversed().join("").trim();
  return text === "" ? null : text;
}

export function clipAnswer(text: string): string {
  return text.length > ANSWER_MAX ? `${text.slice(0, ANSWER_MAX - 1).trimEnd()}…` : text;
}

// The engine's own `short`.
function short(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The members an `@name` in `text` names, in the order they come. Upstream's rule
 * (`text.includes("@" + name)`), except that a name followed by a name character, or inside a
 * longer member's name, does not count: `@Mjd-1` does not name `Mjd`.
 */
export function mentionedIds(
  text: string,
  members: readonly { id: string; name: string }[],
): string[] {
  const claimed: [number, number][] = [];
  const found = new Map<string, number>();
  for (const member of [...members].sort((a, b) => b.name.length - a.name.length)) {
    const needle = `@${member.name}`;
    for (let from = text.indexOf(needle); from !== -1; from = text.indexOf(needle, from + 1)) {
      const end = from + needle.length;
      if (end < text.length && NAME_CHAR.test(text.charAt(end))) continue;
      if (claimed.some(([start, stop]) => from < stop && end > start)) continue;
      claimed.push([from, end]);
      if (!found.has(member.id)) found.set(member.id, from);
    }
  }
  return [...found].sort((a, b) => a[1] - b[1]).map(([id]) => id);
}

function memberOf(agent: OfficeAgent, workspaces: readonly OfficeWorkspace[]): ChatMember {
  return {
    id: agent.id,
    name: agentTitle(agent),
    status: agent.status === "idle" ? "rest" : "work",
    task: agent.title?.trim() ?? "",
    project: workspaces.find((workspace) => workspace.id === agent.workspaceId)?.projectName ?? "",
  };
}

// Drops a photo's picture and the cards' bodies.
function wireOf(message: EngineMessage): ChatMessage | null {
  const parsed = ChatMessageSchema.safeParse(message);
  return parsed.success ? parsed.data : null;
}

interface Waiting {
  member: ChatMember;
  reply: { id: string; name: string; text: string };
}

const OK: ChatResult = { ok: true };
const NO_PERMISSIONS: ReadonlySet<string> = new Set();

export async function createChatService(ports: ChatServicePorts): Promise<ChatService> {
  const { clock, log, tr } = ports;
  const loaded = await ports.store.load();
  const roster = new Map<string, ChatMember>();
  // The prompts waiting for an answer, by agent, in send order; never an empty list. In memory only.
  // Each ends by its own failure, a turn end or an archive.
  const waiting = new Map<string, readonly Waiting[]>();
  const timers = new Set<() => void>();
  // The permission ids each agent had in the last view; null until the first view of an open office.
  let baseline: Map<string, ReadonlySet<string>> | null = null;
  // False while the engine is being made: it saves and emits from its constructor, before `engine` exists.
  let live = false;
  let stopped = false;
  let capture: EngineMessage[] | null = null;
  let acts = 0;
  let cancelClock: (() => void) | null = null;

  // One write at a time; while it runs only the newest conversation waits.
  let dirty: ChatData | null = null;
  let saving: Promise<void> | null = null;
  async function drain(): Promise<void> {
    try {
      while (dirty !== null) {
        const next = dirty;
        dirty = null;
        try {
          await ports.store.save(next);
        } catch (error) {
          log(`[office] chat save failed: ${errorMessage(error)}`);
        }
      }
    } finally {
      saving = null;
    }
  }
  function queueSave(data: unknown): void {
    // The engine hands over its own plain object and keeps changing it.
    dirty = structuredClone(data) as ChatData;
    saving ??= drain();
  }

  // An agent waiting for its answer stays a member, so its answer and its typing still resolve.
  const members = (): ChatMember[] => [
    ...roster.values(),
    ...[...waiting.values()]
      .map((entries) => entries[0].member)
      .filter((member) => !roster.has(member.id)),
  ];

  function emit(op: "add" | "update" | "typing" | "all", payload?: EngineMessage | string[]): void {
    if (!live) return;
    if (Array.isArray(payload)) {
      ports.emit({ op: "typing", names: payload });
      return;
    }
    if (payload !== undefined) {
      capture?.push(payload);
      const message = wireOf(payload);
      if (message !== null) ports.emit({ op: op === "update" ? "update" : "add", message });
      return;
    }
    ports.emit({ op: "all", messages: wireMessages() });
  }

  const engine: ChatEngine = createChatEngine({
    tr,
    now: () => clock.now(),
    members,
    staffName: (key) => staffNameOf(key, tr),
    store: { load: () => loaded, save: queueSave },
    emit,
    act: (what) => {
      if (what !== "meeting") return;
      acts += 1;
      // The time keeps an id new after a restart, so a page that saw the last run's acts takes it.
      ports.emit({ op: "act", what, id: `${clock.now().toString(36)}-${acts}` });
    },
    // The engine calls the global clearTimeout on what this returns, which is a no-op for a cancel
    // function: a stale tick still fires and finds nothing due. They stop when the queue is empty.
    timer: (run, ms) => {
      const cancel = clock.setTimeout(() => {
        timers.delete(cancel);
        run();
      }, ms);
      timers.add(cancel);
      return cancel;
    },
  });
  live = true;

  function wireMessages(): ChatMessage[] {
    return engine.state.msgs.slice(-CHAT_MESSAGE_MAX).flatMap((message) => wireOf(message) ?? []);
  }

  function scheduleClock(): void {
    cancelClock = clock.setTimeout(() => {
      try {
        engine.clock();
      } catch (error) {
        log(`[office] chat clock failed: ${errorMessage(error)}`);
      }
      if (!stopped) scheduleClock();
    }, CHAT_CLOCK_MS);
  }
  scheduleClock();

  // Ends these waits of the agent. When none is left, typing stops while the agent is still a
  // member: the engine cannot name one that left.
  function release(agentId: string, ended: readonly Waiting[]): void {
    const entries = waiting.get(agentId);
    if (entries === undefined) return;
    const left = entries.filter((entry) => !ended.includes(entry));
    if (left.length > 0) {
      waiting.set(agentId, left);
      return;
    }
    engine.working(agentId, false);
    waiting.delete(agentId);
  }

  function prompt(member: ChatMember, text: string, reply: Waiting["reply"]): void {
    const entry: Waiting = { member, reply };
    waiting.set(member.id, [...(waiting.get(member.id) ?? []), entry]);
    engine.working(member.id, true);
    ports.send(member.id, PROMPT_PREFIX + text).catch((error: unknown) => {
      release(member.id, [entry]);
      engine.system(`Could not reach ${member.name}: ${errorMessage(error)}.`);
    });
  }

  function send(input: Extract<ChatRequest, { op: "send" }>): ChatResult {
    const text = (input.text ?? "").trim().slice(0, CHAT_TEXT_MAX);
    const sticker = input.sticker ?? null;
    if (text === "" && sticker === null) return { ok: false, error: "There is nothing to send." };
    if (sticker !== null && tr("chat.stickers", null, "list")[sticker] === undefined) {
      return { ok: false, error: "There is no such sticker." };
    }
    const team = members();
    const targets = mentionedIds(text, team).flatMap(
      (id) => team.find((member) => member.id === id) ?? [],
    );
    const captured: EngineMessage[] = [];
    capture = captured;
    try {
      engine.send({ text, sticker, replyTo: input.replyTo ?? null });
    } finally {
      capture = null;
    }
    const mine = captured.find((message) => message.from === "me");
    if (mine === undefined) return OK;
    const quote = { id: mine.id, name: tr("chat.boss"), text: short(text, 90) };
    // Not awaited: a send that fails is a line in the chat, not an error of this call.
    for (const member of targets) prompt(member, text, quote);
    return OK;
  }

  function recall(id: string): ChatResult {
    const message = engine.byId(id);
    if (message?.from === "me" && clock.now() - message.at > RECALL_WINDOW_MS) {
      return { ok: false, error: "A message can be recalled for two minutes." };
    }
    engine.recall(id);
    return OK;
  }

  return {
    snapshot: () => ({ messages: wireMessages(), typing: [...engine.state.typing] }),

    view(next) {
      if (next === null) {
        baseline = null;
        return;
      }
      const open = next.agents.filter((agent) => agent.status !== "closed");
      // The roster is set first: the engine looks the agent up for each event.
      roster.clear();
      for (const agent of open) roster.set(agent.id, memberOf(agent, next.workspaces));
      const previous = baseline;
      baseline = new Map(
        open.map((agent) => [agent.id, new Set(agent.permissions.map((item) => item.id))]),
      );
      if (previous === null) return;
      for (const agent of open) {
        const had = previous.get(agent.id);
        if (had === undefined) {
          engine.onEvent(
            agent.parentAgentId === null
              ? { type: "start", sess: agent.id }
              : { type: "substart", sess: agent.parentAgentId, agent: true },
          );
        }
        for (const permission of agent.permissions) {
          if ((had ?? NO_PERMISSIONS).has(permission.id)) continue;
          engine.onEvent({ type: permission.kind === "question" ? "ask" : "wait", sess: agent.id });
        }
      }
    },

    async turnEnded(agent, outcome, turnId) {
      if (outcome.kind === "completed") engine.onEvent({ type: "stop", sess: agent.id });
      if (outcome.kind === "failed") {
        engine.onEvent({
          type: "fail",
          sess: agent.id,
          limit: isUsageLimit(outcome.error.message),
        });
      }
      // This turn answers the prompts sent before it ended; one sent during the read waits on.
      const consumed = waiting.get(agent.id) ?? [];
      const newest = consumed.at(-1);
      if (newest === undefined) return;
      try {
        if (outcome.kind === "completed") {
          const text = await ports.lastAnswer(agent.id, turnId);
          if (text !== null) {
            engine.say(agent.id, clipAnswer(text), { now: true, long: true, reply: newest.reply });
          }
        }
      } catch (error) {
        log(`[office] chat could not read the answer of ${agent.id}: ${errorMessage(error)}`);
      } finally {
        release(agent.id, consumed);
      }
    },

    archived(agentId) {
      const entries = waiting.get(agentId);
      if (entries !== undefined) release(agentId, entries);
      const member = roster.get(agentId) ?? entries?.[0]?.member;
      roster.delete(agentId);
      if (member !== undefined) engine.onLeft(member.name);
    },

    async request(input) {
      switch (input.op) {
        case "send":
          return send(input);
        case "react":
          engine.react(input.id, "me", input.emoji);
          return OK;
        case "vote":
          engine.vote(input.id, "me", input.index);
          return OK;
        case "rsvp":
          engine.rsvp(input.id, "me", input.yes);
          return OK;
        case "recall":
          return recall(input.id);
      }
    },

    async stop() {
      stopped = true;
      live = false;
      cancelClock?.();
      for (const cancel of timers) cancel();
      timers.clear();
      await saving;
    },
  };
}
