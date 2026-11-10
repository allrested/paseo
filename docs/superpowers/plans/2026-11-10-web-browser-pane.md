# Web Browser Pane Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The web UI and the native app show and drive a tab of the Docker Chromium, and agents' `browser_*` tools work on the same tab with no Electron app connected.

**Architecture:** The daemon talks raw CDP to the Chromium named by `PASEO_BROWSER_CDP_URL`. A `CdpBrowserService` registers with the existing `BrowserToolsBroker` as a browser host and runs the Electron automation engine (moved into the server package) against its own tabs. A `ScreencastHub` streams JPEG frames to clients as binary frames on the session WebSocket; clients send mouse, key and text input back. Everything is gated by `server_info.features.cdpBrowser`.

**Tech Stack:** TypeScript, Node `ws` and `fetch`, Chrome DevTools Protocol (Target, Page, Runtime, Input, Emulation), zod wire schemas, vitest, React Native + react-native-web, zustand, react-native-unistyles.

**Spec:** `docs/superpowers/specs/2026-11-10-web-browser-pane-design.md` (commit f21afe5de). Base: local `main` at bc045344c.

## Spec deviations

Each one is where the code or a live test contradicted the spec. The plan follows the better option. Task 18 folds them into the spec sections that own them.

- **D1. The engine moves into the server package, not a new workspace package.** Target: `packages/server/src/server/browser-automation/`, exported as `@getpaseo/server/browser-automation/*`. Desktop already depends on `@getpaseo/server`. A new package would touch the root workspace list, `build:server-deps`, the npm pack list in `docker/base/Dockerfile` and version sync, for seven files.
- **D2. A tab opens in its own background window** (`Target.createTarget` with `newWindow: true, background: true`), not as a background tab. Measured on the Docker Chromium (Chrome 154): a background tab is `hidden`, produced 0 screencast frames in 3 s, and `requestAnimationFrame` does not fire, which the engine's paint wait needs. A background window is `visible` and produced 11 frames in 3 s. Cost: one extra Chromium window per pane tab on the noVNC desktop.
- **D3. `Emulation.setDeviceMetricsOverride` uses `mobile: false`.** `mobile: true` gave a page scale of 0.398 on a 390 px wide viewport. A narrow width alone gives the responsive layout.
- **D4. The tab list and tab events are one owned subscription**, `browser.cdp.tabs.subscribe.request`: the response is the list, `browser.cdp.tabs.update` carries `opened`, `closed`, `state` and `host` events. This replaces `tab.list` plus three broadcast events. The repo has no broadcast-to-workspace path, and an owned subscription replays its snapshot on reconnect.
- **D5. `browser.cdp.view.input.request` has no response.** Input is a stream; `diff.unsubscribe.request` is the precedent for a request with no reply.
- **D6. Compose points at the existing loopback sidecar**, `PASEO_BROWSER_CDP_URL=http://127.0.0.1:9222` (`paseo-cdp`), in both compose files. A new `PASEO_BROWSER_TOOLS_ENABLED` variable is the default for browser tools; the persisted setting still wins. `CdpEndpoint` still resolves a host name on every connect and builds WebSocket URLs from its own origin.
- **D7. Dialogs are answered by CDP alone.** `CdpTab` answers every `Page.javascriptDialogOpening` with the engine's policy (`dialogAcceptValue`) and records it. The Electron prompt shim is not ported; it exists because Electron's webview cannot answer `prompt`.

## Chromium for tests

Unit tests use an in-process fake Chromium (`test-utils/fake-chromium.ts`: a real HTTP server and a real `ws` server on a loopback port, answering `/json/*` and CDP commands). They run in Fork CI with no new dependency, and they exercise real sockets, the `Host` check and the timeout path. One file, `cdp-host.local.e2e.test.ts`, runs against a real Chromium and is run by hand with `PASEO_TEST_CDP_URL` set. Its `local.e2e` name keeps it out of `test:unit` and out of Fork CI, so CI needs no Chromium. No Chromium is downloaded: the host is aarch64 with a 6 GiB cap, and Playwright's download adds about 300 MB to every CI run.

The real Chromium holds the user's logged-in profile. The e2e file creates its own tabs on `about:blank`, sets their DOM through `Runtime.evaluate`, and closes only the target ids it created.

## Global Constraints

- **Branch:** `feat/web-browser-pane`, cut from local `main`. No push, no tag, no restart of the daemon on port 6767.
- **Identity:** every commit uses `GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com`. Check with `git log -1 --format='%an <%ae> | %cn <%ce>'`.
- **Hook:** commit with `LEFTHOOK=0`, and only after the single-threaded typecheck, `npm run lint` and the task's tests passed on the same tree. The one exception is the move commit in Task 1, which cannot typecheck by design.
- **Memory (6 GiB cap):** one heavy command at a time, each as `flock -w 480 /tmp/paseo-heavy.lock <command>` with a 600000 ms tool timeout. Heavy means typecheck, vitest, build and `npm run lint`.
  - Typecheck per workspace: `npx tsgo --noEmit --singleThreaded`. In `packages/server` add `-p tsconfig.server.typecheck.json`; in `packages/desktop` add `-p tsconfig.json`. Never root `npm run typecheck`.
  - Tests: single files with `npx vitest run <file> --bail=1`. Several files in one run: add `--no-file-parallelism --maxWorkers=1`. Never a whole suite.
  - Lint and format through npm scripts only: `npm run lint` and `npm run format:files -- <files>` from the repo root.
- **Build order:** workspaces read each other's `dist`. After a protocol change run `npm run build --workspace=@getpaseo/protocol` before typechecking server or client. After a client change run `npm run build:client` before typechecking the app. After a server change that desktop consumes run `npm run build --workspace=@getpaseo/server` before typechecking desktop.
- **Daemon process safety:** every CDP call, socket handler, timer and event listener in `packages/server` catches its errors and reports them through the logger. An unhandled rejection or uncaught exception in the daemon stops every agent.
- **Protocol:** backward compatible. New fields are optional. Wire schemas are plain zod objects, with no `transform`, `catch` or `preprocess`. New RPCs are dotted (`docs/rpc-namespacing.md`). One capability gate: `server_info.features.cdpBrowser`.
- **CDP:** raw CDP only, never Playwright attach. Resolve the host name on every connect and connect to the IP, so the `Host` header is an IP. The daemon lists, drives and closes only targets in its own registry.
- **Limits:** at most 10 frames per second, JPEG quality 60, frame at most 1920x1080, device pixel ratio at most 2, hover moves at most 30 per second.
- **App code:** no `useUnistyles()` in new code; use `StyleSheet.create((theme) => ...)`. The pane has no hover-only UI. User-visible strings go through i18n. Platform splits use `.web.tsx` files, not `if (isWeb)` blocks.
- **Docs voice:** follow the repo `CLAUDE.md` rules for docs: plain sentences, no sales language.
- **Tests on the real Chromium** touch only tabs they create.

## File Structure

Names: the spec's `CdpTabContents` is `CdpTab` here, and its `CdpBrowserHost` is `CdpBrowserService`, because it also serves the view (tab events, viewport, screencast), not only the broker.

Moved (Task 1), from `packages/desktop/src/features/browser-automation/` to `packages/server/src/server/browser-automation/`:
`service.ts`, `snapshot-engine.ts`, `aria-snapshot-script.ts`, `actionability.ts`, `trusted-input.ts`, `dialog-handling.ts`, `cdp-session-queue.ts`, `service.test.ts`, `snapshot-engine.test.ts`, `trusted-input.test.ts`. `ipc.ts` and `ipc.test.ts` stay in desktop.

Server, new, under `packages/server/src/server/browser-tools/cdp/`:

| File                            | Responsibility                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------- |
| `cdp-connection.ts`             | One CDP WebSocket: correlated commands, events, timeout closes the socket                   |
| `test-utils/fake-chromium.ts`   | In-process fake Chromium for unit tests                                                     |
| `cdp-endpoint.ts`               | Host resolution, `/json/version`, `/json/list`, opening connections                         |
| `tab-registry.ts`               | `browserId -> target, workspace, lastUrl`, persisted JSON, reconcile, popup adoption        |
| `cdp-keys.ts`                   | Key name to CDP key event fields                                                            |
| `cdp-tab.ts`                    | `TabContents` over one target connection                                                    |
| `cdp-browser-service.ts`        | The browser host: connect loop, broker registration, open, close, execute, events, viewport |
| `create-cdp-browser-service.ts` | Builds the service from the daemon config                                                   |
| `screencast-hub.ts`             | One screencast per watched tab, fan-out, backpressure, ack pacing                           |
| `view-input.ts`                 | Client input message to CDP `Input.*`                                                       |
| `view-session.ts`               | Per-session RPC handlers and owned subscriptions                                            |
| `cdp-host.local.e2e.test.ts`    | Hand-run test against a real Chromium                                                       |

Server, modified: `browser-tools/broker.ts`, `config.ts`, `config-environment.ts`, `bootstrap.ts`, `session.ts`, `websocket-server.ts`, `authorization/operation-permissions.ts`, `package.json` (export).

Protocol, new: `src/browser-automation/cdp-view-schemas.ts`, `src/binary-frames/browser-view.ts`. Modified: `src/messages.ts`, `src/binary-frames/index.ts`.

Client, modified: `src/daemon-client.ts`.

App, new, under `packages/app/src/desktop/browser/cdp/`:

| File                                     | Responsibility                                                        |
| ---------------------------------------- | --------------------------------------------------------------------- |
| `view-model.ts`                          | Pure geometry: fit, point mapping, viewport, modifiers, move throttle |
| `tabs-store.ts`                          | Per-host tab state from the tabs subscription                         |
| `tabs-sync.ts`                           | Hook: subscription to store and workspace layout; `openCdpTab`        |
| `use-cdp-view.ts`                        | Hook: view subscription, latest frame, status, input and navigate     |
| `frame-image.web.tsx`, `frame-image.tsx` | Draw one JPEG frame                                                   |
| `input-layer.web.tsx`, `input-layer.tsx` | Pointer, wheel, touch, keyboard to input messages                     |
| `cdp-pane.tsx`                           | Toolbar, frame, states, agent badge                                   |

App, modified: `desktop/browser/pane/index.web.tsx`, `desktop/browser/pane/index.tsx`, `screens/workspace/workspace-screen.tsx`, `i18n/resources/*.ts`.

Other: `docker/docker-compose.yml`, `docker/docker-compose.agent.yml`, `docs/docker.md`.

---

# Phase 1: Engine move

Ends with the desktop app building and passing its browser tests against the engine in the server package. No behaviour change.

## Task 1: Move the engine files, byte-identical

**Files:**

- Move: the ten files listed under File Structure.

**Interfaces:**

- Consumes: nothing.
- Produces: the engine at `packages/server/src/server/browser-automation/`. Exports are unchanged: `TabContents`, `TabImage`, `BrowserRegistry`, `BrowserTabClosedError`, `executeAutomationCommand` (`service.ts`); `BrowserSnapshotEngine` (`snapshot-engine.ts`); `IsolatedKeyboardInputEvent`, `dispatchTrustedKey` (`trusted-input.ts`); `handledDialogEvent`, `dialogAcceptValue`, `JavaScriptDialogOpening`, `MAX_DIALOGS_PER_COMMAND` (`dialog-handling.ts`); `CdpSessionQueue`, `CdpCommandSender` (`cdp-session-queue.ts`).

- [ ] **Step 1: Create the branch**

```bash
cd /workspace/utils/paseo
git switch -c feat/web-browser-pane main
git status --short -- packages/desktop/src/features/browser-automation packages/server/src/server/browser-automation packages/server/src/server/browser-tools
# expect: no output. The checkout may hold other sessions' uncommitted files elsewhere; leave them
# alone and never stage them. Every commit in this plan stages named paths only.
```

- [ ] **Step 2: Move the files with `git mv`, changing nothing**

```bash
cd /workspace/utils/paseo
mkdir -p packages/server/src/server/browser-automation
for f in service.ts snapshot-engine.ts aria-snapshot-script.ts actionability.ts trusted-input.ts \
  dialog-handling.ts cdp-session-queue.ts service.test.ts snapshot-engine.test.ts trusted-input.test.ts; do
  git mv "packages/desktop/src/features/browser-automation/$f" "packages/server/src/server/browser-automation/$f"
done
ls packages/desktop/src/features/browser-automation   # expect: ipc.test.ts  ipc.ts
```

- [ ] **Step 3: Commit, then prove every file is a pure rename**

This tree does not typecheck: desktop's `ipc.ts` still imports `./service.js`. That is expected, and Task 2 fixes it. Do not edit any file in this commit.

```bash
GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com \
  LEFTHOOK=0 git commit -m "refactor(fork): move the browser automation engine into the server package"
git show --stat -M100% --format= HEAD | grep -c "=>"     # expect: 10
git show -M100% --name-status --format= HEAD | grep -vc "^R100"   # expect: 0
```

## Task 2: Point imports at the new location

**Files:**

- Modify: `packages/server/src/server/browser-automation/trusted-input.ts:1`
- Modify: `packages/server/package.json` (`exports`)
- Modify: `packages/desktop/src/features/browser-automation/ipc.ts:7-19`
- Modify: `packages/desktop/src/features/browser-automation/ipc.test.ts:2-4`

**Interfaces:**

- Consumes: Task 1's files.
- Produces: the export `@getpaseo/server/browser-automation/<module>` for desktop. Inside the server package, import with relative paths (`../../browser-automation/service.js` from `browser-tools/cdp/`).

- [ ] **Step 1: Drop the Electron type from `trusted-input.ts`**

The server package has no `electron` dependency. Replace line 1:

```ts
import type { KeyboardInputEvent } from "electron";
```

with:

```ts
// The one field of Electron's KeyboardInputEvent this engine sets. Declared here so the server
// package needs no Electron types. IsolatedKeyboardInputEvent stays assignable to Electron's type.
interface KeyboardInputEvent {
  keyCode: string;
}
```

- [ ] **Step 2: Export the engine from the server package**

In `packages/server/package.json`, add this entry to `exports`, after `"./process"`:

```json
    "./browser-automation/*": {
      "types": "./dist/server/server/browser-automation/*.d.ts",
      "source": "./src/server/browser-automation/*.ts",
      "default": "./dist/server/server/browser-automation/*.js"
    },
```

- [ ] **Step 3: Update desktop imports**

In `packages/desktop/src/features/browser-automation/ipc.ts`, change the module specifiers only, keeping the imported names:

| Old                             | New                                                       |
| ------------------------------- | --------------------------------------------------------- |
| `"./service.js"` (both imports) | `"@getpaseo/server/browser-automation/service"`           |
| `"./trusted-input.js"`          | `"@getpaseo/server/browser-automation/trusted-input"`     |
| `"./cdp-session-queue.js"`      | `"@getpaseo/server/browser-automation/cdp-session-queue"` |
| `"./dialog-handling.js"`        | `"@getpaseo/server/browser-automation/dialog-handling"`   |
| `"./snapshot-engine.js"`        | `"@getpaseo/server/browser-automation/snapshot-engine"`   |

In `ipc.test.ts`, change `"./service.js"` and `"./trusted-input.js"` the same way. `"./ipc.js"` and `"../browser-webviews/index.js"` stay.

```bash
cd /workspace/utils/paseo
grep -rn '"\./\(service\|trusted-input\|cdp-session-queue\|dialog-handling\|snapshot-engine\)\.js"' packages/desktop/src
# expect: no output
```

- [ ] **Step 4: Typecheck the server and run the moved tests from it**

```bash
cd /workspace/utils/paseo/packages/server
flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded -p tsconfig.server.typecheck.json
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-automation --no-file-parallelism --maxWorkers=1 --bail=1
```

Expected: typecheck exits 0; three test files pass with the same test count they had in desktop (`git stash` is not needed; compare with `git show main:packages/desktop/src/features/browser-automation/service.test.ts | grep -c "^\s*test(\|^\s*it("`).

- [ ] **Step 5: Build the server, then typecheck and test desktop**

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npm run build --workspace=@getpaseo/server
ls packages/server/dist/server/server/browser-automation/service.js packages/server/dist/server/server/browser-automation/service.d.ts
cd packages/desktop
flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded -p tsconfig.json
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/features/browser-automation/ipc.test.ts --bail=1
```

Expected: both `ls` paths exist, typecheck exits 0, `ipc.test.ts` passes. If vitest fails on a missing Electron binary, run `npx install-electron` once (the desktop `test` script does this) and rerun.

- [ ] **Step 6: Lint, format, commit**

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npm run lint
npm run format:files -- packages/server/package.json packages/server/src/server/browser-automation/trusted-input.ts \
  packages/desktop/src/features/browser-automation/ipc.ts packages/desktop/src/features/browser-automation/ipc.test.ts
git add packages/server/package.json packages/server/src/server/browser-automation/trusted-input.ts \
  packages/desktop/src/features/browser-automation/ipc.ts packages/desktop/src/features/browser-automation/ipc.test.ts
git status --short | grep "^[MARD]"   # expect: exactly those four files
GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com \
  LEFTHOOK=0 git commit -m "refactor(fork): import the browser automation engine from @getpaseo/server"
```

**Phase 1 checkpoint:** desktop typechecks and `ipc.test.ts` passes against the built server; the engine's own tests pass in the server package.

---

# Phase 2: Daemon CDP host

Ends with a deployable daemon: with `PASEO_BROWSER_CDP_URL` set, agents' `browser_*` tools work against the Docker Chromium with no Electron app connected. No UI change, no protocol change.

All new server files in this phase live in `packages/server/src/server/browser-tools/cdp/`. Commands run from `packages/server` unless a step says otherwise.

## Task 3: `CdpConnection` and the fake Chromium

**Files:**

- Create: `packages/server/src/server/browser-tools/cdp/cdp-connection.ts`
- Create: `packages/server/src/server/browser-tools/cdp/test-utils/fake-chromium.ts`
- Test: `packages/server/src/server/browser-tools/cdp/cdp-connection.test.ts`

**Interfaces:**

- Consumes: the `ws` package (already a server dependency).
- Produces:
  - `class CdpConnection` with `static open(options: CdpConnectionOptions): Promise<CdpConnection>`, `send<T>(method: string, params?: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<T>`, `on(event: string, listener: (params: Record<string, unknown>) => void): () => void`, `onClose(listener: () => void): () => void`, `readonly closed: boolean`, `close(): void`.
  - `CdpTimeoutError`, `CdpClosedError`, `CdpCommandError` (`method`, `code`).
  - `startFakeChromium(): Promise<FakeChromium>` for tests.

- [ ] **Step 1: Write the fake Chromium**

`test-utils/` is excluded from the server build (`src/server/**/test-utils/**`), so this file never ships.

```ts
// packages/server/src/server/browser-tools/cdp/test-utils/fake-chromium.ts
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";

export interface FakeTarget {
  id: string;
  type: string;
  url: string;
  title: string;
  openerId?: string;
}

export interface FakeCommand {
  targetId: string; // "browser" for the browser socket
  method: string;
  params: Record<string, unknown>;
}

type Handler = (params: Record<string, unknown>, targetId: string) => unknown;

export interface FakeChromium {
  readonly url: string;
  readonly port: number;
  readonly targets: Map<string, FakeTarget>;
  readonly hostHeaders: string[];
  readonly commands: FakeCommand[];
  /** Replaces the answer for one method. Throwing answers with a CDP error. */
  handle(method: string, handler: Handler): void;
  /** The method never answers, so the caller times out. */
  stall(method: string): void;
  emit(targetId: string, method: string, params: Record<string, unknown>): void;
  addTarget(input?: Partial<FakeTarget>): FakeTarget;
  destroyTarget(targetId: string): void;
  socketCount(targetId: string): number;
  close(): Promise<void>;
}

const IP_HOST = /^(\d{1,3}\.){3}\d{1,3}(:\d+)?$/;

export async function startFakeChromium(): Promise<FakeChromium> {
  const targets = new Map<string, FakeTarget>();
  const hostHeaders: string[] = [];
  const commands: FakeCommand[] = [];
  const handlers = new Map<string, Handler>();
  const stalled = new Set<string>();
  const sockets = new Map<string, Set<WebSocket>>();

  const emit = (targetId: string, method: string, params: Record<string, unknown>) => {
    for (const socket of sockets.get(targetId) ?? [])
      socket.send(JSON.stringify({ method, params }));
  };
  const addTarget = (input: Partial<FakeTarget> = {}): FakeTarget => {
    const target: FakeTarget = {
      id: input.id ?? randomUUID().replaceAll("-", "").toUpperCase(),
      type: input.type ?? "page",
      url: input.url ?? "about:blank",
      title: input.title ?? "",
      ...(input.openerId ? { openerId: input.openerId } : {}),
    };
    targets.set(target.id, target);
    emit("browser", "Target.targetCreated", {
      targetInfo: {
        targetId: target.id,
        type: target.type,
        url: target.url,
        title: target.title,
        openerId: target.openerId,
      },
    });
    return target;
  };
  const destroyTarget = (targetId: string) => {
    if (!targets.delete(targetId)) return;
    for (const socket of sockets.get(targetId) ?? []) socket.close();
    sockets.delete(targetId);
    emit("browser", "Target.targetDestroyed", { targetId });
  };

  handlers.set("Target.createTarget", (params) => ({
    targetId: addTarget({ url: typeof params.url === "string" ? params.url : "about:blank" }).id,
  }));
  handlers.set("Target.closeTarget", (params) => {
    destroyTarget(String(params.targetId));
    return { success: true };
  });
  handlers.set("Runtime.evaluate", () => ({ result: { type: "undefined" } }));
  handlers.set("Page.getNavigationHistory", (_params, targetId) => {
    const target = targets.get(targetId);
    return {
      currentIndex: 0,
      entries: [{ id: 1, url: target?.url ?? "", title: target?.title ?? "" }],
    };
  });

  const http: Server = createServer((request, response) => {
    const host = request.headers.host ?? "";
    hostHeaders.push(host);
    // Chrome answers 500 to any Host header that is not an IP or localhost.
    if (!IP_HOST.test(host) && !host.startsWith("localhost")) {
      response
        .writeHead(500)
        .end("Host header is specified and is not an IP address or localhost.");
      return;
    }
    // The advertised WebSocket URLs carry a wrong origin on purpose: a client must not use them as-is.
    const json = (body: unknown) =>
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    if (request.url === "/json/version") {
      json({
        Browser: "FakeChromium/1.0",
        webSocketDebuggerUrl: "ws://127.0.0.1:1/devtools/browser/fake-browser",
      });
      return;
    }
    if (request.url === "/json/list") {
      json(
        [...targets.values()].map((target) => ({
          ...target,
          webSocketDebuggerUrl: `ws://127.0.0.1:1/devtools/page/${target.id}`,
        })),
      );
      return;
    }
    response.writeHead(404).end();
  });

  const wss = new WebSocketServer({ noServer: true });
  http.on("upgrade", (request, socket, head) => {
    const match = /^\/devtools\/(browser|page)\/(.+)$/.exec(request.url ?? "");
    const targetId = match?.[1] === "browser" ? "browser" : match?.[2];
    if (!targetId || (targetId !== "browser" && !targets.has(targetId))) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      const set = sockets.get(targetId) ?? new Set<WebSocket>();
      sockets.set(targetId, set);
      set.add(ws);
      ws.on("close", () => set.delete(ws));
      ws.on("message", (data) => {
        const message = JSON.parse(String(data)) as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
        };
        const params = message.params ?? {};
        commands.push({ targetId, method: message.method, params });
        if (stalled.has(message.method)) return;
        try {
          const result = handlers.get(message.method)?.(params, targetId) ?? {};
          ws.send(JSON.stringify({ id: message.id, result }));
        } catch (error) {
          ws.send(
            JSON.stringify({
              id: message.id,
              error: { code: -32000, message: String((error as Error).message) },
            }),
          );
        }
      });
    });
  });

  await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
  const port = (http.address() as AddressInfo).port;

  return {
    url: `http://127.0.0.1:${port}`,
    port,
    targets,
    hostHeaders,
    commands,
    handle: (method, handler) => void handlers.set(method, handler),
    stall: (method) => void stalled.add(method),
    emit,
    addTarget,
    destroyTarget,
    socketCount: (targetId) => sockets.get(targetId)?.size ?? 0,
    close: async () => {
      for (const set of sockets.values()) for (const socket of set) socket.terminate();
      wss.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
```

- [ ] **Step 2: Write the failing test**

```ts
// packages/server/src/server/browser-tools/cdp/cdp-connection.test.ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
  CdpClosedError,
  CdpCommandError,
  CdpConnection,
  CdpTimeoutError,
} from "./cdp-connection.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";

describe("CdpConnection", () => {
  let chromium: FakeChromium;
  let targetId: string;
  const open = (commandTimeoutMs?: number) =>
    CdpConnection.open({
      url: `ws://127.0.0.1:${chromium.port}/devtools/page/${targetId}`,
      commandTimeoutMs,
    });

  beforeEach(async () => {
    chromium = await startFakeChromium();
    targetId = chromium.addTarget().id;
  });
  afterEach(async () => {
    await chromium.close();
  });

  test("answers a command with its result", async () => {
    chromium.handle("Runtime.evaluate", () => ({ result: { type: "number", value: 2 } }));
    const connection = await open();
    await expect(connection.send("Runtime.evaluate", { expression: "1+1" })).resolves.toEqual({
      result: { type: "number", value: 2 },
    });
    expect(chromium.commands).toEqual([
      { targetId, method: "Runtime.evaluate", params: { expression: "1+1" } },
    ]);
    connection.close();
  });

  test("rejects with the CDP error", async () => {
    chromium.handle("Page.navigate", () => {
      throw new Error("Cannot navigate to invalid URL");
    });
    const connection = await open();
    const failure = await connection.send("Page.navigate", { url: "x" }).catch((error) => error);
    expect(failure).toBeInstanceOf(CdpCommandError);
    expect((failure as CdpCommandError).method).toBe("Page.navigate");
    expect((failure as CdpCommandError).message).toBe("Cannot navigate to invalid URL");
    connection.close();
  });

  test("delivers events to listeners until they unsubscribe", async () => {
    const connection = await open();
    const seen: unknown[] = [];
    const off = connection.on("Page.loadEventFired", (params) => seen.push(params));
    await connection.send("Page.enable");
    chromium.emit(targetId, "Page.loadEventFired", { timestamp: 1 });
    await connection.send("Page.enable");
    off();
    chromium.emit(targetId, "Page.loadEventFired", { timestamp: 2 });
    await connection.send("Page.enable");
    expect(seen).toEqual([{ timestamp: 1 }]);
    connection.close();
  });

  test("a timed-out command closes the socket and fails the others", async () => {
    chromium.stall("Page.captureScreenshot");
    const connection = await open(50);
    const closed = new Promise<void>((resolve) => connection.onClose(resolve));
    await expect(connection.send("Page.captureScreenshot")).rejects.toBeInstanceOf(CdpTimeoutError);
    await closed;
    expect(connection.closed).toBe(true);
    await expect(connection.send("Page.enable")).rejects.toBeInstanceOf(CdpClosedError);
  });

  test("a listener that throws is reported and does not break the socket", async () => {
    const errors: unknown[] = [];
    const connection = await CdpConnection.open({
      url: `ws://127.0.0.1:${chromium.port}/devtools/page/${targetId}`,
      onError: (error) => errors.push(error),
    });
    connection.on("Page.loadEventFired", () => {
      throw new Error("listener failed");
    });
    chromium.emit(targetId, "Page.loadEventFired", {});
    await expect(connection.send("Page.enable")).resolves.toEqual({});
    expect(errors).toHaveLength(1);
    connection.close();
  });

  test("rejects open when nothing listens", async () => {
    await expect(
      CdpConnection.open({ url: "ws://127.0.0.1:1/devtools/page/x", connectTimeoutMs: 500 }),
    ).rejects.toBeInstanceOf(CdpClosedError);
  });
});
```

- [ ] **Step 3: Run it and see it fail**

```bash
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/cdp-connection.test.ts --bail=1
```

Expected: FAIL, cannot resolve `./cdp-connection.js`.

- [ ] **Step 4: Implement `CdpConnection`**

```ts
// packages/server/src/server/browser-tools/cdp/cdp-connection.ts
import { WebSocket } from "ws";

export class CdpTimeoutError extends Error {
  constructor(
    readonly method: string,
    timeoutMs: number,
  ) {
    super(`CDP ${method} timed out after ${timeoutMs}ms`);
    this.name = "CdpTimeoutError";
  }
}

export class CdpClosedError extends Error {
  constructor(message = "CDP connection is closed") {
    super(message);
    this.name = "CdpClosedError";
  }
}

export class CdpCommandError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "CdpCommandError";
  }
}

export interface CdpConnectionOptions {
  url: string;
  commandTimeoutMs?: number;
  connectTimeoutMs?: number;
  onError?: (error: unknown) => void;
}

type Listener = (params: Record<string, unknown>) => void;

interface Pending {
  method: string;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const DEFAULT_CONNECT_TIMEOUT_MS = 5_000;

export class CdpConnection {
  private nextId = 1;
  private isClosed = false;
  private readonly pending = new Map<number, Pending>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly closeListeners = new Set<() => void>();

  private constructor(
    private readonly socket: WebSocket,
    private readonly commandTimeoutMs: number,
    private readonly onError: (error: unknown) => void,
  ) {
    socket.on("message", (data) => this.receive(String(data)));
    socket.on("close", () => this.finish());
    // Without an error listener, ws raises an uncaught exception in the daemon.
    socket.on("error", (error) => {
      this.onError(error);
      this.finish();
    });
  }

  static open(options: CdpConnectionOptions): Promise<CdpConnection> {
    const onError = options.onError ?? (() => {});
    return new Promise<CdpConnection>((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(options.url, {
        handshakeTimeout: options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        perMessageDeflate: false,
        maxPayload: 256 * 1024 * 1024,
      });
      const fail = (error: unknown) => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        socket.on("error", () => {});
        socket.terminate();
        reject(
          new CdpClosedError(
            `CDP connect failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      };
      socket.once("error", fail);
      socket.once("close", () => fail(new Error("closed before open")));
      socket.once("open", () => {
        if (settled) return;
        settled = true;
        socket.removeAllListeners();
        resolve(
          new CdpConnection(
            socket,
            options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
            onError,
          ),
        );
      });
    });
  }

  get closed(): boolean {
    return this.isClosed;
  }

  send<T = Record<string, unknown>>(
    method: string,
    params: Record<string, unknown> = {},
    options?: { timeoutMs?: number },
  ): Promise<T> {
    if (this.isClosed) return Promise.reject(new CdpClosedError());
    const id = this.nextId++;
    const timeoutMs = options?.timeoutMs ?? this.commandTimeoutMs;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.delete(id)) return;
        reject(new CdpTimeoutError(method, timeoutMs));
        // A reused socket would hand the late reply to the next caller's reader.
        this.close();
      }, timeoutMs);
      this.pending.set(id, { method, resolve: resolve as (value: unknown) => void, reject, timer });
      try {
        this.socket.send(JSON.stringify({ id, method, params }), (error) => {
          if (!error || !this.pending.delete(id)) return;
          clearTimeout(timer);
          reject(new CdpClosedError(`CDP send failed: ${error.message}`));
        });
      } catch (error) {
        this.pending.delete(id);
        clearTimeout(timer);
        reject(
          new CdpClosedError(
            `CDP send failed: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    });
  }

  on(event: string, listener: Listener): () => void {
    const set = this.listeners.get(event) ?? new Set<Listener>();
    this.listeners.set(event, set);
    set.add(listener);
    return () => set.delete(listener);
  }

  onClose(listener: () => void): () => void {
    if (this.isClosed) {
      this.guard(listener);
      return () => {};
    }
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  close(): void {
    if (this.isClosed) return;
    try {
      this.socket.terminate();
    } catch (error) {
      this.onError(error);
    }
    this.finish();
  }

  private receive(raw: string): void {
    let message: {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
      result?: unknown;
      error?: { code?: number; message?: string };
    };
    try {
      message = JSON.parse(raw);
    } catch (error) {
      this.onError(error);
      return;
    }
    if (typeof message.id === "number") {
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      clearTimeout(pending.timer);
      if (message.error) {
        pending.reject(
          new CdpCommandError(
            pending.method,
            message.error.code ?? 0,
            message.error.message ?? "CDP error",
          ),
        );
      } else {
        pending.resolve(message.result ?? {});
      }
      return;
    }
    if (typeof message.method !== "string") return;
    const params = message.params ?? {};
    for (const listener of this.listeners.get(message.method) ?? [])
      this.guard(() => listener(params));
  }

  private finish(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    for (const [id, pending] of this.pending) {
      this.pending.delete(id);
      clearTimeout(pending.timer);
      pending.reject(new CdpClosedError());
    }
    for (const listener of this.closeListeners) this.guard(listener);
    this.closeListeners.clear();
    this.listeners.clear();
  }

  private guard(run: () => void): void {
    try {
      run();
    } catch (error) {
      this.onError(error);
    }
  }
}
```

- [ ] **Step 5: Run the test and see it pass**

```bash
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/cdp-connection.test.ts --bail=1
```

Expected: 6 passed.

- [ ] **Step 6: Typecheck, lint, format, commit**

```bash
flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded -p tsconfig.server.typecheck.json
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npm run lint
npm run format:files -- packages/server/src/server/browser-tools/cdp
git add packages/server/src/server/browser-tools/cdp
GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com \
  LEFTHOOK=0 git commit -m "feat(fork): raw CDP connection for the daemon browser host"
```

Every later task ends with this same step: server typecheck (or the workspace named in the task), `npm run lint`, `npm run format:files -- <changed files>`, `git add <the files the task lists>` (never `git add -A`), then the commit command with the message the task gives. The steps below write it as "Verify and commit" with the message only.

## Task 4: `CdpEndpoint`

**Files:**

- Create: `packages/server/src/server/browser-tools/cdp/cdp-endpoint.ts`
- Test: `packages/server/src/server/browser-tools/cdp/cdp-endpoint.test.ts`

**Interfaces:**

- Consumes: `CdpConnection.open` (Task 3).
- Produces:
  - `interface CdpTargetInfo { id: string; type: string; url: string; title: string; openerId?: string }`
  - `class CdpUnreachableError extends Error`
  - `class CdpEndpoint` with `constructor(options: CdpEndpointOptions)`, `listTargets(): Promise<CdpTargetInfo[]>`, `connectBrowser(): Promise<CdpConnection>`, `connectTarget(targetId: string): Promise<CdpConnection>`.
  - `interface CdpEndpointOptions { url: string; lookup?: (hostname: string) => Promise<string>; fetchTimeoutMs?: number; commandTimeoutMs?: number; onError?: (error: unknown) => void }`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/server/browser-tools/cdp/cdp-endpoint.test.ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CdpEndpoint, CdpUnreachableError } from "./cdp-endpoint.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";

describe("CdpEndpoint", () => {
  let chromium: FakeChromium;
  beforeEach(async () => {
    chromium = await startFakeChromium();
  });
  afterEach(async () => {
    await chromium.close();
  });

  test("resolves the host name on every call and sends an IP Host header", async () => {
    const lookups: string[] = [];
    const endpoint = new CdpEndpoint({
      url: `http://mdaq-browser:${chromium.port}`,
      lookup: async (hostname) => {
        lookups.push(hostname);
        return "127.0.0.1";
      },
    });
    chromium.addTarget({ id: "T1", url: "https://example.com/", title: "Example" });
    await endpoint.listTargets();
    await endpoint.listTargets();
    expect(lookups).toEqual(["mdaq-browser", "mdaq-browser"]);
    expect(chromium.hostHeaders).toEqual([
      `127.0.0.1:${chromium.port}`,
      `127.0.0.1:${chromium.port}`,
    ]);
  });

  test("lists page targets only", async () => {
    chromium.addTarget({ id: "T1", url: "https://example.com/", title: "Example" });
    chromium.addTarget({ id: "W1", type: "service_worker", url: "https://example.com/sw.js" });
    chromium.addTarget({ id: "T2", url: "about:blank", openerId: "T1" });
    const endpoint = new CdpEndpoint({ url: chromium.url });
    await expect(endpoint.listTargets()).resolves.toEqual([
      { id: "T1", type: "page", url: "https://example.com/", title: "Example" },
      { id: "T2", type: "page", url: "about:blank", title: "", openerId: "T1" },
    ]);
  });

  test("connects to a target and to the browser through its own origin", async () => {
    const target = chromium.addTarget();
    const endpoint = new CdpEndpoint({ url: chromium.url });
    const page = await endpoint.connectTarget(target.id);
    const browser = await endpoint.connectBrowser();
    await page.send("Page.enable");
    await browser.send("Target.setDiscoverTargets", { discover: true });
    expect(chromium.commands.map((command) => command.targetId)).toEqual([target.id, "browser"]);
    page.close();
    browser.close();
  });

  test("an unreachable endpoint fails with CdpUnreachableError", async () => {
    const endpoint = new CdpEndpoint({ url: "http://127.0.0.1:1", fetchTimeoutMs: 500 });
    await expect(endpoint.listTargets()).rejects.toBeInstanceOf(CdpUnreachableError);
    await expect(endpoint.connectBrowser()).rejects.toBeInstanceOf(CdpUnreachableError);
  });

  test("a failed lookup fails with CdpUnreachableError", async () => {
    const endpoint = new CdpEndpoint({
      url: "http://gone:9223",
      lookup: async () => {
        throw new Error("ENOTFOUND gone");
      },
    });
    await expect(endpoint.listTargets()).rejects.toBeInstanceOf(CdpUnreachableError);
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/cdp-endpoint.test.ts --bail=1
```

Expected: FAIL, cannot resolve `./cdp-endpoint.js`.

- [ ] **Step 3: Implement `CdpEndpoint`**

```ts
// packages/server/src/server/browser-tools/cdp/cdp-endpoint.ts
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { CdpConnection } from "./cdp-connection.js";

export interface CdpTargetInfo {
  id: string;
  type: string;
  url: string;
  title: string;
  openerId?: string;
}

export class CdpUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CdpUnreachableError";
  }
}

export interface CdpEndpointOptions {
  url: string;
  lookup?: (hostname: string) => Promise<string>;
  fetchTimeoutMs?: number;
  commandTimeoutMs?: number;
  onError?: (error: unknown) => void;
}

const DEFAULT_FETCH_TIMEOUT_MS = 5_000;

export class CdpEndpoint {
  private readonly hostname: string;
  private readonly port: string;
  private readonly lookup: (hostname: string) => Promise<string>;

  constructor(private readonly options: CdpEndpointOptions) {
    const url = new URL(options.url);
    this.hostname = url.hostname;
    this.port = url.port || "80";
    this.lookup =
      options.lookup ?? (async (hostname) => (await dnsLookup(hostname, { family: 4 })).address);
  }

  async listTargets(): Promise<CdpTargetInfo[]> {
    const list = await this.getJson("/json/list");
    if (!Array.isArray(list)) throw new CdpUnreachableError("CDP /json/list did not return a list");
    return list
      .filter(
        (entry): entry is Record<string, unknown> => typeof entry === "object" && entry !== null,
      )
      .filter((entry) => entry.type === "page" && typeof entry.id === "string")
      .map((entry) => ({
        id: String(entry.id),
        type: "page",
        url: typeof entry.url === "string" ? entry.url : "",
        title: typeof entry.title === "string" ? entry.title : "",
        ...(typeof entry.openerId === "string" ? { openerId: entry.openerId } : {}),
      }));
  }

  async connectBrowser(): Promise<CdpConnection> {
    const version = await this.getJson("/json/version");
    const advertised =
      typeof version === "object" && version !== null
        ? (version as Record<string, unknown>).webSocketDebuggerUrl
        : undefined;
    if (typeof advertised !== "string") {
      throw new CdpUnreachableError("CDP /json/version has no webSocketDebuggerUrl");
    }
    // Chrome advertises ws://127.0.0.1:9222/...; only the path is valid from here.
    return this.connect(new URL(advertised).pathname);
  }

  connectTarget(targetId: string): Promise<CdpConnection> {
    return this.connect(`/devtools/page/${encodeURIComponent(targetId)}`);
  }

  /** `ip:port`, resolved now. Docker changes a container's IP on restart, so nothing caches this. */
  private async origin(): Promise<string> {
    if (this.hostname === "localhost" || isIP(this.hostname) !== 0)
      return `${this.hostname}:${this.port}`;
    try {
      return `${await this.lookup(this.hostname)}:${this.port}`;
    } catch (error) {
      throw new CdpUnreachableError(`Cannot resolve ${this.hostname}: ${describe(error)}`);
    }
  }

  private async getJson(path: string): Promise<unknown> {
    const origin = await this.origin();
    try {
      // Connecting to the IP makes the Host header an IP, which is the only kind Chrome accepts.
      const response = await fetch(`http://${origin}${path}`, {
        signal: AbortSignal.timeout(this.options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      throw new CdpUnreachableError(`CDP ${path} failed: ${describe(error)}`);
    }
  }

  private async connect(path: string): Promise<CdpConnection> {
    const origin = await this.origin();
    try {
      return await CdpConnection.open({
        url: `ws://${origin}${path}`,
        commandTimeoutMs: this.options.commandTimeoutMs,
        connectTimeoutMs: this.options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
        onError: this.options.onError,
      });
    } catch (error) {
      throw new CdpUnreachableError(describe(error));
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/cdp-endpoint.test.ts --bail=1
```

Expected: 5 passed.

- [ ] **Step 5: Verify and commit**

Message: `feat(fork): CDP endpoint that resolves its host on every connect`

## Task 5: `CdpTabRegistry`

**Files:**

- Create: `packages/server/src/server/browser-tools/cdp/tab-registry.ts`
- Test: `packages/server/src/server/browser-tools/cdp/tab-registry.test.ts`

**Interfaces:**

- Consumes: `writeJsonFileAtomic(filePath, value)` from `packages/server/src/server/atomic-file.ts`.
- Produces:
  - `interface CdpTabEntry { browserId: string; targetId: string; workspaceId: string; lastUrl: string; createdAt: number }`
  - `class CdpTabRegistry` with `constructor(filePath: string, onError?: (error: unknown) => void)`, `load(): Promise<void>`, `list(): CdpTabEntry[]`, `get(browserId): CdpTabEntry | null`, `findByTarget(targetId): CdpTabEntry | null`, `add(entry: CdpTabEntry): void`, `remove(browserId): CdpTabEntry | null`, `setLastUrl(browserId, url): void`, `reconcile(liveTargetIds: ReadonlySet<string>): CdpTabEntry[]` (returns the dropped entries), `adoptPopup(input: { targetId: string; openerId: string; url: string; browserId: string; now: number }): CdpTabEntry | null`, `flush(): Promise<void>`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/server/browser-tools/cdp/tab-registry.test.ts
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CdpTabRegistry, type CdpTabEntry } from "./tab-registry.js";

const entry = (overrides: Partial<CdpTabEntry> = {}): CdpTabEntry => ({
  browserId: "11111111-1111-4111-8111-111111111111",
  targetId: "T1",
  workspaceId: "ws-a",
  lastUrl: "https://example.com/",
  createdAt: 1,
  ...overrides,
});

describe("CdpTabRegistry", () => {
  let dir: string;
  let file: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "paseo-cdp-tabs-"));
    file = path.join(dir, "browser-tools", "cdp-tabs.json");
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("persists entries and loads them back", async () => {
    const registry = new CdpTabRegistry(file);
    await registry.load();
    registry.add(entry());
    registry.setLastUrl(entry().browserId, "https://example.com/next");
    await registry.flush();

    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({
      version: 1,
      tabs: [entry({ lastUrl: "https://example.com/next" })],
    });
    const reloaded = new CdpTabRegistry(file);
    await reloaded.load();
    expect(reloaded.list()).toEqual([entry({ lastUrl: "https://example.com/next" })]);
    expect(reloaded.findByTarget("T1")?.browserId).toBe(entry().browserId);
  });

  test("a missing or corrupt file loads as empty", async () => {
    const missing = new CdpTabRegistry(file);
    await missing.load();
    expect(missing.list()).toEqual([]);

    const errors: unknown[] = [];
    const corruptFile = path.join(dir, "corrupt.json");
    await writeFile(corruptFile, "{not json");
    const corrupt = new CdpTabRegistry(corruptFile, (error) => errors.push(error));
    await corrupt.load();
    expect(corrupt.list()).toEqual([]);
    expect(errors).toHaveLength(1);
  });

  test("reconcile drops entries whose target is gone and returns them", async () => {
    const registry = new CdpTabRegistry(file);
    await registry.load();
    const kept = entry();
    const gone = entry({ browserId: "22222222-2222-4222-8222-222222222222", targetId: "T2" });
    registry.add(kept);
    registry.add(gone);
    expect(registry.reconcile(new Set(["T1", "OTHER"]))).toEqual([gone]);
    expect(registry.list()).toEqual([kept]);
  });

  test("a popup joins its opener's workspace; a stranger's popup is ignored", async () => {
    const registry = new CdpTabRegistry(file);
    await registry.load();
    registry.add(entry());
    const popupId = "33333333-3333-4333-8333-333333333333";
    expect(
      registry.adoptPopup({
        targetId: "P1",
        openerId: "T1",
        url: "https://example.com/popup",
        browserId: popupId,
        now: 5,
      }),
    ).toEqual({
      browserId: popupId,
      targetId: "P1",
      workspaceId: "ws-a",
      lastUrl: "https://example.com/popup",
      createdAt: 5,
    });
    expect(
      registry.adoptPopup({
        targetId: "P2",
        openerId: "UNKNOWN",
        url: "about:blank",
        browserId: popupId,
        now: 6,
      }),
    ).toBeNull();
    // The same target is never adopted twice.
    expect(
      registry.adoptPopup({
        targetId: "P1",
        openerId: "T1",
        url: "about:blank",
        browserId: "44444444-4444-4444-8444-444444444444",
        now: 7,
      }),
    ).toBeNull();
    expect(registry.list()).toHaveLength(2);
  });

  test("remove returns the entry once", async () => {
    const registry = new CdpTabRegistry(file);
    await registry.load();
    registry.add(entry());
    expect(registry.remove(entry().browserId)).toEqual(entry());
    expect(registry.remove(entry().browserId)).toBeNull();
    expect(registry.get(entry().browserId)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and see it fail**

```bash
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/tab-registry.test.ts --bail=1
```

Expected: FAIL, cannot resolve `./tab-registry.js`.

- [ ] **Step 3: Implement `CdpTabRegistry`**

```ts
// packages/server/src/server/browser-tools/cdp/tab-registry.ts
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { writeJsonFileAtomic } from "../../atomic-file.js";

const CdpTabEntrySchema = z.object({
  browserId: z.string(),
  targetId: z.string(),
  workspaceId: z.string(),
  lastUrl: z.string(),
  createdAt: z.number(),
});
const CdpTabFileSchema = z.object({ version: z.literal(1), tabs: z.array(CdpTabEntrySchema) });

export type CdpTabEntry = z.infer<typeof CdpTabEntrySchema>;

/** The tabs this daemon opened. Any target not listed here belongs to someone else. */
export class CdpTabRegistry {
  private readonly tabs = new Map<string, CdpTabEntry>();
  private dirty = false;
  private writing: Promise<void> | null = null;

  constructor(
    private readonly filePath: string,
    private readonly onError: (error: unknown) => void = () => {},
  ) {}

  async load(): Promise<void> {
    this.tabs.clear();
    try {
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const parsed = CdpTabFileSchema.parse(JSON.parse(await readFile(this.filePath, "utf8")));
      for (const tab of parsed.tabs) this.tabs.set(tab.browserId, tab);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") this.onError(error);
    }
  }

  list(): CdpTabEntry[] {
    return [...this.tabs.values()];
  }

  get(browserId: string): CdpTabEntry | null {
    return this.tabs.get(browserId) ?? null;
  }

  findByTarget(targetId: string): CdpTabEntry | null {
    for (const tab of this.tabs.values()) if (tab.targetId === targetId) return tab;
    return null;
  }

  add(entry: CdpTabEntry): void {
    this.tabs.set(entry.browserId, entry);
    this.schedule();
  }

  remove(browserId: string): CdpTabEntry | null {
    const entry = this.tabs.get(browserId) ?? null;
    if (entry) {
      this.tabs.delete(browserId);
      this.schedule();
    }
    return entry;
  }

  setLastUrl(browserId: string, url: string): void {
    const entry = this.tabs.get(browserId);
    if (!entry || entry.lastUrl === url) return;
    this.tabs.set(browserId, { ...entry, lastUrl: url });
    this.schedule();
  }

  reconcile(liveTargetIds: ReadonlySet<string>): CdpTabEntry[] {
    const dropped = this.list().filter((tab) => !liveTargetIds.has(tab.targetId));
    for (const tab of dropped) this.tabs.delete(tab.browserId);
    if (dropped.length > 0) this.schedule();
    return dropped;
  }

  adoptPopup(input: {
    targetId: string;
    openerId: string;
    url: string;
    browserId: string;
    now: number;
  }): CdpTabEntry | null {
    const opener = this.findByTarget(input.openerId);
    if (!opener || this.findByTarget(input.targetId)) return null;
    const entry: CdpTabEntry = {
      browserId: input.browserId,
      targetId: input.targetId,
      workspaceId: opener.workspaceId,
      lastUrl: input.url,
      createdAt: input.now,
    };
    this.add(entry);
    return entry;
  }

  flush(): Promise<void> {
    return this.writing ?? Promise.resolve();
  }

  /** One writer at a time; changes made during a write are picked up by the next loop turn. */
  private schedule(): void {
    this.dirty = true;
    if (this.writing) return;
    this.writing = this.drain().finally(() => {
      this.writing = null;
    });
  }

  private async drain(): Promise<void> {
    while (this.dirty) {
      this.dirty = false;
      try {
        await writeJsonFileAtomic(this.filePath, { version: 1, tabs: this.list() });
      } catch (error) {
        this.onError(error);
      }
    }
  }
}
```

- [ ] **Step 4: Run the test and see it pass**

```bash
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/tab-registry.test.ts --bail=1
```

Expected: 5 passed.

- [ ] **Step 5: Verify and commit**

Message: `feat(fork): persisted registry of the daemon's own browser tabs`

## Task 6: `CdpTab`, the engine's `TabContents` over CDP

**Files:**

- Create: `packages/server/src/server/browser-tools/cdp/cdp-keys.ts`
- Create: `packages/server/src/server/browser-tools/cdp/cdp-tab.ts`
- Test: `packages/server/src/server/browser-tools/cdp/cdp-keys.test.ts`
- Test: `packages/server/src/server/browser-tools/cdp/cdp-tab.test.ts`

**Interfaces:**

- Consumes: `CdpConnection` (Task 3); `TabContents`, `TabImage` from `../../browser-automation/service.js`; `IsolatedKeyboardInputEvent` from `../../browser-automation/trusted-input.js`; `handledDialogEvent`, `dialogAcceptValue`, `MAX_DIALOGS_PER_COMMAND` from `../../browser-automation/dialog-handling.js`.
- Produces:
  - `keyDefinition(name: string): { key: string; code: string; vk: number; text?: string }`, `virtualKeyCode(key: string): number`, `cdpKeyEvent(event: { type: "char" | "keyDown" | "keyUp"; keyCode: string }): Record<string, unknown>`.
  - `class CdpTab implements TabContents` with `static attach(options: CdpTabOptions): Promise<CdpTab>`, `readonly connection: CdpConnection`, `dispose(): void`, plus every `TabContents` member.
  - `interface CdpTabOptions { id: number; connection: CdpConnection; initialUrl: string; onState?: () => void; onError?: (error: unknown) => void; loadTimeoutMs?: number }`

- [ ] **Step 1: Write the failing key test**

```ts
// packages/server/src/server/browser-tools/cdp/cdp-keys.test.ts
import { describe, expect, test } from "vitest";
import { cdpKeyEvent, virtualKeyCode } from "./cdp-keys.js";

describe("cdpKeyEvent", () => {
  test("a character key is a raw key down, a char and a key up", () => {
    expect(cdpKeyEvent({ type: "keyDown", keyCode: "a" })).toEqual({
      type: "rawKeyDown",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
    });
    expect(cdpKeyEvent({ type: "char", keyCode: "a" })).toEqual({
      type: "char",
      key: "a",
      text: "a",
    });
    expect(cdpKeyEvent({ type: "keyUp", keyCode: "a" })).toEqual({
      type: "keyUp",
      key: "a",
      code: "KeyA",
      windowsVirtualKeyCode: 65,
    });
  });

  test("Enter carries its text so forms submit", () => {
    expect(cdpKeyEvent({ type: "keyDown", keyCode: "Enter" })).toEqual({
      type: "keyDown",
      key: "Enter",
      code: "Enter",
      windowsVirtualKeyCode: 13,
      text: "\r",
    });
  });

  test("Electron arrow aliases and Space map to DOM keys", () => {
    expect(cdpKeyEvent({ type: "keyDown", keyCode: "Down" })).toEqual({
      type: "rawKeyDown",
      key: "ArrowDown",
      code: "ArrowDown",
      windowsVirtualKeyCode: 40,
    });
    expect(cdpKeyEvent({ type: "keyDown", keyCode: "Space" })).toEqual({
      type: "rawKeyDown",
      key: " ",
      code: "Space",
      windowsVirtualKeyCode: 32,
    });
  });

  test("virtualKeyCode covers digits and unknown keys", () => {
    expect(virtualKeyCode("7")).toBe(55);
    expect(virtualKeyCode("ArrowUp")).toBe(38);
    expect(virtualKeyCode("F13")).toBe(0);
  });
});
```

- [ ] **Step 2: Implement `cdp-keys.ts`**

```ts
// packages/server/src/server/browser-tools/cdp/cdp-keys.ts
export interface KeyDefinition {
  key: string;
  code: string;
  vk: number;
  /** Sent with the key down. Only keys whose default action needs it (Enter) have one. */
  text?: string;
}

const NAMED_KEYS: Record<string, KeyDefinition> = {
  Enter: { key: "Enter", code: "Enter", vk: 13, text: "\r" },
  Tab: { key: "Tab", code: "Tab", vk: 9 },
  Backspace: { key: "Backspace", code: "Backspace", vk: 8 },
  Delete: { key: "Delete", code: "Delete", vk: 46 },
  Escape: { key: "Escape", code: "Escape", vk: 27 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", vk: 38 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", vk: 40 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", vk: 37 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", vk: 39 },
  Home: { key: "Home", code: "Home", vk: 36 },
  End: { key: "End", code: "End", vk: 35 },
  PageUp: { key: "PageUp", code: "PageUp", vk: 33 },
  PageDown: { key: "PageDown", code: "PageDown", vk: 34 },
  Space: { key: " ", code: "Space", vk: 32 },
  Shift: { key: "Shift", code: "ShiftLeft", vk: 16 },
  Control: { key: "Control", code: "ControlLeft", vk: 17 },
  Alt: { key: "Alt", code: "AltLeft", vk: 18 },
  Meta: { key: "Meta", code: "MetaLeft", vk: 91 },
};
// The engine sends Electron accelerator names for the arrows.
const ALIASES: Record<string, string> = {
  Up: "ArrowUp",
  Down: "ArrowDown",
  Left: "ArrowLeft",
  Right: "ArrowRight",
  " ": "Space",
};

export function keyDefinition(name: string): KeyDefinition {
  const named = NAMED_KEYS[ALIASES[name] ?? name];
  if (named) return named;
  if (name.length === 1) {
    const upper = name.toUpperCase();
    if (upper >= "A" && upper <= "Z")
      return { key: name, code: `Key${upper}`, vk: upper.charCodeAt(0) };
    if (name >= "0" && name <= "9")
      return { key: name, code: `Digit${name}`, vk: name.charCodeAt(0) };
  }
  return { key: name, code: "", vk: 0 };
}

export function virtualKeyCode(key: string): number {
  return keyDefinition(key).vk;
}

export function cdpKeyEvent(event: {
  type: "char" | "keyDown" | "keyUp";
  keyCode: string;
}): Record<string, unknown> {
  if (event.type === "char") return { type: "char", key: event.keyCode, text: event.keyCode };
  const definition = keyDefinition(event.keyCode);
  const base = { key: definition.key, code: definition.code, windowsVirtualKeyCode: definition.vk };
  if (event.type === "keyUp") return { type: "keyUp", ...base };
  return definition.text
    ? { type: "keyDown", ...base, text: definition.text }
    : { type: "rawKeyDown", ...base };
}
```

Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/cdp-keys.test.ts --bail=1`. Expected: 4 passed.

- [ ] **Step 3: Write the failing `CdpTab` test**

```ts
// packages/server/src/server/browser-tools/cdp/cdp-tab.test.ts
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { CdpConnection } from "./cdp-connection.js";
import { CdpTab } from "./cdp-tab.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";

// A 1x1 PNG.
const PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("CdpTab", () => {
  let chromium: FakeChromium;
  let targetId: string;
  let tab: CdpTab;
  let stateChanges: number;
  const sent = (method: string) =>
    chromium.commands
      .filter((command) => command.method === method)
      .map((command) => command.params);
  // A round trip proves the fake's earlier events were delivered.
  const settle = () => tab.connection.send("Page.enable");

  beforeEach(async () => {
    chromium = await startFakeChromium();
    targetId = chromium.addTarget({ url: "https://example.com/", title: "Example" }).id;
    stateChanges = 0;
    const connection = await CdpConnection.open({
      url: `ws://127.0.0.1:${chromium.port}/devtools/page/${targetId}`,
    });
    tab = await CdpTab.attach({
      id: 7,
      connection,
      initialUrl: "https://example.com/",
      loadTimeoutMs: 200,
      onState: () => {
        stateChanges += 1;
      },
    });
  });
  afterEach(async () => {
    tab.dispose();
    await chromium.close();
  });

  test("reads its first state from the navigation history", () => {
    expect(tab.id).toBe(7);
    expect(tab.getURL()).toBe("https://example.com/");
    expect(tab.getTitle()).toBe("Example");
    expect(tab.canGoBack()).toBe(false);
    expect(tab.canGoForward()).toBe(false);
    expect(tab.isLoading()).toBe(false);
    expect(sent("Page.enable").length).toBe(1);
    expect(sent("Runtime.enable").length).toBe(1);
  });

  test("executeJavaScript returns the value and throws the page's exception", async () => {
    chromium.handle("Runtime.evaluate", (params) =>
      params.expression === "boom()"
        ? {
            result: { type: "object" },
            exceptionDetails: {
              text: "Uncaught",
              exception: { description: "ReferenceError: boom is not defined" },
            },
          }
        : { result: { type: "number", value: 3 } },
    );
    await expect(tab.executeJavaScript("1+2")).resolves.toBe(3);
    expect(sent("Runtime.evaluate")[0]).toEqual({
      expression: "1+2",
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    await expect(tab.executeJavaScript("boom()")).rejects.toThrow(
      "ReferenceError: boom is not defined",
    );
  });

  test("loadURL waits for the load event and tracks loading and history", async () => {
    chromium.handle("Page.navigate", () => ({ frameId: "F" }));
    chromium.handle("Page.getNavigationHistory", () => ({
      currentIndex: 1,
      entries: [
        { id: 1, url: "https://example.com/", title: "Example" },
        { id: 2, url: "https://example.com/next", title: "Next" },
      ],
    }));
    let loaded = false;
    const loading = tab.loadURL("https://example.com/next").then(() => {
      loaded = true;
    });
    chromium.emit(targetId, "Page.frameStartedLoading", { frameId: "F" });
    await settle();
    expect(loaded).toBe(false);
    expect(tab.isLoading()).toBe(true);
    chromium.emit(targetId, "Page.frameNavigated", {
      frame: { id: "F", url: "https://example.com/next" },
    });
    chromium.emit(targetId, "Page.loadEventFired", { timestamp: 1 });
    await loading;
    await settle();
    await settle();
    expect(tab.isLoading()).toBe(false);
    expect(tab.getURL()).toBe("https://example.com/next");
    expect(tab.getTitle()).toBe("Next");
    expect(tab.canGoBack()).toBe(true);
    expect(stateChanges).toBeGreaterThan(0);
  });

  test("loadURL rejects on a navigation error and resolves when no load event comes", async () => {
    chromium.handle("Page.navigate", (params) =>
      params.url === "https://bad.invalid/"
        ? { errorText: "net::ERR_NAME_NOT_RESOLVED" }
        : { frameId: "F" },
    );
    await expect(tab.loadURL("https://bad.invalid/")).rejects.toThrow("net::ERR_NAME_NOT_RESOLVED");
    await expect(tab.loadURL("https://example.com/slow")).resolves.toBeUndefined();
  });

  test("goBack navigates to the previous history entry", async () => {
    chromium.handle("Page.getNavigationHistory", () => ({
      currentIndex: 1,
      entries: [
        { id: 11, url: "https://example.com/", title: "Example" },
        { id: 12, url: "https://example.com/next", title: "Next" },
      ],
    }));
    tab.goBack();
    await settle();
    await settle();
    expect(sent("Page.navigateToHistoryEntry")).toEqual([{ entryId: 11 }]);
  });

  test("captureFrame returns a PNG with its size", async () => {
    chromium.handle("Page.captureScreenshot", () => ({ data: PNG_1X1 }));
    const image = await tab.captureFrame(new AbortController().signal);
    expect(image.getSize()).toEqual({ width: 1, height: 1 });
    expect(Buffer.from(image.toPNG()).toString("base64")).toBe(PNG_1X1);
    expect(sent("Page.captureScreenshot")).toEqual([{ format: "png" }]);
  });

  test("key events and text go out in order", async () => {
    tab.sendInputEvent({ type: "keyDown", keyCode: "a", skipIfUnhandled: true });
    tab.sendInputEvent({ type: "char", keyCode: "a", skipIfUnhandled: true });
    tab.sendInputEvent({ type: "keyUp", keyCode: "a", skipIfUnhandled: true });
    await tab.insertText("hello");
    expect(sent("Input.dispatchKeyEvent").map((params) => params.type)).toEqual([
      "rawKeyDown",
      "char",
      "keyUp",
    ]);
    expect(sent("Input.insertText")).toEqual([{ text: "hello" }]);
  });

  test("buffers console messages", async () => {
    chromium.emit(targetId, "Runtime.consoleAPICalled", {
      type: "error",
      timestamp: 1700000000000,
      args: [
        { type: "string", value: "failed" },
        { type: "object", description: "Error: x" },
      ],
    });
    await settle();
    expect(tab.getConsoleMessages()).toEqual([
      { level: "error", message: "failed Error: x", timestamp: 1700000000000 },
    ]);
  });

  test("answers every dialog and records those opened during a capture", async () => {
    chromium.emit(targetId, "Page.javascriptDialogOpening", { type: "alert", message: "outside" });
    await settle();
    const { result, dialogs } = await tab.captureDialogs(async () => {
      chromium.emit(targetId, "Page.javascriptDialogOpening", {
        type: "confirm",
        message: "Sure?",
      });
      await settle();
      return "done";
    });
    expect(result).toBe("done");
    expect(dialogs.map((dialog) => [dialog.type, dialog.message])).toEqual([["confirm", "Sure?"]]);
    expect(sent("Page.handleJavaScriptDialog").length).toBe(2);
  });

  test("is destroyed once the target closes", async () => {
    expect(tab.isDestroyed()).toBe(false);
    const closed = new Promise<void>((resolve) => tab.connection.onClose(resolve));
    chromium.destroyTarget(targetId);
    await closed;
    expect(tab.isDestroyed()).toBe(true);
  });
});
```

- [ ] **Step 4: Run it and see it fail**

```bash
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/cdp-tab.test.ts --bail=1
```

Expected: FAIL, cannot resolve `./cdp-tab.js`.

- [ ] **Step 5: Implement `CdpTab`**

```ts
// packages/server/src/server/browser-tools/cdp/cdp-tab.ts
import type {
  BrowserAutomationConsoleLogEntry,
  BrowserAutomationDialogEvent,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
import {
  dialogAcceptValue,
  handledDialogEvent,
  MAX_DIALOGS_PER_COMMAND,
} from "../../browser-automation/dialog-handling.js";
import type { TabContents, TabImage } from "../../browser-automation/service.js";
import type { IsolatedKeyboardInputEvent } from "../../browser-automation/trusted-input.js";
import type { CdpConnection } from "./cdp-connection.js";
import { cdpKeyEvent } from "./cdp-keys.js";

export interface CdpTabOptions {
  id: number;
  connection: CdpConnection;
  initialUrl: string;
  onState?: () => void;
  onError?: (error: unknown) => void;
  loadTimeoutMs?: number;
}

interface HistoryEntry {
  id: number;
  url: string;
  title: string;
}

const DEFAULT_LOAD_TIMEOUT_MS = 30_000;
const MAX_CONSOLE_MESSAGES = 500;

export class CdpTab implements TabContents {
  readonly id: number;
  readonly connection: CdpConnection;
  private url: string;
  private title = "";
  private loading = false;
  private mainFrameId: string | null = null;
  private historyIndex = 0;
  private history: HistoryEntry[] = [];
  private readonly consoleMessages: BrowserAutomationConsoleLogEntry[] = [];
  private dialogSink: BrowserAutomationDialogEvent[] | null = null;
  private inputChain: Promise<void> = Promise.resolve();
  private readonly loadWaiters = new Set<() => void>();
  private readonly onState: () => void;
  private readonly onError: (error: unknown) => void;
  private readonly loadTimeoutMs: number;

  private constructor(options: CdpTabOptions) {
    this.id = options.id;
    this.connection = options.connection;
    this.url = options.initialUrl;
    this.onState = options.onState ?? (() => {});
    this.onError = options.onError ?? (() => {});
    this.loadTimeoutMs = options.loadTimeoutMs ?? DEFAULT_LOAD_TIMEOUT_MS;
  }

  static async attach(options: CdpTabOptions): Promise<CdpTab> {
    const tab = new CdpTab(options);
    try {
      tab.listen();
      await tab.connection.send("Page.enable");
      await tab.connection.send("Runtime.enable");
      const tree = await tab.connection.send<{ frameTree?: { frame?: { id?: string } } }>(
        "Page.getFrameTree",
      );
      tab.mainFrameId = tree.frameTree?.frame?.id ?? null;
      await tab.refreshHistory();
      return tab;
    } catch (error) {
      tab.dispose();
      throw error;
    }
  }

  dispose(): void {
    this.connection.close();
  }

  getURL(): string {
    return this.url;
  }
  getTitle(): string {
    return this.title;
  }
  canGoBack(): boolean {
    return this.historyIndex > 0;
  }
  canGoForward(): boolean {
    return this.historyIndex < this.history.length - 1;
  }
  isLoading(): boolean {
    return this.loading;
  }
  isDestroyed(): boolean {
    return this.connection.closed;
  }

  async executeJavaScript(code: string): Promise<unknown> {
    const response = await this.connection.send<{
      result?: { value?: unknown };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    }>("Runtime.evaluate", {
      expression: code,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    });
    if (response.exceptionDetails) {
      throw new Error(
        response.exceptionDetails.exception?.description ??
          response.exceptionDetails.text ??
          "Evaluation failed",
      );
    }
    return response.result?.value;
  }

  async loadURL(url: string): Promise<void> {
    const loaded = this.waitForLoad();
    const response = await this.connection.send<{ errorText?: string }>("Page.navigate", { url });
    if (response.errorText) throw new Error(response.errorText);
    await loaded;
  }

  goBack(): void {
    this.detached(() => this.navigateHistory(-1));
  }
  goForward(): void {
    this.detached(() => this.navigateHistory(1));
  }
  reload(): void {
    this.detached(() => this.connection.send("Page.reload"));
  }

  async captureFrame(signal: AbortSignal): Promise<TabImage> {
    signal.throwIfAborted();
    const { data } = await this.connection.send<{ data: string }>("Page.captureScreenshot", {
      format: "png",
    });
    signal.throwIfAborted();
    const png = Buffer.from(data, "base64");
    return {
      toPNG: () => png,
      // IHDR starts at byte 8; width and height are its first two big-endian u32 fields.
      getSize: () => ({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }),
    };
  }

  invalidate(): void {}

  withFrameProduction<T>(capture: () => Promise<T>): Promise<T> {
    return capture();
  }

  sendInputEvent(event: IsolatedKeyboardInputEvent): void {
    // The engine calls this synchronously three times per key; the chain keeps the order.
    this.inputChain = this.inputChain
      .then(() => this.connection.send("Input.dispatchKeyEvent", cdpKeyEvent(event)))
      .then(
        () => {},
        (error) => this.onError(error),
      );
  }

  async insertText(text: string): Promise<void> {
    await this.inputChain;
    await this.connection.send("Input.insertText", { text });
  }

  getConsoleMessages(): BrowserAutomationConsoleLogEntry[] {
    return [...this.consoleMessages];
  }

  async captureDialogs<T>(
    task: () => Promise<T>,
  ): Promise<{ result: T; dialogs: BrowserAutomationDialogEvent[] }> {
    const dialogs: BrowserAutomationDialogEvent[] = [];
    const previous = this.dialogSink;
    this.dialogSink = dialogs;
    try {
      return { result: await task(), dialogs };
    } finally {
      this.dialogSink = previous;
    }
  }

  sendDebugCommand(command: string, params?: Record<string, unknown>): Promise<unknown> {
    return this.connection.send(command, params);
  }

  private listen(): void {
    const on = (event: string, handler: (params: Record<string, unknown>) => void) =>
      this.connection.on(event, (params) => {
        try {
          handler(params);
        } catch (error) {
          this.onError(error);
        }
      });
    const isMainFrame = (frameId: unknown) =>
      this.mainFrameId === null || frameId === this.mainFrameId;

    on("Page.frameStartedLoading", (params) => {
      if (!isMainFrame(params.frameId)) return;
      this.loading = true;
      this.onState();
    });
    on("Page.frameStoppedLoading", (params) => {
      if (!isMainFrame(params.frameId)) return;
      this.finishLoad();
    });
    on("Page.loadEventFired", () => this.finishLoad());
    on("Page.frameNavigated", (params) => {
      const frame = params.frame as { id?: string; parentId?: string; url?: string } | undefined;
      if (!frame || frame.parentId) return;
      if (frame.id) this.mainFrameId = frame.id;
      if (frame.url) this.url = frame.url;
      this.onState();
      this.detached(() => this.refreshHistory());
    });
    on("Page.navigatedWithinDocument", (params) => {
      if (!isMainFrame(params.frameId) || typeof params.url !== "string") return;
      this.url = params.url;
      this.onState();
      this.detached(() => this.refreshHistory());
    });
    on("Runtime.consoleAPICalled", (params) => {
      const args = Array.isArray(params.args)
        ? (params.args as Array<{ value?: unknown; description?: string }>)
        : [];
      this.consoleMessages.push({
        level: typeof params.type === "string" ? params.type : "log",
        message: args
          .map((arg) => (arg.value !== undefined ? String(arg.value) : (arg.description ?? "")))
          .join(" "),
        timestamp: typeof params.timestamp === "number" ? params.timestamp : Date.now(),
      });
      if (this.consoleMessages.length > MAX_CONSOLE_MESSAGES) this.consoleMessages.shift();
    });
    on("Page.javascriptDialogOpening", (params) => {
      // An unanswered dialog blocks the page, and with it every later command.
      const event = handledDialogEvent(params);
      if (this.dialogSink && this.dialogSink.length < MAX_DIALOGS_PER_COMMAND)
        this.dialogSink.push(event);
      this.detached(() =>
        this.connection.send("Page.handleJavaScriptDialog", {
          accept: dialogAcceptValue(event.type),
        }),
      );
    });
  }

  private finishLoad(): void {
    this.loading = false;
    for (const resolve of this.loadWaiters) resolve();
    this.loadWaiters.clear();
    this.onState();
    this.detached(() => this.refreshHistory());
  }

  /** Resolves on the next load event, or after the timeout: a slow page is not a failed navigation. */
  private waitForLoad(): Promise<void> {
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        this.loadWaiters.delete(done);
        resolve();
      };
      const timer = setTimeout(done, this.loadTimeoutMs);
      this.loadWaiters.add(done);
      this.connection.onClose(done);
    });
  }

  private async refreshHistory(): Promise<void> {
    const response = await this.connection.send<{
      currentIndex?: number;
      entries?: HistoryEntry[];
    }>("Page.getNavigationHistory");
    this.history = response.entries ?? [];
    this.historyIndex = response.currentIndex ?? 0;
    const current = this.history[this.historyIndex];
    if (current) {
      this.url = current.url;
      this.title = current.title;
    }
    this.onState();
  }

  private async navigateHistory(offset: number): Promise<void> {
    await this.refreshHistory();
    const entry = this.history[this.historyIndex + offset];
    if (entry) await this.connection.send("Page.navigateToHistoryEntry", { entryId: entry.id });
  }

  /** Runs work nobody awaits. A rejection here would otherwise be unhandled in the daemon. */
  private detached(run: () => Promise<unknown>): void {
    run().catch((error) => {
      if (!this.connection.closed) this.onError(error);
    });
  }
}
```

- [ ] **Step 6: Run both tests and see them pass**

```bash
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/cdp-keys.test.ts src/server/browser-tools/cdp/cdp-tab.test.ts --no-file-parallelism --maxWorkers=1 --bail=1
```

Expected: 4 + 10 passed.

- [ ] **Step 7: Verify and commit**

Message: `feat(fork): TabContents over a CDP target`

## Task 7: Broker routing and `CdpBrowserService`

**Files:**

- Modify: `packages/server/src/server/browser-tools/broker.ts`
- Modify: `packages/server/src/server/browser-tools/broker.test.ts`
- Create: `packages/server/src/server/browser-tools/cdp/cdp-browser-service.ts`
- Test: `packages/server/src/server/browser-tools/cdp/cdp-browser-service.test.ts`

**Interfaces:**

- Consumes: `CdpEndpoint`, `CdpUnreachableError` (Task 4); `CdpTabRegistry`, `CdpTabEntry` (Task 5); `CdpTab` (Task 6); `CdpTimeoutError`, `CdpClosedError` (Task 3); `executeAutomationCommand`, `BrowserRegistry` from the engine; `BrowserToolsBroker`, `browserToolsFailure`; `BROWSER_AUTOMATION_COMMAND_NAMES` from `@getpaseo/protocol/browser-automation/rpc-schemas`.
- Produces, on `BrowserToolsBroker`:
  - `BrowserHostClient.prefersNewTabs?: boolean`
  - `claimBrowser(clientId: string, browserId: string): void`, `releaseBrowser(browserId: string): void`
  - `cdpBrowser: CdpBrowserService | null` (set by bootstrap in Task 8; sessions reach the service through the broker they already hold)
- Produces, in `cdp-browser-service.ts`:
  - `const CDP_HOST_ID = "cdp-browser-host"`, `const AGENT_ACTIVITY_MS = 3000`
  - `interface CdpTabState { browserId: string; workspaceId: string; url: string; title: string; isLoading: boolean; canGoBack: boolean; canGoForward: boolean; agentActiveUntil: number | null }`
  - `type CdpBrowserEvent = { kind: "opened"; tab: CdpTabState } | { kind: "closed"; browserId: string; workspaceId: string; lastUrl: string } | { kind: "state"; tab: CdpTabState } | { kind: "host"; connected: boolean }`
  - `interface CdpViewport { width: number; height: number; deviceScaleFactor: number }`, `clampViewport(viewport: CdpViewport): CdpViewport`
  - `class CdpBrowserService` with `start(): void`, `stop(): Promise<void>`, `readonly connected: boolean`, `retryNow(): void`, `listTabs(): CdpTabState[]`, `subscribe(listener: (event: CdpBrowserEvent) => void): () => void`, `onAttached(listener: (browserId: string) => void): () => void`, `openTab(input: { workspaceId: string; url?: string }): Promise<CdpTabState>`, `closeTab(browserId: string): Promise<boolean>`, `attachedTab(browserId: string): Promise<CdpTab | null>`, `workspaceOf(browserId: string): string | null`, `setViewport(browserId: string, viewport: CdpViewport, owner: string): Promise<void>`, `viewportOwner(browserId: string): string | null`.

- [ ] **Step 1: Add the failing broker tests**

Append inside the top-level `describe` of `broker.test.ts`. These use plain host objects, so they do not depend on the file's `FakeBrowserHostClient`.

```ts
describe("new tab host preference", () => {
  const TAB = "11111111-1111-4111-8111-111111111111";
  const host = (id: string, broker: BrowserToolsBroker, prefersNewTabs?: boolean) => {
    const seen: string[] = [];
    broker.registerClient({
      id,
      hostKind: id,
      supportedCommands: ["new_tab", "list_tabs", "reload"],
      ...(prefersNewTabs ? { prefersNewTabs } : {}),
      sendBrowserAutomationRequest: (request) => {
        seen.push(request.command.command);
        broker.receiveResponse(
          {
            type: "browser.automation.execute.response",
            payload:
              request.command.command === "new_tab"
                ? {
                    requestId: request.requestId,
                    ok: true,
                    result: {
                      command: "new_tab",
                      browserId: TAB,
                      workspaceId: "ws",
                      url: "about:blank",
                    },
                  }
                : {
                    requestId: request.requestId,
                    ok: true,
                    result: { command: "reload", browserId: TAB },
                  },
          },
          [id],
        );
      },
    });
    return seen;
  };

  test("a host that prefers new tabs takes new_tab over a later host", async () => {
    const broker = new BrowserToolsBroker({});
    const docker = host("docker", broker, true);
    const desktop = host("desktop", broker);
    const result = await broker.execute({
      command: { command: "new_tab", args: {} },
      workspaceId: "ws",
    });
    expect(result.ok).toBe(true);
    expect(docker).toEqual(["new_tab"]);
    expect(desktop).toEqual([]);
  });

  test("without a preferring host the most recent host still takes new_tab", async () => {
    const broker = new BrowserToolsBroker({});
    const first = host("first", broker);
    const second = host("second", broker);
    await broker.execute({ command: { command: "new_tab", args: {} }, workspaceId: "ws" });
    expect(first).toEqual([]);
    expect(second).toEqual(["new_tab"]);
  });

  test("a claimed tab routes to its host until it is released", async () => {
    const broker = new BrowserToolsBroker({});
    const docker = host("docker", broker, true);
    const desktop = host("desktop", broker);
    broker.claimBrowser("docker", TAB);
    await broker.execute({ command: { command: "reload", args: { browserId: TAB } } });
    expect(docker).toEqual(["reload"]);
    expect(desktop).toEqual([]);
    broker.releaseBrowser(TAB);
    const result = await broker.execute({
      command: { command: "reload", args: { browserId: TAB } },
    });
    expect(result).toMatchObject({ ok: false, error: { code: "browser_tab_not_found" } });
  });
});
```

If the `reload` result schema needs more fields than `{ command, browserId }`, copy the missing fields from `BrowserAutomationResultSchema` in `packages/protocol/src/browser-automation/rpc-schemas.ts` into the fixture. Do not change the schema.

Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/broker.test.ts --bail=1`. Expected: FAIL, `claimBrowser` is not a function.

- [ ] **Step 2: Change the broker**

In `broker.ts`:

```ts
// at the imports
import type { CdpBrowserService } from "./cdp/cdp-browser-service.js";

// in BrowserHostClient, after supportedCommands
  /** A host that should receive new tabs even when another host registered after it. */
  prefersNewTabs?: boolean;

// in class BrowserToolsBroker, after registrationSequence
  /** The daemon's own Docker Chromium host, when PASEO_BROWSER_CDP_URL is set. */
  public cdpBrowser: CdpBrowserService | null = null;

// new public methods, after getRegisteredClientCount
  /** Records a tab a host opened outside execute(), such as one opened from the UI. */
  public claimBrowser(clientId: string, browserId: string): void {
    this.browserHostByBrowserId.set(browserId, clientId);
    this.strandedBrowserHostByBrowserId.delete(browserId);
  }

  public releaseBrowser(browserId: string): void {
    this.browserHostByBrowserId.delete(browserId);
    this.strandedBrowserHostByBrowserId.delete(browserId);
  }

// new private method, next to selectMostRecentlyRegisteredHost
  private selectNewTabHost(): RegisteredBrowserHost | null {
    let preferred: RegisteredBrowserHost | null = null;
    for (const host of this.clients.values()) {
      if (host.client.prefersNewTabs) preferred = host;
    }
    return preferred ?? this.selectMostRecentlyRegisteredHost();
  }
```

In `selectHostForCommand`, the `new_tab` branch calls `this.selectNewTabHost()` in place of `this.selectMostRecentlyRegisteredHost()`. Nothing else in that method changes.

Run the broker test again. Expected: all pass, including the three new tests.

- [ ] **Step 3: Write the failing service test**

```ts
// packages/server/src/server/browser-tools/cdp/cdp-browser-service.test.ts
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { BrowserToolsBroker } from "../broker.js";
import {
  AGENT_ACTIVITY_MS,
  CdpBrowserService,
  clampViewport,
  type CdpBrowserEvent,
} from "./cdp-browser-service.js";
import { CdpEndpoint } from "./cdp-endpoint.js";
import { CdpTabRegistry } from "./tab-registry.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";

const logger = { debug: () => {}, warn: () => {}, error: () => {} };

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("CdpBrowserService", () => {
  let chromium: FakeChromium;
  let dir: string;
  let file: string;
  let broker: BrowserToolsBroker;
  let service: CdpBrowserService;
  let events: CdpBrowserEvent[];
  let reachable: boolean;
  let now: number;

  const build = () => {
    service = new CdpBrowserService({
      endpoint: new CdpEndpoint({
        url: `http://chromium-host:${chromium.port}`,
        fetchTimeoutMs: 500,
        // Far below the broker's timeout, so a stalled command fails in the host first.
        commandTimeoutMs: 300,
        lookup: async () => {
          if (!reachable) throw new Error("ENOTFOUND chromium-host");
          return "127.0.0.1";
        },
      }),
      registry: new CdpTabRegistry(file),
      broker,
      logger,
      now: () => now,
      reconnect: { minMs: 20, maxMs: 40 },
    });
    service.subscribe((event) => events.push(event));
  };
  const started = async () => {
    service.start();
    await until(() => service.connected, "the CDP host to connect");
  };
  const newTab = async (workspaceId = "ws-a", url = "https://example.com/") => {
    const payload = await broker.execute({
      command: { command: "new_tab", args: { url } },
      workspaceId,
    });
    if (!payload.ok || payload.result.command !== "new_tab")
      throw new Error(JSON.stringify(payload));
    return payload.result;
  };

  beforeEach(async () => {
    chromium = await startFakeChromium();
    dir = await mkdtemp(path.join(os.tmpdir(), "paseo-cdp-service-"));
    file = path.join(dir, "browser-tools", "cdp-tabs.json");
    broker = new BrowserToolsBroker({});
    events = [];
    reachable = true;
    now = 1_000;
    build();
  });
  afterEach(async () => {
    await service.stop();
    await chromium.close();
    await rm(dir, { recursive: true, force: true });
  });

  test("registers with the broker once CDP answers", async () => {
    expect(broker.getRegisteredClientCount()).toBe(0);
    await started();
    expect(broker.getRegisteredClientCount()).toBe(1);
    expect(events).toContainEqual({ kind: "host", connected: true });
  });

  test("new_tab opens a background window and registers the tab", async () => {
    await started();
    const result = await newTab();
    expect(result).toMatchObject({ workspaceId: "ws-a", url: "https://example.com/" });
    expect(
      chromium.commands.find((command) => command.method === "Target.createTarget")?.params,
    ).toEqual({
      url: "https://example.com/",
      newWindow: true,
      background: true,
    });
    expect(service.listTabs().map((tab) => tab.browserId)).toEqual([result.browserId]);
    expect(events.filter((event) => event.kind === "opened")).toHaveLength(1);
  });

  test("new_tab refuses a URL that is not http, https or about:blank", async () => {
    await started();
    const payload = await broker.execute({
      command: { command: "new_tab", args: { url: "file:///etc/passwd" } },
      workspaceId: "ws-a",
    });
    expect(payload.ok).toBe(false);
    expect(chromium.commands.some((command) => command.method === "Target.createTarget")).toBe(
      false,
    );
  });

  test("list_tabs shows only the daemon's own tabs", async () => {
    chromium.addTarget({ id: "USER-TAB", url: "https://mail.example.com/" });
    await started();
    const mine = await newTab();
    const payload = await broker.execute({
      command: { command: "list_tabs" },
      workspaceId: "ws-a",
    });
    if (!payload.ok || payload.result.command !== "list_tabs")
      throw new Error(JSON.stringify(payload));
    expect(payload.result.tabs.map((tab) => tab.browserId)).toEqual([mine.browserId]);
  });

  test("close_tab closes only the registered target", async () => {
    const foreign = chromium.addTarget({ id: "USER-TAB" });
    await started();
    const mine = await newTab();
    const payload = await broker.execute({
      command: { command: "close_tab", args: { browserId: mine.browserId } },
      workspaceId: "ws-a",
    });
    expect(payload).toMatchObject({
      ok: true,
      result: { command: "close_tab", browserId: mine.browserId },
    });
    expect(chromium.targets.has(foreign.id)).toBe(true);
    expect(chromium.targets.size).toBe(1);
    expect(service.listTabs()).toEqual([]);
    expect(events.filter((event) => event.kind === "closed")).toEqual([
      {
        kind: "closed",
        browserId: mine.browserId,
        workspaceId: "ws-a",
        lastUrl: "https://example.com/",
      },
    ]);
  });

  test("a target destroyed elsewhere drops from the registry; a stranger's is ignored", async () => {
    const foreign = chromium.addTarget({ id: "USER-TAB" });
    await started();
    const mine = await newTab();
    chromium.destroyTarget(foreign.id);
    const targetId = [...chromium.targets.keys()][0];
    chromium.destroyTarget(targetId);
    await until(() => service.listTabs().length === 0, "the tab to drop");
    expect(
      events
        .filter((event) => event.kind === "closed")
        .map((event) => event.kind === "closed" && event.browserId),
    ).toEqual([mine.browserId]);
  });

  test("a popup of a registered tab joins its workspace", async () => {
    await started();
    const opener = await newTab("ws-b");
    const openerTarget = [...chromium.targets.keys()][0];
    chromium.addTarget({ url: "https://example.com/popup", openerId: openerTarget });
    chromium.addTarget({ url: "https://other.example/", openerId: "UNKNOWN" });
    await until(() => service.listTabs().length === 2, "the popup to be adopted");
    const popup = service.listTabs().find((tab) => tab.browserId !== opener.browserId);
    expect(popup).toMatchObject({ workspaceId: "ws-b", url: "https://example.com/popup" });
  });

  test("an agent command marks the tab active for 3 seconds", async () => {
    await started();
    const tab = await newTab();
    now = 5_000;
    events.length = 0;
    await broker.execute({
      command: { command: "resize", args: { browserId: tab.browserId, width: 800, height: 600 } },
      workspaceId: "ws-a",
    });
    expect(service.listTabs()[0].agentActiveUntil).toBe(5_000 + AGENT_ACTIVITY_MS);
    expect(
      events.some((event) => event.kind === "state" && event.tab.agentActiveUntil === 8_000),
    ).toBe(true);
  });

  test("a command that times out answers with a retryable timeout", async () => {
    await started();
    const tab = await newTab();
    chromium.stall("Runtime.evaluate");
    const payload = await broker.execute({
      command: { command: "evaluate", args: { browserId: tab.browserId, function: "() => 1" } },
      workspaceId: "ws-a",
      timeoutMs: 10_000,
    });
    expect(payload).toMatchObject({
      ok: false,
      error: { code: "browser_timeout", retryable: true },
    });
  });

  test("stays unregistered while CDP is unreachable and connects when it comes back", async () => {
    reachable = false;
    service.start();
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(service.connected).toBe(false);
    const payload = await broker.execute({
      command: { command: "new_tab", args: {} },
      workspaceId: "ws-a",
    });
    expect(payload).toMatchObject({ ok: false, error: { code: "browser_no_host" } });
    reachable = true;
    await until(() => service.connected, "the reconnect");
    expect(broker.getRegisteredClientCount()).toBe(1);
  });

  test("at start it drops entries whose target is gone", async () => {
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(
      file,
      JSON.stringify({
        version: 1,
        tabs: [
          {
            browserId: "22222222-2222-4222-8222-222222222222",
            targetId: "GONE",
            workspaceId: "ws-a",
            lastUrl: "https://example.com/old",
            createdAt: 1,
          },
        ],
      }),
    );
    await started();
    expect(service.listTabs()).toEqual([]);
    expect(events).toContainEqual({
      kind: "closed",
      browserId: "22222222-2222-4222-8222-222222222222",
      workspaceId: "ws-a",
      lastUrl: "https://example.com/old",
    });
  });

  test("a disconnect unregisters the host and reports it", async () => {
    await started();
    await chromium.close();
    await until(() => !service.connected, "the disconnect");
    expect(broker.getRegisteredClientCount()).toBe(0);
    expect(events).toContainEqual({ kind: "host", connected: false });
  });

  test("the last interacting owner sets the viewport", async () => {
    await started();
    const tab = await newTab();
    await service.setViewport(
      tab.browserId,
      { width: 390, height: 700, deviceScaleFactor: 3 },
      "viewer-1",
    );
    expect(service.viewportOwner(tab.browserId)).toBe("viewer-1");
    expect(
      chromium.commands.findLast(
        (command) => command.method === "Emulation.setDeviceMetricsOverride",
      )?.params,
    ).toEqual({
      width: 390,
      height: 700,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await broker.execute({
      command: { command: "resize", args: { browserId: tab.browserId, width: 1280, height: 800 } },
      workspaceId: "ws-a",
    });
    expect(service.viewportOwner(tab.browserId)).toBe("agent");
  });

  test("clampViewport holds the limits", () => {
    expect(clampViewport({ width: 5000, height: 10, deviceScaleFactor: 0.5 })).toEqual({
      width: 1920,
      height: 240,
      deviceScaleFactor: 1,
    });
  });
});
```

Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/cdp-browser-service.test.ts --bail=1`. Expected: FAIL, cannot resolve `./cdp-browser-service.js`.

- [ ] **Step 4: Implement `CdpBrowserService`**

```ts
// packages/server/src/server/browser-tools/cdp/cdp-browser-service.ts
import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import {
  BROWSER_AUTOMATION_COMMAND_NAMES,
  type BrowserAutomationExecuteRequest,
  type BrowserAutomationExecuteResponse,
} from "@getpaseo/protocol/browser-automation/rpc-schemas";
import {
  executeAutomationCommand,
  type BrowserRegistry,
} from "../../browser-automation/service.js";
import type { BrowserToolsBroker } from "../broker.js";
import { browserToolsFailure } from "../errors.js";
import { CdpClosedError, CdpTimeoutError, type CdpConnection } from "./cdp-connection.js";
import { CdpUnreachableError, type CdpEndpoint } from "./cdp-endpoint.js";
import { CdpTab } from "./cdp-tab.js";
import type { CdpTabEntry, CdpTabRegistry } from "./tab-registry.js";

export const CDP_HOST_ID = "cdp-browser-host";
export const AGENT_ACTIVITY_MS = 3000;
const AGENT_VIEWPORT_OWNER = "agent";

type Payload = BrowserAutomationExecuteResponse["payload"];

export interface CdpTabState {
  browserId: string;
  workspaceId: string;
  url: string;
  title: string;
  isLoading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
  agentActiveUntil: number | null;
}

export type CdpBrowserEvent =
  | { kind: "opened"; tab: CdpTabState }
  | { kind: "closed"; browserId: string; workspaceId: string; lastUrl: string }
  | { kind: "state"; tab: CdpTabState }
  | { kind: "host"; connected: boolean };

export interface CdpViewport {
  width: number;
  height: number;
  deviceScaleFactor: number;
}

export function clampViewport(viewport: CdpViewport): CdpViewport {
  const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
  return {
    width: Math.round(clamp(viewport.width, 320, 1920)),
    height: Math.round(clamp(viewport.height, 240, 1080)),
    deviceScaleFactor: clamp(viewport.deviceScaleFactor, 1, 2),
  };
}

export interface CdpBrowserServiceOptions {
  endpoint: CdpEndpoint;
  registry: CdpTabRegistry;
  broker: BrowserToolsBroker;
  logger: Pick<Logger, "debug" | "warn" | "error">;
  now?: () => number;
  createBrowserId?: () => string;
  reconnect?: { minMs: number; maxMs: number };
}

function isAllowedTabUrl(url: string): boolean {
  if (url === "about:blank") return true;
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

export class CdpBrowserService {
  private readonly endpoint: CdpEndpoint;
  private readonly registry: CdpTabRegistry;
  private readonly broker: BrowserToolsBroker;
  private readonly logger: Pick<Logger, "debug" | "warn" | "error">;
  private readonly now: () => number;
  private readonly createBrowserId: () => string;
  private readonly minBackoffMs: number;
  private readonly maxBackoffMs: number;

  private browser: CdpConnection | null = null;
  private unregister: (() => void) | null = null;
  private stopped = true;
  private loaded = false;
  private connecting = false;
  private backoffMs: number;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private nextTabId = 1;
  private readonly tabs = new Map<string, CdpTab>();
  private readonly attaching = new Map<string, Promise<CdpTab | null>>();
  private readonly viewports = new Map<string, CdpViewport & { owner: string }>();
  private readonly agentActiveUntil = new Map<string, number>();
  private readonly agentTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly activeByWorkspace = new Map<string, string>();
  private readonly listeners = new Set<(event: CdpBrowserEvent) => void>();
  private readonly attachListeners = new Set<(browserId: string) => void>();

  private readonly browserRegistry: BrowserRegistry = {
    listRegisteredBrowserIds: () => this.registry.list().map((entry) => entry.browserId),
    listRegisteredBrowserIdsForWorkspace: (workspaceId) =>
      this.registry
        .list()
        .filter((entry) => entry.workspaceId === workspaceId)
        .map((entry) => entry.browserId),
    getTabContents: (browserId) => this.tabs.get(browserId) ?? null,
    getBrowserWorkspaceId: (browserId) => this.registry.get(browserId)?.workspaceId ?? null,
    getWorkspaceActiveBrowserId: (workspaceId) => {
      const active = this.activeByWorkspace.get(workspaceId);
      if (active && this.registry.get(active)) return active;
      const inWorkspace = this.registry.list().filter((entry) => entry.workspaceId === workspaceId);
      return inWorkspace.at(-1)?.browserId ?? null;
    },
  };

  constructor(options: CdpBrowserServiceOptions) {
    this.endpoint = options.endpoint;
    this.registry = options.registry;
    this.broker = options.broker;
    this.logger = options.logger;
    this.now = options.now ?? Date.now;
    this.createBrowserId = options.createBrowserId ?? randomUUID;
    this.minBackoffMs = options.reconnect?.minMs ?? 1_000;
    this.maxBackoffMs = options.reconnect?.maxMs ?? 30_000;
    this.backoffMs = this.minBackoffMs;
  }

  get connected(): boolean {
    return this.browser !== null;
  }

  start(): void {
    this.stopped = false;
    void this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    for (const timer of this.agentTimers.values()) clearTimeout(timer);
    this.agentTimers.clear();
    const browser = this.browser;
    this.disconnect();
    browser?.close();
    await this.registry.flush();
  }

  retryNow(): void {
    if (this.stopped || this.browser) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.backoffMs = this.minBackoffMs;
    void this.connect();
  }

  listTabs(): CdpTabState[] {
    return this.registry.list().map((entry) => this.stateOf(entry));
  }

  subscribe(listener: (event: CdpBrowserEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onAttached(listener: (browserId: string) => void): () => void {
    this.attachListeners.add(listener);
    return () => this.attachListeners.delete(listener);
  }

  workspaceOf(browserId: string): string | null {
    return this.registry.get(browserId)?.workspaceId ?? null;
  }

  async openTab(input: { workspaceId: string; url?: string }): Promise<CdpTabState> {
    const browser = this.browser;
    if (!browser) throw new CdpUnreachableError("The Docker browser is unreachable.");
    const url = input.url ?? "about:blank";
    if (!isAllowedTabUrl(url)) throw new Error("Only http and https URLs can be opened.");
    // A background tab is hidden: it paints no screencast frames and its requestAnimationFrame
    // never fires. A background window is visible and does not take focus from the noVNC desktop.
    const { targetId } = await browser.send<{ targetId: string }>("Target.createTarget", {
      url,
      newWindow: true,
      background: true,
    });
    const entry: CdpTabEntry = {
      browserId: this.createBrowserId(),
      targetId,
      workspaceId: input.workspaceId,
      lastUrl: url,
      createdAt: this.now(),
    };
    this.registry.add(entry);
    this.broker.claimBrowser(CDP_HOST_ID, entry.browserId);
    this.activeByWorkspace.set(entry.workspaceId, entry.browserId);
    await this.attachedTab(entry.browserId);
    const state = this.stateOf(entry);
    this.emit({ kind: "opened", tab: state });
    return state;
  }

  async closeTab(browserId: string): Promise<boolean> {
    const entry = this.registry.get(browserId);
    if (!entry) return false;
    try {
      await this.browser?.send("Target.closeTarget", { targetId: entry.targetId });
    } catch (error) {
      this.logger.debug({ err: error, browserId }, "CDP closeTarget failed");
    }
    // The targetDestroyed event usually gets here first; forget() is a no-op the second time.
    this.forget(browserId);
    return true;
  }

  /** The live tab for a registered browser, reconnecting its socket when the last one closed. */
  attachedTab(browserId: string): Promise<CdpTab | null> {
    const existing = this.tabs.get(browserId);
    if (existing && !existing.isDestroyed()) return Promise.resolve(existing);
    const entry = this.registry.get(browserId);
    if (!entry || !this.browser) return Promise.resolve(null);
    const running = this.attaching.get(browserId);
    if (running) return running;
    const attach = this.attach(entry).finally(() => this.attaching.delete(browserId));
    this.attaching.set(browserId, attach);
    return attach;
  }

  async setViewport(browserId: string, viewport: CdpViewport, owner: string): Promise<void> {
    const next = clampViewport(viewport);
    const current = this.viewports.get(browserId);
    const same =
      current &&
      current.width === next.width &&
      current.height === next.height &&
      current.deviceScaleFactor === next.deviceScaleFactor;
    this.viewports.set(browserId, { ...next, owner });
    if (same) return;
    const tab = await this.attachedTab(browserId);
    if (tab) await this.applyViewport(tab, next);
  }

  viewportOwner(browserId: string): string | null {
    return this.viewports.get(browserId)?.owner ?? null;
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.connecting || this.browser) return;
    this.connecting = true;
    try {
      if (!this.loaded) {
        await this.registry.load();
        this.loaded = true;
      }
      const targets = await this.endpoint.listTargets();
      for (const dropped of this.registry.reconcile(new Set(targets.map((target) => target.id)))) {
        this.announceClosed(dropped);
      }
      const browser = await this.endpoint.connectBrowser();
      if (this.stopped) {
        browser.close();
        return;
      }
      browser.on("Target.targetCreated", (params) =>
        this.guard(() => this.onTargetCreated(params)),
      );
      browser.on("Target.targetDestroyed", (params) =>
        this.guard(() => this.onTargetDestroyed(params)),
      );
      browser.onClose(() => this.guard(() => this.onBrowserClosed(browser)));
      await browser.send("Target.setDiscoverTargets", { discover: true });
      this.browser = browser;
      this.backoffMs = this.minBackoffMs;
      this.unregister = this.broker.registerClient({
        id: CDP_HOST_ID,
        hostKind: "docker-chromium",
        supportedCommands: BROWSER_AUTOMATION_COMMAND_NAMES,
        prefersNewTabs: true,
        sendBrowserAutomationRequest: (request) => this.handleRequest(request),
      });
      for (const entry of this.registry.list())
        this.broker.claimBrowser(CDP_HOST_ID, entry.browserId);
      this.emit({ kind: "host", connected: true });
    } catch (error) {
      this.logger.debug({ err: error }, "Docker browser CDP is unreachable");
      this.scheduleReconnect();
    } finally {
      this.connecting = false;
    }
  }

  private onBrowserClosed(browser: CdpConnection): void {
    if (this.browser === browser) {
      this.disconnect();
      this.emit({ kind: "host", connected: false });
    }
    this.scheduleReconnect();
  }

  private disconnect(): void {
    this.browser = null;
    this.unregister?.();
    this.unregister = null;
    for (const tab of this.tabs.values()) tab.dispose();
    this.tabs.clear();
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer || this.browser) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, this.backoffMs);
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs);
  }

  private async attach(entry: CdpTabEntry): Promise<CdpTab | null> {
    try {
      const connection = await this.endpoint.connectTarget(entry.targetId);
      const tab = await CdpTab.attach({
        id: this.nextTabId++,
        connection,
        initialUrl: entry.lastUrl,
        onState: () => this.guard(() => this.onTabState(entry.browserId)),
        onError: (error) =>
          this.logger.debug({ err: error, browserId: entry.browserId }, "CDP tab error"),
      });
      if (!this.registry.get(entry.browserId) || !this.browser) {
        tab.dispose();
        return null;
      }
      this.tabs.set(entry.browserId, tab);
      connection.onClose(() => {
        if (this.tabs.get(entry.browserId) === tab) this.tabs.delete(entry.browserId);
      });
      // The device metrics override belongs to the socket that set it, so a new socket needs it again.
      const viewport = this.viewports.get(entry.browserId);
      if (viewport) await this.applyViewport(tab, viewport);
      for (const listener of this.attachListeners) this.guard(() => listener(entry.browserId));
      return tab;
    } catch (error) {
      this.logger.debug({ err: error, browserId: entry.browserId }, "CDP tab attach failed");
      return null;
    }
  }

  private async applyViewport(tab: CdpTab, viewport: CdpViewport): Promise<void> {
    // mobile: true shrinks the page scale on narrow widths; the width alone gives the responsive layout.
    await tab.connection.send("Emulation.setDeviceMetricsOverride", {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.deviceScaleFactor,
      mobile: false,
    });
  }

  private onTargetCreated(params: Record<string, unknown>): void {
    const info = params.targetInfo as
      | { targetId?: string; type?: string; url?: string; openerId?: string }
      | undefined;
    if (!info?.targetId || info.type !== "page" || !info.openerId) return;
    const entry = this.registry.adoptPopup({
      targetId: info.targetId,
      openerId: info.openerId,
      url: info.url ?? "about:blank",
      browserId: this.createBrowserId(),
      now: this.now(),
    });
    if (!entry) return;
    this.broker.claimBrowser(CDP_HOST_ID, entry.browserId);
    void this.attachedTab(entry.browserId).then(
      () => this.guard(() => this.emit({ kind: "opened", tab: this.stateOf(entry) })),
      (error) => this.logger.debug({ err: error }, "CDP popup attach failed"),
    );
  }

  private onTargetDestroyed(params: Record<string, unknown>): void {
    const entry =
      typeof params.targetId === "string" ? this.registry.findByTarget(params.targetId) : null;
    if (entry) this.forget(entry.browserId);
  }

  private forget(browserId: string): void {
    const entry = this.registry.remove(browserId);
    if (entry) this.announceClosed(entry);
  }

  private announceClosed(entry: CdpTabEntry): void {
    this.tabs.get(entry.browserId)?.dispose();
    this.tabs.delete(entry.browserId);
    this.viewports.delete(entry.browserId);
    this.agentActiveUntil.delete(entry.browserId);
    const timer = this.agentTimers.get(entry.browserId);
    if (timer) clearTimeout(timer);
    this.agentTimers.delete(entry.browserId);
    this.broker.releaseBrowser(entry.browserId);
    this.emit({
      kind: "closed",
      browserId: entry.browserId,
      workspaceId: entry.workspaceId,
      lastUrl: entry.lastUrl,
    });
  }

  private onTabState(browserId: string): void {
    const entry = this.registry.get(browserId);
    const tab = this.tabs.get(browserId);
    if (!entry || !tab) return;
    this.registry.setLastUrl(browserId, tab.getURL());
    this.emit({ kind: "state", tab: this.stateOf(this.registry.get(browserId) ?? entry) });
  }

  private noteAgentActivity(browserId: string): void {
    const entry = this.registry.get(browserId);
    if (!entry) return;
    this.agentActiveUntil.set(browserId, this.now() + AGENT_ACTIVITY_MS);
    this.activeByWorkspace.set(entry.workspaceId, browserId);
    this.emit({ kind: "state", tab: this.stateOf(entry) });
    const previous = this.agentTimers.get(browserId);
    if (previous) clearTimeout(previous);
    const timer = setTimeout(() => {
      this.guard(() => {
        this.agentTimers.delete(browserId);
        this.agentActiveUntil.delete(browserId);
        const current = this.registry.get(browserId);
        if (current) this.emit({ kind: "state", tab: this.stateOf(current) });
      });
    }, AGENT_ACTIVITY_MS);
    timer.unref?.();
    this.agentTimers.set(browserId, timer);
  }

  private stateOf(entry: CdpTabEntry): CdpTabState {
    const tab = this.tabs.get(entry.browserId);
    return {
      browserId: entry.browserId,
      workspaceId: entry.workspaceId,
      url: tab?.getURL() ?? entry.lastUrl,
      title: tab?.getTitle() ?? "",
      isLoading: tab?.isLoading() ?? false,
      canGoBack: tab?.canGoBack() ?? false,
      canGoForward: tab?.canGoForward() ?? false,
      agentActiveUntil: this.agentActiveUntil.get(entry.browserId) ?? null,
    };
  }

  /** The broker's send hook. It never rejects: every outcome goes back as a response payload. */
  private async handleRequest(request: BrowserAutomationExecuteRequest): Promise<void> {
    let payload: Payload;
    try {
      payload = await this.execute(request);
    } catch (error) {
      payload = this.failure(request.requestId, error);
    }
    try {
      this.broker.receiveResponse({ type: "browser.automation.execute.response", payload }, [
        CDP_HOST_ID,
      ]);
    } catch (error) {
      this.logger.error({ err: error }, "Failed to deliver a CDP browser response");
    }
  }

  private async execute(request: BrowserAutomationExecuteRequest): Promise<Payload> {
    const { requestId, command } = request;
    if (command.command === "new_tab") {
      if (!request.workspaceId) {
        return browserToolsFailure({
          requestId,
          code: "browser_unknown_error",
          message: "browser_new_tab needs a workspace.",
        });
      }
      const tab = await this.openTab({ workspaceId: request.workspaceId, url: command.args.url });
      this.noteAgentActivity(tab.browserId);
      return {
        requestId,
        ok: true,
        result: {
          command: "new_tab",
          browserId: tab.browserId,
          workspaceId: tab.workspaceId,
          url: tab.url,
        },
      };
    }
    if (command.command === "list_tabs") {
      await Promise.all(this.registry.list().map((entry) => this.attachedTab(entry.browserId)));
      return executeAutomationCommand(request, this.browserRegistry);
    }

    const browserId = command.args.browserId;
    const entry = this.registry.get(browserId);
    if (!entry || (request.workspaceId && entry.workspaceId !== request.workspaceId)) {
      return browserToolsFailure({
        requestId,
        code: "browser_tab_not_found",
        message: `Browser tab ${browserId} is not open in the Docker browser. Call browser_list_tabs.`,
      });
    }
    if (command.command === "close_tab") {
      await this.closeTab(browserId);
      return { requestId, ok: true, result: { command: "close_tab", browserId } };
    }
    this.noteAgentActivity(browserId);
    if (command.command === "resize") {
      const { width, height } = command.args;
      // An agent's size holds until a person interacts with the pane again.
      await this.setViewport(
        browserId,
        { width, height, deviceScaleFactor: 1 },
        AGENT_VIEWPORT_OWNER,
      );
      return { requestId, ok: true, result: { command: "resize", browserId, width, height } };
    }
    const tab = await this.attachedTab(browserId);
    if (!tab) {
      return browserToolsFailure({
        requestId,
        code: "browser_tab_closed",
        message: `Browser tab ${browserId} is closed.`,
      });
    }
    const payload = await executeAutomationCommand(request, this.browserRegistry);
    // The engine turns a thrown CDP error into a generic failure. A socket that closed while its
    // target is still registered means a command timed out (CdpConnection closes on timeout).
    if (!payload.ok && tab.isDestroyed() && this.registry.get(browserId)) {
      return this.failure(requestId, new CdpTimeoutError(command.command, 0));
    }
    return payload;
  }

  private failure(requestId: string, error: unknown): Payload {
    if (error instanceof CdpTimeoutError) {
      return browserToolsFailure({
        requestId,
        code: "browser_timeout",
        message: "The page did not answer in time.",
        retryable: true,
      });
    }
    if (error instanceof CdpUnreachableError || error instanceof CdpClosedError) {
      return browserToolsFailure({
        requestId,
        code: "browser_no_host",
        message: "The Docker browser is unreachable.",
        retryable: true,
      });
    }
    return browserToolsFailure({
      requestId,
      code: "browser_unknown_error",
      message: error instanceof Error ? error.message : String(error),
    });
  }

  private emit(event: CdpBrowserEvent): void {
    for (const listener of this.listeners) this.guard(() => listener(event));
  }

  private guard(run: () => void): void {
    try {
      run();
    } catch (error) {
      this.logger.error({ err: error }, "CDP browser host handler failed");
    }
  }
}
```

Do not edit the engine or the automation schemas in this task. The result shapes above match `BrowserAutomationNewTabResultSchema`, `BrowserAutomationCloseTabResultSchema` and `BrowserAutomationResizeResultSchema` as they are at bc045344c.

- [ ] **Step 5: Run the service and broker tests and see them pass**

```bash
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/cdp-browser-service.test.ts src/server/browser-tools/broker.test.ts --no-file-parallelism --maxWorkers=1 --bail=1
```

Expected: 14 service tests pass; every broker test passes.

- [ ] **Step 6: Verify and commit**

Message: `feat(fork): daemon browser host on the Docker Chromium`

## Task 8: Configuration, bootstrap wiring, compose and docs

**Files:**

- Modify: `packages/server/src/server/config-environment.ts` (`DAEMON_SETTING_ENV_KEYS`)
- Modify: `packages/server/src/server/config.ts` (`resolveBrowserToolsEnabled`, `resolveStaticLoadConfigSettings`, `resolveConfigFromPersisted`)
- Modify: `packages/server/src/server/config-browser-tools.test.ts`
- Create: `packages/server/src/server/browser-tools/cdp/create-cdp-browser-service.ts`
- Modify: `packages/server/src/server/bootstrap.ts` (`PaseoDaemonConfig`, broker creation near line 686, start near line 1911, `stop` near line 2030)
- Modify: `docker/docker-compose.yml`, `docker/docker-compose.agent.yml`, `docker/docker-compose.vpn.yml`
- Modify: `docs/docker.md`

**Interfaces:**

- Consumes: `CdpBrowserService`, `CdpEndpoint`, `CdpTabRegistry`, `BrowserToolsBroker.cdpBrowser`.
- Produces:
  - `PaseoDaemonConfig.browserCdpUrl?: string`
  - env `PASEO_BROWSER_CDP_URL` (the CDP origin) and `PASEO_BROWSER_TOOLS_ENABLED` (default for browser tools when the persisted setting is absent)
  - `createCdpBrowserService(input: { url: string; paseoHome: string; broker: BrowserToolsBroker; logger: Logger }): CdpBrowserService`

- [ ] **Step 1: Write the failing config tests**

Append to the `describe` in `config-browser-tools.test.ts`:

```ts
test("PASEO_BROWSER_TOOLS_ENABLED is the default when nothing is persisted", async () => {
  const home = await createPaseoHome({ version: 1 });

  expect(
    loadConfig(home, { env: { PASEO_BROWSER_TOOLS_ENABLED: "true" } }).browserToolsEnabled,
  ).toBe(true);
});

test("the persisted setting wins over PASEO_BROWSER_TOOLS_ENABLED", async () => {
  const home = await createPaseoHome({
    version: 1,
    daemon: { browserTools: { enabled: false } },
  });

  expect(
    loadConfig(home, { env: { PASEO_BROWSER_TOOLS_ENABLED: "true" } }).browserToolsEnabled,
  ).toBe(false);
});

test("reads the CDP URL from PASEO_BROWSER_CDP_URL", async () => {
  const home = await createPaseoHome({ version: 1 });

  expect(loadConfig(home, { env: {} }).browserCdpUrl).toBeUndefined();
  expect(loadConfig(home, { env: { PASEO_BROWSER_CDP_URL: "  " } }).browserCdpUrl).toBeUndefined();
  expect(
    loadConfig(home, { env: { PASEO_BROWSER_CDP_URL: "http://127.0.0.1:9222" } }).browserCdpUrl,
  ).toBe("http://127.0.0.1:9222");
});
```

Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/config-browser-tools.test.ts --bail=1`. Expected: the three new tests fail.

- [ ] **Step 2: Read the two variables**

`config-environment.ts`: `loadConfig` only sees variables on this allowlist. Add both, keeping the list alphabetical (they sort after `PASEO_APP_BASE_URL`):

```ts
  "PASEO_BROWSER_CDP_URL",
  "PASEO_BROWSER_TOOLS_ENABLED",
```

`config.ts`:

```ts
function resolveBrowserToolsEnabled(
  env: NodeJS.ProcessEnv,
  persisted: ReturnType<typeof loadPersistedConfig>,
): boolean {
  // The variable is a default for a fresh home (the Docker image). A saved setting still wins,
  // so turning browser tools off in Settings sticks across restarts.
  return (
    persisted.daemon?.browserTools?.enabled ??
    parseBooleanEnv(env.PASEO_BROWSER_TOOLS_ENABLED) ??
    false
  );
}
```

In `resolveStaticLoadConfigSettings`, the call becomes `browserToolsEnabled: resolveBrowserToolsEnabled(env, persisted),`.

In the object `resolveConfigFromPersisted` returns, after `pluginRegistryUrl`:

```ts
    browserCdpUrl: nonEmptyEnv(env.PASEO_BROWSER_CDP_URL),
```

`bootstrap.ts`, in `PaseoDaemonConfig` after `browserToolsEnabled?: boolean;`:

```ts
  /** CDP origin of the Docker Chromium (PASEO_BROWSER_CDP_URL). Unset means no daemon browser host. */
  browserCdpUrl?: string;
```

Run the config test again. Expected: all pass. Then run the allowlist's own test so the new keys do not break it:

```bash
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/config-environment.test.ts src/server/config.test.ts --no-file-parallelism --maxWorkers=1 --bail=1
```

If `config-environment.test.ts` does not exist, run `config.test.ts` alone.

- [ ] **Step 3: Write the factory**

```ts
// packages/server/src/server/browser-tools/cdp/create-cdp-browser-service.ts
import path from "node:path";
import type { Logger } from "pino";
import type { BrowserToolsBroker } from "../broker.js";
import { CdpBrowserService } from "./cdp-browser-service.js";
import { CdpEndpoint } from "./cdp-endpoint.js";
import { CdpTabRegistry } from "./tab-registry.js";

export function createCdpBrowserService(input: {
  url: string;
  paseoHome: string;
  broker: BrowserToolsBroker;
  logger: Logger;
}): CdpBrowserService {
  const logger = input.logger.child({ module: "cdp-browser" });
  const onError = (error: unknown) => logger.debug({ err: error }, "CDP error");
  return new CdpBrowserService({
    endpoint: new CdpEndpoint({ url: input.url, onError }),
    registry: new CdpTabRegistry(
      path.join(input.paseoHome, "browser-tools", "cdp-tabs.json"),
      (error) => logger.warn({ err: error }, "Failed to read or write the CDP tab registry"),
    ),
    broker: input.broker,
    logger,
  });
}
```

- [ ] **Step 4: Wire it into bootstrap**

Import at the top of `bootstrap.ts`:

```ts
import { createCdpBrowserService } from "./browser-tools/cdp/create-cdp-browser-service.js";
```

Right after `const browserToolsBroker = new BrowserToolsBroker({});`:

```ts
// Fork delta (web browser pane): the daemon hosts the Docker Chromium when a CDP URL is set.
const cdpBrowser = config.browserCdpUrl
  ? createCdpBrowserService({
      url: config.browserCdpUrl,
      paseoHome: config.paseoHome,
      broker: browserToolsBroker,
      logger,
    })
  : null;
browserToolsBroker.cdpBrowser = cdpBrowser;
```

Right after `await pluginRuntime.start();`:

```ts
// Never awaited and never throws: an unreachable Chromium must not block daemon start.
cdpBrowser?.start();
```

In `stop`, right after `await deleteLocalCredential(config.paseoHome);`:

```ts
await cdpBrowser?.stop().catch((error) => {
  logger.warn({ err: error }, "Failed to stop the CDP browser host");
});
```

- [ ] **Step 5: Set the variables in compose**

In each of `docker/docker-compose.yml`, `docker/docker-compose.agent.yml` and `docker/docker-compose.vpn.yml`, in the `paseo` service's `environment`, after `PASEO_HOSTNAMES`:

```yaml
# The daemon's own browser host. paseo-cdp puts the Chromium's CDP on this
# container's loopback, the only address Chrome's Host check accepts
# without a lookup. Set PASEO_BROWSER_CDP_URL to an empty string to turn
# the host off.
PASEO_BROWSER_CDP_URL: ${PASEO_BROWSER_CDP_URL-http://127.0.0.1:9222}
PASEO_BROWSER_TOOLS_ENABLED: ${PASEO_BROWSER_TOOLS_ENABLED:-true}
```

`${VAR-default}` (no colon) keeps an explicitly empty value empty. Add the two lines to a file only if it has a `paseo-cdp` service:

```bash
cd /workspace/utils/paseo
grep -c "paseo-cdp:" docker/docker-compose.yml docker/docker-compose.agent.yml docker/docker-compose.vpn.yml
node --test scripts/vpn-overlay.test.mjs
```

Expected: each file the variables went into prints 1; the overlay test passes (it compares the compose files' services and env passthrough).

- [ ] **Step 6: Document it in `docs/docker.md`**

Add this section before `## Security`, and one line to the Security section. Match the doc's voice.

```markdown
## Browser

The compose files run a Chromium next to the daemon and set `PASEO_BROWSER_CDP_URL` to its CDP
address. With it set, the daemon is a browser host: agents' `browser_*` tools open and drive tabs
in that Chromium, and the browser pane in the web UI and the mobile app shows the same tab.
`PASEO_BROWSER_TOOLS_ENABLED` turns the agent tools on for a fresh home; the setting in the app
overrides it once saved.

The daemon touches only tabs it opened. It keeps their ids in
`$PASEO_HOME/browser-tools/cdp-tabs.json` and never lists, drives or closes any other tab, so
your own tabs and another instance's tabs on a shared Chromium are left alone. Each tab the
daemon opens is its own Chromium window, because Chromium paints no frames for a background tab.

The profile is shared: a tab the daemon opens has your logins.
```

Security section line: `- CDP has no authentication. Anything that can reach the Chromium's CDP port controls the logged-in profile; keep it on the compose network.`

- [ ] **Step 7: Verify and commit**

Typecheck the server, lint, format the changed files (include the three compose files and `docs/docker.md`).

Message: `feat(fork): start the Docker browser host from PASEO_BROWSER_CDP_URL`

## Task 9: Hand-run test against a real Chromium, and the Phase 2 checkpoint

**Files:**

- Create: `packages/server/src/server/browser-tools/cdp/cdp-host.local.e2e.test.ts`

**Interfaces:**

- Consumes: everything from Tasks 3 to 7.
- Produces: nothing new. The file is skipped unless `PASEO_TEST_CDP_URL` is set, and its `.local.e2e.test.ts` name keeps it out of `test:unit` and Fork CI.

- [ ] **Step 1: Write the test**

The Chromium is the user's logged-in browser. This file opens its own tabs on `about:blank`, never navigates to a site, and closes only what it opened.

```ts
// packages/server/src/server/browser-tools/cdp/cdp-host.local.e2e.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { BrowserToolsBroker } from "../broker.js";
import { CdpBrowserService } from "./cdp-browser-service.js";
import { CdpEndpoint } from "./cdp-endpoint.js";
import { CdpTabRegistry } from "./tab-registry.js";

const CDP_URL = process.env.PASEO_TEST_CDP_URL;
const WORKSPACE = "e2e-workspace";
const logger = { debug: () => {}, warn: console.warn, error: console.error };

describe.skipIf(!CDP_URL)("CDP host against a real Chromium", () => {
  let dir: string;
  let endpoint: CdpEndpoint;
  let broker: BrowserToolsBroker;
  let service: CdpBrowserService;
  let foreignBefore: string[];
  let browserId: string;

  const run = async (command: Record<string, unknown>) => {
    const payload = await broker.execute({
      command: command as never,
      workspaceId: WORKSPACE,
      timeoutMs: 30_000,
    });
    if (!payload.ok)
      throw new Error(`${String(command.command)} failed: ${JSON.stringify(payload.error)}`);
    return payload.result as Record<string, unknown>;
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "paseo-cdp-e2e-"));
    endpoint = new CdpEndpoint({ url: CDP_URL! });
    foreignBefore = (await endpoint.listTargets()).map((target) => target.id).sort();
    broker = new BrowserToolsBroker({});
    service = new CdpBrowserService({
      endpoint,
      registry: new CdpTabRegistry(path.join(dir, "cdp-tabs.json")),
      broker,
      logger,
    });
    service.start();
    const deadline = Date.now() + 10_000;
    while (!service.connected) {
      if (Date.now() > deadline) throw new Error(`CDP at ${CDP_URL} did not answer`);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  afterAll(async () => {
    // Close only what this run registered, even after a failed test.
    for (const tab of service?.listTabs() ?? []) await service.closeTab(tab.browserId);
    await service?.stop();
    await rm(dir, { recursive: true, force: true });
  });

  test("opens its own tab and leaves every other target alone", async () => {
    const result = await run({ command: "new_tab", args: {} });
    browserId = String(result.browserId);
    expect(result.url).toBe("about:blank");
    const tabs = await run({ command: "list_tabs" });
    expect((tabs.tabs as Array<{ browserId: string }>).map((tab) => tab.browserId)).toEqual([
      browserId,
    ]);
  });

  test("the tab is visible and paints, which a background tab does not", async () => {
    const tab = await service.attachedTab(browserId);
    expect(await tab!.executeJavaScript("document.visibilityState")).toBe("visible");
    expect(
      await tab!.executeJavaScript(
        "new Promise((resolve) => requestAnimationFrame(() => resolve('painted')))",
      ),
    ).toBe("painted");
  });

  test("snapshot, click by ref and evaluate work on a page built in place", async () => {
    const tab = await service.attachedTab(browserId);
    await tab!.executeJavaScript(
      `document.body.innerHTML = '<button id="go" onclick="document.title = \\'clicked\\'">Go</button>'; true`,
    );
    const snapshot = await run({ command: "snapshot", args: { browserId } });
    const text = JSON.stringify(snapshot);
    const ref = /\[ref=([^\]]+)\]/.exec(text)?.[1] ?? /"ref":"([^"]+)"/.exec(text)?.[1];
    expect(ref, `no ref in snapshot: ${text.slice(0, 400)}`).toBeTruthy();
    await run({ command: "click", args: { browserId, ref } });
    const evaluated = await run({
      command: "evaluate",
      args: { browserId, function: "() => document.title" },
    });
    expect(String(evaluated.resultJson)).toContain("clicked");
  });

  test("screenshot returns a PNG", async () => {
    const shot = await run({ command: "screenshot", args: { browserId } });
    expect(shot.mimeType).toBe("image/png");
    expect(Buffer.from(String(shot.dataBase64), "base64").subarray(1, 4).toString()).toBe("PNG");
  });

  test("close_tab removes the tab and the other targets are unchanged", async () => {
    await run({ command: "close_tab", args: { browserId } });
    expect(service.listTabs()).toEqual([]);
    const after = (await endpoint.listTargets()).map((target) => target.id).sort();
    expect(after).toEqual(foreignBefore);
  });
});
```

The snapshot result's `snapshot` field is aria YAML; the regex reads the first `[ref=...]` out of it.

- [ ] **Step 2: Run it against the Docker Chromium**

```bash
cd /workspace/utils/paseo/packages/server
curl -s http://127.0.0.1:9222/json/version | head -c 200   # expect: a JSON object naming Chrome
PASEO_TEST_CDP_URL=http://127.0.0.1:9222 flock -w 480 /tmp/paseo-heavy.lock \
  npx vitest run src/server/browser-tools/cdp/cdp-host.local.e2e.test.ts --bail=1
```

Expected: 5 passed. Then confirm the file is skipped without the variable and stays out of the unit run:

```bash
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/cdp-host.local.e2e.test.ts --bail=1
# expect: 5 skipped
```

- [ ] **Step 3: Run every Phase 2 unit test in one process**

```bash
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools --exclude "**/*.e2e.test.ts" \
  --no-file-parallelism --maxWorkers=1 --bail=1
```

Expected: all files pass.

- [ ] **Step 4: Verify and commit**

Message: `test(fork): hand-run CDP host test against a real Chromium`

**Phase 2 checkpoint (deployable):** with `PASEO_BROWSER_CDP_URL` set, an agent's `browser_new_tab`, `browser_snapshot`, `browser_click` and `browser_screenshot` work against the Docker Chromium with no Electron app connected. With it unset, `browserToolsBroker.cdpBrowser` is `null` and behaviour is upstream's. The UI is unchanged.

---

# Phase 3: The view

Ends with the browser pane working in the web UI and the native app: live frames, input, toolbar, tab open and close, and the agent badge.

## Task 10: Protocol: messages, binary frame, feature flag, permissions

**Files:**

- Create: `packages/protocol/src/browser-automation/cdp-view-schemas.ts`
- Create: `packages/protocol/src/binary-frames/browser-view.ts`
- Test: `packages/protocol/src/binary-frames/browser-view.test.ts`
- Test: `packages/protocol/src/messages.cdp-browser.test.ts`
- Modify: `packages/protocol/src/binary-frames/index.ts`, `packages/protocol/src/binary-frames/demux.ts`
- Modify: `packages/protocol/src/messages.ts` (inbound union near line 3598, outbound union near line 7510, `features` near line 4023)
- Modify: `packages/server/src/server/authorization/operation-permissions.ts`

**Interfaces:**

- Consumes: nothing.
- Produces (all exported from `cdp-view-schemas.ts`, types inferred with `z.infer`):
  - `CdpBrowserTabStateSchema` / `CdpBrowserTabState`
  - `CdpBrowserTabsEventSchema` / `CdpBrowserTabsEvent`
  - `CdpBrowserViewportSchema` / `CdpBrowserViewport`
  - `CdpBrowserViewInputSchema` / `CdpBrowserViewInput`
  - `CdpBrowserNavigateActionSchema` / `CdpBrowserNavigateAction`
  - the message schemas listed in Step 3
  - `CDP_BROWSER_ERROR_CODES` and `type CdpBrowserErrorCode`
- Produces, in `binary-frames/browser-view.ts`: `BROWSER_VIEW_OPCODE = 0x50`, `interface BrowserViewFrame`, `encodeBrowserViewFrame(frame): Uint8Array`, `decodeBrowserViewFrame(bytes): BrowserViewFrame | null`.
- Produces: `server_info.features.cdpBrowser?: boolean`.

Wire rules for this task: every schema is a plain `z.object` or `z.discriminatedUnion`. No `transform`, `catch`, `preprocess` or `default`.

- [ ] **Step 1: Write the failing frame codec test**

```ts
// packages/protocol/src/binary-frames/browser-view.test.ts
import { describe, expect, test } from "vitest";
import {
  BROWSER_VIEW_OPCODE,
  decodeBrowserViewFrame,
  encodeBrowserViewFrame,
} from "./browser-view.js";
import { decodeBinaryFrame } from "./demux.js";

const frame = {
  subscriptionId: "6f1c2f0e-8f3b-4c55-9a43-1f1f6e1d2b77",
  sequence: 4_000_000_001,
  deviceWidth: 390,
  deviceHeight: 700,
  pageScaleFactor: 1.5,
  scrollX: 0,
  scrollY: 1234.5,
  jpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]),
};

describe("browser view frame", () => {
  test("round trips", () => {
    const bytes = encodeBrowserViewFrame(frame);
    expect(bytes[0]).toBe(BROWSER_VIEW_OPCODE);
    expect(decodeBrowserViewFrame(bytes)).toEqual(frame);
  });

  test("decodes from a view into a larger buffer", () => {
    const bytes = encodeBrowserViewFrame(frame);
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 8);
    expect(decodeBrowserViewFrame(padded.subarray(8))).toEqual(frame);
  });

  test("rejects another opcode, an unknown version and a truncated frame", () => {
    const bytes = encodeBrowserViewFrame(frame);
    expect(decodeBrowserViewFrame(new Uint8Array([0x01, 1, 0]))).toBeNull();
    const wrongVersion = bytes.slice();
    wrongVersion[1] = 9;
    expect(decodeBrowserViewFrame(wrongVersion)).toBeNull();
    expect(decodeBrowserViewFrame(bytes.subarray(0, 10))).toBeNull();
  });

  test("the demux names the frame kind", () => {
    expect(decodeBinaryFrame(encodeBrowserViewFrame(frame))).toEqual({
      kind: "browser_view",
      frame,
    });
  });
});
```

Run from `packages/protocol`: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/binary-frames/browser-view.test.ts --bail=1`. Expected: FAIL, cannot resolve `./browser-view.js`.

- [ ] **Step 2: Implement the frame codec and register it**

```ts
// packages/protocol/src/binary-frames/browser-view.ts
// Opcode 0x50 carries one screencast frame of a daemon-hosted browser tab. 0x40–0x4f are diffs.
// Layout: [0x50][version u8][idLength u8][subscriptionId utf8][sequence u32][deviceWidth u16]
// [deviceHeight u16][pageScaleFactor f32][scrollX f32][scrollY f32][jpeg...], big-endian.
export const BROWSER_VIEW_OPCODE = 0x50;
const VERSION = 1;
const METADATA_BYTES = 20;

export interface BrowserViewFrame {
  subscriptionId: string;
  /** Increases by one per frame of a tab; a client drops a frame older than the one it shows. */
  sequence: number;
  /** The page viewport in CSS pixels. Input coordinates are in this space. */
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
  scrollX: number;
  scrollY: number;
  jpeg: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function encodeBrowserViewFrame(frame: BrowserViewFrame): Uint8Array {
  const id = encoder.encode(frame.subscriptionId);
  if (id.length > 255) throw new Error("Browser view subscription id is too long");
  const header = 3 + id.length;
  const bytes = new Uint8Array(header + METADATA_BYTES + frame.jpeg.length);
  bytes[0] = BROWSER_VIEW_OPCODE;
  bytes[1] = VERSION;
  bytes[2] = id.length;
  bytes.set(id, 3);
  const view = new DataView(bytes.buffer, bytes.byteOffset + header, METADATA_BYTES);
  view.setUint32(0, frame.sequence >>> 0);
  view.setUint16(4, Math.min(0xffff, Math.max(0, Math.round(frame.deviceWidth))));
  view.setUint16(6, Math.min(0xffff, Math.max(0, Math.round(frame.deviceHeight))));
  view.setFloat32(8, frame.pageScaleFactor);
  view.setFloat32(12, frame.scrollX);
  view.setFloat32(16, frame.scrollY);
  bytes.set(frame.jpeg, header + METADATA_BYTES);
  return bytes;
}

export function decodeBrowserViewFrame(bytes: Uint8Array): BrowserViewFrame | null {
  if (bytes.length < 3 || bytes[0] !== BROWSER_VIEW_OPCODE || bytes[1] !== VERSION) return null;
  const header = 3 + bytes[2];
  if (bytes.length < header + METADATA_BYTES) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset + header, METADATA_BYTES);
  return {
    subscriptionId: decoder.decode(bytes.subarray(3, header)),
    sequence: view.getUint32(0),
    deviceWidth: view.getUint16(4),
    deviceHeight: view.getUint16(6),
    pageScaleFactor: view.getFloat32(8),
    scrollX: view.getFloat32(12),
    scrollY: view.getFloat32(16),
    jpeg: bytes.subarray(header + METADATA_BYTES),
  };
}
```

`binary-frames/index.ts`: add `export * from "./browser-view.js";`.

`binary-frames/demux.ts`: import `BROWSER_VIEW_OPCODE, decodeBrowserViewFrame, type BrowserViewFrame` from `./browser-view.js`; add `| { kind: "browser_view"; frame: BrowserViewFrame }` to `BinaryFrame`; in `decodeExistingBinaryFrame` add before `default`:

```ts
    case BROWSER_VIEW_OPCODE: {
      const frame = decodeBrowserViewFrame(bytes);
      return frame ? { kind: "browser_view", frame } : null;
    }
```

Then find the callers that switch on the kind, and give each exhaustive switch a `case "browser_view":` that does what its `default` or `plugin` case does for a frame it does not consume:

```bash
cd /workspace/utils/paseo && grep -rn "decodeBinaryFrame(" packages/*/src --include=*.ts --include=*.tsx | grep -v "\.test\."
```

Run the codec test again. Expected: 4 passed. The float fields in the fixture (`1.5`, `1234.5`) are exact in float32, so `toEqual` holds.

- [ ] **Step 3: Write the failing message test**

```ts
// packages/protocol/src/messages.cdp-browser.test.ts
import { describe, expect, test } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

const TAB = {
  browserId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "ws-a",
  url: "https://example.com/",
  title: "Example",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  agentActiveUntil: null,
};

describe("browser.cdp messages", () => {
  test("parses every inbound request", () => {
    const messages = [
      { type: "browser.cdp.tab.open.request", requestId: "r1", workspaceId: "ws-a" },
      {
        type: "browser.cdp.tab.open.request",
        requestId: "r1",
        workspaceId: "ws-a",
        url: "https://example.com/",
      },
      { type: "browser.cdp.tab.close.request", requestId: "r2", browserId: TAB.browserId },
      { type: "browser.cdp.tabs.subscribe.request", requestId: "r3" },
      { type: "browser.cdp.tabs.subscribe.request", requestId: "r3", workspaceId: "ws-a" },
      {
        type: "browser.cdp.view.subscribe.request",
        requestId: "r4",
        browserId: TAB.browserId,
        width: 390,
        height: 700,
        deviceScaleFactor: 2,
      },
      {
        type: "browser.cdp.view.navigate.request",
        requestId: "r5",
        browserId: TAB.browserId,
        action: { kind: "url", url: "https://example.com/" },
      },
      {
        type: "browser.cdp.view.navigate.request",
        requestId: "r5",
        browserId: TAB.browserId,
        action: { kind: "back" },
      },
      {
        type: "browser.cdp.view.input.request",
        subscriptionId: "s1",
        input: {
          kind: "mouse",
          type: "down",
          x: 10,
          y: 20,
          button: "left",
          buttons: 1,
          clickCount: 1,
          modifiers: 0,
        },
        viewport: { width: 390, height: 700, deviceScaleFactor: 2 },
      },
      {
        type: "browser.cdp.view.input.request",
        subscriptionId: "s1",
        input: { kind: "wheel", x: 1, y: 2, deltaX: 0, deltaY: 120, modifiers: 0 },
      },
      {
        type: "browser.cdp.view.input.request",
        subscriptionId: "s1",
        input: { kind: "key", type: "down", key: "a", code: "KeyA", text: "a", modifiers: 0 },
      },
      {
        type: "browser.cdp.view.input.request",
        subscriptionId: "s1",
        input: { kind: "text", text: "hello" },
      },
    ];
    for (const message of messages) {
      expect(SessionInboundMessageSchema.parse(message)).toEqual(message);
    }
  });

  test("parses every outbound message", () => {
    const messages = [
      {
        type: "browser.cdp.tab.open.response",
        payload: { requestId: "r1", tab: TAB, error: null },
      },
      {
        type: "browser.cdp.tab.open.response",
        payload: { requestId: "r1", tab: null, error: "browser_no_host" },
      },
      { type: "browser.cdp.tab.close.response", payload: { requestId: "r2", error: null } },
      {
        type: "browser.cdp.tabs.subscribe.response",
        payload: {
          requestId: "r3",
          subscriptionId: "s0",
          connected: true,
          tabs: [TAB],
          error: null,
        },
      },
      {
        type: "browser.cdp.tabs.update",
        payload: { subscriptionId: "s0", event: { kind: "opened", tab: TAB } },
      },
      {
        type: "browser.cdp.tabs.update",
        payload: {
          subscriptionId: "s0",
          event: { kind: "state", tab: { ...TAB, agentActiveUntil: 123 } },
        },
      },
      {
        type: "browser.cdp.tabs.update",
        payload: {
          subscriptionId: "s0",
          event: {
            kind: "closed",
            browserId: TAB.browserId,
            workspaceId: "ws-a",
            lastUrl: "https://example.com/",
          },
        },
      },
      {
        type: "browser.cdp.tabs.update",
        payload: { subscriptionId: "s0", event: { kind: "host", connected: false } },
      },
      {
        type: "browser.cdp.view.subscribe.response",
        payload: { requestId: "r4", subscriptionId: "s1", error: null },
      },
      {
        type: "browser.cdp.view.update",
        payload: { subscriptionId: "s1", error: "browser_timeout" },
      },
      { type: "browser.cdp.view.navigate.response", payload: { requestId: "r5", error: null } },
    ];
    for (const message of messages) {
      expect(SessionOutboundMessageSchema.parse(message)).toEqual(message);
    }
  });

  test("rejects an input kind it does not know", () => {
    expect(
      SessionInboundMessageSchema.safeParse({
        type: "browser.cdp.view.input.request",
        subscriptionId: "s1",
        input: { kind: "pinch", scale: 2 },
      }).success,
    ).toBe(false);
  });
});
```

Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/messages.cdp-browser.test.ts --bail=1`. Expected: FAIL on the first parse.

- [ ] **Step 4: Write the schemas**

```ts
// packages/protocol/src/browser-automation/cdp-view-schemas.ts
// Fork delta (web browser pane): the daemon-hosted Docker Chromium. Gate: server_info.features.cdpBrowser.
import { z } from "zod";

/** The `error` field of every browser.cdp response is one of these codes, or null. */
export const CDP_BROWSER_ERROR_CODES = [
  "browser_unsupported",
  "browser_no_host",
  "browser_tab_not_found",
  "browser_timeout",
  "browser_unknown_error",
] as const;
export type CdpBrowserErrorCode = (typeof CDP_BROWSER_ERROR_CODES)[number];

export const CdpBrowserTabStateSchema = z.object({
  browserId: z.string(),
  workspaceId: z.string(),
  url: z.string(),
  title: z.string(),
  isLoading: z.boolean(),
  canGoBack: z.boolean(),
  canGoForward: z.boolean(),
  /** Daemon clock, epoch ms. Non-null while an agent used the tab in the last 3 s. */
  agentActiveUntil: z.number().nullable(),
});

export const CdpBrowserTabsEventSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("opened"), tab: CdpBrowserTabStateSchema }),
  z.object({ kind: z.literal("state"), tab: CdpBrowserTabStateSchema }),
  z.object({
    kind: z.literal("closed"),
    browserId: z.string(),
    workspaceId: z.string(),
    lastUrl: z.string(),
  }),
  z.object({ kind: z.literal("host"), connected: z.boolean() }),
]);

/** The pane's size in CSS pixels and its device pixel ratio. The daemon clamps all three. */
export const CdpBrowserViewportSchema = z.object({
  width: z.number(),
  height: z.number(),
  deviceScaleFactor: z.number(),
});

/** Coordinates are page CSS pixels. `modifiers` is the CDP bit mask: Alt 1, Control 2, Meta 4, Shift 8. */
export const CdpBrowserViewInputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("mouse"),
    type: z.enum(["move", "down", "up"]),
    x: z.number(),
    y: z.number(),
    button: z.enum(["none", "left", "middle", "right"]),
    buttons: z.number().int(),
    clickCount: z.number().int(),
    modifiers: z.number().int(),
  }),
  z.object({
    kind: z.literal("wheel"),
    x: z.number(),
    y: z.number(),
    deltaX: z.number(),
    deltaY: z.number(),
    modifiers: z.number().int(),
  }),
  z.object({
    kind: z.literal("key"),
    type: z.enum(["down", "up"]),
    key: z.string(),
    code: z.string(),
    text: z.string().optional(),
    modifiers: z.number().int(),
  }),
  z.object({ kind: z.literal("text"), text: z.string() }),
]);

export const CdpBrowserNavigateActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("url"), url: z.string() }),
  z.object({ kind: z.literal("back") }),
  z.object({ kind: z.literal("forward") }),
  z.object({ kind: z.literal("reload") }),
]);

export const BrowserCdpTabOpenRequestSchema = z.object({
  type: z.literal("browser.cdp.tab.open.request"),
  requestId: z.string(),
  workspaceId: z.string(),
  url: z.string().optional(),
});
export const BrowserCdpTabOpenResponseSchema = z.object({
  type: z.literal("browser.cdp.tab.open.response"),
  payload: z.object({
    requestId: z.string(),
    tab: CdpBrowserTabStateSchema.nullable(),
    error: z.string().nullable(),
  }),
});

export const BrowserCdpTabCloseRequestSchema = z.object({
  type: z.literal("browser.cdp.tab.close.request"),
  requestId: z.string(),
  browserId: z.string(),
});
export const BrowserCdpTabCloseResponseSchema = z.object({
  type: z.literal("browser.cdp.tab.close.response"),
  payload: z.object({ requestId: z.string(), error: z.string().nullable() }),
});

/** An owned subscription. The response is the tab list; browser.cdp.tabs.update follows. */
export const BrowserCdpTabsSubscribeRequestSchema = z.object({
  type: z.literal("browser.cdp.tabs.subscribe.request"),
  requestId: z.string(),
  workspaceId: z.string().optional(),
});
export const BrowserCdpTabsSubscribeResponseSchema = z.object({
  type: z.literal("browser.cdp.tabs.subscribe.response"),
  payload: z.object({
    requestId: z.string(),
    subscriptionId: z.string(),
    connected: z.boolean(),
    tabs: z.array(CdpBrowserTabStateSchema),
    error: z.string().nullable(),
  }),
});
export const BrowserCdpTabsUpdateSchema = z.object({
  type: z.literal("browser.cdp.tabs.update"),
  payload: z.object({ subscriptionId: z.string(), event: CdpBrowserTabsEventSchema }),
});

/** An owned subscription. Frames arrive as binary frames with opcode 0x50. */
export const BrowserCdpViewSubscribeRequestSchema = z.object({
  type: z.literal("browser.cdp.view.subscribe.request"),
  requestId: z.string(),
  browserId: z.string(),
  width: z.number(),
  height: z.number(),
  deviceScaleFactor: z.number(),
});
export const BrowserCdpViewSubscribeResponseSchema = z.object({
  type: z.literal("browser.cdp.view.subscribe.response"),
  payload: z.object({
    requestId: z.string(),
    subscriptionId: z.string(),
    error: z.string().nullable(),
  }),
});
/** The view stopped or stalled: the tab closed, the host went away, or a command timed out. */
export const BrowserCdpViewUpdateSchema = z.object({
  type: z.literal("browser.cdp.view.update"),
  payload: z.object({ subscriptionId: z.string(), error: z.string() }),
});

// Input is a stream, so it has no response. diff.unsubscribe.request is the precedent.
export const BrowserCdpViewInputRequestSchema = z.object({
  type: z.literal("browser.cdp.view.input.request"),
  subscriptionId: z.string(),
  input: CdpBrowserViewInputSchema,
  /** The sender's pane size. Any input claims the tab's viewport for this client. */
  viewport: CdpBrowserViewportSchema.optional(),
});

export const BrowserCdpViewNavigateRequestSchema = z.object({
  type: z.literal("browser.cdp.view.navigate.request"),
  requestId: z.string(),
  browserId: z.string(),
  action: CdpBrowserNavigateActionSchema,
});
export const BrowserCdpViewNavigateResponseSchema = z.object({
  type: z.literal("browser.cdp.view.navigate.response"),
  payload: z.object({ requestId: z.string(), error: z.string().nullable() }),
});

export type CdpBrowserTabState = z.infer<typeof CdpBrowserTabStateSchema>;
export type CdpBrowserTabsEvent = z.infer<typeof CdpBrowserTabsEventSchema>;
export type CdpBrowserViewport = z.infer<typeof CdpBrowserViewportSchema>;
export type CdpBrowserViewInput = z.infer<typeof CdpBrowserViewInputSchema>;
export type CdpBrowserNavigateAction = z.infer<typeof CdpBrowserNavigateActionSchema>;
```

- [ ] **Step 5: Register the messages and the feature flag in `messages.ts`**

Import the eleven message schemas from `./browser-automation/cdp-view-schemas.js`, next to the existing import from `./browser-automation/rpc-schemas.js`.

In `SessionInboundMessageSchema`, after `BrowserAutomationExecuteResponseSchema`:

```ts
  BrowserCdpTabOpenRequestSchema,
  BrowserCdpTabCloseRequestSchema,
  BrowserCdpTabsSubscribeRequestSchema,
  BrowserCdpViewSubscribeRequestSchema,
  BrowserCdpViewInputRequestSchema,
  BrowserCdpViewNavigateRequestSchema,
```

In `SessionOutboundMessageSchema`, after `BrowserAutomationExecuteRequestSchema`:

```ts
  BrowserCdpTabOpenResponseSchema,
  BrowserCdpTabCloseResponseSchema,
  BrowserCdpTabsSubscribeResponseSchema,
  BrowserCdpTabsUpdateSchema,
  BrowserCdpViewSubscribeResponseSchema,
  BrowserCdpViewUpdateSchema,
  BrowserCdpViewNavigateResponseSchema,
```

In the `features` object, after `agentRuntimeClose`:

```ts
        // Fork delta (web browser pane): the daemon hosts a Docker Chromium; browser.cdp.* RPCs.
        // COMPAT(cdpBrowser): added in v0.15.5, remove gate after 2027-05-10.
        cdpBrowser: z.boolean().optional(),
```

Run:

```bash
cd /workspace/utils/paseo/packages/protocol
npm run generate:validators
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/messages.cdp-browser.test.ts src/binary-frames/browser-view.test.ts src/binary-frames/demux.test.ts --no-file-parallelism --maxWorkers=1 --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded
```

Expected: all pass, typecheck exits 0. If `generate:validators` rejects a schema, read `docs/protocol-validation.md` for the purity rule it names and fix the schema, not the generator.

- [ ] **Step 6: Add the permissions**

In `operation-permissions.ts`, in the inbound map after `"browser.automation.execute.response"`:

```ts
  "browser.cdp.tab.open.request": "workspace.write",
  "browser.cdp.tab.close.request": "workspace.write",
  "browser.cdp.tabs.subscribe.request": "workspace.read",
  "browser.cdp.view.subscribe.request": "workspace.read",
  "browser.cdp.view.input.request": "workspace.write",
  "browser.cdp.view.navigate.request": "workspace.write",
```

In the outbound map after `"browser.automation.execute.request"`:

```ts
  "browser.cdp.tab.open.response": "workspace.write",
  "browser.cdp.tab.close.response": "workspace.write",
  "browser.cdp.tabs.subscribe.response": "workspace.read",
  "browser.cdp.tabs.update": "workspace.read",
  "browser.cdp.view.subscribe.response": "workspace.read",
  "browser.cdp.view.update": "workspace.read",
  "browser.cdp.view.navigate.response": "workspace.write",
```

- [ ] **Step 7: Build the protocol, typecheck the server, commit**

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npm run build --workspace=@getpaseo/protocol
cd packages/server && flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded -p tsconfig.server.typecheck.json
```

Expected: exit 0. The permission maps use `satisfies Record<...>`, so a missing entry is a type error here. Lint, format, commit.

Message: `feat(fork): browser.cdp protocol messages and the view frame`

## Task 11: `ScreencastHub`

**Files:**

- Create: `packages/server/src/server/browser-tools/cdp/screencast-hub.ts`
- Test: `packages/server/src/server/browser-tools/cdp/screencast-hub.test.ts`
- Modify: `packages/server/src/server/browser-tools/cdp/cdp-browser-service.ts`

**Interfaces:**

- Consumes: a `ScreencastSource`, which `CdpConnection` satisfies.
- Produces:
  - `interface ScreencastFrame { sequence: number; jpeg: Uint8Array; deviceWidth: number; deviceHeight: number; pageScaleFactor: number; scrollX: number; scrollY: number }`
  - `interface ScreencastSource { send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>; on(event: string, listener: (params: Record<string, unknown>) => void): () => void }`
  - `interface ScreencastViewer { id: string; deliver(frame: ScreencastFrame): Promise<void> }`
  - `class ScreencastHub` with `constructor(options: ScreencastHubOptions)`, `watch(browserId: string, viewer: ScreencastViewer): Promise<() => void>` (rejects with `Error("browser_tab_not_found")` when the tab has no source), `rebind(browserId: string): Promise<void>`, `drop(browserId: string): void`, `viewerCount(browserId: string): number`.
  - `interface ScreencastHubOptions { source: (browserId: string) => Promise<ScreencastSource | null>; onError?: (error: unknown) => void; minFrameIntervalMs?: number }`
  - `SCREENCAST_PARAMS = { format: "jpeg", quality: 60, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 }`
  - `CdpBrowserService.screencast: ScreencastHub`

- [ ] **Step 1: Write the failing test**

```ts
// packages/server/src/server/browser-tools/cdp/screencast-hub.test.ts
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  SCREENCAST_PARAMS,
  ScreencastHub,
  type ScreencastFrame,
  type ScreencastSource,
} from "./screencast-hub.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]).toString("base64");

function fakeSource() {
  const calls: Array<{ method: string; params: Record<string, unknown> }> = [];
  const listeners = new Set<(params: Record<string, unknown>) => void>();
  const source: ScreencastSource = {
    send: async <T>(method: string, params: Record<string, unknown> = {}) => {
      calls.push({ method, params });
      if (method === "Page.captureScreenshot") return { data: JPEG } as T;
      if (method === "Page.getLayoutMetrics") {
        return {
          cssVisualViewport: { clientWidth: 390, clientHeight: 700, scale: 1, pageX: 0, pageY: 40 },
        } as T;
      }
      return {} as T;
    },
    on: (event, listener) => {
      if (event !== "Page.screencastFrame") return () => {};
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const frame = (sessionId: number, scrollY = 0) => {
    for (const listener of listeners) {
      listener({
        data: JPEG,
        sessionId,
        metadata: {
          deviceWidth: 390,
          deviceHeight: 700,
          pageScaleFactor: 1,
          scrollOffsetX: 0,
          scrollOffsetY: scrollY,
        },
      });
    }
  };
  const count = (method: string) => calls.filter((call) => call.method === method).length;
  return { source, calls, frame, count, listenerCount: () => listeners.size };
}

function viewer(id: string) {
  const frames: ScreencastFrame[] = [];
  return { id, frames, deliver: async (frame: ScreencastFrame) => void frames.push(frame) };
}

describe("ScreencastHub", () => {
  let fake: ReturnType<typeof fakeSource>;
  let hub: ScreencastHub;
  const flush = () => vi.advanceTimersByTimeAsync(0);

  beforeEach(() => {
    vi.useFakeTimers();
    fake = fakeSource();
    hub = new ScreencastHub({ source: async () => fake.source });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  test("starts on the first viewer and stops on the last", async () => {
    const stopA = await hub.watch("tab", viewer("a"));
    const stopB = await hub.watch("tab", viewer("b"));
    expect(fake.calls.filter((call) => call.method === "Page.startScreencast")).toEqual([
      { method: "Page.startScreencast", params: SCREENCAST_PARAMS },
    ]);
    stopA();
    expect(fake.count("Page.stopScreencast")).toBe(0);
    stopB();
    await flush();
    expect(fake.count("Page.stopScreencast")).toBe(1);
    expect(fake.listenerCount()).toBe(0);
    expect(hub.viewerCount("tab")).toBe(0);
  });

  test("fans each frame out with its metadata and a rising sequence", async () => {
    const a = viewer("a");
    const b = viewer("b");
    await hub.watch("tab", a);
    await hub.watch("tab", b);
    await flush();
    // Sequence 1 is the screenshot that primes a tab with no frame yet.
    expect(a.frames.map((frame) => frame.sequence)).toEqual([1]);
    fake.frame(1, 10);
    fake.frame(2, 20);
    await flush();
    expect(a.frames.slice(1).map((frame) => [frame.sequence, frame.scrollY])).toEqual([
      [2, 10],
      [3, 20],
    ]);
    expect(b.frames).toEqual(a.frames);
    expect(a.frames[1]).toMatchObject({
      deviceWidth: 390,
      deviceHeight: 700,
      pageScaleFactor: 1,
      scrollX: 0,
    });
    expect(Buffer.from(a.frames[1].jpeg).toString("base64")).toBe(JPEG);
  });

  test("a later viewer gets the cached frame at once, with no second screenshot", async () => {
    await hub.watch("tab", viewer("a"));
    await flush();
    fake.frame(1);
    await flush();
    const late = viewer("late");
    await hub.watch("tab", late);
    await flush();
    expect(late.frames.map((frame) => frame.sequence)).toEqual([2]);
    expect(fake.count("Page.captureScreenshot")).toBe(1);
  });

  test("with nothing cached the first viewer gets one screenshot", async () => {
    const a = viewer("a");
    await hub.watch("tab", a);
    await flush();
    expect(fake.calls.find((call) => call.method === "Page.captureScreenshot")?.params).toEqual({
      format: "jpeg",
      quality: 60,
    });
    expect(a.frames).toHaveLength(1);
    expect(a.frames[0]).toMatchObject({ deviceWidth: 390, deviceHeight: 700, scrollY: 40 });
  });

  test("a backed-up viewer keeps only the newest frame", async () => {
    const release: Array<() => void> = [];
    const seen: number[] = [];
    const slow = {
      id: "slow",
      deliver: (frame: ScreencastFrame) =>
        new Promise<void>((resolve) => {
          seen.push(frame.sequence);
          release.push(resolve);
        }),
    };
    const fast = viewer("fast");
    await hub.watch("tab", fast);
    await flush();
    await hub.watch("tab", slow);
    await flush();
    expect(seen).toEqual([1]);
    fake.frame(1);
    fake.frame(2);
    fake.frame(3);
    await flush();
    expect(seen).toEqual([1]);
    release.shift()?.();
    await flush();
    expect(seen).toEqual([1, 4]);
    expect(fast.frames.map((frame) => frame.sequence)).toEqual([1, 2, 3, 4]);
  });

  test("acks are at least 100 ms apart, which caps the stream at 10 frames per second", async () => {
    await hub.watch("tab", viewer("a"));
    const acks = () =>
      fake.calls
        .filter((call) => call.method === "Page.screencastFrameAck")
        .map((call) => call.params.sessionId);
    fake.frame(1);
    await flush();
    expect(acks()).toEqual([1]);
    await vi.advanceTimersByTimeAsync(10);
    fake.frame(2);
    await vi.advanceTimersByTimeAsync(80);
    expect(acks()).toEqual([1]);
    await vi.advanceTimersByTimeAsync(10);
    expect(acks()).toEqual([1, 2]);
  });

  test("a viewer whose delivery fails is removed", async () => {
    const broken = {
      id: "broken",
      deliver: async () => {
        throw new Error("socket closed");
      },
    };
    await hub.watch("tab", broken);
    await flush();
    expect(hub.viewerCount("tab")).toBe(0);
    expect(fake.count("Page.stopScreencast")).toBe(1);
  });

  test("rebind moves the viewers to the tab's new socket", async () => {
    let current = fake;
    const swapping = new ScreencastHub({ source: async () => current.source });
    const a = viewer("a");
    await swapping.watch("tab", a);
    await flush();
    fake.frame(1);
    await flush();
    const next = fakeSource();
    current = next;
    await swapping.rebind("tab");
    expect(fake.listenerCount()).toBe(0);
    expect(next.count("Page.startScreencast")).toBe(1);
    await vi.advanceTimersByTimeAsync(200);
    next.frame(7);
    await flush();
    expect(a.frames.map((frame) => frame.sequence)).toEqual([1, 2, 3]);
  });

  test("watch rejects when the tab has no source", async () => {
    const empty = new ScreencastHub({ source: async () => null });
    await expect(empty.watch("gone", viewer("a"))).rejects.toThrow("browser_tab_not_found");
  });

  test("drop forgets the tab without talking to its socket", async () => {
    await hub.watch("tab", viewer("a"));
    hub.drop("tab");
    await flush();
    expect(hub.viewerCount("tab")).toBe(0);
    expect(fake.count("Page.stopScreencast")).toBe(0);
  });
});
```

Run: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/screencast-hub.test.ts --bail=1`. Expected: FAIL, cannot resolve `./screencast-hub.js`.

- [ ] **Step 2: Implement `ScreencastHub`**

```ts
// packages/server/src/server/browser-tools/cdp/screencast-hub.ts
export interface ScreencastFrame {
  sequence: number;
  jpeg: Uint8Array;
  deviceWidth: number;
  deviceHeight: number;
  pageScaleFactor: number;
  scrollX: number;
  scrollY: number;
}

export interface ScreencastSource {
  send<T = Record<string, unknown>>(method: string, params?: Record<string, unknown>): Promise<T>;
  on(event: string, listener: (params: Record<string, unknown>) => void): () => void;
}

export interface ScreencastViewer {
  id: string;
  /** Resolves when the frame left this viewer's socket. A rejection removes the viewer. */
  deliver(frame: ScreencastFrame): Promise<void>;
}

export interface ScreencastHubOptions {
  source: (browserId: string) => Promise<ScreencastSource | null>;
  onError?: (error: unknown) => void;
  minFrameIntervalMs?: number;
}

export const SCREENCAST_PARAMS = {
  format: "jpeg",
  quality: 60,
  maxWidth: 1920,
  maxHeight: 1080,
  everyNthFrame: 1,
} as const;

interface ViewerSlot {
  viewer: ScreencastViewer;
  sending: boolean;
  pending: ScreencastFrame | null;
}

interface Watched {
  browserId: string;
  source: ScreencastSource;
  off: () => void;
  viewers: Map<string, ViewerSlot>;
  lastFrame: ScreencastFrame | null;
  sequence: number;
  lastAckAt: number;
  ackTimer: ReturnType<typeof setTimeout> | null;
}

const num = (value: unknown, fallback = 0) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** One screencast per watched tab, shared by every viewer of that tab. */
export class ScreencastHub {
  private readonly watched = new Map<string, Watched>();
  private readonly starting = new Map<string, Promise<Watched | null>>();
  private readonly minFrameIntervalMs: number;
  private readonly onError: (error: unknown) => void;

  constructor(private readonly options: ScreencastHubOptions) {
    this.minFrameIntervalMs = options.minFrameIntervalMs ?? 100;
    this.onError = options.onError ?? (() => {});
  }

  viewerCount(browserId: string): number {
    return this.watched.get(browserId)?.viewers.size ?? 0;
  }

  async watch(browserId: string, viewer: ScreencastViewer): Promise<() => void> {
    const watched = this.watched.get(browserId) ?? (await this.begin(browserId));
    if (!watched) throw new Error("browser_tab_not_found");
    const slot: ViewerSlot = { viewer, sending: false, pending: null };
    watched.viewers.set(viewer.id, slot);
    if (watched.lastFrame) this.push(watched, slot, watched.lastFrame);
    else void this.prime(watched).catch((error) => this.onError(error));
    return () => this.leave(watched, viewer.id);
  }

  /** The tab got a new socket. Listeners and the screencast belong to the old one. */
  async rebind(browserId: string): Promise<void> {
    const watched = this.watched.get(browserId);
    if (!watched) return;
    watched.off();
    const source = await this.options.source(browserId);
    if (this.watched.get(browserId) !== watched) return;
    if (!source) {
      this.drop(browserId);
      return;
    }
    watched.source = source;
    watched.off = this.listen(watched);
    await source.send("Page.startScreencast", { ...SCREENCAST_PARAMS });
  }

  drop(browserId: string): void {
    const watched = this.watched.get(browserId);
    if (!watched) return;
    this.watched.delete(browserId);
    watched.off();
    if (watched.ackTimer) clearTimeout(watched.ackTimer);
    watched.viewers.clear();
  }

  private begin(browserId: string): Promise<Watched | null> {
    const running = this.starting.get(browserId);
    if (running) return running;
    const start = (async () => {
      const source = await this.options.source(browserId);
      if (!source) return null;
      const watched: Watched = {
        browserId,
        source,
        off: () => {},
        viewers: new Map(),
        lastFrame: null,
        sequence: 0,
        lastAckAt: Number.NEGATIVE_INFINITY,
        ackTimer: null,
      };
      watched.off = this.listen(watched);
      await source.send("Page.startScreencast", { ...SCREENCAST_PARAMS });
      this.watched.set(browserId, watched);
      return watched;
    })().finally(() => this.starting.delete(browserId));
    this.starting.set(browserId, start);
    return start;
  }

  private listen(watched: Watched): () => void {
    return watched.source.on("Page.screencastFrame", (params) => {
      try {
        this.onFrame(watched, params);
      } catch (error) {
        this.onError(error);
      }
    });
  }

  private onFrame(watched: Watched, params: Record<string, unknown>): void {
    const metadata = (params.metadata ?? {}) as Record<string, unknown>;
    const frame: ScreencastFrame = {
      sequence: ++watched.sequence,
      jpeg: Buffer.from(String(params.data ?? ""), "base64"),
      deviceWidth: num(metadata.deviceWidth),
      deviceHeight: num(metadata.deviceHeight),
      pageScaleFactor: num(metadata.pageScaleFactor, 1),
      scrollX: num(metadata.scrollOffsetX),
      scrollY: num(metadata.scrollOffsetY),
    };
    watched.lastFrame = frame;
    for (const slot of watched.viewers.values()) this.push(watched, slot, frame);
    this.ack(watched, params.sessionId);
  }

  /** Chromium sends the next frame only after the ack, so delaying the ack caps the frame rate. */
  private ack(watched: Watched, sessionId: unknown): void {
    const send = () => {
      watched.ackTimer = null;
      watched.lastAckAt = Date.now();
      watched.source
        .send("Page.screencastFrameAck", { sessionId })
        .catch((error) => this.onError(error));
    };
    const wait = this.minFrameIntervalMs - (Date.now() - watched.lastAckAt);
    if (wait <= 0) {
      send();
      return;
    }
    if (watched.ackTimer) clearTimeout(watched.ackTimer);
    watched.ackTimer = setTimeout(send, wait);
  }

  /** At most one send in flight per viewer; frames that arrive meanwhile replace each other. */
  private push(watched: Watched, slot: ViewerSlot, frame: ScreencastFrame): void {
    if (slot.sending) {
      slot.pending = frame;
      return;
    }
    slot.sending = true;
    void (async () => {
      let next: ScreencastFrame | null = frame;
      while (next) {
        try {
          await slot.viewer.deliver(next);
        } catch {
          this.leave(watched, slot.viewer.id);
          return;
        }
        next = slot.pending;
        slot.pending = null;
      }
      slot.sending = false;
    })();
  }

  /** Chromium sends a frame only on repaint, so a still page needs one screenshot to show anything. */
  private async prime(watched: Watched): Promise<void> {
    const [shot, metrics] = await Promise.all([
      watched.source.send<{ data?: string }>("Page.captureScreenshot", {
        format: "jpeg",
        quality: SCREENCAST_PARAMS.quality,
      }),
      watched.source.send<{ cssVisualViewport?: Record<string, unknown> }>("Page.getLayoutMetrics"),
    ]);
    if (watched.lastFrame || this.watched.get(watched.browserId) !== watched || !shot.data) return;
    const viewport = metrics.cssVisualViewport ?? {};
    const frame: ScreencastFrame = {
      sequence: ++watched.sequence,
      jpeg: Buffer.from(shot.data, "base64"),
      deviceWidth: num(viewport.clientWidth),
      deviceHeight: num(viewport.clientHeight),
      pageScaleFactor: num(viewport.scale, 1),
      scrollX: num(viewport.pageX),
      scrollY: num(viewport.pageY),
    };
    watched.lastFrame = frame;
    for (const slot of watched.viewers.values()) this.push(watched, slot, frame);
  }

  private leave(watched: Watched, viewerId: string): void {
    if (!watched.viewers.delete(viewerId) || watched.viewers.size > 0) return;
    if (this.watched.get(watched.browserId) !== watched) return;
    this.watched.delete(watched.browserId);
    watched.off();
    if (watched.ackTimer) clearTimeout(watched.ackTimer);
    watched.source.send("Page.stopScreencast").catch((error) => this.onError(error));
  }
}
```

Run the test. Expected: 10 passed.

- [ ] **Step 3: Give the service a hub**

In `cdp-browser-service.ts`:

```ts
// import
import { ScreencastHub } from "./screencast-hub.js";

// field, after attachListeners
  readonly screencast: ScreencastHub;

// at the end of the constructor
    this.screencast = new ScreencastHub({
      source: async (browserId) => (await this.attachedTab(browserId))?.connection ?? null,
      onError: (error) => this.logger.debug({ err: error }, "Screencast error"),
    });
    // A tab that reconnects after a timed-out command has a new socket; its viewers follow it.
    this.onAttached((browserId) => {
      this.screencast.rebind(browserId).catch((error) => this.logger.debug({ err: error }, "Screencast rebind failed"));
    });

// in announceClosed, before this.broker.releaseBrowser
    this.screencast.drop(entry.browserId);
```

Add to `cdp-browser-service.test.ts`:

```ts
test("a viewer's frames come from the tab's socket and stop when the tab closes", async () => {
  await started();
  const tab = await newTab();
  const targetId = [...chromium.targets.keys()][0];
  const frames: number[] = [];
  await service.screencast.watch(tab.browserId, {
    id: "v",
    deliver: async (frame) => void frames.push(frame.sequence),
  });
  expect(chromium.commands.some((command) => command.method === "Page.startScreencast")).toBe(true);
  chromium.emit(targetId, "Page.screencastFrame", {
    data: Buffer.from([0xff, 0xd8]).toString("base64"),
    sessionId: 1,
    metadata: {
      deviceWidth: 800,
      deviceHeight: 600,
      pageScaleFactor: 1,
      scrollOffsetX: 0,
      scrollOffsetY: 0,
    },
  });
  await until(() => frames.length > 0, "a frame");
  await service.closeTab(tab.browserId);
  expect(service.screencast.viewerCount(tab.browserId)).toBe(0);
});
```

Run both test files in one process. Expected: all pass.

- [ ] **Step 4: Verify and commit**

Message: `feat(fork): screencast hub with fan-out, backpressure and a 10 fps cap`

## Task 12: Server RPC handlers, subscriptions and the feature flag

**Files:**

- Create: `packages/server/src/server/browser-tools/cdp/view-input.ts`
- Create: `packages/server/src/server/browser-tools/cdp/view-session.ts`
- Test: `packages/server/src/server/browser-tools/cdp/view-input.test.ts`
- Test: `packages/server/src/server/browser-tools/cdp/view-session.test.ts`
- Modify: `packages/server/src/server/session.ts` (constructor near line 955, `dispatchSubscriptionMessage` near line 2600)
- Modify: `packages/server/src/server/websocket-server.ts` (`buildServerInfoStatusPayload` features near line 2062)

**Interfaces:**

- Consumes: `CdpBrowserService` (`connected`, `workspaceOf`, `attachedTab`, `setViewport`, `viewportOwner`, `openTab`, `closeTab`, `listTabs`, `subscribe`, `screencast`); `SessionDelivery.begin`, `SessionDelivery.isModern`, `SessionDelivery.currentSource`; `encodeBrowserViewFrame`; the Task 10 message types; `virtualKeyCode` (Task 6).
- Produces:
  - `dispatchViewInput(send: (method: string, params: Record<string, unknown>) => Promise<unknown>, input: CdpBrowserViewInput): Promise<void>`
  - `class CdpViewSession` with `constructor(service: () => CdpBrowserService | null, logger: Pick<Logger, "debug">)`, and `subscribeTabs(msg, ownership, emit)`, `subscribeView(msg, ownership, emit)`, `input(msg)`, `navigate(msg, emit)`, `openTab(msg, emit)`, `closeTab(msg, emit)`; each takes the matching inbound message and returns `Promise<void>` (`input` returns `void`).
  - `server_info.features.cdpBrowser === true` exactly when the daemon has a CDP URL configured.

- [ ] **Step 1: Write the failing input test**

```ts
// packages/server/src/server/browser-tools/cdp/view-input.test.ts
import { describe, expect, test } from "vitest";
import { dispatchViewInput } from "./view-input.js";

async function sent(input: Parameters<typeof dispatchViewInput>[1]) {
  const calls: Array<[string, Record<string, unknown>]> = [];
  await dispatchViewInput(async (method, params) => void calls.push([method, params]), input);
  return calls;
}

describe("dispatchViewInput", () => {
  test("mouse", async () => {
    expect(
      await sent({
        kind: "mouse",
        type: "down",
        x: 10.5,
        y: 20,
        button: "left",
        buttons: 1,
        clickCount: 2,
        modifiers: 8,
      }),
    ).toEqual([
      [
        "Input.dispatchMouseEvent",
        {
          type: "mousePressed",
          x: 10.5,
          y: 20,
          button: "left",
          buttons: 1,
          clickCount: 2,
          modifiers: 8,
        },
      ],
    ]);
    expect(
      (
        await sent({
          kind: "mouse",
          type: "move",
          x: 1,
          y: 2,
          button: "none",
          buttons: 0,
          clickCount: 0,
          modifiers: 0,
        })
      )[0][1].type,
    ).toBe("mouseMoved");
    expect(
      (
        await sent({
          kind: "mouse",
          type: "up",
          x: 1,
          y: 2,
          button: "left",
          buttons: 0,
          clickCount: 1,
          modifiers: 0,
        })
      )[0][1].type,
    ).toBe("mouseReleased");
  });

  test("wheel", async () => {
    expect(await sent({ kind: "wheel", x: 5, y: 6, deltaX: 0, deltaY: 120, modifiers: 0 })).toEqual(
      [
        [
          "Input.dispatchMouseEvent",
          { type: "mouseWheel", x: 5, y: 6, deltaX: 0, deltaY: 120, modifiers: 0 },
        ],
      ],
    );
  });

  test("a key with text is a key down that types; one without is a raw key down", async () => {
    expect(
      await sent({ kind: "key", type: "down", key: "a", code: "KeyA", text: "a", modifiers: 0 }),
    ).toEqual([
      [
        "Input.dispatchKeyEvent",
        {
          type: "keyDown",
          key: "a",
          code: "KeyA",
          windowsVirtualKeyCode: 65,
          text: "a",
          modifiers: 0,
        },
      ],
    ]);
    expect(
      await sent({ kind: "key", type: "down", key: "ArrowDown", code: "ArrowDown", modifiers: 2 }),
    ).toEqual([
      [
        "Input.dispatchKeyEvent",
        {
          type: "rawKeyDown",
          key: "ArrowDown",
          code: "ArrowDown",
          windowsVirtualKeyCode: 40,
          modifiers: 2,
        },
      ],
    ]);
    expect(await sent({ kind: "key", type: "up", key: "a", code: "KeyA", modifiers: 0 })).toEqual([
      [
        "Input.dispatchKeyEvent",
        { type: "keyUp", key: "a", code: "KeyA", windowsVirtualKeyCode: 65, modifiers: 0 },
      ],
    ]);
  });

  test("Enter gets its carriage return even when the client sent no text", async () => {
    expect(
      (await sent({ kind: "key", type: "down", key: "Enter", code: "Enter", modifiers: 0 }))[0][1],
    ).toMatchObject({
      type: "keyDown",
      text: "\r",
      windowsVirtualKeyCode: 13,
    });
  });

  test("text is inserted", async () => {
    expect(await sent({ kind: "text", text: "héllo" })).toEqual([
      ["Input.insertText", { text: "héllo" }],
    ]);
  });
});
```

Run it. Expected: FAIL, cannot resolve `./view-input.js`.

- [ ] **Step 2: Implement `view-input.ts`**

```ts
// packages/server/src/server/browser-tools/cdp/view-input.ts
import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { keyDefinition } from "./cdp-keys.js";

const MOUSE_TYPES = { move: "mouseMoved", down: "mousePressed", up: "mouseReleased" } as const;

export async function dispatchViewInput(
  send: (method: string, params: Record<string, unknown>) => Promise<unknown>,
  input: CdpBrowserViewInput,
): Promise<void> {
  switch (input.kind) {
    case "mouse":
      await send("Input.dispatchMouseEvent", {
        type: MOUSE_TYPES[input.type],
        x: input.x,
        y: input.y,
        button: input.button,
        buttons: input.buttons,
        clickCount: input.clickCount,
        modifiers: input.modifiers,
      });
      return;
    case "wheel":
      await send("Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: input.x,
        y: input.y,
        deltaX: input.deltaX,
        deltaY: input.deltaY,
        modifiers: input.modifiers,
      });
      return;
    case "key": {
      const definition = keyDefinition(input.key);
      const base = { key: input.key, code: input.code, windowsVirtualKeyCode: definition.vk };
      if (input.type === "up") {
        await send("Input.dispatchKeyEvent", {
          type: "keyUp",
          ...base,
          modifiers: input.modifiers,
        });
        return;
      }
      const text = input.text ?? definition.text;
      await send("Input.dispatchKeyEvent", {
        type: text ? "keyDown" : "rawKeyDown",
        ...base,
        ...(text ? { text } : {}),
        modifiers: input.modifiers,
      });
      return;
    }
    case "text":
      await send("Input.insertText", { text: input.text });
      return;
  }
}
```

Run the test. Expected: 5 passed.

- [ ] **Step 3: Write the failing session test**

The test drives `CdpViewSession` with a real `CdpBrowserService` on the fake Chromium and a real `SessionDelivery`, so ownership and release behave as in a session.

```ts
// packages/server/src/server/browser-tools/cdp/view-session.test.ts
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { decodeBrowserViewFrame } from "@getpaseo/protocol/binary-frames/index";
import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import { SessionDelivery } from "../../session/owned-subscriptions/index.js";
import { BrowserToolsBroker } from "../broker.js";
import { CdpBrowserService } from "./cdp-browser-service.js";
import { CdpEndpoint } from "./cdp-endpoint.js";
import { CdpTabRegistry } from "./tab-registry.js";
import { startFakeChromium, type FakeChromium } from "./test-utils/fake-chromium.js";
import { CdpViewSession } from "./view-session.js";

const logger = { debug: () => {}, warn: () => {}, error: () => {} };

async function until(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("CdpViewSession", () => {
  let chromium: FakeChromium;
  let dir: string;
  let service: CdpBrowserService;
  let session: CdpViewSession;
  let delivery: SessionDelivery;
  let socket: object;
  let json: SessionOutboundMessage[];
  let binary: Uint8Array[];

  const emit = (message: SessionOutboundMessage) => void json.push(message);
  /** Runs a handler inside a request context, as Session does for an inbound message. */
  const request = <T extends SessionInboundMessage>(
    message: T,
    run: (message: T) => Promise<void> | void,
  ) =>
    delivery.request(socket, message, async () => {
      await run(message);
    });
  const last = <T extends SessionOutboundMessage["type"]>(type: T) =>
    json
      .filter(
        (message): message is Extract<SessionOutboundMessage, { type: T }> => message.type === type,
      )
      .at(-1);
  const sentTo = (targetId: string, method: string) =>
    chromium.commands
      .filter((command) => command.targetId === targetId && command.method === method)
      .map((command) => command.params);

  beforeEach(async () => {
    chromium = await startFakeChromium();
    dir = await mkdtemp(path.join(os.tmpdir(), "paseo-cdp-view-"));
    service = new CdpBrowserService({
      endpoint: new CdpEndpoint({ url: chromium.url, commandTimeoutMs: 300 }),
      registry: new CdpTabRegistry(path.join(dir, "cdp-tabs.json")),
      broker: new BrowserToolsBroker({}),
      logger,
    });
    service.start();
    await until(() => service.connected, "the CDP host");
    json = [];
    binary = [];
    socket = {};
    delivery = new SessionDelivery(
      (_source, message) => void json.push(message),
      (_source, frame) => void binary.push(frame),
    );
    delivery.attach(socket, true);
    session = new CdpViewSession(() => service, logger);
  });
  afterEach(async () => {
    await delivery.detach(socket);
    await service.stop();
    await chromium.close();
    await rm(dir, { recursive: true, force: true });
  });

  const openTab = async (workspaceId = "ws-a") => {
    await request(
      {
        type: "browser.cdp.tab.open.request",
        requestId: `open-${json.length}`,
        workspaceId,
        url: "https://example.com/",
      },
      (message) => session.openTab(message, emit),
    );
    const tab = last("browser.cdp.tab.open.response")?.payload.tab;
    if (!tab) throw new Error("open failed");
    return tab;
  };
  const subscribeView = async (browserId: string) => {
    await request(
      {
        type: "browser.cdp.view.subscribe.request",
        requestId: "view-1",
        browserId,
        width: 390,
        height: 700,
        deviceScaleFactor: 3,
      },
      (message) => session.subscribeView(message, delivery, emit),
    );
    return last("browser.cdp.view.subscribe.response")!.payload;
  };

  test("tab.open answers with the tab; tab.close closes it", async () => {
    const tab = await openTab();
    expect(tab).toMatchObject({ workspaceId: "ws-a", url: "https://example.com/" });
    await request(
      { type: "browser.cdp.tab.close.request", requestId: "close-1", browserId: tab.browserId },
      (message) => session.closeTab(message, emit),
    );
    expect(last("browser.cdp.tab.close.response")?.payload).toEqual({
      requestId: "close-1",
      error: null,
    });
    expect(service.listTabs()).toEqual([]);
    await request(
      { type: "browser.cdp.tab.close.request", requestId: "close-2", browserId: tab.browserId },
      (message) => session.closeTab(message, emit),
    );
    expect(last("browser.cdp.tab.close.response")?.payload.error).toBe("browser_tab_not_found");
  });

  test("tabs.subscribe answers with this workspace's tabs, then sends its events", async () => {
    const mine = await openTab("ws-a");
    await openTab("ws-b");
    await request(
      { type: "browser.cdp.tabs.subscribe.request", requestId: "tabs-1", workspaceId: "ws-a" },
      (message) => session.subscribeTabs(message, delivery, emit),
    );
    const snapshot = last("browser.cdp.tabs.subscribe.response")!.payload;
    expect(snapshot.connected).toBe(true);
    expect(snapshot.tabs.map((tab) => tab.browserId)).toEqual([mine.browserId]);

    json.length = 0;
    const other = await openTab("ws-b");
    const added = await openTab("ws-a");
    await service.closeTab(other.browserId);
    const events = json
      .filter((message) => message.type === "browser.cdp.tabs.update")
      .map((message) => (message.type === "browser.cdp.tabs.update" ? message.payload : null));
    expect(events.every((payload) => payload?.subscriptionId === snapshot.subscriptionId)).toBe(
      true,
    );
    expect(
      events
        .filter((payload) => payload?.event.kind === "opened")
        .map((payload) => payload?.event.kind === "opened" && payload.event.tab.browserId),
    ).toEqual([added.browserId]);
    expect(events.some((payload) => payload?.event.kind === "closed")).toBe(false);
  });

  test("view.subscribe claims the viewport, answers, then streams frames to the subscription", async () => {
    const tab = await openTab();
    const targetId = [...chromium.targets.keys()][0];
    const response = await subscribeView(tab.browserId);
    expect(response.error).toBeNull();
    expect(sentTo(targetId, "Emulation.setDeviceMetricsOverride").at(-1)).toEqual({
      width: 390,
      height: 700,
      deviceScaleFactor: 2,
      mobile: false,
    });
    await until(() => sentTo(targetId, "Page.startScreencast").length === 1, "the screencast");
    chromium.emit(targetId, "Page.screencastFrame", {
      data: Buffer.from([0xff, 0xd8, 9]).toString("base64"),
      sessionId: 1,
      metadata: {
        deviceWidth: 390,
        deviceHeight: 700,
        pageScaleFactor: 1,
        scrollOffsetX: 0,
        scrollOffsetY: 12,
      },
    });
    await until(() => binary.length > 0, "a frame");
    const frame = decodeBrowserViewFrame(binary[0]);
    expect(frame).toMatchObject({
      subscriptionId: response.subscriptionId,
      deviceWidth: 390,
      deviceHeight: 700,
      scrollY: 12,
    });
    expect([...frame!.jpeg]).toEqual([0xff, 0xd8, 9]);
    // The response left before any frame, so the client can route the first one.
    expect(json.at(-1)?.type).toBe("browser.cdp.view.subscribe.response");
  });

  test("view.subscribe on an unknown tab answers browser_tab_not_found", async () => {
    const response = await subscribeView("99999999-9999-4999-8999-999999999999");
    expect(response).toEqual({
      requestId: "view-1",
      subscriptionId: "",
      error: "browser_tab_not_found",
    });
  });

  test("input reaches the page and claims the viewport for the sender", async () => {
    const tab = await openTab();
    const targetId = [...chromium.targets.keys()][0];
    const { subscriptionId } = await subscribeView(tab.browserId);
    session.input({
      type: "browser.cdp.view.input.request",
      subscriptionId,
      input: {
        kind: "mouse",
        type: "down",
        x: 5,
        y: 6,
        button: "left",
        buttons: 1,
        clickCount: 1,
        modifiers: 0,
      },
      viewport: { width: 1200, height: 800, deviceScaleFactor: 1 },
    });
    await until(() => sentTo(targetId, "Input.dispatchMouseEvent").length === 1, "the mouse event");
    expect(sentTo(targetId, "Input.dispatchMouseEvent")[0]).toMatchObject({
      type: "mousePressed",
      x: 5,
      y: 6,
    });
    expect(sentTo(targetId, "Emulation.setDeviceMetricsOverride").at(-1)).toMatchObject({
      width: 1200,
      height: 800,
    });
  });

  test("input for a subscription this session does not own is ignored", async () => {
    await openTab();
    const targetId = [...chromium.targets.keys()][0];
    session.input({
      type: "browser.cdp.view.input.request",
      subscriptionId: "someone-else",
      input: { kind: "text", text: "x" },
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sentTo(targetId, "Input.insertText")).toEqual([]);
  });

  test("an input that times out tells the view the page is not responding", async () => {
    const tab = await openTab();
    const { subscriptionId } = await subscribeView(tab.browserId);
    chromium.stall("Input.insertText");
    session.input({
      type: "browser.cdp.view.input.request",
      subscriptionId,
      input: { kind: "text", text: "x" },
    });
    await until(() => last("browser.cdp.view.update") !== undefined, "the view update");
    expect(last("browser.cdp.view.update")?.payload).toEqual({
      subscriptionId,
      error: "browser_timeout",
    });
  });

  test("a closed tab tells its view", async () => {
    const tab = await openTab();
    const { subscriptionId } = await subscribeView(tab.browserId);
    await service.closeTab(tab.browserId);
    expect(last("browser.cdp.view.update")?.payload).toEqual({
      subscriptionId,
      error: "browser_tab_not_found",
    });
  });

  test("navigate sends the URL, refuses other schemes, and maps back, forward and reload", async () => {
    const tab = await openTab();
    const targetId = [...chromium.targets.keys()][0];
    const navigate = (
      requestId: string,
      action: Extract<
        SessionInboundMessage,
        { type: "browser.cdp.view.navigate.request" }
      >["action"],
    ) =>
      request(
        { type: "browser.cdp.view.navigate.request", requestId, browserId: tab.browserId, action },
        (message) => session.navigate(message, emit),
      );
    await navigate("n1", { kind: "url", url: "https://example.org/" });
    expect(last("browser.cdp.view.navigate.response")?.payload).toEqual({
      requestId: "n1",
      error: null,
    });
    expect(sentTo(targetId, "Page.navigate")).toEqual([{ url: "https://example.org/" }]);
    await navigate("n2", { kind: "url", url: "javascript:alert(1)" });
    expect(last("browser.cdp.view.navigate.response")?.payload.error).toBe("browser_unknown_error");
    expect(sentTo(targetId, "Page.navigate")).toHaveLength(1);
    await navigate("n3", { kind: "reload" });
    await until(() => sentTo(targetId, "Page.reload").length === 1, "the reload");
  });

  test("releasing the view stops the screencast", async () => {
    const tab = await openTab();
    const targetId = [...chromium.targets.keys()][0];
    const { subscriptionId } = await subscribeView(tab.browserId);
    await until(() => service.screencast.viewerCount(tab.browserId) === 1, "the viewer");
    // release() finds the subscription through the current request's source.
    await request(
      { type: "subscription.release.request", requestId: "release-1", subscriptionId },
      () => delivery.release(subscriptionId),
    );
    expect(service.screencast.viewerCount(tab.browserId)).toBe(0);
    await until(() => sentTo(targetId, "Page.stopScreencast").length === 1, "the stop");
  });

  test("with no service every request answers browser_unsupported", async () => {
    const off = new CdpViewSession(() => null, logger);
    await request(
      { type: "browser.cdp.tab.open.request", requestId: "o", workspaceId: "ws-a" },
      (message) => off.openTab(message, emit),
    );
    expect(last("browser.cdp.tab.open.response")?.payload).toEqual({
      requestId: "o",
      tab: null,
      error: "browser_unsupported",
    });
  });
});
```

`delivery.request(socket, message, run)` is how `Session` gives a handler its request context (`owned-subscriptions/index.ts:206`); `begin` and `release` both read that context.

Run it. Expected: FAIL, cannot resolve `./view-session.js`.

- [ ] **Step 4: Implement `CdpViewSession`**

```ts
// packages/server/src/server/browser-tools/cdp/view-session.ts
import type { Logger } from "pino";
import { encodeBrowserViewFrame } from "@getpaseo/protocol/binary-frames/index";
import type { SessionInboundMessage, SessionOutboundMessage } from "@getpaseo/protocol/messages";
import type { SessionDelivery } from "../../session/owned-subscriptions/index.js";
import type { CdpBrowserService } from "./cdp-browser-service.js";
import { CdpClosedError, CdpTimeoutError } from "./cdp-connection.js";
import { CdpUnreachableError } from "./cdp-endpoint.js";
import { dispatchViewInput } from "./view-input.js";

type Inbound<T extends SessionInboundMessage["type"]> = Extract<SessionInboundMessage, { type: T }>;
type Emit = (message: SessionOutboundMessage) => void;

interface View {
  browserId: string;
  viewerId: string;
  chain: Promise<void>;
  notify(error: string): void;
}

function errorCode(error: unknown): string {
  if (error instanceof CdpTimeoutError) return "browser_timeout";
  if (error instanceof CdpUnreachableError || error instanceof CdpClosedError)
    return "browser_no_host";
  if (error instanceof Error && error.message === "browser_tab_not_found")
    return "browser_tab_not_found";
  return "browser_unknown_error";
}

function isHttpUrl(url: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

/** One session's browser.cdp.* handlers. The service and its hub are shared by every session. */
export class CdpViewSession {
  private readonly views = new Map<string, View>();

  constructor(
    private readonly service: () => CdpBrowserService | null,
    private readonly logger: Pick<Logger, "debug">,
  ) {}

  async openTab(msg: Inbound<"browser.cdp.tab.open.request">, emit: Emit): Promise<void> {
    const respond = (
      tab: Awaited<ReturnType<CdpBrowserService["openTab"]>> | null,
      error: string | null,
    ) =>
      emit({
        type: "browser.cdp.tab.open.response",
        payload: { requestId: msg.requestId, tab, error },
      });
    const service = this.service();
    if (!service) return respond(null, "browser_unsupported");
    try {
      respond(await service.openTab({ workspaceId: msg.workspaceId, url: msg.url }), null);
    } catch (error) {
      this.logger.debug({ err: error }, "browser.cdp.tab.open failed");
      respond(null, errorCode(error));
    }
  }

  async closeTab(msg: Inbound<"browser.cdp.tab.close.request">, emit: Emit): Promise<void> {
    const respond = (error: string | null) =>
      emit({
        type: "browser.cdp.tab.close.response",
        payload: { requestId: msg.requestId, error },
      });
    const service = this.service();
    if (!service) return respond("browser_unsupported");
    try {
      respond((await service.closeTab(msg.browserId)) ? null : "browser_tab_not_found");
    } catch (error) {
      respond(errorCode(error));
    }
  }

  async subscribeTabs(
    msg: Inbound<"browser.cdp.tabs.subscribe.request">,
    ownership: SessionDelivery,
    emit: Emit,
  ): Promise<void> {
    const service = this.service();
    if (!service || !ownership.isModern(ownership.currentSource)) {
      emit({
        type: "browser.cdp.tabs.subscribe.response",
        payload: {
          requestId: msg.requestId,
          subscriptionId: "",
          connected: false,
          tabs: [],
          error: "browser_unsupported",
        },
      });
      return;
    }
    const inScope = (workspaceId: string) => !msg.workspaceId || msg.workspaceId === workspaceId;
    let unsubscribe: (() => void) | undefined;
    const owner = ownership.begin("cdp-tabs", undefined, () => unsubscribe?.());
    // Snapshot and listener in one synchronous turn, so no event falls between them.
    emit({
      type: "browser.cdp.tabs.subscribe.response",
      payload: {
        requestId: msg.requestId,
        subscriptionId: owner.responseId,
        connected: service.connected,
        tabs: service.listTabs().filter((tab) => inScope(tab.workspaceId)),
        error: null,
      },
    });
    unsubscribe = service.subscribe((event) => {
      if (owner.signal.aborted) return;
      if (event.kind === "closed" && !inScope(event.workspaceId)) return;
      if ((event.kind === "opened" || event.kind === "state") && !inScope(event.tab.workspaceId))
        return;
      owner.emit({
        type: "browser.cdp.tabs.update",
        payload: { subscriptionId: owner.responseId, event },
      });
    });
  }

  async subscribeView(
    msg: Inbound<"browser.cdp.view.subscribe.request">,
    ownership: SessionDelivery,
    emit: Emit,
  ): Promise<void> {
    const reject = (error: string) =>
      emit({
        type: "browser.cdp.view.subscribe.response",
        payload: { requestId: msg.requestId, subscriptionId: "", error },
      });
    const service = this.service();
    if (!service || !ownership.isModern(ownership.currentSource))
      return reject("browser_unsupported");
    if (!service.connected) {
      // The pane's Retry is a new subscribe; it should not wait out the reconnect backoff.
      service.retryNow();
      return reject("browser_no_host");
    }
    if (!service.workspaceOf(msg.browserId) || !(await service.attachedTab(msg.browserId))) {
      return reject("browser_tab_not_found");
    }

    let unwatch: (() => void) | undefined;
    let offEvents: (() => void) | undefined;
    const owner = ownership.begin("cdp-view", undefined, () => {
      this.views.delete(owner.responseId);
      offEvents?.();
      unwatch?.();
    });
    const notify = (error: string) => {
      if (owner.signal.aborted) return;
      owner.emit({
        type: "browser.cdp.view.update",
        payload: { subscriptionId: owner.responseId, error },
      });
    };
    this.views.set(owner.responseId, {
      browserId: msg.browserId,
      viewerId: owner.id,
      chain: Promise.resolve(),
      notify,
    });
    offEvents = service.subscribe((event) => {
      if (event.kind === "closed" && event.browserId === msg.browserId)
        notify("browser_tab_not_found");
      if (event.kind === "host" && !event.connected) notify("browser_no_host");
    });
    // The response goes first: a client can route a frame only once it knows the subscription id.
    emit({
      type: "browser.cdp.view.subscribe.response",
      payload: { requestId: msg.requestId, subscriptionId: owner.responseId, error: null },
    });
    try {
      // A new viewer takes the size only when nobody has set one; after that, input claims it.
      if (service.viewportOwner(msg.browserId) === null) {
        await service.setViewport(
          msg.browserId,
          { width: msg.width, height: msg.height, deviceScaleFactor: msg.deviceScaleFactor },
          owner.id,
        );
      }
      const stop = await service.screencast.watch(msg.browserId, {
        id: owner.id,
        deliver: (frame) =>
          owner.emitBinaryAndWait(
            encodeBrowserViewFrame({ subscriptionId: owner.responseId, ...frame }),
          ),
      });
      if (owner.signal.aborted) stop();
      else unwatch = stop;
    } catch (error) {
      this.logger.debug({ err: error }, "browser.cdp.view.subscribe failed after its response");
      notify(errorCode(error));
    }
  }

  input(msg: Inbound<"browser.cdp.view.input.request">): void {
    const view = this.views.get(msg.subscriptionId);
    const service = this.service();
    if (!view || !service) return;
    // One chain per view keeps a press before its release. Every failure ends in notify, never a rejection.
    view.chain = view.chain
      .then(async () => {
        if (msg.viewport) await service.setViewport(view.browserId, msg.viewport, view.viewerId);
        const tab = await service.attachedTab(view.browserId);
        if (!tab) return;
        await dispatchViewInput((method, params) => tab.connection.send(method, params), msg.input);
      })
      .catch((error) => {
        this.logger.debug({ err: error }, "browser.cdp.view.input failed");
        view.notify(errorCode(error));
      });
  }

  async navigate(msg: Inbound<"browser.cdp.view.navigate.request">, emit: Emit): Promise<void> {
    const respond = (error: string | null) =>
      emit({
        type: "browser.cdp.view.navigate.response",
        payload: { requestId: msg.requestId, error },
      });
    const service = this.service();
    if (!service) return respond("browser_unsupported");
    try {
      const tab = await service.attachedTab(msg.browserId);
      if (!tab) return respond("browser_tab_not_found");
      const { action } = msg;
      if (action.kind === "url") {
        if (!isHttpUrl(action.url)) return respond("browser_unknown_error");
        // Not tab.loadURL: that waits for the load event, and the toolbar should not wait for it.
        const result = await tab.connection.send<{ errorText?: string }>("Page.navigate", {
          url: action.url,
        });
        return respond(result.errorText ? "browser_unknown_error" : null);
      }
      if (action.kind === "back") tab.goBack();
      else if (action.kind === "forward") tab.goForward();
      else tab.reload();
      respond(null);
    } catch (error) {
      respond(errorCode(error));
    }
  }
}
```

Run the session test. Expected: 11 passed.

- [ ] **Step 5: Dispatch the messages from `Session`**

In `session.ts`:

```ts
// import
import { CdpViewSession } from "./browser-tools/cdp/view-session.js";

// field, next to `private readonly browserToolsBroker`
  private readonly cdpView: CdpViewSession;

// constructor, right after `this.browserToolsBroker = options.browserToolsBroker;`
    this.cdpView = new CdpViewSession(
      () => this.browserToolsBroker?.cdpBrowser ?? null,
      this.sessionLogger,
    );
```

In `dispatchSubscriptionMessage`, replace the final `return undefined;` with `return this.dispatchCdpBrowserMessage(msg);` and add the method below it:

```ts
  // Fork delta (web browser pane): the daemon-hosted Docker Chromium.
  private dispatchCdpBrowserMessage(msg: SessionInboundMessage): Promise<void> | undefined {
    const emit = (reply: SessionOutboundMessage) => this.emit(reply);
    switch (msg.type) {
      case "browser.cdp.tabs.subscribe.request":
        return this.cdpView.subscribeTabs(msg, this.delivery, emit);
      case "browser.cdp.view.subscribe.request":
        return this.cdpView.subscribeView(msg, this.delivery, emit);
      case "browser.cdp.view.input.request":
        this.cdpView.input(msg);
        return Promise.resolve();
      case "browser.cdp.view.navigate.request":
        return this.cdpView.navigate(msg, emit);
      case "browser.cdp.tab.open.request":
        return this.cdpView.openTab(msg, emit);
      case "browser.cdp.tab.close.request":
        return this.cdpView.closeTab(msg, emit);
      default:
        return undefined;
    }
  }
```

`SessionOutboundMessage` is already imported in `session.ts`; if `this.sessionLogger` is assigned after `this.browserToolsBroker` in the constructor, move the `this.cdpView = ...` line to just after the logger assignment.

- [ ] **Step 6: Advertise the feature**

In `websocket-server.ts`, `buildServerInfoStatusPayload`, inside `features` after `agentRuntimeClose: true,`:

```ts
        // Fork delta (web browser pane). True when PASEO_BROWSER_CDP_URL is set, reachable or not:
        // the pane shows "unreachable" with Retry, which is more use than no pane.
        // COMPAT(cdpBrowser): added in v0.15.5, remove gate after 2027-05-10.
        ...(this.browserToolsBroker?.cdpBrowser ? { cdpBrowser: true } : {}),
```

- [ ] **Step 7: Run the task's tests, typecheck, commit**

```bash
cd /workspace/utils/paseo/packages/server
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools/cdp/view-input.test.ts src/server/browser-tools/cdp/view-session.test.ts \
  --no-file-parallelism --maxWorkers=1 --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded -p tsconfig.server.typecheck.json
```

Expected: 5 + 11 passed; typecheck exits 0. Lint, format, commit.

Message: `feat(fork): browser.cdp RPC handlers and the cdpBrowser feature`

## Task 13: Client methods

**Files:**

- Modify: `packages/client/src/daemon-client.ts` (`observe` near line 2824, methods next to `registerBrowserHost` near line 2885, `tryHandleBinaryFrame` near line 7646)
- Modify: `packages/client/src/daemon-client.test.ts`

**Interfaces:**

- Consumes: the Task 10 schemas and frame codec; the client's private `observe`, `sendNamespacedCorrelatedSessionRequest`, `sendSessionMessage`, `owned.receiveBinary`.
- Produces, on `DaemonClient`:
  - `openCdpBrowserTab(input: { workspaceId: string; url?: string }): Promise<CdpBrowserTabState>`
  - `closeCdpBrowserTab(browserId: string): Promise<void>`
  - `observeCdpBrowserTabs(input?: { workspaceId?: string }, options?: { signal?: AbortSignal }): OwnedSubscription<CorrelatedResponsePayload<"browser.cdp.tabs.subscribe.response">>`
  - `observeCdpBrowserView(input: { browserId: string; width: number; height: number; deviceScaleFactor: number }, options?: { signal?: AbortSignal }): OwnedSubscription<CorrelatedResponsePayload<"browser.cdp.view.subscribe.response">>`. Its observer's `binary(bytes)` receives the whole frame; decode with `decodeBrowserViewFrame`.
  - `sendCdpBrowserViewInput(subscriptionId: string, input: CdpBrowserViewInput, viewport?: CdpBrowserViewport): void`
  - `navigateCdpBrowserView(browserId: string, action: CdpBrowserNavigateAction): Promise<void>`
  - Each throws `Error("This host has no Docker browser.")` when `features.cdpBrowser` is not true. The RPC methods reject with `Error(<code>)` where `<code>` is the response's `error`.

- [ ] **Step 1: Write the failing tests**

Append to `daemon-client.test.ts`. `createMockLogger`, `createMockTransport`, `parseSentFrame`, `wrapSessionMessage` and `clients` are the file's existing helpers (see the `closeAgentRuntime` tests).

```ts
const CDP_TAB = {
  browserId: "11111111-1111-4111-8111-111111111111",
  workspaceId: "ws-a",
  url: "https://example.com/",
  title: "Example",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  agentActiveUntil: null,
};

async function connectCdpClient(features: Record<string, boolean>) {
  const mock = createMockTransport();
  const client = new DaemonClient({
    url: "ws://test",
    clientId: "clsk_unit_test",
    logger: createMockLogger(),
    reconnect: { enabled: false },
    transportFactory: () => mock.transport,
  });
  clients.push(client);
  const connectPromise = client.connect();
  mock.triggerOpen({ features });
  await connectPromise;
  return { client, mock };
}

test("openCdpBrowserTab sends browser.cdp.tab.open and resolves with the tab", async () => {
  const { client, mock } = await connectCdpClient({ ownedSubscriptions: true, cdpBrowser: true });
  const promise = client.openCdpBrowserTab({ workspaceId: "ws-a", url: "https://example.com/" });
  const request = parseSentFrame(mock.sent[0]);
  expect(request).toMatchObject({
    type: "browser.cdp.tab.open.request",
    workspaceId: "ws-a",
    url: "https://example.com/",
  });
  mock.triggerMessage(
    wrapSessionMessage({
      type: "browser.cdp.tab.open.response",
      payload: { requestId: request.requestId, tab: CDP_TAB, error: null },
    }),
  );
  await expect(promise).resolves.toEqual(CDP_TAB);
});

test("openCdpBrowserTab rejects with the daemon's error code", async () => {
  const { client, mock } = await connectCdpClient({ ownedSubscriptions: true, cdpBrowser: true });
  const promise = client.openCdpBrowserTab({ workspaceId: "ws-a" });
  const request = parseSentFrame(mock.sent[0]);
  mock.triggerMessage(
    wrapSessionMessage({
      type: "browser.cdp.tab.open.response",
      payload: { requestId: request.requestId, tab: null, error: "browser_no_host" },
    }),
  );
  await expect(promise).rejects.toThrow("browser_no_host");
});

test("the Cdp browser methods refuse a host without the feature", async () => {
  const { client, mock } = await connectCdpClient({ ownedSubscriptions: true });
  await expect(client.openCdpBrowserTab({ workspaceId: "ws-a" })).rejects.toThrow(
    "This host has no Docker browser.",
  );
  await expect(client.closeCdpBrowserTab(CDP_TAB.browserId)).rejects.toThrow(
    "This host has no Docker browser.",
  );
  expect(() => client.sendCdpBrowserViewInput("s1", { kind: "text", text: "x" })).toThrow(
    "This host has no Docker browser.",
  );
  expect(mock.sent).toHaveLength(0);
});

test("sendCdpBrowserViewInput sends one message and waits for nothing", async () => {
  const { client, mock } = await connectCdpClient({ ownedSubscriptions: true, cdpBrowser: true });
  client.sendCdpBrowserViewInput(
    "s1",
    { kind: "wheel", x: 1, y: 2, deltaX: 0, deltaY: 120, modifiers: 0 },
    { width: 390, height: 700, deviceScaleFactor: 2 },
  );
  expect(mock.sent).toHaveLength(1);
  expect(parseSentFrame(mock.sent[0])).toEqual({
    type: "browser.cdp.view.input.request",
    subscriptionId: "s1",
    input: { kind: "wheel", x: 1, y: 2, deltaX: 0, deltaY: 120, modifiers: 0 },
    viewport: { width: 390, height: 700, deviceScaleFactor: 2 },
  });
});

test("observeCdpBrowserView routes binary frames to its observer", async () => {
  const { client, mock } = await connectCdpClient({ ownedSubscriptions: true, cdpBrowser: true });
  const view = client.observeCdpBrowserView({
    browserId: CDP_TAB.browserId,
    width: 390,
    height: 700,
    deviceScaleFactor: 2,
  });
  const frames: Array<ReturnType<typeof decodeBrowserViewFrame>> = [];
  view.subscribe({
    snapshot: () => {},
    update: () => {},
    binary: (bytes) => frames.push(decodeBrowserViewFrame(bytes)),
  });
  await vi.waitFor(() => expect(mock.sent).toHaveLength(1));
  const request = parseSentFrame(mock.sent[0]);
  expect(request).toMatchObject({
    type: "browser.cdp.view.subscribe.request",
    browserId: CDP_TAB.browserId,
    width: 390,
  });
  mock.triggerMessage(
    wrapSessionMessage({
      type: "browser.cdp.view.subscribe.response",
      payload: { requestId: request.requestId, subscriptionId: "sub-view-1", error: null },
    }),
  );
  await view.ready;
  const frame = {
    subscriptionId: "sub-view-1",
    sequence: 1,
    deviceWidth: 390,
    deviceHeight: 700,
    pageScaleFactor: 1,
    scrollX: 0,
    scrollY: 0,
    jpeg: new Uint8Array([0xff, 0xd8]),
  };
  mock.triggerMessage(encodeBrowserViewFrame(frame));
  mock.triggerMessage(
    encodeBrowserViewFrame({ ...frame, subscriptionId: "someone-else", sequence: 2 }),
  );
  expect(frames).toEqual([frame]);
  await view.release();
});
```

Add `decodeBrowserViewFrame, encodeBrowserViewFrame` to the test file's import from `@getpaseo/protocol/binary-frames/index` (add the import if the file has none), and `vi` to its vitest import if missing.

Run from `packages/client`: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/daemon-client.test.ts -t "Cdp" --bail=1`. Expected: FAIL, `openCdpBrowserTab` is not a function.

- [ ] **Step 2: Implement the methods**

In `daemon-client.ts`, import:

```ts
import {
  BROWSER_VIEW_OPCODE,
  decodeBrowserViewFrame,
} from "@getpaseo/protocol/binary-frames/index";
import type {
  CdpBrowserNavigateAction,
  CdpBrowserTabState,
  CdpBrowserViewInput,
  CdpBrowserViewport,
} from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
```

Merge the first import into the file's existing import from `@getpaseo/protocol/binary-frames/index` if there is one.

In the private `observe`, next to the two existing `if (query.type === ...)` gate lines (they run before the `try`, so a refusal does not reset the connection):

```ts
if (query.type.startsWith("browser.cdp.")) this.requireCdpBrowser();
```

After `registerBrowserHost`:

```ts
  // Fork delta (web browser pane): the daemon-hosted Docker Chromium.
  // COMPAT(cdpBrowser): added in v0.15.5, remove gate after 2027-05-10.
  private requireCdpBrowser(): void {
    if (this.getLastServerInfoMessage()?.features?.cdpBrowser !== true) {
      throw new Error("This host has no Docker browser.");
    }
  }

  async openCdpBrowserTab(input: { workspaceId: string; url?: string }): Promise<CdpBrowserTabState> {
    this.requireCdpBrowser();
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"browser.cdp.tab.open.response">({
      message: {
        type: "browser.cdp.tab.open.request",
        workspaceId: input.workspaceId,
        ...(input.url ? { url: input.url } : {}),
      },
    });
    if (!payload.tab) throw new Error(payload.error ?? "browser_unknown_error");
    return payload.tab;
  }

  async closeCdpBrowserTab(browserId: string): Promise<void> {
    this.requireCdpBrowser();
    const payload = await this.sendNamespacedCorrelatedSessionRequest<"browser.cdp.tab.close.response">({
      message: { type: "browser.cdp.tab.close.request", browserId },
    });
    if (payload.error) throw new Error(payload.error);
  }

  observeCdpBrowserTabs(
    input?: { workspaceId?: string },
    options?: { signal?: AbortSignal },
  ): OwnedSubscription<CorrelatedResponsePayload<"browser.cdp.tabs.subscribe.response">> {
    return this.observe(
      "browser.cdp.tabs.subscribe.response",
      {
        type: "browser.cdp.tabs.subscribe.request",
        ...(input?.workspaceId ? { workspaceId: input.workspaceId } : {}),
      },
      options,
    );
  }

  /** Frames reach the observer's `binary` callback as whole frames; decode with decodeBrowserViewFrame. */
  observeCdpBrowserView(
    input: { browserId: string; width: number; height: number; deviceScaleFactor: number },
    options?: { signal?: AbortSignal },
  ): OwnedSubscription<CorrelatedResponsePayload<"browser.cdp.view.subscribe.response">> {
    return this.observe(
      "browser.cdp.view.subscribe.response",
      { type: "browser.cdp.view.subscribe.request", ...input },
      options,
    );
  }

  sendCdpBrowserViewInput(
    subscriptionId: string,
    input: CdpBrowserViewInput,
    viewport?: CdpBrowserViewport,
  ): void {
    this.requireCdpBrowser();
    this.sendSessionMessage({
      type: "browser.cdp.view.input.request",
      subscriptionId,
      input,
      ...(viewport ? { viewport } : {}),
    });
  }

  async navigateCdpBrowserView(browserId: string, action: CdpBrowserNavigateAction): Promise<void> {
    this.requireCdpBrowser();
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"browser.cdp.view.navigate.response">({
        message: { type: "browser.cdp.view.navigate.request", browserId, action },
      });
    if (payload.error) throw new Error(payload.error);
  }
```

The subscribe responses carry `error: string | null`. `observe` already throws a `DaemonRpcError` when a payload's `error` is a string, so a refused subscription rejects `ready` with the code as its message and does not reset the connection.

In `tryHandleBinaryFrame`, before the `isPluginFrameOpcode` check:

```ts
if (rawBytes[0] === BROWSER_VIEW_OPCODE) {
  const frame = decodeBrowserViewFrame(rawBytes);
  this.consecutiveLivenessFailures = 0;
  // The observer gets the whole frame: its metadata sits between the id and the JPEG.
  if (frame) this.owned.receiveBinary(frame.subscriptionId, rawBytes);
  return true;
}
```

- [ ] **Step 3: Run the tests, build the client, typecheck**

```bash
cd /workspace/utils/paseo/packages/client
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/daemon-client.test.ts -t "Cdp" --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded
cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npm run build:client
```

Expected: 5 passed (the others are filtered out), typecheck exits 0, the build writes `packages/client/dist`.

- [ ] **Step 4: Verify and commit**

Message: `feat(fork): client methods for the Docker browser pane`

## Task 14: App model: geometry, tab store and layout sync

**Files:**

- Create: `packages/app/src/desktop/browser/cdp/view-model.ts`
- Create: `packages/app/src/desktop/browser/cdp/tabs-store.ts`
- Create: `packages/app/src/desktop/browser/cdp/tabs-sync.ts`
- Test: `packages/app/src/desktop/browser/cdp/view-model.test.ts`
- Test: `packages/app/src/desktop/browser/cdp/tabs-store.test.ts`

**Interfaces:**

- Consumes: `DaemonClient.observeCdpBrowserTabs`, `openCdpBrowserTab` (Task 13); `useBrowserStore`, `createBrowserRecord` (`@/desktop/browser/store`, `@/desktop/browser/store/state`); `useWorkspaceLayoutStore`, `collectAllTabs` (`@/stores/workspace-layout-store`); `buildWorkspaceTabPersistenceKey` (`@/workspace-tabs/model`).
- Produces, in `view-model.ts`:
  - `interface Size { width: number; height: number }`, `interface FrameRect extends Size { left: number; top: number }`
  - `fitFrame(container: Size, frame: Size): FrameRect`
  - `toPagePoint(local: { x: number; y: number }, displayed: Size, page: Size): { x: number; y: number }`
  - `viewportForPane(container: Size, devicePixelRatio: number): CdpBrowserViewport | null`
  - `modifierMask(event: { altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean }): number`
  - `mouseButton(button: number): "left" | "middle" | "right"`
  - `keyText(event: { key: string; ctrlKey: boolean; metaKey: boolean }): string | undefined`
  - `createThrottle(intervalMs: number, now?: () => number): () => boolean`, `HOVER_INTERVAL_MS = 33`, `TOUCH_SLOP_PX = 8`
  - `viewStatusForError(code: string): CdpViewStatus`, `type CdpViewStatus = "connecting" | "live" | "closed" | "unreachable" | "unresponsive"`
- Produces, in `tabs-store.ts`: `interface CdpHostTabs { connected: boolean; tabs: Record<string, CdpBrowserTabState> }`, `applyTabsSnapshot`, `applyTabsEvent`, `useCdpTabsStore`.
- Produces, in `tabs-sync.ts`: `ensureCdpTabInLayout(input)`, `openCdpTab(input): Promise<string>`, `reopenCdpTab(input): Promise<void>`, `useCdpTabsSync(input): void`.

- [ ] **Step 1: Write the failing geometry test**

```ts
// packages/app/src/desktop/browser/cdp/view-model.test.ts
import { describe, expect, it } from "vitest";
import {
  createThrottle,
  fitFrame,
  keyText,
  modifierMask,
  mouseButton,
  toPagePoint,
  viewportForPane,
  viewStatusForError,
} from "./view-model";

describe("fitFrame", () => {
  it("fills the pane when the aspect ratios match", () => {
    expect(fitFrame({ width: 800, height: 600 }, { width: 400, height: 300 })).toEqual({
      left: 0,
      top: 0,
      width: 800,
      height: 600,
    });
  });
  it("letterboxes a wider frame and centres it", () => {
    expect(fitFrame({ width: 800, height: 800 }, { width: 400, height: 200 })).toEqual({
      left: 0,
      top: 200,
      width: 800,
      height: 400,
    });
  });
  it("pillarboxes a taller frame", () => {
    expect(fitFrame({ width: 800, height: 400 }, { width: 200, height: 400 })).toEqual({
      left: 300,
      top: 0,
      width: 200,
      height: 400,
    });
  });
  it("is empty for an unmeasured pane or frame", () => {
    expect(fitFrame({ width: 0, height: 0 }, { width: 400, height: 300 })).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
    expect(fitFrame({ width: 800, height: 600 }, { width: 0, height: 0 })).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
  });
});

describe("toPagePoint", () => {
  it("scales a point on the displayed frame to page CSS pixels", () => {
    expect(
      toPagePoint({ x: 400, y: 100 }, { width: 800, height: 400 }, { width: 400, height: 200 }),
    ).toEqual({ x: 200, y: 50 });
  });
  it("clamps a point dragged outside the frame", () => {
    expect(
      toPagePoint({ x: -5, y: 900 }, { width: 800, height: 400 }, { width: 400, height: 200 }),
    ).toEqual({ x: 0, y: 200 });
  });
});

describe("viewportForPane", () => {
  it("rounds the size and caps the pixel ratio at 2", () => {
    expect(viewportForPane({ width: 390.4, height: 700.6 }, 3)).toEqual({
      width: 390,
      height: 701,
      deviceScaleFactor: 2,
    });
  });
  it("has no viewport until the pane is measured", () => {
    expect(viewportForPane({ width: 0, height: 0 }, 2)).toBeNull();
  });
});

describe("input helpers", () => {
  it("builds the CDP modifier mask", () => {
    expect(modifierMask({ altKey: true, ctrlKey: false, metaKey: true, shiftKey: true })).toBe(
      1 + 4 + 8,
    );
    expect(modifierMask({ altKey: false, ctrlKey: true, metaKey: false, shiftKey: false })).toBe(2);
  });
  it("names mouse buttons", () => {
    expect([mouseButton(0), mouseButton(1), mouseButton(2)]).toEqual(["left", "middle", "right"]);
  });
  it("gives text only for a printable key without a command modifier", () => {
    expect(keyText({ key: "a", ctrlKey: false, metaKey: false })).toBe("a");
    expect(keyText({ key: "a", ctrlKey: true, metaKey: false })).toBeUndefined();
    expect(keyText({ key: "Enter", ctrlKey: false, metaKey: false })).toBeUndefined();
  });
  it("throttles to one call per interval", () => {
    let now = 0;
    const allow = createThrottle(33, () => now);
    expect(allow()).toBe(true);
    now = 20;
    expect(allow()).toBe(false);
    now = 33;
    expect(allow()).toBe(true);
  });
  it("maps daemon error codes to a pane status", () => {
    expect(viewStatusForError("browser_tab_not_found")).toBe("closed");
    expect(viewStatusForError("browser_no_host")).toBe("unreachable");
    expect(viewStatusForError("browser_timeout")).toBe("unresponsive");
    expect(viewStatusForError("DaemonRpcError: browser_tab_not_found")).toBe("closed");
    expect(viewStatusForError("anything else")).toBe("unresponsive");
  });
});
```

Run from `packages/app`: `flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/desktop/browser/cdp/view-model.test.ts --bail=1`. Expected: FAIL, cannot resolve `./view-model`.

- [ ] **Step 2: Implement `view-model.ts`**

```ts
// packages/app/src/desktop/browser/cdp/view-model.ts
import type { CdpBrowserViewport } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";

export interface Size {
  width: number;
  height: number;
}
export interface FrameRect extends Size {
  left: number;
  top: number;
}

export type CdpViewStatus = "connecting" | "live" | "closed" | "unreachable" | "unresponsive";

export const HOVER_INTERVAL_MS = 33;
export const TOUCH_SLOP_PX = 8;
const MAX_DEVICE_SCALE_FACTOR = 2;

/** Where the frame is drawn in the pane: scaled to fit, centred. */
export function fitFrame(container: Size, frame: Size): FrameRect {
  if (container.width <= 0 || container.height <= 0 || frame.width <= 0 || frame.height <= 0) {
    return { left: 0, top: 0, width: 0, height: 0 };
  }
  const scale = Math.min(container.width / frame.width, container.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  return {
    left: (container.width - width) / 2,
    top: (container.height - height) / 2,
    width,
    height,
  };
}

/** A point on the displayed frame, in page CSS pixels. */
export function toPagePoint(
  local: { x: number; y: number },
  displayed: Size,
  page: Size,
): { x: number; y: number } {
  if (displayed.width <= 0 || displayed.height <= 0) return { x: 0, y: 0 };
  const clamp = (value: number, max: number) => Math.min(max, Math.max(0, value));
  return {
    x: clamp((local.x * page.width) / displayed.width, page.width),
    y: clamp((local.y * page.height) / displayed.height, page.height),
  };
}

export function viewportForPane(
  container: Size,
  devicePixelRatio: number,
): CdpBrowserViewport | null {
  if (container.width < 1 || container.height < 1) return null;
  return {
    width: Math.round(container.width),
    height: Math.round(container.height),
    deviceScaleFactor: Math.min(MAX_DEVICE_SCALE_FACTOR, Math.max(1, devicePixelRatio)),
  };
}

export function modifierMask(event: {
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}): number {
  return (
    (event.altKey ? 1 : 0) |
    (event.ctrlKey ? 2 : 0) |
    (event.metaKey ? 4 : 0) |
    (event.shiftKey ? 8 : 0)
  );
}

export function mouseButton(button: number): "left" | "middle" | "right" {
  if (button === 1) return "middle";
  if (button === 2) return "right";
  return "left";
}

export function keyText(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
}): string | undefined {
  return event.key.length === 1 && !event.ctrlKey && !event.metaKey ? event.key : undefined;
}

export function createThrottle(intervalMs: number, now: () => number = Date.now): () => boolean {
  let last = Number.NEGATIVE_INFINITY;
  return () => {
    const current = now();
    if (current - last < intervalMs) return false;
    last = current;
    return true;
  };
}

export function viewStatusForError(code: string): CdpViewStatus {
  if (code.includes("browser_tab_not_found")) return "closed";
  if (code.includes("browser_no_host") || code.includes("browser_unsupported"))
    return "unreachable";
  return "unresponsive";
}
```

Run the test. Expected: all pass.

- [ ] **Step 3: Write the failing tab store test**

```ts
// packages/app/src/desktop/browser/cdp/tabs-store.test.ts
import { describe, expect, it } from "vitest";
import { applyTabsEvent, applyTabsSnapshot, type CdpHostTabs } from "./tabs-store";

const tab = (browserId: string, workspaceId: string, extra: Record<string, unknown> = {}) => ({
  browserId,
  workspaceId,
  url: "https://example.com/",
  title: "Example",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  agentActiveUntil: null,
  ...extra,
});
const empty: CdpHostTabs = { connected: false, tabs: {} };

describe("cdp tabs store", () => {
  it("a snapshot replaces one workspace's tabs and keeps the others", () => {
    const before: CdpHostTabs = {
      connected: false,
      tabs: { old: tab("old", "ws-a"), other: tab("other", "ws-b") },
    };
    const after = applyTabsSnapshot(before, "ws-a", {
      connected: true,
      tabs: [tab("new", "ws-a")],
    });
    expect(after.connected).toBe(true);
    expect(Object.keys(after.tabs).sort()).toEqual(["new", "other"]);
  });

  it("opened and state events upsert; closed removes", () => {
    let host = applyTabsEvent(empty, { kind: "opened", tab: tab("t1", "ws-a") });
    host = applyTabsEvent(host, {
      kind: "state",
      tab: tab("t1", "ws-a", { title: "Next", agentActiveUntil: 9 }),
    });
    expect(host.tabs.t1).toMatchObject({ title: "Next", agentActiveUntil: 9 });
    host = applyTabsEvent(host, {
      kind: "closed",
      browserId: "t1",
      workspaceId: "ws-a",
      lastUrl: "https://example.com/",
    });
    expect(host.tabs).toEqual({});
  });

  it("a host event sets connected, and a lost host clears agent activity", () => {
    let host = applyTabsEvent(empty, {
      kind: "opened",
      tab: tab("t1", "ws-a", { agentActiveUntil: 9 }),
    });
    host = applyTabsEvent(host, { kind: "host", connected: false });
    expect(host.connected).toBe(false);
    expect(host.tabs.t1.agentActiveUntil).toBeNull();
    expect(applyTabsEvent(host, { kind: "host", connected: true }).connected).toBe(true);
  });
});
```

Run it. Expected: FAIL, cannot resolve `./tabs-store`.

- [ ] **Step 4: Implement `tabs-store.ts`**

```ts
// packages/app/src/desktop/browser/cdp/tabs-store.ts
import { create } from "zustand";
import type {
  CdpBrowserTabState,
  CdpBrowserTabsEvent,
} from "@getpaseo/protocol/browser-automation/cdp-view-schemas";

/** What one host's Docker browser reports. Not persisted: the daemon is the source on every connect. */
export interface CdpHostTabs {
  connected: boolean;
  tabs: Record<string, CdpBrowserTabState>;
}

const EMPTY_HOST: CdpHostTabs = { connected: false, tabs: {} };

export function applyTabsSnapshot(
  host: CdpHostTabs,
  workspaceId: string,
  snapshot: { connected: boolean; tabs: readonly CdpBrowserTabState[] },
): CdpHostTabs {
  const tabs: Record<string, CdpBrowserTabState> = {};
  for (const tab of Object.values(host.tabs)) {
    if (tab.workspaceId !== workspaceId) tabs[tab.browserId] = tab;
  }
  for (const tab of snapshot.tabs) tabs[tab.browserId] = tab;
  return { connected: snapshot.connected, tabs };
}

export function applyTabsEvent(host: CdpHostTabs, event: CdpBrowserTabsEvent): CdpHostTabs {
  switch (event.kind) {
    case "opened":
    case "state":
      return { ...host, tabs: { ...host.tabs, [event.tab.browserId]: event.tab } };
    case "closed": {
      const { [event.browserId]: _closed, ...tabs } = host.tabs;
      return { ...host, tabs };
    }
    case "host": {
      if (event.connected) return { ...host, connected: true };
      // The daemon's "agent stopped" event cannot arrive while the host is gone.
      const tabs = Object.fromEntries(
        Object.entries(host.tabs).map(([id, tab]) => [id, { ...tab, agentActiveUntil: null }]),
      );
      return { connected: false, tabs };
    }
  }
}

interface CdpTabsStoreState {
  hosts: Record<string, CdpHostTabs>;
  applySnapshot(
    serverId: string,
    workspaceId: string,
    snapshot: { connected: boolean; tabs: readonly CdpBrowserTabState[] },
  ): void;
  applyEvent(serverId: string, event: CdpBrowserTabsEvent): void;
}

export const useCdpTabsStore = create<CdpTabsStoreState>()((set) => ({
  hosts: {},
  applySnapshot: (serverId, workspaceId, snapshot) =>
    set((state) => ({
      hosts: {
        ...state.hosts,
        [serverId]: applyTabsSnapshot(state.hosts[serverId] ?? EMPTY_HOST, workspaceId, snapshot),
      },
    })),
  applyEvent: (serverId, event) =>
    set((state) => ({
      hosts: {
        ...state.hosts,
        [serverId]: applyTabsEvent(state.hosts[serverId] ?? EMPTY_HOST, event),
      },
    })),
}));
```

Run the test. Expected: 3 passed.

- [ ] **Step 5: Write `tabs-sync.ts`**

This file is glue between three stores and the client. Its logic is the store reducers above, which are tested; the manual test in Task 18 covers the wiring.

```ts
// packages/app/src/desktop/browser/cdp/tabs-sync.ts
import { useEffect } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import type { CdpBrowserTabState } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { useBrowserStore } from "@/desktop/browser/store";
import { createBrowserRecord } from "@/desktop/browser/store/state";
import { collectAllTabs, useWorkspaceLayoutStore } from "@/stores/workspace-layout-store";
import { buildWorkspaceTabPersistenceKey } from "@/workspace-tabs/model";
import { useCdpTabsStore } from "./tabs-store";

/** The tab's label and toolbar read the shared browser store, so a daemon tab gets a record there. */
function syncBrowserRecord(tab: CdpBrowserTabState): void {
  if (!useBrowserStore.getState().browsersById[tab.browserId]) {
    useBrowserStore.setState((state) => ({
      browsersById: {
        ...state.browsersById,
        [tab.browserId]: createBrowserRecord({
          browserId: tab.browserId,
          initialUrl: tab.url,
          now: Date.now(),
        }),
      },
    }));
  }
  useBrowserStore.getState().updateBrowser(tab.browserId, {
    url: tab.url,
    title: tab.title,
    isLoading: tab.isLoading,
    canGoBack: tab.canGoBack,
    canGoForward: tab.canGoForward,
  });
}

function findLayoutTab(workspaceKey: string, browserId: string): string | null {
  const layout = useWorkspaceLayoutStore.getState().layoutByWorkspace[workspaceKey];
  if (!layout) return null;
  const tab = collectAllTabs(layout.root).find(
    (candidate) => candidate.target.kind === "browser" && candidate.target.browserId === browserId,
  );
  return tab?.tabId ?? null;
}

/** Adds the tab to the workspace layout once. A tab that is already there is only focused, never duplicated. */
export function ensureCdpTabInLayout(input: {
  serverId: string;
  workspaceId: string;
  browserId: string;
  focus: boolean;
}): void {
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  if (!workspaceKey) return;
  const layoutStore = useWorkspaceLayoutStore.getState();
  const existing = findLayoutTab(workspaceKey, input.browserId);
  if (existing) {
    if (input.focus) layoutStore.focusTab(workspaceKey, existing);
    return;
  }
  layoutStore.openTab({
    workspaceKey,
    target: { kind: "browser", browserId: input.browserId },
    intent: input.focus ? "reveal" : "background",
  });
}

/** Opens a tab from the UI. Rejects with the daemon's error code. */
export async function openCdpTab(input: {
  client: DaemonClient;
  serverId: string;
  workspaceId: string;
  url?: string;
}): Promise<string> {
  const tab = await input.client.openCdpBrowserTab({
    workspaceId: input.workspaceId,
    url: input.url,
  });
  syncBrowserRecord(tab);
  // The "opened" event may have added the tab in the background already; this focuses it.
  ensureCdpTabInLayout({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    browserId: tab.browserId,
    focus: true,
  });
  return tab.browserId;
}

/** "Tab closed" then Reopen: a new tab on the old URL takes the dead tab's place. */
export async function reopenCdpTab(input: {
  client: DaemonClient;
  serverId: string;
  workspaceId: string;
  browserId: string;
}): Promise<void> {
  const url = useBrowserStore.getState().browsersById[input.browserId]?.url;
  await openCdpTab({
    client: input.client,
    serverId: input.serverId,
    workspaceId: input.workspaceId,
    url,
  });
  const workspaceKey = buildWorkspaceTabPersistenceKey({
    serverId: input.serverId,
    workspaceId: input.workspaceId,
  });
  const dead = workspaceKey ? findLayoutTab(workspaceKey, input.browserId) : null;
  if (workspaceKey && dead) useWorkspaceLayoutStore.getState().closeTab(workspaceKey, dead);
  useBrowserStore.getState().removeBrowser(input.browserId);
}

/**
 * Keeps one workspace's daemon browser tabs in the stores and the layout while its screen is mounted.
 * The subscription replays its snapshot on reconnect, which is the reconcile when a workspace opens.
 * A layout tab the daemon no longer has stays: its pane shows "Tab closed" with Reopen.
 */
export function useCdpTabsSync(input: {
  client: DaemonClient | null;
  serverId: string;
  workspaceId: string;
  enabled: boolean;
}): void {
  const { client, serverId, workspaceId, enabled } = input;
  useEffect(() => {
    if (!enabled || !client || !serverId || !workspaceId) return;
    const observation = client.observeCdpBrowserTabs({ workspaceId });
    const unsubscribe = observation.subscribe({
      snapshot: (snapshot) => {
        useCdpTabsStore.getState().applySnapshot(serverId, workspaceId, snapshot);
        for (const tab of snapshot.tabs) {
          syncBrowserRecord(tab);
          ensureCdpTabInLayout({ serverId, workspaceId, browserId: tab.browserId, focus: false });
        }
      },
      update: (message) => {
        if (message.type !== "browser.cdp.tabs.update") return;
        const { event } = message.payload;
        useCdpTabsStore.getState().applyEvent(serverId, event);
        if (event.kind === "opened") {
          syncBrowserRecord(event.tab);
          ensureCdpTabInLayout({
            serverId,
            workspaceId,
            browserId: event.tab.browserId,
            focus: false,
          });
        } else if (event.kind === "state") {
          syncBrowserRecord(event.tab);
        }
      },
      // A refused subscription (old host, lost feature) leaves the pane on its own error state.
      error: () => {},
    });
    return () => {
      unsubscribe();
      void observation.release().catch(() => {});
    };
  }, [client, enabled, serverId, workspaceId]);
}
```

- [ ] **Step 6: Typecheck the app, run both tests, commit**

```bash
cd /workspace/utils/paseo/packages/app
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/desktop/browser/cdp/view-model.test.ts src/desktop/browser/cdp/tabs-store.test.ts --no-file-parallelism --maxWorkers=1 --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded
```

Expected: tests pass, typecheck exits 0. Lint, format, commit.

Message: `feat(fork): app model and layout sync for daemon browser tabs`

## Task 15: The view hook, the frame image and the pane

**Files:**

- Create: `packages/app/src/desktop/browser/cdp/use-cdp-view.ts`
- Create: `packages/app/src/desktop/browser/cdp/frame-image.web.tsx`
- Create: `packages/app/src/desktop/browser/cdp/frame-image.tsx`
- Create: `packages/app/src/desktop/browser/cdp/cdp-pane.tsx`
- Create: `packages/app/src/desktop/browser/cdp/input-layer-types.ts`, `input-layer.tsx`, `input-layer.web.tsx` (stubs; Task 16 fills the two layers)
- Modify: `packages/app/src/i18n/resources/en.ts` and the eight other locale files in that folder

**Interfaces:**

- Consumes: `DaemonClient.observeCdpBrowserView`, `sendCdpBrowserViewInput`, `navigateCdpBrowserView` (Task 13); `decodeBrowserViewFrame` (Task 10); `view-model.ts`, `tabs-store.ts`, `tabs-sync.ts` (Task 14); `useHostRuntimeClient` (`@/runtime/host-runtime`); `useRetainedPanelActive` (`@/components/retained-panel`); `useAppVisible` (`@/hooks/use-app-visible`); `normalizeWorkspaceBrowserUrl`, `useBrowserStore` (`@/desktop/browser/store`); `CdpInputLayer` (Task 16; this task adds a stub the next task replaces).
- Produces:
  - `useCdpView(input: { client: DaemonClient | null; browserId: string; active: boolean; viewport: CdpBrowserViewport | null; hostConnected: boolean }): { frame: CdpViewFrame | null; status: CdpViewStatus; sendInput(input: CdpBrowserViewInput): void; navigate(action: CdpBrowserNavigateAction): void; retry(): void }`
  - `interface CdpViewFrame { jpeg: Uint8Array; sequence: number; deviceWidth: number; deviceHeight: number }`
  - `CdpFrameImage(props: { jpeg: Uint8Array; rect: FrameRect })`
  - `CdpBrowserPane(props: { browserId: string; serverId: string; workspaceId: string; onFocusPane?: () => void })`
  - `interface CdpInputLayerProps { rect: FrameRect; page: Size; onInput(input: CdpBrowserViewInput): void; onFocusUrl(): void; onFocusPane?: () => void; keyboardRequest: number }` (in `input-layer-types.ts`)
  - i18n block `cdpBrowser` with keys `agentActive`, `closed.title`, `closed.reopen`, `unreachable.title`, `unreachable.retry`, `unresponsive`, `connecting`, `keyboard`.

- [ ] **Step 1: Add the strings**

In `en.ts`, a new top-level block after `sessionMove`:

```ts
  cdpBrowser: {
    agentActive: "Agent is using this tab",
    connecting: "Connecting to the browser…",
    unresponsive: "Page not responding",
    keyboard: "Show keyboard",
    closed: {
      title: "Tab closed",
      reopen: "Reopen",
    },
    unreachable: {
      title: "Docker browser unreachable",
      retry: "Retry",
    },
  },
```

In each of `ar.ts`, `es.ts`, `fr.ts`, `ja.ts`, `ko.ts`, `pt-BR.ts`, `ru.ts` and `zh-CN.ts`, after its `sessionMove: en.sessionMove,` line:

```ts
  cdpBrowser: en.cdpBrowser,
```

That is the fork's practice for its own strings (`sessionMove` does the same), and `TranslationResources` makes a missing block a type error.

- [ ] **Step 2: Write `use-cdp-view.ts`**

```ts
// packages/app/src/desktop/browser/cdp/use-cdp-view.ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { DaemonClient } from "@getpaseo/client/internal/daemon-client";
import { decodeBrowserViewFrame } from "@getpaseo/protocol/binary-frames/index";
import type {
  CdpBrowserNavigateAction,
  CdpBrowserViewInput,
  CdpBrowserViewport,
} from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { viewStatusForError, type CdpViewStatus } from "./view-model";

export interface CdpViewFrame {
  jpeg: Uint8Array;
  sequence: number;
  deviceWidth: number;
  deviceHeight: number;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Watches one daemon browser tab while `active`. Hiding the pane or backgrounding the app releases
 * the subscription, which stops the screencast when nobody else watches the tab.
 */
export function useCdpView(input: {
  client: DaemonClient | null;
  browserId: string;
  active: boolean;
  viewport: CdpBrowserViewport | null;
  hostConnected: boolean;
}): {
  frame: CdpViewFrame | null;
  status: CdpViewStatus;
  sendInput(input: CdpBrowserViewInput): void;
  navigate(action: CdpBrowserNavigateAction): void;
  retry(): void;
} {
  const { client, browserId, active, hostConnected } = input;
  const [frame, setFrame] = useState<CdpViewFrame | null>(null);
  const [status, setStatus] = useState<CdpViewStatus>("connecting");
  const [attempt, setAttempt] = useState(0);
  const subscriptionId = useRef<string | null>(null);
  // The size at subscribe time only seeds the tab; later sizes travel with each input.
  const viewport = useRef(input.viewport);
  viewport.current = input.viewport;
  const measured = input.viewport !== null;

  useEffect(() => {
    if (!client || !active || !measured || !viewport.current) return;
    let lastSequence = 0;
    setStatus("connecting");
    const observation = client.observeCdpBrowserView({ browserId, ...viewport.current });
    const unsubscribe = observation.subscribe({
      snapshot: (snapshot) => {
        // A reconnect makes a new subscription on the daemon, whose frames count from 1 again.
        lastSequence = 0;
        subscriptionId.current = snapshot.subscriptionId;
        setStatus("live");
      },
      update: (message) => {
        if (message.type === "browser.cdp.view.update")
          setStatus(viewStatusForError(message.payload.error));
      },
      binary: (bytes) => {
        const decoded = decodeBrowserViewFrame(bytes);
        if (!decoded || decoded.sequence < lastSequence) return;
        lastSequence = decoded.sequence;
        // The payload is a view into the socket's buffer; copy what outlives this callback.
        setFrame({
          jpeg: decoded.jpeg.slice(),
          sequence: decoded.sequence,
          deviceWidth: decoded.deviceWidth,
          deviceHeight: decoded.deviceHeight,
        });
        setStatus((current) => (current === "unresponsive" ? "live" : current));
      },
      error: (error) => setStatus(viewStatusForError(errorText(error))),
    });
    return () => {
      subscriptionId.current = null;
      unsubscribe();
      void observation.release().catch(() => {});
    };
    // hostConnected: a host that came back gets a fresh subscription without a tap on Retry.
  }, [client, browserId, active, measured, attempt, hostConnected]);

  const sendInput = useCallback(
    (event: CdpBrowserViewInput) => {
      const id = subscriptionId.current;
      if (!client || !id) return;
      try {
        client.sendCdpBrowserViewInput(id, event, viewport.current ?? undefined);
      } catch {
        // The socket dropped between frames; the subscription's reconnect restores input.
      }
    },
    [client],
  );

  const navigate = useCallback(
    (action: CdpBrowserNavigateAction) => {
      if (!client) return;
      client.navigateCdpBrowserView(browserId, action).then(
        () => setStatus((current) => (current === "unresponsive" ? "live" : current)),
        (error) => setStatus(viewStatusForError(errorText(error))),
      );
    },
    [client, browserId],
  );

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { frame, status, sendInput, navigate, retry };
}
```

- [ ] **Step 3: Write the two frame images**

```tsx
// packages/app/src/desktop/browser/cdp/frame-image.web.tsx
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { FrameRect } from "./view-model";

/** Draws one JPEG frame. An <img> with an object URL swaps frames without the flash a data URI gives. */
export function CdpFrameImage({ jpeg, rect }: { jpeg: Uint8Array; rect: FrameRect }) {
  const ref = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const url = URL.createObjectURL(new Blob([jpeg.slice().buffer], { type: "image/jpeg" }));
    if (ref.current) ref.current.src = url;
    // The decoded frame stays on screen after its URL is revoked.
    return () => URL.revokeObjectURL(url);
  }, [jpeg]);
  const style = useMemo<CSSProperties>(
    () => ({
      position: "absolute",
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      userSelect: "none",
      pointerEvents: "none",
    }),
    [rect.left, rect.top, rect.width, rect.height],
  );
  return <img ref={ref} alt="" draggable={false} style={style} />;
}
```

```tsx
// packages/app/src/desktop/browser/cdp/frame-image.tsx
import { useMemo } from "react";
import { Image } from "react-native";
import { Buffer } from "buffer";
import type { FrameRect } from "./view-model";

/** Native: one JPEG frame as a data URI. fadeDuration 0 stops Android cross-fading every frame. */
export function CdpFrameImage({ jpeg, rect }: { jpeg: Uint8Array; rect: FrameRect }) {
  const source = useMemo(
    () => ({ uri: `data:image/jpeg;base64,${Buffer.from(jpeg).toString("base64")}` }),
    [jpeg],
  );
  const style = useMemo(
    () => ({
      position: "absolute" as const,
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
    }),
    [rect.left, rect.top, rect.width, rect.height],
  );
  return <Image accessibilityIgnoresInvertColors fadeDuration={0} source={source} style={style} />;
}
```

- [ ] **Step 4: Add the input layer's props and a stub**

Task 16 replaces both stub bodies. The stubs let this task typecheck and show frames. The props sit in their own file: on web, Metro resolves `./input-layer` to `input-layer.web.tsx`, so the web file cannot import its props from that path.

```ts
// packages/app/src/desktop/browser/cdp/input-layer-types.ts
import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import type { FrameRect, Size } from "./view-model";

export interface CdpInputLayerProps {
  /** Where the frame is drawn in the pane. The layer covers exactly this rectangle. */
  rect: FrameRect;
  /** The page viewport in CSS pixels, from the frame's metadata. */
  page: Size;
  onInput(input: CdpBrowserViewInput): void;
  onFocusUrl(): void;
  onFocusPane?: () => void;
  /** Native: each increment focuses the hidden text input, which raises the keyboard. */
  keyboardRequest: number;
}
```

```tsx
// packages/app/src/desktop/browser/cdp/input-layer.tsx and input-layer.web.tsx (same stub in both)
import type { CdpInputLayerProps } from "./input-layer-types";

export function CdpInputLayer(_props: CdpInputLayerProps) {
  return null;
}
```

- [ ] **Step 5: Write `cdp-pane.tsx`**

```tsx
// packages/app/src/desktop/browser/cdp/cdp-pane.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PixelRatio, Pressable, Text, TextInput, View, type LayoutChangeEvent } from "react-native";
import { ArrowLeft, ArrowRight, Keyboard, RotateCw } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { isNative } from "@/constants/platform";
import { normalizeWorkspaceBrowserUrl, useBrowserStore } from "@/desktop/browser/store";
import { useAppVisible } from "@/hooks/use-app-visible";
import { useHostRuntimeClient } from "@/runtime/host-runtime";
import { CdpFrameImage } from "./frame-image";
import { CdpInputLayer } from "./input-layer";
import { useCdpTabsStore } from "./tabs-store";
import { reopenCdpTab } from "./tabs-sync";
import { useCdpView } from "./use-cdp-view";
import { fitFrame, viewportForPane, type Size } from "./view-model";

const ThemedArrowLeft = withUnistyles(ArrowLeft);
const ThemedArrowRight = withUnistyles(ArrowRight);
const ThemedRotateCw = withUnistyles(RotateCw);
const ThemedKeyboard = withUnistyles(Keyboard);
const ThemedUrlInput = withUnistyles(TextInput);
const iconMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  color: theme.colors.foregroundMuted,
});
const urlInputMapping = (theme: { colors: { foregroundMuted: string } }) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
});
const ICON_SIZE = 16;

export interface CdpBrowserPaneProps {
  browserId: string;
  serverId: string;
  workspaceId: string;
  onFocusPane?: () => void;
}

export function CdpBrowserPane({
  browserId,
  serverId,
  workspaceId,
  onFocusPane,
}: CdpBrowserPaneProps) {
  const { t } = useTranslation();
  const client = useHostRuntimeClient(serverId);
  const panelActive = useRetainedPanelActive();
  const appVisible = useAppVisible();
  const record = useBrowserStore((state) => state.browsersById[browserId] ?? null);
  const hostConnected = useCdpTabsStore((state) => state.hosts[serverId]?.connected ?? false);
  const agentActive = useCdpTabsStore(
    (state) => (state.hosts[serverId]?.tabs[browserId]?.agentActiveUntil ?? null) !== null,
  );

  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const handleLayout = useCallback((event: LayoutChangeEvent) => {
    const { width, height } = event.nativeEvent.layout;
    setSize((current) =>
      current.width === width && current.height === height ? current : { width, height },
    );
  }, []);
  const viewport = useMemo(() => viewportForPane(size, PixelRatio.get()), [size]);

  const view = useCdpView({
    client,
    browserId,
    active: panelActive && appVisible,
    viewport,
    hostConnected,
  });
  const page = useMemo<Size>(
    () => ({ width: view.frame?.deviceWidth ?? 0, height: view.frame?.deviceHeight ?? 0 }),
    [view.frame?.deviceWidth, view.frame?.deviceHeight],
  );
  const rect = useMemo(() => fitFrame(size, page), [size, page]);

  // The URL field shows the tab's URL until the user edits it.
  const url = record?.url ?? "";
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setDraft(url);
  }, [editing, url]);
  const urlInput = useRef<TextInput>(null);
  const focusUrl = useCallback(() => urlInput.current?.focus(), []);
  const handleUrlFocus = useCallback(() => setEditing(true), []);
  const handleUrlBlur = useCallback(() => setEditing(false), []);
  const submitUrl = useCallback(() => {
    const next = normalizeWorkspaceBrowserUrl(draft);
    view.navigate({ kind: "url", url: next });
    urlInput.current?.blur();
  }, [draft, view]);
  const goBack = useCallback(() => view.navigate({ kind: "back" }), [view]);
  const goForward = useCallback(() => view.navigate({ kind: "forward" }), [view]);
  const reload = useCallback(() => view.navigate({ kind: "reload" }), [view]);

  const [keyboardRequest, setKeyboardRequest] = useState(0);
  const showKeyboard = useCallback(() => setKeyboardRequest((value) => value + 1), []);

  const [reopening, setReopening] = useState(false);
  const reopen = useCallback(() => {
    if (!client || reopening) return;
    setReopening(true);
    reopenCdpTab({ client, serverId, workspaceId, browserId })
      .catch(() => {})
      .finally(() => setReopening(false));
  }, [browserId, client, reopening, serverId, workspaceId]);

  const blocked = view.status === "closed" || view.status === "unreachable";

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.browser.controls.back")}
          disabled={blocked || !record?.canGoBack}
          onPress={goBack}
          style={styles.toolbarButton}
        >
          <ThemedArrowLeft size={ICON_SIZE} uniProps={iconMapping} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.browser.controls.forward")}
          disabled={blocked || !record?.canGoForward}
          onPress={goForward}
          style={styles.toolbarButton}
        >
          <ThemedArrowRight size={ICON_SIZE} uniProps={iconMapping} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t("workspace.browser.controls.refresh")}
          disabled={blocked}
          onPress={reload}
          style={styles.toolbarButton}
        >
          <ThemedRotateCw size={ICON_SIZE} uniProps={iconMapping} />
        </Pressable>
        <ThemedUrlInput
          ref={urlInput}
          accessibilityLabel={t("workspace.browser.controls.browserUrl")}
          autoCapitalize="none"
          autoCorrect={false}
          editable={!blocked}
          keyboardType="url"
          onBlur={handleUrlBlur}
          onChangeText={setDraft}
          onFocus={handleUrlFocus}
          onSubmitEditing={submitUrl}
          placeholder={t("workspace.browser.controls.enterUrl")}
          selectTextOnFocus
          style={styles.urlInput}
          uniProps={urlInputMapping}
          value={draft}
        />
        {isNative ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("cdpBrowser.keyboard")}
            disabled={blocked}
            onPress={showKeyboard}
            style={styles.toolbarButton}
          >
            <ThemedKeyboard size={ICON_SIZE} uniProps={iconMapping} />
          </Pressable>
        ) : null}
      </View>

      <View onLayout={handleLayout} style={styles.viewport}>
        {view.frame && !blocked ? (
          <>
            <CdpFrameImage jpeg={view.frame.jpeg} rect={rect} />
            <CdpInputLayer
              keyboardRequest={keyboardRequest}
              onFocusPane={onFocusPane}
              onFocusUrl={focusUrl}
              onInput={view.sendInput}
              page={page}
              rect={rect}
            />
          </>
        ) : null}
        {!view.frame && view.status === "connecting" ? (
          <View style={styles.message}>
            <Text style={styles.messageText}>{t("cdpBrowser.connecting")}</Text>
          </View>
        ) : null}
        {view.status === "closed" ? (
          <View style={styles.message}>
            <Text style={styles.messageTitle}>{t("cdpBrowser.closed.title")}</Text>
            <Button disabled={reopening} onPress={reopen}>
              {t("cdpBrowser.closed.reopen")}
            </Button>
          </View>
        ) : null}
        {view.status === "unreachable" ? (
          <View style={styles.message}>
            <Text style={styles.messageTitle}>{t("cdpBrowser.unreachable.title")}</Text>
            <Button onPress={view.retry}>{t("cdpBrowser.unreachable.retry")}</Button>
          </View>
        ) : null}
        {view.status === "unresponsive" ? (
          <View pointerEvents="none" style={styles.banner}>
            <Text style={styles.bannerText}>{t("cdpBrowser.unresponsive")}</Text>
          </View>
        ) : null}
        {agentActive && !blocked ? (
          <View pointerEvents="none" style={styles.badge}>
            <Text style={styles.bannerText}>{t("cdpBrowser.agentActive")}</Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  toolbar: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  toolbarButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.md,
  },
  urlInput: {
    flex: 1,
    minWidth: 0,
    height: 28,
    paddingHorizontal: 8,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  viewport: {
    flex: 1,
    overflow: "hidden",
    backgroundColor: theme.colors.surface1,
  },
  message: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    padding: 16,
  },
  messageTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "600",
  },
  messageText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  banner: {
    position: "absolute",
    top: 8,
    alignSelf: "center",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  badge: {
    position: "absolute",
    right: 8,
    bottom: 8,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: theme.borderRadius.md,
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  bannerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
}));
```

Read `docs/design.md` and `docs/unistyles.md` before this step. If `Button` needs a `variant` or `size` for a secondary action in an empty state, use the one `docs/design.md` names; the plan's code relies on its defaults.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
cd /workspace/utils/paseo/packages/app
flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded
```

Expected: exit 0. Lint, format (include the nine locale files), commit.

Message: `feat(fork): daemon browser pane with live frames and a toolbar`

## Task 16: Input layers for web and native

**Files:**

- Modify: `packages/app/src/desktop/browser/cdp/input-layer.web.tsx` (replace the stub)
- Modify: `packages/app/src/desktop/browser/cdp/input-layer.tsx` (replace the stub)
- Create: `packages/app/src/desktop/browser/cdp/touch-gesture.ts`
- Test: `packages/app/src/desktop/browser/cdp/touch-gesture.test.ts`

**Interfaces:**

- Consumes: `CdpInputLayerProps` (`./input-layer-types`), `toPagePoint`, `modifierMask`, `mouseButton`, `keyText`, `createThrottle`, `HOVER_INTERVAL_MS`, `TOUCH_SLOP_PX` (Task 14).
- Produces:
  - `CdpInputLayer(props: CdpInputLayerProps)` for web and for native.
  - `createTouchGesture(): TouchGesture` with `start(point)`, `move(point): CdpBrowserViewInput[]`, `end(): CdpBrowserViewInput[]`, where `point` is in page CSS pixels. A tap is a click; a drag is a scroll.

- [ ] **Step 1: Write the failing gesture test**

Touch behaves the same in a phone browser and in the native app, so the rule lives in one pure module.

```ts
// packages/app/src/desktop/browser/cdp/touch-gesture.test.ts
import { describe, expect, it } from "vitest";
import { createTouchGesture } from "./touch-gesture";

describe("touch gesture", () => {
  it("a tap is a move, a press and a release at the touch point", () => {
    const gesture = createTouchGesture();
    gesture.start({ x: 100, y: 200 });
    expect(gesture.move({ x: 102, y: 203 })).toEqual([]);
    expect(gesture.end()).toEqual([
      {
        kind: "mouse",
        type: "move",
        x: 100,
        y: 200,
        button: "none",
        buttons: 0,
        clickCount: 0,
        modifiers: 0,
      },
      {
        kind: "mouse",
        type: "down",
        x: 100,
        y: 200,
        button: "left",
        buttons: 1,
        clickCount: 1,
        modifiers: 0,
      },
      {
        kind: "mouse",
        type: "up",
        x: 100,
        y: 200,
        button: "left",
        buttons: 0,
        clickCount: 1,
        modifiers: 0,
      },
    ]);
  });

  it("a drag scrolls the page the way the finger moves it, and ends without a click", () => {
    const gesture = createTouchGesture();
    gesture.start({ x: 100, y: 200 });
    expect(gesture.move({ x: 100, y: 180 })).toEqual([
      { kind: "wheel", x: 100, y: 200, deltaX: 0, deltaY: 20, modifiers: 0 },
    ]);
    expect(gesture.move({ x: 90, y: 150 })).toEqual([
      { kind: "wheel", x: 100, y: 200, deltaX: 10, deltaY: 30, modifiers: 0 },
    ]);
    expect(gesture.end()).toEqual([]);
  });

  it("ignores a move or an end with no touch in progress", () => {
    const gesture = createTouchGesture();
    expect(gesture.move({ x: 1, y: 1 })).toEqual([]);
    expect(gesture.end()).toEqual([]);
  });
});
```

Run it from `packages/app`. Expected: FAIL, cannot resolve `./touch-gesture`.

- [ ] **Step 2: Implement `touch-gesture.ts`**

```ts
// packages/app/src/desktop/browser/cdp/touch-gesture.ts
import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { TOUCH_SLOP_PX } from "./view-model";

interface Point {
  x: number;
  y: number;
}

export interface TouchGesture {
  start(point: Point): void;
  move(point: Point): CdpBrowserViewInput[];
  end(): CdpBrowserViewInput[];
}

/** Touch on the frame: a tap is a click, a drag is a scroll. Points are page CSS pixels. No pinch zoom. */
export function createTouchGesture(): TouchGesture {
  let origin: Point | null = null;
  let last: Point | null = null;
  let scrolling = false;
  return {
    start(point) {
      origin = point;
      last = point;
      scrolling = false;
    },
    move(point) {
      if (!origin || !last) return [];
      if (!scrolling && Math.hypot(point.x - origin.x, point.y - origin.y) < TOUCH_SLOP_PX)
        return [];
      scrolling = true;
      // The page follows the finger: dragging up scrolls down.
      const wheel: CdpBrowserViewInput = {
        kind: "wheel",
        x: origin.x,
        y: origin.y,
        deltaX: last.x - point.x,
        deltaY: last.y - point.y,
        modifiers: 0,
      };
      last = point;
      return [wheel];
    },
    end() {
      const point = origin;
      const tapped = point !== null && !scrolling;
      origin = null;
      last = null;
      scrolling = false;
      if (!tapped || !point) return [];
      const base = { kind: "mouse" as const, x: point.x, y: point.y, modifiers: 0 };
      return [
        { ...base, type: "move", button: "none", buttons: 0, clickCount: 0 },
        { ...base, type: "down", button: "left", buttons: 1, clickCount: 1 },
        { ...base, type: "up", button: "left", buttons: 0, clickCount: 1 },
      ];
    },
  };
}
```

Run the gesture test. Expected: 3 passed.

- [ ] **Step 3: Write the web layer**

```tsx
// packages/app/src/desktop/browser/cdp/input-layer.web.tsx
import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import type { CdpInputLayerProps } from "./input-layer-types";
import { createTouchGesture } from "./touch-gesture";
import {
  createThrottle,
  HOVER_INTERVAL_MS,
  keyText,
  modifierMask,
  mouseButton,
  toPagePoint,
} from "./view-model";

/**
 * A focusable element over the frame. A focused layer sends every key to the page except
 * Ctrl/Cmd+L, which focuses the URL field. Paste goes through the browser's paste event, so the
 * clipboard is read only when the user pastes.
 */
export function CdpInputLayer({
  rect,
  page,
  onInput,
  onFocusUrl,
  onFocusPane,
}: CdpInputLayerProps) {
  const element = useRef<HTMLDivElement>(null);
  // Handlers read the latest props without re-attaching DOM listeners on every frame.
  const latest = useRef({ rect, page, onInput, onFocusUrl, onFocusPane });
  latest.current = { rect, page, onInput, onFocusUrl, onFocusPane };

  useEffect(() => {
    const node = element.current;
    if (!node) return;
    const allowHover = createThrottle(HOVER_INTERVAL_MS);
    const touch = createTouchGesture();
    const point = (event: { clientX: number; clientY: number }) => {
      const bounds = node.getBoundingClientRect();
      const { rect: displayed, page: pageSize } = latest.current;
      return toPagePoint(
        { x: event.clientX - bounds.left, y: event.clientY - bounds.top },
        { width: displayed.width, height: displayed.height },
        pageSize,
      );
    };
    const send = (input: Parameters<CdpInputLayerProps["onInput"]>[0]) =>
      latest.current.onInput(input);

    const onPointerDown = (event: PointerEvent) => {
      node.focus({ preventScroll: true });
      latest.current.onFocusPane?.();
      if (event.pointerType === "touch") {
        touch.start(point(event));
        return;
      }
      node.setPointerCapture(event.pointerId);
      send({
        kind: "mouse",
        type: "down",
        ...point(event),
        button: mouseButton(event.button),
        buttons: event.buttons,
        clickCount: Math.max(1, event.detail),
        modifiers: modifierMask(event),
      });
    };
    const onPointerMove = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        for (const input of touch.move(point(event))) send(input);
        return;
      }
      // A drag sends every move; a hover is capped at about 30 per second.
      if (event.buttons === 0 && !allowHover()) return;
      send({
        kind: "mouse",
        type: "move",
        ...point(event),
        button: event.buttons === 0 ? "none" : mouseButton(event.button === -1 ? 0 : event.button),
        buttons: event.buttons,
        clickCount: 0,
        modifiers: modifierMask(event),
      });
    };
    const onPointerUp = (event: PointerEvent) => {
      if (event.pointerType === "touch") {
        for (const input of touch.end()) send(input);
        return;
      }
      send({
        kind: "mouse",
        type: "up",
        ...point(event),
        button: mouseButton(event.button),
        buttons: event.buttons,
        clickCount: Math.max(1, event.detail),
        modifiers: modifierMask(event),
      });
    };
    const onPointerCancel = () => void touch.end();
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      send({
        kind: "wheel",
        ...point(event),
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        modifiers: modifierMask(event),
      });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      const command = event.ctrlKey || event.metaKey;
      if (command && event.key.toLowerCase() === "l") {
        event.preventDefault();
        latest.current.onFocusUrl();
        return;
      }
      // Let the browser raise its paste event; onPaste sends the text.
      if (command && event.key.toLowerCase() === "v") return;
      event.preventDefault();
      const text = keyText(event);
      send({
        kind: "key",
        type: "down",
        key: event.key,
        code: event.code,
        ...(text ? { text } : {}),
        modifiers: modifierMask(event),
      });
    };
    const onKeyUp = (event: KeyboardEvent) => {
      event.preventDefault();
      send({
        kind: "key",
        type: "up",
        key: event.key,
        code: event.code,
        modifiers: modifierMask(event),
      });
    };
    const onPaste = (event: ClipboardEvent) => {
      event.preventDefault();
      const text = event.clipboardData?.getData("text/plain");
      if (text) send({ kind: "text", text });
    };
    const onContextMenu = (event: Event) => event.preventDefault();

    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove);
    node.addEventListener("pointerup", onPointerUp);
    node.addEventListener("pointercancel", onPointerCancel);
    // React's wheel listener is passive, so it cannot stop the workspace from scrolling.
    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("keydown", onKeyDown);
    node.addEventListener("keyup", onKeyUp);
    node.addEventListener("paste", onPaste);
    node.addEventListener("contextmenu", onContextMenu);
    return () => {
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", onPointerUp);
      node.removeEventListener("pointercancel", onPointerCancel);
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("keydown", onKeyDown);
      node.removeEventListener("keyup", onKeyUp);
      node.removeEventListener("paste", onPaste);
      node.removeEventListener("contextmenu", onContextMenu);
    };
  }, []);

  const style = useMemo<CSSProperties>(
    () => ({
      position: "absolute",
      left: rect.left,
      top: rect.top,
      width: rect.width,
      height: rect.height,
      outline: "none",
      // The layer scrolls the remote page, not this document.
      touchAction: "none",
      cursor: "default",
    }),
    [rect.left, rect.top, rect.width, rect.height],
  );
  return <div ref={element} style={style} tabIndex={0} />;
}
```

- [ ] **Step 4: Write the native layer**

```tsx
// packages/app/src/desktop/browser/cdp/input-layer.tsx
import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  TextInput,
  View,
  type GestureResponderEvent,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { StyleSheet } from "react-native-unistyles";
import type { CdpInputLayerProps } from "./input-layer-types";
import { createTouchGesture } from "./touch-gesture";
import { toPagePoint } from "./view-model";

// The hidden input always holds this one character, so Backspace has something to delete and
// Android reports it. Whatever the user types arrives as a change away from it.
const SENTINEL = "​";

export function CdpInputLayer({
  rect,
  page,
  onInput,
  onFocusPane,
  keyboardRequest,
}: CdpInputLayerProps) {
  const input = useRef<TextInput>(null);
  const gesture = useRef(createTouchGesture());

  useEffect(() => {
    if (keyboardRequest > 0) input.current?.focus();
  }, [keyboardRequest]);

  const point = useCallback(
    (event: GestureResponderEvent) =>
      toPagePoint(
        { x: event.nativeEvent.locationX, y: event.nativeEvent.locationY },
        { width: rect.width, height: rect.height },
        page,
      ),
    [page, rect.height, rect.width],
  );
  const claim = useCallback(() => true, []);
  const handleGrant = useCallback(
    (event: GestureResponderEvent) => {
      onFocusPane?.();
      gesture.current.start(point(event));
    },
    [onFocusPane, point],
  );
  const handleMove = useCallback(
    (event: GestureResponderEvent) => {
      for (const next of gesture.current.move(point(event))) onInput(next);
    },
    [onInput, point],
  );
  const handleRelease = useCallback(() => {
    for (const next of gesture.current.end()) onInput(next);
  }, [onInput]);
  const handleTerminate = useCallback(() => void gesture.current.end(), []);

  const sendKey = useCallback(
    (key: "Enter" | "Backspace") => {
      onInput({ kind: "key", type: "down", key, code: key, modifiers: 0 });
      onInput({ kind: "key", type: "up", key, code: key, modifiers: 0 });
    },
    [onInput],
  );
  const handleChangeText = useCallback(
    (value: string) => {
      const typed = value.replaceAll(SENTINEL, "");
      if (typed) onInput({ kind: "text", text: typed });
      else if (value.length === 0) sendKey("Backspace");
    },
    [onInput, sendKey],
  );
  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      if (event.nativeEvent.key === "Enter") sendKey("Enter");
    },
    [sendKey],
  );

  const layerStyle = useMemo(
    () => [
      styles.layer,
      { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
    ],
    [rect.left, rect.top, rect.width, rect.height],
  );

  return (
    <>
      <View
        onMoveShouldSetResponder={claim}
        onResponderGrant={handleGrant}
        onResponderMove={handleMove}
        onResponderRelease={handleRelease}
        onResponderTerminate={handleTerminate}
        onStartShouldSetResponder={claim}
        style={layerStyle}
      />
      <TextInput
        ref={input}
        autoCapitalize="none"
        autoCorrect={false}
        blurOnSubmit={false}
        caretHidden
        multiline
        onChangeText={handleChangeText}
        onKeyPress={handleKeyPress}
        style={styles.hiddenInput}
        value={SENTINEL}
      />
    </>
  );
}

const styles = StyleSheet.create(() => ({
  layer: {
    position: "absolute",
  },
  hiddenInput: {
    position: "absolute",
    width: 1,
    height: 1,
    opacity: 0,
  },
}));
```

`multiline` makes Enter arrive as a key press instead of a submit that hides the keyboard. The controlled `value` resets the field to the sentinel after every change.

- [ ] **Step 5: Typecheck, commit**

`cdp-pane.tsx` does not change: it imports `CdpInputLayer` from `./input-layer`.

```bash
cd /workspace/utils/paseo/packages/app
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/desktop/browser/cdp/touch-gesture.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded
```

Expected: 3 passed, typecheck exits 0. Lint, format, commit.

Message: `feat(fork): pointer, touch and keyboard input for the daemon browser pane`

## Task 17: Show the pane, open and close tabs from the workspace

**Files:**

- Modify: `packages/app/src/desktop/browser/pane/index.web.tsx`
- Modify: `packages/app/src/desktop/browser/pane/index.tsx`
- Modify: `packages/app/src/screens/workspace/workspace-screen.tsx` (`handleCloseTab` cleanup near line 1435, `handleCreateBrowserTab` near line 1857, `launchWorkspaceTab` near line 1905, `handleOpenUrlInBrowserTab` near line 1918, `showCreateBrowserTab` near line 3327)

**Interfaces:**

- Consumes: `CdpBrowserPane` (Task 15); `useCdpTabsSync`, `openCdpTab` (Task 14); `useHostFeature(serverId, "cdpBrowser")` (`@/runtime/host-features`); `client.closeCdpBrowserTab` (Task 13).
- Produces: nothing new. `index.electron.tsx` is not touched: Electron keeps its own pane and its own tabs.

- [ ] **Step 1: Render the CDP pane when the host has the feature**

In both `index.web.tsx` and `index.tsx`, rename the existing component to `BrowserUnavailable` (body unchanged) and export a new `BrowserPane` above it. The props interface is already there.

```tsx
import { CdpBrowserPane } from "@/desktop/browser/cdp/cdp-pane";
import { useHostFeature } from "@/runtime/host-features";

export function BrowserPane(props: BrowserPaneProps) {
  // The feature is on when the host's daemon has a Docker Chromium (PASEO_BROWSER_CDP_URL).
  const hosted = useHostFeature(props.serverId, "cdpBrowser");
  if (!hosted) return <BrowserUnavailable {...props} />;
  return (
    <CdpBrowserPane
      browserId={props.browserId}
      onFocusPane={props.onFocusPane}
      serverId={props.serverId}
      workspaceId={props.workspaceId}
    />
  );
}

function BrowserUnavailable({ browserId }: BrowserPaneProps) {
  // ...the existing body, unchanged
}
```

- [ ] **Step 2: Wire the workspace screen**

All edits are in `workspace-screen.tsx`. Add the imports:

```ts
import { openCdpTab, useCdpTabsSync } from "@/desktop/browser/cdp/tabs-sync";
```

After `const supportsSetupObservation = useHostFeature(...)` (line 1361), where `client`, `normalizedServerId` and `normalizedWorkspaceId` are in scope:

```ts
// Fork delta (web browser pane): the host's daemon runs a Docker Chromium. Electron keeps its
// own webview pane, so this path is for the browser web UI and the native app only.
const hostHasCdpBrowser = useHostFeature(normalizedServerId, "cdpBrowser");
const cdpBrowserEnabled = hostHasCdpBrowser && !getIsElectron();
useCdpTabsSync({
  client,
  serverId: normalizedServerId,
  workspaceId: normalizedWorkspaceId,
  enabled: cdpBrowserEnabled,
});
const openCdpBrowserTab = useCallback(
  (url?: string) => {
    if (!client || !normalizedServerId || !normalizedWorkspaceId) return;
    openCdpTab({
      client,
      serverId: normalizedServerId,
      workspaceId: normalizedWorkspaceId,
      url,
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : String(error));
    });
  },
  [client, normalizedServerId, normalizedWorkspaceId, toast],
);
```

`toast` is the screen's existing `const toast = useToast();` (line 1064); `toast.error(message)` is how the screen reports a failure. Place this block below that line.

`handleCreateBrowserTab` (line 1857) becomes:

```ts
const handleCreateBrowserTab = useCallback(
  (input?: { paneId?: string }) => {
    if (!persistenceKey) {
      return;
    }
    if (cdpBrowserEnabled) {
      openCdpBrowserTab();
      return;
    }
    if (!getIsElectron()) {
      return;
    }
    const { browserId } = createWorkspaceBrowser();
    openWorkspaceTabFocused(
      persistenceKey,
      { kind: "browser", browserId },
      paneLocalPlacement(input?.paneId),
    );
  },
  [cdpBrowserEnabled, openCdpBrowserTab, openWorkspaceTabFocused, persistenceKey],
);
```

In `launchWorkspaceTab`, the last two lines (`const { browserId } = createWorkspaceBrowser(); openTarget({ kind: "browser", browserId });`) become:

```ts
if (cdpBrowserEnabled) {
  openCdpBrowserTab();
  return;
}
const { browserId } = createWorkspaceBrowser();
openTarget({ kind: "browser", browserId });
```

and `cdpBrowserEnabled, openCdpBrowserTab` join its dependency list.

`handleOpenUrlInBrowserTab` (line 1918): after the `!persistenceKey` part of the guard, before the Electron check:

```ts
if (cdpBrowserEnabled) {
  openCdpBrowserTab(url);
  return;
}
```

Split the existing guard so `!persistenceKey` returns first and `!getIsElectron()` returns after this block; add the two names to the dependency list.

In the close handler (line 1435), inside `if (input.target?.kind === "browser") {`, first line:

```ts
if (cdpBrowserEnabled) {
  // Closing the pane tab closes its target. A tab the daemon already lost answers
  // browser_tab_not_found, which needs no handling here.
  void client?.closeCdpBrowserTab(browserId).catch(() => {});
}
```

and add `cdpBrowserEnabled, client` to that callback's dependency list. The three Electron cleanup lines below it stay; they are no-ops off Electron.

`showCreateBrowserTab` (line 3327):

```ts
const showCreateBrowserTab = getIsElectron() || cdpBrowserEnabled;
```

If `cdpBrowserEnabled` is declared below a hook that now reads it, move the block from this step up to just after `const client = useHostRuntimeClient(normalizedServerId);` (line 1103); `useHostFeature` has no other dependency.

- [ ] **Step 3: Typecheck, lint, commit**

```bash
cd /workspace/utils/paseo/packages/app
flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded
cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npm run lint
```

Expected: both exit 0. `workspace-screen.tsx` has functions near the complexity limit; if lint reports complexity on a callback this task touched, move the new branch into a small helper function above the component, not a disable comment.

Message: `feat(fork): open, show and close daemon browser tabs in the workspace`

## Task 18: Manual test, docs and the Phase 3 checkpoint

**Files:**

- Modify: `docs/superpowers/specs/2026-11-10-web-browser-pane-design.md` (the seven deviations)
- Modify: `docs/architecture.md` (one paragraph where browser tools are described, or the WebSocket binary frame list if it has one)

**Interfaces:**

- Consumes: everything.
- Produces: evidence that the feature works end to end, in the task report.

- [ ] **Step 1: Amend the spec**

Apply D1 to D7 from the top of this plan to the spec, each in the section that owns it: Decisions table (Automation row for D1, a note under Pixels for D3), Components (the package heading for D1; `CdpTabContents` dialog row for D7), Protocol (D4, D5), Data flow "Opening" (D2), Configuration (D6). Rewrite the sentence that is now wrong; do not append a "changes" section.

- [ ] **Step 2: Document the frame opcode and the host**

`grep -n "0x40\|binary frame\|browser" docs/architecture.md | head -20`. Where the doc lists binary frame opcodes, add `0x50` (browser view frame). Where it describes browser tools hosts, add that the daemon is a host when `PASEO_BROWSER_CDP_URL` is set, and link `docs/docker.md#browser`. If the doc has neither, add nothing: `docs/docker.md` already owns the subject.

- [ ] **Step 3: Start a dev daemon against the Docker Chromium**

Never the daemon on port 6767. The dev daemon uses the checkout's `.dev/paseo-home`.

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npm run build:server
curl -s http://127.0.0.1:9222/json/version | head -c 120    # expect: Chrome's version JSON
PASEO_BROWSER_CDP_URL=http://127.0.0.1:9222 PASEO_BROWSER_TOOLS_ENABLED=true npm run dev
```

In a second shell, `npm run dev:app` and open the web UI it prints. Read `docs/development.md` for the dev ports. Run each of these as a background command and stop both when the test ends.

- [ ] **Step 4: Run the checks and record each result**

Record pass or fail and one line of evidence for each. Open only `about:blank` or `https://example.com/`; this is the user's logged-in browser.

1. The workspace's new-tab menu offers a browser tab. Opening one shows a live frame of `about:blank`, and a new Chromium window appears on the noVNC desktop without taking focus.
2. Type `example.com` in the URL field and press Enter: the page loads, the URL field shows `https://example.com/`, the tab label shows the title.
3. Click the "More information" link: the page navigates. Back and forward work and enable or disable with history. Reload works.
4. Scroll with the wheel. Click the frame, press Tab, and see focus move to the page's link. Ctrl/Cmd+L focuses the pane's URL field.
5. In a narrow browser window (about 390 px wide) the page reflows to the pane's width after the first click in it.
6. Start an agent in the workspace with browser tools on and ask it to open `https://example.com/` and take a snapshot. A second pane tab appears in the background, "Agent is using this tab" shows while it works and clears about 3 s after.
7. `browser_list_tabs` from the agent lists only the daemon's tabs, not the user's other tabs.
8. Close the agent's window from noVNC: its pane shows "Tab closed". Reopen opens `https://example.com/` in a new tab and removes the dead one.
9. Close a pane tab from the workspace: its Chromium window closes; every other window stays.
10. Hide the pane (switch tabs): `Page.stopScreencast` follows (daemon log at debug, or the Chromium window stops being captured). Show it again: a frame appears at once.
11. From a phone browser on the same instance, or the relay: the frame shows, a tap clicks, a drag scrolls.
12. Stop the dev daemon and start it without `PASEO_BROWSER_CDP_URL`: the pane shows "Browser is desktop-only" and the new-tab menu has no browser entry.

The native app (check 11 on iOS or Android) needs a device build; if none is available in this environment, say so in the report and leave it for the user.

- [ ] **Step 5: Clean up**

```bash
curl -s http://127.0.0.1:9222/json/list | grep -c '"type": "page"'
```

Close any tab the test opened that is still there, through the pane, not through CDP by hand. Stop the dev daemon and the dev app. Do not delete `.dev/paseo-home`.

- [ ] **Step 6: Verify and commit**

Run every new server test file in one process, then commit the docs.

```bash
cd /workspace/utils/paseo/packages/server
flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/browser-tools src/server/browser-automation \
  --exclude "**/*.e2e.test.ts" --no-file-parallelism --maxWorkers=1 --bail=1
```

Message: `docs(fork): web browser pane, as built`

**Phase 3 checkpoint:** checks 1 to 12 recorded; the server, protocol, client and app typecheck; lint is clean; nothing is pushed or tagged. Report to the user and ask before merging to `main` or deploying.

---

## Self-review

Spec coverage, by spec section:

| Spec                                                                             | Task                                                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Daemon browser host over raw CDP                                                 | 3, 4, 6, 7                                                                               |
| Ownership: only registry targets                                                 | 5, 7 (list, close, destroyed, popup tests), 9                                            |
| Engine shared by desktop and server                                              | 1, 2 (D1)                                                                                |
| Host routing: CDP host takes `new_tab`, tabs keep their host, `list_tabs` merges | 7 (broker tests; merge is unchanged code)                                                |
| Screencast over binary frames                                                    | 10 (frame), 11 (hub), 12 (delivery)                                                      |
| Limits: 10 fps, q60, 1920x1080, DPR 2, hover 30 Hz                               | 11 (`SCREENCAST_PARAMS`, ack pacing), 7 (`clampViewport`), 14 and 16 (hover throttle)    |
| Viewport: last interacting client wins; agent resize holds                       | 7 (`setViewport`, `viewportOwner`), 12 (input claims; subscribe claims only when unset)  |
| Concurrency badge, 3 s                                                           | 7 (`AGENT_ACTIVITY_MS`), 14 (store), 15 (badge)                                          |
| Permissions                                                                      | 10                                                                                       |
| Protocol, capability gate                                                        | 10, 12, 13                                                                               |
| Pane on web and native, toolbar                                                  | 15, 16, 17                                                                               |
| Tab open and close from the UI, layout add and reconcile                         | 14, 17                                                                                   |
| Input: mouse, wheel, touch, keyboard, paste, Ctrl/Cmd+L                          | 12 (`view-input`), 16                                                                    |
| Tab closed with Reopen; unreachable with Retry; page not responding              | 12 (`browser.cdp.view.update`), 14 (`reopenCdpTab`), 15                                  |
| Errors caught in the daemon process                                              | 3 (`guard`, socket error listener), 6 (`detached`), 7 (`guard`, `handleRequest`), 11, 12 |
| Reconnect 1 s to 30 s                                                            | 7                                                                                        |
| Configuration and docs                                                           | 8, 18                                                                                    |
| Tests: unit list in the spec                                                     | 5, 7, 10, 11, 14                                                                         |
| Integration against a real Chromium                                              | 9                                                                                        |
| Manual test                                                                      | 18                                                                                       |

Names used across tasks, checked against their definitions: `CdpConnection.send/on/onClose/closed/close` (3; used in 4, 6, 7, 11, 12); `CdpEndpoint.listTargets/connectBrowser/connectTarget` (4; 7, 9); `CdpTabRegistry.load/list/get/findByTarget/add/remove/setLastUrl/reconcile/adoptPopup/flush` (5; 7); `CdpTab.attach/connection/dispose` (6; 7, 12); `CdpBrowserService.attachedTab/workspaceOf/setViewport/viewportOwner/screencast/subscribe/onAttached/retryNow` (7, 11; 12); `ScreencastHub.watch/rebind/drop/viewerCount` (11; 7, 12); `encodeBrowserViewFrame/decodeBrowserViewFrame/BROWSER_VIEW_OPCODE` (10; 12, 13, 15); client methods (13; 14, 15, 17); `fitFrame/toPagePoint/viewportForPane/viewStatusForError` (14; 15, 16); `CdpInputLayerProps` (15, in `input-layer-types.ts`; 16).

Known soft spots, for the reviewer:

- `workspace-screen.tsx` line numbers are from bc045344c and will drift; each edit names the function it changes.
- The pane has no component test. Its logic is in `view-model.ts`, `tabs-store.ts` and `touch-gesture.ts`, which are tested; the rest is covered by Task 18.
