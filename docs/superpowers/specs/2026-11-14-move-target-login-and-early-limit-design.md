# A move refuses a signed-out target, and the limit shows before a turn fails: design

Date: 2026-11-14. Fork: allrested/paseo. Status: approved by the user on 2026-11-14 ("A"); not built.
Builds on [session move](2026-11-05-session-move-design.md) and
[the usage heads-up](2026-11-06-usage-heads-up-design.md).

## Goal

Two moments where a move or a turn fails in front of the user stop happening:

- A move to an account that is not signed in is refused before anything changes. Today the move
  cancels the running turn, creates the new agent, and fails on its first turn.
- An agent whose account is at 100% shows the limit banner, with its move offer, before the user
  sends a turn that fails. Today the banner appears only after a failed turn, and the usage watch
  reads only accounts that have a running agent, so an idle agent's account is never read.

## Decisions

| Subject        | Decision                                                                                                                                 | Source           |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Login signal   | The CLI's own answer: `claude auth status` and `codex login status`, run with the target's environment.                                  | this spec        |
| Other families | Unknown. A family with no probe moves as today.                                                                                          | this spec        |
| Unknown        | Allowed. A slow, failing or unreadable probe never blocks a move.                                                                        | shown to user    |
| Refusal        | The move refuses a signed-out target before it settles the source, with "<label> is not signed in".                                      | shown to user    |
| Dialog         | A signed-out target is listed as unavailable, labelled "Not signed in". One new optional field on the target.                            | shown to user    |
| Watch scope    | The usage watch reads the account of every open agent, idle ones included. Its 80% and 95% notices still name a running agent only.      | user, 2026-11-14 |
| Limit flag     | A window at 100% sets `limitReached` on that account's agents. It clears when the watch reads the account below 100%, or on a good turn. | shown to user    |
| Freshness      | As fresh as the watch, which runs every 310 seconds.                                                                                     | shown to user    |

Why the CLI and not the usage sources: the usage sources were the first idea, and they do not
agree on what "no login" looks like. The Claude source returns no account, which is also what it
returns for a Bedrock, Vertex or API-key setup that is signed in another way. The Codex source
returns an error string. A new typed problem kind would break older apps, which parse the usage
problem as a closed union. `claude auth status` prints `"loggedIn": false` in 0.3 seconds and
knows every way that CLI can be signed in.

## Login probe

`session-move/target-login.ts`:

```ts
export type TargetLogin = "signed_in" | "signed_out" | "unknown";

export interface LoginProbeInput {
  family: string;
  /** The provider's command override, when it has one. */
  command?: ProviderCommand;
  env: Record<string, string>;
}

/** Runs the family's own login status command. Never throws. */
export function probeTargetLogin(input: LoginProbeInput, run: RunCommand): Promise<TargetLogin>;
```

| Family   | Command              | Signed out when                       | Signed in when                       |
| -------- | -------------------- | ------------------------------------- | ------------------------------------ |
| `claude` | `claude auth status` | stdout is JSON with `loggedIn: false` | stdout is JSON with `loggedIn: true` |
| `codex`  | `codex login status` | output contains "Not logged in"       | exit code 0                          |

Anything else is `unknown`: another family, a non-zero exit with other output (a broken Codex
config exits 1 too), output that does not parse, a missing binary, or five seconds without an
answer. A provider whose command is replaced (`command.mode === "replace"`) is `unknown` as well:
the replacement may be a wrapper that does not take these arguments. An appended command keeps
the default binary and is probed.

The command runs with the daemon's environment overlaid with the target's launch `env`, which is
how a profile selects its login (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`).

`ProviderLaunchInfo` gains `command?: ProviderCommand`, from the same runtime settings its `env`
comes from.

Results are cached for 60 seconds per provider id through `createUsageLookup`, which already gives
the move dialog a time limit and a shared in-flight call.

## Where the probe is used

`MoveCarry` gains `targetLogin(providerId: string): Promise<TargetLogin>`, wired in `bootstrap.ts`.
Its doc comment is widened from "what a move takes along" to "what a move needs from outside the
agent".

- **Forward move.** `moveAgent` asks after `requireTarget` and before `settle`. `signed_out`
  throws `MoveAgentError("unavailable", "<label> is not signed in")`. Nothing has changed yet: the
  source's turn is still running.
- **Move back.** `moveAgentBack` asks for the original's provider at the same point, before the
  current agent is settled.
- **Target list.** `listAgentMoveTargets` takes a `loginOf(info)` and sets `signedOut` on each
  target. `toMoveTarget` makes a signed-out target not `available`. The current provider is not
  probed.

Wire: `AgentMoveTargetSchema` gains `signedOut: z.boolean().optional()`. An older app ignores it
and shows the target as unavailable, which is correct. The app's `move-targets.ts` shows
`sessionMove.dialog.notSignedIn` for it in place of the generic unavailable label.

## Limit before a failed turn

The usage watch (`usage-watch.ts`) changes in two ways.

**Which accounts it reads.** `UsageWatchDeps.runningAgents` is joined by `openAgents()`: every
agent the manager holds that is not internal. The watch reads one account per provider that has
an open agent. The 80% and 95% notices are unchanged: they fire only for a provider with a
running watched agent, and name that agent.

**What it does at 100%.** After reading a provider's reports:

- A report is available and has a window at 100% or more: every open agent on that provider with
  no `limitReached` gets one, `{ at, message: "<account> <window label> limit reached" }`. The
  watch remembers the `at` it set for each agent.
- Every available report is below 100%: each agent whose `limitReached.at` is the one the watch
  set is cleared. A flag a failed turn set is never cleared by the watch.
- No report is available (unavailable, error, none): nothing changes.

`UsageWatchDeps` gains `setLimitReached(agentId, value)` and `limitReachedOf(agentId)`.
`hasSpentWindow` moves from `usage-limit-fallback.ts` to a shared export so both use one rule.

The memory of what the watch set does not survive a daemon restart. A flag left over after one is
cleared by the agent's next good turn, as today.

## Known limits

- Only Claude and Codex targets are probed.
- A login that is stored but that the provider now rejects reads as signed in. The first turn
  still fails for it.
- The limit flag is up to 310 seconds behind the account. A turn sent inside that gap fails as
  today, and the failed turn sets the flag.
- A flag the watch set before a daemon restart stays until the agent's next good turn.
- The watch reads one account per provider id per pass. With usage turned off in the daemon
  config it reads nothing, as today.

## Goals, non-goals, anti-goals

Goals: a signed-out target is refused before the source's turn is touched; an open agent on a
spent account shows the limit banner within one watch pass; no new failure mode for a move.

Non-goals: probes for other families; signing the user in; checking the login at agent creation.

Anti-goals:

- A move blocked because a probe was slow, crashed or printed something unexpected.
- The watch clearing a limit that a failed turn reported.
- A second notification channel: the flag drives the banner that exists, nothing is pushed.

## Tests

- `target-login.test.ts`, with a fake `run`: each row of the table; non-JSON output; exit 1 with
  other output; a thrown spawn error; a timeout; an unknown family; a replaced command; the env
  passed to the command.
- `move-targets.test.ts` / `list-move-targets.test.ts`: a signed-out target is not available and
  carries `signedOut`; the current provider is not probed; an unknown login changes nothing.
- `move-agent.e2e.test.ts`: a move to a signed-out target is refused, the source is not archived
  and its running turn is not cancelled; the same for move back; an unknown login moves as today.
- `usage-watch.test.ts`: an idle agent's account is read; a window at 100% flags every open agent
  on the provider and none on another; a later read below 100% clears only flags the watch set;
  an unavailable report changes nothing; the 80% and 95% notices still need a running agent.
- App `move-targets.test.ts`: a signed-out target shows the "Not signed in" label.

## Docs

- The session move spec's two "Known limits" lines on sign-in and on the limit notice are
  rewritten to state what holds now and to point here.
- `docs/agent-lifecycle.md`, where it says what sets `limitReached`: the watch is added.
