# Office stand-up notes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** At 8:00 on a work day, and when the bell in the 3D scene is clicked, the office starts one agent in the notes folder that writes or updates the day's stand-up entry. The meeting room's screen opens a read-only card with the month's notes.

**Architecture:** The daemon's schedules get a third target kind, a plugin handler, and the plugin kit gets `server.schedules` to keep a plugin's own schedules and `server.handleSchedule` to answer a due one. The office keeps one schedule from its settings. A writer module on the office's server builds the stand-up report from the hub's snapshot, starts the agent, and learns its end from the `agent.turn.after` hook, so a daemon restart loses nothing. The client gets the writer's state in the office snapshot, a notes card, a bell callback and a label over the meeting room's screen.

**Tech Stack:** TypeScript, zod, React Native (react-native-web in a browser), vitest, the plugin kit (`@getpaseo/plugin`, `@getpaseo/plugin/client/ui` with its `Markdown`), three.js r160 in the vendored scene (plain JavaScript).

**Spec:** `docs/superpowers/specs/2026-11-16-office-standup-notes-design.md` (sub-project 3 of `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`).

## Global Constraints

- Work in `/workspace/QFlavours/paseo` on branch `feat/office-standup-notes`. Do not push.
- No commit carries AI attribution: no `Co-Authored-By` trailer, no "Generated with" line.
- Run one test file at a time, from the repo root: `npx vitest run <file> --bail=1`. Never run a whole suite.
- After each task's code: the typecheck of each package touched (`npm run typecheck --workspace=<package>`), then `npm run lint -- <changed .ts/.tsx files outside plugins/office/vendor/>`, then `npm run format:files -- <changed files outside plugins/office/vendor/>`. Before typechecking a package that consumes another workspace's declarations, run `npm run build:server` (Tasks 1 to 3 change protocol, server and plugin).
- `packages/protocol` stays backward-compatible (`docs/protocol-compatibility.md`). New fields are optional. No `.transform()`, `.catch()` or `.preprocess()` in wire schemas.
- No upstream file under `plugins/office/vendor/my-office/` is edited by hand. Only `src/office/paseo-*.js` and the stand-ins. Code there keeps upstream's style.
- DOM access stays in `*.web.ts` files or in effects.
- Never restart or touch the daemon on port 6767. No real agent is created or prompted for a check: tests use fakes.
- Never write to `/workspace/QFlavours/docs`. Tests use a temporary folder.
- Snippets are in `text` fences on purpose, so the formatter leaves them as they are.

Binding values from the spec:

- Settings: host-wide `notesFolder` (absolute path, default `""`) and `notesTimeZone` (IANA name, default `""`, meaning the host's). `officeHostSettings` goes to version 2.
- No folder: no schedule, the bell writes nothing, the notes card says the folder is not set.
- The run: cron `0 8 * * 0-4` in the notes time zone. A changed folder or time zone updates the schedule; a cleared folder removes it.
- The writer: one new agent in the workspace of the notes folder, the host's default provider, title `Stand-up notes`. Only one at a time: a bell click or a run while one writes starts nothing.
- When it ends: record the time, archive the agent. On an error: leave it, and the card says it stopped, with a link to it.
- Opening the Stand-up card holds the meeting and writes nothing. A click on the bell holds the meeting and starts the writer.
- The Stand-up card's line, under the totals: `Today's entry written at HH:MM`, `Writing today's entry…`, or `No entry today yet`. Left out with no folder. Under it a `Stand-up notes` link.
- The notes card: this month's file as Markdown, scrolled to the newest entry. `Previous month` and `Next month` buttons, each off where no file exists. A month with no file says so. Read only. It reloads when a writer ends.
- The server reads only `daily-standup-YYYYMM.md` directly in the notes folder.
- The 3D screen keeps its picture. The whiteboards keep opening a room's board.
- Plugin schedules are not listed in the app's schedule screens.

Decided in this plan, where the spec left it open:

- The schedule target is `{ type: "plugin", pluginId, handler }`. Its `prompt` is a label the plugin passes (the office uses `Stand-up notes`).
- `schedule/list` leaves out plugin-target schedules, so the app's screens never see them and an old client never meets the new target kind.
- A plugin target whose plugin is not loaded fails that run with a plain error. The schedule is not completed, so it runs again once the plugin is back.
- The writer's state lives in `notes-writer.json` in the office's folder (`officeDir`), beside the boards file.
- The writer's end is the `agent.turn.after` hook for its id, not a wait on the handle. A writer that is archived or closed by someone else clears the state too.
- The screen's label is a DOM button over the meeting room's screen, as the team chips are. Only the `pro` plan has the screen.
- "Today" is the date in the notes time zone at the moment the writer starts.

## Review Focus

1. **A notes folder that does not exist, or is a file.** The writer does not start, and the Stand-up card's line shows the reason. Pinned in Task 6.
2. **An invalid time zone in the settings.** The schedule is not saved, and the error shows under the field. Pinned in Task 4.
3. **The first of the month before 8:00.** The current month has no file. The card says so, and `Previous month` is on. Pinned in Task 7.
4. **A daemon restart while a writer runs.** No second writer starts. The end still archives it. Pinned in Task 6.
5. **A month input that is not six digits, or tries to leave the folder.** It is refused. Pinned in Task 7.
6. **Two bell clicks in the same second.** One writer. Pinned in Task 6.

---

### Task 1: Schedules with a plugin target

**Files:**

- Modify: `packages/protocol/src/schedule/types.ts`
- Modify: `packages/server/src/server/schedule/service.ts`
- Modify: `packages/server/src/server/schedule/store.ts` (`targetIdentity`)
- Modify: `packages/server/src/server/session/schedule/schedule-session.ts` (`schedule/list`)
- Test: `packages/server/src/server/schedule/service.test.ts` (create the file if absent, using the existing schedule tests' setup)

**Interfaces:**

- Produces: in `ScheduleTargetSchema`, a third member:

```text
z.object({
  type: z.literal("plugin"),
  pluginId: z.string().min(1),
  handler: z.string().min(1),
}),
```

- Produces: `ScheduleServiceOptions.runPluginSchedule?: (input: { pluginId: string; handler: string; scheduleId: string; runId: string }) => Promise<void>`.
- Produces on `ScheduleService`: `upsertPluginSchedule(input: { pluginId: string; name: string; handler: string; prompt: string; cadence: ScheduleCadence }): Promise<StoredSchedule>`, `removePluginSchedule(pluginId: string, name: string): Promise<boolean>`, `listPluginSchedules(pluginId: string): Promise<StoredSchedule[]>`.
- Produces: `ScheduleService.list()` is unchanged; `schedule/list` filters out `target.type === "plugin"`.

- [ ] **Step 1: Write the failing tests**

```text
test("a due plugin schedule calls its plugin's handler", async () => {
  // service with fake clock and runPluginSchedule spy
  const schedule = await service.upsertPluginSchedule({
    pluginId: "office", name: "standup-notes", handler: "standup-notes",
    prompt: "Stand-up notes", cadence: { type: "cron", expression: "0 8 * * 0-4", timezone: "Asia/Riyadh" },
  });
  // advance to Sunday 2026-11-22 08:00 Asia/Riyadh (05:00Z) and tick
  expect(runPluginSchedule).toHaveBeenCalledWith(
    expect.objectContaining({ pluginId: "office", handler: "standup-notes", scheduleId: schedule.id }),
  );
});

test("upserting by the same plugin and name updates, it does not add", async () => {
  await service.upsertPluginSchedule({ ...base, cadence: cronAt("0 8 * * 0-4", "Asia/Riyadh") });
  await service.upsertPluginSchedule({ ...base, cadence: cronAt("0 8 * * 0-4", "Europe/Berlin") });
  const owned = await service.listPluginSchedules("office");
  expect(owned).toHaveLength(1);
  expect(owned[0].cadence).toMatchObject({ timezone: "Europe/Berlin" });
});

test("a plugin sees and removes only its own schedules", async () => {
  await service.upsertPluginSchedule({ ...base, pluginId: "office" });
  await service.upsertPluginSchedule({ ...base, pluginId: "other" });
  expect(await service.listPluginSchedules("office")).toHaveLength(1);
  expect(await service.removePluginSchedule("office", base.name)).toBe(true);
  expect(await service.listPluginSchedules("other")).toHaveLength(1);
});

test("a plugin that is not loaded fails the run and keeps the schedule active", async () => {
  runPluginSchedule.mockRejectedValueOnce(new Error("Plugin is not available: office"));
  // tick past nextRunAt
  const [stored] = await service.listPluginSchedules("office");
  expect(stored.status).toBe("active");
  expect(stored.runs.at(-1)).toMatchObject({ status: "failed" });
});
```

And in the schedule session's test (or a new one beside it): `schedule/list` with one plugin and one new-agent schedule returns only the new-agent one.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run packages/server/src/server/schedule/service.test.ts --bail=1`
Expected: FAIL, `upsertPluginSchedule is not a function`.

- [ ] **Step 3: Implement**

In `executeSchedule`, a `plugin` target calls `runPluginSchedule` and returns `{ agentId: null, output: null }`. Without the option it throws `Plugin schedules are not available`. The upsert reuses the store's name-and-target upsert; `targetIdentity` for a plugin target is `{ type, pluginId }`, so the handler and cadence can change under the same name. Any branch that reads `target.config` or `target.agentId` keeps narrowing on the type; `updateSchedule` refuses `newAgentConfig` for a plugin target as it does for an agent target.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run packages/server/src/server/schedule/service.test.ts --bail=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/schedule/types.ts packages/server/src/server/schedule packages/server/src/server/session/schedule
git commit -m "feat(schedule): a schedule can call a plugin's handler"
```

---

### Task 2: The plugin kit's schedules

**Files:**

- Modify: `packages/plugin/src/server/contracts.ts`
- Modify: `packages/server/src/server/plugins/runtime.ts`, `plugin-process.ts`, `plugin-process-protocol.ts` (and the built-in path that serves `registerSettings` in the daemon process, whichever file builds a built-in's `PluginServerContext`)
- Modify: `packages/server/src/server/bootstrap.ts` (pass `runPluginSchedule` to `ScheduleService`, and the schedule service to the plugin host)
- Modify: `docs/plugins.md` (a "Schedules" section after "Lifecycle hooks")
- Test: `packages/server/src/server/plugins/plugin-schedules.e2e.test.ts` (new), following `plugin-paseo-api.e2e.test.ts`

**Interfaces:**

- Consumes: Task 1's `upsertPluginSchedule`, `removePluginSchedule`, `listPluginSchedules`, `runPluginSchedule`.
- Produces on `PluginServerContext`:

```text
schedules: {
  /** Creates or updates this plugin's schedule of that name. */
  upsert(input: { name: string; handler: string; prompt: string; cadence: ScheduleCadence }): Promise<{ id: string; nextRunAt: string | null }>;
  remove(name: string): Promise<boolean>;
  list(): Promise<{ id: string; name: string; handler: string; cadence: ScheduleCadence; nextRunAt: string | null }[]>;
};
/** Answers a due schedule that names `handler`. The returned promise ends the run. */
handleSchedule(handler: string, run: (context: { paseo: PaseoApi; scheduleId: string; runId: string }) => Promise<void>): () => void;
```

- Produces: `ScheduleCadence` re-exported from `@getpaseo/plugin/server`.
- The plugin id is the caller's own; a plugin cannot pass another's.

- [ ] **Step 1: Write the failing test**

```text
test("a plugin keeps a schedule and its handler runs with the Paseo API", async () => {
  // a test plugin whose server calls server.schedules.upsert({ name: "n", handler: "h", prompt: "p", cadence: { type: "every", everyMs: 60_000 } })
  // and server.handleSchedule("h", async ({ paseo }) => { record(typeof paseo.agents.list) })
  // run the schedule now through the daemon's schedule service
  expect(recorded).toEqual(["function"]);
  expect(await plugin.schedules.list()).toEqual([expect.objectContaining({ name: "n", handler: "h" })]);
});

test("a due schedule with no handler registered fails its run", async () => {
  // upsert with handler "missing"; run it
  expect(lastRun.status).toBe("failed");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run packages/server/src/server/plugins/plugin-schedules.e2e.test.ts --bail=1`
Expected: FAIL, `server.schedules` is undefined.

- [ ] **Step 3: Implement**

The calls go from the plugin to the daemon the way settings reads do, and a due schedule reaches the plugin as a new `{ type: "schedule.run"; requestId; handler; scheduleId; runId }` message answered by `result` or `error`, as `invoke` is. The daemon side builds `runPluginSchedule` from the runtime: `Plugin is not available: <id>` when the plugin is not loaded.

In `docs/plugins.md`, the section says: what the two calls do, that `name` is unique per plugin, that the daemon stores the schedule and runs it after a restart, that a schedule of a plugin that is not loaded fails that run and stays, and that the app's schedule screens do not list them. One short example.

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run packages/server/src/server/plugins/plugin-schedules.e2e.test.ts --bail=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin packages/server/src/server/plugins packages/server/src/server/bootstrap.ts docs/plugins.md
git commit -m "feat(plugin): plugins keep their own schedules"
```

---

### Task 3: The stand-up report on the office's server

**Files:**

- Move: `plugins/office/client/model.ts`, `client/machine-text.ts`, `client/standup-text.ts` and their tests to `plugins/office/shared/` (`git mv`), and update every import.
- Create: `plugins/office/shared/standup-report.ts`
- Test: `plugins/office/shared/standup-report.test.ts`

**Interfaces:**

- Produces: `standupReport(snapshot: OfficeSnapshot, now: number): string`, which is `standupText(standupTeams(buildOfficeModel(snapshot), now))`.
- Produces: no other change. The moved files keep their exports.

- [ ] **Step 1: Write the failing test**

```text
test("the server's report is the card's Copy as text", () => {
  const snapshot = /* a snapshot with one room, one agent, a note from today, a pull request */;
  expect(standupReport(snapshot, NOW)).toBe(standupText(standupTeams(buildOfficeModel(snapshot), NOW)));
  expect(standupReport(snapshot, NOW)).toContain(/* the room's name */);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run plugins/office/shared/standup-report.test.ts --bail=1`
Expected: FAIL, module not found.

- [ ] **Step 3: Move the files and implement**

Check that none of the moved files imports from `client/` or React. If one does, move only the pure part.

- [ ] **Step 4: Run it, and the moved tests**

Run each: `npx vitest run plugins/office/shared/standup-report.test.ts --bail=1`, then the moved `standup-text.test.ts` and `model.test.ts` if it exists.
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/office
git commit -m "refactor(office): the stand-up report is shared with the server"
```

---

### Task 4: The notes settings and the daily schedule

**Files:**

- Modify: `plugins/office/shared/settings.ts`
- Create: `plugins/office/server/notes-schedule.ts`
- Modify: `plugins/office/index.server.ts`
- Modify: `plugins/office/client/host-switches.tsx` (two fields)
- Test: `plugins/office/server/notes-schedule.test.ts`

**Interfaces:**

- Consumes: Task 2's `server.schedules`.
- Produces in `officeHostSettings` (version 2, `migrate` passes version 1 values through):

```text
schema: z.object({
  agentTools: z.boolean().default(true),
  notesFolder: z.string().default(""),
  notesTimeZone: z.string().default(""),
}),
```

- Produces: `NOTES_SCHEDULE = "standup-notes"` (its name and its handler), `notesCadence(values: { notesFolder: string; notesTimeZone: string }, hostTimeZone: string): ScheduleCadence | null` (null for an empty folder), `syncNotesSchedule(schedules: PluginServerContext["schedules"], cadence: ScheduleCadence | null): Promise<void>` (upsert with prompt `Stand-up notes`, or remove).

- [ ] **Step 1: Write the failing tests**

```text
test("no folder, no schedule", () => {
  expect(notesCadence({ notesFolder: "", notesTimeZone: "" }, "Asia/Riyadh")).toBeNull();
});
test("8:00 Sunday to Thursday in the chosen zone, else the host's", () => {
  expect(notesCadence({ notesFolder: "/n", notesTimeZone: "" }, "Asia/Riyadh"))
    .toEqual({ type: "cron", expression: "0 8 * * 0-4", timezone: "Asia/Riyadh" });
  expect(notesCadence({ notesFolder: "/n", notesTimeZone: "Europe/Berlin" }, "Asia/Riyadh"))
    .toMatchObject({ timezone: "Europe/Berlin" });
});
test("a cleared folder removes the schedule", async () => {
  await syncNotesSchedule(fake, null);
  expect(fake.removed).toEqual(["standup-notes"]);
});
test("an invalid time zone is an error from the save", async () => {
  fake.upsertRejects(new Error("Invalid time zone: Mars/Base"));
  await expect(syncNotesSchedule(fake, notesCadence({ notesFolder: "/n", notesTimeZone: "Mars/Base" }, "UTC")))
    .rejects.toThrow("Invalid time zone");
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run plugins/office/server/notes-schedule.test.ts --bail=1`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`index.server.ts` subscribes to the settings and calls `syncNotesSchedule` on each ready state; a failure is logged and kept as `scheduleError` for Task 6's state. The host's zone is `Intl.DateTimeFormat().resolvedOptions().timeZone`. In `host-switches.tsx`, under the agent tools switch: a "Notes folder" text field with the hint "Where the stand-up notes are written. Empty turns them off.", and a "Time zone" text field with the hint "For the 8:00 run. Empty uses this host's." The schedule error, when there is one, shows under the time zone field.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run plugins/office/server/notes-schedule.test.ts --bail=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/office
git commit -m "feat(office): a notes folder and the 8:00 schedule"
```

---

### Task 5: The writer's prompt

**Files:**

- Create: `plugins/office/server/notes-prompt.ts`
- Test: `plugins/office/server/notes-prompt.test.ts`

**Interfaces:**

- Produces: `notesDay(now: number, timeZone: string): { month: string; header: string }`, where `month` is `YYYYMM` and `header` is `DD Month YYYY` in English (`16 November 2026`, two-digit day).
- Produces: `notesFileName(month: string): string`, which is `daily-standup-${month}.md`.
- Produces: `notesPrompt(input: { header: string; fileName: string; report: string }): string`. The exact text:

```text
Write today's stand-up note under the "Standup Notes" rules of this folder's CLAUDE.md, for ${header}.
If the entry for ${header} is already in ${fileName}, bring it up to date in place: keep what is still true and keep the Contents list right.
Edit only ${fileName}. Do not commit.

The office's stand-up report, for what the agents did and what blocks them:

${report}
```

- [ ] **Step 1: Write the failing tests**

```text
test("the day is the notes time zone's", () => {
  // 2026-11-15T22:30:00Z is 16 November in Riyadh and 15 November in UTC
  expect(notesDay(Date.parse("2026-11-15T22:30:00Z"), "Asia/Riyadh")).toEqual({ month: "202611", header: "16 November 2026" });
  expect(notesDay(Date.parse("2026-11-15T22:30:00Z"), "UTC").header).toBe("15 November 2026");
});
test("a single-digit day has two digits", () => {
  expect(notesDay(Date.parse("2026-12-01T09:00:00Z"), "UTC")).toEqual({ month: "202612", header: "01 December 2026" });
});
test("the prompt names the day, the file and carries the report", () => {
  const text = notesPrompt({ header: "16 November 2026", fileName: "daily-standup-202611.md", report: "REPORT" });
  expect(text).toContain("for 16 November 2026.");
  expect(text).toContain("Edit only daily-standup-202611.md. Do not commit.");
  expect(text.endsWith("REPORT")).toBe(true);
});
```

- [ ] **Step 2 to 4: Fail, implement, pass**

Run: `npx vitest run plugins/office/server/notes-prompt.test.ts --bail=1`
Use `Intl.DateTimeFormat("en-GB", { timeZone, day: "2-digit", month: "long", year: "numeric" })` parts. Expected: FAIL before, PASS after.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/server/notes-prompt.ts plugins/office/server/notes-prompt.test.ts
git commit -m "feat(office): the stand-up writer's prompt"
```

---

### Task 6: The writer

**Files:**

- Create: `plugins/office/server/notes-writer.ts`
- Modify: `plugins/office/server/paths.ts` (`notesWriterFile(env, home)` in `officeDir`)
- Modify: `plugins/office/shared/contracts.ts` (`notes` on the snapshot, `notesWriteRpc`)
- Modify: `plugins/office/server/hub.ts` (carries `notes`)
- Modify: `plugins/office/index.server.ts` (wiring, the schedule handler, the RPC, the hooks)
- Modify: `plugins/office/server/live-ports.ts` (`liveNotesPorts`)
- Test: `plugins/office/server/notes-writer.test.ts`

**Interfaces:**

- Consumes: Task 3's `standupReport`, Task 4's settings, Task 5's `notesDay`, `notesFileName`, `notesPrompt`.
- Produces in `shared/contracts.ts`:

```text
export const NotesStateSchema = z.object({
  folderSet: z.boolean(),
  writing: z.boolean(),
  /** Epoch ms of the last finished write; null before the first. */
  writtenAt: z.number().nullable(),
  /** The writer that stopped on an error, left for the owner. */
  failedAgentId: z.string().nullable(),
  /** Why the last write could not start or stopped; null when it went well. */
  problem: z.string().nullable(),
});
// OfficeSnapshotSchema gains: notes: NotesStateSchema.optional()

export const notesWriteRpc = defineRpc({
  name: "office.notes.write.request",
  input: z.object({}),
  output: z.object({ started: z.boolean() }),
});
```

- Produces in `server/notes-writer.ts`:

```text
export interface NotesPorts {
  settings(): Promise<{ notesFolder: string; notesTimeZone: string }>;
  hostTimeZone: string;
  snapshot(): OfficeSnapshot;
  now(): number;
  /** Is a directory; false when missing or a file. */
  isDirectory(path: string): Promise<boolean>;
  /** Opens the folder's workspace and starts the agent with the host's default provider. Returns its id. */
  startAgent(input: { cwd: string; title: string; prompt: string }): Promise<string>;
  archive(agentId: string): Promise<void>;
  /** Whether the agent still exists and is not archived. */
  alive(agentId: string): Promise<boolean>;
  load(): Promise<StoredNotes | null>;
  save(state: StoredNotes): Promise<void>;
  changed(state: NotesState): void;
}
export interface StoredNotes { writerId: string | null; writtenAt: number | null; failedAgentId: string | null; problem: string | null }
export function createNotesWriter(ports: NotesPorts): {
  start(): Promise<{ started: boolean }>;
  /** From agent.turn.after. */
  turnEnded(agentId: string, failed: boolean, message: string | null): Promise<void>;
  /** From agent.archive.after and agent.close.after. */
  agentGone(agentId: string): Promise<void>;
  state(): NotesState;
};
```

- Behaviour: `start` with no folder returns `{ started: false }` and sets no problem. A missing folder sets `problem` to `The notes folder <path> is not a folder` and starts nothing. While `writerId` is set, or a start is on its way, `start` returns `{ started: false }`. On load, a stored `writerId` whose agent is not `alive` is cleared. A turn that ends well records `writtenAt = now()`, clears `writerId`, and archives. A failed turn sets `failedAgentId` and `problem` (the turn's message, else `The writer stopped on an error`) and does not archive. The title is `Stand-up notes`.
- `index.server.ts`: `server.handleSchedule(NOTES_SCHEDULE, …)` remembers the Paseo API and calls `start`. `notesWriteRpc` calls `start`. The `agent.turn.after`, `agent.archive.after` and `agent.close.after` hooks forward to the writer. The hub's snapshot carries `writer.state()`, and `changed` pushes a new snapshot.

- [ ] **Step 1: Write the failing tests**

```text
test("no folder: nothing starts", async () => {
  expect(await writer({ notesFolder: "" }).start()).toEqual({ started: false });
  expect(ports.started).toEqual([]);
});
test("a folder that is not a folder: the reason is kept", async () => {
  ports.directories = new Set();
  await w.start();
  expect(w.state()).toMatchObject({ writing: false, problem: "The notes folder /n is not a folder" });
});
test("one writer: a second start while it writes, or at the same time, does nothing", async () => {
  const [a, b] = await Promise.all([w.start(), w.start()]);
  expect([a.started, b.started].sort()).toEqual([false, true]);
  expect((await w.start()).started).toBe(false);
  expect(ports.started).toHaveLength(1);
  expect(ports.started[0]).toMatchObject({ cwd: "/n", title: "Stand-up notes" });
  expect(ports.started[0].prompt).toContain("daily-standup-202611.md");
});
test("a writer that ends well is recorded and archived", async () => {
  await w.start(); await w.turnEnded(ports.lastId, false, null);
  expect(w.state()).toMatchObject({ writing: false, writtenAt: NOW, problem: null });
  expect(ports.archived).toEqual([ports.lastId]);
});
test("a writer that stops on an error is left, and named", async () => {
  await w.start(); await w.turnEnded(ports.lastId, true, "Rate limited");
  expect(w.state()).toMatchObject({ writing: false, failedAgentId: ports.lastId, problem: "Rate limited" });
  expect(ports.archived).toEqual([]);
});
test("after a restart a writer still running blocks a new one, and its end archives it", async () => {
  ports.stored = { writerId: "w1", writtenAt: null, failedAgentId: null, problem: null }; ports.aliveIds = new Set(["w1"]);
  const again = createNotesWriter(ports);
  expect((await again.start()).started).toBe(false);
  await again.turnEnded("w1", false, null);
  expect(ports.archived).toEqual(["w1"]);
});
test("a stored writer that is gone is cleared on load", async () => {
  ports.stored = { writerId: "w1", writtenAt: null, failedAgentId: null, problem: null }; ports.aliveIds = new Set();
  expect((await createNotesWriter(ports).start()).started).toBe(true);
});
test("a turn of another agent changes nothing", async () => {
  await w.start(); await w.turnEnded("someone-else", false, null);
  expect(w.state().writing).toBe(true);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run plugins/office/server/notes-writer.test.ts --bail=1`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`liveNotesPorts(holder, …)`: `startAgent` opens the folder with `paseo.workspaces.open(cwd)` and calls `handle.agents.create({ config, title, prompt })`. The config is the host's default provider, read the way the app's new-agent form reads it (`paseo.providers` / `paseo.config`). The file store writes atomically, as `board-store.ts` does.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run plugins/office/server/notes-writer.test.ts --bail=1`
Expected: PASS. Also run `npx vitest run plugins/office/server/hub.test.ts --bail=1` and `plugins/office/index.server.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add plugins/office
git commit -m "feat(office): the stand-up writer"
```

---

### Task 7: Reading the notes

**Files:**

- Create: `plugins/office/server/notes-files.ts`
- Modify: `plugins/office/shared/contracts.ts` (`notesReadRpc`)
- Modify: `plugins/office/index.server.ts`
- Test: `plugins/office/server/notes-files.test.ts`

**Interfaces:**

- Consumes: Task 4's settings, Task 5's `notesDay` and `notesFileName`.
- Produces:

```text
export const notesReadRpc = defineRpc({
  name: "office.notes.read.request",
  input: z.object({ month: z.string().regex(/^\d{6}$/).optional() }),
  output: z.object({
    folderSet: z.boolean(),
    month: z.string(),
    /** The file's text; null when the month has no file. */
    text: z.string().nullable(),
    /** The nearest earlier and later months that have a file; null where none. */
    previous: z.string().nullable(),
    next: z.string().nullable(),
  }),
});
export function readNotes(folder: string, month: string, fs: { readdir(path: string): Promise<string[]>; readFile(path: string): Promise<string> }): Promise<{ month: string; text: string | null; previous: string | null; next: string | null }>;
```

- With no `month`, the server uses this month in the notes time zone. With no folder it answers `{ folderSet: false, month, text: null, previous: null, next: null }`.

- [ ] **Step 1: Write the failing tests**

```text
// tmp folder with daily-standup-202609.md, daily-standup-202611.md, notes.md, sub/daily-standup-202610.md
test("a month's file, and the months on each side that have a file", async () => {
  expect(await readNotes(dir, "202611", nodeFs)).toEqual({ month: "202611", text: "NOV", previous: "202609", next: null });
});
test("the first of a month with no file yet: no text, previous on", async () => {
  expect(await readNotes(dir, "202612", nodeFs)).toMatchObject({ text: null, previous: "202611", next: null });
});
test("only monthly notes directly in the folder count", async () => {
  expect((await readNotes(dir, "202610", nodeFs)).text).toBeNull();
});
test("a month that is not six digits is refused by the contract", () => {
  expect(notesReadRpc.input.safeParse({ month: "../../etc" }).success).toBe(false);
  expect(notesReadRpc.input.safeParse({ month: "2026-11" }).success).toBe(false);
});
```

- [ ] **Step 2 to 4: Fail, implement, pass**

Run: `npx vitest run plugins/office/server/notes-files.test.ts --bail=1`
List the folder once, keep names matching `^daily-standup-(\d{6})\.md$`, and read only `join(folder, notesFileName(month))`. Expected: FAIL before, PASS after.

- [ ] **Step 5: Commit**

```bash
git add plugins/office
git commit -m "feat(office): the server reads the month's notes"
```

---

### Task 8: The bell writes and the screen opens the notes (3D)

**Files:**

- Modify: `plugins/office/vendor/my-office/src/office/paseo-entry.js`
- Modify: `plugins/office/client/world/world-api.ts`, `client/world/world-view.tsx`
- Modify: `plugins/office/client/office-screen.tsx` (or whichever file holds the cards' open state and calls the world view; find it from `onBoard`)
- Test: `plugins/office/client/world/world-api.test.ts` if it exists, else the scene's build test; the entry is checked in Task 10

**Interfaces:**

- Produces in the world options: `onBell?(): void` and `onNotes?(): void`.
- The entry's bell wrapper becomes `bell.act = () => { ringWithEveryone(ring); host.bell?.(); }`. `meet()` does not call `host.bell`.
- The entry adds a label button `Stand-up notes` over the meeting room's screen, at world position `(0.2, 1.75, -7.95)`, built the way the team chips' labels are (pointer and keyboard), shown only when the plan is `pro` and `onNotes` is set. Its click calls `host.notes()`.
- `world-view.tsx` passes `onBell` (calls `notesWriteRpc`, ignores the answer; a failure shows as the office's toast) and `onNotes` (opens the notes card of Task 9).

- [ ] **Step 1: Write the failing test**

A test of the client code that maps the options: with `onBell` and `onNotes` given, the options passed to the scene carry them; `meet` is unchanged. If the world API has no options test, add the assertion to the closest existing test of `world-view` props.

- [ ] **Step 2 to 4: Fail, implement, pass**

Run the test file you touched with `npx vitest run <file> --bail=1`. Then rebuild the scene's bundle through its build test, and check that its size stays under 1.2 MB.

- [ ] **Step 5: Commit**

```bash
git add plugins/office
git commit -m "feat(office): the bell writes the notes and the screen opens them"
```

---

### Task 9: The notes card and the Stand-up card's line

**Files:**

- Create: `plugins/office/client/notes-card.tsx`, `plugins/office/client/notes-text.ts`
- Modify: `plugins/office/client/standup-card.tsx`
- Modify: the file that opens cards (as in Task 8)
- Test: `plugins/office/client/notes-text.test.ts`, `plugins/office/client/notes-card.test.tsx`

**Interfaces:**

- Consumes: Task 6's `NotesState` in the snapshot, Task 7's `notesReadRpc`.
- Produces in `notes-text.ts`:

```text
/** The Stand-up card's line; null with no folder. */
export function notesLine(state: NotesState | undefined, now: number, timeZone: string): string | null;
/** Splits a month's text before its newest entry: the last "## " header at the start of a line. */
export function splitNewest(text: string): { before: string; newest: string };
export function monthTitle(month: string): string; // "202611" -> "November 2026"
```

- `notesLine`: `Writing today's entry…` while writing; `Today's entry written at HH:MM` when `writtenAt` is today (24-hour, the given zone); `The writer stopped: <problem>` when `failedAgentId` is set or a problem is kept, else `No entry today yet`.
- `NotesCard` props: `{ open: boolean; onClose(): void; onOpenAgent(agentId: string): void; styles }`. Title `Stand-up notes`, under it `monthTitle(month)`, `Previous month` and `Next month` buttons (off where null), then `before` and `newest` as two `Markdown` blocks in one scroll view, scrolled to the `newest` block's `onLayout` y once per load. No file: `No notes for <month title>.` No folder: `Set a notes folder in the office's settings to see the stand-up notes.` A read error shows in place of the notes. When the snapshot's `writtenAt` changes while open, it reloads the month.
- The Stand-up card shows `notesLine` under the totals, a link `Open the writer` when `failedAgentId` is set, and a `Stand-up notes` link that opens the notes card. Opening the Stand-up card writes nothing.

- [ ] **Step 1: Write the failing tests**

```text
test("the line follows the writer", () => {
  expect(notesLine(undefined, NOW, "UTC")).toBeNull();
  expect(notesLine({ ...idle, folderSet: false }, NOW, "UTC")).toBeNull();
  expect(notesLine({ ...idle, writing: true }, NOW, "UTC")).toBe("Writing today's entry…");
  expect(notesLine({ ...idle, writtenAt: Date.parse("2026-11-16T05:03:00Z") }, Date.parse("2026-11-16T09:00:00Z"), "Asia/Riyadh"))
    .toBe("Today's entry written at 08:03");
  expect(notesLine({ ...idle, writtenAt: Date.parse("2026-11-15T05:00:00Z") }, NOW, "UTC")).toBe("No entry today yet");
  expect(notesLine({ ...idle, failedAgentId: "a", problem: "Rate limited" }, NOW, "UTC")).toBe("The writer stopped: Rate limited");
});
test("the newest entry starts at the last ## header", () => {
  const text = "# T\n\n## Contents\n\n---\n\n## 15 November 2026\n\nA\n\n---\n\n## 16 November 2026\n\nB\n";
  expect(splitNewest(text).newest.startsWith("## 16 November 2026")).toBe(true);
  expect(splitNewest("no headers").newest).toBe("no headers");
});
```

In `notes-card.test.tsx`: with `previous: "202610", next: null`, `Previous month` is on and `Next month` is off; with `text: null` the card says `No notes for December 2026.`

- [ ] **Step 2 to 4: Fail, implement, pass**

Run each test file with `npx vitest run <file> --bail=1`. Expected: FAIL before, PASS after. `Contents` is a `## ` header too, but it comes first, so the last header is still the newest entry.

- [ ] **Step 5: Commit**

```bash
git add plugins/office
git commit -m "feat(office): the stand-up notes card"
```

---

### Task 10: Look at it, and mark it built

**Files:**

- Modify: `docs/superpowers/specs/2026-11-16-office-standup-notes-design.md` (Status line, and a "Verified" list)
- Modify: `docs/superpowers/specs/2026-11-16-office-owner-review-design.md` (Status line)

- [ ] **Step 1: Start an isolated dev daemon**

Follow `docs/ad-hoc-daemon-testing.md` or `npm run dev` with this checkout's `.dev/paseo-home`. Never the daemon on port 6767. Set the notes folder to a temporary copy of a notes folder, never `/workspace/QFlavours/docs`.

- [ ] **Step 2: Check, in a browser**

- The office's settings show the two fields. A bad zone shows the error.
- The Stand-up card shows the line and the `Stand-up notes` link. Opening it starts no agent (`npm run cli -- ls -a`).
- In 3D, the screen's label opens the notes card at the newest entry. The month buttons work.
- One bell click starts one `Stand-up notes` agent. A second click while it runs starts none. When it ends it is archived, and the card's line shows the time.
- `npm run cli -- schedule ls` (or the app's schedule screen) does not list the office's schedule.

- [ ] **Step 3: Write it down**

In the spec, set `Status: built.` and add a "Verified" list of what Step 2 saw, and a "Not verified" list of what it could not see (the 8:00 run itself, unless the clock was moved; the Android app). In the roadmap, replace

```text
Date: 2026-11-16. Status: sub-projects 1 and 2 are built; sub-project 3 is designed ([its design](2026-11-16-office-standup-notes-design.md)); the others are not.
```

with

```text
Date: 2026-11-16. Status: sub-projects 1, 2 and 3 are built; the others are not.
```

- [ ] **Step 4: Commit**

```bash
npm run format:files -- docs/superpowers/specs/2026-11-16-office-standup-notes-design.md docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git add docs/superpowers/specs/2026-11-16-office-standup-notes-design.md docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git commit -m "docs(office): the stand-up notes are built"
```
