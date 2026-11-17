# The office after the owner's review: design

Date: 2026-11-16. Status: sub-projects 1, 2 and 3 are built (3: [its design](2026-11-16-office-standup-notes-design.md)); sub-project 4 is built ([its design](2026-11-17-office-one-page-design.md)); sub-project 6 is built ([its design](2026-11-16-office-small-fixes-again-design.md)); sub-project 7 is split into five pieces, of which 1 to 3 are designed ([the list](2026-11-17-office-list-mode-design.md), [the camera toolbar](2026-11-17-office-camera-toolbar-design.md), [Sessions and Activity](2026-11-17-office-side-panels-design.md)), 2 (the camera toolbar) is built, and 4 (walk in) and 5 (team chat) are not designed; sub-project 8 is built ([its design](2026-11-17-office-incidents-design.md)); the others are not.
It follows [the office as my-office's 3D floor](2026-11-16-office-my-office-port-design.md), whose
nine sub-projects are built.

## Request

The owner used the 3D office and asked for nine changes:

1. An idle agent sleeps at its desk. It should use the lounge: pool, a nap on the sofa, the games
   TV, foosball, the karaoke box, feeding the fish, the arcade machine, a cup in the dining room,
   the restroom.
2. A deploy launches the rocket.
3. The stand-up runs every day at 8:00 and writes the day's entry in the stand-up notes in the
   docs folder, in the style of the entries already there. The bell does the same on demand. An
   entry already written for the day is brought up to date.
4. The board in the meeting room opens the stand-up notes.
5. The server room's wall screen opens the Resources screen's readings.
6. The sign over the lobby's lift shows the brand from the environment.
7. "Wake an agent with it" on a board is hard to use with more than four agents.
8. "Open session" shows the session beside the office, as my-office's drawer does, so a day's
   work stays on the office's page.
9. There is no gym room, and there is a library: the Gym button is named Library.

While the spec was written the owner added a tenth:

10. The 3D office works on Android too.

After using the office again the owner added:

11. A sub-agent is named after its parent with a number (Mjd-1, Mjd-2), not its task, so the 3D
    office looks tidy.
12. The strip of cards over the office looks cut off at its edge.
13. Upstream's camera toolbar is missing: Overview, Desks, Meeting room, Servers, zoom,
    fullscreen, photo, and Walk in.
14. The glide after a drag with the mouse is jerky; upstream's is smooth.
15. Upstream's Sessions and Activity panels beside the 3D floor are missing.
16. Upstream's list mode is better: filter tabs, a search, and rows with context, time and cost.
17. A new Jira bug or Sentry issue sets off upstream's incident alarm. The office checks Jira and
    Sentry itself every few minutes.
18. Upstream's team chat is missing.

## What the code does today

| Point | Today                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1     | A turn that ends is 9 s of coffee, then the desk, asleep, until work, lunch, the 15:00 coffee, a meeting or the night. Upstream's pool, games, karaoke and foosball are in `DENY` of `import-upstream.mjs` and have empty stand-ins. The fish, the arcade and the coffee machine only answer a click. The restroom is a 40% roll on the way to the desk, at most every 15 minutes each; a meeting sends everyone back at once. |
| 2     | A push and a deploy launch it. A deploy is a shell command the host recognises (`server/activity.ts`, `DEPLOY`). One made by an MCP tool, or by a pipeline after a merge, is not seen.                                                                                                                                                                                                                                         |
| 3     | The stand-up is a report derived when its card is shown. Nothing is stored or scheduled. The bell rings in the scene and tells Paseo nothing. A plugin's server can run a timer, start and prompt agents and read files; the SDK has no schedules, and no Paseo API before the first handler or hook runs.                                                                                                                     |
| 4     | The meeting room's screen is a fixed "Sprint review" picture and not a prop. The whiteboard that opens a board is on the dev floor.                                                                                                                                                                                                                                                                                            |
| 5     | The chip, the racks, the wall screen and the server boxes all call `onMachine()`, which opens the Host card. Resources is the `resource-manager` plugin; a plugin's client calls only its own plugin's RPCs.                                                                                                                                                                                                                   |
| 6     | "My Office" with upstream's mark, drawn in `world/pro/floor.js`. The reception's plaque shares the material (`PRO_FX.logoM`).                                                                                                                                                                                                                                                                                                  |
| 7     | One row of chips that scrolls sideways with no scrollbar: "Nobody", the room's agents, then every other agent.                                                                                                                                                                                                                                                                                                                 |
| 8     | `navigation.openAgent` leaves the office for the agent's workspace. The kit has no component for an agent's conversation, and the app's needs the workspace pane's context.                                                                                                                                                                                                                                                    |
| 9     | The gym was put in the library by design: the scene has no gym, and a skill is opened at the library.                                                                                                                                                                                                                                                                                                                          |
| 10    | Only a browser with WebGL2 is offered the 3D floor. Chrome on Android is one, not tried on a phone; the installed app shows the 2D office. The installed app is upstream's store build. Its one frame for plugins (`DocumentFrame`) loads local files with scripts off. The pictures the host drew for phones were of the first robot scene and are gone; the host's Chromium draws the floor at about 1.5 frames a second.    |
| 11    | A sub-agent shows its own title, which is its task (`client/model.ts` `agentTitle`). Every agent carries `parentAgentId`.                                                                                                                                                                                                                                                                                                      |
| 12    | The strip is a horizontal `ScrollView` with no scrollbar and no fade (`client/attention-strip.tsx`), so the last card looks cut.                                                                                                                                                                                                                                                                                               |
| 13    | `ui/camera-bar.js` and `interact/first-person.js` are stand-ins: one fitted view, no toolbar, no walking in.                                                                                                                                                                                                                                                                                                                   |
| 14    | The loop is upstream's. It draws 8 frames a second when its document has no focus (`core/loop.js` `frameGap`), and the office's frame hands focus back to the app, so the glide after a drag runs at 8 frames a second.                                                                                                                                                                                                        |
| 15    | Upstream's panels (`ui/activity.js`, `ui/session-drawer.js`) are not taken; they read upstream's own server.                                                                                                                                                                                                                                                                                                                   |
| 16    | The List view is Paseo's own (`client/structure-view.tsx`), with no filter, search, context, time or cost.                                                                                                                                                                                                                                                                                                                     |
| 17    | Upstream's alarm (`life/incidents.js`) is a stand-in. Upstream fires it on three failures in five minutes. The office calls no tracker. The host has a Jira token in its env; the Sentry token the MCP server reads is not set on this host.                                                                                                                                                                                   |
| 18    | Upstream's team chat (`ui/group-chat.js`, `ui/group-chat-view.js`) is not taken. The office has a board per room and the lobby's board.                                                                                                                                                                                                                                                                                        |

## Sub-projects

The owner chose the order of the first four. The fifth came later, and the sixth to eighth after
another look at the office; their order is the owner's to place. Each later one gets its own spec.

| #   | Sub-project            | Points         | What it needs                                                                |
| --- | ---------------------- | -------------- | ---------------------------------------------------------------------------- |
| 1   | Small fixes            | 9, 7, 6        | The plugin's client and the scene's entry. This document.                    |
| 2   | A lively floor         | 1, 2           | Upstream's leisure modules, a routine for the rest, and what a deploy is.    |
| 3   | Stand-up notes         | 3, 4           | A daily run on the host, an agent that writes, a reader for the notes.       |
| 4   | The office as one page | 8, 5           | A change to the app: a plugin cannot show a session or another plugin.       |
| 5   | 3D in the Android app  | 10             | A way for the installed app to run the scene, or an app build of the fork's. |
| 6   | Small fixes, again     | 11, 12, 14     | The plugin's client and the scene's entry.                                   |
| 7   | Upstream's controls    | 13, 15, 16, 18 | Upstream's toolbar and walk-in, and panels fed by Paseo's data.              |
| 8   | Incidents              | 17             | A reader of Jira and Sentry on the host, and upstream's alarm.               |

## Sub-project 1

### Decisions

| Question                     | Decision                                                                                                                                                                                                                                                                                       |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The name                     | "Library" on the strip's entry and as the card's title.                                                                                                                                                                                                                                        |
| The strip's note             | "N at a skill" while agents are at one, else "Teach a skill".                                                                                                                                                                                                                                  |
| The code's names             | They follow the label, as the glossary asks. No file, export or field keeps "gym" or "train". The request's text and its mark on the board do not change, so requests already posted are still found.                                                                                          |
| The library in 3D            | Its chip and the bookshelf open the Library card. Upstream's card for the room has the same title and lists what was read since the office opened; it is not shown any more.                                                                                                                   |
| When the library opens it    | Always while the office is live, also without a team: the card then lists the host's skills. The strip's entry keeps its rule and shows only with a team.                                                                                                                                      |
| The picker's place           | A page of the board's sheet. The form has one row, "Wake an agent with it", with the choice and a chevron; it opens the page.                                                                                                                                                                  |
| Why not the kit's `Combobox` | It draws as a composer control, and its contract is a composer item or a New workspace item.                                                                                                                                                                                                   |
| The page                     | Titled "Wake an agent". A Back button, then "Nobody", then "This room", then "Other rooms". A row has the state's dot, the agent's title, and under it the room and the state in the agent card's words: Idle, Running, Starting, Needs permission, Error.                                     |
| Search                       | A field over the list when the office has more than eight agents. It matches the title and the room's name, without case. Nothing found: "No agent matches."                                                                                                                                   |
| Choosing                     | A press on a row chooses it and returns to the form. Back and Escape return without a change. What was typed in the form is kept.                                                                                                                                                              |
| A chosen agent that leaves   | The choice is "Nobody" again.                                                                                                                                                                                                                                                                  |
| A close from the page        | Only the web's wide dialog stays open when it says it is closed (Escape, its close button, a press beside it): from the page that goes back to the form. A phone's sheet is swiped away and a tablet's is dismissed by Android's Back before they say so: from the page that closes the sheet. |
| Other chips                  | The kind of post keeps its two chips. The Library and Review cards keep theirs: they list one team's idle agents.                                                                                                                                                                              |
| The sign's words             | The brand's name. Without a brand, "Paseo".                                                                                                                                                                                                                                                    |
| The sign's mark              | The brand's logo, fitted into the mark's square. Without one, or when it does not load, upstream's building mark.                                                                                                                                                                              |
| Where the brand comes from   | What the daemon writes into the web page from `PASEO_BRAND_NAME` and `PASEO_BRAND_LOGO` (`window.__PASEO_BRAND__`), read by the plugin's web module with the app's own checks. The desktop app has no brand, so its sign says "Paseo".                                                         |
| A long name                  | The type shrinks until the name fits the sign's width. At the smallest size it is cut with an ellipsis.                                                                                                                                                                                        |
| The sign's colours           | Upstream's board and type. The brand's colour is not used: the page does not carry it.                                                                                                                                                                                                         |
| Upstream's files             | None is changed. The entry redraws the texture of `PRO_FX.logoM` after the floor is built, so the plaque changes with the sign, and sets `PLACES.library.open` as it sets the whiteboard's.                                                                                                    |

### Components

- `client/library-card.tsx`, `client/library-text.ts`, `client/use-library.ts` and their tests:
  the gym's files, renamed with what they export. `client/office-surface.tsx` uses them and
  passes `onOpenLibrary` to the 3D view. The comments that name the gym in `index.server.ts`,
  `shared/contracts.ts` and `client/pixel/actors.ts` say library. `docs/plugins.md` describes the
  Library entry.
- `client/agent-picker-text.ts`: pure. The rows in their order and groups, a row's second line,
  the search.
- `client/agent-picker.tsx`: the page. `client/board-sheet.tsx` holds which page shows, sets the
  sheet's title, and decides what a close does.
- `client/brand.ts`: `parseBrand()`, pure. `client/web-env.web.ts`: `readBrand()`, which reads
  the page. `client/world/adapter.ts`: `worldBrand()`, the name's default.
- `client/world/world-api.ts`: `brand?: { name, logoUrl }` and `onLibrary?()` in the start
  options. Both are optional, so the contract's version stays.
- The scene: `paseo-host.js` has `library`. `paseo-sign.js`, a new file of Paseo's, draws the
  sign on a 2D context and fits the name. `paseo-entry.js` puts that picture on the sign's
  material and sets the library's opening. `import-upstream.mjs` lists the new file as Paseo's.
- `docs/docker.md`: the brand's table says what the name and the logo change in the office.

### Errors

- A logo that does not load leaves the building mark. Nothing is reported.
- A brand the page does not have, or one that fails the checks, is no brand.
- A post that fails keeps the form, its text and the chosen agent, as today.

### Not built

- The small poster by the stairs keeps "My Office" under its slogan: its texture is local to an
  upstream file.
- The cozy floor has no lobby and no sign. The office runs the company floor.
- A brand on the desktop app and the phone: the app has none there.
- A tap on the library in the 2D office. The strip's entry is the way in.
- A way back to the form on a phone or a tablet: there a close from the page closes the sheet, and
  what was typed goes with it, as with any close of the sheet.

### Testing

Unit: the picker's order, groups, second line and search; the choice falling back when its agent
leaves; `parseBrand` against the shapes the daemon writes and against bad ones; `worldBrand`; the
strip's note; the renamed text module's cases, unchanged.

Build: `server/world-script.test.ts` bundles the entry.

Browser, with software WebGL: the frame against the bundled scene, started with a brand and with
none; the library's chip by pointer and by keyboard calls `onLibrary`.

Live, with fixtures in front of a dev daemon and no agent created: the Library entry and card;
the library's chip and the bookshelf in 3D; the board's sheet with 3, 9 and 30 agents at 390 px
and 1280 px, light and dark, by pointer and by keyboard, with wakes off; a post that names the
chosen agent as it leaves the page; the sign with a name, with a name and a logo, with a long
name, and with no brand.

### Not verified

The app itself was not run. The workspace scripts (`daemon`, `app`) could not be started: the
daemon on port 6767 has no workspace for this checkout, and registering one would change that
daemon's state.

The scene's own script was looked at alone instead. It was bundled with the options the app uses
(IIFE, es2020, minified), served as a static page from the build container, and opened in Paseo's
browser at 1280 x 800. The resize call timed out; `innerWidth` and `innerHeight` then read
1280 x 800. The canvas was 640 x 400 drawn into 1280 x 800. Whether the browser drew with
software WebGL or a graphics card was not measured, so the scene was not seen on a known graphics
card.

No page error came up: the page's own `error` listener was empty on every page, and no `problem`
call was made. The browser's log was read only for the last page, and its console was empty.

What the scene alone showed:

- With a name, the sign's picture reads "Flavours Kitchen" in light type on the dark board after
  the small building, nothing cut.
- With a name and a logo, the logo stands where the building was, a round mark, not stretched.
  A logo whose SVG has a `viewBox` and no `width` or `height` came out the same.
- A logo that does not load (a 404) leaves the building mark.
- A long name (38 characters) is cut with an ellipsis ("Flavours Kitchen Engineerin...") inside
  the board.
- With no `brand` passed, the picture says "My Office", the scene's own default.
- With `onLibrary`, a pointer click on the library's chip called it once, and `#plc` was hidden
  after that click. Tab to the chip and Enter called it a second time; `#plc` was not read after
  Enter. The chip is a `button` with a 2 px focus ring. The bookshelf prop, activated with
  `activateProp`, called it a third time, and `#plc` was hidden.
- With no `onLibrary`, a pointer click on the chip opened upstream's card, titled "Library".

What did not come out as the check was written:

- The chip is drawn at opacity 0 with pointer events off until its place is hovered or it has
  keyboard focus. Both chip clicks (with and without `onLibrary`) were real pointer clicks on a
  chip put in its hover state (the class `zone--hot`) so that the browser tool could find it. A
  first Shift+Tab did not move focus; Tab from the meeting room's chip reached the library's.
- The shelf was activated by calling `activateProp`, not by a pointer click on the shelf.
- From the opening camera the sign over the lift is not readable in a screenshot of the floor.
  Its text was seen only in the picture the scene draws for it, shown on its own.
- The long name was 38 characters, not 40.

The board's sheet was then looked at alone, the same way. A static page bundled the plugin's
real `BoardSheet`, `AgentPicker` and `useOfficeStyles` with esbuild, `react-native` aliased to
`react-native-web`, over rooms from `buildOfficeModel` with made-up agents (3, 9 and 30: idle,
running, starting, needing permission, stopped on an error; in two workspaces and the lobby). The
host's kit was a stand-in: the sheet a plain card with a title bar and a close button,
`Modal.Content` a react-native-web `ScrollView`, the chevron a text glyph. The colours were the
app's light and dark plugin themes. The page was served from the build container and opened in
Paseo's browser at 1280 x 800 and 390 x 844. It shows the plugin's own components and styles in a
real browser. It does not show the host's sheet, Escape on it, the strip, or the office around
it. The browser's console had only React's DevTools notice.

What the static page showed:

- 1280 px, light, 3 agents: the form's row has its label, "Nobody" and the chevron. On the page
  every title starts at x = 430, "Nobody" too; a build of the code before this fix put "Nobody"
  at 422. Rows are 64 px tall on the pointer layout. The chosen row has a 1 px outline in the
  muted foreground on the second surface.
- By keyboard: Tab reached the form's row, drawn with the browser's focus ring. Enter opened the
  page with focus on the chosen row. The arrow keys did not move between rows; Tab did. Space
  chose a row, and focus was back on the form's row. Enter on a row, Enter on Back, and the
  stand-in's close button each returned focus to the form's row too.
- 9 agents: the search field had focus. "landing" kept the agents whose title or room has it; a
  word that matches nothing showed "No agent matches."
- 30 agents: the page scrolled inside the card (661 px shown of 2319). Nothing was wider than the
  card or the window.
- Dark, 9 agents: titles 16.6:1 against the card and second lines 7.0:1. On the chosen row, the
  title 13.9:1 and the second line 5.8:1 against its fill; its outline 5.8:1 against the fill and
  7.0:1 against the card.
- 390 px, compact and touch layout, 9 agents: the form's row and every row of the page fit the
  width (17 to 358 px of 390), nothing scrolls sideways, and rows are 64 px tall. A long title
  ends in an ellipsis. The text typed in the form was there after Back.

Not seen, in the app:

- The Library sheet opening from the chip and from the shelf, its title "Library", and "On this
  host" in it. Only the call to `onLibrary` was seen.
- The app's sign with no brand set: it is expected to say "Paseo" with the building mark. The
  "My Office" above is the scene's default, not the app's.
- A banner (or none) for a logo that does not load. Only the scene page was seen, and it
  reported no error.
- The sign and the plaque as they sit in the scene, with a brand.
- The strip with no Library entry, and no entry named Gym.
- The whiteboard's "Lobby board" sheet, the "Wake an agent with it" row, the "Wake an agent" page,
  and Escape going back and then closing, including that the sheet stays open without a flicker on
  the wide layout.
- The host's sheet around the board's, and Escape on it: the static page's sheet was a stand-in.
- The picker by keyboard in the app.
- Light and dark in the app: the static page used the app's colours, not the app.
- The logo at the daemon's real address (`/_brand/logo?v=…`) drawn inside the app's frame.
- A tablet: the rule that a close from the page closes a tablet's sheet was read in the host's
  code (`adaptive-modal-sheet.tsx`, `isolated-bottom-sheet-modal/visibility-tracker.ts`), not run
  on a device.
- The installed app on a phone.
- Real agents: the picker's rows were made up, in a mounted test and in the static page.
