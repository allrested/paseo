# my-office, what the Paseo port does not take yet: survey for scoping four groups

Read-only survey. Upstream: `/tmp/ref-office/my-office/src/` (called `U/` below), commit `b682288…` (v0.6.0).
Port: `/workspace/QFlavours/paseo-office/vendor/my-office/src/` (called `P/`).
Line counts are `wc -l` of upstream files. Sizes in KB are source bytes; bundle estimates assume the port's current ratio
(842 KB of taken source plus 77 KB of English strings became about 470 KB of the 1,146 KB bundle, the rest being three.js),
so they are rough.

## 0. Facts that hold for all four groups

- **Upstream has not moved.** `git -C /tmp/ref-office/my-office log -1` is `b68228871fe30cd2c759a2c919337a9a9d1f5644`
  (merge of PR #100, release 0.6.0), the same as `MANIFEST.json`'s `upstream.commit` and `SOURCES.md`. This only compares the
  local clone; no `git fetch` was made (no network), so "has moved on GitHub since the clone" is not checked.
- **No new three.js add-ons are needed by any group.** The files of all four groups import only `RoundedBoxGeometry` and
  `CSS2DRenderer` (both already vendored); `OutputPass` appears only in `ui/portraits.js` and `ui/chat-avatars.js`, which are
  not in scope. The port's 15 add-ons stay as they are.
- **Start-up and per-frame hooks already exist.** `core/loop.js` is taken unchanged and already calls every `update*` of B,
  `updateTips`, `clipCamera`/`clipFrame`, `replayTick`, `THEME.live.update` and `updateNap`, today into stand-ins that do nothing.
  `paseo-modules.js` is generated from `main.js`'s `MODULES` order, so a path that leaves `DENY` gets its `setup()` called at upstream's
  place without more code. The hand-wired exceptions in `paseo-entry.js` are listed in section 6.
- **The scene's page has no upstream HTML or CSS.** Upstream's page is Next.js (`app/`, `src/components/office/*.tsx`) with 2,719
  lines of CSS in `src/styles/`. The port builds its own page in `paseo-entry.js` (`buildPage`) and `ui/camera-bar.js` (`BAR`
  markup and `STYLE`), plus `paseo-style.js` (137 lines). Every element a new module looks up by id must be added there and every
  stylesheet rule written by hand (counts per group below).
- **The frame**: `client/world/world-frame.web.ts` opens an `<iframe srcdoc>` with only `allow="fullscreen"` and no `sandbox`; it is
  therefore same-origin with the app (the scene's `localStorage` is the app's, as `SOURCES.md` says). On the phone a `ScriptFrame`
  WebView is used (`world-view-native.tsx`); `world-bridge-page.ts` forces `document.fullscreenEnabled = false` there, and
  `photo:false` is passed because a WebView cannot keep a download. I did not find the WebView's settings in this repo, so autoplay
  and media flags below are **unverified**.
- **Bundle cap.** `server/world-script.test.ts` asserts `1_000_000 < script.length < 1_200_000` (today the generated file is
  1.15 MB), forbids `process.env` in the bundle, and asserts the bundle does not contain `mixue`, that
  `first-person.js` still has the `const street = () => null;` line, and that `ui/photo.js` has the `PASEO:` note. All four groups
  together (especially C) break the cap and some of these assertions on purpose; they must be rewritten with the work.
- **The port's HQ plan is off.** `core/env.js` is hand-changed so `LAYOUT` is `host.plan` ('pro' or 'cozy'), never 'hq'. `world/pro/wing.js`
  (group C) only does anything in the 'hq' plan.
- **The English locale already contains the strings of B and C.** The generated `i18n/locales/en/index.js` takes whole area files
  (13 areas: `world`, `people`, `life`, `fp`, `events`, ... 77 KB), so `people.hr.*`, `world.csgt.*` and the like are already vendored as dead data.
  This matters for public review (section C.6).
- Plugin-side facility that fits several groups: `@getpaseo/plugin/client` has `translations` with the app's `locale`, and
  `useSettings(...)` (used by `client/world/use-incident-alarm.ts` for the per-device `office-device` setting). Neither is passed
  to the scene today (`WorldStartOptions` has no language, no sound, no weather).

---

## A. Sounds

### A.1 Files

| File                        | Lines | What                                                                                                                                                                                                                                                                          |
| --------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `U/office/audio/sfx.js`     |    75 | The only audio module: `sfx.play(name)` over Web Audio, 29 sounds synthesised with oscillators and noise, a rate-limit per sound (`GAP`), `office-sound` switch, unlocked on the first `pointerdown`/`keydown`. Port: 40-line trim (engine + `siren`; `sfx.on` forced false). |
| `U/office/ui/clip-music.js` |   122 | Belongs to D (clip's lo-fi track, rendered to a buffer, never to the speakers).                                                                                                                                                                                               |

Sounds that exist (29): perm turn key print ding deploy alarm siren meow pop chat bloop brew rustle click pock shutter coin beep micro buzz thunder bell water clap thud mixue.

**Where sounds are played** (literal `sfx.play('x')` call sites, counted from the clone): **68 in 19 kept modules** (all silent in the
port today: it plays only `siren`) and **52 in 24 modules the port does not take** (B, C, and the chat/permission UI).
Sounds heard only from untaken modules: alarm (`life/drill.js`), chat (`ui/group-chat.js`), key and perm (`life/incidents.js` full version,
`ui/permissions.js`), mixue (`world/backdrops/shops.js`), pock (`street-pickle.js`), shutter (`street-photo.js`), thunder (`life/weather.js`).
Kept modules with the most call sites: `interact/props.js` (click x5, 9 kinds in all), `people/gaming.js`, `interact/first-person.js`, `people/gatherings.js`
(clap x3, bell x2), `people/karaoke.js`, `world/props/microwave.js`, `printer.js`, `shredder.js`, `cat.js`, `entrance.js`, `switches.js`, `life/your-turn.js` (turn), `people/workers.js` (pop).
Sounds from kept modules that would become audible by simply restoring `sfx.js`: beep bell bloop brew buzz clap click coin deploy ding meow micro pop print rustle thud turn water (18).

**Audio that bypasses `sfx.js`** (own `AudioContext`, gated on `sfx.on`):

- `people/karaoke.js` (kept, 342 lines): the whole song is synthesised (voice "ah" with echo, e-piano, bass, kit); needs `sfx.on` true. The port's stand-in returns `false` on purpose, so karaoke is silent.
- `world/backdrops/street-nhau.js` (a glass clink) and `street-csgt.js` (a whistle): each makes its own context (C).
- `ui/clip-music.js` makes one context per clip (D).
  So up to four live contexts in one page plus one per clip. Safari has historically capped the number of live `AudioContext`s (I did not verify the current limit): worth merging them into `sfx` when porting.

### A.2 Needs from outside itself

- Modules: `core/env.js` (`reduceMotion`, `replay`). Nothing else. No import of untaken modules.
- Add-ons: none. Assets: **none; sound is synthesised in code** (oscillators, filtered noise, `createBuffer`).
- DOM/CSS: none. The on/off switch lives in upstream's Settings panel (`ui/settings.js:67`, `sfx.set(v)`), which the port does not have: **the port needs its own mute control** (nothing in the page sets `office-sound` today).
- Browser APIs: Web Audio. Autoplay: the context is created inside the first `pointerdown`/`keydown` on `window`, inside the frame; the frame is same-origin `srcdoc`, so a gesture in the frame unlocks it on desktop browsers. Not unlocked by a gesture in the host page. The WebView needs "media playback without user gesture" off or a tap first (unverified); iOS also mutes Web Audio with the ring switch. `localStorage` key `office-sound` (read at setup, written by `set`).
- Network: none.

### A.3 Data/events from the host

None. Sound names are the same event kinds the scene already acts on. The host would supply a **mute/volume setting** (device-level setting fits `useSettings`) and could pass it through `start()` options. `replay.on` and `reduceMotion` are read from `core/env.js`.

### A.4 Leaks

None: no file name, command or prompt reaches a sound.

### A.5 Start-up

`audioSfx` is 110th of 118 in upstream's list (after `netLive`, `lifeYourTurn`, `lifeIncidents`), no per-frame function, no timers. The port's `paseo-entry.js` already imports `./audio/sfx.js` and calls `audioSfx.setup()` by hand at `coreLoop`. Taking the file unchanged means the hand call and the `MODULES` entry would both run (see section 6).

### A.6 Content

- `mixue` is the Mixue shop's tune, "Oh! Susanna" (Stephen Foster, 1848, public domain melody) on a music box. It is only played from `shops.js` (group C) and the test forbids the string `mixue` in the bundle; drop that sound or rename it.
- Everything else is generic beeps, clicks, a meow, thunder, applause. `sfx.js` carries no licence note.

### A.7 Judgement: **small**. About 6 KB. Main risk: autoplay and iOS/WebView audio policy, and noise at scale (19 kept modules start making sound at once). Needs a mute switch and a decision about karaoke (its own song).

---

## B. Staff and daily life

### B.1 Files (upstream lines)

People (15 files, 3,915 lines):

| File                   |   L | What it does                                                                                                                | Needs beyond office floor                                                           |
| ---------------------- | --: | --------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `people/outings.js`    | 600 | Lunch delivery to the kerb, convenience-store trips, late noodle runs, going home by scooter/ride-hail, back in the morning | street (C); weather; `/api/claude-version`; `payday.js`, `evswap.js`; 11 chat posts |
| `people/comnha.js`     | 195 | Lunch from home, warmed at the pantry microwaves at noon                                                                    | `shared/comnha.js` (36, new); 3 chat posts                                          |
| `people/comtrua.js`    | 172 | Friday and some weekday lunch at a street-side rice eatery                                                                  | street (`eat-com.js`)                                                               |
| `people/duty.js`       | 240 | Pantry chores rota (cups, bin, plants, tables)                                                                              | `shared/duty.js` taken; localStorage                                                |
| `people/teatime.js`    |  91 | Friday 16:00 tea                                                                                                            | none                                                                                |
| `people/accountant.js` | 255 | Accountant's desk, day's API cost on a screen, 17:30 report, word with the top spender when the plan's limit nears          | `s.usage.cost`, plan limits (`mac-drawer.liveWindows`)                              |
| `people/rounds.js`     | 130 | Director's rounds twice a day                                                                                               | none (`doneAt`, `status`)                                                           |
| `people/guard.js`      | 253 | Security guard at the street door                                                                                           | street (C): `backdrops/index`, `street-folk`                                        |
| `people/hr.js`         | 362 | HR woman, fingerprint clock-in terminal, monthly birthday cake                                                              | `s.git.born` (first-commit date), `DEMO`                                            |
| `people/farewell.js`   | 380 | Farewell party for a project with no session for a month; its desk is packed up                                             | `/api/tenure`; settings (days)                                                      |
| `people/interns.js`    | 196 | New project's people are "interns"; after 20 turns on 2 days, a contract ceremony                                           | `/api/tenure`                                                                       |
| `people/nhau.js`       | 231 | Friday evening drinking-place outing, then ride-hail home                                                                   | street (`street-nhau.js`)                                                           |
| `people/photobooth.js` | 223 | Four people to a photo studio for each release, strip pinned on the whiteboard                                              | street; a release event with a tag                                                  |
| `people/pickle.js`     | 193 | Pickleball after work on days CI stayed green                                                                               | street (`street-pickle.js`); `s.git.ci`                                             |
| `people/staff.js`      | 394 | Receptionist, evening cleaner, a courier with a parcel                                                                      | imports `life/rain.js` (`wetSign`), which imports `seasons.js`                      |

Life (6 files, 1,053 lines) plus the nap:

| File                   |   L | What                                                                                                                               |
| ---------------------- | --: | ---------------------------------------------------------------------------------------------------------------------------------- |
| `life/altar.js`        | 172 | Small shrine in the lobby, offerings on the lunar 1st and 15th                                                                     |
| `life/lift-service.js` | 226 | Lift "under repair" for minutes after the office's server starts, technician, sticker with build version                           |
| `life/drill.js`        | 368 | Quarterly fire drill at 15:00 on the first working day of a quarter; alarm sound; assembly point on the street when the city is on |
| `life/day-swaps.js`    |  39 | Government-swapped working days and make-up Saturdays (from `shared/workdays.js`)                                                  |
| `life/photostrips.js`  | 135 | Release history strips pinned along the whiteboard; keeps six in `localStorage`                                                    |
| `life/post.js`         | 113 | Post box: every commit a letter, a push calls the postman                                                                          |
| `life/nap.js`          |  63 | Midday nap 12:30-13:30 (port: stand-in calling `paseo-leisure.js` 166 + `paseo-leisure-plan.js` 55 lines, the "lively floor")      |

Total: **21 files, 4,968 lines**, plus three files not yet taken that they import: `people/evswap.js` 186 (battery swap errand, needs the host's battery reading, tied to `street-ev.js`), `people/payday.js` 124 (ATM trip on the 5th, 10th and month end, tied to `street-atm.js`), `shared/comnha.js` 36. Source about 343 KB, bundle about +170 KB.

**Natural split.** Office-floor only (no street): comnha, duty, teatime, accountant, rounds, hr, farewell, interns, altar, day-swaps, post, photostrips, lift-service, plus `staff` if `rain.js` is stood in with a `wetSign()` stub. Street-dependent (each needs group C's city): outings, comtrua, guard, nhau, photobooth, pickle (and the street half of drill).

### B.2 Needs from outside themselves

- Other modules: all already taken except those named above. Stand-ins they call: `audio/sfx.js` (A) in 11 of the files; `ui/group-chat.js` (`chatSay`/`chatLife`: **41 call sites** in B, 1 in C), `ui/activity.js` (`toast`, `queueUi`), `life/nap.js` (`napOn`), `ui/mac-drawer.js` (`liveWindows`), `demo/demo.js` (`DEMO`), `world/backdrops/index.js` and `street-folk.js`, `life/rain.js`, `life/weather.js`. The chat stand-in is a no-op; without wiring it, all the lines the staff "post in the group chat" vanish (the port runs the chat engine on the server, `server/chat-service.ts`, and the chat panel is the plugin's).
- Add-ons: none new (`guard.js` uses CSS2DRenderer, already vendored).
- Assets: none (everything drawn on canvases and geometry). Fonts: canvas text names `"Be Vietnam Pro"`/`system-ui`; the port ships no fonts (fallback to system-ui). Upstream's 26 woff2 files are 332 KB (OFL), not needed.
- DOM/CSS: no element ids in B except Settings controls `[data-fw-days]`, `[data-fw-tgl]` (farewell, settings panel). CSS classes used: `tag`, `shop-say` (the port has `tag`). Small.
- Browser APIs: `localStorage` (keys via constants `SEEN`=`office-claude-version`, duty's `KEY`, photostrips' `KEY`, farewell's `GONE_KEY`), `fetch` (below), `FontFace`-style `document.fonts.ready` redraws (harmless). The `clipboard` hits in `drill.js` are a prop, not the API.
- Network (quote): `outings.js:551` `fetch(\`/api/claude-version${TOKEN ? ...}\`)`; `farewell.js` and `interns.js` `fetch(\`/api/tenure${...}\`)`. Both are same-origin calls to upstream's server and would fail in the frame.
- Debug hooks: most files add `window.__office.<name>` and `?comnha`, `?nhau`, `?photo`, `?pickle`, `?farewell`, `?drill`, `?liftservice`, `?lunar`, `?debug` query flags. In `srcdoc` there is no query string, so these are inert.

### B.3 Data and events from the host

Today's API (`world-api.ts`): sessions (`id, name, title, dir, git.repo, status, agent, lastPrompt, doneAt, stuck, waitingOn, usage{ctx,ctxMax}`), events, board rows, machine (mem, cpu, dev servers), incidents, theme. The scene reads time from the device clock (`officeNow()`).

| Needed                                                                                             | By                                                   | Equivalent in host API?                                                                    |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| time of day, weekday, holidays (Vietnamese labour calendar in `shared/workdays.js`, already taken) | all schedules                                        | the device clock; yes, but the calendar is Vietnam's                                       |
| a person's `status` / background work `bg`                                                         | all                                                  | `status` yes; `bg` no (port's `leisure-plan` uses `called()` on `s.bg?.length`)            |
| `s.usage.cost` (USD), `state.limits.windows[{key,pct,resetsAt}]`                                   | accountant                                           | cost: no. Limits: `host.limits()`/`setLimits` exists in the entry but not in `WorldApi`    |
| `s.git.born` (first-commit date), `s.git.ci` ('red'/'green')                                       | hr, pickle                                           | no (`git: { repo }` only)                                                                  |
| release event with a version tag                                                                   | photobooth, photostrips                              | no event type for it (upstream's `life/incidents.js onEvent` raised it; the port cut that) |
| `/api/tenure`: project's first-seen, last session, turns on separate days                          | farewell, interns                                    | no                                                                                         |
| `/api/claude-version`                                                                              | outings (a new agent version sends someone shopping) | no                                                                                         |
| server start time / build change                                                                   | lift-service                                         | no                                                                                         |
| machine battery %                                                                                  | evswap                                               | `WorldMachine` has mem/cpu only                                                            |
| stats counters                                                                                     | post (`state.stats`)                                 | the entry keeps `state.stats` itself                                                       |
| group chat sink (`chatSay`)                                                                        | 41 calls                                             | a host callback would be needed                                                            |

### B.4 Anything that tells the scene more than "who and what kind"

Yes, if wired as upstream does: `git.born` (a repository's first-commit month), `git.ci`, a release's version tag string (from a repository tag), the cost in dollars, tenure (how long a project has existed, from the host's history), the agent tool's version. None is a file name, command or prompt, but tags and tenure are repository-derived. `staff`/`hr` also paint `s.git.repo || dir`'s last segment onto pod screens: the port already sends `git.repo`, so project names already reach the scene.

### B.5 Start-up

Setup order in upstream's list: outings 53, comnha 54, staff 55, duty 56, teatime 57, accountant 58, rounds 59, guard 60, hr 61, farewell 66, interns 67, seasons 69, rain 70, weather 71, nap 72, altar 74, lift-service 75, drill 76, day-swaps 77, photostrips 79, post 80. Per frame, `core/loop.js` calls `updateOutings, updateMicro, updateStaff, updateDuty, updateDrill, updateDaySwaps, updateTeatime, updateAccountant, updateRounds, updateGuard, updateHr, ... updateFarewell, updateInterns, ... updateNap, updateQuota, updateAltar, updateTests, updatePost, updateIncident`. The port already gets these calls into stand-ins that return at once. Timers: 0 to 5 `setTimeout`/`setInterval` per file (farewell 5, accountant 4, outings 3). `life/nap.js` is the one stand-in with real logic: the lively floor hangs on `updateNap`; if `nap.js` were taken, the leisure code needs another hook (`everyFrame`).

### B.6 Content for a public port

- Vietnamese text in code: 24 non-comment lines in B (outings 11, altar 3, others 1-2), but most strings live in `en/people.js` (444 lines, 11 lines with Vietnamese) and `en/life.js`; much of the English is itself Vietnam-specific.
- Culturally specific scenes (neutral names): a lobby shrine to two household deities with offerings on lunar-calendar days (`altar.js`); a drinking-place outing with beer and the line "if you drank, you don't drive" (`nhau.js`); a quarterly fire drill with an assembly roll-call; a farewell party where colleagues sign a card (`farewell.js`); an intern-to-staff contract ceremony with a red company stamp (`interns.js`); a Friday dish day and a shared rice lunch with a bill (`comtrua.js`); a payday ATM run on the 5th/10th; the Government's swapped working days (`day-swaps.js`, `workdays.js` with Vietnamese labour-law holiday dates, already vendored).
- Real brands/companies named in B: Grab/GrabFood/GrabBike, Xanh SM, Circle K, GS25, 7-Eleven, Ministop, WinMart, Bách Hóa Xanh, Highlands, Cộng, Katinat, Phúc Long, Mixue, Thế Giới Di Động, Điện Máy Xanh, Long Châu (all in `outings.js`), Shopee (courier in `staff.js`, with the mark's path from Simple Icons, CC0; "the trademark is Shopee's"), plus the Claude/Anthropic mark in already-kept `workers.js`.
- Licence notes in these files: only the Simple Icons note in `staff.js:27`.

### B.7 Judgement: **medium-large**. 21 files, ~5.3k lines with the 3 helpers, +170 KB. Easy half (13 files, ~2.4k lines) is self-contained on the office floor; the hard half needs C. Main risks: (1) the chat sink (41 lines of speech go nowhere without a host callback), (2) data the host does not have (tenure, CI, release tags, cost) and the "tells more than who and what" rule, (3) Vietnam-centred content. A first slice should skip anything that needs `/api/*`.

---

## C. Outside (backdrops, wing, seasons, rain, weather, the walk down to the street)

### C.1 Files

`world/backdrops/` (36 files, 9,515 lines):

| Group           | Files (lines)                                                                                                                                                                                                                                                                  | What                                                                                                                                                                                                                                                                                                                       |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chooser         | `index.js` 38                                                                                                                                                                                                                                                                  | city / countryside / beach; `THEME`, `THEMES`, `setScene`; `office-scene` in localStorage (port stand-in: plain colour, 31 lines)                                                                                                                                                                                          |
| City            | `city.js` 306, `street-life.js` 1,187, `street-signals.js` 64, `street-wires.js` 76, `street-shade.js` 102, `street-riders.js` 148, `street-spots.js` 76, `street-folk.js` 156                                                                                                 | grid, buildings, traffic (cars, buses, 100 scooters, taxi and ride-hail liveries), crossing signals, power lines, hot-day shade, riders' clothes and loads, people with moving limbs                                                                                                                                       |
| Shops           | `shops.js` 963, `shop-paint.js` 37, and eight chain fronts: `shop-cong` 339, `shop-dmx` 379, `shop-highlands` 285, `shop-katinat` 269, `shop-longchau` 222, `shop-mixue` 263, `shop-phuclong` 274, `shop-tgdd` 277                                                             | walkable convenience stores and painted chain-shop fronts                                                                                                                                                                                                                                                                  |
| Street scenes   | `eat-com` 304, `street-atm` 234, `street-corner` 143, `street-csgt` 738, `street-ev` 287, `street-lunar` 84, `street-morning` 103, `street-nhau` 272, `street-park` 360, `street-photo` 213, `street-pickle` 480, `street-repair` 120, `street-siren` 77, `street-wedding` 254 | rice eatery, bank ATM, motorbike taxi and hammock, traffic-police stop with fines, e-scooter battery swap, votive paper burning on lunar days, breakfast stalls, drinking place, parks (morning exercise, badminton, board game), photo studio, pickleball court, barber and bike repair, ambulance/fire engine, a wedding |
| Other backdrops | `countryside.js` 186, `beach.js` 117, `shared.js` 82                                                                                                                                                                                                                           | rice fields and village; beach                                                                                                                                                                                                                                                                                             |

Also: `world/pro/wing.js` 134 (the HQ plan's wing of four department rooms with door plaques; `DEPT_SIGNS` is called by kept `net/live.js:79`), `life/seasons.js` 234 (Halloween, Christmas, Tết decorations by date; kept `props.js`/`first-person.js` import `seasonProp`, `floorBlocks`), `life/rain.js` 78 (bats/ghost update plus umbrellas and a wet-floor sign; `updateSeason` is called from kept `room-update.js`), `life/weather.js` 90 (real weather: rain lines, clouds dim the sun, lightning, fog).

`interact/first-person.js` (263 lines, kept, hand-changed): upstream's street half is about lines 61-130, 140-151, 170-210: `street()` returns `THEME.live.street` (API: `exits`, `setWalker`, `shop.feel`, `doors`, `spots`), `toStreet`/`toOffice` through the lift with a black fade, pavements and zebras (traffic stops for you), shop doors with opening hours, a basket and till in Vietnamese dong, a sandwich cart. The port's cut is two lines (`const street = () => null;`) so every street branch is dead code but still in the file; restoring it means reverting that one line and having `THEME.live.street` exist.

**Total C: 40 files, 10,051 lines, ~824 KB source, estimated +400 KB bundle before assets.** No further untaken module is imported by them except the stand-ins of A and `ui/activity.js`/`ui/group-chat.js`/`i18n`.

### C.2 Needs from outside themselves

- Modules: all taken ones (`terrace`, `blocks`, `layout`, `windows`, `room-update`, `lights`, `renderer`, `workers`, `icons`...). Untaken stand-ins used: `audio/sfx.js` (A: 10 files play sounds, 2 own audio contexts), `ui/activity.js` (toast), `ui/group-chat.js` (1 call in `street-csgt.js`), `life/weather.js` (read by `street-ev/csgt/life/riders/shade` for temperature and rain), `i18n`. Reverse dependency: kept `string-lights.js` imports `dotTex` from `city.js` (the port's stand-in keeps that one texture), `microwave.js` imports `seen` from `street-folk.js`, `loop.js`/`room-update.js`/`first-person.js` import `THEME`, `setScene`.
- Add-ons: `RoundedBoxGeometry` and `CSS2DRenderer` only (vendored).
- **Binary/media assets** (all under `/tmp/ref-office/my-office/public/assets/`, 792 KB in all, none vendored):
  - `vehicles/cars.json`, 420 KB: Kenney Car Kit 3.1 bodies as base64 geometry (CC0). Without it the Car Kit cars simply do not appear (`street-life.js:413` returns on null), only scooters and the procedural vehicles remain.
  - `brands/` 88 KB: 6 SVG and 2 PNG logos (circle-k, gs25, 7-eleven, ministop, xanh-sm, grab SVGs; bach-hoa-xanh and winmart PNGs). Wikimedia "PD-textlogo"; Grab's from Simple Icons (CC0); `brands/README.md` says "They are still trademarks of their owners".
  - Fonts `src/styles/fonts/*.woff2`, 332 KB, OFL (Be Vietnam Pro, JetBrains Mono, IBM Plex Sans Thai Looped): optional; canvas text falls back to `system-ui`.
  - `assets/thumbs`, `vendor/qrcode.min.js`, `icon-512.png`, `sw.js`: not used by C.
    The code loads them by URL. Embedding means `json`/`dataurl` imports (the current `build-world.mjs` has no `loader` option; esbuild takes `.json` by default but not images) and about +420 KB (cars) and +120 KB (logos as base64) in the single script.
- DOM/CSS: `[data-scene]` buttons (backdrop chooser), settings panel ids `wx-cities`, `wx-now`, `[data-wx]` (weather, `setup()` throws without `wx-cities`), `street-csgt.js`/`street-nhau.js` build cards with classes `csgt-*` (30 classes in `styles/csgt.css`, 60 lines), plus `shop-say`, `pickle-tally` (`labels.css`), `zone`, `z-ico` (places). About 42 classes in 7 stylesheets; the port styles 6 of them.
- Browser APIs: `fetch` (below), `Image`, canvas textures (fine), 2 more `AudioContext`s (A), `localStorage` (`office-scene`, `office-wx`), `visibilitychange` (weather poll). `process.env.NEXT_PUBLIC_BASE_PATH` at `shops.js:40` and `street-life.js:175` (bundle must not contain `process.env`: hand-change needed, so these two files cannot be taken unchanged). `?showroom`, `?debug`, `?without` etc. query flags inert in `srcdoc`.
- Network (quote): `weather.js:27` `https://api.open-meteo.com/v1/forecast?latitude=${c[1]}&longitude=${c[2]}&current=temperature_2m,weather_code,precipitation,cloud_cover&timezone=auto` (every 15 min when a city is chosen; coordinates of one of 8 Vietnamese cities); `street-life.js:177` `fetch(\`${BASE}/assets/vehicles/cars.json\`)`; `shops.js:154-158` `fetch(\`${BASE}/assets/brands/${file}\`)`for the SVG logos and`img.src` for the PNGs. The scene today makes no network call; the weather one would be the first to an external host (and tells Open-Meteo the chosen city and the user's IP).
- Memory/perf: `main.js`'s own header says "the world is most of the page's memory, about 1 GB in a browser against about 0.1 GB without it" (that is upstream's figure for the whole 3D world including street); the city adds about twenty draw calls and instanced traffic (`street-life.js` `COUNT`: 100 scooters, about 65 cars, buses and vans at the busiest). Real risk in a phone WebView.

### C.3 Data and events from the host

- Day or night: the port drives `setNight` from the app's dark theme (`backdrops.applyNight`, `state.nightManual = true`). Upstream's `index.js` uses the clock (`isNightHour()` every second) when not manual. Street scenes read the **clock hour** (breakfast 5:30-8:30, parks by the hour, wedding at the weekend, shops' opening hours, lunar-date offerings, siren every 25-45 min) and `night`. So street life and the theme can disagree (dark theme at noon). A design decision.
- Weather: needs a city (a setting) and a fetch. The host could fetch and pass `{code, temp, cloud, rain}` instead (no network in the scene), or skip weather and keep the street fair-weather.
- Date: `SEASON` is already computed in kept `core/env.js` from the date, and already drives the Christmas hat in `workers.js` and `string-lights.js`; only the decorations in `seasons.js` are missing. `?season=` and the "Seasonal decorations" switch (`office-season`, in settings) are not available.
- People walking the street are the already-kept workers with `w.street`/`w.away` flags, set by B's outings. The sessions/events API needs nothing new for C by itself.
- Outings and first-person walking down depend on `lift` (kept `entrance.js`) and the street graph.

### C.4 Leaks

None from the street code itself. Weather would tell a third party the user's chosen city; `shops` open hours use the device clock.

### C.5 Start-up

Upstream order: `worldBackdropsCity` is 8th (builds only `dotTex` early), `worldProWing` 25th, `lifeSeasons` 69, `lifeRain` 70, `lifeWeather` 71, `worldBackdropsIndex` 117th, just before `coreLoop` (the entry already calls the stand-in's `backdrops.setup()` there, by hand). Per frame: `updateWeather(dt0)`, `THEME.live.update(dt, state.sim)` (the whole street), and `room-update.js` calls `updateSeason`. Timers: `weather.js` 2, `index.js` 1 (`setInterval` 1 s for night). The `city.js` stand-in file is real work: it supplies `dotTex` used indoors.

### C.6 Content for a public port (the most care of the four)

- **Real brands, on shop fronts and vehicles** (names, colours, logos drawn or embedded): Cộng Cà Phê, Điện Máy Xanh, Thế Giới Di Động, Highlands Coffee, Katinat, FPT Long Châu (FPT's tile logo and `#034EA2/#F37021/#51B848`), Mixue (snow king mascot, red front), Phúc Long, Circle K, GS25, 7-Eleven, Ministop, WinMart+, Bách Hóa Xanh; Grab/GrabFood, Xanh SM, VinFast (VF3/VF8, V-Green charging), Vietcombank (ATM in its green with its mark); car makes in comments (Toyota, Hyundai, Honda, Kia, Ford, Mitsubishi; the README says no maker logo is drawn). The eight chain-front files are 2,308 lines, `shops.js` another 963. The upstream README states they are not affiliated and the logos are only shown as part of a street scene. A public port inherits that trademark exposure; the likely options are removing the fronts, genericising names and colours, or keeping them with the same notice.
- **Culturally specific scenes** (neutral descriptions): a traffic-police checkpoint pulling riders over, citing named decrees, with fines in local currency and points off a licence (`street-csgt.js`, 738 lines, 24 Vietnamese lines); a bank's payday ATM queue; votive-paper burning with an offering table on lunar-calendar days; a wedding on weekends (tent, flower arch, bridal car, a Chinese double-happiness character); a drinking place with a hotpot and beer crates; a park with morning exercise, shuttlecock kicking and a Chinese-chess game at a tea stall; breakfast stalls with a sticky-rice pole carrier; barber and tyre repair on the pavement; a Korean-style photo studio ("Chụp ảnh Hàn Quốc" in neon); ninja-style sun-protection suits on riders; power lines; countdown signals; ambulance 115 and fire engine 114 with their local lettering. First-person shopping prices are in dong.
- Text in other languages: 241 non-comment code lines with Vietnamese letters (`shops.js` 45, `street-csgt` 20, `eat-com` 19, the chain fronts 6-18 each), and `en/world.js` 237 lines with 22 Vietnamese lines.
- Licence notes in the files: `street-life.js:50` and `street-siren.js:5` (Kenney Car Kit, CC0), `street-ev.js:12` ("no artwork of V-Green's; the name is its owner's trademark"), `shop-mixue.js:9` and `sfx.js` (Oh! Susanna), `shops.js:10` (logos from Wikimedia Commons, see `brands/README.md`). The weather idea credits another project (MIT) in a comment.

### C.7 Judgement: **large**. About 10.1k lines, ~+400 KB code and +540 KB assets in a single script (the bundle roughly doubles to about 2 MB), the biggest trademark and cultural exposure, a night/clock conflict with the app theme, an external network call, and phone memory. Separable slices with their own risk: seasons+rain (312 lines, no assets, no network; small), wing (134, HQ plan only, needs the plan to exist), weather (90 + host-fed data), backdrops (the rest).

---

## D. Camera extras and languages

### D.1 Files

| File                                  |                          L | What                                                                                                                                                                                                                                                                                                 | Verdict                                                                                       |
| ------------------------------------- | -------------------------: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `ui/camera-bar.js`                    |                         58 | Upstream's toolbar logic (views, zoom, full screen) plus `autoCam()` and `panTo(w)`: the camera glides to a person for 7 s and returns, unless the user moved it in the last 30 s (`office-autocam`). Port's 269-line stand-in has the views, zoom, fullscreen, Walk in and the markup, not autoCam. | small                                                                                         |
| `components/office/CameraToolbar.tsx` |                         25 | markup of the bar; has `btn-lite` (2D list) that the port's `BAR` leaves out                                                                                                                                                                                                                         | n/a                                                                                           |
| `ui/timelapse.js`                     |                        156 | 15 s clip of the office (1080x1080 or 1080x1920), camera orbiting, people at 4x, a clock 8:00-23:00 with dusk at 10 s, title and end card, MediaRecorder + `captureStream`, file `my-office-clip-...mp4/webm`; `clipCamera`/`clipFrame` called by the loop                                           | medium                                                                                        |
| `ui/clip-music.js`                    |                        122 | The clip's original lo-fi track, synthesised into a buffer                                                                                                                                                                                                                                           | small (comes with timelapse)                                                                  |
| `ui/photo.js` (kept, hand-changed)    |                        138 | Photo mode; day/night buttons `[data-ph-time]` (auto/day/night) at line 130 call `setTimeMode`                                                                                                                                                                                                       | stand-in `settings.js` has `setTimeMode` empty; port's photo bar omits the buttons            |
| `ui/tips.js`                          |                        115 | First-visit tour of eight cards (lamp, switch, coffee, printer, cat, bell, a person, Walk in), `office-tips` flag, `?tips`                                                                                                                                                                           | small-medium                                                                                  |
| `ui/lite.js`                          |                        153 | 2D list view of all sessions (rows with branch, cost, last reply, todos), approvals on top, search                                                                                                                                                                                                   | **do not port**: the plugin already has a 2D office and reads fields the scene is never given |
| `ui/settings.js`                      |                        126 | Only `setTimeMode`/`syncTimeBtns`/`syncToggles` matter here; the rest is the settings panel (autocam, sound, weather, language, layout, season toggles)                                                                                                                                              | take the three functions, not the file                                                        |
| `replay/replay.js` + `timeline.js`    |                  164 + 193 | Replay a day from the server's log; per-session timeline                                                                                                                                                                                                                                             | **do not port**: needs `/api/replay`, `/api/timeline`                                         |
| `demo/demo.js` + `demo-log.js`        |                   331 + 17 | Fictional projects and a fictional Mac, `/api/live` poll and an `EventSource('/stream')`                                                                                                                                                                                                             | **do not port**; could only be a dev fixture                                                  |
| `i18n/`                               | 74 + 33 files per language | see D.8                                                                                                                                                                                                                                                                                              |                                                                                               |

Camera-bar, timelapse, clip-music, tips, lite, settings, replay and demo: 1,435 lines in 10 files, 112 KB source, about +55 KB bundle if the first four were taken. Extra files they need: `shared/timeline.js` 97, `shared/burn.js` 71, `core/world-boot.js` 8 (only for replay/lite).

Other camera-related pieces the stand-in leaves out: the `btn-lite` list button; `autoCam`/`panTo` (its only upstream consumer is `ui/permissions.js:119`, which is not taken, so autocam does nothing for the port unless something else calls it: so a caller would have to be chosen, for instance a `wait` event or an incident); top bar's `btn-night` (hidden in the port's page); `setView(null)` on user drags (done by kept `loop.js`).

### D.2 Needs from outside themselves

- Modules: timelapse imports `scene/renderer` (`composer`, `resize`, `renderer`), `world/room-update` (`night`), `people/workers`, `ui/photo` (`paintMark`, `paintNames`), `ui/settings` (stand-in), `ui/activity` (toast stand-in), `clip-music`, `i18n`. tips imports `interact/props` (`PROPS`, `hoverProp`, `setOutline`), `cat`, `workers`, `ui/lite` (stand-in), `ui/settings.togglePop` (**missing from the stand-in**: `togglePop` is needed). camera-bar's `autoCam` needs only `state` and `fp`.
- Add-ons: tips imports `CSS2DRenderer` (vendored). None new.
- Assets: none. Fonts: timelapse draws `"Be Vietnam Pro"`/`"JetBrains Mono"` on a canvas (falls back to system fonts). Music is code.
- DOM/CSS: photo bar needs `ph-clip`, `ph-music`, `[data-clip-shape]`, `[data-ph-time]` (the port's `BAR` has `ph-names`, `ph-mark`, `[data-ph-size]`, `ph-shoot`, `ph-exit` only). Tips: `.tour`, `.tour-next`, `btn-tips` (no button in the port). CSS: `photo.css` 36 lines (clip cover, pb-\*), `tips.css` 21, `lite.css` 68, `replay.css` 25, `timeline.css` 59.
- **Browser APIs that may fail in a frame or WebView**:
  - `MediaRecorder`, `HTMLCanvasElement.captureStream`, `AudioContext.createMediaStreamDestination` (timelapse + clip-music): support differs by engine and WebView (not verified here). The code falls back to picture-only and toasts `ui.clip.unsupported`.
  - Download via `<a download>` and `URL.createObjectURL` (the clip and the photo): fine in a non-sandboxed `srcdoc` iframe on desktop; **not possible in the phone WebView**, so the clip must be hidden when `host.photo === false`, as photo mode is.
  - Fullscreen: already disabled in the WebView.
  - `localStorage`: `office-clip-shape`, `office-clip-music`, `office-tips`, `office-autocam`, `office-lite`.
  - Clip rendering sets the renderer to 1080 px and pixel ratio 1 for 15 s, and runs the world at `state.speed = 4`; memory and heat on a phone.
- Network: tips, timelapse, clip-music: none. replay/timeline: `fetch('/api/timeline?from=..&to=..')`, `fetch('/api/replay?day=..')`; demo: `fetch('/api/live?since=..')` and `new EventSource('/stream?k=..')`.

### D.3 Data and events from the host

- Camera extras need no host data except what to pan to: `panTo(worker)` could be driven by the entry on `wait`, an incident (already known) or `deploy`. Equivalent in API: yes for events (the entry's `event()` sees `fail`, `deploy`, etc.).
- The clip's end card writes the day's counts (`state.stats.prompts/edit/cmd/deploy`), which the entry keeps from events, and the number of people. No extra data.
- Day/night buttons: the port's night is "the app theme". `setTimeMode('auto')` upstream means the clock (`isNightHour`); the stand-in must define what Auto means (the theme) and whether Day/Night override the theme for a photo and restore it afterwards (timelapse also forces day then night and restores).
- tips needs `state.isLocal` (only on the user's own machine; `startTips` auto-starts only when `state.isLocal || asked || STATIC`), which the port does not set.
- Replay/demo: need a server log of everything. Nothing equivalent exists; `use-world-feed.ts` only sends live state.

### D.4 Leaks

- Clip/photo carry names over heads (`paintNames`) and the brand mark; with streamer mode on, names are the generic words, so no file/command/prompt. The end card has counts only.
- Replay and timeline would replay full event text (not suitable under the rule).
- Lite shows `lastReply`, branch, cost: not suitable.

### D.5 Start-up

Upstream positions: `uiLite` 81, `uiCameraBar` 85, `uiSettings` 95, `uiTimelapse` 98, `uiTips` 105, `demoDemo` 114, `replayReplay` 115, `replayTimeline` 116. Per frame (`loop.js`): `updateTips()` (line 193), `clipCamera()` before drawing and `clipFrame()` right after drawing (lines 219 and 222, in the same task as the draw so the drawing buffer is still there), `replayTick`. The port's entry already calls `cameraBar.setup()` itself after the module loop, and `clipCamera`/`clipFrame`/`updateTips` already hit empty stand-ins. Timers: timelapse 1, tips 1, camera-bar 3 (zoom percent every 200 ms).

### D.6 Content

- English only in these files (`ui.clip.*`, `tips.*`). Timelapse names the file `my-office-clip-...` (the port's photo already renamed its file to `office-...`), and the clip's title card reads from `ui.clip.title`. Clip music: "an original lo-fi loop... nothing borrowed (no samples, no files)": its own claim of originality. `lite.js` header: "First idea from agent-office's lite page (MIT)". No brands beyond the Claude/Google/OpenAI marks already vendored.
- Demo content (fictional projects, a pretend Mac) is not a concern but is not useful.

### D.7 Judgement: camera extras **small to medium**. autocam small; day/night buttons small but needs a policy (theme vs clock); tips small-medium (hand-written CSS plus a `togglePop` stub and an `isLocal` rule); clip recording **medium** (MediaRecorder, canvas capture, download are desktop only; fine as `host.photo`-gated). Lite, replay and demo should stay out.

### D.8 Languages (`i18n/`)

| Item                           | Upstream                                                                                                                                                                                                                                                                                                                                               | Port                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locales                        | `en` (3,350 lines, 33 files), `vi` (3,248 lines, 33 files), `th` (3,225 lines, 35 files: `chat-a/b`, `people-a/b` split) under `U/i18n/locales/<lang>/`; 9,823 lines in all; `vi` and `th` fall back to `en` per missing key                                                                                                                           | `en` only, 13 areas of 33 (generated `locales/en/index.js`), 77 KB; `vi`/`th` are in `DENY`                                                                                |
| Lookup                         | `t(key, vars, as)` dotted path into the dict; `{name}` slots; `{one, other}` plurals via `Intl.PluralRules(locale)` picked by `vars.n`; arrays pick a random line, `as:'list'` returns the array; function values `(vars, t) => string`; `{mac}`/`{Mac}` → "Mac"/"PC"/"computer" from `<html data-os>`; `num()`, `lang()`, `locale()`; `createT(lang)` | same signatures; adds `OURS` (41 Paseo-worded keys, English only), emoji stripped from every line, `{mac}` → "host", `lang()` always `'en'`, `createT` returns the one `t` |
| Language choice                | server pref (`data/prefs.json`) sent as `<html lang>` and an `x-office-lang` header to React server components (`i18n/server.ts`); picked in Settings (`LANGS` list `en/vi/th`, native names); demo reloads on `?lang`                                                                                                                                 | none; the host would have to tell the scene (no field in `WorldStartOptions`; plugin client has `translations.locale`)                                                     |
| Code that branches on language | `people/karaoke.js` (`lang() === 'vi'` picks lyrics; `karaoke-songs.js` has Vietnamese and English words for each song, written for the office), timestamps via `toLocaleDateString(locale())` in several kept UI files, `ui/task-sheet.js` speech recognition (not taken)                                                                             | kept modules call `locale()` → `en-US`                                                                                                                                     |
| Fonts                          | Thai needs IBM Plex Sans Thai Looped (4 woff2), Vietnamese needs Be Vietnam Pro vietnamese subset                                                                                                                                                                                                                                                      | none shipped; system fonts cover both on most devices                                                                                                                      |
| Tests                          | `tests/unit/i18n.test.mjs` (key parity) upstream                                                                                                                                                                                                                                                                                                       | none                                                                                                                                                                       |

Porting `vi`/`th` means: add them to `LANGS`, take 3,248 + 3,225 lines (about 513 KB of UTF-8 source for the two, perhaps +250 KB in the bundle if both are bundled: better for the host to send only the chosen dictionary), drop the `DENY` entry, make the stand-in's `OURS`/emoji rules per language (or translate the 41 `OURS` keys), pass the language through the API, and decide who translates the Paseo-only strings. `en` is the reference and the others have gaps (their line counts are 3% and 4% lower).

### D.9 Judgement for languages: **medium**. Mechanically small (the lookup is 74 lines) but 6,473 lines of translated strings, hand-written plumbing in the stand-in, and a design decision about who owns translations for Paseo's additions. Risk: the `vi` locale is the most Vietnam-specific text in the project (see B.6, C.6) and would ship in the Paseo bundle; and `th` is untested here.

---

## Dependencies between the groups, and a possible order

| Edge                         | Evidence                                                                                                                                                                                                                                          |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B -> A                       | 11 of 21 B files import `sfx` (accountant, drill, duty, farewell, guard, hr, interns, lift-service, outings, post, staff)                                                                                                                         |
| C -> A                       | 10 backdrop/weather files play sounds; `street-nhau`, `street-csgt` make their own audio                                                                                                                                                          |
| B -> C                       | `outings`, `guard` import `backdrops/index`, `weather`, `street-folk`; `staff` imports `rain` (seasons); `comtrua`, `nhau`, `photobooth`, `pickle` (and the street half of `drill`) act in places `street-*.js` draw and call `THEME.live.street` |
| D -> A                       | `ui/settings.js` imports `sfx` (the sound switch); `clip-music` is D's own audio                                                                                                                                                                  |
| D -> C                       | `settings.js` imports `backdrops/index` (scene chooser); `setTimeMode` calls `setNight`, tied to the theme code in C's stand-in                                                                                                                   |
| D -> B                       | `demo.js` imports `farewell`, `lift-service` (demo only)                                                                                                                                                                                          |
| first-person street -> C     | the cut is one line, but needs `THEME.live.street`                                                                                                                                                                                                |
| everything -> host additions | chat sink (B), language (D), mute (A), weather feed (C), tenure/CI/release/cost (B)                                                                                                                                                               |

No edge goes from A to anything, nor from C to B or D. Suggested order: **A first** (small, unblocks the sound of every kept module and removes the "silent" dependency of B, C, D); then **D's camera extras** (autocam, day/night, clip; independent of B and C except the theme/night rule) and the **office-floor half of B** in parallel; then **seasons + rain** (the one part of C with no assets or network), which also unblocks `staff.js`; then the **street (C) with the street half of B and first-person's walk down**, last, with the trademark decision made before starting; **languages** can be done at any time after the API gets a language field, but are best after B and C so only the strings that ship are translated.

## How the import tool would take these files

- `import-upstream.mjs` takes the modules reached from `main.js`'s list that are not in `DENY`, follows imports, and writes them with `three` imports rewritten. So removing a path from `DENY` takes the file and, via imports, everything it needs that is not itself denied (B pulls `payday.js`, `evswap.js`, `shared/comnha.js`; D pulls `shared/timeline.js`, `shared/burn.js`, `core/world-boot.js` through replay/lite; A, C pull nothing extra).
- **Deleting the stand-in is required.** `put()` never overwrites an existing file whose text contains `PASEO:`; a stand-in (`// PASEO: stand-in ...`) would stay and only be listed under "kept". So: remove the regex (or add the file to the `(?!...)` allow-list in the first `ui/` rule), delete the stand-in file, run the tool.
- What else the tool checks: it throws on a taken file that imports a bare specifier other than `three`/`three/addons/...`, or a missing upstream file; it reports `missingStandIns` (each remaining stand-in must export every name any taken file imports from it, for example `togglePop` from `ui/settings.js` once `tips.js` is taken, `chatSay`/`chatLife` stay), and reports "kept local" files (those with a `PASEO:` note) for a hand merge. It regenerates `paseo-modules.js` (`MODULES` order), `i18n/locales/en/index.js` (areas named by the taken text: `tips`, `replay`, `timeline`, `demo`, `lite` would be added with D), and `MANIFEST.json` (`standIns` shrinks). It never writes `i18n/index.js`, `paseo-*.js` or hand-written stand-ins.
- It does not copy CSS, images, JSON or fonts, does not remove `process.env` (the world test does), and does not touch the page markup. Code that fetches assets by URL needs a hand change (`PASEO:` note) and then is kept local forever: `shops.js`, `street-life.js` (process.env and fetch), `settings.js` (`process.env.NEXT_PUBLIC_SITE_ROOT`, if taken), `weather.js` (fetch), `outings.js`, `farewell.js`, `interns.js` (fetch of `/api/*`). Each such file is then a hand-merge on every upstream bump, which is the main long-term cost of C and B.
- Hand-wired parts of `paseo-entry.js` that must change as a path leaves `DENY`: `lifeIncidents`/`audioSfx` are not in `MODULES` today and are set up by hand at `coreLoop` (`if (name === 'coreLoop') { lifeIncidents.setup(); audioSfx.setup(); }`); `backdrops.setup()` likewise; `cameraBar.setup()` after the loop; `everyFrame(updateLeisure)` from the `nap.js` stand-in; `whiteboard.setup()`. Taking `sfx.js` or `backdrops/index.js` puts them in `MODULES` and they would run twice. `life/incidents.js` stays a hand-trimmed stand-in in any case (the entry rings it).
- Tests to touch: `server/world-script.test.ts` (size cap 1,000,000-1,200,000, no `process.env`, no `mixue`, the `const street = () => null;` assertion), `client/world/entry.test.ts` (mocks every upstream module by name), `camera-bar.test.ts`, `first-person.test.ts`, `photo.test.ts`.
- Docs to update: `vendor/SOURCES.md` ("What is not taken", the stand-in table), the `DENY` comment in the tool.

## Summary of sizes

|                      |                  Files |                         Lines |          Source |                      Est. bundle | New assets                                             | New add-ons | Size                                      | Main risk                                                      |
| -------------------- | ---------------------: | ----------------------------: | --------------: | -------------------------------: | ------------------------------------------------------ | ----------- | ----------------------------------------- | -------------------------------------------------------------- |
| A Sounds             |                      1 |                            75 |            6 KB |                            +3 KB | none (synthesised)                                     | none        | small                                     | autoplay / WebView audio, mute switch                          |
| B Staff & daily life |        21 (+3 helpers) |                  4,968 (+346) |          343 KB |                          +170 KB | none                                                   | none        | medium-large                              | chat sink, host data, Vietnam-centred text, half needs C       |
| C Outside            |     40 (+first-person) |                        10,051 |          824 KB |          +400 KB + 540 KB assets | cars.json 420 KB, 8 logos 88 KB, optional fonts 332 KB | none        | large                                     | trademarks, cultural scenes, weather fetch, memory, bundle cap |
| D Camera & languages | 10 (+3 helpers) + i18n | 1,435 (+176) + 6,473 (vi, th) | 112 KB + 513 KB | +55 KB (+~250 KB both languages) | none                                                   | none        | small-medium (camera), medium (languages) | clip recording and download not in WebView; language plumbing  |
