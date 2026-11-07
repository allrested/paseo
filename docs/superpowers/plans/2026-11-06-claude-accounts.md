# Claude Accounts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Manage several Claude Code logins from Paseo: list every profile with its login, usage and agents, add an account that shares the main profile's setup, pick the account new Claude agents start on (including Auto by headroom), and move all idle agents off one account in one action.

**Architecture:** A built-in fork plugin `plugins/claude-accounts/` runs in the daemon process. Its server side discovers `~/.claude` and `~/.claude-<name>` profiles, links the shared setup into accounts it adds, keeps their user-scope `mcpServers` equal to the main profile's with a polled, self-healing sync, rewrites plain `claude` agent creations through one `agent.create.before` hook, and moves idle agents one at a time through a new `PaseoAgentHandle.move()`. Usage per account comes from a new daemon RPC that reads one provider's launch scope, the same lookup the move dialog uses. The client side is one plugin screen opened from a sidebar footer item and a Command Center item.

**Tech Stack:** TypeScript (NodeNext, strict), zod 4, `@getpaseo/plugin` server and client SDK, `@getpaseo/client`, `@getpaseo/protocol`, React Native plugin UI kit with `@tanstack/react-query`, Vitest, Node 22 `fs/promises`.

**Spec:** `docs/superpowers/specs/2026-11-06-claude-accounts-design.md`

## Global Constraints

- **Host memory.** The 16 GB host froze on 2026-11-06 from parallel heavy commands. Run every typecheck, vitest run, build, npm install and `git commit` (its lefthook pre-commit hook typechecks every workspace) under `flock /tmp/paseo-heavy.lock`. Typecheck with `--singleThreaded`. Never run a whole workspace test suite.
- **One test file per run:** `flock /tmp/paseo-heavy.lock npx vitest run <file> --bail=1`. Plugin tests (server and client side) run from the repo root, whose `vitest.config.ts` maps `react-native` to `react-native-web`; server tests run from `packages/server`; protocol and SDK tests run from `packages/protocol` and `packages/client`, as their `npm test` scripts do.
- **Builds feed the typechecks.** Protocol and client types resolve through their `dist` declarations. After editing `packages/protocol` or `packages/client`, run `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run build:client` (protocol, relay, client) before typechecking or testing any package that imports them, the plugins workspace included.
- **Pre-commit hook stays on.** Every commit runs the lefthook hook (format, lint, full typecheck) under the heavy lock. `LEFTHOOK=0` is not approved for this plan and is never offered as an option. If the hook fails in a workspace the task did not touch, stop and report the hook output.
- **Daemon:** never restart, stop or signal the Paseo daemon on port 6767, and never write under `~/.paseo`. No task starts a dev daemon: the user skipped the manual run (Decision 21).
- **Commits:** local only, never push (a push to `main` redeploys every instance through Dokploy). Author and committer `tatsuya <allrested@gmail.com>`, overriding the container's M-DAQ `GIT_*` env for that command only, and every commit ends with an explicit pathspec so files another session staged in this shared checkout stay out:
  `flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "<message>" -- <paths>`
  Each task's verify step then compares author and committer with that identity and prints `fork identity` or `WRONG IDENTITY`, never the address.
- **Status checks** are scoped to `plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk`, because the plan file itself may sit untracked in the checkout until someone commits it.
- **Built-in import rules:** server files import only `@getpaseo/plugin/*`, `zod` and `node:*`; client files only `@getpaseo/plugin`, `@getpaseo/plugin/client*`, `react`, `react-native`, `@tanstack/react-query` and `zod`; `shared/` only `@getpaseo/plugin` and `zod`. Relative imports carry a `.js` suffix (NodeNext). Types from `@getpaseo/client` are reached through `PluginHandlerContext["paseo"]`, never imported.
- **In-process safety.** The plugin runs inside the daemon, and an uncaught exception or unhandled rejection exits the daemon. Every timer callback and fire-and-forget promise is guarded. The `agent.create.before` hook never throws: a failure keeps plain `claude`.
- **Files the plugin may write.** It never writes into the main profile and never deletes a profile file. It writes only: an account directory and its links, created by Add account (never over an existing path); the `mcpServers` key of the config file of an account recorded by Add account, through a temp file beside it and under Claude Code's own `<file>.lock` directory, which it removes again; and its record `<PASEO_HOME>/claude-accounts/added.json`.
- **No secrets in files, logs or chat.** `mcpServers` entries can hold tokens in `env` and `headers`: never print or log their values; tests compare them with `toEqual` on fixtures. Never print `config.json`, `~/.claude/settings.json`, any `.credentials.json` or `PASEO_PASSWORD`. Never run `ps` or `pgrep` with `-a` or `-f` against Claude processes, whose arguments hold bearer tokens.
- **Protocol compatibility** (`docs/protocol-compatibility.md`): new fields are optional, nothing narrows, the SDK gates the new RPC once on `server_info.features.usageProviderReports` and `move()` once on `features.agentMove`, and every delta carries a `Fork delta (claude accounts)` comment. Each of those two gates, and the new flag in `messages.ts`, also carries a tag in the doc's format, `// COMPAT(<name>): added after v0.15.2 (fork); remove gate after 2027-05-07.` (six months out, the doc's default, and the date sub-project 4 uses), so `rg "COMPAT\("` lists them. New RPC names are dotted (`docs/rpc-namespacing.md`).
- **Typing and tests.** No `as` casts that bypass a type error. `plugins/tsconfig.json` excludes `*.test.ts`, so no typecheck sees a plugin test: declare every fixture with an explicit type anyway (`const x: Profile = ...`), so the editor's checker and the reader see which contract it fills, and never widen one with a cast. New test files use injected dependencies and real temp directories, never `vi.mock`, `vi.spyOn` of the plugin's own modules, fake timers or another monkey-patched global (`docs/testing.md`, "Two test categories, no others"). A timeout is a dependency: inject it and test it with a short real one.
- **Destructive UI.** The plugin SDK has no confirm dialog, so Move idle agents arms on the first press and runs on a second press within 5 s, the pattern of `plugins/shared-mcp/client/definitions-screen.tsx` `ResetAction`.
- **Copy** (`docs/design.md` §10): sentence case; in-flight labels end in a literal `...`, never `…`; no trailing period on a label, button or single-clause hint; multi-sentence prose keeps its periods.
- **Formatting and lint:** `npm run format:files -- <paths>` and `npm run lint -- <paths>` from the repo root. The lint config forbids inline objects, arrays and functions as JSX props (`react-perf/*`), object spread inside `.map` callbacks (`oxc/no-map-spread`), nested ternaries, and callbacks nested deeper than 3.

---

## Cross-plan interfaces

These come from sub-project 4, the usage heads-up plan draft `.superpowers/plan-drafts/2026-11-06-usage-heads-up.md`. The fork program lands sub-project 4 before this one, so Task 1 imports its exports and checks first that they are there. A built-in plugin cannot import `@getpaseo/protocol`, so the plugin mirrors nothing from that plan: it reads the tightest window and its heads-up tone from the daemon.

| Interface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Produced by (sub-project 4) | Used here                                                                                                                                                                                                                                                                                           | What the controller reconciles                                                                                                                                          |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usageHeadsUpTone` and its danger thresholds (`USAGE_DANGER_PCT = 95`, `RUN_OUT_DANGER_MS = 30 * 60_000`) in `packages/protocol/src/usage-heads-up.ts` (`@getpaseo/protocol/usage-heads-up`)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Task 1                      | Task 1's `tightestUsageWindow` returns the tightest window's tone, and Task 7's `chooseAuto` skips an account whose tone is `danger`: 95% or more, or on pace to run out within 30 minutes (the user's answer of 2026-11-07, Decision 12). The plugin keeps no copy of either threshold.            | None: the daemon judges the tone.                                                                                                                                       |
| `chooseTightestWindow(windows, now)` in `packages/protocol/src/usage-heads-up.ts`: heads-up tone, then `usedPct` descending, then the sooner `runsOutAt`; their `toMoveTarget` calls it                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Task 1                      | Task 1's `tightestUsageWindow(reports, now)` calls it on the provider's available windows, so the accounts screen, Auto and the move dialog name the same window, such as a 60% window that runs out in 20 minutes over a 75% one that will not.                                                    | None: one function serves both.                                                                                                                                         |
| `sharedMoveTargetUsage: MoveTargetUsageLookup` in `packages/server/src/server/agent/session-move/list-move-targets.ts`, replacing the module constant `moveTargetUsage` in `session.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Task 3                      | Task 1 Step 12 passes it to `UsageSession` as `scopeLookup`, so the move dialog and the accounts screen share one 60 s cache per provider, keyed by provider id. Their Task 3 already imports it into `session.ts`.                                                                                 | None.                                                                                                                                                                   |
| `interface UsageScopeQuery { provider: string; env: Record<string, string> }` and `type MoveTargetUsageLookup` in `list-move-targets.ts`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Task 3                      | Task 1 imports both into `usage-session.ts` instead of declaring copies.                                                                                                                                                                                                                            | None.                                                                                                                                                                   |
| Projected `runsOutAt` and `shortfallPct` on `UsageReportEntry` windows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Task 2                      | The new RPC returns raw reports, so the fields pass through untouched; `tightestUsageWindow` reads `runsOutAt` for the tone                                                                                                                                                                         | The accounts screen shows no run-out, so `UsageTightestWindowSchema` carries none.                                                                                      |
| `paseo.providers.listUsage` (`packages/client/src/index.ts:483`), the legacy host-wide list                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | existing                    | Not used: Decision 1 reads each account through `listUsageForProvider`. The legacy RPC's daemon side is tagged `COMPAT(providerUsageList)` for removal after 2027-03-26 (`packages/server/src/server/session/usage/usage-session.ts:50`; the SDK's own gate, `index.ts:1109`, is tagged 2027-02-28) | Settled: the user chose `listUsageForProvider` on 2026-11-07 (Decision 1).                                                                                              |
| `agent.move` RPC with `continueWork`, sent by `DaemonClient.moveAgent(agentId, { provider }, { continueWork })`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | existing                    | Task 2's `PaseoAgentHandle.move({ to, continueWork })` sends the same RPC                                                                                                                                                                                                                           | None.                                                                                                                                                                   |
| `chooseBestMoveTarget`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Task 1                      | Not used: Auto has its own rule (Task 7), which also falls back to plain `claude`                                                                                                                                                                                                                   | Keep them separate.                                                                                                                                                     |
| `server_info.features.usageHeadsUp`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | Tasks 1 and 3               | Not used                                                                                                                                                                                                                                                                                            | None.                                                                                                                                                                   |
| Edits to shared files, by line on `main` at `f798c56f2` (every step anchors on text, so the other plan's shifts do not matter). `packages/protocol/src/messages.ts`: both insert a `features` flag right after `agentMove: z.boolean().optional(),` (3798); theirs also edits `AgentMoveTargetSchema` (2177-2185), the attention reason (5084-5103) and the type exports near 7508; this plan adds the request after 1895, an inbound union entry after 3476, the response schemas after 6640, an outbound union entry after 7373 and type exports after 7563. `packages/server/src/server/session.ts`: theirs changes the imports (119-122, 155-161), deletes the `moveTargetUsage` constant (314-315) and moves `listMoveTargets` and `moveTargetUsageWindows` (3029-3076) to `list-move-targets.ts`; this plan replaces the `UsageSession` construction (1102-1107), adds a dispatch case after 3485-3486, and passes their `sharedMoveTargetUsage`. `packages/server/src/server/websocket-server.ts`: both add a flag after `agentMove: true,` (2018) | Tasks 1 and 3               | Tasks 1 and 2                                                                                                                                                                                                                                                                                       | Textual: adjacent inserts only; this plan lands second and inserts after the other's line. Semantic: none, since Task 1 Step 12 passes the lookup their Task 3 imports. |

## Decisions the spec leaves open

The user approved Decision 1 and the seven spec deviations (Decisions 6, 9, 10, 12, 13 and 20, and the native-move fallback in Decision 14) on 2026-11-07, and chose Auto's `danger` rule (Decision 12). `.superpowers/plan-drafts/claude-accounts-spec-amendment.md` holds the spec text that states them; the controller applies it to the tracked spec before Task 1 runs.

1. **Usage per account (spec deviation, approved by the user on 2026-11-07).** The spec says the Auto choice reads usage "through `paseo.providers.listUsage`". That is the legacy host-wide list: one entry per usage source and login (`displayName` "Claude (\<label\>)"), with no link to a profile directory, and it is tagged `COMPAT(providerUsageList)` for removal after 2027-03-26. In this container the main profile's `.claude.json` has no `oauthAccount`, so even matching by email fails. The plan adds a daemon RPC `usage.provider.list_reports.request` (`{ provider }` → `{ provider, reports, tightest, error }`) that reads one provider's launch scope exactly as the move dialog does (`listReportsForScope` with the provider's family and env, the shared 60 s cache and 5 s timeout), and an SDK method `paseo.providers.listUsageForProvider(provider)`, gated on `server_info.features.usageProviderReports`.
2. **Tightest window.** The daemon computes it: `tightestUsageWindow(reports, now)` hands the windows of the provider's available reports to sub-project 4's `chooseTightestWindow`, which ranks them by heads-up tone, then by used share (`usedPct` or `100 - remainingPct`), then by the sooner run-out, the rule the move dialog uses. It returns the window's label, used share and reset, and its heads-up tone (`none`, `warning` or `danger`), required on the wire: the schema is new, so no older daemon sends a window without one, and a window with no tone would pass Auto's danger check. The plugin never re-implements a ranking or a threshold, so a change to either lands in sub-project 4's function only.
3. **Names and providers.** An account name matches `^[a-z0-9]+(?:-[a-z0-9]+)*$` and is at most 32 characters, so `claude-<name>` is a valid provider id (`/^[a-z][a-z0-9-]*$/`). Its directory is `~/.claude-<name>`, its provider `claude-<name>` with label `Claude (<name>)`. A `~/.claude-*` directory whose suffix does not match is not listed. Accounts map to providers by that id; a `claude-<name>` entry that does not extend `claude`, is disabled, or points `CLAUDE_CONFIG_DIR` elsewhere is shown as a problem on the row and never rewritten.
4. **Main profile.** The daemon's `CLAUDE_CONFIG_DIR` when set (this container sets it to `/home/paseo/.claude`), else `~/.claude`, the same rule as `claudeConfigDir` in `packages/server/src/server/agent/providers/claude/project-dir.ts:120`. Accounts always live in the home directory.
5. **Config file.** Claude Code's rule: `<configDir>/.config.json` when it exists, else `.claude.json` inside `CLAUDE_CONFIG_DIR`, or in the home for a main profile launched without the variable.
6. **Which profiles Paseo writes into (spec deviation, approved by the user on 2026-11-07).** Only profiles added through Add account on this host, recorded by name in `<PASEO_HOME>/claude-accounts/added.json` (`{ "version": 1, "names": [...] }`, mode 0600). A profile made by hand is listed with the problem "Paseo did not add this account, so it shares nothing with the main account. Add it again under the same name to share the main account's setup.", and adding the same name adopts it. Reasons: the plugin never writes into files nobody handed to Paseo, and every built-in also starts inside `scripts/builtin-plugins-dist.test.mjs`, `lifecycle.e2e.test.ts` and the packaged-app smoke with the real `HOME`; with an empty record those runs write nothing.
7. **`mcpServers` sync.** Replace semantics: the account's top-level `mcpServers` becomes a copy of the main profile's, removals included; every other key stays. Every 5 s a pass re-reads the main file and each recorded account's file (both are small) and writes only when the two `mcpServers` values differ as canonical JSON (keys sorted). To write, it takes Claude Code's own write lock, the `<file>.lock` directory that proper-lockfile creates with `mkdir`, re-reads the file under it, writes through a temp file and `rename` (keeping the file's mode, 0600 for a new file) and removes the lock. A lock it did not take means Claude Code is writing, so the pass skips that account and the next pass retries; a lock older than a minute is reported on the row and left alone. It never writes when the main file is missing or unreadable, and it reports, never writes, an account file that is a symbolic link or not valid JSON. A Claude Code write that drops the copy is undone at the next pass. Only the user-scope `mcpServers` key is copied: project-scope servers (`.mcp.json`, and `projects.<path>.mcpServers` inside `.claude.json`) stay per account.
8. **Links.** Absolute symbolic links from the account to `settings.json`, `CLAUDE.md`, `skills`, `plugins`, `commands` and `agents` in the main profile. Add account creates them; nothing else does, so an entry the main profile gains later is shown as "not shared yet" until the account is added again. An existing path is never replaced (`symlink` refuses with `EEXIST`, which the plugin treats as "keep"). Add account is refused on Windows ("Adding accounts needs macOS or Linux").
9. **Signed in (spec deviation, approved by the user on 2026-11-07).** `.credentials.json` exists in the profile, or the usage source reports any login for the provider's scope (macOS keeps the login in the Keychain, where the plugin cannot look). Expired means no available report and an `expired` or `rejected` problem. The row offers Sign in when the profile is not signed in or its login expired. `claude auth status` would answer exactly, but it starts a Claude Code process per account on every 5 s poll, so the list does not use it.
10. **Login terminal (spec deviation, approved by the user on 2026-11-07).** `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT -u CLAUDE_CODE_SSE_PORT -u CLAUDE_AGENT_SDK_VERSION CLAUDE_CONFIG_DIR=<dir> claude auth login`, named `Claude sign-in: <name>` (`Claude sign-in` for the main account). `claude auth login` exists in Claude Code 2.1.293 (probed with `claude auth login --help` on 2026-11-07) and signs in without starting a chat session. `CLAUDE_CONFIG_DIR=<dir>` is passed for every account, and for the main account only when the daemon itself sets the variable. The `-u` list is `PARENT_SESSION_ENV_VARS` (`packages/server/src/server/agent/provider-launch-config.ts:211`): a daemon started from a Claude session would otherwise make `claude` refuse to start. A Paseo terminal needs a workspace, so it opens in the most recently active one (`workspaces.list` sorted by `activity_at`), and the screen navigates there. With no workspace the action fails with "Open a project first. The sign-in terminal runs in a workspace." `claude` must be on the daemon's `PATH`. Adding an account that is already signed in opens no terminal.
11. **Default account.** Plugin settings `{ defaultAccount }`, one of `auto`, `claude` or `claude-<name>`, default `claude`, so nothing changes until the user picks. It applies only when an agent is created with provider `claude`. An explicit default that is not usable (no provider, signed out, expired) keeps plain `claude`. A hook failure keeps plain `claude`.
12. **Auto (spec deviation, approved by the user on 2026-11-07).** Candidates are profiles whose provider is ready, signed in and not expired, with a known `usedPct`, whose tightest window does not have the `danger` tone: 95% or more, or on pace to run out within 30 minutes (sub-project 4's `usageHeadsUpTone`). The spec says 95% or more; the user chose to skip a 30-minute run-out too. The daemon judges the tone (Decision 2), so the plugin holds neither threshold. The lowest `usedPct` wins; ties keep list order (main first, then accounts by name). Unknown usage, including a lookup slower than 5 s, is not a candidate, so with usage off Auto always keeps plain `claude`. No candidate keeps plain `claude`.
13. **Handoff guard (spec deviation, approved by the user on 2026-11-07).** A native move that falls back to a history handoff creates its successor through `agent.create.before` with the target provider. While this plugin moves an agent to plain `claude`, the hook keeps `claude` for creations in that agent's `cwd`, so the agent lands where the user asked. Moves to plain `claude` started elsewhere (Move dialog, CLI) that fall back to a handoff still go through the default account; `docs/plugins.md` says so (Task 11 Step 1).
14. **Idle.** Status `idle`, `error` or `closed`, with no active turn and no pending permission. Agents on the source that are not idle when the job starts stay where they are and are counted as `busy`, the spec's "skipped and counted". Each idle agent is checked again right before its move, and one that started a turn since is skipped (`skipped`), never interrupted. Background and internal agents are neither counted nor moved. Moves run one at a time in the background, with `continueWork: false`; the RPC returns the job at once and the screen polls it, because a plugin RPC times out after 60 s on the client (`DEFAULT_SESSION_RPC_TIMEOUT_MS`). A move the daemon cannot do natively falls back to a history handoff, as a move from the Move dialog does, and the job counts it in `handedOff`; the spec says "natively" (spec deviation, approved by the user on 2026-11-07).
15. **Move targets.** Any other profile whose provider is ready, signed in and not expired. One move job runs at a time per daemon. Background shells, `Monitor` watches and background subagents live in the Claude process and stop when an idle agent moves; the confirm hint says so.
16. **Agents on a row.** `total` is every non-archived foreground agent on the profile's provider; `busy` the ones in a turn. Shown as "No agents", "1 agent" or "3 agents, 1 in a turn".
17. **Where the screen lives.** A plugin screen (`addScreen`) opened from a sidebar footer item, which shows by default and works without a workspace, plus a global Command Center item for keyboard access.
18. **Hook budget.** The daemon fails a creation whose before-hook throws (`packages/server/src/server/plugins/runtime.ts:637-643`) or takes longer than `REQUEST_TIMEOUT_MS`, 30 s (`runtime.ts:45`). The hook catches everything and gives its choice 10 s (`DECIDE_TIMEOUT_MS`), then keeps plain `claude`; each usage lookup inside has the daemon's own 5 s cap.
19. **Provider problems.** A row shows a problem, never a rewrite, when its provider entry is missing (accounts only), does not extend `claude`, is turned off, or sets a `CLAUDE_CONFIG_DIR` other than the account's directory (the main account included, whose built-in `claude` entry may carry an `env`), and when the provider snapshot reports `error` or `unavailable`. A provider still `loading` is simply not ready. The first usage lookup error, such as "Usage is off on this host.", shows once above the rows as `usageError`; a row without usage reads "Usage unknown".
20. **Row label (spec deviation, approved by the user on 2026-11-07).** The account's name (the `<name>` of `~/.claude-<name>`) or "Main account", with the full directory in the row's hint. The spec allows "email or directory name"; the plan never shows an email, because the main profile in this container has no `oauthAccount` in its `.claude.json` (Decision 1), so rows would mix emails and names, and an email would also put an address on screenshots.
21. **No manual run.** The user skipped the manual test on 2026-11-07, so Task 11 is the docs task alone, and Tasks 1 to 11 start no dev daemon, sign in no second login and spend no Claude turn. The unit tests of Tasks 1 to 10 and each task's typecheck are the proof. The real `config.patch`, the provider launch and the sign-in terminal first meet a daemon when sub-project 6 rolls the accounts out (Task 12). Task 10's rows keep their test ids for a later manual run.

---

## File Structure

| File                                                                 | Status | Responsibility                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/protocol/src/messages.ts`                                  | Modify | `usage.provider.list_reports` request and response schemas, `UsageTightestWindowSchema`, union entries, `features.usageProviderReports`                                                               |
| `packages/protocol/src/messages.usage-provider-reports.test.ts`      | Create | Schema tests for the new messages and the features flag                                                                                                                                               |
| `packages/protocol/tests/validation/ws-outbound.test.ts`             | Modify | The generated outbound validator accepts the new response                                                                                                                                             |
| `packages/server/src/server/session/usage/usage-session.ts`          | Modify | `handleProviderReports` and `tightestUsageWindow`, which calls sub-project 4's `chooseTightestWindow`; `UsageScopeQuery` and `MoveTargetUsageLookup` come from sub-project 4's `list-move-targets.ts` |
| `packages/server/src/server/session/usage/usage-session.test.ts`     | Modify | Tests for the new handler                                                                                                                                                                             |
| `packages/server/src/server/session.ts`                              | Modify | Pass the scope resolver and shared lookup to `UsageSession`; dispatch the new request                                                                                                                 |
| `packages/server/src/server/websocket-server.ts`                     | Modify | Advertise `usageProviderReports: true`                                                                                                                                                                |
| `packages/server/src/server/authorization/operation-permissions.ts`  | Modify | `daemon.read` for the new request and response                                                                                                                                                        |
| `packages/client/src/daemon-client.ts`                               | Modify | `listProviderUsageReports(provider, options)`                                                                                                                                                         |
| `packages/client/src/index.ts`                                       | Modify | `PaseoAgentHandle.move()`, `PaseoProviderActions.listUsageForProvider()`, their types                                                                                                                 |
| `packages/client/src/index.test.ts`                                  | Modify | SDK tests for both                                                                                                                                                                                    |
| `public-docs/sdk/reference.md`, `public-docs/sdk/reference.zh-CN.md` | Modify | Rows for `move(options)` and `listUsageForProvider(provider, options?)` (the two files change together, `docs/website-i18n.md`)                                                                       |
| `packages/server/src/server/plugins/builtin/index.ts`                | Modify | Register `claude-accounts`                                                                                                                                                                            |
| `plugins/claude-accounts/paseo-plugin.json`                          | Create | Manifest                                                                                                                                                                                              |
| `plugins/claude-accounts/shared/settings.ts` (+ `.test.ts`)          | Create | Default account setting, account name schema, provider naming                                                                                                                                         |
| `plugins/claude-accounts/shared/rpc.ts`                              | Create | RPC contracts and wire shapes shared by server and client                                                                                                                                             |
| `plugins/claude-accounts/server/errors.ts`                           | Create | `errorCode`, `errorMessage`                                                                                                                                                                           |
| `plugins/claude-accounts/server/profiles.ts` (+ `.test.ts`)          | Create | Paths, profile discovery, Claude Code's config file rule, the added-accounts record                                                                                                                   |
| `plugins/claude-accounts/server/claude-config.ts`                    | Create | Read a config file, canonical JSON, atomic write, Claude Code's write lock (tested through `mcp-sync.test.ts`)                                                                                        |
| `plugins/claude-accounts/server/setup-link.ts` (+ `.test.ts`)        | Create | Plan and apply the shared-setup links, and the problems they leave                                                                                                                                    |
| `plugins/claude-accounts/server/mcp-sync.ts` (+ `.test.ts`)          | Create | Copy one account's `mcpServers`; the polled watcher                                                                                                                                                   |
| `plugins/claude-accounts/server/api.ts`                              | Create | The `AccountsApi` port and the shapes it carries (types only)                                                                                                                                         |
| `plugins/claude-accounts/server/default-account.ts` (+ `.test.ts`)   | Create | Usage summary, Auto choice, the create hook's decision                                                                                                                                                |
| `plugins/claude-accounts/server/move-idle.ts` (+ `.test.ts`)         | Create | Idle selection, the move job runner, the handoff guard                                                                                                                                                |
| `plugins/claude-accounts/server/accounts.ts` (+ `.test.ts`)          | Create | The service behind every RPC and the hook                                                                                                                                                             |
| `plugins/claude-accounts/server/paseo-port.ts`                       | Create | `AccountsApi` over the plugin's `PaseoApi` (typecheck is its only check before Task 12, Decision 21)                                                                                                  |
| `plugins/claude-accounts/index.server.ts`                            | Create | Settings, RPC handlers, the hook, cleanup                                                                                                                                                             |
| `plugins/claude-accounts/client/view-model.ts` (+ `.test.ts`)        | Create | Row text, picker options, move job text, name check                                                                                                                                                   |
| `plugins/claude-accounts/client/styles.ts`                           | Create | Theme-derived styles                                                                                                                                                                                  |
| `plugins/claude-accounts/client/accounts-screen.tsx`                 | Create | The accounts screen                                                                                                                                                                                   |
| `plugins/claude-accounts/index.client.tsx`                           | Create | Screen, sidebar footer item, Command Center item                                                                                                                                                      |
| `docs/plugins.md`                                                    | Modify | `claude-accounts` paragraphs under Built-in plugins; the local test-run note covers both in-process built-ins                                                                                         |
| `docs/custom-providers.md`                                           | Modify | Point a second Claude subscription login at the accounts screen                                                                                                                                       |

Task order: sub-project 4 first (Task 1 imports its exports), then 1 (daemon RPC) → 2 (SDK) → 3 (scaffold) → 4 → 5 → 6 → 7 → 8 → 9 (server wiring) → 10 (client) → 11 (docs) → 12 (deferred rollout). Task 2's code needs Task 1's protocol build, and every plugin task from 7 on reads the SDK types Task 2 builds. Tasks 4 to 8 depend only on Task 3 and the tasks before them in that list, and run one after another in this checkout: each commit's hook typechecks the whole tree, so a task starts only when `git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk` prints nothing.

---

### Task 1: Daemon RPC `usage.provider.list_reports`

**Files:**

- Modify: `packages/protocol/src/messages.ts` (request schema after `UsageListReportsRequestMessageSchema`, about line 1895; response schemas after `UsageListReportsResponseMessageSchema`, about line 6640; the inbound union entry after `UsageListReportsRequestMessageSchema,` near line 3476; the outbound union entry after `UsageListReportsResponseMessageSchema,` near line 7373; the type exports after `UsageListReportsResponseMessage` near line 7563; the features flag after `agentMove` near line 3796)
- Create: `packages/protocol/src/messages.usage-provider-reports.test.ts`
- Modify: `packages/protocol/tests/validation/ws-outbound.test.ts` (one test after "accepts a legacy github_search_response envelope")
- Modify: `packages/server/src/server/session/usage/usage-session.ts` (whole file below)
- Modify: `packages/server/src/server/session/usage/usage-session.test.ts` (append)
- Modify: `packages/server/src/server/session.ts` (`UsageSession` construction near line 1102; dispatch near line 3485)
- Modify: `packages/server/src/server/authorization/operation-permissions.ts` (lines 165 and 413)
- Modify: `packages/server/src/server/websocket-server.ts` (features near line 2019)

**Interfaces:**

- Consumes:
  - From sub-project 4: `chooseTightestWindow(windows, now)` in `@getpaseo/protocol/usage-heads-up` (their Task 1), which returns `{ window, usedPct, resetsAt, runsOutAt, tone } | null`, the window ranked tightest by heads-up tone, then used share, then the sooner run-out, with its `UsageHeadsUpTone` (`"none" | "warning" | "danger"`) at `now`. From `packages/server/src/server/agent/session-move/list-move-targets.ts` (their Task 3): `interface UsageScopeQuery { provider: string; env: Record<string, string> }`, `type MoveTargetUsageLookup = (key: string, load: () => Promise<UsageReportEntry[]>) => Promise<UsageReportEntry[] | null>` and `sharedMoveTargetUsage: MoveTargetUsageLookup`, the daemon-wide `createUsageLookup` instance (60 s TTL per key, a load slower than 5 s resolves `null`, concurrent callers share one load, failures are not cached), which `session.ts` imports in place of the old module constant `moveTargetUsage`.
  - `ProviderSnapshotManager.getProviderLaunchInfo(providerId: string): ProviderLaunchInfo | null` (`provider-snapshot-manager.ts:367`) with `ProviderLaunchInfo { providerId; family; label; enabled; env: Record<string, string> }` (`:114-120`). `env` is the provider entry's override env only, as `session.ts:3068-3070` passes it to the move dialog's lookup, keyed by provider id.
  - `pluginRuntime.listUsageReportsForScope?(scope: { provider: string; env: Record<string, string> }): Promise<UsageReportEntry[]>` (`session.ts:572-575`).
  - `UsageReportEntrySchema` and `ProviderUsageWindowSchema` (`messages.ts:6527-6630`): a window carries `usedPct?` or `remainingPct?` (both nullable), `resetsAt?` and `runsOutAt?`, which sub-project 4's projection fills.
- Produces:
  - Wire request `{ type: "usage.provider.list_reports.request", requestId: string, provider: string }`.
  - Wire response `{ type: "usage.provider.list_reports.response", payload: { requestId: string, provider: string, reports: UsageReportEntry[], tightest: { label: string, usedPct: number, resetsAt: string | null, tone: "none" | "warning" | "danger" } | null, error: string | null } }`. Errors: `"Usage is off on this host."`, `"Plugin runtime is unavailable"`, `` `Unknown provider: ${provider}` ``. A lookup slower than 5 s gives `reports: []`, `tightest: null`, `error: null`.
  - `server_info.features.usageProviderReports: true`.
  - Protocol exports `UsageProviderListReportsRequestMessageSchema`, `UsageTightestWindowSchema`, `UsageProviderListReportsResponseMessageSchema`, types `UsageTightestWindow`, `UsageProviderListReportsResponseMessage`.
  - Server exports from `usage-session.ts`: `function tightestUsageWindow(reports: readonly UsageReportEntry[], now: number): UsageTightestWindow | null`, `UsageSession.handleProviderReports(msg): Promise<void>`, and two optional `UsageSessionOptions` fields `resolveProviderScope?: (provider: string) => UsageScopeQuery | null` and `scopeLookup?: MoveTargetUsageLookup`, both types imported from sub-project 4's `list-move-targets.ts`.

**Before Step 1.** This task imports sub-project 4's `chooseTightestWindow`, `UsageScopeQuery`, `MoveTargetUsageLookup` and `sharedMoveTargetUsage`, so sub-project 4 must have landed. Run:

```bash
grep -c 'export function chooseTightestWindow' /workspace/utils/paseo/packages/protocol/src/usage-heads-up.ts && grep -c 'export const sharedMoveTargetUsage' /workspace/utils/paseo/packages/server/src/server/agent/session-move/list-move-targets.ts
```

Expected: `1`, then `1`. Anything else, such as `0` or `No such file or directory`, means sub-project 4 has not landed: stop and report it.

- [ ] **Step 1: Write the failing protocol test.** Create `packages/protocol/src/messages.usage-provider-reports.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import {
  ServerInfoStatusPayloadSchema,
  SessionInboundMessageSchema,
  SessionOutboundMessageSchema,
} from "./messages.js";

describe("usage.provider.list_reports messages", () => {
  test("parses the request inside the session inbound union", () => {
    const request = {
      type: "usage.provider.list_reports.request",
      requestId: "usage-one",
      provider: "claude-work",
    };

    expect(SessionInboundMessageSchema.parse(request)).toEqual(request);
  });

  test("parses a response with reports and the tightest window", () => {
    const response = {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "usage-one",
        provider: "claude-work",
        reports: [
          {
            id: "claude:work",
            account: { label: "work" },
            fetchedAt: "2026-11-06T00:00:00.000Z",
            sourceId: "claude",
            sourceLabel: "Claude",
            report: {
              status: "available",
              planLabel: "Max",
              windows: [
                {
                  id: "weekly",
                  label: "Weekly",
                  usedPct: 70,
                  resetsAt: "2026-11-10T00:00:00.000Z",
                },
              ],
            },
          },
        ],
        tightest: {
          label: "Weekly",
          usedPct: 70,
          resetsAt: "2026-11-10T00:00:00.000Z",
          tone: "none",
        },
        error: null,
      },
    };

    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("parses an error response without reports", () => {
    const response = {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "usage-gone",
        provider: "claude-gone",
        reports: [],
        tightest: null,
        error: "Unknown provider: claude-gone",
      },
    };

    expect(SessionOutboundMessageSchema.parse(response)).toEqual(response);
  });

  test("keeps the usageProviderReports feature flag", () => {
    const info = ServerInfoStatusPayloadSchema.parse({
      status: "server_info",
      serverId: "srv_usage",
      features: { usageProviderReports: true },
    });

    expect(info.features?.usageProviderReports).toBe(true);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run:

```bash
cd /workspace/utils/paseo/packages/protocol && flock /tmp/paseo-heavy.lock npx vitest run src/messages.usage-provider-reports.test.ts --bail=1
```

Expected: FAIL in "parses the request inside the session inbound union" with `ZodError:` followed by one issue holding `"code": "invalid_union"`, `"note": "No matching discriminator"` and `"discriminator": "type"`, at path `type` (zod 4.4.3, `node_modules/zod/v4/core/schemas.js:1184-1191`): the inbound union has no `usage.provider.list_reports.request` member yet. `--bail=1` stops there.

- [ ] **Step 3: Add the schemas.** In `packages/protocol/src/messages.ts`, insert right after the `UsageListReportsRequestMessageSchema` block (the one ending in `forceRefresh: z.boolean().optional(),\n});`):

```ts
// Fork delta (claude accounts): one provider's usage, read through its launch scope as the move
// dialog reads a target's.
export const UsageProviderListReportsRequestMessageSchema = z.object({
  type: z.literal("usage.provider.list_reports.request"),
  requestId: z.string(),
  provider: z.string(),
});
```

Insert right after the `UsageListReportsResponseMessageSchema` block (before `const AgentSlashCommandSchema`):

```ts
// Fork delta (claude accounts): the window closest to running out across the reports, ranked as
// the move dialog ranks a target's (chooseTightestWindow in usage-heads-up.ts).
export const UsageTightestWindowSchema = z.object({
  label: z.string(),
  usedPct: z.number(),
  resetsAt: z.string().nullable(),
  // The window's usage heads-up tone (UsageHeadsUpTone in usage-heads-up.ts), not a source's own
  // window tone.
  tone: z.enum(["none", "warning", "danger"]),
});
// Fork delta (claude accounts): the reply to usage.provider.list_reports.request.
export const UsageProviderListReportsResponseMessageSchema = z.object({
  type: z.literal("usage.provider.list_reports.response"),
  payload: z.object({
    requestId: z.string(),
    provider: z.string(),
    reports: z.array(UsageReportEntrySchema),
    tightest: UsageTightestWindowSchema.nullable(),
    error: z.string().nullable(),
  }),
});
```

In `SessionInboundMessageSchema`, after the line `  UsageListReportsRequestMessageSchema,` add:

```ts
  UsageProviderListReportsRequestMessageSchema,
```

In `SessionOutboundMessageSchema`, after the line `  UsageListReportsResponseMessageSchema,` add:

```ts
  UsageProviderListReportsResponseMessageSchema,
```

After `export type UsageListReportsResponseMessage = z.infer<typeof UsageListReportsResponseMessageSchema>;` add:

```ts
export type UsageTightestWindow = z.infer<typeof UsageTightestWindowSchema>;
export type UsageProviderListReportsResponseMessage = z.infer<
  typeof UsageProviderListReportsResponseMessageSchema
>;
```

In the `features` object of `ServerInfoStatusPayloadSchema`, after `        agentMove: z.boolean().optional(),` add:

```ts
        // Fork delta (claude accounts): the usage.provider.list_reports RPC.
        // COMPAT(usageProviderReports): added after v0.15.2 (fork); remove gate after 2027-05-07.
        usageProviderReports: z.boolean().optional(),
```

All new fields are optional or live in new messages, and no schema uses `.transform()`, `.catch()` or `.preprocess()` (`docs/protocol-validation.md`).

- [ ] **Step 4: Run the protocol test again.** Run:

```bash
cd /workspace/utils/paseo/packages/protocol && flock /tmp/paseo-heavy.lock npx vitest run src/messages.usage-provider-reports.test.ts --bail=1
```

Expected: `Test Files  1 passed (1)`, `Tests  4 passed (4)`.

- [ ] **Step 5: Add the generated-validator test.** In `packages/protocol/tests/validation/ws-outbound.test.ts`, insert after the test "accepts a legacy github_search_response envelope":

```ts
it("accepts a usage.provider.list_reports.response envelope", () => {
  const result = validateWSOutboundMessage({
    type: "session",
    message: {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "usage-one",
        provider: "claude-work",
        reports: [
          {
            id: "claude:work",
            account: { label: "work" },
            fetchedAt: "2026-11-06T00:00:00.000Z",
            sourceId: "claude",
            sourceLabel: "Claude",
            report: {
              status: "available",
              planLabel: "Max",
              windows: [{ id: "weekly", label: "Weekly", usedPct: 70 }],
            },
          },
        ],
        tightest: { label: "Weekly", usedPct: 70, resetsAt: null, tone: "none" },
        error: null,
      },
    },
  });
  expect(result.success).toBe(true);
});
```

Run it against the validators generated before Step 3:

```bash
cd /workspace/utils/paseo/packages/protocol && flock /tmp/paseo-heavy.lock npx vitest run tests/validation/ws-outbound.test.ts -t "usage.provider.list_reports" --bail=1
```

Expected: FAIL, `expected false to be true`. `src/generated/validation/ws-outbound.aot.ts` is gitignored and only regenerates through the protocol package's `prebuild`, `pretypecheck` and `pretest` scripts, which a direct `npx vitest` does not run.

- [ ] **Step 6: Build the protocol and client.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run build:client > /tmp/claude-accounts-build-client.out 2>&1; echo "exit=$?"; tail -n 5 /tmp/claude-accounts-build-client.out
```

Expected: `exit=0`. `build:client` runs the protocol `prebuild` (`generate:validators`, which rewrites the gitignored `ws-outbound.aot.ts`), the protocol, relay and client builds. The server and plugin typechecks read the protocol through these `dist` declarations.

- [ ] **Step 7: Run the whole outbound validation file.** Run:

```bash
cd /workspace/utils/paseo/packages/protocol && flock /tmp/paseo-heavy.lock npx vitest run tests/validation/ws-outbound.test.ts --bail=1
```

Expected: every test passes, the new one included, and "keeps each generated validator function small" still passes (no generated function reaches 1 MB).

- [ ] **Step 8: Write the failing server tests.** In `packages/server/src/server/session/usage/usage-session.test.ts`, replace the imports at the top with:

```ts
import pino from "pino";
import { expect, test } from "vitest";
import type { UsageReportEntry } from "@getpaseo/protocol/messages";
import type { UsageScopeQuery } from "../../agent/session-move/list-move-targets.js";
import type { SessionOutboundMessage } from "../../messages.js";
import { UsageSession, tightestUsageWindow } from "./usage-session.js";
```

Append to the end of the file:

```ts
function usageEntry(id: string, report: UsageReportEntry["report"]): UsageReportEntry {
  return {
    id,
    account: {},
    fetchedAt: "2026-11-06T00:00:00.000Z",
    sourceId: "claude",
    sourceLabel: "Claude",
    report,
  };
}

// The time the tightest-window tests judge run-outs at.
const NOW = Date.parse("2026-11-06T00:00:00.000Z");

// Session at 40% used and Weekly with 30% left: Weekly is the tightest at 70%.
const workReport = usageEntry("claude:work", {
  status: "available",
  planLabel: "Max",
  windows: [
    { id: "five_hour", label: "Session", usedPct: 40, resetsAt: "2026-11-06T05:00:00.000Z" },
    { id: "weekly", label: "Weekly", remainingPct: 30, resetsAt: "2026-11-10T00:00:00.000Z" },
  ],
});

interface ProviderReportsFixture {
  usage: UsageSession;
  emitted: SessionOutboundMessage[];
  scopes: UsageScopeQuery[];
  keys: string[];
}

function providerReportsFixture(
  lookup: (
    key: string,
    load: () => Promise<UsageReportEntry[]>,
  ) => Promise<UsageReportEntry[] | null>,
  enabled = true,
): ProviderReportsFixture {
  const emitted: SessionOutboundMessage[] = [];
  const scopes: UsageScopeQuery[] = [];
  const keys: string[] = [];
  const usage = new UsageSession({
    isEnabled: () => enabled,
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
    runtime: {
      async listUsageReports() {
        return [];
      },
      async listLegacyUsage() {
        return { fetchedAt: "now", providers: [] };
      },
      async listUsageReportsForScope(scope) {
        scopes.push(scope);
        return [workReport];
      },
    },
    resolveProviderScope: (provider) =>
      provider === "claude-work"
        ? { provider: "claude", env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-work" } }
        : null,
    scopeLookup: (key, load) => {
      keys.push(key);
      return lookup(key, load);
    },
  });
  return { usage, emitted, scopes, keys };
}

test("lists one provider's reports through its launch scope and the shared lookup", async () => {
  const { usage, emitted, scopes, keys } = providerReportsFixture((_key, load) => load());

  await usage.handleProviderReports({
    type: "usage.provider.list_reports.request",
    requestId: "one",
    provider: "claude-work",
  });

  expect(keys).toEqual(["claude-work"]);
  expect(scopes).toEqual([
    { provider: "claude", env: { CLAUDE_CONFIG_DIR: "/home/u/.claude-work" } },
  ]);
  expect(emitted).toEqual([
    {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "one",
        provider: "claude-work",
        reports: [workReport],
        tightest: {
          label: "Weekly",
          usedPct: 70,
          resetsAt: "2026-11-10T00:00:00.000Z",
          tone: "none",
        },
        error: null,
      },
    },
  ]);
});

test("reports an unknown provider without reading usage", async () => {
  const { usage, emitted, keys } = providerReportsFixture((_key, load) => load());

  await usage.handleProviderReports({
    type: "usage.provider.list_reports.request",
    requestId: "gone",
    provider: "claude-gone",
  });

  expect(keys).toEqual([]);
  expect(emitted).toEqual([
    {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "gone",
        provider: "claude-gone",
        reports: [],
        tightest: null,
        error: "Unknown provider: claude-gone",
      },
    },
  ]);
});

test("treats a lookup that ran out of time as no reports", async () => {
  const { usage, emitted } = providerReportsFixture(async () => null);

  await usage.handleProviderReports({
    type: "usage.provider.list_reports.request",
    requestId: "slow",
    provider: "claude-work",
  });

  expect(emitted).toEqual([
    {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "slow",
        provider: "claude-work",
        reports: [],
        tightest: null,
        error: null,
      },
    },
  ]);
});

test("usage off and a runtime without scoped reads refuse before any lookup", async () => {
  const off = providerReportsFixture((_key, load) => load(), false);
  await off.usage.handleProviderReports({
    type: "usage.provider.list_reports.request",
    requestId: "off",
    provider: "claude-work",
  });
  expect(off.keys).toEqual([]);
  expect(off.emitted).toEqual([
    {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "off",
        provider: "claude-work",
        reports: [],
        tightest: null,
        error: "Usage is off on this host.",
      },
    },
  ]);

  const emitted: SessionOutboundMessage[] = [];
  const bare = new UsageSession({
    isEnabled: () => true,
    emit: (message) => emitted.push(message),
    logger: pino({ level: "silent" }),
    resolveProviderScope: () => ({ provider: "claude", env: {} }),
  });
  await bare.handleProviderReports({
    type: "usage.provider.list_reports.request",
    requestId: "bare",
    provider: "claude",
  });
  expect(emitted).toEqual([
    {
      type: "usage.provider.list_reports.response",
      payload: {
        requestId: "bare",
        provider: "claude",
        reports: [],
        tightest: null,
        error: "Plugin runtime is unavailable",
      },
    },
  ]);
});

test("the tightest window skips reports and windows without a used share", () => {
  expect(
    tightestUsageWindow(
      [
        usageEntry("rejected", {
          status: "unavailable",
          problem: { kind: "rejected", status: 401 },
        }),
        usageEntry("extra", {
          status: "available",
          windows: [{ id: "extra", label: "Extra usage" }],
        }),
      ],
      NOW,
    ),
  ).toBeNull();
  expect(
    tightestUsageWindow(
      [
        workReport,
        usageEntry("busy", {
          status: "available",
          windows: [{ id: "five_hour", label: "Session", usedPct: 85 }],
        }),
      ],
      NOW,
    ),
  ).toEqual({ label: "Session", usedPct: 85, resetsAt: null, tone: "warning" });
});

test("the tightest window is a 60% one that runs out in 20 minutes, not a 75% one that will not", () => {
  expect(
    tightestUsageWindow(
      [
        usageEntry("work", {
          status: "available",
          windows: [
            { id: "weekly", label: "Weekly", usedPct: 75, resetsAt: "2026-11-10T00:00:00.000Z" },
            {
              id: "five_hour",
              label: "Session",
              usedPct: 60,
              resetsAt: "2026-11-06T04:00:00.000Z",
              runsOutAt: "2026-11-06T00:20:00.000Z",
            },
          ],
        }),
      ],
      NOW,
    ),
  ).toEqual({
    label: "Session",
    usedPct: 60,
    resetsAt: "2026-11-06T04:00:00.000Z",
    tone: "danger",
  });
});
```

- [ ] **Step 9: Run them and watch them fail.** Run:

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/session/usage/usage-session.test.ts --bail=1
```

Expected: the four existing tests pass, then "lists one provider's reports through its launch scope and the shared lookup" fails with `TypeError: usage.handleProviderReports is not a function`.

- [ ] **Step 10: Implement the handler.** Replace `packages/server/src/server/session/usage/usage-session.ts` with:

```ts
import type { ListUsageReportsOptions } from "../../plugins/usage-sources/index.js";
import type pino from "pino";
import { chooseTightestWindow } from "@getpaseo/protocol/usage-heads-up";
import type {
  ProviderUsage,
  UsageReportEntry,
  UsageTightestWindow,
} from "@getpaseo/protocol/messages";
import type {
  MoveTargetUsageLookup,
  UsageScopeQuery,
} from "../../agent/session-move/list-move-targets.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";

export interface UsageSessionOptions {
  emit(message: SessionOutboundMessage): void;
  runtime?: {
    listUsageReports(options: ListUsageReportsOptions): Promise<UsageReportEntry[]>;
    listLegacyUsage(): Promise<{ fetchedAt: string; providers: ProviderUsage[] }>;
    listUsageReportsForScope?(scope: UsageScopeQuery): Promise<UsageReportEntry[]>;
  };
  // Fork delta (claude accounts): a provider's launch scope, or null when no provider has the id.
  resolveProviderScope?: (provider: string) => UsageScopeQuery | null;
  scopeLookup?: MoveTargetUsageLookup;
  isEnabled: () => boolean;
  logger: pino.Logger;
}

type ProviderReportsRequest = Extract<
  SessionInboundMessage,
  { type: "usage.provider.list_reports.request" }
>;

interface ProviderReportsResult {
  reports: UsageReportEntry[];
  tightest: UsageTightestWindow | null;
  error: string | null;
}

export class UsageSession {
  constructor(private readonly options: UsageSessionOptions) {}

  async handleListReports(
    msg: Extract<SessionInboundMessage, { type: "usage.list_reports.request" }>,
  ): Promise<void> {
    try {
      if (!this.options.isEnabled()) throw new Error("Usage is off on this host.");
      if (!this.options.runtime) throw new Error("Plugin runtime is unavailable");
      await this.options.runtime.listUsageReports({
        forceRefresh: msg.forceRefresh,
        reportIds: msg.reportIds,
        agentId: msg.agentId,
        onReport: (report) =>
          this.options.emit({
            type: "usage.list_reports.update",
            payload: { requestId: msg.requestId, report },
          }),
      });
      this.options.emit({
        type: "usage.list_reports.response",
        payload: { requestId: msg.requestId, error: null },
      });
    } catch (error) {
      this.options.emit({
        type: "usage.list_reports.response",
        payload: {
          requestId: msg.requestId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  // Fork delta (claude accounts): one provider's usage, read the way the move dialog reads a
  // target's, so the accounts screen and the dialog agree.
  async handleProviderReports(msg: ProviderReportsRequest): Promise<void> {
    try {
      if (!this.options.isEnabled()) throw new Error("Usage is off on this host.");
      const runtime = this.options.runtime;
      const listForScope = runtime?.listUsageReportsForScope;
      if (!runtime || !listForScope) throw new Error("Plugin runtime is unavailable");
      const scope = this.options.resolveProviderScope?.(msg.provider) ?? null;
      if (!scope) throw new Error(`Unknown provider: ${msg.provider}`);
      const lookup = this.options.scopeLookup ?? loadNow;
      const reports = (await lookup(msg.provider, () => listForScope.call(runtime, scope))) ?? [];
      this.emitProviderReports(msg, {
        reports,
        tightest: tightestUsageWindow(reports, Date.now()),
        error: null,
      });
    } catch (error) {
      this.emitProviderReports(msg, {
        reports: [],
        tightest: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // COMPAT(providerUsageList): added in v0.9.3, remove after 2027-03-26.
  async handleLegacyList(
    msg: Extract<SessionInboundMessage, { type: "provider.usage.list.request" }>,
  ): Promise<void> {
    if (!this.options.isEnabled()) {
      this.options.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: "Usage is off on this host.",
          code: "provider_usage_list_failed",
        },
      });
      return;
    }
    try {
      if (!this.options.runtime) throw new Error("Plugin runtime is unavailable");
      const usage = await this.options.runtime.listLegacyUsage();
      this.options.emit({
        type: "provider.usage.list.response",
        payload: {
          requestId: msg.requestId,
          fetchedAt: usage.fetchedAt,
          providers: usage.providers,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.logger.error({ err }, "Failed to list provider usage");
      this.options.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to list provider usage: ${err.message}`,
          code: "provider_usage_list_failed",
        },
      });
    }
  }

  private emitProviderReports(msg: ProviderReportsRequest, result: ProviderReportsResult): void {
    this.options.emit({
      type: "usage.provider.list_reports.response",
      payload: { requestId: msg.requestId, provider: msg.provider, ...result },
    });
  }
}

function loadNow(
  _key: string,
  load: () => Promise<UsageReportEntry[]>,
): Promise<UsageReportEntry[] | null> {
  return load();
}

/**
 * The tightest window across the available reports, ranked as the move dialog ranks a target's
 * (`chooseTightestWindow`: heads-up tone, then used share, then the sooner run-out), with its
 * heads-up tone at `now`.
 */
export function tightestUsageWindow(
  reports: readonly UsageReportEntry[],
  now: number,
): UsageTightestWindow | null {
  const windows = reports.flatMap((entry) =>
    entry.report.status === "available" ? entry.report.windows : [],
  );
  const tightest = chooseTightestWindow(windows, now);
  if (tightest === null) return null;
  return {
    label: tightest.window.label,
    usedPct: tightest.usedPct,
    resetsAt: tightest.resetsAt,
    tone: tightest.tone,
  };
}
```

`listForScope.call(runtime, scope)` keeps the runtime as `this`, as `session.ts` does for the move dialog. `runtime`, `listForScope` and `scope` are `const`, so their narrowing holds inside the arrow.

- [ ] **Step 11: Run the server tests again.** Run:

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/session/usage/usage-session.test.ts --bail=1
```

Expected: `Tests  10 passed (10)`.

- [ ] **Step 12: Wire the daemon.** In `packages/server/src/server/session.ts`, replace the `UsageSession` construction:

```ts
this.usageSession = new UsageSession({
  isEnabled: () => daemonConfigStore.get().usage?.enabled !== false,
  emit: (msg) => this.emit(msg),
  runtime: pluginRuntime,
  logger: this.sessionLogger,
});
```

with:

```ts
this.usageSession = new UsageSession({
  isEnabled: () => daemonConfigStore.get().usage?.enabled !== false,
  emit: (msg) => this.emit(msg),
  runtime: pluginRuntime,
  // Fork delta (claude accounts): a provider's usage is keyed by its family and override env,
  // and read through the move dialog's cache, the way the dialog reads a target's.
  resolveProviderScope: (provider) => {
    const info = providerSnapshotManager.getProviderLaunchInfo(provider);
    return info ? { provider: info.family, env: info.env } : null;
  },
  scopeLookup: sharedMoveTargetUsage,
  logger: this.sessionLogger,
});
```

`sharedMoveTargetUsage` is the daemon-wide lookup that sub-project 4's Task 3 imports into `session.ts` from `./agent/session-move/list-move-targets.js` in place of the old module constant `moveTargetUsage`, so the import is already there. The accounts screen and the move dialog share its cache, keyed by provider id.

In the same file, after:

```ts
      case "usage.list_reports.request":
        return this.usageSession.handleListReports(msg);
```

add:

```ts
      // Fork delta (claude accounts): one provider's usage.
      case "usage.provider.list_reports.request":
        return this.usageSession.handleProviderReports(msg);
```

In `packages/server/src/server/authorization/operation-permissions.ts`, after `  "usage.list_reports.request": "daemon.read",` add:

```ts
  // Fork delta (claude accounts): one provider's usage.
  "usage.provider.list_reports.request": "daemon.read",
```

and after `  "usage.list_reports.response": "daemon.read",` add:

```ts
  // Fork delta (claude accounts): one provider's usage.
  "usage.provider.list_reports.response": "daemon.read",
```

Both tables end in `satisfies Record<...Operation, PermissionRequirement>`, so leaving either entry out fails the server typecheck. The new pair follows the `.request`/`.response` convention, so `session/owned-subscriptions/replies.ts` needs no exception.

In `packages/server/src/server/websocket-server.ts`, in the `features` object, after `        agentMove: true,` add:

```ts
        // Fork delta (claude accounts): the usage.provider.list_reports RPC.
        usageProviderReports: true,
```

- [ ] **Step 13: Typecheck the protocol and the server.** Run one after the other:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/protocol -- --singleThreaded
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/server -- --singleThreaded
```

Expected: both exit 0 with no diagnostics. The protocol's `pretypecheck` regenerates the validators again, which changes nothing tracked.

- [ ] **Step 14: Format and lint.** Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- packages/protocol/src/messages.ts packages/protocol/src/messages.usage-provider-reports.test.ts packages/protocol/tests/validation/ws-outbound.test.ts packages/server/src/server/session/usage/usage-session.ts packages/server/src/server/session/usage/usage-session.test.ts packages/server/src/server/session.ts packages/server/src/server/authorization/operation-permissions.ts packages/server/src/server/websocket-server.ts
cd /workspace/utils/paseo && npm run lint -- packages/protocol/src/messages.ts packages/protocol/src/messages.usage-provider-reports.test.ts packages/protocol/tests/validation/ws-outbound.test.ts packages/server/src/server/session/usage/usage-session.ts packages/server/src/server/session/usage/usage-session.test.ts packages/server/src/server/session.ts packages/server/src/server/authorization/operation-permissions.ts packages/server/src/server/websocket-server.ts
```

Expected: the formatter may rewrap lines; lint reports no errors. If the formatter changed a file, rerun Step 11's test before committing.

- [ ] **Step 15: Commit with the fork identity (local only, never push).** Run:

```bash
git -C /workspace/utils/paseo add packages/protocol/src/messages.ts packages/protocol/src/messages.usage-provider-reports.test.ts packages/protocol/tests/validation/ws-outbound.test.ts packages/server/src/server/session/usage/usage-session.ts packages/server/src/server/session/usage/usage-session.test.ts packages/server/src/server/session.ts packages/server/src/server/authorization/operation-permissions.ts packages/server/src/server/websocket-server.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): usage.provider.list_reports RPC for one provider's usage" -- packages/protocol/src/messages.ts packages/protocol/src/messages.usage-provider-reports.test.ts packages/protocol/tests/validation/ws-outbound.test.ts packages/server/src/server/session/usage/usage-session.ts packages/server/src/server/session/usage/usage-session.test.ts packages/server/src/server/session.ts packages/server/src/server/authorization/operation-permissions.ts packages/server/src/server/websocket-server.ts
```

Expected: lefthook's `format`, `lint` and `typecheck` jobs pass (the typecheck covers every workspace and can take several minutes under the lock), then `[main <sha>] feat(fork): usage.provider.list_reports RPC for one provider's usage` and `8 files changed`. If a hook job fails, git creates no commit: report the hook output and stop. Do not bypass the hook.

- [ ] **Step 16: Verify the commit.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an|%ae|%cn|%ce' | grep -qxF 'tatsuya|allrested@gmail.com|tatsuya|allrested@gmail.com' && echo "fork identity" || echo "WRONG IDENTITY"
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk
```

Expected: `fork identity`; the subject and the eight paths; an empty status.

### Task 2: SDK `PaseoAgentHandle.move()` and `providers.listUsageForProvider()`

**Files:**

- Modify: `packages/client/src/daemon-client.ts` (type import near line 111, payload alias near line 614, method after `listProviderUsage` near line 5921)
- Modify: `packages/client/src/index.ts` (type import block lines 12-37, types after `PaseoAgentCommandsResult` and after `PaseoProviderUsageOptions`, `PaseoAgentHandle` and `PaseoProviderActions` interfaces, the handle factory near line 1026, the providers object near line 800, a helper after `listProviderUsage` near line 1105)
- Modify: `packages/client/src/index.test.ts` (four tests after "provider usage requires the advertised host capability")
- Modify: `public-docs/sdk/reference.md`, `public-docs/sdk/reference.zh-CN.md`

**Interfaces:**

- Consumes:
  - Task 1's protocol exports `UsageProviderListReportsResponseMessage` and `features.usageProviderReports`, through the `dist` declarations Task 1 Step 6 built.
  - `DaemonClient.moveAgent(agentId: string, target: { provider: string; model?: string }, options: { continueWork: boolean }): Promise<MoveAgentOutcome>` (`daemon-client.ts:4071`), which sends `agent.move.request`, waits up to 120 s and throws the payload's `error` when the move fails.
  - `server_info.features.agentMove` (`messages.ts:3798`), advertised by every host that has the Move session dialog.
- Produces:
  - `DaemonClient.listProviderUsageReports(provider: string, options?: { requestId?: string }): Promise<UsageProviderReportsPayload>`, where `UsageProviderReportsPayload` is `{ requestId, provider, reports, tightest, error }`.
  - `PaseoAgentHandle.move(options: PaseoAgentMoveOptions): Promise<PaseoAgentMoveResult>` with `interface PaseoAgentMoveOptions { to: string; continueWork: boolean }` and `interface PaseoAgentMoveResult { agentId: string; strategy: "native" | "handoff"; fellBackFromNative: boolean }`. `agentId` is the successor; the moved agent is archived. Rejects with `"Update the host to move agents."` when `features.agentMove` is not `true`, before sending anything.
  - `PaseoProviderActions.listUsageForProvider(provider: string, options?: PaseoProviderUsageOptions): Promise<PaseoProviderReportsResult>` with `type PaseoProviderReportsResult = UsageProviderListReportsResponseMessage["payload"]`. Rejects with `"Update the host to list a provider's usage."` when `features.usageProviderReports` is not `true`, before sending anything. Plugins reach both through `PluginHandlerContext["paseo"]`.

- [ ] **Step 1: Write the failing SDK tests.** In `packages/client/src/index.test.ts`, insert after the test "provider usage requires the advertised host capability":

```ts
test("agent handles move to another provider through the agent.move RPC", async () => {
  const { client, ws } = await connectClient({ agentMove: true });

  const moving = client.agents.ref("agent_sdk").move({ to: "claude-work", continueWork: false });
  await expect.poll(() => parseSentSessionMessage(ws.sent.at(-1)).type).toBe("agent.move.request");
  const request = parseSentSessionMessage(ws.sent.at(-1));
  expect(parseSentFrame(ws.sent.at(-1))).toEqual({
    type: "session",
    message: {
      type: "agent.move.request",
      requestId: request.requestId,
      agentId: "agent_sdk",
      target: { provider: "claude-work" },
      continueWork: false,
    },
  });
  ws.message(
    sessionMessage({
      type: "agent.move.response",
      payload: {
        requestId: request.requestId,
        ok: true,
        agentId: "agent_next",
        strategy: "handoff",
        fellBackFromNative: true,
        error: null,
      },
    }),
  );

  await expect(moving).resolves.toEqual({
    agentId: "agent_next",
    strategy: "handoff",
    fellBackFromNative: true,
  });
  await client.close();
});

test("agent move requires the advertised host capability", async () => {
  const { client, ws } = await connectClient({});
  const sentBeforeMove = ws.sent.length;

  await expect(
    client.agents.ref("agent_sdk").move({ to: "claude-work", continueWork: false }),
  ).rejects.toThrow("Update the host to move agents.");
  expect(ws.sent).toHaveLength(sentBeforeMove);

  await client.close();
});

test("usage for one provider round-trips the usage.provider.list_reports RPC", async () => {
  const { client, ws } = await connectClient({ usageProviderReports: true });

  const listing = client.providers.listUsageForProvider("claude-work", {
    requestId: "usage-one",
  });
  await expect
    .poll(() => parseSentSessionMessage(ws.sent.at(-1)).type)
    .toBe("usage.provider.list_reports.request");
  expect(parseSentSessionMessage(ws.sent.at(-1))).toEqual({
    type: "usage.provider.list_reports.request",
    requestId: "usage-one",
    provider: "claude-work",
  });
  const payload = {
    requestId: "usage-one",
    provider: "claude-work",
    reports: [],
    tightest: { label: "Weekly", usedPct: 70, resetsAt: null, tone: "none" },
    error: null,
  };
  ws.message(sessionMessage({ type: "usage.provider.list_reports.response", payload }));

  await expect(listing).resolves.toEqual(payload);
  await client.close();
});

test("usage for one provider requires the advertised host capability", async () => {
  const { client, ws } = await connectClient({});
  const sentBeforeUsage = ws.sent.length;

  await expect(client.providers.listUsageForProvider("claude-work")).rejects.toThrow(
    "Update the host to list a provider's usage.",
  );
  expect(ws.sent).toHaveLength(sentBeforeUsage);

  await client.close();
});
```

`connectClient(features)` (top of the file) answers the hello with exactly the flags passed, so `{}` is a host that advertises neither feature.

- [ ] **Step 2: Run them and watch them fail.** Run:

```bash
cd /workspace/utils/paseo/packages/client && flock /tmp/paseo-heavy.lock npx vitest run src/index.test.ts -t "move|one provider" --bail=1
```

Expected: FAIL in "agent handles move to another provider through the agent.move RPC" with `TypeError: client.agents.ref(...).move is not a function`. No existing test name matches the pattern, so only the four new tests are selected.

- [ ] **Step 3: Add the daemon client method.** In `packages/client/src/daemon-client.ts`, in the type import block from `@getpaseo/protocol/messages`, after `  ProviderUsageListResponseMessage,` add:

```ts
  UsageProviderListReportsResponseMessage,
```

After `type ProviderUsageListPayload = ProviderUsageListResponseMessage["payload"];` add:

```ts
type UsageProviderReportsPayload = UsageProviderListReportsResponseMessage["payload"];
```

After the `listProviderUsage` method add:

```ts
  // Fork delta (claude accounts): one provider's usage, read through its launch scope.
  async listProviderUsageReports(
    provider: string,
    options?: { requestId?: string },
  ): Promise<UsageProviderReportsPayload> {
    return this.sendNamespacedCorrelatedSessionRequest<"usage.provider.list_reports.response">({
      requestId: options?.requestId,
      message: { type: "usage.provider.list_reports.request", provider },
    });
  }
```

`sendNamespacedCorrelatedSessionRequest` derives the response type from the request name and fills in `requestId`.

- [ ] **Step 4: Add the SDK surface.** In `packages/client/src/index.ts`, in the type import block from `@getpaseo/protocol/messages`, after `  RefreshProvidersSnapshotResponseMessage,` add:

```ts
  UsageProviderListReportsResponseMessage,
```

After `export type PaseoAgentCommandsResult = ListCommandsResponse["payload"];` add:

```ts
// Fork delta (claude accounts): moving an agent from the SDK.
export interface PaseoAgentMoveOptions {
  /** Provider id to move to, such as `claude-work`. */
  to: string;
  /** Prompts the successor to carry on with the work. */
  continueWork: boolean;
}

export interface PaseoAgentMoveResult {
  /** The successor. The moved agent is archived. */
  agentId: string;
  strategy: "native" | "handoff";
  fellBackFromNative: boolean;
}
```

In `interface PaseoAgentHandle`, after `  detach(): Promise<void>;` add:

```ts
  /**
   * Moves the agent to another provider, as the Move session dialog does. Rejects with an
   * update-host error when the host cannot move agents.
   */
  move(options: PaseoAgentMoveOptions): Promise<PaseoAgentMoveResult>;
```

After `export interface PaseoProviderUsageOptions { requestId?: string; }` add:

```ts
// Fork delta (claude accounts): one provider's usage and its tightest window.
export type PaseoProviderReportsResult = UsageProviderListReportsResponseMessage["payload"];
```

In `interface PaseoProviderActions`, after `  listUsage(options?: PaseoProviderUsageOptions): Promise<PaseoProviderUsageResult>;` add:

```ts
  /**
   * One provider's usage reports and their tightest window, read through the provider's launch
   * scope as the Move session dialog reads a target's. Rejects with an update-host error when the
   * host cannot.
   */
  listUsageForProvider(
    provider: string,
    options?: PaseoProviderUsageOptions,
  ): Promise<PaseoProviderReportsResult>;
```

In `createAgentHandleFactory`, after the `detach` member:

```ts
      detach: async () => {
        await daemonClient.detachAgent(id);
      },
```

add:

```ts
      // Fork delta (claude accounts): the Move session dialog's RPC, gated once on the host.
      move: async ({ to, continueWork }) => {
        daemonClient.ensureConnected();
        // COMPAT(agentMove): added after v0.15.2 (fork); remove gate after 2027-05-07.
        if (daemonClient.getLastServerInfoMessage()?.features?.agentMove !== true) {
          throw new Error("Update the host to move agents.");
        }
        return daemonClient.moveAgent(id, { provider: to }, { continueWork });
      },
```

In the `providers` object of the API, after `      listUsage: (options) => listProviderUsage(daemonClient, options),` add:

```ts
      listUsageForProvider: (provider, options) =>
        listOneProviderUsage(daemonClient, provider, options),
```

After the `listProviderUsage` function add:

```ts
// Fork delta (claude accounts): one provider's usage, gated once on the host feature.
function listOneProviderUsage(
  daemonClient: DaemonClient,
  provider: string,
  options?: PaseoProviderUsageOptions,
): Promise<PaseoProviderReportsResult> {
  daemonClient.ensureConnected();
  // COMPAT(usageProviderReports): added after v0.15.2 (fork); remove gate after 2027-05-07.
  if (daemonClient.getLastServerInfoMessage()?.features?.usageProviderReports !== true) {
    return Promise.reject(new Error("Update the host to list a provider's usage."));
  }
  return daemonClient.listProviderUsageReports(provider, options);
}
```

- [ ] **Step 5: Run the SDK tests again.** Run:

```bash
cd /workspace/utils/paseo/packages/client && flock /tmp/paseo-heavy.lock npx vitest run src/index.test.ts -t "move|one provider" --bail=1
```

Expected: `Tests  4 passed` with the rest of the file skipped.

- [ ] **Step 6: Document both methods.** In `public-docs/sdk/reference.md`, after the agent-handle row for `detach()` add:

```md
| `move(options)` | `PaseoAgentMoveResult` | Moves the agent to another provider or account, as the Move session dialog does: `to` names the provider, and `continueWork` prompts the successor to carry on. The moved agent is archived and the result names its successor. Rejects with an update-host error when unsupported. |
```

and after the `client.providers` row for `listUsage(options?)` add:

```md
| `listUsageForProvider(provider, options?)` | `PaseoProviderReportsResult` | Returns one provider's usage reports and their tightest window, read the way the Move session dialog reads a target's. Rejects with an update-host error when unsupported. Options: `requestId`. |
```

In `public-docs/sdk/reference.zh-CN.md`, after the row for `detach()` add:

```md
| `move(options)` | `PaseoAgentMoveResult` | 把 Agent 移到另一个 Provider 或账号，与 Move session 对话框相同：`to` 指定 Provider，`continueWork` 让后继 Agent 收到继续工作的提示。被移动的 Agent 会被归档，结果给出它的后继 Agent。不支持时以要求更新主机的错误 reject。 |
```

and after the row for `listUsage(options?)` add:

```md
| `listUsageForProvider(provider, options?)` | `PaseoProviderReportsResult` | 按 Move session 对话框读取目标的方式，返回单个 Provider 的用量报告及其中最紧张的窗口。不支持时以要求更新主机的错误 reject。选项：`requestId`。 |
```

The two files change together (`docs/website-i18n.md`); the app keeps "Move session" untranslated in `zh-CN.ts`, so the Chinese row names the dialog the same way. Step 9's formatter realigns both tables.

- [ ] **Step 7: Rebuild the client declarations.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run build:client > /tmp/claude-accounts-build-client.out 2>&1; echo "exit=$?"; tail -n 5 /tmp/claude-accounts-build-client.out
```

Expected: `exit=0`. The plugins workspace reads `PaseoApi` from these declarations from Task 3 on.

- [ ] **Step 8: Typecheck the client.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/client -- --singleThreaded
```

Expected: exit 0 with no diagnostics.

- [ ] **Step 9: Format and lint.** Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- packages/client/src/daemon-client.ts packages/client/src/index.ts packages/client/src/index.test.ts public-docs/sdk/reference.md public-docs/sdk/reference.zh-CN.md
cd /workspace/utils/paseo && npm run lint -- packages/client/src/daemon-client.ts packages/client/src/index.ts packages/client/src/index.test.ts
```

Expected: the formatter realigns the two Markdown tables and may rewrap lines; lint reports no errors.

- [ ] **Step 10: Commit with the fork identity (local only, never push).** Run:

```bash
git -C /workspace/utils/paseo add packages/client/src/daemon-client.ts packages/client/src/index.ts packages/client/src/index.test.ts public-docs/sdk/reference.md public-docs/sdk/reference.zh-CN.md
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): SDK agent move and per-provider usage" -- packages/client/src/daemon-client.ts packages/client/src/index.ts packages/client/src/index.test.ts public-docs/sdk/reference.md public-docs/sdk/reference.zh-CN.md
```

Expected: the hook's `format`, `lint` and `typecheck` jobs pass, then `[main <sha>] feat(fork): SDK agent move and per-provider usage` and `5 files changed`. If a hook job fails, git creates no commit: report the hook output and stop.

- [ ] **Step 11: Verify the commit.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an|%ae|%cn|%ce' | grep -qxF 'tatsuya|allrested@gmail.com|tatsuya|allrested@gmail.com' && echo "fork identity" || echo "WRONG IDENTITY"
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk
```

Expected: `fork identity`; the subject and the five paths; an empty status.

### Task 3: Scaffold the `claude-accounts` built-in

**Files:**

- Create: `plugins/claude-accounts/shared/settings.ts`, `plugins/claude-accounts/shared/settings.test.ts`
- Create: `plugins/claude-accounts/shared/rpc.ts`
- Create: `plugins/claude-accounts/paseo-plugin.json`, `plugins/claude-accounts/index.server.ts` (minimal; Task 9 replaces it)
- Modify: `packages/server/src/server/plugins/builtin/index.ts` (the `builtinPlugins` array)

**Interfaces:**

- Consumes: `defineSettings` and `defineRpc` from `@getpaseo/plugin`; `PluginServerContext.registerSettings` from `@getpaseo/plugin/server`. RPC names match `/^[a-z][a-z0-9._-]*$/` (`packages/plugin/src/rpc.ts:27`).
- Produces (`shared/settings.ts`):
  - `MAIN_PROVIDER = "claude"`, `AUTO_ACCOUNT = "auto"`, `ACCOUNT_NAME_MAX = 32`.
  - `AccountNameSchema`: a string of at most 32 characters matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Messages: `"Use at most 32 characters"`, `"Use lowercase letters and digits, with single dashes between them"`.
  - `accountProvider(name: string): string` returns `claude-<name>`.
  - `claudeAccountsSettings`: host-scoped settings `default-account`, version 1, values `{ defaultAccount: string }` matching `^(auto|claude|claude-<name>)$`, default `"claude"`, message `"Pick Auto or one of the accounts"`.
- Produces (`shared/rpc.ts`), every output schema free of transforms and defaults:
  - `AccountUsage { usedPct: number; windowLabel: string; planLabel: string | null }`
  - `Account { provider; directory; label; main; signedIn; loginExpired; providerReady; usage: AccountUsage | null; agents: { total; busy }; problems: string[] }`
  - `MoveJob { from; to; total; busy; moved; handedOff; skipped; failed: { agentId; error }[]; done }`: `total` counts the agents on `from` that were idle when the job started, `busy` the ones in a turn then, which stay (the spec's "skipped and counted"), and `skipped` the idle ones that started a turn or went away before their move
  - `ActionResult { ok: boolean; error: string | null; loginWorkspaceId: string | null }`
  - `AccountList { accounts: Account[]; usageError: string | null; moveJob: MoveJob | null }`
  - `MoveIdleResult { ok: boolean; error: string | null; job: MoveJob | null }`
  - RPCs: `listAccountsRpc` `claude-accounts.list.request` (`{}` → `AccountList`), `addAccountRpc` `claude-accounts.add.request` (`{ name }` → `ActionResult`), `signInRpc` `claude-accounts.sign-in.request` (`{ provider }` → `ActionResult`), `moveIdleRpc` `claude-accounts.move-idle.request` (`{ from, to }` → `MoveIdleResult`).

- [ ] **Step 1: Write the failing settings test.** Create `plugins/claude-accounts/shared/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AccountNameSchema, accountProvider, claudeAccountsSettings } from "./settings.js";

const NAME_MESSAGE = "Use lowercase letters and digits, with single dashes between them";
const DEFAULT_MESSAGE = "Pick Auto or one of the accounts";

function nameIssues(input: unknown): string[] {
  const result = AccountNameSchema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

function settingsIssues(input: unknown): string[] {
  const result = claudeAccountsSettings.schema.safeParse(input);
  return result.success ? [] : result.error.issues.map((issue) => issue.message);
}

describe("AccountNameSchema", () => {
  it("accepts lowercase words joined by single dashes", () => {
    expect(nameIssues("work")).toEqual([]);
    expect(nameIssues("team-2")).toEqual([]);
    expect(nameIssues("a".repeat(32))).toEqual([]);
  });

  it("rejects names that would not make a provider id and a plain directory name", () => {
    expect(nameIssues("")).toEqual([NAME_MESSAGE]);
    expect(nameIssues("Work")).toEqual([NAME_MESSAGE]);
    expect(nameIssues("-work")).toEqual([NAME_MESSAGE]);
    expect(nameIssues("work--2")).toEqual([NAME_MESSAGE]);
    expect(nameIssues("../x")).toEqual([NAME_MESSAGE]);
  });

  it("rejects names longer than 32 characters", () => {
    expect(nameIssues("a".repeat(33))).toEqual(["Use at most 32 characters"]);
  });
});

describe("claudeAccountsSettings", () => {
  it("defaults to the main account", () => {
    expect(claudeAccountsSettings.schema.parse({})).toEqual({ defaultAccount: "claude" });
  });

  it("accepts Auto, the main provider and account providers", () => {
    expect(settingsIssues({ defaultAccount: "auto" })).toEqual([]);
    expect(settingsIssues({ defaultAccount: "claude" })).toEqual([]);
    expect(settingsIssues({ defaultAccount: accountProvider("work") })).toEqual([]);
  });

  it("rejects other providers", () => {
    expect(settingsIssues({ defaultAccount: "codex" })).toEqual([DEFAULT_MESSAGE]);
    expect(settingsIssues({ defaultAccount: "claude-" })).toEqual([DEFAULT_MESSAGE]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/shared/settings.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './settings.js' imported from /workspace/utils/paseo/plugins/claude-accounts/shared/settings.test.ts`, and no test runs. The module does not exist yet; vitest 4.1.7 prints Vite's "Failed to load url" only as this error's cause (`node_modules/vitest/dist/chunks/startVitestModuleRunner.bRl2_oI_.js:712-718`), so match on `Cannot find module` and the file name.

- [ ] **Step 3: Write the settings module.** Create `plugins/claude-accounts/shared/settings.ts`:

```ts
import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** The provider that launches the main Claude Code profile. */
export const MAIN_PROVIDER = "claude";
/** The default-account value that picks the signed-in account with the most room. */
export const AUTO_ACCOUNT = "auto";
export const ACCOUNT_NAME_MAX = 32;

// `claude-<name>` has to stay a valid provider id (/^[a-z][a-z0-9-]*$/) and `~/.claude-<name>` a
// plain directory name.
export const AccountNameSchema = z
  .string()
  .max(ACCOUNT_NAME_MAX, `Use at most ${ACCOUNT_NAME_MAX} characters`)
  .regex(
    /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    "Use lowercase letters and digits, with single dashes between them",
  );

export function accountProvider(name: string): string {
  return `${MAIN_PROVIDER}-${name}`;
}

const DefaultAccountSchema = z
  .string()
  .regex(/^(auto|claude|claude-[a-z0-9]+(?:-[a-z0-9]+)*)$/, "Pick Auto or one of the accounts");

export const claudeAccountsSettings = defineSettings({
  id: "default-account",
  scope: "host",
  version: 1,
  schema: z.object({ defaultAccount: DefaultAccountSchema.default(MAIN_PROVIDER) }),
});
```

- [ ] **Step 4: Run the settings test again.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/shared/settings.test.ts --bail=1
```

Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Write the RPC contracts.** Create `plugins/claude-accounts/shared/rpc.ts`. It has no behaviour beyond zod, so Step 11's typecheck is its check until Task 9 uses it:

```ts
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";
import { AccountNameSchema } from "./settings.js";

/** The account's tightest usage window, as the daemon picks it (`tightestUsageWindow`). */
export const AccountUsageSchema = z.object({
  usedPct: z.number(),
  windowLabel: z.string(),
  planLabel: z.string().nullable(),
});

export const AccountSchema = z.object({
  provider: z.string(),
  directory: z.string(),
  label: z.string(),
  main: z.boolean(),
  signedIn: z.boolean(),
  loginExpired: z.boolean(),
  /** The provider exists, launches this directory, is on and has loaded. */
  providerReady: z.boolean(),
  usage: AccountUsageSchema.nullable(),
  agents: z.object({ total: z.number(), busy: z.number() }),
  problems: z.array(z.string()),
});

export const MoveJobSchema = z.object({
  from: z.string(),
  to: z.string(),
  /** Agents on `from` that were idle when the job started: the ones it moves. */
  total: z.number(),
  /** Agents on `from` that were in a turn when the job started; they stay where they are. */
  busy: z.number(),
  moved: z.number(),
  /** Moves that continued through a history handoff instead of the native session. */
  handedOff: z.number(),
  /** Idle agents that started a turn or went away before their move. */
  skipped: z.number(),
  failed: z.array(z.object({ agentId: z.string(), error: z.string() })),
  done: z.boolean(),
});

export const ActionResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  /** The workspace whose terminal runs `claude auth login`, or null when none opened. */
  loginWorkspaceId: z.string().nullable(),
});

export const AccountListSchema = z.object({
  accounts: z.array(AccountSchema),
  /** The first usage lookup error, such as "Usage is off on this host.". */
  usageError: z.string().nullable(),
  moveJob: MoveJobSchema.nullable(),
});

export const MoveIdleResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
  job: MoveJobSchema.nullable(),
});

export type AccountUsage = z.output<typeof AccountUsageSchema>;
export type Account = z.output<typeof AccountSchema>;
export type MoveJob = z.output<typeof MoveJobSchema>;
export type ActionResult = z.output<typeof ActionResultSchema>;
export type AccountList = z.output<typeof AccountListSchema>;
export type MoveIdleResult = z.output<typeof MoveIdleResultSchema>;

export const listAccountsRpc = defineRpc({
  name: "claude-accounts.list.request",
  input: z.object({}),
  output: AccountListSchema,
});

export const addAccountRpc = defineRpc({
  name: "claude-accounts.add.request",
  input: z.object({ name: AccountNameSchema }),
  output: ActionResultSchema,
});

export const signInRpc = defineRpc({
  name: "claude-accounts.sign-in.request",
  input: z.object({ provider: z.string() }),
  output: ActionResultSchema,
});

export const moveIdleRpc = defineRpc({
  name: "claude-accounts.move-idle.request",
  input: z.object({ from: z.string(), to: z.string() }),
  output: MoveIdleResultSchema,
});
```

- [ ] **Step 6: Register the built-in.** In `packages/server/src/server/plugins/builtin/index.ts`, add `"claude-accounts",` to `builtinPlugins` right before `"claude-usage-source",`, so the array stays sorted. No type depends on the array's union; `BuiltinPluginLoader`, `builtin/index.test.ts`, `scripts/builtin-plugins-dist.test.mjs` and the packaged-app smoke only iterate it.

- [ ] **Step 7: Run the built-in compile test and watch it fail.** Run:

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: FAIL with `Error: Plugin manifest is missing: /workspace/utils/paseo/plugins/claude-accounts/paseo-plugin.json`, thrown by `readPluginManifest` (`packages/server/src/server/plugins/manifest.ts:44`) at the test's first `expect`.

- [ ] **Step 8: Write the manifest and the minimal server entry.** Create `plugins/claude-accounts/paseo-plugin.json` in the one-line form the other built-ins use:

```json
{ "id": "claude-accounts", "requirements": { "paseo": ">=0.15.0" } }
```

Create `plugins/claude-accounts/index.server.ts`:

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { claudeAccountsSettings } from "./shared/settings.js";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(claudeAccountsSettings);
  return () => {};
}
```

Built-ins start in every daemon, test daemons included. This entry only registers the setting, and an absent settings file reads as `{ defaultAccount: "claude" }`, so startup writes nothing.

- [ ] **Step 9: Run the built-in registry test file.** Run:

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts --bail=1
```

Expected: `Tests  4 passed (4)`. The compile test now reads the manifest and bundles `index.server.ts` through `shared/settings.ts` with the esbuild boundary checks; the client bundle is `null` until Task 10.

- [ ] **Step 10: Format and lint.** Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-accounts packages/server/src/server/plugins/builtin/index.ts
cd /workspace/utils/paseo && npm run lint -- plugins/claude-accounts packages/server/src/server/plugins/builtin/index.ts
```

Expected: the formatter exits 0; lint reports `Found 0 warnings and 0 errors.` If the formatter changed `settings.ts` or its test, rerun Step 4.

- [ ] **Step 11: Typecheck the plugins workspace.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0. `plugins/tsconfig.json` excludes `*.test.ts`.

- [ ] **Step 12: Commit with the fork identity (local only, never push).** Run:

```bash
git -C /workspace/utils/paseo add plugins/claude-accounts packages/server/src/server/plugins/builtin/index.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): scaffold claude-accounts built-in plugin" -- plugins/claude-accounts packages/server/src/server/plugins/builtin/index.ts
```

Expected: the hook's jobs pass, then `[main <sha>] feat(fork): scaffold claude-accounts built-in plugin` and `6 files changed`. If a hook job fails, report its output and stop.

- [ ] **Step 13: Verify the commit.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an|%ae|%cn|%ce' | grep -qxF 'tatsuya|allrested@gmail.com|tatsuya|allrested@gmail.com' && echo "fork identity" || echo "WRONG IDENTITY"
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk
```

Expected: `fork identity`; the subject and the six paths; an empty status.

### Task 4: Profile discovery and the added-accounts record

**Files:**

- Create: `plugins/claude-accounts/server/errors.ts`
- Create: `plugins/claude-accounts/server/profiles.ts`, `plugins/claude-accounts/server/profiles.test.ts`

**Interfaces:**

- Consumes: Task 3's `AccountNameSchema`, `MAIN_PROVIDER`, `accountProvider`.
- Produces (`errors.ts`): `errorCode(error: unknown): string | null` (a Node system error's `code`), `errorMessage(error: unknown): string`.
- Produces (`profiles.ts`):
  - `interface ProfilePaths { home: string; mainDirectory: string; mainViaEnv: boolean; recordFile: string }` and `profilePaths(env: NodeJS.ProcessEnv, home: string): ProfilePaths`. `mainDirectory` is `resolve(env.CLAUDE_CONFIG_DIR ?? <home>/.claude)`; `recordFile` is `<PASEO_HOME>/claude-accounts/added.json` with `PASEO_HOME` defaulting to `~/.paseo`.
  - `interface Profile { name: string | null; provider: string; directory: string; main: boolean; viaEnv: boolean; credentials: boolean; added: boolean }` and `interface Profiles { main: Profile; accounts: Profile[] }`.
  - `discoverProfiles(paths: ProfilePaths, added: readonly string[]): Promise<Profiles>`: accounts are the directories (symbolic links followed) named `.claude-<name>` in the home whose `<name>` passes `AccountNameSchema`, sorted by name, without the main directory.
  - `accountDirectory(home: string, name: string): string`, `hasCredentials(directory: string): Promise<boolean>`.
  - `claudeConfigFile(profile: Pick<Profile, "directory" | "viaEnv">, home: string): Promise<string>` (Decision 5).
  - `readAddedAccounts(recordFile: string): Promise<string[]>` (missing file reads as `[]`; anything else that does not parse throws `` `${recordFile} is not valid. Fix it, or delete it and add the accounts again.` ``) and `recordAddedAccount(recordFile: string, name: string): Promise<void>` (idempotent, sorted, temp file and `rename`, file 0600, directory 0700).

- [ ] **Step 1: Write the failing tests.** Create `plugins/claude-accounts/server/profiles.test.ts`:

```ts
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  claudeConfigFile,
  discoverProfiles,
  profilePaths,
  readAddedAccounts,
  recordAddedAccount,
  type ProfilePaths,
  type Profiles,
} from "./profiles.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function tempHome(): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "claude-accounts-"));
  roots.push(home);
  return home;
}

function invalidRecord(recordFile: string): string {
  return `${recordFile} is not valid. Fix it, or delete it and add the accounts again.`;
}

describe("profilePaths", () => {
  it("uses ~/.claude and ~/.paseo when the daemon sets neither variable", () => {
    const expected: ProfilePaths = {
      home: "/home/u",
      mainDirectory: "/home/u/.claude",
      mainViaEnv: false,
      recordFile: "/home/u/.paseo/claude-accounts/added.json",
    };
    expect(profilePaths({}, "/home/u")).toEqual(expected);
  });

  it("follows the daemon's CLAUDE_CONFIG_DIR and PASEO_HOME", () => {
    const expected: ProfilePaths = {
      home: "/home/u",
      mainDirectory: "/srv/claude",
      mainViaEnv: true,
      recordFile: "/home/u/dev/paseo-home/claude-accounts/added.json",
    };
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CONFIG_DIR: "/srv/claude",
      PASEO_HOME: "~/dev/paseo-home",
    };
    expect(profilePaths(env, "/home/u")).toEqual(expected);
  });
});

describe("discoverProfiles", () => {
  it("lists the main profile and the account directories by name", async () => {
    const home = await tempHome();
    await mkdir(join(home, ".claude"));
    await mkdir(join(home, ".claude-work"));
    await writeFile(join(home, ".claude-work", ".credentials.json"), "{}");
    await mkdir(join(home, ".claude-team-2"));
    await mkdir(join(home, ".claude-Bad"));
    await writeFile(join(home, ".claude-file"), "");
    await symlink(join(home, ".claude-work"), join(home, ".claude-linked"));

    const expected: Profiles = {
      main: {
        name: null,
        provider: "claude",
        directory: join(home, ".claude"),
        main: true,
        viaEnv: false,
        credentials: false,
        added: false,
      },
      accounts: [
        {
          name: "linked",
          provider: "claude-linked",
          directory: join(home, ".claude-linked"),
          main: false,
          viaEnv: true,
          credentials: true,
          added: false,
        },
        {
          name: "team-2",
          provider: "claude-team-2",
          directory: join(home, ".claude-team-2"),
          main: false,
          viaEnv: true,
          credentials: false,
          added: false,
        },
        {
          name: "work",
          provider: "claude-work",
          directory: join(home, ".claude-work"),
          main: false,
          viaEnv: true,
          credentials: true,
          added: true,
        },
      ],
    };
    expect(await discoverProfiles(profilePaths({}, home), ["work"])).toEqual(expected);
  });

  it("treats the daemon's CLAUDE_CONFIG_DIR as the main profile, never as an account", async () => {
    const home = await tempHome();
    await mkdir(join(home, ".claude-main"));
    await mkdir(join(home, ".claude-work"));
    const paths = profilePaths({ CLAUDE_CONFIG_DIR: join(home, ".claude-main") }, home);

    const { main, accounts } = await discoverProfiles(paths, []);

    expect(main.directory).toBe(join(home, ".claude-main"));
    expect(main.viaEnv).toBe(true);
    expect(accounts.map((account) => account.provider)).toEqual(["claude-work"]);
  });
});

describe("claudeConfigFile", () => {
  it("follows Claude Code's rule for the global config file", async () => {
    const home = await tempHome();
    const account = join(home, ".claude-work");
    await mkdir(account);

    expect(await claudeConfigFile({ directory: join(home, ".claude"), viaEnv: false }, home)).toBe(
      join(home, ".claude.json"),
    );
    expect(await claudeConfigFile({ directory: account, viaEnv: true }, home)).toBe(
      join(account, ".claude.json"),
    );
    await writeFile(join(account, ".config.json"), "{}");
    expect(await claudeConfigFile({ directory: account, viaEnv: true }, home)).toBe(
      join(account, ".config.json"),
    );
  });
});

describe("the added-accounts record", () => {
  it("reads a missing record as no accounts", async () => {
    const home = await tempHome();
    expect(await readAddedAccounts(join(home, "paseo", "claude-accounts", "added.json"))).toEqual(
      [],
    );
  });

  it("writes sorted names once, with mode 0600 inside a 0700 directory", async () => {
    const home = await tempHome();
    const recordFile = join(home, "paseo", "claude-accounts", "added.json");

    await recordAddedAccount(recordFile, "work");
    await recordAddedAccount(recordFile, "team");
    await recordAddedAccount(recordFile, "work");

    expect(await readAddedAccounts(recordFile)).toEqual(["team", "work"]);
    expect(JSON.parse(await readFile(recordFile, "utf8"))).toEqual({
      version: 1,
      names: ["team", "work"],
    });
    expect((await stat(recordFile)).mode & 0o777).toBe(0o600);
    expect((await stat(join(home, "paseo", "claude-accounts"))).mode & 0o777).toBe(0o700);
  });

  it("refuses a record that is not valid JSON or names an invalid account", async () => {
    const home = await tempHome();
    const recordFile = join(home, "added.json");

    await writeFile(recordFile, "{ not json");
    await expect(readAddedAccounts(recordFile)).rejects.toThrow(invalidRecord(recordFile));
    await writeFile(recordFile, JSON.stringify({ version: 1, names: ["../x"] }));
    await expect(readAddedAccounts(recordFile)).rejects.toThrow(invalidRecord(recordFile));
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/server/profiles.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './profiles.js' imported from /workspace/utils/paseo/plugins/claude-accounts/server/profiles.test.ts`, and no test runs.

- [ ] **Step 3: Write the error helpers.** Create `plugins/claude-accounts/server/errors.ts`:

```ts
/** The `code` of a Node system error, such as "ENOENT", or null. */
export function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) return null;
  return typeof error.code === "string" ? error.code : null;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Write the profiles module.** Create `plugins/claude-accounts/server/profiles.ts`:

```ts
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { z } from "zod";
import { AccountNameSchema, MAIN_PROVIDER, accountProvider } from "../shared/settings.js";
import { errorCode } from "./errors.js";

export interface ProfilePaths {
  home: string;
  /** The main profile: the daemon's CLAUDE_CONFIG_DIR when set, else ~/.claude. */
  mainDirectory: string;
  /** The daemon launches the main profile with CLAUDE_CONFIG_DIR set. */
  mainViaEnv: boolean;
  /** The accounts Add account wrote into: `<PASEO_HOME>/claude-accounts/added.json`. */
  recordFile: string;
}

export interface Profile {
  /** The account name; null for the main profile. */
  name: string | null;
  provider: string;
  directory: string;
  main: boolean;
  /** Launched with CLAUDE_CONFIG_DIR, so Claude Code keeps its config file in the directory. */
  viaEnv: boolean;
  /** `.credentials.json` exists in the directory. */
  credentials: boolean;
  /** Add account created or adopted it on this host. */
  added: boolean;
}

export interface Profiles {
  main: Profile;
  /** Sorted by name. */
  accounts: Profile[];
}

const ACCOUNT_PREFIX = ".claude-";

// Mirrors resolvePaseoHome (packages/server/src/server/paseo-home.ts) and claudeConfigDir
// (packages/server/src/server/agent/providers/claude/project-dir.ts), which a plugin bundle cannot
// import. Built-ins run in the daemon process, so `env` is the daemon's env.
export function profilePaths(env: NodeJS.ProcessEnv, home: string): ProfilePaths {
  const configDir = env.CLAUDE_CONFIG_DIR;
  const paseoHome = resolve(expandHome(env.PASEO_HOME ?? "~/.paseo", home));
  return {
    home,
    mainDirectory: resolve(configDir ?? join(home, ".claude")),
    mainViaEnv: configDir !== undefined,
    recordFile: join(paseoHome, "claude-accounts", "added.json"),
  };
}

function expandHome(input: string, home: string): string {
  if (input === "~") return home;
  return input.startsWith("~/") ? join(home, input.slice(2)) : input;
}

export function accountDirectory(home: string, name: string): string {
  return join(home, `${ACCOUNT_PREFIX}${name}`);
}

export async function discoverProfiles(
  paths: ProfilePaths,
  added: readonly string[],
): Promise<Profiles> {
  const main: Profile = {
    name: null,
    provider: MAIN_PROVIDER,
    directory: paths.mainDirectory,
    main: true,
    viaEnv: paths.mainViaEnv,
    credentials: await hasCredentials(paths.mainDirectory),
    added: false,
  };
  const entries = (await readdir(paths.home))
    .filter((entry) => entry.startsWith(ACCOUNT_PREFIX))
    .sort((left, right) => left.localeCompare(right, "en"));
  const accounts: Profile[] = [];
  for (const entry of entries) {
    const name = entry.slice(ACCOUNT_PREFIX.length);
    const directory = join(paths.home, entry);
    if (!AccountNameSchema.safeParse(name).success || directory === paths.mainDirectory) continue;
    if (!(await isDirectory(directory))) continue;
    accounts.push({
      name,
      provider: accountProvider(name),
      directory,
      main: false,
      viaEnv: true,
      credentials: await hasCredentials(directory),
      added: added.includes(name),
    });
  }
  return { main, accounts };
}

export function hasCredentials(directory: string): Promise<boolean> {
  return isFile(join(directory, ".credentials.json"));
}

/**
 * Claude Code's global config file for a profile: `.config.json` in the profile directory when it
 * exists, else `.claude.json` in CLAUDE_CONFIG_DIR, or in the home for a profile launched without
 * the variable.
 */
export async function claudeConfigFile(
  profile: Pick<Profile, "directory" | "viaEnv">,
  home: string,
): Promise<string> {
  const legacy = join(profile.directory, ".config.json");
  if (await isFile(legacy)) return legacy;
  return join(profile.viaEnv ? profile.directory : home, ".claude.json");
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

// Follows symbolic links, so a linked account directory counts.
async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function isMissing(error: unknown): boolean {
  const code = errorCode(error);
  return code === "ENOENT" || code === "ENOTDIR";
}

const AddedRecordSchema = z.object({
  version: z.literal(1),
  names: z.array(AccountNameSchema),
});

export async function readAddedAccounts(recordFile: string): Promise<string[]> {
  let text: string;
  try {
    text = await readFile(recordFile, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return [];
    throw error;
  }
  const record = AddedRecordSchema.safeParse(parseJson(text));
  if (!record.success) {
    throw new Error(`${recordFile} is not valid. Fix it, or delete it and add the accounts again.`);
  }
  return record.data.names;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Adds a name to the record through a temp file, with mode 0600. */
export async function recordAddedAccount(recordFile: string, name: string): Promise<void> {
  const names = await readAddedAccounts(recordFile);
  if (names.includes(name)) return;
  const next = [...names, name].sort((left, right) => left.localeCompare(right, "en"));
  await mkdir(dirname(recordFile), { recursive: true, mode: 0o700 });
  const temp = `${recordFile}.${process.pid}.tmp`;
  await rm(temp, { force: true });
  await writeFile(temp, `${JSON.stringify({ version: 1, names: next }, null, 2)}\n`, {
    mode: 0o600,
    flag: "wx",
  });
  await rename(temp, recordFile);
}
```

- [ ] **Step 5: Run the tests again.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/server/profiles.test.ts --bail=1
```

Expected: `Tests  8 passed (8)`.

- [ ] **Step 6: Format, lint and typecheck.** Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-accounts/server/errors.ts plugins/claude-accounts/server/profiles.ts plugins/claude-accounts/server/profiles.test.ts
cd /workspace/utils/paseo && npm run lint -- plugins/claude-accounts/server/errors.ts plugins/claude-accounts/server/profiles.ts plugins/claude-accounts/server/profiles.test.ts
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: lint `Found 0 warnings and 0 errors.`; typecheck exit 0. Rerun Step 5 if the formatter changed a file.

- [ ] **Step 7: Commit with the fork identity (local only, never push).** Run:

```bash
git -C /workspace/utils/paseo add plugins/claude-accounts/server/errors.ts plugins/claude-accounts/server/profiles.ts plugins/claude-accounts/server/profiles.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): discover Claude profiles and record added accounts" -- plugins/claude-accounts/server/errors.ts plugins/claude-accounts/server/profiles.ts plugins/claude-accounts/server/profiles.test.ts
```

Expected: the hook's jobs pass, then `3 files changed`. If a hook job fails, report its output and stop.

- [ ] **Step 8: Verify the commit.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an|%ae|%cn|%ce' | grep -qxF 'tatsuya|allrested@gmail.com|tatsuya|allrested@gmail.com' && echo "fork identity" || echo "WRONG IDENTITY"
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk
```

Expected: `fork identity`; the subject and the three paths; an empty status.

### Task 5: Shared setup links

**Files:**

- Create: `plugins/claude-accounts/server/setup-link.ts`, `plugins/claude-accounts/server/setup-link.test.ts`

**Interfaces:**

- Consumes: Task 4's `errorCode`.
- Produces:
  - `SHARED_ENTRIES = ["settings.json", "CLAUDE.md", "skills", "plugins", "commands", "agents"] as const`.
  - `type SetupAction = "link" | "linked" | "keep" | "absent"` and `interface SetupStep { entry: string; action: SetupAction; target: string }`, where `target` is the main profile's entry. `absent`: the main profile has no such entry. `link`: the account lacks it. `linked`: the account holds a symbolic link to `target`. `keep`: the account holds anything else there, which is never replaced.
  - `planSetupLink(mainDirectory: string, accountDirectory: string): Promise<SetupStep[]>`, in `SHARED_ENTRIES` order.
  - `applySetupLink(steps: readonly SetupStep[], accountDirectory: string): Promise<SetupStep[]>`: creates an absolute symbolic link for every `link` step; a path that appeared since the plan (`EEXIST`) becomes `keep`.
  - `setupProblems(steps: readonly SetupStep[]): string[]`: `keep` gives `` `${entry} exists in this account's directory, so the main account's ${entry} is not shared` ``; `link` gives `` `${entry} is not shared yet. Add the account again to share it.` ``.

- [ ] **Step 1: Write the failing tests.** Create `plugins/claude-accounts/server/setup-link.test.ts`:

```ts
import {
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { applySetupLink, planSetupLink, setupProblems, type SetupStep } from "./setup-link.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Profiles {
  main: string;
  account: string;
}

async function profiles(): Promise<Profiles> {
  const root = await mkdtemp(join(tmpdir(), "claude-accounts-"));
  roots.push(root);
  const main = join(root, ".claude");
  const account = join(root, ".claude-work");
  await mkdir(join(main, "skills"), { recursive: true });
  await mkdir(join(main, "plugins"));
  await mkdir(join(main, "commands"));
  await writeFile(join(main, "settings.json"), "{}");
  await mkdir(join(account, "commands"), { recursive: true });
  return { main, account };
}

const COMMANDS_KEPT =
  "commands exists in this account's directory, so the main account's commands is not shared";

describe("setup links", () => {
  it("links what the main profile has and the account lacks, and keeps the account's own", async () => {
    const { main, account } = await profiles();

    const plan = await planSetupLink(main, account);
    const expectedPlan: SetupStep[] = [
      { entry: "settings.json", action: "link", target: join(main, "settings.json") },
      { entry: "CLAUDE.md", action: "absent", target: join(main, "CLAUDE.md") },
      { entry: "skills", action: "link", target: join(main, "skills") },
      { entry: "plugins", action: "link", target: join(main, "plugins") },
      { entry: "commands", action: "keep", target: join(main, "commands") },
      { entry: "agents", action: "absent", target: join(main, "agents") },
    ];
    expect(plan).toEqual(expectedPlan);
    expect(setupProblems(plan)).toEqual([
      "settings.json is not shared yet. Add the account again to share it.",
      "skills is not shared yet. Add the account again to share it.",
      "plugins is not shared yet. Add the account again to share it.",
      COMMANDS_KEPT,
    ]);

    const applied = await applySetupLink(plan, account);

    expect(applied.map((step) => step.action)).toEqual([
      "linked",
      "absent",
      "linked",
      "linked",
      "keep",
      "absent",
    ]);
    expect(await readlink(join(account, "settings.json"))).toBe(join(main, "settings.json"));
    expect(await readlink(join(account, "skills"))).toBe(join(main, "skills"));
    expect(await readlink(join(account, "plugins"))).toBe(join(main, "plugins"));
    expect((await lstat(join(account, "commands"))).isDirectory()).toBe(true);
    expect(setupProblems(await planSetupLink(main, account))).toEqual([COMMANDS_KEPT]);
  });

  it("keeps a path that appeared after the plan instead of replacing it", async () => {
    const { main, account } = await profiles();
    const plan = await planSetupLink(main, account);
    await writeFile(join(account, "settings.json"), '{"theme":"dark"}');

    const applied = await applySetupLink(plan, account);

    expect(applied[0]).toEqual({
      entry: "settings.json",
      action: "keep",
      target: join(main, "settings.json"),
    });
    expect(await readFile(join(account, "settings.json"), "utf8")).toBe('{"theme":"dark"}');
  });

  it("counts a link to somewhere else as the account's own", async () => {
    const { main, account } = await profiles();
    await symlink(join(main, "commands"), join(account, "skills"));

    const plan = await planSetupLink(main, account);

    expect(plan[2]).toEqual({ entry: "skills", action: "keep", target: join(main, "skills") });
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/server/setup-link.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './setup-link.js' imported from /workspace/utils/paseo/plugins/claude-accounts/server/setup-link.test.ts`, and no test runs.

- [ ] **Step 3: Write the module.** Create `plugins/claude-accounts/server/setup-link.ts`:

```ts
import type { Stats } from "node:fs";
import { lstat, readlink, symlink } from "node:fs/promises";
import { join } from "node:path";
import { errorCode } from "./errors.js";

/** What an account shares with the main profile, each through an absolute symbolic link. */
export const SHARED_ENTRIES = [
  "settings.json",
  "CLAUDE.md",
  "skills",
  "plugins",
  "commands",
  "agents",
] as const;

export type SetupAction = "link" | "linked" | "keep" | "absent";

export interface SetupStep {
  entry: string;
  action: SetupAction;
  /** The main profile's entry, which the link points at. */
  target: string;
}

export async function planSetupLink(
  mainDirectory: string,
  accountDirectory: string,
): Promise<SetupStep[]> {
  const steps: SetupStep[] = [];
  for (const entry of SHARED_ENTRIES) {
    const target = join(mainDirectory, entry);
    steps.push({ entry, target, action: await planEntry(target, join(accountDirectory, entry)) });
  }
  return steps;
}

async function planEntry(target: string, path: string): Promise<SetupAction> {
  if ((await lstatOrNull(target)) === null) return "absent";
  const current = await lstatOrNull(path);
  if (current === null) return "link";
  if (current.isSymbolicLink() && (await readlink(path)) === target) return "linked";
  return "keep";
}

/** Creates the planned links. A path that appeared since the plan is kept, never replaced. */
export async function applySetupLink(
  steps: readonly SetupStep[],
  accountDirectory: string,
): Promise<SetupStep[]> {
  const applied: SetupStep[] = [];
  for (const step of steps) {
    if (step.action === "link") {
      applied.push({
        ...step,
        action: await link(step.target, join(accountDirectory, step.entry)),
      });
    } else {
      applied.push(step);
    }
  }
  return applied;
}

async function link(target: string, path: string): Promise<SetupAction> {
  try {
    await symlink(target, path);
    return "linked";
  } catch (error) {
    if (errorCode(error) === "EEXIST") return "keep";
    throw error;
  }
}

export function setupProblems(steps: readonly SetupStep[]): string[] {
  const problems: string[] = [];
  for (const { entry, action } of steps) {
    if (action === "keep") {
      problems.push(
        `${entry} exists in this account's directory, so the main account's ${entry} is not shared`,
      );
    }
    if (action === "link") {
      problems.push(`${entry} is not shared yet. Add the account again to share it.`);
    }
  }
  return problems;
}

async function lstatOrNull(path: string): Promise<Stats | null> {
  try {
    return await lstat(path);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return null;
    throw error;
  }
}
```

- [ ] **Step 4: Run the tests again.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/server/setup-link.test.ts --bail=1
```

Expected: `Tests  3 passed (3)`.

- [ ] **Step 5: Format, lint and typecheck.** Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-accounts/server/setup-link.ts plugins/claude-accounts/server/setup-link.test.ts
cd /workspace/utils/paseo && npm run lint -- plugins/claude-accounts/server/setup-link.ts plugins/claude-accounts/server/setup-link.test.ts
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: lint `Found 0 warnings and 0 errors.`; typecheck exit 0.

- [ ] **Step 6: Commit with the fork identity (local only, never push).** Run:

```bash
git -C /workspace/utils/paseo add plugins/claude-accounts/server/setup-link.ts plugins/claude-accounts/server/setup-link.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): link an account's setup to the main Claude profile" -- plugins/claude-accounts/server/setup-link.ts plugins/claude-accounts/server/setup-link.test.ts
```

Expected: the hook's jobs pass, then `2 files changed`. If a hook job fails, report its output and stop.

- [ ] **Step 7: Verify the commit.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an|%ae|%cn|%ce' | grep -qxF 'tatsuya|allrested@gmail.com|tatsuya|allrested@gmail.com' && echo "fork identity" || echo "WRONG IDENTITY"
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk
```

Expected: `fork identity`; the subject and the two paths; an empty status.

### Task 6: `mcpServers` sync

**Files:**

- Create: `plugins/claude-accounts/server/claude-config.ts`
- Create: `plugins/claude-accounts/server/mcp-sync.ts`, `plugins/claude-accounts/server/mcp-sync.test.ts`

**Interfaces:**

- Consumes: Task 4's `errorCode`, `errorMessage`.
- Produces (`claude-config.ts`):
  - `type ConfigObject = Record<string, unknown>`; `type ConfigRead = { status: "ok"; config: ConfigObject; mode: number } | { status: "missing" } | { status: "unreadable"; reason: string }`.
  - `readClaudeConfig(file: string, options: { followLinks: boolean }): Promise<ConfigRead>`. Reasons: `"is a symbolic link"` (only with `followLinks: false`), `"is not a valid JSON object"`, `` `could not be read (${message})` ``.
  - `canonicalJson(value: unknown): string` (object keys sorted at every depth; `""` for `undefined`).
  - `writeClaudeConfig(file: string, config: ConfigObject, mode: number): Promise<void>` (temp file `.<name>.claude-accounts-<pid>.tmp` beside it, `chmod`, `rename`).
  - `type LockedRun<T> = { status: "done"; value: T } | { status: "locked"; stale: boolean }` and `withConfigLock<T>(file: string, run: () => Promise<T>): Promise<LockedRun<T>>`: takes Claude Code's `<file>.lock` directory with `mkdir`, removes only a lock it took, and calls a lock older than 60 s stale.
- Produces (`mcp-sync.ts`):
  - `type SyncResult = { status: "copied" } | { status: "same" } | { status: "skipped"; problem: string | null }` and `syncMcpServers(mainFile: string, accountFile: string): Promise<SyncResult>` (Decision 7). Problems: `` `The main account's ${base} ${reason}, so MCP servers are not copied` ``, `` `${base} ${reason}, so MCP servers are not copied into it` ``, `` `${base}.lock is older than a minute, so MCP servers are not copied. Remove it if no Claude Code process uses this account.` ``, where `base` is the file's base name.
  - `interface SyncTarget { provider: string; mainFile: string; accountFile: string }`, `interface McpWatcherOptions { targets(): Promise<SyncTarget[]>; intervalMs: number; logError(message: string, error: unknown): void }`, `interface McpWatcher { tick(): Promise<void>; problem(provider: string): string | null; stop(): Promise<void> }` and `watchMcpServers(options): McpWatcher`. It runs a pass at once and then every `intervalMs` (timer `unref`'d), never overlaps passes, never rejects from `tick()`, logs each distinct failure once, and a thrown sync becomes the row problem `` `MCP servers were not copied: ${message}` ``.

- [ ] **Step 1: Write the failing tests.** Create `plugins/claude-accounts/server/mcp-sync.test.ts`. The server entries are fixtures; their header value is not a real token:

```ts
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncMcpServers, watchMcpServers, type McpWatcher, type SyncTarget } from "./mcp-sync.js";

/** A user-scope MCP server as Claude Code stores it; the plugin copies these as opaque JSON. */
interface McpServerFixture {
  type: string;
  url: string;
  headers?: Record<string, string>;
}

const CONTEXT7: McpServerFixture = { type: "http", url: "http://127.0.0.1:8932/mcp" };
const GITLAB: McpServerFixture = {
  type: "http",
  url: "http://127.0.0.1:8933/mcp",
  headers: { Authorization: "Bearer fixture-not-a-token" },
};
const SERVERS: Record<string, McpServerFixture> = { context7: CONTEXT7, gitlab: GITLAB };
const STALE_LOCK =
  ".claude.json.lock is older than a minute, so MCP servers are not copied. Remove it if no Claude Code process uses this account.";

const roots: string[] = [];
const watchers: McpWatcher[] = [];

afterEach(async () => {
  await Promise.all(watchers.splice(0).map((watcher) => watcher.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

interface Files {
  mainFile: string;
  accountFile: string;
}

async function files(): Promise<Files> {
  const root = await mkdtemp(join(tmpdir(), "claude-accounts-"));
  roots.push(root);
  await mkdir(join(root, ".claude-work"));
  return {
    mainFile: join(root, ".claude.json"),
    accountFile: join(root, ".claude-work", ".claude.json"),
  };
}

async function writeJson(file: string, value: unknown): Promise<void> {
  await writeFile(file, JSON.stringify(value));
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

async function ageLock(lock: string): Promise<void> {
  const twoMinutesAgo = new Date(Date.now() - 120_000);
  await utimes(lock, twoMinutesAgo, twoMinutesAgo);
}

describe("syncMcpServers", () => {
  it("creates a missing account file holding only mcpServers, with mode 0600", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { numStartups: 9, mcpServers: SERVERS });

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({ status: "copied" });

    expect(await readJson(accountFile)).toEqual({ mcpServers: SERVERS });
    expect((await stat(accountFile)).mode & 0o777).toBe(0o600);
  });

  it("replaces mcpServers in place and keeps every other key and the file mode", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { mcpServers: SERVERS });
    await writeJson(accountFile, {
      numStartups: 3,
      mcpServers: { old: CONTEXT7 },
      projects: { "/repo": { allowedTools: [] } },
    });
    await chmod(accountFile, 0o644);

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({ status: "copied" });

    const written = await readJson(accountFile);
    expect(written).toEqual({
      numStartups: 3,
      mcpServers: SERVERS,
      projects: { "/repo": { allowedTools: [] } },
    });
    expect(Object.keys(Object(written))).toEqual(["numStartups", "mcpServers", "projects"]);
    expect((await stat(accountFile)).mode & 0o777).toBe(0o644);
  });

  it("leaves an equal copy alone even when its keys are in another order", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { mcpServers: SERVERS });
    await writeJson(accountFile, {
      mcpServers: {
        gitlab: { headers: GITLAB.headers, url: GITLAB.url, type: "http" },
        context7: CONTEXT7,
      },
    });
    const before = await stat(accountFile);

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({ status: "same" });

    expect((await stat(accountFile)).ino).toBe(before.ino);
  });

  it("removes the account's mcpServers when the main profile has none", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { numStartups: 1 });
    await writeJson(accountFile, { theme: "dark", mcpServers: SERVERS });

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({ status: "copied" });

    expect(await readJson(accountFile)).toEqual({ theme: "dark" });
  });

  it("does nothing while the main file is missing, and reports one it cannot read", async () => {
    const { mainFile, accountFile } = await files();

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({
      status: "skipped",
      problem: null,
    });
    await writeFile(mainFile, "{");
    expect(await syncMcpServers(mainFile, accountFile)).toEqual({
      status: "skipped",
      problem:
        "The main account's .claude.json is not a valid JSON object, so MCP servers are not copied",
    });

    await expect(stat(accountFile)).rejects.toThrow("ENOENT");
  });

  it("never writes through a symbolic link or over a file that is not a JSON object", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { mcpServers: SERVERS });
    const elsewhere = `${mainFile}.elsewhere`;
    await writeJson(elsewhere, { mcpServers: {} });
    await symlink(elsewhere, accountFile);

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({
      status: "skipped",
      problem: ".claude.json is a symbolic link, so MCP servers are not copied into it",
    });
    expect(await readJson(elsewhere)).toEqual({ mcpServers: {} });

    await rm(accountFile);
    await writeFile(accountFile, "[]");
    expect(await syncMcpServers(mainFile, accountFile)).toEqual({
      status: "skipped",
      problem: ".claude.json is not a valid JSON object, so MCP servers are not copied into it",
    });
    expect(await readFile(accountFile, "utf8")).toBe("[]");
  });

  it("waits for Claude Code's lock and reports a stale one without removing it", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { mcpServers: SERVERS });
    await writeJson(accountFile, { mcpServers: {} });
    const lock = `${accountFile}.lock`;
    await mkdir(lock);

    expect(await syncMcpServers(mainFile, accountFile)).toEqual({
      status: "skipped",
      problem: null,
    });
    await ageLock(lock);
    expect(await syncMcpServers(mainFile, accountFile)).toEqual({
      status: "skipped",
      problem: STALE_LOCK,
    });

    expect((await stat(lock)).isDirectory()).toBe(true);
    expect(await readJson(accountFile)).toEqual({ mcpServers: {} });
  });
});

describe("watchMcpServers", () => {
  it("copies on every pass, reports problems per account and logs a failure once", async () => {
    const { mainFile, accountFile } = await files();
    await writeJson(mainFile, { mcpServers: SERVERS });
    const targets: SyncTarget[] = [{ provider: "claude-work", mainFile, accountFile }];
    const logged: string[] = [];
    let recordReadable = true;
    const watcher = watchMcpServers({
      targets: async () => {
        if (!recordReadable) throw new Error("added.json is not valid");
        return targets;
      },
      intervalMs: 60_000,
      logError: (message) => logged.push(message),
    });
    watchers.push(watcher);

    await watcher.tick();
    expect(await readJson(accountFile)).toEqual({ mcpServers: SERVERS });

    await writeJson(mainFile, { mcpServers: { context7: CONTEXT7 } });
    await watcher.tick();
    expect(await readJson(accountFile)).toEqual({ mcpServers: { context7: CONTEXT7 } });

    const lock = `${accountFile}.lock`;
    await mkdir(lock);
    await ageLock(lock);
    await writeJson(mainFile, { mcpServers: SERVERS });
    await watcher.tick();
    expect(watcher.problem("claude-work")).toBe(STALE_LOCK);
    expect(watcher.problem("claude-team")).toBeNull();

    recordReadable = false;
    await watcher.tick();
    await watcher.tick();
    expect(logged).toEqual(["claude-accounts: the MCP server sync failed"]);
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/server/mcp-sync.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './mcp-sync.js' imported from /workspace/utils/paseo/plugins/claude-accounts/server/mcp-sync.test.ts`, and no test runs.

- [ ] **Step 3: Write the config file helpers.** Create `plugins/claude-accounts/server/claude-config.ts`:

```ts
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { errorCode, errorMessage } from "./errors.js";

export type ConfigObject = Record<string, unknown>;

export type ConfigRead =
  | { status: "ok"; config: ConfigObject; mode: number }
  | { status: "missing" }
  | { status: "unreadable"; reason: string };

export interface ReadOptions {
  /** Read through a symbolic link. Only files this plugin never writes are read that way. */
  followLinks: boolean;
}

export async function readClaudeConfig(file: string, options: ReadOptions): Promise<ConfigRead> {
  let text: string;
  let mode: number;
  try {
    if ((await lstat(file)).isSymbolicLink() && !options.followLinks) {
      return { status: "unreadable", reason: "is a symbolic link" };
    }
    mode = (await stat(file)).mode & 0o777;
    text = await readFile(file, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return { status: "missing" };
    return { status: "unreadable", reason: `could not be read (${errorMessage(error)})` };
  }
  const config = parseObject(text);
  if (config === null) return { status: "unreadable", reason: "is not a valid JSON object" };
  return { status: "ok", config, mode };
}

function parseObject(text: string): ConfigObject | null {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  return isConfigObject(value) ? value : null;
}

function isConfigObject(value: unknown): value is ConfigObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** JSON with object keys sorted at every depth, so key order never counts as a change. */
export function canonicalJson(value: unknown): string {
  return value === undefined ? "" : JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((item) => sortKeys(item));
  if (!isConfigObject(value)) return value;
  const sorted: ConfigObject = {};
  for (const key of Object.keys(value).sort((left, right) => (left < right ? -1 : 1))) {
    sorted[key] = sortKeys(value[key]);
  }
  return sorted;
}

/** Replaces the file through a temp file beside it, keeping `mode`. */
export async function writeClaudeConfig(
  file: string,
  config: ConfigObject,
  mode: number,
): Promise<void> {
  const temp = join(dirname(file), `.${basename(file)}.claude-accounts-${process.pid}.tmp`);
  await rm(temp, { force: true });
  await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, { mode, flag: "wx" });
  await chmod(temp, mode);
  await rename(temp, file);
}

export type LockedRun<T> = { status: "done"; value: T } | { status: "locked"; stale: boolean };

// Claude Code writes its config under proper-lockfile, which takes `<file>.lock` with mkdir and
// treats a lock older than 10 s as abandoned. This plugin never removes a lock it did not take.
const STALE_LOCK_MS = 60_000;

export async function withConfigLock<T>(
  file: string,
  run: () => Promise<T>,
): Promise<LockedRun<T>> {
  const lock = `${file}.lock`;
  try {
    await mkdir(lock);
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
    return { status: "locked", stale: await isStale(lock) };
  }
  try {
    return { status: "done", value: await run() };
  } finally {
    await removeLock(lock);
  }
}

async function isStale(lock: string): Promise<boolean> {
  try {
    return Date.now() - (await stat(lock)).mtimeMs > STALE_LOCK_MS;
  } catch (error) {
    if (errorCode(error) === "ENOENT") return false;
    throw error;
  }
}

async function removeLock(lock: string): Promise<void> {
  try {
    await rmdir(lock);
  } catch (error) {
    if (errorCode(error) !== "ENOENT") throw error;
  }
}
```

- [ ] **Step 4: Write the sync and the watcher.** Create `plugins/claude-accounts/server/mcp-sync.ts`:

```ts
import { basename } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import {
  canonicalJson,
  readClaudeConfig,
  withConfigLock,
  writeClaudeConfig,
  type ConfigObject,
  type ConfigRead,
} from "./claude-config.js";
import { errorMessage } from "./errors.js";

export type SyncResult =
  | { status: "copied" }
  | { status: "same" }
  | { status: "skipped"; problem: string | null };

const NEW_FILE_MODE = 0o600;

/**
 * Makes the account's top-level `mcpServers` a copy of the main profile's, removals included,
 * and leaves every other key alone.
 */
export async function syncMcpServers(mainFile: string, accountFile: string): Promise<SyncResult> {
  const main = await readClaudeConfig(mainFile, { followLinks: true });
  if (main.status === "missing") return { status: "skipped", problem: null };
  if (main.status === "unreadable") {
    return {
      status: "skipped",
      problem: `The main account's ${basename(mainFile)} ${main.reason}, so MCP servers are not copied`,
    };
  }
  const wanted = main.config.mcpServers;
  const current = await readClaudeConfig(accountFile, { followLinks: false });
  if (current.status === "unreadable") return notCopied(accountFile, current.reason);
  if (upToDate(current, wanted)) return { status: "same" };
  const locked = await withConfigLock(accountFile, () => copyUnderLock(accountFile, wanted));
  if (locked.status === "done") return locked.value;
  return { status: "skipped", problem: locked.stale ? staleLockProblem(accountFile) : null };
}

// Claude Code may have written the file since the first read, so it is read again under the lock.
async function copyUnderLock(accountFile: string, wanted: unknown): Promise<SyncResult> {
  const current = await readClaudeConfig(accountFile, { followLinks: false });
  if (current.status === "unreadable") return notCopied(accountFile, current.reason);
  if (upToDate(current, wanted)) return { status: "same" };
  if (current.status === "missing") {
    await writeClaudeConfig(accountFile, { mcpServers: wanted }, NEW_FILE_MODE);
  } else {
    await writeClaudeConfig(accountFile, withMcpServers(current.config, wanted), current.mode);
  }
  return { status: "copied" };
}

function upToDate(current: ConfigRead, wanted: unknown): boolean {
  if (current.status === "missing") return wanted === undefined;
  if (current.status !== "ok") return false;
  return canonicalJson(current.config.mcpServers) === canonicalJson(wanted);
}

// Spreading keeps an existing key where it was.
function withMcpServers(config: ConfigObject, servers: unknown): ConfigObject {
  if (servers !== undefined) return { ...config, mcpServers: servers };
  const rest: ConfigObject = {};
  for (const [key, value] of Object.entries(config)) {
    if (key !== "mcpServers") rest[key] = value;
  }
  return rest;
}

function notCopied(accountFile: string, reason: string): SyncResult {
  return {
    status: "skipped",
    problem: `${basename(accountFile)} ${reason}, so MCP servers are not copied into it`,
  };
}

function staleLockProblem(accountFile: string): string {
  return `${basename(accountFile)}.lock is older than a minute, so MCP servers are not copied. Remove it if no Claude Code process uses this account.`;
}

export interface SyncTarget {
  provider: string;
  mainFile: string;
  accountFile: string;
}

export interface McpWatcherOptions {
  /** The accounts to keep in sync, read again on every pass. */
  targets(): Promise<SyncTarget[]>;
  intervalMs: number;
  logError(message: string, error: unknown): void;
}

export interface McpWatcher {
  /** Runs a pass after the one in flight. Never rejects. */
  tick(): Promise<void>;
  /** What the last pass could not do for an account, or null. */
  problem(provider: string): string | null;
  stop(): Promise<void>;
}

export function watchMcpServers(options: McpWatcherOptions): McpWatcher {
  let problems = new Map<string, string>();
  const logged = new Set<string>();
  let chain: Promise<void> = Promise.resolve();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  // The plugin runs inside the daemon: a failure is logged once per distinct message, never thrown.
  function logOnce(message: string, error: unknown): void {
    const key = `${message}\n${errorMessage(error)}`;
    if (logged.has(key)) return;
    logged.add(key);
    options.logError(message, error);
  }

  async function syncOne(target: SyncTarget, next: Map<string, string>): Promise<void> {
    try {
      const result = await syncMcpServers(target.mainFile, target.accountFile);
      if (result.status === "skipped" && result.problem !== null) {
        next.set(target.provider, result.problem);
      }
    } catch (error) {
      next.set(target.provider, `MCP servers were not copied: ${errorMessage(error)}`);
      logOnce(`claude-accounts: copying MCP servers into ${target.provider} failed`, error);
    }
  }

  async function pass(): Promise<void> {
    const next = new Map<string, string>();
    for (const target of await options.targets()) await syncOne(target, next);
    problems = next;
  }

  function tick(): Promise<void> {
    chain = chain
      .then(pass)
      .catch((error: unknown) => logOnce("claude-accounts: the MCP server sync failed", error));
    return chain;
  }

  async function loop(): Promise<void> {
    await tick();
    if (stopped) return;
    timer = setTimeout(() => void loop(), options.intervalMs);
    timer.unref();
  }

  void loop();
  return {
    tick,
    problem: (provider) => problems.get(provider) ?? null,
    async stop() {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      await chain;
    },
  };
}
```

- [ ] **Step 5: Run the tests again.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/server/mcp-sync.test.ts --bail=1
```

Expected: `Tests  8 passed (8)`.

- [ ] **Step 6: Format, lint and typecheck.** Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-accounts/server/claude-config.ts plugins/claude-accounts/server/mcp-sync.ts plugins/claude-accounts/server/mcp-sync.test.ts
cd /workspace/utils/paseo && npm run lint -- plugins/claude-accounts/server/claude-config.ts plugins/claude-accounts/server/mcp-sync.ts plugins/claude-accounts/server/mcp-sync.test.ts
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: lint `Found 0 warnings and 0 errors.`; typecheck exit 0.

- [ ] **Step 7: Commit with the fork identity (local only, never push).** Run:

```bash
git -C /workspace/utils/paseo add plugins/claude-accounts/server/claude-config.ts plugins/claude-accounts/server/mcp-sync.ts plugins/claude-accounts/server/mcp-sync.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): keep added accounts' MCP servers equal to the main profile's" -- plugins/claude-accounts/server/claude-config.ts plugins/claude-accounts/server/mcp-sync.ts plugins/claude-accounts/server/mcp-sync.test.ts
```

Expected: the hook's jobs pass, then `3 files changed`. If a hook job fails, report its output and stop.

- [ ] **Step 8: Verify the commit.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an|%ae|%cn|%ce' | grep -qxF 'tatsuya|allrested@gmail.com|tatsuya|allrested@gmail.com' && echo "fork identity" || echo "WRONG IDENTITY"
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk
```

Expected: `fork identity`; the subject and the three paths; an empty status.

### Task 7: The Paseo port and the default-account choice

**Files:**

- Create: `plugins/claude-accounts/server/api.ts` (types only)
- Create: `plugins/claude-accounts/server/default-account.ts`, `plugins/claude-accounts/server/default-account.test.ts`

**Interfaces:**

- Consumes: Task 2's `PaseoProviderActions.listUsageForProvider` and `PaseoAgentHandle.move` through `PluginHandlerContext["paseo"]` (`packages/plugin/src/server/contracts.ts:9`), from the client declarations Task 2 Step 7 built. Task 3's `AccountUsage`, `MAIN_PROVIDER`, `AUTO_ACCOUNT`. Task 1's required `tone` on the tightest window: the daemon's heads-up tone, `danger` from 95% or a run-out within 30 minutes (Decision 12).
- Produces (`api.ts`):
  - Derived types: `ProviderUsageReports` (what `listUsageForProvider` resolves to), `UsageReportEntry`, `UsageTightestWindow`, `UsageTone` (`"none" | "warning" | "danger"`), `AgentSnapshot`, `ProviderSnapshotEntry`.
  - `interface ProviderUsage { reports: UsageReportEntry[]; tightest: UsageTightestWindow | null; error: string | null }`
  - `interface AgentInfo { id: string; provider: string; cwd: string; status: AgentSnapshot["status"]; inTurn: boolean }`
  - `interface MoveOutcome { agentId: string; strategy: "native" | "handoff" }`
  - `interface ProviderEntry { extends: string | null; enabled: boolean; configDirectory: string | null }`, `interface NewProvider { label: string; configDirectory: string }`, `interface ProviderState { status: ProviderSnapshotEntry["status"]; error: string | null }`, `interface TerminalCommand { name: string; command: string; args: string[] }`
  - `interface AccountsApi { listAgents(); getAgent(agentId); moveAgent(agentId, provider); listUsage(provider); providerEntries(); providerStates(); addProvider(provider, entry); latestWorkspaceId(); openTerminal(workspaceId, command) }` with the signatures in the code below. Task 9's `paseo-port.ts` implements it.
- Produces (`default-account.ts`):
  - `DECIDE_TIMEOUT_MS = 10_000`. No usage threshold: the daemon's tone carries it.
  - `interface UsageSummary { known: boolean; expired: boolean; usage: AccountUsage | null; tone: UsageTone | null }` and `summarizeUsage(usage: ProviderUsage): UsageSummary`.
  - `interface AccountHeadroom { provider: string; usable: boolean; usedPct: number | null; tone: UsageTone | null }` and `chooseAuto(accounts: readonly AccountHeadroom[]): string | null`, which skips an account whose tone is `danger` (Decision 12).
  - `interface CreateRequest { provider: string; cwd: string }`, `interface DefaultAccountDeps { setting(): Promise<string | null>; headroom(only: string | null): Promise<AccountHeadroom[]>; movingToMain(cwd: string): boolean; onError(error: unknown): void; timeoutMs: number }` and `chooseCreateProvider(deps, request): Promise<string>` (Decisions 11, 13 and 18), which never rejects. Task 9 passes `timeoutMs: DECIDE_TIMEOUT_MS`; the test passes a short real one.

- [ ] **Step 1: Write the port types.** Create `plugins/claude-accounts/server/api.ts`. It holds no code, so Step 6's typecheck is its check; it fails there if Task 2's SDK methods are missing from the client declarations:

```ts
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

type PaseoApi = PluginHandlerContext["paseo"];

/** What `paseo.providers.listUsageForProvider` resolves to. */
export type ProviderUsageReports = Awaited<
  ReturnType<PaseoApi["providers"]["listUsageForProvider"]>
>;
export type UsageReportEntry = ProviderUsageReports["reports"][number];
export type UsageTightestWindow = NonNullable<ProviderUsageReports["tightest"]>;
/**
 * The daemon's heads-up tone for the tightest window: `danger` from 95% or a run-out within 30
 * minutes.
 */
export type UsageTone = UsageTightestWindow["tone"];
export type AgentSnapshot = Awaited<
  ReturnType<PaseoApi["agents"]["list"]>
>["entries"][number]["agent"];
export type ProviderSnapshotEntry = Awaited<
  ReturnType<PaseoApi["providers"]["snapshot"]>
>["entries"][number];

export interface ProviderUsage {
  reports: UsageReportEntry[];
  tightest: UsageTightestWindow | null;
  /** The lookup's error, such as "Usage is off on this host.", or null. */
  error: string | null;
}

export interface AgentInfo {
  id: string;
  provider: string;
  cwd: string;
  status: AgentSnapshot["status"];
  /** A turn is running or a permission request is waiting. */
  inTurn: boolean;
}

export interface MoveOutcome {
  /** The successor; the moved agent is archived. */
  agentId: string;
  strategy: "native" | "handoff";
}

/** One `agents.providers` entry of the host config, as far as this plugin reads it. */
export interface ProviderEntry {
  extends: string | null;
  enabled: boolean;
  /** The entry's `env.CLAUDE_CONFIG_DIR`, or null. */
  configDirectory: string | null;
}

export interface NewProvider {
  label: string;
  configDirectory: string;
}

export interface ProviderState {
  status: ProviderSnapshotEntry["status"];
  error: string | null;
}

export interface TerminalCommand {
  name: string;
  command: string;
  args: string[];
}

/** Everything the service needs from Paseo. `paseo-port.ts` implements it over `PaseoApi`. */
export interface AccountsApi {
  /** Every agent that is not archived, internal or in the background. */
  listAgents(): Promise<AgentInfo[]>;
  /** The agent as it is now, or null when it is gone or archived. */
  getAgent(agentId: string): Promise<AgentInfo | null>;
  /** Moves without a continue prompt and resolves with the successor. */
  moveAgent(agentId: string, provider: string): Promise<MoveOutcome>;
  /** Never rejects: a failed lookup comes back in `error`. */
  listUsage(provider: string): Promise<ProviderUsage>;
  /** The host config's provider entries, by provider id. */
  providerEntries(): Promise<Map<string, ProviderEntry>>;
  /** The provider snapshot, by provider id. */
  providerStates(): Promise<Map<string, ProviderState>>;
  addProvider(provider: string, entry: NewProvider): Promise<void>;
  /** The most recently active workspace, or null when there is none. */
  latestWorkspaceId(): Promise<string | null>;
  openTerminal(workspaceId: string, command: TerminalCommand): Promise<void>;
}
```

- [ ] **Step 2: Write the failing tests.** Create `plugins/claude-accounts/server/default-account.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { ProviderUsage, UsageReportEntry } from "./api.js";
import {
  DECIDE_TIMEOUT_MS,
  chooseAuto,
  chooseCreateProvider,
  summarizeUsage,
  type AccountHeadroom,
  type CreateRequest,
  type DefaultAccountDeps,
  type UsageSummary,
} from "./default-account.js";

function entry(report: UsageReportEntry["report"]): UsageReportEntry {
  return {
    id: "claude:test",
    account: {},
    fetchedAt: "2026-11-06T00:00:00.000Z",
    sourceId: "claude",
    sourceLabel: "Claude",
    report,
  };
}

const EXPIRED: UsageSummary = { known: false, expired: true, usage: null, tone: null };

const ACCOUNTS: AccountHeadroom[] = [
  { provider: "claude", usable: true, usedPct: 60, tone: "none" },
  { provider: "claude-work", usable: true, usedPct: 30, tone: "none" },
  { provider: "claude-off", usable: false, usedPct: 5, tone: "none" },
];

interface DepsFixture {
  deps: DefaultAccountDeps;
  headroomCalls: (string | null)[];
  errors: unknown[];
}

function fixture(
  setting: () => Promise<string | null>,
  movingCwd: string | null = null,
): DepsFixture {
  const headroomCalls: (string | null)[] = [];
  const errors: unknown[] = [];
  const deps: DefaultAccountDeps = {
    setting,
    headroom: async (only) => {
      headroomCalls.push(only);
      return only === null ? ACCOUNTS : ACCOUNTS.filter((account) => account.provider === only);
    },
    movingToMain: (cwd) => cwd === movingCwd,
    onError: (error) => errors.push(error),
    timeoutMs: DECIDE_TIMEOUT_MS,
  };
  return { deps, headroomCalls, errors };
}

function saved(value: string | null): () => Promise<string | null> {
  return async () => value;
}

const PLAIN: CreateRequest = { provider: "claude", cwd: "/repo" };

describe("summarizeUsage", () => {
  it("keeps the tightest window, its tone and the plan of an available report", () => {
    const usage: ProviderUsage = {
      reports: [
        entry({
          status: "available",
          planLabel: "Max",
          windows: [{ id: "weekly", label: "Weekly", usedPct: 70 }],
        }),
      ],
      tightest: { label: "Weekly", usedPct: 70, resetsAt: null, tone: "none" },
      error: null,
    };
    const expected: UsageSummary = {
      known: true,
      expired: false,
      usage: { usedPct: 70, windowLabel: "Weekly", planLabel: "Max" },
      tone: "none",
    };
    expect(summarizeUsage(usage)).toEqual(expected);
  });

  it("reads a rejected or expired login as expired", () => {
    const rejected = entry({ status: "unavailable", problem: { kind: "rejected", status: 401 } });
    const expired = entry({
      status: "unavailable",
      problem: { kind: "expired", expiresAt: "2026-11-01T00:00:00.000Z" },
    });
    expect(summarizeUsage({ reports: [rejected], tightest: null, error: null })).toEqual(EXPIRED);
    expect(summarizeUsage({ reports: [expired], tightest: null, error: null })).toEqual(EXPIRED);
  });

  it("knows nothing without reports", () => {
    expect(
      summarizeUsage({ reports: [], tightest: null, error: "Usage is off on this host." }),
    ).toEqual({ known: false, expired: false, usage: null, tone: null });
  });
});

describe("chooseAuto", () => {
  it("picks the lowest known share and keeps list order on ties", () => {
    expect(chooseAuto(ACCOUNTS)).toBe("claude-work");
    expect(
      chooseAuto([
        { provider: "claude", usable: true, usedPct: 40, tone: "none" },
        { provider: "claude-work", usable: true, usedPct: 40, tone: "none" },
      ]),
    ).toBe("claude");
  });

  it("skips an unusable account and one at 95% or more, which the daemon marks danger", () => {
    expect(
      chooseAuto([
        { provider: "claude", usable: true, usedPct: 95, tone: "danger" },
        { provider: "claude-work", usable: false, usedPct: 10, tone: "none" },
      ]),
    ).toBeNull();
  });

  it("skips an account on pace to run out within 30 minutes, such as 60% in 20 minutes", () => {
    // The daemon gives a 60% window that runs out in 20 minutes the danger tone (Task 1).
    expect(
      chooseAuto([
        { provider: "claude", usable: true, usedPct: 60, tone: "danger" },
        { provider: "claude-work", usable: true, usedPct: 75, tone: "none" },
      ]),
    ).toBe("claude-work");
  });

  it("keeps an account at 94% whose window will not run out", () => {
    expect(
      chooseAuto([{ provider: "claude-work", usable: true, usedPct: 94, tone: "warning" }]),
    ).toBe("claude-work");
  });

  it("never picks an account with unknown usage (Decision 12)", () => {
    expect(
      chooseAuto([{ provider: "claude-team", usable: true, usedPct: null, tone: null }]),
    ).toBeNull();
  });
});

describe("chooseCreateProvider", () => {
  it("leaves creations of other providers alone without reading the setting", async () => {
    const setting = vi.fn(saved("auto"));
    const { deps } = fixture(setting);

    expect(await chooseCreateProvider(deps, { provider: "codex", cwd: "/repo" })).toBe("codex");
    expect(await chooseCreateProvider(deps, { provider: "claude-work", cwd: "/repo" })).toBe(
      "claude-work",
    );
    expect(setting).not.toHaveBeenCalled();
  });

  it("keeps claude when the saved default is claude or invalid", async () => {
    const main = fixture(saved("claude"));
    expect(await chooseCreateProvider(main.deps, PLAIN)).toBe("claude");
    expect(main.headroomCalls).toEqual([]);

    const invalid = fixture(saved(null));
    expect(await chooseCreateProvider(invalid.deps, PLAIN)).toBe("claude");
    expect(invalid.headroomCalls).toEqual([]);
  });

  it("picks the account with the most room for Auto", async () => {
    const { deps, headroomCalls } = fixture(saved("auto"));

    expect(await chooseCreateProvider(deps, PLAIN)).toBe("claude-work");
    expect(headroomCalls).toEqual([null]);
  });

  it("applies an explicit default only while it is usable", async () => {
    const work = fixture(saved("claude-work"));
    expect(await chooseCreateProvider(work.deps, PLAIN)).toBe("claude-work");
    expect(work.headroomCalls).toEqual(["claude-work"]);

    expect(await chooseCreateProvider(fixture(saved("claude-off")).deps, PLAIN)).toBe("claude");
    expect(await chooseCreateProvider(fixture(saved("claude-gone")).deps, PLAIN)).toBe("claude");
  });

  it("keeps claude in a directory this plugin is moving an agent to claude", async () => {
    const setting = vi.fn(saved("claude-work"));
    const { deps } = fixture(setting, "/repo");

    expect(await chooseCreateProvider(deps, PLAIN)).toBe("claude");
    expect(await chooseCreateProvider(deps, { provider: "claude", cwd: "/other" })).toBe(
      "claude-work",
    );
    expect(setting).toHaveBeenCalledTimes(1);
  });

  it("keeps claude and reports the error when the choice fails", async () => {
    const failure = new Error("settings unreadable");
    const { deps, errors } = fixture(() => Promise.reject(failure));

    expect(await chooseCreateProvider(deps, PLAIN)).toBe("claude");
    expect(errors).toEqual([failure]);
  });

  it("keeps claude when the choice outlasts its timeout", async () => {
    const { deps, errors } = fixture(() => new Promise<string | null>(() => {}));

    // The setting never settles, so only the 20 ms timer can end the choice.
    await expect(chooseCreateProvider({ ...deps, timeoutMs: 20 }, PLAIN)).resolves.toBe("claude");
    expect(errors).toEqual([]);
  });
});
```

- [ ] **Step 3: Run them and watch them fail.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/server/default-account.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './default-account.js' imported from /workspace/utils/paseo/plugins/claude-accounts/server/default-account.test.ts`, and no test runs. The `./api.js` import above it is type-only, so it is erased and loads nothing.

- [ ] **Step 4: Write the choice.** Create `plugins/claude-accounts/server/default-account.ts`. The timeout comes in as `deps.timeoutMs`, so the test uses a short real one instead of fake timers, and its timer is `unref()`ed, so a choice still pending never holds the daemon process open:

```ts
import type { AccountUsage } from "../shared/rpc.js";
import { AUTO_ACCOUNT, MAIN_PROVIDER } from "../shared/settings.js";
import type { ProviderUsage, UsageReportEntry, UsageTone } from "./api.js";

// The daemon fails a creation whose before-hook throws or takes 30 s (REQUEST_TIMEOUT_MS in
// packages/server/src/server/plugins/runtime.ts), so the choice gets a third of that.
export const DECIDE_TIMEOUT_MS = 10_000;

export interface UsageSummary {
  /** Some report for the provider's launch scope is available. */
  known: boolean;
  /** No report is available, and one says the login expired or was rejected. */
  expired: boolean;
  usage: AccountUsage | null;
  /** The tightest window's heads-up tone from the daemon, or null when usage is unknown. */
  tone: UsageTone | null;
}

export function summarizeUsage(usage: ProviderUsage): UsageSummary {
  const known = usage.reports.some((entry) => entry.report.status === "available");
  const tightest = known ? usage.tightest : null;
  return {
    known,
    expired: !known && usage.reports.some((entry) => loginRejected(entry)),
    usage:
      tightest === null
        ? null
        : { usedPct: tightest.usedPct, windowLabel: tightest.label, planLabel: planLabel(usage) },
    tone: tightest?.tone ?? null,
  };
}

function loginRejected(entry: UsageReportEntry): boolean {
  const { report } = entry;
  return (
    report.status === "unavailable" &&
    (report.problem.kind === "expired" || report.problem.kind === "rejected")
  );
}

function planLabel(usage: ProviderUsage): string | null {
  for (const { report } of usage.reports) {
    if (report.status === "available") return report.planLabel ?? null;
  }
  return null;
}

export interface AccountHeadroom {
  provider: string;
  /** The provider is ready and the account is signed in with a login that has not expired. */
  usable: boolean;
  /** The tightest window's used share, or null when unknown. */
  usedPct: number | null;
  /** The tightest window's heads-up tone from the daemon, or null when unknown. */
  tone: UsageTone | null;
}

/**
 * The usable account with the lowest known used share. An account whose tightest window has the
 * daemon's `danger` tone (95% or more, or on pace to run out within 30 minutes) is skipped, so the
 * plugin keeps no copy of those thresholds. A tie keeps list order.
 */
export function chooseAuto(accounts: readonly AccountHeadroom[]): string | null {
  let best: string | null = null;
  let bestPct = Number.POSITIVE_INFINITY;
  for (const account of accounts) {
    if (!account.usable || account.tone === "danger" || account.usedPct === null) continue;
    if (account.usedPct < bestPct) {
      best = account.provider;
      bestPct = account.usedPct;
    }
  }
  return best;
}

export interface CreateRequest {
  provider: string;
  cwd: string;
}

export interface DefaultAccountDeps {
  /** The saved default account, or null when the stored setting is invalid. */
  setting(): Promise<string | null>;
  /** Headroom of every profile in list order, or of the one provider `only` names. */
  headroom(only: string | null): Promise<AccountHeadroom[]>;
  /** This plugin is moving an agent in `cwd` to plain `claude` (the handoff guard). */
  movingToMain(cwd: string): boolean;
  onError(error: unknown): void;
  /** How long the choice may take; the daemon wiring passes DECIDE_TIMEOUT_MS. */
  timeoutMs: number;
}

/**
 * The provider an agent creation should use. Only plain `claude` creations change. A failure, or a
 * choice slower than `deps.timeoutMs`, keeps `claude`. Never rejects.
 */
export async function chooseCreateProvider(
  deps: DefaultAccountDeps,
  request: CreateRequest,
): Promise<string> {
  if (request.provider !== MAIN_PROVIDER || deps.movingToMain(request.cwd)) {
    return request.provider;
  }
  try {
    return (await withTimeout(decide(deps), deps.timeoutMs)) ?? MAIN_PROVIDER;
  } catch (error) {
    deps.onError(error);
    return MAIN_PROVIDER;
  }
}

async function decide(deps: DefaultAccountDeps): Promise<string> {
  const setting = await deps.setting();
  if (setting === null || setting === MAIN_PROVIDER) return MAIN_PROVIDER;
  if (setting === AUTO_ACCOUNT) return chooseAuto(await deps.headroom(null)) ?? MAIN_PROVIDER;
  const [chosen] = await deps.headroom(setting);
  return chosen?.usable ? setting : MAIN_PROVIDER;
}

// Promise.race subscribes to `work`, so a rejection after the timeout is still handled. The timer
// is unref'd, as in waitAtMost (plugins/shared-mcp/server/process-runner.ts): the plugin runs in
// the daemon, and a pending choice must not keep it alive.
async function withTimeout<T>(work: Promise<T>, ms: number): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), ms).unref();
  });
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
```

- [ ] **Step 5: Run the tests again.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/server/default-account.test.ts --bail=1
```

Expected: `Tests  15 passed (15)`.

- [ ] **Step 6: Format, lint and typecheck.** Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-accounts/server/api.ts plugins/claude-accounts/server/default-account.ts plugins/claude-accounts/server/default-account.test.ts
cd /workspace/utils/paseo && npm run lint -- plugins/claude-accounts/server/api.ts plugins/claude-accounts/server/default-account.ts plugins/claude-accounts/server/default-account.test.ts
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: lint `Found 0 warnings and 0 errors.`; typecheck exit 0. A typecheck error naming `listUsageForProvider` or `move` means the client declarations predate Task 2: rerun Task 2 Step 7, never add a local type to silence it.

- [ ] **Step 7: Commit with the fork identity (local only, never push).** Run:

```bash
git -C /workspace/utils/paseo add plugins/claude-accounts/server/api.ts plugins/claude-accounts/server/default-account.ts plugins/claude-accounts/server/default-account.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): choose the Claude account for new agents" -- plugins/claude-accounts/server/api.ts plugins/claude-accounts/server/default-account.ts plugins/claude-accounts/server/default-account.test.ts
```

Expected: the hook's jobs pass, then `3 files changed`. If a hook job fails, report its output and stop.

- [ ] **Step 8: Verify the commit.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an|%ae|%cn|%ce' | grep -qxF 'tatsuya|allrested@gmail.com|tatsuya|allrested@gmail.com' && echo "fork identity" || echo "WRONG IDENTITY"
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk
```

Expected: `fork identity`; the subject and the three paths; an empty status.

### Task 8: Move idle agents

**Files:**

- Create: `plugins/claude-accounts/server/move-idle.ts`, `plugins/claude-accounts/server/move-idle.test.ts`

**Interfaces:**

- Consumes: Task 7's `AccountsApi`, `AgentInfo`; Task 3's `MoveJob`, `MAIN_PROVIDER`; Task 4's `errorMessage`.
- Produces:
  - `type MoveApi = Pick<AccountsApi, "listAgents" | "getAgent" | "moveAgent">`.
  - `isIdle(agent: AgentInfo): boolean`: status `idle`, `error` or `closed`, and not `inTurn` (Decision 14).
  - `type MoveStart = { ok: true; job: MoveJob } | { ok: false; error: string }`.
  - `class MoveIdleRunner` with `constructor(onError: (error: unknown) => void)`, `start(api: MoveApi, from: string, to: string): Promise<MoveStart>` (resolves with the job as soon as the agents on `from` are listed, `total` counting the idle ones and `busy` the ones in a turn, which stay; refuses with `"Agents are still moving. Wait for that move to finish."` while a job runs), `current(): MoveJob | null` (a copy), `movingToMain(cwd: string): boolean` (Decision 13), `stop(): void` (starts no further move) and `settled(): Promise<void>`.

- [ ] **Step 1: Write the failing tests.** Create `plugins/claude-accounts/server/move-idle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { MoveJob } from "../shared/rpc.js";
import type { AgentInfo, MoveOutcome } from "./api.js";
import { MoveIdleRunner, isIdle, type MoveApi } from "./move-idle.js";

function agent(id: string, provider: string, overrides: Partial<AgentInfo> = {}): AgentInfo {
  return { id, provider, cwd: "/repo", status: "idle", inTurn: false, ...overrides };
}

interface MoveCall {
  agentId: string;
  provider: string;
  guardedHere: boolean;
  guardedElsewhere: boolean;
}

/** Agents as the daemon would list them; `now` overrides what a later read returns. */
class FakeMoveApi implements MoveApi {
  readonly calls: MoveCall[] = [];
  readonly now = new Map<string, AgentInfo | null>();
  readonly failures = new Map<string, Error>();
  readonly handoffs = new Set<string>();
  gate: Promise<void> | null = null;
  runner: MoveIdleRunner | null = null;

  constructor(readonly agents: AgentInfo[]) {}

  async listAgents(): Promise<AgentInfo[]> {
    return this.agents;
  }

  async getAgent(agentId: string): Promise<AgentInfo | null> {
    if (this.now.has(agentId)) return this.now.get(agentId) ?? null;
    return this.agents.find((candidate) => candidate.id === agentId) ?? null;
  }

  async moveAgent(agentId: string, provider: string): Promise<MoveOutcome> {
    this.calls.push({
      agentId,
      provider,
      guardedHere: this.runner?.movingToMain("/repo") ?? false,
      guardedElsewhere: this.runner?.movingToMain("/other") ?? false,
    });
    if (this.gate) await this.gate;
    const failure = this.failures.get(agentId);
    if (failure) throw failure;
    return {
      agentId: `${agentId}-next`,
      strategy: this.handoffs.has(agentId) ? "handoff" : "native",
    };
  }
}

interface Gate {
  promise: Promise<void>;
  open(): void;
}

function gate(): Gate {
  let open: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { promise, open: () => open() };
}

function runnerFor(api: FakeMoveApi): MoveIdleRunner {
  const runner = new MoveIdleRunner((error) => {
    throw error;
  });
  api.runner = runner;
  return runner;
}

describe("isIdle", () => {
  it("counts idle, failed and closed agents without a turn", () => {
    expect(isIdle(agent("a", "claude"))).toBe(true);
    expect(isIdle(agent("a", "claude", { status: "error" }))).toBe(true);
    expect(isIdle(agent("a", "claude", { status: "closed" }))).toBe(true);
    expect(isIdle(agent("a", "claude", { status: "running" }))).toBe(false);
    expect(isIdle(agent("a", "claude", { status: "initializing" }))).toBe(false);
    expect(isIdle(agent("a", "claude", { inTurn: true }))).toBe(false);
  });
});

describe("MoveIdleRunner", () => {
  it("moves the idle agents of one account one at a time", async () => {
    const api = new FakeMoveApi([
      agent("a", "claude"),
      agent("b", "claude", { status: "error" }),
      agent("c", "claude", { status: "running" }),
      agent("d", "claude-work"),
      agent("e", "claude", { inTurn: true }),
    ]);
    api.handoffs.add("b");
    const runner = runnerFor(api);

    const started = await runner.start(api, "claude", "claude-work");
    await runner.settled();

    expect(started).toEqual({
      ok: true,
      job: {
        from: "claude",
        to: "claude-work",
        total: 2,
        busy: 2,
        moved: 0,
        handedOff: 0,
        skipped: 0,
        failed: [],
        done: false,
      },
    });
    const finished: MoveJob = {
      from: "claude",
      to: "claude-work",
      total: 2,
      busy: 2,
      moved: 2,
      handedOff: 1,
      skipped: 0,
      failed: [],
      done: true,
    };
    expect(runner.current()).toEqual(finished);
    expect(api.calls.map((call) => call.agentId)).toEqual(["a", "b"]);
  });

  it("skips an agent that started a turn before its move and records a failed move", async () => {
    const api = new FakeMoveApi([agent("a", "claude"), agent("b", "claude"), agent("c", "claude")]);
    api.now.set("b", agent("b", "claude", { inTurn: true }));
    api.failures.set("c", new Error("Provider unavailable"));
    const runner = runnerFor(api);

    await runner.start(api, "claude", "claude-work");
    await runner.settled();

    expect(runner.current()).toEqual({
      from: "claude",
      to: "claude-work",
      total: 3,
      busy: 0,
      moved: 1,
      handedOff: 0,
      skipped: 1,
      failed: [{ agentId: "c", error: "Provider unavailable" }],
      done: true,
    });
    expect(api.calls.map((call) => call.agentId)).toEqual(["a", "c"]);
  });

  it("refuses a second job while one runs, and accepts one after it finished", async () => {
    const api = new FakeMoveApi([agent("a", "claude")]);
    const blocked = gate();
    api.gate = blocked.promise;
    const runner = runnerFor(api);

    await runner.start(api, "claude", "claude-work");
    expect(await runner.start(api, "claude", "claude-team")).toEqual({
      ok: false,
      error: "Agents are still moving. Wait for that move to finish.",
    });
    blocked.open();
    await runner.settled();

    api.gate = null;
    expect((await runner.start(api, "claude-work", "claude")).ok).toBe(true);
    await runner.settled();
  });

  it("guards creations in the moving agent's directory only while it moves to claude", async () => {
    const toMain = new FakeMoveApi([agent("a", "claude-work")]);
    const mainRunner = runnerFor(toMain);
    await mainRunner.start(toMain, "claude-work", "claude");
    await mainRunner.settled();

    expect(toMain.calls).toEqual([
      { agentId: "a", provider: "claude", guardedHere: true, guardedElsewhere: false },
    ]);
    expect(mainRunner.movingToMain("/repo")).toBe(false);

    const toWork = new FakeMoveApi([agent("a", "claude")]);
    const workRunner = runnerFor(toWork);
    await workRunner.start(toWork, "claude", "claude-work");
    await workRunner.settled();

    expect(toWork.calls).toEqual([
      { agentId: "a", provider: "claude-work", guardedHere: false, guardedElsewhere: false },
    ]);
  });

  it("starts no further move once stopped", async () => {
    const api = new FakeMoveApi([agent("a", "claude"), agent("b", "claude")]);
    const blocked = gate();
    api.gate = blocked.promise;
    const runner = runnerFor(api);

    await runner.start(api, "claude", "claude-work");
    runner.stop();
    blocked.open();
    await runner.settled();

    expect(api.calls.map((call) => call.agentId)).toEqual(["a"]);
    expect(runner.current()?.done).toBe(true);
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/server/move-idle.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './move-idle.js' imported from /workspace/utils/paseo/plugins/claude-accounts/server/move-idle.test.ts`, and no test runs.

- [ ] **Step 3: Write the runner.** Create `plugins/claude-accounts/server/move-idle.ts`:

```ts
import type { MoveJob } from "../shared/rpc.js";
import { MAIN_PROVIDER } from "../shared/settings.js";
import type { AccountsApi, AgentInfo } from "./api.js";
import { errorMessage } from "./errors.js";

/** The part of AccountsApi a move job uses. */
export type MoveApi = Pick<AccountsApi, "listAgents" | "getAgent" | "moveAgent">;

export type MoveStart = { ok: true; job: MoveJob } | { ok: false; error: string };

const IDLE_STATUSES: ReadonlySet<string> = new Set(["idle", "error", "closed"]);
const BUSY_MESSAGE = "Agents are still moving. Wait for that move to finish.";

/** Not starting or running, with no turn in flight and no permission request waiting. */
export function isIdle(agent: AgentInfo): boolean {
  return IDLE_STATUSES.has(agent.status) && !agent.inTurn;
}

/** Moves one account's idle agents one at a time in the background; one job per daemon. */
export class MoveIdleRunner {
  private job: MoveJob | null = null;
  private active = false;
  private stopped = false;
  private mainMoveCwd: string | null = null;
  private running: Promise<void> = Promise.resolve();

  constructor(private readonly onError: (error: unknown) => void) {}

  /**
   * Lists the agents on `from`, starts moving the idle ones and counts the ones in a turn, which
   * stay. Resolves with the job at once.
   */
  async start(api: MoveApi, from: string, to: string): Promise<MoveStart> {
    if (this.active) return { ok: false, error: BUSY_MESSAGE };
    this.active = true;
    let agentIds: string[];
    let busy: number;
    try {
      const listed = (await api.listAgents()).filter((agent) => agent.provider === from);
      agentIds = listed.filter((agent) => isIdle(agent)).map((agent) => agent.id);
      busy = listed.length - agentIds.length;
    } catch (error) {
      this.active = false;
      throw error;
    }
    const job: MoveJob = {
      from,
      to,
      total: agentIds.length,
      busy,
      moved: 0,
      handedOff: 0,
      skipped: 0,
      failed: [],
      done: false,
    };
    this.job = job;
    // run() catches every move's failure; this catch only keeps the daemon alive.
    this.running = this.run(api, job, agentIds).catch((error: unknown) => this.onError(error));
    return { ok: true, job: copyJob(job) };
  }

  current(): MoveJob | null {
    return this.job === null ? null : copyJob(this.job);
  }

  /** This runner is moving an agent in `cwd` to plain `claude` right now. */
  movingToMain(cwd: string): boolean {
    return this.mainMoveCwd === cwd;
  }

  /** The move in flight finishes on its own; no further move starts. */
  stop(): void {
    this.stopped = true;
  }

  settled(): Promise<void> {
    return this.running;
  }

  private async run(api: MoveApi, job: MoveJob, agentIds: readonly string[]): Promise<void> {
    try {
      for (const agentId of agentIds) {
        if (this.stopped) break;
        await this.moveOne(api, job, agentId);
      }
    } finally {
      job.done = true;
      this.active = false;
    }
  }

  private async moveOne(api: MoveApi, job: MoveJob, agentId: string): Promise<void> {
    try {
      // An agent that started a turn since the list is left alone, never interrupted.
      const agent = await api.getAgent(agentId);
      if (agent === null || agent.provider !== job.from || !isIdle(agent)) {
        job.skipped += 1;
        return;
      }
      this.mainMoveCwd = job.to === MAIN_PROVIDER ? agent.cwd : null;
      const outcome = await api.moveAgent(agentId, job.to);
      job.moved += 1;
      if (outcome.strategy === "handoff") job.handedOff += 1;
    } catch (error) {
      job.failed.push({ agentId, error: errorMessage(error) });
    } finally {
      this.mainMoveCwd = null;
    }
  }
}

function copyJob(job: MoveJob): MoveJob {
  return { ...job, failed: [...job.failed] };
}
```

- [ ] **Step 4: Run the tests again.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/server/move-idle.test.ts --bail=1
```

Expected: `Tests  6 passed (6)`.

- [ ] **Step 5: Format, lint and typecheck.** Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-accounts/server/move-idle.ts plugins/claude-accounts/server/move-idle.test.ts
cd /workspace/utils/paseo && npm run lint -- plugins/claude-accounts/server/move-idle.ts plugins/claude-accounts/server/move-idle.test.ts
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: lint `Found 0 warnings and 0 errors.`; typecheck exit 0.

- [ ] **Step 6: Commit with the fork identity (local only, never push).** Run:

```bash
git -C /workspace/utils/paseo add plugins/claude-accounts/server/move-idle.ts plugins/claude-accounts/server/move-idle.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): move a Claude account's idle agents in the background" -- plugins/claude-accounts/server/move-idle.ts plugins/claude-accounts/server/move-idle.test.ts
```

Expected: the hook's jobs pass, then `2 files changed`. If a hook job fails, report its output and stop.

- [ ] **Step 7: Verify the commit.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an|%ae|%cn|%ce' | grep -qxF 'tatsuya|allrested@gmail.com|tatsuya|allrested@gmail.com' && echo "fork identity" || echo "WRONG IDENTITY"
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk
```

Expected: `fork identity`; the subject and the two paths; an empty status.

### Task 9: The accounts service, the Paseo port and the server wiring

**Files:**

- Create: `plugins/claude-accounts/server/accounts.ts`, `plugins/claude-accounts/server/accounts.test.ts`
- Create: `plugins/claude-accounts/server/paseo-port.ts`
- Modify: `plugins/claude-accounts/index.server.ts` (whole file below)

**Interfaces:**

- Consumes: everything from Tasks 3 to 8; `PluginServerContext.registerSettings`, `handle`, `addHook("agent.create.before", ...)` (`packages/plugin/src/server/contracts.ts:42`, `lifecycle.ts:153`); the `agent.create.before` request `{ config: AgentSessionConfig; env? }`, whose `config.cwd` a hook must not change (`packages/server/src/server/plugins/lifecycle/index.ts:237-242`). From `PaseoApi`: `agents.list({ page })` (archived, internal and background agents left out by default), `agents.ref(id).refresh()`, `agents.ref(id).move()`, `providers.listUsageForProvider()`, `providers.snapshot()`, `config.get()`, `config.patch({ providers })` (deep-merged, `daemon-config-store.ts:421-424`), `workspaces.list({ sort, page })`, `terminals.create({ workspaceId, name, command, args })`.
- Produces (`accounts.ts`):
  - `interface ClaudeAccountsOptions { paths: ProfilePaths; platform: NodeJS.Platform; readDefaultAccount(): Promise<string | null>; logError(message: string, error: unknown): void; syncIntervalMs?: number }`.
  - `interface ClaudeAccounts { list(api): Promise<AccountList>; add(api, name): Promise<ActionResult>; signIn(api, provider): Promise<ActionResult>; moveIdle(api, from, to): Promise<MoveIdleResult>; beforeCreate(api, request: CreateRequest): Promise<string>; syncNow(): Promise<void>; stop(): Promise<void> }` and `createClaudeAccounts(options): ClaudeAccounts`.
  - Copy: `"Adding accounts needs macOS or Linux"`; `` `${directory} is the main account's directory. Pick another name.` ``; `` `${provider} already exists in the host config with other settings. Remove it or pick another name.` ``; `` `${directory} exists and is not a directory` ``; `"Open a project first. The sign-in terminal runs in a workspace."`; `` `The account was added, but its sign-in terminal did not open: ${message}` ``; `` `The sign-in terminal did not open: ${message}` ``; `` `No account uses ${provider}` `` (Sign in, and Move idle agents from a provider no profile uses); `"Pick another account to move to"`; `` `Agents cannot start on ${to} yet. Fix its problems first.` ``; `` `Sign in to ${to} first` ``; the row problems of Decisions 6 and 19.
- Produces (`paseo-port.ts`): `accountsApi(paseo: PluginHandlerContext["paseo"]): AccountsApi`.
- Produces (`index.server.ts`): the four RPC handlers and one `agent.create.before` hook for the plugin's lifetime.

- [ ] **Step 1: Write the failing service tests.** Create `plugins/claude-accounts/server/accounts.test.ts`. `FakeApi` keeps Paseo's state in memory; the files are real, in a temp home:

```ts
import { mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Account, MoveJob } from "../shared/rpc.js";
import { createClaudeAccounts, type ClaudeAccounts } from "./accounts.js";
import type {
  AccountsApi,
  AgentInfo,
  MoveOutcome,
  NewProvider,
  ProviderEntry,
  ProviderState,
  ProviderUsage,
  TerminalCommand,
  UsageReportEntry,
  UsageTone,
} from "./api.js";
import type { CreateRequest } from "./default-account.js";
import { profilePaths } from "./profiles.js";

/** A user-scope MCP server as Claude Code stores it; the plugin copies these as opaque JSON. */
interface McpServerFixture {
  type: string;
  url: string;
}

const READY: ProviderState = { status: "ready", error: null };
const NO_USAGE: ProviderUsage = { reports: [], tightest: null, error: null };
const SERVERS: Record<string, McpServerFixture> = {
  context7: { type: "http", url: "http://127.0.0.1:8932/mcp" },
};
const HAND_MADE =
  "Paseo did not add this account, so it shares nothing with the main account. Add it again under the same name to share the main account's setup.";

interface OpenedTerminal {
  workspaceId: string;
  command: TerminalCommand;
}

interface AddedProvider {
  provider: string;
  entry: NewProvider;
}

class FakeApi implements AccountsApi {
  agents: AgentInfo[] = [];
  workspaceId: string | null = "ws-1";
  readonly entries = new Map<string, ProviderEntry>();
  readonly states = new Map<string, ProviderState>([["claude", READY]]);
  readonly usage = new Map<string, ProviderUsage>();
  readonly added: AddedProvider[] = [];
  readonly terminals: OpenedTerminal[] = [];
  readonly moves: string[] = [];

  async listAgents(): Promise<AgentInfo[]> {
    return this.agents;
  }

  async getAgent(agentId: string): Promise<AgentInfo | null> {
    return this.agents.find((candidate) => candidate.id === agentId) ?? null;
  }

  async moveAgent(agentId: string, provider: string): Promise<MoveOutcome> {
    this.moves.push(`${agentId}->${provider}`);
    return { agentId: `${agentId}-next`, strategy: "native" };
  }

  async listUsage(provider: string): Promise<ProviderUsage> {
    return this.usage.get(provider) ?? NO_USAGE;
  }

  async providerEntries(): Promise<Map<string, ProviderEntry>> {
    return new Map(this.entries);
  }

  async providerStates(): Promise<Map<string, ProviderState>> {
    return new Map(this.states);
  }

  async addProvider(provider: string, entry: NewProvider): Promise<void> {
    this.added.push({ provider, entry });
    this.entries.set(provider, {
      extends: "claude",
      enabled: true,
      configDirectory: entry.configDirectory,
    });
    this.states.set(provider, READY);
  }

  async latestWorkspaceId(): Promise<string | null> {
    return this.workspaceId;
  }

  async openTerminal(workspaceId: string, command: TerminalCommand): Promise<void> {
    this.terminals.push({ workspaceId, command });
  }
}

interface SavedSetting {
  value: string | null;
}

interface Setup {
  home: string;
  main: string;
  accounts: ClaudeAccounts;
  api: FakeApi;
  saved: SavedSetting;
}

const services: ClaudeAccounts[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(): Promise<Setup> {
  const home = await mkdtemp(join(tmpdir(), "claude-accounts-"));
  roots.push(home);
  const main = join(home, ".claude");
  await mkdir(join(main, "skills"), { recursive: true });
  await mkdir(join(main, "plugins"));
  await writeFile(join(main, "settings.json"), "{}");
  await writeFile(
    join(main, ".claude.json"),
    JSON.stringify({ numStartups: 4, mcpServers: SERVERS }),
  );
  const saved: SavedSetting = { value: "claude" };
  const accounts = createClaudeAccounts({
    paths: profilePaths({ CLAUDE_CONFIG_DIR: main, PASEO_HOME: join(home, "paseo-home") }, home),
    platform: "linux",
    readDefaultAccount: async () => saved.value,
    logError: (message, error) => {
      throw new Error(`${message}: ${String(error)}`);
    },
    syncIntervalMs: 60_000,
  });
  services.push(accounts);
  return { home, main, accounts, api: new FakeApi(), saved };
}

function agent(id: string, provider: string, overrides: Partial<AgentInfo> = {}): AgentInfo {
  return { id, provider, cwd: "/repo", status: "idle", inTurn: false, ...overrides };
}

function usageEntry(report: UsageReportEntry["report"]): UsageReportEntry {
  return {
    id: "claude:test",
    account: {},
    fetchedAt: "2026-11-06T00:00:00.000Z",
    sourceId: "claude",
    sourceLabel: "Claude",
    report,
  };
}

function usageAt(usedPct: number, tone: UsageTone): ProviderUsage {
  return {
    reports: [
      usageEntry({ status: "available", windows: [{ id: "weekly", label: "Weekly", usedPct }] }),
    ],
    tightest: { label: "Weekly", usedPct, resetsAt: null, tone },
    error: null,
  };
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

describe("adding an account", () => {
  it("shares the main setup, adds its provider and opens its sign-in terminal", async () => {
    const { home, main, accounts, api } = await setup();
    const account = join(home, ".claude-work");

    expect(await accounts.add(api, "work")).toEqual({
      ok: true,
      error: null,
      loginWorkspaceId: "ws-1",
    });

    expect((await stat(account)).mode & 0o777).toBe(0o700);
    expect(await readlink(join(account, "settings.json"))).toBe(join(main, "settings.json"));
    expect(await readlink(join(account, "skills"))).toBe(join(main, "skills"));
    expect(await readlink(join(account, "plugins"))).toBe(join(main, "plugins"));
    expect(await readJson(join(account, ".claude.json"))).toEqual({ mcpServers: SERVERS });
    expect(await readJson(join(home, "paseo-home", "claude-accounts", "added.json"))).toEqual({
      version: 1,
      names: ["work"],
    });
    expect(api.added).toEqual([
      { provider: "claude-work", entry: { label: "Claude (work)", configDirectory: account } },
    ]);
    expect(api.terminals).toEqual([
      {
        workspaceId: "ws-1",
        command: {
          name: "Claude sign-in: work",
          command: "env",
          args: [
            "-u",
            "CLAUDECODE",
            "-u",
            "CLAUDE_CODE_ENTRYPOINT",
            "-u",
            "CLAUDE_CODE_SSE_PORT",
            "-u",
            "CLAUDE_AGENT_SDK_VERSION",
            `CLAUDE_CONFIG_DIR=${account}`,
            "claude",
            "auth",
            "login",
          ],
        },
      },
    ]);
  });

  it("copies a later change to the main profile's MCP servers on the next pass", async () => {
    const { home, main, accounts, api } = await setup();
    await accounts.add(api, "work");
    const changed: Record<string, McpServerFixture> = {
      ...SERVERS,
      gitlab: { type: "http", url: "http://127.0.0.1:8933/mcp" },
    };
    await writeFile(join(main, ".claude.json"), JSON.stringify({ mcpServers: changed }));

    await accounts.syncNow();

    expect(await readJson(join(home, ".claude-work", ".claude.json"))).toEqual({
      mcpServers: changed,
    });
  });

  it("opens no terminal for an account that is already signed in", async () => {
    const { home, accounts, api } = await setup();
    await accounts.add(api, "work");
    await writeFile(join(home, ".claude-work", ".credentials.json"), "{}");

    expect(await accounts.add(api, "work")).toEqual({
      ok: true,
      error: null,
      loginWorkspaceId: null,
    });
    expect(api.terminals).toHaveLength(1);
    expect(api.added).toHaveLength(1);
  });

  it("refuses a name whose provider exists with other settings, before writing anything", async () => {
    const { home, accounts, api } = await setup();
    api.entries.set("claude-team", { extends: "codex", enabled: true, configDirectory: null });

    expect(await accounts.add(api, "team")).toEqual({
      ok: false,
      error:
        "claude-team already exists in the host config with other settings. Remove it or pick another name.",
      loginWorkspaceId: null,
    });
    await expect(stat(join(home, ".claude-team"))).rejects.toThrow("ENOENT");
  });

  it("keeps the account when no workspace can run its sign-in terminal", async () => {
    const { accounts, api } = await setup();
    api.workspaceId = null;

    expect(await accounts.add(api, "work")).toEqual({
      ok: false,
      error:
        "The account was added, but its sign-in terminal did not open: Open a project first. The sign-in terminal runs in a workspace.",
      loginWorkspaceId: null,
    });
    expect(api.added).toHaveLength(1);
  });
});

describe("listing accounts", () => {
  it("shows each profile's login, usage, agents and problems, and leaves hand-made ones alone", async () => {
    const { home, main, accounts, api } = await setup();
    await accounts.add(api, "work");
    await mkdir(join(home, ".claude-old"));
    await writeFile(join(home, ".claude-old", "settings.json"), "{}");
    await writeFile(join(main, ".credentials.json"), "{}");
    api.usage.set("claude", {
      reports: [
        usageEntry({
          status: "available",
          planLabel: "Max",
          windows: [{ id: "five_hour", label: "Session", usedPct: 62 }],
        }),
      ],
      tightest: { label: "Session", usedPct: 62, resetsAt: null, tone: "none" },
      error: null,
    });
    api.usage.set("claude-work", {
      reports: [usageEntry({ status: "unavailable", problem: { kind: "rejected", status: 401 } })],
      tightest: null,
      error: null,
    });
    api.agents = [
      agent("a", "claude"),
      agent("b", "claude", { inTurn: true }),
      agent("c", "claude", { status: "closed" }),
    ];

    const expected: Account[] = [
      {
        provider: "claude",
        directory: main,
        label: "Main account",
        main: true,
        signedIn: true,
        loginExpired: false,
        providerReady: true,
        usage: { usedPct: 62, windowLabel: "Session", planLabel: "Max" },
        agents: { total: 3, busy: 1 },
        problems: [],
      },
      {
        provider: "claude-old",
        directory: join(home, ".claude-old"),
        label: "old",
        main: false,
        signedIn: false,
        loginExpired: false,
        providerReady: false,
        usage: null,
        agents: { total: 0, busy: 0 },
        problems: [HAND_MADE],
      },
      {
        provider: "claude-work",
        directory: join(home, ".claude-work"),
        label: "work",
        main: false,
        signedIn: true,
        loginExpired: true,
        providerReady: true,
        usage: null,
        agents: { total: 0, busy: 0 },
        problems: [],
      },
    ];
    expect(await accounts.list(api)).toEqual({
      accounts: expected,
      usageError: null,
      moveJob: null,
    });
    await expect(stat(join(home, ".claude-old", ".claude.json"))).rejects.toThrow("ENOENT");
  });
});

describe("new agents and moves", () => {
  it("rewrites only plain claude creations, following the saved default", async () => {
    const { home, accounts, api, saved } = await setup();
    await accounts.add(api, "work");
    await writeFile(join(home, ".claude-work", ".credentials.json"), "{}");
    api.usage.set("claude", usageAt(80, "warning"));
    api.usage.set("claude-work", usageAt(20, "none"));
    const plain: CreateRequest = { provider: "claude", cwd: "/repo" };

    expect(await accounts.beforeCreate(api, plain)).toBe("claude");
    saved.value = "auto";
    expect(await accounts.beforeCreate(api, plain)).toBe("claude-work");
    expect(await accounts.beforeCreate(api, { provider: "codex", cwd: "/repo" })).toBe("codex");
    saved.value = "claude-work";
    expect(await accounts.beforeCreate(api, plain)).toBe("claude-work");
  });

  it("refuses an unknown source and a target that cannot take agents, then moves idle agents", async () => {
    const { home, accounts, api } = await setup();
    await accounts.add(api, "work");
    api.agents = [agent("a", "claude"), agent("b", "claude", { inTurn: true })];

    expect(await accounts.moveIdle(api, "claude", "claude-work")).toEqual({
      ok: false,
      error: "Sign in to claude-work first",
      job: null,
    });
    expect(await accounts.moveIdle(api, "claude", "claude")).toEqual({
      ok: false,
      error: "Pick another account to move to",
      job: null,
    });
    expect(await accounts.moveIdle(api, "codex", "claude-work")).toEqual({
      ok: false,
      error: "No account uses codex",
      job: null,
    });
    api.states.delete("claude-work");
    expect(await accounts.moveIdle(api, "claude", "claude-work")).toEqual({
      ok: false,
      error: "Agents cannot start on claude-work yet. Fix its problems first.",
      job: null,
    });

    api.states.set("claude-work", READY);
    await writeFile(join(home, ".claude-work", ".credentials.json"), "{}");
    const started = await accounts.moveIdle(api, "claude", "claude-work");

    const job: MoveJob = {
      from: "claude",
      to: "claude-work",
      total: 1,
      busy: 1,
      moved: 0,
      handedOff: 0,
      skipped: 0,
      failed: [],
      done: false,
    };
    expect(started).toEqual({ ok: true, error: null, job });
    await vi.waitFor(async () => {
      expect((await accounts.list(api)).moveJob?.done).toBe(true);
    });
    expect(api.moves).toEqual(["a->claude-work"]);
  });
});
```

`logError` throws in this fixture, so any logged failure surfaces as an unhandled rejection that fails the run.

- [ ] **Step 2: Run them and watch them fail.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/server/accounts.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './accounts.js' imported from /workspace/utils/paseo/plugins/claude-accounts/server/accounts.test.ts`, and no test runs.

- [ ] **Step 3: Write the service.** Create `plugins/claude-accounts/server/accounts.ts`:

```ts
import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Account, AccountList, ActionResult, MoveIdleResult } from "../shared/rpc.js";
import { MAIN_PROVIDER, accountProvider } from "../shared/settings.js";
import type {
  AccountsApi,
  AgentInfo,
  ProviderEntry,
  ProviderState,
  ProviderUsage,
  TerminalCommand,
} from "./api.js";
import {
  DECIDE_TIMEOUT_MS,
  chooseCreateProvider,
  summarizeUsage,
  type AccountHeadroom,
  type CreateRequest,
  type UsageSummary,
} from "./default-account.js";
import { errorCode, errorMessage } from "./errors.js";
import { watchMcpServers, type SyncTarget } from "./mcp-sync.js";
import { MoveIdleRunner, isIdle } from "./move-idle.js";
import {
  accountDirectory,
  claudeConfigFile,
  discoverProfiles,
  hasCredentials,
  readAddedAccounts,
  recordAddedAccount,
  type Profile,
  type ProfilePaths,
} from "./profiles.js";
import { applySetupLink, planSetupLink, setupProblems, type SetupStep } from "./setup-link.js";

export interface ClaudeAccountsOptions {
  paths: ProfilePaths;
  platform: NodeJS.Platform;
  /** The saved default account, or null when the stored setting is invalid. */
  readDefaultAccount(): Promise<string | null>;
  logError(message: string, error: unknown): void;
  /** How often the MCP sync runs; 5 s unless a test sets it. */
  syncIntervalMs?: number;
}

export interface ClaudeAccounts {
  list(api: AccountsApi): Promise<AccountList>;
  add(api: AccountsApi, name: string): Promise<ActionResult>;
  signIn(api: AccountsApi, provider: string): Promise<ActionResult>;
  moveIdle(api: AccountsApi, from: string, to: string): Promise<MoveIdleResult>;
  /** The provider for an `agent.create.before` request. Never rejects. */
  beforeCreate(api: AccountsApi, request: CreateRequest): Promise<string>;
  /** Runs an MCP sync pass after the one in flight. */
  syncNow(): Promise<void>;
  stop(): Promise<void>;
}

type SignInTarget = Pick<Profile, "name" | "directory" | "viaEnv">;

interface ViewOptions {
  /** One provider's profile, or every profile when null. */
  only: string | null;
  withAgents: boolean;
}

interface ProfileView {
  account: Account;
  headroom: AccountHeadroom;
}

interface ProfileViews {
  views: ProfileView[];
  usageError: string | null;
}

interface ProfileFacts {
  profile: Profile;
  entry: ProviderEntry | null;
  state: ProviderState | null;
  usage: ProviderUsage | null;
  links: readonly SetupStep[];
  syncProblem: string | null;
  agents: readonly AgentInfo[];
}

const SYNC_INTERVAL_MS = 5_000;
const MAIN_LABEL = "Main account";
const HAND_MADE_PROBLEM =
  "Paseo did not add this account, so it shares nothing with the main account. Add it again under the same name to share the main account's setup.";
const NO_WORKSPACE = "Open a project first. The sign-in terminal runs in a workspace.";
// PARENT_SESSION_ENV_VARS in packages/server/src/server/agent/provider-launch-config.ts: a daemon
// started from a Claude Code session carries these, and `claude` refuses to start under them.
const PARENT_SESSION_ENV_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_AGENT_SDK_VERSION",
];
const NO_USAGE: UsageSummary = { known: false, expired: false, usage: null, tone: null };
const NO_AGENTS: AgentInfo[] = [];

export function createClaudeAccounts(options: ClaudeAccountsOptions): ClaudeAccounts {
  const { paths } = options;
  const runner = new MoveIdleRunner((error) =>
    options.logError("claude-accounts: moving idle agents failed", error),
  );
  const watcher = watchMcpServers({
    targets: () => syncTargets(paths),
    intervalMs: options.syncIntervalMs ?? SYNC_INTERVAL_MS,
    logError: options.logError,
  });
  // Adds run one after another, so two presses cannot interleave their writes.
  let adding: Promise<unknown> = Promise.resolve();

  async function viewProfiles(api: AccountsApi, view: ViewOptions): Promise<ProfileViews> {
    const added = await readAddedAccounts(paths.recordFile);
    const { main, accounts } = await discoverProfiles(paths, added);
    const profiles = [main, ...accounts].filter(
      (profile) => view.only === null || profile.provider === view.only,
    );
    const [entries, states, agents] = await Promise.all([
      api.providerEntries(),
      api.providerStates(),
      view.withAgents ? api.listAgents() : NO_AGENTS,
    ]);
    // A provider the host does not know has no launch scope, so its usage is not asked for.
    const usages = await Promise.all(
      profiles.map((profile) =>
        states.has(profile.provider) ? api.listUsage(profile.provider) : null,
      ),
    );
    const views: ProfileView[] = [];
    for (const [index, profile] of profiles.entries()) {
      views.push(
        describeProfile({
          profile,
          entry: entries.get(profile.provider) ?? null,
          state: states.get(profile.provider) ?? null,
          usage: usages[index] ?? null,
          links: profile.added ? await planSetupLink(paths.mainDirectory, profile.directory) : [],
          syncProblem: profile.added ? watcher.problem(profile.provider) : null,
          agents: agents.filter((agent) => agent.provider === profile.provider),
        }),
      );
    }
    return { views, usageError: usages.find((usage) => usage?.error)?.error ?? null };
  }

  async function addAccount(api: AccountsApi, name: string): Promise<ActionResult> {
    if (options.platform === "win32") return failure("Adding accounts needs macOS or Linux");
    const directory = accountDirectory(paths.home, name);
    const provider = accountProvider(name);
    if (directory === paths.mainDirectory) {
      return failure(`${directory} is the main account's directory. Pick another name.`);
    }
    const entry = (await api.providerEntries()).get(provider) ?? null;
    if (entry !== null && !launchesDirectory(entry, directory)) {
      return failure(
        `${provider} already exists in the host config with other settings. Remove it or pick another name.`,
      );
    }
    await makeAccountDirectory(directory);
    await applySetupLink(await planSetupLink(paths.mainDirectory, directory), directory);
    await recordAddedAccount(paths.recordFile, name);
    await watcher.tick();
    if (entry === null) {
      await api.addProvider(provider, { label: `Claude (${name})`, configDirectory: directory });
    }
    if (await hasCredentials(directory)) return { ok: true, error: null, loginWorkspaceId: null };
    return signInResult(
      api,
      { name, directory, viaEnv: true },
      "The account was added, but its sign-in terminal did not open",
    );
  }

  return {
    async list(api) {
      const { views, usageError } = await viewProfiles(api, { only: null, withAgents: true });
      return { accounts: views.map((view) => view.account), usageError, moveJob: runner.current() };
    },
    add(api, name) {
      const run = adding
        .then(() => addAccount(api, name))
        .catch((error: unknown) => failure(errorMessage(error)));
      adding = run;
      return run;
    },
    async signIn(api, provider) {
      try {
        const added = await readAddedAccounts(paths.recordFile);
        const { main, accounts } = await discoverProfiles(paths, added);
        const profile = [main, ...accounts].find((candidate) => candidate.provider === provider);
        if (profile === undefined) return failure(`No account uses ${provider}`);
        return await signInResult(api, profile, "The sign-in terminal did not open");
      } catch (error) {
        return failure(errorMessage(error));
      }
    },
    async moveIdle(api, from, to) {
      if (from === to) return refusal("Pick another account to move to");
      try {
        // The RPC takes any string; only a Claude profile's agents move.
        const added = await readAddedAccounts(paths.recordFile);
        const { main, accounts } = await discoverProfiles(paths, added);
        if (![main, ...accounts].some((profile) => profile.provider === from)) {
          return refusal(`No account uses ${from}`);
        }
        const { views } = await viewProfiles(api, { only: to, withAgents: false });
        const target = views[0]?.account;
        if (target === undefined || !target.providerReady) {
          return refusal(`Agents cannot start on ${to} yet. Fix its problems first.`);
        }
        if (!target.signedIn || target.loginExpired) return refusal(`Sign in to ${to} first`);
        const started = await runner.start(api, from, to);
        return started.ok ? { ok: true, error: null, job: started.job } : refusal(started.error);
      } catch (error) {
        return refusal(errorMessage(error));
      }
    },
    beforeCreate(api, request) {
      return chooseCreateProvider(
        {
          setting: () => options.readDefaultAccount(),
          headroom: async (only) =>
            (await viewProfiles(api, { only, withAgents: false })).views.map(
              (view) => view.headroom,
            ),
          movingToMain: (cwd) => runner.movingToMain(cwd),
          onError: (error) =>
            options.logError("claude-accounts: choosing the account for a new agent failed", error),
          timeoutMs: DECIDE_TIMEOUT_MS,
        },
        request,
      );
    },
    syncNow: () => watcher.tick(),
    async stop() {
      runner.stop();
      await watcher.stop();
    },
  };
}

function describeProfile(facts: ProfileFacts): ProfileView {
  const { profile, state } = facts;
  const summary = facts.usage === null ? NO_USAGE : summarizeUsage(facts.usage);
  const entryProblems = providerProblems(profile, facts.entry);
  const providerReady = entryProblems.length === 0 && state?.status === "ready";
  const signedIn = profile.credentials || summary.known || summary.expired;
  const problems = [
    ...(profile.main || profile.added ? [] : [HAND_MADE_PROBLEM]),
    ...entryProblems,
    ...(entryProblems.length === 0 ? stateProblems(profile.provider, state) : []),
    ...setupProblems(facts.links),
    ...(facts.syncProblem === null ? [] : [facts.syncProblem]),
  ];
  const busy = facts.agents.filter((agent) => !isIdle(agent)).length;
  return {
    account: {
      provider: profile.provider,
      directory: profile.directory,
      label: profile.name ?? MAIN_LABEL,
      main: profile.main,
      signedIn,
      loginExpired: summary.expired,
      providerReady,
      usage: summary.usage,
      agents: { total: facts.agents.length, busy },
      problems,
    },
    headroom: {
      provider: profile.provider,
      usable: providerReady && signedIn && !summary.expired,
      usedPct: summary.usage?.usedPct ?? null,
      tone: summary.tone,
    },
  };
}

function providerProblems(profile: Profile, entry: ProviderEntry | null): string[] {
  const { provider } = profile;
  if (entry === null) {
    // The built-in claude provider needs no entry, and a hand-made account already says to add it.
    if (profile.main || !profile.added) return [];
    return [`No provider launches this account. Add the account again to create ${provider}.`];
  }
  if (!profile.main && entry.extends !== MAIN_PROVIDER) {
    return [`${provider} in the host config is not a Claude provider`];
  }
  if (!entry.enabled) return [`${provider} is turned off in the host config`];
  if (!launchesProfile(profile, entry)) {
    return [`${provider} in the host config does not launch this account's directory`];
  }
  return [];
}

// The main profile's entry may leave CLAUDE_CONFIG_DIR to the daemon's env.
function launchesProfile(profile: Profile, entry: ProviderEntry): boolean {
  if (entry.configDirectory === null) return profile.main;
  return resolve(entry.configDirectory) === profile.directory;
}

function launchesDirectory(entry: ProviderEntry, directory: string): boolean {
  return (
    entry.extends === MAIN_PROVIDER &&
    entry.configDirectory !== null &&
    resolve(entry.configDirectory) === directory
  );
}

function stateProblems(provider: string, state: ProviderState | null): string[] {
  if (state?.status === "error") return [state.error ?? `${provider} failed to load`];
  if (state?.status === "unavailable") {
    return [state.error ?? `${provider} is not available on this host`];
  }
  return [];
}

async function syncTargets(paths: ProfilePaths): Promise<SyncTarget[]> {
  const added = await readAddedAccounts(paths.recordFile);
  if (added.length === 0) return [];
  const { main, accounts } = await discoverProfiles(paths, added);
  const mainFile = await claudeConfigFile(main, paths.home);
  const targets: SyncTarget[] = [];
  for (const account of accounts) {
    if (!account.added) continue;
    const accountFile = await claudeConfigFile(account, paths.home);
    targets.push({ provider: account.provider, mainFile, accountFile });
  }
  return targets;
}

async function makeAccountDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { mode: 0o700 });
    return;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  if (!(await stat(directory)).isDirectory()) {
    throw new Error(`${directory} exists and is not a directory`);
  }
}

async function signInResult(
  api: AccountsApi,
  target: SignInTarget,
  failurePrefix: string,
): Promise<ActionResult> {
  try {
    return { ok: true, error: null, loginWorkspaceId: await openSignIn(api, target) };
  } catch (error) {
    return failure(`${failurePrefix}: ${errorMessage(error)}`);
  }
}

// A Paseo terminal needs a workspace, so the sign-in runs in the most recently active one.
async function openSignIn(api: AccountsApi, target: SignInTarget): Promise<string> {
  const workspaceId = await api.latestWorkspaceId();
  if (workspaceId === null) throw new Error(NO_WORKSPACE);
  await api.openTerminal(workspaceId, loginCommand(target));
  return workspaceId;
}

function loginCommand(target: SignInTarget): TerminalCommand {
  const args = PARENT_SESSION_ENV_VARS.flatMap((variable) => ["-u", variable]);
  if (target.viaEnv) args.push(`CLAUDE_CONFIG_DIR=${target.directory}`);
  args.push("claude", "auth", "login");
  const name = target.name === null ? "Claude sign-in" : `Claude sign-in: ${target.name}`;
  return { name, command: "env", args };
}

function failure(error: string): ActionResult {
  return { ok: false, error, loginWorkspaceId: null };
}

function refusal(error: string): MoveIdleResult {
  return { ok: false, error, job: null };
}
```

- [ ] **Step 4: Run the service tests again.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/server/accounts.test.ts --bail=1
```

Expected: `Tests  8 passed (8)`.

- [ ] **Step 5: Write the Paseo port.** Create `plugins/claude-accounts/server/paseo-port.ts`. Its typecheck is its only check here; it first runs against a daemon in Task 12 (Decision 21):

```ts
import type { PluginHandlerContext } from "@getpaseo/plugin/server";
import { z } from "zod";
import { MAIN_PROVIDER } from "../shared/settings.js";
import type { AccountsApi, AgentInfo, AgentSnapshot, ProviderEntry, ProviderState } from "./api.js";
import { errorMessage } from "./errors.js";

type PaseoApi = PluginHandlerContext["paseo"];

const PAGE_LIMIT = 200;

// Entries this plugin did not write are free-form: one it cannot read counts as an entry that does
// not launch Claude.
const ProviderEntrySchema = z.object({
  extends: z.string().optional(),
  enabled: z.boolean().optional(),
  env: z.record(z.string(), z.string()).optional(),
});
const UNREADABLE_ENTRY: ProviderEntry = { extends: null, enabled: true, configDirectory: null };

/** AccountsApi over the PaseoApi that a handler or a hook receives. */
export function accountsApi(paseo: PaseoApi): AccountsApi {
  return {
    async listAgents() {
      const agents: AgentInfo[] = [];
      let cursor: string | null = null;
      do {
        const page = await paseo.agents.list({
          page: cursor === null ? { limit: PAGE_LIMIT } : { limit: PAGE_LIMIT, cursor },
        });
        for (const entry of page.entries) agents.push(toAgentInfo(entry.agent));
        cursor = page.pageInfo.hasMore ? page.pageInfo.nextCursor : null;
      } while (cursor !== null);
      return agents;
    },
    async getAgent(agentId) {
      const result = await paseo.agents.ref(agentId).refresh();
      return result === null || result.agent.archivedAt ? null : toAgentInfo(result.agent);
    },
    async moveAgent(agentId, provider) {
      const moved = await paseo.agents.ref(agentId).move({ to: provider, continueWork: false });
      return { agentId: moved.agentId, strategy: moved.strategy };
    },
    async listUsage(provider) {
      try {
        const usage = await paseo.providers.listUsageForProvider(provider);
        return { reports: usage.reports, tightest: usage.tightest, error: usage.error };
      } catch (error) {
        return { reports: [], tightest: null, error: errorMessage(error) };
      }
    },
    async providerEntries() {
      const { config } = await paseo.config.get();
      const entries = new Map<string, ProviderEntry>();
      for (const [provider, raw] of Object.entries(config.providers)) {
        const parsed = ProviderEntrySchema.safeParse(raw);
        entries.set(provider, parsed.success ? toProviderEntry(parsed.data) : UNREADABLE_ENTRY);
      }
      return entries;
    },
    async providerStates() {
      const { entries } = await paseo.providers.snapshot();
      const states = new Map<string, ProviderState>();
      for (const entry of entries) {
        states.set(entry.provider, { status: entry.status, error: entry.error ?? null });
      }
      return states;
    },
    async addProvider(provider, entry) {
      await paseo.config.patch({
        providers: {
          [provider]: {
            extends: MAIN_PROVIDER,
            label: entry.label,
            env: { CLAUDE_CONFIG_DIR: entry.configDirectory },
          },
        },
      });
    },
    async latestWorkspaceId() {
      const { entries } = await paseo.workspaces.list({
        sort: [{ key: "activity_at", direction: "desc" }],
        page: { limit: 1 },
      });
      return entries[0]?.id ?? null;
    },
    async openTerminal(workspaceId, command) {
      await paseo.terminals.create({
        workspaceId,
        name: command.name,
        command: command.command,
        args: command.args,
      });
    },
  };
}

function toAgentInfo(agent: AgentSnapshot): AgentInfo {
  return {
    id: agent.id,
    provider: agent.provider,
    cwd: agent.cwd,
    status: agent.status,
    inTurn: (agent.activeTurn ?? null) !== null || agent.pendingPermissions.length > 0,
  };
}

function toProviderEntry(entry: z.output<typeof ProviderEntrySchema>): ProviderEntry {
  return {
    extends: entry.extends ?? null,
    enabled: entry.enabled !== false,
    configDirectory: entry.env?.CLAUDE_CONFIG_DIR ?? null,
  };
}
```

- [ ] **Step 6: Wire the server entry.** Replace `plugins/claude-accounts/index.server.ts` with:

```ts
import { homedir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createClaudeAccounts } from "./server/accounts.js";
import { accountsApi } from "./server/paseo-port.js";
import { profilePaths } from "./server/profiles.js";
import { addAccountRpc, listAccountsRpc, moveIdleRpc, signInRpc } from "./shared/rpc.js";
import { claudeAccountsSettings } from "./shared/settings.js";

export default function contribute(server: PluginServerContext) {
  const settings = server.registerSettings(claudeAccountsSettings);
  // Built-ins run in the daemon process, so process.env is the daemon's env.
  const accounts = createClaudeAccounts({
    paths: profilePaths(process.env, homedir()),
    platform: process.platform,
    readDefaultAccount: async () => {
      const state = await settings.read();
      return state.status === "ready" ? state.values.defaultAccount : null;
    },
    logError: (message, error) => console.error(message, error),
  });
  server.handle(listAccountsRpc, (_input, { paseo }) => accounts.list(accountsApi(paseo)));
  server.handle(addAccountRpc, ({ name }, { paseo }) => accounts.add(accountsApi(paseo), name));
  server.handle(signInRpc, ({ provider }, { paseo }) =>
    accounts.signIn(accountsApi(paseo), provider),
  );
  server.handle(moveIdleRpc, ({ from, to }, { paseo }) =>
    accounts.moveIdle(accountsApi(paseo), from, to),
  );
  // One hook for the plugin's lifetime. It sees every creation that is not internal, history
  // handoffs included; a native move creates no agent and skips it.
  const removeHook = server.addHook("agent.create.before", async ({ request }, { paseo }) => {
    const { config } = request;
    const provider = await accounts.beforeCreate(accountsApi(paseo), {
      provider: config.provider,
      cwd: config.cwd,
    });
    return provider === config.provider ? request : { ...request, config: { ...config, provider } };
  });
  return async function cleanup(): Promise<void> {
    removeHook();
    await accounts.stop();
  };
}
```

With the record empty, startup reads the absent `added.json` and the home directory and writes nothing, so test daemons with the real `HOME` stay untouched (Decision 6).

- [ ] **Step 7: Run the built-in compile test.** Run:

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts --bail=1
```

Expected: `Tests  4 passed (4)`. The server bundle now pulls in every `server/` module; the esbuild boundary check rejects any import outside `@getpaseo/plugin/*`, `zod` and `node:*`.

- [ ] **Step 8: Format, lint and typecheck.** Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-accounts/server/accounts.ts plugins/claude-accounts/server/accounts.test.ts plugins/claude-accounts/server/paseo-port.ts plugins/claude-accounts/index.server.ts
cd /workspace/utils/paseo && npm run lint -- plugins/claude-accounts/server/accounts.ts plugins/claude-accounts/server/accounts.test.ts plugins/claude-accounts/server/paseo-port.ts plugins/claude-accounts/index.server.ts
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: lint `Found 0 warnings and 0 errors.`; typecheck exit 0. If the typecheck rejects the `config.patch` value, read the error: the patch schema's provider entries are `.passthrough()` objects, so `extends`, `label` and `env` are allowed keys; fix the call to match the inferred type rather than casting.

- [ ] **Step 9: Commit with the fork identity (local only, never push).** Run:

```bash
git -C /workspace/utils/paseo add plugins/claude-accounts/server/accounts.ts plugins/claude-accounts/server/accounts.test.ts plugins/claude-accounts/server/paseo-port.ts plugins/claude-accounts/index.server.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): serve Claude accounts and pick the account for new agents" -- plugins/claude-accounts/server/accounts.ts plugins/claude-accounts/server/accounts.test.ts plugins/claude-accounts/server/paseo-port.ts plugins/claude-accounts/index.server.ts
```

Expected: the hook's jobs pass, then `4 files changed`. If a hook job fails, report its output and stop.

- [ ] **Step 10: Verify the commit.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an|%ae|%cn|%ce' | grep -qxF 'tatsuya|allrested@gmail.com|tatsuya|allrested@gmail.com' && echo "fork identity" || echo "WRONG IDENTITY"
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk
```

Expected: `fork identity`; the subject and the four paths; an empty status.

### Task 10: The accounts screen

**Files:**

- Create: `plugins/claude-accounts/client/view-model.ts`, `plugins/claude-accounts/client/view-model.test.ts`
- Create: `plugins/claude-accounts/client/styles.ts`, `plugins/claude-accounts/client/accounts-screen.tsx`
- Create: `plugins/claude-accounts/index.client.tsx`

**Interfaces:**

- Consumes: Task 3's `Account`, `MoveJob`, `ActionResult`, `listAccountsRpc`, `addAccountRpc`, `signInRpc`, `moveIdleRpc`, `claudeAccountsSettings`, `AUTO_ACCOUNT` and `AccountNameSchema`, served by Task 9. From the client SDK (`packages/plugin/src/client/contracts.ts`, `ui.ts`): `PluginClientContext.addScreen({ id, title, Component })`, `addSidebarFooterItem({ id, title, Component })`, `addCommandCenterItem({ id, title, icon, keywords, context: "global", onSelect({ openScreen }) })`; `PluginScreenProps` with `theme` and the optional `navigation.openWorkspace({ workspaceId })`; `PluginSidebarItemProps` with `currentScreen` and `openScreen`; `useRpc`, `useSettings` (its `save(values, revision)` and `reset()` never throw); `ScrollView`, `SettingsSection`, `SettingsCard`, `SettingsRow`, `SettingsSelect`, `SettingsInput` (with a `SettingsInputHandle` ref), `SettingsAction`, `SidebarRow`. A plugin screen's body is a plain `View` (`packages/app/src/plugins/surface-screen.tsx`), so the screen scrolls itself. `Users` is a Lucide icon the app resolves by name.
- Produces (`view-model.ts`): `interface SelectOption { label: string; value: string }`, `MOVE_CONFIRM_MS = 5_000`, `describeAccount(account): string`, `describeAgents(agents): string`, `needsSignIn(account): boolean`, `canTakeAgents(account): boolean`, `defaultAccountOptions(accounts, saved: string | null): SelectOption[]`, `moveTargetOptions(accounts, from): SelectOption[]`, `accountLabel(accounts, provider): string`, `describeMoveJob(job, accounts): string`, `nameError(name): string | null`, `interface MoveHintInput { idle; jobRunning; armed; from; to }`, `moveHint(input): string`, `moveActionLabel(pending, armed): string`.
- Produces (UI): the screen `accounts` titled "Claude accounts"; the sidebar footer item `accounts`; the Command Center item `open-accounts`. Copy: section titles "Default account", "Accounts" and "Add account"; the picker "New Claude agents"; the actions "Sign in"/"Opening...", "Move"/"Confirm move"/"Moving...", "Add"/"Adding...", "Reset"/"Resetting...", "Reload" and "Try again"; the hints quoted in the code below. Test ids, kept for a later manual run (Decision 21): `claude-accounts-default`, `claude-accounts-row-<provider>`, `claude-accounts-sign-in-<provider>`, `claude-accounts-move-target-<provider>`, `claude-accounts-move-<provider>`, `claude-accounts-name` and `claude-accounts-add` (a settings row puts its `testID` on the row's View, `packages/app/src/components/settings/index.tsx:72`).

- [ ] **Step 1: Write the failing view-model tests.** Create `plugins/claude-accounts/client/view-model.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Account, MoveJob } from "../shared/rpc.js";
import {
  defaultAccountOptions,
  describeAccount,
  describeAgents,
  describeMoveJob,
  moveActionLabel,
  moveHint,
  moveTargetOptions,
  nameError,
  needsSignIn,
  type MoveHintInput,
  type SelectOption,
} from "./view-model.js";

const MAIN: Account = {
  provider: "claude",
  directory: "/home/u/.claude",
  label: "Main account",
  main: true,
  signedIn: true,
  loginExpired: false,
  providerReady: true,
  usage: { usedPct: 62.4, windowLabel: "Session", planLabel: "Max" },
  agents: { total: 3, busy: 1 },
  problems: [],
};
const WORK: Account = {
  ...MAIN,
  provider: "claude-work",
  directory: "/home/u/.claude-work",
  label: "work",
  main: false,
  usage: { usedPct: 20, windowLabel: "Weekly", planLabel: null },
  agents: { total: 1, busy: 0 },
};
const SIGNED_OUT: Account = {
  ...WORK,
  provider: "claude-new",
  directory: "/home/u/.claude-new",
  label: "new",
  signedIn: false,
  usage: null,
  agents: { total: 0, busy: 0 },
};
const EXPIRED: Account = {
  ...WORK,
  provider: "claude-old",
  directory: "/home/u/.claude-old",
  label: "old",
  loginExpired: true,
  usage: null,
  agents: { total: 1, busy: 1 },
};
const TURNED_OFF: Account = {
  ...WORK,
  provider: "claude-team",
  directory: "/home/u/.claude-team",
  label: "team",
  providerReady: false,
  usage: null,
  agents: { total: 0, busy: 0 },
  problems: ["claude-team is turned off in the host config"],
};
const ACCOUNTS: Account[] = [MAIN, WORK, SIGNED_OUT, EXPIRED, TURNED_OFF];

function job(overrides: Partial<MoveJob>): MoveJob {
  return {
    from: "claude",
    to: "claude-work",
    total: 3,
    busy: 0,
    moved: 0,
    handedOff: 0,
    skipped: 0,
    failed: [],
    done: false,
    ...overrides,
  };
}

describe("describeAccount", () => {
  it("shows the plan, the tightest window, the agents and the directory", () => {
    expect(describeAccount(MAIN)).toBe(
      "Max · Session 62% used · 3 agents, 1 in a turn · /home/u/.claude",
    );
    expect(describeAccount(WORK)).toBe("Weekly 20% used · 1 agent · /home/u/.claude-work");
  });

  it("shows the login state when there is no usage to show", () => {
    expect(describeAccount(SIGNED_OUT)).toBe("Not signed in · No agents · /home/u/.claude-new");
    expect(describeAccount(EXPIRED)).toBe(
      "Login expired · 1 agent, in a turn · /home/u/.claude-old",
    );
    expect(describeAccount(TURNED_OFF)).toBe("Usage unknown · No agents · /home/u/.claude-team");
  });
});

describe("describeAgents", () => {
  it("counts the agents and the ones in a turn", () => {
    expect(describeAgents({ total: 0, busy: 0 })).toBe("No agents");
    expect(describeAgents({ total: 2, busy: 0 })).toBe("2 agents");
    expect(describeAgents({ total: 3, busy: 2 })).toBe("3 agents, 2 in a turn");
  });
});

describe("needsSignIn", () => {
  it("asks for a sign-in without a login or with an expired one", () => {
    expect(needsSignIn(SIGNED_OUT)).toBe(true);
    expect(needsSignIn(EXPIRED)).toBe(true);
    expect(needsSignIn(WORK)).toBe(false);
  });
});

describe("picker options", () => {
  it("lists Auto first, then every account", () => {
    const expected: SelectOption[] = [
      { label: "Auto", value: "auto" },
      { label: "Main account", value: "claude" },
      { label: "work", value: "claude-work" },
      { label: "new", value: "claude-new" },
      { label: "old", value: "claude-old" },
      { label: "team", value: "claude-team" },
    ];
    expect(defaultAccountOptions(ACCOUNTS, "claude")).toEqual(expected);
  });

  it("keeps a saved account that is gone, so the picker can show it", () => {
    const expected: SelectOption[] = [
      { label: "Auto", value: "auto" },
      { label: "Main account", value: "claude" },
      { label: "claude-gone (unavailable)", value: "claude-gone" },
    ];
    expect(defaultAccountOptions([MAIN], "claude-gone")).toEqual(expected);
    expect(defaultAccountOptions([MAIN], null)).toHaveLength(2);
  });

  it("offers only other accounts that can take agents as move targets", () => {
    const fromMain: SelectOption[] = [{ label: "work", value: "claude-work" }];
    const fromWork: SelectOption[] = [{ label: "Main account", value: "claude" }];
    expect(moveTargetOptions(ACCOUNTS, "claude")).toEqual(fromMain);
    expect(moveTargetOptions(ACCOUNTS, "claude-work")).toEqual(fromWork);
  });
});

describe("describeMoveJob", () => {
  it("counts the move in flight", () => {
    expect(describeMoveJob(job({ moved: 1 }), ACCOUNTS)).toBe(
      "Moving 2 of 3 idle agents from Main account to work...",
    );
  });

  it("reads a single clause without a period", () => {
    expect(describeMoveJob(job({ moved: 3, done: true }), ACCOUNTS)).toBe(
      "Moved 3 of 3 idle agents from Main account to work",
    );
    expect(describeMoveJob(job({ total: 0, done: true }), ACCOUNTS)).toBe(
      "No idle agents to move from Main account",
    );
  });

  it("adds handoffs, agents in a turn, skips and failures as sentences", () => {
    const finished = job({
      total: 4,
      busy: 2,
      moved: 2,
      handedOff: 1,
      skipped: 1,
      failed: [{ agentId: "d", error: "Update the host to move agents." }],
      done: true,
    });
    expect(describeMoveJob(finished, ACCOUNTS)).toBe(
      "Moved 2 of 4 idle agents from Main account to work. 1 move continued through a history handoff. Skipped 2 agents in a turn. Skipped 1 agent that started a turn or went away. 1 move failed: Update the host to move agents.",
    );
    expect(describeMoveJob(job({ total: 0, busy: 2, done: true }), ACCOUNTS)).toBe(
      "No idle agents to move from Main account. Skipped 2 agents in a turn.",
    );
  });

  it("names an account that is gone by its provider", () => {
    expect(
      describeMoveJob(job({ to: "claude-gone", total: 1, moved: 1, done: true }), ACCOUNTS),
    ).toBe("Moved 1 of 1 idle agent from Main account to claude-gone");
  });
});

describe("nameError", () => {
  it("accepts lowercase names and an empty field", () => {
    expect(nameError("")).toBeNull();
    expect(nameError("work-2")).toBeNull();
  });

  it("explains a name that cannot become a provider id", () => {
    expect(nameError("Work")).toBe(
      "Use lowercase letters and digits, with single dashes between them",
    );
    expect(nameError("a".repeat(33))).toBe("Use at most 32 characters");
  });
});

describe("move action", () => {
  it("arms, confirms and shows the move in flight", () => {
    expect(moveActionLabel(false, false)).toBe("Move");
    expect(moveActionLabel(false, true)).toBe("Confirm move");
    expect(moveActionLabel(true, true)).toBe("Moving...");
  });

  it("explains the move before and after the first press", () => {
    const ready: MoveHintInput = {
      idle: 2,
      jobRunning: false,
      armed: false,
      from: "Main account",
      to: "work",
    };
    expect(moveHint(ready)).toBe("Agents in a turn stay where they are");
    expect(moveHint({ ...ready, armed: true })).toBe(
      "Press again within 5 s to move 2 idle agents from Main account to work. Their background shells and watches stop.",
    );
    expect(moveHint({ ...ready, idle: 0 })).toBe("No idle agents on this account");
    expect(moveHint({ ...ready, jobRunning: true })).toBe(
      "Agents are still moving. Wait for that move to finish.",
    );
  });
});
```

- [ ] **Step 2: Run them and watch them fail.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/client/view-model.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './view-model.js' imported from /workspace/utils/paseo/plugins/claude-accounts/client/view-model.test.ts`, and no test runs.

- [ ] **Step 3: Write the view model.** Create `plugins/claude-accounts/client/view-model.ts`:

```ts
import type { Account, MoveJob } from "../shared/rpc.js";
import { AUTO_ACCOUNT, AccountNameSchema } from "../shared/settings.js";

export interface SelectOption {
  label: string;
  value: string;
}

export interface MoveHintInput {
  idle: number;
  jobRunning: boolean;
  armed: boolean;
  /** Labels of the two accounts. */
  from: string;
  to: string;
}

// The plugin SDK has no confirm dialog, so Move asks for a second press within this window.
export const MOVE_CONFIRM_MS = 5_000;

const AUTO_OPTION: SelectOption = { label: "Auto", value: AUTO_ACCOUNT };

/** The row's hint: login or usage, agents, directory. */
export function describeAccount(account: Account): string {
  return [loginText(account), describeAgents(account.agents), account.directory].join(" · ");
}

function loginText(account: Account): string {
  if (!account.signedIn) return "Not signed in";
  if (account.loginExpired) return "Login expired";
  const { usage } = account;
  if (usage === null) return "Usage unknown";
  const used = `${usage.windowLabel} ${Math.round(usage.usedPct)}% used`;
  return usage.planLabel === null ? used : `${usage.planLabel} · ${used}`;
}

export function describeAgents(agents: Account["agents"]): string {
  if (agents.total === 0) return "No agents";
  const count = plural(agents.total, "agent");
  if (agents.busy === 0) return count;
  return agents.total === 1 ? `${count}, in a turn` : `${count}, ${agents.busy} in a turn`;
}

/** The row offers Sign in while the profile has no login or its login expired. */
export function needsSignIn(account: Account): boolean {
  return !account.signedIn || account.loginExpired;
}

/** Agents can start on, or move to, an account whose provider is ready and whose login holds. */
export function canTakeAgents(account: Account): boolean {
  return account.providerReady && account.signedIn && !account.loginExpired;
}

/** Auto, then every account. A saved account that is gone stays listed so the picker shows it. */
export function defaultAccountOptions(
  accounts: readonly Account[],
  saved: string | null,
): SelectOption[] {
  const options = [AUTO_OPTION, ...accounts.map((account) => toOption(account))];
  if (saved !== null && !options.some((option) => option.value === saved)) {
    options.push({ label: `${saved} (unavailable)`, value: saved });
  }
  return options;
}

/** The accounts that can take `from`'s idle agents. */
export function moveTargetOptions(accounts: readonly Account[], from: string): SelectOption[] {
  return accounts
    .filter((account) => account.provider !== from && canTakeAgents(account))
    .map((account) => toOption(account));
}

function toOption(account: Account): SelectOption {
  return { label: account.label, value: account.provider };
}

export function accountLabel(accounts: readonly Account[], provider: string): string {
  return accounts.find((account) => account.provider === provider)?.label ?? provider;
}

/** The move job's line above the rows. */
export function describeMoveJob(job: MoveJob, accounts: readonly Account[]): string {
  const from = accountLabel(accounts, job.from);
  const to = accountLabel(accounts, job.to);
  if (!job.done) {
    const current = Math.min(job.moved + job.skipped + job.failed.length + 1, job.total);
    return `Moving ${current} of ${plural(job.total, "idle agent")} from ${from} to ${to}...`;
  }
  const parts =
    job.total === 0
      ? [`No idle agents to move from ${from}`]
      : [`Moved ${job.moved} of ${plural(job.total, "idle agent")} from ${from} to ${to}`];
  if (job.handedOff > 0) {
    parts.push(`${plural(job.handedOff, "move")} continued through a history handoff`);
  }
  // The spec's "skipped and counted": agents in a turn when the job started stay where they are.
  if (job.busy > 0) {
    parts.push(`Skipped ${plural(job.busy, "agent")} in a turn`);
  }
  if (job.skipped > 0) {
    parts.push(`Skipped ${plural(job.skipped, "agent")} that started a turn or went away`);
  }
  const [firstFailure] = job.failed;
  if (firstFailure !== undefined) {
    parts.push(`${plural(job.failed.length, "move")} failed: ${firstFailure.error}`);
  }
  return sentences(parts);
}

// One clause reads as a label, without a period; several read as prose, each with one.
function sentences(parts: readonly string[]): string {
  const [first] = parts;
  if (parts.length === 1 && first !== undefined) return first;
  return parts.map((part) => (part.endsWith(".") ? part : `${part}.`)).join(" ");
}

/** Why `name` cannot name an account, or null. An empty field is not an error yet. */
export function nameError(name: string): string | null {
  if (name === "") return null;
  const parsed = AccountNameSchema.safeParse(name);
  // A failed parse always carries an issue; the first one is the message to show.
  return parsed.success ? null : (parsed.error.issues[0]?.message ?? null);
}

export function moveHint({ idle, jobRunning, armed, from, to }: MoveHintInput): string {
  if (jobRunning) return "Agents are still moving. Wait for that move to finish.";
  if (idle === 0) return "No idle agents on this account";
  if (armed) {
    return `Press again within ${MOVE_CONFIRM_MS / 1000} s to move ${plural(idle, "idle agent")} from ${from} to ${to}. Their background shells and watches stop.`;
  }
  return "Agents in a turn stay where they are";
}

export function moveActionLabel(pending: boolean, armed: boolean): string {
  if (pending) return "Moving...";
  return armed ? "Confirm move" : "Move";
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
```

- [ ] **Step 4: Run the view-model tests again.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/claude-accounts/client/view-model.test.ts --bail=1
```

Expected: `Tests  15 passed (15)`.

- [ ] **Step 5: Write the styles.** Create `plugins/claude-accounts/client/styles.ts`:

```ts
import { useMemo } from "react";
import type { PluginTheme } from "@getpaseo/plugin";

/** Styles the accounts screen uses, derived from the host theme. */
export function useScreenStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      // A plugin screen's body is a plain View, so the screen scrolls and pads itself.
      content: {
        padding: 16,
        gap: 24,
        width: "100%" as const,
        maxWidth: 720,
        alignSelf: "center" as const,
      },
      muted: { color: theme.colors.foregroundMuted },
      warning: { color: theme.colors.statusWarning },
      error: { color: theme.colors.statusDanger },
    }),
    [theme],
  );
}

export type ScreenStyles = ReturnType<typeof useScreenStyles>;
```

- [ ] **Step 6: Write the screen.** Create `plugins/claude-accounts/client/accounts-screen.tsx`:

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Text } from "react-native";
import { useRpc, useSettings, type PluginScreenProps } from "@getpaseo/plugin/client";
import {
  ScrollView,
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsRow,
  SettingsSection,
  SettingsSelect,
  type SettingsInputHandle,
} from "@getpaseo/plugin/client/ui";
import {
  addAccountRpc,
  listAccountsRpc,
  moveIdleRpc,
  signInRpc,
  type Account,
  type ActionResult,
} from "../shared/rpc.js";
import { claudeAccountsSettings } from "../shared/settings.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";
import {
  MOVE_CONFIRM_MS,
  accountLabel,
  defaultAccountOptions,
  describeAccount,
  describeMoveJob,
  moveActionLabel,
  moveHint,
  moveTargetOptions,
  nameError,
  needsSignIn,
} from "./view-model.js";

const ACCOUNTS_KEY = ["claude-accounts", "list"] as const;
const POLL_MS = 5_000;
const DEFAULT_HINT =
  "Auto picks the signed-in account with the most room, skipping any at 95% or more or on pace to run out within 30 minutes. Agents started on a specific account stay on it.";
const INVALID_DEFAULT_HINT = "New agents start on the main account until you reset this";
const SIGN_IN_HINT = "Opens claude auth login in a terminal of your most recent workspace";
const NAME_HINT = "Lowercase letters, digits and dashes, such as work";
const ADD_HINT = "Creates the account's directory and provider, then opens its sign-in terminal";
const NO_TARGET_HINT = "No other signed-in account can take agents";

type OpenWorkspace = (workspaceId: string) => void;

interface Reply {
  ok: boolean;
  error: string | null;
}

interface DefaultAccountProps {
  accounts: readonly Account[];
  styles: ScreenStyles;
}

interface AccountCardProps {
  account: Account;
  accounts: readonly Account[];
  jobRunning: boolean;
  openWorkspace: OpenWorkspace;
}

interface SignInActionProps {
  account: Account;
  openWorkspace: OpenWorkspace;
}

interface MoveIdleActionProps {
  account: Account;
  accounts: readonly Account[];
  jobRunning: boolean;
}

interface AddAccountProps {
  openWorkspace: OpenWorkspace;
}

// A thrown RPC error, or the refusal the handler returned.
function actionError(error: Error | null, reply: Reply | undefined): string | null {
  if (error !== null) return error.message;
  return reply?.ok === false ? reply.error : null;
}

// The sign-in terminal runs in a workspace; show it so the user can finish the login there.
function followLogin(result: ActionResult, openWorkspace: OpenWorkspace): void {
  if (result.loginWorkspaceId !== null) openWorkspace(result.loginWorkspaceId);
}

function DefaultAccount({ accounts, styles }: DefaultAccountProps) {
  const settings = useSettings(claudeAccountsSettings);
  const saved = settings.status === "ready" ? settings.values.defaultAccount : null;
  const options = useMemo(() => defaultAccountOptions(accounts, saved), [accounts, saved]);
  const change = useCallback(
    (defaultAccount: string) => {
      if (settings.status !== "ready") return;
      void settings.save({ ...settings.values, defaultAccount }, settings.revision);
    },
    [settings],
  );
  const reset = useCallback(() => {
    void settings.reset();
  }, [settings]);
  if (settings.status === "ready") {
    return (
      <SettingsSelect
        testID="claude-accounts-default"
        label="New Claude agents"
        hint={DEFAULT_HINT}
        error={settings.saveError}
        value={settings.values.defaultAccount}
        options={options}
        disabled={settings.saving}
        onValueChange={change}
      />
    );
  }
  if (settings.status === "loading") {
    return <Text style={styles.muted}>Loading the default account...</Text>;
  }
  if (settings.status === "error") {
    return (
      <SettingsAction
        label="New Claude agents"
        error={settings.error}
        actionLabel="Reload"
        onPress={settings.reload}
      />
    );
  }
  return (
    <SettingsAction
      label="New Claude agents"
      hint={INVALID_DEFAULT_HINT}
      error={settings.saveError ?? settings.error}
      actionLabel={settings.saving ? "Resetting..." : "Reset"}
      disabled={settings.saving}
      onPress={reset}
    />
  );
}

function SignInAction({ account, openWorkspace }: SignInActionProps) {
  const callSignIn = useRpc(signInRpc);
  const queryClient = useQueryClient();
  const signIn = useMutation({
    mutationFn: () => callSignIn({ provider: account.provider }),
    onSuccess: (result: ActionResult) => followLogin(result, openWorkspace),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  });
  const { mutate } = signIn;
  const press = useCallback(() => mutate(), [mutate]);
  return (
    <SettingsAction
      testID={`claude-accounts-sign-in-${account.provider}`}
      label={account.loginExpired ? "Login expired" : "Not signed in"}
      hint={SIGN_IN_HINT}
      error={actionError(signIn.error, signIn.data)}
      actionLabel={signIn.isPending ? "Opening..." : "Sign in"}
      disabled={signIn.isPending}
      onPress={press}
    />
  );
}

function MoveIdleAction({ account, accounts, jobRunning }: MoveIdleActionProps) {
  const targets = useMemo(
    () => moveTargetOptions(accounts, account.provider),
    [accounts, account.provider],
  );
  const [picked, setPicked] = useState<string | null>(null);
  // The first press arms the move; the timer, another target, an unmount or the move disarms it.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), MOVE_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const callMove = useRpc(moveIdleRpc);
  const queryClient = useQueryClient();
  const move = useMutation({
    mutationFn: (target: string) => callMove({ from: account.provider, to: target }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  });
  const to = targets.find((option) => option.value === picked)?.value ?? targets[0]?.value ?? null;
  const pick = useCallback((value: string) => {
    setPicked(value);
    setArmed(false);
  }, []);
  const { mutate } = move;
  const press = useCallback(() => {
    if (to === null) return;
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    mutate(to);
  }, [armed, mutate, to]);
  const testID = `claude-accounts-move-${account.provider}`;
  if (to === null) {
    return <SettingsRow testID={testID} label="Move idle agents" hint={NO_TARGET_HINT} />;
  }
  const idle = account.agents.total - account.agents.busy;
  const blocked = idle === 0 || jobRunning || move.isPending;
  const hint = moveHint({
    idle,
    jobRunning,
    armed,
    from: account.label,
    to: accountLabel(accounts, to),
  });
  return (
    <>
      <SettingsSelect
        testID={`claude-accounts-move-target-${account.provider}`}
        label="Move idle agents to"
        value={to}
        options={targets}
        disabled={blocked}
        onValueChange={pick}
      />
      <SettingsAction
        testID={testID}
        label="Move idle agents"
        hint={hint}
        error={actionError(move.error, move.data)}
        actionLabel={moveActionLabel(move.isPending, armed)}
        disabled={blocked}
        onPress={press}
      />
    </>
  );
}

function AccountCard({ account, accounts, jobRunning, openWorkspace }: AccountCardProps) {
  const problems = account.problems.length === 0 ? null : account.problems.join("\n");
  return (
    <SettingsCard>
      <SettingsRow
        testID={`claude-accounts-row-${account.provider}`}
        label={account.label}
        hint={describeAccount(account)}
        error={problems}
      />
      {needsSignIn(account) ? (
        <SignInAction account={account} openWorkspace={openWorkspace} />
      ) : null}
      {account.agents.total > 0 ? (
        <MoveIdleAction account={account} accounts={accounts} jobRunning={jobRunning} />
      ) : null}
    </SettingsCard>
  );
}

function AddAccount({ openWorkspace }: AddAccountProps) {
  const input = useRef<SettingsInputHandle>(null);
  const [name, setName] = useState("");
  const callAdd = useRpc(addAccountRpc);
  const queryClient = useQueryClient();
  const add = useMutation({
    mutationFn: (accountName: string) => callAdd({ name: accountName }),
    onSuccess: (result: ActionResult) => {
      // A failed sign-in terminal keeps the name, so pressing Add again retries it.
      if (result.ok) {
        input.current?.replaceText("");
        setName("");
      }
      followLogin(result, openWorkspace);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY }),
  });
  const { mutate } = add;
  const invalid = nameError(name);
  const canAdd = name !== "" && invalid === null && !add.isPending;
  const press = useCallback(() => {
    if (name !== "" && nameError(name) === null) mutate(name);
  }, [mutate, name]);
  return (
    <SettingsSection title="Add account">
      <SettingsCard>
        <SettingsInput
          ref={input}
          testID="claude-accounts-name"
          label="Name"
          hint={NAME_HINT}
          error={invalid}
          placeholder="work"
          disabled={add.isPending}
          onChangeText={setName}
        />
        <SettingsAction
          testID="claude-accounts-add"
          label="Add account"
          hint={ADD_HINT}
          error={actionError(add.error, add.data)}
          actionLabel={add.isPending ? "Adding..." : "Add"}
          disabled={!canAdd}
          onPress={press}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

export function AccountsScreen({ theme, navigation }: PluginScreenProps) {
  const styles = useScreenStyles(theme);
  const listAccounts = useRpc(listAccountsRpc);
  // The interval belongs to the query observer, so polling stops when the screen unmounts. Retries
  // are off: a failed fetch shows at once, and the next poll is the retry.
  const list = useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => listAccounts({}),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const navigate = navigation?.openWorkspace;
  const openWorkspace = useCallback(
    (workspaceId: string) => navigate?.({ workspaceId }),
    [navigate],
  );
  const { refetch } = list;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const { data } = list;
  if (data === undefined) {
    return (
      <ScrollView contentContainerStyle={styles.content}>
        {list.isError ? (
          <SettingsAction
            label="Claude accounts"
            error={list.error.message}
            actionLabel="Try again"
            onPress={retry}
          />
        ) : (
          <Text style={styles.muted}>Loading accounts...</Text>
        )}
      </ScrollView>
    );
  }
  const jobRunning = data.moveJob !== null && !data.moveJob.done;
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <SettingsSection title="Default account">
        <SettingsCard>
          <DefaultAccount accounts={data.accounts} styles={styles} />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Accounts">
        {list.isError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {`Refresh failed: ${list.error.message}`}
          </Text>
        ) : null}
        {data.usageError === null ? null : <Text style={styles.warning}>{data.usageError}</Text>}
        {data.moveJob === null ? null : (
          <Text style={styles.muted}>{describeMoveJob(data.moveJob, data.accounts)}</Text>
        )}
        {data.accounts.map((account) => (
          <AccountCard
            key={account.provider}
            account={account}
            accounts={data.accounts}
            jobRunning={jobRunning}
            openWorkspace={openWorkspace}
          />
        ))}
      </SettingsSection>
      <AddAccount openWorkspace={openWorkspace} />
    </ScrollView>
  );
}
```

The two-press Move copies `ResetAction` in `plugins/shared-mcp/client/definitions-screen.tsx`. Every prop object, array and function is memoized or comes from a module constant, as the `react-perf/*` rules require.

- [ ] **Step 7: Write the client entry.** Create `plugins/claude-accounts/index.client.tsx`:

```tsx
import { useCallback } from "react";
import type {
  PluginClientContext,
  PluginOpenScreenInput,
  PluginSidebarItemProps,
} from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { AccountsScreen } from "./client/accounts-screen.js";

const SCREEN_ID = "accounts";
const TITLE = "Claude accounts";
const ICON = "Users";
const OPEN_ACCOUNTS: PluginOpenScreenInput = { screenId: SCREEN_ID };

function AccountsItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen(OPEN_ACCOUNTS), [openScreen]);
  return <SidebarRow icon={ICON} active={currentScreen?.screenId === SCREEN_ID} onPress={open} />;
}

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: TITLE, Component: AccountsScreen }),
    // A footer item shows without a workspace, so the screen is reachable on a fresh host.
    client.addSidebarFooterItem({ id: "accounts", title: TITLE, Component: AccountsItem }),
    client.addCommandCenterItem({
      id: "open-accounts",
      title: TITLE,
      icon: ICON,
      keywords: ["claude", "account", "login", "usage"],
      context: "global",
      onSelect({ openScreen }) {
        openScreen(OPEN_ACCOUNTS);
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
```

- [ ] **Step 8: Run the built-in compile test.** Run:

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts --bail=1
```

Expected: `Tests  4 passed (4)`. `findEntry` now finds `index.client.tsx`, so `compilePlugin` bundles the client side too, and its boundary check rejects any client import outside `@getpaseo/plugin`, `@getpaseo/plugin/client*`, `react`, `react-native`, `@tanstack/react-query` and `zod`.

- [ ] **Step 9: Format, lint and typecheck.** Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/claude-accounts/client plugins/claude-accounts/index.client.tsx
cd /workspace/utils/paseo && npm run lint -- plugins/claude-accounts/client plugins/claude-accounts/index.client.tsx
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: lint `Found 0 warnings and 0 errors.`; typecheck exit 0. Rerun Step 4 if the formatter changed `view-model.ts` or its test.

- [ ] **Step 10: Commit with the fork identity (local only, never push).** Run:

```bash
git -C /workspace/utils/paseo add plugins/claude-accounts/client plugins/claude-accounts/index.client.tsx
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): Claude accounts screen" -- plugins/claude-accounts/client plugins/claude-accounts/index.client.tsx
```

Expected: the hook's jobs pass, then `5 files changed`. If a hook job fails, report its output and stop.

- [ ] **Step 11: Verify the commit.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an|%ae|%cn|%ce' | grep -qxF 'tatsuya|allrested@gmail.com|tatsuya|allrested@gmail.com' && echo "fork identity" || echo "WRONG IDENTITY"
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk
```

Expected: `fork identity`; the subject and the five paths; an empty status.

### Task 11: Document the built-in

**Files:**

- Modify: `docs/plugins.md` (section "Built-in plugins": three `claude-accounts` paragraphs before the paragraph that starts "Local runs of `scripts/builtin-plugins-dist.test.mjs`", which is rewritten to cover both in-process built-ins)
- Modify: `docs/custom-providers.md` (section "Multiple profiles for the same provider": a pointer paragraph after "Each profile appears as a separate provider in the Paseo app.")

**Interfaces:**

- Consumes: what Tasks 3 to 10 build, as the docs describe it: the "Claude accounts" screen in the sidebar footer (Task 10); Add account, its links and its `claude auth login` terminal (Decisions 8 and 10); the `mcpServers` sync and `added.json` (Decisions 6 and 7); the default account and Auto's rule (Decisions 11 and 12); the handoff caveat (Decision 13); and what a move costs (Decision 15).
- Produces: the `claude-accounts` paragraphs in `docs/plugins.md` and the pointer in `docs/custom-providers.md`. No code, no new exports.

The user skipped the manual run on 2026-11-07 (Decision 21), so this task changes the two docs and nothing else: it starts no daemon, opens no browser and spends no Claude turn.

- [ ] **Step 1: Document the built-in in `docs/plugins.md`.** In the section "Built-in plugins", replace this paragraph:

```markdown
Local runs of `scripts/builtin-plugins-dist.test.mjs` and
`packages/server/src/server/plugins/lifecycle.e2e.test.ts` start this built-in in process, so give
them `PASEO_HOME=$(mktemp -d)`; otherwise it works in the real `$PASEO_HOME/shared-mcp`.
```

with:

```markdown
The `claude-accounts` built-in manages several Claude Code logins on one host. Each account is a
directory `~/.claude-<name>` with its own login, launched by the provider `claude-<name>`, whose
`env` sets `CLAUDE_CONFIG_DIR`. Open the "Claude accounts" screen from the sidebar footer; it
works before any workspace is open. Add account creates the directory and the provider entry,
links the main profile's settings, `CLAUDE.md`, skills, plugins, commands and agents into it, and
opens `claude auth login` in a terminal of your most recent workspace, so open a project first.
The reasons are in the [design](superpowers/specs/2026-11-06-claude-accounts-design.md).

`.claude.json` holds each login's own state, so it cannot be a link. The plugin keeps each
account's user-scope `mcpServers` equal to the main profile's: every 5 s it compares them and
rewrites a copy that differs, under Claude Code's own file lock, which also undoes a Claude Code
write that drops the copy. It writes only into accounts it added, recorded in
`$PASEO_HOME/claude-accounts/added.json`. A `~/.claude-<name>` made by hand shows a problem on its
row until you add the same name again, which adopts it. Links are made at Add, so an entry the
main profile gains later is shared once you add the account again.

The default account on that screen applies to every agent created with plain `claude`. Auto picks
the signed-in account with the most room, skipping any at 95% or more or on pace to run out within
30 minutes; an agent started on a named account stays on it. A move to plain `claude` from the
Move dialog or the CLI that falls back to a history handoff creates its successor through the same
choice, so it can land on another account. Move idle agents skips agents in a turn. The agents it
moves lose their background shells, `Monitor` watches and background subagents, which live in the
Claude process.

Local runs of `scripts/builtin-plugins-dist.test.mjs` and
`packages/server/src/server/plugins/lifecycle.e2e.test.ts` start these built-ins in process, so
give them `PASEO_HOME=$(mktemp -d)`. Otherwise `shared-mcp` works in the real
`$PASEO_HOME/shared-mcp`, and `claude-accounts` syncs `mcpServers` into the accounts that the real
`$PASEO_HOME/claude-accounts/added.json` records.
```

The paragraphs say what the code cannot: why `.claude.json` is copied rather than linked, which accounts the plugin writes into, the handoff caveat of Decision 13, and what a move costs. The test-run note now covers both in-process built-ins, because both write under the real `$PASEO_HOME` in a local run without a temp home. If the old paragraph reads differently by now, another change rewrote it since 2026-11-07: keep its new wording for `shared-mcp`, add the `claude-accounts` clause to it, and put the three paragraphs above it.

- [ ] **Step 2: Point the profiles section of `docs/custom-providers.md` at the built-in.** In the section "Multiple profiles for the same provider", replace:

```markdown
Each profile appears as a separate provider in the Paseo app. You can select which one to use when launching an agent.
```

with:

```markdown
Each profile appears as a separate provider in the Paseo app. You can select which one to use when launching an agent.

For Claude Code subscription logins, the `claude-accounts` built-in creates these profiles for
you, one `CLAUDE_CONFIG_DIR` each, and shares the main login's setup with them. See
[Built-in plugins](plugins.md#built-in-plugins).
```

One fact, one doc: the details live in `docs/plugins.md`, and this is a link to them.

- [ ] **Step 3: Format and check the docs.** No code changed in this task, so there is no lint or typecheck step of its own; the pre-commit hook typechecks the tree in Step 4. Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- docs/plugins.md docs/custom-providers.md && npm run format:check:files -- docs/plugins.md docs/custom-providers.md && git diff --stat -- docs/plugins.md docs/custom-providers.md && grep -n "claude-accounts" docs/plugins.md docs/custom-providers.md | cut -c1-60
```

Expected: both oxfmt runs exit 0; the diff stat lists `docs/custom-providers.md | 4 ++++` and `docs/plugins.md | 30 ++++++++++++++++++++++++++++--`, with `2 files changed, 32 insertions(+), 2 deletions(-)`; and the grep prints `docs/plugins.md:135:`, `:141:`, `:147:`, `:162:` and `:163:`, then `docs/custom-providers.md:352:`. These counts and line numbers were checked on 2026-11-07 by applying both replacements to copies of the docs, and `oxfmt --check` passed on those copies unchanged. An edit to either doc above these lines since then shifts the numbers, not the counts.

- [ ] **Step 4: Commit with the fork identity.** Stage the docs and list what is staged:

```bash
cd /workspace/utils/paseo && git add docs/plugins.md docs/custom-providers.md && git diff --cached --name-only
```

Expected: exactly two lines, `docs/custom-providers.md` and `docs/plugins.md`. This checkout is shared with other sessions, so another path in that list is someone else's staged work. Stop and ask the user; do not commit it and do not unstage it. Only when the list holds those two paths alone, run:

```bash
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "docs(fork): document the claude-accounts built-in" -- docs/plugins.md docs/custom-providers.md
```

Expected: the pathspec limits the commit to the two docs even if something is staged between the two commands. The lefthook pre-commit runs `format:check:files` on the docs, skips lint (no code), and runs the full `npm run typecheck` under the lock (1 to 3 minutes). The commit prints `docs(fork): document the claude-accounts built-in` and `2 files changed, 32 insertions(+), 2 deletions(-)`. This is a local commit only. Never push, and never set `LEFTHOOK=0`: a failing hook means a task before this one left the tree broken, so stop and report its output.

- [ ] **Step 5: Verify the commit and report.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an|%ae|%cn|%ce' | grep -qxF 'tatsuya|allrested@gmail.com|tatsuya|allrested@gmail.com' && echo "fork identity" || echo "WRONG IDENTITY"
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md docs/custom-providers.md public-docs/sdk
```

Expected: `fork identity`; the subject and the two docs; an empty status. Then tell the user that the docs landed and that no manual run took place, because they skipped it: the real `config.patch`, the provider launch and the sign-in terminal first meet a daemon in Task 12, which sub-project 6 runs. Last, remove the build log that Tasks 1 and 2 wrote, the one scratch file this plan leaves: `rm -f /tmp/claude-accounts-build-client.out`.

### Task 12: Roll the accounts out on each instance (deferred to sub-project 6, ops)

**Deferred to sub-project 6 (ops).** Do not run this task while executing this plan: the daemon on 6767 runs the published `@getpaseo/server` (0.11.1 in this container on 2026-11-07), which has no `claude-accounts` built-in, and this plan never restarts or redeploys it. Sub-project 6 runs it on each instance after its deploy has put the fork on that instance's daemon. No file in the repository changes, so the task has no repository commit.

**Files:** (none in the repository; every path is on the instance)

- Read: `/usr/local/lib/node_modules/@getpaseo/server/package.json` and `/usr/local/lib/node_modules/@getpaseo/server/dist/server/builtin-plugins/claude-accounts/paseo-plugin.json`
- Modify, through the accounts screen only (never by hand): `$PASEO_HOME/config.json` (`agents.providers.claude-<name>`), `$PASEO_HOME/claude-accounts/added.json`, `$PASEO_HOME/plugin-settings/claude-accounts/default-account.json`, and each adopted `~/.claude-<name>`
- Create: `/home/paseo/.claude/projects/-workspace/memory/paseo-claude-accounts.md`
- Modify: `/home/paseo/.claude/projects/-workspace/memory/MEMORY.md` (one index line)

**Interfaces:**

- Consumes (Tasks 1 to 10, as deployed): the screen "Claude accounts" in the sidebar footer and the Command Center; Add account (adopts an existing `~/.claude-<name>` and opens no sign-in terminal when it is signed in); the default-account picker (`claude`, `auto` or `claude-<name>`, stored in `$PASEO_HOME/plugin-settings/claude-accounts/default-account.json`, default `claude`); the record `$PASEO_HOME/claude-accounts/added.json`; the `mcpServers` sync every 5 s; Move idle agents.
- Produces: per instance, the accounts the user chose, recorded by the deployed plugin, and a memory note that tells later sessions where accounts live and what a move costs. No code, no exports.

Ground rules: never restart, stop or signal the daemon on 6767 in this task (the deploy that precedes it owns any restart); never edit `config.json`, `added.json` or a profile directory by hand; never delete a profile directory without the user's word; and never print a `.claude.json` value, a `.credentials.json` or `config.json`.

- [ ] **Step 1: Confirm the deployed daemon has the plugin.** Run:

```bash
node -p 'require("/usr/local/lib/node_modules/@getpaseo/server/package.json").version'
node -p 'JSON.stringify(require("/usr/local/lib/node_modules/@getpaseo/server/dist/server/builtin-plugins/claude-accounts/paseo-plugin.json"))'
ls -la "${PASEO_HOME:-$HOME/.paseo}/claude-accounts" 2>&1 | head -n 3
```

Expected: the fork's version (0.15.0 or later), then `{"id":"claude-accounts","requirements":{"paseo":">=0.15.0"}}`, then `No such file or directory`, because the plugin writes nothing until an account is added. `0.11.1` or `Cannot find module` means the sub-project 6 deploy has not reached this instance: stop.

- [ ] **Step 2: Read the screen.** In the Paseo app on this instance, click "Claude accounts" in the sidebar footer. Expected: "Default account" reads `Main account`; the main row shows the main profile's directory (`/home/paseo/.claude` here), its usage and its agent count; and a row for every `~/.claude-*` directory on the instance, each with the problem "Paseo did not add this account, so it shares nothing with the main account. Add it again under the same name to share the main account's setup." Nothing has changed for agents yet: plain `claude` agents still start on the main account.

- [ ] **Step 3: Add the accounts the user asks for.** Ask the user which accounts this instance should have, if any. For each, type its name under "Add account" and press `Add`. A new account opens its sign-in terminal in the most recent workspace, where the user signs in; an existing `~/.claude-<name>` is adopted, and opens no terminal when it is already signed in. Expected: once signed in, each row shows its usage and no problem, and `added.json` records its name, so its `mcpServers` copy follows the main profile. Never delete a profile directory without the user's word.

- [ ] **Step 4: Set the default account the user asks for.** Leave `Main account` unless the user asks for Auto or a specific account; then pick it under "New Claude agents" and confirm the picker shows it after a reload of the screen. Tell the user that Auto also decides where a move to plain `claude` lands when it falls back to a history handoff (Decision 13).

- [ ] **Step 5: Write the memory note.** Create `/home/paseo/.claude/projects/-workspace/memory/paseo-claude-accounts.md`:

```markdown
---
name: Claude accounts built-in
description: Several Claude logins via ~/.claude-<name>; added.json decides what the plugin writes; default account and Move idle agents
---

The `claude-accounts` built-in (fork, sub-project 5) lists every Claude Code profile: the main one
(`CLAUDE_CONFIG_DIR`, here `/home/paseo/.claude`) and each `~/.claude-<name>`, launched by the
provider `claude-<name>`. Open it from "Claude accounts" in the sidebar footer.

- Add account links the main profile's settings, skills, plugins, commands, agents and CLAUDE.md
  into the account; links are made at Add only. The account's `.claude.json` gets the main
  profile's user-scope `mcpServers`, re-copied every 5 s.
- The plugin writes only into accounts recorded in `$PASEO_HOME/claude-accounts/added.json`; a
  hand-made `~/.claude-<name>` shows a problem until it is added again.
- The default account (plugin setting `default-account`) applies to agents created with plain
  `claude`, handoff successors included. Auto skips accounts at 95% or more or on pace to run out
  within 30 minutes.
- Move idle agents never interrupts a turn; moved agents lose background shells, Monitor watches
  and background subagents.
- Accounts on this instance: <the list from Steps 3 and 4, and the default account>.
```

Fill in the last line, then add `- [Claude accounts built-in](paseo-claude-accounts.md) — ~/.claude-<name> logins, added.json decides writes, default account and Move idle agents` to `MEMORY.md` after the `Paseo fork program` line. Expected: `grep -c "paseo-claude-accounts.md" /home/paseo/.claude/projects/-workspace/memory/MEMORY.md` prints `1`.

- [ ] **Step 6: Repeat Steps 1 to 5 on every other instance** that sub-project 6 deploys, with that instance's own accounts. An instance without a second login needs only Steps 1, 2 and 5.

## Self-review

**Spec coverage.**

| Spec requirement                                                                                                                                                                         | Where the plan meets it                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| An accounts screen listing every Claude profile with its login, usage and running agents                                                                                                 | Task 4 (discovery), Task 7 (usage summary), Task 9 (`list`), Task 10 (rows)                                                                                                                                                                             |
| Form: a built-in fork plugin `plugins/claude-accounts/`, plus `move()` on the SDK's agent handle                                                                                         | Task 3 (scaffold and registry), Task 2 (`PaseoAgentHandle.move`, gated on `features.agentMove`)                                                                                                                                                         |
| What an account is: `~/.claude` or `~/.claude-<name>`, and a provider `claude-<name>` extending `claude` with `CLAUDE_CONFIG_DIR`                                                        | Decisions 3 and 4; Task 3 (`accountProvider`), Task 4, Task 9 (`addProvider`)                                                                                                                                                                           |
| Shared setup: links for `settings.json`, `CLAUDE.md`, `skills/`, `plugins/`, `commands/`, `agents/`; `mcpServers` copied and kept in sync; credentials, `projects/` and history separate | Task 5 (links), Task 6 (sync, self-heal), Decisions 7 and 8                                                                                                                                                                                             |
| Linking never overwrites; an existing file is reported on the screen and left alone                                                                                                      | Task 5 (`keep` and its problem), Task 9 (problems on the row)                                                                                                                                                                                           |
| Add account: a name, `~/.claude-<name>`, the setup-link plan, the provider patch, a terminal running the login                                                                           | Task 3 (`AccountNameSchema`), Tasks 5, 6 and 9 (`add`), Task 10 (Add form)                                                                                                                                                                              |
| The row switches to signed in when the credential file appears                                                                                                                           | Task 4 (`hasCredentials`), Task 10 (5 s poll)                                                                                                                                                                                                           |
| Sign in for a profile without a login                                                                                                                                                    | Task 9 (`signIn`), Task 10 (`SignInAction`)                                                                                                                                                                                                             |
| Default account: a specific account or Auto, applied only to plain `claude`, an explicit account kept                                                                                    | Task 3 (setting), Task 7 (decision), Task 9 (hook and its tests)                                                                                                                                                                                        |
| Auto: lowest `usedPct` in the tightest window, skipping 95% or more, else plain `claude`; it also skips a window on pace to run out within 30 minutes (the user's answer of 2026-11-07)  | Task 1 (the daemon's `tightest` and its `tone`), Task 7 (`chooseAuto` skips `danger`), Decisions 2 and 12                                                                                                                                               |
| Moving agents: only idle ones, natively and without continuing; agents in a turn skipped and counted                                                                                     | Task 3 (`MoveJob.busy` and `skipped`), Task 8 (selection, re-check, `continueWork: false`, both counts), Task 10 (two-press Move, a job line that names both counts), Decision 14 (a move that cannot be native falls back to a handoff and is counted) |
| The default account picker at the top; actions Add account, Sign in and Move idle agents to...                                                                                           | Task 10 (`DefaultAccount` first, then the rows, then Add account)                                                                                                                                                                                       |
| Unit tests: discovery, setup-link plan, Auto, idle selection; the daemon's tightest window (spec amendment)                                                                              | Tasks 4, 5, 7 and 8; Task 1 (`tightestUsageWindow`)                                                                                                                                                                                                     |
| Integration: Add account in a temp home creates the directory and links, patches the provider and copies `mcpServers`; a main-profile change reaches the account                         | Task 9 `accounts.test.ts` (temp home, fake port for the provider patch), Task 6 tests. The real config patch first runs in Task 12 (Decision 21)                                                                                                        |
| Manual: a second login sees the same skills and hooks; Auto lands on the emptier account; move idle agents and resume one                                                                | Skipped by the user on 2026-11-07 (Decision 21)                                                                                                                                                                                                         |
| Out of scope: other providers' accounts, removing an account's files, moving mid-turn                                                                                                    | No task does them: the plugin never deletes a profile file (Global Constraints), Task 8 skips agents in a turn, and only `claude` creations are rewritten                                                                                               |

**Placeholder scan.** No step says TBD, TODO or "similar to Task N"; every code step shows its code and every command its expected output. Task 12 is marked deferred on purpose and holds complete steps for sub-project 6; the angle brackets in its memory note are the one line its Step 5 says to fill in.

**Type consistency.** Each Consumes line names something an earlier task or sub-project 4 Produces: Task 1 takes sub-project 4's `chooseTightestWindow`, `UsageScopeQuery`, `MoveTargetUsageLookup` and `sharedMoveTargetUsage`; Task 2 calls Task 1's request; Task 4 takes Task 3's name schema and provider naming; Tasks 5 and 6 take Task 4's error helpers; Task 7 reaches Task 2's `move` and `listUsageForProvider` through `PluginHandlerContext["paseo"]` and Task 3's shapes; Task 8 takes Task 7's `AccountsApi` and `AgentInfo`; Task 9 composes Tasks 3 to 8 behind the four RPCs and the hook; Task 10 consumes only Task 3's contracts, served by Task 9; Task 11 documents what Tasks 3 to 10 build; Task 12 uses the deployed screen. The tightest window's `tone` runs from Task 1's `UsageTightestWindowSchema`, where `chooseTightestWindow` judges it, through Task 2's `PaseoProviderReportsResult` and Task 9's port, which passes `tightest` through, to Task 7's `UsageTone`, `summarizeUsage` and `chooseAuto`; Task 9 copies it from the summary into `AccountHeadroom`. `MoveJob.busy` runs from Task 3's schema through Task 8's `start` and Task 9's `moveIdle` result to Task 10's job line, and Task 7's `DefaultAccountDeps.timeoutMs` is filled by Task 9 with `DECIDE_TIMEOUT_MS`. The copy strings in Task 10's tests match `view-model.ts` and the hint constants in `accounts-screen.tsx`, and Task 11's docs name the screen, Add account and Move idle agents as the screen labels them.

**Checks run on the plan text.** The 25 plugin source files and the manifest were extracted from their steps into a scratch tree outside the repo and run through the repo configs: `oxfmt --check` passes on all 26, and `oxlint` reports 0 warnings and 0 errors on the 25 source files, so the format step in each task leaves them as written. The snippets for `packages/protocol`, `packages/server` and `packages/client` were formatted alone or inside a matching class, interface or object, with the same result. After the critique's edits on 2026-11-07 the 25 plugin files, `usage-session.ts` and Task 1's test additions were extracted again: `oxfmt --check` passes on all 27, and `oxlint` with the repo's `.oxlintrc.json` reports 0 warnings and 0 errors. `npm run lint` panics on paths outside the repo root, so that run used the repo's `oxlint` binary from the scratch tree with `-c` pointing at the repo config. After the controller's amendments on 2026-11-07, Task 1's protocol test, schema, `usage-session.ts` and test additions and Task 7's three files were extracted again into a scratch tree, with sub-project 4's Task 1 `usage-heads-up.ts` standing in for `@getpaseo/protocol/usage-heads-up`: `oxfmt --check` passes on all seven, `oxlint` reports 0 warnings and 0 errors, and vitest passes `usage-session.test.ts` (10 tests, the four existing ones included) and `default-account.test.ts` (15 tests). Nothing was typechecked, and nothing else was run: each task's own typecheck and test steps are the first proof.

**Where the plan departs from the spec, on purpose.** The user approved every departure that changes behaviour on 2026-11-07; `.superpowers/plan-drafts/claude-accounts-spec-amendment.md` holds the spec text that states them.

- Usage comes from a new daemon RPC and `paseo.providers.listUsageForProvider`, not `paseo.providers.listUsage` (Decision 1).
- The sign-in terminal runs `claude auth login`, not `claude /login` (Decision 10): it signs in without starting a chat session.
- Login state is the credential file or any usage report for the provider's scope, not the usage source's account label (Decision 9).
- Rows are labelled with the account name or "Main account", never an email (Decision 20).
- The plugin writes `mcpServers` only into accounts it added, not into every account (Decision 6), and links are made at Add only (Decision 8), on which the spec is silent. The docs say both (Task 11 Step 1).
- Auto skips an account whose tightest window has the `danger` tone, 95% or more or on pace to run out within 30 minutes, where the spec names 95% only; unknown usage is never a candidate, so with usage off Auto always keeps plain `claude` (Decision 12).
- A move to plain `claude` started outside the plugin that falls back to a history handoff goes through the default account (Decision 13).
- A move the daemon cannot do natively falls back to a history handoff and is counted, where the spec says "natively" (Decision 14).
- No manual run: the user skipped the spec's manual test (Decision 21).
- `setup-link.ts` does not watch `mcpServers`; `mcp-sync.ts` and `claude-config.ts` do, and the service and the port live in `accounts.ts` and `paseo-port.ts` (File Structure). The behaviour is the spec's.

**Spec requirements not fully mapped.** The spec's manual checks, a second login that sees the same skills and hooks, Auto landing on the emptier account and a moved agent that resumes, have no run (Decision 21). The unit tests cover the links (Task 5), the `mcpServers` copy (Task 6), Auto (Task 7) and the move job (Task 8); a real launch is first seen in Task 12. macOS Keychain logins (Decision 9's usage fallback) are not exercised: the test host is Linux.

**Risks.**

- Task 1 imports sub-project 4's exports, so this plan cannot start before sub-project 4 lands; Task 1 checks for them first. The shared edits to `messages.ts`, `session.ts` and `websocket-server.ts` are adjacent inserts (Cross-plan interfaces).
- A move to plain `claude` started outside the plugin that falls back to a history handoff goes through the default account (Decision 13); documented, not prevented.
- Moved idle agents lose background shells, `Monitor` watches and background subagents (Decision 15); the confirm hint and the docs say so.
- The `mcpServers` write can race Claude Code's own writes; Claude Code's lock and the 5 s self-heal cover it, and a lock older than a minute shows on the row.
- The sign-in terminal needs `claude` with `auth login` on the daemon's `PATH` and an open workspace; the OAuth step always needs a person.
- `config.patch` with a passthrough `providers` record is typed loosely; Task 9's typecheck is the first proof, and a type error there is fixed in the port's types, never with a cast.
- No manual run (Decision 21): the real `config.patch`, the provider launch, the hook on a real creation and the sign-in terminal first meet a daemon in Task 12, on a deployed instance.

## Critique log

Independent review on 2026-11-07, against `main` at `6b987b134` (the commits after `1eaa71b2f` touch only `heavy-command-gate`, its docs and one line of the built-in list, which Task 3 Step 6 still fits). One line per defect: what was wrong, then what changed.

- Test design, Tasks 3 to 10: each "watch them fail" step expected `Failed to load url ./<module>.js`, which vitest 4.1.7 keeps only as the cause. Each now expects `Error: Cannot find module './<module>.js' imported from <test file>` and no test run, the message `startVitestModuleRunner.bRl2_oI_.js:712-718` builds; a scratch run printed it word for word.
- Test design, Task 1 Step 2: the expected failure described "an invalid union discriminator", zod 3's issue, which zod 4.4.3 no longer has. It now quotes what zod 4.4.3 raises: `invalid_union` with the note "No matching discriminator", path `type`.
- Test design, Task 3 Step 7: the expected failure lacked the `Error: ` prefix and its source. It now quotes `Error: Plugin manifest is missing: <path>` from `readPluginManifest` (`manifest.ts:44`).
- Test design, Task 7: the decide timeout was tested with `vi.useFakeTimers`, a monkey-patched global that `docs/testing.md` ("Two test categories, no others") rules out. The timeout is now the injected `DefaultAccountDeps.timeoutMs`, Task 9 passes `DECIDE_TIMEOUT_MS`, and the test uses a real 20 ms timeout with a setting that never settles.
- Test design, Global Constraints and Tasks 4, 6, 7 and 9: the constraints required explicit fixture types, but several fixtures were untyped literals, and the bullet banned only `vi.mock`, not `vi.spyOn`, fake timers or other patched globals. The bullet now names all of them and says no typecheck sees a plugin test, and the fixtures carry `NodeJS.ProcessEnv`, `McpServerFixture`, `CreateRequest` and `MoveJob` types.
- Test design, Task 9: the move test asserted fragments (`started.ok`, `started.job?.total`). It now asserts the whole result.
- In-process safety, Task 7: the timer in `withTimeout` was not unref'd, so a pending choice could hold the daemon process open. It is `.unref()`ed, as `waitAtMost` in `plugins/shared-mcp/server/process-runner.ts` does.
- Spec coverage, Tasks 3, 8, 9, 10 and 11: the spec's "agents in a turn are skipped and counted" had no count, because `total` and `skipped` covered only idle agents. `MoveJob` gains `busy`, set when the job starts, shown as "Skipped N agents in a turn", and checked by the probe and Step 15; Decision 14 says so.
- Spec scope, Task 9: `moveIdle` accepted any `from`, so the RPC could move Codex or other agents onto a Claude account. It now refuses a provider no profile uses with "No account uses <provider>", and the service test covers it.
- Protocol compatibility, Tasks 1 and 2: the `usageProviderReports` flag and the two SDK gates carried no `COMPAT(...)` tag. Each now carries `COMPAT(<name>): added after v0.15.2 (fork); remove gate after 2027-05-07.`
- Spec deviation handling, Decision 1 and Task 2: the "if rejected" note was one sentence that named the controller as the decider, spoke of a "usage half" of Task 1, which is all usage, and left Tasks 4, 7, 9 and 11 out; Task 2 mixed the spec's `move()` with the Decision 1 method. Decision 1 now names the user and lists the change per task, and Task 2's "D1 half" paragraph names the steps, the test count and the file count to drop.
- Cross-plan, interfaces table: the ranking row deferred the two rankings to "after both land", though the program lands sub-project 4 first, so the move dialog and `tightestUsageWindow` disagree from this plan's first commit, and the lookup row kept its fix in the table while Task 1 Step 12 ignored it. The ranking row now says when the two name different windows and points to Open item 2, and the lookup row points to Step 12's two cases.
- Cross-plan, names: this plan called the shapes `UsageScope` and `UsageScopeLookup` and mirrored the threshold as `AUTO_SKIP_PCT`. They now carry sub-project 4's names, `UsageScopeQuery`, `MoveTargetUsageLookup` and `USAGE_DANGER_PCT`.
- Cross-plan, Task 1 Step 12: the step passed the module constant `moveTargetUsage`, which sub-project 4 deletes, so this plan would not compile after it. The step now passes `sharedMoveTargetUsage` when `session.ts` imports it, else `moveTargetUsage`.
- Cross-plan, ranking: Decision 2 said sub-project 4's ranking change "lands in one place", and two code comments (`tightestUsageWindow`, `AccountUsageSchema`) tied the rule to the move dialog's, but sub-project 4 changes `toMoveTarget` alone, before this plan runs. Decision 2 now says the daemon holds two rankings until one function serves both, and the comments state the rule alone.
- Cross-plan, shared files: the overlap row named whole files. It now gives each plan's regions in `messages.ts`, `session.ts` and `websocket-server.ts`.
- API reality, Task 1 Consumes: `session.ts:574-577` and `session.ts:3064-3066` pointed a few lines off. They now read `:572-575` and `:3068-3070`.
- Host safety, every verify step: `git log` printed the commit author's email address. The steps now compare author and committer with the fork identity and print `fork identity` or `WRONG IDENTITY`.
- Host safety, Task 11 Step 18 and the abort path: the app stores the dev host with this run's password in the shared Chrome's `localStorage`, which outlives the tab. Both now remove `@paseo:daemon-registry` before closing the tab.
- Host safety, Task 11 Step 23: the kept dev home, the main profile's test transcripts, `~/.claude-second` and the `/tmp` scratch files, including Tasks 1 and 2's `build-client.out`, had no cleanup commands. Step 23 lists each with its command, removed only on the user's word.
- Self-review: the Decision 1 risk understated the fallback and called Decision 1 the controller's call. It now points to Decision 1's list and to the user's sign-off, and the checks paragraph records the format and lint re-run after these edits.

### Controller resolutions (2026-11-07)

1. Settled: the user chose the new `usage.provider.list_reports` RPC and `listUsageForProvider` (Decision 1), so the list of changes for a refusal is gone.
2. Settled: sub-project 4 exports `chooseTightestWindow` from `usage-heads-up.ts`, and Task 1's `tightestUsageWindow` calls it, so the accounts screen, Auto and the move dialog name the same window.
3. Settled: Auto also skips a window on pace to run out within 30 minutes (the user's answer). The daemon sends the tightest window's heads-up `tone` (Task 1) and `chooseAuto` skips `danger` (Task 7); no `runsOutAt` goes on the wire, because no screen here shows one.
4. Settled: Task 1 imports `UsageScopeQuery` and `MoveTargetUsageLookup` from sub-project 4's `list-move-targets.ts`, and the plugin's `USAGE_DANGER_PCT` mirror is gone, because the tone carries the threshold.
5. Settled: sub-project 4 lands first. Task 1 checks for its exports before Step 1, and Step 12 passes `sharedMoveTargetUsage` only.
6. Settled: the user approved all seven deviations (Decisions 6, 9, 10, 12, 13 and 20, and the native-move fallback in Decision 14); `.superpowers/plan-drafts/claude-accounts-spec-amendment.md` holds the spec text.
7. Accepted: the integration test stays a fake port over real files in a temp home (Task 9), and the spec amendment's Testing section says so; the real config patch first runs in Task 12.
8. Settled: the user skipped the manual run (Decision 21), so Tasks 1 to 11 sign in no second login, print no dev password and spend no Claude turn.
9. Settled: Task 12 stays deferred to sub-project 6.
10. Settled: Task 11 is the docs task alone, in five steps.
11. Noted: `MoveJob.busy`, the "No account uses <provider>" refusal and `DefaultAccountDeps.timeoutMs` stand as written.

### Controller amendments (2026-11-07)

- Task 1: checks for sub-project 4's exports before Step 1; `tightestUsageWindow(reports, now)` calls `chooseTightestWindow` and returns the window's heads-up `tone`, optional in `UsageTightestWindowSchema`; `UsageScopeQuery` and `MoveTargetUsageLookup` are imported, not declared; Step 12 passes `sharedMoveTargetUsage` only. One new test, a 60% window that runs out in 20 minutes over a 75% one, takes Step 11 from 9 to 10 tests; the protocol and validator fixtures carry `tone`.
- Task 2: the "D1 half" paragraph is gone.
- Task 3: the `AccountUsageSchema` comment names the daemon's pick.
- Task 7: `UsageTone`, `UsageSummary.tone` and `AccountHeadroom.tone`; `chooseAuto` skips `danger`, and the `USAGE_DANGER_PCT` mirror is gone. Three new tests, 60% running out in 20 minutes skipped, 94% with no run-out kept and unknown usage never picked, take Step 5 from 12 to 15.
- Task 9: `NO_USAGE` and the headroom carry the tone; the port's note no longer points at a manual test.
- Task 10: the Auto hint names the 30-minute rule; the test ids stay for a later manual run.
- Task 11: the manual run, its helpers, scratch files, sign-in wait and `~/.claude-second` handling are gone. The docs steps are the whole task (Steps 1 to 5), the Auto sentence in the docs names the 30-minute rule, and Steps 3 and 4 expect `32 insertions(+)`.
- Task 12: no Task 11 leftovers; Step 3 adds the accounts the user asks for, and the memory note states the Auto rule.
- Decisions: 1, 2, 12, 13, 14 and 21 rewritten; the approvals marked on 1, 6, 9, 10, 12, 13, 14 and 20; the intro names the spec amendment file.
- Global Constraints, Cross-plan interfaces, File Structure and Self-review follow; Open for the controller became Controller resolutions (2026-11-07).

### Controller pre-flight rulings (2026-11-07, applied early)

- `tone` is required on `UsageTightestWindowSchema`: the schema and its RPC are new, so no older daemon sends a window without one, and an optional tone would let a window with none pass Auto's danger check. Changed: Decision 2, the Task 1 wire line and schema, Task 9's Consumes line and its `UsageTone` alias (no `NonNullable`), and the three fixtures that left `tone` out (the Task 2 client test, the Task 9 `usageAt(usedPct, tone)` helper with its callers `usageAt(80, "warning")` and `usageAt(20, "none")`, and the Task 9 `Session` 62% fixture, `tone: "none"`). Test counts unchanged.
- Task 10's test ids stay: the settings screens put a `testID` on their rows (`packages/app/src/screens/settings/providers-section.tsx`, `restart-recovery-card.tsx`), and Task 12's run uses them.
