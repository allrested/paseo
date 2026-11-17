import { expect, test } from "vitest";
import type { Checklists } from "../shared/contracts.js";
import {
  ACTIVITY_INTERVAL_MS,
  callsIn,
  describeActivity,
  describeStep,
  nextStep,
  readChecklist,
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

test("a deploy script, a make or just target, a Dokploy redeploy and a deploy workflow are deploys", () => {
  const shell = (command: string) => kindOf({ type: "shell", command });
  // A script whose file name starts with deploy, run.
  expect(shell("scripts/deploy.sh pos web")).toBe("deploy");
  expect(shell("./deploy-prod.mjs")).toBe("deploy");
  expect(shell("cd infra && ./deploy.sh --env prod")).toBe("deploy");
  expect(shell("bash scripts/deploy.sh")).toBe("deploy");
  expect(shell("node tools/deploy-web.mjs")).toBe("deploy");
  expect(shell("npx tsx scripts/deploy.ts")).toBe("deploy");
  expect(shell("ENV=prod sudo -E ./bin/deploy")).toBe("deploy");
  // A target.
  expect(shell("make deploy")).toBe("deploy");
  expect(shell("make -C infra deploy-prod")).toBe("deploy");
  expect(shell("just deploy staging")).toBe("deploy");
  // A Dokploy API's method.
  expect(
    shell("curl -sX POST https://dokploy.example.com/api/compose.redeploy -d @body.json"),
  ).toBe("deploy");
  expect(shell("curl -X POST $DOKPLOY/api/application.deploy")).toBe("deploy");
  expect(shell("curl $DOKPLOY/api/trpc/compose.deploy")).toBe("deploy");
  expect(shell("curl $DOKPLOY/api/application.redeploy")).toBe("deploy");
  // A workflow run.
  expect(shell("gh workflow run deploy.yml --ref main")).toBe("deploy");
  expect(shell('gh workflow run "Release app" -f channel=beta')).toBe("deploy");
  expect(shell("gh workflow run .github/workflows/Deploy-prod.yml")).toBe("deploy");
  // A command after another, or after a prefix.
  expect(shell("cd infra && make deploy")).toBe("deploy");
  expect(shell("FOO=1 just deploy-prod")).toBe("deploy");
  expect(shell("sudo make deploy")).toBe("deploy");
  expect(shell("curl -X POST \"$DOKPLOY_URL/api/compose.deploy\" -d '{}'")).toBe("deploy");
  expect(shell("cd .. && gh workflow run deploy.yml --ref main")).toBe("deploy");
});

test("a command that only names a deploy is not one", () => {
  const shell = (command: string) => kindOf({ type: "shell", command });
  expect(shell("git push origin feat/deploy-button")).toBe("push");
  expect(shell("make build")).toBe("command");
  expect(shell("make -f deploy.mk build")).toBe("command");
  expect(shell("make deployment-docs")).toBe("command");
  expect(shell("cat scripts/deploy.sh")).toBe("command");
  expect(shell("chmod +x build.sh deploy.sh")).toBe("command");
  expect(shell("ls deploy/")).toBe("command");
  expect(shell("deploy/run.sh")).toBe("command");
  expect(shell("npx vitest run scripts/deploy.test.ts")).toBe("test");
  expect(shell("curl $DOKPLOY/api/compose.one?composeId=1")).toBe("command");
  expect(shell("curl $DOKPLOY/api/application.deployments")).toBe("command");
  expect(shell("gh workflow run ci.yml -f target=release")).toBe("command");
  expect(shell("gh workflow list")).toBe("command");
  // A deploy's words in a message or a search are not a command.
  expect(shell("git commit -m 'make deploy fix'")).toBe("commit");
  expect(shell("echo make deploy")).toBe("command");
  expect(shell("grep application.deploy README.md")).toBe("command");
  expect(shell('git commit -m "gh workflow run deploy.yml"')).toBe("commit");
});

test("a deploy run as a check or a dry run is a command", () => {
  const shell = (command: string) => kindOf({ type: "shell", command });
  expect(shell("scripts/deploy.sh --check")).toBe("command");
  expect(shell("scripts/deploy.sh pos --dry-run")).toBe("command");
  expect(shell("./deploy-prod.mjs -n")).toBe("command");
  expect(shell("make -n deploy")).toBe("command");
  expect(shell("make -C infra deploy-prod --dry-run")).toBe("command");
  expect(shell("just --list deploy")).toBe("command");
  expect(shell("just -n deploy staging")).toBe("command");
  expect(shell("kubectl apply --dry-run=client -f k8s/")).toBe("command");
  expect(shell("npm publish --dry-run")).toBe("command");
  expect(shell("make --just-print deploy")).toBe("command");
  // `sudo -n` asks for no password: the deploy runs.
  expect(shell("sudo -n scripts/deploy.sh pos")).toBe("deploy");
  expect(shell("sudo -n make deploy")).toBe("deploy");
  // To kubectl and helm `-n` names a namespace.
  expect(shell("kubectl apply -n prod -f k8s/")).toBe("deploy");
  expect(shell("helm upgrade -n prod api ./chart")).toBe("deploy");
  // A flag that only starts like one.
  expect(shell("scripts/deploy.sh --check-health")).toBe("deploy");
  // The real deploy after its dry run.
  expect(shell("make -n deploy && make deploy")).toBe("deploy");
  expect(shell("scripts/deploy.sh --check; scripts/deploy.sh pos")).toBe("deploy");
});

test("a tool whose own name starts with deploy, release, publish or rollout is a deploy", () => {
  const named = (name: string) => kindOf({ type: "unknown" }, { name });
  expect(named("mcp__flavours-observability__deploy_service")).toBe("deploy");
  expect(named("deploy")).toBe("deploy");
  expect(named("Deploy-App")).toBe("deploy");
  expect(named("mcp__ci__release_create")).toBe("deploy");
  expect(named("mcp__npm__publish")).toBe("deploy");
  expect(named("rollout-restart")).toBe("deploy");
  // The word further in, or as the start of a longer one, is not.
  expect(named("get_deploy_status")).toBe("tool");
  expect(named("mcp__deploy__list_services")).toBe("tool");
  expect(named("deployments_list")).toBe("tool");
  expect(named("mcp__flavours-observability__service_health")).toBe("tool");
  expect(named("published_posts")).toBe("tool");
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
  // A plain command has no result.
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

const deploy = (patch: Partial<ActivityItem> = {}, exitCode?: number) =>
  call({ type: "shell", command: "scripts/deploy.sh pos", exitCode }, { callId: "d1", ...patch });

test("a deploy says how it ended, as a test run does", () => {
  expect(describeStep([deploy()])).toEqual({ kind: "deploy", key: "d1" });
  expect(describeStep([deploy({ status: "completed" }, 0)])).toEqual({
    kind: "deploy",
    key: "d1",
    result: "passed",
  });
  expect(describeStep([deploy({ status: "completed" }, 1)])?.result).toBe("failed");
  expect(describeStep([deploy({ status: "failed" })])?.result).toBe("failed");
  expect(describeStep([deploy({ status: "canceled" })])).toEqual({ kind: "deploy", key: "d1" });
  // Cancelled with the exit code a killed process leaves: not a failure.
  expect(describeStep([deploy({ status: "canceled" }, 130)])).toEqual({
    kind: "deploy",
    key: "d1",
  });
  expect(describeStep([tests({ status: "canceled" }, 130)])).toEqual({ kind: "test", key: "t1" });
  // A deploy tool has no exit code: the call's status says.
  const tool = (status: string) =>
    describeStep([
      call({ type: "unknown" }, { name: "mcp__ops__deploy_service", callId: "d2", status }),
    ]);
  expect(tool("running")).toEqual({ kind: "deploy", key: "d2" });
  expect(tool("completed")).toEqual({ kind: "deploy", key: "d2", result: "passed" });
  expect(tool("failed")).toEqual({ kind: "deploy", key: "d2", result: "failed" });
});

test("a deploy that ended while nobody read is reported before what came after it", () => {
  const running: ActivityStep = { kind: "deploy", key: "d1" };
  const after = [deploy({ status: "completed" }, 0), { type: "assistant_message" }];
  expect(nextStep(running, after)).toEqual({ kind: "deploy", key: "d1", result: "passed" });
  expect(nextStep(running, [deploy({ status: "failed" }), { type: "reasoning" }])).toEqual({
    kind: "deploy",
    key: "d1",
    result: "failed",
  });
  // Once told, the newest item counts again.
  expect(nextStep({ ...running, result: "passed" }, after)).toBe(null);
  // Still running, cancelled, or out of the tail: nothing is made up.
  expect(nextStep(running, [deploy()])).toEqual(running);
  expect(nextStep(running, [deploy({ status: "canceled" }), { type: "reasoning" }])).toBe(null);
  expect(nextStep(running, [call({ type: "read", filePath: "a" })])).toEqual({
    kind: "read",
    key: "c1",
  });
});

const search = (callId: string, patch: Partial<ActivityItem> = {}) =>
  call(
    { type: "search", query: "x", toolName: "web_search" },
    { callId, status: "completed", ...patch },
  );
const wrote: ActivityItem = { type: "assistant_message" };

test("a call made and ended since the last read is still the step, once", () => {
  const before = callsIn([call({ type: "read", filePath: "a" }, { callId: "r1" })]);
  const tail = [call({ type: "read", filePath: "a" }, { callId: "r1" }), search("w1"), wrote];
  // The agent went back to writing, but the search is new since the last read.
  expect(describeStep(tail, before)).toEqual({ kind: "web", key: "w1" });
  expect(describeStep([search("w1"), { type: "reasoning" }, wrote], before)).toEqual({
    kind: "web",
    key: "w1",
  });
  // The read after it has seen the call: it is not told again.
  expect(describeStep(tail, callsIn(tail))).toBe(null);
  // Without a read before there is no "since": an office just opened tells no old call.
  expect(describeStep(tail)).toBe(null);
  expect(callsIn(tail)).toEqual(new Set(["r1", "w1"]));
});

test("of several calls between two reads the newest is the step", () => {
  const tail = [search("w1"), wrote, call({ type: "fetch", url: "u" }, { callId: "f1" }), wrote];
  expect(describeStep(tail, new Set())).toEqual({ kind: "web", key: "f1" });
  // Only the newest call is looked at: an older new one behind a seen one is not dug up.
  expect(describeStep(tail, new Set(["f1"]))).toBe(null);
});

test("a prompt after a call is a new turn, and a call without an id cannot be told apart", () => {
  expect(describeStep([search("w1"), { type: "user_message" }], new Set())).toBe(null);
  expect(describeStep([search("w1"), wrote, { type: "user_message" }, wrote], new Set())).toBe(
    null,
  );
  expect(describeStep([search("w1", { callId: undefined }), wrote], new Set())).toBe(null);
  // The newest item is still a step whatever was seen: the agent is at it now.
  expect(describeStep([wrote, search("w1")], new Set(["w1"]))).toEqual({ kind: "web", key: "w1" });
});

test("a test run or a deploy that came and went between two reads says how it ended", () => {
  const ran = [tests({ status: "completed" }, 1), wrote];
  expect(describeStep(ran, new Set())).toEqual({ kind: "test", key: "t1", result: "failed" });
  expect(nextStep(undefined, ran, new Set())).toEqual({
    kind: "test",
    key: "t1",
    result: "failed",
  });
  // The look-back for a run last seen running is as it was, with a newer call behind it or not.
  const running: ActivityStep = { kind: "test", key: "t1" };
  expect(nextStep(running, ran, new Set(["t1"]))).toEqual({ ...running, result: "failed" });
  expect(
    nextStep(running, [tests({ status: "completed" }, 0), search("w1"), wrote], new Set(["t1"])),
  ).toEqual({ ...running, result: "passed" });
});

test("a checklist is the newest todo item's unfinished steps", () => {
  const items = [
    { type: "todo", items: [{ text: "Old", completed: false }] },
    { type: "tool_call", name: "Edit", status: "completed" },
    {
      type: "todo",
      items: [
        { text: "Write the test", completed: true },
        { text: "Lint", completed: true, status: "in_progress" },
        { text: "Run typecheck", completed: false, status: "in_progress" },
        { text: "Commit", completed: false, status: "completed" },
        { text: "Open the PR", completed: false },
      ],
    },
  ];
  expect(readChecklist(items)).toEqual([
    { text: "Run typecheck", status: "in_progress" },
    { text: "Open the PR", status: "pending" },
  ]);
});

test("a tail without a todo item has no checklist; an all-finished one is empty", () => {
  expect(readChecklist([{ type: "assistant_message" }])).toBeNull();
  expect(readChecklist([{ type: "todo", items: [{ text: "x", completed: true }] }])).toEqual([]);
});

test("bad steps are skipped, text is one line of 200 at most, 50 steps at most", () => {
  const long = "a".repeat(5000);
  const steps = readChecklist([
    {
      type: "todo",
      items: [
        { text: 7, completed: false },
        null,
        { text: "  \n second line", completed: false },
        { text: "First\nSecond", completed: false },
        { text: long, completed: false },
        ...Array.from({ length: 80 }, (_, i) => ({ text: `s${i}`, completed: false })),
      ],
    },
  ]);
  expect(steps?.[0]).toEqual({ text: "First", status: "pending" });
  expect(steps?.[1].text).toBe(`${"a".repeat(199)}…`);
  expect(steps).toHaveLength(50);
  // The cap counts the steps kept: the two cut ones and the first 48 short ones.
  expect(steps?.at(-1)).toEqual({ text: "s47", status: "pending" });
  expect(readChecklist([{ type: "todo", items: "nope" }])).toEqual([]);
});

interface PollerHarness {
  clock: FakeClock;
  running: string[];
  tails: Map<string, ActivityItem[]>;
  reads: string[];
  changes: Record<string, string>[];
  steps: Record<string, ActivityStep>[];
  checklists: Checklists[];
  logs: string[];
  poller: ActivityPoller;
}

function startHarness(running: string[], tails: Map<string, ActivityItem[]>): PollerHarness {
  const clock = createFakeClock();
  const reads: string[] = [];
  const changes: Record<string, string>[] = [];
  const steps: Record<string, ActivityStep>[] = [];
  const checklists: Checklists[] = [];
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
    onChange: (activity, doing, report) => {
      changes.push({ ...activity });
      steps.push({ ...doing });
      checklists.push({ ...report });
    },
  });
  return { clock, running, tails, reads, changes, steps, checklists, logs, poller };
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

test("a search that ended between two reads is reported for one read", async () => {
  const tails = new Map<string, ActivityItem[]>([["a", [{ type: "reasoning" }]]]);
  const harness = startHarness(["a"], tails);
  await settle();
  tails.set("a", [{ type: "reasoning" }, search("w1"), wrote]);
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  // The next call is not blocked by it.
  tails.set("a", [search("w1"), wrote, search("w2"), wrote]);
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();

  expect(harness.steps).toEqual([
    {},
    { a: { kind: "web", key: "w1" } },
    {},
    { a: { kind: "web", key: "w2" } },
  ]);
  harness.poller.stop();
});

test("a call held back for a test run's end is told on the read after it", async () => {
  const tails = new Map<string, ActivityItem[]>([["a", [tests()]]]);
  const harness = startHarness(["a"], tails);
  await settle();
  tails.set("a", [tests({ status: "completed" }, 0), search("w1"), wrote]);
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();

  expect(harness.steps).toEqual([
    { a: { kind: "test", key: "t1" } },
    { a: { kind: "test", key: "t1", result: "passed" } },
    { a: { kind: "web", key: "w1" } },
    {},
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

test("the poller reports checklists, and a checklist change alone is a change", async () => {
  const todo = (texts: string[], completed = false): ActivityItem => ({
    type: "todo",
    items: texts.map((text) => ({ text, completed })),
  });
  const tails = new Map<string, ActivityItem[]>([
    ["a", [todo(["Write the test"]), { type: "reasoning" }]],
    ["c", [{ type: "reasoning" }]],
  ]);
  // b has no timeline: its read rejects. c's tail has no todo item.
  const harness = startHarness(["a", "b", "c"], tails);
  await settle();
  // The same steps read again are no change.
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  tails.set("a", [todo(["Write the test", "Commit"]), { type: "reasoning" }]);
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  // Every step finished: the agent is reported with none.
  tails.set("a", [todo(["Write the test", "Commit"], true), { type: "reasoning" }]);
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();

  const lines = { a: "Thinking", c: "Thinking" };
  expect(harness.changes).toEqual([lines, lines, lines]);
  expect(harness.steps).toEqual([{}, {}, {}]);
  expect(harness.checklists).toEqual([
    { a: [{ text: "Write the test", status: "pending" }] },
    {
      a: [
        { text: "Write the test", status: "pending" },
        { text: "Commit", status: "pending" },
      ],
    },
    { a: [] },
  ]);
  harness.poller.stop();
});

test("an agent that stopped since the last round is read once more, for its checklist only", async () => {
  const todo = (completed: boolean): ActivityItem => ({
    type: "todo",
    items: [{ text: "Write the test", completed }],
  });
  const running = ["a"];
  const tails = new Map<string, ActivityItem[]>([["a", [todo(false), { type: "reasoning" }]]]);
  const harness = startHarness(running, tails);
  await settle();
  // a ticked its last step, ran one more call and stopped, all between two reads.
  tails.set("a", [todo(true), call({ type: "shell", command: "ls" }), wrote]);
  running.length = 0;
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();

  expect(harness.reads).toEqual(["a", "a"]);
  expect(harness.changes.slice(0, 2)).toEqual([{ a: "Thinking" }, {}]);
  expect(harness.steps.slice(0, 2)).toEqual([{}, {}]);
  expect(harness.checklists.slice(0, 2)).toEqual([
    { a: [{ text: "Write the test", status: "pending" }] },
    { a: [] },
  ]);
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
