import { expect, test } from "vitest";
import {
  ACTIVITY_INTERVAL_MS,
  describeActivity,
  startActivityPoller,
  type ActivityItem,
  type ActivityPoller,
} from "./activity.js";
import { createFakeClock, settle, type FakeClock } from "./fake-clock.js";

test("names the newest item it knows", () => {
  expect(
    describeActivity([
      { type: "user_message" },
      { type: "tool_call", name: "Bash", status: "running" },
    ]),
  ).toBe("Running Bash");
  expect(describeActivity([{ type: "tool_call", name: "Read", status: "completed" }])).toBe(
    "Ran Read",
  );
  expect(
    describeActivity([
      { type: "tool_call", name: "Read", status: "completed" },
      { type: "assistant_message" },
    ]),
  ).toBe("Writing a reply");
  expect(describeActivity([{ type: "reasoning" }])).toBe("Thinking");
  expect(describeActivity([{ type: "user_message" }, { type: "todo" }])).toBe("Reading the prompt");
  expect(describeActivity([{ type: "todo" }])).toBe(null);
  expect(describeActivity([])).toBe(null);
});

test("shows a tool name only when it looks like an identifier", () => {
  const running = (name: unknown) =>
    describeActivity([{ type: "tool_call", name, status: "running" }]);
  expect(running("Bash")).toBe("Running Bash");
  expect(running("mcp__paseo__list_agents")).toBe("Running mcp__paseo__list_agents");
  expect(running("x".repeat(60))).toBe(`Running ${"x".repeat(60)}`);
  expect(running("x".repeat(61))).toBe("Running a tool");
  expect(running("rm -rf /tmp/x")).toBe("Running a tool");
  expect(running(`/home/user/${"dir/".repeat(20)}file.ts`)).toBe("Running a tool");
  expect(running("")).toBe("Running a tool");
  expect(running("Bash\nrm -rf x")).toBe("Running a tool");
  expect(describeActivity([{ type: "tool_call", name: "Read file", status: "completed" }])).toBe(
    "Ran a tool",
  );
});

interface PollerHarness {
  clock: FakeClock;
  running: string[];
  tails: Map<string, ActivityItem[]>;
  reads: string[];
  changes: Record<string, string>[];
  logs: string[];
  poller: ActivityPoller;
}

function startHarness(running: string[], tails: Map<string, ActivityItem[]>): PollerHarness {
  const clock = createFakeClock();
  const reads: string[] = [];
  const changes: Record<string, string>[] = [];
  const logs: string[] = [];
  const poller = startActivityPoller({
    running: () => running,
    tail: async (agentId) => {
      reads.push(agentId);
      const items = tails.get(agentId);
      if (!items) throw new Error(`no timeline for ${agentId}`);
      return items;
    },
    timers: clock,
    log: (message) => logs.push(message),
    onChange: (activity) => changes.push({ ...activity }),
  });
  return { clock, running, tails, reads, changes, logs, poller };
}

test("reads each running agent once per interval and reports only changes", async () => {
  const tails = new Map<string, ActivityItem[]>([
    ["a", [{ type: "tool_call", name: "Bash", status: "running" }]],
  ]);
  const harness = startHarness(["a"], tails);
  await settle();
  expect(harness.changes).toEqual([{ a: "Running Bash" }]);

  harness.clock.advance(ACTIVITY_INTERVAL_MS - 1);
  await settle();
  expect(harness.reads).toEqual(["a"]);

  harness.clock.advance(1);
  await settle();
  expect(harness.reads).toEqual(["a", "a"]);
  expect(harness.changes).toEqual([{ a: "Running Bash" }]);

  tails.set("a", [{ type: "assistant_message" }]);
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  expect(harness.changes).toEqual([{ a: "Running Bash" }, { a: "Writing a reply" }]);
  harness.poller.stop();
});

test("an agent that stops running loses its line", async () => {
  const running = ["a"];
  const harness = startHarness(running, new Map([["a", [{ type: "reasoning" }]]]));
  await settle();
  running.length = 0;
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  expect(harness.changes).toEqual([{ a: "Thinking" }, {}]);
  harness.poller.stop();
});

test("a failed read keeps the agent's last line and is logged", async () => {
  const tails = new Map<string, ActivityItem[]>([["a", [{ type: "reasoning" }]]]);
  const harness = startHarness(["a"], tails);
  await settle();
  tails.delete("a");
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  expect(harness.changes).toEqual([{ a: "Thinking" }]);
  expect(harness.logs).toEqual(["[office] activity of a: no timeline for a"]);
  harness.poller.stop();
});

test("stop ends the reads and leaves no timer", async () => {
  const harness = startHarness(["a"], new Map([["a", [{ type: "reasoning" }]]]));
  await settle();
  harness.poller.stop();
  harness.clock.advance(ACTIVITY_INTERVAL_MS * 3);
  await settle();
  expect(harness.reads).toEqual(["a"]);
  expect(harness.clock.pending()).toBe(0);
});

test("a throwing port is logged and the poller keeps going", async () => {
  const clock = createFakeClock();
  const logs: string[] = [];
  let calls = 0;
  const poller = startActivityPoller({
    running: () => {
      calls += 1;
      if (calls === 1) throw new Error("directory gone");
      return [];
    },
    tail: async () => [],
    timers: clock,
    log: (message) => logs.push(message),
    onChange: () => {},
  });
  await settle();
  expect(logs).toEqual(["[office] activity failed: directory gone"]);
  expect(clock.pending()).toBe(1);
  clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  expect(calls).toBe(2);
  poller.stop();
});

test("a read that fails after stop is not logged and changes nothing", async () => {
  const clock = createFakeClock();
  const logs: string[] = [];
  const changes: Record<string, string>[] = [];
  const rejects: ((error: Error) => void)[] = [];
  const poller = startActivityPoller({
    running: () => ["a"],
    tail: () =>
      new Promise<readonly ActivityItem[]>((_resolve, reject) => {
        rejects.push(reject);
      }),
    timers: clock,
    log: (message) => logs.push(message),
    onChange: (activity) => changes.push({ ...activity }),
  });
  await settle();
  poller.stop();
  rejects[0]?.(new Error("late failure"));
  await settle();
  expect(logs).toEqual([]);
  expect(changes).toEqual([]);
  expect(clock.pending()).toBe(0);
});
