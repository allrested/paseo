# Claude Workflows Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the plain card of Claude Code's `Workflow` tool with a live card that shows the run's state and, for each agent inside the run, its phase, state, tool calls, last tool, tokens and last activity.

**Architecture:** A built-in plugin `plugins/claude-workflows/` adds a client timeline transformer that swaps the `Workflow` tool card for a plugin item once its result names a run id, and a renderer card that calls one RPC, `claude-workflows.run.request`, every 3 s while the run is Running. The server handler derives every path from the agent's snapshot (Claude session id, cwd) and the run id, looking in the other sessions of the cwd's project dir, where the agent's earlier sessions are, when its current one has no such run, reads the run's journal and agent files incrementally through a 32-entry LRU cache that serializes calls per run, decides the state from the run record or a live Claude process for the run's session found in `<cfg>/sessions` and checked against `/proc`, and returns a view that the shared schema validates on both sides. The daemon runs no timer, watcher or detached promise for it. One line in the app's turn fold keeps plugin rows in view in a folded turn, so a Running card stays mounted and keeps polling there.

**Tech Stack:** TypeScript (NodeNext, strict), zod 4, `@getpaseo/plugin` server and client SDK, React Native with `@tanstack/react-query` 5, Vitest 4, Node `fs/promises` and Linux `/proc`.

**Spec:** `docs/superpowers/specs/2026-11-07-claude-workflows-design.md`

## Global Constraints

- **Host memory.** The 16 GB host froze on 2026-11-06 from parallel heavy commands. Every typecheck, vitest run, lint, build, npm install and `git commit` (its lefthook pre-commit typechecks every workspace) runs alone under `flock /tmp/paseo-heavy.lock`, and inside the lock a memory guard starts the command only while `MemAvailable` is at least 2500 MB:
  `flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard <command>`
  The guard checks after the lock is taken, since the wait for the lock can be long, and it hands back the command's own exit code. `MEMORY LOW: <n> MB available` means the command did not run: wait a minute and run the same step again, and after five tries report BLOCKED with the figure. Never stop anything you did not start to free memory. Formatting (`npm run format:files`) is light and runs without the lock. Typecheck with `tsgo --singleThreaded`. Never run a whole workspace test suite.
- **One test file per run.** Plugin tests run from the repo root, which holds the Vitest config that covers `plugins/`: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/<path>.test.ts --bail=1`. The built-in registry test runs from `packages/server` with `-t` naming its one test, and Task 12's app test from `packages/app`, whose Vitest config holds the app's aliases and setup.
- **Pre-commit hook stays on.** Every commit runs the lefthook hook (format, lint, full typecheck) under the heavy lock. `LEFTHOOK=0` is not approved for this plan and is not an option to offer. If the hook fails in a workspace the task did not touch, stop and report it.
- **Plan file.** This plan is drafted at `.superpowers/plan-drafts/2026-11-07-claude-workflows.md` (gitignored). The controller copies it to `docs/superpowers/plans/2026-11-07-claude-workflows.md` and commits it on `main` while `main` is checked out between plans, through the normal hook (no plumbing commit, which would skip the hook the way `--no-verify` does), as the gate plan was (`33559a68f`); the spec is on `main` already (`f798c56f2`). The controller then cuts `feat/claude-workflows` from that commit. Every status check below is scoped, since this checkout is shared.
- **Branches.** Every task runs on the local branch `feat/claude-workflows`, which the controller cuts from `main` at execution time, after sub-projects 2, 4, 3 and 5 have merged. Those merges touch the same shared files as this plan (`builtinPlugins` and `docs/plugins.md`), so every edit to a shared file anchors on stable text, never on a line number; Task 12's edit to the app's turn fold anchors the same way and re-checks its anchors first. Tasks never create, switch, check out or rebase a branch, and no step commits to, checks out or pushes `main`. Every commit block starts with a branch check; on `STOP: not on feat/claude-workflows` nothing was staged or committed: report it and stop.
- **Line citations.** `file:line` references are as of `main` at `33559a68f`. Sub-projects 3, 4 and 5 add code to `packages/server/src/server/session.ts` and `packages/client/src/daemon-client.ts`, and sub-project 3 to `packages/server/src/server/agent/agent-manager.ts`, so lines cited there will have moved: find the function or string the plan names next to the line. No edit in this plan anchors on a line number.
- **Daemon.** Never restart, stop or signal the Paseo daemon on port 6767. The manual test uses a dev daemon with `PASEO_HOME=/workspace/utils/paseo/.dev/paseo-home`, started with `env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD`, listening on `172.22.0.3:6768`. It aborts and cleans up whenever `MemAvailable` drops below 2500 MB, and it runs one agent at a time.
- **Restarts kill background work.** Changing an agent's effort or model, or reloading it, restarts its Claude process and kills its workflow runs. No step does that to any agent except Task 13's deliberate Stopped step, on the dev daemon's own test agent.
- **Claude usage needs the user's yes.** Only Task 13 spends Claude usage (one test agent and three Workflow runs). It stops before its Step 1, names the cost, and goes on only after the user's explicit yes; on no, it reports its checks as not run, and Task 14 still writes the docs.
- **Commits.** Local only, on `feat/claude-workflows`. No step pushes any branch (a push to main redeploys every instance through Dokploy). Author and committer `tatsuya <allrested@gmail.com>`, overriding the container's M-DAQ `GIT_*` env for that command only, by explicit pathspec:
  `flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "<message>" -- <paths>`
  then check `git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'`. This checkout is shared: the pathspec commits only the task's files, and anything another session staged stays staged and out of the commit.
- **Built-in import rules.** Server files import only `@getpaseo/plugin/*`, `zod` and `node:*`; client files only `@getpaseo/plugin`, `@getpaseo/plugin/client*`, `react`, `react-native`, `@tanstack/react-query` and `zod`; `shared/` only `@getpaseo/plugin` and `zod`. Relative imports carry a `.js` suffix everywhere (NodeNext). No import from another plugin's directory or from `packages/server`: copied code carries a comment naming its source.
- **In-process safety.** The plugin runs inside the daemon, and an uncaught exception or unhandled rejection exits the daemon (`packages/server/src/server/daemon-worker.ts:373-389`). All server work runs inside the RPC handler, whose rejections the host catches. The server keeps no timer, interval, watcher, event emitter, detached promise or `void` promise. The client's only timer is React Query's `refetchInterval`, which belongs to the query observer and stops on unmount.
- **Read-only on Claude Code's files.** Files are opened read-only and never written. The plugin never reads `sessions/*.key` or `.credentials.json`, reads only `status`, `timestamp` and `workflowName` from a run record, and never puts command text, tool output, prompts, results, `lastToolSummary`, previews or the script into the view.
- **No secrets in files, logs or chat.** No step prints `PASEO_PASSWORD`, tokens, `~/.claude/settings.json` values or `config.json`. The manual test's throwaway dev password is printed once, because the browser form needs it. Steps find processes by pid file, `pgrep -P`, `pgrep -g`, `ps -o pgid= -p`, or `grep -l`, `grep -q` and `grep -z` over `/proc/<pid>/environ` and `/proc/<pid>/cmdline`. They never run `pgrep -a`, `pgrep -f`, `ps -f` or a `ps` format with `args`: Claude processes carry bearer tokens in their arguments.
- **Types.** No `as` casts that bypass a type error (`as const` is fine). Test files are excluded from the plugins typecheck (`plugins/tsconfig.json`), so tests type their fixtures with interfaces and typed helpers, never with casts.
- **Tests** (`docs/testing.md`): ports and adapters, typed in-memory fakes and real temp dirs, deterministic assertions. No `vi.mock`, `vi.spyOn`, fake timers, monkey-patched globals, JSDOM or component tests; the card is checked by hand in Task 13. Fixtures are built from typed objects; real transcripts are never copied, since they hold prompts. Tests never read the real `~/.claude` or `/proc`: every home, config dir and proc root is a temp dir.
- **Lint rules that shape the code** (`.oxlintrc.json`): `no-shadow`, `no-nested-ternary`, `max-nested-callbacks` 3, `complexity` 20, `typescript/consistent-type-definitions` (`interface` for object types), `oxc/no-map-spread`, and the `react-perf` rules (no new object, array, function or JSX as a prop, so styles and handlers are memoized).
- **Copy** (`docs/design.md` section 10): sentence case, a literal three-dot "..." in in-flight labels ("Loading..."), never "…", no trailing period on labels and single-clause hints.
- **Spec values:** poll every 3 s while Running and never otherwise; cache at most 32 run dirs, least recently used dropped first, entries idle for 10 minutes dropped on the next call, one call at a time per run; reads in chunks of at most 1 MB; RPC `claude-workflows.run.request` with input `{ agentId, runId }`; run id `wf_` plus 8 hex digits, a dash and 3 hex digits.
- **Formatting and lint:** from the repo root, `npm run format:files -- <paths>`, then lint under the lock and the memory guard: `flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- <paths>`.

## Decisions the spec leaves open

These are settled here; every task follows them.

1. **Archived agents (spec: "checked early in the plan").** Read from code, re-checked in Task 2 Step 1 and live in Task 13. `paseo.agents.ref(id).refresh()` sends `fetch_agent`, which `Session.handleFetchAgent` serves (`packages/server/src/server/session.ts:8230`; its comment: "An unknown agent is a null agent, not an error. Errors are for empty or ambiguous identifiers."). `getAgentPayloadById` (`session.ts:5781-5794`) falls back from the live agent to `readSettledAgent`, which reads the stored record whatever its `archivedAt`, and `buildStoredAgentPayload` (`packages/server/src/server/agent/agent-projections.ts:232`) keeps `cwd`, `persistence` and `archivedAt`. So an archived Claude agent's card still loads, and an unknown agent gives `null`. Two traps: identifier resolution also matches id prefixes and titles, so the handler accepts a snapshot only when `agent.id` equals the requested id; and a provider the client may not see returns `null`, but the plugin's internal client sends the daemon version as `appVersion` (`packages/server/src/server/plugins/runtime.ts:940`), which passes `MIN_VERSION_ALL_PROVIDERS` (`0.1.45`, `session.ts:326`), so derived Claude providers such as `claude-<name>` stay visible.
2. **Ids.** Run id `^wf_[0-9a-f]{8}-[0-9a-f]{3}$`. Session id: a lowercase UUID, `^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`. A journal `agentId` names a file only when it matches `^[A-Za-z0-9_-]{1,64}$`; otherwise that agent shows unreadable. On 2026-11-07 every one of 154 observed agent ids was 17 characters of that set, and all 15 observed tool results carried `Run ID:` and `Summary:` lines.
3. **What counts as a Claude agent (spec deviation, approved by the user on 2026-11-07).** The snapshot must have `persistence` (else `not-claude`). There is no provider id check: derived Claude providers carry their own ids, and a run is only ever found inside a Claude config dir, so another provider's session id finds nothing (`run-not-found`). The transformer fires only on the Claude result shape.
4. **A failed snapshot (spec deviation, approved by the user on 2026-11-07).** "A failed snapshot" in the spec is read as no snapshot: `refresh()` returning `null`, or a snapshot for another id, gives Unavailable `agent-not-found`. A `refresh()` that throws (a transport failure) fails the RPC instead, so the card keeps its data, shows "Refresh failed" and polls again; Unavailable would stop polling for good on a transient error.
5. **Locating.** Config dirs in this order: `CLAUDE_CONFIG_DIR` (resolved, when set), `~/.claude`, then every `~/.claude-<name>` directory by name; each once, directories only. The agent's current session comes first: in each config dir, the cwd's slug, then every other `projects/*` entry. When no config dir holds the run there, every other session dir under `projects/<slug>/` is tried, config dir by config dir, and the state check asks about the session the run was found in (Decision 11): a `/clear`, or a hook that restarts Claude Code, gives the agent a new session id (`packages/server/src/server/agent/providers/claude/agent.ts:5090-5100`, `:5136-5146`), while its earlier cards still name runs of the session it left. That search is a spec deviation, approved by the user on 2026-11-07, since the spec's lookup follows only the current session id. It reads only the names in `projects/<slug>/`, keeps those in the session id format (the dir also holds `<session>.jsonl` transcripts and `memory/`), and never opens a `*.key` file or `.credentials.json`. The first match wins. A candidate counts when `<session dir>/subagents/workflows/<runId>` resolves (realpath) to a directory, and both it and its session dir resolve inside the config dir's real path. Locating runs on every call, before the cache, so a moved or deleted run is noticed.
6. **Reading.** No line-length cap: the partial last line is kept as bytes (lines reach about 520 KB), so a multibyte character split across chunks survives. An agent file that does not exist yet (`ENOENT`) means the agent has not written; it shows its journal state with no activity. Any other errno error marks only that agent unreadable. A missing journal means the run cannot be located (`run-not-found`).
7. **Which lines are parsed.** An agent-file line is parsed only when it holds the bytes `"type":"tool_use"` or `"type":"tool_result"`, or both `"type":"assistant"` and `"usage"`. JSON escaping keeps a prompt that quotes those bytes from matching, and counting uses parsed assistant `tool_use` blocks, so prose about tools is never counted. Activity times come from the parsed lines' timestamps.
8. **Last tool and tokens.** The last tool is the newest `tool_use` block; its file is `input.file_path` when it is a non-empty string, shown relative to the line's `cwd` when inside it, else as its base name. It shows as running only while its agent is running and no `tool_result` with its id has arrived. Tokens are the newest assistant usage that counts any tokens, `input + cache read + cache creation + output`, with a missing cache field counted as 0; a usage of unknown shape is ignored without losing the line's tool calls.
9. **Run record (spec deviation, approved by the user on 2026-11-07).** Read only when present; larger than 16 MiB, or without a string `status`, it gives `run-unreadable`. JSON that does not parse counts as not written yet, since Claude Code writes the record once and a read can race the write. `status === "killed"` gives Killed and any other status Completed. `timestamp` is the end time and `workflowName` the summary fallback; either of an unexpected type is dropped, not fatal.
10. **Resumed runs (spec deviation, approved by the user on 2026-11-07).** A resume rewrites the record only when it ends, so a record counts only while the journal has not changed more than 1 s after the record's end time (`journal mtime > endedAt + 1000` makes it stale). A stale record falls through to the liveness check; its name still shows.
11. **Liveness (spec deviation, approved by the user on 2026-11-07).** The check asks about the session the run was found in (Decision 5), in the `sessions` dir of the config dir that holds the run, so a run of a session the agent has left counts as Running only while that session's process lives. "Started before the newest agent" compares the session file's `startedAt` with the first activity of the newest agent (the last `started` in the journal), or with the journal's mtime when that agent has not written yet. Taking the newest agent rather than the latest activity of any agent keeps a just-resumed run Running before its new agent writes; Stopped would end polling for good. `startedAt` counts only after the session file's `procStart` equals field 22 of `/proc/<pid>/stat`, read from the last `)` so a `comm` with spaces or parentheses cannot shift it. Only `^\d+\.json$` names in `<cfg>/sessions` are read; an unreadable or garbled one is skipped. Linux only: elsewhere `/proc/<pid>/stat` is missing, so a run without a record shows Stopped.
12. **Cache.** Keyed by the run dir's real path; idle entries are dropped, then the least recently used when full, at the start of each call. Each entry's promise chain serializes calls for its run; different runs proceed in parallel. An entry evicted while a call still runs finishes on its own state, and the next call starts fresh.
13. **Reasons and copy.** `agent-not-found` "Agent not found", `not-claude` "No Claude session for this agent", `run-not-found` "Run files not found", `run-unreadable` "Unable to read the run files". One unreadable agent file: "Unable to read this agent's file" on that row. Others: "Loading...", "Unable to load the run", "Refresh failed", "No agents have started yet". Run states show as Running, Completed, Killed, Stopped and Unavailable, and agent states as Running, Done, Failed, Stopped and Unreadable: the spec's words in sentence case (`docs/design.md` section 10).
14. **Totals.** The client computes them from the view: "3 agents · 2 done · 1 failed · 14 tool calls · 52.1k tokens · 2m 10s". Tokens are the sum of each agent's newest context size and appear once any agent has usage. Elapsed time runs from the earliest first activity to the query's `dataUpdatedAt` while Running, to the record's end time when there is one, else to the latest activity. Ages ("2m ago") use the same `dataUpdatedAt`, so they move only when a poll lands.
15. **Open and closed.** The card follows the run until the user taps it: open while Running, closed once the run is not. After a tap it keeps the user's choice. This is the spec's "A Running card shows its agents... A finished card shows its header and opens on tap" read literally, and it needs no state set during render. An Unavailable card has no body.
16. **Polling (spec deviation, approved by the user on 2026-11-07).** `refetchInterval` returns 3000 only while the last view is Running. A first load that fails shows "Unable to load the run" and does not poll; the next mount tries again. A failed poll after data keeps the data, appends "Refresh failed" and keeps polling. Unavailable stops polling.
17. **Look.** The state chip copies `StatusBadge`'s pill (`packages/app/src/components/ui/status-badge.tsx`: radius full, 1 px `border`, padding 8 by 3, font 12) on `surface2`, since `PluginTheme` has no `surface3`, with the state in its text color: Running `accent`, Completed `statusSuccess`, Killed `statusWarning`, Stopped `statusDanger`, Unavailable `foregroundMuted`. Agent states: running `accent`, done `statusSuccess`, failed `statusDanger`, stopped `statusWarning`, unreadable `foregroundMuted`. `PluginTheme` has no tint colors, so the chip has none.
18. **Identifiers.** Transformer id `workflow-card`; plugin item kind `claude-workflow`, version 1, data `{ runId, summary }`, where `summary` is the trimmed text of the result's `Summary:` line or `null`. The renderer falls back to the record's `workflowName`.
19. **The RPC handler test (spec deviation, approved by the user on 2026-11-07).** The spec's "RPC handler with a fake `paseo`" tests `loadRun(request, environment)` directly, with an in-memory `AgentDirectory` standing in for `paseo.agents`. A test of `contribute()` itself would need a cast to fake the whole `PluginServerContext`; Task 8's compile test and Task 13's live RPC calls cover the two lines of wiring instead.
20. **A run from before the plugin existed (spec deviation, approved by the user on 2026-11-07).** Its files carry no trace of the plugin, so it looks exactly like a run read after a daemon restart: an empty cache reading from offset zero. Task 13 checks it that way: it restarts the dev daemon after three runs have finished and reloads the page, and each finished card loads once and does not poll.
21. **No rollout task.** The spec has no rollout section and the plugin needs no per-instance file or setting: it is a built-in, on for every instance once the fork build is deployed. Deploying that build is sub-project 6 (ops), deferred; nothing in this plan pushes.
22. **Folded turns (app change, chosen by the user on 2026-11-07).** The app's default Chat display, Collapse turns (`packages/app/src/hooks/use-settings/storage.ts:163`), folds every row a finished turn shows before its last reply into one summary line under its prompt; until Task 12, only turn triggers and compaction rows stay out (`packages/app/src/agent-stream/turn-collapse/model.ts:99-101`, `:116-162`), and plugin items are projected before the fold (`packages/app/src/agent-stream/presentation.ts:165-196`). The Workflow tool returns at launch, so the launching turn usually ends while the run is still Running, and a folded row is unmounted, so a folded card would show nothing and poll nothing until the user opened the turn. Task 12 keeps plugin rows out of the fold: `staysVisibleWhenCollapsed` also returns true for `item.kind === "plugin"`, so the card stays in view between the turn's summary line and its reply, mounted and polling. That holds for every plugin's rows, rows that replace a tool call or reasoning included; besides this card, only the `timeline-items` and `inline-thinking` examples make such rows. In an opened turn a plugin row sits outside the indent rail, as a compaction row does, since kept rows never enter `nestedItemIds` (`model.ts:153-158`; `packages/app/src/agent-stream/view.tsx:702-709`). A plugin row still counts as no work, so a turn whose only work before its reply is the card does not fold (`model.ts:140`). Task 12 adds one sentence on the rule under "Contribute timeline items" in `docs/plugins.md`, and Task 13 reads the cards with turns folded and checks that a card in a folded turn keeps polling.

## File Structure

Created:

- `plugins/claude-workflows/paseo-plugin.json`: the manifest.
- `plugins/claude-workflows/shared/run.ts`: run id pattern, timeline item schema, run view schema and the RPC contract.
- `plugins/claude-workflows/shared/run.test.ts`
- `plugins/claude-workflows/index.server.ts`: the server entry; creates the cache and serves the RPC.
- `plugins/claude-workflows/server/agent.ts`: the agent lookup (`AgentDirectory` port, provider-subagent ids).
- `plugins/claude-workflows/server/agent.test.ts`
- `plugins/claude-workflows/server/files.ts`: errno helpers, a directory listing that treats a missing directory as empty, a JSON parse that gives `undefined` for broken text, and path containment.
- `plugins/claude-workflows/server/files.test.ts`
- `plugins/claude-workflows/server/locate.ts`: config dirs, the copied project slug, and the run's location, with the session it was found in.
- `plugins/claude-workflows/server/locate.test.ts`
- `plugins/claude-workflows/server/reader.ts`: the incremental line reader.
- `plugins/claude-workflows/server/reader.test.ts`
- `plugins/claude-workflows/server/fold.ts`: the journal fold and the agent-file fold.
- `plugins/claude-workflows/server/fold.test.ts`
- `plugins/claude-workflows/server/state.ts`: the run record, the live-session check and the run state.
- `plugins/claude-workflows/server/state.test.ts`
- `plugins/claude-workflows/server/cache.ts`: the per-run-dir LRU cache.
- `plugins/claude-workflows/server/cache.test.ts`
- `plugins/claude-workflows/server/run.ts`: the handler body: locate, read, fold, decide, build the view.
- `plugins/claude-workflows/server/run.test.ts`
- `plugins/claude-workflows/index.client.tsx`: the client entry; registers the transformer and the renderer.
- `plugins/claude-workflows/client/transform.ts`: the `Workflow` tool card transformer.
- `plugins/claude-workflows/client/transform.test.ts`
- `plugins/claude-workflows/client/format.ts`: copy, totals, row text and the poll rule.
- `plugins/claude-workflows/client/format.test.ts`
- `plugins/claude-workflows/client/styles.ts`: the card's memoized styles.
- `plugins/claude-workflows/client/card.tsx`: the card.

Modified:

- `packages/server/src/server/plugins/builtin/index.ts`: one line in `builtinPlugins`, after `"claude-usage-source",`.
- `packages/app/src/agent-stream/turn-collapse/model.ts`: `staysVisibleWhenCollapsed` also keeps plugin rows out of a folded turn (Task 12).
- `packages/app/src/agent-stream/turn-collapse/model.test.ts`: one case after the compaction case (Task 12).
- `docs/plugins.md`: one sentence at the end of "Contribute timeline items", on plugin rows in folded turns (Task 12), and one paragraph in "Built-in plugins" (Task 14), after the other built-ins' paragraphs and before the paragraph that starts "Local runs of `scripts/builtin-plugins-dist.test.mjs` and". Sub-projects 2, 3 and 5 each add their paragraphs before that same paragraph and keep its first line when they reword it, so the anchor survives them. `claude-workflows` starts nothing and writes nothing under `$PASEO_HOME`, so that paragraph does not name it.

---

### Task 1: Scaffold, shared contracts, registry entry

**Files:**

- Create: `plugins/claude-workflows/shared/run.ts`
- Test: `plugins/claude-workflows/shared/run.test.ts` (new)
- Create: `plugins/claude-workflows/paseo-plugin.json`
- Create: `plugins/claude-workflows/index.server.ts` (an empty contribution; Task 8 replaces it)
- Modify: `packages/server/src/server/plugins/builtin/index.ts` (the `builtinPlugins` array: add `"claude-workflows"` right after `"claude-usage-source"`)
- Test: `packages/server/src/server/plugins/builtin/index.test.ts` (existing, unchanged; it reads every listed manifest and compiles every listed built-in)

**Interfaces:**

Consumes (read from source, not memory):

- `defineRpc<InputSchema extends ZodType, OutputSchema extends ZodType>(definition: { name: string; input: InputSchema; output: OutputSchema }): PluginRpcContract<InputSchema, OutputSchema>` from `@getpaseo/plugin` (`packages/plugin/src/rpc.ts:29`). The name must match `^[a-z][a-z0-9._-]*$`. `PluginRpcContract` is `{ name: string; input: InputSchema; output: OutputSchema }`.
- `readPluginManifest(directory)` (`packages/server/src/server/plugins/manifest.ts:44`) throws `Plugin manifest is missing: <path>` for a listed id without a manifest; the registry test reaches it for every id in `builtinPlugins`.

Produces (`plugins/claude-workflows/shared/run.ts`):

- `export const RUN_ID_PATTERN = /^wf_[0-9a-f]{8}-[0-9a-f]{3}$/`
- `export const WORKFLOW_ITEM_KIND = "claude-workflow"` and `export const WORKFLOW_ITEM_VERSION = 1`
- `export const WorkflowItemSchema = z.object({ runId: z.string().regex(RUN_ID_PATTERN), summary: z.string().nullable() })`, `export type WorkflowItem = z.output<typeof WorkflowItemSchema>`
- `export const AgentStateSchema = z.enum(["running", "done", "failed", "stopped", "unreadable"])`, `export type AgentState`
- `export const LastToolSchema = z.object({ name: z.string(), file: z.string().nullable(), running: z.boolean() })`, `export type LastTool`
- `export const RunAgentSchema = z.object({ key, label, phase: z.string(), state: AgentStateSchema, toolCalls: z.number().int().nonnegative(), lastTool: LastToolSchema.nullable(), tokens: z.number().int().nonnegative().nullable(), firstActivityAt: z.number().nullable(), lastActivityAt: z.number().nullable() })`, `export type RunAgent`
- `export const RunStateSchema = z.enum(["running", "completed", "killed", "stopped"])`, `export type RunState`
- `export const LoadedRunSchema = z.object({ state: RunStateSchema, name: z.string().nullable(), endedAt: z.number().nullable(), agents: z.array(RunAgentSchema) })`, `export type LoadedRun`
- `export const UnavailableReasonSchema = z.enum(["agent-not-found", "not-claude", "run-not-found", "run-unreadable"])`, `export type UnavailableReason`
- `export const UnavailableRunSchema = z.object({ state: z.literal("unavailable"), reason: UnavailableReasonSchema })`, `export type UnavailableRun`
- `export const RunViewSchema = z.union([LoadedRunSchema, UnavailableRunSchema])`, `export type RunView`; `RunView["state"]` is the five run states the card shows.
- `export const runRpc = defineRpc({ name: "claude-workflows.run.request", input: z.object({ agentId: z.string().min(1), runId: z.string().regex(RUN_ID_PATTERN) }), output: RunViewSchema })`, `export type RunRequest = z.output<typeof runRpc.input>`
- `plugins/claude-workflows/index.server.ts`: `export default function contribute(): () => void` (contributes nothing yet).
- Built-in id `"claude-workflows"` in `builtinPlugins`.

- [ ] **Step 1: Write the failing contract test**

Create `plugins/claude-workflows/shared/run.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  RUN_ID_PATTERN,
  RunViewSchema,
  WorkflowItemSchema,
  runRpc,
  type LoadedRun,
  type RunAgent,
  type UnavailableRun,
} from "./run.js";

const RUN_ID = "wf_0a1b2c3d-4e5";

const agent: RunAgent = {
  key: "read-a",
  label: "Read a.txt",
  phase: "Read",
  state: "running",
  toolCalls: 2,
  lastTool: { name: "Read", file: "a.txt", running: true },
  tokens: 41_200,
  firstActivityAt: 1_762_509_600_000,
  lastActivityAt: 1_762_509_660_000,
};

const loaded: LoadedRun = { state: "running", name: "read-files", endedAt: null, agents: [agent] };

const unavailable: UnavailableRun = { state: "unavailable", reason: "run-not-found" };

describe("run contract", () => {
  it("accepts Claude Code run ids only", () => {
    expect(RUN_ID_PATTERN.test(RUN_ID)).toBe(true);
    const bad = [
      "wf_0A1B2C3D-4E5",
      "wf_0a1b2c3-4e5",
      "wf_0a1b2c3d-4e5f",
      `../${RUN_ID}`,
      `${RUN_ID}/x`,
    ];
    expect(bad.filter((id) => RUN_ID_PATTERN.test(id))).toEqual([]);
  });

  it("names the RPC and checks its input", () => {
    expect(runRpc.name).toBe("claude-workflows.run.request");
    expect(runRpc.input.safeParse({ agentId: "agent-1", runId: RUN_ID }).success).toBe(true);
    expect(runRpc.input.safeParse({ agentId: "", runId: RUN_ID }).success).toBe(false);
    expect(runRpc.input.safeParse({ agentId: "agent-1", runId: "../../etc" }).success).toBe(false);
  });

  it("parses a loaded view and an unavailable view", () => {
    expect(RunViewSchema.parse(loaded)).toEqual(loaded);
    expect(RunViewSchema.parse(unavailable)).toEqual(unavailable);
  });

  it("rejects views the card cannot show", () => {
    expect(RunViewSchema.safeParse({ ...loaded, state: "paused" }).success).toBe(false);
    expect(RunViewSchema.safeParse({ state: "unavailable", reason: "offline" }).success).toBe(
      false,
    );
    const negative = { ...loaded, agents: [{ ...agent, toolCalls: -1 }] };
    expect(RunViewSchema.safeParse(negative).success).toBe(false);
  });

  it("checks the timeline item data", () => {
    expect(WorkflowItemSchema.parse({ runId: RUN_ID, summary: null })).toEqual({
      runId: RUN_ID,
      summary: null,
    });
    expect(WorkflowItemSchema.safeParse({ runId: "wf_x", summary: null }).success).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/shared/run.test.ts --bail=1`

Expected: FAIL. The output names `Cannot find module` and `run.js`, and ends with `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the shared contract**

Create `plugins/claude-workflows/shared/run.ts`:

```ts
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

/** Claude Code's workflow run id: `wf_`, 8 hex digits, a dash and 3 hex digits. */
export const RUN_ID_PATTERN = /^wf_[0-9a-f]{8}-[0-9a-f]{3}$/;

/** The plugin timeline item that takes the place of a `Workflow` tool card. */
export const WORKFLOW_ITEM_KIND = "claude-workflow";
export const WORKFLOW_ITEM_VERSION = 1;

export const WorkflowItemSchema = z.object({
  runId: z.string().regex(RUN_ID_PATTERN),
  /** The `Summary:` line of the tool result, or null when it has none. */
  summary: z.string().nullable(),
});
export type WorkflowItem = z.output<typeof WorkflowItemSchema>;

export const AgentStateSchema = z.enum(["running", "done", "failed", "stopped", "unreadable"]);
export type AgentState = z.output<typeof AgentStateSchema>;

export const LastToolSchema = z.object({
  name: z.string(),
  /** Relative to the agent's cwd, or a base name for a file outside it. */
  file: z.string().nullable(),
  /** True until the tool's result arrives, and only while the agent runs. */
  running: z.boolean(),
});
export type LastTool = z.output<typeof LastToolSchema>;

export const RunAgentSchema = z.object({
  key: z.string(),
  label: z.string(),
  phase: z.string(),
  state: AgentStateSchema,
  toolCalls: z.number().int().nonnegative(),
  lastTool: LastToolSchema.nullable(),
  /** The newest context size Claude Code reports for the agent. */
  tokens: z.number().int().nonnegative().nullable(),
  /** Epoch milliseconds. */
  firstActivityAt: z.number().nullable(),
  lastActivityAt: z.number().nullable(),
});
export type RunAgent = z.output<typeof RunAgentSchema>;

export const RunStateSchema = z.enum(["running", "completed", "killed", "stopped"]);
export type RunState = z.output<typeof RunStateSchema>;

export const LoadedRunSchema = z.object({
  state: RunStateSchema,
  /** The run record's workflow name. */
  name: z.string().nullable(),
  /** Epoch milliseconds, for Completed and Killed runs. */
  endedAt: z.number().nullable(),
  /** In start order; an agent still queued is not listed. */
  agents: z.array(RunAgentSchema),
});
export type LoadedRun = z.output<typeof LoadedRunSchema>;

export const UnavailableReasonSchema = z.enum([
  "agent-not-found",
  "not-claude",
  "run-not-found",
  "run-unreadable",
]);
export type UnavailableReason = z.output<typeof UnavailableReasonSchema>;

export const UnavailableRunSchema = z.object({
  state: z.literal("unavailable"),
  reason: UnavailableReasonSchema,
});
export type UnavailableRun = z.output<typeof UnavailableRunSchema>;

export const RunViewSchema = z.union([LoadedRunSchema, UnavailableRunSchema]);
export type RunView = z.output<typeof RunViewSchema>;

export const runRpc = defineRpc({
  name: "claude-workflows.run.request",
  input: z.object({
    agentId: z.string().min(1),
    runId: z.string().regex(RUN_ID_PATTERN),
  }),
  output: RunViewSchema,
});
export type RunRequest = z.output<typeof runRpc.input>;
```

- [ ] **Step 4: Run the contract test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/shared/run.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  5 passed (5)`.

- [ ] **Step 5: List the built-in before it exists**

In `packages/server/src/server/plugins/builtin/index.ts`, replace

```ts
  "claude-usage-source",
```

with

```ts
  "claude-usage-source",
  "claude-workflows",
```

The anchor is the `claude-usage-source` entry, not a line number: sub-projects 2, 4, 3 and 5 edit this list before this branch is cut, and `claude-workflows` sorts right after `claude-usage-source` whatever they added.

- [ ] **Step 6: Run the registry test and confirm it fails**

Run: `cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1`

Expected: FAIL with `Error: Plugin manifest is missing: /workspace/utils/paseo/plugins/claude-workflows/paseo-plugin.json`.

- [ ] **Step 7: Add the manifest and the server entry**

Create `plugins/claude-workflows/paseo-plugin.json`:

```json
{ "id": "claude-workflows", "requirements": { "paseo": ">=0.15.0" } }
```

Create `plugins/claude-workflows/index.server.ts`:

```ts
export default function contribute() {
  return () => {};
}
```

- [ ] **Step 8: Run the registry test and confirm it passes**

Run: `cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1`

Expected: PASS, 1 test (the others in the file are skipped by `-t`). It reads `plugins/claude-workflows/paseo-plugin.json` and compiles `index.server.ts` under the built-in import boundaries.

- [ ] **Step 9: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-workflows/paseo-plugin.json plugins/claude-workflows/index.server.ts plugins/claude-workflows/shared/run.ts plugins/claude-workflows/shared/run.test.ts packages/server/src/server/plugins/builtin/index.ts && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- plugins/claude-workflows packages/server/src/server/plugins/builtin/index.ts
```

Expected: oxfmt exits 0, then `Found 0 warnings and 0 errors.` (`z.output<...>` aliases pass `typescript/consistent-type-definitions`; only object-literal type aliases fail it.)

- [ ] **Step 10: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics. Test files are excluded by `plugins/tsconfig.json`.

- [ ] **Step 11: Commit with the fork identity (local only, never push)**

The lefthook pre-commit hook runs format check and lint on the staged files, then a full `npm run typecheck` across every workspace, so the commit holds the heavy lock until the hook finishes (several minutes).

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add plugins/claude-workflows/paseo-plugin.json plugins/claude-workflows/index.server.ts plugins/claude-workflows/shared/run.ts plugins/claude-workflows/shared/run.test.ts packages/server/src/server/plugins/builtin/index.ts
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): scaffold claude-workflows built-in plugin" -- plugins/claude-workflows/paseo-plugin.json plugins/claude-workflows/index.server.ts plugins/claude-workflows/shared/run.ts plugins/claude-workflows/shared/run.test.ts packages/server/src/server/plugins/builtin/index.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/claude-workflows packages/server/src/server/plugins/builtin
```

Expected:

- The hook's format, lint and typecheck jobs pass, and git prints `5 files changed`. If a hook job fails, git creates no commit: report the hook output and stop. Do not fix files outside this task and do not bypass the hook.
- `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.
- `show` prints the subject `feat(fork): scaffold claude-workflows built-in plugin` followed by exactly the five paths.
- `status` prints nothing.

---

### Task 2: Agent lookup

**Files:**

- Create: `plugins/claude-workflows/server/agent.ts`
- Test: `plugins/claude-workflows/server/agent.test.ts` (new)

**Interfaces:**

Consumes (read from source, not memory):

- `PaseoApi.agents.ref(agent: string | PaseoAgent): PaseoAgentHandle` (`packages/client/src/index.ts:413`), whose `refresh(requestId?: string): Promise<PaseoAgentRefetchResult | null>` (line 380) sends `fetch_agent`. `PaseoAgentRefetchResult` is `{ agent: PaseoAgent; project: ProjectPlacementPayload | null }` (lines 283-286) and `PaseoAgent = AgentSnapshotPayload` (line 113). The snapshot's `id: string`, `cwd: string` and `persistence: AgentPersistenceHandle | null` come from `AgentSnapshotPayloadSchema` (`packages/protocol/src/messages.ts:864-881`); `AgentPersistenceHandle` has `sessionId: string` (`packages/protocol/src/agent-types.ts:171-177`), the Claude session id for Claude agents.
- The provider-subagent pane builds its agent id as `` `provider:${encodeURIComponent(target.parentAgentId)}:${encodeURIComponent(target.subagentId)}` `` (`packages/app/src/panels/provider-subagent-panel.tsx:120`), and the timeline renderer receives that id as `agentId`.
- `UnavailableReason` from Task 1.

Produces (`plugins/claude-workflows/server/agent.ts`):

- `export interface AgentSnapshot { id: string; cwd: string; persistence: { sessionId: string } | null }`
- `export interface AgentRef { refresh(): Promise<{ agent: AgentSnapshot } | null> }`
- `export interface AgentDirectory { ref(agentId: string): AgentRef }`. `paseo.agents` satisfies it structurally; Task 8 passes it straight in.
- `export type AgentFacts = { kind: "claude"; sessionId: string; cwd: string } | { kind: "unavailable"; reason: UnavailableReason }`
- `export function parentAgentId(agentId: string): string | null`: the decoded parent for `provider:<parent>:<sub>`, the id itself otherwise, null for bad percent-encoding.
- `export async function readAgentFacts(agents: AgentDirectory, agentId: string): Promise<AgentFacts>`: `agent-not-found` for a malformed id, a `null` refresh or a snapshot of another id; `not-claude` for a null `persistence`; rejects when `refresh()` rejects.

- [ ] **Step 1: Re-check the archived-agent finding in code**

The spec asks early in the plan whether an archived agent's snapshot can still be read. Decision 1 answers yes from code; confirm the code still says so before building on it. Run:

```bash
cd /workspace/utils/paseo
grep -n 'An unknown agent is a null agent' packages/server/src/server/session.ts
sed -n '/private async getAgentPayloadById/,/^  }/p' packages/server/src/server/session.ts
sed -n '/private async readSettledAgent/,/^  }/p' packages/server/src/server/session.ts
grep -n 'archivedAt: record.archivedAt' packages/server/src/server/agent/agent-projections.ts
grep -n 'appVersion: this.daemonVersion' packages/server/src/server/plugins/runtime.ts
grep -n 'const MIN_VERSION_ALL_PROVIDERS' packages/server/src/server/session.ts
```

Expected:

- The comment line in `handleFetchAgent`: "An unknown agent is a null agent, not an error. Errors are for empty or ambiguous identifiers."
- `getAgentPayloadById` returns the live agent's payload, else `readSettledAgent(agentId)` turned into `buildStoredAgentPayload(settled.record)`, each behind `isProviderVisibleToClient(payload.provider)`.
- `readSettledAgent` returns `agentStorage.get(agentId)` for any record that is not `internal`, with no `archivedAt` filter.
- `buildStoredAgentPayload` sets `archivedAt: record.archivedAt ?? null` (and keeps `cwd` and `persistence`).
- The plugin runtime initializes the plugin's client with `appVersion: this.daemonVersion`, and `MIN_VERSION_ALL_PROVIDERS` is `"0.1.45"`, which every daemon version since passes, so a derived Claude provider is visible to the plugin.

If any of these differs (an archived filter appears, or the plugin client's version no longer passes the provider gate), stop and report: Decision 1 and the not-found handling below change.

- [ ] **Step 2: Write the failing lookup test**

Create `plugins/claude-workflows/server/agent.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parentAgentId, readAgentFacts, type AgentDirectory, type AgentSnapshot } from "./agent.js";

const SESSION_ID = "0f8c2d4e-1a2b-4c3d-8e9f-0123456789ab";

const claudeAgent: AgentSnapshot = {
  id: "agent-claude",
  cwd: "/work/project",
  persistence: { sessionId: SESSION_ID },
};

const plainAgent: AgentSnapshot = { id: "agent-plain", cwd: "/work/project", persistence: null };

interface FakeDirectory extends AgentDirectory {
  asked: string[];
}

/** `paseo.agents` in memory: answers like fetch_agent, null for an unknown id. */
function directory(snapshots: Map<string, AgentSnapshot>): FakeDirectory {
  const asked: string[] = [];
  return {
    asked,
    ref(agentId: string) {
      return {
        async refresh() {
          asked.push(agentId);
          const agent = snapshots.get(agentId);
          return agent === undefined ? null : { agent };
        },
      };
    },
  };
}

function failingDirectory(error: Error): AgentDirectory {
  return {
    ref() {
      return {
        async refresh() {
          throw error;
        },
      };
    },
  };
}

describe("parentAgentId", () => {
  it("keeps a plain agent id", () => {
    expect(parentAgentId("agent-claude")).toBe("agent-claude");
  });

  it("resolves a provider-subagent id to its decoded parent", () => {
    const id = `provider:${encodeURIComponent("agent/claude")}:${encodeURIComponent("sub:1")}`;
    expect(parentAgentId(id)).toBe("agent/claude");
  });

  it("rejects a parent that is not valid percent-encoding", () => {
    expect(parentAgentId("provider:%E0%A4%A:sub")).toBeNull();
  });
});

describe("readAgentFacts", () => {
  it("reads the Claude session id and cwd", async () => {
    const agents = directory(new Map([[claudeAgent.id, claudeAgent]]));
    await expect(readAgentFacts(agents, claudeAgent.id)).resolves.toEqual({
      kind: "claude",
      sessionId: SESSION_ID,
      cwd: "/work/project",
    });
    expect(agents.asked).toEqual(["agent-claude"]);
  });

  it("asks for the parent of a provider-subagent id", async () => {
    const agents = directory(new Map([[claudeAgent.id, claudeAgent]]));
    await expect(readAgentFacts(agents, "provider:agent-claude:sub-1")).resolves.toEqual({
      kind: "claude",
      sessionId: SESSION_ID,
      cwd: "/work/project",
    });
    expect(agents.asked).toEqual(["agent-claude"]);
  });

  it("reports an unknown agent", async () => {
    await expect(readAgentFacts(directory(new Map()), "agent-gone")).resolves.toEqual({
      kind: "unavailable",
      reason: "agent-not-found",
    });
  });

  it("does not take an agent that fetch_agent matched by prefix or title", async () => {
    const agents = directory(new Map([["agent", claudeAgent]]));
    await expect(readAgentFacts(agents, "agent")).resolves.toEqual({
      kind: "unavailable",
      reason: "agent-not-found",
    });
  });

  it("reports an agent without a provider session", async () => {
    const agents = directory(new Map([[plainAgent.id, plainAgent]]));
    await expect(readAgentFacts(agents, plainAgent.id)).resolves.toEqual({
      kind: "unavailable",
      reason: "not-claude",
    });
  });

  it("reports a malformed provider-subagent id without asking", async () => {
    const agents = directory(new Map());
    await expect(readAgentFacts(agents, "provider:%E0%A4%A:sub")).resolves.toEqual({
      kind: "unavailable",
      reason: "agent-not-found",
    });
    expect(agents.asked).toEqual([]);
  });

  it("lets a failed snapshot read reject, so the card retries on its next poll", async () => {
    const agents = failingDirectory(new Error("daemon connection closed"));
    await expect(readAgentFacts(agents, "agent-claude")).rejects.toThrow(
      "daemon connection closed",
    );
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/agent.test.ts --bail=1`

Expected: FAIL. The output names `Cannot find module` and `agent.js`, and ends with `Test Files  1 failed (1)`.

- [ ] **Step 4: Write the lookup**

Create `plugins/claude-workflows/server/agent.ts`:

```ts
import type { UnavailableReason } from "../shared/run.js";

/** The fields of a Paseo agent snapshot this plugin reads. */
export interface AgentSnapshot {
  id: string;
  cwd: string;
  persistence: { sessionId: string } | null;
}

export interface AgentRef {
  refresh(): Promise<{ agent: AgentSnapshot } | null>;
}

/** The part of `paseo.agents` the handler uses; tests pass an in-memory one. */
export interface AgentDirectory {
  ref(agentId: string): AgentRef;
}

export type AgentFacts =
  | { kind: "claude"; sessionId: string; cwd: string }
  | { kind: "unavailable"; reason: UnavailableReason };

// The provider-subagent pane names its timeline
// `provider:${encodeURIComponent(parent)}:${encodeURIComponent(sub)}`
// (packages/app/src/panels/provider-subagent-panel.tsx), and the run belongs to the parent.
const PROVIDER_SUBAGENT_ID = /^provider:([^:]+):[^:]+$/;

/**
 * The agent that owns the run: the parent of a provider-subagent pane's id, else the id itself.
 * Null when the parent part is not valid percent-encoding.
 */
export function parentAgentId(agentId: string): string | null {
  const parent = PROVIDER_SUBAGENT_ID.exec(agentId)?.[1];
  if (parent === undefined) return agentId;
  try {
    return decodeURIComponent(parent);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

/**
 * The agent's Claude session id and cwd, from its snapshot; an archived agent still has one. A
 * snapshot read that throws rejects: that is a failed call, which the card retries on its next
 * poll, not a missing agent.
 */
export async function readAgentFacts(agents: AgentDirectory, agentId: string): Promise<AgentFacts> {
  const id = parentAgentId(agentId);
  if (id === null) return { kind: "unavailable", reason: "agent-not-found" };
  const agent = (await agents.ref(id).refresh())?.agent;
  // fetch_agent also resolves id prefixes and titles; only the agent with this exact id counts.
  if (agent?.id !== id) return { kind: "unavailable", reason: "agent-not-found" };
  const { persistence, cwd } = agent;
  if (persistence === null) return { kind: "unavailable", reason: "not-claude" };
  return { kind: "claude", sessionId: persistence.sessionId, cwd };
}
```

- [ ] **Step 5: Run the lookup test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/agent.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  10 passed (10)`.

- [ ] **Step 6: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-workflows/server/agent.ts plugins/claude-workflows/server/agent.test.ts && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- plugins/claude-workflows/server/agent.ts plugins/claude-workflows/server/agent.test.ts
```

Expected: oxfmt exits 0, then `Found 0 warnings and 0 errors.`

- [ ] **Step 7: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics.

- [ ] **Step 8: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add plugins/claude-workflows/server/agent.ts plugins/claude-workflows/server/agent.test.ts
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): look up the Claude session behind a workflow card" -- plugins/claude-workflows/server/agent.ts plugins/claude-workflows/server/agent.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/claude-workflows
```

Expected: the hook passes and git prints `2 files changed`; `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` prints the subject and exactly the two paths; `status` prints nothing. If a hook job fails, git creates no commit: report the hook output and stop.

---

### Task 3: File helpers and locating a run

**Files:**

- Create: `plugins/claude-workflows/server/files.ts`
- Test: `plugins/claude-workflows/server/files.test.ts` (new)
- Create: `plugins/claude-workflows/server/locate.ts`
- Test: `plugins/claude-workflows/server/locate.test.ts` (new)

**Interfaces:**

Consumes (read from source, not memory):

- `RUN_ID_PATTERN` from Task 1.
- The slug code to copy: `canonicalize`, `normalizeProjectPath`, `encode` and `hashSuffix` with `PROJECT_DIR_LENGTH_CAP = 200` in `packages/server/src/server/agent/providers/claude/project-dir.ts` (lines 12, 83-117). `encode` replaces every character outside `[a-zA-Z0-9]` with `-` and, past 200 characters, keeps the first 200 and appends `-` plus a base-36 hash of the unencoded path. The source's `canonicalize` falls back to the given path when `realpath` throws anything; the copy catches file errors only (`docs/coding-standards.md`, "Errors"), which are the only errors `realpath` throws.
- Profile directories: `claude-usage-source` reads every `~/.claude*` entry that is a directory (`plugins/claude-usage-source/server/usage.ts:454-474`). This plugin takes `~/.claude` and the `~/.claude-<name>` entries only, so `~/.claude.json` and similar never count.

Produces (`plugins/claude-workflows/server/files.ts`):

- `export function isMissing(error: unknown): boolean`: an errno error with code `ENOENT`, `ENOTDIR` or `ESRCH`.
- `export function isFileError(error: unknown): boolean`: an `Error` whose `code` is an errno name (`/^E[A-Z]+$/`); Node's `ERR_*` codes and plain errors are not file errors.
- `export async function listNames(dir: string): Promise<string[]>`: `readdir`, with `[]` for a missing directory; any other error rejects.
- `export function parseJson(text: string): unknown`: the parsed value, or `undefined` for text that is not complete JSON.
- `export function isInside(parent: string, child: string): boolean`: `child` lies below `parent` (both absolute; `parent` itself does not count). Task 5 uses it for tool file paths.

Produces (`plugins/claude-workflows/server/locate.ts`):

- `export interface ConfigDirLookup { home: string; env: NodeJS.ProcessEnv }`
- `export async function claudeConfigDirs(lookup: ConfigDirLookup): Promise<string[]>`: existing directories, in order: `CLAUDE_CONFIG_DIR` (resolved, when non-empty), `<home>/.claude`, then every `<home>/.claude-<name>` sorted by name; each once.
- `export async function projectSlug(cwd: string): Promise<string>`: Claude Code's project dir name for `cwd`.
- `export interface RunLocation { configDir: string; sessionDir: string; runDir: string; sessionId: string }`: real paths, and the session the run was found in, which Task 8's state check asks about.
- `export interface LocateRunInput { configDirs: string[]; cwd: string; sessionId: string; runId: string }`
- `export async function locateRun(input: LocateRunInput): Promise<RunLocation | null>`: the current session first, in every config dir (the cwd's slug, then every other project dir); then, config dir by config dir, every other entry of `projects/<slug>/` named in the session id format (Decision 5). Null for a malformed session id or run id, or when every candidate run dir is missing, not a directory, or resolves outside its config dir.

- [ ] **Step 1: Write the failing file-helper test**

Create `plugins/claude-workflows/server/files.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isFileError, isInside, isMissing, listNames, parseJson } from "./files.js";

let root = "";

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "claude-workflows-files-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** The error a real operation rejects with. */
async function failure(work: Promise<unknown>): Promise<unknown> {
  try {
    await work;
  } catch (error) {
    return error;
  }
  throw new Error("expected the operation to fail");
}

function errnoError(code: string): Error {
  return Object.assign(new Error(`${code}: fixture`), { code });
}

describe("file helpers", () => {
  it("treats a missing path, a missing parent dir and a gone process as missing", async () => {
    await writeFile(join(root, "file"), "x");
    const missing = await failure(readFile(join(root, "absent")));
    const notDir = await failure(readFile(join(root, "file", "child")));
    const isDir = await failure(readFile(root));

    expect([missing, notDir, errnoError("ESRCH")].map(isMissing)).toEqual([true, true, true]);
    expect([isDir, new Error("plain")].map(isMissing)).toEqual([false, false]);
  });

  it("counts errno failures as file errors, and nothing else", async () => {
    const isDir = await failure(readFile(root));
    const missing = await failure(readFile(join(root, "absent")));
    const invalidArgument = Object.assign(new Error("bad argument"), {
      code: "ERR_INVALID_ARG_TYPE",
    });

    expect([isDir, missing].map(isFileError)).toEqual([true, true]);
    expect([invalidArgument, new TypeError("bug"), "ENOENT"].map(isFileError)).toEqual([
      false,
      false,
      false,
    ]);
  });

  it("lists a directory's names, and none for a missing one", async () => {
    await mkdir(join(root, "dir"));
    await writeFile(join(root, "dir", "b"), "");
    await writeFile(join(root, "dir", "a"), "");

    expect((await listNames(join(root, "dir"))).sort()).toEqual(["a", "b"]);
    await expect(listNames(join(root, "absent"))).resolves.toEqual([]);
  });

  it("parses complete JSON only", () => {
    expect(parseJson('{"status":"completed"}')).toEqual({ status: "completed" });
    expect(parseJson("null")).toBeNull();
    expect(parseJson('{"status":"comp')).toBeUndefined();
    expect(parseJson("")).toBeUndefined();
  });

  it("tells whether a path lies inside a directory", () => {
    expect(isInside("/work/project", "/work/project/src/a.ts")).toBe(true);
    expect(isInside("/work/project", "/work/project/..a/b.ts")).toBe(true);
    expect(isInside("/work/project", "/work/project")).toBe(false);
    expect(isInside("/work/project", "/work/project-other/a.ts")).toBe(false);
    expect(isInside("/work/project", "/work/..project/a.ts")).toBe(false);
    expect(isInside("/work/project", "/etc/hosts")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/files.test.ts --bail=1`

Expected: FAIL. The output names `Cannot find module` and `files.js`, and ends with `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the file helpers**

Create `plugins/claude-workflows/server/files.ts`:

```ts
import { readdir } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

// ENOENT and ENOTDIR: the path, or a directory on it, does not exist. ESRCH: a /proc entry whose
// process exited while it was being read.
const MISSING_CODES: ReadonlySet<string> = new Set(["ENOENT", "ENOTDIR", "ESRCH"]);

const ERRNO_CODE = /^E[A-Z]+$/;

/** The errno code a failed file operation carries, or null for any other error. */
function errnoCode(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (!("code" in error)) return null;
  const { code } = error;
  if (typeof code !== "string") return null;
  return ERRNO_CODE.test(code) ? code : null;
}

/** Whether a file operation failed because its path, or a /proc entry, is gone. */
export function isMissing(error: unknown): boolean {
  const code = errnoCode(error);
  return code !== null && MISSING_CODES.has(code);
}

/** Whether a file operation failed with an errno code, as opposed to a bug. */
export function isFileError(error: unknown): boolean {
  return errnoCode(error) !== null;
}

/** The names in a directory; none when the directory does not exist. */
export async function listNames(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch (error) {
    if (isMissing(error)) return [];
    throw error;
  }
}

/** The value of a JSON text, or undefined when the text is not complete JSON. */
export function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return undefined;
    throw error;
  }
}

/** Whether `child` lies below `parent`. Both are absolute; `parent` itself does not count. */
export function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  const escapes = rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel);
  return rel !== "" && !escapes;
}
```

- [ ] **Step 4: Run the file-helper test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/files.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  5 passed (5)`.

- [ ] **Step 5: Write the failing locate test**

Create `plugins/claude-workflows/server/locate.test.ts`:

```ts
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claudeConfigDirs,
  locateRun,
  projectSlug,
  type LocateRunInput,
  type RunLocation,
} from "./locate.js";

const SESSION_ID = "0f8c2d4e-1a2b-4c3d-8e9f-0123456789ab";
/** A session the agent left, after a `/clear` or a restart gave it SESSION_ID. */
const EARLIER_SESSION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const RUN_ID = "wf_0a1b2c3d-4e5";

let root = "";

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "claude-workflows-locate-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

/** `<configDir>/projects/<project>/<session>/subagents/workflows/<run>`, created. */
async function makeRun(configDir: string, project: string, session = SESSION_ID): Promise<void> {
  const runDir = join(configDir, "projects", project, session, "subagents", "workflows", RUN_ID);
  await mkdir(runDir, { recursive: true });
}

function location(configDir: string, project: string, sessionId = SESSION_ID): RunLocation {
  const sessionDir = join(configDir, "projects", project, sessionId);
  const runDir = join(sessionDir, "subagents", "workflows", RUN_ID);
  return { configDir, sessionDir, runDir, sessionId };
}

describe("claudeConfigDirs", () => {
  it("lists CLAUDE_CONFIG_DIR, ~/.claude, then each ~/.claude-<name> profile by name", async () => {
    const home = join(root, "home");
    const custom = join(root, "custom");
    for (const dir of [
      custom,
      join(home, ".claude"),
      join(home, ".claude-b"),
      join(home, ".claude-a"),
    ]) {
      await mkdir(dir, { recursive: true });
    }
    await writeFile(join(home, ".claude.json"), "{}");
    await writeFile(join(home, ".claude-file"), "not a directory");

    await expect(claudeConfigDirs({ home, env: { CLAUDE_CONFIG_DIR: custom } })).resolves.toEqual([
      custom,
      join(home, ".claude"),
      join(home, ".claude-a"),
      join(home, ".claude-b"),
    ]);
  });

  it("lists a profile that CLAUDE_CONFIG_DIR names once", async () => {
    const home = join(root, "home");
    await mkdir(join(home, ".claude"), { recursive: true });
    await mkdir(join(home, ".claude-a"));

    const env = { CLAUDE_CONFIG_DIR: `${join(home, ".claude-a")}/` };
    await expect(claudeConfigDirs({ home, env })).resolves.toEqual([
      join(home, ".claude-a"),
      join(home, ".claude"),
    ]);
  });

  it("has none for a home without Claude dirs", async () => {
    await expect(claudeConfigDirs({ home: join(root, "absent"), env: {} })).resolves.toEqual([]);
  });
});

describe("projectSlug", () => {
  it("encodes the real path of the cwd", async () => {
    await mkdir(join(root, "real", "my project"), { recursive: true });
    await symlink(join(root, "real"), join(root, "link"));

    const expected = join(root, "real", "my project").replace(/[^a-zA-Z0-9]/g, "-");
    await expect(projectSlug(join(root, "link", "my project"))).resolves.toBe(expected);
  });

  it("encodes a missing path as given, cut at 200 characters with a hash", async () => {
    const slug = await projectSlug(`/missing/${"a".repeat(240)}`);
    expect(slug).toMatch(/^-missing-a{191}-[0-9a-z]+$/);
  });
});

describe("locateRun", () => {
  it("finds the run under the cwd's slug", async () => {
    const configDir = join(root, "home", ".claude");
    const cwd = join(root, "project");
    await mkdir(cwd);
    const slug = await projectSlug(cwd);
    await makeRun(configDir, slug);

    const input = { configDirs: [configDir], cwd, sessionId: SESSION_ID, runId: RUN_ID };
    await expect(locateRun(input)).resolves.toEqual(location(configDir, slug));
  });

  it("scans the other project dirs when the slug has no such session", async () => {
    const configDir = join(root, "home", ".claude");
    const cwd = join(root, "project");
    await mkdir(cwd);
    await mkdir(join(configDir, "projects", await projectSlug(cwd)), { recursive: true });
    await mkdir(join(configDir, "projects", "-unrelated"), { recursive: true });
    await makeRun(configDir, "-moved-project");

    const input = { configDirs: [configDir], cwd, sessionId: SESSION_ID, runId: RUN_ID };
    await expect(locateRun(input)).resolves.toEqual(location(configDir, "-moved-project"));
  });

  it("tries each config dir in order", async () => {
    const first = join(root, "home", ".claude");
    const profile = join(root, "home", ".claude-work");
    const cwd = join(root, "project");
    await mkdir(cwd);
    await mkdir(join(first, "projects"), { recursive: true });
    await makeRun(profile, await projectSlug(cwd));

    const input = { configDirs: [first, profile], cwd, sessionId: SESSION_ID, runId: RUN_ID };
    await expect(locateRun(input)).resolves.toEqual(location(profile, await projectSlug(cwd)));
  });

  it("tries the slug's other sessions once no config dir has the run in the current one", async () => {
    const first = join(root, "home", ".claude");
    const profile = join(root, "home", ".claude-work");
    const cwd = join(root, "project");
    await mkdir(cwd);
    const slug = await projectSlug(cwd);
    await mkdir(join(first, "projects", slug, SESSION_ID), { recursive: true });
    await makeRun(first, slug, EARLIER_SESSION_ID);
    const input = { configDirs: [first, profile], cwd, sessionId: SESSION_ID, runId: RUN_ID };

    await expect(locateRun(input)).resolves.toEqual(location(first, slug, EARLIER_SESSION_ID));
    await makeRun(profile, "-moved-project");
    await expect(locateRun(input)).resolves.toEqual(location(profile, "-moved-project"));
  });

  it("finds nothing for a malformed session id or run id", async () => {
    const configDir = join(root, "home", ".claude");
    const cwd = join(root, "project");
    await mkdir(cwd);
    await makeRun(configDir, await projectSlug(cwd));
    const base = { configDirs: [configDir], cwd };

    const cases: LocateRunInput[] = [
      { ...base, sessionId: SESSION_ID.toUpperCase(), runId: RUN_ID },
      { ...base, sessionId: "..", runId: RUN_ID },
      { ...base, sessionId: SESSION_ID, runId: `../${RUN_ID}` },
      { ...base, sessionId: SESSION_ID, runId: "wf_0a1b2c3d" },
    ];
    for (const input of cases) {
      expect(await locateRun(input)).toBeNull();
    }
  });

  it("finds nothing when the run dir resolves outside its config dir", async () => {
    const configDir = join(root, "home", ".claude");
    const cwd = join(root, "project");
    await mkdir(cwd);
    const workflowsDir = join(
      configDir,
      "projects",
      await projectSlug(cwd),
      SESSION_ID,
      "subagents",
      "workflows",
    );
    await mkdir(workflowsDir, { recursive: true });
    await mkdir(join(root, "outside", RUN_ID), { recursive: true });
    await symlink(join(root, "outside", RUN_ID), join(workflowsDir, RUN_ID));

    const input = { configDirs: [configDir], cwd, sessionId: SESSION_ID, runId: RUN_ID };
    await expect(locateRun(input)).resolves.toBeNull();
  });

  it("finds nothing when the run is missing or is a file", async () => {
    const configDir = join(root, "home", ".claude");
    const cwd = join(root, "project");
    await mkdir(cwd);
    const workflowsDir = join(
      configDir,
      "projects",
      await projectSlug(cwd),
      SESSION_ID,
      "subagents",
      "workflows",
    );
    await mkdir(workflowsDir, { recursive: true });
    const input = { configDirs: [configDir], cwd, sessionId: SESSION_ID, runId: RUN_ID };

    await expect(locateRun(input)).resolves.toBeNull();
    await writeFile(join(workflowsDir, RUN_ID), "not a directory");
    await expect(locateRun(input)).resolves.toBeNull();
  });

  it("finds no other session's run outside the slug, in a dir not named as a session, or outside the config dir", async () => {
    const configDir = join(root, "home", ".claude");
    const cwd = join(root, "project");
    await mkdir(cwd);
    const slug = await projectSlug(cwd);
    await makeRun(configDir, "-other-project", EARLIER_SESSION_ID);
    await makeRun(configDir, slug, "memory");
    await mkdir(join(root, "outside", "subagents", "workflows", RUN_ID), { recursive: true });
    await symlink(join(root, "outside"), join(configDir, "projects", slug, EARLIER_SESSION_ID));

    const input = { configDirs: [configDir], cwd, sessionId: SESSION_ID, runId: RUN_ID };
    await expect(locateRun(input)).resolves.toBeNull();
  });
});
```

- [ ] **Step 6: Run it and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/locate.test.ts --bail=1`

Expected: FAIL. The output names `Cannot find module` and `locate.js`, and ends with `Test Files  1 failed (1)`.

- [ ] **Step 7: Write the locator**

Create `plugins/claude-workflows/server/locate.ts`:

```ts
import { realpath, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { RUN_ID_PATTERN } from "../shared/run.js";
import { isFileError, isInside, isMissing, listNames } from "./files.js";

/** Claude Code session ids are lowercase UUIDs. */
const SESSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** `~/.claude-<name>`, a profile made with `CLAUDE_CONFIG_DIR=~/.claude-<name> claude`. */
const PROFILE_DIR = /^\.claude-./;

export interface ConfigDirLookup {
  home: string;
  env: NodeJS.ProcessEnv;
}

/**
 * Every Claude Code config dir that exists, in the order they are searched: CLAUDE_CONFIG_DIR,
 * ~/.claude, then each ~/.claude-<name> profile by name. A dir named twice is listed once.
 */
export async function claudeConfigDirs(lookup: ConfigDirLookup): Promise<string[]> {
  const candidates: string[] = [];
  const custom = lookup.env.CLAUDE_CONFIG_DIR;
  if (custom) candidates.push(resolve(custom));
  candidates.push(join(lookup.home, ".claude"));
  const names = await listNames(lookup.home);
  for (const name of names.filter((entry) => PROFILE_DIR.test(entry)).sort()) {
    candidates.push(join(lookup.home, name));
  }
  const dirs: string[] = [];
  for (const dir of new Set(candidates)) {
    if (await isDirectory(dir)) dirs.push(dir);
  }
  return dirs;
}

// Copied from packages/server/src/server/agent/providers/claude/project-dir.ts (canonicalize,
// normalizeProjectPath, encode, hashSuffix), which a built-in cannot import. It ports Claude
// Code's own encoding of a session's project dir name.
const PROJECT_DIR_LENGTH_CAP = 200;

/** The name Claude Code gives the project dir of a session started in `cwd`. */
export async function projectSlug(cwd: string): Promise<string> {
  return encode(await canonicalize(cwd));
}

async function canonicalize(input: string): Promise<string> {
  try {
    return normalizeProjectPath(await realpath(input));
  } catch (error) {
    // The source falls back to the path as given whenever realpath fails.
    if (isFileError(error)) return normalizeProjectPath(input);
    throw error;
  }
}

function normalizeProjectPath(input: string): string {
  if (process.platform === "darwin") return input.normalize("NFC");
  return input;
}

function encode(input: string): string {
  const replaced = input.replace(/[^a-zA-Z0-9]/g, "-");
  if (replaced.length <= PROJECT_DIR_LENGTH_CAP) {
    return replaced;
  }
  return `${replaced.slice(0, PROJECT_DIR_LENGTH_CAP)}-${hashSuffix(input)}`;
}

function hashSuffix(input: string): string {
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) - hash + input.charCodeAt(i)) | 0;
  }
  return Math.abs(hash).toString(36);
}

/** Real paths of a run: its config dir, its session dir and its run dir. */
export interface RunLocation {
  configDir: string;
  sessionDir: string;
  runDir: string;
  /** The session the run was found in, which the state check asks about. */
  sessionId: string;
}

export interface LocateRunInput {
  configDirs: string[];
  cwd: string;
  sessionId: string;
  runId: string;
}

/**
 * Finds `<config>/projects/<project>/<session>/subagents/workflows/<runId>`. The agent's current
 * session comes first: in each config dir, the cwd's slug, then every other project dir. Then,
 * config dir by config dir, the other sessions under the cwd's slug: a `/clear` or a restart gives
 * the agent a new session id, while its earlier cards still name runs of the session it left. The
 * first match wins.
 */
export async function locateRun(input: LocateRunInput): Promise<RunLocation | null> {
  const validIds = SESSION_ID_PATTERN.test(input.sessionId) && RUN_ID_PATTERN.test(input.runId);
  if (!validIds) return null;
  const slug = await projectSlug(input.cwd);
  for (const configDir of input.configDirs) {
    const found = await locateInConfigDir({ configDir, slug, input });
    if (found !== null) return found;
  }
  for (const configDir of input.configDirs) {
    const found = await locateInOtherSessions({ configDir, slug, input });
    if (found !== null) return found;
  }
  return null;
}

interface ConfigDirSearch {
  configDir: string;
  slug: string;
  input: LocateRunInput;
}

async function locateInConfigDir(search: ConfigDirSearch): Promise<RunLocation | null> {
  const { configDir, slug, input } = search;
  const projectsDir = join(configDir, "projects");
  const candidate = (project: string): RunCandidate => ({
    configDir,
    sessionDir: join(projectsDir, project, input.sessionId),
    sessionId: input.sessionId,
    runId: input.runId,
  });
  const atSlug = await runLocation(candidate(slug));
  if (atSlug !== null) return atSlug;
  // Claude Code keeps a resumed session in the project dir where it started.
  for (const project of await listNames(projectsDir)) {
    if (project === slug) continue;
    const found = await runLocation(candidate(project));
    if (found !== null) return found;
  }
  return null;
}

/**
 * The other sessions under the cwd's slug in one config dir. Only names in the session id format
 * count: the project dir also holds `<session>.jsonl` transcripts and `memory/`.
 */
async function locateInOtherSessions(search: ConfigDirSearch): Promise<RunLocation | null> {
  const { configDir, slug, input } = search;
  const projectDir = join(configDir, "projects", slug);
  for (const name of await listNames(projectDir)) {
    if (name === input.sessionId || !SESSION_ID_PATTERN.test(name)) continue;
    const found = await runLocation({
      configDir,
      sessionDir: join(projectDir, name),
      sessionId: name,
      runId: input.runId,
    });
    if (found !== null) return found;
  }
  return null;
}

interface RunCandidate {
  configDir: string;
  sessionDir: string;
  sessionId: string;
  runId: string;
}

async function runLocation(candidate: RunCandidate): Promise<RunLocation | null> {
  let runDir: string;
  try {
    runDir = await realpath(join(candidate.sessionDir, "subagents", "workflows", candidate.runId));
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
  const configDir = await realpath(candidate.configDir);
  const sessionDir = await realpath(candidate.sessionDir);
  const contained = isInside(configDir, sessionDir) && isInside(configDir, runDir);
  if (!contained) return null;
  if (!(await isDirectory(runDir))) return null;
  return { configDir, sessionDir, runDir, sessionId: candidate.sessionId };
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}
```

- [ ] **Step 8: Run the locate test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/locate.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  13 passed (13)`.

- [ ] **Step 9: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-workflows/server/files.ts plugins/claude-workflows/server/files.test.ts plugins/claude-workflows/server/locate.ts plugins/claude-workflows/server/locate.test.ts && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- plugins/claude-workflows/server/files.ts plugins/claude-workflows/server/files.test.ts plugins/claude-workflows/server/locate.ts plugins/claude-workflows/server/locate.test.ts
```

Expected: oxfmt exits 0 (it rewraps the long `for` and `expect` lines in the tests), then `Found 0 warnings and 0 errors.`

- [ ] **Step 10: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics.

- [ ] **Step 11: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add plugins/claude-workflows/server/files.ts plugins/claude-workflows/server/files.test.ts plugins/claude-workflows/server/locate.ts plugins/claude-workflows/server/locate.test.ts
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): locate a Claude workflow run on disk" -- plugins/claude-workflows/server/files.ts plugins/claude-workflows/server/files.test.ts plugins/claude-workflows/server/locate.ts plugins/claude-workflows/server/locate.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/claude-workflows
```

Expected: the hook passes and git prints `4 files changed`; `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` prints the subject and exactly the four paths; `status` prints nothing. If a hook job fails, git creates no commit: report the hook output and stop.

---

### Task 4: Incremental line reader

**Files:**

- Create: `plugins/claude-workflows/server/reader.ts`
- Test: `plugins/claude-workflows/server/reader.test.ts` (new)

**Interfaces:**

Consumes (read from source, not memory):

- `FileHandle.stat()`, `FileHandle.read(buffer, offset, length, position): Promise<{ bytesRead: number; buffer }>` and `FileHandle.close()` from `node:fs/promises`; `Stats.ino`, `Stats.size` and `Stats.mtimeMs` are numbers.

Produces (`plugins/claude-workflows/server/reader.ts`):

- `export const CHUNK_BYTES = 1024 * 1024`
- `export interface FileCursor { offset: number; inode: number | null; partial: Buffer }` and `export function newCursor(): FileCursor`
- `export interface LineSink { restart(): void; line(text: string): void }`
- `export interface ReadRequest { path: string; cursor: FileCursor; sink: LineSink }` and `export interface ReadResult { mtimeMs: number }`
- `export async function readNewLines(request: ReadRequest): Promise<ReadResult>`: reads `[cursor.offset, size)` in reads of at most `CHUNK_BYTES`, calls `sink.line` for each complete line in order (UTF-8, without the newline), keeps the unfinished last line as bytes, and calls `sink.restart()` and reads from zero when the size dropped below the offset or the inode changed. Rejects with the file error when the file cannot be opened, stat'ed or read; the cursor is left as it was before the failing read.

- [ ] **Step 1: Write the failing reader test**

Create `plugins/claude-workflows/server/reader.test.ts`:

```ts
import { appendFile, mkdtemp, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CHUNK_BYTES, newCursor, readNewLines, type LineSink } from "./reader.js";

let root = "";

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "claude-workflows-reader-")));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface RecordingSink extends LineSink {
  lines: string[];
  restarts: number;
}

function recordingSink(): RecordingSink {
  const sink: RecordingSink = {
    lines: [],
    restarts: 0,
    restart() {
      sink.restarts += 1;
    },
    line(text) {
      sink.lines.push(text);
    },
  };
  return sink;
}

describe("readNewLines", () => {
  it("keeps a partial last line until its newline arrives", async () => {
    const path = join(root, "agent.jsonl");
    const cursor = newCursor();
    const sink = recordingSink();
    await writeFile(path, "one\ntw");

    await readNewLines({ path, cursor, sink });
    expect(sink.lines).toEqual(["one"]);
    await appendFile(path, "o\nthree\n");
    await readNewLines({ path, cursor, sink });

    expect(sink.lines).toEqual(["one", "two", "three"]);
  });

  it("reads only the bytes appended since the last call", async () => {
    const path = join(root, "agent.jsonl");
    const cursor = newCursor();
    const sink = recordingSink();
    await writeFile(path, "one\n");

    await readNewLines({ path, cursor, sink });
    await appendFile(path, "two\n");
    await readNewLines({ path, cursor, sink });

    expect(sink.lines).toEqual(["one", "two"]);
    expect(cursor.offset).toBe(8);
    expect(sink.restarts).toBe(0);
  });

  it("starts over when the file shrank", async () => {
    const path = join(root, "journal.jsonl");
    const cursor = newCursor();
    const sink = recordingSink();
    await writeFile(path, "one\ntwo\n");

    await readNewLines({ path, cursor, sink });
    await writeFile(path, "new\n");
    await readNewLines({ path, cursor, sink });

    expect(sink.restarts).toBe(1);
    expect(sink.lines).toEqual(["one", "two", "new"]);
  });

  it("starts over when the file was replaced", async () => {
    const path = join(root, "journal.jsonl");
    const cursor = newCursor();
    const sink = recordingSink();
    await writeFile(path, "one\n");

    await readNewLines({ path, cursor, sink });
    await writeFile(join(root, "next.jsonl"), "uno\ndos\n");
    await rename(join(root, "next.jsonl"), path);
    await readNewLines({ path, cursor, sink });

    expect(sink.restarts).toBe(1);
    expect(sink.lines).toEqual(["one", "uno", "dos"]);
  });

  it("reads a large file in chunks without splitting a line or a character", async () => {
    const path = join(root, "agent.jsonl");
    const sink = recordingSink();
    // "é" is two bytes in UTF-8; here its first byte ends the second chunk.
    const lineA = "a".repeat(CHUNK_BYTES);
    const lineB = `${"b".repeat(CHUNK_BYTES - 2)}é`;
    await writeFile(path, `${lineA}\n${lineB}\nc\n`);

    await readNewLines({ path, cursor: newCursor(), sink });

    expect(sink.lines.map((line) => line.length)).toEqual([CHUNK_BYTES, CHUNK_BYTES - 1, 1]);
    expect(sink.lines[1].slice(-2)).toBe("bé");
  });

  it("returns the mtime of the file it read", async () => {
    const path = join(root, "journal.jsonl");
    await writeFile(path, "one\n");

    const result = await readNewLines({ path, cursor: newCursor(), sink: recordingSink() });

    expect(result.mtimeMs).toBe((await stat(path)).mtimeMs);
  });

  it("rejects with the file error when the file cannot be opened", async () => {
    const request = {
      path: join(root, "absent.jsonl"),
      cursor: newCursor(),
      sink: recordingSink(),
    };
    await expect(readNewLines(request)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/reader.test.ts --bail=1`

Expected: FAIL. The output names `Cannot find module` and `reader.js`, and ends with `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the reader**

Create `plugins/claude-workflows/server/reader.ts`:

```ts
import { open } from "node:fs/promises";

/** The most bytes one read takes, so a large first read yields to the event loop between reads. */
export const CHUNK_BYTES = 1024 * 1024;

const NEWLINE = 0x0a;

/** Where reading a file stopped. */
export interface FileCursor {
  offset: number;
  /** The inode read last, or null before the first read. */
  inode: number | null;
  /** The bytes of the unfinished last line, kept as bytes so a split character survives. */
  partial: Buffer;
}

export function newCursor(): FileCursor {
  return { offset: 0, inode: null, partial: Buffer.alloc(0) };
}

/** Receives a file's complete lines in order, and `restart` before the file is read from zero. */
export interface LineSink {
  restart(): void;
  line(text: string): void;
}

export interface ReadRequest {
  path: string;
  cursor: FileCursor;
  sink: LineSink;
}

export interface ReadResult {
  mtimeMs: number;
}

/**
 * Hands the sink each line completed since the cursor, reading only the bytes added since the
 * last call and keeping the unfinished last line for the next. A file that shrank or was
 * replaced is read again from zero. Rejects with the file error when the file cannot be read.
 */
export async function readNewLines(request: ReadRequest): Promise<ReadResult> {
  const { path, cursor, sink } = request;
  const handle = await open(path, "r");
  try {
    const stats = await handle.stat();
    const replaced = cursor.inode !== null && cursor.inode !== stats.ino;
    const shrank = stats.size < cursor.offset;
    if (replaced || shrank) {
      cursor.offset = 0;
      cursor.partial = Buffer.alloc(0);
      sink.restart();
    }
    cursor.inode = stats.ino;
    const remaining = stats.size - cursor.offset;
    const chunk = Buffer.alloc(Math.min(CHUNK_BYTES, remaining));
    while (cursor.offset < stats.size) {
      const length = Math.min(chunk.length, stats.size - cursor.offset);
      const { bytesRead } = await handle.read(chunk, 0, length, cursor.offset);
      if (bytesRead === 0) break;
      cursor.offset += bytesRead;
      const bytes = Buffer.concat([cursor.partial, chunk.subarray(0, bytesRead)]);
      cursor.partial = emitLines(bytes, sink);
    }
    return { mtimeMs: stats.mtimeMs };
  } finally {
    await handle.close();
  }
}

/** Hands each complete line in `bytes` to the sink, and returns the unfinished rest. */
function emitLines(bytes: Buffer, sink: LineSink): Buffer {
  let start = 0;
  let end = bytes.indexOf(NEWLINE, start);
  while (end !== -1) {
    sink.line(bytes.toString("utf8", start, end));
    start = end + 1;
    end = bytes.indexOf(NEWLINE, start);
  }
  // Copied, so a short partial line does not keep the whole chunk alive in the cache.
  return Buffer.from(bytes.subarray(start));
}
```

A read that rejects part way leaves `offset` at the last complete read and `partial` at its unfinished line, so the next call goes on from there; `Buffer.concat` copies, so `partial` never aliases the reused `chunk`.

- [ ] **Step 4: Run the reader test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/reader.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  7 passed (7)`.

- [ ] **Step 5: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-workflows/server/reader.ts plugins/claude-workflows/server/reader.test.ts && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- plugins/claude-workflows/server/reader.ts plugins/claude-workflows/server/reader.test.ts
```

Expected: oxfmt exits 0, then `Found 0 warnings and 0 errors.`

- [ ] **Step 6: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics.

- [ ] **Step 7: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add plugins/claude-workflows/server/reader.ts plugins/claude-workflows/server/reader.test.ts
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): read workflow run files incrementally" -- plugins/claude-workflows/server/reader.ts plugins/claude-workflows/server/reader.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/claude-workflows
```

Expected: the hook passes and git prints `2 files changed`; `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` prints the subject and exactly the two paths; `status` prints nothing. If a hook job fails, git creates no commit: report the hook output and stop.

---

### Task 5: Journal and agent-file folds

**Files:**

- Create: `plugins/claude-workflows/server/fold.ts`
- Test: `plugins/claude-workflows/server/fold.test.ts` (new)

**Interfaces:**

Consumes:

- `parseJson(text: string): unknown` and `isInside(parent: string, child: string): boolean` from Task 3 (`./files.js`).
- Line shapes, as observed in Claude Code 2.1.x files (structure only; see the spec's "Where the data lives" and Decision 7). Journal lines are compact JSON objects with `type` `launched`, `started` (`key`, `agentId`, `label`, `phase`), `result` (`key`, `agentId`, `result`) or `failed` (`key`, `agentId`). Agent-file lines are compact JSON objects with `type`, ISO `timestamp` and `cwd`; an `assistant` line has `message.content` (an array of blocks; a `tool_use` block has `id`, `name`, `input`) and `message.usage` (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`); a `user` line has `message.content`, an array that holds `tool_result` blocks with `tool_use_id`, or a string for a prompt.

Produces (`plugins/claude-workflows/server/fold.ts`):

- `export type AgentOutcome = "done" | "failed"`
- `export interface JournalAgent { key: string; agentId: string; label: string; phase: string; outcome: AgentOutcome | null; order: number }`
- `export interface JournalFold { agents: Map<string, JournalAgent>; starts: number }` and `export function newJournalFold(): JournalFold`
- `export function foldJournalLine(fold: JournalFold, text: string): void`: the newest `started` per key replaces the older one (label falls back to the key, phase to `""`); `result` gives `done` and `failed` gives `failed`, only when its `agentId` is the key's current one.
- `export function journalAgents(fold: JournalFold): JournalAgent[]`: in start order (by `order`).
- `export interface LastToolUse { id: string; name: string; file: string | null; done: boolean }`
- `export interface AgentFold { toolCalls: number; lastTool: LastToolUse | null; tokens: number | null; firstActivityAt: number | null; lastActivityAt: number | null }` and `export function newAgentFold(): AgentFold`
- `export function isCandidateLine(text: string): boolean`: the line holds `"type":"tool_use"` or `"type":"tool_result"`, or both `"type":"assistant"` and `"usage"`.
- `export function foldAgentLine(fold: AgentFold, text: string): void`: counts assistant `tool_use` blocks, keeps the newest as `lastTool`, marks it `done` when a `tool_result` with its id arrives, sets `tokens` from the newest well-formed usage, and widens the activity times by each parsed line's timestamp.
- `export function displayFile(input: unknown, cwd: string | undefined): string | null`

- [ ] **Step 1: Write the failing fold test**

Create `plugins/claude-workflows/server/fold.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  displayFile,
  foldAgentLine,
  foldJournalLine,
  isCandidateLine,
  journalAgents,
  newAgentFold,
  newJournalFold,
  type AgentFold,
  type JournalAgent,
} from "./fold.js";

const CWD = "/work/project";
const T0 = Date.UTC(2026, 10, 7, 9, 0, 0);

interface Started {
  key: string;
  agentId: string;
  label: string;
  phase: string;
}

const READ_A: Started = { key: "read-a", agentId: "a1", label: "Read a.txt", phase: "Read" };
const READ_B: Started = { key: "read-b", agentId: "b1", label: "Read b.txt", phase: "Read" };

function started(agent: Started): string {
  return JSON.stringify({ type: "started", ...agent });
}

function result(agent: Started): string {
  return JSON.stringify({ type: "result", key: agent.key, agentId: agent.agentId, result: "x" });
}

function failed(agent: Started): string {
  return JSON.stringify({ type: "failed", key: agent.key, agentId: agent.agentId });
}

function foldJournal(lines: string[]): JournalAgent[] {
  const fold = newJournalFold();
  for (const line of lines) foldJournalLine(fold, line);
  return journalAgents(fold);
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AssistantTurn {
  seconds: number;
  content: unknown[];
  usage: unknown;
}

const READ: ToolCall = { id: "toolu_1", name: "Read", input: { file_path: `${CWD}/src/a.ts` } };
const BASH: ToolCall = { id: "toolu_2", name: "Bash", input: { command: "fixture command" } };
const TEXT = { type: "text", text: "fixture reply" };
const USAGE = {
  input_tokens: 10,
  output_tokens: 5,
  cache_read_input_tokens: 100,
  cache_creation_input_tokens: 20,
};

function at(seconds: number): string {
  return new Date(T0 + seconds * 1000).toISOString();
}

function toolUse(tool: ToolCall): Record<string, unknown> {
  return { type: "tool_use", ...tool };
}

function assistantLine(turn: AssistantTurn): string {
  return JSON.stringify({
    type: "assistant",
    timestamp: at(turn.seconds),
    cwd: CWD,
    message: { role: "assistant", content: turn.content, usage: turn.usage },
  });
}

function toolResult(seconds: number, toolUseId: string): string {
  const block = { type: "tool_result", tool_use_id: toolUseId, content: "fixture output" };
  return JSON.stringify({
    type: "user",
    timestamp: at(seconds),
    message: { role: "user", content: [block] },
  });
}

/** Folds lines the way the run reader does: candidate lines only. */
function foldAgent(lines: string[]): AgentFold {
  const fold = newAgentFold();
  for (const line of lines) {
    if (isCandidateLine(line)) foldAgentLine(fold, line);
  }
  return fold;
}

describe("journal fold", () => {
  it("keeps the newest started per key, in start order", () => {
    const agents = foldJournal([
      JSON.stringify({ type: "launched" }),
      started(READ_A),
      started(READ_B),
      result(READ_B),
      failed(READ_A),
      started({ ...READ_A, agentId: "a2" }),
    ]);

    expect(agents).toEqual([
      { ...READ_B, outcome: "done", order: 1 },
      { ...READ_A, agentId: "a2", outcome: null, order: 2 },
    ]);
  });

  it("marks a failed agent and ignores an outcome for a replaced attempt", () => {
    const agents = foldJournal([
      started(READ_A),
      failed(READ_A),
      started(READ_B),
      started({ ...READ_B, agentId: "b2" }),
      result(READ_B),
    ]);

    expect(agents).toEqual([
      { ...READ_A, outcome: "failed", order: 0 },
      { ...READ_B, agentId: "b2", outcome: null, order: 2 },
    ]);
  });

  it("skips launched, unknown, incomplete and garbled lines", () => {
    const fold = newJournalFold();
    const lines = [
      JSON.stringify({ type: "launched" }),
      JSON.stringify({ type: "paused", key: "read-a", agentId: "a1" }),
      JSON.stringify({ type: "started", key: "", agentId: "a1" }),
      JSON.stringify({ type: "started", key: "read-a" }),
      '{"type":"started","key":"read-a","agentId":"a1"',
      "",
    ];
    for (const line of lines) foldJournalLine(fold, line);

    expect(fold.starts).toBe(0);
    expect(journalAgents(fold)).toEqual([]);
  });

  it("falls back to the key for a missing label and to no phase", () => {
    const agents = foldJournal([
      JSON.stringify({ type: "started", key: "report", agentId: "c1", label: 42 }),
    ]);

    expect(agents).toEqual([
      { key: "report", agentId: "c1", label: "report", phase: "", outcome: null, order: 0 },
    ]);
  });
});

describe("agent-file fold", () => {
  it("counts tool_use blocks and keeps the newest as the last tool", () => {
    const fold = foldAgent([
      assistantLine({ seconds: 1, content: [toolUse(READ)], usage: USAGE }),
      toolResult(2, READ.id),
      assistantLine({ seconds: 3, content: [toolUse(BASH)], usage: USAGE }),
    ]);

    expect(fold.toolCalls).toBe(2);
    expect(fold.lastTool).toEqual({ id: "toolu_2", name: "Bash", file: null, done: false });
  });

  it("marks the last tool done only when its own result arrives", () => {
    const fold = foldAgent([
      assistantLine({ seconds: 1, content: [toolUse(READ)], usage: USAGE }),
      assistantLine({ seconds: 2, content: [toolUse(BASH)], usage: USAGE }),
      toolResult(3, READ.id),
    ]);
    expect(fold.lastTool).toEqual({ id: "toolu_2", name: "Bash", file: null, done: false });

    foldAgentLine(fold, toolResult(4, BASH.id));
    expect(fold.lastTool).toEqual({ id: "toolu_2", name: "Bash", file: null, done: true });
  });

  it("takes tokens from the newest usage, counting cache reads and cache writes", () => {
    const first = assistantLine({ seconds: 1, content: [toolUse(READ)], usage: USAGE });
    const newer = assistantLine({
      seconds: 2,
      content: [TEXT],
      usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: null },
    });

    expect(foldAgent([first]).tokens).toBe(135);
    expect(foldAgent([first, newer]).tokens).toBe(3);
  });

  it("ignores a usage of unknown shape and keeps the line's tool call", () => {
    const fold = foldAgent([
      assistantLine({ seconds: 1, content: [toolUse(READ)], usage: { input_tokens: "many" } }),
    ]);

    expect(fold.toolCalls).toBe(1);
    expect(fold.tokens).toBeNull();
  });

  it("records the first and last activity from line timestamps", () => {
    const untimed = JSON.stringify({
      type: "assistant",
      timestamp: "not a time",
      message: { content: [], usage: USAGE },
    });
    const fold = foldAgent([
      assistantLine({ seconds: 5, content: [toolUse(READ)], usage: USAGE }),
      toolResult(3, READ.id),
      untimed,
      assistantLine({ seconds: 9, content: [toolUse(BASH)], usage: USAGE }),
    ]);

    expect([fold.firstActivityAt, fold.lastActivityAt]).toEqual([T0 + 3000, T0 + 9000]);
  });

  it("does not count a prompt that mentions tool_use", () => {
    const prompt = JSON.stringify({
      type: "user",
      timestamp: at(1),
      message: { role: "user", content: 'Reply with {"type":"tool_use","name":"Bash"}' },
    });
    const fold = newAgentFold();
    foldAgentLine(fold, prompt);

    expect(isCandidateLine(prompt)).toBe(false);
    expect(fold.toolCalls).toBe(0);
    expect(isCandidateLine(toolResult(2, READ.id))).toBe(true);
    expect(isCandidateLine(assistantLine({ seconds: 3, content: [TEXT], usage: USAGE }))).toBe(
      true,
    );
  });
});

describe("displayFile", () => {
  it("shows a file inside the cwd relative to it, and one outside by its base name", () => {
    expect(displayFile({ file_path: `${CWD}/src/a.ts` }, CWD)).toBe("src/a.ts");
    expect(displayFile({ file_path: "/etc/hosts" }, CWD)).toBe("hosts");
    expect(displayFile({ file_path: "/work/project-other/b.ts" }, CWD)).toBe("b.ts");
    expect(displayFile({ file_path: CWD }, CWD)).toBe("project");
  });

  it("has no file without a non-empty string file_path, and a base name without a cwd", () => {
    const inputs: unknown[] = [
      { command: "ls" },
      { file_path: "" },
      { file_path: 7 },
      null,
      "a.ts",
    ];

    expect(inputs.map((input) => displayFile(input, CWD))).toEqual([null, null, null, null, null]);
    expect(displayFile({ file_path: `${CWD}/a.ts` }, undefined)).toBe("a.ts");
    expect(displayFile({ file_path: "src/b.ts" }, CWD)).toBe("b.ts");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/fold.test.ts --bail=1`

Expected: FAIL. The output names `Cannot find module` and `fold.js`, and ends with `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the folds**

Create `plugins/claude-workflows/server/fold.ts`:

```ts
import { basename, isAbsolute, relative } from "node:path";
import { z } from "zod";
import { isInside, parseJson } from "./files.js";

export type AgentOutcome = "done" | "failed";

/** An agent of the run as the journal records it: its newest `started` line and its outcome. */
export interface JournalAgent {
  key: string;
  agentId: string;
  label: string;
  phase: string;
  outcome: AgentOutcome | null;
  /** The position of its newest `started` line among all of them, so agents list in start order. */
  order: number;
}

export interface JournalFold {
  /** The newest `started` per key. */
  agents: Map<string, JournalAgent>;
  /** How many `started` lines were folded. */
  starts: number;
}

export function newJournalFold(): JournalFold {
  return { agents: new Map(), starts: 0 };
}

const StartedSchema = z.object({
  type: z.literal("started"),
  key: z.string().min(1),
  agentId: z.string().min(1),
  label: z.string().optional().catch(undefined),
  phase: z.string().catch(""),
});

const OutcomeSchema = z.object({
  type: z.enum(["result", "failed"]),
  key: z.string().min(1),
  agentId: z.string().min(1),
});

const JournalEventSchema = z.union([StartedSchema, OutcomeSchema]);

/** Folds one journal line. `launched` lines, other types and garbled lines change nothing. */
export function foldJournalLine(fold: JournalFold, text: string): void {
  const parsed = JournalEventSchema.safeParse(parseJson(text));
  if (!parsed.success) return;
  const event = parsed.data;
  if (event.type === "started") {
    const label = event.label ?? event.key;
    fold.agents.set(event.key, {
      key: event.key,
      agentId: event.agentId,
      label,
      phase: event.phase,
      outcome: null,
      order: fold.starts,
    });
    fold.starts += 1;
    return;
  }
  const agent = fold.agents.get(event.key);
  // A rerun key's earlier attempt has another agentId; its outcome no longer counts.
  if (agent?.agentId !== event.agentId) return;
  agent.outcome = event.type === "result" ? "done" : "failed";
}

/** The run's agents in start order. */
export function journalAgents(fold: JournalFold): JournalAgent[] {
  const agents = [...fold.agents.values()];
  return agents.sort((a, b) => a.order - b.order);
}

/** The newest tool call of an agent. */
export interface LastToolUse {
  id: string;
  name: string;
  file: string | null;
  /** Its tool_result has arrived. */
  done: boolean;
}

export interface AgentFold {
  toolCalls: number;
  lastTool: LastToolUse | null;
  /** The newest context size: input, cache read, cache creation and output tokens. */
  tokens: number | null;
  /** Epoch milliseconds. */
  firstActivityAt: number | null;
  lastActivityAt: number | null;
}

export function newAgentFold(): AgentFold {
  return {
    toolCalls: 0,
    lastTool: null,
    tokens: null,
    firstActivityAt: null,
    lastActivityAt: null,
  };
}

// Claude Code writes compact JSON, so these bytes appear only as real keys and values: inside
// a string, as in a prompt that quotes them, the quotes are escaped.
const TOOL_USE_BYTES = '"type":"tool_use"';
const TOOL_RESULT_BYTES = '"type":"tool_result"';
const ASSISTANT_BYTES = '"type":"assistant"';
const USAGE_BYTES = '"usage"';

/** Whether an agent-file line can change the fold. Only these lines are parsed. */
export function isCandidateLine(text: string): boolean {
  const toolBlock = text.includes(TOOL_USE_BYTES) || text.includes(TOOL_RESULT_BYTES);
  const assistantUsage = text.includes(ASSISTANT_BYTES) && text.includes(USAGE_BYTES);
  return toolBlock || assistantUsage;
}

const UsageSchema = z.object({
  input_tokens: z.number().int().nonnegative(),
  output_tokens: z.number().int().nonnegative(),
  // A missing or null cache field counts as none.
  cache_read_input_tokens: z.number().int().nonnegative().catch(0),
  cache_creation_input_tokens: z.number().int().nonnegative().catch(0),
});

const AssistantLineSchema = z.object({
  type: z.literal("assistant"),
  timestamp: z.string().optional().catch(undefined),
  cwd: z.string().optional().catch(undefined),
  message: z.object({
    content: z.array(z.unknown()).catch([]),
    usage: UsageSchema.optional().catch(undefined),
  }),
});
type AssistantLine = z.output<typeof AssistantLineSchema>;

const UserLineSchema = z.object({
  type: z.literal("user"),
  timestamp: z.string().optional().catch(undefined),
  message: z.object({ content: z.array(z.unknown()).catch([]) }),
});
type UserLine = z.output<typeof UserLineSchema>;

const AgentLineSchema = z.union([AssistantLineSchema, UserLineSchema]);

const ToolUseBlockSchema = z.object({
  type: z.literal("tool_use"),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
});

const ToolResultBlockSchema = z.object({
  type: z.literal("tool_result"),
  tool_use_id: z.string(),
});

const FileInputSchema = z.object({ file_path: z.string().min(1) });

/** Folds one candidate line of an agent file. Lines of other shapes change nothing. */
export function foldAgentLine(fold: AgentFold, text: string): void {
  const parsed = AgentLineSchema.safeParse(parseJson(text));
  if (!parsed.success) return;
  const line = parsed.data;
  if (line.type === "assistant") {
    foldAssistant(fold, line);
    return;
  }
  foldUser(fold, line);
}

function foldAssistant(fold: AgentFold, line: AssistantLine): void {
  noteActivity(fold, line.timestamp);
  for (const block of line.message.content) {
    const toolUse = ToolUseBlockSchema.safeParse(block);
    if (!toolUse.success) continue;
    const { id, name, input } = toolUse.data;
    const file = displayFile(input, line.cwd);
    fold.toolCalls += 1;
    fold.lastTool = { id, name, file, done: false };
  }
  const { usage } = line.message;
  if (usage === undefined) return;
  const cached = usage.cache_read_input_tokens + usage.cache_creation_input_tokens;
  fold.tokens = usage.input_tokens + cached + usage.output_tokens;
}

function foldUser(fold: AgentFold, line: UserLine): void {
  noteActivity(fold, line.timestamp);
  const { lastTool } = fold;
  if (lastTool === null) return;
  for (const block of line.message.content) {
    const toolResult = ToolResultBlockSchema.safeParse(block);
    if (!toolResult.success) continue;
    if (toolResult.data.tool_use_id === lastTool.id) lastTool.done = true;
  }
}

function noteActivity(fold: AgentFold, timestamp: string | undefined): void {
  if (timestamp === undefined) return;
  const at = Date.parse(timestamp);
  if (Number.isNaN(at)) return;
  fold.firstActivityAt = Math.min(at, fold.firstActivityAt ?? at);
  fold.lastActivityAt = Math.max(at, fold.lastActivityAt ?? at);
}

/**
 * The file a tool works on, from its `input.file_path`: relative to the agent's cwd when inside
 * it, else its base name. Null when the input has no non-empty string `file_path`.
 */
export function displayFile(input: unknown, cwd: string | undefined): string | null {
  const parsed = FileInputSchema.safeParse(input);
  if (!parsed.success) return null;
  const path = parsed.data.file_path;
  if (cwd === undefined) return basename(path);
  if (!isAbsolute(path)) return basename(path);
  if (!isInside(cwd, path)) return basename(path);
  return relative(cwd, path);
}
```

- [ ] **Step 4: Run the fold test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/fold.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  12 passed (12)`.

- [ ] **Step 5: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-workflows/server/fold.ts plugins/claude-workflows/server/fold.test.ts && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- plugins/claude-workflows/server/fold.ts plugins/claude-workflows/server/fold.test.ts
```

Expected: oxfmt exits 0, then `Found 0 warnings and 0 errors.`

- [ ] **Step 6: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics.

- [ ] **Step 7: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add plugins/claude-workflows/server/fold.ts plugins/claude-workflows/server/fold.test.ts
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): fold workflow journal and agent files" -- plugins/claude-workflows/server/fold.ts plugins/claude-workflows/server/fold.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/claude-workflows
```

Expected: the hook passes and git prints `2 files changed`; `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` prints the subject and exactly the two paths; `status` prints nothing. If a hook job fails, git creates no commit: report the hook output and stop.

---

### Task 6: Run record, live session and run state

**Files:**

- Create: `plugins/claude-workflows/server/state.ts`
- Test: `plugins/claude-workflows/server/state.test.ts` (new)

**Interfaces:**

Consumes:

- `isFileError`, `isMissing`, `listNames` and `parseJson` from Task 3 (`./files.js`); `RunState` from Task 1.
- File shapes, as observed in Claude Code 2.1.x (structure only): a run record `<session>/workflows/<runId>.json` is one JSON object with a string `status` (`killed` for TaskStop, another value when it completed), an ISO `timestamp` written at the end, a string `workflowName`, and per-agent progress that holds prompt and result previews; a session file `<config>/sessions/<pid>.json` is one JSON object with numeric `pid`, string `sessionId`, string `procStart` (field 22 of `/proc/<pid>/stat`, in clock ticks) and numeric `startedAt` (epoch ms). The stat parse follows `parseStat` in `plugins/shared-mcp/server/procfs.ts:32-44` (count fields from the last `)`), copied in spirit since a built-in cannot import another plugin.

Produces (`plugins/claude-workflows/server/state.ts`):

- `export const RECORD_MAX_BYTES = 16 * 1024 * 1024` and `export const RECORD_STALE_AFTER_MS = 1000`
- `export type RecordProblem = "too-large" | "no-status"` and `export class RunRecordUnreadableError extends Error { readonly problem: RecordProblem }`
- `export interface RecordFacts { killed: boolean; endedAt: number | null; name: string | null }`
- `export async function readRecordFacts(path: string): Promise<RecordFacts | null>`: null when the file is missing or is not complete JSON; rejects with `RunRecordUnreadableError` when it is larger than `RECORD_MAX_BYTES` or has no string `status`; a `timestamp` or `workflowName` of the wrong type becomes null.
- `export interface LiveSessionQuery { configDir: string; sessionId: string; startedBy: number; procRoot: string }`
- `export async function hasLiveSession(query: LiveSessionQuery): Promise<boolean>`
- `export interface RunStatus { state: RunState; endedAt: number | null }`
- `export interface RunStateInput { record: RecordFacts | null; journalMtimeMs: number; isLive(): Promise<boolean> }`
- `export async function decideRunState(input: RunStateInput): Promise<RunStatus>`: a current record gives `completed` or `killed` with its `endedAt`, without calling `isLive`; otherwise `isLive()` gives `running` or `stopped` with `endedAt: null`. A record is not current when it has an end time and the journal's mtime is more than `RECORD_STALE_AFTER_MS` after it.

- [ ] **Step 1: Write the failing state test**

Create `plugins/claude-workflows/server/state.test.ts`:

```ts
import { mkdir, mkdtemp, realpath, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  decideRunState,
  hasLiveSession,
  readRecordFacts,
  RECORD_MAX_BYTES,
  type LiveSessionQuery,
  type RecordFacts,
} from "./state.js";

const SESSION_ID = "0f8c2d4e-1a2b-4c3d-8e9f-0123456789ab";
const OTHER_SESSION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const T0 = Date.UTC(2026, 10, 7, 9, 0, 0);
const PID = 4_000_001;
const START_TIME = "873421";

let root = "";
let configDir = "";
let procRoot = "";

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), "claude-workflows-state-")));
  configDir = join(root, ".claude");
  procRoot = join(root, "proc");
  await mkdir(join(configDir, "sessions"), { recursive: true });
  await mkdir(procRoot);
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

interface ClaudeSession {
  pid: number;
  sessionId: string;
  startedAt: number;
}

/** A session file under `<pid>.json`, as Claude Code writes it. */
async function writeSession(session: ClaudeSession): Promise<void> {
  const body = { ...session, procStart: START_TIME, status: "busy" };
  await writeFile(join(configDir, "sessions", `${session.pid}.json`), JSON.stringify(body));
}

/** A /proc/<pid>/stat whose comm holds spaces and parentheses. */
async function writeProcStat(pid: number, startTime: string): Promise<void> {
  await mkdir(join(procRoot, String(pid)), { recursive: true });
  const stat = `${pid} (claude (x) y) S 1 ${pid} ${pid} 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 ${startTime} 0 0\n`;
  await writeFile(join(procRoot, String(pid), "stat"), stat);
}

function query(startedBy: number): LiveSessionQuery {
  return { configDir, sessionId: SESSION_ID, startedBy, procRoot };
}

async function writeRecord(body: string): Promise<string> {
  await mkdir(join(root, "workflows"), { recursive: true });
  const path = join(root, "workflows", "wf_0a1b2c3d-4e5.json");
  await writeFile(path, body);
  return path;
}

function recordBody(status: string): string {
  return JSON.stringify({
    status,
    timestamp: new Date(T0 + 10_000).toISOString(),
    workflowName: "read-files",
    workflowProgress: [{ label: "Read a.txt", promptPreview: "p", resultPreview: "r" }],
  });
}

interface LiveCheck {
  calls: number;
  isLive(): Promise<boolean>;
}

function liveCheck(live: boolean): LiveCheck {
  const check: LiveCheck = {
    calls: 0,
    async isLive() {
      check.calls += 1;
      return live;
    },
  };
  return check;
}

const COMPLETED: RecordFacts = { killed: false, endedAt: T0 + 10_000, name: "read-files" };
const KILLED: RecordFacts = { killed: true, endedAt: T0 + 10_000, name: "read-files" };

describe("hasLiveSession", () => {
  it("finds the live process that owns the session", async () => {
    await writeSession({ pid: PID, sessionId: SESSION_ID, startedAt: T0 });
    await writeProcStat(PID, START_TIME);

    await expect(hasLiveSession(query(T0 + 4000))).resolves.toBe(true);
  });

  it("rejects a pid that another process now uses", async () => {
    await writeSession({ pid: PID, sessionId: SESSION_ID, startedAt: T0 });
    await writeProcStat(PID, "999999");

    await expect(hasLiveSession(query(T0 + 4000))).resolves.toBe(false);
  });

  it("rejects a process that started after the run's newest agent", async () => {
    await writeSession({ pid: PID, sessionId: SESSION_ID, startedAt: T0 + 5000 });
    await writeProcStat(PID, START_TIME);

    await expect(hasLiveSession(query(T0 + 4000))).resolves.toBe(false);
  });

  it("ignores other sessions, key files, garbled files and exited processes", async () => {
    await writeSession({ pid: PID, sessionId: OTHER_SESSION_ID, startedAt: T0 });
    await writeProcStat(PID, START_TIME);
    // An owner's contents under a key file's name (`<pid>.<64 hex>.key`, as Claude Code names
    // them): reading it would find a live owner.
    const owner = { pid: PID, sessionId: SESSION_ID, procStart: START_TIME, startedAt: T0 };
    const keyName = `${PID}.${"ab".repeat(32)}.key`;
    await writeFile(join(configDir, "sessions", keyName), JSON.stringify(owner));
    await writeFile(join(configDir, "sessions", "4000002.json"), "{not json");
    await writeSession({ pid: 4_000_003, sessionId: SESSION_ID, startedAt: T0 });

    await expect(hasLiveSession(query(T0 + 4000))).resolves.toBe(false);
  });

  it("finds nothing without a sessions dir", async () => {
    await rm(join(configDir, "sessions"), { recursive: true });

    await expect(hasLiveSession(query(T0 + 4000))).resolves.toBe(false);
  });
});

describe("readRecordFacts", () => {
  it("reads a completed record", async () => {
    const path = await writeRecord(recordBody("completed"));

    await expect(readRecordFacts(path)).resolves.toEqual(COMPLETED);
  });

  it("reads a killed record", async () => {
    const path = await writeRecord(recordBody("killed"));

    await expect(readRecordFacts(path)).resolves.toEqual(KILLED);
  });

  it("has no record while the file is missing or not complete JSON", async () => {
    await expect(readRecordFacts(join(root, "workflows", "absent.json"))).resolves.toBeNull();
    const path = await writeRecord('{"status":"comp');

    await expect(readRecordFacts(path)).resolves.toBeNull();
  });

  it("drops an end time or a name it cannot use", async () => {
    const unusable = { killed: false, endedAt: null, name: null };
    const wrongTypes = await writeRecord(
      JSON.stringify({ status: "completed", timestamp: 12, workflowName: ["x"] }),
    );
    await expect(readRecordFacts(wrongTypes)).resolves.toEqual(unusable);

    const badTime = await writeRecord(
      JSON.stringify({ status: "completed", timestamp: "not a time" }),
    );
    await expect(readRecordFacts(badTime)).resolves.toEqual(unusable);
  });

  it("rejects a record without a status, and one too large to read", async () => {
    const noStatus = await writeRecord(JSON.stringify({ timestamp: new Date(T0).toISOString() }));
    await expect(readRecordFacts(noStatus)).rejects.toMatchObject({
      name: "RunRecordUnreadableError",
      problem: "no-status",
    });

    const large = await writeRecord("{}");
    await truncate(large, RECORD_MAX_BYTES + 1);
    await expect(readRecordFacts(large)).rejects.toMatchObject({
      name: "RunRecordUnreadableError",
      problem: "too-large",
    });
  });
});

describe("decideRunState", () => {
  it("takes Completed or Killed from a record without checking the process", async () => {
    const check = liveCheck(true);
    const input = { journalMtimeMs: T0 + 9000, isLive: check.isLive };

    await expect(decideRunState({ ...input, record: COMPLETED })).resolves.toEqual({
      state: "completed",
      endedAt: T0 + 10_000,
    });
    await expect(decideRunState({ ...input, record: KILLED })).resolves.toEqual({
      state: "killed",
      endedAt: T0 + 10_000,
    });
    expect(check.calls).toBe(0);
  });

  it("without a record, gives Running while a live process owns the run, else Stopped", async () => {
    const live = liveCheck(true);
    const gone = liveCheck(false);

    await expect(
      decideRunState({ record: null, journalMtimeMs: T0, isLive: live.isLive }),
    ).resolves.toEqual({ state: "running", endedAt: null });
    await expect(
      decideRunState({ record: null, journalMtimeMs: T0, isLive: gone.isLive }),
    ).resolves.toEqual({ state: "stopped", endedAt: null });
    expect([live.calls, gone.calls]).toEqual([1, 1]);
  });

  it("treats a record as a resumed run's once the journal changed over a second after it", async () => {
    const check = liveCheck(true);

    const status = await decideRunState({
      record: COMPLETED,
      journalMtimeMs: T0 + 11_001,
      isLive: check.isLive,
    });

    expect(status).toEqual({ state: "running", endedAt: null });
    expect(check.calls).toBe(1);
  });

  it("keeps a record the journal changed within a second of, or one without an end time", async () => {
    const check = liveCheck(true);

    const within = await decideRunState({
      record: COMPLETED,
      journalMtimeMs: T0 + 11_000,
      isLive: check.isLive,
    });
    const untimed = await decideRunState({
      record: { ...COMPLETED, endedAt: null },
      journalMtimeMs: T0 + 60_000,
      isLive: check.isLive,
    });

    expect([within, untimed]).toEqual([
      { state: "completed", endedAt: T0 + 10_000 },
      { state: "completed", endedAt: null },
    ]);
    expect(check.calls).toBe(0);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/state.test.ts --bail=1`

Expected: FAIL. The output names `Cannot find module` and `state.js`, and ends with `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the state check**

Create `plugins/claude-workflows/server/state.ts`:

```ts
import { open, readFile, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { RunState } from "../shared/run.js";
import { isFileError, isMissing, listNames, parseJson } from "./files.js";

/** A run record larger than this is unreadable rather than read into memory. */
export const RECORD_MAX_BYTES = 16 * 1024 * 1024;

/**
 * How long after a record's end time the journal may still change before the record counts as
 * an earlier attempt's: a resume appends to the journal and rewrites the record only at its end.
 */
export const RECORD_STALE_AFTER_MS = 1000;

export type RecordProblem = "too-large" | "no-status";

/** The run record exists but cannot be used. */
export class RunRecordUnreadableError extends Error {
  readonly problem: RecordProblem;

  constructor(problem: RecordProblem) {
    super(`Workflow run record is unusable: ${problem}`);
    this.name = "RunRecordUnreadableError";
    this.problem = problem;
  }
}

/** The only facts taken from a run record, which also holds prompts and results. */
export interface RecordFacts {
  killed: boolean;
  /** Epoch milliseconds. */
  endedAt: number | null;
  name: string | null;
}

const RecordSchema = z.object({
  status: z.string(),
  timestamp: z.string().nullable().catch(null),
  workflowName: z.string().nullable().catch(null),
});

/**
 * Status, end time and name from a run record, or null when there is none yet. Claude Code
 * writes the record once, so a read that races the write sees incomplete JSON: none yet.
 */
export async function readRecordFacts(path: string): Promise<RecordFacts | null> {
  const text = await readCapped(path);
  if (text === null) return null;
  const json = parseJson(text);
  if (json === undefined) return null;
  const parsed = RecordSchema.safeParse(json);
  if (!parsed.success) throw new RunRecordUnreadableError("no-status");
  const { status, timestamp, workflowName } = parsed.data;
  const killed = status === "killed";
  const endedAt = timestamp === null ? null : parseTime(timestamp);
  return { killed, endedAt, name: workflowName };
}

function parseTime(text: string): number | null {
  const at = Date.parse(text);
  return Number.isNaN(at) ? null : at;
}

async function readCapped(path: string): Promise<string | null> {
  const handle = await openIfPresent(path);
  if (handle === null) return null;
  try {
    const { size } = await handle.stat();
    if (size > RECORD_MAX_BYTES) throw new RunRecordUnreadableError("too-large");
    return await handle.readFile("utf8");
  } finally {
    await handle.close();
  }
}

async function openIfPresent(path: string): Promise<FileHandle | null> {
  try {
    return await open(path, "r");
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

export interface LiveSessionQuery {
  configDir: string;
  sessionId: string;
  /** Epoch ms: a process that started later than this did not start the run's newest agent. */
  startedBy: number;
  /** `/proc`, or a fake one in tests. */
  procRoot: string;
}

const SESSION_FILE = /^\d+\.json$/;

const SessionFileSchema = z.object({
  pid: z.number().int().positive(),
  sessionId: z.string(),
  procStart: z.string(),
  startedAt: z.number(),
});
type SessionFile = z.output<typeof SessionFileSchema>;

/**
 * Whether a live Claude process owns the session: a `<config>/sessions/<pid>.json` for it whose
 * process still runs (its /proc start time equals `procStart`) and started no later than
 * `startedBy`. Only `<pid>.json` files are read, never the `.key` files beside them.
 */
export async function hasLiveSession(query: LiveSessionQuery): Promise<boolean> {
  const dir = join(query.configDir, "sessions");
  const names = await listNames(dir);
  for (const name of names.filter((entry) => SESSION_FILE.test(entry))) {
    const session = await readSessionFile(join(dir, name));
    if (session?.sessionId !== query.sessionId) continue;
    if (session.startedAt > query.startedBy) continue;
    const startTime = await procStartTime(query.procRoot, session.pid);
    if (startTime === session.procStart) return true;
  }
  return false;
}

async function readSessionFile(path: string): Promise<SessionFile | null> {
  let text: string;
  try {
    text = await readFile(path, "utf8");
  } catch (error) {
    // Gone since the listing, or unreadable: either way it names no live owner. Claude Code
    // often leaves the file behind when its process exits, so liveness comes from /proc.
    if (isFileError(error)) return null;
    throw error;
  }
  const parsed = SessionFileSchema.safeParse(parseJson(text));
  return parsed.success ? parsed.data : null;
}

/** Field 22 of /proc/<pid>/stat, the start time in clock ticks; null when the process is gone. */
async function procStartTime(procRoot: string, pid: number): Promise<string | null> {
  let stat: string;
  try {
    stat = await readFile(join(procRoot, String(pid), "stat"), "utf8");
  } catch (error) {
    // ENOENT also covers a system without /proc.
    if (isMissing(error)) return null;
    throw error;
  }
  // Field 2, comm, may hold spaces and parentheses, so fields are counted from the last ")", as
  // plugins/shared-mcp/server/procfs.ts does: after ") " come 3 state ... 22 starttime.
  const fields = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
  return fields.length > 19 ? fields[19] : null;
}

/** The run's state, and its end time when a run record decided it. */
export interface RunStatus {
  state: RunState;
  /** Epoch milliseconds. */
  endedAt: number | null;
}

export interface RunStateInput {
  record: RecordFacts | null;
  journalMtimeMs: number;
  /** Called only when no current record decides the state. */
  isLive(): Promise<boolean>;
}

/**
 * Completed or Killed from a current run record; without one, Running while a live Claude
 * process owns the run, else Stopped.
 */
export async function decideRunState(input: RunStateInput): Promise<RunStatus> {
  const record = currentRecord(input);
  if (record !== null) {
    const finished: RunState = record.killed ? "killed" : "completed";
    return { state: finished, endedAt: record.endedAt };
  }
  const live = await input.isLive();
  const unfinished: RunState = live ? "running" : "stopped";
  return { state: unfinished, endedAt: null };
}

/** The record, unless a resume has changed the journal since the record was written. */
function currentRecord(input: RunStateInput): RecordFacts | null {
  const { record, journalMtimeMs } = input;
  const endedAt = record?.endedAt ?? null;
  if (endedAt === null) return record;
  const resumedSince = journalMtimeMs > endedAt + RECORD_STALE_AFTER_MS;
  return resumedSince ? null : record;
}
```

- [ ] **Step 4: Run the state test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/state.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  14 passed (14)`.

- [ ] **Step 5: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-workflows/server/state.ts plugins/claude-workflows/server/state.test.ts && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- plugins/claude-workflows/server/state.ts plugins/claude-workflows/server/state.test.ts
```

Expected: oxfmt exits 0, then `Found 0 warnings and 0 errors.`

- [ ] **Step 6: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics.

- [ ] **Step 7: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add plugins/claude-workflows/server/state.ts plugins/claude-workflows/server/state.test.ts
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): decide a workflow run's state from its record and process" -- plugins/claude-workflows/server/state.ts plugins/claude-workflows/server/state.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/claude-workflows
```

Expected: the hook passes and git prints `2 files changed`; `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` prints the subject and exactly the two paths; `status` prints nothing. If a hook job fails, git creates no commit: report the hook output and stop.

---

### Task 7: Per-run cache

**Files:**

- Create: `plugins/claude-workflows/server/cache.ts`
- Test: `plugins/claude-workflows/server/cache.test.ts` (new)

**Interfaces:**

Consumes: nothing from earlier tasks; the cache is generic over its per-run state.

Produces (`plugins/claude-workflows/server/cache.ts`):

- `export const CACHE_CAPACITY = 32` and `export const CACHE_IDLE_MS = 10 * 60 * 1000`
- `export interface RunCache<State> { use<Result>(key: string, work: (state: State) => Promise<Result>): Promise<Result> }`: `work` runs on the key's state once every earlier call for that key has settled, fulfilled or rejected; it returns `work`'s promise. Keys never wait for each other.
- `export interface RunCacheOptions<State> { create(): State; now(): number }`
- `export function createRunCache<State>(options: RunCacheOptions<State>): RunCache<State>`: at the start of each call it drops entries idle for `CACHE_IDLE_MS` or longer, then, for a new key while full, the least recently used entry. It holds no timer: an idle entry goes on the next call.

- [ ] **Step 1: Write the failing cache test**

Create `plugins/claude-workflows/server/cache.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CACHE_CAPACITY, CACHE_IDLE_MS, createRunCache } from "./cache.js";

interface Counted {
  id: number;
}

/** Numbers each state it creates, so a test can tell a kept state from a new one. */
function counter(): () => Counted {
  let next = 0;
  return () => {
    next += 1;
    return { id: next };
  };
}

async function readId(state: Counted): Promise<number> {
  return state.id;
}

interface Gate {
  opened: Promise<void>;
  open(): void;
}

function gate(): Gate {
  let release = () => {};
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { opened, open: () => release() };
}

/** Lets every queued promise callback run. */
async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("createRunCache", () => {
  it("keeps one state per key", async () => {
    const cache = createRunCache({ create: counter(), now: () => 0 });

    const ids = [
      await cache.use("a", readId),
      await cache.use("b", readId),
      await cache.use("a", readId),
    ];

    expect(ids).toEqual([1, 2, 1]);
  });

  it("runs calls for one key one at a time, in call order", async () => {
    const cache = createRunCache({ create: counter(), now: () => 0 });
    const events: string[] = [];
    const first = gate();

    const one = cache.use("run", async () => {
      events.push("one started");
      await first.opened;
      events.push("one finished");
      return 1;
    });
    const two = cache.use("run", async () => {
      events.push("two started");
      return 2;
    });
    await settle();
    expect(events).toEqual(["one started"]);

    first.open();
    await expect(Promise.all([one, two])).resolves.toEqual([1, 2]);
    expect(events).toEqual(["one started", "one finished", "two started"]);
  });

  it("runs the next call for a key after a call that failed", async () => {
    const cache = createRunCache({ create: counter(), now: () => 0 });

    const failing = cache.use("run", async () => {
      throw new Error("read failed");
    });
    const next = cache.use("run", readId);

    await expect(failing).rejects.toThrow("read failed");
    await expect(next).resolves.toBe(1);
  });

  it("does not hold one key's calls behind another's", async () => {
    const cache = createRunCache({ create: counter(), now: () => 0 });
    const held = gate();

    const slow = cache.use("a", async (state) => {
      await held.opened;
      return state.id;
    });

    await expect(cache.use("b", readId)).resolves.toBe(2);
    held.open();
    await expect(slow).resolves.toBe(1);
  });

  it("drops the least recently used key when full", async () => {
    const cache = createRunCache({ create: counter(), now: () => 0 });
    for (let index = 0; index < CACHE_CAPACITY; index++) {
      await cache.use(`run-${index}`, readId);
    }

    await cache.use("run-0", readId);
    await cache.use(`run-${CACHE_CAPACITY}`, readId);

    await expect(cache.use("run-0", readId)).resolves.toBe(1);
    await expect(cache.use("run-1", readId)).resolves.toBe(CACHE_CAPACITY + 2);
  });

  it("drops a key no call has used for ten minutes on the next call", async () => {
    let now = 0;
    const cache = createRunCache({ create: counter(), now: () => now });
    await cache.use("a", readId);
    await cache.use("b", readId);

    now = CACHE_IDLE_MS - 1;
    await expect(cache.use("a", readId)).resolves.toBe(1);
    now = CACHE_IDLE_MS;

    await expect(cache.use("b", readId)).resolves.toBe(3);
    await expect(cache.use("a", readId)).resolves.toBe(1);
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/cache.test.ts --bail=1`

Expected: FAIL. The output names `Cannot find module` and `cache.js`, and ends with `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the cache**

Create `plugins/claude-workflows/server/cache.ts`:

```ts
/** At most this many runs are kept; when full, the least recently used goes first. */
export const CACHE_CAPACITY = 32;

/** A run no call has used for this long is dropped on the next call. */
export const CACHE_IDLE_MS = 10 * 60 * 1000;

export interface RunCache<State> {
  /** Runs `work` on the key's state once every earlier call for the key has settled. */
  use<Result>(key: string, work: (state: State) => Promise<Result>): Promise<Result>;
}

export interface RunCacheOptions<State> {
  create(): State;
  now(): number;
}

interface Slot<State> {
  state: State;
  usedAt: number;
  /** Settles when the latest call for the key settles; never rejects. */
  tail: Promise<unknown>;
}

/** An LRU of per-run state that serializes calls per run. It holds no timer. */
export function createRunCache<State>(options: RunCacheOptions<State>): RunCache<State> {
  const slots = new Map<string, Slot<State>>();
  return {
    use(key, work) {
      const now = options.now();
      for (const [entryKey, entry] of slots) {
        if (now - entry.usedAt >= CACHE_IDLE_MS) slots.delete(entryKey);
      }
      const slot = slots.get(key) ?? newSlot(options, now);
      // Map order is use order, so the first key is the least recently used.
      slots.delete(key);
      if (slots.size >= CACHE_CAPACITY) {
        const [oldest] = slots.keys();
        slots.delete(oldest);
      }
      slots.set(key, slot);
      slot.usedAt = now;
      const result = slot.tail.then(() => work(slot.state));
      slot.tail = result.catch(() => undefined);
      return result;
    },
  };
}

function newSlot<State>(options: RunCacheOptions<State>, now: number): Slot<State> {
  const state = options.create();
  return { state, usedAt: now, tail: Promise.resolve() };
}
```

The `tail` chain is not a detached promise: `result` goes back to the RPC handler, whose rejection the host catches, and `tail` is a handled copy that only orders the next call.

- [ ] **Step 4: Run the cache test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/cache.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  6 passed (6)`.

- [ ] **Step 5: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-workflows/server/cache.ts plugins/claude-workflows/server/cache.test.ts && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- plugins/claude-workflows/server/cache.ts plugins/claude-workflows/server/cache.test.ts
```

Expected: oxfmt exits 0, then `Found 0 warnings and 0 errors.`

- [ ] **Step 6: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics.

- [ ] **Step 7: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add plugins/claude-workflows/server/cache.ts plugins/claude-workflows/server/cache.test.ts
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): cache workflow run reads per run" -- plugins/claude-workflows/server/cache.ts plugins/claude-workflows/server/cache.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/claude-workflows
```

Expected: the hook passes and git prints `2 files changed`; `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` prints the subject and exactly the two paths; `status` prints nothing. If a hook job fails, git creates no commit: report the hook output and stop.

---

### Task 8: The RPC handler and the server entry

**Files:**

- Create: `plugins/claude-workflows/server/run.ts`
- Test: `plugins/claude-workflows/server/run.test.ts` (new)
- Modify: `plugins/claude-workflows/index.server.ts` (replace the Task 1 stub)
- Test: `packages/server/src/server/plugins/builtin/index.test.ts` (existing, unchanged)

**Interfaces:**

Consumes:

- Task 1: `RunViewSchema`, `RunRequest`, `RunView`, `LoadedRun`, `RunAgent`, `AgentState`, `LastTool`, `RunState`, `UnavailableReason`, `runRpc`.
- Task 2: `readAgentFacts(agents, agentId)`, `AgentDirectory`.
- Task 3: `claudeConfigDirs(lookup)`, `locateRun(input)`, `RunLocation`, whose `sessionId` names the session the run was found in, which the liveness query asks about; `isMissing`, `isFileError`.
- Task 4: `newCursor()`, `readNewLines(request)`, `FileCursor`, `LineSink`.
- Task 5: `newJournalFold()`, `foldJournalLine`, `journalAgents`, `newAgentFold()`, `isCandidateLine`, `foldAgentLine`, `JournalFold`, `JournalAgent`, `AgentFold`, `LastToolUse`.
- Task 6: `readRecordFacts(path)`, `hasLiveSession(query)`, `decideRunState(input)`, `RunRecordUnreadableError`.
- Task 7: `createRunCache(options)`, `RunCache`.
- `PluginServerContext.handle(contract, (input, { paseo }) => output | Promise<output>)` (`packages/plugin/src/server/contracts.ts:58-64`); `paseo.agents` is `PaseoAgentActions` (`packages/client/src/index.ts:514`), which satisfies `AgentDirectory` structurally. The host parses the input with `runRpc.input` before the handler runs, and the client's `useRpc` parses the output with `runRpc.output` (`packages/plugin/src/client/rpc-context.tsx:53-64`); the handler parses its own view as well, so a bad view fails on the daemon too.

Produces:

- `plugins/claude-workflows/server/run.ts`: `export interface RunFiles { journal: JournalFile; agents: Map<string, AgentFile> }`, `export function newRunFiles(): RunFiles`, `export interface RunEnvironment { agents: AgentDirectory; home: string; env: NodeJS.ProcessEnv; procRoot: string; cache: RunCache<RunFiles> }`, and `export async function loadRun(request: RunRequest, environment: RunEnvironment): Promise<RunView>`. Unavailable reasons: `agent-not-found` and `not-claude` from the lookup; `run-not-found` when no config dir holds the run or a run file vanished (`isMissing`); `run-unreadable` for `RunRecordUnreadableError` or any other file error outside an agent file. A rejecting snapshot read and any other error reject.
- `plugins/claude-workflows/index.server.ts`: `export default function contribute(server: PluginServerContext): () => void`, which creates one cache and serves `runRpc` with `home: homedir()`, `env: process.env` and `procRoot: "/proc"`.

- [ ] **Step 1: Write the failing handler test**

Create `plugins/claude-workflows/server/run.test.ts`:

```ts
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  open,
  realpath,
  rm,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentState, LoadedRun, RunAgent, RunRequest, RunView } from "../shared/run.js";
import type { AgentDirectory, AgentSnapshot } from "./agent.js";
import { createRunCache } from "./cache.js";
import { projectSlug } from "./locate.js";
import { loadRun, newRunFiles, type RunEnvironment } from "./run.js";

const SESSION_ID = "0f8c2d4e-1a2b-4c3d-8e9f-0123456789ab";
/** The agent's session after a `/clear` or a restart; its earlier runs stay in SESSION_ID. */
const LATER_SESSION_ID = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const RUN_ID = "wf_0a1b2c3d-4e5";
const AGENT_ID = "agent-claude";
const T0 = Date.UTC(2026, 10, 7, 9, 0, 0);
const PID = 4_000_001;
const START_TIME = "873421";
/** Prompts, results, commands and tool output in the fixtures carry this; no view may. */
const PRIVATE = "PRIVATE-7f3a";
const REQUEST: RunRequest = { agentId: AGENT_ID, runId: RUN_ID };

interface Fixture {
  root: string;
  home: string;
  configDir: string;
  cwd: string;
  sessionDir: string;
  runDir: string;
  procRoot: string;
}

let fixture: Fixture;

beforeEach(async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "claude-workflows-run-")));
  const home = join(root, "home");
  const configDir = join(home, ".claude");
  const cwd = join(root, "project");
  await mkdir(cwd);
  const sessionDir = join(configDir, "projects", await projectSlug(cwd), SESSION_ID);
  const runDir = join(sessionDir, "subagents", "workflows", RUN_ID);
  const procRoot = join(root, "proc");
  await mkdir(runDir, { recursive: true });
  await mkdir(procRoot);
  fixture = { root, home, configDir, cwd, sessionDir, runDir, procRoot };
});

afterEach(async () => {
  await rm(fixture.root, { recursive: true, force: true });
});

interface Started {
  key: string;
  agentId: string;
  label: string;
  phase: string;
}

const READ_A: Started = { key: "read-a", agentId: "a1", label: "Read a.txt", phase: "Read" };
const READ_B: Started = { key: "read-b", agentId: "b1", label: "Read b.txt", phase: "Read" };
const REPORT: Started = { key: "report", agentId: "c1", label: "Report", phase: "Report" };
const READ_A_AGAIN: Started = { ...READ_A, agentId: "a2" };

function started(agent: Started): string {
  return JSON.stringify({ type: "started", ...agent });
}

function result(agent: Started): string {
  const text = `${PRIVATE} result`;
  return JSON.stringify({ type: "result", key: agent.key, agentId: agent.agentId, result: text });
}

function failed(agent: Started): string {
  return JSON.stringify({ type: "failed", key: agent.key, agentId: agent.agentId });
}

function jsonl(lines: string[]): string {
  return lines.map((line) => `${line}\n`).join("");
}

function journalPath(): string {
  return join(fixture.runDir, "journal.jsonl");
}

function agentPath(agentId: string): string {
  return join(fixture.runDir, `agent-${agentId}.jsonl`);
}

/** Sets the journal's mtime. Writing the journal sets it to the real time, so tests set it last. */
async function journalTouchedAt(seconds: number): Promise<void> {
  const time = new Date(T0 + seconds * 1000);
  await utimes(journalPath(), time, time);
}

interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AssistantTurn {
  seconds: number;
  tool: ToolCall;
  /** The context size the line reports. */
  tokens: number;
}

function at(seconds: number): string {
  return new Date(T0 + seconds * 1000).toISOString();
}

function assistantLine(turn: AssistantTurn): string {
  const usage = {
    input_tokens: 2,
    cache_read_input_tokens: turn.tokens - 10,
    cache_creation_input_tokens: 0,
    output_tokens: 8,
  };
  const content = [{ type: "tool_use", ...turn.tool }];
  return JSON.stringify({
    type: "assistant",
    timestamp: at(turn.seconds),
    cwd: fixture.cwd,
    message: { role: "assistant", content, usage },
  });
}

function toolResultLine(seconds: number, toolUseId: string): string {
  const block = { type: "tool_result", tool_use_id: toolUseId, content: `${PRIVATE} output` };
  return JSON.stringify({
    type: "user",
    timestamp: at(seconds),
    message: { role: "user", content: [block] },
  });
}

function promptLine(seconds: number): string {
  return JSON.stringify({
    type: "user",
    timestamp: at(seconds),
    message: { role: "user", content: `${PRIVATE} prompt` },
  });
}

function readTool(id: string, file: string): ToolCall {
  return { id, name: "Read", input: { file_path: join(fixture.cwd, file) } };
}

function editTool(id: string, file: string): ToolCall {
  const input = { file_path: join(fixture.cwd, file), old_string: PRIVATE, new_string: PRIVATE };
  return { id, name: "Edit", input };
}

function bashTool(id: string): ToolCall {
  return { id, name: "Bash", input: { command: `${PRIVATE} command` } };
}

function grepTool(id: string): ToolCall {
  return { id, name: "Grep", input: { pattern: PRIVATE, path: fixture.cwd } };
}

async function writeRecord(status: string, endedSeconds: number): Promise<void> {
  const dir = join(fixture.sessionDir, "workflows");
  await mkdir(dir, { recursive: true });
  const progress = {
    label: "Read a.txt",
    promptPreview: `${PRIVATE} prompt`,
    resultPreview: `${PRIVATE} result`,
    lastToolSummary: `${PRIVATE} command`,
  };
  const body = {
    status,
    timestamp: at(endedSeconds),
    workflowName: "read-files",
    workflowProgress: [progress],
  };
  await writeFile(join(dir, `${RUN_ID}.json`), JSON.stringify(body));
}

/** A live Claude process for the session, started at T0 plus `startedSeconds`. */
async function liveSession(startedSeconds: number): Promise<void> {
  const sessions = join(fixture.configDir, "sessions");
  await mkdir(sessions, { recursive: true });
  const session = {
    pid: PID,
    sessionId: SESSION_ID,
    procStart: START_TIME,
    startedAt: T0 + startedSeconds * 1000,
  };
  await writeFile(join(sessions, `${PID}.json`), JSON.stringify(session));
  await mkdir(join(fixture.procRoot, String(PID)));
  const stat = `${PID} (claude) S 1 ${PID} ${PID} 0 -1 4194304 0 0 0 0 0 0 0 0 20 0 1 0 ${START_TIME} 0 0\n`;
  await writeFile(join(fixture.procRoot, String(PID), "stat"), stat);
}

/** Overwrites a file's bytes with spaces in place, keeping its newlines, size and inode. */
async function blankInPlace(path: string): Promise<void> {
  const handle = await open(path, "r+");
  try {
    const bytes = await handle.readFile();
    const blank = bytes.map((byte) => (byte === 0x0a ? byte : 0x20));
    await handle.write(blank, 0, blank.length, 0);
  } finally {
    await handle.close();
  }
}

function claudeAgent(): AgentSnapshot {
  return { id: AGENT_ID, cwd: fixture.cwd, persistence: { sessionId: SESSION_ID } };
}

/** `paseo.agents` in memory: answers like fetch_agent, null for an unknown id. */
function directory(snapshots: AgentSnapshot[]): AgentDirectory {
  return {
    ref(agentId) {
      return {
        async refresh() {
          const agent = snapshots.find((snapshot) => snapshot.id === agentId);
          if (agent === undefined) return null;
          return { agent };
        },
      };
    },
  };
}

function environment(agents: AgentDirectory): RunEnvironment {
  const cache = createRunCache({ create: newRunFiles, now: () => T0 });
  return { agents, home: fixture.home, env: {}, procRoot: fixture.procRoot, cache };
}

function claudeEnvironment(): RunEnvironment {
  return environment(directory([claudeAgent()]));
}

function loaded(view: RunView): LoadedRun {
  if (view.state === "unavailable") throw new Error(`unexpected unavailable view: ${view.reason}`);
  return view;
}

/** a1 read a.txt and finished; b1 is running Bash; c1 has started but not written yet. */
async function threeAgentRun(): Promise<void> {
  await writeFile(
    journalPath(),
    jsonl([
      JSON.stringify({ type: "launched" }),
      started(READ_A),
      started(READ_B),
      result(READ_A),
      started(REPORT),
    ]),
  );
  await writeFile(
    agentPath("a1"),
    jsonl([
      promptLine(1),
      assistantLine({ seconds: 2, tool: readTool("toolu_a1", "a.txt"), tokens: 1200 }),
      toolResultLine(3, "toolu_a1"),
    ]),
  );
  await writeFile(
    agentPath("b1"),
    jsonl([promptLine(1), assistantLine({ seconds: 4, tool: bashTool("toolu_b1"), tokens: 2500 })]),
  );
  await journalTouchedAt(4);
}

interface PendingStates {
  readB: AgentState;
  report: AgentState;
}

/** threeAgentRun's agents as the view shows them, given the states of the two without an outcome. */
function threeAgents(states: PendingStates): RunAgent[] {
  const bashRunning = states.readB === "running";
  return [
    {
      key: "read-a",
      label: "Read a.txt",
      phase: "Read",
      state: "done",
      toolCalls: 1,
      lastTool: { name: "Read", file: "a.txt", running: false },
      tokens: 1200,
      firstActivityAt: T0 + 2000,
      lastActivityAt: T0 + 3000,
    },
    {
      key: "read-b",
      label: "Read b.txt",
      phase: "Read",
      state: states.readB,
      toolCalls: 1,
      lastTool: { name: "Bash", file: null, running: bashRunning },
      tokens: 2500,
      firstActivityAt: T0 + 4000,
      lastActivityAt: T0 + 4000,
    },
    {
      key: "report",
      label: "Report",
      phase: "Report",
      state: states.report,
      toolCalls: 0,
      lastTool: null,
      tokens: null,
      firstActivityAt: null,
      lastActivityAt: null,
    },
  ];
}

describe("loadRun", () => {
  it("shows a running run with each agent's progress", async () => {
    await threeAgentRun();
    await liveSession(0);

    await expect(loadRun(REQUEST, claudeEnvironment())).resolves.toEqual({
      state: "running",
      name: null,
      endedAt: null,
      agents: threeAgents({ readB: "running", report: "running" }),
    });
  });

  it("shows a completed run from its record", async () => {
    await threeAgentRun();
    await appendFile(journalPath(), jsonl([result(READ_B), result(REPORT)]));
    await writeRecord("completed", 10);
    await journalTouchedAt(9);

    await expect(loadRun(REQUEST, claudeEnvironment())).resolves.toEqual({
      state: "completed",
      name: "read-files",
      endedAt: T0 + 10_000,
      agents: threeAgents({ readB: "done", report: "done" }),
    });
  });

  it("shows a killed run from its record while its process still lives", async () => {
    await threeAgentRun();
    await writeRecord("killed", 10);
    await journalTouchedAt(9);
    await liveSession(0);

    await expect(loadRun(REQUEST, claudeEnvironment())).resolves.toEqual({
      state: "killed",
      name: "read-files",
      endedAt: T0 + 10_000,
      agents: threeAgents({ readB: "stopped", report: "stopped" }),
    });
  });

  it("shows a run without a record or a live process as Stopped", async () => {
    await threeAgentRun();

    await expect(loadRun(REQUEST, claudeEnvironment())).resolves.toEqual({
      state: "stopped",
      name: null,
      endedAt: null,
      agents: threeAgents({ readB: "stopped", report: "stopped" }),
    });
  });

  it("shows Stopped when the session's process started after the run's newest agent", async () => {
    await threeAgentRun();
    await liveSession(5);

    await expect(loadRun(REQUEST, claudeEnvironment())).resolves.toEqual({
      state: "stopped",
      name: null,
      endedAt: null,
      agents: threeAgents({ readB: "stopped", report: "stopped" }),
    });
  });

  it("follows a resumed run: Running from its new agent's start, then with its progress", async () => {
    await writeFile(
      journalPath(),
      jsonl([started(READ_A), started(READ_B), result(READ_B), failed(READ_A)]),
    );
    await writeFile(
      agentPath("a1"),
      jsonl([assistantLine({ seconds: 2, tool: readTool("toolu_a1", "a.txt"), tokens: 900 })]),
    );
    await writeFile(
      agentPath("b1"),
      jsonl([
        assistantLine({ seconds: 3, tool: grepTool("toolu_b1"), tokens: 700 }),
        toolResultLine(4, "toolu_b1"),
      ]),
    );
    await writeRecord("killed", 10);
    await appendFile(journalPath(), jsonl([started(READ_A_AGAIN)]));
    await journalTouchedAt(13);
    await liveSession(12);
    const env = claudeEnvironment();
    const readB: RunAgent = {
      key: "read-b",
      label: "Read b.txt",
      phase: "Read",
      state: "done",
      toolCalls: 1,
      lastTool: { name: "Grep", file: null, running: false },
      tokens: 700,
      firstActivityAt: T0 + 3000,
      lastActivityAt: T0 + 4000,
    };
    const readAWaiting: RunAgent = {
      key: "read-a",
      label: "Read a.txt",
      phase: "Read",
      state: "running",
      toolCalls: 0,
      lastTool: null,
      tokens: null,
      firstActivityAt: null,
      lastActivityAt: null,
    };

    await expect(loadRun(REQUEST, env)).resolves.toEqual({
      state: "running",
      name: "read-files",
      endedAt: null,
      agents: [readB, readAWaiting],
    });

    await writeFile(
      agentPath("a2"),
      jsonl([assistantLine({ seconds: 15, tool: readTool("toolu_a2", "a.txt"), tokens: 1100 })]),
    );
    const readAWorking: RunAgent = {
      key: "read-a",
      label: "Read a.txt",
      phase: "Read",
      state: "running",
      toolCalls: 1,
      lastTool: { name: "Read", file: "a.txt", running: true },
      tokens: 1100,
      firstActivityAt: T0 + 15_000,
      lastActivityAt: T0 + 15_000,
    };
    await expect(loadRun(REQUEST, env)).resolves.toEqual({
      state: "running",
      name: "read-files",
      endedAt: null,
      agents: [readB, readAWorking],
    });
  });

  it("reads only what each file gained since the last call", async () => {
    await threeAgentRun();
    await liveSession(0);
    const env = claudeEnvironment();
    await loadRun(REQUEST, env);

    // A reader that went back over b1's old bytes would now find no tool call there.
    await blankInPlace(agentPath("b1"));
    await appendFile(
      agentPath("b1"),
      jsonl([assistantLine({ seconds: 6, tool: editTool("toolu_b2", "b.txt"), tokens: 3000 })]),
    );
    const view = loaded(await loadRun(REQUEST, env));

    expect(view.agents[1]).toEqual({
      key: "read-b",
      label: "Read b.txt",
      phase: "Read",
      state: "running",
      toolCalls: 2,
      lastTool: { name: "Edit", file: "b.txt", running: true },
      tokens: 3000,
      firstActivityAt: T0 + 4000,
      lastActivityAt: T0 + 6000,
    });
  });

  // Root reads a mode-000 file anyway, so the failure cannot be produced as root.
  it.skipIf(process.getuid?.() === 0)(
    "marks only the agent whose file cannot be read",
    async () => {
      await threeAgentRun();
      await liveSession(0);
      await chmod(agentPath("b1"), 0o000);

      const view = loaded(await loadRun(REQUEST, claudeEnvironment()));

      expect(view.state).toBe("running");
      expect(view.agents.map((agent) => agent.state)).toEqual(["done", "unreadable", "running"]);
      expect(view.agents[1]).toEqual({
        key: "read-b",
        label: "Read b.txt",
        phase: "Read",
        state: "unreadable",
        toolCalls: 0,
        lastTool: null,
        tokens: null,
        firstActivityAt: null,
        lastActivityAt: null,
      });
    },
  );

  it("reports an agent it cannot find a Claude session for", async () => {
    await threeAgentRun();
    const plain: AgentSnapshot = { id: "agent-plain", cwd: fixture.cwd, persistence: null };
    const env = environment(directory([plain]));

    await expect(loadRun({ agentId: "agent-gone", runId: RUN_ID }, env)).resolves.toEqual({
      state: "unavailable",
      reason: "agent-not-found",
    });
    await expect(loadRun({ agentId: "agent-plain", runId: RUN_ID }, env)).resolves.toEqual({
      state: "unavailable",
      reason: "not-claude",
    });
  });

  it("reports run files it cannot find", async () => {
    await mkdir(join(fixture.sessionDir, "subagents", "workflows", "wf_00000000-000"));
    const env = claudeEnvironment();
    const notFound = { state: "unavailable", reason: "run-not-found" };

    for (const runId of ["wf_ffffffff-fff", "wf_00000000-000", "wf_bad"]) {
      await expect(loadRun({ agentId: AGENT_ID, runId }, env)).resolves.toEqual(notFound);
    }
  });

  it("reports a run record it cannot use", async () => {
    await threeAgentRun();
    await mkdir(join(fixture.sessionDir, "workflows"), { recursive: true });
    await writeFile(
      join(fixture.sessionDir, "workflows", `${RUN_ID}.json`),
      JSON.stringify({ status: 3 }),
    );

    await expect(loadRun(REQUEST, claudeEnvironment())).resolves.toEqual({
      state: "unavailable",
      reason: "run-unreadable",
    });
  });

  it("loads the card of a provider-subagent pane from its parent agent", async () => {
    await threeAgentRun();
    await liveSession(0);
    const request = { agentId: `provider:${AGENT_ID}:sub-1`, runId: RUN_ID };

    await expect(loadRun(request, claudeEnvironment())).resolves.toEqual({
      state: "running",
      name: null,
      endedAt: null,
      agents: threeAgents({ readB: "running", report: "running" }),
    });
  });

  it("loads a run from the agent's earlier session and checks that session's process", async () => {
    await threeAgentRun();
    await liveSession(0);
    const moved: AgentSnapshot = { ...claudeAgent(), persistence: { sessionId: LATER_SESSION_ID } };

    await expect(loadRun(REQUEST, environment(directory([moved])))).resolves.toEqual({
      state: "running",
      name: null,
      endedAt: null,
      agents: threeAgents({ readB: "running", report: "running" }),
    });
  });

  it("never puts prompts, results, commands or tool output into the view", async () => {
    await threeAgentRun();
    await appendFile(agentPath("b1"), jsonl([toolResultLine(5, "toolu_b1")]));
    await writeRecord("completed", 10);
    await journalTouchedAt(9);

    const view = await loadRun(REQUEST, claudeEnvironment());

    expect(JSON.stringify(view)).not.toContain(PRIVATE);
  });

  it("fails the call when the agent lookup fails, so the card keeps its data and polls again", async () => {
    const failing: AgentDirectory = {
      ref() {
        return {
          async refresh() {
            throw new Error("daemon connection closed");
          },
        };
      },
    };

    await expect(loadRun(REQUEST, environment(failing))).rejects.toThrow(
      "daemon connection closed",
    );
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/run.test.ts --bail=1`

Expected: FAIL. The output names `Cannot find module` and `run.js`, and ends with `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the handler body**

Create `plugins/claude-workflows/server/run.ts`:

```ts
import { join } from "node:path";
import {
  RunViewSchema,
  type AgentState,
  type LastTool,
  type LoadedRun,
  type RunAgent,
  type RunRequest,
  type RunState,
  type RunView,
  type UnavailableReason,
} from "../shared/run.js";
import { readAgentFacts, type AgentDirectory } from "./agent.js";
import type { RunCache } from "./cache.js";
import { isFileError, isMissing } from "./files.js";
import {
  foldAgentLine,
  foldJournalLine,
  isCandidateLine,
  journalAgents,
  newAgentFold,
  newJournalFold,
  type AgentFold,
  type JournalAgent,
  type JournalFold,
  type LastToolUse,
} from "./fold.js";
import { claudeConfigDirs, locateRun, type RunLocation } from "./locate.js";
import { newCursor, readNewLines, type FileCursor, type LineSink } from "./reader.js";
import {
  decideRunState,
  hasLiveSession,
  readRecordFacts,
  RunRecordUnreadableError,
} from "./state.js";

/** A journal agent id names a file only when it is made of these characters. */
const AGENT_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

interface JournalFile {
  cursor: FileCursor;
  fold: JournalFold;
  mtimeMs: number;
}

interface AgentFile {
  cursor: FileCursor;
  fold: AgentFold;
  unreadable: boolean;
}

/** What the cache keeps for one run dir: each file's cursor and fold. */
export interface RunFiles {
  journal: JournalFile;
  /** By agent id. */
  agents: Map<string, AgentFile>;
}

export function newRunFiles(): RunFiles {
  const journal = { cursor: newCursor(), fold: newJournalFold(), mtimeMs: 0 };
  return { journal, agents: new Map() };
}

export interface RunEnvironment {
  agents: AgentDirectory;
  home: string;
  env: NodeJS.ProcessEnv;
  /** `/proc`, or a fake one in tests. */
  procRoot: string;
  cache: RunCache<RunFiles>;
}

/** The RPC handler body: the run's view, checked by the shared schema before it leaves. */
export async function loadRun(request: RunRequest, environment: RunEnvironment): Promise<RunView> {
  const view = await buildView(request, environment);
  return RunViewSchema.parse(view);
}

async function buildView(request: RunRequest, environment: RunEnvironment): Promise<RunView> {
  const facts = await readAgentFacts(environment.agents, request.agentId);
  if (facts.kind === "unavailable") return unavailable(facts.reason);
  const { sessionId, cwd } = facts;
  try {
    const configDirs = await claudeConfigDirs(environment);
    const location = await locateRun({ configDirs, cwd, sessionId, runId: request.runId });
    if (location === null) return unavailable("run-not-found");
    const input = { location, runId: request.runId, procRoot: environment.procRoot };
    return await environment.cache.use(location.runDir, (files) => readRun(files, input));
  } catch (error) {
    // The run dir or its journal went away since it was located.
    if (isMissing(error)) return unavailable("run-not-found");
    if (error instanceof RunRecordUnreadableError) return unavailable("run-unreadable");
    if (isFileError(error)) return unavailable("run-unreadable");
    throw error;
  }
}

interface ReadRunInput {
  location: RunLocation;
  runId: string;
  procRoot: string;
}

interface AgentRow {
  agent: JournalAgent;
  file: AgentFile;
}

async function readRun(files: RunFiles, input: ReadRunInput): Promise<LoadedRun> {
  const { location } = input;
  const { journal } = files;
  const journalPath = join(location.runDir, "journal.jsonl");
  const sink = journalSink(journal);
  const { mtimeMs } = await readNewLines({ path: journalPath, cursor: journal.cursor, sink });
  journal.mtimeMs = mtimeMs;
  const agents = journalAgents(journal.fold);
  dropReplacedAttempts(files, agents);
  const rows: AgentRow[] = [];
  for (const agent of agents) {
    const file = await refreshAgent({ files, runDir: location.runDir, agentId: agent.agentId });
    rows.push({ agent, file });
  }
  const record = await readRecordFacts(
    join(location.sessionDir, "workflows", `${input.runId}.json`),
  );
  // Until the newest agent writes, its start is known only from the journal.
  const newest = rows.at(-1);
  const startedBy = newest?.file.fold.firstActivityAt ?? journal.mtimeMs;
  // The session the run was found in, which may be one the agent has left (Decision 5).
  const query = {
    configDir: location.configDir,
    sessionId: location.sessionId,
    startedBy,
    procRoot: input.procRoot,
  };
  const status = await decideRunState({
    record,
    journalMtimeMs: journal.mtimeMs,
    isLive: () => hasLiveSession(query),
  });
  const runAgents = rows.map((row) => toRunAgent(row, status.state));
  const name = record?.name ?? null;
  return { state: status.state, name, endedAt: status.endedAt, agents: runAgents };
}

function journalSink(journal: JournalFile): LineSink {
  return {
    restart() {
      journal.fold = newJournalFold();
    },
    line(text) {
      foldJournalLine(journal.fold, text);
    },
  };
}

function agentSink(file: AgentFile): LineSink {
  return {
    restart() {
      file.fold = newAgentFold();
    },
    line(text) {
      if (isCandidateLine(text)) foldAgentLine(file.fold, text);
    },
  };
}

/** Forgets the files of attempts a rerun replaced, so the cache holds current agents only. */
function dropReplacedAttempts(files: RunFiles, agents: JournalAgent[]): void {
  const current = new Set(agents.map((agent) => agent.agentId));
  for (const agentId of files.agents.keys()) {
    if (!current.has(agentId)) files.agents.delete(agentId);
  }
}

interface AgentRead {
  files: RunFiles;
  runDir: string;
  agentId: string;
}

/** Reads what the agent wrote since the last call. A file error marks only this agent unreadable. */
async function refreshAgent(read: AgentRead): Promise<AgentFile> {
  const { files, runDir, agentId } = read;
  const file = files.agents.get(agentId) ?? newAgentFile();
  files.agents.set(agentId, file);
  if (!AGENT_ID_PATTERN.test(agentId)) {
    file.unreadable = true;
    return file;
  }
  const path = join(runDir, `agent-${agentId}.jsonl`);
  try {
    await readNewLines({ path, cursor: file.cursor, sink: agentSink(file) });
    file.unreadable = false;
  } catch (error) {
    if (!isFileError(error)) throw error;
    // A missing file means the agent has started but not written yet.
    file.unreadable = !isMissing(error);
  }
  return file;
}

function newAgentFile(): AgentFile {
  return { cursor: newCursor(), fold: newAgentFold(), unreadable: false };
}

function toRunAgent(row: AgentRow, runState: RunState): RunAgent {
  const { agent, file } = row;
  const state = agentState(row, runState);
  const lastTool = lastToolView(file.fold.lastTool, state);
  const { toolCalls, tokens, firstActivityAt, lastActivityAt } = file.fold;
  const { key, label, phase } = agent;
  return { key, label, phase, state, toolCalls, lastTool, tokens, firstActivityAt, lastActivityAt };
}

function agentState(row: AgentRow, runState: RunState): AgentState {
  if (row.file.unreadable) return "unreadable";
  if (row.agent.outcome !== null) return row.agent.outcome;
  return runState === "running" ? "running" : "stopped";
}

function lastToolView(lastTool: LastToolUse | null, state: AgentState): LastTool | null {
  if (lastTool === null) return null;
  const running = state === "running" && !lastTool.done;
  return { name: lastTool.name, file: lastTool.file, running };
}

function unavailable(reason: UnavailableReason): RunView {
  return { state: "unavailable", reason };
}
```

- [ ] **Step 4: Run the handler test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/server/run.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  15 passed (15)`. Run as root, the unreadable test shows as skipped (`1 skipped`) and 14 pass; the container user is not root, so 15 pass here.

- [ ] **Step 5: Serve the RPC from the server entry**

Replace the whole of `plugins/claude-workflows/index.server.ts` with:

```ts
import { homedir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { runRpc } from "./shared/run.js";
import { createRunCache } from "./server/cache.js";
import { loadRun, newRunFiles } from "./server/run.js";

export default function contribute(server: PluginServerContext) {
  const cache = createRunCache({ create: newRunFiles, now: () => Date.now() });
  const home = homedir();
  server.handle(runRpc, (input, { paseo }) =>
    loadRun(input, { agents: paseo.agents, home, env: process.env, procRoot: "/proc", cache }),
  );
  // Nothing to stop: the plugin holds no timer, watcher or open file between calls.
  return () => {};
}
```

- [ ] **Step 6: Run the registry test and confirm the entry compiles**

Run: `cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1`

Expected: PASS, 1 test. A server file that imports anything outside `@getpaseo/plugin/*`, `zod` and `node:*` fails here.

- [ ] **Step 7: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-workflows/server/run.ts plugins/claude-workflows/server/run.test.ts plugins/claude-workflows/index.server.ts && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- plugins/claude-workflows/server/run.ts plugins/claude-workflows/server/run.test.ts plugins/claude-workflows/index.server.ts
```

Expected: oxfmt exits 0 (it rewraps the long lines), then `Found 0 warnings and 0 errors.`

- [ ] **Step 8: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics. This is the check that `paseo.agents` fits `AgentDirectory` and that `loadRun`'s result fits the handler's output type; if either fails, stop and report the diagnostic rather than adding a cast.

- [ ] **Step 9: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add plugins/claude-workflows/server/run.ts plugins/claude-workflows/server/run.test.ts plugins/claude-workflows/index.server.ts
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): serve claude-workflows.run.request" -- plugins/claude-workflows/server/run.ts plugins/claude-workflows/server/run.test.ts plugins/claude-workflows/index.server.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/claude-workflows
```

Expected: the hook passes and git prints `3 files changed`; `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` prints the subject and exactly the three paths; `status` prints nothing. If a hook job fails, git creates no commit: report the hook output and stop.

---

### Task 9: The Workflow card transformer

**Files:**

- Create: `plugins/claude-workflows/client/transform.ts`
- Test: `plugins/claude-workflows/client/transform.test.ts` (new)

**Interfaces:**

Consumes:

- Task 1: `WORKFLOW_ITEM_KIND`, `WORKFLOW_ITEM_VERSION`, `WorkflowItem`.
- `PluginTimelineTransformerContribution<"tool_call">` from `@getpaseo/plugin/client` (`packages/plugin/src/client/contracts.ts:277-290`): `transform({ item, phase })` gets the `tool_call` timeline item and returns `{ items: PluginTimelineItem[] }` or `undefined` to keep the source item. A `PluginTimelineItem` is `{ type: "plugin"; id?: string; kind: string; version: number; data: JsonValue }` (`packages/plugin/src/contracts.ts:86-96`). The `ToolCallTransformer` alias is copied from `plugin-examples/timeline-items/client/transform-pi-tasks.ts`.
- The item Claude's provider produces for the `Workflow` tool: `name: "Workflow"`, `detail: { type: "unknown", input, output }`, where a successful result's `output` is `{ output: "<tool result text>" }` (`ClaudeAgentSession.buildToolOutput`, `packages/server/src/server/agent/providers/claude/agent.ts:5859-5900`, which keeps non-JSON text as a string) and a failed or pending one has `output: null`. The replay source finds the run id with `/(?:^|\n)Run ID:\s*(wf_[A-Za-z0-9-]+)/u` (`packages/server/src/server/agent/providers/claude/subagents/workflow-replay-source.ts:192`); this transformer uses a stricter form of the same line.

Produces:

- `plugins/claude-workflows/client/transform.ts`: `export const transformWorkflowCall: ToolCallTransformer`. It returns one plugin item `{ type: "plugin", kind: "claude-workflow", version: 1, data: { runId, summary } }` for a `Workflow` call whose `detail` is `unknown` with an `output.output` string holding a line `Run ID: wf_<8 hex>-<3 hex>`; `summary` is the trimmed rest of the first `Summary:` line, or `null` when it is missing or blank. Every other item gives `undefined`. The item takes the default id `${sourceId}/0`.

- [ ] **Step 1: Write the failing transformer test**

Create `plugins/claude-workflows/client/transform.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { WORKFLOW_ITEM_KIND, WORKFLOW_ITEM_VERSION } from "../shared/run.js";
import { transformWorkflowCall } from "./transform.js";

type TransformInput = Parameters<typeof transformWorkflowCall>[0];
type ToolCallItem = TransformInput["item"];
type ToolDetail = ToolCallItem["detail"];

const RUN_ID = "wf_0a1b2c3d-4e5";
const SESSION_DIR = "/home/user/.claude/projects/-tmp-x/0f8c2d4e-1a2b-4c3d-8e9f-0123456789ab";

/** A tool result shaped like Claude Code's launch result, with invented values. */
const RESULT = [
  "Workflow launched in background.",
  "Task ID: w0a1b2c3d",
  `Run ID: ${RUN_ID}`,
  "Summary: Read three files and report",
  `Transcript dir: ${SESSION_DIR}/subagents/workflows/${RUN_ID}`,
  `Script file: ${SESSION_DIR}/workflows/scripts/read-files-${RUN_ID}.js`,
  "",
  "You will be notified when it completes.",
].join("\n");

function unknownDetail(output: unknown): ToolDetail {
  return { type: "unknown", input: null, output };
}

function completed(name: string, detail: ToolDetail): ToolCallItem {
  return { type: "tool_call", callId: "toolu_01", name, detail, status: "completed", error: null };
}

function launched(text: string): ToolCallItem {
  return completed("Workflow", unknownDetail({ output: text }));
}

function transform(item: ToolCallItem) {
  return transformWorkflowCall({ item, phase: "complete" });
}

function workflowCard(summary: string | null) {
  const data = { runId: RUN_ID, summary };
  return {
    items: [{ type: "plugin", kind: WORKFLOW_ITEM_KIND, version: WORKFLOW_ITEM_VERSION, data }],
  };
}

describe("transformWorkflowCall", () => {
  it("swaps a launched Workflow card for the workflow card", () => {
    expect(transform(launched(RESULT))).toEqual(workflowCard("Read three files and report"));
  });

  it("keeps the summary null when the result has none or a blank one", () => {
    const withoutSummary = RESULT.replace(/\nSummary:[^\n]*/u, "");
    const blankSummary = RESULT.replace(/\nSummary:[^\n]*/u, "\nSummary:   ");

    expect(transform(launched(withoutSummary))).toEqual(workflowCard(null));
    expect(transform(launched(blankSummary))).toEqual(workflowCard(null));
  });

  it("keeps the plain card while the launch is pending, after it failed, or without a run id", () => {
    const pending: ToolCallItem = {
      type: "tool_call",
      callId: "toolu_01",
      name: "Workflow",
      detail: unknownDetail(null),
      status: "running",
      error: null,
    };
    const failed: ToolCallItem = {
      type: "tool_call",
      callId: "toolu_01",
      name: "Workflow",
      detail: unknownDetail(null),
      status: "failed",
      error: { message: "Tool call failed" },
    };

    expect(transform(pending)).toBeUndefined();
    expect(transform(failed)).toBeUndefined();
    expect(transform(launched("No run was started"))).toBeUndefined();
  });

  it("leaves other tools alone", () => {
    for (const name of ["Bash", "Task", "workflow", "WorkflowStatus"]) {
      expect(transform(completed(name, unknownDetail({ output: RESULT })))).toBeUndefined();
    }
  });

  it("leaves output shapes other than Claude's alone", () => {
    expect(transform(completed("Workflow", unknownDetail(RESULT)))).toBeUndefined();
    expect(transform(completed("Workflow", unknownDetail({ result: RESULT })))).toBeUndefined();
    expect(transform(completed("Workflow", { type: "plan", text: RESULT }))).toBeUndefined();
  });

  it("takes the run id only from its own line and only in Claude Code's format", () => {
    const midLine = RESULT.replace("Run ID:", "Previous Run ID:");
    const tooLong = RESULT.replace(RUN_ID, `${RUN_ID}f`);
    const upperCase = RESULT.replace(RUN_ID, RUN_ID.toUpperCase());
    const tabbed = RESULT.replace("Run ID: ", "Run ID:\t");

    expect(transform(launched(midLine))).toBeUndefined();
    expect(transform(launched(tooLong))).toBeUndefined();
    expect(transform(launched(upperCase))).toBeUndefined();
    expect(transform(launched(tabbed))).toEqual(workflowCard("Read three files and report"));
    expect(transform(launched(`Run ID: ${RUN_ID}`))).toEqual(workflowCard(null));
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/client/transform.test.ts --bail=1`

Expected: FAIL. The output names `Cannot find module` and `transform.js`, and ends with `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the transformer**

Create `plugins/claude-workflows/client/transform.ts`:

```ts
import type { PluginTimelineTransformerContribution } from "@getpaseo/plugin/client";
import { z } from "zod";
import { WORKFLOW_ITEM_KIND, WORKFLOW_ITEM_VERSION, type WorkflowItem } from "../shared/run.js";

type ToolCallTransformer = PluginTimelineTransformerContribution<"tool_call">["transform"];

/** Claude's provider keeps a tool result that is not JSON as `{ output: "<text>" }`. */
const ClaudeToolOutputSchema = z.object({ output: z.string() });

// The launch result names the run on a line of its own, as the replay source reads it
// (packages/server/src/server/agent/providers/claude/subagents/workflow-replay-source.ts), but
// only in Claude Code's run id format, so the card never asks the daemon for anything else.
const RUN_ID_LINE = /(?:^|\n)Run ID:[^\S\n]*(wf_[0-9a-f]{8}-[0-9a-f]{3})(?![0-9A-Za-z-])/u;
const SUMMARY_LINE = /(?:^|\n)Summary:[^\S\n]*([^\n]*)/u;

/**
 * Swaps the card of Claude Code's `Workflow` tool for the workflow card once the tool result
 * names a run. Without a run id (the launch is pending or failed) the plain card stays.
 */
export const transformWorkflowCall: ToolCallTransformer = ({ item }) => {
  if (item.name !== "Workflow" || item.detail.type !== "unknown") return undefined;
  const output = ClaudeToolOutputSchema.safeParse(item.detail.output);
  if (!output.success) return undefined;
  const text = output.data.output;
  const runId = RUN_ID_LINE.exec(text)?.[1];
  if (runId === undefined) return undefined;
  const data = { runId, summary: summaryOf(text) } satisfies WorkflowItem;
  return {
    items: [{ type: "plugin", kind: WORKFLOW_ITEM_KIND, version: WORKFLOW_ITEM_VERSION, data }],
  };
};

/** The text of the result's `Summary:` line, or null when it has none or a blank one. */
function summaryOf(text: string): string | null {
  const summary = SUMMARY_LINE.exec(text)?.[1]?.trim() ?? "";
  return summary === "" ? null : summary;
}
```

`satisfies` keeps `data` an object literal type, which fits the item's `JsonValue` data, while still checking it against `WorkflowItem`.

- [ ] **Step 4: Run the transformer test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/client/transform.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  6 passed (6)`.

- [ ] **Step 5: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-workflows/client/transform.ts plugins/claude-workflows/client/transform.test.ts && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- plugins/claude-workflows/client/transform.ts plugins/claude-workflows/client/transform.test.ts
```

Expected: oxfmt exits 0, then `Found 0 warnings and 0 errors.`

- [ ] **Step 6: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics.

- [ ] **Step 7: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add plugins/claude-workflows/client/transform.ts plugins/claude-workflows/client/transform.test.ts
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): swap the Workflow tool card for a workflow item" -- plugins/claude-workflows/client/transform.ts plugins/claude-workflows/client/transform.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/claude-workflows
```

Expected: the hook passes and git prints `2 files changed`; `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` prints the subject and exactly the two paths; `status` prints nothing. If a hook job fails, git creates no commit: report the hook output and stop.

---

### Task 10: Card copy, totals and the poll rule

**Files:**

- Create: `plugins/claude-workflows/client/format.ts`
- Test: `plugins/claude-workflows/client/format.test.ts` (new)

**Interfaces:**

Consumes:

- Task 1: `RunView`, `LoadedRun`, `RunAgent`, `LastTool`, `AgentState`, `UnavailableReason`.
- `formatUptime` in `plugins/shared-mcp/client/format.ts`, copied as `formatDuration` (a built-in cannot import another plugin's files).

Produces (`plugins/claude-workflows/client/format.ts`):

- Constants: `POLL_MS = 3000`; copy `LOADING`, `LOAD_FAILED`, `REFRESH_FAILED`, `UNREADABLE_AGENT`, `NO_AGENTS`; label maps `RUN_STATE_LABELS: Record<RunView["state"], string>`, `AGENT_STATE_LABELS: Record<AgentState, string>`, `UNAVAILABLE_COPY: Record<UnavailableReason, string>` (the words of Decision 13).
- `pollInterval(view: RunView | undefined): number | false`: `POLL_MS` only while the view is Running.
- `loadedRun(view: RunView | undefined): LoadedRun | null`.
- `isCardOpen(run: LoadedRun | null, chosen: boolean | null): boolean`: false without a loaded run, else the user's choice, else open while Running (Decision 15).
- `formatDuration(ms)`, `formatTokens(tokens)`, `formatAgo(at, now)`.
- `describeTotals(run: LoadedRun, now: number): string` (Decision 14) and `describeAgent(agent: RunAgent, now: number): string`.
- `export interface PhaseGroup { phase: string; agents: RunAgent[] }` and `groupByPhase(agents: RunAgent[]): PhaseGroup[]`: phases in the order their first agent started.
- `export interface StatusInput { view: RunView | undefined; failed: boolean; now: number }` and `statusLine(input: StatusInput): string`: "Loading...", "Unable to load the run", a reason's copy, or the totals.
- `refreshNote(view: RunView | undefined, failed: boolean): string | null`: "Refresh failed" when the last fetch failed while an earlier view is still shown, else null (Decision 16). `pollInterval` reads that kept view, so a Running card polls again after the failure.
- `summaryText(summary: string | null, view: RunView | undefined): string | null`: the item's summary, else the record's name.

- [ ] **Step 1: Write the failing format test**

Create `plugins/claude-workflows/client/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { LoadedRun, RunAgent, RunView } from "../shared/run.js";
import {
  AGENT_STATE_LABELS,
  LOAD_FAILED,
  LOADING,
  NO_AGENTS,
  POLL_MS,
  REFRESH_FAILED,
  RUN_STATE_LABELS,
  UNAVAILABLE_COPY,
  UNREADABLE_AGENT,
  describeAgent,
  describeTotals,
  formatAgo,
  formatDuration,
  formatTokens,
  groupByPhase,
  isCardOpen,
  pollInterval,
  refreshNote,
  statusLine,
  summaryText,
} from "./format.js";

const NOW = Date.UTC(2026, 10, 7, 9, 10, 0);

function agent(fields: Partial<RunAgent>): RunAgent {
  return {
    key: "read-a",
    label: "Read a.txt",
    phase: "Read",
    state: "running",
    toolCalls: 0,
    lastTool: null,
    tokens: null,
    firstActivityAt: null,
    lastActivityAt: null,
    ...fields,
  };
}

const DONE = agent({
  key: "read-a",
  state: "done",
  toolCalls: 5,
  tokens: 41_200,
  firstActivityAt: NOW - 130_000,
  lastActivityAt: NOW - 60_000,
});
const FAILED = agent({
  key: "read-b",
  state: "failed",
  toolCalls: 4,
  tokens: 10_900,
  firstActivityAt: NOW - 120_000,
  lastActivityAt: NOW - 90_000,
});
const RUNNING = agent({
  key: "report",
  phase: "Report",
  state: "running",
  toolCalls: 5,
  firstActivityAt: NOW - 100_000,
  lastActivityAt: NOW - 10_000,
});

function run(fields: Partial<LoadedRun>): LoadedRun {
  return {
    state: "running",
    name: null,
    endedAt: null,
    agents: [DONE, FAILED, RUNNING],
    ...fields,
  };
}

const UNAVAILABLE: RunView = { state: "unavailable", reason: "run-not-found" };

describe("card format", () => {
  it("polls only while the run is Running", () => {
    expect(pollInterval(run({}))).toBe(POLL_MS);
    expect(POLL_MS).toBe(3000);
    const finished = [
      run({ state: "completed" }),
      run({ state: "killed" }),
      run({ state: "stopped" }),
    ];
    expect(finished.map((view) => pollInterval(view))).toEqual([false, false, false]);
    expect(pollInterval(UNAVAILABLE)).toBe(false);
    expect(pollInterval(undefined)).toBe(false);
  });

  it("totals a running run up to now", () => {
    expect(describeTotals(run({}), NOW)).toBe(
      "3 agents · 1 done · 1 failed · 14 tool calls · 52.1k tokens · 2m 10s",
    );
  });

  it("ends a finished run's elapsed time at its record, else at its latest activity", () => {
    const completed = run({ state: "completed", endedAt: NOW - 5_000 });
    const stopped = run({ state: "stopped" });

    expect(describeTotals(completed, NOW)).toBe(
      "3 agents · 1 done · 1 failed · 14 tool calls · 52.1k tokens · 2m 5s",
    );
    expect(describeTotals(stopped, NOW)).toBe(
      "3 agents · 1 done · 1 failed · 14 tool calls · 52.1k tokens · 2m 0s",
    );
  });

  it("leaves out tokens and time until an agent reports them", () => {
    const quiet = run({ agents: [agent({ toolCalls: 1 })] });

    expect(describeTotals(quiet, NOW)).toBe("1 agent · 0 done · 0 failed · 1 tool call");
  });

  it("formats durations, token counts and ages", () => {
    const durations = [9_000, 130_000, 3_720_000, 90_000_000];
    expect(durations.map((ms) => formatDuration(ms))).toEqual(["9s", "2m 10s", "1h 2m", "1d 1h"]);
    const tokens = [950, 41_200, 99_960, 152_000, 2_300_000];
    expect(tokens.map((count) => formatTokens(count))).toEqual([
      "950",
      "41.2k",
      "100k",
      "152k",
      "2.3M",
    ]);
    const times = [NOW - 5_000, NOW - 150_000, NOW - 7_500_000, NOW - 190_000_000, NOW + 3_000];
    expect(times.map((at) => formatAgo(at, NOW))).toEqual([
      "5s ago",
      "2m ago",
      "2h ago",
      "2d ago",
      "0s ago",
    ]);
  });

  it("describes an agent row", () => {
    const working = agent({
      toolCalls: 3,
      lastTool: { name: "Read", file: "src/a.ts", running: true },
      tokens: 41_200,
      lastActivityAt: NOW - 120_000,
    });
    const shell = agent({ toolCalls: 1, lastTool: { name: "Bash", file: null, running: false } });

    expect(describeAgent(working, NOW)).toBe(
      "3 tool calls · Read src/a.ts (running) · 41.2k tokens · 2m ago",
    );
    expect(describeAgent(shell, NOW)).toBe("1 tool call · Bash");
    expect(describeAgent(agent({ state: "unreadable" }), NOW)).toBe(UNREADABLE_AGENT);
  });

  it("groups agents by phase in start order", () => {
    const readA = agent({ key: "read-a", phase: "Read" });
    const report = agent({ key: "report", phase: "Report" });
    const readB = agent({ key: "read-b", phase: "Read" });

    expect(groupByPhase([readA, report, readB])).toEqual([
      { phase: "Read", agents: [readA, readB] },
      { phase: "Report", agents: [report] },
    ]);
    expect(groupByPhase([])).toEqual([]);
  });

  it("says what the header knows", () => {
    expect(statusLine({ view: undefined, failed: false, now: NOW })).toBe(LOADING);
    expect(statusLine({ view: undefined, failed: true, now: NOW })).toBe(LOAD_FAILED);
    expect(statusLine({ view: UNAVAILABLE, failed: false, now: NOW })).toBe("Run files not found");
    expect(statusLine({ view: run({}), failed: true, now: NOW })).toBe(
      describeTotals(run({}), NOW),
    );
  });

  it("notes a failed refresh only while an earlier view is kept", () => {
    expect(refreshNote(run({}), true)).toBe(REFRESH_FAILED);
    expect(refreshNote(UNAVAILABLE, true)).toBe(REFRESH_FAILED);
    expect(refreshNote(run({}), false)).toBeNull();
    expect(refreshNote(undefined, true)).toBeNull();
    expect(refreshNote(undefined, false)).toBeNull();
    // The kept view still decides the interval, so the next poll is the retry.
    expect(pollInterval(run({}))).toBe(POLL_MS);
  });

  it("titles the card with the summary, else the run's name", () => {
    const named = run({ name: "read-files" });

    expect(summaryText("Read three files", named)).toBe("Read three files");
    expect(summaryText(null, named)).toBe("read-files");
    expect(summaryText(null, run({}))).toBeNull();
    expect(summaryText(null, UNAVAILABLE)).toBeNull();
    expect(summaryText(null, undefined)).toBeNull();
  });

  it("opens a Running card until the user chooses", () => {
    expect(isCardOpen(run({}), null)).toBe(true);
    expect(isCardOpen(run({ state: "completed" }), null)).toBe(false);
    expect(isCardOpen(run({ state: "completed" }), true)).toBe(true);
    expect(isCardOpen(run({}), false)).toBe(false);
    expect(isCardOpen(null, true)).toBe(false);
  });

  it("follows the copy rules of docs/design.md section 10", () => {
    const copy = [
      LOADING,
      LOAD_FAILED,
      REFRESH_FAILED,
      UNREADABLE_AGENT,
      NO_AGENTS,
      ...Object.values(RUN_STATE_LABELS),
      ...Object.values(AGENT_STATE_LABELS),
      ...Object.values(UNAVAILABLE_COPY),
    ];
    for (const text of copy) {
      expect(text).not.toContain("…");
      expect(text.endsWith(".") && !text.endsWith("...")).toBe(false);
      expect(text.charAt(0)).toBe(text.charAt(0).toUpperCase());
    }
    expect(LOADING).toBe("Loading...");
  });
});
```

- [ ] **Step 2: Run it and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/client/format.test.ts --bail=1`

Expected: FAIL. The output names `Cannot find module` and `format.js`, and ends with `Test Files  1 failed (1)`.

- [ ] **Step 3: Write the format helpers**

Create `plugins/claude-workflows/client/format.ts`:

```ts
import type {
  AgentState,
  LastTool,
  LoadedRun,
  RunAgent,
  RunView,
  UnavailableReason,
} from "../shared/run.js";

/** How often a Running card asks for its run again. */
export const POLL_MS = 3000;

export const LOADING = "Loading...";
export const LOAD_FAILED = "Unable to load the run";
export const REFRESH_FAILED = "Refresh failed";
export const UNREADABLE_AGENT = "Unable to read this agent's file";
export const NO_AGENTS = "No agents have started yet";

export const RUN_STATE_LABELS: Record<RunView["state"], string> = {
  running: "Running",
  completed: "Completed",
  killed: "Killed",
  stopped: "Stopped",
  unavailable: "Unavailable",
};

export const AGENT_STATE_LABELS: Record<AgentState, string> = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  stopped: "Stopped",
  unreadable: "Unreadable",
};

export const UNAVAILABLE_COPY: Record<UnavailableReason, string> = {
  "agent-not-found": "Agent not found",
  "not-claude": "No Claude session for this agent",
  "run-not-found": "Run files not found",
  "run-unreadable": "Unable to read the run files",
};

/** The query's refetch interval: poll only while the last view is Running. */
export function pollInterval(view: RunView | undefined): number | false {
  return view?.state === "running" ? POLL_MS : false;
}

export function loadedRun(view: RunView | undefined): LoadedRun | null {
  if (view === undefined || view.state === "unavailable") return null;
  return view;
}

/**
 * Whether the card shows its agents: the user's last choice, else open while the run is
 * Running. A card without a loaded run has no body.
 */
export function isCardOpen(run: LoadedRun | null, chosen: boolean | null): boolean {
  if (run === null) return false;
  return chosen ?? run.state === "running";
}

// Copied from plugins/shared-mcp/client/format.ts (formatUptime); a built-in cannot import
// another plugin's files.
/** The two largest units of a duration: "45s", "3m 12s", "2h 5m", "3d 4h". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

/** A token count: "950", "41.2k", "152k", "2.3M". */
export function formatTokens(tokens: number): string {
  if (tokens < 1000) return String(tokens);
  // The bounds sit where rounding would print "100.0k" or "1000k".
  if (tokens < 99_950) return `${(tokens / 1000).toFixed(1)}k`;
  if (tokens < 999_500) return `${Math.round(tokens / 1000)}k`;
  return `${(tokens / 1_000_000).toFixed(1)}M`;
}

/** How long before `now` the time `at` was: "5s ago", "2m ago", "2h ago", "2d ago". */
export function formatAgo(at: number, now: number): string {
  const seconds = Math.max(0, Math.floor((now - at) / 1000));
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function count(value: number, noun: string): string {
  return `${value} ${noun}${value === 1 ? "" : "s"}`;
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function known(values: (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null);
}

/**
 * The header's totals: "3 agents · 1 done · 1 failed · 14 tool calls · 52.1k tokens · 2m 10s".
 * Tokens show once an agent reports usage, and elapsed time once an agent has written.
 */
export function describeTotals(run: LoadedRun, now: number): string {
  const { agents } = run;
  const done = agents.filter((agent) => agent.state === "done").length;
  const failed = agents.filter((agent) => agent.state === "failed").length;
  const toolCalls = sum(agents.map((agent) => agent.toolCalls));
  const parts = [
    count(agents.length, "agent"),
    `${done} done`,
    `${failed} failed`,
    count(toolCalls, "tool call"),
  ];
  const tokens = known(agents.map((agent) => agent.tokens));
  if (tokens.length > 0) parts.push(`${formatTokens(sum(tokens))} tokens`);
  const elapsed = elapsedMs(run, now);
  if (elapsed !== null) parts.push(formatDuration(elapsed));
  return parts.join(" · ");
}

/** From the earliest first activity to now while Running, else to the run's end. */
function elapsedMs(run: LoadedRun, now: number): number | null {
  const starts = known(run.agents.map((agent) => agent.firstActivityAt));
  const end = endTime(run, now);
  if (starts.length === 0 || end === null) return null;
  return end - Math.min(...starts);
}

/** The record's end time, else the latest activity; null when no agent has written. */
function endTime(run: LoadedRun, now: number): number | null {
  if (run.state === "running") return now;
  if (run.endedAt !== null) return run.endedAt;
  const ends = known(run.agents.map((agent) => agent.lastActivityAt));
  return ends.length === 0 ? null : Math.max(...ends);
}

function describeTool(tool: LastTool): string {
  const named = tool.file === null ? tool.name : `${tool.name} ${tool.file}`;
  return tool.running ? `${named} (running)` : named;
}

/** One agent row's details: "3 tool calls · Read src/a.ts (running) · 41.2k tokens · 2m ago". */
export function describeAgent(agent: RunAgent, now: number): string {
  if (agent.state === "unreadable") return UNREADABLE_AGENT;
  const parts = [count(agent.toolCalls, "tool call")];
  if (agent.lastTool !== null) parts.push(describeTool(agent.lastTool));
  if (agent.tokens !== null) parts.push(`${formatTokens(agent.tokens)} tokens`);
  if (agent.lastActivityAt !== null) parts.push(formatAgo(agent.lastActivityAt, now));
  return parts.join(" · ");
}

export interface PhaseGroup {
  phase: string;
  agents: RunAgent[];
}

/** The agents grouped by phase, phases in the order their first agent started. */
export function groupByPhase(agents: RunAgent[]): PhaseGroup[] {
  const groups = new Map<string, RunAgent[]>();
  for (const agent of agents) {
    const group = groups.get(agent.phase) ?? [];
    group.push(agent);
    groups.set(agent.phase, group);
  }
  return Array.from(groups, ([phase, members]) => ({ phase, agents: members }));
}

export interface StatusInput {
  view: RunView | undefined;
  /** The last fetch failed. */
  failed: boolean;
  /** When the view was fetched. */
  now: number;
}

/** The header's status line: the load state, the reason a run is unavailable, or its totals. */
export function statusLine(input: StatusInput): string {
  const { view, failed, now } = input;
  if (view === undefined) return failed ? LOAD_FAILED : LOADING;
  if (view.state === "unavailable") return UNAVAILABLE_COPY[view.reason];
  return describeTotals(view, now);
}

/**
 * The note after the status line when the last fetch failed but the card still shows an earlier
 * view. A failed first load has no view to keep and shows `LOAD_FAILED` in the status line instead.
 */
export function refreshNote(view: RunView | undefined, failed: boolean): string | null {
  return failed && view !== undefined ? REFRESH_FAILED : null;
}

/** The card's title: the launch result's summary, else the run record's workflow name. */
export function summaryText(summary: string | null, view: RunView | undefined): string | null {
  return summary ?? loadedRun(view)?.name ?? null;
}
```

- [ ] **Step 4: Run the format test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run plugins/claude-workflows/client/format.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  12 passed (12)`.

- [ ] **Step 5: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-workflows/client/format.ts plugins/claude-workflows/client/format.test.ts && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- plugins/claude-workflows/client/format.ts plugins/claude-workflows/client/format.test.ts
```

Expected: oxfmt exits 0 (it rewraps the long lines in the test), then `Found 0 warnings and 0 errors.`

- [ ] **Step 6: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics.

- [ ] **Step 7: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add plugins/claude-workflows/client/format.ts plugins/claude-workflows/client/format.test.ts
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): format the workflow card's copy and totals" -- plugins/claude-workflows/client/format.ts plugins/claude-workflows/client/format.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/claude-workflows
```

Expected: the hook passes and git prints `2 files changed`; `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` prints the subject and exactly the two paths; `status` prints nothing. If a hook job fails, git creates no commit: report the hook output and stop.

---

### Task 11: The card and the client entry

**Files:**

- Create: `plugins/claude-workflows/client/styles.ts`
- Create: `plugins/claude-workflows/client/card.tsx`
- Create: `plugins/claude-workflows/index.client.tsx`
- Test: `packages/server/src/server/plugins/builtin/index.test.ts` (existing, unchanged; it now also compiles the client entry)

The card has no unit test: the repo has no component test setup for plugins (`docs/testing.md` rules out JSDOM), so its logic lives in Task 10's tested helpers and Task 13 checks it in the browser.

**Interfaces:**

Consumes:

- Task 1: `runRpc`, `WorkflowItemSchema`, `WORKFLOW_ITEM_KIND`, `WORKFLOW_ITEM_VERSION`, `WorkflowItem`, `LoadedRun`, `RunAgent`, `RunView`.
- Task 9: `transformWorkflowCall`.
- Task 10: `pollInterval`, `loadedRun`, `isCardOpen`, `statusLine`, `refreshNote`, `summaryText`, `describeAgent`, `groupByPhase`, `PhaseGroup`, `RUN_STATE_LABELS`, `AGENT_STATE_LABELS`, `NO_AGENTS`.
- `PluginClientContext.addTimelineTransformer(contribution)` and `addTimelineRenderer({ kind, version, schema, Component })`, each returning a `PluginCleanup` (`packages/plugin/src/client/contracts.ts:205-210`); `PluginTimelineItemProps<Data>` gives `agentId`, `item.data` (already parsed by `schema`), `theme`, `host`, `layout` and `timestamp` (`contracts.ts:292-301`).
- `useRpc(contract)` from `@getpaseo/plugin/client` returns `(input) => Promise<output>` and parses the output with the contract's schema (`packages/plugin/src/client/rpc-context.tsx:53-64`). The app renders each plugin timeline item inside the plugin's own `QueryClientProvider` and `PluginRpcProvider` (`packages/app/src/plugins/installation-provider.tsx:19-25`) and a `SurfaceErrorBoundary` (`packages/app/src/plugins/timeline/view.tsx:83-89`), so `useQuery` and `useRpc` work in the card.
- `Icon` from `@getpaseo/plugin/client/ui` renders a Lucide icon by `name` with `size` and `color` (`packages/plugin/src/client/ui.ts:58-62`).
- `PluginTheme.colors`: `surface0`, `surface1`, `surface2`, `border`, `foreground`, `foregroundMuted`, `accent`, `accentForeground`, `statusSuccess`, `statusWarning`, `statusDanger` (`packages/plugin/src/contracts.ts:6-20`).

Produces:

- `plugins/claude-workflows/client/styles.ts`: `export function useCardStyles(theme: PluginTheme)` and `export type CardStyles = ReturnType<typeof useCardStyles>`.
- `plugins/claude-workflows/client/card.tsx`: `export function WorkflowCard(props: PluginTimelineItemProps<WorkflowItem>)`. Its root `View` has `testID="claude-workflow-card"`, which renders as `data-testid` on web; Task 13 reads cards by it. React Query key `["claude-workflows", "run", agentId, runId]`.
- `plugins/claude-workflows/index.client.tsx`: `export default function contribute(client: PluginClientContext): () => void`, registering the transformer `workflow-card` and the renderer for kind `claude-workflow` version 1, and removing both on cleanup.

- [ ] **Step 1: Write the card styles**

Create `plugins/claude-workflows/client/styles.ts`:

```ts
import { useMemo } from "react";
import { Platform } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

/** The workflow card's styles, derived from the host theme. */
export function useCardStyles(theme: PluginTheme) {
  return useMemo(() => {
    const { colors } = theme;
    return {
      card: { borderWidth: 1, borderColor: colors.border, borderRadius: 8, padding: 12, gap: 10 },
      header: { gap: 4 },
      titleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      title: { color: colors.foreground, fontSize: 14, fontWeight: "500" as const },
      runId: { color: colors.foregroundMuted, fontFamily: MONOSPACE, fontSize: 12 },
      // StatusBadge's pill (packages/app/src/components/ui/status-badge.tsx) on surface2, since
      // PluginTheme has no surface3 and no tints.
      chip: {
        marginLeft: "auto" as const,
        borderRadius: 9999,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface2,
        paddingHorizontal: 8,
        paddingVertical: 3,
      },
      chipText: {
        running: { color: colors.accent, fontSize: 12 },
        completed: { color: colors.statusSuccess, fontSize: 12 },
        killed: { color: colors.statusWarning, fontSize: 12 },
        stopped: { color: colors.statusDanger, fontSize: 12 },
        unavailable: { color: colors.foregroundMuted, fontSize: 12 },
      },
      summary: { color: colors.foreground, fontSize: 13 },
      meta: { color: colors.foregroundMuted, fontSize: 12 },
      error: { color: colors.statusDanger, fontSize: 12 },
      body: { gap: 10 },
      phase: { gap: 6 },
      phaseTitle: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "500" as const },
      agent: { gap: 2 },
      agentTitleRow: { flexDirection: "row" as const, alignItems: "center" as const, gap: 6 },
      agentState: {
        running: { color: colors.accent, fontSize: 12 },
        done: { color: colors.statusSuccess, fontSize: 12 },
        failed: { color: colors.statusDanger, fontSize: 12 },
        stopped: { color: colors.statusWarning, fontSize: 12 },
        unreadable: { color: colors.foregroundMuted, fontSize: 12 },
      },
      agentLabel: { flexShrink: 1, color: colors.foreground, fontSize: 13 },
    };
  }, [theme]);
}

export type CardStyles = ReturnType<typeof useCardStyles>;
```

- [ ] **Step 2: Write the card**

Create `plugins/claude-workflows/client/card.tsx`:

```tsx
import { useQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRpc, type PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import {
  runRpc,
  type LoadedRun,
  type RunAgent,
  type RunView,
  type WorkflowItem,
} from "../shared/run.js";
import {
  AGENT_STATE_LABELS,
  NO_AGENTS,
  RUN_STATE_LABELS,
  describeAgent,
  groupByPhase,
  isCardOpen,
  loadedRun,
  pollInterval,
  refreshNote,
  statusLine,
  summaryText,
  type PhaseGroup,
} from "./format.js";
import { useCardStyles, type CardStyles } from "./styles.js";

/** The live card that takes the place of a `Workflow` tool card. */
export function WorkflowCard({ agentId, item, theme }: PluginTimelineItemProps<WorkflowItem>) {
  const styles = useCardStyles(theme);
  const { runId, summary } = item.data;
  const fetchRun = useRpc(runRpc);
  // The interval belongs to the query observer, so polling stops when the card unmounts or the
  // run leaves Running. The installation's QueryClient would retry a failed fetch three times
  // with backoff; the next poll is the retry instead.
  const run = useQuery({
    queryKey: ["claude-workflows", "run", agentId, runId],
    queryFn: () => fetchRun({ agentId, runId }),
    refetchInterval: (query) => pollInterval(query.state.data),
    retry: false,
  });
  const view = run.data;
  const loaded = loadedRun(view);
  // Null until the user taps: the card then follows the run, open only while it is Running.
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = isCardOpen(loaded, chosen);
  const toggle = useCallback(() => setChosen(!open), [open]);
  const expanded = useMemo(() => ({ expanded: open }), [open]);
  // Ages and elapsed time move when a poll lands, not on a timer of their own.
  const now = run.dataUpdatedAt;
  const status = statusLine({ view, failed: run.isError, now });
  const refreshFailed = refreshNote(view, run.isError);
  const title = summaryText(summary, view);
  return (
    <View style={styles.card} testID="claude-workflow-card">
      <Pressable
        accessibilityRole="button"
        accessibilityState={expanded}
        disabled={loaded === null}
        onPress={toggle}
        style={styles.header}
      >
        <View style={styles.titleRow}>
          {loaded === null ? null : (
            <Icon
              name={open ? "ChevronDown" : "ChevronRight"}
              size={14}
              color={theme.colors.foregroundMuted}
            />
          )}
          <Text style={styles.title}>Workflow</Text>
          <Text style={styles.runId}>{runId}</Text>
          {view === undefined ? null : <StateChip state={view.state} styles={styles} />}
        </View>
        {title === null ? null : (
          <Text numberOfLines={2} style={styles.summary}>
            {title}
          </Text>
        )}
        <Text style={styles.meta}>
          {status}
          {refreshFailed === null ? null : (
            <Text style={styles.error}>{` · ${refreshFailed}`}</Text>
          )}
        </Text>
      </Pressable>
      {open && loaded !== null ? <RunBody run={loaded} now={now} styles={styles} /> : null}
    </View>
  );
}

interface StateChipProps {
  state: RunView["state"];
  styles: CardStyles;
}

function StateChip({ state, styles }: StateChipProps) {
  return (
    <View style={styles.chip}>
      <Text style={styles.chipText[state]}>{RUN_STATE_LABELS[state]}</Text>
    </View>
  );
}

interface RunBodyProps {
  run: LoadedRun;
  now: number;
  styles: CardStyles;
}

function RunBody({ run, now, styles }: RunBodyProps) {
  const groups = useMemo(() => groupByPhase(run.agents), [run.agents]);
  if (groups.length === 0) return <Text style={styles.meta}>{NO_AGENTS}</Text>;
  return (
    <View style={styles.body}>
      {groups.map((group) => (
        <PhaseSection key={group.phase} group={group} now={now} styles={styles} />
      ))}
    </View>
  );
}

interface PhaseSectionProps {
  group: PhaseGroup;
  now: number;
  styles: CardStyles;
}

function PhaseSection({ group, now, styles }: PhaseSectionProps) {
  return (
    <View style={styles.phase}>
      {group.phase === "" ? null : <Text style={styles.phaseTitle}>{group.phase}</Text>}
      {group.agents.map((agent) => (
        <AgentRow key={agent.key} agent={agent} now={now} styles={styles} />
      ))}
    </View>
  );
}

interface AgentRowProps {
  agent: RunAgent;
  now: number;
  styles: CardStyles;
}

function AgentRow({ agent, now, styles }: AgentRowProps) {
  const metaStyle = agent.state === "unreadable" ? styles.error : styles.meta;
  return (
    <View style={styles.agent}>
      <View style={styles.agentTitleRow}>
        <Text style={styles.agentState[agent.state]}>{AGENT_STATE_LABELS[agent.state]}</Text>
        <Text numberOfLines={1} style={styles.agentLabel}>
          {agent.label}
        </Text>
      </View>
      <Text style={metaStyle}>{describeAgent(agent, now)}</Text>
    </View>
  );
}
```

Notes for the implementer:

- Every style prop is a memoized object or a property of one, never an array or a literal: `react-perf/jsx-no-new-array-as-prop` and `jsx-no-new-object-as-prop` are errors under `plugins/` (only `packages/app` turns the array rule off). The error style of an unreadable row is chosen with a conditional, not merged.
- `accessibilityState` takes a memoized object for the same reason.
- The plugin SDK has no disclosure hold (`docs/agent-stream-disclosure.md` covers app rows only), so the timeline does not pin the header when the card opens or closes. That is accepted for this card.

- [ ] **Step 3: Write the client entry**

Create `plugins/claude-workflows/index.client.tsx`:

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { WORKFLOW_ITEM_KIND, WORKFLOW_ITEM_VERSION, WorkflowItemSchema } from "./shared/run.js";
import { WorkflowCard } from "./client/card.js";
import { transformWorkflowCall } from "./client/transform.js";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addTimelineTransformer<"tool_call">({
      id: "workflow-card",
      query: { itemType: "tool_call" },
      transform: transformWorkflowCall,
    }),
    client.addTimelineRenderer({
      kind: WORKFLOW_ITEM_KIND,
      version: WORKFLOW_ITEM_VERSION,
      schema: WorkflowItemSchema,
      Component: WorkflowCard,
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
```

- [ ] **Step 4: Run the registry test and confirm both entries compile**

Run: `cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1`

Expected: PASS, 1 test. The client bundle may import only `@getpaseo/plugin`, `@getpaseo/plugin/client`, `@getpaseo/plugin/client/ui`, `@getpaseo/plugin/client/react-native`, `@tanstack/react-query`, `react`, `react/jsx-runtime`, `react-native` and `zod`; anything else fails here.

- [ ] **Step 5: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-workflows/client/styles.ts plugins/claude-workflows/client/card.tsx plugins/claude-workflows/index.client.tsx && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- plugins/claude-workflows/client/styles.ts plugins/claude-workflows/client/card.tsx plugins/claude-workflows/index.client.tsx
```

Expected: oxfmt exits 0, then `Found 0 warnings and 0 errors.` A `react-perf` or `react-hooks/exhaustive-deps` finding means a prop or a hook dependency changed shape: fix it in the card, never with a disable comment.

- [ ] **Step 6: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics. This is the check that `WorkflowCard` fits the renderer's `Component` type, that `styles.chipText[state]` and `styles.agentState[agent.state]` cover every state, and that the query's data is `RunView`.

- [ ] **Step 7: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add plugins/claude-workflows/client/styles.ts plugins/claude-workflows/client/card.tsx plugins/claude-workflows/index.client.tsx
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): render the live Claude workflow card" -- plugins/claude-workflows/client/styles.ts plugins/claude-workflows/client/card.tsx plugins/claude-workflows/index.client.tsx
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/claude-workflows
```

Expected: the hook passes and git prints `3 files changed`; `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` prints the subject and exactly the three paths; `status` prints nothing. If a hook job fails, git creates no commit: report the hook output and stop.

---

### Task 12: Keep plugin rows in view in folded turns

The user chose this app change on 2026-11-07 (Decision 22): in the default Collapse turns display, a finished turn no longer folds plugin rows, so a Running card stays mounted and keeps polling.

**Files:**

- Modify: `packages/app/src/agent-stream/turn-collapse/model.ts` (`staysVisibleWhenCollapsed`)
- Test: `packages/app/src/agent-stream/turn-collapse/model.test.ts` (existing; one case after the compaction case)
- Modify: `docs/plugins.md` (section "Contribute timeline items": one sentence at its end)

**Interfaces:**

Consumes (read from source, not memory):

- `staysVisibleWhenCollapsed(item)` (`packages/app/src/agent-stream/turn-collapse/model.ts:99-101`): true for turn triggers and compaction rows. When `collapseTurns` folds a turn, it skips those rows while it records the turn's other rows in `hostIdByFoldedMessageId` and in `hostIdByHiddenRowId` (folded) or `nestedItemIds` (opened), and a folded turn's output keeps only those rows before its reply (`:153-161`).
- `PluginTimelineStreamItem` (`packages/app/src/types/stream.ts:810-823`): `kind: "plugin"`, `id`, `timestamp`, `pluginId`, `pluginItemId`, `itemKind`, `version` and `data`. A transformed row reaches the fold as one, with its source row's `turnId` (`packages/app/src/plugins/timeline/projection.ts:104-119`), since `packages/app/src/agent-stream/presentation.ts:165-196` projects plugin items before `collapse` runs.
- The test helpers `at`, `user`, `reply`, `shell`, `collapse` and `ids` (`model.test.ts:5-49`), and the compaction case (`:91-124`), whose end anchors the new case.

Produces: no new exports. `collapseTurns` keeps every plugin row of a folded turn in its output, between the turn's host and its reply, and never records one in `hostIdByHiddenRowId`, `hostIdByFoldedMessageId` or `nestedItemIds`; in an opened turn a plugin row renders outside the indent rail, as a compaction row does. Task 13 checks a card in a folded turn by hand, and Task 14's paragraph leaves the fold out, since this task's sentence covers it.

- [ ] **Step 1: Check the anchors**

```bash
cd /workspace/utils/paseo && test "$(git branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
sed -n '/^function staysVisibleWhenCollapsed/,/^}/p' packages/app/src/agent-stream/turn-collapse/model.ts
grep -c '^  it(' packages/app/src/agent-stream/turn-collapse/model.test.ts
grep -c 'paseoActions: { "Created agent": 1 },' packages/app/src/agent-stream/turn-collapse/model.test.ts
grep -c '^`server_info.features.pluginTimelineItems`.$' docs/plugins.md
grep -A2 '^`server_info.features.pluginTimelineItems`.$' docs/plugins.md
```

Expected, in order: the three lines

```ts
function staysVisibleWhenCollapsed(item: StreamItem): boolean {
  return isTurnTrigger(item) || item.kind === "compaction";
}
```

then `13`, `1` and `1`, then `` `server_info.features.pluginTimelineItems`. ``, a blank line and `## Contribute client slash commands`. A different function body or a count of 0 for an anchor means another change reached the fold, its test or that section: stop and report it, and do not pick other anchors. A case count other than 13 only moves Step 5's count to that number plus one.

- [ ] **Step 2: Write the failing test**

In `packages/app/src/agent-stream/turn-collapse/model.test.ts`, replace the end of the compaction case

```ts
      paseoActions: { "Created agent": 1 },
    });
  });
```

with

```ts
      paseoActions: { "Created agent": 1 },
    });
  });

  it("keeps plugin rows visible when work is folded", () => {
    const card: StreamItem = {
      kind: "plugin",
      id: "card",
      timestamp: at,
      pluginId: "claude-workflows",
      pluginItemId: "card",
      itemKind: "claude-workflow",
      version: 1,
      data: { runId: "wf_0a1b2c3d-4e5", summary: null },
    };
    const result = collapse([user("u1"), shell("c1"), card, shell("c2"), reply("done")]);
    expect(ids(result.tail)).toEqual(["u1", "card", "done"]);
    expect(result.hostIdByHiddenRowId.get("c1")).toBe("u1");
    expect(result.hostIdByHiddenRowId.has("card")).toBe(false);
  });
```

The case sits beside the compaction case, the other kind of row a folded turn keeps. The two shell calls are the turn's work, so the turn folds; the card is no work (`model.ts:140`).

- [ ] **Step 3: Run it and confirm it fails**

Run: `cd /workspace/utils/paseo/packages/app && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run src/agent-stream/turn-collapse/model.test.ts --bail=1`

Expected: FAIL. The output names `keeps plugin rows visible when work is folded`, its diff lists `"card"` on the `- Expected` side only, since the fold hid the card, and it ends with `Test Files  1 failed (1)`.

- [ ] **Step 4: Keep plugin rows out of the fold**

In `packages/app/src/agent-stream/turn-collapse/model.ts`, replace

```ts
return isTurnTrigger(item) || item.kind === "compaction";
```

with

```ts
return isTurnTrigger(item) || item.kind === "compaction" || item.kind === "plugin";
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd /workspace/utils/paseo/packages/app && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npx vitest run src/agent-stream/turn-collapse/model.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  14 passed (14)`.

- [ ] **Step 6: Add the docs sentence**

```bash
cd /workspace/utils/paseo && test "$(git branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";

const path = "/workspace/utils/paseo/docs/plugins.md";
const text = readFileSync(path, "utf8");
const before = "`server_info.features.pluginTimelineItems`.\n\n";
const after = "## Contribute client slash commands\n";
if (text.split(before + after).length !== 2) throw new Error("anchor not found exactly once");
if (text.includes("keeps every plugin row in view")) throw new Error("sentence already present");
const sentence = [
  "In the **Collapse turns** chat display, the app's default, a finished turn folds its work into one",
  "summary line but keeps every plugin row in view, rows that replace a tool call or reasoning",
  "included, so their components stay mounted.",
].join("\n");
writeFileSync(path, text.replace(before + after, `${before}${sentence}\n\n${after}`));
console.log("sentence inserted");
EOF
git diff --stat -- docs/plugins.md
```

Expected: `sentence inserted`, then `1 file changed, 4 insertions(+)`: the three lines and one blank line, at the end of "Contribute timeline items". `anchor not found exactly once` means a later edit changed the end of that section: stop and report it, and do not pick another anchor.

- [ ] **Step 7: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- packages/app/src/agent-stream/turn-collapse/model.ts packages/app/src/agent-stream/turn-collapse/model.test.ts docs/plugins.md && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run lint -- packages/app/src/agent-stream/turn-collapse/model.ts packages/app/src/agent-stream/turn-collapse/model.test.ts && git diff --stat -- packages/app/src/agent-stream/turn-collapse docs/plugins.md
```

Expected: oxfmt exits 0, then `Found 0 warnings and 0 errors.`, then `3 files changed, 22 insertions(+), 1 deletion(-)`. A different count means the formatter rewrapped a line: keep its result.

- [ ] **Step 8: Typecheck the app**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run typecheck --workspace=@getpaseo/app -- --singleThreaded
```

Expected: exit 0 with no diagnostics. The app's `tsconfig.json` includes its tests, so this also checks that the test's `card` is a `StreamItem`.

- [ ] **Step 9: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add packages/app/src/agent-stream/turn-collapse/model.ts packages/app/src/agent-stream/turn-collapse/model.test.ts docs/plugins.md
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): keep plugin rows in view in folded turns" -- packages/app/src/agent-stream/turn-collapse/model.ts packages/app/src/agent-stream/turn-collapse/model.test.ts docs/plugins.md
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- packages/app/src/agent-stream/turn-collapse docs/plugins.md
```

Expected: the hook passes and git prints `3 files changed, 22 insertions(+), 1 deletion(-)`; `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` prints the subject and exactly the three paths; `status` prints nothing. If a hook job fails, git creates no commit: report the hook output and stop. Never retry with `--no-verify`.

---

### Task 13: Manual test on the dev daemon

**Files:**

- Scratch (outside the repo, not committed): `/tmp/claude-workflows-test.env`, `/tmp/claude-workflows-rpc.mts`, `/tmp/claude-workflows-dev-password` (mode 0600, removed in Step 22 or by the abort path), `/tmp/claude-workflows-build.out`, `/tmp/claude-workflows-dist.out`, `/tmp/claude-workflows-dev-daemon.pid`, `/tmp/claude-workflows-dev-daemon.out`, `/tmp/claude-workflows-dev-app.pid`, `/tmp/claude-workflows-dev-app.out`, `/tmp/claude-workflows-agent/` (the agent's cwd: `a.txt`, `b.txt`, `c.txt`), `/tmp/claude-workflows-project.id`, `/tmp/claude-workflows-workspace.id`, `/tmp/claude-workflows-model`, `/tmp/claude-workflows-agent.json`, `/tmp/claude-workflows-agent.id`, `/tmp/claude-workflows-w1.txt`, `/tmp/claude-workflows-w2.txt`, `/tmp/claude-workflows-w3.txt`, `/tmp/claude-workflows-send.json`, `/tmp/claude-workflows-runs`, `/tmp/claude-workflows-plain.json`, `/tmp/claude-workflows-provider.json`

**Interfaces:**

Consumes:

- Tasks 1 to 11: the built-in `claude-workflows`, its RPC `claude-workflows.run.request` (`{ agentId, runId }` to `RunView`), `RunViewSchema`, the timeline item kind `claude-workflow`, and the card's `testID="claude-workflow-card"` (rendered as `data-testid` on web).
- Task 12: a folded turn keeps its plugin rows in view, so a card in a folded turn stays mounted and keeps polling.
- `DaemonClient.invokePluginRpc(pluginId, method, input): Promise<unknown>` (`packages/client/src/daemon-client.ts:6369`) and `connectToDaemon({ target: { kind: "endpoint", host } })` (`packages/cli/src/utils/client.ts:214`), which takes the password from `PASEO_PASSWORD` (`client.ts:164-169`) and keeps its client id under `PASEO_HOME`.
- CLI commands, all with `--host` to the dev daemon: `project create <path> --json` (`{ projectId, ... }`), `workspace create --isolation local --path --project --title --no-background --json` (`{ workspaceId, ... }`), `provider models claude --json` (an array of `{ id, ... }`), `run --provider --model --mode --workspace --title --wait-timeout --json <prompt>` (`{ agentId, status, ... }`), `send <id> --prompt-file <path> --json` (waits up to 10 minutes for the turn), `wait <id> --timeout <seconds>`, `logs <id> --json` (`{ agentId, items: AgentTimelineItem[] }`), `agent reload <id>`, `agent archive <id> --force`. `paseo run` reads `PASEO_WORKSPACE_ID` when no `--workspace` is given (`packages/cli/src/commands/agent/run.ts:561`), so every CLI call unsets it.
- The app route `/h/<serverId>/agent/<agentId>` opens the agent's workspace with the agent's tab (`packages/app/src/app/h/[serverId]/agent/[agentId].tsx`), so the card is reached inside a workspace, as the sub-project 1 run learned for plugin surfaces.
- The Claude agent's Workflow tool result: the tool card's `detail.output.output` text with a `Run ID:` line (Task 9).

Produces: the result of each manual check (Steps 6 to 21: passed, failed or not reached) and the findings recorded on the way, for the report and for Task 14. No code, no docs and no new exports.

Ground rules for every step of this task:

- Never signal the daemon on 6767 and never write under `~/.paseo`. The test reads only `~/.paseo/config.json` (copied in Step 4) and the local speech models directory that `scripts/dev-daemon.sh` also hands its dev daemon. Every pid this task signals comes from `$DEV_HOME/paseo.pid` or a `/tmp/claude-workflows-*` file, and only after a check that the pid still belongs to this test. The abort path also signals processes whose environment carries the `PASEO_AGENT_ID` of the agent this task created. Never use `pkill`, `pgrep -a`, `pgrep -f`, `ps -f` or a `ps` format with `args`: the Claude processes carry bearer tokens in their arguments.
- The dev daemon runs with a random password that Step 1 writes to `/tmp/claude-workflows-dev-password` (mode 0600) and binds only the Docker bridge address (172.22.0.3). `start_dev_daemon` refuses any other address. The inherited real `PASEO_PASSWORD` never reaches it, and no step prints a token, `config.json`, `~/.claude/settings.json` or any `~/.claude*/sessions/*.key`. The throwaway password is printed once, in Step 9, because the browser form needs it.
- The agent's Claude Code writes the run's files under the real Claude config dir (`~/.claude/projects/-tmp-claude-workflows-agent/...`). Steps read them only through the plugin RPC and the card. Never print or copy their contents; they hold the prompts.
- Memory: run `memory_guard` where a step says so (before Metro, the agent and each workflow). Below 2500 MB it prints `MEMORY LOW`; then run **Abort and clean up** and report BLOCKED with the figure. Do not free memory by stopping anything this task did not start. One agent runs at a time; this task creates exactly one.
- Restarts kill background work. Step 17's `agent reload` is the one deliberate restart, on this task's own agent. No step changes any agent's model or effort.
- Shell state does not persist between Bash calls, so every shell step starts with `. /tmp/claude-workflows-test.env`. Wait loops run in `bash -c` and either chain their follow-up with `&&` or print a line starting with `TIMEOUT`. A wait that can run longer than 60 s starts with the Bash tool's `run_in_background: true`.
- Heavy commands hold `/tmp/paseo-heavy.lock` and start behind the memory guard of the Global Constraints: the server build and the dist test (Step 3), and Metro with the web bundle (Step 8, which keeps the lock until Step 22, through `$HEAVY_GUARD` from the helpers). Task 14's commit takes the lock after this task.
- A `TIMEOUT` line, a `MEMORY LOW` line, or any output that differs from Expected ends the test. Read the logs the step names, then run **Abort and clean up** before anything else: from Step 8 on, Metro holds the shared heavy lock. Then run Step 23, report the test as failed or BLOCKED with the step and its output, and go on with Task 14, which does not depend on the test.

**Abort and clean up.** Run with `run_in_background: true` (it can take about 90 s):

```bash
. /tmp/claude-workflows-test.env && abort_cleanup
```

Then call `mcp__playwright__browser_tabs` with `{"action": "list"}` and, if a `http://172.22.0.3:8081` tab is open, `{"action": "close", "index": <its index>}`.

Expected: one line per thing it stopped, then `abort cleanup done`, with no `STILL LISTENING` or `TIMEOUT` line. `abort_cleanup` (Step 1) works from any step and skips what was never started: it archives the recorded agent if the dev daemon answers, stops the dev daemon through its supervisor and then whatever is left of the dev session group, sends SIGTERM to any process still carrying the agent's `PASEO_AGENT_ID`, stops the Metro session group (which releases the heavy lock), reports ports 6768 and 8081 if they still listen, and removes the password file. After an abort, a new run starts again from Step 1; Step 4 moves the dev home aside, so its logs stay available.

- [ ] **Before Step 1: ask the user for the live run.** Steps 10 to 17 spend the user's Claude usage, and Steps 8 to 22 hold the shared heavy lock, so stop here, before anything starts, and ask. A subagent asks through its controller. Go on only after an explicit yes. The question names the cost:
  - Claude usage, all on the dev daemon's one test agent (a Sonnet model, `bypassPermissions`): five to seven short turns of the agent (Step 10's reply, three launch turns that each run `pwd` and write a workflow script, Step 15's TaskStop turn, and up to two turns of its own when a run ends), plus nine Sonnet workflow agents, three per run, that each read a one-line file, run `sleep` and reply. Runs 2 and 3 are cut off while their agents sleep.
  - Time and the lock: about 30 to 45 minutes. Metro holds `/tmp/paseo-heavy.lock` from Step 8 to Step 22, so every other session's heavy commands that take the lock wait that long.
  - Memory: Metro takes about 3 GB and the agents about 1 GB; Step 2 waits for 5000 MB.
  - A second question may follow: if the agent turns out not to offer the Workflow tool, Step 11 stops and asks again, since Claude Code may offer dynamic workflows only with the Ultra Code thinking option, which needs a model with an `xhigh` effort level and costs more per turn.

  On no, skip this task: report its checks as not run, by the user's choice, and go on with Task 14, which does not depend on it.

- [ ] **Step 1: Write the scratch helpers and the RPC script.** Run:

```bash
cat > /tmp/claude-workflows-test.env <<'EOF'
# Scratch helpers for the claude-workflows manual test. Nothing here writes under ~/.paseo or
# signals the daemon on 6767.
REPO=/workspace/utils/paseo
DEV_HOME=/workspace/utils/paseo/.dev/paseo-home
AGENT_DIR=/tmp/claude-workflows-agent
# Random password for this run only (Step 1, mode 0600). The real PASEO_PASSWORD never reaches
# the dev daemon.
DEV_PASSWORD=$(cat /tmp/claude-workflows-dev-password 2>/dev/null)
# The Docker bridge address, picked by its prefix: hostname -i also prints the VPN overlay.
DEV_IP=$(hostname -i | tr ' ' '\n' | grep -m1 '^172\.22\.')
export REPO DEV_HOME AGENT_DIR DEV_PASSWORD DEV_IP

mem_mb() { awk '/MemAvailable/ { print int($2 / 1024) }' /proc/meminfo; }
# Fails, naming the figure, when less than 2500 MB is available.
memory_guard() {
  local mb
  mb=$(mem_mb)
  if [ "$mb" -lt 2500 ]; then echo "MEMORY LOW: $mb MB available"; return 1; fi
  echo "memory ok: $mb MB available"
}
# The plan's memory guard for a command started under the heavy lock, as one sh -c script:
# flock /tmp/paseo-heavy.lock sh -c "$HEAVY_GUARD" memory-guard <command>
HEAVY_GUARD='mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"'
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
# Waits up to 10 s for a pid file that a forked child writes.
wait_for_file() {
  timeout 10 bash -c 'until [ -s "$1" ]; do sleep 0.2; done' _ "$1" ||
    { echo "TIMEOUT: $1 is still empty"; return 1; }
}
# Dev daemon in its own session through dev:server:raw, which runs no tsc --watch beside it.
start_dev_daemon() {
  case "$DEV_IP" in
    172.22.*) ;;
    *) echo "refusing to bind '$DEV_IP': not the Docker bridge"; return 1 ;;
  esac
  [ -n "$DEV_PASSWORD" ] || { echo "no dev password in /tmp/claude-workflows-dev-password"; return 1; }
  : > /tmp/claude-workflows-dev-daemon.pid
  (cd "$REPO" && setsid -f sh -c 'echo $$ > /tmp/claude-workflows-dev-daemon.pid
echo "Home:    $1"
echo "Listen:  $2:6768"
exec env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_HOST -u PASEO_WORKSPACE_ID \
  PASEO_PASSWORD="$3" PASEO_HOME="$1" PASEO_LISTEN="$2:6768" PASEO_CORS_ORIGINS="*" \
  PASEO_NODE_INSPECT=--inspect=0 PASEO_LOCAL_MODELS_DIR="$HOME/.paseo/models/local-speech" \
  PASEO_LOG_FORMAT=json PASEO_LOG_LEVEL=info npm run dev:server:raw' sh "$DEV_HOME" "$DEV_IP" \
    "$DEV_PASSWORD" >> /tmp/claude-workflows-dev-daemon.out 2>&1 < /dev/null)
}
# Repo CLI against the dev daemon only: explicit --host, the throwaway password, the dev home.
dev_cli() {
  (cd "$REPO" && env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_HOST -u PASEO_WORKSPACE_ID \
    PASEO_HOME="$DEV_HOME" PASEO_PASSWORD="$DEV_PASSWORD" \
    npm run --silent cli -- "$@" --host "$DEV_IP:6768")
}
# One run through the plugin RPC: a summary line, or the parsed view as JSON with --json.
rpc_view() {
  (cd "$REPO" && env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_HOST -u PASEO_WORKSPACE_ID \
    PASEO_HOME="$DEV_HOME" PASEO_PASSWORD="$DEV_PASSWORD" DEV_IP="$DEV_IP" \
    npx tsx /tmp/claude-workflows-rpc.mts "$@")
}
# Prints "<agentId> <status>" from a run or send --json result file.
run_result() {
  node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const v = Array.isArray(r) ? r[0] : r;
console.log(v.agentId, v.status);' "$1"
}
agent_id() { cut -d' ' -f1 /tmp/claude-workflows-agent.id 2>/dev/null; }
# The run ids that the agent's Workflow tool results name, oldest first.
run_ids() {
  dev_cli logs "$1" --json | node -e 'let text = "";
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  const seen = new Set();
  for (const item of JSON.parse(text).items ?? []) {
    if (item.type !== "tool_call" || item.name !== "Workflow") continue;
    const output = item.detail?.output?.output;
    if (typeof output !== "string") continue;
    const match = /(?:^|\n)Run ID:[^\S\n]*(wf_[0-9a-f]{8}-[0-9a-f]{3})/u.exec(output);
    if (match && !seen.has(match[1])) {
      seen.add(match[1]);
      console.log(match[1]);
    }
  }
});'
}
# The nth recorded run id, from 1.
run_id() { sed -n "${1}p" /tmp/claude-workflows-runs; }
# True when pid $1 runs with this test's dev home. The daemon on 6767 has another PASEO_HOME.
dev_home_process() { grep -qzx "PASEO_HOME=$DEV_HOME" "/proc/$1/environ" 2>/dev/null; }
# True when pid $1 runs in the session that start_dev_daemon recorded.
in_dev_session() {
  local want got
  want=$(cat /tmp/claude-workflows-dev-daemon.pid 2>/dev/null)
  got=$(ps -o pgid= -p "$1" 2>/dev/null | tr -d ' ')
  [ -n "$want" ] && [ "$got" = "$want" ]
}
dev_home_group() {
  local p
  for p in $(pgrep -g "$1"); do dev_home_process "$p" && return 0; done
  return 1
}
# Stops this test's dev daemon through its supervisor, then waits for its session group.
stop_dev_daemon() {
  local sup g
  sup=$(sup_pid 2>/dev/null)
  if [ "${sup:-0}" -gt 1 ] 2>/dev/null && dev_home_process "$sup" && in_dev_session "$sup"; then
    kill -TERM "$sup"
    if timeout 30 bash -c 'while kill -0 "$1" 2>/dev/null; do sleep 1; done' _ "$sup"; then
      echo "dev supervisor $sup exited"
    else
      echo "TIMEOUT: dev supervisor $sup still running after SIGTERM"
    fi
  elif [ "${sup:-0}" -gt 1 ] 2>/dev/null && dev_home_process "$sup"; then
    echo "left dev supervisor $sup alone: this task did not start it"
  fi
  g=$(cat /tmp/claude-workflows-dev-daemon.pid 2>/dev/null)
  if [ "${g:-0}" -gt 1 ] 2>/dev/null && group_alive "$g" && dev_home_group "$g"; then
    if timeout 30 bash -c '. /tmp/claude-workflows-test.env; while group_alive "$1"; do sleep 1; done' _ "$g"; then
      echo "dev session group $g empty"
    else
      kill -TERM -- "-$g" && echo "TIMEOUT: sent SIGTERM to dev session group $g"
    fi
  fi
}
# The abort path in the ground rules. Safe to run from any step and more than once.
abort_cleanup() {
  local id pids g p
  id=$(agent_id)
  if [ -n "$id" ] && [ "$(dev_health)" = 200 ]; then
    dev_cli agent archive "$id" --force > /dev/null 2>&1 && echo "agent $id archived"
  fi
  stop_dev_daemon
  if [ -n "$id" ]; then
    pids=$(grep -lzx "PASEO_AGENT_ID=$id" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3 | xargs)
    if [ -n "$pids" ]; then kill -TERM $pids 2>/dev/null; echo "sent SIGTERM to agent $id: $pids"; fi
  fi
  g=$(cat /tmp/claude-workflows-dev-app.pid 2>/dev/null)
  if [ "${g:-0}" -gt 1 ] 2>/dev/null && group_alive "$g" &&
    tr '\0' ' ' 2>/dev/null < "/proc/$g/cmdline" | grep -q 'scripts/dev-app.sh'; then
    kill -TERM -- "-$g"
    timeout 30 bash -c '. /tmp/claude-workflows-test.env; while group_alive "$1"; do sleep 1; done' _ "$g" ||
      { kill -KILL -- "-$g" 2>/dev/null; sleep 1; }
    if group_alive "$g"; then
      echo "TIMEOUT: Metro group $g still running and holding /tmp/paseo-heavy.lock"
    else
      echo "Metro group $g stopped; /tmp/paseo-heavy.lock released"
    fi
  fi
  for p in 6768 8081; do listening "$p" && echo "STILL LISTENING on $p"; done
  rm -f /tmp/claude-workflows-dev-password && echo "dev password file removed"
  echo "abort cleanup done"
}
EOF
cat > /tmp/claude-workflows-rpc.mts <<'EOF'
// Calls claude-workflows.run.request on the dev daemon and prints the parsed view.
// Run it through rpc_view: npx tsx /tmp/claude-workflows-rpc.mts <agentId> <runId> [--json]
import { connectToDaemon } from "/workspace/utils/paseo/packages/cli/src/utils/client.ts";
import { RunViewSchema } from "/workspace/utils/paseo/plugins/claude-workflows/shared/run.ts";

const [agentId, runId, format] = process.argv.slice(2);
const client = await connectToDaemon({
  target: { kind: "endpoint", host: `${process.env.DEV_IP}:6768` },
});
try {
  const output = await client.invokePluginRpc("claude-workflows", "claude-workflows.run.request", {
    agentId,
    runId,
  });
  const view = RunViewSchema.parse(output);
  if (format === "--json") {
    console.log(JSON.stringify(view));
  } else if (view.state === "unavailable") {
    console.log(`unavailable ${view.reason}`);
  } else {
    const states = view.agents.map((agent) => agent.state).join(",");
    const toolCalls = view.agents.reduce((total, agent) => total + agent.toolCalls, 0);
    const counts = `agents=${view.agents.length} states=${states} toolCalls=${toolCalls}`;
    console.log(`${view.state} ${counts} name=${view.name}`);
  }
} finally {
  await client.close();
}
EOF
: > /tmp/claude-workflows-dev-daemon.out
(umask 077; node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))' > /tmp/claude-workflows-dev-password)
bash -n /tmp/claude-workflows-test.env && . /tmp/claude-workflows-test.env && case "$DEV_IP" in 172.22.*) echo "DEV_IP=$DEV_IP" ;; *) echo "refusing to bind '$DEV_IP': not the Docker bridge"; exit 1 ;; esac && stat -c 'dev password file mode %a, %s bytes' /tmp/claude-workflows-dev-password
```

Expected: `DEV_IP=172.22.0.3`, then `dev password file mode 600, 32 bytes`. On `refusing to bind`, stop: nothing has started yet. The RPC script runs first in Step 7, which checks it. `npm run dev:server` and `npm run dev:app` cannot be used: their `cross-env` pins `PASEO_LISTEN=127.0.0.1:6768`, while `npm run dev:server:raw` and `scripts/dev-app.sh` read `PASEO_LISTEN` from the environment. `scripts/dev-daemon.sh` is skipped because it always runs `dev:server:watch`, whose `tsc --watch` processes run outside the lock; the helper sets the same `PASEO_CORS_ORIGINS`, `PASEO_NODE_INSPECT` and `PASEO_LOCAL_MODELS_DIR` the script sets, and pins `PASEO_LOG_FORMAT=json` for the `daemon.log` greps below.

- [ ] **Step 2: Pre-flight ports and memory.** Run:

```bash
. /tmp/claude-workflows-test.env
for p in 6767 6768 8081; do if listening "$p"; then echo "$p up"; else echo "$p free"; fi; done
echo "available MB: $(mem_mb)"
grep -cxF 'Local runs of `scripts/builtin-plugins-dist.test.mjs` and' "$REPO/docs/plugins.md"
```

Expected:

```
6767 up
6768 free
8081 free
available MB: <at least 5000>
1
```

6767 is the live daemon: leave it alone. If 6768 or 8081 is taken, find the owner; when it is left over from an earlier run of this task, run **Abort and clean up** and repeat this step. Below 5000 MB, wait: Metro takes about 3 GB and the agent with its three workflow agents about 1 GB. The last line confirms the anchor Task 14 inserts before: the first line of the "Local runs of" paragraph, which the earlier sub-projects keep when they reword that paragraph. `0` means a later edit changed that line: record it for Task 14, which stops on it, and go on with the test.

- [ ] **Step 3: Build the server stack and run the dist gate, under the lock.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard npm run build:server > /tmp/claude-workflows-build.out 2>&1; echo "exit=$?"; tail -n 5 /tmp/claude-workflows-build.out
```

Expected: `exit=0`. The dev daemon runs from source, but `npm run cli` and the RPC script import `@getpaseo/server/daemon-control`, which resolves to `packages/server/dist`. `exit=1` with `MEMORY LOW: <n> MB available` as the last line means the guard kept the build from starting, which ends the test like any `MEMORY LOW` line; the same holds for the dist test below, whose guard line lands in `/tmp/claude-workflows-dist.out`.

Then run the CI gate that compiles and starts every built-in from that build, with a throwaway `PASEO_HOME` (the shared-mcp built-in would otherwise scan the live `~/.paseo/shared-mcp`, as `docs/plugins.md` warns):

```bash
cd /workspace/utils/paseo && ls -d packages/server/dist/server/builtin-plugins/claude-workflows && node --input-type=module -e 'const { builtinPlugins } = await import("/workspace/utils/paseo/packages/server/dist/server/server/plugins/builtin/index.js"); console.log("claude-workflows listed in the dist build:", builtinPlugins.includes("claude-workflows"));'
H=$(mktemp -d /tmp/claude-workflows-dist-home.XXXXXX) || exit 1
PASEO_HOME="$H" flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard timeout 300 node --test --test-reporter=tap scripts/builtin-plugins-dist.test.mjs > /tmp/claude-workflows-dist.out 2>&1; echo "dist test exit=$?"
grep -E '^# (pass|fail)' /tmp/claude-workflows-dist.out
rm -rf "$H"
```

Expected:

```
packages/server/dist/server/builtin-plugins/claude-workflows
claude-workflows listed in the dist build: true
dist test exit=0
# pass 1
# fail 0
```

`scripts/builtin-plugins-dist.test.mjs` compiles both entries of every listed built-in from the dist copy and starts each in process. Exit `124` means the run hung at the 300 s `timeout`: a timer or handle the plugin left open. This plugin starts none, so read `/tmp/claude-workflows-dist.out` for which built-in hung before changing anything.

- [ ] **Step 4: Prepare a fresh dev home holding only a copied config.json.** Run:

```bash
. /tmp/claude-workflows-test.env
cd "$REPO"
if [ -f "$DEV_HOME/paseo.pid" ] && kill -0 "$(sup_pid)" 2>/dev/null; then echo "a dev daemon is running on $DEV_HOME; stop it first"; exit 1; fi
if [ -d "$DEV_HOME" ]; then mv "$DEV_HOME" "$REPO/.dev/paseo-home.before-claude-workflows-$(date +%Y%m%d%H%M%S)"; fi
mkdir -p "$DEV_HOME" && chmod 700 "$DEV_HOME"
install -m 600 "$HOME/.paseo/config.json" "$DEV_HOME/config.json"
ls -A "$DEV_HOME"
node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("persisted daemon password:", Boolean(c.daemon?.auth?.password))' "$DEV_HOME/config.json"
```

Expected: `config.json` is the only entry, and `persisted daemon password: false`, so the throwaway env password is the only one the dev daemon checks. A dev daemon already running on the dev home belongs to another session: stop and ask the user. The earlier dev home is kept as `.dev/paseo-home.before-claude-workflows-<timestamp>`, not deleted.

- [ ] **Step 5: Start the dev daemon.** Run:

```bash
. /tmp/claude-workflows-test.env && start_dev_daemon && wait_for_file /tmp/claude-workflows-dev-daemon.pid && echo "dev session pgid=$(cat /tmp/claude-workflows-dev-daemon.pid)"
```

Expected: `dev session pgid=<N>`. Then run with `run_in_background: true`:

```bash
timeout 300 bash -c '. /tmp/claude-workflows-test.env; until [ "$(dev_health)" = 200 ]; do sleep 2; done' && echo "dev daemon healthy" || echo "TIMEOUT waiting for the dev daemon"
```

Expected within about 2 minutes: `dev daemon healthy`. On `TIMEOUT`, read `tail -n 60 /tmp/claude-workflows-dev-daemon.out` and `grep -v '^{' /workspace/utils/paseo/.dev/paseo-home/daemon.log | tail -n 40`, then run **Abort and clean up**.

- [ ] **Step 6: Check that the plugin loaded.** Run:

```bash
. /tmp/claude-workflows-test.env
grep -E "^(Home|Listen):" /tmp/claude-workflows-dev-daemon.out | head -n 2
grep '"msg":"Loaded plugin"' "$DEV_HOME/daemon.log" | grep '"pluginId":"claude-workflows"' | grep -o '"methods":\[[^]]*\]'
grep '"msg":"Failed to start built-in plugin"' "$DEV_HOME/daemon.log" | grep -c '"pluginId":"claude-workflows"'
```

Expected:

```
Home:    /workspace/utils/paseo/.dev/paseo-home
Listen:  172.22.0.3:6768
"methods":["claude-workflows.run.request"]
0
```

The `Loaded plugin` line comes from `PluginRuntime` (`packages/server/src/server/plugins/runtime.ts:975-978`), and `Failed to start built-in plugin` from `packages/server/src/server/plugins/index.ts:235`.

- [ ] **Step 7: Call the RPC for an agent that does not exist.** Run:

```bash
. /tmp/claude-workflows-test.env && rpc_view agent-does-not-exist wf_00000000-000
```

Expected: `unavailable agent-not-found`. This proves the RPC script, the password, the plugin's registration and the handler's lookup in one call. A `Plugin RPC method not found` style error means the handler did not register: compare with Step 6.

- [ ] **Step 8: Prepare the agent's directory, project and workspace, and start Metro.** Run:

```bash
. /tmp/claude-workflows-test.env
rm -rf "$AGENT_DIR" && mkdir -p "$AGENT_DIR"
printf 'alpha\n' > "$AGENT_DIR/a.txt"; printf 'bravo\n' > "$AGENT_DIR/b.txt"; printf 'charlie\n' > "$AGENT_DIR/c.txt"
ls "$AGENT_DIR"
dev_cli project create "$AGENT_DIR" --json | node -e 'let t = ""; process.stdin.on("data", (c) => (t += c)).on("end", () => console.log(JSON.parse(t).projectId));' | tee /tmp/claude-workflows-project.id
dev_cli workspace create --isolation local --path "$AGENT_DIR" --project "$(cat /tmp/claude-workflows-project.id)" --title claude-workflows-test --no-background --json | node -e 'let t = ""; process.stdin.on("data", (c) => (t += c)).on("end", () => console.log(JSON.parse(t).workspaceId));' | tee /tmp/claude-workflows-workspace.id
dev_cli provider models claude --json | node -e 'let t = ""; process.stdin.on("data", (c) => (t += c)).on("end", () => { const list = JSON.parse(t); const items = Array.isArray(list) ? list : [list]; const sonnet = items.find((m) => /sonnet/i.test(m.id)); console.log(sonnet ? sonnet.id : "NO SONNET MODEL"); });' | tee /tmp/claude-workflows-model
memory_guard
```

Expected: `a.txt  b.txt  c.txt`, a project id, a workspace id, a Sonnet model id (for example `claude-sonnet-5-5`), and `memory ok: <figure> MB available`. On `NO SONNET MODEL` or `MEMORY LOW`, run **Abort and clean up** and report. Then start Metro:

```bash
. /tmp/claude-workflows-test.env
: > /tmp/claude-workflows-dev-app.pid
(cd "$REPO" && setsid -f sh -c 'echo $$ > /tmp/claude-workflows-dev-app.pid; exec flock /tmp/paseo-heavy.lock sh -c "$3" memory-guard env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_PASSWORD -u PASEO_WORKSPACE_ID -u DEV_PASSWORD PASEO_HOME="$1" PASEO_LISTEN="$2:6768" scripts/dev-app.sh' sh "$DEV_HOME" "$DEV_IP" "$HEAVY_GUARD" > /tmp/claude-workflows-dev-app.out 2>&1 < /dev/null)
wait_for_file /tmp/claude-workflows-dev-app.pid && echo "metro session pgid=$(cat /tmp/claude-workflows-dev-app.pid)"
```

Then run with `run_in_background: true`:

```bash
timeout 900 bash -c 'until grep -qE "Waiting on http://localhost:8081|MEMORY LOW" /tmp/claude-workflows-dev-app.out; do sleep 2; done' && grep -m3 -E "Metro:|Daemon:|Waiting on|MEMORY LOW" /tmp/claude-workflows-dev-app.out || echo "TIMEOUT waiting for Metro"
```

Expected: `Metro:   http://localhost:8081`, `Daemon:  172.22.0.3:6768` and `Waiting on http://localhost:8081`. The wait includes any time queued for the lock; the memory guard checks once the lock is taken. `MEMORY LOW: <n> MB available` means Metro did not start and the lock is free again: run **Abort and clean up** and report BLOCKED with the figure. Metro runs without `DEV_PASSWORD` in its environment, since it never needs it. Metro holds the lock until Step 22, so keep the browser steps short; from here on every failure goes through **Abort and clean up**, which stops Metro and releases the lock.

- [ ] **Step 9: Open the app in a new tab and add the dev host.** The Playwright browser is the shared CDP Chrome: open a tab of your own and never navigate another. Call `mcp__playwright__browser_tabs` with `{"action": "new", "url": "http://172.22.0.3:8081/"}`. Then run with `run_in_background: true`:

```bash
timeout 900 bash -c 'until grep -qE "Web Bundled|Bundling failed" /tmp/claude-workflows-dev-app.out; do sleep 3; done' && grep -m1 -E "Web Bundled|Bundling failed" /tmp/claude-workflows-dev-app.out || echo "TIMEOUT waiting for the web bundle"
```

Expected: `Web Bundled <ms>ms ... (<n> modules)`. Then add the host by hand, since the app has no password prompt for the `EXPO_PUBLIC_LOCAL_DAEMON` override:

1. Call `mcp__playwright__browser_evaluate` with `{"function": "() => { localStorage.removeItem(\"@paseo:daemon-registry\"); return \"host registry cleared\"; }"}`. This touches only the `http://172.22.0.3:8081` origin.
2. Call `mcp__playwright__browser_navigate` with `{"url": "http://172.22.0.3:8081/"}`.
3. Take `mcp__playwright__browser_snapshot`: it shows "Welcome to Paseo" with a `Direct connection` option. Click it.
4. Print the password with `cat /tmp/claude-workflows-dev-password; echo`. Fill `Host` with `172.22.0.3`, `Port` with `6768` and `Password` with that value, then click `Connect`, and `Connect` again if a "Connect to this host?" dialog follows.

Expected: a fresh snapshot shows the app connected to the dev host, with no error overlay.

- [ ] **Step 10: Create the agent.** This is the first step that spends Claude usage: without the user's yes from **Before Step 1**, run **Abort and clean up** and stop. Run with `run_in_background: true`:

```bash
. /tmp/claude-workflows-test.env && memory_guard && dev_cli run --provider claude --model "$(cat /tmp/claude-workflows-model)" --mode bypassPermissions --workspace "$(cat /tmp/claude-workflows-workspace.id)" --title claude-workflows-agent --wait-timeout 5m --json "Reply with the single word ready. Do not call any tool." > /tmp/claude-workflows-agent.json; echo "exit=$?"; run_result /tmp/claude-workflows-agent.json | tee /tmp/claude-workflows-agent.id
```

Expected: `memory ok: ...`, `exit=0` and `<agent id> completed`. Then print the agent's route and open it:

```bash
. /tmp/claude-workflows-test.env && echo "http://$DEV_IP:8081/h/$(cat "$DEV_HOME/server-id")/agent/$(agent_id)"
```

Call `mcp__playwright__browser_navigate` with that URL. Expected: the app opens the `claude-workflows-test` workspace with the agent's tab, showing the prompt and the reply `ready`.

---

- [ ] **Step 11: Launch the first workflow (W1).** Write the three workflow prompts. W1's agents sleep 60 s, which leaves time to watch the card while it runs; W2 and W3 sleep 120 s, so they are still running when Steps 15 and 17 cut them off. Each launch turn first runs `pwd`: a turn folds only when it did work before its reply, and the card is no work (Decision 22), so the call makes the launch turn fold and Step 12 can watch a card inside a folded turn:

```bash
cat > /tmp/claude-workflows-w1.txt <<'EOF'
Use a workflow for this task. First run the Bash command `pwd` once yourself. Then call the Workflow tool once to run three agents in parallel, each with model sonnet. Agent 1 reads a.txt, agent 2 reads b.txt and agent 3 reads c.txt, all in the current directory. Each agent then runs the Bash command `sleep 60` and replies with the single word in its file. Do not read the files or run `sleep` yourself. When the Workflow tool returns, reply with the single word launched and stop.
EOF
sed 's/sleep 60/sleep 120/' /tmp/claude-workflows-w1.txt > /tmp/claude-workflows-w2.txt
cp /tmp/claude-workflows-w2.txt /tmp/claude-workflows-w3.txt
grep -c 'sleep 60' /tmp/claude-workflows-w1.txt; grep -c 'sleep 120' /tmp/claude-workflows-w2.txt /tmp/claude-workflows-w3.txt
```

Expected: `1`, then `/tmp/claude-workflows-w2.txt:1` and `/tmp/claude-workflows-w3.txt:1`. Then send W1, with `run_in_background: true` (Claude writes the workflow script first, which can take a minute or two):

```bash
. /tmp/claude-workflows-test.env && memory_guard && dev_cli wait "$(agent_id)" --timeout 300 --json | run_result /dev/stdin && rm -f /tmp/claude-workflows-send.json && dev_cli send "$(agent_id)" --prompt-file /tmp/claude-workflows-w1.txt --json > /tmp/claude-workflows-send.json; echo "exit=$?"; run_result /tmp/claude-workflows-send.json; run_ids "$(agent_id)" > /tmp/claude-workflows-runs; echo "runs: $(wc -l < /tmp/claude-workflows-runs)"; run_id 1
```

Expected:

```
memory ok: <figure> MB available
<agent id> idle
exit=0
<agent id> completed
runs: 1
wf_<8 hex digits>-<3 hex digits>
```

`send` returns when the turn ends, which is right after launch: the Workflow tool returns as soon as the run starts. `runs: 0` means no Workflow result named a run. Count the agent's Workflow calls with `. /tmp/claude-workflows-test.env && dev_cli logs "$(agent_id)" --json | grep -c '"name": "Workflow"'`:

- `0`: the agent did not call the tool, so it may not have it. Claude Code's workflows may need the Ultra Code thinking option (`--thinking ultracode` on `paseo run`, offered only for models with an `xhigh` effort level: `packages/server/src/server/agent/providers/claude/model-manifest.ts:222-224`, applied as the `ultracode` setting in `agent.ts:3757-3771`). Changing the agent's thinking option restarts its process, and this task does not change it unasked. Run **Abort and clean up**, then report BLOCKED and ask the user.
- `1` or more: the call failed or its launch never completed. Run **Abort and clean up** and report the tool call's status from the same logs.

- [ ] **Step 12: Watch W1 run, on the RPC and on the card.** Wait until all three agents work, with `run_in_background: true`:

```bash
if timeout 180 bash -c '. /tmp/claude-workflows-test.env; until rpc_view "$(agent_id)" "$(run_id 1)" | grep -qE "^running agents=3 states=running,running,running toolCalls=([3-9]|[1-9][0-9]+) "; do sleep 3; done'; then . /tmp/claude-workflows-test.env; rpc_view "$(agent_id)" "$(run_id 1)"; else echo "TIMEOUT: run 1 never showed three working agents"; fi
```

Expected: `running agents=3 states=running,running,running toolCalls=<3 or more> name=null`. The name is null because a run gets its record only when it ends. On `TIMEOUT`, call `rpc_view` for run 1 once more: a `completed` line means the agents never slept, and anything else is a launch problem. Record which, and run **Abort and clean up**.

Go straight on to the card, while the agents sleep. Steps 12 to 18 use two browser procedures and one rule, all in this test's own tab:

- **Card read.** Call `mcp__playwright__browser_evaluate` with this function:

  ```js
  () => ({
    visibility: document.visibilityState,
    foldedTurns: document.querySelectorAll(
      "[data-testid=turn-summary] [role=button][aria-expanded=false]",
    ).length,
    cards: [...document.querySelectorAll("[data-testid=claude-workflow-card]")].map((card) =>
      card.innerText.replace(/\s+/g, " ").trim(),
    ),
  });
  ```

  `visibility` must be `visible`. React Query skips interval refetches while the page is hidden, so on `hidden` call `mcp__playwright__browser_tabs` with `{"action": "select", "index": <this tab's index from "list">}` and read again. A page that turns visible again makes React Query refetch every mounted card once (`refetchOnWindowFocus`, a default the plugin's query client keeps), which moves a finished card's ages too, and so does a card that mounts again. A comparison over a wait (Steps 13 and 18) therefore counts only when no tab switch happened between its two reads; after one, read once, wait 65 s and compare again.

- **Folded turns stay folded.** Collapse turns, the app's default Chat display, folds each finished turn's work into one summary line under its prompt, and keeps the turn's plugin rows in view (Task 12, Decision 22). The cards are read with their turns folded: never click a turn summary. `foldedTurns` counts the folded summaries.
- **Open closed cards.** For each closed card, call `mcp__playwright__browser_click` with `{"target": "[data-testid=claude-workflow-card] [role=button][aria-expanded=false] >> nth=0", "element": "first closed workflow card header"}`, then read again.

If the click tool refuses a selector, find the element with `mcp__playwright__browser_find` (the card header's accessible name holds its run id) and click its ref instead.

Now run **Card read**. Expected: `visibility` is `visible`, `foldedTurns` is 1, since W1's launch turn folded around its `pwd` call while Step 10's turn did no work and stays open (2 also passes: Step 10's turn folded too), and `cards` holds one string that starts `Workflow <run 1 id> Running`, then the summary from the tool result, then `3 agents · 0 done · 0 failed · <n> tool calls`, usually followed by tokens and an elapsed time. Three agent rows follow, each starting `Running <label>`, and at least one shows `Bash (running)`. Then call `mcp__playwright__browser_wait_for` with `{"time": 7}` and run **Card read** again.

Expected: `foldedTurns` has not changed, and the string still starts `Workflow <run 1 id> Running` and differs from the first read, at least in its elapsed time. Elapsed time and ages count to the time of the last fetch (Decision 14), so a different string means a poll landed between the reads: the card stays mounted in the folded turn and keeps polling. An identical string while `visibility` is `visible` means the card is not polling: record that as a failure and run **Abort and clean up**. If `cards` is empty with `foldedTurns` above 0, the fold hid the card, which Task 12 prevents: record that as a failure of Task 12 and abort. If `cards` is empty with `foldedTurns` at 0, the transformer did not swap the card: read `mcp__playwright__browser_console_messages` at level `error` for a plugin load error, then abort. If `cards` holds the card while `foldedTurns` is 0, the launch turn did not fold, most likely because the agent skipped `pwd`: count its Bash calls with `. /tmp/claude-workflows-test.env && dev_cli logs "$(agent_id)" --json | grep -c '"name": "Bash"'`, record the folded-turn check as not reached, and go on with the polling check as written.

- [ ] **Step 13: W1 completes, and its card stops polling.** Run with `run_in_background: true`:

```bash
if timeout 300 bash -c '. /tmp/claude-workflows-test.env; while rpc_view "$(agent_id)" "$(run_id 1)" | grep -q "^running "; do sleep 5; done'; then . /tmp/claude-workflows-test.env; rpc_view "$(agent_id)" "$(run_id 1)"; dev_cli wait "$(agent_id)" --timeout 300 --json | run_result /dev/stdin; else echo "TIMEOUT: run 1 still running after 300 s"; fi
```

Expected: `completed agents=3 states=done,done,done toolCalls=<n> name=<the workflow's name>`, then `<agent id> idle`. Claude Code tells the agent when its workflow ends, so the agent may run a short turn of its own; the wait lets that turn finish before the card checks, since new rows can remount a card. On `TIMEOUT`, run `. /tmp/claude-workflows-test.env && dev_cli permit ls --json`. A pending permission for this agent means the workflow's agents did not inherit `bypassPermissions`: allow it with `dev_cli permit allow "$(agent_id)" --all`, record that as a finding, and run this step again. Anything else: run **Abort and clean up**.

Run **Card read**. Expected: `foldedTurns` above 0, and the card starts `Workflow <run 1 id> Completed`, then the summary, then `3 agents · 3 done · 0 failed · <n> tool calls`, and shows no agent rows: it closed itself when the run left Running (Decision 15). Run **Open closed cards** once. Expected: three agent rows that start `Done`, none of them with `(running)`.

Call `mcp__playwright__browser_wait_for` with `{"time": 65}`, then run **Card read** again. Expected: the same string as the read before the wait. Ages count to the last fetch and move only when a poll lands. Over 65 s, a poll would move every age shown in seconds or minutes, so an identical string means no poll landed: polling stopped once the run left Running.

- [ ] **Step 14: Launch the second workflow (W2).** Run with `run_in_background: true`:

```bash
. /tmp/claude-workflows-test.env && memory_guard && dev_cli wait "$(agent_id)" --timeout 300 --json | run_result /dev/stdin && rm -f /tmp/claude-workflows-send.json && dev_cli send "$(agent_id)" --prompt-file /tmp/claude-workflows-w2.txt --json > /tmp/claude-workflows-send.json; echo "exit=$?"; run_result /tmp/claude-workflows-send.json; run_ids "$(agent_id)" > /tmp/claude-workflows-runs; echo "runs: $(wc -l < /tmp/claude-workflows-runs)"; run_id 2
```

Expected: `memory ok: <figure> MB available`, `<agent id> idle`, `exit=0`, `<agent id> completed`, `runs: 2`, and a second run id that differs from run 1's. Then wait until W2's agents work, with `run_in_background: true`:

```bash
if timeout 180 bash -c '. /tmp/claude-workflows-test.env; until rpc_view "$(agent_id)" "$(run_id 2)" | grep -qE "^running agents=3 states=running,running,running toolCalls=([3-9]|[1-9][0-9]+) "; do sleep 3; done'; then . /tmp/claude-workflows-test.env; rpc_view "$(agent_id)" "$(run_id 2)"; else echo "TIMEOUT: run 2 never showed three working agents"; fi
```

Expected: `running agents=3 states=running,running,running toolCalls=<3 or more> name=null`.

- [ ] **Step 15: Stop W2 with TaskStop, which gives Killed.** Run with `run_in_background: true`:

```bash
. /tmp/claude-workflows-test.env && dev_cli send "$(agent_id)" --json "Stop the workflow you started last: call the TaskStop tool with its task id. Then reply with the single word stopped." | run_result /dev/stdin
if timeout 120 bash -c '. /tmp/claude-workflows-test.env; while rpc_view "$(agent_id)" "$(run_id 2)" | grep -q "^running "; do sleep 3; done'; then rpc_view "$(agent_id)" "$(run_id 2)"; rpc_view "$(agent_id)" "$(run_id 1)"; else echo "TIMEOUT: run 2 still running after 120 s"; fi
```

Expected:

```
<agent id> completed
killed agents=3 states=stopped,stopped,stopped toolCalls=<n> name=<the workflow's name>
completed agents=3 states=done,done,done toolCalls=<n> name=<the workflow's name>
```

Its agents show stopped because they have neither a `result` nor a `failed` line and the run is not Running. On `TIMEOUT`, check whether the agent called the tool: `. /tmp/claude-workflows-test.env && dev_cli logs "$(agent_id)" --json | grep -c '"name": "TaskStop"'`. `0`: send the same prompt once more and repeat the wait. A run that still does not leave Running: record it and run **Abort and clean up**.

Run **Card read**. Expected: `foldedTurns` above 0, a card that starts `Workflow <run 2 id> Killed` and shows `3 agents · 0 done · 0 failed · <n> tool calls`, and run 1's card still starts `Workflow <run 1 id> Completed`.

- [ ] **Step 16: Launch the third workflow (W3).** Run with `run_in_background: true`:

```bash
. /tmp/claude-workflows-test.env && memory_guard && dev_cli wait "$(agent_id)" --timeout 300 --json | run_result /dev/stdin && rm -f /tmp/claude-workflows-send.json && dev_cli send "$(agent_id)" --prompt-file /tmp/claude-workflows-w3.txt --json > /tmp/claude-workflows-send.json; echo "exit=$?"; run_result /tmp/claude-workflows-send.json; run_ids "$(agent_id)" > /tmp/claude-workflows-runs; echo "runs: $(wc -l < /tmp/claude-workflows-runs)"; run_id 3
```

Expected: `memory ok: <figure> MB available`, `<agent id> idle`, `exit=0`, `<agent id> completed`, `runs: 3`, and a third run id. Then, with `run_in_background: true`:

```bash
if timeout 180 bash -c '. /tmp/claude-workflows-test.env; until rpc_view "$(agent_id)" "$(run_id 3)" | grep -qE "^running agents=3 states=running,running,running toolCalls=([3-9]|[1-9][0-9]+) "; do sleep 3; done'; then . /tmp/claude-workflows-test.env; rpc_view "$(agent_id)" "$(run_id 3)"; else echo "TIMEOUT: run 3 never showed three working agents"; fi
```

Expected: `running agents=3 states=running,running,running toolCalls=<3 or more> name=null`.

- [ ] **Step 17: Reload the agent, which gives Stopped.** This is the task's one deliberate restart: `agent reload` closes the agent's Claude process (`packages/server/src/server/agent/agent-manager.ts:1783-1850`), and W3 runs inside that process. Run with `run_in_background: true`:

```bash
. /tmp/claude-workflows-test.env && dev_cli agent reload "$(agent_id)" --json | run_result /dev/stdin
if timeout 120 bash -c '. /tmp/claude-workflows-test.env; while rpc_view "$(agent_id)" "$(run_id 3)" | grep -q "^running "; do sleep 3; done'; then for n in 1 2 3; do rpc_view "$(agent_id)" "$(run_id "$n")"; done; else echo "TIMEOUT: run 3 still running after 120 s"; fi
```

Expected:

```
<agent id> reloaded
completed agents=3 states=done,done,done toolCalls=<n> name=<the workflow's name>
killed agents=3 states=stopped,stopped,stopped toolCalls=<n> name=<the workflow's name>
stopped agents=3 states=stopped,stopped,stopped toolCalls=<n> name=null
```

Run 3 has no record, and the process that ran it is gone; a process the reload started for the same session began after the run's newest agent, so it does not count (Decision 11). Then count session changes with `grep -c 'Claude session ID changed' /workspace/utils/paseo/.dev/paseo-home/daemon.log` and put the count in the report. Above 0, the reload gave the agent a new Claude session id: the three runs are then found in the session it left, and run 3 is checked against that session's process, which is gone (Decisions 5 and 11), so the expected lines do not change. `unavailable run-not-found` on all three lines means that search missed them too: record it as a failure of Task 3's locator and run **Abort and clean up**.

Run **Card read**. Expected: `foldedTurns` above 0, a card that starts `Workflow <run 3 id> Stopped` and shows `3 agents · 0 done · 0 failed · <n> tool calls`, with run 1's card `Completed` and run 2's `Killed`.

- [ ] **Step 18: Restart the dev daemon and reload the page: each finished card loads once.** This is Decision 20's check for a run from before the plugin existed: the cache is gone, so each card's first call reads its run from offset zero. Run with `run_in_background: true`:

```bash
. /tmp/claude-workflows-test.env && stop_dev_daemon && start_dev_daemon && wait_for_file /tmp/claude-workflows-dev-daemon.pid && echo "dev session pgid=$(cat /tmp/claude-workflows-dev-daemon.pid)"
if timeout 300 bash -c '. /tmp/claude-workflows-test.env; until [ "$(dev_health)" = 200 ]; do sleep 2; done'; then echo "dev daemon healthy"; else echo "TIMEOUT waiting for the dev daemon"; fi
```

Expected: `dev supervisor <pid> exited`, possibly `dev session group <pgid> empty`, then `dev session pgid=<a new number>` and `dev daemon healthy`, with no `TIMEOUT` line. Then:

```bash
. /tmp/claude-workflows-test.env
grep '"msg":"Loaded plugin"' "$DEV_HOME/daemon.log" | grep -c '"pluginId":"claude-workflows"'
for n in 1 2 3; do rpc_view "$(agent_id)" "$(run_id "$n")"; done
echo "http://$DEV_IP:8081/h/$(cat "$DEV_HOME/server-id")/agent/$(agent_id)"
```

Expected: `2` (one load per daemon start), the same three lines as Step 17, and the agent's URL. Call `mcp__playwright__browser_navigate` with that URL; the reload empties the page's query cache too. Call `mcp__playwright__browser_wait_for` with `{"time": 10}`, then run **Card read**; while `cards` is empty, wait 10 s more and read again, up to six times.

Expected: `foldedTurns` above 0, and three cards, one starting `Workflow <run 1 id> Completed`, one `Workflow <run 2 id> Killed` and one `Workflow <run 3 id> Stopped`, each with its totals and no agent rows. Run **Open closed cards** three times. Expected: run 1's card lists three rows starting `Done`, and runs 2 and 3 list three rows starting `Stopped`; no row shows `(running)`. Call `mcp__playwright__browser_wait_for` with `{"time": 65}`, then run **Card read** again. Expected: the same three strings as the read before the wait: each card loaded once and did not poll.

- [ ] **Step 19: A provider-subagent id, and a run that does not exist.** Run:

```bash
. /tmp/claude-workflows-test.env
rpc_view "$(agent_id)" "$(run_id 1)" --json > /tmp/claude-workflows-plain.json
rpc_view "provider:$(agent_id):sub-1" "$(run_id 1)" --json > /tmp/claude-workflows-provider.json
cmp /tmp/claude-workflows-plain.json /tmp/claude-workflows-provider.json && echo "provider-subagent id reads the parent's run"
rpc_view "$(agent_id)" wf_ffffffff-fff
```

Expected: `provider-subagent id reads the parent's run`, then `unavailable run-not-found`. A provider-subagent pane renders the card with an id of this form (Task 2), and a finished run's view does not change between calls, so the two files match byte for byte.

- [ ] **Step 20: Archive the agent; its runs still load.** This is the live half of Decision 1. Run:

```bash
. /tmp/claude-workflows-test.env && dev_cli agent archive "$(agent_id)" --force --json | run_result /dev/stdin && rpc_view "$(agent_id)" "$(run_id 1)"
```

Expected: `<agent id> archived`, then `completed agents=3 states=done,done,done toolCalls=<n> name=<the workflow's name>`. `unavailable agent-not-found` means `fetch_agent` no longer serves archived agents: Decision 1 is wrong, so record it as a finding against Task 2.

- [ ] **Step 21: The daemon log holds nothing from the plugin but its loads.** Run:

```bash
. /tmp/claude-workflows-test.env
grep '"msg":"Loaded plugin"' "$DEV_HOME/daemon.log" | grep -c '"pluginId":"claude-workflows"'
grep '"pluginId":"claude-workflows"' "$DEV_HOME/daemon.log" | grep -vc '"msg":"Loaded plugin"'
grep -c 'daemon crashing' "$DEV_HOME/daemon.log"
```

Expected: `2`, `0`, `0`. The plugin writes no output (`Plugin output`, `packages/server/src/server/plugins/runtime.ts:1461`) and never failed to start (`index.ts:235`), and no uncaught exception or unhandled rejection took the daemon down (`packages/server/src/server/daemon-worker.ts:373-381`).

- [ ] **Step 22: Stop everything this task started.** Run with `run_in_background: true`:

```bash
. /tmp/claude-workflows-test.env && abort_cleanup
```

Expected: `dev supervisor <pid> exited`, `Metro group <pgid> stopped; /tmp/paseo-heavy.lock released`, `dev password file removed` and `abort cleanup done`, with no `TIMEOUT` or `STILL LISTENING` line. An `agent <id> archived` line may appear again; that is harmless. A `sent SIGTERM to agent` line means a process of the archived agent outlived the daemon: record it as a finding. Then call `mcp__playwright__browser_tabs` with `{"action": "list"}` and close this test's `http://172.22.0.3:8081` tab with `{"action": "close", "index": <its index>}`.

The test leaves the agent's Claude session files under `~/.claude/projects/-tmp-claude-workflows-agent/` and the dev home in `.dev/paseo-home` (gitignored) for the report; neither holds anything but this test's trivial prompts.

- [ ] **Step 23: Remove the scratch files and report.** This step also runs after **Abort and clean up**. Run:

```bash
rm -rf /tmp/claude-workflows-agent
rm -f /tmp/claude-workflows-test.env /tmp/claude-workflows-rpc.mts /tmp/claude-workflows-dev-password /tmp/claude-workflows-dev-daemon.pid /tmp/claude-workflows-dev-app.pid /tmp/claude-workflows-project.id /tmp/claude-workflows-workspace.id /tmp/claude-workflows-model /tmp/claude-workflows-agent.json /tmp/claude-workflows-agent.id /tmp/claude-workflows-w1.txt /tmp/claude-workflows-w2.txt /tmp/claude-workflows-w3.txt /tmp/claude-workflows-send.json /tmp/claude-workflows-runs /tmp/claude-workflows-plain.json /tmp/claude-workflows-provider.json
ls /tmp/claude-workflows-*
```

Expected: `ls` lists only the logs kept for the report, of those the test got to write: `/tmp/claude-workflows-build.out`, `/tmp/claude-workflows-dev-app.out`, `/tmp/claude-workflows-dev-daemon.out` and `/tmp/claude-workflows-dist.out`. Report each manual check (Steps 6 to 21) as passed, failed or not reached, Step 12's folded-turn check among them, with Step 17's count of session changes and the findings recorded on the way.

---

### Task 14: The docs paragraph

**Files:**

- Modify: `docs/plugins.md` (section "Built-in plugins": one paragraph before the paragraph that starts "Local runs of `scripts/builtin-plugins-dist.test.mjs` and")

**Interfaces:**

Consumes: the built-in as Tasks 1 to 11 ship it, and Task 13's findings. A deviation the manual test found and the plan keeps gets one sentence in the paragraph, next to the rule it qualifies. Task 12 already wrote the sentence on folded turns, under "Contribute timeline items", so the paragraph leaves them out.

Produces: the `claude-workflows` paragraph in `docs/plugins.md`. No code and no new exports.

This task runs whether Task 13 passed, failed, stopped early or was declined by the user.

- [ ] **Step 1: Write the docs paragraph.** Run:

```bash
cd /workspace/utils/paseo && test "$(git branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
node --input-type=module <<'EOF'
import { readFileSync, writeFileSync } from "node:fs";

const path = "/workspace/utils/paseo/docs/plugins.md";
const text = readFileSync(path, "utf8");
const anchor = "Local runs of `scripts/builtin-plugins-dist.test.mjs` and\n";
if (text.split(anchor).length !== 2) throw new Error("anchor not found exactly once");
if (text.includes("The `claude-workflows` built-in")) throw new Error("paragraph already present");
const paragraph = [
  "The `claude-workflows` built-in replaces the card of Claude Code's `Workflow` tool with a live card",
  "once the tool result names a run: the run's state and, for each agent inside it, its phase, state,",
  "tool calls, last tool, tokens and last activity. The card no longer shows the workflow script. A",
  "Running card polls `claude-workflows.run.request` every 3 s and stops once the run is not Running;",
  "the daemon runs no timer or watcher for it. The plugin reads Claude Code's undocumented files as of",
  "2.1.x, so after an update that changes them you get a partial card or Unavailable. Running needs a",
  "live Claude process for the run's session, found through Linux `/proc`; elsewhere a run without a",
  "record shows Stopped. A client without `daemon.manage` loads no plugin code and keeps the plain",
  "card. File formats and state rules are in the",
  "[design](superpowers/specs/2026-11-07-claude-workflows-design.md#where-the-data-lives).",
].join("\n");
writeFileSync(path, text.replace(anchor, `${paragraph}\n\n${anchor}`));
console.log("paragraph inserted");
EOF
git diff --stat -- docs/plugins.md
```

Expected: `paragraph inserted`, then `1 file changed, 11 insertions(+)`: the ten lines and one blank line, inserted after the other built-ins' paragraphs and before the "Local runs of" paragraph. `anchor not found exactly once` means a later edit changed that paragraph's first line: stop and report it, and do not pick another anchor. Read the paragraph back with `git diff -- docs/plugins.md`. It names the gotchas the code cannot tell a reader: the undocumented format, Linux-only liveness and the permission gate. Everything else links to the spec, and folded turns are Task 12's sentence under "Contribute timeline items".

- [ ] **Step 2: Format and check the doc.**

```bash
cd /workspace/utils/paseo && npm run format:files -- docs/plugins.md && npm run format:check:files -- docs/plugins.md && git diff --stat -- docs/plugins.md
```

Expected: oxfmt exits 0 twice, and the stat still reads `1 file changed, 11 insertions(+)`. A different count means the formatter rewrapped the paragraph: keep its result.

- [ ] **Step 3: Commit the doc with the fork identity (local only, never push).**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/claude-workflows || { echo "STOP: not on feat/claude-workflows"; exit 1; }
git -C /workspace/utils/paseo add docs/plugins.md
git -C /workspace/utils/paseo diff --cached --name-only
flock /tmp/paseo-heavy.lock sh -c 'mb=$(awk "/MemAvailable/{print int(\$2/1024)}" /proc/meminfo); [ "$mb" -ge 2500 ] || { echo "MEMORY LOW: $mb MB available"; exit 1; }; exec "$@"' memory-guard env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "docs(fork): document the claude-workflows built-in" -- docs/plugins.md
```

Expected: `diff --cached --name-only` prints only `docs/plugins.md`, the hook passes, and git prints `1 file changed, 11 insertions(+)`. The hook's typecheck holds the heavy lock through the `flock`. Metro no longer holds it: Task 13's Step 22 or its abort path released it, and a declined Task 13 never took it. If a hook job fails, git creates no commit: report the hook output and stop.

- [ ] **Step 4: Check the commit.**

```bash
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- docs plugins/claude-workflows
```

Expected: `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` prints `docs(fork): document the claude-workflows built-in` and `docs/plugins.md`; `status` prints nothing.

---

## Self-Review

### Spec coverage

| Spec requirement                                                                                                                                                                                            | Where                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope: a live card in place of the plain Workflow card, with the run's state and each agent's phase, state, tool calls, last tool, tokens and last activity                                                 | Tasks 5, 8, 9, 10, 11; Task 13 Steps 12 to 18                                                                                                                                                                                                                                                                                                       |
| Scope: past runs, read once from disk                                                                                                                                                                       | Decision 20; Task 7 (a new entry starts at offset zero); Task 13 Step 18                                                                                                                                                                                                                                                                            |
| Decisions, where it shows: a transformer swaps the `tool_call` named `Workflow` for a plugin item; the script view goes away                                                                                | Task 9; Task 11 Step 3; Task 13 Step 12                                                                                                                                                                                                                                                                                                             |
| Decisions, packaging: built-in `claude-workflows`, on for every instance                                                                                                                                    | Task 1 (registry line, manifest); Task 13 Steps 3 and 6; Decision 21                                                                                                                                                                                                                                                                                |
| Decisions, data flow: poll every 3 s while Running, stop otherwise; no daemon timers or watchers                                                                                                            | Task 10 (`pollInterval`); Task 11 (`refetchInterval`); Task 12 (a card in a folded turn stays mounted, so it keeps polling); Global Constraints, in-process safety; Task 8 Step 5; Task 13 Steps 3, 12, 13, 18, 21                                                                                                                                  |
| Decisions, finding a run: every path from the snapshot and the run id, never from the app                                                                                                                   | Task 1 (RPC input is `{ agentId, runId }` only); Tasks 2 and 3                                                                                                                                                                                                                                                                                      |
| Decisions, reading: incremental, byte offset and partial last line                                                                                                                                          | Task 4; Task 8 (incremental test)                                                                                                                                                                                                                                                                                                                   |
| Decisions, liveness: record gives Completed or Killed; else a live process that started before the newest agent gives Running, else Stopped                                                                 | Task 6; Task 8 (the process of the session that holds the run, an earlier one included); Decisions 5, 10 and 11; Task 13 Steps 12, 15, 17                                                                                                                                                                                                           |
| Decisions, privacy: tool names, file paths, counts, tokens, times, labels and phases only                                                                                                                   | Task 1 (view schema); Task 6 (record fields); Task 8 (privacy test)                                                                                                                                                                                                                                                                                 |
| No wire change; `daemon.manage` gates plugin code                                                                                                                                                           | No task needed: the host's rule (`packages/server/src/server/authorization/operation-permissions.ts`, `plugin.*` operations need `daemon.manage`), already covered by `packages/server/src/server/session.test.ts` ("losing daemon.manage during a plugin RPC withholds its JSON and binary results"). Named in the docs paragraph (Task 14 Step 1) |
| Components: `shared/`, `index.server.ts` and `server/`, `index.client.tsx` and `client/`                                                                                                                    | Task 1; Tasks 2 to 8; Tasks 9 to 11                                                                                                                                                                                                                                                                                                                 |
| Where the data lives: config dirs, slug copied from `project-dir.ts`, run dir, run record, sessions files, never `*.key` or `.credentials.json`                                                             | Task 3 (`claudeConfigDirs`, `projectSlug`, `locateRun`, which reads only names under `projects/<slug>/` when it searches other sessions); Task 6 (`hasLiveSession` skips key files); Decision 5                                                                                                                                                     |
| Formats: run id, journal events, resume appends with new agentIds                                                                                                                                           | Task 1; Task 5; Task 8 (resume test); Decision 2                                                                                                                                                                                                                                                                                                    |
| The card: run id in the result swaps the card; without one the plain card stays                                                                                                                             | Task 9                                                                                                                                                                                                                                                                                                                                              |
| The card: header with "Workflow", summary, state chip and totals                                                                                                                                            | Tasks 10 and 11; Decisions 14 and 18                                                                                                                                                                                                                                                                                                                |
| The card: five states, Unavailable with one short reason                                                                                                                                                    | Tasks 6, 8 and 10; Decision 13; Task 13 Steps 7 and 12 to 19                                                                                                                                                                                                                                                                                        |
| The card: agents by phase in start order, queued agents not shown; each row's state, label, tool calls, last tool with its file, tokens and last activity                                                   | Task 5 (journal order, `displayFile`, last tool); Task 10 (`groupByPhase`, `describeAgent`)                                                                                                                                                                                                                                                         |
| The card: Running shows agents and refreshes; finished shows its header and opens on tap; polling stops                                                                                                     | Task 10 (`isCardOpen`, `pollInterval`); Task 11; Task 12 (folded turns keep the card in view); Decisions 15, 16 and 22; Task 13 Steps 12, 13 and 18                                                                                                                                                                                                 |
| The card: a resumed run's cards both show its latest attempt                                                                                                                                                | Task 8 (resume test); Task 11 (one query key per agent and run id)                                                                                                                                                                                                                                                                                  |
| The card: copy follows `docs/design.md` section 10                                                                                                                                                          | Task 10 (copy rules test); Global Constraints                                                                                                                                                                                                                                                                                                       |
| Server 1, locate: snapshot through `refresh()`, Claude agent with session id and cwd, slug then scan per config dir, id formats, run dir inside its config dir, provider-subagent ids                       | Tasks 2 and 3, Task 3 also searching the other sessions under the cwd's slug; Task 8 (a run of the agent's earlier session); Decisions 1, 3, 4 and 5; Task 13 Steps 7, 17 (a session change, if the reload makes one), 19 and 20                                                                                                                    |
| Server 2, reader: 1 MB chunks, partial last line, start over on shrink or a new inode, parse only lines that can matter                                                                                     | Task 4; Task 5 (`isCandidateLine`); Decisions 6 and 7                                                                                                                                                                                                                                                                                               |
| Server 3, fold: newest `started` per key, `result` and `failed`, `tool_use` blocks counted, last tool and its file, running until its `tool_result`, tokens from the newest usage, activity from timestamps | Task 5; Decision 8                                                                                                                                                                                                                                                                                                                                  |
| Server 4, state check: record status, end time and name only; sessions file, `/proc` start time, started no later than the newest agent; agent running or stopped                                           | Task 6; Task 8 (the session the run was found in); Decisions 9, 10 and 11                                                                                                                                                                                                                                                                           |
| Server 5, cache: one entry per run dir, at most 32, least recently used first, idle 10 minutes, one call at a time per run                                                                                  | Task 7; Decision 12                                                                                                                                                                                                                                                                                                                                 |
| Server 6, RPC validated by the shared schema on both sides                                                                                                                                                  | Task 1 (`runRpc` output schema); Task 8 (`RunViewSchema.parse`); Task 11 (`useRpc` parses the output)                                                                                                                                                                                                                                               |
| Errors: an unreadable file marks only its agent                                                                                                                                                             | Task 8 (unreadable test); Task 10 (`UNREADABLE_AGENT`)                                                                                                                                                                                                                                                                                              |
| Errors: missing files, a non-Claude agent or a failed snapshot give Unavailable; summary and run id stay                                                                                                    | Task 8; Task 11 (header keeps run id and summary); Decision 4                                                                                                                                                                                                                                                                                       |
| Errors: archived agents, checked early                                                                                                                                                                      | Decision 1; Task 2 Step 1; Task 13 Step 20                                                                                                                                                                                                                                                                                                          |
| Errors: a failed refresh keeps the data and shows "Refresh failed"                                                                                                                                          | Task 8 (lookup failure rejects); Task 10 (`refreshNote` test, and `pollInterval` reads the kept view); Task 11 (card shows `refreshNote`); Decision 16                                                                                                                                                                                              |
| Errors: first reads of large files in 1 MB chunks                                                                                                                                                           | Task 4 (chunk test)                                                                                                                                                                                                                                                                                                                                 |
| Errors: a daemon restart rebuilds the cache from offset zero                                                                                                                                                | Task 13 Step 18                                                                                                                                                                                                                                                                                                                                     |
| Errors: no timers, watchers or detached promises                                                                                                                                                            | Global Constraints; Task 8 Step 5; Task 13 Steps 3 and 21                                                                                                                                                                                                                                                                                           |
| Testing, unit: transformer, locating, reader, fold, state check, RPC handler with a fake `paseo`                                                                                                            | Tasks 9, 3, 4, 5, 6 and 8; Decision 19; Task 12 tests the app's turn fold                                                                                                                                                                                                                                                                           |
| Testing, fixtures built from typed objects, no real transcripts                                                                                                                                             | Global Constraints, types and tests                                                                                                                                                                                                                                                                                                                 |
| Testing, manual: live updates, Completed and polling stops; TaskStop gives Killed; a reload gives Stopped; a pre-plugin run loads once                                                                      | Task 13 Steps 12 and 13, 15, 17, 18; Step 12 also watches the card poll inside a folded turn                                                                                                                                                                                                                                                        |
| Docs: a paragraph in "Built-in plugins"                                                                                                                                                                     | Task 14; Task 12 adds the sentence on folded turns under "Contribute timeline items"                                                                                                                                                                                                                                                                |

Gaps, each a deliberate choice or a limit of a plugin:

- `daemon.manage`: a client without it loads no plugin code. That is the host's rule, tested by the host (see the table); this plan adds no test of it, and the docs paragraph names it.
- "Refresh failed": the rule is a tested helper (`refreshNote`, Task 10) and the card only renders its result (Task 11). The manual test does not force a transport failure, since that would mean stopping the daemon mid-poll.
- Resumed runs: the server side is unit-tested (Task 8); that both cards show the latest attempt follows from the shared query key, and the manual test does not resume a run.
- "Other providers" in the transformer test: the transformer gets no provider, so Task 9 tests other output shapes instead (Decision 3, approved by the user on 2026-11-07).
- "A run from before the plugin existed" is tested as a run read after a daemon restart (Decision 20, approved by the user on 2026-11-07).
- A Running card refreshes only while it is mounted. Task 12 keeps every plugin row mounted in a folded turn (Decision 22), and in an opened turn those rows render outside the indent rail, as compaction rows do. Its unit test covers the fold, and Task 13 Step 12 the card's polling inside a folded turn; no test renders the rail.
- Earlier sessions: the search covers only the other sessions under the cwd's slug (Decision 5), so a run of an earlier session kept under another project dir still shows "Run files not found". Task 3 tests the search and its limits and Task 8 the found session's liveness; Task 13 sees the search live only if Step 17's reload changes the session id.

### Placeholder scan

Searched the plan for `TBD`, `TODO`, `FIXME`, "implement later", "fill in", "similar to Task" and "as above": no matches outside the `mktemp` template in Task 13 Step 3. Every code step carries the complete code, every test step names the vitest command and its expected output, and every expected failure quotes the vitest fragment it produces.

### Type consistency

Checked every exported name against each place that imports it:

- `shared/run.ts` (Task 1): `RUN_ID_PATTERN`, `WORKFLOW_ITEM_KIND`, `WORKFLOW_ITEM_VERSION`, `WorkflowItemSchema` and `WorkflowItem`, `LastTool`, `RunAgent`, `RunState`, `LoadedRun`, `UnavailableReason`, `RunView`, `RunViewSchema`, `runRpc` and `RunRequest`.
  - Tasks 8, 9, 10 and 11 import them under these names.
  - The card's `RUN_STATE_LABELS` and `chipText` are keyed by `RunView["state"]`, which is `RunState` plus `unavailable`.
- `server/agent.ts` (Task 2): `AgentDirectory`, `parentAgentId` and `readAgentFacts`. Task 8 passes `paseo.agents` (`PaseoAgentActions`, `packages/client/src/index.ts:514`) as the `AgentDirectory`; it fits structurally, and Task 8's typecheck step confirms it without a cast.
- `server/locate.ts` and `server/files.ts` (Task 3): `claudeConfigDirs`, `projectSlug`, `locateRun`, `RunLocation`, `isMissing`, `isFileError`, `listNames`, `parseJson` and `isInside`. Tasks 5, 6 and 8 use them. `RunLocation.sessionId` is the session the run was found in; Task 8's `readRun` passes it to `hasLiveSession`, and `ReadRunInput` no longer carries the agent's current session id.
- `server/reader.ts` (Task 4): `newCursor`, `readNewLines`, `FileCursor`, `LineSink`, `ReadRequest` and `ReadResult`. Task 8's `JournalFile` and `AgentFile` each hold a `FileCursor`.
- `server/fold.ts` (Task 5): `newJournalFold`, `foldJournalLine`, `journalAgents`, `newAgentFold`, `foldAgentLine`, `isCandidateLine`, `AgentFold`, `JournalAgent`, `JournalFold` and `LastToolUse`, all imported by Task 8; `displayFile` is used inside `foldAgentLine` and by its own test.
- `server/state.ts` (Task 6): `hasLiveSession`, `readRecordFacts`, `RunRecordUnreadableError`, `decideRunState`, `RunStateInput` and `RunStatus`. Task 8 maps `RunRecordUnreadableError` to `run-unreadable`.
- `server/cache.ts` (Task 7): `createRunCache<State>({ create, now })` returns a `RunCache<State>` with `use(key, work)`. Task 8's entry builds it with `newRunFiles` and `Date.now`.
- `server/run.ts` (Task 8): `loadRun(request, environment)`, `newRunFiles`, `RunFiles` and `RunEnvironment`, used only by `index.server.ts` and the Task 8 test.
- `client/format.ts` (Task 10) exports the names `client/card.tsx` imports in Task 11, `refreshNote` included; the card no longer imports `REFRESH_FAILED`, which only `refreshNote` and the copy test use.
- `client/transform.ts` (Task 9) exports `transformWorkflowCall`, typed as the `tool_call` transformer that `index.client.tsx` registers with `addTimelineTransformer<"tool_call">`.
- Task 12 adds no export. Its test types the card as a `StreamItem`, whose `plugin` member is `PluginTimelineStreamItem` (`packages/app/src/types/stream.ts:810-823`); the app typecheck in its Step 8 covers the test.

## Critique log (2026-11-07)

1. Global Constraints, "Host memory": heavy commands took the lock with no `MemAvailable` check, and lint did not count as heavy. The constraint now gives the guarded form `flock /tmp/paseo-heavy.lock sh -c '<guard>' memory-guard <command>`, checked once the lock is taken, and the `MEMORY LOW` rule (wait, retry up to five times, then BLOCKED; never stop work you did not start).
2. Global Constraints and Tasks 1 to 11, all 27 `npx vitest` commands: lock without the guard. Guard added; Expected output is unchanged on success.
3. Tasks 1 to 11, all 11 plugins typechecks: lock without the guard. Guard added.
4. Global Constraints, Tasks 1 to 11 and the docs commit, all 13 commit commands: lock without the guard, though the hook's full typecheck is the heaviest command in the plan. Guard added.
5. Tasks 1 to 11, every format-and-lint step: `npm run lint` ran outside the lock. Lint now runs under the lock and the guard; formatting stays outside.
6. Task 13 Step 3: the server build and the dist test had no guard. Guard added, with how to read `MEMORY LOW` from the redirected output.
7. Task 13 Steps 1 and 8: Metro took the lock with no guard, and a refused start would have left the wait loop sitting for 900 s. The helpers define `HEAVY_GUARD`, which Metro's nested `sh -c` takes as an argument (nested quotes rule out the inline form); the wait loop also stops on `MEMORY LOW`; Metro starts without `DEV_PASSWORD`. Tested in /tmp with a stand-in `scripts/dev-app.sh`: the abort path still finds `scripts/dev-app.sh` in the session leader's cmdline.
8. Global Constraints, "Plan file": said the plan gets committed on `feat/claude-workflows`. The controller commits plans on `main` between plans, through the hook (gate plan `33559a68f`, spec `f798c56f2`); the constraint now says so.
9. Task 13 (new "Before Step 1"), Step 10 and Global Constraints: Steps 10 to 17 spent Claude usage without asking. The task now stops before Step 1 and asks, naming the agent's turns, the nine workflow agents, 30 to 45 minutes of the shared heavy lock, the memory, and a possible Ultra Code follow-up; Step 10 refuses to run without the yes.
10. Tasks 10 and 11, "Refresh failed": the spec's rule lived inline in the card, which has no test. `refreshNote(view, failed)` in `client/format.ts` now holds it, with a test (Task 10 goes from 11 to 12 tests); the card renders its result and no longer imports `REFRESH_FAILED`.
11. File Structure, Task 13 Step 2 and the docs task's Files and Step 1: the paragraph went in after the "Local runs of" test-run note, which split the built-in descriptions. It now goes before the first line of "Local runs of `scripts/builtin-plugins-dist.test.mjs` and", which sub-projects 2, 3 and 5 keep when they reword that paragraph; Step 2 checks that line. A dry run on a copy of `docs/plugins.md` inserted 12 lines.
12. Global Constraints (new "Line citations"): `file:line` citations into `session.ts`, `daemon-client.ts` and `agent-manager.ts` will move once sub-projects 3, 4 and 5 land. The constraint says to find the symbol named next to the line; no edit anchors on a line number.
13. Task 6, test "ignores other sessions, key files, garbled files and exited processes": the key file was named `<pid>.key`, while Claude Code names them `<pid>.<64 hex>.key`. The fixture uses the real shape.
14. Task 6, `readSessionFile`: its comment said a session file is removed when its process exits, but 91 of 99 files under `~/.claude/sessions` belong to dead pids. The comment now says liveness comes from `/proc`.
15. Task 13, **Card read**: the 65 s "same string" checks of Steps 13 and 18 ignored React Query's refetch when the page turns visible or a card mounts again, which moves a finished card's ages once. A comparison now counts only with no tab switch and no reopened turn between its two reads.
16. Task 13, size: the opt-in live run and the docs shared one task, so a declined or aborted run held up the docs. The docs are Task 14 (Steps 1 to 4, commands unchanged), Task 13 ends with Step 23 (scratch files and the report), and every reference moved with them (ground rules, Step 2, Decision 22, Global Constraints, Self-Review), as the controller ruled for plan 5's Task 11.
17. Self-Review: the `daemon.manage` row said the rule goes untested, though the host tests it, and the "Refresh failed" row cited only card code. The rows now cite `operation-permissions.ts`, the `session.test.ts` case and Task 10's `refreshNote` test; the gaps and type-consistency lines follow.

Checked without change: the plugin, client, protocol, server and app anchors on this checkout; every Expected FAIL text and test count; Claude Code's journal, agent, record and session files (keys, types, `type`, `status` and timestamps only) against Decisions 2 and 6 to 11; zod 4 `.catch` on missing keys; the CLI flags Task 13 uses; the registry anchor `"claude-usage-source",`, which survives sub-projects 2 to 5; the journal exists 0.2 to 1.0 s before the launch result, so a card never reads ahead of it.

## Open for the controller

1. **Collapse turns hides a running card (user decision).** In the default Chat display, a turn that launches a workflow folds once it ends, whenever it also sent a message or called a tool before its reply, which is the usual case. The folded card unmounts, so it shows nothing and polls nothing until the user opens the turn (Decision 22; `packages/app/src/agent-stream/turn-collapse/model.ts:99` and `:116-162`).
   - A. Accept, as the plan stands. Cost: none in code; the live card is out of sight for most runs while they run, and the docs paragraph tells users to open the turn.
   - B. Keep plugin rows out of the fold: `staysVisibleWhenCollapsed` also returns true for `item.kind === "plugin"`. Cost: one line in `model.ts`, one case in `model.test.ts` beside the compaction case (line 91), one sentence under "Contribute timeline items" in `docs/plugins.md`, and the Collapse sentence leaves this plan's paragraph. Every plugin's rows then stay visible in a folded turn, rows that replace tool calls or reasoning included; today only the `timeline-items` and `inline-thinking` examples make such rows, and no built-in does.
   - C. Opt in per renderer: a `staysVisibleWhenCollapsed` flag on `addTimelineRenderer`, kept by the app's renderer registry and passed to `collapseTurns` as a predicate. Cost: about 40 to 60 lines over the `packages/plugin` contracts, the app registry, `presentation.ts` and `model.ts`, two tests, `docs/plugins.md` and `public-docs/plugins/reference.md`. Other plugins' rows keep folding.
   - Recommendation: B, as its own app task before Task 13, once the user approves an app change in this sub-project; C if other plugins' rows must keep folding. Task 13's **Open folded turns** procedure works under all three.
   - Answered by the user on 2026-11-07: B. Task 12 makes the change and adds the docs sentence; Task 13 no longer opens folded turns, and its Step 12 checks that a card in a folded turn stays in view and keeps polling.
2. **Task 13's live run needs the user's yes (user decision).** The plan stops before Task 13 Step 1. Cost: five to seven short Sonnet turns of one test agent and nine Sonnet workflow agents; 30 to 45 minutes in which Metro holds `/tmp/paseo-heavy.lock` for every session that uses it; about 4 GB of memory. If the agent offers no Workflow tool, a second question follows: Ultra Code, which needs a model with an `xhigh` effort level and costs more per turn. Options: yes; or no, and Task 13 reports its checks as not run while Task 14 still lands the docs. Recommendation: ask while Tasks 1 to 11 run, so Task 13 does not wait on the answer.
   - Answered by the user on 2026-11-07: yes, run it.
3. **A new Claude session id hides earlier runs (controller).** The lookup follows only the agent's current session id (spec, Server 1). A `/clear` sent to Claude Code, or a hook that restarts it, gives the agent a new session id (`packages/server/src/server/agent/providers/claude/agent.ts:5090-5100` and `:5136-5146`); the earlier Workflow cards stay in the timeline and show "Run files not found" at their next mount.
   - A. Accept. Cost: none.
   - B. When the current session holds no such run, look for the run id in every session dir under the agent's project slug in each config dir, and check liveness against the session it was found in. Cost: about 20 lines in `locate.ts`, two tests in Task 3 and one in Task 8; a deviation from the spec's lookup.
   - C. Carry the launching session id from the result's `Transcript dir:` line in the plugin item. Cost: the item schema, transformer, RPC input and locator change, with tests in Tasks 1, 3, 8 and 9, and the RPC then takes an id from the app.
   - Recommendation: B, ruled before Task 3 starts.
   - Answered by the user on 2026-11-07: B, a spec deviation (Decision 5). Task 3 searches the slug's other sessions, with two tests; Task 8 asks about the process of the session the run was found in, with one test; Task 13 Step 17 meets it if the reload changes the session id.
4. **Spec deviations the plan keeps (controller).** Approve all, or go through them. Reverting one costs its code and tests in the task named.
   - Decision 3: no provider check; the transformer test covers other result shapes instead of other providers, since a transformer sees no provider (Task 9).
   - Decision 4: a `refresh()` that throws fails the RPC, so the card shows "Refresh failed" and keeps polling, instead of Unavailable, which would stop polling for good on a transient error (Tasks 2 and 8).
   - Decision 9: a record over 16 MiB or without a string `status` gives `run-unreadable`; JSON that does not parse counts as not written yet (Task 6).
   - Decision 10: a record more than 1 s older than the journal belongs to an earlier attempt and is ignored, so a resumed run shows Running (Task 6).
   - Decision 11: until the newest agent writes, its start is the journal's mtime (Tasks 6 and 8).
   - Decision 16: a first load that fails does not poll; the next mount, or the page turning visible again, retries (Tasks 10 and 11).
   - Decision 19: the "RPC handler with a fake `paseo`" test calls `loadRun` with an in-memory `AgentDirectory`, since faking `PluginServerContext` would need a cast (Task 8).
   - Decision 20: "a run from before the plugin existed" is checked as runs read after a dev daemon restart (Task 13 Step 18).
   - Recommendation: approve all; each keeps the card polling through transient errors or the tests free of casts.
   - Answered by the user on 2026-11-07: all approved, with item 3's B as a ninth. Each decision's title says so, and `.superpowers/plan-drafts/claude-workflows-spec-amendment.md` states the nine in the spec, for the controller to apply before the plan is built.
5. **Liveness reads Linux `/proc` (controller).** The spec requires it. On a daemon without `/proc`, such as a macOS desktop host, a run without a record shows Stopped while it runs, and its card stops polling. Options: accept, since the fork's daemons run in Linux containers and the docs paragraph says so; or a fallback that counts a live pid (`process.kill(pid, 0)`) whose session file started before the newest agent, without the start-time check, through a new port so tests stay off the real process table (about 15 lines and two tests in Task 6). Recommendation: accept.
6. **The run record is parsed on every call while it exists (controller).** A resumed run that is Running keeps the earlier attempt's record, so each 3 s poll reads and parses it again. Real records reach 662 KB; `JSON.parse` takes 0.6 ms on a synthetic 662 KB record and 34 ms at the 16 MiB cap. Options: accept; or keep the parsed facts in the cache entry, keyed by the record's size, mtime and inode (about 15 lines and one test in Task 8). Recommendation: accept.

### Controller rulings (2026-11-07)

- Item 5 (liveness reads Linux `/proc`): accepted as the plan stands — the spec requires `/proc` liveness and the fork's daemons run in Linux containers; the docs paragraph names the limit — cost if wrong: a macOS daemon shows Stopped for a running run with no record, and its card stops polling; the fallback is ~15 lines and two tests in Task 6.
- Item 6 (record parsed on every call while it exists): accepted — 0.6 ms at the largest real record (662 KB), 34 ms at the 16 MiB cap, once per 3 s poll per open card — cost if wrong: one cached parse keyed by size, mtime and inode (~15 lines, one test in Task 8).
- Items 1, 2, 4 and the spec-deviation half of item 3 go to the user (scope, usage cost, spec changes); recorded here when answered.

### User answers (2026-11-07, AskUserQuestion)

1. Collapse turns: **B, keep plugin rows unfolded.** `staysVisibleWhenCollapsed` (`packages/app/src/agent-stream/turn-collapse/model.ts`) also returns true for `item.kind === "plugin"`, with one case in `model.test.ts` beside the compaction case and one sentence under "Contribute timeline items" in `docs/plugins.md`; its own app task before the manual test (Task 13), and the Collapse sentence leaves this plan's docs paragraph. Pending: amend the plan (new task, Task 13's folded-turn procedure, Self-Review).
2. Live manual test: **yes, run it** (Task 13 as planned; the Ultra Code question still comes first if the test agent offers no Workflow tool).
3. Spec deviations: **all nine approved** — Decisions 3, 4, 9, 10, 11, 16, 19, 20, and item 3's option B (look for the run id in every session dir under the agent's project slug in each config dir when the current session holds none; liveness against the session it was found in; ~20 lines in `locate.ts`, two tests in Task 3, one in Task 8). Pending: amend the plan (Task 3, Task 8, Decisions) and state the nine in the spec before building 8.

### Amendments for the user's answers (2026-11-07)

1. Decisions 3, 4, 9, 10, 11, 16, 19 and 20: each title now says "spec deviation, approved by the user on 2026-11-07". Decision 11 also asks about the session the run was found in, in the `sessions` dir of the config dir that holds it.
2. Decision 5 (item 3, B, approved the same day and marked so inline): when no config dir holds the run in the agent's current session, the locator tries every other session dir under `projects/<slug>/`, config dir by config dir. It reads only the names in that dir, keeps those in the session id format, never opens a `*.key` file or `.credentials.json`, and keeps the realpath containment of the session dir and run dir inside the config dir. The Architecture line says so.
3. Task 3: `RunLocation` gains `sessionId`; `locateRun` gains a second pass, `locateInOtherSessions`; `makeRun` and `location` in the test take a session id. Two tests: "tries the slug's other sessions once no config dir has the run in the current one" (an earlier session's run is found, and the current session in a later config dir still wins over it), and "finds no other session's run outside the slug, in a dir not named as a session, or outside the config dir". Step 8: 11 tests become 13.
4. Task 8: `readRun` asks `hasLiveSession` about `location.sessionId`, and `ReadRunInput` drops the agent's session id. One test, "loads a run from the agent's earlier session and checks that session's process": the agent's snapshot names a later session, only the run's own session has a live process, and the view is Running. Step 4: 14 tests become 15 (as root, 14 pass and 1 is skipped). Its Consumes line names `RunLocation.sessionId`.
5. New Task 12, "Keep plugin rows in view in folded turns" (item 1, B): an anchor check, then a failing case after the compaction case in `model.test.ts` (13 cases become 14), the one-line change to `staysVisibleWhenCollapsed`, and the sentence at the end of "Contribute timeline items" in `docs/plugins.md`, all in one commit, with app format, lint, typecheck and commit under the heavy lock and the memory guard, the test from `packages/app` with `--bail=1`, and the tatsuya identity by explicit pathspec. Every cited app line was checked on this checkout, whose app files and `docs/plugins.md` match `main` (`33559a68f`).
6. Renumbering: the manual test is now Task 13 and the docs paragraph Task 14. Every reference moved with them: Global Constraints, Decisions, File Structure, Consumes lines, step cross-references, Self-Review, the Critique log and "Open for the controller".
7. Decision 22 is rewritten for B, the File Structure lists the two app files and the docs sentence, and Global Constraints say where Task 12's test runs and how its anchors are checked.
8. Task 13: Consumes adds Task 12; each launch prompt runs `pwd` first, since a plugin row is no work and the launch turn folds only around real work; the **Open folded turns** procedure gives way to the rule **Folded turns stay folded**; Step 12 expects one folded turn and a card that keeps polling inside it, with what a hidden card (a Task 12 failure) or an unfolded turn (check not reached) means; Steps 13, 15, 17 and 18 read cards without opening turns; Step 17 counts session changes, expects the other-session search when the reload changed the session id, and treats `run-not-found` there as a Task 3 failure; Step 23 reports the folded-turn check and that count; the cost note names the `pwd` calls.
9. Task 14: the Collapse turns sentence leaves the paragraph, "for the session" becomes "for the run's session", and the paragraph is ten lines, so Steps 1 to 3 expect `1 file changed, 11 insertions(+)`; Step 1's list of gotchas drops the folded turn.
10. Self-Review: coverage rows for the found session, the other-session search, the fold and the docs sentence; the folded-turn gap rewritten; a new gap for an earlier session's run kept under another project dir; type consistency for `RunLocation.sessionId` and Task 12's test. Items 1 to 4 of "Open for the controller" each carry the user's answer.
11. Spec: `.superpowers/plan-drafts/claude-workflows-spec-amendment.md` states the nine deviations and the app change in eleven old and new blocks, for the controller to apply before Task 1. Each old block matches the spec once, on `main` and in this checkout, also after the blocks before it are applied. Its format run was not tried.

Left as they were: Task 13's "Before Step 1" question, which the user has answered yes, so the controller can relay that answer; and the Critique log's counts, which describe the plan as it stood then (27 vitest commands, a 12-line paragraph).
