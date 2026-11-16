# The office after the owner's review: design

Date: 2026-11-16. Status: sub-project 1 is built; the others are not.
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

## Sub-projects

The owner chose the order of the first four. The fifth came later and is last until the owner
places it. Each later one gets its own spec.

| #   | Sub-project            | Points  | What it needs                                                                |
| --- | ---------------------- | ------- | ---------------------------------------------------------------------------- |
| 1   | Small fixes            | 9, 7, 6 | The plugin's client and the scene's entry. This document.                    |
| 2   | A lively floor         | 1, 2    | Upstream's leisure modules, a routine for the rest, and what a deploy is.    |
| 3   | Stand-up notes         | 3, 4    | A daily run on the host, an agent that writes, a reader for the notes.       |
| 4   | The office as one page | 8, 5    | A change to the app: a plugin cannot show a session or another plugin.       |
| 5   | 3D in the Android app  | 10      | A way for the installed app to run the scene, or an app build of the fork's. |

## Sub-project 1

### Decisions

| Question                     | Decision                                                                                                                                                                                                                                                   |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The name                     | "Library" on the strip's entry and as the card's title.                                                                                                                                                                                                    |
| The strip's note             | "N at a skill" while agents are at one, else "Teach a skill".                                                                                                                                                                                              |
| The code's names             | They follow the label, as the glossary asks. No file, export or field keeps "gym" or "train". The request's text and its mark on the board do not change, so requests already posted are still found.                                                      |
| The library in 3D            | Its chip and the bookshelf open the Library card. Upstream's card for the room has the same title and lists what was read since the office opened; it is not shown any more.                                                                               |
| When the library opens it    | Always while the office is live, also without a team: the card then lists the host's skills. The strip's entry keeps its rule and shows only with a team.                                                                                                  |
| The picker's place           | A page of the board's sheet. The form has one row, "Wake an agent with it", with the choice and a chevron; it opens the page.                                                                                                                              |
| Why not the kit's `Combobox` | It draws as a composer control, and its contract is a composer item or a New workspace item.                                                                                                                                                               |
| The page                     | Titled "Wake an agent". A Back button, then "Nobody", then "This room", then "Other rooms". A row has the state's dot, the agent's title, and under it the room and the state in the agent card's words: Idle, Running, Starting, Needs permission, Error. |
| Search                       | A field over the list when the office has more than eight agents. It matches the title and the room's name, without case. Nothing found: "No agent matches."                                                                                               |
| Choosing                     | A press on a row chooses it and returns to the form. Back and Escape return without a change. What was typed in the form is kept.                                                                                                                          |
| A chosen agent that leaves   | The choice is "Nobody" again.                                                                                                                                                                                                                              |
| A close from the page        | A wide sheet is closed by Escape, its close button or a press beside it: from the page these go back to the form. A phone's sheet is already swiped away when it says so, and closes.                                                                      |
| Other chips                  | The kind of post keeps its two chips. The Library and Review cards keep theirs: they list one team's idle agents.                                                                                                                                          |
| The sign's words             | The brand's name. Without a brand, "Paseo".                                                                                                                                                                                                                |
| The sign's mark              | The brand's logo, fitted into the mark's square. Without one, or when it does not load, upstream's building mark.                                                                                                                                          |
| Where the brand comes from   | What the daemon writes into the web page from `PASEO_BRAND_NAME` and `PASEO_BRAND_LOGO` (`window.__PASEO_BRAND__`), read by the plugin's web module with the app's own checks. The desktop app has no brand, so its sign says "Paseo".                     |
| A long name                  | The type shrinks until the name fits the sign's width. At the smallest size it is cut with an ellipsis.                                                                                                                                                    |
| The sign's colours           | Upstream's board and type. The brand's colour is not used: the page does not carry it.                                                                                                                                                                     |
| Upstream's files             | None is changed. The entry redraws the texture of `PRO_FX.logoM` after the floor is built, so the plaque changes with the sign, and sets `PLACES.library.open` as it sets the whiteboard's.                                                                |

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

### Testing

Unit: the picker's order, groups, second line and search; the choice falling back when its agent
leaves; `readBrand` against the shapes the daemon writes and against bad ones; `worldBrand`; the
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

Nothing was seen in the app itself. The live check of the whole app was not done. The workspace
scripts (`daemon`, `app`) could not be started: the daemon on port 6767 has no workspace for this
checkout, and registering one would change that daemon's state.

The scene's own script was looked at alone instead. It was bundled with the options the app uses
(IIFE, es2020, minified), served as a static page from the build container, and opened in Paseo's
browser at 1280 x 800. The resize call timed out; `innerWidth` and `innerHeight` then read
1280 x 800. The canvas was 640 x 400 drawn into 1280 x 800. Software WebGL is what this
deployment's browser is known to do; this run did not measure it.

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
- Escape on the host's sheet.
- The board's sheet at 390 px: width, rows of at least 44 px, the typed text kept after Back.
- A real graphics card: the test browser draws with software.
- The picker's page with real agents: its rows with 3, 9 and 30 agents are a mounted test.
- The installed app on a phone.
