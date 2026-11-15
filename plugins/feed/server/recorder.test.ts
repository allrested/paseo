import { expect, test } from "vitest";
import { permissionEntry, turnEntry, type FeedAgent, type RecorderPorts } from "./recorder.js";
import type { TimelineEntry } from "./summary.js";

const AGENT: FeedAgent = {
  id: "a1",
  title: "Checkout total",
  cwd: "/work/shop",
  background: false,
};
const HELPER: FeedAgent = { ...AGENT, id: "h1", background: true };

function ports(tail: RecorderPorts["tail"] = async () => []) {
  const logs: string[] = [];
  const asked: string[] = [];
  let ids = 0;
  const made: RecorderPorts = {
    now: () => "2026-11-15T09:00:00.000Z",
    newId: () => `id-${(ids += 1)}`,
    tail: (agentId) => {
      asked.push(agentId);
      return tail(agentId);
    },
    log: (message) => logs.push(message),
  };
  return { made, logs, asked };
}

const said = (text: string, turnId: string): TimelineEntry => ({
  turnId,
  item: { type: "assistant_message", text },
});

test("a finished turn's entry carries the first line of what the agent said last", async () => {
  const { made, asked } = ports(async () => [
    said("Earlier.", "t1"),
    said("## Fixed the rounding\n\nTax is now added after it.", "t2"),
  ]);

  expect(
    await turnEntry(made, { agent: AGENT, turnId: "t2", outcome: { kind: "completed" } }),
  ).toEqual({
    id: "id-1",
    at: "2026-11-15T09:00:00.000Z",
    kind: "finished",
    agentId: "a1",
    title: "Checkout total",
    folder: "/work/shop",
    text: "Fixed the rounding",
  });
  expect(asked).toEqual(["a1"]);
});

test("a finished turn with no message, or one that cannot be read, still has its entry", async () => {
  const quiet = ports();
  expect(
    await turnEntry(quiet.made, { agent: AGENT, turnId: "t2", outcome: { kind: "completed" } }),
  ).toMatchObject({
    kind: "finished",
    text: null,
  });

  const broken = ports(async () => {
    throw new Error("agent is gone");
  });
  expect(
    await turnEntry(broken.made, { agent: AGENT, turnId: "t2", outcome: { kind: "completed" } }),
  ).toMatchObject({
    kind: "finished",
    text: null,
  });
  expect(broken.logs).toEqual(["[feed] the last message of a1 could not be read: agent is gone"]);
});

test("a failed turn's entry carries the error, and reads no timeline", async () => {
  const { made, asked } = ports();
  const outcome = {
    kind: "failed" as const,
    error: { message: "Rate limit reached\nretry later" },
  };

  expect(await turnEntry(made, { agent: AGENT, turnId: "t2", outcome })).toMatchObject({
    kind: "failed",
    text: "Rate limit reached",
  });
  expect(asked).toEqual([]);
});

test("a stopped turn and a helper's turn are no news", async () => {
  const { made, asked } = ports();
  const stopped = { kind: "canceled" as const, reason: "interrupted" };

  expect(await turnEntry(made, { agent: AGENT, turnId: "t2", outcome: stopped })).toBeNull();
  expect(
    await turnEntry(made, { agent: HELPER, turnId: "t2", outcome: { kind: "completed" } }),
  ).toBeNull();
  expect(asked).toEqual([]);
});

test("a permission's entry says what is asked and keeps the request's id", () => {
  const { made } = ports();
  const request = { id: "req-1", name: "Bash", title: "Run npm install" };

  expect(permissionEntry(made, { agent: AGENT, request })).toEqual({
    id: "id-1",
    at: "2026-11-15T09:00:00.000Z",
    kind: "permission",
    agentId: "a1",
    title: "Checkout total",
    folder: "/work/shop",
    text: "Run npm install",
    requestId: "req-1",
  });
  expect(
    permissionEntry(made, { agent: AGENT, request: { id: "req-2", name: "Bash" } })?.text,
  ).toBe("Bash");
  expect(permissionEntry(made, { agent: HELPER, request })).toBeNull();
});
