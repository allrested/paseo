# paseo-office piece 4: camera extras Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 3D floor gets my-office's automatic camera, photo mode's Auto, Day and Night buttons, the first-visit tour, and 15-second clip recording on desktop and in browsers.

**Architecture:** All of it lives in the vendored scene (`vendor/my-office/src/office/`); nothing in `client/`, `shared/` or `server/` changes. `ui/tips.js`, `ui/timelapse.js` and `ui/clip-music.js` are taken from my-office through the import tool, each with a few `// PASEO:` changes. The automatic camera's lines are copied into the camera bar's stand-in, which also draws photo mode's new buttons; the settings stand-in gives `setTimeMode` its meaning (Auto is the app's theme, Day and Night are held for a photo or a clip only).

**Tech Stack:** Plain JavaScript modules bundled by `scripts/build-world.mjs` into `server/world.generated.ts`; Vitest with jsdom for the tests; `vendor/my-office/import-upstream.mjs`.

**Spec:** `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-paseo-office-roadmap-design.md`, section "4. Camera extras" (and "What binds every piece"). Version tag: v0.5.0.

## What is verified in the code, and what it means for this piece

Read before writing this plan, from `paseo-office` at its `main` and my-office at `b68228871fe30cd2c759a2c919337a9a9d1f5644` (`/tmp/ref-office/my-office`):

- `vendor/my-office/src/office/ui/camera-bar.js` is a stand-in. It builds its own markup (`BAR`: toolbar, walk overlay, photo bar) and styles (`STYLE`), fits the floor (`fitFloor`), and exports `setView`, `fitFloor`, `goView`, `build`, `setup`. It has no `autoCam` or `panTo`, no list button, no clip controls, and no day and night buttons in the photo bar. Upstream's `camera-bar.js` cannot be taken: its `VIEWS` and zoom are in upstream's own frame, which the port's fitted Overview replaces.
- Upstream's `ui/photo.js` already handles `[data-ph-time]` buttons (`sync()` marks them; the bar's click handler calls `setTimeMode`, `syncTimeBtns`). The port's copy differs from upstream only by the `host.brandName`, the file name and the `host.photo` guard. So the buttons need only markup and a working `setTimeMode`.
- `ui/settings.js` is a stand-in of three empty functions (`syncTimeBtns`, `setTimeMode`, `syncToggles`). Upstream's `setTimeMode('auto')` follows the clock; the port's night follows the app's theme: `paseo-entry.js` `api.setTheme` calls `backdrops.applyNight(host.night)`, and `world/backdrops/index.js` (a stand-in) sets `state.nightManual = true` and calls `setNight(on)` from `world/room-update.js`. Nothing else reads `state.nightManual` except `ui/photo.js` `sync()`, `ui/timelapse.js` (`kept.mode`) and `interact/props.js` `cycleTime` (the wall clock prop).
- `interact/props.js` `cycleTime` calls `setTimeMode` when the wall clock is clicked and toasts "Clock: ...". Today `setTimeMode` is empty, so nothing changes. Once `setTimeMode` works, the clock would change the lights until the next theme change. This plan keeps the clock inert (Task 1).
- `ui/tips.js` and `ui/timelapse.js` are stand-ins whose paths carry `PASEO:`; the import tool lists a path as "kept" while its stand-in exists, so each stand-in is deleted first. Running the tool with those two paths and `ui/clip-music.js` out of `DENY` reports (simulated with `--check` on a copy): 69 modules (now 67), 95 files (now 91), the English area `tips` added, and one stand-in short of an export: `office/ui/settings.js: togglePop`.
- Upstream's start-up list puts `uiTimelapse` right after `uiPhoto` and `uiTips` right before `interactFirstPerson`. `paseo-entry.js` calls `cameraBar.build()` before the modules and `cameraBar.setup()` after them, so the photo bar's ids exist when `timelapse.setup()` looks for `ph-clip`, `ph-music` and `[data-clip-shape]`.
- `core/loop.js` (taken) already calls `updateTips()`, `clipCamera()` and `clipFrame()` every frame, today into stand-ins. It already skips resolution adapting and caps the frame rate at 30 while `state.clip` is set.
- Nothing in `tips.js`, `timelapse.js` or `clip-music.js` calls the network, reads `process.env`, or needs an asset. Canvas text names `"Be Vietnam Pro"` and `"JetBrains Mono"` and falls back to system fonts. `ui.clip.*` and `ui.photo.*` strings are already in the port's English locale (`ui.js` is taken whole); `tips.*` is a new area that the tool adds.
- The upstream CSS these files need is not taken: `styles/photo.css` (`.pb-clip`, `.pb-music`, `.clip-cover`, `.clip-view`, `.clip-prog`, `.clip-label`, `.clip-stop`, and `:not(.clip-cover)` in the photo mode rule) and `styles/tips.css` (`.tour*`). Upstream's `.pb-clip` and the tour use `var(--accent-line)`, `var(--font)`, `var(--green)`, which the port's page does not define. The port's photo-mode rule `body.is-photo #stage-wrap > :not(#stage):not(#photo-bar)` would hide the clip's cover, which is appended to `#stage-wrap`.
- The frame is `srcdoc` with `allow="fullscreen"` and no `sandbox` (`client/world/world-frame.web.ts`), so it shares the app's `localStorage` and can start a download as photo mode does. `client/world/world-view-native.tsx` starts the scene with `photo: false`; `host.photo` (`paseo-host.js`, `paseo-entry.js`) hides Photo mode there. Clip recording is a part of photo mode's bar, so it is hidden wherever Photo mode is.
- The size: `WORLD_SCRIPT.length` is 1,116,817 today; `server/world-script.test.ts` requires it above 1,000,000 and below 1,200,000. Minified, the three taken files are 6.2 KB, 4.0 KB and 4.2 KB (esbuild, without their imports), the new locale area about 1 KB, and the styles and stand-in code about 6 KB: about +22 KB. Piece 2 adds its own. The cap is checked, not assumed (Task 5).

## Decisions

1. **`ui/camera-bar.js` stays a stand-in; the automatic camera is upstream's lines copied into it** (`autoCam`, `panTo`, the `office-autocam` read, the `controls` `start` listener). Reason: upstream's file cannot be taken (see above), and the lines are eight. Cost: a newer upstream's change to those lines is not picked up by the tool; the weekly upstream report will not flag them, so they are named in `vendor/SOURCES.md`.
2. **What triggers the glide:** a person already in the office whose status becomes `wait` (a permission asked), once, when `autoCam()` allows. It is upstream's one caller (`ui/permissions.js` `onPerm`). Not on the first list, not for a newcomer walking in, not for deploys or incidents (upstream's comment names them but its code does not move for them). Reason: the same rule as upstream, nothing invented. Cost: a deploy or an incident does not move the camera.
3. **A glide ends when anything else takes the camera** (a view, a zoom button, a place card, an opened person, a refit). Upstream lets a view button be undone 7 s later by the glide's return. Reason: it pulls the camera away from where the user just sent it. Cost: a small difference from upstream; one line in `setView` and `fitFloor`.
4. **The glide moves the target only, as upstream does.** Reason: it is upstream's tuning. Cost: at the fitted Overview the floor shifts and part of it leaves the frame for 7 s. If the look shows that reads badly, a zoom step is a follow-up, not this piece.
5. **No switch in the app for the automatic camera or the tour.** Reason: the roadmap lists none, and a device setting needs a start option, a world API field and a settings row for each. The scene honours upstream's `localStorage` keys: `office-autocam` = `off` turns the camera off; removing `office-tips` shows the tour again. `docs/office.md` says so. Cost: a user cannot turn the camera off without developer tools; if the owner finds it intrusive, add one boolean device setting then.
6. **Auto means the app's theme; Day and Night are held only while photo mode or a clip runs.** `setTimeMode('auto')` = `applyNight(host.night)`; `'day'`/`'night'` = a new `holdNight(on)` in the backdrop stand-in. Photo mode's exit (`exitPhoto`) and the end of a clip call `setTimeMode('auto')` (the clip already restores `kept.mode`, which is `auto` when nothing was held). A theme change in the middle of photo mode ends the hold. Reason: the owner's rule. Cost: `exitPhoto` is one more hand change; Night over a light theme keeps the light backdrop (the app's surface colour) behind a night-lit room. The look decides whether that reads badly; the fix would be a night backdrop for a held night, not in this piece.
7. **The wall clock prop stays inert**, and says so: the entry replaces its `act` with a no-op and its hint with "The lights follow the app's theme" (in the entry, as it does for the wall screen). Reason: with `setTimeMode` live the clock would otherwise hold day or night until the next theme change, against decision 6. Cost: one more entry line and one wording in the stand-in's `OURS`; today's "Clock: day." toast with no effect goes.
8. **Tips: where, how often, how they end.** Shown in the 3D view only on a device whose pointer is fine (the same test as Walk in), once per device: 4.5 s after the office opened and settled, until Skip, Done or Escape, or until Walk in or Photo mode starts (`office-tips` = `seen`). `state.isLocal`, upstream's "this is the user's own machine", is set from that pointer test in the camera bar's `setup()`. Reason: the cards say "click" and "WASD", and a phone's storage may not persist. Cost: nothing on a phone; the tour appears once on the owner's desktop after the update.
9. **Tips dropped or reworded for the port.** Dropped: the bell card (a click on the bell in the port also has the stand-up notes written, `onBell`, which a tour must not push). Reworded in the stand-in's `OURS`, not in the locale file: `tips.person.title` and `tips.person.text` (upstream says the card shows "the prompt, the files it edits, the commands it runs", which the port never shows). Kept as upstream wrote them: lamp, switch, coffee, printer, cat, Walk in (all these things and behaviours are in the taken files; `startTips` already skips a step whose thing a floor lacks). Reason: no card may promise what the port lacks or do something unasked. Cost: the tour has six or seven cards.
10. **The tour leaves the camera where its last card looked**, as upstream does; the only change is that a card's look calls `setView(null)`, so Overview is not shown pressed and a resize does not refit under the card. Reason: fewest hand changes. Cost: the user presses Overview to go back.
11. **Clip recording is offered when all of these hold:** `host.photo` is not false, `MediaRecorder` and `HTMLCanvasElement.prototype.captureStream` exist, and the pointer is fine. Otherwise the whole clip group (`#ph-clipset`) is hidden. Reason: the roadmap says desktop and browsers; a phone browser has a fine pointer false, and a 15 s render at 1080 px and four times the pace is the memory and heat risk the survey named. Cost: a tablet with a mouse as its primary pointer is treated as a desktop; a desktop whose recorder lacks the codecs still gets a toast from upstream's own code at press time (`ui.clip.unsupported`).
12. **The clip's music follows Sound.** `musicTrack` (`ui/clip-music.js`, the one place that makes the audio context) returns null while `sfx.on` is false, so the recorder gets the picture alone and no `AudioContext` is created. The photo bar's Music button is disabled, with a title, while Sound is off (`syncToggles()` in the settings stand-in, called when photo mode opens). Reason: the owner's rule that nothing makes audio until Sound is on; the music never goes to the speakers, but it is audio the user did not turn on. Cost: a clip made with Sound off is silent; one hand change in `clip-music.js`.
13. **The clip's file is `office-clip-YYYY-MM-DD-HH-MM[-9x16].mp4|webm`**, as photo mode's file is `office-...png`. Reason: a community port does not name its files after my-office. Cost: one hand change in `timelapse.js`.
14. **Escape and P do nothing while a clip is made** (`exitPhoto` returns while `state.clip`). Reason: upstream's Escape would leave photo mode under a running clip and reset the lights it holds. Cost: one line in `photo.js`; the clip's own Stop button ends it.
15. **No new setting, no change to `client/`, `shared/`, `server/` or `world-api.ts`.** The scene writes three more `localStorage` keys (`office-tips`, `office-clip-shape`, `office-clip-music`) and reads `office-autocam`; `docs/office.md` and `vendor/SOURCES.md` say so. The phone-engine rule is met by there being no app-side change.
16. **The bundle's cap stays at 1,200,000** unless the measured size passes 1,180,000; then it becomes 1,250,000 in the same commit, with the new size in the test's comment. Reason: the cap exists to catch a large module coming back (the street is about a megabyte), not to price twenty kilobytes. Cost: a reviewer must read the measured number.

## Assumes from earlier pieces

Re-check each when this piece's turn comes.

- **Piece 2 (sounds):** `audio/sfx.js` is upstream's, with `export let sfx;` set by its `setup()`, and `sfx.on` is a getter that is true only while the Sound setting is on (the Sound setting sets the scene's `office-sound` switch through `sfx.set`). Piece 2 leaves `ui/settings.js`, `ui/photo.js` and the photo bar's markup as they are today. It may add a mute button to the camera bar's `.tb-tools` and its styles to `camera-bar.js`'s `STYLE`: this piece edits other lines of the same file (the photo bar's markup, the `body.is-photo` rule, the clip's styles), so a merge should be clean. If `sfx.on` has another name or the switch lives elsewhere, change the two reads in Task 4 (`clip-music.js`, `settings.js`).
- **Piece 3 (floor plans):** `host.plan` may be `cozy`. Nothing in this piece reads the plan. `startTips` already drops the steps whose props a floor lacks; the camera bar's `VIEWS` table is piece 3's to extend. The clip's orbit (`hw` 12 units) was made for upstream's company floor and is looked at once on the cozy room in Task 6 if piece 3 has shipped.
- **The import tool and `DENY`:** the `ui` line of `DENY` is still `/^office\/ui\/(?!event-text\.js$|icons\.js$|photo\.js$)/`, and `vendor/SOURCES.md` still describes the tool as above. Pieces 2 and 3 edit other lines.
- **Tests:** `client/world/camera-bar.test.ts`, `photo.test.ts` and `entry.test.ts` have the shape they have today (their mocks are named below). Pieces 2 and 3 may have edited them: re-read each before editing, and edit by the text quoted here.
- **The throwaway-daemon rules** are those of piece 1's plan, Task 7.

## Not verifiable until built

Each is found out in Task 6, in the way given.

1. **Recording in the app's frame.** `MediaRecorder`, `captureStream` and `<a download>` inside the `srcdoc` iframe, in the desktop app and in browsers; the codecs offered (MP4 with H.264 first, then WebM). The look runs in a Chromium browser on the throwaway daemon: it hooks the frame's `HTMLAnchorElement.prototype.click` to capture the file's name, type and size. The desktop app itself is the owner's to check (named in Task 6).
2. **That the file plays, with and without music.** No `ffprobe` on the host; the look saves the captured blob's size and first bytes only. The owner plays one.
3. **The clip's framing from the fitted Overview.** Upstream records from `BASE_ZOOM` 0.8; the port's camera is fitted, so `camera.zoom` differs with the frame's shape, and the clip's orbit starts "from where the camera is now". The look records from Overview at 1280 px and at a narrow desktop window and reads the cover's preview. If the floor is cropped or small, the fallback is one hand change in `timelapse.js` (Task 6 step 7).
4. **Software GL speed.** The headless browser draws with SwiftShader; a 1080 px frame takes long, so the clip has few frames. The look checks that a file is made, not how smooth it is.
5. **The glide, seen.** The throwaway daemon has no provider, so no agent can ask for a permission. The look drives the scene's own API in the frame (`PaseoOfficeWorld.setSessions`), which the app's feed might overwrite on its next update; the look says so if it does.
6. **Night over a light theme in photo mode** (decision 6), and how the photo bar wraps at 390 px with the time group added.
7. **The tour's cards at 1280 px:** position over each prop, the arrow, the Walk in card above its button, and that it does not appear on a phone.

## Global Constraints

- Work in `/workspace/QFlavours/paseo-office` on a branch `feat/camera-extras` cut from `main`. The repo is public: nothing private in files, fixtures or commit messages; no AI attribution on commits; never push, never `gh` (the controller publishes).
- What my-office's author asked: the MIT licence and copyright notice stay (vendored files, `LICENSE`, the built scene's banner); README links to https://github.com/khanh020905/my-office; a community port, "based on my-office". His files are taken unchanged wherever they can be; a change by hand starts with `// PASEO:` and is listed in `vendor/SOURCES.md` with its reason.
- No real brand's logo, name or tune. The clip's title card reads "A day at the office" and its mark is `host.brandName || 'Paseo'` (the port's change in `photo.js`).
- The scene never receives a file name, a command or a prompt, and makes no network call. The clip's end card counts only (`state.stats`: prompts, edits, commands, deploys, and the number of people), which the entry already keeps from events.
- Stock Paseo 0.16 only. Nothing app-side is added in this piece, so `client/engine-compat.test.ts` has nothing new to guard; it must stay green.
- Styles of the page are in `vendor/my-office/src/office/paseo-style.js` (the page) and `ui/camera-bar.js`'s `STYLE` (the bars), as today; the page's language is the app's colours (`--o-*`), radii 6, 8 and 12, no glow. The bars keep upstream's near-black literals, as the existing comment in `camera-bar.js` explains.
- Every change under `vendor/` is followed by `npm run build:world`, and `server/world.generated.ts` and `vendor/my-office/MANIFEST.json` (when the tool ran) are committed with it; CI's `check:world` fails otherwise.
- Checks after each task: `npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts`, and the test files touched; the whole suite (`npm test -- --maxWorkers=4`, output to a file under /tmp) before each commit. New `.ts` tests are formatted with `npm run format`; `vendor/**` and the generated file are ignored by the formatter and the linter.
- Never run a bare `paseo` command and never start, stop or restart the daemon on port 6767. A throwaway daemon uses `PASEO_HOME=/tmp/office-stock-home`, port 6798, `env -i`, and the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`.
- The import tool is run from the repo root as:
  `node vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three` (add `--check` to write nothing). If `/tmp/ref-office/my-office` is missing, clone https://github.com/khanh020905/my-office there and check out `b68228871fe30cd2c759a2c919337a9a9d1f5644`; if `/tmp/ref-office/three` is missing, `npm install --prefix /tmp/ref-office/three three@0.160.0`.

---

### Task 1: Photo mode's Auto, Day and Night

**Files:**

- Modify: `vendor/my-office/src/office/world/backdrops/index.js`, `vendor/my-office/src/office/ui/settings.js`, `vendor/my-office/src/office/ui/camera-bar.js` (the photo bar's markup), `vendor/my-office/src/office/ui/photo.js`, `vendor/my-office/src/office/paseo-entry.js`, `vendor/my-office/src/i18n/index.js` (`OURS`), `vendor/SOURCES.md`, `server/world.generated.ts` (built)
- Create: `client/world/time-mode.test.ts`, `client/world/backdrops-night.test.ts`
- Modify (tests): `client/world/photo.test.ts`, `client/world/camera-bar.test.ts`, `client/world/entry.test.ts`

**Interfaces:**

- Produces, in `world/backdrops/index.js`: `holdNight(on: boolean): void` beside the existing `applyNight(on)`. `applyNight` now leaves `state.nightManual` false (the scene follows the theme); `holdNight` sets it true.
- Produces, in `ui/settings.js` (stand-in): `setTimeMode(mode: 'auto' | 'day' | 'night'): void` (`'day'` and `'night'` call `holdNight`; anything else calls `applyNight(host.night)`); `syncTimeBtns()` and `syncToggles()` stay no-ops here (Task 4 gives `syncToggles` a body).
- Consumed by later tasks: Task 4's clip (`setTimeMode('day' | 'night' | kept.mode)`) and Task 4's `syncToggles`.

- [ ] **Step 1: Write the failing tests**

Create `client/world/time-mode.test.ts`:

```ts
// @vitest-environment jsdom
// The stand-in of ui/settings.js: what 'auto', 'day' and 'night' mean in Paseo's scene. Auto is the app's
// theme; day and night are held against it, for a photo or a clip.
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({
  host: { night: false },
  applyNight: vi.fn(),
  holdNight: vi.fn(),
}));

vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({ host: h.host }));
vi.mock("../../vendor/my-office/src/office/world/backdrops/index.js", () => ({
  applyNight: h.applyNight,
  holdNight: h.holdNight,
}));

import {
  setTimeMode,
  syncTimeBtns,
  syncToggles,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/office/ui/settings.js";

beforeEach(() => {
  h.applyNight.mockReset();
  h.holdNight.mockReset();
  h.host.night = false;
});

test("day and night are held against the theme", () => {
  h.host.night = true;
  setTimeMode("day");
  expect(h.holdNight).toHaveBeenLastCalledWith(false);
  setTimeMode("night");
  expect(h.holdNight).toHaveBeenLastCalledWith(true);
  expect(h.applyNight).not.toHaveBeenCalled();
});

test("auto goes back to the app's theme, dark or light", () => {
  h.host.night = true;
  setTimeMode("auto");
  expect(h.applyNight).toHaveBeenLastCalledWith(true);
  h.host.night = false;
  setTimeMode("auto");
  expect(h.applyNight).toHaveBeenLastCalledWith(false);
  expect(h.holdNight).not.toHaveBeenCalled();
});

test("a mode it does not know is the theme", () => {
  h.host.night = true;
  setTimeMode("noon");
  expect(h.applyNight).toHaveBeenLastCalledWith(true);
});

test("the two other calls modules make stay callable", () => {
  expect(() => {
    syncTimeBtns();
    syncToggles();
  }).not.toThrow();
});
```

Create `client/world/backdrops-night.test.ts`:

```ts
// @vitest-environment jsdom
// The backdrop stand-in's two ways to light the scene: the theme's (applyNight) and a held one (holdNight).
import { beforeEach, expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { state } from "../../vendor/my-office/src/office/core/state.js";

const h = vi.hoisted(() => ({
  host: { night: false, surface: "#F4EFE6" },
  setNight: vi.fn(),
  scene: { background: null as unknown, fog: { color: { copy: () => undefined } } },
}));

vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({ host: h.host }));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({ scene: h.scene }));
vi.mock("../../vendor/my-office/src/office/world/windows.js", () => ({
  cityDay: {},
  cityNight: {},
}));
vi.mock("../../vendor/my-office/src/office/world/room-update.js", () => ({
  setNight: h.setNight,
}));

import {
  applyNight,
  holdNight,
  setup,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/office/world/backdrops/index.js";

beforeEach(() => {
  h.setNight.mockReset();
  h.host.night = false;
  setup();
  h.setNight.mockReset();
});

test("the theme's night is not a held one", () => {
  state.nightManual = true;
  applyNight(true);
  expect(h.setNight).toHaveBeenLastCalledWith(true);
  expect(state.nightManual).toBe(false);
});

test("a held day or night says so, and the theme's next change lets go", () => {
  holdNight(false);
  expect(h.setNight).toHaveBeenLastCalledWith(false);
  expect(state.nightManual).toBe(true);
  holdNight(true);
  expect(h.setNight).toHaveBeenLastCalledWith(true);
  applyNight(false);
  expect(state.nightManual).toBe(false);
});

test("both keep the backdrop in the app's surface colour", () => {
  holdNight(true);
  const background = h.scene.background as { getHexString(): string };
  expect(background.getHexString()).toBe("f4efe6");
});
```

Edit `client/world/photo.test.ts`: make the `settings.js` mock observable and add the time group to the bar's DOM. Replace

```ts
vi.mock("../../vendor/my-office/src/office/ui/settings.js", () => ({
  setTimeMode() {},
  syncTimeBtns() {},
}));
```

with

```ts
vi.mock("../../vendor/my-office/src/office/ui/settings.js", () => ({
  setTimeMode: h.setTimeMode,
  syncTimeBtns() {},
}));
```

add `setTimeMode: vi.fn()` to the `vi.hoisted` object (`const h = vi.hoisted(() => ({ host: { photo: true, brandName: "", toast: () => undefined }, setTimeMode: vi.fn() }));`), import `exitPhoto` with `enterPhoto` and `setup`, and add to the `beforeEach` bar markup, after the `ph-mark` button: `<button data-ph-time="auto"></button><button data-ph-time="day"></button><button data-ph-time="night"></button>`. Append:

```ts
test("a button of the time group holds its mode, and Auto lets go", () => {
  h.host.photo = true;
  setup();
  enterPhoto();
  h.setTimeMode.mockClear();
  document.querySelector<HTMLElement>("[data-ph-time=day]")?.click();
  expect(h.setTimeMode).toHaveBeenLastCalledWith("day");
  document.querySelector<HTMLElement>("[data-ph-time=auto]")?.click();
  expect(h.setTimeMode).toHaveBeenLastCalledWith("auto");
});

test("leaving photo mode puts the lights back to the app's theme", () => {
  h.host.photo = true;
  setup();
  enterPhoto();
  h.setTimeMode.mockClear();
  exitPhoto();
  expect(h.setTimeMode).toHaveBeenLastCalledWith("auto");
  expect(document.getElementById("photo-bar")?.hidden).toBe(true);
});
```

(`photo.js` keeps its module state between tests in a file, so a test that finds photo mode already on still passes: `enterPhoto` is then a no-op and `exitPhoto` runs.)

Edit `client/world/camera-bar.test.ts`: add after the test "photo mode's bar is in the page, hidden, with its own controls":

```ts
test("photo mode's bar has Auto, Day and Night, Auto pressed first", () => {
  open();

  const buttons = [...document.querySelectorAll<HTMLElement>(".photo-bar [data-ph-time]")];
  expect(buttons.map((b) => [b.dataset.phTime, b.textContent])).toEqual([
    ["auto", "Auto"],
    ["day", "Day"],
    ["night", "Night"],
  ]);
  expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual(["true", "false", "false"]);
});
```

Edit `client/world/entry.test.ts`: in `startPage`'s `vi.doMock(".../interact/props.js", ...)` add a clock to the map and a counter on `h`. Add `clockCycled: 0` to the `vi.hoisted` object, add to `PROPS`: `["clock", { id: "clock", hint: t("props.clock.hint"), act: () => { h.clockCycled += 1; } }]`, and add:

```ts
test("the wall clock changes nothing: the lights follow the app's theme", async () => {
  h.clockCycled = 0;
  const props = await startPage({});

  expect(props.get("clock")?.hint).toBe("The lights follow the app's theme");
  props.get("clock")?.act();
  expect(h.clockCycled).toBe(0);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/world/time-mode.test.ts client/world/backdrops-night.test.ts client/world/photo.test.ts client/world/camera-bar.test.ts client/world/entry.test.ts`
Expected: FAIL. `time-mode`: `holdNight` never called (the stand-in's `setTimeMode` is empty). `backdrops-night`: `holdNight` is not exported. `photo`: `setTimeMode` not called with `"auto"` on exit. `camera-bar`: no `[data-ph-time]` buttons. `entry`: the clock's hint is upstream's, and `act` ran.

- [ ] **Step 3: The backdrop stand-in**

In `vendor/my-office/src/office/world/backdrops/index.js` replace

```js
/** Night with Paseo's dark theme, day with the light one: never by the clock. */
export function applyNight(on) {
  state.nightManual = true;
  setNight(on);
  applySurface();
}
```

with

```js
/** Night with Paseo's dark theme, day with the light one: never by the clock. */
export function applyNight(on) {
  state.nightManual = false;
  setNight(on);
  applySurface();
}
/**
 * Day or night held against the theme, for a photo or a clip (ui/settings.js setTimeMode). Auto, the end of photo mode
 * and the theme's own next change (applyNight) let go. The backdrop stays the app's surface colour either way.
 */
export function holdNight(on) {
  state.nightManual = true;
  setNight(on);
  applySurface();
}
```

(Nothing else reads `state.nightManual` to follow a clock: upstream's interval that did was in the denied original of this file.)

- [ ] **Step 4: The settings stand-in**

Replace the whole of `vendor/my-office/src/office/ui/settings.js` with:

```js
// PASEO: stand-in for my-office's ui/settings.js, which Paseo does not take. Upstream's popover holds the time buttons,
// the switches and the tour's button; Paseo has none of them. What stays is what other modules call.
import { host } from "../paseo-host.js";
import { applyNight, holdNight } from "../world/backdrops/index.js";

/**
 * Upstream's 'auto' follows the clock; Paseo's follows the app's theme (the scene is lit by night while the app is dark).
 * 'day' and 'night' hold against the theme: only photo mode's buttons and the clip ask for them, and photo mode's end
 * asks for 'auto' again (ui/photo.js).
 */
export function setTimeMode(mode) {
  if (mode === "day" || mode === "night") holdNight(mode === "night");
  else applyNight(host.night);
}
export function syncTimeBtns() {}
export function syncToggles() {}
```

- [ ] **Step 5: The photo bar's buttons**

In `vendor/my-office/src/office/ui/camera-bar.js`, in `BAR`, find

```html
<button type="button" class="pb-tgl" id="ph-mark" aria-pressed="true">Logo</button>
<span class="pb-sep"></span>
<div class="pb-seg" title="Picture size"></div>
```

and make it

```html
<button type="button" class="pb-tgl" id="ph-mark" aria-pressed="true">Logo</button>
<span class="pb-sep"></span>
<div
  class="pb-seg"
  title="Light for the photo: Auto follows the app's theme, Day and Night hold for this photo only"
>
  <button type="button" data-ph-time="auto" aria-pressed="true">Auto</button
  ><button type="button" data-ph-time="day" aria-pressed="false">Day</button
  ><button type="button" data-ph-time="night" aria-pressed="false">Night</button>
</div>
<span class="pb-sep"></span>
<div class="pb-seg" title="Picture size"></div>
```

No style change: `.pb-seg button` already styles any button in a `.pb-seg`, and `.pb-seg button[aria-pressed="true"]` marks the pressed one.

- [ ] **Step 6: Photo mode gives the lights back**

In `vendor/my-office/src/office/ui/photo.js` (the port's copy; it already starts with `// PASEO:` changes), in `exitPhoto`, find

```js
  document.body.classList.remove('is-photo', 'photo-nonames');
  $('photo-bar').hidden = true;
}
```

and make it

```js
  document.body.classList.remove('is-photo', 'photo-nonames');
  $('photo-bar').hidden = true;
  setTimeMode('auto'); // PASEO: Day and Night were held for the photo only: the lights go back to the app's theme
}
```

(`setTimeMode` is already imported in this file.)

- [ ] **Step 7: The wall clock stays inert**

In `vendor/my-office/src/office/paseo-entry.js`, find

```js
const tv = PROPS.get("tv");
if (tv && host.resources) {
  tv.act = () => host.resources();
  tv.hint = tr("paseo.tv.resources");
}
```

and add after it

```js
// (the wall clock cycled upstream's time of day: auto, day, night. Here the lights follow the app's theme and only photo
// mode's buttons hold day or night, so a click on the clock changes nothing and its tooltip says why)
const clock = PROPS.get("clock");
if (clock) {
  clock.act = () => {};
  clock.hint = tr("paseo.clock.hint");
}
```

In `vendor/my-office/src/i18n/index.js`, in `OURS`, after the `'paseo.tv.resources'` line, add:

```js
  // (the wall clock: it changes nothing, see paseo-entry.js)
  'paseo.clock.hint': "The lights follow the app's theme",
```

- [ ] **Step 8: Build, run, check**

```bash
npm run build:world
npx vitest run client/world/time-mode.test.ts client/world/backdrops-night.test.ts client/world/photo.test.ts client/world/camera-bar.test.ts client/world/entry.test.ts
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
```

Expected: all PASS. The photo mode tests that existed stay green.

- [ ] **Step 9: SOURCES.md**

In `vendor/SOURCES.md`, in the list of files changed by hand, extend the `src/office/ui/photo.js` bullet: "and leaving photo mode calls `setTimeMode('auto')`, so Day and Night, held for the photo, go back to the app's theme". In the stand-ins table, add the rows:

```
| `ui/settings.js`            | `setTimeMode`: Auto is the app's theme, Day and Night are held for a photo or a clip (`world/backdrops/index.js` `holdNight`) |
```

and extend the `world/backdrops/index.js` row with "; a held day or night for a photo". In the sentence that lists what is left out of the camera toolbar and photo mode, take out "and photo mode's day and night buttons" (the rest is edited in later tasks). Update the sentence that counts the hand-changed files ("Five copied files...") to the number of entries the list now has.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: photo mode's Auto, Day and Night, held for the photo only"
```

---

### Task 2: The automatic camera

**Files:**

- Modify: `vendor/my-office/src/office/ui/camera-bar.js`, `vendor/my-office/src/office/paseo-entry.js`, `vendor/SOURCES.md`, `server/world.generated.ts` (built)
- Modify (tests): `client/world/camera-bar.test.ts`, `client/world/entry.test.ts`

**Interfaces:**

- Produces, in `ui/camera-bar.js`: `autoCam(): boolean` and `panTo(worker): void`, upstream's, plus module-private `endPan()`. `setup()` sets `state.camAuto` (from `localStorage` `office-autocam`, default on) and `state.lastUserCam`.
- Consumes: Task 1 changes nothing here. `paseo-entry.js` uses `cameraBar.autoCam()` and `cameraBar.panTo(w)`.

- [ ] **Step 1: Write the failing tests**

Edit `client/world/camera-bar.test.ts`.

In the `vi.hoisted` object add `clone: vi.fn(() => ({ home: true }))`. In the `core/loop.js` mock make it `focusTarget: { set: h.set, copy: h.copy, clone: h.clone }`. In the `scene/renderer.js` mock give `controls` listeners that a test can fire: replace `controls: { target: new THREE.Vector3(0, 0, 0), minZoom: 0.5, maxZoom: 3.4, update() {} },` with

```ts
    controls: {
      target: new THREE.Vector3(0, 0, 0),
      minZoom: 0.5,
      maxZoom: 3.4,
      update() {},
      listeners: {} as Record<string, (() => void)[]>,
      addEventListener(type: string, listener: () => void) {
        (this.listeners[type] ??= []).push(listener);
      },
      fire(type: string) {
        for (const listener of this.listeners[type] ?? []) listener();
      },
    },
```

In `beforeEach` add `h.clone.mockClear(); h.copy.mockReset(); state.camAuto = undefined; state.photo = false; localStorage.clear();` (keep the existing `h.copy.mockReset()` once). Import `autoCam` and `panTo` with `build, goView, setView, setup`. Append:

```ts
/** The page's clock, which the automatic camera's thirty seconds are read from. */
function clock(start: number) {
  const now = { value: start };
  vi.spyOn(performance, "now").mockImplementation(() => now.value);
  return now;
}

/** A person as the camera glides to one: where they stand. */
const person = { pos: { x: 3, y: 4 } };

test("the automatic camera may glide while it is on and nobody uses the camera", () => {
  clock(100_000);
  open();
  expect(state.camAuto).toBe(true);
  expect(autoCam()).toBe(true);

  state.selectedId = "a";
  expect(autoCam()).toBe(false);
  state.selectedId = null;
  state.photo = true;
  expect(autoCam()).toBe(false);
  state.photo = false;
  h.fp.on = true;
  expect(autoCam()).toBe(false);
  h.fp.on = false;
  state.camAuto = false;
  expect(autoCam()).toBe(false);
});

test("upstream's switch, office-autocam off, turns it off", () => {
  localStorage.setItem("office-autocam", "off");
  open();
  expect(state.camAuto).toBe(false);
});

test("it waits thirty seconds after a touch of the controls", () => {
  const now = clock(100_000);
  open();
  (controls as unknown as { fire(type: string): void }).fire("start");
  now.value += 29_000;
  expect(autoCam()).toBe(false);
  now.value += 2_000;
  expect(autoCam()).toBe(true);
});

test("a glide looks at the person and goes back after seven seconds, once for two glides", () => {
  open();
  h.copy.mockClear();
  panTo(person);
  expect(h.set).toHaveBeenLastCalledWith(3, 0.9, 4);
  panTo({ pos: { x: 5, y: 6 } });
  vi.advanceTimersByTime(6_999);
  expect(h.copy).not.toHaveBeenCalled();
  vi.advanceTimersByTime(2);
  expect(h.copy).toHaveBeenCalledTimes(1);
  expect(h.clone).toHaveBeenCalledTimes(1);
  expect(h.copy).toHaveBeenCalledWith({ home: true });
});

test("anything else that takes the camera ends the glide, so it does not pull it back", () => {
  open();
  for (const takeIt of [
    () => setView(null),
    () => goView("desks"),
    () => (controls as unknown as { fire(type: string): void }).fire("start"),
  ]) {
    h.copy.mockClear();
    panTo(person);
    takeIt();
    vi.advanceTimersByTime(8_000);
    expect(h.copy).not.toHaveBeenCalled();
  }
});

test("a person chosen during the glide keeps the camera where it is when it ends", () => {
  open();
  h.copy.mockClear();
  panTo(person);
  state.selectedId = "a";
  vi.advanceTimersByTime(8_000);
  expect(h.copy).not.toHaveBeenCalled();
});
```

(`controls` is already destructured near the top of this file with `camera` and `fpCam`: add it to that destructuring if it is not there.)

Edit `client/world/entry.test.ts`: add to the `vi.hoisted` object `autoCam: false, panned: [] as string[]`, make the `camera-bar.js` mock

```ts
vi.mock("../../vendor/my-office/src/office/ui/camera-bar.js", () => ({
  build() {
    h.built = true;
  },
  setup() {},
  autoCam: () => h.autoCam,
  panTo: (w: { id: string }) => h.panned.push(w.id),
}));
```

reset `h.autoCam = false; h.panned.length = 0;` in `beforeEach`, and append:

```ts
test("a person whose request begins is glided to, once, when the camera may move", () => {
  seat("a"); // at rest
  h.autoCam = true;
  world.setSessions([{ ...session("a"), status: "wait" }]);
  expect(h.panned).toEqual(["a"]);

  world.setSessions([{ ...session("a"), status: "wait" }]); // still waiting: no second glide
  expect(h.panned).toEqual(["a"]);
});

test("no glide when the camera may not move, for a newcomer, or for a change that is not a request", () => {
  seat("a");
  world.setSessions([{ ...session("a"), status: "wait" }]); // autoCam is off
  expect(h.panned).toEqual([]);

  h.autoCam = true;
  world.setSessions([session("a")]);
  world.setSessions([{ ...session("a"), status: "work" }]);
  expect(h.panned).toEqual([]);

  h.workers.set("b", { id: "b", push() {} });
  world.setSessions([session("a"), { ...session("b"), status: "wait" }]); // b is new to the scene
  expect(h.panned).toEqual([]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/world/camera-bar.test.ts client/world/entry.test.ts`
Expected: FAIL: `autoCam` and `panTo` are not exported by `camera-bar.js`; in the entry tests `h.panned` stays empty.

- [ ] **Step 3: The camera bar**

In `vendor/my-office/src/office/ui/camera-bar.js`, after the line `let fitZoom = 0;` (and its comment) add:

```js
/* The automatic camera: upstream's ui/camera-bar.js lines 11 to 17, unchanged but for `endPan`. A permission asked glides
   the camera to the person for seven seconds, unless it is off, someone is walking, taking a photo or looking at a card, or
   the camera was moved in the last thirty. */
let panBack = null;
let panTimer = 0;
export const autoCam = () =>
  state.camAuto &&
  !fp.on &&
  !state.photo &&
  !state.selectedId &&
  performance.now() - state.lastUserCam > 30000;
export function panTo(w) {
  if (!panBack) panBack = focusTarget.clone();
  focusTarget.set(w.pos.x, 0.9, w.pos.y);
  clearTimeout(panTimer);
  panTimer = setTimeout(() => {
    if (panBack && !state.selectedId) focusTarget.copy(panBack);
    panBack = null;
  }, 7000);
}
/** PASEO: upstream lets a glide's return undo a view the user chose meanwhile; here anything that takes the camera ends the glide. */
function endPan() {
  panBack = null;
  clearTimeout(panTimer);
}
```

In `setView`, make the first line of the function `endPan();`:

```js
export function setView(view) {
  endPan();
  home = view === 'home';
```

In `fitFloor`, make the first line `endPan();`:

```js
export function fitFloor() {
  endPan();
  const b = floorBounds();
```

In `setup()`, after the `fitFloor();` line that follows `/* ---------- camera toolbar ---------- */`, add:

```js
// Upstream's switch for the automatic camera: on unless the device's storage says off.
state.camAuto = true;
try {
  state.camAuto = localStorage.getItem("office-autocam") !== "off";
} catch {
  /* storage blocked */
}
state.lastUserCam = -1e9;
controls.addEventListener("start", () => {
  state.lastUserCam = performance.now();
  endPan();
});
```

- [ ] **Step 4: The entry's glide**

In `vendor/my-office/src/office/paseo-entry.js`, before `const api = {` add:

```js
/**
 * Upstream's ui/permissions.js onPerm: a permission asked glides the camera to the person, when it may. Here a person
 * already in the scene whose status becomes `wait`; a newcomer is walking in and the first list is not a request.
 */
function glideToRequest(was, now) {
  if (!was || was.status === "wait" || now.status !== "wait" || !cameraBar.autoCam()) return;
  const w = workers.get(now.id);
  if (w) cameraBar.panTo(w);
}
```

In `setSessions`, after `live.upsertSession(s, seated);` add `glideToRequest(was, s);`:

```js
live.upsertSession(s, seated);
glideToRequest(was, s);
```

- [ ] **Step 5: Build, run, check**

```bash
npm run build:world
npx vitest run client/world/camera-bar.test.ts client/world/entry.test.ts
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
```

Expected: PASS.

- [ ] **Step 6: SOURCES.md**

Under the stand-ins table, extend the `ui/camera-bar.js` row with "; the automatic camera: upstream's `autoCam` and `panTo`, copied, with a glide ending when anything else takes the camera". Add to the list of what the entry does: "a person already in the office whose status becomes `wait` glides the camera to them (upstream's `ui/permissions.js` `onPerm`)". Take "the automatic camera" out of the sentence that lists what is left out.

- [ ] **Step 7: Commit**

```bash
git add -A && git commit -m "feat: the camera glides to a person who asks for a permission"
```

---

### Task 3: The tour

**Files:**

- Delete: `vendor/my-office/src/office/ui/tips.js` (the stand-in)
- Create (by the import tool): `vendor/my-office/src/office/ui/tips.js` (upstream's), `vendor/my-office/src/i18n/locales/en/tips.js`
- Modify (by the tool): `vendor/my-office/src/office/paseo-modules.js`, `vendor/my-office/src/i18n/locales/en/index.js`, `vendor/my-office/MANIFEST.json`
- Modify (by hand): `vendor/my-office/import-upstream.mjs` (`DENY`), `vendor/my-office/src/office/ui/settings.js`, `vendor/my-office/src/office/ui/tips.js` (three changes), `vendor/my-office/src/office/ui/camera-bar.js`, `vendor/my-office/src/office/paseo-style.js`, `vendor/my-office/src/i18n/index.js` (`OURS`), `vendor/SOURCES.md`, `server/world.generated.ts` (built)
- Create (tests): `client/world/tips.test.ts`
- Modify (tests): `client/world/camera-bar.test.ts`

**Interfaces:**

- Produces: `startTips()`, `endTips(done = true)`, `tipUsed(id)`, `updateTips()`, `setup()` from upstream's `ui/tips.js` (the loop calls `updateTips`, `props.js` calls `tipUsed`); `togglePop(open?)` in the settings stand-in (a no-op: the port has no settings popover); `state.isLocal` set by the camera bar.
- What upstream's `tips.js` expects: `#stage-wrap` (the Walk in card is appended to it), `#btn-fp` (the Walk in card's anchor; present, hidden on a coarse pointer), `#btn-tips` (optional, `?.`: the port has none), the `.tour*` styles (written here), `location.search` (empty in the frame), `localStorage` key `office-tips`, `PROPS` ids `lamp0`, `switch0`, `coffee`, `printer`, `cat` (and `bell`, dropped). No network, no `process.env`, no asset.

- [ ] **Step 1: Write the failing tests**

Create `client/world/tips.test.ts`:

```ts
// @vitest-environment jsdom
// The first-visit tour (ui/tips.js, upstream's with three changes of Paseo's). The scene's pieces it points at are
// stood in with what it reads: props with a centre and a top, one person, the cat, the camera's target.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { state } from "../../vendor/my-office/src/office/core/state.js";

const h = vi.hoisted(() => ({
  /** Every label the tour put in the scene: over a prop, the cat or a person. */
  anchors: [] as { element: HTMLElement }[],
  set: vi.fn(),
  setView: vi.fn(),
  setOutline: vi.fn(),
  props: new Map<string, unknown>(),
  workers: new Map<string, unknown>(),
  fp: { on: false },
}));
const hold = (anchor: { element: HTMLElement }) => h.anchors.push(anchor);

vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  $: (id: string) => document.getElementById(id),
  STATIC: false,
  replay: { on: false },
  el: (tag: string, cls?: string, text?: string) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  },
}));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({
  BASE_ZOOM: 1,
  scene: { add: hold },
}));
vi.mock("../../vendor/my-office/src/office/core/loop.js", () => ({ focusTarget: { set: h.set } }));
vi.mock("../../vendor/my-office/src/office/interact/props.js", () => ({
  PROPS: h.props,
  hoverProp: null,
  setOutline: h.setOutline,
}));
vi.mock("../../vendor/my-office/src/office/interact/first-person.js", () => ({ fp: h.fp }));
vi.mock("../../vendor/my-office/src/office/world/props/cat.js", () => ({
  cat: { g: { add: hold, position: { x: 0, z: 0 } } },
}));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({ workers: h.workers }));
vi.mock("../../vendor/my-office/src/office/ui/lite.js", () => ({ lite: false }));
vi.mock("../../vendor/my-office/src/office/ui/settings.js", () => ({ togglePop() {} }));
vi.mock("../../vendor/my-office/src/office/ui/camera-bar.js", () => ({ setView: h.setView }));
vi.mock("../../vendor/my-office/src/i18n/index.js", () => ({ t: (key: string) => key }));

import {
  endTips,
  setup,
  startTips,
  updateTips,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/office/ui/tips.js";
import { STYLE } from "../../vendor/my-office/src/office/paseo-style.js";

const prop = { center: { x: 0, y: 0.5, z: 0 }, top: 1, meshes: [] };
const worker = { root: { visible: true, add: hold }, pos: { x: 1, y: 2 }, anim: "work" };
const latest = () => h.anchors[h.anchors.length - 1];
const clickNext = () => latest()?.element.querySelector<HTMLElement>(".tour-next")?.click();
const title = () => latest()?.element.querySelector(".tour-title")?.textContent;

/** The window outlives each test's page: the Escape listener setup() puts on it is taken off after the test. */
const onWindow = vi.spyOn(window, "addEventListener");

beforeEach(() => {
  endTips(false);
  h.anchors.length = 0;
  h.props.clear();
  h.workers.clear();
  h.set.mockClear();
  h.setView.mockClear();
  h.fp.on = false;
  localStorage.clear();
  state.photo = false;
  state.isLocal = false;
  state.sim = 1;
  state.selectedId = null;
  document.body.innerHTML = '<div id="stage-wrap"><button id="btn-fp"></button></div>';
  for (const id of ["lamp0", "switch0", "coffee", "printer", "cat", "bell"]) h.props.set(id, prop);
  h.workers.set("a", worker);
});

afterEach(() => {
  for (const [type, listener, options] of onWindow.mock.calls) {
    window.removeEventListener(type, listener, options);
  }
  onWindow.mockClear();
  vi.restoreAllMocks();
});

test("the tour goes lamp, switch, coffee, printer, cat, a person, then Walk in, and leaves out the bell", () => {
  startTips();
  const titles: (string | null | undefined)[] = [];
  for (let step = 0; step < 6; step += 1) {
    titles.push(title());
    clickNext();
  }

  expect(titles).toEqual([
    "tips.lamp.title",
    "tips.switch.title",
    "tips.coffee.title",
    "tips.printer.title",
    "tips.cat.title",
    "tips.person.title",
  ]);
  // The Walk in card stands above its button, in the stage.
  expect(document.querySelector("#stage-wrap > .tour--page .tour-title")?.textContent).toBe(
    "tips.walk.title",
  );
});

test("a floor without a prop skips its card", () => {
  h.props.delete("lamp0");
  h.props.delete("cat");
  h.workers.clear();
  startTips();

  expect(title()).toBe("tips.switch.title");
});

test("a card looking at something leaves Overview unpressed", () => {
  startTips();
  expect(h.setView).toHaveBeenCalledWith(null);
});

test("the first visit starts the tour once things settle, on a device with a pointer and keys", () => {
  let now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  setup();

  now = 6_000;
  updateTips();
  expect(h.anchors).toHaveLength(0); // a phone: state.isLocal is false

  state.isLocal = true;
  updateTips();
  expect(h.anchors.length).toBeGreaterThan(0);
});

test("a finished tour is remembered and does not start again", () => {
  startTips();
  endTips();
  expect(localStorage.getItem("office-tips")).toBe("seen");

  let now = 1_000;
  vi.spyOn(performance, "now").mockImplementation(() => now);
  state.isLocal = true;
  h.anchors.length = 0;
  setup();
  now = 60_000;
  updateTips();
  expect(h.anchors).toHaveLength(0);
});

test("Walk in or Photo mode ends the tour for good", () => {
  startTips();
  state.photo = true;
  updateTips();
  expect(localStorage.getItem("office-tips")).toBe("seen");
});

test("Escape ends it", () => {
  setup();
  startTips();
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
  expect(localStorage.getItem("office-tips")).toBe("seen");
});

test("the page has styles for the card, in the app's colours", () => {
  for (const rule of [".tour-wrap", ".tour {", ".tour-next", ".tour-skip", ".tour--page"]) {
    expect(STYLE).toContain(rule);
  }
  expect(STYLE).not.toContain("var(--green)");
  expect(STYLE).not.toContain("var(--font)");
});
```

Edit `client/world/camera-bar.test.ts`: in the test "Walk in is shown for a fine pointer and hidden for a coarse one, and follows a change" add after each `expect(page("btn-fp").hidden)` line the matching `expect(state.isLocal).toBe(...)`: `false` after the first, `true` after `fine.change(true)`, `false` after `fine.change(false)`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/world/tips.test.ts client/world/camera-bar.test.ts`
Expected: FAIL: `startTips` is not a function (the stand-in exports only `updateTips` and `tipUsed`), `STYLE` has no `.tour*`, `state.isLocal` is undefined.

- [ ] **Step 3: The import tool**

1. In `vendor/my-office/import-upstream.mjs`, in `DENY`, change the `ui` line to
   `/^office\/ui\/(?!event-text\.js$|icons\.js$|photo\.js$|tips\.js$)/,`.
2. Delete the stand-in: `git rm vendor/my-office/src/office/ui/tips.js`. (While it exists the tool lists the path as "kept": a file with a `PASEO:` note is never overwritten.)
3. Run the tool with `--check`. Expect: `modules in start-up order: 68; files: 93; ... english areas: common time ui settings fp activity incident events people places props world life tips`; `would write: 4` (`ui/tips.js`, `locales/en/tips.js`, `paseo-modules.js`, `locales/en/index.js`); the "kept" list is the five files of 0.1.0 plus the ones earlier pieces added; and `stand-ins to write or extend: office/ui/settings.js: togglePop`.
4. Add the missing export to `vendor/my-office/src/office/ui/settings.js`, after `syncToggles`:

   ```js
   /** Upstream's settings popover: there is none here (its tour button, `#btn-tips`, is not in the page either). */
   export function togglePop() {}
   ```

5. Run the tool for real. Expect `written: 4`, no `stand-ins to write` line, and the "kept" list without `ui/tips.js`. `git diff --stat` shows: the new `ui/tips.js` and `locales/en/tips.js`, `paseo-modules.js` gaining `import * as uiTips` and `['uiTips', uiTips]` before `interactFirstPerson`, `locales/en/index.js` gaining `tips`, and `MANIFEST.json` (the `standIns` entry for `office/ui/tips.js` gone, `office/ui/settings.js` listing `togglePop`, a hash for `ui/tips.js`).

- [ ] **Step 4: The three changes by hand in `ui/tips.js`**

The `import` lines: add `import { setView } from './camera-bar.js';` after `import { fp } from '../interact/first-person.js';`.

1. The step list. Find

   ```js
     { key: 'cat', prop: 'cat' }, { key: 'bell', prop: 'bell' }, { key: 'person' }, { key: 'walk', dom: 'btn-fp' },
   ```

   and make it

   ```js
     { key: 'cat', prop: 'cat' }, { key: 'person' }, { key: 'walk', dom: 'btn-fp' },   // PASEO: no bell card: a click on the bell in Paseo also has the stand-up notes written
   ```

2. A card's look. Find

   ```js
   function look(x, y, z) {
     focusTarget.set(x, y, z);
     state.zoomGoal = 1.7 * BASE_ZOOM;
     state.lastUserCam = performance.now();
   }
   ```

   and make it

   ```js
   // PASEO: setView(null): the camera left Overview, so the bar's button is not pressed and a resize does not refit under the card
   function look(x, y, z) {
     focusTarget.set(x, y, z);
     state.zoomGoal = 1.7 * BASE_ZOOM;
     state.lastUserCam = performance.now();
     setView(null);
   }
   ```

3. Put `// PASEO: Paseo's changes: the bell card, setView in look (see vendor/SOURCES.md)` as the file's first line, above upstream's first comment, so the tool keeps the file and a reader sees the notes.

- [ ] **Step 5: Where the tour shows, and its words**

In `ui/camera-bar.js` `setup()`, find

```js
const showWalk = () => {
  $("btn-fp").hidden = !fine.matches;
};
```

and make it

```js
// (the first-visit tour, ui/tips.js, says "click" and "WASD": it starts only where Walk in shows. Upstream calls this
// `state.isLocal`, "the user's own machine"; here it is a pointer and keys.)
const showWalk = () => {
  $("btn-fp").hidden = !fine.matches;
  state.isLocal = fine.matches;
};
```

In `vendor/my-office/src/i18n/index.js`, in `OURS`, after the `'paseo.clock.hint'` line add:

```js
  // (the tour's card for a person: the card Paseo opens has no prompt, file or command in it)
  'tips.person.title': 'Each person is an agent',
  'tips.person.text': 'Click someone to open their card: what they are doing now, and a way into their session.',
```

In `vendor/my-office/src/office/paseo-style.js`, before the closing backtick of `STYLE` (after the `@media (prefers-reduced-motion...` line), add:

```css
/* The first visit's tour (ui/tips.js): one card over the thing it is about, or above a button of the page. Upstream's tips.css
   in the page's language: the app's surface, border and text, radius 12, no glow. */
.tour-wrap {
  width: 0;
  height: 0;
  position: relative;
  z-index: 100000 !important;
}
.tour {
  position: absolute;
  left: 0;
  bottom: 16px;
  transform: translateX(-50%);
  width: 264px;
  max-width: calc(100vw - 32px);
  box-sizing: border-box;
  pointer-events: auto;
  padding: 11px 12px 10px;
  background: var(--o-surface-raised);
  color: var(--o-fg);
  border: 1px solid var(--o-muted);
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.45;
  animation: tour-in 0.25s ease-out;
}
.tour::after {
  content: "";
  position: absolute;
  left: var(--arrow, 50%);
  bottom: -7px;
  width: 12px;
  height: 12px;
  transform: translateX(-50%) rotate(45deg);
  background: var(--o-surface-raised);
  border-right: 1px solid var(--o-muted);
  border-bottom: 1px solid var(--o-muted);
}
.tour--page {
  position: absolute;
  z-index: 7;
}
.tour-top {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}
.tour-title {
  font-size: 13px;
  font-weight: 600;
}
.tour-n {
  font-size: 11px;
  color: var(--o-muted);
  white-space: nowrap;
}
.tour-text {
  margin: 5px 0 9px;
}
.tour-acts {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.tour-skip,
.tour-next {
  all: unset;
  box-sizing: border-box;
  min-height: 32px;
  padding: 0 12px;
  display: inline-flex;
  align-items: center;
  border-radius: 6px;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  border: 1px solid var(--o-border);
  color: var(--o-fg);
}
.tour-next {
  background: var(--o-fg);
  color: var(--o-surface-raised);
  border-color: var(--o-fg);
}
.tour-skip:hover {
  border-color: var(--o-muted);
}
.tour-skip:focus-visible,
.tour-next:focus-visible {
  outline: 2px solid var(--o-fg);
  outline-offset: 2px;
}
@keyframes tour-in {
  from {
    opacity: 0;
    transform: translate(-50%, 6px);
  }
}
@media (prefers-reduced-motion: reduce) {
  .tour {
    animation: none;
  }
}
```

- [ ] **Step 6: Build, run, check**

```bash
npm run build:world
npx vitest run client/world/tips.test.ts client/world/camera-bar.test.ts client/world/entry.test.ts
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
```

Expected: PASS. If `entry.test.ts` fails because a module the entry now loads is not stood in, add that module to its mocks the way the others are (it mocks `paseo-modules.js`, so the new modules are not loaded there; a failure means something else changed).

- [ ] **Step 7: SOURCES.md**

In "What is taken", add: "`ui/tips.js`: the first-visit tour, taken with two changes by hand, each starting `// PASEO:`: the bell card is dropped (a click on the bell in Paseo also has the stand-up notes written), and a card's look calls `setView(null)`. It shows only where Walk in does (a fine pointer; `state.isLocal` is set from it in `ui/camera-bar.js`), once per device (`office-tips`), and its person card's words are Paseo's (`OURS` in `i18n/index.js`)." In the stand-ins table replace the `ui/settings.js` row's text with one that also says "`togglePop` does nothing". Take "tips" out of any list of what is not taken. The page's styles for `.tour*` are in `paseo-style.js`: say so in the paragraph that names Paseo's own files.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: the first-visit tour, on desktop, once"
```

---

### Task 4: Clip recording

**Files:**

- Delete: `vendor/my-office/src/office/ui/timelapse.js` (the stand-in)
- Create (by the import tool): `vendor/my-office/src/office/ui/timelapse.js`, `vendor/my-office/src/office/ui/clip-music.js`
- Modify (by the tool): `vendor/my-office/src/office/paseo-modules.js`, `vendor/my-office/MANIFEST.json`
- Modify (by hand): `vendor/my-office/import-upstream.mjs` (`DENY`), `vendor/my-office/src/office/ui/timelapse.js` (one change), `vendor/my-office/src/office/ui/clip-music.js` (one change), `vendor/my-office/src/office/ui/photo.js` (two changes), `vendor/my-office/src/office/ui/settings.js` (`syncToggles`), `vendor/my-office/src/office/ui/camera-bar.js` (markup, styles, visibility), `vendor/SOURCES.md`, `server/world.generated.ts` (built)
- Create (tests): `client/world/clip-music.test.ts`, `client/world/clip.test.ts`
- Modify (tests): `client/world/camera-bar.test.ts`, `client/world/photo.test.ts`, `client/world/time-mode.test.ts`

**Interfaces:**

- Produces: `makeClip()`, `clipOn()`, `clipCamera()`, `clipFrame()`, `setup()` from upstream's `ui/timelapse.js` (the loop calls `clipCamera` before drawing and `clipFrame` right after, in the same task as the draw: the drawing buffer is still there); `lofi(dur, SR)` and `musicTrack(dur)` from `ui/clip-music.js`; `syncToggles()` in the settings stand-in now sets the Music button's `disabled` and `title` from `sfx.on`.
- Consumes: Task 1's `setTimeMode` (the clip calls `setTimeMode('day')`, `('night')` at 10 s, and `kept.mode` at the end); piece 2's `sfx` (see "Assumes").
- What upstream's `timelapse.js` expects: `#stage-wrap` (the cover is appended to it), `#photo-bar`, `#ph-clip`, `#ph-music`, `[data-clip-shape]` (all built in Task 4's markup), the `.clip-*` styles, `renderer`, `composer`, `controls`, `camera`, `resize` of `scene/renderer.js`, `night` of `world/room-update.js`, `paintMark` and `paintNames` of `ui/photo.js`, `locale` and `num` of the i18n stand-in, and `state.stats` (kept by the entry). `localStorage` keys `office-clip-shape`, `office-clip-music`. No network, no `process.env`, no asset.

- [ ] **Step 1: Write the failing tests**

Create `client/world/clip-music.test.ts`:

```ts
// @vitest-environment jsdom
// The clip's music (ui/clip-music.js, upstream's). The tune is pure code; the context that carries it into the recording
// is made only while the Sound setting is on.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ sfx: { on: false } }));
vi.mock("../../vendor/my-office/src/office/audio/sfx.js", () => ({ sfx: h.sfx }));

import {
  lofi,
  musicTrack,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/office/ui/clip-music.js";

/** A page's audio, as far as the clip reads it. */
function stubAudio() {
  const made = { contexts: 0, started: 0, resumed: 0, trackStopped: 0 };
  const track = { stop: () => (made.trackStopped += 1) };
  class FakeContext {
    sampleRate = 8000;
    constructor() {
      made.contexts += 1;
    }
    createBuffer(_channels: number, length: number) {
      return { length, copyToChannel() {} };
    }
    createBufferSource() {
      return { connect() {}, start: () => (made.started += 1), stop() {} };
    }
    createMediaStreamDestination() {
      return { stream: { getAudioTracks: () => [track] } };
    }
    resume() {
      made.resumed += 1;
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  vi.stubGlobal("AudioContext", FakeContext);
  return made;
}

beforeEach(() => {
  h.sfx.on = false;
});
afterEach(() => vi.unstubAllGlobals());

test("the tune is two channels of samples, deterministic, and never over 0.9", () => {
  const [left, right] = lofi(1, 8000) as [Float32Array, Float32Array];
  expect(left).toHaveLength(8000);
  expect(right).toHaveLength(8000);
  const peak = Math.max(...left.map(Math.abs), ...right.map(Math.abs));
  expect(peak).toBeGreaterThan(0.5);
  expect(peak).toBeLessThan(0.9);
  const [again] = lofi(1, 8000) as [Float32Array, Float32Array];
  expect(Array.from(again.slice(0, 200))).toEqual(Array.from(left.slice(0, 200)));
});

test("with Sound off there is no music track and no audio context", () => {
  const made = stubAudio();
  expect(musicTrack(1)).toBeNull();
  expect(made.contexts).toBe(0);
});

test("with Sound on the music is a track for the recorder, started with the clip", () => {
  const made = stubAudio();
  h.sfx.on = true;
  const music = musicTrack(1);
  expect(music).not.toBeNull();
  expect(made.contexts).toBe(1);
  music.start();
  expect(made.started).toBe(1);
  expect(made.resumed).toBe(1);
  music.stop();
  expect(made.trackStopped).toBe(1);
});

test("with Sound on but no audio in the browser it is no track", () => {
  h.sfx.on = true;
  vi.stubGlobal("AudioContext", undefined);
  vi.stubGlobal("webkitAudioContext", undefined);
  expect(musicTrack(1)).toBeNull();
});
```

Create `client/world/clip.test.ts`:

```ts
// @vitest-environment jsdom
// Clip recording's entry point (ui/timelapse.js, upstream's): without a recorder it says so and draws nothing.
// Recording itself needs a real canvas and recorder: it is looked at in a browser (docs/verified.md).
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ toast: vi.fn() }));

vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  $: (id: string) => document.getElementById(id),
  el: (tag: string, cls?: string, text?: string) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  },
  fmtBytes: () => "1 MB",
}));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({
  camera: {},
  composer: {},
  controls: {},
  renderer: {},
  resize() {},
}));
vi.mock("../../vendor/my-office/src/office/world/room-update.js", () => ({ night: false }));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({ workers: new Map() }));
vi.mock("../../vendor/my-office/src/office/ui/settings.js", () => ({
  setTimeMode() {},
  syncTimeBtns() {},
}));
vi.mock("../../vendor/my-office/src/office/ui/photo.js", () => ({
  paintMark() {},
  paintNames() {},
}));
vi.mock("../../vendor/my-office/src/office/ui/activity.js", () => ({ toast: h.toast }));
vi.mock("../../vendor/my-office/src/office/ui/clip-music.js", () => ({ musicTrack: () => null }));
vi.mock("../../vendor/my-office/src/i18n/index.js", () => ({
  t: (key: string) => key,
  locale: () => "en-US",
  num: (n: number) => String(n),
}));

import {
  clipOn,
  makeClip,
  // @ts-expect-error vendored JavaScript has no declarations
} from "../../vendor/my-office/src/office/ui/timelapse.js";

beforeEach(() => {
  h.toast.mockReset();
  document.body.innerHTML = '<div id="stage-wrap"></div>';
});

test("without a recorder, making a clip says so and covers nothing", () => {
  vi.stubGlobal("MediaRecorder", undefined);
  makeClip();

  expect(h.toast).toHaveBeenCalledWith("ui.clip.unsupported");
  expect(document.querySelector(".clip-cover")).toBeNull();
  expect(clipOn()).toBe(false);
  vi.unstubAllGlobals();
});
```

Edit `client/world/camera-bar.test.ts`: make the host mock observable. In `vi.hoisted` add `host: { toast: vi.fn(), photo: true }`, make the mock `vi.mock(".../paseo-host.js", () => ({ host: h.host }))` and replace uses of `h.toast` with `h.host.toast` (the `beforeEach` reset becomes `h.host.toast.mockReset(); h.host.photo = true;`). Add:

```ts
/** What a browser needs to record a clip: a recorder and a canvas that can be captured. */
function recorder(has: boolean) {
  if (has) {
    vi.stubGlobal("MediaRecorder", class {});
    Object.defineProperty(HTMLCanvasElement.prototype, "captureStream", {
      configurable: true,
      value: () => ({}),
    });
  } else {
    vi.stubGlobal("MediaRecorder", undefined);
    delete (HTMLCanvasElement.prototype as { captureStream?: unknown }).captureStream;
  }
}

test("photo mode's bar has the clip's controls, hidden until the bar knows the clip can be made", () => {
  build();

  expect(page("ph-clipset").hidden).toBe(true);
  expect(page("ph-clip").textContent).toContain("Clip 15 s");
  expect(
    [...document.querySelectorAll<HTMLElement>("[data-clip-shape]")].map(
      (b) => b.dataset.clipShape,
    ),
  ).toEqual(["square", "tall"]);
  expect(page("ph-music").getAttribute("aria-pressed")).toBe("true");
});

test("the clip is offered with a recorder, a capturable canvas, a fine pointer and photo mode", () => {
  recorder(true);
  open();
  expect(page("ph-clipset").hidden).toBe(false);
});

test("the clip is hidden without a recorder, with a coarse pointer, or where photo mode is off", () => {
  recorder(false);
  open();
  expect(page("ph-clipset").hidden).toBe(true);

  recorder(true);
  document.body.innerHTML = '<div id="stage-wrap"><div id="stage"></div></div>';
  open({ fine: false });
  expect(page("ph-clipset").hidden).toBe(true);

  document.body.innerHTML = '<div id="stage-wrap"><div id="stage"></div></div>';
  h.host.photo = false;
  open();
  expect(page("ph-clipset").hidden).toBe(true);
});

test("the clip follows the pointer when it changes", () => {
  recorder(true);
  const pointer = open({ fine: false });
  expect(page("ph-clipset").hidden).toBe(true);
  pointer.change(true);
  expect(page("ph-clipset").hidden).toBe(false);
});

test("the clip's cover is not hidden by photo mode's rule, and the clip's styles are in the bar", () => {
  build();
  const css = styles();
  expect(css).toContain(
    "body.is-photo #stage-wrap > :not(#stage):not(#photo-bar):not(.clip-cover)",
  );
  for (const rule of [
    ".pb-clip {",
    ".pb-music {",
    ".clip-cover {",
    ".clip-view {",
    ".clip-prog",
    ".clip-label",
    ".clip-stop {",
  ]) {
    expect(css).toContain(rule);
  }
  expect(css).not.toContain("var(--accent-line)");
  expect(css).not.toContain("var(--font)");
});
```

and in `afterEach` add `recorder(false);`. In the existing test "photo mode's bar keeps upstream's focus ring, its round exit, and drops the hint on a phone" replace the expected focus-ring rule with upstream's full one:

```
".pb-tgl:focus-visible, .pb-seg button:focus-visible, .pb-shoot:focus-visible, .pb-clip:focus-visible, .clip-stop:focus-visible, .pb-exit:focus-visible { outline: 2px solid #F2B33D; outline-offset: 2px; }"
```

Edit `client/world/photo.test.ts`: add `syncToggles: h.syncToggles` to the `settings.js` mock (and `syncToggles: vi.fn()` to `h`), and append:

```ts
test("opening photo mode syncs the Music button with the Sound setting", () => {
  h.host.photo = true;
  setup();
  exitPhoto();
  h.syncToggles.mockClear();
  enterPhoto();
  expect(h.syncToggles).toHaveBeenCalledTimes(1);
});

test("Escape and P leave photo mode alone while a clip is made", () => {
  h.host.photo = true;
  setup();
  exitPhoto();
  enterPhoto();
  h.setTimeMode.mockClear();
  state.clip = true;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.body.classList.contains("is-photo")).toBe(true);
  expect(h.setTimeMode).not.toHaveBeenCalled();
  state.clip = false;
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(document.body.classList.contains("is-photo")).toBe(false);
});
```

with `import { state } from "../../vendor/my-office/src/office/core/state.js";` (the file's mock of that module is `{ state: {} }`, so this is the same object) and `// @ts-expect-error vendored JavaScript has no declarations` above it.

Edit `client/world/time-mode.test.ts`: mock `audio/sfx.js` and test `syncToggles`. Add `sfx: { on: false }` to `h`, `vi.mock("../../vendor/my-office/src/office/audio/sfx.js", () => ({ sfx: h.sfx }));`, and append:

```ts
test("the photo bar's Music button follows the Sound setting", () => {
  document.body.innerHTML = '<button id="ph-music"></button>';
  const music = document.getElementById("ph-music") as HTMLButtonElement;

  h.sfx.on = false;
  syncToggles();
  expect(music.disabled).toBe(true);
  expect(music.title).toBe("Turn Sound on to add music to the clip");

  h.sfx.on = true;
  syncToggles();
  expect(music.disabled).toBe(false);
  expect(music.title).toBe("Original lo-fi music, made in the browser");
});

test("without the button, or before the sounds are set up, it does nothing", () => {
  document.body.innerHTML = "";
  expect(() => syncToggles()).not.toThrow();
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/world/clip-music.test.ts client/world/clip.test.ts client/world/camera-bar.test.ts client/world/photo.test.ts client/world/time-mode.test.ts`
Expected: FAIL: `ui/clip-music.js` does not exist; `timelapse.js` is the stand-in without `makeClip`; no `#ph-clipset`; `syncToggles` does nothing.

- [ ] **Step 3: The import tool**

1. In `import-upstream.mjs` `DENY`, change the `ui` line to
   `/^office\/ui\/(?!event-text\.js$|icons\.js$|photo\.js$|tips\.js$|timelapse\.js$|clip-music\.js$)/,`.
2. `git rm vendor/my-office/src/office/ui/timelapse.js` (the stand-in; `clip-music.js` has none).
3. Run the tool with `--check`. Expect `modules in start-up order: 69; files: 95; ...`, `would write: 3` (`timelapse.js`, `clip-music.js`, `paseo-modules.js`; the English index already has `tips`), no `stand-ins to write` line (everything `timelapse.js` imports from a stand-in is exported: `setTimeMode`, `syncTimeBtns`, `toast`, `locale`, `num`, `fmtBytes` from the port's `core/env.js`).
4. Run the tool for real (expect `written: 3`). `paseo-modules.js` gains `uiTimelapse` right after `uiPhoto`; `MANIFEST.json` loses `office/ui/timelapse.js` from `standIns` and gains hashes for the two files.

- [ ] **Step 4: The two changes by hand**

`ui/timelapse.js`: find

```js
a.download = `my-office-clip-${new Date().toLocaleString("sv-SE").replace(/[: ]/g, "-").slice(0, 16)}${tall ? "-9x16" : ""}.${ext}`;
```

and make it

```js
a.download = `office-clip-${new Date().toLocaleString("sv-SE").replace(/[: ]/g, "-").slice(0, 16)}${tall ? "-9x16" : ""}.${ext}`; // PASEO: named for the office, as photo mode's file is
```

and add `// PASEO: Paseo's change: the file's name (see vendor/SOURCES.md)` as the file's first line.

`ui/clip-music.js`: add `// PASEO: Paseo's change: the music is made only while the Sound setting is on (see vendor/SOURCES.md)` as the first line; add `import { sfx } from '../audio/sfx.js';` after the header comment; and in `musicTrack`, find

```js
export function musicTrack(dur) {
  try {
```

and make it

```js
export function musicTrack(dur) {
  if (!sfx?.on) return null;   // PASEO: the Sound setting is off: no audio context, so the clip is the picture alone (ui/timelapse.js already handles a null)
  try {
```

- [ ] **Step 5: Photo mode's two hand changes**

In `ui/photo.js`:

1. The import line `import { setTimeMode, syncTimeBtns } from './settings.js';` becomes `import { setTimeMode, syncTimeBtns, syncToggles } from './settings.js';`.
2. In `enterPhoto`, find

   ```js
   document.body.classList.add("is-photo");
   $("photo-bar").hidden = false;
   sync();
   ```

   and make it

   ```js
   document.body.classList.add("is-photo");
   $("photo-bar").hidden = false;
   sync();
   syncToggles(); // PASEO: the Music button follows the Sound setting as the bar opens
   ```

3. In `exitPhoto`, find `  if (!on) return;` as its first line and make the next line `  if (state.clip) return; // PASEO: a clip being made keeps photo mode until it ends (Escape and P would reset the lights under it)`:

   ```js
   export function exitPhoto() {
     if (!on) return;
     if (state.clip) return; // PASEO: a clip being made keeps photo mode until it ends (Escape and P would reset the lights under it)
     on = false; state.photo = false;
   ```

- [ ] **Step 6: The Music button follows Sound**

Replace `syncToggles` in `vendor/my-office/src/office/ui/settings.js` and add the import:

```js
import { sfx } from "../audio/sfx.js";
```

```js
/** The photo bar's Music button follows the Sound setting: the clip's music is made only while Sound is on (ui/clip-music.js). */
export function syncToggles() {
  const music = document.getElementById("ph-music");
  if (!music) return;
  const on = !!sfx?.on;
  music.disabled = !on;
  music.title = on
    ? "Original lo-fi music, made in the browser"
    : "Turn Sound on to add music to the clip";
}
```

(`core/optimize.js` also calls `syncToggles()` at start-up; `sfx` may not be set up yet then, hence `sfx?.on`.)

- [ ] **Step 7: The clip's markup, styles and visibility in the camera bar**

In `ui/camera-bar.js`, in `BAR`, replace

```html
<button type="button" class="pb-shoot" id="ph-shoot">
  <span data-icon="camera"></span><span>Take photo</span>
</button>
```

with

```html
<span class="pb-clipset" id="ph-clipset" hidden>
  <span class="pb-sep"></span>
  <div
    class="pb-seg"
    title="Clip shape: square for a feed, vertical 9:16 for Reels, TikTok and Shorts"
  >
    <button type="button" data-clip-shape="square" aria-pressed="true">Square 1:1</button
    ><button type="button" data-clip-shape="tall" aria-pressed="false">Vertical 9:16</button>
  </div>
  <button
    type="button"
    class="pb-tgl pb-music"
    id="ph-music"
    aria-pressed="true"
    title="Original lo-fi music, made in the browser"
  >
    <span data-icon="music"></span><span>Music</span>
  </button>
  <button
    type="button"
    class="pb-clip"
    id="ph-clip"
    title="A 15-second video of the office, from morning to evening"
  >
    <span data-icon="rec"></span><span>Clip 15 s</span>
  </button>
</span>
<button type="button" class="pb-shoot" id="ph-shoot">
  <span data-icon="camera"></span><span>Take photo</span>
</button>
```

In `STYLE`:

1. Replace the rule `body.is-photo #stage-wrap > :not(#stage):not(#photo-bar) { display: none !important; }` with `body.is-photo #stage-wrap > :not(#stage):not(#photo-bar):not(.clip-cover) { display: none !important; }`.
2. Replace the focus rule `.pb-tgl:focus-visible, .pb-seg button:focus-visible, .pb-shoot:focus-visible, .pb-exit:focus-visible { outline: 2px solid #F2B33D; outline-offset: 2px; }` with `.pb-tgl:focus-visible, .pb-seg button:focus-visible, .pb-shoot:focus-visible, .pb-clip:focus-visible, .clip-stop:focus-visible, .pb-exit:focus-visible { outline: 2px solid #F2B33D; outline-offset: 2px; }`.
3. After the `.pb-exit { display: inline-grid; ... }` rule, add upstream's `photo.css` lines for the clip, with its variables as literals:

```css
.pb-clipset {
  display: contents;
}
.pb-clip {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  font:
    700 0.84rem/1 -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Helvetica,
    Arial,
    sans-serif;
  color: #f6efe4;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(232, 134, 95, 0.7);
  border-radius: 11px;
  padding: 9px 14px;
  cursor: pointer;
}
.pb-clip .ic {
  color: #ff6b5e;
}
.pb-music {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}
.pb-music .ic {
  width: 14px;
  height: 14px;
}
.pb-music:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
/* the clip being made: a dark cover over the office with the picture as it is recorded */
.clip-cover {
  position: absolute;
  inset: 0;
  z-index: 8;
  display: grid;
  place-content: center;
  justify-items: center;
  gap: 12px;
  background: rgba(8, 11, 17, 0.92);
}
.clip-view {
  width: min(72vh, 82vw);
  height: min(72vh, 82vw);
  border-radius: 14px;
  box-shadow: 0 18px 48px rgba(0, 0, 0, 0.5);
}
.clip-prog {
  width: min(72vh, 82vw);
  height: 5px;
  border-radius: 3px;
  background: rgba(255, 255, 255, 0.12);
  overflow: hidden;
}
.clip-cover--tall .clip-view {
  height: min(72vh, 146vw);
  width: calc(min(72vh, 146vw) * 9 / 16);
}
.clip-cover--tall .clip-prog {
  width: calc(min(72vh, 146vw) * 9 / 16);
}
.clip-prog i {
  display: block;
  height: 100%;
  width: 0;
  background: #f2b33d;
}
.clip-label {
  font:
    600 0.82rem/1.3 -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Helvetica,
    Arial,
    sans-serif;
  color: #eef1f7;
}
.clip-stop {
  font:
    700 0.8rem/1 -apple-system,
    BlinkMacSystemFont,
    "Segoe UI",
    Roboto,
    Helvetica,
    Arial,
    sans-serif;
  color: #eef1f7;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 10px;
  padding: 8px 16px;
  cursor: pointer;
}
```

(`.clip-cover` is `z-index: 8`, above the bar's 6, as upstream has it. Keep these after the `.photo-bar .ic` size rule so `.pb-music .ic` wins by order.)

In `setup()`, after the `showWalk(); fine.addEventListener('change', showWalk);` line add:

```js
// The clip needs a recorder, a canvas that can be captured, photo mode (a host that cannot keep a download has none) and
// a pointer (a phone's browser would render 1080 px at four times the pace for fifteen seconds: memory and heat)
const showClip = () => {
  $("ph-clipset").hidden = !(
    host.photo !== false &&
    typeof MediaRecorder === "function" &&
    typeof HTMLCanvasElement.prototype.captureStream === "function" &&
    fine.matches
  );
};
showClip();
fine.addEventListener("change", showClip);
```

(`MediaRecorder` is read by name, and a missing global makes `typeof` give `'undefined'`; a test that sets it to `undefined` gets the same.)

- [ ] **Step 8: Build, run, check**

```bash
npm run build:world
npx vitest run client/world/clip-music.test.ts client/world/clip.test.ts client/world/camera-bar.test.ts client/world/photo.test.ts client/world/time-mode.test.ts client/world/entry.test.ts
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
```

Expected: PASS. If `clip.test.ts` fails on `MediaRecorder`, note that jsdom has none, so the stub with `undefined` is the honest case.

- [ ] **Step 9: SOURCES.md**

In "What is taken" add: "`ui/timelapse.js` and `ui/clip-music.js`: the 15-second clip, from photo mode's bar. Two changes by hand, each starting `// PASEO:`: the file is named `office-clip-...`, and `musicTrack` returns null while `sfx.on` is false, so the music (and the audio context that carries it into the recording, never to the speakers) exists only while the Sound setting is on. The clip is offered on a desktop or browser only (a recorder, a capturable canvas, a fine pointer, and `host.photo`); its markup and styles are in `ui/camera-bar.js`." Extend the `ui/photo.js` bullet: "the Music button is synced with the Sound setting as the bar opens, and Escape and P do nothing while a clip is made". Take "clip recording" out of the sentence that lists what is left out, so it reads: "Of the camera toolbar and photo mode, the list button is left out on purpose." Replace the sentence "The scene writes three things to the app origin's `localStorage`..." with: "The scene writes six things to the app origin's `localStorage`, under keys that start with `office-`: which team sits where, the plants, the graphics level, that the tour was seen (`office-tips`), and the clip's shape and music choice (`office-clip-shape`, `office-clip-music`). It reads `office-autocam` (`off` turns the automatic camera off). It makes no network call; a clip is recorded in the page and saved as a download."

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: a 15-second clip of the floor, on desktop and in browsers"
```

---

### Task 5: The bundle's size, and the tests that name the new parts

**Files:**

- Modify: `server/world-script.test.ts`

**Interfaces:**

- Consumes: the built `WORLD_SCRIPT` from Tasks 1 to 4.

- [ ] **Step 1: Measure**

```bash
npm run build:world
node -e 'const s=require("fs").readFileSync("server/world.generated.ts","utf8"); console.log(JSON.parse(s.match(/WORLD_SCRIPT: string = (".*");\n$/s)[1]).length)'
```

Expected: about 1,140,000 to 1,160,000 (1,116,817 before this piece; about +22 KB from it; piece 2 adds its own). Write the number down for the commit message. If it is 1,180,000 or more, the cap in step 3 changes (decision 16).

- [ ] **Step 2: Write the failing tests**

In `server/world-script.test.ts`, add a test after "bundles upstream's photo mode, with Paseo's mark and file name":

```ts
it("bundles the camera extras: the tour, the clip, and the automatic camera", () => {
  const read = (name: string) =>
    readFileSync(new URL(`../vendor/my-office/src/office/${name}`, import.meta.url), "utf8");
  const tips = read("ui/tips.js");
  const timelapse = read("ui/timelapse.js");
  const music = read("ui/clip-music.js");
  const photo = read("ui/photo.js");
  const bundle = WORLD_SCRIPT;

  // The tour: no bell card, the person card in Paseo's words, once per device.
  expect(tips).toContain("PASEO:");
  expect(tips).not.toContain("key: 'bell'");
  expect(bundle).toContain("office-tips");
  expect(bundle).toContain("Each person is an agent");
  expect(bundle).not.toContain("the files it edits");
  // The clip: the file is named for the office, the music waits for Sound, the choices are kept on the device.
  expect(timelapse).toContain("office-clip-");
  expect(timelapse).not.toContain("my-office-clip-");
  expect(music).toMatch(/if \(!sfx\?\.on\) return null;/);
  expect(bundle).toContain("office-clip-");
  expect(bundle).toContain("office-clip-music");
  expect(bundle).toContain("ph-clipset");
  // The clip's cover is not hidden by photo mode's rule.
  expect(bundle).toContain(":not(.clip-cover)");
  // Photo mode's day and night go back with it, and a clip keeps it open.
  expect(photo).toContain("setTimeMode('auto')");
  expect(photo).toContain("if (state.clip) return;");
  expect(bundle).toContain("data-ph-time");
  // The automatic camera and its switch.
  expect(bundle).toContain("office-autocam");
  // The scene still makes no network call of its own: nothing the new files add calls out.
  expect(bundle).not.toMatch(/\bfetch\(["'`]https?:/);
  expect(bundle).not.toContain("process.env");
});
```

In the existing "holds one script..." test, if step 1's number is 1,180,000 or more, change `expect(script.length).toBeLessThan(1_200_000);` to `expect(script.length).toBeLessThan(1_250_000);` and add the measured number to the comment above it ("The scene with three.js r160; ...; measured N after the camera extras"). Otherwise leave the bounds and add only that comment.

- [ ] **Step 3: Run**

Run: `npx vitest run server/world-script.test.ts`
Expected: PASS (the new test passes because the bundle was built after Task 4; a failing line names the missing marker: `ph-clipset` comes from Task 4, `data-ph-time` from Task 1).

- [ ] **Step 4: Check, commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
npm test -- --maxWorkers=4 > /tmp/office-p4-suite.txt 2>&1; tail -n 15 /tmp/office-p4-suite.txt
git add -A && git commit -m "test: the bundle names the camera extras, and its size is read again"
```

---

### Task 6: A look, and what was seen

**Files:**

- Modify: `docs/verified.md`, `README.md`, `docs/office.md`

- [ ] **Step 1: A stock daemon with the branch installed**

As `docs/verified.md` describes the earlier looks and piece 1's plan Task 7 sets out: a clean `/tmp/office-stock-home`, the published 0.16.2 daemon on port 6798 with `env -i`, the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`, the plugin installed by Git from the local repo at the branch's commit. `daemon status` must show 6798 and that home before any plugin command. Open the page in a Chromium browser, the office's 3D view, at 1280 px and at 390 px wide.

- [ ] **Step 2: Look at 1280 px**

The throwaway daemon has no provider, so the floor is empty (its note shows). To have people, drive the scene's own API from the browser tool's script call, in the office's frame: `const w = document.querySelector('iframe').contentWindow; w.PaseoOfficeWorld.setSessions([...])` with sessions in the shape of `WorldSession` (`client/world/world-api.ts`: `id`, `name`, `title`, `dir`, `git: { repo }`, `status`, `agent`, `lastPrompt`, `stuck`, `subs: []`), made-up names. Say in the record if the app's feed overwrote them.

- The tour: `localStorage.removeItem('office-tips')` in the app's page and reload. About 5 s after the floor settles a card points at the lamp; Next goes on through switch, coffee, printer, cat, a person (with people added), Walk in. No bell card. The arrow is at the thing; the Walk in card stands above its button; Skip ends it, Done ends it, Escape ends it; a reload does not bring it back (`office-tips` is `seen`). Entering Walk in or Photo mode during it ends it.
- The automatic camera: with people added at `rest`, wait 30 s without touching the floor, then send the same list with one `status: 'wait'`. The camera slides to that person and returns 7 s later. Press a view button during the glide: the camera goes there and is not pulled back. Open a person's card: no glide. `localStorage.setItem('office-autocam','off')` and reload: no glide.
- Photo mode (the camera button or P): the bar has Auto, Day and Night with Auto pressed. With a light theme, Night lights the room by night (and the backdrop stays light: note how it reads); with the dark theme, Day. Leaving photo mode puts the lights back to the theme. Toggle the app's theme with photo mode open: the lights follow it. Click the wall clock: nothing changes and its tooltip says the lights follow the theme.
- The clip: in the photo bar, the shape pair, Music and "Clip 15 s" show. With Sound off (the default) Music is dimmed and its tooltip says to turn Sound on. In the frame hook the download: `const f = document.querySelector('iframe').contentWindow; const seen = []; const click = f.HTMLAnchorElement.prototype.click; f.HTMLAnchorElement.prototype.click = function () { if (this.download) seen.push({ name: this.download, href: this.href }); return click.call(this); };`. Press "Clip 15 s": a cover with the picture and a progress bar shows and counts; Escape and P do nothing meanwhile; Stop ends it with nothing saved. A full run ends with a toast that says the clip was saved, and `seen` holds a name that starts `office-clip-` and ends `.mp4` or `.webm`; fetch the blob's URL in the frame and record its size and `type`. Record the shape's `-9x16` name for the vertical one. After it, the lights and camera are as before the clip, and Esc leaves photo mode. Look at the cover's preview frame for how the floor is framed from Overview, at 1280 px and in a window about 900 px wide.
- With a recorder missing, simulated by deleting `MediaRecorder` in the frame before the bar is set up (reload with the script call in an init hook), the clip group is not drawn.
- The scene's `localStorage`: `office-tips`, `office-clip-shape`, `office-clip-music` appear and nothing else new. No network request to anywhere is made by the scene (the browser tool's request log shows only the app's own).

- [ ] **Step 3: Look at 390 px**

- Photo mode's bar with Auto, Day, Night and the size group wraps and fits; nothing runs past the edge. No clip group (a coarse pointer, or the browser tool's touch emulation).
- No tour appears (it needs a fine pointer): clear `office-tips`, reload, wait 10 s.
- The floor draws; the automatic camera glide works the same way (drive a `wait` as above).

- [ ] **Step 4: What cannot be seen there, and is the owner's**

Record each in `docs/verified.md` as not seen:

- A clip made in the desktop app itself: MediaRecorder, the codecs, and the download starting from the app's frame; and that the file plays, with the music (Sound on) and without.
- The clip's smoothness on real graphics (the headless browser draws in software).
- The tour on the owner's first open after the update (it will show once, on the desktop).
- The glide for a real permission request, from a real agent.
- On the phone: no tour, no clip, no Photo mode in the Android app (`photo: false`); the glide on a real request.

- [ ] **Step 5: If the clip's framing is wrong, the fallback**

If the preview shows the floor cropped or much smaller than a clip from upstream's own view would be, the cause is `rec.z0 = camera.zoom` (upstream records from its `BASE_ZOOM`, the port from the fitted zoom). Then, as one more hand change in `ui/timelapse.js`, set the clip's start zoom to the fitted zoom's share of the clip's frustum: change `z0: camera.zoom` in the `rec = {...}` literal to `z0: 0.8` with `// PASEO: the clip frames the company floor at upstream's base zoom, not at the fitted one`, add the line to `vendor/SOURCES.md`, add a marker assertion for it to Task 5's test, rebuild, look again, and commit as `fix: the clip frames the floor at upstream's zoom`. If it reads well, do nothing.

- [ ] **Step 6: Record, and the docs**

`docs/verified.md`: a section "Camera extras (v0.5.0)" with what was seen at each width (the list above, as facts: what the browser showed, what the file's name, type and size were), and the "not seen" list of step 4. Integrate with the existing sections; do not only append a diary.

`README.md`:

- In "What it does", add a bullet: "Takes a photo of the 3D floor, in the app's light or held to day or night for the photo, and on a desktop or in a browser records a 15-second clip of it; a tour of the floor's things shows once on a desktop."
- In "What works where", the first row becomes: "Desktop app and browsers | The 3D floor, the 2D floor and the list; Photo mode and clips". The store phone row stays; add to its text nothing. Add: "The phone app with a script frame | The 3D floor without Photo mode, clips and the tour".
- In "What it reads and where it sends it", after the bullet that says the scene makes no network call, add: "A clip is recorded inside the page and saved as a download on the device; nothing is sent. The scene keeps on the device, under keys that start with `office-`, which team sits where, the plants, the graphics level, that the tour was seen, and the clip's shape and music choice."

`docs/office.md`, under "The 3D floor": integrate a paragraph or two, in the same plain style:

- The automatic camera: a person already in the office whose status becomes "waiting for you" glides the camera to them for 7 seconds, unless the camera was moved in the last 30 seconds, someone is walking in, taking a photo, or has a card open. It is on by default; `localStorage` key `office-autocam` set to `off` turns it off (there is no setting for it).
- Photo mode's lighting: Auto follows the app's theme, Day and Night hold for the photo, and leaving photo mode puts the lights back. The wall clock does not change the lights.
- The tour: six or seven cards on a desktop's first visit to the 3D floor, once per device (`office-tips`; remove it to see the tour again). Not on a phone.
- The clip: Photo mode's bar has Clip 15 s on a desktop or in a browser with a recorder, a square or vertical shape, and Music, which is made only while Sound is on. The file is `office-clip-...` in Downloads. Not where Photo mode is off, and not on a touch device. The camera, the names and the counts it shows are the scene's own: never a file name, a command or a prompt.
- Change the sentence "It writes three things to the app origin's `localStorage`..." to the six keys of `vendor/SOURCES.md`, and the sentence "Photo mode is off in an app, since a WebView cannot keep a download." to also say clips and the tour are off there.

Run `npm run format:check`, then stop the daemon by its pid; confirm 6798 is closed and 6767 untouched. Commit:

```bash
git add -A && git commit -m "docs: what was seen of the camera extras on a stock daemon"
```

---

### After the tasks (controller, with the owner's go-ahead)

Final whole-branch review (read the `vendor/SOURCES.md` list against `git grep -n "PASEO:" vendor/my-office/src/office/ui/{tips,timelapse,clip-music,photo}.js`); fixes; merge to `main`; push; CI green (`check:world` included); `paseo plugin update office --ref <commit>` on the owner's host; the owner looks on the desktop app and on the phone:

- Desktop: the tour shows once at the first open of the 3D floor (Skip or Done; it does not come back); photo mode's Auto, Day and Night, and that the lights go back; a clip made and played with Sound off and with Sound on; the glide when a real agent asks for a permission after 30 quiet seconds.
- Phone: no tour, no Photo mode and no clip in the Android app; the glide on a real request.

Then tag `v0.5.0` and write its release notes (what is added, that the tour shows once, and the keys `office-autocam` and `office-tips`).
