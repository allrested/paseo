# paseo-office piece 8: the street Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 3D office can show my-office's walkable street outside (generic shops, signs and vehicles, no real brand), with the six staff scenes that happen there, behind a device setting "The street outside" that is off by default on a phone.

**Architecture:** The street's code is taken from my-office by the import tool, then a repeatable script (`scripts/genericise-street.mjs`) swaps every real name for a made-up one and the port's own drawn signs replace the logo images. The code is always in the one embedded bundle but builds nothing until the setting is on. The one asset, the CC0 car models (430 KB), is not in the bundle: the build turns it into a generated server module and a new RPC sends it to a device that turned the street on, which passes it to the scene in `start()`.

**Tech Stack:** Plain JavaScript in `vendor/my-office/` (three.js r160, canvas textures), Node scripts with `node:test`, TypeScript and React Native in the plugin (`/workspace/QFlavours/paseo-office`), `@getpaseo/plugin` 0.16.2, Vitest with jsdom, esbuild.

**Spec:** `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-paseo-office-roadmap-design.md` (piece 8, "8. The street"), with the survey `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-my-office-survey.md` (section C). Version tag: v0.9.0.

## What was read, and what it shows

- Upstream `world/backdrops/` has 36 files and 9,515 lines. In the clone at `/tmp/ref-office/my-office` the street is: `city.js` (builds the grid, buildings and calls `buildStreetLife`, `buildShops`, `pickleSite`), `street-life.js` (traffic, riders, liveries), `shops.js` (963 lines: twelve shop fronts per city set, the walk-in store interiors, the sign printing), `street-folk.js`, `street-*.js` (the scenes), `eat-com.js`, `shop-paint.js`, and eight chain modules `shop-{cong,dmx,highlands,katinat,longchau,mixue,phuclong,tgdd}.js` (2,308 lines). `index.js` chooses city, countryside or beach; `countryside.js`, `beach.js` and `shared.js` are used by nothing else.
- **The chain modules draw the real logos by hand** ("measured off the chain's sign" in `shop-dmx.js`; a runner mark, a figure in a ring, an oval emblem, three slanted tiles, a wordmark, a snowman mascot with a crown). Upstream's comments call this "not the chain's artwork". The owner's rule is no real name, logo or tune. So these eight files are not taken at all.
- `shops.js` is the only importer of them (lines 26-33). Its `CHAINS` table holds the six convenience-store chains (plain data, built by `fitOut`, `storeFront` and `sign`) and, for the other eight, `{ ...MODULE.chain, custom: 'key' }` or `parlour: true`. Every other `custom`/`parlour` branch (lines 332-338, 511-512, 574-611, 656-658, 719-720, 780, 879) is reached only through those flags. With the eight made plain entries, the six chains' code path serves all twelve places.
- `outings.js` addresses shops by key (`'highlands'` for the morning coffee, `'tgdd'` for the upgrade trip, `'katinat'`, `'phuclong'`, `'cong'`, `'mixue'`, `'longchau'`), so the keys must stay in `CHAINS` and in the `hcm` set, under made-up names.
- `wx.city` is always `''` after piece 7, so `cityKey()` in `shops.js` is `'hcm'`: only the `hcm` set is ever built. `wx` keeps `temp: null`, `rain: 0`, `cloud: 0`, `code: null`; every reader tests `wx.rain < 0.05`, `wx.code == null` or `wx.temp != null`, so a weather that is Off needs nothing from this piece.
- **Brand seams.** All logo images go through one function, `brandImage(file, redraw)` in `shops.js`, which fetches `${BASE}/assets/brands/<file>` and returns an `Image` (or null until loaded). Callers read `img.naturalWidth`/`naturalHeight` and `drawImage(img, ...)`: `logo()` in `shops.js` and `decalCanvas()` in `street-life.js` (the ride-hailing logos on jackets, helmets, a delivery box and taxi doors; it fills them white with `source-in`). A canvas with `naturalWidth` and `naturalHeight` properties satisfies every caller. Other real names: `street-atm.js` (a bank's name three times and a V-that-is-a-heart mark, `vheart`), `street-ev.js` (a car maker's and a charging network's names, no artwork), `street-life.js` (maker and model names in comments, `vf3`, `vf8`, `xsm` keys), `street-wedding.js`, `eat-com.js`, `street-nhau.js`, `street-park.js`, `street-signals.js`, `people/outings.js` (122 hits: names in data and comments), `people/nhau.js`, `people/comtrua.js`, `people/payday.js`. The English locale areas `world`, `people`, `ui`, `life`, `fp` (already in the bundle as dead text) hold names too: the built bundle today contains "Mixue" 3, "7-Eleven" 5, "Grab" 5, "Xanh SM" 4, "Shopee" 6, "Panadol" 1, "TikTok" 1 (counted with `String.split` on `server/world.generated.ts`). The current test only refuses lowercase `mixue`.
- **Network and environment.** `process.env.NEXT_PUBLIC_BASE_PATH` at `shops.js:40` and `street-life.js:175`; `fetch(.../cars.json)` at `street-life.js:177`, `fetch(.../brands/..)` and `img.src` in `brandImage`; `fetch('/api/claude-version')` at `outings.js:551`; `localStorage` `office-scene` (upstream `index.js`) and `office-claude-version`. `index.js` also touches `[data-scene]` buttons and a 1-second clock timer.
- **Page markup and CSS.** `street-csgt.js` and `street-nhau.js` build a card and a chip and append the card to `$('stage-wrap')` (the port's page has that id); the street needs the classes `csgt-*`, `nhau-*`, `shop-say`, `pickle-tally`, `pickle-say`, `atm-say`, `ev-say`, `csgt-say`, `nhau-say`, `zone`, `z-live`, `z-ico`. The port's `paseo-style.js` has `.tag` and `.zone`; it has none of the others. Upstream's rules are in `src/styles/csgt.css` (60 lines) and `labels.css` lines 10-15.
- **Hooks already there.** `core/loop.js` calls `THEME.live.update(dt, state.sim)` and the `update*` of the staff scenes; `world/room-update.js` `setNight` reads `THEME.wins`, `THEME.sky`, `THEME.fog` and calls `t.live.night(on)` for every theme with a `live`; `interact/first-person.js` carries one hand change, `const street = () => null;` (upstream: `(THEMES && THEME === THEMES.city && THEME.live?.street) || null`); `paseo-leisure.js` already skips anyone with `w.outing` or `w.street`; `people/workers.js` has `streetHooks`. `paseo-entry.js` calls the stand-in `backdrops.setup()` just before `coreLoop`.
- Stand-ins in the port today that this piece deletes (their upstream files are taken): `people/outings.js`, `people/guard.js`, `world/backdrops/city.js` (exports `dotTex`, which upstream's `city.js` also exports and `world/props/string-lights.js` imports), `world/backdrops/street-folk.js` (exports `seen`; used by `world/props/microwave.js`). Present from other pieces and so not this piece's: `world/pro/wing.js` (piece 6), `life/weather.js` (piece 7). `world/backdrops/index.js` stays a stand-in.
- A dry run of the import tool on a scratch copy (tool's `DENY` narrowed as in Task 2, the four stand-ins above deleted, and the staff and seasons paths opened as pieces 5 and 7 leave them) reported `stand-ins to write or extend:` the eight chain modules (names `CONG`, `DMX`, `HIGHLANDS`, `KATINAT`, `LONGCHAU`, `PHUCLONG`, `TGDD`, and `RM, drawMixue, fitMixue, snowDancer, snowKing`) and, from piece 5, `office/ui/group-chat.js: chatPhoto`. Nothing else was missing. The tool does not check the exports of kept-local files such as `core/env.js`; esbuild does, at build time.
- The bundle test today: `1_000_000 < length < 1_200_000`, no `process.env`, no `mixue`, `first-person.js` has `const street = () => null;` after a `// PASEO:` line.

## Decisions

1. **The setting is a field of `office-device`: `street: z.boolean().optional()`, no version bump.** An absent value means the device's default: off on a phone (`layout.platform !== "web"` or `layout.compact`), on elsewhere. _Why:_ "off by default on a phone and on elsewhere" needs to tell unset from false; piece 2 added `sound` the same way. _Cost if wrong:_ a stale client that saves the document whole drops the field and the device falls back to its default.
2. **One bundle, street code always in, nothing built until it is on.** The scene builds the city in `setup()` only when `host.street` is true. _Why:_ a second script would duplicate three.js; the code is about 400 KB of source, a parse cost, and the memory cost is in what is built. _Cost if wrong:_ every device parses the street's code. If the look shows a phone is slow to start with the street off, a lazy `import()` is a later piece.
3. **The cars are not in the bundle.** `build-world.mjs` writes `server/street-kit.generated.ts` (the JSON as one string), the server sends it over `office.world.street`, the client loads it only when the street is on, and passes it as the start option `street: { kit: string }`. _Why:_ the roadmap's "built ahead and embedded" is kept (it is embedded in the server), and a device with the street off never downloads 430 KB. Piece 9's words follow the same method. _Cost if wrong:_ one more RPC and generated file. If the kit fails to load, the scene starts with the street off and the floor's note says so (no `onProblem`, which would drop the 3D view).
4. **The eight chain modules and `countryside.js`, `beach.js` and `shared.js` are not taken.** The eight stay in `DENY`; `shops.js` is hand-changed so its twelve places are the six plain chains plus eight plain entries, and the import tool is taught a `DROPPED` list so it does not ask for stand-ins of files a hand change no longer imports. _Why:_ the modules draw real logos and a mascot; the roadmap says the logos are not taken and shops carry plain signs drawn by the port. _Cost if wrong:_ the cafés, the phone shop, the pharmacy and the ice-cream shop look like the convenience stores in the walk-in rooms (fridges and aisles), and upstream's nicer interiors are lost. It is the largest gap between "my-office's street" and this one, and the owner is told so in the README.
5. **Every other real name is swapped by one script from one table.** `scripts/street-brands.mjs` holds `BRANDS` (real name, made-up name, the code keys); `scripts/genericise-street.mjs` rewrites the street's files, the staff files that name shops, and the English locale areas, adds a `// PASEO:` header line, and `--check` fails while any name is left. Piece 9 reads the same table for its other languages. _Why:_ a table is checked, repeated at each upstream update and reviewed in one place; hand edits of 218 hits in one file are not. _Cost if wrong:_ at an update the files are deleted, the tool run and the script run again; any hit the table misses is found by the bundle test, not by eye.
6. **Keys are renamed too** (`gs25`, `circlek`, `mixue`, `tgdd`, `dmx`, `bhx`, `winmart`, `highlands`, `katinat`, `phuclong`, `longchau`, `cong`, `seven`, and the vehicle and livery keys `xsm`, `vf3`, `vf8`). _Why:_ a key is a string in the shipped bundle, and the rule is that no real name ships. _Cost if wrong:_ a rename in a shared word breaks a scene; `seven` and `cong` are English or Vietnamese words too, so they are replaced only as a whole quoted string or an object key, and a test holds the cases.
7. **Signs are drawn by the port: `paseo-signs.js` returns a canvas wordmark for a made-up name in the shop's own colours, with `naturalWidth` and `naturalHeight` set.** `brandImage(file, redraw)` in `shops.js` becomes `signImage(file)`. _Why:_ it is the one seam all logo callers use, and the callers need no other change. _Cost if wrong:_ the signs are plain text on a colour; they have no artwork, which is the owner's wish.
8. **Day and night: the app's theme decides how it looks, the device's clock decides what happens.** `applyNight(host.night)` sets night for the floor and for the street (`THEME.live.night`), as piece 4's Photo mode and the floor already do; shops' hours, breakfast stalls, parks, the wedding, the siren and the staff scenes read `officeNow()`. _Why:_ one source for light means the street and the floor never disagree about it; the roadmap asks for a decision, and the clock is what the scenes were written against. _Cost if wrong:_ a dark theme at noon shows a lit-up street with the shops open and people in the park. If the owner dislikes that in the look, the fix is `host.night` from the clock while the street is on, in `applyNight` alone.
9. **The street's sounds follow `sfx.on`.** `street-siren.js`'s and `street-ev.js`'s audio is whatever `sfx.play` does; the two street files that make their own `AudioContext` are read in Task 2, step 9, and given the `sfx.on` test karaoke has if they lack it (piece 2 decision 14). _Cost if wrong:_ a street scene sounds with Sound off.
10. **`street-csgt.js` (the traffic stop and its paper form) is taken unchanged apart from names.** _Why:_ the roadmap takes the scenes that happen on the street, and upstream's card carries its own "this is a mock" line (`world.csgt.mock`). _Cost if wrong:_ a state's form imitated in a public repo; if the owner objects in the look, the file goes back into `DENY` with a stand-in whose `buildCsgt` returns nothing.
11. **`/api/claude-version` is answered by the host.** `outings.js`'s `lookForUpgrade` is hand-changed to read `host.claudeVersion?.()` (an object `{ version, at }` or null) and does nothing when absent. _Why:_ the roadmap's piece 5 names the two answers; if piece 5 gave the scene a different name for it, Task 3 uses that name. _Cost if wrong:_ the upgrade trip to the phone shop never happens.
12. **The bundle's size window becomes measured.** After the first build the window is set to the measured size minus 10% and plus 10%; the cap exists to catch a large module coming back. _Cost if wrong:_ a reviewer reads one number.

## Assumes from earlier pieces

- **Piece 2 (sounds):** `audio/sfx.js` is upstream's, exports `sfx` with `on`; piece 2 added `sound` to `officeDeviceSettings`, `client/use-sound.ts`, the `setSound` method and `onSound` callback, and every saver of `office-device` keeps the whole document. Task 6 copies that hook's shape and the savers' rule.
- **Piece 3 (floor plans):** the 3D view restarts the scene when the plan changes (a dependency of the frame effect in `client/world/world-view.tsx` and a `key` on the frame in `client/world/world-view-native.tsx`); `PLAN` in `use-world-feed.ts` is a setting. Task 6 adds the street to the same dependency and key. `host.plan` is `'pro'` or `'cozy'`.
- **Piece 4 (camera extras):** `ui/camera-bar.js` is a stand-in still; the automatic camera's views reach the street (`core/loop.js` keeps the camera over the office). Nothing from it is edited here.
- **Piece 5 (staff and daily life, indoors):** `comnha.js`, `photostrips.js`, `life/*` helpers and `ui/group-chat.js` (with `chatPhoto`) are taken or extended; the chat sink works; the plugin gives the scene `s.git.ci` and a release event with a tag (pickle and photobooth read them); `people/staff.js` is taken. `people/payday.js` and `people/evswap.js` are imported by `outings.js` and are not in the six; this piece takes them too (they are tied to `street-atm.js` and `street-ev.js`). `evswap.js` reads a battery from `macSnap()`; the host has none, so it does nothing (as roadmap piece 5 says of a battery). The scene API's host reading for `/api/claude-version` is named in decision 11; Task 3 step 6 finds it by `grep -rn "claude-version" vendor server client shared`.
- **Piece 6 (headquarters):** `hq` is offered; `world/pro/wing.js` is taken; `street-life.js`, `shops.js` and `city.js` read `HQ` for the longer building and are taken with those branches intact. Piece 6 deliberately left them alone.
- **Piece 7 (weather):** `life/weather.js` is upstream's trimmed by hand: it exports `wx` with the fields above, `city` always `''`. `life/seasons.js` and `rain.js` are upstream's. The street's readers of `wx` are this piece's and are taken unchanged.
- **Piece 9 (languages) comes after:** it reads `scripts/street-brands.mjs` (`BRANDS`) for its names and mirrors the kit's RPC for words. Task 5 names the RPC `office.world.street` with input `{}`; piece 9's `office.world.words` stays separate.
- The repo state read: `vendor/my-office/src/office/world/backdrops/` holds only the three stand-ins; `import-upstream.mjs` has `DENY` with `^office\/world\/backdrops\/` and the people paths; `server/world-script.test.ts` has the checks listed above.

## Global Constraints

- Work in `/workspace/QFlavours/paseo-office` on a branch `feat/street` cut from `main`. The repo is public: nothing private in files, fixtures or commit messages; no real brand's name, logo or tune anywhere (the table in `scripts/street-brands.mjs` is the one place real names are written, as the list the check reads; commit messages say "a chain" and "a bank"); no AI attribution on commits; never push, never `gh` (the controller publishes).
- My-office's author's asks: the MIT licence and notice stay (the banner comes from `vendor/my-office/LICENSE`); files are taken unchanged wherever they can be; every change by hand starts with `// PASEO:` and is listed in `vendor/SOURCES.md`; the README links to https://github.com/khanh020905/my-office. The CC0 car pack is credited in the README ("Kenney's Car Kit, CC0") although CC0 does not ask.
- The scene never receives a file name, a command or a prompt. This piece adds to what it is told: the street switch and the car models. The scene makes no network call: `fetch` of cars and logos is removed, not redirected.
- App-side code (`client/`, `shared/`, `server/`) uses nothing a phone's engine lacks: `client/engine-compat.test.ts` stays green (no `toSorted`, `toReversed`, `findLast`, two-argument `.with(`, Set algebra).
- Cross-platform: no `onPointerEnter`/`onPointerLeave`; DOM only in the page's script or `*.web.ts`.
- Stock Paseo 0.16: only calls its SDK has (`useSettings`, `useRpc`, `defineRpc`).
- Styles of the plugin's own screens in `client/styles.ts`, never inline objects; the scene's in `paseo-style.js`. `OfficeSurface` stays under the lint complexity limit of 20.
- Vendored files are not formatted or linted (`vendor/**`); scripts and app code are: run `npm run format` on new `.mjs`, `.ts`, `.tsx`.
- Run `npm run build:world` after any change under `vendor/`, and commit the generated files with it.
- Never run a bare `paseo` command and never start, stop or restart the daemon on port 6767. A throwaway daemon uses `PASEO_HOME=/tmp/office-stock-home`, port 6798, `env -i`, and the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`.
- Checks after each task: `npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts`, the test files touched, and the whole suite (`npm test -- --maxWorkers=4`, output to a file under /tmp) before each commit.
- The import tool needs a my-office checkout at `b68228871fe30cd2c759a2c919337a9a9d1f5644` (`/tmp/ref-office/my-office`) and three.js 0.160.0 (`/tmp/ref-office/three/node_modules/three`; if missing, `node scripts/three-version.mjs /tmp/ref-office/my-office` prints the version to `npm install` in an empty directory).

---

### Task 1: The names: one table, one script that swaps them, one check

**Files:**

- Create: `scripts/street-brands.mjs`, `scripts/genericise-street.mjs`
- Test: `scripts/genericise-street.test.mjs`

**Interfaces:**

- Consumes: nothing.
- Produces: `BRANDS` (array of `{ real: string, madeUp: string, keys?: { from: string, to: string }[] }`, longest `real` first), `REAL_NAMES` (every string `check` looks for, case-insensitive), `swap(text): string` (pure), `leftIn(text): string[]` (the real names still in `text`), and the CLI `node scripts/genericise-street.mjs [--check] [--files <glob-free list>]`. Piece 9 and Task 3's bundle test import `BRANDS`/`REAL_NAMES`.

- [ ] **Step 1: Write the table**

Create `scripts/street-brands.mjs`. The names below are the made-up ones (a made-up name must not be a real shop's: each was checked against the list of this repo's chains only; the owner reads them in the look):

```js
// The real names the street and its text carry, and what they become. This file is the one place
// a real name is written in this repository: it is the list the check refuses. Keys are the
// identifiers upstream's code uses for a shop or a livery (strings in the bundle too).
export const BRANDS = [
  { real: "Thế Giới Di Động", madeUp: "Handset Hub", keys: [{ from: "tgdd", to: "handset" }] },
  { real: "Điện Máy Xanh", madeUp: "Sky Electric", keys: [{ from: "dmx", to: "skyelectric" }] },
  { real: "Bách Hóa Xanh", madeUp: "Green Basket", keys: [{ from: "bhx", to: "basket" }] },
  {
    real: "Highlands Coffee",
    madeUp: "Hilltop Coffee",
    keys: [{ from: "highlands", to: "hilltop" }],
  },
  {
    real: "Cộng Cà Phê",
    madeUp: "Olive Cafe",
    keys: [{ from: "cong", to: "olivecafe", quotedOnly: true }],
  },
  { real: "Phúc Long", madeUp: "Jade Tea House", keys: [{ from: "phuclong", to: "jadetea" }] },
  { real: "Long Châu", madeUp: "Harbor Pharmacy", keys: [{ from: "longchau", to: "harbor" }] },
  { real: "Katinat", madeUp: "Navy Coffee House", keys: [{ from: "katinat", to: "navycafe" }] },
  {
    real: "Circle K",
    madeUp: "Corner Kiosk",
    keys: [
      { from: "circlek", to: "kiosk" },
      { from: "circle-k", to: "kiosk" },
    ],
  },
  { real: "GS25", madeUp: "Mart 24", keys: [{ from: "gs25", to: "mart24" }] },
  {
    real: "7-Eleven",
    madeUp: "Daily Stop",
    keys: [
      { from: "seven", to: "dailystop", quotedOnly: true },
      { from: "7-eleven", to: "dailystop" },
    ],
  },
  { real: "Ministop", madeUp: "Minute Mart", keys: [{ from: "ministop", to: "minutemart" }] },
  { real: "WinMart+", madeUp: "Greenway Market", keys: [{ from: "winmart", to: "greenway" }] },
  { real: "Mixue", madeUp: "Frosty Cone", keys: [{ from: "mixue", to: "frosty" }] },
  { real: "GrabFood", madeUp: "Ridely Food" },
  { real: "GrabBike", madeUp: "Ridely Bike" },
  { real: "Grab", madeUp: "Ridely", keys: [{ from: "grab", to: "ridely" }] },
  {
    real: "Xanh SM",
    madeUp: "Aqua Ride",
    keys: [
      { from: "xsm", to: "aqua" },
      { from: "xanh-sm", to: "aqua" },
    ],
  },
  { real: "V-Green", madeUp: "EcoVolt" },
  {
    real: "VinFast",
    madeUp: "Volta",
    keys: [
      { from: "vf3", to: "vt3" },
      { from: "vf8", to: "vt8" },
    ],
  },
  { real: "Vietcombank", madeUp: "Metro Bank" },
  { real: "Shopee", madeUp: "Shoply" },
  { real: "Panadol", madeUp: "Painaway" },
  { real: "TikTok", madeUp: "ClipClap" },
  { real: "Toyota", madeUp: "Tokai" },
  { real: "Hyundai", madeUp: "Haneul" },
  { real: "Honda", madeUp: "Hakone" },
  { real: "Mitsubishi", madeUp: "Misaki" },
  { real: "Kia", madeUp: "Karo" },
  { real: "Ford", madeUp: "Forge" },
  { real: "Vios", madeUp: "Velo" },
  { real: "Fortuner", madeUp: "Forterra" },
  { real: "Xpander", madeUp: "Xplora" },
];

/** Every string the check looks for, lower case. Keys count only where they are a whole identifier. */
export const REAL_NAMES = BRANDS.map((brand) => brand.real.toLowerCase());
/** Real keys that are also ordinary words: replaced and checked only as a whole quoted string or an object key. */
export const WORD_KEYS = new Set(["seven", "cong"]);
```

- [ ] **Step 2: Write the failing tests**

Create `scripts/genericise-street.test.mjs` with these cases (all in `describe("genericise-street")`), each asserting `swap(input)` equals the expected text:

1. Display name: `'name: \'Circle K\''` becomes `'name: \'Corner Kiosk\''`; `"GrabFood"` becomes `"Ridely Food"` (longest first: `Grab` must not turn it into `Ridely Food` twice or into `RidelyFood`).
2. A key as a quoted string and as an object key: `circlek: { name: 'x' }` and `CHAINS['gs25']` and `"mixue"` become `kiosk: ...`, `CHAINS['mart24']`, `"frosty"`; a template `` `shop-mixue.js` `` is not touched (`shop-` prefix: a path, never swapped; the files are not taken).
3. Words: `'seven'` becomes `'dailystop'` and `seven:` at the start of an entry becomes `dailystop:`, but `const seven = 7;`, `sevenfold` and `'Seven days'` are unchanged; `'cong'` becomes `'olivecafe'`, but `congDay` and `'congWeekend'` are unchanged.
4. A file name stem: `'xanh-sm.svg'` becomes `'aqua.svg'`; `'circle-k.svg'` becomes `'kiosk.svg'`.
5. Vietnamese forms: `'Cộng Cà Phê'` becomes `'Olive Cafe'`; `'Bách Hóa Xanh'` becomes `'Green Basket'`.
6. `swap` is idempotent: `swap(swap(x)) === swap(x)` for every case above.
7. `leftIn("a Mixue and a toyota")` returns `["mixue", "toyota"]` (case-insensitive, in table order); `leftIn(swap(text))` is `[]` for text that holds one of every `real` in the table (build the text from `BRANDS`).
8. A CLI test with `spawnSync("node", [SCRIPT, "--check", "--files", dir/a.js])` on a temp file that holds a name: exit status 1 and stderr names the file; on a clean file, status 0.

- [ ] **Step 3: Run it and see it fail**

Run: `node --test scripts/genericise-street.test.mjs`. Expected: every test fails with `Cannot find module './genericise-street.mjs'`.

- [ ] **Step 4: Write the script**

Create `scripts/genericise-street.mjs`. Behaviour, in full:

- `swap(text)`: for each brand, longest `real` first, replace every occurrence of `real` (a plain string, case-sensitive, global) with `madeUp`; also replace the real name written upper case (`GS25`, `MIXUE`) by the made-up name upper-cased. Then for each key `{from,to,quotedOnly}`: unless the key is in `WORD_KEYS` or `quotedOnly`, replace `from` where the character before is not a letter, digit, `-` or `/` and the one after is not a letter, digit or `-` (so `shop-mixue.js` and `mixue.svg`'s path stem is handled by the file-name rule instead: a key followed by `.svg` or `.png` is replaced when the key stands after a quote or `/`). For a `quotedOnly` key replace only `(['"\`])from\1`and`(^|[{,\s])from(\s\*:)`.
- `leftIn(text)`: the entries of `REAL_NAMES` found in `text.toLowerCase()`, in table order.
- Files it works on, relative to the repository root: `vendor/my-office/src/office/world/backdrops/*.js`, `vendor/my-office/src/office/people/{outings,comtrua,guard,nhau,photobooth,pickle,payday,evswap,staff}.js` (those that exist), `vendor/my-office/src/i18n/locales/en/*.js`, and with `--files` only the listed paths. `paseo-signs.js` and `index.js` of the backdrops are Paseo's own and are skipped by name.
- Writing: when `swap(text) !== text`, write it, and if the file does not already contain `PASEO: names` add as the first line `// PASEO: names of real shops, vehicles and banks are made-up ones (scripts/genericise-street.mjs).` (inside a block-comment-free first line; every file starts with `//` or `import`, so this is safe).
- `--check`: write nothing; print each file with its `leftIn` result to stderr and exit 1 if any is non-empty, 0 otherwise. Without `--check` it writes, then runs the same check on the result and exits with its status.
- Do not read `scripts/street-brands.mjs` itself (it is the list).

Run `npm run format` on both new `.mjs` files.

- [ ] **Step 5: Run it and see it pass**

Run: `node --test scripts/genericise-street.test.mjs`. Expected: all pass. Then `npm run test:scripts`.

- [ ] **Step 6: Commit**

```bash
git add scripts/street-brands.mjs scripts/genericise-street.mjs scripts/genericise-street.test.mjs
git commit -m "feat: one table of the real names the street carries, and a script that swaps them"
```

---

### Task 2: Take the street, and make it build

**Files:**

- Modify: `vendor/my-office/import-upstream.mjs`, `vendor/my-office/MANIFEST.json` (written by the tool), `vendor/my-office/src/office/paseo-modules.js` (written), `vendor/my-office/src/i18n/locales/en/index.js` (written), `server/world.generated.ts` (built), `server/world-script.test.ts`, `vendor/SOURCES.md`
- Delete: `vendor/my-office/src/office/people/outings.js`, `people/guard.js`, `world/backdrops/city.js`, `world/backdrops/street-folk.js` (all stand-ins)
- Create (by the tool): `world/backdrops/{street-*.js, shops.js, shop-paint.js, eat-com.js}`, `people/{outings,comtrua,guard,nhau,photobooth,pickle,payday,evswap}.js` (the last two only if not already taken by piece 5), `vendor/my-office/assets/vehicles/cars.json`
- Test: `server/world-script.test.ts`

**Interfaces:**

- Consumes: `genericise-street.mjs` (Task 1).
- Produces: the street's modules in `paseo-modules.js` (setup order is upstream's); `vendor/my-office/assets/vehicles/cars.json` with its sha in `MANIFEST.json` under `assets`; the tool's new `DROPPED` list and `ASSETS` list.

- [ ] **Step 1: A first look at what is taken: the tool's `--check` before any change**

Run `node vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check` and note `would write` and `unchanged` as the baseline.

- [ ] **Step 2: Change the tool**

In `vendor/my-office/import-upstream.mjs`:

a. In `DENY`, replace `/^office\/world\/backdrops\//,` with
`/^office\/world\/backdrops\/(?:index|shop-(?:cong|dmx|highlands|katinat|longchau|mixue|phuclong|tgdd)|countryside|beach|shared)\.js$/,`.
b. In the people line of `DENY`, remove `outings|comtrua|guard|nhau|photobooth|pickle` (leave whatever pieces 5 and 7 left in it; if piece 5 already removed `staff` and the rest, nothing else changes). `payday` and `evswap` were never in `DENY`: they are reached by `outings.js`'s imports.
c. Add above `OWN`:

```js
/**
 * Imports a hand change removed from a kept file, so the tool must not ask for a stand-in or copy the file: the
 * chain modules (they draw real logos; shops.js no longer imports them, see SOURCES.md).
 */
const DROPPED = [
  /^office\/world\/backdrops\/shop-(?:cong|dmx|highlands|katinat|longchau|mixue|phuclong|tgdd)\.js$/,
];
```

and in `visit`, in the loop over imports, before `if (denied(target))` add `if (DROPPED.some((re) => re.test(target))) continue;`.
d. Update the comment above `DENY`: the street is taken, less the chain modules, `index.js` and the other two backdrops.
e. Assets. After `const chatOut = ...` add `const ASSETS = ["public/assets/vehicles/cars.json"];` and copy each to `vendor/my-office/assets/vehicles/cars.json` with `put` (same `PASEO:`-note rule does not apply: it is a JSON file; `put` skips an identical file). Record `assets: Object.fromEntries(... sha256 ...)` in the manifest object. The brand images are never listed.

- [ ] **Step 3: Delete the four stand-ins and run the tool**

```bash
cd vendor/my-office/src/office
git rm people/outings.js people/guard.js world/backdrops/city.js world/backdrops/street-folk.js
cd ../../..
node import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three
```

Expected report: `would write`-style counts of about 30 more files than the baseline; under `kept (carry a PASEO: note ...)`: the same hand-changed files as before (`core/env.js`, `interact/first-person.js`, the ones of pieces 5 to 7) and none of the street's; under `stand-ins to write or extend:` nothing from this piece (if `chatPhoto` of `ui/group-chat.js` shows, piece 5 is not in: stop and tell the controller). If a street file is reported as kept, an earlier stand-in was not deleted: delete it and run again.

- [ ] **Step 4: Swap the names**

Run `node scripts/genericise-street.mjs` from the repository root. Expected: it lists the files it changed (the street, `outings.js` and friends, `i18n/locales/en/*.js`) and exits 0. Run `node scripts/genericise-street.mjs --check`: exit 0. Open `git diff --stat`: the changed files are the ones named; read the diff of `people/outings.js` and `world/backdrops/street-atm.js`: only names and the header line changed.

- [ ] **Step 5: Build, and fix what esbuild names**

Run `npm run build:world`. Expected to fail at first with `No matching export "X" in "…/core/env.js"` or similar for a kept-local file (the tool does not check those). For each such message: read how upstream's `core/env.js` (or the file named) exports X, add the same export to the port's copy with a `// PASEO:` note saying it is for the street, list it in `vendor/SOURCES.md`'s entry of that file, build again. The street needs from `core/env.js`: `STATIC`, `V2`, `rand`, `officeNow`, `replay`, `HQ`, `PRO`, `el`, `$` (read upstream's definitions; `STATIC` is false and constant: the port's frame is not upstream's static export). The build also fails on `process`: that is Task 3, so for this step only, accept `process is not defined` at build as a warning, not an error (esbuild does not fail on it).

- [ ] **Step 6: Make the page know the street's modules**

`paseo-modules.js` was regenerated by the tool: check `git diff vendor/my-office/src/office/paseo-modules.js` adds the street's `setup` modules in upstream's order and that `worldBackdropsCity` is among them.

- [ ] **Step 7: Widen the bundle test for now**

In `server/world-script.test.ts` change the size window to `1_000_000 < length < 2_400_000` with the comment `// widened for the street; set from the measured size in Task 3`. Change the first-person test: delete its `expect(walk).toMatch(/\/\/ PASEO:[^\n]*\n\s*const street = \(\) => null;/);` line (Task 3 restores upstream's line, so the assertion becomes `expect(walk).toContain("THEME.live?.street")`: put that in now, it will fail until Task 3, so mark this one `it.todo` is wrong: leave the assertion out here and add it in Task 3 step 4).

- [ ] **Step 8: Run what runs**

`npm run build:world && npx vitest run server/world-script.test.ts client/world/entry.test.ts client/world/leisure-scene.test.ts`. Expected: pass (the street's scenes are not built: `index.js` is still the stand-in that builds nothing; that is Task 4). If `leisure-scene.test.ts` fails because a module it mocks now has more imports, extend its mock with the names named in the failure.

- [ ] **Step 9: Read the street's two audio makers**

`grep -n "AudioContext" vendor/my-office/src/office/world/backdrops/*.js vendor/my-office/src/office/people/*.js`. For each file that creates one, check it reads `sfx.on` as `people/karaoke.js` does (the gain is 0 and nothing plays while it is false). Where it does not, add the same early return by hand with a `// PASEO:` note and list it in `vendor/SOURCES.md`. Record what was found in the commit message body.

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "feat: take my-office's street and the scenes that happen there, with made-up names"
```

---

### Task 3: Hand changes the street needs

**Files:**

- Create: `vendor/my-office/src/office/world/backdrops/paseo-signs.js`
- Modify (by hand, each starts `// PASEO:`, each listed in `vendor/SOURCES.md`): `world/backdrops/shops.js`, `world/backdrops/street-life.js`, `world/backdrops/street-atm.js`, `interact/first-person.js`, `people/outings.js`, `vendor/my-office/src/office/paseo-host.js`
- Modify: `server/world-script.test.ts`, `vendor/SOURCES.md`, `scripts/genericise-street.mjs` (skip list only if a file name changes)
- Test: `client/world/signs.test.ts`, `server/world-script.test.ts`

**Interfaces:**

- Consumes: the taken files (Task 2).
- Produces: `signImage(file: string): HTMLCanvasElement & { complete: true, naturalWidth: number, naturalHeight: number }` from `paseo-signs.js` (`file` is the stem the callers pass, after the swap: `'kiosk.svg'`, `'mart24.svg'`, `'dailystop.svg'`, `'minutemart.svg'`, `'greenway.png'`, `'basket.png'`, `'aqua.svg'`, `'ridely.svg'`); `host.street` (boolean), `host.streetKit` (string or null), `host.claudeVersion` (function returning `{ version, at }` or null) on `paseo-host.js`.

- [ ] **Step 1: Write the failing test for the sign drawing**

Create `client/world/signs.test.ts` (jsdom; give `HTMLCanvasElement.prototype.getContext` a recording stub that returns a context whose `measureText` returns `{ width: text.length * 10 }` and records `fillText` calls):

```ts
// @vitest-environment jsdom
import { expect, test, vi } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { signImage, SIGNS } from "../../vendor/my-office/src/office/world/backdrops/paseo-signs.js";

const texts: string[] = [];
vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
  () =>
    ({
      measureText: (t: string) => ({ width: t.length * 10 }),
      fillText: (t: string) => texts.push(t),
      fillRect() {},
      save() {},
      restore() {},
      set font(_v: string) {},
      set fillStyle(_v: string) {},
      set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
    }) as unknown as CanvasRenderingContext2D,
);

test("a sign is a canvas that reads like a loaded image", () => {
  const sign = signImage("kiosk.svg");
  expect(sign.complete).toBe(true);
  expect(sign.naturalWidth).toBe(sign.width);
  expect(sign.naturalHeight).toBe(sign.height);
  expect(sign.width).toBeGreaterThan(sign.height);
});

test("each file the street asks for has a made-up name, and one canvas is made per file", () => {
  for (const file of Object.keys(SIGNS)) expect(signImage(file)).toBe(signImage(file));
  expect(Object.keys(SIGNS).sort()).toEqual([
    "aqua.svg",
    "basket.png",
    "dailystop.svg",
    "greenway.png",
    "kiosk.svg",
    "mart24.svg",
    "minutemart.svg",
    "ridely.svg",
  ]);
  expect(texts).toContain("Corner Kiosk");
});

test("a file with no entry draws no name instead of throwing", () => {
  expect(signImage("unknown.svg").naturalWidth).toBeGreaterThan(0);
});
```

Run `npx vitest run client/world/signs.test.ts`. Expected: fails, `Failed to resolve import ... paseo-signs.js`.

- [ ] **Step 2: Write `paseo-signs.js`**

```js
// PASEO: the plain signs of the street. Upstream loads the chains' real logos from image files; Paseo ships none, so
// the file names the street asks for (see shops.js's CHAINS and street-life.js's decals) are drawn here as the made-up
// name in plain bold letters. A canvas stands in for the image: callers read naturalWidth, naturalHeight and draw it.
export const SIGNS = {
  "kiosk.svg": { text: "Corner Kiosk", ink: "#E21F26" },
  "mart24.svg": { text: "Mart 24", ink: "#0068B7" },
  "dailystop.svg": { text: "Daily Stop", ink: "#008163" },
  "minutemart.svg": { text: "Minute Mart", ink: "#003894" },
  "greenway.png": { text: "Greenway", ink: "#E21B2A" },
  "basket.png": { text: "Green Basket", ink: "#008C44" },
  "aqua.svg": { text: "Aqua Ride", ink: "#22B8BE" },
  "ridely.svg": { text: "Ridely", ink: "#00B14F" },
};
const made = new Map();
/** The sign for a file name the street asks for: a canvas 4:1, the name centred in bold capitals. */
export function signImage(file) {
  if (made.has(file)) return made.get(file);
  const { text = "", ink = "#333333" } = SIGNS[file] || {};
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 128;
  const g = c.getContext("2d");
  g.fillStyle = ink;
  g.textAlign = "center";
  g.textBaseline = "middle";
  let size = 84;
  g.font = `900 ${size}px system-ui, sans-serif`;
  while (size > 24 && g.measureText(text).width > 480) {
    size -= 4;
    g.font = `900 ${size}px system-ui, sans-serif`;
  }
  g.fillText(text, 256, 66);
  c.complete = true;
  c.naturalWidth = c.width;
  c.naturalHeight = c.height;
  made.set(file, c);
  return c;
}
```

Run the test again: pass. (The names `Corner Kiosk` and the rest are the table's made-up names; a test in Task 3 step 8 keeps the two lists equal.)

- [ ] **Step 3: `shops.js`: chains, imports and the image seam**

Read the genericised `shops.js` and make these changes, each with a `// PASEO:` note on the changed line or the line above:

a. Delete the eight `import ... from './shop-*.js'` lines and `const CUSTOM = { ... };` (and its two comment lines). Add `import { signImage } from './paseo-signs.js';` and `const CUSTOM = {};` is not needed: leave every `CUSTOM[...]`/`ch.custom`/`ch.parlour` branch in place as dead code (they are never reached once no chain has the flags). `drawMixue`, `fitMixue`, `snowKing`, `snowDancer`, `RM` are referenced only inside those dead branches: add `const RM = {}, drawMixue = () => {}, fitMixue = () => ({}), snowKing = () => null, snowDancer = () => null; const CUSTOM = {};` once, under the imports, with the note "the chain modules are not taken; these branches never run".
b. Delete the `const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';` line.
c. Replace the whole body of `export function brandImage(file, redraw)` (from `if (logos[file])` to its closing brace) with `return signImage(file);` and delete the `const logos = {};` line. Keep the export name: `street-life.js` imports it.
d. In `CHAINS`, replace each of the eight lines of the form `{ ...HIGHLANDS.chain, custom: 'highlands' }` (after the swap the key and module names are made-up; the `HIGHLANDS`-style constants are gone) and the `mixue:` entry by plain entries. Each entry has the same fields as the six existing chains: `name`, `face`, `stripes`, `accent`, `shirt`, `hours`, `seats`, and `fridge`, `side`, `hot` where a person takes something (use `{ id, price, carry, unit }` as the existing six do). The eight, key by key (the keys are the table's):

```js
  hilltop: { name: 'Hilltop Coffee', logo: 'kiosk.svg', face: '#9B1C21', stripes: ['#9B1C21'], accent: '#9B1C21', shirt: '#9B1C21', hours: [7, 23], seats: true,
    fridge: { id: 'coffee', price: 29, carry: 'cup' }, side: { id: 'cone', price: 10, carry: 'cone', unit: 'softserve' }, hot: { id: 'bun', price: 19, carry: 'bun', unit: 'steamer' } },
  handset: { name: 'Handset Hub', logo: 'kiosk.svg', face: '#FFD400', stripes: ['#1C1F24', '#FFD400'], accent: '#FFD400', shirt: '#1C1F24', hours: [8, 22], seats: false,
    fridge: { id: 'water', price: 8, carry: 'cup' }, side: { id: 'cone', price: 10, carry: 'cone', unit: 'softserve' }, hot: null },
  navycafe: { name: 'Navy Coffee House', logo: 'kiosk.svg', face: '#1A2B4C', stripes: ['#1A2B4C', '#BF9369'], accent: '#BF9369', shirt: '#1A2B4C', hours: [7, 23], seats: true,
    fridge: { id: 'coffee', price: 45, carry: 'cup' }, side: { id: 'cone', price: 10, carry: 'cone', unit: 'softserve' }, hot: { id: 'bun', price: 19, carry: 'bun', unit: 'steamer' } },
  jadetea: { name: 'Jade Tea House', logo: 'kiosk.svg', face: '#006F3C', stripes: ['#006F3C'], accent: '#006F3C', shirt: '#006F3C', hours: [7, 22.5], seats: true,
    fridge: { id: 'peachTea', price: 39, carry: 'cup' }, side: { id: 'cone', price: 10, carry: 'cone', unit: 'softserve' }, hot: null },
  harbor: { name: 'Harbor Pharmacy', logo: 'kiosk.svg', face: '#1554D1', stripes: ['#1554D1'], accent: '#1554D1', shirt: '#1554D1', hours: [7, 22], seats: false,
    fridge: { id: 'water', price: 8, carry: 'cup' }, side: { id: 'veg', price: 12, carry: 'grocery', unit: 'produce' }, hot: null },
  skyelectric: { name: 'Sky Electric', logo: 'kiosk.svg', face: '#00AEEF', stripes: ['#00AEEF', '#FFF200'], accent: '#00AEEF', shirt: '#00AEEF', hours: [8, 21.5], seats: false,
    fridge: { id: 'water', price: 8, carry: 'cup' }, side: { id: 'veg', price: 12, carry: 'grocery', unit: 'produce' }, hot: null },
  olivecafe: { name: 'Olive Cafe', logo: 'kiosk.svg', face: '#E9E2D2', stripes: ['#E9E2D2', '#B1181F'], accent: '#4E5E2B', shirt: '#4E5E2B', hours: [7, 23], seats: true,
    fridge: { id: 'coffee', price: 29, carry: 'cup' }, side: { id: 'cone', price: 10, carry: 'cone', unit: 'softserve' }, hot: { id: 'bun', price: 19, carry: 'bun', unit: 'steamer' } },
  frosty: { name: 'Frosty Cone', logo: 'kiosk.svg', face: '#E50914', stripes: ['#E50914'], accent: '#E50914', shirt: '#1E1E1E', hours: [9, 22], seats: true,
    fridge: { id: 'peachTea', price: 25, carry: 'cup' }, side: { id: 'cone', price: 10, carry: 'cone', unit: 'softserve' }, hot: null },
```

(`logo: 'kiosk.svg'` is the sign file for the shop's lightbox; each shop's own wordmark comes from a `SIGNS` entry: add `'hilltop.svg'`, `'handset.svg'`, `'navycafe.svg'`, `'jadetea.svg'`, `'harbor.svg'`, `'skyelectric.svg'`, `'olivecafe.svg'`, `'frosty.svg'` to `SIGNS` with the shop's `accent` as `ink`, and set each entry's `logo` to its own file. The `id`s `peachTea`, `coffee`, `water`, `cone`, `bun`, `veg` are ones the six chains already use; read the six and the item table the walk-in code reads and use only ids it knows. Remove `plus: true` and `crop` from the entry that had them: the plus is the former chain's mark.)

e. Delete the `PROMO` and `MENU` rows of any chain removed or renamed so their keys match the table (the swap already renamed them); give each of the eight a `PROMO` and a `MENU` row copied in shape from the six (made-up wording, no real product line), because `storeFront` and the till read `PROMO[key]` and `MENU[key]` and a missing row is skipped for `PROMO` and read as `undefined` for `MENU`: before writing, read how line 7xx uses `MENU[key]` and give every key one.
f. In the `hcm` set, keys are already the table's after the swap; check `SETS.hcm` lists twelve keys that all exist in `CHAINS`. Do the same for the other sets: they list keys that exist.

- [ ] **Step 4: `first-person.js`, `street-life.js`, `street-atm.js`, `outings.js`**

- `interact/first-person.js`: replace the two lines
  `// PASEO: the street is not taken (world/backdrops/ is not), so there is no lift to it.` and `const street = () => null;` with upstream's single line `const street = () => (THEMES && THEME === THEMES.city && THEME.live?.street) || null;`. The file keeps its other `PASEO:` notes. In `vendor/SOURCES.md` delete the bullet that says "the street is cut".
- `world/backdrops/street-life.js`: delete `const BASE = process.env.NEXT_PUBLIC_BASE_PATH || '';`; replace the line `const loadKit = () => (kitLoad ??= fetch(...)...)` with `const loadKit = () => (kitLoad ??= Promise.resolve(host.streetKit ? JSON.parse(host.streetKit) : null));` and add `import { host } from '../../paseo-host.js';` (note: the file's other `import`s are unchanged). Everything after `loadKit().then((kit) => { if (!kit) return;` already copes with a missing kit: the cars drive unseen and only scooters and the procedural vehicles show.
- `world/backdrops/street-atm.js`: the swap changed the bank's name; the mark function `vheart` draws a V that is also a heart in the bank's green. Replace its body with a plain rounded square in the same colour: read `vheart(g, x, y, s)`'s signature, keep it, and draw `g.fillStyle = VCB; g.beginPath(); g.roundRect(x - s, y - s, s * 2, s * 2, s * 0.4); g.fill();`. (After the swap the constants are still named `VCB`, `VCB_DARK`: names of a variable, left; the check reads text, and `vcb` is not in the table. If the owner would rather have them renamed, it is one table entry and an identifier swap.)
- `people/outings.js`: replace `async function lookForUpgrade()`'s first line `const r = await fetch(...)...` with `const r = host.claudeVersion?.() ?? null;` (import `host` from `'../paseo-host.js'`); drop the `TOKEN` import and its use. Leave `setup()` as it is: `STATIC` is false and `URLSearchParams(location.search).has('demo')` is false in the frame, so it schedules the poll.

- [ ] **Step 5: The host's fields**

In `paseo-host.js` add: `street: false` (the street is built at start), `streetKit: null` (the car models as JSON text, or null), `claudeVersion: null` (a function returning `{ version, at }` or null; piece 5 may already have added it under that name: keep one).

- [ ] **Step 6: Check, build, and the brand test**

Run `node scripts/genericise-street.mjs --check` (still exit 0: hand changes added no real name), `npm run build:world`. Expected: builds with no `process` mention. In `server/world-script.test.ts`:

- narrow the size window to the measured size: let `n` be the printed length; set `n * 0.9 < length < n * 1.1` as two literals with the comment `// the street's code and made-up signs; the cars are not in it`.
- add

```ts
import { REAL_NAMES } from "../scripts/street-brands.mjs";

it("names no real shop, bank, maker or ride-hailing company", () => {
  const found = REAL_NAMES.filter((name) => WORLD_SCRIPT.toLowerCase().includes(name));
  expect(found).toEqual([]);
});

it("takes the street's first-person branch back, and no network call for it", () => {
  const walk = readFileSync(
    new URL("../vendor/my-office/src/office/interact/first-person.js", import.meta.url),
    "utf8",
  );
  expect(walk).toContain("THEME.live?.street");
  expect(walk).not.toMatch(/const street = \(\) => null;/);
  expect(WORLD_SCRIPT).not.toContain("/assets/vehicles");
  expect(WORLD_SCRIPT).not.toContain("/assets/brands");
  expect(WORLD_SCRIPT).not.toContain("/api/claude-version");
});
```

Delete the old `not.toContain("mixue")` line (the scan covers it) and the first-person test's `toMatch(...street = () => null...)` line. Add `scripts/street-brands.mjs` types: the test file imports a `.mjs` from TypeScript: add `// @ts-expect-error scripts are JavaScript` above the import if `typecheck` objects.

- [ ] **Step 7: See the brand test fail, then pass**

Run `npx vitest run server/world-script.test.ts`. Expected on the first run: the brand test fails naming whatever the table missed (for example a lower-case key in a string, `vcb`, a name in a part of an English area). For each name, add a table entry or key, run `node scripts/genericise-street.mjs`, rebuild; repeat until it passes. Record each addition in the commit body. Names the table cannot reach because they are in a file this piece did not take (a name in `people/staff.js` from piece 5): run the script with `--files` on that file; it is the same table.

- [ ] **Step 8: A test that the two lists agree**

In `client/world/signs.test.ts` add: every `madeUp` name of the eight shop entries and the two ride entries in `BRANDS` is the `text` of a `SIGNS` entry or appears in `shops.js`'s `CHAINS` as a `name` (read the file text; `Greenway Market` is `Greenway` on the sign, so compare the first word). Run, fix `SIGNS` if it fails.

- [ ] **Step 9: `vendor/SOURCES.md`**

Add, in the "changed by hand" list: the six files above and `core/env.js`'s new exports; add a section "The street": what is taken, that the eight chain modules, `countryside.js`, `beach.js`, `shared.js` and the brand images are not, that the names are swapped by `scripts/genericise-street.mjs` from `scripts/street-brands.mjs` after the import tool (the update recipe: delete the street's files, run the tool, run the script, redo the hand changes), and the table of stand-ins gains `world/backdrops/index.js`'s new role (Task 4). Remove "the street outside with its shops" from "What is not taken".

- [ ] **Step 10: Run the chain and commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
npm test -- --maxWorkers=4 > /tmp/p8-t3.txt 2>&1; tail -20 /tmp/p8-t3.txt
git add -A && git commit -m "feat: the street draws plain signs, takes its cars from the host and refuses a real name"
```

---

### Task 4: The scene builds the street only when told to

**Files:**

- Modify: `vendor/my-office/src/office/world/backdrops/index.js` (the stand-in), `vendor/my-office/src/office/paseo-entry.js`, `vendor/my-office/src/office/paseo-style.js`, `client/world/world-api.ts`, `vendor/SOURCES.md`
- Test: `client/world/backdrops.test.ts`, `client/world/entry.test.ts` (new case), `client/world/street-style.test.ts`

**Interfaces:**

- Consumes: `host.street`, `host.streetKit` (Task 3); upstream's `buildCity` (taken `city.js`: `buildCity(group)` returns `live` with `update`, `night`, `street`), `cityDay`, `cityNight` from `world/windows.js`.
- Produces: `THEMES = { plain, city }` always, `THEME` (`plain` or `city`), `setScene(name)` (exported: `ui/settings.js`'s stand-in imports it), `applySurface`, `applyNight`, `setup`; `WorldStartOptions.street?: { kit: string | null }`.

- [ ] **Step 1: Write the failing test of the backdrop chooser**

Create `client/world/backdrops.test.ts`. It mocks the modules the stand-in imports so no WebGL is needed (the pattern of `entry.test.ts`): `scene/renderer.js` (`scene` with `add`, `background`, `fog: null`), `world/windows.js` (`cityDay`, `cityNight`, `viewTex`), `world/room-update.js` (`setNight` recorded, `night` false), `interact/first-person.js` (`buildGrid`, `fp`), `world/backdrops/city.js` (`buildCity` returning `{ update() {}, night: vi.fn(), street: {} }`), `core/state.js` (use the real one). `three` is the real vendored build (`Color`, `Group` run without WebGL). Cases:

```ts
test("with the street off the plain backdrop is the only theme and nothing is built", () => {
  host.street = false;
  setup();
  expect(THEME).toBe(THEMES.plain);
  expect(buildCity).not.toHaveBeenCalled();
  expect(THEMES.city.group).toBeUndefined();
});

test("with the street on the city is built once, in its own group, and is the theme", () => {
  host.street = true;
  setup();
  expect(buildCity).toHaveBeenCalledTimes(1);
  expect(THEME).toBe(THEMES.city);
  expect(THEME.live.night).toBeDefined();
  expect(THEME.fog).toEqual(["#CCD8E4", "#16223E"]);
});

test("night follows the app's theme, never the clock, with the street on", () => {
  host.street = true;
  setup();
  applyNight(true);
  expect(state.nightManual).toBe(true);
  expect(setNight).toHaveBeenLastCalledWith(true);
});

test("the plain theme still takes the app's surface colour", () => {
  host.street = false;
  host.surface = "#102030";
  setup();
  applySurface();
  expect(scene.background.getHexString()).toBe("102030");
});
```

(Reset mocks and module state between cases with `vi.resetModules()` and a dynamic import in a helper `load()`.) Run `npx vitest run client/world/backdrops.test.ts`: fails, `buildCity` never called / `THEMES.city` undefined.

- [ ] **Step 2: Write the stand-in**

Rewrite `world/backdrops/index.js` (still a stand-in: upstream's chooses by `localStorage` and `[data-scene]` buttons and runs a 1-second clock):

```js
// PASEO: stand-in for my-office's world/backdrops/index.js. Upstream chooses a street, a countryside or a beach by
// localStorage and runs the day and night by the clock; Paseo has the plain backdrop in the app's surface colour, or
// the street when the device asked for it (host.street), and day and night follow the app's theme.
import * as THREE from "../../../../three/three.module.min.js";
import { state } from "../../core/state.js";
import { scene } from "../../scene/renderer.js";
import { buildCity } from "./city.js";
import { cityDay, cityNight, viewTex } from "../windows.js";
import { night, setNight } from "../room-update.js";
import { buildGrid, fp } from "../../interact/first-person.js";
import { host } from "../../paseo-host.js";

export let THEMES;
export let THEME;

/** The plain backdrop and the far haze take the app's surface colour; the street keeps its own sky and fog. */
export function applySurface() {
  if (THEME !== THEMES.plain) return;
  const colour = new THREE.Color(host.surface);
  THEME.sky = colour;
  THEME.fog = [host.surface, host.surface];
  scene.background = colour;
  if (scene.fog) scene.fog.color.copy(colour);
}
/** Night with Paseo's dark theme, day with the light one: never by the clock. */
export function applyNight(on) {
  state.nightManual = true;
  setNight(on);
  applySurface();
}
/** Upstream's setScene, for the two themes: the street is built the first time it is chosen. */
export function setScene(name, apply = true) {
  const t = THEMES[name] || THEMES.plain;
  if (t.build && !t.group) {
    t.group = new THREE.Group();
    t.group.userData.noMerge = true;
    scene.add(t.group);
    t.live = t.build(t.group);
    t.live.night(night);
  }
  for (const x of Object.values(THEMES)) if (x.group) x.group.visible = x === t;
  THEME = t;
  if (fp.grid) fp.grid = buildGrid();
  if (apply) setNight(night);
}
export function setup() {
  THEMES = {
    plain: {
      fog: [host.surface, host.surface],
      wins: [cityDay, cityNight],
      sky: new THREE.Color(host.surface),
      live: null,
    },
    city: { build: buildCity, fog: ["#CCD8E4", "#16223E"], wins: [cityDay, cityNight] },
  };
  setScene(host.street ? "city" : "plain", false);
  applyNight(host.night);
}
```

(`viewTex` is imported only if upstream's `setScene` needs it for themes with a `view`; neither of these has one, so remove the import if the linter would flag it, though vendored files are not linted: keep the file free of unused imports anyway.) Run the test: pass.

- [ ] **Step 3: The entry reads the options**

In `paseo-entry.js`, in `start`, after `host.photo = ...` add

```js
// (the street outside: the device chose it, and the car models came with the options, or did not)
host.street = options.street !== undefined && options.street !== null;
host.streetKit = typeof options.street?.kit === "string" ? options.street.kit : null;
```

and in the doc comment of `start` add `street ({ kit }: the street outside is built, with the car models as JSON text, or none)`. In `world-api.ts` add to `WorldStartOptions`:

```ts
  /**
   * The street outside is built. `kit` is the car models as JSON text (the host's `office.world.street`), or null:
   * the street then has scooters and the procedural vehicles only. Absent: the plain backdrop.
   */
  street?: { kit: string | null };
```

Add a case to `client/world/entry.test.ts` ("start with `street: { kit: '{}' }` sets `host.street` and `host.streetKit`; without it both are off": read `host` from `paseo-host.js` as the file's other cases do).

- [ ] **Step 4: The street's page needs: styles**

In `paseo-style.js`'s `STYLE` string add the street's rules, taken from upstream's `csgt.css` and `labels.css` lines 10-15 and rewritten in the port's variables (`--o-accent`, `--o-warning`, `--o-danger`, `--o-muted`, `--o-surface`, and whichever of `--o-border`, `--o-text` the file defines: read the top of `paseo-style.js` and use only names it declares; upstream's `--line-2`, `--muted`, `--faint`, `--ink`, `--green`, `--red`, `--mono`, `--font` map to them). The classes: `.shop-say`, `.pickle-tally` (`.ok`, `.fail`), the `-say` variants (`.csgt-say`, `.nhau-say`, `.atm-say`, `.ev-say`, `.pickle-say`), `.csgt-chip`, `.nhau-chip` (`.z-ico` colours), `.csgt-card` (`position: absolute; right: 14px; top: 14px; z-index: 4; width: min(400px, calc(100% - 28px)); max-height: calc(100% - 28px)`, and its `@media (max-width: 640px)` bottom sheet form), `.csgt-head`, `.csgt-ico`, `.csgt-title`, `.csgt-sub`, `.csgt-close`, `.csgt-body`, `.csgt-empty`, `.csgt-stop`, `.csgt-steps` with its counters and `[data-state]` rules, `.csgt-law`, `.csgt-clear`, `.csgt-foot`, the paper (`.csgt-paper`, `-top`, `-sub`, `.csgt-no`, `.csgt-motto`, `.csgt-signs`, `.csgt-scrawl`, `.csgt-mock`) and `.nhau-card`, `.nhau-h`, `.nhau-who`, `.nhau-menu`. Copy the declarations from upstream's two files (read them in full), keep selectors and values, replace variables, and drop any upstream rule using `@font-face` or `Be Vietnam Pro`.

Create `client/world/street-style.test.ts`: read `paseo-style.js` text and assert it contains each selector in the list above (`.csgt-card`, `.nhau-card`, `.shop-say`, `.pickle-tally`, `.csgt-paper`, `.csgt-steps li[data-state="now"]`, and the nine more), and contains no `var(--line-2)`, `var(--muted)`, `var(--faint)`, `var(--ink)`, `var(--green)`, `var(--red)` (upstream's variables, undefined in the port).

- [ ] **Step 5: Build, check, commit**

`npm run build:world`; the size window may need `n * 1.1` raised by the styles (few KB): re-measure and set. Run the chain and the whole suite. In `vendor/SOURCES.md` update the stand-in table row for `world/backdrops/index.js` ("the plain backdrop, or the street when `host.street`; day and night by the app's theme") and the list of `paseo-style.js`'s contents.

```bash
git add -A && git commit -m "feat: the scene builds the street only when the device asks for it"
```

---

### Task 5: The cars: a generated module and an RPC

**Files:**

- Modify: `scripts/build-world.mjs`, `shared/contracts.ts`, `shared/contracts.test.ts`, `index.server.ts`, `server/world-script.ts`, `server/world-script.test.ts`, `package.json` (nothing unless `check:world` needs no change: it runs `build-world.mjs --check`, which now covers both files)
- Create: `server/street-kit.generated.ts` (built)
- Test: `server/world-script.test.ts`, `shared/contracts.test.ts`, `index.server.test.ts`

**Interfaces:**

- Consumes: `vendor/my-office/assets/vehicles/cars.json` (Task 2).
- Produces: `STREET_KIT: string` in `server/street-kit.generated.ts`; `streetRpc = defineRpc({ name: "office.world.street", input: z.object({}), output: z.string() })` in `shared/contracts.ts`; `WorldScript.readStreet(): Promise<string>`; `embeddedWorldScript()` returns both.

- [ ] **Step 1: Failing tests**

In `server/world-script.test.ts` add to the first `describe`:

```ts
it("holds the street's car models as JSON text that is the vendored file", async () => {
  const world = embeddedWorldScript();
  const kit = await world.readStreet();
  expect(kit).toBe(STREET_KIT);
  const parsed = JSON.parse(kit);
  expect(Object.keys(parsed.models)).toContain("sedan");
  expect(parsed.source).toContain("Kenney");
  expect(
    readFileSync(new URL("../vendor/my-office/assets/vehicles/cars.json", import.meta.url), "utf8"),
  ).toBe(kit);
});

it("names no real name in the car models", () => {
  const found = REAL_NAMES.filter((name) => STREET_KIT.toLowerCase().includes(name));
  expect(found).toEqual([]);
});
```

(with `import { STREET_KIT } from "./street-kit.generated.js";`). In `shared/contracts.test.ts`, add `streetRpc.name` (`"office.world.street"`) to the list of names the file already checks for uniqueness and shape. In `index.server.test.ts` add a case modelled on the existing world RPC case: handling `streetRpc` returns the deps' `readStreet()` value, and a throwing `readStreet` is answered as a failure the way `guarded("world", ...)` does. Run them: all fail (no module, no export).

- [ ] **Step 2: The build writes the second file**

In `scripts/build-world.mjs`: read `vendor/my-office/assets/vehicles/cars.json`, check it parses and that `JSON.stringify(JSON.parse(text)) .length > 100_000` (a guard against an empty file), build a second module

```js
const kitModule = [
  "// Generated by scripts/build-world.mjs from vendor/my-office/assets. Do not edit.",
  "/** The street's car models (Kenney's Car Kit 3.1, CC0) as JSON text; the scene parses it. */",
  `export const STREET_KIT: string = ${literal(kitText)};`,
  "",
].join("\n");
```

with `literal` the same escape of U+2028 and U+2029 the script already applies (factor that into a small local function used for both). `--check` compares both files; the write branch writes both and prints both sizes.

- [ ] **Step 3: The contract, the server, the dependency**

In `shared/contracts.ts` after `worldRpc`:

```ts
/**
 * The street's car models as JSON text: the 3D office asks for it only when the device turned the street on, and
 * hands it to the scene in its start options.
 */
export const streetRpc = defineRpc({
  name: "office.world.street",
  input: z.object({}),
  output: z.string(),
});
```

In `server/world-script.ts` add `readStreet(): Promise<string>;` to `WorldScript` and `readStreet: async () => STREET_KIT` to the embedded one (import from `./street-kit.generated.js`). In `index.server.ts` import `streetRpc` beside `worldRpc` and add after the world handler `server.handle(streetRpc, () => guarded("street", () => deps.world.readStreet()));`. Fix every test double of `WorldScript` the compiler names (`npm run typecheck`): give each `readStreet: async () => "{}"`.

- [ ] **Step 4: Build, run, commit**

`npm run build:world`, then the three test files: pass. Chain and whole suite.

```bash
git add -A && git commit -m "feat: the street's car models go to a device that asks for them, over one more call"
```

---

### Task 6: The setting, and the view that starts the street

**Files:**

- Create: `client/use-street.ts`, `client/world/use-street-kit.ts`
- Modify: `shared/settings.ts`, `shared/settings.test.ts`, `client/office-settings.tsx`, `client/office-surface.tsx` (`useViewChoice`), `client/world/world-view-shared.ts` (`WorldLatest`, `worldStartOptions`), `client/world/world-view.tsx`, `client/world/world-view-native.tsx`, `client/world/world-bridge.ts` (only if the bridge drops a nested object option: read it), `client/world/use-world-feed.ts` (the floor's note)
- Test: `client/use-street.mounted.test.tsx`, `client/world/use-street-kit.test.tsx`, `client/world/world-view-shared.test.ts`, `client/world/world-view.mounted.test.tsx`, `client/world/world-view-native.mounted.test.tsx`, `client/office-settings.mounted.test.tsx`, `client/world/world-bridge.test.ts`

**Interfaces:**

- Consumes: `officeDeviceSettings` with piece 2's `sound` and piece 1's `lastAgent`; `streetRpc` (Task 5); `WorldStartOptions.street` (Task 4); the frame effect's dependency list and the native frame's `key` (piece 3); `useLabeledSwitch`-style `LabeledSwitch` component of piece 2 (`client/labeled-switch.tsx`).
- Produces:

```ts
// shared/settings.ts: officeDeviceSettings gains  street: z.boolean().optional()
// client/use-street.ts
export const UNSAVED_STREET: string;
export interface StreetSwitch {
  /** What this device shows: the stored choice, else the device's default; null while the setting is read. */
  on: boolean | null;
  /** The device refused to store the last tap. */
  unsaved: boolean;
  set(next: boolean): void;
}
export function streetDefault(layout: { platform: string; compact: boolean }): boolean;
export function useStreetSwitch(layout: { platform: string; compact: boolean }): StreetSwitch;
// client/world/use-street-kit.ts
export type StreetKit =
  | { status: "off" }
  | { status: "loading" }
  | { status: "ready"; kit: string }
  | { status: "failed" };
export function useStreetKit(on: boolean | null): StreetKit;
```

- [ ] **Step 1: Failing settings tests**

In `shared/settings.test.ts`: `officeDeviceSettings.schema.parse({})` has no `street` key (`toEqual` the earlier defaults without it), `parse({ street: false })` keeps `false`, `parse({ street: true })` keeps `true`, and the version is still 2. Run: the last two fail (`street` is stripped by the object schema).

- [ ] **Step 2: The field**

Add `street: z.boolean().optional(),` after `view` in `officeDeviceSettings`' schema and a sentence to its doc comment: "`street` is whether the 3D office shows the street outside; absent, the device's default (off on a phone)." Run: pass. Then, in `client/office-surface.tsx`'s `useViewChoice`, the save already spreads the kept document after piece 2; if it spells the fields out, spread `...kept` so `street` survives a view change, with a test in `client/office-surface-panels.mounted.test.tsx` (the saved document after a view change still holds `street: true`).

- [ ] **Step 3: The hook, tests first**

Create `client/use-street.mounted.test.tsx` as a copy in shape of piece 2's `client/use-sound.mounted.test.tsx` (a stand-in `useSettings` that holds the document, records saves, can refuse the next save), with these cases: `streetDefault({ platform: "web", compact: false })` is true; `{ platform: "web", compact: true }` false; `{ platform: "android", compact: false }` false; `{ platform: "ios", compact: true }` false. With no stored `street`, `on` is the default; with `street: false` on a desktop layout `on` is false; `set(true)` saves `{ ...stored, street: true }` against the stored revision (the other fields kept); a conflict reloads and tries once more on the new revision; a refusal sets `unsaved` and does not loop. Run: fails (no module).

Implement `client/use-street.ts` exactly as piece 2's hook with `sound` replaced by `street` and the two lines `const stored = settings.status === "ready" ? settings : null;` / the return `on: wanted ?? stored?.values.street ?? (stored === null ? null : streetDefault(layout))`:

```ts
export const UNSAVED_STREET =
  "Unable to save the street setting on this device. It holds until the office is closed.";

/** Off on a phone (the native apps, or a narrow layout), on elsewhere: the street roughly doubles the scene. */
export function streetDefault(layout: { platform: string; compact: boolean }): boolean {
  return layout.platform === "web" && !layout.compact;
}
```

and the rest of `useStreetSwitch(layout)` the same as `useSoundSwitch` (state for the tap, one save at a time, retry after a conflict, give up after a refusal). Run: pass.

- [ ] **Step 4: The kit loader, tests first**

`client/world/use-street-kit.ts` fetches the kit once per page when `on === true` and keeps it, like `sharedWorldLoader`. Test (`client/world/use-street-kit.test.tsx`, mounted with a fake `useRpc` that returns a promise the test settles): `on` null or false gives `{ status: "off" }` and calls nothing; true gives `loading` then `ready` with the string; a second mount reuses the stored string (one call in all); a rejection gives `failed` and a later `on` change to true tries again; an empty string gives `failed`. Implement with `createWorldLoader()` (reuse the type from `world-loader.ts`: a second `sharedStreetLoader = createWorldLoader()` and `useSyncExternalStore`, as `world-view-shared.ts` does for the script). Run: pass.

- [ ] **Step 5: The start options and the restart**

- In `world-view-shared.ts`: `WorldLatest` gains `street: { kit: string | null } | null` (null: the plain backdrop); `worldStartOptions` adds `...(latest.current.street === null ? {} : { street: latest.current.street })`. Test in `world-view-shared.test.ts`: with `street: null` the options have no `street` key; with `{ kit: "{}" }` they carry it.
- In `world-view.tsx` and `world-view-native.tsx`: call `const street = useStreetSwitch(layout)` and `const kit = useStreetKit(street.on)`; compute `const streetOption = street.on === true && kit.status === "ready" ? { kit: kit.kit } : street.on === true && kit.status === "failed" ? { kit: null } : null;` and hold the start back while `street.on === true && kit.status === "loading"` (the frame is not opened until it settles: the scene would otherwise start without the street and restart a moment later). Put `streetOption === null ? 0 : 1` (a number, so a new kit string does not restart the scene) in the frame effect's dependency list and in the native frame's `key`, where piece 3 put the floor plan. Add `street: streetOption` to every `WorldLatest` literal after `onBell`/`onSound` (read the file for the places: the ref's initial value, the effect's assignment, the dependency list).
- The floor's note: when `street.on === true && kit.status === "failed"`, `floorNote` is extended with "The street's cars could not be loaded." through the `note` the feed returns (`useWorldFeed` input gains `streetNote: boolean`); test in `use-world-feed.mounted.test.tsx`.
- Tests: in `world-view.mounted.test.tsx`, with the street on and the kit ready the fake `PaseoOfficeWorld.start` receives `street: { kit }` once; turning the setting off restarts the scene (`stop` then `start`) and the new start has no `street`; with the kit failed `start` receives `{ kit: null }` and the note shows. In `world-view-native.mounted.test.tsx` the frame's key changes with the setting. In `world-bridge.test.ts`, a start option `street: { kit: "{}" }` is posted as data (the bridge sends every non-function option except `brand`: if the test shows a nested object is dropped, change the bridge to post it; read `world-bridge.ts` first).

- [ ] **Step 6: The settings row**

In `client/office-settings.tsx`: `const street = useStreetSwitch(layout);` after the sound switch; `deviceProblem` gains `street.unsaved ? UNSAVED_STREET`; add a child `<LabeledSwitch label="The street outside" value={street.on} onChange={street.set} styles={styles} />` after piece 2's Sound row. If piece 2's `LabeledSwitch` has a hint prop, pass `hint="Draws the street, shops and traffic outside the windows. Heavy on memory: off by default on a phone."`; if not, add the hint as a `Text` under it with an existing style (`styles.fieldHint`, which piece 9's plan also uses). Test in `office-settings.mounted.test.tsx`: the row is there with the label, is off for a compact layout and on for a desktop one when nothing is stored, and a tap saves `street` and keeps the other fields.

- [ ] **Step 7: Run the chain, commit**

```bash
npm run format && npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
npm test -- --maxWorkers=4 > /tmp/p8-t6.txt 2>&1; tail -20 /tmp/p8-t6.txt
git add -A && git commit -m "feat: a device setting for the street outside, and a scene that starts with it"
```

---

### Task 7: A look, and what was seen

**Files:**

- Modify: `docs/verified.md`, `README.md`, `docs/office.md`

- [ ] **Step 1: A stock daemon with the branch installed**

As piece 1's last task describes: a clean `/tmp/office-stock-home`, the published 0.16.2 daemon on port 6798 with `env -i` and the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`, the plugin installed by Git from the local repository at the branch's commit. `daemon status` must show 6798 and that home before any plugin command. Open the page with the Paseo browser tool at the host's address on 6798; the browser needs WebGL (the owner's memory note says the host's Chromium has the flag).

- [ ] **Step 2: Look at 1280 px**

- Settings, Plugins, Office: "The street outside" is there, on. The floor shows the street through the windows: buildings, a road with cars and scooters, shop fronts with plain signs (read each: no real name; the names are the table's). Read every sign and the chip texts with the browser's screenshot; this is the one place a name the script missed can still show (drawn text is in no file).
- Turn the setting off: the scene restarts and the backdrop is the plain surface colour of today. Turn it on again.
- Press Walk in, walk to the door, take the lift (E at the door): the street at ground level, a shop door that opens, a till.
- Stop the cars: with the network tool, check that the page made no request other than the RPC to the daemon: no `cars.json`, no image. With `JSON.parse` failing on a broken kit (not possible from outside): recorded as not seen.
- Dark theme and light: the street lights up in the dark theme at any hour (decision 8). Look at noon in the dark theme and say what shows.
- The six scenes are time-driven: the browser tool cannot move the page's clock before start. Evidence is limited to what is on the street at the time of the look. Record which of the six (a person on an errand, the guard, the lunch eatery, the drinking place, the photo studio, the court) were seen, and say "not seen" for the rest.

- [ ] **Step 3: Look at 390 px**

Open the page at 390 px with a touch-like pointer. The setting is off by default (compact layout) and the floor is as before. Turn it on: the scene restarts with the street; read the browser's memory figure if the tool gives one (`performance.memory` on Chromium) with the street off and on, and the frame time over ten seconds. Record both numbers. A real phone's memory is not the host's.

- [ ] **Step 4: What cannot be seen here**

Record as not seen, and as the owner's to check on the host after the update: (a) the Android app's script frame with the street on: whether it starts, how it feels, whether the app is killed for memory (the risk the roadmap names; the owner tries it with the street off and then on); (b) the 420 KB kit through the phone's message bridge; (c) the six staff scenes at their hours (needs a day, or the owner's clock); (d) the lunch and drink scenes' chat lines, which need the chat sink of piece 5; (e) sound of the street's two audio makers with Sound on; (f) the upgrade trip to the phone shop, which needs the host's reading of the agent's version.

- [ ] **Step 5: Docs**

- `docs/verified.md`: a section "The street" with what was seen, the memory and frame numbers, and the not-seen rows of step 4.
- `README.md`: under "What it does" add "Shows my-office's street outside the windows, with generic shops and vehicles (made-up names; no real brand, logo or tune), and the scenes that happen there. A device setting, off by default on a phone." Credit "Kenney's Car Kit (CC0)" for the car models. Under "What works where" a row for the street. In "What it reads and where it sends it": the scene is told one more thing, the street's car models (a file of the plugin's), and makes no network call for them.
- `docs/office.md`: a section "The street": what is taken, that the eight chain modules and the brand images are not and why, the sign drawing, `scripts/street-brands.mjs` and `scripts/genericise-street.mjs` and the update recipe, the setting (`street`, optional, default by device), the RPC `office.world.street`, the start option `street`, the day and night rule (decision 8).
- Commit `docs: what was seen of the street on a stock daemon, and the street section`.

- [ ] **Step 6: Stop the daemon**

Stop it by its pid; confirm 6798 is closed and 6767 untouched.

---

## Not verifiable until built

| What                                                                                                                       | How the plan finds out                                                                   |
| -------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| The street runs at all: upstream's 10,000 lines were written against its own page, and jsdom cannot draw canvases or WebGL | Task 2 step 5 (esbuild names missing exports), Task 7 (a real browser)                   |
| That the table covers every real name in text drawn onto canvases (signs, posters, menus)                                  | Task 3 step 7 for source text; Task 7 step 2 by reading the signs on screen              |
| Memory and frame time on a phone with the street on (upstream's own figure for its 3D world is about 1 GB in a browser)    | Task 7 step 3 gives a desktop browser's figures only; the owner's phone is the real test |
| That the twelve places read as shops once the eight chains are plain entries (their fittings and the items people take)    | Task 3 step 3e reads the item table; Task 7 looks at each shop front and walks into two  |
| What `outings.js` needs from `core/env.js` and other kept-local files                                                      | Task 2 step 5, by esbuild's messages                                                     |
| Whether the phone's message bridge carries a 430 KB option                                                                 | Task 6 step 5 test with a large string; the real WebView is the owner's to check         |
| The scenes at their hours and the lunch/drink chat lines                                                                   | Not seen in a daily look; the owner watches a day                                        |
| The street with the clock against the dark theme at noon                                                                   | Task 7 step 2                                                                            |

## Where this piece is larger or riskier than the roadmap says

- The roadmap says the eight real logos are not taken. In fact the logos are also drawn by hand inside eight shop modules and a bank's ATM, and real names are in 218 places of `shops.js` alone, in the English text and in code keys. The plan therefore drops the eight modules and swaps names by script; the cost is that the cafés, the phone shop and the pharmacy lose their own interiors.
- The street touches `outings.js` (122 name hits, a network call), `first-person.js`, `street-life.js` and the page's styles, not just the backdrop. Kept-local files of earlier pieces (`core/env.js` and others) may lack exports it needs.
- The one asset needs its own generated file and RPC, and the setting's default depends on the device.

---

### After the tasks (controller, with the owner's go-ahead)

Final whole-branch review, with a second read of the diff for any real name or logo; fixes; merge to `main`; push; CI green (including `check:world`, which now covers two generated files); `paseo plugin update office --ref <commit>` on the owner's host; the owner looks on desktop and on the phone (street on and off on both, the memory of the phone's app with it on, a walk to the street, the shop signs, the dark theme at midday); then tag `v0.9.0` and write its release notes: the street is a setting; its names are made up; the cafés, phone shop and pharmacy are plain shops; the README's data section gains the car models.
