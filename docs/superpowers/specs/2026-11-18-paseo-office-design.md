# paseo-office: the office as an installed plugin

Date: 2026-11-18. Status: designed. It follows
[the office's own column](2026-11-18-office-own-column-design.md), whose pieces 1 and 2 are built
in the fork and whose pieces 3 and 4 move to the new repo, and it carries out the office's part of
the fork's retirement (`docs/paseo-fork-retirement-plan.md` in the QFlavours workspace, Phase 3).

## Request

The owner, on 2026-11-18, after the office's settings gear answered "This plugin is not installed
or listed":

1. The office is an external plugin, not a built-in, so the Plugins page lists it and holds its
   settings.
2. It stays integrated with Paseo: agents, sessions, permissions, agent tools.
3. It is a public community port of my-office, whose author gave leave to use all of its source.
4. Everything my-office has comes into it, over time.

## The owner's answers

| Question                       | Answer                                                                                                                                                                |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the plugin lives         | Its own public repo, `allrested/paseo-office`, installed with Paseo's Git source.                                                                                     |
| How much of my-office it is    | The office's own Paseo interface stays (it must work on phones). Anything inside the 3D view comes from my-office. A full port of my-office's interface is not built. |
| Which my-office parts          | Everything inside the 3D view: sounds, staff, daily life, the street and city, seasons and weather, camera extras, replay, languages.                                 |
| 3D on the store phone app      | By streaming: the host's Chromium draws the floor and the app shows pictures. Its own sub-project, right after the move.                                              |
| Order                          | 1 the move, 2 streamed 3D, 3 the column's sessions and New agent, 4 sounds, 5 staff and daily life, 6 outside, 7 camera extras and languages.                         |
| Copyright of the plugin's code | "Copyright (c) 2026 allrested", MIT.                                                                                                                                  |
| The design of sub-project 1    | Approved as played back.                                                                                                                                              |

## What my-office's author asked

Khanh (khanh020905), by message, relayed by the owner on 2026-11-18. These bind every release:

- Keep the MIT licence and copyright notice.
- Link back to https://github.com/khanh020905/my-office in the plugin's README.
- Present it as a community port ("based on my-office"), not an official version, so issues with
  the Paseo plugin go to our repository.
- Send him the link once it is released; he offered to mention it in his README.

## What was there

- The office is a built-in of the fork (`plugins/office`, about 25,000 lines of its own plus the
  vendored scene). A built-in runs in the daemon's process and has no row in Settings > Plugins.
  The app shows a plugin's settings screen only inside that plugin's page, which it finds in the
  list of installed plugins, so `client.openSettings` cannot open a built-in's screen.
- The scene is my-office at `b68228871fe30cd2c759a2c919337a9a9d1f5644` (v0.6.0) with three.js
  0.160.0, under `vendor/my-office/` with upstream's `LICENSE`, a `MANIFEST.json` of hashes, and
  `import-upstream.mjs`. `vendor/SOURCES.md` says what is taken, what is a stand-in, and what is
  changed by hand.
- What ties it to the fork:
  - The daemon bundles the scene at runtime through the built-in argument's
    `bundleBrowserScript`, and finds it by the built-in's `directory`.
  - `server.schedules` and `server.handleSchedule` (fork-only) run the stand-up notes at 8:00 and
    the incidents check.
  - `process.pid` and `process.env` are read as the daemon's (the host's readings, the clean-up's
    protected processes, the data files' folder, the skill folders).
  - The client SDK's `cancel()` and `closeRuntime()` on an agent (fork-only).
  - The kit's `ScriptFrame` (fork-only) runs the scene in the fork's Android app.
  - `navigation.showBeside` (fork-only) shows Resources beside the floor.
- Stock Paseo gives an installed plugin: a subprocess with its own Paseo client, agent tools
  (`defineAgentTool`), RPCs, subscriptions, settings and settings screens, `openSettings`, a
  `build` preparation step in the manifest, and the SDK as `@getpaseo/plugin` 0.16.2 on npm. It
  supplies the SDK's modules; any other dependency (`zod`) is the plugin's own.
- On the web and in the desktop app the scene already runs in an `iframe`, with no fork call.

## Approaches

| Approach                                              | Trade-off                                                                                                                           | Chosen |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ------ |
| The hybrid, moved out, then more of my-office's world | Built and tested code; one interface on every device; my-office's world grows inside the 3D view.                                   | Yes    |
| A full port of my-office's interface                  | Closest to the original. The store phone app cannot run it (no script frame, no DOM), and it discards the office's Paseo interface. | No     |
| A folder in one `paseo-plugins` repo                  | One place for all the fork's plugins. The port's README, licence and issues would be mixed with unrelated plugins.                  | No     |
| Carry the fork's history into the new repo            | Blame survives. Every path changes anyway, and the history stays readable in `allrested/paseo`.                                     | No     |
| Build the scene on install                            | No generated file in the repo. Every install then needs dev dependencies and an esbuild binary on the host.                         | No     |

## Design of sub-project 1: the move

### The repo

- `allrested/paseo-office`, public. The plugin is at the root: `paseo-plugin.json`,
  `index.client.tsx`, `index.server.ts`, `client/`, `server/`, `shared/`, `vendor/`, and
  `dist/world.js`.
- One import commit, whose message names the fork commit the files came from. The office's tests
  come with it.
- `LICENSE`: MIT, "Copyright (c) 2026 allrested", followed by a notice that `vendor/my-office/` is
  MIT, Copyright (c) 2026 khanh020905, and three.js is MIT, Copyright © 2010-2023 three.js
  authors, each with its own licence file kept where it is.
- `README.md`: what it is ("a community port of my-office for Paseo, based on my-office"), the
  link to https://github.com/khanh020905/my-office, how to install, what works on which app, the
  upstream commit it is based on, and that issues with the plugin belong in this repo. The repo's
  description on GitHub says the same in one line.
- `vendor/SOURCES.md` and `import-upstream.mjs` move unchanged but for paths.
- The office's section of the fork's `docs/plugins.md` becomes the repo's `docs/`, rewritten for
  an installed plugin.

### Running on stock Paseo

| Tie to the fork                      | In the plugin                                                                                                                                                                                               |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bundleBrowserScript`, `directory`   | `npm run build:world` bundles the scene into `dist/world.js`, which is committed. The server reads it from beside its own module. CI rebuilds it and fails when the committed file differs.                 |
| `server.schedules`, `handleSchedule` | A timer in the plugin's server: it works out the next 8:00 in the notes' time zone and the incidents check's next run, and runs them itself. A run missed while the daemon was down is not made up.         |
| `process.pid` as the daemon          | The plugin's parent process. Where the parent cannot be read, the readings that need it are left out and the clean-up protects the plugin's own ancestors only.                                             |
| `process.env` as the daemon's        | The subprocess's environment where it carries `PASEO_HOME`; otherwise the default home. The plan's first task reads what a stock daemon passes and settles this.                                            |
| `cancel()`, `closeRuntime()`         | Used when the host's SDK has them. Without them Stop and the Host card's close are not offered.                                                                                                             |
| `ScriptFrame`                        | Used when the app's kit has it; otherwise the 2D floor, until sub-project 2.                                                                                                                                |
| `showBeside` for Resources           | As today: the Host card where the app has no side area or no Resources plugin.                                                                                                                              |
| `zod`                                | A dependency in `package.json`. The manifest's `build` is `[["npm", "ci", "--omit=dev"]]`, so an install brings it. The plan's first task confirms on a stock daemon that this is what a Git install needs. |

- The plugin id stays `office`, and the data files stay where they are
  (`<PASEO_HOME>/office/...`), so boards, chat, notes, incidents and both settings documents carry
  over.
- `requirements.paseo` is `>=0.16.0`.
- Nothing is told to the scene that is not told today: who is there and what kind of thing each
  does, never a file name, a command or a prompt.

### Settings

The Office settings screen (`addSettingsScreen`, id `office`) is unchanged. For an installed
plugin the app shows it in the plugin's page, and the gear, the strip's Settings card and the
Command Center's "Office settings" open it.

### Checks

- CI in the new repo, on GitHub Actions: `npm ci`, typecheck against the published
  `@getpaseo/plugin`, lint, format, the tests, and "the committed `dist/world.js` is what the
  build makes".
- A dev daemon from unmodified upstream (`@getpaseo/server` from npm, its own `PASEO_HOME` and
  port, never 6767): `paseo plugin install` from the repo, the plugin's log shows it loaded in a
  subprocess, the office's state arrives, a board post and a chat message are stored, the timers
  are set, an agent sees the office's tools.
- A look in a browser against that daemon's web UI at 1280 and 390 px: the 3D floor, the column,
  the gear opening Settings > Plugins > Office.

### Cutover on the owner's host

With the owner's go-ahead at the time, since it restarts the daemon on 6767:

1. In the fork, remove `plugins/office` and its line in `builtinPlugins`, build and install as
   usual.
2. Set `pluginsEnabled: true`, install `git:allrested/paseo-office` at the release tag.
3. Restart; confirm the office opens, its boards and chat are there, and the settings screen is on
   the Plugins page.
4. The previous build stays under `/tmp` as the way back.

### Release

Tag `v0.1.0` once the cutover holds. The checklist ends with: tell the owner the link is ready to
send to Khanh.

### Not in sub-project 1

No new feature. No change to what the scene takes from my-office. The fork's other built-ins stay
where they are.

## The later sub-projects

Each gets its own design and plan, in the new repo.

| #   | What                                | Note                                                                                                                                      |
| --- | ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 2   | 3D on the store phone app           | The plugin's server drives the host's Chromium and sends pictures of the floor; taps and pans go back. The column around it stays native. |
| 3   | The column's sessions and New agent | Pieces 3 and 4 of [the office's own column](2026-11-18-office-own-column-design.md).                                                      |
| 4   | Sounds                              | my-office's `audio/`, in place of the siren-only engine.                                                                                  |
| 5   | Staff and daily life                | Reception, cleaner, guard, HR, accountant, courier, interns; lunch, nap, tea, outings and the rest.                                       |
| 6   | Outside                             | The street, the city backdrops, seasons, rain and weather.                                                                                |
| 7   | Camera extras and languages         | Automatic camera, clips, photo mode's day and night, replay, tips, lite mode, the other locales.                                          |

my-office's own interface (top bar, session drawer, panels, chat window, settings) is not taken in
any of them: the office's Paseo interface stands in its place on every device.

## Risks

- What a stock daemon gives an installed plugin's subprocess (environment, parent process, npm
  dependencies on a Git install) is read from the docs and the source, not yet run. The plan's
  first task is a small plugin installed on a stock dev daemon that settles each.
- 47 test files were written against the fork's workspace. Some may lean on fork-only SDK types.
- The owner's host runs the fork's daemon until the fork is retired; the plugin must run on both.
