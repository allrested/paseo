# paseo-office piece 3: floor plans, part 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host setting, "Floor plan", offers the Company floor or the Cozy room for the 3D floor, and a change starts the 3D view again on the new plan, on the web frame and on the phone's script frame.

**Architecture:** The scene already draws both plans (`world/cozy-room.js` and the `PRO`/`LAYOUT` branches of 45 upstream files are in the bundle, and `paseo-entry.js` passes `options.plan` to `host.plan`); nothing offers the second. The plan is stored in `officeHostSettings`, read by a hook in the surface, handed to the 3D view as a prop, and used for the scene's start and for the desk count. The 3D view keys its scene on the plan, so a change unmounts the frame and mounts a new one (a scene page starts once). The camera bar's named views, which are the company floor's places, become one table per plan.

**Tech Stack:** TypeScript and React Native in a Paseo plugin (`/workspace/QFlavours/paseo-office`), `@getpaseo/plugin` 0.16.2, zod 4, Vitest with jsdom, the vendored scene (plain JavaScript, bundled by esbuild into `server/world.generated.ts`).

**Spec:** `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-paseo-office-roadmap-design.md`, section "3. Floor plans, part 1". Headquarters is piece 6 and is not offered here.

## Assumes from earlier pieces

Pieces 1 and 2 are not built when this is written. Re-check each of these when this piece's turn comes:

1. **Host settings are still at version 4** (piece 1 adds a field to the device setting `officeDeviceSettings`, piece 2 adds a device setting; neither touches `officeHostSettings`). If one did bump the host version, use the next number wherever this plan says 5, and add its fixtures to Task 1's.
2. **`worldStartOptions(latest, extras)`** in `client/world/world-view-shared.ts` has `extras: { focus, brand, photo? }`. Piece 2 may have added a sound extra beside them. This plan adds `plan` beside whatever is there. If `WorldViewProps` or `WorldLatest` grew, the new fields are kept; only `plan` is added.
3. **`SurfaceBody` in `client/office-surface.tsx`** still renders `worldViewFor(platform)` with the props listed there when the view is `"3d"`. Piece 1 changes what `onOpenSession` does, not this.
4. **`client/world/camera-bar.js` stand-in** (`vendor/my-office/src/office/ui/camera-bar.js`): piece 2 may add a mute button to the toolbar's markup and piece 4 may change the bar. This plan edits only the `VIEWS` table and the `V` line of `goView`. If either was rewritten, re-find those two by their text.
5. **`vendor/my-office/import-upstream.mjs --check` reports** the five kept files (`env.js`, `first-person.js`, `place-cards.js`, `tests.js`, `photo.js`) and `would write: 0` today. Pieces 2 and 4 may change that list. This piece adds no upstream file, so whatever the report was before Task 3, it is the same after.
6. **The settings page** (`client/office-settings.tsx` through `HostSwitches`) still draws rows in `headerControls` and `headerFields` views, as today.
7. **`docs/verified.md`** has a section per piece's look; this piece adds one.

## Decisions

| #   | Choice                                                                                                                                                                                                                                                                                                                                         | Reason                                                                                                                                                                            | Cost if wrong                                                                                                                                  |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | The setting is stored as the scene's own names: `floorPlan: "pro" \| "cozy"`, default `"pro"`. The page shows "Company floor" and "Cozy room".                                                                                                                                                                                                 | No mapping between a stored name and the scene's; piece 6 adds `"hq"` to the same list.                                                                                           | A person reading `settings.json` sees `pro`. One line of docs says what it means.                                                              |
| 2   | `officeHostSettings` goes to version 5. `migrate` needs no new branch: every older document takes the default, the Company floor, which is what its scene was always drawn as. A test pins that.                                                                                                                                               | A client of version 4 would otherwise read a version 5 document and write it back without `floorPlan`; version 5 makes it refuse the newer one, as for 2.                         | None for a host: its choice is kept. A phone app running an old plugin build cannot read settings until the plugin is updated, as before.      |
| 3   | The setting is about the 3D floor only. The 2D floor (40 desks, its own lounge) and the List are the plugin's own, name no plan and import nothing from `client/world/`; they do not change. The settings page's hint says so.                                                                                                                 | Verified in code: no file under `client/pixel/` or the List reads `PLAN_DESKS` or a plan. Making the 2D floor follow would be a redraw of its art, not a setting.                 | A person who picks the Cozy room still sees a lounge on the 2D floor. The hint says it will.                                                   |
| 4   | The plan reaches the 3D views as a prop `plan: WorldPlan \| null` of `WorldViewProps`. `SurfaceBody` reads it with a new hook `useFloorPlan()`. `null` means "the host has not said yet" and the view shows "Loading the 3D view..." and starts nothing. A document that cannot be read or is invalid gives the last known plan, else `"pro"`. | The scene must not start on a guess and restart on the answer (a start costs a WebGL context). A prop keeps the two views' tests free of settings mocks.                          | A host whose settings read takes long shows "Loading" a little longer than today. It fails to the company floor, which is today's.             |
| 5   | A plan change restarts the scene by remounting it: `WorldView` and `WorldViewNative` each become a thin wrapper around an inner scene component rendered with `key={plan}`. The web frame is removed and a new one opened; the phone's `ScriptFrame` is unmounted and a new one mounted.                                                       | `PaseoOfficeWorld.start` returns at once when `started` is true (one scene per page), so a second `start` in the same page would do nothing.                                      | A new page costs a script evaluation and a context: seconds on a phone. It happens only when the setting is changed.                           |
| 6   | The camera bar's three named views (Desks, Meeting room, Servers) become a table per plan, with upstream's own cozy places (`camera-bar.js` of my-office, `VIEWS` for `!PRO`). Overview is fitted from `floorBounds()` and already follows the plan.                                                                                           | The old table points at the company floor's coordinates: on the cozy room Desks and Servers would look at empty floor.                                                            | A view's zoom factor may look a little far or near on the cozy room: one number each, changed in one place.                                    |
| 7   | No upstream file changes, no `DENY` entry changes, no stand-in is deleted, `env.js` and `paseo-entry.js` stay as they are. The only hand change is the stand-in `ui/camera-bar.js` (already a stand-in, already in `DENY`).                                                                                                                    | `env.js` already reads `host.plan` and refuses only `hq`; the entry already maps `options.plan`. The import tool's report does not change.                                        | None.                                                                                                                                          |
| 8   | A team's remembered desks (`office-areas` in the app origin's `localStorage`, by project, as unit numbers) are not cleared on a switch.                                                                                                                                                                                                        | Upstream's `areaOf` and `proDesk` already ignore a unit number past the plan's units, and the plants are stored per plan (`all[LAYOUT]`). Clearing is a change to upstream's key. | After a switch a project may sit in a different unit than a fresh start would give it: a number that happens to exist in both plans. Cosmetic. |
| 9   | The stand-up notes label over the meeting room's screen stays company-floor only (`paseo-entry.js` `host.plan === 'pro'`). On the cozy room the notes open from the column as before.                                                                                                                                                          | The cozy room's meeting table has no wall screen to put a label on.                                                                                                               | One way in fewer on the cozy room. The docs say it.                                                                                            |
| 10  | The lobby sign, the director, the karaoke box, pool, foosball, the games TV, the sofa nap, the dining room and the restroom do not exist on the cozy room. The lively floor there offers the fish and the arcade only, with no change to `paseo-leisure.js`.                                                                                   | Verified: `paseo-leisure.js` guards each with `PRO` or `?.`. See "What the cozy room changes".                                                                                    | Resting agents on the cozy room do less. That is upstream's cozy room.                                                                         |
| 11  | A change takes effect in an open office when the surface's settings read reports it. If the look shows that a surface does not see a change saved from the settings page until it is opened again, that is accepted and written in the docs (Task 5 says how it is found out and what to add if the owner wants it live).                      | The SDK declares `useSettings` but not whether an already mounted hook hears another screen's save; it cannot be read here.                                                       | A person changes the setting and must reopen the office to see it.                                                                             |

## What the cozy room changes

Read from the vendored scene. Every module below has the plan in a condition and handles both branches; none is skipped on cozy, so the same bundle draws either.

| Area                | Files (under `vendor/my-office/src/office/`)                                                                                               | Company floor                                                                                      | Cozy room                                                                                                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plan table          | `core/env.js`, `world/layout.js`                                                                                                           | `LAY.box` 22 x 17 m                                                                                | `LAY.box` 16 x 12 m, one open room                                                                                                                                                             |
| Desks               | `world/desks.js`                                                                                                                           | 3 pods x 4 = 12 desks; 6 units of 2 desks (a team takes half a pod); second screen and drawers     | 3 rows x 3 = 9 desks; 3 units of 3 desks (a team takes a row); no drawers                                                                                                                      |
| Room                | `world/cozy-room.js`, `world/pro/floor.js`, `world/windows.js`, `world/entrance.js`, `world/terrace.js`                                    | `buildProFloor()`: lobby, director's office, meeting room, library, server room, pantry, restrooms | Wood floor, two walls, rugs; a door instead of a lift; a smaller terrace                                                                                                                       |
| Furniture and props | `world/furniture/*`, `world/props/{trinkets,shredder,vacuum,cat,switches,string-lights,microwave,duty-board,game-tv,billiards,karaoke}.js` | All of them                                                                                        | Coffee, aquarium, arcade, printer, shredder, racks, rocket, cat, vacuum; no microwave, duty board, games TV, pool table, karaoke box                                                           |
| People              | `people/{navigation,breaks,director,gatherings,errands,workers,gaming,karaoke,billiards}.js`                                               | Director, dining room, sofa seats, restroom stalls, pantry queue                                   | No director (`director` is `null`); `STATIONS` has no `director`, `brief`, `wc`, `sink`, `dining`; `COFFEE_Q` is `[]`; upstream's own task table for prompts (read `ui/event-text.js` `setup`) |
| Life and places     | `life/{quota,tests,trophies}.js`, `interact/{props,place-chips,first-person}.js`, `ui/event-text.js`                                       | 13 place chips; trophies; walk bounds `x -7.85..15.3`, `z -7.85..11.3`                             | 10 place chips (no director, lounge or wc); no trophy plaque; walk bounds `x -7.85..11.7`, `z -5.85..10.3`                                                                                     |
| Camera and light    | `scene/renderer.js`, `scene/lights.js`, `core/optimize.js`                                                                                 | Base zoom 0.8, min 0.5                                                                             | Base zoom 1, min 0.7                                                                                                                                                                           |

Port files that assume the company floor, checked one by one:

| File                                                                       | Assumes the company floor?                                                                                                                                                                                 | What this piece does                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| `paseo-entry.js`                                                           | Passes `options.plan` (`'cozy'` or else `'pro'`). `makeNotesLabel` runs only when `host.plan === 'pro'`. `showBrand` returns when `PRO_FX.logoM` is absent. The director branch tests `director &&` first. | Nothing, with a test that the plan is passed (Task 3). |
| `paseo-leisure.js`, `paseo-leisure-plan.js`                                | No: `sofa()` is `[]` off `PRO`; pool, foosball, TV and karaoke are `PRO &&`; `cup` needs `COFFEE_Q[0]`; `wc` and `dining` are read with `?.`. On cozy the kinds that can start are `fish` and `arcade`.    | Nothing, with a test (Task 3).                         |
| `paseo-sign.js`                                                            | The lobby sign's picture; cozy has no sign and `showBrand` does not call it.                                                                                                                               | Nothing.                                               |
| `paseo-focus.js`, `paseo-host.js`, `paseo-style.js`                        | No. (`paseo-host.js` already documents `plan: 'pro' \| 'cozy'`.)                                                                                                                                           | Nothing.                                               |
| `ui/camera-bar.js` (stand-in)                                              | **Yes.** `VIEWS` holds the company floor's three places. `fitFloor` uses `floorBounds()`, which follows the plan.                                                                                          | A table per plan (Task 3).                             |
| `interact/first-person.js` `floorBounds` and walk bounds (a kept file)     | No: both have a cozy branch.                                                                                                                                                                               | Nothing.                                               |
| Incidents banner (`makeIncidentBanner`, `#incident`, `paseo-style.js`)     | No: it is a button over the stage, placed by `--corner-clear`.                                                                                                                                             | Nothing.                                               |
| `ui/whiteboard.js` (stand-in)                                              | No: it opens the director's card only when the picked worker is `director`, which is `null` on cozy.                                                                                                       | Nothing.                                               |
| `world/backdrops/index.js` (stand-in)                                      | No: a plain backdrop; `windows.js` has its cozy branch.                                                                                                                                                    | Nothing.                                               |
| `life/nap.js`, `life/incidents.js`, `audio/sfx.js`, `ui/*` other stand-ins | No plan reads.                                                                                                                                                                                             | Nothing.                                               |

Plugin-side numbers: `PLAN_DESKS = { pro: 12, cozy: 9 }` in `client/world/adapter.ts` is the only desk count; `worldPeople(model, desks)` seats at most that many (who needs you first, then who works, then who rests) and the scene never receives more sessions than desks. `floorNote` says how many have no desk. `docs/office.md` says "The floor has 12 desks": it becomes both numbers.

With more agents than desks: company floor, 12 seated and the rest named by the note; cozy room, 9 seated and the rest named by the note. In the scene, a project takes a unit (company: half a pod of 2 desks, taking the other half when it has more; cozy: a row of 3, then the nearest free row); when every unit is taken, projects share free desks (`net/live.js` `proDesk`, step 4). The List and the 2D floor always show everyone.

## Global Constraints

- Work in `/workspace/QFlavours/paseo-office` on a branch `feat/floor-plans` cut from `main`. The repo is public: nothing private in files, fixtures or commit messages (fixtures use "Acme", `SHOP-...`, made-up paths); no AI attribution on commits; never push, never `gh` (the controller publishes).
- The scene gets no new data, makes no network call, and `WORLD_API_VERSION` stays 1 (`plan` is an option `start` already takes).
- App-side code (`client/`, `shared/`) uses nothing a phone's engine lacks: `client/engine-compat.test.ts` must stay green. No `toSorted`, `toReversed`, `findLast`.
- Cross-platform: no `onPointerEnter`/`onPointerLeave`; DOM only on web; use `onHoverIn`/`onHoverOut` as `client/view-switch.tsx` does.
- Styles in `client/styles.ts`, never inline objects. This piece needs no new style: the row uses `segments`, `segmentsDisabled`, `segment`, `segmentFill`, `segmentHoverFill`, `segmentText`, `segmentTextSelected`, `headerFields`, `headerField`, `sheetLabel`, `fieldHint`, `actionError`. `OfficeSurface` stays under the lint complexity limit of 20: the hook goes in its own file.
- Every hand change in a vendored file starts `// PASEO:` and is listed in `vendor/SOURCES.md`. After any change under `vendor/`, run `npm run build:world` and commit `server/world.generated.ts` with it; `npm run check:world` must pass.
- Stock Paseo 0.16 only; nothing the SDK lacks.
- Never run a bare `paseo` command and never start, stop or restart the daemon on port 6767. A throwaway daemon uses `PASEO_HOME=/tmp/office-stock-home`, port 6798, `env -i`, and the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`.
- Checks after each task: `npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts`, and the test files touched; the whole suite (`npm test -- --maxWorkers=4`, output to a file under /tmp) before each commit.

## Not verifiable until built

| What                                                                                                                                                           | How a task finds out                                                                                                                                                                                            |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whether `useSettings` in an open surface hears a save made from the settings page, and whether a surface opened later reads the new value                      | Task 5, step 3: save on the page, return to the office in the same browser tab, and see whether the floor changed. The contingency is written there.                                                            |
| That the cozy room draws, lets people walk, plays its lively floor (fish, arcade) and lets Walk in work under the port's stand-ins, with no error in the frame | Task 5, step 3: the frame's console, and made-up people seated by a call to `PaseoOfficeWorld.setSessions` from the page's console. Over a day (night walk home, 8:00 to 21:00 leisure) only the owner sees it. |
| That the phone's `ScriptFrame` unmounts and a second page starts cleanly on a change, and what that costs in memory                                            | Owner's check on the host's phone (Task 5 names it). The unmount path is the one a switch to the 2D view already takes, which works on the phone today.                                                         |
| The camera bar's three views on the cozy room look right (zoom factors are upstream's, applied to the port's fitted zoom, not to upstream's base zoom)         | Task 5, step 3: the three buttons at 1280 and 390 px.                                                                                                                                                           |

---

### Task 1: The "Floor plan" host setting

**Files:**

- Modify: `shared/settings.ts`
- Test: `shared/settings.test.ts`
- Modify (fixtures only, as typecheck names them): `index.server.test.ts`, `server/notes-schedule.test.ts`, `server/notes-files.test.ts`, `client/host-switches.mounted.test.tsx`

**Interfaces:**

- Produces, in `shared/settings.ts`:

```ts
/** The floor plans the 3D scene is offered, by the scene's own names. Headquarters ("hq") is not among them yet. */
export const FLOOR_PLANS = ["pro", "cozy"] as const;
export type FloorPlanChoice = (typeof FLOOR_PLANS)[number];
```

- `officeHostSettings`: `version: 5`; the schema gains `floorPlan: z.enum(FLOOR_PLANS).default("pro")`; the output type of the host values gains `floorPlan: FloorPlanChoice`.

- [ ] **Step 1: Write the failing tests**

In `shared/settings.test.ts`, add a constant under `SUNDAY_TO_THURSDAY`:

```ts
/** Every document of an older version draws the company floor, as its scene always did. */
const COMPANY = { floorPlan: "pro" };
```

Add `...COMPANY,` to the object each of these three existing tests compares with `toEqual`: "version 1 settings keep their Agent tools choice and have no notes folder", "host settings: version 2 values stay and the incident fields take their defaults", and "a version 3 document keeps its values and its Sunday to Thursday notes". In the last one change `expect(officeHostSettings.version).toBe(4)` to `.toBe(5)`. Then add:

```ts
test("a version 4 document keeps its values and its days, and draws the company floor", async () => {
  const stored = {
    agentTools: false,
    notesFolder: "/n",
    notesTimeZone: "Asia/Riyadh",
    notesDays: [1, 3],
    jiraProjects: "SHOP",
    sentryOrg: "acme",
    sentryProjects: "web",
    sentryUrl: "https://sentry.acme.dev",
  };
  expect(await upgraded(stored, 4)).toEqual({ ...stored, ...COMPANY });
});

test("a host with no settings draws the company floor", () => {
  expect(officeHostSettings.schema.parse({})).toMatchObject({ floorPlan: "pro" });
});

test("the cozy room is kept, and no other plan is offered yet", async () => {
  expect(hostIssues({ floorPlan: "cozy" })).toEqual([]);
  expect(await upgraded({ floorPlan: "cozy" }, 5)).toMatchObject({ floorPlan: "cozy" });
  // Headquarters comes with piece 6; a name the scene has but this build does not offer is refused.
  expect(officeHostSettings.schema.safeParse({ floorPlan: "hq" }).success).toBe(false);
  expect(officeHostSettings.schema.safeParse({ floorPlan: "" }).success).toBe(false);
  expect(FLOOR_PLANS).toEqual(["pro", "cozy"]);
});
```

Add `FLOOR_PLANS` to the import from `./settings.js`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run shared/settings.test.ts`
Expected: FAIL: `FLOOR_PLANS` is not exported, `officeHostSettings.version` is 4, and the `toEqual` comparisons lack `floorPlan`.

- [ ] **Step 3: Implement**

In `shared/settings.ts`, above `const HostValuesSchema`, add the `FLOOR_PLANS` and `FloorPlanChoice` lines from Interfaces. In `HostValuesSchema`, after the `notesDays` entry, add `floorPlan: z.enum(FLOOR_PLANS).default("pro"),`. In the doc comment of `officeHostSettings`, after the `notesDays` sentence add: "`floorPlan` is the 3D floor's plan: `pro` the company floor, `cozy` one open room." Change `version: 4` to `version: 5`. Replace the comment above `migrate` with:

```ts
// Version 1 had only `agentTools`, version 2 no incident fields, version 3 no `notesDays` and
// version 4 no `floorPlan`: what a document has stays, and the rest take their defaults, but for
// the days. Before version 4 the notes ran Sunday to Thursday, so a host that had settings keeps
// those days. Every document of an older version draws the company floor, the default: the one
// its scene was always drawn as. Version 5 exists so that a client that does not know the field
// refuses the document rather than saving it back without it.
```

Leave the `migrate` body as it is.

- [ ] **Step 4: Run, then fix the fixtures the type names**

Run: `npx vitest run shared/settings.test.ts` (expected: PASS), then `npm run typecheck`. A fixture that builds a complete host-values object by hand now lacks `floorPlan`. Add `floorPlan: "pro"` to each one it names, in `index.server.test.ts`, `server/notes-schedule.test.ts`, `server/notes-files.test.ts` and the `stored = {...}` of `client/host-switches.mounted.test.tsx` (its `beforeEach`; its first `toEqual`s on `saved` use `...stored`, so they follow). Add nothing else.

- [ ] **Step 5: Check and commit**

```bash
npx vitest run shared/settings.test.ts client/host-switches.mounted.test.tsx index.server.test.ts server/notes-schedule.test.ts server/notes-files.test.ts
npm run format:check && npm run lint && npm run typecheck
git add -A && git commit -m "feat: the host setting Floor plan, company floor or cozy room"
```

---

### Task 2: The plan reaches the scene, and a change starts it again

**Files:**

- Create: `client/world/use-floor-plan.ts`, `client/world/world-loading.tsx`
- Test: `client/world/use-floor-plan.test.tsx`
- Modify: `client/world/use-world-feed.ts`, `client/world/world-view-shared.ts`, `client/world/world-view.tsx`, `client/world/world-view-native.tsx`, `client/world/world-api.ts` (a doc comment), `client/office-surface.tsx`
- Modify tests: `client/world/use-world-feed.mounted.test.tsx`, `client/world/world-view-shared.test.ts`, `client/world/world-view.mounted.test.tsx`, `client/world/world-view-native.mounted.test.tsx`

**Interfaces:**

- Consumes: `officeHostSettings` and `FloorPlanChoice` (Task 1); `WorldPlan` and `PLAN_DESKS` from `client/world/adapter.ts` (`WorldPlan` is `"pro" | "cozy"`, the same names).
- Produces, in `client/world/use-floor-plan.ts`:

```ts
/** What the plan needs of a settings read. */
export type PlanSource =
  | { status: "loading" | "error" | "invalid" }
  | { status: "ready"; values: { floorPlan: WorldPlan } };
/** The plan to draw: the stored one; while it is read, the last one known (none at first); when it cannot be read, the last known, else the company floor. */
export function floorPlanOf(settings: PlanSource, last: WorldPlan | null): WorldPlan | null;
/** The plan the 3D view draws; null until the host has said. */
export function useFloorPlan(): WorldPlan | null;
```

- Changed: `WorldViewProps` gains `plan: WorldPlan | null`; `WorldFeedInput` gains `plan: WorldPlan`; `worldStartOptions(latest, extras)` takes `extras.plan: WorldPlan`; `PLAN` is no longer exported from `use-world-feed.ts`.

- [ ] **Step 1: Write the failing tests**

`client/world/use-floor-plan.test.tsx` (jsdom):

```tsx
/**
 * @vitest-environment jsdom
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { floorPlanOf, useFloorPlan } from "./use-floor-plan.js";

const h = vi.hoisted(() => ({ settings: { status: "loading" } as Record<string, unknown> }));
vi.mock("@getpaseo/plugin/client", () => ({ useSettings: () => h.settings }));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

test("a stored plan is the plan", () => {
  expect(floorPlanOf({ status: "ready", values: { floorPlan: "cozy" } }, null)).toBe("cozy");
  expect(floorPlanOf({ status: "ready", values: { floorPlan: "pro" } }, "cozy")).toBe("pro");
});

test("while the settings are read there is no plan, or the last one", () => {
  expect(floorPlanOf({ status: "loading" }, null)).toBeNull();
  expect(floorPlanOf({ status: "loading" }, "cozy")).toBe("cozy");
});

test("settings that cannot be read keep the last plan, else draw the company floor", () => {
  expect(floorPlanOf({ status: "error" }, null)).toBe("pro");
  expect(floorPlanOf({ status: "invalid" }, null)).toBe("pro");
  expect(floorPlanOf({ status: "error" }, "cozy")).toBe("cozy");
  expect(floorPlanOf({ status: "invalid" }, "cozy")).toBe("cozy");
});

let container: HTMLElement;
let root: Root;
let seen: (string | null)[];

function Probe() {
  seen.push(useFloorPlan());
  return null;
}

beforeEach(() => {
  seen = [];
  h.settings = { status: "loading" };
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

test("the hook gives null until the host answers, then the plan, and keeps it through a new read", async () => {
  await act(async () => root.render(<Probe />));
  expect(seen.at(-1)).toBeNull();

  h.settings = { status: "ready", values: { floorPlan: "cozy" } };
  await act(async () => root.render(<Probe />));
  expect(seen.at(-1)).toBe("cozy");

  h.settings = { status: "loading" };
  await act(async () => root.render(<Probe />));
  expect(seen.at(-1)).toBe("cozy");

  h.settings = { status: "ready", values: { floorPlan: "pro" } };
  await act(async () => root.render(<Probe />));
  expect(seen.at(-1)).toBe("pro");
});
```

`client/world/use-world-feed.mounted.test.tsx`: add `plan: "pro",` to `input()`'s object (before `...overrides`). Add:

```tsx
import { buildOfficeModel } from "../../shared/model.js";
import type { OfficeAgent } from "../../shared/contracts.js";

/** Ten agents at rest in one workspace: more than the cozy room's nine desks, fewer than the company floor's twelve. */
function crowd(count: number): OfficeModel {
  const agents: OfficeAgent[] = Array.from({ length: count }, (_, index) => ({
    id: String(index + 1),
    title: `Agent ${index + 1}`,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-16T00:00:${String(index + 1).padStart(2, "0")}Z`,
  }));
  return buildOfficeModel({
    agents,
    workspaces: [{ id: "w1", name: "shop-api", projectName: "shop" }],
    activity: {},
    doing: {},
    boards: {},
    wake: { paused: false, queued: {} },
  });
}

/** How many people the scene was last told to seat. */
function seated(calls: string[]): number {
  const last = calls.filter((call) => call.startsWith("setSessions:")).at(-1) ?? "";
  return (JSON.parse(last.slice("setSessions:".length)) as unknown[][])[0].length;
}

test("the plan's desks decide who is seated, and the note says who has none", async () => {
  const company = fakeScene();
  await act(async () =>
    root.render(<Probe api={company.api} feed={input({ model: crowd(10), plan: "pro" })} />),
  );
  expect(seated(company.calls)).toBe(10);
  expect(note).toBeNull();

  const cozy = fakeScene();
  await act(async () =>
    root.render(<Probe api={cozy.api} feed={input({ model: crowd(10), plan: "cozy" })} />),
  );
  expect(seated(cozy.calls)).toBe(9);
  expect(note).toBe("1 agent has no desk on this floor. The list shows everyone.");
});
```

If `OfficeSnapshot` needs fields the object above lacks, copy the shape `office()` has in `client/world/adapter.test.ts` (the test file's own helper) rather than guessing.

`client/world/world-view-shared.test.ts`: change both `worldStartOptions(latest(), { focus: vi.fn(), brand: BRAND ... })` calls to include `plan: "pro"`, rename the test "the plan, the brand and the colours are the scene's start" to keep its title, and add:

```ts
test("the scene is started with the plan it is given", () => {
  const cozy = worldStartOptions(latest(), { focus: vi.fn(), brand: BRAND, plan: "cozy" });
  expect(cozy.plan).toBe("cozy");
});
```

`client/world/world-view.mounted.test.tsx`: in the hoisted `frame`, add `starts: [] as WorldStartOptions[]` and `disposed: 0`; in the mocked `start`, also `frame.starts.push(options)`; make `dispose: () => { frame.disposed += 1; }`; reset both in `beforeEach`. Refactor `startedOffice` to take a plan and use a helper that returns the element:

```tsx
function office(
  plan: WorldPlan | null,
  onSelectAgent: (id: string | null) => void = ignore,
  model: OfficeModel = MODEL,
) {
  return (
    <WorldView
      plan={plan}
      model={model}
      /* the rest of the props, as startedOffice passes them today */
    />
  );
}
async function startedOffice(
  onSelectAgent: (id: string | null) => void,
  model: OfficeModel = MODEL,
): Promise<WorldStartOptions> {
  await act(async () => root.render(office("pro", onSelectAgent, model)));
  if (frame.started === null) throw new Error("the office did not start");
  return frame.started;
}
```

(Move the props `startedOffice` passes today into `office`, unchanged.) Import `WorldPlan` from `./adapter.js`. Add:

```tsx
test("with no plan yet nothing starts, and the view says it is loading", async () => {
  await act(async () => root.render(office(null)));
  expect(frame.starts).toHaveLength(0);
  expect(container.textContent).toContain("Loading the 3D view...");
});

test("the scene starts on the plan it is given", async () => {
  await act(async () => root.render(office("cozy")));
  expect(frame.starts.map((options) => options.plan)).toEqual(["cozy"]);
});

test("a changed plan takes the frame out and starts the scene again on the new plan", async () => {
  await act(async () => root.render(office("pro")));
  expect(frame.disposed).toBe(0);
  await act(async () => root.render(office("cozy")));
  expect(frame.disposed).toBe(1);
  expect(frame.starts.map((options) => options.plan)).toEqual(["pro", "cozy"]);
  // The same plan again is no restart.
  await act(async () => root.render(office("cozy")));
  expect(frame.starts).toHaveLength(2);
});
```

`client/world/world-view-native.mounted.test.tsx`: in `mount()`'s `props` add `plan: "pro" as WorldPlan | null,` before `...overrides` (import the type). To render again with other props the helper must re-render the same root: it already calls `root.render` each time, so a second `mount({ plan: "cozy" })` is a re-render. Add:

```tsx
test("with no plan yet nothing is posted", async () => {
  await mount({ plan: null });
  expect(h.posted).toEqual([]);
});

test("a changed plan stops the page and starts a new one on the new plan", async () => {
  await mount({ plan: "pro" });
  h.posted = [];
  await mount({ plan: "cozy" });
  const messages = calls();
  expect(messages[0].call).toBe("stop");
  const start = messages.find((message) => message.call === "start");
  expect((start?.args[0] as { plan: string }).plan).toBe("cozy");
  expect(messages.map((message) => message.call).indexOf("stop")).toBeLessThan(
    messages.map((message) => message.call).indexOf("start"),
  );
});
```

Also in that file's first test group nothing else changes (`mount()` defaults to `"pro"`).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/world/use-floor-plan.test.tsx client/world/use-world-feed.mounted.test.tsx client/world/world-view-shared.test.ts client/world/world-view.mounted.test.tsx client/world/world-view-native.mounted.test.tsx`
Expected: FAIL: `./use-floor-plan.js` does not exist; the others fail on a missing `plan` (a type error is shown by `npm run typecheck`; at runtime the views ignore the prop and never restart).

- [ ] **Step 3: The hook**

`client/world/use-floor-plan.ts`:

```ts
import { useEffect, useState } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { officeHostSettings } from "../../shared/settings.js";
import type { WorldPlan } from "./adapter.js";

/** What the plan needs of a settings read. */
export type PlanSource =
  | { status: "loading" | "error" | "invalid" }
  | { status: "ready"; values: { floorPlan: WorldPlan } };

/**
 * The plan to draw. A stored plan is the plan. While the settings are read there is none, or the
 * last one known: a new read must not restart a scene that is up. Settings that cannot be read, or
 * are not valid, keep the last plan and else draw the company floor, as the office did before there
 * was a choice.
 */
export function floorPlanOf(settings: PlanSource, last: WorldPlan | null): WorldPlan | null {
  if (settings.status === "ready") return settings.values.floorPlan;
  if (settings.status === "loading") return last;
  return last ?? "pro";
}

/** The plan the 3D view draws, from the host's "Floor plan" setting; null until the host has said. */
export function useFloorPlan(): WorldPlan | null {
  const settings = useSettings(officeHostSettings);
  const [last, setLast] = useState<WorldPlan | null>(null);
  const plan = floorPlanOf(settings, last);
  useEffect(() => {
    setLast(plan);
  }, [plan]);
  return plan;
}
```

`client/world/world-loading.tsx`:

```tsx
import { Text, View } from "react-native";
import type { OfficeStyles } from "../styles.js";

/** The 3D view's place while the host's plan is not known: nothing is started yet. */
export function WorldLoading({ styles }: { styles: OfficeStyles }) {
  return (
    <View style={styles.scene}>
      <Text style={styles.sceneStatus}>Loading the 3D view...</Text>
    </View>
  );
}
```

- [ ] **Step 4: The feed, the start options, the views, the surface**

- `client/world/use-world-feed.ts`: delete the `PLAN` constant with its doc comment. Add `plan: WorldPlan;` to `WorldFeedInput` with the comment `/** The floor plan the scene was started on: its desks seat the people. */`. Add `plan` to the destructured input of `useWorldFeed` (after `incidents`). Replace `const people = useMemo(() => worldPeople(model, PLAN_DESKS[PLAN]), [model]);` with `const people = useMemo(() => worldPeople(model, PLAN_DESKS[plan]), [model, plan]);`.
- `client/world/world-view-shared.ts`: delete `import { PLAN } from "./use-world-feed.js";`; import `type WorldPlan` from `./adapter.js` (the file already imports `boardRoom, isDarkTheme` from it: extend that line). Change the `extras` parameter type to `{ focus(): void; brand: WorldBrand; plan: WorldPlan; photo?: false }` (keep any extra field a piece before this added), and `plan: PLAN,` in the returned object to `plan: extras.plan,`.
- `client/world/world-api.ts`: the comment of `WorldStartOptions.plan` is added: `/** The floor plan: "pro" is the company floor, "cozy" one open room. A page starts once, so a new plan is a new page. */`.
- `client/world/world-view.tsx`: add `import type { WorldPlan } from "./adapter.js";` (extend the existing `worldBrand` import), `import { WorldLoading } from "./world-loading.js";`. In `WorldViewProps` add, after `styles`:

```ts
/** The floor plan to draw; null until the host has said, and then nothing starts. A new plan is a new scene. */
plan: WorldPlan | null;
```

Rename the function `WorldView` to `WorldScene`, give it the type `WorldSceneProps = Omit<WorldViewProps, "plan"> & { plan: WorldPlan }`, add `plan` to its destructured props, pass `plan` in the `worldStartOptions(latest, { focus: focusApp, brand: ..., plan })` call (the `brand` line and its comment stay), put `plan` in the dependency list of the start effect (`[script, sized, containerId, plan]`) and in the `useWorldFeed(api, { ... })` input. Do not export `WorldScene`. After it add:

```tsx
/**
 * The office in 3D, on the host's plan. A scene page starts once, so each plan is a scene of its
 * own: a changed plan takes the frame out and opens a new one.
 */
export function WorldView({ plan, ...rest }: WorldViewProps) {
  if (plan === null) return <WorldLoading styles={rest.styles} />;
  return <WorldScene key={plan} plan={plan} {...rest} />;
}
```

Move the existing doc comment of `WorldView` (the paragraph about the web-only frame and reporting a problem) onto `WorldScene` and keep it true.

- `client/world/world-view-native.tsx`: the same change: import `WorldPlan` and `WorldLoading`; the body becomes `WorldViewNativeScene` with `plan` destructured, `worldStartOptions(latest, { focus: noFocus, brand: worldBrand(null), photo: false, plan })`, the start effect's dependencies `[page, plan]`, `plan` in the `useWorldFeed` input; then

```tsx
export function WorldViewNative({ plan, ...rest }: WorldViewProps) {
  if (plan === null) return <WorldLoading styles={rest.styles} />;
  return <WorldViewNativeScene key={plan} plan={plan} {...rest} />;
}
```

with the doc comment of the old function on the scene and one sentence on the wrapper: "A changed plan unmounts the `ScriptFrame` and mounts a new one: the scene's page starts once."

- `client/office-surface.tsx`: add `import { useFloorPlan } from "./world/use-floor-plan.js";`. In `SurfaceBody`, as its first statement (before the `if (office.subscription.status === "error")`), add `const plan = useFloorPlan();`, and pass `plan={plan}` to `<World ... />` (after `styles={styles}`).

- [ ] **Step 5: Run, check, commit**

```bash
npx vitest run client/world/use-floor-plan.test.tsx client/world/use-world-feed.mounted.test.tsx client/world/world-view-shared.test.ts client/world/world-view.mounted.test.tsx client/world/world-view-native.mounted.test.tsx client/office-surface.test.ts client/office-surface-panels.mounted.test.tsx client/engine-compat.test.ts
npm run format:check && npm run lint && npm run typecheck
npm test -- --maxWorkers=4 > /tmp/office-piece3-task2.txt 2>&1; tail -15 /tmp/office-piece3-task2.txt
git add -A && git commit -m "feat: the 3D view starts on the host's floor plan and starts again when it changes"
```

Expected: all pass. `office-surface-panels.mounted.test.tsx` answers the host's settings with the schema's defaults, so its 3D view gets `"pro"`; if a test there waits for the 3D view's "Loading" text, it still sees it.

---

### Task 3: The scene on the cozy room

The scene already has the cozy room; this task fixes the one company-floor assumption in the port's files, and pins what the checks above say.

**Files:**

- Modify: `vendor/my-office/src/office/ui/camera-bar.js`, `vendor/SOURCES.md`, `server/world.generated.ts` (built)
- Test: `client/world/camera-bar.test.ts`, `client/world/leisure-scene.test.ts`, `client/world/entry.test.ts`

**Interfaces:**

- Consumes: `host.plan` (`'pro'` or `'cozy'`) from `paseo-host.js`, set by `paseo-entry.js` before `cameraBar.setup()`.
- Produces: `goView(view)` looks at the place of the plan in use. Nothing else changes in the bar's exports (`build`, `setup`, `setView`, `fitFloor`, `goView`).

- [ ] **Step 1: Write the failing tests**

`client/world/camera-bar.test.ts`: in the hoisted `h` add `plan: "pro" as string,`. Change the host mock to read it live:

```ts
vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({
  host: {
    get plan() {
      return h.plan;
    },
    toast: h.toast,
  },
}));
```

In `beforeEach` add `h.plan = "pro";`. Add, after "Desks flies to upstream's place at 1.9 times the fitted zoom":

```ts
test("on the cozy room the views are upstream's places for it", () => {
  h.plan = "cozy";
  open();
  const fitted = camera.zoom;

  click("[data-view=desks]");
  expect(h.set).toHaveBeenLastCalledWith(0, 0.6, 0.4);
  expect(state.zoomGoal).toBeCloseTo(fitted * 1.75);

  click("[data-view=meeting]");
  expect(h.set).toHaveBeenLastCalledWith(5.2, 0.6, 2.4);
  expect(state.zoomGoal).toBeCloseTo(fitted * 2.3);

  goView("server");
  expect(h.set).toHaveBeenLastCalledWith(5.4, 1.0, -4.4);
  expect(state.zoomGoal).toBeCloseTo(fitted * 2.2);
  expect(pressed()).toEqual(["server"]);
});

test("a plan the bar has no places for uses the company floor's", () => {
  h.plan = "hq";
  open();
  click("[data-view=desks]");
  expect(h.set).toHaveBeenLastCalledWith(2.3, 0.6, 3.6);
});
```

(`state.zoomGoal` is clamped to the controls' limits `0.5..3.4` in the test's renderer mock; the fitted zoom in this test's camera makes `fitted * 2.3` stay inside them, as the existing desks test shows for 1.9. If a product exceeds 3.4 in this harness, compare with `Math.min(3.4, fitted * f)`.)

`client/world/leisure-scene.test.ts`: make the env mock live. Add to the hoisted `h`: `env: { PRO: true } as { PRO: boolean },` and replace the `core/env.js` mock's `PRO: true,` with `get PRO() { return h.env.PRO; },`. In `beforeEach` add `h.env.PRO = true; h.stations.coffee = []; delete (h.stations as Record<string, unknown>).dining;` (the `person()` helper sets `h.stations.wc`; `h.stations` is typed `{ coffee; dining; wc }`: loosen the hoisted type to `Record<string, unknown[]>`). Add:

```ts
test("on the cozy room nothing starts that needs the sofa, the dining room, the restroom or the games", () => {
  h.env.PRO = false;
  // Upstream's cozy `STATIONS` has none of these (people/navigation.js), and `COFFEE_Q` is [].
  delete (h.stations as Record<string, unknown>).wc;
  delete (h.stations as Record<string, unknown>).dining;
  person("a");
  for (const kind of ["nap", "cup", "wc", "pool", "foosball", "tv", "karaoke"]) {
    expect(leisureNow("a", kind), kind).toBeNull();
  }
});

test("on the cozy room the loop runs with no restroom station at all", () => {
  h.env.PRO = false;
  delete (h.stations as Record<string, unknown>).wc;
  delete (h.stations as Record<string, unknown>).dining;
  person("a");
  expect(() => updateLeisure()).not.toThrow();
});
```

`person()` sets `h.stations.wc` itself: in these two tests call `delete h.stations.wc` after `person("a")`, not before (swap the order above). `leisureNow("a", "wc")` with `wc` absent returns null through `STATIONS.wc?.some`.

`client/world/entry.test.ts`: after the `startPage` tests add:

```ts
test("the plan the host names is the scene's floor; headquarters is not offered", async () => {
  const planOf = async (options: object) => {
    await startPage(options);
    // @ts-expect-error vendored JavaScript has no declarations
    const { host: page } = await import("../../vendor/my-office/src/office/paseo-host.js");
    return page.plan;
  };
  expect(await planOf({ plan: "cozy" })).toBe("cozy");
  expect(await planOf({ plan: "pro" })).toBe("pro");
  expect(await planOf({ plan: "hq" })).toBe("pro");
  expect(await planOf({})).toBe("pro");
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/world/camera-bar.test.ts client/world/leisure-scene.test.ts client/world/entry.test.ts`
Expected: FAIL: the cozy views test sees `(2.3, 0.6, 3.6)` for Desks; the plan-name test and the leisure tests already pass (they pin what the scene does today; if one fails, the finding is real: read the file it names before changing anything and report it).

- [ ] **Step 3: The camera bar's views per plan**

In `vendor/my-office/src/office/ui/camera-bar.js`, replace the comment and the `VIEWS` constant (from `/**\n * Upstream's views for the company floor` down to the `const VIEWS = {...};` line) with:

```js
/**
 * Upstream's views, each a place to look at and a factor of the fitted zoom, by floor plan (upstream's
 * ui/camera-bar.js keeps the same places per plan). Overview is Paseo's own and is fitted, so it is not
 * in the tables.
 * PASEO: upstream's table is by plan and in its own zoom; the stand-in had the company floor's alone.
 */
const VIEWS = {
  pro: {
    desks: { t: [2.3, 0.6, 3.6], z: 1.9 },
    meeting: { t: [-1.2, 0.6, -5.4], z: 2.0 },
    server: { t: [-5.6, 1.0, -0.6], z: 2.4 },
  },
  cozy: {
    desks: { t: [0, 0.6, 0.4], z: 1.75 },
    meeting: { t: [5.2, 0.6, 2.4], z: 2.3 },
    server: { t: [5.4, 1.0, -4.4], z: 2.2 },
  },
};
```

In `goView`, replace `const V = VIEWS[view];` with `const V = (VIEWS[host.plan] || VIEWS.pro)[view];`. `host` is already imported at the top of the file.

- [ ] **Step 4: Rebuild, record, and re-check the audit**

```bash
npm run build:world
node vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check | tail -12
grep -rlE "\b(PRO|HQ|LAYOUT)\b" vendor/my-office/src --include=*.js | wc -l
```

Expected: the build writes `server/world.generated.ts`; the import check says `would write: 0` and lists the same five kept files as before this task (the camera bar is a stand-in in `DENY`, so it is never reported); the grep prints 45. A different number means upstream files that read the plan were added since this plan: read each new one and add it to the table under "What the cozy room changes" in the commit message and in `docs/office.md` (Task 5).

In `vendor/SOURCES.md`, in the stand-in table row for `ui/camera-bar.js`, change "the other three views are upstream's places" to "the other three views are upstream's places for the floor plan in use". Do not add a row to the hand-change list: the camera bar is a stand-in, which the file's text already describes as changed by hand.

- [ ] **Step 5: Run, check, commit**

```bash
npx vitest run client/world/camera-bar.test.ts client/world/leisure-scene.test.ts client/world/entry.test.ts server/world-script.test.ts
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
npm test -- --maxWorkers=4 > /tmp/office-piece3-task3.txt 2>&1; tail -15 /tmp/office-piece3-task3.txt
git add -A && git commit -m "feat: the camera bar's views follow the floor plan"
```

---

### Task 4: The "Floor plan" row on the settings page

**Files:**

- Create: `client/floor-plan-row.tsx`
- Modify: `client/host-switches.tsx`
- Test: `client/host-switches.mounted.test.tsx`, `client/settings-text.test.ts` (only if it lists the labels; read it first)

**Interfaces:**

- Consumes: `FLOOR_PLANS`, `FloorPlanChoice` (Task 1).
- Produces, in `client/floor-plan-row.tsx`:

```tsx
/** The row's label, and the setting a refused save names. */
export const FLOOR_PLAN_LABEL = "Floor plan";
export interface FloorPlanRowProps {
  /** The stored plan; null while the settings are read or cannot be read. */
  value: FloorPlanChoice | null;
  /** Resolves once the host has answered, and never rejects. */
  onSave(next: FloorPlanChoice): Promise<unknown>;
  problem: string | null;
  styles: OfficeStyles;
}
export function FloorPlanRow(props: FloorPlanRowProps): ReactNode;
```

- [ ] **Step 1: Write the failing tests**

In `client/host-switches.mounted.test.tsx`, add helpers next to `dayButtons`:

```tsx
const planRow = () => {
  const found = container.querySelector('[role="group"][aria-label="Floor plan"]');
  if (!found) throw new Error("No Floor plan row");
  return found as HTMLElement;
};
/** Each plan's button as `<name> <aria-pressed>`, in the row's order. */
const planButtons = () =>
  [...planRow().querySelectorAll('[role="button"]')].map(
    (button) => `${button.getAttribute("aria-label")} ${button.getAttribute("aria-pressed")}`,
  );
async function pressPlan(name: string): Promise<void> {
  await act(async () =>
    planRow().querySelector<HTMLElement>(`[role="button"][aria-label="${name}"]`)?.click(),
  );
}
```

and the tests:

```tsx
test("the floor plan row has two buttons, the stored one pressed", async () => {
  await mount();
  expect(planButtons()).toEqual(["Company floor true", "Cozy room false"]);
  stored = { ...stored, floorPlan: "cozy" };
  await mount();
  expect(planButtons()).toEqual(["Company floor false", "Cozy room true"]);
});

test("the hint says the plan is for the 3D floor only, and what a change does", async () => {
  await mount();
  const text = planRow().parentElement?.textContent ?? "";
  expect(text).toContain("The 3D floor only");
  expect(text).toContain("2D floor and the List");
  expect(text).toContain("Company floor has 12 desks");
  expect(text).toContain("Cozy room 9");
  expect(text).toContain("starts the 3D view again");
});

test("a pressed plan saves the whole document with only the plan changed", async () => {
  let reply: (saved: boolean) => void = () => undefined;
  answer = new Promise((resolve) => {
    reply = resolve;
  });
  await mount();
  await pressPlan("Cozy room");
  // The press shows at once, before the host has answered.
  expect(planButtons()).toEqual(["Company floor false", "Cozy room true"]);
  expect(saved).toEqual([{ values: { ...stored, floorPlan: "cozy" }, revision: "r1" }]);
  await act(async () => reply(true));
});

test("while the host has not answered the plan, the row takes no other press", async () => {
  let reply: (saved: boolean) => void = () => undefined;
  answer = new Promise((resolve) => {
    reply = resolve;
  });
  await mount();
  await pressPlan("Cozy room");
  await pressPlan("Company floor");
  expect(saved.map((save) => save.values.floorPlan)).toEqual(["cozy"]);
  await act(async () => reply(true));
  answer = null;
  await pressPlan("Company floor");
  expect(saved.map((save) => save.values.floorPlan)).toEqual(["cozy", "pro"]);
});

test("pressing the plan already stored saves nothing", async () => {
  await mount();
  await pressPlan("Company floor");
  expect(saved).toEqual([]);
});

test("a refused plan goes back and shows the reason under the row", async () => {
  answer = Promise.resolve(false);
  await mount();
  await pressPlan("Cozy room");
  saveError = "Settings changed on another client. Reload before saving again.";
  await mount();
  expect(planButtons()).toEqual(["Company floor true", "Cozy room false"]);
  expect(planRow().parentElement?.textContent).toContain(
    "Unable to save the Floor plan setting: Settings changed on another client.",
  );
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/host-switches.mounted.test.tsx`
Expected: FAIL: "No Floor plan row".

- [ ] **Step 3: Write the row**

`client/floor-plan-row.tsx`, modelled on `client/notes-days.tsx` (a third copy of its three-handler pill: lifting the pill out of `view-switch.tsx`, `notes-days.tsx` and here is a refactor of two files this piece does not otherwise touch, so it is left for a cleanup):

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { FLOOR_PLANS, type FloorPlanChoice } from "../shared/settings.js";
import type { OfficeStyles } from "./styles.js";

/** The row's label, and the setting a refused save names. */
export const FLOOR_PLAN_LABEL = "Floor plan";
const HINT =
  "The 3D floor only: the 2D floor and the List are the same on both. Company floor has 12 desks, Cozy room 9. Changing it starts the 3D view again.";
const NAMES: Readonly<Record<FloorPlanChoice, string>> = {
  pro: "Company floor",
  cozy: "Cozy room",
};

interface PlanProps {
  plan: FloorPlanChoice;
  on: boolean;
  disabled: boolean;
  onPress(plan: FloorPlanChoice): void;
  styles: OfficeStyles;
}

function Plan({ plan, on, disabled, onPress, styles }: PlanProps) {
  const press = useCallback(() => onPress(plan), [onPress, plan]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  let fill = null;
  if (on) fill = styles.segmentFill;
  else if (hovered || pressed) fill = styles.segmentHoverFill;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={NAMES[plan]}
      aria-pressed={on}
      disabled={disabled}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.segment}
    >
      {fill === null ? null : <View style={fill} />}
      <Text style={on ? styles.segmentTextSelected : styles.segmentText}>{NAMES[plan]}</Text>
    </Pressable>
  );
}

export interface FloorPlanRowProps {
  /** The stored plan; null while the settings are read or cannot be read. */
  value: FloorPlanChoice | null;
  /** Resolves once the host has answered, and never rejects. */
  onSave(next: FloorPlanChoice): Promise<unknown>;
  problem: string | null;
  styles: OfficeStyles;
}

/**
 * The 3D floor's plan, as the view switch's pills. The press shows, and the row takes no other,
 * until the host has answered: a second one would go against a revision already gone. A refused
 * save goes back to the stored plan. The plan already stored is not saved again.
 */
export function FloorPlanRow({ value, onSave, problem, styles }: FloorPlanRowProps) {
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  // The plan as pressed, until the host has answered; null shows the stored plan.
  const [wanted, setWanted] = useState<FloorPlanChoice | null>(null);
  const shown = wanted ?? value;
  const saving = useRef(false);
  const choose = useCallback(
    (next: FloorPlanChoice) => {
      if (shown === null || saving.current || next === shown) return;
      saving.current = true;
      setWanted(next);
      void onSave(next).finally(() => {
        saving.current = false;
        if (mounted.current) setWanted(null);
      });
    },
    [shown, onSave],
  );
  const disabled = shown === null || wanted !== null;
  return (
    <View style={styles.headerField}>
      <Text style={styles.sheetLabel}>{FLOOR_PLAN_LABEL}</Text>
      <View
        role="group"
        aria-label={FLOOR_PLAN_LABEL}
        style={disabled ? styles.segmentsDisabled : styles.segments}
      >
        {FLOOR_PLANS.map((plan) => (
          <Plan
            key={plan}
            plan={plan}
            on={shown === plan}
            disabled={disabled}
            onPress={choose}
            styles={styles}
          />
        ))}
      </View>
      <Text style={styles.fieldHint}>{HINT}</Text>
      {problem === null ? null : (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {problem}
        </Text>
      )}
    </View>
  );
}
```

In `client/host-switches.tsx`: import `{ FLOOR_PLAN_LABEL, FloorPlanRow } from "./floor-plan-row.js";`; add `| typeof FLOOR_PLAN_LABEL` to the `HostSetting` union; add

```tsx
const savePlan = useCallback(
  (next: FloorPlanChoice) => change(FLOOR_PLAN_LABEL, { floorPlan: next }),
  [change],
);
```

(import `type FloorPlanChoice` with `officeHostSettings` from `../shared/settings.js`) next to `saveDays`; and draw the row in a view of its own between the `headerControls` view and the notes fields' `headerFields` view:

```tsx
<View style={styles.headerFields}>
  <FloorPlanRow
    value={stored?.floorPlan ?? null}
    onSave={savePlan}
    problem={saveProblem(FLOOR_PLAN_LABEL)}
    styles={styles}
  />
</View>
```

Update the doc comment of `HostSwitches` ("Under them, the stand-up notes'...") to say "Under them, the 3D floor's plan, then the stand-up notes' folder, time zone and days...".

- [ ] **Step 4: Run, check, commit**

```bash
npx vitest run client/host-switches.mounted.test.tsx client/office-settings.mounted.test.tsx client/settings-text.test.ts client/engine-compat.test.ts
npm run format:check && npm run lint && npm run typecheck
npm test -- --maxWorkers=4 > /tmp/office-piece3-task4.txt 2>&1; tail -15 /tmp/office-piece3-task4.txt
git add -A && git commit -m "feat: the settings page offers the floor plan"
```

---

### Task 5: A look, and what was seen

**Files:**

- Modify: `docs/verified.md`, `README.md`, `docs/office.md`

- [ ] **Step 1: A stock daemon with the branch installed**

As `docs/verified.md` describes the earlier looks and as piece 1's plan sets out: a clean `/tmp/office-stock-home`, the published 0.16.2 daemon on port 6798 with a clean environment (`env -i`), the plugin installed by Git from the local repo at the branch's commit. `daemon status` must show 6798 and that home before any plugin command. Open the web UI at 1280 px.

- [ ] **Step 2: Look at the setting**

Open the plugin's settings page: the "Floor plan" row has "Company floor" pressed and the hint about the 3D floor only. Press "Cozy room": the press shows at once, and `office/` settings in the home hold `"floorPlan": "cozy"` (read the file the daemon keeps for the plugin's settings; do not print anything else from the home). Press "Company floor" and see it go back.

- [ ] **Step 3: Look at the floor, at 1280 and 390 px**

1. With "Company floor": the 3D floor draws as in earlier looks. Open the browser's console for the frame: no error.
2. Save "Cozy room" on the settings page, return to the office in the same tab without reloading. Record whether the floor changed by itself. If it did not: reload the office, record that it then does, and add this to `client/world/use-floor-plan.ts` and its test, as the way a surface hears another screen's save: `useEffect(() => { void settings.reload(); }, [])` after the `useSettings` call (`reload` is on the settings state), with a test that a mounted hook calls `reload` once. Write the finding in `docs/verified.md` either way.
3. With "Cozy room" the 3D floor is one open room with nine desks, the coffee corner, the aquarium and the arcade, no lobby sign, no lift. The camera bar's Overview, Desks, Meeting room and Servers each fly to the place named, at both widths; Walk in works at 1280 (W A S D, Esc) and stays inside the room; Photo mode opens and closes. The note over the floor ("No agents on this host yet...") shows as before.
4. People cannot be created on a daemon with no provider. Seat made-up ones from the browser's console, in the frame's window, in one call and look at once, because the next office update seats the real list (none) again:

```js
const w = document.querySelector("iframe").contentWindow.PaseoOfficeWorld;
const person = (i, status) => ({
  id: "a" + i,
  name: "Agent " + i,
  title: "Agent " + i,
  dir: "Acme",
  git: { repo: "Acme" },
  status,
  agent: "claude",
  lastPrompt: "",
  stuck: false,
  subs: [],
});
w.setSessions(Array.from({ length: 9 }, (_, i) => person(i + 1, i % 3 === 0 ? "work" : "rest")));
```

Nine people sit at nine desks on the cozy room, in rows of three. Run the same on the company floor with 12 and see 12. Record anything that overlaps, floats or throws. 5. Switch the plan back and forth three times and look at memory in the browser's task manager or the frame's performance panel: one scene's worth each time, not growing (the old frame's context is given back by `stop()`). 6. At 390 px: the row on the settings page fits; the cozy room's fitted view fills the frame width.

- [ ] **Step 4: What cannot be seen, and is the owner's to check on the host**

Record these in the "Not seen" table of `docs/verified.md`, as the owner's to check after the update:

- The phone's script frame on a plan change: the 3D view shows "Loading" and then the other plan, with no error, and a second change does the same.
- Real agents at the cozy room's desks: a host with more than nine agents shows nine and the note naming the rest.
- Over a day: the cozy room's resting agents going to the fish and the arcade between 08:00 and 21:00, and walking home after 21:00.
- That a change made on the desktop is seen on the phone the next time its office opens, since the setting is the host's.

- [ ] **Step 5: Docs**

- `docs/verified.md`: a section for this piece's look (what was seen at each width, the finding of step 3.2, the 12 and 9 people) and its "Not seen" rows.
- `README.md`: the "What it does" line about the 3D floor says it has two plans, the company floor and a cozy room, chosen in Settings; "What works where" is unchanged. Integrate into the existing sentences; do not append.
- `docs/office.md`: in "The 3D floor", the sentence "The floor has 12 desks." becomes "The company floor has 12 desks and the cozy room 9." and the next sentence keeps saying who sits first. Add a paragraph: the host setting "Floor plan" (stored as `pro` or `cozy`, default the company floor) is read by the surface and handed to the 3D view; a change unmounts the scene and mounts a new one, because a scene page starts once; the setting is for the 3D floor only, the 2D floor and the List do not change. List what the cozy room lacks (the lobby and its sign, the director, the meeting room's screen and so its Stand-up notes label, the lounge's games and sofa, the restroom, the dining room) and what its resting agents do (the fish and the arcade), and that headquarters comes later. Add `client/world/use-floor-plan.ts` to nothing in the table (the `client/world/` row already covers it).
- Stop the daemon by its pid; confirm 6798 is closed and 6767 untouched.

- [ ] **Step 6: Commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
git add -A && git commit -m "docs: what was seen of the floor plans on a stock daemon"
```

---

### After the tasks (controller, with the owner's go-ahead)

Final whole-branch review (read `vendor/SOURCES.md` and the camera bar's diff first: it is the only vendored file changed); fixes; merge to `main`, rebuilding `server/world.generated.ts` with `npm run build:world` if pieces 2 or 4 changed the bundle meanwhile (a conflict in that file is resolved by rebuilding, never by hand); push; CI green; `paseo plugin update office --ref <commit>` on the owner's host; the owner looks on desktop and on the phone (the Floor plan row, both plans, Desks, Meeting room and Servers on the cozy room, Walk in on desktop, the phone's change of plan, more than nine agents on the cozy room); then tag `v0.4.0` and write its release notes (a Floor plan setting: Company floor or Cozy room; headquarters follows).
