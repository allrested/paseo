# paseo-office, part 2: the repo and the cutover Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office lives in its own repo, `paseo-office`, with its tests, licence, README and CI, installs from Git on stock Paseo, and replaces the built-in on the owner's host.

**Architecture:** A new local git repo at `/workspace/QFlavours/paseo-office` takes `plugins/office` from the fork's `main` as its root, with a toolchain of its own (npm, TypeScript, Vitest with jsdom, oxlint, oxfmt, esbuild) pinned so the scene's byte check holds. Tasks 1 to 6 are local and reversible. Tasks 7 and 8 publish and change the owner's running host: the controller runs them, each only after the owner says yes at that point.

**Tech Stack:** TypeScript, `@getpaseo/plugin` 0.16.2 from npm, Vitest 4 with jsdom and `react-native-web`, esbuild 0.28.1, oxlint 1.61.0, oxfmt 0.46.0, GitHub Actions, the `gh` CLI.

**Spec:** `docs/superpowers/specs/2026-11-18-paseo-office-design.md` in the fork (`/workspace/QFlavours/paseo-onepage-docs`), with its findings `docs/superpowers/specs/2026-11-18-paseo-office-stock-findings.md`.

## Global Constraints

- The new repo is `/workspace/QFlavours/paseo-office`, branch `main`. Tasks 1 to 6 never push and never create anything on GitHub.
- The source is the fork's `main` at `906a13e15`, folder `plugins/office`. The fork checkout `/workspace/QFlavours/paseo-onepage-docs` is read-only until Task 8.
- The plugin id stays `office`. `requirements.paseo` is `>=0.16.0`. No `build` in the manifest: the host supplies `zod` and the scene is embedded.
- What my-office's author asked binds every commit that touches them: keep the MIT licence and copyright notice; the README links to https://github.com/khanh020905/my-office; it is presented as a community port, "based on my-office", with issues directed to this repo.
- Copyright of the plugin's own code: "Copyright (c) 2026 allrested", MIT.
- Commits in the new repo carry no `Co-Authored-By` trailer and no "Generated with" line, and are authored as the git user configured on this machine. Commit messages: `feat: ...`, `test: ...`, `docs: ...`, `ci: ...`, `chore: ...`.
- No secret, token, password, host address, agent id or workspace id goes into the repo. It is public from its first push. Before each commit, `git diff --cached | grep -inE "token|password|secret|10\\.0\\.|/home/paseo"` and read every hit.
- Never start, stop or restart the daemon on port 6767 before Task 8. A throwaway daemon uses `PASEO_HOME=/tmp/office-stock-home`, port 6798, a clean environment (`env -i`), the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`, and is stopped by its recorded pid when the task ends. A bare `paseo` command talks to the live daemon: never run one.
- Nothing more is told to the scene than today.

---

### Task 1: The repo, the files, the toolchain

**Files (all in `/workspace/QFlavours/paseo-office`):**

- Create: the plugin's files, from the fork; `package.json`, `package-lock.json`, `tsconfig.json`, `.gitignore`, `.npmrc`

**Interfaces:**

- Produces: `npm run typecheck`, `npm run build:world`, `npm run check:world`; a first commit whose message names the fork commit.

- [ ] **Step 1: Take the files**

```bash
mkdir /workspace/QFlavours/paseo-office && cd /workspace/QFlavours/paseo-office
git init -b main
git -C /workspace/QFlavours/paseo-onepage-docs archive 906a13e15:plugins/office | tar -x
ls
```

Expected: `paseo-plugin.json`, `index.client.tsx`, `index.server.ts`, `client/`, `server/`, `shared/`, `vendor/`, `scripts/`, and the test files. `scripts/check-stock.sh` was the fork's proof; delete it (`git rm` is not needed, nothing is committed yet): this repo's own typecheck is that proof now.

- [ ] **Step 2: `package.json`**

```json
{
  "name": "paseo-office",
  "version": "0.1.0",
  "description": "A community port of my-office for Paseo: your agents at their desks, in 3D.",
  "private": true,
  "type": "module",
  "license": "MIT",
  "repository": { "type": "git", "url": "git+https://github.com/allrested/paseo-office.git" },
  "scripts": {
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run",
    "lint": "oxlint",
    "format": "oxfmt .",
    "format:check": "oxfmt --check .",
    "build:world": "node scripts/build-world.mjs",
    "check:world": "node scripts/build-world.mjs --check"
  },
  "dependencies": {
    "@getpaseo/plugin": "0.16.2",
    "zod": "^4.4.3"
  },
  "devDependencies": {
    "@types/node": "^20.9.0",
    "@types/react": "~19.2.0",
    "esbuild": "0.28.1",
    "jsdom": "^20.0.3",
    "oxfmt": "0.46.0",
    "oxlint": "1.61.0",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "react-native": "0.86.3",
    "react-native-web": "~0.21.0",
    "typescript": "^5.9.3",
    "vitest": "^4.1.6"
  }
}
```

These are the fork's versions (`package.json`, `packages/app/package.json`, `plugins/package.json` at `906a13e15`). esbuild, oxlint and oxfmt are exact on purpose: the scene's check compares bytes, and a formatter that moves is a noisy diff. `.npmrc`: `save-exact=false` is the default; add only `fund=false` and `audit=false`.

`.gitignore`:

```
node_modules/
*.tsbuildinfo
.DS_Store
coverage/
```

- [ ] **Step 3: `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "lib": ["ES2023", "DOM"],
    "types": ["node", "vitest/globals"],
    "strict": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "skipLibCheck": true,
    "noEmit": true,
    "jsx": "react-jsx"
  },
  "include": ["**/*.ts", "**/*.tsx"],
  "exclude": ["node_modules", "vendor"]
}
```

This is the fork's `tsconfig.base.json` plus `plugins/tsconfig.json`, with one change: the fork excluded `**/*.test.ts` from its typecheck, and this repo does not. Compare both fork files at `906a13e15` and copy any compiler option this misses.

- [ ] **Step 4: Install, typecheck, and the scene's check**

```bash
npm install
npm run check:world
npm run typecheck 2>&1 | tail -40
```

`check:world` must say the generated module is up to date: same esbuild version, same bytes. If it does not, find what differs (the esbuild version resolved, the entry path) before anything else; do not regenerate to make it pass.

The typecheck now covers the test files for the first time. Expect errors in tests only, of three kinds: a test that imports from the fork's workspace (`../../../packages/...`), a test double typed with a fork-only SDK type, and looser typing that the fork's test exclusion hid. Fix each in the test: a workspace import becomes the plugin's own module or a local stand-in; a fork-only type becomes the office's own (`shared/host-extras.ts`, `client/world/script-frame-kit.ts`, `client/beside.ts`, `server/local-schedules.ts`). Do not change a non-test file to satisfy a test's types unless the non-test file is wrong on stock; if you do, say why. Do not weaken an assertion. An error in a non-test file means part 1 missed something: stop and report it.

Expected at the end: `npm run typecheck` exits 0.

- [ ] **Step 5: Commit**

```bash
cd /workspace/QFlavours/paseo-office
git add -A
git diff --cached --stat | tail -3
git diff --cached | grep -inE "token|password|secret|10\.0\.|/home/paseo" | head -40
git commit -m "feat: the office, from allrested/paseo 906a13e15 (plugins/office)

The plugin as it was built in the fork, with a toolchain of its own. The 3D scene is my-office by
khanh020905 (vendor/my-office, MIT), at the commit vendor/my-office/MANIFEST.json records."
```

Read every hit of the grep. Words such as "token" in the incidents' settings code and tests are expected (they name environment variables and use made-up values); a real value is not. List what you saw in the report.

---

### Task 2: The tests run here

**Files:**

- Create: `vitest.config.ts`
- Modify: test files only, where the fork's workspace was assumed

**Interfaces:**

- Produces: `npm test` passes; the count of test files and tests, recorded in the report.

- [ ] **Step 1: `vitest.config.ts`**

```ts
import path from "node:path";
import { defineConfig } from "vitest/config";

// React's test APIs require its development build, even in a production shell.
process.env.NODE_ENV = "test";

const modules = path.resolve(__dirname, "node_modules");

export default defineConfig({
  resolve: {
    // The web build of a module wins, as in the app's bundler: `web-env.web.ts` and the like.
    extensions: [
      ".web.mjs",
      ".web.js",
      ".web.mts",
      ".web.ts",
      ".web.jsx",
      ".web.tsx",
      ".mjs",
      ".js",
      ".mts",
      ".ts",
      ".jsx",
      ".tsx",
      ".json",
    ],
    alias: [
      {
        find: "react-native",
        replacement: path.resolve(modules, "react-native-web/dist/index.js"),
      },
    ],
  },
  test: {
    exclude: ["node_modules/**", "vendor/**"],
  },
});
```

This is the part of the fork's root `vitest.config.ts` (at `906a13e15`) that the office's tests use. Read that file: if a test here needs another of its aliases or options, add it with a comment saying which test.

- [ ] **Step 2: Run the suite and fix what the move broke**

```bash
npx vitest run --reporter=dot > /tmp/paseo-office-tests.txt 2>&1; tail -40 /tmp/paseo-office-tests.txt
```

This repo's whole suite may be run (it is the office's tests alone), but give it room: add `--pool=forks --poolOptions.forks.maxForks=4` if the machine is busy. Failures to expect, and what to do:

- A mounted test that calls `importOriginal()` on `@getpaseo/plugin/client` or `/client/ui`: the published package's client entries are declarations for a host that supplies them at run time, so the original may not load in jsdom. Give the mock a complete stand-in instead of spreading the original, keeping every member the test's subject uses. Say which tests.
- A test that reads a file by a path relative to the fork (`plugins/office/...`): make the path relative to this repo's root.
- A test that leans on a fork alias: add the alias in Step 1 or change the import.

Fix tests, not product code, unless the product code is wrong on stock. Do not delete or skip a test to get to green: a test that cannot run here is reported with its reason, and stays as `test.todo` with that reason only if the report lists it.

Expected at the end: `npm test` exits 0. Record the totals.

- [ ] **Step 3: Typecheck again, commit**

```bash
npm run typecheck
git add -A
git diff --cached | grep -inE "token|password|secret|10\.0\.|/home/paseo" | head -20
git commit -m "test: the office's tests run in this repo"
```

---

### Task 3: Lint and format

**Files:**

- Create: `.oxlintrc.json`, `.oxfmtrc.json`

**Interfaces:**

- Produces: `npm run lint` and `npm run format:check` pass.

- [ ] **Step 1: `.oxfmtrc.json`**

```json
{
  "$schema": "./node_modules/oxfmt/configuration_schema.json",
  "useTabs": false,
  "tabWidth": 2,
  "printWidth": 100,
  "singleQuote": false,
  "jsxSingleQuote": false,
  "quoteProps": "as-needed",
  "trailingComma": "all",
  "semi": true,
  "arrowParens": "always",
  "bracketSameLine": false,
  "bracketSpacing": true,
  "ignorePatterns": ["*.lock", "vendor/**", "shared/upstream/**", "server/world.generated.ts"]
}
```

- [ ] **Step 2: `.oxlintrc.json`**

Start from the fork's `.oxlintrc.json` at `906a13e15` (`git -C /workspace/QFlavours/paseo-onepage-docs show 906a13e15:.oxlintrc.json`). Keep `options`, `plugins`, `jsPlugins` (only if the plugin it names is an npm package this repo can install; otherwise drop it and say which rules went with it), `categories` and `rules`. Replace `ignorePatterns` with `["vendor/**", "shared/upstream/**", "server/world.generated.ts"]`. Of `overrides`, keep only those whose `files` could match this repo (a general test-file override, for example, with its glob rewritten to this repo's layout); the `packages/app/...` and `packages/server/...` ones go. The aim is the rules the office's code was written under, complexity limit included, not a looser set.

- [ ] **Step 3: Run both**

```bash
npm run format:check
npm run lint
```

`format:check` must pass without reformatting the code: the files came formatted. If it wants changes, the config differs from the fork's; fix the config. `lint` must report 0 errors. A rule that fires here and did not in the fork means an override was dropped that applied: restore it. Do not disable a rule or add a suppression to get to zero.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: lint and format, with the rules the office was written under"
```

---

### Task 4: Licence, README, the manifest, the docs

**Files:**

- Create: `LICENSE`, `README.md`, `icon.png`, `docs/` (from the fork's `docs/plugins.md` office section)
- Modify: `paseo-plugin.json`, `vendor/SOURCES.md`, `vendor/my-office/import-upstream.mjs` (paths)

**Interfaces:**

- Produces: a manifest with a name, a description and an icon; a README that meets the author's three requests.

- [ ] **Step 1: `LICENSE`**

```
MIT License

Copyright (c) 2026 allrested

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

---

Third-party software in this repository keeps its own licence:

- vendor/my-office/ is my-office (https://github.com/khanh020905/my-office),
  MIT, Copyright (c) 2026 khanh020905. Its licence is vendor/my-office/LICENSE.
  The files under shared/upstream/ are taken from it too.
- vendor/my-office/three/ is three.js, MIT, Copyright © 2010-2023 three.js
  authors. Its licence is vendor/my-office/three/LICENSE.
- server/world.generated.ts is built from both and carries both.
```

Check the two copyright lines against the two licence files in `vendor/` and copy them exactly as they stand there. Neither vendored licence file is edited or moved.

- [ ] **Step 2: `README.md`**

Write it in plain, short sentences (the fork's `CLAUDE.md` "Doc voice" rules apply: no "seamless", "powerful", "simply", "just"; no sentence written to land a point). It has these parts, in this order:

1. Title `# paseo-office`, and one line: "A community port of [my-office](https://github.com/khanh020905/my-office) for [Paseo](https://github.com/getpaseo/paseo): your agents at their desks, in 3D."
2. A paragraph that says, in these terms: it is based on my-office by khanh020905 and is not an official version of it; issues with the Paseo plugin belong in this repository's issue tracker, not my-office's. Link the tracker (`https://github.com/allrested/paseo-office/issues`).
3. **What it does**: the floor in 3D, 2D and as a list; the column with Attention, Sessions, Activity and Chat; boards and wakes; the stand-up notes; incidents from Jira and Sentry; the host's readings. One line each, from what the code does (read `docs/` from Step 4), no more than ten lines.
4. **Install**: `paseo plugin install git:allrested/paseo-office`, that installed plugins need `"pluginsEnabled": true`, Paseo 0.16.0 or newer, and where the settings are (Settings > Plugins > Office, and the gear over the floor).
5. **What works where**, a small table: desktop app and browsers (3D, 2D, list); the store phone app (2D and list: its plugin frame runs no script); hosts without the calls the office asks for (no Stop, no close of a runtime).
6. **What it reads and where it sends it**: it reads the host's agents, their status and the kind of thing each does; the 3D scene is told who is there and what kind of thing each does, never a file name, a command or a prompt; it calls Jira and Sentry only when their settings are filled in, with tokens from the host's environment; it stores boards, chat, notes state and incidents under the host's Paseo home; the scene makes no network call.
7. **Based on**: my-office at the commit and version in `vendor/my-office/MANIFEST.json` (read them; write them out), three.js 0.160.0, and one line on how a newer my-office is taken (`vendor/SOURCES.md`).
8. **Develop**: `npm install`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run build:world` after any change under `vendor/`.
9. **Licence**: MIT; my-office and three.js keep theirs (see `LICENSE`).

No badge, no screenshot placeholder, no roadmap.

- [ ] **Step 3: The manifest and the icon**

`paseo-plugin.json`:

```json
{
  "id": "office",
  "name": "Office",
  "description": "A community port of my-office: your agents at their desks, in 3D.",
  "icon": "icon.png",
  "requirements": { "paseo": ">=0.16.0" }
}
```

The manifest's schema (stock `packages/server/src/server/plugins/manifest.ts`): `icon` is a relative path to a PNG inside the plugin. Make `icon.png`, 256 by 256, a plain mark that reads at 32 px: an office building in one flat colour on a rounded square, no text, nothing taken from my-office's or Paseo's artwork. Draw it with a small script kept at `scripts/make-icon.mjs` that needs nothing beyond Node (a hand-written PNG encoder over `node:zlib` is enough for flat shapes) or with a tool already on the machine (`convert` or `rsvg-convert` from an SVG kept beside the script); say which. Look at the result (`Read` the PNG) before committing: it must be recognisable, centred, and not blank.

- [ ] **Step 4: The docs**

- `docs/office.md`: the office's section of the fork's `docs/plugins.md` at `906a13e15` (from the paragraph that begins "The `office` built-in shows every agent" to the end of the office's material; find its extent by reading, it is about 350 lines), rewritten for an installed plugin: "built-in" becomes "plugin"; paths lose `plugins/office/`; anything about the fork's daemon, its build or other fork plugins is cut or reworded; what Task 1's findings established stays true (schedules of its own, a run waits for the Paseo API, the embedded scene). Integrate; do not append.
- `vendor/SOURCES.md` and `vendor/my-office/import-upstream.mjs`: every `plugins/office/` path becomes this repo's. Run the import tool in check mode against a fresh clone to prove the paths (`git clone --depth 1 https://github.com/khanh020905/my-office /tmp/ref-office/my-office`, three.js as SOURCES.md says): it must report nothing to take, since upstream is at the vendored commit; if upstream has moved, it reports what would change and that is fine. Record its output.
- The fork's design documents stay in the fork. The README does not link to them.

- [ ] **Step 5: Check and commit**

```bash
npm run format:check && npm run lint && npm run typecheck && npm run check:world
git add -A
git diff --cached | grep -inE "token|password|secret|10\.0\.|/home/paseo" | head -20
git commit -m "docs: the licence, the README, a name and an icon"
```

---

### Task 5: CI, and the weekly look at my-office

**Files:**

- Create: `.github/workflows/ci.yml`, `.github/workflows/upstream.yml`, `scripts/upstream-report.mjs`
- Test: `scripts/upstream-report.test.mjs`

**Interfaces:**

- Produces: `node scripts/upstream-report.mjs --upstream <checkout> [--three <dir>]` prints a JSON line `{ "moved": boolean, "from": string, "to": string, "version": string, "body": string }`.

- [ ] **Step 1: `ci.yml`**

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

permissions:
  contents: read

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - name: Typecheck against the published plugin SDK
        run: npm run typecheck
      - run: npm run lint
      - run: npm run format:check
      - name: The embedded scene is what the build makes
        run: npm run check:world
      - run: npm test
```

- [ ] **Step 2: The report script, test first**

`scripts/upstream-report.mjs` reads `vendor/my-office/MANIFEST.json` (`upstream.commit`, `upstream.version`), reads the checkout's `HEAD` commit (`git -C <checkout> rev-parse HEAD`) and its `package.json` version, and prints the JSON line. When the commits differ, `moved` is true and `body` is Markdown for an issue: the two commits as links to `https://github.com/khanh020905/my-office/commit/<sha>`, a compare link `https://github.com/khanh020905/my-office/compare/<from>...<to>`, the output of `node vendor/my-office/import-upstream.mjs --from <checkout> --three <dir> --check` in a fenced block (cut to its last 200 lines if longer, saying so), and the three steps to take the update from `vendor/SOURCES.md`. When `--three` is not given, the body says the check was not run and why. The script changes no file.

Write `scripts/upstream-report.test.mjs` with `node:test` first: build two throwaway git repos in a temp folder (one at the manifest's commit is not possible, so point the script at a temp copy of the manifest through an option `--manifest <file>` whose default is the vendored one), and assert: same commit gives `moved: false` and an empty body; a different commit gives `moved: true`, both shas in the body, the compare link, and "the check was not run" when `--three` is absent. Run `node --test scripts/upstream-report.test.mjs`, see it fail, then write the script. Add `"test:scripts": "node --test scripts/"` to `package.json` and a CI step for it.

- [ ] **Step 3: `upstream.yml`**

```yaml
name: my-office upstream

on:
  schedule:
    - cron: "17 6 * * 1"
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  look:
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22"
          cache: npm
      - run: npm ci
      - name: Fetch my-office
        run: git clone https://github.com/khanh020905/my-office "$RUNNER_TEMP/my-office"
      - name: Fetch the three.js upstream pins
        run: |
          version=$(node -p "require('$RUNNER_TEMP/my-office/package.json').dependencies.three.replace(/^[^0-9]*/, '')")
          npm install --prefix "$RUNNER_TEMP/three" "three@$version"
      - name: Compare
        id: report
        run: |
          node scripts/upstream-report.mjs --upstream "$RUNNER_TEMP/my-office" \
            --three "$RUNNER_TEMP/three/node_modules/three" > "$RUNNER_TEMP/report.json"
          echo "moved=$(node -p "require('$RUNNER_TEMP/report.json').moved")" >> "$GITHUB_OUTPUT"
      - name: Open or update the issue
        if: steps.report.outputs.moved == 'true'
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          node -e "const r=require(process.env.RUNNER_TEMP+'/report.json');require('fs').writeFileSync(process.env.RUNNER_TEMP+'/body.md',r.body);require('fs').writeFileSync(process.env.RUNNER_TEMP+'/title.txt','my-office moved to '+r.to.slice(0,7)+' ('+r.version+')')"
          number=$(gh issue list --label upstream --state open --json number --jq '.[0].number // empty')
          if [ -n "$number" ]; then
            gh issue edit "$number" --title "$(cat "$RUNNER_TEMP/title.txt")" --body-file "$RUNNER_TEMP/body.md"
          else
            gh label create upstream --description "A newer my-office" --color 0E8A16 2>/dev/null || true
            gh issue create --label upstream --title "$(cat "$RUNNER_TEMP/title.txt")" --body-file "$RUNNER_TEMP/body.md"
          fi
```

How my-office names its three.js version is read from its `package.json`: confirm the field (`dependencies.three`) in the clone from Task 4 and correct the step if it is elsewhere. The job never commits: taking the update is a person's step.

- [ ] **Step 4: Check and commit**

Run the report script by hand against the clone from Task 4 (expect `moved: false` today), the script's tests, and a YAML parse of both workflows (`node -e "require('yaml')"` is not available; use `python3 -c "import yaml,sys;[yaml.safe_load(open(f)) for f in sys.argv[1:]]" .github/workflows/*.yml`). Then:

```bash
npm run format:check && npm run lint && node --test scripts/
git add -A
git commit -m "ci: the checks, and a weekly look at my-office"
```

---

### Task 6: Installed from Git on a stock daemon

**Files:**

- Create: `docs/verified.md` in the new repo

**Interfaces:**

- Consumes: the repo at its Task 5 commit; `/tmp/paseo-stock` (the published daemon and CLI; rebuild with `npm install @getpaseo/server@0.16.2 @getpaseo/cli@0.16.2` there if gone).
- Produces: `docs/verified.md`: what was seen, on which Paseo version, and what was not.

- [ ] **Step 1: A clean stock daemon**

Remove `/tmp/office-stock-home` and make it again with `{ "pluginsEnabled": true }` and whatever the findings' F8 says the web UI needs. Start the daemon with `env -i PATH="$PATH" HOME="$HOME" PASEO_HOME=/tmp/office-stock-home PASEO_LISTEN=0.0.0.0:6798 node /tmp/paseo-stock/node_modules/@getpaseo/server/dist/scripts/supervisor-entrypoint.js`, in the background, pid recorded. `daemon status` must report 6798 and that home before any other command.

- [ ] **Step 2: Install by Git**

`paseo plugin install file:///workspace/QFlavours/paseo-office` (the Git form the findings recorded for a local repo). No `node_modules` is in the clone: this is the install a user gets. Record: the install's time, `paseo plugin ls`, `paseo plugin logs office` (loaded, ready, no error naming a missing call).

- [ ] **Step 3: Look**

With the Paseo browser tools, at 1280 and 390 px wide, against `http://<first address of hostname -i>:6798`:

- Settings > Plugins lists "Office" with its icon and description; its page has the settings screen.
- The office opens from the sidebar; the 3D floor draws; the 2D floor and the List show; the column's four tabs open; the gear opens the settings page.
- At 390 px the bar is under the floor and a tab opens the sheet.
- A board post and a chat message are stored (`/tmp/office-stock-home/office/`).
- Set a notes folder and a time zone: the plugin's log or the Attention tab shows no schedule error; clear them again.

Save screenshots under `/tmp/paseo-office-look/`. Not expected to be seen, and to be recorded as such: an agent using the office's tools, a real stand-up run, a real incidents check (the throwaway daemon has no provider sign-in and no tracker tokens).

- [ ] **Step 4: Stop, write it down, commit**

Stop the daemon by its pid; confirm 6798 is closed and 6767 untouched. `docs/verified.md`: the Paseo version, the date, what was seen at each width, what was not, in the docs' voice, no host address. Link it from the README's "What works where". Commit `docs: what was seen on a stock daemon`.

---

### Task 7: Publish (controller, with the owner's go-ahead)

Not for a subagent. The controller asks the owner first, at this point, and does nothing here without a yes.

- [ ] **Step 1: Before the push**

In `/workspace/QFlavours/paseo-office`: `git log --format='%an <%ae> %s'` (author as configured, no AI trailer); `git grep -inE "password|secret|10\.0\.|/home/paseo|PASEO_AGENT_ID=" -- . ':!vendor' ':!server/world.generated.ts'` and read every hit; `npm ci && npm run typecheck && npm run lint && npm run format:check && npm run check:world && npm test && node --test scripts/`.

- [ ] **Step 2: Create and push**

```bash
gh repo create allrested/paseo-office --public \
  --description "A community port of my-office for Paseo: your agents at their desks, in 3D. Based on khanh020905/my-office." \
  --source /workspace/QFlavours/paseo-office --remote origin --push
gh repo edit allrested/paseo-office --add-topic paseo --add-topic paseo-plugin --enable-issues
```

- [ ] **Step 3: CI**

Watch the first CI run to green. Dispatch the upstream workflow once (`gh workflow run upstream.yml`) and confirm it ends green with no issue opened (upstream has not moved). A failure is fixed in the repo and pushed before Task 8.

---

### Task 8: Cutover on the owner's host (controller, with the owner's go-ahead)

Not for a subagent. It changes the running host and restarts the daemon on 6767, which ends every running agent's session, the controller's included. The controller asks the owner first, at this point.

- [ ] **Step 1: The fork loses its built-in**

In `/workspace/QFlavours/paseo-onepage-docs`, on a branch: delete `plugins/office/`; remove `"office"` from `builtinPlugins` in `packages/server/src/server/plugins/builtin/index.ts`; remove the office's entries from the root `.oxfmtrc.json` and `.oxlintrc.json`; in `docs/plugins.md` replace the office's section with two sentences and a link to `https://github.com/allrested/paseo-office`; search for anything else that names it (`git grep -n "plugins/office\|\"office\"" -- packages plugins docs scripts .github`) and fix each. `npm run typecheck`, `npm run lint`, `npm run format:check`, the server's built-in registry test file, then merge to `main`, push, and wait for Fork CI.

- [ ] **Step 2: Back up, build, install**

Back up `/usr/local/lib/node_modules/@getpaseo` under `/tmp` and copy `~/.paseo/office/` and `~/.paseo/config.json` beside it. Pack and install the fork's seven packages as before, smoke-start on a spare port with a throwaway home, and confirm the smoke daemon loads 31 built-ins and no `office`.

- [ ] **Step 3: The plugin, then the restart**

Set `"pluginsEnabled": true` in `~/.paseo/config.json` (keep every other key). The plugin can only be installed through a running daemon, and the running daemon still has the built-in `office`, so the order is: restart the daemon (it comes up without the built-in), then `paseo plugin install git:allrested/paseo-office --ref <the pushed main commit>`. Say so to the owner before the restart: for the minute between, there is no office.

- [ ] **Step 4: Confirm, or go back**

`paseo plugin ls` shows `office` from Git, running. Its log has no error. The office opens; the boards and the chat are the ones from before (`~/.paseo/office/` untouched); the settings hold the notes folder and the trackers as before; Settings > Plugins > Office shows them; the gear opens that page. If the settings did not carry over (an installed plugin's settings document may be kept apart from a built-in's), copy the values by hand from the backup and say so. If the office does not load: `paseo plugin remove office`, reinstall the backed-up build, restart, and report.

- [ ] **Step 5: Release**

Tag `v0.1.0` in `paseo-office` at the commit that is installed, push the tag, and `gh release create v0.1.0 --generate-notes` with a first line saying what it is and what it is based on. Draft, for the owner to send, a short message to Khanh with the repo's link and the my-office commit it is based on. Update the fork's design spec's status line to "sub-project 1 built" and the retirement plan's progress note.
