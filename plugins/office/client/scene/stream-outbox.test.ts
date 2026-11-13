import { expect, test } from "vitest";
import type { RenderInputMessage } from "../../shared/contracts.js";
import { MAX_STEPS_PER_CALL, createStreamOutbox } from "./stream-outbox.js";

function setup() {
  const sent: RenderInputMessage[] = [];
  const settle: Array<(ok: boolean) => void> = [];
  const lost: string[] = [];
  const outbox = createStreamOutbox({
    send: (message) => {
      sent.push(message);
      return new Promise<{ ok: boolean }>((resolve) => settle.push((ok) => resolve({ ok })));
    },
    onLost: (reason) => lost.push(reason),
  });
  /** Answers the call in flight. */
  async function answer(ok = true): Promise<void> {
    settle.shift()?.(ok);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { outbox, sent, lost, answer };
}

test("sends nothing before the stream is ready", () => {
  const { outbox, sent } = setup();

  outbox.shown(1);
  outbox.keepAlive();

  expect(sent).toEqual([]);
});

test("once ready, sends what was said meanwhile in one call", () => {
  const { outbox, sent } = setup();
  outbox.shown(2);
  outbox.steps([{ type: "down", x: 1, y: 2 }]);

  outbox.ready("s1");

  expect(sent).toEqual([{ streamId: "s1", shown: 2, steps: [{ type: "down", x: 1, y: 2 }] }]);
});

test("keeps one call in flight and gathers the rest for the next", async () => {
  const { outbox, sent, answer } = setup();
  outbox.ready("s1");
  outbox.steps([{ type: "down", x: 1, y: 1 }]);

  outbox.steps([{ type: "move", x: 1, y: 20 }]);
  outbox.shown(3);
  outbox.shown(4);
  outbox.steps([{ type: "up", x: 1, y: 20 }]);
  expect(sent).toHaveLength(1);

  await answer();

  expect(sent[1]).toEqual({
    streamId: "s1",
    shown: 4,
    steps: [
      { type: "move", x: 1, y: 20 },
      { type: "up", x: 1, y: 20 },
    ],
  });
});

test("the latest size and the latest focus win", async () => {
  const { outbox, sent } = setup();
  outbox.resize({ width: 300, height: 500, pixelRatio: 3 });
  outbox.resize({ width: 320, height: 520, pixelRatio: 3 });
  outbox.focus({ agentId: "a1" });
  outbox.focus({ agentId: "a2" });

  outbox.ready("s1");

  expect(sent).toEqual([
    {
      streamId: "s1",
      resize: { width: 320, height: 520, pixelRatio: 3 },
      focus: { agentId: "a2" },
    },
  ]);
});

test("a call carries at most 64 steps; the rest go in the next", async () => {
  const { outbox, sent, answer } = setup();
  outbox.ready("s1");
  outbox.steps(Array.from({ length: 70 }, (_, x) => ({ type: "move" as const, x, y: 0 })));

  await answer();

  expect(MAX_STEPS_PER_CALL).toBe(64);
  expect(sent.map((message) => message.steps?.length)).toEqual([64, 6]);
});

test("a keep-alive is an empty call, and is skipped while a call is in flight", async () => {
  const { outbox, sent, answer } = setup();
  outbox.ready("s1");

  outbox.keepAlive();
  outbox.keepAlive();
  expect(sent).toEqual([{ streamId: "s1" }]);

  await answer();
  expect(sent).toHaveLength(1);
});

test("a host that no longer has the stream is reported once, and nothing more is sent", async () => {
  const { outbox, sent, lost, answer } = setup();
  outbox.ready("s1");
  outbox.keepAlive();

  await answer(false);
  outbox.shown(9);

  expect(lost).toEqual(["The host no longer has this 3D view"]);
  expect(sent).toHaveLength(1);
});

test("a call that fails is reported with its reason", async () => {
  const lost: string[] = [];
  const outbox = createStreamOutbox({
    send: async () => {
      throw new Error("Host disconnected");
    },
    onLost: (reason) => lost.push(reason),
  });
  outbox.ready("s1");
  outbox.keepAlive();
  await new Promise((resolve) => setImmediate(resolve));

  expect(lost).toEqual(["Host disconnected"]);
});

test("after stop nothing is sent", () => {
  const { outbox, sent } = setup();
  outbox.ready("s1");

  outbox.stop();
  outbox.shown(1);
  outbox.keepAlive();

  expect(sent).toEqual([]);
});
