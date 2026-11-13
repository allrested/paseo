import { expect, test } from "vitest";
import type { AndroidInput } from "../shared/contracts.js";
import { MAX_QUEUED, STREAM_GONE, createStreamOutbox } from "./stream-outbox.js";

interface Answer {
  ok: boolean;
  message?: string;
}

function setup() {
  const sent: AndroidInput[] = [];
  const settle: Array<{ resolve(answer: Answer): void; reject(error: Error): void }> = [];
  const lost: string[] = [];
  const refused: string[] = [];
  const outbox = createStreamOutbox({
    send: (message) => {
      sent.push(message);
      return new Promise<Answer>((resolve, reject) => settle.push({ resolve, reject }));
    },
    onLost: (reason) => lost.push(reason),
    onRefused: (message) => refused.push(message),
  });
  /** Answers the call in flight. */
  async function answer(value: Answer | Error = { ok: true }): Promise<void> {
    const pending = settle.shift();
    if (value instanceof Error) pending?.reject(value);
    else pending?.resolve(value);
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { outbox, sent, lost, refused, answer };
}

test("sends nothing before the stream is ready, then what was said meanwhile", () => {
  const { outbox, sent } = setup();
  outbox.shown(2);
  outbox.keepAlive();
  expect(sent).toEqual([]);

  outbox.ready("s1");

  expect(sent).toEqual([{ streamId: "s1", shown: 2 }]);
});

test("keeps one call in flight; inputs go out in order, one a call, with the newest shown", async () => {
  const { outbox, sent, answer } = setup();
  outbox.ready("s1");
  outbox.input({ tap: { x: 1, y: 2 } });

  outbox.input({ key: "back" });
  outbox.input({ text: "hi" });
  outbox.shown(3);
  outbox.shown(4);
  expect(sent).toHaveLength(1);

  await answer();
  expect(sent[1]).toEqual({ streamId: "s1", shown: 4, key: "back" });
  await answer();
  expect(sent[2]).toEqual({ streamId: "s1", text: "hi" });
  await answer();
  expect(sent).toHaveLength(3);
});

test("a keep-alive sends an empty call, and none while one is in flight", async () => {
  const { outbox, sent, answer } = setup();
  outbox.ready("s1");
  outbox.keepAlive();
  expect(sent).toEqual([{ streamId: "s1" }]);

  outbox.keepAlive();
  expect(sent).toHaveLength(1);
  await answer();
  outbox.keepAlive();
  expect(sent).toHaveLength(2);
});

test("a call the host answers with ok: false loses the stream once", async () => {
  const { outbox, sent, lost, answer } = setup();
  outbox.ready("s1");
  outbox.keepAlive();

  await answer({ ok: false });
  outbox.keepAlive();

  expect(lost).toEqual([STREAM_GONE]);
  expect(sent).toHaveLength(1);
});

test("a call that fails loses the stream with its words", async () => {
  const { outbox, lost, answer } = setup();
  outbox.ready("s1");
  outbox.keepAlive();

  await answer(new Error("link down"));

  expect(lost).toEqual(["link down"]);
});

test("an input the device refused is reported and the stream carries on", async () => {
  const { outbox, sent, lost, refused, answer } = setup();
  outbox.ready("s1");
  outbox.input({ text: "é" });
  outbox.input({ key: "home" });

  await answer({ ok: true, message: "Only printable ASCII can be typed" });

  expect(refused).toEqual(["Only printable ASCII can be typed"]);
  expect(lost).toEqual([]);
  expect(sent).toHaveLength(2);
});

test("a long queue drops the newest inputs", () => {
  const { outbox, sent } = setup();
  outbox.ready("s1");
  for (let index = 0; index < MAX_QUEUED + 5; index++) outbox.input({ tap: { x: index, y: 0 } });

  // One went out at once; the queue holds MAX_QUEUED more.
  expect(sent).toHaveLength(1);
  expect(sent[0]).toEqual({ streamId: "s1", tap: { x: 0, y: 0 } });
});

test("a stopped outbox sends nothing", () => {
  const { outbox, sent } = setup();
  outbox.ready("s1");
  outbox.keepAlive();
  outbox.stop();
  outbox.input({ key: "home" });
  expect(sent).toHaveLength(1);
});
