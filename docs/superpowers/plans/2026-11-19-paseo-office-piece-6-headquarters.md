# paseo-office piece 6: Headquarters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The third floor plan, Headquarters (the company floor plus a wing of four department rooms), can be chosen in the Floor plan setting and draws, with agents seated in its rooms by workspace.

**Architecture:** my-office's `world/pro/wing.js` replaces the plugin's stand-in through the import tool, and the one hand change that refused `hq` (`core/env.js`) is undone. Almost every other headquarters rule is already in the vendored scene (desks, lights, terrace, navigation, walk bounds, camera limits), so the work is the wing, the few places the port decides by plan (`paseo-entry.js`, the walk's `floorBounds`, the camera bar's named views), and the plugin's numbers and setting.

**Tech Stack:** Vendored JavaScript (my-office, three.js r160) built by esbuild into `server/world.generated.ts`; TypeScript and React Native in a Paseo plugin (`/workspace/QFlavours/paseo-office`); Vitest with jsdom.

**Spec:** `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-paseo-office-roadmap-design.md`, piece 6 ("6. Headquarters"), with "What binds every piece". Version tag: v0.7.0.

## What the code says about headquarters (read on 2026-11-19, my-office `b682288`)

Every module of upstream's `src/office` that reads `HQ` (`grep -rn "HQ" src/office`), and where the port stands:

| Module                                                  | What it does under headquarters                                                                                                                                                                                                                                                                          | The port today                                                                                                            |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `world/pro/wing.js`                                     | Builds the wing (z 9 to 26): slab, outer wall with windows, two corridors, four carpeted rooms, glass and half walls, four door plaques, sprint boards, credenzas, plants, two sofas, the "HEADQUARTERS" sign. Exports `DEPT_SIGNS` (redraws a plaque). Its `setup()` runs `buildWing()` only when `HQ`. | **Stand-in**: `export const DEPT_SIGNS = [];`. Taken in task 1.                                                           |
| `core/env.js`                                           | Sets `HQ = LAYOUT === 'hq'`.                                                                                                                                                                                                                                                                             | Has the line, but a `// PASEO:` change refuses `hq` (`PLANS.includes(host.plan) && host.plan !== 'hq'`). Task 2.          |
| `world/layout.js`                                       | `WING`, `DEPTS` (four rooms, two pods each), `REACH` (camera's limit), `LAY.box` and `LAY.center`.                                                                                                                                                                                                       | Has all of it, unchanged from upstream.                                                                                   |
| `world/desks.js`                                        | Pods: 3 on the company floor plus 8 in the rooms. `UNITS`: six two-desk areas (`pod`, `side`) plus four rooms of eight desks (`dept: i`). 44 desks.                                                                                                                                                      | Has it, unchanged.                                                                                                        |
| `net/live.js`                                           | Seats a person by project in `proDesk`; calls `DEPT_SIGNS[dept]` with the project's name, or `''` when the room empties; puts the room's chip between its two pods.                                                                                                                                      | Has it, unchanged. It imports `DEPT_SIGNS` from the stand-in today.                                                       |
| `people/navigation.js`                                  | `wingGraph()` adds the corridors' and rooms' walking nodes and edges to the graph.                                                                                                                                                                                                                       | Has it, unchanged.                                                                                                        |
| `scene/renderer.js`                                     | HQ home, base zoom 0.56, camera position, `controls.minZoom` 0.36.                                                                                                                                                                                                                                       | Has it, unchanged.                                                                                                        |
| `scene/lights.js`                                       | A larger shadow box, the sun aimed at the longer floor, two extra lamps and two extra point lights in the wing.                                                                                                                                                                                          | Has it, unchanged.                                                                                                        |
| `world/terrace.js`                                      | A longer terrace (37.2 deep), more bollards and planters, the front railing at z 28.5.                                                                                                                                                                                                                   | Has it, unchanged.                                                                                                        |
| `world/furniture/plants-lamps.js`                       | Two pot plants moved clear of the wing's doors, one lamp at the wing's end.                                                                                                                                                                                                                              | Has it, unchanged.                                                                                                        |
| `interact/first-person.js`                              | The walk's box (`FPB`) is 28.3 deep under headquarters.                                                                                                                                                                                                                                                  | Has `FPB` with it, **but** the port's own `floorBounds()` export (for the camera bar) has no headquarters branch. Task 2. |
| `ui/camera-bar.js`                                      | A separate table of views for headquarters (Desks is the wing).                                                                                                                                                                                                                                          | **Stand-in** with the company floor's table only. Task 3.                                                                 |
| `world/backdrops/street-life.js`, `shops.js`, `city.js` | The street's clearances for the longer building.                                                                                                                                                                                                                                                         | Not taken (the street is piece 8). Nothing to do here; piece 8 takes them with the HQ branches in place.                  |

Nothing else in the scene reads `HQ`. Two facts shape the piece:

1. **Who sits in a department room.** Not the staff. `net/live.js` `proDesk(s)` gives each _project_ (`s.git.repo`, else the last part of `s.dir`) an area: its own area if a desk is free, else where it sat before on this device (`localStorage` key `office-areas`), else the nearest empty area, preferring areas nobody else remembers, lowest index first. The area list is the six two-desk company-floor areas (index 0 to 5) and then the four rooms (6 to 9). So **the agents of a workspace sit in a room, and the first six areas fill before the first room does**: with fewer than seven areas in use the whole wing is empty. A workspace with three agents takes two areas (it spills to the nearest free one). A room has eight desks, so a room is also the place of a big team that has no area left. The staff scenes of piece 5 (`interns`, `hr`, `farewell`, `accountant`) work from a person's `s.desk` or `UNITS` and so work in any area; none of them sits anyone in a room. The roadmap's line "Its department rooms are filled by the staff of piece 5" is wrong as written: the rooms are filled by agents, through code the port already has.
2. **What the plugin must tell the scene.** Nothing new. The plugin already sends `dir: team` and `git: { repo: team }` where `team` is the room (workspace) name (`toSession` in `client/world/adapter.ts`), so a workspace is a project and `projOf` finds it. The door plaque shows that name (`world.dept.name`, `{name}`), the chip over the room shows it with the head count. No new field, no new call, nothing new leaves the host.

An **empty department** is what upstream draws: its carpet, eight desks with idle chairs and dark screens, the sprint board, credenza and plants, no chip, and a dark plaque reading `DEPARTMENT n` over `free for the next project`. When its last person leaves, `updateTeamTags` sends `''` to `DEPT_SIGNS[n]` and the plaque goes back to that.

**Size.** `wing.js` is 8,876 bytes of source: about 6,000 characters minified, plus no new asset, font, style or network call. The bundle was 1,146,019 characters in `server/world.generated.ts` at v0.1.0, against a cap of 1,200,000 in `server/world-script.test.ts`; earlier pieces will have moved both. The wing's own cost is small; the HQ branches that cost the rest are in the bundle already. **Memory** (an estimate to be measured in task 5): four plaque canvases (512 x 160), four sprint-board canvases (512 x 315 to 400), one plate, two corridor and four carpet textures (256 x 256): about 7 MB of GPU texture with mipmaps; a few hundred more meshes before `core/optimize.js` merges them; and, with a full floor, up to 44 people instead of 12 (the larger share). On a company floor or a cozy room the wing's code runs nothing: `setup()` returns at once and the texture canvases are never made.

## Decisions

| #   | Decision                                                                                                                                                                                                                                                                                                           | Reason                                                                                                                    | Cost if wrong                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Department assignment is upstream's, unchanged: `net/live.js` stays as upstream has it, and the plugin sends nothing about departments.                                                                                                                                                                            | The rule exists, is tested by upstream's use, and keeps `live.js` taken unchanged.                                        | A host with fewer than seven areas in use sees an empty wing, which looks unfinished. The README says when rooms fill. If the owner wants rooms used first, a hand change in `proDesk` (prefer `UNITS[u].dept >= 0` under `HQ`) is a later, small piece. |
| 2   | The roadmap's "filled by the staff of piece 5" is corrected: rooms hold agents; piece 5 is needed only so its desk-bound scenes (intern plates, HR's desk tabs, farewell boxes) are looked at under headquarters.                                                                                                  | Read from the code above.                                                                                                 | None; it is a correction.                                                                                                                                                                                                                                |
| 3   | `hq` seats 44: `PLAN_DESKS.hq = 44` (12 on the company floor plus 4 rooms x 8). A source-reading test guards the number against a newer my-office.                                                                                                                                                                 | `desks.js` builds 11 pods of four.                                                                                        | A wrong number seats too few or leaves a false "no desk" note.                                                                                                                                                                                           |
| 4   | The plan names come from two small helpers in `paseo-host.js`, `planOf` and `hasMeetingRoom`, not from inline tests in `paseo-entry.js`.                                                                                                                                                                           | `paseo-entry.js` can be loaded only once per test file and its mocks are long; a helper is tested alone.                  | Two exports more in one hand-written file.                                                                                                                                                                                                               |
| 5   | The "Stand-up notes" label over the meeting room's screen shows under headquarters too (`hasMeetingRoom('hq')` is true).                                                                                                                                                                                           | The company floor, with that screen at the same place, is the core of `hq`.                                               | The label would be missing on one plan.                                                                                                                                                                                                                  |
| 6   | The camera bar keeps its four views under headquarters and uses upstream's own headquarters table as factors of the fitted zoom: Desks is the wing's middle (3, 0.6, 18.2) at 1.6, Meeting room (-1.2, 0.6, -5.4) at 2.8, Servers (-5.6, 1.0, -0.6) at 3.3. Overview stays the fitted floor.                       | Upstream chose those places for this floor; the stand-in already treats upstream's numbers as factors of its fitted zoom. | The wing may be framed a little loose or tight in this app's frames; task 5 looks and the three numbers are tuned there.                                                                                                                                 |
| 7   | `floorBounds()` gets an `HQ` branch with the walk's own box `{ x0: -7.85, x1: 15.3, z0: -7.85, z1: 28.3 }`. Walk in's bounds need no other change: `FPB` and its grid are made from it and cover the wing.                                                                                                         | The camera bar fits the floor to these bounds; without the branch the Overview would cut the wing off.                    | Overview crops the wing. A test pins it.                                                                                                                                                                                                                 |
| 8   | The fitted zoom never falls under the HQ minimum of 0.36: computed 0.49 on 1280 x 800 and 1920 x 1080, 0.78 in a 600 x 700 column and 0.93 on a 390 x 844 phone (floor wider than the frame there, as the existing `COVER` allows). A test computes it with the renderer's own camera and fails if a frame clamps. | `fitFloor` clamps to `controls.minZoom`; a floor that cannot fit would be cropped.                                        | A frame shape that clamps shows a cropped floor.                                                                                                                                                                                                         |
| 9   | The Floor plan setting gains `hq` ("Headquarters"). The host settings version goes up by one with an identity migration, so a stored `pro` or `cozy` is kept as it is and an older client refuses a document that says `hq` rather than overwrite it.                                                              | A host that chose Company floor or Cozy room keeps it; nothing is rewritten.                                              | None to stored values.                                                                                                                                                                                                                                   |
| 10  | The bundle's size cap is not touched unless the build is over it. Growth from the wing must be under 15,000 characters (expected about 6,000); if the build is over the cap earlier pieces set, the cap becomes the measured length rounded up to the next 25,000, said in the commit.                             | The wing is small; the cap exists to catch a large module coming in by mistake.                                           | A cap raised by habit stops catching mistakes.                                                                                                                                                                                                           |
| 11  | On a phone, no limit and no per-device plan. The setting stays host-wide (the roadmap's decision) and its text says Headquarters is the largest floor and a phone may draw it more slowly. The owner's phone look decides whether a per-device "smaller floor" is wanted.                                          | The scene already runs its `low` quality on phones, and the cost is unmeasured on one.                                    | If a phone cannot draw it, the host must go back to Company floor for every device until a per-device choice is built (v0.7.1).                                                                                                                          |
| 12  | The department look is checked on a static page in `/tmp` that loads the built script and seats made-up agents (the throwaway daemon has none), not by a new in-repo harness.                                                                                                                                      | An in-repo harness is code to keep for one look.                                                                          | The look is not repeatable from the repo; the page's recipe is in task 5.                                                                                                                                                                                |
| 13  | A newer upstream's `wing.js` is taken by the same import tool run; nothing about the wing is changed by hand, so there is no `PASEO:` change to carry in it.                                                                                                                                                       | The file builds from `layout.js`, `pieces.js` and the stand-in `t()` alone.                                               | None.                                                                                                                                                                                                                                                    |

## Global Constraints

- Work in `/workspace/QFlavours/paseo-office` on a branch `feat/headquarters` cut from `main` after pieces 3 and 5 are merged. The repo is public: nothing private in files, fixtures or commit messages (fixtures use "Acme", `team-1`, made-up paths); no AI attribution on commits; never push, never `gh` (the controller publishes).
- my-office's files are taken unchanged wherever they can be. A change by hand starts with `// PASEO:` and is listed in `vendor/SOURCES.md`. The licence notice, the banner of the built scene and the README's link to https://github.com/khanh020905/my-office stay. No real brand's logo, name or tune.
- The scene never receives a file name, a command or a prompt, and makes no network call. This piece adds no data to the scene (the "What it reads and where it sends it" section of the README does not change).
- Only calls stock Paseo 0.16's SDK has. No daemon change.
- App-side code (`client/`, `shared/`) uses nothing a phone's engine lacks: `client/engine-compat.test.ts` must stay green. The vendored scene runs in the frame's own engine and is not covered by it.
- Styles in `client/styles.ts`, never inline objects. New logic stays out of `OfficeSurface` (lint complexity limit 20).
- Every task that changes `vendor/` ends with `npm run build:world` and the rebuilt `server/world.generated.ts` in the same commit, or the "is what the build makes" test fails.
- The import tool is run against the vendored commit only. Check first: `git -C /tmp/ref-office/my-office rev-parse HEAD` must print `b68228871fe30cd2c759a2c919337a9a9d1f5644` (the `upstream.commit` of `vendor/my-office/MANIFEST.json`), and `/tmp/ref-office/three/node_modules/three/package.json` must say `0.160.0`. If the clone is missing: `git clone https://github.com/khanh020905/my-office /tmp/ref-office/my-office && git -C /tmp/ref-office/my-office checkout b68228871fe30cd2c759a2c919337a9a9d1f5644`, and `npm install --prefix /tmp/ref-office/three three@0.160.0`.
- Never run a bare `paseo` command and never start, stop or restart the daemon on port 6767. A throwaway daemon uses `PASEO_HOME=/tmp/office-stock-home`, port 6798, `env -i`, and the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`.
- Checks after each task: `npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts`, and the test files touched; the whole suite (`npm test -- --maxWorkers=4`, output to a file under /tmp) before each commit.

## Assumes from earlier pieces

Re-check each when this piece's turn comes; where a name differs, use the real name throughout.

- **Piece 3 (floor plans, part 1)** is merged: `shared/settings.ts` has a host setting `floorPlan` on `officeHostSettings` (`z.enum(["pro", "cozy"]).default("pro")`, version raised to 5, identity migration for older versions); `client/host-switches.tsx` (or the settings page) has a control labelled "Floor plan" with the choices "Company floor" and "Cozy room"; `client/world/use-world-feed.ts` no longer has the constant `PLAN = "pro"` but takes the plan from that setting and passes it to `worldStartOptions`, and a changed plan restarts the scene; `PLAN_DESKS` in `client/world/adapter.ts` still maps a plan to its desk count; `docs/office.md` says how many desks each plan has. `paseo-entry.js` line `host.plan = options.plan === 'cozy' ? 'cozy' : 'pro';` and the line `if (host.plan === 'pro' && host.notes) makeNotesLabel();` are as at v0.1.0. `world-api.ts`'s `WorldStartOptions.plan` is `"pro" | "cozy"`.
- **Piece 4 (camera extras)** left `ui/camera-bar.js` a stand-in that starts `// PASEO: stand-in` and has `VIEWS`, `goView` and `fitFloor` as at v0.1.0 (it may have added buttons and the automatic camera's module). If piece 4 took upstream's own `ui/camera-bar.js`, it already has the headquarters table: skip task 3's code, keep its test for the four views, and say so in the commit.
- **Piece 5 (staff and daily life, indoors)** is merged: `world/layout.js` and `world/desks.js` are still upstream's unchanged (checked: the staff scenes read `s.desk` and `UNITS`, never `HQ`); `net/live.js` is still upstream's unchanged; the bundle test's upper size limit is whatever piece 5 set; `vendor/SOURCES.md` has a section for the staff scenes, and its sentences below may have been reworded (keep their meaning).
- **Pieces 2 and 7** do not touch headquarters. Piece 7's `life/seasons.js` loops over every desk (`for (const d of DESKS)`), which is 44 under headquarters and needs nothing.

## Not verifiable until built

| What                                                                                                                                                                  | How the task finds out                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| That the frames of the app fit Overview, and that Desks, Meeting room and Servers frame their places well on the longer floor (the zoom is computed, the look is not) | Task 5 looks at 1280 and 390 px; the three factors are tuned in `HQ_VIEWS` if a place is cut |
| The door plaques with a long or non-Latin workspace name (`fitText` shrinks by width; the glyphs depend on the frame's fonts)                                         | Task 5 seats a workspace with a long name                                                    |
| That a seventh workspace takes the first room, as read from `proDesk`                                                                                                 | Task 5 reads `localStorage['office-areas']` on the static page after seating eight teams     |
| Memory and speed of 44 people on a phone, and on the app's script frame                                                                                               | Task 5 measures the JS heap and the frame rate on desktop; the phone is the owner's look     |
| That `localStorage` inside the app's frame keeps which team sits where (it does inside a `srcdoc` frame on desktop; unseen on the store app)                          | The owner's look: leave the office and come back, the rooms keep their projects              |
| Whether the wing's walking graph (`wingGraph()`) lets a person walk from a room to the lounge and back                                                                | Task 5 on the static page: send events and watch a person from a room walk                   |

---

### Task 1: Take upstream's wing

**Files:**

- Modify: `vendor/my-office/import-upstream.mjs`, `vendor/my-office/src/office/paseo-modules.js` (written by the tool), `vendor/my-office/MANIFEST.json` (written by the tool), `vendor/SOURCES.md`, `server/world.generated.ts` (built), `server/world-script.test.ts`
- Delete: `vendor/my-office/src/office/world/pro/wing.js` (the stand-in), then recreated by the tool from upstream
- Test: `server/world-script.test.ts`

**Interfaces:**

- Consumes: the import tool's rules (a file whose path leaves `DENY` is taken; a file at a `DENY` path is never written; a file that carries `PASEO:` is never overwritten, which is why the stand-in must be deleted first).
- Produces: `world/pro/wing.js` exporting `DEPT_SIGNS` (an array that `setup()` fills with one function per room: `DEPT_SIGNS[i](name)`) and `setup()`; a module `worldProWing` in `MODULES` after `worldProFloor`. `net/live.js` already imports `DEPT_SIGNS` from this path.

- [ ] **Step 1: A clean baseline for the tool**

```bash
cd /workspace/QFlavours/paseo-office && git switch -c feat/headquarters
node vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check | tee /tmp/hq-tool-before.txt
wc -c server/world.generated.ts | tee /tmp/hq-size-before.txt
```

Expected: `would write: 0, unchanged: <n>`, a `kept (carry a PASEO: note…)` list (the hand-changed files: `core/env.js`, `interact/first-person.js`, `interact/place-cards.js`, `life/tests.js`, `ui/photo.js`, and whatever pieces 2 to 5 added), and no `stand-ins to write or extend` lines. If it would write something, stop: the vendor tree is not at a clean upstream state and that is a finding for the controller.

- [ ] **Step 2: Write the failing test**

Add to `server/world-script.test.ts`, in the second `describe`, after the first-person test:

```ts
it("takes upstream's headquarters wing, not a stand-in", () => {
  const wing = readFileSync(
    new URL("../vendor/my-office/src/office/world/pro/wing.js", import.meta.url),
    "utf8",
  );
  const manifest = JSON.parse(
    readFileSync(new URL("../vendor/my-office/MANIFEST.json", import.meta.url), "utf8"),
  ) as { files: Record<string, string>; standIns: Record<string, string[]>; setupOrder: string[] };
  const tool = readFileSync(
    new URL("../vendor/my-office/import-upstream.mjs", import.meta.url),
    "utf8",
  );

  expect(wing).not.toContain("stand-in");
  expect(wing).toContain("function buildWing");
  expect(manifest.files["office/world/pro/wing.js"]).toMatch(/^[0-9a-f]{64}$/);
  expect(manifest.standIns["office/world/pro/wing.js"]).toBeUndefined();
  // Upstream starts the wing right after the company floor's pieces.
  const order = manifest.setupOrder;
  expect(order.indexOf("office/world/pro/wing.js")).toBe(
    order.indexOf("office/world/pro/floor.js") + 1,
  );
  expect(tool).not.toContain("pro\\/wing");
  // The door plaques and the wing's sign are drawn by the wing's own code.
  expect(WORLD_SCRIPT).toContain("world.dept.name");
  expect(WORLD_SCRIPT).toContain("world.dept.hqSub");
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `npx vitest run server/world-script.test.ts -t "headquarters wing"`
Expected: FAIL at `expect(wing).not.toContain("stand-in")` (the stand-in's first line is `// PASEO: stand-in for my-office's world/pro/wing.js…`).

- [ ] **Step 4: Let the tool take the file**

In `vendor/my-office/import-upstream.mjs`, in the `DENY` list, delete the line

```js
  /^office\/world\/pro\/wing\.js$/,
```

and nothing else in the list. Then delete the stand-in and run the tool with `--check`:

```bash
git rm vendor/my-office/src/office/world/pro/wing.js
node vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check
```

Expected: `would write: 2` (`world/pro/wing.js` and `paseo-modules.js`); the `kept` list exactly as in `/tmp/hq-tool-before.txt`; no `stand-ins to write or extend` lines. What each report means: a longer write list means wing.js imported a file the port does not have yet (the tool takes it; read each new file for `process.env`, network calls, DOM ids and denied imports before going on); a line under `stand-ins to write or extend` for a path wing.js imports means a denied module now needs an export (none is expected: wing.js imports only `core/env.js`, `scene/renderer.js`, `scene/blocks.js`, `world/terrace.js`, `world/windows.js`, `world/furniture/room-pieces.js`, `world/props/trinkets.js`, `world/layout.js`, `world/pro/pieces.js` and `i18n/index.js`, all taken or already stood in with `t`).

- [ ] **Step 5: Run the tool for real and read the result**

```bash
node vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three
git status --short
git diff --stat
diff vendor/my-office/src/office/world/pro/wing.js /tmp/ref-office/my-office/src/office/world/pro/wing.js
git diff vendor/my-office/src/office/paseo-modules.js vendor/my-office/MANIFEST.json
```

Expected: new `world/pro/wing.js`; `diff` shows exactly one changed line, line 4, `import * as THREE from 'three';` rewritten to `'../../../../three/three.module.min.js'`; `paseo-modules.js` gains `import * as worldProWing from './world/pro/wing.js';` and `['worldProWing', worldProWing],` right after `worldProFloor`; `MANIFEST.json` gains `office/world/pro/wing.js` in `setupOrder` (after `office/world/pro/floor.js`) and in `files`, and loses its `standIns` entry (`DEPT_SIGNS`); `upstream.commit` is unchanged. Any other changed file is a surprise: stop and read it.

What upstream's page markup, CSS, assets, `process.env` and network calls expect: none. `wing.js` makes canvases with `document.createElement('canvas')` and three.js textures, reads no element by id, no style rule, no asset or font file (the font name `"Be Vietnam Pro", system-ui` falls back to the system's, as `world/pro/pieces.js`'s plates already do), has no `process.env` and no request. Check with `grep -n "process.env\|fetch(\|XMLHttp\|getElementById\|querySelector\|\$(" vendor/my-office/src/office/world/pro/wing.js` (expect no match).

- [ ] **Step 6: Build, measure, test**

```bash
npm run build:world
wc -c server/world.generated.ts | tee /tmp/hq-size-after.txt
cat /tmp/hq-size-before.txt /tmp/hq-size-after.txt
npx vitest run server/world-script.test.ts
```

Expected: the file grows by more than 4,000 and less than 15,000 characters (about 6,000 expected). The world-script tests pass, including the new one and the size window. If the length is over the cap set by piece 5, apply Decision 10; if growth is over 15,000, find what else came in (`git diff --stat` for the vendor tree).

- [ ] **Step 7: Say it in `vendor/SOURCES.md`**

Under "What is taken", in the sentence that starts "The scene: the floor plans, the furniture", make it read "the floor plans (the company floor, the cozy room and headquarters, whose wing of department rooms is `world/pro/wing.js`), the furniture". The stand-in table has no row for the wing, so nothing is removed there. Under "What is not taken" nothing named the wing, so nothing changes there.

- [ ] **Step 8: Check and commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
npm test -- --maxWorkers=4 > /tmp/hq-t1.txt 2>&1; tail -5 /tmp/hq-t1.txt
git add -A && git commit -m "feat: take my-office's headquarters wing"
```

The wing is in the bundle but draws nothing yet: `setup()` builds it only when `HQ`, and `core/env.js` still refuses `hq`.

---

### Task 2: The scene accepts the `hq` plan

**Files:**

- Modify: `vendor/my-office/src/office/core/env.js`, `vendor/my-office/src/office/paseo-host.js`, `vendor/my-office/src/office/paseo-entry.js`, `vendor/my-office/src/office/interact/first-person.js`, `vendor/SOURCES.md`, `server/world.generated.ts` (built)
- Test: create `client/world/plan.test.ts`; modify `client/world/first-person.test.ts`

**Interfaces:**

- Consumes: Task 1's wing (its `setup()` builds the wing when `HQ` is true).
- Produces, in `paseo-host.js`:

```js
/** The plans the plugin may ask for: the company floor, one open room, headquarters. Anything else is the company floor. */
export const planOf = (value) => (value === "cozy" || value === "hq" ? value : "pro");
/** The company floor's meeting room, with the screen the Stand-up notes label stands on, is in every plan but the open room. */
export const hasMeetingRoom = (plan) => plan !== "cozy";
```

and `floorBounds()` in `interact/first-person.js` returning `{ x0: -7.85, x1: 15.3, z0: -7.85, z1: 28.3 }` under headquarters.

- [ ] **Step 1: Write the failing tests**

Create `client/world/plan.test.ts`:

```ts
// @vitest-environment jsdom
// The floor plan the scene takes: which plans the entry accepts and what core/env.js makes of each.
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import * as env from "../../vendor/my-office/src/office/core/env.js";
// @ts-expect-error vendored JavaScript has no declarations
import { hasMeetingRoom, host, planOf } from "../../vendor/my-office/src/office/paseo-host.js";

beforeEach(() => {
  document.body.innerHTML = '<div id="stage"></div>';
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  host.plan = "pro";
});

test.each([
  ["pro", true, false],
  ["cozy", false, false],
  ["hq", true, true],
])("the plan %s is the layout, PRO %s and HQ %s", (plan, pro, hq) => {
  host.plan = plan;
  env.setup();

  expect(env.LAYOUT).toBe(plan);
  expect(env.PRO).toBe(pro);
  expect(env.HQ).toBe(hq);
});

test("a plan the scene does not know is the company floor", () => {
  host.plan = "tower";
  env.setup();

  expect(env.LAYOUT).toBe("pro");
  expect(env.HQ).toBe(false);
});

test("the entry accepts the three plans and nothing else", () => {
  expect(planOf("pro")).toBe("pro");
  expect(planOf("cozy")).toBe("cozy");
  expect(planOf("hq")).toBe("hq");
  expect(planOf("tower")).toBe("pro");
  expect(planOf(undefined)).toBe("pro");
});

test("the meeting room, and the label over its screen, are in every plan but the open room", () => {
  expect(hasMeetingRoom("pro")).toBe(true);
  expect(hasMeetingRoom("hq")).toBe(true);
  expect(hasMeetingRoom("cozy")).toBe(false);
});

test("core/env.js no longer refuses headquarters, and the entry uses the helpers", () => {
  const dir = "../../vendor/my-office/src/office/";
  const envText = readFileSync(new URL(`${dir}core/env.js`, import.meta.url), "utf8");
  const entry = readFileSync(new URL(`${dir}paseo-entry.js`, import.meta.url), "utf8");

  expect(envText).not.toContain("!== 'hq'");
  expect(entry).toContain("host.plan = planOf(options.plan)");
  expect(entry).toContain("hasMeetingRoom(host.plan) && host.notes");
});
```

Add at the end of `client/world/first-person.test.ts` (last in the file: it calls `env.setup()`, which sets the plan for the rest of the file):

```ts
test("the floor's bounds follow the plan, and headquarters' include the wing", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  // @ts-expect-error vendored JavaScript has no declarations
  const env = await import("../../vendor/my-office/src/office/core/env.js");
  // @ts-expect-error vendored JavaScript has no declarations
  const { host } = await import("../../vendor/my-office/src/office/paseo-host.js");
  const bounds: Record<string, unknown> = {};
  for (const plan of ["cozy", "pro", "hq"]) {
    host.plan = plan;
    env.setup();
    bounds[plan] = walk.floorBounds();
  }

  expect(bounds.cozy).toEqual({ x0: -7.85, x1: 11.7, z0: -5.85, z1: 10.3 });
  expect(bounds.pro).toEqual({ x0: -7.85, x1: 15.3, z0: -7.85, z1: 11.3 });
  expect(bounds.hq).toEqual({ x0: -7.85, x1: 15.3, z0: -7.85, z1: 28.3 });
  // The walk's own box (setup's FPB) says the same: both lines name 28.3.
  const text = readFileSync(
    new URL("../../vendor/my-office/src/office/interact/first-person.js", import.meta.url),
    "utf8",
  );
  expect(text.match(/z1: 28\.3/g)).toHaveLength(2);
  vi.unstubAllGlobals();
});
```

(Add `import { readFileSync } from "node:fs";` to that file's imports.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/world/plan.test.ts client/world/first-person.test.ts`
Expected: FAIL: `planOf` and `hasMeetingRoom` are not exported (the import gives `undefined`), `env.HQ` stays false for `hq`, and `floorBounds()` gives the company floor's box under `hq`.

- [ ] **Step 3: The change in `core/env.js`**

Find the text

```js
// PASEO: upstream reads the plan from the address and the browser's storage; Paseo names it.
LAYOUT = PLANS.includes(host.plan) && host.plan !== "hq" ? host.plan : "pro";
```

It becomes

```js
// PASEO: upstream reads the plan from the address and the browser's storage; Paseo names it, and offers all three plans.
LAYOUT = PLANS.includes(host.plan) ? host.plan : "pro";
```

The reason: the plan is the host's setting, and headquarters is offered from this release. The comment above (`'hq' (headquarters: …)`) stays as upstream wrote it.

- [ ] **Step 4: The helpers in `paseo-host.js`**

Replace the `plan` field's doc comment and add the two functions above `host`:

```js
/** The plans the plugin may ask for: the company floor, one open room, headquarters. Anything else is the company floor. */
export const planOf = (value) => (value === 'cozy' || value === 'hq' ? value : 'pro');
/** The company floor's meeting room, with the screen the Stand-up notes label stands on, is in every plan but the open room. */
export const hasMeetingRoom = (plan) => plan !== 'cozy';

export const host = {
  /** 'pro' (the company floor), 'cozy' (one open room) or 'hq' (headquarters: the company floor and a wing of department rooms). */
  plan: 'pro',
```

- [ ] **Step 5: The entry**

In `paseo-entry.js`:

1. The import `import { host } from './paseo-host.js';` becomes `import { hasMeetingRoom, host, planOf } from './paseo-host.js';`.
2. In `start()`, `host.plan = options.plan === 'cozy' ? 'cozy' : 'pro';` becomes `host.plan = planOf(options.plan);`.
3. `if (host.plan === 'pro' && host.notes) makeNotesLabel();` becomes `if (hasMeetingRoom(host.plan) && host.notes) makeNotesLabel();`.
4. In the doc comment of `start`, `plan ('pro' | 'cozy')` becomes `plan ('pro' | 'cozy' | 'hq')`.

- [ ] **Step 6: The walk's `floorBounds`**

In `interact/first-person.js`, find

```js
// PASEO: the floor's bounds, which ui/camera-bar.js fits the camera to.
/** The floor people walk on, in the scene's units. */
export const floorBounds = () =>
  PRO ? { x0: -7.85, x1: 15.3, z0: -7.85, z1: 11.3 } : { x0: -7.85, x1: 11.7, z0: -5.85, z1: 10.3 };
```

It becomes

```js
// PASEO: the floor's bounds, which ui/camera-bar.js fits the camera to; headquarters' is the walk's own box in setup().
/** The floor people walk on, in the scene's units. */
export const floorBounds = () =>
  HQ
    ? { x0: -7.85, x1: 15.3, z0: -7.85, z1: 28.3 }
    : PRO
      ? { x0: -7.85, x1: 15.3, z0: -7.85, z1: 11.3 }
      : { x0: -7.85, x1: 11.7, z0: -5.85, z1: 10.3 };
```

`HQ` is already imported on that file's line 7. The walk's grid and its bounds (`FPB`, set in `setup()`) already include the wing, so nothing else changes there.

- [ ] **Step 7: `vendor/SOURCES.md`**

In the list of hand-changed files: the `core/env.js` bullet ends "…and the floor plan comes from Paseo, not from the page's address and storage": add ", and all three plans are accepted (the company floor, the cozy room and headquarters)". The `interact/first-person.js` bullet ends "`floorBounds` is exported for the camera bar": add ", with a box for headquarters". In the sentence that lists Paseo's own files, `paseo-host.js` ("what the stand-ins read and call") gains "and the two small rules about the plan, `planOf` and `hasMeetingRoom`".

- [ ] **Step 8: Run, build, check, commit**

```bash
npx vitest run client/world/plan.test.ts client/world/first-person.test.ts client/world/entry.test.ts
npm run build:world
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
npm test -- --maxWorkers=4 > /tmp/hq-t2.txt 2>&1; tail -5 /tmp/hq-t2.txt
git add -A && git commit -m "feat: the scene draws headquarters when asked for the hq plan"
```

---

### Task 3: The camera bar's views and fit on the larger floor

**Files:**

- Modify: `vendor/my-office/src/office/ui/camera-bar.js`, `vendor/SOURCES.md`, `server/world.generated.ts` (built)
- Test: `client/world/camera-bar.test.ts`

**Interfaces:**

- Consumes: `host.plan` (set by the entry: `'pro' | 'cozy' | 'hq'`) and `floorBounds()` from Task 2.
- Produces: under `host.plan === 'hq'` the buttons `data-view="desks" | "meeting" | "server"` go to upstream's headquarters places; `data-view="home"` is the fitted floor, whole at the frame sizes below.

(If piece 4 took upstream's own `ui/camera-bar.js`, see "Assumes": keep the tests, skip step 3, and note it.)

- [ ] **Step 1: Write the failing tests**

In `client/world/camera-bar.test.ts`:

1. In the hoisted block add `bounds: { x0: -7.85, x1: 15.3, z0: -7.85, z1: 11.3 },` and change the mock `floorBounds: () => ({ x0: -7.85, x1: 15.3, z0: -7.85, z1: 11.3 })` to `floorBounds: () => h.bounds`.
2. After the existing `const { camera, controls, fpCam } = await import(".../scene/renderer.js");` add

```ts
// @ts-expect-error vendored JavaScript has no declarations
const { host } = await import("../../vendor/my-office/src/office/paseo-host.js");
// @ts-expect-error vendored JavaScript has no declarations
const THREE = await import("../../vendor/my-office/three/three.module.min.js");

const COMPANY = { x0: -7.85, x1: 15.3, z0: -7.85, z1: 11.3 };
const HQ_BOUNDS = { x0: -7.85, x1: 15.3, z0: -7.85, z1: 28.3 };

/** The mock camera as the company floor's test frame has it. */
function companyCamera(): void {
  camera.left = -20;
  camera.right = 20;
  camera.top = 15;
  camera.bottom = -15;
  camera.position.set(20, 20, 20);
  controls.target.set(0, 0, 0);
  controls.minZoom = 0.5;
  camera.zoom = 1;
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
}

/**
 * The camera scene/renderer.js makes for headquarters in a frame of this size: its resize() frustum, its
 * position over home (3, 0.3, 9), its base zoom and its smallest zoom.
 */
function headquartersCamera(width: number, height: number): void {
  const aspect = width / height;
  const s = Math.max(8.8, 12 / aspect);
  camera.left = -s * aspect;
  camera.right = s * aspect;
  camera.top = s;
  camera.bottom = -s;
  camera.position.set(3 + 19, 0.3 + 23, 9 + 19);
  controls.target.set(3, 0.3, 9);
  controls.minZoom = 0.36;
  camera.zoom = 0.56;
  camera.lookAt(3, 0.3, 9);
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
}

/** The extent of the floor's box on the screen, in -1..1 units, as fitFloor measures it. */
function extent(b: typeof HQ_BOUNDS): { x0: number; x1: number; y0: number; y1: number } {
  const corner = new THREE.Vector3();
  const out = { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity };
  for (const x of [b.x0 - 1.5, b.x1 + 1.5]) {
    for (const y of [-1.3, 3.4]) {
      for (const z of [b.z0 - 1.5, b.z1 + 1.5]) {
        corner.set(x, y, z).project(camera);
        out.x0 = Math.min(out.x0, corner.x);
        out.x1 = Math.max(out.x1, corner.x);
        out.y0 = Math.min(out.y0, corner.y);
        out.y1 = Math.max(out.y1, corner.y);
      }
    }
  }
  return out;
}
```

3. In `beforeEach` add `h.bounds = COMPANY; host.plan = "pro"; companyCamera();` (`h.bounds` is assigned, so declare it `bounds: {...} as typeof COMPANY` in the hoisted block, or move the two constants into it).
4. Add the tests:

```ts
test("under headquarters Desks looks at the wing, and Meeting room and Servers are seen from further in", () => {
  host.plan = "hq";
  h.bounds = HQ_BOUNDS;
  open();
  const fitted = camera.zoom;
  const goal = (factor: number) =>
    Math.min(controls.maxZoom, Math.max(controls.minZoom, fitted * factor));

  click("[data-view=desks]");
  expect(h.set).toHaveBeenLastCalledWith(3, 0.6, 18.2);
  expect(state.zoomGoal).toBeCloseTo(goal(1.6));
  click("[data-view=meeting]");
  expect(h.set).toHaveBeenLastCalledWith(-1.2, 0.6, -5.4);
  expect(state.zoomGoal).toBeCloseTo(goal(2.8));
  click("[data-view=server]");
  expect(h.set).toHaveBeenLastCalledWith(-5.6, 1.0, -0.6);
  expect(state.zoomGoal).toBeCloseTo(goal(3.3));
});

test("the other plans keep the company floor's places", () => {
  host.plan = "cozy";
  open();
  click("[data-view=desks]");

  expect(h.set).toHaveBeenLastCalledWith(2.3, 0.6, 3.6);
});

test.each([
  ["a 1280 x 800 frame", 1280, 800],
  ["a 1920 x 1080 frame", 1920, 1080],
  ["a 600 x 700 column", 600, 700],
])(
  "Overview fits the whole of headquarters in %s, above the smallest zoom",
  (_name, width, height) => {
    host.plan = "hq";
    h.bounds = HQ_BOUNDS;
    headquartersCamera(width, height);
    open();

    expect(camera.zoom).toBeGreaterThanOrEqual(0.36);
    const seen = extent(HQ_BOUNDS);
    for (const value of [seen.x0, seen.x1, seen.y0, seen.y1]) {
      expect(Math.abs(value)).toBeLessThanOrEqual(1 + 1e-6);
    }
  },
);

test("on a phone held upright Overview fills the height of headquarters, and a finger moves along the width", () => {
  host.plan = "hq";
  h.bounds = HQ_BOUNDS;
  headquartersCamera(390, 844);
  open();

  expect(camera.zoom).toBeGreaterThanOrEqual(0.36);
  const seen = extent(HQ_BOUNDS);
  expect(Math.abs(seen.y0)).toBeLessThanOrEqual(1 + 1e-6);
  expect(Math.abs(seen.y1)).toBeLessThanOrEqual(1 + 1e-6);
});
```

(The numbers these expect were computed with the vendored three on 2026-11-19: the fitted zoom is 0.49, 0.49, 0.78 and 0.93 in the four frames.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/world/camera-bar.test.ts`
Expected: FAIL, the headquarters Desks test (it gets `(2.3, 0.6, 3.6)`); the fit tests already pass because `fitFloor` reads `floorBounds()`, which is the point of keeping them (they pin the fit against a later change). If a fit test fails, a frame clamps: that is Decision 8's finding, so raise it with the controller before going on.

- [ ] **Step 3: The views**

In `ui/camera-bar.js`, after the `VIEWS` constant add

```js
/**
 * PASEO: headquarters' places, upstream's own table for that plan (ui/camera-bar.js there): Desks is the wing's middle,
 * and the floor is longer, so the other two are looked at from further in. Factors of the fitted zoom, as above.
 */
const HQ_VIEWS = {
  desks: { t: [3, 0.6, 18.2], z: 1.6 },
  meeting: { t: [-1.2, 0.6, -5.4], z: 2.8 },
  server: { t: [-5.6, 1.0, -0.6], z: 3.3 },
};
```

and in `goView` change `const V = VIEWS[view];` to `const V = (host.plan === 'hq' ? HQ_VIEWS : VIEWS)[view];`. `host` is already imported there. Update the comment above `VIEWS` ("Upstream's views for the company floor") to "Upstream's views for the company floor (and, below, for headquarters)" only if it reads wrongly after the change; leave it otherwise.

- [ ] **Step 4: `vendor/SOURCES.md`**

In the stand-in table, the `ui/camera-bar.js` row ends "…the other three views are upstream's places": it becomes "…the other three views are upstream's places, with upstream's own for headquarters".

- [ ] **Step 5: Run, build, check, commit**

```bash
npx vitest run client/world/camera-bar.test.ts client/world/first-person.test.ts
npm run build:world
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
npm test -- --maxWorkers=4 > /tmp/hq-t3.txt 2>&1; tail -5 /tmp/hq-t3.txt
git add -A && git commit -m "feat: the camera bar's views and fit on headquarters' longer floor"
```

---

### Task 4: The plugin's side: desks, the plan's name, the setting, the docs

**Files:**

- Modify: `client/world/adapter.ts`, `client/world/world-api.ts`, `shared/settings.ts`, the file that draws the Floor plan choice (find it: `grep -rn "Cozy room" client`; `client/host-switches.tsx` or the settings page), `README.md`, `docs/office.md`
- Test: `client/world/adapter.test.ts`, `shared/settings.test.ts`, `client/host-switches.mounted.test.tsx` (or the mounted test that covers the control)

**Interfaces:**

- Consumes: piece 3's `floorPlan` field and control (see "Assumes").
- Produces: `PLAN_DESKS.hq === 44`; `WorldPlan` and `WorldStartOptions["plan"]` both include `"hq"`; `floorPlan` accepts `"hq"` and the host settings version is one higher than piece 3 left it, with an identity migration; the control offers Company floor, Cozy room, Headquarters.

- [ ] **Step 1: Write the failing tests**

`client/world/adapter.test.ts`, after the existing `worldPeople` tests (reuse the file's own `agent` and `office` builders, as the cozy test at "const resting = Array.from({ length: PLAN_DESKS.cozy }…" does):

```ts
test("headquarters has 44 desks: the company floor's 12 and eight in each of four rooms", () => {
  expect(PLAN_DESKS.hq).toBe(44);
  const everyone = Array.from({ length: PLAN_DESKS.hq + 1 }, (_, index) =>
    agent(String(index + 1)),
  );
  const { sessions, overflow } = worldPeople(buildOfficeModel(office(everyone)), PLAN_DESKS.hq);

  expect(sessions).toHaveLength(44);
  expect(overflow).toBe(1);
});

test("the plan the scene is started with can be any plan the desks are counted for", () => {
  const plans: WorldStartOptions["plan"][] = ["pro", "cozy", "hq"];
  const counted: WorldPlan[] = plans;

  expect(counted.map((plan) => PLAN_DESKS[plan])).toEqual([12, 9, 44]);
});

test("each plan's desk count is the scene's own", () => {
  const read = (file: string) =>
    readFileSync(
      new URL(`../../vendor/my-office/src/office/world/${file}`, import.meta.url),
      "utf8",
    );
  const desks = read("desks.js");
  const layout = read("layout.js");

  // Three company-floor pods of four desks, and each room a unit of eight desks after them.
  expect(desks).toContain("[0, 1, 2].flatMap((p) =>");
  expect(desks).toContain("range(12 + i * 8, 8)");
  expect(layout.match(/\bdoor: \{ side:/g)).toHaveLength(4);
  // Four desks to a pod: the open floor's three and the rooms' two each.
  expect(desks).toContain("[[-1, -1], [1, -1], [-1, 1], [1, 1]]");
  expect(layout).toContain("pods: [[d.cx - 2.65");
});
```

Imports needed: `readFileSync` from `node:fs`; `WorldPlan` from `./adapter.js`; `WorldStartOptions` from `./world-api.js`.

`shared/settings.test.ts`, near the other host settings tests (the `version` expectation is the one piece 3 wrote; `PIECE3` below is its value, 5 by assumption, so this test says `PIECE3 + 1`):

```ts
test("the floor plan can be headquarters, and a stored company floor or cozy room stays", async () => {
  expect(officeHostSettings.schema.parse({ floorPlan: "hq" }).floorPlan).toBe("hq");
  expect(officeHostSettings.schema.parse({}).floorPlan).toBe("pro");
  expect(hostIssues({ floorPlan: "tower" })).not.toEqual([]);
  for (const kept of ["pro", "cozy"] as const) {
    const stored = { agentTools: true, floorPlan: kept };
    expect(await upgraded(stored, 5)).toMatchObject({ floorPlan: kept });
  }
  expect(officeHostSettings.version).toBe(6);
});
```

`client/host-switches.mounted.test.tsx` (or the file that holds piece 3's test of the control; read how it presses a choice and use that helper):

```ts
test("the Floor plan offers Company floor, Cozy room and Headquarters, and a press saves the plan", async () => {
  await mount();

  expect(floorPlanChoices()).toEqual(["Company floor", "Cozy room", "Headquarters"]);
  await pressFloorPlan("Headquarters");
  expect(saved.at(-1)?.values).toEqual({ ...stored, floorPlan: "hq" });
});

test("the Floor plan says Headquarters is the largest floor and a phone may draw it more slowly", async () => {
  await mount();

  expect(container.textContent).toContain(
    "Headquarters is the largest floor: a phone may draw it more slowly.",
  );
});
```

(`floorPlanChoices` and `pressFloorPlan` are the names to give two small helpers in that file if piece 3 did not write them: the first reads the labels of the control's buttons in order, the second clicks the one with a given label inside `act`, as `pressDay` does for the stand-up days.)

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/world/adapter.test.ts shared/settings.test.ts client/host-switches.mounted.test.tsx`
Expected: FAIL: `PLAN_DESKS.hq` is undefined, `"hq"` is not assignable (a type error that vitest does not show; `npm run typecheck` does), `floorPlan: "hq"` is refused, the version is 5, and the control has two choices.

- [ ] **Step 3: Implement**

1. `client/world/adapter.ts`: `export const PLAN_DESKS = { pro: 12, cozy: 9 } as const;` becomes

```ts
/**
 * Desks of each floor plan of the vendored scene: the company floor's three pods of four, the open room's three
 * rows of three, and headquarters' twelve with eight in each of four department rooms.
 */
export const PLAN_DESKS = { pro: 12, cozy: 9, hq: 44 } as const;
```

(keep the existing one-line comment's first sentence if it still reads right). `floorNote` needs no change: "no desk on this floor" is true of each plan. 2. `client/world/world-api.ts`: `plan: "pro" | "cozy";` in `WorldStartOptions` becomes

```ts
/** The floor plan: the company floor, one open room, or headquarters (the company floor and a wing of department rooms). */
plan: "pro" | "cozy" | "hq";
```

3. `shared/settings.ts`: add `"hq"` to the `floorPlan` enum's list (after `"cozy"`); raise `version` of `officeHostSettings` by one; extend the comment above `migrate` with one sentence ("Before version 6 the floor plan had no headquarters: what a document has stays."); `migrate` stays identity for this step (the existing `fromVersion < 4` branch is unchanged).
4. The Floor plan control: add the choice `{ value: "hq", label: "Headquarters" }` after Cozy room in the same list and shape piece 3 used, and put the line `Headquarters is the largest floor: a phone may draw it more slowly.` where piece 3 put the control's description (a `Text` under the row with the style the other descriptions use, in `client/styles.ts`; add no new style if one fits).
5. `docs/office.md`: find the sentence "The floor has 12 desks." (piece 3 will have made it name the plans) and make it read: "The company floor has 12 desks, the cozy room 9 and headquarters 44: the company floor's 12 and eight in each of four department rooms. Floor plan is a host setting for the 3D floor only; the 2D floor keeps its own room." Then add after the paragraph about teams: "Under headquarters a workspace takes an area as it does on the company floor: first the six two-desk areas of the company floor (a team of three or more takes a second area), then one of the four department rooms, whose door says the workspace's name and `free for the next project` while it is empty. With fewer than seven areas in use the wing is empty. Which area a workspace had is remembered on each device."
6. `README.md`: in "What it does", the bullet about the floor gains "in one of three floor plans (Company floor, Cozy room, Headquarters, which adds four department rooms)" (keep the bullet's other words; if piece 3 wrote a floor-plan sentence, extend it instead of adding one).

- [ ] **Step 4: Run, check, commit**

```bash
npx vitest run client/world/adapter.test.ts shared/settings.test.ts client/host-switches.mounted.test.tsx client/engine-compat.test.ts
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
npm test -- --maxWorkers=4 > /tmp/hq-t4.txt 2>&1; tail -5 /tmp/hq-t4.txt
git add -A && git commit -m "feat: Headquarters in the Floor plan setting, with its 44 desks"
```

---

### Task 5: A look, and what was seen

**Files:**

- Modify: `docs/verified.md`, `README.md`, `docs/office.md`

**Interfaces:**

- Consumes: Tasks 1 to 4 at the branch's last commit.
- Produces: the record of what was seen and not seen; the numbers measured.

- [ ] **Step 1: A stock daemon with the branch installed**

As `docs/verified.md` describes the earlier looks and piece 1's plan Task 7 did: a clean `/tmp/office-stock-home`, the published 0.16.2 daemon on port 6798 with `env -i`, the plugin installed by Git from the local repo at the branch's commit. `daemon status` must show 6798 and that home before any plugin command. Never touch 6767.

- [ ] **Step 2: Look at the empty wing, at 1280 and 390 px**

The daemon has no provider and no agent. Seen there: on the plugin's settings page choose Floor plan, Headquarters (the scene restarts); the 3D floor with the whole building in the frame (Overview); the wing's four door plaques reading `DEPARTMENT 1` to `DEPARTMENT 4` over `free for the next project`, each room's carpet, its eight idle desks, the sprint board, the corridors and the `HEADQUARTERS` sign at the end of corridor A; the four buttons of the bar (Desks looks at the wing, Meeting room and Servers frame their places); Walk in at 1280 px, walk through a door into a room and down corridor B, and confirm you cannot walk past the front railing (z 28.3); the "Stand-up notes" label over the meeting room's screen; the note "No agents on this host yet" clear of the bar; day and night with the app's theme (the wing's lamps). Then Company floor and Cozy room again: unchanged, and the choice kept across a reload. At 390 px: the Overview and a drag along the floor, the bar whole, the setting's phone line. Look at the desktop and the Floor plan setting for the three choices.

- [ ] **Step 3: Look at the rooms with people, on a static page**

The throwaway daemon cannot seat anyone. Build a page outside the repo that runs the built script with made-up people, and open it in a browser (the Paseo browser, or any, at the host's address given by `hostname -i`):

```bash
mkdir -p /tmp/hq-look && cd /tmp/hq-look
node --input-type=module -e '
import { readFileSync, writeFileSync } from "node:fs";
const ts = readFileSync("/workspace/QFlavours/paseo-office/server/world.generated.ts", "utf8");
const literal = ts.match(/export const WORLD_SCRIPT: string = (".*");\n/s)[1];
writeFileSync("world.js", JSON.parse(literal));
'
cat > index.html <<'EOF'
<!doctype html><meta charset="utf-8"><body style="margin:0;height:100vh"><script src="world.js"></script>
<script>
const q = new URLSearchParams(location.search);
const teams = +(q.get("teams") || 8), agents = +(q.get("agents") || 16);
const names = ["Acme web", "Acme api", "Docs", "Mobile app", "Infra", "Billing", "Search", "A workspace with a rather long name to fit on a door plaque", "Data", "Support"];
const list = Array.from({ length: agents }, (_, i) => { const t = names[i % teams]; return { id: "a" + i, name: "Agent " + (i + 1), title: "Agent " + (i + 1), dir: t, git: { repo: t }, status: i % 3 === 0 ? "work" : "rest", agent: "claude", lastPrompt: "", stuck: false, subs: [] }; });
PaseoOfficeWorld.start({ plan: q.get("plan") || "hq", dark: q.get("dark") === "1", colors: {}, onProblem: (m) => console.error(m) });
PaseoOfficeWorld.setSessions(list);
window.sendEvent = (i, type) => PaseoOfficeWorld.event({ sess: "a" + i, type });
</script>
EOF
node -e 'require("http").createServer((req,res)=>{const f=req.url.startsWith("/world.js")?"world.js":"index.html";res.setHeader("content-type",f.endsWith(".js")?"text/javascript":"text/html");res.end(require("fs").readFileSync("/tmp/hq-look/"+f))}).listen(6791,"0.0.0.0")' &
echo $! > /tmp/hq-look/pid
```

Open `http://<hostname -i>:6791/?teams=8&agents=16`. Seen and recorded: teams 1 to 6 sit in the company floor's pods and teams 7 and 8 in `DEPARTMENT 1` and `DEPARTMENT 2` (read `localStorage.getItem("office-areas")` with the browser's evaluate: the two last teams' areas are 6 and 7); each room's plaque shows its team's name and `Department 1` under it, the long name shrinks to fit, and the plaque of a room with nobody stays `DEPARTMENT n`; the chip over each room shows the team and its head count; with `?teams=3&agents=6` the whole wing is empty (the case Decision 1 names); with `?plan=pro` the same people sit on the company floor with no wing (and 12 desks hold at most 12). Send `sendEvent(14, "edit")` and `sendEvent(14, "bash")` and watch a person from a room walk out through its door and back (the wing's graph). Then record, on this page only (a Chromium-based browser has `performance.memory`): the JS heap after 20 s and the frames drawn in 5 s (count `requestAnimationFrame` calls) for `?plan=pro&agents=12`, `?plan=hq&agents=12`, `?plan=hq&agents=44&teams=10`. A software renderer (the scene says so by running light) gives a lower frame rate and is no measure of a phone: write that next to the numbers. Stop the page's server (`kill $(cat /tmp/hq-look/pid)`) and remove `/tmp/hq-look`.

If a place of Desks, Meeting room or Servers is cut at either width, tune that `HQ_VIEWS` number in `ui/camera-bar.js`, rebuild the world, and say the new number in the commit.

- [ ] **Step 4: What cannot be seen there, and is the owner's to check on the host**

Not seen on a throwaway daemon, recorded as such in `docs/verified.md`:

| What                                                                                                          | Why                                                                   |
| ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Real workspaces filling the rooms                                                                             | No agent runs there; it needs at least seven workspaces' areas in use |
| That each room keeps its workspace after leaving the office and coming back, in the app's own frame           | The static page is not the app's frame                                |
| Headquarters on the store phone app (script frame): memory, speed, Overview and a drag                        | A browser was used, not the phone                                     |
| The staff scenes of piece 5 among the rooms (intern plates, HR's desk names, a farewell box on a room's desk) | Needs agents and the day's conditions                                 |
| The wing at night with real agents at work                                                                    | Same                                                                  |

- [ ] **Step 5: Docs and commit**

`docs/verified.md` gains this piece's look: what was seen at each width, the numbers of Step 3 with the renderer named, and the table above. `README.md`: in "What works where", the 3D row's text gains nothing; add one line to the setting's description if the README lists settings: "Floor plan: Company floor, Cozy room or Headquarters. Headquarters is the largest floor; on a phone it may draw more slowly." `docs/office.md`: the paragraph from Task 4 stays; add one sentence that a room's door shows the workspace's name and nothing else about it. Stop the throwaway daemon by its pid; confirm 6798 is closed and 6767 untouched.

```bash
git add -A && git commit -m "docs: what was seen of headquarters on a stock daemon"
```

---

### After the tasks (controller, with the owner's go-ahead)

Final whole-branch review (read the wing's diff against upstream first: one line); fixes; merge to `main`; push; CI green (`ci.yml`: typecheck, lint, format, `check:world`, tests, scripts); `paseo plugin update office --ref <commit>` on the owner's host; the owner's look on desktop and on the phone: choose Headquarters, see the wing, the four views, Walk in through a room; with seven or more workspaces that have agents, see a room named after a workspace on its door and its people at the desks; leave the office and come back and see the rooms keep their workspaces; on the phone, Overview, a drag and how it runs, then say whether a per-device plan is wanted (v0.7.1 if so); then tag `v0.7.0` and write its release notes (Headquarters; the wing fills after the six company-floor areas; phone note).
