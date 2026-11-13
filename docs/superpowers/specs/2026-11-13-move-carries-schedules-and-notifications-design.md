# A move carries schedules, heartbeats and finish notifications design

Date: 2026-11-13. Fork: allrested/paseo. Status: approved by the user on 2026-11-13 ("LGTM"); not built.
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
- A finish notification whose watched agent (`childAgentId`) is the archived agent reports "was
  closed" to the watcher, while the work goes on in the successor. Nothing reports when the
  successor finishes.

## Decisions

| Subject          | Decision                                                                                                                         | Source           |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| Scope            | Schedules, heartbeats and finish notifications, in one piece.                                                                    | user, 2026-11-13 |
| Watched moves    | The watcher hears nothing at the move and gets one notification when the successor finishes.                                     | user, 2026-11-13 |
| Mechanism        | Schedules are re-pointed at the move. Finish notifications follow the moved-to link when they are about to be dropped or closed. | user, 2026-11-13 |
| Move back        | The same rule in the other direction. No separate code path.                                                                     | this spec        |
| Failed move      | The schedules the move re-pointed are pointed back. Notifications need no undo: a failed move removes the link they follow.      | this spec        |
| Earlier losses   | Schedules completed by a move before this ships stay completed.                                                                  | this spec        |
| Schedule content | Cadence, run history, pause state, expiry and run count are untouched. Only the target agent id changes.                         | this spec        |

Why two mechanisms: a heartbeat belongs to an agent, and the heartbeat tools check the stored
target (`requireCallerHeartbeat`), so the successor must be the stored target at once or it can
neither list nor delete its own heartbeats. A finish notification has no owner-facing tool; what
matters is where it is delivered and what it watches, and the record of a watcher on one host can
watch an agent on another, where this host sees no move happen. The moved-to label
(`paseo.moved-to-agent-id`) travels with the watched agent's final state, so following it works
across hosts.

## Schedules and heartbeats

`ScheduleService` gets one method:

```ts
/** Points every not-completed schedule aimed at `fromAgentId` at `toAgentId`. Returns their ids. */
retargetAgent(fromAgentId: string, toAgentId: string, only?: readonly string[]): Promise<string[]>;
```

It updates each matching schedule through `store.update`, changing `target.agentId` and
`updatedAt` and nothing else. With `only`, it touches just those ids, which is how the undo runs.
A schedule that is completed, or aimed at another agent, is left alone.

`MoveAgentDeps` gets an optional `retargetSchedules(fromAgentId, toAgentId, only?)`, wired in
`bootstrap.ts` to the service. Optional, because the move's unit tests build the deps without a
schedule service, and a daemon without one has nothing to carry.

`finish` in `session-move/move-agent.ts` calls it after the sub-agents are handed over and before
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

A new function in `session-move`, used by the finish subscriptions:

```ts
/**
 * The agent that carries `agentId`'s session now: follows moved-to links from an archived agent
 * until one that is not archived. Null when the chain ends at an archived agent with no link,
 * at an agent with no record, or in a loop.
 */
resolveMovedAgent(deps: { agentStorage; agentManager }, agentId: string): Promise<string | null>;
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

### The watched agent has moved

In `run`, before `deliver`: when the observed result is final, its status is `closed`, and its
labels carry a moved-to id, nothing is delivered. The record is saved with `childAgentId` set to
that id, the observation is closed, and the watch continues on the new agent under its new key.
`serverId` is unchanged: a move stays on its host.

This reads only the label in the final state, so the watcher's host needs no knowledge of the
move. If the successor has already finished by the time the watch reopens, the observation
reports that at once, as it does for any idle agent.

A chain of moves is followed one step per observation: each archived agent names the next.

### Saving a re-pointed record

Both cases replace a stored record. `store.put` with the same `id` overwrites it, so a daemon
restart resumes the watch on the right pair. The in-memory watch group is keyed by caller, child
and host; re-pointing moves the watch from its old group to the one for the new key, where the
existing supersession rules apply to it as to any other registration for that pair.

## Known limits

- Schedules completed by a move before this ships stay completed.
- A watched agent on a host whose daemon predates the moved-to label in final states still
  reports "was closed".
- A finish that arrives while the watcher's move is in progress, before the old agent is
  archived, is delivered to the old agent. Its turn is already ending; the successor does not
  see it unless the handoff history carries it.
- A schedule run already started when the move happens goes to the agent being left.

## Goals, non-goals, anti-goals

Goals: no schedule, heartbeat or finish notification is lost to a move or a move back; the
successor owns its heartbeats at once; a failed move leaves all three as they were.

Non-goals: reviving what earlier moves completed; telling a watcher at the moment of the move;
retargeting anything that names an agent outside these two stores.

Anti-goals:

- A "was closed" notification for an agent whose work continues elsewhere.
- A schedule that fires at an archived agent, or at both agents.
- A notification delivered twice, to the old watcher and to its successor.

## Tests

- `schedule/service.test.ts`: `retargetAgent` changes the target of every not-completed schedule
  aimed at the agent and returns their ids; leaves completed schedules and other agents' schedules
  alone; keeps pause state, runs and expiry; with `only`, touches just those ids.
- `session-move/move-agent.test.ts`: a move re-points before the archive, so the archive completes
  nothing; a move that fails after `finish` began points exactly the changed schedules back; move
  back returns them to the original.
- `session-move`: `resolveMovedAgent` for a live agent, one move, two moves, a chain ending at an
  archived agent with no link, a missing record, and a loop.
- `finish-subscriptions/finish-subscriptions.test.ts`: a watcher that moved once and twice gets
  the notification at its successor, and the stored record names it; a watcher with no successor
  is dropped; a creation subscription still reports to a moved watcher and still stops for a
  detached child; a watched agent that moved sends no "was closed", and the successor's finish is
  delivered once; a restart between the move and the finish resumes on the re-pointed record.
- One case on the move itself, with a real schedule service and finish subscriptions: an agent
  with a heartbeat and a watching parent moves and finishes; the heartbeat's next run reaches the
  successor and the parent gets one notification, naming the successor.

## Docs

- The session move spec's "Known limits" line on schedules, heartbeats and finish notifications
  is rewritten to state what holds now and to point here.
- `docs/agent-lifecycle.md` states the same limit in its session move section ("Schedules and
  heartbeats aimed at the agent you move are completed..."); that sentence is rewritten too.
