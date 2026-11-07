# Resource Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show where this instance's memory and CPU go, per Paseo agent and per process group, with a Close that ends an idle agent's runtime, plus one read-only page per server reachable through ssh-mcp.

**Architecture:** A built-in plugin `plugins/resource-manager/` runs inside the daemon. Its server half reads `/proc` and cgroup v2, maps every process to the agent named by `PASEO_AGENT_ID` in its environ (children inherit), and totals the daemon, shared MCP servers, heavy-gate commands and everything else as groups. For remote servers it finds every ssh-mcp entry in the Claude configs the daemon can read, starts it as an MCP stdio client on demand, and calls its `exec` (or `run-command`) tool with one constant read-only command. A new daemon RPC `agent.runtime.close.request`, advertised as `server_info.features.agentRuntimeClose` and exposed in the SDK as `PaseoAgentHandle.closeRuntime()`, is how Close ends a runtime; the daemon makes idle collection's checks first and refuses with a reason when one fails. The client half adds a Resources sidebar item and a screen with an instance tab and one tab per ssh-mcp server.

**Tech Stack:** TypeScript (NodeNext, strict), zod 4, `@getpaseo/plugin` server and client SDK, `@getpaseo/client`, React Native UI with `@tanstack/react-query`, Vitest 4, Node 22 `child_process`, `/proc` and cgroup v2, MCP JSON-RPC over stdio.

**Spec:** `docs/superpowers/specs/2026-11-06-resource-manager-design.md`

## Cross-plan interfaces

This plan reads data that two other sub-projects own. Neither is imported: a built-in may import only from its own directory (`compiler-build.ts:21-32` `directoryTarget`, `:69-89` `moduleBoundaryError`), so every contract below is a file format or an environment variable.

| From                                              | Contract this plan relies on                                                                                                                                                                                                                                                                                                                                                                                                     | Where this plan uses it                                                                                                                                                                                                                                                                                                                     | Status                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Sub-project 2, heavy-command gate                 | Every process of a command the gate let through (admitted or failed open) carries `PASEO_HEAVY_GATE_HELD=1` in `/proc/<pid>/environ`; the shim that asked the gate does not. A shim started inside a held command inherits the marker and replaces itself with the real binary at the same pid, so it belongs to that held command. Gate spec `docs/superpowers/specs/2026-11-06-heavy-command-gate-design.md:34`, `:53`, `:57`. | `HEAVY_GATE_ENV` in `server/local/process-table.ts` (Task 5); the "Heavy commands" group (Tasks 5, 6, 12)                                                                                                                                                                                                                                   | **Agreed** with the critiqued gate draft (`.superpowers/plan-drafts/2026-11-06-heavy-command-gate.md`): decision 14, `HELD_ENV = "PASEO_HEAVY_GATE_HELD"` in its `server/protocol.ts` (Task 3), and its shim sets the value `"1"` on the child's env only (Task 7, `[deps.heldEnv]: "1"`). A gate switched off, a light command and the shim that asked carry no marker, so they count under the agent. If the gate's final plan renames the variable or changes its value, change `HEAVY_GATE_ENV` and the `parseMarkers` test in Task 5. |
| Sub-project 2, heavy-command gate                 | `heavy-command-gate.status.request` (gate spec `:76`).                                                                                                                                                                                                                                                                                                                                                                           | Not used. This plugin totals the gate's processes from `/proc` only; the gate keeps its own screen (spec, Decisions table, "Other plugins' data").                                                                                                                                                                                          | No dependency.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| Sub-project 2, heavy-command gate                 | Registry and doc edits: the gate adds `"heavy-command-gate"` to `builtinPlugins` between `"grok-usage-source"` and `"hoplite-provider"`, and its Task 10 Step 21 replaces the shared-mcp "Local runs of ..." paragraph (`docs/plugins.md:135-137`) with two gate paragraphs and a "Local runs" paragraph that names `shared-mcp` and `heavy-command-gate`.                                                                       | Task 1 adds `"resource-manager"` between `"opencode-go-usage-source"` and `"shared-mcp"`, a separate line in the alphabetical array, so the two edits never touch each other. Task 13 Step 33 puts this plugin's paragraphs before that "Local runs" paragraph and adds `resource-manager` to it, with exact text for the gate's paragraph. | **Settled** (controller, 2026-11-07): the gate is being built now and lands first, so Step 33 takes the gate-first branch, and stops if it finds the shared-mcp paragraph instead.                                                                                                                                                                                                                                                                                                                                                         |
| Sub-project 2, heavy-command gate                 | The gate draft writes its own `server/procfs.ts` (Task 3: `readPidSpace`, `readStartTime`, the pid-rooted `readTreeRss`, `readShimRss`), not a copy of shared-mcp's, because shared-mcp's reader walks a process group and has no pid-rooted walk.                                                                                                                                                                               | None: this plan neither imports nor reads the gate's reader.                                                                                                                                                                                                                                                                                | No dependency. The gate keeps its own reader (controller, 2026-11-07); a verbatim copy in the gate would be code it never calls.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Sub-project 1, shared-mcp (merged at `1eaa71b2f`) | Pid files `<PASEO_HOME>/shared-mcp/run/<id>.pid` (`plugins/shared-mcp/server/plugin.ts:279`), one JSON line matching `PidRecordSchema` (`plugins/shared-mcp/server/process-runner.ts:56-64`): `{ pgid, startTime, ownerPid, ownerStartTime, pidNamespace, bootId, initStartTime }`.                                                                                                                                              | `readSharedMcpPids` (Task 5), read only.                                                                                                                                                                                                                                                                                                    | Stable on `main`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Sub-project 1, shared-mcp                         | `plugins/shared-mcp/server/procfs.ts`: `parseStat`, `parseVmRssBytes`, `walkProcessTree(pgid, procRoot = "/proc")`, `readProcessGroupRss`. `listProcessTree` is gone (`5cf91e0e9`).                                                                                                                                                                                                                                              | Copied byte for byte to `plugins/resource-manager/server/local/procfs.ts` (Task 1).                                                                                                                                                                                                                                                         | Stable; drift test in Task 1.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| This plan, for later sub-projects                 | `agent.runtime.close.request` / `.response`, the `server_info.features.agentRuntimeClose` flag, `AgentManager.closeRuntimeIfIdle(agentId): Promise<string \| null>` and `PaseoAgentHandle.closeRuntime()` (Task 2).                                                                                                                                                                                                              | Close (Tasks 6, 11, 12).                                                                                                                                                                                                                                                                                                                    | New.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### How the procfs reader is shared without breaking the built-in import rules

The spec says "The process-group RSS reader is shared with the shared MCP plugin's". The options:

1. **Import `../../shared-mcp/server/procfs.js`.** Rejected: `checkSourceImports` rejects any module outside the importing plugin's `client/`, `server/`, `shared/` and entry files with "Plugin modules belong in client/, server/, or shared/" (`packages/server/src/server/plugins/compiler-build.ts:69-89`, the message at `:76`).
2. **A symlink** `plugins/resource-manager/server/local/procfs.ts -> ../../../shared-mcp/server/procfs.ts`. Rejected: the boundary check resolves every module with `realpathSync.native`, so the symlink resolves into shared-mcp's directory and is rejected the same way.
3. **Move it to `@getpaseo/plugin/server`.** Rejected for this sub-project: it makes a Linux `/proc` walker part of the public plugin SDK, with its docs, versioning and the SDK's `requirements.paseo` floor, for two built-ins.
4. **An RPC from one plugin to the other.** Rejected: built-ins have no way to call each other's handlers in process, and a process-tree walk must stay synchronous (the comment on `walkProcessTree` explains why).
5. **A verbatim copy plus a drift test.** Chosen. `server/local/procfs.ts` is created with `cp`, and `server/local/procfs-copy.test.ts` reads both files with `readFileSync` (a test reads, it does not import, so the boundary check never sees it) and fails when they differ by one byte. Shared-mcp's own `procfs.test.ts` covers the behaviour of both. Anyone who edits one file gets a red test until they copy it to the other, and `docs/plugins.md` says so (Task 13).

## Global Constraints

- **Host memory.** The 16 GB host froze on 2026-11-06 from parallel heavy commands. Run every typecheck, vitest run, build, npm install and `git commit` (its lefthook pre-commit typechecks every workspace) under `flock /tmp/paseo-heavy.lock`. Typecheck with `tsgo --singleThreaded`. Never run a whole workspace test suite.
- **One test file per run:** `flock /tmp/paseo-heavy.lock npx vitest run <file> --bail=1`.
- **A missing module fails the suite before any test runs.** Vitest 4.1.7 prints `Error: Cannot find module './x.js' imported from <test file>` and `Tests  no tests` (the shared-mcp runs recorded it in `.superpowers/sdd/2026-11-06-shared-mcp-plugin/task-1-report.md:22`). Every "Cannot find module" expectation below means that output.
- **Pre-commit hook stays on.** Every commit runs the lefthook hook (format, lint, full typecheck) under the heavy lock. `LEFTHOOK=0` is not approved for this plan and is not an option to offer. If the hook fails in a workspace the task did not touch, stop and report it.
- **Plan file.** This plan is drafted at `.superpowers/plan-drafts/2026-11-06-resource-manager.md` (gitignored, `.gitignore:107`). The controller copies it to `docs/superpowers/plans/2026-11-06-resource-manager.md` and commits it before Task 1. Every status check below is scoped to the paths the task touches.
- **Branches.** Tasks never create, switch, stash or rebase branches. They commit on whatever branch the controller checked out (`main` at `1eaa71b2f` when this plan was written, with shared-mcp merged).
- **Daemon:** never restart, stop or signal the Paseo daemon on port 6767. Manual tests use a dev daemon with `PASEO_HOME=/workspace/utils/paseo/.dev/paseo-home`, started with `env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD`, listening on `172.22.0.3:6768`. Abort the manual test and clean up whenever `MemAvailable` drops below 2500 MB.
- **Commits:** local only, never push (a push to main redeploys every instance through Dokploy). Author and committer `tatsuya <allrested@gmail.com>`, overriding the container's M-DAQ `GIT_*` env for that command only, by explicit pathspec:
  `flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "<message>" -- <paths>`
  Then `git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'` must print `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`. If a hook job fails, git creates no commit: report the hook output and stop. Do not fix files outside the task and do not bypass the hook.
- **Built-in import rules:** server files import only `@getpaseo/plugin/*`, `zod` and `node:*`; client files only `@getpaseo/plugin`, `@getpaseo/plugin/client*`, `react`, `react-native`, `@tanstack/react-query`, `zod`; `shared/` only `@getpaseo/plugin` and `zod`. Relative imports carry a `.js` suffix everywhere (NodeNext). No import from another plugin's directory (see the procfs section above).
- **In-process safety.** The plugin runs inside the daemon, and an uncaught exception or unhandled rejection exits the daemon. Every timer callback, child-process and stream `error` event, readline `line` handler and fire-and-forget promise is guarded. Every timer the plugin starts is `unref()`ed. Nothing starts at plugin start except a reclaim of the plugin's own pid files.
- **Never kill what this daemon does not own.** Pid files record the group, the owning daemon pid and start time, the pid namespace (`readlink /proc/self/ns/pid`), the boot id and the start time of the namespace's pid 1. A file from another namespace, boot or container run is stale and only removed. A group is killed only when its owner is dead and its leader's start time matches. Shared-mcp's pid files are read, never written, removed or signalled.
- **No secrets in files, logs or chat.** `/proc/<pid>/environ` is read for two markers only; nothing else from it leaves `parseMarkers`. Claude configs are parsed by schema and never logged; a config that does not parse is reported as `<file>: not valid JSON`, never with the parser's message (it quotes the text). The server list RPC returns id, name and source label only, never a command, argument or env value. Spawned ssh-mcp processes get the daemon env minus `PASEO_*` and the parent-session keys. No step prints `PASEO_PASSWORD`, tokens, `~/.claude/settings.json` values or `config.json`.
- **Types.** No `as` casts that bypass an error (`as const` is fine). Test files are excluded from the plugins typecheck (`plugins/tsconfig.json` `"exclude": ["node_modules", "**/*.test.ts"]`), so tests type their fixtures with interfaces and typed helpers, never with casts, and never with `vi.mock`, `vi.spyOn` or fake timers (`docs/testing.md`). Time and timers are injected (`now()`, `sleep()`, `TimerPort`).
- **Test env.** Tests that spawn the fake ssh-mcp pass it only `FAKE_SSH_MCP_*` overrides; the client strips every `PASEO_*` key from the rest, so a vitest run under the heavy gate or inside a Paseo agent cannot leak `PASEO_AGENT_ID` into the fake.
- **Copy rules (`docs/design.md` section 10):** sentence case; no trailing period on labels, buttons or single-clause hints; in-flight labels end in a literal three-dot `...` ("Closing..."), never `…`; short empty states ("No agent processes"); direct errors ("Unable to read this server"). Terms: workspace, host, project, provider.
- **Spec values:** instance tab refresh 5 s; server tab poll 30 s; ssh-mcp session closes 2 minutes after the last read; top 10 remote processes by RSS; RPCs `resource-manager.local.request`, `resource-manager.servers.request`, `resource-manager.server.request`, `resource-manager.close_agent.request`.
- **Formatting and lint:** `npm run format:files -- <paths>` and `npm run lint -- <paths>` from the repo root. Lint rules that shape the code below: `no-shadow`, `typescript/consistent-type-definitions: interface`, `complexity` 20, `max-depth` 4, `max-nested-callbacks` 3, `no-nested-ternary`, `oxc/no-map-spread` (no object spread in a `.map` callback), `promise/always-return` (prefer `async`/`await` over `.then`), `preserve-caught-error` (a rethrow carries `cause`), the react-perf `jsx-no-new-{function,object,array}-as-prop` rules, `react/jsx-max-depth` 6 and `typescript/no-explicit-any`.

## Decisions the spec leaves open

These are settled here; every task follows them.

1. **Built-in, not an installable plugin.** It needs `/proc`, the daemon's env and pid, and the in-process `paseo` client. Id `resource-manager`, manifest floor `>=0.15.2` (the fork's version, which ships `addSidebarHeaderItem` and `addScreen`).
2. **Shared procfs reader** by verbatim copy plus drift test (section above).
3. **Close needs a new daemon RPC.** No session RPC closes a runtime today: `delete_agent_request` (`packages/server/src/server/session.ts:3663-3673`) and `archive_agent_request` do more than close, and `AgentManager.closeAgent` (`packages/server/src/server/agent/agent-manager.ts:2055-2073`) is reachable only through `closeAgentCommand` (`packages/server/src/server/agent/lifecycle-command.ts:151-156`) and closes without idle collection's checks. Task 2 adds `agent.runtime.close.request`/`.response` (dotted name per `docs/rpc-namespacing.md`), permission `["workspace.write", "hub.execute"]` like `archive_agent_request`, the guarded `AgentManager.closeRuntimeIfIdle` behind it (decision 4), `DaemonClient.closeAgentRuntime` and `PaseoAgentHandle.closeRuntime()`. **Feature flag `server_info.features.agentRuntimeClose`**, per the feature contract in `docs/protocol-compatibility.md` and the repo `CLAUDE.md`: the daemon sets it in `buildServerInfoStatusPayload` (`packages/server/src/server/websocket-server.ts:2003-2018`), next to the fork's `agentMove`, and `DaemonClient.closeAgentRuntime` checks it before it sends, as `installPluginSource` checks `pluginSourceInstallation` (`packages/client/src/daemon-client.ts:6239-6242`) and `listProviderUsage` checks `providerUsageList` (`packages/client/src/index.ts:1109-1112`). An SDK caller on an older host then fails at once with "Update the host to close agent runtimes." instead of waiting out the 60 s request timeout (`daemon-client.ts:1132`). The schema line, the daemon line and the client gate each carry `// COMPAT(agentRuntimeClose): added after v0.15.2, remove gate after 2027-05-07.` The flag is optional, so an older client drops it when it parses `server_info`. The built-in always runs in a daemon of its own version, so the gate never refuses it.
4. **Close only an idle agent, and only when nothing is lost.** The plugin re-reads the agent with `refresh()`: `closed` is accepted as already done; any status but `idle` (`ClosableStatusSchema`) is refused with "Agent is busy; close it once it is idle", so an errored agent is refused too and its button is disabled (the spec says idle, and a failed turn is not idle); an idle agent whose snapshot has no `persistence` handle is refused with "This agent has no saved session to resume, so it stays open", since without one `ensureAgentLoaded` creates a fresh provider session (`packages/server/src/server/agent/agent-loading.ts:71-160`) instead of resuming. The daemon then repeats the checks idle collection makes before it ends a runtime, in `AgentManager.closeRuntimeIfIdle` (Task 2): a saved session (`agent-manager.ts:2022`); `runtimeHasNoPendingWork` (`:2039-2053`: no turn, permission, lifecycle work or running provider subagent); the provider's `canStopRuntime` probe under the collector's 10 s limit (`packages/server/src/server/agent/idle-runtime-cleanup/index.ts:57-72`); then `closeAgentRuntime(agentId, isEligible)` in the lifecycle lane behind the `collectingRuntimes` barrier, which rechecks after draining session events (`agent-manager.ts:2089-2090`). A failed check answers with its reason ("Agent may still run background work; close it once that ends" for the probe), the row shows it, and nothing is stopped: Close never ends a background task or a provider subagent. The barrier closes the prompt race the plugin's own check leaves open: a prompt admitted before the close moves `updatedAt`, so the recheck refuses; one that arrives during the close waits for it and resumes the saved session (`streamAfterRuntimeCollection`, `:2945-2965`). Task 2's AgentManager tests cover both orders. Close skips the collector's two family-wide checks, managed children (`idle-runtime-cleanup/index.ts:45-56`) and pending finish subscriptions or queued deliveries (`isProtected`, `packages/server/src/server/bootstrap.ts:1514-1516`): a child keeps its own runtime, and a delivery or finish notice resumes the closed agent through `ensureAgentLoaded` (`packages/server/src/server/agent/agent-prompt.ts:326-343`). Claude's probe says yes only for CLI 2.1.292 or newer, or once the CLI has sent a background-task roster (`packages/server/src/server/agent/providers/claude/runtime-safety.ts:16-41`); an older CLI keeps its runtime, and Close refuses it.
5. **Live agents** are those with status `initializing`, `idle`, `running` or `error`, background agents included (`includeBackground: true`), archived excluded. A process naming an agent outside that set counts under "Everything else".
6. **Attribution order** for each process, first match wins: in a shared-mcp server's tree; the daemon or supervisor pid itself; carries `PASEO_HEAVY_GATE_HELD=1`; carries `PASEO_AGENT_ID` (live agent, else "other"); else its parent's owner. The tree root and a ppid cycle are "other". The groups partition every process, so the rows add up to the process table.
7. **Supervisor detection.** The daemon worker's parent is the supervisor when its `cmdline` starts with `Paseo Supervisor` (`packages/server/scripts/supervisor-entrypoint.ts:19`).
8. **Idle time** is `now - updatedAt` while the status is `idle`. `updatedAt` also moves on title or label changes, so the figure is a lower bound.
9. **CPU %** is the sum of `utime + stime` deltas over the agent's or group's processes, keyed by `pid:startTime`, divided by `USER_HZ` (100) and the window, times 100, one decimal. 100% is one core. The window is the time since the previous reading; when there is none or it is older than 15 s, the reader samples twice, 1 s apart. Readings within 1 s are reused and concurrent reads share one.
10. **Memory** is cgroup v2 only (`/sys/fs/cgroup/memory.current`, `memory.max`, `memory.swap.current`). Without cgroup v2 the container row reads "Not available", and swap falls back to `SwapTotal - SwapFree`. `memory.max` of `max` reads "used, no cap". Cores are `os.availableParallelism()`.
11. **Discovery scope.** User scope: `mcpServers` in `$CLAUDE_CONFIG_DIR/.claude.json`, else `~/.claude.json`. Workspace scope, for each workspace Paseo lists (`workspaceDirectory ?? projectRootPath`): local scope `projects[<dir>].mcpServers` in the same file, and project scope `<dir>/.mcp.json`. Only stdio entries count. An entry runs ssh-mcp when its command, or a non-option argument before `--`, has a path segment equal to `ssh-mcp` or starting with `ssh-mcp@` (after `--` come ssh-mcp's own host, user and key arguments). `${VAR}` and `${VAR:-default}` expand against the daemon env; an unset variable without a default makes that server's tab show an error instead of starting it. Entries with the same command, args and env are one server (first source wins). `enabledMcpjsonServers`/`disabledMcpjsonServers` are not consulted: a configured server is shown even where Claude would not start it. Discovery is cached for 60 s.
12. **Server id** is the first 16 hex characters of `sha256(<source key> NUL <entry name>)`, stable across restarts and free of secrets.
13. **Tool choice.** `exec` (ssh-mcp 1.x) first, then `run-command` (2.x), both with `{ command }`. `read-command` (2.x) refuses `&` and so cannot run a chain. Neither tool means the error "This ssh-mcp offers neither exec nor run-command".
14. **The remote command** is the constant `echo @@meminfo && cat /proc/meminfo && echo @@loadavg && cat /proc/loadavg && echo @@nproc && nproc && echo @@df && df -P && echo @@ps && ps -eo pid,rss,comm`. No redirection, pipe, semicolon, variable or substitution, so neither ssh-mcp version's policy sees a write. `nproc` replaces `/proc/stat`, whose `intr` line runs to kilobytes on large hosts. `&&` makes a host without `/proc` fail at once with ssh-mcp's message (the spec's error state).
15. **Session lifecycle.** One MCP client per server, started on the first read, reused while reads keep coming, closed 2 minutes after the last read (the tab polls every 30 s, so a gap that long means it is closed). A read waits at most 40 s; past that it returns "No answer from ssh-mcp after 40 s; the reading shows on a later refresh" and the work continues for the next poll. Start timeout 120 s (first `npx` download), request timeout 70 s (ssh-mcp's own command timeout is 60 s). A session error, a timeout or an exit drops the client and the next read starts a new one; a tool error keeps it.
16. **Pid files for ssh-mcp groups** live at `<PASEO_HOME>/resource-manager/run/<serverId>-<pgid>.pid`, so a replaced session's file never collides with its successor's. The run directory is reclaimed once at plugin start.
17. **UI.** The tab bar shows only when at least one ssh-mcp server is configured; the server list is fetched once per screen visit. No Command Center item: the screen is reached from the sidebar item, which users can hide in Settings > Sidebar. Close uses a two-press confirm (5 s), since the SDK has no confirm dialog. The armed hint carries no warning, because the daemon refuses any close that would lose work (decision 4).
18. **Not here.** No rollout edits instance files in this sub-project; the check on the instance that has ssh-mcp is Task 14, deferred to sub-project 6 (ops), which the user deferred, so this plan's run does not execute it.

## File structure

```
plugins/resource-manager/
  paseo-plugin.json                     manifest (Task 1)
  index.server.ts                       RPC handlers and cleanup (Task 1 stub, final in Task 11)
  index.client.tsx                      sidebar item and screen (Task 12)
  shared/rpc.ts                         RPC contracts and payload types (Task 1)
  server/paths.ts                       PASEO_HOME, run dirs, Claude config path (Task 4)
  server/proc-text.ts                   meminfo and loadavg parsers (Task 3)
  server/pid-files.ts                   pid records, pid space, reclaim, group kill (Task 4)
  server/paseo-ports.ts                 narrow ports over the paseo client; list, close (Task 6)
  server/fake-ports.ts                  typed in-memory agents and workspaces (Task 6)
  server/plugin.ts                      createResourceManager: wiring and discovery cache (Task 11)
  server/local/procfs.ts                verbatim copy of shared-mcp's reader (Task 1)
  server/local/fake-proc.ts             typed fake /proc writer for tests (Task 4)
  server/local/host-summary.ts          cgroup, meminfo, loadavg header (Task 3)
  server/local/process-table.ts         per-process stat, RSS, CPU ticks, markers (Task 5)
  server/local/attribution.ts           process -> agent or group (Task 5)
  server/local/shared-mcp-groups.ts     pids under shared-mcp's pid files (Task 5)
  server/local/local-reader.ts          LocalReader: samples, CPU, rows (Task 6)
  server/remote/discovery.ts            ssh-mcp entries in Claude configs (Task 7)
  server/remote/remote-output.ts        REMOTE_COMMAND and its parsers (Task 8)
  server/remote/remote-output-sample.ts real output sample and its snapshot (Task 8)
  server/remote/mcp-stdio-client.ts     MCP JSON-RPC client over a child's stdio (Task 9)
  test/fake-ssh-mcp.mjs                 fake ssh-mcp stdio server for tests and the manual test (Task 9)
  server/remote/sessions.ts             RemoteSessions: per-server client, idle close, deadline (Task 10)
  server/remote/fakes.ts                FakeSessionClient, FakeTimers (Task 10)
  client/format.ts                      row text (Task 12)
  client/styles.ts                      screen styles from the host theme (Task 12)
  client/resources-screen.tsx           screen and tab bar (Task 12)
  client/instance-tab.tsx               This instance tab with Close (Task 12)
  client/server-tab.tsx                 one ssh-mcp server's tab (Task 12)
packages/protocol/src/messages.ts       agent.runtime.close schemas, agentRuntimeClose flag (Task 2)
packages/server/src/server/agent/agent-manager.ts   closeRuntimeIfIdle (Task 2)
packages/server/src/server/session.ts   close handler (Task 2)
packages/server/src/server/websocket-server.ts      agentRuntimeClose in server_info (Task 2)
packages/server/src/server/authorization/operation-permissions.ts   permissions (Task 2)
packages/client/src/daemon-client.ts    closeAgentRuntime and its feature gate (Task 2)
packages/client/src/index.ts            PaseoAgentHandle.closeRuntime (Task 2)
packages/server/src/server/plugins/builtin/index.ts                 registry entry (Task 1)
docs/agent-lifecycle.md, public-docs/sdk/reference.md, public-docs/sdk/reference.zh-CN.md   (Task 2)
docs/plugins.md                         built-in paragraph (Task 13)
```

Every module has a collocated test: `*.test.ts`, or `*.posix.test.ts` where it needs real processes, signals or file modes.

---

### Task 1: Scaffold, RPC contracts, procfs copy, registry entry

**Files:**

- Create: `plugins/resource-manager/paseo-plugin.json`
- Create: `plugins/resource-manager/index.server.ts` (stub; Task 11 replaces it)
- Create: `plugins/resource-manager/shared/rpc.ts`
- Test: `plugins/resource-manager/shared/rpc.test.ts`
- Create (by `cp`): `plugins/resource-manager/server/local/procfs.ts`
- Test: `plugins/resource-manager/server/local/procfs-copy.test.ts`
- Modify: `packages/server/src/server/plugins/builtin/index.ts:18-19` (add `"resource-manager"` between `"opencode-go-usage-source"` and `"shared-mcp"`; one line lower once the gate's `"heavy-command-gate"` entry is in, and Step 9's replacement matches either way)

**Interfaces:**

- Consumes:
  - `defineRpc<InputSchema, OutputSchema>(definition: { name; input; output }): PluginRpcContract<InputSchema, OutputSchema>` (`packages/plugin/src/rpc.ts:29-35`); names must match `^[a-z][a-z0-9._-]*$` (`rpc.ts:27`).
  - `plugins/shared-mcp/server/procfs.ts` as it stands on `main` (exports `ProcStat`, `ProcessTreeEntry`, `ProcStatParseError`, `parseStat(stat: string): ProcStat`, `parseVmRssBytes(status: string): number | null`, `walkProcessTree(pgid: number, procRoot = "/proc"): ProcessTreeEntry[]`, `readProcessGroupRss(pgid: number, procRoot = "/proc"): Promise<number | null>`).
  - `builtinPlugins` (`packages/server/src/server/plugins/builtin/index.ts:5`), iterated by `BuiltinPluginLoader`, `builtin/index.test.ts`, `scripts/builtin-plugins-dist.test.mjs` and the packaged-app smoke.
- Produces (`plugins/resource-manager/shared/rpc.ts`):
  - `LiveStatusSchema = z.enum(["initializing", "idle", "running", "error"])`, `type LiveStatus`
  - `ClosableStatusSchema = z.enum(["idle"])`, `isClosableStatus(status: string): boolean`
  - `GroupKindSchema = z.enum(["daemon", "sharedMcp", "heavyGate", "other"])`, `type GroupKind`
  - `HostSummary { memoryUsedBytes, memoryLimitBytes, swapUsedBytes, swapTotalBytes, hostAvailableBytes, hostTotalBytes, load1, load5, load15: number | null; cores: number }`
  - `AgentUsage { agentId: string; title: string | null; provider: string; status: LiveStatus; rssBytes: number; cpuPercent: number | null; idleSince: string | null; processCount: number }`
  - `GroupUsage { kind: GroupKind; rssBytes: number; cpuPercent: number | null; processCount: number }`
  - `LocalReading { readAt: string; host: HostSummary; agents: AgentUsage[]; groups: GroupUsage[]; agentsError: string | null }`
  - `ServerEntry { id: string; name: string; source: string }`, `ServerList { servers: ServerEntry[]; problems: string[] }`
  - `MountUsage { mount: string; totalBytes; usedBytes; availableBytes: number }`, `RemoteProcess { pid: number; rssBytes: number; command: string }`
  - `RemoteSnapshot { memTotalBytes; memAvailableBytes; swapTotalBytes; swapFreeBytes; load1; load5; load15: number; cores: number; mounts: MountUsage[]; processes: RemoteProcess[] }`
  - `ServerReading { id: string; snapshot: RemoteSnapshot | null; readAt: string | null; error: string | null }`
  - `CloseAgentResult { ok: boolean; error: string | null }`
  - `localRpc` (`"resource-manager.local.request"`, `{}` -> `LocalReading`), `serversRpc` (`"resource-manager.servers.request"`, `{}` -> `ServerList`), `serverRpc` (`"resource-manager.server.request"`, `{ id: string }` -> `ServerReading`), `closeAgentRpc` (`"resource-manager.close_agent.request"`, `{ agentId: string }` -> `CloseAgentResult`)
  - `plugins/resource-manager/server/local/procfs.ts`: the same exports as shared-mcp's, byte for byte.
  - Built-in id `"resource-manager"` in `builtinPlugins`.

- [ ] **Step 1: Write the failing contract test**

Create `plugins/resource-manager/shared/rpc.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  closeAgentRpc,
  GroupKindSchema,
  isClosableStatus,
  localRpc,
  LocalReadingSchema,
  serverRpc,
  serversRpc,
  type HostSummary,
  type LocalReading,
} from "./rpc.js";

const HOST: HostSummary = {
  memoryUsedBytes: 3 * 1024 ** 3,
  memoryLimitBytes: null,
  swapUsedBytes: 0,
  swapTotalBytes: 0,
  hostAvailableBytes: 7 * 1024 ** 3,
  hostTotalBytes: 16 * 1024 ** 3,
  load1: 1.54,
  load5: 1.88,
  load15: 2.22,
  cores: 2,
};

const READING: LocalReading = {
  readAt: "2026-11-06T09:00:00.000Z",
  host: HOST,
  agents: [],
  groups: [],
  agentsError: null,
};

describe("resource-manager RPC contracts", () => {
  it("uses the RPC names from the spec", () => {
    expect([localRpc.name, serversRpc.name, serverRpc.name, closeAgentRpc.name]).toEqual([
      "resource-manager.local.request",
      "resource-manager.servers.request",
      "resource-manager.server.request",
      "resource-manager.close_agent.request",
    ]);
  });

  it("lists the four groups in display order", () => {
    expect(GroupKindSchema.options).toEqual(["daemon", "sharedMcp", "heavyGate", "other"]);
  });

  it("lets only idle agents be closed", () => {
    const statuses = ["initializing", "idle", "running", "error", "closed"];
    expect(statuses.map((status) => isClosableStatus(status))).toEqual([
      false,
      true,
      false,
      false,
      false,
    ]);
  });

  it("accepts a reading with a positive core count and rejects zero cores", () => {
    expect(LocalReadingSchema.safeParse(READING).success).toBe(true);
    const zeroCores: LocalReading = { ...READING, host: { ...HOST, cores: 0 } };
    expect(LocalReadingSchema.safeParse(zeroCores).success).toBe(false);
  });

  it("refuses an empty server id and an empty agent id", () => {
    expect(serverRpc.input.safeParse({ id: "" }).success).toBe(false);
    expect(serverRpc.input.safeParse({ id: "0123456789abcdef" }).success).toBe(true);
    expect(closeAgentRpc.input.safeParse({ agentId: "" }).success).toBe(false);
    expect(closeAgentRpc.input.safeParse({ agentId: "agent-1" }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/shared/rpc.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './rpc.js'` (the module does not exist yet).

- [ ] **Step 3: Write the contracts**

Create `plugins/resource-manager/shared/rpc.ts`:

```ts
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Agent statuses whose runtime can hold processes. A "closed" agent has none, so it gets no row.
export const LiveStatusSchema = z.enum(["initializing", "idle", "running", "error"]);
export type LiveStatus = z.output<typeof LiveStatusSchema>;

// Close ends a runtime only while the agent is idle. A starting, running or errored agent keeps it.
export const ClosableStatusSchema = z.enum(["idle"]);

export function isClosableStatus(status: string): boolean {
  return ClosableStatusSchema.safeParse(status).success;
}

// Display order of the group rows.
export const GroupKindSchema = z.enum(["daemon", "sharedMcp", "heavyGate", "other"]);
export type GroupKind = z.output<typeof GroupKindSchema>;

export const HostSummarySchema = z.object({
  /** cgroup v2 memory.current; null without cgroup v2. */
  memoryUsedBytes: z.number().nullable(),
  /** cgroup v2 memory.max; null when it reads "max" (no cap) or is missing. */
  memoryLimitBytes: z.number().nullable(),
  swapUsedBytes: z.number().nullable(),
  swapTotalBytes: z.number().nullable(),
  hostAvailableBytes: z.number().nullable(),
  hostTotalBytes: z.number().nullable(),
  load1: z.number().nullable(),
  load5: z.number().nullable(),
  load15: z.number().nullable(),
  cores: z.number().int().positive(),
});
export type HostSummary = z.output<typeof HostSummarySchema>;

export const AgentUsageSchema = z.object({
  agentId: z.string(),
  title: z.string().nullable(),
  provider: z.string(),
  status: LiveStatusSchema,
  rssBytes: z.number(),
  /** 100 is one core. Null when the sample window is empty. */
  cpuPercent: z.number().nullable(),
  /** The agent's updatedAt while it is idle, else null. */
  idleSince: z.string().nullable(),
  processCount: z.number().int(),
});
export type AgentUsage = z.output<typeof AgentUsageSchema>;

export const GroupUsageSchema = z.object({
  kind: GroupKindSchema,
  rssBytes: z.number(),
  cpuPercent: z.number().nullable(),
  processCount: z.number().int(),
});
export type GroupUsage = z.output<typeof GroupUsageSchema>;

export const LocalReadingSchema = z.object({
  readAt: z.string(),
  host: HostSummarySchema,
  agents: z.array(AgentUsageSchema),
  groups: z.array(GroupUsageSchema),
  /** Why the agent list failed. Agent processes then count under "other". */
  agentsError: z.string().nullable(),
});
export type LocalReading = z.output<typeof LocalReadingSchema>;

export const ServerEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Where the entry was found, such as "User config" or "/repo/.mcp.json". */
  source: z.string(),
});
export type ServerEntry = z.output<typeof ServerEntrySchema>;

export const ServerListSchema = z.object({
  servers: z.array(ServerEntrySchema),
  /** Config files that could not be read, one line each, without their content. */
  problems: z.array(z.string()),
});
export type ServerList = z.output<typeof ServerListSchema>;

export const MountUsageSchema = z.object({
  mount: z.string(),
  totalBytes: z.number(),
  usedBytes: z.number(),
  availableBytes: z.number(),
});
export type MountUsage = z.output<typeof MountUsageSchema>;

export const RemoteProcessSchema = z.object({
  pid: z.number().int(),
  rssBytes: z.number(),
  command: z.string(),
});
export type RemoteProcess = z.output<typeof RemoteProcessSchema>;

export const RemoteSnapshotSchema = z.object({
  memTotalBytes: z.number(),
  memAvailableBytes: z.number(),
  swapTotalBytes: z.number(),
  swapFreeBytes: z.number(),
  load1: z.number(),
  load5: z.number(),
  load15: z.number(),
  cores: z.number().int().positive(),
  mounts: z.array(MountUsageSchema),
  processes: z.array(RemoteProcessSchema),
});
export type RemoteSnapshot = z.output<typeof RemoteSnapshotSchema>;

export const ServerReadingSchema = z.object({
  id: z.string(),
  /** The last reading that parsed. It stays while later readings fail. */
  snapshot: RemoteSnapshotSchema.nullable(),
  readAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type ServerReading = z.output<typeof ServerReadingSchema>;

export const CloseAgentResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
});
export type CloseAgentResult = z.output<typeof CloseAgentResultSchema>;

export const localRpc = defineRpc({
  name: "resource-manager.local.request",
  input: z.object({}),
  output: LocalReadingSchema,
});

export const serversRpc = defineRpc({
  name: "resource-manager.servers.request",
  input: z.object({}),
  output: ServerListSchema,
});

export const serverRpc = defineRpc({
  name: "resource-manager.server.request",
  input: z.object({ id: z.string().min(1) }),
  output: ServerReadingSchema,
});

export const closeAgentRpc = defineRpc({
  name: "resource-manager.close_agent.request",
  input: z.object({ agentId: z.string().min(1) }),
  output: CloseAgentResultSchema,
});
```

- [ ] **Step 4: Run the contract test and confirm it passes**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/shared/rpc.test.ts --bail=1
```

Expected: PASS, 5 tests.

- [ ] **Step 5: Write the failing drift test for the procfs copy**

Create `plugins/resource-manager/server/local/procfs-copy.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// server/local/procfs.ts is a verbatim copy of shared-mcp's reader: a built-in may import only
// from its own directory. This test reads both files (it imports neither) and fails on any
// difference, so a change to one has to be copied to the other.
const COPY = fileURLToPath(new URL("./procfs.ts", import.meta.url));
const ORIGINAL = fileURLToPath(new URL("../../../shared-mcp/server/procfs.ts", import.meta.url));

describe("procfs copy", () => {
  it("matches plugins/shared-mcp/server/procfs.ts byte for byte", () => {
    expect(readFileSync(COPY, "utf8")).toBe(readFileSync(ORIGINAL, "utf8"));
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/local/procfs-copy.test.ts --bail=1
```

Expected: FAIL with `ENOENT: no such file or directory, open '/workspace/utils/paseo/plugins/resource-manager/server/local/procfs.ts'`.

- [ ] **Step 7: Copy the reader**

```bash
cd /workspace/utils/paseo && cp plugins/shared-mcp/server/procfs.ts plugins/resource-manager/server/local/procfs.ts && cmp plugins/shared-mcp/server/procfs.ts plugins/resource-manager/server/local/procfs.ts && echo identical
```

Expected: `identical`. Do not edit the copy, not even to format it.

- [ ] **Step 8: Run the drift test and confirm it passes**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/local/procfs-copy.test.ts --bail=1
```

Expected: PASS, 1 test.

- [ ] **Step 9: Add the registry entry**

In `packages/server/src/server/plugins/builtin/index.ts`, replace

```ts
  "opencode-go-usage-source",
  "shared-mcp",
```

with

```ts
  "opencode-go-usage-source",
  "resource-manager",
  "shared-mcp",
```

- [ ] **Step 10: Run the built-in compile test and confirm it fails**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: FAIL with `Error: Plugin manifest is missing: /workspace/utils/paseo/plugins/resource-manager/paseo-plugin.json`.

- [ ] **Step 11: Write the manifest and the stub server entry**

Create `plugins/resource-manager/paseo-plugin.json`:

```json
{ "id": "resource-manager", "requirements": { "paseo": ">=0.15.2" } }
```

Create `plugins/resource-manager/index.server.ts`:

```ts
// Task 11 replaces this stub with the four RPC handlers. Until then the built-in starts, reads
// nothing and writes nothing.
export default function contribute(): () => void {
  return () => {};
}
```

- [ ] **Step 12: Run the built-in registry test file and confirm it passes**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts --bail=1
```

Expected: PASS, 4 tests. The compile test reads `plugins/resource-manager/paseo-plugin.json` and compiles `index.server.ts` with the boundary checks; `client` is `null` because no `index.client.tsx` exists yet.

- [ ] **Step 13: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/resource-manager/paseo-plugin.json plugins/resource-manager/index.server.ts plugins/resource-manager/shared/rpc.ts plugins/resource-manager/shared/rpc.test.ts plugins/resource-manager/server/local/procfs-copy.test.ts packages/server/src/server/plugins/builtin/index.ts
cd /workspace/utils/paseo && cmp plugins/shared-mcp/server/procfs.ts plugins/resource-manager/server/local/procfs.ts && echo "copy still identical"
cd /workspace/utils/paseo && npm run lint -- plugins/resource-manager packages/server/src/server/plugins/builtin/index.ts
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: oxfmt exits 0; `copy still identical` (the copy is not in the format list, and shared-mcp's file is already formatted); `Found 0 warnings and 0 errors.`; typecheck exit 0. If oxfmt rewrote `rpc.test.ts` or `rpc.ts`, re-run Step 4.

- [ ] **Step 14: Commit**

```bash
git -C /workspace/utils/paseo add plugins/resource-manager/paseo-plugin.json plugins/resource-manager/index.server.ts plugins/resource-manager/shared/rpc.ts plugins/resource-manager/shared/rpc.test.ts plugins/resource-manager/server/local/procfs.ts plugins/resource-manager/server/local/procfs-copy.test.ts packages/server/src/server/plugins/builtin/index.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): scaffold resource-manager built-in plugin" -- plugins/resource-manager/paseo-plugin.json plugins/resource-manager/index.server.ts plugins/resource-manager/shared/rpc.ts plugins/resource-manager/shared/rpc.test.ts plugins/resource-manager/server/local/procfs.ts plugins/resource-manager/server/local/procfs-copy.test.ts packages/server/src/server/plugins/builtin/index.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/resource-manager packages/server/src/server/plugins/builtin
```

Expected: lefthook's `format`, `lint` and `typecheck` jobs pass; `[main <sha>] feat(fork): scaffold resource-manager built-in plugin`, `7 files changed`; `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` lists exactly the seven paths; `status` prints nothing.

---

### Task 2: Daemon RPC `agent.runtime.close` and `PaseoAgentHandle.closeRuntime()`

Close must end an idle agent's runtime through the SDK (spec, Safety), and no session RPC does that today (decision 3). This task adds one, end to end, with tests at every layer. The daemon applies idle collection's checks before it closes and refuses with a reason otherwise (decision 4), and the SDK checks a `server_info.features` flag before it sends (decision 3).

**Files:**

- Modify: `packages/protocol/src/messages.ts` (schemas after `AgentDetachResponseMessageSchema` at `:2116-2119`; inbound union entry after `AgentDetachRequestMessageSchema,` at `:3496`; feature flag after `agentMove: z.boolean().optional(),` at `:3798`; outbound union entry after `AgentDetachResponseMessageSchema,` at `:7294`; types after `:7503` and `:7681`)
- Test: `packages/protocol/src/messages.test.ts` (new `describe` after "agent detach RPC", `:291`)
- Modify: `packages/client/src/daemon-client.ts` (method after `detachAgent`, `:3478-3488`)
- Test: `packages/client/src/daemon-client.test.ts` (after the detach test at `:5680-5719`)
- Modify: `packages/client/src/index.ts` (interface member after `detach(): Promise<void>;` at `:401`; implementation after `detach` at `:1026-1028`)
- Test: `packages/client/src/index.test.ts` (after the archive handle test that ends at `:1086`)
- Modify: `packages/server/src/server/agent/agent-manager.ts` (constants after `:113`; two methods before `closeAgentRuntime` at `:2075`)
- Test: `packages/server/src/server/agent/agent-manager.test.ts` (at the end of the file, after the idle cleanup tests that use `idleCleanupHarness`)
- Modify: `packages/server/src/server/authorization/operation-permissions.ts` (after `:19` and after `:251`)
- Modify: `packages/server/src/server/session.ts` (case in `dispatchAgentRelationshipMessage`, `:3080-3087`; handler after `handleDetachAgentRequest`, `:3740-3789`)
- Test: `packages/server/src/server/session.test.ts` (new `describe` after "agent detach RPC", which starts at `:1664`)
- Modify: `packages/server/src/server/websocket-server.ts` (feature after `agentMove: true,` at `:2018`)
- Test: `packages/server/src/server/websocket-server.relay-reconnect.test.ts` (one assertion in "advertises current features in initial server_info", `:1142-1163`)
- Modify: `docs/agent-lifecycle.md` (after the "runtime safety contract" paragraph, `:96-97`), `public-docs/sdk/reference.md` (row after `:108`), `public-docs/sdk/reference.zh-CN.md` (row after `:104`)

**Interfaces:**

- Consumes:
  - `AgentActionResponsePayloadSchema = z.object({ requestId: z.string(), agentId: z.string(), accepted: z.boolean(), error: z.string().nullable(), notice: AgentProviderNoticeSchema.nullable().optional() })` (`packages/protocol/src/messages.ts:2028-2034`, module-private).
  - The `features` object of `ServerInfoStatusPayloadSchema` (`messages.ts:3778-3993`), a plain `z.object`, so parsing drops a flag it does not declare; `parseServerInfoStatusPayload(payload: unknown): ServerInfoStatusPayload | null` (`messages.ts:7991`).
  - In `packages/server/src/server/agent/agent-manager.ts`: `agents: Map<string, LiveManagedAgent>` (`:813`); `collectingRuntimes: Set<string>` (`:834`); `private runtimeHasNoPendingWork(agent: LiveManagedAgent): boolean` (`:2039-2053`), which passes during a lifecycle mutation only while `collectingRuntimes` holds the agent; `private runLifecycleMutation<T>(agentId: string, mutation: () => Promise<T>): Promise<T>` (`:2711-2727`); `private async closeAgentRuntime(agentId: string, canClose?: () => boolean): Promise<boolean>` (`:2075-2119`), which rechecks `canClose` after draining session events (`:2089-2090`) and resolves `false` without closing when the recheck fails; `withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T>` (`packages/server/src/utils/promise-timeout.ts:7`, imported at `agent-manager.ts:108`); `AgentSession.canStopRuntime?(): Promise<boolean>` (`agent-sdk-types.ts:711`). Idle collection makes the same checks in the `isEligible` closure and `closeIfEligible` (`agent-manager.ts:2008-2032`) and probes under a 10 s `withTimeout` (`idle-runtime-cleanup/index.ts:57-72`). `streamAgent` sends a prompt for an agent behind the barrier, or not loaded, to `streamAfterRuntimeCollection`, which waits for the close and resumes the saved session (`:2945-2965`).
  - `this.agentManager.getAgent(agentId) ?? (await this.agentStorage.get(agentId))`, the known-agent check `handleDeleteAgentRequest` uses (`session.ts:3666-3667`); `getErrorMessageOr(error, fallback)` (`session.ts:96`).
  - `sendNamespacedCorrelatedSessionRequest<"<type>.response">({ message })` (`packages/client/src/daemon-client.ts:2395-2411`): sends `<type>.request` with a fresh `requestId` and resolves with the matching response's `payload`; default timeout 60 s (`:1132`). `getLastServerInfoMessage(): ServerInfoStatusPayload | null` (`:6952`), checked before the request the way `installPluginSource` checks `pluginSourceInstallation` (`:6239-6242`).
  - Test helpers: `idleCleanupHarness()` (`agent-manager.test.ts:12862-12932`: `create()`, `probes[i]` answers `canStopRuntime` for the i-th created session and defaults to `false`, `holdClose(gate)`, `closeEntered`, `closes`, `prompts`), `deferred<T>()` (`:66-80`), `TestAgentClient` (`:211`), `logger` (`:1933`); `createSessionForTest({ messages, agentManager, agentStorage })` (`session.test.ts:357`); `createMockTransport()` with `triggerOpen({ features })` (`daemon-client.test.ts:64`, default features `{ ownedSubscriptions: true }` at `:122`); `connectClient(features)` (`index.test.ts:98-136`); `attachRelayAndHello` (`websocket-server.relay-reconnect.test.ts:437-451`).
- Produces:
  - Wire: `agent.runtime.close.request { type, agentId: string, requestId: string }` and `agent.runtime.close.response { type, payload: { requestId, agentId, accepted, error: string | null, notice? } }`. An unknown agent answers `accepted: false, error: "Agent <id> not found"`; a known agent whose runtime closed, or was not loaded, answers `accepted: true, error: null`; an agent that keeps its runtime answers `accepted: false` with the reason; a failed close answers `accepted: false` with the error's message.
  - `server_info.features.agentRuntimeClose?: boolean`, which the daemon sets to `true`.
  - Permission `["workspace.write", "hub.execute"]` for both, as `archive_agent_request`.
  - `AgentManager.closeRuntimeIfIdle(agentId: string): Promise<string | null>`: `null` once the runtime is closed, or when it was not loaded; otherwise one of "This agent has no saved session to resume, so it stays open", "Agent is busy; close it once it is idle" or "Agent may still run background work; close it once that ends", and nothing is stopped.
  - `DaemonClient.closeAgentRuntime(agentId: string): Promise<void>`, throwing `new Error("Update the host to close agent runtimes.")` without sending when the host does not advertise `agentRuntimeClose`, and `new Error(payload.error ?? "closeAgentRuntime rejected")` when not accepted.
  - `PaseoAgentHandle.closeRuntime(): Promise<void>` ("Ends an idle agent's provider runtime, or rejects with the reason it stays open.").
  - Types `AgentRuntimeCloseRequestMessage`, `AgentRuntimeCloseResponseMessage`.

- [ ] **Step 1: Write the failing protocol tests**

In `packages/protocol/src/messages.test.ts`, add after the `describe("agent detach RPC", ...)` block:

```ts
describe("agent runtime close RPC", () => {
  test("parses the request", () => {
    const request = {
      type: "agent.runtime.close.request",
      agentId: "agent-1",
      requestId: "req-close",
    };

    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("parses an accepted and a refused response", () => {
    const accepted = {
      type: "agent.runtime.close.response",
      payload: { requestId: "req-close", agentId: "agent-1", accepted: true, error: null },
    };
    const refused = {
      type: "agent.runtime.close.response",
      payload: {
        requestId: "req-close-2",
        agentId: "agent-2",
        accepted: false,
        error: "Agent is busy; close it once it is idle",
      },
    };

    expect(SessionOutboundMessageSchema.parse(accepted)).toEqual(accepted);
    expect(SessionOutboundMessageSchema.parse(refused)).toEqual(refused);
  });

  test("parses the agentRuntimeClose server feature gate", () => {
    const parsed = parseServerInfoStatusPayload({
      status: "server_info",
      serverId: "srv-test",
      features: {
        agentRuntimeClose: true,
      },
    });

    if (!parsed) {
      throw new Error("Expected server info payload to parse");
    }
    expect(parsed.features?.agentRuntimeClose).toBe(true);
  });
});
```

`SessionInboundMessageSchema`, `SessionOutboundMessageSchema` and `parseServerInfoStatusPayload` are already imported; the "agent detach RPC" tests use all three.

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo/packages/protocol && flock /tmp/paseo-heavy.lock npx vitest run src/messages.test.ts -t "agent runtime close RPC" --bail=1
```

Expected: FAIL with a `ZodError` on the request (`Invalid input` at `type`), since no schema accepts `agent.runtime.close.request`.

- [ ] **Step 3: Add the schemas, union entries, types and feature flag**

In `packages/protocol/src/messages.ts`, after

```ts
export const AgentDetachResponseMessageSchema = z.object({
  type: z.literal("agent.detach.response"),
  payload: AgentActionResponsePayloadSchema,
});
```

add

```ts
// Ends an idle agent's runtime; the agent stays and its next prompt resumes it. The daemon makes
// idle collection's checks first and answers accepted: false with the reason when one fails.
export const AgentRuntimeCloseRequestMessageSchema = z.object({
  type: z.literal("agent.runtime.close.request"),
  agentId: z.string(),
  requestId: z.string(),
});

export const AgentRuntimeCloseResponseMessageSchema = z.object({
  type: z.literal("agent.runtime.close.response"),
  payload: AgentActionResponsePayloadSchema,
});
```

In the inbound union, replace `  AgentDetachRequestMessageSchema,\n  AgentRewindRequestMessageSchema,` with:

```ts
  AgentDetachRequestMessageSchema,
  AgentRuntimeCloseRequestMessageSchema,
  AgentRewindRequestMessageSchema,
```

In the `features` object of `ServerInfoStatusPayloadSchema`, replace

```ts
        // Fork delta (session move): the agent.move* and agent.move_targets RPCs, agent.moved.
        agentMove: z.boolean().optional(),
```

with

```ts
        // Fork delta (session move): the agent.move* and agent.move_targets RPCs, agent.moved.
        agentMove: z.boolean().optional(),
        // Fork delta (resource manager): the agent.runtime.close RPC.
        // COMPAT(agentRuntimeClose): added after v0.15.2, remove gate after 2027-05-07.
        agentRuntimeClose: z.boolean().optional(),
```

In the outbound union, replace `  AgentDetachResponseMessageSchema,\n  AgentRewindResponseMessageSchema,` with:

```ts
  AgentDetachResponseMessageSchema,
  AgentRuntimeCloseResponseMessageSchema,
  AgentRewindResponseMessageSchema,
```

After `export type AgentDetachResponseMessage = z.infer<typeof AgentDetachResponseMessageSchema>;` add:

```ts
export type AgentRuntimeCloseResponseMessage = z.infer<
  typeof AgentRuntimeCloseResponseMessageSchema
>;
```

After `export type AgentDetachRequestMessage = z.infer<typeof AgentDetachRequestMessageSchema>;` add:

```ts
export type AgentRuntimeCloseRequestMessage = z.infer<typeof AgentRuntimeCloseRequestMessageSchema>;
```

The flag is optional, so an older client parses this daemon's `server_info` and drops it, and an older daemon's `server_info` parses here without it (`docs/protocol-compatibility.md`).

- [ ] **Step 4: Run the protocol test file and confirm it passes**

```bash
cd /workspace/utils/paseo/packages/protocol && flock /tmp/paseo-heavy.lock npx vitest run src/messages.test.ts --bail=1
```

Expected: PASS, every test in the file, including the 3 new ones. The `pretest` script regenerates the AOT validators (`src/generated/validation/*.aot.ts`, gitignored) from the new union.

- [ ] **Step 5: Build the protocol package so client and server see the new types**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run build --workspace=@getpaseo/protocol
```

Expected: exit 0. Client and server tests read the protocol from `dist`, so the flag parses from here on.

- [ ] **Step 6: Write the failing daemon-client tests**

In `packages/client/src/daemon-client.test.ts`, after the test "detaches an agent through the namespaced detach RPC", add:

```ts
test("closeAgentRuntime sends agent.runtime.close and resolves when accepted", async () => {
  const logger = createMockLogger();
  const mock = createMockTransport();

  const client = new DaemonClient({
    url: "ws://test",
    clientId: "clsk_unit_test",
    logger,
    reconnect: { enabled: false },
    transportFactory: () => mock.transport,
  });
  clients.push(client);

  const connectPromise = client.connect();
  mock.triggerOpen({ features: { ownedSubscriptions: true, agentRuntimeClose: true } });
  await connectPromise;

  const promise = client.closeAgentRuntime("agent-1");

  expect(mock.sent).toHaveLength(1);
  const request = parseSentFrame(mock.sent[0]);
  expect(request).toMatchObject({ type: "agent.runtime.close.request", agentId: "agent-1" });
  expect(typeof request.requestId).toBe("string");

  mock.triggerMessage(
    wrapSessionMessage({
      type: "agent.runtime.close.response",
      payload: { requestId: request.requestId, agentId: "agent-1", accepted: true, error: null },
    }),
  );

  await expect(promise).resolves.toBeUndefined();
});

test("closeAgentRuntime rejects with the reason the daemon keeps the runtime", async () => {
  const logger = createMockLogger();
  const mock = createMockTransport();

  const client = new DaemonClient({
    url: "ws://test",
    clientId: "clsk_unit_test",
    logger,
    reconnect: { enabled: false },
    transportFactory: () => mock.transport,
  });
  clients.push(client);

  const connectPromise = client.connect();
  mock.triggerOpen({ features: { ownedSubscriptions: true, agentRuntimeClose: true } });
  await connectPromise;

  const promise = client.closeAgentRuntime("agent-busy");
  const request = parseSentFrame(mock.sent[0]);

  mock.triggerMessage(
    wrapSessionMessage({
      type: "agent.runtime.close.response",
      payload: {
        requestId: request.requestId,
        agentId: "agent-busy",
        accepted: false,
        error: "Agent is busy; close it once it is idle",
      },
    }),
  );

  await expect(promise).rejects.toThrow("Agent is busy; close it once it is idle");
});

test("closeAgentRuntime fails fast on a host without agentRuntimeClose", async () => {
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
  mock.triggerOpen();
  await connectPromise;

  await expect(client.closeAgentRuntime("agent-old-host")).rejects.toThrow(
    "Update the host to close agent runtimes.",
  );
  expect(mock.sent).toEqual([]);
});
```

The third test copies "gates config reload on the daemon capability" (`daemon-client.test.ts:2038-2056`): the default `triggerOpen()` advertises `{ ownedSubscriptions: true }` only.

- [ ] **Step 7: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo/packages/client && flock /tmp/paseo-heavy.lock npx vitest run src/daemon-client.test.ts -t "closeAgentRuntime" --bail=1
```

Expected: FAIL with `TypeError: client.closeAgentRuntime is not a function`.

- [ ] **Step 8: Add `closeAgentRuntime`**

In `packages/client/src/daemon-client.ts`, after the `detachAgent` method, add:

```ts
  async closeAgentRuntime(agentId: string): Promise<void> {
    // COMPAT(agentRuntimeClose): added after v0.15.2, remove gate after 2027-05-07.
    if (this.getLastServerInfoMessage()?.features?.agentRuntimeClose !== true) {
      throw new Error("Update the host to close agent runtimes.");
    }
    const payload =
      await this.sendNamespacedCorrelatedSessionRequest<"agent.runtime.close.response">({
        message: {
          type: "agent.runtime.close.request",
          agentId,
        },
      });
    if (!payload.accepted) {
      throw new Error(payload.error ?? "closeAgentRuntime rejected");
    }
  }
```

The gate sits in `DaemonClient`, so the handle method and any direct `DaemonClient` caller fail the same way.

- [ ] **Step 9: Run the three tests and confirm they pass**

```bash
cd /workspace/utils/paseo/packages/client && flock /tmp/paseo-heavy.lock npx vitest run src/daemon-client.test.ts -t "closeAgentRuntime" --bail=1
```

Expected: PASS, 3 tests.

- [ ] **Step 10: Write the failing handle tests**

In `packages/client/src/index.test.ts`, after the test that ends with `expect(agent.archivedAt).toBe("2026-05-16T01:00:00.000Z");` and its `unsubscribe(); await client.close(); });`, add:

```ts
test("agent handle closeRuntime sends agent.runtime.close", async () => {
  const { client, ws } = await connectClient({ ownedSubscriptions: true, agentRuntimeClose: true });
  const agent = client.agents.ref("agent_sdk");

  const closePromise = agent.closeRuntime();
  const request = parseSentSessionMessage(ws.sent.at(-1));
  expect(request).toMatchObject({ type: "agent.runtime.close.request", agentId: "agent_sdk" });
  ws.message(
    sessionMessage({
      type: "agent.runtime.close.response",
      payload: { requestId: request.requestId, agentId: "agent_sdk", accepted: true, error: null },
    }),
  );

  await expect(closePromise).resolves.toBeUndefined();
  await client.close();
});

test("agent handle closeRuntime rejects with the daemon's reason", async () => {
  const { client, ws } = await connectClient({ ownedSubscriptions: true, agentRuntimeClose: true });
  const agent = client.agents.ref("agent_busy");

  const closePromise = agent.closeRuntime();
  const request = parseSentSessionMessage(ws.sent.at(-1));
  ws.message(
    sessionMessage({
      type: "agent.runtime.close.response",
      payload: {
        requestId: request.requestId,
        agentId: "agent_busy",
        accepted: false,
        error: "Agent is busy; close it once it is idle",
      },
    }),
  );

  await expect(closePromise).rejects.toThrow("Agent is busy; close it once it is idle");
  await client.close();
});

test("agent handle closeRuntime fails fast on a host without agentRuntimeClose", async () => {
  const { client, ws } = await connectClient();
  const sentBeforeClose = ws.sent.length;

  await expect(client.agents.ref("agent_sdk").closeRuntime()).rejects.toThrow(
    "Update the host to close agent runtimes.",
  );
  expect(ws.sent).toHaveLength(sentBeforeClose);

  await client.close();
});
```

The third test copies "provider usage requires the advertised host capability" (`index.test.ts:1604-1613`); `connectClient()`'s default features do not include `agentRuntimeClose`.

- [ ] **Step 11: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo/packages/client && flock /tmp/paseo-heavy.lock npx vitest run src/index.test.ts -t "agent handle closeRuntime" --bail=1
```

Expected: FAIL with `TypeError: agent.closeRuntime is not a function`.

- [ ] **Step 12: Add `closeRuntime` to the handle**

In `packages/client/src/index.ts`, replace

```ts
  archive(): Promise<{ archivedAt: string }>;
  detach(): Promise<void>;
```

with

```ts
  archive(): Promise<{ archivedAt: string }>;
  detach(): Promise<void>;
  /**
   * Ends an idle agent's provider runtime, or rejects with the reason it stays open. The agent
   * stays, and its next prompt resumes it. Needs a host that advertises `agentRuntimeClose`.
   */
  closeRuntime(): Promise<void>;
```

and replace

```ts
      detach: async () => {
        await daemonClient.detachAgent(id);
      },
```

with

```ts
      detach: async () => {
        await daemonClient.detachAgent(id);
      },
      closeRuntime: async () => {
        await daemonClient.closeAgentRuntime(id);
      },
```

`createAgentHandleFactory` (`index.ts:892`, the literal at `:902`) is the only object typed `PaseoAgentHandle`.

- [ ] **Step 13: Run the handle tests and confirm they pass**

```bash
cd /workspace/utils/paseo/packages/client && flock /tmp/paseo-heavy.lock npx vitest run src/index.test.ts -t "agent handle closeRuntime" --bail=1
```

Expected: PASS, 3 tests.

- [ ] **Step 14: Write the failing AgentManager tests**

At the end of `packages/server/src/server/agent/agent-manager.test.ts`, after the test "an out-of-band command racing idle cleanup waits for the resumed runtime", add:

```ts
test("closeRuntimeIfIdle closes an idle runtime that the next prompt resumes", async () => {
  const h = idleCleanupHarness();
  const agent = await h.create();
  h.probes[0] = async () => true;

  expect(await h.manager.closeRuntimeIfIdle(agent.id)).toBeNull();
  expect(h.manager.getAgent(agent.id)).toBeNull();
  expect(await h.manager.closeRuntimeIfIdle(agent.id)).toBeNull();
  expect(h.closes).toBe(1);

  const result = await h.manager.runAgent(agent.id, "after the close");
  expect(result.sessionId).toBe(agent.persistence?.sessionId);
  expect(h.prompts).toEqual(["after the close"]);
});

test("closeRuntimeIfIdle keeps a runtime whose provider vetoes or fails the probe", async () => {
  const h = idleCleanupHarness();
  const agent = await h.create();
  const background = "Agent may still run background work; close it once that ends";

  h.probes[0] = async () => false;
  expect(await h.manager.closeRuntimeIfIdle(agent.id)).toBe(background);
  h.probes[0] = async () => {
    throw new Error("roster unavailable");
  };
  expect(await h.manager.closeRuntimeIfIdle(agent.id)).toBe(background);

  expect(h.closes).toBe(0);
  expect(h.manager.getAgent(agent.id)).not.toBeNull();
});

test("closeRuntimeIfIdle refuses when a prompt arrives during the safety probe", async () => {
  const h = idleCleanupHarness();
  const agent = await h.create();
  const entered = deferred<void>();
  const probe = deferred<boolean>();
  h.probes[0] = () => {
    entered.resolve();
    return probe.promise;
  };

  const close = h.manager.closeRuntimeIfIdle(agent.id);
  await entered.promise;
  await h.manager.runAgent(agent.id, "arrived during safety query");
  probe.resolve(true);

  expect(await close).toBe("Agent is busy; close it once it is idle");
  expect(h.closes).toBe(0);
});

test("closeRuntimeIfIdle makes a prompt racing the close wait for it and resume once", async () => {
  const h = idleCleanupHarness();
  const agent = await h.create();
  h.probes[0] = async () => true;
  const gate = deferred<void>();
  h.holdClose(gate.promise);

  const close = h.manager.closeRuntimeIfIdle(agent.id);
  await h.closeEntered.promise;
  const run = h.manager.runAgent(agent.id, "arrived while closing");
  gate.resolve();

  expect(await close).toBeNull();
  const result = await run;
  expect(result.sessionId).toBe(agent.persistence?.sessionId);
  expect(h.closes).toBe(1);
  expect(h.prompts).toEqual(["arrived while closing"]);
});

test("closeRuntimeIfIdle refuses an agent without a saved session to resume", async () => {
  let closes = 0;
  const client = new (class extends TestAgentClient {
    override async createSession(config: AgentSessionConfig): Promise<AgentSession> {
      const session = await super.createSession(config);
      const runtimeInfo = session.getRuntimeInfo.bind(session);
      session.getRuntimeInfo = async () => ({ ...(await runtimeInfo()), sessionId: null });
      session.describePersistence = () => null;
      session.canStopRuntime = async () => true;
      session.close = async () => {
        closes++;
      };
      return session;
    }
  })();
  const manager = new AgentManager({ clients: { codex: client }, logger });
  const agent = await manager.createAgent({ provider: "codex", cwd: process.cwd() }, undefined, {
    workspaceId: undefined,
  });
  onTestFinished(() => manager.closeAgent(agent.id));

  expect(agent.persistence).toBeNull();
  expect(await manager.closeRuntimeIfIdle(agent.id)).toBe(
    "This agent has no saved session to resume, so it stays open",
  );
  expect(closes).toBe(0);
  expect(manager.getAgent(agent.id)).not.toBeNull();
});
```

The third and fourth tests are the idle collection race tests above them ("idle cleanup rechecks new prompt activity after an asynchronous safety probe" and "a prompt racing idle cleanup waits for close and resumes exactly once") with the sweep replaced by the new method. The last test builds its session the way "does not register a session that finishes starting after shutdown begins" does (no registry, `cwd: process.cwd()`), and drops the session id from both `describePersistence()` and `getRuntimeInfo()`, since the manager also takes one from the runtime info.

- [ ] **Step 15: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/agent/agent-manager.test.ts -t "closeRuntimeIfIdle" --bail=1
```

Expected: FAIL with `TypeError: h.manager.closeRuntimeIfIdle is not a function`.

- [ ] **Step 16: Add `closeRuntimeIfIdle`**

In `packages/server/src/server/agent/agent-manager.ts`, replace

```ts
const IMPORTABLE_SESSION_LIST_TIMEOUT_MS = 90_000;
```

with

```ts
const IMPORTABLE_SESSION_LIST_TIMEOUT_MS = 90_000;
// Idle collection gives a provider's safety probe the same limit (idle-runtime-cleanup/index.ts).
const RUNTIME_SAFETY_PROBE_TIMEOUT_MS = 10_000;
const CLOSE_REFUSED_NO_SESSION = "This agent has no saved session to resume, so it stays open";
const CLOSE_REFUSED_BUSY = "Agent is busy; close it once it is idle";
const CLOSE_REFUSED_BACKGROUND = "Agent may still run background work; close it once that ends";
```

Then replace

```ts
  private async closeAgentRuntime(agentId: string, canClose?: () => boolean): Promise<boolean> {
```

with

```ts
  /**
   * Closes one agent's runtime on request after the checks idle collection makes: a saved
   * session, no pending work, the provider's background-work probe, then a recheck in the
   * lifecycle lane behind the prompt barrier. Resolves null once the runtime is closed, or when it
   * is not loaded, else the reason it stays open. It skips the collector's family and caller
   * checks: a child keeps its own runtime, and a delivery resumes this agent as a prompt does.
   */
  async closeRuntimeIfIdle(agentId: string): Promise<string | null> {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    if (!agent.persistence?.sessionId) return CLOSE_REFUSED_NO_SESSION;
    const updatedAt = agent.updatedAt;
    const isEligible = () =>
      this.agents.get(agentId) === agent &&
      agent.updatedAt === updatedAt &&
      this.runtimeHasNoPendingWork(agent);
    if (!isEligible()) return CLOSE_REFUSED_BUSY;
    if (!(await this.providerAllowsRuntimeStop(agent))) return CLOSE_REFUSED_BACKGROUND;
    // Block prompt admission before entering the close lane, as idle collection does. A prompt
    // admitted during the probe changed updatedAt, so the recheck in the lane refuses the close.
    this.collectingRuntimes.add(agentId);
    try {
      const closed = await this.runLifecycleMutation(agentId, async () => {
        // A close or archive queued ahead of this one may have released the runtime already.
        if (!this.agents.has(agentId)) return true;
        return this.closeAgentRuntime(agentId, isEligible);
      });
      return closed ? null : CLOSE_REFUSED_BUSY;
    } finally {
      this.collectingRuntimes.delete(agentId);
    }
  }

  // Idle collection's provider veto: false, an error or a timeout keeps the runtime.
  private async providerAllowsRuntimeStop(agent: LiveManagedAgent): Promise<boolean> {
    const canStopRuntime = agent.session.canStopRuntime?.bind(agent.session);
    if (!canStopRuntime) return true;
    try {
      const allowed = await withTimeout(
        canStopRuntime(),
        RUNTIME_SAFETY_PROBE_TIMEOUT_MS,
        `Runtime safety probe timed out for ${agent.id}`,
      );
      return allowed === true;
    } catch (error) {
      this.logger.warn({ err: error, agentId: agent.id }, "Runtime safety probe failed");
      return false;
    }
  }

  private async closeAgentRuntime(agentId: string, canClose?: () => boolean): Promise<boolean> {
```

`isEligible` is the closure `getRuntimeCleanupCandidates` builds (`:2008-2011`), and the barrier and lane are `closeIfEligible`'s (`:2023-2032`). The first `isEligible()` runs before the barrier, so a lifecycle mutation already in flight refuses the close as busy; inside the lane the barrier is set, so `runtimeHasNoPendingWork` passes its lane check (`:2048`) and the recheck sees only new activity.

- [ ] **Step 17: Run the AgentManager tests and confirm they pass**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/agent/agent-manager.test.ts -t "closeRuntimeIfIdle" --bail=1
```

Expected: PASS, 5 tests.

- [ ] **Step 18: Add the permission entries**

In `packages/server/src/server/authorization/operation-permissions.ts`, replace

```ts
  "agent.detach.request": "workspace.write",
```

with

```ts
  "agent.detach.request": "workspace.write",
  "agent.runtime.close.request": ["workspace.write", "hub.execute"],
```

and replace

```ts
  "agent.detach.response": "workspace.write",
```

with

```ts
  "agent.detach.response": "workspace.write",
  "agent.runtime.close.response": ["workspace.write", "hub.execute"],
```

Both maps end in `as const satisfies Record<...Operation, PermissionRequirement>` (`:233`, `:482`), so a missing entry is a type error. They come before the session tests because `Session.handleRequest` checks the inbound map first (`session.ts:2295`), and a type with no entry throws there (`authorization/index.ts:52-56`) instead of reaching a dispatcher.

- [ ] **Step 19: Write the failing session tests**

In `packages/server/src/server/session.test.ts`, after the `describe("agent detach RPC", ...)` block, add:

```ts
describe("agent runtime close RPC", () => {
  test("closes an idle agent's runtime and accepts", async () => {
    const messages: unknown[] = [];
    const getAgent = vi.fn(() => ({ id: "agent-1" }));
    const closeRuntimeIfIdle = vi.fn().mockResolvedValue(null);
    const get = vi.fn().mockResolvedValue(null);
    const session = createSessionForTest({
      messages,
      agentManager: { getAgent, closeRuntimeIfIdle },
      agentStorage: { get },
    });

    await session.handleMessage({
      type: "agent.runtime.close.request",
      agentId: "agent-1",
      requestId: "close-1",
    });

    expect(getAgent).toHaveBeenCalledWith("agent-1");
    expect(get).not.toHaveBeenCalled();
    expect(closeRuntimeIfIdle).toHaveBeenCalledWith("agent-1");
    expect(messages).toContainEqual({
      type: "agent.runtime.close.response",
      payload: { requestId: "close-1", agentId: "agent-1", accepted: true, error: null },
    });
  });

  test("refuses an agent the daemon does not know", async () => {
    const messages: unknown[] = [];
    const getAgent = vi.fn(() => null);
    const closeRuntimeIfIdle = vi.fn().mockResolvedValue(null);
    const get = vi.fn().mockResolvedValue(null);
    const session = createSessionForTest({
      messages,
      agentManager: { getAgent, closeRuntimeIfIdle },
      agentStorage: { get },
    });

    await session.handleMessage({
      type: "agent.runtime.close.request",
      agentId: "missing-agent",
      requestId: "close-2",
    });

    expect(getAgent).toHaveBeenCalledWith("missing-agent");
    expect(get).toHaveBeenCalledWith("missing-agent");
    expect(closeRuntimeIfIdle).not.toHaveBeenCalled();
    expect(messages).toContainEqual({
      type: "agent.runtime.close.response",
      payload: {
        requestId: "close-2",
        agentId: "missing-agent",
        accepted: false,
        error: "Agent missing-agent not found",
      },
    });
  });

  test("passes on the reason an agent keeps its runtime", async () => {
    const messages: unknown[] = [];
    const getAgent = vi.fn(() => ({ id: "agent-4" }));
    const closeRuntimeIfIdle = vi
      .fn()
      .mockResolvedValue("Agent may still run background work; close it once that ends");
    const get = vi.fn().mockResolvedValue(null);
    const session = createSessionForTest({
      messages,
      agentManager: { getAgent, closeRuntimeIfIdle },
      agentStorage: { get },
    });

    await session.handleMessage({
      type: "agent.runtime.close.request",
      agentId: "agent-4",
      requestId: "close-4",
    });

    expect(closeRuntimeIfIdle).toHaveBeenCalledWith("agent-4");
    expect(messages).toContainEqual({
      type: "agent.runtime.close.response",
      payload: {
        requestId: "close-4",
        agentId: "agent-4",
        accepted: false,
        error: "Agent may still run background work; close it once that ends",
      },
    });
  });

  test("reports a failed close", async () => {
    const messages: unknown[] = [];
    const getAgent = vi.fn(() => null);
    const closeRuntimeIfIdle = vi.fn().mockRejectedValue(new Error("provider did not exit"));
    const get = vi.fn().mockResolvedValue({ id: "agent-3" });
    const session = createSessionForTest({
      messages,
      agentManager: { getAgent, closeRuntimeIfIdle },
      agentStorage: { get },
    });

    await session.handleMessage({
      type: "agent.runtime.close.request",
      agentId: "agent-3",
      requestId: "close-3",
    });

    expect(get).toHaveBeenCalledWith("agent-3");
    expect(closeRuntimeIfIdle).toHaveBeenCalledWith("agent-3");
    expect(messages).toContainEqual({
      type: "agent.runtime.close.response",
      payload: {
        requestId: "close-3",
        agentId: "agent-3",
        accepted: false,
        error: "provider did not exit",
      },
    });
  });
});
```

- [ ] **Step 20: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/session.test.ts -t "agent runtime close RPC" --bail=1
```

Expected: FAIL on the first test's `expect(getAgent).toHaveBeenCalledWith("agent-1")`, since `getAgent` was never called: the request passes the permission check, but no dispatcher handles the new type, and `dispatchMiscMessage` ignores an unmatched one.

- [ ] **Step 21: Add the dispatch case and the handler**

In `packages/server/src/server/session.ts`, replace

```ts
      case "agent.detach.request":
        return this.handleDetachAgentRequest(msg.agentId, msg.requestId);
```

with

```ts
      case "agent.detach.request":
        return this.handleDetachAgentRequest(msg.agentId, msg.requestId);
      case "agent.runtime.close.request":
        return this.handleCloseAgentRuntimeRequest(msg.agentId, msg.requestId);
```

The case goes in `dispatchAgentRelationshipMessage` (one case today) rather than `dispatchAgentLifecycleMessage`, whose switch is at the `complexity` limit.

After the closing brace of `handleDetachAgentRequest`, add:

```ts
  private async handleCloseAgentRuntimeRequest(agentId: string, requestId: string): Promise<void> {
    this.sessionLogger.info({ agentId, requestId }, "Closing agent runtime");

    try {
      const knownAgent =
        this.agentManager.getAgent(agentId) ?? (await this.agentStorage.get(agentId));
      if (!knownAgent) {
        this.emit({
          type: "agent.runtime.close.response",
          payload: { requestId, agentId, accepted: false, error: `Agent ${agentId} not found` },
        });
        return;
      }

      // The manager makes idle collection's checks; a refusal comes back as its reason.
      const refusal = await this.agentManager.closeRuntimeIfIdle(agentId);
      this.emit({
        type: "agent.runtime.close.response",
        payload: { requestId, agentId, accepted: refusal === null, error: refusal },
      });
    } catch (error) {
      const message = getErrorMessageOr(error, "Failed to close agent runtime");
      this.sessionLogger.error({ err: error, agentId, requestId }, "Failed to close agent runtime");
      this.emit({
        type: "agent.runtime.close.response",
        payload: { requestId, agentId, accepted: false, error: message },
      });
    }
  }
```

- [ ] **Step 22: Run the session tests and confirm they pass**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/session.test.ts -t "agent runtime close RPC" --bail=1
```

Expected: PASS, 4 tests.

- [ ] **Step 23: Assert the advertised feature**

In `packages/server/src/server/websocket-server.relay-reconnect.test.ts`, in the test "advertises current features in initial server_info", replace

```ts
expect(serverInfo.features?.stableProjectIdentity).toBe(true);
```

with

```ts
expect(serverInfo.features?.stableProjectIdentity).toBe(true);
expect(serverInfo.features?.agentRuntimeClose).toBe(true);
```

- [ ] **Step 24: Run it and confirm it fails**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/websocket-server.relay-reconnect.test.ts -t "advertises current features in initial server_info" --bail=1
```

Expected: FAIL with `expected undefined to be true` on the new line: the protocol from Step 5 parses the flag, and the daemon does not send it yet.

- [ ] **Step 25: Advertise the feature**

In `packages/server/src/server/websocket-server.ts`, in `buildServerInfoStatusPayload`, replace

```ts
        agentMove: true,
```

with

```ts
        agentMove: true,
        // COMPAT(agentRuntimeClose): added after v0.15.2, remove gate after 2027-05-07.
        agentRuntimeClose: true,
```

- [ ] **Step 26: Run the test and confirm it passes**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/websocket-server.relay-reconnect.test.ts -t "advertises current features in initial server_info" --bail=1
```

Expected: PASS, 1 test.

- [ ] **Step 27: Document the RPC**

In `docs/agent-lifecycle.md`, after the paragraph that ends with `A provider plugin adds its own veto through the [runtime safety contract](../public-docs/plugins/providers.md#permit-idle-runtime-cleanup).` and before the paragraph that starts `A provider runtime can still die on its own`, add a new paragraph:

```markdown
`agent.runtime.close.request` closes one agent's runtime on request, without the idle hour. It
makes collection's checks on that runtime alone: a saved session, the daemon baseline, the provider
veto, and the recheck in the lifecycle lane, so a racing prompt is handled as it is during
collection. A refused close answers with the reason and stops nothing. Managed children, queued
deliveries and finish subscriptions are not checked: a child keeps its own runtime, and a delivery
or finish notice resumes the closed agent the way a prompt does. The SDK exposes it as
`closeRuntime()` on an agent handle, behind `server_info.features.agentRuntimeClose`.
```

Each claim maps to code: the saved session, the baseline and the lane recheck are `closeRuntimeIfIdle` (Step 16) over `runtimeHasNoPendingWork` (`agent-manager.ts:2039-2053`) and `closeAgentRuntime`'s recheck (`:2089-2090`); the veto is `providerAllowsRuntimeStop`, with idle collection's 10 s limit (`idle-runtime-cleanup/index.ts:57-72`); a racing prompt goes through `streamAfterRuntimeCollection` (`agent-manager.ts:2945-2965`), as Step 14's tests show. The family check (`idle-runtime-cleanup/index.ts:45-56`) and `isProtected` (`bootstrap.ts:1514-1516`) live in the collector only, and a queued delivery reaches the agent through `sendPreparedPromptToAgent` (`agent-prompt.ts:326`), which calls `ensureAgentLoaded` (`:343`).

In `public-docs/sdk/reference.md`, after the row

```markdown
| `detach()` | `Promise<void>` | Removes the parent relationship without stopping the agent. |
```

add

```markdown
| `closeRuntime()` | `Promise<void>` | Ends an idle agent's provider runtime, or rejects with why it stays open. Its next prompt resumes it. |
```

In `public-docs/sdk/reference.zh-CN.md`, after the row

```markdown
| `detach()` | `Promise<void>` | 解除父子关系，但不停止 Agent。 |
```

add

```markdown
| `closeRuntime()` | `Promise<void>` | 结束空闲 Agent 的运行时，否则拒绝并说明原因。下一条提示词会恢复它。 |
```

The two reference pages stay paired row for row. Each new row is as wide as its table's widest row (176 characters in English, 144 display columns in Chinese), so oxfmt has nothing to re-pad.

- [ ] **Step 28: Build the client stack and typecheck the three packages**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run build:client
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/protocol -- --singleThreaded
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/client -- --singleThreaded
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/server -- --singleThreaded
```

Expected: each exits 0. `build:client` rebuilds protocol, relay and client `dist`; the plugins workspace reads `@getpaseo/client` types from that `dist`, so Task 6's adapter sees `closeRuntime`.

- [ ] **Step 29: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- packages/protocol/src/messages.ts packages/protocol/src/messages.test.ts packages/client/src/daemon-client.ts packages/client/src/daemon-client.test.ts packages/client/src/index.ts packages/client/src/index.test.ts packages/server/src/server/agent/agent-manager.ts packages/server/src/server/agent/agent-manager.test.ts packages/server/src/server/authorization/operation-permissions.ts packages/server/src/server/session.ts packages/server/src/server/session.test.ts packages/server/src/server/websocket-server.ts packages/server/src/server/websocket-server.relay-reconnect.test.ts docs/agent-lifecycle.md public-docs/sdk/reference.md public-docs/sdk/reference.zh-CN.md
cd /workspace/utils/paseo && npm run lint -- packages/protocol/src/messages.ts packages/protocol/src/messages.test.ts packages/client/src/daemon-client.ts packages/client/src/daemon-client.test.ts packages/client/src/index.ts packages/client/src/index.test.ts packages/server/src/server/agent/agent-manager.ts packages/server/src/server/agent/agent-manager.test.ts packages/server/src/server/authorization/operation-permissions.ts packages/server/src/server/session.ts packages/server/src/server/session.test.ts packages/server/src/server/websocket-server.ts packages/server/src/server/websocket-server.relay-reconnect.test.ts
```

Expected: oxfmt exits 0 (it may rewrap a long test title or call); `Found 0 warnings and 0 errors.` If oxfmt changed a test or source file, re-run Steps 4, 9, 13, 17, 22 and 26 for that file.

- [ ] **Step 30: Commit**

```bash
P="packages/protocol/src/messages.ts packages/protocol/src/messages.test.ts packages/client/src/daemon-client.ts packages/client/src/daemon-client.test.ts packages/client/src/index.ts packages/client/src/index.test.ts packages/server/src/server/agent/agent-manager.ts packages/server/src/server/agent/agent-manager.test.ts packages/server/src/server/authorization/operation-permissions.ts packages/server/src/server/session.ts packages/server/src/server/session.test.ts packages/server/src/server/websocket-server.ts packages/server/src/server/websocket-server.relay-reconnect.test.ts docs/agent-lifecycle.md public-docs/sdk/reference.md public-docs/sdk/reference.zh-CN.md"
git -C /workspace/utils/paseo add $P
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): agent.runtime.close RPC and PaseoAgentHandle.closeRuntime" -- $P
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- $P
```

Expected: the hook passes; `16 files changed`; the fork identity; `show` lists the sixteen paths; `status` prints nothing.

---

### Task 3: meminfo and loadavg parsers, host summary

**Files:**

- Create: `plugins/resource-manager/server/proc-text.ts`
- Test: `plugins/resource-manager/server/proc-text.test.ts`
- Create: `plugins/resource-manager/server/local/host-summary.ts`
- Test: `plugins/resource-manager/server/local/host-summary.test.ts`

**Interfaces:**

- Consumes: `HostSummary` (Task 1, `shared/rpc.ts`).
- Produces:
  - `class ProcTextError extends Error` (name `"ProcTextError"`)
  - `interface Meminfo { totalBytes: number; availableBytes: number; swapTotalBytes: number; swapFreeBytes: number }`
  - `interface Loadavg { load1: number; load5: number; load15: number }`
  - `parseMeminfoFields(text: string): Map<string, number>` (every `<Name>: <n> kB` line, in bytes)
  - `availableMemory(fields: Map<string, number>): number` (`MemAvailable`, else `MemFree + Buffers + Cached`)
  - `parseMeminfo(text: string): Meminfo`, `parseLoadavg(text: string): Loadavg`, both throwing `ProcTextError`
  - `interface HostPaths { procRoot: string; cgroupRoot: string; cores: number }`
  - `readHostSummary(paths: HostPaths): HostSummary` (never throws; unreadable parts are null)

Real samples, captured in this container on 2026-11-06: `/proc/meminfo` lines `MemTotal: 16042308 kB`, `MemFree: 3529520 kB`, `MemAvailable: 7686108 kB`, `Buffers: 1041016 kB`, `Cached: 2485564 kB`, `SwapCached: 107456 kB`, `Active: 6223316 kB`, `Inactive: 4422876 kB`, `SwapTotal: 12582908 kB`, `SwapFree: 6615772 kB`; `/proc/loadavg` `1.54 1.88 2.22 1/10058 224556`; `/sys/fs/cgroup/memory.max` `max`.

- [ ] **Step 1: Write the failing parser tests**

Create `plugins/resource-manager/server/proc-text.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  availableMemory,
  parseLoadavg,
  parseMeminfo,
  parseMeminfoFields,
  ProcTextError,
} from "./proc-text.js";

// Captured in this container on 2026-11-06. The Active(anon) and HugePages lines are added to
// show that lines with parentheses or without a unit are skipped.
const MEMINFO = [
  "MemTotal:       16042308 kB",
  "MemFree:         3529520 kB",
  "MemAvailable:    7686108 kB",
  "Buffers:         1041016 kB",
  "Cached:          2485564 kB",
  "SwapCached:       107456 kB",
  "Active:          6223316 kB",
  "Inactive:        4422876 kB",
  "Active(anon):    2048000 kB",
  "SwapTotal:      12582908 kB",
  "SwapFree:        6615772 kB",
  "HugePages_Total:       0",
  "",
].join("\n");

const MEMINFO_WITHOUT_AVAILABLE = MEMINFO.replace("MemAvailable:    7686108 kB\n", "");

describe("parseMeminfo", () => {
  it("reads total, available and swap in bytes from a real sample", () => {
    expect(parseMeminfo(MEMINFO)).toEqual({
      totalBytes: 16042308 * 1024,
      availableBytes: 7686108 * 1024,
      swapTotalBytes: 12582908 * 1024,
      swapFreeBytes: 6615772 * 1024,
    });
  });

  it("skips lines with parentheses or without a kB unit", () => {
    const fields = parseMeminfoFields(MEMINFO);
    expect(fields.has("Active(anon)")).toBe(false);
    expect(fields.has("HugePages_Total")).toBe(false);
    expect(fields.get("Active")).toBe(6223316 * 1024);
  });

  it("estimates available memory as free + buffers + cache before Linux 3.14", () => {
    expect(availableMemory(parseMeminfoFields(MEMINFO_WITHOUT_AVAILABLE))).toBe(
      (3529520 + 1041016 + 2485564) * 1024,
    );
  });

  it("names the missing line when MemTotal is absent", () => {
    expect(() => parseMeminfo("MemFree: 1 kB\n")).toThrow(
      new ProcTextError("meminfo has no MemTotal line"),
    );
  });

  it("rejects empty text, as from a host without /proc", () => {
    expect(() => parseMeminfo("")).toThrow(ProcTextError);
  });
});

describe("parseLoadavg", () => {
  it("reads the three averages from a real sample", () => {
    expect(parseLoadavg("1.54 1.88 2.22 1/10058 224556\n")).toEqual({
      load1: 1.54,
      load5: 1.88,
      load15: 2.22,
    });
  });

  it("rejects text that is not a load average", () => {
    expect(() => parseLoadavg("")).toThrow(ProcTextError);
    expect(() => parseLoadavg("1.0 abc 2.0")).toThrow(ProcTextError);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/proc-text.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './proc-text.js'`.

- [ ] **Step 3: Write the parsers**

Create `plugins/resource-manager/server/proc-text.ts`:

```ts
// Parsers for /proc text, shared by the local reader and the remote output parser.

export class ProcTextError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProcTextError";
  }
}

export interface Meminfo {
  totalBytes: number;
  availableBytes: number;
  swapTotalBytes: number;
  swapFreeBytes: number;
}

export interface Loadavg {
  load1: number;
  load5: number;
  load15: number;
}

const KIB = 1024;
// "MemTotal:       16042308 kB". Names with parentheses and unitless counts are not needed.
const MEMINFO_LINE = /^(\w+):\s+(\d+) kB$/;

export function parseMeminfoFields(text: string): Map<string, number> {
  const fields = new Map<string, number>();
  for (const line of text.split("\n")) {
    const match = MEMINFO_LINE.exec(line.trim());
    if (match) fields.set(match[1], Number(match[2]) * KIB);
  }
  return fields;
}

function requireField(fields: Map<string, number>, name: string): number {
  const value = fields.get(name);
  if (value === undefined) throw new ProcTextError(`meminfo has no ${name} line`);
  return value;
}

// MemAvailable arrived in Linux 3.14. Before it, free + buffers + page cache is the usual estimate.
export function availableMemory(fields: Map<string, number>): number {
  const available = fields.get("MemAvailable");
  if (available !== undefined) return available;
  return (
    requireField(fields, "MemFree") +
    requireField(fields, "Buffers") +
    requireField(fields, "Cached")
  );
}

export function parseMeminfo(text: string): Meminfo {
  const fields = parseMeminfoFields(text);
  return {
    totalBytes: requireField(fields, "MemTotal"),
    availableBytes: availableMemory(fields),
    swapTotalBytes: requireField(fields, "SwapTotal"),
    swapFreeBytes: requireField(fields, "SwapFree"),
  };
}

// "1.54 1.88 2.22 1/10058 224556": the 1, 5 and 15 minute averages come first.
export function parseLoadavg(text: string): Loadavg {
  const [load1, load5, load15] = text.trim().split(/\s+/).map(Number);
  if (text.trim() === "" || ![load1, load5, load15].every(Number.isFinite)) {
    throw new ProcTextError(`Unrecognised loadavg: ${text.slice(0, 80)}`);
  }
  return { load1, load5, load15 };
}
```

- [ ] **Step 4: Run the parser tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/proc-text.test.ts --bail=1
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing host summary tests**

Create `plugins/resource-manager/server/local/host-summary.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HostSummary } from "../../shared/rpc.js";
import { readHostSummary } from "./host-summary.js";

const MEMINFO = [
  "MemTotal:       16042308 kB",
  "MemFree:         3529520 kB",
  "MemAvailable:    7686108 kB",
  "Buffers:         1041016 kB",
  "Cached:          2485564 kB",
  "SwapTotal:      12582908 kB",
  "SwapFree:        6615772 kB",
  "",
].join("\n");

let root: string;
let procRoot: string;
let cgroupRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-host-"));
  procRoot = join(root, "proc");
  cgroupRoot = join(root, "cgroup");
  mkdirSync(procRoot);
  mkdirSync(cgroupRoot);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeProc(name: string, text: string): void {
  writeFileSync(join(procRoot, name), text);
}

function writeCgroup(name: string, text: string): void {
  writeFileSync(join(cgroupRoot, name), text);
}

describe("readHostSummary", () => {
  it("reads an uncapped cgroup v2 container, as in this container", () => {
    writeProc("meminfo", MEMINFO);
    writeProc("loadavg", "1.54 1.88 2.22 1/10058 224556\n");
    writeCgroup("memory.current", "3221225472\n");
    writeCgroup("memory.max", "max\n");
    writeCgroup("memory.swap.current", "104857600\n");

    const expected: HostSummary = {
      memoryUsedBytes: 3221225472,
      memoryLimitBytes: null,
      swapUsedBytes: 104857600,
      swapTotalBytes: 12582908 * 1024,
      hostAvailableBytes: 7686108 * 1024,
      hostTotalBytes: 16042308 * 1024,
      load1: 1.54,
      load5: 1.88,
      load15: 2.22,
      cores: 2,
    };
    expect(readHostSummary({ procRoot, cgroupRoot, cores: 2 })).toEqual(expected);
  });

  it("reads a numeric memory.max as the cap", () => {
    writeProc("meminfo", MEMINFO);
    writeCgroup("memory.current", "1073741824\n");
    writeCgroup("memory.max", "8589934592\n");

    const summary = readHostSummary({ procRoot, cgroupRoot, cores: 4 });
    expect(summary.memoryUsedBytes).toBe(1073741824);
    expect(summary.memoryLimitBytes).toBe(8589934592);
  });

  it("falls back to SwapTotal - SwapFree without memory.swap.current", () => {
    writeProc("meminfo", MEMINFO);

    expect(readHostSummary({ procRoot, cgroupRoot, cores: 2 }).swapUsedBytes).toBe(
      (12582908 - 6615772) * 1024,
    );
  });

  it("returns nulls without cgroup v2 or /proc, and keeps the core count", () => {
    const expected: HostSummary = {
      memoryUsedBytes: null,
      memoryLimitBytes: null,
      swapUsedBytes: null,
      swapTotalBytes: null,
      hostAvailableBytes: null,
      hostTotalBytes: null,
      load1: null,
      load5: null,
      load15: null,
      cores: 8,
    };
    expect(readHostSummary({ procRoot, cgroupRoot, cores: 8 })).toEqual(expected);
  });

  it("treats a meminfo or loadavg that does not parse as unreadable", () => {
    writeProc("meminfo", "garbage\n");
    writeProc("loadavg", "garbage\n");

    const summary = readHostSummary({ procRoot, cgroupRoot, cores: 2 });
    expect(summary.hostTotalBytes).toBeNull();
    expect(summary.load1).toBeNull();
  });
});
```

- [ ] **Step 6: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/local/host-summary.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './host-summary.js'`.

- [ ] **Step 7: Write the host summary reader**

Create `plugins/resource-manager/server/local/host-summary.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { HostSummary } from "../../shared/rpc.js";
import { parseLoadavg, parseMeminfo, ProcTextError } from "../proc-text.js";

export interface HostPaths {
  procRoot: string;
  /** The cgroup v2 directory of this container: /sys/fs/cgroup under a cgroup namespace. */
  cgroupRoot: string;
  /** os.availableParallelism() in the daemon. */
  cores: number;
}

const BYTE_COUNT = /^\d+$/;

function readText(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function parsed<T>(file: string, parse: (text: string) => T): T | null {
  const text = readText(file);
  if (text === null) return null;
  try {
    return parse(text);
  } catch (error) {
    if (error instanceof ProcTextError) return null;
    throw error;
  }
}

// A cgroup v2 memory file. "max" (no cap), a missing file (cgroup v1, or no cgroup mount) and
// anything that is not a byte count read as null.
function readCgroupBytes(file: string): number | null {
  const text = readText(file)?.trim();
  if (text === undefined || !BYTE_COUNT.test(text)) return null;
  return Number(text);
}

export function readHostSummary({ procRoot, cgroupRoot, cores }: HostPaths): HostSummary {
  const meminfo = parsed(join(procRoot, "meminfo"), parseMeminfo);
  const load = parsed(join(procRoot, "loadavg"), parseLoadavg);
  const hostSwapUsed = meminfo === null ? null : meminfo.swapTotalBytes - meminfo.swapFreeBytes;
  return {
    memoryUsedBytes: readCgroupBytes(join(cgroupRoot, "memory.current")),
    memoryLimitBytes: readCgroupBytes(join(cgroupRoot, "memory.max")),
    swapUsedBytes: readCgroupBytes(join(cgroupRoot, "memory.swap.current")) ?? hostSwapUsed,
    swapTotalBytes: meminfo?.swapTotalBytes ?? null,
    hostAvailableBytes: meminfo?.availableBytes ?? null,
    hostTotalBytes: meminfo?.totalBytes ?? null,
    load1: load?.load1 ?? null,
    load5: load?.load5 ?? null,
    load15: load?.load15 ?? null,
    cores,
  };
}
```

- [ ] **Step 8: Run the host summary tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/local/host-summary.test.ts --bail=1
```

Expected: PASS, 5 tests.

- [ ] **Step 9: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/resource-manager/server/proc-text.ts plugins/resource-manager/server/proc-text.test.ts plugins/resource-manager/server/local/host-summary.ts plugins/resource-manager/server/local/host-summary.test.ts
cd /workspace/utils/paseo && npm run lint -- plugins/resource-manager
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: oxfmt exits 0; `Found 0 warnings and 0 errors.`; typecheck exit 0. Re-run Steps 4 and 8 if oxfmt changed a file.

- [ ] **Step 10: Commit**

```bash
P="plugins/resource-manager/server/proc-text.ts plugins/resource-manager/server/proc-text.test.ts plugins/resource-manager/server/local/host-summary.ts plugins/resource-manager/server/local/host-summary.test.ts"
git -C /workspace/utils/paseo add $P
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): resource-manager meminfo, loadavg and host summary readers" -- $P
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo status --short --untracked-files=all -- $P
```

Expected: the hook passes; `4 files changed`; the fork identity; `status` prints nothing.

---

### Task 4: Paths, pid files and the fake /proc helper

**Files:**

- Create: `plugins/resource-manager/server/paths.ts`
- Test: `plugins/resource-manager/server/paths.test.ts`
- Create: `plugins/resource-manager/server/pid-files.ts`
- Test: `plugins/resource-manager/server/pid-files.test.ts` (fake `/proc`)
- Test: `plugins/resource-manager/server/pid-files.posix.test.ts` (real processes and signals)
- Create: `plugins/resource-manager/server/local/fake-proc.ts` (typed test helper, typechecked with the plugin)

**Interfaces:**

- Consumes: `parseStat(stat: string): ProcStat` from `server/local/procfs.ts` (Task 1). The pid record shape and the pid-space rules of `plugins/shared-mcp/server/process-runner.ts:56-64`, `:378-395`, `:427-448`, `:459-475`, re-implemented here (they are module-private there and in another plugin's directory).
- Produces (`server/paths.ts`):
  - `expandHomeDir(input: string, home: string): string` (only `~` and a leading `~/` expand)
  - `paseoHome(env: NodeJS.ProcessEnv, home: string): string` (`PASEO_HOME`, default `~/.paseo`, resolved)
  - `resourceManagerRunDir(env, home): string` -> `<paseoHome>/resource-manager/run`
  - `sharedMcpRunDir(env, home): string` -> `<paseoHome>/shared-mcp/run`
  - `claudeConfigFile(env, home): string` -> `$CLAUDE_CONFIG_DIR/.claude.json`, else `<home>/.claude.json`
- Produces (`server/pid-files.ts`):
  - `PidRecordSchema` (same fields as shared-mcp's), `type PidRecord`, `interface PidSpace { pidNamespace: string | null; bootId: string | null; initStartTime: number | null }`
  - `readStartTime(pid: number, procRoot: string): number | null`
  - `readPidSpace(procRoot: string): PidSpace`, `isCurrentPidSpace(record: PidRecord, procRoot: string): boolean`
  - `sendSignal(target: number, signal: NodeJS.Signals | 0): boolean`
  - `ownerIsAlive(record: PidRecord, procRoot: string, selfPid = process.pid): boolean`
  - `isRecordedGroup(record: PidRecord, procRoot: string): boolean`
  - `writePidFile(file: string, pgid: number, procRoot: string): void` (mode 0600, through a `.tmp` rename)
  - `readPidRecord(file: string): PidRecord | null`, `removePidFile(file: string): void`, `listPidFiles(dir: string): string[]` (names ending `.pid`, sorted; `[]` when the directory is missing)
  - `killGroup(pgid: number, graceMs = 2_000): Promise<void>` (SIGTERM, then SIGKILL at the deadline; no-op for `pgid <= 1`)
  - `type ReclaimOutcome = "kept" | "stale" | "killed"`, `reclaimPidFile(file: string, procRoot: string, selfPid = process.pid): Promise<ReclaimOutcome>`
- Produces (`server/local/fake-proc.ts`):
  - `interface FakeProcess { pid; ppid; pgrp?; startTime?; utime?; stime?; rssKb?: number | null; comm?; cmdline?: string[]; env?: Record<string, string> | null }`
  - `interface FakePidSpace { pidNamespace: string; bootId: string }`
  - `statLine(entry: FakeProcess): string`, `writeFakeProc(root: string, entries: readonly FakeProcess[], space?: FakePidSpace): void`

- [ ] **Step 1: Write the failing path tests**

Create `plugins/resource-manager/server/paths.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  claudeConfigFile,
  expandHomeDir,
  paseoHome,
  resourceManagerRunDir,
  sharedMcpRunDir,
} from "./paths.js";

const HOME = "/home/u";

describe("paths", () => {
  it("expands only ~ and a leading ~/", () => {
    expect(expandHomeDir("~", HOME)).toBe("/home/u");
    expect(expandHomeDir("~/x", HOME)).toBe("/home/u/x");
    expect(expandHomeDir("/srv/~x", HOME)).toBe("/srv/~x");
  });

  it("defaults PASEO_HOME to ~/.paseo and resolves a relative one", () => {
    expect(paseoHome({}, HOME)).toBe("/home/u/.paseo");
    expect(paseoHome({ PASEO_HOME: "~/dev-home" }, HOME)).toBe("/home/u/dev-home");
    expect(paseoHome({ PASEO_HOME: "/srv/paseo" }, HOME)).toBe("/srv/paseo");
  });

  it("puts the run directories under PASEO_HOME", () => {
    const env = { PASEO_HOME: "/srv/paseo" };
    expect(resourceManagerRunDir(env, HOME)).toBe("/srv/paseo/resource-manager/run");
    expect(sharedMcpRunDir(env, HOME)).toBe("/srv/paseo/shared-mcp/run");
  });

  it("finds .claude.json under CLAUDE_CONFIG_DIR when set, else in the home directory", () => {
    expect(claudeConfigFile({}, HOME)).toBe("/home/u/.claude.json");
    expect(claudeConfigFile({ CLAUDE_CONFIG_DIR: "~/claude" }, HOME)).toBe(
      "/home/u/claude/.claude.json",
    );
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/paths.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './paths.js'`.

- [ ] **Step 3: Write the paths module**

Create `plugins/resource-manager/server/paths.ts`:

```ts
import { join, resolve } from "node:path";

// Mirrors resolvePaseoHome in packages/server/src/server/paseo-home.ts, which a plugin bundle
// cannot import: only "~" and a leading "~/" expand, and an unset PASEO_HOME means ~/.paseo.
export function expandHomeDir(input: string, home: string): string {
  if (input.startsWith("~/")) return join(home, input.slice(2));
  if (input === "~") return home;
  return input;
}

// Built-ins run in the daemon process, so the env is the daemon's.
export function paseoHome(env: NodeJS.ProcessEnv, home: string): string {
  return resolve(expandHomeDir(env.PASEO_HOME ?? "~/.paseo", home));
}

// Pid files of the ssh-mcp groups this plugin started.
export function resourceManagerRunDir(env: NodeJS.ProcessEnv, home: string): string {
  return join(paseoHome(env, home), "resource-manager", "run");
}

// shared-mcp's pid files (plugins/shared-mcp/server/plugin.ts:279). Read only.
export function sharedMcpRunDir(env: NodeJS.ProcessEnv, home: string): string {
  return join(paseoHome(env, home), "shared-mcp", "run");
}

// Claude Code keeps user- and local-scope MCP servers in .claude.json, under CLAUDE_CONFIG_DIR
// when that is set and in the home directory otherwise.
export function claudeConfigFile(env: NodeJS.ProcessEnv, home: string): string {
  const configDir = env.CLAUDE_CONFIG_DIR;
  if (configDir) return join(expandHomeDir(configDir, home), ".claude.json");
  return join(home, ".claude.json");
}
```

- [ ] **Step 4: Run the path tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/paths.test.ts --bail=1
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Write the fake /proc helper**

Create `plugins/resource-manager/server/local/fake-proc.ts`:

```ts
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Builds a /proc-shaped directory for tests: <root>/<pid>/{stat,status,cmdline,environ}, plus
// self/ns/pid and sys/kernel/random/boot_id when a pid space is given. Typed, so tests that use
// it are checked even though test files are not.

export interface FakeProcess {
  pid: number;
  ppid: number;
  /** Defaults to pid (a group leader). */
  pgrp?: number;
  /** Field 22, in clock ticks. Defaults to 1000. */
  startTime?: number;
  utime?: number;
  stime?: number;
  /** VmRSS in kB. null writes no VmRSS line, as for a kernel thread or a zombie. */
  rssKb?: number | null;
  comm?: string;
  cmdline?: string[];
  /** null writes no environ file, as when another user's process cannot be read. */
  env?: Record<string, string> | null;
}

export interface FakePidSpace {
  pidNamespace: string;
  bootId: string;
}

// After ") ": 3 state, 4 ppid, 5 pgrp, 6 session, 7 tty_nr, 8 tpgid, 9 flags, 10-13 fault
// counts, 14 utime, 15 stime, 16 cutime, 17 cstime, 18 priority, 19 nice, 20 num_threads,
// 21 itrealvalue, 22 starttime, then two more fields.
export function statLine(entry: FakeProcess): string {
  const pgrp = entry.pgrp ?? entry.pid;
  const fields = [
    "S",
    entry.ppid,
    pgrp,
    pgrp,
    0,
    -1,
    4194304,
    0,
    0,
    0,
    0,
    entry.utime ?? 0,
    entry.stime ?? 0,
    0,
    0,
    20,
    0,
    1,
    0,
    entry.startTime ?? 1000,
    0,
    0,
  ];
  return `${entry.pid} (${entry.comm ?? "node"}) ${fields.join(" ")}\n`;
}

function statusText(entry: FakeProcess): string {
  const rss = entry.rssKb === undefined ? 1024 : entry.rssKb;
  const lines = [`Name:\t${entry.comm ?? "node"}`, `Pid:\t${entry.pid}`, `PPid:\t${entry.ppid}`];
  if (rss !== null) lines.push(`VmRSS:\t${String(rss).padStart(8)} kB`);
  return `${lines.join("\n")}\n`;
}

function nulJoined(values: readonly string[]): string {
  return values.map((value) => `${value}\0`).join("");
}

export function writeFakeProc(
  root: string,
  entries: readonly FakeProcess[],
  space?: FakePidSpace,
): void {
  for (const entry of entries) {
    const dir = join(root, String(entry.pid));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "stat"), statLine(entry));
    writeFileSync(join(dir, "status"), statusText(entry));
    writeFileSync(join(dir, "cmdline"), nulJoined(entry.cmdline ?? [entry.comm ?? "node"]));
    if (entry.env !== null) {
      const pairs = Object.entries(entry.env ?? {}).map(([key, value]) => `${key}=${value}`);
      writeFileSync(join(dir, "environ"), nulJoined(pairs));
    }
  }
  if (space === undefined) return;
  mkdirSync(join(root, "self", "ns"), { recursive: true });
  symlinkSync(space.pidNamespace, join(root, "self", "ns", "pid"));
  mkdirSync(join(root, "sys", "kernel", "random"), { recursive: true });
  writeFileSync(join(root, "sys", "kernel", "random", "boot_id"), `${space.bootId}\n`);
}
```

`writeFakeProc` may be called again on the same root to rewrite processes (Task 6 uses that between samples); `self` and `sys` are written only on the first call that passes a space.

- [ ] **Step 6: Write the failing pid-file tests over a fake /proc**

Create `plugins/resource-manager/server/pid-files.test.ts`:

```ts
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFakeProc, type FakePidSpace } from "./local/fake-proc.js";
import {
  isCurrentPidSpace,
  listPidFiles,
  ownerIsAlive,
  readPidRecord,
  readPidSpace,
  readStartTime,
  type PidRecord,
} from "./pid-files.js";

const SPACE: FakePidSpace = { pidNamespace: "pid:[4026531836]", bootId: "boot-1" };

let root: string;
let procRoot: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-pid-"));
  procRoot = join(root, "proc");
  writeFakeProc(
    procRoot,
    [
      { pid: 1, ppid: 0, startTime: 10 },
      { pid: 164, ppid: 6, startTime: 5000 },
    ],
    SPACE,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function record(overrides: Partial<PidRecord>): PidRecord {
  return {
    pgid: 400,
    startTime: 4000,
    ownerPid: 164,
    ownerStartTime: 5000,
    pidNamespace: SPACE.pidNamespace,
    bootId: SPACE.bootId,
    initStartTime: 10,
    ...overrides,
  };
}

describe("pid space", () => {
  it("reads the namespace, boot id and init start time", () => {
    expect(readPidSpace(procRoot)).toEqual({
      pidNamespace: "pid:[4026531836]",
      bootId: "boot-1",
      initStartTime: 10,
    });
    expect(readStartTime(164, procRoot)).toBe(5000);
    expect(readStartTime(999, procRoot)).toBeNull();
  });

  it("accepts a record from this namespace, boot and container run only", () => {
    expect(isCurrentPidSpace(record({}), procRoot)).toBe(true);
    expect(isCurrentPidSpace(record({ bootId: "boot-0" }), procRoot)).toBe(false);
    expect(isCurrentPidSpace(record({ pidNamespace: "pid:[1]" }), procRoot)).toBe(false);
    expect(isCurrentPidSpace(record({ initStartTime: 11 }), procRoot)).toBe(false);
    expect(isCurrentPidSpace(record({ initStartTime: undefined }), procRoot)).toBe(false);
  });

  it("is never current where /proc has no pid space", () => {
    expect(isCurrentPidSpace(record({}), join(root, "missing"))).toBe(false);
  });
});

describe("ownerIsAlive", () => {
  it("is alive only when the owner runs with the recorded start time", () => {
    expect(ownerIsAlive(record({}), procRoot, 1)).toBe(true);
    expect(ownerIsAlive(record({ ownerStartTime: 5001 }), procRoot, 1)).toBe(false);
  });

  it("treats a record owned by this process as left by an earlier run", () => {
    expect(ownerIsAlive(record({}), procRoot, 164)).toBe(false);
  });
});

describe("pid file reading", () => {
  it("reads a valid record and returns null for a missing or unreadable file", () => {
    const valid = join(root, "a-400.pid");
    writeFileSync(valid, `${JSON.stringify(record({}))}\n`);
    const broken = join(root, "b-401.pid");
    writeFileSync(broken, "{ not json");

    expect(readPidRecord(valid)).toEqual(record({}));
    expect(readPidRecord(broken)).toBeNull();
    expect(readPidRecord(join(root, "missing.pid"))).toBeNull();
  });

  it("lists only .pid files, sorted, and nothing for a missing directory", () => {
    writeFileSync(join(root, "b-2.pid"), "");
    writeFileSync(join(root, "a-1.pid"), "");
    writeFileSync(join(root, "a-1.pid.tmp"), "");

    expect(listPidFiles(root)).toEqual(["a-1.pid", "b-2.pid"]);
    expect(listPidFiles(join(root, "missing"))).toEqual([]);
  });
});
```

- [ ] **Step 7: Write the failing pid-file tests with real processes**

Create `plugins/resource-manager/server/pid-files.posix.test.ts`:

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isCurrentPidSpace,
  killGroup,
  readPidRecord,
  readPidSpace,
  reclaimPidFile,
  sendSignal,
  writePidFile,
  type PidRecord,
} from "./pid-files.js";

const PROC = "/proc";
const children: ChildProcess[] = [];
let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rm-pidfile-"));
});

afterEach(() => {
  for (const child of children.splice(0)) {
    if (child.pid !== undefined) sendSignal(-child.pid, "SIGKILL");
  }
  rmSync(dir, { recursive: true, force: true });
});

// A process group of its own that lives until killed.
function startGroup(script = "setInterval(() => {}, 1000)"): ChildProcess {
  const child = spawn(process.execPath, ["-e", script], { detached: true, stdio: "ignore" });
  children.push(child);
  return child;
}

function exited(child: ChildProcess): Promise<NodeJS.Signals | number | null> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || child.signalCode !== null) {
      resolve(child.signalCode ?? child.exitCode);
      return;
    }
    child.once("exit", (code, signal) => resolve(signal ?? code));
  });
}

function pidOf(child: ChildProcess): number {
  if (child.pid === undefined) throw new Error("child did not start");
  return child.pid;
}

describe("writePidFile", () => {
  it("records the group, this daemon and the pid space in a 0600 file", () => {
    const child = startGroup();
    const file = join(dir, "srv-1.pid");

    writePidFile(file, pidOf(child), PROC);

    const record = readPidRecord(file);
    expect(record).toMatchObject({ pgid: pidOf(child), ownerPid: process.pid });
    expect(record?.startTime).toEqual(expect.any(Number));
    expect(record?.ownerStartTime).toEqual(expect.any(Number));
    expect(record === null ? false : isCurrentPidSpace(record, PROC)).toBe(true);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });
});

describe("reclaimPidFile", () => {
  it("keeps the file and the group while the owner lives", async () => {
    const child = startGroup();
    const owner = startGroup();
    const file = join(dir, "srv-2.pid");
    writePidFile(file, pidOf(child), PROC);
    const record = readPidRecord(file);
    if (record === null) throw new Error("no record");
    const ownerStat = readFileSync(`/proc/${pidOf(owner)}/stat`, "utf8");
    const ownerStartTime = Number(ownerStat.slice(ownerStat.lastIndexOf(")") + 2).split(" ")[19]);
    const owned: PidRecord = { ...record, ownerPid: pidOf(owner), ownerStartTime };
    writeFileSync(file, `${JSON.stringify(owned)}\n`);

    await expect(reclaimPidFile(file, PROC)).resolves.toBe("kept");
    expect(existsSync(file)).toBe(true);
    expect(sendSignal(-pidOf(child), 0)).toBe(true);
  });

  it("kills the recorded group of a dead owner and removes the file", async () => {
    const child = startGroup();
    const file = join(dir, "srv-3.pid");
    // Owned by this process: reclaim reads that as an earlier run of this daemon, now gone.
    writePidFile(file, pidOf(child), PROC);
    const gone = exited(child);

    await expect(reclaimPidFile(file, PROC)).resolves.toBe("killed");
    await expect(gone).resolves.toBe("SIGTERM");
    expect(existsSync(file)).toBe(false);
  });

  it("removes a record from another boot and leaves its pids alone", async () => {
    const child = startGroup();
    const file = join(dir, "srv-4.pid");
    writePidFile(file, pidOf(child), PROC);
    const record = readPidRecord(file);
    if (record === null) throw new Error("no record");
    writeFileSync(file, `${JSON.stringify({ ...record, bootId: "another-boot" })}\n`);

    await expect(reclaimPidFile(file, PROC)).resolves.toBe("stale");
    expect(existsSync(file)).toBe(false);
    expect(sendSignal(-pidOf(child), 0)).toBe(true);
  });

  it("removes a record whose leader start time no longer matches", async () => {
    const child = startGroup();
    const file = join(dir, "srv-5.pid");
    writePidFile(file, pidOf(child), PROC);
    const record = readPidRecord(file);
    if (record === null || record.startTime === null) throw new Error("no record");
    writeFileSync(file, `${JSON.stringify({ ...record, startTime: record.startTime + 1 })}\n`);

    await expect(reclaimPidFile(file, PROC)).resolves.toBe("stale");
    expect(sendSignal(-pidOf(child), 0)).toBe(true);
  });
});

describe("killGroup", () => {
  it("sends SIGKILL to a group that ignores SIGTERM once the grace period ends", async () => {
    const child = startGroup("process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)");
    // Give node time to install the handler before the SIGTERM.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const gone = exited(child);

    await killGroup(pidOf(child), 200);

    await expect(gone).resolves.toBe("SIGKILL");
  });

  it("does nothing for group 0 or 1", async () => {
    await expect(killGroup(1)).resolves.toBeUndefined();
    await expect(killGroup(0)).resolves.toBeUndefined();
    expect(readPidSpace(PROC).initStartTime).toEqual(expect.any(Number));
  });
});
```

- [ ] **Step 8: Run both pid-file test files and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/pid-files.test.ts --bail=1
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/pid-files.posix.test.ts --bail=1
```

Expected: both FAIL, `Cannot find module './pid-files.js'`.

- [ ] **Step 9: Write the pid-file module**

Create `plugins/resource-manager/server/pid-files.ts`:

```ts
import {
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { parseStat } from "./local/procfs.js";

// The record shared-mcp writes (plugins/shared-mcp/server/process-runner.ts:56-64), so one reader
// serves both plugins' files. startTime is field 22 of /proc/<pid>/stat: with ownerPid it tells a
// file left by a dead daemon from one a live daemon owns, and a group from a later process that
// reuses its pid. pidNamespace, bootId and initStartTime say which processes the pids name: after
// a container restart or a reboot the same pids name others. A record lacking any of them is stale.
export const PidRecordSchema = z.object({
  pgid: z.number().int(),
  startTime: z.number().int().nullable(),
  ownerPid: z.number().int().positive(),
  ownerStartTime: z.number().int().nullable(),
  pidNamespace: z.string().nullish(),
  bootId: z.string().nullish(),
  initStartTime: z.number().int().nullish(),
});
export type PidRecord = z.output<typeof PidRecordSchema>;

export interface PidSpace {
  pidNamespace: string | null;
  bootId: string | null;
  initStartTime: number | null;
}

export type ReclaimOutcome = "kept" | "stale" | "killed";

const KILL_GRACE_MS = 2_000;
const POLL_MS = 50;
const PID_FILE = /\.pid$/;

function readOrNull(read: () => string): string | null {
  try {
    return read();
  } catch {
    return null;
  }
}

export function readStartTime(pid: number, procRoot: string): number | null {
  const stat = readOrNull(() => readFileSync(join(procRoot, String(pid), "stat"), "utf8"));
  if (stat === null) return null;
  try {
    return parseStat(stat).startTime;
  } catch {
    return null;
  }
}

// The pid namespace (`pid:[<inode>]`), the boot this process runs in, and the start time of the
// namespace's pid 1 (a namespace inode can be reissued to a restarted container on the same boot,
// whose pid 1 starts later). Each is null without /proc.
export function readPidSpace(procRoot: string): PidSpace {
  return {
    pidNamespace: readOrNull(() => readlinkSync(join(procRoot, "self", "ns", "pid"))),
    bootId: readOrNull(() =>
      readFileSync(join(procRoot, "sys", "kernel", "random", "boot_id"), "utf8").trim(),
    ),
    initStartTime: readStartTime(1, procRoot),
  };
}

// False when the record comes from another pid namespace, boot or container run, does not say,
// or this process cannot tell its own.
export function isCurrentPidSpace(record: PidRecord, procRoot: string): boolean {
  const current = readPidSpace(procRoot);
  return (
    current.pidNamespace !== null &&
    current.bootId !== null &&
    current.initStartTime !== null &&
    record.pidNamespace === current.pidNamespace &&
    record.bootId === current.bootId &&
    record.initStartTime === current.initStartTime
  );
}

// false when the target is gone (ESRCH) or belongs to someone else (EPERM).
export function sendSignal(target: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(target, signal);
    return true;
  } catch {
    return false;
  }
}

// The same pid as this process means an earlier plugin run in this daemon, or a dead daemon whose
// pid this one reused: both are gone.
export function ownerIsAlive(record: PidRecord, procRoot: string, selfPid = process.pid): boolean {
  if (record.ownerPid === selfPid) return false;
  if (record.ownerStartTime === null) return sendSignal(record.ownerPid, 0);
  return readStartTime(record.ownerPid, procRoot) === record.ownerStartTime;
}

// A live leader must match the recorded start time. A live group whose leader has exited is taken
// to be the recorded one: the kernel does not reuse a pid while a group with that id exists. Same
// rule as shared-mcp's isRecordedGroup (process-runner.ts:472-476).
export function isRecordedGroup(record: PidRecord, procRoot: string): boolean {
  if (record.startTime === null || !sendSignal(-record.pgid, 0)) return false;
  const leaderStartTime = readStartTime(record.pgid, procRoot);
  return leaderStartTime === null || leaderStartTime === record.startTime;
}

// Written through a rename, so a daemon that dies mid-write leaves a stray .tmp file and never a
// truncated pid file. Throws when the file cannot be written; the caller kills the group then.
export function writePidFile(file: string, pgid: number, procRoot: string): void {
  const record: PidRecord = {
    pgid,
    startTime: readStartTime(pgid, procRoot),
    ownerPid: process.pid,
    ownerStartTime: readStartTime(process.pid, procRoot),
    ...readPidSpace(procRoot),
  };
  const tmpFile = `${file}.tmp`;
  writeFileSync(tmpFile, `${JSON.stringify(record)}\n`, { mode: 0o600 });
  renameSync(tmpFile, file);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// null for a missing file and for one that does not hold a record.
export function readPidRecord(file: string): PidRecord | null {
  const text = readOrNull(() => readFileSync(file, "utf8"));
  if (text === null) return null;
  const record = PidRecordSchema.safeParse(parseJson(text));
  return record.success ? record.data : null;
}

export function removePidFile(file: string): void {
  rmSync(file, { force: true });
}

export function listPidFiles(dir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => PID_FILE.test(name)).sort();
}

// SIGTERM to the group, then SIGKILL once graceMs passes with a member left. Group 0 is every
// kernel thread and group 1 the init tree, so those are never signalled. The waits are unref'd,
// so a pending kill never holds the daemon open.
export async function killGroup(pgid: number, graceMs = KILL_GRACE_MS): Promise<void> {
  if (pgid <= 1 || !sendSignal(-pgid, "SIGTERM")) return;
  const deadline = Date.now() + graceMs;
  while (sendSignal(-pgid, 0)) {
    if (Date.now() >= deadline) {
      sendSignal(-pgid, "SIGKILL");
      return;
    }
    await delay(POLL_MS, undefined, { ref: false });
  }
}

// A file from another pid space, or naming no live recorded group, is stale and only removed. A
// file whose owner is dead and whose group is still the recorded one gets the group killed first.
// A file whose owner lives is left alone: another daemon on the same PASEO_HOME owns it.
export async function reclaimPidFile(
  file: string,
  procRoot: string,
  selfPid = process.pid,
): Promise<ReclaimOutcome> {
  const record = readPidRecord(file);
  if (record !== null && record.pgid > 1 && isCurrentPidSpace(record, procRoot)) {
    if (ownerIsAlive(record, procRoot, selfPid)) return "kept";
    if (isRecordedGroup(record, procRoot)) {
      await killGroup(record.pgid);
      removePidFile(file);
      return "killed";
    }
  }
  removePidFile(file);
  return "stale";
}
```

- [ ] **Step 10: Run both pid-file test files and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/pid-files.test.ts --bail=1
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/pid-files.posix.test.ts --bail=1
```

Expected: PASS, 7 tests; PASS, 7 tests. The "kills the recorded group" test resolves `SIGTERM`: a plain `node -e` exits on the first signal.

- [ ] **Step 11: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/resource-manager/server/paths.ts plugins/resource-manager/server/paths.test.ts plugins/resource-manager/server/pid-files.ts plugins/resource-manager/server/pid-files.test.ts plugins/resource-manager/server/pid-files.posix.test.ts plugins/resource-manager/server/local/fake-proc.ts
cd /workspace/utils/paseo && npm run lint -- plugins/resource-manager
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: oxfmt exits 0; `Found 0 warnings and 0 errors.`; typecheck exit 0 (it covers `fake-proc.ts`, which is not a test file). Re-run Steps 4 and 10 if oxfmt changed a file.

- [ ] **Step 12: Commit**

```bash
P="plugins/resource-manager/server/paths.ts plugins/resource-manager/server/paths.test.ts plugins/resource-manager/server/pid-files.ts plugins/resource-manager/server/pid-files.test.ts plugins/resource-manager/server/pid-files.posix.test.ts plugins/resource-manager/server/local/fake-proc.ts"
git -C /workspace/utils/paseo add $P
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): resource-manager paths, pid files and fake /proc helper" -- $P
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo status --short --untracked-files=all -- $P
```

Expected: the hook passes; `6 files changed`; the fork identity; `status` prints nothing.

---

### Task 5: Process table, attribution and shared-mcp groups

**Files:**

- Create: `plugins/resource-manager/server/local/process-table.ts`
- Test: `plugins/resource-manager/server/local/process-table.test.ts`
- Create: `plugins/resource-manager/server/local/attribution.ts`
- Test: `plugins/resource-manager/server/local/attribution.test.ts`
- Create: `plugins/resource-manager/server/local/shared-mcp-groups.ts`
- Test: `plugins/resource-manager/server/local/shared-mcp-groups.test.ts`

**Interfaces:**

- Consumes: `parseStat`, `parseVmRssBytes`, `ProcStatParseError`, `walkProcessTree(pgid, procRoot)` from `server/local/procfs.ts` (Task 1); `listPidFiles`, `readPidRecord`, `isCurrentPidSpace`, `readStartTime` from `server/pid-files.ts` (Task 4); `writeFakeProc`, `FakeProcess`, `FakePidSpace` from `server/local/fake-proc.ts` (Task 4); `GroupKind` (Task 1). The heavy-gate marker contract (Cross-plan interfaces).
- Produces (`process-table.ts`):
  - `AGENT_ID_ENV = "PASEO_AGENT_ID"`, `HEAVY_GATE_ENV = "PASEO_HEAVY_GATE_HELD"`
  - `interface ProcessInfo { pid: number; ppid: number; startTime: number; cpuTicks: number; rssBytes: number; agentId: string | null; heavyGate: boolean }`
  - `interface ProcessMarkers { agentId: string | null; heavyGate: boolean }`
  - `parseCpuTicks(stat: string): number` (utime + stime; throws `ProcStatParseError`)
  - `parseMarkers(environ: string): ProcessMarkers`
  - `readProcessTable(procRoot: string): ProcessInfo[]` (synchronous; skips vanished or unparseable entries)
  - `findSupervisorPid(daemonPid: number, procRoot: string): number | null`
- Produces (`attribution.ts`):
  - `interface AttributionContext { daemonPid: number; supervisorPid: number | null; sharedMcpPids: ReadonlySet<number>; liveAgentIds: ReadonlySet<string> }`
  - `interface Attribution { agents: Map<string, number[]>; groups: Map<GroupKind, number[]> }`
  - `attribute(table: readonly ProcessInfo[], context: AttributionContext): Attribution` (every pid lands in exactly one list)
- Produces (`shared-mcp-groups.ts`): `readSharedMcpPids(runDir: string, procRoot: string): Set<number>`.

- [ ] **Step 1: Write the failing process-table tests**

Create `plugins/resource-manager/server/local/process-table.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { statLine, writeFakeProc } from "./fake-proc.js";
import {
  findSupervisorPid,
  parseCpuTicks,
  parseMarkers,
  readProcessTable,
  type ProcessInfo,
} from "./process-table.js";
import { ProcStatParseError } from "./procfs.js";

// comm "x) R 1 700 (y": fields are counted from the last ")".
const TRICKY_COMM_STAT =
  "4242 (x) R 1 700 (y) S 501 500 500 0 -1 4194304 2283 0 0 0 9 2 0 0 20 0 11 0 5339488 " +
  "1236512768 10960 18446744073709551615 1 1 0 0 0 0 0 16781312 17442 0 0 0 17 3 0 0 0 0 0 0 0 " +
  "0 0 0 0 0 0\n";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-ptable-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseCpuTicks", () => {
  it("adds utime and stime, counting from the last parenthesis", () => {
    expect(parseCpuTicks(TRICKY_COMM_STAT)).toBe(11);
    expect(parseCpuTicks(statLine({ pid: 7, ppid: 1, utime: 150, stime: 25 }))).toBe(175);
  });

  it("rejects a line without the tick fields", () => {
    expect(() => parseCpuTicks("7 (node) S 1")).toThrow(ProcStatParseError);
  });
});

describe("parseMarkers", () => {
  it("keeps the agent id and the heavy-gate marker and nothing else", () => {
    const environ = [
      "PATH=/usr/bin",
      "PASEO_PASSWORD=not-a-real-secret",
      "PASEO_AGENT_ID=agent-a",
      "PASEO_HEAVY_GATE_HELD=1",
      "",
    ].join("\0");

    expect(parseMarkers(environ)).toEqual({ agentId: "agent-a", heavyGate: true });
  });

  it("reads no marker from an empty environ or a gate value other than 1", () => {
    expect(parseMarkers("")).toEqual({ agentId: null, heavyGate: false });
    expect(parseMarkers("PASEO_HEAVY_GATE_HELD=0\0PASEO_AGENT_ID=\0")).toEqual({
      agentId: null,
      heavyGate: false,
    });
  });
});

describe("readProcessTable", () => {
  it("reads stat, RSS, ticks and markers, and skips what it cannot read", () => {
    writeFakeProc(root, [
      { pid: 1, ppid: 0, startTime: 10, rssKb: 512, comm: "tini" },
      {
        pid: 300,
        ppid: 164,
        startTime: 3000,
        utime: 40,
        stime: 2,
        rssKb: 307200,
        env: { PASEO_AGENT_ID: "agent-a", HOME: "/home/u" },
      },
      { pid: 2, ppid: 0, startTime: 5, rssKb: null, comm: "kthreadd", env: null },
    ]);
    // Pid 9 has an unparseable stat and no status: the table skips it.
    mkdirSync(join(root, "9"));
    writeFileSync(join(root, "9", "stat"), "garbage");

    const expected: ProcessInfo[] = [
      {
        pid: 1,
        ppid: 0,
        startTime: 10,
        cpuTicks: 0,
        rssBytes: 512 * 1024,
        agentId: null,
        heavyGate: false,
      },
      {
        pid: 2,
        ppid: 0,
        startTime: 5,
        cpuTicks: 0,
        rssBytes: 0,
        agentId: null,
        heavyGate: false,
      },
      {
        pid: 300,
        ppid: 164,
        startTime: 3000,
        cpuTicks: 42,
        rssBytes: 307200 * 1024,
        agentId: "agent-a",
        heavyGate: false,
      },
    ];
    expect(readProcessTable(root).sort((a, b) => a.pid - b.pid)).toEqual(expected);
  });

  it("returns nothing when /proc is missing", () => {
    expect(readProcessTable(join(root, "missing"))).toEqual([]);
  });
});

describe("findSupervisorPid", () => {
  it("names the parent whose title is Paseo Supervisor", () => {
    writeFakeProc(root, [
      { pid: 6, ppid: 1, cmdline: ["Paseo Supervisor", "", ""] },
      { pid: 164, ppid: 6, cmdline: ["Paseo Daemon"] },
    ]);

    expect(findSupervisorPid(164, root)).toBe(6);
  });

  it("is null when the daemon's parent is something else or unreadable", () => {
    writeFakeProc(root, [
      { pid: 50, ppid: 1, cmdline: ["npm", "run", "dev:server:raw"] },
      { pid: 164, ppid: 50, cmdline: ["Paseo Daemon"] },
    ]);

    expect(findSupervisorPid(164, root)).toBeNull();
    expect(findSupervisorPid(999, root)).toBeNull();
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/local/process-table.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './process-table.js'`.

- [ ] **Step 3: Write the process table**

Create `plugins/resource-manager/server/local/process-table.ts`:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseStat, parseVmRssBytes, ProcStatParseError } from "./procfs.js";

export const AGENT_ID_ENV = "PASEO_AGENT_ID";
// Sub-project 2's contract: every process of a command the heavy-command gate let through carries
// this variable set to 1; the gate's own shim process does not.
export const HEAVY_GATE_ENV = "PASEO_HEAVY_GATE_HELD";

export interface ProcessInfo {
  pid: number;
  ppid: number;
  startTime: number;
  /** utime + stime in clock ticks. */
  cpuTicks: number;
  /** 0 when the process has no VmRSS line (a kernel thread or a zombie). */
  rssBytes: number;
  agentId: string | null;
  heavyGate: boolean;
}

export interface ProcessMarkers {
  agentId: string | null;
  heavyGate: boolean;
}

interface ParsedStat {
  ppid: number;
  startTime: number;
  cpuTicks: number;
}

const PID_ENTRY = /^\d+$/;
const NO_MARKERS: ProcessMarkers = { agentId: null, heavyGate: false };
const AGENT_PREFIX = `${AGENT_ID_ENV}=`;
const HEAVY_GATE_ENTRY = `${HEAVY_GATE_ENV}=1`;
// packages/server/scripts/supervisor-entrypoint.ts:19 sets process.title to this. /proc/<pid>/
// cmdline then holds the title followed by NULs.
const SUPERVISOR_TITLE = "Paseo Supervisor";

// Fields 14 (utime) and 15 (stime), counted from the last ")" as parseStat does.
export function parseCpuTicks(stat: string): number {
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  const ticks = Number(fields[11]) + Number(fields[12]);
  if (!Number.isSafeInteger(ticks)) throw new ProcStatParseError(stat);
  return ticks;
}

// environ is NUL-separated KEY=VALUE pairs and holds secrets. Only the two markers leave this
// function; no other name or value is kept.
export function parseMarkers(environ: string): ProcessMarkers {
  let agentId: string | null = null;
  let heavyGate = false;
  for (const entry of environ.split("\0")) {
    if (entry.startsWith(AGENT_PREFIX)) agentId = entry.slice(AGENT_PREFIX.length) || null;
    else if (entry === HEAVY_GATE_ENTRY) heavyGate = true;
  }
  return { agentId, heavyGate };
}

// Any read error means the same here: the process is gone, or it is another user's and its
// environ is not readable.
function readOrNull(file: string): string | null {
  try {
    return readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function parseStatLine(stat: string): ParsedStat | null {
  try {
    const { ppid, startTime } = parseStat(stat);
    return { ppid, startTime, cpuTicks: parseCpuTicks(stat) };
  } catch {
    return null;
  }
}

function readProcess(procRoot: string, pid: number): ProcessInfo | null {
  const dir = join(procRoot, String(pid));
  const stat = readOrNull(join(dir, "stat"));
  const parsed = stat === null ? null : parseStatLine(stat);
  if (parsed === null) return null;
  const status = readOrNull(join(dir, "status"));
  const environ = readOrNull(join(dir, "environ"));
  const markers = environ === null ? NO_MARKERS : parseMarkers(environ);
  return {
    pid,
    ppid: parsed.ppid,
    startTime: parsed.startTime,
    cpuTicks: parsed.cpuTicks,
    rssBytes: (status === null ? null : parseVmRssBytes(status)) ?? 0,
    agentId: markers.agentId,
    heavyGate: markers.heavyGate,
  };
}

// Synchronous, like walkProcessTree: one /proc pass reads about 100 processes in a few ms, and a
// pass that yields between processes would see a tree that changed under it.
export function readProcessTable(procRoot: string): ProcessInfo[] {
  let names: string[];
  try {
    names = readdirSync(procRoot);
  } catch {
    return [];
  }
  const table: ProcessInfo[] = [];
  for (const name of names) {
    if (!PID_ENTRY.test(name)) continue;
    const info = readProcess(procRoot, Number(name));
    if (info !== null) table.push(info);
  }
  return table;
}

// The daemon worker's parent, when that parent is the supervisor. A daemon started without one has
// none, and then only the worker counts as the daemon.
export function findSupervisorPid(daemonPid: number, procRoot: string): number | null {
  const stat = readOrNull(join(procRoot, String(daemonPid), "stat"));
  const parsed = stat === null ? null : parseStatLine(stat);
  if (parsed === null) return null;
  const cmdline = readOrNull(join(procRoot, String(parsed.ppid), "cmdline"));
  return cmdline?.split("\0")[0] === SUPERVISOR_TITLE ? parsed.ppid : null;
}
```

- [ ] **Step 4: Run the process-table tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/local/process-table.test.ts --bail=1
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing attribution tests**

Create `plugins/resource-manager/server/local/attribution.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GroupKind } from "../../shared/rpc.js";
import { attribute, type AttributionContext } from "./attribution.js";
import type { ProcessInfo } from "./process-table.js";

interface Row {
  pid: number;
  ppid: number;
  agentId?: string;
  heavyGate?: boolean;
}

function table(rows: readonly Row[]): ProcessInfo[] {
  return rows.map((row) => ({
    pid: row.pid,
    ppid: row.ppid,
    startTime: 1000,
    cpuTicks: 0,
    rssBytes: 0,
    agentId: row.agentId ?? null,
    heavyGate: row.heavyGate ?? false,
  }));
}

const CONTEXT: AttributionContext = {
  daemonPid: 164,
  supervisorPid: 6,
  sharedMcpPids: new Set([400, 401]),
  liveAgentIds: new Set(["agent-a", "agent-c"]),
};

// The process tree this container had on 2026-11-06, plus one of each case.
const TREE = table([
  { pid: 1, ppid: 0 },
  { pid: 6, ppid: 1 },
  { pid: 164, ppid: 6 },
  { pid: 300, ppid: 164, agentId: "agent-a" },
  { pid: 301, ppid: 300 },
  { pid: 302, ppid: 301, agentId: "agent-a" },
  { pid: 310, ppid: 300, agentId: "agent-a", heavyGate: true },
  { pid: 311, ppid: 310 },
  { pid: 400, ppid: 164 },
  { pid: 401, ppid: 400 },
  { pid: 500, ppid: 164, agentId: "agent-gone" },
  { pid: 501, ppid: 500 },
  { pid: 600, ppid: 164 },
  { pid: 700, ppid: 164, agentId: "agent-c" },
  { pid: 900, ppid: 901 },
  { pid: 901, ppid: 900 },
]);

function sorted(map: Map<string, number[]>): Record<string, number[]> {
  const entries = [...map.entries()].map(([key, pids]): [string, number[]] => [
    key,
    [...pids].sort((a, b) => a - b),
  ]);
  return Object.fromEntries(entries);
}

describe("attribute", () => {
  it("partitions every process between agents and the four groups", () => {
    const result = attribute(TREE, CONTEXT);

    expect(sorted(result.agents)).toEqual({ "agent-a": [300, 301, 302], "agent-c": [700] });
    const groups: Record<GroupKind, number[]> = {
      daemon: [6, 164, 600],
      sharedMcp: [400, 401],
      heavyGate: [310, 311],
      other: [1, 500, 501, 900, 901],
    };
    expect(sorted(result.groups)).toEqual(groups);
  });

  it("puts a shared MCP server under its group even when it names an agent", () => {
    const rows = table([
      { pid: 164, ppid: 1 },
      { pid: 400, ppid: 164, agentId: "agent-a" },
    ]);
    const result = attribute(rows, CONTEXT);

    expect(result.groups.get("sharedMcp")).toEqual([400]);
    expect(result.agents.size).toBe(0);
  });

  it("counts everything under 'other' when no agent is live", () => {
    const result = attribute(TREE, { ...CONTEXT, liveAgentIds: new Set() });

    expect(result.agents.size).toBe(0);
    expect(result.groups.get("other")).toEqual(
      expect.arrayContaining([300, 301, 302, 700, 500, 501]),
    );
    expect(result.groups.get("heavyGate")).toEqual([310, 311]);
  });

  it("without a supervisor, its process falls to its parent's owner", () => {
    const result = attribute(TREE, { ...CONTEXT, supervisorPid: null });

    expect(result.groups.get("other")).toEqual(expect.arrayContaining([1, 6]));
    expect(result.groups.get("daemon")).toEqual(expect.arrayContaining([164, 600]));
    expect(result.groups.get("daemon")).not.toContain(6);
  });
});
```

- [ ] **Step 6: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/local/attribution.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './attribution.js'`.

- [ ] **Step 7: Write the attribution**

Create `plugins/resource-manager/server/local/attribution.ts`:

```ts
import type { GroupKind } from "../../shared/rpc.js";
import type { ProcessInfo } from "./process-table.js";

export interface AttributionContext {
  daemonPid: number;
  supervisorPid: number | null;
  /** Every pid in a shared-mcp server's tree (readSharedMcpPids). */
  sharedMcpPids: ReadonlySet<number>;
  liveAgentIds: ReadonlySet<string>;
}

export interface Attribution {
  agents: Map<string, number[]>;
  groups: Map<GroupKind, number[]>;
}

type Owner = { kind: "agent"; agentId: string } | { kind: "group"; group: GroupKind };

const DAEMON: Owner = { kind: "group", group: "daemon" };
const SHARED_MCP: Owner = { kind: "group", group: "sharedMcp" };
const HEAVY_GATE: Owner = { kind: "group", group: "heavyGate" };
const OTHER: Owner = { kind: "group", group: "other" };

// A process's own owner, or null when it inherits its parent's. First match wins: shared-mcp
// servers strip PASEO_* from their env but are still listed by pid; a heavy command also carries
// its agent's PASEO_AGENT_ID, and the gate's group takes it.
function ownOwner(info: ProcessInfo, context: AttributionContext): Owner | null {
  if (context.sharedMcpPids.has(info.pid)) return SHARED_MCP;
  if (info.pid === context.daemonPid || info.pid === context.supervisorPid) return DAEMON;
  if (info.heavyGate) return HEAVY_GATE;
  if (info.agentId === null) return null;
  return context.liveAgentIds.has(info.agentId) ? { kind: "agent", agentId: info.agentId } : OTHER;
}

function push<Key>(map: Map<Key, number[]>, key: Key, pid: number): void {
  const pids = map.get(key);
  if (pids) pids.push(pid);
  else map.set(key, [pid]);
}

// Each process gets exactly one owner. A process that inherits walks up its ppid chain until a
// process with an owner of its own; the tree root and a ppid cycle (a table read while processes
// were reparented) end at "other".
export function attribute(table: readonly ProcessInfo[], context: AttributionContext): Attribution {
  const byPid = new Map(table.map((info): [number, ProcessInfo] => [info.pid, info]));
  const owners = new Map<number, Owner>();

  const ownerOf = (start: ProcessInfo): Owner => {
    const chain: number[] = [];
    const seen = new Set<number>();
    let owner = OTHER;
    let current: ProcessInfo | undefined = start;
    while (current !== undefined && !seen.has(current.pid)) {
      const known = owners.get(current.pid);
      if (known !== undefined) {
        owner = known;
        break;
      }
      seen.add(current.pid);
      chain.push(current.pid);
      const own = ownOwner(current, context);
      if (own !== null) {
        owner = own;
        break;
      }
      current = byPid.get(current.ppid);
    }
    for (const pid of chain) owners.set(pid, owner);
    return owner;
  };

  const agents = new Map<string, number[]>();
  const groups = new Map<GroupKind, number[]>();
  for (const info of table) {
    const owner = ownerOf(info);
    if (owner.kind === "agent") push(agents, owner.agentId, info.pid);
    else push(groups, owner.group, info.pid);
  }
  return { agents, groups };
}
```

- [ ] **Step 8: Run the attribution tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/local/attribution.test.ts --bail=1
```

Expected: PASS, 4 tests.

- [ ] **Step 9: Write the failing shared-mcp group tests**

Create `plugins/resource-manager/server/local/shared-mcp-groups.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PidRecord } from "../pid-files.js";
import { writeFakeProc, type FakePidSpace } from "./fake-proc.js";
import { readSharedMcpPids } from "./shared-mcp-groups.js";

const SPACE: FakePidSpace = { pidNamespace: "pid:[4026531836]", bootId: "boot-1" };

let root: string;
let procRoot: string;
let runDir: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-smcp-"));
  procRoot = join(root, "proc");
  runDir = join(root, "run");
  mkdirSync(runDir);
  writeFakeProc(
    procRoot,
    [
      { pid: 1, ppid: 0, startTime: 10 },
      { pid: 164, ppid: 1, startTime: 5000 },
      { pid: 400, ppid: 164, startTime: 4000 },
      { pid: 401, ppid: 400, pgrp: 400, startTime: 4001 },
      // Serena-style: a child in a session of its own still belongs to the server.
      { pid: 402, ppid: 401, pgrp: 402, startTime: 4002 },
      { pid: 450, ppid: 164, startTime: 4500 },
    ],
    SPACE,
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeRecord(name: string, overrides: Partial<PidRecord>): string {
  const record: PidRecord = {
    pgid: 400,
    startTime: 4000,
    ownerPid: 164,
    ownerStartTime: 5000,
    pidNamespace: SPACE.pidNamespace,
    bootId: SPACE.bootId,
    initStartTime: 10,
    ...overrides,
  };
  const file = join(runDir, name);
  writeFileSync(file, `${JSON.stringify(record)}\n`);
  return file;
}

describe("readSharedMcpPids", () => {
  it("returns every pid in each recorded server's tree", () => {
    writeRecord("context7.pid", {});
    writeRecord("gitlab.pid", { pgid: 450, startTime: 4500 });

    expect([...readSharedMcpPids(runDir, procRoot)].sort((a, b) => a - b)).toEqual([
      400, 401, 402, 450,
    ]);
  });

  it("skips records from another boot, with a reused leader pid, or that do not parse", () => {
    writeRecord("old-boot.pid", { bootId: "boot-0" });
    writeRecord("reused.pid", { pgid: 450, startTime: 9999 });
    writeFileSync(join(runDir, "broken.pid"), "{");

    expect(readSharedMcpPids(runDir, procRoot).size).toBe(0);
  });

  it("never removes a pid file, stale or not", () => {
    const stale = writeRecord("old-boot.pid", { bootId: "boot-0" });

    readSharedMcpPids(runDir, procRoot);

    expect(existsSync(stale)).toBe(true);
  });

  it("returns an empty set when shared-mcp has no run directory", () => {
    expect(readSharedMcpPids(join(root, "missing"), procRoot).size).toBe(0);
  });
});
```

- [ ] **Step 10: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/local/shared-mcp-groups.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './shared-mcp-groups.js'`.

- [ ] **Step 11: Write the shared-mcp group reader**

Create `plugins/resource-manager/server/local/shared-mcp-groups.ts`:

```ts
import { join } from "node:path";
import { isCurrentPidSpace, listPidFiles, readPidRecord, readStartTime } from "../pid-files.js";
import { walkProcessTree } from "./procfs.js";

// shared-mcp names each server's process group in <PASEO_HOME>/shared-mcp/run/<id>.pid. This only
// reads those files: it never writes, removes or signals anything they name. A record counts when
// it is from this pid space and its leader still runs with the recorded start time; a server whose
// leader exited is missed, and its processes count under their parent's owner instead.
export function readSharedMcpPids(runDir: string, procRoot: string): Set<number> {
  const pids = new Set<number>();
  for (const name of listPidFiles(runDir)) {
    try {
      const record = readPidRecord(join(runDir, name));
      if (record === null || record.pgid <= 1 || record.startTime === null) continue;
      if (!isCurrentPidSpace(record, procRoot)) continue;
      if (readStartTime(record.pgid, procRoot) !== record.startTime) continue;
      for (const { pid } of walkProcessTree(record.pgid, procRoot)) pids.add(pid);
    } catch (error) {
      // One unreadable record must not hide the rest. walkProcessTree throws only on errors other
      // than a vanished process, such as EACCES.
      console.error(`resource-manager: skipped shared-mcp pid file ${name}`, error);
    }
  }
  return pids;
}
```

- [ ] **Step 12: Run the shared-mcp group tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/local/shared-mcp-groups.test.ts --bail=1
```

Expected: PASS, 4 tests.

- [ ] **Step 13: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/resource-manager/server/local/process-table.ts plugins/resource-manager/server/local/process-table.test.ts plugins/resource-manager/server/local/attribution.ts plugins/resource-manager/server/local/attribution.test.ts plugins/resource-manager/server/local/shared-mcp-groups.ts plugins/resource-manager/server/local/shared-mcp-groups.test.ts
cd /workspace/utils/paseo && npm run lint -- plugins/resource-manager
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: oxfmt exits 0; `Found 0 warnings and 0 errors.`; typecheck exit 0. Re-run Steps 4, 8 and 12 for any file oxfmt changed.

- [ ] **Step 14: Commit**

```bash
P="plugins/resource-manager/server/local/process-table.ts plugins/resource-manager/server/local/process-table.test.ts plugins/resource-manager/server/local/attribution.ts plugins/resource-manager/server/local/attribution.test.ts plugins/resource-manager/server/local/shared-mcp-groups.ts plugins/resource-manager/server/local/shared-mcp-groups.test.ts"
git -C /workspace/utils/paseo add $P
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): resource-manager process table and process-to-agent attribution" -- $P
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo status --short --untracked-files=all -- $P
```

Expected: the hook passes; `6 files changed`; the fork identity; `status` prints nothing.

---

### Task 6: Paseo ports and the local reader

**Files:**

- Create: `plugins/resource-manager/server/paseo-ports.ts`
- Create: `plugins/resource-manager/server/fake-ports.ts` (typed in-memory fakes, typechecked with the plugin)
- Test: `plugins/resource-manager/server/paseo-ports.test.ts`
- Create: `plugins/resource-manager/server/local/local-reader.ts`
- Test: `plugins/resource-manager/server/local/local-reader.test.ts`

**Interfaces:**

- Consumes:
  - `PluginHandlerContext { paseo: PaseoApi }` (`packages/plugin/src/server/contracts.ts:9-11`), exported as a type from `@getpaseo/plugin/server`.
  - `paseo.agents.list(options?: PaseoAgentListOptions): Promise<PaseoAgentListResult>` (second overload, `packages/client/src/index.ts:412`); `PaseoAgentListOptions = FetchAgentsOptions` (`:114`), so `{ includeBackground?, filter?: { statuses?, includeBackground?, ... }, page?: { limit (<= 200), cursor? } }` (`packages/protocol/src/messages.ts:962-972`, `:1302-1330`); `PaseoAgentListResult { entries: FetchAgentsEntry[]; pageInfo: { nextCursor: string | null; prevCursor; hasMore: boolean } }` (`index.ts:126-132`), each entry's `agent` an `AgentSnapshotPayload` with `id`, `title: string | null`, `provider: string`, `status`, `updatedAt` (`messages.ts:863`).
  - `paseo.agents.ref(agent: string | PaseoAgent): PaseoAgentHandle` (`index.ts:413`); `PaseoAgentHandle.refresh(requestId?: string): Promise<PaseoAgentRefetchResult | null>` (`:380`, result `{ agent, project }` at `:283-286`); `PaseoAgentHandle.closeRuntime(): Promise<void>` (Task 2), which rejects with the daemon's reason when `AgentManager.closeRuntimeIfIdle` keeps the runtime, and with "Update the host to close agent runtimes." on a host without `agentRuntimeClose`.
  - `paseo.workspaces.list(options?: PaseoWorkspaceListOptions): Promise<PaseoWorkspaceListResult>` (`index.ts:218`); entries are `WorkspaceDescriptorPayload` with `projectRootPath: string` and `workspaceDirectory?: string` (`messages.ts:4263-4277`); `page` as for agents (`messages.ts:1362-1367`).
  - `LiveStatusSchema`, `isClosableStatus`, `CloseAgentResult`, `AgentUsage`, `GroupUsage`, `GroupKindSchema`, `LocalReading` (Task 1); `readHostSummary` (Task 3); `readProcessTable`, `findSupervisorPid`, `ProcessInfo`, `attribute`, `readSharedMcpPids` (Task 5); `writeFakeProc` (Task 4).
- Produces (`paseo-ports.ts`):
  - `interface AgentSummary { id: string; title: string | null; provider: string; status: string; updatedAt: string; persistence: { sessionId: string } | null }` (`AgentSnapshotPayload.persistence` is `AgentPersistenceHandle | null`, `messages.ts:840-847`, `:881`, so the client's snapshot fits)
  - `interface PageInfo { nextCursor: string | null; hasMore: boolean }`, `interface PageRequest { limit: number; cursor?: string }`
  - `interface AgentListRequest { includeBackground: boolean; filter: { statuses: LiveStatus[]; includeBackground: boolean }; page: PageRequest }`
  - `interface AgentListPage { entries: { agent: AgentSummary }[]; pageInfo: PageInfo }`
  - `interface AgentHandlePort { refresh(): Promise<{ agent: AgentSummary } | null>; closeRuntime(): Promise<void> }`
  - `interface AgentsPort { list(request: AgentListRequest): Promise<AgentListPage>; ref(agentId: string): AgentHandlePort }`
  - `interface WorkspaceSummary { projectRootPath: string; workspaceDirectory?: string }`, `interface WorkspaceListRequest { page: PageRequest }`, `interface WorkspaceListPage { entries: WorkspaceSummary[]; pageInfo: PageInfo }`, `interface WorkspacesPort { list(request: WorkspaceListRequest): Promise<WorkspaceListPage> }`
  - `interface PaseoPorts { agents: AgentsPort; workspaces: WorkspacesPort }`
  - `interface LiveAgent { id: string; title: string | null; provider: string; status: LiveStatus; updatedAt: string }`
  - `listLiveAgents(agents: AgentsPort): Promise<LiveAgent[]>`, `listWorkspaceDirectories(workspaces: WorkspacesPort): Promise<string[]>`, `closeIdleAgent(agents: AgentsPort, agentId: string): Promise<CloseAgentResult>` (never rejects), `paseoPorts(paseo: PluginHandlerContext["paseo"]): PaseoPorts`
- Produces (`fake-ports.ts`): `class FakeAgents implements AgentsPort` (`requests`, `closed`, `listError`, `refreshError`, `closeError`; pages by numeric cursor), `class FakeWorkspaces implements WorkspacesPort` (`requests`, `listError`).
- Produces (`local-reader.ts`): `USER_HZ = 100`, `interface LocalReaderOptions { procRoot; cgroupRoot; sharedMcpRunDir; daemonPid; cores; now(): number; sleep(ms: number): Promise<void> }`, `type AgentLister = () => Promise<LiveAgent[]>`, `class LocalReader { read(listAgents: AgentLister): Promise<LocalReading> }`.

- [ ] **Step 1: Write the failing port tests**

The tests drive the ports through the typed fakes that Step 3 writes, so both modules are missing on the first run.

Create `plugins/resource-manager/server/paseo-ports.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FakeAgents, FakeWorkspaces } from "./fake-ports.js";
import {
  closeIdleAgent,
  listLiveAgents,
  listWorkspaceDirectories,
  type AgentSummary,
  type LiveAgent,
} from "./paseo-ports.js";

function agent(id: string, status: string): AgentSummary {
  return {
    id,
    title: `Agent ${id}`,
    provider: "claude",
    status,
    updatedAt: "2026-11-06T09:00:00.000Z",
    persistence: { sessionId: `session-${id}` },
  };
}

describe("listLiveAgents", () => {
  it("follows every page and keeps only live agents", async () => {
    const agents = new FakeAgents(
      [
        agent("a", "idle"),
        agent("b", "running"),
        agent("c", "closed"),
        agent("d", "initializing"),
        agent("e", "error"),
      ],
      2,
    );

    const live = await listLiveAgents(agents);

    const expected: LiveAgent[] = [
      {
        id: "a",
        title: "Agent a",
        provider: "claude",
        status: "idle",
        updatedAt: "2026-11-06T09:00:00.000Z",
      },
      {
        id: "b",
        title: "Agent b",
        provider: "claude",
        status: "running",
        updatedAt: "2026-11-06T09:00:00.000Z",
      },
      {
        id: "d",
        title: "Agent d",
        provider: "claude",
        status: "initializing",
        updatedAt: "2026-11-06T09:00:00.000Z",
      },
      {
        id: "e",
        title: "Agent e",
        provider: "claude",
        status: "error",
        updatedAt: "2026-11-06T09:00:00.000Z",
      },
    ];
    expect(live).toEqual(expected);
    expect(agents.requests.map((request) => request.page.cursor)).toEqual([undefined, "2", "4"]);
    expect(agents.requests[0]).toEqual({
      includeBackground: true,
      filter: { statuses: ["initializing", "idle", "running", "error"], includeBackground: true },
      page: { limit: 200, cursor: undefined },
    });
  });

  it("passes a failed list through", async () => {
    const agents = new FakeAgents([]);
    agents.listError = new Error("daemon unavailable");

    await expect(listLiveAgents(agents)).rejects.toThrow("daemon unavailable");
  });
});

describe("listWorkspaceDirectories", () => {
  it("uses the workspace directory, else the project root, once each, over every page", async () => {
    const workspaces = new FakeWorkspaces(
      [
        { projectRootPath: "/repo", workspaceDirectory: "/repo/.paseo/worktrees/fix" },
        { projectRootPath: "/repo" },
        { projectRootPath: "/other" },
        { projectRootPath: "/repo" },
      ],
      3,
    );

    await expect(listWorkspaceDirectories(workspaces)).resolves.toEqual([
      "/repo/.paseo/worktrees/fix",
      "/repo",
      "/other",
    ]);
    expect(workspaces.requests).toEqual([
      { page: { limit: 200, cursor: undefined } },
      { page: { limit: 200, cursor: "3" } },
    ]);
  });
});

describe("closeIdleAgent", () => {
  it("closes an idle agent's runtime", async () => {
    const agents = new FakeAgents([agent("a", "idle")]);

    await expect(closeIdleAgent(agents, "a")).resolves.toEqual({ ok: true, error: null });
    expect(agents.closed).toEqual(["a"]);
  });

  it("refuses a running or starting agent and leaves it alone", async () => {
    const agents = new FakeAgents([agent("b", "running"), agent("d", "initializing")]);

    const busy = { ok: false, error: "Agent is busy; close it once it is idle" };
    await expect(closeIdleAgent(agents, "b")).resolves.toEqual(busy);
    await expect(closeIdleAgent(agents, "d")).resolves.toEqual(busy);
    expect(agents.closed).toEqual([]);
  });

  it("accepts an agent that is already closed without closing it again", async () => {
    const agents = new FakeAgents([agent("c", "closed")]);

    await expect(closeIdleAgent(agents, "c")).resolves.toEqual({ ok: true, error: null });
    expect(agents.closed).toEqual([]);
  });

  it("refuses an idle agent without a saved session to resume", async () => {
    const agents = new FakeAgents([{ ...agent("n", "idle"), persistence: null }]);

    await expect(closeIdleAgent(agents, "n")).resolves.toEqual({
      ok: false,
      error: "This agent has no saved session to resume, so it stays open",
    });
    expect(agents.closed).toEqual([]);
  });

  it("reports a missing agent, a failed refresh and a failed close", async () => {
    const agents = new FakeAgents([agent("a", "idle")]);
    await expect(closeIdleAgent(agents, "zz")).resolves.toEqual({
      ok: false,
      error: "Agent not found",
    });

    agents.closeError = new Error("Agent a not found");
    await expect(closeIdleAgent(agents, "a")).resolves.toEqual({
      ok: false,
      error: "Agent a not found",
    });

    agents.refreshError = new Error("socket closed");
    await expect(closeIdleAgent(agents, "a")).resolves.toEqual({
      ok: false,
      error: "socket closed",
    });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/paseo-ports.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './fake-ports.js'`: neither module exists yet, so no test runs.

- [ ] **Step 3: Write the ports and their fakes**

The ports are types plus three small functions; the fakes implement the same types, so the tests and the adapter share one contract.

Create `plugins/resource-manager/server/paseo-ports.ts`:

```ts
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import {
  isClosableStatus,
  LiveStatusSchema,
  type CloseAgentResult,
  type LiveStatus,
} from "../shared/rpc.js";

// The slice of the in-process paseo client this plugin uses, so the logic can be tested against
// typed fakes. paseoPorts() adapts the real client; the compiler checks that it fits.

export interface AgentSummary {
  id: string;
  title: string | null;
  provider: string;
  status: string;
  updatedAt: string;
  /** The provider session a closed runtime resumes from; null when there is none. */
  persistence: { sessionId: string } | null;
}

export interface PageInfo {
  nextCursor: string | null;
  hasMore: boolean;
}

export interface PageRequest {
  limit: number;
  cursor?: string;
}

export interface AgentListRequest {
  includeBackground: boolean;
  filter: { statuses: LiveStatus[]; includeBackground: boolean };
  page: PageRequest;
}

export interface AgentListPage {
  entries: { agent: AgentSummary }[];
  pageInfo: PageInfo;
}

export interface AgentHandlePort {
  refresh(): Promise<{ agent: AgentSummary } | null>;
  closeRuntime(): Promise<void>;
}

export interface AgentsPort {
  list(request: AgentListRequest): Promise<AgentListPage>;
  ref(agentId: string): AgentHandlePort;
}

export interface WorkspaceSummary {
  projectRootPath: string;
  workspaceDirectory?: string;
}

export interface WorkspaceListRequest {
  page: PageRequest;
}

export interface WorkspaceListPage {
  entries: WorkspaceSummary[];
  pageInfo: PageInfo;
}

export interface WorkspacesPort {
  list(request: WorkspaceListRequest): Promise<WorkspaceListPage>;
}

export interface PaseoPorts {
  agents: AgentsPort;
  workspaces: WorkspacesPort;
}

export interface LiveAgent {
  id: string;
  title: string | null;
  provider: string;
  status: LiveStatus;
  updatedAt: string;
}

// The daemon caps a page at 200 (FetchAgentsRequestMessageSchema, page.limit).
const PAGE_LIMIT = 200;
const LIVE_STATUSES: LiveStatus[] = Object.values(LiveStatusSchema.enum);

function nextCursor(pageInfo: PageInfo): string | undefined {
  if (!pageInfo.hasMore || pageInfo.nextCursor === null) return undefined;
  return pageInfo.nextCursor;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// Every agent whose runtime may hold processes, background agents included. A status outside
// the live set is dropped even if the daemon returns it.
export async function listLiveAgents(agents: AgentsPort): Promise<LiveAgent[]> {
  const live: LiveAgent[] = [];
  let cursor: string | undefined;
  do {
    const page = await agents.list({
      includeBackground: true,
      filter: { statuses: LIVE_STATUSES, includeBackground: true },
      page: { limit: PAGE_LIMIT, cursor },
    });
    for (const { agent } of page.entries) {
      const status = LiveStatusSchema.safeParse(agent.status);
      if (!status.success) continue;
      live.push({
        id: agent.id,
        title: agent.title,
        provider: agent.provider,
        status: status.data,
        updatedAt: agent.updatedAt,
      });
    }
    cursor = nextCursor(page.pageInfo);
  } while (cursor !== undefined);
  return live;
}

// The directory each workspace runs in: the worktree for a worktree workspace, else the project
// root. Claude's local-scope config and .mcp.json are keyed by that directory.
export async function listWorkspaceDirectories(workspaces: WorkspacesPort): Promise<string[]> {
  const directories = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await workspaces.list({ page: { limit: PAGE_LIMIT, cursor } });
    for (const workspace of page.entries) {
      directories.add(workspace.workspaceDirectory ?? workspace.projectRootPath);
    }
    cursor = nextCursor(page.pageInfo);
  } while (cursor !== undefined);
  return [...directories];
}

// Re-reads the agent so a stale screen cannot close a busy or errored one. "closed" is already
// done. An agent without a persistence handle stays open: its next prompt would start a new
// provider session instead of resuming (agent-loading.ts ensureAgentLoaded), which is also why
// idle collection skips it (agent-manager.ts:2022). The daemon repeats these checks and asks the
// provider about background work (AgentManager.closeRuntimeIfIdle); closeRuntime() rejects with
// its reason. Never rejects: an error comes back as the message.
export async function closeIdleAgent(
  agents: AgentsPort,
  agentId: string,
): Promise<CloseAgentResult> {
  try {
    const handle = agents.ref(agentId);
    const snapshot = await handle.refresh();
    if (snapshot === null) return { ok: false, error: "Agent not found" };
    const { status, persistence } = snapshot.agent;
    if (status === "closed") return { ok: true, error: null };
    if (!isClosableStatus(status)) {
      return { ok: false, error: "Agent is busy; close it once it is idle" };
    }
    if (persistence === null) {
      return { ok: false, error: "This agent has no saved session to resume, so it stays open" };
    }
    await handle.closeRuntime();
    return { ok: true, error: null };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
}

export function paseoPorts(paseo: PluginHandlerContext["paseo"]): PaseoPorts {
  return {
    agents: {
      list: (request) => paseo.agents.list(request),
      ref: (agentId) => paseo.agents.ref(agentId),
    },
    workspaces: {
      list: (request) => paseo.workspaces.list(request),
    },
  };
}
```

Create `plugins/resource-manager/server/fake-ports.ts`:

```ts
import type {
  AgentHandlePort,
  AgentListPage,
  AgentListRequest,
  AgentsPort,
  AgentSummary,
  PageRequest,
  WorkspaceListPage,
  WorkspaceListRequest,
  WorkspacesPort,
  WorkspaceSummary,
} from "./paseo-ports.js";

// Typed in-memory stand-ins for the paseo client, for tests. Cursors are entry indexes. Like a
// daemon that ignores the status filter, FakeAgents returns every snapshot, so tests also cover
// the client-side live filter.

function pageOf<Entry>(items: readonly Entry[], page: PageRequest, pageSize: number) {
  const start = page.cursor === undefined ? 0 : Number(page.cursor);
  const end = start + Math.min(pageSize, page.limit);
  const hasMore = end < items.length;
  return {
    entries: items.slice(start, end),
    pageInfo: { nextCursor: hasMore ? String(end) : null, hasMore },
  };
}

export class FakeAgents implements AgentsPort {
  readonly requests: AgentListRequest[] = [];
  readonly closed: string[] = [];
  listError: Error | null = null;
  refreshError: Error | null = null;
  closeError: Error | null = null;
  private readonly snapshots: AgentSummary[];
  private readonly pageSize: number;

  constructor(snapshots: AgentSummary[], pageSize = 200) {
    this.snapshots = snapshots;
    this.pageSize = pageSize;
  }

  list(request: AgentListRequest): Promise<AgentListPage> {
    this.requests.push(request);
    if (this.listError !== null) return Promise.reject(this.listError);
    const page = pageOf(this.snapshots, request.page, this.pageSize);
    return Promise.resolve({
      entries: page.entries.map((agent) => ({ agent })),
      pageInfo: page.pageInfo,
    });
  }

  ref(agentId: string): AgentHandlePort {
    return {
      refresh: () => this.refresh(agentId),
      closeRuntime: () => this.closeRuntime(agentId),
    };
  }

  private refresh(agentId: string): Promise<{ agent: AgentSummary } | null> {
    if (this.refreshError !== null) return Promise.reject(this.refreshError);
    const agent = this.snapshots.find((candidate) => candidate.id === agentId);
    return Promise.resolve(agent === undefined ? null : { agent: { ...agent } });
  }

  private closeRuntime(agentId: string): Promise<void> {
    if (this.closeError !== null) return Promise.reject(this.closeError);
    this.closed.push(agentId);
    const agent = this.snapshots.find((candidate) => candidate.id === agentId);
    if (agent !== undefined) agent.status = "closed";
    return Promise.resolve();
  }
}

export class FakeWorkspaces implements WorkspacesPort {
  readonly requests: WorkspaceListRequest[] = [];
  listError: Error | null = null;
  private readonly workspaces: WorkspaceSummary[];
  private readonly pageSize: number;

  constructor(workspaces: WorkspaceSummary[], pageSize = 200) {
    this.workspaces = workspaces;
    this.pageSize = pageSize;
  }

  list(request: WorkspaceListRequest): Promise<WorkspaceListPage> {
    this.requests.push(request);
    if (this.listError !== null) return Promise.reject(this.listError);
    return Promise.resolve(pageOf(this.workspaces, request.page, this.pageSize));
  }
}
```

- [ ] **Step 4: Run the port tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/paseo-ports.test.ts --bail=1
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Write the failing local reader tests**

Create `plugins/resource-manager/server/local/local-reader.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentUsage, GroupUsage, HostSummary } from "../../shared/rpc.js";
import type { LiveAgent } from "../paseo-ports.js";
import type { PidRecord } from "../pid-files.js";
import { writeFakeProc, type FakePidSpace, type FakeProcess } from "./fake-proc.js";
import { LocalReader } from "./local-reader.js";

const SPACE: FakePidSpace = { pidNamespace: "pid:[4026531836]", bootId: "boot-1" };
const T0 = Date.parse("2026-11-06T09:00:00.000Z");
const KIB = 1024;

// The container's tree on 2026-11-06 (tini, supervisor, daemon), plus one of each kind. Each
// round adds CPU ticks to three processes: agent-a +150 and +50, the heavy command +100.
function processes(round: number): FakeProcess[] {
  return [
    { pid: 1, ppid: 0, startTime: 10, rssKb: 512, comm: "tini" },
    { pid: 2, ppid: 0, startTime: 11, rssKb: null, comm: "kthreadd", env: null },
    { pid: 6, ppid: 1, startTime: 100, rssKb: 47316, cmdline: ["Paseo Supervisor", "", ""] },
    { pid: 164, ppid: 6, startTime: 200, rssKb: 286020, cmdline: ["Paseo Daemon"] },
    {
      pid: 300,
      ppid: 164,
      startTime: 3000,
      rssKb: 307200,
      utime: 1000 + 150 * round,
      env: { PASEO_AGENT_ID: "agent-a" },
    },
    {
      pid: 301,
      ppid: 300,
      startTime: 3010,
      rssKb: 204800,
      utime: 500 + 50 * round,
      env: { PASEO_AGENT_ID: "agent-a" },
    },
    {
      pid: 310,
      ppid: 300,
      startTime: 3100,
      rssKb: 1048576,
      utime: 2000 + 100 * round,
      env: { PASEO_AGENT_ID: "agent-a", PASEO_HEAVY_GATE_HELD: "1" },
    },
    { pid: 311, ppid: 310, startTime: 3110, rssKb: 20480 },
    { pid: 400, ppid: 164, startTime: 4000, rssKb: 102400 },
    { pid: 401, ppid: 400, pgrp: 401, startTime: 4001, rssKb: 51200 },
    { pid: 500, ppid: 164, startTime: 5000, rssKb: 10240, env: { PASEO_AGENT_ID: "agent-gone" } },
    { pid: 600, ppid: 164, startTime: 6000, rssKb: 4096 },
    { pid: 700, ppid: 164, startTime: 7000, rssKb: 409600, env: { PASEO_AGENT_ID: "agent-c" } },
  ];
}

const AGENTS: LiveAgent[] = [
  {
    id: "agent-a",
    title: "Fix login",
    provider: "claude",
    status: "idle",
    updatedAt: "2026-11-06T08:50:00.000Z",
  },
  {
    id: "agent-b",
    title: null,
    provider: "codex",
    status: "idle",
    updatedAt: "2026-11-06T08:00:00.000Z",
  },
  {
    id: "agent-c",
    title: "Refactor",
    provider: "codex",
    status: "running",
    updatedAt: "2026-11-06T08:59:00.000Z",
  },
];

const NO_HOST: HostSummary = {
  memoryUsedBytes: null,
  memoryLimitBytes: null,
  swapUsedBytes: null,
  swapTotalBytes: null,
  hostAvailableBytes: null,
  hostTotalBytes: null,
  load1: null,
  load5: null,
  load15: null,
  cores: 2,
};

let root: string;
let procRoot: string;
let runDir: string;

interface Harness {
  reader: LocalReader;
  sleeps: number[];
  /** Moves the clock and the fake /proc forward by one round. */
  advance(ms: number): void;
}

function harness(): Harness {
  let now = T0;
  let round = 0;
  const sleeps: number[] = [];
  const advance = (ms: number): void => {
    now += ms;
    round += 1;
    writeFakeProc(procRoot, processes(round));
  };
  const reader = new LocalReader({
    procRoot,
    cgroupRoot: join(root, "no-cgroup"),
    sharedMcpRunDir: runDir,
    daemonPid: 164,
    cores: 2,
    now: () => now,
    sleep: (ms) => {
      sleeps.push(ms);
      advance(ms);
      return Promise.resolve();
    },
  });
  return { reader, sleeps, advance };
}

function counting(agents: LiveAgent[]): { list: () => Promise<LiveAgent[]>; calls: () => number } {
  let calls = 0;
  return {
    list: () => {
      calls += 1;
      return Promise.resolve(agents);
    },
    calls: () => calls,
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-local-"));
  procRoot = join(root, "proc");
  runDir = join(root, "shared-mcp-run");
  mkdirSync(runDir);
  writeFakeProc(procRoot, processes(0), SPACE);
  const record: PidRecord = {
    pgid: 400,
    startTime: 4000,
    ownerPid: 164,
    ownerStartTime: 200,
    pidNamespace: SPACE.pidNamespace,
    bootId: SPACE.bootId,
    initStartTime: 10,
  };
  writeFileSync(join(runDir, "context7.pid"), `${JSON.stringify(record)}\n`);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("LocalReader", () => {
  it("totals RSS and CPU per live agent and per group over a 1 s baseline", async () => {
    const { reader, sleeps } = harness();

    const reading = await reader.read(() => Promise.resolve(AGENTS));

    expect(sleeps).toEqual([1000]);
    const agents: AgentUsage[] = [
      {
        agentId: "agent-a",
        title: "Fix login",
        provider: "claude",
        status: "idle",
        rssBytes: (307200 + 204800) * KIB,
        cpuPercent: 200,
        idleSince: "2026-11-06T08:50:00.000Z",
        processCount: 2,
      },
      {
        agentId: "agent-c",
        title: "Refactor",
        provider: "codex",
        status: "running",
        rssBytes: 409600 * KIB,
        cpuPercent: 0,
        idleSince: null,
        processCount: 1,
      },
    ];
    const groups: GroupUsage[] = [
      { kind: "daemon", rssBytes: (47316 + 286020 + 4096) * KIB, cpuPercent: 0, processCount: 3 },
      { kind: "sharedMcp", rssBytes: (102400 + 51200) * KIB, cpuPercent: 0, processCount: 2 },
      { kind: "heavyGate", rssBytes: (1048576 + 20480) * KIB, cpuPercent: 100, processCount: 2 },
      { kind: "other", rssBytes: (512 + 10240) * KIB, cpuPercent: 0, processCount: 3 },
    ];
    expect(reading).toEqual({
      readAt: "2026-11-06T09:00:01.000Z",
      host: NO_HOST,
      agents,
      groups,
      agentsError: null,
    });
  });

  it("reuses a reading within 1 s, measures over the poll gap, and re-baselines after 15 s", async () => {
    const { reader, sleeps, advance } = harness();
    const agents = counting(AGENTS);

    const first = await reader.read(agents.list);
    await expect(reader.read(agents.list)).resolves.toBe(first);
    expect(agents.calls()).toBe(1);

    advance(5_000);
    const second = await reader.read(agents.list);
    expect(sleeps).toEqual([1000]);
    // 200 ticks over 5 s.
    expect(second.agents[0].cpuPercent).toBe(40);

    advance(16_000);
    await reader.read(agents.list);
    expect(sleeps).toEqual([1000, 1000]);
    expect(agents.calls()).toBe(3);
  });

  it("shares one read between concurrent callers", async () => {
    const { reader } = harness();
    const agents = counting(AGENTS);

    const [a, b] = await Promise.all([reader.read(agents.list), reader.read(agents.list)]);

    expect(a).toBe(b);
    expect(agents.calls()).toBe(1);
  });

  it("reports a failed agent list and counts agent processes under 'other'", async () => {
    const { reader } = harness();

    const reading = await reader.read(() => Promise.reject(new Error("daemon unavailable")));

    expect(reading.agentsError).toBe("daemon unavailable");
    expect(reading.agents).toEqual([]);
    expect(reading.groups.find((group) => group.kind === "other")?.processCount).toBe(6);
    expect(reading.groups.find((group) => group.kind === "heavyGate")?.processCount).toBe(2);
  });
});
```

- [ ] **Step 6: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/local/local-reader.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './local-reader.js'`.

- [ ] **Step 7: Write the local reader**

Create `plugins/resource-manager/server/local/local-reader.ts`:

```ts
import {
  GroupKindSchema,
  type AgentUsage,
  type GroupKind,
  type GroupUsage,
  type LocalReading,
} from "../../shared/rpc.js";
import type { LiveAgent } from "../paseo-ports.js";
import { attribute } from "./attribution.js";
import { readHostSummary } from "./host-summary.js";
import { findSupervisorPid, readProcessTable, type ProcessInfo } from "./process-table.js";
import { readSharedMcpPids } from "./shared-mcp-groups.js";

// sysconf(_SC_CLK_TCK): /proc/<pid>/stat counts CPU time in these ticks, 100 on every mainstream
// Linux architecture.
export const USER_HZ = 100;
const REUSE_MS = 1_000;
const BASELINE_MAX_AGE_MS = 15_000;
const BASELINE_GAP_MS = 1_000;

export interface LocalReaderOptions {
  procRoot: string;
  cgroupRoot: string;
  sharedMcpRunDir: string;
  /** The daemon worker, which is the process this plugin runs in. */
  daemonPid: number;
  cores: number;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export type AgentLister = () => Promise<LiveAgent[]>;

interface Sample {
  at: number;
  table: ProcessInfo[];
  /** cpuTicks by "pid:startTime", so a reused pid starts from zero. */
  ticks: Map<string, number>;
}

interface SamplePair {
  current: Sample;
  base: Sample;
}

interface AgentsOutcome {
  agents: LiveAgent[];
  error: string | null;
}

interface Totals {
  rssBytes: number;
  cpuPercent: number | null;
  processCount: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function settleAgents(listAgents: AgentLister): Promise<AgentsOutcome> {
  try {
    return { agents: await listAgents(), error: null };
  } catch (error) {
    return { agents: [], error: errorMessage(error) };
  }
}

function processKey(info: ProcessInfo): string {
  return `${info.pid}:${info.startTime}`;
}

function totals(
  pids: readonly number[],
  pair: SamplePair,
  byPid: Map<number, ProcessInfo>,
): Totals {
  const seconds = (pair.current.at - pair.base.at) / 1000;
  let rssBytes = 0;
  let ticks = 0;
  for (const pid of pids) {
    const info = byPid.get(pid);
    if (info === undefined) continue;
    rssBytes += info.rssBytes;
    // A process that started after the base sample has no base entry: all its ticks fall inside
    // the window.
    ticks += Math.max(0, info.cpuTicks - (pair.base.ticks.get(processKey(info)) ?? 0));
  }
  const cpuPercent = seconds > 0 ? Math.round((ticks / USER_HZ / seconds) * 1000) / 10 : null;
  return { rssBytes, cpuPercent, processCount: pids.length };
}

function groupUsage(
  kind: GroupKind,
  pids: readonly number[],
  pair: SamplePair,
  byPid: Map<number, ProcessInfo>,
): GroupUsage {
  const total = totals(pids, pair, byPid);
  return {
    kind,
    rssBytes: total.rssBytes,
    cpuPercent: total.cpuPercent,
    processCount: total.processCount,
  };
}

export class LocalReader {
  private readonly options: LocalReaderOptions;
  private previous: Sample | null = null;
  private last: { at: number; reading: LocalReading } | null = null;
  private inFlight: Promise<LocalReading> | null = null;

  constructor(options: LocalReaderOptions) {
    this.options = options;
  }

  // Two screens polling every 5 s, or a refetch right after a Close, share a reading made less
  // than 1 s ago, and concurrent callers share one read.
  read(listAgents: AgentLister): Promise<LocalReading> {
    const { last } = this;
    if (last !== null && this.options.now() - last.at < REUSE_MS) {
      return Promise.resolve(last.reading);
    }
    if (this.inFlight === null) {
      this.inFlight = this.readFresh(listAgents).finally(() => {
        this.inFlight = null;
      });
    }
    return this.inFlight;
  }

  private async readFresh(listAgents: AgentLister): Promise<LocalReading> {
    // Started first and settled into a value, so a rejection while the baseline sleeps is never
    // unhandled.
    const agentsOutcome = settleAgents(listAgents);
    const pair = await this.samplePair();
    const outcome = await agentsOutcome;
    const reading = this.build(pair, outcome);
    this.last = { at: pair.current.at, reading };
    return reading;
  }

  // CPU % needs two samples. The previous reading's sample serves when it is under 15 s old;
  // otherwise this one takes a base, waits 1 s, and samples again.
  private async samplePair(): Promise<SamplePair> {
    let base = this.previous;
    if (base === null || this.options.now() - base.at > BASELINE_MAX_AGE_MS) {
      base = this.takeSample();
      await this.options.sleep(BASELINE_GAP_MS);
    }
    const current = this.takeSample();
    this.previous = current;
    return { current, base };
  }

  private takeSample(): Sample {
    const table = readProcessTable(this.options.procRoot);
    const ticks = new Map(table.map((info): [string, number] => [processKey(info), info.cpuTicks]));
    return { at: this.options.now(), table, ticks };
  }

  private build(pair: SamplePair, outcome: AgentsOutcome): LocalReading {
    const { options } = this;
    const table = pair.current.table;
    const byPid = new Map(table.map((info): [number, ProcessInfo] => [info.pid, info]));
    const attribution = attribute(table, {
      daemonPid: options.daemonPid,
      supervisorPid: findSupervisorPid(options.daemonPid, options.procRoot),
      sharedMcpPids: readSharedMcpPids(options.sharedMcpRunDir, options.procRoot),
      liveAgentIds: new Set(outcome.agents.map((agent) => agent.id)),
    });
    const agents: AgentUsage[] = [];
    for (const agent of outcome.agents) {
      const pids = attribution.agents.get(agent.id);
      if (pids === undefined) continue;
      const total = totals(pids, pair, byPid);
      agents.push({
        agentId: agent.id,
        title: agent.title,
        provider: agent.provider,
        status: agent.status,
        rssBytes: total.rssBytes,
        cpuPercent: total.cpuPercent,
        idleSince: agent.status === "idle" ? agent.updatedAt : null,
        processCount: total.processCount,
      });
    }
    agents.sort((a, b) => b.rssBytes - a.rssBytes || a.agentId.localeCompare(b.agentId));
    const groups = GroupKindSchema.options.map((kind) =>
      groupUsage(kind, attribution.groups.get(kind) ?? [], pair, byPid),
    );
    return {
      readAt: new Date(pair.current.at).toISOString(),
      host: readHostSummary({
        procRoot: options.procRoot,
        cgroupRoot: options.cgroupRoot,
        cores: options.cores,
      }),
      agents,
      groups,
      agentsError: outcome.error,
    };
  }
}
```

- [ ] **Step 8: Run the local reader tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/local/local-reader.test.ts --bail=1
```

Expected: PASS, 4 tests. In the failed-list test, "other" holds pids 1, 2, 300, 301, 500 and 700 (the heavy command and its child stay in their group).

- [ ] **Step 9: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/resource-manager/server/paseo-ports.ts plugins/resource-manager/server/fake-ports.ts plugins/resource-manager/server/paseo-ports.test.ts plugins/resource-manager/server/local/local-reader.ts plugins/resource-manager/server/local/local-reader.test.ts
cd /workspace/utils/paseo && npm run lint -- plugins/resource-manager
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: oxfmt exits 0; `Found 0 warnings and 0 errors.`; typecheck exit 0. The typecheck is the test of `paseoPorts`: it fails with `Property 'closeRuntime' is missing` if Task 2's `npm run build:client` did not run, and with an overload error if a port type drifts from the client's.

- [ ] **Step 10: Commit**

```bash
P="plugins/resource-manager/server/paseo-ports.ts plugins/resource-manager/server/fake-ports.ts plugins/resource-manager/server/paseo-ports.test.ts plugins/resource-manager/server/local/local-reader.ts plugins/resource-manager/server/local/local-reader.test.ts"
git -C /workspace/utils/paseo add $P
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): resource-manager local reader and Paseo ports" -- $P
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo status --short --untracked-files=all -- $P
```

Expected: the hook passes; `5 files changed`; the fork identity; `status` prints nothing.

---

### Task 7: ssh-mcp discovery from Claude configs

**Files:**

- Create: `plugins/resource-manager/server/remote/discovery.ts`
- Test: `plugins/resource-manager/server/remote/discovery.test.ts`

**Interfaces:**

- Consumes: `claudeConfigFile(env, home)` (Task 4) supplies `DiscoveryInput.claudeConfigFile` in Task 11; `listWorkspaceDirectories` (Task 6) supplies `workspaceDirectories`. Claude Code's config layout: user scope `mcpServers` and local scope `projects[<dir>].mcpServers` in `.claude.json`, project scope `mcpServers` in `<dir>/.mcp.json`; a stdio entry is `{ type?: "stdio", command, args?, env? }`, an HTTP or SSE entry has `url` and no `command`.
- Produces:
  - `interface SshServer { id: string; name: string; source: string; command: string; args: string[]; env: Record<string, string>; missingVariables: string[]; fingerprint: string }`
  - `interface Discovery { servers: SshServer[]; problems: string[] }`
  - `interface DiscoveryInput { claudeConfigFile: string; workspaceDirectories: readonly string[]; env: NodeJS.ProcessEnv }`
  - `runsSshMcp(command: string, args: readonly string[]): boolean`
  - `expandVariables(value: string, env: NodeJS.ProcessEnv, missing: Set<string>): string`
  - `serverId(sourceKey: string, name: string): string`
  - `discoverSshServers(input: DiscoveryInput): Promise<Discovery>` (never rejects; unreadable files become `problems`)

The real ssh-mcp entry, from the ssh-mcp README: `{ "command": "npx", "args": ["ssh-mcp", "-y", "--", "--host=1.2.3.4", "--port=22", "--user=root", "--password=pass", "--key=path/to/key"] }`. Arguments after `--` go to ssh-mcp itself, so matching stops at `--`: a key path such as `/home/u/.ssh/ssh-mcp/id` after it never makes an entry count.

- [ ] **Step 1: Write the failing discovery tests**

Create `plugins/resource-manager/server/remote/discovery.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discoverSshServers,
  expandVariables,
  runsSshMcp,
  serverId,
  type DiscoveryInput,
  type SshServer,
} from "./discovery.js";

interface Fixture {
  root: string;
  configFile: string;
  repo: string;
  worktree: string;
  broken: string;
  bare: string;
  unlisted: string;
}

let fixture: Fixture;

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

// One entry of each kind: ssh-mcp through npx and through a path, a look-alike package, an
// ordinary MCP server, an HTTP entry, and ssh-mcp in a directory Paseo does not list.
function writeFixture(root: string): Fixture {
  const repo = join(root, "repo");
  const worktree = join(root, "repo-worktree");
  const broken = join(root, "broken");
  const bare = join(root, "bare");
  const unlisted = join(root, "unlisted");
  for (const dir of [repo, worktree, broken, bare, unlisted]) mkdirSync(dir);
  const configFile = join(root, ".claude.json");
  writeJson(configFile, {
    numStartups: 12,
    mcpServers: {
      "prod-box": {
        type: "stdio",
        command: "npx",
        args: [
          "ssh-mcp",
          "-y",
          "--",
          "--host=${PROD_HOST}",
          "--user=ops",
          "--key=~/.ssh/ssh-mcp/id",
        ],
        env: {},
      },
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
      remote: { type: "http", url: "https://mcp.example.test/mcp" },
      lookalike: { command: "npx", args: ["-y", "@example/ssh-mcp-server"] },
    },
    projects: {
      [worktree]: {
        allowedTools: [],
        mcpServers: {
          "staging-box": {
            command: "/opt/ssh-mcp/bin/ssh-mcp",
            args: ["--host=${STAGING_HOST:-10.0.0.5}", "--user=${STAGING_USER}"],
          },
        },
      },
      [unlisted]: {
        mcpServers: { hidden: { command: "npx", args: ["-y", "ssh-mcp@1.0.7"] } },
      },
      [bare]: "not an object",
    },
  });
  writeJson(join(repo, ".mcp.json"), {
    mcpServers: {
      // Same command, args and env as prod-box: one server, listed under the user config.
      "prod-copy": {
        command: "npx",
        args: [
          "ssh-mcp",
          "-y",
          "--",
          "--host=${PROD_HOST}",
          "--user=ops",
          "--key=~/.ssh/ssh-mcp/id",
        ],
        env: {},
      },
      "db-box": {
        command: "node",
        args: ["/srv/tools/ssh-mcp/build/index.js", "--", "--host=db.internal"],
        env: { SSH_AUTH_SOCK: "/run/agent.sock" },
      },
    },
  });
  writeFileSync(join(broken, ".mcp.json"), '{ "mcpServers": { "x": { "command": "pass=hunter2" ');
  return { root, configFile, repo, worktree, broken, bare, unlisted };
}

function input(env: NodeJS.ProcessEnv): DiscoveryInput {
  return {
    claudeConfigFile: fixture.configFile,
    workspaceDirectories: [fixture.repo, fixture.worktree, fixture.broken, fixture.bare],
    env,
  };
}

function summary(servers: readonly SshServer[]) {
  return servers.map((server) => ({
    name: server.name,
    source: server.source,
    command: server.command,
    args: server.args,
    missingVariables: server.missingVariables,
  }));
}

beforeEach(() => {
  fixture = writeFixture(mkdtempSync(join(tmpdir(), "rm-discovery-")));
});

afterEach(() => {
  rmSync(fixture.root, { recursive: true, force: true });
});

describe("runsSshMcp", () => {
  it("matches the ssh-mcp package or a path segment named ssh-mcp before --", () => {
    const cases: [string, string[], boolean][] = [
      ["npx", ["ssh-mcp", "-y", "--", "--host=h"], true],
      ["npx", ["-y", "ssh-mcp@latest"], true],
      ["/usr/local/bin/ssh-mcp", [], true],
      ["node", ["/opt/ssh-mcp/build/index.js"], true],
      ["npx", ["-y", "@example/ssh-mcp-server"], false],
      ["npx", ["-y", "mcp-ssh"], false],
      ["npx", ["-y", "other", "--key=/home/u/ssh-mcp/id"], false],
      ["node", ["server.js", "--", "/srv/ssh-mcp"], false],
    ];
    expect(cases.map(([command, args]) => runsSshMcp(command, args))).toEqual(
      cases.map(([, , expected]) => expected),
    );
  });
});

describe("expandVariables", () => {
  it("expands set variables and defaults, and records unset ones without a default", () => {
    const missing = new Set<string>();
    const env: NodeJS.ProcessEnv = { HOST: "10.0.0.1", EMPTY: "" };

    expect(expandVariables("--host=${HOST}", env, missing)).toBe("--host=10.0.0.1");
    expect(expandVariables("${PORT:-22}", env, missing)).toBe("22");
    expect(expandVariables("${HOST:-x}", env, missing)).toBe("10.0.0.1");
    expect(expandVariables("[${EMPTY}]", env, missing)).toBe("[]");
    expect(expandVariables("--user=${USER_X}", env, missing)).toBe("--user=");
    expect(expandVariables("$HOST and ${not valid}", env, missing)).toBe("$HOST and ${not valid}");
    expect([...missing]).toEqual(["USER_X"]);
  });
});

describe("serverId", () => {
  it("is 16 hex characters, stable, and different per source and per name", () => {
    const id = serverId("user", "prod-box");

    expect(id).toMatch(/^[0-9a-f]{16}$/);
    expect(serverId("user", "prod-box")).toBe(id);
    expect(serverId("user", "prod-box2")).not.toBe(id);
    expect(serverId("project:/repo/.mcp.json", "prod-box")).not.toBe(id);
  });
});

describe("discoverSshServers", () => {
  it("finds ssh-mcp entries in user, local and project scope, once each", async () => {
    const discovery = await discoverSshServers(
      input({ PROD_HOST: "10.0.0.1", STAGING_USER: "deploy" }),
    );

    expect(summary(discovery.servers)).toEqual([
      {
        name: "prod-box",
        source: "User config",
        command: "npx",
        args: ["ssh-mcp", "-y", "--", "--host=10.0.0.1", "--user=ops", "--key=~/.ssh/ssh-mcp/id"],
        missingVariables: [],
      },
      {
        name: "db-box",
        source: `${fixture.repo}/.mcp.json`,
        command: "node",
        args: ["/srv/tools/ssh-mcp/build/index.js", "--", "--host=db.internal"],
        missingVariables: [],
      },
      {
        name: "staging-box",
        source: `Local config for ${fixture.worktree}`,
        command: "/opt/ssh-mcp/bin/ssh-mcp",
        args: ["--host=10.0.0.5", "--user=deploy"],
        missingVariables: [],
      },
    ]);
    expect(discovery.servers[0].id).toBe(serverId("user", "prod-box"));
    expect(discovery.servers[1].env).toEqual({ SSH_AUTH_SOCK: "/run/agent.sock" });
    expect(new Set(discovery.servers.map((server) => server.fingerprint)).size).toBe(3);
  });

  it("reports a broken file by path only, never with its content", async () => {
    const discovery = await discoverSshServers(input({ PROD_HOST: "10.0.0.1" }));

    expect(discovery.problems).toEqual([`${join(fixture.broken, ".mcp.json")}: not valid JSON`]);
    expect(discovery.problems.join("\n")).not.toContain("hunter2");
  });

  it("keeps a server whose variables are unset, and names them", async () => {
    const discovery = await discoverSshServers(input({}));

    expect(discovery.servers.map((server) => [server.name, server.missingVariables])).toEqual([
      ["prod-box", ["PROD_HOST"]],
      ["db-box", []],
      ["staging-box", ["STAGING_USER"]],
    ]);
  });

  it("changes the fingerprint when an expanded value changes, and keeps the id", async () => {
    const first = await discoverSshServers(input({ PROD_HOST: "10.0.0.1" }));
    const second = await discoverSshServers(input({ PROD_HOST: "10.0.0.2" }));

    expect(second.servers[0].id).toBe(first.servers[0].id);
    expect(second.servers[0].fingerprint).not.toBe(first.servers[0].fingerprint);
  });

  it("is silent about missing files and reports one that is not a Claude config", async () => {
    rmSync(fixture.configFile);
    const withoutConfig = await discoverSshServers(input({}));
    expect(withoutConfig.servers.map((server) => [server.name, server.source])).toEqual([
      ["prod-copy", `${fixture.repo}/.mcp.json`],
      ["db-box", `${fixture.repo}/.mcp.json`],
    ]);
    expect(withoutConfig.servers[1].id).toBe(
      serverId(`project:${join(fixture.repo, ".mcp.json")}`, "db-box"),
    );
    expect(withoutConfig.problems).toEqual([
      `${join(fixture.broken, ".mcp.json")}: not valid JSON`,
    ]);

    writeJson(fixture.configFile, { mcpServers: [] });
    const discovery = await discoverSshServers(input({}));
    expect(discovery.problems[0]).toBe(`${fixture.configFile}: not a Claude config`);
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/remote/discovery.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './discovery.js'`.

- [ ] **Step 3: Write discovery**

Create `plugins/resource-manager/server/remote/discovery.ts`:

```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";

// Finds every ssh-mcp entry in the Claude configs the daemon can read. A config holds passwords
// and keys in its args and env, so nothing here logs or returns a config's text: a file that does
// not parse is reported by path only, and the RPC layer returns id, name and source only.

export interface SshServer {
  /** sha256(source key NUL entry name), first 16 hex characters: stable and free of secrets. */
  id: string;
  name: string;
  /** "User config", "Local config for <dir>" or "<dir>/.mcp.json". */
  source: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Variables the entry names that the daemon's env does not set, with no default. */
  missingVariables: string[];
  /** sha256 of the expanded command, args and env. A change replaces the running session. */
  fingerprint: string;
}

export interface Discovery {
  servers: SshServer[];
  problems: string[];
}

export interface DiscoveryInput {
  claudeConfigFile: string;
  /** Each workspace's directory: its worktree, else its project root. */
  workspaceDirectories: readonly string[];
  env: NodeJS.ProcessEnv;
}

interface ConfigSource {
  key: string;
  label: string;
  servers: Record<string, unknown>;
}

// Entries are parsed one by one, so an HTTP entry or an odd one never hides the rest.
const ServerMapSchema = z.record(z.string(), z.unknown());

const StdioEntrySchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

// projects is read per workspace for the same reason.
const ClaudeConfigSchema = z.object({
  mcpServers: ServerMapSchema.optional(),
  projects: z.record(z.string(), z.unknown()).optional(),
});

const ProjectSchema = z.object({ mcpServers: ServerMapSchema.optional() });

const McpJsonSchema = z.object({ mcpServers: ServerMapSchema.optional() });

// Claude Code's syntax: ${VAR} and ${VAR:-default}.
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const SSH_MCP = "ssh-mcp";

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// undefined when the file is missing (silently) or unusable (reported). JSON is never undefined.
async function readJson(file: string, problems: string[]): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (!isMissing(error)) problems.push(`${file}: unreadable`);
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    // The parser's message quotes the text, which may hold a password.
    problems.push(`${file}: not valid JSON`);
    return undefined;
  }
}

function namesSshMcp(value: string): boolean {
  return value
    .split(/[\\/]/)
    .some((segment) => segment === SSH_MCP || segment.startsWith(`${SSH_MCP}@`));
}

// The command, or an argument before "--" that is not an option, is ssh-mcp's package or a path
// with a segment named ssh-mcp. Arguments after "--" are ssh-mcp's own (host, user, key path).
export function runsSshMcp(command: string, args: readonly string[]): boolean {
  if (namesSshMcp(command)) return true;
  for (const arg of args) {
    if (arg === "--") return false;
    if (!arg.startsWith("-") && namesSshMcp(arg)) return true;
  }
  return false;
}

export function expandVariables(
  value: string,
  env: NodeJS.ProcessEnv,
  missing: Set<string>,
): string {
  return value.replace(VARIABLE, (_match: string, name: string, fallback: string | undefined) => {
    const set = env[name];
    if (set !== undefined) return set;
    if (fallback !== undefined) return fallback;
    missing.add(name);
    return "";
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function serverId(sourceKey: string, name: string): string {
  return sha256(`${sourceKey}\0${name}`).slice(0, 16);
}

function fingerprintOf(command: string, args: readonly string[], env: Record<string, string>) {
  const entries = Object.entries(env).sort(([a], [b]) => (a < b ? -1 : 1));
  return sha256(JSON.stringify([command, args, entries]));
}

function toServer(
  source: ConfigSource,
  name: string,
  raw: unknown,
  env: NodeJS.ProcessEnv,
): SshServer | null {
  const entry = StdioEntrySchema.safeParse(raw);
  if (!entry.success) return null;
  const missing = new Set<string>();
  const command = expandVariables(entry.data.command, env, missing);
  const args = (entry.data.args ?? []).map((arg) => expandVariables(arg, env, missing));
  if (!runsSshMcp(command, args)) return null;
  const serverEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry.data.env ?? {})) {
    serverEnv[key] = expandVariables(value, env, missing);
  }
  return {
    id: serverId(source.key, name),
    name,
    source: source.label,
    command,
    args,
    env: serverEnv,
    missingVariables: [...missing].sort(),
    fingerprint: fingerprintOf(command, args, serverEnv),
  };
}

async function collectSources(input: DiscoveryInput, problems: string[]): Promise<ConfigSource[]> {
  const sources: ConfigSource[] = [];
  const json = await readJson(input.claudeConfigFile, problems);
  let claude: z.output<typeof ClaudeConfigSchema> | null = null;
  if (json !== undefined) {
    const parsed = ClaudeConfigSchema.safeParse(json);
    if (parsed.success) claude = parsed.data;
    else problems.push(`${input.claudeConfigFile}: not a Claude config`);
  }
  if (claude?.mcpServers !== undefined) {
    sources.push({ key: "user", label: "User config", servers: claude.mcpServers });
  }
  for (const dir of input.workspaceDirectories) {
    const project = ProjectSchema.safeParse(claude?.projects?.[dir]);
    if (project.success && project.data.mcpServers !== undefined) {
      sources.push({
        key: `local:${dir}`,
        label: `Local config for ${dir}`,
        servers: project.data.mcpServers,
      });
    }
    const file = join(dir, ".mcp.json");
    const mcpJson = await readJson(file, problems);
    if (mcpJson === undefined) continue;
    const parsed = McpJsonSchema.safeParse(mcpJson);
    if (!parsed.success) problems.push(`${file}: not an MCP config`);
    else if (parsed.data.mcpServers !== undefined) {
      sources.push({ key: `project:${file}`, label: file, servers: parsed.data.mcpServers });
    }
  }
  return sources;
}

// User scope first, then each workspace's local and project scope in the order Paseo lists them.
// Entries with the same expanded command, args and env are one server, under its first source.
export async function discoverSshServers(input: DiscoveryInput): Promise<Discovery> {
  const problems: string[] = [];
  const servers: SshServer[] = [];
  const seen = new Set<string>();
  for (const source of await collectSources(input, problems)) {
    for (const [name, raw] of Object.entries(source.servers)) {
      const server = toServer(source, name, raw, input.env);
      if (server === null || seen.has(server.fingerprint)) continue;
      seen.add(server.fingerprint);
      servers.push(server);
    }
  }
  return { servers, problems };
}
```

The order in the first discovery test follows from this: the user config's `prod-box`; then the repo's local scope (none) and its `.mcp.json` (`prod-copy` is a duplicate, `db-box` is new); then the worktree's local scope (`staging-box`). The `bare` project, whose value is a string, fails `ProjectSchema` and is skipped without a problem, like a workspace with no local scope.

- [ ] **Step 4: Run the discovery tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/remote/discovery.test.ts --bail=1
```

Expected: PASS, 8 tests.

- [ ] **Step 5: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/resource-manager/server/remote/discovery.ts plugins/resource-manager/server/remote/discovery.test.ts
cd /workspace/utils/paseo && npm run lint -- plugins/resource-manager
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: oxfmt exits 0; `Found 0 warnings and 0 errors.`; typecheck exit 0. Re-run Step 4 if oxfmt changed a file.

- [ ] **Step 6: Commit**

```bash
P="plugins/resource-manager/server/remote/discovery.ts plugins/resource-manager/server/remote/discovery.test.ts"
git -C /workspace/utils/paseo add $P
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): resource-manager ssh-mcp discovery" -- $P
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo status --short --untracked-files=all -- $P
```

Expected: the hook passes; `2 files changed`; the fork identity; `status` prints nothing.

---

### Task 8: The remote command and its output parsers

**Files:**

- Create: `plugins/resource-manager/server/remote/remote-output.ts`
- Create: `plugins/resource-manager/server/remote/remote-output-sample.ts` (real output and its snapshot, typechecked, for tests in Tasks 8, 10 and 11)
- Test: `plugins/resource-manager/server/remote/remote-output.test.ts`

**Interfaces:**

- Consumes: `parseMeminfo`, `parseLoadavg`, `ProcTextError` (Task 3); `RemoteSnapshot`, `MountUsage`, `RemoteProcess` (Task 1).
- Produces:
  - `REMOTE_COMMAND: string` (decision 14)
  - `class RemoteOutputError extends Error` (`constructor(message: string, options?: ErrorOptions)`, name `"RemoteOutputError"`)
  - `interface CommandOutput { stdout: string[]; stderr: string[]; exitCode: number | null; signal: string | null }`, `splitTrailers(text: string): CommandOutput` (1.x returns stdout alone; 2.x's `run-command` joins stdout, a `[stderr]` block when there is stderr, and on failure only `[exit N]` or `[killed by SIG<NAME>]`, with a blank line between the parts: `commandOutput` in ssh-mcp 2.23.1 `build/tools/results.js`, which also sets `isError: true` only on failure)
  - `toolErrorMessage(text: string): string` (the message for a tool result marked `isError`: a failed 2.x run reads as its exit code or signal and its stderr; any other text is ssh-mcp's own message, trimmed)
  - `parseNproc(lines: readonly string[]): number`, `parseDf(lines: readonly string[]): MountUsage[]`, `parsePs(lines: readonly string[]): RemoteProcess[]` (top 10 by RSS, ties by pid)
  - `parseRemoteOutput(text: string): RemoteSnapshot` (throws `RemoteOutputError` only)
  - `REMOTE_OUTPUT_SAMPLE: string`, `REMOTE_SNAPSHOT_SAMPLE: RemoteSnapshot`

The sample is this container's real output on 2026-11-06: the `/proc/meminfo` lines up to `SwapFree`, `/proc/loadavg`, `nproc`, `df -P` and the first 13 rows of `ps -eo pid,rss,comm`. `ps` truncates `comm` to 15 characters, so the supervisor reads `Paseo Superviso`.

- [ ] **Step 1: Write the sample and its snapshot**

Create `plugins/resource-manager/server/remote/remote-output-sample.ts`:

```ts
import type { RemoteSnapshot } from "../../shared/rpc.js";

// REMOTE_COMMAND's output in this container on 2026-11-06, and what parseRemoteOutput makes of
// it. Tests in remote-output, sessions and plugin use both.

export const REMOTE_OUTPUT_SAMPLE = [
  "@@meminfo",
  "MemTotal:       16042308 kB",
  "MemFree:         4620488 kB",
  "MemAvailable:    7923328 kB",
  "Buffers:          294040 kB",
  "Cached:          2471480 kB",
  "SwapCached:       105872 kB",
  "Active:          5882624 kB",
  "Inactive:        3667360 kB",
  "Active(anon):    5131668 kB",
  "Inactive(anon):  1764376 kB",
  "Active(file):     750956 kB",
  "Inactive(file):  1902984 kB",
  "Unevictable:       24380 kB",
  "Mlocked:           24380 kB",
  "SwapTotal:      12582908 kB",
  "SwapFree:        6615380 kB",
  "@@loadavg",
  "3.08 2.50 2.53 3/9979 222437",
  "@@nproc",
  "2",
  "@@df",
  "Filesystem     1024-blocks      Used Available Capacity Mounted on",
  "overlay          151263856 107824412  43423060      72% /",
  "tmpfs                65536         0     65536       0% /dev",
  "shm                  65536         0     65536       0% /dev/shm",
  "/dev/root        151263856 107824412  43423060      72% /workspace",
  "tmpfs                    4         0         4       0% /proc/acpi",
  "@@ps",
  "    PID   RSS COMMAND",
  "      1   512 tini",
  "      6 47084 Paseo Superviso",
  "    164 285872 Paseo Daemon",
  "    176 59804 node",
  "    197  7116 esbuild",
  "    945  1288 sh",
  "    958  2624 bash",
  "   2856  1776 uv",
  "   2858 26288 graphify-mcp",
  "   2860 38016 python",
  "   2887 100312 python",
  "   3032 13832 terraform-ls",
  "   3035  1584 uv",
  "",
].join("\n");

const KIB = 1024;

export const REMOTE_SNAPSHOT_SAMPLE: RemoteSnapshot = {
  memTotalBytes: 16042308 * KIB,
  memAvailableBytes: 7923328 * KIB,
  swapTotalBytes: 12582908 * KIB,
  swapFreeBytes: 6615380 * KIB,
  load1: 3.08,
  load5: 2.5,
  load15: 2.53,
  cores: 2,
  mounts: [
    {
      mount: "/",
      totalBytes: 151263856 * KIB,
      usedBytes: 107824412 * KIB,
      availableBytes: 43423060 * KIB,
    },
    {
      mount: "/workspace",
      totalBytes: 151263856 * KIB,
      usedBytes: 107824412 * KIB,
      availableBytes: 43423060 * KIB,
    },
  ],
  processes: [
    { pid: 164, rssBytes: 285872 * KIB, command: "Paseo Daemon" },
    { pid: 2887, rssBytes: 100312 * KIB, command: "python" },
    { pid: 176, rssBytes: 59804 * KIB, command: "node" },
    { pid: 6, rssBytes: 47084 * KIB, command: "Paseo Superviso" },
    { pid: 2860, rssBytes: 38016 * KIB, command: "python" },
    { pid: 2858, rssBytes: 26288 * KIB, command: "graphify-mcp" },
    { pid: 3032, rssBytes: 13832 * KIB, command: "terraform-ls" },
    { pid: 197, rssBytes: 7116 * KIB, command: "esbuild" },
    { pid: 958, rssBytes: 2624 * KIB, command: "bash" },
    { pid: 2856, rssBytes: 1776 * KIB, command: "uv" },
  ],
};
```

- [ ] **Step 2: Write the failing parser tests**

Create `plugins/resource-manager/server/remote/remote-output.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ProcTextError } from "../proc-text.js";
import {
  parseDf,
  parseNproc,
  parsePs,
  parseRemoteOutput,
  REMOTE_COMMAND,
  RemoteOutputError,
  splitTrailers,
  toolErrorMessage,
} from "./remote-output.js";
import { REMOTE_OUTPUT_SAMPLE, REMOTE_SNAPSHOT_SAMPLE } from "./remote-output-sample.js";

// ssh-mcp 2.x's layout for a run that failed: stdout, then "[stderr]" and its lines, then the
// exit marker, the parts joined by a blank line.
const FAILED_RUN =
  "@@meminfo\n\n\n[stderr]\ncat: /proc/meminfo: No such file or directory\n\n\n[exit 1]";

function caught(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return null;
}

describe("REMOTE_COMMAND", () => {
  it("is the fixed read-only chain from the plan", () => {
    expect(REMOTE_COMMAND).toBe(
      "echo @@meminfo && cat /proc/meminfo && echo @@loadavg && cat /proc/loadavg && " +
        "echo @@nproc && nproc && echo @@df && df -P && echo @@ps && ps -eo pid,rss,comm",
    );
  });

  it("has no redirection, pipe, separator, variable or substitution", () => {
    expect(REMOTE_COMMAND).not.toMatch(/[\n;|<>$`]/);
    expect(REMOTE_COMMAND.replaceAll("&&", "")).not.toContain("&");
  });
});

describe("parseRemoteOutput", () => {
  it("parses the real sample", () => {
    expect(parseRemoteOutput(REMOTE_OUTPUT_SAMPLE)).toEqual(REMOTE_SNAPSHOT_SAMPLE);
  });

  it("ignores a login banner, CRLF line ends and a clean 2.x run's stderr block", () => {
    const stdout = `Welcome to db-1\r\n${REMOTE_OUTPUT_SAMPLE.replaceAll("\n", "\r\n")}`;
    const text = `${stdout}\n\n[stderr]\nwarning: setlocale: LC_ALL: cannot change locale\n`;

    expect(parseRemoteOutput(text)).toEqual(REMOTE_SNAPSHOT_SAMPLE);
  });

  it("reports a failed command with its stderr", () => {
    const error = caught(() => parseRemoteOutput(FAILED_RUN));

    expect(error).toBeInstanceOf(RemoteOutputError);
    expect(error).toHaveProperty(
      "message",
      "The command exited with code 1: cat: /proc/meminfo: No such file or directory",
    );
  });

  it("names a missing section", () => {
    const text = REMOTE_OUTPUT_SAMPLE.slice(0, REMOTE_OUTPUT_SAMPLE.indexOf("@@ps"));

    expect(() => parseRemoteOutput(text)).toThrow(
      new RemoteOutputError("The output has no ps section"),
    );
  });

  it("wraps a meminfo error with its cause", () => {
    const text = REMOTE_OUTPUT_SAMPLE.replace("MemTotal:       16042308 kB\n", "");

    const error = caught(() => parseRemoteOutput(text));

    expect(error).toBeInstanceOf(RemoteOutputError);
    expect(error).toHaveProperty("message", "meminfo has no MemTotal line");
    expect(error).toHaveProperty("cause", expect.any(ProcTextError));
  });
});

describe("splitTrailers", () => {
  it("returns stdout alone for ssh-mcp 1.x output", () => {
    expect(splitTrailers("a\nb\n")).toEqual({
      stdout: ["a", "b", ""],
      stderr: [],
      exitCode: null,
      signal: null,
    });
  });

  it("splits a failed ssh-mcp 2.x run into stdout, stderr and the exit code", () => {
    expect(splitTrailers("a\n\n\n[stderr]\nwarn\n\n\n[exit 2]")).toEqual({
      stdout: ["a", "", ""],
      stderr: ["warn", "", ""],
      exitCode: 2,
      signal: null,
    });
  });
});

describe("toolErrorMessage", () => {
  it("shows a failed 2.x run's exit code and stderr, not the readings before it", () => {
    const readings = REMOTE_OUTPUT_SAMPLE.slice(0, REMOTE_OUTPUT_SAMPLE.indexOf("@@ps") + 5);
    const text = `${readings}\n\n[stderr]\nsh: 1: ps: not found\n\n\n[exit 127]`;

    expect(toolErrorMessage(text)).toBe("The command exited with code 127: sh: 1: ps: not found");
  });

  it("names the signal of a command ssh-mcp 2.x killed", () => {
    expect(toolErrorMessage("@@meminfo\n\n[killed by SIGKILL]")).toBe(
      "The command was killed by SIGKILL: no message",
    );
  });

  it("passes ssh-mcp's own message through, trimmed", () => {
    const refused = "Error (code 255): ssh: connect to host db-1 port 22: Connection refused";

    expect(toolErrorMessage(`\n${refused}\n`)).toBe(refused);
    expect(toolErrorMessage("  ")).toBe("ssh-mcp reported an error without a message");
  });
});

describe("parseNproc", () => {
  it("reads a positive count and rejects anything else", () => {
    expect(parseNproc(["", "8"])).toBe(8);
    expect(() => parseNproc(["nproc: not found"])).toThrow(
      new RemoteOutputError("Unrecognised nproc output: nproc: not found"),
    );
    expect(() => parseNproc(["0"])).toThrow(RemoteOutputError);
  });
});

describe("parseDf", () => {
  it("scales by the header's block size, keeps spaces in mount points, skips tmpfs", () => {
    expect(
      parseDf([
        "Filesystem 512-blocks Used Available Capacity Mounted on",
        "/dev/sdb1 2000 500 1500 25% /mnt/My Disk",
        "tmpfs 100 0 100 0% /run",
        "none 0 0 0 - /sys/fs/bpf",
      ]),
    ).toEqual([
      {
        mount: "/mnt/My Disk",
        totalBytes: 2000 * 512,
        usedBytes: 500 * 512,
        availableBytes: 1500 * 512,
      },
    ]);
  });

  it("rejects an unrecognised header", () => {
    expect(() => parseDf(["Filesystem Size Used Avail Use% Mounted on"])).toThrow(
      new RemoteOutputError("Unrecognised df header: Filesystem Size Used Avail Use% Mounted on"),
    );
  });
});

describe("parsePs", () => {
  it("keeps the 10 largest by RSS, ties by pid, and skips rows it cannot read", () => {
    const rows = Array.from({ length: 12 }, (_, index) => `${100 + index} 2048 worker`);
    const processes = parsePs(["  PID   RSS COMMAND", ...rows, "  x y z", "  7  4096 big one"]);

    expect(processes).toHaveLength(10);
    expect(processes[0]).toEqual({ pid: 7, rssBytes: 4096 * 1024, command: "big one" });
    expect(processes.slice(1).map((entry) => entry.pid)).toEqual([
      100, 101, 102, 103, 104, 105, 106, 107, 108,
    ]);
  });

  it("rejects output without the ps header", () => {
    expect(() => parsePs(["ps: unknown option -- o"])).toThrow(RemoteOutputError);
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/remote/remote-output.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './remote-output.js'`.

- [ ] **Step 4: Write the command and the parsers**

Create `plugins/resource-manager/server/remote/remote-output.ts`:

```ts
import type { MountUsage, RemoteProcess, RemoteSnapshot } from "../../shared/rpc.js";
import { parseLoadavg, parseMeminfo, ProcTextError } from "../proc-text.js";

// The only command the plugin ever sends. It takes no input, writes nothing, and has no
// redirection, pipe, separator or substitution, so ssh-mcp 2.x's policy sees reads only. "&&"
// stops at the first failure, so a host without /proc answers with that error at once.
export const REMOTE_COMMAND =
  "echo @@meminfo && cat /proc/meminfo && echo @@loadavg && cat /proc/loadavg && " +
  "echo @@nproc && nproc && echo @@df && df -P && echo @@ps && ps -eo pid,rss,comm";

export class RemoteOutputError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "RemoteOutputError";
  }
}

export interface CommandOutput {
  stdout: string[];
  stderr: string[];
  /** null without an "[exit N]" line: always for 1.x, and for a 2.x run that succeeded. */
  exitCode: number | null;
  /** The signal from 2.x's "[killed by SIG<NAME>]" line, else null. */
  signal: string | null;
}

const TOP_PROCESSES = 10;
const KIB = 1024;
const SECTION_LINE = /^@@([a-z]+)$/;
const EXIT_LINE = /^\[exit (-?\d+)\]$/;
const KILLED_LINE = /^\[killed by (SIG[A-Z0-9]+)\]$/;
const STDERR_LINE = "[stderr]";
const BLOCKS_HEADER = /^(\d+)-blocks$/;
const PS_HEADER = /^PID\s+RSS\s+\S+$/;
const PSEUDO_FILESYSTEMS = new Set(["tmpfs", "devtmpfs", "shm", "udev", "none", "efivarfs"]);
const MESSAGE_CHARS = 300;

function nonEmpty(line: string): boolean {
  return line.trim() !== "";
}

// ssh-mcp 2.x's run-command joins stdout, "[stderr]" and its lines when there are any, and on
// failure only "[exit N]" or "[killed by SIG<NAME>]", with a blank line between the parts
// (commandOutput in ssh-mcp 2.23.1 build/tools/results.js). Markers match whole lines only.
export function splitTrailers(text: string): CommandOutput {
  const stdout: string[] = [];
  const stderr: string[] = [];
  let target = stdout;
  let exitCode: number | null = null;
  let signal: string | null = null;
  for (const line of text.split(/\r?\n/)) {
    const exit = EXIT_LINE.exec(line);
    const killed = KILLED_LINE.exec(line);
    if (exit) exitCode = Number(exit[1]);
    if (killed) signal = killed[1];
    if (exit || killed) break;
    if (line === STDERR_LINE) target = stderr;
    else target.push(line);
  }
  return { stdout, stderr, exitCode, signal };
}

// Lines before the first marker, such as a login banner, belong to no section.
function splitSections(lines: readonly string[]): Map<string, string[]> {
  const sections = new Map<string, string[]>();
  let current: string[] | null = null;
  for (const line of lines) {
    const marker = SECTION_LINE.exec(line.trim());
    if (marker) {
      current = [];
      sections.set(marker[1], current);
    } else current?.push(line);
  }
  return sections;
}

function section(sections: Map<string, string[]>, name: string): string[] {
  const lines = sections.get(name);
  if (lines === undefined) throw new RemoteOutputError(`The output has no ${name} section`);
  return lines;
}

export function parseNproc(lines: readonly string[]): number {
  const text = lines.filter(nonEmpty).join(" ").trim();
  const cores = Number(text);
  if (!Number.isSafeInteger(cores) || cores < 1) {
    throw new RemoteOutputError(`Unrecognised nproc output: ${text.slice(0, 80)}`);
  }
  return cores;
}

// df -P keeps one filesystem per line. The header's "<N>-blocks" gives the unit; the mount point
// is everything after the capacity, spaces included.
export function parseDf(lines: readonly string[]): MountUsage[] {
  const [header = "", ...rows] = lines.filter(nonEmpty);
  const blocks = BLOCKS_HEADER.exec(header.trim().split(/\s+/)[1] ?? "");
  if (blocks === null) {
    throw new RemoteOutputError(`Unrecognised df header: ${header.trim().slice(0, 80)}`);
  }
  const blockBytes = Number(blocks[1]);
  const mounts: MountUsage[] = [];
  for (const row of rows) {
    const fields = row.trim().split(/\s+/);
    const [filesystem, total, used, available] = fields;
    const totalBlocks = Number(total);
    if (fields.length < 6 || PSEUDO_FILESYSTEMS.has(filesystem)) continue;
    if (!Number.isFinite(totalBlocks) || totalBlocks <= 0) continue;
    mounts.push({
      mount: fields.slice(5).join(" "),
      totalBytes: totalBlocks * blockBytes,
      usedBytes: Number(used) * blockBytes,
      availableBytes: Number(available) * blockBytes,
    });
  }
  return mounts;
}

export function parsePs(lines: readonly string[]): RemoteProcess[] {
  const [header = "", ...rows] = lines.filter(nonEmpty);
  if (!PS_HEADER.test(header.trim())) {
    throw new RemoteOutputError(`Unrecognised ps header: ${header.trim().slice(0, 80)}`);
  }
  const processes: RemoteProcess[] = [];
  for (const row of rows) {
    const fields = row.trim().split(/\s+/);
    const pid = Number(fields[0]);
    const rssKb = Number(fields[1]);
    if (fields.length < 3 || !Number.isSafeInteger(pid) || !Number.isSafeInteger(rssKb)) continue;
    processes.push({ pid, rssBytes: rssKb * KIB, command: fields.slice(2).join(" ") });
  }
  processes.sort((a, b) => b.rssBytes - a.rssBytes || a.pid - b.pid);
  return processes.slice(0, TOP_PROCESSES);
}

function failureMessage(output: CommandOutput): string {
  const message = output.stderr.filter(nonEmpty).join("; ").slice(0, MESSAGE_CHARS) || "no message";
  if (output.signal !== null) return `The command was killed by ${output.signal}: ${message}`;
  return `The command exited with code ${output.exitCode}: ${message}`;
}

// ssh-mcp 2.x marks a failed run isError and sends its stdout too; show what failed, not the
// readings before it. Anything else (1.x's "Error (code N): ...", a connection or policy
// refusal) is ssh-mcp's own message.
export function toolErrorMessage(text: string): string {
  const output = splitTrailers(text);
  if (output.exitCode !== null || output.signal !== null) return failureMessage(output);
  return text.trim() || "ssh-mcp reported an error without a message";
}

export function parseRemoteOutput(text: string): RemoteSnapshot {
  const output = splitTrailers(text);
  if (output.exitCode !== null && output.exitCode !== 0) {
    throw new RemoteOutputError(failureMessage(output));
  }
  const sections = splitSections(output.stdout);
  try {
    const meminfo = parseMeminfo(section(sections, "meminfo").join("\n"));
    const load = parseLoadavg(section(sections, "loadavg").join("\n"));
    return {
      memTotalBytes: meminfo.totalBytes,
      memAvailableBytes: meminfo.availableBytes,
      swapTotalBytes: meminfo.swapTotalBytes,
      swapFreeBytes: meminfo.swapFreeBytes,
      load1: load.load1,
      load5: load.load5,
      load15: load.load15,
      cores: parseNproc(section(sections, "nproc")),
      mounts: parseDf(section(sections, "df")),
      processes: parsePs(section(sections, "ps")),
    };
  } catch (error) {
    if (error instanceof ProcTextError) {
      throw new RemoteOutputError(error.message, { cause: error });
    }
    throw error;
  }
}
```

- [ ] **Step 5: Run the parser tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/remote/remote-output.test.ts --bail=1
```

Expected: PASS, 17 tests.

- [ ] **Step 6: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/resource-manager/server/remote/remote-output.ts plugins/resource-manager/server/remote/remote-output-sample.ts plugins/resource-manager/server/remote/remote-output.test.ts
cd /workspace/utils/paseo && npm run lint -- plugins/resource-manager
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: oxfmt exits 0; `Found 0 warnings and 0 errors.`; typecheck exit 0. Re-run Step 5 if oxfmt changed a file.

- [ ] **Step 7: Commit**

```bash
P="plugins/resource-manager/server/remote/remote-output.ts plugins/resource-manager/server/remote/remote-output-sample.ts plugins/resource-manager/server/remote/remote-output.test.ts"
git -C /workspace/utils/paseo add $P
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): resource-manager remote command and output parsers" -- $P
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo status --short --untracked-files=all -- $P
```

Expected: the hook passes; `3 files changed`; the fork identity; `status` prints nothing.

---

### Task 9: MCP stdio client and the fake ssh-mcp

**Files:**

- Create: `plugins/resource-manager/server/remote/mcp-stdio-client.ts`
- Create: `plugins/resource-manager/test/fake-ssh-mcp.mjs` (test double and manual-test stand-in, never imported by the plugin; `test/` as for `plugins/muse-provider/test/fake-muse.mjs`)
- Test: `plugins/resource-manager/server/remote/mcp-stdio-client.posix.test.ts`

**Interfaces:**

- Consumes: `writePidFile(file, pgid, procRoot)`, `removePidFile(file)`, `killGroup(pgid, graceMs = 2_000)` (Task 4); `REMOTE_OUTPUT_SAMPLE` (Task 8, test only). MCP over stdio: one JSON-RPC 2.0 message per line; `initialize` with `protocolVersion`, `capabilities`, `clientInfo`, then the `notifications/initialized` notification; `tools/list` (paged by `nextCursor`); `tools/call { name, arguments }` returning `{ content: [{ type: "text", text }], isError? }`; a server may send `ping`, which the client answers with `{}`.
- Produces:
  - `MCP_PROTOCOL_VERSION = "2025-06-18"`
  - `interface McpServerCommand { command: string; args: readonly string[]; env: Record<string, string> }`
  - `interface McpStdioOptions { runDir: string; name: string; procRoot: string; baseEnv: NodeJS.ProcessEnv; startTimeoutMs: number; requestTimeoutMs: number }`
  - `interface ToolCallResult { isError: boolean; text: string }`
  - `class McpSessionError extends Error` (name `"McpSessionError"`): the session is unusable or a request timed out
  - `class JsonRpcError extends Error { readonly code: number }`
  - `serverEnv(overrides: Record<string, string>, base: NodeJS.ProcessEnv): NodeJS.ProcessEnv`
  - `readLines(stream: Readable | null, onLine: (line: string) => void): void` (exported for its test: a stream error, which readline re-emits on its interface, never escapes)
  - `class McpStdioClient { readonly pid: number | null; get closed(): boolean; initialize(timeoutMs: number): Promise<void>; listTools(): Promise<string[]>; callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>; close(): Promise<void> }` (`close` never rejects and is idempotent)
  - `startMcpStdioClient(command: McpServerCommand, options: McpStdioOptions, signal?: AbortSignal): Promise<McpStdioClient>` (rejects with `McpSessionError` only; on rejection nothing is left running and no pid file is left)
- Produces (`fake-ssh-mcp.mjs`), driven by env: `FAKE_SSH_MCP_TOOL` (comma-separated tool names, default `exec`), `FAKE_SSH_MCP_STDERR` (a `run-command` call adds it as ssh-mcp 2.x does for a clean run with stderr: stdout, a blank line, `[stderr]` and the text; 2.x adds no exit marker on success), `FAKE_SSH_MCP_OUTPUT_FILE`, `FAKE_SSH_MCP_FAIL` (tool result with `isError`), `FAKE_SSH_MCP_RPC_ERROR` (JSON-RPC error), `FAKE_SSH_MCP_EXIT_ON_START` (exit code), `FAKE_SSH_MCP_HANG` (a method it never answers), `FAKE_SSH_MCP_CALL_LOG`, `FAKE_SSH_MCP_CHILD_PID_FILE` (starts `sleep 300` in its group), `FAKE_SSH_MCP_NOISE` (non-JSON stdout, a notification, a `ping` and a `sampling/createMessage` request before answering `initialize`), `FAKE_SSH_MCP_ENV_LOG`. It prints ssh-mcp 1.x's banner `SSH MCP Server running on stdio` on stderr.

- [ ] **Step 1: Write the fake ssh-mcp**

Create `plugins/resource-manager/test/fake-ssh-mcp.mjs`:

```js
// A stand-in for ssh-mcp: MCP JSON-RPC over stdio with one or more tools that return canned
// output. The resource-manager tests and its manual test run it; the plugin never imports it.
// FAKE_SSH_MCP_* variables pick the behaviour (see Task 9 of the resource-manager plan).
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const env = process.env;
const toolNames = (env.FAKE_SSH_MCP_TOOL ?? "exec").split(",").filter((name) => name !== "");

function log(entry) {
  if (env.FAKE_SSH_MCP_CALL_LOG)
    appendFileSync(env.FAKE_SSH_MCP_CALL_LOG, `${JSON.stringify(entry)}\n`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

if (env.FAKE_SSH_MCP_ENV_LOG) {
  const names = Object.keys(env);
  const seen = {
    paseo: names.filter((name) => name.startsWith("PASEO_")).length,
    claudecode: env.CLAUDECODE ?? null,
    own: env.FAKE_SSH_MCP_OWN ?? null,
  };
  writeFileSync(env.FAKE_SSH_MCP_ENV_LOG, JSON.stringify(seen));
}

process.stderr.write("SSH MCP Server running on stdio\n");

if (env.FAKE_SSH_MCP_EXIT_ON_START) {
  process.stderr.write("fatal: could not connect to 10.0.0.9\n");
  process.exit(Number(env.FAKE_SSH_MCP_EXIT_ON_START));
}

if (env.FAKE_SSH_MCP_CHILD_PID_FILE) {
  // Stays in this process group, like the ssh client ssh-mcp starts.
  const child = spawn("sleep", ["300"], { stdio: "ignore" });
  writeFileSync(env.FAKE_SSH_MCP_CHILD_PID_FILE, String(child.pid));
}

const tools = toolNames.map((name) => ({
  name,
  description: "Run a shell command on the remote host",
  inputSchema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
}));

// ssh-mcp 2.x (build/tools/results.js commandOutput) joins stdout and "[stderr]\n<stderr>" with a
// blank line and adds "[exit N]" only on failure, so a clean run ends with stdout or its stderr.
function output(toolName) {
  const text = env.FAKE_SSH_MCP_OUTPUT_FILE
    ? readFileSync(env.FAKE_SSH_MCP_OUTPUT_FILE, "utf8")
    : "no output configured\n";
  if (toolName !== "run-command" || !env.FAKE_SSH_MCP_STDERR) return text;
  return `${text}\n\n[stderr]\n${env.FAKE_SSH_MCP_STDERR}\n`;
}

function callTool(id, params) {
  log({ name: params.name, arguments: params.arguments });
  if (!toolNames.includes(params.name)) {
    send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${params.name}` } });
  } else if (env.FAKE_SSH_MCP_RPC_ERROR) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: env.FAKE_SSH_MCP_RPC_ERROR } });
  } else if (env.FAKE_SSH_MCP_FAIL) {
    send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: env.FAKE_SSH_MCP_FAIL }], isError: true },
    });
  } else {
    send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: output(params.name) }] },
    });
  }
}

function initialize(id, params) {
  if (env.FAKE_SSH_MCP_NOISE === "1") {
    process.stdout.write("not json: starting up\n");
    send({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "info", data: "hi" },
    });
    send({ jsonrpc: "2.0", id: "srv-ping", method: "ping" });
    send({ jsonrpc: "2.0", id: "srv-sampling", method: "sampling/createMessage", params: {} });
  }
  send({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "fake-ssh-mcp", version: "0.0.0" },
    },
  });
}

// Answers to this server's own requests are logged, so a test can see what the client sent.
function handleResponse(message) {
  if (message.id === "srv-ping") log({ pong: message.result !== undefined });
  if (message.id === "srv-sampling") log({ refused: message.error?.code ?? null });
}

function handle(message) {
  if (message.method === undefined) {
    handleResponse(message);
    return;
  }
  if (message.id === undefined || env.FAKE_SSH_MCP_HANG === message.method) return;
  if (message.method === "initialize") initialize(message.id, message.params);
  else if (message.method === "tools/list")
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
  else if (message.method === "tools/call") callTool(message.id, message.params);
  else
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => handle(JSON.parse(line)));
lines.on("close", () => process.exit(0));
```

- [ ] **Step 2: Write the failing client tests**

Create `plugins/resource-manager/server/remote/mcp-stdio-client.posix.test.ts`:

```ts
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  McpSessionError,
  readLines,
  serverEnv,
  startMcpStdioClient,
  type McpServerCommand,
  type McpStdioClient,
  type McpStdioOptions,
} from "./mcp-stdio-client.js";
import { REMOTE_OUTPUT_SAMPLE } from "./remote-output-sample.js";

const FAKE = fileURLToPath(new URL("../../test/fake-ssh-mcp.mjs", import.meta.url));
const SERVER_ID = "0123456789abcdef";

let dir: string;
let runDir: string;
let clients: McpStdioClient[];

interface OptionOverrides {
  startTimeoutMs?: number;
  requestTimeoutMs?: number;
}

// A fixed base env, so the test does not depend on what the runner's env holds. PATH lets the
// fake start sleep.
function options(overrides: OptionOverrides = {}): McpStdioOptions {
  return {
    runDir,
    name: SERVER_ID,
    procRoot: "/proc",
    baseEnv: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      PASEO_PASSWORD: "not-a-real-password",
      PASEO_AGENT_ID: "agent-x",
      CLAUDECODE: "1",
    },
    startTimeoutMs: overrides.startTimeoutMs ?? 10_000,
    requestTimeoutMs: overrides.requestTimeoutMs ?? 10_000,
  };
}

function fake(env: Record<string, string>): McpServerCommand {
  return { command: process.execPath, args: [FAKE], env };
}

async function start(
  env: Record<string, string>,
  overrides: OptionOverrides = {},
): Promise<McpStdioClient> {
  const client = await startMcpStdioClient(fake(env), options(overrides));
  clients.push(client);
  return client;
}

function readLog(file: string): unknown[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line): unknown => JSON.parse(line));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) return false;
    await delay(50);
  }
  return true;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rm-mcp-"));
  runDir = join(dir, "run");
  clients = [];
});

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  rmSync(dir, { recursive: true, force: true });
});

describe("serverEnv", () => {
  it("lays the entry's env over the base without PASEO_* or the parent-session keys", () => {
    expect(
      serverEnv(
        { OWN: "1", PATH: "/opt/bin" },
        {
          PATH: "/usr/bin",
          HOME: "/home/u",
          PASEO_HOME: "/p",
          CLAUDE_CODE_ENTRYPOINT: "cli",
          ESBUILD_BINARY_PATH: "/e",
        },
      ),
    ).toEqual({ PATH: "/opt/bin", HOME: "/home/u", OWN: "1" });
  });
});

// readline re-emits a stream error on its interface. Without a listener there, vitest reports it
// as an unhandled error and the run fails although the assertion holds.
describe("readLines", () => {
  it("delivers lines until its stream fails, and the failure does not escape", async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    readLines(stream, (line) => {
      lines.push(line);
    });

    stream.write("first\n");
    stream.destroy(new Error("stdout broke"));
    await delay(50);

    expect(lines).toEqual(["first"]);
  });
});

describe("startMcpStdioClient", () => {
  it("initializes, lists tools and returns a tool's text", async () => {
    const outputFile = join(dir, "output.txt");
    const callLog = join(dir, "calls.jsonl");
    writeFileSync(outputFile, REMOTE_OUTPUT_SAMPLE);

    const client = await start({
      FAKE_SSH_MCP_OUTPUT_FILE: outputFile,
      FAKE_SSH_MCP_CALL_LOG: callLog,
    });

    await expect(client.listTools()).resolves.toEqual(["exec"]);
    await expect(client.callTool("exec", { command: "echo hi" })).resolves.toEqual({
      isError: false,
      text: REMOTE_OUTPUT_SAMPLE,
    });
    expect(readLog(callLog)).toEqual([{ name: "exec", arguments: { command: "echo hi" } }]);
    expect(client.closed).toBe(false);
  });

  it("keeps a pid file for its group while it runs; close stops the group and removes it", async () => {
    const childPidFile = join(dir, "child.pid");
    const client = await start({ FAKE_SSH_MCP_CHILD_PID_FILE: childPidFile });
    const pidFile = `${SERVER_ID}-${client.pid}.pid`;

    expect(statSync(runDir).mode & 0o777).toBe(0o700);
    expect(readdirSync(runDir)).toEqual([pidFile]);
    expect(JSON.parse(readFileSync(join(runDir, pidFile), "utf8"))).toMatchObject({
      pgid: client.pid,
      ownerPid: process.pid,
    });
    const childPid = Number(readFileSync(childPidFile, "utf8"));
    expect(isAlive(childPid)).toBe(true);

    await client.close();

    expect(readdirSync(runDir)).toEqual([]);
    await expect(waitUntil(() => !isAlive(childPid))).resolves.toBe(true);
    expect(client.closed).toBe(true);
    await expect(client.listTools()).rejects.toThrow(
      new McpSessionError("The ssh-mcp session was closed"),
    );
  });

  it("answers a server ping, refuses other server requests and skips non-JSON stdout", async () => {
    const callLog = join(dir, "calls.jsonl");
    const client = await start({ FAKE_SSH_MCP_NOISE: "1", FAKE_SSH_MCP_CALL_LOG: callLog });

    // One more round trip, so the fake has read the client's answers.
    await client.listTools();

    expect(readLog(callLog)).toEqual([{ pong: true }, { refused: -32601 }]);
  });

  it("returns a tool failure and a JSON-RPC error as isError, and stays open", async () => {
    const message = "Error (code 1): cat: /proc/meminfo: No such file or directory";
    const failing = await start({ FAKE_SSH_MCP_FAIL: message });
    const refusing = await start({ FAKE_SSH_MCP_RPC_ERROR: "Command timed out" });

    await expect(failing.callTool("exec", { command: "x" })).resolves.toEqual({
      isError: true,
      text: message,
    });
    await expect(refusing.callTool("exec", { command: "x" })).resolves.toEqual({
      isError: true,
      text: "Command timed out",
    });
    expect([failing.closed, refusing.closed]).toEqual([false, false]);
  });

  it("reports an exit during start with ssh-mcp's last stderr line and leaves no pid file", async () => {
    await expect(start({ FAKE_SSH_MCP_EXIT_ON_START: "3" })).rejects.toThrow(
      new McpSessionError("ssh-mcp exited (code 3): fatal: could not connect to 10.0.0.9"),
    );
    expect(readdirSync(runDir)).toEqual([]);
  });

  it("times out a request that gets no answer", async () => {
    const client = await start({ FAKE_SSH_MCP_HANG: "tools/call" }, { requestTimeoutMs: 300 });

    await expect(client.callTool("exec", { command: "x" })).rejects.toThrow(
      new McpSessionError("ssh-mcp did not answer tools/call within 0.3 s"),
    );
  });

  it("gives up a start that gets no answer and stops the process", async () => {
    await expect(
      start({ FAKE_SSH_MCP_HANG: "initialize" }, { startTimeoutMs: 300 }),
    ).rejects.toThrow(new McpSessionError("ssh-mcp did not answer initialize within 0.3 s"));
    expect(readdirSync(runDir)).toEqual([]);
  });

  it("stops a start when its signal aborts, and never starts one that is already aborted", async () => {
    const controller = new AbortController();
    const starting = startMcpStdioClient(
      fake({ FAKE_SSH_MCP_HANG: "initialize" }),
      options(),
      controller.signal,
    );
    setTimeout(() => controller.abort(), 200);

    await expect(starting).rejects.toThrow(new McpSessionError("The ssh-mcp session was closed"));
    expect(readdirSync(runDir)).toEqual([]);

    rmSync(runDir, { recursive: true });
    await expect(startMcpStdioClient(fake({}), options(), AbortSignal.abort())).rejects.toThrow(
      new McpSessionError("The ssh-mcp start was cancelled"),
    );
    expect(existsSync(runDir)).toBe(false);
  });

  it("reports a command that cannot be started", async () => {
    const missing = join(dir, "missing", "ssh-mcp");

    await expect(
      startMcpStdioClient({ command: missing, args: [], env: {} }, options()),
    ).rejects.toThrow(new McpSessionError(`Could not start ssh-mcp: spawn ${missing} ENOENT`));
    expect(readdirSync(runDir)).toEqual([]);
  });

  it("starts ssh-mcp without PASEO_* or the parent-session keys", async () => {
    const envLog = join(dir, "env.json");

    await start({ FAKE_SSH_MCP_ENV_LOG: envLog, FAKE_SSH_MCP_OWN: "1" });

    expect(JSON.parse(readFileSync(envLog, "utf8"))).toEqual({
      paseo: 0,
      claudecode: null,
      own: "1",
    });
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/remote/mcp-stdio-client.posix.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './mcp-stdio-client.js'`.

- [ ] **Step 4: Write the client**

Create `plugins/resource-manager/server/remote/mcp-stdio-client.ts`:

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { z } from "zod";
import { killGroup, removePidFile, writePidFile } from "../pid-files.js";

// A minimal MCP client over a child's stdio: initialize, tools/list, tools/call. It runs inside
// the daemon, so every child, stream and timer event is handled and every timer is unref'd. The
// child is a detached group leader with a pid file, so a daemon that dies leaves a file the next
// start reclaims (decision 16).

export const MCP_PROTOCOL_VERSION = "2025-06-18";
const CLIENT_INFO = { name: "paseo-resource-manager", version: "1.0.0" };
const MAX_STDERR_CHARS = 300;
const MAX_TOOL_PAGES = 20;
// After the leader exits, how long to wait for the rest of its stderr before reporting.
const EXIT_DRAIN_MS = 200;

// As in plugins/shared-mcp/server/process-runner.ts:33-46: Paseo's own variables and the keys
// Paseo removes from every process it launches never reach ssh-mcp.
const STRIPPED_ENV_PREFIX = "PASEO_";
const STRIPPED_ENV_KEYS = new Set([
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE",
  "ESBUILD_BINARY_PATH",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_AGENT_SDK_VERSION",
]);

export interface McpServerCommand {
  command: string;
  args: readonly string[];
  /** The entry's own env, laid over the base env. */
  env: Record<string, string>;
}

export interface McpStdioOptions {
  runDir: string;
  /** Pid files are <runDir>/<name>-<pid>.pid. Pass the server id, never the entry's name. */
  name: string;
  procRoot: string;
  /** The daemon's env. PASEO_* and the parent-session keys are removed from it. */
  baseEnv: NodeJS.ProcessEnv;
  startTimeoutMs: number;
  requestTimeoutMs: number;
}

export interface ToolCallResult {
  isError: boolean;
  /** The result's text parts, joined by newlines. */
  text: string;
}

export class McpSessionError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "McpSessionError";
  }
}

export class JsonRpcError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.name = "JsonRpcError";
    this.code = code;
  }
}

const IdSchema = z.union([z.number(), z.string()]);
type JsonRpcId = z.output<typeof IdSchema>;

const IncomingSchema = z.object({
  id: IdSchema.nullish(),
  method: z.string().optional(),
  result: z.unknown().optional(),
  error: z.object({ code: z.number(), message: z.string() }).optional(),
});

const InitializeResultSchema = z.object({ protocolVersion: z.string() });

const ToolsListResultSchema = z.object({
  tools: z.array(z.object({ name: z.string() })),
  nextCursor: z.string().optional(),
});

const CallToolResultSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional(),
  isError: z.boolean().optional(),
});

interface Pending {
  resolve(result: unknown): void;
  reject(error: Error): void;
  timer: NodeJS.Timeout;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function serverEnv(
  overrides: Record<string, string>,
  base: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(base)) {
    if (key.startsWith(STRIPPED_ENV_PREFIX) || STRIPPED_ENV_KEYS.has(key)) continue;
    env[key] = value;
  }
  for (const [key, value] of Object.entries(overrides)) env[key] = value;
  return env;
}

// A stream error means the child went away; the exit handler reports that. readline re-emits an
// input stream's error on its interface, which needs its own listener (as shared-mcp's
// process-runner.ts:369 has). A throwing handler must not escape a readline event either, or it
// would take the daemon down.
export function readLines(stream: Readable | null, onLine: (line: string) => void): void {
  if (stream === null) return;
  stream.on("error", () => {
    // Reported by the exit handler.
  });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on("error", () => {
    // The same stream error, re-emitted by readline.
  });
  lines.on("line", (line) => {
    try {
      onLine(line);
    } catch (error) {
      console.error("resource-manager: an ssh-mcp line handler failed", error);
    }
  });
}

export class McpStdioClient {
  readonly pid: number | null;
  private readonly child: ChildProcess;
  private readonly pidFile: string | null;
  private readonly requestTimeoutMs: number;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;
  private lastStderr = "";
  private exited = false;
  private failure: McpSessionError | null = null;
  private closing: Promise<void> | null = null;

  constructor(child: ChildProcess, pidFile: string | null, requestTimeoutMs: number) {
    this.child = child;
    this.pid = child.pid ?? null;
    this.pidFile = pidFile;
    this.requestTimeoutMs = requestTimeoutMs;
    // An unlistened "error" on the child or a stream would crash the daemon.
    child.on("error", (error) => {
      this.fail(new McpSessionError(`Could not start ssh-mcp: ${error.message}`, { cause: error }));
    });
    child.once("exit", (code, signal) => this.onExit(code, signal));
    child.stdin?.on("error", () => {
      // A write after ssh-mcp closed its stdin fails with EPIPE; the exit handler reports why.
    });
    readLines(child.stdout, (line) => this.handleLine(line));
    readLines(child.stderr, (line) => this.noteStderr(line));
  }

  get closed(): boolean {
    return this.exited || this.failure !== null;
  }

  async initialize(timeoutMs: number): Promise<void> {
    const raw = await this.call(
      "initialize",
      { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      timeoutMs,
    );
    if (!InitializeResultSchema.safeParse(raw).success) {
      throw new McpSessionError("ssh-mcp answered initialize with an unexpected result");
    }
    this.send({ jsonrpc: "2.0", method: "notifications/initialized" });
  }

  async listTools(): Promise<string[]> {
    const names: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const raw = await this.call(
        "tools/list",
        cursor === undefined ? {} : { cursor },
        this.requestTimeoutMs,
      );
      const result = ToolsListResultSchema.safeParse(raw);
      if (!result.success) {
        throw new McpSessionError("ssh-mcp answered tools/list with an unexpected result");
      }
      for (const tool of result.data.tools) names.push(tool.name);
      cursor = result.data.nextCursor;
      if (cursor === undefined) break;
    }
    return names;
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    let raw: unknown;
    try {
      raw = await this.request("tools/call", { name, arguments: args }, this.requestTimeoutMs);
    } catch (error) {
      // Older MCP SDKs turn an exception in a tool into a JSON-RPC error.
      if (error instanceof JsonRpcError) return { isError: true, text: error.message };
      throw error;
    }
    const result = CallToolResultSchema.safeParse(raw);
    if (!result.success) {
      throw new McpSessionError(`ssh-mcp answered ${name} with an unexpected result`);
    }
    const text = (result.data.content ?? [])
      .flatMap((part) => (part.type === "text" && part.text !== undefined ? [part.text] : []))
      .join("\n");
    return { isError: result.data.isError === true, text };
  }

  close(): Promise<void> {
    this.closing ??= this.shutdown();
    return this.closing;
  }

  private async shutdown(): Promise<void> {
    this.fail(new McpSessionError("The ssh-mcp session was closed"));
    try {
      this.child.stdin?.end();
      if (this.pid !== null) await killGroup(this.pid);
      if (this.pidFile !== null) removePidFile(this.pidFile);
    } catch (error) {
      console.error("resource-manager: could not stop an ssh-mcp session", error);
    }
  }

  // Waits for the rest of stderr ("close" comes once the streams end) or EXIT_DRAIN_MS, so the
  // message carries ssh-mcp's last line. fail() keeps the first failure, so reporting twice is
  // harmless.
  private onExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.exited = true;
    const how = code === null ? String(signal) : `code ${code}`;
    const report = (): void => {
      const detail = this.lastStderr === "" ? "" : `: ${this.lastStderr}`;
      this.fail(new McpSessionError(`ssh-mcp exited (${how})${detail}`));
    };
    this.child.once("close", report);
    setTimeout(report, EXIT_DRAIN_MS).unref();
  }

  private noteStderr(line: string): void {
    const trimmed = line.trim();
    if (trimmed !== "") this.lastStderr = trimmed.slice(0, MAX_STDERR_CHARS);
  }

  private fail(error: McpSessionError): void {
    this.failure ??= error;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(this.failure);
    }
    this.pending.clear();
  }

  private send(message: Record<string, unknown>): void {
    const stdin = this.child.stdin;
    if (this.pid === null || this.exited || this.failure !== null) return;
    if (stdin === null || !stdin.writable) return;
    stdin.write(`${JSON.stringify(message)}\n`);
  }

  private request(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.failure !== null) return Promise.reject(this.failure);
    const id = this.nextId;
    this.nextId += 1;
    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          new McpSessionError(`ssh-mcp did not answer ${method} within ${timeoutMs / 1000} s`),
        );
      }, timeoutMs);
      timer.unref();
      this.pending.set(id, { resolve, reject, timer });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  // A JSON-RPC error on a protocol method means the session cannot be used.
  private async call(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<unknown> {
    try {
      return await this.request(method, params, timeoutMs);
    } catch (error) {
      if (error instanceof JsonRpcError) {
        throw new McpSessionError(`ssh-mcp refused ${method}: ${error.message}`, { cause: error });
      }
      throw error;
    }
  }

  private handleLine(line: string): void {
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      return;
    }
    const message = IncomingSchema.safeParse(json);
    if (!message.success) return;
    const { id, method, error } = message.data;
    if (method !== undefined) {
      if (id !== undefined && id !== null) this.answerServerRequest(id, method);
      return;
    }
    if (typeof id !== "number") return;
    const pending = this.pending.get(id);
    if (pending === undefined) return;
    this.pending.delete(id);
    clearTimeout(pending.timer);
    if (error !== undefined) pending.reject(new JsonRpcError(error.code, error.message));
    else pending.resolve(message.data.result);
  }

  private answerServerRequest(id: JsonRpcId, method: string): void {
    if (method === "ping") this.send({ jsonrpc: "2.0", id, result: {} });
    else this.send({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
  }
}

function spawnServer(command: McpServerCommand, options: McpStdioOptions): ChildProcess {
  try {
    mkdirSync(options.runDir, { recursive: true, mode: 0o700 });
    return spawn(command.command, [...command.args], {
      env: serverEnv(command.env, options.baseEnv),
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (error) {
    throw new McpSessionError(`Could not start ssh-mcp: ${errorMessage(error)}`, { cause: error });
  }
}

export async function startMcpStdioClient(
  command: McpServerCommand,
  options: McpStdioOptions,
  signal?: AbortSignal,
): Promise<McpStdioClient> {
  if (signal?.aborted) throw new McpSessionError("The ssh-mcp start was cancelled");
  const child = spawnServer(command, options);
  const pidFile =
    child.pid === undefined ? null : join(options.runDir, `${options.name}-${child.pid}.pid`);
  const client = new McpStdioClient(child, pidFile, options.requestTimeoutMs);
  const abort = (): void => {
    void client.close();
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (pidFile !== null && client.pid !== null) {
      writePidFile(pidFile, client.pid, options.procRoot);
    }
    await client.initialize(options.startTimeoutMs);
    return client;
  } catch (error) {
    await client.close();
    if (error instanceof McpSessionError) throw error;
    throw new McpSessionError(`Could not start ssh-mcp: ${errorMessage(error)}`, { cause: error });
  } finally {
    signal?.removeEventListener("abort", abort);
  }
}
```

Two details the tests pin down. `spawn` reports a missing command as an `error` event on the next tick with `child.pid` undefined; `send` writes nothing then, and the `error` handler rejects the pending `initialize` with `Could not start ssh-mcp: spawn <path> ENOENT`. When the fake exits during start, `exit` may come before its last stderr line is read, which is why `onExit` waits for `close` (or 200 ms).

- [ ] **Step 5: Run the client tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/remote/mcp-stdio-client.posix.test.ts --bail=1
```

Expected: PASS, 12 tests, in a few seconds (the two timeout tests wait 0.3 s, close waits for the group), and no "Unhandled Errors" block: the `readLines` test leaves one only when `lines.on("error")` is missing.

- [ ] **Step 6: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/resource-manager/server/remote/mcp-stdio-client.ts plugins/resource-manager/test/fake-ssh-mcp.mjs plugins/resource-manager/server/remote/mcp-stdio-client.posix.test.ts
cd /workspace/utils/paseo && npm run lint -- plugins/resource-manager
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: oxfmt exits 0; `Found 0 warnings and 0 errors.`; typecheck exit 0. Re-run Step 5 if oxfmt changed a file.

- [ ] **Step 7: Commit**

```bash
P="plugins/resource-manager/server/remote/mcp-stdio-client.ts plugins/resource-manager/test/fake-ssh-mcp.mjs plugins/resource-manager/server/remote/mcp-stdio-client.posix.test.ts"
git -C /workspace/utils/paseo add $P
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): resource-manager MCP stdio client and fake ssh-mcp" -- $P
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo status --short --untracked-files=all -- $P
```

Expected: the hook passes; `3 files changed`; the fork identity; `status` prints nothing.

---

### Task 10: Remote sessions: one client per server, deadline, idle close

**Files:**

- Create: `plugins/resource-manager/server/remote/sessions.ts`
- Create: `plugins/resource-manager/server/remote/fakes.ts` (typed fakes, typechecked with the plugin)
- Test: `plugins/resource-manager/server/remote/sessions.test.ts`
- Test: `plugins/resource-manager/server/remote/sessions.posix.test.ts` (real client, fake ssh-mcp)

**Interfaces:**

- Consumes: `SshServer` (Task 7); `ToolCallResult`, `McpSessionError`, `startMcpStdioClient`, `McpStdioClient` (Task 9, the client satisfies `SessionClient` structurally); `REMOTE_COMMAND`, `parseRemoteOutput`, `toolErrorMessage`, `RemoteOutputError`, `REMOTE_OUTPUT_SAMPLE`, `REMOTE_SNAPSHOT_SAMPLE` (Task 8); `listPidFiles`, `reclaimPidFile(file, procRoot, selfPid = process.pid): Promise<ReclaimOutcome>` (Task 4); `writeFakeProc` (Task 4, test); `ServerReading` (Task 1).
- Produces (`sessions.ts`):
  - `SESSION_TIMING = { idleMs: 120_000, waitMs: 40_000 }`, `WAITING_MESSAGE`, `SHUTDOWN_MESSAGE`
  - `interface SessionClient { readonly closed: boolean; listTools(): Promise<string[]>; callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>; close(): Promise<void> }`
  - `type StartClient = (server: SshServer, signal: AbortSignal) => Promise<SessionClient>`
  - `interface TimerHandle { cancel(): void }`, `interface TimerPort { now(): number; after(ms: number, callback: () => void): TimerHandle }`, `nodeTimers: TimerPort` (unref'd)
  - `class NoUsableToolError extends Error`, `pickTool(names: readonly string[]): string`, `missingVariablesMessage(names: readonly string[]): string`
  - `interface RemoteSessionsOptions { runDir: string; procRoot: string; startClient: StartClient; timers: TimerPort; log(message: string): void }`
  - `class RemoteSessions { readonly ready: Promise<void>; read(server: SshServer): Promise<ServerReading>; closeAll(): Promise<void> }` (`read` never rejects)
- Produces (`fakes.ts`): `SAMPLE_ANSWER`, `type FakeAnswer = ToolCallResult | Error | Promise<ToolCallResult>`, `class FakeSessionClient implements SessionClient` (`calls`, `closeCount`), `class FakeStarter` (`start: StartClient`, `queue`, `started`, `clients`), `class FakeTimers implements TimerPort` (`advance(ms)`, `scheduled`).

- [ ] **Step 1: Write the fakes**

Create `plugins/resource-manager/server/remote/fakes.ts`:

```ts
import type { SshServer } from "./discovery.js";
import { McpSessionError, type ToolCallResult } from "./mcp-stdio-client.js";
import { REMOTE_OUTPUT_SAMPLE } from "./remote-output-sample.js";
import type { SessionClient, StartClient, TimerHandle, TimerPort } from "./sessions.js";

// Typed stand-ins for the MCP client, its starter and the clock, for tests. Typechecked with the
// plugin, so a test that uses them is checked even though test files are not.

export const SAMPLE_ANSWER: ToolCallResult = { isError: false, text: REMOTE_OUTPUT_SAMPLE };

/** A tool answer: a result, an Error to reject with, or a promise that settles later. */
export type FakeAnswer = ToolCallResult | Error | Promise<ToolCallResult>;

export interface ToolCall {
  name: string;
  args: Record<string, unknown>;
}

export class FakeSessionClient implements SessionClient {
  closed = false;
  closeCount = 0;
  readonly calls: ToolCall[] = [];
  private readonly tools: string[];
  private readonly answers: FakeAnswer[];

  /** Answers are used in order; the last one repeats. */
  constructor(tools: string[] = ["exec"], answers: FakeAnswer[] = [SAMPLE_ANSWER]) {
    this.tools = tools;
    this.answers = answers;
  }

  listTools(): Promise<string[]> {
    if (this.closed) return Promise.reject(new McpSessionError("The ssh-mcp session was closed"));
    return Promise.resolve([...this.tools]);
  }

  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult> {
    if (this.closed) return Promise.reject(new McpSessionError("The ssh-mcp session was closed"));
    this.calls.push({ name, args });
    const answer = this.answers.length > 1 ? this.answers.shift() : this.answers[0];
    if (answer === undefined) return Promise.reject(new Error("FakeSessionClient has no answer"));
    if (answer instanceof Error) return Promise.reject(answer);
    return Promise.resolve(answer);
  }

  close(): Promise<void> {
    this.closed = true;
    this.closeCount += 1;
    return Promise.resolve();
  }
}

export interface StartRecord {
  server: SshServer;
  signal: AbortSignal;
}

export class FakeStarter {
  /** What the next starts give, in order: a client, or an Error to reject with. */
  readonly queue: (FakeSessionClient | Error)[] = [];
  readonly started: StartRecord[] = [];
  readonly clients: FakeSessionClient[] = [];

  readonly start: StartClient = (server, signal) => {
    this.started.push({ server, signal });
    if (signal.aborted) {
      return Promise.reject(new McpSessionError("The ssh-mcp start was cancelled"));
    }
    const next = this.queue.shift() ?? new FakeSessionClient();
    if (next instanceof Error) return Promise.reject(next);
    this.clients.push(next);
    return Promise.resolve(next);
  };
}

interface FakeTimer {
  at: number;
  callback: () => void;
  cancelled: boolean;
}

export class FakeTimers implements TimerPort {
  private current: number;
  private readonly timers: FakeTimer[] = [];

  constructor(start = Date.parse("2026-11-06T09:00:00.000Z")) {
    this.current = start;
  }

  now(): number {
    return this.current;
  }

  after(ms: number, callback: () => void): TimerHandle {
    const timer: FakeTimer = { at: this.current + ms, callback, cancelled: false };
    this.timers.push(timer);
    return {
      cancel: () => {
        timer.cancelled = true;
      },
    };
  }

  /** Moves the clock forward, running each timer that falls due in time order. */
  advance(ms: number): void {
    const target = this.current + ms;
    for (;;) {
      const due = this.timers
        .filter((timer) => !timer.cancelled && timer.at <= target)
        .sort((a, b) => a.at - b.at)[0];
      if (due === undefined) break;
      due.cancelled = true;
      this.current = due.at;
      due.callback();
    }
    this.current = target;
  }

  get scheduled(): number {
    return this.timers.filter((timer) => !timer.cancelled).length;
  }
}
```

- [ ] **Step 2: Write the failing unit tests**

Create `plugins/resource-manager/server/remote/sessions.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ServerReading } from "../../shared/rpc.js";
import { writeFakeProc, type FakePidSpace } from "../local/fake-proc.js";
import type { PidRecord } from "../pid-files.js";
import type { SshServer } from "./discovery.js";
import { FakeSessionClient, FakeStarter, FakeTimers, SAMPLE_ANSWER } from "./fakes.js";
import { McpSessionError, type ToolCallResult } from "./mcp-stdio-client.js";
import { REMOTE_COMMAND } from "./remote-output.js";
import { REMOTE_OUTPUT_SAMPLE, REMOTE_SNAPSHOT_SAMPLE } from "./remote-output-sample.js";
import { RemoteSessions, SHUTDOWN_MESSAGE, WAITING_MESSAGE } from "./sessions.js";

const SPACE: FakePidSpace = { pidNamespace: "pid:[4026531836]", bootId: "boot-1" };
const ID = "0123456789abcdef";
const T0_ISO = "2026-11-06T09:00:00.000Z";

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let settle: (value: T) => void = () => {};
  const promise = new Promise<T>((resolve) => {
    settle = resolve;
  });
  return { promise, resolve: (value) => settle(value) };
}

function server(overrides: Partial<SshServer> = {}): SshServer {
  return {
    id: ID,
    name: "prod-box",
    source: "User config",
    command: "npx",
    args: ["ssh-mcp", "-y", "--", "--host=10.0.0.1"],
    env: {},
    missingVariables: [],
    fingerprint: "a".repeat(64),
    ...overrides,
  };
}

function ok(readAt = T0_ISO): ServerReading {
  return { id: ID, snapshot: REMOTE_SNAPSHOT_SAMPLE, readAt, error: null };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

let root: string;
let runDir: string;
let procRoot: string;
let starter: FakeStarter;
let timers: FakeTimers;
let logs: string[];

function sessions(): RemoteSessions {
  return new RemoteSessions({
    runDir,
    procRoot,
    startClient: starter.start,
    timers,
    log: (message) => logs.push(message),
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-sessions-"));
  runDir = join(root, "run");
  procRoot = join(root, "proc");
  writeFakeProc(procRoot, [{ pid: 1, ppid: 0, startTime: 10 }], SPACE);
  starter = new FakeStarter();
  timers = new FakeTimers();
  logs = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("RemoteSessions", () => {
  it("reads through exec with the fixed command and reuses the session", async () => {
    const remote = sessions();

    await expect(remote.read(server())).resolves.toEqual(ok());
    await expect(remote.read(server())).resolves.toEqual(ok());

    expect(starter.started).toHaveLength(1);
    expect(starter.clients[0].calls).toEqual([
      { name: "exec", args: { command: REMOTE_COMMAND } },
      { name: "exec", args: { command: REMOTE_COMMAND } },
    ]);
  });

  it("falls back to run-command and reads a clean run with stderr", async () => {
    const stderr = "warning: setlocale: LC_ALL: cannot change locale";
    const answer: ToolCallResult = {
      isError: false,
      text: `${REMOTE_OUTPUT_SAMPLE}\n\n[stderr]\n${stderr}\n`,
    };
    starter.queue.push(new FakeSessionClient(["read-command", "run-command"], [answer]));

    await expect(sessions().read(server())).resolves.toEqual(ok());
    expect(starter.clients[0].calls[0].name).toBe("run-command");
  });

  it("shows a failed run-command's exit code and stderr, not its output", async () => {
    const failed: ToolCallResult = {
      isError: true,
      text: "@@meminfo\n\n\n[stderr]\ncat: /proc/meminfo: No such file or directory\n\n\n[exit 1]",
    };
    starter.queue.push(new FakeSessionClient(["run-command"], [failed]));

    await expect(sessions().read(server())).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: "The command exited with code 1: cat: /proc/meminfo: No such file or directory",
    });
    expect(starter.clients[0].closed).toBe(false);
  });

  it("reports an ssh-mcp with neither tool and keeps its session", async () => {
    starter.queue.push(new FakeSessionClient(["read-command"]));

    await expect(sessions().read(server())).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: "This ssh-mcp offers neither exec nor run-command",
    });
    expect(starter.clients[0].closed).toBe(false);
  });

  it("keeps the last snapshot and the session on a tool error", async () => {
    const refused = "Error (code 255): ssh: connect to host 10.0.0.1 port 22: Connection refused";
    starter.queue.push(
      new FakeSessionClient(["exec"], [SAMPLE_ANSWER, { isError: true, text: refused }]),
    );
    const remote = sessions();

    await remote.read(server());
    timers.advance(30_000);
    await expect(remote.read(server())).resolves.toEqual({ ...ok(), error: refused });

    expect(starter.clients[0].closed).toBe(false);
  });

  it("keeps the session when the output does not parse", async () => {
    starter.queue.push(new FakeSessionClient(["exec"], [{ isError: false, text: "garbage" }]));

    await expect(sessions().read(server())).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: "The output has no meminfo section",
    });
    expect(starter.clients[0].closed).toBe(false);
  });

  it("drops the session on a session error and starts a new one on the next read", async () => {
    const lost = new McpSessionError("ssh-mcp exited (code 1): Connection reset by peer");
    starter.queue.push(new FakeSessionClient(["exec"], [lost]));
    const remote = sessions();

    await expect(remote.read(server())).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: "ssh-mcp exited (code 1): Connection reset by peer",
    });
    await flush();
    expect(starter.clients[0].closeCount).toBe(1);

    await expect(remote.read(server())).resolves.toEqual(ok());
    expect(starter.started).toHaveLength(2);
  });

  it("reports a failed start and retries it on the next read", async () => {
    starter.queue.push(
      new McpSessionError("ssh-mcp exited (code 255): Permission denied (publickey)"),
    );
    const remote = sessions();

    await expect(remote.read(server())).resolves.toMatchObject({
      error: "ssh-mcp exited (code 255): Permission denied (publickey)",
    });
    await expect(remote.read(server())).resolves.toEqual(ok());
    expect(starter.started).toHaveLength(2);
  });

  it("answers after 40 s with the waiting message, and a later read gets the late result", async () => {
    const slow = deferred<ToolCallResult>();
    starter.queue.push(new FakeSessionClient(["exec"], [slow.promise, SAMPLE_ANSWER]));
    const remote = sessions();

    const first = remote.read(server());
    await flush();
    timers.advance(40_000);
    await expect(first).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: WAITING_MESSAGE,
    });

    const second = remote.read(server());
    await flush();
    expect(starter.clients[0].calls).toHaveLength(1);
    slow.resolve(SAMPLE_ANSWER);
    await expect(second).resolves.toEqual(ok("2026-11-06T09:00:40.000Z"));
  });

  it("closes the session 2 minutes after the last read", async () => {
    const remote = sessions();
    await remote.read(server());

    timers.advance(119_000);
    await remote.read(server());
    timers.advance(119_000);
    await flush();
    expect(starter.clients[0].closed).toBe(false);

    timers.advance(1_000);
    await flush();
    expect(starter.clients[0].closeCount).toBe(1);

    await remote.read(server());
    expect(starter.started).toHaveLength(2);
  });

  it("keeps a session whose read is still running past the idle time", async () => {
    const slow = deferred<ToolCallResult>();
    starter.queue.push(new FakeSessionClient(["exec"], [slow.promise]));
    const remote = sessions();

    const reading = remote.read(server());
    await flush();
    timers.advance(130_000);
    await flush();
    expect(starter.clients[0].closed).toBe(false);

    slow.resolve(SAMPLE_ANSWER);
    await flush();
    await expect(reading).resolves.toMatchObject({ error: WAITING_MESSAGE });
    timers.advance(120_000);
    await flush();
    expect(starter.clients[0].closeCount).toBe(1);
  });

  it("never starts a server whose config names unset variables", async () => {
    await expect(sessions().read(server({ missingVariables: ["PROD_HOST"] }))).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: "The config refers to PROD_HOST, which the daemon's environment does not set",
    });
    expect(starter.started).toEqual([]);
  });

  it("replaces the session when the entry's command, args or env change", async () => {
    const remote = sessions();
    await remote.read(server());

    await remote.read(server({ fingerprint: "b".repeat(64) }));
    await flush();

    expect(starter.clients[0].closeCount).toBe(1);
    expect(starter.started.map((record) => record.server.fingerprint)).toEqual([
      "a".repeat(64),
      "b".repeat(64),
    ]);
  });

  it("closeAll closes every session and later reads get the shutdown message", async () => {
    const remote = sessions();
    await remote.read(server());
    await remote.read(server({ id: "fedcba9876543210", name: "db-box" }));

    await remote.closeAll();

    expect(starter.clients.map((client) => client.closeCount)).toEqual([1, 1]);
    expect(starter.started.every((record) => record.signal.aborted)).toBe(true);
    expect(timers.scheduled).toBe(0);
    await expect(remote.read(server())).resolves.toEqual({
      id: ID,
      snapshot: null,
      readAt: null,
      error: SHUTDOWN_MESSAGE,
    });
    expect(starter.started).toHaveLength(2);
  });

  it("removes stale pid files in its run directory before the first read", async () => {
    mkdirSync(runDir);
    const stale: PidRecord = {
      pgid: 4321,
      startTime: 99,
      ownerPid: 77,
      ownerStartTime: 5,
      pidNamespace: SPACE.pidNamespace,
      bootId: "boot-0",
      initStartTime: 10,
    };
    const file = join(runDir, `${ID}-4321.pid`);
    writeFileSync(file, `${JSON.stringify(stale)}\n`);

    await sessions().ready;

    expect(existsSync(file)).toBe(false);
    expect(logs).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/remote/sessions.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './sessions.js'` imported from `sessions.test.ts`, no tests run. `fakes.ts` imports `sessions.js` for types only, which esbuild erases, so the test file's own value import is the one that fails.

- [ ] **Step 4: Write the sessions**

Create `plugins/resource-manager/server/remote/sessions.ts`:

```ts
import { join } from "node:path";
import type { ServerReading } from "../../shared/rpc.js";
import { listPidFiles, reclaimPidFile } from "../pid-files.js";
import type { SshServer } from "./discovery.js";
import type { ToolCallResult } from "./mcp-stdio-client.js";
import {
  parseRemoteOutput,
  REMOTE_COMMAND,
  RemoteOutputError,
  toolErrorMessage,
} from "./remote-output.js";

// One MCP client per ssh-mcp server, started on the first read and closed 2 minutes after the
// last (decision 15). A read waits at most 40 s; the work goes on, and a later read gets it.

export const SESSION_TIMING = { idleMs: 120_000, waitMs: 40_000 } as const;
export const WAITING_MESSAGE =
  "No answer from ssh-mcp after 40 s; the reading shows on a later refresh";
export const SHUTDOWN_MESSAGE = "Paseo is shutting down";
const MAX_ERROR_CHARS = 500;

export interface SessionClient {
  readonly closed: boolean;
  listTools(): Promise<string[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>;
  close(): Promise<void>;
}

export type StartClient = (server: SshServer, signal: AbortSignal) => Promise<SessionClient>;

export interface TimerHandle {
  cancel(): void;
}

export interface TimerPort {
  now(): number;
  after(ms: number, callback: () => void): TimerHandle;
}

// Unref'd, so a pending idle close never holds the daemon open.
export const nodeTimers: TimerPort = {
  now: () => Date.now(),
  after: (ms, callback) => {
    const timer = setTimeout(callback, ms);
    timer.unref();
    return { cancel: () => clearTimeout(timer) };
  },
};

export class NoUsableToolError extends Error {
  constructor() {
    super("This ssh-mcp offers neither exec nor run-command");
    this.name = "NoUsableToolError";
  }
}

export interface RemoteSessionsOptions {
  runDir: string;
  procRoot: string;
  startClient: StartClient;
  timers: TimerPort;
  log(message: string): void;
}

interface Entry {
  server: SshServer;
  client: Promise<SessionClient> | null;
  /** The read in flight. Never rejects. */
  work: Promise<void> | null;
  reading: ServerReading;
  idle: TimerHandle | null;
  /** Aborted when the entry is replaced or the plugin stops; cancels a start in progress. */
  abort: AbortController;
  toolName: string | null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function emptyReading(id: string, error: string | null): ServerReading {
  return { id, snapshot: null, readAt: null, error };
}

// The last snapshot stays, with its time, so the tab keeps showing it under the error.
function failedReading(previous: ServerReading, message: string): ServerReading {
  return {
    id: previous.id,
    snapshot: previous.snapshot,
    readAt: previous.readAt,
    error: message.slice(0, MAX_ERROR_CHARS),
  };
}

// ssh-mcp 1.x has exec; 2.x has run-command, and its read-command refuses "&" (decision 13).
export function pickTool(names: readonly string[]): string {
  if (names.includes("exec")) return "exec";
  if (names.includes("run-command")) return "run-command";
  throw new NoUsableToolError();
}

export function missingVariablesMessage(names: readonly string[]): string {
  return `The config refers to ${names.join(", ")}, which the daemon's environment does not set`;
}

export class RemoteSessions {
  readonly ready: Promise<void>;
  private readonly options: RemoteSessionsOptions;
  private readonly entries = new Map<string, Entry>();
  private readonly closings = new Set<Promise<void>>();
  private stopped = false;

  constructor(options: RemoteSessionsOptions) {
    this.options = options;
    this.ready = this.reclaim();
  }

  async read(server: SshServer): Promise<ServerReading> {
    await this.ready;
    if (this.stopped) return emptyReading(server.id, SHUTDOWN_MESSAGE);
    if (server.missingVariables.length > 0) {
      return emptyReading(server.id, missingVariablesMessage(server.missingVariables));
    }
    const entry = this.entryFor(server);
    this.touch(entry);
    if (entry.work === null) {
      entry.work = this.refresh(entry).finally(() => {
        entry.work = null;
      });
    }
    const finished = await this.withDeadline(entry.work);
    if (finished) return entry.reading;
    return { ...entry.reading, error: WAITING_MESSAGE };
  }

  async closeAll(): Promise<void> {
    this.stopped = true;
    for (const entry of [...this.entries.values()]) this.remove(entry);
    await Promise.all([...this.closings]);
  }

  // A daemon that died left its ssh-mcp groups running; their files name them.
  private async reclaim(): Promise<void> {
    for (const name of listPidFiles(this.options.runDir)) {
      try {
        const outcome = await reclaimPidFile(
          join(this.options.runDir, name),
          this.options.procRoot,
        );
        if (outcome === "killed") {
          this.options.log(`resource-manager: stopped an ssh-mcp group left running (${name})`);
        }
      } catch (error) {
        this.options.log(`resource-manager: could not reclaim ${name}: ${errorMessage(error)}`);
      }
    }
  }

  private entryFor(server: SshServer): Entry {
    const existing = this.entries.get(server.id);
    if (existing !== undefined && existing.server.fingerprint === server.fingerprint) {
      return existing;
    }
    if (existing !== undefined) this.remove(existing);
    const entry: Entry = {
      server,
      client: null,
      work: null,
      reading: emptyReading(server.id, null),
      idle: null,
      abort: new AbortController(),
      toolName: null,
    };
    this.entries.set(server.id, entry);
    return entry;
  }

  private async refresh(entry: Entry): Promise<void> {
    try {
      const client = await this.clientFor(entry);
      const tool = entry.toolName ?? pickTool(await client.listTools());
      entry.toolName = tool;
      const result = await client.callTool(tool, { command: REMOTE_COMMAND });
      if (result.isError) {
        entry.reading = failedReading(entry.reading, toolErrorMessage(result.text));
        return;
      }
      entry.reading = {
        id: entry.server.id,
        snapshot: parseRemoteOutput(result.text),
        readAt: new Date(this.options.timers.now()).toISOString(),
        error: null,
      };
    } catch (error) {
      entry.reading = failedReading(entry.reading, errorMessage(error));
      // Output that does not parse, or a server without a usable tool, will not improve with a
      // new session. Anything else (exit, timeout, protocol error) gets a fresh one next time.
      if (!(error instanceof RemoteOutputError || error instanceof NoUsableToolError)) {
        this.drop(entry);
      }
    }
  }

  private async clientFor(entry: Entry): Promise<SessionClient> {
    if (entry.client !== null) {
      const current = await entry.client;
      if (!current.closed) return current;
      this.drop(entry);
    }
    entry.client = this.options.startClient(entry.server, entry.abort.signal);
    return entry.client;
  }

  private async withDeadline(work: Promise<void>): Promise<boolean> {
    const deadline = new Promise<boolean>((resolve) => {
      const handle = this.options.timers.after(SESSION_TIMING.waitMs, () => resolve(false));
      void work.finally(() => handle.cancel());
    });
    return Promise.race([work.then(() => true), deadline]);
  }

  private touch(entry: Entry): void {
    entry.idle?.cancel();
    entry.idle = this.options.timers.after(SESSION_TIMING.idleMs, () => this.expire(entry));
  }

  // A read still running keeps the session until 2 minutes after it.
  private expire(entry: Entry): void {
    try {
      if (entry.work === null) this.remove(entry);
      else void entry.work.finally(() => this.touch(entry));
    } catch (error) {
      this.options.log(`resource-manager: idle close failed: ${errorMessage(error)}`);
    }
  }

  private remove(entry: Entry): void {
    if (this.entries.get(entry.server.id) === entry) this.entries.delete(entry.server.id);
    entry.idle?.cancel();
    entry.idle = null;
    entry.abort.abort();
    this.drop(entry);
  }

  private drop(entry: Entry): void {
    const client = entry.client;
    entry.client = null;
    entry.toolName = null;
    if (client === null) return;
    const closing = this.closeClient(client);
    this.closings.add(closing);
    void closing.finally(() => this.closings.delete(closing));
  }

  // Never rejects. A start that failed left nothing running.
  private async closeClient(client: Promise<SessionClient>): Promise<void> {
    let started: SessionClient;
    try {
      started = await client;
    } catch {
      return;
    }
    try {
      await started.close();
    } catch (error) {
      this.options.log(
        `resource-manager: could not close an ssh-mcp session: ${errorMessage(error)}`,
      );
    }
  }
}
```

The waiting test pins one ordering: the first read's deadline fires at 40 s while the slow call is pending, and the second read joins the same `work` (one call), so the late answer lands as the second read's result with the clock at 40 s. In the idle-while-reading test, `expire` at 120 s re-arms the idle timer when the slow call settles, so the session closes 120 s after that.

- [ ] **Step 5: Run the unit tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/remote/sessions.test.ts --bail=1
```

Expected: PASS, 15 tests.

- [ ] **Step 6: Write the integration test against the fake ssh-mcp**

Create `plugins/resource-manager/server/remote/sessions.posix.test.ts`:

```ts
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SshServer } from "./discovery.js";
import { startMcpStdioClient } from "./mcp-stdio-client.js";
import { REMOTE_COMMAND } from "./remote-output.js";
import { REMOTE_OUTPUT_SAMPLE, REMOTE_SNAPSHOT_SAMPLE } from "./remote-output-sample.js";
import { nodeTimers, RemoteSessions, type StartClient } from "./sessions.js";

const FAKE = fileURLToPath(new URL("../../test/fake-ssh-mcp.mjs", import.meta.url));

let dir: string;
let runDir: string;
let remote: RemoteSessions;

const startClient: StartClient = (server, signal) =>
  startMcpStdioClient(
    { command: server.command, args: server.args, env: server.env },
    {
      runDir,
      name: server.id,
      procRoot: "/proc",
      baseEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      startTimeoutMs: 10_000,
      requestTimeoutMs: 10_000,
    },
    signal,
  );

function fakeServer(env: Record<string, string>): SshServer {
  return {
    id: "0123456789abcdef",
    name: "fake-box",
    source: "test",
    command: process.execPath,
    args: [FAKE],
    env,
    missingVariables: [],
    fingerprint: JSON.stringify(env),
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rm-sessions-posix-"));
  runDir = join(dir, "run");
  remote = new RemoteSessions({
    runDir,
    procRoot: "/proc",
    startClient,
    timers: nodeTimers,
    log: () => {},
  });
});

afterEach(async () => {
  await remote.closeAll();
  rmSync(dir, { recursive: true, force: true });
});

describe("RemoteSessions with a real MCP client", () => {
  it("reads a server through ssh-mcp 2.x's run-command and stops it on closeAll", async () => {
    const outputFile = join(dir, "output.txt");
    const callLog = join(dir, "calls.jsonl");
    writeFileSync(outputFile, REMOTE_OUTPUT_SAMPLE);
    const server = fakeServer({
      FAKE_SSH_MCP_TOOL: "read-command,run-command",
      FAKE_SSH_MCP_STDERR: "warning: setlocale: LC_ALL: cannot change locale",
      FAKE_SSH_MCP_OUTPUT_FILE: outputFile,
      FAKE_SSH_MCP_CALL_LOG: callLog,
    });

    const reading = await remote.read(server);

    expect(reading).toMatchObject({ snapshot: REMOTE_SNAPSHOT_SAMPLE, error: null });
    expect(readFileSync(callLog, "utf8")).toBe(
      `${JSON.stringify({ name: "run-command", arguments: { command: REMOTE_COMMAND } })}\n`,
    );
    expect(readdirSync(runDir)).toHaveLength(1);

    await remote.closeAll();
    expect(readdirSync(runDir)).toEqual([]);
  });

  it("shows ssh-mcp's last stderr line when it exits on start", async () => {
    const reading = await remote.read(fakeServer({ FAKE_SSH_MCP_EXIT_ON_START: "3" }));

    expect(reading).toEqual({
      id: "0123456789abcdef",
      snapshot: null,
      readAt: null,
      error: "ssh-mcp exited (code 3): fatal: could not connect to 10.0.0.9",
    });
    expect(readdirSync(runDir)).toEqual([]);
  });
});
```

- [ ] **Step 7: Run the integration test and confirm it passes**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/remote/sessions.posix.test.ts --bail=1
```

Expected: PASS, 2 tests.

- [ ] **Step 8: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/resource-manager/server/remote/sessions.ts plugins/resource-manager/server/remote/fakes.ts plugins/resource-manager/server/remote/sessions.test.ts plugins/resource-manager/server/remote/sessions.posix.test.ts
cd /workspace/utils/paseo && npm run lint -- plugins/resource-manager
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: oxfmt exits 0; `Found 0 warnings and 0 errors.`; typecheck exit 0. The typecheck also proves `McpStdioClient` fits `SessionClient` (Task 11 passes one where the other is expected). Re-run Steps 5 and 7 if oxfmt changed a file.

- [ ] **Step 9: Commit**

```bash
P="plugins/resource-manager/server/remote/sessions.ts plugins/resource-manager/server/remote/fakes.ts plugins/resource-manager/server/remote/sessions.test.ts plugins/resource-manager/server/remote/sessions.posix.test.ts"
git -C /workspace/utils/paseo add $P
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): resource-manager remote sessions with deadline and idle close" -- $P
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo status --short --untracked-files=all -- $P
```

Expected: the hook passes; `4 files changed`; the fork identity; `status` prints nothing.

---

### Task 11: Wiring: createResourceManager and the server entry

**Files:**

- Create: `plugins/resource-manager/server/plugin.ts`
- Test: `plugins/resource-manager/server/plugin.test.ts`
- Modify: `plugins/resource-manager/index.server.ts` (replace the Task 1 stub)

**Interfaces:**

- Consumes:
  - `PluginServerContext.handle(contract, handler: (input, context: PluginHandlerContext) => Output | Promise<Output>): void` (`packages/plugin/src/server/contracts.ts:58-64`); `PluginServerContribution = (server: PluginServerContext) => PluginCleanup` (`:69`), `PluginCleanup = () => void | Promise<void>` (`packages/plugin/src/contracts.ts:98`). Handlers must be registered before `contribute` returns (the runtime snapshots them at "ready", as `plugins/shared-mcp/server/plugin.ts:44-47` notes), and the daemon waits about 2 s for an in-process plugin's cleanup (`plugins/shared-mcp/server/plugin.ts:83-85`).
  - `localRpc`, `serversRpc`, `serverRpc`, `closeAgentRpc` and payload types (Task 1); `paseoPorts`, `listLiveAgents`, `listWorkspaceDirectories`, `closeIdleAgent`, `FakeAgents`, `FakeWorkspaces` (Task 6); `LocalReader` (Task 6); `claudeConfigFile`, `resourceManagerRunDir`, `sharedMcpRunDir` (Task 4); `discoverSshServers` (Task 7); `startMcpStdioClient` (Task 9); `RemoteSessions`, `nodeTimers`, `StartClient`, `TimerPort`, `FakeStarter`, `FakeTimers`, `SHUTDOWN_MESSAGE` (Task 10); `writeFakeProc` (Task 4); `REMOTE_SNAPSHOT_SAMPLE` (Task 8).
- Produces:
  - `MCP_TIMING = { startTimeoutMs: 120_000, requestTimeoutMs: 70_000 }`, `DISCOVERY_TTL_MS = 60_000`, `UNKNOWN_SERVER_MESSAGE`
  - `interface ResourceManagerOptions { env; home; procRoot; cgroupRoot; daemonPid; cores; now(); sleep(ms); timers: TimerPort; log(message: string): void; startClient?: StartClient }`
  - `interface ResourceManager { local(ports: PaseoPorts): Promise<LocalReading>; servers(ports: PaseoPorts): Promise<ServerList>; server(ports: PaseoPorts, id: string): Promise<ServerReading>; closeAgent(ports: PaseoPorts, agentId: string): Promise<CloseAgentResult>; stop(): Promise<void> }`
  - `createResourceManager(options: ResourceManagerOptions): ResourceManager`
  - `plugins/resource-manager/index.server.ts`: `export default function contribute(server: PluginServerContext): () => Promise<void>`, registering the four handlers.

- [ ] **Step 1: Write the failing wiring tests**

Create `plugins/resource-manager/server/plugin.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { writeFakeProc, type FakePidSpace } from "./local/fake-proc.js";
import { FakeAgents, FakeWorkspaces } from "./fake-ports.js";
import type { PaseoPorts } from "./paseo-ports.js";
import { createResourceManager, UNKNOWN_SERVER_MESSAGE, type ResourceManager } from "./plugin.js";
import { FakeStarter, FakeTimers } from "./remote/fakes.js";
import { serverId } from "./remote/discovery.js";
import { REMOTE_SNAPSHOT_SAMPLE } from "./remote/remote-output-sample.js";
import { SHUTDOWN_MESSAGE } from "./remote/sessions.js";

const SPACE: FakePidSpace = { pidNamespace: "pid:[4026531836]", bootId: "boot-1" };

let root: string;
let home: string;
let project: string;
let agents: FakeAgents;
let workspaces: FakeWorkspaces;
let ports: PaseoPorts;
let starter: FakeStarter;
let timers: FakeTimers;
let logs: string[];
let manager: ResourceManager;

function writeJson(file: string, value: unknown): void {
  writeFileSync(file, `${JSON.stringify(value)}\n`);
}

function writeUserConfig(host: string): void {
  writeJson(join(home, ".claude.json"), {
    mcpServers: {
      "prod-box": {
        command: "npx",
        args: ["ssh-mcp", "-y", "--", `--host=${host}`, "--password=hunter2"],
      },
      context7: { command: "npx", args: ["-y", "@upstash/context7-mcp"] },
    },
  });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "rm-plugin-"));
  home = join(root, "home");
  project = join(root, "project");
  mkdirSync(home);
  mkdirSync(project);
  writeFakeProc(
    join(root, "proc"),
    [
      { pid: 1, ppid: 0, startTime: 10 },
      { pid: 164, ppid: 1, startTime: 200, rssKb: 286020 },
      { pid: 300, ppid: 164, startTime: 3000, rssKb: 307200, env: { PASEO_AGENT_ID: "agent-a" } },
    ],
    SPACE,
  );
  writeUserConfig("10.0.0.1");
  writeJson(join(project, ".mcp.json"), {
    mcpServers: { "db-box": { command: "/opt/ssh-mcp/bin/ssh-mcp", args: ["--host=db"] } },
  });
  agents = new FakeAgents([
    {
      id: "agent-a",
      title: "Fix login",
      provider: "claude",
      status: "idle",
      updatedAt: "2026-11-06T08:50:00.000Z",
      persistence: { sessionId: "session-a" },
    },
  ]);
  workspaces = new FakeWorkspaces([{ projectRootPath: project }]);
  ports = { agents, workspaces };
  starter = new FakeStarter();
  timers = new FakeTimers();
  logs = [];
  manager = createResourceManager({
    env: { PASEO_HOME: join(root, "paseo-home") },
    home,
    procRoot: join(root, "proc"),
    cgroupRoot: join(root, "no-cgroup"),
    daemonPid: 164,
    cores: 2,
    now: () => timers.now(),
    sleep: () => Promise.resolve(),
    timers,
    log: (message) => logs.push(message),
    startClient: starter.start,
  });
});

afterEach(async () => {
  await manager.stop();
  rmSync(root, { recursive: true, force: true });
});

describe("createResourceManager", () => {
  it("reads this instance with the live agents from the SDK", async () => {
    const reading = await manager.local(ports);

    expect(reading.agents.map((agent) => [agent.agentId, agent.rssBytes])).toEqual([
      ["agent-a", 307200 * 1024],
    ]);
    expect(reading.groups.find((group) => group.kind === "daemon")?.rssBytes).toBe(286020 * 1024);
    expect(agents.requests[0].includeBackground).toBe(true);
  });

  it("lists ssh-mcp servers by id, name and source only, and caches the list for 60 s", async () => {
    const list = await manager.servers(ports);

    expect(list).toEqual({
      servers: [
        { id: serverId("user", "prod-box"), name: "prod-box", source: "User config" },
        {
          id: serverId(`project:${join(project, ".mcp.json")}`, "db-box"),
          name: "db-box",
          source: join(project, ".mcp.json"),
        },
      ],
      problems: [],
    });
    expect(JSON.stringify(list)).not.toContain("hunter2");

    rmSync(join(project, ".mcp.json"));
    timers.advance(59_000);
    await expect(manager.servers(ports)).resolves.toEqual(list);
    timers.advance(1_000);
    await expect(manager.servers(ports)).resolves.toMatchObject({
      servers: [{ name: "prod-box" }],
    });
    expect(workspaces.requests).toHaveLength(2);
  });

  it("reads a configured server and refuses an unknown id", async () => {
    await expect(manager.server(ports, serverId("user", "prod-box"))).resolves.toEqual({
      id: serverId("user", "prod-box"),
      snapshot: REMOTE_SNAPSHOT_SAMPLE,
      readAt: "2026-11-06T09:00:00.000Z",
      error: null,
    });
    expect(starter.started[0].server.args).toContain("--host=10.0.0.1");

    await expect(manager.server(ports, "ffffffffffffffff")).resolves.toEqual({
      id: "ffffffffffffffff",
      snapshot: null,
      readAt: null,
      error: UNKNOWN_SERVER_MESSAGE,
    });
    expect(starter.started).toHaveLength(1);
  });

  it("restarts a server's session when its config changes", async () => {
    const id = serverId("user", "prod-box");
    await manager.server(ports, id);

    writeUserConfig("10.0.0.2");
    timers.advance(60_000);
    await manager.server(ports, id);

    expect(starter.clients[0].closed).toBe(true);
    expect(starter.started[1].server.args).toContain("--host=10.0.0.2");
  });

  it("shows user-scope servers when the workspace list fails, and logs that problem once", async () => {
    workspaces.listError = new Error("daemon unavailable");

    const first = await manager.servers(ports);
    timers.advance(60_000);
    const second = await manager.servers(ports);

    expect(first.servers.map((entry) => entry.name)).toEqual(["prod-box"]);
    expect(second.problems).toEqual(["Unable to list workspaces: daemon unavailable"]);
    expect(logs).toEqual(["resource-manager: Unable to list workspaces: daemon unavailable"]);
  });

  it("closes an idle agent's runtime through the SDK", async () => {
    await expect(manager.closeAgent(ports, "agent-a")).resolves.toEqual({ ok: true, error: null });
    expect(agents.closed).toEqual(["agent-a"]);
  });

  it("stop() closes every session, and later reads get the shutdown message", async () => {
    const id = serverId("user", "prod-box");
    await manager.server(ports, id);

    await manager.stop();

    expect(starter.clients[0].closeCount).toBe(1);
    await expect(manager.server(ports, id)).resolves.toMatchObject({ error: SHUTDOWN_MESSAGE });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/plugin.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './plugin.js'`.

- [ ] **Step 3: Write the wiring**

Create `plugins/resource-manager/server/plugin.ts`:

```ts
import type { CloseAgentResult, LocalReading, ServerList, ServerReading } from "../shared/rpc.js";
import { LocalReader } from "./local/local-reader.js";
import {
  closeIdleAgent,
  listLiveAgents,
  listWorkspaceDirectories,
  type PaseoPorts,
} from "./paseo-ports.js";
import { claudeConfigFile, resourceManagerRunDir, sharedMcpRunDir } from "./paths.js";
import { discoverSshServers, type Discovery } from "./remote/discovery.js";
import { startMcpStdioClient } from "./remote/mcp-stdio-client.js";
import { RemoteSessions, type StartClient, type TimerPort } from "./remote/sessions.js";

// Start: the first npx run downloads ssh-mcp. Request: ssh-mcp's own command timeout is 60 s.
export const MCP_TIMING = { startTimeoutMs: 120_000, requestTimeoutMs: 70_000 } as const;
export const DISCOVERY_TTL_MS = 60_000;
export const UNKNOWN_SERVER_MESSAGE = "No ssh-mcp server with this id is configured any more";

export interface ResourceManagerOptions {
  env: NodeJS.ProcessEnv;
  home: string;
  procRoot: string;
  cgroupRoot: string;
  daemonPid: number;
  cores: number;
  now(): number;
  sleep(ms: number): Promise<void>;
  timers: TimerPort;
  log(message: string): void;
  /** Starts an ssh-mcp client. Tests pass a fake; the default spawns the configured command. */
  startClient?: StartClient;
}

export interface ResourceManager {
  local(ports: PaseoPorts): Promise<LocalReading>;
  servers(ports: PaseoPorts): Promise<ServerList>;
  server(ports: PaseoPorts, id: string): Promise<ServerReading>;
  closeAgent(ports: PaseoPorts, agentId: string): Promise<CloseAgentResult>;
  stop(): Promise<void>;
}

interface CachedDiscovery {
  at: number;
  discovery: Promise<Discovery>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createResourceManager(options: ResourceManagerOptions): ResourceManager {
  const { env, home } = options;
  const runDir = resourceManagerRunDir(env, home);
  const reader = new LocalReader({
    procRoot: options.procRoot,
    cgroupRoot: options.cgroupRoot,
    sharedMcpRunDir: sharedMcpRunDir(env, home),
    daemonPid: options.daemonPid,
    cores: options.cores,
    now: options.now,
    sleep: options.sleep,
  });
  const startClient: StartClient =
    options.startClient ??
    ((server, signal) =>
      startMcpStdioClient(
        { command: server.command, args: server.args, env: server.env },
        {
          runDir,
          name: server.id,
          procRoot: options.procRoot,
          baseEnv: env,
          startTimeoutMs: MCP_TIMING.startTimeoutMs,
          requestTimeoutMs: MCP_TIMING.requestTimeoutMs,
        },
        signal,
      ));
  // The only work at start: reclaiming ssh-mcp groups a dead daemon left (decision 16).
  const sessions = new RemoteSessions({
    runDir,
    procRoot: options.procRoot,
    startClient,
    timers: options.timers,
    log: options.log,
  });
  const loggedProblems = new Set<string>();
  let cached: CachedDiscovery | null = null;

  async function findServers(ports: PaseoPorts): Promise<Discovery> {
    const problems: string[] = [];
    let directories: string[] = [];
    try {
      directories = await listWorkspaceDirectories(ports.workspaces);
    } catch (error) {
      problems.push(`Unable to list workspaces: ${errorMessage(error)}`);
    }
    const found = await discoverSshServers({
      claudeConfigFile: claudeConfigFile(env, home),
      workspaceDirectories: directories,
      env,
    });
    const all = [...problems, ...found.problems];
    for (const problem of all) {
      if (loggedProblems.has(problem)) continue;
      loggedProblems.add(problem);
      options.log(`resource-manager: ${problem}`);
    }
    return { servers: found.servers, problems: all };
  }

  function discover(ports: PaseoPorts): Promise<Discovery> {
    if (cached !== null && options.now() - cached.at < DISCOVERY_TTL_MS) return cached.discovery;
    const entry: CachedDiscovery = { at: options.now(), discovery: findServers(ports) };
    cached = entry;
    // A failed discovery is not kept: the next call tries again.
    entry.discovery.catch(() => {
      if (cached === entry) cached = null;
    });
    return entry.discovery;
  }

  return {
    local: (ports) => reader.read(() => listLiveAgents(ports.agents)),
    async servers(ports) {
      const { servers, problems } = await discover(ports);
      return {
        servers: servers.map((server) => ({
          id: server.id,
          name: server.name,
          source: server.source,
        })),
        problems,
      };
    },
    async server(ports, id) {
      const { servers } = await discover(ports);
      const server = servers.find((candidate) => candidate.id === id);
      if (server === undefined)
        return { id, snapshot: null, readAt: null, error: UNKNOWN_SERVER_MESSAGE };
      return sessions.read(server);
    },
    closeAgent: (ports, agentId) => closeIdleAgent(ports.agents, agentId),
    stop: () => sessions.closeAll(),
  };
}
```

`discover` caches the promise, so two tabs asking at once share one read of the config files. The `.catch` only clears the cache; the caller still gets the rejection (the handler then fails that RPC, which the client shows as an error).

- [ ] **Step 4: Run the wiring tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/server/plugin.test.ts --bail=1
```

Expected: PASS, 7 tests.

- [ ] **Step 5: Replace the server entry**

Replace `plugins/resource-manager/index.server.ts` with:

```ts
import { availableParallelism, homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { paseoPorts } from "./server/paseo-ports.js";
import { createResourceManager } from "./server/plugin.js";
import { nodeTimers } from "./server/remote/sessions.js";
import { closeAgentRpc, localRpc, serverRpc, serversRpc } from "./shared/rpc.js";

// Runs inside the daemon: process.pid is the daemon worker, and process.env is the daemon's env
// (PASEO_* is stripped before anything is spawned).
export default function contribute(server: PluginServerContext): () => Promise<void> {
  const manager = createResourceManager({
    env: process.env,
    home: homedir(),
    procRoot: "/proc",
    cgroupRoot: "/sys/fs/cgroup",
    daemonPid: process.pid,
    cores: availableParallelism(),
    now: () => Date.now(),
    sleep: (ms) => delay(ms, undefined, { ref: false }),
    timers: nodeTimers,
    log: (message) => console.error(message),
  });
  server.handle(localRpc, (_input, context) => manager.local(paseoPorts(context.paseo)));
  server.handle(serversRpc, (_input, context) => manager.servers(paseoPorts(context.paseo)));
  server.handle(serverRpc, ({ id }, context) => manager.server(paseoPorts(context.paseo), id));
  server.handle(closeAgentRpc, ({ agentId }, context) =>
    manager.closeAgent(paseoPorts(context.paseo), agentId),
  );
  // Signals every ssh-mcp group at once; a group that outlives the daemon's ~2 s wait is
  // reclaimed from its pid file at the next start.
  return () => manager.stop();
}
```

- [ ] **Step 6: Run the built-in compile test**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts --bail=1
```

Expected: PASS, 4 tests. The compile step bundles `index.server.ts` and everything it imports, so a stray import (another plugin's file, a package outside the allow-list) fails here with `moduleBoundaryError`'s message.

- [ ] **Step 7: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/resource-manager/server/plugin.ts plugins/resource-manager/server/plugin.test.ts plugins/resource-manager/index.server.ts
cd /workspace/utils/paseo && npm run lint -- plugins/resource-manager
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: oxfmt exits 0; `Found 0 warnings and 0 errors.`; typecheck exit 0. The typecheck is the proof that `paseoPorts(context.paseo)` fits and that each handler returns its contract's output type. Re-run Step 4 if oxfmt changed a file.

- [ ] **Step 8: Commit**

```bash
P="plugins/resource-manager/server/plugin.ts plugins/resource-manager/server/plugin.test.ts plugins/resource-manager/index.server.ts"
git -C /workspace/utils/paseo add $P
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): resource-manager RPC handlers" -- $P
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo status --short --untracked-files=all -- $P
```

Expected: the hook passes; `3 files changed`; the fork identity; `status` prints nothing.

---

### Task 12: Client: sidebar item, Resources screen, instance and server tabs

**Files:**

- Create: `plugins/resource-manager/client/format.ts`
- Test: `plugins/resource-manager/client/format.test.ts`
- Create: `plugins/resource-manager/client/styles.ts`
- Create: `plugins/resource-manager/client/instance-tab.tsx`
- Create: `plugins/resource-manager/client/server-tab.tsx`
- Create: `plugins/resource-manager/client/resources-screen.tsx`
- Create: `plugins/resource-manager/index.client.tsx`

**Interfaces:**

- Consumes:
  - `PluginClientContext.addScreen(contribution: PluginScreenContribution<PluginText>): PluginCleanup` and `addSidebarHeaderItem(contribution: PluginSidebarItemContribution<PluginText>): PluginCleanup` (`packages/plugin/src/client/contracts.ts:187-188`); `PluginScreenContribution { id; title; Component: ComponentType<PluginScreenProps> }` (`:258-262`); `PluginScreenProps { theme; host: { id; label }; layout; navigation?; params }` (`:30-40`, `:74-77`); `PluginSidebarItemProps { currentScreen: PluginScreenLocation | null; openScreen(input: PluginOpenScreenInput): void; openPopover(...) }` (`:84-90`).
  - `useRpc(contract): (input) => Promise<Output>` (`packages/plugin/src/client/rpc-context.tsx:53-64`), exported from `@getpaseo/plugin/client` (`packages/plugin/src/client/index.ts:74`).
  - `@getpaseo/plugin/client/ui` (`packages/plugin/src/client/ui.ts`): `ScrollView` (`:75-77`), `SettingsSection { title; children }` (`:89-95`, `:136`), `SettingsCard` (`:137`), `SettingsRow { label; hint?; error?; children? }` (`:96-102`, `:138`), `SettingsAction { actionLabel; onPress(); disabled? }` (`:128-132`, `:144`), `SidebarRow { id?; icon?; label?; onPress(); active?; trailing? }` (`:156-172`).
  - `PluginTheme.colors` (`packages/plugin/src/contracts.ts:6-19`): `foreground`, `foregroundMuted`, `surface2`, `statusDanger`. It has no `surface3`, and the plugin UI kit (`packages/plugin/src/client/ui.ts`) exports no `Button` or `SegmentedControl`, so the tabs are `Pressable`s styled as segments.
  - `@tanstack/react-query` `useQuery`, `useMutation`, `useQueryClient`, as in `plugins/shared-mcp/client/servers-screen.tsx:1`.
  - The RPC contracts and payload types (Task 1).
- Produces:
  - `client/format.ts`: `interface Row { key: string; label: string; value: string }`, `formatBytes(bytes: number): string`, `formatShare(used: number, total: number): string`, `formatCpu(percent: number | null): string`, `formatDuration(ms: number): string`, `formatClock(iso: string): string`, `formatLoad(load1, load5, load15: number, cores: number): string`, `groupLabel(kind: GroupKind): string`, `agentLabel(agent: AgentUsage): string`, `describeAgent(agent: AgentUsage, now: number): string`, `describeGroup(group: GroupUsage): string`, `hostRows(host: HostSummary): Row[]`, `serverRows(snapshot: RemoteSnapshot): Row[]`, `mountRow(mount: MountUsage): Row`, `processRow(entry: RemoteProcess): Row`
  - `client/styles.ts`: `interface ScreenStyles`, `useScreenStyles(theme: PluginTheme): ScreenStyles`
  - `client/instance-tab.tsx`: `InstanceTab({ hostId, styles })`; `client/server-tab.tsx`: `ServerTab({ server, hostId, styles })`; `client/resources-screen.tsx`: `ResourcesScreen(props: PluginScreenProps)`
  - `index.client.tsx`: screen `resources` titled "Resources", sidebar header item `resources` with a `Gauge` `SidebarRow`. Route: `/h/<serverId>/plugin/resource-manager/surface/resources`.

Copy follows `docs/design.md` section 10: sentence case, no trailing period on labels, hints and single-clause messages, `...` (three dots) for in-flight labels.

- [ ] **Step 1: Write the failing format tests**

Create `plugins/resource-manager/client/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentUsage, GroupUsage, HostSummary, RemoteSnapshot } from "../shared/rpc.js";
import {
  agentLabel,
  describeAgent,
  describeGroup,
  formatBytes,
  formatClock,
  formatCpu,
  formatDuration,
  formatLoad,
  formatShare,
  groupLabel,
  hostRows,
  mountRow,
  processRow,
  serverRows,
} from "./format.js";

const KIB = 1024;
const GIB = 1024 ** 3;

const AGENT: AgentUsage = {
  agentId: "agent-a",
  title: "Fix login",
  provider: "claude",
  status: "idle",
  rssBytes: 512000 * KIB,
  cpuPercent: 200,
  idleSince: "2026-11-06T08:50:00.000Z",
  processCount: 2,
};

const HOST: HostSummary = {
  memoryUsedBytes: 3 * GIB,
  memoryLimitBytes: 8 * GIB,
  swapUsedBytes: 0,
  swapTotalBytes: 12 * GIB,
  hostAvailableBytes: 7 * GIB,
  hostTotalBytes: 15 * GIB,
  load1: 1.54,
  load5: 1.88,
  load15: 2.22,
  cores: 2,
};

const NO_HOST: HostSummary = {
  memoryUsedBytes: null,
  memoryLimitBytes: null,
  swapUsedBytes: null,
  swapTotalBytes: null,
  hostAvailableBytes: null,
  hostTotalBytes: null,
  load1: null,
  load5: null,
  load15: null,
  cores: 2,
};

const SNAPSHOT: RemoteSnapshot = {
  memTotalBytes: 16042308 * KIB,
  memAvailableBytes: 7923328 * KIB,
  swapTotalBytes: 12582908 * KIB,
  swapFreeBytes: 6615380 * KIB,
  load1: 3.08,
  load5: 2.5,
  load15: 2.53,
  cores: 2,
  mounts: [],
  processes: [],
};

describe("formatBytes", () => {
  it("uses 1024 steps and one decimal under 10", () => {
    expect([512, 1536, 812 * 1024 ** 2, 15 * GIB, 3 * GIB].map(formatBytes)).toEqual([
      "512 B",
      "1.5 KB",
      "812 MB",
      "15 GB",
      "3.0 GB",
    ]);
  });
});

describe("small formatters", () => {
  it("formats shares, CPU, durations, clock times and load", () => {
    expect(formatShare(3 * GIB, 8 * GIB)).toBe("3.0 GB of 8.0 GB (38%)");
    expect(formatCpu(12.25)).toBe("12.3% CPU");
    expect(formatCpu(null)).toBe("CPU unknown");
    expect([30_000, 601_000, 3_900_000, 90_000_000].map(formatDuration)).toEqual([
      "under a minute",
      "10 min",
      "1 h 5 min",
      "1 d 1 h",
    ]);
    expect(formatClock(new Date(2026, 10, 6, 9, 5, 3).toISOString())).toBe("09:05:03");
    expect(formatLoad(1.54, 1.88, 2.22, 2)).toBe("1.54, 1.88, 2.22 on 2 cores");
    expect(formatLoad(0.5, 0.25, 0, 1)).toBe("0.50, 0.25, 0.00 on 1 core");
  });
});

describe("agent and group text", () => {
  it("labels agents and groups", () => {
    expect(agentLabel(AGENT)).toBe("Fix login");
    expect(agentLabel({ ...AGENT, title: null })).toBe("Untitled agent");
    expect(
      (["daemon", "sharedMcp", "heavyGate", "other"] as const).map((kind) => groupLabel(kind)),
    ).toEqual([
      "Paseo daemon and terminals",
      "Shared MCP servers",
      "Heavy commands",
      "Everything else",
    ]);
  });

  it("describes an idle agent with its idle time, and a running one without", () => {
    const now = Date.parse("2026-11-06T09:00:01.000Z");

    expect(describeAgent(AGENT, now)).toBe(
      "claude, 2 processes, 500 MB, 200.0% CPU, idle for 10 min",
    );
    expect(
      describeAgent({ ...AGENT, status: "running", idleSince: null, processCount: 1 }, now),
    ).toBe("claude, 1 process, 500 MB, 200.0% CPU, running");
  });

  it("describes a group", () => {
    const group: GroupUsage = {
      kind: "daemon",
      rssBytes: 285872 * KIB,
      cpuPercent: 0,
      processCount: 3,
    };

    expect(describeGroup(group)).toBe("3 processes, 279 MB, 0.0% CPU");
  });
});

describe("host rows", () => {
  it("shows the container against its cap, swap, host memory and load", () => {
    expect(hostRows(HOST).map((row) => [row.label, row.value])).toEqual([
      ["Container memory", "3.0 GB of 8.0 GB (38%)"],
      ["Swap", "0 B of 12 GB (0%)"],
      ["Available host memory", "7.0 GB of 15 GB"],
      ["Load", "1.54, 1.88, 2.22 on 2 cores"],
    ]);
  });

  it("says what is missing: no cgroup, no cap, no swap", () => {
    expect(hostRows(NO_HOST).map((row) => row.value)).toEqual([
      "Not available",
      "Not available",
      "Not available",
      "Not available",
    ]);
    const uncapped: HostSummary = { ...HOST, memoryLimitBytes: null, swapTotalBytes: 0 };
    expect(
      hostRows(uncapped)
        .map((row) => row.value)
        .slice(0, 2),
    ).toEqual(["3.0 GB used, no cap", "No swap"]);
  });
});

describe("server rows", () => {
  it("shows memory, swap and load, then one row per mount and process", () => {
    expect(serverRows(SNAPSHOT).map((row) => [row.label, row.value])).toEqual([
      ["Memory", "7.7 GB of 15 GB (51%)"],
      ["Swap", "5.7 GB of 12 GB (47%)"],
      ["Load", "3.08, 2.50, 2.53 on 2 cores"],
    ]);
    expect(
      mountRow({
        mount: "/",
        totalBytes: 151263856 * KIB,
        usedBytes: 107824412 * KIB,
        availableBytes: 43423060 * KIB,
      }),
    ).toEqual({ key: "/", label: "/", value: "103 GB of 144 GB (71%)" });
    expect(processRow({ pid: 164, rssBytes: 285872 * KIB, command: "Paseo Daemon" })).toEqual({
      key: "164",
      label: "Paseo Daemon",
      value: "279 MB, pid 164",
    });
  });
});
```

- [ ] **Step 2: Run them and confirm they fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/client/format.test.ts --bail=1
```

Expected: FAIL, `Cannot find module './format.js'`.

- [ ] **Step 3: Write the formatters**

Create `plugins/resource-manager/client/format.ts`:

```ts
import type {
  AgentUsage,
  GroupKind,
  GroupUsage,
  HostSummary,
  LiveStatus,
  MountUsage,
  RemoteProcess,
  RemoteSnapshot,
} from "../shared/rpc.js";

// Row text for the Resources screen. docs/design.md section 10: sentence case, no trailing period.

export interface Row {
  key: string;
  label: string;
  value: string;
}

const UNITS = ["B", "KB", "MB", "GB", "TB"];
const NOT_AVAILABLE = "Not available";

const GROUP_LABELS: Record<GroupKind, string> = {
  daemon: "Paseo daemon and terminals",
  sharedMcp: "Shared MCP servers",
  heavyGate: "Heavy commands",
  other: "Everything else",
};

const STATE_LABELS: Record<LiveStatus, string> = {
  initializing: "starting",
  idle: "idle",
  running: "running",
  error: "stopped with an error",
};

export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const shown = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${shown} ${UNITS[unit]}`;
}

export function formatShare(used: number, total: number): string {
  if (total <= 0) return formatBytes(used);
  return `${formatBytes(used)} of ${formatBytes(total)} (${Math.round((used / total) * 100)}%)`;
}

export function formatCpu(percent: number | null): string {
  return percent === null ? "CPU unknown" : `${percent.toFixed(1)}% CPU`;
}

export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "under a minute";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ${minutes % 60} min`;
  return `${Math.floor(hours / 24)} d ${hours % 24} h`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

/** Local wall-clock time, HH:MM:SS. */
export function formatClock(iso: string): string {
  const date = new Date(iso);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function formatLoad(load1: number, load5: number, load15: number, cores: number): string {
  const loads = [load1, load5, load15].map((load) => load.toFixed(2)).join(", ");
  return `${loads} on ${cores} ${cores === 1 ? "core" : "cores"}`;
}

export function groupLabel(kind: GroupKind): string {
  return GROUP_LABELS[kind];
}

export function agentLabel(agent: AgentUsage): string {
  return agent.title ?? "Untitled agent";
}

function processCount(count: number): string {
  return count === 1 ? "1 process" : `${count} processes`;
}

function agentState(agent: AgentUsage, now: number): string {
  if (agent.status !== "idle" || agent.idleSince === null) return STATE_LABELS[agent.status];
  return `idle for ${formatDuration(Math.max(0, now - Date.parse(agent.idleSince)))}`;
}

/** `now` is the reading's own time, so the idle time does not depend on this device's clock. */
export function describeAgent(agent: AgentUsage, now: number): string {
  return [
    agent.provider,
    processCount(agent.processCount),
    formatBytes(agent.rssBytes),
    formatCpu(agent.cpuPercent),
    agentState(agent, now),
  ].join(", ");
}

export function describeGroup(group: GroupUsage): string {
  return [
    processCount(group.processCount),
    formatBytes(group.rssBytes),
    formatCpu(group.cpuPercent),
  ].join(", ");
}

function containerMemory(host: HostSummary): string {
  if (host.memoryUsedBytes === null) return NOT_AVAILABLE;
  if (host.memoryLimitBytes === null) return `${formatBytes(host.memoryUsedBytes)} used, no cap`;
  return formatShare(host.memoryUsedBytes, host.memoryLimitBytes);
}

function swap(used: number | null, total: number | null): string {
  if (total === 0) return "No swap";
  if (used === null || total === null) return NOT_AVAILABLE;
  return formatShare(used, total);
}

function hostAvailable(host: HostSummary): string {
  if (host.hostAvailableBytes === null || host.hostTotalBytes === null) return NOT_AVAILABLE;
  return `${formatBytes(host.hostAvailableBytes)} of ${formatBytes(host.hostTotalBytes)}`;
}

function hostLoad(host: HostSummary): string {
  if (host.load1 === null || host.load5 === null || host.load15 === null) return NOT_AVAILABLE;
  return formatLoad(host.load1, host.load5, host.load15, host.cores);
}

export function hostRows(host: HostSummary): Row[] {
  return [
    { key: "memory", label: "Container memory", value: containerMemory(host) },
    { key: "swap", label: "Swap", value: swap(host.swapUsedBytes, host.swapTotalBytes) },
    { key: "available", label: "Available host memory", value: hostAvailable(host) },
    { key: "load", label: "Load", value: hostLoad(host) },
  ];
}

export function serverRows(snapshot: RemoteSnapshot): Row[] {
  const memoryUsed = snapshot.memTotalBytes - snapshot.memAvailableBytes;
  const swapUsed = snapshot.swapTotalBytes - snapshot.swapFreeBytes;
  return [
    { key: "memory", label: "Memory", value: formatShare(memoryUsed, snapshot.memTotalBytes) },
    { key: "swap", label: "Swap", value: swap(swapUsed, snapshot.swapTotalBytes) },
    {
      key: "load",
      label: "Load",
      value: formatLoad(snapshot.load1, snapshot.load5, snapshot.load15, snapshot.cores),
    },
  ];
}

export function mountRow(mount: MountUsage): Row {
  return {
    key: mount.mount,
    label: mount.mount,
    value: formatShare(mount.usedBytes, mount.totalBytes),
  };
}

export function processRow(entry: RemoteProcess): Row {
  return {
    key: String(entry.pid),
    label: entry.command,
    value: `${formatBytes(entry.rssBytes)}, pid ${entry.pid}`,
  };
}
```

- [ ] **Step 4: Run the format tests and confirm they pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/resource-manager/client/format.test.ts --bail=1
```

Expected: PASS, 8 tests. `formatClock` reads local time, and the test builds its input from local time, so it passes in any time zone.

- [ ] **Step 5: Write the styles**

Create `plugins/resource-manager/client/styles.ts`:

```ts
import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

export interface ScreenStyles {
  /** The scroll view's content: padded. */
  content: ViewStyle;
  /** A tab's body inside the content: spaced, not padded again. */
  stack: ViewStyle;
  tabs: ViewStyle;
  tab: ViewStyle;
  tabSelected: ViewStyle;
  tabLabel: TextStyle;
  tabLabelSelected: TextStyle;
  muted: TextStyle;
  error: TextStyle;
  /** SettingsCard has no padding of its own; its rows use 16. */
  block: ViewStyle;
}

/** Styles for the Resources screen, from the host theme. Typed, so no `as const` is needed. */
export function useScreenStyles(theme: PluginTheme): ScreenStyles {
  return useMemo(
    (): ScreenStyles => ({
      content: { padding: 16, gap: 16 },
      stack: { gap: 16 },
      tabs: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
      // The plugin UI kit has no SegmentedControl, so a tab is styled like one segment: the selected
      // one gets a quiet fill and foreground text, not an inverted accent fill, and no tab gets a
      // border of its own (docs/design.md sections 3-5). PluginTheme has no surface3, so the fill is
      // surface2, the sidebar's selected-row fill.
      tab: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
      tabSelected: {
        paddingVertical: 6,
        paddingHorizontal: 12,
        borderRadius: 6,
        backgroundColor: theme.colors.surface2,
      },
      tabLabel: { color: theme.colors.foregroundMuted },
      tabLabelSelected: { color: theme.colors.foreground },
      muted: { color: theme.colors.foregroundMuted },
      error: { color: theme.colors.statusDanger },
      block: { padding: 16, gap: 8 },
    }),
    [theme],
  );
}
```

- [ ] **Step 6: Write the instance tab**

Create `plugins/resource-manager/client/instance-tab.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
} from "@getpaseo/plugin/client/ui";
import { closeAgentRpc, isClosableStatus, localRpc, type AgentUsage } from "../shared/rpc.js";
import {
  agentLabel,
  describeAgent,
  describeGroup,
  formatClock,
  groupLabel,
  hostRows,
} from "./format.js";
import type { ScreenStyles } from "./styles.js";

const POLL_MS = 5_000;
// The SDK has no confirm dialog: the first press arms Close, a second within this window closes.
const CONFIRM_MS = 5_000;
const ARMED_HINT = "Press again within 5 s to end this agent's runtime; its next prompt resumes it";

export function localQueryKey(hostId: string) {
  return ["resource-manager", hostId, "local"] as const;
}

interface InstanceTabProps {
  hostId: string;
  styles: ScreenStyles;
}

interface AgentRowProps {
  agent: AgentUsage;
  /** The reading's time, for the idle figure. */
  now: number;
  hostId: string;
}

function closeLabel(pending: boolean, armed: boolean): string {
  if (pending) return "Closing...";
  return armed ? "Confirm close" : "Close";
}

function AgentRow({ agent, now, hostId }: AgentRowProps) {
  const callClose = useRpc(closeAgentRpc);
  const queryClient = useQueryClient();
  const [armed, setArmed] = useState(false);
  const close = useMutation({
    mutationFn: () => callClose({ agentId: agent.agentId }),
    // Refetch at once, so the freed memory shows without waiting for the next poll.
    onSettled: () => queryClient.invalidateQueries({ queryKey: localQueryKey(hostId) }),
  });
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const { mutate } = close;
  const press = useCallback(() => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    mutate();
  }, [armed, mutate]);
  const reply = close.data;
  const rejection = reply?.ok === false ? reply.error : null;
  return (
    <SettingsAction
      label={agentLabel(agent)}
      hint={armed ? ARMED_HINT : describeAgent(agent, now)}
      error={close.error?.message ?? rejection}
      actionLabel={closeLabel(close.isPending, armed)}
      disabled={!isClosableStatus(agent.status) || close.isPending}
      onPress={press}
    />
  );
}

export function InstanceTab({ hostId, styles }: InstanceTabProps) {
  const fetchLocal = useRpc(localRpc);
  // The interval belongs to the query observer, so polling stops when the tab unmounts. No
  // retries: the next poll is the retry.
  const reading = useQuery({
    queryKey: localQueryKey(hostId),
    queryFn: () => fetchLocal({}),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const data = reading.data;
  if (data === undefined) {
    if (reading.isError) {
      return (
        <Text accessibilityRole="alert" style={styles.error}>
          Unable to read this instance: {reading.error.message}
        </Text>
      );
    }
    return <Text style={styles.muted}>Reading this instance...</Text>;
  }
  const now = Date.parse(data.readAt);
  return (
    <View style={styles.stack}>
      <SettingsSection title="This instance">
        <SettingsCard>
          {hostRows(data.host).map((row) => (
            <SettingsRow key={row.key} label={row.label} hint={row.value} />
          ))}
          <SettingsRow
            label="Last reading"
            hint={formatClock(data.readAt)}
            error={reading.isError ? `Refresh failed: ${reading.error.message}` : null}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Agents">
        {data.agentsError === null ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            Unable to list agents: {data.agentsError}
          </Text>
        )}
        {data.agents.length === 0 ? <Text style={styles.muted}>No agent processes</Text> : null}
        {data.agents.length === 0 ? null : (
          <SettingsCard>
            {data.agents.map((agent) => (
              <AgentRow key={agent.agentId} agent={agent} now={now} hostId={hostId} />
            ))}
          </SettingsCard>
        )}
      </SettingsSection>
      <SettingsSection title="Groups">
        <SettingsCard>
          {data.groups.map((group) => (
            <SettingsRow
              key={group.kind}
              label={groupLabel(group.kind)}
              hint={describeGroup(group)}
            />
          ))}
        </SettingsCard>
      </SettingsSection>
    </View>
  );
}
```

- [ ] **Step 7: Write the server tab**

Create `plugins/resource-manager/client/server-tab.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { Text, View } from "react-native";
import { useRpc } from "@getpaseo/plugin/client";
import { SettingsCard, SettingsRow, SettingsSection } from "@getpaseo/plugin/client/ui";
import { serverRpc, type RemoteSnapshot, type ServerEntry } from "../shared/rpc.js";
import { formatClock, mountRow, processRow, serverRows } from "./format.js";
import type { ScreenStyles } from "./styles.js";

const POLL_MS = 30_000;

interface ServerTabProps {
  server: ServerEntry;
  hostId: string;
  styles: ScreenStyles;
}

interface SnapshotSectionsProps {
  snapshot: RemoteSnapshot;
  readAt: string | null;
}

function SnapshotSections({ snapshot, readAt }: SnapshotSectionsProps) {
  const mounts = snapshot.mounts.map(mountRow);
  const processes = snapshot.processes.map(processRow);
  return (
    <>
      <SettingsSection title="Server">
        <SettingsCard>
          {serverRows(snapshot).map((row) => (
            <SettingsRow key={row.key} label={row.label} hint={row.value} />
          ))}
          <SettingsRow
            label="Last reading"
            hint={readAt === null ? "None yet" : formatClock(readAt)}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Disks">
        <SettingsCard>
          {mounts.length === 0 ? <SettingsRow label="No disks reported" /> : null}
          {mounts.map((row) => (
            <SettingsRow key={row.key} label={row.label} hint={row.value} />
          ))}
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Top processes">
        <SettingsCard>
          {processes.map((row) => (
            <SettingsRow key={row.key} label={row.label} hint={row.value} />
          ))}
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

// Mounted only while its tab is selected, so the 30 s poll stops when the tab closes; the
// server's session then closes 2 minutes after the last read.
export function ServerTab({ server, hostId, styles }: ServerTabProps) {
  const fetchServer = useRpc(serverRpc);
  const reading = useQuery({
    queryKey: ["resource-manager", hostId, "server", server.id],
    queryFn: () => fetchServer({ id: server.id }),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const data = reading.data;
  const error = reading.isError ? reading.error.message : (data?.error ?? null);
  return (
    <View style={styles.stack}>
      <Text style={styles.muted}>{server.source}</Text>
      {data === undefined && !reading.isError ? (
        <Text style={styles.muted}>Reading {server.name}...</Text>
      ) : null}
      {error === null ? null : (
        <SettingsSection title="Unable to read this server">
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        </SettingsSection>
      )}
      {data?.snapshot ? <SnapshotSections snapshot={data.snapshot} readAt={data.readAt} /> : null}
    </View>
  );
}
```

- [ ] **Step 8: Write the screen and its tab bar**

Create `plugins/resource-manager/client/resources-screen.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, type PluginScreenProps } from "@getpaseo/plugin/client";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { serversRpc, type ServerEntry } from "../shared/rpc.js";
import { InstanceTab } from "./instance-tab.js";
import { ServerTab } from "./server-tab.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

const INSTANCE_TAB = "instance";
const NO_SERVERS: readonly ServerEntry[] = [];
const NO_PROBLEMS: readonly string[] = [];
const SELECTED = { selected: true };
const UNSELECTED = { selected: false };

interface TabButtonProps {
  id: string;
  label: string;
  selected: boolean;
  onSelect(id: string): void;
  styles: ScreenStyles;
}

interface TabBarProps {
  servers: readonly ServerEntry[];
  selected: string;
  onSelect(id: string): void;
  styles: ScreenStyles;
}

function TabButton({ id, label, selected, onSelect, styles }: TabButtonProps) {
  const press = useCallback(() => onSelect(id), [id, onSelect]);
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={selected ? SELECTED : UNSELECTED}
      onPress={press}
      style={selected ? styles.tabSelected : styles.tab}
    >
      <Text style={selected ? styles.tabLabelSelected : styles.tabLabel}>{label}</Text>
    </Pressable>
  );
}

function TabBar({ servers, selected, onSelect, styles }: TabBarProps) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      <TabButton
        id={INSTANCE_TAB}
        label="This instance"
        selected={selected === INSTANCE_TAB}
        onSelect={onSelect}
        styles={styles}
      />
      {servers.map((server) => (
        <TabButton
          key={server.id}
          id={server.id}
          label={server.name}
          selected={selected === server.id}
          onSelect={onSelect}
          styles={styles}
        />
      ))}
    </View>
  );
}

export function ResourcesScreen({ theme, host }: PluginScreenProps) {
  const styles = useScreenStyles(theme);
  const fetchServers = useRpc(serversRpc);
  const [selected, setSelected] = useState(INSTANCE_TAB);
  // Fetched once per visit (decision 17): a config change shows on the next visit.
  const list = useQuery({
    queryKey: ["resource-manager", host.id, "servers"],
    queryFn: () => fetchServers({}),
    retry: false,
    refetchOnWindowFocus: false,
  });
  const servers = list.data?.servers ?? NO_SERVERS;
  const problems = list.data?.problems ?? NO_PROBLEMS;
  const current = servers.find((server) => server.id === selected);
  const shown = current === undefined ? INSTANCE_TAB : selected;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {servers.length > 0 ? (
        <TabBar servers={servers} selected={shown} onSelect={setSelected} styles={styles} />
      ) : null}
      {list.isError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          Unable to list ssh-mcp servers: {list.error.message}
        </Text>
      ) : null}
      {problems.map((problem) => (
        <Text key={problem} style={styles.muted}>
          {problem}
        </Text>
      ))}
      {current === undefined ? (
        <InstanceTab hostId={host.id} styles={styles} />
      ) : (
        <ServerTab key={current.id} server={current} hostId={host.id} styles={styles} />
      )}
    </ScrollView>
  );
}
```

- [ ] **Step 9: Write the client entry**

Create `plugins/resource-manager/index.client.tsx`:

```tsx
import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { ResourcesScreen } from "./client/resources-screen.js";

const SCREEN_ID = "resources";

function ResourcesItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: SCREEN_ID }), [openScreen]);
  return <SidebarRow icon="Gauge" active={currentScreen?.screenId === SCREEN_ID} onPress={open} />;
}

// The sidebar item is the way in: a built-in has no row in Settings > Plugins, and users can hide
// the item in Settings > Sidebar.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: "Resources", Component: ResourcesScreen }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Resources", Component: ResourcesItem }),
  ];
  return () => {
    for (const remove of removers) void remove();
  };
}
```

- [ ] **Step 10: Run the built-in compile test**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts --bail=1
```

Expected: PASS, 4 tests; the resource-manager entry now compiles a client bundle too (`client` is no longer `null`), with the client import allow-list enforced.

- [ ] **Step 11: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/resource-manager/client/format.ts plugins/resource-manager/client/format.test.ts plugins/resource-manager/client/styles.ts plugins/resource-manager/client/instance-tab.tsx plugins/resource-manager/client/server-tab.tsx plugins/resource-manager/client/resources-screen.tsx plugins/resource-manager/index.client.tsx
cd /workspace/utils/paseo && npm run lint -- plugins/resource-manager
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: oxfmt exits 0; `Found 0 warnings and 0 errors.` (the react-perf rules hold because every prop is a constant, a memoized style or a `useCallback`); typecheck exit 0. Re-run Step 4 if oxfmt changed `format.ts` or its test.

- [ ] **Step 12: Commit**

```bash
P="plugins/resource-manager/client/format.ts plugins/resource-manager/client/format.test.ts plugins/resource-manager/client/styles.ts plugins/resource-manager/client/instance-tab.tsx plugins/resource-manager/client/server-tab.tsx plugins/resource-manager/client/resources-screen.tsx plugins/resource-manager/index.client.tsx"
git -C /workspace/utils/paseo add $P
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): resource-manager Resources screen and sidebar item" -- $P
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo status --short --untracked-files=all -- $P
```

Expected: the hook passes; `7 files changed`; the fork identity; `status` prints nothing.

---

### Task 13: Docs and manual test on the dev daemon

**Files:**

- Modify: `docs/plugins.md` (section "Built-in plugins": three `resource-manager` paragraphs just before the "Local runs of ..." paragraph, which then names this built-in too. That paragraph is the heavy-command gate's five-line rewrite, since sub-project 2 lands first; Step 33 gives its text and stops if it finds the shared-mcp paragraph at `docs/plugins.md:135-137` instead)
- Test (manual, not committed): `.dev/paseo-home/plugin-settings/shared-mcp/servers.json` (gitignored dev home, seeded before the daemon starts)
- Scratch (outside the repo, not committed): `/tmp/rm-test.env`, `/tmp/rm-figures.js`, `/tmp/rm-remote.mts`, `/tmp/rm-http-server.js`, `/tmp/rm-ssh-bin/ssh-mcp`, `/tmp/rm-dev-password` (mode 0600, removed in Step 32), `/tmp/rm-build.out`, `/tmp/rm-dist.out`, `/tmp/rm-dist-home.*` (removed in Step 3), `/tmp/rm-remote-command.txt`, `/tmp/rm-remote-output.txt`, `/tmp/rm-remote-rows.txt`, `/tmp/rm-agent/` (agent cwd holding `.mcp.json` and `.claude/settings.local.json`), `/tmp/rm-mem-watch.pid`, `/tmp/rm-mem-low`, `/tmp/rm-dev-daemon.pid`, `/tmp/rm-dev-daemon.out`, `/tmp/rm-dev-app.pid`, `/tmp/rm-dev-app.out`, `/tmp/rm-groups`, `/tmp/rm-sidebar-before`, `/tmp/rm-claude.json`, `/tmp/rm-claude.id`, `/tmp/rm-claude-send.json`, `/tmp/rm-gate.pid`, `/tmp/rm-spin.pid`, `/tmp/rm-server-ids`, `/tmp/rm-fake-box-calls.log`, `/tmp/rm-fake-box-env.json`, `/tmp/rm-fake-box-child.pid`, `/tmp/rm-orphan`

**Interfaces:**

- Consumes:
  - The built-in as Tasks 1-12 leave it: RPCs `resource-manager.local.request`, `.servers.request`, `.server.request`, `.close_agent.request` (Task 1); the screen `resources` titled "Resources" and its `Gauge` sidebar header item, route `/h/<serverId>/plugin/resource-manager/surface/resources` (Task 12, `buildPluginSurfaceRoute` in `packages/app/src/plugins/routes.ts:14-28`).
  - Screen text (Task 12): tab labels "This instance" and each entry name; sections "This instance", "Agents", "Groups" and, on a server tab, "Server", "Disks", "Top processes" or "Unable to read this server"; row labels "Container memory", "Swap", "Available host memory", "Load", "Last reading", "Memory"; group labels "Paseo daemon and terminals", "Shared MCP servers", "Heavy commands", "Everything else"; agent hint `<provider>, <n> processes, <size>, <cpu>% CPU, <state>`; Close labels "Close", "Confirm close", "Closing..."; `ARMED_HINT` "Press again within 5 s to end this agent's runtime; its next prompt resumes it"; the daemon's refusal reasons (Task 2) as the row's error, such as "Agent may still run background work; close it once that ends"; empty state "No agent processes".
  - Error text: `ssh-mcp exited (code 3): fatal: could not connect to 10.0.0.9` (Task 9 exit message plus the fake's `FAKE_SSH_MCP_EXIT_ON_START` stderr line); `missingVariablesMessage(["RM_TEST_UNSET_HOST"])` = "The config refers to RM_TEST_UNSET_HOST, which the daemon's environment does not set" (Task 10).
  - `REMOTE_COMMAND`, `parseRemoteOutput` (Task 8, `server/remote/remote-output.ts`); `serverRows`, `mountRow`, `processRow` (Task 12, `client/format.ts`), run through `tsx` (`node_modules/.bin/tsx`, v4.21.0) as the oracle for the server tab.
  - `serverId(sourceKey, name)` = first 16 hex of `sha256(<source key> NUL <name>)`, source key `project:<dir>/.mcp.json` (Task 7, decision 12); pid files `<RM_RUN>/<serverId>-<pgid>.pid` holding `PidRecordSchema` `{ pgid, startTime, ownerPid, ownerStartTime, pidNamespace, bootId, initStartTime }` (Task 4, decision 16); `SESSION_TIMING.idleMs = 120_000` (Task 10); `DISCOVERY_TTL_MS = 60_000` (Task 11).
  - `plugins/resource-manager/test/fake-ssh-mcp.mjs` (Task 9) and its env: `FAKE_SSH_MCP_TOOL`, `FAKE_SSH_MCP_OUTPUT_FILE` (read on every call), `FAKE_SSH_MCP_CALL_LOG` (one JSON line `{ name, arguments }` per `tools/call`), `FAKE_SSH_MCP_ENV_LOG` (`{ paseo: <count of PASEO_* keys>, claudecode, own }`, written at start), `FAKE_SSH_MCP_CHILD_PID_FILE` (a `sleep 300` in its group), `FAKE_SSH_MCP_EXIT_ON_START`, `FAKE_SSH_MCP_OWN`. It exits when its stdin closes.
  - shared-mcp (merged): `ServerDefinitionSchema` `{ id, label, command (a /bin/sh -c string), port, healthPath = "/mcp", ... }` (`plugins/shared-mcp/shared/settings.ts:21-33`), stored at `$PASEO_HOME/plugin-settings/shared-mcp/servers.json` as `{ "version": 1, "values": { "servers": [...] } }`; pid file `<PASEO_HOME>/shared-mcp/run/<id>.pid`; `probeMcp` counts any answer under 500 as alive (`plugins/shared-mcp/server/probe.ts:55-75`).
  - CLI on the repo source (`npm run cli`, `package.json:100`): `run --provider --mode --cwd --title --wait-timeout --json <prompt>` (`packages/cli/src/commands/agent/run.ts`), `agent send <id> [prompt] [--no-wait] [--json]` (`send.ts:39-53`), `agent wait <id> [--timeout <s>]` (`wait.ts:138`), `agent inspect <id> --json` with keys `Status` and `Archived` (`inspect.ts:129-140`), `agent archive <id> [--force]` (`archive.ts:32`).
  - The supervisor titles itself `Paseo Supervisor` (`packages/server/scripts/supervisor-entrypoint.ts:19`), also under `npm run dev:server:raw`, which runs it through `packages/server/scripts/dev-runner.ts:10`.
- Produces: the `resource-manager` paragraphs in `docs/plugins.md`. No code, no new exports.

Ground rules for every step of this task:

- Never signal the daemon on 6767 and never write under `~/.paseo`. The test reads two things there: `config.json` (copied in Step 4, never printed) and the local speech models directory that `start_dev_daemon` hands the dev daemon, as `scripts/dev-daemon.sh` does. Every pid this task signals comes from `$DEV_HOME/paseo.pid`, from a pid file under `$RM_RUN` or `$SMCP_RUN`, or from a `/tmp/rm-*` file this task wrote, and only after a check that it still runs this test's process. The abort path also signals processes whose environment carries the `PASEO_AGENT_ID` of the agent this task created. Never use `pkill`.
- The dev daemon runs with a random password that Step 1 writes to `/tmp/rm-dev-password` (mode 0600) and binds only the Docker bridge address 172.22.0.3. `start_dev_daemon` refuses any other address, so the daemon never listens on the VPN overlay. The inherited real `PASEO_PASSWORD` never reaches it.
- Memory: Metro takes about 3 GB, the Claude agent about 800 MB and the dev daemon about 400 MB on a 16 GB host that froze on 2026-11-06. Step 2 needs at least 5500 MB available. From Step 7 a watcher samples `MemAvailable` every 5 s, and every shell step from Step 8 on runs `mem_guard`. A `LOW MEMORY` line from it, or a reading under 2500 MB that you notice any other way, ends the run through **Abort and clean up**.
- Shell state does not persist between Bash calls, so every shell step starts with `. /tmp/rm-test.env`. Wait loops call `bash -c`, because dash's `kill` cannot signal a process group. A wait that can run longer than 60 s starts with the Bash tool's `run_in_background: true`. Every wait either chains its follow-up with `&&` or prints a line starting with `TIMEOUT`.
- Heavy commands hold `/tmp/paseo-heavy.lock`: the server build and the dist test (Step 3), Metro and the web bundle (Step 10, which keeps the lock until Step 32), and the pre-commit typecheck (Step 35). The `tsx` oracle runs in Steps 5 and 18 are a few small files and take no lock; from Step 10 on they could not take it anyway.
- Never print a secret. No step prints `config.json`, `~/.claude/settings.json`, `~/.claude.json` or any environment value: `rm-figures.js` reads only `PASEO_AGENT_ID` and `PASEO_HEAVY_GATE_HELD` from `/proc/<pid>/environ` and prints counts and sizes, and Step 6 prints counts of `~/.claude.json` entries only. The one value printed on purpose is this run's throwaway dev password, in Step 11, because the browser form needs it.
- A `TIMEOUT`, `LOW MEMORY`, `LIVE GROUP` or `STILL` line, or any output that differs from Expected, ends the run. Read the logs the step names, then run **Abort and clean up** before anything else: from Step 10 on Metro holds the heavy lock that every other agent's typecheck, test and commit waits for.
- The Command Center is not used: it shows only inside a workspace, and this built-in adds no item there (decision 17). The way in is the sidebar item.

**Abort and clean up.** Run with `run_in_background: true` (it can take about 90 s):

```bash
. /tmp/rm-test.env && abort_cleanup
```

Then call `mcp__playwright__browser_tabs` with `{"action": "list"}` and, if a `http://172.22.0.3:8081` tab is open, `{"action": "close", "index": <its index>}`.

Expected: one line per thing it stopped, then `abort cleanup done`, with no `LIVE GROUP`, `STILL LISTENING` or `TIMEOUT` line. `abort_cleanup` (Step 1) works from any step and skips what was never started:

1. If the dev daemon answers, it archives the agent recorded in `/tmp/rm-claude.id`.
2. It stops the dev daemon: SIGTERM to the supervisor in `$DEV_HOME/paseo.pid`, up to 30 s, then SIGTERM to what is left of the dev session group in `/tmp/rm-dev-daemon.pid`. A supervisor outside that session, or without `PASEO_HOME=$DEV_HOME`, is left alone and reported.
3. It stops every group named by a pid file under `$RM_RUN` or `$SMCP_RUN` or in `/tmp/rm-groups` that still runs a test server (a fake ssh-mcp started with `FAKE_SSH_MCP_OWN=rm-test`, or `rm-http-server.js`): SIGTERM, then SIGKILL after 5 s.
4. It sends SIGTERM to any process still carrying the recorded agent's `PASEO_AGENT_ID`.
5. It stops the two gate-marked test processes from Step 16 if they still run.
6. It stops Metro's session group (SIGTERM, then SIGKILL after 30 s), which releases `/tmp/paseo-heavy.lock`, and the memory watcher.
7. It reports any test port still listening.

After an abort, start again from Step 1. Step 4 moves this run's dev home aside, so its logs stay available.

- [ ] **Step 1: Write the scratch helpers.** Run:

```bash
cat > /tmp/rm-test.env <<'EOF'
# Scratch helpers for the resource-manager manual test. Paths are the checkout's dev home or
# /tmp/rm-*; nothing here writes under ~/.paseo or signals the daemon on 6767.
REPO=/workspace/utils/paseo
DEV_HOME=/workspace/utils/paseo/.dev/paseo-home
RM_RUN=/workspace/utils/paseo/.dev/paseo-home/resource-manager/run
SMCP_RUN=/workspace/utils/paseo/.dev/paseo-home/shared-mcp/run
SMCP_SETTINGS=/workspace/utils/paseo/.dev/paseo-home/plugin-settings/shared-mcp/servers.json
AGENT_DIR=/tmp/rm-agent
# Random password for this run only, written by Step 1 (mode 0600).
DEV_PASSWORD=$(cat /tmp/rm-dev-password 2>/dev/null)
# The Docker bridge address. hostname -i also prints the VPN overlay (10.200.0.24), so take the
# 172.22.* address by its prefix; start_dev_daemon refuses anything else.
DEV_IP=$(hostname -i | tr ' ' '\n' | grep -m1 '^172\.22\.')
export REPO DEV_HOME RM_RUN SMCP_RUN SMCP_SETTINGS AGENT_DIR DEV_PASSWORD DEV_IP

# Fails when MemAvailable is under 2500 MB now, or was at any watcher sample since Step 7.
mem_guard() {
  local mb
  mb=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
  if [ -s /tmp/rm-mem-low ]; then echo "LOW MEMORY at $(tail -n 1 /tmp/rm-mem-low)"; return 1; fi
  if [ "$mb" -lt 2500 ]; then echo "LOW MEMORY: MemAvailable $mb MB, under 2500 MB"; return 1; fi
  echo "MemAvailable $mb MB"
}
# Appends every 5 s sample under 2500 MB to /tmp/rm-mem-low, in its own session.
start_mem_watch() {
  : > /tmp/rm-mem-low
  : > /tmp/rm-mem-watch.pid
  setsid -f sh -c 'echo $$ > /tmp/rm-mem-watch.pid
while :; do
  mb=$(awk "/^MemAvailable:/ { print int(\$2 / 1024) }" /proc/meminfo)
  [ "$mb" -lt 2500 ] && echo "$(date +%T) MemAvailable $mb MB" >> /tmp/rm-mem-low
  sleep 5
done' > /dev/null 2>&1 < /dev/null
}
# Process group named by a pid file of either plugin: one JSON line with "pgid".
pgid_of() {
  node -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
if (!Number.isInteger(v.pgid)) process.exit(1);
console.log(v.pgid);' "$1" 2>/dev/null
}
group_alive() { kill -0 -- "-$1" 2>/dev/null; }
# True when something listens on TCP port $1, IPv4 or IPv6.
listening() {
  awk -v p="$(printf ':%04X' "$1")" \
    'FNR > 1 && $4 == "0A" && substr($2, length($2) - 4) == p { f = 1 } END { exit !f }' \
    /proc/net/tcp /proc/net/tcp6
}
# Supervisor pid from the dev home's pid lock (never ~/.paseo).
sup_pid() {
  node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pid)' \
    "$DEV_HOME/paseo.pid"
}
dev_health() {
  curl -s -m 2 -o /dev/null -w '%{http_code}' "http://$DEV_IP:6768/api/health"
}
# Waits up to 10 s for a pid file that a forked child writes; prints TIMEOUT and fails otherwise.
wait_for_file() {
  timeout 10 bash -c 'until [ -s "$1" ]; do sleep 0.2; done' _ "$1" ||
    { echo "TIMEOUT: $1 is still empty"; return 1; }
}
# Dev daemon in its own session, without scripts/dev-daemon.sh, which always execs
# dev:server:watch and so adds two tsc --watch processes outside the heavy lock.
start_dev_daemon() {
  case "$DEV_IP" in
    172.22.*) ;;
    *) echo "refusing to bind '$DEV_IP': not the Docker bridge"; return 1 ;;
  esac
  [ -n "$DEV_PASSWORD" ] || { echo "no dev password in /tmp/rm-dev-password"; return 1; }
  : > /tmp/rm-dev-daemon.pid
  (cd "$REPO" && setsid -f sh -c 'echo $$ > /tmp/rm-dev-daemon.pid
echo "Home:    $1"
echo "Listen:  $2:6768"
exec env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_HOST PASEO_PASSWORD="$3" \
  PASEO_HOME="$1" PASEO_LISTEN="$2:6768" PASEO_CORS_ORIGINS="*" PASEO_NODE_INSPECT=--inspect=0 \
  PASEO_LOCAL_MODELS_DIR="$HOME/.paseo/models/local-speech" PASEO_LOG_FORMAT=json \
  PASEO_LOG_LEVEL=info npm run dev:server:raw' sh "$DEV_HOME" "$DEV_IP" "$DEV_PASSWORD" \
    >> /tmp/rm-dev-daemon.out 2>&1 < /dev/null)
}
# Repo CLI against the dev daemon only: explicit --host, the throwaway password, the dev home.
dev_cli() {
  (cd "$REPO" && env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_HOST PASEO_HOME="$DEV_HOME" \
    PASEO_PASSWORD="$DEV_PASSWORD" npm run --silent cli -- "$@" --host "$DEV_IP:6768")
}
# Prints "<agentId> <status>" from a `run --json` result file.
run_result() {
  node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const v = Array.isArray(r) ? r[0] : r;
console.log(v.agentId, v.status);' "$1"
}
test_agent_id() { [ -s /tmp/rm-claude.id ] && cut -d' ' -f1 /tmp/rm-claude.id; }
# "status: <Status>, archived: <Archived>" from `agent inspect --json`.
agent_status() {
  dev_cli agent inspect "$1" --json | node -e 'let text = "";
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  const v = JSON.parse(text);
  console.log(`status: ${v.Status}, archived: ${v.Archived}`);
});'
}
# Processes whose environment carries PASEO_AGENT_ID=$1.
agent_proc_count() { grep -lzx "PASEO_AGENT_ID=$1" /proc/[0-9]*/environ 2>/dev/null | wc -l; }
# The resource-manager server id of entry $1 in $AGENT_DIR/.mcp.json (decision 12).
server_id() {
  node -e 'const { createHash } = require("node:crypto");
const key = `project:${process.argv[1]}/.mcp.json`;
console.log(createHash("sha256").update(`${key}\0${process.argv[2]}`).digest("hex").slice(0, 16));' \
    "$AGENT_DIR" "$1"
}
# Pid files under $RM_RUN for entry $1, one name per line.
session_files() { ls "$RM_RUN" 2>/dev/null | grep -E "^$(server_id "$1")-[0-9]+\.pid$"; }
fake_calls() { if [ -f /tmp/rm-fake-box-calls.log ]; then wc -l < /tmp/rm-fake-box-calls.log; else echo 0; fi; }
figures() { node /tmp/rm-figures.js "$@"; }
remote_ts() { (cd "$REPO" && node_modules/.bin/tsx /tmp/rm-remote.mts "$@"); }
# True when pid $1 runs with this test's dev home. The daemon on 6767 has another PASEO_HOME.
dev_home_process() { grep -qzx "PASEO_HOME=$DEV_HOME" "/proc/$1/environ" 2>/dev/null; }
# True when pid $1 runs in the dev session that start_dev_daemon recorded.
in_dev_session() {
  local want got
  want=$(cat /tmp/rm-dev-daemon.pid 2>/dev/null)
  got=$(ps -o pgid= -p "$1" 2>/dev/null | tr -d ' ')
  [ -n "$want" ] && [ "$got" = "$want" ]
}
dev_home_group() {
  local p
  for p in $(pgrep -g "$1"); do dev_home_process "$p" && return 0; done
  return 1
}
# True when group $1 runs a test server: a fake ssh-mcp from the test configs (its sleep child
# inherits FAKE_SSH_MCP_OWN=rm-test) or the throwaway HTTP server. A reused group id fails it.
test_group() {
  local p
  for p in $(pgrep -g "$1"); do
    grep -qzx 'FAKE_SSH_MCP_OWN=rm-test' "/proc/$p/environ" 2>/dev/null && return 0
    tr '\0' ' ' 2>/dev/null < "/proc/$p/cmdline" | grep -q 'rm-http-server' && return 0
  done
  return 1
}
# SIGTERM, then SIGKILL after 5 s, for a live group that test_group recognises.
stop_test_group() {
  [ "${1:-0}" -gt 1 ] 2>/dev/null && group_alive "$1" || return 0
  if ! test_group "$1"; then echo "left group $1 alone: it runs no test server"; return 0; fi
  kill -TERM -- "-$1" 2>/dev/null
  timeout 5 bash -c '. /tmp/rm-test.env; while group_alive "$1"; do sleep 0.2; done' _ "$1" ||
    kill -KILL -- "-$1" 2>/dev/null
  sleep 0.5
  if group_alive "$1"; then echo "LIVE GROUP $1 after SIGKILL"; else echo "test server group $1 stopped"; fi
}
# Stops the session group of the pid in file $1 when it still runs "$2" with the gate marker.
stop_gate_process() {
  local p
  p=$(cat "$1" 2>/dev/null)
  [ "${p:-0}" -gt 1 ] 2>/dev/null && kill -0 "$p" 2>/dev/null || return 0
  if grep -qzx 'PASEO_HEAVY_GATE_HELD=1' "/proc/$p/environ" 2>/dev/null &&
    tr '\0' ' ' 2>/dev/null < "/proc/$p/cmdline" | grep -q "$2"; then
    kill -TERM -- "-$p" 2>/dev/null && echo "gate test process $p stopped"
  fi
}
# The abort path in the ground rules. Safe to run from any step and more than once.
abort_cleanup() {
  local g f id sup pids
  id=$(test_agent_id)
  if [ -n "$id" ] && [ "$(dev_health)" = 200 ]; then
    dev_cli agent archive "$id" --force > /dev/null 2>&1 && echo "agent $id archived"
  fi
  sup=$(sup_pid 2>/dev/null)
  if [ "${sup:-0}" -gt 1 ] 2>/dev/null && dev_home_process "$sup" && ! in_dev_session "$sup"; then
    echo "left dev supervisor $sup alone: this task did not start it"
  elif [ "${sup:-0}" -gt 1 ] 2>/dev/null && dev_home_process "$sup"; then
    kill -TERM "$sup"
    if timeout 30 bash -c 'while kill -0 "$1" 2>/dev/null; do sleep 1; done' _ "$sup"; then
      echo "dev supervisor $sup exited"
    else
      echo "dev supervisor $sup STILL running after SIGTERM"
    fi
  fi
  g=$(cat /tmp/rm-dev-daemon.pid 2>/dev/null)
  if [ "${g:-0}" -gt 1 ] 2>/dev/null && group_alive "$g" && dev_home_group "$g"; then
    kill -TERM -- "-$g" && echo "sent SIGTERM to dev session group $g"
    sleep 2
  fi
  for f in "$RM_RUN"/*.pid "$SMCP_RUN"/*.pid; do [ -e "$f" ] && stop_test_group "$(pgid_of "$f")"; done
  for g in $(awk '{ print $NF }' /tmp/rm-groups 2>/dev/null | sort -u); do stop_test_group "$g"; done
  if [ -n "$id" ]; then
    pids=$(grep -lzx "PASEO_AGENT_ID=$id" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3 | xargs)
    if [ -n "$pids" ]; then kill -TERM $pids 2>/dev/null; echo "sent SIGTERM to agent $id: $pids"; fi
  fi
  stop_gate_process /tmp/rm-gate.pid 'sleep 600'
  stop_gate_process /tmp/rm-spin.pid 'timeout 30'
  g=$(cat /tmp/rm-dev-app.pid 2>/dev/null)
  if [ "${g:-0}" -gt 1 ] 2>/dev/null && group_alive "$g" &&
    tr '\0' ' ' 2>/dev/null < "/proc/$g/cmdline" | grep -q 'scripts/dev-app.sh'; then
    kill -TERM -- "-$g"
    timeout 30 bash -c '. /tmp/rm-test.env; while group_alive "$1"; do sleep 1; done' _ "$g" ||
      { kill -KILL -- "-$g" 2>/dev/null; sleep 1; }
    if group_alive "$g"; then
      echo "TIMEOUT: Metro group $g still running and holding /tmp/paseo-heavy.lock"
    else
      echo "Metro group $g stopped; /tmp/paseo-heavy.lock released"
    fi
  fi
  g=$(cat /tmp/rm-mem-watch.pid 2>/dev/null)
  if [ "${g:-0}" -gt 1 ] 2>/dev/null && kill -0 "$g" 2>/dev/null &&
    tr '\0' ' ' 2>/dev/null < "/proc/$g/cmdline" | grep -q 'rm-mem-low'; then
    kill -TERM "$g" && echo "memory watcher $g stopped"
  fi
  for f in 6768 8081 18961; do listening "$f" && echo "STILL LISTENING on $f"; done
  echo "abort cleanup done"
}
EOF
cat > /tmp/rm-figures.js <<'EOF'
// Shell-side figures for the resource-manager manual test, in the screen's units.
// Usage: node /tmp/rm-figures.js host
//        node /tmp/rm-figures.js agent <agentId>
//        node /tmp/rm-figures.js daemon <supervisorPid> <sharedMcpRunDir>
//        node /tmp/rm-figures.js gate | total
// It reads PASEO_AGENT_ID and PASEO_HEAVY_GATE_HELD from /proc/<pid>/environ and nothing else,
// and prints counts and sizes only. It does not import the plugin: it is a second opinion.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const UNITS = ["B", "KB", "MB", "GB", "TB"];
const AGENT_PREFIX = "PASEO_AGENT_ID=";

// The rounding of formatBytes in plugins/resource-manager/client/format.ts.
function formatBytes(bytes) {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const shown = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${shown} ${UNITS[unit]}`;
}

function formatShare(used, total) {
  if (total <= 0) return formatBytes(used);
  return `${formatBytes(used)} of ${formatBytes(total)} (${Math.round((used / total) * 100)}%)`;
}

function read(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }
}

function processes() {
  const rows = [];
  for (const name of fs.readdirSync("/proc")) {
    if (!/^\d+$/.test(name)) continue;
    const stat = read(`/proc/${name}/stat`);
    if (stat === null) continue;
    const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    const rss = /VmRSS:\s+(\d+)/.exec(read(`/proc/${name}/status`) ?? "");
    const environ = (read(`/proc/${name}/environ`) ?? "").split("\0");
    const agent = environ.find((entry) => entry.startsWith(AGENT_PREFIX));
    rows.push({
      pid: Number(name),
      ppid: Number(fields[1]),
      pgrp: Number(fields[2]),
      rssBytes: rss ? Number(rss[1]) * 1024 : 0,
      agentId: agent === undefined ? null : agent.slice(AGENT_PREFIX.length),
      gate: environ.includes("PASEO_HEAVY_GATE_HELD=1"),
    });
  }
  return rows;
}

// The roots and every descendant reached without passing a process that `stop` rejects.
function tree(rows, roots, stop) {
  const children = new Map();
  for (const row of rows) children.set(row.ppid, [...(children.get(row.ppid) ?? []), row]);
  const picked = new Map();
  const queue = [...roots];
  while (queue.length > 0) {
    const row = queue.shift();
    if (picked.has(row.pid)) continue;
    picked.set(row.pid, row);
    for (const child of children.get(row.pid) ?? []) if (!stop(child)) queue.push(child);
  }
  return [...picked.values()];
}

function report(label, rows) {
  const bytes = rows.reduce((sum, row) => sum + row.rssBytes, 0);
  const count = rows.length === 1 ? "1 process" : `${rows.length} processes`;
  console.log(`${label}: ${count}, ${formatBytes(bytes)}`);
}

function sharedMcpGroups(runDir) {
  const groups = new Set();
  for (const name of fs.existsSync(runDir) ? fs.readdirSync(runDir) : []) {
    if (!name.endsWith(".pid")) continue;
    try {
      groups.add(JSON.parse(read(path.join(runDir, name)) ?? "").pgid);
    } catch {
      // A file mid-rename; the next run reads it.
    }
  }
  return groups;
}

function host() {
  const current = Number((read("/sys/fs/cgroup/memory.current") ?? "").trim());
  const max = (read("/sys/fs/cgroup/memory.max") ?? "").trim();
  const swapUsed = Number((read("/sys/fs/cgroup/memory.swap.current") ?? "").trim());
  const meminfo = {};
  for (const line of (read("/proc/meminfo") ?? "").split("\n")) {
    const match = /^(\w+):\s+(\d+)/.exec(line);
    if (match) meminfo[match[1]] = Number(match[2]) * 1024;
  }
  const loads = (read("/proc/loadavg") ?? "").split(" ").slice(0, 3).map(Number);
  const cores = os.availableParallelism();
  const memory = /^\d+$/.test(max)
    ? formatShare(current, Number(max))
    : `${formatBytes(current)} used, no cap`;
  const swap = meminfo.SwapTotal === 0 ? "No swap" : formatShare(swapUsed, meminfo.SwapTotal);
  console.log(`Container memory: ${memory}`);
  console.log(`Swap: ${swap}`);
  console.log(`Available host memory: ${formatBytes(meminfo.MemAvailable)} of ${formatBytes(meminfo.MemTotal)}`);
  console.log(`Load: ${loads.map((load) => load.toFixed(2)).join(", ")} on ${cores} ${cores === 1 ? "core" : "cores"}`);
}

const [command, first, second] = process.argv.slice(2);
if (command === "host") {
  host();
} else if (command === "agent") {
  const rows = processes();
  const roots = rows.filter((row) => row.agentId === first);
  const other = (row) => row.gate || (row.agentId !== null && row.agentId !== first);
  report(`agent ${first}`, tree(rows, roots, other));
} else if (command === "daemon") {
  const rows = processes();
  const shared = sharedMcpGroups(second);
  const roots = rows.filter((row) => row.pid === Number(first));
  const other = (row) => row.agentId !== null || row.gate || shared.has(row.pgrp);
  report("daemon", tree(rows, roots, other));
} else if (command === "gate") {
  report("gate", processes().filter((row) => row.gate));
} else if (command === "total") {
  report("total", processes());
} else {
  console.error("usage: node /tmp/rm-figures.js host | agent <id> | daemon <pid> <runDir> | gate | total");
  process.exit(2);
}
EOF
cat > /tmp/rm-remote.mts <<'EOF'
// Run from the repo root with node_modules/.bin/tsx.
//   tsx /tmp/rm-remote.mts command        prints the plugin's REMOTE_COMMAND
//   tsx /tmp/rm-remote.mts rows <file>    prints the server tab rows the plugin's own parser and
//                                         formatter make from a captured output, "label: value"
import { readFileSync } from "node:fs";
import {
  parseRemoteOutput,
  REMOTE_COMMAND,
} from "/workspace/utils/paseo/plugins/resource-manager/server/remote/remote-output.ts";
import {
  mountRow,
  processRow,
  serverRows,
} from "/workspace/utils/paseo/plugins/resource-manager/client/format.ts";

const [mode, file] = process.argv.slice(2);
if (mode === "command") {
  process.stdout.write(REMOTE_COMMAND);
} else if (mode === "rows" && file !== undefined) {
  const snapshot = parseRemoteOutput(readFileSync(file, "utf8"));
  const rows = [
    ...serverRows(snapshot),
    ...snapshot.mounts.map(mountRow),
    ...snapshot.processes.map(processRow),
  ];
  for (const row of rows) console.log(`${row.label}: ${row.value}`);
} else {
  console.error("usage: tsx /tmp/rm-remote.mts command | rows <file>");
  process.exit(2);
}
EOF
cat > /tmp/rm-http-server.js <<'EOF'
// Throwaway HTTP server that shared-mcp runs as a definition in the dev home, so the Shared MCP
// servers group has a process. Every request gets 200, which shared-mcp's probe counts as alive.
// Usage: node /tmp/rm-http-server.js <port>
const http = require("node:http");

const port = Number(process.argv[2]);
const server = http.createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"jsonrpc":"2.0","id":1,"result":{}}');
  });
});
server.listen(port, "127.0.0.1", () => console.log(`rm-http listening on 127.0.0.1:${port}`));
EOF
mkdir -p /tmp/rm-ssh-bin
cat > /tmp/rm-ssh-bin/ssh-mcp <<'EOF'
#!/bin/sh
# Discovery matches a command whose path has a segment named ssh-mcp (decision 11), so the fake
# runs behind this name. exec keeps one process, whose pid is the group the plugin records.
exec node /workspace/utils/paseo/plugins/resource-manager/test/fake-ssh-mcp.mjs "$@"
EOF
chmod 755 /tmp/rm-ssh-bin/ssh-mcp
: > /tmp/rm-dev-daemon.out
: > /tmp/rm-groups
(umask 077; node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))' > /tmp/rm-dev-password)
bash -n /tmp/rm-test.env && node --check /tmp/rm-figures.js && node --check /tmp/rm-http-server.js && sh -n /tmp/rm-ssh-bin/ssh-mcp && . /tmp/rm-test.env && case "$DEV_IP" in 172.22.*) echo "DEV_IP=$DEV_IP" ;; *) echo "refusing to bind '$DEV_IP': not the Docker bridge"; exit 1 ;; esac && stat -c 'dev password file mode %a, %s bytes' /tmp/rm-dev-password && figures host
```

Expected: `DEV_IP=172.22.0.3`, `dev password file mode 600, 32 bytes`, then four lines from `figures host`: `Container memory: <size> used, no cap` (this container's `memory.max` reads `max`), `Swap: <used> of 12 GB (<n>%)`, `Available host memory: <size> of 15 GB` and `Load: <a>, <b>, <c> on 2 cores`. On `refusing to bind`, stop: nothing has started yet. `npm run dev:server` and `npm run dev:app` cannot be used because their `cross-env` pins `PASEO_LISTEN=127.0.0.1:6768`; `scripts/dev-app.sh` and `npm run dev:server:raw` read `PASEO_LISTEN` from the environment. `/tmp/rm-remote.mts` is checked when Step 5 runs it.

- [ ] **Step 2: Pre-flight ports, memory, leftovers and the Claude CLI.** Run:

```bash
. /tmp/rm-test.env
for p in 6767 6768 8081 18961; do if listening "$p"; then echo "$p up"; else echo "$p free"; fi; done
free -m | awk 'NR == 2 { print "available MB:", $7 }'
echo "leftover test processes: $(pgrep -fc '[f]ake-ssh-mcp\.mjs|[r]m-http-server')"
echo "RM_TEST_UNSET_HOST is ${RM_TEST_UNSET_HOST+set}${RM_TEST_UNSET_HOST-unset}"
test -e "$AGENT_DIR" && echo "$AGENT_DIR exists from an earlier run" || echo "$AGENT_DIR absent"
echo "claude: $(timeout 20 claude --version 2>&1 | head -1)"
```

Expected:

```
6767 up
6768 free
8081 free
18961 free
available MB: <at least 5500>
leftover test processes: 0
RM_TEST_UNSET_HOST is unset
/tmp/rm-agent absent
claude: <2.1.292 or later> (Claude Code)
```

The dev daemon's Claude agents run the `claude` on `PATH` (`resolveClaudeBinary`, `packages/server/src/server/agent/providers/claude/agent.ts:1904-1916`), and the daemon refuses to close a Claude agent whose CLI is older than 2.1.292 and has sent no background-task roster (decision 4). Steps 25 and 27 need that close, so with an older CLI, stop here and report it. 6767 is the live daemon: leave it alone. The bracketed patterns keep `pgrep` from counting this shell, whose command line holds the pattern. A leftover process or a taken test port comes from an earlier run of this task: run **Abort and clean up**, then repeat this step. `/tmp/rm-agent` left from an earlier run is fine; Step 6 recreates it. With less than 5500 MB available, wait and repeat.

- [ ] **Step 3: Build the server stack and run the dist gate under the lock.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run build:server > /tmp/rm-build.out 2>&1; echo "exit=$?"; tail -n 5 /tmp/rm-build.out
```

Expected: `exit=0`. This builds the client, protocol, plugin SDK and server `dist` that the dev daemon, the CLI (`@getpaseo/server/daemon-control` resolves to `packages/server/dist`) and the Step 5 oracle import. The daemon itself runs from source, so nothing builds again outside the lock.

Then run the CI gate that starts every built-in from that build, with a throwaway `PASEO_HOME`:

```bash
cd /workspace/utils/paseo && ls -d packages/server/dist/server/builtin-plugins/resource-manager && node --input-type=module -e 'const { builtinPlugins } = await import("/workspace/utils/paseo/packages/server/dist/server/server/plugins/builtin/index.js"); console.log("resource-manager listed in the dist build:", builtinPlugins.includes("resource-manager"));'
H=$(mktemp -d /tmp/rm-dist-home.XXXXXX) || exit 1
PASEO_HOME="$H" flock /tmp/paseo-heavy.lock timeout -k 10 300 node --test --test-reporter=tap scripts/builtin-plugins-dist.test.mjs > /tmp/rm-dist.out 2>&1; echo "dist test exit=$?"
grep -E '^# (pass|fail|duration_ms)' /tmp/rm-dist.out
test -e "$H/resource-manager" && echo "WROTE $H/resource-manager" || echo "nothing written under the temp home's resource-manager"
rm -rf "$H"
```

Expected:

```
packages/server/dist/server/builtin-plugins/resource-manager
resource-manager listed in the dist build: true
dist test exit=0
# pass 1
# fail 0
# duration_ms <well under 300000>
nothing written under the temp home's resource-manager
```

`scripts/builtin-plugins-dist.test.mjs` (fork CI runs it after `npm run build:server`, `.github/workflows/fork-ci.yml:95-97`) compiles every listed built-in from the dist copy, starts each one in this process, and ends with `runtime.stopAll()`. Exit `124` (or `137`) means the run hung at the 300 s `timeout`: a timer that is not `unref()`ed or a `stop()` that never resolves holds the process open, and the daemon's shutdown would hang the same way. GNU `timeout` (coreutils 9.1 here) runs the test in its own process group, sends SIGTERM to that whole group at 300 s and SIGKILL 10 s later, so the `node --test` runner and its test child are gone when the line prints. Do not look for leftovers with `pgrep -f builtin-plugins-dist.test.mjs`: the pattern also matches the shell that runs it, and another session's executor may be running the same test, so a kill by pattern can hit either. Fix Task 10 or 11 first. The last line shows that a start with no session writes nothing (decision 16: the only work at start is a reclaim, and a missing run directory holds nothing to reclaim).

`PASEO_HOME` must be a temp dir. In this container `PASEO_HOME` is `/home/paseo/.paseo`, the live 6767 daemon's home, so without it the test's copy of this plugin would reclaim the live `~/.paseo/resource-manager/run`. Its owner check leaves a live daemon's files alone, but a test has no business there. Step 33 documents it.

- [ ] **Step 4: Prepare a fresh dev home and seed one shared-mcp server.** Run:

```bash
. /tmp/rm-test.env
cd "$REPO"
if [ -f "$DEV_HOME/paseo.pid" ] && kill -0 "$(sup_pid)" 2>/dev/null; then echo "a dev daemon is running on $DEV_HOME; stop it first"; exit 1; fi
if [ -d "$DEV_HOME" ]; then mv "$DEV_HOME" "$REPO/.dev/paseo-home.before-resource-manager-$(date +%Y%m%d%H%M%S)"; fi
mkdir -p "$DEV_HOME" && chmod 700 "$DEV_HOME"
install -m 600 "$HOME/.paseo/config.json" "$DEV_HOME/config.json"
mkdir -p "$(dirname "$SMCP_SETTINGS")"
cat > "$SMCP_SETTINGS" <<'JSON'
{
  "version": 1,
  "values": {
    "servers": [
      {
        "id": "rm-http",
        "label": "Throwaway HTTP server (test port 18961)",
        "command": "exec node /tmp/rm-http-server.js 18961",
        "port": 18961
      }
    ]
  }
}
JSON
ls -A "$DEV_HOME"
node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("persisted daemon password:", Boolean(c.daemon?.auth?.password))' "$DEV_HOME/config.json"
```

Expected: `config.json  plugin-settings`, then `persisted daemon password: false`, so the throwaway env password is the only one the dev daemon checks (`packages/server/src/server/config.ts:494-505`). An earlier dev home is kept as `.dev/paseo-home.before-resource-manager-<timestamp>`. The `exec` in the command makes the server one process, so the "Shared MCP servers" group reads `1 process` below.

- [ ] **Step 5: Capture the remote output and its expected rows.** Run:

```bash
. /tmp/rm-test.env
remote_ts command > /tmp/rm-remote-command.txt && echo "command: $(cat /tmp/rm-remote-command.txt)"
sh -c "$(cat /tmp/rm-remote-command.txt)" > /tmp/rm-remote-output.txt; echo "exit=$?"
grep -c '^@@' /tmp/rm-remote-output.txt
remote_ts rows /tmp/rm-remote-output.txt | tee /tmp/rm-remote-rows.txt
```

Expected:

```
command: echo @@meminfo && cat /proc/meminfo && echo @@loadavg && cat /proc/loadavg && echo @@nproc && nproc && echo @@df && df -P && echo @@ps && ps -eo pid,rss,comm
exit=0
5
Memory: <used> of 15 GB (<n>%)
Swap: <used> of 12 GB (<n>%)
Load: <a>, <b>, <c> on 2 cores
/: <used> of <total> (<n>%)
/workspace: <used> of <total> (<n>%)
<one line per other non-pseudo mount, if any>
<comm>: <size>, pid <pid>
<nine more process lines, largest RSS first>
```

The command matches decision 14 byte for byte. This container stands in for a remote host: fake-box (Step 17) returns this file on every call, so the server tab must show exactly these lines. They come from the plugin's own parser and formatter, so this checks the path from the fake ssh-mcp through the MCP client, the session and the RPC to the screen; the parsers themselves are Task 8's unit tests. A `tsx` error here means `build:server` did not run or the Task 8 or Task 12 file is missing.

- [ ] **Step 6: Prepare the agent's project directory and count the real ssh-mcp entries.** Run:

```bash
. /tmp/rm-test.env
rm -rf "$AGENT_DIR" && mkdir -p "$AGENT_DIR/.claude"
cat > "$AGENT_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "rm-child": {
      "command": "node",
      "args": ["/workspace/utils/paseo/plugins/resource-manager/test/fake-ssh-mcp.mjs"],
      "env": { "FAKE_SSH_MCP_TOOL": "noop", "FAKE_SSH_MCP_OWN": "rm-test" }
    }
  }
}
JSON
cat > "$AGENT_DIR/.claude/settings.local.json" <<'JSON'
{
  "enabledMcpjsonServers": ["rm-child"],
  "disabledMcpjsonServers": ["fake-box", "fake-down", "missing-var-box"]
}
JSON
ls -A "$AGENT_DIR"
CONFIG="${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json"; echo "Claude config: $CONFIG"
node -e 'const config = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const maps = [config.mcpServers ?? {}];
for (const project of Object.values(config.projects ?? {})) maps.push(project?.mcpServers ?? {});
let entries = 0;
let ssh = 0;
for (const map of maps) {
  for (const entry of Object.values(map)) {
    entries += 1;
    const words = [entry?.command, ...(Array.isArray(entry?.args) ? entry.args : [])];
    if (words.some((word) => typeof word === "string" && /(^|[\\/])ssh-mcp(@|[\\/]|$)/.test(word))) ssh += 1;
  }
}
console.log(`MCP entries ${entries}, naming ssh-mcp ${ssh}`);' "$CONFIG"
```

Expected: `.claude  .mcp.json`, the config path, and `MCP entries <n>, naming ssh-mcp 0`. The script prints counts only. `rm-child` is not an ssh-mcp entry (no path segment is `ssh-mcp`), so discovery skips it while Claude starts it as the agent's own MCP server: it shows that an agent's MCP children count against the agent. The three names in `disabledMcpjsonServers` keep Claude from starting the ssh entries Step 17 adds, which the plugin still shows (decision 11). A non-zero `naming ssh-mcp` count means this instance has real ssh-mcp entries, whose tabs would open SSH sessions to real hosts: stop and ask the user before going on.

- [ ] **Step 7: Start the memory watcher and the dev daemon.** Run:

```bash
. /tmp/rm-test.env && mem_guard && start_mem_watch && wait_for_file /tmp/rm-mem-watch.pid && start_dev_daemon && wait_for_file /tmp/rm-dev-daemon.pid && echo "dev session pgid=$(cat /tmp/rm-dev-daemon.pid), memory watcher pid=$(cat /tmp/rm-mem-watch.pid)"
```

Expected: `MemAvailable <n> MB`, then `dev session pgid=<N>, memory watcher pid=<M>`. The daemon runs detached through `npm run dev:server:raw` (dev runner, then the supervisor, then the worker from source) with `PASEO_HOME=$DEV_HOME`, `PASEO_LISTEN=172.22.0.3:6768`, the run's password, and `PASEO_AGENT_ID`, `PASEO_AGENT_CWD` and `PASEO_HOST` unset.

- [ ] **Step 8: Wait for the daemon and rm-http.** Run with `run_in_background: true`:

```bash
timeout 300 bash -c '. /tmp/rm-test.env; until [ "$(dev_health)" = 200 ] && [ -s "$SMCP_RUN/rm-http.pid" ] && listening 18961; do sleep 2; done' && echo "dev daemon healthy; rm-http on 18961" || echo "TIMEOUT waiting for the dev daemon and rm-http"; . /tmp/rm-test.env; mem_guard
```

Expected within about 2 minutes: `dev daemon healthy; rm-http on 18961` and `MemAvailable <n> MB`. On `TIMEOUT`, read:

```bash
tail -n 60 /tmp/rm-dev-daemon.out
grep -v '^{' /workspace/utils/paseo/.dev/paseo-home/daemon.log | tail -n 40
grep -E 'resource-manager|shared-mcp' /workspace/utils/paseo/.dev/paseo-home/daemon.log | tail -n 20
```

- [ ] **Step 9: Check that the plugin's start wrote nothing.** Run:

```bash
. /tmp/rm-test.env && mem_guard
test -e "$DEV_HOME/resource-manager" && echo "WROTE $DEV_HOME/resource-manager" || echo "no resource-manager directory yet"
echo "problem lines: $(grep -c 'resource-manager: ' "$DEV_HOME/daemon.log")"
echo "resource-manager errors: $(grep 'resource-manager' "$DEV_HOME/daemon.log" | grep -ciE 'error|fail')"
echo "rm-http $(pgid_of "$SMCP_RUN/rm-http.pid")" | tee -a /tmp/rm-groups
```

Expected: `no resource-manager directory yet`, `problem lines: 0`, `resource-manager errors: 0`, `rm-http <pgid>`. Nothing runs at start but the reclaim (decision 16), and discovery waits for the first `servers` call, so a plugin that wrote here at start, or logged a problem before anyone opened the screen, is a bug in Task 11.

- [ ] **Step 10: Start Metro under the heavy-command lock.** Run:

```bash
. /tmp/rm-test.env && mem_guard
: > /tmp/rm-dev-app.pid
(cd "$REPO" && setsid -f sh -c 'echo $$ > /tmp/rm-dev-app.pid; exec flock /tmp/paseo-heavy.lock env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_PASSWORD PASEO_HOME="$1" PASEO_LISTEN="$2:6768" scripts/dev-app.sh' sh "$DEV_HOME" "$DEV_IP" > /tmp/rm-dev-app.out 2>&1 < /dev/null)
wait_for_file /tmp/rm-dev-app.pid && echo "metro session pgid=$(cat /tmp/rm-dev-app.pid)"
```

Then run with `run_in_background: true`:

```bash
timeout 900 bash -c 'until grep -q "Waiting on http://localhost:8081" /tmp/rm-dev-app.out; do sleep 2; done' && grep -m3 -E "Metro:|Daemon:|Waiting on" /tmp/rm-dev-app.out || echo "TIMEOUT waiting for Metro"; . /tmp/rm-test.env; mem_guard
```

Expected: `Metro:   http://localhost:8081`, `Daemon:  172.22.0.3:6768`, `Waiting on http://localhost:8081`, then `MemAvailable <n> MB`. The wait includes time queued for the lock. Metro holds the lock for its whole life, until Step 32, because it keeps its memory after the bundle is built and a typecheck beside it is what froze the host.

- [ ] **Step 11: Open the app in a new tab and add the dev host.** The Playwright browser is the shared CDP Chrome, so open a tab of your own and never navigate an existing one. Call `mcp__playwright__browser_tabs` with `{"action": "new", "url": "http://172.22.0.3:8081/"}`. Then run with `run_in_background: true`:

```bash
timeout 900 bash -c 'until grep -qE "Web Bundled|Bundling failed" /tmp/rm-dev-app.out; do sleep 3; done' && grep -m1 -E "Web Bundled|Bundling failed" /tmp/rm-dev-app.out || echo "TIMEOUT waiting for the web bundle"; . /tmp/rm-test.env; mem_guard
```

Expected: `Web Bundled <ms>ms ... (<n> modules)`, about 3 minutes on a first build. The app has no password prompt for the `EXPO_PUBLIC_LOCAL_DAEMON` override (`packages/app/src/runtime/host-runtime.ts:1860-1884`), so add the host by hand:

1. Call `mcp__playwright__browser_evaluate` with `{"function": "() => { localStorage.removeItem(\"@paseo:daemon-registry\"); return \"host registry cleared\"; }"}`. This touches only the `http://172.22.0.3:8081` origin.
2. Call `mcp__playwright__browser_navigate` with `{"url": "http://172.22.0.3:8081/"}`.
3. Take `mcp__playwright__browser_snapshot`: it shows "Welcome to Paseo" with a `Direct connection` option. Click it.
4. Print the password with `cat /tmp/rm-dev-password; echo`. Fill `Host` with `172.22.0.3`, `Port` with `6768` and `Password` with that value, then click `Connect`, and `Connect` again if a "Connect to this host?" dialog follows.

Expected: a fresh snapshot shows the app connected to the dev host with no error overlay. The password now appears in the transcript. It was made for this run, guards only this dev daemon on the Docker bridge, and Step 32 deletes it.

- [ ] **Step 12: Look for the sidebar item before any workspace exists.** Run:

```bash
. /tmp/rm-test.env && mem_guard && echo "server-id=$(cat "$DEV_HOME/server-id")" && dev_cli workspace ls --json | node -e 'let t = ""; process.stdin.on("data", (c) => (t += c)).on("end", () => { const v = JSON.parse(t); console.log("workspaces:", (Array.isArray(v) ? v : v.workspaces ?? v.entries ?? []).length); });'
```

Then take `mcp__playwright__browser_snapshot` and look for a sidebar row named `Resources`. Record what you see with exactly one of:

```bash
echo visible > /tmp/rm-sidebar-before
echo hidden > /tmp/rm-sidebar-before
```

Expected: `server-id=<id>` and `workspaces: 0`. Either recording is a valid result; Step 33's wording depends on it. When the row is visible, click it and take a snapshot:

- The URL is `http://172.22.0.3:8081/h/<server-id>/plugin/resource-manager/surface/resources`.
- No tab bar (no `tablist`): with no workspace, discovery reads only the user config, which Step 6 showed has no ssh-mcp entry. This is the spec's "On this instance, only the instance tab shows".
- Section "This instance" with rows `Container memory`, `Swap`, `Available host memory`, `Load` and `Last reading`; section "Agents" with `No agent processes`; section "Groups" with four rows in this order: `Paseo daemon and terminals`, `Shared MCP servers` (`1 process, ...`), `Heavy commands` (`0 processes, 0 B, 0.0% CPU`) and `Everything else`.

When it is hidden, Step 15 makes the same checks inside the workspace. If `dev_cli workspace ls --json` fails or prints another shape, read the count from the app's sidebar instead (no workspace rows).

- [ ] **Step 13: Create one Claude agent in the project directory.** Run with `run_in_background: true`:

```bash
. /tmp/rm-test.env && mem_guard && dev_cli run --provider claude --mode bypassPermissions --cwd "$AGENT_DIR" --title rm-claude --wait-timeout 5m --json "Reply with the word ready and nothing else." > /tmp/rm-claude.json; echo "exit=$?"; run_result /tmp/rm-claude.json | tee /tmp/rm-claude.id; mem_guard
```

Expected: `exit=0`, `<agent id> completed`, `MemAvailable <n> MB`. Creating the agent makes `/tmp/rm-agent` a workspace (`ensureWorkspaceForCreate`, `packages/server/src/server/agent/create-agent/create.ts:46-47`), which discovery reads from now on. If the status is `permission`, run `. /tmp/rm-test.env && dev_cli permit allow "$(test_agent_id)" --all && dev_cli agent wait "$(test_agent_id)"` once.

- [ ] **Step 14: Confirm the agent's MCP child carries its id.** Run:

```bash
. /tmp/rm-test.env && mem_guard
ID=$(test_agent_id)
echo "agent processes: $(agent_proc_count "$ID")"
for p in $(pgrep -f '[f]ake-ssh-mcp\.mjs'); do grep -qzx "PASEO_AGENT_ID=$ID" "/proc/$p/environ" 2>/dev/null && echo "rm-child $p runs under the agent"; done
figures agent "$ID"
```

Expected: `agent processes: <at least 2>`, exactly one `rm-child <pid> runs under the agent` line, and `agent <id>: <n> processes, <size>`. No rm-child line means Claude did not start the project server: check `$AGENT_DIR/.claude/settings.local.json`, then run **Abort and clean up**.

- [ ] **Step 15: Open the Resources screen inside the workspace and compare it with the shell.** In the app, take a snapshot, click the `rm-agent` workspace in the sidebar, then click `Resources`. Run at once:

```bash
. /tmp/rm-test.env && mem_guard
ID=$(test_agent_id)
figures host; figures agent "$ID"; figures daemon "$(sup_pid)" "$SMCP_RUN"; figures gate; figures total
```

Then take `mcp__playwright__browser_snapshot`, call `mcp__playwright__browser_wait_for` with `{"time": 6}`, and take another.

Expected:

- The `Resources` row shows in the sidebar header with the workspace open, and the URL is the Step 12 route.
- No tab bar yet: `/tmp/rm-agent/.mcp.json` holds no ssh-mcp entry.
- "This instance": `Container memory`, `Swap` and `Available host memory` within 5% of the `figures host` lines (memory moves between the two reads); `Load` with the same `on 2 cores` and loads within 0.3; `Last reading` differs between the two snapshots (the 5 s refresh).
- "Agents": one row `rm-claude`, hint `claude, <n> processes, <size>, <x>% CPU, idle for under a minute` (or `idle for 1 min`), with `<n>` within 1 of the `figures agent` count and `<size>` within 15% of it, and an enabled `Close` button. Its size includes rm-child and the user-scope MCP servers Claude started, the spec's "total RSS including its children".
- "Groups": `Paseo daemon and terminals` within 1 process and 15% of `figures daemon`; `Shared MCP servers` `1 process, <size>, 0.0% CPU`; `Heavy commands` `0 processes, 0 B, 0.0% CPU`; `Everything else` holding the rest. The live 6767 daemon, its agents and Metro are in "Everything else": their `PASEO_AGENT_ID` values name no live agent of the dev daemon (decision 5).
- The process counts of the agent row and the four group rows add up to the `figures total` count, within 3 (processes start and exit between the two reads): the groups partition the process table (decision 6).

Then open `http://172.22.0.3:8081/settings/sidebar` with `mcp__playwright__browser_navigate` and take a snapshot: the "Header" section lists `Resources` with its visibility control. Call `mcp__playwright__browser_navigate_back`.

- [ ] **Step 16: Check the Heavy commands group with gate-marked processes.** Run:

```bash
. /tmp/rm-test.env && mem_guard
: > /tmp/rm-gate.pid; : > /tmp/rm-spin.pid
setsid -f sh -c 'echo $$ > /tmp/rm-gate.pid; exec env PASEO_HEAVY_GATE_HELD=1 sleep 600' < /dev/null > /dev/null 2>&1
setsid -f sh -c 'echo $$ > /tmp/rm-spin.pid; exec env PASEO_HEAVY_GATE_HELD=1 timeout 30 sh -c "while :; do :; done"' < /dev/null > /dev/null 2>&1
wait_for_file /tmp/rm-gate.pid && wait_for_file /tmp/rm-spin.pid && sleep 6 && figures gate
```

Take `mcp__playwright__browser_snapshot`. Then call `mcp__playwright__browser_wait_for` with `{"time": 30}`, take another snapshot, and run:

```bash
. /tmp/rm-test.env && mem_guard && figures gate && stop_gate_process /tmp/rm-gate.pid 'sleep 600'
```

Expected: `gate: 3 processes, <size>` (the sleep, `timeout` and its busy `sh`); the first snapshot's `Heavy commands` row reads `3 processes, <size>, <90 to 105>% CPU`, which is one core busy (decision 9: 100% is one core). After the wait, `gate: 1 process, <size>` and the row reads `1 process, <size>, 0.0% CPU`; then `gate test process <pid> stopped`. Until sub-project 2 merges, nothing else carries `PASEO_HEAVY_GATE_HELD=1`; once it has, gated commands from other agents add to both counts equally.

- [ ] **Step 17: Add the ssh-mcp entries and reopen the screen.** Run:

```bash
. /tmp/rm-test.env && mem_guard
rm -f /tmp/rm-fake-box-calls.log /tmp/rm-fake-box-env.json /tmp/rm-fake-box-child.pid
cat > "$AGENT_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "rm-child": {
      "command": "node",
      "args": ["/workspace/utils/paseo/plugins/resource-manager/test/fake-ssh-mcp.mjs"],
      "env": { "FAKE_SSH_MCP_TOOL": "noop", "FAKE_SSH_MCP_OWN": "rm-test" }
    },
    "fake-box": {
      "command": "/tmp/rm-ssh-bin/ssh-mcp",
      "args": ["--", "--host=127.0.0.1", "--user=paseo"],
      "env": {
        "FAKE_SSH_MCP_OUTPUT_FILE": "/tmp/rm-remote-output.txt",
        "FAKE_SSH_MCP_CALL_LOG": "/tmp/rm-fake-box-calls.log",
        "FAKE_SSH_MCP_ENV_LOG": "/tmp/rm-fake-box-env.json",
        "FAKE_SSH_MCP_CHILD_PID_FILE": "/tmp/rm-fake-box-child.pid",
        "FAKE_SSH_MCP_OWN": "rm-test"
      }
    },
    "fake-down": {
      "command": "/tmp/rm-ssh-bin/ssh-mcp",
      "args": ["--", "--host=10.0.0.9"],
      "env": { "FAKE_SSH_MCP_EXIT_ON_START": "3", "FAKE_SSH_MCP_OWN": "rm-test" }
    },
    "missing-var-box": {
      "command": "/tmp/rm-ssh-bin/ssh-mcp",
      "args": ["--", "--host=${RM_TEST_UNSET_HOST}"],
      "env": { "FAKE_SSH_MCP_OWN": "rm-test" }
    }
  }
}
JSON
for name in fake-box fake-down missing-var-box; do echo "$name $(server_id "$name")"; done | tee /tmp/rm-server-ids
```

Expected: three `<name> <16 hex>` lines. Call `mcp__playwright__browser_wait_for` with `{"time": 65}`, so the 60 s discovery cache from Step 15's visit has expired (decision 11). Then click the `rm-agent` workspace (leaving the screen) and `Resources` again, and take a snapshot.

Expected: a tab bar (`tablist`) with four tabs in this order: `This instance` (selected), `fake-box`, `fake-down`, `missing-var-box`, and the instance tab below it. `rm-child` has no tab. No problem line shows. The screen fetches the list once per visit (decision 17), so the new entries appear only now. The entries show although `disabledMcpjsonServers` names them (decision 11).

- [ ] **Step 18: Read fake-box and check its session.** Click the `fake-box` tab. Call `mcp__playwright__browser_wait_for` with `{"text": "Top processes"}`, then take a snapshot. Run:

```bash
. /tmp/rm-test.env && mem_guard
cat /tmp/rm-remote-rows.txt
F=$(session_files fake-box); echo "pid file: $F"
stat -c 'run dir mode %a' "$RM_RUN"; stat -c 'pid file mode %a' "$RM_RUN/$F"
G=$(pgid_of "$RM_RUN/$F"); echo "fake-box $G" | tee -a /tmp/rm-groups
node -e 'console.log(Object.keys(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"))).sort().join(","))' "$RM_RUN/$F"
echo "group members: $(pgrep -g "$G" | wc -l)"
C=$(cat /tmp/rm-fake-box-child.pid); echo "sleep child $C in group $(ps -o pgid= -p "$C" | tr -d ' ')"
cat /tmp/rm-fake-box-env.json; echo
node -e 'const fs = require("fs");
const calls = fs.readFileSync(process.argv[1], "utf8").trim().split("\n").map((line) => JSON.parse(line));
const want = fs.readFileSync(process.argv[2], "utf8");
const exact = calls.every((call) => call.arguments?.command === want && Object.keys(call.arguments).length === 1);
console.log(`calls ${calls.length}, tools ${calls.map((call) => call.name).join(",")}, ${exact ? "exact command" : "OTHER COMMAND"}`);' /tmp/rm-fake-box-calls.log /tmp/rm-remote-command.txt
figures daemon "$(sup_pid)" "$SMCP_RUN"
```

Expected on the screen: the source line `/tmp/rm-agent/.mcp.json`; section "Server" with `Memory`, `Swap` and `Load` rows whose text equals the first three lines of `/tmp/rm-remote-rows.txt`, then `Last reading` with a time; "Disks" with one row per mount line, same text; "Top processes" with ten rows, same text and order. No "Unable to read this server" section.

Expected in the shell:

```
pid file: <fake-box id>-<G>.pid
run dir mode 700
pid file mode 600
fake-box <G>
bootId,initStartTime,ownerPid,ownerStartTime,pgid,pidNamespace,startTime
group members: 2
sleep child <C> in group <G>
{"paseo":0,"claudecode":null,"own":"rm-test"}
calls 1, tools exec, exact command
daemon: <Step 15 count + 2> processes, <size>
```

The record carries the pid namespace, boot id and init start time beside the owner (decision 16). `paseo 0` and `claudecode null` show the env strip: the dev daemon inherits `CLAUDECODE` from this Claude Code shell and has `PASEO_HOME`, `PASEO_LISTEN` and more, and none reached the fake. `own rm-test` shows the entry's own env did. The fake's two processes are the daemon's children without an agent id, so they count under "Paseo daemon and terminals" (allow 1 more or fewer for daemon children that came or went since Step 15).

- [ ] **Step 19: Confirm the session is reused across polls.** Run `stat -c '%y' /tmp/rm-fake-box-env.json > /tmp/rm-fake-box-env.time`, call `mcp__playwright__browser_wait_for` with `{"time": 65}`, take a snapshot, then run:

```bash
. /tmp/rm-test.env && mem_guard
echo "calls: $(fake_calls)"; session_files fake-box
[ "$(stat -c '%y' /tmp/rm-fake-box-env.json)" = "$(cat /tmp/rm-fake-box-env.time)" ] && echo "no restart" || echo "RESTARTED"
```

Expected: `calls: 3` (the first read and two 30 s polls; `4` if this step ran a few seconds late), the same single pid file name as Step 18, and `no restart`: one ssh-mcp process served every read (decision 15). The snapshot's `Last reading` is later than Step 18's and the rows are unchanged.

- [ ] **Step 20: Read fake-down.** Click the `fake-down` tab, call `mcp__playwright__browser_wait_for` with `{"text": "Unable to read this server"}`, take a snapshot, and run:

```bash
. /tmp/rm-test.env && mem_guard
echo "fake-down pid files: $(session_files fake-down | wc -l)"
echo "fake processes: $(pgrep -fc '[f]ake-ssh-mcp\.mjs')"
```

Expected on the screen: the source line, then section "Unable to read this server" with `ssh-mcp exited (code 3): fatal: could not connect to 10.0.0.9`, and no Server, Disks or Top processes section. In the shell: `fake-down pid files: 0` (a failed start removes its file) and `fake processes: 2` (rm-child and fake-box). This is the spec's error state with ssh-mcp's message.

- [ ] **Step 21: Read missing-var-box.** Click the `missing-var-box` tab, call `mcp__playwright__browser_wait_for` with `{"text": "Unable to read this server"}`, take a snapshot, and run:

```bash
. /tmp/rm-test.env && mem_guard
echo "missing-var-box pid files: $(session_files missing-var-box | wc -l)"
echo "fake processes: $(pgrep -fc '[f]ake-ssh-mcp\.mjs')"
```

Expected on the screen: section "Unable to read this server" with `The config refers to RM_TEST_UNSET_HOST, which the daemon's environment does not set`. In the shell: `missing-var-box pid files: 0` and `fake processes: 2`: nothing was started with an empty host (decision 11).

- [ ] **Step 22: Leave the server tabs and watch fake-box close after 2 minutes.** Click the `This instance` tab and note the time (`date +%T`). Take a snapshot: `Paseo daemon and terminals` still counts fake-box's two processes. Then run with `run_in_background: true`:

```bash
. /tmp/rm-test.env; G=$(awk '$1 == "fake-box" { g = $2 } END { print g }' /tmp/rm-groups); C=$(cat /tmp/rm-fake-box-child.pid); BEFORE=$(fake_calls)
if timeout 200 bash -c '. /tmp/rm-test.env; while [ -n "$(session_files fake-box)" ] || group_alive "$1"; do sleep 2; done' _ "$G"; then echo "fake-box session closed at $(date +%T): pid file gone, group $G gone"; else echo "TIMEOUT: fake-box session still open"; fi
kill -0 "$C" 2>/dev/null && echo "SLEEP CHILD $C STILL ALIVE" || echo "sleep child $C gone"
echo "calls before $BEFORE, after $(fake_calls)"; mem_guard
```

Expected: `fake-box session closed at <time>`, about 2 minutes after the last fake-box read (between 90 s and 150 s after the noted time, since the last poll came up to 30 s before it); `sleep child <C> gone` (the whole group is killed, not only the leader); `calls before <n>, after <n>` with equal counts; `MemAvailable <n> MB`. fake-down and missing-var-box never had a session. Take a snapshot: `Paseo daemon and terminals` is back to about its Step 15 count. This is the spec's "The MCP client session closes after 2 minutes with the tab closed".

- [ ] **Step 23: A running agent cannot be closed.** Run:

```bash
. /tmp/rm-test.env && mem_guard && dev_cli agent send "$(test_agent_id)" --no-wait "Run the shell command sleep 40, then reply with the word done and nothing else." > /dev/null && echo "prompt sent"
```

Call `mcp__playwright__browser_wait_for` with `{"time": 8}` and take a snapshot. Then run with `run_in_background: true`:

```bash
. /tmp/rm-test.env && dev_cli agent wait "$(test_agent_id)" --timeout 180 > /dev/null; echo "exit=$?"; agent_status "$(test_agent_id)"; mem_guard
```

Expected: `prompt sent`; the snapshot's `rm-claude` hint ends in `running` and its `Close` button is disabled (decision 4); then `exit=0` and `status: idle, archived: false`.

- [ ] **Step 24: The first press arms Close, and it disarms on its own.** Take a snapshot: the `rm-claude` hint ends in `idle for under a minute` and `Close` is enabled. Click `Close` and take a snapshot. Call `mcp__playwright__browser_wait_for` with `{"time": 6}` and take another. Run:

```bash
. /tmp/rm-test.env && mem_guard && echo "agent processes: $(agent_proc_count "$(test_agent_id)")" && agent_status "$(test_agent_id)"
```

Expected: after the click the button reads `Confirm close` and the hint reads `Press again within 5 s to end this agent's runtime; its next prompt resumes it`; after the wait, `Close` and the usual hint are back. The shell shows the agent untouched: `agent processes: <at least 2>`, `status: idle, archived: false`. The SDK has no confirm dialog, so this two-press confirm is the guard (decision 17).

- [ ] **Step 25: Close frees the agent's processes.** Run:

```bash
. /tmp/rm-test.env && mem_guard && figures agent "$(test_agent_id)" && echo "memory.current before: $(( $(cat /sys/fs/cgroup/memory.current) / 1048576 )) MB"
```

Click `Close`, then `Confirm close` within 5 s, and take a snapshot at once. Then run:

```bash
. /tmp/rm-test.env; ID=$(test_agent_id)
if timeout 30 bash -c '. /tmp/rm-test.env; until [ "$(agent_proc_count "$1")" -eq 0 ]; do sleep 1; done' _ "$ID"; then echo "agent $ID has no processes"; else echo "TIMEOUT: agent $ID still has $(agent_proc_count "$ID") processes"; fi
agent_status "$ID"
echo "memory.current after: $(( $(cat /sys/fs/cgroup/memory.current) / 1048576 )) MB"; mem_guard
```

Then take a snapshot.

Expected: the first snapshot may show `Closing...` on a disabled button. The shell prints `agent <id> has no processes` and `status: closed, archived: false`: the runtime ended and the agent stayed (spec, Close). The last snapshot shows "Agents" with `No agent processes` and no error, without waiting for the next poll (the mutation refetches the reading). `memory.current` drops by roughly the agent's size from the first line; page cache can blur that figure by a few hundred MB, so it is recorded, not gated. The process count is the proof that the memory is freed. If the row shows a red refusal instead and the loop prints `TIMEOUT`, the daemon kept the runtime (decision 4) and stopped nothing: `Agent may still run background work; close it once that ends` means the agent's CLI sent no background-task roster or still holds a background task, and `Agent is busy; close it once it is idle` means a turn or another lifecycle operation was in flight. Step 23 asked for a foreground `sleep 40`; if the agent's timeline shows it ran that sleep as a background task, wait 60 s and repeat this step once. Otherwise stop and report the message with the CLI version from Step 2.

- [ ] **Step 26: The next prompt resumes the agent.** Run with `run_in_background: true`:

```bash
. /tmp/rm-test.env && mem_guard && dev_cli agent send "$(test_agent_id)" "Reply with the word resumed and nothing else." --json > /tmp/rm-claude-send.json; echo "exit=$?"; agent_status "$(test_agent_id)"; echo "agent processes: $(agent_proc_count "$(test_agent_id)")"; mem_guard
```

Then take a snapshot.

Expected: `exit=0`, `status: idle, archived: false`, `agent processes: <at least 2>`; the snapshot shows the `rm-claude` row again, with an enabled `Close`. Same agent id: the runtime resumed under the same Paseo agent (`docs/agent-lifecycle.md` "Runtime residency"). This completes the spec's "Close on an idle agent frees its memory, and its next prompt resumes it".

- [ ] **Step 27: Close the agent again before the crash test.** Click `Close`, then `Confirm close`. Run:

```bash
. /tmp/rm-test.env; ID=$(test_agent_id); if timeout 30 bash -c '. /tmp/rm-test.env; until [ "$(agent_proc_count "$1")" -eq 0 ]; do sleep 1; done' _ "$ID"; then echo "agent $ID has no processes"; else echo "TIMEOUT: agent $ID still has processes"; fi; agent_status "$ID"; mem_guard
```

Expected: `agent <id> has no processes` and `status: closed, archived: false`. A refusal on the row with `TIMEOUT` is read as in Step 25: stop and report it. With no agent process left, Step 28's kill leaves only the dev session and the ssh-mcp group to account for.

- [ ] **Step 28: Crash the daemon with kill -9 while a session is open.** Click the `fake-box` tab, call `mcp__playwright__browser_wait_for` with `{"text": "Top processes"}`, then click `This instance` (so the restarted daemon gets no fake-box read). Run at once:

```bash
. /tmp/rm-test.env && mem_guard
F=$(session_files fake-box); G=$(pgid_of "$RM_RUN/$F"); C=$(cat /tmp/rm-fake-box-child.pid)
echo "$F $G $C" | tee /tmp/rm-orphan; echo "fake-box-orphan $G" >> /tmp/rm-groups
SUP=$(sup_pid); WORKER=$(pgrep -P "$SUP" -f daemon-worker); DEVG=$(cat /tmp/rm-dev-daemon.pid)
echo "supervisor=$SUP worker=$WORKER"
[ "${SUP:-0}" -gt 1 ] && [ "${WORKER:-0}" -gt 1 ] && kill -KILL "$WORKER" "$SUP"
if timeout 30 bash -c '. /tmp/rm-test.env; while group_alive "$1"; do sleep 1; done' _ "$DEVG"; then echo "dev session group $DEVG empty"; else echo "TIMEOUT: dev session group $DEVG still has processes"; fi
sleep 2
kill -0 "$G" 2>/dev/null && echo "leader $G still running" || echo "leader $G exited"
group_alive "$G" && echo "fake-box group $G survived the crash" || echo "group $G gone"
kill -0 "$C" 2>/dev/null && echo "sleep child $C alive" || echo "sleep child $C gone"
test -e "$RM_RUN/$F" && echo "pid file $F left behind" || echo "no pid file"
```

Expected: `<file> <G> <C>`, a single worker pid, `dev session group <DEVG> empty`, `leader <G> exited` (its stdin closed with the worker), `fake-box group <G> survived the crash`, `sleep child <C> alive` and `pid file <file> left behind`. SIGKILL skips every cleanup path. The ssh-mcp group is its own session (detached spawn), so the dead daemon leaves the group's other members running, as a real ssh-mcp leaves its `ssh` client. rm-http survives the same way; shared-mcp reclaims it on the next start.

- [ ] **Step 29: Restart the dev daemon and confirm the reclaim.** Run `. /tmp/rm-test.env && mem_guard && start_dev_daemon && wait_for_file /tmp/rm-dev-daemon.pid && echo "dev session pgid=$(cat /tmp/rm-dev-daemon.pid)"`, then run with `run_in_background: true`:

```bash
. /tmp/rm-test.env; read -r F G C < /tmp/rm-orphan
if timeout 300 bash -c '. /tmp/rm-test.env; until [ "$(dev_health)" = 200 ] && ! group_alive "$1" && [ ! -e "$RM_RUN/$2" ]; do sleep 2; done' _ "$G" "$F"; then echo "orphan group $G killed and $F removed"; else echo "TIMEOUT: orphan group $G or $F still there"; fi
kill -0 "$C" 2>/dev/null && echo "SLEEP CHILD $C STILL ALIVE" || echo "sleep child $C gone"
ls -A "$RM_RUN"; mem_guard
```

Expected: `orphan group <G> killed and <file> removed`, `sleep child <C> gone`, an empty `ls`, and `MemAvailable <n> MB`. The file's owner (the old worker) is dead, its pid space is this container run's, and its group lives with the leader gone, so `reclaimPidFile` kills the group and removes the file (Task 4, `isRecordedGroup`). On `TIMEOUT` with the group alive, reclaim did not run: read `grep resource-manager "$DEV_HOME/daemon.log" | tail -n 20`.

- [ ] **Step 30: The screen reconnects and fake-box reads again.** Take a snapshot: the Resources screen shows the instance tab with a `Last reading` after the restart, and the four tabs. Click `fake-box`, call `mcp__playwright__browser_wait_for` with `{"text": "Top processes"}`, and run:

```bash
. /tmp/rm-test.env && mem_guard && F=$(session_files fake-box) && G2=$(pgid_of "$RM_RUN/$F") && echo "fake-box-final $G2" | tee -a /tmp/rm-groups && read -r _ G _ < /tmp/rm-orphan && [ "$G2" != "$G" ] && echo "new session group $G2"
```

Expected: `fake-box-final <G2>` and `new session group <G2>`; the tab shows the Step 18 rows again.

- [ ] **Step 31: Archive the agent, stop the daemon gracefully, and check for orphans.** Run:

```bash
. /tmp/rm-test.env && mem_guard
ID=$(test_agent_id); dev_cli agent archive "$ID" > /dev/null && echo "agent $ID archived"
SUP=$(sup_pid); DEVG=$(cat /tmp/rm-dev-daemon.pid); echo "supervisor=$SUP"
[ "${SUP:-0}" -gt 1 ] && kill -TERM "$SUP"
if timeout 30 bash -c 'while kill -0 "$1" 2>/dev/null; do sleep 1; done' _ "$SUP"; then echo "supervisor $SUP exited"; else echo "TIMEOUT: supervisor $SUP still running"; fi
if timeout 30 bash -c '. /tmp/rm-test.env; while group_alive "$1"; do sleep 1; done' _ "$DEVG"; then echo "dev session group $DEVG empty"; else echo "TIMEOUT: dev session group $DEVG still has processes"; fi
sleep 3
for g in $(awk '{ print $NF }' /tmp/rm-groups | sort -u); do group_alive "$g" && echo "LIVE GROUP $g"; done
echo "run dir: $(ls -A "$RM_RUN" | wc -l) files"
echo "agent processes: $(agent_proc_count "$ID")"
for p in 6768 18961; do listening "$p" || echo "$p closed"; done
```

Expected: `agent <id> archived`, `supervisor <SUP> exited` within about 10 s, `dev session group <DEVG> empty`, no `LIVE GROUP` line (fake-box's final group included), `run dir: 0 files`, `agent processes: 0`, `6768 closed`, `18961 closed`. The plugin's cleanup closes the open fake-box session inside the daemon's 2 s budget. If `run dir` shows `1 files` while the group is gone, the budget ran out after the kill and before the file was removed; the next start removes it as stale. Record that as a finding, not a failure.

- [ ] **Step 32: Close the browser tab, stop Metro and the watcher, and remove the password.** Call `mcp__playwright__browser_tabs` with `{"action": "list"}`, then `{"action": "close", "index": <index of the http://172.22.0.3:8081 tab>}`. Then run:

```bash
. /tmp/rm-test.env
APPG=$(cat /tmp/rm-dev-app.pid)
[ "${APPG:-0}" -gt 1 ] && kill -TERM -- "-$APPG"
if timeout 30 bash -c '. /tmp/rm-test.env; while group_alive "$1"; do sleep 1; done' _ "$APPG"; then echo "Metro group $APPG stopped"; else echo "TIMEOUT: Metro group $APPG still running"; fi
listening 8081 || echo "8081 closed"
W=$(cat /tmp/rm-mem-watch.pid); tr '\0' ' ' < "/proc/$W/cmdline" 2>/dev/null | grep -q rm-mem-low && kill -TERM "$W" && echo "memory watcher $W stopped"
echo "low-memory samples: $(wc -l < /tmp/rm-mem-low)"
stop_gate_process /tmp/rm-spin.pid 'timeout 30'; stop_gate_process /tmp/rm-gate.pid 'sleep 600'
rm -f /tmp/rm-dev-password && echo "dev password file removed"
```

Expected: `Metro group <APPG> stopped` (this releases `/tmp/paseo-heavy.lock`), `8081 closed`, `memory watcher <W> stopped`, `low-memory samples: 0`, and `dev password file removed`. The two gate processes are already gone, so `stop_gate_process` prints nothing. On a `TIMEOUT`, run **Abort and clean up**. The test dev home stays for inspection; the one before it stays at `.dev/paseo-home.before-resource-manager-<timestamp>`.

- [ ] **Step 33: Write the resource-manager paragraphs.** Run:

```bash
cd /workspace/utils/paseo && cat /tmp/rm-sidebar-before && grep -n -A5 '^Local runs of' docs/plugins.md
```

The first line is `visible` or `hidden` (Step 12). The grep prints the one "Local runs of ..." paragraph. The heavy-command gate (sub-project 2) lands before this plugin (controller, 2026-11-07) and rewrites that paragraph in its Task 10 Step 21, so expect its text:

- **G, the gate's paragraph** (five lines that name `shared-mcp` and `heavy-command-gate`), the expected case. Replace

```
Local runs of `scripts/builtin-plugins-dist.test.mjs` and
`packages/server/src/server/plugins/lifecycle.e2e.test.ts` start `shared-mcp` and
`heavy-command-gate` in process, so give them `PASEO_HOME=$(mktemp -d)`. Otherwise they work in the
real `$PASEO_HOME/shared-mcp` and `$PASEO_HOME/heavy-command-gate`, and can rewrite the shims that
live agents use.
```

with the three paragraphs below, then

```
Local runs of `scripts/builtin-plugins-dist.test.mjs` and
`packages/server/src/server/plugins/lifecycle.e2e.test.ts` start `shared-mcp`,
`heavy-command-gate` and `resource-manager` in process, so give them `PASEO_HOME=$(mktemp -d)`.
Otherwise they work in the real `$PASEO_HOME/shared-mcp`, `$PASEO_HOME/heavy-command-gate` and
`$PASEO_HOME/resource-manager`, and the gate can rewrite the shims that live agents use.
```

- **The shared-mcp paragraph** (three lines that say `start this built-in in process`, `docs/plugins.md:135-137` on `main` at `1eaa71b2f`): the gate has not landed, which the program order rules out. Stop and report it; do not edit the doc, since the gate's Step 21 replaces that paragraph and would no longer match.
- **Anything else** (the gate's executor reworded its paragraph): put the three paragraphs just before the "Local runs of" paragraph, and in that paragraph add `resource-manager` to the built-ins it names and `$PASEO_HOME/resource-manager` to the homes, keeping the rest of its wording. Report the paragraph you wrote.

The three paragraphs, with one blank line after each, so a blank line also separates the third from the "Local runs of" paragraph:

```
The `resource-manager` built-in adds a Resources item to the sidebar. Its first tab shows this
instance's container memory, swap, host memory, and load, then memory and CPU for each agent and
for four groups: the daemon, the shared MCP servers, commands the heavy-command gate let through,
and everything else. A process counts against the agent named by `PASEO_AGENT_ID` in its
environment, and children inherit it, so an agent's MCP servers count against that agent. Close
ends an idle agent's runtime when it has a saved provider session and no work in flight, its
background tasks included; otherwise the row says why it stays open. The agent stays, and its
next prompt resumes it. The readings come from Linux `/proc` and cgroup v2.
Settings > Sidebar can hide the item.

Every stdio MCP entry that runs `ssh-mcp` gets a read-only tab of its own: entries in the user and
local scope of `~/.claude.json` (`$CLAUDE_CONFIG_DIR/.claude.json` when that is set) and in each
workspace's `.mcp.json`. When the tab opens, the plugin starts the entry's server, connects to it
as an MCP client, and sends one fixed command that reads memory, load, disks, and processes. The
session closes 2 minutes after the tab closes, and counts under the daemon group while it runs.
An entry shows even where `disabledMcpjsonServers` keeps Claude from starting it, and a config
change shows the next time the screen opens, at most a minute later. Each session's pid file is
in `$PASEO_HOME/resource-manager/run/`, and the next daemon start stops any session a crashed
daemon left behind.

`plugins/resource-manager/server/local/procfs.ts` is a byte-for-byte copy of
`plugins/shared-mcp/server/procfs.ts`, because a built-in cannot import another built-in's files.
`procfs-copy.test.ts` fails when the two differ, so change both together.
```

When `/tmp/rm-sidebar-before` reads `hidden`, the first paragraph's last line is `Settings > Sidebar can hide the item. It appears once a workspace on that host is open.` instead of `Settings > Sidebar can hide the item.`, as the shared-mcp paragraph says for its Command Center item.

Each claim maps to a step or a source: the item and its four groups (Steps 12, 15, 16), attribution through `PASEO_AGENT_ID` and children (Steps 14, 15), Close for an idle agent with a saved provider session and no work in flight, background tasks included, the refusal that says why, and the resume (Steps 23-27, decision 4, Task 2's AgentManager and session tests with its Step 27 paragraph, and Task 6's refusal tests), `/proc` and cgroup v2 (decision 10), Settings > Sidebar (Step 15), the three config scopes and `CLAUDE_CONFIG_DIR` (decision 11, Task 7), the start on tab open and the fixed command (Steps 18, 19, decision 14), the 2-minute close (Step 22), the daemon group (Steps 18, 22), `disabledMcpjsonServers` and the minute's delay (Step 17), the pid files and the reclaim (Steps 18, 28, 29), the procfs copy (Task 1), and the temp home (Step 3). The gate's words in the G paragraph are its Step 21 text. Every new paragraph, the "hidden" line included, passed `check_prose` with no finding (no dashes, stock words, bold labels or curly quotes), and every line is under 100 columns, the widest at 98.

- [ ] **Step 34: Format and check the doc.** Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- docs/plugins.md && npm run format:check:files -- docs/plugins.md && git diff --stat -- docs/plugins.md && grep -nE '^The .resource-manager. built-in adds|byte-for-byte copy of|^Local runs of|^Desktop packaging ships' docs/plugins.md
```

Expected: both oxfmt runs exit 0 and the diff is `docs/plugins.md` only, `28 insertions(+), 4 deletions(-)`, and the grep prints four lines in that order, 20, 4 and 6 lines apart. "Local runs of" appears once. The "hidden" wording changes a line, not the count. After the fallback edit the counts differ: read the diff instead. If oxfmt rewrapped anything, read the diff and keep its wrapping.

- [ ] **Step 35: Commit with the fork identity.** Metro and the dev daemon are stopped (Steps 31 and 32), so the commit can take the heavy lock that its hook's typecheck needs. Stage the doc and list what is staged:

```bash
cd /workspace/utils/paseo && git add docs/plugins.md && git diff --cached --name-only
```

Expected: exactly one line, `docs/plugins.md`. This checkout is shared with other sessions, so another path in that list is someone else's staged work: stop and ask the user; do not commit or unstage it. Only when the list is `docs/plugins.md` alone, run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "docs(fork): resource-manager built-in" -- docs/plugins.md
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo status --short --untracked-files=all -- docs/plugins.md
```

Expected: the lefthook hook passes (format, lint, full typecheck under the lock); `1 file changed, 28 insertions(+), 4 deletions(-)` (with the fallback edit, the counts from Step 34); `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `status` prints nothing. If a hook job fails, git made no commit: report the output and stop. Do not push.

---

### Task 14: Check on the instance that has ssh-mcp (deferred to sub-project 6, ops; not executed in this plan's run)

**Not executed in this plan's run: deferred to sub-project 6 (ops), which the user deferred** (controller, 2026-11-07). Do not run this task while executing this plan; the run ends with Task 13, and this task's checkboxes stay unchecked. The spec's first manual check ("on the instance with ssh-mcp, the server tabs appear and show live numbers") needs the other Paseo instance, its real ssh-mcp entries and the fork build deployed there. Deploying is ops work: a push to `main` redeploys every instance through Dokploy, which this plan never does (Global Constraints, Commits). Sub-project 6 runs this task after it deploys the commits of Tasks 1-13. Nothing here runs in this sub-project, and no step below changes code. A failed check becomes a new task in sub-project 6's plan, with a test that reproduces it first.

**Files:**

- None in the repository. Scratch on that instance: `/tmp/rm-ops/` (the Step 1 count script and the timings), removed in Step 8.

**Interfaces:**

- Consumes: everything Task 13 consumes, plus the instance's own ssh-mcp entries, found by the same rules (decision 11), and the ssh-mcp package each entry runs (1.x with `exec`, or 2.x with `run-command`; decision 13).
- Produces: a findings note in sub-project 6's plan with, per entry: ssh-mcp version and tool, first-start time, whether the reading succeeded, and any policy or approval message. No code, no new exports.

Ground rules: the same as Task 13 for secrets, signals and memory, on that instance. Never print an entry's args or env: they hold hosts, users and key paths. Close only an agent its owner agreed to close. Never edit the instance's Claude configs or ssh-mcp settings from this task.

- [ ] **Step 1: Inventory the ssh-mcp entries by count and name.** On that instance, run the Task 13 Step 6 counting script against `${CLAUDE_CONFIG_DIR:-$HOME}/.claude.json`, extended to print each matching entry's name and scope (`user`, `local:<dir>` or `project:<file>` for every workspace directory `paseo workspace ls --json` lists), never its args or env. Expected: at least one entry. Zero means the instance's configs differ from what the spec assumed: stop and report.
- [ ] **Step 2: Record each entry's ssh-mcp version.** Read the version from the package the command resolves to: the `node_modules/ssh-mcp/package.json` under `~/.npm/_npx/*/` for an `npx ssh-mcp@...` entry, or the global install for a bare `ssh-mcp` command. Expected: a version per entry. 1.x serves `exec` and rejects a command that writes anything to stderr; 2.x serves `run-command` and may apply a policy, an approval gate or a viewer role to it.
- [ ] **Step 3: Time the first start.** With the npx cache for that version cleared only if the owner agrees (otherwise record "warm cache"), open Resources, select an ssh-mcp tab, and time it until `Last reading` shows. Expected: under 40 s on a warm cache. Between 40 s and 120 s the tab first shows "No answer from ssh-mcp after 40 s; the reading shows on a later refresh", and the reading follows on a later poll (decision 15). Past 120 s the start times out and the next poll tries again; record it as a finding.
- [ ] **Step 4: Compare the numbers with the host.** Ask an agent on that instance, which already uses the same ssh-mcp entry, to run `nproc && df -P && free -b` through it and paste the output. Expected: `Load` names the same core count; each `Disks` row matches a `df -P` line within the change between the two reads; `Memory` total matches `free -b`'s total, and its used share is within a few percent. Leave the tab open for 2 minutes: `Last reading` advances every 30 s and the numbers move with the host (the spec's "live numbers").
- [ ] **Step 5: Check the 2.x policy path, when an entry runs 2.x.** Expected: the reading succeeds, and ssh-mcp's audit log, if it keeps one, gains one line per 30 s poll while the tab is open. A policy, approval or role message in the tab's error state means the constant command (decision 14) is refused: record the message word for word. The fix is sub-project 6's choice between an allow rule for that exact command in the instance's ssh-mcp settings and a change to this plugin with its own tests. Record the audit log's growth per hour of an open tab.
- [ ] **Step 6: Check the error state on a real host.** Only where the owner has an entry that is down or a host without `/proc`, open its tab. Expected: "Unable to read this server" with ssh-mcp's own message. Without one, Task 13 Steps 20 and 21 stand for it; record "not available".
- [ ] **Step 7: Check that the session closes.** Leave every ssh-mcp tab and wait 150 s. Expected: `ls -A "$PASEO_HOME/resource-manager/run"` prints nothing, and the count of `ssh-mcp` processes without a `PASEO_AGENT_ID` in their environment (agents' own sessions carry one) is back to its value before Step 3.
- [ ] **Step 8: Write the findings note and clean up.** Put the Step 1-7 results in sub-project 6's plan, one line per entry and check, then `rm -rf /tmp/rm-ops`. Expected: the note names the version, tool, first-start time and outcome of every entry, and lists each failed check as a new task.

---

## Self-review

### Spec coverage

| Spec requirement                                                                                                   | Task                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Problem: show where an instance's memory went, per agent and MCP server                                            | Tasks 5, 6, 12; checked in Task 13 Steps 14-15                                                                                                                                                                                                                                                                                                  |
| Scope: instance screen with memory and CPU per agent and Close for an idle agent                                   | Tasks 2, 5, 6, 11, 12; Task 13 Steps 15, 23-26                                                                                                                                                                                                                                                                                                  |
| Scope: one read-only page per ssh-mcp server                                                                       | Tasks 7-12; Task 13 Steps 17-21                                                                                                                                                                                                                                                                                                                 |
| Out of scope: history, alerts, remote actions, servers outside ssh-mcp                                             | Nothing is built for them; the remote command is a read-only constant (Task 8)                                                                                                                                                                                                                                                                  |
| Decision "Remote metrics": MCP client of each entry, exec tool, one fixed read-only command, no stored credentials | Tasks 8, 9, 10 (decisions 13, 14); the plugin stores only pid files (Task 4)                                                                                                                                                                                                                                                                    |
| Decision "Server list": every entry in user and workspace scope whose command runs ssh-mcp, one per server         | Task 7 (decisions 11, 12); Task 13 Step 17                                                                                                                                                                                                                                                                                                      |
| Decision "No ssh-mcp": only the server tabs hide                                                                   | Task 12 (`ResourcesScreen` shows the tab bar only with servers); Task 13 Steps 12, 15                                                                                                                                                                                                                                                           |
| Decision "Agent attribution": `PASEO_AGENT_ID` in environ, children inherit                                        | Task 5 (decision 6); Task 13 Steps 14, 15                                                                                                                                                                                                                                                                                                       |
| Decision "Close": ends the runtime, the agent stays, its next prompt resumes it                                    | Task 2 (new RPC behind `agentRuntimeClose`, and `AgentManager.closeRuntimeIfIdle`, which makes idle collection's checks and refuses with a reason; decisions 3, 4), Task 6 (`closeIdleAgent`, which refuses a non-idle agent and one with no `persistence` handle, because only a saved provider session resumes), Task 12; Task 13 Steps 23-27 |
| Decision "Other plugins' data": shared MCP and gate processes as groups only                                       | Task 5 (`readSharedMcpPids`, `HEAVY_GATE_ENV`); Task 13 Steps 15, 16                                                                                                                                                                                                                                                                            |
| Surface: Resources sidebar item, tabs "This instance" then one per server                                          | Task 12; Task 13 Steps 12, 15, 17                                                                                                                                                                                                                                                                                                               |
| Instance header: `memory.current` and `memory.max`, swap, host `MemAvailable`, load against cores                  | Task 3 (`readHostSummary`), Task 12 (`hostRows`); Task 13 Step 15                                                                                                                                                                                                                                                                               |
| Agent row: title, provider, total RSS with children, CPU %, idle time, Close                                       | Tasks 5, 6, 12 (decisions 8, 9); Task 13 Step 15                                                                                                                                                                                                                                                                                                |
| Group rows: daemon, shared MCP, heavy-gate commands, everything else                                               | Tasks 5, 6, 12 (decisions 6, 7); Task 13 Steps 15, 16                                                                                                                                                                                                                                                                                           |
| Instance refresh every 5 s while open                                                                              | Task 12 (`POLL_MS = 5_000`, query observer); Task 13 Step 15                                                                                                                                                                                                                                                                                    |
| Server tab: memory and swap, load against cores, disk per mount, top 10 by RSS                                     | Task 8 (`parseRemoteOutput`), Task 12 (`serverRows`, `mountRow`, `processRow`); Task 13 Step 18                                                                                                                                                                                                                                                 |
| Server tab: time of the last reading; error state with ssh-mcp's message                                           | Task 8 (`toolErrorMessage`: a failed `run-command` shows its exit code or signal and stderr, any other tool error its text), Tasks 10, 12; Task 13 Steps 18, 20, 21                                                                                                                                                                             |
| Server tab: polls every 30 s while open; session closes 2 minutes after                                            | Task 12 (30 s), Task 10 (`SESSION_TIMING.idleMs`); Task 13 Steps 19, 22                                                                                                                                                                                                                                                                         |
| Components: `shared/`, `server/local/`, `server/remote/`, `index.client.tsx` and `client/`                         | File structure; Tasks 1, 3-12                                                                                                                                                                                                                                                                                                                   |
| Components: the process-group RSS reader is shared with shared-mcp's                                               | Task 1 (verbatim copy plus drift test; see the procfs section)                                                                                                                                                                                                                                                                                  |
| RPC names `resource-manager.local/servers/server/close_agent.request`                                              | Task 1 (`shared/rpc.ts`), Task 11 (handlers)                                                                                                                                                                                                                                                                                                    |
| Safety: constant command with no input; never writes remotely                                                      | Task 8 (`REMOTE_COMMAND`, decision 14); Task 13 Step 18 checks the exact command                                                                                                                                                                                                                                                                |
| Safety: Close acts on local agents through the SDK, with the app's permission checks                               | Task 2 (permission `["workspace.write", "hub.execute"]`, as `archive_agent_request`; the daemon refuses a close that would lose work), Task 6                                                                                                                                                                                                   |
| Testing, unit: meminfo, loadavg, `df -P`, `ps` parsers from real samples                                           | Tasks 3, 8 (`REMOTE_OUTPUT_SAMPLE` from this container)                                                                                                                                                                                                                                                                                         |
| Testing, unit: process-to-agent mapping over a fake `/proc` tree                                                   | Tasks 4 (`writeFakeProc`), 5                                                                                                                                                                                                                                                                                                                    |
| Testing, unit: discovery from config fixtures, including non-ssh-mcp entries                                       | Task 7                                                                                                                                                                                                                                                                                                                                          |
| Testing, integration: a fake ssh-mcp stdio server answering the exec tool                                          | Tasks 9, 10 (posix tests)                                                                                                                                                                                                                                                                                                                       |
| Testing, manual: on this instance only the instance tab shows; Close frees memory and the next prompt resumes      | Task 13 Steps 12, 15, 25, 26                                                                                                                                                                                                                                                                                                                    |
| Testing, manual: on the instance with ssh-mcp the server tabs show live numbers                                    | **Not executed in this plan's run.** Task 14, deferred to sub-project 6 (ops), which the user deferred (controller, 2026-11-07). Task 13 checks the same path end to end with a fake ssh-mcp.                                                                                                                                                   |

### Placeholder scan

No "TBD", "TODO", "implement later", "similar to Task N" or "add error handling" in any step; every code step holds the full code. The `<...>` items in Expected blocks of Tasks 13 and 14 are values a run reads off its own machine (pids, sizes, times), each with the rule that judges it. Task 14 is a checklist by design: it runs on an instance this plan cannot reach, it produces findings, not code, and this plan's run does not execute it.

### Type consistency

- `McpStdioClient` (Task 9) satisfies `SessionClient` (Task 10) structurally: `get closed(): boolean` for `readonly closed`, `listTools(): Promise<string[]>`, `callTool(name: string, args: Record<string, unknown>): Promise<ToolCallResult>`, `close(): Promise<void>`. `startMcpStdioClient(command: McpServerCommand, options: McpStdioOptions, signal?: AbortSignal): Promise<McpStdioClient>` fits `StartClient = (server: SshServer, signal: AbortSignal) => Promise<SessionClient>` through Task 11's wrapper, which maps `SshServer` to `{ command, args, env }`.
- `paseoPorts(paseo: PluginHandlerContext["paseo"])` (Task 6) passes a request without `subscribe`, so the non-subscribe overload of `PaseoAgentActions.list` (`packages/client/src/index.ts:405-412`) is chosen; `ref(agentId)` (`:413`) returns a `PaseoAgentHandle` with `refresh()` (`:380`, `PaseoAgentRefetchResult` at `:283-286`) and Task 2's `closeRuntime()`. The narrow `AgentsPort`/`WorkspacesPort` interfaces are what `FakeAgents`/`FakeWorkspaces` implement, so the tests and the adapter share one contract.
- `AgentManager.closeRuntimeIfIdle(agentId: string): Promise<string | null>` (Task 2) returns `null` or a refusal; the session handler sends `accepted: refusal === null, error: refusal`, which fits `AgentActionResponsePayloadSchema`'s `error: z.string().nullable()`; `DaemonClient.closeAgentRuntime` turns `accepted: false` into an `Error` carrying that string, and `closeIdleAgent` (Task 6) returns its message as `CloseAgentResult.error`, which the row shows. `agentRuntimeClose` is `z.boolean().optional()` in the protocol, `true` in `buildServerInfoStatusPayload`, and compared with `!== true` in the client gate.
- `AgentSummary.persistence: { sessionId: string } | null` (Task 6) is the slice of `AgentSnapshotPayload.persistence` (`AgentPersistenceHandle | null`, `packages/protocol/src/messages.ts:840-847`, `:881`) that `closeIdleAgent` checks; every `FakeAgents` fixture (Tasks 6 and 11) sets it. `LiveAgent` does not carry it, because only Close needs it.
- `splitTrailers` returns `CommandOutput { stdout; stderr; exitCode; signal }` and `toolErrorMessage(text)` (Task 8) reads it; Task 10's `isError` branch is its one caller. `readLines(stream, onLine)` (Task 9) is exported only for its own test.
- `PidRecordSchema` (Task 4) uses shared-mcp's field names (`process-runner.ts:56-64`) with `pidNamespace`, `bootId` and `initStartTime` nullish, so one reader parses both plugins' files and treats a record without them as stale.
- `parseRemoteOutput` (Task 8) returns `RemoteSnapshot` from `shared/rpc.ts` (Task 1), which `ServerReading.snapshot` carries and `serverRows`/`mountRow`/`processRow` (Task 12) take. `LocalReader.read` (Task 6) returns `LocalReading`, which `hostRows`, `describeAgent` and `describeGroup` take. Every handler output goes through the `defineRpc` output schema.
- Cleanup within about 2 s: `contribute` returns `() => manager.stop()`; `stop()` calls `RemoteSessions.closeAll()`, which closes each client (stdin end, then `killGroup` with a 2 s grace) and removes its pid file. ssh-mcp exits on stdin close, so the grace is rarely used. When it is, the daemon's wait can end first, and the next start's reclaim finishes the job (Task 13 Step 31 records it).
- Test fixtures are typed with interfaces (`FakeProcess`, `FakePidSpace`, `FakeAnswer`, `StartRecord`) because test files are outside the plugins typecheck; no `as` cast bypasses an error, and no test uses `vi.mock`, `vi.spyOn` or fake timers.

### Deviations from the spec

- **Shared reader.** The spec says the RSS reader "is shared"; the built-in import boundary rules out an import, so it is a verbatim copy with a drift test (Task 1, procfs section).
- **Close needs a new daemon RPC.** The spec assumes the SDK can close a runtime; it cannot, so Task 2 adds `agent.runtime.close.request` and `PaseoAgentHandle.closeRuntime()`, behind `server_info.features.agentRuntimeClose` (decision 3).
- **Close needs a saved provider session.** The spec's "its next prompt resumes it" holds only for an agent with a `persistence` handle; for one without, Close is refused (decision 4).
- **Close refuses an idle agent that would lose work.** The spec's "close an idle agent's runtime" is read as idle collection reads idle: a turn, a permission, lifecycle work, a running provider subagent or a background task the provider reports refuses the close with a reason, and so does a Claude CLI older than 2.1.292 that has sent no task roster (decision 4, controller ruling 2026-11-07).
- **Server list.** "Whose command runs ssh-mcp" also matches an argument before `--` (`npx -y ssh-mcp@1.0.7 -- ...`), the usual form, and `${VAR}` expands as Claude Code does (decision 11).
- **Session close.** "2 minutes with the tab closed" is implemented as 2 minutes after the last read; with a 30 s poll the two differ by under 30 s (decision 15).
- **Remote tool.** ssh-mcp 2.x has no `exec`; its `run-command` is used instead (decision 13).
- **Command Center.** None: the spec names only the sidebar item, and the Command Center shows only inside a workspace (decision 17).
- **Manual check on the ssh-mcp instance** is Task 14, deferred to sub-project 6 (ops) and not executed in this plan's run; Task 13 covers the same path with a fake ssh-mcp.

## Critique log

Review of the draft against the spec, the code on `main` at `1eaa71b2f`, the critiqued gate plan and the writing-plans reviewer rubric. One line per defect: what was wrong, then what changed.

1. API reality: the cross-plan intro and procfs option 1 cited `compiler-build.ts:21-31` and `:68-77`. `directoryTarget` is at `:21-32` and `moduleBoundaryError` at `:69-89`, its message at `:76`; both citations fixed.
2. API reality: Task 4's pid-file comment cited shared-mcp's `isRecordedGroup` at `process-runner.ts:465-469`. It is at `:472-476`; fixed.
3. API reality: Task 13 cited `scripts/dev-runner.ts:10`, which does not exist. Now `packages/server/scripts/dev-runner.ts:10`.
4. API reality: Task 1's `index.ts:18-19` moves down a line once the gate's registry entry lands first. The Files line says so; Step 9's replacement text matches either way.
5. Spec coverage: Close took any idle or errored agent, but one without a `persistence` handle gets a fresh provider session on its next prompt (`agent-loading.ts:71-160`), so "its next prompt resumes it" failed. Decision 4, Task 6 (`AgentSummary.persistence`, the refusal and its test) and Task 11's fake now require a saved session, and Self-review lists it.
6. Spec coverage: Close skips idle collection's `runtimeHasNoPendingWork` and `canStopRuntime` checks, so it ends the background tasks and provider subagents of an agent whose status is `idle`, while the plan, the docs and the confirm hint promised nothing is lost. Decision 4, the lifecycle doc paragraph (Task 2 Step 19), the plugin paragraph (Task 13 Step 33), `ARMED_HINT` and the Task 13 expectations now say so. The choice between this and a guarded close is open below.
7. Docs: Task 2 Step 19's paragraph said the RPC closes a runtime "as idle collection does". It does not check what idle collection checks; the paragraph and its rationale now state the difference.
8. Spec coverage: a failed ssh-mcp 2.x `run-command` (`isError`) showed its raw text, `@@meminfo` and markers included, as the error. Task 8 adds `toolErrorMessage` (exit code or signal plus stderr, else the trimmed text) with three tests, and Task 10 uses it, with a new unit test.
9. API reality: `splitTrailers` ignored ssh-mcp 2.x's `[killed by SIG...]` marker, and the fixtures and fake ssh-mcp added `[exit 0]` to a clean run with no blank lines. ssh-mcp 2.23.1 `build/tools/results.js` joins its parts with blank lines and adds a marker only on failure. Task 8 (`CommandOutput.signal`, fixtures, tests), the fake ssh-mcp (Task 9, `FAKE_SSH_MCP_STDERR`) and Task 10's fixtures follow it, and the posix run-command test sends a stderr block.
10. In-process safety: Task 9's `readLines` had no `error` listener on the readline interface, which re-emits its input stream's error, so a broken child stdout would throw uncaught in the daemon (confirmed with a probe). It now has `lines.on("error")`, is exported, and has a test that leaves an unhandled error without the listener.
11. Test design: Task 6 wrote `paseo-ports.ts` before its tests and faked the red run by setting `LIVE_STATUSES` to `[]`. The tests and fakes come first and fail on the missing `fake-ports.js`; steps renumbered.
12. Test design: fifteen expected failures read `Failed to load url ./x.js`. Vitest 4.1.7 prints `Cannot find module './x.js' imported from <test file>` and `Tests  no tests` (shared-mcp sdd `task-1-report.md:22`); all fifteen now say so, and the Global Constraints explain it.
13. Test design: Task 10 Step 3 blamed the failing import on `fakes.ts`, whose type-only import esbuild erases. It now names the test file's own import.
14. Test design: the expected counts would have drifted with the added tests. Task 6 now expects 9, Task 8 17, Task 9 12 and Task 10 15, each checked against the `it(` calls in its file.
15. Repo rules (`docs/design.md`): the selected tab was an inverted accent fill, the others bordered. Accent is the one primary action, a selected segment is a quiet fill with foreground text, and single-thing borders are wrong. Tabs are now borderless, the selected one `surface2` with `foreground` text, the rest `foregroundMuted`; the Interfaces list matches.
16. Host safety: Task 13 Step 3 recovered from a hung dist test with `pgrep -af 'builtin-plugins-dist.test.mjs'` and SIGTERM to every pid listed. `-a` prints command lines, the pattern matches the executor's own shell, and another session may run the same test. The run uses `timeout -k 10 300`, whose group kill leaves nothing behind, and the step rules out a kill by pattern.
17. Host safety: Step 35 said the hook takes the heavy lock; the outer `flock` takes it for the commit and its hook. Reworded.
18. Cross-plan: Task 13 Step 33 anchored on the three-line "Local runs" paragraph that the gate, landing first, rewrites; it appended its paragraphs after that paragraph instead of integrating them, and its third paragraph pointed at "the test runs named above". Step 33 now finds the paragraph (gate text G, `main` text M, or a fallback), puts the three paragraphs before it and adds `resource-manager` to it. Steps 34 and 35 give the counts and line order for G and M, checked by applying both edits to `main`'s `docs/plugins.md` in memory.
19. Cross-plan: the interfaces table marked the gate variable RECONCILE, said "the shim's own node process" carries no marker, left the docs row unsettled and asked the gate to copy shared-mcp's reader. The variable is agreed with the critiqued gate plan (decision 14, `HELD_ENV`, value `1`, "the shim that asked the gate"), the docs row is settled on this side for either order, and procfs is "no dependency", because the gate needs a pid-rooted walk that shared-mcp's reader lacks.

Checked with no change: task size (each task's modules have their own red and green cycle and one commit; splitting would renumber cross-references for no gain); the throwaway dev password Task 13 Step 11 prints (made for the run, guards a bridge-only daemon, deleted in Step 32); Metro holding the heavy lock from Step 10 to Step 32 (the ground rules and the abort path cover it); commits (flock, tatsuya env, explicit pathspec, no `LEFTHOOK=0`); nothing signals 6767.

### Controller amendments (2026-11-07)

The rulings under "Controller resolutions", applied to the draft. Entries 6, 7 and 14 above describe the draft before these changes.

1. Task 2 rewritten around the guarded close: `AgentManager.closeRuntimeIfIdle(agentId): Promise<string | null>` checks a saved session and `runtimeHasNoPendingWork`, asks `canStopRuntime` under 10 s, then runs `closeAgentRuntime(agentId, isEligible)` in the lane behind the `collectingRuntimes` barrier, and returns a refusal reason instead of stopping anything. Five AgentManager tests (Steps 14-17); the session handler passes the reason on, with a fourth session test; 30 steps and 16 committed files.
2. Task 2 adds `server_info.features.agentRuntimeClose` (protocol schema and test, daemon `buildServerInfoStatusPayload` and its `server_info` assertion), and `DaemonClient.closeAgentRuntime` fails fast without it with "Update the host to close agent runtimes."; all three sites carry a `COMPAT(agentRuntimeClose)` tag. The daemon-client and handle tests are 3 each, a fail-fast test included, renamed so their `-t` filters select all of them (`-t "runtime close"` had matched one of two).
3. Task 2's docs: the `docs/agent-lifecycle.md` paragraph moves after the runtime safety contract paragraph and describes the guarded close; both SDK reference rows say `closeRuntime()` rejects with the reason.
4. Decisions 3 (the flag), 4 (the guarded close, the barrier closing the prompt race, the family and caller checks it skips, Claude 2.1.292), 17 (no warning on the armed hint) and 18 (Task 14 not run); the header, file structure and cross-plan table follow.
5. `error` is not closable: Task 1's `ClosableStatusSchema` and its test, and Task 6, whose errored-agent test is gone (8 tests) and whose `closeIdleAgent` comment names the daemon's checks.
6. `ARMED_HINT` drops "and its background tasks" (Task 12, Task 13's Interfaces and Step 24).
7. Task 13: Step 2 checks for Claude CLI 2.1.292 or later; Steps 25 and 27 say how to read a refusal; Step 33 takes the gate-first branch, stops on the shared-mcp paragraph, and its paragraph and claims map describe the guarded close; Steps 34 and 35 keep only the gate-first counts.
8. Task 14 is marked not executed in this plan's run (header, decision 18, Self-review).
9. Self-review: the Close, Safety and manual-check rows, a type-consistency bullet for `closeRuntimeIfIdle`, and the deviations (errored agents and background work removed, the refusal added).

### Controller resolutions (2026-11-07)

1. Close semantics: the guarded RPC. `AgentManager.closeRuntimeIfIdle` (Task 2) makes idle collection's checks and refuses with a reason the screen shows; nothing is killed, and the barrier closes decision 4's prompt race.
2. Errored agents: an errored agent is not idle, so `error` left `ClosableStatusSchema` (Task 1) and Task 6's errored-agent test; Close is refused for it.
3. No `resumable` flag (YAGNI); Close stays enabled for an idle agent without a saved session, and the press is refused.
4. Docs order: settled by the gate plan, which lands first; its Task 10 Step 21 rewrites the "Local runs of" paragraph, and Task 13 Step 33 takes the gate-first branch.
5. procfs readers: the gate keeps its own `server/procfs.ts`; this plan's copy and drift test stand.
6. Expected-failure texts: the gate plan's already read `Cannot find module './x.js'`; nothing to change here.
7. Task 14 is deferred to sub-project 6 (ops), which the user deferred, and is not executed in this plan's run.
8. ssh-mcp 2.x policy, approval and audit-log growth, and 1.x's stderr rule: accepted risks, which Task 14 records when sub-project 6 runs it.
9. Feature contract: `server_info.features.agentRuntimeClose` per `docs/protocol-compatibility.md`, with the SDK failing fast on an older host (decision 3).
10. The two probe files the drafter wrote outside the repository: noted; both were deleted, and nothing depends on them.
