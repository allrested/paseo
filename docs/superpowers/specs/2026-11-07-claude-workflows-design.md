# Claude workflow card — design

Date: 2026-11-07. Status: approved design; not yet planned. Sub-project 8 of the fork program.

## Problem

Claude Code's `Workflow` tool runs many agents in the background. Paseo shows a run as one row in the
subagents track and one "Workflow" tool card. The card turns `completed` the moment the run
launches and never changes again. Nothing shows the agents inside the run, which phase it is in, or
whether it is still alive. Claude Code writes the inner agents only to disk; they never reach the
SDK stream. On 2026-11-07 two runs died with a Claude process restart, and Paseo showed nothing
beyond a `failed` row.

## Scope

In scope:

- A live card for Claude agents, in place of the plain Workflow card: the run's state and, for each
  agent inside it, its phase, state, tool calls, last tool, tokens and last activity.
- Past runs, read once from disk.

Out of scope: the subagents track row and the provider-subagent pane (plugins have no surface
there), controlling runs (stop, resume, rerun), other providers, and any command text, tool output,
prompt, result or script.

## Decisions

| Question       | Decision                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where it shows | A timeline transformer replaces the `tool_call` named `Workflow` with a plugin item, and its renderer is the card. The plain card's script view goes away.   |
| Packaging      | Built-in plugin `claude-workflows`, on for every instance at the next deploy. It only reads files.                                                           |
| Data flow      | The card polls `claude-workflows.run.request` every 3 s while the run is Running and stops otherwise. The daemon runs no timers or watchers for it.          |
| Finding a run  | The daemon derives every path from the agent's snapshot (Claude session id, cwd) and the run id. It never takes a path from the app.                         |
| Reading        | Incremental: each file keeps a byte offset and its partial last line, and a poll reads only the bytes added since the last one.                              |
| Liveness       | A run record means Completed or Killed. Without one, a live Claude process for the session that started before the newest agent means Running; else Stopped. |
| Privacy        | Tool names, file paths, counts, tokens, times, labels and phases only.                                                                                       |

There is no wire change: the feature uses a plugin RPC and a client transformer. Plugin RPCs need
`daemon.manage`, and a client without it loads no plugin code, so it keeps the plain card.

## Components

`plugins/claude-workflows/`, registered in `builtinPlugins`:

- `shared/`: the run view schema and the RPC contract.
- `index.server.ts` and `server/`: locating a run, the incremental reader, the fold, the state
  check, the cache and the RPC handler.
- `index.client.tsx` and `client/`: the transformer and the card renderer.

## Where the data lives

These are Claude Code's undocumented files, as observed with Claude Code 2.1.x. An update can change
them, so every reader tolerates unknown lines and keys and degrades to a partial card or
Unavailable.

- Config dirs: `CLAUDE_CONFIG_DIR`, `~/.claude`, and every `~/.claude-<name>` profile.
- Session dir: `<cfg>/projects/<slug>/<sessionId>/`. The slug is `realpath(cwd)` with every
  non-alphanumeric character replaced by `-`, cut at 200 characters plus a hash suffix. This is
  copied from `packages/server/src/server/agent/providers/claude/project-dir.ts`, which a built-in
  cannot import.
- Run dir: `<session>/subagents/workflows/<runId>/` holds `journal.jsonl`, `agent-<id>.jsonl` and
  `agent-<id>.meta.json`.
- Run record: `<session>/workflows/<runId>.json`. Claude Code writes it once, when the run completes
  or is killed with TaskStop. A run whose process died has none.
- Live processes: `<cfg>/sessions/<pid>.json` holds pid, sessionId and procStart. Never read
  `sessions/*.key` or `.credentials.json`.
- Formats:
  - The run id is `wf_` plus 8 hex digits, a dash and 3 hex digits.
  - Journal events are `launched`, `started {key, agentId, label, phase}`, `result {key, agentId}`
    and `failed {key, agentId}`. They carry no timestamps, and there is no end event.
  - A resume appends to the journal, and each key it reruns gets a new agentId.

## The card

The transformer matches a `tool_call` named `Workflow` whose result text holds `Run ID: wf_...`. It
replaces the card with a plugin item carrying the run id and the run's summary. Without a run id
(the launch is still pending, or the call failed) the plain card stays.

- Header: "Workflow", the summary, a state chip, and totals: agents, done, failed, tool calls,
  tokens and elapsed time.
- States:
  - Running: a live Claude process for the session owns the run.
  - Completed: the run record says so.
  - Killed: the record says the run was stopped with TaskStop.
  - Stopped: no record, and the process that ran it is gone, for example after an effort or model
    change.
  - Unavailable: the run cannot be located or read, with one short reason.
- Body: agents grouped by phase, in start order. The journal records only starts, so an agent
  still queued is not shown until it starts. Each row shows:
  - its state: running, done, failed, stopped or unreadable;
  - its label;
  - its tool calls;
  - its last tool, with its file when the tool has one (relative to the agent's cwd, or just the
    base name for a file outside it), marked running until that tool's result arrives;
  - its tokens;
  - its last activity, for example "2m ago".
- A Running card shows its agents and refreshes every 3 s. A finished card shows its header and
  opens on tap. Polling stops once the state is not Running.
- A resumed run keeps its run id, so the first card and the resumed card both show its latest
  attempt.
- Copy follows `docs/design.md` §10.

## Server

1. Locate:
   - Get the agent's snapshot with `paseo.agents.ref(agentId).refresh()`. It must be a Claude agent
     with a session id (`persistence.sessionId`) and a cwd.
   - In each config dir, try `projects/<slug>/<sessionId>/` first, then scan `projects/*` for the
     session id.
   - The run id and session id must match their formats, and the resolved run dir must sit inside
     its config dir.
   - An agent id of the form `provider:<parent>:<sub>` resolves to `<parent>`.
2. Reader:
   - Per file, read from the saved offset to the current size in chunks of at most 1 MB, splitting
     on newlines and keeping the partial last line.
   - Start over from zero when the file shrank or its inode changed.
   - Parse a line only when it can matter: it mentions `tool_use` or `tool_result`, or it is an
     assistant line with usage.
3. Fold:
   - Journal: the newest `started` per key wins, which gives each agent's label, phase and agentId.
     `result` marks an agent done and `failed` marks it failed.
   - Agent file:
     - tool calls are the assistant blocks of type `tool_use`, so a prompt that merely contains the
       text is not counted;
     - the last tool is the newest such block's name, plus `input.file_path` when it is a string;
       it counts as running until a `tool_result` with its id arrives;
     - tokens are the newest assistant usage, input plus cache read plus cache creation plus output
       (the context size Claude Code reports per agent);
     - first and last activity come from line timestamps.
4. State check:
   - A run record gives Completed, or Killed when its status is `killed`. Only its status, end time
     and name are read; the record holds prompts and results.
   - Without a record, find a `<cfg>/sessions/<pid>.json` for the session whose process is alive,
     whose `/proc/<pid>/stat` start time equals its procStart, and which started no later than the
     newest agent's first activity. That gives Running; anything else gives Stopped.
   - An agent with neither `result` nor `failed` is running in a Running run and stopped otherwise.
5. Cache: one entry per run dir, holding each file's offset, partial line and fold, at most 32
   entries; when full, the least recently used goes first. A call drops entries no call has used
   for 10 minutes. Calls for the same run are
   handled one at a time.
6. RPC: `claude-workflows.run.request {agentId, runId}` returns the run view, validated by the
   shared schema on both sides.

## Errors and edge cases

- A file that fails to read marks only its agent unreadable; the rest of the card renders.
- Missing run files, a non-Claude agent or a failed snapshot give Unavailable with one reason. The
  summary and the run id stay visible. Whether an archived agent's snapshot can still be read is
  checked early in the plan.
- A failed refresh keeps the last data and shows "Refresh failed"; the next poll tries again.
- First reads of large files (agent files reach about 10 MB) go in 1 MB chunks, so the daemon's
  event loop is never held for long.
- A daemon restart loses the cache; the next poll rebuilds it from offset zero.
- In-process safety: all work runs inside the RPC handler, whose errors the host catches. There are
  no timers, no watchers and no detached promises, so cleanup has nothing to stop.

## Testing

- Unit, one file per run:
  - the transformer: Workflow cards with and without a run id, other tools, other providers;
  - locating a run: `CLAUDE_CONFIG_DIR`, `~/.claude` and `~/.claude-<name>` profiles, the cwd slug
    and then the scan, bad ids, a run dir that escapes its config dir;
  - the reader: appends, a partial last line, a file that shrank or was replaced, and a prompt that
    mentions `tool_use` not counted;
  - the fold: a resume, a failed agent, a killed run;
  - the state check against a fake `/proc` and sessions dir: live, a restarted process giving
    Stopped, records giving Completed and Killed;
  - the RPC handler with a fake `paseo`, as shared-mcp's tests do.
- Fixtures are built in the tests from typed objects. Real transcripts are never copied, since they
  hold prompts.
- Manual, on the dev daemon (port 6768, with the memory guard): a dev Claude agent runs a small
  3-agent workflow.
  - The card updates live, ends Completed, and polling stops.
  - A run stopped with TaskStop shows Killed.
  - A run cut off by reloading the agent shows Stopped.
  - A run from before the plugin existed loads once.
- Docs: a paragraph in the "Built-in plugins" section of `docs/plugins.md`.
