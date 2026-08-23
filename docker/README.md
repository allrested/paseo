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

| Service       | What it does                                                        |
| ------------- | ------------------------------------------------------------------- |
| `paseo`       | Daemon + web UI, built from `Dockerfile.agents`                     |
| `browser`     | Chromium with a screen you can reach over noVNC                     |
| `browser-cdp` | Publishes Chromium's CDP port onto the Compose network              |
| `paseo-cdp`   | Puts that CDP port on `paseo`'s loopback                            |

`Dockerfile.agents` adds Claude Code, Codex, OpenCode, Kiro CLI, GitHub CLI and
Playwright MCP.

### Build the base first

`Dockerfile.agents` defaults to `FROM paseo:src`, which nothing builds for you:

```bash
docker build -f docker/base/Dockerfile -t paseo:src .   # from the repo root
cd docker && docker compose up -d --build
```

Build from source because the Kiro usage fetcher
(`packages/server/src/services/quota-fetcher/providers/kiro.ts`) lives inside
`@getpaseo/server` and cannot be layered on top of a published image. To use the
published image instead, set `PASEO_IMAGE=ghcr.io/getpaseo/paseo:latest` and lose
the Kiro usage card.

### Configuration

Every setting has a default that reproduces a plain local install, so the stack
runs with no `.env`. Copy `.env.example` to `.env` to change any of them; on
Dokploy, set them in the app's Environment tab.

| URL                              | What                                      |
| -------------------------------- | ----------------------------------------- |
| `http://localhost:${PASEO_PORT}` | Paseo web UI (6767)                       |
| `http://localhost:${BROWSER_PORT}` | The browser's screen, noVNC (3000)      |
| `http://localhost:${DEV_PORT}`   | Your dev server (6666)                    |

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

Bare `docker exec` runs as **root** and writes root-owned files that agents (uid
1000) cannot read. That produces failures with no useful error: Kiro exits code
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

## Building on Windows

A checkout with `core.autocrlf=true` rewrites `base/rootfs`'s entrypoint to
CRLF, so its shebang becomes `bash\r` and the container restart-loops on exit
127. `Dockerfile.agents` strips the carriage returns before use.

Keep `docker/paseo-home` and `docker/workspace` in `.dockerignore`. They are
runtime state, they reach gigabytes, and a symlink inside them makes the context
loader reject the build outright.
