# A move carries schedules, heartbeats and finish notifications: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a move or a move back, schedules and heartbeats aimed at the agent that was left are aimed at its successor, a finish notification for a watcher that moved reaches its successor, and the parent of a moved sub-agent that continues is told when the successor finishes.

**Architecture:** `ScheduleService.retargetAgent` rewrites schedule targets. `resolveMovedAgent` follows moved-to labels to the live agent, and the finish subscriptions use it in place of the yes/no caller check. The move reaches both stores through one `MoveCarry` object that `bootstrap.ts` hands to `AgentManager`, so the two places that start a move need no change.

**Tech stack:** TypeScript, vitest, the daemon in `packages/server`.

Spec: `docs/superpowers/specs/2026-11-13-move-carries-schedules-and-notifications-design.md`.

## Global constraints

- Work in the worktree `/workspace/QFlavours/paseo/.claude/worktrees/move-carries`, branch `feat/move-carries-schedules-and-notifications`. Another agent uses the main checkout.
- Commit subjects follow the fork's style: `feat(fork): ...`, `test(fork): ...`, `docs(fork): ...`. No `Co-Authored-By: Claude` trailer and no "Generated with" line.
- Never run a whole workspace's tests. Run one file: `cd packages/server && npx vitest run <file> --bail=1`.
- After each task: `npm run typecheck` (repo root; run `npm run build:server` first if declarations are stale), `npm run lint -- <changed files>`, `npm run format:files -- <changed files>`.
- Tests clear this container's Paseo password first: prefix e2e runs with `env -u PASEO_PASSWORD -u PASEO_PASSWORD_HASH`.
- No protocol change. Nothing in `packages/protocol` or `packages/app` is touched.
- Schedule content other than `target.agentId` and `updatedAt` is never changed by a move.

## File map

| File                                                                                  | Change                                                                                       |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `packages/server/src/server/schedule/service.ts`                                      | add `retargetAgent`                                                                          |
| `packages/server/src/server/schedule/service.test.ts`                                 | tests for `retargetAgent`                                                                    |
| `packages/server/src/server/agent/session-move/move-agent.ts`                         | `resolveMovedAgent`, `movedAgentLookup`; `finish`/`undoFinish`/`continueAgent` use the carry |
| `packages/server/src/server/agent/session-move/move-agent.test.ts`                    | tests for `resolveMovedAgent`                                                                |
| `packages/server/src/server/agent/session-move/move-carry.ts`                         | new: the `MoveCarry` interface                                                               |
| `packages/server/src/server/agent/agent-manager.ts`                                   | `setMoveCarry`, `moveCarry`                                                                  |
| `packages/server/src/server/agent/finish-subscriptions/index.ts`                      | `resolveCaller` replaces `callerIsActive`; re-point a moved watcher                          |
| `packages/server/src/server/agent/finish-subscriptions/finish-subscriptions.test.ts`  | tests for the moved watcher                                                                  |
| `packages/server/src/server/agent/mcp-server.test.ts`                                 | its `callerIsActive` stub becomes `resolveCaller`                                            |
| `packages/server/src/server/bootstrap.ts`                                             | wire `resolveCaller` and the carry                                                           |
| `packages/server/src/server/agent/session-move/move-agent.e2e.test.ts`                | end-to-end cases                                                                             |
| `docs/superpowers/specs/2026-11-05-session-move-design.md`, `docs/agent-lifecycle.md` | rewrite the limit sentence                                                                   |

---

### Task 1: `ScheduleService.retargetAgent`

**Files:**

- Modify: `packages/server/src/server/schedule/service.ts` (next to `completeForAgent`, about line 509)
- Test: `packages/server/src/server/schedule/service.test.ts` (after the test "completeForAgent completes only schedules targeting that agent", about line 3071)

**Interfaces:**

- Produces: `ScheduleService.retargetAgent(fromAgentId: string, toAgentId: string, only?: readonly string[]): Promise<string[]>`, returning the ids it changed.

- [ ] **Step 1: Write the failing tests**

Add after the `completeForAgent completes only schedules targeting that agent` test, inside the same `describe`:

```ts
test("retargetAgent points an agent's open schedules at another agent and nothing else", async () => {
  const service = createScheduleService({
    paseoHome: tempDir,
    logger: createTestLogger(),
    agentManager: new AgentManager({ logger: createTestLogger() }),
    agentStorage,
    providerSnapshotManager: NO_UNATTENDED_SCHEDULE_POLICY,
    now: () => now,
    runner: async () => ({ agentId: null, output: "ok" }),
  });
  const fromId = "11111111-1111-4111-8111-111111111111";
  const toId = "33333333-3333-4333-8333-333333333333";
  const otherId = "22222222-2222-4222-8222-222222222222";
  const cadence = { type: "every", everyMs: 60_000 } as const;

  const carried = await service.create({
    name: "heartbeat",
    prompt: "check the build",
    cadence,
    target: { type: "agent", agentId: fromId },
    runOnCreate: false,
  });
  const paused = await service.create({
    prompt: "paused one",
    cadence,
    target: { type: "agent", agentId: fromId },
    runOnCreate: false,
  });
  await service.pause(paused.id);
  const other = await service.create({
    prompt: "someone else's",
    cadence,
    target: { type: "agent", agentId: otherId },
    runOnCreate: false,
  });
  const before = await service.inspect(carried.id);

  now = new Date("2026-01-01T00:05:00.000Z");
  const ids = await service.retargetAgent(fromId, toId);

  expect(ids.sort()).toEqual([carried.id, paused.id].sort());
  const after = await service.inspect(carried.id);
  expect(after.target).toEqual({ type: "agent", agentId: toId });
  expect(after.updatedAt).toBe("2026-01-01T00:05:00.000Z");
  expect({ ...after, target: before.target, updatedAt: before.updatedAt }).toEqual(before);
  const pausedAfter = await service.inspect(paused.id);
  expect(pausedAfter.target).toEqual({ type: "agent", agentId: toId });
  expect(pausedAfter.status).toBe("paused");
  expect((await service.inspect(other.id)).target).toEqual({ type: "agent", agentId: otherId });
});

test("retargetAgent leaves a completed schedule with the agent it had", async () => {
  const service = createScheduleService({
    paseoHome: tempDir,
    logger: createTestLogger(),
    agentManager: new AgentManager({ logger: createTestLogger() }),
    agentStorage,
    providerSnapshotManager: NO_UNATTENDED_SCHEDULE_POLICY,
    now: () => now,
    runner: async () => ({ agentId: null, output: "ok" }),
  });
  const fromId = "11111111-1111-4111-8111-111111111111";
  const completed = await service.create({
    prompt: "done",
    cadence: { type: "every", everyMs: 60_000 },
    target: { type: "agent", agentId: fromId },
    runOnCreate: false,
  });
  await service.completeForAgent(fromId);

  expect(await service.retargetAgent(fromId, "33333333-3333-4333-8333-333333333333")).toEqual([]);
  expect((await service.inspect(completed.id)).target).toEqual({
    type: "agent",
    agentId: fromId,
  });
});

test("retargetAgent with a list of ids touches only those", async () => {
  const service = createScheduleService({
    paseoHome: tempDir,
    logger: createTestLogger(),
    agentManager: new AgentManager({ logger: createTestLogger() }),
    agentStorage,
    providerSnapshotManager: NO_UNATTENDED_SCHEDULE_POLICY,
    now: () => now,
    runner: async () => ({ agentId: null, output: "ok" }),
  });
  const fromId = "11111111-1111-4111-8111-111111111111";
  const toId = "33333333-3333-4333-8333-333333333333";
  const cadence = { type: "every", everyMs: 60_000 } as const;
  const first = await service.create({
    prompt: "first",
    cadence,
    target: { type: "agent", agentId: fromId },
    runOnCreate: false,
  });
  const second = await service.create({
    prompt: "second",
    cadence,
    target: { type: "agent", agentId: fromId },
    runOnCreate: false,
  });

  expect(await service.retargetAgent(fromId, toId, [second.id])).toEqual([second.id]);
  expect((await service.inspect(first.id)).target).toEqual({ type: "agent", agentId: fromId });
  expect((await service.inspect(second.id)).target).toEqual({ type: "agent", agentId: toId });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd packages/server && npx vitest run src/server/schedule/service.test.ts -t retargetAgent --bail=1`
Expected: FAIL, `service.retargetAgent is not a function`.

- [ ] **Step 3: Implement**

In `service.ts`, directly above `async completeForAgent(`:

```ts
  /**
   * Points every not-completed schedule aimed at `fromAgentId` at `toAgentId` and returns their
   * ids. A session move calls this before it archives the agent it leaves, so the archive finds
   * nothing to complete. With `only`, just those ids change, which is how a failed move undoes it.
   */
  async retargetAgent(
    fromAgentId: string,
    toAgentId: string,
    only?: readonly string[],
  ): Promise<string[]> {
    const updatedAt = this.now().toISOString();
    const retargeted: string[] = [];
    for (const candidate of await this.store.list()) {
      if (only && !only.includes(candidate.id)) continue;
      await this.store.update(candidate.id, (schedule) => {
        if (
          schedule.target.type !== "agent" ||
          schedule.target.agentId !== fromAgentId ||
          schedule.status === "completed"
        ) {
          return schedule;
        }
        retargeted.push(schedule.id);
        return { ...schedule, target: { ...schedule.target, agentId: toAgentId }, updatedAt };
      });
    }
    return retargeted;
  }
```

- [ ] **Step 4: Run and watch them pass**

Run: `cd packages/server && npx vitest run src/server/schedule/service.test.ts -t "retargetAgent|completeForAgent" --bail=1`
Expected: PASS, 4 tests.

- [ ] **Step 5: Check and commit**

```bash
npm run typecheck && npm run lint -- packages/server/src/server/schedule/service.ts packages/server/src/server/schedule/service.test.ts
npm run format:files -- packages/server/src/server/schedule/service.ts packages/server/src/server/schedule/service.test.ts
git add packages/server/src/server/schedule && git commit -m "feat(fork): schedules aimed at one agent can be pointed at another"
```

---

### Task 2: `resolveMovedAgent`

**Files:**

- Modify: `packages/server/src/server/agent/session-move/move-agent.ts` (below `resolveMoveBackChain`, about line 615)
- Test: `packages/server/src/server/agent/session-move/move-agent.test.ts`

**Interfaces:**

- Produces:
  - `type MovedAgentLookup = (agentId: string) => Promise<{ archived: boolean; labels: Record<string, string> } | null>`
  - `resolveMovedAgent(agentId: string, lookup: MovedAgentLookup): Promise<string | null>`
  - `movedAgentLookup(deps: Pick<MoveAgentDeps, "agentManager" | "agentStorage">): MovedAgentLookup`

- [ ] **Step 1: Write the failing tests**

Append to `move-agent.test.ts` (extend the imports to `import { MOVED_FROM_AGENT_ID_LABEL, MOVED_TO_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";` and `import { resolveMoveBackChain, resolveMovedAgent } from "./move-agent.js";`):

```ts
/** `to: string` is an archived agent that moved there; "live" is not archived; "dead" is archived with no link. */
function moved(agents: Record<string, string>) {
  return async (agentId: string) => {
    const state = agents[agentId];
    if (state === undefined) return null;
    if (state === "live") return { archived: false, labels: {} };
    if (state === "dead") return { archived: true, labels: {} };
    return { archived: true, labels: { [MOVED_TO_AGENT_ID_LABEL]: state } };
  };
}

describe("resolveMovedAgent", () => {
  test("an agent that is not archived is itself", async () => {
    expect(await resolveMovedAgent("a", moved({ a: "live" }))).toBe("a");
  });

  test("follows one move", async () => {
    expect(await resolveMovedAgent("a", moved({ a: "b", b: "live" }))).toBe("b");
  });

  test("follows two moves", async () => {
    expect(await resolveMovedAgent("a", moved({ a: "b", b: "c", c: "live" }))).toBe("c");
  });

  test("is null when the chain ends at an archived agent with no link", async () => {
    expect(await resolveMovedAgent("a", moved({ a: "b", b: "dead" }))).toBeNull();
  });

  test("is null when an agent in the chain has no record", async () => {
    expect(await resolveMovedAgent("a", moved({ a: "gone" }))).toBeNull();
    expect(await resolveMovedAgent("missing", moved({}))).toBeNull();
  });

  test("is null for a loop", async () => {
    expect(await resolveMovedAgent("a", moved({ a: "b", b: "a" }))).toBeNull();
  });

  test("a live agent ends the walk whatever stale label it carries", async () => {
    const lookup = async (agentId: string) =>
      agentId === "a"
        ? { archived: false, labels: { [MOVED_TO_AGENT_ID_LABEL]: "b" } }
        : { archived: false, labels: {} };
    expect(await resolveMovedAgent("a", lookup)).toBe("a");
  });
});
```

- [ ] **Step 2: Run and watch them fail**

Run: `cd packages/server && npx vitest run src/server/agent/session-move/move-agent.test.ts --bail=1`
Expected: FAIL, `resolveMovedAgent` is not exported.

- [ ] **Step 3: Implement**

In `move-agent.ts`, add `getMovedToAgentId` to the existing `@getpaseo/protocol/agent-labels` import, then below `resolveMoveBackChain`:

```ts
export type MovedAgentLookup = (
  agentId: string,
) => Promise<{ archived: boolean; labels: Record<string, string> } | null>;

/**
 * The agent that carries `agentId`'s session now: follows moved-to links from an archived agent
 * until one that is not archived. Null when the chain ends at an archived agent with no link, at
 * an agent with no record, or in a loop.
 */
export async function resolveMovedAgent(
  agentId: string,
  lookup: MovedAgentLookup,
): Promise<string | null> {
  const seen = new Set<string>();
  let current = agentId;
  while (!seen.has(current) && seen.size < MAX_MOVE_CHAIN) {
    seen.add(current);
    const state = await lookup(current);
    if (!state) return null;
    if (!state.archived) return current;
    const next = getMovedToAgentId(state.labels);
    if (!next) return null;
    current = next;
  }
  return null;
}

/** An internal agent has no record and is live while the manager holds it. */
export function movedAgentLookup(
  deps: Pick<MoveAgentDeps, "agentManager" | "agentStorage">,
): MovedAgentLookup {
  return async (agentId) => {
    const record = await deps.agentStorage.get(agentId);
    if (record) return { archived: Boolean(record.archivedAt), labels: record.labels };
    const live = deps.agentManager.getAgent(agentId);
    return live ? { archived: false, labels: live.labels } : null;
  };
}
```

- [ ] **Step 4: Run and watch them pass**

Run: `cd packages/server && npx vitest run src/server/agent/session-move/move-agent.test.ts --bail=1`
Expected: PASS, 12 tests.

- [ ] **Step 5: Check and commit**

```bash
npm run typecheck && npm run lint -- packages/server/src/server/agent/session-move/move-agent.ts packages/server/src/server/agent/session-move/move-agent.test.ts
npm run format:files -- packages/server/src/server/agent/session-move/move-agent.ts packages/server/src/server/agent/session-move/move-agent.test.ts
git add packages/server/src/server/agent/session-move && git commit -m "feat(fork): find the agent that carries a moved session now"
```

---

### Task 3: a finish notification follows a watcher that moved

**Files:**

- Modify: `packages/server/src/server/agent/finish-subscriptions/index.ts`
- Modify: `packages/server/src/server/bootstrap.ts` (the `callerIsActive` block, about line 1581)
- Modify: `packages/server/src/server/agent/mcp-server.test.ts:896`
- Test: `packages/server/src/server/agent/finish-subscriptions/finish-subscriptions.test.ts`

**Interfaces:**

- Consumes: `resolveMovedAgent`, `movedAgentLookup` from Task 2.
- Produces: `Dependencies.resolveCaller(agentId: string): Promise<string | null>` in place of `callerIsActive`. Null means "nobody to tell"; another id means "tell that agent and remember it".

- [ ] **Step 1: Give the test scenario a watcher that can move**

In `finish-subscriptions.test.ts`, inside `scenario`, replace

```ts
let active = true;
```

with

```ts
let active = true;
let successor: string | null = null;
```

replace

```ts
    callerIsActive: async () => active,
```

with

```ts
    resolveCaller: async (agentId) => successor ?? (active ? agentId : null),
```

and extend the returned object:

```ts
    archive: () => {
      active = false;
    },
    moveCallerTo: (agentId: string) => {
      active = false;
      successor = agentId;
    },
```

`Delivery.enqueue` records only the prompt. Add a `recipients: string[] = [];` field to the `Delivery` class and push `message.recipientId` at the top of `enqueue`:

```ts
this.recipients.push(message.recipientId);
```

- [ ] **Step 2: Write the failing tests**

Add after the test "archived parent suppresses delivery and removes obsolete intent":

```ts
test("a watcher that moved gets the notification at its successor, and the record names it", async () => {
  const state = await scenario();
  await state.service.register(intent);
  await until(() => state.observation.waits.length === 1);
  state.moveCallerTo("parent-2");
  state.observation.waits[0]!.result.resolve(outcome());
  await until(() => state.delivery.prompts.length === 1);
  expect(state.delivery.recipients).toEqual(["parent-2"]);
  expect((await state.store.list()).map((record) => record.callerAgentId)).toEqual(["parent-2"]);
  expect(state.service.hasPendingForCaller("parent-2")).toBe(true);
  expect(state.service.hasPendingForCaller("parent")).toBe(false);
  state.delivery.acknowledgments[0]!.resolve("steered");
  await expect.poll(async () => (await state.store.list()).length).toBe(0);
});

test("a restart after the watcher moved resumes with the successor", async () => {
  const first = await scenario();
  await first.service.register(intent);
  await until(() => first.observation.waits.length === 1);
  first.moveCallerTo("parent-2");
  first.observation.waits[0]!.result.resolve(outcome());
  await until(() => first.delivery.prompts.length === 1);
  await first.service.close();

  const restarted = await scenario(first.home);
  await until(() => restarted.observation.waits.length === 1);
  restarted.observation.waits[0]!.result.resolve(outcome());
  await until(() => restarted.delivery.prompts.length === 1);
  expect(restarted.delivery.recipients).toEqual(["parent-2"]);
});

test("a creation subscription still reports to a watcher that moved", async () => {
  const state = await scenario();
  await state.service.register({ ...intent, requireParentOwnership: true });
  await until(() => state.observation.waits.length === 1);
  state.moveCallerTo("parent-2");
  const reparented = outcome();
  reparented.final!.labels = { "paseo.parent-agent-id": "parent-2" };
  state.observation.waits[0]!.result.resolve(reparented);
  await until(() => state.delivery.prompts.length === 1);
  expect(state.delivery.recipients).toEqual(["parent-2"]);
});

test("a creation subscription for a detached child stops for a watcher that moved too", async () => {
  const state = await scenario();
  await state.service.register({ ...intent, requireParentOwnership: true });
  await until(() => state.observation.waits.length === 1);
  state.moveCallerTo("parent-2");
  const detached = outcome();
  detached.final!.labels = {};
  state.observation.waits[0]!.result.resolve(detached);
  await expect.poll(async () => (await state.store.list()).length).toBe(0);
  expect(state.delivery.prompts).toHaveLength(0);
});
```

- [ ] **Step 3: Run and watch them fail**

Run: `cd packages/server && npx vitest run src/server/agent/finish-subscriptions/finish-subscriptions.test.ts --bail=1`
Expected: FAIL at typecheck-in-test or at the first new test: `resolveCaller` is not a known dependency, and the notification is not delivered.

- [ ] **Step 4: Implement in `index.ts`**

In `Dependencies`, replace `callerIsActive(agentId: string): Promise<boolean>;` with:

```ts
  /**
   * Who to tell for this caller: itself while it is active, the agent its session moved to, or
   * null when neither exists.
   */
  resolveCaller(agentId: string): Promise<string | null>;
```

Replace the whole `suppressed` function with:

```ts
/** A creation subscription stops reporting once the child no longer belongs to the caller. */
function detached(record: FinishSubscription, result: WaitForFinishResult): boolean {
  if (!record.requireParentOwnership || !result.final) return false;
  const parent = getParentAddressFromLabels(result.final.labels, record.serverId ?? deps.serverId);
  return parent?.agentId !== record.callerAgentId || parent.serverId !== deps.serverId;
}
/** Files a watch whose records changed pair under its new key and returns that group. */
function refile(watch: Watch, group: Set<Watch>, records: FinishSubscription[]): Set<Watch> {
  group.delete(watch);
  if (!group.size && watches.get(key(watch.records[0]!)) === group)
    watches.delete(key(watch.records[0]!));
  watch.records = records;
  const next = watches.get(key(records[0]!)) ?? new Set<Watch>();
  next.add(watch);
  watches.set(key(records[0]!), next);
  return next;
}
```

In `run`, change the signature to `async function run(watch: Watch, initialGroup: Set<Watch>): Promise<void>`, and replace the `const record = {...}` declaration with:

```ts
let group = initialGroup;
let record = {
  ...watch.records[0]!,
  requireParentOwnership: watch.records.every((intent) => intent.requireParentOwnership === true),
};
/** False when nobody is left to tell. A caller that moved is replaced by its successor. */
async function followCaller(): Promise<boolean> {
  const caller = await deps.resolveCaller(record.callerAgentId);
  if (caller === null) return false;
  if (caller === record.callerAgentId) return true;
  const records = watch.records.map((intent) => ({ ...intent, callerAgentId: caller }));
  for (const intent of records) await deps.store.put(intent);
  group = refile(watch, group, records);
  record = { ...record, callerAgentId: caller };
  return true;
}
```

In the loop, replace the first check

```ts
          if (await suppressed(record)) {
```

with

```ts
          if (!(await followCaller())) {
```

and the second

```ts
          if (await suppressed(record, pending)) {
```

with

```ts
          if (!(await followCaller()) || detached(record, pending)) {
```

`Watch.records` is already a mutable field. Nothing else in the file names `suppressed` or `callerIsActive`; confirm with `grep -n "suppressed\|callerIsActive" packages/server/src/server/agent/finish-subscriptions/index.ts` (expect no output).

- [ ] **Step 5: Wire the real resolver**

In `bootstrap.ts`, replace

```ts
    callerIsActive: async (agentId) => {
      const record = await agentStorage.get(agentId);
      return record ? !record.archivedAt : Boolean(agentManager.getAgent(agentId));
    },
```

with

```ts
    resolveCaller: (agentId) =>
      resolveMovedAgent(agentId, movedAgentLookup({ agentManager, agentStorage })),
```

and add `import { movedAgentLookup, resolveMovedAgent } from "./agent/session-move/move-agent.js";` with the other agent imports.

In `mcp-server.test.ts:896`, replace

```ts
    callerIsActive: async (id) => !(await options.agentStorage.get(id))?.archivedAt,
```

with

```ts
    resolveCaller: async (id) => ((await options.agentStorage.get(id))?.archivedAt ? null : id),
```

- [ ] **Step 6: Run and watch them pass**

Run: `cd packages/server && npx vitest run src/server/agent/finish-subscriptions/finish-subscriptions.test.ts --bail=1`
Expected: PASS, 24 tests (20 existing, 4 new).

Run: `cd packages/server && npx vitest run src/server/agent/mcp-server.test.ts --bail=1 > /tmp/mcp-server-test.txt 2>&1; tail -5 /tmp/mcp-server-test.txt`
Expected: PASS.

- [ ] **Step 7: Check and commit**

```bash
npm run typecheck && npm run lint -- packages/server/src/server/agent/finish-subscriptions packages/server/src/server/bootstrap.ts packages/server/src/server/agent/mcp-server.test.ts
npm run format:files -- packages/server/src/server/agent/finish-subscriptions/index.ts packages/server/src/server/agent/finish-subscriptions/finish-subscriptions.test.ts packages/server/src/server/bootstrap.ts packages/server/src/server/agent/mcp-server.test.ts
git add packages/server/src/server && git commit -m "feat(fork): a finish notification follows a watcher whose session moved"
```

---

### Task 4: the move carries schedules and tells the parent

**Files:**

- Create: `packages/server/src/server/agent/session-move/move-carry.ts`
- Modify: `packages/server/src/server/agent/agent-manager.ts` (next to `setAgentArchivedCallback`, about line 1007, and the field next to `private onAgentArchived`, about line 913)
- Modify: `packages/server/src/server/agent/session-move/move-agent.ts` (`continueAgent`, `FinishProgress`, `finish`, `undoFinish`, and the three `continueAgent` call sites)
- Modify: `packages/server/src/server/bootstrap.ts` (after `createFinishSubscriptions(...)`, about line 1600)
- Test: `packages/server/src/server/agent/session-move/move-agent.e2e.test.ts`

**Interfaces:**

- Consumes: `ScheduleService.retargetAgent` (Task 1); `FinishSubscriptions.register` and `FinishRegistration` from `finish-subscriptions/index.ts`.
- Produces: `MoveCarry`; `AgentManager.setMoveCarry(carry: MoveCarry | null): void`; `AgentManager.moveCarry: MoveCarry | null`.

- [ ] **Step 1: Write the failing end-to-end tests**

In `move-agent.e2e.test.ts`, add to the imports:

```ts
import { ScheduleStore } from "../../schedule/store.js";
```

Add these helpers inside `describe("moveAgent", ...)`, after `lastSeq`:

```ts
/** A yearly schedule aimed at `agentId`; it never comes due during a test. */
async function createHeartbeat(agentId: string): Promise<string> {
  const created = await requireCtx().client.scheduleCreate({
    name: "watch-the-build",
    prompt: "check the build",
    cadence: { type: "cron", expression: "0 0 1 1 *" },
    target: { type: "agent", agentId },
    runOnCreate: false,
  });
  if (!created.schedule) throw new Error(created.error ?? "schedule not created");
  return created.schedule.id;
}

async function scheduleState(id: string): Promise<{ agentId: string | null; status: string }> {
  const { paseoHome, logger } = requireCtx().daemon;
  const stored = (await new ScheduleStore(join(paseoHome, "schedules"), logger).list()).find(
    (schedule) => schedule.id === id,
  );
  if (!stored) throw new Error(`schedule ${id} is gone`);
  return {
    agentId: stored.target.type === "agent" ? stored.target.agentId : null,
    status: stored.status,
  };
}
```

Then add a new `describe` block after `describe("when finish fails after re-parenting children", ...)`:

```ts
describe("what was aimed at the agent being left", () => {
  /** Turn prompts that are finish notifications, with the agent that received each. */
  let notices: Array<{ cwd: string; prompt: string }> = [];

  beforeEach(async () => {
    notices = [];
    ctx = await createDaemonTestContext({
      agentClients: createTestAgentClients({
        onStartTurn: (prompt, config) => {
          const text = typeof prompt === "string" ? prompt : JSON.stringify(prompt);
          if (text.includes('kind="agent-notification"')) {
            notices.push({ cwd: config.cwd, prompt: text });
          }
        },
      }),
    });
  });

  it("a heartbeat is aimed at the successor and stays active", async () => {
    const sourceId = await createRanClaudeAgent();
    const heartbeat = await createHeartbeat(sourceId);

    const moved = await moveAgent(deps(), {
      agentId: sourceId,
      target: { provider: "codex" },
      continueWork: false,
    });

    expect(await scheduleState(heartbeat)).toEqual({ agentId: moved.agentId, status: "active" });
  });

  it("move back returns the heartbeat to the original", async () => {
    const sourceId = await createRanClaudeAgent();
    const heartbeat = await createHeartbeat(sourceId);
    const moved = await moveAgent(deps(), {
      agentId: sourceId,
      target: { provider: "codex" },
      continueWork: false,
    });

    await moveAgentBack(deps(), { agentId: moved.agentId, continueWork: false });

    expect(await scheduleState(heartbeat)).toEqual({ agentId: sourceId, status: "active" });
  });

  it("a move that fails while archiving leaves the heartbeat with the original", async () => {
    const sourceId = await createRanClaudeAgent();
    const heartbeat = await createHeartbeat(sourceId);
    const real = deps();
    // The archive is the step after the schedules are re-pointed.
    const agentStorage = new Proxy(real.agentStorage, {
      get(target, property) {
        if (property === "upsert") {
          return async (record: StoredAgentRecord) => {
            if (record.id === sourceId && record.archivedAt) throw new Error("archive failed");
            return target.upsert(record);
          };
        }
        const value: unknown = Reflect.get(target, property);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });

    await expect(
      moveAgent(
        { ...real, agentStorage },
        { agentId: sourceId, target: { provider: "codex" }, continueWork: false },
      ),
    ).rejects.toMatchObject({ code: "failed" });

    expect(await scheduleState(heartbeat)).toEqual({ agentId: sourceId, status: "active" });
  });

  it("a sub-agent moved with continue on reports its successor's finish to the parent, once", async () => {
    const parentId = await createRanClaudeAgent();
    const child = await requireCtx().client.createAgent({
      config: { provider: "claude", cwd, modeId: "bypassPermissions" },
      labels: { [PARENT_AGENT_ID_LABEL]: parentId },
    });
    await runTurn(child.id, SOURCE_PROMPT);

    const moved = await moveAgent(deps(), {
      agentId: child.id,
      target: { provider: "codex" },
      continueWork: true,
    });
    await requireCtx().daemon.daemon.agentManager.waitForAgentEvent(moved.agentId);

    await vi.waitFor(() => expect(notices).toHaveLength(1), { timeout: 10_000 });
    expect(notices[0]!.prompt).toContain(moved.agentId);
    expect(notices[0]!.prompt).not.toContain(`agent-id="${child.id}"`);
  });

  it("with continue off the parent is told nothing", async () => {
    const parentId = await createRanClaudeAgent();
    const child = await requireCtx().client.createAgent({
      config: { provider: "claude", cwd, modeId: "bypassPermissions" },
      labels: { [PARENT_AGENT_ID_LABEL]: parentId },
    });
    await runTurn(child.id, SOURCE_PROMPT);

    await moveAgent(deps(), {
      agentId: child.id,
      target: { provider: "codex" },
      continueWork: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 500));

    expect(notices).toHaveLength(0);
  });
});
```

Before running, open `packages/server/src/server/agent/finish-subscriptions/internal/notification.ts` and read `formatFinishNotificationBody`: the two `toContain` assertions in the fourth test must match how it writes the child's id (the successor's id appears in the body; the old child's id does not). Adjust the attribute text in `not.toContain` to the format you find. In the third test, check `agent-archive.ts` for the storage call `archiveAgentCommand` makes to persist `archivedAt`; if it is not `upsert`, proxy that method instead.

- [ ] **Step 2: Run and watch them fail**

Run: `cd packages/server && env -u PASEO_PASSWORD -u PASEO_PASSWORD_HASH npx vitest run src/server/agent/session-move/move-agent.e2e.test.ts -t "what was aimed at the agent being left" --bail=1 > /tmp/move-carry-e2e.txt 2>&1; tail -30 /tmp/move-carry-e2e.txt`
Expected: FAIL. The first test reports `{ agentId: <source>, status: "completed" }`.

- [ ] **Step 3: Create `move-carry.ts`**

```ts
import type { FinishRegistration } from "../finish-subscriptions/index.js";

/**
 * What a session move takes along from outside the agent itself. The daemon sets one on the
 * agent manager at startup; a manager without one, as in unit tests, moves without it.
 */
export interface MoveCarry {
  /** Points not-completed schedules aimed at `from` at `to`; with `only`, just those ids. */
  retargetSchedules(from: string, to: string, only?: readonly string[]): Promise<string[]>;
  /**
   * Registers a finish notification from `agentId` to its parent, held until `accept()`.
   * Undefined when the labels name no parent, or a parent on another host.
   */
  notifyParentOnFinish(
    agentId: string,
    labels: Record<string, string>,
  ): Promise<FinishRegistration | undefined>;
}
```

- [ ] **Step 4: Hold it on `AgentManager`**

In `agent-manager.ts`, add `import type { MoveCarry } from "./session-move/move-carry.js";`, a field next to `private onAgentArchived?: AgentArchivedCallback;`:

```ts
  private carry: MoveCarry | null = null;
```

and, directly below `setAgentArchivedCallback`:

```ts
  /** Set once at daemon startup, as the archived callback is. */
  setMoveCarry(carry: MoveCarry | null): void {
    this.carry = carry;
  }

  get moveCarry(): MoveCarry | null {
    return this.carry;
  }
```

- [ ] **Step 5: Use it in the move**

In `move-agent.ts`, add `import type { FinishRegistration } from "../finish-subscriptions/index.js";`.

Replace `FinishProgress` and `newFinishProgress` with:

```ts
/** What the move's last steps changed so far, so a failed move can undo exactly that. */
interface FinishProgress {
  reparentedChildIds: string[];
  /** The moved-from link `finish` replaced on the agent it hands to; value null means none. */
  previousMovedFrom: { agentId: string; value: string | null } | null;
  linked: boolean;
  /** Schedules `finish` pointed at the agent it hands to. */
  retargeted: { toAgentId: string; scheduleIds: string[] } | null;
  /** The parent's notification for the continue turn. */
  parentNotice: FinishRegistration | null;
}

function newFinishProgress(): FinishProgress {
  return {
    reparentedChildIds: [],
    previousMovedFrom: null,
    linked: false,
    retargeted: null,
    parentNotice: null,
  };
}
```

`FinishProgress` is declared below `continueAgent` today; move the interface and `newFinishProgress` above `continueAgent`, then replace `continueAgent` with:

```ts
/**
 * Sends the continue turn. The agent's parent, when it has one on this host, is told when that
 * work ends: the notification it held for the agent being left was spent by the turn that failed
 * or was cancelled.
 */
async function continueAgent(
  deps: MoveAgentDeps,
  agentId: string,
  progress: FinishProgress,
): Promise<void> {
  const labels = deps.agentManager.getAgent(agentId)?.labels ?? {};
  const notice = await deps.agentManager.moveCarry?.notifyParentOnFinish(agentId, labels);
  try {
    const { disposition } = await sendPromptToAgent({
      agentManager: deps.agentManager,
      agentStorage: deps.agentStorage,
      logger: deps.logger,
      agentId,
      prompt: MOVE_CONTINUE_PROMPT,
      // A message id makes the prompt a visible user message in the timeline, as a typed one is.
      messageId: randomUUID(),
    });
    if (disposition === "turn_started") {
      await waitForAgentRunStartWithTimeout(deps.agentManager, agentId);
    }
  } catch (error) {
    await notice?.reject();
    throw error;
  }
  notice?.accept();
  progress.parentNotice = notice ?? null;
}
```

Update the three call sites to pass `progress`:

- `if (options.continueWork) await continueAgent(deps, moved.id, progress);` (twice, in `moveForward`)
- `if (continueWork) await continueAgent(deps, originalId, progress);` (in move back)

In `finish`, between `await deps.agentManager.setLabels(from.id, { [MOVED_TO_AGENT_ID_LABEL]: to.id });` and `await archiveAgentCommand(`, add:

```ts
// Before the archive, which completes whatever is still aimed at `from`.
const scheduleIds = await deps.agentManager.moveCarry?.retargetSchedules(from.id, to.id);
if (scheduleIds?.length) progress.retargeted = { toAgentId: to.id, scheduleIds };
```

In `undoFinish`, at the top of the function body, add:

```ts
await progress.parentNotice?.reject().catch((error: unknown) => {
  deps.logger.error({ err: error, agentId: from.id }, "move: failed to withdraw parent notice");
});
const retargeted = progress.retargeted;
if (retargeted) {
  await deps.agentManager.moveCarry
    ?.retargetSchedules(retargeted.toAgentId, from.id, retargeted.scheduleIds)
    .catch((error: unknown) => {
      deps.logger.error({ err: error, agentId: from.id }, "move: failed to restore schedules");
    });
}
```

- [ ] **Step 6: Wire the carry in `bootstrap.ts`**

Directly after the `const finishSubscriptions = createFinishSubscriptions({ ... });` statement, add:

```ts
agentManager.setMoveCarry({
  retargetSchedules: (from, to, only) => scheduleService.retargetAgent(from, to, only),
  notifyParentOnFinish: async (agentId, labels) => {
    const parent = getParentAddressFromLabels(labels, serverId);
    if (!parent || parent.serverId !== serverId) return undefined;
    return finishSubscriptions.register(
      { childAgentId: agentId, callerAgentId: parent.agentId, requireParentOwnership: true },
      true,
    );
  },
});
```

Add `getParentAddressFromLabels` to the file's `@getpaseo/protocol/agent-labels` import (add the import line if the file has none).

- [ ] **Step 7: Run and watch them pass**

Run: `cd packages/server && env -u PASEO_PASSWORD -u PASEO_PASSWORD_HASH npx vitest run src/server/agent/session-move/move-agent.e2e.test.ts --bail=1 > /tmp/move-carry-e2e.txt 2>&1; tail -15 /tmp/move-carry-e2e.txt`
Expected: PASS, the whole file, including the five new tests. The existing tests in the file now run with the real carry too.

Run: `cd packages/server && npx vitest run src/server/agent/session-move/move-agent.mcp.e2e.test.ts --bail=1 > /tmp/move-mcp-e2e.txt 2>&1; tail -5 /tmp/move-mcp-e2e.txt`
Expected: PASS.

- [ ] **Step 8: Check and commit**

```bash
npm run typecheck && npm run lint -- packages/server/src/server/agent/session-move packages/server/src/server/agent/agent-manager.ts packages/server/src/server/bootstrap.ts
npm run format:files -- packages/server/src/server/agent/session-move/move-carry.ts packages/server/src/server/agent/session-move/move-agent.ts packages/server/src/server/agent/session-move/move-agent.e2e.test.ts packages/server/src/server/agent/agent-manager.ts packages/server/src/server/bootstrap.ts
git add packages/server/src/server && git commit -m "feat(fork): a move takes schedules and heartbeats along and tells the parent when the successor finishes"
```

---

### Task 5: docs

**Files:**

- Modify: `docs/superpowers/specs/2026-11-05-session-move-design.md:149`
- Modify: `docs/agent-lifecycle.md:425-426`
- Modify: `docs/superpowers/specs/2026-11-13-move-carries-schedules-and-notifications-design.md` (status line; an "As built" section only if the build differed)

- [ ] **Step 1: Rewrite the limit in the session move spec**

Replace the bullet that begins "Schedules and heartbeats aimed at the moved agent are completed when the move archives it" with:

```markdown
- Schedules and heartbeats aimed at a moved agent follow it, on a move and on a move back, and a finish notification for a watcher that moved reaches its successor. Only the parent of a moved agent is told when a successor that continued finishes; see [what a move carries](2026-11-13-move-carries-schedules-and-notifications-design.md) for the remaining limits.
```

- [ ] **Step 2: Rewrite the same sentence in `docs/agent-lifecycle.md`**

Replace

```markdown
Schedules and heartbeats aimed at the agent you move are completed when the move archives it, and
finish notifications addressed to it stop. Move back restores neither.
```

with

```markdown
Schedules and heartbeats aimed at the agent you move are aimed at its successor before the move
archives it, and move back returns them. A finish notification addressed to an agent that moved
is delivered to its successor. When you move a sub-agent and let it continue, its parent is told
when the successor finishes.
```

- [ ] **Step 3: Mark the spec built**

In the new spec's status line, replace `not built` with `built 2026-11-13`. If anything was built differently from the spec, add a `## As built` section at the end listing each difference in one line.

- [ ] **Step 4: Format and commit**

```bash
npm run format:files -- docs/superpowers/specs/2026-11-05-session-move-design.md docs/agent-lifecycle.md docs/superpowers/specs/2026-11-13-move-carries-schedules-and-notifications-design.md
git add docs && git commit -m "docs(fork): what a move carries"
```

---

## After the last task

- Run once more, each to a file: the four test files from Tasks 1 to 4, `npm run typecheck`, `npm run lint`, `npm run format:check`.
- One fresh-context review of the whole branch against the spec.
- Do not push, open a PR, or merge without the user's word.
