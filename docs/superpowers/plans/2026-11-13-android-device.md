# Android device in the stack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An Android 14 device runs in the Paseo stack; agents test an Android app on it with tools over adb, the user watches and operates it in a panel, and Maestro flows run against it.

**Architecture:** A privileged redroid container in `docker-compose.yml`, reachable only on the paseo container's loopback through a socat sidecar. A built-in plugin, `android`, runs the `adb` binary from the daemon process: agent tools, and a picture stream with an input RPC for a panel made of React Native primitives. Java and the Maestro CLI go into the agent image.

**Tech Stack:** Docker Compose, redroid, adb, TypeScript, zod contracts, the plugin SDK (`@getpaseo/plugin`), React Native primitives, vitest, node:test.

**Spec:** `docs/superpowers/specs/2026-11-13-e2e-testing-design.md` ("Parts 2 to 4: Android device").

## Global Constraints

- adb on the device has no authentication: it is published on no host port and sits on no network shared with another stack. It reaches the paseo container at `127.0.0.1:5555` only.
- The feature is off unless `PASEO_ANDROID_ADB` is set and `adb` is on `PATH`: no panel, no tools, no timers.
- With the variable set and the device not answering: the words "The Android device is unreachable" in the panel (with Retry) and from every tool.
- Everything goes through `adb -s <serial>`; nothing uses `docker exec`.
- Daemon-process code never throws out of a handler, a timer or a child-process callback.
- Agent tools go to interactive sessions only, behind the plugin's own host setting `agentTools` (default true).
- Pictures: at most 2 a second, none while the screen is unchanged, only while someone watches; at most 2 viewers; a viewer silent for 30 s is closed; the app speaks at least every 10 s.
- A built-in imports only from its own directory and the plugin SDK. Server code never imports from `client/`.
- Repo rules (`CLAUDE.md`): run only the test files you touch; `npm run typecheck` and `npm run lint -- <files>` after changes; `npm run format:files -- <files>` before committing. Commit messages `feat(fork): …`, no AI attribution lines.

## Review Focus

1. **The device restarts or goes offline mid-use.** Tools and the stream answer "unreachable" and recover on the next call; no child process is left running; nothing throws in the daemon.
2. **An `adb` call hangs.** Every call has a timeout that kills the child; a stream tick does not overlap the previous one.
3. **A dump of an odd screen**: empty, a WebView, thousands of nodes, non-ASCII text, a node with no bounds. The parser returns a list, never throws, and caps its length.
4. **Text with shell metacharacters** in `android_type` or a package name (quotes, `$()`, `;`, spaces). Nothing a viewer or an agent sends is interpreted by a shell on the device or in the daemon.
5. **Two viewers, and a viewer who leaves without unsubscribing.** The third is refused; the silent one is closed and its slot freed.

---

### Task 1: The device in the stack

**Files:**

- Modify: `docker/docker-compose.yml`, `docker/Dockerfile.agents`, `docker/README.md`, `docs/docker.md`
- Modify: `scripts/vpn-overlay.test.mjs`

**Interfaces:**

- Produces: env `PASEO_ANDROID_ADB=127.0.0.1:5555` in the paseo service; `adb` on `PATH` in the agent image; compose service `android` (container `${INSTANCE_NAME:-paseo}-android`), sidecar `paseo-android-adb`, private network `android`.

- [ ] **Step 1: Write the failing tests** in `scripts/vpn-overlay.test.mjs`:

```js
test("the Android device is privileged, publishes no port and joins no shared network", () => {
  // parse the `android:` service block of docker/docker-compose.yml
  // image starts with "redroid/redroid:14.0.0_64only"; privileged: true; mem_limit: 4g;
  // no `ports:` key; networks is exactly [android]; a volume mounted on /data;
  // command carries the four androidboot.redroid_* arguments from the spec
});
test("adb reaches the paseo container's loopback through a sidecar, and nowhere else", () => {
  // paseo-android-adb: network_mode "service:paseo";
  // command: TCP-LISTEN:5555,fork,reuseaddr,bind=127.0.0.1 TCP:android:5555
  // paseo service: environment has PASEO_ANDROID_ADB: 127.0.0.1:5555 and networks include android
  // top-level networks.android exists and is not `external`
});
test("the agent image has adb", () => {
  // Dockerfile.agents apt-installs "adb"
});
```

- [ ] **Step 2: Run them, see them fail.** `node --test --test-name-pattern="Android|adb" scripts/vpn-overlay.test.mjs`
- [ ] **Step 3: Add the service, the sidecar, the network, the env var and the `adb` package.** The device's command is the image's default with the boot arguments appended. Healthcheck: `["CMD", "getprop", "sys.boot_completed"]` is not enough (it exits 0 when empty): use `sh -c 'test "$(getprop sys.boot_completed)" = 1'`.
- [ ] **Step 4: Run the whole file, see it pass.** `node --test scripts/vpn-overlay.test.mjs`
- [ ] **Step 5: Docs.** `docs/docker.md`: the device, the host's `binder_linux` step (the two files in the spec), what a host without it looks like, that the VPN and borrowed-browser stacks have none. `docker/README.md`: one row in the service table and a short section.
- [ ] **Step 6: Commit** `feat(fork): an Android device in the stack, reachable only from the paseo container`.

---

### Task 2: The plugin's server — adb, snapshot, tools

**Files:**

- Create: `plugins/android/paseo-plugin.json`, `index.server.ts`, `index.server.test.ts`
- Create: `plugins/android/server/adb.ts`, `adb.test.ts`, `snapshot.ts`, `snapshot.test.ts`, `device.ts`, `device.test.ts`, `agent-tools.ts`, `agent-tools.test.ts`, `errors.ts`
- Create: `plugins/android/shared/contracts.ts`, `shared/settings.ts`
- Create: `plugins/android/server/fixtures/*.xml` (real dumps)
- Modify: `packages/server/src/server/plugins/builtin/index.ts` (the `builtinPlugins` list, alphabetical), `knip.json` if it lists plugin entries, `docs/plugins.md`

**Interfaces:**

- Consumes: `defineAgentTool`, `PluginServerContext`, `agent.open.before` hook (as `plugins/office/index.server.ts` uses them); `defineSettings`.
- Produces:

```ts
// server/errors.ts
export const UNREACHABLE = "The Android device is unreachable";
export class DeviceUnreachableError extends Error {} // message UNREACHABLE

// server/adb.ts
export interface AdbRunner {
  /** Runs `adb <args>`; resolves stdout. Rejects on a non-zero exit, a timeout (the child is killed) or a spawn error. */
  run(args: readonly string[], options?: { timeoutMs?: number; binary?: boolean }): Promise<Buffer>;
}
export function createAdbRunner(input: {
  adbPath?: string;
  spawn?: typeof import("node:child_process").spawn;
}): AdbRunner;
export const ADB_TIMEOUT_MS = 15_000;

// server/device.ts — the device, in the words the tools and the stream use
export interface AndroidDevice {
  /** `adb connect` when not connected, then `wait-for-device` semantics with a short timeout. Throws DeviceUnreachableError. */
  ensure(): Promise<void>;
  shell(command: readonly string[]): Promise<string>; // argv, never a shell string
  screenshot(): Promise<Buffer>; // PNG
  dump(): Promise<string>; // uiautomator XML
  focus(): Promise<{ packageName: string | null; activity: string | null }>;
  tap(x: number, y: number): Promise<void>;
  swipe(from: Point, to: Point, durationMs: number): Promise<void>;
  key(keycode: string): Promise<void>;
  text(value: string): Promise<void>;
  install(apkPath: string): Promise<void>;
  launch(packageName: string): Promise<void>;
  stop(packageName: string): Promise<void>;
  logs(input: { packageName?: string; lines: number }): Promise<string>;
  size(): Promise<{ width: number; height: number }>;
}
export function createAndroidDevice(input: { serial: string; adb: AdbRunner }): AndroidDevice;

// server/snapshot.ts — pure
export const MAX_ELEMENTS = 200;
export interface ScreenElement {
  ref: string; // "@a1", "@a2", ...
  text: string;
  description: string;
  id: string;
  bounds: { left: number; top: number; right: number; bottom: number };
  clickable: boolean;
  focused: boolean;
  scrollable: boolean;
}
export function parseSnapshot(xml: string): ScreenElement[];
export function snapshotText(input: {
  packageName: string | null;
  activity: string | null;
  elements: ScreenElement[];
}): string;
export function centerOf(element: ScreenElement): { x: number; y: number };

// server/agent-tools.ts
export function createAndroidTools(ports: {
  device: AndroidDevice;
  workspacePath(agent): string | null;
  now(): Date;
}): AgentToolDefinition[];
// names: android_snapshot, android_tap, android_type, android_key, android_swipe,
//        android_screenshot, android_install, android_launch, android_logs

// shared/settings.ts
export const androidHostSettings = defineSettings({
  id: "android",
  scope: "host",
  version: 1,
  schema: z.object({ agentTools: z.boolean().default(true) }),
});

// index.server.ts
export interface AndroidPluginDeps {
  device: AndroidDevice | null;
  clock: Clock;
  log(message: string): void;
}
export function createAndroidPlugin(
  server: PluginServerContext,
  deps: AndroidPluginDeps,
): () => Promise<void>;
// default export: device is null unless process.env.PASEO_ANDROID_ADB is set and `adb` resolves on PATH
```

`shell` passes an argv to `adb shell`, where adb joins arguments with spaces and the device's shell parses the result; so every argument is single-quoted for the device shell (`'` → `'\''`) by one function, `quoteForDevice(arg)`, tested on its own. `text(value)` sends `input text` with the value quoted the same way and spaces as `%s`. `android_install` accepts only a path that resolves inside the agent's workspace or the home folder and ends in `.apk`. `android_screenshot` writes `android-<timestamp>.png` under `<workspace>/.paseo/android/` (the workspace's cwd when it has no such folder) and returns the path. A tap by ref looks the ref up in the last snapshot this agent took; an unknown or stale ref answers "Take a new snapshot: that ref is not on the screen any more".

- [ ] **Step 1: Capture fixtures.** Dumps of the launcher and of Settings from a real device into `server/fixtures/`.
- [ ] **Step 2: Failing tests for `snapshot.ts`:** refs count from `@a1` in document order; a node with no text, description, id or action is left out; bounds parse `[0,84][720,180]`; XML entities decode (`Network &amp; internet`); non-ASCII text survives; a node with malformed bounds is skipped; an empty or non-XML string gives `[]`; more than 200 elements are cut to 200; `snapshotText` puts one element per line as `@a3 "Network & internet" [button] id=…`.
- [ ] **Step 3: Implement, see pass.** `cd plugins && npx vitest run android/server/snapshot.test.ts`
- [ ] **Step 4: Failing tests for `adb.ts`** with a fake `adb` shell script on a temp `PATH` that records its argv and answers from a script: stdout returned as a Buffer; non-zero exit rejects with stderr's text; a hang is killed at the timeout and rejects; a missing binary rejects with "adb is not installed".
- [ ] **Step 5: Implement, see pass.**
- [ ] **Step 6: Failing tests for `device.ts`** with a fake `AdbRunner`: `ensure` connects once and maps `offline`/`unable to connect`/a timeout to `DeviceUnreachableError`; each method's argv; `quoteForDevice` on `a b`, `it's`, `$(reboot)`, `;rm -rf /`, an empty string; `text("hello world")` sends `hello%sworld` quoted; `install` uses `install -r`; `logs` with a package resolves its pid first and falls back to the whole log when the app is not running.
- [ ] **Step 7: Implement, see pass.**
- [ ] **Step 8: Failing tests for the tools and the entry:** nine tools with those names; snapshot text; tap by ref and by point; stale ref; install refuses a path outside the workspace and home, and a non-APK; screenshot writes the file and returns its path; every tool answers `UNREACHABLE` when the device throws it; the entry adds tools only to interactive sessions and only while the setting is on; with `device: null` the entry registers no hook and no handler.
- [ ] **Step 9: Implement, register the built-in, see pass.** Also run `node --test scripts/builtin-plugins-dist.test.mjs` after `npm run build:server`.
- [ ] **Step 10: By hand against a real device:** snapshot of Settings, tap a row by ref, type into search, screenshot saved.
- [ ] **Step 11: Docs** (`docs/plugins.md`, "Built-in plugins") and **commit** `feat(fork): android built-in: agent tools over adb`.

---

### Task 3: The panel and its picture stream

**Files:**

- Create: `plugins/android/server/stream.ts`, `stream.test.ts`
- Modify: `plugins/android/shared/contracts.ts`, `index.server.ts`, `index.server.test.ts`
- Create: `plugins/android/index.client.tsx`, `client/android-surface.tsx`, `client/stream-gesture.ts` (+ test), `client/stream-outbox.ts` (+ test), `client/stream-state.ts` (+ test), `client/android-surface.mounted.test.tsx`, `client/styles.ts`

**Interfaces:**

- Consumes: `AndroidDevice` (Task 2); the office's stream modules as the pattern to copy (`plugins/office/server/render/sessions.ts`, `client/scene/stream-*.ts`, `stream-view.tsx`).
- Produces:

```ts
// shared/contracts.ts
export const AndroidStateSchema = z.object({ available: z.boolean(), agentTools: z.boolean() });
export const androidStateRpc = defineRpc({
  name: "android.state.request",
  input: z.object({}),
  output: AndroidStateSchema,
});
export const AndroidStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    streamId: z.string(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  z.object({ type: z.literal("picture"), seq: z.number().int().positive(), png: z.string() }),
  z.object({ type: z.literal("problem"), message: z.string() }),
]);
export const androidStreamSubscription = defineSubscription({
  name: "android.stream",
  input: z.object({}),
  event: AndroidStreamEventSchema,
});
export const AndroidInputSchema = z.object({
  streamId: z.string(),
  shown: z.number().int().positive().optional(),
  tap: z.object({ x: z.number(), y: z.number() }).optional(), // device pixels
  swipe: z
    .object({ from: PointSchema, to: PointSchema, durationMs: z.number().int().min(50).max(3000) })
    .optional(),
  key: z.enum(["back", "home", "recents", "enter", "delete"]).optional(),
  text: z.string().max(500).optional(),
});
export const androidInputRpc = defineRpc({
  name: "android.stream.input.request",
  input: AndroidInputSchema,
  output: z.object({ ok: z.boolean() }),
});

// server/stream.ts
export const PICTURE_INTERVAL_MS = 500;
export const MAX_VIEWERS = 2;
export const SILENCE_LIMIT_MS = 30_000;
export const MAX_UNCONFIRMED = 2;
export function createAndroidStreams(deps: {
  device: AndroidDevice | null;
  clock: Clock;
  newStreamId(): string;
  log(message: string): void;
}): {
  attach(subscriber: { push(event): Promise<void>; signal: AbortSignal }): Promise<void>;
  input(message): Promise<{ ok: boolean }>;
  stop(): Promise<void>;
};
```

A picture is sent only when its bytes differ from the last one sent to that viewer (compare a hash). One screenshot is in flight per stream. The client maps a touch from view pixels to device pixels using the `ready` size and the picture's letterboxed rectangle; a press and release within 8 view pixels is a tap, anything else is a swipe from press to release with the gesture's own duration.

- [ ] **Step 1: Failing tests for `stream.ts`** with a fake device and the fake clock: refuses with no device; refuses a third viewer; `ready` carries the device size; no picture while the screen is unchanged; a changed screen sends one; holds at two unconfirmed and sends the newest after a confirmation; a screenshot slower than the interval does not overlap; `DeviceUnreachableError` ends the stream with the unreachable problem; a silent viewer is closed at 30 s; unsubscribe frees the slot; tap, swipe, key and text reach the device; input for an unknown stream answers `ok: false`.
- [ ] **Step 2: Implement, wire into `index.server.ts`, see pass.**
- [ ] **Step 3: Failing tests for the client's pure parts**: view-to-device mapping with letterboxing on both axes and a touch outside the picture ignored; tap against swipe; the outbox keeps one call in flight; the state reducer resets on `ready`.
- [ ] **Step 4: Implement the surface**: panel and screen registered as the office registers its own (`addWorkspacePanel`, `addScreen`, `addSidebarHeaderItem`, `addCommandCenterItem`), shown only when `android.state.request` says available; Back, Home and Recents buttons; a text field with a Send button; an "Agent tools" switch on the host setting; the unreachable banner with Retry. One mounted test: a tap on the picture sends one `tap` in device pixels.
- [ ] **Step 5: By hand:** compile the plugin as the daemon does; open the stream against a real device and save a picture.
- [ ] **Step 6: Docs and commit** `feat(fork): android built-in: a panel that shows the device and takes touches`.

---

### Task 4: Maestro in the agent image

**Files:**

- Modify: `docker/Dockerfile.agents`, `docker/README.md`, `scripts/vpn-overlay.test.mjs`

- [ ] **Step 1: Failing test:** the Dockerfile installs a Java 17 runtime (`openjdk-17-jre-headless`) and the Maestro CLI at a pinned version, checks `maestro --version` in the build, and puts `maestro` on `PATH`.
- [ ] **Step 2: Implement, see pass.**
- [ ] **Step 3: By hand on a real device:** a two-line flow that opens Settings and asserts a label, run with `maestro --device <serial> test`.
- [ ] **Step 4: Docs and commit** `feat(fork): Maestro in the agent image`.
