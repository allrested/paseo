# Vendored files

`my-office/` is the 3D office a browser draws. The daemon bundles it into one script and serves it
over `office.world.request`; the client runs it in a frame only when the 3D view is shown. The 2D
office (`client/pixel`) is the plugin's own and takes nothing from here.

## my-office

- Source: https://github.com/khanh020905/my-office at `b68228871fe30cd2c759a2c919337a9a9d1f5644`
  (v0.6.0, 2026-11-14).
- Licence: MIT, Copyright (c) 2026 khanh020905 (`my-office/LICENSE`, upstream's file).
- With it: `three@0.160.0`, the version upstream pins, as `my-office/three/three.module.min.js`
  and the 15 add-ons the scene imports under `my-office/three/addons/`. MIT, Copyright © 2010-2023
  three.js authors (`my-office/three/LICENSE`).
- `my-office/MANIFEST.json` records the commit, the three.js version, the order upstream starts
  its modules in, and a sha256 for every copied file.

### What is taken

The scene: the floor plans, the furniture, the people and how they move, the labels over them,
the place cards, and the lounge's four games (pool, the TV matches, foosball, karaoke: `people/
billiards.js`, `gaming.js`, `foosball.js`, `karaoke.js`). Upstream's files are copied unchanged,
except that `'three'` and `'three/addons/...'` imports are rewritten to relative paths, so the
bundle needs no resolver.

The first-person walk is taken too: Walk in, at the camera bar's end, walks the floor as your own
character, and a game can be played from there. The games call the group chat and the sounds. The
chat's window is not taken: its stand-in exports what the games import and does nothing. The sounds are the
siren alone (below). So a game is seen and not heard, and a karaoke song has no sound.

Five copied files are changed by hand, and each change starts with `// PASEO:`:

- `src/office/core/env.js`: the build flag upstream reads from `process.env` is a constant, and
  the floor plan comes from Paseo, not from the page's address and storage.
- `src/office/interact/first-person.js`: the street is cut (`street()` returns null, so the door
  has no E action), E on a person passes `opts.open` to the session drawer, and `floorBounds` is
  exported for the camera bar.
- `src/office/interact/place-cards.js`: the lounge's card has a cup for its icon, not a sparkle,
  and the launch pad's card lists no repositories (a team is a workspace, and Paseo sends no
  repository state).
- `src/office/life/tests.js`: `clearRun` puts out the lamp of a test run whose end Paseo never
  learns.
- `src/office/ui/photo.js`: the mark painted into a photo is the host's brand name (Paseo's when
  there is none), the file is named `office-YYYY-MM-DD-HHMM.png`, and a host with `photo` false
  has no Photo mode (the button is hidden and `enterPhoto` returns).

Two files are taken trimmed. Their paths stay in the import tool's `DENY`, so it never writes them
and only checks that they export what the kept modules import (which is why `MANIFEST.json` lists
them under `standIns`). Each cut or change starts with `// PASEO:`. `paseo-entry.js` runs their
`setup` where upstream's start-up order has them, just before the loop.

- `src/office/life/incidents.js`: upstream's alarm, `startIncident`, `updateIncident` and `setup`:
  a red light over the floor and a red stage for 25 s, a fail bubble over each person at work, and
  the siren. Under reduced motion the light holds a steady red. Cut: `fails` and the branch that
  rang for three failures in five minutes (an incident is one the office found in Jira or Sentry,
  and the entry's `setIncidents` rings it); `headache()` (the errand for headache pills); `onEvent`
  (its part that moves people stands in `paseo-entry.js`); and the banner, which is the entry's
  and shows while an incident is open, not only for the 25 s.
- `src/office/audio/sfx.js`: upstream's engine (the audio context and its unlock on a click or a
  key, `tone`, a gap per sound, the `office-sound` switch) with the siren alone. Cut: `noise` and
  every other sound, so every other name the kept modules play makes no sound. `sfx.on` reads off,
  because `people/karaoke.js` sings through its own audio while it is on.

The team chat's engine (`src/shared/chat-engine.js`) and the English `chat` area
(`src/i18n/locales/en/chat.js`) are taken unchanged into the plugin's `shared/upstream/`, not into
`my-office/src/`. The office's server runs the engine (`server/chat-service.ts`) and the chat's
panel reads its stickers and reactions (`client/chat-text.ts`); the plugin compiler bundles only
modules under `client/`, `server/` and `shared/`, so neither could import them from `my-office/`.
The scene does not take them. Nothing in the start-up list reaches the engine, so the import tool
takes the two files by name and records them under `chat` in `MANIFEST.json`. The plugin compiles
with `allowJs` off, so two `.d.ts` files beside them type what the office calls:
`shared/upstream/chat-engine.d.ts` and `shared/upstream/chat.d.ts`. The import tool never writes a
`.d.ts`. The engine's `tr` is `shared/chat-words.ts`, the stand-in's lookup over the `chat` area
and `people.director`, which keeps upstream's emoji.

### What is not taken

Upstream's own interface (panels, the session drawer, the chat, settings, the top bar), its server
connection, the replay, the demo, every sound but the siren, other languages, the street outside
with its shops, and the daily-life scenes (lunch runs, the midday nap, the seasons, the weather and
the like). The owner asked for the office floor only. Of the camera toolbar and photo mode, these
are left out on purpose: the list button, the automatic camera, clip recording, and photo mode's
day and night buttons.

The kept modules still import those files, so each has a stand-in at the same path that starts
with `// PASEO: stand-in`. Most export what is asked of them and do nothing. These do work:

| Stand-in                    | What it does                                                           |
| --------------------------- | ---------------------------------------------------------------------- |
| `i18n/index.js`             | English only; drops the emoji upstream ends its lines with; Paseo's wording where upstream's line needs a file name or a command |
| `ui/session-drawer.js`      | A chosen person is told to Paseo, which opens its agent card           |
| `ui/whiteboard.js`          | Draws Paseo's rows on the board; picks people and furniture            |
| `ui/camera-bar.js`          | Builds upstream's toolbar and photo mode's bar; Overview is the floor fitted to the frame, the other three views are upstream's places; zoom and full screen, and Walk in with its overlay |
| `ui/mac-drawer.js`          | Holds the host's readings Paseo sets; opens Paseo's panel when it has one |
| `ui/activity.js`            | Passes the scene's toasts to Paseo                                     |
| `world/backdrops/index.js`  | A plain backdrop in the app's surface colour; day and night            |
| `life/nap.js`               | No midday nap; calls Paseo's lively floor every frame                  |

Paseo's own files sit beside upstream's and are named for it: `paseo-entry.js` (the bundle's
entry: builds the page, starts the modules in upstream's order, sets `PaseoOfficeWorld`),
`paseo-host.js` (what the stand-ins read and call), `paseo-style.js` (the page's stylesheet, in
Paseo's design language), `paseo-modules.js` (generated: the kept modules in start-up order),
`paseo-sign.js` (the picture on the lobby's sign and the reception's plaque, with the host's
brand; the entry puts it on the material upstream's floor made), and the lively floor:
`paseo-leisure-plan.js` (who gets up from a rest, when and for what; no scene in it, so
`client/world/leisure.test.ts` runs it) and `paseo-leisure.js` (which moves the people with
upstream's own moves and starts upstream's games through their starters). The stand-in of
`life/nap.js` runs it every frame: the scene's loop already calls `updateNap`.

The library's place card is not shown: `paseo-entry.js` gives the place an `open`, so its chip
and the bookshelf open Paseo's Library card.

Of the team chat, only the engine and its words are taken, into `shared/upstream/`. Its window
(`ui/group-chat*.js`; the games' `ui/group-chat.js` stays a stand-in), its CI, loop and denied
cards, voice, push notifications and prompt rewriting are not. Of the staff the engine names, only
the director has a name (upstream's English "Director"); reception, HR, the cleaner, the guard,
the courier and the accountant stay silent. So the engine's morning hello, its Monday stand-up
and Friday tea reminders, and HR's line when you write about a meeting never come. The lunch poll
still comes, from an agent. The engine's `tea` act does nothing.

### What the scene is told

Paseo sends the scene who is there and what kind of thing each person does (`client/world/
world-api.ts`), never a file name, a command or a prompt. It also sends the open incidents' keys
and titles for the banner. The scene runs in upstream's streamer mode, which writes "a file" and
"a command" where upstream would write the name, and the entry keeps the feed and the counts
upstream's server would keep, from the moment the office opens.

The scene writes three things to the app origin's `localStorage`, under keys that start with
`office-`: which team sits where, the plants, and the graphics level. It reads a few more
`office-` keys that nothing here writes. It makes no network call.

### Taking a newer upstream

```
git clone https://github.com/khanh020905/my-office /tmp/ref-office/my-office
npm install --prefix /tmp/ref-office/three three@<the version in upstream's package.json>
node plugins/office/vendor/my-office/import-upstream.mjs \
  --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check
```

`--check` writes nothing and lists what would change. Without it the tool copies the files,
regenerates `paseo-modules.js`, the English locale index and `MANIFEST.json`, and reports:

- files it kept because they carry a `PASEO:` note: compare each with upstream by hand;
- stand-ins that lack an export a kept module now imports: add it.

Then run `server/world-script.test.ts`, which builds the entry, and look at the office in a
browser: a module upstream added to its start-up list may need a stand-in or a place in `DENY`.
