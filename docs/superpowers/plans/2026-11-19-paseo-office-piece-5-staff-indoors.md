# paseo-office piece 5: staff and daily life, indoors Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 13 staff and daily-life scenes that need no street play on the office floor, speak in the team chat, and are fed with the real data the host has.

**Architecture:** The import tool takes the scenes from my-office (`DENY` shrinks), four stand-ins are extended so the scenes that need the street still find their imports, and two scenes' network calls become host callbacks. The scene's chat lines leave as `(kind, vars)` through a host callback to a new RPC; the plugin's server turns a kind into words with the engine's own `tr` and says it through the chat engine it already runs. The server also keeps a small ledger (how long each team has existed, the lift's servicing) and reads each repository's first-commit date, and pushes all of it to the scene through new API methods.

**Tech Stack:** Plain JavaScript (vendored scene), TypeScript and React Native (plugin), `@getpaseo/plugin` 0.16.2 (`execCommand` from `@getpaseo/plugin/server`), Vitest, esbuild. Repo: `/workspace/QFlavours/paseo-office`.

**Spec:** `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-paseo-office-roadmap-design.md`, piece 5, "5. Staff and daily life, indoors". Version tag: v0.6.0 (piece 1 v0.2.0, 2 v0.3.0, 3 v0.4.0, 4 v0.5.0).

## What was read, and what it shows

All facts below were read on 2026-11-19 from my-office at `b68228871fe30cd2c759a2c919337a9a9d1f5644` (clone at `/tmp/ref-office/my-office`) and from the repo. The import tool was dry-run on a copy in `/tmp` (the repo was not touched); its real output is quoted.

1. **The 13 scenes** (the roadmap says 13 and names none): `people/comnha`, `duty`, `teatime`, `accountant`, `rounds`, `hr`, `farewell`, `interns`, `staff`, and `life/altar`, `lift-service`, `post`, `drill`. With them come `life/day-swaps` (a calendar helper that speaks) and `life/nap` (the midday nap). Not taken: `outings`, `comtrua`, `guard`, `nhau`, `photobooth`, `pickle` (the six street scenes, piece 8), `life/photostrips` (its only caller is `photobooth`), and `evswap`, `payday` (pulled only by `outings`).
2. **Dry run.** With those paths out of `DENY` and the stand-ins deleted, the tool says: `modules in start-up order: 83; files: 109`, `written: 20`, the kept-local list unchanged (`core/env.js`, `interact/first-person.js`, `interact/place-cards.js`, `life/tests.js`, `ui/photo.js`), a new English area `drawer` (6.9 KB, named by `drawer.unreachable` in `farewell.js`), and:
   ```
   stand-ins to write or extend:
     office/life/rain.js: wetSign
     office/people/guard.js: guardPost, marshal
     office/people/outings.js: called, resting, resume, mainExit, outside, street, walk
     office/ui/group-chat.js: chatPhoto
   ```
   With those four extended, `scripts/build-world.mjs` builds: the script is 1,233,051 characters (1,116,817 at v0.1.0, which includes piece 2's `sfx.js` here but none of pieces 4, 6, 7). The window's upper limit of 1,200,000 is passed; this piece sets it (Decision 9).
3. **The street scenes' hooks.** `outings.js` and `guard.js` stay stand-ins, so the loop's `updateOutings()` and `updateGuard()` stay no-ops. `comnha`, `duty` import `called, resting, resume` from `outings.js`: `resting(w)` and `called(w)` are pure tests of a person's state and `resume(w, item)` puts a person back at the desk (upstream's `outings.js` lines 43 to 46 and 90 to 99). They must be real in the stand-in, copied with a source note, or lunch and chores would pick nobody. `drill.js` calls `street()`; with `street()` returning null its code takes the "no city" branch (`D.S && D.ex` is false, the marshal is off, the practice fire is skipped: `drill.js` lines 231, 243, 275).
4. **Chat.** `chatLife(kind, vars)` in upstream's `ui/group-chat.js` is a `switch` that picks a sender, a words key under `chat.life.*`, and options (`key`, `pin`, `react`, `reacts`, `answer`), then posts to upstream's server. The port's `chatLife` is a no-op. The engine runs on the plugin's server (`server/chat-service.ts`, `createChatEngine`), whose `tr` is `shared/chat-words.ts` and has the `chat` area. `staffNameOf(key, tr)` names only `__director`, so `engine.say("hr", ...)` finds no `who()` and drops the line: the seven staff keys (`__reception`, `__hr`, `__cleaner`, `__guard`, `__courier`, `__accountant`) have no names. `wireOf` drops a photo's picture, so `chatPhoto` (the scene's screenshot) is not wanted; the stand-in keeps returning null.
5. **Network.** The bundle today has no `fetch(`. The taken `farewell.js` has two (`/api/tenure`, GET at setup in `load()` and POST in `post`) and `interns.js` one (POST `official`). `interns` and `farewell` post only while `state.isLocal`, which nothing in the port sets, but `farewell.js`'s `load()` runs at setup regardless. All three become host callbacks (Task 2).
6. **Brands.** `staff.js` paints the Shopee mark (a `SHOPEE` Path2D, line 28, drawn at line 307) and its strings (`people.staff.shipper`, `shipperHi`, `call`, `callDoor` in `en/people.js`) and `chat.life.parcel` name Shopee. The repo's rule is no real brand's logo or name. Piece 9 purges brand names from locale files; this piece removes the logo and overrides the lines its scenes show (Task 2, Task 3).
7. **Page needs.** The 13 scenes look up no element but `#stage` (exists, used by `farewell`'s flash) and, in `farewell.js`, the settings box `st-farewell` and `btn-look` / `pop-look` (absent: `if (!box ...) return`). They use no CSS class, no asset, no font file (canvas text names a font and falls back to `system-ui`) and no `process.env`. `?debug`-style query flags are inert in a `srcdoc` frame. They write `localStorage` keys `office-gone`, `office-back:*`, `office-duty*`, drill's keys: same origin as the app, as the rest of the scene.
8. **Data the scenes read.** `accountant`: `s.usage.cost` per session (summed by project) and `liveWindows()` (the stand-in's `host.limits()`, empty). `hr`: `s.git.born` (`YYYY-MM-DD`; birthday cake in the month of a project's first commit). `farewell`, `interns`: `setTenure({ days, choices, projects: [{ name, last, days, turns, due, farewell, back, intern, ready, official }] })` and the two writes `{op:'farewell'|'official', name}`. `lift-service`: `setLiftService({ left, total, newBuild, sticker: { version, at, build } | null })`, `left` in milliseconds still to go. Nothing in the 13 reads CI, a release tag, a battery or `/api/claude-version` (those serve `pickle`, `photobooth`, `photostrips`, `outings`, `evswap`: piece 8).
9. **The team is a workspace.** `worldPeople` seats `room.name` (the workspace's name) as the project: `dir: team`, `git: { repo: team }` (`client/world/adapter.ts` `toSession`). The ledger therefore keys on the workspace name.
10. **What the server can read.** `OfficeAgent` already has `costUsd` and `createdAt`. The directory input (`DirectoryWorkspaceInput`) has no folder; the daemon's workspace descriptor has `workspaceDirectory` and `projectRootPath` (`live-ports.ts` line 128 already reads them). `execCommand` is exported by `@getpaseo/plugin/server` and the plugin does not use it yet.
11. **The lively floor.** `paseo-leisure.js` is run by `life/nap.js`'s stand-in (`everyFrame(updateLeisure)`, set in `paseo-entry.js`). Upstream's `nap.js` has no such hook, and `core/loop.js` calls only the loop's own list. `ui/activity.js` stays a stand-in and its `updateMarkers(t)` is called by the loop every frame, before the first-person branch.

## Decisions

1. **The 13 scenes, `day-swaps` and `nap` are taken; the six street scenes and `photostrips` are not.** Reason: the first group needs no street; `photostrips` is dormant without `photobooth`. Cost if wrong: piece 8 takes `photostrips` too, one more `DENY` edit.
2. **`outings.js` and `guard.js` stay stand-ins and gain exactly what the tool lists.** `resting`, `called` and `resume` are copied from upstream's `outings.js` (lines 43, 46, 90 to 99) with a `// PASEO:` note; `street()` returns null; `mainExit` null; `outside` and `walk` do nothing / call back; `guardPost` null; `marshal` a switched-off object. Reason: real `resting`/`called` are what lunch and chores choose people by. Cost: piece 8 deletes both stand-ins and takes upstream's; if `resting` there differs, scenes follow upstream (right).
3. **`life/nap.js` is taken unchanged; the lively floor yields during its window and runs from `ui/activity.js`'s `updateMarkers`.** `ui/activity.js` gets `export function everyFrame(fn)` and `updateMarkers` calls it; the entry calls `everyFrame(updateLeisure)` from there; `paseo-leisure.js` adds `napOn` to `quiet`. Reason: the roadmap says the lively floor gives way where the two overlap, and the midday window (12:30 to 13:30) is the overlap; the sofa nap, fish, arcade, cup and restroom stay, since upstream has no such thing. Cost: the lively floor is silent for an hour a day; `ui/activity.js` carries a hook that is not about the UI.
4. **The scene sends chat lines as `(kind, vars)`, not text.** `host.life(kind, vars)` calls `onLife` and the server maps `kind` to sender, words and options in `shared/life-lines.ts`, a TypeScript copy of upstream's `chatLife` `switch` for the kinds used. Reason: the scene then ships no chat words, and the server (which knows who rests and the names) picks `restingOne()`; the text cannot be chosen by the scene. Cost: a table that must follow upstream's `switch` at each update (a test names the kinds).
5. **The seven staff are named on the server** by `staffNameOf` from a fixed English table (`Receptionist`, `HR`, `Cleaner`, `Security guard`, `Courier`, `Accountant`, `Director`), not from upstream's `people.*` strings. Reason: those strings are in the scene's bundle, not the server's, and the courier's is brand-named. Cost: a second place for seven words.
6. **Photos are not sent.** `chatPhoto` stays null. Reason: `wireOf` drops the picture anyway. Cost: none.
7. **The server keeps a tenure ledger in `office/tenure.json`** (new `tenureFile` in `server/paths.ts`) keyed by workspace name, with upstream's rules: a project is "active" after two days, a farewell is due after 30 quiet days (fixed; no setting, `choices: [30]`), an intern is a project new since the ledger began until 20 turns on two days, and every team present when the ledger first starts is permanent. Reason: the roadmap asks for "how long an agent has existed"; upstream's server logic is 100 lines and has no Claude-specific part once transcripts are dropped. Seed: on first start each present team gets `first` from its earliest agent's `createdAt` and `days` from the distinct calendar days among its agents' `createdAt` plus today. Cost: a team renamed or a worktree archived and recreated under another name starts again; a farewell can come for a branch workspace that was archived.
8. **A repository's first-commit date is read on the server by `git log --max-parents=0 --reverse --format=%as` in the workspace's folder**, cached per folder for the process, timeout 10 s, null on any failure. The folder comes through a server-only `folders` map on `DirectoryView` (workspace id to `workspaceDirectory ?? projectRootPath`), never on the wire. Reason: no other source. Cost: a `git` child process per new folder; none where `git` is absent.
9. **The bundle's size window becomes 1,000,000 to 1,400,000** in `server/world-script.test.ts`, with the measured size in the comment. Reason: this piece adds about 116,000, pieces 6 and 7 about 40,000 more; piece 8 revises it again per the roadmap. Cost: a looser alarm.
10. **CI results, release tags and `/api/claude-version` are not supplied in this piece.** Reason: only street scenes read them; building feeds nobody can see is waste. Cost: the roadmap's list for piece 5 is shorter; piece 8 adds them.
11. **`accountant` gets the cost; the plan's limits stay empty.** `usage.cost` is `agent.costUsd` (absent when the provider gives none: the scene then has no spending and the accountant's screen shows no rows). Reason: `host.limits()` has no feed in the plugin. Cost: the accountant's "plan limit nears" talk never starts.
12. **The lift servicing starts when the plugin's server starts.** Three minutes, five when the build differs from the last start's (the build is the first 7 characters of the sha-256 of `WORLD_SCRIPT`, kept in `office/lift.json`; the sticker's version is that same text). The server sends `left` in milliseconds, computed at send time, to every device that opens the scene. Reason: upstream's rule, with the scene's text as the build. Cost: a sticker that says "Office v1a2b3c4" rather than a release number; the string `life.liftService.stickerWhat` is overridden in `OURS` (it says "My Office").
13. **`state.isLocal = true` is set by the entry**, and the two guarded sends become `host.tenure(op)`. Reason: the guard exists so a phone does not post; here every page may tell the server, which ignores a repeat (`markFarewell`/`markOfficial` return false). Cost: two pages can both send; harmless.
14. **No setting for the farewell days, none for the scenes.** Reason: not asked. Cost: the owner cannot turn a scene off; a later piece can add a switch.

## Assumes from earlier pieces

Re-check each when this piece's turn comes.

- **Piece 2 (sounds, v0.3.0):** `audio/sfx.js` is upstream's, taken by the tool, `audio` is out of `DENY` and the stand-in is gone; the entry calls `sfx.set(false)` and no longer hand-calls `audioSfx.setup()` (the tool's `MODULES` list now holds `audioSfx`; in my dry run it did, and the entry's `lifeIncidents.setup(); audioSfx.setup();` line would run it twice, so piece 2 must have removed `audioSfx.setup()`). The scenes call `sfx.play` with 19-plus names that are now audible.
- **Piece 3 (floor plans):** `host.plan` is `'pro'` or `'cozy'`; `useWorldFeed` takes the plan from the setting. The cozy room has no lift, reception, HR desk or meeting room; upstream's scenes guard on `PRO`, so they stay out on the cozy room. If a scene misbehaves there, Task 6 finds out.
- **Piece 4 (camera extras):** `ui/camera-bar.js` is a stand-in and `ui/tips.js` is taken; neither is touched here. The bundle may already be near 1,140,000.
- **Piece 1 (session tabs):** `client/office-surface.tsx` and the column are untouched here. `WorldView` passes start options through `client/world/world-view.tsx` and `world-view-native.tsx` (the phone's script frame goes through `createWorldBridge`, which posts every function option as a named callback and non-function data as data, and turns the API's methods into `sender("...")`); piece 2 added `setSound`/`onSound` the same way and is the template here. If the bridge's list of names is a literal list, Task 4 adds ours in the same place.
- The files this plan edits keep their v0.1.0 names: `shared/contracts.ts` (`chatRpc`, `ChatRequestSchema`), `server/chat-service.ts` (`staffNameOf`, `createChatService`), `shared/chat-words.ts`, `server/hub.ts` (`watch`), `server/paseo-directory.ts`, `index.server.ts` (`server.handle(chatRpc, ...)`), `client/world/use-world-feed.ts`, `client/world/world-api.ts`, `shared/upstream/chat-engine.js` unchanged.
- `vendor/SOURCES.md` has the sections of v0.1.0 plus whatever pieces 2 and 4 added; this piece adds its own and edits "What is not taken" and the stand-in table.

## Global Constraints

- Branch `feat/staff-indoors` from `main` in `/workspace/QFlavours/paseo-office`. Public repo: nothing private (no host path, address or name) in files, fixtures or commit messages; no real brand's logo, name or tune; no attribution lines on commits; never push, never `gh`, never a bare `paseo` command; the controller publishes.
- my-office's MIT licence and notices stay; his files are taken unchanged wherever they can be; a change by hand starts with `// PASEO:` and is listed in `vendor/SOURCES.md` (this piece changes `farewell.js`, `interns.js`, `staff.js` by hand: three more files to compare at each update).
- The scene never receives a file name, a command or a prompt. From this piece it receives only: each person's `usage.cost` and `git.born`, the tenure list (workspace names, dates, counts), the lift's servicing. It sends only `(kind, vars)` for chat and the two tenure writes. The scene makes no network call: the bundle holds no `fetch(` and no `/api/` (a test says so).
- App-side code (`client/`, `shared/`) uses nothing a phone's engine lacks: `client/engine-compat.test.ts` stays green (no `toSorted`, `toReversed`, `findLast`, `Object.groupBy`, Set algebra, and so on). Server code (`server/`) may use them, as `chat-service.ts` does.
- Stock Paseo 0.16: only calls its SDK has. `execCommand` is in 0.16.2's `@getpaseo/plugin/server`.
- Styles of the plugin's own screens in `client/styles.ts`. This piece adds no screen.
- `npm run build:world` after any change under `vendor/`; commit `server/world.generated.ts` with it. Bundle window: Decision 9. No `process.env` in the bundle.
- A new setting field has a default and no version bump (not needed here: there is none).
- Never start, stop or restart the daemon on port 6767. A throwaway daemon uses `PASEO_HOME=/tmp/office-stock-home`, port 6798, `env -i`, the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`; piece 1's plan, Task "A look", has the exact steps.
- Checks after each task: `npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts`, the test files touched, and the whole suite (`npm test -- --maxWorkers=4 > /tmp/p5-tests.txt 2>&1`) before each commit.

---

### Task 1: Take the scenes

**Files:**

- Modify: `vendor/my-office/import-upstream.mjs` (`DENY`, its doc comment)
- Delete (stand-ins): `vendor/my-office/src/office/people/{comnha,duty,teatime,accountant,rounds,hr,farewell,interns,staff}.js`, `vendor/my-office/src/office/life/{altar,lift-service,drill,day-swaps,post,nap}.js`
- Written by the tool: those 15 files again (upstream's), `src/shared/comnha.js`, `src/i18n/locales/en/drawer.js`, `src/i18n/locales/en/index.js`, `paseo-modules.js`, `MANIFEST.json`
- Modify (hand): `vendor/my-office/src/office/{life/rain.js, people/guard.js, people/outings.js, ui/group-chat.js, ui/activity.js, paseo-entry.js, paseo-leisure.js}`
- Modify: `vendor/SOURCES.md`, `server/world-script.test.ts`, `client/world/entry.test.ts`, `client/world/leisure.test.ts` (only if it imports `called`; read first)
- Create: `client/world/stand-ins.test.ts`
- Built: `server/world.generated.ts`

**Interfaces:**

- Consumes: piece 2's taken `audio/sfx.js`.
- Produces: the scenes in the bundle; `ui/activity.js` exports `everyFrame(fn)`; `ui/group-chat.js` exports `chatLife(kind, vars)`, `chatSay`, `chatPhoto` (Task 3 fills `chatLife`); `people/outings.js` exports `street, resting, called, resume, mainExit, outside, walk, updateOutings`.

- [ ] **Step 1: Branch and the reference clone**

```bash
cd /workspace/QFlavours/paseo-office && git switch main && git switch -c feat/staff-indoors
ls /tmp/ref-office/my-office/src/office/life/nap.js || git clone https://github.com/khanh020905/my-office /tmp/ref-office/my-office
git -C /tmp/ref-office/my-office checkout b68228871fe30cd2c759a2c919337a9a9d1f5644
ls /tmp/ref-office/three/node_modules/three/package.json || npm install --prefix /tmp/ref-office/three three@0.160.0
```

- [ ] **Step 2: Write the failing stand-in test**

Create `client/world/stand-ins.test.ts`. It reads upstream's `resting`/`called` from the clone only when present, and always checks the stand-in's own contract.

```ts
// @vitest-environment jsdom
// The street's stand-ins (people/outings.js, people/guard.js): the scenes taken from my-office import
// `resting`, `called` and `resume` from them, and read the street as absent.
import { expect, test, vi } from "vitest";

vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  sessions: new Map([
    ["rest", { status: "rest", bg: [] }],
    ["busy", { status: "work", bg: [] }],
    ["bg", { status: "rest", bg: [{ desc: "x" }] }],
  ]),
}));
vi.mock("../../vendor/my-office/src/i18n/index.js", () => ({ t: (k: string) => k }));
vi.mock("../../vendor/my-office/src/office/ui/event-text.js", () => ({
  ANIM_AT: { desk: "type" },
  verb: () => "",
}));

// @ts-expect-error vendored JavaScript has no declarations
import * as outings from "../../vendor/my-office/src/office/people/outings.js";
// @ts-expect-error vendored JavaScript has no declarations
import * as guard from "../../vendor/my-office/src/office/people/guard.js";

const person = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  sub: false,
  root: { parent: {} },
  phase: "idle",
  anim: "sleep",
  station: "desk",
  ...extra,
});

test("there is no street", () => {
  expect(outings.street()).toBeNull();
  expect(outings.mainExit({})).toBeNull();
  const done = vi.fn();
  outings.walk({}, null, [], done);
  expect(done).toHaveBeenCalledTimes(1);
  expect(guard.guardPost({})).toBeNull();
  expect(guard.marshal.on).toBe(false);
  expect(() => guard.marshal.say("x")).not.toThrow();
  expect(() => outings.updateOutings()).not.toThrow();
  expect(() => guard.updateGuard()).not.toThrow();
});

test("resting is someone asleep at their own desk with nothing running", () => {
  expect(outings.resting(person("rest"))).toBe(true);
  expect(outings.resting(person("busy"))).toBe(false);
  expect(outings.resting(person("bg"))).toBe(false);
  expect(outings.resting(person("rest", { anim: "type" }))).toBe(false);
  expect(outings.resting(person("rest", { chore: {} }))).toBe(false);
  expect(outings.resting(person("rest", { sub: true }))).toBe(false);
});

test("called is work that came in", () => {
  expect(outings.called(person("rest"))).toBe(false);
  expect(outings.called(person("busy"))).toBe(true);
  expect(outings.called(person("bg"))).toBe(true);
  expect(outings.called(person("rest", { want: true }))).toBe(true);
  expect(outings.called(person("nobody"))).toBe(true);
});

test("resume puts someone back to rest at the desk", () => {
  const w = { ...person("rest"), say: vi.fn(), hush: vi.fn(), P: { held: {} } };
  outings.resume(w, false);
  expect(w.station).toBe("desk");
  expect(w.anim).toBe("sleep");
  expect(w.hush).toHaveBeenCalled();
  const busy = { ...person("busy"), say: vi.fn(), hush: vi.fn(), P: { held: {} } };
  outings.resume(busy, false);
  expect(busy.anim).toBe("type");
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `npx vitest run client/world/stand-ins.test.ts`. Expected: FAIL, `outings.street is not a function` (the stand-in is two lines).

- [ ] **Step 4: Edit the tool's `DENY`**

In `vendor/my-office/import-upstream.mjs`:

- `/^office\/people\/(outings|comnha|comtrua|duty|teatime|accountant|rounds|guard|hr|farewell|interns|nhau|photobooth|pickle|staff)\.js$/` becomes `/^office\/people\/(outings|comtrua|guard|nhau|photobooth|pickle)\.js$/`.
- `/^office\/life\/(seasons|rain|weather|altar|lift-service|drill|day-swaps|photostrips|post|incidents|nap)\.js$/` becomes `/^office\/life\/(seasons|rain|weather|photostrips|incidents)\.js$/`. (If piece 2 or 7 already changed this line, remove only `altar|lift-service|drill|day-swaps|post|nap|`.)
- The comment above `DENY` ("and the daily-life scenes") becomes "the street and the six scenes that happen on it, the weather and the seasons".

- [ ] **Step 5: Delete the 15 stand-ins and take the files**

```bash
cd /workspace/QFlavours/paseo-office/vendor/my-office/src/office
git rm people/{comnha,duty,teatime,accountant,rounds,hr,farewell,interns,staff}.js life/{altar,lift-service,drill,day-swaps,post,nap}.js
cd ../../ && node import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check
```

Expected: `written: 17` or near (15 scenes, `shared/comnha.js`, `i18n/locales/en/drawer.js`, plus index and modules and manifest are counted among them; the exact count is what the tool prints), the kept-local list of five unchanged, and exactly the four stand-in lines quoted above. If it names another stand-in export, extend that stand-in too and note it. Then run without `--check`. `git status` must show only the files listed under Files.

- [ ] **Step 6: Extend the four stand-ins**

`life/rain.js` becomes:

```js
// PASEO: stand-in for my-office's life/rain.js, which Paseo does not take yet. wetSign is the yellow
// "wet floor" sign people/staff.js stands in the lobby when it rains: with no rain it never shows.
import * as THREE from "../../../three/three.module.min.js";
export function updateSeason() {}
export function wetSign() {
  return new THREE.Group();
}
```

`people/guard.js`:

```js
// PASEO: stand-in for my-office's people/guard.js, which Paseo does not take: the guard stands at the street door.
// life/drill.js asks for the guard's post and the marshal; with no street neither is on.
export function updateGuard() {}
export function guardPost() {
  return null;
}
export const marshal = {
  on: false,
  at: null,
  look: null,
  act: "walk",
  yaw: 0,
  say() {},
  hold() {},
};
```

`people/outings.js` (keep the existing header comment line; `sessions` comes from `./workers.js`, `ANIM_AT`, `verb` from `../ui/event-text.js`, `t as tr` from `../../i18n/index.js`, `state` from `../core/state.js`, `rand` from `../core/env.js`):

```js
// PASEO: stand-in for my-office's people/outings.js, which Paseo does not take: its trips go down to the street.
// The scenes taken from my-office ask it who is free to go (resting), who has work (called) and to put someone
// back at the desk (resume): those three are upstream's own (outings.js, at the vendored commit). There is no
// street: street() is null, so a scene that has a street half (life/drill.js) plays its office half.
import { state } from "../core/state.js";
import { rand } from "../core/env.js";
import { sessions } from "./workers.js";
import { ANIM_AT, verb } from "../ui/event-text.js";
import { t as tr } from "../../i18n/index.js";

export function updateOutings() {}
export const street = () => null;
export const mainExit = () => null;
export function outside() {}
export function walk(w, S, pts, cb) {
  cb();
}
export const resting = (w) =>
  !w.sub &&
  w.root.parent &&
  !w.leaving &&
  !w.away &&
  !w.homeBound &&
  !w.chore &&
  !w.after &&
  !w.want &&
  w.phase !== "walk" &&
  !w.liftHold &&
  !w.liftWait &&
  !w.inStall &&
  !w.wcBusy &&
  !w.queued &&
  w.anim === "sleep" &&
  w.station === "desk" &&
  sessions.get(w.id)?.status === "rest" &&
  !sessions.get(w.id)?.bg?.length;
export const called = (w) => {
  const s = sessions.get(w.id);
  return !!w.want || !s || s.status !== "rest" || !!s.bg?.length;
};
export function resume(w, item) {
  const s = sessions.get(w.id);
  w.station = "desk";
  if (s?.status === "wait") {
    w.anim = "hand";
    w.say("wait", tr("people.needsApproval"), "wait");
  } else if (s?.bg?.length) {
    w.anim = "think";
    w.say("bash", tr("people.bgWait", { desc: s.bg[0].desc }));
  } else if (s?.status === "work") {
    w.anim = ANIM_AT.desk;
    if (s.last) w.say(s.last.type, s.last.label || verb(s.last));
  } else if (item && w.P.held[item]) {
    w.anim = "coffee";
    w.restAt = state.sim + (item === "cup" ? rand(25, 45) : rand(40, 75));
    w.dwellUntil = state.sim + 2;
  } else if (item) {
    w.carry = null;
    w.anim = "tidy";
    w.restAt = state.sim + 3;
    w.dwellUntil = state.sim + 2;
  } else {
    w.anim = "sleep";
    w.hush();
  }
}
```

The test mocks `core/state.js` indirectly (jsdom; `state` is a plain object module and `core/env.js` imports `three` and the page: if importing it fails under jsdom, add `vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({ rand: (a: number) => a }))` and `vi.mock("../../vendor/my-office/src/office/core/state.js", () => ({ state: { sim: 0 } }))` to the test).

`ui/group-chat.js` becomes (Task 3 replaces the first two bodies):

```js
// PASEO: stand-in for my-office's ui/group-chat.js (its chat window), which Paseo does not take.
export function chatLife() {}
export function chatSay() {}
// (the chat does not keep a picture: the server drops a photo's data)
export function chatPhoto() {
  return null;
}
```

- [ ] **Step 7: The lively floor's hook, and the nap**

`ui/activity.js`: after `export function renderHud() {}` add

```js
// PASEO: the lively floor (paseo-leisure.js) runs from here, once a frame: upstream's life/nap.js, which it ran from
// before, is upstream's own now and has no such hook. paseo-entry.js sets it.
let frame = null;
export function everyFrame(fn) {
  frame = fn;
}
```

and as the first line of `updateMarkers(t)`'s body: `frame?.();`.

`paseo-entry.js`: replace `import { everyFrame } from './life/nap.js';` by `import { everyFrame } from './ui/activity.js';`; add `state.isLocal = true;` after the `state.world = true;` line (comment: `// (the taken scenes tell the host's server only from a page that may; here every page may)`). `paseo-leisure.js`: add `import { napOn } from './life/nap.js';` and change `quiet: reduceMotion || !!gatheringNow()` to `quiet: reduceMotion || !!gatheringNow() || napOn`; rewrite the header sentence "The stand-in of life/nap.js calls updateLeisure every frame" to "ui/activity.js calls updateLeisure every frame". Update `client/world/entry.test.ts`: its mock of `ui/activity.js` (if any) gains `everyFrame() {}`; if the test did not mock `life/nap.js`, mock it: `vi.mock(".../life/nap.js", () => ({ napOn: false }))`, and mock the 15 taken modules only if the entry imports them (it does not; `paseo-modules.js` is mocked to one probe).

- [ ] **Step 8: Build and see the world tests**

Run `npm run build:world`. Expected: `wrote server/world.generated.ts (... characters)` with the script near 1,233,000 (plus piece 2's and 4's additions: the real number is what the build prints). In `server/world-script.test.ts` change `expect(script.length).toBeLessThan(1_200_000);` to `toBeLessThan(1_400_000)` with the comment `// 1,4xx,xxx measured on <date>: the staff scenes of piece 5 added about 116,000; pieces 6 to 8 add more`, and in the "bundles upstream's first-person walk" test leave as is. Add one test to the same file:

```ts
it("bundles the staff scenes, with no network call and no real brand's mark", () => {
  for (const line of [
    "people.hr.",
    "people.accountant.",
    "people.duty.",
    "life.liftService.",
    "life.drill.",
    "life.altar.",
  ]) {
    expect(WORLD_SCRIPT).toContain(line);
  }
  expect(WORLD_SCRIPT).not.toContain("fetch(");
  expect(WORLD_SCRIPT).not.toContain("/api/");
});
```

It fails here on `fetch(` and `/api/` (Task 2 removes them). Run `npx vitest run server/world-script.test.ts client/world`. Expected: the new test FAILS on `fetch(` only; everything else passes, including `stand-ins.test.ts` now.

- [ ] **Step 9: SOURCES.md**

In `vendor/SOURCES.md`: in "What is taken" add a paragraph "The staff and daily-life scenes" naming the 13 scenes, `day-swaps` and `nap`, saying they are copied unchanged except three (listed in Task 2); in "What is not taken" delete "the daily-life scenes (lunch runs, the midday nap, ...)" for those and keep "the street outside, its shops, the six scenes that happen on it, the seasons and the weather"; in the stand-in table replace the `life/nap.js` row by rows for `people/outings.js` ("`resting`, `called`, `resume` are upstream's; no street"), `people/guard.js`, `life/rain.js` and `ui/group-chat.js` (updated in Task 3), and say the lively floor now runs from `ui/activity.js` and is quiet during the midday nap. Keep the sentence that the five kept files carry a note, and update the count of hand-changed copied files after Task 2.

- [ ] **Step 10: Run the chain and commit**

Run the checks (the new world test still fails until Task 2: commit with `it.skip` removed only in Task 2; instead mark the new test `it.todo`-free by committing Task 1 and 2 together is not allowed, so for this commit change the two `not.toContain` lines to `// Task 2` comments and restore them in Task 2 Step 6). Commit: `feat: take the staff and daily-life scenes that need no street`.

---

### Task 2: No network call, no real brand

**Files:**

- Modify (hand, each starting `// PASEO:`): `vendor/my-office/src/office/people/farewell.js`, `people/interns.js`, `people/staff.js`
- Modify: `vendor/my-office/src/office/paseo-host.js`, `paseo-entry.js`, `vendor/my-office/src/i18n/index.js` (`OURS`), `vendor/SOURCES.md`, `server/world-script.test.ts`
- Create: `client/world/staff-hand-changes.test.ts`
- Built: `server/world.generated.ts`

**Interfaces:**

- Consumes: Task 1's taken files.
- Produces: `host.tenure(op)` (`{op:'farewell'|'official', name:string}`) in `paseo-host.js`, default no-op; `onTenure(op)` start option (Task 4 wires it); `PaseoOfficeWorld.setTenure(data)` and `setLiftService(info)` (Task 4 adds them to the entry); a Shopee-free `staff.js`.

- [ ] **Step 1: Write the failing test**

`client/world/staff-hand-changes.test.ts` reads the three files as text:

```ts
import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const read = (rel: string) =>
  readFileSync(new URL(`../../vendor/my-office/src/office/${rel}`, import.meta.url), "utf8");

test("farewell.js and interns.js tell the host, not a server", () => {
  for (const file of ["people/farewell.js", "people/interns.js"]) {
    const text = read(file);
    expect(text, file).toContain("PASEO:");
    expect(text, file).not.toContain("fetch(");
    expect(text, file).not.toContain("/api/");
    expect(text, file).toContain("host.tenure(");
  }
});

test("the courier carries no real brand's mark", () => {
  const text = read("people/staff.js");
  expect(text).toContain("PASEO:");
  expect(text).not.toContain("SHOPEE");
  expect(text).not.toMatch(/Shopee/i);
});

test("the lift's sticker does not say the name of the scene's source", () => {
  const ours = readFileSync(
    new URL("../../vendor/my-office/src/i18n/index.js", import.meta.url),
    "utf8",
  );
  expect(ours).toContain("'life.liftService.stickerWhat'");
  for (const key of [
    "people.staff.shipper",
    "people.staff.shipperHi",
    "people.staff.call",
    "people.staff.callDoor",
  ]) {
    expect(ours).toContain(`'${key}'`);
  }
});
```

- [ ] **Step 2: Run it and see it fail**

`npx vitest run client/world/staff-hand-changes.test.ts`. Expected: FAIL (`fetch(` found, `SHOPEE` found, keys missing).

- [ ] **Step 3: `farewell.js`**

Add `import { host } from '../paseo-host.js';` after its last import. Then, by the text:

- The two lines
  ```js
  const tq = () => (TOKEN ? `?k=${encodeURIComponent(TOKEN)}` : '');
  const post = (body) => fetch(`/api/tenure${tq()}`, { method: 'POST', ...
  ```
  become
  ```js
  // PASEO: upstream posts to its own server; the host is told instead, and answers with setTenure().
  const post = (body) => {
    host.tenure(body);
    return Promise.resolve(null);
  };
  ```
- `async function load() { if (DEMO) return; const r = await fetch(...)...; if (r?.ok) setTenure(r); }` becomes `// PASEO: the host pushes the list with setTenure(); nothing is fetched.` and `function load() {}`.
- Remove `TOKEN` from the `import { TOKEN, areaOf, projOf, teamTags } from '../net/live.js';` line (now unused).

- [ ] **Step 4: `interns.js`**

Add the `host` import. Replace the whole `if (!DEMO && state.isLocal) fetch(...)...;   // (unread, an answer stays in memory)` statement with
`if (!DEMO && state.isLocal) host.tenure({ op: 'official', name: project });   // PASEO: the host is told, not a server`. Remove `TOKEN` from `import { TOKEN, projOf } from '../net/live.js';`.

- [ ] **Step 5: `staff.js`**

Delete the two lines `// the Shopee mark: Simple Icons ...` and `const SHOPEE = '...'` (line 27 and 28). The drawing at the label (line 307, `g.fillStyle = '#FFFFFF'; g.fill(new Path2D(SHOPEE));`) becomes a plain parcel mark drawn with two rectangles: replace `g.fill(new Path2D(SHOPEE))` by `g.fillRect(-9, -7, 18, 14); g.clearRect(-1.5, -7, 3, 14)` (the translate and scale around it stay, so it draws a box with a strip down it). Add above it `// PASEO: the courier's carton carries a plain box mark, not a company's.` Change the file's header sentence "a Shopee courier" to "a courier" (comment only; it carries `PASEO:`). Also change the parcel's tape comment "orange Shopee tape" to "orange tape".

- [ ] **Step 6: Words and the host seam**

`vendor/my-office/src/i18n/index.js` `OURS` gains (after the leisure lines):

```js
  // the courier is any courier (people/staff.js; upstream names a shop)
  'people.staff.shipper': 'Courier',
  'people.staff.shipperHi': ['Delivery!', 'A parcel, I will leave it at the desk!'],
  'people.staff.call': ['{name}, a parcel for you!', '{name}, your parcel is here!'],
  'people.staff.callDoor': ['{name}, parcel!', 'Delivery! {name}?'],
  // the lift's sticker (life/lift-service.js): the build is the office plugin's, not upstream's
  'life.liftService.stickerWhat': 'Office {version}',
```

`paseo-host.js` gains, after `toast() {},`:

```js
  /** The scene tells the host a tenure write: { op: 'farewell' | 'official', name }. */
  tenure() {},
  /** The scene says a line in the team chat: (kind, vars), as upstream's chatLife is called. */
  life() {},
```

`paseo-entry.js` `start()`: after `host.photo = ...` add
`host.tenure = typeof options.onTenure === 'function' ? (op) => options.onTenure({ op: op.op === 'official' ? 'official' : 'farewell', name: String(op.name ?? '').slice(0, 200) }) : () => {};` and
`host.life = typeof options.onLife === 'function' ? (kind, vars) => options.onLife(kind, vars) : () => {};`.
`paseo-entry.js` `api` gains two methods, after `setLimits`:

```js
  /** The tenure list: { days, choices, projects: [{ name, last, days, turns, due, farewell, back, intern, ready, official }] }. */
  setTenure(data) { if (!started || stopped || !data) return; setTenure(data); },
  /** The lift's servicing after the office's server started: { left (ms still to go), total, newBuild, sticker: { version, at, build } | null }. */
  setLiftService(info) { if (!started || stopped || !info) return; setLiftService(info); },
```

with imports `import { setTenure } from './people/farewell.js';` and `import { setLiftService } from './life/lift-service.js';`. (The entry test mocks both: add `vi.mock(".../people/farewell.js", () => ({ setTenure: h.setTenure }))` and the same for `lift-service.js`, with `vi.fn()` in `h`, and one test that `api.setTenure({days:30,projects:[]})` and `api.setLiftService({left:1})` pass through after `start`, and are ignored before it.)

- [ ] **Step 7: Build, run, restore the Task 1 assertions**

Restore the `fetch(` and `/api/` assertions in the world test. `npm run build:world`, then `npx vitest run client/world server/world-script.test.ts`. Expected: all PASS.

- [ ] **Step 8: SOURCES.md and commit**

`vendor/SOURCES.md`: the list "Five copied files are changed by hand" becomes eight, adding `people/farewell.js` (the tenure list and its two writes go through `host` instead of `fetch`), `people/interns.js` (the same), `people/staff.js` (the courier's carton has a plain box mark; Simple Icons' mark removed). Under the stand-in lines say `i18n/index.js`'s `OURS` also words the courier and the lift's sticker. Run the chain. Commit: `feat: the staff scenes make no network call and carry no company's mark`.

---

### Task 3: The scenes speak in the team chat

**Files:**

- Create: `shared/life-lines.ts`, `shared/life-lines.test.ts`
- Modify: `shared/contracts.ts` (`ChatRequestSchema`: one new op), `server/chat-service.ts` (`staffNameOf`, `request`, new `life`), `shared/chat-words.ts` (overrides), `server/chat-service.test.ts`, `shared/chat-words.test.ts`, `vendor/my-office/src/office/ui/group-chat.js`, `client/world/world-api.ts`, `client/world/world-bridge.ts` (callback name), `client/world/world-view.tsx`, `client/world/world-view-native.tsx`, `client/world/use-world-feed.ts` (pass `onLife`), `vendor/SOURCES.md`

**Interfaces:**

- Consumes: `host.life(kind, vars)` (Task 2), `createChatEngine`'s `say(from, text, options)`.
- Produces: `lifeLine(kind, vars, ctx): LifeLine | null` in `shared/life-lines.ts`, with

  ```ts
  export interface LifeLine {
    from: string;
    key: string;
    vars: Record<string, string>;
    options: {
      key: string;
      pin?: boolean;
      react?: string[];
      reacts?: number;
      answer?: { key: string; chance?: number }[];
    };
    extra?: { from: string; key: string; delay: number; keyed: string }[];
  }
  export const LIFE_KINDS: readonly string[];
  export interface LifeContext {
    resting(): string[];
    name(id: string): string | null;
    now: number;
  }
  ```

  and a chat request `{ op: "life", kind: string (max 40), vars: record of strings (each max 200, at most 8), every?: number }` answered `{ ok: true }`; `onLife(kind: string, vars: Record<string,string>): void` as a `WorldStartOptions` member.

- [ ] **Step 1: The kinds**

The kinds to support are those the taken files call: `tea`, `birthday`, `dutyRoster`, `dutyGrumble`, `farewell`, `farewellPhoto`, `back`, `liftDone`, `stairs`, `micro`, `microSmell`, `microPop`, `makeup`, `breakEve`, `drillNotice`, `drillDone`, `altar`, `parcel`, `official`, `standup`, `nap`, `wake`, `trophy`, `bye` (the last five are called by modules already in the scene). Their rows are upstream's `chatLife` `switch` (read at `ui/group-chat.js` lines 117 to 177 of the clone). The `answer` keys are under `chat.reply.*` (`hpbd`, `meeting`, `dutyRoster`, `farewellAsk`, `backAsk`, `stairsAsk`, `microAsk`, `smellAsk`, `popAsk`, `makeup`, `breakEve`, `drillNotice`, `drillDone`, `officialAsk`, `deploy`, `bye`, `milkTea`), all in the vendored `shared/upstream/chat.js`.

- [ ] **Step 2: Write the failing tests**

`shared/life-lines.test.ts`:

```ts
import { expect, test } from "vitest";
import chat from "./upstream/chat.js";
import { LIFE_KINDS, lifeLine, type LifeContext } from "./life-lines.js";

const ctx: LifeContext = {
  resting: () => ["a1"],
  name: (id) => (id === "a1" ? "Ann" : null),
  now: 1_000_000,
};

test("every kind the scenes call has a line, a sender and words that exist", () => {
  expect([...LIFE_KINDS].sort()).toEqual(
    ["altar", "answer-free-placeholder"].length && [
      "altar",
      "back",
      "birthday",
      "breakEve",
      "bye",
      "drillDone",
      "drillNotice",
      "dutyGrumble",
      "dutyRoster",
      "farewell",
      "farewellPhoto",
      "liftDone",
      "makeup",
      "micro",
      "microPop",
      "microSmell",
      "nap",
      "official",
      "parcel",
      "standup",
      "stairs",
      "tea",
      "trophy",
      "wake",
    ],
  );
  const life = chat.life as Record<string, unknown>;
  for (const kind of LIFE_KINDS) {
    const line = lifeLine(
      kind,
      {
        id: "a1",
        name: "Ann",
        names: "Ann",
        chore: "cups",
        list: "x",
        q: "1",
        n: "3",
        time: "1:02",
        off: "1/5",
        makeup: "",
      },
      ctx,
    );
    expect(line, kind).not.toBeNull();
    if (line === null) continue;
    expect(typeof line.from).toBe("string");
    const key = line.key.replace(/^chat\.life\./, "");
    expect(
      life[key] ?? (chat.work as Record<string, unknown>)[key.replace(/^work\./, "")],
      kind,
    ).toBeDefined();
  }
});

test("the staff speak for themselves and a person speaks as themselves", () => {
  expect(lifeLine("altar", {}, ctx)?.from).toBe("reception");
  expect(lifeLine("drillNotice", { q: "2" }, ctx)).toMatchObject({
    from: "hr",
    options: { pin: true },
  });
  expect(lifeLine("stairs", { id: "a1" }, ctx)?.from).toBe("a1");
  expect(lifeLine("parcel", { id: "a1" }, ctx)).toMatchObject({
    from: "reception",
    vars: { name: "Ann" },
  });
});

test("a kind that needs a person and has none says nothing", () => {
  expect(lifeLine("stairs", {}, ctx)).toBeNull();
  expect(lifeLine("microSmell", {}, { ...ctx, resting: () => [] })).toBeNull();
});

test("someone at rest speaks when the scene names nobody", () => {
  expect(lifeLine("nap", {}, ctx)?.from).toBe("a1");
});

test("a kind no table has is refused", () => {
  expect(lifeLine("tgdd", {}, ctx)).toBeNull();
  expect(lifeLine("__proto__", {}, ctx)).toBeNull();
});

test("the key a line is said once under changes with the period", () => {
  const a = lifeLine("altar", { every: "1200000" }, { ...ctx, now: 0 });
  const b = lifeLine("altar", { every: "1200000" }, { ...ctx, now: 1_300_000 });
  expect(a?.options.key).not.toBe(b?.options.key);
});
```

Replace the silly `["altar","answer-free-placeholder"].length && [...]` in the first test by the plain sorted list (it was written to show the list; use `expect([...LIFE_KINDS].sort()).toEqual([ ...24 names... ])`). Also add to `shared/chat-words.test.ts`:

```ts
test("the parcel line names no company", () => {
  for (let i = 0; i < 20; i += 1)
    expect(chatT("chat.life.parcel", { name: "Ann" })).not.toMatch(/shopee/i);
});
```

and to `server/chat-service.test.ts` (use the file's own helper that builds a service with fakes; read its first 80 lines and follow it) three tests: `life` says a staff line with the staff's name (`engine.state.msgs` gets a message from `__hr` with name "HR"); a kind unknown to the table returns `{ ok: false, error: "There is no such line." }`; the same kind and period said twice makes one message (the engine's `key`).

- [ ] **Step 3: Run and see them fail**

`npx vitest run shared/life-lines.test.ts shared/chat-words.test.ts server/chat-service.test.ts`. Expected: FAIL (module missing; parcel line names Shopee in one of its two lines).

- [ ] **Step 4: `shared/life-lines.ts`**

```ts
// The office's life in the team chat: what upstream's chatLife (ui/group-chat.js) says for each kind of
// moment, as a table the server reads. The scene sends a kind and a few words; this gives the sender,
// the words' key under chat.life.* and the options the engine's say() takes. Nothing here is text the
// scene wrote.
export interface LifeContext {
  /** The people at rest now, by id. */
  resting(): string[];
  /** A person's name in the chat; null when unknown. */
  name(id: string): string | null;
  now: number;
}

export interface LifeLine {
  from: string;
  key: string;
  vars: Record<string, string>;
  options: {
    key: string;
    pin?: boolean;
    react?: string[];
    reacts?: number;
    answer?: { key: string; chance?: number }[];
  };
  /** A second line, said after a delay by another sender (upstream's "got it" and "sorry"). */
  extra?: { from: string; key: string; delay: number };
}

type Vars = Readonly<Record<string, string>>;
interface Row {
  from: "hr" | "reception" | "person" | "anyone";
  key: string | ((vars: Vars) => string);
  react?: string[];
  reacts?: number;
  pin?: boolean;
  answer?: { key: string | ((vars: Vars) => string); chance?: number }[];
  /** The words' key lives under this prefix (default chat.life.). */
  prefix?: string;
  extra?: { from: "person" | "who"; key: string; delay: number };
  needs?: "id";
}

const ask = (key: string, ...chances: number[]) => chances.map((chance) => ({ key, chance }));

const ROWS: Readonly<Record<string, Row>> = {
  standup: {
    from: "hr",
    key: "standup",
    pin: true,
    react: ["👍"],
    reacts: 3,
    answer: [{ key: "meeting", chance: 0.7 }],
  },
  nap: { from: "anyone", key: "nap", react: ["😆", "❤️"], reacts: 2 },
  wake: { from: "anyone", key: "wake", react: ["😭", "😆"], reacts: 2 },
  parcel: {
    from: "reception",
    key: "parcel",
    extra: { from: "person", key: "chat.reply.parcelGot", delay: 4500 },
  },
  tea: {
    from: "anyone",
    key: "tea",
    react: ["❤️", "😆", "😮"],
    reacts: 4,
    answer: [{ key: "milkTea", chance: 0.6 }],
  },
  birthday: {
    from: "hr",
    key: "birthday",
    react: ["❤️", "😆"],
    reacts: 5,
    answer: [{ key: "hpbd" }, { key: "hpbd", chance: 0.8 }, { key: "hpbd", chance: 0.5 }],
  },
  stairs: {
    from: "person",
    needs: "id",
    key: "stairs",
    react: ["😭", "😆"],
    reacts: 3,
    answer: ask("stairsAsk", 0.9, 0.5),
  },
  liftDone: { from: "reception", key: "liftDone", react: ["👍", "❤️"], reacts: 3 },
  altar: { from: "reception", key: "altar", react: ["❤️"], reacts: 3 },
  trophy: {
    from: "hr",
    key: "trophy",
    react: ["❤️", "😮"],
    reacts: 5,
    answer: [{ key: "deploy", chance: 0.7 }],
  },
  bye: {
    from: "person",
    needs: "id",
    key: "chat.work.bye",
    prefix: "",
    answer: [{ key: "bye", chance: 0.6 }],
  },
  official: {
    from: "hr",
    key: "official",
    react: ["🎉", "❤️", "👍", "😆"],
    reacts: 7,
    answer: ask("officialAsk", 0.95, 0.8, 0.5),
  },
  farewell: {
    from: "hr",
    key: "farewell",
    pin: true,
    react: ["😭", "❤️"],
    reacts: 4,
    answer: ask("farewellAsk", 0.9, 0.6),
  },
  farewellPhoto: {
    from: "hr",
    key: "farewellPhoto",
    react: ["❤️", "😭", "😆"],
    reacts: 6,
    answer: ask("farewellAsk", 0.9, 0.7, 0.4),
  },
  back: {
    from: "anyone",
    key: "back",
    react: ["😆", "❤️", "😮"],
    reacts: 5,
    answer: ask("backAsk", 0.95, 0.6),
  },
  micro: {
    from: "anyone",
    key: (v) => (v.monday === "true" ? "microMon" : "micro"),
    react: ["😆", "😭"],
    reacts: 3,
    answer: ask("microAsk", 0.8, 0.4),
  },
  microSmell: {
    from: "anyone",
    key: "microSmell",
    react: ["😭", "😆", "😷"],
    reacts: 4,
    answer: ask("smellAsk", 0.95, 0.6),
  },
  microPop: {
    from: "anyone",
    key: "microPop",
    react: ["😆", "😮"],
    reacts: 3,
    answer: ask("popAsk", 0.9),
  },
  makeup: {
    from: "anyone",
    key: "makeup",
    react: ["😩", "😆", "😭"],
    reacts: 4,
    answer: ask("makeup", 0.95, 0.6),
  },
  breakEve: {
    from: "anyone",
    key: (v) => (v.makeup ? "breakEveMakeup" : "breakEve"),
    react: ["🥳", "❤️", "😆"],
    reacts: 5,
    answer: ask("breakEve", 0.95, 0.7),
  },
  drillNotice: {
    from: "hr",
    key: "drillNotice",
    pin: true,
    react: ["👍", "🧯", "😭"],
    reacts: 4,
    answer: ask("drillNotice", 0.9, 0.6),
  },
  drillDone: {
    from: "hr",
    key: "drillDone",
    react: ["👏", "❤️", "😆"],
    reacts: 5,
    answer: ask("drillDone", 0.9, 0.6),
  },
  dutyRoster: {
    from: "hr",
    key: "dutyRoster",
    react: ["👍", "🙏"],
    reacts: 3,
    answer: [{ key: "dutyRoster", chance: 0.6 }],
  },
  dutyGrumble: {
    from: "anyone",
    key: (v) => `duty_${v.chore}`,
    react: ["😤", "😆", "😭"],
    reacts: 3,
    extra: { from: "who", key: "chat.reply.dutySorry", delay: 5000 },
  },
};

export const LIFE_KINDS: readonly string[] = Object.keys(ROWS);

const SENDERS = { hr: "hr", reception: "reception" } as const;

/** The line a kind of moment says, or null when it has no table, no one to say it, or the words do not exist. */
export function lifeLine(kind: string, vars: Vars, ctx: LifeContext): LifeLine | null {
  if (!Object.hasOwn(ROWS, kind)) return null;
  const row = ROWS[kind];
  if (row === undefined) return null;
  const id = vars.id ?? "";
  const name = vars.name ?? (id ? (ctx.name(id) ?? "") : "");
  let from: string;
  if (row.from === "hr" || row.from === "reception") from = SENDERS[row.from];
  else if (row.from === "person") {
    if (id === "" || ctx.name(id) === null) return null;
    from = id;
  } else {
    const named = id !== "" && ctx.name(id) !== null ? id : null;
    const pool = ctx.resting();
    from =
      named ??
      pool[Math.floor(Math.random() * pool.length)] ??
      (kind === "microSmell" || kind === "microPop" ? "" : "reception");
    if (from === "") return null;
  }
  const every = Number(vars.every) > 0 ? Number(vars.every) : 20 * 60_000;
  const period = Math.floor(ctx.now / every);
  const words = typeof row.key === "function" ? row.key(vars) : row.key;
  const key = row.prefix === undefined ? `chat.life.${words}` : words;
  const filled: Record<string, string> = { ...vars, name };
  const options: LifeLine["options"] = { key: `life:${kind}:${id}:${period}` };
  if (row.pin) options.pin = true;
  if (row.react) options.react = row.react;
  if (row.reacts) options.reacts = row.reacts;
  if (row.answer) {
    options.answer = row.answer.map((a) => ({
      key: typeof a.key === "function" ? a.key(vars) : a.key,
      ...(a.chance === undefined ? {} : { chance: a.chance }),
    }));
  }
  const line: LifeLine = { from, key, vars: filled, options };
  if (row.extra) {
    const to = row.extra.from === "who" ? (vars.who ?? "") : id;
    if (to !== "" && ctx.name(to) !== null)
      line.extra = { from: to, key: row.extra.key, delay: row.extra.delay };
  }
  return line;
}
```

Note for the implementer: `list` for `dutyRoster` and `names` for `birthday`, `q`, `n`, `time`, `off`, `makeup` come through `vars` unchanged and fill the words' placeholders. If a `row.key` function result is not a key in the vendored `chat.life` (the test checks this), fix the table, not the test. `chat.work.bye` is at `chat.work.bye`; the test's lookup handles the `work.` prefix.

- [ ] **Step 5: The staff's names and the service's `life`**

`server/chat-service.ts`: `staffNameOf` becomes

```ts
const STAFF_NAMES: Readonly<Record<string, string>> = {
  __director: "Director",
  __reception: "Receptionist",
  __hr: "HR",
  __cleaner: "Cleaner",
  __guard: "Security guard",
  __courier: "Courier",
  __accountant: "Accountant",
};
/** The staff the scene has on the floor speak in the chat under these names. */
export function staffNameOf(key: string, tr: Translate): string | null {
  if (key === DIRECTOR) return tr("people.director");
  return STAFF_NAMES[key] ?? null;
}
```

(The existing test that says only the director has a name changes to say all seven have.) `shared/contracts.ts`: add to `ChatRequestSchema`'s union (read it at line 308 and copy the style of `send`):

```ts
z.object({
  op: z.literal("life"),
  kind: z.string().min(1).max(40),
  vars: z.record(z.string().max(40), z.string().max(200)).default({}),
}),
```

`server/chat-service.ts` `request`: add `case "life": return life(input);` and above `return {` define

```ts
function life(input: Extract<ChatRequest, { op: "life" }>): ChatResult {
  const line = lifeLine(input.kind, input.vars, {
    resting: () => [...roster.values()].filter((m) => m.status === "rest").map((m) => m.id),
    name: (id) => roster.get(id)?.name ?? null,
    now: clock.now(),
  });
  if (line === null) return { ok: false, error: "There is no such line." };
  const text = tr(line.key, line.vars);
  if (text === line.key) return { ok: false, error: "There is no such line." };
  engine.say(line.from, text, line.options);
  if (line.extra)
    engine.say(line.extra.from, tr(line.extra.key), {
      delay: line.extra.delay,
      key: `${line.options.key}:${line.extra.key}`,
    });
  return OK;
}
```

(import `lifeLine` from `../shared/life-lines.js`; `ChatMember.status` is `"rest" | "work"`.) `engine.say`'s `SayOptions` in `shared/upstream/chat-engine.d.ts` has `key`, `react`, `reacts`; add `pin?: boolean; answer?: { key: string; chance?: number }[];` to that `.d.ts` (it is Paseo's file, not upstream's; the engine reads both).

`shared/chat-words.ts`: add above `find`:

```ts
// Lines the chat says that upstream words with a company's name: the office's own wording instead.
const OURS: Readonly<Record<string, readonly string[]>> = {
  "chat.life.parcel": [
    "{name}, a parcel for you 📦 come down for it",
    "The courier’s here with {name}’s parcel 📦",
  ],
};
```

and in `find`: `if (Object.hasOwn(OURS, key)) return [...OURS[key]];` as the first line after the director check (`ChatWords` accepts a string array; if the type refuses, cast through `as ChatWords`).

- [ ] **Step 6: Run and see them pass**

Same command as Step 3. Expected: PASS.

- [ ] **Step 7: The scene's side and the client's**

`vendor/my-office/src/office/ui/group-chat.js`:

```js
// PASEO: stand-in for my-office's ui/group-chat.js (its chat window), which Paseo does not take. What the
// office's people would say in the group chat goes to the host as a kind and a few words (host.life); the host's
// server words it. A line the games say with their own words (chatSay) still goes nowhere.
import { host } from "../paseo-host.js";

const sent = new Map();
export function chatLife(kind, vars = {}) {
  const out = {};
  for (const [k, v] of Object.entries(vars))
    if (v != null && typeof v !== "object" && k !== "photo") out[k] = String(v);
  // upstream's own once-per-period rule (v.every) is the server's too: the same kind and period says one line
  const last = sent.get(`${kind}:${out.id || ""}`) || 0;
  const every = Number(out.every) || 20 * 60e3;
  if (Date.now() - last < every) return;
  sent.set(`${kind}:${out.id || ""}`, Date.now());
  host.life(kind, out);
}
export function chatSay() {}
// (the chat does not keep a picture: the server drops a photo's data)
export function chatPhoto() {
  return null;
}
```

`client/world/world-api.ts`: `WorldStartOptions` gains

```ts
  /** Something the office's people would say in the team chat: a kind of moment and a few words. */
  onLife?(kind: string, vars: Record<string, string>): void;
  /** The tenure list's two writes: a farewell was held, an intern was made permanent. */
  onTenure?(op: { op: "farewell" | "official"; name: string }): void;
```

and `WorldApi` gains `setTenure?(tenure: WorldTenure): void;` and `setLiftService?(info: WorldLiftService): void;` with (Task 4 uses them)

```ts
export interface WorldTenureProject {
  name: string;
  last: number;
  days: number;
  turns: number;
  due: boolean;
  farewell: number;
  back: number;
  intern: boolean;
  ready: boolean;
  official: number;
}
export interface WorldTenure {
  days: number;
  choices: number[];
  projects: WorldTenureProject[];
}
export interface WorldLiftService {
  left: number;
  total: number;
  newBuild: boolean;
  sticker: { version: string; at: number; build: string } | null;
}
```

`client/world/world-bridge.ts`: where the phone's script frame turns callbacks into names, add `onLife` and `onTenure` in the same literal list the others (`onToast`, `onSound`) are in; read the file and follow `onToast` exactly. `client/world/world-view.tsx` and `world-view-native.tsx`: where `onToast` is passed to `start`, pass `onLife` and `onTenure` from the props of the view (`WorldViewProps` gains `onLife` and `onTenure`), and in `client/office-surface.tsx` (the place that renders `WorldView`; find it by `onOpen=`), build them with `useRpc(chatRpc)`:

```ts
const chatCall = useRpc(chatRpc);
const onLife = useCallback(
  (kind: string, vars: Record<string, string>) => {
    void chatCall({ op: "life", kind, vars }).catch(() => undefined);
  },
  [chatCall],
);
```

`onTenure` is wired in Task 4 (its RPC). Add a test to `client/world/world-bridge.test.ts` following its existing `onToast` test: a `start` with `onLife` posts a named callback and the page's stand-in calls it with `(kind, vars)`.

- [ ] **Step 8: Run, SOURCES.md, commit**

`vendor/SOURCES.md`: the paragraph about the team chat ("Of the staff the engine names, only the director has a name ...") is rewritten: all seven staff speak, the scenes send kinds, `shared/life-lines.ts` is the table, photos are not sent, and the games' own `chatSay` lines still go nowhere. Run the chain (`npm run build:world` is needed: `group-chat.js` changed). Commit: `feat: the staff scenes speak in the team chat`.

---

### Task 4: The data: spending, a repository's age, tenure, the lift

**Files:**

- Create: `server/tenure.ts`, `server/tenure.test.ts`, `server/repo-age.ts`, `server/repo-age.test.ts`, `server/lift-service.ts`, `server/lift-service.test.ts`, `server/life-feed.ts`, `server/life-feed.test.ts`, `client/world/use-life.ts`, `client/world/use-life.mounted.test.tsx`
- Modify: `server/paths.ts` (`tenureFile`, `liftFile`), `server/paseo-directory.ts` and `server/directory.ts` (folders), `server/hub.ts` (`DirectoryView.folders`), `shared/contracts.ts` (`lifeSubscription`, `tenureRpc`), `index.server.ts`, `client/world/adapter.ts` (`cost`, `born`), `client/world/adapter.test.ts`, `client/world/use-world-feed.ts`, `client/office-surface.tsx`, `vendor/my-office/src/office/people/accountant.js`? (no: unchanged)

**Interfaces:**

- Consumes: Task 2's `setTenure`, `setLiftService`, `onTenure`; `hub.watch(listener)` giving `DirectoryView | null`; `chatService.turnEnded`.
- Produces:
  - `createTenure(deps): Tenure` with `touch(team, { at, turn }): "new"|"back"|"ready"|null`, `markFarewell(team, live): boolean`, `markOfficial(team): boolean`, `list(live: ReadonlySet<string>): TenureProject[]`, `seed(teams: SeedTeam[]): void`, constants `FAREWELL_DAYS = 30`, `PROMOTE_TURNS = 20`, `PROMOTE_DAYS = 2`, pure `farewellDue`, `promoteDue`, `isIntern`, `wasActive`.
  - `readRepoAge(folder, exec): Promise<string | null>` in `server/repo-age.ts` (`YYYY-MM-DD`).
  - `planService(last, build, now): { since, until, newBuild, sticker }` and `createLiftService(deps)` with `pub(now): WorldLiftService`.
  - Subscription `office.life` with events `{ type: "life", born: Record<string,string>, tenure: WorldTenure, lift: WorldLiftService }`; RPC `office.tenure.request` input `{ op: "farewell" | "official", name }` output `{ ok: boolean }`.
  - `WorldSession.usage` gains `cost?: number`; `WorldSession.git` gains `born?: string`.

- [ ] **Step 1: Write the failing tests for the pure rules**

`server/tenure.test.ts` (rules are upstream's `server/tenure.mjs` lines 21 to 38; the DAY is 86,400,000):

```ts
import { expect, test } from "vitest";
import {
  FAREWELL_DAYS,
  createTenure,
  farewellDue,
  isIntern,
  promoteDue,
  wasActive,
} from "./tenure.js";

const DAY = 86_400_000;
const memory = () => {
  let saved: unknown = null;
  return {
    load: () => saved,
    save: (data: unknown) => {
      saved = structuredClone(data);
    },
  };
};

test("a team is active after two days and due after thirty quiet ones", () => {
  expect(wasActive({ days: 1 })).toBe(false);
  expect(wasActive({ days: 2 })).toBe(true);
  const quiet = { days: 3, last: 0, farewell: 0 };
  expect(farewellDue(quiet, FAREWELL_DAYS, 29 * DAY, false)).toBe(false);
  expect(farewellDue(quiet, FAREWELL_DAYS, 30 * DAY, false)).toBe(true);
  expect(farewellDue(quiet, FAREWELL_DAYS, 31 * DAY, true)).toBe(false);
  expect(farewellDue({ ...quiet, farewell: 5 }, FAREWELL_DAYS, 31 * DAY, false)).toBe(false);
});

test("a team new to the office is an intern until 20 turns on two days", () => {
  const p = { checked: true, turns: 19, days: 2 };
  expect(isIntern(p)).toBe(true);
  expect(promoteDue(p)).toBe(false);
  expect(promoteDue({ ...p, turns: 20 })).toBe(true);
  expect(isIntern({ ...p, pre: true })).toBe(false);
  expect(isIntern({ ...p, official: 1 })).toBe(false);
});

test("the teams present on the first start are permanent", () => {
  let now = 10 * DAY;
  const t = createTenure({ store: memory(), now: () => now });
  t.seed([{ name: "api", first: 0, daysSeen: 4 }]);
  expect(t.list(new Set()).find((p) => p.name === "api")).toBeUndefined();
  expect(t.touch("web", { at: now })).toBe("new");
  now += DAY;
  expect(t.list(new Set()).find((p) => p.name === "web")?.intern).toBe(true);
});

test("turns and days count, and a team that comes back after its farewell says so", () => {
  let now = 100 * DAY;
  const t = createTenure({ store: memory(), now: () => now });
  t.seed([{ name: "api", first: 0, daysSeen: 5 }]);
  now += 40 * DAY;
  expect(t.list(new Set())[0]).toMatchObject({ name: "api", due: true });
  expect(t.markFarewell("api", true)).toBe(false);
  expect(t.markFarewell("api", false)).toBe(true);
  expect(t.markFarewell("api", false)).toBe(false);
  expect(t.touch("api", { at: now + DAY, turn: true })).toBe("back");
  expect(t.list(new Set())[0]).toMatchObject({ name: "api", due: false, farewell: 0 });
});

test("an intern ready after 20 turns is made permanent once", () => {
  let now = 0;
  const t = createTenure({ store: memory(), now: () => now });
  t.seed([]);
  t.touch("new", { at: now });
  for (let i = 0; i < 20; i += 1) {
    now += DAY / 10;
    t.touch("new", { at: now, turn: true });
  }
  now += DAY;
  t.touch("new", { at: now, turn: true });
  expect(t.list(new Set())[0]).toMatchObject({ intern: true, ready: true });
  expect(t.markOfficial("new")).toBe(true);
  expect(t.markOfficial("new")).toBe(false);
  expect(t.list(new Set())[0]).toMatchObject({ intern: false, official: expect.any(Number) });
});

test("the ledger is kept and read back", () => {
  const store = memory();
  const a = createTenure({ store, now: () => 5 * DAY });
  a.seed([{ name: "api", first: 0, daysSeen: 3 }]);
  a.touch("api", { at: 5 * DAY, turn: true });
  const b = createTenure({ store, now: () => 5 * DAY });
  expect(b.get("api")).toMatchObject({ turns: 1 });
});

test("no more than 300 teams are kept, the most lately at work", () => {
  let now = 0;
  const t = createTenure({ store: memory(), now: () => now });
  t.seed([]);
  for (let i = 0; i < 305; i += 1) {
    now += 1000;
    t.touch(`t${i}`, { at: now });
  }
  expect(t.get("t0")).toBeNull();
  expect(t.get("t304")).not.toBeNull();
});
```

`server/repo-age.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { readRepoAge } from "./repo-age.js";

test("the first commit's day, from git", async () => {
  const exec = vi.fn(async () => ({ stdout: "2024-03-05\n2025-01-01\n", stderr: "" }));
  expect(await readRepoAge("/some/folder", exec)).toBe("2024-03-05");
  expect(exec).toHaveBeenCalledWith(
    "git",
    ["log", "--max-parents=0", "--reverse", "--format=%as"],
    expect.objectContaining({ cwd: "/some/folder", timeout: 10_000 }),
  );
});

test("nothing when git fails, says nothing sensible, or the folder is empty", async () => {
  expect(
    await readRepoAge("/x", async () => {
      throw new Error("not a repository");
    }),
  ).toBeNull();
  expect(await readRepoAge("/x", async () => ({ stdout: "garbage\n", stderr: "" }))).toBeNull();
  expect(await readRepoAge("", async () => ({ stdout: "2024-01-01\n", stderr: "" }))).toBeNull();
});
```

`server/lift-service.test.ts` (rules from upstream `server/lift-service.mjs`, three minutes, five on a new build, sticker kept per build, first start not new):

```ts
import { expect, test } from "vitest";
import { NEW_BUILD_MS, SERVICE_MS, createLiftService, planService } from "./lift-service.js";

test("a restart on the same build is serviced for three minutes", () => {
  expect(planService({ build: "aaa", sticker: null }, "aaa", 1000)).toMatchObject({
    until: 1000 + SERVICE_MS,
    newBuild: false,
    sticker: null,
  });
});
test("the first start ever is not a new build", () => {
  expect(planService(null, "aaa", 0)).toMatchObject({ newBuild: false, until: SERVICE_MS });
});
test("a new build gets five minutes and a sticker put up at the end", () => {
  const plan = planService({ build: "aaa", sticker: null }, "bbb", 0);
  expect(plan).toMatchObject({
    newBuild: true,
    until: NEW_BUILD_MS,
    sticker: { build: "bbb", at: NEW_BUILD_MS },
  });
});
test("a restart on a serviced build still shows its sticker", () => {
  const sticker = { build: "bbb", version: "bbb", at: 5 };
  expect(planService({ build: "bbb", sticker }, "bbb", 100).sticker).toEqual(sticker);
});
test("the page is told how long is left, not a time", () => {
  const kept: unknown[] = [];
  const service = createLiftService({
    load: () => null,
    save: (d) => kept.push(d),
    build: "abcdefgh",
    now: 1000,
  });
  expect(service.pub(1000 + 60_000)).toMatchObject({
    left: SERVICE_MS - 60_000,
    total: SERVICE_MS,
    newBuild: false,
  });
  expect(service.pub(1000 + SERVICE_MS + 5).left).toBe(0);
  expect(kept).toHaveLength(1);
});
```

- [ ] **Step 2: Run them and see them fail** (`npx vitest run server/tenure.test.ts server/repo-age.test.ts server/lift-service.test.ts`: module not found.)

- [ ] **Step 3: Implement the three modules**

`server/tenure.ts` exports, in this shape (port of upstream `tenure.mjs` lines 18 to 107, with the transcript reading dropped):

```ts
export const FAREWELL_DAYS = 30;
export const PROMOTE_TURNS = 20;
export const PROMOTE_DAYS = 2;
const DAY = 86_400_000;
const MAX = 300;
const BACK_SHOWN = DAY;

export interface TenureEntry {
  first: number;
  last: number;
  days: number;
  lastDay: string;
  turns: number;
  farewell?: number;
  back?: number;
  pre?: boolean;
  official?: number;
  checked?: boolean;
}
export interface TenureProject {
  name: string;
  last: number;
  days: number;
  turns: number;
  due: boolean;
  farewell: number;
  back: number;
  intern: boolean;
  ready: boolean;
  official: number;
}
export interface SeedTeam {
  name: string;
  first: number;
  daysSeen: number;
}
export interface TenureStore {
  load(): unknown;
  save(data: unknown): void;
}
export interface Tenure {
  touch(team: string, input: { at?: number; turn?: boolean }): "new" | "back" | "ready" | null;
  markFarewell(team: string, live: boolean): boolean;
  markOfficial(team: string): boolean;
  list(live: ReadonlySet<string>): TenureProject[];
  seed(teams: readonly SeedTeam[]): void;
  get(team: string): TenureEntry | null;
  /** True once seed() has run on this ledger, now or on an earlier start. */
  seeded(): boolean;
}
export const wasActive = (p: { days?: number } | undefined) => (p?.days ?? 0) >= 2;
export const farewellDue = (
  p: { days?: number; last?: number; farewell?: number } | undefined,
  days: number,
  now: number,
  live: boolean,
) =>
  p !== undefined &&
  days > 0 &&
  wasActive(p) &&
  !p.farewell &&
  !live &&
  now - (p.last ?? now) >= days * DAY;
export const isIntern = (p: { pre?: boolean; official?: number; checked?: boolean } | undefined) =>
  p !== undefined && !p.pre && !p.official && p.checked === true;
export const promoteDue = (
  p:
    | { pre?: boolean; official?: number; checked?: boolean; turns?: number; days?: number }
    | undefined,
) => isIntern(p) && (p?.turns ?? 0) >= PROMOTE_TURNS && (p?.days ?? 0) >= PROMOTE_DAYS;
export function createTenure(deps: { store: TenureStore; now?: () => number }): Tenure;
```

Behaviour the tests fix: the ledger is `{ v: 1, seeded: boolean, projects: Record<string, TenureEntry> }`; `touch` of an unknown team creates `{ first: at, last: at, days: 0, lastDay: "", turns: 0, checked: true }` and returns `"new"` (a team created by `touch` is an intern: `checked: true`, not `pre`); if the team had a farewell, `back = at; farewell = 0` and it returns `"back"`; the local calendar day (`new Date(at).toLocaleDateString("sv")`) counts `days`; `turn` adds one; a touch that makes `promoteDue` true for the first time returns `"ready"`; the list is capped at `MAX` by `last`; `seed` is only effective once (`seeded` flag): each seeded team gets `{ first, last: now(), days: daysSeen, lastDay: today, turns: 0, pre: true, checked: true }` (permanent) and the flag is set; every change calls `store.save` (the caller's store debounces; this module saves at once). `list` returns upstream's projects rule (`due || farewell || back-in-the-last-day || intern || official`), newest `last` first, at most 60, with `due` from `farewellDue(p, FAREWELL_DAYS, now, live.has(name))`. `markFarewell` returns false unless `farewellDue(..., live)`; it then sets `farewell = now`, `back = 0`. `markOfficial` returns false unless `promoteDue`; sets `official = now`.

`server/repo-age.ts`:

```ts
export interface ExecResult {
  stdout: string;
  stderr: string;
}
export type Exec = (
  command: string,
  args: string[],
  options: { cwd: string; timeout: number; maxBuffer: number; env: NodeJS.ProcessEnv },
) => Promise<ExecResult>;

/** The day of a repository's first commit, "YYYY-MM-DD"; null when git cannot say. */
export async function readRepoAge(folder: string, exec: Exec): Promise<string | null> {
  if (folder === "") return null;
  try {
    const { stdout } = await exec("git", ["log", "--max-parents=0", "--reverse", "--format=%as"], {
      cwd: folder,
      timeout: 10_000,
      maxBuffer: 1 << 20,
      env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    });
    const first = stdout.trim().split("\n")[0] ?? "";
    return /^\d{4}-\d{2}-\d{2}$/.test(first) ? first : null;
  } catch {
    return null;
  }
}
```

(the test's `expect.objectContaining` passes: `env` is extra.) In `index.server.ts` the real `Exec` is `execCommand` from `@getpaseo/plugin/server` (its options type has `cwd`, `timeout`, `maxBuffer`, `env`).

`server/lift-service.ts`: `SERVICE_MS = 180_000`, `NEW_BUILD_MS = 300_000`; `planService(last, build, now)` as upstream (`newBuild = build && last?.build && last.build !== build`; `until = now + (newBuild ? NEW_BUILD_MS : SERVICE_MS)`; sticker `{ build, version: build.slice(0, 7), at: until }` when new, else the kept one when its build equals this build, else null); `createLiftService({ load, save, build, now })` calls `load()` once, plans, calls `save({ build: build || last?.build || "", sticker: plan.sticker })`, returns `{ plan, pub(t): WorldLiftService }` with `left = max(0, until - t)`, `total = until - since`, and `sticker` as `{ version, at, build: build.slice(0, 7) }` or null. Run the three tests: expected PASS.

- [ ] **Step 4: Failing tests for the feed and the adapter**

`server/life-feed.test.ts` (the feed joins the directory view to the ledger, the folders to the ages, and the lift; it is the object `index.server.ts` serves):

```ts
import { expect, test, vi } from "vitest";
import { createLifeFeed } from "./life-feed.js";
import type { DirectoryView } from "./hub.js";

const view = (
  over: Partial<DirectoryView> & { folders?: Record<string, string> } = {},
): DirectoryView =>
  ({
    agents: [
      {
        id: "a1",
        workspaceId: "w1",
        status: "idle",
        createdAt: "2026-10-01T00:00:00Z",
        parentAgentId: null,
      } as never,
    ],
    workspaces: [{ id: "w1", name: "api", projectName: "p" } as never],
    folders: { w1: "/work/api" },
    ...over,
  }) as DirectoryView;

const deps = (extra = {}) => ({
  tenure: {
    touch: vi.fn(),
    seed: vi.fn(),
    seeded: () => false,
    list: () => [],
    markFarewell: vi.fn(() => true),
    markOfficial: vi.fn(() => true),
    get: () => null,
  },
  age: vi.fn(async () => "2020-02-03"),
  lift: { pub: () => ({ left: 1, total: 2, newBuild: false, sticker: null }) },
  days: () => ({ choices: [30], days: 30 }),
  now: () => Date.parse("2026-11-19T00:00:00Z"),
  emit: vi.fn(),
  ...extra,
});

test("the first view seeds the ledger with each team and its agents' days", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view());
  expect(d.tenure.seed).toHaveBeenCalledWith([
    { name: "api", first: Date.parse("2026-10-01T00:00:00Z"), daysSeen: 2 },
  ]);
});

test("a repository's age is read once per folder and sent by team name", async () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view());
  feed.view(view());
  await feed.settled();
  expect(d.age).toHaveBeenCalledTimes(1);
  expect(feed.snapshot().born).toEqual({ api: "2020-02-03" });
});

test("a turn that ends touches its team", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view());
  feed.turnEnded("a1");
  expect(d.tenure.touch).toHaveBeenCalledWith("api", expect.objectContaining({ turn: true }));
});

test("an agent in the lobby belongs to no team", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(
    view({
      agents: [
        {
          id: "a2",
          workspaceId: null,
          status: "idle",
          createdAt: "2026-10-01T00:00:00Z",
          parentAgentId: null,
        } as never,
      ],
    }),
  );
  feed.turnEnded("a2");
  expect(d.tenure.touch).not.toHaveBeenCalled();
});

test("a farewell or an official write is passed to the ledger with who is live", () => {
  const d = deps();
  const feed = createLifeFeed(d);
  feed.view(view());
  expect(feed.write({ op: "farewell", name: "api" })).toEqual({ ok: true });
  expect(d.tenure.markFarewell).toHaveBeenCalledWith("api", true);
  expect(feed.write({ op: "official", name: "api" })).toEqual({ ok: true });
});
```

(the "live" boolean is whether an agent that is not closed sits in a workspace of that name; the test view has one, so `true`.) Fix the `seed` expectation if the implementation counts days differently: `daysSeen` is the number of distinct local calendar days among the team's agents' `createdAt` plus today, which is 2 here.

`client/world/adapter.test.ts` gains, following its existing `toSession` tests (read them first):

```ts
test("a person carries what the agent cost and the repository's first day", () => {
  const model = modelWith({ costUsd: 1.5, team: "api" }); // use the file's own builder
  const people = worldPeople(model, 44, { api: "2020-02-03" });
  expect(people.sessions[0]?.usage?.cost).toBe(1.5);
  expect(people.sessions[0]?.git).toEqual({ repo: "api", born: "2020-02-03" });
});
test("with no cost and no age the scene is told nothing", () => {
  const people = worldPeople(modelWith({ team: "api" }), 44, {});
  expect(people.sessions[0]?.usage?.cost).toBeUndefined();
  expect(people.sessions[0]?.git).toEqual({ repo: "api" });
});
```

- [ ] **Step 5: Run and see them fail** (`npx vitest run server/life-feed.test.ts client/world/adapter.test.ts`: module missing; `worldPeople` takes two arguments.)

- [ ] **Step 6: The feed, the folders, the contracts**

`server/hub.ts`: `DirectoryView` gains `/** Server only, never sent: each workspace's folder. */ folders?: Readonly<Record<string, string>>;`. `server/directory.ts`: `DirectoryWorkspaceInput` gains `workspaceDirectory?: string; projectRootPath?: string;` and a new pure

```ts
export function foldersOf(
  workspaces: ReadonlyMap<string, DirectoryWorkspaceInput> | readonly DirectoryWorkspaceInput[],
): Record<string, string>;
```

(workspace id to `workspaceDirectory ?? projectRootPath`, skipping archiving ones and those with neither) with a test in `server/directory.test.ts` (two workspaces, one archiving, one with only the root path). `server/paseo-directory.ts`: keep a `folders` record beside `workspaces`, set from `foldersOf(snapshot.entries)` in the snapshot handler and updated in the update handler from `message.payload.workspace` (read how `applyWorkspaceUpdate` gets its payload and mirror it: `kind: "upsert"` sets, `kind: "remove"` deletes), and pass `folders` in the view it emits. The existing directory tests must still pass; add one that a snapshot's view carries `folders`.

`server/life-feed.ts` exports `createLifeFeed(deps)` with `view(v: DirectoryView | null)`, `turnEnded(agentId: string)`, `write(op): { ok: boolean }`, `snapshot(): { born: Record<string,string>; tenure: WorldTenure; lift: WorldLiftService }`, `settled(): Promise<void>` (waits for the age reads in flight) and calls `deps.emit(snapshot)` when something changed (a new age, a ledger change, every view that changes the list). Team of an agent: `agent.workspaceId` mapped by the view's workspaces to `workspace.name`; none for the lobby; a sub-agent (`parentAgentId !== null`) counts for its parent's team too. First view: `tenure.seed(teams)` when `!tenure.seeded()`. Every view: `touch(team, { at: now })` for each team that has an agent not `closed` and not idle (running work counts as at work), at most once per view change per team. Ages: for each `(workspace id, folder)` not yet read, call `deps.age(folder)` and store `born[team] = date` (a second workspace of the same name keeps the first answer). `deps.days()` returns `{ choices: [30], days: 30 }`.

`shared/contracts.ts`: add (after `chatRpc`; copy `machineSubscription`'s `defineSubscription` style):

```ts
export const WorldTenureSchema = z.object({
  days: z.number(),
  choices: z.array(z.number()),
  projects: z.array(
    z.object({
      name: z.string(),
      last: z.number(),
      days: z.number(),
      turns: z.number(),
      due: z.boolean(),
      farewell: z.number(),
      back: z.number(),
      intern: z.boolean(),
      ready: z.boolean(),
      official: z.number(),
    }),
  ),
});
export const LifeEventSchema = z.object({
  type: z.literal("life"),
  born: z.record(z.string(), z.string()),
  tenure: WorldTenureSchema,
  lift: z.object({
    left: z.number(),
    total: z.number(),
    newBuild: z.boolean(),
    sticker: z.object({ version: z.string(), at: z.number(), build: z.string() }).nullable(),
  }),
});
export type LifeEvent = z.output<typeof LifeEventSchema>;
export const lifeSubscription = defineSubscription({
  name: "office.life",
  input: z.object({}),
  event: LifeEventSchema,
});
export const tenureRpc = defineRpc({
  name: "office.tenure.request",
  input: z.object({ op: z.enum(["farewell", "official"]), name: z.string().min(1).max(200) }),
  output: z.object({ ok: z.boolean() }),
});
```

`index.server.ts`: build the feed where the chat service is built (read lines 230 to 260): the stores are `createJsonStore`-like objects as `chatStore` is (follow `createChatStore`'s shape; add `tenureStore` and `liftStore` to the deps type with real ones made from `tenureFile` and `liftFile` in `server/paths.ts`, written the way `chat-store.ts` writes); `build` is `createHash("sha256").update(WORLD_SCRIPT).digest("hex").slice(0, 7)`; `age` is `(folder) => readRepoAge(folder, execCommand)`; `hub.watch((view) => feed.view(view))`; wire `feed.turnEnded(agent.id)` beside `chat.turnEnded(...)`; `server.handle(lifeSubscription, (input, context) => { ... })` follows how `machineSubscription` is handled (send the snapshot at once, then on each `emit` until `context.signal` aborts), and `server.handle(tenureRpc, (input) => feed.write(input))`. The server tests in `index.server.test.ts` that list handled contracts gain the two names. The tenure store saves at most once per 10 s and on stop (copy `chat-store`'s write-one-at-a-time rule; add a test in `server/tenure.test.ts`? not needed: the pure ledger saves through the store, the store's own test is `server/chat-store.test.ts`'s pattern, copied as `server/life-store.test.ts` for two cases: a missing file loads null, a saved value loads back).

`client/world/adapter.ts`: `worldPeople(model, desks, born: Readonly<Record<string,string>> = {})`; `toSession(row, team, born)`: `git: { repo: team, ...(born[team] === undefined ? {} : { born: born[team] }) }` and `usage` merges `...(agent.costUsd === undefined ? {} : { cost: agent.costUsd })` into an object that exists when either context or cost exists: `usage` type becomes `{ ctx: number; ctxMax: number; cost?: number }` with `ctx` and `ctxMax` 0 when only a cost is known; `fullness()` already returns null for `ctxMax <= 0`, keep that. `WorldSession.git` becomes `{ repo: string; born?: string }`.

`client/world/use-life.ts`:

```ts
import { useCallback, useState } from "react";
import { useRpc, useSubscription } from "@getpaseo/plugin/client";
import { lifeSubscription, tenureRpc, type LifeEvent } from "../../shared/contracts.js";

const NO_INPUT = {};
export interface LifeState {
  life: LifeEvent | null;
  /** A farewell was held or an intern made permanent: tell the server, which answers with the list. */
  tell(op: { op: "farewell" | "official"; name: string }): void;
}

/** What the daily-life scenes are fed beyond the people: ages, the tenure list, the lift's servicing. */
export function useLife(): LifeState {
  const [life, setLife] = useState<LifeEvent | null>(null);
  const onEvent = useCallback((event: LifeEvent) => {
    setLife(event);
  }, []);
  const subscription = useSubscription(lifeSubscription, NO_INPUT, onEvent);
  const write = useRpc(tenureRpc);
  const tell = useCallback(
    (op: { op: "farewell" | "official"; name: string }) => {
      void write(op).catch(() => undefined);
    },
    [write],
  );
  const live = subscription.status !== "error" && subscription.status !== "closed";
  return { life: live ? life : null, tell };
}
```

`use-life.mounted.test.tsx` follows `use-machine`'s mounted test if one exists, else `use-incident-alarm.mounted.test.tsx`: an event sets `life`, an `error` status makes it null, `tell` calls the RPC with the op. `client/world/use-world-feed.ts`: `WorldFeedInput` gains `life: LifeEvent | null`; `worldPeople(model, PLAN_DESKS[PLAN], life?.born ?? {})` (the `useMemo` list gains `life?.born`), and two effects after the machine's: `world.current?.setTenure?.(life.tenure)` when `life` is not null, `world.current?.setLiftService?.(life.lift)` once per `life.lift.total`/`left` change: because `left` is a countdown from send time, send it only when the event's `lift` differs from the last one sent (compare `JSON.stringify`) and when `api` changes (the scene restarts: it gets the list again). `client/office-surface.tsx` calls `useLife()`, passes `life` into `useWorldFeed` and `tell` as `onTenure` into `WorldView` (`world-view.tsx`/`world-view-native.tsx` pass it to `start`). A test in `use-world-feed.mounted.test.tsx` (copy the incident test's shape): a `life` input makes the fake scene's `setTenure` and `setLiftService` be called once each, and a second render with the same life calls neither again.

- [ ] **Step 7: Run all, then the chain**

`npx vitest run server client shared` then the chain. Expected: PASS, engine-compat green (`client/world/use-life.ts` uses nothing banned). If `index.server.test.ts` lists contracts, it passes with the two new names.

- [ ] **Step 8: Commit** `feat: the staff scenes are fed spending, a repository's age, tenure and the lift's servicing`.

---

### Task 5: The README's data section, and the docs

**Files:** Modify: `README.md`, `docs/office.md`, `vendor/SOURCES.md`; Test: `scripts/readme.test.mjs` only if it exists (check `ls scripts`); otherwise none.

- [ ] **Step 1:** In `README.md`, "What it reads and where it sends it" is rewritten in this release (the roadmap requires it). New bullets, keeping the existing ones that stay true:
  - "It reads the host's agents and workspaces, their status, what each agent has cost so far, and the kind of thing each does."
  - "On the host, it runs `git log` in a workspace's folder once, to learn the day of the repository's first commit. It runs nothing else."
  - "The 3D scene is told who is there, what kind of thing each does, what each agent has cost, the day each team's repository began, how long each team has been in the office (first and last seen, days worked, turns finished), and when the lift's servicing ends. It is never told a file name, a command or a prompt. The scene makes no network call."
  - "The scene tells the server two things: a kind of moment for the team chat (a birthday, the fire drill) with a few words such as a name or a count, and when a farewell or a promotion was held."
  - "It stores the tenure list (`tenure.json`) and the lift's last build (`lift.json`) under the host's Paseo home, in `office/`, beside the chat."
- [ ] **Step 2:** `docs/office.md`: a section "Staff and daily life" naming the 13 scenes, saying which need data (accountant: spending; HR: repository age; farewell and interns: tenure; lift: restart) and which play with none, that nothing street-side is there yet, that the lively floor is quiet 12:30 to 13:30 for the midday nap, and the table kind to sender from `shared/life-lines.ts`. Remove any sentence that says the daily-life scenes are not taken.
- [ ] **Step 3:** `vendor/SOURCES.md`: confirm the counts (eight hand-changed copied files), "What the scene is told" and the `localStorage` sentence ("It writes ... `office-` keys": add `office-gone`, `office-back:*`, the duty roster and the drill's keys), and "It makes no network call" stays true.
- [ ] **Step 4:** Run `npm run format:check` (prettier covers the markdown). Commit `docs: say what the staff scenes read and send`.

---

### Task 6: A look, and what was seen

**Files:** Modify: `docs/verified.md`, `README.md`, `docs/office.md` (only where the look changes a claim).

- [ ] **Step 1: Install on a throwaway stock daemon.** Follow piece 1's plan, its last task, exactly: `PASEO_HOME=/tmp/office-stock-home`, port 6798, `env -i`, CLI `/tmp/paseo-stock/node_modules/.bin/paseo`, the plugin installed by Git from the local clone (commit first so the clone holds the work), `plugin ls` running, `plugin logs office` with no error. Never touch port 6767.
- [ ] **Step 2: Make people.** With the throwaway daemon, start two or three agents in two workspaces (the mock provider if the daemon has no sign-in). Seat them and open the 3D view at 1280 and at 390 px with the Paseo browser.
- [ ] **Step 3: What to look at, desktop and phone width.**
  - The scene loads with no error in the frame's console (this is the check that the 15 taken modules' `setup()` all ran: a throw shows as the office's problem note).
  - Reception, the cleaner and the courier appear at their times; the courier's carton has a plain box mark and the bubbles say "Courier"/"Delivery!". No scene shows the word Shopee.
  - The lift is under repair for three minutes after the daemon starts (barrier, technician, everyone on the stairs); at the end the technician rides down. Restart the throwaway plugin on the same build: a new servicing, no sticker; (optionally) update the plugin to a new commit: five minutes and the sticker "Office <7 characters>".
  - The accountant's screen shows the project and cost rows once an agent has a cost (mock providers may report none: then the screen is empty, which is the designed behaviour).
  - HR's desk, the intern plates (a new workspace's people carry an orange lanyard and plate; the teams present at first start do not).
  - The team chat tab: after the lift servicing the stairs line, "Receptionist" and "HR" as senders, reactions arriving; the nap lines at 12:30 if the clock allows (the page clock can be moved by the browser's devtools only if the tool offers it; otherwise say so).
  - The network log of the frame shows no request to `/api/`; the RPCs `office.chat.request` and `office.tenure.request` appear on the app's own connection.
  - The lively floor still moves resting people outside 12:30 to 13:30 (leave an agent idle for the gap).
  - Frame rate and the JS heap before and after (the bundle is 10% larger; there are 14 more scenes with timers) at 1280 px.
- [ ] **Step 4: What cannot be seen there, so it is the owner's to check on the host.** The phone's script frame (the store app and the fork's app): that the scene starts, the lift scene plays, the chat lines arrive; memory and frame rate on the phone; real cost numbers on the accountant's screen with the owner's real providers (a mock provider reports none); the birthday cake (needs a repository whose first commit was made this month, so it is the owner's: look at the first of the month or with such a repository); a farewell (30 quiet days) and an intern's promotion (20 turns on two days) cannot be waited for on a throwaway daemon: the plan's test of the ledger stands in, and the owner sees the first one when it comes; the drill at 15:00 on the first working day of a quarter; the altar's lunar days.
- [ ] **Step 5: Record it.** Add a section to `docs/verified.md` ("Staff and daily life, indoors": date, tree, what was seen at each width, what was not and why, the heap and frame numbers), update `README.md` and `docs/office.md` where a line proved wrong, run the chain, commit `docs: what was seen with the staff scenes`.

---

## Not verifiable until built

| What                                                                                                                                                           | How the task finds out                                                                                                                                                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| That all 15 taken modules' `setup()` run in a real WebGL page with no throw (the entry test mocks them; the bundle builds)                                     | Task 6 step 3, the frame's console                                                                                                                                                                                        |
| That a taken scene does not expect an element the page lacks beyond the ones read (`#stage` only, found by grep)                                               | Task 6, console                                                                                                                                                                                                           |
| `resting(w)` real in the stand-in and the lively floor not picking the same person as lunch, chores or tea at once                                             | Task 6: watch a resting agent across the noon lunch; `idle()` in `paseo-leisure.js` requires `station === 'desk'` and comnha sets `station = 'micro'`, so they should not collide; if they do, add `!w.chore` to `idle()` |
| `drill.js` with `street()` null on the company floor: that the 15:00 drill's office half plays and ends                                                        | Task 6 cannot reach 15:00 on a quarter's first working day; a unit check of the "no city" branch is by reading (`D.S && D.ex` false); the owner's look                                                                    |
| That `execCommand('git', ...)` works inside the plugin's subprocess on the host and in the throwaway daemon                                                    | Task 4 test with a fake `exec`; Task 6 reads a repository's age by looking for the birthday on a repository made this month (`git init` and one commit in a throwaway workspace)                                          |
| `workspaceDirectory` / `projectRootPath` on the 0.16.2 descriptor (read from the fork's protocol schema, not from the stock package)                           | Task 4: `foldersOf` test uses the names; Task 6: the age shows for a git workspace, or `plugin logs office` shows none                                                                                                    |
| That `localStorage` in the app's frame keeps the duty roster and the farewell's list between visits (same-origin `srcdoc` on desktop; unseen in the store app) | The owner's look, leaving and returning                                                                                                                                                                                   |
| Phone memory with 14 more scenes                                                                                                                               | The owner's look                                                                                                                                                                                                          |
| That a `useSubscription` event arrives before the scene starts and again after a scene restart                                                                 | Task 4's mounted test fakes it; Task 6 reloads the page and the lift scene resumes                                                                                                                                        |

## After the tasks (controller)

1. Review the diff (`vendor/` by the tool's output plus the three hand-changed files; `server/`; `client/`), then run the whole suite and `npm run check:world`.
2. Merge `feat/staff-indoors` into `main` of the working copy; piece 6 reads `world/layout.js`, `world/desks.js` and `net/live.js` as upstream's unchanged (they are) and the size limit set here (1,400,000).
3. Push `main` and a branch for CI; wait for green. If the hub "daemon restart" server test flakes on a slow runner, compare with a dispatched run of the base.
4. On the owner's host: `paseo plugin update office --ref <commit>`; check `paseo plugin logs office` for no error. Note that the first start seeds `tenure.json`: every team present is permanent, nobody is an intern, and no farewell is due for 30 days.
5. The owner looks on desktop and on the phone (Task 6 step 4 lists what only the host shows).
6. Tag `v0.6.0` after the owner's yes; the README's data section is already rewritten in this release.
