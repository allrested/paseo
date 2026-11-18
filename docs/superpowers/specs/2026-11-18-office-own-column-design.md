# The office's own column: design

Date: 2026-11-18. Status: designed. It follows
[the office as one page](2026-11-17-office-one-page-design.md),
[Sessions and Activity beside the floor](2026-11-17-office-side-panels-design.md) and
[the team chat](2026-11-17-office-team-chat-design.md), and replaces how the three reach the screen.

## Request

The owner's review of 0.16.1, on the desktop app:

1. The office's settings sit on top of the office's page. On a phone they cover the 3D view. They
   belong on a settings page.
2. "Open session" still opens the session on another page.
3. The sidebar features and the team chat are not there.
4. The office is one page that handles every action: creating an agent, opening a session, showing
   the sessions. The 3D page never has to be closed.

## The owner's answers

| Question                         | Answer                                                                                                                                                                             |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which app                        | The desktop app installed from upstream (getpaseo's build).                                                                                                                        |
| Where the side column comes from | The office draws it itself, so it is there in every app. Its session view is the office's own: read, reply, answer permission prompts, stop. The full pane stays in the workspace. |
| What the column shows at once    | One thing at a time, with tabs: Sessions, Activity, Chat and the open sessions. The column drags wider and collapses.                                                              |
| What "New agent" asks            | A short form: an existing workspace, the provider and model (the last choice pre-filled), the first prompt.                                                                        |
| What stays above the floor       | Nothing. The view switch is a small control in a corner of the floor. The attention strip becomes a tab with a count.                                                              |
| The design as a whole            | Approved as played back.                                                                                                                                                           |

## What was there

- The office's plugin (client and server) is served by the host's daemon, so every app runs the
  fork's office. The app around it is whichever build the owner opens.
- Sub-project 4 put the side area in the app: `navigation.showBeside`
  (`packages/app/src/plugins/beside/`). Upstream's app has no such call. There,
  `openSessionWith` (`plugins/office/client/beside.ts`) falls back to `navigation.openAgent`, which
  leaves the office, and `PanelButtons` (`client/office-surface.tsx`) draws nothing, so Sessions,
  Activity and Chat cannot be opened. That is points 2 and 3.
- Sessions, Activity and Chat are three screens of the office (`index.client.tsx`,
  `client/sessions-panel.tsx`, `activity-panel.tsx`, `chat-panel.tsx`), each its own React tree
  with its own subscription to the office's state.
- The header (`client/office-surface.tsx`, `styles.header`) holds `HostSwitches` (Wake agents,
  Agent tools, Notes folder, Time zone, and the lines for a failed switch, an unsaved view and a
  notes schedule error), the `ViewSwitch`, the panel buttons and the `AttentionStrip`. That is
  point 1.
- A plugin adds a settings screen with `client.addSettingsScreen` (`packages/plugin/src/client/contracts.ts`);
  upstream has the call, and five built-ins use it. The office does not.
- The client SDK a plugin gets from `usePaseo()` is the app's copy. Upstream's has
  `agents.create`, `agents.ref(id).send`, `respondToPermission`, the timeline (`refetch`,
  subscribe), `workspaces.list` and `providers.snapshot`. It has no `cancel()`: the fork added it
  for the office (`client/use-agent-actions.ts`), so Stop does nothing in upstream's app.
- The office's client calls its server through `useRpc` and `server.handle`
  (`index.server.ts`), and the server holds a Paseo client of the fork's.
- The agent card (`client/agent-card.tsx`) and the permission actions
  (`client/permission-actions.tsx`) already send a line, answer a prompt and stop a turn.

## Approaches

| Approach                                        | Trade-off                                                                                                                                        | Chosen |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| The office draws its own column                 | The same in every app. The session view is the office's own and has no attachments, slash commands or drafts.                                    | Yes    |
| Publish the fork's desktop app                  | The app's real agent pane beside the floor. Unsigned installers, no update from upstream, and the office still leaves the page in any other app. | No     |
| Use the daemon's web UI in a browser            | No work: it has the side area today. A browser tab, not the desktop app.                                                                         | No     |
| Own column, and the app's side area where it is | The full pane in the fork's builds. Two behaviours to build, test and explain.                                                                   | No     |

## Design

### The page

- **Wide.** The floor on the left and one column on the right, inside `OfficeSurface`. A drag
  handle between them changes the column's width, within a least and a most that keep the floor
  usable. A button collapses the column to a rail of the tabs' icons; a press on an icon opens it
  again on that tab. Width and collapsed are device settings (`officeDeviceSettings`).
- **Compact.** The floor fills the surface. A bottom bar of the tabs' icons opens the column as a
  sheet over the floor, drawn by the office (not the app's sheet host). The sheet closes with its
  own button, a press on the floor above it, and Escape.
- **Above the floor.** Nothing. The `ViewSwitch` moves into a corner of the floor, over every view.
  The scene's problem line (`SceneProblem`) stays over the floor, since it is about the floor.
- The office as a workspace panel (`addWorkspacePanel`) gets the same layout; a narrow panel is
  compact.

### The column's tabs

| Tab             | What it shows                                                                                                       | Badge             |
| --------------- | ------------------------------------------------------------------------------------------------------------------- | ----------------- |
| Attention       | The cards the strip showed (agents waiting on the owner, incidents, host, janitor, stand-up, reviews, QA, library). | The cards' count. |
| Sessions        | `SessionsPanel`'s list, filter and search, and the New agent button.                                                | None.             |
| Activity        | `ActivityPanel`.                                                                                                    | None.             |
| Chat            | `ChatPanel`.                                                                                                        | Unread, as today. |
| One per session | A session view. Closable. Named after the agent.                                                                    | Its status dot.   |

- The four fixed tabs are always there. Session tabs follow them, in the order they were opened.
  Opening a session that has a tab selects that tab.
- Open session tabs and the selected tab are kept while the surface is mounted, not across a
  reload.
- The three panels become components of the column and share the surface's one subscription. Their
  three screens (`SESSIONS_SCREEN`, `ACTIVITY_SCREEN`, `CHAT_SCREEN`) are removed, with
  `PanelButtons` and `office-link.ts`'s screen ids.

### A session tab

- **Header.** The agent's name, workspace and status; "Open in workspace"
  (`navigation.openAgent`, the one action that leaves the office); Close.
- **Conversation.** The agent's timeline, read with `agents.ref(id).timeline` and followed live.
  The owner's messages and the agent's replies as text. A tool call is one line (its name and a
  short summary), not expanded. Reasoning is not shown. The view loads the latest page and loads
  earlier pages when scrolled to the top.
- **Actions.** A text box and Send (`send`). Allow and Deny on each pending permission
  (`permission-actions.tsx`). Stop while a turn runs.
- **Not included.** Attachments, images, slash commands, drafts kept across reloads, changing the
  model or the mode, sub-agent tracks, file links that open panes.
- **Where it opens from.** A row of Sessions and of Activity, a card of Attention, the agent card's
  "Open session", "Answer in the session" in the List view, and walk-in's E on a person. All call
  one `openSession(agentId)` of the surface.
- `openSessionWith` no longer calls `showBeside` or `openAgent`.

### New agent

- A button at the top of Sessions opens the form in the tab's place, with Back.
- **Workspace.** The host's workspaces from `workspaces.list`, grouped by project, with a search.
  Required.
- **Agent.** Provider, then model, from `providers.snapshot`: only providers that are available.
  The last choice made in the office is pre-filled (a device setting); with none, the first
  available provider and its default model.
- **Prompt.** Required.
- Create calls `agents.create` with the workspace's folder, the provider and model, and the
  prompt. On success the form closes and the new agent's session tab opens. On failure the error
  shows in the form, and what was typed stays.
- A new project folder, a new worktree, attachments and modes stay in the app's own screen.

### Settings

- `client.addSettingsScreen({ id: "office", title: "Office", ... })`, where the other built-ins'
  screens are.
- It holds what `HostSwitches` holds: Wake agents, Agent tools, Notes folder, Time zone. It adds
  the default view (3D, 2D, List), which the corner control also changes.
- A failed switch and a refused save show on this screen, beside the setting they belong to, as
  they happen. An unsaved view shows by whichever view switch was pressed.
- A schedule that cannot follow the settings (the stand-up notes' or the incidents check's) lasts,
  so it also adds a Settings card to Attention. A plugin cannot open a screen of the app's
  Settings (`navigation` has no such call), so the card opens a card of the office that says what
  failed and names Settings > Office.
- `HostSwitches` leaves the header; its rows move to the settings screen's component.

### Working in every app

- The column, the tabs, the session view and the form use only calls upstream's app has.
- Stop goes through the office's server: a new RPC that cancels the agent's turn with the
  server's Paseo client. `use-agent-actions.ts`'s `cancel` calls it in place of the SDK's
  `cancel()`.
- The office no longer calls `showBeside` for a session or for its own panels. The wall screen
  keeps `resourcesOpener`: Resources beside the floor where the app has a side area, the Host card
  where it has none.
- The app's side area (`packages/app/src/plugins/beside/`) is left as it is. Other plugins may use
  it.

### Errors

- A session whose timeline cannot be read shows the error in its tab with Retry; the tab stays.
- Send, Allow, Deny and Stop that fail show a line under the box, and the text is kept.
- An agent that is archived or removed while its tab is open: the tab says so and offers Close.
- With the host disconnected the column shows what it has and marks it stale, as the floor does.

## Pieces

Each is usable on its own and gets its own plan.

| Piece | What                                                                     | Depends on |
| ----- | ------------------------------------------------------------------------ | ---------- |
| 1     | The settings screen, the bare floor, the corner view control.            | None.      |
| 2     | The column with Attention, Sessions, Activity and Chat; the phone sheet. | 1.         |
| 3     | Session tabs, and Stop through the server.                               | 2.         |
| 4     | New agent.                                                               | 3.         |

Between pieces 1 and 3, in upstream's app, "Open session" still leaves for the workspace.

## Checks

- Component tests in the style of the office's mounted tests: the column's tabs and badges, the
  collapsed rail, the compact sheet, a session's conversation and actions, the form's validation
  and failure, the settings screen's rows and problems.
- A server test for the stop RPC.
- A look in a browser at 1280 and 390 px, light and dark, with a navigation that has no
  `showBeside`, which is what upstream's app gives the office.
- Not checkable here: upstream's desktop app itself. The owner confirms there after the host runs
  the new build.
