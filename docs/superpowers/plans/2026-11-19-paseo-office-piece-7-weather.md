# paseo-office piece 7: seasons, rain and weather Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 3D floor wears my-office's seasonal decorations by the date and, when the owner chooses, draws weather outside: by hand, by the season, or from an address the host's server reads.

**Architecture:** my-office's `life/seasons.js`, `life/rain.js` and `life/weather.js` are taken; only `weather.js` needs changes by hand (its fetch, page elements and city list go), and it gains one call, `setWeather`, that draws a WMO weather code, a temperature and a cloud share it is handed. A host setting "Weather" (Off, Manual, From a service) is resolved by a new server service that reads the address on its own timer while an office is open, and the result reaches every office as an optional `weather` field of the `office.state` snapshot; the client passes the scene one small object and shows a failed read in Attention.

**Tech Stack:** TypeScript and React Native in a Paseo plugin (`/workspace/QFlavours/paseo-office`), `@getpaseo/plugin` 0.16.2, zod 4, Vitest (jsdom for components), the vendored JavaScript scene (three.js r160), esbuild through `scripts/build-world.mjs`.

**Spec:** `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-paseo-office-roadmap-design.md`, piece 7 ("Seasons, rain and weather"), with the owner's answer on weather in "The owner's answers" and the rules in "What binds every piece".

## Facts read from the code, which the decisions rest on

- **What "seasons" are upstream.** `office/core/env.js` sets `SEASON` once, at start, from the viewing device's date: `halloween` from 20 Oct to 1 Nov, `noel` from 12 Dec to 31 Dec, `tet` from 14 days before to 7 days after the Vietnamese lunar new year (the table `TET` in `src/shared/workdays.js`, 2026 to 2033). Otherwise `null`. There is no hemisphere and no spring, summer, autumn or winter. The port's `env.js` copy already runs this code. So Christmas hats on people (`people/workers.js`) and the string lights' colours (`world/props/string-lights.js`) follow the season today; what is missing is the decorations of `life/seasons.js`.
- **What upstream's weather draws** (`life/weather.js`, `life/rain.js`): rain streaks falling around the building and never inside it (3,600 lines, a share of them by the rain's strength), the sun dimmed by cloud and rain, fog that closes in for fog codes, storm flashes with thunder, and at the entrance an open umbrella drying on the floor, puddles and a yellow wet-floor sign while it rains. `rain.js` also builds an umbrella stand at the entrance that is there in every weather. Upstream has no rain on the window glass: the windows show a painted picture (`world/windows.js`, `cityDay` and `cityNight`) and the port's plain backdrop still hands them to `THEME.wins`.
- **What reads the weather.** In the port today: `core/loop.js` (`updateWeather`), `world/room-update.js` (`applyWeather` at the end of `setNight`, `updateSeason` each frame), `interact/props.js` and `interact/first-person.js` (the season's centrepiece prop and its footprints). In upstream, `wx` (the weather state) is read by `people/outings.js` (the street's outings), the street backdrops (`world/backdrops/street-*.js`, `shops.js`, `shop-*.js`), `ui/whiteboard.js` (a debug hook) and `ui/ticks.js` (a clock chip). All of those are the street's, which is piece 8. Nothing on the office floor changes how people behave with the weather.
- **What `seasons.js`, `rain.js` and `weather.js` import** (read in full): `core/env.js`, `core/state.js`, `scene/renderer.js`, `scene/lights.js`, `scene/blocks.js`, `world/entrance.js`, `world/desks.js`, `world/props/trinkets.js`, `world/terrace.js`, `world/layout.js`, `world/room-update.js`, `life/trophies.js`, `audio/sfx.js`, `i18n/index.js`. None imports `world/backdrops/`. `floorBlocks`, which `interact/first-person.js` reads, is `seasons.js`'s own array. So the three files need nothing cut for the backdrop. The street's later need is only that `weather.js` still exports `wx` (with `wx.city` and `wx.temp`, `wx.rain`, `wx.cloud`, `wx.code`).
- **What the import tool does with them.** Run against a copy of the repository with the three paths out of `DENY` and the three stand-ins deleted, `import-upstream.mjs --check` reports `would write: 4` (the three files and `paseo-modules.js`), no missing stand-in export, and the same five kept-local files as today. A real run adds `lifeSeasons`, `lifeRain` and `lifeWeather` to `paseo-modules.js` and moves the three paths from `standIns` to `files` in `MANIFEST.json`. The three files minify to about 23 KB; bundled, the scene grows by about 19 KB (1,115,697 to 1,134,478 bytes, measured with esbuild before the banner).
- **Upstream's network call.** `fetchWeather` in `weather.js` asks `https://api.open-meteo.com/v1/forecast?latitude=<lat>&longitude=<lon>&current=temperature_2m,weather_code,precipitation,cloud_cover&timezone=auto`, from the page, every 15 minutes while the page is visible, for one of eight Vietnamese cities chosen by a chip. It reads three fields of the answer's `current`: `weather_code`, `temperature_2m` and `cloud_cover` (`precipitation` is asked for and never read). If `localStorage` has `office-wx`, upstream's `setup` fetches at load: in the port that would be a network call from the scene, so the file cannot be taken unchanged.
- **How the office fetches on a timer today.** The stand-up notes and the incidents check use `server/local-schedules.ts`: an interval timer that runs whether or not anyone looks, and whose handler waits for the Paseo API (`paseoForRun` in `index.server.ts`). `server/machine/watch.ts` is the other pattern: a chain of timers that exists only while a subscriber is attached. `server/incidents-http.ts` `getJson` has a 30 s timeout, `redirect: "manual"` (a redirect is a problem), and error texts that hold a status and the tracker's first 200 characters, never an address or a header; it has no size limit and its `Tracker` type names Jira or Sentry and a token variable, so it does not fit a tokenless, user-chosen address.
- **Whether the hub can tell that an office is open.** Yes. `hub.watch(listener)` calls the listener with the directory's view while an office is attached and with `null` when the last subscriber leaves (`idle()`); the directory runs only while `subscribers.size > 0`. `index.server.ts` already uses it for the chat. `hub.read()` (the stand-up report) opens a directory without telling watchers, so it does not count as an office.
- **How a problem reaches Attention today.** `client/settings-text.ts` turns the two schedule failures into sentences and a "Settings" card of the strip ("1 problem"), opened to the settings page where each sentence stands under its field. A tracker's failed check is `IncidentsState.problems`; `client/incidents-text.ts` `incidentsEntry` makes the strip's "Incidents" card ("N open · a check failed") and the card shows each problem. `StripCard` is `{ title, note: { text, tone }, onOpen }`.
- **Night and day.** `host.night` follows the app's theme: `backdrops.applyNight` calls `setNight`, which sets `sun.intensity` and `hemi.intensity` for night or day and, as its last line, calls `applyWeather()`. `applyWeather` multiplies the sun by `(night ? 0.55 : 1.35) * (1 - dim)`, so a theme change keeps the weather. Upstream's weather never reads the clock and never reads open-meteo's `is_day`.

## Decisions

1. **Take `seasons.js` and `rain.js` unchanged; take `weather.js` with marked changes.** Reason: the first two need nothing cut (no backdrop import, no page markup, no network, no `process.env`); `weather.js` has the fetch, the city list, `$('clock')`, `$('wx-now')`, `#wx-cities` and a `localStorage` read, none of which can run in the port. If wrong: each later upstream update needs `weather.js` compared by hand (the tool keeps it, as it keeps five other files).
2. **`weather.js` draws what it is given.** The fetch, `WX_CITIES`, `cityName`, `WX_TEXT`, `WX_ICON`, `wxChip`, `setup`, and every `$(...)` and `[data-wx]` line go. A new `setWeather(reading | null)` takes upstream's own derivation (`storm`, `fog`, `rain` from the code) and calls `applyWeather()`. `wx` keeps all its fields, `city` always `''`, so piece 8's street code that reads `wx.city`, `wx.temp`, `wx.rain` finds them. Cost if wrong: piece 8 may want a field this does not set; it adds it then.
3. **What shows today, with the plain backdrop.** Season decorations on the floor, walls and ceiling, the flying bats and the lobby ghost, the umbrella stand; rain streaks around the floor against the backdrop colour; the dimmed light, fog, storm flashes and (with piece 2's sounds on) thunder; the umbrella, puddles and wet-floor sign at the entrance. Not shown, because upstream has none: rain on the windows, and any change in how people behave (the readers are the street's). What waits for piece 8: people going out for a cold drink in the heat, riders and shop crowds that follow rain, the street's own look in rain. The owner who wants drops on the window glass is asking for a new feature, not this piece.
4. **Seasons follow upstream.** The viewing device's date, three windows, Vietnam's lunar table to 2033, no hemisphere, no setting and no off switch. Reason: the code needs none, the roadmap says to follow upstream, and Christmas hats and string lights are already on the same rule. Cost: a Saudi or southern host sees Christmas and Lunar New Year decorations by the Gregorian date and Vietnam's calendar; after 2033 there is no Lunar New Year until the table is taken from a newer my-office. A season that begins while an office is open shows after the scene restarts (upstream builds it once).
5. **"Follow the season" is a small table of the port's own:** Halloween is cloudy (code 3, cloud 0.9), every other season and no season is clear (the same as Off). Reason: upstream has no weather by season, the owner's design names the choice and the fallback, and cloud is the one mood that suits a decoration and costs nothing. Cost: it is mine, not upstream's; one constant (`SEASON_WEATHER`) changes it.
6. **The server resolves the setting; the scene gets one object.** The scene is given `{ kind: "none" }`, `{ kind: "season" }` (the scene's own `SEASON` picks the weather) or `{ kind: "reading", code, temp, cloud }`. Manual's clear, cloudy, rain and storm become readings on the server (`presetReading`: clear 0, cloudy 3, rain 63, storm 95; cloud 0, 0.9, 0.9, 1). Reason: one place decides, the client reads no weather setting, and the scene never sees an address. Cost: a change of the setting reaches devices through the snapshot, not at once from the page (a save and a snapshot, under a second).
7. **The setting.** Three fields in the host settings document: `weatherMode` (`off`, `manual`, `service`; default `off`), `weatherManual` (`clear`, `cloudy`, `rain`, `storm`, `season`; default `season`) and `weatherUrl` (default empty). The version number goes up by one (the schema's current version is 4 on today's `main`, and piece 3 probably made it 5); the new fields have defaults and `migrate` is untouched. A non-empty `weatherUrl` is refused by the schema unless it passes the Sentry address's rule (`isTokenSafe`: https, or http on `localhost`, `127.*` or `[::1]`), whatever the mode. The refusal text does not hold the address (it may carry a key). Reason: the owner's design. Cost: a weather service on a LAN over plain http is refused; the user puts https in front or serves it on the host.
8. **The answer's shape** is open-meteo's `current` block. Required: `current.weather_code` (integer 0 to 99, a WMO code) and `current.temperature_2m` (a number, in degrees Celsius as open-meteo gives it). Optional: `current.cloud_cover` (0 to 100; when absent or not a number it is worked out from the code by `cloudFromCode`). Accepted and ignored: `current.is_day` and every other key. Reason: upstream's own three fields; the roadmap's "day or night" is read as accepted but not used, because the port's night follows the app's theme and a service's `is_day` would fight it. Cost: a user who expects the service's night to darken the office is wrong, and the docs say so.
9. **A separate small reader, not `getJson`.** `server/weather-read.ts`: a GET with `Accept: application/json` and nothing else, 10 s timeout, `redirect: "manual"` (a redirect is a problem, so only the checked address is ever read), a 64 KB cap read from the stream, error texts that hold a status or an error code and never the address, a header or the body's words. Reason: no token, a user's own endpoint may be anything, and `getJson`'s names and 401 text are the trackers'. Cost: a second fetch function of about 70 lines.
10. **When it fetches.** At most once in 15 minutes for one address, counting every attempt, a failure too (no quicker retry); only while an office is open (`hub.watch`); at once when an office opens and the last attempt is 15 minutes old or none; at once when the address changes. A timer chain on the plugin's `Clock` (as `server/machine/watch.ts`), not `local-schedules.ts`: that engine runs when nobody looks and waits for the Paseo API, and this needs neither. Nothing is stored: after a restart the first open office fetches. A reading is drawn for at most 30 minutes (two intervals); after that the scene shows the season's weather until an answer comes. Cost: an office opened after a long absence shows the season's weather for the length of one request (up to 10 s on a dead address).
11. **Failure.** A failed or malformed answer sets `scene` to `{ kind: "season" }` at once (no stale reading kept), keeps one sentence in `problem`, logs it once per change (never the address), and tries again at the next 15 minutes. The strip gets a "Weather" card with the sentence (warning tone) that opens the settings page, where the sentence stands under the address field. An empty address in "From a service" is not a failure: the season's weather shows, no card, and the field's line says so.
12. **No new switch for seasons, no phone or device setting for weather.** Weather is a host setting only; the 2D floor and the List never change with it.
13. **`client/choice-pills.tsx` is new.** The settings page has no control for "one of N" yet (the view switch and the stand-up days are their own). If piece 3 made a reusable one for the Floor plan, use it and skip this file's creation (its test cases still apply to the screen). `SettingField` moves unchanged to `client/setting-field.tsx` so the weather fields can use it without a circular import.

## Assumes from earlier pieces

Each of these is to be re-checked when this piece starts.

- **Piece 2 (sounds):** `audio/sfx.js` is upstream's, exporting `sfx`; `sfx.play('thunder')` then sounds. If piece 2 is not in, thunder is silent and nothing else changes (`weather.js` only imports `sfx`).
- **Piece 3 (floor plans):** the host settings schema has gained a `floorPlan` field and its version is 5 or more; `PLAN` in `client/world/use-world-feed.ts` may now come from the setting. This plan adds one input to `useWorldFeed` and does not touch the plan. Fixtures that build a whole `HostValues` already carry `floorPlan`. `cozy` runs the seasons' and rain's `else` branches, which exist upstream.
- **Piece 5 (staff and daily life):** it may have extended the stand-ins of `life/seasons.js`, `life/rain.js` or `life/weather.js` with names its scenes import (for example `wetSign` from `rain.js`, `wx` from `weather.js`). Deleting the stand-ins is right: upstream's exports are a superset, and the import tool names any export still missing. It may also have raised the bundle size cap in `server/world-script.test.ts`.
- **Piece 6 (headquarters):** `hq` is offered; the season's decorations stand on the company floor's coordinates only, as upstream has them (the wing has none).
- **Piece 1 (session tabs):** `client/office-surface.tsx` still builds the strip's cards in one `useMemo` beside `incidentsStripEntry` and `settingsStripEntry`.
- **Pieces 4 to 6 and this tree:** `vendor/my-office/src/office/world/backdrops/` is still the plain stand-in (piece 8 is not built); `import-upstream.mjs`'s `DENY` still has `life/(seasons|rain|weather|...)` in one alternation; `paseo-entry.js` still sets `PaseoOfficeWorld`; `i18n/index.js`'s `OURS` has no `props.season.hint` yet.

## Global Constraints

- Work in `/workspace/QFlavours/paseo-office` on a branch `feat/weather` cut from `main`. The repo is public: nothing private in files, fixtures or commit messages (fixtures use made-up addresses on `127.0.0.1`, `weather.example.test`, the example coordinates of open-meteo's own docs, and "Acme"); no AI attribution on commits; never push, never `gh` (the controller publishes).
- What my-office's author asked: the MIT licence and notice kept; every change by hand to a copied file starts `// PASEO:` and is listed in `vendor/SOURCES.md`; his files are taken unchanged wherever they can be.
- The scene makes no network call. The one outside call is the weather service the user named, made by the plugin's server on the host. The scene is never given the address, a header, a problem sentence or an answer's other keys, only `{ code, temp, cloud }`.
- Nothing prints, logs or shows an address in an error: it may carry a key. Error texts hold a status or an error code only.
- App-side code (`client/`, `shared/`) uses nothing a phone's engine lacks: `client/engine-compat.test.ts` stays green (no `toSorted`, `toReversed`, `findLast`, `Object.groupBy`, set methods). `shared/weather.ts` and `shared/contracts.ts` are loaded by the app.
- Only stock Paseo 0.16's SDK. The plugin's server uses `deps.clock` and Node's `fetch`; no new SDK call.
- Styles in `client/styles.ts`, never inline objects. `OfficeSurface` stays under the lint complexity limit of 20: new logic goes in small components and hooks.
- The 2D floor (`client/pixel/`), the List and the 2D floor's models are not changed. `git diff --stat main` must show no file under `client/pixel/`.
- Cross-platform: no `onPointerEnter` or `onPointerLeave`; pills are `Pressable`s like `client/notes-days.tsx`.
- Never run a bare `paseo` command and never start, stop or restart the daemon on port 6767. A throwaway daemon uses `PASEO_HOME=/tmp/office-stock-home`, port 6798, `env -i`, and the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`. `daemon status` must show 6798 and that home before any plugin command.
- Checks after each task: `npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts`, and the test files touched; the whole suite (`npm test -- --maxWorkers=4`, output to a file under /tmp) before each commit. After a change under `vendor/`, `npm run build:world` first.

---

### Task 1: The setting, the contract and the pure rules

**Files:**

- Create: `shared/weather.ts`
- Test: `shared/weather.test.ts`
- Modify: `shared/settings.ts`, `shared/contracts.ts`, `shared/settings.test.ts`, `shared/contracts.test.ts`
- Modify (fixtures only): every test that builds a whole host settings value: `client/host-switches.mounted.test.tsx` (`NO_TRACKERS` users), `index.server.test.ts`, `server/notes-schedule.test.ts`, `server/notes-files.test.ts`

**Interfaces:**

- Produces, in `shared/weather.ts`:

```ts
/** A weather the scene can draw: a WMO weather code, a temperature (null: unknown), and cloud as a share, 0 to 1. */
export interface WeatherReading {
  code: number;
  temp: number | null;
  cloud: number;
}
export const WEATHER_MODES = ["off", "manual", "service"] as const;
export type WeatherMode = (typeof WEATHER_MODES)[number];
export const MANUAL_CHOICES = ["clear", "cloudy", "rain", "storm", "season"] as const;
export type ManualChoice = (typeof MANUAL_CHOICES)[number];
export const MANUAL_LABELS: Readonly<Record<ManualChoice, string>>;
/** clear 0, cloudy 3, rain 63, storm 95; the weather a hand-picked choice draws. */
export function presetReading(choice: Exclude<ManualChoice, "season">): WeatherReading;
/** The cloud share a code implies when a service sends none: 0 clear, 0.3 mainly clear or partly cloudy, 0.9 overcast and fog, 1 for rain, snow and storms. */
export function cloudFromCode(code: number): number;
/** The code in words, with upstream's thresholds: "clear sky", "partly cloudy", "overcast", "fog", "drizzle", "rain", "snow", "rain showers", "thunderstorm". */
export function weatherWords(code: number): string;
export const WEATHER_ADDRESS_EXAMPLE: string;
```

- Produces, in `shared/settings.ts`: `officeHostSettings` with `weatherMode`, `weatherManual`, `weatherUrl`; `isTokenSafe` exported.
- Produces, in `shared/contracts.ts`:

```ts
export const WeatherSceneSchema: z.ZodDiscriminatedUnion; // none | season | reading
export type WeatherScene = z.output<typeof WeatherSceneSchema>;
export const WeatherStateSchema: z.ZodObject; // { scene, problem: string | null, readAt: number | null }
export type WeatherState = z.output<typeof WeatherStateSchema>;
// OfficeSnapshotSchema gains: weather: WeatherStateSchema.optional()
```

- [ ] **Step 1: Write the failing tests for `shared/weather.ts`**

```ts
// shared/weather.test.ts
import { expect, test } from "vitest";
import {
  MANUAL_CHOICES,
  WEATHER_ADDRESS_EXAMPLE,
  cloudFromCode,
  presetReading,
  weatherWords,
} from "./weather.js";

test("the hand-picked choices are the codes upstream's rain and light read", () => {
  expect(presetReading("clear")).toEqual({ code: 0, temp: null, cloud: 0 });
  expect(presetReading("cloudy")).toEqual({ code: 3, temp: null, cloud: 0.9 });
  expect(presetReading("rain")).toEqual({ code: 63, temp: null, cloud: 0.9 });
  expect(presetReading("storm")).toEqual({ code: 95, temp: null, cloud: 1 });
});

test("the choices are the five the settings page offers, the season last", () => {
  expect(MANUAL_CHOICES).toEqual(["clear", "cloudy", "rain", "storm", "season"]);
});

test("a code with no cloud share gets the share its words imply", () => {
  expect(cloudFromCode(0)).toBe(0);
  expect(cloudFromCode(1)).toBe(0.3);
  expect(cloudFromCode(2)).toBe(0.3);
  expect(cloudFromCode(3)).toBe(0.9);
  expect(cloudFromCode(45)).toBe(0.9);
  expect(cloudFromCode(61)).toBe(1);
  expect(cloudFromCode(95)).toBe(1);
});

test("a code in words, with upstream's thresholds", () => {
  const words = (codes: number[]) => codes.map(weatherWords);
  expect(words([0, 1, 2, 3, 45, 48])).toEqual([
    "clear sky",
    "partly cloudy",
    "partly cloudy",
    "overcast",
    "fog",
    "fog",
  ]);
  expect(words([51, 57, 61, 67, 71, 77, 80, 82, 95, 99])).toEqual([
    "drizzle",
    "drizzle",
    "rain",
    "rain",
    "snow",
    "snow",
    "rain showers",
    "rain showers",
    "thunderstorm",
    "thunderstorm",
  ]);
});

test("the example address has a latitude and a longitude and asks for the three fields read", () => {
  const url = new URL(WEATHER_ADDRESS_EXAMPLE);
  expect(url.protocol).toBe("https:");
  expect(url.searchParams.get("latitude")).toBe("52.52");
  expect(url.searchParams.get("longitude")).toBe("13.41");
  expect(url.searchParams.get("current")).toBe("temperature_2m,weather_code,cloud_cover");
});
```

Settings tests, added to `shared/settings.test.ts` (it already has `hostIssues` and `upgraded`):

```ts
const WEATHER_DEFAULTS = { weatherMode: "off", weatherManual: "season", weatherUrl: "" };

test("a host that never set the weather has it off, following the season, with no address", async () => {
  expect(officeHostSettings.schema.parse({})).toMatchObject(WEATHER_DEFAULTS);
  // A document of the version before this one (read its number in settings.ts) parses to the same.
  expect(await upgraded({ agentTools: true }, officeHostSettings.version - 1)).toMatchObject(
    WEATHER_DEFAULTS,
  );
});

test("the weather mode and the hand-picked choice are from their lists", () => {
  expect(hostIssues({ weatherMode: "radar" })).not.toEqual([]);
  expect(hostIssues({ weatherManual: "snow" })).not.toEqual([]);
  expect(hostIssues({ weatherMode: "service", weatherManual: "storm" })).toEqual([]);
});

test("the weather address is empty, https, or http on this machine", () => {
  const refused = ["weatherUrl: not an https address (plain http only on this machine)"];
  expect(hostIssues({ weatherUrl: "" })).toEqual([]);
  expect(hostIssues({ weatherUrl: "https://weather.example.test/v1/forecast?x=1" })).toEqual([]);
  expect(hostIssues({ weatherUrl: "http://127.0.0.1:9000/weather.json" })).toEqual([]);
  expect(hostIssues({ weatherUrl: "http://localhost:9000/weather.json" })).toEqual([]);
  expect(hostIssues({ weatherUrl: "http://[::1]:9000/weather.json" })).toEqual([]);
  expect(hostIssues({ weatherUrl: "http://weather.example.test/x" })).toEqual(refused);
  expect(hostIssues({ weatherUrl: "weather.example.test" })).toEqual(refused);
  expect(hostIssues({ weatherUrl: "ftp://127.0.0.1/x" })).toEqual(refused);
});

test("the weather address is checked in every mode, and its refusal does not hold it", () => {
  const secret = "http://weather.example.test/x?apikey=SECRET";
  for (const weatherMode of ["off", "manual", "service"]) {
    const issues = hostIssues({ weatherMode, weatherUrl: secret });
    expect(issues).toHaveLength(1);
    expect(issues[0]).not.toContain("SECRET");
    expect(issues[0]).not.toContain("weather.example.test");
  }
});
```

Contract tests, added to `shared/contracts.test.ts` in its style (read the file's existing snapshot tests):

- A snapshot with no `weather` parses (an office whose server has not read the settings).
- A snapshot with `weather: { scene: { kind: "reading", code: 63, temp: 14.2, cloud: 0.9 }, problem: null, readAt: 1000 }` parses; so do `{ kind: "none" }` and `{ kind: "season" }` with `problem: "x"`.
- Refused: `code: 100`, `code: 1.5`, `cloud: 1.1`, `kind: "storm"`.
- A `weather` key an older client does not know is stripped, not an error (parse a snapshot with `weather` through the schema as it was: assert the older fields are intact; this is the schema's default and the test pins it).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run shared/weather.test.ts shared/settings.test.ts shared/contracts.test.ts`
Expected: FAIL: `./weather.js` is missing; `weatherMode` is not a key of the parsed settings; the contract tests find no `weather` in the snapshot schema.

- [ ] **Step 3: Write `shared/weather.ts`**

```ts
export interface WeatherReading {
  code: number;
  temp: number | null;
  cloud: number;
}

export const WEATHER_MODES = ["off", "manual", "service"] as const;
export type WeatherMode = (typeof WEATHER_MODES)[number];

export const MANUAL_CHOICES = ["clear", "cloudy", "rain", "storm", "season"] as const;
export type ManualChoice = (typeof MANUAL_CHOICES)[number];

export const MANUAL_LABELS: Readonly<Record<ManualChoice, string>> = {
  clear: "Clear",
  cloudy: "Cloudy",
  rain: "Rain",
  storm: "Storm",
  season: "Follow the season",
};

const PRESETS: Readonly<Record<Exclude<ManualChoice, "season">, WeatherReading>> = {
  clear: { code: 0, temp: null, cloud: 0 },
  cloudy: { code: 3, temp: null, cloud: 0.9 },
  rain: { code: 63, temp: null, cloud: 0.9 },
  storm: { code: 95, temp: null, cloud: 1 },
};

export function presetReading(choice: Exclude<ManualChoice, "season">): WeatherReading {
  return { ...PRESETS[choice] };
}

export function cloudFromCode(code: number): number {
  if (code === 0) return 0;
  if (code <= 2) return 0.3;
  return code <= 48 ? 0.9 : 1;
}

export function weatherWords(code: number): string {
  if (code === 0) return "clear sky";
  if (code <= 2) return "partly cloudy";
  if (code === 3) return "overcast";
  if (code <= 48) return "fog";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  return "thunderstorm";
}

/** The settings page's example: open-meteo's forecast with the three fields the office reads. Not a default. */
export const WEATHER_ADDRESS_EXAMPLE =
  "https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,weather_code,cloud_cover";
```

`weatherWords` repeats upstream's thresholds (`c === 0 ? clear : c <= 2 ? partly : c === 3 ? cloudy : c <= 48 ? fog : c <= 57 ? drizzle : c <= 67 ? rain : c <= 77 ? snow : c <= 82 ? showers : storm`) and the words of `life.weather.*` in upstream's English locale.

- [ ] **Step 4: The settings and the contract**

In `shared/settings.ts`:

- `import { MANUAL_CHOICES, WEATHER_MODES } from "./weather.js";`
- `function isTokenSafe` becomes `export function isTokenSafe`, and its doc comment gains a second sentence: "The weather address follows the same rule, though no token goes to it."
- `HostValuesSchema` gains, after `sentryUrl`: `weatherMode: z.enum(WEATHER_MODES).default("off"), weatherManual: z.enum(MANUAL_CHOICES).default("season"), weatherUrl: z.string().default("")`.
- In `refuseBadTrackerValues` (or a new `refuseBadWeatherAddress` added to the `.superRefine` chain of `officeHostSettings`; the second is cleaner and keeps the first under the lint limit): when `values.weatherUrl.trim() !== ""` and `!isTokenSafe(values.weatherUrl.trim())`, add the issue `{ code: "custom", path: ["weatherUrl"], message: "weatherUrl: not an https address (plain http only on this machine)" }`. The message holds no part of the address.
- `officeHostSettings.version` goes up by one. The comment above `migrate` gains: "The weather fields came after version N-1: a document without them takes their defaults." (write the real numbers). `migrate` is unchanged.
- The doc comment of `officeHostSettings` gains: "`weatherMode` is off, a hand-picked weather (`weatherManual`) or an address the host reads (`weatherUrl`), which is kept as typed."

In `shared/contracts.ts`, after `IncidentsStateSchema`:

```ts
/** What the 3D scene is told of the weather. `season` leaves the weather to the scene's own season. */
export const WeatherSceneSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }),
  z.object({ kind: z.literal("season") }),
  z.object({
    kind: z.literal("reading"),
    /** A WMO weather code. */
    code: z.number().int().min(0).max(99),
    /** Degrees Celsius; null when not known. */
    temp: z.number().nullable(),
    /** Cloud as a share, 0 to 1. */
    cloud: z.number().min(0).max(1),
  }),
]);
export type WeatherScene = z.output<typeof WeatherSceneSchema>;

/** The weather the host holds: what the scene draws, why a service could not be read, and when it last was. */
export const WeatherStateSchema = z.object({
  scene: WeatherSceneSchema,
  /** Why the service's last read failed, one sentence that never holds the address; null once one succeeds. */
  problem: z.string().nullable(),
  /** Epoch ms of the answer the scene is drawing; null when it draws no service's answer. */
  readAt: z.number().nullable(),
});
export type WeatherState = z.output<typeof WeatherStateSchema>;
```

and `OfficeSnapshotSchema` gains, after `incidents`: `/** Absent until the office's server has read its settings. */ weather: WeatherStateSchema.optional(),`.

Then fix the fixtures: `npm run typecheck` names each test literal that now lacks the three fields. Add to each one `weatherMode: "off", weatherManual: "season", weatherUrl: ""` (in `host-switches.mounted.test.tsx` and `index.server.test.ts` as a `NO_WEATHER` constant beside `NO_TRACKERS`; in the settings test `INCIDENT_DEFAULTS`'s siblings).

- [ ] **Step 5: Run, check, commit**

```bash
npx vitest run shared/weather.test.ts shared/settings.test.ts shared/contracts.test.ts client/engine-compat.test.ts
npm run format:check && npm run lint && npm run typecheck
git add -A && git commit -m "feat: a Weather setting, its pure rules and a weather field in the office's snapshot"
```

Expected: all pass; the whole suite is green too (the fixtures were the only breakage).

---

### Task 2: Reading the service

**Files:**

- Create: `server/weather-read.ts`
- Test: `server/weather-read.test.ts`

**Interfaces:**

- Consumes: `WeatherReading`, `cloudFromCode` (Task 1).
- Produces:

```ts
export class WeatherProblem extends Error {} // name "WeatherProblem"; its message is shown and logged: no address, header or body words
export const WEATHER_TIMEOUT_MS = 10_000;
export const WEATHER_MAX_BYTES = 65_536;
export interface WeatherReaderOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}
/** One GET of the address. Rejects with a WeatherProblem. */
export function createWeatherReader(
  options?: WeatherReaderOptions,
): (address: string) => Promise<WeatherReading>;
```

- [ ] **Step 1: Write the failing tests**

A local server stands in for the service, as `server/incidents-sentry.test.ts` does (copy its `standIn` helper: it records each request's path and headers, answers through a function, and closes in `afterEach`). Cases, each against `http://127.0.0.1:<port>/...`:

- The sample below gives `{ code: 63, temp: 14.2, cloud: 0.9 }`; the request had `accept: application/json` and no `authorization`, no `cookie`.

```json
{
  "latitude": 52.52,
  "longitude": 13.419998,
  "utc_offset_seconds": 3600,
  "timezone": "Europe/Berlin",
  "current_units": {
    "time": "iso8601",
    "interval": "seconds",
    "temperature_2m": "°C",
    "weather_code": "wmo code",
    "cloud_cover": "%"
  },
  "current": {
    "time": "2026-11-19T10:00",
    "interval": 900,
    "temperature_2m": 14.2,
    "weather_code": 63,
    "cloud_cover": 90,
    "is_day": 1
  }
}
```

- The smallest answer, `{"current":{"weather_code":3,"temperature_2m":4}}`, gives `{ code: 3, temp: 4, cloud: 0.9 }` (the cloud share worked out from the code); `{"current":{"weather_code":61,"temperature_2m":8,"cloud_cover":"lots"}}` gives cloud `1` (a bad optional field is ignored, not an error); `cloud_cover: 140` gives cloud `1`, `-5` gives `0`.
- `is_day: 0` changes nothing in the result.
- Problems, each a `WeatherProblem` whose message is exactly: no `current` -> `The weather service answered in a shape the office does not read: it needs current.weather_code and current.temperature_2m`; `weather_code: 100`, `3.5`, `"3"` and a missing `temperature_2m` or a string one, the same message; a body that is not JSON (an HTML page) the same message; HTTP 503 -> `The weather service answered HTTP 503` even when the body says `{"reason":"SECRET words"}` (the message must not contain `SECRET`); HTTP 301 with a `Location` to the same server -> `The weather service answered with a redirect (HTTP 301)` and the server saw one request only; a 70,000-byte body -> `The weather service's answer is larger than 64 KB`; a server that never answers, with `timeoutMs: 50` -> `The weather service did not answer in 0.05 s` (build the text from `timeoutMs / 1000`, so the default reads `10 s`); a closed port -> `The weather service could not be reached: ECONNREFUSED`.
- For every problem above, the address used has `?apikey=SECRET` in its query and the message contains neither `SECRET`, `127.0.0.1` nor the port.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run server/weather-read.test.ts`
Expected: FAIL, cannot find `./weather-read.js`.

- [ ] **Step 3: Write the reader**

```ts
import { z } from "zod";
import { cloudFromCode, type WeatherReading } from "../shared/weather.js";

export class WeatherProblem extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WeatherProblem";
  }
}

export const WEATHER_TIMEOUT_MS = 10_000;
export const WEATHER_MAX_BYTES = 65_536;

/**
 * open-meteo's `current` block, as upstream's weather read it: the code and the temperature are
 * required, the cloud cover is used when it is a number. `is_day` and every other key are left
 * out on purpose: the scene's night follows the app's theme.
 */
const AnswerSchema = z.object({
  current: z.object({
    weather_code: z.number().int().min(0).max(99),
    temperature_2m: z.number(),
    cloud_cover: z.number().optional().catch(undefined),
  }),
});

const SHAPE =
  "The weather service answered in a shape the office does not read: it needs current.weather_code and current.temperature_2m";

export interface WeatherReaderOptions {
  fetchFn?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

/** A failed request's own text can hold the address: only its code is safe to say. */
function unreachable(error: unknown, timeoutMs: number): WeatherProblem {
  if (error instanceof Error && error.name === "TimeoutError") {
    return new WeatherProblem(`The weather service did not answer in ${timeoutMs / 1000} s`);
  }
  const cause = error instanceof Error ? error.cause : undefined;
  const code =
    cause instanceof Error && "code" in cause && typeof cause.code === "string" ? cause.code : null;
  return new WeatherProblem(
    code === null
      ? "The weather service could not be reached"
      : `The weather service could not be reached: ${code}`,
  );
}

/** The body as text, or null once it passes `max` bytes (the rest is not read). */
async function boundedText(response: Response, max: number): Promise<string | null> {
  const reader = response.body?.getReader();
  if (reader === undefined) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export function createWeatherReader(
  options: WeatherReaderOptions = {},
): (address: string) => Promise<WeatherReading> {
  const fetchFn = options.fetchFn ?? fetch;
  const timeoutMs = options.timeoutMs ?? WEATHER_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? WEATHER_MAX_BYTES;
  return async (address) => {
    let response: Response;
    let text: string | null;
    try {
      response = await fetchFn(address, {
        headers: { Accept: "application/json" },
        // Only the address that was checked is read: a redirect could lead anywhere.
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      text =
        response.status >= 300 && response.status < 400
          ? ""
          : await boundedText(response, maxBytes);
    } catch (error) {
      throw unreachable(error, timeoutMs);
    }
    const { status } = response;
    if (status >= 300 && status < 400) {
      throw new WeatherProblem(`The weather service answered with a redirect (HTTP ${status})`);
    }
    if (!response.ok) throw new WeatherProblem(`The weather service answered HTTP ${status}`);
    if (text === null) {
      throw new WeatherProblem(`The weather service's answer is larger than ${maxBytes / 1024} KB`);
    }
    const parsed = AnswerSchema.safeParse(parseBody(text));
    if (!parsed.success) throw new WeatherProblem(SHAPE);
    const { weather_code: code, temperature_2m: temp, cloud_cover: cover } = parsed.data.current;
    const cloud = cover === undefined ? cloudFromCode(code) : Math.min(1, Math.max(0, cover / 100));
    return { code, temp, cloud };
  };
}
```

`status` is read after the `try`: a 3xx is checked before the body is read, so a redirect's body is never taken. If `tsc` objects to `response.body?.getReader()` on the `Response` type of the repo's Node types, type it through `ReadableStream<Uint8Array>`; do not use `any`.

- [ ] **Step 4: Run, check, commit**

```bash
npx vitest run server/weather-read.test.ts
npm run format:check && npm run lint && npm run typecheck
git add -A && git commit -m "feat: the weather service's answer is read with a timeout, a size cap and no address in its errors"
```

---

### Task 3: The weather service and the hub

**Files:**

- Create: `server/weather-service.ts`
- Test: `server/weather-service.test.ts`
- Modify: `server/hub.ts`, `server/hub.test.ts`, `index.server.ts`, `index.server.test.ts`

**Interfaces:**

- Consumes: `WeatherState`, `WeatherScene` (Task 1); `presetReading`, `WeatherReading`, `ManualChoice`, `WeatherMode` (Task 1); `isTokenSafe`; `WeatherProblem`, `createWeatherReader` (Task 2); `Clock` from `server/timers.ts`.
- Produces:

```ts
export const WEATHER_EVERY_MS = 900_000; // 15 minutes
export const WEATHER_STALE_MS = 1_800_000; // a reading is drawn for 30 minutes
export interface WeatherSettings {
  weatherMode: WeatherMode;
  weatherManual: ManualChoice;
  weatherUrl: string;
}
export interface WeatherPorts {
  clock: Clock;
  read(address: string): Promise<WeatherReading>;
  changed(state: WeatherState): void;
  log(message: string): void;
}
export interface WeatherService {
  /** The host settings were read or saved. */
  settingsChanged(settings: WeatherSettings): void;
  /** An office is open on some device, or none is. */
  officeOpen(open: boolean): void;
  stop(): void;
}
export function createWeatherService(ports: WeatherPorts): WeatherService;
```

- Hub gains `setWeather(state: WeatherState): void` (the same state again sends nothing; each change broadcasts a snapshot, as `setIncidents` does) and the snapshot carries `weather` once set.

- [ ] **Step 1: Write the failing service tests**

With `createFakeClock` and `settle` from `server/fake-clock.ts`, a recording `read` whose answers a test sets (resolve, reject with `new WeatherProblem("The weather service answered HTTP 503")`, or hold), and a `changed` that keeps the last state. A helper `service(overrides)` returns `{ clock, reads: string[], states: WeatherState[], logs: string[], svc }`. `ADDRESS = "http://127.0.0.1:9/weather.json"`, `RAIN = { code: 63, temp: 14.2, cloud: 0.9 }`. Cases:

1. Nothing is pushed before the settings are known, even when an office opens.
2. Off pushes `{ scene: { kind: "none" }, problem: null, readAt: null }` and reads nothing, open or not.
3. Manual with `rain` pushes `{ scene: { kind: "reading", code: 63, temp: null, cloud: 0.9 }, ... }`; with `season` pushes `{ kind: "season" }`; neither reads.
4. Service with no address (empty or spaces) pushes the season, `problem: null`, reads nothing.
5. Service with an address, office closed: pushes the season, reads nothing, however long the clock advances (advance 3 hours: `reads` is empty and `clock.pending()` is 0).
6. The office opens: one read at once; after it the state is `{ scene: { kind: "reading", ...RAIN }, problem: null, readAt: <now> }`.
7. While open the next read comes at 15 minutes and not before: advance 14 minutes, one read; advance 1 more minute, two.
8. The office closes: the timer is cancelled (`clock.pending()` 0). It opens again within 15 minutes of the last read: no new read, the state is pushed with the reading kept, and a timer is armed for the rest of the 15 minutes (advance to the 15-minute mark: two reads in all). It opens again after 15 minutes: a read at once.
9. A reading older than 30 minutes is not drawn: the office closes, 31 minutes pass, it opens with a read held pending: the state pushed on opening is the season with `readAt: null`; when the read resolves, the reading shows.
10. A failed read pushes `{ scene: { kind: "season" }, problem: "The weather service answered HTTP 503", readAt: null }`, logs `[office] weather: The weather service answered HTTP 503` once (a second failure with the same text logs nothing more), and tries again at 15 minutes, not sooner (advance 14 minutes: one read). A later success clears `problem`.
11. A reader that throws something that is not a `WeatherProblem` pushes the problem `The weather check failed`; no part of the error's text is in the state or the log.
12. A changed address reads at once (a second read, the second address), whatever the last read's age; saving the same address again (or switching to manual and back within 15 minutes) reads nothing.
13. A read in flight for an address that was changed meanwhile is dropped: when it resolves, the state still shows the new address's situation, and the new address is read.
14. An address that fails `isTokenSafe` (`http://weather.example.test/x`) pushes the season with the problem `The weather address is not an https address (plain http only on this machine)` and reads nothing; the problem text holds no part of the address.
15. Switching from service to off cancels the timer and pushes `none`; `stop()` cancels the timer; nothing is pushed after it.
16. A second `officeOpen(true)` while open changes nothing (no second read, one timer).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run server/weather-service.test.ts`
Expected: FAIL, cannot find `./weather-service.js`.

- [ ] **Step 3: Write the service**

```ts
import type { WeatherScene, WeatherState } from "../shared/contracts.js";
import { isTokenSafe } from "../shared/settings.js";
import {
  presetReading,
  type ManualChoice,
  type WeatherMode,
  type WeatherReading,
} from "../shared/weather.js";
import type { Clock } from "./timers.js";
import { WeatherProblem } from "./weather-read.js";

export const WEATHER_EVERY_MS = 900_000;
export const WEATHER_STALE_MS = 1_800_000;
/** A timer can fire a little early. */
const DUE_SLACK_MS = 1000;
const UNSAFE = "The weather address is not an https address (plain http only on this machine)";
const SEASON: WeatherScene = { kind: "season" };

export interface WeatherSettings {
  weatherMode: WeatherMode;
  weatherManual: ManualChoice;
  weatherUrl: string;
}

export interface WeatherPorts {
  clock: Clock;
  read(address: string): Promise<WeatherReading>;
  changed(state: WeatherState): void;
  log(message: string): void;
}

export interface WeatherService {
  settingsChanged(settings: WeatherSettings): void;
  officeOpen(open: boolean): void;
  stop(): void;
}

/** The last attempt at an address: its answer or its problem. */
interface Attempt {
  address: string;
  at: number;
  reading: WeatherReading | null;
  problem: string | null;
}

/**
 * Holds what the 3D scene is told of the weather. A service is read while an office is open: at
 * once when one opens, when the address changes, and 15 minutes after each attempt, a failed one
 * too. Nothing is read while no office is open, and nothing is kept across a restart.
 */
export function createWeatherService(ports: WeatherPorts): WeatherService {
  let settings: WeatherSettings | null = null;
  let open = false;
  let last: Attempt | null = null;
  let cancel: (() => void) | null = null;
  let busy = false;
  let stopped = false;

  /** The address to read: null unless the mode is the service and one is typed. */
  function address(): string | null {
    if (settings === null || settings.weatherMode !== "service") return null;
    const text = settings.weatherUrl.trim();
    return text === "" ? null : text;
  }

  function stateNow(): WeatherState {
    const none = { problem: null, readAt: null };
    if (settings === null || settings.weatherMode === "off")
      return { scene: { kind: "none" }, ...none };
    if (settings.weatherMode === "manual") {
      const choice = settings.weatherManual;
      const scene: WeatherScene =
        choice === "season" ? SEASON : { kind: "reading", ...presetReading(choice) };
      return { scene, ...none };
    }
    const where = address();
    if (where === null) return { scene: SEASON, ...none };
    if (!isTokenSafe(where)) return { scene: SEASON, problem: UNSAFE, readAt: null };
    const kept = last !== null && last.address === where ? last : null;
    const shown =
      kept !== null && kept.reading !== null && ports.clock.now() - kept.at < WEATHER_STALE_MS
        ? { reading: kept.reading, at: kept.at }
        : null;
    return {
      scene: shown === null ? SEASON : { kind: "reading", ...shown.reading },
      problem: kept?.problem ?? null,
      readAt: shown?.at ?? null,
    };
  }

  function publish(): void {
    if (settings !== null) ports.changed(stateNow());
  }

  function disarm(): void {
    cancel?.();
    cancel = null;
  }

  function arm(delay: number): void {
    disarm();
    cancel = ports.clock.setTimeout(() => {
      cancel = null;
      consider();
    }, delay);
  }

  /** Pushes the state, then reads now, waits for the 15 minutes, or does neither. */
  function consider(): void {
    if (stopped) return;
    disarm();
    publish();
    const where = address();
    if (where === null || !isTokenSafe(where) || !open) return;
    const kept = last !== null && last.address === where ? last : null;
    const wait = kept === null ? 0 : kept.at + WEATHER_EVERY_MS - ports.clock.now();
    if (wait > DUE_SLACK_MS) arm(wait);
    else void readNow(where);
  }

  async function readNow(where: string): Promise<void> {
    if (busy) return;
    busy = true;
    let reading: WeatherReading | null = null;
    let problem: string | null = null;
    try {
      reading = await ports.read(where);
    } catch (error) {
      problem = error instanceof WeatherProblem ? error.message : "The weather check failed";
    }
    busy = false;
    if (stopped) return;
    // Changed while it was out: this answer is for an address nobody asked about now.
    if (address() !== where) {
      consider();
      return;
    }
    const before = last !== null && last.address === where ? last.problem : null;
    // Logged when it changes, so a service down all night logs once.
    if (problem !== null && problem !== before) ports.log(`[office] weather: ${problem}`);
    last = { address: where, at: ports.clock.now(), reading, problem };
    consider();
  }

  return {
    settingsChanged(next) {
      settings = next;
      consider();
    },
    officeOpen(next) {
      open = next;
      consider();
    },
    stop() {
      stopped = true;
      disarm();
    },
  };
}
```

`officeOpen(true)` twice reads nothing more: the second `consider` finds a read in flight (`busy`) or an attempt less than 15 minutes old. The first line of `consider` after `disarm` re-arms the timer, so there is one timer at most.

- [ ] **Step 4: The hub**

In `server/hub.ts`:

- `import type { ..., WeatherState } from "../shared/contracts.js";`
- Interface `Hub` gains, after `setIncidents`: `/** The weather the scene is told of; the same state again sends nothing. */ setWeather(weather: WeatherState): void;`
- State, beside `sentIncidents`: `let weather: WeatherState | null = null; let sentWeather = "";`
- `snapshot()` gains, after the incidents line: `...(weather === null ? {} : { weather: { ...weather } }),`
- The returned object gains, after `setIncidents`:

```ts
setWeather(next) {
  const text = JSON.stringify(next);
  if (text === sentWeather) return;
  sentWeather = text;
  weather = { ...next };
  broadcast({ type: "snapshot", state: snapshot() });
},
```

In `server/hub.test.ts`, after the `setIncidents` test and in its style: `setWeather` broadcasts a snapshot carrying `weather` to an attached subscriber; the same state again (a new object, equal) sends nothing; a changed `problem` sends one; a subscriber that attaches later has `weather` in its first snapshot; a snapshot before any `setWeather` has no `weather` key.

- [ ] **Step 5: Wire it into the plugin**

In `index.server.ts`:

- Imports: `createWeatherService` from `./server/weather-service.js`, `createWeatherReader` from `./server/weather-read.js`.
- `OfficePluginDeps` gains `/** The fetch the weather service is read with; a test hands in a recording one. */ fetchFn: typeof fetch;`. `contribute` passes `fetchFn: fetch`; `setup` in `index.server.test.ts` passes `fetchFn: options.fetchFn ?? failingFetch` (an option `fetchFn?: typeof fetch` added to `setup`'s options; `failingFetch` rejects with `new Error("the weather was read")` so a test that reads by accident fails loudly).
- After the `incidents` check is built, before `chat`:

```ts
// The weather: read from the user's address only while an office is open, on its own timers.
const weather = createWeatherService({
  clock: deps.clock,
  read: createWeatherReader({ fetchFn: deps.fetchFn }),
  changed: (state) => hub.setWeather(state),
  log,
});
const stopWatchingWeather = hub.watch((view) => weather.officeOpen(view !== null));
```

- In `followSettings`, directly after the `state.status !== "ready"` early return: `weather.settingsChanged(state.values);`. (Settings that cannot be read leave the weather as it was.)
- In the stop function returned, next to `stopFollowingSettings()`: `stopWatchingWeather(); weather.stop();`.

Tests in `index.server.test.ts`, using `setup`, `openOffice` and the listeners as the incidents tests do (`recorded.listeners`, `follow`): with settings `{ weatherMode: "service", weatherUrl: "http://127.0.0.1:9/w.json" }` and a recording `fetchFn` that answers the sample JSON of Task 2:

- No office open: after `await settle()` the fetch was not called, and the clock has no weather timer.
- `openOffice(...)` and `await settle()`: one fetch of exactly that address with `redirect: "manual"`; the last snapshot event has `state.weather` equal to `{ scene: { kind: "reading", code: 63, temp: 14.2, cloud: 0.9 }, problem: null, readAt: <the fake clock's now> }`.
- `leave()` of the office, then `clock.advance(3 hours)`: still one fetch.
- A save through `follow` that sets `weatherMode: "manual"`, `weatherManual: "storm"` pushes a snapshot whose `weather.scene` is the storm reading and reads nothing more.
- A fetch that fails: `weather.problem` is the reader's sentence and the plugin's `logs` hold one `[office] weather:` line that contains neither the address nor its port.

- [ ] **Step 6: Run, check, commit**

```bash
npx vitest run server/weather-service.test.ts server/hub.test.ts index.server.test.ts
npm run format:check && npm run lint && npm run typecheck
git add -A && git commit -m "feat: the host reads the weather service on a timer while an office is open and tells every office"
```

---

### Task 4: Seasons, rain and weather in the scene

**Files:**

- Modify: `vendor/my-office/import-upstream.mjs`, `vendor/my-office/src/i18n/index.js`, `vendor/my-office/src/office/paseo-entry.js`, `vendor/SOURCES.md`, `server/world-script.test.ts`
- Delete: `vendor/my-office/src/office/life/seasons.js`, `rain.js`, `weather.js` (the three stand-ins, before the tool writes upstream's)
- Create by the tool: `vendor/my-office/src/office/life/seasons.js`, `rain.js`, `weather.js`; regenerated: `paseo-modules.js`, `MANIFEST.json`, `server/world.generated.ts`
- Create: `vendor/my-office/src/office/paseo-weather-plan.js`
- Add `// PASEO:` changes to: `vendor/my-office/src/office/life/weather.js`
- Test: `client/world/weather-plan.test.ts`, `client/world/weather-scene.test.ts`, `client/world/entry.test.ts` (added cases)

**Interfaces:**

- Produces, in `paseo-weather-plan.js` (no scene in it, so a test runs it as it runs `paseo-leisure-plan.js`):

```js
/** The weather a season draws when the host says "follow the season". Seasons not named here draw clear weather. */
export const SEASON_WEATHER = { halloween: { code: 3, temp: null, cloud: 0.9 } };
/**
 * What the scene should draw for what the host sent, given the scene's own season: a reading
 * { code, temp, cloud }, or null for no weather. Anything it cannot read draws none.
 */
export function weatherToDraw(scene, season);
```

- Produces, in `paseo-entry.js`: `PaseoOfficeWorld.setWeather(scene)` where `scene` is `{ kind: "none" } | { kind: "season" } | { kind: "reading", code, temp, cloud }`.
- Produces, in `life/weather.js`: `export function setWeather(reading | null)` and the existing `wx`, `applyWeather`, `updateWeather`.

- [ ] **Step 1: Write the failing plan test**

```ts
// client/world/weather-plan.test.ts
import { expect, test } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import {
  SEASON_WEATHER,
  weatherToDraw,
} from "../../vendor/my-office/src/office/paseo-weather-plan.js";

const RAIN = { kind: "reading", code: 63, temp: 14.2, cloud: 0.9 };

test("no weather, or anything unreadable, draws none", () => {
  expect(weatherToDraw({ kind: "none" }, "halloween")).toBeNull();
  expect(weatherToDraw(undefined, null)).toBeNull();
  expect(weatherToDraw(null, null)).toBeNull();
  expect(weatherToDraw({ kind: "snow" }, null)).toBeNull();
  expect(weatherToDraw("rain", null)).toBeNull();
});

test("following the season, Halloween is cloudy and every other season, or none, is clear", () => {
  expect(SEASON_WEATHER).toEqual({ halloween: { code: 3, temp: null, cloud: 0.9 } });
  expect(weatherToDraw({ kind: "season" }, "halloween")).toEqual({
    code: 3,
    temp: null,
    cloud: 0.9,
  });
  expect(weatherToDraw({ kind: "season" }, "noel")).toBeNull();
  expect(weatherToDraw({ kind: "season" }, "tet")).toBeNull();
  expect(weatherToDraw({ kind: "season" }, null)).toBeNull();
  expect(weatherToDraw({ kind: "season" }, undefined)).toBeNull();
});

test("a reading is drawn as it is, whatever the season", () => {
  expect(weatherToDraw(RAIN, "halloween")).toEqual({ code: 63, temp: 14.2, cloud: 0.9 });
  expect(weatherToDraw(RAIN, null)).toEqual({ code: 63, temp: 14.2, cloud: 0.9 });
});

test("the scene checks a reading again: a code outside 0 to 99 or not whole draws none", () => {
  for (const code of [-1, 100, 3.5, "3", null, NaN]) {
    expect(weatherToDraw({ ...RAIN, code }, null)).toBeNull();
  }
});

test("a temperature that is not a number is unknown; a cloud share is held to 0 to 1", () => {
  expect(weatherToDraw({ ...RAIN, temp: "warm" }, null)).toEqual({
    code: 63,
    temp: null,
    cloud: 0.9,
  });
  expect(weatherToDraw({ ...RAIN, temp: NaN }, null)?.temp).toBeNull();
  expect(weatherToDraw({ ...RAIN, cloud: 2 }, null)?.cloud).toBe(1);
  expect(weatherToDraw({ ...RAIN, cloud: -1 }, null)?.cloud).toBe(0);
  expect(weatherToDraw({ ...RAIN, cloud: "x" }, null)?.cloud).toBe(0);
});

test("the scene is never handed an address or text: only the three numbers come out", () => {
  const drawn = weatherToDraw({ ...RAIN, address: "https://x.test/?k=SECRET", problem: "x" }, null);
  expect(Object.keys(drawn).sort()).toEqual(["cloud", "code", "temp"]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run client/world/weather-plan.test.ts`
Expected: FAIL, cannot find `paseo-weather-plan.js`.

- [ ] **Step 3: Write the plan module**

```js
// PASEO: which weather the scene draws for what the host sent. Pure, no scene in it, so
// client/world/weather-plan.test.ts runs it. The host's server reads the weather service and
// resolves the setting; the scene gets only this.

/**
 * The weather of a season, for the host's "follow the season". Upstream has no weather by season:
 * this is Paseo's. A season not named here draws clear weather, which is no weather.
 */
export const SEASON_WEATHER = { halloween: { code: 3, temp: null, cloud: 0.9 } };

const share = (value) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/**
 * What to draw for `scene` ({ kind: 'none' | 'season' | 'reading', code, temp, cloud }) in the
 * scene's own `season`: { code, temp, cloud } or null for no weather. A code that is not a whole
 * number from 0 to 99 draws none.
 */
export function weatherToDraw(scene, season) {
  if (!scene || typeof scene !== "object") return null;
  if (scene.kind === "season") return SEASON_WEATHER[season] ? { ...SEASON_WEATHER[season] } : null;
  if (scene.kind !== "reading") return null;
  const { code } = scene;
  if (!Number.isInteger(code) || code < 0 || code > 99) return null;
  return { code, temp: Number.isFinite(scene.temp) ? scene.temp : null, cloud: share(scene.cloud) };
}
```

(`Number.isFinite` and `Number.isInteger` do not coerce, so `"3"` and `NaN` fail as the tests say.)

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run client/world/weather-plan.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing scene test for `weather.js`**

`client/world/weather-scene.test.ts` runs the real `weather.js` with three.js and stands in the modules that draw or read a page, as `leisure-scene.test.ts` does. It needs `weather.js` to exist, so it is written now and fails until Step 7.

```ts
// Upstream's rain and light (life/weather.js) with Paseo's changes, driven by setWeather.
import { readFileSync } from "node:fs";
import { beforeEach, expect, test, vi } from "vitest";

const WEATHER = "../../vendor/my-office/src/office/life/weather.js";
const SRC = "../../vendor/my-office/src/office";

const h = vi.hoisted(() => ({
  night: false,
  reduce: false,
  sim: 0,
  plays: [] as string[],
  added: [] as { geometry: { drawRange: { count: number } }; visible: boolean }[],
  scene: { fog: { near: 40, far: 96 } as Record<string, unknown>, add(object: never) {} },
  lights: { hemi: { intensity: 0.25 }, sun: { intensity: 1.35 } },
  kit: { visible: false },
}));

vi.mock("../../vendor/my-office/src/office/core/env.js", () => ({
  rand: (from: number) => from,
  get reduceMotion() {
    return h.reduce;
  },
}));
vi.mock("../../vendor/my-office/src/office/core/state.js", () => ({
  state: {
    get sim() {
      return h.sim;
    },
  },
}));
vi.mock("../../vendor/my-office/src/office/scene/renderer.js", () => ({ scene: h.scene }));
vi.mock("../../vendor/my-office/src/office/scene/lights.js", () => h.lights);
vi.mock("../../vendor/my-office/src/office/world/layout.js", () => ({
  LAY: { box: { x0: -8, x1: 14, z0: -8, z1: 8 } },
}));
vi.mock("../../vendor/my-office/src/office/life/rain.js", () => ({ rainKit: h.kit }));
vi.mock("../../vendor/my-office/src/office/world/room-update.js", () => ({
  get night() {
    return h.night;
  },
}));
vi.mock("../../vendor/my-office/src/office/audio/sfx.js", () => ({
  sfx: { play: (name: string) => h.plays.push(name) },
}));

const RAIN = { code: 63, temp: 14.2, cloud: 0.9 };

async function load() {
  vi.resetModules();
  // @ts-expect-error vendored JavaScript has no declarations
  return (await import("../../vendor/my-office/src/office/life/weather.js")) as {
    setWeather(reading: object | null): void;
    applyWeather(): void;
    updateWeather(dt: number): void;
    wx: Record<string, unknown>;
  };
}

beforeEach(() => {
  h.night = false;
  h.reduce = false;
  h.sim = 0;
  h.plays.length = 0;
  h.added.length = 0;
  h.scene.fog = { near: 40, far: 96 };
  h.scene.add = (object: never) => void h.added.push(object);
  h.lights.sun.intensity = 1.35;
  h.lights.hemi.intensity = 0.25;
  h.kit.visible = false;
  vi.useRealTimers();
});
```

Cases (each `const weather = await load()`):

- No weather: `setWeather(null)` leaves `sun.intensity` 1.35, the fog at 40 and 96, the kit hidden, nothing added to the scene.
- Clear (`{ code: 0, temp: null, cloud: 0 }`) is the same as none.
- Rain (`RAIN`): `sun.intensity` is `1.35 * (1 - 0.492)` (close to 0.6858, 3 digits), the fog's `near` and `far` are 30 and 78, `base` is `[30, 78]`, the kit is visible, and one object is added (the rain's lines) with `visible` true; a second `setWeather(RAIN)` adds no second one.
- The rain's draw count: after `updateWeather(0.016)` the added lines' `geometry.drawRange.count` is `2124 * 2` (3,600 lines, 0.59 of them).
- Night composes: with `h.night = true`, `setWeather(RAIN)` gives `sun.intensity` close to `0.55 * (1 - 0.492)` (0.2794); then flipping `h.night` to false and calling `applyWeather()` (what `setNight` does as its last line) gives the day's 0.6858: the weather follows the theme and does not hold the light of the other.
- A service's `is_day` is not an input: `setWeather({ ...RAIN, is_day: 0 })` gives the same sun as without it.
- Fog (code 45, cloud 0.9): fog 14 and 52, the kit hidden, nothing added.
- Storm (code 95, cloud 1): with `h.sim = 0` then `updateWeather(0.016)` sets `wx.flashAt` to 6; at `h.sim = 7` the next `updateWeather(0.016)` makes `hemi.intensity` 3.45 (0.25 + 3.2); with fake timers (`vi.useFakeTimers()` before `load`) advancing 400 ms plays `thunder`; repeated `updateWeather(0.1)` calls bring the hemi back to 0.25. With `h.reduce = true` no flash and no thunder.
- Cleared after rain: `setWeather(null)` hides the lines and the kit and returns the sun to 1.35 and the fog to 40 and 96.
- The scene takes nothing from outside: read `weather.js` from disk and assert it has no `fetch(`, no `localStorage`, no `document` and no `XMLHttpRequest`; assert it does carry `PASEO:`.

```ts
test("the file asks nobody and reads no page", () => {
  const source = readFileSync(new URL(WEATHER, import.meta.url), "utf8");
  expect(source).not.toMatch(/\bfetch\s*\(/);
  for (const word of ["localStorage", "document", "XMLHttpRequest", "WebSocket"]) {
    expect(source).not.toContain(word);
  }
  expect(source).toContain("// PASEO:");
});
```

- [ ] **Step 6: Run it and see it fail**

Run: `npx vitest run client/world/weather-scene.test.ts`
Expected: FAIL: the stand-in `weather.js` has no `setWeather`, and its comment does not carry the three changes.

- [ ] **Step 7: Take the three files with the import tool**

1. In `vendor/my-office/import-upstream.mjs`, in `DENY`, the line `/^office\/life\/(seasons|rain|weather|altar|lift-service|drill|day-swaps|photostrips|post|incidents|nap)\.js$/` becomes `/^office\/life\/(altar|lift-service|drill|day-swaps|photostrips|post|incidents|nap)\.js$/` (if earlier pieces have moved other names, remove only `seasons|rain|weather|`). Its header comment ("Not taken: ... the daily-life scenes") needs no change unless it names the three.
2. Delete the three stand-ins: `git rm vendor/my-office/src/office/life/seasons.js vendor/my-office/src/office/life/rain.js vendor/my-office/src/office/life/weather.js`.
3. Check first: `node vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check` (clone my-office at `b68228871fe30cd2c759a2c919337a9a9d1f5644` into `/tmp/ref-office/my-office`, and `npm install --prefix /tmp/ref-office/three three@0.160.0`, if they are missing). Expected: `would write: 4`, the kept-local list unchanged, no "stand-ins to write or extend". If it says more than 4, an earlier piece left the tree different from the tool's output: stop and look at the difference. If it names a missing stand-in export, that is another stand-in's, to be extended by hand as `SOURCES.md` describes.
4. Run it without `--check`. Expected: the same lines, then `git status` shows `life/seasons.js`, `life/rain.js` and `life/weather.js` written, `paseo-modules.js` gaining `lifeSeasons`, `lifeRain` and `lifeWeather` (imports and entries, in upstream's order), and `MANIFEST.json` with the three paths moved from `standIns` to `files`. `git diff --stat` must show nothing else under `vendor/`.
5. `seasons.js` and `rain.js` stay exactly as the tool wrote them. Confirm with `cmp vendor/my-office/src/office/life/seasons.js /tmp/ref-office/my-office/src/office/life/seasons.js` after the `three` import rewrite is accounted for: the only differences are the rewritten `three` import lines.

- [ ] **Step 8: Change `weather.js` by hand**

Each change starts `// PASEO:` and is listed in `vendor/SOURCES.md` (Step 11). The file after the changes, apart from `rain` and the two functions below that stay upstream's, reads as follows; make the edits in the tool's output so the untouched lines stay byte for byte upstream's.

1. Under the file's first comment line, add `// PASEO: Paseo's copy draws the weather it is given (setWeather, from paseo-entry.js); it asks nobody. See vendor/SOURCES.md.`
2. The import `import { $, hhmm, rand, reduceMotion, officeNow } from '../core/env.js';` becomes `// PASEO: no page elements (the clock, the settings line, the city chips) are read, so $, hhmm and officeNow go.` and `import { rand, reduceMotion } from '../core/env.js';`. The import of `t as tr` from `../../i18n/index.js` goes (every use of it goes below).
3. From `// City names are proper nouns` up to, not including, `export const wx =`: deleted (`WX_CITIES`, `cityName`, `WX_TEXT`, `WX_ICON`). `export const wx = { city: '', code: null, ... }` stays as it is: `city` stays `''` for piece 8's street code.
4. `export const wxChip` and `async function fetchWeather()` (the whole function, upstream's one network call) are replaced by this block, which quotes what it removes and keeps upstream's derivation line for line:

```js
// PASEO: upstream's `fetchWeather` asked https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=temperature_2m,weather_code,precipitation,cloud_cover&timezone=auto
// and read `current.weather_code`, `current.temperature_2m` and `current.cloud_cover` from the answer. That call, the city
// list, the clock chip and the settings line are gone: Paseo's server asks the service the user chose, and the scene is
// handed `{ code, temp, cloud }` (cloud 0 to 1). The derivation below is upstream's, line for line.
/** Draws this weather, or none for null. `code` is a WMO weather code. */
export function setWeather(reading) {
  if (!reading)
    Object.assign(wx, { code: null, temp: null, cloud: 0, rain: 0, storm: false, fog: false });
  else {
    const { code } = reading;
    Object.assign(wx, {
      code,
      temp: reading.temp,
      cloud: reading.cloud,
      at: Date.now(),
      storm: code >= 95,
      fog: code === 45 || code === 48,
      rain:
        code >= 95
          ? 1
          : code >= 80 && code <= 82
            ? 0.55 + (code - 80) * 0.2
            : code >= 61 && code <= 67
              ? 0.35 + (code - 61) * 0.12
              : code >= 51 && code <= 57
                ? 0.18
                : 0,
    });
  }
  applyWeather();
}
```

5. In `applyWeather`, the first four lines (`const on = !!WX_CITIES[wx.city] && wx.code != null;`, the `[data-wx]` loop, and the two `$('wx-now')` lines) become `// PASEO: weather is on while one was given; there is no city, no settings line.` and `const on = wx.code != null;`. The last line, `$('clock').textContent = hhmm(officeNow().getTime()) + wxChip();`, goes (Paseo's page has no `#clock`: the line would throw).
6. In `updateWeather`, `if (wx.storm && WX_CITIES[wx.city] && !reduceMotion)` becomes `if (wx.storm && !reduceMotion)`.
7. `export function setup() { ... }` (storage read, city chips, the 15-minute timer) is replaced by `// PASEO: upstream's setup read the chosen city from storage and started its timer: neither is Paseo's.` A module without `setup` is left out of `setup` calls by the entry's `typeof module.setup === 'function'`.

Nothing else changes: `rainLines`, the body of `applyWeather`'s light and fog lines, `updateWeather`'s rain and flash code stay upstream's.

- [ ] **Step 9: Write `paseo-entry.js`'s call and the `props.season.hint` line**

In `vendor/my-office/src/office/paseo-entry.js`:

- Imports: `import { SEASON, el, reduceMotion, short } from './core/env.js';` (add `SEASON`), `import { setWeather as drawWeather } from './life/weather.js';`, `import { weatherToDraw } from './paseo-weather-plan.js';`.
- A module variable beside `let stopped = false;`: `let weatherKey = '';`.
- In `api`, after `setLimits`:

```js
  /**
   * The weather outside, from the host: `{ kind: 'none' }` draws none, `{ kind: 'season' }` the weather of the
   * scene's own season (paseo-weather-plan.js), `{ kind: 'reading', code, temp, cloud }` a WMO weather code, a
   * temperature and a cloud share (0 to 1). The host's server reads the weather service; the scene asks nobody.
   * The same weather again, in the same season, draws nothing new.
   */
  setWeather(scene) {
    if (!started || stopped) return;
    const key = JSON.stringify([scene, SEASON]);
    if (key === weatherKey) return;
    weatherKey = key;
    drawWeather(weatherToDraw(scene, SEASON));
  },
```

In `vendor/my-office/src/i18n/index.js`, in `OURS`, after the `paseo.notes` line: `// (the season's prop says "turn off in Settings" upstream; Paseo has no switch for it) 'props.season.hint': '{season} decorations',`.

- [ ] **Step 10: Run the scene tests, add the entry and bundle tests**

`client/world/entry.test.ts`: add `vi.mock("../../vendor/my-office/src/office/life/weather.js", () => ({ setWeather: (reading: unknown) => h.weather.push(reading) }));` and `weather: [] as unknown[]` to `h`, and cases (the file's `World` type gains `setWeather(scene: object): void`):

- `setWeather({ kind: "reading", code: 63, temp: 14.2, cloud: 0.9 })` draws `{ code: 63, temp: 14.2, cloud: 0.9 }` once; the same call again draws nothing more; a different one draws.
- `{ kind: "none" }` draws `null`; so does `{ kind: "season" }` here (the test's `SEASON` is unset: no season).
- A scene that was stopped (`world.stop()`) ignores `setWeather`. (Do this in the file's existing way of testing a stopped scene; if it has none, use a fresh import as the Resources tests do.)

`server/world-script.test.ts`, in "the scene's bundle builds with the new modules" (or a new `it` after it):

```ts
// Seasons, rain and weather: upstream's decorations, umbrellas and rain, drawing what the host sends.
expect(script).toContain("setWeather");
expect(script).toContain("life.season.");
expect(script).toContain("WET");
// The scene asks nobody: upstream's weather call and its storage key are gone.
expect(script).not.toContain("open-meteo");
expect(script).not.toContain("office-wx");
```

(`"life.season."` is the key `seasonName` builds; if the minified bundle spells it differently, assert on the English words `Halloween pumpkins` and `Peach blossom tree`, which `i18n/locales/en/props.js` holds and the bundle keeps.) The size assertions stay: the scene grows by about 19 KB; if the cap fails, raise `1_200_000` to the next 50,000 above the measured length, and say so in the commit message.

Run: `npx vitest run client/world/weather-plan.test.ts client/world/weather-scene.test.ts client/world/entry.test.ts`
Expected: PASS (the scene test now finds `setWeather` and the PASEO changes).

- [ ] **Step 11: Build the scene, list the changes, run everything**

`vendor/SOURCES.md`:

- "What is taken": add a paragraph: the seasons' decorations by the date (`life/seasons.js`: Halloween pumpkins, bats and a ghost; a Christmas tree and wreath; a Lunar New Year peach tree, lanterns, banner and couplets), the umbrella stand, the wet-floor sign and the entrance's rain things (`life/rain.js`), and the rain, light, fog and storm flashes (`life/weather.js`).
- "Five copied files are changed by hand" becomes "Six" (or the number then), and gains: `src/office/life/weather.js`: upstream's fetch (the quoted address and the three fields), the city list and chips, the clock chip, the settings line and `setup` are gone; `setWeather(reading | null)` takes their place, with upstream's code-to-rain derivation unchanged; `applyWeather` no longer needs a city and reads no page element; `wx.city` stays `''` for the street.
- "What is not taken": remove "the seasons, the weather" from the daily-life list.
- "What the scene is told": add: the weather, a WMO code, a temperature and a cloud share, never the address.
- The stand-in table is unchanged.
- "Paseo's own files": add `paseo-weather-plan.js` (what the scene draws for what the host sent, and the season's weather).

Then:

```bash
npm run build:world
npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts
npm test -- --maxWorkers=4 > /tmp/weather-task4.txt 2>&1; tail -20 /tmp/weather-task4.txt
git add -A && git commit -m "feat: the scene wears the season's decorations and draws the weather it is given"
```

Expected: the whole suite passes; `git diff --stat` for the commit has `server/world.generated.ts` as its largest file and nothing under `client/pixel/`.

---

### Task 5: The scene's API on the plugin's side

**Files:**

- Modify: `client/world/world-api.ts`, `client/world/world-bridge.ts`, `client/world/adapter.ts`, `client/world/use-world-feed.ts`, `client/world/world-view.tsx`, `client/world/world-view-native.tsx`, `client/office-surface.tsx`
- Tests: `client/world/world-bridge.test.ts`, `client/world/adapter.test.ts`, `client/world/use-world-feed.mounted.test.tsx`, `client/world/world-view.mounted.test.tsx`, `client/world/world-view-native.mounted.test.tsx`, `client/office-surface-panels.mounted.test.tsx`

**Interfaces:**

- Consumes: `WeatherScene` (Task 1); the scene's `setWeather` (Task 4).
- Produces:

```ts
// world-api.ts
/** The weather outside: none, the season's own, or a WMO code with a temperature (null: unknown) and cloud, 0 to 1. */
export type WorldWeather =
  | { kind: "none" }
  | { kind: "season" }
  | { kind: "reading"; code: number; temp: number | null; cloud: number };
// WorldApi gains, optional like meet and setIncidents so an older page still passes isWorldApi:
setWeather?(weather: WorldWeather): void;
// adapter.ts
export function worldWeather(scene: WeatherScene | undefined): WorldWeather;
// use-world-feed.ts: WorldFeedInput gains  weather: WeatherScene | undefined
// WorldView and WorldViewNative props gain  weather: WeatherScene | undefined
```

- [ ] **Step 1: Write the failing tests**

- `world-bridge.test.ts` already lists the API's calls and checks each becomes `{ call, args }` (it names `setIncidents` and `meet` near lines 43 to 50): add `api.setWeather?.({ kind: "reading", code: 63, temp: null, cloud: 0.9 })` to its calls and `"setWeather"` to the list it compares, with the args `[{ kind: "reading", code: 63, temp: null, cloud: 0.9 }]`.
- `world-bridge-page.test.ts`: if it asserts the forwarding of named calls generically, add nothing; if it lists calls, add `setWeather`. (The page's `frame.onMessage` forwards any `call` the scene has, so no page change is needed: say so in the commit message if the test needed none.)
- `adapter.test.ts`: `worldWeather(undefined)` is `{ kind: "none" }`; `worldWeather({ kind: "season" })` is `{ kind: "season" }`; a reading is copied field for field (code, temp, cloud).
- `use-world-feed.mounted.test.tsx` (its fake scene records calls): once the scene has started, `setWeather` is called with `{ kind: "none" }` when the input is absent and with the reading when one is given; a changed input calls it again; a scene without `setWeather` (an object that lacks the method) is not an error. The weather effect runs after the people's (the people are seated first: assert the order of the fake's calls `setSessions` before `setWeather` on first start).
- `world-view.mounted.test.tsx`, `world-view-native.mounted.test.tsx`, `office-surface-panels.mounted.test.tsx`: wherever they build the props of the views, add `weather` (undefined); and one case in the surface's test: a snapshot with `weather: { scene: { kind: "reading", code: 63, temp: null, cloud: 0.9 }, problem: null, readAt: null }` gives the 3D view a `weather` prop equal to that scene (read how that test already checks `incidents` reaching the view).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/world client/office-surface-panels.mounted.test.tsx`
Expected: FAIL: `setWeather` is not on the bridge's API; `worldWeather` is not exported; the view takes no `weather`.

- [ ] **Step 3: Implement**

- `world-api.ts`: the `WorldWeather` type; in `WorldApi`, after `setIncidents?`: `/** The weather outside, from the host's setting and, for a service, the host's reading. The scene asks nobody. Absent on a page built before weather. */ setWeather?(weather: WorldWeather): void;`. `WORLD_API_VERSION` stays 1 and `isWorldApi` is unchanged: the method is optional.
- `world-bridge.ts`: in `api`, after `setIncidents: sender("setIncidents"),`: `setWeather: sender("setWeather"),`.
- `adapter.ts`: `import type { ..., WeatherScene } from "../../shared/contracts.js";` and

```ts
/** What the scene is told of the weather: the host's scene, or none while the host has not said. */
export function worldWeather(scene: WeatherScene | undefined): WorldWeather {
  if (scene === undefined || scene.kind === "none") return { kind: "none" };
  if (scene.kind === "season") return { kind: "season" };
  return { kind: "reading", code: scene.code, temp: scene.temp, cloud: scene.cloud };
}
```

(import `WorldWeather` with the other world types.)

- `use-world-feed.ts`: `WorldFeedInput` gains `/** What the host tells the scene of the weather; absent until the host's settings are read. */ weather: WeatherScene | undefined;`, the hook destructures it, and after the machine effect (the `[api]` effect stays the first effect):

```ts
useEffect(() => {
  world.current?.setWeather?.(worldWeather(weather));
}, [weather, api]);
```

The scene drops a call that changes nothing (the entry's `weatherKey`), so each new snapshot's new `weather` object costs nothing. Update the hook's doc comment's list ("the people, their events, ... the incidents, the weather, the theme, ...").

- `world-view.tsx` and `world-view-native.tsx`: a prop `weather: WeatherScene | undefined` (doc: "What the host says of the weather outside the 3D floor.") passed to `useWorldFeed`. In `office-surface.tsx`, where `incidents={incidents}` is passed down to the views (the floor's props interface near its `incidents: IncidentsState | undefined;` and the two places that pass it), add `weather` beside it, read as `office.state.weather?.scene`.

- [ ] **Step 4: Run, check, commit**

```bash
npx vitest run client/world client/office-surface-panels.mounted.test.tsx client/engine-compat.test.ts
npm run format:check && npm run lint && npm run typecheck
git add -A && git commit -m "feat: the host's weather reaches the 3D scene in the web frame and on a phone"
```

---

### Task 6: The settings page and Attention

**Files:**

- Create: `client/setting-field.tsx`, `client/choice-pills.tsx`, `client/weather-settings.tsx`, `client/weather-text.ts`
- Test: `client/choice-pills.mounted.test.tsx`, `client/weather-settings.mounted.test.tsx`, `client/weather-text.test.ts`
- Modify: `client/host-switches.tsx`, `client/office-settings.tsx`, `client/office-surface.tsx`, `client/incidents-text.ts` (`ageText` is exported, nothing else), `client/host-switches.mounted.test.tsx`, `client/office-surface-panels.mounted.test.tsx`

**Interfaces:**

- Consumes: `WeatherState` (Task 1); `WEATHER_MODES`, `MANUAL_CHOICES`, `MANUAL_LABELS`, `WEATHER_ADDRESS_EXAMPLE`, `weatherWords` (Task 1); `StripCard` from `client/attention-strip.tsx`; the `change`/`saveProblem` pattern of `client/host-switches.tsx`.
- Produces:

```ts
// weather-text.ts
/** The strip's Weather card, while the service could not be read; it opens the settings. */
export function weatherEntry(state: WeatherState | undefined, onOpen: () => void): StripCard | null;
/** The line under the address: what the host last read, or why nothing is read. Null when there is nothing to say (not the service, or a problem, which shows as one). */
export function weatherStatus(input: {
  mode: WeatherMode;
  address: string;
  state: WeatherState | undefined;
  now: number;
}): string | null;
// choice-pills.tsx
export interface ChoicePillsProps<T extends string> {
  label: string;
  hint: string | null;
  options: readonly { value: T; label: string }[];
  /** Null while the settings are read or cannot be read: nothing can be pressed. */
  value: T | null;
  /** Resolves once the host has answered, and never rejects. */
  onSave(next: T): Promise<unknown>;
  problem: string | null;
  styles: OfficeStyles;
}
export function ChoicePills<T extends string>(props: ChoicePillsProps<T>): ReactNode;
// setting-field.tsx: SettingField and SettingFieldProps, moved unchanged from host-switches.tsx
// weather-settings.tsx
export type WeatherSetting = "Weather" | "Weather choice" | "Weather address";
export function WeatherFields(props: {
  values: HostValues | null; // as host-switches.tsx reads them: null while read or unreadable
  weather: WeatherState | undefined;
  change(setting: WeatherSetting, patch: Partial<HostValues>): Promise<boolean>;
  saveProblem(setting: WeatherSetting): string | null;
  styles: OfficeStyles;
}): ReactNode;
```

- [ ] **Step 1: Write the failing tests**

`weather-text.test.ts`:

- `weatherEntry(undefined, f)` and a state with `problem: null` give null. With `problem: "The weather service answered HTTP 503"` it gives `{ title: "Weather", note: { text: "The weather service answered HTTP 503", tone: "warning" }, onOpen }` and `onOpen` is the one given.
- `weatherStatus`: mode `off` or `manual` gives null; mode `service` with an empty or blank address gives `No address: the season's weather shows until one is set.`; with an address and no state or no answer yet gives `Waiting for the first answer.`; with a reading `{ code: 63, temp: 14.2 }` read 5 minutes before `now` gives `Last answer 5 min ago: rain, 14°.`; with a null temperature `Last answer just now: overcast.` (a code 3); with a problem gives null (the problem has its own line).

`choice-pills.mounted.test.tsx` (jsdom, the kit stood in as `notes-days` tests do; read `client/notes-days` coverage in `host-switches.mounted.test.tsx`):

- One button per option, labelled by it, inside a group named by `label`; the stored value's button has `aria-pressed` true and the others false.
- A press calls `onSave` with that option's value once; a second press before the host answers calls nothing; the pressed value shows until the answer, then the stored one shows (a refused save goes back).
- With `value` null the buttons are disabled and a press saves nothing.
- The hint and the problem show under the group, the problem with the alert role.

`weather-settings.mounted.test.tsx`, with `useSettings` stood in as `host-switches.mounted.test.tsx` does (copy its mock, with `stored` including `NO_WEATHER`):

- Off is chosen by default and only the mode pills show: no choice pills, no address field.
- Pressing "Manual" saves `weatherMode: "manual"` against the stored revision and keeps every other setting; then the five choice pills show with "Follow the season" chosen (the default) and a press on "Rain" saves `weatherManual: "rain"`.
- Pressing "From a service" saves `weatherMode: "service"`, and the address field shows empty (not the example), labelled "Weather address", with the example in its hint: the hint contains `https://api.open-meteo.com/v1/forecast?latitude=52.52&longitude=13.41&current=temperature_2m,weather_code,cloud_cover` and says it needs an address answering in open-meteo's shape, https or http on the host itself, and that the host reads it every 15 minutes while an office is open.
- Typing an address and blurring saves `weatherUrl` trimmed once; an address that is http off the host is refused by the schema: the saved list is unchanged and the message `weatherUrl: not an https address (plain http only on this machine)` shows under the field and does not contain what was typed.
- The status line shows from `weatherStatus` under the field; a `problem` shows as an alert line under the field, the host's sentence as it is.
- The address field is not drawn in Off or Manual; the stored address is kept when the mode changes (a save carries it).

`host-switches.mounted.test.tsx`: its harness passes `weather: undefined`; one case: with `weather` holding a problem and the mode `service`, the problem shows once in the header's weather block.

`office-surface-panels.mounted.test.tsx`: a snapshot whose `weather.problem` is set gives the Attention strip a "Weather" entry (accessible name `Weather: <the sentence>`); pressing it calls the settings opener; with no `onOpenSettings` no entry shows; a snapshot without a problem has no entry; the strip's badge counts it.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/weather-text.test.ts client/choice-pills.mounted.test.tsx client/weather-settings.mounted.test.tsx client/host-switches.mounted.test.tsx client/office-surface-panels.mounted.test.tsx`
Expected: FAIL, the new modules are missing and the host's header has no weather block.

- [ ] **Step 3: Write the helpers**

`client/incidents-text.ts`: `function ageText` becomes `export function ageText` (its doc: "The age as the incidents and the weather's line say it.").

`client/weather-text.ts`:

```ts
import type { WeatherState } from "../shared/contracts.js";
import { weatherWords, type WeatherMode } from "../shared/weather.js";
import type { StripCard } from "./attention-strip.js";
import { ageText } from "./incidents-text.js";

export function weatherEntry(
  state: WeatherState | undefined,
  onOpen: () => void,
): StripCard | null {
  if (state === undefined || state.problem === null) return null;
  return { title: "Weather", note: { text: state.problem, tone: "warning" }, onOpen };
}

export interface WeatherStatusInput {
  mode: WeatherMode;
  address: string;
  state: WeatherState | undefined;
  now: number;
}

export function weatherStatus({ mode, address, state, now }: WeatherStatusInput): string | null {
  if (mode !== "service") return null;
  if (address.trim() === "") return "No address: the season's weather shows until one is set.";
  if (state === undefined || state.problem !== null) {
    return state === undefined ? "Waiting for the first answer." : null;
  }
  const { scene, readAt } = state;
  if (scene.kind !== "reading" || readAt === null) return "Waiting for the first answer.";
  const temp = scene.temp === null ? "" : `, ${Math.round(scene.temp)}°`;
  return `Last answer ${ageText(Math.max(0, now - readAt))}: ${weatherWords(scene.code)}${temp}.`;
}
```

(`ageText` says "just now", "5 min ago", "2 h ago", so "Last answer just now" reads as written in the tests.)

- [ ] **Step 4: Write the controls and the block**

`client/setting-field.tsx`: move `SettingFieldProps` and `SettingField` from `client/host-switches.tsx`, unchanged (imports: `useCallback`, `useEffect`, `useRef`, `useState`, `Text`, `View`, `TextInput` from `@getpaseo/plugin/client/ui`, `OfficeStyles`); export both; `host-switches.tsx` imports it. This is a move; its tests (the field behaviours in `host-switches.mounted.test.tsx`) must pass unchanged.

`client/choice-pills.tsx`: one `Pill` component per option, built as `Day` in `client/notes-days.tsx` is built (hover and press state, `styles.segment`, `segmentFill`, `segmentHoverFill`, `segmentText`, `segmentTextSelected`, `aria-pressed`, `accessibilityRole="button"`), in a `View role="group" aria-label={label}` with `styles.notesDays` (`notesDaysDisabled` while disabled), the wrapping pill row. The pressed value shows until the host has answered; the row takes no second press meanwhile (`saving` ref); unmount sets nothing. Under the group: the hint with `styles.fieldHint`, the problem with `accessibilityRole="alert"` and `styles.actionError`. A comment says it is `NotesDays` for one of N.

`client/weather-settings.tsx`:

```tsx
export type WeatherSetting = "Weather" | "Weather choice" | "Weather address";
const MODES = [
  { value: "off", label: "Off" },
  { value: "manual", label: "Manual" },
  { value: "service", label: "From a service" },
] as const;
const CHOICES = MANUAL_CHOICES.map((value) => ({ value, label: MANUAL_LABELS[value] }));
const MODE_HINT = "Rain, clouds and storms outside the 3D floor. Off draws none.";
const CHOICE_HINT =
  "Follow the season draws the season's weather: cloudy for Halloween, clear otherwise.";
const ADDRESS_HINT = `An address that answers in open-meteo's shape, for example ${WEATHER_ADDRESS_EXAMPLE}. https, or http on the host itself. The host reads it every 15 minutes while an office is open.`;
```

`WeatherFields` draws, in a `View style={styles.headerFields}`: a `ChoicePills` for the mode (label "Weather", saving `{ weatherMode }` through `change("Weather", ...)`); while the mode is `manual`, a `ChoicePills` for the choice (label "Weather choice"); while it is `service`, a `SettingField` (label "Weather address", hint `ADDRESS_HINT`, value `values?.weatherUrl ?? null`, saving `{ weatherUrl }` through `change("Weather address", ...)`) and, under it, the `weatherStatus` line as `Text style={styles.fieldHint}` (`now` is `Date.now()` read in render) and the host's `weather.problem`, when the mode is `service`, as an alert line (`styles.actionError`) when the field has no refused-save problem of its own (`saveProblem("Weather address") ?? weather?.problem ?? null` is the field's `problem`). Each control's `problem` is `saveProblem(<its label>)`.

- [ ] **Step 5: Put it in the header and the strip**

- `host-switches.tsx`: `HostSetting` gains `| WeatherSetting`; `HostSwitchesProps` gains `/** The host's weather: its problem and last answer show under the weather fields. */ weather: WeatherState | undefined;`; after `<TrackerFields .../>` and before the problems block, `<WeatherFields values={stored} weather={weather} change={change} saveProblem={saveProblem} styles={styles} />`. The `change` and `saveProblem` it passes are the ones the tracker fields get, typed over the union. The doc comment of `HostSwitches` gains "then the weather".
- `office-settings.tsx`: `weather={office.state.weather}` beside `incidents=`; its doc comment's list gains "the weather".
- `office-surface.tsx`, where `incidentsStripEntry` and `settingsStripEntry` are made and the `cards` memo is built: add

```tsx
const weatherStripEntry = useMemo(
  () => (onOpenSettings ? weatherEntry(office.state.weather, onOpenSettings) : null),
  [office.state.weather, onOpenSettings],
);
```

and put `weatherStripEntry` in the cards list after `settingsStripEntry` (read the memo: it filters nulls; keep its order: incidents, janitor, settings, weather). If this raises `OfficeSurface`'s complexity over the lint limit of 20, move the three entries' `useMemo`s into one hook `useStripCards` in its own file, as `useSettingsEntry` was moved out; do that in this step and say so in the commit.

- [ ] **Step 6: Run, check, commit**

```bash
npx vitest run client/weather-text.test.ts client/choice-pills.mounted.test.tsx client/weather-settings.mounted.test.tsx client/host-switches.mounted.test.tsx client/office-surface-panels.mounted.test.tsx client/office-settings.mounted.test.tsx client/engine-compat.test.ts
npm run format:check && npm run lint && npm run typecheck
npm test -- --maxWorkers=4 > /tmp/weather-task6.txt 2>&1; tail -20 /tmp/weather-task6.txt
git add -A && git commit -m "feat: the Weather setting on the settings page, and a failed read in Attention"
```

---

### Task 7: A look, and what was seen

**Files:**

- Modify: `docs/verified.md`, `README.md`, `docs/office.md`
- Contingent (only if Step 3 finds the rain unreadable on the light theme): `vendor/my-office/src/office/life/weather.js`, `vendor/SOURCES.md`, `client/world/weather-scene.test.ts`

- [ ] **Step 1: A scratch page for the scene alone**

The date is not in a season now (Halloween, Christmas and Lunar New Year are out of the window), and the throwaway daemon's frame has no address to carry `?season=`. So the scene is looked at first on a scratch page, outside the daemon: extract the built script and serve a driver page.

```bash
mkdir -p /tmp/office-look && cd /tmp/office-look
node -e 'const t=require("fs").readFileSync("/workspace/QFlavours/paseo-office/server/world.generated.ts","utf8"); const m=t.match(/WORLD_SCRIPT: string = (".*");\n/s); require("fs").writeFileSync("world.js", JSON.parse(m[1]))'
```

`index.html` holds `<script src="world.js"></script>` and a driver script that reads the query: `dark=1` for the dark theme (`colors.surface0` `#18181B`, else `#F4EFE6`), `weather=<json>` for `PaseoOfficeWorld.setWeather(JSON.parse(...))`, starts the scene with `plan: "pro"`, `onSelect`, `onBoard` and `onProblem` (which sets `document.title`), and seats three sample people (`id`, `name`, `title`, `dir`, `git: { repo }`, `status` work, wait and rest, `agent: "claude"`, `lastPrompt: ""`, `stuck: false`, `subs: []`). Serve it with `python3 -m http.server 6801 --bind <the host's own address from hostname -i>` (not 6767, not 6798) and open it with the Paseo browser tool, at 1280 and 390 px wide.

- [ ] **Step 2: Seasons and weather on the scratch page**

Look at, light and dark (`dark=1`):

- `?season=halloween`, `?season=noel`, `?season=tet` (the scene reads `?season=` from its page): decorations on the floor, walls and lobby; bats and the ghost for Halloween; the Lunar New Year banner over the meeting room's screen sits clear of the "Stand-up notes" label; the Christmas tree and the peach tree are not in a walkway; a click on the centrepiece makes confetti and its hint reads "<season> decorations", with no "turn off in Settings".
- Weather: `weather={"kind":"reading","code":63,"temp":14,"cloud":0.9}`, then code 95 with cloud 1, code 45, code 3 and `{"kind":"season"}` with `?season=halloween`; and `{"kind":"none"}`. For each: the sun is dimmed in rain, rain falls around the floor and not inside it, the umbrella and wet-floor sign stand at the entrance in rain only (the umbrella stand is there always), fog closes in for code 45, the storm flashes now and then.
- Day and night: the same rain on the light and the dark page; a theme change (`PaseoOfficeWorld.setTheme` from the browser's console, as the feed does) while it rains keeps the rain and flips the light, with no fight.
- **Rain's visibility, decided here.** On the light page, are the rain lines (upstream's `#B8CCEA` at half opacity) visible against the surface colour? If they are, nothing changes. If they cannot be seen, make this change and record it: in `life/weather.js`, in `applyWeather`, inside the `if (on && wx.rain > 0)` branch after `rain.lines.visible = true;`, add `// PASEO: upstream's pale streaks vanish on a light backdrop; the day's are darker.` and `rain.lines.material.color.set(night ? '#B8CCEA' : '#6F8FBA');`; add the line to the `weather.js` bullet of `vendor/SOURCES.md`; extend `weather-scene.test.ts` with a case that the lines' material colour is `#B8CCEA` at night and `#6F8FBA` by day (the test's `added[0]` gains `material: { color: { set(hex: string): void } }`, which the real three.js object has); `npm run build:world`; look again; commit as `fix: the rain shows on a light backdrop`.

- [ ] **Step 3: A stock daemon with the branch installed**

As `docs/verified.md` describes the earlier looks: a clean `/tmp/office-stock-home`, the published 0.16.2 daemon on port 6798 with a clean environment, the plugin installed by Git from the local repository at the branch's commit. `daemon status` must show 6798 and that home before any plugin command. Serve a static answer on the host's loopback, in a folder of its own: `/tmp/office-weather/weather.json` holding

```json
{
  "current": {
    "time": "2026-11-19T10:00",
    "interval": 900,
    "temperature_2m": 14.2,
    "weather_code": 63,
    "cloud_cover": 90,
    "is_day": 0
  }
}
```

and `python3 -m http.server 6802 --bind 127.0.0.1 --directory /tmp/office-weather`. (`is_day: 0` is there to see it ignored.)

- [ ] **Step 4: Look at the settings and the floor, at 1280 and 390 px**

- The settings page (Settings, Plugins, Office, or the gear over the floor) has a "Weather" row with Off chosen, and nothing else of weather. "Manual" shows the five pills with "Follow the season" chosen, and Rain draws rain on the 3D floor within a second; Storm flashes; Clear and Off draw none.
- "From a service": the address field is empty, not filled with the example; its hint shows the example with a latitude and a longitude. Save `http://127.0.0.1:6802/weather.json`: the line under it goes from "Waiting for the first answer." to "Last answer just now: rain, 14°." and the floor draws rain. The static server's log shows one request, and no more for 14 minutes while the office stays open (check at the end of the look with the time noted; the daemon's own log must hold no address).
- A refused address: `http://weather.example.test/x` is refused with the schema's message, which does not repeat what was typed; `https://` alone is refused as well as `weather.example.test`.
- Close the office (leave its page), wait a minute, and look at the static server's log: no request while closed; open the office again within 15 minutes: no new request.
- A failing address: save `http://127.0.0.1:6803/weather.json` (nothing listens). The floor draws the season's weather (none today), the Attention strip shows a "Weather" card with `The weather service could not be reached: ECONNREFUSED`, pressing it opens the settings, where the same sentence stands under the address field; `paseo plugin logs office` holds one `[office] weather:` line and no address. Put the good address back: the card goes, within a second of the save.
- A malformed answer: save an address whose file is `{"current":{"weather_code":"x"}}`: the card shows the shape sentence naming `current.weather_code` and `current.temperature_2m`.
- Dark theme (the app's own theme setting) with rain on: the light and the rain follow the theme.
- The 2D floor and the List with rain on and with a problem: unchanged.

Stop the daemon by its pid and the two static servers; confirm 6798, 6801 and 6802 are closed and 6767 untouched.

- [ ] **Step 5: What cannot be seen here, and is the owner's on the host**

- A real open-meteo answer: the owner sets "From a service" to the example with their own latitude and longitude on the host, and sees the floor follow the real sky (the throwaway daemon has no route to be relied on, and the plan's look used a static file).
- Thunder: it sounds only with piece 2's sound switched on, after a press in the scene; on the owner's phone, whether Web Audio runs in the app's frame is piece 2's open question.
- The 3D floor in rain, a season and a storm on the owner's phone (the fork's Android app, which has a script frame): its frame rate and memory with 3,600 rain lines, the bats and the decorations; and whether the rain reads against the phone's light and dark surface colours.
- A season that is in its window on the owner's own date: Christmas decorations from 12 December, if the tag waits for it (the scratch page saw them on `?season=noel`, with the date faked, not the date).
- The README's claim that the address is kept in the host's settings file: confirm on the host that the file holds the address as typed.

- [ ] **Step 6: Record, write the docs**

`docs/verified.md` gains a section "Weather and seasons": the scratch page's looks (each season, each weather, light and dark), the stock daemon's looks at both widths (the list in Step 4 with what was seen), the choice about the rain's colour (changed, or left), and the "Not seen" rows of Step 5.

`README.md`:

- "What it does" gains a bullet: "Dresses the 3D floor for Halloween, Christmas and Lunar New Year by the date, and, if you choose, draws weather outside it: a hand-picked sky, the season's, or the real one from an address you give."
- "What it reads and where it sends it" gains: "It calls a weather address only when you set one under Settings, Weather, From a service: the host's server asks it (never the scene), at most once in 15 minutes and only while an office is open, with no header but `Accept`. The address is kept as you typed it in the office's settings file on the host (`<PASEO_HOME>/plugin-settings/office/office.json`), with whatever it contains, a key in its query included, and it shows on the settings page to whoever opens it. The scene is told a weather code, a temperature and a cloud share, never the address." and the bullet about the scene's data gains "and the weather".

`docs/office.md`:

- "Where the code is" lists `server/weather-service.ts`, `server/weather-read.ts`, `shared/weather.ts`, `client/weather-settings.tsx`, `client/weather-text.ts` and `vendor/my-office/src/office/paseo-weather-plan.js` in its own style.
- The 3D floor's section gains a paragraph on seasons: by the viewing device's date, Halloween from 20 October to 1 November, Christmas 12 to 31 December, Lunar New Year from 14 days before to 7 days after, by Vietnam's calendar and only for the years 2026 to 2033 (my-office's table); no hemisphere, no switch; the scene builds the decorations once when it starts.
- "Settings" gains "Weather". A new section "Weather" (after "Incidents") says: the setting's three modes; Manual's five choices and that "Follow the season" is cloudy for Halloween and clear otherwise; for "From a service": the host reads the address, which must be https or http on the host itself, at most every 15 minutes, only while an office is open, nothing kept across a restart, a reading drawn for 30 minutes at most, 10 s timeout, a 64 KB cap, a redirect is a failure; a failed or malformed answer draws the season's weather and shows in Attention and under the address field until a read succeeds. It spells out the answer's shape: `current.weather_code` (integer 0 to 99, a WMO code) and `current.temperature_2m` (a number in degrees Celsius) are required; `current.cloud_cover` (0 to 100) is used when it is a number, else worked out from the code; `current.is_day` and every other key are ignored because the scene's night follows the app's theme. It shows the open-meteo example address and the sample answer of Task 2, and says a static file with just `{"current":{"weather_code":63,"temperature_2m":14.2}}` works. It lists what the weather changes today (the light, rain, fog, storm flashes, thunder with sound on, the entrance's umbrella and wet-floor sign) and what it does not: rain on the window glass, people's behaviour, and the 2D floor and the List.

- [ ] **Step 7: Commit**

Stop the daemon by its pid; confirm 6798 is closed and 6767 untouched. Run the full chain and the whole suite once more, then:

```bash
git add -A && git commit -m "docs: what was seen of seasons, rain and weather, and how the weather is set"
```

---

## Not verifiable until built

| What                                                                                                                                                        | How the plan finds out                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Whether upstream's pale rain streaks show against the app's light surface colour                                                                            | Task 7 Step 2 looks at it on the scratch page and, if not, makes the one change written there                                                                      |
| Whether the Lunar New Year banner and couplets and the lobby ghost sit clear of the port's own label and fixtures on the meeting room's screen and the lift | Task 7 Step 2 (`?season=tet`, `?season=halloween`)                                                                                                                 |
| Whether `vi.mock` of `room-update.js` with a `night` getter reads live in this Vitest version                                                               | Task 4 Step 5's tests set `h.night` between calls; if the getter is not live, the night case reloads the module after setting it (`load()` resets modules already) |
| That the minified bundle keeps the strings Task 4 Step 10 asserts                                                                                           | The test run; the fallback strings are named there                                                                                                                 |
| Rain, seasons and storm on a phone's frame rate and memory; thunder on a phone                                                                              | The owner, Task 7 Step 5                                                                                                                                           |
| That a plain-http address on `127.0.0.1` is reachable from the plugin's subprocess on a stock daemon                                                        | Task 7 Step 4                                                                                                                                                      |
| That `hub.watch` sees a phone's subscription the way it sees a desktop's                                                                                    | The same hub path serves both; Task 7 Step 4 closes and opens the office from one page only, so the owner confirms with a phone open and the desktop closed        |

## After the tasks (controller, with the owner's go-ahead)

Final whole-branch review (read especially: `weather.js`'s diff against upstream, that no log line or error text holds the address, `git diff --stat main` has nothing under `client/pixel/`); fixes; merge to `main`; push; CI green; `paseo plugin update office --ref <commit>` on the owner's host; the owner looks on desktop and on the phone (Manual rain and storm, then "From a service" with the example and their own coordinates, a wrong address and the Attention card, dark and light theme, a season on the scratch page if it is not in its window, the phone's frame rate); then tag `v0.8.0` and write its release notes, which say that the umbrella stand now stands at the entrance in every weather, that seasons follow the viewing device's date, and that the weather address is kept as typed in the host's settings file.
