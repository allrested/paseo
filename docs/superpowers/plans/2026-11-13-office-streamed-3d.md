# Office 3D in the installed app (streamed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Office shows its 3D view in the store-built Paseo app, by drawing the scene in the daemon's Chromium and sending pictures to the app.

**Architecture:** A fork-core service opens pages in the daemon's Chromium that no pane or agent sees, and the daemon hands it to built-in plugins. The office plugin runs its existing three.js scene in such a page, as a headless office client fed the same `office.state` events, and polls it for a JPEG 8 times a second. The plugin client shows the latest picture in a React Native `Image` and sends taps and drags back.

**Tech Stack:** TypeScript, Node 22, raw Chrome DevTools Protocol over the fork's `CdpEndpoint`/`CdpConnection`, esbuild (the daemon's plugin compiler), three.js r170 (vendored), React Native primitives through the plugin SDK, zod contracts, vitest.

**Spec:** `docs/superpowers/specs/2026-11-13-office-streamed-3d-design.md`. Read it with `docs/superpowers/specs/2026-11-11-agent-office-design.md`.

## Global Constraints

- The store app cannot be changed: phone code is plugin client code using `react-native`, `react` and `@getpaseo/plugin/client` only.
- Plugin messages are JSON: a picture is a base64 string.
- A render page is in no tab registry: no `opened` event, no pane, no `browser_*` tool, no `list_tabs` entry.
- Daemon-process code never throws out of a handler, a timer or a CDP event: catch and log.
- At most 2 render sessions per daemon; a third is refused, nothing is evicted.
- Page CSS size = the viewer's CSS size; device scale factor = `min(pixelRatio, 2, 1280 / longSide)`.
- JPEG quality 0.6; a `take()` every 125 ms; at most 2 pictures unconfirmed; a session silent for 30 s closes; the app sends input at least every 10 s.
- three.js is never in the client bundle; 3D off loads nothing.
- Fork-delta comments: tag core edits `// Fork delta (office stream): …`.
- Repo rules (`CLAUDE.md`): run only the test files you touch (`npx vitest run <file>`), `npm run typecheck` and `npm run lint -- <files>` after every change, `npm run format:files -- <files>` before committing. Commit messages: `feat(fork): …`, `fix(fork): …`, `test(fork): …`, `docs(fork): …`.
- Doc voice: plain, short, no "simply", "robust", "seamless", "powerful", "just".

## Review Focus

1. **The Chromium restarts while a session is open.** The page's connection closes: the session ends with a problem and the app shows the structure view under "Try 3D again"; nothing in the daemon throws. Test in Task 3.
2. **The viewer's size is 0×0 or absurd** (a hidden tab measures 0×0; a huge external display). The session refuses a size below 1×1 and caps the device scale factor; it never asks Chromium for a zero viewport. Test in Task 3.
3. **A `take()` slower than 125 ms.** Ticks do not overlap: one `take()` at a time per session. Test in Task 3.
4. **The office has no rooms, or the snapshot is empty.** The page draws the empty office and `take()` still answers; no exception. Test in Task 2.
5. **The app goes away without unsubscribing** (locked phone, dropped relay). The 30-second silence rule closes the session and frees its slot. Test in Task 3.

---

### Task 1: Offscreen pages and the built-in hand-off

**Files:**

- Create: `packages/server/src/server/browser-tools/cdp/offscreen-pages.ts`
- Create: `packages/server/src/server/browser-tools/cdp/offscreen-pages.test.ts`
- Create: `packages/server/src/server/plugins/browser-script.ts`
- Create: `packages/server/src/server/plugins/browser-script.test.ts`
- Modify: `packages/server/src/server/plugins/bundle-evaluator.ts` (`BuiltinPluginInfo`)
- Modify: `packages/server/src/server/plugins/runtime.ts` (`startBuiltinPlugin`, constructor options)
- Modify: `packages/server/src/server/plugins/index.ts` (`PluginServiceDependencies`)
- Modify: `packages/server/src/server/bootstrap.ts` (create, pass, stop)
- Modify: `packages/server/src/server/browser-tools/cdp/test-utils/fake-chromium.ts` only if a handler the tests need is missing

**Interfaces:**

- Consumes: `CdpEndpoint.connectBrowser()`, `CdpEndpoint.connectTarget(targetId)`, `CdpConnection.send/on/onClose/close`, `loadEsbuild()` from `plugins/compiler-esbuild.ts`, `startFakeChromium()` from `cdp/test-utils/fake-chromium.ts`.
- Produces:

```ts
// offscreen-pages.ts
export interface OffscreenViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}
export interface OffscreenPage {
  /** Runtime.evaluate with returnByValue and awaitPromise. Rejects with the page's exception text. */
  evaluate<T = unknown>(expression: string): Promise<T>;
  /** One raw CDP command on the page, such as Input.dispatchMouseEvent. */
  send(method: string, params?: Record<string, unknown>): Promise<unknown>;
  setViewport(viewport: OffscreenViewport): Promise<void>;
  /** Closes the target. Safe to call twice. */
  close(): Promise<void>;
  /** Runs once when the page is gone, whoever closed it. Returns the remover. */
  onClosed(listener: () => void): () => void;
}
export interface OffscreenPages {
  open(viewport: OffscreenViewport): Promise<OffscreenPage>;
}
export class CdpOffscreenPages implements OffscreenPages {
  constructor(options: { endpoint: CdpEndpoint; logger: Pick<Logger, "debug" | "warn"> });
  open(viewport: OffscreenViewport): Promise<OffscreenPage>;
  /** Closes every open page. */
  stop(): Promise<void>;
}

// browser-script.ts
/** One self-contained browser script (IIFE, es2020, minified) built from `entryPath`. */
export function bundleBrowserScript(entryPath: string): Promise<string>;

// bundle-evaluator.ts
export interface BuiltinPluginInfo {
  directory: string;
  /** Fork delta (office stream): absent when the daemon has no Chromium. */
  offscreenPages?: OffscreenPages;
  /** Fork delta (office stream). */
  bundleBrowserScript?: (entryPath: string) => Promise<string>;
}
```

`open` creates the target with `Target.createTarget { url: "about:blank", newWindow: true, background: true }` (a background tab runs no `requestAnimationFrame`), connects to it, sends `Emulation.setDeviceMetricsOverride { width, height, deviceScaleFactor, mobile: false }`, and closes it with `Target.closeTarget` on the browser connection. `PluginRuntime` takes `builtinExtras?: Omit<BuiltinPluginInfo, "directory">` in its options and spreads it into the second argument of `contribute`. `PluginServiceDependencies` gains the same field and forwards it. `bootstrap.ts` builds `CdpOffscreenPages` from the same URL as `createDaemonCdpBrowser` (only when `PASEO_BROWSER_CDP_URL` is set), passes `{ offscreenPages, bundleBrowserScript }`, and calls `stop()` in both shutdown paths beside `cdpBrowser?.stop()`.

- [ ] **Step 1: Write the failing tests in `offscreen-pages.test.ts`** (fake Chromium, as `cdp-browser-service.test.ts` builds its endpoint)

```ts
test("open creates a window target on about:blank and sets its viewport", async () => {
  const page = await pages.open({ width: 390, height: 700, deviceScaleFactor: 1.8 });
  expect(chromium.commands.find((c) => c.method === "Target.createTarget")?.params).toEqual({
    url: "about:blank", newWindow: true, background: true,
  });
  expect(chromium.commands.find((c) => c.method === "Emulation.setDeviceMetricsOverride")?.params)
    .toEqual({ width: 390, height: 700, deviceScaleFactor: 1.8, mobile: false });
  await page.close();
});
test("evaluate returns the page's value and rejects with its exception text", ...);
  // fake: Runtime.evaluate -> { result: { value: 42 } } then { exceptionDetails: { text: "boom" } }
  // expect(await page.evaluate("6*7")).toBe(42); await expect(page.evaluate("x")).rejects.toThrow("boom");
test("send passes a raw command to the page", ...);        // Input.dispatchMouseEvent recorded with its params
test("close closes the target once, and a second close does nothing", ...); // one Target.closeTarget
test("onClosed runs when the target goes away on its own", ...);            // chromium destroys the target
test("stop closes every open page", ...);                                   // two pages, two Target.closeTarget
test("open rejects with CdpUnreachableError when the Chromium is unreachable", ...);
```

The assertions in the commented tests are as their comments say. Use the field names `FakeChromium` already exposes for recorded commands and targets; add a handler to the fake only where one is missing.

- [ ] **Step 2: Run them and see them fail**

Run: `cd packages/server && npx vitest run src/server/browser-tools/cdp/offscreen-pages.test.ts`
Expected: FAIL, cannot find `./offscreen-pages.js`.

- [ ] **Step 3: Implement `CdpOffscreenPages` in `offscreen-pages.ts`**

- [ ] **Step 4: Run the tests and see them pass**

Run: same command. Expected: 7 passed.

- [ ] **Step 5: Write the failing test in `browser-script.test.ts`**

```ts
test("bundles an entry and its imports into one script that runs without a module loader", async () => {
  // temp dir: entry.ts `import { n } from "./dep.js"; (globalThis as any).__probe = n + 1;`, dep.ts `export const n = 41;`
  const script = await bundleBrowserScript(entry);
  expect(script).not.toMatch(/\bimport\b|\brequire\(/);
  const sandbox: Record<string, unknown> = {};
  new Function("globalThis", script)(sandbox);
  expect(sandbox.__probe).toBe(42);
});
test("rejects with the build error for an entry that does not compile", ...); // rejects.toThrow(/entry/)
```

- [ ] **Step 6: Run it, see it fail, implement `bundleBrowserScript`** with `loadEsbuild().build({ bundle: true, format: "iife", platform: "browser", target: "es2020", minify: true, write: false, logLevel: "silent" })`, **run it, see it pass.**

Run: `npx vitest run src/server/plugins/browser-script.test.ts`

- [ ] **Step 7: Hand both to built-ins.** Add the two optional fields to `BuiltinPluginInfo`, `builtinExtras` to the `PluginRuntime` options and to `PluginServiceDependencies`, and the wiring in `bootstrap.ts`. Extend the existing built-in start test in `packages/server/src/server/plugins/runtime.test.ts` (or the file that already covers `startBuiltinPlugin`) with:

```ts
test("a built-in receives the daemon's extras beside its directory", ...);
// runtime built with builtinExtras: { bundleBrowserScript: async () => "x" };
// the built-in's contribute sees builtin.directory and builtin.bundleBrowserScript
```

- [ ] **Step 8: Typecheck, lint, format, commit**

```bash
npm run typecheck && npm run lint -- packages/server/src/server/browser-tools/cdp/offscreen-pages.ts packages/server/src/server/plugins/browser-script.ts
git commit -m "feat(fork): pages in the daemon's Chromium that no pane or agent sees, for built-ins"
```

---

### Task 2: The render page

**Files:**

- Create: `plugins/office/client/scene/scene-layout.ts` (pure helpers moved out of `scene-view.tsx`)
- Modify: `plugins/office/client/scene/scene-view.tsx`, `scene-view.test.ts`, `office-surface.tsx` (imports only)
- Modify: `plugins/office/client/scene/office-scene.web.ts` (two options)
- Modify: `plugins/office/client/scene/palette.ts` (`scenePalette` takes `Pick<PluginTheme, "colors">`)
- Create: `plugins/office/render/pipeline.ts`, `plugins/office/render/pipeline.test.ts`
- Create: `plugins/office/render/page.ts`
- Create: `plugins/office/server/render/render-page.local.e2e.test.ts` (hand-run)

**Interfaces:**

- Consumes: `applyOfficeEvent`, `EMPTY_OFFICE` (`client/office-state.ts`); `buildOfficeModel` (`client/model.ts`); `buildScenePlan`, `scenePalette`, `createOfficeScene`; `OffscreenPages`, `bundleBrowserScript` from Task 1.
- Produces:

```ts
// scene-layout.ts — moved unchanged from scene-view.tsx
export { ContainerShape, UNMEASURED, shapeAfterResize, columnsNow, SceneLayout, NO_LAYOUT, nextLayout, NO_ROOMS }

// office-scene.web.ts — added to OfficeSceneOptions
  /** Keep the drawn frame readable after it is shown, for a page that takes pictures of it. */
  preserveDrawingBuffer?: boolean;
  /** Called after each frame that was drawn. */
  onFrame?(): void;

// render/pipeline.ts — pure, no DOM
export interface RenderPipeline {
  /** Takes one office.state event; returns the plan to draw, or null when nothing drawable changed. */
  apply(event: OfficeEvent): ScenePlan | null;
  /** The view's size in CSS pixels; returns the plan when the column count changed. */
  resize(width: number, height: number): ScenePlan | null;
}
export function createRenderPipeline(palette: ScenePalette): RenderPipeline;

// render/page.ts — the browser entry; defines one global
interface OfficeRenderGlobal {
  start(input: { colors: Record<string, string>; coarsePointer: boolean }): void;
  state(event: OfficeEvent): void;
  focus(target: { roomId: string } | { agentId: string }): void;
  take(): RenderTake;
}
export interface RenderTake {
  picture: { jpeg: string; width: number; height: number } | null;
  events: Array<
    | { type: "agent"; agentId: string }
    | { type: "board"; roomId: string }
    | { type: "problem"; message: string }
  >;
}
```

`page.ts` reads three.js from `globalThis.__officeThree` (the daemon puts the module namespace there before the bundle runs), builds the scene in `document.body` sized to the viewport with `preserveDrawingBuffer: true`, `reducedMotion: false`, and an `onFrame` that sets a dirty flag. `take()` returns `canvas.toDataURL("image/jpeg", 0.6)` without its `data:image/jpeg;base64,` prefix when the flag is set, clears the flag, and drains the event queue. A `ResizeObserver` on `document.body` calls `pipeline.resize`. `RenderTake` and the global's type are exported from a file both `page.ts` and the server import: put them in `plugins/office/shared/render.ts`.

- [ ] **Step 1: Move the pure layout helpers to `scene-layout.ts`** and point `scene-view.tsx`, `scene-view.test.ts` and `office-surface.tsx` at it. No behaviour change.

Run: `cd plugins && npx vitest run office/client/scene/scene-view.test.ts office/client/office-surface.test.ts`
Expected: the same tests pass as before the move.

- [ ] **Step 2: Write the failing tests in `pipeline.test.ts`**

```ts
test("draws the plan the client draws for the same events", () => {
  // events: a snapshot with two workspaces and three agents, then an "agents" change
  const pipeline = createRenderPipeline(palette);
  pipeline.resize(390, 700);
  let plan: ScenePlan | null = null;
  for (const event of events) plan = pipeline.apply(event) ?? plan;
  // the client's own path: applyOfficeEvent -> buildOfficeModel -> columnsNow/nextLayout -> buildScenePlan
  expect(plan).toEqual(clientPlanFor(events, { width: 390, height: 700 }, palette));
});
test("an office with no rooms gives the empty plan, not an exception", ...);   // snapshot with no agents -> NO_ROOMS
test("returns null before the view has a size", ...);                           // apply before resize -> null
test("a resize that changes the column count returns a new plan", ...);         // 390 wide then 1200 wide
test("a board change that the scene shows returns a plan", ...);                // "board" event with one note
```

- [ ] **Step 3: Run, see fail, implement `createRenderPipeline`, run, see pass**

Run: `npx vitest run office/render/pipeline.test.ts`

- [ ] **Step 4: Add the two scene options** in `office-scene.web.ts`: pass `preserveDrawingBuffer` to `WebGLRenderer`, and call `options.onFrame?.()` at the end of the frame function, after `renderer.render`. Change `scenePalette` to take `Pick<PluginTheme, "colors">`.

- [ ] **Step 5: Write `render/page.ts` and `shared/render.ts`.**

- [ ] **Step 6: Write the hand-run test `render-page.local.e2e.test.ts`** (skipped without `PASEO_TEST_CDP_URL`, the pattern of `cdp-host.local.e2e.test.ts`). It builds a `CdpOffscreenPages` from the URL, opens a 390×700 page at scale 1.8, evaluates the vendored three.js as a module into `globalThis.__officeThree` (blob URL + `import()`), evaluates `await bundleBrowserScript("plugins/office/render/page.ts")`, calls `start` with the light theme's colours, feeds a snapshot built from `client/scene/fake-office.ts`, and polls `take()`.

```ts
test("draws the fake office and returns a JPEG of the viewport", async () => {
  // poll take() up to 10 s until picture !== null
  expect(take.picture?.width).toBe(702); // 390 * 1.8
  expect(take.picture?.height).toBe(1260);
  const bytes = Buffer.from(take.picture.jpeg, "base64");
  expect(bytes.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
  await writeFile(path.join(os.tmpdir(), "office-render.jpg"), bytes);
});
test("a press and release on a robot reports that agent", async () => {
  // the robot's CSS pixel comes from the page: evaluate a helper that projects the first robot
  // Input.dispatchMouseEvent mousePressed + mouseReleased at that point, button "left", clickCount 1
  // poll take() until events contains { type: "agent", agentId: <the fake office's first agent id> }
});
test("a still office gives no second picture", async () => {
  // after the scene settles (two consecutive take() with picture === null within 3 s), stays null
});
```

- [ ] **Step 7: Run it against this instance's Chromium and look at the picture**

Run: `cd plugins && PASEO_TEST_CDP_URL=http://127.0.0.1:9222 npx vitest run office/server/render/render-page.local.e2e.test.ts`
Expected: 3 passed. Open `/tmp/office-render.jpg`: rooms, robots and labels are drawn, not a blank or black image.

- [ ] **Step 8: Typecheck, lint, format, commit**

```bash
git commit -m "feat(fork): office render page, the scene as a headless client that gives pictures"
```

---

### Task 3: Render sessions and the wire contract

**Files:**

- Modify: `plugins/office/shared/contracts.ts`, `shared/contracts.test.ts`
- Create: `plugins/office/server/render/sessions.ts`, `sessions.test.ts`
- Create: `plugins/office/server/render/page-host.ts` (opens and loads a page; the only file that knows three.js bytes and the bundle)
- Modify: `plugins/office/server/hub.ts`, `hub.test.ts` (`render` in the snapshot)
- Modify: `plugins/office/index.server.ts`, `index.server.test.ts`

**Interfaces:**

- Consumes: `OffscreenPages`, `OffscreenPage`, `bundleBrowserScript` (Task 1); `RenderTake` and the page global (Task 2); `Hub.attach(subscriber)`; `readThreeAsset(vendorDirectory)`; `Clock` from `server/timers.ts` and the fake clock in `server/fake-clock.ts`.
- Produces:

```ts
// shared/contracts.ts
export const PointerStepSchema = z.object({
  type: z.enum(["down", "move", "up", "cancel"]),
  x: z.number(),
  y: z.number(),
});
export const RenderEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ready"), streamId: z.string() }),
  z.object({
    type: z.literal("picture"),
    seq: z.number().int().positive(),
    jpeg: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  z.object({ type: z.literal("select"), target: z.enum(["agent", "board"]), id: z.string() }),
  z.object({ type: z.literal("problem"), message: z.string() }),
]);
export const renderSubscription = defineSubscription({
  name: "office.render",
  input: z.object({
    width: z.number().positive(),
    height: z.number().positive(),
    pixelRatio: z.number().positive(),
    colors: z.record(z.string(), z.string()),
    coarsePointer: z.boolean(),
    focusRoomId: z.string().optional(),
  }),
  event: RenderEventSchema,
});
export const renderInputRpc = defineRpc({
  name: "office.render.input.request",
  input: z.object({
    streamId: z.string(),
    shown: z.number().int().positive().optional(),
    steps: z.array(PointerStepSchema).max(64).optional(),
    focus: z
      .union([z.object({ roomId: z.string() }), z.object({ agentId: z.string() })])
      .optional(),
    resize: z
      .object({
        width: z.number().positive(),
        height: z.number().positive(),
        pixelRatio: z.number().positive(),
      })
      .optional(),
  }),
  output: z.object({ ok: z.boolean() }),
});
// OfficeSnapshotSchema gains: render: z.object({ available: z.boolean() }).optional()
// Types, each the z.output of its schema: PointerStep, RenderEvent,
// RenderInput (the subscription's input), RenderInputMessage (the RPC's input).

// server/render/sessions.ts
export const MAX_RENDER_SESSIONS = 2;
export const TAKE_INTERVAL_MS = 125;
export const MAX_UNCONFIRMED = 2;
export const SILENCE_LIMIT_MS = 30_000;
export const MAX_PICTURE_SIDE = 1280;
export function deviceScaleFactor(input: {
  width: number;
  height: number;
  pixelRatio: number;
}): number;
export interface RenderPageHost {
  /** Opens a page, loads three.js and the page script, and starts the scene. */
  open(input: {
    viewport: OffscreenViewport;
    colors: Record<string, string>;
    coarsePointer: boolean;
  }): Promise<RenderPage>;
}
export interface RenderPage {
  state(event: OfficeEvent): Promise<void>;
  focus(target: { roomId: string } | { agentId: string }): Promise<void>;
  pointer(steps: readonly PointerStep[]): Promise<void>;
  resize(viewport: OffscreenViewport): Promise<void>;
  take(): Promise<RenderTake>;
  close(): Promise<void>;
  onClosed(listener: () => void): () => void;
}
export interface RenderSessions {
  available(): boolean;
  /** Runs one viewer's stream; resolves when it ends. */
  attach(
    input: RenderInput,
    subscriber: { push(event: RenderEvent): Promise<void>; signal: AbortSignal },
  ): Promise<void>;
  input(message: RenderInputMessage): Promise<{ ok: boolean }>;
  stop(): Promise<void>;
}
export function createRenderSessions(deps: {
  host: RenderPageHost | null;
  hub: Pick<Hub, "attach">;
  clock: Clock;
  newStreamId(): string;
  log(message: string): void;
}): RenderSessions;
```

`deviceScaleFactor` is `min(pixelRatio, 2, 1280 / max(width, height))`. A session that ends for any reason pushes one `problem` event first, unless the subscriber's signal is what ended it. Problem texts: "The host has no browser to draw 3D", "Two 3D views are already open on this host", "The host browser has no WebGL", "The 3D view stopped: <reason>". `input` for an unknown `streamId` returns `{ ok: false }`. Pointer steps become `Input.dispatchMouseEvent` with `mousePressed`/`mouseMoved`/`mouseReleased`, `button: "left"`, `clickCount: 1` on press and release, and `buttons: 1` while pressed; `cancel` is a release far outside the view so no tap is picked.

- [ ] **Step 1: Write the failing contract tests** in `contracts.test.ts`: a snapshot without `render` parses; a snapshot with `render: { available: true }` parses and keeps it; `renderInputRpc` accepts `{ streamId }` alone and refuses 65 steps; `RenderEventSchema` refuses `seq: 0`.

- [ ] **Step 2: Run, see fail, add the contracts, run, see pass**

Run: `cd plugins && npx vitest run office/shared/contracts.test.ts`

- [ ] **Step 3: Write the failing tests in `sessions.test.ts`** with a fake `RenderPageHost` whose pages record calls and return scripted `take()` results, a fake hub that pushes a snapshot then changes, and the fake clock.

```ts
test("deviceScaleFactor caps at 2 and at 1280 device pixels on the long side", () => {
  expect(deviceScaleFactor({ width: 390, height: 700, pixelRatio: 3 })).toBeCloseTo(1280 / 700);
  expect(deviceScaleFactor({ width: 320, height: 480, pixelRatio: 3 })).toBe(2);
  expect(deviceScaleFactor({ width: 1600, height: 900, pixelRatio: 1 })).toBeCloseTo(0.8);
});
test("refuses when the host has no browser", ...);            // host: null -> one problem event, attach resolves
test("refuses a third viewer and keeps the first two", ...);  // third gets "Two 3D views are already open…"
test("refuses a size below 1 x 1 without opening a page", ...);
test("sends ready, then feeds the page the snapshot before any change", ...);
test("pushes a picture only when take() has one, with rising seq", ...);
test("holds pictures while two are unconfirmed, and sends the newest once one is confirmed", ...);
test("does not start a take() while the last one is still running", ...);   // a take() that resolves after 400 ms
test("turns page events into select and problem events", ...);
test("sends pointer steps as mouse events and a focus as a focus call", ...);
test("resizes the page, with the capped scale factor", ...);
test("closes the page when the viewer unsubscribes, and frees the slot", ...);
test("ends with a problem when the page closes on its own", ...);           // Chromium restart
test("ends with a problem when take() rejects", ...);
test("closes a session that hears nothing for 30 seconds", ...);            // advance the fake clock
test("an input within 30 seconds keeps the session", ...);
test("input for an unknown stream answers ok: false", ...);
test("stop closes every page", ...);
```

- [ ] **Step 4: Run, see fail, implement `createRenderSessions`, run, see pass**

Run: `npx vitest run office/server/render/sessions.test.ts`

- [ ] **Step 5: Implement `page-host.ts`**: `createRenderPageHost(deps: { pages: OffscreenPages; bundle(entryPath: string): Promise<string>; readThree(): Promise<Uint8Array>; pageEntry: string }): RenderPageHost`. It builds the page script once and keeps it; loads three.js into `globalThis.__officeThree`; checks `!!document.createElement("canvas").getContext("webgl2")` and rejects with "The host browser has no WebGL" when false. Cover it by extending the hand-run test from Task 2 to go through `createRenderPageHost` instead of its own loading code.

- [ ] **Step 6: Put `render` in the hub's snapshot.** `HubPorts` gains `renderAvailable(): boolean`; add to `hub.test.ts`: "the snapshot says whether the host can draw 3D" (true and false).

- [ ] **Step 7: Wire it in `index.server.ts`.** `OfficePluginDeps` gains `render: RenderPageHost | null`; `contribute` builds it from `builtin.offscreenPages` and `builtin.bundleBrowserScript` (both present, else null) with `pageEntry: join(builtin.directory, "render", "page.ts")`. Register `renderSubscription` (handler: `sessions.attach(input, context)`) and `renderInputRpc`; the cleanup calls `sessions.stop()`. Add to `index.server.test.ts`: "a host without offscreen pages reports render unavailable and refuses the stream with a problem".

- [ ] **Step 8: Run the plugin's server tests, typecheck, lint, format, commit**

Run: `npx vitest run office/server office/shared office/index.server.test.ts`

```bash
git commit -m "feat(fork): office render sessions, one streamed 3D view per viewer"
```

---

### Task 4: The stream view in the app

**Files:**

- Create: `plugins/office/client/scene/stream-gesture.ts`, `stream-gesture.test.ts`
- Create: `plugins/office/client/scene/stream-view.tsx`
- Create: `plugins/office/client/scene/use-render-stream.ts`, `use-render-stream.test.ts` (the reducer only)
- Modify: `plugins/office/client/office-surface.tsx`, `office-surface.test.ts`
- Modify: `plugins/office/client/styles.ts` (the picture's style)

**Interfaces:**

- Consumes: `renderSubscription`, `renderInputRpc`, `RenderEvent`, `PointerStep` (Task 3); `useSubscription`, `useRpc` from `@getpaseo/plugin/client`; `Image`, `View`, `Text`, `PixelRatio` from `react-native`.
- Produces:

```ts
// office-surface.tsx
export type ThreeDMode = "local" | "stream" | "none";
/** Where 3D is drawn: in this device's WebGL, on the host, or nowhere. */
export function threeDMode(input: {
  platform: Platform;
  webgl2: boolean;
  hostRender: boolean;
}): ThreeDMode;
// officeView's `available` becomes mode !== "none"; OfficeView gains nothing.

// stream-gesture.ts — pure
// TAP_SLOP_PX (8) comes from ./camera.js, the scene's own tap slop.
export const MOVE_INTERVAL_MS = 100;
export interface StreamGesture {
  /** Feed one touch; returns the steps to send now, possibly none. */
  touch(event: {
    type: "start" | "move" | "end" | "cancel";
    x: number;
    y: number;
    at: number;
  }): PointerStep[];
  /** Steps held back by the move throttle, to send when the timer fires. */
  flush(at: number): PointerStep[];
}
export function createStreamGesture(): StreamGesture;

// use-render-stream.ts
export interface StreamState {
  status: "connecting" | "live" | "problem";
  streamId: string | null;
  picture: { seq: number; uri: string; width: number; height: number } | null;
  problem: string | null;
}
export function streamReducer(state: StreamState, event: RenderEvent): StreamState;

// stream-view.tsx
export interface StreamViewProps {
  theme: PluginTheme;
  styles: OfficeStyles;
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  onSelectAgent(agentId: string): void;
  onSelectBoard(roomId: string): void;
  onProblem(message: string): void;
}
export function StreamView(props: StreamViewProps): JSX.Element;
```

`threeDMode`: web with WebGL2 → `"local"`; otherwise `hostRender` → `"stream"`; else `"none"`. `hostRender` is `office.state.render?.available === true`. `SurfaceBody` renders `StreamView` where it renders `SceneView` when the mode is `"stream"`. `StreamView` subscribes only once `onLayout` gave a size, with `PixelRatio.get()` and `theme.colors`; shows "Loading the 3D view..." until the first picture; shows the picture as `data:image/jpeg;base64,<jpeg>` with `resizeMode="contain"`; confirms each shown picture's `seq` through `renderInputRpc` (with any pending steps in the same call); sends an empty input every 10 s; sends `resize` when the layout changes; sends `focus` for `focusRoomId` once on ready and for each new `focusRequest.nonce`. A `problem` event, a subscription error or a closed subscription calls `onProblem`. Touches use the View's responder props, with `onResponderTerminationRequest={() => false}`.

- [ ] **Step 1: Write the failing tests in `stream-gesture.test.ts`**

```ts
test("a press and release in place is a down and an up at that point", ...);
test("a move within 8 px sends nothing until the release", ...);
test("a drag sends its moves at most every 100 ms and keeps the latest for the flush", ...);
test("the release of a drag sends the held move before the up", ...);
test("a cancelled touch sends a cancel, not an up", ...);
```

- [ ] **Step 2: Run, see fail, implement `createStreamGesture`, run, see pass**

Run: `cd plugins && npx vitest run office/client/scene/stream-gesture.test.ts`

- [ ] **Step 3: Write the failing tests** in `use-render-stream.test.ts` (ready sets `streamId`; a picture replaces the last and builds the data URI; an older `seq` is ignored; a problem sets `status: "problem"`) and in `office-surface.test.ts`:

```ts
test("threeDMode draws locally on web with WebGL2", () =>
  expect(threeDMode({ platform: "web", webgl2: true, hostRender: true })).toBe("local"));
test("threeDMode streams on native when the host can draw", () =>
  expect(threeDMode({ platform: "ios", webgl2: false, hostRender: true })).toBe("stream"));
test("threeDMode streams on web without WebGL2 when the host can draw", ...);
test("threeDMode is none when neither can draw", ...);   // native, hostRender false -> "none"
```

- [ ] **Step 4: Run, see fail, implement `streamReducer`, `threeDMode`, `StreamView`, the surface wiring and the style; run, see pass**

Run: `npx vitest run office/client`

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
git commit -m "feat(fork): office 3D in the installed app, shown as pictures from the host"
```

---

### Task 5: Docker flag and docs

**Files:**

- Modify: `docker/docker-compose.yml`, `docker/docker-compose.vpn.yml` (`CHROME_CLI`)
- Modify: `scripts/vpn-overlay.test.mjs` (one test)
- Modify: `docs/docker.md`, `docs/plugins.md` (the office section), `docs/superpowers/specs/2026-11-11-agent-office-design.md` ("Native app" row, "Not in this version")

- [ ] **Step 1: Write the failing test** in `scripts/vpn-overlay.test.mjs`:

```js
test("both compose files start Chromium with the flags the daemon's pages need", () => {
  for (const file of ["docker/docker-compose.yml", "docker/docker-compose.vpn.yml"]) {
    const cli = /CHROME_CLI: "([^"]+)"/.exec(readFileSync(file, "utf8"))?.[1] ?? "";
    for (const flag of [
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--ignore-gpu-blocklist",
    ]) {
      assert.ok(cli.split(" ").includes(flag), `${file} is missing ${flag}`);
    }
  }
});
```

- [ ] **Step 2: Run, see fail, add `--ignore-gpu-blocklist` to both files, run, see pass**

Run: `node --test scripts/vpn-overlay.test.mjs`

- [ ] **Step 3: Update the docs.** `docs/docker.md`: beside the occlusion flags, say WebGL in the Docker Chromium needs `--ignore-gpu-blocklist`, that the office's streamed 3D uses it, and that a borrowed browser or a compose copy needs the flag too. `docs/plugins.md`: rewrite the office paragraph that says native clients get the structure view. Office spec: the "Native app" row now points at the streamed spec; drop "3D in the native app" from "Not in this version".

- [ ] **Step 4: Format and commit**

```bash
git commit -m "feat(fork): start the Docker Chromium with WebGL for the office's streamed 3D"
```
