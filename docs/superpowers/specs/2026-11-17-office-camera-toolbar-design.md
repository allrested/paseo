# The office's camera toolbar: design

Date: 2026-11-17. Status: designed, not built. Piece 2 of sub-project 7 ("Upstream's controls") of
[the office after the owner's review](2026-11-16-office-owner-review-design.md). The owner's answers
on how sub-project 7 splits are in [piece 1's design](2026-11-17-office-list-mode-design.md#the-owners-answers).
Walk in is piece 4 and is not in this one.

## Request

Point 13 of the owner's review, without walking in:

13. Upstream's camera toolbar is missing: Overview, Desks, Meeting room, Servers, zoom,
    fullscreen, photo, and Walk in.

## What was there

- Upstream's toolbar (`src/components/office/CameraToolbar.tsx`, driven by
  `src/office/ui/camera-bar.js`) sits at the bottom centre of the stage: four view buttons
  (Overview, Desks, Meeting room, Servers; an icon each, the name slides out on hover), zoom out,
  the zoom in percent, zoom in, full screen, photo mode, list mode, and Walk in. A view sets
  `focusTarget` and `state.zoomGoal` from a fixed table per floor plan; the loop flies the camera
  there. The percent is the camera's zoom over `BASE_ZOOM`. Full screen calls
  `document.documentElement.requestFullscreen()`; a refusal shows "This browser won't go full
  screen."
- Upstream's photo mode (`src/office/ui/photo.js`, 138 lines, and its bar `PhotoBar.tsx`) frees
  the camera (any angle, pan, zoom 0.3 to 6), hides the panels, and saves a PNG at the screen's
  size, Full HD or 4K, with the name tags and a small "My Office" mark painted in when on. P
  toggles it and Escape leaves it. The bar's clip buttons belong to `ui/clip-music.js`, which
  photo mode does not import.
- Paseo's `ui/camera-bar.js` is a stand-in: one view, the whole floor fitted to the frame
  (`fitFloor`), refitted on a resize while nobody moved the camera. `setView(null)` is called by
  the loop and the place cards when the camera leaves a named view. `ui/photo.js` is not taken
  (`DENY` in `import-upstream.mjs` covers every `ui/` file but `event-text.js` and `icons.js`).
  `ui/settings.js`, which photo mode imports for its day and night buttons, is a stand-in with
  no-op `setTimeMode` and `syncTimeBtns`.
- The office runs the company floor (`pro` plan). Upstream's views for it are
  `home [3, 0.3, 0.7] ×1`, `desks [2.3, 0.6, 3.6] ×1.9`, `meeting [-1.2, 0.6, -5.4] ×2.0`,
  `server [-5.6, 1.0, -0.6] ×2.4`. Paseo's fitted view is not upstream's home: the frame is any
  shape.
- The scene runs in an `iframe` with `srcdoc` (`client/world/world-frame.web.ts`), with no `allow`
  attribute, so the page inside cannot go full screen. The scene is offered only on web and
  Electron; the installed phone app shows the 2D office.
- `ui/icons.js` (taken) has every icon the bar needs: `home`, `monitor`, `users`, `server`,
  `minus`, `plus`, `maximize`, `camera`, `x`.
- Paseo's own view switch (3D, 2D, List) is in the office's header, so upstream's list button has
  no place here.

## Approaches

| Approach                                               | Trade-off                                                                                                                                               | Chosen |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| The toolbar in the scene's page, drawn by the stand-in | Upstream's look and place; the camera code is beside it. The bar is DOM in the frame, as the place chips are, and keeps the plugin's client untouched.  | Yes    |
| The toolbar in the plugin's React header               | The kit's buttons and theme. Every press crosses the frame through the world API, and the bar moves off the floor.                                      | No     |
| Upstream's `camera-bar.js` taken unchanged             | Least code of ours. It imports the session drawer and first person, which are stand-ins without what it needs, and its home view is not the fitted one. | No     |

## Decisions

### The bar

| Question      | Decision                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What it has   | Overview, Desks, Meeting room, Servers; zoom out, the percent, zoom in; Full screen; Photo. No list button and no Walk in. My call: Walk in is piece 4, which adds its button at the bar's end.                                                                                                                                                             |
| Where         | Upstream's place and look: bottom centre of the stage, upstream's dark track and groups, held by its right edge while a mouse is on it (`tb-pinned`). It is built by `camera-bar.js`'s `setup()`, markup and style both. My call: so `buildPage` and `paseo-style.js`, which other branches edit, are not touched, and `paseo-entry.js` gets one line only. |
| Words         | Upstream's English: "Overview", "Desks", "Meeting room", "Servers", "Zoom out", "Zoom in", "Full screen", "Photo mode"; the bar's label is "View". Each button has its `aria-label` and `title`.                                                                                                                                                            |
| Narrow frames | Below 520 px wide the views show their icons only, the names stay out on hover too, and the bar keeps `max-width: calc(100% - 24px)`. My call.                                                                                                                                                                                                              |
| With a card   | The bar stays under the place card and over the canvas, as upstream's `z-index: 2`.                                                                                                                                                                                                                                                                         |
| Keyboard      | Every control is a `button` in the page's tab order after the place chips, with a 2 px focus ring as the chips have.                                                                                                                                                                                                                                        |

### The views

| Question                | Decision                                                                                                                                                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Overview                | `fitFloor()`, as the office opens today. It is pressed at the start.                                                                                                                                                |
| Desks, Meeting, Servers | Upstream's `pro` targets. The zoom is upstream's factor over the fitted view's zoom, not over `BASE_ZOOM`, clamped to the controls' limits. My call: the fitted view stands for upstream's home on any frame shape. |
| Pressed                 | The view last chosen is pressed until the camera leaves it: a drag, a zoom, a chosen person or a place's card (today's `setView(null)` calls). After that none is pressed.                                          |
| A chosen person         | A view button first closes the selection (`closeSession()`), so the agent card closes too, as upstream closes its drawer.                                                                                           |
| Resize                  | While Overview is pressed a resize refits, as today. Another view is not refitted.                                                                                                                                  |
| Auto camera             | Upstream's glide to a moment (`autoCam`, `panTo`) is not taken. My call: not in the request.                                                                                                                        |

### Zoom

| Question    | Decision                                                                                                                           |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| The buttons | ×1.2 and ÷1.2 of the zoom goal, within the controls' `minZoom` and `maxZoom`, as upstream.                                         |
| The percent | The camera's zoom over the fitted view's zoom, rounded: Overview is 100%. Written only when it changes, every 200 ms, as upstream. |

### Full screen

| Question   | Decision                                                                                                                                                                        |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What goes  | The scene's page, so the frame fills the screen with the floor and its bar. The office's header and the strip do not come with it. My call: upstream's page has only the stage. |
| The frame  | `world-frame.web.ts` sets `allow="fullscreen"` on the `iframe`.                                                                                                                 |
| The button | Hidden when `document.fullscreenEnabled` is false. A refusal shows upstream's toast "This browser won't go full screen." through `host.toast`.                                  |
| Leaving    | The button again, or Escape (the browser's). The button's `aria-pressed` follows `fullscreenchange`.                                                                            |

### Photo mode

| Question         | Decision                                                                                                                                                                                                                                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is taken    | Upstream's `ui/photo.js`, copied by `import-upstream.mjs`: its `DENY` lets `ui/photo.js` through. It brings the English `ui` strings it names, which the script writes.                                                                                                                                               |
| Its bar          | Upstream's `PhotoBar.tsx` markup without the clip's three controls (shape, music, clip): Names, Logo, Auto/Day/Night, Screen/Full HD/4K, Take photo, Leave photo mode. Built by `camera-bar.js`'s `setup()` with the toolbar.                                                                                         |
| Day and night    | The Auto/Day/Night buttons are left out. My call: `ui/settings.js` is a stand-in whose `setTimeMode` does nothing, and Paseo sets night itself.                                                                                                                                                                       |
| The mark         | The brand's name in place of "My Office" (`host.brandName`, else "Paseo"), the building mark beside it. One `// PASEO:` change in `paintMark`. `paseo-entry.js`'s `start` sets `host.brandName` from `options.brand?.name` in one line beside `showBrand`. My call: the sign already shows the brand (sub-project 1). |
| Walk-in stand-in | Photo mode imports `exitFp` from `interact/first-person.js`. The stand-in gains `export function exitFp() {}`, which piece 4 replaces.                                                                                                                                                                                |
| Saving           | Upstream's: a PNG download named `my-office-YYYY-MM-DD-HHMM.png`, renamed `office-YYYY-MM-DD-HHMM.png` in the same `// PASEO:` change. "Saved a W × H photo to your Downloads." through `host.toast`.                                                                                                                 |
| The panels       | Photo mode hides the toolbar (`is-photo`), as upstream. The office's header outside the frame stays.                                                                                                                                                                                                                  |
| Keys             | P toggles it, Escape leaves it, as upstream; only while the frame has the keyboard.                                                                                                                                                                                                                                   |

## Components

- `vendor/my-office/src/office/ui/camera-bar.js`: still Paseo's stand-in. Keeps `fitFloor`,
  `setView` and the resize; gains the views, zoom, full screen, the bar's and the photo bar's
  markup and style, and wires `btn-photo` before `photo.js`'s `setup` runs.
- `vendor/my-office/src/office/ui/photo.js`: upstream's, with the one `// PASEO:` change.
- `vendor/my-office/src/office/interact/first-person.js`: the no-op `exitFp`.
- `vendor/my-office/src/office/paseo-entry.js`: the one line that sets `host.brandName`. This
  file is also edited by `feat/office-one-page`, `feat/office-one-page-scene` and
  `feat/office-incidents`, so the line goes beside `showBrand(options.brand)`, away from their
  changes.
- `vendor/my-office/import-upstream.mjs`: `DENY` lets `ui/photo.js` through. The script's run
  rewrites `MANIFEST.json`, the English locale index and `paseo-modules.js` (photo's `setup` in
  upstream's start order).
- `vendor/SOURCES.md`: photo mode is taken, with its change; the toolbar is Paseo's.
- `client/world/world-frame.web.ts`: `allow="fullscreen"`.
- `client/world/entry.test.ts` and `server/world-script.test.ts`: the bar's buttons, a view press
  moving `focusTarget`, the bundle building with photo mode.

## Errors

- A refused full screen: the toast, nothing else.
- A photo that fails to encode: upstream's toast "Could not take the photo. Try a smaller size."

## Not built

- Walk in (piece 4).
- Upstream's list button, its automatic camera, its clip recording, and photo mode's day and
  night buttons.
- A toolbar on the 2D floor.

## Testing

Unit and bundle: the bundle builds; the bar has its eight controls with labels; a view press sets
`focusTarget` and the zoom goal; the percent reads 100% after Overview; zoom in and out stay within
the limits; the frame has `allow="fullscreen"`.

Browser, with software WebGL, the scene alone as the earlier sub-projects did: every view, zoom,
full screen in and out, photo mode in, a Full HD shot, Escape out; 1280 x 800 and 390 x 844; by
pointer and by keyboard.

Live, against a dev daemon with fixtures: the same in the office screen and in the office panel,
on web and in Electron.

## Not verified

A download from inside the `srcdoc` frame in Electron was not tried; Electron may need its
download handler to save it. The builder tries it and reports; if it does not save, photo mode is
left on web only, and Electron hides the button.
