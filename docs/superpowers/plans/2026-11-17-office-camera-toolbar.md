# Office camera toolbar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The 3D office gets upstream's camera toolbar: Overview, Desks, Meeting room, Servers, zoom with a percent, full screen, and photo mode.

**Architecture:** Paseo's stand-in `ui/camera-bar.js` keeps its fitted view and gains the bar's markup and style, the views, the zoom and full screen. Upstream's `ui/photo.js` is taken through `import-upstream.mjs` with one `// PASEO:` change. The frame allows full screen. Walk in is not built; `interact/first-person.js` gains a no-op `exitFp` that photo mode imports.

**Tech Stack:** Plain JavaScript in the vendored scene (upstream's style, three.js r160), TypeScript for the frame and tests, vitest with jsdom, esbuild through `server/world-script.ts`.

**Spec:** `docs/superpowers/specs/2026-11-17-office-camera-toolbar-design.md` (piece 2 of sub-project 7 of `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`).

## Global Constraints

- Work in your own worktree on branch `feat/office-camera-toolbar`, made from `main`. Do not push. Do not write in any other worktree.
- Every subagent runs on Opus.
- No commit carries AI attribution: no `Co-Authored-By` trailer, no "Generated with" line.
- Run one test file at a time, from the repo root: `npx vitest run <file> --bail=1`. Never run a whole suite.
- After each task's code: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, then `npm run lint -- <changed .ts/.tsx files outside plugins/office/vendor/>`, then `npm run format:files -- <changed files outside plugins/office/vendor/>`.
- No upstream file under `plugins/office/vendor/my-office/` is edited by hand, except `ui/photo.js`'s one `// PASEO:` change. Paseo's code there is in `paseo-*.js` and the stand-ins, in upstream's style.
- Upstream's checkout is `/tmp/ref-office/my-office` at `b68228871fe30cd2c759a2c919337a9a9d1f5644`; three.js is `/tmp/ref-office/three/node_modules/three`. If either is missing: `git clone https://github.com/khanh020905/my-office /tmp/ref-office/my-office` and check out that commit; `npm i --prefix /tmp/ref-office/three three@0.160.0`.
- Never restart or touch the daemon on port 6767.
- Snippets are in `text` fences on purpose, so the formatter leaves them as they are.

Binding values from the spec:

- The bar's controls, in order: Overview (`home` icon), Desks (`monitor`), Meeting room (`users`), Servers (`server`); Zoom out (`minus`), the percent, Zoom in (`plus`); Full screen (`maximize`); Photo mode (`camera`). The bar's `aria-label` is `View`. No list button, no Walk in.
- Upstream's markup classes and ids: `.toolbar`, `.tb-seg`, `.seg-btn[data-view]`, `.tb-zoom`, `#zoom-out`, `#zoom-val`, `#zoom-in`, `.tb-tools`, `.tb-full#btn-full`, `.tb-full#btn-photo`. Upstream's CSS for them is from `src/styles/stage.css` lines 9 to 26, with upstream's colour variables mapped to the `--o-*` ones `paseo-style.js` sets.
- Bottom centre, `z-index: 2`, `max-width: calc(100% - 24px)`, held by its right edge under a mouse (`tb-pinned`, 340 ms to let go), as upstream.
- Below 520 px of frame width the view names never slide out.
- Views on the `pro` plan: `desks [2.3, 0.6, 3.6] ×1.9`, `meeting [-1.2, 0.6, -5.4] ×2.0`, `server [-5.6, 1.0, -0.6] ×2.4`. The factor multiplies the fitted view's zoom, clamped to `controls.minZoom`/`maxZoom`. Overview is `fitFloor()`.
- Overview is pressed at the start. The pressed view clears on `setView(null)`. A view press calls `closeSession()` first when someone is selected.
- A resize refits only while Overview is pressed.
- Zoom buttons: ×1.2 and ÷1.2 of the zoom goal, within the limits. The percent is `Math.round(camera.zoom / fittedZoom * 100)%`, written every 200 ms only when it changes.
- Full screen: `document.documentElement.requestFullscreen()`; the button is hidden when `document.fullscreenEnabled` is false; a refusal calls `host.toast("This browser won't go full screen.")`; `aria-pressed` follows `fullscreenchange`. The frame gets `allow="fullscreen"`.
- Photo mode: upstream's `ui/photo.js`. Its bar: Names (`#ph-names`), Logo (`#ph-mark`), Screen/Full HD/4K (`[data-ph-size]`), Take photo (`#ph-shoot`), Leave photo mode (`#ph-exit`), inside `#photo-bar` with `hidden`. No clip controls, no Auto/Day/Night.
- The `// PASEO:` change in `photo.js`: `paintMark` writes `host.brandName || 'Paseo'` instead of `'My Office'`, and the download is named `office-YYYY-MM-DD-HHMM.png`.
- `paseo-entry.js` sets `host.brandName = options.brand?.name || ''` in one line beside `showBrand(options.brand)`.
- Toasts go through `host.toast`.

Decided in this plan, where the spec left it open:

- `camera-bar.js` builds the toolbar's and the photo bar's markup into `#stage-wrap` and adds one `<style>` of its own, inside its `setup()`. It runs before photo mode's `setup` in the start order (`uiCameraBar` comes before `uiPhoto` in upstream's list), so `#btn-photo` exists when `photo.js` wires it.
- The fitted zoom is kept in a module variable `fitZoom`, set by `fitFloor()`.
- Photo mode's Escape and the place card's Escape: photo mode's listener returns first when photo mode is on; the place card is closed in photo mode, so the two do not meet.

## Files shared with other branches

`feat/office-incidents` was merged into `main` at `d58c6f6ee`, after this plan's spec was written. Its changes are in your base. Where the table names it, it marks code of the incidents work in the same file: keep your change away from it.

| File                                                                                          | Also edited by                                                                       | How to keep the merge small                                                                     |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `plugins/office/vendor/my-office/import-upstream.mjs`                                         | `feat/office-incidents` (lets `life/incidents.js` and `audio/sfx.js` through `DENY`) | Change only the `ui/` line of `DENY`: add `photo\.js$` to its exceptions.                       |
| `plugins/office/vendor/my-office/MANIFEST.json`                                               | `feat/office-incidents` (written by the same script)                                 | Generated. On a conflict, rerun the script after the merge instead of merging the file by hand. |
| `plugins/office/vendor/my-office/src/office/paseo-modules.js`, `src/i18n/locales/en/index.js` | `feat/office-incidents` (generated by the same script)                               | Generated; rerun the script after the merge.                                                    |
| `plugins/office/vendor/my-office/src/office/paseo-entry.js`                                   | `feat/office-incidents` (the alarm's call)                                           | One line, beside `showBrand(options.brand)`.                                                    |
| `plugins/office/vendor/SOURCES.md`                                                            | `feat/office-incidents`                                                              | Add photo mode in its own bullet under "What is taken".                                         |
| `plugins/office/client/world/entry.test.ts`                                                   | `feat/office-incidents`                                                              | Add tests at the end of the file.                                                               |

Not touched by this plan: `contracts.ts`, `office-surface.tsx`, `hub.ts`, `index.server.ts`, `styles.ts`, `list-text.ts`. Pieces 1 and 3 do not edit any file this plan edits.

## Review Focus

1. **A frame narrower than the bar.** At 390 px the bar fits inside the frame and nothing is cut. Pinned in Task 2's browser check.
2. **A view pressed while the camera is still flying to the last one.** It flies to the new one; the pressed button is the new one. Pinned in Task 2.
3. **Zoom in at the limit.** The goal stays at `maxZoom`; the percent stops rising. Pinned in Task 2.
4. **P typed in the board's text box in the app.** The app's field is outside the frame, so the key does not reach photo mode; P inside the frame toggles it. Pinned in Task 3's browser check.
5. **A browser where full screen is off (an iframe policy, iOS Safari).** The button is hidden, not left to fail. Pinned in Task 2.

---

### Task 1: Take photo mode from upstream

**Files:**

- Modify: `plugins/office/vendor/my-office/import-upstream.mjs` (the `ui/` line of `DENY`)
- Generated: `plugins/office/vendor/my-office/src/office/ui/photo.js`, `MANIFEST.json`, `src/office/paseo-modules.js`, `src/i18n/locales/en/index.js` and the `ui` English area the script writes
- Modify: `plugins/office/vendor/my-office/src/office/ui/photo.js` (the one `// PASEO:` change, after the script wrote it)
- Modify: `plugins/office/vendor/my-office/src/office/interact/first-person.js` (`export function exitFp() {}`)
- Modify: `plugins/office/vendor/my-office/src/office/paseo-entry.js` (the `host.brandName` line)
- Modify: `plugins/office/vendor/SOURCES.md`
- Test: `plugins/office/server/world-script.test.ts`

**Interfaces:**

- Produces: `ui/photo.js` with upstream's `setup`, `enterPhoto`, `exitPhoto`, `photoOn`. `host.brandName: string`.

- [ ] **Step 1: Check what the script would take**

Run: `node plugins/office/vendor/my-office/import-upstream.mjs --from /tmp/ref-office/my-office --three /tmp/ref-office/three/node_modules/three --check`
Expected: after the `DENY` change, `ui/photo.js` and any new English area are listed as written. Any other new module reached from `photo.js` is listed too. If one appears that is not already vendored, stop and list it in the task's report: the plan assumes `photo.js` reaches only modules already taken or stood in.

- [ ] **Step 2: Write the failing test** in `world-script.test.ts`, under "the vendored entry":

```text
it("bundles upstream's photo mode, with Paseo's mark and file name", () => {
  const photo = readVendor("src/office/ui/photo.js");
  expect(photo).toContain("PASEO:");
  expect(photo).toContain("host.brandName");
  expect(photo).toMatch(/office-\$\{/);
  expect(bundle()).toContain("ph-shoot");
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `npx vitest run plugins/office/server/world-script.test.ts --bail=1`
Expected: FAIL.

- [ ] **Step 4: Run the script for real, then make the hand changes.** Run the Step 1 command without `--check`. In `photo.js`, change `paintMark` and the download name under a `// PASEO:` comment, and import `host` from `../paseo-host.js`. Add `exitFp` to the stand-in. Add the `host.brandName` line to `paseo-entry.js`. Add the bullet to `SOURCES.md`, listing `ui/photo.js` among the changed-by-hand files.

- [ ] **Step 5: Run the test to see it pass, then check the script is clean**

Run: `npx vitest run plugins/office/server/world-script.test.ts --bail=1`
Expected: PASS.
Run: the Step 1 command with `--check`.
Expected: `ui/photo.js` listed as kept local; nothing else to write.

- [ ] **Step 6: Commit**

```bash
git add plugins/office/vendor plugins/office/server/world-script.test.ts
git commit -m "feat(office): take upstream's photo mode, with the brand's name in its mark"
```

### Task 2: The toolbar, its views, zoom and full screen

**Files:**

- Modify: `plugins/office/vendor/my-office/src/office/ui/camera-bar.js`
- Modify: `plugins/office/client/world/world-frame.web.ts` (`allow="fullscreen"`)
- Test: `plugins/office/client/world/entry.test.ts` (new tests at the end), `plugins/office/client/world/camera-bar.test.ts` (new)

**Interfaces:**

- Consumes: `fitFloor`, `setView` (kept, same signatures); `closeSession` from `ui/session-drawer.js`; `host.toast`.
- Produces: `goView(view: 'home' | 'desks' | 'meeting' | 'server')`, exported from `camera-bar.js`. `setView(view | null)` now also sets the buttons' `aria-pressed`.

- [ ] **Step 1: Write the failing tests** in `camera-bar.test.ts`, with the renderer, loop and session drawer stood in (as `entry.test.ts` does) by plain objects holding `zoom`, `minZoom`, `maxZoom` and a `focusTarget` with `set`/`copy`:

```text
test("the bar has its eight controls with their labels", () => {
  setup();
  expect([...document.querySelectorAll(".toolbar button")].map((b) => b.getAttribute("aria-label")))
    .toEqual(["Overview", "Desks", "Meeting room", "Servers", "Zoom out", "Zoom in", "Full screen", "Photo mode"]);
  expect(document.querySelector(".toolbar").getAttribute("aria-label")).toBe("View");
});
test("Overview is pressed at the start, and a drag clears it", ...);
test("Desks flies to upstream's place at 1.9 times the fitted zoom", () => {
  setup(); click("[data-view=desks]");
  expect(focusTarget.set).toHaveBeenLastCalledWith(2.3, 0.6, 3.6);
  expect(state.zoomGoal).toBeCloseTo(fitted * 1.9);
});
test("a view closes the chosen person first", ...);
test("zoom in stops at the limit", ...);
test("the percent reads 100% on Overview", ...);
test("full screen is hidden where the browser has it off", ...);
test("a refused full screen says so", async () => { /* requestFullscreen rejects -> host.toast("This browser won't go full screen.") */ });
test("a resize refits only on Overview", ...);
```

In `entry.test.ts`, at the end:

```text
test("the frame's page lets the office go full screen", () => {
  expect(openWorldFrame(...).element.getAttribute("allow")).toBe("fullscreen");
});
```

(Put this one in `world-frame` tests if a file for them exists; else at the end of `entry.test.ts`.)

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run plugins/office/client/world/camera-bar.test.ts --bail=1`
Expected: FAIL.

- [ ] **Step 3: Write the bar in `camera-bar.js`.** Markup from upstream's `CameraToolbar.tsx` without `#btn-lite` and `#btn-fp`, and the photo bar from `PhotoBar.tsx` without the clip and time controls, both appended to `#stage-wrap`, with `data-icon` spans filled by `icon()` from `ui/icons.js`. The style block is upstream's stage.css lines 9 to 26 plus `.photo-bar` from upstream's `photo.css`, mapped to `--o-*`, plus `@media (max-width: 520px) { .seg-btn > span:last-child { display: none; } }` and `body.is-photo .toolbar { display: none; }`. The views use the table in Global Constraints. The pin and unpin are upstream's. Set `allow` in `world-frame.web.ts`.

- [ ] **Step 4: Run the tests to see them pass**

Run: `npx vitest run plugins/office/client/world/camera-bar.test.ts --bail=1`, then `npx vitest run plugins/office/client/world/entry.test.ts --bail=1`, then `npx vitest run plugins/office/server/world-script.test.ts --bail=1`
Expected: PASS each.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/vendor/my-office/src/office/ui/camera-bar.js plugins/office/client/world
git commit -m "feat(office): upstream's camera toolbar: views, zoom and full screen"
```

### Task 3: Look at it in a browser and in the app

**Files:**

- Modify: `docs/superpowers/specs/2026-11-17-office-camera-toolbar-design.md` ("Not verified", Status to built)
- Modify: `docs/superpowers/specs/2026-11-16-office-owner-review-design.md` (Status: piece 2 built)

- [ ] **Step 1: The scene alone.** Bundle the scene as the app does and serve it as a static page, as sub-project 1's check did. At 1280 x 800 and 390 x 844, with software WebGL: each view, zoom in to the limit and out, full screen in and out, photo mode by the button and by P, a Full HD shot saved, Escape out. By pointer and by keyboard.

- [ ] **Step 2: In the app.** Start a dev daemon of this worktree (`npm run dev`, never port 6767) with the office's fixtures. On web and in Electron (`npm run dev:desktop`): the bar on the office screen and in the office panel; full screen; a photo saved. If Electron does not save the download, hide `#btn-photo` there (the scene learns it from a `host.photo === false` start option the frame passes on Electron) and say so in the spec.

- [ ] **Step 3: Write what was seen and what was not** in the spec's "Not verified", in the style of the earlier office specs.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/2026-11-17-office-camera-toolbar-design.md docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git commit -m "docs(office): the camera toolbar is built"
```

## Order

Tasks 1 and 2 can run in parallel: Task 2's tests stand photo mode in. Task 2's `world-script.test.ts` run needs Task 1 merged in first. Task 3 is last.
