# Web browser pane — design

Date: 2026-11-10. Status: approved design, updated to the build on branch `feat/web-browser-pane`
(the plan's deviations D1 to D7 are folded in). First sub-project of fork program item 7 (design
mode, computer use, mobile emulator); design mode builds on it next.

## Problem

Upstream's browser pane, its element picker and the agent `browser_*` tools work only in the Electron
desktop app. The web UI that the fork's Docker instances serve shows "Browser unavailable", and so
does the native app. The broker that routes agent browser commands
(`packages/server/src/server/browser-tools/broker.ts`) has a host only while an Electron app is
connected, so in the Docker setup agents drive the stack's Chromium through Playwright MCP or raw
CDP instead, and nobody can watch or steer that from Paseo.

The fork's compose already runs a real Chromium with CDP republished by a `browser-cdp` sidecar
(`docker/docker-compose.yml`), and other instances borrow it through `docker-compose.agent.yml`.

## Scope

In scope:

- A daemon-side browser host backed by the Docker Chromium over raw CDP, so agents' `browser_*` tools
  work with no Electron app connected.
- A live, interactive view of a tab in the browser pane of the web UI (desktop and phone browsers)
  and the native iOS/Android app, including over the relay.
- A URL toolbar (URL, back, forward, reload), tab open and close from the UI.

Out of scope: the element picker and design mode (next spec, on top of this), pinch zoom, downloads,
audio, isolated profiles, more than one Chromium per daemon, and any change to the Electron pane.

## Decisions

| Question      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Goal          | Watch, steer and agent tools on one tab: people and agents drive the same target.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Clients       | Web UI and native mobile. Electron keeps its own webview pane.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Pixels        | The daemon streams `Page.startScreencast` JPEG frames over the session WebSocket as binary frames. noVNC embedding was rejected: it shows the whole window, has its own auth and is not reachable over the relay.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Profile       | The Chromium's shared default profile, so agents reuse the user's logins. Every instance on that Chromium can see the tabs, as today.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| Packaging     | Fork core (server, protocol, app), gated by `PASEO_BROWSER_CDP_URL`. The plugin API cannot register a browser host or carry binary streams. With the variable unset, behaviour is upstream's.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Automation    | The Electron CDP automation engine moves into the server package, `packages/server/src/server/browser-automation/`, exported as `@getpaseo/server/browser-automation/*` and used by desktop and server. Desktop already depends on the server package. A new workspace package would touch the workspace list, the build order, the Docker pack list and version sync. Copying would stop upstream fixes; importing desktop from server is circular.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| CDP client    | Raw CDP only, never Playwright attach (it wedges the tab it holds). The host name is resolved on every connect and the request carries an IP `Host` header, because Chrome rejects any other `Host` and the IP churns.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Ownership     | The daemon lists, drives and closes only targets in its own registry. It never touches the user's other tabs, other instances' tabs or Postman.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| Host routing  | When the CDP host is configured it always takes `new_tab`. Existing tabs keep their host. `list_tabs` keeps merging hosts.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Viewport size | The last client to interact with or resize its pane wins, through `Emulation.setDeviceMetricsOverride` with `mobile: false`. A pane claims its size without input when it becomes visible and when its size changes, debounced by 150 ms: a tap sends move, down and up within milliseconds, and the daemon drops a press aimed at a frame of the old size, so a size that travelled only with input lost the first tap after every rotation or split change. `mobile: true` gave a page scale of 0.398 on a 390 px viewport; a narrow width alone gives the responsive layout. An agent `resize` holds while the pane shows "Agent is using this tab"; after that, the next pane resize or input claims the size. A resize of the tab's Chromium window makes frames report the window's view size instead of the override; the daemon then applies the size it set again, at most once a second, and gives up with one warning after three tries that did not take. |
| Concurrency   | No lock between people and agents. The pane shows "Agent is using this tab" for 3 s after each agent command on it.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Permissions   | View subscribe and tab list need `workspace.read`. Input, navigate, open and close need `workspace.write`, as `browser.automation.execute` does.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Limits        | At most 10 frames per second, JPEG quality 60, frame size the pane's size times device pixel ratio (capped at 2), at most 1920×1080. Screencast runs only while someone watches.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

## Components

### Engine: `packages/server/src/server/browser-automation/`

Moved from `packages/desktop/src/features/browser-automation/`: `service.ts`, `snapshot-engine.ts`,
`aria-snapshot-script.ts`, `actionability.ts`, `trusted-input.ts`, `dialog-handling.ts`,
`cdp-session-queue.ts` and their tests. Desktop imports them as
`@getpaseo/server/browser-automation/*`; the Electron-only files (`ipc.ts` and the webview glue)
stay in desktop. Each moved file stayed byte-identical in the move commit so rebases follow the
rename, and the import-path edits are a separate commit.

### Server: `packages/server/src/server/browser-tools/cdp/`

- `CdpEndpoint`: resolves `PASEO_BROWSER_CDP_URL`'s host name on every connect, reads
  `/json/version` and `/json/list` with an IP `Host` header, opens one WebSocket per target and one
  for the browser target (`Target.*` events). A command that times out closes its socket; the next
  command opens a fresh one, because a reused socket reads stale frames.
- `CdpTabRegistry`: `browserId → { targetId, workspaceId, lastUrl }`, persisted as one JSON file under
  `$PASEO_HOME`, written atomically as `docs/data-model.md` describes. At start it drops entries
  whose target is gone from `/json/list`. A target whose `openerId` is a registered target joins
  that target's workspace (popups).
- `CdpTab`: implements the engine's `TabContents`:

  | `TabContents`         | CDP                                                            |
  | --------------------- | -------------------------------------------------------------- |
  | `executeJavaScript`   | `Runtime.evaluate` with `awaitPromise`, `returnByValue`        |
  | `loadURL`             | `Page.navigate`, then wait for `Page.loadEventFired`           |
  | `goBack`/`goForward`  | `Page.getNavigationHistory` + `Page.navigateToHistoryEntry`    |
  | `reload`              | `Page.reload`                                                  |
  | `captureFrame`        | `Page.captureScreenshot` (PNG)                                 |
  | `withFrameProduction` | pass-through                                                   |
  | `sendInputEvent`      | `Input.dispatchKeyEvent`                                       |
  | `insertText`          | `Input.insertText`                                             |
  | `getConsoleMessages`  | buffered `Runtime.consoleAPICalled`                            |
  | `captureDialogs`      | `Page.javascriptDialogOpening` + `Page.handleJavaScriptDialog` |
  | `sendDebugCommand`    | pass-through to the target session                             |

  Dialogs are answered through CDP alone: `CdpTab` answers every `Page.javascriptDialogOpening`
  with the engine's policy (`dialogAcceptValue`) and records it. The Electron prompt shim is not
  ported; it exists because Electron's webview cannot answer `prompt`.

- `CdpBrowserService`: a `BrowserHostClient` with host kind `docker-chromium` that runs
  `executeAutomationCommand` from the engine against a `BrowserRegistry` built on
  `CdpTabRegistry`, and also serves the pane's view. It registers with the broker once CDP answers
  and unregisters when it stops answering.
- `ScreencastHub`: one screencast per watched tab, shared by every viewer of that tab. It starts on
  the first subscriber and stops on the last.
- Broker change: a host flagged as the preferred new-tab host takes `new_tab`; otherwise the
  most-recently-registered rule stays.

### Protocol

Dotted RPCs per `docs/rpc-namespacing.md`, all fields optional where they extend existing types:

- `browser.cdp.tab.open|close.request` / `.response`.
- `browser.cdp.tabs.subscribe.request`: one owned subscription for the tab list and tab events.
  The response is the workspace's tab list; `browser.cdp.tabs.update` carries `opened`, `closed`,
  `state` (URL, title, loading, back/forward availability, `agentActiveUntil`) and `host` events.
  The repo has no broadcast-to-workspace path, and an owned subscription replays its snapshot on
  reconnect, which is the reconcile when a workspace opens.
- `browser.cdp.view.subscribe.request` (owned subscription; carries the pane's pixel size);
  `browser.cdp.view.update` reports a closed tab, a lost host and a page that does not respond.
- `browser.cdp.view.input.request` (mouse, wheel, key, text) has no response: input is a stream,
  as `diff.unsubscribe.request` is a request with no reply.
- `browser.cdp.view.navigate.request` (URL, back, forward, reload).
- A binary frame kind next to the terminal and file-transfer frames in `shared/binary-frames/`: JPEG
  bytes plus viewport metadata (CSS size, page scale, scroll offsets, frame sequence), addressed to the
  subscription.
- Capability: `server_info.features.cdpBrowser`. The app gates the pane on it once.

### App

- `packages/app/src/desktop/browser/pane/index.web.tsx` and `index.tsx` (native) render the CDP pane
  when the feature is on, and keep today's "unavailable" text otherwise.
- The pane shows the latest frame scaled to fit, maps pointer and touch to page CSS pixels, and has
  the toolbar. "New browser tab" in the workspace opens a CDP tab.
- The app adds a browser tab to the workspace layout on the `opened` tabs event, as the Electron
  handler does for agent tabs, and reconciles the layout with the subscription's snapshot when a
  workspace opens.

## Data flow

Opening: UI or agent `new_tab` → `Target.createTarget` with `newWindow: true, background: true` →
registry entry → `opened` tabs event to clients that have the workspace. Each tab gets its own
window: on Chrome 154 a background tab is hidden, produced no screencast frames in 3 s, and
`requestAnimationFrame` did not fire, which the engine's paint wait needs; a background window is
visible and produced 11 frames in 3 s. Each pane tab is one more window on the noVNC desktop. A
window that another window covers completely stops rendering, so its pane gets no frames.

Watching: a visible pane subscribes; hiding the pane or backgrounding the app unsubscribes. The
subscriber gets the cached last frame at once, or one `Page.captureScreenshot` when none is cached.
Chromium sends a frame only on repaint. The hub fans each frame out; a viewer whose socket is backed
up keeps only the newest frame and gets it when it drains. The hub delays `Page.screencastFrameAck`
to hold the 10 fps cap.

Input:

- Mouse: `Input.dispatchMouseEvent`; hover moves throttled to about 30 Hz.
- Wheel: mouse-wheel events.
- Touch: tap is a click; drag is a scroll. No pinch zoom.
- Keyboard on web: a focused pane sends every key to the page except `Ctrl/Cmd+L`, which focuses the
  URL field.
- Keyboard on native: a hidden `TextInput`; text goes through `Input.insertText`, Enter and Backspace
  as key events.
- Paste: `Input.insertText`.
- Any input claims the viewport size for that client, as does a pane resize (see Viewport size).

Closing: closing a pane tab closes its target. A target destroyed elsewhere (noVNC, `window.close`,
Chromium restart) drops from the registry, and its pane shows "Tab closed" with Reopen, which opens
`lastUrl` in a new tab of the same workspace.

## Errors and edge cases

- Every CDP call and event handler catches its errors. This code runs in the daemon process, where an
  unhandled rejection or uncaught exception stops every agent.
- CDP unreachable: the host stays unregistered, so agents get the broker's existing "no browser host"
  error. The pane shows "Docker browser unreachable" with Retry. The daemon reconnects with backoff
  from 1 s to 30 s.
- Command timeout: the agent gets a retryable error; the pane shows "Page not responding".
- Chromium restart: all targets drop; panes show "Tab closed" with Reopen.
- Two instances on one Chromium: each daemon sees only its own registry's targets.
- An Electron app connected to a Docker daemon keeps its own pane and its own tabs; agents' new tabs
  go to Docker.

## Configuration

Both compose files set `PASEO_BROWSER_CDP_URL=http://127.0.0.1:9222`, the existing loopback
`paseo-cdp` sidecar. `PASEO_BROWSER_TOOLS_ENABLED` is the default for browser tools, and compose sets
it to `true`; a saved setting still wins. `CdpEndpoint` resolves the host name on every connect and
builds WebSocket URLs from its own origin. `docs/docker.md` names the variables and the ownership
rule.

## Testing

- Unit, against an in-process fake Chromium: registry reconcile and popup adoption, hub fan-out and
  newest-frame backpressure, ack pacing, broker new-tab routing, pane coordinate mapping, frame
  codec round trip.
- Integration: one hand-run e2e file (`cdp-host.local.e2e.test.ts`) runs `CdpBrowserService` and
  `ScreencastHub` against a real Chromium and touches only the tabs it opens: open, navigate,
  snapshot, click by ref, screenshot, a frame arrives, close.
- The moved engine's existing tests run from `packages/server/src/server/browser-automation/`.
- Manual, on a dev daemon pointed at the Docker Chromium: open a tab from the web UI, watch an agent
  use `browser_*` in it, steer it from a phone over the relay, close it from noVNC and see "Tab
  closed".
