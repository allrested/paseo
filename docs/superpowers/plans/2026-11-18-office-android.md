# The 3D office in the fork's Android app Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The fork's own Android app (`sh.paseo.fork`, "Paseo Fork") shows the office in 3D: a general `ScriptFrame` in the plugin kit runs the scene's script in a WebView, the office talks to it through a message bridge, and a signed arm64 APK of the fork is built and checked, ready for the owner's phone.

**Architecture:** `ScriptFrame` is a kit component with two implementations in the app (a `react-native-webview` page on native, a sandboxed `iframe` on the web) that share one page builder and one message protocol. The office gets a `WorldApi` over that protocol (`world-bridge.ts` on the plugin side, `world-bridge-page.ts` in the page), a hook `useWorldFeed` that both the web view and the new native view use to feed the scene, and offers 3D on native only where `ScriptFrame` exists. The fork is an `APP_VARIANT`, built locally by `scripts/build-apk.mjs` and re-signed with a key kept outside the repo.

**Tech Stack:** TypeScript, React Native 0.86 with `react-native-webview` 13.16.1, Expo 57 (`expo prebuild`, Gradle), vitest (jsdom and Chromium projects in `packages/app`, jsdom in `plugins`), esbuild (the plugin client bundle), Java 21, Android SDK 35.

**Spec:** `docs/superpowers/specs/2026-11-18-office-android-design.md` (sub-project 5 of `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`). The scene and its API are from `docs/superpowers/plans/2026-11-17-office-walk-in.md` and the plans before it, all on `main`.

## Global Constraints

- Work in your own worktree on branch `feat/office-android`, made from `main`. Do not push. Do not write in any other worktree. Never restart or touch the daemon on port 6767.
- Every subagent runs on Opus.
- No commit carries AI attribution: no `Co-Authored-By` trailer, no "Generated with" line. Commit style: `feat(plugin): ...`, `feat(app): ...`, `feat(office): ...`, `docs(office): ...`.
- Run one test file at a time. Office tests from `plugins/`: `cd plugins && npx vitest run office/client/world/<file> --bail=1`. App tests from `packages/app`: `npx vitest run <file> --bail=1` (unit project), `npx vitest run --project browser <file> --bail=1` (a `*.browser.test.tsx`, real Chromium, already installed). Plugin package tests from `packages/plugin`. Never run a whole suite.
- After each task's code: `npm run build:plugin` when `packages/plugin` changed (the office and the app import the kit's types from its `dist`), then `npm run typecheck --workspace=<package>` for each package touched (`@getpaseo/plugin`, `@getpaseo/app`, `@getpaseo/builtin-plugins`), then `npm run lint -- <changed .ts/.tsx/.mjs/.js files outside plugins/office/vendor/>`, then `npm run format:files -- <the same files plus any .md>`.
- Doc voice (`CLAUDE.md`): plain and short, second person, rule then reason, no setup-and-punchline sentences, no "simply", "just", "robust", "seamless".
- Platform files follow `CLAUDE.md` "Platform gating" in `packages/app`: Metro picks `.native.tsx` and `.web.tsx`, and a base file stays for TypeScript. The plugin's own code under `plugins/office` is different: its client is one esbuild bundle (`platform: "neutral"`, `packages/server/src/server/plugins/compiler-build.ts:358`) that resolves no platform extension. The office chooses its native view in code.
- Tests assert behaviour, not structure (`docs/testing.md`): no `toBeTruthy`, no conditional assertions.
- The APK is built and verified in Task 7. It is NOT uploaded by the plan. The upload to `allrested/paseo` waits for the owner's yes and is done by the controller outside the plan.
- No install runs before Task 7 (no JDK, no Android SDK). Tasks 1 to 6 need only what the worktree already has.
- Snippets are in `text` fences where the formatter would rewrite them, `ts` or `tsx` elsewhere; the formatter fixes the rest.

Binding values from the spec:

- `ScriptFrame` props: `script: string` (run once after an empty standards-mode page loads), `onMessage(text: string)`, `onError?(message: string)`, `title: string`, `testID?: string`. A ref gives `post(text: string)`. The page: `window.paseoFrame.post(text)` sends; `window.paseoFrame.onMessage = (text) => ...` receives. Only strings cross. Posts before the page is ready wait in a queue and are delivered in order.
- Native: `WebView` with `source={{ html, baseUrl: "https://script-frame.invalid/" }}`, `javaScriptEnabled`, `domStorageEnabled`, `allowFileAccess={false}`, `allowFileAccessFromFileURLs={false}`, `setSupportMultipleWindows={false}`, `javaScriptCanOpenWindowsAutomatically={false}`, `thirdPartyCookiesEnabled={false}`, `mediaPlaybackRequiresUserAction`. `onShouldStartLoadWithRequest` allows the first load of that base URL only. The page's `post` goes through `ReactNativeWebView.postMessage`; a plugin's `post` is injected as a call of `paseoFrame.onMessage` with the text as a JSON string.
- The CSP: `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:`.
- Web: an `iframe` with `srcdoc` and `sandbox="allow-scripts"`, the same CSP, messages by `postMessage` checked against the frame's `contentWindow`. `localStorage` throws there, and the reference says so. The office keeps `world-frame.web.ts` on the web.
- Detection: `"ScriptFrame" in ui`. The store app and older apps do not have it.
- The bridge: a call is `{ "call": name, "args": [...] }`; the page's stand-in callbacks post `{ "callback": name, "args": [...] }`; a scene script that throws, or no `PaseoOfficeWorld` of `WORLD_API_VERSION`, posts `{ "problem": message }`. `start` sends its options without the callbacks plus the names of those given. `stop` sends its message, then the frame unmounts.
- Native office: 3D offered when `ScriptFrame` is there; Photo mode hidden (`host.photo === false`); Walk in and Full screen hidden by their existing rules; brand logo passed only as a `data:` URL; `focusApp` does nothing; no graphics setting (the loop's `adaptResolution`); no WebGL2 makes the scene report a problem and the office gives way to 2D under the existing banner with Try again.
- The fork: variant `fork`, name "Paseo Fork", package `sh.paseo.fork`, no Firebase file. `npm run build:apk:fork` builds with `APP_VARIANT=fork`, arm64 only, then `zipalign` and `apksigner` from build tools re-sign with the fork's key. Output `artifacts/paseo-fork-arm64.apk`. The generated Gradle files are not changed. The key: `~/.paseo-fork/release.keystore`, password in `~/.paseo-fork/release.password` (mode 0600), never in the repo. A build without the key stops and says where the key should be and how to make it.
- Toolchain, in the home folder, no system changes: Java 21 (Temurin) in `~/.local/jdk-21`; Android command-line tools, platform 35, build tools 35 and the NDK the React Native version asks for, in `~/Android/Sdk`.
- Release tag, for the controller: `fork-android-<version>-<n>`, e.g. `fork-android-0.16.0-1`, a prerelease on `allrested/paseo`.
- Not built: iOS, a Play Store listing, automatic updates, push notifications in the fork's app, a graphics setting for phones, `ScriptFrame` in other plugins.

Decided in this plan, where the spec left it open or the code disagreed (see the self-review for evidence):

- The office's native view is `client/world/world-view-native.tsx`, not `world-view.native.tsx`. The plugin bundle resolves no `.native` extension, so `office-surface.tsx` picks the view by `layout.platform`.
- `host.photo` does not exist in the scene yet. Task 4 adds it (`paseo-host.js`, a `photo` start option, a guard in `ui/photo.js` for the button and the P key).
- `packages/app` needs a base `script-frame.tsx` beside the `.native.tsx` and `.web.tsx` files: TypeScript has no `moduleSuffixes` and cannot resolve `./script-frame` otherwise.
- The queue the spec lists under the bridge is `ScriptFrame`'s. The bridge posts through the frame's handle and has none of its own.
- A shared file `client/world/world-view-shared.ts` holds what the web and the native view both need (start options, the script loader, the stand-up bell). The spec names only the hook; without this file the native view repeats about 150 lines of `world-view.tsx`.
- The page script forces `document.fullscreenEnabled` to `false`, so Full screen is hidden on Android whatever the WebView says. Task 4.
- `public-docs/plugins/reference.zh-CN.md` gets the same section (`docs/website-i18n.md:32`).
- On a device that never chose a view, 3D is the default wherever it is offered (`viewOnDevice("auto", true)`), so a phone with `ScriptFrame` opens the office in 3D. This is the existing rule applied to the new platform. The owner can say if a phone should default to 2D; it is one line in `office-surface.tsx`.

## Files shared with other branches

| File                                                                                        | Also edited by         | How to keep the merge small                                                                                                                                                     |
| ------------------------------------------------------------------------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `plugins/office/client/world/world-view.tsx`, `world-api.ts`                                | any later office piece | Task 3 moves code out of `world-view.tsx`; do it first and fast, and rebase onto `main` before it. `world-api.ts` gains one optional field, `photo?: boolean`, after `onToast`. |
| `plugins/office/client/office-surface.tsx`                                                  | the office pieces      | Task 5 touches the view helpers (lines 168 to 176), `useViewChoice` (line 351), `SurfaceBody` and its caller. Nothing else.                                                     |
| `plugins/office/vendor/my-office/src/office/paseo-host.js`, `paseo-entry.js`, `ui/photo.js` | none known             | One property (`photo`), one line in `start`, one guard in each of two functions of `photo.js`.                                                                                  |
| `packages/plugin/src/client/ui.ts`, `packages/app/src/plugins/react-native/ui.ts`           | any kit change         | One declaration block after `DocumentFrame`; one export line.                                                                                                                   |
| `scripts/build-apk.mjs`, `package.json`, `docs/android.md`, `packages/app/app.config.js`    | none known             | Additive.                                                                                                                                                                       |

## Review Focus

1. **The web office must not change.** Task 3 moves code and runs `world-view.mounted.test.tsx`, `use-incident-alarm.mounted.test.tsx`, `entry.test.ts` and `adapter.test.ts` before and after, with no new behaviour. Task 5 adds the native view and does not touch `world-frame.web.ts`.
2. **A missing kit export reads as undefined.** The plugin's client bundle gets `@getpaseo/plugin/client/ui` from `evaluate.ts:580`; an app without `ScriptFrame` has no such key. The office reads it only as `"ScriptFrame" in ui` (`script-frame-kit.ts`), never as a property, so a module mock without it (as `world-view.mounted.test.tsx` has) does not throw. Pinned in Task 5.
3. **Nothing leaves the page.** The CSP and the load guard are the only walls; the tests pin the CSP string and the single allowed load. Checked again on the phone (Task 7).
4. **The first post races the page.** The office starts the scene right after the frame mounts, long before the page is ready. The queue in `ScriptFrame` is what makes that safe. Pinned in Task 1 (queue) and Task 5 (start is the first message, then the feed, in order).
5. **The APK is not uploaded.** Task 7 ends with a verified file and a checklist.

---

### Task 1: `ScriptFrame` in the kit, on Android

**Files:**

- Modify: `packages/plugin/src/client/ui.ts` (after `DocumentFrame`, line 211)
- Create: `packages/app/src/plugins/react-native/script-frame-page.ts`
- Create: `packages/app/src/plugins/react-native/script-frame.native.tsx`
- Create: `packages/app/src/plugins/react-native/script-frame.tsx` (the base TypeScript resolves)
- Modify: `packages/app/src/plugins/react-native/ui.ts` (after the `DocumentFrame` export)
- Test: `packages/app/src/plugins/react-native/script-frame-page.test.ts` (new), `packages/app/src/plugins/react-native/script-frame.native.test.tsx` (new), `packages/app/src/plugins/evaluate.test.ts` (one test)

**Interfaces:**

- Produces (kit, `@getpaseo/plugin/client/ui`):

```ts
export interface ScriptFrameProps {
  /** JavaScript run once, in an empty standards-mode page with no network. */
  script: string;
  /** Text the page sent with `window.paseoFrame.post(text)`. */
  onMessage(text: string): void;
  /** The script threw, or the page could not start. */
  onError?(message: string): void;
  /** What a screen reader calls the frame. */
  title: string;
  testID?: string;
}
export interface ScriptFrameHandle {
  /** Sends text to `window.paseoFrame.onMessage`. Posts made before the page is ready wait, in order. */
  post(text: string): void;
}
export declare const ScriptFrame: ForwardRefExoticComponent<
  ScriptFrameProps & RefAttributes<ScriptFrameHandle>
>;
```

- Produces (app, `script-frame-page.ts`), used by Task 2 as well:

```ts
export const SCRIPT_FRAME_BASE_URL: string;
export const SCRIPT_FRAME_CSP: string;
export type FrameTransport = "native" | "web";
export type PageMessage =
  | { paseoFrame: "ready" }
  | { paseoFrame: "message"; text: string }
  | { paseoFrame: "error"; message: string };
export function parsePageMessage(value: unknown): PageMessage | null;
export function bootstrapSource(transport: FrameTransport): string;
export function scriptFrameHtml(script: string, transport: FrameTransport): string;
export function deliverScript(text: string): string; // JS source for injectJavaScript
export interface PostQueue {
  post(text: string): void;
  ready(): void;
  reset(): void;
}
export function createPostQueue(deliver: (text: string) => void): PostQueue;
export function routePageMessage(
  message: PageMessage,
  queue: PostQueue,
  handlers: { onMessage(text: string): void; onError?(message: string): void },
): void;
```

- [ ] **Step 1: Write the failing tests for the page module.**

Create `packages/app/src/plugins/react-native/script-frame-page.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  SCRIPT_FRAME_CSP,
  bootstrapSource,
  createPostQueue,
  deliverScript,
  parsePageMessage,
  routePageMessage,
  scriptFrameHtml,
} from "./script-frame-page";

describe("the frame's page", () => {
  it("carries the policy first, then the bootstrap, the script and the ready call, in that order", () => {
    const html = scriptFrameHtml("window.answer = 42;", "native");
    const policy = html.indexOf("Content-Security-Policy");
    const bootstrap = html.indexOf("window.paseoFrame = frame");
    const script = html.indexOf("window.answer = 42;");
    const ready = html.indexOf("__paseoFrameReady()");
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(policy).toBeGreaterThan(-1);
    expect([policy < bootstrap, bootstrap < script, script < ready]).toEqual([true, true, true]);
  });

  it("has no network: the policy is the spec's, word for word", () => {
    expect(SCRIPT_FRAME_CSP).toBe(
      "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:",
    );
    expect(scriptFrameHtml("", "web")).toContain(`content="${SCRIPT_FRAME_CSP}"`);
  });

  it("keeps a script that mentions the end of a script tag inside its own tag", () => {
    const html = scriptFrameHtml('var s = "</script><b>x</b>";', "web");
    expect(html).not.toContain('"</script>');
    expect(html).toContain('"<\\/script>');
  });

  it("sends a plugin's text to the page as a call of paseoFrame.onMessage with a JSON string", () => {
    const code = deliverScript('say "hi"\n');
    expect(code).toContain('f("say \\"hi\\"\\n")');
    expect(code.endsWith("true;")).toBe(true);
  });
});

describe("the page's side of the bridge", () => {
  function pageWindow() {
    const posted: string[] = [];
    const listeners = new Map<string, (event: unknown) => void>();
    const win: Record<string, unknown> = {
      ReactNativeWebView: { postMessage: (data: string) => posted.push(data) },
      addEventListener: (type: string, listener: (event: unknown) => void) =>
        listeners.set(type, listener),
    };
    new Function("window", bootstrapSource("native"))(win);
    return { win, posted, listeners };
  }

  it("posts a page's text as a message envelope, as a string", () => {
    const { win, posted } = pageWindow();
    (win.paseoFrame as { post(text: string): void }).post("hello");
    expect(posted.map((data) => JSON.parse(data))).toEqual([
      { paseoFrame: "message", text: "hello" },
    ]);
  });

  it("reports an error of the page as an error envelope", () => {
    const { posted, listeners } = pageWindow();
    listeners.get("error")?.({ message: "boom" });
    expect(posted.map((data) => JSON.parse(data))).toEqual([
      { paseoFrame: "error", message: "boom" },
    ]);
  });

  it("says ready once the page calls the ready hook, and the hook is private to the host's own script", () => {
    const { win, posted } = pageWindow();
    (win.__paseoFrameReady as () => void)();
    expect(posted.map((data) => JSON.parse(data))).toEqual([{ paseoFrame: "ready" }]);
  });
});

describe("parsing what a page sent", () => {
  it.each([
    [{ paseoFrame: "ready" }, { paseoFrame: "ready" }],
    [
      { paseoFrame: "message", text: "a" },
      { paseoFrame: "message", text: "a" },
    ],
    [
      { paseoFrame: "error", message: "m" },
      { paseoFrame: "error", message: "m" },
    ],
  ])("reads %j", (value, expected) => {
    expect(parsePageMessage(value)).toEqual(expected);
  });

  it.each([
    null,
    "text",
    4,
    {},
    { paseoFrame: "message" },
    { paseoFrame: "message", text: 4 },
    { paseoFrame: "other" },
  ])("ignores %j", (value) => {
    expect(parsePageMessage(value)).toBeNull();
  });
});

describe("the post queue", () => {
  it("holds posts until the page is ready and then delivers them in order", () => {
    const sent: string[] = [];
    const queue = createPostQueue((text) => sent.push(text));
    queue.post("a");
    queue.post("b");
    expect(sent).toEqual([]);
    queue.ready();
    expect(sent).toEqual(["a", "b"]);
    queue.post("c");
    expect(sent).toEqual(["a", "b", "c"]);
  });

  it("delivers nothing twice when the page says ready twice", () => {
    const sent: string[] = [];
    const queue = createPostQueue((text) => sent.push(text));
    queue.post("a");
    queue.ready();
    queue.ready();
    expect(sent).toEqual(["a"]);
  });

  it("waits again after a reset, keeping what was posted meanwhile", () => {
    const sent: string[] = [];
    const queue = createPostQueue((text) => sent.push(text));
    queue.ready();
    queue.reset();
    queue.post("late");
    expect(sent).toEqual([]);
    queue.ready();
    expect(sent).toEqual(["late"]);
  });
});

describe("routing a page's message", () => {
  it("opens the queue on ready, hands text to onMessage and errors to onError", () => {
    const sent: string[] = [];
    const queue = createPostQueue((text) => sent.push(text));
    const onMessage = vi.fn();
    const onError = vi.fn();
    queue.post("first");
    routePageMessage({ paseoFrame: "ready" }, queue, { onMessage, onError });
    routePageMessage({ paseoFrame: "message", text: "from page" }, queue, { onMessage, onError });
    routePageMessage({ paseoFrame: "error", message: "bad" }, queue, { onMessage, onError });
    expect(sent).toEqual(["first"]);
    expect(onMessage).toHaveBeenCalledWith("from page");
    expect(onError).toHaveBeenCalledWith("bad");
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run (from `packages/app`): `npx vitest run src/plugins/react-native/script-frame-page.test.ts --bail=1`
Expected: FAIL, `Failed to resolve import "./script-frame-page"`.

- [ ] **Step 3: Write the page module.**

Create `packages/app/src/plugins/react-native/script-frame-page.ts`:

```ts
// The page a ScriptFrame runs a plugin's script in, and the messages between it and the app.
// Native and web build the same page; only how a message crosses differs. Nothing here touches
// the DOM: the app's unit tests load it in Node.

/** A `.invalid` name never resolves. It gives the native page an origin, so `localStorage` works. */
export const SCRIPT_FRAME_BASE_URL = "https://script-frame.invalid/";

export const SCRIPT_FRAME_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:";

export type FrameTransport = "native" | "web";

/** What the page tells the app. A plugin's own text rides inside `message`. */
export type PageMessage =
  | { paseoFrame: "ready" }
  | { paseoFrame: "message"; text: string }
  | { paseoFrame: "error"; message: string };

export function parsePageMessage(value: unknown): PageMessage | null {
  if (typeof value !== "object" || value === null) return null;
  const { paseoFrame, text, message } = value as Record<string, unknown>;
  if (paseoFrame === "ready") return { paseoFrame };
  if (paseoFrame === "message" && typeof text === "string") return { paseoFrame, text };
  if (paseoFrame === "error" && typeof message === "string") return { paseoFrame, message };
  return null;
}

const SEND: Record<FrameTransport, string> = {
  native: "window.ReactNativeWebView.postMessage(JSON.stringify(message))",
  web: 'window.parent.postMessage(message, "*")',
};

// On the web the app's text arrives by `message` events from the parent; on native the app calls
// `paseoFrame.onMessage` itself (see deliverScript).
const RECEIVE_WEB = `
  window.addEventListener("message", function (event) {
    var data = event.data;
    if (event.source !== window.parent || !data || data.paseoFrame !== "call") return;
    if (typeof frame.onMessage === "function") frame.onMessage(String(data.text));
  });`;

/** Defines `window.paseoFrame` and the error reports. Runs before the plugin's script. */
export function bootstrapSource(transport: FrameTransport): string {
  return `(function () {
  var send = function (message) { ${SEND[transport]}; };
  var frame = {
    onMessage: null,
    post: function (text) { send({ paseoFrame: "message", text: String(text) }); }
  };
  window.paseoFrame = frame;${transport === "web" ? RECEIVE_WEB : ""}
  window.addEventListener("error", function (event) {
    send({ paseoFrame: "error", message: String(event.message || "The script failed") });
  });
  window.addEventListener("unhandledrejection", function (event) {
    var reason = event.reason;
    send({ paseoFrame: "error", message: String((reason && reason.message) || reason) });
  });
  Object.defineProperty(window, "__paseoFrameReady", {
    configurable: true,
    value: function () { send({ paseoFrame: "ready" }); }
  });
})();`;
}

/** A script's text must not end its own tag, or open an HTML comment. */
function escapeScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}

/** Standards mode, the policy before any script, then the bootstrap, the plugin's script, ready. */
export function scriptFrameHtml(script: string, transport: FrameTransport): string {
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    `<meta http-equiv="Content-Security-Policy" content="${SCRIPT_FRAME_CSP}">` +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    "</head><body>" +
    `<script>${bootstrapSource(transport)}</script>` +
    `<script>${escapeScript(script)}</script>` +
    "<script>if (window.__paseoFrameReady) { window.__paseoFrameReady(); delete window.__paseoFrameReady; }</script>" +
    "</body></html>"
  );
}

/** The call a native frame injects to hand `text` to the page. */
export function deliverScript(text: string): string {
  return `(function () { var f = window.paseoFrame && window.paseoFrame.onMessage; if (typeof f === "function") f(${JSON.stringify(text)}); })(); true;`;
}

export interface PostQueue {
  post(text: string): void;
  ready(): void;
  reset(): void;
}

/** Posts wait until the page says it is ready, then go out in the order they were made. */
export function createPostQueue(deliver: (text: string) => void): PostQueue {
  let open = false;
  let waiting: string[] = [];
  return {
    post(text) {
      if (open) deliver(text);
      else waiting.push(text);
    },
    ready() {
      if (open) return;
      open = true;
      const out = waiting;
      waiting = [];
      for (const text of out) deliver(text);
    },
    reset() {
      open = false;
    },
  };
}

export function routePageMessage(
  message: PageMessage,
  queue: PostQueue,
  handlers: { onMessage(text: string): void; onError?(message: string): void },
): void {
  if (message.paseoFrame === "ready") queue.ready();
  else if (message.paseoFrame === "message") handlers.onMessage(message.text);
  else handlers.onError?.(message.message);
}
```

- [ ] **Step 4: Run it to see it pass.**

Run: `npx vitest run src/plugins/react-native/script-frame-page.test.ts --bail=1`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the Android frame.**

Nothing in `packages/app` mocks `react-native-webview` yet (only `document-frame/index.tsx`, `html-preview.tsx` and the Mermaid host import it, none has a test). This test is the first: a fake `WebView` that records its props and its injected scripts. It imports the native file by its full name, because vitest resolves `.web` first.

Create `packages/app/src/plugins/react-native/script-frame.native.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
// ScriptFrame on Android, with a fake WebView that records what the frame hands it.
import React, { act, createRef } from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptFrameHandle } from "@getpaseo/plugin/client/ui";
import { SCRIPT_FRAME_BASE_URL, SCRIPT_FRAME_CSP } from "./script-frame-page";
import { ScriptFrame } from "./script-frame.native";

const webview = vi.hoisted(() => ({
  props: null as Record<string, any> | null,
  injected: [] as string[],
}));

vi.mock("react-native-webview", async () => {
  const react = await import("react");
  const WebView = react.forwardRef((props: Record<string, any>, ref) => {
    webview.props = props;
    react.useImperativeHandle(ref, () => ({
      injectJavaScript: (code: string) => webview.injected.push(code),
    }));
    return react.createElement("div", { "data-testid": props.testID });
  });
  return { WebView };
});

beforeEach(() => {
  vi.stubGlobal("React", React);
  webview.props = null;
  webview.injected = [];
});
afterEach(cleanup);

/** What the page does: a message posted through ReactNativeWebView.postMessage. */
function fromPage(message: object): void {
  act(() => webview.props?.onMessage({ nativeEvent: { data: JSON.stringify(message) } }));
}

function mount(overrides: Partial<React.ComponentProps<typeof ScriptFrame>> = {}) {
  const handle = createRef<ScriptFrameHandle>();
  const onMessage = vi.fn();
  const onError = vi.fn();
  render(
    <ScriptFrame
      ref={handle}
      script="window.answer = 1;"
      title="Office in 3D"
      testID="frame"
      onMessage={onMessage}
      onError={onError}
      {...overrides}
    />,
  );
  return { handle, onMessage, onError };
}

describe("ScriptFrame on Android", () => {
  it("runs the script in a page of its own origin with the spec's settings", () => {
    mount();
    const props = webview.props!;
    expect(props.source.baseUrl).toBe(SCRIPT_FRAME_BASE_URL);
    expect(props.source.html).toContain("window.answer = 1;");
    expect(props.source.html).toContain(SCRIPT_FRAME_CSP);
    expect({
      javaScriptEnabled: props.javaScriptEnabled,
      domStorageEnabled: props.domStorageEnabled,
      allowFileAccess: props.allowFileAccess,
      allowFileAccessFromFileURLs: props.allowFileAccessFromFileURLs,
      setSupportMultipleWindows: props.setSupportMultipleWindows,
      javaScriptCanOpenWindowsAutomatically: props.javaScriptCanOpenWindowsAutomatically,
      thirdPartyCookiesEnabled: props.thirdPartyCookiesEnabled,
      mediaPlaybackRequiresUserAction: props.mediaPlaybackRequiresUserAction,
      accessibilityLabel: props.accessibilityLabel,
    }).toEqual({
      javaScriptEnabled: true,
      domStorageEnabled: true,
      allowFileAccess: false,
      allowFileAccessFromFileURLs: false,
      setSupportMultipleWindows: false,
      javaScriptCanOpenWindowsAutomatically: false,
      thirdPartyCookiesEnabled: false,
      mediaPlaybackRequiresUserAction: true,
      accessibilityLabel: "Office in 3D",
    });
  });

  it("allows the first load of its own address and nothing else", () => {
    mount();
    const allow = webview.props!.onShouldStartLoadWithRequest as (r: { url: string }) => boolean;
    expect(allow({ url: "https://example.com/" })).toBe(false);
    expect(allow({ url: SCRIPT_FRAME_BASE_URL })).toBe(true);
    expect(allow({ url: SCRIPT_FRAME_BASE_URL })).toBe(false);
  });

  it("holds posts until the page is ready, then injects them in order", () => {
    const { handle } = mount();
    act(() => {
      handle.current?.post("one");
      handle.current?.post("two");
    });
    expect(webview.injected).toEqual([]);
    fromPage({ paseoFrame: "ready" });
    expect(webview.injected).toHaveLength(2);
    expect(webview.injected[0]).toContain('f("one")');
    expect(webview.injected[1]).toContain('f("two")');
    act(() => handle.current?.post("three"));
    expect(webview.injected[2]).toContain('f("three")');
  });

  it("hands the page's text to onMessage and ignores what is not an envelope", () => {
    const { onMessage } = mount();
    fromPage({ paseoFrame: "message", text: "from the page" });
    act(() => webview.props?.onMessage({ nativeEvent: { data: "not json" } }));
    fromPage({ other: 1 });
    expect(onMessage.mock.calls).toEqual([["from the page"]]);
  });

  it("reports the page's own errors, a failed load and a dead renderer to onError", () => {
    const { onError } = mount();
    fromPage({ paseoFrame: "error", message: "boom" });
    act(() => webview.props?.onError({ nativeEvent: { description: "net::ERR_FAILED" } }));
    act(() => webview.props?.onRenderProcessGone({ nativeEvent: { didCrash: true } }));
    expect(onError.mock.calls).toEqual([
      ["boom"],
      ["net::ERR_FAILED"],
      ["The page's process ended"],
    ]);
  });

  it("waits again for ready when the script changes", () => {
    const { handle } = mount();
    fromPage({ paseoFrame: "ready" });
    cleanup();
    const next = createRef<ScriptFrameHandle>();
    render(<ScriptFrame ref={next} script="x" title="t" onMessage={() => undefined} />);
    act(() => next.current?.post("after reload"));
    expect(webview.injected).toEqual([]);
    expect(handle.current).toBeNull();
  });
});
```

- [ ] **Step 6: Run it to see it fail.**

Run: `npx vitest run src/plugins/react-native/script-frame.native.test.tsx --bail=1`
Expected: FAIL, `Failed to resolve import "./script-frame.native"`.

- [ ] **Step 7: Write the Android frame, the base file, the kit declaration and the export.**

Create `packages/app/src/plugins/react-native/script-frame.native.tsx`:

```tsx
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import { WebView, type WebViewMessageEvent } from "react-native-webview";
import type { ScriptFrameHandle, ScriptFrameProps } from "@getpaseo/plugin/client/ui";
import {
  SCRIPT_FRAME_BASE_URL,
  createPostQueue,
  deliverScript,
  parsePageMessage,
  routePageMessage,
  scriptFrameHtml,
} from "./script-frame-page";

const frameStyle = { flex: 1, backgroundColor: "transparent" };
const originWhitelist = [SCRIPT_FRAME_BASE_URL];

/**
 * Runs a plugin's script in a WebView with JavaScript and `localStorage` on and nothing else: no
 * files, no windows, no network (the page's policy), and no load after the first.
 */
export const ScriptFrame = forwardRef<ScriptFrameHandle, ScriptFrameProps>(function ScriptFrame(
  { script, onMessage, onError, title, testID },
  ref,
) {
  const webView = useRef<WebView | null>(null);
  const queue = useMemo(
    () => createPostQueue((text) => webView.current?.injectJavaScript(deliverScript(text))),
    [],
  );
  const html = useMemo(() => scriptFrameHtml(script, "native"), [script]);
  const source = useMemo(() => ({ html, baseUrl: SCRIPT_FRAME_BASE_URL }), [html]);
  const firstLoad = useRef(true);
  const handlers = useRef({ onMessage, onError });
  useEffect(() => {
    handlers.current = { onMessage, onError };
  });
  // A new script is a new page: it is not ready, and its first load is allowed again.
  useEffect(() => {
    queue.reset();
    firstLoad.current = true;
  }, [html, queue]);
  useImperativeHandle(ref, () => ({ post: queue.post }), [queue]);

  const allowLoad = useCallback((request: { url: string }) => {
    if (request.url !== SCRIPT_FRAME_BASE_URL || !firstLoad.current) return false;
    firstLoad.current = false;
    return true;
  }, []);
  const handleMessage = useCallback(
    (event: WebViewMessageEvent) => {
      let value: unknown;
      try {
        value = JSON.parse(event.nativeEvent.data);
      } catch {
        return;
      }
      const message = parsePageMessage(value);
      if (message === null) return;
      routePageMessage(message, queue, {
        onMessage: (text) => handlers.current.onMessage(text),
        onError: (text) => handlers.current.onError?.(text),
      });
    },
    [queue],
  );
  const handleError = useCallback((event: { nativeEvent: { description: string } }) => {
    handlers.current.onError?.(event.nativeEvent.description);
  }, []);
  const handleProcessGone = useCallback(() => {
    handlers.current.onError?.("The page's process ended");
  }, []);

  return (
    <WebView
      ref={webView}
      testID={testID}
      accessibilityLabel={title}
      style={frameStyle}
      source={source}
      originWhitelist={originWhitelist}
      onShouldStartLoadWithRequest={allowLoad}
      onMessage={handleMessage}
      onError={handleError}
      onRenderProcessGone={handleProcessGone}
      javaScriptEnabled
      domStorageEnabled
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      thirdPartyCookiesEnabled={false}
      mediaPlaybackRequiresUserAction
    />
  );
});
```

Create `packages/app/src/plugins/react-native/script-frame.tsx` (TypeScript resolves `./script-frame` here; Metro takes `.native.tsx` or `.web.tsx` first):

```tsx
export { ScriptFrame } from "./script-frame.native";
```

In `packages/app/src/plugins/react-native/ui.ts`, after `export { DocumentFrame } from "@/file-panels/document-frame";`:

```ts
export { ScriptFrame } from "./script-frame";
```

In `packages/plugin/src/client/ui.ts`, after the `DocumentFrame` declaration (line 211), and add `ForwardRefExoticComponent`, `RefAttributes` are already imported:

```ts
export interface ScriptFrameProps {
  /** JavaScript run once, in an empty standards-mode page with no network. */
  script: string;
  /** Text the page sent with `window.paseoFrame.post(text)`. */
  onMessage(text: string): void;
  /** The script threw, or the page could not start. */
  onError?(message: string): void;
  /** What a screen reader calls the frame. */
  title: string;
  testID?: string;
}
export interface ScriptFrameHandle {
  /** Sends text to `window.paseoFrame.onMessage`. Posts made before the page is ready wait, in order. */
  post(text: string): void;
}
/**
 * Runs your script in an isolated page and passes strings both ways. Apps older than Paseo 0.16.0
 * and the store build do not have it: check `"ScriptFrame" in ui`.
 */
export declare const ScriptFrame: ForwardRefExoticComponent<
  ScriptFrameProps & RefAttributes<ScriptFrameHandle>
>;
```

In `packages/app/src/plugins/evaluate.test.ts`, after the `"provides Paseo UI through @getpaseo/plugin/client/ui"` test (line 803):

```ts
it("provides ScriptFrame through @getpaseo/plugin/client/ui", () => {
  const plugin = evaluatePluginClientBundle(
    "example",
    `(function(require) {
        const ui = require("@getpaseo/plugin/client/ui");
        const module = { exports: {} };
        module.exports.default = function(plugin) {
          if (!("ScriptFrame" in ui) || ui.ScriptFrame === null || typeof ui.ScriptFrame !== "object") {
            throw new Error("ScriptFrame is missing");
          }
          plugin.addSurface("main", function Surface() { return null; });
          return function() {};
        };
        return module.exports;
      })`,
  );
  expect(plugin.surfaces.map((surface) => surface.id)).toEqual(["main"]);
});
```

- [ ] **Step 8: Run the tests to see them pass.**

Run (from `packages/app`): `npx vitest run src/plugins/react-native/script-frame.native.test.tsx --bail=1`, then `npx vitest run src/plugins/evaluate.test.ts --bail=1 -t "ScriptFrame"`
Expected: PASS each. The last test of the Android file reads `handle.current` after `cleanup()`; if it reports `null` differently on this React, drop the final `expect` and keep the one on `webview.injected`.

- [ ] **Step 9: Build the plugin package, typecheck, lint, format, commit.**

```bash
npm run build:plugin
npm run typecheck --workspace=@getpaseo/plugin
npm run typecheck --workspace=@getpaseo/app
npm run lint -- packages/plugin/src/client/ui.ts packages/app/src/plugins/react-native/script-frame-page.ts packages/app/src/plugins/react-native/script-frame.native.tsx packages/app/src/plugins/react-native/script-frame.tsx packages/app/src/plugins/react-native/ui.ts packages/app/src/plugins/react-native/script-frame-page.test.ts packages/app/src/plugins/react-native/script-frame.native.test.tsx packages/app/src/plugins/evaluate.test.ts
npm run format:files -- packages/plugin/src/client/ui.ts packages/app/src/plugins/react-native/script-frame-page.ts packages/app/src/plugins/react-native/script-frame.native.tsx packages/app/src/plugins/react-native/script-frame.tsx packages/app/src/plugins/react-native/ui.ts packages/app/src/plugins/react-native/script-frame-page.test.ts packages/app/src/plugins/react-native/script-frame.native.test.tsx packages/app/src/plugins/evaluate.test.ts
git add packages/plugin/src/client/ui.ts packages/app/src/plugins
git commit -m "feat(plugin): ScriptFrame runs a plugin's script in an isolated page on Android"
```

---

### Task 2: `ScriptFrame` on the web, and its reference

**Files:**

- Create: `packages/app/src/plugins/react-native/script-frame.web.tsx`
- Test: `packages/app/src/plugins/react-native/script-frame.web.browser.test.tsx` (new, real Chromium)
- Modify: `public-docs/plugins/reference.md` (a `### ScriptFrame` section after `### DocumentFrame`, line 1907 to 1924; the version paragraph at 1928)
- Modify: `public-docs/plugins/reference.zh-CN.md` (the same, after line 1590; the paragraph at 1594)
- Modify: `docs/plugins.md` (line 1557 and the views paragraph at 633)

**Interfaces:**

- Consumes: Task 1's `script-frame-page.ts` (`scriptFrameHtml`, `createPostQueue`, `parsePageMessage`, `routePageMessage`) and the kit's `ScriptFrameProps`, `ScriptFrameHandle`.
- Produces: `ScriptFrame` from `script-frame.web.tsx`, same props and handle.

- [ ] **Step 1: Write the failing browser test.** A real page in real Chromium: it proves the bootstrap, the sandbox and the policy, which a fake cannot.

Create `packages/app/src/plugins/react-native/script-frame.web.browser.test.tsx`:

```tsx
import React, { createRef } from "react";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ScriptFrameHandle } from "@getpaseo/plugin/client/ui";
import { ScriptFrame } from "./script-frame.web";

beforeEach(() => vi.stubGlobal("React", React));
afterEach(cleanup);

function mount(script: string) {
  const handle = createRef<ScriptFrameHandle>();
  const onMessage = vi.fn();
  const onError = vi.fn();
  render(
    <ScriptFrame
      ref={handle}
      script={script}
      title="A frame"
      onMessage={onMessage}
      onError={onError}
    />,
  );
  return { handle, onMessage, onError };
}

describe("ScriptFrame on the web", () => {
  it("delivers posts made before the page was ready, in order, and hears the replies", async () => {
    const { handle, onMessage } = mount(
      'window.paseoFrame.onMessage = (text) => window.paseoFrame.post("echo:" + text);',
    );
    handle.current?.post("a");
    handle.current?.post("b");
    await waitFor(() => expect(onMessage.mock.calls).toEqual([["echo:a"], ["echo:b"]]));
  });

  it("reports a script that throws", async () => {
    const { onError } = mount('throw new Error("boom");');
    await waitFor(() => expect(onError).toHaveBeenCalledWith(expect.stringContaining("boom")));
  });

  it("gives the page no storage: localStorage throws in the sandbox", async () => {
    const { onMessage } = mount(
      'try { window.localStorage.getItem("x"); window.paseoFrame.post("storage"); } catch (e) { window.paseoFrame.post("no storage"); }',
    );
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith("no storage"));
  });

  it("gives the page no network: the policy refuses a fetch", async () => {
    const { onMessage } = mount(
      'fetch("data:text/plain,x").then(() => window.paseoFrame.post("fetched"), () => window.paseoFrame.post("blocked"));',
    );
    await waitFor(() => expect(onMessage).toHaveBeenCalledWith("blocked"));
  });

  it("ignores a message that did not come from its own frame", async () => {
    const { onMessage } = mount("");
    window.postMessage({ paseoFrame: "message", text: "forged" }, "*");
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(onMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

Run (from `packages/app`): `npx vitest run --project browser src/plugins/react-native/script-frame.web.browser.test.tsx --bail=1`
Expected: FAIL, cannot resolve `./script-frame.web`.

- [ ] **Step 3: Write the web frame.**

Create `packages/app/src/plugins/react-native/script-frame.web.tsx`:

```tsx
import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef } from "react";
import type { ScriptFrameHandle, ScriptFrameProps } from "@getpaseo/plugin/client/ui";
import {
  createPostQueue,
  parsePageMessage,
  routePageMessage,
  scriptFrameHtml,
} from "./script-frame-page";

const frameStyle = {
  flex: 1,
  minHeight: 0,
  width: "100%",
  height: "100%",
  border: "none",
  backgroundColor: "transparent",
} as const;

/**
 * An iframe with `sandbox="allow-scripts"` and no same origin with Paseo, so the page has no
 * storage (`localStorage` throws) and cannot reach Paseo's page. Messages cross by `postMessage`,
 * and only those from this frame's own window are heard.
 */
export const ScriptFrame = forwardRef<ScriptFrameHandle, ScriptFrameProps>(function ScriptFrame(
  { script, onMessage, onError, title, testID },
  ref,
) {
  const element = useRef<HTMLIFrameElement | null>(null);
  const queue = useMemo(
    () =>
      createPostQueue((text) =>
        element.current?.contentWindow?.postMessage({ paseoFrame: "call", text }, "*"),
      ),
    [],
  );
  const html = useMemo(() => scriptFrameHtml(script, "web"), [script]);
  const handlers = useRef({ onMessage, onError });
  useEffect(() => {
    handlers.current = { onMessage, onError };
  });
  useEffect(() => {
    queue.reset();
  }, [html, queue]);
  useImperativeHandle(ref, () => ({ post: queue.post }), [queue]);

  useEffect(() => {
    function onWindowMessage(event: MessageEvent) {
      const frame = element.current;
      if (frame === null || event.source !== frame.contentWindow) return;
      const message = parsePageMessage(event.data);
      if (message === null) return;
      routePageMessage(message, queue, {
        onMessage: (text) => handlers.current.onMessage(text),
        onError: (text) => handlers.current.onError?.(text),
      });
    }
    window.addEventListener("message", onWindowMessage);
    return () => window.removeEventListener("message", onWindowMessage);
  }, [queue]);

  return (
    <iframe
      ref={element}
      title={title}
      data-testid={testID}
      srcDoc={html}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      style={frameStyle}
    />
  );
});
```

- [ ] **Step 4: Run the browser test to see it pass.**

Run: `npx vitest run --project browser src/plugins/react-native/script-frame.web.browser.test.tsx --bail=1`
Expected: PASS. If Chromium cannot start, stop and report; do not install a browser.

- [ ] **Step 5: Write the reference section.**

In `public-docs/plugins/reference.md`, insert between the `DocumentFrame` section and `### Version requirement and examples`:

```markdown
### ScriptFrame

Import `ScriptFrame` from `@getpaseo/plugin/client/ui` to run your own script in an isolated page
and pass text to it and back. Use it for what React Native cannot draw, such as a WebGL scene.

| Prop        | Required | Meaning                                                                |
| ----------- | -------- | ---------------------------------------------------------------------- |
| `script`    | Yes      | JavaScript, run once after an empty standards-mode page loads.         |
| `onMessage` | Yes      | Called with each string the page posts.                                |
| `onError`   | No       | Called with a message when the script throws or the page cannot start. |
| `title`     | Yes      | What a screen reader calls the frame.                                  |
| `testID`    | No       | Test identifier for the frame.                                         |

A ref gives `post(text)`, which sends a string to the page. Posts made before the page is ready
wait and are delivered in order. In the page, `window.paseoFrame.post(text)` sends and
`window.paseoFrame.onMessage = (text) => { ... }` receives. Only strings cross, so send JSON for
anything structured.

The page has no network: its policy is `default-src 'none'; script-src 'unsafe-inline';
style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:`. It has no
files, no navigation after its first load and no new windows.

| Platform | The page                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Android  | A WebView with JavaScript and `localStorage` on, under an origin of its own that never resolves. Tested.                     |
| Web      | A sandboxed `iframe` without `allow-same-origin`. `localStorage` throws there, so a script that needs it must check. Tested. |
| iOS      | The same WebView component as Android. Not tested.                                                                           |

Check for it before you render it: `"ScriptFrame" in ui`, with `import * as ui from
"@getpaseo/plugin/client/ui"`. Apps older than Paseo 0.16.0 and the store build do not have it, and
a plugin that works without it keeps its other view there. A plugin that cannot work without it
declares `"requirements": { "paseo": ">=0.16.0" }` instead.
```

(Run `npm run format:files` on the file afterwards; it aligns the tables.) In the same file, change the first sentence of "Version requirement and examples" from "File panels, `DocumentFrame`, and `Loading` require Paseo 0.13.0 or later." to keep that sentence and add after the `writeBytes` sentence: "`ScriptFrame` requires Paseo 0.16.0 or later." Do not change the declaration of 0.13.0.

In `public-docs/plugins/reference.zh-CN.md`, after the DocumentFrame section (line 1590), read `docs/website-i18n.md` "Chinese style" first, then insert:

```markdown
### ScriptFrame {#scriptframe}

从 `@getpaseo/plugin/client/ui` 导入 `ScriptFrame`，在隔离的页面中运行你自己的脚本，并与它互传文本。React Native 画不出来的内容（例如 WebGL 场景）可以用它。

| 属性        | 必填 | 含义                                           |
| ----------- | ---- | ---------------------------------------------- |
| `script`    | 是   | JavaScript，在空的标准模式页面加载后运行一次。 |
| `onMessage` | 是   | 页面每发送一个字符串就调用一次。               |
| `onError`   | 否   | 脚本抛出错误或页面无法启动时，以消息调用。     |
| `title`     | 是   | 屏幕阅读器对该框架的称呼。                     |
| `testID`    | 否   | 该框架的测试标识。                             |

通过 ref 可以调用 `post(text)`，向页面发送字符串。页面就绪之前的 `post` 会等待，并按顺序送达。在页面中，`window.paseoFrame.post(text)` 用于发送，`window.paseoFrame.onMessage = (text) => { ... }` 用于接收。只有字符串能够跨越边界，需要结构化数据时请发送 JSON。

页面没有网络，其策略为 `default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src data:`。页面没有文件访问，首次加载之后不能再导航，也不能打开新窗口。

| 平台    | 页面                                                                                                       |
| ------- | ---------------------------------------------------------------------------------------------------------- |
| Android | 启用 JavaScript 和 `localStorage` 的 WebView，使用一个永远无法解析的自有来源。已测试。                     |
| Web     | 不带 `allow-same-origin` 的沙箱 `iframe`。其中 `localStorage` 会抛出错误，需要它的脚本必须先检查。已测试。 |
| iOS     | 与 Android 相同的 WebView 组件。未测试。                                                                   |

渲染之前先检查：`"ScriptFrame" in ui`，其中 `import * as ui from "@getpaseo/plugin/client/ui"`。早于 Paseo 0.16.0 的应用和商店版本没有它；没有它也能工作的插件，在那里保留其他视图。必须依赖它的插件请声明 `"requirements": { "paseo": ">=0.16.0" }`。
```

and add "`ScriptFrame` 需要 Paseo 0.16.0 或更高版本。" after the `writeBytes` sentence of the version paragraph (line 1594).

In `docs/plugins.md` line 1557, change "the author API, selection, `DocumentFrame`, and the version requirement" to "the author API, selection, `DocumentFrame`, `ScriptFrame`, and the version requirement". Leave the views paragraph (line 633) for Task 5, which changes what it says.

- [ ] **Step 6: Typecheck, lint, format, commit.**

```bash
npm run typecheck --workspace=@getpaseo/app
npm run lint -- packages/app/src/plugins/react-native/script-frame.web.tsx packages/app/src/plugins/react-native/script-frame.web.browser.test.tsx
npm run format:files -- packages/app/src/plugins/react-native/script-frame.web.tsx packages/app/src/plugins/react-native/script-frame.web.browser.test.tsx public-docs/plugins/reference.md public-docs/plugins/reference.zh-CN.md docs/plugins.md
git add packages/app/src/plugins/react-native public-docs/plugins docs/plugins.md
git commit -m "feat(app): ScriptFrame on the web, and its reference"
```

---

### Task 3: Split the scene's feeding out of `world-view.tsx` (a pure refactor)

Runs in parallel with Tasks 1, 2, 4 and 6. It changes no behaviour: the web office reads the same, and the existing tests are the proof.

**Files:**

- Create: `plugins/office/client/world/use-world-feed.ts`
- Create: `plugins/office/client/world/world-view-shared.ts`
- Modify: `plugins/office/client/world/world-view.tsx`
- Test: `plugins/office/client/world/use-world-feed.mounted.test.tsx` (new), `plugins/office/client/world/world-view-shared.test.ts` (new); existing `world-view.mounted.test.tsx`, `use-incident-alarm.mounted.test.tsx`, `entry.test.ts`, `adapter.test.ts` must stay green.

**Interfaces:**

- Produces, `use-world-feed.ts`:

```ts
export const PLAN: WorldPlan; // "pro"
export interface WorldFeedInput {
  model: OfficeModel;
  theme: PluginTheme;
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  selectedAgentId: string | null;
  machine: Machine | null;
  meeting: boolean;
  incidents: IncidentsState | undefined;
}
/** Feeds a started scene. With `api` null nothing is sent. Returns the floor's note, if any. */
export function useWorldFeed(api: WorldApi | null, input: WorldFeedInput): { note: string | null };
```

- Produces, `world-view-shared.ts`:

```ts
/** What the scene's callbacks and its start read: always the last render's. */
export interface WorldLatest {
  model: OfficeModel;
  theme: PluginTheme;
  focusRoomId: string | null;
  selectedAgentId: string | null;
  onSelectAgent(agentId: string | null): void;
  onSelectBoard(roomId: string): void;
  onOpenMachine(): void;
  onOpenResources: (() => void) | undefined;
  onOpenSession: ((agentId: string) => void) | undefined;
  onOpenLibrary(): void;
  onOpenNotes(): void;
  onOpenIncidents(): void;
  onBell(): void | Promise<void>;
  onProblem(message: string): void;
}
export function worldStartOptions(
  latest: { readonly current: WorldLatest },
  extras: { focus(): void; brand: WorldBrand; photo?: false },
): WorldStartOptions;
export function useWorldScript(
  enabled: boolean,
  onProblem: (message: string) => void,
): string | null;
export function useStandupBell(): () => Promise<void>;
```

- [ ] **Step 1: Run the existing tests first and note they pass.**

Run from `plugins/`, one at a time: `npx vitest run office/client/world/world-view.mounted.test.tsx --bail=1`, `npx vitest run office/client/world/use-incident-alarm.mounted.test.tsx --bail=1`, `npx vitest run office/client/world/adapter.test.ts --bail=1`.
Expected: PASS each (the baseline).

- [ ] **Step 2: Write the failing tests.**

Create `plugins/office/client/world/world-view-shared.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import type { OfficeModel } from "../../shared/model.js";
import { worldStartOptions, type WorldLatest } from "./world-view-shared.js";

vi.mock("@getpaseo/plugin/client", () => ({ useRpc: () => async () => ({}) }));
vi.mock("@getpaseo/plugin/client/ui", () => ({ useToast: () => ({ error: () => undefined }) }));

const MODEL: OfficeModel = {
  rooms: [],
  attention: [],
  agentTasks: [],
  agents: new Map(),
  roomOfAgent: new Map(),
  waitingOn: new Map(),
};

function latest(overrides: Partial<WorldLatest> = {}): { current: WorldLatest } {
  return {
    current: {
      model: MODEL,
      theme: { colors: new Proxy({}, { get: () => "#808080" }) } as never,
      focusRoomId: null,
      selectedAgentId: null,
      onSelectAgent: vi.fn(),
      onSelectBoard: vi.fn(),
      onOpenMachine: vi.fn(),
      onOpenResources: undefined,
      onOpenSession: undefined,
      onOpenLibrary: vi.fn(),
      onOpenNotes: vi.fn(),
      onOpenIncidents: vi.fn(),
      onBell: vi.fn(),
      onProblem: vi.fn(),
      ...overrides,
    },
  };
}

const BRAND = { name: "Paseo", logoUrl: null };

test("a person chosen takes the keyboard; a card closed leaves it", () => {
  const focus = vi.fn();
  const now = latest();
  const options = worldStartOptions(now, { focus, brand: BRAND });
  options.onSelect(null);
  expect(focus).not.toHaveBeenCalled();
  options.onSelect("a1");
  expect(focus).toHaveBeenCalledTimes(1);
  expect(now.current.onSelectAgent).toHaveBeenNthCalledWith(1, null);
  expect(now.current.onSelectAgent).toHaveBeenNthCalledWith(2, "a1");
});

test("the bell opens nothing of Paseo's, so the keyboard stays in the office", () => {
  const focus = vi.fn();
  const now = latest();
  worldStartOptions(now, { focus, brand: BRAND }).onBell?.();
  expect(now.current.onBell).toHaveBeenCalledTimes(1);
  expect(focus).not.toHaveBeenCalled();
});

test("onOpen and onResources are given only where Paseo can open them", () => {
  const without = worldStartOptions(latest(), { focus: vi.fn(), brand: BRAND });
  expect("onOpen" in without).toBe(false);
  expect("onResources" in without).toBe(false);
  const openSession = vi.fn();
  const openResources = vi.fn();
  const focus = vi.fn();
  const now = latest({ onOpenSession: openSession, onOpenResources: openResources });
  const given = worldStartOptions(now, { focus, brand: BRAND });
  given.onOpen?.("a1");
  given.onResources?.();
  expect(openSession).toHaveBeenCalledWith("a1");
  expect(openResources).toHaveBeenCalledTimes(1);
  expect(focus).toHaveBeenCalledTimes(2);
});

test("the plan, the brand and the colours are the scene's start", () => {
  const options = worldStartOptions(latest(), { focus: vi.fn(), brand: BRAND });
  expect({ plan: options.plan, brand: options.brand, dark: typeof options.dark }).toEqual({
    plan: "pro",
    brand: BRAND,
    dark: "boolean",
  });
});

test("photo is passed through only when the caller says it", () => {
  const web = worldStartOptions(latest(), { focus: vi.fn(), brand: BRAND });
  const native = worldStartOptions(latest(), { focus: vi.fn(), brand: BRAND, photo: false });
  expect([web.photo, native.photo]).toEqual([undefined, false]);
});

test("a problem the scene reports goes to the latest handler", () => {
  const now = latest();
  const options = worldStartOptions(now, { focus: vi.fn(), brand: BRAND });
  const later = vi.fn();
  now.current = { ...now.current, onProblem: later };
  options.onProblem("the graphics context was lost");
  expect(later).toHaveBeenCalledWith("the graphics context was lost");
});
```

Create `plugins/office/client/world/use-world-feed.mounted.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
// What the hook sends a started scene, with a recording stand-in for the scene's API.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeModel } from "../../shared/model.js";
import { useWorldFeed, type WorldFeedInput } from "./use-world-feed.js";
import type { WorldApi } from "./world-api.js";

vi.mock("@getpaseo/plugin/client", () => ({
  useSettings: () => ({ status: "loading" }),
}));
vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const MODEL: OfficeModel = {
  rooms: [],
  attention: [],
  agentTasks: [],
  agents: new Map(),
  roomOfAgent: new Map(),
  waitingOn: new Map(),
};
const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function input(overrides: Partial<WorldFeedInput> = {}): WorldFeedInput {
  return {
    model: MODEL,
    theme: THEME,
    focusRoomId: null,
    focusRequest: null,
    selectedAgentId: null,
    machine: null,
    meeting: false,
    incidents: undefined,
    ...overrides,
  };
}

function fakeScene() {
  const calls: string[] = [];
  const api = new Proxy({} as WorldApi, {
    get:
      (_, name: string) =>
      (...args: unknown[]) =>
        calls.push(`${name}:${JSON.stringify(args)}`),
  });
  return { api, calls };
}

let container: HTMLElement;
let root: Root;
let note: string | null = "unset";

function Probe(props: { api: WorldApi | null; feed: WorldFeedInput }) {
  note = useWorldFeed(props.api, props.feed).note;
  return null;
}

beforeEach(() => {
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

test("sends nothing while there is no scene", async () => {
  await act(async () => root.render(<Probe api={null} feed={input()} />));
  expect(note).toBeNull();
});

test("seats the people, writes the board, sets the machine and the selection once the scene starts", async () => {
  const { api, calls } = fakeScene();
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  const names = calls.map((call) => call.split(":")[0]);
  expect(names).toEqual(
    expect.arrayContaining(["setTheme", "setSessions", "setBoardRows", "setMachine", "select"]),
  );
  expect(calls).toContain("setSessions:[[]]");
  expect(calls).toContain("setMachine:[null]");
  expect(calls).toContain("select:[null]");
});

test("follows the selection and the stand-up", async () => {
  const { api, calls } = fakeScene();
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  await act(async () => root.render(<Probe api={api} feed={input({ selectedAgentId: "a1" })} />));
  await act(async () =>
    root.render(<Probe api={api} feed={input({ selectedAgentId: "a1", meeting: true })} />),
  );
  expect(calls).toContain('select:["a1"]');
  expect(calls).toContain("meet:[]");
});

test("a request for a person is sent once", async () => {
  const { api, calls } = fakeScene();
  const request = { agentId: "a2", nonce: 1 };
  await act(async () => root.render(<Probe api={api} feed={input()} />));
  await act(async () => root.render(<Probe api={api} feed={input({ focusRequest: request })} />));
  await act(async () => root.render(<Probe api={api} feed={input({ focusRequest: request })} />));
  expect(calls.filter((call) => call === 'select:["a2"]')).toHaveLength(1);
});
```

- [ ] **Step 3: Run them to see them fail.**

Run: `cd plugins && npx vitest run office/client/world/world-view-shared.test.ts --bail=1`, then `npx vitest run office/client/world/use-world-feed.mounted.test.tsx --bail=1`
Expected: FAIL, the modules do not exist.

- [ ] **Step 4: Write `use-world-feed.ts`.** The effects are moved from `world-view.tsx` as they are (lines 285 to 352 of the current file): the theme, the people with their rests and events, the incident alarm, the machine, the team focus, the selection, the meeting, the chat's meeting word, and the request. `api` replaces the `world` ref and the `started` flag; the ref stays inside for `useIncidentAlarm`, whose signature does not change.

```ts
import { useEffect, useMemo, useRef } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import type { IncidentsState, Machine } from "../../shared/contracts.js";
import type { OfficeModel } from "../../shared/model.js";
import { onChatAct } from "../chat-acts.js";
import type { FocusRequest } from "../focus-request.js";
import { NO_RESTS, restsAfter, type Rests } from "../pixel/actors.js";
import {
  PLAN_DESKS,
  floorNote,
  isDarkTheme,
  teamOfRoom,
  worldBoardRows,
  worldChanges,
  worldMachine,
  worldPeople,
  withRestTimes,
  type WorldMemory,
  type WorldPlan,
} from "./adapter.js";
import { useIncidentAlarm } from "./use-incident-alarm.js";
import type { WorldApi } from "./world-api.js";

/** The floor everyone works on. The other plan, one open room, has fewer desks. */
export const PLAN: WorldPlan = "pro";

export interface WorldFeedInput {
  model: OfficeModel;
  theme: PluginTheme;
  /** The workspace tab's room; the view starts on its team's desks. */
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  /** Whose card is open; the scene marks that person and looks at them. */
  selectedAgentId: string | null;
  /** The host's readings; null when the host has none, and then the server room is furniture. */
  machine: Machine | null;
  /** The stand-up is open: the bell on the meeting table rings once. */
  meeting: boolean;
  incidents: IncidentsState | undefined;
}

/**
 * Feeds a started scene: the people, their events, the board, the machine, the incidents, the
 * theme, the selection and the meeting. `api` is null until the scene has started, and again
 * after it is gone; nothing is sent then. The effects list `api` so the render that starts the
 * scene runs them in the order they are written: the people are seated before the view looks at
 * any. Returns the note about the floor, if any.
 */
export function useWorldFeed(
  api: WorldApi | null,
  {
    model,
    theme,
    focusRoomId,
    focusRequest,
    selectedAgentId,
    machine,
    meeting,
    incidents,
  }: WorldFeedInput,
): { note: string | null } {
  const world = useRef<WorldApi | null>(null);
  const memory = useRef<WorldMemory | null>(null);
  // Since when each person rests: the scene sends home whoever rested 30 minutes after 21:00.
  const rests = useRef<Rests>(NO_RESTS);
  useEffect(() => {
    world.current = api;
    return () => {
      world.current = null;
      memory.current = null;
    };
  }, [api]);

  useEffect(() => {
    if (api === null) return;
    world.current?.setTheme({ dark: isDarkTheme(theme.colors), colors: theme.colors });
  }, [theme, api]);

  const people = useMemo(() => worldPeople(model, PLAN_DESKS[PLAN]), [model]);
  useEffect(() => {
    const scene = world.current;
    if (scene === null) return;
    rests.current = restsAfter(rests.current, people.sessions, Date.now());
    scene.setSessions(withRestTimes(people.sessions, rests.current));
    scene.setBoardRows(worldBoardRows(model, people.sessions));
    const changes = worldChanges(memory.current, people);
    for (const event of changes.events) scene.event(event);
    memory.current = changes.memory;
  }, [people, model, api]);

  // After the people: the alarm's bubbles go over whoever is seated at work.
  useIncidentAlarm({ world, started: api !== null, incidents });

  const worldReadings = useMemo(() => worldMachine(machine), [machine]);
  useEffect(() => {
    world.current?.setMachine(worldReadings);
  }, [worldReadings, api]);

  const focusTeam = useMemo(() => teamOfRoom(model, focusRoomId), [model, focusRoomId]);
  useEffect(() => {
    if (focusTeam !== null) world.current?.focusProject(focusTeam);
  }, [focusTeam, api]);

  useEffect(() => {
    world.current?.select(selectedAgentId);
  }, [selectedAgentId, api]);

  useEffect(() => {
    if (meeting) world.current?.meet?.();
  }, [meeting, api]);

  useEffect(
    () =>
      onChatAct((what) => {
        if (what === "meeting") world.current?.gather?.();
      }),
    [],
  );

  // A request that was already there when this view appeared was made for the list view.
  const handledNonce = useRef(focusRequest?.nonce ?? 0);
  useEffect(() => {
    if (focusRequest === null || focusRequest.nonce === handledNonce.current) return;
    handledNonce.current = focusRequest.nonce;
    world.current?.select(focusRequest.agentId);
  }, [focusRequest]);

  return { note: floorNote(model.agents.size, people.overflow) };
}
```

(The `useEffect` that sets `world.current` is declared first, so on the render that gives `api` it runs before the effects below it.)

- [ ] **Step 5: Write `world-view-shared.ts`.** `worldStartOptions` is the object that `world-view.tsx` passes to `api.start` today (lines 241 to 291), with `focusApp` replaced by `extras.focus` and `PLAN` imported; the hooks are the load effect (lines 223 to 234) and the bell (lines 158 to 166).

```ts
import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { useToast } from "@getpaseo/plugin/client/ui";
import { notesWriteRpc, worldRpc } from "../../shared/contracts.js";
import type { OfficeModel } from "../../shared/model.js";
import { failureText } from "../action-button.js";
import { boardRoom, isDarkTheme } from "./adapter.js";
import { PLAN } from "./use-world-feed.js";
import type { WorldBrand, WorldStartOptions } from "./world-api.js";
import { sharedWorldLoader } from "./world-loader.js";

export interface WorldLatest {
  model: OfficeModel;
  theme: PluginTheme;
  focusRoomId: string | null;
  selectedAgentId: string | null;
  onSelectAgent(agentId: string | null): void;
  onSelectBoard(roomId: string): void;
  onOpenMachine(): void;
  onOpenResources: (() => void) | undefined;
  onOpenSession: ((agentId: string) => void) | undefined;
  onOpenLibrary(): void;
  onOpenNotes(): void;
  onOpenIncidents(): void;
  onBell(): void | Promise<void>;
  onProblem(message: string): void;
}

/**
 * The scene's start, read from the last render. What a callback opens is Paseo's (a card, a sheet):
 * the keyboard goes with it through `extras.focus`. The bell opens nothing of Paseo's, and a card
 * closed from the scene opens nothing, so neither takes the keyboard.
 */
export function worldStartOptions(
  latest: { readonly current: WorldLatest },
  extras: { focus(): void; brand: WorldBrand; photo?: false },
): WorldStartOptions {
  const { focus } = extras;
  const { colors } = latest.current.theme;
  return {
    plan: PLAN,
    dark: isDarkTheme(colors),
    colors,
    brand: extras.brand,
    ...(extras.photo === undefined ? {} : { photo: extras.photo }),
    onSelect: (agentId) => {
      if (agentId !== null) focus();
      latest.current.onSelectAgent(agentId);
    },
    onBoard: (project) => {
      focus();
      const now = latest.current;
      const roomId = boardRoom(now.model, {
        project,
        focusRoomId: now.focusRoomId,
        selectedAgentId: now.selectedAgentId,
      });
      if (roomId !== null) now.onSelectBoard(roomId);
    },
    onMachine: () => {
      focus();
      latest.current.onOpenMachine();
    },
    onLibrary: () => {
      focus();
      latest.current.onOpenLibrary();
    },
    // Given only where Paseo can show Resources: otherwise the scene keeps the wall screen on
    // onMachine, the Host card.
    ...(latest.current.onOpenResources === undefined
      ? {}
      : {
          onResources: () => {
            focus();
            latest.current.onOpenResources?.();
          },
        }),
    // Given only where the office can open a session (the agent card's "Open session"): otherwise
    // a person under E is chosen, as a click does. The keyboard goes with the session.
    ...(latest.current.onOpenSession === undefined
      ? {}
      : {
          onOpen: (agentId: string) => {
            focus();
            latest.current.onOpenSession?.(agentId);
          },
        }),
    onBell: () => void latest.current.onBell(),
    onNotes: () => {
      focus();
      latest.current.onOpenNotes();
    },
    onIncidents: () => {
      focus();
      latest.current.onOpenIncidents();
    },
    onProblem: (message) => latest.current.onProblem(message),
  };
}

const subscribe = (listener: () => void) => sharedWorldLoader.subscribe(listener);
const read = () => sharedWorldLoader.state();

/**
 * The office's script, loaded once per page. Nothing loads while `enabled` is false (a tab that was
 * never shown has no size). After a failed load the loader keeps its failure until asked again, so
 * the answer is read after this load, not from the render's state.
 */
export function useWorldScript(
  enabled: boolean,
  onProblem: (message: string) => void,
): string | null {
  const loadState = useSyncExternalStore(subscribe, read, read);
  const fetchWorld = useRpc(worldRpc);
  const fetchScript = useCallback(() => fetchWorld({}), [fetchWorld]);
  const problem = useRef(onProblem);
  useEffect(() => {
    problem.current = onProblem;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    let mounted = true;
    async function load(): Promise<void> {
      await sharedWorldLoader.load(fetchScript);
      const state = sharedWorldLoader.state();
      if (mounted && state.status === "failed") problem.current(state.error);
    }
    void load();
    return () => {
      mounted = false;
    };
  }, [fetchScript, enabled]);
  return loadState.status === "ready" ? loadState.script : null;
}

/**
 * A click on the bell has the stand-up notes written. Whether a writer started is not waited for:
 * the Stand-up card's line says what the writer does.
 */
export function useStandupBell(): () => Promise<void> {
  const writeNotes = useRpc(notesWriteRpc);
  const toast = useToast();
  return useCallback(async () => {
    try {
      await writeNotes({});
    } catch (error) {
      toast.error(failureText("Write the stand-up notes", error));
    }
  }, [writeNotes, toast]);
}
```

`WorldStartOptions` has no `photo` yet. Add it now to `world-api.ts` (Task 4 uses it), after `onToast`:

```ts
  /** False hides Photo mode: a WebView cannot keep a download. Absent: Photo mode is offered. */
  photo?: boolean;
```

- [ ] **Step 6: Run the new tests to see them pass.**

Run: `cd plugins && npx vitest run office/client/world/world-view-shared.test.ts --bail=1`, then `npx vitest run office/client/world/use-world-feed.mounted.test.tsx --bail=1`
Expected: PASS each.

- [ ] **Step 7: Move `world-view.tsx` onto them.** In `world-view.tsx`:

- Delete the `PLAN` constant, the `subscribe`/`read` lines, the `onBell` callback, the `rests`, `memory` and `world` refs, the `started` state, every feed effect after the frame effect, and the `people` memo. Import `PLAN` is not needed any more.
- Replace `const [started, setStarted] = useState(false)` and the `world` ref with `const [api, setApi] = useState<WorldApi | null>(null)`.
- `const onBell = useStandupBell();` and keep `latest` as it is (its type is `WorldLatest`; import the type and annotate `useRef<WorldLatest>`).
- `const script = useWorldScript(sized, onProblem);` replaces the `loadState`, `fetchWorld`, `fetchScript` and the load effect.
- In the frame effect, `api.start(worldStartOptions(latest, { focus: focusApp, brand: worldBrand(readBrand()) }))` replaces the inline object (keep the `try/catch` and the "Read when the office starts" comment on the brand). Replace `world.current = api; setStarted(true);` with `setApi(api);` and the cleanup's `world.current = null; memory.current = null; setStarted(false);` with `setApi(null);`. Rename the inner `start(api)` parameter to `scene` so it does not shadow the state.
- After the effects: `const { note } = useWorldFeed(api, { model, theme, focusRoomId, focusRequest, selectedAgentId, machine, meeting, incidents });` and in the JSX use `api === null` where `started` was tested.
- Remove the imports that are unused now (`useCallback`, `useMemo`, `useSyncExternalStore`, `useRpc`, `useToast`, `notesWriteRpc`, `worldRpc`, `failureText`, `onChatAct`, `NO_RESTS`, `restsAfter`, `Rests`, the adapter names that moved, `useIncidentAlarm`, `sharedWorldLoader`). Keep `messageOf` from `./world-loader.js`, `readBrand` from `../web-env.web.js` and `focusApp, openWorldFrame` from `./world-frame.web.js`, so `world-view.mounted.test.tsx`'s mocks of those three modules still apply.

- [ ] **Step 8: The baseline tests again.**

Run from `plugins/`, one at a time: `npx vitest run office/client/world/world-view.mounted.test.tsx --bail=1`, `npx vitest run office/client/world/use-incident-alarm.mounted.test.tsx --bail=1`, `npx vitest run office/client/world/adapter.test.ts --bail=1`, `npx vitest run office/client/world/entry.test.ts --bail=1`
Expected: PASS each, unchanged. If `world-view.mounted.test.tsx` fails because its `@getpaseo/plugin/client` mock lacks something `useWorldFeed` now reads, add that to the mock (the hook reads `useSettings` through `useIncidentAlarm`, which the mock already has); do not change an assertion.

- [ ] **Step 9: Typecheck, lint, format, commit.**

```bash
npm run build:plugin
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/client/world/use-world-feed.ts plugins/office/client/world/world-view-shared.ts plugins/office/client/world/world-view.tsx plugins/office/client/world/world-api.ts plugins/office/client/world/use-world-feed.mounted.test.tsx plugins/office/client/world/world-view-shared.test.ts
npm run format:files -- plugins/office/client/world/use-world-feed.ts plugins/office/client/world/world-view-shared.ts plugins/office/client/world/world-view.tsx plugins/office/client/world/world-api.ts plugins/office/client/world/use-world-feed.mounted.test.tsx plugins/office/client/world/world-view-shared.test.ts
git add plugins/office/client/world
git commit -m "feat(office): the scene's feeding moves into a hook the native view can share"
```

---

### Task 4: The bridge, the page's script and Photo mode's switch

Runs in parallel with Tasks 1, 2, 3 and 6 (it needs only `WorldApi`; the `photo` field of `WorldStartOptions` is added in Task 3 Step 5, so add it here too if Task 4 goes first: it is the same two lines, and a merge keeps one).

**Files:**

- Create: `plugins/office/client/world/world-bridge.ts`
- Create: `plugins/office/client/world/world-bridge-page.ts`
- Modify: `plugins/office/vendor/my-office/src/office/paseo-host.js`, `paseo-entry.js` (`start`), `ui/photo.js`
- Test: `plugins/office/client/world/world-bridge.test.ts` (new), `plugins/office/client/world/world-bridge-page.test.ts` (new), `plugins/office/client/world/photo.test.ts` (new), `plugins/office/client/world/entry.test.ts` (one test)

**Interfaces:**

- Produces, `world-bridge.ts`:

```ts
/** From the plugin to the page. */
export interface BridgeCall {
  call: string;
  args: unknown[];
}
/** From the page to the plugin. */
export type BridgeReply = { callback: string; args: unknown[] } | { problem: string };
export interface WorldBridge {
  /** The scene's API, as the view sees it; every call goes to the page as a message. */
  api: WorldApi;
  /** Feed it what the page posted (a string). Anything that is not a reply is ignored. */
  receive(text: string): void;
}
export function createWorldBridge(post: (text: string) => void): WorldBridge;
```

- Produces, `world-bridge-page.ts`:

```ts
/** The page's script: the bridge's page side, then `scene` guarded, then the version check. */
export function bridgePageScript(scene: string): string;
```

- Consumes: `WorldApi`, `WorldStartOptions`, `WORLD_API_VERSION` from `world-api.ts`.

- [ ] **Step 1: Write the failing tests.**

Create `plugins/office/client/world/world-bridge.test.ts`:

```ts
import { expect, test, vi } from "vitest";
import { createWorldBridge } from "./world-bridge.js";
import type { WorldStartOptions } from "./world-api.js";

function bridge() {
  const posted: { call: string; args: unknown[] }[] = [];
  const made = createWorldBridge((text) => posted.push(JSON.parse(text)));
  return { ...made, posted };
}

function options(extra: Partial<WorldStartOptions> = {}): WorldStartOptions {
  return {
    plan: "pro",
    dark: false,
    colors: {} as WorldStartOptions["colors"],
    onSelect: () => undefined,
    onBoard: () => undefined,
    onProblem: () => undefined,
    ...extra,
  };
}

test("calls go to the page in the order they were made, each with its arguments", () => {
  const { api, posted } = bridge();
  api.setSessions([]);
  api.select("a1");
  api.event({ sess: "a1", type: "edit" });
  api.focusProject("team");
  api.setMachine(null);
  expect(posted).toEqual([
    { call: "setSessions", args: [[]] },
    { call: "select", args: ["a1"] },
    { call: "event", args: [{ sess: "a1", type: "edit" }] },
    { call: "focusProject", args: ["team"] },
    { call: "setMachine", args: [null] },
  ]);
});

test("the optional calls and the theme and the board rows go too", () => {
  const { api, posted } = bridge();
  api.setTheme({ dark: true, colors: {} as never });
  api.setBoardRows([]);
  api.setIncidents?.([]);
  api.meet?.();
  api.gather?.();
  expect(posted.map((message) => message.call)).toEqual([
    "setTheme",
    "setBoardRows",
    "setIncidents",
    "meet",
    "gather",
  ]);
});

test("start sends its options without the callbacks, and the names of those given", () => {
  const { api, posted } = bridge();
  api.start(options({ onOpen: () => undefined, photo: false }));
  const [start] = posted;
  const sent = start.args[0] as Record<string, unknown>;
  expect(start.call).toBe("start");
  expect(sent.plan).toBe("pro");
  expect(sent.photo).toBe(false);
  expect(sent.callbacks).toEqual(["onSelect", "onBoard", "onProblem", "onOpen"]);
  expect(Object.keys(sent).filter((key) => key.startsWith("on"))).toEqual([]);
});

test("a callback the page posts calls the real one with its arguments", () => {
  const { api, receive } = bridge();
  const onSelect = vi.fn();
  const onBoard = vi.fn();
  api.start(options({ onSelect, onBoard }));
  receive(JSON.stringify({ callback: "onSelect", args: ["a1"] }));
  receive(JSON.stringify({ callback: "onBoard", args: [null] }));
  expect(onSelect).toHaveBeenCalledWith("a1");
  expect(onBoard).toHaveBeenCalledWith(null);
});

test("a problem the page reports goes to onProblem", () => {
  const { api, receive } = bridge();
  const onProblem = vi.fn();
  api.start(options({ onProblem }));
  receive(JSON.stringify({ problem: "Unexpected office build" }));
  expect(onProblem).toHaveBeenCalledWith("Unexpected office build");
});

test("text that is not a reply, and a callback nobody gave, are ignored", () => {
  const { api, receive } = bridge();
  const onSelect = vi.fn();
  api.start(options({ onSelect }));
  receive("not json");
  receive(JSON.stringify({ callback: "onOpen", args: ["a1"] }));
  receive(JSON.stringify({ other: true }));
  expect(onSelect).not.toHaveBeenCalled();
});

test("a logo that is not a data URL is dropped, and the sign shows the name alone", () => {
  const { api, posted } = bridge();
  api.start(options({ brand: { name: "Acme", logoUrl: "https://example.com/logo.png" } }));
  api.start(options({ brand: { name: "Acme", logoUrl: "data:image/png;base64,AAAA" } }));
  expect(posted.map((message) => (message.args[0] as { brand: unknown }).brand)).toEqual([
    { name: "Acme", logoUrl: null },
    { name: "Acme", logoUrl: "data:image/png;base64,AAAA" },
  ]);
});

test("stop sends its message", () => {
  const { api, posted } = bridge();
  api.stop();
  expect(posted).toEqual([{ call: "stop", args: [] }]);
});

test("the bridge speaks the contract's version", () => {
  expect(bridge().api.version).toBe(1);
});
```

Create `plugins/office/client/world/world-bridge-page.test.ts`. It runs the page's script in jsdom with a stand-in `paseoFrame` and a stand-in scene, as the real page would: `ScriptFrame`'s bootstrap has set `window.paseoFrame` before this script runs.

```ts
// @vitest-environment jsdom
import { beforeEach, expect, test } from "vitest";
import { bridgePageScript } from "./world-bridge-page.js";

interface Frame {
  post(text: string): void;
  onMessage: ((text: string) => void) | null;
}
let posted: unknown[];
let frame: Frame;

beforeEach(() => {
  posted = [];
  frame = { post: (text) => posted.push(JSON.parse(text)), onMessage: null };
  Reflect.set(window, "paseoFrame", frame);
  Reflect.deleteProperty(window, "PaseoOfficeWorld");
});

/** What the plugin sends: one string per call. */
function send(call: string, ...args: unknown[]): void {
  frame.onMessage?.(JSON.stringify({ call, args }));
}

const SCENE = `
  window.sceneLog = [];
  window.PaseoOfficeWorld = {
    version: 1,
    start(options) { window.sceneLog.push(["start", options]); },
    setSessions(list) { window.sceneLog.push(["setSessions", list]); },
    select(id) { window.sceneLog.push(["select", id]); },
    stop() { window.sceneLog.push(["stop"]); },
  };`;

function run(scene: string): void {
  new Function(bridgePageScript(scene))();
}
const log = () => Reflect.get(window, "sceneLog") as unknown[][];

test("each message calls PaseoOfficeWorld, in order", () => {
  run(SCENE);
  send("setSessions", [{ id: "a1" }]);
  send("select", "a1");
  expect(log()).toEqual([
    ["setSessions", [{ id: "a1" }]],
    ["select", "a1"],
  ]);
});

test("start gets stand-ins for the callbacks it was told of, and no others", () => {
  run(SCENE);
  send("start", { plan: "pro", callbacks: ["onSelect", "onProblem"] });
  const [, options] = log()[0] as [string, Record<string, unknown>];
  expect(Object.keys(options).sort()).toEqual(["onProblem", "onSelect", "plan"]);
  (options.onSelect as (id: string) => void)("a1");
  (options.onProblem as (text: string) => void)("lost");
  expect(posted).toEqual([
    { callback: "onSelect", args: ["a1"] },
    { callback: "onProblem", args: ["lost"] },
  ]);
});

test("a scene script that throws is a problem", () => {
  run('throw new Error("scene broke");');
  expect(posted).toEqual([{ problem: "scene broke" }]);
});

test("no PaseoOfficeWorld, or one of another version, is a problem", () => {
  run("window.other = 1;");
  expect(posted).toEqual([{ problem: "Unexpected office build" }]);
  posted.length = 0;
  Reflect.deleteProperty(window, "PaseoOfficeWorld");
  run("window.PaseoOfficeWorld = { version: 2 };");
  expect(posted).toEqual([{ problem: "Unexpected office build" }]);
});

test("a call the scene refuses, such as start with no WebGL, is a problem with its message", () => {
  run(
    `window.PaseoOfficeWorld = { version: 1, start() { throw new Error("WebGL2 is not available"); } };`,
  );
  send("start", { callbacks: [] });
  expect(posted).toEqual([{ problem: "WebGL2 is not available" }]);
});

test("a message that is not a call, or names no method, does nothing", () => {
  run(SCENE);
  frame.onMessage?.("not json");
  send("nothingByThisName");
  expect(log()).toEqual([]);
  expect(posted).toEqual([]);
});

test("Full screen is off in the page whatever the WebView says", () => {
  run(SCENE);
  expect(document.fullscreenEnabled).toBe(false);
});
```

Create `plugins/office/client/world/photo.test.ts`, the pattern of `camera-bar.test.ts` (the scene's modules photo mode imports are stood in with plain objects):

```ts
// @vitest-environment jsdom
// Photo mode's switch (ui/photo.js): a host that says photo is false has no button and no P key.
import { beforeEach, expect, test, vi } from "vitest";

const h = vi.hoisted(() => ({ host: { photo: true, brandName: "", toast: () => undefined } }));

vi.mock("../../vendor/my-office/src/office/paseo-host.js", () => ({ host: h.host }));
vi.mock("../../vendor/my-office/src/office/core/state.js", () => ({ state: {} }));
vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  $: (id: string) => document.getElementById(id),
  stage: document.createElement("div"),
}));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({
  SOFTWARE_GL: false,
  camera: {},
  composer: {},
  controls: { update() {} },
  renderer: {},
  resize() {},
  scene: {},
}));
vi.mock("../../vendor/my-office/src/office/people/workers.js", () => ({
  npcs: [],
  subs: new Map(),
  workers: new Map(),
}));
vi.mock("../../vendor/my-office/src/office/interact/first-person.js", () => ({
  exitFp() {},
  fp: { on: false },
}));
vi.mock("../../vendor/my-office/src/office/ui/settings.js", () => ({
  setTimeMode() {},
  syncTimeBtns() {},
}));
vi.mock("../../vendor/my-office/src/office/world/room-update.js", () => ({ night: false }));
vi.mock("../../vendor/my-office/src/office/ui/activity.js", () => ({ toast() {} }));
vi.mock("../../vendor/my-office/src/office/world/pro/pieces.js", () => ({ OFFICE_MARK: "" }));
vi.mock("../../vendor/my-office/src/i18n/index.js", () => ({ t: (key: string) => key }));

import { enterPhoto, setup } from "../../vendor/my-office/src/office/ui/photo.js";

beforeEach(() => {
  document.body.className = "";
  document.body.innerHTML = `
    <button id="btn-photo"></button>
    <div id="photo-bar" hidden>
      <button id="ph-exit"></button><button id="ph-shoot"></button>
      <button id="ph-names"></button><button id="ph-mark"></button>
    </div>`;
});

function pressP(): void {
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "p", bubbles: true }));
}

test("with photo off the button is hidden, P does nothing and the mode cannot be entered", () => {
  h.host.photo = false;
  setup();
  pressP();
  enterPhoto();
  expect(document.getElementById("btn-photo")?.hidden).toBe(true);
  expect(document.getElementById("photo-bar")?.hidden).toBe(true);
  expect(document.body.classList.contains("is-photo")).toBe(false);
});

test("with photo on, the button shows and P opens the bar", () => {
  h.host.photo = true;
  setup();
  pressP();
  expect(document.getElementById("btn-photo")?.hidden).toBe(false);
  expect(document.getElementById("photo-bar")?.hidden).toBe(false);
  expect(document.body.classList.contains("is-photo")).toBe(true);
});
```

Add to `entry.test.ts`, after `"the photo's mark carries the brand's name"`:

```ts
test("the host's photo switch is on unless the start said false", () => {
  // The entry started once, above, without the option.
  expect(host.photo).toBe(true);
});
```

- [ ] **Step 2: Run them to see them fail.**

Run from `plugins/`, one at a time: `npx vitest run office/client/world/world-bridge.test.ts --bail=1`, `world-bridge-page.test.ts`, `photo.test.ts`, `entry.test.ts` (each with `--bail=1`).
Expected: FAIL (modules missing; `host.photo` undefined).

- [ ] **Step 3: Write `world-bridge.ts`.**

```ts
import { WORLD_API_VERSION, type WorldApi, type WorldStartOptions } from "./world-api.js";

/** From the plugin to the page: a call of `PaseoOfficeWorld`. */
export interface BridgeCall {
  call: string;
  args: unknown[];
}

/** From the page to the plugin: a callback the plugin gave `start`, or a problem. */
export type BridgeReply = { callback: string; args: unknown[] } | { problem: string };

export interface WorldBridge {
  api: WorldApi;
  receive(text: string): void;
}

type Handler = (...args: unknown[]) => void;

/** The sign shows a logo only from a `data:` URL: the page's policy refuses any other image. */
function brandForPage(brand: WorldStartOptions["brand"]): WorldStartOptions["brand"] {
  if (brand === undefined) return undefined;
  return {
    name: brand.name,
    logoUrl: brand.logoUrl?.startsWith("data:") ? brand.logoUrl : null,
  };
}

/**
 * The scene's API over messages. Each call becomes `{ call, args }` for `post`; the page answers
 * with `{ callback, args }` for a callback `start` was given, or `{ problem }`. Nothing waits here:
 * `post` is a ScriptFrame handle's, which holds posts until the page is ready.
 */
export function createWorldBridge(post: (text: string) => void): WorldBridge {
  const handlers = new Map<string, Handler>();
  const send = (call: string, args: unknown[]) => post(JSON.stringify({ call, args }));
  const sender =
    (call: string) =>
    (...args: unknown[]) =>
      send(call, args);

  const api: WorldApi = {
    version: WORLD_API_VERSION,
    start(options) {
      handlers.clear();
      const data: Record<string, unknown> = {};
      const callbacks: string[] = [];
      for (const [key, value] of Object.entries(options)) {
        if (typeof value === "function") {
          handlers.set(key, value as Handler);
          callbacks.push(key);
        } else if (key !== "brand") {
          data[key] = value;
        }
      }
      const brand = brandForPage(options.brand);
      send("start", [{ ...data, ...(brand === undefined ? {} : { brand }), callbacks }]);
    },
    stop: sender("stop"),
    setTheme: sender("setTheme"),
    setSessions: sender("setSessions"),
    event: sender("event"),
    select: sender("select"),
    focusProject: sender("focusProject"),
    setBoardRows: sender("setBoardRows"),
    setMachine: sender("setMachine"),
    meet: sender("meet"),
    gather: sender("gather"),
    setIncidents: sender("setIncidents"),
  };

  return {
    api,
    receive(text) {
      let reply: unknown;
      try {
        reply = JSON.parse(text);
      } catch {
        return;
      }
      if (typeof reply !== "object" || reply === null) return;
      const { callback, args, problem } = reply as Record<string, unknown>;
      if (typeof problem === "string") {
        handlers.get("onProblem")?.(problem);
        return;
      }
      if (typeof callback === "string" && Array.isArray(args)) handlers.get(callback)?.(...args);
    },
  };
}
```

- [ ] **Step 4: Write `world-bridge-page.ts`.** The page's script is a string of JavaScript in the plugin's source: it runs in the frame, not in the plugin.

```ts
import { WORLD_API_VERSION } from "./world-api.js";

/**
 * The page's side of the bridge. It runs inside the frame, after ScriptFrame's bootstrap has set
 * `window.paseoFrame`, and before the scene's own script: it listens for the plugin's calls and
 * forwards each to `PaseoOfficeWorld`, which the scene sets when it loads. Callbacks given to
 * `start` become stand-ins that post `{ callback, args }`. A scene that throws, or one that is not
 * the contract's version, posts `{ problem }`, which the office shows as any other failure.
 *
 * It also turns Full screen off: whether a WebView reports `fullscreenEnabled` is the WebView's
 * business, and the bar's button reads it at `start`.
 */
export function bridgePageScript(scene: string): string {
  return `(function () {
  var frame = window.paseoFrame;
  var tell = function (message) { frame.post(JSON.stringify(message)); };
  var problem = function (error) { tell({ problem: String((error && error.message) || error) }); };
  try { Object.defineProperty(document, "fullscreenEnabled", { value: false }); } catch (e) {}
  function standIns(options) {
    var names = options.callbacks || [];
    delete options.callbacks;
    names.forEach(function (name) {
      options[name] = function () {
        tell({ callback: name, args: Array.prototype.slice.call(arguments) });
      };
    });
    return options;
  }
  frame.onMessage = function (text) {
    var message;
    try { message = JSON.parse(text); } catch (e) { return; }
    var world = window.PaseoOfficeWorld;
    if (!message || !world || typeof world[message.call] !== "function") return;
    var args = message.args || [];
    if (message.call === "start" && args[0]) args[0] = standIns(args[0]);
    try { world[message.call].apply(world, args); } catch (error) { problem(error); }
  };
  try {
${scene}
  } catch (error) { problem(error); }
  var world = window.PaseoOfficeWorld;
  if (!world || world.version !== ${WORLD_API_VERSION}) problem("Unexpected office build");
})();`;
}
```

- [ ] **Step 5: Add `host.photo` and its switches in the vendored scene.** Three marked changes, in the scene's style.

`paseo-host.js`, after `open: null,`:

```js
  /** False where Photo mode cannot keep a picture (a WebView has no download): no button, no P key. */
  photo: true,
```

`paseo-entry.js`, in `start`, after the `host.open = ...` line:

```js
host.photo = options.photo !== false;
```

and in the doc comment of `start`, after `onToast(text)`: ", and `photo` (false hides Photo mode)". The comment there lists the options.

`ui/photo.js`, at the top of `enterPhoto()` (after `export function enterPhoto() {`):

```js
if (host.photo === false) return; // PASEO: a host that cannot keep a picture has no Photo mode
```

and in `setup()`, first line:

```js
if (host.photo === false) $("btn-photo").hidden = true; // PASEO: (the P key goes through enterPhoto, which refuses)
```

`photo.js` already carries a `// PASEO:` note (line 16), so the importer keeps it and never overwrites it. Add one line to `plugins/office/vendor/SOURCES.md`, to the `ui/photo.js` bullet: "and a host with `photo` false has no Photo mode (the button is hidden and `enterPhoto` returns)".

- [ ] **Step 6: Run the tests to see them pass.**

Run from `plugins/`, one at a time, each with `--bail=1`: `office/client/world/world-bridge.test.ts`, `world-bridge-page.test.ts`, `photo.test.ts`, `entry.test.ts`, `camera-bar.test.ts`.
Expected: PASS each. Then `npx vitest run office/server/world-script.test.ts --bail=1`: PASS (the scene still bundles). If a vendor manifest test fails on `photo.js`'s hash, follow what the existing marked files do (the importer's hash is of upstream's file; do not regenerate).

- [ ] **Step 7: Typecheck, lint, format, commit.**

```bash
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/client/world/world-bridge.ts plugins/office/client/world/world-bridge-page.ts plugins/office/client/world/world-bridge.test.ts plugins/office/client/world/world-bridge-page.test.ts plugins/office/client/world/photo.test.ts plugins/office/client/world/entry.test.ts
npm run format:files -- plugins/office/client/world/world-bridge.ts plugins/office/client/world/world-bridge-page.ts plugins/office/client/world/world-bridge.test.ts plugins/office/client/world/world-bridge-page.test.ts plugins/office/client/world/photo.test.ts plugins/office/client/world/entry.test.ts plugins/office/vendor/SOURCES.md
git add plugins/office/client/world plugins/office/vendor
git commit -m "feat(office): the scene's API over messages, and a switch for Photo mode"
```

---

### Task 5: The native view, and 3D offered on native

Needs Tasks 1 (the kit's types and `ScriptFrame`), 3 (the hook and the shared file) and 4 (the bridge, `photo`).

**Files:**

- Create: `plugins/office/client/world/script-frame-kit.ts`
- Create: `plugins/office/client/world/world-view-native.tsx`
- Modify: `plugins/office/client/office-surface.tsx` (the helpers at 168 to 176, `useViewChoice` at 349 to 351 and 393, `SurfaceBody` at 588 and 670, its caller at 953)
- Modify: `docs/plugins.md` (the views paragraph, line 633)
- Test: `plugins/office/client/world/script-frame-kit.test.ts` (new), `plugins/office/client/world/world-view-native.mounted.test.tsx` (new), `plugins/office/client/office-surface.test.ts` (changed and added tests)

**Interfaces:**

- Consumes: `ScriptFrameProps`, `ScriptFrameHandle` (kit); `useWorldFeed`, `worldStartOptions`, `useWorldScript`, `useStandupBell`, `WorldLatest`; `createWorldBridge`; `bridgePageScript`; `worldBrand` from `adapter.ts`; `WorldViewProps` from `world-view.tsx`.
- Produces:

```ts
// script-frame-kit.ts
export function hasScriptFrame(): boolean;
export function kitScriptFrame(): ForwardRefExoticComponent<
  ScriptFrameProps & RefAttributes<ScriptFrameHandle>
> | null;
// world-view-native.tsx
export function WorldViewNative(props: WorldViewProps): JSX.Element;
// office-surface.tsx
export function canDraw3D(
  platform: Platform,
  webgl2: () => boolean,
  scriptFrame: () => boolean,
): boolean;
```

`viewOnDevice(saved, can3d)` and `viewOptions(can3d)` keep their shapes; the second parameter is renamed from `webgl2`.

- [ ] **Step 1: Write the failing tests.**

Create `plugins/office/client/world/script-frame-kit.test.ts`:

```ts
import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@getpaseo/plugin/client/ui");
});

test("an app whose kit has no ScriptFrame reads as without it, and nothing throws", async () => {
  vi.doMock("@getpaseo/plugin/client/ui", () => ({ useToast: () => ({}) }));
  const { hasScriptFrame, kitScriptFrame } = await import("./script-frame-kit.js");
  expect([hasScriptFrame(), kitScriptFrame()]).toEqual([false, null]);
});

test("an app whose kit has it offers it", async () => {
  const Fake = () => null;
  vi.doMock("@getpaseo/plugin/client/ui", () => ({ ScriptFrame: Fake }));
  const { hasScriptFrame, kitScriptFrame } = await import("./script-frame-kit.js");
  expect(hasScriptFrame()).toBe(true);
  expect(kitScriptFrame()).toBe(Fake);
});
```

Create `plugins/office/client/world/world-view-native.mounted.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
// The 3D office's native view, mounted with ScriptFrame faked: what it posts to the page, in
// order, and what it does with what the page posts back.
import { act, forwardRef, useImperativeHandle } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeModel } from "../../shared/model.js";
import type { OfficeStyles } from "../styles.js";
import { WorldViewNative } from "./world-view-native.js";

const h = vi.hoisted(() => ({
  posted: [] as string[],
  props: null as {
    script: string;
    title: string;
    onMessage(t: string): void;
    onError?(m: string): void;
  } | null,
  loaded: { status: "ready", script: "SCENE_SCRIPT" },
}));

vi.mock("@getpaseo/plugin/client", () => ({
  useRpc: () => async () => ({}),
  useSettings: () => ({ status: "loading" }),
}));
vi.mock("@getpaseo/plugin/client/ui", () => ({ useToast: () => ({ error: () => undefined }) }));
vi.mock("./script-frame-kit.js", async () => {
  const Frame = forwardRef((props: NonNullable<typeof h.props>, ref) => {
    h.props = props;
    useImperativeHandle(ref, () => ({ post: (text: string) => h.posted.push(text) }));
    return null;
  });
  return { kitScriptFrame: () => Frame, hasScriptFrame: () => true };
});
vi.mock("./world-loader.js", () => ({
  messageOf: (error: unknown) => String(error),
  sharedWorldLoader: {
    subscribe: () => () => undefined,
    state: () => h.loaded,
    load: async () => undefined,
  },
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const STYLES = new Proxy({}, { get: () => ({}) }) as OfficeStyles;
const MODEL: OfficeModel = {
  rooms: [],
  attention: [],
  agentTasks: [],
  agents: new Map(),
  roomOfAgent: new Map(),
  waitingOn: new Map(),
};
const ignore = () => undefined;

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  h.posted = [];
  h.props = null;
  container = document.createElement("div");
  root = createRoot(container);
});
afterEach(() => act(() => root.unmount()));

async function mount(overrides: Partial<Parameters<typeof WorldViewNative>[0]> = {}) {
  const props = {
    model: MODEL,
    theme: THEME,
    styles: STYLES,
    focusRoomId: null,
    focusRequest: null,
    selectedAgentId: null,
    onSelectAgent: ignore,
    onSelectBoard: ignore,
    machine: null,
    onOpenMachine: ignore,
    onOpenResources: undefined,
    onOpenSession: undefined,
    onOpenLibrary: ignore,
    onOpenNotes: ignore,
    meeting: false,
    incidents: undefined,
    onOpenIncidents: ignore,
    onProblem: ignore,
    ...overrides,
  };
  await act(async () => root.render(<WorldViewNative {...props} />));
}

const calls = () => h.posted.map((text) => JSON.parse(text) as { call: string; args: unknown[] });

test("the frame runs the bridge's page with the scene's script, under the office's title", async () => {
  await mount();
  expect(h.props?.title).toBe("Office in 3D");
  expect(h.props?.script).toContain("SCENE_SCRIPT");
  expect(h.props?.script).toContain("PaseoOfficeWorld");
});

test("start is the first message; photo is off; the feed follows in order", async () => {
  await mount();
  const [start, ...rest] = calls();
  expect(start.call).toBe("start");
  const options = start.args[0] as Record<string, unknown>;
  expect(options.photo).toBe(false);
  expect(options.brand).toEqual({ name: "Paseo", logoUrl: null });
  expect(options.callbacks).toEqual(
    expect.arrayContaining([
      "onSelect",
      "onBoard",
      "onMachine",
      "onLibrary",
      "onBell",
      "onNotes",
      "onIncidents",
      "onProblem",
    ]),
  );
  expect(options.callbacks).not.toContain("onOpen");
  expect(options.callbacks).not.toContain("onResources");
  expect(rest.map((message) => message.call)).toEqual(
    expect.arrayContaining(["setTheme", "setSessions", "setBoardRows", "setMachine", "select"]),
  );
});

test("onOpen is given where the office can open a session", async () => {
  await mount({ onOpenSession: ignore });
  expect((calls()[0].args[0] as { callbacks: string[] }).callbacks).toContain("onOpen");
});

test("a person chosen in the scene opens their card; no keyboard moves", async () => {
  const onSelectAgent = vi.fn();
  await mount({ onSelectAgent });
  act(() => h.props?.onMessage(JSON.stringify({ callback: "onSelect", args: ["a1"] })));
  expect(onSelectAgent).toHaveBeenCalledWith("a1");
});

test("a problem the page posts, and a frame error, reach the surface", async () => {
  const onProblem = vi.fn();
  await mount({ onProblem });
  act(() => h.props?.onMessage(JSON.stringify({ problem: "WebGL2 is not available" })));
  act(() => h.props?.onError?.("The page's process ended"));
  expect(onProblem.mock.calls).toEqual([["WebGL2 is not available"], ["The page's process ended"]]);
});

test("closing the view tells the page to stop", async () => {
  await mount();
  h.posted = [];
  act(() => root.unmount());
  expect(calls().map((message) => message.call)).toEqual(["stop"]);
  root = createRoot(container);
});
```

In `office-surface.test.ts`: rename nothing in the existing tests (they pass booleans), and add after `"the switch offers 3D only where the device can draw it"`:

```ts
test("3D can be drawn in a browser with WebGL2, and in an app with ScriptFrame, and nowhere else", () => {
  const yes = () => true;
  const no = () => false;
  expect([
    canDraw3D("web", yes, no),
    canDraw3D("web", no, yes),
    canDraw3D("android", no, yes),
    canDraw3D("android", yes, no),
    canDraw3D("ios", no, no),
  ]).toEqual([true, false, true, false, false]);
});

test("the browser is not asked on a phone, and the kit is not asked in a browser", () => {
  const webgl2 = vi.fn(() => true);
  const scriptFrame = vi.fn(() => true);
  canDraw3D("android", webgl2, scriptFrame);
  expect(webgl2).not.toHaveBeenCalled();
  canDraw3D("web", webgl2, scriptFrame);
  expect(scriptFrame).toHaveBeenCalledTimes(1);
});
```

(import `canDraw3D` and `vi` in that file.)

- [ ] **Step 2: Run them to see them fail.**

Run from `plugins/`, one at a time, each with `--bail=1`: `office/client/world/script-frame-kit.test.ts`, `world-view-native.mounted.test.tsx`, `office/client/office-surface.test.ts`.
Expected: FAIL (modules and `canDraw3D` missing).

- [ ] **Step 3: Write `script-frame-kit.ts`.** The kit's key is read only through `in`: a module mock without it (as in `world-view.mounted.test.tsx`) throws on a property read, and an app without it has no key.

```ts
import type { ForwardRefExoticComponent, RefAttributes } from "react";
import * as kit from "@getpaseo/plugin/client/ui";
import type { ScriptFrameHandle, ScriptFrameProps } from "@getpaseo/plugin/client/ui";

type KitScriptFrame = ForwardRefExoticComponent<
  ScriptFrameProps & RefAttributes<ScriptFrameHandle>
>;

/**
 * Whether this app's kit has `ScriptFrame`. The store app and apps older than 0.16.0 do not, and
 * the key is absent there. Ask with `in`, never by reading the property.
 */
export function hasScriptFrame(): boolean {
  return "ScriptFrame" in kit;
}

export function kitScriptFrame(): KitScriptFrame | null {
  return "ScriptFrame" in kit ? kit.ScriptFrame : null;
}
```

- [ ] **Step 4: Write `world-view-native.tsx`.**

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text, View } from "react-native";
import type { ScriptFrameHandle } from "@getpaseo/plugin/client/ui";
import { worldBrand } from "./adapter.js";
import { kitScriptFrame } from "./script-frame-kit.js";
import { useWorldFeed } from "./use-world-feed.js";
import type { WorldApi } from "./world-api.js";
import { createWorldBridge, type WorldBridge } from "./world-bridge.js";
import { bridgePageScript } from "./world-bridge-page.js";
import { messageOf } from "./world-loader.js";
import {
  useStandupBell,
  useWorldScript,
  worldStartOptions,
  type WorldLatest,
} from "./world-view-shared.js";
import type { WorldViewProps } from "./world-view.js";

const noFocus = () => undefined;

/**
 * The office in 3D where there is no DOM to open a frame in: a ScriptFrame of the kit runs the
 * scene's script, and a bridge gives this view the scene's API over messages. The surface renders
 * it only where the kit has ScriptFrame. Whether the phone can draw it is found in the page: with no
 * WebGL2 the scene posts a problem, and the surface gives way to the 2D office.
 *
 * `focusApp` has nothing to do here: a page of a WebView does not take the app's keys. Photo mode is
 * off, since a WebView cannot keep a download.
 */
export function WorldViewNative({
  model,
  theme,
  styles,
  focusRoomId,
  focusRequest,
  selectedAgentId,
  onSelectAgent,
  onSelectBoard,
  machine,
  onOpenMachine,
  onOpenResources,
  onOpenSession,
  onOpenLibrary,
  onOpenNotes,
  meeting,
  incidents,
  onOpenIncidents,
  onProblem,
}: WorldViewProps) {
  const Frame = kitScriptFrame();
  const onBell = useStandupBell();
  const latest = useRef<WorldLatest>({
    model,
    theme,
    focusRoomId,
    selectedAgentId,
    onSelectAgent,
    onSelectBoard,
    onOpenMachine,
    onOpenResources,
    onOpenSession,
    onOpenLibrary,
    onOpenNotes,
    onOpenIncidents,
    onBell,
    onProblem,
  });
  useEffect(() => {
    latest.current = {
      model,
      theme,
      focusRoomId,
      selectedAgentId,
      onSelectAgent,
      onSelectBoard,
      onOpenMachine,
      onOpenResources,
      onOpenSession,
      onOpenLibrary,
      onOpenNotes,
      onOpenIncidents,
      onBell,
      onProblem,
    };
  });

  const script = useWorldScript(Frame !== null, onProblem);
  const page = useMemo(() => (script === null ? null : bridgePageScript(script)), [script]);
  const frame = useRef<ScriptFrameHandle | null>(null);
  const bridge = useRef<WorldBridge | null>(null);
  const [api, setApi] = useState<WorldApi | null>(null);

  // The frame is mounted when this runs, so its handle is there. Its posts wait for the page, in
  // order: start goes first, then whatever the feed sends once `api` is set.
  useEffect(() => {
    const handle = frame.current;
    if (page === null || handle === null) return undefined;
    const made = createWorldBridge((text) => handle.post(text));
    bridge.current = made;
    try {
      made.api.start(
        worldStartOptions(latest, { focus: noFocus, brand: worldBrand(null), photo: false }),
      );
    } catch (error) {
      latest.current.onProblem(messageOf(error));
      return undefined;
    }
    setApi(made.api);
    return () => {
      made.api.stop();
      bridge.current = null;
      setApi(null);
    };
  }, [page]);

  const { note } = useWorldFeed(api, {
    model,
    theme,
    focusRoomId,
    focusRequest,
    selectedAgentId,
    machine,
    meeting,
    incidents,
  });

  const onMessage = useCallback((text: string) => bridge.current?.receive(text), []);
  const onError = useCallback((message: string) => latest.current.onProblem(message), []);

  return (
    <View style={styles.scene}>
      {Frame !== null && page !== null ? (
        <Frame
          ref={frame}
          script={page}
          title="Office in 3D"
          onMessage={onMessage}
          onError={onError}
        />
      ) : null}
      {api === null ? <Text style={styles.sceneStatus}>Loading the 3D view...</Text> : null}
      {api !== null && note !== null ? (
        <View style={styles.sceneNote}>
          <Text style={styles.sceneNoteText}>{note}</Text>
        </View>
      ) : null}
    </View>
  );
}
```

`brand`: a native office has no brand source (`readBrand` needs a `document`; the kit has no brand), so the sign shows Paseo's name over the scene's mark. The bridge still drops a logo that is not a `data:` URL, for the day a brand is given.

- [ ] **Step 5: Change `office-surface.tsx`.**

Imports, beside the `world-view` import:

```tsx
import { hasScriptFrame } from "./world/script-frame-kit.js";
import { WorldViewNative } from "./world/world-view-native.js";
```

Helpers (lines 163 to 176): rename the second parameter and its doc, and add `canDraw3D`:

```tsx
/**
 * The view a saved choice means on this device. Only a device that can draw the 3D office shows
 * it; anywhere else that choice, and no choice, is the 2D one.
 */
export function viewOnDevice(saved: SavedView, can3d: boolean): OfficeViewChoice {
  if (saved === "2d" || saved === "list") return saved;
  return can3d ? "3d" : "2d";
}

/** The views a device offers, in the switch's order. */
export function viewOptions(can3d: boolean): readonly OfficeViewChoice[] {
  return can3d ? OFFICE_VIEWS : OFFICE_VIEWS.filter((view) => view !== "3d");
}

/**
 * Whether this device can draw the 3D office: a browser with WebGL2, or an app whose kit has
 * ScriptFrame. The other is not asked. On an app the page finds out whether the phone has WebGL2
 * (the scene reports a problem if not), and the surface gives way to 2D.
 */
export function canDraw3D(
  platform: Platform,
  webgl2: () => boolean,
  scriptFrame: () => boolean,
): boolean {
  return platform === "web" ? webgl2() : scriptFrame();
}
```

In `useViewChoice` (line 351) replace the `webgl2` line and its uses (line 393):

```tsx
  const can3d = useMemo(() => canDraw3D(platform, hasWebGL2, hasScriptFrame), [platform]);
  ...
  const options = useMemo(() => viewOptions(can3d), [can3d]);
  ...
    choice: saved === null ? null : viewOnDevice(saved, can3d),
```

(and wherever `webgl2` was in that function's other lines, e.g. a dependency list: replace with `can3d`.)

`SurfaceBodyProps` (line 588) gains `platform: Platform;` and `SurfaceBody` takes it; at line 670 the 3D branch becomes:

```tsx
  if (view === "3d") {
    const World = platform === "web" ? WorldView : WorldViewNative;
    return (
      <World
        model={model}
        ... (the same props as today) ...
      />
    );
  }
```

and at the caller (line 953) add `platform={layout.platform}`.

- [ ] **Step 6: Update `docs/plugins.md`.** Replace the sentence at lines 633 to 637 ("The office has three views ... with a way to try again.") with:

```markdown
The office has three views: a 3D floor, a 2D floor and the list. The header's switch chooses one
per device and keeps it in the `office-device` setting. A device that never chose shows the 3D
floor where it can draw it: a browser with WebGL2, or an app whose kit has `ScriptFrame` (the
fork's Android app; the store build does not). It shows the 2D floor anywhere else. On the web the
scene runs in an `iframe` of its own (`client/world/world-frame.web.ts`); in an app it runs in a
`ScriptFrame`, and `client/world/world-bridge.ts` carries the scene's API over messages. The
plugin bundle has no platform file extensions, so `office-surface.tsx` picks the view by
`layout.platform`. An app's page finds out whether the phone has WebGL2; with none, and for any
other failure, the 3D floor gives way to the 2D one under a banner with a way to try again. Photo
mode is off in an app, since a WebView cannot keep a download.
```

- [ ] **Step 7: Run the tests to see them pass.**

Run from `plugins/`, one at a time, each with `--bail=1`: `office/client/world/script-frame-kit.test.ts`, `world-view-native.mounted.test.tsx`, `office/client/office-surface.test.ts`, `office/client/office-surface-panels.mounted.test.tsx`, `office/client/world/world-view.mounted.test.tsx`.
Expected: PASS each. If the last test of the native view (the `stop` message on unmount) is flaky in this React's unmount order, assert instead that `stop` is the last call of `calls()` after `act(() => root.unmount())`; do not delete it.

- [ ] **Step 8: Typecheck, lint, format, commit.**

```bash
npm run build:plugin
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/client/world/script-frame-kit.ts plugins/office/client/world/world-view-native.tsx plugins/office/client/office-surface.tsx plugins/office/client/office-surface.test.ts plugins/office/client/world/script-frame-kit.test.ts plugins/office/client/world/world-view-native.mounted.test.tsx
npm run format:files -- plugins/office/client/world/script-frame-kit.ts plugins/office/client/world/world-view-native.tsx plugins/office/client/office-surface.tsx plugins/office/client/office-surface.test.ts plugins/office/client/world/script-frame-kit.test.ts plugins/office/client/world/world-view-native.mounted.test.tsx docs/plugins.md
git add plugins/office/client docs/plugins.md
git commit -m "feat(office): the 3D office in an app whose kit has ScriptFrame"
```

---

### Task 6: The fork variant and its build script

Runs in parallel with Tasks 1 to 5 (it touches none of their files). It installs nothing and builds nothing.

**Files:**

- Modify: `packages/app/app.config.js` (the `variants` object, line 73 to 95)
- Modify: `scripts/build-apk.mjs`
- Modify: `package.json` (after `build:apk:arm64`, line 53)
- Modify: `docs/android.md` (the variants table, line 7 to 10)
- Test: `packages/app/app.config.test.ts` (two tests)

**Interfaces:**

- Produces: `APP_VARIANT=fork` gives name "Paseo Fork", package `sh.paseo.fork` on Android and iOS, no `googleServicesFile`. `npm run build:apk:fork` writes `artifacts/paseo-fork-arm64.apk`, signed with the key at `~/.paseo-fork/`.

- [ ] **Step 1: Write the failing tests.** They use the same Expo loader as the tests above them, so they read the config as `expo prebuild` does.

In `packages/app/app.config.test.ts`, add `beforeEach`-less env handling inside each test (the file already restores `PASEO_FDROID_BUILD` in an `afterEach` of a `describe`; these are top-level tests like `"follows system rotation on Android"`):

```ts
it("the fork variant installs beside the store app: its own name and package, no Firebase file", async () => {
  const before = process.env.APP_VARIANT;
  process.env.APP_VARIANT = "fork";
  try {
    const { exp } = await getPrebuildConfigAsync(__dirname, { platforms: ["android"] });
    expect({
      name: exp.name,
      androidPackage: exp.android.package,
      iosBundle: exp.ios.bundleIdentifier,
      googleServicesFile: exp.android.googleServicesFile,
    }).toEqual({
      name: "Paseo Fork",
      androidPackage: "sh.paseo.fork",
      iosBundle: "sh.paseo.fork",
      googleServicesFile: undefined,
    });
  } finally {
    if (before === undefined) delete process.env.APP_VARIANT;
    else process.env.APP_VARIANT = before;
  }
}, 30_000);

it("the production variant is still the store app", async () => {
  const before = process.env.APP_VARIANT;
  delete process.env.APP_VARIANT;
  try {
    const { exp } = await getPrebuildConfigAsync(__dirname, { platforms: ["android"] });
    expect({ name: exp.name, androidPackage: exp.android.package }).toEqual({
      name: "Paseo",
      androidPackage: "sh.paseo",
    });
  } finally {
    if (before !== undefined) process.env.APP_VARIANT = before;
  }
}, 30_000);
```

- [ ] **Step 2: Run it to see it fail.**

Run (from `packages/app`): `npx vitest run app.config.test.ts --bail=1 -t "fork variant"`
Expected: FAIL, the fork test gets name "Paseo" and package `sh.paseo` (an unknown variant falls back to production).

- [ ] **Step 3: Add the variant.** In `packages/app/app.config.js`, after `development`:

```js
  // The fork's own app: it installs beside the store app and pairs on its own. It has no Firebase
  // file, so push notifications do not work in it.
  fork: {
    name: "Paseo Fork",
    packageId: "sh.paseo.fork",
    googleServicesFile: undefined,
    googleServiceInfoPlist: undefined,
  },
```

- [ ] **Step 4: Run the tests to see them pass.**

Run: `npx vitest run app.config.test.ts --bail=1 -t "variant"`
Expected: PASS both. (Do not run the file's other tests; each one runs a prebuild config.)

- [ ] **Step 5: Add the `fork` target to `scripts/build-apk.mjs`.** Edit the head of the file (lines 7 to 24):

```js
import { spawnSync, execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";

const target = process.argv[2] ?? "universal";
const architectures = {
  universal: "armeabi-v7a,arm64-v8a,x86,x86_64",
  arm64: "arm64-v8a",
  fork: "arm64-v8a",
}[target];
if (!architectures) {
  throw new Error(`Unknown APK target: ${target}. Use universal, arm64 or fork.`);
}
const isFork = target === "fork";

// The fork's APK is signed with a key that lives outside the repo. Look for it before any build
// step: a build that ends without the key wastes half an hour.
const forkKey = path.join(homedir(), ".paseo-fork/release.keystore");
const forkPassword = path.join(homedir(), ".paseo-fork/release.password");
if (isFork && !(existsSync(forkKey) && existsSync(forkPassword))) {
  console.error(
    `The fork's signing key is missing.\n  keystore: ${forkKey}\n  password: ${forkPassword}\n` +
      "Make it once with keytool (docs/android.md, \"The fork's app\") and keep ~/.paseo-fork/ backed up:\n" +
      "Android installs an update only when it is signed with the same key.",
  );
  process.exit(1);
}

const root = fileURLToPath(new URL("..", import.meta.url));
const app = path.join(root, "packages/app");
const env = {
  ...process.env,
  APP_VARIANT: isFork ? "fork" : "production",
```

(the rest of `env` is unchanged). After the Gradle `run(...)` call and before the `destination` line, replace the tail of the file with:

```js
const built = path.join(app, "android/app/build/outputs/apk/release/app-release.apk");
const destination = path.join(
  root,
  isFork ? "artifacts/paseo-fork-arm64.apk" : `artifacts/paseo-dogfood-${target}.apk`,
);
mkdirSync(path.dirname(destination), { recursive: true });
if (isFork) {
  // Gradle signs a release with the debug key. Align the APK, then sign it with the fork's own.
  const sdk =
    process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT ?? path.join(homedir(), "Android/Sdk");
  const tools = path.join(sdk, "build-tools", "35.0.0");
  const aligned = path.join(path.dirname(built), "app-release-aligned.apk");
  run(path.join(tools, "zipalign"), ["-f", "-p", "4", built, aligned], root);
  run(
    path.join(tools, "apksigner"),
    ["sign", "--ks", forkKey, "--ks-pass", `file:${forkPassword}`, "--out", destination, aligned],
    root,
  );
  console.log(`\nFork APK (arm64, signed with ${forkKey}): ${destination}\n`);
} else {
  copyFileSync(built, destination);
  console.log(`\nDiagnostic release APK: ${destination}\nLogs: Downloads/Paseo diagnostics\n`);
}
```

In `package.json`, after `"build:apk:arm64"`:

```json
    "build:apk:fork": "node scripts/build-apk.mjs fork",
```

In `docs/android.md`, the variants table gains a row, and the sentence under it names the fork:

```markdown
| `fork` | Paseo Fork | `sh.paseo.fork` |

`fork` is the allrested fork's own app: it installs beside the store app, pairs on its own and has no Firebase file, so push notifications do not work in it. `npm run build:apk:fork` builds it (see "The fork's app").
```

- [ ] **Step 6: Check that a build without the key stops first.** Nothing is installed, nothing builds.

Run: `node scripts/build-apk.mjs fork; echo "exit $?"`
Expected: prints "The fork's signing key is missing." with both paths under the home folder, then `exit 1`, in under a second. (If `~/.paseo-fork/` already exists from an earlier run, move it aside for this check and move it back.)

Run: `node scripts/build-apk.mjs nope; echo "exit $?"`
Expected: `Unknown APK target: nope. Use universal, arm64 or fork.` and a non-zero exit.

- [ ] **Step 7: Lint, format, commit.**

```bash
npm run lint -- packages/app/app.config.js packages/app/app.config.test.ts scripts/build-apk.mjs
npm run format:files -- packages/app/app.config.js packages/app/app.config.test.ts scripts/build-apk.mjs package.json docs/android.md
git add packages/app/app.config.js packages/app/app.config.test.ts scripts/build-apk.mjs package.json docs/android.md
git commit -m "feat(app): a fork variant and npm run build:apk:fork"
```

---

### Task 7: The fork's APK workflow, the key, and the phone checklist

> **Owner's decision (2026-11-18), replaces this task's local build.** This host is aarch64 with no
> x86 emulation; Google's Linux build tools, NDK and `hermesc` are x86_64 only. The APK is built on
> the fork's GitHub Actions instead. The local toolchain install below is NOT done. Read the old
> steps that follow only for the `docs/android.md` text, the key commands and the phone checklist.

**Files:**

- Create: `.github/workflows/fork-android-apk.yml`
- Modify: `scripts/ci-workflow.test.mjs` (or the test the repo already uses for workflow files; follow its pattern)
- Modify: `docs/android.md` (the fork's app: the variant, the key, the workflow, how to release)

**What to build**

- The workflow runs on `push` of tags `fork-android-*` only (a tag push runs the workflow file of the
  tagged commit, so the fork's `main` never needs it), and on `workflow_dispatch` with a `tag` input
  for a re-run of an existing tag. `runs-on: ubuntu-latest`, `permissions: contents: write`.
- Steps: checkout the tag; Node from `.tool-versions` (22.20.0) with npm cache; `actions/setup-java@v4`
  Temurin 21; `android-actions/setup-android@v3`; `npm ci` with `ONNXRUNTIME_NODE_INSTALL=skip`;
  write the key from secrets to `$HOME/.paseo-fork/release.keystore` (base64 secret
  `FORK_ANDROID_KEYSTORE`) and `$HOME/.paseo-fork/release.password` (secret
  `FORK_ANDROID_KEYSTORE_PASSWORD`), mode 0600; `npm run build:apk:fork`; `apksigner verify --print-certs`
  and `aapt2 dump badging` (must show `sh.paseo.fork` and `Paseo Fork`); create a GitHub prerelease
  named after the tag if missing (`gh release create "$TAG" --prerelease --title "Paseo Fork $TAG" --notes ...`)
  and upload `artifacts/paseo-fork-arm64.apk` with `--clobber`.
- `build-apk.mjs`'s key check (Task 6) reads the same two paths, so the workflow and a local build
  on an x86 machine behave the same.
- Test: extend the repo's workflow test so it asserts the trigger (tags `fork-android-*` and
  dispatch only), the secret names, `build:apk:fork`, the verify step, and that no step prints
  the secrets.
- The key: make it once on this host with Java 17's `keytool` (works for a keystore):
  `mkdir -p ~/.paseo-fork && chmod 700 ~/.paseo-fork`, generate a random password into
  `release.password` (mode 0600), then
  `keytool -genkeypair -keystore ~/.paseo-fork/release.keystore -storepass:file ~/.paseo-fork/release.password -keypass:file ~/.paseo-fork/release.password -alias paseo-fork -keyalg RSA -keysize 4096 -validity 36500 -dname "CN=Paseo Fork"`.
  Never print the password; never commit either file.
- **Not done by the builder** (the controller does these after the owner's yes): setting the two
  repository secrets with `gh secret set`, pushing the `fork-android-*` tag, watching the run, and
  sharing the release link.
- End with the phone checklist (from the old steps below) written into the branch's ledger report.

---

### Task 7: The toolchain, the key, the build, the checks, and the phone checklist

Last. It needs Tasks 1 to 6 merged on the branch, so the APK carries `ScriptFrame` and the fork variant. It installs software in the home folder only. It does NOT upload anything.

**Files:**

- Modify: `docs/android.md` (a section "The fork's app" and a section "Linux without mise")
- Writes outside the repo: `~/.local/jdk-21`, `~/Android/Sdk`, `~/.paseo-fork/`
- Produces: `artifacts/paseo-fork-arm64.apk` (ignored by git, `.gitignore:91`)

- [ ] **Step 1: Preflight. Stop here if the host is not x86_64.**

```bash
uname -m
free -g | sed -n 2p
df -h ~ | tail -1
java -version 2>&1 | head -1
```

Expected: `x86_64`, at least 16 GB memory, at least 15 GB free in the home folder (the toolchain and Gradle's cache are about 8 GB, the build more).

If `uname -m` prints `aarch64` (it did when this plan was written: Debian 12 on arm64, no `qemu-x86_64`, no x86 libraries), STOP. Do not download anything. Google ships the SDK's build tools (`aapt2`, `zipalign`), the NDK, CMake and Ninja for x86_64 Linux only, and so does the Hermes compiler in `node_modules/hermes-compiler/hermesc/linux64-bin`. Gradle's own `aapt2` is x86_64 too. Report to the controller: the build needs an x86_64 Linux host (or a decision to emulate, which changes the plan). Tasks 1 to 6 are complete and stand on their own.

- [ ] **Step 2: Find the NDK the app asks for.** It is read from the installed React Native, not guessed.

```bash
grep -n "ndkVersion" node_modules/react-native/gradle/libs.versions.toml
```

Expected: `ndkVersion = "27.1.12297006"` for React Native 0.86.3. Use whatever it prints below. (If the worktree has no `node_modules`, read it from `/workspace/QFlavours/paseo/node_modules/react-native/gradle/libs.versions.toml`; if `node_modules/.bin/expo` is missing in the worktree, run `npm ci` once at the root before Step 7.)

- [ ] **Step 3: Install Java 21 (Temurin) into `~/.local/jdk-21`.** The download goes to its own empty directory, and the checksum is checked against Adoptium's own listing.

```bash
mkdir -p /tmp/jdk21-dl ~/.local/jdk-21
python3 -I - <<'PY'
import hashlib, json, urllib.request
url = "https://api.adoptium.net/v3/assets/latest/21/hotspot?architecture=x64&image_type=jdk&os=linux&vendor=eclipse"
package = json.load(urllib.request.urlopen(url))[0]["binary"]["package"]
data = urllib.request.urlopen(package["link"]).read()
assert hashlib.sha256(data).hexdigest() == package["checksum"], "checksum mismatch"
open("/tmp/jdk21-dl/jdk21.tar.gz", "wb").write(data)
print(package["name"])
PY
tar -xzf /tmp/jdk21-dl/jdk21.tar.gz -C ~/.local/jdk-21 --strip-components=1
~/.local/jdk-21/bin/java -version 2>&1 | head -1
```

Expected: a `jdk-21...` file name, then `openjdk version "21...`.

- [ ] **Step 4: Install the Android command-line tools, platform 35, build tools 35 and the NDK into `~/Android/Sdk`.** Get the current file name and its sha256 from the "Command line tools only" table on `https://developer.android.com/studio#command-line-tools-only`; compare the checksum before unpacking. `<zip>` below is that file.

```bash
mkdir -p /tmp/cmdtools-dl ~/Android/Sdk/cmdline-tools
curl -fL -o /tmp/cmdtools-dl/cmdline-tools.zip "https://dl.google.com/android/repository/<zip>"
sha256sum /tmp/cmdtools-dl/cmdline-tools.zip        # must equal the page's value
mkdir -p /tmp/cmdtools-dl/out && unzip -q /tmp/cmdtools-dl/cmdline-tools.zip -d /tmp/cmdtools-dl/out
mv /tmp/cmdtools-dl/out/cmdline-tools ~/Android/Sdk/cmdline-tools/latest

export JAVA_HOME="$HOME/.local/jdk-21" ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
yes | sdkmanager --licenses > /dev/null
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;27.1.12297006"
~/Android/Sdk/build-tools/35.0.0/aapt2 version
```

Expected: `aapt2 version` prints a version. If it prints `Exec format error`, the host is not x86_64: go back to Step 1's stop. The licence step accepts the Android SDK licences for this machine; the plan includes it because the install cannot run without it. Gradle fetches `cmake` and anything else it needs the first time.

- [ ] **Step 5: Make the signing key. It stays outside the repo.**

```bash
export JAVA_HOME="$HOME/.local/jdk-21"; export PATH="$JAVA_HOME/bin:$PATH"
mkdir -p ~/.paseo-fork && chmod 700 ~/.paseo-fork
( umask 077; head -c 24 /dev/urandom | base64 | tr -d '/+=\n' > ~/.paseo-fork/release.password )
chmod 600 ~/.paseo-fork/release.password
keytool -genkeypair -keystore ~/.paseo-fork/release.keystore -alias paseo-fork \
  -keyalg RSA -keysize 4096 -validity 10950 \
  -storepass:file ~/.paseo-fork/release.password -keypass:file ~/.paseo-fork/release.password \
  -dname "CN=Paseo Fork, O=allrested"
chmod 600 ~/.paseo-fork/release.keystore
stat -c '%a %n' ~/.paseo-fork ~/.paseo-fork/release.password ~/.paseo-fork/release.keystore
```

Expected: `700`, `600`, `600`. Never print or paste the password file; never `git add` anything under `~/.paseo-fork/` (it is outside the repo). If the key already exists, keep it: a new key means every installed fork app must be uninstalled first.

- [ ] **Step 6: Write the two sections of `docs/android.md`, from what Steps 3 to 5 did.** After "Local build + install":

````markdown
## The fork's app

The allrested fork builds its own Android app, `sh.paseo.fork` ("Paseo Fork"), so a feature the store build lacks can run on a phone. It installs beside the store app and pairs on its own. It has no Firebase file: push notifications do not work in it.

```bash
npm run build:apk:fork   # artifacts/paseo-fork-arm64.apk, arm64 only, signed with the fork's key
```

The build is `build:apk:arm64` with `APP_VARIANT=fork`; then `zipalign` and `apksigner` from build tools 35.0.0 re-sign the APK. The generated Gradle files are not changed.

The key is `~/.paseo-fork/release.keystore`, its password in `~/.paseo-fork/release.password` (mode 0600). Neither is in the repo. Android installs an update only over the same key, so back up `~/.paseo-fork/`: a lost key means uninstalling the app and pairing again. A build without the key stops and says so before it starts. To make a key once:

```bash
mkdir -p ~/.paseo-fork && chmod 700 ~/.paseo-fork
( umask 077; head -c 24 /dev/urandom | base64 | tr -d '/+=\n' > ~/.paseo-fork/release.password )
keytool -genkeypair -keystore ~/.paseo-fork/release.keystore -alias paseo-fork -keyalg RSA -keysize 4096 \
  -validity 10950 -storepass:file ~/.paseo-fork/release.password -keypass:file ~/.paseo-fork/release.password \
  -dname "CN=Paseo Fork, O=allrested"
```

A build is shipped as a prerelease on `allrested/paseo`, tagged `fork-android-<version>-<n>` (for example `fork-android-0.16.0-1`), with the APK attached. It is uploaded only after the owner agrees to that upload.

## Linux without mise

On a Linux x86_64 host without mise, install the toolchain into the home folder; nothing outside it changes. Build tools, the NDK and the Hermes compiler have no arm64 Linux build, so an arm64 host cannot run this build.

- Java 21 (Temurin) in `~/.local/jdk-21`: unpack the `linux/x64` JDK 21 archive from Adoptium there with `tar --strip-components=1`.
- The command-line tools from developer.android.com in `~/Android/Sdk/cmdline-tools/latest`, then:

```bash
export JAVA_HOME="$HOME/.local/jdk-21" ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
yes | sdkmanager --licenses
sdkmanager "platform-tools" "platforms;android-35" "build-tools;35.0.0" "ndk;27.1.12297006"
```

The NDK version is the one React Native asks for: `ndkVersion` in `node_modules/react-native/gradle/libs.versions.toml`. The toolchain and Gradle's cache take about 8 GB.
````

(If Step 3 to 5 needed a different command, write the one that worked, not the one above.)

- [ ] **Step 7: Build.** Long: run it in the background and follow the log.

```bash
export JAVA_HOME="$HOME/.local/jdk-21" ANDROID_HOME="$HOME/Android/Sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/cmdline-tools/latest/bin:$PATH"
npm run build:apk:fork > /tmp/fork-build.log 2>&1
echo "exit $?"
tail -5 /tmp/fork-build.log
```

Expected: `exit 0` and a last line `Fork APK (arm64, signed with ...): .../artifacts/paseo-fork-arm64.apk`. Allow 20 to 60 minutes. On failure, read `/tmp/fork-build.log` from the first error up, fix the cause, and run again; do not change the generated Gradle files (the spec says they stay as they are) and do not drop `--max-workers=2`.

- [ ] **Step 8: Verify the APK.**

```bash
export ANDROID_HOME="$HOME/Android/Sdk" JAVA_HOME="$HOME/.local/jdk-21" PATH="$HOME/.local/jdk-21/bin:$PATH"
BT="$ANDROID_HOME/build-tools/35.0.0"
APK=artifacts/paseo-fork-arm64.apk
ls -l "$APK"
"$BT/apksigner" verify --verbose --print-certs "$APK"
"$BT/aapt2" dump badging "$APK" | grep -E "^package:|^application-label:|^native-code:"
keytool -list -v -keystore ~/.paseo-fork/release.keystore -storepass:file ~/.paseo-fork/release.password | grep "SHA256:"
unzip -p "$APK" assets/index.android.bundle | grep -ac "script-frame.invalid"
```

Expected:

- `apksigner verify` prints `Verifies` with v2 (and v3) true and a `Signer #1 certificate DN: CN=Paseo Fork, O=allrested`.
- The signer's `SHA-256 digest` equals the keystore's `SHA256:` line (the same key; byte-for-byte after removing colons and case).
- `package: name='sh.paseo.fork'`, `application-label:'Paseo Fork'`, `native-code: 'arm64-v8a'`.
- The last command prints a number of 1 or more: the JS bundle carries `ScriptFrame`'s base URL.

If any line differs, the APK is not done: fix and rebuild (Step 7). Do not edit the expected values.

- [ ] **Step 9: Format, commit the doc.**

```bash
npm run format:files -- docs/android.md
git add docs/android.md
git commit -m "docs(office): the fork's app, its key and the Linux toolchain"
```

- [ ] **Step 10: Hand back. Do not upload.** The report to the controller has the APK's path and size, the `apksigner verify` and `aapt2` output, the key's SHA-256 digest, and the checklist below, verbatim. It says in as many words that nothing was uploaded and no release or tag was made.

The phone checklist, for the owner (a device that Paseo's Android tools can reach gets screenshots; the daemon's log is watched for errors meanwhile):

1. The daemon the phone pairs with runs this branch's office plugin (the plugin's client is built by the daemon and delivered to the app; the app only needs `ScriptFrame`). Restarting a daemon is the owner's call, not the builder's.
2. Install `paseo-fork-arm64.apk` beside the store app. Both icons are there; "Paseo Fork" is the new one. An update later installs over it only while the key is the same.
3. Pair "Paseo Fork" with the host. (It has its own pairing.)
4. Open the office. The switch offers 3D, 2D and List. A phone that never chose opens in 3D.
5. In 3D: one finger pans, two fingers pinch to zoom and twist to turn.
6. Tap a person: the card opens; Open session opens the session as its own screen.
7. A view button (Overview, Desks and the rest) flies the camera; zoom in and out change the percent.
8. An open incident shows the banner over the floor; tapping it opens Incidents.
9. Photo mode and Walk in are not on the bar. Full screen is not either.
10. How smooth it is: note the frame rate on a quiet floor and with people at work; the loop lowers the resolution on its own when frames are slow.
11. On a phone without WebGL2, or when the page fails: the office shows the 2D floor under the banner with Try again.
12. The store app ("Paseo") still shows the office in 2D only and is not changed.
13. The daemon's log (`$PASEO_HOME/daemon.log`) shows no new errors while the above runs.

For the controller, after the owner says yes to the upload (outside this plan, not a step of it): `gh release create fork-android-0.16.0-1 artifacts/paseo-fork-arm64.apk --repo allrested/paseo --prerelease --title "Paseo Fork 0.16.0 (Android, arm64)" --notes "<what the checklist covered>"`. The release notes carry no AI attribution.

---

## Order

Tasks 1, 3, 4 and 6 are independent and can run in parallel: they edit disjoint files (Task 3 and Task 4 both add `photo?: boolean` to `world-api.ts`; the second to merge keeps one copy). Task 2 follows Task 1 (it uses the page module and the kit's types). Task 5 needs Tasks 1, 3 and 4. Task 7 is last and needs all of them. A reasonable split: one agent on 1 then 2, one on 3 then 5, one on 4, one on 6; Task 7 by whoever holds an x86_64 host.

## Self-review

- **Spec coverage.**
  - `ScriptFrame`: props, ref, page side, queue, Android settings, load guard, CSP, web iframe and sandbox, detection, docs: Tasks 1 and 2 (the spec's `onShouldStartLoadWithRequest` rule is Task 1's third test; `localStorage` throwing on the web is Task 2's third test and the reference says so; `docs/plugins.md` links it, Tasks 2 and 5).
  - The office on Android: offered with `ScriptFrame` (Task 5, `canDraw3D`); no-WebGL2 as a problem under the existing banner (Task 4's page test, Task 5's view test, the surface's existing `officeView`); the bridge (Task 4); the page's side (Task 4); the hook and the native view (Tasks 3 and 5); Photo hidden (Task 4); Walk in and Full screen by their rules (existing `(pointer: fine)` at `camera-bar.js:257`, plus the page's forced `fullscreenEnabled` false in Task 4); brand logo `data:` only (Task 4's bridge test); `focusApp` nothing (Task 5, `noFocus`); graphics unchanged; panels as screens (unchanged code).
  - The fork's app: the variant (Task 6); the build, the signing, the output name (Task 6 and 7); the key (Task 7); the toolchain (Task 7); docs (Tasks 6 and 7); shipping (the controller's note at the end of Task 7, outside the plan).
  - Testing: every unit listed in the spec's "Testing" has a task (fake WebView, web in a real page, bridge against a fake frame, page script with a stand-in scene, native view with `ScriptFrame` faked, `office-surface`, `app.config.js`); build checks are Task 7 Step 8; phone checks are Step 10.
- **Placeholder scan.** No "TBD" or "similar to". The one value taken from outside is `<zip>` (the command-line tools file name and its checksum, read from Google's page at install time, because a pinned hash here could not be checked) and the NDK version, which Step 2 reads from the code.
- **Names agree across tasks.** `ScriptFrameProps`, `ScriptFrameHandle` (Task 1, used in 2 and 5); `scriptFrameHtml`, `createPostQueue`, `parsePageMessage`, `routePageMessage`, `deliverScript` (Task 1, used in 2); `useWorldFeed(api, input)`, `WorldFeedInput`, `PLAN` (Task 3, used in 5); `worldStartOptions`, `useWorldScript`, `useStandupBell`, `WorldLatest` (Task 3, used in 5); `createWorldBridge`, `WorldBridge.receive`, `bridgePageScript` (Task 4, used in 5); `photo?: boolean` on `WorldStartOptions` and `host.photo` (Tasks 3 and 4, used in 5); `hasScriptFrame`, `kitScriptFrame`, `canDraw3D`, `WorldViewNative` (Task 5); `APP_VARIANT=fork`, `build:apk:fork`, `artifacts/paseo-fork-arm64.apk` (Tasks 6 and 7).
- **Known soft spots, to check when running.** (1) The Android guard on loads: `loadDataWithBaseURL`'s first load may never reach `onShouldStartLoadWithRequest` on Android, in which case the guard only blocks later navigation; the CSP and the absent links make that enough, and the phone check confirms the page cannot leave. (2) The first `start` is queued behind the page's readiness, so the "Loading the 3D view..." line is gone as soon as the bridge starts, while the WebView may still be loading its page; if that shows a blank floor for seconds on the phone, a ready signal in the kit is the follow-up. (3) `ScriptFrame`'s `.native.tsx` also serves iOS; the reference says it is untested there.
