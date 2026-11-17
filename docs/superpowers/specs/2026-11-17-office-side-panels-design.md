# Sessions and Activity beside the office's floor: design

Date: 2026-11-17. Status: built, with one known defect. Piece 3 of sub-project 7 ("Upstream's
controls") of [the office after the owner's review](2026-11-16-office-owner-review-design.md). The
owner's answers on how sub-project 7 splits are in
[piece 1's design](2026-11-17-office-list-mode-design.md#the-owners-answers). It builds on
[the office as one page](2026-11-17-office-one-page-design.md) (sub-project 4), whose side area
shows it.

## Request

Point 15 of the owner's review:

15. Upstream's Sessions and Activity panels beside the 3D floor are missing.

## What was there

- Upstream's Sessions rail (`src/components/office/SessionRail.tsx`, filled by
  `src/office/ui/activity.js`) is a left column: the counts of working, waiting and resting
  sessions as three toggles that filter, a search, and one row per session (its dot, name,
  project, what it is doing). A press opens the session's drawer.
- Upstream's Activity panel (`ActivityPanel.tsx`, the same module) is a right column: today's
  numbers, a Live tag, All and Needs-you tabs with the count of alerts, five kind chips (Commands,
  Edits, Reads, Web, Agents), and the feed. The feed groups a session's events within four minutes
  into one card (its dot, name, "working" while live, the time, up to four lines, "+N more");
  alerts stand alone. A press opens the session. Upstream's events come from its own server.
- Neither is taken: `ui/activity.js` in the vendored scene is a stand-in that keeps only the rings
  and name tags.
- Sub-project 4 is built and on `main`. It gives plugin screens and panels
  `navigation.showBeside(target)`, with a target of `{ kind: "agent" }` or
  `{ kind: "screen", pluginId, screenId, params? }`. The area holds one thing; a new call replaces
  it; its header has the screen's title, "Open {title}" and Close. A screen shown in the area gets
  a navigation without `showBeside` (`screen-beside.mounted.test.tsx`).
- The office's state (`office.state`) carries every agent's status and permissions, and for each
  running agent its "doing now" line and its step (`doing`: a kind of `ActivityKind` and a key
  that changes with each tool call). The host reads steps every 5 s while an office surface is
  open. Nothing keeps a history of steps or of status changes.
- The scene already says "since the office opened" for its counts (`i18n/index.js` `OURS`).

## Approaches

| Approach                                            | Trade-off                                                                                                                                                                      | Chosen |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Two office screens shown in the side area           | No change to the app: sub-project 4's screen kind shows them. One thing at a time, so opening a session from a panel replaces it. The panel and the floor are two React trees. | Yes    |
| Two columns the office draws inside its own surface | Both panels and a session at once, one tree. The office lays out three columns beside the floor, and narrow screens need their own answer.                                     | No     |
| A new side-area kind for a plugin's contributions   | What sub-project 4 left room for. An app change for what the screen kind already does.                                                                                         | No     |

The feed's events:

| Approach                                      | Trade-off                                                                                              | Chosen |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| Derived on the client from the office's state | No server change, no overlap with the branches that edit the hub. Lost when the office closes.         | Yes    |
| A ring of events kept by the server's hub     | Survives leaving the office. Edits `hub.ts`, which the lobby to-do and incidents branches both change. | No     |

My call on both. The steps are only read while an office is open, so a server ring would hold the
same events.

## Decisions

### How they open

| Question            | Decision                                                                                                                                                                                                       |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The screens         | The office adds two screens: `office-sessions` titled "Sessions" and `office-activity` titled "Activity". No sidebar item or Command Center item names them.                                                   |
| The buttons         | Two icon buttons in the office's header, after the view switch: Sessions (`Users`) and Activity (`Activity`). Each calls `showBeside({ kind: "screen", pluginId: "office", screenId })`. My call on the icons. |
| Which views         | Shown on all three views (3D, 2D, List). My call: the panels read the office's state, not the scene.                                                                                                           |
| Without a side area | The buttons are hidden when `navigation.showBeside` is absent, as on an app without sub-project 4.                                                                                                             |
| Pressed             | No pressed state. The area's header says what is shown. My call: the office cannot read what the area holds.                                                                                                   |
| The header's action | The area's own "Open Sessions" / "Open Activity" opens the screen on its route, full width. That works: the screens need no floor.                                                                             |

### The panels and the floor

| Question                | Decision                                                                                                                                                                                                                                                                                              |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One channel             | `client/office-link.ts`, a module-level store: the mounted office surface registers `select(agentId)` and `openSession(agentId)`; the panels call them. The plugin's client modules are one bundle, so both trees share it.                                                                           |
| A row press             | Selects the agent in the office: its agent card opens and, in 3D, the camera flies to it, as a press on a List row does today.                                                                                                                                                                        |
| "Open session" on a row | Calls the surface's `openSession`, which shows the session in the side area and so replaces the panel. My call: one thing at a time, as sub-project 4 decided.                                                                                                                                        |
| Who registers           | A surface registers its link as it mounts, and a header button press registers its own surface's link again before calling `showBeside`. With two offices mounted (a retained deck or panel), the one that opened the panel is the one beside it, since the area closes when its surface leaves view. |
| No surface beside it    | On the screen's own route, whose navigation has `showBeside` (a screen in the area gets none): a row press and "Open session" call `navigation.openAgent`, which opens the agent's workspace, also when the office is still mounted under the route.                                                  |
| The state               | Each panel reads the office's state with the hook the surface uses (`use-office.ts`). A second subscription is one more stream while a panel shows. My call.                                                                                                                                          |

### Sessions

| Question   | Decision                                                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The top    | The tabs and the search of piece 1 (`client/list-text.ts`: All, Needs you, Working, Resting with counts; "Search agents"). One list, not rooms.                                                                            |
| A row      | The dot, the title, the room's name under it, and the "doing now" line for a running agent, else the state's word. Needs you first, then Working, then Resting; newest change first within each. My call: upstream's rail. |
| Sub-agents | Indented under their parent, as the List view, also when the parent sits in another room.                                                                                                                                  |
| Empty      | "Loading..." before the first state arrives; then "No agents yet." with no agents; "No agent matches." with a filter.                                                                                                      |

### Activity

| Question            | Decision                                                                                                                                                                                                                                                                                                                                                    |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Its events          | Derived by `client/activity-feed.ts` from each new office state: a new step key (the step's kind: read, edit, command, test, deploy…), started working, finished (running to idle), needs permission, stopped on an error, a sub-agent started. Words in `client/activity-feed-text.ts`.                                                                    |
| What it keeps       | The newest 300 events in a module-level store, from when the office's state first loaded in this app run. Cleared on a reload of the app. Not saved.                                                                                                                                                                                                        |
| Who keeps it        | The derivation runs in the surface's `use-office` and in the panels' own, into one store, deduplicated by agent and key. A status line (started, finished, error) of one agent within 2 s of the same one is the same event, since the two subscriptions stamp it a few milliseconds apart. So the feed fills while either the office or the panel is open. |
| The top             | A "Live" tag while the office's stream runs. All and Needs you tabs, Needs you with its count. Five kind chips as upstream: Commands, Edits, Reads, Web, Agents; any number on, none means all.                                                                                                                                                             |
| Grouping            | Upstream's: consecutive events of one agent within four minutes share a card (dot, title, "Working" while it runs, the time of its newest event (its top line), up to four lines, "+N more"). Needs permission and stopped on an error stand alone.                                                                                                         |
| A card's press      | Selects the agent, as a Sessions row. An alert card has "Open session".                                                                                                                                                                                                                                                                                     |
| Empty               | "Nothing yet since the office opened." with no events; "No activity matches." when the tab and the chips hide every card.                                                                                                                                                                                                                                   |
| Today's numbers     | Not shown. My call: upstream's are the day's, and the feed starts when the office opened.                                                                                                                                                                                                                                                                   |
| What it never says  | A file's name, a command or a prompt: the office receives none (`shared/names.ts`).                                                                                                                                                                                                                                                                         |
| A permission's line | "Needs permission: " and the title for a `tool` or `mode` permission, whose title is a short name. A `question` says "Has a question", a `plan` "Has a plan to review", and `other` "Needs permission": a question's title is the question itself (Claude's AskUserQuestion), model prose, and the feed never shows a prompt.                               |

### Layouts

| Question | Decision                                                                                                            |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| Wide     | The side area's panel, at its width. The panels are drawn for `layout.compact: true`, which the area always passes. |
| Phones   | The side area's sheet.                                                                                              |
| Theme    | The plugin's theme and the office's styles (`client/styles.ts`), light and dark.                                    |

## Components

- `index.client.tsx`: the two screens.
- `client/office-link.ts`: the channel. `client/office-surface.tsx` registers in it and draws the
  two header buttons.
- `client/activity-feed.ts`, `client/activity-feed-text.ts` and their tests: pure derivation,
  grouping, filters, words. `client/use-office.ts` feeds the store.
- `client/sessions-panel.tsx`, `client/activity-panel.tsx`: the screens.
- `client/styles.ts`: their styles.
- `docs/plugins.md`: the office's two panels in a sentence.

## Dependencies

- The side area (sub-project 4's `showBeside`) is on `main`, and this branch was built from it.
- Piece 1's `client/list-text.ts` was merged in from `main` before the Sessions panel was built; its
  tabs and search are that module's.

## Errors

- A panel whose state cannot load shows the office's own load message.
- A panel that throws is held by the area's error boundary; the office keeps running.

## Not built

- Upstream's timeline, "Wrapped", today's numbers, image thumbnails in the feed.
- A feed kept across app runs or on the host.
- Both panels at once, or a panel beside a session.
- The panels on an app without the side area.

## Testing

Unit: the feed's events from pairs of states (new step, each status change, a sub-agent's start),
deduplication across two derivations, the 300 cap, grouping within four minutes and alerts alone,
the tabs and chips; the channel with and without a surface.

Mounted: both panels with fixtures; a row press calls `select`; "Open session" calls
`openSession`; with no surface, `openAgent`.

Live, against a dev daemon with fixtures: the header buttons on the office screen and the office
panel at 1280 px and 390 px, light and dark; the panel replaced by a session; the buttons hidden
without the side area.

## Left to the builder

- Whether the screen shown in the area and the surface share the client module's state in the
  app. They do: the plugin's client is one bundle, evaluated once per installation, and in the
  look a row press in the area opened the agent's card on the floor beside it, on the office
  screen and on the office panel, and on each of the three views. No app-side broadcast was needed.

## Known defects

- **At 390 px, a header button pressed right after the area's sheet closes does nothing.** Pressed
  1.5 s after Close it did nothing three times out of three; a second press opened the sheet, and a
  press 5 s after Close opened it on both tries. The browser tab throttled timers to about 1 s, so
  the window is likely shorter in a foreground tab. The race is in the side area's sheet
  (sub-project 4); the office's press only calls `showBeside`.

## Not verified

The look ran on 2026-11-17 in the Paseo browser (Chromium) against a dev daemon of this branch on
its own port, with a copy of the host's agents and no agent prompted, and Expo web, at 1280 and
390 px, light and dark. Presses were DOM events sent from the page, not a mouse. Seen: both header
buttons on the office screen and the office panel; both panels beside the floor at 1280 px and as
the area's sheet at 390 px; a Sessions row press opening the agent's card on the floor in List, 2D
and 3D, including after switching views with the panel open; "Open Sessions" and "Open Activity"
opening their routes; and on a cold-loaded Sessions route a row press opening the agent's
workspace. Not seen, or seen only in part:

- The feed with events. Every agent was resting, so Activity showed the Live tag and "Nothing yet
  since the office opened." throughout. A card, its press, grouping, the chips and Needs you were
  not seen. `activity-panel.mounted.test.tsx` covers cards, the press, the filters and Live;
  `activity-feed.test.ts` covers the events, the 2 s merge, the cap and grouping.
- "Open session" replacing the panel. Only an alert card has it, and no agent was made to raise
  one. `activity-panel.mounted.test.tsx` covers it calling the surface's `openSession`.
- Working and Needs you rows, and the doing-now line. `sessions-panel.mounted.test.tsx` and
  `sessions-text.test.ts` cover them. Sub-agents were seen indented under their parent.
- The camera flying to the agent in 3D. The card opened; the camera's move was not judged.
- "Loading...": the first state arrived before the page was read. `sessions-panel.mounted.test.tsx`
  covers it.
- The buttons without a side area. `office-surface-panels.mounted.test.tsx` covers it.
- The office screen at 1280 px in dark and the office panel at 390 px in dark.
- Native layouts and Android Back.
- A row press that opened no card. Once at 390 px, after a reload to switch the theme, Sessions
  row presses opened no card, and presses on the 2D floor showed none either, until the next
  reload. It was tried three more times after that, one press while the sheet still rose, and the
  card opened each time, so it was not reproduced. No test covers it.
