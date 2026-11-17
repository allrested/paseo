# Office incidents Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every 5 minutes the office checks Jira for new bugs and Sentry for new unresolved issues in the projects listed in its settings. A new one opens an incident on the host, which sets off upstream's alarm and siren on the 3D floor and shows on an Incidents strip card until dismissed or a day old.

**Architecture:** One office plugin schedule, kept in step with the settings like the stand-up notes schedule, runs a check that reads both trackers through their REST APIs with tokens from the daemon's environment. The check's result lives in `$PASEO_HOME/office/incidents.json` and rides `office.state` as an optional `incidents` field. The client shows an Incidents card with Dismiss (`office.incidents.dismiss.request`) and passes the open incidents to the scene through a new `setIncidents` call. The scene takes upstream's alarm from `life/incidents.js` and only the siren from upstream's `audio/sfx.js`.

**Tech Stack:** TypeScript, zod, React Native (react-native-web in a browser), vitest, the plugin kit (`@getpaseo/plugin`), node's `fetch`, three.js r160 in the vendored scene (plain JavaScript), Web Audio.

**Spec:** `docs/superpowers/specs/2026-11-17-office-incidents-design.md` (sub-project 8 of `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`).

## Global Constraints

- Work in a worktree of your own on branch `feat/office-incidents`, made off `main` (`git worktree add <path> -b feat/office-incidents main`). Never write in `/workspace/QFlavours/paseo` or another agent's worktree. Do not push.
- Every subagent, implementer and reviewer alike, runs on Opus.
- No commit carries AI attribution: no `Co-Authored-By` trailer, no "Generated with" line.
- Run one test file at a time, from the repo root: `npx vitest run <file> --bail=1`. Never run a whole suite.
- After each task's code: `npm run typecheck --workspace=<package>` for each package touched, then `npm run lint -- <changed .ts/.tsx files outside plugins/office/vendor/>`, then `npm run format:files -- <changed files outside plugins/office/vendor/>`.
- No upstream file under `plugins/office/vendor/my-office/` is edited by hand, except the stand-ins and `src/office/paseo-*.js`. `life/incidents.js` and `audio/sfx.js` are stand-ins today and become trimmed copies of upstream's; code there keeps upstream's style.
- Never restart or touch the daemon on port 6767. No test calls the real Jira or Sentry: tests use a local HTTP server.
- Secrets: never print, log, store or send a token's value anywhere but the tracker's `Authorization` header. Logs and problems carry a status and the tracker's message only. Check a variable with `[ -n "$VAR" ]`.
- The office's server does not import from `plugins/tasks`; it has its own small HTTP helper.
- Snippets are in `text` fences on purpose, so the formatter leaves them as they are.

Binding values from the spec:

- Tokens from the daemon's env: Jira `ATLASSIAN_BASE_URL`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`; Sentry `SENTRY_AUTH_TOKEN`. Read at start; a change needs a daemon restart.
- Settings (host, `officeHostSettings` version 3, version 2's values kept): `jiraProjects` (comma separated keys, `""`), `sentryOrg` (`""`), `sentryProjects` (comma separated slugs, `""`), `sentryUrl` (`"https://sentry.io"`). Key `^[A-Z][A-Z0-9_]+$`, slug `^[a-z0-9][a-z0-9_-]*$`; `sentryUrl` https, http on loopback only.
- A tracker is on when its variables are set and it has a project (Sentry: and `sentryOrg`).
- Schedule `incidents`, handler `incidents`, label `Incidents`, cadence `{ type: "every", everyMs: 300000 }`, kept while a tracker is on, removed when none is.
- Jira: `GET <base>/rest/api/3/search/jql`, JQL `project in (<keys>) AND issuetype = Bug AND created >= "<yyyy-MM-dd HH:mm>" ORDER BY created ASC`, fields `summary,created`, link `<base>/browse/<key>`.
- Sentry: `GET <sentryUrl>/api/0/organizations/<org>/issues/`, `query=is:unresolved firstSeen:>=<ISO time>`, the listed projects, link `permalink`.
- Window: the last successful check less 10 minutes. Seen keys kept 2 days; a seen key never opens again.
- First check per tracker: save the time and keys, open nothing. A project added later keeps the tracker's time.
- At most 20 incidents opened per tracker per check, oldest first. Requests end after 30 s, no redirects.
- A failed check leaves the time; its problem is kept until a check succeeds and is logged once per change.
- Store `$PASEO_HOME/office/incidents.json`, written whole through a temp file. Incident `{ id, source: "jira" | "sentry", key, title, url, createdAt, foundAt }`, title cut at 200 characters.
- Closing: dismissed, or 24 h after `foundAt`.
- State: optional `incidents: { open: Incident[], problems: { jira?: string, sentry?: string } }` on the snapshot.
- Strip: an Incidents entry while an incident is open or a tracker has a problem; card newest first with source, key, linked title, age, Dismiss, and "Dismiss all".
- 3D: 25 s of red pulsing light and red stage, a fail bubble for each person at work, the siren, once per incident per device (ids kept 2 days). Banner while any is open: `Incident: <key> <title>`, `+N more`; a click opens the card. Reduced motion: steady red, the siren still plays. Upstream's three-failures trigger and `headache()` are not taken.

Decided in this plan, where the spec left it open:

- The ids a device rang for live in the `office-device` setting as `rungIncidents: Record<id, epoch ms>` (version 2), pruned to 2 days on each write. It survives reopening on the web and in the app, which the frame's storage would not promise.
- Sentry's issue search filters projects by id, not slug. Each check first lists `GET /api/0/organizations/<org>/projects/` and maps the slugs to ids; an unknown slug is the tracker's problem.
- `setIncidents` is optional on `WorldApi`, so `WORLD_API_VERSION` stays 1.
- An incident's `id` is `<source>:<key>`.

## Review Focus

1. **A Jira user whose profile time zone is far from the host's.** `created >= "<time>"` is read in the Jira user's zone, which the 10-minute margin does not cover. Format the time in the zone `GET /rest/api/3/myself` reports (`timeZone`), read once per check. Pinned in Task 3.
2. **A tracker that answers 401 or 403.** A problem naming the variable to check, the time unmoved, nothing opened, and no header or token in the text. Pinned in Task 3 and Task 4.
3. **The store file deleted or corrupt while the daemon runs.** The next check is a first check and opens nothing for the backlog. Pinned in Task 2 and Task 4.
4. **A burst of 50 new bugs.** 20 open now, the rest at the next checks, none lost and none twice. Pinned in Task 4.
5. **The office opened on a second device after the first rang.** The second rings once too; the first does not ring again after reopening. Pinned in Task 7.

---

### Task 1: The contracts and the settings

**Files:**

- Modify: `plugins/office/shared/settings.ts`
- Modify: `plugins/office/shared/contracts.ts`
- Test: `plugins/office/shared/settings.test.ts`, `plugins/office/shared/contracts.test.ts` (create if absent)

**Interfaces:**

- Produces in `shared/contracts.ts`:

```text
export const INCIDENT_SOURCES = ["jira", "sentry"] as const;
export const IncidentSchema = z.object({
  id: z.string(), source: z.enum(INCIDENT_SOURCES), key: z.string(), title: z.string(),
  url: z.string(), createdAt: z.number(), foundAt: z.number(),
});
export type Incident = z.output<typeof IncidentSchema>;
export const IncidentsStateSchema = z.object({
  open: z.array(IncidentSchema),
  problems: z.object({ jira: z.string().optional(), sentry: z.string().optional() }),
  /** The tracker's token variables are set on the host. Never the values. */
  jiraReady: z.boolean(),
  sentryReady: z.boolean(),
  scheduleError: z.string().nullable(),
});
export type IncidentsState = z.output<typeof IncidentsStateSchema>;
// OfficeSnapshotSchema gains: incidents: IncidentsStateSchema.optional()
export const incidentsDismissRpc = defineRpc({
  name: "office.incidents.dismiss.request",
  input: z.object({ ids: z.array(z.string()).optional() }),   // none: all
  output: z.object({ dismissed: z.number().int().nonnegative() }),
});
```

- Produces in `shared/settings.ts`: the four host fields, `version: 3`; `parseKeys(text: string, pattern: RegExp): string[]` (split on commas, trim, drop empty); `JIRA_KEY = /^[A-Z][A-Z0-9_]+$/`, `SENTRY_SLUG = /^[a-z0-9][a-z0-9_-]*$/`. The schema refuses a list with an entry that does not match, and a `sentryUrl` that is not https outside loopback. `officeDeviceSettings` gains `rungIncidents: z.record(z.string(), z.number()).default({})`, version 2.

- [ ] **Step 1: Write the failing tests**

```text
test("host settings: version 2 values stay and the incident fields take their defaults")
  migrate({ agentTools: false, notesFolder: "/n", notesTimeZone: "" }) → same + jiraProjects "", sentryOrg "", sentryProjects "", sentryUrl "https://sentry.io"
test("a Jira list with a bad key is refused")  "FPOS, fpos" → parse fails; "FPOS, QA_2" → ok
test("a Sentry list with a bad slug is refused")  "web, Bad Slug" → fails
test("the Sentry address must be https off loopback")  "http://sentry.example.com" fails; "http://127.0.0.1:9000" ok
test("parseKeys trims and drops empty entries")  " FPOS , ,QA " → ["FPOS", "QA"]
test("a snapshot without incidents parses")  OfficeSnapshotSchema.parse(old snapshot) ok
test("device settings: version 1 values stay and rungIncidents is {}")
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run plugins/office/shared/settings.test.ts --bail=1`
Expected: FAIL on the missing fields.

- [ ] **Step 3: Add the fields, schemas and RPC as above**

Both settings keep `migrate: (values) => values`. The settings' `.refine` messages name the field and the bad entry, e.g. `"jiraProjects: \"fpos\" is not a Jira project key"`.

- [ ] **Step 4: Run them and see them pass**

Run both test files. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/shared
git commit -m "feat(office): settings and contracts for incidents"
```

---

### Task 2: The incidents store

**Files:**

- Create: `plugins/office/server/incidents-store.ts`
- Modify: `plugins/office/server/paths.ts` (`incidentsFile`)
- Test: `plugins/office/server/incidents-store.test.ts`

**Interfaces:**

- Consumes: `IncidentSchema` (Task 1).
- Produces:

```text
export function incidentsFile(env: NodeJS.ProcessEnv, home: string): string   // <officeDir>/incidents.json
export interface TrackerMark { checkedAt: number; seen: Record<string, number> }   // key → when seen
export interface IncidentsData { version: 1; trackers: Partial<Record<IncidentSource, TrackerMark>>; open: Incident[] }
export const EMPTY_INCIDENTS: IncidentsData
export interface IncidentsStore { load(): Promise<IncidentsData>; save(data: IncidentsData): Promise<void> }
export function createIncidentsStore(options: { file: string; log(message: string): void }): IncidentsStore
```

`load` never rejects: a missing file is `EMPTY_INCIDENTS`; a broken one is too, and logs only the error's kind. `save` writes through a temp file with mode 0o600, in order, as `board-store.ts` does.

- [ ] **Step 1: Write the failing tests**

```text
test("a missing file loads as empty")
test("a broken file loads as empty and logs its kind, not its text")  file "{not json SECRET" → log has no "SECRET"
test("save then load gives the same data")
test("two saves in a row land in order")
test("the file is mode 600")
```

- [ ] **Step 2: Run and see it fail** — `npx vitest run plugins/office/server/incidents-store.test.ts --bail=1`, FAIL: module not found.
- [ ] **Step 3: Implement the store** after `server/board-store.ts`'s pattern.
- [ ] **Step 4: Run and see it pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(office): keep incidents on disk"`

---

### Task 3: The Jira and Sentry readers

**Files:**

- Create: `plugins/office/server/incidents-http.ts`, `plugins/office/server/incidents-jira.ts`, `plugins/office/server/incidents-sentry.ts`
- Test: `plugins/office/server/incidents-jira.test.ts`, `plugins/office/server/incidents-sentry.test.ts`

**Interfaces:**

- Produces:

```text
export interface FoundIssue { key: string; title: string; url: string; createdAt: number }
export interface TrackerReader { read(since: number): Promise<FoundIssue[]> }   // oldest first; rejects with TrackerProblem
export class TrackerProblem extends Error {}   // message safe to show: status and tracker's message only
export interface JiraEnv { baseUrl: string; email: string; token: string }
export function jiraEnv(env: NodeJS.ProcessEnv): JiraEnv | null   // null unless all three are set
export function createJiraReader(env: JiraEnv, projects: string[], fetchFn?: typeof fetch): TrackerReader
export function sentryToken(env: NodeJS.ProcessEnv): string | null
export function createSentryReader(input: { url: string; org: string; projects: string[]; token: string }, fetchFn?: typeof fetch): TrackerReader
```

`incidents-http.ts` has `getJson(url, headers, schema, fetchFn)`: `redirect: "manual"`, `AbortSignal.timeout(30_000)`, a 3xx is a problem "answered with a redirect", a 401/403 is `"<tracker> refused the token: check <VARIABLE>"`, other errors carry the status and the body's `errorMessages[0]` or `detail`, cut at 200 characters. Jira reads `GET /rest/api/3/myself` for `timeZone` once per `read`, then pages the search (`nextPageToken`) up to 100 issues. Sentry maps slugs through `/api/0/organizations/<org>/projects/`, reads one page of 100 issues with `sort=new`, and returns them sorted by `firstSeen` ascending itself, since the API has no ascending order.

- [ ] **Step 1: Write the failing tests**, each against a `node:http` server on `127.0.0.1:0`:

```text
jira: "builds the JQL with the keys, Bug and the time in the user's zone"
  myself → { timeZone: "Asia/Riyadh" }; since = Date.UTC(2026,10,17,5,0) → jql contains `created >= "2026-11-17 08:00"` and `project in (FPOS, QA)`
jira: "sends basic auth and maps issues to links"  url = `<base>/browse/FPOS-12`, title from summary
jira: "a 401 is a problem naming ATLASSIAN_API_TOKEN, without the header"  message has no "Basic"
jira: "a redirect is refused and not followed"  server answers 302 to a second server that counts hits → 0 hits
jira: "jiraEnv is null when one variable is missing"
sentry: "maps slugs to ids and queries unresolved since the time"  query has `is:unresolved firstSeen:>=2026-11-17T05:00:00.000Z` and `project=11&project=12`
sentry: "an unknown slug is a problem naming it"
sentry: "issues come back oldest first, linked by permalink"
sentry: "a 403 is a problem naming SENTRY_AUTH_TOKEN"
```

- [ ] **Step 2: Run each file, see it fail.**
- [ ] **Step 3: Implement the helper and the two readers.**
- [ ] **Step 4: Run each file, see it pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(office): read new Jira bugs and Sentry issues"`

---

### Task 4: The check

**Files:**

- Create: `plugins/office/server/incidents-check.ts`
- Test: `plugins/office/server/incidents-check.test.ts`

**Interfaces:**

- Consumes: Task 2's store types, Task 3's `TrackerReader`, `FoundIssue`, `TrackerProblem`.
- Produces:

```text
export const WINDOW_MARGIN_MS = 600_000; export const SEEN_FOR_MS = 172_800_000;
export const OPEN_FOR_MS = 86_400_000; export const MAX_NEW_PER_CHECK = 20;
export interface IncidentsPorts {
  readers(): Partial<Record<IncidentSource, TrackerReader>>   // the trackers that are on now
  store: IncidentsStore; now(): number; log(message: string): void;
  changed(state: Omit<IncidentsState, "scheduleError">): void;
}
export interface IncidentsCheck {
  start(): Promise<void>;        // loads the store and pushes the state
  check(): Promise<void>;        // one run; never rejects
  dismiss(ids?: string[]): Promise<number>;
}
export function createIncidentsCheck(ports: IncidentsPorts): IncidentsCheck
```

A run, per tracker that is on: no mark means read from `now - WINDOW_MARGIN_MS`, save `checkedAt = now` and every key as seen, open nothing. With a mark, read from `checkedAt - WINDOW_MARGIN_MS`, skip seen keys, open the oldest `MAX_NEW_PER_CHECK`, mark those as seen. `checkedAt` moves to `now` only when nothing was left over; with a leftover it moves to the `createdAt` of the last opened issue, so the rest come next time. A `TrackerProblem` (or any error, logged by kind) keeps the mark and sets the tracker's problem; a success clears it. Then drop seen keys older than `SEEN_FOR_MS` and open incidents older than `OPEN_FOR_MS`, save, and push. Runs are queued one at a time. A problem is logged only when it differs from the last.

- [ ] **Step 1: Write the failing tests**, with fake readers, an in-memory store and a fake clock:

```text
"the first check opens nothing and remembers the keys"
"a new key opens one incident with id jira:FPOS-3 and the title cut at 200"
"a key seen before never opens again, even after it was dismissed"
"an issue just inside the margin is read; one already seen is skipped"
"50 new issues: 20 now, 20 next, 10 after, none twice"
"a failed read keeps checkedAt, sets the problem, logs it once over two runs"
"a later success clears the problem"
"an incident 24 h old is dropped; seen keys 2 days old are dropped"
"a tracker turned off keeps its mark, and its incidents stay until they close"
"a store that loads empty mid-run makes the next run a first check"   (Review Focus 3)
"dismiss with ids closes those; without ids closes all; returns the count"
"two checks at once run one after the other"
```

- [ ] **Step 2: Run, see it fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run, see it pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(office): open incidents from new tracker issues"`

---

### Task 5: The schedule and the server's wiring

**Files:**

- Create: `plugins/office/server/incidents-schedule.ts`
- Modify: `plugins/office/server/hub.ts` (`setIncidents`), `plugins/office/index.server.ts`
- Test: `plugins/office/server/incidents-schedule.test.ts`, `plugins/office/server/hub.test.ts`, `plugins/office/index.server.test.ts`

**Interfaces:**

- Consumes: Tasks 1 to 4.
- Produces:

```text
export const INCIDENTS_SCHEDULE = "incidents";
export function incidentsReaders(values: HostValues, env: NodeJS.ProcessEnv): Partial<Record<IncidentSource, TrackerReader>>
export function incidentsCadence(on: boolean): ScheduleCadence | null   // { type: "every", everyMs: 300000 } or null
export function createIncidentsSchedule(ports: { schedules: PluginServerContext["schedules"]; log(message: string): void }): { sync(on: boolean): Promise<void>; error(): string | null }
// Hub: setIncidents(state: IncidentsState): void — the same state again sends nothing; a change broadcasts a snapshot.
```

`createIncidentsSchedule` follows `createNotesSchedule` line for line (one at a time, an unchanged schedule left alone, label `Incidents`). In `index.server.ts`: build the store from `incidentsFile(process.env, homedir())`; `readers` reads the current settings and `process.env`; `followSettings` also calls `incidentsSchedule.sync(Object.keys(readers).length > 0)` and pushes the state with `scheduleError`; `server.handleSchedule(INCIDENTS_SCHEDULE, ({ paseo }) => { holder.remember(paseo); return check.check(); })`; `server.handle(incidentsDismissRpc, ({ ids }) => guarded("incidents dismiss", async () => ({ dismissed: await check.dismiss(ids) })))`; `check.start()` at load; the cleanup removes the handler. The pushed state's `jiraReady` is `jiraEnv(process.env) !== null` and `sentryReady` is `sentryToken(process.env) !== null`.

- [ ] **Step 1: Write the failing tests**

```text
schedule: "kept every 5 minutes while on, removed when off, left alone when unchanged"
schedule: "a save that rejects is kept as the error and cleared by the next sync"
readers: "Jira is on only with all three ATLASSIAN_* and a project"
readers: "Sentry is on only with SENTRY_AUTH_TOKEN, an org and a project"
hub: "setIncidents broadcasts a snapshot carrying incidents; the same state sends nothing"
index.server: "a due incidents run calls the check; dismiss answers its count"
```

- [ ] **Step 2: Run each, see it fail.**
- [ ] **Step 3: Implement and wire.**
- [ ] **Step 4: Run each, see it pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(office): check the trackers every 5 minutes"`

---

### Task 6: The Incidents card, the strip entry and the settings fields

**Files:**

- Create: `plugins/office/client/incidents-card.tsx`, `plugins/office/client/incidents-text.ts`
- Modify: `plugins/office/client/office-surface.tsx` (the strip's cards), `plugins/office/client/host-switches.tsx` (the four fields)
- Test: `plugins/office/client/incidents-text.test.ts`, `plugins/office/client/incidents-card.mounted.test.tsx`, `plugins/office/client/host-switches.mounted.test.tsx`

**Interfaces:**

- Consumes: `IncidentsState`, `incidentsDismissRpc` (Task 1).
- Produces: `incidentsEntry(state: IncidentsState | undefined): StripCard | null`; `incidentRows(state, now): { id, sourceLabel: "Jira" | "Sentry", key, title, url, age: string }[]` newest first; `<IncidentsCard state onDismiss(ids?) onOpenUrl(url) />`.

Texts: the entry is `Incidents` with the open count, marked as needing attention; ages `just now`, `12 min ago`, `3 h ago`; a problem line `Jira: <problem>`; the empty card `No open incidents`. The settings fields: "Jira projects" hinted `Project keys, comma separated. Needs ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL and ATLASSIAN_API_TOKEN on the host.`, "Sentry organisation", "Sentry projects", "Sentry address". The schedule's error shows under them. A Jira field with a value while `jiraReady` is false shows `ATLASSIAN_BASE_URL, ATLASSIAN_EMAIL or ATLASSIAN_API_TOKEN is not set on this host` under it; the flag is a boolean, so the line names all three. A Sentry field likewise shows `SENTRY_AUTH_TOKEN is not set on this host`.

- [ ] **Step 1: Write the failing tests**

```text
text: "no state and no problem: no entry"; "one open: entry 'Incidents' with 1"; "a problem only: an entry with 0"
text: "rows newest first with ages at 0 s, 12 min and 3 h"
card: "Dismiss sends the incident's id; Dismiss all sends no ids; a failed dismiss shows its error and the row stays"
card: "the title opens the issue's url"
settings: "a bad key shows the schema's message and is not saved"
```

- [ ] **Step 2: Run each, see it fail.**
- [ ] **Step 3: Implement after `janitor-card.tsx` and `use-janitor.ts`.**
- [ ] **Step 4: Run each, see it pass.**
- [ ] **Step 5: Commit** — `git commit -m "feat(office): the Incidents card"`

---

### Task 7: The alarm and the siren on the 3D floor

**Files:**

- Modify (stand-ins become trimmed upstream copies): `plugins/office/vendor/my-office/src/office/life/incidents.js`, `plugins/office/vendor/my-office/src/office/audio/sfx.js`
- Modify: `plugins/office/vendor/my-office/src/office/paseo-entry.js` (`setIncidents`, `onIncidents`, the `#incident` banner in the page, setup calls), `plugins/office/vendor/my-office/src/office/paseo-style.js` (banner and `is-incident` style if missing), `plugins/office/vendor/SOURCES.md`
- Modify: `plugins/office/client/world/world-api.ts`, `plugins/office/client/world/world-view.tsx`, `plugins/office/client/office-surface.tsx` (open the card from the banner, keep rung ids)
- Create: `plugins/office/client/world/rung-incidents.ts`
- Test: `plugins/office/client/world/rung-incidents.test.ts`, `plugins/office/server/world-script.test.ts` (the bundle still builds)

**Interfaces:**

- Consumes: `Incident` (Task 1), `rungIncidents` device setting (Task 1), the card's open action (Task 6).
- Produces:

```text
// WorldApi
setIncidents?(incidents: readonly WorldIncident[]): void;
// WorldStartOptions
onIncidents?(): void;
export interface WorldIncident { id: string; key: string; title: string; ring: boolean }
// rung-incidents.ts
export function toRing(open: Incident[], rung: Record<string, number>): string[]
export function markRung(rung: Record<string, number>, ids: string[], now: number): Record<string, number>   // adds, drops > 2 days
```

In the scene, `setIncidents(list)`: if any `ring` is true, call `startIncident()` once (25 s, the fail bubbles, `sfx.play('siren')`); the banner shows while `list.length > 0`, text `Incident: <key> <title>` for the newest and ` · +N more`, and a click calls `options.onIncidents?.()`. `updateIncident(t)` pulses the light; under `reduceMotion` it holds `alarm.intensity` at 14. `life/incidents.js` keeps upstream's `startIncident`, `updateIncident` and `setup` without `headache()`, `fails` or the three-failures branch. `audio/sfx.js` keeps upstream's engine and `SOUNDS = { siren }`, `GAP = { siren: 4 }`. Add `incident.banner: 'Incident: {key} {title}'` and `incident.more: '+{n} more'` to the English strings. The client sends `setIncidents` on each change with `ring` from `toRing`, then saves `markRung(...)` to `office-device`.

- [ ] **Step 1: Write the failing tests**

```text
"toRing gives ids not yet rung"
"markRung adds the ids and drops entries over 2 days old"
"a second device with an empty rung map rings once; the first, reopened, rings none"   (Review Focus 5)
world-script: "the scene's bundle builds with the new modules"
```

- [ ] **Step 2: Run each, see it fail.**
- [ ] **Step 3: Implement the scene and client changes.** Update `SOURCES.md`: `life/incidents.js` and `audio/sfx.js` leave the stand-in list and are listed as trimmed copies, with what was cut.
- [ ] **Step 4: Run each, see it pass.**
- [ ] **Step 5: Look at it on a static page**, as the stand-up notes did: the surface with a stand-in host whose snapshot carries two open incidents. Check the red light, the banner and its click, no second ring after reopening, and the siren after one click on the scene. Note what could not be seen.
- [ ] **Step 6: Commit** — `git commit -m "feat(office): upstream's incident alarm and siren"`

---

### Task 8: Check it on a dev daemon, write the docs, mark it built

**Files:**

- Modify: `docs/plugins.md` (the office section: one paragraph on incidents, integrated after the stand-up notes), `docs/superpowers/specs/2026-11-17-office-incidents-design.md` (Status: built; a Verified and a Not verified section), `docs/superpowers/specs/2026-11-16-office-owner-review-design.md` (Status line)

- [ ] **Step 1: Start a dev daemon of the worktree on `127.0.0.1:6768`** with its own `PASEO_HOME` under `/tmp` and the `ATLASSIAN_*` variables passed through. Never touch 6767.
- [ ] **Step 2: Set "Jira projects" to a real project**, read only. Expected: one `incidents` schedule every 5 minutes; the first run opens nothing.
- [ ] **Step 3: Stop the dev daemon, set the saved `checkedAt` in its `office/incidents.json` back a week with `seen` emptied, start it again, and wait for the next run** (at most 5 minutes). Expected: up to 20 incidents, the strip entry, the card, and in 3D the alarm. Nothing is filed or changed in Jira.
- [ ] **Step 4: Dismiss one and all.** Expected: the counts answer and the state follows.
- [ ] **Step 5: Sentry** only if a `SENTRY_AUTH_TOKEN` is given for the test; otherwise list it under Not verified.
- [ ] **Step 6: Write the docs and the spec's Verified sections; set both Status lines.**
- [ ] **Step 7: Format and commit** — `git commit -m "docs(office): incidents are built"`

---

## Order and parallel work

Task 1 first: every other task uses its types. Then:

| Tasks      | Can run together | Needs  |
| ---------- | ---------------- | ------ |
| 2, 3, 6, 7 | Yes              | Task 1 |
| 4          | After 2 and 3    | 2, 3   |
| 5          | After 4          | 4      |
| 8          | Last             | all    |

Tasks 6 and 7 both edit `client/office-surface.tsx`. Run them in separate worktrees off the same commit, or one after the other; the merge is a few lines in the strip's cards and the world view's options.
