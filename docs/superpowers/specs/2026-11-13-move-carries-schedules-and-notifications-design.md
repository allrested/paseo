# A move carries schedules, heartbeats and finish notifications design

Date: 2026-11-13. Fork: allrested/paseo. Status: approved by the user on 2026-11-13 ("LGTM"), watched side revised the same day (option A); built 2026-11-13.
Builds on [session move](2026-11-05-session-move-design.md).

## Goal

After a move, whatever was aimed at the agent that was left is aimed at the agent that carries
the session on: schedules, heartbeats and finish notifications. The same holds after a move back.

Today a move archives the agent it leaves, and three things end with it:

- Archiving completes every schedule whose target is that agent (`ScheduleService.completeForAgent`,
  called from the agent-archived callback). A heartbeat is such a schedule. The successor gets none
  of them, and move back does not revive them.
- A finish notification whose watcher (`callerAgentId`) is the archived agent is dropped:
  `callerIsActive` is false for it, so the record is removed undelivered. The successor never hears
  that its sub-agent finished.
- A sub-agent that hits its limit reports "errored" to its parent, which uses up the parent's
  finish notification. When the sub-agent is then moved and continues, nothing tells the parent
  that the successor finished.

## Decisions

| Subject          | Decision                                                                                                                                    | Source           |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Scope            | Schedules, heartbeats and finish notifications, in one piece.                                                                               | user, 2026-11-13 |
| Watched moves    | When a moved agent has a parent on this host and the move continues its work, the parent gets one notification when the successor finishes. | user, 2026-11-13 |
| Mechanism        | Schedules are re-pointed at the move. A notification for a watcher that moved follows the moved-to link at delivery.                        | user, 2026-11-13 |
| Wiring           | The move reaches both stores through one `MoveCarry` object held by `AgentManager`, as the agent-archived callback is.                      | this spec        |
| Move back        | The same rule in the other direction. No separate code path.                                                                                | this spec        |
| Failed move      | The schedules the move re-pointed are pointed back, and the parent's new notification is withdrawn.                                         | this spec        |
| Earlier losses   | Schedules completed by a move before this ships stay completed.                                                                             | this spec        |
| Schedule content | Cadence, run history, pause state, expiry and run count are untouched. Only the target agent id changes.                                    | this spec        |

Why schedules are rewritten and notifications are not: a heartbeat belongs to an agent, and the
heartbeat tools check the stored target (`requireCallerHeartbeat`), so the successor must be the
stored target at once or it can neither list nor delete its own heartbeats. A finish notification
has no owner-facing tool; what matters is where it is delivered, and that is decided at delivery.

Why the watched side registers a new notification: by the time a watched agent is archived, its
notification is spent. A turn that fails on the limit reports "errored" at once. A move of a
running agent cancels the turn first (`settle`), which reports "finished". An idle agent reports
immediately. Following a link from the archived agent would be code that does not run. The first
plan for this side, and the user's "hears nothing at the move", were dropped for that reason on
2026-11-13; the user chose this one.

## The move's access to both stores

`session-move/move-carry.ts` defines:

```ts
export interface MoveCarry {
  /** Points not-completed schedules aimed at `from` at `to`; with `only`, just those ids. */
  retargetSchedules(from: string, to: string, only?: readonly string[]): Promise<string[]>;
  /**
   * Registers a finish notification from `agentId` to its parent, held until `accept()`.
   * Undefined when the labels name no parent, or a parent on another host.
   */
  notifyParentOnFinish(
    agentId: string,
    labels: Record<string, string>,
  ): Promise<FinishRegistration | undefined>;
}
```

`AgentManager` gets `setMoveCarry(carry: MoveCarry | null)` and a `moveCarry` getter, next to
`setAgentArchivedCallback`. `bootstrap.ts` sets it once the schedule service and the finish
subscriptions exist. The move is started from two places (`session.ts` and the `move_agent` tool),
both of which already pass the agent manager, so neither changes. A manager with no carry set, as
in unit tests, moves as today.

## Schedules and heartbeats

`ScheduleService` gets one method:

```ts
/** Points every not-completed schedule aimed at `fromAgentId` at `toAgentId`. Returns their ids. */
retargetAgent(fromAgentId: string, toAgentId: string, only?: readonly string[]): Promise<string[]>;
```

It updates each matching schedule through `store.update`, changing `target.agentId` and
`updatedAt` and nothing else. With `only`, it touches just those ids, which is how the undo runs.
A schedule that is completed, or aimed at another agent, is left alone.

`finish` in `session-move/move-agent.ts` calls `moveCarry.retargetSchedules` after the sub-agents are handed over and before
`archiveAgentCommand`, and stores the returned ids in `FinishProgress.retargetedScheduleIds`. The
archive that follows calls `completeForAgent(from.id)` as before and finds nothing.

`undoFinish` calls it with the arguments swapped and `only` set to the stored ids, before it
unarchives `from`. A failure there is logged, as the other undo steps are, and does not stop the
rest of the undo.

Move back runs the same `finish`, with the original as `to`, so its schedules return to it.

A run in flight during the move is not interrupted. `runSchedule` read its target before the
move; that run goes to the agent it read. The next run reads the new target.

Name collisions: `upsertByNameAndTarget` treats name plus target as one identity. If the successor
already holds a schedule with the same name as one being carried, both are kept. A later create
with that name refreshes the first match, as it does today for any duplicate. A successor is a
fresh agent on a forward move, so this needs a move back onto an agent that registered the same
name twice across the chain; it is recorded here, not designed around.

## Finish notifications

### Where an agent is now

A new function in `session-move/move-agent.ts`, used by the finish subscriptions. It takes a lookup
as `resolveMoveBackChain` does, so it is tested without a daemon; `movedAgentLookup(deps)` builds
the real one from agent storage and the agent manager:

```ts
/**
 * The agent that carries `agentId`'s session now: follows moved-to links from an archived agent
 * until one that is not archived. Null when the chain ends at an archived agent with no link,
 * at an agent with no record, or in a loop.
 */
resolveMovedAgent(agentId: string, lookup: MovedAgentLookup): Promise<string | null>;
```

An agent that is not archived resolves to itself, whatever stale label it carries: move back
unarchives the original and clears its moved-to label, and a live agent ends the walk anyway. The
walk stops after `MAX_MOVE_CHAIN` steps, the bound the move-back chain uses.

### The watcher has moved

`Dependencies` in `finish-subscriptions/index.ts` gets `resolveCaller(agentId): Promise<string | null>`
in place of the yes/no `callerIsActive`. It returns the agent to deliver to: the caller itself when
active, its live successor when it moved, null when neither exists.

`suppressed` and `deliver` use the resolved id:

- null: the record is removed undelivered, as today for an archived caller.
- a different id: the record is saved with `callerAgentId` set to it, the watch is filed under its
  new key, and delivery goes to that agent.
- the ownership check for creation subscriptions (`requireParentOwnership`) compares the child's
  parent label with the resolved caller. The move re-parented the child to the successor, so the
  check holds for a moved watcher and still ends the subscription for a detached child.

### Saving a re-pointed record

`store.put` with the same `id` overwrites the record, so a daemon restart resumes the watch with
the right watcher. The in-memory watch group is keyed by caller, child and host; re-pointing moves
the watch from its old group to the one for the new key, keeping the result it already observed.

### A moved agent that continues reports to its parent

In the three places a move sends the continue turn (native forward, handoff forward, move back),
when `continueWork` is on:

1. `moveCarry.notifyParentOnFinish(successorId, labels)` registers a notification from the
   successor to the parent named in its labels, with `requireParentOwnership` on and dispatch
   pending, as agent creation does for an initial prompt.
2. The continue turn is sent. If that throws, the registration is rejected and the error goes on.
3. The registration is accepted.

If the move fails later, the catch path rejects the registration before it removes the successor,
so the parent is not told about an agent that no longer exists.

With `continueWork` off nothing is registered: the successor is idle and would report at once.

The parent may itself have moved since; delivery follows its moved-to link as above.

## Known limits

- Schedules completed by a move before this ships stay completed.
- Only a parent is told when a moved agent's successor finishes. An agent that prompted the moved
  agent with notify-on-finish, without being its parent, is not: nothing records who it was once
  its notification is spent.
- A parent on another host is not told. Its notifications live on its own host.
- The parent still gets the notification the old agent's turn produced: "errored" for a limit,
  "finished" for a turn the move cancelled.
- A finish that arrives while the watcher's move is in progress, before the old agent is
  archived, is delivered to the old agent.
- A schedule run already started when the move happens goes to the agent being left.

## Goals, non-goals, anti-goals

Goals: no schedule, heartbeat or finish notification is lost to a move or a move back; the
successor owns its heartbeats at once; a failed move leaves all three as they were.

Non-goals: reviving what earlier moves completed; telling watchers other than the parent;
retargeting anything that names an agent outside these two stores.

Anti-goals:

- A notification about a successor that a failed move removed.
- A schedule that fires at an archived agent, or at both agents.
- A notification delivered twice, to the old watcher and to its successor.

## Tests

- `schedule/service.test.ts`: `retargetAgent` changes the target of every not-completed schedule
  aimed at the agent and returns their ids; leaves completed schedules and other agents' schedules
  alone; keeps pause state, runs and expiry; with `only`, touches just those ids.
- `session-move/move-agent.test.ts`: `resolveMovedAgent` for a live agent, one move, two moves, a chain ending at an
  archived agent with no link, a missing record, and a loop.
- `finish-subscriptions/finish-subscriptions.test.ts`: a watcher that moved gets the notification
  at its successor, and the stored record names it; a watcher with no successor is dropped; a
  creation subscription still reports to a moved watcher and still stops for a detached child; a
  restart after the re-point resumes with the new watcher.
- `session-move/move-agent.e2e.test.ts`, which runs a real daemon and so the real carry: a moved
  agent's heartbeat is aimed at the successor and still active; a failed move leaves it aimed at
  the original; move back returns it; a sub-agent moved with continue on reports its successor's
  finish to the parent, once; with continue off the parent gets nothing.

## Docs

- The session move spec's "Known limits" line on schedules, heartbeats and finish notifications
  is rewritten to state what holds now and to point here.
- `docs/agent-lifecycle.md` states the same limit in its session move section ("Schedules and
  heartbeats aimed at the agent you move are completed..."); that sentence is rewritten too.

## As built

- The failed-move test makes the archive itself fail, the step right after the schedules are
  re-pointed, and checks the heartbeat is back with the original.
- A parent that moved getting its sub-agent's finish is covered in the finish subscription tests,
  not by a move on a test daemon.
