# Shared browser: keep Chromium and Postman reachable

Date: 2026-10-01
Status: implemented

## Problem

On 2026-10-01 `mdaq-browser.mtapp.dev` returned Traefik's `404 page not found`
for hours, and every agent lost CDP. Nothing crashed. The chain was:

1. Chromium gets `--remote-debugging-port=9222` only from the one-shot desktop
   autostart line `wrapped-chromium ${CHROME_CLI}`. Nothing relaunches it
   (`RESTART_APP` is unset, so the base image's watchdog sleeps forever).
2. The autostart Chromium exited cleanly at 03:25:57 UTC. Who closed it is not
   known: a window close in the desktop, a root shell open at the time, and a
   CDP client are all possible.
3. Every other launch path — the desktop menu's "Chromium" entry,
   `chromium.desktop`, `xdg-open` — runs `/usr/bin/chromium` without
   `CHROME_CLI`. The Chromium reopened from the menu had no debug port.
4. The browser container's only healthcheck was `curl -sf
http://127.0.0.1:9222/json/version`. It failed from then on, so Docker
   marked the container unhealthy.
5. Traefik's Docker provider drops every container whose health is not
   `healthy`, so the desktop's public route disappeared while noVNC behind it
   still served. That locked the operator out of the desktop, the one place the
   browser could be relaunched from.

`tatsuya-browser` runs byte-identical config and survived only because nobody
had used its desktop. Every instance has the same latent fault.

Postman, added to the same image a day earlier, was broken separately:

- Postman 12 sets `remote-debugging-port=0` itself at startup, overriding the
  `--remote-debugging-port=9225` it is launched with. It listens on a random
  port recorded in `DevToolsActivePort`, which `wrapped-postman` deleted, so
  the fixed `postman-cdp` forward never reached it, in any instance.
- Sign-in opens the system browser, and the `postman://` callback had no
  working handler: the image shipped `postman.desktop`, while the app registers
  `Postman.desktop`, with no `MimeType` and no `%U`. To the user, opening
  Postman "just spawned Chrome".
- `/opt/Postman/Postman` re-joins its arguments into one string for
  `system()`, so even a working handler would cut the callback URL at its
  first `&`.
- Root shells (`docker exec`) left root-owned directories in mdaq's profile,
  and Postman exits at once when it cannot write its own config directory. The
  respawn loop had relaunched it roughly every 5 seconds since the deploy.
- `30-postman-session` grepped for `wrapped-postman` but inserted
  `postman-session`, so every container start added another Postman loop.

## Goal

An agent can always drive Chromium and Postman over CDP, and a human can always
reach the desktop, whatever happens to either application:

1. A closed or crashed Chromium comes back, with CDP, without a restart.
2. Every Chromium launch, however it is started, has the debug port.
3. Losing CDP never removes the desktop's public route.
4. Postman's CDP is reachable on the documented fixed port.
5. Postman works without signing in, and sign-in works when wanted.

## Design

### Chromium

- `/etc/chromium.d/zz-paseo-cdp` appends `CHROME_CLI` to `CHROMIUM_FLAGS`.
  Debian's `/usr/bin/chromium` sources every file in that directory on every
  launch, so the menu, `chromium.desktop` and `xdg-open` launches all get the
  port. The autostart still passes it; identical repeated flags are harmless.
- `chromium-session` replaces the autostart's browser line. It relaunches
  Chromium five seconds after it exits, as long as no other live process holds
  the default profile. Launching while one does would only hand a new window
  to that process and exit, every five seconds.
- `profile-holder` decides "held" from the profile's `SingletonLock`
  (`<hostname>-<pid>`): same hostname, the pid alive, and named `chromium`. A
  lock left by an earlier container, a dead pid or a reused pid counts as
  stale, and the session clears the `Singleton*` files before launching.
- Both session loops take a `flock`, so rerunning the autostart cannot start a
  second copy. Children close the lock descriptor, so a surviving app never
  keeps a dead loop's lock.

### Health and routing

- The browser container's healthcheck probes the desktop instead: nginx on 3000
  (a 401 without credentials still proves it is up) and Selkies on 8082. That is
  what Traefik routes to, so the route now follows what a human needs.
- CDP liveness stays where it already was, in `browser-cdp`'s healthcheck, which
  connects to `127.0.0.1:9222`. A CDP outage still shows in Dokploy, on the
  sidecar, without taking the desktop offline.
- Rejected: Traefik `allowEmptyServices`. It is host-wide, needs a Traefik
  restart that touches every routed app, and serves 503, not the desktop.
- Rejected: `RESTART_APP=true`. The watchdog reruns the whole autostart, and a
  Chromium not started by it makes every rerun hand off and exit, about once a
  second.

### Postman

- `postman-cdp-bridge` reads the port from `DevToolsActivePort` and
  republishes it with `socat` on `127.0.0.1:${POSTMAN_CDP_PORT}`, following it
  across restarts. `socat` is added to the image. The compose sidecars are
  unchanged. Clients still see the fixed port in `webSocketDebuggerUrl`,
  because Chrome and Electron build that URL from the request's `Host` header
  (checked against Chrome 154).
- `wrapped-postman` runs `/opt/Postman/app/postman` directly and no longer
  deletes `DevToolsActivePort`.
- `Postman.desktop` replaces `postman.desktop`, with
  `MimeType=x-scheme-handler/postman;` and `Exec=… %U`.
- `postman-session` uses the same `profile-holder` check against Postman's own
  lock, and exits when `POSTMAN_AUTOSTART` is not `true`. Before, the flag was
  ignored on fresh volumes, whose default autostart always carried the line.
- No sign-in is needed. The lightweight API client sends requests from the
  browser container's namespace, VPN routes included, and keeps everything
  local. Postman Web plus a Desktop Agent was considered and dropped: Postman
  ships no Linux ARM64 agent, and the agent is another Electron app anyway.

### Existing volumes

`30-desktop-session` (renamed from `30-postman-session`) runs at every start:

- hands files under `.config`, `.cache`, `.local`, `.pki` and `~/Postman` that
  are not owned by `abc` back to it. Runtime state such as `.XDG` is left alone.
- rewrites the `wrapped-chromium` autostart line to `chromium-session`, and
  inserts `postman-session &` before it once, using a guard that actually
  matches what it inserts.
- keeps the Postman menu entry, as before.

## Testing

`scripts/vpn-overlay.test.mjs` covers the following:

- the drop-in;
- `profile-holder`: a live holder, a stale host, a dead pid, a reused pid, no
  lock;
- the session loops: launch, wait and single-instance cases, with stubbed
  launchers;
- the bridge, with a stubbed `socat`;
- the init script: rewrite, idempotence, `POSTMAN_AUTOSTART=false`, mode
  preserved;
- the healthcheck no longer touching CDP;
- the Postman handler;
- every rootfs script appearing in the Dockerfile's CRLF and `bash -n` loop.

It also fixes a stale assertion: the Postman sidecars were never added to the
expected service list.

## Rollout

All four paseo stacks auto-deploy from `main`, and a `v*` tag moves `:latest`
for the agents, VPN and browser images together. So the browser image is built
and pinned per instance through `BROWSER_IMAGE`, the stack that needs it first
is deployed from the branch, and only then is the change merged. A recreated
browser can come back on a new `dokploy-network` address, so clients should use
the `paseo-cdp` relay (`127.0.0.1:9222`), which resolves the browser by
container name, rather than a pinned IP.
