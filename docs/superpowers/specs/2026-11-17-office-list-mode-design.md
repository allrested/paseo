# The office's List view, as upstream's list mode: design

Date: 2026-11-17. Status: designed, not built. Piece 1 of sub-project 7 ("Upstream's controls") of
[the office after the owner's review](2026-11-16-office-owner-review-design.md), which has the
request, what the code did before, and the list of sub-projects. The other pieces designed with it:
[the camera toolbar](2026-11-17-office-camera-toolbar-design.md) (piece 2) and
[Sessions and Activity beside the floor](2026-11-17-office-side-panels-design.md) (piece 3).

## Request

Point 16 of the owner's review:

16. Upstream's list mode is better: filter tabs, a search, and rows with context, time and cost.

## The owner's answers

| Question                 | Answer                                                                                                                                                  |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How sub-project 7 splits | Five pieces, in this order: the list (16), the toolbar without walk-in (13), Sessions and Activity in the side area (15), walk in (13), team chat (18). |
| What is designed now     | Pieces 1, 2 and 3, as three specs and three plans, built in parallel today by three builders. Pieces 4 and 5 come after.                                |
| Routine choices          | Made by the designer and marked "My call" below. The owner is asked only what changes scope or cannot be settled from the code.                         |
| File overlap             | Kept small between the three pieces; each plan names the files another piece or branch also edits.                                                      |

## What was there

- The List view is Paseo's own (`plugins/office/client/structure-view.tsx`): one card per room
  (title, project), the room's agents as rows, and the room's board preview (`RoomBoard`) under
  them. A row has the state's dot, the title, the state's word unless idle, `provider · model`, the
  "doing now" line for a running agent, and the agent's permission actions. A press selects the
  agent and opens its card; "Open session" opens the session.
- Upstream's list mode (`src/office/ui/lite.js` at the vendored commit) groups every session by
  state (needs you, working, resting) with tabs All, Needs you, Working, Resting and their counts,
  a search over the title, folder, branch and last prompt that matches every word without case or
  accents, and per row: the dot, the title, a second line (project, branch), what it is doing now,
  its checklist (`2/5`), a context bar with its percent (warning from 60%, danger from 85%), its
  time (the task's clock while working, "5m ago" while resting) and its cost (`$1.24`). "/"
  focuses the search; Escape clears it.
- The office already has, per agent: the context (`OfficeAgent.context`, from the daemon's
  `lastUsage`), `idleSince` for an idle agent, and the room's workspace with its project and
  branch (`OfficeRoom.workspace`). `client/context-text.ts` has `contextPercent` and
  `contextTone` (nearly full at 85).
- The daemon's agent payload carries `lastUsage.totalCostUsd` (Claude reports the SDK result's
  `total_cost_usd`; OpenCode, Pi and OMP report theirs; the rest none) and `lastUserMessageAt`.
  The office's directory reads neither (`server/directory.ts` `DirectoryAgentInput`).
- The agents' checklists are kept on the server by the lobby to-do branch
  (`feat/office-lobby-todo`), not merged.

## Approaches

| Approach                                      | Trade-off                                                                                                                                | Chosen |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| Tabs and search over the room cards           | Keeps the rooms and their boards, which the List view is the only list of. Upstream's look is in the rows and the bar, not the grouping. | Yes    |
| Upstream's grouping by state, rooms as a line | Closest to upstream. The room boards lose their place in the List view; the room becomes text on each row.                               | No     |
| A fourth view beside List                     | Both kept. One more segment in the view switch for two lists of the same agents.                                                         | No     |

My call: the first. The owner can flip it to the second in review; the row and the bar are the
same in both.

## Decisions

### The bar

| Question        | Decision                                                                                                                                                                                                |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where           | Over the room cards, inside the List view's scroll, so it scrolls away with them. My call: the office's header is already full.                                                                         |
| The tabs        | All, Needs you, Working, Resting, each with its count. One is chosen; All at first.                                                                                                                     |
| Which tab       | Needs you: a permission is pending or the agent stopped on an error (`attentionReason`). Working: running or starting, and an idle parent still waiting on its sub-agents. Resting: idle, no attention. |
| The search      | A field after the tabs, placeholder "Search agents". Every word typed must match the title, the task, the room's name, the project, the branch or `provider · model`; case and accents are ignored.     |
| What filters    | A room shows only its matching agents. A room with none is left out while a tab other than All or a search is on. A sub-agent shows when it matches, under its parent when the parent shows too.        |
| Nothing found   | "No agent matches." in place of the cards. With no agents at all the view is as today.                                                                                                                  |
| Keys            | "/" focuses the search when focus is not in a field, on web. Escape in the field clears it. My call: upstream's keys.                                                                                   |
| Kept            | The tab and the search last while the surface is mounted, not across visits. My call: as the picker's search.                                                                                           |
| Compact layouts | The tabs on one row that scrolls sideways, the search on the row under it, full width.                                                                                                                  |

### The row

| Question              | Decision                                                                                                                                                                      |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What it keeps         | Everything it has today: dot, title, state word, `provider · model`, the "doing now" line, the permission actions, press to select, "Open session".                           |
| Second line           | `provider · model`, then the branch when the room has one. My call: the room's name is the card's title, so it is not repeated.                                               |
| What it gains         | On the right, in this order: the context, the time, the cost. Each is left out when it has nothing.                                                                           |
| Context               | A short bar and its percent (`contextPercent`). The bar's tone is upstream's: muted below 60%, warning from 60%, danger from 85% (`NEARLY_FULL`).                             |
| Time while working    | The clock of the current turn since the agent's last prompt (`promptedAt`): `m:ss` under an hour, `h:mm:ss` after. Updated every second while the view shows a working agent. |
| Time while resting    | Since `idleSince`: "now", "5m ago", "2h ago", "3d ago". Updated every minute.                                                                                                 |
| Time otherwise        | Left out for an agent that needs you, is starting, or has stopped on an error.                                                                                                |
| Cost                  | `$0.42`, two decimals, from `costUsd`, when it is above zero. The provider's own figure, shown as it reports it.                                                              |
| Compact layouts       | The context, time and cost on their own line under the second line, left-aligned.                                                                                             |
| Accessibility         | The row's label adds them: "Ali: Running, context 62%, 4:12, $0.42".                                                                                                          |
| The checklist (`2/5`) | Not in this piece. The checklists come with the lobby to-do branch; a later change can add the count once it is merged. My call: keeps this piece free of that branch.        |

### The data

| Question        | Decision                                                                                                                                                                                                   |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New fields      | `OfficeAgent` gains `costUsd?: number` (from `lastUsage.totalCostUsd`, finite and not negative) and `promptedAt?: string` (from `lastUserMessageAt`, for a running or starting agent only). Both optional. |
| Where they come | `server/directory.ts` reads them in `projectAgent`; `DirectoryAgentInput` gains `lastUsage.totalCostUsd` and `lastUserMessageAt`.                                                                          |
| Old clients     | The fields are optional and the snapshot's schema is the plugin's own; an older office client ignores them.                                                                                                |
| Pure text       | `client/list-text.ts`: the tab of an agent, the counts, the search match, the time's text, the cost's text, the context's tone, the row's label. No React.                                                 |

## Components

- `shared/contracts.ts`: the two optional fields on `OfficeAgentSchema`.
- `server/directory.ts`: reads them.
- `client/list-text.ts` and `client/list-text.test.ts`: new, pure.
- `client/structure-view.tsx`: the bar, the filtering, the row's new parts, the clock.
- `client/styles.ts`: the bar's and the row's new styles.
- `docs/plugins.md`: the office's List view in a sentence.

## Errors

- A cost or a time the daemon sends that is not a number or a date leaves that part out.
- No error state is new: the view is as today when the office cannot load.

## Not built

- Upstream's grouping by state, its checklist count, its sub-agent lines (`↳ type · model`), its
  prompt cache words, and its "last reply" line for a resting session.
- Remembering the tab or the search across visits.
- Filters or search in the 2D floor.

## Testing

Unit (`list-text.test.ts`): the tab of every state, including an idle parent waiting on its
sub-agents; the counts; the search with two words, with case and accents, against each field; the
time's text at 0 s, 59 s, 1 h, and for "ago" at each step; the cost at 0, 0.004, 1.5; the
context's tone at 59, 60, 84, 85. `server/directory.test.ts`: the two fields read, and left out
when absent, negative or not finite, and `promptedAt` left out for an idle agent.

Mounted: the List view with fixtures: a tab hides rooms with no match; a search keeps a sub-agent
under its shown parent; "No agent matches."

Live, against a dev daemon with fixtures and no agent created: 1280 px and 390 px, light and dark,
by pointer and by keyboard.

## Not verified

Whether Claude's `total_cost_usd` is the session's total or the last turn's in Paseo's long-lived
sessions was not checked; the row shows what the provider reports. The builder checks it against a
real turn's `lastUsage` and says which in the plan's report.
