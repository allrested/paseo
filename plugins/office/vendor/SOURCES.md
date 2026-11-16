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

The games call the group chat, the sounds and the first-person walk, which are not taken: their
stand-ins export what the games import and do nothing, so a game is seen and not heard, nobody
plays it in first person, and a karaoke song has no sound.

Three copied files are changed by hand, and each change starts with `// PASEO:`:

- `src/office/core/env.js`: the build flag upstream reads from `process.env` is a constant, and
  the floor plan comes from Paseo, not from the page's address and storage.
- `src/office/interact/place-cards.js`: the lounge's card has a cup for its icon, not a sparkle,
  and the launch pad's card lists no repositories (a team is a workspace, and Paseo sends no
  repository state).
- `src/office/life/tests.js`: `clearRun` puts out the lamp of a test run whose end Paseo never
  learns.

### What is not taken

Upstream's own interface (panels, the session drawer, the chat, settings, the top bar), its server
connection, the replay, the demo, sounds, other languages, the street outside with its shops, the
first-person walk, and the daily-life scenes (lunch runs, the midday nap, the seasons, the
weather and the like). The owner asked for the office floor only.

The kept modules still import those files, so each has a stand-in at the same path that starts
with `// PASEO: stand-in`. Most export what is asked of them and do nothing. These do work:

| Stand-in                    | What it does                                                           |
| --------------------------- | ---------------------------------------------------------------------- |
| `i18n/index.js`             | English only; drops the emoji upstream ends its lines with; Paseo's wording where upstream's line needs a file name or a command |
| `ui/session-drawer.js`      | A chosen person is told to Paseo, which opens its agent card           |
| `ui/whiteboard.js`          | Draws Paseo's rows on the board; picks people and furniture            |
| `ui/camera-bar.js`          | One view: the floor fitted to the frame                                |
| `ui/mac-drawer.js`          | Holds the host's readings Paseo sets; opens Paseo's panel when it has one |
| `ui/activity.js`            | Passes the scene's toasts to Paseo                                     |
| `interact/first-person.js`  | The collision grid people route around, without the first-person walk  |
| `world/backdrops/index.js`  | A plain backdrop in the app's surface colour; day and night            |

Paseo's own files sit beside upstream's and are named for it: `paseo-entry.js` (the bundle's
entry: builds the page, starts the modules in upstream's order, sets `PaseoOfficeWorld`),
`paseo-host.js` (what the stand-ins read and call), `paseo-style.js` (the page's stylesheet, in
Paseo's design language), `paseo-modules.js` (generated: the kept modules in start-up order), and
`paseo-sign.js` (the picture on the lobby's sign and the reception's plaque, with the host's
brand; the entry puts it on the material upstream's floor made).

The library's place card is not shown: `paseo-entry.js` gives the place an `open`, so its chip
and the bookshelf open Paseo's Library card.

### What the scene is told

Paseo sends the scene who is there and what kind of thing each person does (`client/world/
world-api.ts`), never a file name, a command or a prompt. The scene runs in upstream's streamer
mode, which writes "a file" and "a command" where upstream would write the name, and the entry
keeps the feed and the counts upstream's server would keep, from the moment the office opens.

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
