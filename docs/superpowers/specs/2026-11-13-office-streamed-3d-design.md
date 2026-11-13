# Office 3D in the installed app (streamed) design

Date: 2026-11-13. Fork: allrested/paseo. Status: draft, waiting for the user's approval.
Builds on [the agent office](2026-11-11-agent-office-design.md).

## Goal

The Office shows its 3D view in the installed Paseo app on Android and iPhone.

The user opens Paseo on a phone only through the installed app, never a phone browser. That app
is upstream's store build: the fork publishes no mobile build. The store app gets the office
because plugin code travels from the daemon, but plugin code there can use only React Native
views. It has no WebGL and no WebView, so it shows the structure view. The office spec's "the
owner does not use the native app" is no longer true.

## Decisions

| Subject     | Decision                                                                                                                                          | Source                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Approach    | The daemon draws the scene in its Docker Chromium and the app shows the pictures. It must work in the store app, on Android and iPhone.           | user, 2026-11-13               |
| Renderer    | The same three.js scene as the web UI, in a page of the daemon's Chromium. No second renderer.                                                    | this spec                      |
| Pictures    | JPEG, at most 8 a second while the scene changes, none while it is still.                                                                         | this spec, shown to the user   |
| Touch       | Tap selects a robot or a board. A one-finger drag pans. No pinch zoom in this version.                                                            | this spec, shown to the user   |
| Sideways    | The store app opens its side panels on a sideways swipe from anywhere. If that swipe wins over the pan, sideways pan waits for a later version.   | this spec; risk, see Touch     |
| Pacing      | The app says which picture it has shown. The daemon keeps at most two pictures unconfirmed, so a slow link gets fewer pictures.                   | this spec, after builder check |
| Stale views | A session with no word from its app for 30 seconds is closed. A third viewer is refused, not swapped in.                                          | this spec, after builder check |
| Fallback    | No Chromium, no WebGL in it, or too many viewers: the structure view, as today.                                                                   | this spec, shown to the user   |
| 3D switch   | Shown wherever 3D can be drawn, locally or streamed. Remembered per device, on by default.                                                        | follows the office spec        |
| Web         | A browser with WebGL2 keeps drawing locally. A browser without it gets the stream.                                                                | this spec                      |
| WebGL       | The Docker Chromium starts with `--ignore-gpu-blocklist`. Chrome 156 refuses WebGL on its software GL driver without it.                          | measured 2026-11-13            |
| Core change | Built-ins get a way to open a page in the daemon's Chromium that no pane and no agent sees, and to bundle a script for it. Fork delta, built-ins. | this spec                      |

## Approaches

Three ways were on the table. The user picked B.

- **A. The fork's own Android app, drawing in a WebView on the phone.** The real scene on the
  phone's GPU, and every fork app feature on the phone. It needs a build pipeline and a rebuild per
  release, and an Apple developer account for iPhone. Rejected: the store app must keep working.
- **B. The server draws, the phone shows pictures.** Works in the store app on both platforms.
  Costs server CPU for software 3D and is about 8 pictures a second. Picked.
- **C. A flat office drawn with plain views.** No server cost, works everywhere, but it is a
  second renderer and not the 3D scene. Rejected: it is not what the user asked to see.

## Measured

On this instance's Chromium (Chrome 156, arm64, Mesa llvmpipe, 8 cores), 2026-11-13:

- WebGL and WebGL2 are disabled by default. `chrome://gpu` lists the software driver as active and
  WebGL as disabled.
- With `ignore-gpu-blocklist` on, WebGL2 works: at 780×1400, about 71 frames a second with 2,000
  small triangles, 19 with 20,000, 5 with 100,000.
- Chromium came back 6 seconds after `Browser.close`, relaunched by `chromium-session`.

## What the user sees

In the installed app the Office has the 3D switch it has on the web. With 3D on, the office is
drawn as on the web: the same rooms, robots, boards, notes and paper planes, in the app's theme.

- While something moves the picture updates up to 8 times a second. A still office sends nothing.
- A tap on a robot opens its card. A tap on a board or a note opens the board sheet. Both are the
  same sheets the structure view opens.
- A drag pans. The picture follows the finger a moment late, because each step is drawn on the
  server.
- The attention strip, the workspace tab's focus on its room, and a tap in the strip moving the
  camera to a robot work as on the web.
- Before the first picture arrives the view says "Loading the 3D view...".
- When the stream cannot start or stops, the structure view shows under a "Try 3D again" banner,
  the same fallback a lost WebGL context has on the web.

Text sketch, phone:

```
┌──────────────────────────────┐
│ Office            3D [ on ]  │
│ ● Fix login needs you   ›    │  attention strip (React Native, as today)
├──────────────────────────────┤
│                              │
│      [ picture of the        │  one image, replaced as pictures arrive;
│        3D office ]           │  taps and drags go to the server
│                              │
└──────────────────────────────┘
```

## How it works

```
app (plugin client)                      daemon                          Docker Chromium
  StreamView ── office.render ──────▶ render session ── CDP ──────▶ render page
     ▲   subscription: pictures,         one per viewer             three.js + the scene
     │   selections, problems               │  8 Hz: "take a picture"   + the office state
     └── office.render.input ──────▶ pointer steps, focus ─────────▶ pointer events
```

### The render page

A page in the daemon's Chromium that is a headless office client. Its script is a new entry in the
plugin, `plugins/office/render/page.ts`, bundled for a browser. It holds:

- three.js, from the vendored build the web UI already loads;
- the scene, unchanged in what it draws: `client/scene/office-scene.web.ts` and the pure modules
  it uses (`scene-plan`, `grid`, `camera`, `picking`, `palette`, `focus`);
- the state pipeline the client runs today: the `office.state` reducer, the model, the layout and
  the scene plan.

The daemon talks to it through one global, `__officeRender`, with these calls:

| Call                               | Does                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `start({ theme, coarsePointer })`  | Builds the scene in the page's one full-size container.                                      |
| `state(message)`                   | Takes one `office.state` message (snapshot or change), as a client does.                     |
| `focus({ roomId } \| { agentId })` | `focusRoom` or `focusAgent` on the scene.                                                    |
| `pointer(steps)`                   | Dispatches pointer events on the scene's canvas: `down`, `move`, `up`, `cancel`, CSS pixels. |
| `take()`                           | Returns what happened since the last call: a picture if a frame was drawn, and the events.   |

`take()` returns `{ picture: { jpeg, width, height } | null, events: [...] }`. `jpeg` is base64
from `canvas.toDataURL("image/jpeg", 0.6)`. Events are `{ type: "agent", agentId }`,
`{ type: "board", roomId }` and `{ type: "problem", message }` (a lost context, a scene error).

The scene gets two new options, both off for the web UI:

- `preserveDrawingBuffer`, so a picture can be read after the frame that drew it;
- `onFrame()`, called after each drawn frame, so the page knows a new picture exists.

The page opens as its own window, the way pane tabs do (`newWindow: true, background: true`), so
`requestAnimationFrame` runs and the scene's own "draw only while something moves" loop is the
picture source. The occlusion flags the compose files already set keep a covered window drawing.

### The daemon side

**Offscreen pages (fork core, `packages/server/src/server/browser-tools/cdp/`).** A small service
beside `CdpBrowserService`, on the same endpoint and connection code:

- `open({ width, height, deviceScaleFactor })` creates a target on `about:blank`, sets its
  viewport, and returns a page with `evaluate(expression)`, `setViewport(...)`, `close()` and an
  `onClosed` listener.
- Its targets are in no tab registry: no `opened` event, no pane, no `browser_*` tool, no
  `list_tabs` entry. The service closes its pages when the daemon stops.
- `bundle(entryPath)` returns a browser script (IIFE) built with the daemon's esbuild, the one
  that already compiles plugin sources.
- It exists only when `PASEO_BROWSER_CDP_URL` is set. Every CDP call catches its errors, as the
  pane code does: this runs in the daemon process.

Built-ins receive it as an optional field of the second argument the daemon already passes them
(`BuiltinPluginInfo`, today `{ directory }`). Directory plugins never get it.

**Render sessions (`plugins/office/server/render/`).** One per subscriber of `office.render`:

1. Refuse when the host cannot render (no offscreen pages) or two sessions are already open.
2. Open a page at the viewer's size, evaluate three.js and the page bundle, call `start`.
3. Check WebGL2 in the page. Without it, end with the problem "The host browser has no WebGL".
4. Feed the page the office state: a snapshot first, then every change the hub broadcasts.
5. Every 125 ms call `take()`. Push a picture when there is one, and each event.
6. On input, call `pointer` or `focus`.
7. On unsubscribe, a closed page, or an error: close the page and end the subscription.

Limits and pacing:

- Two sessions per daemon. A third subscriber is refused with a problem; nothing is evicted.
- The page's CSS size is the viewer's CSS size, so pointer coordinates never need scaling. The
  device scale factor is `min(pixelRatio, 2, 1280 / longSide)`, which keeps a picture at most
  1280 device pixels on its long side. It is set with `Emulation.setDeviceMetricsOverride`, so
  the window's own size and chrome do not matter.
- JPEG quality 0.6.
- `push` resolves when a message left the daemon, not when the app has it. So each picture has a
  `seq`, the app confirms the last one it showed, and the session sends a picture only while
  fewer than two are unconfirmed. A picture drawn meanwhile replaces the one waiting.
- The subscription's abort signal ends a session when the app unsubscribes or its socket closes.
  A phone that locks or drops off the relay may do neither, so the app sends
  `office.render.input` at least every 10 seconds while the stream is on screen (a confirmation
  or an empty call), and a session that hears nothing for 30 seconds closes itself.

### Wire contract (plugin, `shared/contracts.ts`)

- `office.state` snapshot gains an optional `render: { available: boolean }`. An older client
  ignores it. It is true when the daemon has offscreen pages, read when the snapshot is made, and
  it does not change while the Office is open: a Chromium that is down at that moment or goes
  down later shows up as a session that fails to start, which is the "Try 3D again" banner.
- Subscription `office.render`. Input: `{ width, height, pixelRatio, theme, coarsePointer,
focusRoomId? }`. Messages: `{ type: "ready", streamId }`, `{ type: "picture", seq, jpeg, width,
height }`, `{ type: "select", target: "agent" | "board", id }`, `{ type: "problem", message }`.
- RPC `office.render.input`: `{ streamId, shown?: seq, steps?: PointerStep[], focus?: ...,
resize?: { width, height, pixelRatio } }`. Every field but `streamId` is optional; an empty
  call is the keep-alive.

`theme` is the scene palette's input, sent as plain values, so the page draws in the app's theme.

### The client (`plugins/office/client/`)

- `scene/stream-view.tsx`, for every platform: an `Image` showing the latest picture as a data
  URI, sized by `onLayout`. Touches go through React Native's responder: a press and release
  within a few pixels is a tap; anything else is a drag. Moves are sent at most 10 times a second,
  several steps per call. The view asks to keep the responder once a drag has started
  (`onResponderTerminationRequest` returns false). The store app's side-panel swipe runs in its
  own gesture system and may still take a sideways drag; nothing in plugin code can stop that, and
  it cannot be tried here. If it does, up-and-down pan and the attention strip's "go to this
  robot" still work, and sideways pan gets its own control in a later version.
- `office-surface.tsx` picks the view: 3D off → structure; web with WebGL2 → the local scene;
  else host `render.available` → the stream; else structure. The 3D switch shows in the last two
  cases as well.
- Selections call the handlers the local scene calls. A problem shows the structure view under
  the "Try 3D again" banner.
- The stream opens only while the Office is on screen and 3D is on, and closes when it leaves.

### Docker

- `--ignore-gpu-blocklist` joins `CHROME_CLI` in `docker-compose.yml` and
  `docker-compose.vpn.yml`.
- `docs/docker.md` says a stack that borrows another stack's browser, or keeps its own compose
  copy, needs the flag on the Chromium it uses, next to the occlusion flags it already lists.
- This instance has the setting on through `chrome://flags` since 2026-11-13; it lives in the
  Chromium profile volume.

## Constraints

- The store app cannot be changed. Everything the phone needs is plugin client code using React
  Native primitives, and wire messages an older client ignores.
- Plugin messages are JSON, so pictures are base64 strings.
- The Chromium is shared with agents' browser tools and the user's panes. A render page must never
  appear to them, and must not take the viewport or focus of their tabs.
- Code in the daemon process must not throw out of a handler or a timer.
- The office spec's rules stay: three.js is fetched on first use, never bundled into the client;
  3D off loads nothing.

## Goals, non-goals, anti-goals

Goals: the same scene in the store app on both platforms; no cost while nobody watches or nothing
moves; a clean fallback.

Non-goals: pinch zoom; smooth 60 frames a second; keeping the camera between visits to the Office;
the fork's own mobile build; streaming to the web UI when the browser has WebGL2.

Anti-goals:

- A render page that shows up as a browser tab in a workspace, or that an agent can drive.
- Rendering that keeps running after the viewer left.
- A broken or blank Office when the host has no Chromium: that host must look exactly as today.

## Tests

- Offscreen pages: against the Docker Chromium where one is reachable, else a fake CDP endpoint as
  the pane tests use. Opening adds no registry entry and emits no tabs event; `evaluate` returns a
  value; stop closes every page.
- Render session, with a fake page: refuses a third session; sends the snapshot before changes;
  pushes a picture only when `take()` has one; forwards pointer steps and focus; closes the page on
  unsubscribe, on a page that closed, and on an evaluate error; reports "no WebGL".
- Render page: its state pipeline produces the plan the client produces for the same messages
  (pure, no browser).
- Client: the view choice for each case in `office-surface`; tap against drag; move throttling;
  the stream opens and closes with visibility. Pure functions and view tests, as the office has.
- One run by hand against this instance's Chromium: open a session, save a picture, look at it;
  tap a robot's pixel and get its id. The builder can do this: the container reaches the Chromium
  at `PASEO_BROWSER_CDP_URL` (`http://127.0.0.1:9222`), WebGL is on in it since 2026-11-13, and
  the user allowed opening and closing windows in it. Nobody else uses this instance's Chromium.
- The store app itself cannot be run here. The user checks the phone after deploy.

## Left to the builder

- File and function names inside the folders named above.
- How `bundle` is cached, and whether the page bundle is built once per daemon start or per
  session.
- The exact tap radius and drag threshold, and how pointer steps are batched.
- Whether `take()` is skipped while a picture is still being pushed, or its result dropped.
- The docs to update: `docs/plugins.md` (the office section), `docs/docker.md`, and the office
  spec's "Native app" row and "Not in this version" list.

## Order of work

1. Offscreen pages and the built-in hand-off, with tests.
2. The render page and the two scene options; a picture saved from this instance's Chromium.
3. Render sessions and the wire contract.
4. The stream view and the view choice.
5. Docker flag and docs.
