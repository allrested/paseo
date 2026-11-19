# paseo-office piece 9: Languages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 3D office's signs, labels and speech come in English, Vietnamese, Thai or Indonesian, in the language a device chooses (or the app's, where the office has words for it), and a device downloads only its own language.

**Architecture:** my-office's `vi` and `th` locales are taken unchanged (less brand names) next to `en`, and the port writes `id` in upstream's locale format. The stand-in `i18n/index.js` keeps English bundled and gets one language set at start from JSON text. The build turns each non-English locale into one JSON string in `server/words.generated.ts`; the server sends the chosen one over a new RPC; the client loads it before the scene starts and passes it in the scene's start options. A change of language restarts the scene.

**Tech Stack:** TypeScript and React Native in a Paseo plugin (`/workspace/QFlavours/paseo-office`), plain JavaScript in `vendor/my-office/`, `@getpaseo/plugin` 0.16.2, Vitest with jsdom, `node:test` for the scripts, esbuild, the TypeScript compiler API (a dev dependency already) for one static check.

**Spec:** `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-paseo-office-roadmap-design.md` (piece 9, "9. Languages"), with the survey `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-my-office-survey.md` (section D.8).

## What reading the code found (it changes the roadmap's wording)

1. **The app has no Vietnamese, Thai or Indonesian.** Paseo's app names its locales `ar`, `en`, `es`, `fr`, `ja`, `ko`, `pt-BR`, `ru`, `zh-CN` (`packages/app/src/i18n/locales.ts` in the fork's checkout; `resolveSupportedLocale` falls back to `en`). A plugin reads that name as `i18n.locale` (`PluginI18n`, `@getpaseo/plugin/client`), through `useTranslation(...)`, which also re-renders on a change. So "follows the app's language" gives English for every user today, and a Vietnamese, Thai or Indonesian user cannot reach their language that way. This piece therefore adds a device setting, **Language of the 3D office**: Automatic (the default: the app's language where the office has words for it, else English), English, Tiếng Việt, ไทย, Bahasa Indonesia. Automatic starts to matter if Paseo ever names `vi`, `th` or `id`.
2. **Upstream's locales hold no functions** (the survey says a value may be one; none is). A locale is plain data and travels as JSON. The build refuses a function.
3. **No module of the scene looks a word up while it loads.** A check with the TypeScript compiler over the 122 files of `vendor/my-office/src/office/` found no call of `t`, `tr`, `num`, `lang` or `locale` outside a function body. So the language can be set in `start()`, before anything builds a label. Task 3 turns that check into a test, because an upstream update may add one.
4. **The 13 areas the scene ships are 1,428 leaves** (1,145 strings, 246 lists, 37 plural pairs). In JSON, `en` is 64 KB, `vi` 75 KB and `th` 117 KB (UTF-8). `vi` and `th` have no key `en` lacks and miss none of the 13 areas' keys. The 513 KB of the survey is the whole of both locales; only the 13 areas the English index names reach the scene.
5. **The scene's own English that is not in a locale:** the camera toolbar, the walk's overlay and photo mode's bar are hard-coded in the stand-in `ui/camera-bar.js`, although upstream has keys for each (`ui.cameraToolbar.*`, `ui.firstPersonHud.*`, `ui.photo.*`). The whiteboard's canvas text (`ui/whiteboard.js`) and the board's row text (`client/world/adapter.ts`, `boardText`) are the port's, and the rows carry the tool names the app derives in English.
6. **The vendored `vi` and `th` name real brands** in the shipped areas (values, not keys): Mixue, Phúc Long, GrabBike, GrabFood, Grab, Shopee, Xanh SM, Panadol, TikTok. English has the same lines.

## Decisions

1. **The lookup is the stand-in, extended** (`vendor/my-office/src/i18n/index.js`), not upstream's `index.js` taken with changes. _Why:_ upstream's file imports all three languages (every device would carry all of them), reads `<html lang>`, reads `process.env` (the bundle test forbids it), names the machine from `<html data-os>`, and has neither the emoji rule nor `OURS`; that is a change on nearly every line of 74, so each update would be a hand merge of the whole file. As a stand-in, the import tool reports a missing export by itself, and upstream's own `i18n.test.mjs` cases are ported as a test. _Cost if wrong:_ an upstream change to the lookup's rules (a new kind of value) goes unnoticed; so a step "read upstream's `i18n/index.js` by eye" is added to "Taking a newer upstream" in `vendor/SOURCES.md` (Task 3).
2. **Precedence of a line, first hit wins:** the language's own `ours` (Indonesian only) → `OURS` (the port's English wording) → the language's dictionary → English. _Why:_ `OURS` exists because upstream's line needs a file name or a command, which holds in every language, so it must beat `vi` and `th` too; in those two it stays English, as the roadmap says. _Cost if wrong:_ a Vietnamese or Thai user sees about 41 English lines among theirs.
3. **The emoji rule, `{mac}` as "host", and `plain()` hold in every language, unchanged.** Upstream's lines end in emoji in each language; the same expression strips them. _Cost if wrong:_ none known; the test strips-checks every `vi` and `th` leaf.
4. **A language reaches the scene as JSON text in `start()`:** two new start options, `language` (`"vi" | "th" | "id"`, absent for English) and `words` (a string, `{ "dict": {...areas}, "ours": {...flat keys} }`, `ours` for Indonesian only). _Why:_ a string crosses the frame's realm and the phone's message bridge alike (the bridge sends every non-function option as data) and is parsed inside the page. _Cost if wrong:_ a page that cannot parse it starts in English (the stand-in falls back and does not throw).
5. **Words travel as one generated module with one JSON string per language** (`server/words.generated.ts`, written by `scripts/build-world.mjs` beside the scene, checked by the same `--check`), and the server sends one on request (`office.world.words`, input `{ language }`, output the string). _Why:_ a device pays for its own language only (vi 75 KB, th 117 KB, id about 75 KB), there is one more build artefact and no more builds, and the scene bundle stays English. One module with three strings rather than a module per language: the server holds about 270 KB more in memory, which costs nothing, and one file is one thing to keep fresh. _Cost if wrong:_ the plugin's server bundle grows by that 270 KB.
6. **A language change restarts the scene.** _Why:_ upstream builds labels once in `setup()` (DOM chips, canvas textures, CSS2D labels) and changes language by reloading its page; its lookup caches the translator per language but nothing re-renders. The frame is thrown away and opened again, as piece 3's floor plan change does. _Cost if wrong:_ people walk in again after a change; a language is changed rarely.
7. **The choice is a device setting of its own, `office-language`** (`officeLanguageSettings`), not a field of `office-device`. _Why:_ `shared/settings.ts` says it for the column's setting: the view's and the incidents' saves write `office-device` whole and would drop a new field, and a client of an older version would drop it too. _Cost if wrong:_ one more settings document.
8. **The chat stays English in this piece.** The engine's lines are stored on the host and seen by every device, and its triggers are hard-coded Vietnamese and English words in `chat-engine.js` (`/họp|meeting|stand-?up/`, `/trà sữa|milk ?tea/` and so on): a Thai or Indonesian chat line could not be answered by it. A conversation in one language needs a host setting for it, and a rule for the lines already stored. The `chat` area is therefore not translated into Indonesian and not shipped in any words module. The director's name in the chat stays "Director" (`@Director` is how it is mentioned), while the scene's tag follows the language. This is written in the README. _Cost if wrong:_ a Vietnamese user sees an English chat; a later piece chooses a host language and takes the `chat` areas.
9. **`vi` and `th` are taken by the import tool, whole area files unchanged, for the same 13 areas English ships.** The tool's `DENY` line `^i18n\/locales\/(?!en\/)` becomes `(?!(?:en|vi|th)\/)` and the tool writes one generated `index.js` per locale. Brand names are the one change by hand (decision 11).
10. **Indonesian is the port's, in upstream's format, in `vendor/my-office/src/i18n/locales/id/`, for the 13 shipped areas, plus `ours.js`.** Upstream's rule is "a language may leave keys out" (its `i18n.test.mjs` checks only that a language has no key English lacks), so a partial `id` can be offered to my-office as it is, and the other 20 areas (`cli`, `server`, `mac`, `demo`, `chat` and the rest, 112 KB, none of it shown by the port) are left for a later offer. Every key of each translated file is kept, in order. A plural pair has only `other` (Indonesian has one plural form: `Intl.PluralRules("id-ID").select(n)` is `other` for every `n`, which a test checks); a list keeps its length. _Cost if wrong:_ an upstream offer is partial.
11. **No locale may name a real brand. The test scans every leaf value of `en`, `vi`, `th` and `id`; on a hit, `scripts/replace-locale-brands.mjs` replaces the name with a made-up one**, adds a `// PASEO:` line to the file's head, and the file is listed in `vendor/SOURCES.md`. The list of names is piece 8's eight shops plus the names found in the shipped text (Shopee, Grab, Xanh SM, Panadol, TikTok). The import tool then reports each such file as kept; at an update the file is deleted, the tool run, and the script run again. _Cost if wrong:_ a hand step at each update, for about six files.
12. **The camera bar's, the walk overlay's and photo mode's text comes from upstream's keys** (Task 3). _Why:_ they are upstream's words with translations already in `vi` and `th`; the stand-in only hard-coded their English. English reads the same as before. _Cost if wrong:_ if piece 4 replaced the stand-in by upstream's file, the step is skipped.
13. **Still English, on purpose, listed in the README:** the whiteboard's text and the board rows (`adapter.ts` `boardText`, the app's activity words), the host-sent toasts, karaoke's lyrics and titles in Thai and Indonesian (`karaoke-songs.js` has `vi` and `en` only, and `karaoke.js` already picks `vi` when `lang()` is `vi`), and the whole of the office's own interface (column, cards, settings page). _Cost if wrong:_ a partly English scene in `th` and `id`.
14. **Words that fail to load do not take the 3D view away.** The scene starts in English and the floor's note line says the language could not be loaded. A problem report would make the surface drop the 3D view (`onProblem`), which is wrong for a language.
15. **No fonts are shipped.** System fonts cover Vietnamese and Thai on the owner's devices (survey D.8); upstream ships optional ones. _Cost if wrong:_ boxes for Thai on a device without a Thai font; found in the look (Task 7).

## Global Constraints

- Work in `/workspace/QFlavours/paseo-office` on a branch `feat/languages` cut from `main`. The repo is public: nothing private in files, fixtures or commit messages (fixtures use "Acme", made-up paths); no AI attribution on commits; never push, never `gh` (the controller publishes).
- What my-office's author asked, from the roadmap: the MIT licence and notice kept; files taken unchanged wherever they can be; a change by hand starts with `// PASEO:` and is listed in `vendor/SOURCES.md`; the README links to https://github.com/khanh020905/my-office and says "community port, based on my-office".
- No real brand's logo, name or tune, in any locale (decision 11).
- The scene never receives a file name, a command or a prompt, and makes no network call. What this piece adds to what it is told: a language name and a dictionary. It adds no data from the host. The README's "What it reads and where it sends it" gains one line for it.
- App-side code (`client/`, `shared/`) uses nothing a phone's engine lacks (`client/engine-compat.test.ts` stays green). In particular nothing here may run at module load that Hermes might lack: `defineTranslations` calls `Intl.getCanonicalLocales`, so it is called lazily (Task 6), never at the top of a module.
- Only calls stock Paseo 0.16's SDK has: `useTranslation`, `defineTranslations`, `useSettings`, `useRpc`.
- Styles in `client/styles.ts`, never inline objects (the language row reuses `styles.notesDays`, `styles.segment*`, `styles.sheetLabel`, `styles.fieldHint`, `styles.headerField`, so no style is added). `OfficeSurface` stays under the lint complexity limit of 20: this piece adds nothing to it.
- Vendored files are not formatted or linted (`vendor/**` is ignored by `oxfmt` and `oxlint`); scripts and app code are: run `npm run format` on new `.mjs`, `.ts` and `.tsx` files.
- Never run a bare `paseo` command and never start, stop or restart the daemon on port 6767. A throwaway daemon uses `PASEO_HOME=/tmp/office-stock-home`, port 6798, `env -i`, and the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`.
- The import tool needs `/tmp/ref-office/my-office` (clone https://github.com/khanh020905/my-office there if missing, at `b68228871fe30cd2c759a2c919337a9a9d1f5644`, or at the commit `vendor/my-office/MANIFEST.json` names) and `/tmp/ref-office/three/node_modules/three` (three 0.160.0).
- Checks after each task: `npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts`, and the test files touched; the whole suite (`npm test -- --maxWorkers=4 > /tmp/office-test.log 2>&1`) before each commit. After any change under `vendor/my-office/src/office/` or the English locale, run `npm run build:world` first.

## Assumes from earlier pieces (re-check when this piece's turn comes)

- **Piece 3 (floor plans):** the 3D view restarts the scene when the floor plan changes, by a dependency on the frame effect in `client/world/world-view.tsx` and a `key` on the frame in `client/world/world-view-native.tsx`, and `PLAN` in `use-world-feed.ts` became a setting. Task 6 adds the language to the same dependency list and the same key. If piece 3 restarted the scene another way, follow it.
- **Piece 4 (camera extras):** `ui/camera-bar.js` is still a stand-in whose markup is the template `BAR`, now with more buttons; the labels it added use upstream's keys. If piece 4 took upstream's `camera-bar.js` instead, Task 3 step 7 is skipped.
- **Pieces 5 and 8 (staff scenes, the street):** the English index (`vendor/my-office/src/i18n/locales/en/index.js`) may name more than the 13 areas today (`staff`-like text lives in `people`, `life`, `world`, `places`, `events` already; `trophies`, `mac` or `tips` may have been added). This plan reads the list from the generated index at the time, never from the table in this document. They may also have added keys to `OURS`: the Indonesian `ours.js` must have exactly the keys `OURS` has then (the test says which are missing).
- **Piece 8 (the street):** it added a generated module for the street's assets and an RPC that sends them on request, and it keeps a list of the real names it replaced (its bundle test refuses them). This piece mirrors that method for words (decision 5) with its own RPC; if piece 8 built one general "asset by name" RPC, `office.world.words` may be folded into it, at the cost of a different input type. Task 2 step 1 reconciles the list of names.
- **Piece 2 (sounds):** nothing needed.
- **Piece 1:** `client/column-model.ts` and the session tabs are unrelated; `docs/office.md`'s column section is not touched.

## Not verifiable until built

| What                                                                                                                                                   | How the plan finds out                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `useTranslation(...)` inside the office's surface returns the app's locale and re-renders on a change (it throws outside a contributed plugin surface) | Task 7 look: the 3D view starts in the throwaway daemon's app with no error in the console; if it throws, `useAppLocale` is wrapped to fall back to `"en"` and the finding is recorded |
| Whether an office already open picks up a language saved on the settings page                                                                          | Task 7: save a language, go back to the open office; if the scene does not restart, the README says "reopen the office"                                                                |
| Vietnamese and Thai glyphs, and long lines, in labels, chips, speech bubbles and canvas textures (signs) at 1280 and 390 px                            | Task 7 look (the throwaway daemon has no agents: chips and the toolbar are seen, speech bubbles are not)                                                                               |
| Thai and Vietnamese on a real phone's WebView, and the words' RPC over a relay                                                                         | The owner, on the host (Task 7 names it)                                                                                                                                               |
| Whether the `ScriptFrame` restart on a `key` change shows a blank frame for long on a phone                                                            | The owner, on the host                                                                                                                                                                 |
| That the Indonesian text reads well                                                                                                                    | The owner, a native speaker, with the list Task 7 prints; this is the release gate                                                                                                     |

---

### Task 1: Take `vi` and `th`

**Files:**

- Modify: `vendor/my-office/import-upstream.mjs`, `vendor/SOURCES.md`
- Create (by the tool): `vendor/my-office/src/i18n/locales/vi/*.js` (13 areas and `index.js`), `vendor/my-office/src/i18n/locales/th/*.js` (the same 13, plus `people-a.js` and `people-b.js`, and `index.js`); `vendor/my-office/MANIFEST.json` changes
- Test: none new (the tool's own `--check`; Task 2 tests the files)

**Interfaces:**

- Produces: `locales/<language>/index.js` for `vi` and `th`, each `export default { common, time, ... }` with the same area names as English's index, in the same order. Later tasks read them through `scripts/locale-words.mjs`.

- [ ] **Step 1: Create the branch and look at what the tool says today**

```bash
cd /workspace/QFlavours/paseo-office && git switch -c feat/languages main
node vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check
```

Expected: `would write: 0, unchanged: <N>`, and the files "kept" that carry a `PASEO:` note (`core/env.js`, `interact/first-person.js`, `interact/place-cards.js`, `life/tests.js`, `ui/photo.js` at the time of writing, more after earlier pieces). Write the list down: it must be the same after this task.

- [ ] **Step 2: Change the tool**

In `vendor/my-office/import-upstream.mjs`:

1. In `DENY`, replace `/^i18n\/locales\/(?!en\/)/,` with `/^i18n\/locales\/(?!(?:en|vi|th)\/)/,`. In the comment above `DENY`, say "every language but English, Vietnamese and Thai".
2. Near the top, after `const CHECK = ...`, add `const LOCALES = [["en", "English"], ["vi", "Vietnamese"], ["th", "Thai"]];`
3. Replace the line `for (const [, file] of usedAreas) visit(\`i18n/locales/en/${file}.js\`);` with:

```js
for (const [language] of LOCALES) {
  // (a locale's area may import its own parts: Thai splits `people` and `chat`; `visit` follows them)
  for (const [, file] of usedAreas) visit(`i18n/locales/${language}/${file}.js`);
}
```

4. Replace the `put(outOf("i18n/locales/en/index.js"), [...])` call with a loop that writes one index per locale. English's text must stay byte for byte what it is today (so the tool reports `unchanged` for it); the others say their language:

```js
for (const [language, name] of LOCALES) {
  put(
    outOf(`i18n/locales/${language}/index.js`),
    [
      `// Generated by import-upstream.mjs: the ${name} areas the kept modules name. Do not edit.`,
      ...usedAreas.map(([area, file]) => `import ${area} from './${file}.js';`),
      "",
      `export default { ${usedAreas.map(([area]) => area).join(", ")} };`,
      "",
    ].join("\n"),
  );
}
```

5. In the final summary `console.log`, add `locales: ${LOCALES.map(([language]) => language).join(" ")}`.

- [ ] **Step 3: See what it would write, then write it**

```bash
node vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check
```

Expected: `would write: 28` or near it (13 `vi` files + their index, 13 `th` files + `people-a`, `people-b` + index, minus nothing from English), and the kept list unchanged. If the tool throws `upstream has no i18n/locales/th/...`, an area in the English index is missing from that locale: stop and report which. Then run it without `--check`.

- [ ] **Step 4: Confirm it is stable and nothing else moved**

```bash
node vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check
git status --short
```

Expected: `would write: 0`; only `import-upstream.mjs`, `MANIFEST.json` and the new `locales/vi`, `locales/th` files are changed or new. `MANIFEST.json`'s `files` gained the `i18n/locales/vi/...` and `th/...` entries. `npm run check:world` still passes (the stand-in imports English only, so the bundle is unchanged). Quick check that both load and match English's keys:

```bash
node -e "
import('./vendor/my-office/src/i18n/locales/vi/index.js').then(async (v) => { const t = await import('./vendor/my-office/src/i18n/locales/th/index.js'); const e = await import('./vendor/my-office/src/i18n/locales/en/index.js'); console.log(Object.keys(v.default).join() === Object.keys(e.default).join(), Object.keys(t.default).join() === Object.keys(e.default).join()); });"
```

Expected: `true true`.

- [ ] **Step 5: `vendor/SOURCES.md`**

- "What is not taken": remove "other languages" from the list.
- Add to "What is taken", after the chat paragraph: "The `vi` and `th` locales are taken whole-area, unchanged, for the areas English's generated index names (`i18n/locales/vi/` and `th/`, with their own generated `index.js`). Indonesian (`i18n/locales/id/`) is not upstream's: the port wrote it in upstream's format (Task 4 of piece 9)."
- Do not describe the stand-in or brand changes yet (Tasks 2 and 3 do).

- [ ] **Step 6: Run the checks and commit**

Run the chain from Global Constraints and the whole suite, then:

```bash
git add -A && git commit -m "feat: my-office's Vietnamese and Thai locales are taken by the import tool"
```

---

### Task 2: No real brand in any locale

**Files:**

- Create: `scripts/locale-words.mjs`, `scripts/locale-brands.mjs`, `scripts/replace-locale-brands.mjs`
- Test: `scripts/locale-brands.test.mjs`
- Modify (by the script): the vendored `locales/vi/*.js`, `locales/th/*.js` (and `locales/en/*.js` only if it still has a name), `vendor/SOURCES.md`

**Interfaces:**

- Produces `scripts/locale-words.mjs` (used by Tasks 2, 4 and 5):

```js
export const ROOT, LOCALES_DIR, STAND_IN;                 // absolute paths
export function otherLanguages(): string[];               // folders of LOCALES_DIR but "en", sorted
export const localeFile = (language, file) => string;     // LOCALES_DIR/<language>/<file>.js
export const loadLocale = (language) => Promise<object>;  // index.js's default export
export const loadArea = (language, file) => Promise<object>;
export async function loadOurs(language): Promise<object | null>; // locales/<language>/ours.js, or null
export function areasOf(language): [name: string, file: string][];  // from index.js's imports
export const isPair = (value) => boolean;                 // { one?, other }
export function leaves(object, prefix = ""): [path: string, value: unknown][]; // a pair and a list are one leaf
export function stringsOf(value): string[];               // the strings in one leaf
export function assertPlain(value, where): void;          // throws on a function, undefined, symbol or bigint
```

- Produces `scripts/locale-brands.mjs`: `BRANDS`, `findBrands(text): string[]` (names found), `replaceBrands(text): string`.

- [ ] **Step 1: Reconcile the list of names with piece 8**

Find piece 8's list of real names and the made-up names it chose: `grep -rn "Mixue" scripts server client vendor/my-office/*.json --include=* -l` (its bundle test in `server/world-script.test.ts` and wherever it keeps the eight). Use its spelling and its made-up names for the eight shops in `BRANDS` below, in place of the defaults written here. If it exports the list from a module, import it instead of copying. The defaults, used if piece 8 has none: Mixue → Frosty Cone, Highlands → Hilltop Coffee, Katinat → Tea Corner, Phúc Long → Lotus Tea, Long Châu → Green Cross Pharmacy, Cộng Cà Phê → Retro Coffee, Điện Máy Xanh → Blue Electro, Thế Giới Di Động → Pocket Plaza.

- [ ] **Step 2: Write `scripts/locale-words.mjs`**

```js
// What the locale tests, the brand script and the words build read: the locale folders under the
// vendored i18n. A locale's index.js is a folder's entry; `ours.js` (Indonesian only) is the port's
// own wording of the stand-in's OURS strings.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const LOCALES_DIR = path.join(ROOT, "vendor/my-office/src/i18n/locales");
export const STAND_IN = path.join(ROOT, "vendor/my-office/src/i18n/index.js");

export function otherLanguages() {
  return readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "en")
    .map((entry) => entry.name)
    .sort();
}

export const localeFile = (language, file) => path.join(LOCALES_DIR, language, `${file}.js`);
const load = async (file) => (await import(pathToFileURL(file).href)).default;
export const loadLocale = (language) => load(localeFile(language, "index"));
export const loadArea = (language, file) => load(localeFile(language, file));
export async function loadOurs(language) {
  const file = localeFile(language, "ours");
  return existsSync(file) ? load(file) : null;
}

/** The areas an index.js imports, as [name, file], in order. */
export function areasOf(language) {
  const text = readFileSync(localeFile(language, "index"), "utf8");
  return [...text.matchAll(/^import (\w+) from '\.\/(\w[\w-]*)\.js';/gm)].map((m) => [m[1], m[2]]);
}

export const isPair = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) && "other" in value;

/** Every leaf as [dotted path, value], upstream's rule: a { one, other } pair and a list are one leaf. */
export function leaves(object, prefix = "") {
  return Object.entries(object).flatMap(([key, value]) =>
    typeof value === "object" && value !== null && !Array.isArray(value) && !isPair(value)
      ? leaves(value, `${prefix}${key}.`)
      : [[`${prefix}${key}`, value]],
  );
}

export function stringsOf(value) {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.filter((item) => typeof item === "string");
  if (isPair(value)) return [value.one, value.other].filter((item) => typeof item === "string");
  return [];
}

/** A locale travels as JSON: no function, no undefined. */
export function assertPlain(value, where = "locale") {
  if (
    typeof value === "function" ||
    typeof value === "undefined" ||
    typeof value === "symbol" ||
    typeof value === "bigint"
  ) {
    throw new Error(`${where} is a ${typeof value}: a locale must be plain data`);
  }
  if (typeof value === "object" && value !== null) {
    for (const [key, inner] of Object.entries(value)) assertPlain(inner, `${where}.${key}`);
  }
}
```

- [ ] **Step 3: Write the failing tests**

`scripts/locale-brands.test.mjs`:

```js
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { BRANDS, findBrands, replaceBrands } from "./locale-brands.mjs";
import { ROOT, leaves, loadLocale, otherLanguages, stringsOf } from "./locale-words.mjs";

test("a made-up name is not itself a real one", () => {
  for (const { generic } of BRANDS) {
    for (const text of typeof generic === "function"
      ? [generic("Grab"), generic("GrabBike"), generic("GrabFood")]
      : [generic]) {
      assert.deepEqual(findBrands(text), [], text);
    }
  }
});

test("a name is found where it stands alone, not inside a word, a key or another language's letters", () => {
  assert.deepEqual(findBrands("ไป Mixue ไอศกรีม"), ["Mixue"]);
  assert.deepEqual(findBrands("shipper GrabFood tới rồi"), ["Grab"]);
  assert.deepEqual(findBrands("trà sữa Phúc Long"), ["Phúc Long"]);
  assert.deepEqual(findBrands("Shopee, TikTok and Panadol"), ["Shopee", "Panadol", "TikTok"]);
  assert.deepEqual(findBrands("grab a coffee"), []);
  assert.deepEqual(findBrands("mixueHot: 'x'"), []);
  assert.deepEqual(findBrands("traSuaPhucLong: 'x'"), []);
  assert.deepEqual(findBrands("{ mixue: 'x' }"), []);
});

test("a replacement keeps the text round the name and is done once", () => {
  const once = replaceBrands("Em ra Mixue mua kem, rồi gọi GrabBike 🍦");
  assert.equal(once, "Em ra Frosty Cone mua kem, rồi gọi Ridely Bike 🍦");
  assert.equal(replaceBrands(once), once);
});

test("no locale names a real brand in a line it shows", async () => {
  const hits = [];
  for (const language of ["en", ...otherLanguages()]) {
    for (const [key, value] of leaves(await loadLocale(language))) {
      for (const text of stringsOf(value)) {
        for (const name of findBrands(text)) hits.push(`${language} ${key}: ${name}`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

test("a vendored locale file is upstream's text unless it says it was changed", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(ROOT, "vendor/my-office/MANIFEST.json"), "utf8"),
  );
  const changed = [];
  for (const [rel, sha] of Object.entries(manifest.files)) {
    if (!rel.startsWith("i18n/locales/")) continue;
    const text = readFileSync(path.join(ROOT, "vendor/my-office/src", rel), "utf8");
    if (createHash("sha256").update(text).digest("hex") !== sha && !text.includes("// PASEO:"))
      changed.push(rel);
  }
  assert.deepEqual(changed, []);
});
```

- [ ] **Step 4: Run it and see it fail**

Run: `node --test scripts/locale-brands.test.mjs`
Expected: FAIL, cannot find `./locale-brands.mjs`.

- [ ] **Step 5: Write `scripts/locale-brands.mjs`**

```js
// The real names no locale may carry, and the made-up name each gives way to. A name is found where
// it stands alone: not inside a word or an identifier (`mixueHot`), not as an object key, and also
// when a Thai or Vietnamese letter touches it. The eight shops are piece 8's street; the rest are
// names the shipped text acts out (delivery, rides, a pharmacy brand, a video app).
const edge = (source, flags) =>
  new RegExp(`(?<![A-Za-z0-9_])(?:${source})(?![A-Za-z0-9_])(?!['"]?\\s*:)`, `${flags}g`);

export const BRANDS = [
  { name: "Mixue", pattern: edge("Mixue", "i"), generic: "Frosty Cone" },
  { name: "Highlands", pattern: edge("Highlands(?: Coffee)?", ""), generic: "Hilltop Coffee" },
  { name: "Katinat", pattern: edge("Katinat", "i"), generic: "Tea Corner" },
  { name: "Phúc Long", pattern: edge("Ph[uú]c Long", "i"), generic: "Lotus Tea" },
  { name: "Long Châu", pattern: edge("Long Ch[aâ]u", "i"), generic: "Green Cross Pharmacy" },
  { name: "Cộng Cà Phê", pattern: edge("C[ộo]ng C[àa] Ph[êe]", "i"), generic: "Retro Coffee" },
  { name: "Điện Máy Xanh", pattern: edge("[ĐD]i[ệe]n M[áa]y Xanh", "i"), generic: "Blue Electro" },
  {
    name: "Thế Giới Di Động",
    pattern: edge("Th[ếe] Gi[ớo]i Di [ĐD][ộo]ng", "i"),
    generic: "Pocket Plaza",
  },
  { name: "Shopee", pattern: edge("Shopee", "i"), generic: "ParcelPal" },
  {
    name: "Grab",
    pattern: edge("Grab(?:Bike|Food)?", ""),
    generic: (found) => found.replace("Grab", "Ridely").replace(/(Bike|Food)$/, " $1"),
  },
  { name: "Xanh SM", pattern: edge("Xanh SM", ""), generic: "Green Cab" },
  { name: "Panadol", pattern: edge("Panadol", "i"), generic: "Painaway" },
  { name: "TikTok", pattern: edge("TikTok", "i"), generic: "Vidloop" },
];

/** The names of BRANDS that `text` contains, once per occurrence, in the order of the list. */
export function findBrands(text) {
  const found = [];
  for (const { name, pattern } of BRANDS) {
    for (const _ of text.normalize("NFC").matchAll(pattern)) found.push(name);
  }
  return found;
}

export function replaceBrands(text) {
  let out = text;
  for (const { pattern, generic } of BRANDS) {
    out = out.replace(pattern, (found) =>
      typeof generic === "function" ? generic(found) : generic,
    );
  }
  return out;
}
```

Note: `{ mixue: 'x' }` is a key: the `(?!['"]?\s*:)` lookahead refuses it. `GrabBike` becomes `Ridely Bike`.

- [ ] **Step 6: Write `scripts/replace-locale-brands.mjs`**

```js
#!/usr/bin/env node
// Replaces real brand names in the vendored locale files (English, Vietnamese, Thai) with made-up
// ones and puts a `// PASEO:` line at the head of each file it changes. The import tool then keeps
// the file instead of overwriting it. `--check` changes nothing and exits 1 when a name is left.
//
// To take a newer upstream: delete the changed locale files, run the import tool, run this again.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { findBrands, replaceBrands } from "./locale-brands.mjs";
import { LOCALES_DIR } from "./locale-words.mjs";

const CHECK = process.argv.includes("--check");
let files = 0;
let names = 0;
for (const language of ["en", "vi", "th"]) {
  const dir = path.join(LOCALES_DIR, language);
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "index.js")) {
    const full = path.join(dir, file);
    const text = readFileSync(full, "utf8");
    const found = [...new Set(findBrands(text))];
    if (found.length === 0) continue;
    files += 1;
    names += findBrands(text).length;
    console.log(`${language}/${file}: ${found.join(", ")}`);
    if (CHECK) continue;
    const note = `// PASEO: real brand names replaced by made-up ones (scripts/replace-locale-brands.mjs): ${found.join(", ")}.\n`;
    writeFileSync(full, note + replaceBrands(text));
  }
}
console.log(`${names} names in ${files} files${CHECK ? "" : ", replaced"}`);
if (CHECK && files > 0) process.exit(1);
```

- [ ] **Step 7: Run the unit tests, then the scan, and see the real hits**

```bash
npx oxfmt scripts/locale-words.mjs scripts/locale-brands.mjs scripts/replace-locale-brands.mjs scripts/locale-brands.test.mjs
node --test scripts/locale-brands.test.mjs
node scripts/replace-locale-brands.mjs --check
```

Expected: the first four tests pass; "no locale names a real brand" fails, and `--check` lists, at the time of writing: `vi/fp.js` (Panadol, Phúc Long), `vi/people.js` (GrabBike, GrabFood, Mixue x3, Shopee x6, Xanh SM x2), `vi/ui.js` (TikTok), `vi/world.js` (Grab x2, GrabBike, Xanh SM x2), and the same for `th` (with `people-a.js` and `people-b.js`), and the same for `en` unless piece 8 already replaced them. Names in comments count too.

- [ ] **Step 8: Replace**

```bash
node scripts/replace-locale-brands.mjs
node scripts/replace-locale-brands.mjs --check   # expect: 0 names in 0 files, exit 0
node --test scripts/locale-brands.test.mjs        # expect: all pass
git diff --stat vendor/my-office/src/i18n
```

Read the diff of one file in each language: only the names changed, a header line was added, no key changed. If a name sat in a place the replacement reads badly (a sentence that said "a Grab" and now says "a Ridely"), leave it: the made-up name is a name. If `en` changed (piece 8 had not covered it), run `npm run build:world` and commit the new `server/world.generated.ts` with it.

- [ ] **Step 9: The import tool must keep these files**

```bash
node vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check
```

Expected: `would write: 0`, and the "kept" list now also names each changed locale file. Nothing is overwritten.

- [ ] **Step 10: `vendor/SOURCES.md`, checks, commit**

In "Five copied files are changed by hand" (the count has changed; say "These copied files are changed by hand"), add: "The locale files that carry a `// PASEO: real brand names replaced` line (`scripts/replace-locale-brands.mjs`; the list is `node scripts/replace-locale-brands.mjs --check` run on upstream's text): no locale may name a real brand. The names are in `scripts/locale-brands.mjs` with the made-up name for each." In "Taking a newer upstream" add: "Delete the locale files that carry the brand line, run the tool, run `node scripts/replace-locale-brands.mjs`; `npm run test:scripts` then says if a name is left."

Run the chain and the whole suite, then:

```bash
git add -A && git commit -m "feat: no locale names a real brand, and a test says so"
```

---

### Task 3: The lookup takes a language, and the scene starts in it

**Files:**

- Modify: `vendor/my-office/src/i18n/index.js`, `vendor/my-office/src/office/paseo-entry.js`, `vendor/my-office/src/office/ui/camera-bar.js`, `client/world/world-api.ts`, `vendor/SOURCES.md`
- Test: `client/world/i18n.test.ts` (new), `scripts/i18n-toplevel.test.mjs` (new), `client/world/entry.test.ts`, `client/world/camera-bar.test.ts`, `client/world/world-bridge.test.ts`

**Interfaces:**

- Produces, from the stand-in (`vendor/my-office/src/i18n/index.js`), beside upstream's `t`, `num`, `lang`, `locale`, `createT`, `DEFAULT_LANG`:

```js
export const OURS; // the port's English wording, flat keys (now exported)
export const pickLang = (l) => "en" | "vi" | "th" | "id";
/** `words` is JSON text { dict, ours? }; text that does not parse, or a language it is not for, leaves English. */
export function setLanguage(language, words) {}
```

- Produces, in `WorldStartOptions` (`client/world/world-api.ts`): `language?: "vi" | "th" | "id"` and `words?: string`.
- Consumed by Task 5 (the words' JSON shape) and Task 6 (the start options).

- [ ] **Step 1: Write the failing lookup tests**

`client/world/i18n.test.ts` (vitest, no DOM). It ports the cases of upstream's `tests/unit/i18n.test.mjs` (slots, plurals, lists, the fallback, `num` per locale) and adds the stand-in's own rules:

```ts
import { afterEach, expect, test } from "vitest";
// @ts-expect-error vendored JavaScript has no declarations
import { OURS, lang, locale, num, setLanguage, t } from "../../vendor/my-office/src/i18n/index.js";
// @ts-expect-error vendored JavaScript has no declarations
import th from "../../vendor/my-office/src/i18n/locales/th/index.js";
// @ts-expect-error vendored JavaScript has no declarations
import vi from "../../vendor/my-office/src/i18n/locales/vi/index.js";

const words = (dict: object, ours?: object) =>
  JSON.stringify(ours === undefined ? { dict } : { dict, ours });
afterEach(() => setLanguage("en"));
```

Cases:

- English by default: `lang()` is `en`, `locale()` is `en-US`; `t("time.min", { n: 3 })` is `3 min`; `t("time.day", { n: 1 })` is `1 day`, with `{ n: 2 }` `2 days`; an unknown key gives the key, and `"list"` of it gives `[]`; `num(1234.5, 1)` is `1,234.5`.
- Vietnamese: after `setLanguage("vi", words(vi))`, `lang()` is `vi`, `locale()` `vi-VN`, `t("time.day", { n: 2 })` is `2 ngày`, `num(1234.5, 1)` is `1.234,5`.
- Thai: after `setLanguage("th", words(th))`, `lang()` is `th`, `locale()` `th-TH`, and `t("time.day", { n: 2 })` matches `/[\u0E00-\u0E7F]/` and is not `2 days`.
- A key the language lacks is English: `setLanguage("vi", words({ time: {} }))`, then `t("time.day", { n: 2 })` is `2 days`.
- `{mac}` and `{Mac}` are the host: `words({ x: { y: "Mở trên {mac}", z: "{Mac}" } })` gives `Mở trên host` and `Host`.
- The emoji rule holds in a language: `words({ x: { y: "Xong rồi 🎉", z: ["a 🎉", "b"], only: "🎉" } })` gives `Xong rồi`; `t("x.z", null, "list")` is `["a", "b"]`; `only` stays `🎉`.
- Every `vi` and `th` leaf comes out without emoji (walk both dictionaries; for a string use `t(key, { n: 2 })`, for a list `t(key, null, "list")`; a pair uses `{ n: 2 }`); no output matches `/\p{Extended_Pictographic}/u` unless the line was nothing but emoji.
- `OURS` beats a language's own line: for every string value of `OURS`, `t(key, vars)` in `en`, in `vi` (with `words(vi)`) and in `th` is the same text (`vars` is `{ n: 2, label: "x", key: "K", title: "T" }`); a pair is checked the same way.
- Indonesian carries its own: `setLanguage("id", words({}, { "people.handOver": "Tugas baru untukmu", "world.dev.lost": { other: "{n} agen" } }))` gives `Tugas baru untukmu` and, for `t("world.dev.lost", { n: 1 })`, `1 agen`; an `OURS` key it does not name stays English.
- Bad input is English, never a throw: `setLanguage("vi", "not json")`, `setLanguage("vi")`, `setLanguage("xx", words({}))`, `setLanguage("vi", JSON.stringify({}))` all give `lang()` `en`.
- Setting `"en"` again goes back: after `setLanguage("vi", words(vi))`, `setLanguage("en")` gives `t("time.day", { n: 2 })` `2 days`.

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run client/world/i18n.test.ts`
Expected: FAIL, `setLanguage` is not exported (and `OURS` is undefined).

- [ ] **Step 3: Write the stand-in**

Replace `vendor/my-office/src/i18n/index.js` by the file below. The `OURS` object is moved over **unchanged**, with its comments: copy it from the current file, and add `export` to it. Everything else is new.

```js
// PASEO: stand-in for my-office's i18n/index.js. Same calls as upstream: t(key, vars, as), num(n, digits), lang(),
// locale(), createT(). What differs, each on purpose:
// - Upstream imports every language and reads the page's <html lang>. Here English is bundled and one more language is
//   set once, by setLanguage(), from the words the host sent for it (JSON text), so a device carries only its own.
// - Upstream's lines end in emoji; Paseo's labels are text and the speech bubbles have line icons, so a line is given
//   without them (a line that is nothing but emoji is kept as it is). The rule holds in every language.
// - OURS is Paseo's wording where upstream's line needs a file name, a command or a repository's state. It is English
//   in every language but Indonesian, whose words bring their own `ours`.
// - {mac} is "host": the office runs on a host, upstream's names the machine from <html data-os>.
// A line is looked up in: the language's `ours`, OURS, the language's dictionary, English.
import en from "./locales/en/index.js";

export const DEFAULT_LANG = "en";
const LOCALES = { en: "en-US", vi: "vi-VN", th: "th-TH", id: "id-ID" };
const own = (object, key) => Object.prototype.hasOwnProperty.call(object, key);
export const pickLang = (l) => (typeof l === "string" && own(LOCALES, l) ? l : DEFAULT_LANG);

export const OURS = {
  /* ... the object as it is today, every key and comment kept ... */
};

const get = (dict, key) => {
  let o = dict;
  for (const k of key.split(".")) {
    if (o == null || typeof o !== "object") return undefined;
    o = o[k];
  }
  return o;
};
const EMOJI =
  /\s*(?![©®™])\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]*/gu;
const plain = (s) => {
  if (typeof s !== "string") return s;
  const out = s.replace(EMOJI, "").trim();
  return out === "" ? s : out;
};
const fill = (s, vars) =>
  vars ? s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] == null ? m : String(vars[k]))) : s;

const ENGLISH = {
  lang: DEFAULT_LANG,
  locale: LOCALES.en,
  dict: null,
  ours: null,
  plural: new Intl.PluralRules(LOCALES.en),
};
let now = ENGLISH;
const object = (v) => (v !== null && typeof v === "object" && !Array.isArray(v) ? v : null);

/**
 * Sets the language the office speaks. `words` is the JSON text the host sent for it: { dict, ours? }, `dict` one entry per
 * area. Anything else (no text, text that does not parse, a language the office has no words for) leaves English.
 */
export function setLanguage(language, words) {
  const lang = pickLang(language);
  let parsed = null;
  if (lang !== DEFAULT_LANG && typeof words === "string") {
    try {
      parsed = object(JSON.parse(words));
    } catch {
      parsed = null;
    }
  }
  const dict = object(parsed?.dict);
  now = dict
    ? {
        lang,
        locale: LOCALES[lang],
        dict,
        ours: object(parsed.ours),
        plural: new Intl.PluralRules(LOCALES[lang]),
      }
    : ENGLISH;
  t.lang = now.lang;
  t.locale = now.locale;
}

const lookup = (key) => {
  if (now.ours && own(now.ours, key)) return now.ours[key];
  if (own(OURS, key)) return OURS[key];
  const v = now.dict ? get(now.dict, key) : undefined;
  return v !== undefined ? v : get(en, key);
};

/** @type {(key: string, vars?: object|null, as?: 'list') => any} */
export const t = (key, vars, as) => {
  let v = lookup(key);
  if (v === undefined) return as === "list" ? [] : key;
  if (as === "list") return (Array.isArray(v) ? v : [v]).map(plain);
  if (typeof v === "function") return plain(v(vars || {}, t));
  if (Array.isArray(v)) v = v[Math.floor(Math.random() * v.length)];
  else if (v && typeof v === "object") v = v[now.plural.select(Number(vars?.n ?? 0))] ?? v.other;
  v = String(v);
  // upstream names the machine it runs on; Paseo's office runs on a host
  if (v.includes("{mac}") || v.includes("{Mac}")) vars = { mac: "host", Mac: "Host", ...vars };
  return fill(plain(v), vars);
};
t.lang = DEFAULT_LANG;
t.locale = LOCALES.en;
export const num = (n, digits = 0) =>
  Number(n || 0).toLocaleString(now.locale, { maximumFractionDigits: digits });
export const lang = () => now.lang;
export const locale = () => now.locale;
export const createT = () => t;
```

- [ ] **Step 4: Run it and see it pass**

Run: `npx vitest run client/world/i18n.test.ts`
Expected: PASS. If the `OURS` equality case fails for a key, that key's English differs between languages: read why, never loosen the test.

- [ ] **Step 5: The static check that no module looks a word up while it loads**

`scripts/i18n-toplevel.test.mjs`:

```js
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import ts from "typescript";
import { ROOT } from "./locale-words.mjs";

const SCENE = path.join(ROOT, "vendor/my-office/src/office");
const FUNCTIONS = new Set([
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.MethodDeclaration,
  ts.SyntaxKind.GetAccessor,
  ts.SyntaxKind.SetAccessor,
  ts.SyntaxKind.Constructor,
]);

/** Calls of what a file imports from the i18n stand-in that run when the module loads, not inside a function. */
export function lookupsAtLoad(file, text) {
  const source = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.JS);
  const names = new Set();
  source.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && /i18n\/index\.js$/.test(node.moduleSpecifier.text)) {
      node.importClause?.namedBindings?.elements?.forEach((element) =>
        names.add(element.name.text),
      );
    }
  });
  const hits = [];
  const visit = (node, inside) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      names.has(node.expression.text) &&
      !inside
    ) {
      hits.push(
        `${file}:${source.getLineAndCharacterOfPosition(node.getStart()).line + 1} ${node.getText().slice(0, 60)}`,
      );
    }
    node.forEachChild((child) => visit(child, inside || FUNCTIONS.has(child.kind)));
  };
  source.forEachChild((child) => visit(child, FUNCTIONS.has(child.kind)));
  return hits;
}

test("the check sees a lookup at load and not one in a function", () => {
  const head = "import { t, t as tr } from '../i18n/index.js';\n";
  assert.equal(lookupsAtLoad("a.js", `${head}const A = tr('x.y');`).length, 1);
  assert.equal(lookupsAtLoad("a.js", `${head}const A = { b: [t('x.y')] };`).length, 1);
  assert.equal(
    lookupsAtLoad("a.js", `${head}const A = () => tr('x.y'); function f() { return t('a.b'); }`)
      .length,
    0,
  );
});

test("no module of the scene looks a word up while it loads: the language is set in start()", () => {
  const hits = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js"))
        hits.push(...lookupsAtLoad(path.relative(SCENE, full), readFileSync(full, "utf8")));
    }
  };
  walk(SCENE);
  assert.deepEqual(hits, []);
});
```

Run: `node --test scripts/i18n-toplevel.test.mjs`. Expected: PASS (the survey found none). If an earlier piece added one, the hit names the file and line: make that call lazy in the file (a marked change) or move it into `setup()`; do not move `setLanguage` out of the start of `start()`.

- [ ] **Step 6: The entry sets the language first**

Failing test first. In `client/world/entry.test.ts`, change the top-level `world.start({...})` to also pass a language, with a dictionary small enough that every other text stays English by the fallback:

```ts
world.start({
  brand: { name: "Acme" },
  language: "vi",
  words: JSON.stringify({ dict: { time: { day: { other: "{n} ngày" } } } }),
  onIncidents: () => {
    h.incidentsOpened += 1;
  },
});
```

and add a test (the same file's `i18n` is the module the entry imports):

```ts
// @ts-expect-error vendored JavaScript has no declarations
import { lang, locale, t } from "../../vendor/my-office/src/i18n/index.js";

test("the scene starts in the language it was given, before it builds the page", () => {
  expect(lang()).toBe("vi");
  expect(locale()).toBe("vi-VN");
  expect(document.documentElement.lang).toBe("vi");
  expect(t("time.day", { n: 2 })).toBe("2 ngày");
});
```

Run `npx vitest run client/world/entry.test.ts`: FAIL (`lang()` is `en`). Then, in `paseo-entry.js`:

- the import `import { t as tr } from '../i18n/index.js';` becomes `import { lang as language, setLanguage, t as tr } from '../i18n/index.js';`
- in `buildPage()`, `document.documentElement.lang = 'en';` becomes `document.documentElement.lang = language();`
- in `start(options = {})`, right after `started = true;` add `setLanguage(options.language, options.words);   // (before anything builds a label: upstream sets <html lang> before its scripts run)`
- in the doc comment of `start`, add `language` ('vi' | 'th' | 'id'; English when absent) and `words` (the JSON text of that language) to the options list.

Run the entry test again: PASS. The other tests of the file must be unchanged and green.

- [ ] **Step 7: The camera bar speaks in upstream's keys**

Failing tests first, in `client/world/camera-bar.test.ts` (which already calls `build()` against a jsdom page):

- With English, the bar's text is what it was: the `data-view` buttons' `aria-label`s are `Overview`, `Desks`, `Meeting room`, `Servers`; `#zoom-out` and `#zoom-in` are `Zoom out`, `Zoom in`; `#btn-full` is `Full screen`; `#btn-fp` is `Walk in`; the walk's help line starts `Walking the office`; `#ph-shoot` reads `Take photo`; `#ph-exit` has `aria-label` `Leave photo mode`.
- With a language set, `setLanguage("vi", JSON.stringify({ dict: { ui: { cameraToolbar: { home: "Tổng quan" }, photo: { shoot: "Chụp ảnh" } } } }))` before `build()`: the Overview button's `aria-label`, `title` and text are `Tổng quan`, `#ph-shoot` reads `Chụp ảnh`, and a label not in the dictionary (`Desks`) is English.
- A label with a quote, a `<` or an `&` is escaped: a dictionary with `home: 'A "b" <i> & c'` leaves one `.seg-btn` with that exact `aria-label` (read back with `getAttribute`) and no `<i>` element in the bar.
- A language set after `build()` changes nothing already built (documented, not tested).

Run: FAIL (English-only markup).

In `vendor/my-office/src/office/ui/camera-bar.js` (a stand-in, so no marker is needed beyond its own header; add a line to its top comment: "Its labels are upstream's keys, so they follow the scene's language."):

- `import { t } from '../../i18n/index.js'` (the file has no `t` import yet; add it, with the path its location needs).
- Add `const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');`
- Turn `const BAR = \`...\``into`const bar = () => { const x = (key) => esc(t(key)); return \`...\`; };`and in the template replace each English literal by`${x('...')}`with these keys of`locales/en/ui.js`: toolbar label `ui.cameraToolbar.label`; `ui.cameraToolbar.home`, `.desks`, `.meeting`, `.server`for the four views (attribute and text and title);`.zoomOut`, `.zoomIn`; `.fullscreen`; `.walkIn`for`#btn-fp`(its aria-label, title and text); the walk overlay's`<b>`by`ui.firstPersonHud.title`, its keys line by `ui.firstPersonHud.keys`, `#fp-exit`'s text by `ui.firstPersonHud.exit`; the photo bar's `aria-label`by`ui.photo.label`, `.photo-hint`by`ui.photo.hint`, `Names`by`ui.photo.names`, `Logo`by`ui.photo.mark`, `title="Picture size"`by`ui.photo.sizeTitle`, `Screen`by`ui.photo.screen`, `Take photo`by`ui.photo.shoot`, `#ph-exit`'s `aria-label`and`title`by`ui.photo.exit`. `Full HD`and`4K` stay literals (as upstream's are). If piece 4 added buttons, give each its upstream key the same way; a button with no upstream key stays as it is and is listed in the README.
- `build()` uses `bar()` in `insertAdjacentHTML('beforeend', bar())`.
- The toast `host.toast("This browser won't go full screen.")` becomes `host.toast(t('ui.cameraToolbar.noFullscreen'))`.
- Check the English text of each key equals the literal it replaces (`grep` each in `locales/en/ui.js`); where upstream's key has different words (for example `walkInTitle`), keep to `walkIn` so English reads as before.

Run `npx vitest run client/world/camera-bar.test.ts`: PASS.

- [ ] **Step 8: The option's type and the bridge**

In `client/world/world-api.ts`, `WorldStartOptions` gains, after `photo?`:

```ts
  /**
   * The language of the scene's text; absent is English. `words` is that language's text as the host sends it.
   * The scene starts in English when `words` is absent or cannot be read.
   */
  language?: "vi" | "th" | "id";
  words?: string;
```

(Task 5 replaces the literal union with `WordsLanguage` once `shared/scene-language.ts` exists.) The bridge already sends every non-function option as data: add the test in `client/world/world-bridge.test.ts`: `api.start(options({ language: "vi", words: '{"dict":{}}' }))` posts a `start` whose first argument has `language: "vi"` and `words: '{"dict":{}}'`. Run it: PASS without a change to `world-bridge.ts` (say so in the commit if so; if it fails, read why).

- [ ] **Step 9: Rebuild, update `vendor/SOURCES.md`, check, commit**

```bash
npm run build:world
```

Run the chain (the bundle test's size window in `server/world-script.test.ts` must still hold: this task adds under 3 KB; if it fails the window, do not widen it here, report it to the controller, since the window is piece 8's). In `vendor/SOURCES.md` change the `i18n/index.js` row of the stand-in table to: "English bundled; one more language set at start from the words the host sent (`vi`, `th`, `id`); drops the emoji upstream ends its lines with; Paseo's wording (`OURS`, English, or Indonesian's own) where upstream's line needs a file name or a command". In "Taking a newer upstream" add: "Read upstream's `src/i18n/index.js` (74 lines at v0.6.0) against the stand-in: a new kind of value or a new export is a change to make by hand; `client/world/i18n.test.ts` carries upstream's own cases." In "What the scene is told" add the language and words. Then:

```bash
git add -A && git commit -m "feat: the scene's lookup takes a language, and the camera bar uses upstream's words"
```

---

### Task 4: Indonesian

**Files:**

- Create: `vendor/my-office/src/i18n/locales/id/index.js` and one file per area of English's generated index (at the time of writing `common`, `time`, `ui`, `settings`, `fp`, `activity`, `incident`, `events`, `people`, `places`, `props`, `world`, `life`), `vendor/my-office/src/i18n/locales/id/ours.js`, `scripts/locale.test.mjs`, `scripts/id-review-list.mjs`, `scripts/id-review-notes.json`
- Test: `scripts/locale.test.mjs`
- Modify: `vendor/SOURCES.md`

**Interfaces:**

- Consumes: `scripts/locale-words.mjs` (Task 2), `OURS` exported by the stand-in (Task 3).
- Produces: `locales/id/index.js` (`export default { common, time, ... }`, the same areas in the same order as English's index) and `locales/id/ours.js` (`export default { 'people.handOver': '...', ... }`, exactly the keys of `OURS`, in its order). Task 5 ships them.

**The method.** Done area by area, from the English file, so a reviewer can put the two side by side.

1. Open `locales/en/<file>.js` in full. Open `locales/vi/<file>.js` of the same area only to see how a casual register was done there; never copy from it. Write `locales/id/<file>.js` with the same structure and the same key order, one file per English file, with the same leading comment translated or kept.
2. **Keep, exactly:** every key; the order; every `{placeholder}` (`{n}`, `{name}`, `{mac}`, `{Mac}`, any other); markup and entities; line breaks; the list's length and order; each emoji as English has it, in the same place (`🎉` ends the line where English's does: the lookup strips them for display, upstream shows them). A line English leaves in a foreign word (a tool name, a unit, a product) stays that word.
3. **Register.** Upstream's English is casual office banter. Speech bubbles, chat-like lines and jokes use casual standard Indonesian: `aku`, `kamu`, `kita`, a sparing `dong`, `nih`, `deh`, `ya`, everyday contractions in speech (`ngerjain`, `buat`, `lagi`); no Jakarta slang (`gue`, `lo`) and nothing that dates. Labels, button text, tooltips, settings and place names use neutral standard Indonesian (`Ruang rapat`, not a joke). Keep a joke's point, not its words: if a pun cannot be carried, write the nearest natural joke and note the key in `scripts/id-review-notes.json`. English: "A new task for you" is `Ada tugas baru buat kamu`; "Quick nap" is `Tidur sebentar`; "Feeding the fish" is `Lagi kasih makan ikan`; "Back in a minute" is `Sebentar, ya`; "Stand-up, everyone: what are you on?" is `Stand-up, semuanya: lagi ngerjain apa?`.
4. **Names of scenes and customs that are culturally specific stay as upstream's English names them** (a Vietnamese festival, a meal, a custom the English keeps in Vietnamese, a proper noun): do not invent an Indonesian equivalent and do not translate the name. Common places and things (meeting room, kitchen, printer, server) are translated. Note each such key in the notes file.
5. **Plurals:** a `{ one, other }` pair becomes `{ other: '...' }`: Indonesian does not mark the plural, so `one` would never show (the test checks `Intl.PluralRules("id-ID")` says `other` for every `n`).
6. **Numbers and units:** keep `{n}` and the unit's symbol; use Indonesian words for words (`menit`, `hari`, `jam`).
7. **Notes for the reader.** For every line the translator is not sure of (a joke, an idiom, a long line, a custom, a choice between two registers) add an entry to `scripts/id-review-notes.json`: `{ "people.hr.tea": "a pun on the milk tea; I used ..." }`. The key is the area name, the dotted key, and `[i]` for one line of a list (`events.verb.grep[2]`). The script in step 9 prints them with English and Indonesian side by side, and the owner reads that list first.
8. **Independent read.** After each batch is written and green, a second agent that is given only the English file, the Indonesian file and these rules (not the translator's notes) reads it and returns lines that read oddly, are wrong, or break the register. It fixes nothing: the translator decides, and adds a note for each line it keeps that the reader flagged.

- [ ] **Step 1: Write the failing test**

`scripts/locale.test.mjs`:

```js
import assert from "node:assert/strict";
import { test } from "node:test";
import { OURS } from "../vendor/my-office/src/i18n/index.js";
import { areasOf, isPair, leaves, loadArea, loadLocale, loadOurs } from "./locale-words.mjs";

const SLOT = /\{(\w+)\}/g;
const TAG = /<\/?[A-Za-z][^>]*>/g;
const EMOJI =
  /\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}\u{1F3FB}-\u{1F3FF}]*/gu;
const joined = (text, pattern) => (text.match(pattern) ?? []).join("|");
const slots = (text) =>
  [...text.matchAll(SLOT)]
    .map((m) => m[1])
    .sort()
    .join(",");

/** What a translation keeps of its English line, apart from the words. */
const kept = (text) => ({
  slots: slots(text),
  tags: joined(text, TAG),
  emoji: joined(text, EMOJI),
  breaks: (text.match(/\n/g) ?? []).length,
});

/** Lines that are the same in both languages on purpose, by dotted key (`area.key`), with why. */
const KEEP = new Map([]);

function checkText(key, source, target) {
  assert.equal(typeof target, "string", `${key}: not a string`);
  assert.notEqual(target.trim(), "", `${key}: empty`);
  assert.deepEqual(
    kept(target),
    kept(source),
    `${key}: placeholders, markup, emoji or line breaks differ from English\n  en: ${source}\n  id: ${target}`,
  );
  if (target === source && source.split(/\s+/).length >= 3 && !KEEP.has(key)) {
    assert.fail(`${key}: still English\n  ${source}`);
  }
}

function checkLeaf(key, source, target) {
  if (typeof source === "string") return checkText(key, source, target);
  if (Array.isArray(source)) {
    assert.ok(Array.isArray(target), `${key}: English has a list`);
    assert.equal(
      target.length,
      source.length,
      `${key}: ${target.length} lines, English has ${source.length}`,
    );
    return source.forEach((line, i) => checkText(`${key}[${i}]`, line, target[i]));
  }
  assert.ok(isPair(source), `${key}: English has a ${typeof source}: add a case for it`);
  assert.ok(isPair(target), `${key}: English has a plural pair`);
  assert.deepEqual(
    Object.keys(target),
    ["other"],
    `${key}: Indonesian has one plural form: only "other"`,
  );
  return checkText(`${key}.other`, source.other, target.other);
}

test("Indonesian has one plural form, so a pair has only `other`", () => {
  const rules = new Intl.PluralRules("id-ID");
  for (const n of [0, 1, 2, 5, 11, 21, 100]) assert.equal(rules.select(n), "other");
});

for (const language of ["vi", "th"]) {
  test(`${language} has only keys English has`, async () => {
    const english = new Set(leaves(await loadLocale("en")).map(([key]) => key));
    const extra = leaves(await loadLocale(language))
      .map(([key]) => key)
      .filter((key) => !english.has(key));
    assert.deepEqual(extra, []);
  });
}

for (const [name, file] of areasOf("en")) {
  test(`id/${file}.js has English's keys in order, and keeps each line's slots, markup and emoji`, async () => {
    const source = leaves(await loadArea("en", file));
    const target = leaves(await loadArea("id", file));
    assert.deepEqual(
      target.map(([key]) => key),
      source.map(([key]) => key),
      `${file}: keys differ from English`,
    );
    source.forEach(([key, value], i) => checkLeaf(`${name}.${key}`, value, target[i][1]));
  });
}

test("id's index names the same areas as English's, in the same order", async () => {
  assert.deepEqual(areasOf("id"), areasOf("en"));
  assert.deepEqual(Object.keys(await loadLocale("id")), Object.keys(await loadLocale("en")));
});

test("id/ours.js has Indonesian for each of Paseo's own strings, and for no other", async () => {
  const ours = await loadOurs("id");
  assert.ok(ours, "locales/id/ours.js is missing");
  assert.deepEqual(Object.keys(ours), Object.keys(OURS), "keys differ from OURS in the stand-in");
  for (const [key, source] of Object.entries(OURS)) checkLeaf(`ours.${key}`, source, ours[key]);
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `node --test scripts/locale.test.mjs`
Expected: the `vi` and `th` tests and the plural test pass; every `id/<file>.js` test fails (`Cannot find module`), the index and `ours` tests fail. The list of failing names is the list of files to write.

- [ ] **Step 3: Write the index and the review tools first**

`id/index.js` (the port's own; a header, then the same imports and export as English's generated index, in its order, with the names from `locales/en/index.js` read at the time):

```js
// Bahasa Indonesia. Written for the Paseo port of my-office, in my-office's own locale format, so it can be offered
// to my-office. A key missing here falls back to English. Areas are as many as the port shows; the rest of the
// English locale is not translated yet.
import common from "./common.js";
import time from "./time.js";
/* ...one import per area, in the order of locales/en/index.js... */

export default { common, time /* ...the same names, in the same order... */ };
```

`scripts/id-review-notes.json`: `{}`.

`scripts/id-review-list.mjs`:

```js
#!/usr/bin/env node
// Prints the Indonesian lines most worth a native speaker's look, as Markdown: first the lines the
// translator noted in scripts/id-review-notes.json, then every other line longer than LONG characters.
//   node scripts/id-review-list.mjs > /tmp/id-review.md
import { readFileSync } from "node:fs";
import path from "node:path";
import { OURS } from "../vendor/my-office/src/i18n/index.js";
import { ROOT, areasOf, isPair, leaves, loadArea, loadOurs } from "./locale-words.mjs";

const LONG = 110;
const notes = JSON.parse(readFileSync(path.join(ROOT, "scripts/id-review-notes.json"), "utf8"));

/** The lines of one leaf as [suffix, English, Indonesian]. */
function units(source, target) {
  if (typeof source === "string") return [["", source, target]];
  if (Array.isArray(source)) return source.map((line, i) => [`[${i}]`, line, target[i]]);
  if (isPair(source)) return [["", source.other, target.other]];
  return [];
}

const rows = new Map();
for (const [name, file] of areasOf("en")) {
  const english = leaves(await loadArea("en", file));
  const indonesian = leaves(await loadArea("id", file));
  english.forEach(([key, value], i) => {
    for (const [suffix, en, id] of units(value, indonesian[i][1]))
      rows.set(`${name}.${key}${suffix}`, { en, id });
  });
}
const ours = await loadOurs("id");
for (const [key, value] of Object.entries(OURS)) {
  for (const [suffix, en, id] of units(value, ours[key]))
    rows.set(`ours.${key}${suffix}`, { en, id });
}

const unknown = Object.keys(notes).filter((key) => !rows.has(key));
if (unknown.length > 0) throw new Error(`notes for lines that do not exist: ${unknown.join(", ")}`);

const show = (key, row, why) =>
  [`- \`${key}\`${why ? `: ${why}` : ""}`, `  - EN: ${row.en}`, `  - ID: ${row.id}`].join("\n");
const noted = Object.keys(notes).map((key) => show(key, rows.get(key), notes[key]));
const long = [...rows]
  .filter(([key, row]) => !(key in notes) && row.id.length > LONG)
  .sort((a, b) => b[1].id.length - a[1].id.length)
  .map(([key, row]) => show(key, row, `${row.id.length} characters`));
console.log(
  `# Indonesian lines to read first\n\n${rows.size} lines in all. ${noted.length} noted by the translator, ${long.length} longer than ${LONG} characters.\n`,
);
console.log(
  `## Noted\n\n${noted.join("\n") || "None."}\n\n## Long\n\n${long.join("\n") || "None."}`,
);
```

- [ ] **Step 4: Translate in batches, each green before the next**

For each batch: write the files by the method, add notes, run `node --test --test-name-pattern="id/(<files>)" scripts/locale.test.mjs` until it passes, run the independent read, commit. The batches, by English size (read each file's size with `wc -c`; the order puts what the first look sees earliest):

1. `common`, `time`, `incident`, `activity`, `settings` (small, the lookup's own words). Commit `feat: Indonesian, the common words and settings`.
2. `ui`, `fp`, `places` (labels, the walk, place cards). Commit `feat: Indonesian, the interface text and place cards`.
3. `props`, `life`, `events` (what people say at work). Commit `feat: Indonesian, props, daily life and events`.
4. `world`, then `people` (the largest, 28 KB: do it in two sittings, by its top-level groups, running the test after each). Commit `feat: Indonesian, the world and what people say`.
5. `ours.js`: the stand-in's `OURS`, key by key in its order, as `export default { 'people.handOver': 'Ada tugas baru buat kamu', ... }`; a pair is `{ other: '...' }`. Run the `ours` test, then the index test. Commit `feat: Indonesian for the port's own lines`.

Two kinds of line need care: the `OURS` lines (`{label}` is a tool's text and stays as it comes; `since the office opened` means since this view opened) and the lines that count (`{n} agen` and the like). If a key in `OURS` has since been added by an earlier piece, the test names it.

- [ ] **Step 5: Run everything, add the brand scan's reach, and read the output**

```bash
node --test scripts/*.test.mjs
node scripts/id-review-list.mjs | head -60
```

Expected: every test passes, `id` included in the brand scan automatically (Task 2's test walks `otherLanguages()`). The list prints with the counts. Read the first ten entries yourself: if the English and Indonesian are not side by side, or a note's key is wrong, the script throws and says which.

- [ ] **Step 6: `vendor/SOURCES.md`, checks, commit**

In "What is taken" add a paragraph: "`i18n/locales/id/` is not upstream's. The port wrote Bahasa Indonesia for the same areas English's index names, in upstream's format, so the folder can be offered to my-office as it stands: its `index.js` is the same list, `ours.js` is the port's own and stays here. `scripts/locale.test.mjs` checks every file against English (keys, order, slots, markup, emoji, plural form, no line left in English). `scripts/id-review-notes.json` holds the translator's notes for the owner's read and is deleted once the text is reviewed." Run the chain and the whole suite, then commit the notes file and docs: `git add -A && git commit -m "feat: Indonesian is checked against English, and its doubtful lines are listed"`.

---

### Task 5: The words reach the device: build, server, loader

**Files:**

- Create: `shared/scene-language.ts`, `server/world-words.ts`, `client/world/words-loader.ts`, `server/words.generated.ts` (by the build)
- Test: `shared/scene-language.test.ts`, `server/world-words.test.ts`, `client/world/words-loader.test.ts`
- Modify: `scripts/build-world.mjs`, `shared/contracts.ts`, `index.server.ts`, `index.server.test.ts`, `client/world/world-api.ts` (the union becomes `WordsLanguage`), `.oxlintrc.json`, `.oxfmtrc.json`, `shared/contracts.test.ts` if it lists the RPCs

**Interfaces:**

- Produces `shared/scene-language.ts`:

```ts
export const SCENE_LANGUAGES: readonly ["en", "vi", "th", "id"];
export type SceneLanguage = "en" | "vi" | "th" | "id";
export const WORDS_LANGUAGES: readonly ["vi", "th", "id"];
export type WordsLanguage = "vi" | "th" | "id";
export const LANGUAGE_CHOICES: readonly ["auto", "en", "vi", "th", "id"];
export type LanguageChoice = "auto" | SceneLanguage;
export const LANGUAGE_NAMES: Readonly<Record<SceneLanguage, string>>; // native names
export function languageOfLocale(locale: string): SceneLanguage;
export function sceneLanguage(choice: LanguageChoice, appLocale: string): SceneLanguage;
export function isWordsLanguage(language: SceneLanguage): language is WordsLanguage;
```

- Produces `worldWordsRpc` in `shared/contracts.ts`: name `office.world.words`, input `{ language: WordsLanguage }`, output `string`.
- Produces `WORLD_WORDS: Readonly<Record<string, string>>` (`server/words.generated.ts`), `embeddedWorldWords(): WorldWords` with `read(language: string): Promise<string>`, `createWordsLoader()` and `sharedWordsLoader` with `load(language, fetchWords): Promise<string>`.

- [ ] **Step 1: The languages module, test first**

`shared/scene-language.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  isWordsLanguage,
  languageOfLocale,
  sceneLanguage,
  SCENE_LANGUAGES,
  WORDS_LANGUAGES,
} from "./scene-language.js";

test("the app's locales that Paseo names today are all English for the scene", () => {
  for (const locale of ["en", "ar", "es", "fr", "ja", "ko", "pt-BR", "ru", "zh-CN"]) {
    expect(languageOfLocale(locale)).toBe("en");
  }
});

test("a locale the office has words for is that language, in any case and with a region", () => {
  expect(languageOfLocale("vi")).toBe("vi");
  expect(languageOfLocale("vi-VN")).toBe("vi");
  expect(languageOfLocale("th_TH")).toBe("th");
  expect(languageOfLocale("ID-id")).toBe("id");
  expect(languageOfLocale("in")).toBe("id");
});

test("nothing readable is English", () => {
  expect(languageOfLocale("")).toBe("en");
  expect(languageOfLocale("  ")).toBe("en");
  expect(languageOfLocale("und")).toBe("en");
});

test("Automatic follows the app and a choice wins", () => {
  expect(sceneLanguage("auto", "vi-VN")).toBe("vi");
  expect(sceneLanguage("auto", "pt-BR")).toBe("en");
  expect(sceneLanguage("th", "en")).toBe("th");
  expect(sceneLanguage("en", "vi")).toBe("en");
});

test("every language but English has words to send", () => {
  expect(SCENE_LANGUAGES.filter((language) => isWordsLanguage(language))).toEqual([
    ...WORDS_LANGUAGES,
  ]);
  expect(isWordsLanguage("en")).toBe(false);
});
```

Run `npx vitest run shared/scene-language.test.ts`: FAIL, module missing. Write `shared/scene-language.ts` with the interface above: `languageOfLocale` lowercases and trims, takes the part before `-` or `_`, maps `in` to `id`, and returns the entry of `SCENE_LANGUAGES` that equals it or `"en"`; `LANGUAGE_NAMES` is `{ en: "English", vi: "Tiếng Việt", th: "ไทย", id: "Bahasa Indonesia" }`. Pass; commit later.

- [ ] **Step 2: The build writes the words module**

In `scripts/build-world.mjs`: import `{ assertPlain, loadLocale, loadOurs, otherLanguages }` from `./locale-words.mjs`. After the scene's `module` text is made, add:

```js
// The words of each language but English, one JSON text each: { dict, ours? }. The server sends the one a device asks
// for; the scene carries English only. A locale is plain data: the build refuses a function.
const words = {};
for (const language of otherLanguages()) {
  const dict = await loadLocale(language);
  assertPlain(dict, language);
  const ours = await loadOurs(language);
  words[language] = JSON.stringify(ours === null ? { dict } : { dict, ours });
}
const wordsLiteral = JSON.stringify(words)
  .replaceAll("\u2028", "\\u2028")
  .replaceAll("\u2029", "\\u2029");
const wordsModule = [
  "// Generated by scripts/build-world.mjs from vendor/my-office/src/i18n/locales. Do not edit.",
  "/** The 3D office's words in each language but English, as JSON text a device asks the server for. */",
  `export const WORLD_WORDS: Readonly<Record<string, string>> = ${wordsLiteral};`,
  "",
].join("\n");
const WORDS_OUT = path.join(ROOT, "server", "words.generated.ts");
```

and change the `--check` branch to compare both files and say which is stale (`server/world.generated.ts` or `server/words.generated.ts`), and the writing branch to write both and print the size of each language's text. Add `server/words.generated.ts` to `ignorePatterns` of `.oxlintrc.json` and `.oxfmtrc.json`.

Run `npm run build:world`. Expected output includes the three languages and their sizes near vi 75 KB, th 117 KB, id about 75 KB (UTF-8). Run `npm run check:world`: up to date.

- [ ] **Step 3: The server's answer, test first**

`server/world-words.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { embeddedWorldWords } from "./world-words.js";
import { WORLD_WORDS } from "./words.generated.js";
// @ts-expect-error vendored JavaScript has no declarations
import th from "../vendor/my-office/src/i18n/locales/th/index.js";
// @ts-expect-error vendored JavaScript has no declarations
import vi from "../vendor/my-office/src/i18n/locales/vi/index.js";
// @ts-expect-error vendored JavaScript has no declarations
import id from "../vendor/my-office/src/i18n/locales/id/index.js";
// @ts-expect-error vendored JavaScript has no declarations
import ours from "../vendor/my-office/src/i18n/locales/id/ours.js";
import { WORLD_SCRIPT } from "./world.generated.js";
// @ts-expect-error a script, not a module with types
import { findBrands } from "../scripts/locale-brands.mjs";
import { WORDS_LANGUAGES } from "../shared/scene-language.js";

const CAPS = { vi: 100_000, th: 150_000, id: 100_000 } as const;
const DICTS = { vi, th, id } as const;
```

Cases:

- `it("holds one text for each language the app can choose, and for no other")`: `Object.keys(WORLD_WORDS).sort()` equals `[...WORDS_LANGUAGES].sort()`.
- `it.each(languages)("the text of %s is JSON of its locale")`: `JSON.parse(WORLD_WORDS[l])` has `dict` deep-equal to `DICTS[l]`; for `id` also `ours` deep-equal to the file's; for `vi` and `th` no `ours`.
- size: `Buffer.byteLength(WORLD_WORDS[l])` is under `CAPS[l]`, and over 20,000 (an empty module must fail).
- `it("a language's text is not in the scene's bundle")`: for each language, take the first 40 leaf strings that differ from English's and are at least 12 characters (walk `DICTS[l]` against English's), and for each assert that none of its forms (the text as is; and with every non-ASCII character as `\uXXXX` in lower case and in upper case, since the bundle's minifier may escape them) is a substring of `WORLD_SCRIPT`. For `th`, also: the bundle has no Thai letter in either form (`/[\u0E00-\u0E7F]|\\u0e[0-7][0-9a-f]/i`).
- `it("no text names a real brand")`: every string of every language's JSON (walk `JSON.parse`) gives `findBrands(s)` of `[]`.
- `it("answers from the embedded words, and says so for a language it has none")`: `await embeddedWorldWords().read("vi")` is `WORLD_WORDS.vi`; `read("fr")` rejects with `The office has no words for fr`.

Run: FAIL (module missing). Write `server/world-words.ts`:

```ts
import { WORLD_WORDS } from "./words.generated.js";

export interface WorldWords {
  /** One language's words as JSON text: `{ dict, ours? }`. */
  read(language: string): Promise<string>;
}

/** The words as the plugin carries them, built from `vendor/my-office` by `scripts/build-world.mjs`. */
export function embeddedWorldWords(): WorldWords {
  return {
    read: async (language) => {
      const text = Object.hasOwn(WORLD_WORDS, language) ? WORLD_WORDS[language] : undefined;
      if (text === undefined) throw new Error(`The office has no words for ${language}`);
      return text;
    },
  };
}
```

Run: PASS.

- [ ] **Step 4: The RPC and its wiring, test first**

In `index.server.test.ts`: the options' `deps` gain `words: { read: async (language) => \`words of ${language}\` }`(next to`world: { read: async () => "the scene" }`); add a test after "the 3D page script is answered...": `office.world.words`called with`{ language: "vi" }`returns`"words of vi"`; and in the list test of handled RPC names (`"office.state", "office.world.request", ...`) insert `"office.world.words"`right after`"office.world.request"`. Run `npx vitest run index.server.test.ts`: FAIL.

In `shared/contracts.ts`, after `worldRpc`:

```ts
/**
 * One language's words for the 3D office, as JSON text `{ dict, ours? }`: the scene carries English and the
 * host sends the rest on request, so a device loads its own language only.
 */
export const worldWordsRpc = defineRpc({
  name: "office.world.words",
  input: z.object({ language: z.enum(WORDS_LANGUAGES) }),
  output: z.string(),
});
```

with `import { WORDS_LANGUAGES } from "./scene-language.js";`. In `index.server.ts`: import `worldWordsRpc` with the others and `embeddedWorldWords, type WorldWords` from `./server/world-words.js`; add `words: WorldWords;` to the deps interface after `world`, `words: embeddedWorldWords(),` after `world: embeddedWorldScript(),`, and `server.handle(worldWordsRpc, (input) => guarded("words", () => deps.words.read(input.language)));` after the `worldRpc` handler. Run the server tests: PASS. In `client/world/world-api.ts`, change `language?: "vi" | "th" | "id"` to `language?: WordsLanguage` (import the type from `../../shared/scene-language.js`).

- [ ] **Step 5: The loader, test first**

`client/world/words-loader.test.ts` cases: two asks for one language at once fetch once; a second ask after the first is answered fetches nothing; two languages fetch separately; a failure is not kept and a later ask fetches again; an empty answer (`"  "`) fails with `The host sent no vi text` and is not kept. Run: FAIL. Write `client/world/words-loader.ts`:

```ts
import type { WordsLanguage } from "../../shared/scene-language.js";

export interface WordsLoader {
  /** Loads a language once per page; a failure is not kept, so a later call asks again. */
  load(
    language: WordsLanguage,
    fetchWords: (language: WordsLanguage) => Promise<string>,
  ): Promise<string>;
}

export function createWordsLoader(): WordsLoader {
  const ready = new Map<WordsLanguage, string>();
  const pending = new Map<WordsLanguage, Promise<string>>();
  return {
    load(language, fetchWords) {
      const done = ready.get(language);
      if (done !== undefined) return Promise.resolve(done);
      let running = pending.get(language);
      if (running === undefined) {
        running = fetchWords(language)
          .then((text) => {
            if (text.trim() === "") throw new Error(`The host sent no ${language} text`);
            ready.set(language, text);
            return text;
          })
          .finally(() => pending.delete(language));
        pending.set(language, running);
      }
      return running;
    },
  };
}

/** One per page: a language's words stay in memory once a device has loaded them. */
export const sharedWordsLoader: WordsLoader = createWordsLoader();
```

Run: PASS.

- [ ] **Step 6: Run everything and commit**

Run the chain and the whole suite (`server/world-script.test.ts` runs `build-world.mjs --check`, which now covers both generated files).

```bash
git add -A && git commit -m "feat: the host sends one language's words on request, and a device keeps what it loaded"
```

---

### Task 6: The language reaches the scene, and a device chooses it

**Files:**

- Create: `client/app-locale.ts`, `client/world/use-scene-words.ts`, `client/language-switch.tsx`
- Test: `client/app-locale.mounted.test.tsx`, `client/world/use-scene-words.mounted.test.tsx`, `client/language-switch.mounted.test.tsx`
- Modify: `shared/settings.ts`, `shared/settings.test.ts`, `client/world/world-view-shared.ts` (+ `world-view-shared.test.ts`), `client/world/world-view.tsx`, `client/world/world-view-native.tsx`, `client/world/world-view.mounted.test.tsx`, `client/world/world-view-native.mounted.test.tsx`, `client/office-settings.tsx`, `client/office-settings.mounted.test.tsx`

**Interfaces:**

- Consumes: Task 5's `shared/scene-language.ts`, `worldWordsRpc`, `sharedWordsLoader`; Task 3's start options.
- Produces:

```ts
// shared/settings.ts
export const officeLanguageSettings; // id "office-language", device, { choice: LanguageChoice }, default "auto"

// client/app-locale.ts
export function useAppLocale(): string; // the app's locale ("en", "pt-BR", ...), re-rendered when it changes

// client/world/use-scene-words.ts
export interface SceneWords {
  /** "loading" while the choice is read or the words are on their way: the scene waits for them. */
  status: "loading" | "ready";
  /** The language the scene starts in: English when the words did not come. */
  language: SceneLanguage;
  /** The language's text; absent for English. */
  words: string | undefined;
  /** Why the chosen language is not shown, when it is not: one sentence for the floor's note line. */
  note: string | null;
}
export function useSceneWords(): SceneWords;

// client/language-switch.tsx
export const LANGUAGE_LABEL = "3D office language";
export function LanguageSetting(props: { styles: OfficeStyles }): ReactNode; // reads and saves the setting
```

- `worldStartOptions(latest, extras)` gains `extras.language: SceneLanguage` and `extras.words: string | undefined`, and puts `language` and `words` in the options only for a language that is not English.

- [ ] **Step 1: The setting, test first**

In `shared/settings.test.ts` add: `officeLanguageSettings.schema.parse({})` equals `{ choice: "auto" }`; each of `auto`, `en`, `vi`, `th`, `id` parses; `fr` and `1` throw; the id is `office-language` and the scope `device`. Run: FAIL. In `shared/settings.ts`, after `officeColumnSettings`:

```ts
/**
 * The 3D office's language on this device. "auto" follows the app's language where the office has words for
 * it, else English. A setting of its own, as the column's is: the view's and the incidents' saves write
 * `office-device` whole, and would drop a field of this one.
 */
export const officeLanguageSettings = defineSettings({
  id: "office-language",
  scope: "device",
  version: 1,
  schema: z.object({ choice: z.enum(LANGUAGE_CHOICES).default("auto") }),
});
```

with `import { LANGUAGE_CHOICES } from "./scene-language.js";`. Run: PASS.

- [ ] **Step 2: The app's locale, test first**

`client/app-locale.mounted.test.tsx` with `@getpaseo/plugin/client` mocked as `{ defineTranslations: (definition) => definition, useTranslation: () => ({ locale: current }) }`: a probe component shows `useAppLocale()`; it shows `en`; after `current = "vi-VN"` and a re-render, `vi-VN`. A second case: `defineTranslations` is not called when the module is loaded, only when the hook first runs (a spy: `0` calls after `import`, `1` after the first render, still `1` after the second render). Run: FAIL. Write `client/app-locale.ts`:

```ts
import { defineTranslations, useTranslation } from "@getpaseo/plugin/client";

// The SDK gives a plugin the app's language only through its translation hook, which needs a messages object. This one
// has a single English message and is never shown: only the hook's `locale` is read. It is made on first use, not at
// load: `defineTranslations` calls `Intl.getCanonicalLocales`, and a throw while the client bundle loads fails the
// whole plugin on an engine that lacks it.
const makeProbe = () => defineTranslations({ resources: { en: { probe: "probe" } } });
let probe: ReturnType<typeof makeProbe> | undefined;

/** The app's locale as Paseo names it ("en", "pt-BR", "zh-CN"); the surface renders again when it changes. */
export function useAppLocale(): string {
  probe ??= makeProbe();
  return useTranslation(probe).locale;
}
```

Run: PASS.

- [ ] **Step 3: `useSceneWords`, test first**

`client/world/use-scene-words.mounted.test.tsx`, with `@getpaseo/plugin/client` mocked (`useSettings` returns the test's current state; `useRpc` returns a `fetchWords` that records its input and answers or rejects as the test says), `../app-locale.js` mocked to return the test's locale, and a fresh `createWordsLoader()` swapped in for `sharedWordsLoader` by `vi.mock("./words-loader.js")`. Cases, each reading the hook's result through a probe component:

- Settings `loading`: `status: "loading"`, nothing is fetched.
- Choice `en`: `ready`, `language: "en"`, `words: undefined`, `note: null`, nothing fetched.
- Choice `auto`, app locale `pt-BR`: the same, English, nothing fetched.
- Choice `auto`, app locale `vi`: `loading` first, the fetch asked for `{ language: "vi" }`, then `ready`, `language: "vi"`, `words` the text the fake answered.
- Choice `th`: fetches `th`, whatever the app's locale is.
- Settings `invalid` or `error` count as `auto`.
- A failed fetch: `ready`, `language: "en"`, `words: undefined`, and `note` is `ไทย text could not be loaded; the scene is in English` for `th` (the native name from `LANGUAGE_NAMES`; for `id`, `Bahasa Indonesia text could not be loaded; the scene is in English`).
- The choice changing from `th` to `id` goes `loading` (never `ready` with the old words), then `ready` with `id`'s; changing back to `th` fetches nothing a second time (the loader kept it).
- An answer that comes after the choice changed again, or after unmount, sets nothing.

Run: FAIL. Write `client/world/use-scene-words.ts`:

```ts
import { useEffect, useMemo, useState } from "react";
import { useRpc, useSettings } from "@getpaseo/plugin/client";
import { worldWordsRpc } from "../../shared/contracts.js";
import {
  LANGUAGE_NAMES,
  isWordsLanguage,
  sceneLanguage,
  type LanguageChoice,
  type SceneLanguage,
} from "../../shared/scene-language.js";
import { officeLanguageSettings } from "../../shared/settings.js";
import { useAppLocale } from "../app-locale.js";
import { sharedWordsLoader } from "./words-loader.js";
import { messageOf } from "./world-loader.js";

export interface SceneWords {
  /* as in Interfaces */
}

type Arrived =
  | { language: SceneLanguage; words: string }
  | { language: SceneLanguage; failure: string };
const LOADING: SceneWords = { status: "loading", language: "en", words: undefined, note: null };

/**
 * The language the 3D office starts in and its words. The device's choice (or the app's language, for Automatic) is read
 * first; a language that is not English is asked of the host, once per page. The scene waits for both, so it starts in
 * its language and is not started twice. Words that cannot be loaded give English and a note, never a problem report:
 * a problem would take the 3D view away.
 */
export function useSceneWords(): SceneWords {
  const settings = useSettings(officeLanguageSettings);
  const appLocale = useAppLocale();
  const fetchWords = useRpc(worldWordsRpc);
  let choice: LanguageChoice | null = null;
  if (settings.status === "ready") choice = settings.values.choice;
  else if (settings.status !== "loading") choice = "auto";
  const wanted = choice === null ? null : sceneLanguage(choice, appLocale);
  const [arrived, setArrived] = useState<Arrived | null>(null);
  useEffect(() => {
    if (wanted === null || !isWordsLanguage(wanted)) return undefined;
    let current = true;
    sharedWordsLoader
      .load(wanted, (language) => fetchWords({ language }))
      .then(
        (words) => {
          if (current) setArrived({ language: wanted, words });
        },
        (error: unknown) => {
          if (current) setArrived({ language: wanted, failure: messageOf(error) });
        },
      );
    return () => {
      current = false;
    };
  }, [wanted, fetchWords]);
  return useMemo(() => {
    if (wanted === null) return LOADING;
    if (!isWordsLanguage(wanted))
      return { status: "ready", language: "en", words: undefined, note: null };
    if (arrived === null || arrived.language !== wanted) return LOADING;
    if ("failure" in arrived) {
      return {
        status: "ready",
        language: "en",
        words: undefined,
        note: `${LANGUAGE_NAMES[wanted]} text could not be loaded; the scene is in English`,
      };
    }
    return { status: "ready", language: wanted, words: arrived.words, note: null };
  }, [wanted, arrived]);
}
```

(`wanted` English with a language other than English chosen earlier: `arrived` holds a stale language; the memo's first checks cover it.) Run: PASS. `npm run lint` must not complain of complexity; split `LOADING`/derivation into a helper if it does.

- [ ] **Step 4: The start options carry the language**

In `client/world/world-view-shared.test.ts` add: `worldStartOptions(latest, { focus, brand, language: "vi", words: "{}" })` has `language: "vi"` and `words: "{}"`; with `language: "en", words: undefined` neither key is present. Run: FAIL. In `world-view-shared.ts`, `extras` becomes `{ focus(): void; brand: WorldBrand; photo?: false; language: SceneLanguage; words: string | undefined }` and the returned options gain, after `brand: extras.brand`:

```ts
    ...(isWordsLanguage(extras.language) && extras.words !== undefined
      ? { language: extras.language, words: extras.words }
      : {}),
```

Run: PASS. (Every existing caller of `worldStartOptions` in tests passes `language: "en", words: undefined`.)

- [ ] **Step 5: The web view starts after the words, and restarts on a change**

Failing mounted tests first, in `client/world/world-view.mounted.test.tsx`: add `vi.mock("./use-scene-words.js", ...)` with a controllable result (default `{ status: "ready", language: "en", words: undefined, note: null }`), and cases:

- While `status` is `loading`, no frame is opened (`openWorldFrame` not called) and the view says `Loading the 3D view...`.
- With `ready`, `vi` and words `'{"dict":{}}'`, `frame.started` has `language: "vi"` and `words: '{"dict":{}}'`; with English, neither key.
- When the result changes to `th`: the first frame is disposed, a second frame opens, and the second `start` has `language: "th"`. (`openWorldFrame` called twice, the first `dispose` called once.)
- When `note` is set and the scene is up, the floor note line shows it; the feed's own note wins when both exist.

Run: FAIL. In `world-view.tsx`: call `const words = useSceneWords();` after `useStandupBell()`; in the start effect change the guard to `if (script === null || !sized || words.status !== "ready") return undefined;`, pass `language: words.language, words: words.words` in the extras of `worldStartOptions`, and add `words.status, words.language, words.words` to the effect's dependency list (beside `script, sized, containerId`; if piece 3 added its plan there, they sit together); render `{api !== null && (note ?? words.note) !== null ? (... {note ?? words.note} ...) : null}` in place of the existing `note` conditions. Run: PASS.

- [ ] **Step 6: The phone's view the same way**

Failing cases first in `client/world/world-view-native.mounted.test.tsx` (with the same `use-scene-words` mock): no `Frame` is rendered and nothing is started while `loading`; with `ready` and `vi` the bridge's `start` is posted with `language: "vi"` and the words; a change to `th` mounts a new frame (the `Frame` component has a new `key`: assert it unmounted and mounted again) and posts a second `start`; the note shows. In `world-view-native.tsx`: `const words = useSceneWords();`; render `Frame` only when `Frame !== null && page !== null && words.status === "ready"`, with `key={words.language}`; the start effect returns early unless `words.status === "ready"`, passes the language and words in the extras of `worldStartOptions(latest, { focus: noFocus, brand: worldBrand(null), photo: false, language: words.language, words: words.words })`, and lists `words.status, words.language, words.words` in its dependencies next to `page` (combine the frame's `key` with piece 3's plan, as `${plan}-${words.language}`, if it has one). Run: PASS.

- [ ] **Step 7: The settings page's control, test first**

`client/language-switch.mounted.test.tsx`, with `useSettings` mocked to a controllable state: five pills named `Automatic`, `English`, `Tiếng Việt`, `ไทย`, `Bahasa Indonesia` under a group labelled `3D office language`; the stored choice's pill has `aria-pressed` true (`auto` when the document has no choice or is invalid); a press on `Tiếng Việt` calls `save({ choice: "vi" }, revision)`; while the settings are loading the pills are disabled; a `saveError` shows as an alert under the row; the hint line says that the column, the cards and the page stay English. Run: FAIL. Write `client/language-switch.tsx` on the model of `client/notes-days.tsx` (a `Pressable` per choice with the same hover and press layers, `styles.segment`, `styles.segmentFill`, `styles.segmentHoverFill`, `styles.segmentText`, `styles.segmentTextSelected`, the row `styles.notesDays` or `styles.notesDaysDisabled`, the label `styles.sheetLabel`, the hint `styles.fieldHint`, the error `styles.actionError`, the wrapper `styles.headerField`). The names: `{ auto: "Automatic", ...LANGUAGE_NAMES }`. The hint: `The signs, labels and speech in the 3D office. The column, the cards and this page stay in English. Automatic follows the app's language where the office has it.` `LanguageSetting` reads `useSettings(officeLanguageSettings)`, takes `ready` as its value and `invalid` as `auto`, and saves `{ choice }` against the revision (a press overwrites an invalid document, as the host switches do). Run: PASS.

In `client/office-settings.tsx`, render `<LanguageSetting styles={styles} />` after `HostSwitches`, inside the same `View`. In `client/office-settings.mounted.test.tsx`, read how the file stands in for `useSettings` (by definition id or for all) and give the language document its own state; add a case that the page shows the language group.

- [ ] **Step 8: Run everything and commit**

Run the chain and the whole suite. `client/engine-compat.test.ts` must pass. Then:

```bash
git add -A && git commit -m "feat: the 3D office speaks the device's language, set on the settings page"
```

---

### Task 7: A look, and what was seen

**Files:**

- Modify: `docs/verified.md`, `README.md`, `docs/office.md`, `vendor/SOURCES.md` (final read)

- [ ] **Step 1: The docs, integrated, not appended**

- `README.md`: under "What it does" a line: "Shows the 3D office's signs, labels and speech in English, Vietnamese, Thai or Indonesian, as a device chooses on the settings page (Automatic follows the app's language where the office has it: Paseo's app has no Vietnamese, Thai or Indonesian today, so choose one there). The column, the cards, the settings page and the team chat stay in English." Under "What it reads and where it sends it": "The scene is also told a language and its text: the host sends one language's words (about 75 to 120 KB) on request, only to a device that chose it; nothing else is added and the scene still makes no network call." Under "Based on": "The Vietnamese and Thai text is my-office's own, with real brand names replaced by made-up ones (`vendor/SOURCES.md`). The Indonesian text was written for this port in my-office's format, for the areas the port shows; it is offered to my-office as it stands." Under "What works where" nothing changes. Add the known limits in one short paragraph: the whiteboard's text and the board rows, karaoke's lyrics in Thai and Indonesian, and the director's name in the chat stay as they are.
- `docs/office.md`: in "The 3D floor", a paragraph "Languages": how the language is chosen (`office-language`, Automatic, the mapping of the app's locale), what travels (`office.world.words`, one JSON text per language from `server/words.generated.ts`, English bundled), what the stand-in does (the order of lookup, the emoji rule, a failed load is English plus a note), that a change restarts the scene, and that in "Settings" the page now has the language row. Add `language` and `words` to the sentence that lists what the scene is told.
- `vendor/SOURCES.md`: read it through once; every claim about the stand-in, the locales and the scripts is true after this piece.

- [ ] **Step 2: A stock daemon with the branch installed**

As `docs/verified.md` describes the earlier looks: a clean `/tmp/office-stock-home`, the published 0.16.2 daemon on port 6798 with a clean environment (`env -i`), the plugin installed by Git from the local repo at the branch's commit. `daemon status` must show 6798 and that home before any plugin command.

- [ ] **Step 3: Look, at 1280 and 390 px**

What can be seen there (no provider is signed in, so no agent: the floor is empty, but its toolbar, its room chips and its place cards exist):

1. Settings, Plugins, Office: the language row with five pills, Automatic chosen. Save `Tiếng Việt`; open the office in 3D: the toolbar's four view labels and the zoom and full-screen labels are Vietnamese; the room chips and a place card (open one) are Vietnamese; `<html lang>` of the frame is `vi` (`browser_evaluate` on the frame's `contentDocument.documentElement.lang`). The word "Walking the office" overlay: press Walk in (1280 px only) and read it.
2. The same for `ไทย`: no empty boxes where Thai should be; no label cut off or overflowing its chip; the toolbar still fits at 390 px.
3. The same for `Bahasa Indonesia`.
4. Back to Automatic and to English: the scene is English again, as before this piece.
5. Whether the open office restarts when the choice is saved on the settings page and the office is shown again (record what happens: this is the first row of "Not verifiable").
6. The console of the page: no error from `useTranslation`; the words' RPC answered once per language (the daemon's plugin log, `paseo plugin logs office`, holds no `words failed`).
7. The failure path (words that cannot load, so English and a note) is covered by `use-scene-words.mounted.test.tsx`; it is not forced on the daemon, and `docs/verified.md` says so.

What cannot be seen there, and is recorded as such: speech bubbles and what people say (no agent); the whiteboard (its text is English by design); karaoke in `vi`; the walk's prompts over a person; the phone's WebView with Thai and Vietnamese glyphs; the words' RPC over a relay. Those are the owner's to look at on the host after the update, on desktop and phone: an agent at work in each language (its bubbles), the lounge's four games, the server room's chips, Photo mode's labels, and the text of one place card per language.

- [ ] **Step 4: Record**

`docs/verified.md` gains a section "Languages (piece 9)": what was seen at 1280 and 390 px, the answer to each "Not verifiable" row that could be looked at, and its "not seen" list. Stop the daemon by its pid; confirm 6798 is closed and 6767 untouched. Commit `docs: what was seen of the languages on a stock daemon`.

- [ ] **Step 5: Hand over the Indonesian lines**

```bash
node scripts/id-review-list.mjs > /tmp/id-review.md
```

Report to the controller: the path, the three counts at its head, and the ten lines most worth a look from it, chosen by the translator from the noted ones in this order: jokes whose point was moved, idioms, names of customs kept as English has them, then the longest lines; and the `OURS` lines (the first ones people see). The owner, a native speaker, reads the list before anything is released; corrections are commits on the branch. After the owner's read, delete `scripts/id-review-notes.json` and `scripts/id-review-list.mjs` in a last commit (`docs: the Indonesian text was read by a native speaker`) and take the paragraph about them out of `vendor/SOURCES.md`.

---

### After the tasks (controller, with the owner's go-ahead)

Final whole-branch review; the owner reads the Indonesian list (the release gate: nothing is merged before it); fixes; merge to `main`; push; CI green (the CI already runs `npm run test:scripts`, which holds the locale tests, and `npm run check:world`, which holds both generated modules); `paseo plugin update office --ref <commit>` on the owner's host; the owner looks on desktop and on the phone (each of the four languages, the people's bubbles, the lounge's games, Thai and Vietnamese glyphs on the phone, the restart on a change); then tag `v0.10.0` and write its release notes (what the languages are, that Paseo's app has no Vietnamese, Thai or Indonesian so the language is chosen on the settings page, what stays English). Offering `locales/id/` to my-office is a separate step the owner decides on after the tag.
