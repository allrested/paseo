# The office's List view, as upstream's list mode: design

Date: 2026-11-17. Status: built. Piece 1 of sub-project 7 ("Upstream's controls") of
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

## Verified

### On a static page

The List view was seen on a static page in Paseo's browser, not on a dev daemon: no dev daemon was
started, and the daemon at 6767 was not touched. The page mounted the plugin's real
`StructureView` and `useOfficeStyles`, bundled with the repo's esbuild, `react-native` aliased to
`react-native-web`, and the kit's `ScrollView`, `TextInput` and `Modal` stood in by React Native's,
as in the mounted tests. The theme was the app's default light and dark colors. The rooms were
made up: the lobby with an agent stopped on an error; `shop-api` on `feat/cart` with a running
agent at 62% and $0.42, its running sub-agent, an idle agent at 90% and $1.24, and an agent asking
a permission; `café-web` on `fix/menü` with an idle Codex agent "Zoë", an idle parent waiting on
two sub-agents, and a starting agent. At 1280 px and 390 px (`compact`), light and dark:

- The tabs read All 8, Needs you 2, Working 4, Resting 2. A click, a tap and Enter on a focused
  tab each chose it, and only that tab's rooms and rows were left. The chosen tab is filled; a
  focused tab has the browser's focus ring.
- The search: "ALI cart" kept Ali and his sub-agent under him. "zoe menu" found Zoë, "CAFÉ hána"
  found Hana, and "ali zoe" left "No agent matches." in place of the cards. At 390 px the field is
  16 px and takes the full width under the tabs.
- Escape in the field cleared it, kept the focus in it, and brought every room back.
- "/" with the focus on a button or a tab moved the focus to the field and typed nothing. "/" in
  the field was typed as text, and "/" in another field on the page stayed in that field.
- The rows: the context bar is muted at 12% and 45%, the warning tone at 62% and the danger tone
  at 90%. A running row's clock went up each second (4:12, 4:15, 4:28). A resting row read
  "5m ago" and "2h ago". The agent stopped on an error and the one asking a permission had no
  time; the starting agent had none either. A cost was left out where none was given. Each row's
  label carried them, for example "Ali: Running, context 62%, 4:19, $0.42".
- At 390 px the context, time and cost sat on their own line under the second line, and the tabs
  sat in a row that scrolls sideways (378 px of tabs in 375 px).
- Tab order: the four tabs, the search, then the rows and the board buttons, in reading order. A
  click on a row and Enter on a focused row both selected the agent.
- Space on a focused tab did nothing: react-native-web presses on Space only for the `button` and
  `menuitem` roles, and the tabs have the `tab` role.
- The idle parent waiting on its sub-agents counts under Working but its row reads as idle,
  "1m ago", as the row's decisions say for an idle agent.

### The cost

Claude's figure is the running total of Paseo's current Claude process for that agent, not the
last turn's cost and not the agent's whole life.

- Paseo keeps one `query()` per agent and sends each prompt into its input stream
  (`packages/server/src/server/agent/providers/claude/agent.ts:3613`, `prompt: input.iterable`).
- `agent.ts:2221` copies the result's `total_cost_usd` into `lastUsage.totalCostUsd` unchanged.
- The SDK (`@anthropic-ai/claude-agent-sdk` 0.3.246, `sdk.d.ts:4652`) says the figure is
  "cumulative across turns in streaming-input sessions — each result carries the running total so
  far", that "resumed sessions start fresh", and that a `/clear` resets it.
- Paseo makes a new query with `resume` when a launch setting changes (`agent.ts:3579-3593`) and
  when the daemon loads the agent again, so the figure starts again from zero there.
- While a turn runs, each streamed request sends a `usage_updated` with only the context
  (`agent.ts:2259`, `agent.ts:5072`), and the agent manager replaces `lastUsage` with it
  (`agent-manager.ts:5435`). A running Claude agent has no cost until its turn ends, when
  `turn_completed` merges the result's usage back (`agent-manager.ts:5590`).

No recorded fixture has a real Claude result: the provider's tests set `total_cost_usd` to 0 or to
made-up values (`agent.error-result.test.ts:168`, `:208`), so the before-and-after reading of a
second turn rests on the SDK's own contract. A real-provider test that sends two prompts into one
query and compares the two results' `total_cost_usd` would settle it from data.

## Not verified

- The List view inside the app: the host's sheet and surface, the office's header and view switch
  around it, and the host's own kit (`ScrollView`, `TextInput`) in place of React Native's.
- What Escape in the field does in the host. On the page, react-native-web's field stops every
  key from bubbling past it, so nothing outside the field saw the Escape in the bubble phase. The
  app's key handling listens in the capture phase on `window`
  (`packages/app/src/keyboard/internal/sources/dom.web.ts:34`), before the field, so whether it
  also acts on that Escape was not seen.
- A dev daemon with the office's fixtures, and the snapshot's `costUsd` and `promptedAt` arriving
  over the wire: the page was given them directly.
- A real Claude agent's cost across two turns, after a resume, or after `/clear`. No agent was
  created or prompted.
- Hover on a tab or a row, which was not looked at.
- Native iOS and Android, and the installed app on a phone or a tablet.
