# paseo-office, part 1: the office stops needing the fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the office, in place in the fork, so that nothing in it needs a fork-only call, and prove it by typechecking it against the published plugin SDK.

**Architecture:** Each tie to the fork is cut where it is, with the office still a built-in and its tests still green: the daemon's schedules give way to an engine of the office's own, the scene is embedded as a generated module instead of bundled by the daemon, the daemon's process and environment are found from the plugin's side, and the fork-only client and server calls sit behind types of the office's own. A first task installs a probe plugin on a stock daemon and records the facts the later tasks need. Part 2 (its own plan, written when this one is done) creates `allrested/paseo-office`, moves the files, adds CI and cuts the owner's host over.

**Tech Stack:** TypeScript in a Paseo plugin (`plugins/office`), `@getpaseo/plugin` SDK, Node timers and `Intl`, esbuild for the scene, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-18-paseo-office-design.md` (sub-project 1, section "Running on stock Paseo").

## Global Constraints

- Work in `/workspace/QFlavours/paseo-onepage-docs` on branch `feat/office-defork` (create it from `main`). Paths below are relative to it.
- Change only files under `plugins/office` and `docs/`. Nothing under `packages/`.
- The office stays a working built-in of the fork after every task: its behaviour on the fork does not change, except where a task says so.
- After this plan, `plugins/office` imports no type or value that the published `@getpaseo/plugin@0.16.2` lacks.
- Never start, stop or restart the daemon on port 6767. A dev daemon uses its own `PASEO_HOME` and port 6798, and is stopped when the task ends.
- Nothing more is told to the scene than today.
- Run one test file at a time: `cd plugins && npx vitest run <file> --bail=1`. Never the whole suite. Never `git stash`.
- After each task, from the repo root: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, `npm run lint -- <changed files>`, `npm run format:files -- <changed files>`.
- Commits carry no `Co-Authored-By` trailer and no "Generated with" line. Messages follow the fork's style (`feat(office): ...`, `refactor(office): ...`, `docs(office): ...`).

---

### Task 1: What a stock daemon gives an installed plugin

A probe, not product code. Its output is a findings file the later tasks read.

**Files:**

- Create: `docs/superpowers/specs/2026-11-18-paseo-office-stock-findings.md`
- Scratch (not committed): `/tmp/paseo-stock/`, `/tmp/office-probe/`

**Interfaces:**

- Produces: the findings file, with one answer for each of F1 to F8 below. Tasks 3, 4 and 6 read it.

- [ ] **Step 1: A stock daemon on its own home and port**

```bash
mkdir -p /tmp/paseo-stock && cd /tmp/paseo-stock
npm init -y >/dev/null
npm install @getpaseo/server@0.16.2 @getpaseo/cli@0.16.2
mkdir -p home
printf '{ "pluginsEnabled": true }\n' > home/config.json
PASEO_HOME=/tmp/paseo-stock/home PASEO_LISTEN=127.0.0.1:6798 \
  node node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js > daemon.log 2>&1 &
echo $! > daemon.pid
```

Wait until `daemon.log` has "Server listening". If the entry point or the config's shape differs in the published package, read its `package.json` `bin` and `dist/` to find the right ones, and write what you used into the findings. Every `paseo` call below runs as `PASEO_HOME=/tmp/paseo-stock/home /tmp/paseo-stock/node_modules/.bin/paseo ...`; check with `paseo daemon status` that it reports port 6798, not 6767, before any other command.

- [ ] **Step 2: The probe plugin**

`/tmp/office-probe/paseo-plugin.json`:

```json
{ "id": "office-probe", "requirements": { "paseo": ">=0.16.0" } }
```

`/tmp/office-probe/package.json`:

```json
{
  "name": "office-probe",
  "version": "0.0.1",
  "private": true,
  "type": "module",
  "dependencies": { "@getpaseo/plugin": "0.16.2", "zod": "^4.4.3" }
}
```

`/tmp/office-probe/index.server.ts`:

```ts
import { readFileSync } from "node:fs";
import { defineRpc, type PluginServerContext } from "@getpaseo/plugin";
import { z } from "zod";

const probeRpc = defineRpc({
  name: "office-probe.read.request",
  input: z.object({}),
  output: z.object({ report: z.string() }),
});

function parentCommand(): string {
  try {
    return readFileSync(`/proc/${process.ppid}/cmdline`, "utf8").split("\0").join(" ").trim();
  } catch (error) {
    return `unreadable: ${String(error)}`;
  }
}

export default function contribute(server: PluginServerContext, second?: unknown) {
  const facts = {
    pid: process.pid,
    ppid: process.ppid,
    parentCommand: parentCommand(),
    cwd: process.cwd(),
    argv: process.argv,
    importMetaUrl: import.meta.url,
    paseoEnv: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => key.startsWith("PASEO")),
    ),
    home: process.env.HOME ?? null,
    serverKeys: Object.keys(server).sort(),
    secondArgument: second === undefined ? "none" : Object.keys(second as object).sort(),
  };
  console.error(`[office-probe] ${JSON.stringify(facts)}`);
  server.handle(probeRpc, (_input, context) => ({
    report: JSON.stringify({ contextKeys: Object.keys(context).sort() }),
  }));
  return async () => undefined;
}
```

If `defineRpc` or `handle` has another shape in 0.16.2, follow the package's own types (`/tmp/office-probe/node_modules/@getpaseo/plugin/dist`) and say what differed.

- [ ] **Step 3: Install it three ways and read what it says**

1. Directory source, with dependencies installed: `cd /tmp/office-probe && npm install`, then `paseo plugin install /tmp/office-probe`, then `paseo plugin logs office-probe`.
2. Directory source without `node_modules` (`rm -rf node_modules`, `paseo plugin rm office-probe`, install again): does `zod` resolve?
3. Git source: `git init` the folder, commit, `paseo plugin install file:///tmp/office-probe` (or the Git URL form the CLI accepts for a local repo; say which). Once without a `build` in the manifest, once with `"build": [["npm", "ci", "--omit=dev"]]` and a committed `package-lock.json`.

- [ ] **Step 4: Write the findings**

`docs/superpowers/specs/2026-11-18-paseo-office-stock-findings.md`, in the docs' voice, one short section per finding, each with the evidence (the log line or the command's output, trimmed):

- **F1. The server's process.** Is the plugin a subprocess, and is its parent the daemon (`parentCommand`)? If the parent is a supervisor or a worker, how many steps up is the process that listens on the port?
- **F2. Its environment.** Is `PASEO_HOME` set in the subprocess? Which other `PASEO*` variables? Is `HOME`?
- **F3. Its own folder.** Do `import.meta.url`, `process.cwd()` or `argv` give the plugin's installed directory? (The daemon runs the server from a compiled bundle, so `import.meta.url` may not.)
- **F4. Dependencies.** Which of the four installs resolve `zod`: installed `node_modules`, none, Git without `build`, Git with `build`?
- **F5. The server context.** The keys of the server context and of a handler's context on stock (`serverKeys`, `contextKeys`). Is there a `paseo` on the server context itself, or only on a handler's?
- **F6. The second argument.** Does an installed plugin's `contribute` get one?
- **F7. Listing.** Does `paseo plugin ls` show the plugin, and does the daemon's web UI on 6798 list it under Settings > Plugins? (Open `http://<first address of hostname -i>:6798` with the `mcp__paseo__browser_*` tools if pairing a browser to this throwaway daemon is possible without credentials; otherwise say it was not seen.)
- **F8. What was used.** The entry point, the config, the Git URL form, and anything that differed from this task's text.

End with a table: for Tasks 3, 4 and 6 of this plan, which branch each finding selects (the tasks name their branches).

- [ ] **Step 5: Stop the daemon and commit**

```bash
kill "$(cat /tmp/paseo-stock/daemon.pid)"; sleep 2
ss -ltn | grep -c ':6798' # expect 0
cd /workspace/QFlavours/paseo-onepage-docs
npm run format:files -- docs/superpowers/specs/2026-11-18-paseo-office-stock-findings.md
git add docs/superpowers/specs/2026-11-18-paseo-office-stock-findings.md
git commit -m "docs(office): what a stock daemon gives an installed plugin"
```

Leave `/tmp/paseo-stock` and `/tmp/office-probe` in place: Task 6 uses them.

---

### Task 2: The office keeps its own schedules

The daemon's plugin schedules (`server.schedules`, `server.handleSchedule`) are the fork's. The office uses two: the stand-up notes at 8:00 Sunday to Thursday in a time zone (`{ type: "cron", expression: "0 8 * * 0-4", timezone }`), and the incidents check every five minutes (`{ type: "every", everyMs }`). An engine of the office's own takes their place behind the same three calls, so `schedule-follower.ts`, `notes-schedule.ts` and `incidents-schedule.ts` change only their type imports.

**Files:**

- Create: `plugins/office/server/local-schedules.ts`
- Test: `plugins/office/server/local-schedules.test.ts`
- Modify: `plugins/office/server/schedule-follower.ts`, `notes-schedule.ts`, `incidents-schedule.ts`, `fake-schedules.ts` (type imports)
- Modify: `plugins/office/server/paseo-holder.ts` (a `wait()`), its test if it has one
- Modify: `plugins/office/index.server.ts`, `plugins/office/index.server.test.ts`

**Interfaces:**

- Produces, in `plugins/office/server/local-schedules.ts`:

```ts
export type OfficeCadence =
  | { type: "cron"; expression: string; timezone: string }
  | { type: "every"; everyMs: number };
export interface OfficeScheduleInput {
  name: string;
  handler: string;
  prompt: string;
  cadence: OfficeCadence;
}
export interface OfficeScheduleEntry {
  id: string;
  name: string;
  handler: string;
  cadence: OfficeCadence;
  nextRunAt: string | null;
}
export interface OfficeSchedules {
  upsert(input: OfficeScheduleInput): Promise<{ id: string; nextRunAt: string | null }>;
  remove(name: string): Promise<boolean>;
  list(): Promise<OfficeScheduleEntry[]>;
}
export interface LocalSchedules extends OfficeSchedules {
  /** Answers a due schedule that names `handler`. Returns a function that stops answering. */
  handle(handler: string, run: () => Promise<void>): () => void;
  /** Cancels every timer. */
  stop(): void;
}
export function nextCronRun(expression: string, timezone: string, after: number): number;
export function createLocalSchedules(ports: {
  clock: Clock;
  log(message: string): void;
}): LocalSchedules;
```

- `PaseoHolder.wait(): Promise<Paseo>` resolves with the Paseo API once a handler has brought it.
- `OfficePluginDeps.schedules: LocalSchedules`.

- [ ] **Step 1: Write the failing tests**

```ts
// plugins/office/server/local-schedules.test.ts
import { expect, test } from "vitest";
import { fakeClock } from "./fake-clock.js";
import { createLocalSchedules, nextCronRun } from "./local-schedules.js";

const at = (iso: string) => Date.parse(iso);
const iso = (ms: number) => new Date(ms).toISOString();
const NOTES = "0 8 * * 0-4";

test("8:00 in Riyadh is 05:00 UTC, the same day when it is still ahead", () => {
  // Wednesday 18 November 2026, 07:59 in Riyadh.
  expect(iso(nextCronRun(NOTES, "Asia/Riyadh", at("2026-11-18T04:59:00Z")))).toBe(
    "2026-11-18T05:00:00.000Z",
  );
});

test("at 8:00 exactly the next run is the next working day's", () => {
  expect(iso(nextCronRun(NOTES, "Asia/Riyadh", at("2026-11-18T05:00:00Z")))).toBe(
    "2026-11-19T05:00:00.000Z",
  );
});

test("Friday and Saturday are skipped: Thursday's run is followed by Sunday's", () => {
  expect(iso(nextCronRun(NOTES, "Asia/Riyadh", at("2026-11-19T05:00:00Z")))).toBe(
    "2026-11-22T05:00:00.000Z",
  );
});

test("the hour is the zone's wall clock across a daylight-saving change", () => {
  // New York springs forward on Sunday 8 March 2026: 8:00 EDT is 12:00 UTC.
  expect(iso(nextCronRun("0 8 * * *", "America/New_York", at("2026-03-07T14:00:00Z")))).toBe(
    "2026-03-08T12:00:00.000Z",
  );
});

test("a zone the host does not know, and an expression the office does not read, are refused", () => {
  expect(() => nextCronRun(NOTES, "Mars/Olympus", 0)).toThrow(/time zone/i);
  expect(() => nextCronRun("*/5 * * * *", "UTC", 0)).toThrow(/expression/i);
  expect(() => nextCronRun("0 8 1 * *", "UTC", 0)).toThrow(/expression/i);
});

function engine() {
  const clock = fakeClock(at("2026-11-18T04:00:00Z"));
  const logged: string[] = [];
  const schedules = createLocalSchedules({ clock, log: (line) => logged.push(line) });
  return { clock, logged, schedules };
}

const NOTES_INPUT = {
  name: "standup-notes",
  handler: "standup-notes",
  prompt: "Stand-up notes",
  cadence: { type: "cron" as const, expression: NOTES, timezone: "Asia/Riyadh" },
};

test("a saved schedule says when it runs next, and is listed", async () => {
  const { schedules } = engine();
  const saved = await schedules.upsert(NOTES_INPUT);

  expect(saved.nextRunAt).toBe("2026-11-18T05:00:00.000Z");
  expect(await schedules.list()).toEqual([
    {
      id: "standup-notes",
      name: "standup-notes",
      handler: "standup-notes",
      cadence: NOTES_INPUT.cadence,
      nextRunAt: "2026-11-18T05:00:00.000Z",
    },
  ]);
});

test("a due schedule runs its handler and is set for the run after", async () => {
  const { clock, schedules } = engine();
  let runs = 0;
  schedules.handle("standup-notes", async () => {
    runs += 1;
  });
  await schedules.upsert(NOTES_INPUT);

  await clock.advance(60 * 60 * 1000);
  expect(runs).toBe(1);
  expect((await schedules.list())[0]?.nextRunAt).toBe("2026-11-19T05:00:00.000Z");

  await clock.advance(24 * 60 * 60 * 1000);
  expect(runs).toBe(2);
});

test("an interval runs every time it passes", async () => {
  const { clock, schedules } = engine();
  let runs = 0;
  schedules.handle("incidents", async () => {
    runs += 1;
  });
  await schedules.upsert({
    name: "incidents",
    handler: "incidents",
    prompt: "Incidents",
    cadence: { type: "every", everyMs: 5 * 60 * 1000 },
  });

  await clock.advance(16 * 60 * 1000);
  expect(runs).toBe(3);
});

test("a handler that fails is logged and the schedule keeps running", async () => {
  const { clock, logged, schedules } = engine();
  let runs = 0;
  schedules.handle("standup-notes", async () => {
    runs += 1;
    throw new Error("no writer");
  });
  await schedules.upsert(NOTES_INPUT);

  await clock.advance(25 * 60 * 60 * 1000);
  expect(runs).toBe(2);
  expect(logged.some((line) => line.includes("standup-notes") && line.includes("no writer"))).toBe(
    true,
  );
});

test("a removed schedule does not run, and removing it twice answers false", async () => {
  const { clock, schedules } = engine();
  let runs = 0;
  schedules.handle("standup-notes", async () => {
    runs += 1;
  });
  await schedules.upsert(NOTES_INPUT);

  expect(await schedules.remove("standup-notes")).toBe(true);
  expect(await schedules.remove("standup-notes")).toBe(false);
  await clock.advance(48 * 60 * 60 * 1000);
  expect(runs).toBe(0);
  expect(await schedules.list()).toEqual([]);
});

test("a save with a zone the host refuses rejects and leaves the kept schedule as it was", async () => {
  const { schedules } = engine();
  await schedules.upsert(NOTES_INPUT);

  await expect(
    schedules.upsert({
      ...NOTES_INPUT,
      cadence: { ...NOTES_INPUT.cadence, timezone: "Mars/Olympus" },
    }),
  ).rejects.toThrow(/time zone/i);
  expect((await schedules.list())[0]?.cadence).toEqual(NOTES_INPUT.cadence);
});

test("stop cancels what is set", async () => {
  const { clock, schedules } = engine();
  let runs = 0;
  schedules.handle("standup-notes", async () => {
    runs += 1;
  });
  await schedules.upsert(NOTES_INPUT);
  schedules.stop();

  await clock.advance(48 * 60 * 60 * 1000);
  expect(runs).toBe(0);
});
```

Read `plugins/office/server/fake-clock.ts` first: use its real constructor and its way to move time (the test above assumes `fakeClock(startMs)` with an async `advance(ms)` that runs due timers and lets their promises settle). If it differs, adapt the test's calls to the helper, not the helper to the test; if it has no way to let an async handler settle between timers, add one to the helper and say so.

- [ ] **Step 2: Run them and see them fail**

Run: `cd plugins && npx vitest run office/server/local-schedules.test.ts --bail=1`
Expected: FAIL, cannot find `./local-schedules.js`.

- [ ] **Step 3: Write the engine**

```ts
// plugins/office/server/local-schedules.ts
import { errorMessage } from "./errors.js";
import type { Clock } from "./timers.js";

/** When one of the office's schedules runs: at a wall-clock time on some weekdays, or at an interval. */
export type OfficeCadence =
  | { type: "cron"; expression: string; timezone: string }
  | { type: "every"; everyMs: number };

export interface OfficeScheduleInput {
  /** Picks the schedule among the office's own. */
  name: string;
  /** The `handle` name that answers the schedule when it is due. */
  handler: string;
  /** A label for the schedule. */
  prompt: string;
  cadence: OfficeCadence;
}

export interface OfficeScheduleEntry {
  id: string;
  name: string;
  handler: string;
  cadence: OfficeCadence;
  nextRunAt: string | null;
}

/** The office's schedules, as its followers use them. */
export interface OfficeSchedules {
  upsert(input: OfficeScheduleInput): Promise<{ id: string; nextRunAt: string | null }>;
  /** Resolves `false` when there is no schedule of that name. */
  remove(name: string): Promise<boolean>;
  list(): Promise<OfficeScheduleEntry[]>;
}

export interface LocalSchedules extends OfficeSchedules {
  /** Answers a due schedule that names `handler`. Returns a function that stops answering. */
  handle(handler: string, run: () => Promise<void>): () => void;
  /** Cancels every timer. */
  stop(): void;
}

interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

function zoneFormat(timezone: string): Intl.DateTimeFormat {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
    });
  } catch {
    throw new Error(`Unknown time zone: ${timezone}`);
  }
}

function wallClock(format: Intl.DateTimeFormat, at: number): WallClock {
  const parts = format.formatToParts(new Date(at));
  const read = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: read("year"),
    month: read("month"),
    day: read("day"),
    hour: read("hour"),
    minute: read("minute"),
  };
}

/** The instant a wall-clock time falls on in the zone. Corrected once, for a change of offset. */
function instantOf(format: Intl.DateTimeFormat, wall: WallClock): number {
  const asUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute);
  let guess = asUtc;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = wallClock(format, guess);
    const seenAsUtc = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += asUtc - seenAsUtc;
  }
  return guess;
}

function weekdaysOf(field: string, expression: string): ReadonlySet<number> {
  if (field === "*") return new Set([0, 1, 2, 3, 4, 5, 6]);
  const days = new Set<number>();
  for (const piece of field.split(",")) {
    const range = /^([0-6])(?:-([0-6]))?$/.exec(piece);
    if (!range) throw new Error(`Unsupported schedule expression: ${expression}`);
    const from = Number(range[1]);
    const to = range[2] === undefined ? from : Number(range[2]);
    if (to < from) throw new Error(`Unsupported schedule expression: ${expression}`);
    for (let day = from; day <= to; day += 1) days.add(day);
  }
  return days;
}

/**
 * The next run of `minute hour * * weekdays` in a time zone, after an instant. The office keeps
 * its own schedules (stock Paseo has none for plugins) and reads only this shape: a fixed minute
 * and hour, every month and day of the month, and weekdays as `*`, a day, a range or a list.
 */
export function nextCronRun(expression: string, timezone: string, after: number): number {
  const fields = expression.trim().split(/\s+/);
  const [minuteField, hourField, dayOfMonth, month, weekdayField] = fields;
  const fixed = /^\d{1,2}$/;
  if (
    fields.length !== 5 ||
    !fixed.test(minuteField ?? "") ||
    !fixed.test(hourField ?? "") ||
    dayOfMonth !== "*" ||
    month !== "*"
  ) {
    throw new Error(`Unsupported schedule expression: ${expression}`);
  }
  const minute = Number(minuteField);
  const hour = Number(hourField);
  if (minute > 59 || hour > 23) throw new Error(`Unsupported schedule expression: ${expression}`);
  const weekdays = weekdaysOf(weekdayField ?? "", expression);
  const format = zoneFormat(timezone);
  const today = wallClock(format, after);
  // Eight days cover a week of weekdays and the day the search starts on.
  for (let ahead = 0; ahead <= 8; ahead += 1) {
    const date = new Date(Date.UTC(today.year, today.month - 1, today.day + ahead));
    if (!weekdays.has(date.getUTCDay())) continue;
    const run = instantOf(format, {
      year: date.getUTCFullYear(),
      month: date.getUTCMonth() + 1,
      day: date.getUTCDate(),
      hour,
      minute,
    });
    if (run > after) return run;
  }
  throw new Error(`Unsupported schedule expression: ${expression}`);
}

function nextRun(cadence: OfficeCadence, after: number): number {
  if (cadence.type === "every") return after + cadence.everyMs;
  return nextCronRun(cadence.expression, cadence.timezone, after);
}

interface Kept {
  input: OfficeScheduleInput;
  nextRunAt: number;
  cancel(): void;
}

/**
 * The office's schedules, kept by the office: a timer per schedule, set again after each run.
 * Nothing is stored: the office saves its schedules again from its settings each time it starts,
 * and a run that fell due while the daemon was down is not made up.
 */
export function createLocalSchedules(ports: {
  clock: Clock;
  log(message: string): void;
}): LocalSchedules {
  const kept = new Map<string, Kept>();
  const handlers = new Map<string, () => Promise<void>>();

  function arm(input: OfficeScheduleInput, at: number): Kept {
    const delay = Math.max(0, at - ports.clock.now());
    const entry: Kept = {
      input,
      nextRunAt: at,
      cancel: ports.clock.setTimeout(() => void due(input.name), delay),
    };
    kept.set(input.name, entry);
    return entry;
  }

  async function due(name: string): Promise<void> {
    const entry = kept.get(name);
    if (!entry) return;
    // Set for the run after first, so a slow or failing handler never stops the schedule.
    arm(entry.input, nextRun(entry.input.cadence, ports.clock.now()));
    const run = handlers.get(entry.input.handler);
    if (!run) return;
    try {
      await run();
    } catch (error) {
      ports.log(`[office] ${name} run failed: ${errorMessage(error)}`);
    }
  }

  return {
    async upsert(input) {
      // Worked out before anything changes: a refused cadence leaves the kept schedule as it was.
      const at = nextRun(input.cadence, ports.clock.now());
      kept.get(input.name)?.cancel();
      arm(input, at);
      return { id: input.name, nextRunAt: new Date(at).toISOString() };
    },
    async remove(name) {
      const entry = kept.get(name);
      if (!entry) return false;
      entry.cancel();
      kept.delete(name);
      return true;
    },
    async list() {
      return [...kept.values()].map((entry) => ({
        id: entry.input.name,
        name: entry.input.name,
        handler: entry.input.handler,
        cadence: entry.input.cadence,
        nextRunAt: new Date(entry.nextRunAt).toISOString(),
      }));
    },
    handle(handler, run) {
      handlers.set(handler, run);
      return () => {
        if (handlers.get(handler) === run) handlers.delete(handler);
      };
    },
    stop() {
      for (const entry of kept.values()) entry.cancel();
      kept.clear();
    },
  };
}
```

`Clock` in `plugins/office/server/timers.ts` is `{ now(): number; setTimeout(run, ms): () => void }`. A Node timer's longest delay is about 24.8 days; the office's longest wait is three days.

- [ ] **Step 4: Run the engine's tests**

Run: `cd plugins && npx vitest run office/server/local-schedules.test.ts --bail=1`
Expected: 13 passed.

- [ ] **Step 5: The followers use the office's types**

- `schedule-follower.ts`: remove `import type { PluginServerContext, ScheduleCadence } from "@getpaseo/plugin/server";` and `type Schedules = PluginServerContext["schedules"];`. Import `type OfficeCadence, type OfficeSchedules` from `./local-schedules.js`; `Schedules` becomes `OfficeSchedules` and every `ScheduleCadence` becomes `OfficeCadence`. In its comments "the daemon's schedule" becomes "the office's schedule".
- `notes-schedule.ts`, `incidents-schedule.ts`: the same two replacements for whatever they import of `ScheduleCadence` and `Schedules`.
- `fake-schedules.ts`: its `PluginSchedule`, `PluginScheduleInput`, `PluginSchedules` imports become `OfficeScheduleEntry`, `OfficeScheduleInput`, `OfficeSchedules`.
- Run `grep -rn "ScheduleCadence\|PluginSchedule\|handleSchedule\|server\.schedules" plugins/office --include=*.ts --include=*.tsx`: after Step 6 nothing but test doubles' own names may be left.

- [ ] **Step 6: The server entry**

In `plugins/office/server/paseo-holder.ts` add `wait(): Promise<Paseo>` to the interface and the holder: it resolves at once when the API is held, and otherwise when `remember` is first called (keep one pending promise and its resolver). Doc comment: a run that falls due before any handler brought the API waits for it.

In `plugins/office/index.server.ts`:

- `OfficePluginDeps` gains `schedules: LocalSchedules;` (comment: the office's own engine; a test hands in a recording one).
- `createNotesSchedule({ schedules: deps.schedules, ... })` and `createIncidentsSchedule({ schedules: deps.schedules, log })`.
- The two `server.handleSchedule(...)` calls become:

```ts
// The 8:00 run ends once the writer started; the writer's own end is its turn's hook.
const stopNotesRuns = deps.schedules.handle(NOTES_SCHEDULE, async () => {
  await holder.wait();
  await writer.start();
});
```

```ts
// A check never rejects: a tracker that fails shows its problem on the Incidents card.
const stopIncidentsRuns = deps.schedules.handle(INCIDENTS_SCHEDULE, async () => {
  await holder.wait();
  await incidents.check();
});
```

- The stop function the plugin returns calls `deps.schedules.stop()` with the other stops.
- In `contribute`, `schedules: createLocalSchedules({ clock: nodeClock, log })`.
- Rewrite the comment "The daemon keeps the 8:00 schedule across restarts ..." to say what is true now: the office keeps its own schedules and sets them from its settings at each load and each save.

In `plugins/office/index.server.test.ts`: the fake server no longer has `schedules` or `handleSchedule`. Hand `createOfficePlugin` a recording engine in `deps.schedules` that writes the same `recorded.schedules` strings (`upsert <name> ...`, `remove <name>`) and keeps the handlers in the same map the tests already run them from, so each existing schedule test keeps its assertions. `recorded.scheduleFailure` makes that engine's `upsert` reject. Where a test ran a handler with `{ paseo }`, call `holder`'s way in first (any handler the test already calls remembers the API) and then run the handler with no argument. List in your report every test whose body changed.

- [ ] **Step 7: Run, typecheck, lint, format, commit**

```bash
cd plugins
npx vitest run office/server/local-schedules.test.ts --bail=1
npx vitest run office/index.server.test.ts --bail=1 > /tmp/office-server.txt 2>&1; tail -20 /tmp/office-server.txt
npx vitest run office/server/notes-schedule.test.ts --bail=1
npx vitest run office/server/incidents-schedule.test.ts --bail=1
cd ..
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office
npm run format:files -- plugins/office/server plugins/office/index.server.ts plugins/office/index.server.test.ts
git add -A plugins/office
git commit -m "feat(office): the office keeps its own schedules"
```

If the two schedule test files have other names, find them with `ls plugins/office/server | grep schedule`. Expected: all pass.

On the fork's daemon the old `standup-notes` and `incidents` plugin schedules stay stored and now have no handler. Add to the plugin's start-up, guarded so it does nothing on stock: `if ("schedules" in server) { for each of the two names: await (server as { schedules: { remove(name: string): Promise<boolean> } }).schedules.remove(name) }`, in a `try` that logs a failure. Comment it `// COMPAT(officeForkSchedules): removes the fork daemon's stored schedules; delete once the host runs stock Paseo.` Cover it with one test in `index.server.test.ts` (a fake server with `schedules.remove` sees both names; one without it is not touched).

---

### Task 3: The scene is embedded, not bundled by the daemon

A built-in gets `bundleBrowserScript` and its `directory` from the fork. An installed plugin's server runs from a compiled bundle (Task 1, F3), so the scene travels inside that bundle as a string in a generated module.

**Files:**

- Create: `plugins/office/scripts/build-world.mjs`
- Create (generated, committed): `plugins/office/server/world.generated.ts`
- Modify: `plugins/office/server/world-script.ts`, `plugins/office/server/world-script.test.ts`
- Modify: `plugins/office/index.server.ts`, `plugins/office/index.server.test.ts`
- Modify: the repo's format and lint ignore lists (`.oxfmtrc.json`, `.oxlintrc.json`) for the generated file

**Interfaces:**

- Produces: `WORLD_SCRIPT: string` exported from `plugins/office/server/world.generated.ts`; `node plugins/office/scripts/build-world.mjs [--check]`.
- `OfficePluginDeps.world` stays `WorldScript | null` (`{ read(): Promise<string> }`).

- [ ] **Step 1: The build script**

```js
// plugins/office/scripts/build-world.mjs
// Bundles the vendored scene into one browser script and writes it as a string in
// server/world.generated.ts, so the plugin's server carries it. `--check` writes nothing and
// fails when the committed file is not what the build makes.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ENTRY = path.join(ROOT, "vendor", "my-office", "src", "office", "paseo-entry.js");
const OUT = path.join(ROOT, "server", "world.generated.ts");

const result = await build({
  entryPoints: [ENTRY],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "es2020",
  minify: true,
  write: false,
  logLevel: "silent",
});
const script = result.outputFiles[0]?.text;
if (!script) throw new Error(`No script was built from ${ENTRY}`);

const module = [
  "// Generated by scripts/build-world.mjs from vendor/my-office. Do not edit.",
  "/** The page script that draws the 3D office: one self-contained browser script. */",
  `export const WORLD_SCRIPT: string = ${JSON.stringify(script)};`,
  "",
].join("\n");

if (process.argv.includes("--check")) {
  const committed = readFileSync(OUT, "utf8");
  if (committed !== module) {
    console.error("server/world.generated.ts is stale: run node scripts/build-world.mjs");
    process.exit(1);
  }
  console.log("server/world.generated.ts is up to date");
} else {
  writeFileSync(OUT, module);
  console.log(`wrote ${path.relative(ROOT, OUT)} (${script.length} characters)`);
}
```

The options are the fork's `bundleBrowserScript` (`packages/server/src/server/plugins/browser-script.ts`), so the script is the one the daemon builds today. `JSON.stringify` output is a valid TypeScript string literal except for U+2028 and U+2029: if the built script contains either, escape them (`.replace(/ /g, "\\u2028").replace(/ /g, "\\u2029")`) and say so.

- [ ] **Step 2: Build it, and keep the tools off it**

```bash
node plugins/office/scripts/build-world.mjs
node plugins/office/scripts/build-world.mjs --check
```

Add `plugins/office/server/world.generated.ts` to the ignore lists of `.oxfmtrc.json` and `.oxlintrc.json` (read each file for its ignore key). Check that esbuild resolves from the repo root (`node -e "require.resolve('esbuild')"`); it does today through the workspace.

Run the build twice and compare (`sha256sum`): the output must not differ between runs. If it does, find what varies (a timestamp, an absolute path) and remove it, since `--check` is CI's gate in part 2.

- [ ] **Step 3: Change the world script's tests**

Replace `plugins/office/server/world-script.test.ts` with:

```ts
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { WORLD_SCRIPT } from "./world.generated.js";
import { embeddedWorldScript } from "./world-script.js";

const BUILD = fileURLToPath(new URL("../scripts/build-world.mjs", import.meta.url));

describe("the 3D office's page script", () => {
  it("is the embedded script, whenever it is read", async () => {
    const world = embeddedWorldScript();
    expect(await world.read()).toBe(WORLD_SCRIPT);
    expect(await world.read()).toBe(WORLD_SCRIPT);
  });

  it("is one self-contained browser script that sets the scene's entry", () => {
    expect(WORLD_SCRIPT.length).toBeGreaterThan(100_000);
    expect(WORLD_SCRIPT).toContain("PaseoOfficeWorld");
    // Bundled: nothing is left to resolve in the frame.
    expect(WORLD_SCRIPT).not.toMatch(/\bfrom\s*["']three["']/);
  });

  it("is what the build makes from the vendored scene", () => {
    // Fails when vendor/my-office changed and the script was not built again.
    expect(() => execFileSync("node", [BUILD, "--check"], { stdio: "pipe" })).not.toThrow();
  }, 60_000);
});
```

Keep any other test this file has that is not about the daemon's bundling (read it first); the import of `packages/server/.../browser-script.js` goes, and with it the office's one reach outside its folder.

- [ ] **Step 4: The world script reads the embedded module**

Replace `plugins/office/server/world-script.ts` with:

```ts
import { WORLD_SCRIPT } from "./world.generated.js";

export interface WorldScript {
  /** The script of the page that draws the 3D office. */
  read(): Promise<string>;
}

/**
 * The scene's script as the plugin carries it: built from `vendor/my-office` by
 * `scripts/build-world.mjs` and embedded, so no host has to bundle it and the plugin need not
 * know its own folder.
 */
export function embeddedWorldScript(): WorldScript {
  return { read: async () => WORLD_SCRIPT };
}
```

In `plugins/office/index.server.ts`: `world: embeddedWorldScript()` in `contribute`; delete the local `BuiltinPluginInfo` interface's `bundleBrowserScript` (and the interface with its `builtin` parameter if nothing else reads `directory`: check `hostSkillFolders` and the other deps first). `OfficePluginDeps.world` stays nullable only if a test still passes `null`; if none does, make it `WorldScript` and delete the "This host cannot build the 3D office" branch with its test.

- [ ] **Step 5: Run, typecheck, lint, format, commit**

```bash
cd plugins
npx vitest run office/server/world-script.test.ts --bail=1
npx vitest run office/index.server.test.ts --bail=1 > /tmp/office-server.txt 2>&1; tail -20 /tmp/office-server.txt
cd ..
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office
npm run format:files -- plugins/office/server/world-script.ts plugins/office/server/world-script.test.ts plugins/office/index.server.ts plugins/office/scripts/build-world.mjs
git add -A plugins/office .oxfmtrc.json .oxlintrc.json
git commit -m "feat(office): the plugin carries the scene's script, built ahead"
```

Update `plugins/office/vendor/SOURCES.md` in the same commit: where it says the daemon bundles the scene, say the script is built by `scripts/build-world.mjs` into `server/world.generated.ts`; and in "Taking a newer upstream", the step that ran `server/world-script.test.ts` to build the entry becomes "run `node scripts/build-world.mjs`, then the test".

---

### Task 4: The daemon's process and environment, from the plugin's side

A built-in's `process.pid` is the daemon and its `process.env` the daemon's. An installed plugin is a subprocess. This task makes the office say which process it means, using Task 1's findings.

**Files:**

- Create: `plugins/office/server/host-process.ts`
- Test: `plugins/office/server/host-process.test.ts`
- Modify: `plugins/office/index.server.ts`
- Read first: `docs/superpowers/specs/2026-11-18-paseo-office-stock-findings.md` (F1, F2, F6)

**Interfaces:**

- Produces:

```ts
export interface HostProcessPorts {
  /** This process and its parent. */
  pid: number;
  ppid: number;
  /** True when the office runs in the daemon's own process (a built-in). */
  inDaemon: boolean;
}
/** The process whose ancestors the clean-up must never stop: the daemon when it can be told, else this one. */
export function daemonPid(ports: HostProcessPorts): number;
```

- [ ] **Step 1: Decide by the findings**

- **F6** says whether an installed plugin's `contribute` gets a second argument. The fork passes a built-in one. So `inDaemon` is `builtin !== undefined` if F6 found none for an installed plugin; if F6 found one, use a field only the fork's built-in argument has (`directory` with no installed marker) and say which.
- **F1** says what the subprocess's parent is. If the parent is the daemon, `daemonPid` is `ppid` when not in the daemon. If the daemon is further up (a supervisor between), `daemonPid` stays `ppid`: `readAncestors` (`server/machine/cleanup.ts`) already walks up from the pid it is given, so every ancestor of the plugin, the daemon among them, is protected either way. Write the finding into the function's comment.
- **F2** says whether `PASEO_HOME` reaches the subprocess. If it does, nothing changes in how `boardsFile(process.env, homedir())` and its siblings find their folder. If it does not, the office falls back to `~/.paseo` there, which is wrong for a host with another home: then add to the README notes for part 2 ("set `PASEO_HOME` in the daemon's environment the plugin inherits") and record it in the findings' table as an open item for part 2. Do not invent another way to find the home.

- [ ] **Step 2: Write the failing test**

```ts
// plugins/office/server/host-process.test.ts
import { expect, test } from "vitest";
import { daemonPid } from "./host-process.js";

test("in the daemon's own process the daemon is this process", () => {
  expect(daemonPid({ pid: 100, ppid: 1, inDaemon: true })).toBe(100);
});

test("in a subprocess the daemon is found from the parent", () => {
  expect(daemonPid({ pid: 200, ppid: 100, inDaemon: false })).toBe(100);
});

test("a subprocess with no parent to name protects itself", () => {
  expect(daemonPid({ pid: 200, ppid: 0, inDaemon: false })).toBe(200);
});
```

Run: `cd plugins && npx vitest run office/server/host-process.test.ts --bail=1`. Expected: FAIL, no module.

- [ ] **Step 3: Write it**

```ts
// plugins/office/server/host-process.ts
export interface HostProcessPorts {
  /** This process and its parent. */
  pid: number;
  ppid: number;
  /** True when the office runs in the daemon's own process (a built-in of the fork). */
  inDaemon: boolean;
}

/**
 * The process the host's clean-up starts its protected ancestors from. A built-in is the daemon.
 * An installed plugin is a subprocess the daemon started, so its parent leads to the daemon; the
 * clean-up walks up from there, which covers a supervisor above it too.
 */
export function daemonPid(ports: HostProcessPorts): number {
  if (ports.inDaemon) return ports.pid;
  return ports.ppid > 0 ? ports.ppid : ports.pid;
}
```

- [ ] **Step 4: Use it**

In `plugins/office/index.server.ts`, `machine.selfPid` becomes
`daemonPid({ pid: process.pid, ppid: process.ppid, inDaemon })` with `inDaemon` from Step 1, and the two comments "Built-ins run in the daemon process ..." are rewritten to say what holds in both cases. Read `server/machine/reading.ts` and `watch.ts` for any other use of "this process is the daemon" (a reading of the daemon's own memory, for example): each takes the same pid. List what you found in the report, including "none".

- [ ] **Step 5: Run, typecheck, lint, format, commit**

```bash
cd plugins
npx vitest run office/server/host-process.test.ts --bail=1
npx vitest run office/index.server.test.ts --bail=1 > /tmp/office-server.txt 2>&1; tail -20 /tmp/office-server.txt
cd ..
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/server/host-process.ts plugins/office/index.server.ts
npm run format:files -- plugins/office/server/host-process.ts plugins/office/server/host-process.test.ts plugins/office/index.server.ts
git add -A plugins/office docs
git commit -m "feat(office): the office finds the daemon from a subprocess too"
```

---

### Task 5: The fork-only calls sit behind the office's own types

Four things exist only in the fork's SDK and app: `cancel()` and `closeRuntime()` on an agent, the kit's `ScriptFrame`, and `navigation.showBeside`. The office already asks whether two of them are there. This task makes all four typecheck without the fork's types and hides what a host cannot do.

**Files:**

- Create: `plugins/office/shared/host-extras.ts`
- Test: `plugins/office/shared/host-extras.test.ts`
- Modify: `plugins/office/client/use-agent-actions.ts`, `client/agent-card.tsx`, `client/permission-actions.tsx` or wherever Stop is drawn (find with `grep -rn "cancel" plugins/office/client --include=*.tsx`), their tests
- Modify: `plugins/office/client/world/script-frame-kit.ts`, `client/beside.ts`
- Modify: `plugins/office/server/machine/live-ports.ts`, `server/machine/cleanup.ts`, the Host card that offers the clean-up (`client/machine-card.tsx`), their tests

**Interfaces:**

- Produces, in `plugins/office/shared/host-extras.ts`:

```ts
/** An agent's calls that only some hosts have. */
export interface AgentExtras {
  cancel?: () => Promise<void>;
  closeRuntime?: () => Promise<void>;
}
/** The call, bound to its object, or null on a host without it. */
export function extra<Name extends keyof AgentExtras>(
  ref: object,
  name: Name,
): NonNullable<AgentExtras[Name]> | null;
```

- `AgentActions.cancel: ((agentId: string) => Promise<void>) | null` (null where the host cannot stop a turn).
- `CleanupPorts.closeRuntime: ((agentId: string) => Promise<void>) | null`.

- [ ] **Step 1: Write the failing test**

```ts
// plugins/office/shared/host-extras.test.ts
import { expect, test } from "vitest";
import { extra } from "./host-extras.js";

test("a host with the call gives it, bound to its object", async () => {
  const ref = {
    stopped: 0,
    async cancel(this: { stopped: number }) {
      this.stopped += 1;
    },
  };
  const cancel = extra(ref, "cancel");
  await cancel?.();
  expect(ref.stopped).toBe(1);
});

test("a host without the call gives null", () => {
  expect(extra({}, "cancel")).toBeNull();
  expect(extra({ closeRuntime: "not a function" }, "closeRuntime")).toBeNull();
});
```

Run: `cd plugins && npx vitest run office/shared/host-extras.test.ts --bail=1`. Expected: FAIL, no module.

- [ ] **Step 2: Write it**

```ts
// plugins/office/shared/host-extras.ts
/**
 * An agent's calls that only some hosts have: the fork's SDK adds them, stock Paseo's does not.
 * The office asks for each where it uses it and offers the action only when it is there.
 */
export interface AgentExtras {
  /** Stops the running turn. */
  cancel?: () => Promise<void>;
  /** Closes the agent's runtime; its next prompt resumes it. */
  closeRuntime?: () => Promise<void>;
}

/** The call, bound to its object, or null on a host without it. */
export function extra<Name extends keyof AgentExtras>(
  ref: object,
  name: Name,
): NonNullable<AgentExtras[Name]> | null {
  const value: unknown = (ref as Record<string, unknown>)[name];
  if (typeof value !== "function") return null;
  return (value as () => Promise<void>).bind(ref) as NonNullable<AgentExtras[Name]>;
}
```

- [ ] **Step 3: Stop a turn only where the host can**

`plugins/office/client/use-agent-actions.ts`: `cancel` is worked out once from a probe ref (`extra(paseo.agents.ref("probe"), "cancel") !== null`): if `agents.ref` cannot be called with a made-up id without a request being sent, probe on first use instead and keep the answer in the hook's state; read `packages/client/src/index.ts` `ref` to see which. Where it is there, `cancel: (agentId) => extra(paseo.agents.ref(agentId), "cancel")!()`; where it is not, `cancel: null`. Update the interface and its comment (it says "the SDK's cancel(), added for the office").

Every place that draws Stop (find them with `grep -rn "\.cancel\b" plugins/office/client --include=*.tsx`): not drawn when `actions.cancel === null`. Tests: each such component's mounted test gains one case with `cancel: null` (no Stop button) and keeps its case with a function. The mocks that give `usePaseo().agents.ref()` a `cancel` stay; add one mount without it.

- [ ] **Step 4: Close a runtime only where the host can**

`plugins/office/server/machine/live-ports.ts`: `closeRuntime` is `(agentId) => { const call = extra(holder.require().agents.ref(agentId), "closeRuntime"); if (call === null) throw new Error("This host cannot close an agent's runtime"); return call(); }`, and beside it a `canCloseRuntime(): boolean` the machine's reading carries to the client (find where the Host card learns what the clean-up can do: `server/machine/machine.ts`, `shared/contracts.ts` `Machine`). If the `Machine` contract has no field for it, add an optional boolean (optional, so an older client reads a newer server and the reverse). The Host card does not offer the clean-up's close when it is false. One server test and one card test each way.

- [ ] **Step 5: ScriptFrame and showBeside without the fork's types**

`plugins/office/client/world/script-frame-kit.ts` imports `ScriptFrameHandle` and `ScriptFrameProps` from the kit; stock's kit has neither. Define both in this file, copied from the fork's `packages/plugin/src/client/ui.ts` with their comments, and read the component through a widened view of the kit:

```ts
import * as kit from "@getpaseo/plugin/client/ui";

const extras = kit as unknown as { ScriptFrame?: KitScriptFrame };

export function hasScriptFrame(): boolean {
  return "ScriptFrame" in kit;
}

export function kitScriptFrame(): KitScriptFrame | null {
  return extras.ScriptFrame ?? null;
}
```

Keep the existing comment about asking with `in`. Every other file that imports those two types from the kit imports them from here (`grep -rn "ScriptFrameHandle\|ScriptFrameProps" plugins/office`).

`plugins/office/client/beside.ts` and every other reader of `navigation.showBeside` (`grep -rn "showBeside" plugins/office --include=*.ts --include=*.tsx`): the `PluginBesideTarget` type and the `showBeside` member come from the fork's `contracts.ts`. Define in `beside.ts`:

```ts
/** What the fork's app can show beside a plugin's screen; stock Paseo's app has no side area. */
export type BesideTarget =
  | { kind: "agent"; agentId: string; serverId?: string }
  | { kind: "screen"; pluginId: string; screenId: string; params?: Record<string, string> };

type Navigation = PluginSurfaceProps["navigation"];

/** The app's `showBeside`, where it has one. */
export function showBesideOf(navigation: Navigation): ((target: BesideTarget) => boolean) | null {
  const call: unknown = (navigation as Record<string, unknown> | undefined)?.showBeside;
  return typeof call === "function" ? (call as (target: BesideTarget) => boolean) : null;
}
```

Copy `BesideTarget`'s exact shape from the fork's `PluginBesideTarget` (`packages/plugin/src/client/contracts.ts`), not from the lines above, and use `showBesideOf` in `openSessionWith` and `resourcesOpener`. Their tests keep passing unchanged (they hand in a `navigation` with or without `showBeside`).

- [ ] **Step 6: Run, typecheck, lint, format, commit**

Run each test file this task touched, one at a time, then:

```bash
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office
npm run format:files -- plugins/office/shared plugins/office/client plugins/office/server/machine
git add -A plugins/office
git commit -m "feat(office): what only some hosts can do is asked for, not assumed"
```

---

### Task 6: The proof: the office typechecks against the published SDK

**Files:**

- Create: `plugins/office/scripts/check-stock.sh`
- Modify: `docs/superpowers/specs/2026-11-18-paseo-office-stock-findings.md` (a "Proof" section), `docs/superpowers/specs/2026-11-18-paseo-office-design.md` (status, and the table "Running on stock Paseo" where this plan settled something differently)
- Modify: `docs/plugins.md` (the office section: schedules, the scene's script)

**Interfaces:**

- Consumes: Tasks 2 to 5; Task 1's `/tmp/paseo-stock` (rebuild it by Task 1's Step 1 if it is gone).
- Produces: `bash plugins/office/scripts/check-stock.sh` exits 0 when the office typechecks against `@getpaseo/plugin@0.16.2` alone. Part 2 turns it into the new repo's CI.

- [ ] **Step 1: The script**

```bash
#!/usr/bin/env bash
# Copies the office out of the workspace and typechecks it against the published plugin SDK,
# with nothing of the fork on its path. Exits non-zero on the first type that only the fork has.
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
OUT="${1:-/tmp/office-stock-check}"
SDK="${OFFICE_SDK_VERSION:-0.16.2}"
rm -rf "$OUT" && mkdir -p "$OUT"
# The tests lean on the workspace's vitest setup; part 2 gives the new repo its own.
rsync -a --exclude 'node_modules' --exclude '*.test.ts' --exclude '*.test.tsx' "$HERE/" "$OUT/"
cd "$OUT"
cat > package.json <<JSON
{
  "name": "paseo-office",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "dependencies": { "@getpaseo/plugin": "$SDK", "zod": "^4.4.3" },
  "devDependencies": {
    "@types/node": "^20.9.0",
    "@types/react": "^19.2.0",
    "react": "19.2.3",
    "react-native": "0.86.3",
    "typescript": "^5.9.3"
  }
}
JSON
cat > tsconfig.json <<JSON
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2023", "DOM"],
    "types": ["node"],
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "jsx": "react-jsx"
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "vendor", "scripts"]
}
JSON
npm install --no-audit --no-fund >/dev/null
npx tsc -p tsconfig.json
echo "the office typechecks against @getpaseo/plugin@$SDK"
```

Copy the compiler options that matter from the workspace's `tsconfig.base.json` (read it: `strict` flags, `noUncheckedIndexedAccess` and the like) so the check is as strict as the workspace's. Test helpers that non-test files import (`fake-clock.ts`, `fake-schedules.ts`, `fake-proc.ts`) are not `*.test.ts` and stay in.

- [ ] **Step 2: Run it and fix what it finds**

Run: `bash plugins/office/scripts/check-stock.sh`

Every error is a tie to the fork that Tasks 2 to 5 missed. Fix each in `plugins/office` the way Task 5 did (a type of the office's own, asked for where it is used), keep the fork's behaviour, re-run the tests of each file you touch, and list every fix in the report. If an error cannot be fixed without changing behaviour on the fork, stop and report it rather than choosing.

Expected at the end: `the office typechecks against @getpaseo/plugin@0.16.2`.

- [ ] **Step 3: The probe, with the real office**

With the stock daemon from Task 1 running again (its Step 1; port 6798): install the checked copy as a directory plugin under another id so it cannot be mistaken for the host's (`paseo plugin install /tmp/office-stock-check --id office`), on the throwaway daemon only. Read `paseo plugin logs office`: it loaded; the two schedules were set or left unset by the default settings; no error names a missing call. If the daemon's web UI on 6798 can be opened in the Paseo browser without credentials, open the office and Settings > Plugins > Office and record what is seen; if not, say it was not seen. Stop the daemon and check port 6798 is free.

This is a first look, not the release's check: part 2 installs from the new repo by Git.

- [ ] **Step 4: The docs**

- `docs/plugins.md`, the office section: where it describes the 8:00 schedule and the incidents check as the daemon's plugin schedules, and the scene as bundled by the daemon, say what is true now (the office's own schedules, `server/local-schedules.ts`, with a missed run not made up; the embedded script and `scripts/build-world.mjs`). Integrate; follow `CLAUDE.md`'s "Writing docs" and "Doc voice".
- The findings file: a "Proof" section with the script's last line, what Step 2 fixed, and what Step 3 saw.
- The design spec: status "part 1 built"; in "Running on stock Paseo", correct any row this plan settled differently (the scene is an embedded module, not `dist/world.js`; whatever F2 and F4 decided).

- [ ] **Step 5: Commit**

```bash
npm run format:files -- docs/plugins.md docs/superpowers/specs/2026-11-18-paseo-office-stock-findings.md docs/superpowers/specs/2026-11-18-paseo-office-design.md
npm run lint -- plugins/office
git add -A plugins/office docs
git commit -m "feat(office): the office typechecks against the published plugin SDK"
```
