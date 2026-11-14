# Office Animated on the Phone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office in the installed app is composed and animated on the phone from pictures the host draws once: a backdrop, an overlay, one picture grid per robot look, and a sheet of positions.

**Architecture:** A second render page (`render/sheet-page.ts`) in the daemon's Chromium draws stills with the scene's own meshes through a new `createOfficeStills`, and builds the sheet with pure code (`client/scene/sheet-plan.ts`). The daemon relays them over a new subscription with two RPCs (`server/render/sheet-sessions.ts`). The plugin client composes them with `Image`, `View` and `Animated` (`client/sheet/`), and `office-surface.tsx` shows that view where it showed the stream view.

**Tech Stack:** TypeScript, three.js (vendored, typed through `three-types.ts`), zod contracts, React Native primitives only on the client, vitest.

**Spec:** `docs/superpowers/specs/2026-11-14-office-phone-animation-design.md`

## Global Constraints

- The client bundle runs in the store app: `react`, `react-native`, `@getpaseo/plugin/client`, `@tanstack/react-query`, `zod` only. No DOM, no WebGL, no new native module.
- Server code imports nothing from `client/`; shared types live in `shared/`. The page script must not pull in zod: it imports `shared/sheet.ts` and `shared/names.ts`, never `shared/contracts.ts` values. The built page stays under 150 KB.
- Daemon-process code never throws out of a handler or a timer.
- Tiles are at most 1024 px a side; a backdrop has at most 4,000,000 px; a sprite grid is at most 1024 px wide.
- Limits: 2 sheet viewers, 30 s silence, keep-alive every 10 s.
- What the web UI draws does not change: `office-scene.web.ts` is refactored by moving and exporting only.
- Run only touched test files (`npx vitest run <file> --bail=1`), then `npm run typecheck`, `npm run lint -- <files>`, `npm run format:files -- <files>`. Commits: `feat(fork): ...`, no AI attribution.

## Review Focus

1. A viewer of 0 x 0 or with fractions (411.43 x 866.29): no page is sized to nothing, picture sizes are whole numbers (Task 2 test `sheetFrame gives whole picture sizes for a fractional viewer`).
2. An office with no rooms: a sheet with no robots and one tile, not a throw (Task 2 test `an office without rooms is an empty picture of the viewer's size`).
3. A sheet that arrives before all tiles of its version: the app keeps the old pictures and the old sheet (Task 4 test `a sheet waits for the tiles of its version`).
4. A re-sent sheet with the same keys replays no wave (Task 4 test `a repeated key replays nothing`).
5. A reconnect: `ready` with a new sheet id drops every tile, sheet and sprite of the old one (Task 4 test `a new sheet id starts over`).

---

### Task 1: The scene offers its parts

**Files:**

- Modify: `plugins/office/client/scene/office-scene.web.ts` (export the stage builders; lift the robot writer and the label maker out of the closure)
- Modify: `plugins/office/client/scene/scene-plan.ts` (take `roomFootprint`, `labelAnchor`, `WALL_THICKNESS`, `PLATE_RISE`; export `SEAT_PHASE`)
- Modify: `plugins/office/client/scene/three-types.ts` (`RendererLike.setClearColor(color: string, alpha: number): void`)
- Create: `plugins/office/client/scene/office-stills.web.ts`

**Interfaces:**

- Produces, from `office-scene.web.ts`: `createSoftTexture`, `createMaterials`, `applyPalette`, `createLayers`, `createRig`, `writeRooms(stage, rooms, walls?: "all" | "far" | "near" | "none")`, `writeDesks(stage, desks: readonly DeskPlan[], colors)`, `writeNotes`, `writeRobotFrame(stage, rig, robot, motion, index, sizes, lit)`, `makeLabel(three, room, palette, ratio)`, `placeLabel(label, view, viewport, ratio)`, `lampSizes`, types `Stage`, `Rig`, `Label`. `far` is the back and left wall of each room with their rails and the board frames; `near` is the right wall and both front segments with their rails.
- Produces, from `office-stills.web.ts`:

```ts
export interface StillFrame {
  view: CameraView;
  /** Screen points. */
  viewport: Viewport;
  /** Picture pixels per screen point. */
  ratio: number;
}
export interface OfficeStills {
  /** The office, its colours, the camera and the picture's size for every draw after it. */
  set(plan: ScenePlan, palette: ScenePalette, frame: StillFrame): void;
  /** Floors, far walls, boards and their notes, main desks with dark screens. Opaque. */
  backdrop(): void;
  /** Near walls and rails, notes on desks, name plates. On a clear ground. */
  overlay(): void;
  /** One robot at its seat with its desk, screen, glow and shadow. On a clear ground. */
  robot(robot: RobotPlan, motion: RobotFrame): void;
  /** One paper plane at `at`, heading across the screen to the right. On a clear ground. */
  plane(at: Point): void;
  /** Each room's name plate as drawn, in screen points. */
  plates(): Map<string, { width: number; height: number }>;
  dispose(): void;
}
export function createOfficeStills(options: {
  three: ThreeModule;
  canvas: HTMLCanvasElement;
}): OfficeStills;
```

- [ ] **Step 1:** Move and export as listed. `writeDesks` takes the desks to draw instead of the plan; the scene passes `deskPlans(plan)`. Run `npx vitest run plugins/office/client/scene --bail=1` and `npm run typecheck`: all pass as before.
- [ ] **Step 2:** Write `createOfficeStills`: a renderer with `alpha: true`, `preserveDrawingBuffer: true`, pixel ratio 1, sized `round(viewport * ratio)`; the scene's lights; one stage. Each draw writes only its layers (every other layer's count is 0), sets `scene.background` to the palette's ground (backdrop) or `null` with `setClearColor("#000000", 0)` (the rest), and renders once. `robot` draws a main-seat robot's desk without its desk shadow and a side robot's with it.
- [ ] **Step 3:** Typecheck, lint, format. Commit `refactor(fork): the office scene offers its parts for stills`.

### Task 2: Sheet plan, page and the fidelity gate

**Files:**

- Create: `plugins/office/shared/sheet.ts`, `plugins/office/client/scene/sheet-plan.ts`, `plugins/office/client/scene/sheet-plan.test.ts`, `plugins/office/render/sheet-page.ts`
- Create: `plugins/office/server/render/sheet-page.local.e2e.test.ts` (hand-run, `PASEO_TEST_CDP_URL`)
- Modify: `plugins/office/server/render/page-host.ts` (export `loadThree`), `plugins/office/shared/contracts.ts`, `plugins/office/shared/contracts.test.ts`

**Interfaces:**

- Produces `shared/sheet.ts` (types only, plus constants):

```ts
export const SHEET_GLOBAL = "__officeSheet";
export const TILE_SIDE = 1024;
export const MAX_BACKDROP_PIXELS = 4_000_000;
export const MAX_SPRITE_WIDTH = 1024;
export const MAX_SPRITES = 200;
export const PLANE_KEY = "plane";
export interface SheetPoint {
  x: number;
  y: number;
}
export interface SheetRect extends SheetPoint {
  width: number;
  height: number;
}
export interface SheetRobot {
  agentId: string;
  key: string;
  x: number;
  y: number;
  phase: number;
  joining: boolean;
  fresh: boolean;
}
export interface SheetRoom {
  roomId: string;
  board: SheetRect;
  plate: SheetRect;
}
export interface SheetNote {
  roomId: string;
  rect: SheetRect;
}
export interface SheetMention {
  postId: string;
  from: SheetPoint;
  to: SheetPoint;
}
export interface Sheet {
  version: number;
  tiles: number;
  /** Picture pixels. */ width: number;
  height: number;
  /** Picture pixels per screen point. */ ratio: number;
  frame: { width: number; height: number; chest: SheetPoint };
  robots: SheetRobot[];
  rooms: SheetRoom[];
  notes: SheetNote[];
  mentions: SheetMention[];
}
export interface SheetTile extends SheetRect {
  version: number;
  index: number;
  jpeg: string;
  overlay: string | null;
}
export interface SpritePicture {
  png: string;
  frames: number;
  columns: number;
  frameWidth: number;
  frameHeight: number;
  frameMs: number;
  loop: boolean;
}
export interface SheetTake {
  tiles: SheetTile[];
  sheet: Sheet | null;
  problem: string | null;
}
export interface SheetSize {
  width: number;
  height: number;
  pixelRatio: number;
}
export interface OfficeSheetGlobal {
  start(input: { colors: PluginTheme["colors"] }): void;
  size(size: SheetSize): void;
  state(event: OfficeEvent): void;
  take(): SheetTake;
  sprite(key: string): SpritePicture | null;
}
```

- Produces `sheet-plan.ts` (pure): `sheetFrame(span, viewer, pixelRatio): StillFrame`, `spriteBox(perUnit: number, ratio: number): { width; height; seat: SheetPoint; chest: SheetPoint }` (picture px), `spriteFrame(box, ratio, perUnit): StillFrame` with the seat at world (0, 0), `spriteKey(robot): string`, `spriteLook(key): RobotPlan | null` (a robot at seat (0, 0) with that look), `SPRITE_CLIPS` (`typing` 24 frames, 3 strokes; `raised` 20 frames x 70 ms; others 1), `clipMotion(look, index): RobotFrame`, `typingPhase(seatIndex): number`, `stillSignature(plan, frame): string`, `tileRects(width, height): SheetRect[]`, `buildSheet({ plan, frame, version, tiles, fresh, plates }): Sheet`.
- Produces in `contracts.ts`: `SheetEventSchema` (`ready`, `tile`, `sheet`, `problem`), `sheetSubscription` (`office.sheet`, input `RenderSizeSchema` + `colors`), `sheetInputRpc` (`office.sheet.input.request`, `{ sheetId, resize? } → { ok }`), `sheetSpriteRpc` (`office.sheet.sprite.request`, `{ sheetId, key } → SpritePicture | null`); types `SheetEvent`, `SheetInput`, `SheetInputMessage`. The schemas are checked against the `shared/sheet.ts` types with `satisfies`.

- [ ] **Step 1:** Tests first in `sheet-plan.test.ts`: `sheetFrame gives whole picture sizes for a fractional viewer` (411.43 x 866.29 at ratio 2.625: `width * ratio` and `height * ratio` whole, ratio ≤ 2, pixels ≤ 4,000,000, ratio ≥ 1); `a deep office is taller than the viewer and starts at the first view's top`; `robots are ordered far to near`; `a robot's frame puts its seat where the backdrop draws it, within half a pixel`; `a walking robot is idle and joining`; `typing loops without a jump` (`clipMotion(look, 0)` equals the motion one frame after the last); `the wave ends on the still raised hand`; `spriteLook reads back what spriteKey wrote`; `an office without rooms is an empty picture of the viewer's size`; `tiles cover the picture without overlap, none over 1024`; `the signature ignores robots and follows rooms, notes and size`.
- [ ] **Step 2:** Implement `sheet-plan.ts` to pass them.
- [ ] **Step 3:** `render/sheet-page.ts`: pipeline for the layout (`createRenderPipeline`), stills, sheet plan. `take()` draws new tiles when the signature changed, and returns a sheet when anything changed. `sprite(key)` draws the clip into a grid and keeps it by key, at most `MAX_SPRITES`. A throw inside `take` or `sprite` becomes `problem`.
- [ ] **Step 4:** Contracts and their tests (`contracts.test.ts`: the sheet events parse; a tile over 1024 is refused).
- [ ] **Step 5:** The gate. `sheet-page.local.e2e.test.ts` opens the page against the real Chromium with the fake office at 390 x 700 x 2, saves the tiles, every sprite and a composed preview (backdrop, sprites in sheet order, overlay) to the temp directory, and also the real scene at the same camera. Look at them side by side. The bar is in the spec's Risks section. If it is not met, stop and take the pictures to the user.
- [ ] **Step 6:** Typecheck, lint, format. Commit `feat(fork): the office sheet page draws stills and positions`.

### Task 3: Sheet sessions on the daemon

**Files:**

- Create: `plugins/office/server/render/sheet-page-host.ts`, `plugins/office/server/render/sheet-sessions.ts`, `plugins/office/server/render/sheet-sessions.test.ts`
- Modify: `plugins/office/index.server.ts`

**Interfaces:**

- Consumes: `shared/sheet.ts`, the contracts of Task 2, `RenderPageHostDeps`, `loadThree`, `NO_WEBGL`, `PagePort` from `page-host.ts`.
- Produces:

```ts
export interface SheetPage {
  size(size: SheetSize): Promise<void>;
  state(event: OfficeEvent): Promise<void>;
  take(): Promise<SheetTake>;
  sprite(key: string): Promise<SpritePicture | null>;
  close(): Promise<void>;
  onClosed(listener: () => void): () => void;
}
export interface SheetPageHost {
  open(input: { colors: PluginTheme["colors"] }): Promise<SheetPage>;
}
export function createSheetPageHost(deps: RenderPageHostDeps): SheetPageHost;
export interface SheetSessions {
  attach(
    input: SheetInput,
    subscriber: { push(event: SheetEvent): Promise<void>; signal: AbortSignal },
  ): Promise<void>;
  input(message: SheetInputMessage): Promise<{ ok: boolean }>;
  sprite(message: { sheetId: string; key: string }): Promise<SpritePicture | null>;
  stop(): Promise<void>;
}
export function createSheetSessions(deps: {
  host: SheetPageHost | null;
  hub: Pick<Hub, "attach">;
  clock: Clock;
  newSheetId(): string;
  log(message: string): void;
}): SheetSessions;
```

- [ ] **Step 1:** Tests with a fake page, as `sessions.test.ts` does: `ready`, then the tiles of a take, then its sheet, in that order; takes never overlap; a third viewer gets `problem`; a silent viewer's page is closed after 30 s; a resize reaches the page and is followed by a take; the page is closed when the subscriber leaves; a page that throws ends the session with `problem`; `sprite` for an unknown sheet id is null; a take's `problem` ends the session.
- [ ] **Step 2:** Implement. The page is 64 x 64 at scale 1: stills size their own canvas. After every hub event and every resize: `take`, push tiles, push sheet. One take at a time; a change during a take causes one more.
- [ ] **Step 3:** Wire in `index.server.ts` beside the stream: `sheetSubscription`, `sheetInputRpc`, `sheetSpriteRpc`, `stop()` on shutdown. Page entry `render/sheet-page.ts`.
- [ ] **Step 4:** Typecheck, lint, format. Commit `feat(fork): office sheet sessions`.

### Task 4: The app's sheet view

**Files:**

- Create: `plugins/office/client/sheet/sheet-state.ts`, `sheet-motion.ts`, `sheet-view.tsx`, with `sheet-state.test.ts`, `sheet-motion.test.ts`, `sheet-view.mounted.test.tsx`
- Modify: `plugins/office/client/office-surface.tsx` (the sheet view where the stream view was)

**Interfaces:**

- Consumes: the contracts of Task 2; `StreamViewProps` shape, `sizeAfterLayout`, `KEEP_ALIVE_MS` from `scene/stream-view.tsx`.
- Produces: `SheetView(props: StreamViewProps)`; `sheetReducer(state, event: SheetEvent): SheetState` with `shown: { sheet: Sheet; tiles: SheetTile[] } | null`; in `sheet-motion.ts`: `stepRanges(picture: SpritePicture): { input: number[]; x: number[]; y: number[] }`, `fitted(transform, sheet, viewer): Transform`, `pinched(transform, before, after): Transform`, `targetAt(sheet, transform, point, reach): { agentId } | { boardId } | { roomId } | null`, `focusOn(sheet, target, viewer): Transform | null`, `playsOnce(previous: SheetRobot | undefined, next: SheetRobot): boolean`.

- [ ] **Step 1:** Pure tests first: the three Review Focus tests (3, 4, 5); stepped ranges show frame `n` for every value in `[n, n + 1)` and the last frame at the end; pan stops with the office still on screen; zoom stops at "whole office fits" and at twice the backdrop's own scale; a tap picks a robot before the board behind it; `focusOn` centres a robot.
- [ ] **Step 2:** Implement state and motion.
- [ ] **Step 3:** `sheet-view.tsx`: subscription, keep-alive, resize; tiles as `Image`s; sprites as clipped `View`s whose `Image` is moved by a stepped, native-driven `Animated` value (one shared looping clock for `typing`, `Animated.modulo` for `phase`; a once-only value per `raised` robot); a robot marked `joining` fades in; a new mention flies the plane; pan, pinch and tap through the responder system, with the transform in `Animated.Value`s set without a React render; `focusRequest` glides.
- [ ] **Step 4:** Mounted test: a tap on a robot's place calls `onSelectAgent`; a `problem` calls `onProblem`.
- [ ] **Step 5:** `office-surface.tsx`: `SheetView` in place of `StreamView`. Its tests still pass.
- [ ] **Step 6:** Typecheck, lint, format. Commit `feat(fork): the office is composed and animated on the phone`.

### Task 5: Docs and the whole-branch check

- [ ] **Step 1:** `docs/plugins.md` / `docs/docker.md`: where the streamed 3D view is described, describe the sheet view instead (integrate, do not append).
- [ ] **Step 2:** `npm run build:server`, the plugins test suite once (output to a file), typecheck, lint, format check.
- [ ] **Step 3:** A fresh reviewer on the whole branch; fix what it finds test-first.
