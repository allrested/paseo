# paseo-office after 0.1.0: the roadmap

Date: 2026-11-19. Status: approved by the owner on 2026-11-19. Repo:
`allrested/paseo-office` (local checkout `/workspace/QFlavours/paseo-office`), released as v0.1.0
and installed on the owner's host.

This is a workspace document, not part of the public repo. Each piece below gets its own
implementation plan when its turn comes, in `docs/superpowers/plans/` of this workspace.

It follows two designs kept in the fork's checkout
(`/workspace/QFlavours/paseo-onepage-docs/docs/superpowers/specs/`):
`2026-11-18-office-own-column-design.md` (whose pieces 3 and 4 are piece 1 here) and
`2026-11-18-paseo-office-design.md` (the move to an installed plugin, done).

## Request

The owner, on 2026-11-19, with 0.1.0 working on desktop and phone: plan every feature that is
left. The 3D floor already runs on the owner's phone (the fork's Android app has a script frame),
so 3D by streaming for the store phone app is dropped from the list.

## The owner's answers

| Question                                  | Answer                                                                                                                                                   |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Weather                                   | A setting, off by default. "From a service" reads an address the user enters: nothing is contacted unless the user chose where. Not fixed to open-meteo. |
| Real brands on the street                 | Generic signs: the street, shops and vehicles, with made-up names in place of the eight real logos.                                                      |
| Data the staff and daily-life scenes need | The scene gets the real data: spending, a repository's age, CI results, release tags, how long an agent has existed.                                     |
| Sound                                     | Off until turned on, with a switch in the settings and a mute button on the floor's toolbar.                                                             |
| Floor plans                               | my-office's three plans are on the list: the company floor, the cozy room, headquarters.                                                                 |
| Languages                                 | my-office's Vietnamese and Thai, and Indonesian, which my-office does not have.                                                                          |
| The roadmap as a whole                    | Approved as played back.                                                                                                                                 |

## What binds every piece

- What my-office's author asked: the MIT licence and copyright notice kept (the vendored files,
  `LICENSE`, the banner of the built scene); the README links to
  https://github.com/khanh020905/my-office; a community port, "based on my-office", not an official
  version; issues to our repo. His files are taken unchanged wherever they can be; a change by
  hand starts with `// PASEO:` and is listed in `vendor/SOURCES.md`.
- The repo is public: nothing private in files, fixtures or commit messages; no real brand's logo,
  name or tune.
- The scene never receives a file name, a command or a prompt. From piece 5 it does receive the
  data named in the owner's answer above, and only that. The README's "What it reads and where it
  sends it" is rewritten in the release that first passes such data.
- The scene itself makes no network call. The one outside call, the weather service of the user's
  choosing, is made by the plugin's server on the host.
- App-side code (`client/`, `shared/`) uses nothing a phone's JavaScript engine lacks
  (`client/engine-compat.test.ts`). Every piece is looked at on a phone before it is released: the
  one bug of 0.1.0 showed only there.
- The plugin runs on stock Paseo 0.16: only calls upstream's SDK has, anything else asked for and
  hidden when absent.
- Each piece is its own release: built on a branch, reviewed, checked on a throwaway stock daemon,
  pushed, CI green, `paseo plugin update office --ref <commit>` on the owner's host, looked at by
  the owner on desktop and phone, then tagged.

## What a survey of my-office found

Read on 2026-11-19 from my-office at `b6822887` (v0.6.0), which is still upstream's head. The
full survey was a working file; its findings that shape the design:

- **Sounds.** One file (`audio/sfx.js`, 75 lines). All 29 sounds are synthesised in code; there
  are no audio files. 68 calls in modules the port already has are silent today. Karaoke, two
  street scenes and the clip music make audio contexts of their own. Web Audio's autoplay rule in
  an iframe and a WebView is unverified. One tune imitates a real brand's and a test already keeps
  it out of the bundle.
- **Staff and daily life.** 21 files, about 5,000 lines, plus three helpers. 13 work on the office
  floor alone; six need the street (`outings`, `comtrua`, `guard`, `nhau`, `photobooth`, `pickle`).
  41 calls go to the chat stand-in. Two same-origin calls to my-office's own server
  (`/api/claude-version`, `/api/tenure`) need a host answer or a stand-in. The content is
  Vietnam-centred (a lobby shrine, a fire drill, payday, public holidays).
- **Outside.** 40 files, about 10,000 lines. A car model pack (420 KB, CC0), eight brand logos
  (88 KB), optional fonts (332 KB). It roughly doubles the bundle, which a test caps at 1.2 MB
  today. A live weather call to open-meteo. Two files read `process.env`, which a test forbids in
  the bundle. Street life follows the clock, while the port's night follows the app's theme.
  Upstream's own comment puts its 3D world near 1 GB of memory in a browser.
- **Floor plans.** `pro` (the company floor, the port's only plan), `cozy` (one open room: its
  code is in the port, nothing offers it), `hq` (the company floor plus a wing of department
  rooms: the port switches it off, and `world/pro/wing.js` is a stand-in).
- **Camera extras.** Ten files, about 1,400 lines: the automatic camera, photo mode's day and
  night, tips, clip recording (`MediaRecorder`, canvas capture, a download: desktop only).
- **Not to take.** Lite mode, replay and the demo need my-office's own server logs, and lite mode
  and replay show text the scene must never be given.
- **Languages.** Vietnamese and Thai, about 3,200 lines each. The lookup is 74 lines. The scene
  is not told a language today. The port's 41 own strings are English only.
- **No new three.js add-on** is needed by any of it.
- **The import tool** takes a file once its path leaves `DENY` and its stand-in is deleted; it
  does not handle CSS, assets, `process.env` or the page's markup, and `paseo-entry.js` calls a
  few setups by hand, which must not then run twice.

## The pieces

| #   | Piece                         | What the owner gets                                                                                                                               | Depends on |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 1   | Session tabs and New agent    | A session opens as a tab of the office's column in every app, with reply, permission answers and Stop; an agent is started from the Sessions tab. | None       |
| 2   | Sounds                        | my-office's sounds, off by default.                                                                                                               | None       |
| 3   | Floor plans, part 1           | A setting: Company floor or Cozy room.                                                                                                            | None       |
| 4   | Camera extras                 | The automatic camera, photo mode's day and night, tips, clip recording on desktop.                                                                | 2          |
| 5   | Staff and daily life, indoors | The 13 scenes that happen on the office floor, fed with the real data.                                                                            | 2          |
| 6   | Headquarters                  | The third floor plan, with its wing of department rooms.                                                                                          | 3, 5       |
| 7   | Seasons, rain and weather     | By the calendar, by hand, or from a service of the user's choosing.                                                                               | 2          |
| 8   | The street                    | The walkable street with generic signs and vehicles, and the six scenes that happen there. A setting, since it is large.                          | 5, 7       |
| 9   | Languages                     | Vietnamese, Thai and Indonesian for the scene's text, following the app's language.                                                               | 5, 8       |

### 1. Session tabs and New agent

As designed and approved in `2026-11-18-office-own-column-design.md`, sections "A session tab",
"New agent", "Working in every app" and "Errors", built in `paseo-office`:

- A session opens as a closable tab after the column's four fixed tabs, from a Sessions row, an
  Activity card, an Attention card, the agent card's "Open session", the List's "Answer in the
  session" and walk-in's E on a person. The header has the agent's name, workspace and status,
  "Open in workspace" and Close.
- The conversation is the agent's timeline, followed live: the owner's messages and the agent's
  replies as text, a tool call as one line. Reply, Allow and Deny on a pending permission, Stop
  while a turn runs where the host can stop one.
- New agent, from the Sessions tab: an existing workspace, the provider and model (the last choice
  remembered per device), the first prompt.
- Changed since that design: the plugin runs on stock Paseo, whose SDK has no call to stop a turn.
  Stop is offered where the host's SDK has it (as the agent card does today, `shared/host-extras.ts`).
  The office's server cannot stop a turn either on stock, so there is no server route for it.
- On a phone the tab opens in the sheet.

### 2. Sounds

- my-office's `audio/sfx.js` is taken unchanged in place of the trimmed one, less the one tune the
  bundle already refuses.
- A device setting, "Sound", off by default (the scene's own `office-sound` switch is set from
  it), on the Office settings page, and a mute button on the floor's toolbar that changes the same
  setting.
- Sound starts only after a press in the scene, as browsers require; where an app's frame never
  allows audio, the button says so and stays off.
- The scenes that make audio contexts of their own (karaoke, later the street's) follow the same
  switch.

### 3. Floor plans, part 1

- A host setting, "Floor plan": Company floor (the default) or Cozy room. The scene is started
  with it; a change restarts the scene.
- Headquarters is not offered until piece 6.
- Checked: every place the plugin assumes the company floor (desk counts, the rooms the 2D floor
  and the List name, the lively floor's places).

### 4. Camera extras

- The automatic camera, photo mode's day and night buttons, and tips, taken from my-office.
- Clip recording on the desktop app and browsers only; hidden where the app cannot record or keep
  a download, as Photo mode is today.
- Day and night: the port's night follows the app's theme. Photo mode's buttons change the scene
  for the photo only and go back when photo mode ends.

### 5. Staff and daily life, indoors

- The 13 scenes that need no street, with their helpers: taken unchanged where they can be.
- The chat lines they speak go to the office's team chat through the engine the office already
  runs (`shared/upstream/chat-engine.js`), in place of the stand-in that drops them.
- The data they read is supplied by the plugin's server through the scene's API: spending, a
  repository's age, CI results, release tags, how long an agent has existed, and the two answers
  my-office's server gave (`/api/claude-version`, `/api/tenure`). Where the host cannot know a
  thing (a battery level, for one), the scene is told nothing and that scene does not play.
- The port's own lively floor (`paseo-leisure*.js`), which stood in for the midday nap and moved
  resting people about, gives way to my-office's own where the two overlap.
- The README's data section is rewritten in this release.

### 6. Headquarters

- `world/pro/wing.js` is taken, the `hq` plan is allowed, and the Floor plan setting gains
  Headquarters.
- Its department rooms are filled by the staff of piece 5.

### 7. Seasons, rain and weather

- my-office's `seasons`, `rain` and `weather`, taken.
- A host setting, "Weather": Off (the default), Manual (clear, cloudy, rain, storm, or follow the
  season), From a service.
- From a service: the user enters the address. It is empty until then. The settings page shows an
  example for open-meteo with a latitude and a longitude, not pre-filled. The plugin's server
  fetches it on a timer and passes the scene only the result. The address is checked as the Sentry
  address is: https, or http on the host itself. The answer must have open-meteo's shape (the
  current weather code, the temperature, day or night), which the docs spell out, so a user's own
  endpoint or a static file works.
- A failed or malformed answer falls back to the season's weather and shows in Attention.
- The README says the address is kept in the office's settings file on the host, with whatever
  it contains.

### 8. The street

- my-office's backdrops, the street, its shops and its people, with the car model pack (CC0).
- The eight real logos are not taken. Shop fronts and vehicles carry made-up names and plain
  signs, drawn by the port.
- The six staff scenes that happen on the street come with it.
- A device setting, "The street outside", off by default on a phone and on elsewhere, because it
  roughly doubles the scene and is heavy on memory. Off means the plain backdrop of today.
- The bundle's size cap and the `process.env` check in `server/world-script.test.ts` are revised
  for it; the bundle is still built ahead and embedded.
- The street's clock against the app's theme is settled in this piece's plan.

### 9. Languages

- my-office's Vietnamese and Thai for the scene's text, taken unchanged.
- Indonesian, written by the port and reviewed by the owner, in my-office's own format, so it can
  be offered to my-office.
- The scene is told the app's language and falls back to English. The port's own strings are
  translated into Indonesian too; in Vietnamese and Thai they stay English until someone offers
  them.
- The office's own interface (the column, the cards, the settings page) stays English. Translating
  it is a later, separate piece.

## Not to be built

- Lite mode, replay and the demo.
- The tune that imitates a real brand's.
- 3D by streaming for the store phone app, unless the owner comes to use that app.

## Risks

- Web Audio inside the app's frame on a phone is unverified until piece 2 is tried there.
- The street on a phone's memory.
- Each staff scene taken unchanged may assume the page of my-office around it (elements by id,
  styles); the import tool does not check that.
- The more of my-office is taken unchanged, the easier a newer my-office is to take; every change
  by hand is a cost paid again at each update.
