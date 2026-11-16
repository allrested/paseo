# The office's stand-up notes: design

Date: 2026-11-16. Status: designed, not built. Sub-project 3 of
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

| Question      | Decision                                                                                                                                                                                                                                                                                                                |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Who           | One new agent in the workspace of the notes folder, with the host's default provider, titled "Stand-up notes".                                                                                                                                                                                                          |
| Its prompt    | Write today's stand-up note under the stand-up rules of this folder's `CLAUDE.md`, for the date in the owner's time zone. If today's entry exists, bring it up to date in place, keep what is still true, and keep the Contents list right. Edit only this month's file, commit nothing. Then the stand-up report text. |
| The report    | `standupText` of the office's state at that moment. The report code moves from `client/` to `shared/` so the server builds it from the hub's snapshot (`server/hub.ts`).                                                                                                                                                |
| One at a time | While a writer runs, a bell click or the 8:00 run starts nothing. The office remembers the running writer's id in its host storage, so a restart does not start a second.                                                                                                                                               |
| When it ends  | The office records the time the entry was last written and archives the writer. My call, so writers do not fill the office.                                                                                                                                                                                             |
| An error      | A writer that stops on an error is left as it is, not archived, and the card says it stopped with a link to it.                                                                                                                                                                                                         |

### The bell and the Stand-up card

| Question        | Decision                                                                                                                                                 |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The bell        | A click on the bell prop holds the meeting as today and asks the office's server to start the writer. `meet()`, from the card, rings it without writing. |
| The card's line | Under the totals: "Today's entry written at HH:MM", or "Writing today's entry…", or "No entry today yet". With no notes folder, the line is left out.    |
| The 2D office   | No bell; it writes only at 8:00.                                                                                                                         |

### The Stand-up notes card

| Question      | Decision                                                                                                                                                                                                                                                       |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What opens it | A click on the meeting room's screen in 3D. The screen is a plain mesh today; it becomes a click target and a keyboard button, as the team chips are, without changing upstream's drawing of it. The whiteboard keeps opening a room's board, in 3D and in 2D. |
| Other views   | The Stand-up card gets a "Stand-up notes" link under its line, so the 2D office and the list reach the notes too. My call: the 2D whiteboard already opens a room's board.                                                                                     |
| What it shows | This month's file as Markdown with the kit's component, scrolled to the newest entry's header.                                                                                                                                                                 |
| Months        | "Previous month" and "Next month" buttons, each off where no file exists. A month with no file says so.                                                                                                                                                        |
| Read only     | The card never edits. The server reads only files named `daily-standup-YYYYMM.md` directly in the notes folder; any other name is refused.                                                                                                                     |
| After a write | An open card reloads the month when the writer ends.                                                                                                                                                                                                           |
| The 3D screen | Keeps its "Sprint review" picture.                                                                                                                                                                                                                             |

## Errors

- A schedule that fails to save shows in the office's settings under the folder.
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
- How the entry finds the screen's mesh and makes it a click target.
