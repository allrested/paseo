# Session move — design

Date: 2026-11-05. Status: planned in `docs/superpowers/plans/2026-11-05-session-move.md` and implemented on the fork; unreleased.

## Problem

When an agent's provider account runs out of quota, the agent stops. The existing handoff path (`skills/paseo-handoff`) asks the stuck agent itself to write a briefing and create the receiving agent, which fails because the agent's model has no quota left. You need to move the session to another account or provider without calling the exhausted model, and move it back once the account resets.

## Scope

In scope:

- Move an agent to another account of the same CLI family (for example Claude `~/.claude` to a `claude-work` profile with `CLAUDE_CONFIG_DIR=~/.claude-work`).
- Move an agent to a different provider (Claude, Codex, OpenCode, Kiro CLI, any enabled provider).
- Move it back, including through a chain of moves.
- A banner that offers a move once a turn fails on the account's limit, and the move back afterwards.
- The app dialog, CLI command, and MCP tool.
- Moving a subagent on its own. Its successor keeps the parent link and stays in the parent's track. Moving a parent re-parents its live subagents to the successor and does not move them.

Out of scope: automatic failover (Paseo never moves an agent by itself) and moving terminal agents.

## Decisions

| Question              | Decision                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Trigger               | Manual "Move session…" action, plus a banner after a turn fails on the account's limit. The user always picks the target.     |
| After the move        | The new agent takes over the original's tab; the original is archived and linked.                                             |
| Cross-provider pickup | A "Continue automatically" switch in the move dialog, on by default.                                                          |
| Chain history         | The live agent's stored record carries the whole session's history (`moveHistory`), because archived agents keep no timeline. |
| Limit signal          | The daemon's `limitReached` only. The app reads no usage to decide whether to show the limit notice.                          |
| Where the code lives  | Daemon feature with app UI, in its own module, with small hooks into upstream files.                                          |

## Architecture

### Daemon: `packages/server/src/server/agent/session-move/`

RPC `agent.move.request` / `agent.move.response` (dotted namespace, see `docs/rpc-namespacing.md`), with `{ agentId, target: { provider, model? }, continueWork }`. The response payload is `{ ok, agentId, strategy, fellBackFromNative, error }`: the agent that holds the session now, `native` or `handoff`, and whether a native attempt fell back to a handoff.

One move runs per agent at a time; a second is refused as busy. The move runs these steps:

1. **Refuse.** Before anything changes, refuse an archived source (`not_found`; the message names the agent it moved to), and a target that is disabled or whose provider snapshot for the agent's cwd is not ready (CLI missing, catalog failed). The readiness check waits for the snapshot, as `createAgentCommand` would, so the turn is never stopped for a target that cannot start. The archived check runs again after that wait, which can take minutes, so an archive during it still refuses the move.
2. **Settle.** If the agent is mid-turn, interrupt it and wait for the turn to end. Call `ensureAgentLoaded`, then read the full timeline with `agentManager.getTimelineRows`.
3. **Extend the chain.** `extendMoveHistory` (`handoff-context.ts`) appends a segment for the source's own rows to the chain on its stored record. See "Chain history".
4. **Choose a strategy.**
   - **Native.** Used when source and target are both Claude and the source persistence handle has a session id. Copy `<source config dir>/projects/<folder>/<sessionId>.jsonl` (paths from `providers/claude/project-dir.ts`) into the target config dir under the same folder name, through a temp file and a rename. A target file that is not a byte prefix of the source holds turns the source lacks: leave it alone and fall back to a handoff. Then resume the same session id under the target provider with `resumeAgentFromPersistence`, and hydrate its timeline from the transcript.
   - **History handoff.** Used for every other pair, and when a native attempt fails (`fellBackFromNative`). Create a new agent in the same `workspaceId` and cwd with `createAgentCommand`. Within one CLI family it keeps the source's mode, when the target lists it, and its feature values; across families it starts in the target's default mode. The history is `renderMoveHistory` over the chain, wrapped in `<paseo-move-history>`: a deterministic header that needs no model (the session's original task, the files touched in `tool_call` rows, the newest open todo list, and the newest error), then the segments' curated entries through `buildAgentForkContextAttachment` (`activity-curator.ts`), each segment under `[Agent] <label>`.
5. **Store.** One `agentStorage.setMoveState` on the new agent writes `moveHistory` (the chain, with `sinceSeq` set to the new agent's last timeline seq) and `pendingMoveContext`. A handoff stores the rendered history there. A native hop stores the source's undelivered `pendingMoveContext`, because the shared transcript lacks it. With `continueWork: true`, the daemon sends "Continue where the previous agent stopped."; otherwise the history waits for the agent's next prompt. Whatever starts that turn takes it and prepends it (`takePendingMovePrompt`, called by `sendPreparedPromptToAgent` and by agent-target schedule fires). It is persisted, so it survives a daemon restart, and cleared when the turn starts.
6. **Link.** Re-parent the source's live subagents to the new agent. The new agent copies the source's other labels and gets `paseo.moved-from-agent-id = <old id>`. The original gets `paseo.moved-to-agent-id = <new id>`, then is archived. Do not use `paseo.parent-agent-id`: archiving cascades to children, so it would archive the new agent too.
7. **Broadcast** an `agent.moved` event `{ fromAgentId, toAgentId }`.

The original is archived only after the new agent exists, and has started when continue is on. A failure at any earlier step deletes the half-created agent, removes a transcript the copy created or truncates one it replaced back to its old size, undoes the re-parenting and linking, and leaves the original untouched.

### Chain history

Paseo keeps no timeline for an archived agent: archive drops it from memory, and reading it back means resuming the provider session. A delivered history also never enters the receiver's live timeline, because `submittedPromptText` drops blocks with a `mimeType`. So the live end of a chain carries the session's history on its stored record as `moveHistory`, which never goes on the wire:

- `originalTask`: the session's first typed task, set once at the first agent and copied forward. The continue prompt never counts.
- `segments`: one per agent that held the session, oldest first, each with its agent id, provider label, curated entries, touched files, open todos and last error. An agent that never ran keeps an empty segment, which a move back to it needs.
- `sinceSeq`: the agent's own rows are the ones after this seq. A native successor replays its predecessor's transcript, and the cut keeps those turns out of its own segment. It is a seq because a replayed row without a provider timestamp gets the replay time. A hydrate of a transcript that only grew renumbers the same prefix rows, so the cut survives a restart.

The entries and their `[Agent]` lines are capped at 96k characters over the whole chain: the oldest segment loses entries first, and segments and their facts always stay. The cap leaves room for the fork builder's header under its 100k budget, so the builder never trims a move history and a kept segment never loses its label. A Claude transcript keeps the history block it received, so the block shows up in a user message whenever the timeline is rebuilt from disk; `extendMoveHistory` strips `<paseo-move-history>` and `<chat-history-summary>` blocks from user messages before it curates them.

### Move back

RPC `agent.move_back.request` / `agent.move_back.response`, with `{ agentId, continueWork, toAgentId? }` and the same response payload. Move back targets the agent named in `paseo.moved-from-agent-id`, or any earlier agent in the moved-from chain (`toAgentId`). Before anything changes it refuses an archived source, a target outside the chain, a target that is no longer archived (`busy`, "active again"), since that agent has its own session going on, and a target whose provider is not ready. Then it settles the current agent, unarchives the target and:

- **Same session:** when both run the same Claude session id and the target login's transcript is a byte prefix of the newer one, it copies the newer transcript back, reloads the target from disk and hydrates its timeline. The target's pending history becomes the current agent's undelivered one; its own older one is obsolete.
- **Otherwise:** the target resumes its own session and gets, as a history attachment with the same header, the segments after its own last segment: the work done since the session left it, by every agent after it. A target that never delivered the history it inherited gets every segment.

The target gets `paseo.moved-from-agent-id = <the agent being left>`, replacing an older value, so it can move back again, and its `limitReached` is cleared before the continue turn. The agent being left is archived and linked exactly like a forward move. A failed move back re-archives the target with its previous moved-to and moved-from labels, move state and `limitReached`.

### Limit detection

A limit is reported when a turn fails with a limit error. It only drives the banner and never moves anything.

One matcher (`limit-matcher.ts`) reads the failed turn's error text for every provider and recognises "usage limit", "5-hour limit", "weekly limit", "rate limit", "429" and "quota". A match sets `limitReached: { at, message }` on the agent's state. A completed turn clears it, and so does a move back to the agent. It is stored on the agent's record and survives loading the agent again after a daemon restart.

When the matcher misses on a failed turn, `usage-limit-fallback.ts` reads `UsageSourceRegistry.listReports({ agentId, forceRefresh: true })` and sets the flag when a window is at 100%, which catches limit messages the matcher does not know. The read is forced because a cached report from before the limit was hit still shows room. Usage at 100% with no failed turn is not a signal; the usage heads-up covers that case.

The move dialog shows each target's usage. Targets have no agent yet, so the registry's `listReportsForScope({ provider, env })` runs the private `discover({ kind: "session", ... })`, keyed by CLI family and the profile's env. Each target's lookup is cached for a minute and gives up after five seconds with unknown usage, so the dialog stays fast. With Check usage off, no usage is read.

### Protocol

All additions are optional fields or new messages, per `docs/protocol-compatibility.md`:

- `agent.move.request` / `.response` and `agent.move_back.request` / `.response`, both `workspace.write`
- `agent.move_targets.list.request` / `.response`, which returns each target's `provider`, `label`, `family`, `available`, `current`, `usedPct` and `resetsAt`. It is `daemon.read`, because it combines provider and usage reads that need that authority.
- the `agent.moved` event, `workspace.read`, in the session event subscription
- an optional `limitReached: { at, message }` on the agent state
- the server feature flag `server_info.features.agentMove`, which the app gates the UI on

`available` is false for a disabled target and for one whose snapshot in the agent's cwd is `unavailable` or `error`. A target that is still loading stays selectable: the move waits for it and refuses it then. The app subscribes to `agent.moved` in its own request, because a daemon rejects a whole subscription request that names an event it does not know.

### App

- **Tab menu → "Move session…"**, on every agent tab except an archived agent's, opens a dialog:
  - Targets are grouped by CLI family, one row per provider or profile, each with a usage badge that adds the reset time once the target is at 100%.
  - The current target and unavailable targets cannot be selected. A disconnected host says so and disables Move.
  - Model picker, defaulting to the target's default model.
  - "Continue automatically" switch, on by default.
- **Banner** on the agent screen:
  - When the agent's `limitReached` is set: "<account> limit reached, resets <time> · Move to…". The account and reset come from the agent's own move target, and the reset is named only while that target is at 100% and the reset is still ahead, so a 429 under full usage names none. Each notice reads the targets again when it appears.
  - After a move: "Moved from <account> · Move back", highlighted when that account's usage is under 100%. While Move back is on screen and the account is at its limit, the banner reads the targets again every five minutes, the lifetime of the daemon's usage cache. Move back from the banner returns to the direct moved-from agent and continues.
  - The limit notice wins over the move back. The banner fetches the move targets only while a notice is on screen in an active panel.
- **Tab swap.** On `agent.moved`, retarget the workspace layout tab (`stores/workspace-layout-actions.ts`) from the old agent id to the new one; when the new agent already has a tab, close the old one and focus that tab. Whenever the agent list, the fetched agent details or the layout changes, a tab whose agent is archived with `paseo.moved-to-agent-id` follows the chain to the live agent. This covers root agent tabs on clients that were offline during the move.

### CLI and MCP

- CLI: `paseo agent move <id> --to <provider> [--model <id>] [--no-continue]` and `paseo agent move-back <id> [--to <agent-id>] [--no-continue]`. The output has the agent moved from, the agent that holds the session, the strategy and `fellBackFromNative`, in the table and in `--json`.
- MCP tool `move_agent` with `{ agentId, provider?, model?, back?, toAgentId?, continueWork? }`, so another agent with quota left can move a stuck one. `provider` and `model` are for a forward move; `back: true` takes only `toAgentId`. Inputs that mix the two are refused before any move.

## Error handling

| Failure                                                                                        | Behavior                                                                                                                                           |
| ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source agent is archived                                                                       | Refuse with `not_found`; the message names the agent it moved to.                                                                                  |
| Target disabled, CLI missing or catalog failed                                                 | Refuse with `unavailable` before the turn is stopped. The dialog greys the target out.                                                             |
| Claude transcript missing or unreadable, or the target login's copy has turns the source lacks | Fall back to history handoff and report `fellBackFromNative: true`.                                                                                |
| Agent busy and the interrupt does not settle                                                   | Refuse with "Agent is busy; stop it first."                                                                                                        |
| Another move of the agent, or of the move-back target, is running                              | Refuse as busy.                                                                                                                                    |
| Move-back target is active again                                                               | Refuse as busy: "active again; archive it before moving back to it".                                                                               |
| New agent fails to start                                                                       | Delete the new agent and undo the transcript copy; the original stays active.                                                                      |
| Move back fails                                                                                | Re-archive the target with its previous labels, move state and limit, and undo the transcript copy; the current agent stays active.                |
| Daemon restarts mid-move                                                                       | The original is archived last, so the worst case is two live agents and no lost work.                                                              |
| History over 96k characters                                                                    | The chain drops entries from the oldest segment first, so the fork builder never has to trim it. The header and the original task are always kept. |

## Testing

- **Unit:** limit matcher with real error strings; `extendMoveHistory` and `renderMoveHistory` (the cut, the original task, stripping, trimming, the slice after a target); Claude transcript copy with the real directory encoding in temp dirs (create, replace a prefix, diverged, undo, no temp file left); move target availability; the app's banner, targets and form models.
- **Integration**, using the in-process daemon harness in `docs/ad-hoc-daemon-testing.md`:
  - Same-family move resumes the same session id under the target profile, and the original is archived with both labels.
  - Cross-provider move creates the agent in the same workspace with the history attached, tested with `continue` on and off.
  - Chains: two handoffs carry the first agent's work and task, a history never delivered survives another move, and a handoff after a native hop does not resend the replayed turns.
  - Move back, one and two hops, native and by handoff, and moving back again from the agent returned to.
  - Refusals: archived source, active-again target, unavailable and disabled targets, mixed MCP inputs.
  - Rollback when the new agent fails to start, when linking fails, and when a move back fails.
  - `limitReached` survives a load and is cleared by move back.
- **App:** a tab retargets on `agent.moved`, and a stale tab follows `paseo.moved-to-agent-id`.
- **Manual:** desktop app against real Claude accounts and Codex before release.

## Known limits

- Cross-provider moves lose tool-level fidelity. The target sees a text history, not the source's native session.
- A handoff to another CLI starts in the target's default mode. Mode and feature values carry over only within one CLI family.
- A Claude or Codex target whose CLI says nobody is signed in is refused before the move starts. Other families are not asked, and a stored login the provider now rejects still fails on its first turn; see [the target login check](2026-11-14-move-target-login-and-early-limit-design.md).
- The limit notice can be up to 310 seconds behind the account: the usage watch sets it on every open agent whose account is at 100%, and a turn sent inside that gap fails first. See [the limit before a failed turn](2026-11-14-move-target-login-and-early-limit-design.md).
- The pending history is delivered at most once: it is taken when the turn starts and never restored, because a turn that fails after dispatch may already be stored by the provider. The work is not lost, since `moveHistory` keeps it and the next move carries it.
- Move back replaces the target's older `paseo.moved-from-agent-id`, which takes that agent out of move-back reach. It stays archived, and its work stays in `moveHistory`.
- Schedules and heartbeats aimed at a moved agent follow it, on a move and on a move back, and a finish notification for a watcher that moved reaches its successor. Only the parent of a moved agent is told when a successor that continued finishes; see [what a move carries](2026-11-13-move-carries-schedules-and-notifications-design.md) for the remaining limits.
- A rewind into the turns before `sinceSeq` breaks the cut, so a later handoff can drop or resend turns around it.
- If Claude Code ever rewrites earlier transcript lines, a native move back finds a diverged copy and falls back to a handoff. It loses no turns.
- On a client that was offline during two or more moves of one session, a moved subagent's tab closes: the client knows only the live agent's `paseo.moved-from-agent-id`, which names the last agent left, and a subagent successor does not open a tab on its own. One move while offline keeps the tab.
- With continue off, the first prompt carries the history as a block array, and Codex handles slash commands only in a string prompt, so a first `/compact` runs as a model turn.
