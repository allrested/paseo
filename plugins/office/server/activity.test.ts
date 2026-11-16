import { expect, test } from "vitest";
import {
  ACTIVITY_INTERVAL_MS,
  describeActivity,
  describeStep,
  nextStep,
  startActivityPoller,
  type ActivityItem,
  type ActivityPoller,
  type ActivityStep,
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

const call = (detail: unknown, patch: Partial<ActivityItem> = {}): ActivityItem => ({
  type: "tool_call",
  name: "Tool",
  status: "running",
  callId: "c1",
  detail,
  ...patch,
});
const kindOf = (detail: unknown, patch?: Partial<ActivityItem>) =>
  describeStep([call(detail, patch)])?.kind ?? null;

test("a tool call is a step with the kind of work it is, and the call's own key", () => {
  expect(describeStep([call({ type: "read", filePath: "/repo/secret.env" })])).toEqual({
    kind: "read",
    key: "c1",
  });
  expect(kindOf({ type: "edit", filePath: "a.ts" })).toBe("edit");
  expect(kindOf({ type: "write", filePath: "a.ts" })).toBe("write");
  expect(kindOf({ type: "search", query: "x", toolName: "grep" })).toBe("search");
  expect(kindOf({ type: "search", query: "x", toolName: "glob" })).toBe("search");
  expect(kindOf({ type: "search", query: "x", toolName: "web_search" })).toBe("web");
  expect(kindOf({ type: "fetch", url: "https://example.com" })).toBe("web");
  expect(kindOf({ type: "sub_agent" })).toBe("subagent");
  expect(kindOf({ type: "plan" })).toBe("plan");
});

test("a command is told apart by what it starts: tests, a commit, a push, a deploy", () => {
  const shell = (command: string) => kindOf({ type: "shell", command });
  expect(shell("ls -la")).toBe("command");
  expect(shell("npm run test -- --bail=1")).toBe("test");
  expect(shell("cd plugins && npx vitest run office")).toBe("test");
  expect(shell("pytest -q tests/unit")).toBe("test");
  expect(shell("git commit -m 'fix: the limiter'")).toBe("commit");
  expect(shell("git push origin main")).toBe("push");
  expect(shell("git push origin v1.4.0")).toBe("deploy");
  expect(shell("git push --tags")).toBe("deploy");
  expect(shell("npm run deploy")).toBe("deploy");
  expect(shell("kubectl apply -f k8s/")).toBe("deploy");
  expect(shell("terraform apply -auto-approve")).toBe("deploy");
  expect(shell("vercel --prod")).toBe("deploy");
  expect(shell("gh release create v2.0.0 --notes-file notes.md")).toBe("deploy");
});

test("a tool the host has no kind for is placed by its name", () => {
  const named = (name: string) => kindOf({ type: "unknown" }, { name });
  expect(named("mcp__paseo__list_agents")).toBe("tool");
  expect(named("TodoWrite")).toBe("plan");
  expect(named("Task")).toBe("subagent");
  expect(named("WebSearch")).toBe("web");
  expect(named("SomethingElse")).toBe("tool");
  expect(kindOf(undefined, { name: "Bash" })).toBe("tool");
});

test("opening a skill, reading or writing a SKILL.md, or a command that names one is a skill", () => {
  expect(
    kindOf({ type: "plain_text", label: "brainstorming", icon: "sparkles" }, { name: "Skill" }),
  ).toBe("skill");
  expect(kindOf({ type: "read", filePath: "/home/me/.claude/skills/release/SKILL.md" })).toBe(
    "skill",
  );
  expect(kindOf({ type: "write", filePath: ".claude/skills/release/SKILL.md" })).toBe("skill");
  expect(kindOf({ type: "edit", filePath: "SKILL.md" })).toBe("skill");
  expect(kindOf({ type: "shell", command: "cat ~/.agents/skills/release/SKILL.md" })).toBe("skill");
  // (a file that only ends like one, and a test run that mentions one, are not)
  expect(kindOf({ type: "read", filePath: "docs/MY-SKILL.md" })).toBe("read");
  expect(kindOf({ type: "shell", command: "npx vitest run skills/SKILL.md.test.ts" })).toBe("test");
});

test("only the newest item counts, and only when it is a tool call", () => {
  expect(describeStep([call({ type: "read", filePath: "a" }), { type: "assistant_message" }])).toBe(
    null,
  );
  expect(describeStep([{ type: "user_message" }])).toBe(null);
  expect(
    describeStep([
      call({ type: "read", filePath: "a" }),
      call({ type: "shell", command: "ls" }, { callId: "c2" }),
      { type: "todo" },
    ]),
  ).toEqual({ kind: "command", key: "c2" });
  // A provider that numbers no calls: the kind is all that can change.
  expect(describeStep([call({ type: "edit", filePath: "a" }, { callId: undefined })])).toEqual({
    kind: "edit",
    key: "edit",
  });
  expect(describeStep([])).toBe(null);
});

const tests = (patch: Partial<ActivityItem> = {}, exitCode?: number) =>
  call({ type: "shell", command: "npx vitest run office", exitCode }, { callId: "t1", ...patch });

test("a test run says how it ended, by its exit code when the host has one", () => {
  expect(describeStep([tests()])).toEqual({ kind: "test", key: "t1" });
  expect(describeStep([tests({ status: "completed" })])).toEqual({
    kind: "test",
    key: "t1",
    result: "passed",
  });
  expect(describeStep([tests({ status: "completed" }, 0)])?.result).toBe("passed");
  expect(describeStep([tests({ status: "completed" }, 1)])?.result).toBe("failed");
  expect(describeStep([tests({ status: "failed" })])?.result).toBe("failed");
  expect(describeStep([tests({ status: "canceled" })])).toEqual({ kind: "test", key: "t1" });
  // Only a test run has a result.
  expect(describeStep([call({ type: "shell", command: "ls" }, { status: "failed" })])).toEqual({
    kind: "command",
    key: "c1",
  });
});

test("a test run that ended while nobody read is reported before what came after it", () => {
  const running: ActivityStep = { kind: "test", key: "t1" };
  const after = [tests({ status: "failed" }), { type: "assistant_message" }];
  expect(nextStep(running, after)).toEqual({ kind: "test", key: "t1", result: "failed" });
  // Once told, the newest item counts again.
  expect(nextStep({ ...running, result: "failed" }, after)).toBe(null);
  // Still running, cancelled, or out of the tail: nothing is made up.
  expect(nextStep(running, [tests()])).toEqual(running);
  expect(nextStep(running, [tests({ status: "canceled" }), { type: "reasoning" }])).toBe(null);
  expect(nextStep(running, [call({ type: "read", filePath: "a" })])).toEqual({
    kind: "read",
    key: "c1",
  });
  // A provider that numbers no calls cannot be looked up.
  expect(nextStep({ kind: "test", key: "test" }, after)).toBe(null);
  expect(nextStep(undefined, [tests()])).toEqual(running);
});

interface PollerHarness {
  clock: FakeClock;
  running: string[];
  tails: Map<string, ActivityItem[]>;
  reads: string[];
  changes: Record<string, string>[];
  steps: Record<string, ActivityStep>[];
  logs: string[];
  poller: ActivityPoller;
}

function startHarness(running: string[], tails: Map<string, ActivityItem[]>): PollerHarness {
  const clock = createFakeClock();
  const reads: string[] = [];
  const changes: Record<string, string>[] = [];
  const steps: Record<string, ActivityStep>[] = [];
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
    onChange: (activity, doing) => {
      changes.push({ ...activity });
      steps.push({ ...doing });
    },
  });
  return { clock, running, tails, reads, changes, steps, logs, poller };
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

test("a new call of the same tool is a change: the line stays, the step moves on", async () => {
  const tails = new Map<string, ActivityItem[]>([
    ["a", [call({ type: "read", filePath: "a" }, { name: "Read" })]],
  ]);
  const harness = startHarness(["a"], tails);
  await settle();
  tails.set("a", [call({ type: "read", filePath: "b" }, { name: "Read", callId: "c2" })]);
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  tails.set("a", [{ type: "assistant_message" }]);
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();

  expect(harness.changes).toEqual([
    { a: "Running Read" },
    { a: "Running Read" },
    { a: "Writing a reply" },
  ]);
  expect(harness.steps).toEqual([
    { a: { kind: "read", key: "c1" } },
    { a: { kind: "read", key: "c2" } },
    {},
  ]);
  harness.poller.stop();
});

test("a test run's end is a change, and holds the next step back for one read", async () => {
  const tails = new Map<string, ActivityItem[]>([["a", [tests()]]]);
  const harness = startHarness(["a"], tails);
  await settle();
  const edit = call({ type: "edit", filePath: "a" }, { callId: "c2" });
  tails.set("a", [tests({ status: "completed" }), edit]);
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();

  expect(harness.steps).toEqual([
    { a: { kind: "test", key: "t1" } },
    { a: { kind: "test", key: "t1", result: "passed" } },
    { a: { kind: "edit", key: "c2" } },
  ]);
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
