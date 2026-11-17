# The office's stand-up notes: design

Date: 2026-11-16. Status: built. Sub-project 3 of
[the office after the owner's review](2026-11-16-office-owner-review-design.md), which has the
request, what the code did before, and the list of sub-projects.

## Request

Points 3 and 4 of the owner's review:

3. The stand-up runs every day at 8:00 and writes the day's entry in the stand-up notes in the
   docs folder, in the style of the entries already there. The bell does the same on demand. An
   entry already written for the day is brought up to date.
4. The board in the meeting room opens the stand-up notes.

## The owner's answers

| Question                       | Answer                                                                                                                                                                                                                  |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the entry is written     | One notes folder for the whole office, chosen in the office's settings (here `/workspace/QFlavours/docs`). One entry a day covers every room, one writer starts in that folder, and nothing runs until a folder is set. |
| How the 8:00 run starts        | Through the daemon's schedules. Plugins get a small way to create, update and remove their own schedules. The office keeps one daily schedule at 8:00 in the owner's time zone that starts the writer.                  |
| What the entry is written from | Both: the writer follows the stand-up rules of the folder's `CLAUDE.md` (commits, branches, memory), and the office gives it the stand-up report as text, the same text "Copy as text" produces.                        |
| What writes on demand          | Only a click on the bell in the 3D scene, which also holds the meeting as today. Opening the Stand-up card holds the meeting and writes nothing. The 2D office writes only at 8:00.                                     |
| What the board opens           | A Stand-up notes card: this month's file as Markdown, scrolled to the newest entry, with buttons for the previous and next month. Read only. The 3D screen keeps its picture.                                           |
| The design as a whole          | Approved as played back, with the calls marked below.                                                                                                                                                                   |

## What was there

- The notes are `daily-standup-YYYYMM.md` in `/workspace/QFlavours/docs`, one file per month: a
  title, a blockquote, a Contents list, then entries, each a `---`, a `## DD Month YYYY` header and
  first-person prose ending with blockers and a "Next:" line. The rules are in
  `/workspace/QFlavours/CLAUDE.md` under "Standup Notes"; an agent started in that workspace reads
  them. The past entries fall on Sunday to Thursday only, the KSA work week those rules name.
- The office's stand-up ([its design](2026-11-16-office-standup-design.md)) is a report derived
  from the office's state when the card opens (`client/standup-text.ts`). Nothing is stored and
  nothing writes prose.
- The daemon has schedules (`packages/server/src/server/schedule/`): a cron cadence with a time
  zone, stored and run after a restart, whose target is an existing agent or a new agent with a
  config and a fixed prompt. A plugin cannot reach them.
- The office's own timers (`server/timers.ts`) are unref'd node timers, and the Paseo API reaches
  the office only through a handler, hook or tool call (`server/paseo-holder.ts`). After a daemon
  restart the office cannot start an agent until one of those runs.
- A plugin starts an agent through a workspace handle: `paseo.workspaces` gives the handle, and
  `handle.agents.create(...)` the agent (`packages/client/src/index.ts`).
- The bell is a prop in the 3D scene. `paseo-entry.js` already wraps its action
  (`bell.act = () => ringWithEveryone(ring)`), and `meet()` rings it when the Stand-up card opens.
- The meeting room's screen is a fixed "Sprint review" picture drawn in
  `vendor/my-office/src/office/world/pro/floor.js`, 3D only, and a click on it does nothing. The
  scene's whiteboard and the 2D office's whiteboard each open a room's board
  (`client/world/adapter.ts` `boardRoom`, `client/pixel/pixel-office.tsx`).
- The plugin kit has a Markdown component.

## Approaches

| Approach                                  | Trade-off                                                                                              | Chosen |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------ | ------ |
| The daemon's schedules, opened to plugins | Runs at 8:00 after any restart without the office being opened. Changes the plugin kit and the daemon. | Yes    |
| The office's timer with a catch-up        | Stays in the plugin. After a restart the entry can be written hours late.                              | No     |
| Both                                      | Most work, for a rare missed day.                                                                      | No     |

## Decisions

### Settings

| Question         | Decision                                                                                                                                                                             |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The fields       | Host-wide office settings gain `notesFolder` (an absolute path, empty by default) and `notesTimeZone` (an IANA name, the host's by default). `officeHostSettings` goes to version 2. |
| No folder        | No schedule exists, the bell writes nothing, and the board's card says the notes folder is not set and where to set it.                                                              |
| The days         | 8:00, Sunday to Thursday (cron `0 8 * * 0-4`). My call, from the KSA work week in the rules and the past entries.                                                                    |
| A folder changed | The office updates its schedule. A folder cleared removes it.                                                                                                                        |

### Schedules for plugins

| Question           | Decision                                                                                                                                                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What a plugin gets | Create, update, remove and list its own schedules by a name of its choosing. A plugin sees and changes only its own.                                                                                                                                            |
| The target         | A new target kind, the plugin itself: when the schedule is due, the daemon calls a handler the plugin names and passes the Paseo API as to any handler. My call: a new-agent target's prompt is fixed when it is saved, and the report has to be built at 8:00. |
| Storage            | In the daemon's schedule store, like any schedule, so it survives restarts. A schedule whose plugin is removed or disabled does not run.                                                                                                                        |
| A missed run       | As the daemon's schedules do today for a missed tick. Nothing more.                                                                                                                                                                                             |
| Where it shows     | Plugin schedules are not offered for editing in the app's schedule screens. My call: the plugin owns them through its settings.                                                                                                                                 |

### The writer

| Question      | Decision                                                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Who           | One new agent in the workspace of the notes folder, with the host's default provider, titled "Stand-up notes". It runs in the provider's mode that edits files without asking, Claude's "Accept File Edits"; a provider without one runs in its default mode. The owner's call: nobody watches the 8:00 run to answer an edit. |
| Its prompt    | Write today's stand-up note under the stand-up rules of this folder's `CLAUDE.md`, for the date in the owner's time zone. If today's entry exists, bring it up to date in place, keep what is still true, and keep the Contents list right. Edit only this month's file, commit nothing. Then the stand-up report text.        |
| The report    | `standupText` of the office's state at that moment. The report code moves from `client/` to `shared/` so the server builds it from the hub's snapshot (`server/hub.ts`).                                                                                                                                                       |
| One at a time | While a writer runs, a bell click or the 8:00 run starts nothing. The office remembers the running writer's id in its host storage, so a restart does not start a second.                                                                                                                                                      |
| When it ends  | The office records the time and archives the writer, once the day's `## DD Month YYYY` header is in the month's file after its turn. My call, so writers do not fill the office. A writer that ends without the header is left as on an error, with the reason "it ended without writing today's entry".                       |
| An error      | A writer that stops on an error is left as it is, not archived, and the card says it stopped with a link to it.                                                                                                                                                                                                                |

### The bell and the Stand-up card

| Question        | Decision                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The bell        | A click on the bell prop holds the meeting as today and asks the office's server to start the writer. `meet()`, from the card, rings it without writing. |
| The card's line | Under the totals: "Today's entry written at HH:MM", or "Writing today's entry…", or "No entry today yet". With no notes folder, the line is left out.    |
| The 2D office   | No bell; it writes only at 8:00.                                                                                                                         |

### The Stand-up notes card

| Question      | Decision                                                                                                                                                                                                                                                                  |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What opens it | A "Stand-up notes" label on the meeting room's screen in 3D: a DOM button on the screen's top edge, as the team chips are, so a click and the keyboard reach it and upstream's drawing of the screen stays. The whiteboard keeps opening a room's board, in 3D and in 2D. |
| Other views   | The Stand-up card gets a "Stand-up notes" link under its line, so the 2D office and the list reach the notes too. My call: the 2D whiteboard already opens a room's board.                                                                                                |
| What it shows | This month's file as Markdown with the kit's component, scrolled to the newest entry's header.                                                                                                                                                                            |
| Months        | "Previous month" and "Next month" buttons, each off where no file exists. A month with no file says so.                                                                                                                                                                   |
| Read only     | The card never edits. The server reads only files named `daily-standup-YYYYMM.md` directly in the notes folder; any other name is refused.                                                                                                                                |
| After a write | An open card reloads the month when the writer ends.                                                                                                                                                                                                                      |
| The 3D screen | Keeps its "Sprint review" picture.                                                                                                                                                                                                                                        |

## Errors

- A schedule that fails to save shows in the office's settings, under the Time zone field.
- A writer that cannot start (the folder is gone, no provider) is reported on the Stand-up card's line.
- A notes file that cannot be read shows the error in the card in place of the notes.

## Not built

- Writing from the 2D office or from a card button.
- Text on the 3D screen.
- Editing the notes in the office.
- Schedules for plugins in the app's schedule screens.

## Left to the builder

- The names of the plugin kit's schedule calls and the handler a schedule names.
- How the workspace of the notes folder is found or opened through `paseo.workspaces`.
- How the bell's click reaches the server (an office request, as the board's posts do).
- How the entry makes the screen open the notes: a DOM label anchored on the top edge of the
  screen's mesh (`src/office/paseo-entry.js`), not the mesh as a click target.

## Verified

What the daemon does was seen on a separate dev daemon. The cards and the 3D view were seen earlier
on static pages.

### On a dev daemon

The owner's call: a dev daemon of this checkout on `127.0.0.1:6768`, with its own `PASEO_HOME`
under `/tmp` and the container's `PASEO_*` variables unset. The daemon at 6767 was not touched. The
notes folder was a copy of `/workspace/QFlavours/docs` under `/tmp`, with the workspace's
`CLAUDE.md` copied beside it so the writer had the stand-up rules. Nothing was written to
`/workspace/QFlavours/docs`: its November file's checksum did not change. The only enabled
provider extended Claude with Haiku as its default model. The office was driven through its RPCs
with the CLI's client, as the settings fields and the bell send them, and its state was read from
its `office.state` subscription. On 17 November 2026 at 03:22 in Asia/Riyadh:

- The settings: `notesFolder` set to the copy and `notesTimeZone` to "Asia/Riyadh" were saved and
  read back, and the pushed notes state went from `folderSet` false to true.
- The schedule: one in the daemon's store, `standup-notes`, cron `0 8 * * 0-4` in Asia/Riyadh,
  targeting the office's `standup-notes` handler, next run at 08:00 Riyadh that day. `schedule ls`
  listed nothing, and `schedule ls --json` gave `[]`.
- Two `office.notes.write.request` a second apart: the first answered `started: true`, the second
  `started: false`. One agent, "Stand-up notes", started in the copy's folder on
  `notes-haiku/haiku`, in the mode `acceptEdits`, with no permission asked.
- About a minute later its turn ended. The copy's November file had a `## 17 November 2026` entry
  after 16 November's, in the voice of the others and ending with blockers and a "Next:" line, and
  a Contents line for it. No other file in the copy changed. The office recorded the time and
  archived the writer, and it left the office's agents.
- The Stand-up card's line, worked out by the client's `notesLine` from each notes state the
  subscription pushed: left out with no folder, then "No entry today yet", "Writing today's
  entry…" and "Today's entry written at 03:23". The card itself was not drawn.
- `office.notes.read.request` read November with `previous` 202610, `next` null and "17 November
  2026" as its last header, and October with both neighbours.

### On static pages

Before the dev daemon was allowed, the office was looked at on static pages, in Paseo's browser,
the way sub-project 1 was:

- The page mounted the plugin's real `OfficeSurface` (the header, the strip, the cards, the list
  and the 3D view), bundled with the repo's esbuild, `react-native` aliased to
  `react-native-web`. A stand-in host answered the plugin kit and logged every call: the
  settings, the office's snapshot (four made-up agents in two workspaces and the lobby, with a
  `notes` state chosen per page) and the RPCs.
- The host's sheet was a plain card with the sizes of `AdaptiveModalSheet`: 520 px wide at most,
  85% high for a body that scrolls itself. In the compact layout it was a bottom sheet 92% high, a
  size of the stand-in's own. The host's Markdown was `marked`. With one line of text the notes
  card stayed at the stand-in's 85% height, a size the stand-in copied from the host's code.
- The notes reads were answered with what the real `readMonthNotes` returned for a copy of the
  three notes files under `/tmp`, recorded beforehand: this month in Asia/Riyadh, each month from
  August to December 2026, this month at 08:00 on 1 December, no folder, and a folder that does
  not exist.
- The 3D view ran the scene's entry, bundled with the server's options, in the surface's own
  frame. A probe module beside it put the camera and the props on the frame's window, to find
  where the bell is drawn.
- 1280 x 800 in light and dark, and 390 x 844 in dark (compact), with the app's plugin themes.
  The console had only React's DevTools notice and the stand-in's log.

The settings:

- "Notes folder", hinted "Where the stand-up notes are written. Empty turns them off.", and
  "Time zone", hinted "For the 8:00 run. Empty uses this host's."
- With the daemon's error for a bad zone in the snapshot, "Unable to schedule the stand-up notes:
  Invalid cron time zone: Mars/Base" shows under the Time zone field.
- " Asia/Riyadh " typed in the field, then Enter: one save, the zone trimmed.

The Stand-up card, opened from the strip in the list and in 3D:

- The line under the totals read, by the `notes` state the stand-in gave: "Writing today's
  entry…", "Today's entry written at 08:03" ("00:05" for a write five minutes after midnight), "No
  entry today yet" (none, or the last one yesterday), "The writer stopped: Rate limited", "The
  writer stopped on an error" (not doubled), "The writer stopped: it was closed before it
  finished", "The writer could not start: The notes folder /tmp/t10/gone is not a folder" and "The
  writer could not start: The notes folder must be an absolute path: docs". A write today and a
  stop after it shows the stop.
- A stopped writer has "Open the writer" under the line. It closed the card and asked the app to
  open that agent. The notes card's "Open the writer" does the same.
- With no folder, and with no `notes` in the snapshot, the line is left out and "Stand-up notes"
  stays.
- Opening the card sent no RPC. "Stand-up notes" closed it and opened the notes card, which sent
  one read. Neither sent a write.

The notes card:

- Opened from the screen's label at 1280 px, light: "November 2026", "Previous month" on, "Next
  month" off, the writer's line, and the notes scrolled so the newest entry, "16 November 2026",
  is at the top of the scroll area (scrolled 8814 px, the newest block's offset). Dark at 1280 px
  and the compact layout at 390 px opened the same way; at 390 px nothing was wider than the
  screen.
- "Previous month": October, both buttons on, at "29 October 2026". Again: September, "Previous
  month" off, at "21 September 2026". Each press read its month once.
- A new `writtenAt` pushed while it showed September read September again, and the line took the
  new time. Closed and opened again, it read this month.
- At 08:00 on 1 December: "December 2026", "No notes for December 2026.", "Previous month" on and
  "Next month" off. "Previous month" went to November at its newest entry, where "Next month" is
  off, since December has no file.
- No folder: "Set a notes folder in the office's settings to see the stand-up notes.", with no
  month buttons.
- A folder that does not exist: "Unable to read the stand-up notes: ENOENT: no such file or
  directory, scandir '/tmp/t10/no-such-folder'" in place of the notes, as an alert, with no month
  buttons.

3D, the company floor:

- At the default view (a 1280 x 599 frame), the label at the screen's middle sat under the
  "Meeting room" chip. While the meeting table is pointed at, the chip shows, draws on top and
  covered the label's left 71 of 100 px: a click there lands on the chip, which opens the room's
  place card. The label now stands on the screen's top edge: label 686 to 786 by 118 to 142 px,
  chip 642 to 757 by 150 to 176 px. With the chip showing, every point sampled on the label hit
  the label, and the screen's picture shows under it. At 390 px it clears the chip by 3 px; the
  Director's name tag overlaps its top left corner by 5 px and draws under it.
- A click on the label, and Enter on the focused label, each opened the notes card. On the scene
  alone a click called `onNotes` once, Enter once, and a repeated Enter not again. The label has
  the `button` role and tab index 0.
- A click on the bell sent one `office.notes.write.request` and opened nothing, and the free
  people said "On my way". A second click sent a second request. A click on the meeting table sent
  nothing and opened the room's place card. `meet()` on the scene alone did not call `onBell`.
- The whiteboard opened the "Lobby board" sheet and sent nothing.
- The cozy floor has no label, and neither has the company floor started without `onNotes`.

What did not come out as the check was written:

- The browser tool does not reach into the scene's frame. The label's clicks were a `click()` and
  a keydown sent in the frame; `elementFromPoint` showed the label is what a pointer hits there.
  One Enter was the browser tool's key press on the focused label.
- The bell and the table were clicked with pointer events sent to the canvas. The first made the
  camera controls capture a pointer the browser did not have, which threw: the surface showed
  "Unable to show the 3D view" and "Try 3D again". After "Try 3D again" the canvas's pointer
  capture was stubbed for the sent events. The error comes from a sent event having no pointer
  behind it.
- While the meeting room's place card is open, the card covers the label's right part. People's
  name tags and speech bubbles can sit over the label: their declutter is upstream's, in
  `place-chips.js`.
- The label's clearance from the "Meeting room" chip was measured only at the default view, 1280
  and 390 px wide. Zoomed out or turned, the chip can cover it again.

## Not verified

Tests cover each of these; the dev daemon did not reach them:

- The 8:00 run itself calling the office's handler:
  `packages/server/src/server/schedule/service.test.ts` ("plugin schedules") and
  `packages/server/src/server/plugins/plugin-schedules.e2e.test.ts`. The dev daemon was stopped
  before 08:00.
- The schedule updated when the folder or zone changes, and removed when the folder is cleared:
  `plugins/office/server/notes-schedule.test.ts`, `plugins/office/index.server.test.ts`,
  `plugins/office/shared/settings.test.ts`, `plugins/office/client/host-switches.mounted.test.tsx`.
- A writer that ends without the day's header (left with "it ended without writing today's
  entry"), stops on an error or is closed: `plugins/office/server/notes-writer.test.ts`,
  `plugins/office/server/live-ports.test.ts`, `plugins/office/index.server.test.ts`.
- The daemon serving the scene's script: `plugins/office/server/world-script.test.ts`.
- The app's schedule screens leaving the office's schedule out:
  `packages/server/src/server/session/schedule/schedule-session.test.ts`.
- A restart while a writer runs, and a schedule due while the daemon starts: the restart cases of
  `notes-writer.test.ts`, `packages/server/src/server/plugins/index.posix.test.ts` and
  `plugin-schedules.e2e.test.ts`.

Not seen for other reasons:

- The bell's own click against a daemon: the RPC it sends stood in for it. The static pages showed
  that a click sends one.
- The host's sheet around the cards, Escape on it, and the host's Markdown: the page had
  stand-ins, and no card was drawn against the dev daemon.
- The 2D office, the app around the office, and the Android app.
- An open card reloading when a real writer ends: no card was open on the dev daemon, and the
  reload was seen only from a pushed `writtenAt` on the static pages.
- The daemon's answer to a notes read that fails: the card's raw error text ("ENOENT: no such
  file or directory, scandir ...") came from the stand-in, which passed the reader's error on.

A limit the owner accepted as is:

- An entry counts as written when the day's header is in the month's file after the writer's turn,
  not when the turn changed the file. So on an update run, a bell click after the day's entry
  exists, a writer that writes nothing is still recorded and archived, and an owner's turn on such
  a stopped writer archives it under them. Closing it means comparing with the file as it was when
  the writer started.
