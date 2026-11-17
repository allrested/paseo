# The office as one page: design

Date: 2026-11-17. Status: designed, not built. Sub-project 4 of
[the office after the owner's review](2026-11-16-office-owner-review-design.md), which has the
request, what the code did before, and the list of sub-projects.

## Request

Points 8 and 5 of the owner's review:

8. "Open session" shows the session beside the office, as my-office's drawer does, so a day's
   work stays on the office's page.
9. The server room's wall screen opens the Resources screen's readings.

Point 15 (upstream's Sessions and Activity panels beside the 3D floor) belongs to sub-project 7.
It is out of scope here, and nothing here may block it.

## The owner's answers

| Question                   | Answer                                                                                                                                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What the session allows    | The full session: read, reply, answer permission prompts and stop the agent, as in its workspace. The app hosts its real agent pane beside the office with the agent's workspace context.                                       |
| Wide layouts               | A panel on the right of the floor with a drag handle. One thing at a time. A header with the agent and its workspace, "Open in workspace" and Close. A general side area of the office. Links inside it leave to the workspace. |
| Phones                     | A sheet over the office, like the app's compact sheets for files and subagents.                                                                                                                                                 |
| Where Resources shows      | In the office's side area, panel or sheet, replacing what is shown, with "Open Resources" and Close in its header.                                                                                                              |
| Which props open Resources | Only the wall screen. Without the resource-manager plugin it keeps opening the Host card. Resources opens on its first tab.                                                                                                     |
| How it is built            | The app owns the side area. One optional navigation call shows an agent's session or a plugin's screen beside the plugin's screen.                                                                                              |
| The design as a whole      | Approved as played back, with the calls marked below.                                                                                                                                                                           |

## What was there

- The office is two contributions with one component, `OfficeSurface`: a screen on its own route
  with no workspace (`packages/app/src/plugins/surface-screen.tsx`), and a workspace panel
  (`packages/app/src/plugins/workspace-panels/panel.tsx`). Both pass the navigation of
  `usePluginHostNavigation` (`packages/app/src/plugins/host-navigation-model.ts`): `openAgent`,
  `openWorkspace`, and `openBrowser` on Electron.
- `navigation.openAgent` calls `navigateToAgent`, which leaves the office for the agent's
  workspace. The office calls it from the agent card's "Open session", the permission actions'
  "Answer in the session", and the structure view's rows (`client/office-surface.tsx`
  `openSession`).
- The agent pane (`packages/app/src/panels/agent-panel.tsx`) reads its server, workspace, tab and
  target from `usePaneContext()`, and its composer, drafts and attachments are keyed by them. The
  workspace pane builds that context (`screens/workspace/workspace-pane-content.tsx`). The compact
  sheets build it again in the app's overlay host for a sheet's tab, through `SheetPaneHost` and
  `useSheetPaneBridge` (`screens/workspace/sheet-pane/host.tsx`), so a pane can run outside the
  workspace's split. [explorer-sidebar.md](../../explorer-sidebar.md#sheets) has the sheet contract.
- The office's agents live in many workspaces, so no single workspace's split can hold them.
- My-office's drawer is not in the tree. `vendor/my-office/src/office/ui/session-drawer.js` is
  Paseo's stand-in: it marks the person and moves the camera, and Paseo shows its agent card.
- Resources is the `resource-manager` plugin's screen `resources`. `ResourcesScreen` uses only
  `theme` and `host` from its props and fetches its readings with its own plugin's RPCs. The office's
  client can neither open another plugin's screen nor call its RPCs.
- In the scene, the server room's place lists the props `racks` and `tv`; `tv` is the wall
  screen. The chip, both props and the dev box all call `openMac()`, which calls `host.machine`,
  the office's `onMachine()`, which opens the Host card (`paseo-entry.js`, `interact/props.js`,
  `interact/place-chips.js`, `ui/mac-drawer.js`).

## Approaches

| Approach                                            | Trade-off                                                                                                                                                                                                         | Chosen |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| The app owns a side area, one navigation call       | The app draws the area and builds the pane's context; the plugin only asks. The office cannot lay out the area's contents itself.                                                                                 | Yes    |
| The SDK gives plugins session and screen components | Full layout control for the office. The app's contexts (composer editing, file links, the sheet stack) would cross into a plugin's tree, and one plugin would render another's screen. Wider SDK surface to keep. | No     |
| The workspace's split panes                         | The office screen has no workspace, and its agents are in many workspaces.                                                                                                                                        | No     |

## Decisions

### The navigation call

| Question     | Decision                                                                                                                                                                                                                                       |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The call     | `navigation.showBeside?(target)`, optional like `openBrowser`. A target is `{ kind: "agent", agentId, serverId? }` or `{ kind: "screen", pluginId, screenId, params?, serverId? }`. My call on the names.                                      |
| Its answer   | `true` when the app shows the target, `false` when it cannot (the agent is unknown, the plugin is not installed on that host, or it has no such screen). It does not throw for those.                                                          |
| Who gets it  | Plugin screens and plugin workspace panels, through `PluginSurfaceProps["navigation"]`. Settings screens, popovers and sidebar items do not.                                                                                                   |
| Old apps     | The field is absent. The office keeps `openAgent` and the Host card. Plugin client code checks the field once; there is no protocol change, since this is client-side in one app bundle.                                                       |
| Another host | `serverId` defaults to the surface's host, the `host.id` the surface was given. A target on another connected host is shown when that host has the agent or the plugin. The office passes no `serverId`, so Resources shows the office's host. |
| Docs         | `docs/plugins.md` and `public-docs/plugins/reference.md` describe the call where the other navigation fields are.                                                                                                                              |

### The side area

| Question        | Decision                                                                                                                                                                                                          |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who draws it    | The app, around a plugin screen and around a plugin workspace panel. A surface that never calls `showBeside` looks as today.                                                                                      |
| Wide layouts    | A panel on the right of the plugin's content with a drag handle between them. The plugin's content keeps the rest of the width and stays live.                                                                    |
| Its width       | Starts at the Explorer's default width; dragging is kept in memory for the rest of the app's run. It does not read or write the panel store's `explorerWidth`. My call: not persisted, as the sheet stack is not. |
| Compact layouts | A sheet over the plugin's content, an `IsolatedBottomSheetModal` on the app-wide stack, with `SheetPane`'s header. Drag down, Close, the backdrop and Android Back close it, as the compact sheets do.            |
| One at a time   | A new call replaces what is shown. The same target again keeps it and does not remount it.                                                                                                                        |
| Closing         | Close in its header. Leaving the plugin's screen or panel closes it. It is not restored on the next visit.                                                                                                        |
| The header      | The target's icon and title, a second line, the leading action, and Close. On compact layouts the header drags the sheet, as `SheetDragArea` does.                                                                |
| Point 15        | The area holds an agent or a plugin screen. A later sub-project can add a kind for the plugin's own contributions (Sessions, Activity) without changing the call's shape.                                         |

### The session in the area

| Question         | Decision                                                                                                                                                                                                                                                                                                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What runs        | The app's agent pane, with a pane context the area builds for the agent's own server and workspace and a tab id of the area's own. Reading, replying, permission prompts and stopping work as in the workspace.                                                                                                                     |
| The header       | The agent's title; under it the workspace's name. "Open in workspace" calls today's `navigateToAgent` and closes the area.                                                                                                                                                                                                          |
| Links            | Opening a file, a diff or another tab from inside the pane (`openTab`, `openFileInWorkspace`, `openPreferredTarget`) goes to the agent's workspace with that target, which leaves the office. `openTargetToSide` is left out, as the field is optional and the pane already handles its absence. `closeCurrentTab` closes the area. |
| Its draft        | The composer's draft is keyed by server and agent (`buildDraftStoreKey`), not by tab, so what is typed in the area is what the workspace's tab shows, and the reverse. The area's tab id only has to differ from any workspace tab's id.                                                                                            |
| The agent leaves | An archived agent shows the pane's archived state. An agent that is gone from the host, or whose workspace is gone, closes the area. My call: there is no workspace to send "Open in workspace" to.                                                                                                                                 |
| Focus            | The area is a focused pane while it has the keyboard; the plugin's content is not a pane and the app's pane shortcuts do not reach it.                                                                                                                                                                                              |

### Resources in the area

| Question   | Decision                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What runs  | The named plugin's screen component, inside that plugin's own `PluginInstallationProvider` and `SurfaceErrorBoundary`, with its theme, host, layout and params. The plugin's RPCs are its own. |
| Its layout | `compact: true` in the panel and the sheet. My call: the area is narrow.                                                                                                                       |
| The header | The screen's title and the plugin's sidebar icon. The leading action is "Open {title}", which opens the screen on its route and closes the area.                                               |
| Its tab    | Resources opens on its Instance tab, its own default.                                                                                                                                          |

### The office

| Question             | Decision                                                                                                                                                                                                                                                            |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| "Open session"       | The agent card, "Answer in the session" and the structure view's rows call `showBeside({ kind: "agent", agentId })`. When it is absent or answers `false`, they call `openAgent` as today.                                                                          |
| The agent card       | It stays open beside the session on wide layouts. My call: it is the office's own sheet and the user closes it.                                                                                                                                                     |
| The wall screen      | The `tv` prop calls a new `onResources()` start option. The office passes it when `showBeside` exists, and it calls `showBeside({ kind: "screen", pluginId: "resource-manager", screenId: "resources" })`. On `false` it opens the Host card.                       |
| The rest of the room | The racks, the server room's chip and the dev box keep calling `onMachine()`.                                                                                                                                                                                       |
| The scene            | `world-api.ts` gains `onResources?()`, optional, so the contract's version stays. `paseo-host.js` gains `resources`; `paseo-entry.js` replaces the `tv` prop's `act` after the props are built, as it sets the library's opening. Upstream's files are not changed. |
| The 2D office        | It has no wall screen; Resources is not reached from it.                                                                                                                                                                                                            |

## Errors

- A plugin screen that throws in the area shows the error boundary's message in the area. The
  office keeps running.
- An agent whose pane cannot load shows the pane's own load error in the area.
- `showBeside` answering `false` is not reported; the office falls back as above.

## Not built

- Files, diffs and terminals opened inside the office.
- More than one thing in the area at once.
- The area remembered across visits.
- Other plugins' screens wired into the office.
- Upstream's Sessions and Activity panels (sub-project 7).

## Left to the builder

- Where the area lives in the app: one component that wraps both the plugin screen and the plugin
  panel, and the store that holds its target and width.
- How the area's pane context shares code with `SheetPaneHost` and `WorkspacePaneContent`, and
  which bridges (`useSheetPaneBridge`'s) the area needs on each layout.
- The drag handle: the app's existing side-pane resize, if one fits.
- The tab id the area gives its pane, distinct from workspace tab ids.

## Testing

Unit: the navigation model's `showBeside` answers for a known agent, an unknown agent, a missing
plugin and a missing screen; the office's fallbacks when `showBeside` is absent or `false`; the
area's store (replace, same target, close on leave).

Mounted: the area around a plugin screen with an agent target and with a screen target, wide and
compact; Close; "Open in workspace" and "Open Resources" closing the area and navigating.

Browser, with software WebGL: the `tv` prop calls `onResources`, and the racks still call
`onMachine`.

Live, against a dev daemon: "Open session" from the card and from "Answer in the session" on the
office screen and on the office panel, at 1280 px and 390 px; a reply and a permission answer from
the area; the wall screen opening Resources, and the Host card with the plugin disabled.
