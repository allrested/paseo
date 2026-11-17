# Office walk-in Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 3D office's camera bar ends with Walk in: you walk the floor as your own chibi, press E on a prop, a game, the cat or a person, and E on a person opens that agent's session beside the floor.

**Architecture:** Upstream's `interact/first-person.js` is taken through `import-upstream.mjs` (its `DENY` line goes, the stand-in is replaced) with three small `// PASEO:` changes. The stand-in `ui/camera-bar.js` builds the Walk in button and upstream's overlay markup, and gains the field-of-view zoom, the pointer rule and the ways out. A new host hook `host.open`, set from a new start option `onOpen`, carries E on a person to `office-surface.tsx`, which calls the handler the agent card's "Open session" uses.

**Tech Stack:** Plain JavaScript in the vendored scene (upstream's style, three.js r160), TypeScript for the plugin side and the tests, vitest with jsdom, esbuild through `server/world-script.ts`.

**Spec:** `docs/superpowers/specs/2026-11-17-office-walk-in-design.md` (piece 4 of sub-project 7 of `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`). It builds on piece 2, `docs/superpowers/plans/2026-11-17-office-camera-toolbar.md`, now on `main`.

## Global Constraints

- Work in your own worktree on branch `feat/office-walk-in`, made from `main`. Do not push. Do not write in any other worktree.
- Every subagent runs on Opus.
- No commit carries AI attribution: no `Co-Authored-By` trailer, no "Generated with" line.
- Run one test file at a time, from `plugins/`: `cd plugins && npx vitest run <file relative to plugins/> --bail=1`. Never run a whole suite.
- After each task's code, from the repo root: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, then `npm run lint -- <changed .ts/.tsx files outside plugins/office/vendor/>`, then `npm run format:files -- <the same files>`.
- No upstream file under `plugins/office/vendor/my-office/` is edited by hand except `interact/first-person.js`, in three places that start with `// PASEO:`. Paseo's code there is in `paseo-*.js` and the stand-ins, in upstream's style.
- Upstream's checkout is `/tmp/ref-office/my-office` at `b68228871fe30cd2c759a2c919337a9a9d1f5644`; three.js is `/tmp/ref-office/three/node_modules/three`. If either is missing: `git clone https://github.com/khanh020905/my-office /tmp/ref-office/my-office` and check out that commit; `npm i --prefix /tmp/ref-office/three three@0.160.0`.
- Never restart or touch the daemon on port 6767. No real agent is created or prompted.
- Snippets are in `text` fences on purpose, so the formatter leaves them as they are.

Binding values from the spec:

- The button: the camera bar's end, after Photo mode. Upstream's `btn-fp`, class `tb-fp`, icon `walk`, `aria-label` and `title` `Walk in`, `aria-pressed` while on. It is shown only while `matchMedia('(pointer: fine)')` matches, and hidden when it stops matching.
- A view press, Photo mode and the List leave walk-in first. While walking, Zoom in and Zoom out change `fpCam.fov` within 40 to 90 by 8; the percent is the field of view's zoom over 70.
- `import-upstream.mjs`'s `DENY` lets `interact/first-person.js` through. `life/seasons.js` gains `export const floorBlocks = []`. `world/backdrops/index.js` keeps `THEMES` as it is.
- The street is cut in one `// PASEO:` change: `street()` returns null. `floorBounds` stays exported from `first-person.js`, as a second marked addition.
- Keys are upstream's: WASD or arrows, Shift to run, V third person, E act, Escape leave. Only while the frame has the keyboard.
- The overlay is upstream's `FirstPersonHud` markup (crosshair, hint button, help line, Exit) in upstream's style. The touch line and the joystick are left out.
- E on a prop, a game and the cat is upstream's (`activateProp`, the games' own seating, `petCat`). E on a person calls `openSession(id)` of the stand-in drawer with `opts.open`, which calls `host.open(id)`. The world API gains `onOpen(agentId)`. Walk-in stays on.
- No pointer lock. Not built: the street, the lift trip, the shops, walking on touch screens.

Decided in this plan, where the spec left it open:

- Escape: upstream leaves walk-in from `ui/topbar.js`, which Paseo does not take. `camera-bar.js`'s `setup()` gets that listener: Escape leaves walk-in unless the place card is open. The games' own Escape handlers run first (capture phase, `stopPropagation`), so Escape at a game stands you up and does not also leave walk-in.
- `first-person.js`'s `setup()` reads `#fp-joy` and has no guard. The overlay therefore keeps an `#fp-joy` element, and the style keeps upstream's `display: none` for it; nothing shows it.
- `.is-fp .team-tag` and `.is-fp .zone` are hidden, as upstream's `places.css` lines 14 and 19 do: `interact/place-chips.js` stops moving them while walking, so they would hang in the air.
- Upstream's pool-table HUD style (`.bil-hud`, stage.css lines 46 to 53) and `.is-gaming` rule come with the overlay's style; without them pool in first person draws an unstyled HUD.
- The percent while walking is `Math.round(70 / fpCam.fov * 100)%`, so it reads 100% at the camera's start (`fpCam` is built with a fov of 70) and rises as the field narrows.
- Walk-in reads `host.open` only through `openSession(id, { open: true })`. `first-person.js`'s third `// PASEO:` change passes `{ open: true }`. With `host.open` null the call falls through to the stand-in's normal choice, which opens Paseo's agent card.
- A drawer test of its own, `client/world/session-drawer.test.ts`, pins `opts.open`.

## Files shared with other branches

| File                                                                           | Also edited by                              | How to keep the merge small                                                            |
| ------------------------------------------------------------------------------ | ------------------------------------------- | -------------------------------------------------------------------------------------- |
| `plugins/office/vendor/my-office/import-upstream.mjs`                          | none known                                  | Delete the one `first-person` line of `DENY`. Nothing else.                            |
| `plugins/office/vendor/my-office/MANIFEST.json`, `src/office/paseo-modules.js` | none known (generated)                      | Generated. On a conflict, rerun the script after the merge instead of merging by hand. |
| `plugins/office/vendor/my-office/src/office/paseo-entry.js`                    | the team-chat piece (it has its own design) | One line, beside `host.notes`.                                                         |
| `plugins/office/vendor/my-office/src/office/paseo-host.js`                     | the team-chat piece                         | One property, `open`, after `notes`.                                                   |
| `plugins/office/client/world/world-api.ts`, `world-view.tsx`, `entry.test.ts`  | the team-chat piece                         | `onOpen` after `onNotes`; tests at the end of `entry.test.ts`.                         |
| `plugins/office/client/office-surface.tsx`                                     | piece 3 (side panels), the team-chat piece  | One prop on `<WorldView>`: `onOpenSession={onOpenSession}`.                            |
| `plugins/office/vendor/SOURCES.md`                                             | any piece that takes a file                 | Edit the walk bullets in place (see Task 1).                                           |

Not touched by this plan: `contracts.ts`, `hub.ts`, `index.server.ts`, `styles.ts`, `list-text.ts`, `world-frame.web.ts`, anything under `packages/`.

## Review Focus

1. **The page must not break between tasks.** `first-person.js`'s `setup()` reads `#btn-fp`, `#fp-hud`, `#fp-near`, `#fp-exit` and `#fp-joy` and holds no guard. Task 1 takes the file and builds those elements in the same commit. Pinned in Task 1's two tests.
2. **The street is dead code that still bundles.** `street()` already returns null today, because `THEME` is never `THEMES.city` (`world/backdrops/index.js` sets `THEMES = { plain }`). The marked change makes it explicit. Pinned in Task 1's source test.
3. **Escape at a game or at the place card.** One Escape does one thing. Pinned in Task 2.
4. **E on a person with the keyboard.** `world-view.tsx` calls `focusApp()` for `onOpen`, so the keys go to the session beside the floor; the person walks no more until you click the floor. Checked in Task 4.
5. **The List.** Switching view unmounts `WorldView` (`office-surface.tsx`, the `view === "3d"` branch), which takes the frame and the walk with it. There is no code for it. Checked in Task 4.
6. **A bar too narrow for its tenth control.** Walk in joins nine controls. At 390 px with a fine pointer the bar still fits. Checked in Task 4.

---

### Task 1: Take the walk, with its button and overlay

**Files:**

- Modify: `plugins/office/vendor/my-office/import-upstream.mjs` (the `first-person` line of `DENY`)
- Delete, then regenerate: `plugins/office/vendor/my-office/src/office/interact/first-person.js`
- Generated: `plugins/office/vendor/my-office/MANIFEST.json`, `src/office/paseo-modules.js`
- Modify: `plugins/office/vendor/my-office/src/office/interact/first-person.js` (two marked changes, one marked addition)
- Modify: `plugins/office/vendor/my-office/src/office/life/seasons.js` (`floorBlocks`)
- Modify: `plugins/office/vendor/my-office/src/office/ui/camera-bar.js` (markup, style, header comment)
- Modify: `plugins/office/vendor/SOURCES.md`
- Test: `plugins/office/server/world-script.test.ts`, `plugins/office/client/world/camera-bar.test.ts`, `plugins/office/client/world/first-person.test.ts` (new)

**Interfaces:**

- Produces: upstream's `fp`, `fpUpdate`, `exitFp`, `buildGrid`, `blocked`, `toStreet`, plus `floorBounds(): { x0, x1, z0, z1 }`. The bar's markup has `#btn-fp`, `#fp-hud`, `#fp-near`, `#fp-exit`, `#fp-joy`.
- Consumes: the stand-ins `world/backdrops/index.js` (`THEME`, `THEMES`), `ui/activity.js` (`toast`), `ui/session-drawer.js` (`openSession`, `closeSession`), `life/seasons.js` (`floorBlocks`).

- [ ] **Step 1: Write the failing tests.**

In `world-script.test.ts`, under "the vendored entry":

```text
it("bundles upstream's first-person walk, with the street cut", async () => {
  const walk = readFileSync(
    new URL("../vendor/my-office/src/office/interact/first-person.js", import.meta.url),
    "utf8",
  );
  const bundle = await bundleBrowserScript(worldEntryPath(OFFICE_DIRECTORY));

  expect(walk).not.toContain("stand-in");
  expect(walk).toMatch(/\/\/ PASEO:[^\n]*\n\s*const street = \(\) => null;/);
  expect(walk).toMatch(/export const floorBounds/);
  expect(walk).toContain("open: true");
  expect(bundle).toContain("fp-near");
}, 60_000);
```

In `camera-bar.test.ts`: add a mock of the walk at the top, beside the other mocks (the real file loads the renderer, the rig and the props, none of which this test stands in):

```text
vi.mock("../../vendor/my-office/src/office/interact/first-person.js", () => ({
  floorBounds: () => ({ x0: -7.85, x1: 15.3, z0: -7.85, z1: 11.3 }),
  fp: { on: false },
  exitFp() {},
}));
```

Change the first test to nine controls (`"Photo mode", "Walk in"`), and add:

```text
test("every element first-person.js wires is built before the modules run", () => {
  // first-person.js's setup reads these ids and holds no guard: a missing one throws before the office draws.
  build();
  for (const id of ["btn-fp", "fp-hud", "fp-near", "fp-exit", "fp-joy"]) {
    expect(document.getElementById(id), id).not.toBeNull();
  }
  expect(page("fp-hud").hidden).toBe(true);
  expect(page("btn-fp").getAttribute("aria-pressed")).toBe("false");
  expect(page("btn-fp").getAttribute("title")).toBe("Walk in");
});

test("the overlay's style keeps upstream's light ink and hides the chips while walking", () => {
  build();
  const css = [...document.querySelectorAll("style")].map((s) => s.textContent).join("\n");
  expect(css).toMatch(/\.fp-help \{[^}]*color: #8D97AA;/);
  expect(css).toMatch(/\.is-fp \.zone/);
  expect(css).toMatch(/\.bil-hud \{/);
});
```

Create `first-person.test.ts`. It drives the real `first-person.js` with the world around it stood in, and builds the page with the real `build()`:

```text
// @vitest-environment jsdom
// Upstream's walk (interact/first-person.js) in Paseo's page: the bar's overlay is the real one, the
// renderer, the rig, the props and the people are stood in with the little the walk reads.
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  workers: new Map<string, Record<string, unknown>>(),
  sessions: new Map<string, Record<string, unknown>>(),
  openSession: vi.fn(),
  petCat: vi.fn(),
  activateProp: vi.fn(),
}));

vi.mock("../../vendor/my-office/src/office/scene/renderer.js", async () => {
  const THREE = await import("../../vendor/my-office/three/three.module.min.js");
  return {
    camera: new THREE.OrthographicCamera(-1, 1, 1, -1),
    controls: { enabled: true, target: new THREE.Vector3(), minZoom: 0.5, maxZoom: 3.4, update() {} },
    fpCam: new THREE.PerspectiveCamera(70, 1, 0.05, 240),
    renderPass: { camera: null },
    renderer: { domElement: document.createElement("canvas") },
    resize() {},
    scene: new THREE.Scene(),
  };
});
vi.mock("../../vendor/my-office/src/office/people/chibi-rig.js", async () => {
  const THREE = await import("../../vendor/my-office/three/three.module.min.js");
  return {
    makeChibi: () => ({ root: new THREE.Group(), P: { D: { hipY: 0.6, headY: 0.9, sitY: 0.1 } } }),
    chibiPose: () => ({}),
    applyChibiPose: () => 0,
  };
});
vi.mock("../../vendor/my-office/src/office/world/props/cat.js", () => ({
  cat: { pos: { x: 100, y: 100 } },
  petCat: h.petCat,
}));
vi.mock("../../vendor/my-office/src/office/people/navigation.js", () => ({
  DOOR_IN: { x: -6.5, z: 3 },
  DOOR_OUT: { x: -8, z: 3 },
}));
vi.mock("../../vendor/my-office/src/office/world/entrance.js", () => ({ DZ: 0, LIFT_X: -7.5, lift: null }));
vi.mock("../../vendor/my-office/src/office/world/backdrops/index.js", () => ({ THEME: undefined, THEMES: undefined }));
vi.mock("../../vendor/my-office/src/office/ui/activity.js", () => ({ toast() {} }));
vi.mock("../../vendor/my-office/src/office/audio/sfx.js", () => ({ sfx: { play() {} } }));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  sessions: h.sessions,
  workers: h.workers,
  subs: new Map(),
}));
vi.mock("../../vendor/my-office/src/office/ui/session-drawer.js", () => ({
  openSession: h.openSession,
  closeSession() {},
}));
vi.mock("../../vendor/my-office/src/office/interact/props.js", () => ({
  PROPS: new Map(),
  activateProp: h.activateProp,
  propHint: () => "",
}));
vi.mock("../../vendor/my-office/src/office/core/loop.js", () => ({ focusTarget: null }));
vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({ host: { toast() {} } }));

const { build } = await import("../../vendor/my-office/src/office/ui/camera-bar.js");
const { fp, fpUpdate, setup } = await import("../../vendor/my-office/src/office/interact/first-person.js");

const key = (code: string, type = "keydown") => document.dispatchEvent(new KeyboardEvent(type, { code }));
const page = (id: string) => document.getElementById(id) as HTMLElement;

/** A person two metres ahead of where the walk starts, facing along +x. */
function seatAhead(): void {
  h.sessions.set("ada", { name: "Ada" });
  h.workers.set("ada", {
    id: "ada",
    pos: { x: fp.pos.x + 1.5, y: fp.pos.y },
    root: { visible: true },
    cfg: { name: "Ada" },
    anim: "type",
    sub: false,
  });
}

beforeEach(() => {
  document.body.innerHTML = '<div id="stage-wrap"><div id="stage"></div></div>';
  h.workers.clear();
  h.sessions.clear();
  h.openSession.mockReset();
  h.petCat.mockReset();
  build();
  setup();
});

test("the Walk in button enters, shows the overlay and presses itself; Exit leaves", () => {
  page("btn-fp").click();
  expect(fp.on).toBe(true);
  expect(page("fp-hud").hidden).toBe(false);
  expect(page("btn-fp").getAttribute("aria-pressed")).toBe("true");
  expect(document.body.classList.contains("is-fp")).toBe(true);

  page("fp-exit").click();
  expect(fp.on).toBe(false);
  expect(page("fp-hud").hidden).toBe(true);
  expect(page("btn-fp").getAttribute("aria-pressed")).toBe("false");
});

test("W walks forward and Shift runs faster", () => {
  page("btn-fp").click();
  const x0 = fp.pos.x;
  key("KeyW");
  fpUpdate(0.5);
  const walked = fp.pos.x - x0;
  expect(walked).toBeGreaterThan(0.9);
  key("ShiftLeft");
  fpUpdate(0.5);
  expect(fp.pos.x - x0 - walked).toBeGreaterThan(walked);
  page("fp-exit").click();
});

test("keys do nothing while a text field has them", () => {
  page("btn-fp").click();
  const input = document.createElement("input");
  document.body.append(input);
  const x0 = fp.pos.x;
  input.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyW", bubbles: true }));
  fpUpdate(0.5);
  expect(fp.pos.x).toBe(x0);
  page("fp-exit").click();
});

test("E by a person opens their session and keeps walking", () => {
  page("btn-fp").click();
  seatAhead();
  fpUpdate(0.016);
  expect(page("fp-near").hidden).toBe(false);
  expect(page("fp-near").textContent).toContain("Ada");

  key("KeyE");
  expect(h.openSession).toHaveBeenCalledWith("ada", { open: true });
  expect(fp.on).toBe(true);
  page("fp-exit").click();
});

test("the door has no E action: the street is not taken", () => {
  page("btn-fp").click();
  fpUpdate(0.016);
  key("KeyE");
  expect(h.openSession).not.toHaveBeenCalled();
  expect(fp.street).toBe(false);
  page("fp-exit").click();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd plugins && npx vitest run office/client/world/first-person.test.ts --bail=1`, then `npx vitest run office/client/world/camera-bar.test.ts --bail=1`, then `npx vitest run office/server/world-script.test.ts --bail=1`
Expected: FAIL each (the stand-in has no `setup`; the bar has no `#btn-fp`; the file still says stand-in).

- [ ] **Step 3: Take the file.**

1. Delete the `/^office\/interact\/first-person\.js$/,` line of `DENY` in `import-upstream.mjs`.
2. Add `export const floorBlocks = [];` to `life/seasons.js`, under a `// PASEO:` note that it is the season's merged footprints, of which Paseo has none.
3. The script never overwrites a file that carries a `PASEO:` note, and the stand-in does. Delete the stand-in first, after copying its `floorBounds` lines (the `export const floorBounds = ...` line and its doc comment) aside. They are still in git (`git show HEAD:plugins/office/vendor/my-office/src/office/interact/first-person.js`):

```bash
rm plugins/office/vendor/my-office/src/office/interact/first-person.js
node plugins/office/vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three
```

Expected: `written: 2` (`first-person.js` and `paseo-modules.js`), `MANIFEST.json` rewritten, no line under "stand-ins to write or extend". `paseo-modules.js` gains `interactFirstPerson`, between `uiPhoto` and `netLive`. The English locale index is unchanged: the `fp` area was already taken for the games.

4. Make the three marked changes in `first-person.js`:
   - `street`: above it, `// PASEO: the street is not taken (world/backdrops/ is not), so there is no lift to it.` and replace the body with `const street = () => null;`.
   - `interact()`: the last line becomes, under `// PASEO: a person's session opens beside the floor (ui/session-drawer.js's opts.open); the walk stays on.`, `if (w.sub) { if (w.parent) openSession(w.parent.id, { open: true }); } else openSession(w.id, { open: true });`.
   - After `export function blocked`, add the stand-in's `floorBounds` with its comment, under `// PASEO: the floor's bounds, which ui/camera-bar.js fits the camera to.`
5. Run `node plugins/office/vendor/my-office/import-upstream.mjs ... --check`. Expected: `interact/first-person.js` is in the "kept (carry a PASEO: note)" list with `core/env.js`, `interact/place-cards.js`, `life/tests.js` and `ui/photo.js`; `written: 0`.

- [ ] **Step 4: Build the button and the overlay in `camera-bar.js`.** In `BAR`, after `.tb-tools`, inside `.toolbar`, add upstream's button; after the toolbar's closing `</div>` and before the photo bar, add the overlay. In `STYLE`, add the walk's rules. Update the header comment: first person is taken, only the automatic camera and the list are not.

```text
<button type="button" class="tb-fp" id="btn-fp" aria-pressed="false" aria-label="Walk in" title="Walk in"><span data-icon="walk"></span><span>Walk in</span></button>

<div class="fp-hud" id="fp-hud" hidden>
  <i class="fp-cross" aria-hidden="true"></i>
  <button type="button" class="fp-near" id="fp-near" hidden></button>
  <div class="fp-help"><b>Walking the office</b><span>W A S D to walk · drag to look · Shift to run · E to use what is in front of you (or wake someone up) · V to switch view · Esc to exit</span></div>
  <button type="button" class="fp-exit" id="fp-exit"><span data-icon="x"></span><span>Exit</span></button>
  <div class="fp-joy" id="fp-joy" aria-hidden="true"><i></i></div>
</div>
```

The style is upstream's `src/styles/stage.css` lines 32 to 35 (`.tb-fp`), 36 to 45, 46 to 53 (`.bil-hud`), 54 (`.fp-near kbd`) and 55 to 56 (`.fp-joy`, kept at `display: none`), plus `places.css` lines 14 and 19 (`.is-fp .team-tag`, `.is-fp .zone`). Leave out `.fp-touch`, `.fp-fade`, the `(pointer: coarse)` rule and `.chips`. As the bar's style already does, use literals for upstream's colour variables, so the light theme does not turn them dark on their dark panels:

```text
--ink #E8ECF4   --muted #8D97AA   --amber #F2B544   --green #3DDC84   --line-2 rgba(255, 255, 255, .13)
--card-2 #1E2734   --accent var(--o-accent, #EF8A5F)   --accent-hi #F5A07A
--accent-soft rgba(239, 138, 95, .13)   --accent-line rgba(239, 138, 95, .6)   --on-accent #2A1307
```

`.fp-exit` and `.fp-help` set `color: #E8ECF4` and `#8D97AA` themselves (upstream lets `.fp-exit` inherit the page's ink, which is near-black in Paseo's light theme). Add:

```text
@media (max-width: 520px) { .tb-fp span:last-child { display: none; } .tb-fp { padding: 0 11px; } .fp-help { top: 56px; max-width: calc(100% - 24px); } }
```

- [ ] **Step 5: Update `SOURCES.md`.** Edit the walk's sentences in place, as the rule for docs here is to integrate, not append: the paragraph under "What is taken" that says the walk is not taken (lines 26 to 29, "The games call the group chat, the sounds and the first-person walk"), the "What is not taken" paragraph (drop "the first-person walk" and "Walk in"), and the stand-in table (delete the `interact/first-person.js` row; the `life/seasons.js` stand-in is not in the table, so leave it). Add `interact/first-person.js` to "Four copied files are changed by hand" (now five) with: the street is cut (`street()` returns null), E on a person passes `opts.open`, and `floorBounds` is exported for the camera bar. Add `ui/camera-bar.js`'s row text: "and Walk in with its overlay".

- [ ] **Step 6: Run the tests to see them pass**

Run: `cd plugins && npx vitest run office/client/world/first-person.test.ts --bail=1`, then `npx vitest run office/client/world/camera-bar.test.ts --bail=1`, then `npx vitest run office/server/world-script.test.ts --bail=1`, then `npx vitest run office/client/world/entry.test.ts --bail=1`
Expected: PASS each. If the first-person test fails on a missing mock export, add that export to the mock the error names: the list is the imports of `first-person.js`, and the test stands in only what the walk reads.

- [ ] **Step 7: Typecheck, lint, format, commit**

```bash
git add plugins/office/vendor plugins/office/server/world-script.test.ts plugins/office/client/world
git commit -m "feat(office): take upstream's first-person walk, with its button and overlay"
```

### Task 2: The bar's behaviour while walking

**Files:**

- Modify: `plugins/office/vendor/my-office/src/office/ui/camera-bar.js` (`setup()`)
- Test: `plugins/office/client/world/camera-bar.test.ts`

**Interfaces:**

- Consumes: `fp`, `exitFp` from `interact/first-person.js`; `fpCam` from `scene/renderer.js`.
- Produces: nothing new exported. `setup()` hides `#btn-fp` unless the pointer is fine, sends zoom to `fpCam.fov` while `fp.on`, leaves walk-in on a view press and on Escape.

- [ ] **Step 1: Write the failing tests** in `camera-bar.test.ts`. Extend the walk mock so a test can turn walking on and watch the exit, and give the renderer mock a `fpCam`:

```text
const h = vi.hoisted(() => ({ /* the existing fields */ exitFp: vi.fn(), fp: { on: false } }));

vi.mock("../../vendor/my-office/src/office/interact/first-person.js", () => ({
  floorBounds: () => ({ x0: -7.85, x1: 15.3, z0: -7.85, z1: 11.3 }),
  fp: h.fp,
  exitFp: h.exitFp,
}));
// in the renderer mock's return value:
//   fpCam: { fov: 70, updateProjectionMatrix() {} },
```

`open()` stubs the pointer media query, which the frame's browser always has and jsdom does not:

```text
/** The pointer media query: `change(fine)` is the device's pointer changing. */
function pointer(fine: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: fine,
    addEventListener: (_: string, listener: () => void) => listeners.add(listener),
  };
  vi.stubGlobal("matchMedia", () => query);
  return {
    change(next: boolean) {
      query.matches = next;
      for (const listener of listeners) listener();
    },
  };
}
// open({ fine = true } = {}) calls pointer(fine) before setup() and returns its handle.
```

`beforeEach` resets `h.fp.on = false`, `h.exitFp.mockReset()`, and `fpCam.fov = 70`. Tests:

```text
test("Walk in is shown for a fine pointer and hidden for a coarse one, and follows a change", () => {
  const fine = open({ fine: false });
  expect(page("btn-fp").hidden).toBe(true);
  fine.change(true);
  expect(page("btn-fp").hidden).toBe(false);
  fine.change(false);
  expect(page("btn-fp").hidden).toBe(true);
});

test("a view press leaves walk-in first", () => {
  open();
  h.fp.on = true;
  click("[data-view=desks]");
  expect(h.exitFp).toHaveBeenCalledTimes(1);
});

test("zoom while walking changes the field of view by 8, within 40 and 90", () => {
  open();
  h.fp.on = true;
  click("#zoom-in");
  expect(fpCam.fov).toBe(62);
  for (let i = 0; i < 6; i += 1) click("#zoom-in");
  expect(fpCam.fov).toBe(40);
  for (let i = 0; i < 8; i += 1) click("#zoom-out");
  expect(fpCam.fov).toBe(90);
  expect(state.zoomGoal).toBeNull();
});

test("the percent while walking is the field of view's zoom over 70", () => {
  open();
  h.fp.on = true;
  vi.advanceTimersByTime(200);
  expect(page("zoom-val").textContent).toBe("100%");
  click("#zoom-in");
  vi.advanceTimersByTime(200);
  expect(page("zoom-val").textContent).toBe("113%");
});

test("Escape leaves walk-in, but not while the place card is open", () => {
  open();
  document.body.insertAdjacentHTML("beforeend", '<div id="plc"></div>');
  h.fp.on = true;
  page("plc").hidden = false;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.exitFp).not.toHaveBeenCalled();

  page("plc").hidden = true;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.exitFp).toHaveBeenCalledTimes(1);
});

test("Escape does nothing while not walking", () => {
  open();
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(h.exitFp).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd plugins && npx vitest run office/client/world/camera-bar.test.ts --bail=1`
Expected: FAIL.

- [ ] **Step 3: Write the behaviour in `setup()`.** Import `fp, exitFp` from `../interact/first-person.js` (it already imports `floorBounds`) and `fpCam` from `../scene/renderer.js`. Then:

```text
// view press: first line of the .tb-seg click handler, before closeSession
if (fp.on) exitFp();

$('zoom-in').addEventListener('click', () => {
  if (fp.on) { fpCam.fov = Math.max(40, fpCam.fov - 8); fpCam.updateProjectionMatrix(); return; }
  setView(null); state.zoomGoal = Math.min(controls.maxZoom, (state.zoomGoal ?? camera.zoom) * 1.2);
});
$('zoom-out').addEventListener('click', () => {
  if (fp.on) { fpCam.fov = Math.min(90, fpCam.fov + 8); fpCam.updateProjectionMatrix(); return; }
  setView(null); state.zoomGoal = Math.max(controls.minZoom, (state.zoomGoal ?? camera.zoom) / 1.2);
});

// the percent: the field of view's zoom over the start's 70 while walking
const v = `${Math.round((fp.on ? 70 / fpCam.fov : camera.zoom / (fitZoom || 1)) * 100)}%`;

// Walk in needs keys: shown for a fine pointer only (a phone could only look around)
const fine = matchMedia('(pointer: fine)');
const showWalk = () => { $('btn-fp').hidden = !fine.matches; };
showWalk(); fine.addEventListener('change', showWalk);

// upstream leaves walk-in from ui/topbar.js, which is not taken: the place card goes first, as there
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !fp.on) return;
  const card = $('plc');
  if (card && !card.hidden) return;
  exitFp();
});
```

Edit the existing zoom handlers and the interval in place; do not leave a second copy.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd plugins && npx vitest run office/client/world/camera-bar.test.ts --bail=1`, then `npx vitest run office/client/world/first-person.test.ts --bail=1`
Expected: PASS each.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
git add plugins/office/vendor/my-office/src/office/ui/camera-bar.js plugins/office/client/world/camera-bar.test.ts
git commit -m "feat(office): the camera bar's zoom, views and Escape know about walking in"
```

### Task 3: E on a person opens their session beside the floor

**Files:**

- Modify: `plugins/office/vendor/my-office/src/office/paseo-host.js` (`open: null`)
- Modify: `plugins/office/vendor/my-office/src/office/ui/session-drawer.js` (`opts.open`)
- Modify: `plugins/office/vendor/my-office/src/office/paseo-entry.js` (one line, beside `host.notes`)
- Modify: `plugins/office/client/world/world-api.ts` (`onOpen`)
- Modify: `plugins/office/client/world/world-view.tsx` (`onOpenSession` prop, `onOpen` start option)
- Modify: `plugins/office/client/office-surface.tsx` (one prop)
- Test: `plugins/office/client/world/session-drawer.test.ts` (new), `plugins/office/client/world/entry.test.ts` (tests at the end)

**Interfaces:**

- Produces: `WorldStartOptions.onOpen?(agentId: string): void`; `host.open: ((id: string) => void) | null`; `openSession(id, { open: true })` calls `host.open(id)`.
- Consumes: `office-surface.tsx`'s `onOpenSession`, the same handler the agent card's "Open session" and the List use (`openSessionWith(navigation, agentId)`), given to `<WorldView>` only where it is defined.

Depends on Task 1 (`first-person.js` passes `{ open: true }`). Does not depend on Task 2.

- [ ] **Step 1: Write the failing tests.**

`session-drawer.test.ts`:

```text
// @vitest-environment jsdom
// ui/session-drawer.js, the stand-in: a chosen person goes to Paseo; with opts.open, their session opens.
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ sessions: new Map<string, object>([["ada", {}]]) }));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({ BASE_ZOOM: 1, camera: { zoom: 1 } }));
vi.mock("../../vendor/my-office/src/office/core/loop.js", () => ({ focusTarget: null }));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  sessions: h.sessions,
  workers: new Map(),
}));
vi.mock("../../vendor/my-office/src/office/ui/camera-bar.js", () => ({ setView() {} }));

const { state } = await import("../../vendor/my-office/src/office/core/state.js");
const { host } = await import("../../vendor/my-office/src/office/paseo-host.js");
const { openSession } = await import("../../vendor/my-office/src/office/ui/session-drawer.js");

beforeEach(() => {
  state.selectedId = null;
  host.open = null;
  host.select = vi.fn();
});

test("opts.open asks Paseo to open the session and chooses no one", () => {
  const open = vi.fn();
  host.open = open;
  openSession("ada", { open: true });
  expect(open).toHaveBeenCalledWith("ada");
  expect(host.select).not.toHaveBeenCalled();
  expect(state.selectedId).toBeNull();
});

test("opts.open with nothing to open it falls back to choosing the person", () => {
  openSession("ada", { open: true });
  expect(host.select).toHaveBeenCalledWith("ada");
});

test("a plain call still chooses the person", () => {
  openSession("ada");
  expect(state.selectedId).toBe("ada");
  expect(host.select).toHaveBeenCalledWith("ada");
});

test("someone the scene does not know opens nothing", () => {
  const open = vi.fn();
  host.open = open;
  openSession("nobody", { open: true });
  expect(open).not.toHaveBeenCalled();
});
```

`entry.test.ts`, at the end (it uses `startPage`, which starts a fresh page; read `host` from the fresh module, as the file's other tests of `host` do — if `host` is the first page's, import it again after `startPage` with `await import(...)`):

```text
test("onOpen is what the scene calls to open a person's session", async () => {
  const open = vi.fn();
  await startPage({ onOpen: open });
  const { host: fresh } = await import("../../vendor/my-office/src/office/paseo-host.js");

  fresh.open?.("ada");
  expect(open).toHaveBeenCalledWith("ada");
});

test("without onOpen the scene has nothing to open a session with", async () => {
  await startPage({});
  const { host: fresh } = await import("../../vendor/my-office/src/office/paseo-host.js");

  expect(fresh.open).toBeNull();
});
```

In `world-script.test.ts`'s existing test that checks the options reach the bundle (line 48 to 52 area), add `expect(script).toContain("onOpen");`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd plugins && npx vitest run office/client/world/session-drawer.test.ts --bail=1`, then `npx vitest run office/client/world/entry.test.ts --bail=1`
Expected: FAIL.

- [ ] **Step 3: Write the scene side.**

`paseo-host.js`, after `notes`:

```text
  /** A person's session was asked for (E by them while walking); null while Paseo has nowhere to open it. */
  open: null,
```

`session-drawer.js`, in `openSession`, after the `sessions.has` guard, with the `opts` doc comment extended:

```text
  // PASEO: walking in (interact/first-person.js) opens the session beside the floor and stays where it is.
  if (opts.open && host.open) { host.open(id); return; }
```

`paseo-entry.js`, beside `host.notes`:

```text
    host.open = typeof options.onOpen === 'function' ? (id) => options.onOpen(id) : null;
```

Add `onOpen` to the start options' doc comment at line 252 if it lists them.

- [ ] **Step 4: Write the plugin side.**

`world-api.ts`, in `WorldStartOptions`, after `onNotes`:

```text
  /**
   * A person's session was asked for: E by them while walking in. Absent where Paseo has no way to
   * open a session beside the floor; the scene then chooses the person, as a click does.
   */
  onOpen?(agentId: string): void;
```

`world-view.tsx`: add `onOpenSession: ((agentId: string) => void) | undefined;` to `WorldViewProps` (doc: the agent card's "Open session"; read when the office starts, as `onOpenResources`), destructure it, add it to `latest`'s object and its effect's list, and in the `api.start` options, after the `onResources` spread:

```text
          // Given only where the office can open a session (the agent card's "Open session"): otherwise a
          // person under E is chosen, as a click does. The keyboard goes with the session.
          ...(latest.current.onOpenSession === undefined
            ? {}
            : {
                onOpen: (agentId: string) => {
                  focusApp();
                  latest.current.onOpenSession?.(agentId);
                },
              }),
```

`office-surface.tsx`, on `<WorldView>` (the `view === "3d"` branch near line 631), add `onOpenSession={onOpenSession}`.

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd plugins && npx vitest run office/client/world/session-drawer.test.ts --bail=1`, then `npx vitest run office/client/world/entry.test.ts --bail=1`, then `npx vitest run office/server/world-script.test.ts --bail=1`, then `npx vitest run office/client/world/first-person.test.ts --bail=1`
Expected: PASS each.

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
git add plugins/office/vendor/my-office/src/office plugins/office/client plugins/office/server/world-script.test.ts
git commit -m "feat(office): E by a person opens their session beside the floor"
```

### Task 4: Look at it in a browser and in the app

**Files:**

- Modify: `docs/superpowers/specs/2026-11-17-office-walk-in-design.md` ("Not verified", Status to built; correct the lines the code disproved, see below)
- Modify: `docs/superpowers/specs/2026-11-16-office-owner-review-design.md` (Status: piece 4 built)

- [ ] **Step 1: The scene alone.** Bundle the scene as the app does and serve it as a static page, as piece 2's check did, with software WebGL, at 1280 x 800 and a 390 px frame with a mouse. Walk the floor (W, A, S, D, arrows, Shift, a drag to look), V to third person and back, the zoom buttons while walking (the percent moves, a view press leaves), E at a prop (the coffee machine, the arcade), at the cat, at a person (the page logs `onOpen` with the id), and at the games TV (seat, then E and Escape each stand up, and Escape does not also leave the walk). Escape out. The bar at 390 px fits. Photo mode while walking leaves the walk.

- [ ] **Step 2: In the app.** Start a dev daemon of this worktree (`npm run dev`, never port 6767) with the office's fixtures. On the office screen and in the office panel: Walk in, walk, E at a person opens the session beside the floor and the walk stays on, a click in the floor gives the keys back. The List button ends the walk. Hide the pointer's fineness (a phone-sized touch emulation): the button is gone.

- [ ] **Step 3: Write what was seen and what was not** in the spec's "Not verified", in the style of the earlier office specs. In the same edit, correct the spec's lines that the code disproved: Escape is Paseo's (`camera-bar.js`), not upstream's `first-person.js`; `street()` already returned null; the overlay keeps a hidden `#fp-joy`; E on a person also needs a third marked change; the style also carries the pool HUD and the hidden chips.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-17-office-walk-in-design.md docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git commit -m "docs(office): walking in is built"
```

## Order

Task 1 first: it replaces the stand-in and builds the elements the walk's `setup()` reads, so the page works after it. Tasks 2 and 3 can run in parallel after Task 1: Task 2 edits `camera-bar.js`'s `setup()` and its test; Task 3 edits the host, the drawer, the entry, the world API, `world-view.tsx`, `office-surface.tsx` and `entry.test.ts`. Neither edits a file the other does. Task 4 is last.

## Self-review

- Spec coverage: the button and the pointer rule (Tasks 1, 2); views, Photo mode and List leaving the walk (Task 2; Photo mode is upstream's `ui/photo.js` line 24; the List is an unmount, Review Focus 5); zoom by fov (Task 2); the file taken with the street cut, `floorBlocks`, `THEMES` untouched (Task 1); keys and the keyboard rule (upstream's, plus Escape in Task 2); overlay (Task 1); E on a prop, a game and the cat (upstream's, no code); E on a person, `opts.open`, `host.open`, `onOpen`, `office-surface.tsx` (Task 3); `import-upstream --check`, `world-script.test.ts`, the bar tests, the entry test (Tasks 1 to 3); browser and live checks (Task 4).
- The spec's entry test "enters walk-in, walks, presses E by a person and sees `onOpen` with its id" is split in three: `first-person.test.ts` walks and presses E and sees `openSession(id, { open: true })`; `session-drawer.test.ts` sees `host.open(id)`; `entry.test.ts` sees `onOpen(id)`. `entry.test.ts` stands the whole scene in, so it cannot walk.
- Names agree across tasks: `floorBounds`, `floorBlocks`, `host.open`, `onOpen`, `onOpenSession`, `opts.open`, `#btn-fp`, `#fp-hud`, `#fp-near`, `#fp-exit`, `#fp-joy`.
- No placeholders. The style's colour values are listed in Task 1, Step 4.
