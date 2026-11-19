# paseo-office piece 2: sounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 3D office plays my-office's own sounds, off until the person turns them on in a device setting "Sound" or with a button on the floor's toolbar.

**Architecture:** `audio/sfx.js` is taken from my-office by the import tool, less the one tune the bundle refuses, so every `sfx.play(...)` the port already makes becomes audible when the switch is on. The switch is a field of the `office-device` setting, read by a hook that the Office settings page and the 3D view share. The view sends it to the scene with `setSound` (the same call on the web frame and on the phone's script frame), and the scene's Sound button asks the host to change it with an `onSound` callback. A small Paseo-own module in the page holds the switch's state and finds out whether the frame lets audio start.

**Tech Stack:** Plain JavaScript in the vendored scene (Web Audio), TypeScript and React Native in the plugin (`/workspace/QFlavours/paseo-office`), `@getpaseo/plugin` 0.16.2, Vitest with jsdom, esbuild for the bundle.

**Spec:** `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-paseo-office-roadmap-design.md` (piece 2, "2. Sounds"). Findings on `sfx.js` are in `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-my-office-survey.md`, section A. Version tag: v0.3.0.

## What was read, and what it shows

- Upstream's `office/audio/sfx.js` (75 lines, at the vendored commit `b68228871fe30cd2c759a2c919337a9a9d1f5644`; a clone is at `/tmp/ref-office/my-office`). It has 27 sounds, all made with oscillators and noise, no files. The port's copy (`vendor/my-office/src/office/audio/sfx.js`, 40 lines) is the engine plus `siren`, and `get on() { return false; }`. Cut by the port: `noise`, 26 sounds, the `GAP` entries for them, and the real `on` getter. Why, per `vendor/SOURCES.md`: the sounds were left out of 0.1.0, and `on` reads false because `people/karaoke.js` sings through its own audio while `sfx.on` is true.
- Upstream's `on` starts true unless `localStorage` `office-sound` is `"off"`. `set(v)` stores the key and, for true, makes the audio context (`unlock`). `unlock` also runs on every `pointerdown` and `keydown` on the window, whatever `on` says.
- The 68 `sfx.play(...)` calls of the modules the port has use 19 names: `click` (19 calls), `pop`, `clap`, `beep`, `coin`, `meow`, `deploy`, `water`, `thud`, `print`, `bell`, `ding` (2), `turn`, `siren`, `rustle`, `micro`, `buzz`, `brew`, `bloop`. Seven sounds are played by none of them: `perm`, `key`, `alarm`, `chat`, `pock`, `shutter`, `mixue`. All 19 are in upstream's `SOUNDS`. `mixue` is played only by the shop code the port does not have.
- The test: `server/world-script.test.ts`, in "the scene's bundle builds with the new modules": `expect(script).toContain("office-sound")` and `expect(script).not.toContain("mixue")`. The tune is a melody of a shop's song. Upstream's `mixue` sound and its `GAP` entry `mixue: 8` are the only places the word is in the file.
- Karaoke (`people/karaoke.js`) makes an `AudioContext` of its own (`unlock`, line 41) and reads `sfx.on` in three places: `playSong` returns early when it is false (line 51), every frame sets the mix's gain to 0 when it is false (line 309), and its press listeners unlock its context only while it is true (line 332). So it follows the switch once `sfx.on` is the real value, with no change to karaoke. One gap: a press made while the switch was off did not unlock karaoke's context; the next press after the switch is on does.
- The scene's host values: `plan`, `dark`, `colors`, `brand`, `photo` are options of `start`; the web frame calls `PaseoOfficeWorld.start` directly (`client/world/world-view.tsx`), the phone's script frame goes through `createWorldBridge` (`client/world/world-bridge.ts`), which posts every non-function option except `brand` as data and every function option as a named callback, and `bridgePageScript` turns the names back into stand-ins. Values that change while the page lives are methods (`setTheme`, `setMachine`, `setIncidents`), each a `sender("...")` of the bridge. So the switch is a method, `setSound`; the button's press is a callback, `onSound`.
- The toolbar (`vendor/my-office/src/office/ui/camera-bar.js`, the port's stand-in): `BAR` is one markup string; buttons are plain `<button class="tb-full">` with `aria-label`, `title`, and an icon span; `setup()` wires them with `$('id').addEventListener('click', ...)`; `.tb-full[aria-pressed="true"]` is the accent look; the tooltip is `::after { content: attr(aria-label) }`. Icons come from upstream's `ui/icons.js`, which has no speaker, and is not changed.
- `officeDeviceSettings` (`shared/settings.ts`): `id: "office-device"`, version 2, fields `threeD`, `view`, `rungIncidents`. Its savers: `useIncidentAlarm` saves `{ ...values, rungIncidents }` (keeps new fields); `useViewChoice` in `client/office-surface.tsx` saves `{ threeD, view, rungIncidents }` (drops any new field: it must change). `office-column` is a separate setting for exactly this reason.
- `client/engine-compat.test.ts` bans `toSorted`, `toReversed`, `toSpliced`, `findLast`, `findLastIndex`, `Object.groupBy`, `Map.groupBy`, `Array.fromAsync`, Set algebra methods and a two-argument `.with(` in every non-test `.ts`/`.tsx` under `client/` and `shared/`, and `index.client.tsx`.
- The bundle today is 1,116,817 characters; the test allows 1,000,000 to 1,200,000. Upstream's `sfx.js` adds about 3 KB.

## Decisions

1. **Take `audio/sfx.js` by the import tool, and cut the one tune by hand.** Reason: the roadmap says unchanged less the one tune; the tool then keeps its file on later updates (it carries a `PASEO:` note) and reports it for a hand comparison. Cost if wrong: one more hand-compared file at each upstream update.
2. **The Sound switch is a new field `sound: z.boolean().default(false)` of `officeDeviceSettings`, with no version bump.** Reason: a missing field parses to false, and piece 1 added `lastAgent` the same way; a bump would make an older client refuse the document. Cost: a stale client that saves the document whole drops `sound` (it falls back to off).
3. **Every saver of the device document keeps the whole of it.** `useViewChoice` becomes `{ ...kept, threeD, view }`. Reason: the roadmap and the setting's own history. Cost: none beyond the test.
4. **The setting reaches the scene as a method, `setSound(on)`, not a start option.** Reason: the value changes while the page lives, and the settings are read after the frame may have started; one path serves the web frame and the phone's script frame (a `sender("setSound")` in the bridge). The scene starts off, so nothing plays before the host has said. Cost: a brief moment of off at start, which is the default anyway.
5. **A press on the scene's button applies the switch in the page at once, then tells the host (`onSound`).** Reason: the browser lets audio start only inside a press; the round trip to the host's setting would leave the press. The hook then holds the tap until the store has it, as the view switch does. Cost: the scene and the stored setting differ for a moment, and for good if the device refuses the save (the settings page then says so, as for the view).
6. **The hook is `client/use-sound.ts`, written like `use-incident-alarm.ts` (a state for the tap, one save at a time, a retry after a conflict, a give-up after a refusal with no conflict), not by moving `switchSync` out of `office-surface.tsx`.** Reason: moving 100 lines of generic code is a refactor this piece does not need. Cost: a second copy of the pattern.
7. **Whether the frame lets audio start is found by a probe in a Paseo-own file, `vendor/my-office/src/office/paseo-sound.js`.** Reason: `sfx.js` keeps its context private. On the first `pointerup` or `keydown` the probe makes a throwaway `AudioContext`, calls `resume()`, and says `ready` if the context runs, `blocked` if it does not run within 1.5 s or throws, and `unsupported` at once when the page has no Web Audio. It then closes the context. Cost: one extra short-lived context, once per page.
8. **`pointerup` and `keydown` start the probe, not `pointerdown`.** Reason: on a touch screen `pointerdown` is not an activating event in Chrome; `pointerup` is. Upstream's own `unlock` stays on `pointerdown` and is called again at each press, so a second press resumes its context. Cost: on a phone the first tap may not be enough for upstream's context; see "Not verifiable".
9. **Where audio cannot start the button is `aria-disabled`, says so in its label ("Sound is not available here") and a press says so in a toast; the switch is held off in the scene whatever the setting holds, and the setting is not changed.** Reason: the roadmap ("says so and stays off"); changing a setting from a probe could loop. Cost: the settings page may show Sound on for a device whose frame cannot play it.
10. **The siren follows the switch too.** In 0.1.0 the siren played after a first press (upstream's default was on). Now it plays only with Sound on. Reason: one switch, off by default, is what the owner chose. Cost: someone who counted on the siren must turn Sound on; the incident banner and the red light still show.
11. **The frame gets `allow="fullscreen; autoplay"`.** Reason: harmless, and a same-origin `srcdoc` frame may not need it; one release is cheaper than a second. Cost: none known.
12. **The Sound button draws its own speaker icon in `camera-bar.js`.** Reason: upstream's `icons.js` has none and stays unchanged. Cost: two small SVG shapes, in the port's file.
13. **No volume control, no per-sound switches, no merge of karaoke's context into `sfx`.** Reason: not asked; the survey's idea of merging contexts is a change to upstream's karaoke. Cost: up to three live contexts in one page, as upstream has.
14. **The scene's other audio makers are not in the port yet (the street's two scenes, the clip music).** When a later piece takes one, it must read `sfx.on` as karaoke does. Noted for pieces 4 and 8.

## Assumes from earlier pieces

- Piece 1 (v0.2.0) is merged. It added `lastAgent` (optional) to `officeDeviceSettings` and made every saver carry it. Task 2 reads the savers as they stand and carries `sound` through each the same way; if piece 1 already changed `useViewChoice` to spread the document, the edit there is smaller.
- Piece 1 changed no file under `vendor/` and none of `client/world/`. If a later piece changed `world-view.tsx` or `world-view-native.tsx` (the `latest` ref's fields), the places named in Task 4 are found by the text, not the line.
- The column's and the surface's files keep the names used here (`client/office-settings.tsx`, `client/office-surface.tsx`).
- `docs/verified.md` has one section per look, as piece 1 left it.

## Global Constraints

- Work in `/workspace/QFlavours/paseo-office` on a branch `feat/sounds` cut from `main`. The repo is public: nothing private in files, fixtures or commit messages; no real brand's name, logo or tune (the removed tune is described as "a shop's tune", never by name); no AI attribution on commits; never push, never `gh` (the controller publishes).
- The repo's rules from its README and the roadmap: my-office's MIT licence and notices stay (the banner comes from `vendor/my-office/LICENSE`); his files are taken unchanged wherever they can be, and a change by hand starts with `// PASEO:` and is listed in `vendor/SOURCES.md`.
- The scene never receives a file name, a command or a prompt. The switch is the only value this piece sends it. The scene makes no network call.
- App-side code (`client/`, `shared/`) uses nothing a phone's engine lacks: `client/engine-compat.test.ts` must stay green. No `toSorted`, `toReversed`, `findLast` and the rest of its list.
- Cross-platform: DOM only in `*.web.ts` or inside the page's script; no `onPointerEnter`/`onPointerLeave`.
- Stock Paseo 0.16: only calls its SDK has. This piece uses `useSettings` only.
- Styles of the plugin's own screens in `client/styles.ts`, never inline objects. The page's styles live in `camera-bar.js` and `paseo-style.js`.
- Run `npm run build:world` after any change under `vendor/`, and commit `server/world.generated.ts` with it.
- The scene's `process.env` check and the bundle's size window (1,000,000 to 1,200,000 characters) stay as they are.
- Never run a bare `paseo` command and never start, stop or restart the daemon on port 6767. A throwaway daemon uses `PASEO_HOME=/tmp/office-stock-home`, port 6798, `env -i`, and the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`.
- Checks after each task: `npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts`, and the test files touched; the whole suite (`npm test -- --maxWorkers=4`, output to a file under /tmp) before each commit.

---

### Task 1: Upstream's sound engine, less one tune

**Files:**

- Modify: `vendor/my-office/import-upstream.mjs` (DENY, its comment)
- Delete then re-create by the tool: `vendor/my-office/src/office/audio/sfx.js`
- Regenerated by the tool: `vendor/my-office/src/office/paseo-modules.js`, `vendor/my-office/MANIFEST.json`
- Modify: `vendor/my-office/src/office/audio/sfx.js` (by hand, the tune), `vendor/my-office/src/office/paseo-entry.js`
- Modify: `vendor/SOURCES.md`, `server/world.generated.ts` (built), `server/world-script.test.ts`, `client/world/entry.test.ts`
- Create: `client/world/sfx.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces: `vendor/my-office/src/office/audio/sfx.js` exporting `sfx` (`{ on, set(v), play(name) }`) and `setup()`, started by `paseo-modules.js` in upstream's place (after `lifeYourTurn`, before `coreLoop`); the entry starts with `sfx.set(false)` (Task 3 completes the entry's use of it).

- [ ] **Step 1: A clean branch and the reference clone**

```bash
cd /workspace/QFlavours/paseo-office && git switch main && git switch -c feat/sounds
ls /tmp/ref-office/my-office/src/office/audio/sfx.js || git clone https://github.com/khanh020905/my-office /tmp/ref-office/my-office
git -C /tmp/ref-office/my-office rev-parse HEAD   # must be b68228871fe30cd2c759a2c919337a9a9d1f5644
ls /tmp/ref-office/three/node_modules/three/package.json || npm install --prefix /tmp/ref-office/three three@0.160.0
```

If the clone's head is newer than the vendored commit, check out the vendored commit in it (`git -C /tmp/ref-office/my-office checkout b68228871fe30cd2c759a2c919337a9a9d1f5644`): this piece does not take a newer upstream.

- [ ] **Step 2: Write the failing test**

Create `client/world/sfx.test.ts`. It runs the real `sfx.js` in jsdom with a counting stand-in for Web Audio and `core/env.js` stood in with the two values `sfx.js` reads.

```ts
// @vitest-environment jsdom
// Upstream's sound engine (audio/sfx.js) as the port takes it: every sound but one tune, off until the
// switch is on, and a context made on the first press. Web Audio is a stand-in that counts what starts.
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { readFileSync } from "node:fs";

vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  reduceMotion: false,
  replay: { on: false },
}));

const made = vi.hoisted(() => ({
  contexts: [] as { state: string; currentTime: number }[],
  started: 0,
}));

class FakeNode {
  frequency = { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 };
  gain = { setValueAtTime() {}, exponentialRampToValueAtTime() {}, value: 0 };
  type = "";
  buffer: unknown = null;
  connect(next: unknown) {
    return next;
  }
  start() {
    made.started += 1;
  }
  stop() {}
}

class FakeContext {
  state = "suspended";
  currentTime = 0;
  sampleRate = 48_000;
  destination = {};
  constructor() {
    made.contexts.push(this);
  }
  resume() {
    this.state = "running";
    return Promise.resolve();
  }
  createOscillator = () => new FakeNode();
  createGain = () => new FakeNode();
  createBiquadFilter = () => new FakeNode();
  createBufferSource = () => new FakeNode();
  createBuffer = () => ({ getChannelData: () => new Float32Array(8) });
}

/** The listeners a test's setup() put on the window, taken off after it. */
const added: [string, EventListenerOrEventListenerObject][] = [];

beforeEach(() => {
  made.contexts.length = 0;
  made.started = 0;
  added.length = 0;
  localStorage.clear();
  Object.assign(window, { AudioContext: FakeContext });
  const real = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    added.push([type, listener]);
    real(type, listener, options);
  });
});
afterEach(() => {
  for (const [type, listener] of added) window.removeEventListener(type, listener);
  vi.restoreAllMocks();
  delete (window as { AudioContext?: unknown }).AudioContext;
});

async function load() {
  vi.resetModules();
  const mod = await import("../../vendor/my-office/src/office/audio/sfx.js");
  mod.setup();
  return mod.sfx as {
    on: boolean;
    set(on: boolean): void;
    play(name: string): void;
  };
}

/** A press on the page: upstream's engine makes its context and resumes it. */
function press() {
  window.dispatchEvent(new Event("pointerdown"));
}

/** Plays a name with the clock moved past every gap, so only the name decides. */
function play(sfx: { play(name: string): void }, name: string): number {
  const before = made.started;
  const context = made.contexts[made.contexts.length - 1];
  if (context) context.currentTime += 100;
  sfx.play(name);
  return made.started - before;
}

const SOUNDS = [
  "perm",
  "turn",
  "key",
  "print",
  "ding",
  "deploy",
  "alarm",
  "siren",
  "meow",
  "pop",
  "chat",
  "bloop",
  "brew",
  "rustle",
  "click",
  "pock",
  "shutter",
  "coin",
  "beep",
  "micro",
  "buzz",
  "thunder",
  "bell",
  "water",
  "clap",
  "thud",
];

test("each of upstream's sounds but the one tune makes a sound", async () => {
  const sfx = await load();
  press();
  sfx.set(true);
  for (const name of SOUNDS) expect(play(sfx, name), name).toBeGreaterThan(0);
});

test("the tune left out makes no sound, and its name is nowhere in the file", async () => {
  const sfx = await load();
  press();
  sfx.set(true);
  expect(play(sfx, "mixue")).toBe(0);
  const text = readFileSync(
    new URL("../../vendor/my-office/src/office/audio/sfx.js", import.meta.url),
    "utf8",
  );
  expect(text.toLowerCase()).not.toContain("mixue");
  expect(text).toContain("// PASEO:");
});

test("nothing plays while the switch is off, and nothing before a press", async () => {
  const sfx = await load();
  // Upstream starts on, but until a press there is no context to play with.
  expect(sfx.on).toBe(true);
  expect(play(sfx, "click")).toBe(0);
  press();
  expect(play(sfx, "click")).toBeGreaterThan(0);
  sfx.set(false);
  expect(play(sfx, "click")).toBe(0);
  sfx.set(true);
  expect(play(sfx, "click")).toBeGreaterThan(0);
});

test("on is the real switch, which karaoke reads, and set(true) is stored under office-sound", async () => {
  const sfx = await load();
  sfx.set(false);
  expect(sfx.on).toBe(false);
  expect(localStorage.getItem("office-sound")).toBe("off");
  sfx.set(true);
  expect(sfx.on).toBe(true);
  expect(localStorage.getItem("office-sound")).toBe("on");
});

test("the karaoke scene is unchanged and follows the switch in the three places it reads it", () => {
  const karaoke = readFileSync(
    new URL("../../vendor/my-office/src/office/people/karaoke.js", import.meta.url),
    "utf8",
  );
  expect(karaoke).not.toContain("PASEO:");
  expect(karaoke).toContain("!sfx.on || replay.on) return;");
  expect(karaoke).toContain("mix.out.gain.value = sfx.on && !replay.on ? loud() : 0;");
  expect(karaoke).toContain("if (sfx.on) unlock();");
});

test("the entry does not set the engine up by hand: the module list does, once", () => {
  const entry = readFileSync(
    new URL("../../vendor/my-office/src/office/paseo-entry.js", import.meta.url),
    "utf8",
  );
  const modules = readFileSync(
    new URL("../../vendor/my-office/src/office/paseo-modules.js", import.meta.url),
    "utf8",
  );
  expect(entry).not.toMatch(/audioSfx\.setup/);
  expect(modules.match(/\['audioSfx', audioSfx\]/g)).toHaveLength(1);
});
```

- [ ] **Step 3: Run it and see it fail**

Run: `npx vitest run client/world/sfx.test.ts`
Expected: FAIL. The port's `sfx.js` has the siren alone, so "each of upstream's sounds" fails on `perm`; `on` is false after `set(true)`; the module list has no `audioSfx`; the entry still has `audioSfx.setup`.

- [ ] **Step 4: Let the tool take the file**

In `vendor/my-office/import-upstream.mjs`:

1. In `DENY`, change `/^office\/(demo|replay|audio)\//,` to `/^office\/(demo|replay)\//,`.
2. In the comment above `DENY`, change "Not taken: upstream's panels, chat window, replay, demo, every sound but the siren, the street, and the daily-life scenes." to "Not taken: upstream's panels, chat window, replay, demo, the street, and the daily-life scenes." and the last sentence "The siren's audio/sfx.js and life/incidents.js are taken trimmed by hand, so they stay denied here and only their exports are checked." to "life/incidents.js is taken trimmed by hand, so it stays denied here and only its exports are checked."
3. In `OWN`, add `"office/paseo-sound.js",` after `"office/paseo-leisure.js",`.

Then delete the stand-in and run the tool, first as a check:

```bash
git rm vendor/my-office/src/office/audio/sfx.js
node vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check
```

Expected report: the commit `b682288`, `would write: 2` (`office/audio/sfx.js`, `office/paseo-modules.js`) and some unchanged; under "kept" the same files that carry a `PASEO:` note as before (`core/env.js`, `interact/first-person.js`, `interact/place-cards.js`, `life/tests.js`, `ui/photo.js`), with no `audio/sfx.js` among them (it no longer exists); no "stand-ins to write or extend" lines (`life/incidents.js`'s import of `sfx` is now met by the real file). If it writes more than these two, or reports a missing stand-in export, stop and read why before going on: a module upstream's `sfx.js` imports must not be new (it imports `../core/env.js` only). Then run it for real, without `--check`.

What the tool does to the other files: `paseo-modules.js` gains `import * as audioSfx from './audio/sfx.js';` and `['audioSfx', audioSfx],` between `lifeYourTurn` and `coreLoop` (upstream's order, so the hand call's position is kept); `MANIFEST.json` loses `office/audio/sfx.js` from `standIns`, gains it in `files` (with the sha of upstream's text, not of the hand-cut file) and in `setupOrder`. Check with `git diff --stat vendor/my-office/MANIFEST.json vendor/my-office/src/office/paseo-modules.js`.

- [ ] **Step 5: Cut the tune by hand**

In `vendor/my-office/src/office/audio/sfx.js` make two changes, each with a `// PASEO:` comment:

1. Replace the whole `mixue` entry, from the line starting `      // the Mixue shop's tune: "Oh! Susanna"` through its closing `      },` (the entry is `mixue: (t) => { ... },` with the `hz`, `e`, `line` and `one` constants), with one line:

```js
// PASEO: upstream's tune for one shop is not taken: it stands for a real brand's. The shop is not in the port either.
```

2. Above the `const GAP = {` line add `    // PASEO: (the gap of the tune that is not taken is gone from this list)` and delete `mixue: 8, ` from the object.

Check: `grep -ci mixue vendor/my-office/src/office/audio/sfx.js` prints `0`.

- [ ] **Step 6: The entry no longer sets the engine up by hand, and starts off**

In `vendor/my-office/src/office/paseo-entry.js`:

1. Replace `import * as audioSfx from './audio/sfx.js';` with `import { sfx } from './audio/sfx.js';`.
2. In the `MODULES` loop replace the two lines

```js
// (upstream starts its incidents and its sounds after the live connection; Paseo's trimmed copies are not in MODULES)
if (name === "coreLoop") {
  lifeIncidents.setup();
  audioSfx.setup();
}
```

with

```js
// (upstream starts its incidents after the live connection; Paseo's trimmed copy of it is not in MODULES. Its sounds are, in upstream's place)
if (name === "coreLoop") lifeIncidents.setup();
```

3. After the line `TYPE_ICON.compact = 'file';` and before `cameraBar.setup();` add:

```js
// PASEO: upstream's engine starts on unless its own page stored "off"; Paseo's scene starts off until the host says on.
sfx.set(false);
```

- [ ] **Step 7: Update the two existing tests and SOURCES.md**

- `client/world/entry.test.ts`: the mock of `audio/sfx.js` becomes

```ts
vi.mock("../../vendor/my-office/src/office/audio/sfx.js", () => ({
  sfx: { play: (name: string) => h.played.push(name), set() {} },
  setup() {},
}));
```

- `server/world-script.test.ts`, in "the scene's bundle builds with the new modules": replace the comment and keep the assertions, adding one:

```ts
// Upstream's sound engine, all its sounds but one shop's tune (a real brand's, kept out by name).
expect(script).toContain("office-sound");
expect(script).toContain("webkitAudioContext");
expect(script).not.toContain("mixue");
```

- `vendor/SOURCES.md`: (a) "Five copied files are changed by hand" becomes "Six", and a bullet is added: `src/office/audio/sfx.js`: the one tune that stands for a real brand's is cut (its sound and its gap); the engine and every other sound are upstream's. (b) "Two files are taken trimmed" becomes "One file is taken trimmed", and the `src/office/audio/sfx.js` bullet is removed from that list (only `life/incidents.js` stays; fix the sentence "Their paths stay" to "Its path stays"). (c) In "What is taken", replace "The games call the group chat and the sounds. The chat's window is not taken: its stand-in exports what the games import and does nothing. The sounds are the siren alone (below). So a game is seen and not heard, and a karaoke song has no sound." with "The games call the group chat and the sounds. The chat's window is not taken: its stand-in exports what the games import and does nothing. The sounds are upstream's, off until the Sound switch is on, so a game and a karaoke song are heard then." (d) In "What is not taken", remove "every sound but the siren, ". (e) In "What the scene is told", change "three things" to "four things" and add "the Sound switch (`office-sound`)" to the list.

- [ ] **Step 8: Build, run, check**

```bash
npm run build:world
npx vitest run client/world/sfx.test.ts client/world/entry.test.ts server/world-script.test.ts
```

Expected: PASS. Then the whole chain from the constraints, and the whole suite.

- [ ] **Step 9: Commit**

```bash
git add -A && git commit -m "feat: the scene takes my-office's sounds, less one tune, off until switched on"
```

---

### Task 2: The Sound setting, its hook and its switch on the settings page

**Files:**

- Modify: `shared/settings.ts`, `shared/settings.test.ts`
- Modify: `client/office-surface.tsx` (`useViewChoice`'s save), `client/office-settings.tsx`
- Create: `client/use-sound.ts`, `client/use-sound.mounted.test.tsx`
- Test: `client/office-settings.mounted.test.tsx`, `client/office-surface-panels.mounted.test.tsx`, `client/world/use-incident-alarm.mounted.test.tsx` (typed fixtures)

**Interfaces:**

- Consumes: nothing from earlier tasks.
- Produces:

```ts
// client/use-sound.ts
export const UNSAVED_SOUND: string;
export interface SoundSwitch {
  /** The switch as the person left it (a tap shows at once); null while the device's setting is read or unreadable. */
  on: boolean | null;
  /** The device refused to store the last tap: the switch holds it until the screen closes. */
  unsaved: boolean;
  set(next: boolean): void;
}
export function useSoundSwitch(): SoundSwitch;
```

and the field `sound: boolean` (default false) in `officeDeviceSettings`' values.

- [ ] **Step 1: Write the failing settings tests**

In `shared/settings.test.ts`: change the existing `"device settings: version 1 values stay and rungIncidents is {}"` expectation to `{ ...stored, rungIncidents: {}, sound: false }`, and add

```ts
test("a device document without sound has it off, and one with it keeps it", async () => {
  expect(officeDeviceSettings.version).toBe(2);
  expect(officeDeviceSettings.schema.parse({ threeD: true })).toMatchObject({ sound: false });
  expect(officeDeviceSettings.schema.parse({ sound: true })).toMatchObject({ sound: true });
});
```

(`officeDeviceSettings.version` stays 2 on purpose: piece 1's `lastAgent` did not bump it either.)

Create `client/use-sound.mounted.test.tsx`, modelled on `client/world/use-incident-alarm.mounted.test.tsx` (a stand-in `useSettings` that holds the document, records saves, and can refuse the next save while another writer moves the revision):

```tsx
/**
 * @vitest-environment jsdom
 */
// The Sound switch's hook, mounted. The device's settings are a stand-in that holds the document and
// records each save.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SettingsState } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { officeDeviceSettings } from "../shared/settings.js";
import { useSoundSwitch, type SoundSwitch } from "./use-sound.js";

type Device = SettingsState<typeof officeDeviceSettings.schema>;
type Values = Extract<Device, { status: "ready" }>["values"];
type Stored = { status: "loading" } | { status: "ready"; values: Values; revision: string };

let stored: Stored;
let saved: { values: Values; revision: string }[];
/** While set, saves are refused; a reload then shows this document (another writer got in first). */
let moved: Stored | null;
/** While true, saves are refused and a reload shows the same document. */
let refuses: boolean;

vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: (): Device => ({
    ...stored,
    saving: false,
    saveError: null,
    save: async (values: Values, revision: string) => {
      if (moved !== null || refuses) return false;
      saved.push({ values, revision });
      stored = { status: "ready", values, revision: `r${saved.length + 1}` };
      return true;
    },
    reset: async () => true,
    reload: async () => {
      if (moved !== null) stored = moved;
      moved = null;
    },
  }),
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const values = (over: Partial<Values> = {}): Values => ({
  threeD: true,
  view: "2d",
  rungIncidents: { "jira:SHOP-1": 5 },
  sound: false,
  ...over,
});
const ready = (over: Partial<Values> = {}, revision = "r1"): Stored => ({
  status: "ready",
  values: values(over),
  revision,
});

let container: HTMLElement;
let root: Root;
let current: SoundSwitch;
function Probe() {
  current = useSoundSwitch();
  return null;
}
const mount = () => act(async () => root.render(<Probe />));
const settle = () => act(async () => void (await new Promise((resolve) => setTimeout(resolve, 0))));

beforeEach(() => {
  stored = ready();
  saved = [];
  moved = null;
  refuses = false;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(async () => root.unmount()));

test("it reads null while the setting loads, and the stored value once it is read", async () => {
  stored = { status: "loading" };
  await mount();
  expect(current.on).toBeNull();
  stored = ready({ sound: true });
  await mount();
  expect(current.on).toBe(true);
});

test("a tap shows at once and saves the whole document with sound changed", async () => {
  await mount();
  await act(async () => current.set(true));
  await settle();
  expect(current.on).toBe(true);
  expect(saved).toEqual([{ values: values({ sound: true }), revision: "r1" }]);
});

test("a tap that the store already holds saves nothing", async () => {
  stored = ready({ sound: true });
  await mount();
  await act(async () => current.set(true));
  await settle();
  expect(saved).toEqual([]);
});

test("a save that lost to another writer is tried again once on the new revision, keeping their fields", async () => {
  await mount();
  moved = ready({ view: "3d", rungIncidents: { "jira:SHOP-2": 9 } }, "r7");
  await act(async () => current.set(true));
  await settle();
  moved = null;
  await settle();
  expect(saved).toEqual([
    {
      values: values({ view: "3d", rungIncidents: { "jira:SHOP-2": 9 }, sound: true }),
      revision: "r7",
    },
  ]);
  expect(current.unsaved).toBe(false);
});

test("a refusal that moved nothing is not tried again; the switch holds the tap and says unsaved", async () => {
  await mount();
  refuses = true;
  await act(async () => current.set(true));
  await settle();
  await settle();
  expect(saved).toEqual([]);
  expect(current.on).toBe(true);
  expect(current.unsaved).toBe(true);
  // A new tap tries again.
  refuses = false;
  await act(async () => current.set(true));
  await settle();
  expect(current.unsaved).toBe(false);
  expect(saved).toEqual([{ values: values({ sound: true }), revision: "r1" }]);
});
```

In `client/office-settings.mounted.test.tsx`: change the device stand-in's values to `{ threeD: true, view: "list", rungIncidents: {}, sound: false }`, change the existing expectation `expect(deviceSaves).toEqual([{ threeD: true, view: "2d", rungIncidents: {} }])` to `[{ threeD: true, view: "2d", rungIncidents: {}, sound: false }]`, and add two tests: (a) a press on the switch named "Sound" saves `{ threeD: true, view: "list", rungIncidents: {}, sound: true }` and leaves the notes' host settings unsaved; (b) with the device document holding `sound: true`, a press on "3D view" saves a document that still has `sound: true`. Read the file's existing helpers for finding a control by its accessible name and use them.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run shared/settings.test.ts client/use-sound.mounted.test.tsx client/office-settings.mounted.test.tsx`
Expected: FAIL: `sound` is not in the schema (`toMatchObject({ sound: false })` fails), `./use-sound.js` cannot be found, and no control named "Sound" exists.

- [ ] **Step 3: The setting**

In `shared/settings.ts`, in `officeDeviceSettings`' schema add, after `rungIncidents`:

```ts
    sound: z.boolean().default(false),
```

and in its doc comment, after the `rungIncidents` sentence: "`sound` is the 3D floor's Sound switch, off until someone turns it on; the scene's button and the settings page change it. Every save of this document writes it whole." Leave `version: 2` and `migrate` as they are (a missing field takes its default).

- [ ] **Step 4: The hook**

Create `client/use-sound.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { officeDeviceSettings } from "../shared/settings.js";

export const UNSAVED_SOUND =
  "Unable to save the Sound setting on this device. It holds until the office is closed.";

export interface SoundSwitch {
  on: boolean | null;
  unsaved: boolean;
  set(next: boolean): void;
}

/** A save of the tap against a revision, and whether the store took it. */
interface Tried {
  value: boolean;
  revision: string;
  stored: boolean;
}

/**
 * The device's Sound switch. A tap shows at once and is saved into the `office-device` document
 * whole (its other fields are kept), one save at a time. A save that lost to another writer is
 * tried again on the revision a reload shows; a refusal that moved nothing is not, and the switch
 * then holds the tap until the next tap or the surface closes (`unsaved`).
 */
export function useSoundSwitch(): SoundSwitch {
  const settings = useSettings(officeDeviceSettings);
  const stored = settings.status === "ready" ? settings : null;
  const [wanted, setWanted] = useState<boolean | null>(null);
  const [tried, setTried] = useState<Tried | null>(null);
  const [saving, setSaving] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { save, reload } = settings;
  useEffect(() => {
    if (wanted === null || stored === null || saving) return;
    if (stored.values.sound === wanted) {
      setWanted(null);
      setTried(null);
      return;
    }
    const { values, revision } = stored;
    // Waiting for the store to show a save it took, or given up on a refusal: not saved again.
    if (tried?.value === wanted && tried.revision === revision) return;
    setSaving(true);
    async function keep(value: boolean): Promise<void> {
      const ok = await save({ ...values, sound: value }, revision);
      if (!ok) await reload().catch(() => undefined);
      if (!mounted.current) return;
      setTried({ value, revision, stored: ok });
      setSaving(false);
    }
    void keep(wanted);
  }, [wanted, stored, saving, tried, save, reload]);
  const set = useCallback((next: boolean) => {
    setTried(null);
    setWanted(next);
  }, []);
  const unsaved =
    wanted !== null &&
    tried !== null &&
    !tried.stored &&
    tried.value === wanted &&
    tried.revision === stored?.revision;
  return { on: wanted ?? stored?.values.sound ?? null, unsaved, set };
}
```

- [ ] **Step 5: The view's save keeps the whole document**

In `client/office-surface.tsx`: delete `const NONE_RUNG: Record<string, number> = {};` and put in its place

```ts
/** What a save keeps while the device's document is unreadable: its defaults. */
const DEVICE_DEFAULTS = officeDeviceSettings.schema.parse({});
```

In `useViewChoice`, replace

```ts
// A view's save keeps the incidents this device rang for.
const rungIncidents = settings.status === "ready" ? settings.values.rungIncidents : NONE_RUNG;
```

with

```ts
// A view's save keeps the rest of the device's document (the incidents it rang for, the Sound
// switch, whatever a later field holds): the saves write it whole.
const kept = settings.status === "ready" ? settings.values : DEVICE_DEFAULTS;
```

the save call `await save({ threeD: value !== "list", view: value, rungIncidents }, against)` with `await save({ ...kept, threeD: value !== "list", view: value }, against)`, and `rungIncidents` in the effect's dependency list with `kept`. Read the file as it is after piece 1: if it already carries `lastAgent` by name, `kept` replaces that too.

- [ ] **Step 6: The switch on the settings page**

In `client/office-settings.tsx`: import `LabeledSwitch` from `./labeled-switch.js` and `UNSAVED_SOUND, useSoundSwitch` from `./use-sound.js`; add `const sound = useSoundSwitch();` after `const view = useViewChoice(...)`; change the prop to `deviceProblem={view.unsaved ? UNSAVED_VIEW : sound.unsaved ? UNSAVED_SOUND : null}` and replace the single child with

```tsx
        <ViewSwitch ... />
        <LabeledSwitch label="Sound" value={sound.on} onChange={sound.set} styles={styles} />
```

(inside a fragment, keeping `ViewSwitch`'s props as they are). If the nested ternary trips the lint rule, move it into `const deviceProblem = ...` above the return. Update the component's doc comment: "...and this device's view and Sound switch".

- [ ] **Step 7: Fix the typed fixtures**

Run `npm run typecheck`. Every fixture typed as the device's values now lacks `sound`: add `sound: false` where the compiler names one (`client/world/use-incident-alarm.mounted.test.tsx`: the `ready` helper and the three inline documents; `client/office-surface-panels.mounted.test.tsx`: `DEVICE.values`). Do not change what those tests assert beyond the extra field in a save they compare.

- [ ] **Step 8: Run, check, commit**

```bash
npx vitest run shared/settings.test.ts client/use-sound.mounted.test.tsx client/office-settings.mounted.test.tsx client/office-surface-panels.mounted.test.tsx client/world/use-incident-alarm.mounted.test.tsx client/engine-compat.test.ts
```

Expected: PASS. Then the chain and the whole suite, and:

```bash
git add -A && git commit -m "feat: a device setting for sound, off by default, with a switch on the settings page"
```

---

### Task 3: The scene's switch, its button and the probe

**Files:**

- Create: `vendor/my-office/src/office/paseo-sound.js`, `client/world/sound.test.ts`
- Modify: `vendor/my-office/src/office/ui/camera-bar.js`, `vendor/my-office/src/office/paseo-entry.js`
- Test: `client/world/camera-bar.test.ts`, `client/world/entry.test.ts`
- Modify: `vendor/SOURCES.md`, `server/world.generated.ts` (built), `server/world-script.test.ts`

**Interfaces:**

- Consumes: Task 1's `sfx` (`set(v)`), the entry's `sfx.set(false)` at start.
- Produces: from `paseo-sound.js`:

```js
export const sound = { on: false, audio: 'idle' /* | 'ready' | 'blocked' | 'unsupported' */, request(next) {}, subscribe(listener) /* -> unsubscribe */ };
export const available = () => boolean;   // audio is neither blocked nor unsupported
export function setOn(on)                 // the switch; stays off where audio is not available
export function watchAudio(win = window, timeoutMs = 1500)  // -> stop()
```

and on `PaseoOfficeWorld`: `setSound(on)`; in `start` options: `onSound(on)`.

- [ ] **Step 1: Write the failing tests**

Create `client/world/sound.test.ts` (the probe and the state):

```ts
// @vitest-environment jsdom
// The page's Sound state (paseo-sound.js) and the probe that finds out whether the frame lets audio start.
import { afterEach, beforeEach, expect, test, vi } from "vitest";

type Mode = "runs" | "hangs" | "rejects" | "throws";
const made = { contexts: 0, closed: 0 };

function install(mode: Mode, name: "AudioContext" | "webkitAudioContext" = "AudioContext") {
  class Fake {
    state = "suspended";
    constructor() {
      if (mode === "throws") throw new Error("no audio");
      made.contexts += 1;
    }
    resume() {
      if (mode === "hangs") return new Promise(() => undefined);
      if (mode === "rejects") return Promise.reject(new Error("not allowed"));
      this.state = "running";
      return Promise.resolve();
    }
    close() {
      made.closed += 1;
      return Promise.resolve();
    }
  }
  Object.assign(window, { [name]: Fake });
}

async function fresh() {
  vi.resetModules();
  // @ts-expect-error vendored JavaScript has no declarations
  return await import("../../vendor/my-office/src/office/paseo-sound.js");
}
const settle = () => vi.advanceTimersByTimeAsync(0);
let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  made.contexts = 0;
  made.closed = 0;
});
afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  delete (window as Record<string, unknown>).AudioContext;
  delete (window as Record<string, unknown>).webkitAudioContext;
});

test("a page with no Web Audio is unsupported at once, and the switch stays off", async () => {
  const m = await fresh();
  stop = m.watchAudio(window);
  expect(m.sound.audio).toBe("unsupported");
  m.setOn(true);
  expect(m.sound.on).toBe(false);
  expect(m.available()).toBe(false);
});

test("the prefixed constructor counts as Web Audio", async () => {
  install("runs", "webkitAudioContext");
  const m = await fresh();
  stop = m.watchAudio(window);
  expect(m.sound.audio).toBe("idle");
});

test("nothing is made until a press; the first press tries one context, finds it running and closes it", async () => {
  install("runs");
  const m = await fresh();
  stop = m.watchAudio(window);
  expect(made.contexts).toBe(0);
  window.dispatchEvent(new Event("pointerup"));
  await settle();
  expect(m.sound.audio).toBe("ready");
  expect(made).toEqual({ contexts: 1, closed: 1 });
  window.dispatchEvent(new Event("pointerup"));
  window.dispatchEvent(new Event("keydown"));
  await settle();
  expect(made.contexts).toBe(1);
});

test("a key press starts the probe too", async () => {
  install("runs");
  const m = await fresh();
  stop = m.watchAudio(window);
  window.dispatchEvent(new Event("keydown"));
  await settle();
  expect(m.sound.audio).toBe("ready");
});

test("a context that does not run within the time is blocked, and the switch goes off", async () => {
  install("hangs");
  const m = await fresh();
  stop = m.watchAudio(window, 1500);
  m.setOn(true);
  const told = vi.fn();
  m.sound.subscribe(told);
  window.dispatchEvent(new Event("pointerup"));
  await vi.advanceTimersByTimeAsync(1499);
  expect(m.sound.audio).toBe("idle");
  await vi.advanceTimersByTimeAsync(2);
  expect(m.sound.audio).toBe("blocked");
  expect(m.sound.on).toBe(false);
  expect(told).toHaveBeenCalled();
  m.setOn(true);
  expect(m.sound.on).toBe(false);
});

test("a resume that rejects, and a constructor that throws, are blocked", async () => {
  install("rejects");
  let m = await fresh();
  stop = m.watchAudio(window);
  window.dispatchEvent(new Event("pointerup"));
  await settle();
  expect(m.sound.audio).toBe("blocked");
  stop();
  install("throws");
  m = await fresh();
  stop = m.watchAudio(window);
  window.dispatchEvent(new Event("pointerup"));
  await settle();
  expect(m.sound.audio).toBe("blocked");
});

test("setOn tells subscribers only when the switch changes, and an unsubscribed listener hears nothing", async () => {
  install("runs");
  const m = await fresh();
  const told = vi.fn();
  const off = m.sound.subscribe(told);
  m.setOn(true);
  m.setOn(true);
  expect(told).toHaveBeenCalledTimes(1);
  off();
  m.setOn(false);
  expect(told).toHaveBeenCalledTimes(1);
  m.setOn("yes"); // only `true` turns it on
  expect(m.sound.on).toBe(false);
});
```

In `client/world/camera-bar.test.ts`:

- Import `// @ts-expect-error vendored JavaScript has no declarations` then `import { sound, setOn } from "../../vendor/my-office/src/office/paseo-sound.js";`. In `beforeEach` add `sound.audio = "idle"; sound.request = () => {}; setOn(false);` (the module is a singleton; `setOn` resets `on`, and `sound.audio` is assigned directly).
- Change "the bar has its nine controls with their labels" to "ten", the expected list gaining `"Sound"` after `"Photo mode"` and before `"Walk in"`.
- Add:

```ts
test("the Sound button asks for the opposite of what it shows, inside the press", () => {
  open();
  const asked: boolean[] = [];
  sound.request = (next: boolean) => asked.push(next);
  expect(page("btn-sound").getAttribute("aria-pressed")).toBe("false");
  click("#btn-sound");
  expect(asked).toEqual([true]);
  setOn(true);
  expect(page("btn-sound").getAttribute("aria-pressed")).toBe("true");
  click("#btn-sound");
  expect(asked).toEqual([true, false]);
});

test("the button's icon is a speaker with waves while sound is on and a crossed one while it is off", () => {
  open();
  expect(page("sound-ico").querySelectorAll("line")).toHaveLength(2);
  setOn(true);
  expect(page("sound-ico").querySelectorAll("line")).toHaveLength(0);
  expect(page("sound-ico").querySelectorAll("path")).toHaveLength(2);
});

test("where audio cannot start the button says so, is disabled, and a press says so in a toast", () => {
  open();
  const asked: boolean[] = [];
  sound.request = (next: boolean) => asked.push(next);
  // The bar re-reads the state when `sound` tells it: a real change of `on` does.
  setOn(true);
  sound.audio = "blocked";
  setOn(false);
  expect(page("btn-sound").getAttribute("aria-disabled")).toBe("true");
  expect(page("btn-sound").getAttribute("aria-label")).toBe("Sound is not available here");
  click("#btn-sound");
  expect(asked).toEqual([]);
  expect(h.toast).toHaveBeenCalledWith("This app does not let the office play sound.");
});

test("the disabled button is drawn dimmed, and its hover does not light it", () => {
  build();
  const css = document
    .querySelector(".toolbar")
    ?.parentElement?.querySelector("style")?.textContent;
  expect(css).toContain('.tb-full[aria-disabled="true"]');
});
```

In `client/world/entry.test.ts`:

- In the `h` hoisted object add `sound: [] as boolean[], soundAsked: [] as boolean[]`; the sfx mock's `set` becomes `set: (on: boolean) => h.sound.push(on)`; `beforeEach` adds `h.sound.length = 0; h.soundAsked.length = 0;`.
- Before the `world.start({` call add a Web Audio stand-in and capture the start's calls:

```ts
// A page with Web Audio: the entry's probe finds it, and the switch can be on.
Object.assign(window, {
  AudioContext: class {
    state = "suspended";
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  },
});
```

and in the `start` options add `onSound: (on: boolean) => h.soundAsked.push(on),`; after the call `const atStart = [...h.sound];`. Add `setSound(on: boolean): void;` to `interface World`, and import `sound` with `// @ts-expect-error` from `../../vendor/my-office/src/office/paseo-sound.js`.

- Add:

```ts
test("the scene starts with sound off, whatever its page stored", () => {
  expect(atStart).toEqual([false]);
});

test("the host's switch turns upstream's engine on and off", () => {
  world.setSound(true);
  world.setSound(false);
  expect(h.sound).toEqual([true, false]);
});

test("a press on the Sound button plays at once and asks the host, which answers with the same value", () => {
  sound.request(true);
  expect(h.sound).toEqual([true]);
  expect(h.soundAsked).toEqual([true]);
  world.setSound(true);
  expect(h.sound).toEqual([true]);
  world.setSound(false);
});

test("a value that is not true is off", () => {
  world.setSound(true);
  // @ts-expect-error the page treats anything but true as off
  world.setSound("yes");
  expect(h.sound).toEqual([true, false]);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/world/sound.test.ts client/world/camera-bar.test.ts client/world/entry.test.ts`
Expected: FAIL: `paseo-sound.js` does not exist, the bar has nine controls and no `#btn-sound`, and `world.setSound` is not a function.

- [ ] **Step 3: The page's Sound state and probe**

Create `vendor/my-office/src/office/paseo-sound.js`:

```js
// PASEO: the Sound switch's state in the page, and whether the page lets audio start. Upstream's switch is a
// toggle in its settings panel (ui/settings.js), which the port does not take. ui/camera-bar.js draws the
// button from this; paseo-entry.js turns the state into upstream's `sfx.set`. No upstream file is imported.

const listeners = new Set();

export const sound = {
  /** Whether sounds play: the person's choice, and false wherever audio cannot start. */
  on: false,
  /**
   * 'idle' until a press has tried to start audio, then 'ready'. 'unsupported': the page has no Web Audio, known at
   * once. 'blocked': a press did not start a context (a frame that never lets audio start). Neither changes until
   * the page is loaded again.
   */
  audio: "idle",
  /** Set by paseo-entry.js: the button asks for the switch to be `next`. */
  request() {},
  /** Calls `listener` whenever `on` or `audio` changes; returns the function that stops it. */
  subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

const emit = () => {
  for (const listener of listeners) listener();
};

/** Whether a press can start audio here, as far as is known. */
export const available = () => sound.audio !== "blocked" && sound.audio !== "unsupported";

/** The switch, from the host or a press. Only `true` turns it on, and where audio cannot start it stays off. */
export function setOn(on) {
  const next = on === true && available();
  if (sound.on === next) return;
  sound.on = next;
  emit();
}

function setAudio(audio) {
  if (sound.audio === audio) return;
  sound.audio = audio;
  if (!available()) sound.on = false;
  emit();
}

/**
 * Finds out whether this page lets audio start. With no Web Audio it is 'unsupported' at once. Otherwise the first
 * press (pointerup, which counts as a gesture on a touch screen where pointerdown does not, or a key) makes a context
 * of its own, asks it to run, and says 'ready' if it runs and 'blocked' if it throws, rejects or has not run within
 * `timeoutMs`. The context is closed after. Returns the function that stops listening.
 */
export function watchAudio(win = window, timeoutMs = 1500) {
  const Context = win.AudioContext || win.webkitAudioContext;
  if (!Context) {
    setAudio("unsupported");
    return () => {};
  }
  const events = ["pointerup", "keydown"];
  const stop = () => {
    for (const type of events) win.removeEventListener(type, probe, true);
  };
  function probe() {
    stop();
    let context;
    try {
      context = new Context();
    } catch {
      setAudio("blocked");
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      setAudio(context.state === "running" ? "ready" : "blocked");
      try {
        Promise.resolve(context.close()).catch(() => {});
      } catch {
        /* already closed */
      }
    };
    const timer = setTimeout(finish, timeoutMs);
    try {
      Promise.resolve(context.resume()).then(finish, finish);
    } catch {
      finish();
    }
  }
  for (const type of events) win.addEventListener(type, probe, true);
  return stop;
}
```

- [ ] **Step 4: The button**

In `vendor/my-office/src/office/ui/camera-bar.js`:

1. Imports: add `import { available, sound } from '../paseo-sound.js';` after the `host` import.
2. In the header comment add a sentence: "The Sound button is Paseo's own: the switch is the host's device setting (paseo-sound.js)."
3. In `BAR`, after the `btn-photo` button line add:

```html
<button
  type="button"
  class="tb-full"
  id="btn-sound"
  aria-pressed="false"
  aria-label="Sound"
  title="Sound"
>
  <span id="sound-ico"></span>
</button>
```

4. In `STYLE`, after the line `.tb-full[aria-pressed="true"] { ... }` add:

```css
.tb-full[aria-disabled="true"] {
  opacity: 0.45;
  cursor: not-allowed;
}
.tb-full[aria-disabled="true"]:hover {
  background: none;
  color: #8d97aa;
}
```

5. Before `setup()` add the icon:

```js
const SVG = "http://www.w3.org/2000/svg";
/** A speaker: with waves while sound is on, crossed out while it is off. Drawn here, since upstream's icon set has none. */
function speaker(on) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "ic");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML =
    '<polygon points="3 9 7 9 12 5 12 19 7 15 3 15"/>' +
    (on
      ? '<path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/>'
      : '<line x1="16" y1="9" x2="22" y2="15"/><line x1="22" y1="9" x2="16" y2="15"/>');
  return svg;
}
```

6. In `setup()`, after the `fullscreenchange` listener line add:

```js
// PASEO: the Sound button. The switch is the host's device setting (paseo-sound.js); a press asks for the opposite,
// inside the press, which is what lets the page's audio start. Where audio cannot start it says so and does nothing.
const soundButton = $("btn-sound"),
  soundIcon = $("sound-ico");
soundIcon.style.display = "inline-grid";
const showSound = () => {
  const label = available() ? "Sound" : "Sound is not available here";
  soundButton.setAttribute("aria-pressed", String(sound.on));
  soundButton.setAttribute("aria-disabled", String(!available()));
  soundButton.setAttribute("aria-label", label);
  soundButton.title = label;
  soundIcon.replaceChildren(speaker(sound.on));
};
soundButton.addEventListener("click", () => {
  if (!available()) {
    host.toast("This app does not let the office play sound.");
    return;
  }
  sound.request(!sound.on);
});
sound.subscribe(showSound);
showSound();
```

- [ ] **Step 5: The entry**

In `vendor/my-office/src/office/paseo-entry.js`:

1. After `import { sfx } from './audio/sfx.js';` add `import { setOn, sound, watchAudio } from './paseo-sound.js';`.
2. Replace the lines added in Task 1 step 6 (`// PASEO: upstream's engine starts on ...` and `sfx.set(false);`) with:

```js
// PASEO: upstream's engine starts on unless its own page stored "off"; Paseo's scene starts off until the host says
// on. The engine follows the switch (and so does karaoke, which reads `sfx.on`); a press on the toolbar's button plays
// at once, inside the press, and then asks the host to store it.
sfx.set(false);
sound.subscribe(() => sfx.set(sound.on));
sound.request = (next) => {
  setOn(next);
  options.onSound?.(next);
};
watchAudio(window);
```

3. In `start`'s doc comment add `onSound(on)` (a press on the Sound button asks for the switch to be on or off: the host stores it and answers with `setSound`) to the list of what the scene tells Paseo.
4. After `setTheme(...) { ... },` add:

```js
  /** The host's Sound switch. On plays upstream's sounds once a press has started audio; off, and anywhere audio cannot start, plays none. */
  setSound(on) { if (!started || stopped) return; setOn(on === true); },
```

- [ ] **Step 6: SOURCES.md and the bundle test**

In `vendor/SOURCES.md`: in the stand-in table row for `ui/camera-bar.js` add "the Sound button"; in the paragraph that lists Paseo's own files add "`paseo-sound.js` (the Sound switch's state and whether the page lets audio start)".

In `server/world-script.test.ts`, in the same test as Task 1, add `expect(script).toContain("setSound");` and `expect(script).toContain("btn-sound");`.

- [ ] **Step 7: Build, run, check**

```bash
npm run build:world
npx vitest run client/world/sound.test.ts client/world/camera-bar.test.ts client/world/entry.test.ts client/world/sfx.test.ts server/world-script.test.ts
```

Expected: PASS. The bundle's length stays under 1,200,000 (`server/world-script.test.ts` checks it). Then the chain and the whole suite.

- [ ] **Step 8: Commit**

```bash
git add -A && git commit -m "feat: the scene's Sound button and switch, with a probe for frames that never allow audio"
```

---

### Task 4: The setting reaches the scene, on the web frame and on the phone

**Files:**

- Modify: `client/world/world-api.ts`, `client/world/world-bridge.ts`, `client/world/world-view-shared.ts`, `client/world/use-world-feed.ts`, `client/world/world-view.tsx`, `client/world/world-view-native.tsx`, `client/world/world-frame.web.ts`
- Test: `client/world/world-bridge.test.ts`, `client/world/world-view-shared.test.ts`, `client/world/use-world-feed.mounted.test.tsx`, `client/world/world-view.mounted.test.tsx`, `client/world/world-view-native.mounted.test.tsx`, `client/world/entry.test.ts`

**Interfaces:**

- Consumes: `useSoundSwitch` and `SoundSwitch` (Task 2); `PaseoOfficeWorld.setSound` and the `onSound` start option (Task 3).
- Produces: `WorldApi.setSound?(on: boolean): void`, `WorldStartOptions.onSound?(on: boolean): void`, `WorldLatest.onSound(on: boolean): void`, `WorldFeedInput.sound: boolean | null`.

- [ ] **Step 1: Write the failing tests**

- `client/world/world-bridge.test.ts`: add

```ts
test("setSound goes to the page as a call, and the scene's onSound comes back as a callback", () => {
  const { api, posted, receive } = bridge();
  const onSound = vi.fn();
  api.start(options({ onSound }));
  api.setSound?.(true);
  expect(posted.map((m) => m.call)).toEqual(["start", "setSound"]);
  expect(posted[1]).toEqual({ call: "setSound", args: [true] });
  expect((posted[0]?.args[0] as { callbacks: string[] }).callbacks).toContain("onSound");
  receive(JSON.stringify({ callback: "onSound", args: [true] }));
  expect(onSound).toHaveBeenCalledWith(true);
});
```

- `client/world/world-view-shared.test.ts`: the `latest()` helper gains `onSound: vi.fn()`; add

```ts
test("a press on the scene's Sound button goes to the latest handler, and keeps no focus from the app", () => {
  const now = latest();
  const focus = vi.fn();
  const options = worldStartOptions(now, { focus, brand: BRAND });
  const later = vi.fn();
  now.current = { ...now.current, onSound: later };
  options.onSound?.(true);
  expect(later).toHaveBeenCalledWith(true);
  expect(focus).not.toHaveBeenCalled();
});
```

- `client/world/use-world-feed.mounted.test.tsx`: `input()` gains `sound: null` (before `...overrides`); add

```ts
test("the Sound switch is sent once it is read, again when it changes, and never as null", async () => {
  const { api, calls } = fakeScene();
  await mount(api, input({ sound: null }));
  expect(calls.filter((c) => c.startsWith("setSound"))).toEqual([]);
  await mount(api, input({ sound: false }));
  await mount(api, input({ sound: true }));
  expect(calls.filter((c) => c.startsWith("setSound"))).toEqual([
    "setSound:[false]",
    "setSound:[true]",
  ]);
});
```

(`mount` is whatever helper the file already uses to render `Probe` with an api and feed; read it and use its real name and shape.)

- `client/world/world-view.mounted.test.tsx` and `world-view-native.mounted.test.tsx`: add a test to each that the start's options carry an `onSound` function (`typeof frame.started?.onSound`, or the native test's recorded start, equals `"function"`); the file's `useSettings` stand-in returns `{ status: "loading" }`, so the hook reads null and sends nothing, which is correct.
- `client/world/entry.test.ts`: the expectation at the line `expect(container.querySelector("iframe")?.getAttribute("allow")).toBe("fullscreen");` becomes `.toBe("fullscreen; autoplay")`.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/world/world-bridge.test.ts client/world/world-view-shared.test.ts client/world/use-world-feed.mounted.test.tsx client/world/world-view.mounted.test.tsx client/world/world-view-native.mounted.test.tsx client/world/entry.test.ts`
Expected: FAIL: `api.setSound` is undefined, `onSound` is not in the start options, `setSound` is never sent, `allow` is `"fullscreen"`. (TypeScript errors on `sound` in `WorldFeedInput` show in `typecheck`, not in vitest.)

- [ ] **Step 3: The contract**

In `client/world/world-api.ts`:

- `WorldStartOptions`, after `onToast?`:

```ts
  /**
   * A press on the scene's Sound button: the switch is to be on or off. The host stores it and
   * answers with `setSound`; the scene has already applied it, since audio starts only inside a press.
   */
  onSound?(on: boolean): void;
```

- `WorldApi`, after `setIncidents?`:

```ts
  /**
   * The device's Sound switch. On plays the scene's sounds once a press has started audio; off, and
   * where the frame never lets audio start, plays none. The scene starts off. Absent on a page build
   * from before sounds.
   */
  setSound?(on: boolean): void;
```

In `client/world/world-bridge.ts`, in the `api` object after `setIncidents: sender("setIncidents"),` add `setSound: sender("setSound"),`.

In `client/world/world-view-shared.ts`: `WorldLatest` gains `onSound(on: boolean): void;` after `onIncidents`; `worldStartOptions` returns, after `onIncidents: ...,`:

```ts
    onSound: (on) => latest.current.onSound(on),
```

(no `focus()`: the press opens nothing of Paseo's, as the bell does not.)

In `client/world/use-world-feed.ts`: `WorldFeedInput` gains

```ts
/** The device's Sound switch; null while it is read: nothing is sent then. */
sound: boolean | null;
```

the hook's destructured input gains `sound`, and after the theme effect (the `[api]` effect stays first) add:

```ts
useEffect(() => {
  if (sound !== null) world.current?.setSound?.(sound);
}, [sound, api]);
```

Update the hook's doc comment's list ("...the theme, the Sound switch, the selection and the meeting").

- [ ] **Step 4: The two views**

In both `client/world/world-view.tsx` and `client/world/world-view-native.tsx`: import `useSoundSwitch` from `../use-sound.js`; after `const onBell = useStandupBell();` add `const sound = useSoundSwitch();`; add `onSound: sound.set,` to every `WorldLatest` literal after `onBell,` (in `world-view.tsx` three places: the ref's initial value, the effect's assignment and the effect's dependency list; in the native view two: the initial value and the effect's assignment, which has no dependency list) and pass `sound: sound.on,` in the `useWorldFeed` input after `incidents,`. Do not put `sound` in the start effect's dependencies: a tap must not restart the scene.

In `client/world/world-frame.web.ts`: `element.setAttribute("allow", "fullscreen");` becomes `element.setAttribute("allow", "fullscreen; autoplay");`, and its comment gains "and lets the page's audio start".

- [ ] **Step 5: Run, check, commit**

```bash
npx vitest run client/world client/engine-compat.test.ts
```

Expected: PASS. Then the chain, the whole suite, and:

```bash
git add -A && git commit -m "feat: the Sound setting reaches the scene on the web frame and the phone's script frame"
```

---

### Task 5: A look, and what was seen

**Files:**

- Modify: `docs/verified.md`, `README.md`, `docs/office.md`

- [ ] **Step 1: A stock daemon with the branch installed**

As `docs/verified.md` and piece 1's last task describe: a clean `/tmp/office-stock-home`, the published 0.16.2 daemon on port 6798 with `env -i` and the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`, the plugin installed by Git from the local repository at the branch's commit. `daemon status` must show 6798 and that home before any plugin command. Open the page with the Paseo browser tool at the host's address on 6798.

- [ ] **Step 2: Look at 1280 px**

- Settings > Plugins > Office: the "Sound" switch is there beside the view switch, off. Turn it on, reload the page: it is on. Turn it off. In the daemon's home, the `office-device` document holds `"sound"` and keeps `"view"`; change the view to 2D and back and check the document still holds `sound` (a view change must not drop it).
- The 3D floor: the toolbar has the speaker button after Photo mode, crossed out while off, with the tooltip "Sound". Press it: the speaker gets waves, the button is accent-coloured, and the settings page (open in a second tab) shows Sound on after a moment.
- With the browser tool's script access, in the frame (`document.querySelector('iframe').contentWindow`): before the press, wrap `AudioContext.prototype.createOscillator` and `createBufferSource` with counters. Press the button, then press a floor lamp or a light switch in the scene (both play `click`). The counters rise by at least one. Press the button again: it goes off, another click on the lamp leaves the counters where they were. If no prop can be hit by the tool, say so here.
- With Sound on in the settings and the page then loaded, the button shows on, and the first press anywhere in the scene starts audio (`sfx` makes its context): after the press, the frame's `AudioContext` count is above zero.
- Where audio is unavailable: in the frame, delete `AudioContext` and `webkitAudioContext` before `start` is not possible from outside; instead, load the page with the browser's autoplay policy at its strictest if the tool allows it, and note what the button shows. If it cannot be forced, that case is recorded as not seen.

- [ ] **Step 3: Look at 390 px**

The toolbar with the extra button: it must fit the frame with no part past the right edge (read the toolbar's bounding box against the frame's, with a mouse-like and a touch-like pointer if the tool can switch them). If it overflows, add inside the existing `@media (max-width: 520px)` rules of `camera-bar.js`: `.tb-tools { gap: 0; } .tb-zoom button, .tb-full { width: 28px; }`, update the camera-bar test that expects `.tb-zoom button, .tb-full { width: 30px; }` to match, rebuild, and look again. The Sound switch on the settings page at 390 px: it wraps with the view switch, with a 44 px high target.

- [ ] **Step 4: What cannot be seen here**

Record in `docs/verified.md` as not seen, and as the owner's to check on the host after the update: (a) that sound is audible at all, on the desktop app and a browser; (b) the Android app's script frame: whether the first tap starts audio, whether the button reads "not available" there, and whether the siren of an incident is heard; (c) the second tap on a touch screen; (d) that karaoke sings at the lounge's TV when Sound is on (needs the first-person walk, WASD, at the TV); (e) iOS and its ring switch (not available to the owner; unknown).

- [ ] **Step 5: Docs**

- `docs/verified.md`: a new section "Sound" with what was seen, the checks above and the "not seen" rows; the "Not seen, and why" table gains the rows of step 4.
- `README.md`: under "What it does" add "Plays my-office's sounds in the 3D floor: off until you turn on Sound in the settings or with the speaker button on the floor's toolbar." Under "What works where" add a row: "Sound | A browser and the desktop app, where the frame lets audio start; the phone's script frame: see [docs/verified.md](docs/verified.md)". In "What it reads and where it sends it" nothing changes (the scene sends no new data and makes no network call).
- `docs/office.md`: (a) in "The 3D floor", the sentence "It writes three things to the app origin's `localStorage`..." becomes four things and adds "the Sound switch (`office-sound`, which the host's setting overwrites at each start)"; (b) in "Settings" add "Sound" to the list; (c) in "Incidents", the sentence "A browser plays the siren only after a click or a key press in the scene." becomes "The siren plays only while Sound is on, and only after a press in the scene."; (d) a new subsection "Sound" at the end of "The 3D floor": the scene's sounds are my-office's, made in the page with Web Audio, all but one shop's tune; the switch is the `sound` field of the `office-device` setting (off by default), changed by the settings page or the toolbar's button; the host sends it with `setSound`, the button asks with `onSound`; the page starts off; audio starts only inside a press; a probe (`paseo-sound.js`) says whether the frame allows it, and where it does not the button is disabled and says so; karaoke follows the switch because it reads `sfx.on`; every saver of the device document keeps the document whole.
- Commit: `docs: what was seen of sound on a stock daemon, and the sound section`.

- [ ] **Step 6: Stop the daemon**

Stop it by its pid; confirm 6798 is closed and 6767 untouched. The commit of step 5 includes `docs/verified.md`.

---

## Not verifiable until built

| What                                                                                                                  | How Task 5 or the owner finds out                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Whether a same-origin `srcdoc` frame needs `allow="autoplay"` (it is set anyway)                                      | Task 5: the probe's result in the frame after a press; if `blocked` with the attribute set, the frame truly refuses                                                                                 |
| Whether `pointerup` is early enough for a touch press (Chrome treats `pointerup` as a gesture; Safari's rules differ) | The owner, on the phone: the button after the first tap. If it reads "not available" after a first tap and works after a second, the probe's timing is wrong and the plan's decision 8 is revisited |
| Whether upstream's own context starts on the first tap on a phone (its listener is `pointerdown`)                     | The owner: tap the button, then a lamp; no sound until the second tap means upstream's `unlock` needs a second press, which is upstream's behaviour and is documented, not changed                  |
| The Android script frame's autoplay rule                                                                              | The owner, on the host's phone app: the button's state and a click on a lamp                                                                                                                        |
| Whether the first press after Sound is turned on elsewhere unlocks karaoke's own context                              | The owner at the lounge's TV in the walk: if the song is silent with Sound on, press once more in the scene                                                                                         |
| Whether the toolbar's extra 30 px button fits a 390 px frame with a mouse                                             | Task 5 step 3, measured; the fallback rule is written there                                                                                                                                         |
| Whether `localStorage` exists in the phone's script frame                                                             | Not needed: upstream guards each use with `try`; the switch is the host's value                                                                                                                     |
| iOS and its ring switch                                                                                               | Unknown; the owner has no iOS device here                                                                                                                                                           |

## Risks

- The siren's behaviour changes (decision 10): it is silent until Sound is on. The README and `docs/office.md` say so.
- Bundle size: +3 KB of sounds and about 2 KB of Paseo code against a 1.2 MB cap that is 83,000 characters away. Not a risk.
- A later upstream `sfx.js` that adds a sound for a shop whose tune is a real brand's will come through `keptLocal` as a file to compare by hand; the test keeps `mixue` out of the bundle either way.
- Piece 1 may have changed how `useViewChoice` saves; Task 2 step 5 reads it as it is.

## After the tasks (controller, with the owner's go-ahead)

Final whole-branch review (focus: the hand cut of `sfx.js`, that the entry no longer calls `audioSfx.setup`, every saver of `office-device` keeps the whole document, the bridge's `setSound` and `onSound` on the phone path); fixes; merge `feat/sounds` to `main`; push; CI green (the upstream workflow is unaffected: the import tool's DENY change shows in its report only if upstream added an audio file); `paseo plugin update office --ref <commit>` on the owner's host; the owner looks on desktop and on the phone: Settings > Plugins > Office shows Sound off; the speaker button on the 3D floor turns it on and the settings page follows; a click on a lamp is heard; an incident's siren is heard with Sound on and silent with it off; on the phone, the button's state after the first tap; karaoke at the lounge's TV in the walk. Then tag `v0.3.0` and write its release notes (the sounds, the switch, the siren now follows the switch, and that Sound is off until turned on).
