# End-to-end testing in the stack: design

Date: 2026-11-13. Fork: allrested/paseo. Status: part 1 approved by the user on 2026-11-13
("Yes LGTM") and built; parts 2 to 4 approved in outline, waiting on a check of the VM host.

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

### Open

- Whether a redroid container boots and answers on this host. Not tried yet: loading the module
  needs sudo, and the SSH tool's approval gate refused it twice on 2026-11-13.
- Where the APK comes from. Building a Flutter APK on arm64 Linux is not supported by the Android
  build tools, so it likely comes from CI.

The full design for these parts is written after the host check.
