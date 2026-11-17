// PASEO: types for chat-engine.js, which is upstream's and stays as it is.
// Only the part the office calls is typed.

export const REACTIONS: string[];

export type Translate = {
  (key: string, vars?: object | null): string;
  (key: string, vars: object | null, as: "list"): string[];
};

export interface EngineMessage {
  id: string;
  at: number;
  kind: string;
  text: string;
  from?: string;
  name?: string;
  sticker?: number | null;
  photo?: unknown;
  poll?: { q: string; opts: { t: string; by: string[] }[] } | null;
  remind?: {
    title: string;
    at: number;
    repeat: string;
    yes: string[];
    no: string[];
    done?: boolean;
  } | null;
  reply?: { id: string; name: string; text: string } | null;
  reacts: Record<string, string[]>;
  recalled?: boolean;
  tag?: string;
}

export interface ChatMember {
  id: string;
  name: string;
  status: "rest" | "work";
  task: string;
  project: string;
  last?: { type?: string; label?: string };
}

export interface ChatEngineContext {
  tr: Translate;
  now(): number;
  members(): ChatMember[];
  staffName(key: string): string | null;
  store: { load(): unknown; save(data: unknown): void };
  emit(op: "add" | "update" | "typing" | "all", payload?: EngineMessage | string[]): void;
  act?(what: "meeting" | "tea"): void;
  timer?(run: () => void, ms: number): unknown;
}

export interface SayOptions {
  now?: boolean;
  delay?: number;
  long?: boolean;
  reply?: { id: string; name: string; text: string } | null;
  sticker?: number | null;
  react?: string[];
  reacts?: number;
  key?: string;
  tag?: string;
}

export interface ChatEngine {
  state: {
    msgs: EngineMessage[];
    pinned: string | null;
    days: Record<string, string>;
    keys: string[];
    typing: string[];
  };
  byId(id: string): EngineMessage | undefined;
  say(from: string, text: string, options?: SayOptions): void;
  system(text: string): EngineMessage;
  send(input: { text?: string; sticker?: number | null; replyTo?: string | null }): void;
  working(from: string, on: boolean): void;
  react(id: string, by: string, emoji: string): void;
  vote(id: string, by: string, index: number): void;
  rsvp(id: string, by: string, yes: boolean): void;
  recall(id: string): void;
  onEvent(event: {
    type: string;
    sess: string;
    agent?: boolean;
    limit?: boolean;
    label?: string;
  }): void;
  onLeft(name: string): void;
  clock(): void;
}

export function createChatEngine(context: ChatEngineContext): ChatEngine;
