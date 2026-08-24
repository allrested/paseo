# Paseo Docker Image

This directory contains the official Paseo daemon image (`base/`) and a Compose
stack that runs it with agent CLIs and a shared browser.

The image runs the daemon headless and serves the bundled web UI from the same
HTTP origin. Start it, then open the daemon URL in a browser.

```bash
docker run -d --name paseo \
  -p 6767:6767 \
  -e PASEO_PASSWORD=change-me \
  -v "$PWD/paseo-home:/home/paseo" \
  -v "$PWD:/workspace" \
  ghcr.io/getpaseo/paseo:latest
```

Then open `http://localhost:6767`.

The base image intentionally does not bundle agent CLIs. Extend it with the
agents you use:

```Dockerfile
FROM ghcr.io/getpaseo/paseo:latest

USER root
RUN npm install -g @openai/codex @anthropic-ai/claude-code
```

See [docs/docker.md](../docs/docker.md) for Compose, reverse proxy, security,
agent auth, and troubleshooting notes.

---

## The Compose stack

`docker-compose.yml` runs four containers:

| Service       | What it does                                           |
| ------------- | ------------------------------------------------------ |
| `paseo`       | Daemon + web UI, from the `Dockerfile.agents` image    |
| `browser`     | Chromium with a screen you can reach over noVNC        |
| `browser-cdp` | Publishes Chromium's CDP port onto the Compose network |
| `paseo-cdp`   | Puts that CDP port on `paseo`'s loopback               |

`Dockerfile.agents` adds Claude Code, Codex, OpenCode, Kiro CLI, GitHub CLI and
Playwright MCP.

### Deploying

Nothing builds. Both images are published by `.github/workflows/docker.yml`, so
a deploy is a pull:

```bash
cd docker && docker compose pull && docker compose up -d
```

`AGENT_IMAGE` defaults to `ghcr.io/allrested/paseo-agents:latest`. Pin an exact
version when a deploy should be reproducible rather than tracking the newest
publish:

```bash
AGENT_IMAGE=ghcr.io/allrested/paseo-agents:0.5.1 docker compose up -d
```

The agent image tracks the paseo version it was built FROM, so
`paseo-agents:0.5.1` is the `0.5.1` base plus the CLIs above.

Upgrading to this version adds three environment keys to the `paseo` service,
so the first `up -d` recreates that container. `paseo-cdp` runs in `paseo`'s
namespace and does not recreate with it, so it is left running against the
old, gone namespace. Run this once after the upgrade:

```bash
docker compose -f docker-compose.yml up -d --force-recreate paseo-cdp
```

### Publishing a new image

A `v*` tag publishes both images; so does a manual run when you do not want to
move a tag:

```bash
gh workflow run docker.yml -f paseo_version=0.5.1 -f publish=true -f publish_latest=true
```

`paseo_version` must equal `package.json`'s version — `docker/base/Dockerfile`
asserts it and fails the build otherwise.

### Building locally

Only needed to test a change before publishing:

```bash
docker build -f docker/base/Dockerfile -t paseo:src .   # from the repo root
docker build -f docker/Dockerfile.agents --build-arg PASEO_IMAGE=paseo:src \
  -t paseo-with-agents:local docker
AGENT_IMAGE=paseo-with-agents:local docker compose up -d
```

The base has to come from this fork's source: the Kiro usage fetcher
(`packages/server/src/services/quota-fetcher/providers/kiro.ts`) and the
BDDevLab usage provider live inside `@getpaseo/server` and cannot be layered on
from `Dockerfile.agents`. `ghcr.io/getpaseo/paseo` has neither.

### Configuration

Every setting has a default that reproduces a plain local install, so the stack
runs with no `.env`. Copy `.env.example` to `.env` to change any of them; on
Dokploy, set them in the app's Environment tab.

| URL                                | What                               |
| ---------------------------------- | ---------------------------------- |
| `http://localhost:${PASEO_PORT}`   | Paseo web UI (6767)                |
| `http://localhost:${BROWSER_PORT}` | The browser's screen, noVNC (3000) |
| `http://localhost:${DEV_PORT}`     | Your dev server (6666)             |

`DEV_PORT` only remaps the host side. The app still listens on
`DEV_PORT_INTERNAL` (3000) inside the container, and must bind `0.0.0.0` —
`127.0.0.1` is not reachable from outside the container.

## The browser

Agents drive Chromium over CDP; you watch the same browser over noVNC. Because
both attach to one browser, an agent can stop at a captcha or SSO screen, you
solve it by hand, and the agent continues with those cookies. The profile lives
in `BROWSER_CONFIG_DIR`, so a login you do once survives restarts.

Agents reach services by container name, not `localhost` — the browser is a
different container. Your dev server is `http://paseo:3000` to them.

Two Chrome behaviours shape the CDP plumbing, and both are why the socat
sidecars exist:

- Chrome ignores `--remote-debugging-address` and always binds CDP to
  `127.0.0.1`, so nothing outside its network namespace can reach it.
- Chrome rejects any `Host` header that is not localhost or an IP, and
  `/json/version` advertises `webSocketDebuggerUrl` as `ws://127.0.0.1:9222/…`
  which clients follow verbatim. Both problems disappear once CDP appears on
  `paseo`'s own loopback at the same port number.

**Never publish port 9222.** CDP has no authentication: anything that reaches it
controls the browser and every session logged into it.

## Private network access

`docker-compose.vpn.yml` is an optional overlay that puts an SSL-VPN client in
its own container and routes `paseo` and `browser` through it. Apply it with a
second `-f`:

```bash
docker compose -f docker-compose.yml -f docker-compose.vpn.yml up -d
```

Without the second `-f`, none of this exists and the stack is unchanged. The
tunnel lives only in the `vpn` container's network namespace — the host's
routing table and resolv.conf are never touched.

Dokploy takes a single `composePath`, not two `-f` flags. Use
`docker-compose.vpn.stack.yml` there instead — it `include`s the base stack and
the overlay, in that order, and needs Docker Compose v2.20 or newer.

The host needs the `ppp_generic` kernel module, loaded and persisted across
reboots:

```bash
modprobe ppp_generic
echo ppp_generic > /etc/modules-load.d/ppp.conf
```

| Variable                                                  | What                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| `VPN_GATEWAY`, `VPN_PORT`, `VPN_USERNAME`, `VPN_PASSWORD` | FortiGate SSL-VPN portal credentials                        |
| `VPN_TRUSTED_CERT`                                        | Gateway certificate SHA256, pinned after the first connect  |
| `VPN_REALM`                                               | Set only if the portal is realm-scoped                      |
| `INTERNAL_CIDRS`                                          | What "internal" means — see below                           |
| `VPN_HEALTH_TARGET`                                       | `host:port` the healthcheck reaches through the tunnel      |
| `SSH_KNOWN_HOSTS_EXTRA`                                   | Host keys for the private git server, from `ssh-keyscan`    |

`INTERNAL_CIDRS` is curated by hand, not copied from the gateway. A FortiGate
offers far more routes than you want, including public address space —
installing those would route parts of the internet through the corporate
tunnel. `paseo-vpn-validate` enforces the curation at startup: RFC
1918 only, `/12` or longer, no overlap with the gateway container's own
networks and no overlap with `paseo`'s — including `dokploy-network`, which a
Swarm host's default overlay pool (`10.0.0.0/8`) can easily collide with.

`INTERNAL_SSH_HOST` and `INTERNAL_SSH_KEY_FILE` wire up SSH to a private git
server over the tunnel. `INTERNAL_SSH_KEY_FILE` is a path inside the
container; no separate mount carries it there. Place the deploy key in the
`PASEO_HOME_DIR` volume already mounted at `/home/paseo` — at
`${PASEO_HOME_DIR}/.ssh/internal_key` on the host — and set `chown 1000:1000`
and `chmod 600` on it. uid 1000 is the `paseo` user, and OpenSSH refuses to
use a group-readable private key.

`paseo-vpn-route` and `browser-vpn-route` install routes inside `paseo`'s and
`browser`'s network namespaces. Recreating `paseo` leaves its route sidecar
behind in the old namespace — Up, but useless, and its healthcheck goes
unhealthy because it can only pass from the live namespace. Recover with:

```bash
docker compose -f docker-compose.yml -f docker-compose.vpn.yml \
  up -d --force-recreate paseo-vpn-route
```

## Per-person auth

Credentials live under `PASEO_HOME_DIR` — `.config/gh`, `.local/share/kiro-cli`,
`.ssh`, `.claude`. Give each person their own directory and they get their own
identity. Never copy a populated `paseo-home` to bootstrap someone else; they
inherit your GitHub token, your Kiro session and your SSH private key.

Run every interactive command as the `paseo` user:

```bash
docker exec -it --user paseo paseo gh auth login
docker exec -it --user paseo paseo kiro-cli user login \
  --license pro \
  --identity-provider https://your-org.awsapps.com/start \
  --region us-east-1 \
  --use-device-flow
```

Both print a code and a URL to open yourself. The container is headless, so
`gh` reports `Failed opening a web browser` and Kiro needs `--use-device-flow`;
neither is a failure.

Bare `docker exec` runs as **root** and writes root-owned files that agents (uid 1000) cannot read. That produces failures with no useful error: Kiro exits code
0 with empty stderr when it cannot write `.kiro/sessions`, Codex reports a
corrupt sqlite state, `gh` reports a permission-denied config. The entrypoint
repairs ownership under `/home/paseo` and `/workspace` at every start, so a
restart clears it, but the habit is `--user paseo`.

Set `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL` in `.env`. `gh auth` decides who
pushes; these decide who the commit says it is from. Left empty, git refuses to
commit.

GitHub's SSH host keys are baked into `/etc/ssh/ssh_known_hosts` at build time,
so `git clone git@github.com:…` works from first boot. Without that, every new
instance fails its first SSH clone with `Host key verification failed`: a
per-user `known_hosts` starts empty, and OpenSSH ignores one it does not own, so
trusting the host as `paseo` does not help a clone running as anyone else.

Cloning over SSH from anywhere else — GitLab, Bitbucket, a self-hosted forge —
hits the same wall. Add that host the same way, in `Dockerfile.agents`, rather
than per user. Verify the key against a fingerprint the host publishes;
`ssh-keyscan` alone trusts whatever answers.

## Running one instance per person

Give each instance a distinct `INSTANCE_NAME` and ports, and a private
`PASEO_HOME_DIR` and `BROWSER_CONFIG_DIR`. `WORKSPACE_DIR` may be shared.

Never share `PASEO_HOME_DIR`. Two daemons writing one state directory corrupt
it. Keep `PUID=1000` on every instance sharing a workspace: the paseo image's
user is uid 1000 and cannot be changed, so a different `PUID` makes the
containers rewrite each other's file ownership on every restart.

A shared workspace has no locking between instances. Concurrent edits and git
operations on one repo will collide. Divide work by project.

Set `BROWSER_USER` and `BROWSER_PASSWORD` for anything not localhost-only.
noVNC is unauthenticated without both, and it exposes a browser holding your
logged-in sessions. Set `PASEO_HOSTNAMES` to the domain you serve each instance
on, or the daemon rejects requests by host name.

Give each instance its own subdomains rather than one shared host — name them
after `INSTANCE_NAME` so it stays obvious whose is whose, e.g. `tatsuya.example.com`
for the UI (port 6767) and `tatsuya-browser.example.com` for the screen (port
3000). `paseo` and `browser` both join the external `dokploy-network` so a
reverse proxy in its own stack can reach them; on a host that has no such proxy,
`docker network create dokploy-network` once is all it needs.

Compose adds each service's **name** as a DNS alias on every network it joins,
including that shared one, so two instances put two containers answering to
`paseo` and to `browser` on it. Address another instance's containers by their
`INSTANCE_NAME`-prefixed container name, never by service name — the CDP sidecar
already does. For the same reason, agents reach their own dev server as
`http://${INSTANCE_NAME}:3000`; plain `http://paseo:3000` is ambiguous once a
second instance exists.

## Building on Windows

A checkout with `core.autocrlf=true` rewrites `base/rootfs`'s entrypoint to
CRLF, so its shebang becomes `bash\r` and the container restart-loops on exit 127. `Dockerfile.agents` strips the carriage returns before use.

Keep `docker/paseo-home` and `docker/workspace` in `.dockerignore`. They are
runtime state, they reach gigabytes, and a symlink inside them makes the context
loader reject the build outright.
