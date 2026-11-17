import { useSyncExternalStore } from "react";

/**
 * When this device last had the chat open, for the Chat button's count. Kept in localStorage
 * where it works; a phone's native app has none, so there it lasts for the app's run.
 */

const KEY = "office-chat-seen";
const listeners = new Set<() => void>();
let seen: number | null = null;

function storage(): Pick<Storage, "getItem" | "setItem"> | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // A browser that refuses storage (private mode, a blocked frame).
    return null;
  }
}

function remember(value: number): void {
  try {
    storage()?.setItem(KEY, String(value));
  } catch {
    // Memory only.
  }
}

/** With nothing stored, the mark starts now: a first open does not count the old messages. */
export function getChatSeen(): number {
  if (seen !== null) return seen;
  let stored: number | null = null;
  try {
    const text = storage()?.getItem(KEY);
    const parsed = text === null || text === undefined ? Number.NaN : Number(text);
    stored = Number.isFinite(parsed) ? parsed : null;
  } catch {
    // None stored.
  }
  seen = stored ?? Date.now();
  if (stored === null) remember(seen);
  return seen;
}

/** Moves the mark forward only. */
export function markChatSeen(at: number): void {
  if (at <= getChatSeen()) return;
  seen = at;
  remember(at);
  for (const listener of listeners) listener();
}

export function subscribeChatSeen(listener: () => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

export const useChatSeen = (): number => useSyncExternalStore(subscribeChatSeen, getChatSeen);

/** For tests: sets the mark in memory; null reads it from storage again. */
export function resetChatSeen(value: number | null): void {
  seen = value;
}
