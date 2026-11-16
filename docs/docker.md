# Running Paseo in Docker

Paseo publishes a container image for running the daemon on a server, VM, NAS,
or homelab box. The image also serves the bundled browser web UI, so one
container gives you both the daemon API and a self-hosted UI.

The image source lives in [`docker/`](../docker/).

## How it works

The official image:

- builds `@getpaseo/server` and `@getpaseo/cli` from source-built workspace tarballs
- runs the daemon as the non-root `paseo` user
- listens on `0.0.0.0:6767` inside the container
- enables the bundled daemon web UI with `PASEO_WEB_UI_ENABLED=true`
- stores daemon state and agent credentials under `/home/paseo`
- leaves agent CLIs out of the base image

Open the container's HTTP origin, for example `http://localhost:6767`, to load
the web UI. The served app receives a same-origin connection hint and connects
back to that daemon. Static UI files load without daemon auth; API and
WebSocket requests still require `PASEO_PASSWORD` when one is configured.

Host-side CLI commands select the container explicitly, for example `paseo project ls --host 127.0.0.1:6767`. Without an endpoint selector the CLI looks for a local home’s supervisor. Container environment settings are deployment overrides; worker restart preserves them. Your container manager owns full supervisor replacement.

## Quick Start

```bash
docker run -d --name paseo \
  -p 6767:6767 \
  -e PASEO_PASSWORD=change-me \
  -v "$PWD/paseo-home:/home/paseo" \
  -v "$PWD:/workspace" \
  ghcr.io/getpaseo/paseo:latest
```

Then open:

```text
http://localhost:6767
```

If you set `PASEO_PASSWORD`, enter the same password when adding the direct
daemon connection in the web UI or another Paseo client.

## Docker Compose

Use [`docker/docker-compose.example.yml`](../docker/docker-compose.example.yml):

```bash
cp docker/docker-compose.example.yml docker-compose.yml
$EDITOR docker-compose.yml
docker compose up -d
```

Minimal example:

```yaml
services:
  paseo:
    image: ghcr.io/getpaseo/paseo:latest
    restart: unless-stopped
    ports:
      - "6767:6767"
    environment:
      PASEO_PASSWORD: "change-me"
    volumes:
      - ./paseo-home:/home/paseo
      - ./workspace:/workspace
```

## Installing Agents

The base image does not preinstall Claude Code, Codex, OpenCode, Copilot, Pi, or
other agent CLIs. That keeps the default image small and avoids coupling Paseo
releases to third-party agent release cycles.

Create a child image for the agents you use:

```Dockerfile
FROM ghcr.io/getpaseo/paseo:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code opencode-ai
```

Build it:

```bash
docker build -f Dockerfile -t paseo-with-agents .
```

Then use `image: paseo-with-agents` in Compose.

Leave the child image user as root. The base entrypoint uses root only for
first-run directory setup, then drops the daemon and launched agents to the
non-root `paseo` user.

An example child image is in
[`docker/Dockerfile.agents.example`](../docker/Dockerfile.agents.example).

You can also mount credentials from the host or run agent login once inside the
container:

```bash
docker exec -it --user paseo paseo codex
docker exec -it --user paseo paseo claude
```

Agent credentials and config persist in `/home/paseo`, alongside daemon state.
Provider environment variables such as `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`,
`OPENAI_BASE_URL`, or `ANTHROPIC_BASE_URL` can be passed through `docker run -e`
or `compose.environment`; Paseo passes them to launched agents.

## Token use

The Compose files in `docker/` set three Claude Code variables on the daemon, which hands its
environment to every agent it starts. Override any of them in the stack's `.env`.

| Variable                       | Default  | Why                                                                                                                                                                                                                                                                           |
| ------------------------------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ENABLE_TOOL_SEARCH`           | `true`   | Tool definitions load on demand. Behind an `ANTHROPIC_BASE_URL` gateway, a Claude Code older than 2.1.304 loads every MCP tool definition into each session and subagent unless this is set. With a dozen MCP servers that is over 100k tokens at the start of every session. |
| `CLAUDE_CODE_PROMPT_CACHE_TTL` | `1h`     | The main conversation's prompt cache lives an hour. With API-key or gateway billing the default is 5 minutes, so every pause longer than that rebuilds the whole context. Subagents stay on 5 minutes: they rarely pause that long.                                           |
| `CLAUDE_CODE_SUBAGENT_MODEL`   | `sonnet` | The model for a subagent whose dispatch and agent file name none. A named model wins, and the built-in Explore and Plan agents keep their own. Set it to the model you want all unnamed subagents on, for example `opus`.                                                     |

A 1-hour cache write costs 2x base input, against 1.25x for a 5-minute one. It pays off when
sessions sit idle between 5 and 60 minutes, which is what waiting on background work looks like.
If your gateway rejects 1-hour writes, set `CLAUDE_CODE_PROMPT_CACHE_TTL=5m`.

To check a running instance, read the usage of one request:

```bash
docker exec --user paseo paseo claude -p ok --output-format json | jq .usage.cache_creation
```

`ephemeral_1h_input_tokens` above zero means the 1-hour cache is in use.

## Volumes

| Mount         | Purpose                                                                  |
| ------------- | ------------------------------------------------------------------------ |
| `/home/paseo` | Paseo state under `.paseo` plus agent config such as `.codex`, `.claude` |
| `/workspace`  | Code that Paseo and launched agents can read and write                   |

The image defaults:

| Variable       | Default              |
| -------------- | -------------------- |
| `HOME`         | `/home/paseo`        |
| `PASEO_HOME`   | `/home/paseo/.paseo` |
| `PASEO_LISTEN` | `0.0.0.0:6767`       |

If you bind-mount host directories on Linux, make sure the container user can
write them. The built-in `paseo` user has uid/gid `1000:1000`. For a different
host uid/gid, either adjust ownership on the mounted directories or run the
container with Docker's `--user` / Compose `user:` option.

## Reverse Proxies

When serving Paseo behind a reverse proxy, forward normal HTTP requests and
WebSocket upgrades to the same daemon port.

Caddy example:

```caddy
paseo.example.com {
  reverse_proxy 127.0.0.1:6767
}
```

Nginx example:

```nginx
server {
    listen 443 ssl;
    server_name paseo.example.com;

    location / {
        proxy_pass http://127.0.0.1:6767;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

If you reach the daemon by DNS name, set `PASEO_HOSTNAMES` so host-header
validation allows that name:

```yaml
environment:
  PASEO_HOSTNAMES: "paseo.example.com,.lan"
```

IPs and `localhost` are allowed by default.

## Branding

The web UI the daemon serves can carry your own name, logo, icon and colour. Set them in the
daemon's environment; each one works alone.

| Variable            | Value                                                              | Changes                                                                                                          |
| ------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| `PASEO_BRAND_NAME`  | 1 to 40 characters                                                 | The page title, the installed app's name, "Paseo" in the app's text, and the sign over the lift in the 3D office |
| `PASEO_BRAND_LOGO`  | Path to an `.svg`, `.png`, `.jpg`, `.jpeg` or `.webp`, up to 1 MiB | The logo on the welcome, start-up, open-project and onboarding screens, and the mark on the 3D office's sign     |
| `PASEO_BRAND_ICON`  | Path to a square `.png` of 512 px or more, up to 1 MiB             | The favicon, the Apple touch icon and the installed app's icon                                                   |
| `PASEO_BRAND_COLOR` | `#RRGGBB`                                                          | The browser bar and the installed app's title bar                                                                |

```yaml
services:
  paseo:
    environment:
      PASEO_BRAND_NAME: "Acme Agents"
      PASEO_BRAND_LOGO: "brand/logo.svg"
      PASEO_BRAND_ICON: "brand/icon.png"
      PASEO_BRAND_COLOR: "#1F6F4A"
```

The paths are on the daemon's machine. A relative path is resolved against `$PASEO_HOME`, so
`brand/logo.svg` is `./paseo-home/.paseo/brand/logo.svg` in the example above. The logo is drawn
in its own colours on every theme: pick one that reads on light and dark. The icon is used as it
is at every size. In the browser tab it carries a dot at the bottom right while an agent runs or
needs you, so leave that corner free of detail.

The daemon reads the files at start. Restart it after a change. A value it cannot use is named in
the daemon log and ignored; the others still apply. A browser that installed the app earlier
keeps the old name and icon until the app is installed again.

Branding reaches the web UI only, in a browser and installed from one. The phone and desktop apps,
the `paseo` command, tool names and file paths keep their names, and plugin screens keep their
own wording. Under your name, the Help menu adds "Based on Paseo".

## Private network access

`docker-compose.vpn.yml` is a complete alternative to `docker-compose.yml`: the
same stack plus an SSL-VPN client in its own container, so `paseo` and `browser`
can reach a private network — a corporate git server, for example. Deploy an
instance from that file instead of the base one; instances that do not need the
VPN are unaffected.

See [Private network access in docker/README.md](../docker/README.md#private-network-access)
for the command, the environment variables, the host's `ppp_generic`
prerequisite, why the shared services are duplicated, and route sidecar
recovery.

## Browser

`docker-compose.yml` and `docker-compose.vpn.yml` run a Chromium next to the daemon, and
`docker-compose.agent.yml` borrows another stack's. All three set `PASEO_BROWSER_CDP_URL` to its
CDP address. With it set, the daemon is a browser host: agents' `browser_*` tools open and drive
tabs in that Chromium, and the browser pane in the web UI and the mobile app shows the same tab.
`PASEO_BROWSER_TOOLS_ENABLED` turns the agent tools on for a fresh home; the setting in the app
overrides it once saved.

The daemon touches only tabs it opened. It keeps their ids in
`$PASEO_HOME/browser-tools/cdp-tabs.json` and never lists, drives or closes any other tab, so
your own tabs and another instance's tabs on a shared Chromium are left alone.

The pane's "Annotate element" button makes the tab a picker: the page outlines the element under
the pointer, and the next click or tap picks it and reaches nothing on the page. The element and
the note you write go to the workspace's composer as the attachment the desktop app's browser
makes. The daemon runs the picker inside the page (`browser.cdp.view.pick_element`), where the
page's own scripts can read and change it, so it cuts everything the page reports to fixed
lengths. A pick ends by itself after 30 s, on Escape, when the page navigates and when the pane
goes away. The button is off while an agent uses the tab, because a picker takes the agent's
clicks too.

Each tab the daemon opens is its own Chromium window, because Chromium paints no frames for a
background tab. The window opens on top of the desktop you see in noVNC, over your own window.
Chromium also stops rendering a window that another window covers, which freezes a pane tab as
soon as the next one opens over it, so `docker-compose.yml` and `docker-compose.vpn.yml` launch
Chromium with `--disable-backgrounding-occluded-windows --disable-renderer-backgrounding` in
`CHROME_CLI`.

Chrome 156 refuses WebGL on the container's software GL driver, so the same `CHROME_CLI` carries
`--ignore-gpu-blocklist`. Without it a page that draws with WebGL stays blank in a pane tab. The
same setting can be turned on in a running Chromium at `chrome://flags` ("Override software rendering
list"); it is kept in the profile volume and takes effect when Chromium restarts.

A stack that borrows another stack's browser, such as `docker-compose.agent.yml`, and a
deployment that keeps its own copy of a compose file need all three flags on the Chromium they
use.

### Profiles

A tab opens in the Chromium's own profile, called Shared in the app, so it has the logins you made
over noVNC. To keep a workspace away from them, give it a named profile: the profile button in the
pane's toolbar lists the profiles, and the one you pick is where that workspace's new tabs open,
yours and its agents'. A tab that is already open stays in the profile it opened in.

A named profile is a CDP browser context, which Chromium holds in memory. The daemon saves each
profile's cookies to `$PASEO_HOME/browser-tools/cdp-profiles/<id>.json` (owner-only, plain
text) every 30 s while the profile has an open tab, when one of its tabs closes and when the
daemon stops, and writes them into a new context after Chromium restarts. Session cookies are
saved too. Other site storage, such as localStorage and IndexedDB, is gone after a Chromium
restart.

"Import cookies" adds cookies to a named profile from one of two sources:

- A cookie file from your own browser: a JSON export (an array of cookies, or a Playwright
  storage state) or a Netscape `cookies.txt`, up to 1 MiB and 5,000 cookies. Choose the file or
  paste its text.
- The Shared profile, for the sites you name. `github.com` also copies the cookies of
  `api.github.com`.

The daemon never writes cookies into the Shared profile, and an import answers with counts and
site names only. Deleting a profile closes its tabs and removes its cookie file.

A daemon keeps at most 12 profiles. Each daemon on a shared Chromium has its own profiles and
contexts.

## FigCraft (design mode)

The design plugin keeps design files on a self-hosted FigCraft server (see
[plugins.md](plugins.md)). `docker-compose.figcraft.yml` runs it: `figcraft-server` and
FigCraft's browser editor behind Caddy in one container, image `paseo-figcraft` from
`Dockerfile.figcraft`. Run one per host; every Paseo instance on it shares it.

In Dokploy, add it as a Compose service and give it the domain `figcraft.dev.mtapp.dev` on port 8080. Traefik does TLS. Two variables name the deploy:

| Variable              | Value                                 |
| --------------------- | ------------------------------------- |
| `FIGCRAFT_PUBLIC_URL` | `wss://figcraft.dev.mtapp.dev/`       |
| `FIGCRAFT_WEB_URL`    | `https://figcraft.dev.mtapp.dev/app/` |

The editor is at `/app/`; the root of the domain is the WebSocket endpoint.

The server makes its key on first start and keeps it in the `figcraft-data` volume. The key
publishes and manages files, and the domain is public with no accounts, so it never goes in git,
a page or a chat. Each Paseo instance reads it from the file `FIGCRAFT_SERVER_KEY_FILE` names
(`/home/paseo/.paseo/design/server-key` by default), next to `FIGCRAFT_URL` and
`FIGCRAFT_WEB_URL` in its env. Copy it in without printing it, once per instance:

```bash
docker exec figcraft figcraft-server --config /tmp/server.toml key \
  | grep -o 'key=[^&[:space:]]*' | cut -d= -f2 \
  | docker exec -i -u paseo <instance> sh -c 'umask 077; mkdir -p /home/paseo/.paseo/design; cat > /home/paseo/.paseo/design/server-key'
```

It is a file because the daemon's env is every agent's and terminal's env: a `FIGCRAFT_SERVER_KEY`
variable would show up in any `env` an agent prints, so the plugin refuses one.

Removing a design in Paseo only stops listing it. The file stays on the server until you run
`docker exec figcraft figcraft-server --config /tmp/server.toml files remove <id>`.

Caddy hands `figcraft-server` the client's address from Traefik's `X-Forwarded-For`, so the
server's per-address limits count people, not the proxy.

FigCraft is alpha, so one release is pinned. To upgrade, change `FIGCRAFT_VERSION` in
`Dockerfile.figcraft`, `Dockerfile.agents` and `plugins/design/test/install-figcraft.sh` together,
then run the real FigCraft test in `plugins/design/test/` against the new release.

## Android device

`docker-compose.yml` can run an Android 14 device beside the browser, for testing Android apps:
agents install an APK, read the screen and tap through it, and you watch and take over in Paseo's
Android panel. It is Android in a container (redroid), not an emulator, so it needs no
virtualization, and it runs at native speed on an arm64 host. Idle it uses about 0.6 GB of memory
and almost no CPU; it draws its screen in software, so a busy app takes a core.

It is off by default. To turn it on:

1. Load the binder kernel module on the host, now and at every boot:

   ```bash
   echo binder_linux | sudo tee /etc/modules-load.d/redroid.conf
   echo 'options binder_linux devices=binder,hwbinder,vndbinder' | sudo tee /etc/modprobe.d/redroid.conf
   sudo modprobe binder_linux devices=binder,hwbinder,vndbinder
   ```

   The module ships with Ubuntu's kernel packages (`linux-modules-extra`). A host without it
   cannot run the device: the container exits at boot and restarts.

2. Set `COMPOSE_PROFILES=android` and `PASEO_ANDROID_ADB=127.0.0.1:5555` in the stack's
   environment and bring the stack up. The first starts the `android` service and its
   `paseo-android-adb` sidecar; the second tells the daemon where the sidecar puts the device's
   adb.

The device's adb has no authentication, so the compose file gives it no published port and its own
network, `device`, which only the paseo container shares. The browser container is not on it.
Agents and the daemon reach adb on the paseo container's loopback. Do not add a `ports`
entry to it. The container is privileged, which redroid needs; a privileged container can reach
the host.

With `PASEO_ANDROID_ADB` set and the device down, the Android panel and the agent tools say "The
Android device is unreachable". The VPN stack and a stack that borrows another stack's browser
have no device.

The agent image carries `adb` and the Maestro CLI, so an agent runs a repo's flows with
`maestro --device 127.0.0.1:5555 test <flow>`. Run `adb connect 127.0.0.1:5555` first in a
shell that has not used the device yet.

Nothing builds an APK in the stack: Android's build tools do not support an arm64 Linux host.
Agents download the APK your CI built. The device has no Google Play services.

## Security

- Set `PASEO_PASSWORD` for any published port or network-reachable deployment.
- Prefer HTTPS at the reverse proxy for direct browser access.
- Use the [official Paseo relay](https://github.com/getpaseo/paseo-relay) for
  untrusted networks or mobile access when you do not want to expose the daemon
  port directly.
- The container is the isolation boundary for agents. Agents can read and write
  whatever you mount into `/workspace` and whatever credentials you place in
  `/home/paseo`.
- The bundled web UI static files are public on the daemon origin. The daemon
  API and WebSocket remain protected by password auth when configured.
- CDP has no authentication. Anything that can reach the Chromium's CDP port controls the
  logged-in profile; keep it on the compose network.

See [SECURITY.md](../SECURITY.md) for the daemon trust model.

## Building Locally

```bash
docker build -f docker/base/Dockerfile -t paseo:local .
```

To assert the source tree version while building:

```bash
docker build \
  --build-arg PASEO_VERSION=0.1.102 \
  -t paseo:0.1.102 \
  -f docker/base/Dockerfile \
  .
```

The Docker workflow builds the image on pull requests and on `main` as a
non-publishing check. Stable `vX.Y.Z` tag pushes publish
`ghcr.io/getpaseo/paseo:X.Y.Z` and `ghcr.io/getpaseo/paseo:latest`. Beta tags
publish only the exact prerelease tag, such as
`ghcr.io/getpaseo/paseo:0.1.102-beta.1`, and do not update `latest`.

To replace a Docker image in place without rebuilding desktop, APK, or EAS
mobile release artifacts, dispatch the Docker workflow manually instead of
pushing a `v*` release tag:

```bash
gh workflow run docker.yml \
  --ref main \
  -f paseo_version=0.1.102-beta.1 \
  -f publish=true
```

Manual Docker publishes require an explicit `paseo_version`. The workflow builds
from the checked-out source tree and publishes only the exact prerelease image
tag for prerelease versions.

The published image is multi-arch for `linux/amd64` and `linux/arm64`.

## Troubleshooting

- **The web UI loads but cannot connect**: if `PASEO_PASSWORD` is set, add a
  direct connection with the same password.
- **403 Host not allowed**: set `PASEO_HOSTNAMES` to the DNS names you use.
- **Provider not available**: install that agent CLI in a child image or mount a
  runtime where the binary is on `PATH`.
- **Permission errors in `/workspace`**: make the mounted directory writable by
  uid/gid `1000:1000`, or run the container as the host uid/gid.
- **Logs**: inspect `docker logs paseo` or
  `/home/paseo/.paseo/daemon.log` inside the container.
