// @vitest-environment jsdom
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { getChatSeen, markChatSeen, resetChatSeen, subscribeChatSeen } from "./chat-seen.js";

const KEY = "office-chat-seen";
const NOW = Date.parse("2026-11-17T09:00:00Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  localStorage.clear();
  resetChatSeen(null);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

test("with nothing stored the mark starts now", () => {
  expect(getChatSeen()).toBe(NOW);
  expect(localStorage.getItem(KEY)).toBe(String(NOW));

  vi.setSystemTime(NOW + 5000);
  expect(getChatSeen()).toBe(NOW);
});

test("a mark moves forward only, is stored, and tells its listeners", () => {
  resetChatSeen(1000);
  const listener = vi.fn();
  const leave = subscribeChatSeen(listener);

  markChatSeen(500);
  markChatSeen(1000);
  expect(getChatSeen()).toBe(1000);
  expect(listener).not.toHaveBeenCalled();

  markChatSeen(2000);
  expect(getChatSeen()).toBe(2000);
  expect(localStorage.getItem(KEY)).toBe("2000");
  expect(listener).toHaveBeenCalledTimes(1);

  // The next run of the app reads it back.
  resetChatSeen(null);
  expect(getChatSeen()).toBe(2000);

  leave();
  markChatSeen(3000);
  expect(listener).toHaveBeenCalledTimes(1);
});

test("a device without localStorage keeps the mark in memory", () => {
  vi.stubGlobal("localStorage", undefined);

  expect(getChatSeen()).toBe(NOW);
  markChatSeen(NOW + 1000);
  expect(getChatSeen()).toBe(NOW + 1000);
});

test("a storage that throws does not break the mark", () => {
  const refuse = () => {
    throw new Error("The storage is blocked");
  };
  vi.stubGlobal("localStorage", { getItem: refuse, setItem: refuse });
  const listener = vi.fn();
  const leave = subscribeChatSeen(listener);

  expect(getChatSeen()).toBe(NOW);
  markChatSeen(NOW + 1000);
  expect(getChatSeen()).toBe(NOW + 1000);
  expect(listener).toHaveBeenCalledTimes(1);
  leave();
});
