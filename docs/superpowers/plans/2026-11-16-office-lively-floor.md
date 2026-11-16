# Office lively floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An agent at rest uses the office by day (pool, foosball, the games TV, karaoke, a nap on the sofa, the fish, the arcade, a cup in the dining room, the restroom) and no longer sleeps the day away at its desk; a deploy that succeeds launches the rocket, a failed one gets the failure reaction, and a plain push only the applause.

**Architecture:** Everything is in the office plugin (`plugins/office`). The host's classifier (`server/activity.ts`) recognises four more kinds of deploy and reports a deploy's result as it reports a test run's; the adapter (`client/world/adapter.ts`) turns that into scene events. The 3D scene takes upstream's four games unchanged through `import-upstream.mjs`, and gets two files of Paseo's beside upstream's: `paseo-leisure-plan.js` (the decisions, pure, unit-tested) and `paseo-leisure.js` (moves the people with upstream's own moves), run every frame from the stand-in of `life/nap.js`. The 2D office works a rotation out of the agent's id and the time in `client/pixel/actors.ts`.

**Tech Stack:** TypeScript, React Native (react-native-web in a browser), vitest, the plugin kit (`@getpaseo/plugin/client/ui`), three.js r160 in the vendored scene (plain JavaScript), esbuild (the repo's own, for the scene's bundle).

**Spec:** `docs/superpowers/specs/2026-11-16-office-lively-floor-design.md` (sub-project 2 of `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`).

## Global Constraints

- Work in `/workspace/QFlavours/paseo` on branch `feat/office-lively-floor`. Do not push.
- No commit carries AI attribution: no `Co-Authored-By` trailer, no "Generated with" line.
- Run one test file at a time, from the repo root: `npx vitest run <file> --bail=1`. Never run a whole suite.
- After each task's code: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, then `npm run lint -- <changed .ts/.tsx files outside plugins/office/vendor/>`, then `npm run format:files -- <changed files outside plugins/office/vendor/>`. The pre-commit hook runs the format check, the lint and the full typecheck (about 45 s). `*.test.ts` files are not type-checked in this package; `*.test.tsx` are.
- No upstream file under `plugins/office/vendor/my-office/` is edited by hand. Only Paseo's own files there (`src/office/paseo-*.js`), the stand-ins (files that start with `// PASEO: stand-in`) and `import-upstream.mjs`. Upstream's files come in through `import-upstream.mjs` only. The formatter and the linter skip `plugins/office/vendor/**`; code there keeps upstream's style (single quotes, compact lines).
- DOM access stays in `*.web.ts` files or in effects: the plugin's client is bundled for every platform.
- Never restart or touch the daemon on port 6767. No agent is created or prompted for a check.
- Nothing leaves the host but the kind of a step, the call's id and its result. Never the command or the arguments.
- The snippets of this plan are in `text` fences on purpose: the formatter rewrites code in a fence it knows, and an edit's old text must match its file character for character, indentation included. Copy them as they are.

Binding values from the spec:

- Daytime is 08:00 to 21:00: in the 3D scene by the clock the scene reads (`officeNow`, the viewing device's), in the 2D office by the device's clock. No activity starts outside daytime. Night is unchanged: after 21:00 an agent that has rested 30 minutes goes home by the lift, and comes back for work or at 08:00.
- The gap: a resting agent sits at its desk for 30 to 90 s, its own random length, then gets up for an activity. Its coffee after a turn comes first, as now. After two hours of resting the gap is 10 to 20 minutes, asleep at the desk.
- The activities. With a second free agent: a game (pool, foosball, or a TV match). Karaoke, alone or with one other. Alone: a nap on a sofa seat (3 to 6 minutes, when the TV is not using the seats), feeding the fish, the arcade (1 to 3 minutes), a cup brewed at the coffee machine and drunk at a dining table (2 to 4 minutes), the restroom.
- Choosing: among what is possible now, at random, never the agent's last activity. One agent at a time at the fish, at the arcade, in each restroom stall; one game at a time at each table and at the TV.
- Work: an agent that gets a prompt or waits for the user leaves its activity at once and walks to its desk.
- The bell (`meet()` and a click on the bell): an agent in a solo activity stops where it stands, so the gathering takes it along. A player in a game finishes the game. No activity starts while a gathering is on (`gatheringNow()`), nor with reduced motion.
- Upstream's games keep their own occasional starts. Upstream's midday nap stays out.
- A game starts through its own starter, forced: `billiards(true)`, `tvMatch(true)`, `foosball(true)`, `karaoke(true)`. A starter that declines is a game not started. An activity whose spot is taken or cannot be reached is not started; the agent picks again at its next gap.
- The solo activities' lines, exactly, with no emoji: "Quick nap", "Feeding the fish", "One round at the arcade", "Making a coffee", "Back in a minute". A failed deploy's bubble: "The deploy failed".
- A deploy tool: a tool whose own name starts with `deploy`, `release`, `publish` or `rollout`, followed by the end of the name, `_` or `-`. For an MCP tool the own name is the part after the server's name: `mcp__flavours-observability__deploy_service` is `deploy_service`.
- A deploy script or target: a shell command that runs a script whose file name starts with `deploy` (`scripts/deploy.sh pos …`, `./deploy-prod.mjs`), or `make deploy` / `just deploy` and their `deploy-…` targets.
- A Dokploy redeploy: a command that calls `compose.deploy`, `compose.redeploy`, `application.deploy` or `application.redeploy`.
- A deploy workflow run: `gh workflow run` of a workflow whose name has `deploy` or `release` in it.
- The existing list stays: a push of a version tag, `npm run deploy`, the hosting tools, `kubectl apply`, `helm upgrade`, `terraform apply`, `docker push`, `gh release create`.
- Not deploys: a `git push` of a branch, `make build`, a tool named `get_deploy_status`.
- A deploy's start: the agent walks to the server room and works at the console, as for a command. Its end: success launches the rocket, the desks nearby applaud, the agent celebrates in the server room; failure is the failure reaction (the sweat; a second failure within two minutes, the fist on the desk); cancelled or never seen to end does nothing. A plain `git push` keeps the applause and no longer launches the rocket. The launch pad's card counts the deploys that succeeded.
- The 2D office: the same 08:00 to 21:00; the sofa (a nap), the coffee corner, a plant, and between them the desk with the screen off; no new art; a turn of 3 minutes; no two agents on one spot; no agent in the same place two turns running; after two hours of resting an agent mostly stays at its desk; a coffee break after a turn, a stand-up and every place of work come first; with reduced motion nobody walks; at night everyone resting stays at the desk.
- The scene's script stays under the build test's bound, 1.2 MB.
- Not built: new 2D art, sound, the group chat and first-person play in the games, a switch to turn the lively floor off, upstream's midday nap.

Decided in this plan, where the spec left it open:

- The schedule's pure part is its own file, `paseo-leisure-plan.js`, beside `paseo-leisure.js`.
- The schedule is asked once a second of the scene's clock. Gaps are in the scene's seconds; the two hours are by the wall clock, from the moment the scene first saw the agent at rest.
- Outside daytime, during a gathering and with reduced motion, an agent whose gap is over starts a new gap, so the floor does not get up as one at 08:00.
- A game's starter picks its own players among everyone at rest (upstream's code, unchanged), so a game may take an agent whose gap is not over, and may leave out the one whose gap was.
- A visit to the fish lasts about 7 s. On the one-room floor (`cozy`) only the fish and the arcade exist.
- An agent called to work is not stopped for the bell. After a gathering, whoever was stopped goes back to the desk.
- The 2D rotation: turns are counted from the epoch, so they start on every third minute; a resting agent is away every other turn, each time at the next place of sofa, coffee, plant (one turn in six after two hours); the sofa holds two, the machine one, the plant one; on the sofa a person stands in the front pose, at the plant in the back pose.
- A failed deploy is the `fail` event with `of: "deploy"`, so the bubble can say what failed.

---

### Task 1: The host recognises four more kinds of deploy

**Files:**

- Modify: `plugins/office/server/activity.ts`
- Test: `plugins/office/server/activity.test.ts`

**Interfaces:**

- Consumes: `describeStep(items)`, and the test file's own helpers `call(detail, patch)` and `kindOf(detail, patch)` (already in `activity.test.ts`).
- Produces: no new export. `describeStep` gives `kind: "deploy"` for a deploy script, a `make`/`just` deploy target, a Dokploy redeploy, a deploy workflow run and a deploy tool. Private to `activity.ts`: `DEPLOY_SCRIPT: RegExp`, `DEPLOY_TOOL: RegExp`, `ownName(name: string): string`.

- [ ] **Step 1: Write the failing tests**

In `plugins/office/server/activity.test.ts`, replace

```text
test("a tool the host has no kind for is placed by its name", () => {
```

with

```text
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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run plugins/office/server/activity.test.ts --bail=1`
Expected: FAIL in "a deploy script, a make or just target, a Dokploy redeploy and a deploy workflow are deploys": `expected 'command' to be 'deploy'`.

- [ ] **Step 3: Recognise the commands**

In `plugins/office/server/activity.ts`, replace

```text
  /\bgh\s+release\s+create\b/,
];
```

with

```text
  /\bgh\s+release\s+create\b/,
  // `make deploy`, `just deploy`, and their `deploy-…` targets.
  /\b(?:make|just)\b[^\n;|&]*?\sdeploy(?:-[\w-]*)?(?=$|[\s;|&)])/,
  // A Dokploy redeploy: its API's method is in the address the command calls.
  /\b(?:compose|application)\.(?:deploy|redeploy)\b/,
  // A run of a workflow named for a deploy or a release: the name is the first argument.
  /\bgh\s+workflow\s+run\s+(?:"[^"\n]*(?:deploy|release)|'[^'\n]*(?:deploy|release)|[^\s"';|&]*(?:deploy|release))/i,
];
// A script whose file name starts with `deploy`, where a command starts or after what runs it:
// `scripts/deploy.sh pos`, `./deploy-prod.mjs`, `node deploy.mjs`. A name without an extension
// needs a folder before it (`bin/deploy`): the word alone is no deploy.
const RUNS = String.raw`(?:^|[;&|(]|(?<![\w./-])(?:sudo|env|time|nohup|exec|bash|sh|zsh|node|bun|tsx|python3?|ruby|php)\b(?:\s+-\S+)*)\s*(?:\w+=\S*\s+)*`;
const DEPLOY_SCRIPT = new RegExp(
  RUNS +
    String.raw`(?:(?:\.{0,2}/)?(?:[\w.@-]+/)*deploy[\w-]*\.(?:sh|bash|zsh|mjs|cjs|js|ts|py|rb|php)|(?:\.{1,2}/|[\w.@-]+/)(?:[\w.@-]+/)*deploy[\w-]*)(?=$|[\s;|&)])`,
);
```

The two long lines stay as they are: the formatter does not wrap a regular expression or a template string.

Then replace

```text
  if (DEPLOY.some((pattern) => pattern.test(command))) return "deploy";
```

with

```text
  if (DEPLOY.some((pattern) => pattern.test(command)) || DEPLOY_SCRIPT.test(command)) {
    return "deploy";
  }
```

- [ ] **Step 4: Recognise the tools**

In the same file, replace

```text
/** A tool the host has no kind for, placed by its name. */
function namedKind(name: unknown): ActivityKind {
```

with

```text
/** A tool's own name: an MCP tool's is the part after its server's (`mcp__server__tool`). */
function ownName(name: string): string {
  return name.startsWith("mcp__") ? name.split("__").slice(2).join("__") : name;
}

// A tool that puts something live says so first: `deploy_service`, `release-app`, `publish`.
const DEPLOY_TOOL = /^(?:deploy|release|publish|rollout)(?:$|[_-])/i;

/** A tool the host has no kind for, placed by its name. */
function namedKind(name: unknown): ActivityKind {
```

and replace

```text
  if (/^(?:WebSearch|WebFetch|web_search|web_fetch)$/.test(name)) return "web";
  return "tool";
```

with

```text
  if (/^(?:WebSearch|WebFetch|web_search|web_fetch)$/.test(name)) return "web";
  if (DEPLOY_TOOL.test(ownName(name))) return "deploy";
  return "tool";
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run plugins/office/server/activity.test.ts --bail=1`
Expected: PASS, 20 tests.

- [ ] **Step 6: Check and commit**

```bash
cd /workspace/QFlavours/paseo
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/server/activity.ts plugins/office/server/activity.test.ts
npm run format:files -- plugins/office/server/activity.ts plugins/office/server/activity.test.ts
git add plugins/office/server/activity.ts plugins/office/server/activity.test.ts
git commit -m "feat(office): a deploy tool, script, target, Dokploy redeploy and workflow run are deploys"
```

Expected: typecheck and lint print no error; the formatter changes nothing; the commit succeeds.

---

### Task 2: A deploy that succeeds launches the rocket, and a push does not

**Files:**

- Modify: `plugins/office/shared/names.ts` (two comments)
- Modify: `plugins/office/server/activity.ts`, `plugins/office/server/activity.test.ts`
- Modify: `plugins/office/client/world/world-api.ts` (`WorldEvent.of`)
- Modify: `plugins/office/client/world/adapter.ts`, `plugins/office/client/world/adapter.test.ts`
- Modify: `plugins/office/client/pixel/actors.test.ts` (one field of a memory it builds)
- Modify: `plugins/office/vendor/my-office/src/office/paseo-entry.js`, `plugins/office/vendor/my-office/src/i18n/index.js` (a stand-in)
- Modify: `plugins/office/server/world-script.test.ts`
- Modify: `docs/plugins.md`

**Interfaces:**

- Consumes: the deploy kinds of Task 1.
- Produces:
  - `ActivityStep.result` (`"passed" | "failed"`) is set on a deploy that ended, as on a test run; `nextStep(before, items)` looks a deploy last seen running up again, as a test run.
  - `WorldEvent { sess: string; type: WorldEventType; of?: "deploy" }` (`client/world/world-api.ts`).
  - `worldChanges` sends for a deploy: `bash` when it starts, `deploy` when it succeeded, `{ type: "fail", of: "deploy" }` when it failed, nothing when it was cancelled or never seen to end.
  - `WorldMemory`'s entries have `running: "test" | "deploy" | null` where they had `testing: boolean`.
  - In the scene: a `push` event applauds and launches nothing; a `deploy` event launches the rocket; the stand-in's line `paseo.deploy.failed` is "The deploy failed".

- [ ] **Step 1: Write the failing tests of the host**

In `plugins/office/server/activity.test.ts`, replace

```text
  // Only a test run has a result.
```

with

```text
  // A plain command has no result.
```

and replace

```text
interface PollerHarness {
```

with

```text
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

interface PollerHarness {
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run plugins/office/server/activity.test.ts --bail=1`
Expected: FAIL in "a deploy says how it ended, as a test run does": the step has no `result`.

- [ ] **Step 3: Report a deploy's result as a test run's**

In `plugins/office/server/activity.ts`, replace

```text
/** How a command ended: by its exit code when the host has one, else by the call's status. */
```

with

```text
/** The kinds of work whose end is told: a test run's on the test board, a deploy's by the rocket. */
const ENDS: ReadonlySet<ActivityKind> = new Set(["test", "deploy"]);

/** How a call ended: by its exit code when the host has one, else by the call's status. */
```

then replace

```text
  const result = kind === "test" ? resultOf(item) : null;
```

with

```text
  const result = ENDS.has(kind) ? resultOf(item) : null;
```

then replace

```text
 * A test run that has ended says how.
 */
```

with

```text
 * A test run or a deploy that has ended says how.
 */
```

then replace

```text
/**
 * The step to report after `before`. An agent has often moved on by the read after its tests
 * ended, so a test run last seen running is looked up again, and its end is reported for one read
 * before whatever came after it. A cancelled run, and one that left the tail, end without a word.
 */
export function nextStep(
  before: ActivityStep | undefined,
  items: readonly ActivityItem[],
): ActivityStep | null {
  const step = describeStep(items);
  if (before?.kind !== "test" || before.result !== undefined || step?.key === before.key) {
    return step;
  }
```

with

```text
/**
 * The step to report after `before`. An agent has often moved on by the read after its tests or
 * its deploy ended, so one last seen running is looked up again, and its end is reported for one
 * read before whatever came after it. A cancelled one, and one that left the tail, end without a
 * word.
 */
export function nextStep(
  before: ActivityStep | undefined,
  items: readonly ActivityItem[],
): ActivityStep | null {
  const step = describeStep(items);
  if (
    before === undefined ||
    !ENDS.has(before.kind) ||
    before.result !== undefined ||
    step?.key === before.key
  ) {
    return step;
  }
```

In `plugins/office/shared/names.ts`, replace

```text
/** How a test run ended. */
```

with

```text
/** How a test run or a deploy ended. */
```

and replace

```text
  /** Set on a test run once it has ended. */
```

with

```text
  /** Set on a test run or a deploy once it has ended. */
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run plugins/office/server/activity.test.ts --bail=1`
Expected: PASS, 22 tests.

- [ ] **Step 5: Write the failing tests of the adapter**

In `plugins/office/client/world/adapter.test.ts`, in the test "names each kind of work as the scene knows it", replace

```text
      "commit",
      "push",
      "deploy",
    ]);
  });
```

with

```text
      "commit",
      "push",
      // (a deploy that starts is a command; its end is the rocket's)
      "bash",
    ]);
  });
```

Then replace

```text
  it("puts out the lamp of a test run whose end was never seen", () => {
```

with

```text
  it("tells a deploy as a command when it starts, and launches the rocket when it succeeds", () => {
    const running = [agent("1", { status: "running" })];
    const deploying = people(running, { "1": step("deploy", "d1") });
    const ended = (result: "passed" | "failed") =>
      people(running, { "1": { kind: "deploy", key: "d1", result } });

    expect(worldEvents(null, deploying)).toEqual([{ sess: "1", type: "bash" }]);
    const told = rememberPeople(deploying);
    // Still running: no news.
    expect(worldEvents(told, deploying)).toEqual([]);
    expect(worldEvents(told, ended("passed"))).toEqual([{ sess: "1", type: "deploy" }]);
    expect(worldEvents(told, ended("failed"))).toEqual([{ sess: "1", type: "fail", of: "deploy" }]);
    // Told once.
    expect(worldEvents(rememberPeople(ended("passed"), told), ended("passed"))).toEqual([]);
    // A deploy first seen after it ended is only its end.
    expect(worldEvents(null, ended("passed"))).toEqual([{ sess: "1", type: "deploy" }]);
    expect(worldEvents(null, ended("failed"))).toEqual([{ sess: "1", type: "fail", of: "deploy" }]);
  });

  it("says nothing of a deploy that was cancelled or never seen to end", () => {
    const running = [agent("1", { status: "running" })];
    const told = rememberPeople(people(running, { "1": step("deploy", "d1") }));

    expect(worldEvents(told, people(running, { "1": step("edit", "c2") }))).toEqual([
      { sess: "1", type: "edit" },
    ]);
    expect(worldEvents(told, people(running))).toEqual([]);
    expect(worldEvents(told, people([agent("1")]))).toEqual([{ sess: "1", type: "stop" }]);
    // The next deploy is told again.
    const moved = rememberPeople(people(running, { "1": step("edit", "c2") }), told);
    expect(worldEvents(moved, people(running, { "1": step("deploy", "d2") }))).toEqual([
      { sess: "1", type: "bash" },
    ]);
  });

  it("sends a plain push as a push: the applause, and no rocket", () => {
    const running = [agent("1", { status: "running" })];
    expect(worldEvents(null, people(running, { "1": step("push") }))).toEqual([
      { sess: "1", type: "push" },
    ]);
  });

  it("puts out the lamp of a test run whose end was never seen", () => {
```

In `plugins/office/client/pixel/actors.test.ts`, replace

```text
    testing: false,
```

with

```text
    running: null,
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run plugins/office/client/world/adapter.test.ts --bail=1`
Expected: FAIL in "names each kind of work as the scene knows it": the last name is `"deploy"`, expected `"bash"`.

- [ ] **Step 7: Tell a deploy's start and its end**

In `plugins/office/client/world/world-api.ts`, replace

```text
export interface WorldEvent {
  sess: string;
  type: WorldEventType;
}
```

with

```text
export interface WorldEvent {
  sess: string;
  type: WorldEventType;
  /** On a `fail` that is not the agent's own: what failed. The scene words the bubble by it. */
  of?: "deploy";
}
```

In `plugins/office/client/world/adapter.ts`, replace

```text
  push: "push",
  deploy: "deploy",
};

const RESULT_EVENT: Readonly<Record<TestResult, WorldEventType>> = {
  passed: "testok",
  failed: "testfail",
};
```

with

```text
  push: "push",
  // A deploy that starts is a command at the server room's console; `endOf` tells its end.
  deploy: "bash",
};

/** A step whose end is told as well as its start. */
type Run = "test" | "deploy";

function runOf(kind: ActivityKind): Run | null {
  return kind === "test" || kind === "deploy" ? kind : null;
}

type StepEvent = Pick<WorldEvent, "type" | "of">;

/**
 * How a run that ended is told. A test run's result goes on the test board. A deploy that
 * succeeded launches the rocket, and one that failed is a failure.
 */
function endOf(run: Run, result: TestResult): StepEvent {
  if (run === "test") return { type: result === "passed" ? "testok" : "testfail" };
  return result === "passed" ? { type: "deploy" } : { type: "fail", of: "deploy" };
}
```

then replace

```text
  /** That step is a test run, and the scene has not been told how it ended. */
  testing: boolean;
```

with

```text
  /** That step is a test run or a deploy, and the scene has not been told how it ended. */
  running: Run | null;
```

then, in `stepEvents`, replace

```text
): { events: WorldEventType[]; step: string | null; testing: boolean } {
  const events: WorldEventType[] = [];
  let told = was?.step ?? null;
  let testing = was?.testing ?? false;
  if (testing && step?.key !== told) {
    // The run's end was never seen: its lamp on the test board goes out.
    events.push("testend");
    testing = false;
  }
  if (step === undefined) return { events, step: null, testing };
  if (testing) {
    if (step.result !== undefined) {
      events.push(RESULT_EVENT[step.result]);
      testing = false;
    }
  } else if (session.status === "work" && step.key !== told) {
    told = step.key;
    testing = step.kind === "test" && step.result === undefined;
    events.push(step.result === undefined ? STEP_EVENT[step.kind] : RESULT_EVENT[step.result]);
  }
  return { events, step: told, testing };
}
```

with

```text
): { events: StepEvent[]; step: string | null; running: Run | null } {
  const events: StepEvent[] = [];
  let told = was?.step ?? null;
  let running = was?.running ?? null;
  if (running !== null && step?.key !== told) {
    // The run's end was never seen: a test run's lamp on the test board goes out, and a deploy
    // ends without a word.
    if (running === "test") events.push({ type: "testend" });
    running = null;
  }
  if (step === undefined) return { events, step: null, running };
  if (running !== null) {
    if (step.result !== undefined) {
      events.push(endOf(running, step.result));
      running = null;
    }
  } else if (session.status === "work" && step.key !== told) {
    told = step.key;
    const run = runOf(step.kind);
    if (run !== null && step.result !== undefined) {
      events.push(endOf(run, step.result));
    } else {
      running = run;
      events.push({ type: STEP_EVENT[step.kind] });
    }
  }
  return { events, step: told, running };
}
```

then, over `worldChanges`, replace

```text
 * A test run is told twice, when it starts and when it ends. A context that empties, by a
 * compaction or by a new conversation, is paper carried to the shredder.
 */
```

with

```text
 * A test run is told twice, when it starts and when it ends. A deploy too: it starts as a
 * command at the console, and ends as the rocket's launch or as a failure; one cancelled or never
 * seen to end is not told. A context that empties, by a compaction or by a new conversation, is
 * paper carried to the shredder.
 */
```

and in it replace

```text
    for (const type of steps.events) events.push({ sess: session.id, type });
    memory.set(session.id, {
      status: session.status,
      stuck: session.stuck,
      step: steps.step,
      testing: steps.testing,
      full,
    });
```

with

```text
    for (const event of steps.events) events.push({ sess: session.id, ...event });
    memory.set(session.id, {
      status: session.status,
      stuck: session.stuck,
      step: steps.step,
      running: steps.running,
      full,
    });
```

- [ ] **Step 8: Run the tests to verify they pass**

Run: `npx vitest run plugins/office/client/world/adapter.test.ts --bail=1`
Expected: PASS, 30 tests.

Run: `npx vitest run plugins/office/client/pixel/actors.test.ts --bail=1`
Expected: PASS, 17 tests.

- [ ] **Step 9: Ask the built scene for the failed deploy's line (failing build test)**

In `plugins/office/server/world-script.test.ts`, replace

```text
    // The library's chip and the bookshelf tell Paseo, which opens its Library card.
    expect(script).toContain("onLibrary");
```

with

```text
    // The library's chip and the bookshelf tell Paseo, which opens its Library card.
    expect(script).toContain("onLibrary");
    // A deploy that failed has its own line in the bubble.
    expect(script).toContain("paseo.deploy.failed");
```

Run: `npx vitest run plugins/office/server/world-script.test.ts --bail=1`
Expected: FAIL in "builds into one script that sets the page's API and needs nothing a browser lacks": the script does not contain `paseo.deploy.failed`. The message prints the start of the script; that is the failure meant.

- [ ] **Step 10: The rocket for a deploy only, and the failed deploy's bubble**

In `plugins/office/vendor/my-office/src/office/paseo-entry.js`, in `onEvent`, replace

```text
  if (e.type === 'push' || e.type === 'deploy') { applaud(e.sess); launchRocket(); }
```

with

```text
  if (e.type === 'push' || e.type === 'deploy') applaud(e.sess);
  if (e.type === 'deploy') launchRocket();   // (a deploy that succeeded; a push is applauded and no more)
```

then replace

```text
  let a = { ...(ACT[e.type] || ACT.other), type: ACT[e.type] ? e.type : 'other', text: bubbleText(e), e };
```

with

```text
  const said = e.type === 'fail' && e.of === 'deploy' ? tr('paseo.deploy.failed') : bubbleText(e);
  let a = { ...(ACT[e.type] || ACT.other), type: ACT[e.type] ? e.type : 'other', text: said, e };
```

then, two lines further down, in the line that starts `if (w.fails.length >= 2`, replace

```text
text: tr('incident.againFail', { text: bubbleText(e) })
```

with

```text
text: tr('incident.againFail', { text: said })
```

Over `event(e)` in the `api` object, replace

```text
  /** Something a session did: { sess, type }, `type` a key of upstream's ACT table. No text comes with it. */
```

with

```text
  /**
   * Something a session did: { sess, type }, `type` a key of upstream's ACT table. No text comes with it. A `deploy` is
   * a deploy that succeeded; a `fail` with `of: 'deploy'` is one that failed.
   */
```

and in `event(e)` replace

```text
    onEvent({ ts: Date.now(), sess: e.sess, type: e.type, label: ended ? clockTime() : '' });
```

with

```text
    onEvent({ ts: Date.now(), sess: e.sess, type: e.type, label: ended ? clockTime() : '', of: e.of });
```

In `plugins/office/vendor/my-office/src/i18n/index.js`, in `OURS`, replace

```text
  'places.deploy.sub': 'A commit makes the printer print. A push or a deploy launches the rocket.',
```

with

```text
  'places.deploy.sub': 'A commit makes the printer print. A deploy that succeeds launches the rocket.',
  'paseo.deploy.failed': 'The deploy failed',
```

- [ ] **Step 11: Run the build test to verify it passes**

Run: `npx vitest run plugins/office/server/world-script.test.ts --bail=1`
Expected: PASS, 3 tests.

- [ ] **Step 12: Say it in `docs/plugins.md`**

In the paragraph that starts "The `office` built-in shows every agent", replace

```text
command, a test run, a commit, a push, a deploy), the call's id, and for a test run how it ended.
The host decides the kind, from the tool call's normalised detail and for a shell call from its
command (`plugins/office/server/activity.ts`); the command, a file name or a query never leave
it. Tapping a row opens a card
```

with

```text
command, a test run, a commit, a push, a deploy), the call's id, and for a test run or a deploy
how it ended. The host decides the kind, from the tool call's normalised detail and for a shell
call from its command (`plugins/office/server/activity.ts`); the command, a file name or a query
never leave it. A deploy is a tool named for one (`deploy_service`), a deploy script or a
`make`/`just` target, a Dokploy redeploy, a run of a deploy or release workflow, a push of a
version tag, or a hosting tool's own command. Tapping a row opens a card
```

In the paragraph that starts "On the 3D floor an agent is a person at a desk", replace

```text
skill, the desk for an edit, the server room for a command, the test board for a test run. A commit prints a
page, and a push or a deploy launches the rocket. The reads are 5 s apart, so a tool call that
starts and ends between two of them is never shown.
```

with

```text
skill, the desk for an edit, the server room for a command, the test board for a test run. A commit prints a
page, and the desks near a push applaud. A deploy is a command at the server room's console until
it ends: one that succeeds launches the rocket, one that fails gets the failure's sweat, and one
cancelled or never seen to end does nothing. The reads are 5 s apart, so a tool call that
starts and ends between two of them is never shown.
```

- [ ] **Step 13: Check and commit**

```bash
cd /workspace/QFlavours/paseo
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/shared/names.ts plugins/office/server/activity.ts plugins/office/server/activity.test.ts plugins/office/client/world/world-api.ts plugins/office/client/world/adapter.ts plugins/office/client/world/adapter.test.ts plugins/office/client/pixel/actors.test.ts plugins/office/server/world-script.test.ts
npm run format:files -- plugins/office/shared/names.ts plugins/office/server/activity.ts plugins/office/server/activity.test.ts plugins/office/client/world/world-api.ts plugins/office/client/world/adapter.ts plugins/office/client/world/adapter.test.ts plugins/office/client/pixel/actors.test.ts plugins/office/server/world-script.test.ts docs/plugins.md
git add plugins/office docs/plugins.md
git commit -m "feat(office): a deploy that succeeds launches the rocket, a push only the applause"
```

Expected: typecheck and lint print no error; the commit succeeds.

---

### Task 3: Upstream's four games are taken

**Files:**

- Modify: `plugins/office/vendor/my-office/import-upstream.mjs` (`DENY`)
- Delete, then written by the tool from upstream: `plugins/office/vendor/my-office/src/office/people/billiards.js`, `gaming.js`, `karaoke.js`, `foosball.js`
- Written by the tool: `plugins/office/vendor/my-office/src/office/people/karaoke-songs.js`, `src/office/world/props/tv-games.js`, `src/i18n/locales/en/fp.js`, `src/i18n/locales/en/index.js`, `src/office/paseo-modules.js`, `MANIFEST.json`
- Modify: `plugins/office/vendor/my-office/src/office/ui/group-chat.js` (a stand-in), `plugins/office/vendor/my-office/src/i18n/index.js` (a stand-in)
- Modify: `plugins/office/server/world-script.test.ts`
- Modify: `plugins/office/vendor/SOURCES.md`

**Interfaces:**

- Consumes: nothing of the earlier tasks.
- Produces, in the scene (upstream's exports, unchanged): `billiards(force = false)`, `bilState()` and `tableClick()` from `people/billiards.js`; `tvMatch(force = false, kind = null)`, `tvState()` and `tvClick()` from `people/gaming.js`; `foosball(force = false)` and `foosState()` from `people/foosball.js`; `karaoke(force = false)`, `ktvState()` and `boothClick()` from `people/karaoke.js`. Each starter returns whether a game started. `bilState().stage`, `tvState().stage` and `ktvState().stage` are `null` and `foosState()` is `null` while no game is on; `bilState().players`, `tvState().players`, `foosState().players` and `ktvState().singers` are the players' session ids. The stand-in `ui/group-chat.js` exports `chatSay()`.

The tool never overwrites a file that carries a `PASEO:` note, and the four stand-ins carry one: they are deleted first. The other two stand-ins the games import from, `audio/sfx.js` (`sfx`) and `interact/first-person.js` (`fp`), already export what the games import; the tool's report confirms it.

- [ ] **Step 1: Ask the built scene for the games (failing build test)**

In `plugins/office/server/world-script.test.ts`, replace

```text
    // The scene with three.js r160; a jump means a module the port leaves out came back in.
    expect(script.length).toBeGreaterThan(600_000);
    expect(script.length).toBeLessThan(1_200_000);
```

with

```text
    // Upstream's four games are in: pool, the TV matches, foosball and karaoke.
    for (const line of ["billiards", "tv", "foos", "karaoke"]) {
      expect(script).toContain(`people.${line}.invite`);
    }
    // The scene with three.js r160; a jump means a module the port leaves out came back in.
    expect(script.length).toBeGreaterThan(1_000_000);
    expect(script.length).toBeLessThan(1_200_000);
```

Run: `npx vitest run plugins/office/server/world-script.test.ts --bail=1`
Expected: FAIL: the script does not contain `people.billiards.invite`.

- [ ] **Step 2: Have upstream's checkout and three.js at hand**

```bash
test -d /tmp/ref-office/my-office/.git || git clone https://github.com/khanh020905/my-office /tmp/ref-office/my-office
git -C /tmp/ref-office/my-office checkout --quiet b68228871fe30cd2c759a2c919337a9a9d1f5644
git -C /tmp/ref-office/my-office rev-parse HEAD
test -f /tmp/ref-office/three/node_modules/three/package.json || npm install --prefix /tmp/ref-office/three three@0.160.0
node -p "require('/tmp/ref-office/three/node_modules/three/package.json').version"
```

Expected: `b68228871fe30cd2c759a2c919337a9a9d1f5644`, then `0.160.0`. Both are outside the repo.

- [ ] **Step 3: Stop denying the four games, and remove their stand-ins**

In `plugins/office/vendor/my-office/import-upstream.mjs`, replace

```text
/** Not taken: upstream's panels, chat, replay, demo, sounds, the street, and the daily-life scenes. */
```

with

```text
/**
 * Not taken: upstream's panels, chat, replay, demo, sounds, the street, and the daily-life scenes. The lounge's four
 * games are taken (people/billiards.js, gaming.js, foosball.js, karaoke.js).
 */
```

and in `DENY` replace

```text
  /^office\/people\/(outings|comnha|comtrua|duty|teatime|accountant|rounds|guard|hr|foosball|gaming|billiards|karaoke|farewell|interns|nhau|photobooth|pickle|staff)\.js$/,
```

with

```text
  /^office\/people\/(outings|comnha|comtrua|duty|teatime|accountant|rounds|guard|hr|farewell|interns|nhau|photobooth|pickle|staff)\.js$/,
```

```bash
cd /workspace/QFlavours/paseo
rm plugins/office/vendor/my-office/src/office/people/billiards.js \
   plugins/office/vendor/my-office/src/office/people/gaming.js \
   plugins/office/vendor/my-office/src/office/people/karaoke.js \
   plugins/office/vendor/my-office/src/office/people/foosball.js
```

- [ ] **Step 4: See what the tool would do**

```bash
cd /workspace/QFlavours/paseo
node plugins/office/vendor/my-office/import-upstream.mjs \
  --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check
```

Expected, exactly:

```
upstream b682288 (v0.6.0), three 0.160.0
modules in start-up order: 65; files: 88; three add-ons: 15; english areas: common time settings fp activity incident events people places props world life
would write: 9, unchanged: 93
kept (carry a PASEO: note, upstream differs or changed):
  src/office/core/env.js
  src/office/interact/place-cards.js
  src/office/life/tests.js
stand-ins to write or extend:
  office/ui/group-chat.js: chatSay
```

If a game is listed under "kept", its stand-in was not removed in Step 3.

- [ ] **Step 5: Take them**

```bash
cd /workspace/QFlavours/paseo
node plugins/office/vendor/my-office/import-upstream.mjs \
  --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three
git status --short plugins/office/vendor
```

Expected: the same report with `written: 9, unchanged: 93`, then:

```
 M plugins/office/vendor/my-office/MANIFEST.json
 M plugins/office/vendor/my-office/import-upstream.mjs
 M plugins/office/vendor/my-office/src/i18n/locales/en/index.js
 M plugins/office/vendor/my-office/src/office/paseo-modules.js
 M plugins/office/vendor/my-office/src/office/people/billiards.js
 M plugins/office/vendor/my-office/src/office/people/foosball.js
 M plugins/office/vendor/my-office/src/office/people/gaming.js
 M plugins/office/vendor/my-office/src/office/people/karaoke.js
?? plugins/office/vendor/my-office/src/i18n/locales/en/fp.js
?? plugins/office/vendor/my-office/src/office/people/karaoke-songs.js
?? plugins/office/vendor/my-office/src/office/world/props/tv-games.js
```

`fp.js` is the English text the games name for their toasts (`fp.tv.game.…`); the tool takes every area the kept modules name. `paseo-modules.js` now starts the four games (`peopleFoosball`, `peopleGaming`, `peopleBilliards`, `peopleKaraoke`) after `people/gatherings.js`.

- [ ] **Step 6: Give the group chat's stand-in what the games call**

Replace the whole of `plugins/office/vendor/my-office/src/office/ui/group-chat.js` with:

```text
// PASEO: stand-in for my-office's ui/group-chat.js, which Paseo does not take: the games' lines to the group chat go
// nowhere.
export function chatLife() {}
export function chatSay() {}
```

Run the check again:

```bash
cd /workspace/QFlavours/paseo
node plugins/office/vendor/my-office/import-upstream.mjs \
  --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check
```

Expected: `would write: 0, unchanged: 102`, the three "kept" files, and no "stand-ins to write or extend" line.

- [ ] **Step 7: Word the games' hints for an office nobody walks in**

In `plugins/office/vendor/my-office/src/i18n/index.js`, in `OURS`, replace

```text
  'places.live.deployToday': '{n} so far',
```

with

```text
  'places.live.deployToday': '{n} so far',
  // (first-person play is not taken: nobody walks in to pick up a cue; and the box asks no price)
  'props.billiards.hint': 'Call two free people over for a frame',
  'props.gametv.hint': 'Call two free people over for a match',
  'props.karaoke.hint': 'Send someone free in to sing a song',
  'props.karaoke.idle': 'The box is free',
```

- [ ] **Step 8: Run the build test to verify it passes**

Run: `npx vitest run plugins/office/server/world-script.test.ts --bail=1`
Expected: PASS, 3 tests. The script is about 1.07 MB (it was 0.97 MB), under the bound of 1.2 MB.

- [ ] **Step 9: Say what is taken in `plugins/office/vendor/SOURCES.md`**

Under "### What is taken", replace

```text
The scene: the floor plans, the furniture, the people and how they move, the labels over them,
the place cards. Upstream's files are copied unchanged, except that `'three'` and
`'three/addons/...'` imports are rewritten to relative paths, so the bundle needs no resolver.
```

with

```text
The scene: the floor plans, the furniture, the people and how they move, the labels over them,
the place cards, and the lounge's four games (pool, the TV matches, foosball, karaoke: `people/
billiards.js`, `gaming.js`, `foosball.js`, `karaoke.js`). Upstream's files are copied unchanged,
except that `'three'` and `'three/addons/...'` imports are rewritten to relative paths, so the
bundle needs no resolver.

The games call the group chat, the sounds and the first-person walk, which are not taken: their
stand-ins export what the games import and do nothing, so a game is seen and not heard, nobody
plays it in first person, and a karaoke song has no sound.
```

Under "### What is not taken", replace

```text
first-person walk, and the daily-life scenes (lunch runs, karaoke, the seasons, the weather and
the like). The owner asked for the office floor only.
```

with

```text
first-person walk, and the daily-life scenes (lunch runs, the midday nap, the seasons, the
weather and the like). The owner asked for the office floor only.
```

- [ ] **Step 10: Check and commit**

```bash
cd /workspace/QFlavours/paseo
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/server/world-script.test.ts
npm run format:files -- plugins/office/server/world-script.test.ts
git add -A plugins/office/vendor plugins/office/server/world-script.test.ts
git commit -m "feat(office): upstream's pool, TV matches, foosball and karaoke are on the floor"
```

Expected: typecheck and lint print no error; the commit succeeds. A click on the pool table, the TV or the karaoke booth now calls free agents over (upstream's `tableClick`, `tvClick`, `boothClick`), and each game starts on its own now and then.

---

### Task 4: The schedule's decisions

**Files:**

- Create: `plugins/office/vendor/my-office/src/office/paseo-leisure-plan.js`
- Create: `plugins/office/client/world/leisure.test.ts`
- Modify: `plugins/office/vendor/my-office/import-upstream.mjs` (the `OWN` list)

**Interfaces:**

- Consumes: nothing.
- Produces, from `paseo-leisure-plan.js` (plain JavaScript, no import):
  - `LEISURE = { dayFrom: 8, dayTo: 21, gap: [30, 90], longRest: 7200, longGap: [600, 1200], nap: [180, 360], arcade: [60, 180], cup: [120, 240] }` (hours, then seconds)
  - `PAIR = ['pool', 'foosball', 'tv']`, `KINDS = ['pool', 'foosball', 'tv', 'karaoke', 'nap', 'fish', 'arcade', 'cup', 'wc']`
  - `daytime(hour: number): boolean`
  - `called(s, w): boolean`: `s` a session (`{ status, bg? }` or undefined), `w` its person (`{ want }`)
  - `createPlan(random = Math.random)` → `{ step, started, declined, of }`:
    - `step({ now, wall, hour, quiet, agents, open })` → `{ id, kind } | null`. `now`: the scene's seconds; `wall`: milliseconds; `agents`: `[{ id, resting, idle }]`; `open`: `{ [kind]: boolean }`.
    - `started(ids: string[], kind: string): void`, `declined(id: string, now: number, wall: number): void`
    - `of(id)` → `{ idle, nextAt, last, restFrom } | undefined`

- [ ] **Step 1: Write the failing test**

Create `plugins/office/client/world/leisure.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  KINDS,
  LEISURE,
  PAIR,
  called,
  createPlan,
  daytime,
} from "../../vendor/my-office/src/office/paseo-leisure-plan.js";

const ALL = Object.fromEntries(KINDS.map((kind) => [kind, true]));
const only = (...kinds: string[]) =>
  Object.fromEntries(KINDS.map((kind) => [kind, kinds.includes(kind)]));
const agent = (id: string, patch = {}) => ({ id, resting: true, idle: true, ...patch });
/** A plan whose random numbers are these, in turn; the last one repeats. */
function planWith(...numbers: number[]) {
  let next = 0;
  return createPlan(() => {
    const value = numbers[Math.min(next, numbers.length - 1)] ?? 0;
    next += 1;
    return value;
  });
}
/** What step() is asked at second `now` of a morning with one agent asleep at its desk. */
const at = (now: number, patch = {}) => ({
  now,
  wall: now * 1000,
  hour: 10,
  quiet: false,
  agents: [agent("a")],
  open: ALL,
  ...patch,
});

test("daytime is 08:00 to 21:00", () => {
  expect([7, 8, 12, 20, 21, 23, 0].map(daytime)).toEqual([
    false,
    true,
    true,
    true,
    false,
    false,
    false,
  ]);
  expect(LEISURE.gap).toEqual([30, 90]);
  expect(LEISURE.longRest).toBe(7200);
  expect(LEISURE.longGap).toEqual([600, 1200]);
  expect(LEISURE.nap).toEqual([180, 360]);
  expect(LEISURE.arcade).toEqual([60, 180]);
  expect(LEISURE.cup).toEqual([120, 240]);
});

test("someone asleep at the desk gets up after a gap of 30 to 90 seconds", () => {
  const short = planWith(0);
  expect(short.step(at(0))).toBeNull();
  expect(short.step(at(29))).toBeNull();
  // Alone, so no game for two: the first of what is left.
  expect(short.step(at(30))).toEqual({ id: "a", kind: "karaoke" });

  const long = planWith(1, 0);
  expect(long.step(at(0))).toBeNull();
  expect(long.step(at(89))).toBeNull();
  expect(long.step(at(90))).toEqual({ id: "a", kind: "karaoke" });
});

test("a new gap starts when the agent is back at its desk", () => {
  const plan = planWith(0);
  plan.step(at(0));
  expect(plan.step(at(30))).toEqual({ id: "a", kind: "karaoke" });
  plan.started(["a"], "karaoke");
  expect(plan.step(at(200, { agents: [agent("a", { idle: false })] }))).toBeNull();
  // Back and asleep at 300: due at 330.
  expect(plan.step(at(300))).toBeNull();
  expect(plan.step(at(329))).toBeNull();
  expect(plan.step(at(330))).not.toBeNull();
});

test("after two hours of rest the gap is 10 to 20 minutes", () => {
  const plan = planWith(0);
  plan.step(at(0));
  plan.started(["a"], "fish");
  plan.step(at(7190, { agents: [agent("a", { idle: false })] }));
  plan.step(at(7200));
  expect(plan.of("a")?.nextAt).toBe(7200 + 600);

  const slow = planWith(1);
  slow.step(at(0));
  slow.started(["a"], "fish");
  slow.step(at(7190, { agents: [agent("a", { idle: false })] }));
  slow.step(at(7200));
  expect(slow.of("a")?.nextAt).toBe(7200 + 1200);
});

test("the activity is one of what is possible now, and never the agent's last", () => {
  const plan = planWith(0);
  plan.step(at(0, { open: only("fish", "arcade") }));
  expect(plan.step(at(30, { open: only("fish", "arcade") }))).toEqual({ id: "a", kind: "fish" });
  plan.started(["a"], "fish");
  plan.step(at(100, { agents: [agent("a", { idle: false })], open: only("fish", "arcade") }));
  plan.step(at(200, { open: only("fish", "arcade") }));
  // The first of the list again by the dice, but fish was the last: the arcade.
  expect(plan.step(at(230, { open: only("fish", "arcade") }))).toEqual({
    id: "a",
    kind: "arcade",
  });
  plan.started(["a"], "arcade");
  plan.step(at(300, { agents: [agent("a", { idle: false })] }));
  plan.step(at(400, { open: only("arcade") }));
  // Nothing but its last activity is possible: it stays, and asks again a gap later.
  expect(plan.step(at(430, { open: only("arcade") }))).toBeNull();
  expect(plan.of("a")?.nextAt).toBe(460);
});

test("a game for two needs a second agent asleep at a desk", () => {
  const pair = only(...PAIR);
  const alone = planWith(0);
  alone.step(at(0, { open: pair }));
  expect(alone.step(at(30, { open: pair }))).toBeNull();

  const two = planWith(0);
  const both = { agents: [agent("a"), agent("b")], open: ALL };
  two.step(at(0, both));
  expect(two.step(at(30, both))).toEqual({ id: "a", kind: "pool" });
  // A second agent who is away from its desk does not count.
  const away = planWith(0);
  const one = { agents: [agent("a"), agent("b", { idle: false })], open: pair };
  away.step(at(0, one));
  expect(away.step(at(30, one))).toBeNull();
});

test("a game picks its own players: they are the ones who went", () => {
  const plan = planWith(0);
  const three = { agents: [agent("a"), agent("b"), agent("c")], open: ALL };
  plan.step(at(0, three));
  expect(plan.step(at(30, three))?.kind).toBe("pool");
  plan.started(["b", "c"], "pool");
  expect(plan.of("b")?.last).toBe("pool");
  expect(plan.of("c")?.idle).toBe(false);
  expect(plan.of("a")?.last).toBeNull();
  // The one whose gap was over is asked again; the table is taken now.
  const taken = {
    agents: [agent("a"), agent("b", { idle: false }), agent("c", { idle: false })],
    open: { ...ALL, pool: false },
  };
  expect(plan.step(at(31, taken))).toEqual({ id: "a", kind: "karaoke" });
});

test("an activity that could not start is asked again a gap later", () => {
  const plan = planWith(0);
  plan.step(at(0));
  expect(plan.step(at(30))).not.toBeNull();
  plan.declined("a", 30, 30_000);
  expect(plan.step(at(59))).toBeNull();
  expect(plan.step(at(60))).not.toBeNull();
});

test("nothing starts at night, in a gathering or with motion reduced", () => {
  for (const patch of [{ hour: 21 }, { hour: 7 }, { quiet: true }]) {
    const plan = planWith(0);
    plan.step(at(0, patch));
    expect(plan.step(at(30, patch))).toBeNull();
    // The gap starts over, so the floor does not get up as one when it may again.
    expect(plan.of("a")?.nextAt).toBe(60);
    expect(plan.step(at(59))).toBeNull();
    expect(plan.step(at(60))).toEqual({ id: "a", kind: "karaoke" });
  }
});

test("an agent at work is not asked, and its rest starts over when it rests again", () => {
  const plan = planWith(0);
  const working = { agents: [agent("a", { resting: false, idle: false })] };
  plan.step(at(0));
  expect(plan.step(at(30, working))).toBeNull();
  expect(plan.of("a")?.restFrom).toBeNull();
  // Two hours later it rests again: a short gap, not the long one.
  plan.step(at(7300));
  expect(plan.of("a")?.restFrom).toBe(7_300_000);
  expect(plan.of("a")?.nextAt).toBe(7330);
});

test("work calls someone away from an activity", () => {
  const free = { want: null };
  expect(called({ status: "rest" }, free)).toBe(false);
  expect(called({ status: "work" }, free)).toBe(true);
  expect(called({ status: "wait" }, free)).toBe(true);
  expect(called({ status: "rest", bg: [{ desc: "a server" }] }, free)).toBe(true);
  expect(called({ status: "rest" }, { want: { type: "prompt" } })).toBe(true);
  expect(called(undefined, free)).toBe(true);
});

test("an agent that left the office is forgotten", () => {
  const plan = planWith(0);
  plan.step(at(0));
  expect(plan.of("a")).toBeDefined();
  plan.step(at(1, { agents: [] }));
  expect(plan.of("a")).toBeUndefined();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run plugins/office/client/world/leisure.test.ts --bail=1`
Expected: FAIL, the import of `paseo-leisure-plan.js` cannot be resolved.

- [ ] **Step 3: Write the module**

Create `plugins/office/vendor/my-office/src/office/paseo-leisure-plan.js`:

```text
// PASEO: who gets up from a rest, when, and for what: the decisions of the lively floor, with nothing of the scene in
// them, so a test runs them without a browser (plugins/office/client/world/leisure.test.ts). paseo-leisure.js asks
// here once a second and moves the people.
export const LEISURE = {
  dayFrom: 8, dayTo: 21,        // the hours an activity may start in, by the clock the scene reads
  gap: [30, 90],                // seconds at the desk between two activities
  longRest: 2 * 3600,           // after this many seconds of rest…
  longGap: [600, 1200],         // …the gap is this long
  nap: [180, 360], arcade: [60, 180], cup: [120, 240],   // how long each lasts, seconds
};
/** The games two play: they need a second agent at rest. */
export const PAIR = ['pool', 'foosball', 'tv'];
export const KINDS = [...PAIR, 'karaoke', 'nap', 'fish', 'arcade', 'cup', 'wc'];
export const daytime = (hour) => hour >= LEISURE.dayFrom && hour < LEISURE.dayTo;
/** Work came in: a prompt, a question for the user, something left running. `s` is the session, `w` its person. */
export const called = (s, w) => !s || s.status !== 'rest' || !!s.bg?.length || !!w.want;

/**
 * The schedule. step() is asked with the time (`now`: the scene's seconds, for the gaps; `wall`: the clock's
 * milliseconds, for how long someone has rested), the hour, whether the floor is `quiet` (a gathering, reduced motion),
 * everyone (`agents`: { id, resting, idle }, idle meaning asleep at the desk) and what is possible (`open`: a flag per
 * kind). It answers { id, kind } for the one whose gap is over, or null. The caller says how it went: started(ids, kind)
 * with whoever went (a game picks its own players), or declined(id, now, wall).
 */
export function createPlan(random = Math.random) {
  const seen = new Map();   // id -> { idle, nextAt, last, restFrom }
  const between = ([a, b]) => a + random() * (b - a);
  const gapOf = (st, wall) => between(wall - st.restFrom >= LEISURE.longRest * 1000 ? LEISURE.longGap : LEISURE.gap);
  return {
    step({ now, wall, hour, quiet, agents, open }) {
      const here = new Set(agents.map((a) => a.id));
      for (const id of [...seen.keys()]) if (!here.has(id)) seen.delete(id);   // (left the office)
      let due = null, idle = 0;
      for (const a of agents) {
        let st = seen.get(a.id);
        if (!st) { st = { idle: false, nextAt: 0, last: null, restFrom: null }; seen.set(a.id, st); }
        if (!a.resting) { st.idle = false; st.restFrom = null; continue; }
        st.restFrom ??= wall;
        if (a.idle && !st.idle) st.nextAt = now + gapOf(st, wall);   // back at the desk: a new gap
        st.idle = a.idle;
        if (!a.idle) continue;
        idle += 1;
        if (now >= st.nextAt && (!due || st.nextAt < due.st.nextAt)) due = { id: a.id, st };
      }
      if (!due) return null;
      const can = quiet || !daytime(hour) ? [] : KINDS.filter((k) => open[k] && k !== due.st.last && (idle > 1 || !PAIR.includes(k)));
      if (!can.length) { due.st.nextAt = now + gapOf(due.st, wall); return null; }   // (nothing to do now: at the next gap)
      return { id: due.id, kind: can[Math.floor(random() * can.length)] };
    },
    started(ids, kind) { for (const id of ids) { const st = seen.get(id); if (st) { st.last = kind; st.idle = false; } } },
    declined(id, now, wall) { const st = seen.get(id); if (st) st.nextAt = now + gapOf(st, wall); },
    /** What is known of someone: { idle, nextAt, last, restFrom }, or undefined. */
    of: (id) => seen.get(id),
  };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run plugins/office/client/world/leisure.test.ts --bail=1`
Expected: PASS, 12 tests.

- [ ] **Step 5: List the file as Paseo's**

In `plugins/office/vendor/my-office/import-upstream.mjs`, in `OWN`, replace

```text
  "office/paseo-sign.js",
]);
```

with

```text
  "office/paseo-sign.js",
  "office/paseo-leisure-plan.js",
]);
```

- [ ] **Step 6: Check and commit**

```bash
cd /workspace/QFlavours/paseo
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/client/world/leisure.test.ts
npm run format:files -- plugins/office/client/world/leisure.test.ts
git add plugins/office/vendor/my-office/src/office/paseo-leisure-plan.js plugins/office/vendor/my-office/import-upstream.mjs plugins/office/client/world/leisure.test.ts
git commit -m "feat(office): who gets up from a rest, when and for what"
```

Expected: typecheck and lint print no error; the formatter changes nothing; the commit succeeds.

---

### Task 5: The lively floor in the 3D scene

**Files:**

- Create: `plugins/office/vendor/my-office/src/office/paseo-leisure.js`
- Modify: `plugins/office/vendor/my-office/src/office/life/nap.js` (a stand-in)
- Modify: `plugins/office/vendor/my-office/src/office/paseo-entry.js`
- Modify: `plugins/office/vendor/my-office/src/i18n/index.js` (a stand-in)
- Modify: `plugins/office/vendor/my-office/import-upstream.mjs` (the `OWN` list)
- Modify: `plugins/office/server/world-script.test.ts`
- Modify: `plugins/office/vendor/SOURCES.md`, `docs/plugins.md`

**Interfaces:**

- Consumes:
  - Task 3: `billiards(true)`, `bilState()`, `foosball(true)`, `foosState()`, `tvMatch(true)`, `tvState()`, `karaoke(true)`, `ktvState()`.
  - Task 4: `LEISURE`, `called(s, w)`, `createPlan()` and its `step`, `started`, `declined`.
  - Upstream's, already in the scene: a person's `errand(job)` (fields `spot`, `look`, `anim`, `wait`, `hold`, `anim2`, `linger`, `line`, `arrived`; it returns the errand `e`, whose `e.until` holds the person there, whose `e.stage` is `'go'`, `'done'` or `'back'`, and whose `e.b.spot` is where the person goes back to), `errandBack()`, `visitWc()`, `hush()`; `asleep(w)`, `quip(w, text)` (`people/errands.js`); `STATIONS`, `wayTo(w, x, z, front)`, `standBy(x, z, front)` (`people/navigation.js`); `COFFEE_Q` (`people/breaks.js`); `gatheringNow()`, `ringBell(opener)` (`people/gatherings.js`); `PROPS`, `feedFish()`, `brewCoffee()` (`interact/props.js`); `AQ`, `ARC`, `STEAM_AT`; `state.sim`, `state.arcCoin`; `PRO`, `nowMs`, `officeNow`, `rand`, `reduceMotion`, `replay` (`core/env.js`).
- Produces:
  - From `paseo-leisure.js`: `updateLeisure(): void` (every frame), `leisureNow(id: string, kind: string): string[] | null` (one activity now; who went), `ringWithEveryone(ring: () => unknown): unknown` (rings with the solo activities stopped).
  - From the stand-in `life/nap.js`: `napOn = false`, `everyFrame(fn): void`, `updateNap(dt): void`.
  - The stand-in's lines `paseo.leisure.nap`, `.fish`, `.arcade`, `.cup`, `.wc`.

- [ ] **Step 1: Ask the built scene for the lively floor (failing build test)**

In `plugins/office/server/world-script.test.ts`, replace

```text
    // A deploy that failed has its own line in the bubble.
    expect(script).toContain("paseo.deploy.failed");
```

with

```text
    // A deploy that failed has its own line in the bubble.
    expect(script).toContain("paseo.deploy.failed");
    // The lively floor: what someone says on the way to the fish, and Paseo's schedule itself
    // (the station of someone it stopped for the bell).
    expect(script).toContain("Feeding the fish");
    expect(script).toContain('.station="leisure"');
```

Run: `npx vitest run plugins/office/server/world-script.test.ts --bail=1`
Expected: FAIL: the script does not contain `Feeding the fish`.

- [ ] **Step 2: Write the file that moves the people**

Create `plugins/office/vendor/my-office/src/office/paseo-leisure.js`:

```text
// PASEO: the lively floor. An agent at rest does not sleep the day away at its desk: after a gap it gets up for a game
// (upstream's pool, foosball, TV match and karaoke, through their own starters), a nap on the sofa, the fish, the arcade,
// a cup in the dining room or the restroom, with upstream's own moves (errand(), visitWc(), feedFish(), brewCoffee()).
// paseo-leisure-plan.js decides who, when and what; this file moves the people. The stand-in of life/nap.js calls
// updateLeisure every frame, once paseo-entry.js has set it there.
import { state } from './core/state.js';
import { PRO, nowMs, officeNow, rand, reduceMotion, replay } from './core/env.js';
import { AQ } from './world/props/aquarium.js';
import { ARC } from './world/props/arcade.js';
import { STEAM_AT } from './world/furniture/coffee.js';
import { brewCoffee, feedFish } from './interact/props.js';
import { STATIONS, standBy, wayTo } from './people/navigation.js';
import { COFFEE_Q } from './people/breaks.js';
import { sessions, workers } from './people/workers.js';
import { asleep, quip } from './people/errands.js';
import { gatheringNow } from './people/gatherings.js';
import { bilState, billiards } from './people/billiards.js';
import { foosState, foosball } from './people/foosball.js';
import { tvMatch, tvState } from './people/gaming.js';
import { karaoke, ktvState } from './people/karaoke.js';
import { t as tr } from '../i18n/index.js';
import { LEISURE, called, createPlan } from './paseo-leisure-plan.js';

const plan = createPlan();
const solo = new Map();   // session id -> { w, kind, e (the errand; null in the restroom), seat (the cup's chair), sat }
let lookAt = 0;

// at rest, with nothing else on: as upstream's games choose their players (people/billiards.js who())
const resting = (w, s) => !w.sub && s?.status === 'rest' && !s.bg?.length && !w.want;
const idle = (w, s) => resting(w, s) && asleep(w) && w.station === 'desk' && !w.onBreak && !w.outing && !w.street && !w.carry && !w.doze && !w.mealBox && !w.shred;
const sofa = () => (PRO ? STATIONS.coffee.slice(0, 2) : []);   // (the TV's two seats: people/gaming.js)
const busy = (kind) => [...solo.values()].some((x) => x.kind === kind);
// where to stand at a thing: on its `front` side when there is room, from where they are or from the nearest aisle
const by = (w, at, front) => wayTo(w, at.x, at.z, front) || standBy(at.x, at.z, front) || wayTo(w, at.x, at.z) || standBy(at.x, at.z);

function openNow() {
  const seats = sofa(), tv = PRO ? tvState().stage : null;
  return {
    pool: PRO && !bilState().stage,
    foosball: PRO && !foosState(),
    tv: PRO && !tv && seats.length === 2 && seats.every((s) => !s.by),
    karaoke: PRO && !ktvState().stage,
    nap: !tv && seats.some((s) => !s.by),
    fish: !!AQ && !busy('fish'),
    arcade: !!ARC && !busy('arcade'),
    cup: !busy('cup') && !!COFFEE_Q?.[0] && !COFFEE_Q[0].by && !!STATIONS.dining?.some((s) => !s.by),
    wc: !!STATIONS.wc?.some((s) => !s.by),
  };
}

/** Off to something alone: upstream's errand, held for `secs` when it is more than a moment. */
function away(w, kind, job, secs = 0) {
  const e = w.errand({ type: 'idle', wait: 0.6, hold: 0.4, anim2: 'idle', linger: 0.8, ...job });
  if (secs) e.until = state.sim + secs;
  const x = { w, kind, e, seat: null, sat: false };
  solo.set(w.id, x);
  return x;
}
const SOLO = {
  nap(w) {
    const seat = sofa().find((s) => !s.by); if (!seat) return false;
    away(w, 'nap', { spot: seat, anim: 'sleep', line: tr('paseo.leisure.nap'), arrived: () => w.hush() }, rand(...LEISURE.nap));
    return true;
  },
  fish(w) {
    const spot = by(w, AQ); if (!spot) return false;
    away(w, 'fish', { spot, look: [AQ.x, AQ.z], anim: 'tidy', hold: 1.4, linger: 5, line: tr('paseo.leisure.fish'), arrived: () => feedFish() });
    return true;
  },
  arcade(w) {
    const spot = by(w, ARC, [0, 1]); if (!spot) return false;   // (its stick and buttons are on the +z side)
    away(w, 'arcade', { spot, look: [ARC.x, ARC.z], anim: 'console', line: tr('paseo.leisure.arcade'), arrived: () => { state.arcCoin = state.sim + 3; } }, rand(...LEISURE.arcade));
    return true;
  },
  // brewed at the machine, then drunk at a dining chair (the second leg starts in updateLeisure)
  cup(w) {
    const head = COFFEE_Q?.[0], seat = STATIONS.dining?.find((s) => !s.by); if (!head || head.by || !seat) return false;
    const x = away(w, 'cup', { spot: { x: head.x, z: head.z, face: head.face, node: head.node }, look: [STEAM_AT.x, STEAM_AT.z], anim: 'tidy', hold: 2.6, linger: 0.9,
      line: tr('paseo.leisure.cup'), arrived: () => brewCoffee() });
    x.seat = seat; seat.by = w;   // (kept while the cup brews)
    return true;
  },
  wc(w) {
    if (!STATIONS.wc?.some((s) => !s.by)) return false;
    w.anim = 'idle'; w.visitWc(); quip(w, tr('paseo.leisure.wc'));
    solo.set(w.id, { w, kind: 'wc', e: null, seat: null, sat: false });
    return true;
  },
};
// a game picks its own players among everyone at rest: who went is read from the game
const GAMES = {
  pool: () => billiards(true) && bilState().players,
  foosball: () => foosball(true) && foosState().players,
  tv: () => tvMatch(true) && tvState().players,
  karaoke: () => karaoke(true) && ktvState().singers,
};
/** One activity now (`kind` of the plan's KINDS), also for whoever tries the scene in a test page. Returns who went, or null. */
export function leisureNow(id, kind) {
  const w = workers.get(id), went = GAMES[kind] ? GAMES[kind]() || null : w && SOLO[kind]?.(w) ? [id] : null;
  if (went) plan.started(went, kind);
  return went;
}
function drop(id) {
  const x = solo.get(id); if (!x) return;
  if (x.seat && x.seat.by === x.w && x.w.spot !== x.seat) x.seat.by = null;
  solo.delete(id);
}

export function updateLeisure() {
  if (replay.on) return;
  for (const [id, x] of solo) {
    const w = x.w;
    if (workers.get(id) !== w || w.leaving || (x.e ? w.chore !== x.e : !w.wcBusy && !w.inStall)) { drop(id); continue; }   // done, taken into a game or a gathering, or gone
    if (!x.e || x.e.stage === 'back') continue;
    if (called(sessions.get(id), w)) { w.after = null; w.anim = 'idle'; w.errandBack(); continue; }   // work: to the desk at once
    if (x.kind === 'cup' && !x.sat && x.e.stage === 'done') {   // the cup is ready: to the chair with it
      x.sat = true; w.after = null; w.hush();
      x.e = w.errand({ type: 'idle', spot: x.seat, anim: 'coffee', wait: 0, hold: 0.4, anim2: 'idle', linger: 0.8 });
      x.e.until = state.sim + rand(...LEISURE.cup);
    }
  }
  if (state.sim < lookAt) return;
  lookAt = state.sim + 1;
  const agents = [];
  for (const [id, w] of workers) { const s = sessions.get(id); agents.push({ id, resting: resting(w, s), idle: idle(w, s) }); }
  const next = plan.step({ now: state.sim, wall: nowMs(), hour: officeNow().getHours(), quiet: reduceMotion || !!gatheringNow(), agents, open: openNow() });
  if (!next) return;
  if (!leisureNow(next.id, next.kind)) plan.declined(next.id, state.sim, nowMs());
}

/** Someone at a solo activity stops where they stand: free for a gathering. */
function stop(id) {
  const w = solo.get(id).w, there = w.phase !== 'walk' && w.spot && Math.hypot(w.pos.x - w.spot.x, w.pos.y - w.spot.z) < 0.1;
  if (!there) { if (w.spot?.by === w) w.spot.by = null; w.spot = null; }
  w.after = null; w.chore = null; w.onArrive = null; w.path = []; w.phase = 'idle';
  w.inStall = null; w.wcBusy = false; w.pose = 'stand'; w.anim = 'idle'; w.station = 'leisure'; w.hush();
  w.root.visible = true; w.root.matrixWorldAutoUpdate = true;   // (out of a shut stall)
  drop(id);
  return w;
}
/**
 * Rings the bell (`ring`: upstream's ringBell, or the bell prop's own action) with everyone at a solo activity stopped
 * first, so the gathering takes them along; they go back to their desks after it. A player in a game finishes the game.
 */
export function ringWithEveryone(ring) {
  const freed = gatheringNow() ? [] : [...solo.keys()].filter((id) => !called(sessions.get(id), solo.get(id).w)).map(stop);   // (not who was called to work)
  const rung = ring();
  for (const w of freed) if (w.chore) w.chore.b.spot = null;
  return rung;
}
```

What to know when reading it:

- A person in an errand is not asked by upstream's `tick()` for anything else, so work is noticed here (`called`), and the errand is ended with upstream's own `errandBack()`, which walks to the desk.
- `e.until` is how upstream's games hold their players; the nap, the arcade and the cup use it the same way.
- The cup is two errands: the second starts while the first is in its `'done'` stage (0.9 s long), with `w.after` cleared so the first does not walk home. `errand()` keeps the first one's way back (`e.b`).
- The sofa's seats are the first two of `STATIONS.coffee`: the TV match's own seats, so `seat.by` keeps the two apart.
- Someone napping on the sofa counts as asleep for upstream's games and gatherings, which may take them from there; the record here is dropped when the errand is no longer theirs.

- [ ] **Step 3: Run the schedule from the nap's stand-in**

Replace the whole of `plugins/office/vendor/my-office/src/office/life/nap.js` with:

```text
// PASEO: stand-in for my-office's life/nap.js, which Paseo does not take: its midday nap would put the whole floor to
// sleep. The scene's loop calls updateNap every frame; Paseo's lively floor (paseo-leisure.js) runs from it, set here by
// paseo-entry.js so that this file imports nothing.
export const napOn = false;
let frame = null;
export function everyFrame(fn) { frame = fn; }
export function updateNap(dt) { frame?.(dt); }
```

- [ ] **Step 4: Wire it in the entry: the frame, the bell**

In `plugins/office/vendor/my-office/src/office/paseo-entry.js`, in the imports, replace

```text
import { PLACES } from './interact/place-chips.js';
```

with

```text
import { PLACES } from './interact/place-chips.js';
import { PROPS } from './interact/props.js';
```

and replace

```text
import { SIGN, drawSign } from './paseo-sign.js';
```

with

```text
import { SIGN, drawSign } from './paseo-sign.js';
import { ringWithEveryone, updateLeisure } from './paseo-leisure.js';
import { everyFrame } from './life/nap.js';
```

In `start`, replace

```text
    showMachine(false);
    showBrand(options.brand);
```

with

```text
    // (the bell on the meeting table: whoever is at a solo activity stops for it, as for the stand-up card's bell)
    const bell = PROPS.get('bell');
    if (bell) { const ring = bell.act; bell.act = () => ringWithEveryone(ring); }
    everyFrame(updateLeisure);
    showMachine(false);
    showBrand(options.brand);
```

Over `meet()`, replace

```text
   * A stand-up: upstream's meeting bell, with a stand-up's opening line. Everyone free walks to the meeting table and
   * says what they are on. Upstream says in a toast when nobody is free; Paseo's stand-up card is open then and says
   * who is at work, so that toast is not passed on.
```

with

```text
   * A stand-up: upstream's meeting bell, with a stand-up's opening line. Everyone free walks to the meeting table and
   * says what they are on; whoever is at a solo activity of the lively floor stops for it, and a game is played out.
   * Upstream says in a toast when nobody is free; Paseo's stand-up card is open then and says who is at work, so that
   * toast is not passed on.
```

and in `meet()` replace

```text
    try { ringBell(tr('people.meet.standup')); } finally { host.toast = toast; }
```

with

```text
    try { ringWithEveryone(() => ringBell(tr('people.meet.standup'))); } finally { host.toast = toast; }
```

- [ ] **Step 5: The solo activities' lines**

In `plugins/office/vendor/my-office/src/i18n/index.js`, in `OURS`, replace

```text
  'props.karaoke.idle': 'The box is free',
```

with

```text
  'props.karaoke.idle': 'The box is free',
  // the lively floor (paseo-leisure.js): what someone says on the way to a rest of their own
  'paseo.leisure.nap': 'Quick nap',
  'paseo.leisure.fish': 'Feeding the fish',
  'paseo.leisure.arcade': 'One round at the arcade',
  'paseo.leisure.cup': 'Making a coffee',
  'paseo.leisure.wc': 'Back in a minute',
```

- [ ] **Step 6: List the file as Paseo's, and check the tree against upstream**

In `plugins/office/vendor/my-office/import-upstream.mjs`, in `OWN`, replace

```text
  "office/paseo-leisure-plan.js",
]);
```

with

```text
  "office/paseo-leisure-plan.js",
  "office/paseo-leisure.js",
]);
```

The tool reads upstream's checkout at the pinned commit and three.js 0.160.0, both outside the repo:

```bash
test -d /tmp/ref-office/my-office/.git || git clone https://github.com/khanh020905/my-office /tmp/ref-office/my-office
git -C /tmp/ref-office/my-office checkout --quiet b68228871fe30cd2c759a2c919337a9a9d1f5644
test -f /tmp/ref-office/three/node_modules/three/package.json || npm install --prefix /tmp/ref-office/three three@0.160.0
cd /workspace/QFlavours/paseo
node plugins/office/vendor/my-office/import-upstream.mjs \
  --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check
```

Expected: `would write: 0, unchanged: 102`, the three "kept" files (`core/env.js`, `interact/place-cards.js`, `life/tests.js`) and no "stand-ins to write or extend" line. `--check` writes nothing; do not run the tool without it here.

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run plugins/office/server/world-script.test.ts --bail=1`
Expected: PASS, 3 tests.

Run: `npx vitest run plugins/office/client/world/leisure.test.ts --bail=1`
Expected: PASS, 12 tests.

- [ ] **Step 8: Say it in the two docs**

In `plugins/office/vendor/SOURCES.md`, in the stand-ins' table, replace

```text
| `world/backdrops/index.js`  | A plain backdrop in the app's surface colour; day and night            |
```

with

```text
| `world/backdrops/index.js`  | A plain backdrop in the app's surface colour; day and night            |
| `life/nap.js`               | No midday nap; calls Paseo's lively floor every frame                  |
```

and under it replace

```text
Paseo's design language), `paseo-modules.js` (generated: the kept modules in start-up order), and
`paseo-sign.js` (the picture on the lobby's sign and the reception's plaque, with the host's
brand; the entry puts it on the material upstream's floor made).
```

with

```text
Paseo's design language), `paseo-modules.js` (generated: the kept modules in start-up order),
`paseo-sign.js` (the picture on the lobby's sign and the reception's plaque, with the host's
brand; the entry puts it on the material upstream's floor made), and the lively floor:
`paseo-leisure-plan.js` (who gets up from a rest, when and for what; no scene in it, so
`client/world/leisure.test.ts` runs it) and `paseo-leisure.js` (which moves the people with
upstream's own moves and starts upstream's games through their starters). The stand-in of
`life/nap.js` runs it every frame: the scene's loop already calls `updateNap`.
```

In `docs/plugins.md`, in the paragraph that starts "On the 3D floor an agent is a person at a desk", replace

```text
conversation, the person carries the paper to the shredder. Opening the stand-up rings the bell
on the meeting table: everyone the scene counts as free walks there and says what they are on.
Designs:
[the floor](superpowers/specs/2026-11-16-office-my-office-port-design.md),
```

with

```text
conversation, the person carries the paper to the shredder. Opening the stand-up rings the bell
on the meeting table: everyone the scene counts as free walks there and says what they are on.
From 08:00 to 21:00 by the device's clock an agent at rest does not stay asleep at its desk: after
30 to 90 seconds there it gets up for a game of pool, foosball or the games TV with another
resting agent, for karaoke, a nap on the sofa, the fish, the arcade, a cup in the dining room or
the restroom, never the same thing twice running, and work calls it back at once. After two hours
of rest the gaps are 10 to 20 minutes. The games are upstream's, and Paseo's schedule
(`vendor/my-office/src/office/paseo-leisure.js`) only starts them; it starts nothing at night,
during a gathering or with reduced motion. Designs:
[the lively floor](superpowers/specs/2026-11-16-office-lively-floor-design.md),
[the floor](superpowers/specs/2026-11-16-office-my-office-port-design.md),
```

- [ ] **Step 9: Check and commit**

```bash
cd /workspace/QFlavours/paseo
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/server/world-script.test.ts
npm run format:files -- plugins/office/server/world-script.test.ts docs/plugins.md
git add -A plugins/office/vendor plugins/office/server/world-script.test.ts docs/plugins.md
git commit -m "feat(office): an agent at rest uses the lounge by day"
```

Expected: typecheck and lint print no error; the commit succeeds. The scene itself is looked at in Task 7.

---

### Task 6: The 2D office's rotation

**Files:**

- Modify: `plugins/office/client/pixel/floor-plan.ts`, `plugins/office/client/pixel/floor-plan.test.ts`
- Modify: `plugins/office/client/pixel/actors.ts`, `plugins/office/client/pixel/actors.test.ts`
- Modify: `plugins/office/client/pixel/pixel-office.tsx`
- Modify: `docs/plugins.md`

**Interfaces:**

- Consumes: `standingOf`, `castOf`, `Breaks`, `BREAK_MS`, `WorldPeople`, `WorldSession`, `planFloor`, `spotAt` (all there already).
- Produces:
  - `PlaceKind = "library" | "board" | "racks" | "coffee" | "pad" | "sofa" | "plant"`; `FloorPlan.spots.sofa` (two places, none in a room without a sofa) and `FloorPlan.spots.plant` (one) (`floor-plan.ts`).
  - From `actors.ts`: `type RestPlace = "sofa" | "coffee" | "plant"`; `DAY_FROM = 8`, `DAY_TO = 21`, `TURN_MS = 180_000`, `LONG_REST_MS = 7_200_000`; `type Rests = ReadonlyMap<string, number>`, `NO_RESTS`; `restsAfter(rests: Rests, sessions: readonly WorldSession[], now: number): Rests`; `interface Leisure { now: number; rests: Rests; sofa: boolean }`; `restWishes(id: string, leisure: Leisure): RestPlace[]`; `standingOf(session, step, onBreak, meeting, rest: RestPlace | null = null)`; `castOf(people, breaks, meeting, leisure: Leisure | null = null)`.

- [ ] **Step 1: Write the failing test of the plan's new places**

In `plugins/office/client/pixel/floor-plan.test.ts`, replace

```text
  it("has more shelves in a wider room and one rack in a narrow one", () => {
```

with

```text
  it("has two places on the sofa and one at the plant, clear of who stands at the machine", () => {
    for (const widthPx of [360, 390, 800, 1280]) {
      const plan = planFloor([team("a", 3)], widthPx);
      const { sofa, plant, coffee } = plan.spots;
      expect(sofa.xs).toHaveLength(2);
      expect(plant.xs).toHaveLength(1);
      const resting = [
        ...sofa.xs.map((x) => ({ x, y: sofa.y, ...SIZE.person })),
        ...plant.xs.map((x) => ({ x, y: plant.y, ...SIZE.person })),
        ...coffee.xs.map((x) => ({ x, y: coffee.y, ...SIZE.person })),
      ];
      resting.forEach((box, index) => {
        for (const other of resting.slice(index + 1)) expect(overlap(box, other)).toBe(false);
      });
      // Both sit within the sofa's width, and nobody stands in the lane.
      const lane = { x: plan.laneX, y: plan.wallHeight, ...SIZE.person, h: plan.height };
      for (const box of resting) expect(overlap(lane, box)).toBe(false);
      for (const x of sofa.xs) {
        expect(x).toBeGreaterThanOrEqual(plan.sofa?.x ?? 0);
        expect(x + SIZE.person.w).toBeLessThanOrEqual((plan.sofa?.x ?? 0) + SIZE.sofa.w);
      }
      expect(plant.y).toBe(coffee.y);
    }
    // A room too narrow for a sofa has no place on one; the plant is still there.
    const narrow = planFloor([], 300);
    expect(narrow.sofa).toBeNull();
    expect(narrow.spots.sofa.xs).toEqual([]);
    expect(narrow.spots.plant.xs).toHaveLength(1);
    expect(narrow.spots.plant.xs[0]).toBeGreaterThan(narrow.laneX + SIZE.person.w);
  });

  it("has more shelves in a wider room and one rack in a narrow one", () => {
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run plugins/office/client/pixel/floor-plan.test.ts --bail=1`
Expected: FAIL in "has two places on the sofa and one at the plant, clear of who stands at the machine": `sofa` is undefined.

- [ ] **Step 3: Give the plan a place on the sofa and one at the plant**

In `plugins/office/client/pixel/floor-plan.ts`, replace

```text
/** Where a person goes to work away from the desk. */
export type PlaceKind = "library" | "board" | "racks" | "coffee" | "pad";
```

with

```text
/** Where a person goes away from the desk: to work, or for a rest in the lounge. */
export type PlaceKind = "library" | "board" | "racks" | "coffee" | "pad" | "sofa" | "plant";
```

and at the end of `planFloor` replace

```text
      coffee: { y: loungeSpotY, xs: coffeeSpots },
      pad: { y: loungeSpotY, xs: padSpots },
    },
```

with

```text
      coffee: { y: loungeSpotY, xs: coffeeSpots },
      pad: { y: loungeSpotY, xs: padSpots },
      // On the sofa's two cushions, the feet on its front edge; a room without a sofa has none.
      sofa: sofa === null ? { y: 0, xs: [] } : { y: sofa.y - 4, xs: [sofa.x + 3, sofa.x + 15] },
      // In front of the plant, looking at it.
      plant: { y: loungeSpotY, xs: [plant.x - 1] },
    },
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run plugins/office/client/pixel/floor-plan.test.ts --bail=1`
Expected: PASS, 24 tests.

- [ ] **Step 5: Write the failing tests of the rotation**

In `plugins/office/client/pixel/actors.test.ts`, replace

```text
import {
  BREAK_MS,
  NO_BREAKS,
  NO_VISITS,
  breaksAfter,
  castOf,
  nextBreakEnd,
  standingOf,
  trayOf,
  visitsAfter,
  visitsSwept,
} from "./actors.js";
```

with

```text
import {
  BREAK_MS,
  LONG_REST_MS,
  NO_BREAKS,
  NO_RESTS,
  NO_VISITS,
  TURN_MS,
  breaksAfter,
  castOf,
  nextBreakEnd,
  restWishes,
  restsAfter,
  standingOf,
  trayOf,
  visitsAfter,
  visitsSwept,
  type Leisure,
} from "./actors.js";
```

and replace

```text
describe("the janitor's round", () => {
```

with

```text
describe("the lively floor", () => {
  /** A time of 16 November 2026 by the device's clock; a turn starts on every third minute. */
  const at = (hour: number, minute = 0) => new Date(2026, 10, 16, hour, minute).getTime();
  const floor = (now: number, patch: Partial<Leisure> = {}): Leisure => ({
    now,
    rests: NO_RESTS,
    sofa: true,
    ...patch,
  });
  const ids = Array.from({ length: 40 }, (_, index) => `agent-${index}`);
  const resting = (list: readonly string[]) => ({
    sessions: list.map((id) => session(id, { status: "rest" })),
    overflow: 0,
    steps: new Map<string, ActivityStep>(),
  });
  const placeOf = (id: string, leisure: Leisure) => restWishes(id, leisure)[0] ?? null;

  it("keeps since when each person rests, and drops who works or left", () => {
    const first = restsAfter(NO_RESTS, [session("a", { status: "rest" }), session("b")], 1_000);
    expect([...first]).toEqual([["a", 1_000]]);
    const both = [session("a", { status: "rest" }), session("b", { status: "rest" })];
    const second = restsAfter(first, both, 5_000);
    expect([...second]).toEqual([
      ["a", 1_000],
      ["b", 5_000],
    ]);
    // Nothing changed: the same map, so nothing draws again.
    expect(restsAfter(second, both, 9_000)).toBe(second);
    expect([...restsAfter(second, [session("b", { status: "rest", stuck: true })], 9_000)]).toEqual(
      [],
    );
    expect(restsAfter(NO_RESTS, [session("a")], 1_000)).toBe(NO_RESTS);
  });

  it("sends a resting person to the lounge every other turn by day, each time somewhere else", () => {
    for (const id of ids) {
      const turns = Array.from({ length: 12 }, (_, turn) =>
        placeOf(id, floor(at(10) + turn * TURN_MS)),
      );
      // Away and at the desk in turn: never at one place two turns running.
      turns.forEach((place, turn) => {
        expect(place === null).toBe((turns[0] === null) === (turn % 2 === 0));
      });
      const away = turns.filter((place) => place !== null);
      expect(away).toHaveLength(6);
      away.forEach((place, index) => {
        if (index > 0) expect(place).not.toBe(away[index - 1]);
      });
      expect(new Set(away)).toEqual(new Set(["sofa", "coffee", "plant"]));
    }
    // The whole of a turn is one answer, on every device.
    expect(placeOf("agent-1", floor(at(10, 0) + 1))).toBe(placeOf("agent-1", floor(at(10, 3) - 1)));
  });

  it("offers the other places when the first is taken, and none on the sofa of a room without one", () => {
    const id = ids.find((one) => placeOf(one, floor(at(10))) === "sofa") ?? "";
    expect(restWishes(id, floor(at(10)))).toEqual(["sofa", "coffee", "plant"]);
    for (const one of ids) {
      for (let turn = 0; turn < 6; turn += 1) {
        expect(restWishes(one, floor(at(10) + turn * TURN_MS, { sofa: false }))).not.toContain(
          "sofa",
        );
      }
    }
  });

  it("keeps everyone at the desk at night", () => {
    for (const hour of [21, 23, 0, 3, 7]) {
      for (let turn = 0; turn < 4; turn += 1) {
        for (const id of ids) {
          expect(restWishes(id, floor(at(hour) + turn * TURN_MS))).toEqual([]);
        }
      }
    }
    expect(ids.some((id) => restWishes(id, floor(at(8))).length > 0)).toBe(true);
    expect(ids.some((id) => restWishes(id, floor(at(20, 57))).length > 0)).toBe(true);
  });

  it("mostly keeps someone who has rested two hours at the desk", () => {
    const now = at(14);
    const count = (rests: ReadonlyMap<string, number>) =>
      Array.from({ length: 12 }, (_, turn) =>
        placeOf("agent-3", floor(now + turn * TURN_MS, { rests })),
      ).filter((place) => place !== null).length;
    expect(count(new Map([["agent-3", now - LONG_REST_MS + 13 * TURN_MS]]))).toBe(6);
    expect(count(new Map([["agent-3", now - LONG_REST_MS]]))).toBe(2);
  });

  it("puts one person on a spot: two on the sofa, one at the machine, one at the plant", () => {
    for (let turn = 0; turn < 6; turn += 1) {
      const cast = castOf(resting(ids), NO_BREAKS, false, floor(at(11) + turn * TURN_MS));
      const taken = cast.map((member) => `${member.standing.place}:${member.spot}`);
      const away = taken.filter((key) => !key.startsWith("null"));
      expect(new Set(away).size).toBe(away.length);
      expect(away.toSorted()).toEqual(["coffee:0", "plant:0", "sofa:0", "sofa:1"]);
    }
    // Without a sofa: the machine and the plant.
    const narrow = castOf(resting(ids), NO_BREAKS, false, floor(at(11), { sofa: false }));
    expect(
      narrow
        .map((member) => member.standing.place)
        .filter((place) => place !== null)
        .toSorted(),
    ).toEqual(["coffee", "plant"]);
  });

  it("shows a nap on the sofa and a look at the plant with the screen off, and a cup at the machine", () => {
    const rest = session("a", { status: "rest" });
    expect(standingOf(rest, undefined, false, false, "sofa")).toEqual({
      place: "sofa",
      icon: null,
      screen: "off",
    });
    expect(standingOf(rest, undefined, false, false, "plant")).toEqual({
      place: "plant",
      icon: null,
      screen: "off",
    });
    expect(standingOf(rest, undefined, false, false, "coffee")).toEqual({
      place: "coffee",
      icon: "coffee",
      screen: "off",
    });
  });

  it("lets a break, a stand-up and work come first", () => {
    const id = ids.find((one) => placeOf(one, floor(at(10))) === "sofa") ?? "";
    const leisure = floor(at(10));
    const one = (patch: Partial<WorldSession>, steps = new Map<string, ActivityStep>()) => ({
      sessions: [session(id, patch)],
      overflow: 0,
      steps,
    });
    const placeIn = (cast: ReturnType<typeof castOf>) => cast[0]?.standing.place;
    expect(placeIn(castOf(one({ status: "rest" }), NO_BREAKS, false, leisure))).toBe("sofa");
    // The coffee after a turn.
    const onBreak = new Map([[id, at(10) + BREAK_MS]]);
    expect(placeIn(castOf(one({ status: "rest" }), onBreak, false, leisure))).toBe("coffee");
    // A stand-up at the whiteboard.
    expect(placeIn(castOf(one({ status: "rest" }), NO_BREAKS, true, leisure))).toBe("board");
    // Work, a question and an error.
    const reading = new Map([[id, step("read")]]);
    expect(placeIn(castOf(one({ status: "work" }, reading), NO_BREAKS, false, leisure))).toBe(
      "library",
    );
    expect(placeIn(castOf(one({ status: "work" }), NO_BREAKS, false, leisure))).toBeNull();
    expect(placeIn(castOf(one({ status: "wait" }), NO_BREAKS, false, leisure))).toBeNull();
    expect(
      placeIn(castOf(one({ status: "rest", stuck: true }), NO_BREAKS, false, leisure)),
    ).toBeNull();
  });

  it("keeps everyone at the desk with motion reduced", () => {
    const cast = castOf(resting(ids), NO_BREAKS, false, null);
    expect(cast.every((member) => member.standing.place === null)).toBe(true);
    expect(castOf(resting(ids), NO_BREAKS, false).every((m) => m.standing.place === null)).toBe(
      true,
    );
  });
});

describe("the janitor's round", () => {
```

- [ ] **Step 6: Run them to verify they fail**

Run: `npx vitest run plugins/office/client/pixel/actors.test.ts --bail=1`
Expected: FAIL in "keeps since when each person rests, and drops who works or left": `restsAfter is not a function`.

- [ ] **Step 7: Write the rotation**

In `plugins/office/client/pixel/actors.ts`, replace

```text
// Who is where in the 2D office, from what the office knows of each agent. Nothing here is
// remembered but a coffee break and the janitor's round: the rest follows the agent's state and
// whether a stand-up is on, so an office opened in the middle of a turn shows everyone where
// they are.
```

with

```text
// Who is where in the 2D office, from what the office knows of each agent. Nothing here is
// remembered but a coffee break, when each person came to rest and the janitor's round: the rest
// follows the agent's state, the time and whether a stand-up is on, so an office opened in the
// middle of a turn shows everyone where they are.
```

then replace

```text
/**
 * Where a person is and what shows over the head. Whoever needs the user is at the desk, where
 * the card opens: an error first, then a question. Work goes where its tool call belongs, and a
 * rest is at the desk with the screen off, but for the break after a turn. A stand-up calls
 * whoever rests to the whiteboard, from a break too; nobody leaves work for it.
 */
export function standingOf(
  session: Pick<WorldSession, "status" | "stuck">,
  step: ActivityStep | undefined,
  onBreak: boolean,
  meeting: boolean,
): Standing {
  if (session.stuck) return { place: null, icon: "fail", screen: "fail" };
  if (session.status === "wait") return { place: null, icon: "wait", screen: "wait" };
  if (session.status === "rest") {
    if (meeting) return { place: "board", icon: null, screen: "off" };
    return onBreak
      ? { place: "coffee", icon: "coffee", screen: "off" }
      : { place: null, icon: null, screen: "off" };
  }
```

with

```text
/** Where a resting person spends a turn of the lively floor: the places the lounge draws. */
export type RestPlace = "sofa" | "coffee" | "plant";

/**
 * Where a person is and what shows over the head. Whoever needs the user is at the desk, where
 * the card opens: an error first, then a question. Work goes where its tool call belongs, and a
 * rest is at the desk with the screen off, but for the break after a turn and for a turn in the
 * lounge (`rest`). A stand-up calls whoever rests to the whiteboard, from a break too; nobody
 * leaves work for it.
 */
export function standingOf(
  session: Pick<WorldSession, "status" | "stuck">,
  step: ActivityStep | undefined,
  onBreak: boolean,
  meeting: boolean,
  rest: RestPlace | null = null,
): Standing {
  if (session.stuck) return { place: null, icon: "fail", screen: "fail" };
  if (session.status === "wait") return { place: null, icon: "wait", screen: "wait" };
  if (session.status === "rest") {
    if (meeting) return { place: "board", icon: null, screen: "off" };
    if (onBreak || rest === "coffee") return { place: "coffee", icon: "coffee", screen: "off" };
    return { place: rest, icon: null, screen: "off" };
  }
```

then replace

```text
export interface CastMember {
  id: string;
  name: string;
  standing: Standing;
  /** The person's place in line at the place; 0 at the desk. */
  spot: number;
}

/**
 * Everyone with a desk, in desk order, each with a place in line where they stand. `meeting`:
 * a stand-up is on.
 */
export function castOf(people: WorldPeople, breaks: Breaks, meeting: boolean): CastMember[] {
  const lines = new Map<PlaceKind, number>();
  return people.sessions.map((session) => {
    const standing = standingOf(
      session,
      people.steps.get(session.id),
      breaks.has(session.id),
      meeting,
    );
    let spot = 0;
```

with

```text
/** The lively floor's hours, by the device's clock: from 08:00 to 21:00. */
export const DAY_FROM = 8;
export const DAY_TO = 21;
/** A resting person is at one place, or at the desk, for this long. */
export const TURN_MS = 180_000;
/** After this long at rest a person mostly stays at the desk. */
export const LONG_REST_MS = 2 * 60 * 60 * 1000;
/** One turn in this many is spent away from the desk; after a long rest, one in this many. */
const AWAY_EVERY = 2;
const AWAY_EVERY_LONG = 6;
const REST_PLACES: readonly RestPlace[] = ["sofa", "coffee", "plant"];
/** How many rest at each place at once: a spot each. */
const REST_ROOM: Readonly<Record<RestPlace, number>> = { sofa: 2, coffee: 1, plant: 1 };

/** When each resting person came to rest, by agent id. */
export type Rests = ReadonlyMap<string, number>;

export const NO_RESTS: Rests = new Map();

/**
 * Since when each person rests, at `now`: someone newly at rest starts now, and someone who
 * works, waits, stopped on an error or left is dropped. The same map comes back when nothing
 * changed.
 */
export function restsAfter(rests: Rests, sessions: readonly WorldSession[], now: number): Rests {
  const next = new Map<string, number>();
  for (const session of sessions) {
    if (session.status === "rest" && !session.stuck) {
      next.set(session.id, rests.get(session.id) ?? now);
    }
  }
  const same = next.size === rests.size && [...next].every(([id, at]) => rests.get(id) === at);
  return same ? rests : next;
}

/** What the lively floor goes by: the time, since when each person rests, and the room. */
export interface Leisure {
  now: number;
  rests: Rests;
  /** The room is wide enough for a sofa. */
  sofa: boolean;
}

/** The same number for an id on every device. */
function hashOf(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 16777619) >>> 0;
  }
  return hash;
}

/**
 * Where a resting person would be in the turn `now` falls in, best first; none for the desk.
 * It follows from the id and the time alone, so every device shows the same floor. By day a
 * person is away every other turn, each time at the next place, so never at one place two turns
 * running; after a long rest, one turn in six. At night everyone stays at the desk.
 */
export function restWishes(id: string, { now, rests, sofa }: Leisure): RestPlace[] {
  const hour = new Date(now).getHours();
  if (hour < DAY_FROM || hour >= DAY_TO) return [];
  const since = rests.get(id);
  const long = since !== undefined && now - since >= LONG_REST_MS;
  const every = long ? AWAY_EVERY_LONG : AWAY_EVERY;
  const turn = Math.floor(now / TURN_MS) + hashOf(id);
  if (turn % every !== 0) return [];
  const places = sofa ? REST_PLACES : REST_PLACES.filter((place) => place !== "sofa");
  const first = Math.floor(turn / every) % places.length;
  return [...places.slice(first), ...places.slice(0, first)];
}

export interface CastMember {
  id: string;
  name: string;
  standing: Standing;
  /** The person's place in line at the place; 0 at the desk. */
  spot: number;
}

/**
 * Everyone with a desk, in desk order, each with a place in line where they stand. `meeting`:
 * a stand-up is on. `leisure`: the lively floor, where whoever rests takes turns in the lounge,
 * one person a spot; null (motion reduced) keeps them at their desks. A break after a turn and a
 * stand-up come before it.
 */
export function castOf(
  people: WorldPeople,
  breaks: Breaks,
  meeting: boolean,
  leisure: Leisure | null = null,
): CastMember[] {
  const lines = new Map<PlaceKind, number>();
  const resting = new Map<RestPlace, number>();
  const restOf = (session: WorldSession): RestPlace | null => {
    if (leisure === null || meeting || breaks.has(session.id)) return null;
    if (session.status !== "rest" || session.stuck) return null;
    const place = restWishes(session.id, leisure).find(
      (wish) => (resting.get(wish) ?? 0) < REST_ROOM[wish],
    );
    if (place === undefined) return null;
    resting.set(place, (resting.get(place) ?? 0) + 1);
    return place;
  };
  return people.sessions.map((session) => {
    const standing = standingOf(
      session,
      people.steps.get(session.id),
      breaks.has(session.id),
      meeting,
      restOf(session),
    );
    let spot = 0;
```

The rest of `castOf` (the place in line and the returned member) stays as it is.

- [ ] **Step 8: Run them to verify they pass**

Run: `npx vitest run plugins/office/client/pixel/actors.test.ts --bail=1`
Expected: PASS, 26 tests.

- [ ] **Step 9: Keep the rests and the turn in the 2D office, and cast with them**

In `plugins/office/client/pixel/pixel-office.tsx`, replace

```text
import {
  NO_BREAKS,
  NO_VISITS,
  breaksAfter,
  castOf,
  nextBreakEnd,
  trayOf,
  visitsAfter,
  visitsSwept,
  type Breaks,
  type CastMember,
  type Visits,
} from "./actors.js";
```

with

```text
import {
  NO_BREAKS,
  NO_RESTS,
  NO_VISITS,
  TURN_MS,
  breaksAfter,
  castOf,
  nextBreakEnd,
  restsAfter,
  trayOf,
  visitsAfter,
  visitsSwept,
  type Breaks,
  type CastMember,
  type Leisure,
  type Rests,
  type Visits,
} from "./actors.js";
```

then replace

```text
interface FloorLife {
  breaks: Breaks;
  /** The desks the janitor is due at. */
  visits: Visits;
  /** The janitor swept at this agent's desk. */
  swept(agentId: string): void;
}

/**
 * What the floor remembers. Who is on a coffee break: a turn that ended starts one, and its time
 * or new work ends it. And the janitor's round: a context that emptied calls the janitor to
 * that desk.
 */
function useFloorLife(people: WorldPeople, still: boolean): FloorLife {
  const [breaks, setBreaks] = useState<Breaks>(NO_BREAKS);
  const [visits, setVisits] = useState<Visits>(NO_VISITS);
  const memory = useRef<WorldMemory | null>(null);
  const sessions = useRef(people.sessions);
  useEffect(() => {
    sessions.current = people.sessions;
    const known = memory.current;
    const changes = worldChanges(known, people);
    memory.current = changes.memory;
    const seated = new Set(people.sessions.map((session) => session.id));
    setBreaks((before) => breaksAfter(before, changes.events, people.sessions, Date.now()));
    setVisits((before) => visitsAfter(before, changes.events, known, seated));
  }, [people]);
```

with

```text
interface FloorLife {
  breaks: Breaks;
  /** Since when each person rests. */
  rests: Rests;
  /** The time the lively floor goes by: it moves on when a turn ends. */
  now: number;
  /** The desks the janitor is due at. */
  visits: Visits;
  /** The janitor swept at this agent's desk. */
  swept(agentId: string): void;
}

/**
 * What the floor remembers. Who is on a coffee break: a turn that ended starts one, and its time
 * or new work ends it. Since when each person rests, for the lively floor, and the time its
 * turns go by. And the janitor's round: a context that emptied calls the janitor to that desk.
 */
function useFloorLife(people: WorldPeople, still: boolean): FloorLife {
  const [breaks, setBreaks] = useState<Breaks>(NO_BREAKS);
  const [rests, setRests] = useState<Rests>(NO_RESTS);
  const [now, setNow] = useState(() => Date.now());
  const [visits, setVisits] = useState<Visits>(NO_VISITS);
  const memory = useRef<WorldMemory | null>(null);
  const sessions = useRef(people.sessions);
  useEffect(() => {
    sessions.current = people.sessions;
    const known = memory.current;
    const changes = worldChanges(known, people);
    memory.current = changes.memory;
    const seated = new Set(people.sessions.map((session) => session.id));
    setBreaks((before) => breaksAfter(before, changes.events, people.sessions, Date.now()));
    setRests((before) => restsAfter(before, people.sessions, Date.now()));
    setVisits((before) => visitsAfter(before, changes.events, known, seated));
  }, [people]);
  // The lounge is looked at again when a turn of the lively floor ends.
  useEffect(() => {
    if (still) return undefined;
    const timer = setTimeout(() => setNow(Date.now()), TURN_MS - (now % TURN_MS) + 20);
    return () => clearTimeout(timer);
  }, [now, still]);
```

then, at the end of `useFloorLife`, replace

```text
  return still ? { breaks: NO_BREAKS, visits: NO_VISITS, swept } : { breaks, visits, swept };
```

with

```text
  return still
    ? { breaks: NO_BREAKS, rests, now, visits: NO_VISITS, swept }
    : { breaks, rests, now, visits, swept };
```

then replace

```text
/** At these a person looks at the wall; in the lounge, at the room. */
const AT_THE_WALL: ReadonlySet<PlaceKind> = new Set(["library", "board", "racks"]);
```

with

```text
/** At these a person looks at the wall, or at the plant; elsewhere in the lounge, at the room. */
const AT_THE_WALL: ReadonlySet<PlaceKind> = new Set(["library", "board", "racks", "plant"]);
```

then, in the comment over `PixelOffice`, replace

```text
 * for edits, the pad for a push or a deploy, the coffee machine after a turn. The paper on a
 * desk is its agent's context, and the janitor sweeps it away when the context empties.
 */
```

with

```text
 * for edits, the pad for a push or a deploy, the coffee machine after a turn. By day whoever
 * rests takes turns in the lounge: on the sofa, at the coffee machine, at the plant. The paper on
 * a desk is its agent's context, and the janitor sweeps it away when the context empties.
 */
```

then, in `PixelOffice`, replace

```text
  const { breaks, visits, swept } = useFloorLife(people, still);
  // With motion reduced nobody walks to a stand-up either.
  const gathered = meeting && !still;
  const cast = useMemo(() => castOf(people, breaks, gathered), [people, breaks, gathered]);
```

with

```text
  const { breaks, rests, now, visits, swept } = useFloorLife(people, still);
  // With motion reduced nobody walks to a stand-up either.
  const gathered = meeting && !still;
```

and, a few lines further down, replace

```text
  const plan = useMemo(() => (widthPx > 0 ? planFloor(teams, widthPx) : null), [teams, widthPx]);
```

with

```text
  const plan = useMemo(() => (widthPx > 0 ? planFloor(teams, widthPx) : null), [teams, widthPx]);
  // Nor to the lounge: the lively floor is for who may see people walk.
  const hasSofa = plan !== null && plan.sofa !== null;
  const leisure = useMemo(
    (): Leisure | null => (still ? null : { now, rests, sofa: hasSofa }),
    [still, now, rests, hasSofa],
  );
  const cast = useMemo(
    () => castOf(people, breaks, gathered, leisure),
    [people, breaks, gathered, leisure],
  );
```

`cast` is now made after `plan`; nothing between the two uses it (`trays` and `teams` read `people` and `visits`).

- [ ] **Step 10: Say it in `docs/plugins.md`**

In the paragraph that starts "The places are the 3D floor's", replace

```text
Two things are remembered: the coffee break, 30 seconds away from the desk after a turn ends,
and the desks the janitor is due at. While the stand-up is open, whoever rests stands at the
whiteboard. A
```

with

```text
Three things are remembered: the coffee break, 30 seconds away from the desk after a turn ends,
since when each agent rests, and the desks the janitor is due at. While the stand-up is open,
whoever rests stands at the whiteboard. From 08:00 to 21:00 by the device's clock whoever rests
takes turns of three minutes in the lounge, on the sofa, at the coffee machine or at the plant,
and at the desk between them; an agent that has rested two hours goes one turn in six. The turn
follows from the agent's id and the time (`restWishes`), so every device shows the same floor. A
```

and at its end replace

```text
empty once that is done. With reduced motion nobody walks, nobody takes a break or goes to the
stand-up, and the janitor stays at the cart. Designs:
[the 2D floor](superpowers/specs/2026-11-16-office-pixel-office-design.md),
```

with

```text
empty once that is done. With reduced motion nobody walks, nobody takes a break or goes to the
stand-up or the lounge, and the janitor stays at the cart. Designs:
[the 2D floor](superpowers/specs/2026-11-16-office-pixel-office-design.md),
[the lively floor](superpowers/specs/2026-11-16-office-lively-floor-design.md),
```

- [ ] **Step 11: Check and commit**

```bash
cd /workspace/QFlavours/paseo
npm run typecheck --workspace=@getpaseo/builtin-plugins
npx vitest run plugins/office/client/pixel/actors.test.ts --bail=1
npx vitest run plugins/office/client/pixel/floor-plan.test.ts --bail=1
npm run lint -- plugins/office/client/pixel/floor-plan.ts plugins/office/client/pixel/floor-plan.test.ts plugins/office/client/pixel/actors.ts plugins/office/client/pixel/actors.test.ts plugins/office/client/pixel/pixel-office.tsx
npm run format:files -- plugins/office/client/pixel/floor-plan.ts plugins/office/client/pixel/floor-plan.test.ts plugins/office/client/pixel/actors.ts plugins/office/client/pixel/actors.test.ts plugins/office/client/pixel/pixel-office.tsx docs/plugins.md
git add plugins/office/client/pixel docs/plugins.md
git commit -m "feat(office): whoever rests takes turns in the 2D office's lounge"
```

Expected: typecheck prints no error; 26 and 24 tests pass; lint prints no error; the commit succeeds.

---

### Task 6b: The 2D rocket follows the same rule

**Files:**

- Modify: `plugins/office/client/pixel/actors.ts` (the `WORK` table and the end of `standingOf`)
- Test: `plugins/office/client/pixel/actors.test.ts`

**Interfaces:**

- Consumes: `standingOf(session, step, onBreak, meeting, rest)` from Task 6; `ActivityStep.result` (`"passed" | "failed"`), which Task 2 sets on a deploy's step when it ends.
- Produces: nothing new. In 2D the rocket flies when an agent stands at the pad (`pixel-office.tsx`, `shipping`), and after this task only a deploy that succeeded stands there.

The spec's rule for the rocket is about what it means (something shipped), so it holds in 2D too: a plain push keeps its "ship" icon at the desk and no longer flies the rocket; a deploy works at the racks while it runs, and stands at the pad (the rocket flies) only when it succeeded; one that failed stays at the racks with the failure icon. The flight lasts 2.6 s (`FLIGHT_MS`), less than the host's 5 s between reads, so the stand at the pad is long enough to see it.

- [ ] **Step 1: Write the failing test**

In `plugins/office/client/pixel/actors.test.ts`, in the test "sends each kind of work to its place", replace

```text
    expect(at("push")).toEqual({ place: "pad", icon: "ship", screen: "code" });
    expect(at("deploy")).toEqual({ place: "pad", icon: "ship", screen: "code" });
```

with

```text
    // A push no longer flies the rocket: the agent pushes from the desk.
    expect(at("push")).toEqual({ place: null, icon: "ship", screen: "code" });
    // A deploy that runs works at the racks; the rocket waits for its success.
    expect(at("deploy")).toEqual({ place: "racks", icon: "ship", screen: "code" });
```

and add after that test, inside the same `describe("standingOf", …)`:

```text
  it("flies the rocket only for a deploy that succeeded", () => {
    const ended = (result: "passed" | "failed") =>
      standingOf(session("a"), { ...step("deploy"), result }, false, false);
    expect(ended("passed")).toEqual({ place: "pad", icon: "ship", screen: "code" });
    expect(ended("failed")).toEqual({ place: "racks", icon: "failed", screen: "code" });
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run plugins/office/client/pixel/actors.test.ts --bail=1`
Expected: FAIL in "sends each kind of work to its place": `at("push")` is `{ place: "pad", … }`.

- [ ] **Step 3: Change the table and the end of `standingOf`**

In `plugins/office/client/pixel/actors.ts`, replace

```text
  push: { place: "pad", icon: "ship" },
  deploy: { place: "pad", icon: "ship" },
```

with

```text
  // The pad is for a deploy that succeeded (standingOf): a push is shipped from the desk.
  push: { place: null, icon: "ship" },
  deploy: { place: "racks", icon: "ship" },
```

and replace

```text
  const work = WORK[step.kind];
  // A test run that ended shows how, where it ran.
  return { place: work.place, icon: step.result ?? work.icon, screen: "code" };
```

with

```text
  // A deploy that succeeded stands at the pad, where its rocket flies.
  if (step.kind === "deploy" && step.result === "passed") {
    return { place: "pad", icon: "ship", screen: "code" };
  }
  const work = WORK[step.kind];
  // A test run or a deploy that ended shows how, where it ran.
  return { place: work.place, icon: step.result ?? work.icon, screen: "code" };
```

In `plugins/office/client/pixel/pixel-office.tsx`, replace the comment

```text
/** The rocket on its pad. It flies when somebody pushes or deploys, and is back for the next. */
```

with

```text
/** The rocket on its pad. It flies when a deploy succeeds, and is back for the next. */
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run plugins/office/client/pixel/actors.test.ts --bail=1`
Expected: PASS, every test of the file.

- [ ] **Step 5: Check and commit**

```bash
cd /workspace/QFlavours/paseo
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/client/pixel/actors.ts plugins/office/client/pixel/pixel-office.tsx
npm run format:files -- plugins/office/client/pixel/actors.ts plugins/office/client/pixel/actors.test.ts plugins/office/client/pixel/pixel-office.tsx
git add plugins/office/client/pixel/actors.ts plugins/office/client/pixel/actors.test.ts plugins/office/client/pixel/pixel-office.tsx
git commit -m "feat(office): the 2D rocket flies for a deploy that succeeded, not a push"
```

### Task 7: Look at it in a browser, and write down what was seen

**Files:**

- Create (git-ignored, not committed): `.superpowers/lively-check/scene.js`, `floor.jsx`, `clock.js`, `ui.js`, `build.mjs`, `out/3d.html`, `out/2d.html`
- Modify: `docs/superpowers/specs/2026-11-16-office-lively-floor-design.md` (status, "Not verified", one line of "Not built")
- Modify: `docs/superpowers/specs/2026-11-16-office-owner-review-design.md` (status)

**Interfaces:**

- Consumes: everything above, built. From Task 5: `leisureNow(id, kind)`. From the scene: `PaseoOfficeWorld` (`start`, `setSessions`, `event`, `meet`).

The check uses two static pages and no app: the daemon on port 6767 is not touched and no agent is created. A static page shows the scene and the plugin's own 2D component only, not the app around them. The test browser (Paseo's browser tools) runs in another container, draws WebGL with software at about two frames a second, and reaches this machine at the first address of `hostname -i`.

- [ ] **Step 1: Write the two pages**

```bash
mkdir -p /workspace/QFlavours/paseo/.superpowers/lively-check/out
```

Create `.superpowers/lively-check/scene.js`:

```text
// The 3D office in a page of its own, with made-up agents: what Task 7 of the lively floor's plan looks at.
import '../../plugins/office/vendor/my-office/src/office/paseo-entry.js';
import { state } from '../../plugins/office/vendor/my-office/src/office/core/state.js';
import { sessions, workers } from '../../plugins/office/vendor/my-office/src/office/people/workers.js';
import { leisureNow } from '../../plugins/office/vendor/my-office/src/office/paseo-leisure.js';
import { gatheringNow } from '../../plugins/office/vendor/my-office/src/office/people/gatherings.js';
import { bilState } from '../../plugins/office/vendor/my-office/src/office/people/billiards.js';
import { foosState } from '../../plugins/office/vendor/my-office/src/office/people/foosball.js';
import { tvState } from '../../plugins/office/vendor/my-office/src/office/people/gaming.js';
import { ktvState } from '../../plugins/office/vendor/my-office/src/office/people/karaoke.js';
import { PROPS } from '../../plugins/office/vendor/my-office/src/office/interact/props.js';
import { rocketState } from '../../plugins/office/vendor/my-office/src/office/world/room-update.js';

const NAMES = ['Ada', 'Brook', 'Cy', 'Dee', 'Eli', 'Fay'];
const people = NAMES.map((name, i) => ({ id: `a${i + 1}`, name, title: name, dir: 'shop', git: { repo: 'shop' }, status: 'rest', agent: 'claude', lastPrompt: '', stuck: false, subs: [] }));
const errors = [], toasts = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
const world = window.PaseoOfficeWorld;
world.start({ plan: new URLSearchParams(location.search).get('plan') === 'cozy' ? 'cozy' : 'pro', dark: false, colors: {}, onSelect() {}, onBoard() {}, onProblem: (m) => errors.push(`problem: ${m}`), onToast: (t) => toasts.push(t) });
world.setSessions(people);
const set = (id, status) => { people.find((p) => p.id === id).status = status; world.setSessions(people.map((p) => ({ ...p }))); };
window.T = {
  errors, toasts,
  /** The scene's clock runs `n` times as fast: the test browser draws about two frames a second. */
  speed(n) { state.speed = n; },
  /** One activity now: 'pool' | 'foosball' | 'tv' | 'karaoke' | 'nap' | 'fish' | 'arcade' | 'cup' | 'wc'. Answers who went, or null. */
  go: (id, kind) => leisureNow(id, kind),
  /** A prompt for the agent, and the end of its turn. */
  work(id) { set(id, 'work'); world.event({ sess: id, type: 'prompt' }); },
  rest(id) { set(id, 'rest'); world.event({ sess: id, type: 'stop' }); },
  /** What the adapter sends: T.event('a2', 'push'), T.event('a2', 'deploy'), T.event('a2', 'fail', 'deploy'). */
  event: (id, type, of) => world.event({ sess: id, type, of }),
  /** A click on the bell, on 'billiards', 'gametv', 'karaoke'. */
  click: (prop) => PROPS.get(prop).act(),
  /** The stand-up card's bell. */
  meet: () => world.meet(),
  who: () => [...workers].map(([id, w]) => `${id} ${sessions.get(id).status} ${w.station} ${w.anim} ${w.phase}${w.chore ? ` chore:${w.chore.stage}` : ''}${w.wcBusy ? ' wc' : ''} @${w.pos.x.toFixed(1)},${w.pos.y.toFixed(1)}`),
  games: () => ({ pool: bilState().stage, foosball: !!foosState(), tv: tvState().stage, karaoke: ktvState().stage, gathering: !!gatheringNow(), rocket: rocketState.t >= 0, deploys: state.stats.deploy || 0, sim: Math.round(state.sim) }),
  bubbles: () => [...document.querySelectorAll('.bubble')].filter((b) => b.offsetParent !== null).map((b) => b.textContent),
};
```

Create `.superpowers/lively-check/clock.js`:

```text
// ?at=10:00 pretends it is that time today, as the 3D scene's own page does.
const at = /^(\d{1,2}):(\d{2})$/.exec(new URLSearchParams(location.search).get("at") ?? "");
if (at) {
  const real = Date.now.bind(Date);
  const today = new Date();
  const wanted = new Date(today.getFullYear(), today.getMonth(), today.getDate(), +at[1], +at[2]);
  const shift = wanted.getTime() - real();
  Date.now = () => real() + shift;
}
```

Create `.superpowers/lively-check/ui.js`:

```text
// Stands in for the host's kit: the 2D office takes its scroll view from it.
export { ScrollView } from "react-native";
```

Create `.superpowers/lively-check/floor.jsx`:

```text
// The real 2D office in a page of its own, with made-up agents: what Task 7 of the lively floor's plan looks at.
import "./clock.js";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { buildOfficeModel } from "../../plugins/office/client/model.js";
import { PixelOffice } from "../../plugins/office/client/pixel/pixel-office.js";

const NAMES = ["Ada", "Brook", "Cy", "Dee", "Eli", "Fay", "Gus", "Hana"];
const THEME = { colors: { surface0: "#ffffff" } };
const nothing = () => undefined;

function Page() {
  // window.officeWork(["a2"]) puts those agents to work; everyone else rests.
  const [working, setWorking] = useState([]);
  const [meeting, setMeeting] = useState(false);
  window.officeWork = setWorking;
  window.officeMeeting = setMeeting;
  const model = buildOfficeModel({
    agents: NAMES.map((name, index) => ({
      id: `a${index + 1}`,
      title: name,
      provider: "claude",
      model: null,
      status: working.includes(`a${index + 1}`) ? "running" : "idle",
      workspaceId: "w1",
      parentAgentId: null,
      permissions: [],
      createdAt: `2026-11-16T00:00:0${index}Z`,
    })),
    workspaces: [{ id: "w1", name: "shop-api", projectName: "shop" }],
    activity: {},
    doing: {},
    boards: {},
    wake: { paused: false, queued: {} },
  });
  return (
    <PixelOffice
      model={model}
      rooms={model.rooms}
      theme={THEME}
      focusRoomId={null}
      focusRequest={null}
      onSelectAgent={nothing}
      onSelectBoard={nothing}
      machine={null}
      onOpenMachine={nothing}
      janitor={null}
      onOpenJanitor={nothing}
      meeting={meeting}
    />
  );
}

createRoot(document.getElementById("root")).render(<Page />);
```

Create `.superpowers/lively-check/build.mjs`:

```text
// Builds the two pages with the repo's esbuild, as packages/server/src/server/plugins/browser-script.ts builds the scene.
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const esbuild = createRequire(new URL("../../packages/server/package.json", import.meta.url))("esbuild");
const common = { bundle: true, format: "iife", platform: "browser", target: "es2020", logLevel: "warning" };
await esbuild.build({ ...common, entryPoints: [`${here}scene.js`], outfile: `${here}out/scene.js` });
await esbuild.build({
  ...common,
  entryPoints: [`${here}floor.jsx`],
  outfile: `${here}out/floor.js`,
  jsx: "automatic",
  alias: { "react-native": "react-native-web", "@getpaseo/plugin/client/ui": `${here}ui.js` },
  define: { "process.env.NODE_ENV": '"production"', __DEV__: "false", global: "window" },
});
console.log("built out/scene.js and out/floor.js");
```

Create `.superpowers/lively-check/out/3d.html`:

```text
<!doctype html><html><head><meta charset="utf-8"><title>3D office</title><style>html,body{height:100%;margin:0}</style></head><body><script src="scene.js"></script></body></html>
```

Create `.superpowers/lively-check/out/2d.html`:

```text
<!doctype html><html><head><meta charset="utf-8"><title>2D office</title><style>html,body,#root{height:100%;margin:0}#root{display:flex}</style></head><body><div id="root"></div><script src="floor.js"></script></body></html>
```

- [ ] **Step 2: Build and serve them**

```bash
cd /workspace/QFlavours/paseo
node .superpowers/lively-check/build.mjs
hostname -i
```

Expected: `built out/scene.js and out/floor.js`, then this machine's addresses; the first one is `ADDRESS` below.

Start the server as a background command (it runs until stopped in Step 6):

```bash
python3 -m http.server 8791 --bind 0.0.0.0 --directory /workspace/QFlavours/paseo/.superpowers/lively-check/out
```

If the build or the browser cannot be used, do not start a daemon or an app instead: go to Step 7 and write that the look was not done, with the reason.

- [ ] **Step 3: The 3D scene at 10:00**

Open `http://ADDRESS:8791/3d.html?at=10:00` (`browser_new_tab`). Every call below is a `browser_evaluate` of a function; keep each call short and without waiting inside it (the page answers slowly, and a call that waits times out), and take a `browser_screenshot` where one is named. At `T.speed(10)` the scene's clock runs at about twice real time in the test browser, so a nap of 3 to 6 minutes is over in about two; start an activity again with `T.go` when it ended before it was looked at. `T.who()` lists each agent's state, station, pose and position; `T.games()` the games, the gathering, the rocket and the count of deploys; `T.bubbles()` the lines shown; `T.errors` what the page threw.

1. `() => ({ who: T.who(), games: T.games(), errors: T.errors })`
   Expected: six agents `rest desk sleep`, no game, `errors` empty.
2. `() => { T.speed(10); return { fish: T.go('a1', 'fish'), arcade: T.go('a2', 'arcade'), cup: T.go('a3', 'cup'), nap: T.go('a4', 'nap'), wc: T.go('a5', 'wc') }; }`
   Expected: each answers its own id in a list (`["a1"]` and so on). A moment later `T.bubbles()` has "Feeding the fish", "One round at the arcade", "Making a coffee", "Quick nap" and "Back in a minute", and after about half a minute `T.who()` shows a2 `errand console` near x 13, a3 `errand coffee` seated in the dining room (x about 10 to 13, z about -5 or -1), a4 `errand sleep` on the sofa (near 10.5, 3.8), and a1 and a5 on their way back or asleep at their desks. Screenshot.
3. `() => { T.work('a2'); return T.who(); }`, then `T.who()` again a few seconds later.
   Expected: a2 is `chore:back` and walking, then `work` at its desk or at the board with its prompt: it left the arcade at once.
4. `() => { T.click('bell'); return { who: T.who(), games: T.games() }; }`
   Expected: `gathering: true`; a3 and a4 are `errand idle` and standing where they were (not `coffee`, not `sleep`), then walk to the meeting table with the others. After the gathering they are at their desks, not back at the chair or the sofa.
5. Leave it for about two minutes at `T.speed(10)` and read `T.who()` and `T.games()` a few times.
   Expected: agents leave their desks by themselves, and over the readings a game shows (`pool`, `tv` or `karaoke` not null, or `foosball: true`) with two agents in `errand` near it. `T.errors` stays empty.
6. With everyone back or not: `() => ({ pool: T.go('a1', 'pool'), foosball: T.go('a1', 'foosball'), tv: T.go('a1', 'tv'), karaoke: T.go('a1', 'karaoke') })` when at least two agents are asleep at their desks (wait, or `T.rest('a2')`).
   Expected: each answers the players' ids, or null when that game is on already or too few are free. Across this step and the last, each of the four games was seen once: for each, a screenshot with its players at the table, the sofa or the booth.
7. `() => { T.click('billiards'); T.click('gametv'); T.click('karaoke'); return T.toasts; }`
   Expected: a toast for each: who is playing or was called, or that nobody is free.
8. `() => { T.work('a6'); T.event('a6', 'push'); const push = T.games().rocket; T.event('a6', 'bash'); return { push, start: T.games().rocket }; }`
   Expected: `push` and `start` are false: a push and a deploy that starts launch nothing. A few seconds later a6 stands at the console in the server room (`server`, near -6.5, -2.5).
9. `() => { T.event('a6', 'fail', 'deploy'); return T.games().rocket; }`, then `() => ({ bubbles: T.bubbles(), who: T.who() })` about three seconds later.
   Expected: false; the bubbles have "The deploy failed" and a6 is `sweat`. The same call again within two minutes: "Not again! The deploy failed" and a6 is `slam`.
10. `() => { T.event('a6', 'deploy'); return T.games(); }`
    Expected: `rocket` is true and `deploys` is 1. A few seconds later a6 is `server celebrate`. Screenshot with the rocket in the air if the frame rate allows.
11. `() => T.errors` and `browser_logs`.
    Expected: no error.

- [ ] **Step 4: The 3D scene at 22:00, and the one-room floor**

Open `http://ADDRESS:8791/3d.html?at=22:00`, call `() => T.speed(40)`, wait a minute, then `() => ({ who: T.who(), games: T.games(), errors: T.errors })`.
Expected: `sim` is past 200, everyone is still `rest desk sleep`, no game is on.

Open `http://ADDRESS:8791/3d.html?at=10:00&plan=cozy` and call `() => ({ fish: T.go('a1', 'fish'), arcade: T.go('a2', 'arcade'), cup: T.go('a3', 'cup'), nap: T.go('a4', 'nap'), wc: T.go('a5', 'wc'), pool: T.go('a6', 'pool'), errors: T.errors })`.
Expected: the fish and the arcade answer their ids, the rest null (that floor has no dining room, sofa, restroom or pool table), and `errors` is empty.

- [ ] **Step 5: The 2D office**

Open `http://ADDRESS:8791/2d.html?at=10:00` at about 1024 px wide and take a screenshot.
Expected: eight desks; four of the eight agents are in the lounge: two on the sofa, one in front of the plant with their back to the room, one at the coffee machine under a cup; their chairs are empty. Nobody shares a spot.

Open `…/2d.html?at=10:03`.
Expected: the other four agents are in the lounge, and the first four are at their desks.

`() => window.officeWork(['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8'])`, then a screenshot; then `() => { window.officeWork([]); window.officeMeeting(true); }` and a screenshot.
Expected: first everyone at the desk with the screen on; then everyone at the whiteboard: a stand-up comes before the coffee after a turn and before the lounge.

Open `…/2d.html?at=22:00`.
Expected: everyone at the desk, screens off.

`browser_resize` to 390 px wide and open `…/2d.html?at=10:00` again.
Expected: four desks to a row, the sofa is drawn, and the lounge's people do not overlap.

- [ ] **Step 6: Stop the server and close the tabs**

Stop the background `python3 -m http.server` command, and close the browser tabs (`browser_close_tab`). `.superpowers/` is git-ignored: `git status --short` shows nothing of it.

- [ ] **Step 7: Write down the state in the specs**

In `docs/superpowers/specs/2026-11-16-office-lively-floor-design.md`, replace

```text
Date: 2026-11-16. Status: design approved by the owner; not built. Sub-project 2 of
```

with

```text
Date: 2026-11-16. Status: built. Sub-project 2 of
```

Replace

```text
## Not built

- New 2D art for the pool table, the TV, foosball, the arcade or the aquarium.
```

with

```text
## Not verified

- A real graphics card: the test browser draws with software at about two frames a second, and the
  scene's clock was run faster to see an activity through.
- The office inside the app, with real agents: the scene and the 2D office were looked at in static
  pages with made-up agents. A real deploy's end, read by the host 5 s apart, is covered by the
  unit tests only.
- The walk home at night: the pages' agents carry no time of their last activity, so nobody had
  rested 30 minutes.
- The installed app on a phone.

## Not built

- New 2D art for the pool table, the TV, foosball, the arcade or the aquarium.
```

Keep in "Not verified" only what was in fact not seen: remove a line that Steps 3 to 5 did see, and add one for anything else that could not be checked, with the reason (a game that never showed, a page that would not build).

In `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`, replace

```text
Date: 2026-11-16. Status: sub-project 1 is built; the others are not.
```

with

```text
Date: 2026-11-16. Status: sub-projects 1 and 2 are built; the others are not.
```

- [ ] **Step 8: Commit**

```bash
cd /workspace/QFlavours/paseo
npm run format:files -- docs/superpowers/specs/2026-11-16-office-lively-floor-design.md docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git add docs/superpowers/specs/2026-11-16-office-lively-floor-design.md docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git commit -m "docs(office): the lively floor is built"
```
