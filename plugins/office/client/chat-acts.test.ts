import { expect, test, vi } from "vitest";
import { emitChatAct, onChatAct } from "./chat-acts.js";

test("an act reaches each listener once, and the same id again is dropped", () => {
  const first = vi.fn();
  const second = vi.fn();
  const leaveFirst = onChatAct(first);
  const leaveSecond = onChatAct(second);

  // The surface and each open panel have their own subscription: each brings the same act.
  emitChatAct({ what: "meeting", id: "act-1" });
  emitChatAct({ what: "meeting", id: "act-1" });
  expect(first.mock.calls).toEqual([["meeting"]]);
  expect(second.mock.calls).toEqual([["meeting"]]);

  emitChatAct({ what: "meeting", id: "act-2" });
  expect(first).toHaveBeenCalledTimes(2);
  expect(second).toHaveBeenCalledTimes(2);
  leaveFirst();
  leaveSecond();
});

test("a listener that left hears nothing", () => {
  const listener = vi.fn();
  const leave = onChatAct(listener);
  leave();

  emitChatAct({ what: "meeting", id: "act-3" });
  expect(listener).not.toHaveBeenCalled();
});
