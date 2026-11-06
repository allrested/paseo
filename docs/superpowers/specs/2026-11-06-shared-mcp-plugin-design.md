# Shared MCP plugin — design

Date: 2026-11-06. Status: approved design; not yet planned.

## Problem

Every Claude or Kiro agent starts its own copy of each stdio MCP server in its config. Measured on
2026-11-06 in a fork container: a Claude agent took 280–375 MB for `claude` itself and another
380–490 MB for its private playwright, gitlab, and context7 servers. With several agents per
instance and two instances on a 16 GB host, those copies are the largest avoidable cost and a
regular cause of swap storms.

Three other servers (serena, graphify, pia-mcp) already run once over HTTP, but they start from
Claude `SessionStart` hooks that call `paseo script start` in one Paseo workspace. Nothing restarts
them when they die, and archiving that workspace breaks them.

## Scope

In scope:

- A built-in fork plugin that runs each configured MCP server once, in HTTP mode, on a loopback
  port, and keeps it running.
- A status screen with restart and enable controls.
- Moving all six servers (playwright, gitlab, context7, serena, graphify, pia-mcp) to it, and
  pointing the shared agent configs at the HTTP URLs.

Out of scope: injecting servers into agents through `agent.open.before` (the shared configs already
reach Claude, Kiro, and terminal sessions), remote or non-loopback servers, and per-agent
credentials.

## Decisions

| Question              | Decision                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Where agents find it  | `/workspace/.agent-tools/mcp.json` (linked as `/workspace/.mcp.json` and both Kiro configs) lists HTTP URLs; OpenCode's config too.    |
| Server definitions    | Plugin settings, per instance. The plugin code carries no M-DAQ paths, ports, or commands.                                             |
| Secrets               | Commands keep calling `read-mcp-env.js`, so no credential lands in settings.                                                           |
| Server auth           | A server with `bearerToken` gets the plugin's token in its env; every agent gets it through `agent.open.before`; configs use `${VAR}`. |
| Ports                 | playwright 8931, context7 8932, gitlab 8933; serena 8000, graphify 8080, and pia-mcp 8090 keep theirs. All bound to 127.0.0.1.         |
| A port already in use | The supervisor adopts a server that already answers its health check as `external` and does not start a second one.                    |
| Blast radius          | One crashed server affects every agent until it restarts. Accepted for the memory saved; the supervisor restarts within seconds.       |

## Components

`plugins/shared-mcp/`, laid out like `plugins/kiro-usage-source`:

- `shared/`: the settings schema (`defineSettings`) and the RPC contracts.
- `index.server.ts` and `server/`: the supervisor, the health probe, process-group RSS, and log
  capture.
- `index.client.tsx` and `client/`: the settings screen.

A server definition has `id`, `label`, `command` (run with `sh -c`), optional `cwd` and `env`,
`port`, `healthPath` (default `/mcp`), optional `requires` (paths that must exist), optional
`bearerToken` (`serverEnv` and `agentEnv` variable names), and `enabled`.

## Bearer token

mcp-gitlab refuses to serve HTTP without `STREAMABLE_HTTP_AUTH_TOKEN`. The plugin keeps one random
token in its data directory (mode 0600, reused across daemon restarts). A server with `bearerToken`
receives it as `serverEnv`; the `agent.open.before` hook adds it to every agent's env as `agentEnv`;
the shared configs send `Authorization: Bearer ${SHARED_MCP_TOKEN}`. Claude Code and Kiro both expand
`${VAR}` in MCP headers, so the token is never written to a config file.

## Supervisor

Each server has one state: `starting`, `healthy`, `unhealthy`, `backoff`, `failing`, `blocked`,
`external`, or `disabled`.

- Health is an MCP `initialize` POST to `http://127.0.0.1:<port><healthPath>` with a 5 s timeout,
  every 30 s. Any HTTP answer below 500 counts as alive: playwright-mcp answers 403 to a
  `127.0.0.1` Host header, and an auth-guarded server answers 401. A returned `mcp-session-id` is
  closed with `DELETE` so probes never pile up sessions. Two failed probes in a row kill the server
  and restart it.
- A missing `requires` path sets `blocked` with the path as the reason. It is checked again on the
  next probe, without restarting anything.
- Restarts back off from 2 s, doubling to 60 s, and the backoff resets after 10 minutes healthy.
  Five crashes in 10 minutes set `failing`, which retries every 5 minutes.
- A server spawns in its own process group so `npx` and `uvx` children die with it. Stopping sends
  SIGTERM to the group, then SIGKILL after 5 s. Disabling or removing the plugin stops every server
  it started; `external` servers are left alone.
- Each started server's group id goes to a pid file. A daemon that died without cleanup leaves
  detached groups behind; on start the plugin kills any group named by a leftover pid file before
  starting its own, instead of adopting it as `external`.
- stdout and stderr go to a 200-line ring buffer per server and to a log file in the plugin's data
  directory.
- RSS is the sum over the process group, read from `/proc`. The Resource Manager plugin reuses this
  reader.

## Screen and RPCs

The settings screen lists each server with its state, uptime, restart count, RSS, last error, and
log tail, plus **Restart** and an enable switch. Server definitions are edited on the same screen.

- `shared-mcp.status.request` returns every server's state. The screen polls it every 5 s while it
  is open.
- `shared-mcp.restart.request` restarts one server.

## Rollout

These files live outside the repository and are changed on each instance:

- `/workspace/.agent-tools/mcp.json`: playwright, context7, and gitlab become HTTP entries.
- The Claude user-scope playwright entry is removed.
- `/workspace/.agent-tools/opencode/opencode.jsonc`: the same three become remote entries.
- `~/.claude/settings.json`: the three `SessionStart` autostart hooks are removed.
- `/workspace/paseo.json`: the serena, graphify, and pia-mcp scripts are removed; `auth-proxy`
  stays.
- The plugin settings get the six definitions.

## Spike results (2026-11-06)

- context7 4.0.4 serves HTTP with `--transport http --port`.
- mcp-gitlab 2.1.52 serves HTTP with `STREAMABLE_HTTP=true`, `PORT`, `HOST`, and requires
  `STREAMABLE_HTTP_AUTH_TOKEN`; clients send `Authorization: Bearer`. Claude Code and Kiro expand
  `${VAR}` in that header.
- playwright-mcp 0.0.81 bound to `127.0.0.1` rejects a `127.0.0.1` Host header with 403; clients
  use `http://localhost:8931/mcp`.
- In CDP mode two playwright sessions share one page. Two stdio processes do the same today, so the
  shared server changes nothing there.
- Claude Code and Kiro both reconnect after the server is killed and restarted mid-session.

## Testing

- Unit: the state machine against a fake process and clock (start, probe failure, backoff, the
  `failing` threshold, `blocked`, `external`, stop).
- Integration: a small real HTTP server in a temp directory, covering start, health, crash and
  restart, and the process-group kill.
- Manual: two Claude agents and one Kiro agent on the shared servers, with RSS measured before and
  after; kill one server mid-session and confirm the agents recover.
