# End-to-end testing in the stack: design

Date: 2026-11-13. Fork: allrested/paseo. Status: part 1 approved by the user on 2026-11-13
("Yes LGTM") and built; parts 2 to 4 designed below, waiting for the user's approval.

## Goal

The user wants agents to test applications end to end inside Paseo: web applications in a
browser, Android applications on an Android device.

For web, agents can already drive the stack's Chromium by hand. What does not work is a repo's own
scripted suite: `flavours-pos-webapp` has a Playwright suite that cannot launch a browser in the
agent container. For Android nothing exists.

## Parts, in order

1. A repo's Playwright suite runs in the agent container.
2. An Android device in the stack that an agent can install an APK on, read and operate.
3. A pane to watch and operate that device, also in the installed app.
4. The Flutter app's Maestro flows run on that device.

## Part 1: Playwright suites in the agent container

### Approaches

- **System libraries in the agent image; each repo fetches its own browser.** Picked. It is the
  setup CI uses, so a suite runs unchanged, and a repo that upgrades Playwright fetches the build
  it needs.
- **A shared browser server in a sidecar.** Rejected: the server must match each repo's Playwright
  version exactly, so one repo's upgrade breaks the others.
- **Point the suite at the stack's Chromium over CDP.** Rejected: tried on 2026-11-13, it stalls
  (that browser cannot reach the container's localhost), and it needs changes in the tests.

### Design

`docker/Dockerfile.agents` installs Playwright's own library list for Debian 12 (`nativeDeps.js`,
`chromium`) and the fonts a page needs for text and emoji. No browser is in the image: a repo runs
`npx playwright install chromium`, which lands in the home volume and needs no root. Playwright MCP
is unchanged and keeps driving the `browser` service.

### Tests

`scripts/vpn-overlay.test.mjs` pins the library list and that no command in the Dockerfile
installs a browser. The image itself is built by the Docker workflow. That a suite launches is
checked after deploy, by running `flavours-pos-webapp`'s suite in the container.

## Parts 2 to 4: Android device

### Approaches

- **Android in a container on the VM (redroid).** Picked by the user. Native speed on the arm64
  host, about 2 to 4 GB of memory. It needs the `binder_linux` kernel module loaded on the host
  and a privileged container, which can reach the host and sits beside a logged-in browser.
- **The standard emulator on another machine.** Rejected: the Oracle VM has no virtualization
  (`/dev/kvm` is absent), so it means a second machine.
- **A real phone or a cloud device service.** Rejected: a paid service, or a phone that is always
  plugged in.

### Known so far (host checked read-only, 2026-11-13)

Kernel `7.0.0-1013-oracle` ships `binder_linux` with binderfs as modules, not loaded. 4 KB pages.
Neoverse-N1, 32-bit and 64-bit modes. 8 cores, 39 GB of memory free, 33 GB of disk free. The
user's Oracle trial ends 2026-12-10 and a cost guard shrinks the VM to 2 cores and 12 GB the day
before.

### Host check (2026-11-13, with the user's go-ahead)

`sudo modprobe binder_linux devices="binder,hwbinder,vndbinder"` loaded the module; it is not
persisted, so a reboot unloads it. A throwaway container then ran and was removed:

```
docker run -d --rm --privileged --memory 4g -p 127.0.0.1:5555:5555 \
  redroid/redroid:14.0.0_64only-latest \
  androidboot.redroid_width=720 androidboot.redroid_height=1280 \
  androidboot.redroid_dpi=320 androidboot.redroid_gpu_mode=guest
```

- Android 14 (arm64-v8a) reported `sys.boot_completed=1` about 15 seconds after start.
- Idle it used about 620 MB of memory and under 3% of one core, with the launcher or Settings open.
- Over adb (`adb connect 127.0.0.1:5555`): `uiautomator dump` gave the screen as 47 nodes with
  their texts, `exec-out screencap -p` gave a 720×1280 PNG of 69 KB, `input tap` worked.
- The same tools run through `docker exec` do not work for anything that starts a Java process
  (`uiautomator` printed nothing): the Android environment comes from adbd. Everything goes
  through adb.
- The image is 2.27 GB and is still on the host.

### Decisions

| Subject   | Decision                                                                                                                               | Source                       |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Device    | Android 14 in a container (redroid, arm64 only), 720×1280 at 320 dpi, one per Paseo instance.                                          | user picked A, 2026-11-13    |
| Lifetime  | Always running. Idle it costs about 0.6 GB and almost no CPU, so nothing starts or stops it.                                           | this spec, shown to the user |
| APK       | The app's own CI builds it; an agent downloads the artifact and installs it. Nothing is built in the stack.                            | user, 2026-11-13             |
| Control   | Everything goes through adb. Agents get tools over it, and also have the `adb` and `maestro` commands.                                 | this spec                    |
| Watching  | A pane shows the device as pictures and takes touches, built like the office's streamed 3D so it works in the installed app.           | user agreed, 2026-11-13      |
| Packaging | A built-in plugin, `android`, plus one compose service and three packages in the agent image. Off unless `PASEO_ANDROID_ADB` is set.   | this spec                    |
| Play      | No Google Play services on the device. The app's CI emulator has them; whether the app needs them is the first thing the build checks. | this spec; risk              |

### What the user sees

- In a workspace, an **Android** panel (and a screen from the sidebar) shows the device. A tap is a
  tap, a drag is a swipe, and three buttons give Back, Home and Recents. A field sends text.
- An agent asked to test the Android app downloads the APK, installs it, opens it, reads the screen
  as a list of elements, taps and types, and can run the repo's Maestro flows. The user watches it
  happen in the panel.
- With no device configured the panel and the tools are absent; nothing else changes.

### Docker

- **Service `android`** in `docker-compose.yml` only. The VPN stack routes its paseo container
  through the VPN, and whether the device can be reached there is untried; a stack that borrows
  another stack's browser (`docker-compose.agent.yml`) gets no device either. On those the plugin
  is inert. Its settings:
  `redroid/redroid:14.0.0_64only-latest`, privileged, `mem_limit: 4g`, a named volume on `/data`,
  the boot arguments from the host check, `restart: unless-stopped`, and a healthcheck on
  `getprop sys.boot_completed`.
- **Where the daemon runs.** The plugin calls `adb` from the daemon process, which in compose is
  the agent image. A daemon on the plain base image, or anywhere `adb` is not on `PATH`, has the
  feature off.
- **Reach.** adb on the device has no authentication. It is published nowhere: a socat sidecar with
  `network_mode: service:paseo` puts it on the paseo container's loopback, port 5555, the pattern
  `paseo-cdp` uses for Chromium. The paseo service gets `PASEO_ANDROID_ADB=127.0.0.1:5555`.
- **Host.** `binder_linux` must be loaded before the service starts:
  `/etc/modules-load.d/redroid.conf` with `binder_linux` and `/etc/modprobe.d/redroid.conf` with
  `options binder_linux devices=binder,hwbinder,vndbinder`. `docs/docker.md` says so, and says a
  host without the module leaves the service unhealthy and the feature off.
- **Agent image** (`Dockerfile.agents`): `adb` (Debian's package), a Java 17 runtime, and the
  Maestro CLI at a pinned version.

### The plugin (`plugins/android/`)

**Server.**

- `adb.ts`: runs the `adb` binary against the configured serial. `connect`, `shell`,
  `execOut` (binary), `install`. Every call has a timeout and reconnects once on "device offline".
- `snapshot.ts` (pure): turns a `uiautomator dump` into a list of elements, each with a ref
  (`@a1`, `@a2`, ...), its text, content description, resource id, bounds, and whether it is
  clickable, focused or scrollable. Elements with no text, description or id and no action are
  left out.
- Agent tools, added to interactive sessions through the `agent.open.before` hook as the office
  adds its tools, behind the plugin's own host setting, "Agent tools", on by default while a device is configured.
  Interactive sessions only, as with the office: nine tool definitions are not added to helper
  agents. The switch is in the panel, for a host that would rather not spend the tokens:

| Tool                 | Does                                                                   |
| -------------------- | ---------------------------------------------------------------------- |
| `android_snapshot`   | The current app and activity, and the screen's elements with refs.     |
| `android_tap`        | Taps an element by ref, or a point.                                    |
| `android_type`       | Types text into the focused field.                                     |
| `android_key`        | Back, home, enter, recents, or a keycode.                              |
| `android_swipe`      | Swipes between two points, or up, down, left or right from the middle. |
| `android_screenshot` | Saves a PNG under the workspace and returns its path.                  |
| `android_install`    | Installs an APK file from the workspace or the home folder.            |
| `android_launch`     | Starts an installed package, or stops it.                              |
| `android_logs`       | The last lines of logcat, for one package when named.                  |

A ref is good until the next snapshot. A tap on a stale ref is refused with "take a new
snapshot".

- A picture stream for the panel: a subscription that sends a PNG when the screen changed, at most
  twice a second, only while someone watches; an input RPC for taps, swipes, keys and text. The
  pacing and the silence rule are the office stream's. Two viewers at most per device. Input from
  two viewers, or from a viewer and an agent, is not put in order: the device takes each as it
  arrives.
- When `PASEO_ANDROID_ADB` is set and the device does not answer, the panel says "The Android
  device is unreachable" with a Retry, and each tool answers with the same words. That is what a
  host without the kernel module looks like. With the variable unset there is no panel and no tool.

**Client.** One surface for the panel and the screen: the latest picture in an `Image`, the
responder for touches, the three buttons and the text field. Built from React Native primitives
only, like the office's stream view. Plugins cannot import one another, so the small stream
modules are copied from the office, not shared.

### Maestro (part 4)

The Maestro CLI in the agent image runs a repo's flows against the device:
`maestro --device 127.0.0.1:5555 test <flow>`. Agents run it as a command. Since 2026-11-14 the
user can also run a workspace's flows from the Android panel:
[the Maestro panel design](2026-11-14-android-maestro-panel-design.md).

### Constraints

- A privileged container can reach the host. It runs the stock redroid image and nothing else, and
  its adb is reachable only from this stack's paseo container.
- The device is shared by every agent on the instance, like the browser. No lock.
- The store app cannot be changed: the panel is plugin client code.
- Daemon-process code must not throw out of a handler or a timer.
- After 2026-12-09 the VM may have 2 cores: a test run and a build at once will be slow.

### Goals, non-goals, anti-goals

Goals: an agent tests an Android app end to end without a phone; the user watches and can take
over; the Flutter app's Maestro flows run.

Non-goals: iOS; more than one device; Google Play services; video; building the APK in the stack;
pinch and multi-touch; resetting the device between tests (an agent clears an app's data with adb).

Anti-goals: adb reachable from another stack or the internet; a device that keeps a core busy
while nobody tests; a broken stack on a host without the kernel module.

### Risks

- **The app may need Google Play services.** CI tests it on a Play image. No APK can be downloaded
  today (the app's CI has no artifacts and its releases carry none), so this is unverified. The
  app check is done as soon as an APK exists; if the app needs Play services, the device image
  changes to one that carries them and this spec is revised. Steps 2 and 3 do not wait for it:
  they are built and tested against the stock Android apps. Step 4 and the release do wait.
  The app's APK build (`e2e-build.yml` in `FlavoursPOS/flavours_admin_app`, GitHub Actions,
  self-hosted runners) can only be called from another workflow, and the one that calls it also
  seeds data on the live API, so the first APK needs either a small build-only workflow in that
  repo or a file from the user. The agent downloads artifacts with the `gh` login it already has.
- **Maestro on this device** was tried on 2026-11-13 with Maestro 2.12.1 and Java 17 on arm64: a
  flow that opens Settings, asserts a label, taps a row and goes back passed. The Flutter app's
  own flows are untried until an APK exists.
- **Picture size.** A PNG of a photo-heavy screen was 686 KB. Two a second over the relay is
  heavy; unchanged screens send nothing, and the builder may lower the device's resolution.

### Tests

- `snapshot.ts`: fixtures of real dumps (launcher, Settings, a Flutter screen once an APK exists).
- `adb.ts` and the tools: against a fake `adb` executable that records its arguments and answers
  from a script. Timeouts, "device offline", a failed install, a stale ref.
- The stream: with a fake device, as the office's sessions are tested.
- Client: pure functions and one mounted test, as the office's stream view has.
- `scripts/vpn-overlay.test.mjs`: the compose service is privileged, publishes no port, and the
  sidecar and the env var are present.
- By hand against a real device on the VM: boot, install an APK, snapshot, tap, a picture in the
  panel, one Maestro flow.

### Left to the builder

- File and function names; how the device volume is named; the Maestro version.
- Whether `android_screenshot` also returns the picture to providers that take images.
- The picture format and resolution, within "at most two a second, nothing while still".
- How a dev device is reached from the build container before the compose service exists.

### Order of work

1. Compose service, sidecar, host step, `adb` in the image.
2. The plugin's server: adb, snapshot, tools.
3. The panel and its picture stream.
4. Java and Maestro in the image; one flow run by hand.

The user decided on 2026-11-13 to leave the Flutter app's APK for later, so nothing here waits for
it: the device was checked with the stock Android apps only, and whether the Flutter app runs
without Google Play services is still unknown.
