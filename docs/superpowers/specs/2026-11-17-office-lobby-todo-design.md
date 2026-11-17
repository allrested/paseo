# The lobby board's to-do list: design

Date: 2026-11-17. Status: built.

## Request

The owner wants the lobby board to work like a to-do app they showed in a screenshot: a field
to add a to-do, a checkbox on each one, a "Clear finished" button, and a separate section with
the agents' tasks. The screenshot is not in the repo; this document is the reference.

## What is there

Every room has a board, and the lobby has one for the host (board id `lobby`). A post is a task
(open, claimed or done) or a note, kept with all other boards in `$PASEO_HOME/office/boards.json`
(`plugins/office/server/board-store.ts`). A board holds 200 posts, and done tasks are dropped 7
days after they were finished (`plugins/office/server/board-service.ts`). Agents read and post with
`office_read`, `office_post` and `office_update`, on their room's board or with `board: lobby`
(`plugins/office/server/agent-tools.ts`). A post that names an agent wakes it.

The board sheet (`plugins/office/client/board-sheet.tsx`) is the same for every room: Task/Note
chips, a text box, "Wake an agent with it", Post, then the posts with "Mark done" and "Delete".
The 3D scene, the 2D floor and the structure view's room cards all open it. The room card
(`plugins/office/client/room-board.tsx`) previews three posts. The office's room model drops done
tasks before any view sees them (`visiblePosts` in `plugins/office/shared/model.ts`).

The activity poller (`plugins/office/server/activity.ts`) reads the newest 10 timeline items of
each running agent every 5 s for the "doing now" line and the step. Providers that keep a
checklist (Claude's to-do tool and others) put it on the timeline as a `todo` item:
`{ type: "todo", items: AgentTaskItem[] }`, where an item has `text`, `completed`, and optionally
`id`, `status` (`pending`, `in_progress`, `completed`) and `activeForm`
(`packages/protocol/src/agent-types.ts`). The office reads nothing from it today.

## Decisions

The owner made these:

| Question                   | Decision                                                                                                                                                                                           |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where                      | The to-do view replaces the posts view on the lobby board only. Every other room keeps its posts board as it is.                                                                                   |
| How many lists             | One to-do list for the whole office: the lobby board's.                                                                                                                                            |
| What a to-do is            | A task post on the lobby board. Ticking marks it done, unticking reopens it. Tasks already on the lobby board are to-dos.                                                                          |
| Agents and to-dos          | Agents keep their tools: they read, add and tick lobby to-dos as lobby tasks. A to-do that names an agent wakes it, as a post does today.                                                          |
| Existing posts             | Nothing is lost. Lobby notes get a short Notes section under the to-dos.                                                                                                                           |
| Hiding finished ones       | "Clear finished" deletes the done to-dos. The 7-day drop of done tasks stays, so a finished to-do also goes by itself after a week. There is no separate hide switch.                              |
| Agent tasks                | Each agent's own checklist, shown per agent, finished steps left out, until the agent has no unfinished step.                                                                                      |
| Where checklists come from | The existing 5 s activity read. The server keeps each agent's newest checklist in memory. It is not saved: after a daemon restart an agent's checklist shows again when the agent next updates it. |

## The lobby board

```
Lobby board
┌─────────────────────────────────────────┐
│ [ Add a to-do...                ] [Add] │
│   Wake an agent with it: Nobody      >  │
│                                         │
│ To-do                  [Clear finished] │
│ ☐ Rotate the staging keys               │
│ ☐ Check the nightly build · Ali claimed │
│ ☑ Update the README                     │
│                                         │
│ Notes                                   │
│ You · The demo is moved to Thursday     │
│                                         │
│ Agent tasks                             │
│ Ali                                     │
│   ◐ Write the migration test            │
│   ○ Run typecheck                       │
│ Sara                                    │
│   ○ Draft the release notes             │
└─────────────────────────────────────────┘
```

Calls made in the design and shown to the owner with it:

- **Add.** A one-line field, placeholder "Add a to-do", and an Add button, the sheet's one accent
  button. Enter adds too. Add is off while the field is empty. It posts a task to `lobby` through
  `office.post.request`. "Wake an agent with it" stays under the field and works as on other
  boards, with the same line when "Wake agents" is off. The field is cleared as the posts form
  clears it today (`textAfterSend`), and the choice of agent goes back to nobody.
- **The list.** Open and claimed to-dos first, then done ones; oldest first within each. A claimed
  to-do says who claimed it; one that names an agent says so, as `postMeta` does today. A done
  to-do is ticked and its text dimmed.
- **The checkbox.** Ticking sends `done`, unticking sends `reopen` through `office.update.request`.
  Any to-do can be ticked, claimed or not, as "Mark done" allows today. A done task keeps its
  `claimedBy`, so unticking a done to-do that was claimed reopens it as open and unclaimed: that
  is what `reopen` does today (`withoutClaim`), and the server does not change. A failed change
  shows its error under the row, as `ActionButton` does, and the box shows the board's state.
- **Delete.** Each to-do and each note keeps Delete with its "Delete this post?" check.
- **Clear finished.** Off when no to-do is done. It asks "Delete N finished to-dos?" with Delete
  and Keep, the same pattern as a post's delete. It deletes the lobby's done tasks in one save.
- **Notes.** Under the list, oldest first, with Delete. The section is absent when the lobby has no
  notes. The kind chips are gone on the lobby board: the field adds to-dos only. A note comes from
  an agent's `office_post`.
- **Agent tasks.** A heading, then one group per agent that has an unfinished step: the agent's
  name, then its unfinished steps in the agent's order, each on one line. A step in progress is
  marked as in progress (◐), the others as waiting (○). The text is the step's `text`. When no
  agent has a checklist the section says "No agent tasks". It cannot be changed from the board.
  Every agent in the office counts, in every room, sub-agents included: the owner asked for any
  agent's tasks. Groups follow the office's order: room by room as the structure view lists
  rooms, and within a room in its agent rows' order, so a sub-agent comes under its parent. The
  name is the agent's title as the board shows authors (`authorName`).
- **Empty list.** "No to-dos" under the To-do heading.
- **The lobby's room card.** In the structure view it previews the first three open or claimed
  to-dos and the count of the other open or claimed ones (done ones are not counted), and says "No to-dos" when there are none. Other room cards are
  unchanged.

## Agent checklists on the server

- The poller already reads each running agent's newest 10 items. It also takes the newest `todo`
  item among them and reports, with each round of reads, the checklists it read. An agent whose tail has no `todo`
  item, or whose read failed, is not in that report.
- The hub owns the map of checklists. Each round it replaces the checklist of every agent in the
  report and keeps the others. So a checklist stays when the agent stops (the poller reads only
  running agents) and when its `todo` item leaves the 10 newest items.
- The hub drops an agent's checklist when the agent leaves the office's agent list (archived or
  closed), when it applies the directory's new view. It empties the map when the directory stops,
  like the activity lines.
- A step counts as unfinished when `completed` is false and `status` is not `completed`; either
  one saying finished wins, because providers do not keep the pair consistent. The server keeps
  and sends unfinished steps only. An agent with none is left out of the map.
- Untrusted shape: an item without a string `text` is skipped. Text is cut to one line of at most
  200 characters (builder's call on the exact cut), and at most 50 steps per agent are sent.
- The checklists reach the app on the office's state: an optional `checklists` field, agent id to
  steps (`{ text, status: "pending" | "in_progress" }`), on the snapshot and on every `activity`
  event. Every activity event carries the whole map, as it carries the whole `doing` map, and the
  app replaces its map with it. The hub sends an activity event when the lines, the steps or the
  map change, including when it drops a leaving agent's checklist. The field is optional because
  the protocol rules ask new fields to be optional; the plugin's server and app ship together, so
  the app reads a missing field as no checklists and needs no other fallback.

## Components

- `shared/contracts.ts`: the checklist step schema, `checklists` on `OfficeSnapshotSchema` and on
  the `activity` event; a `clearDoneRpc` named `office.board.clear_done.request` with input
  `{ board }`, answering like `office.delete.request`.
- `server/activity.ts`: read the newest `todo` item from the tail, turn it into unfinished
  steps, and report the checklists read; a round reports when its lines, its steps or its
  checklists changed.
- `server/hub.ts`: own the checklist map, merge each report, drop leaving agents, put the map on
  the snapshot and on every activity event.
- `server/board-service.ts`: `clearDone(board)` deletes the board's done tasks in one commit. No
  change to the file's shape, the 200-post cap or the 7-day drop.
- `index.server.ts`: the new RPC's handler, beside the delete handler.
- `client/office-state.ts` and `shared/model.ts`: carry the checklists; give the lobby room its
  to-dos with done ones included. `room.posts` keeps hiding done tasks for every other view
  (the stand-up reads it).
- `client/board-sheet.tsx`: when the room is the lobby, the to-do body instead of the posts body.
  The modal, the agent picker page and the close steps are shared.
- `client/board-text.ts`: ordering and labels for to-dos, the clear question, the checklist lines.
- `client/use-board-actions.ts`: `reopen` and `clearDone`.
- `client/room-board.tsx`: the lobby card's to-do preview.
- `docs/plugins.md`: rewrite the board paragraph for the lobby's to-do list and the agent tasks.

Agent tools do not change.

## Errors

- A failed add, tick, delete or clear shows its server message under its control, as
  `ActionButton` does. Nothing changes on the board until the server's broadcast.
- A timeline read that fails keeps the agent's last checklist, as it keeps the activity line.

## Not built

- A to-do list on any board but the lobby's.
- A switch to hide finished to-dos without deleting them.
- Editing a to-do's text, reordering to-dos, due dates.
- Saving agent checklists across a daemon restart.
- Changing an agent's checklist from the board, or turning a checklist step into a to-do.
- Checklists of agents whose provider keeps none.

## Testing

Follow `docs/testing.md`; run only the touched test files.

- Unit: the newest `todo` item in a tail, unfinished steps, skipped bad items, the cut text, a
  checklist kept after its item left the tail and after the agent stopped, dropped when the agent
  leaves; `clearDone` deleting only the board's done tasks in one save; the lobby room's to-dos
  in the model with done ones, other rooms unchanged; to-do order, labels and the preview.
- Mounted (`client/board-sheet.mounted.test.tsx`): add with Enter and with Add, tick and untick, Clear
  finished with its question, Delete, the Notes section, the agent tasks section and its empty
  line, another room's board still showing posts.
- Live against a dev daemon with fixtures, at 390 px and 1280 px, light and dark: the lobby board
  from the 3D scene, the 2D floor and the structure view; keyboard through the sheet.

## Not verified

- A real agent's checklist: the hard rule of this build is that no agent is created, so the dev
  daemon had none and the board showed "No agent tasks". The groups and their step lines are
  covered by the mounted test, the server's reads by the unit tests.
- A to-do for an agent or claimed by one: with no agent, the picker offered only Nobody. The
  claimed fixture was claimed by "You".
- A note from an agent's `office_post`: the lobby's field adds to-dos only, so the two notes were
  written into `boards.json` before the dev daemon started.
- A pointer click on the 3D whiteboard: the scene's Whiteboard button was pressed from a script.
- The installed app on a phone or a tablet, including Enter keeping the keyboard up on iOS and
  Android. The 390 px checks were the web app in a desktop browser.
