# The office's camera toolbar: design

Date: 2026-11-17. Status: built. Piece 2 of sub-project 7 ("Upstream's controls") of
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

| Question      | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What it has   | Overview, Desks, Meeting room, Servers; zoom out, the percent, zoom in; Full screen; Photo. No list button and no Walk in. My call: Walk in is piece 4, which adds its button at the bar's end.                                                                                                                                                                                                                                                      |
| Where         | Upstream's place and look: bottom centre of the stage, upstream's dark track and groups, held by its right edge while a mouse is on it (`tb-pinned`). Its markup and style are made by `camera-bar.js`'s `build()`, before the scene's modules start, and wired by its `setup()` once the loop is set up. My call: so `buildPage` and `paseo-style.js`, which other branches edit, are not touched, and `paseo-entry.js` gets one call to `build()`. |
| Words         | Upstream's English: "Overview", "Desks", "Meeting room", "Servers", "Zoom out", "Zoom in", "Full screen", "Photo mode"; the bar's label is "View". Each button has its `aria-label` and `title`.                                                                                                                                                                                                                                                     |
| Narrow frames | Below 520 px wide the views show their icons only, the names stay out on hover too, and the bar keeps `max-width: calc(100% - 24px)`. My call.                                                                                                                                                                                                                                                                                                       |
| With a card   | The bar stays under the place card and over the canvas, as upstream's `z-index: 2`.                                                                                                                                                                                                                                                                                                                                                                  |
| Keyboard      | Every control is a `button` in the page's tab order after the place chips, with a 2 px focus ring as the chips have.                                                                                                                                                                                                                                                                                                                                 |

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
| Its bar          | Upstream's `PhotoBar.tsx` markup without the clip's three controls (shape, music, clip): Names, Logo, Screen/Full HD/4K, Take photo, Leave photo mode. Built by `camera-bar.js`'s `build()` with the toolbar.                                                                                                         |
| Day and night    | The Auto/Day/Night buttons are left out. My call: `ui/settings.js` is a stand-in whose `setTimeMode` does nothing, and Paseo sets night itself.                                                                                                                                                                       |
| The mark         | The brand's name in place of "My Office" (`host.brandName`, else "Paseo"), the building mark beside it. One `// PASEO:` change in `paintMark`. `paseo-entry.js`'s `start` sets `host.brandName` from `options.brand?.name` in one line beside `showBrand`. My call: the sign already shows the brand (sub-project 1). |
| Walk-in stand-in | Photo mode imports `exitFp` from `interact/first-person.js`. The stand-in gains `export function exitFp() {}`, which piece 4 replaces.                                                                                                                                                                                |
| Saving           | Upstream's: a PNG download named `my-office-YYYY-MM-DD-HHMM.png`, renamed `office-YYYY-MM-DD-HHMM.png` in the same `// PASEO:` change. "Saved a W × H photo to your Downloads." through `host.toast`.                                                                                                                 |
| The panels       | Photo mode hides the toolbar (`is-photo`), as upstream. The office's header outside the frame stays.                                                                                                                                                                                                                  |
| Keys             | P toggles it, Escape leaves it, as upstream; only while the frame has the keyboard.                                                                                                                                                                                                                                   |

## Components

- `vendor/my-office/src/office/ui/camera-bar.js`: still Paseo's stand-in. Keeps `fitFloor`,
  `setView` and the resize; gains the views, zoom, full screen, the bar's and the photo bar's
  markup and style. `build()` makes the markup before the scene's modules start, so `photo.js`'s
  `setup` finds `btn-photo` and the photo bar when it wires them.
- `vendor/my-office/src/office/ui/photo.js`: upstream's, with the one `// PASEO:` change.
- `vendor/my-office/src/office/interact/first-person.js`: the no-op `exitFp`.
- `vendor/my-office/src/office/paseo-entry.js`: three one-line changes. It sets `host.brandName`
  beside `showBrand(options.brand)`, calls `cameraBar.build()` right after `buildPage()`, and its
  Escape listener leaves the place card alone in photo mode, where Escape leaves photo mode. This
  file is also edited by `feat/office-one-page`, `feat/office-one-page-scene` and
  `feat/office-incidents`, so each line stays where it was, away from their changes.
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

The app itself was not run, on web or in Electron. Its workspace scripts start the dev daemon and
the app only for a checkout that has a workspace on the daemon on port 6767, and this one has
none; registering one would change that daemon's state. A daemon started by hand on port 6768
was not tried either: the owner's standing note for this checkout is never to start a daemon by
hand. So the bar was not seen on the office screen or in the office panel, and a download from
inside the `srcdoc` frame in Electron was not tried. Photo mode's button stays on Electron: the
`host.photo === false` option is built only if that download is shown to fail, and it was not
tried.

The scene's own script was looked at alone instead. It was bundled with the options the app uses
(IIFE, es2020, minified, 1.10 MB), served as a static page from the build container, and opened in
Paseo's browser at 1280 x 800 and 390 x 844, light and dark colours. The browser drew with software
WebGL (llvmpipe), and the scene showed its own "drawing 3D without a GPU" toast. Two pages were
used. One runs the script in an `iframe` with `srcdoc` and `allow="fullscreen"`, as
`world-frame.web.ts` does, with a text field above it. The other runs it in the page itself,
because the browser tool's refs and pointer clicks do not reach into a `srcdoc` frame. Both called
`start` with the `pro` plan, the app's colours, the brand "Flavours Kitchen" and an `onToast` that
kept the toasts, then `setSessions` with five made-up agents. No page error came up and no
`problem` call was made.

What the scene alone showed:

- The bar sits at the bottom centre: the dark track, three groups, Overview pressed with its name
  out and its icon in the app's accent, the percent at 100%. Light and dark look the same.
- Desks, Meeting room and Servers each fly to their place and are pressed, by pointer and by
  keyboard (Enter on a focused button). The percent ends at 190%, 200% and 239%. Overview comes
  back at 100%.
- Desks pressed and Servers pressed straight after, while the camera was still flying (171%):
  Servers was pressed, and the camera ended on Servers at 239%.
- Zoom in by Enter stops at 523%; three more presses leave it at 523%. Zoom out by pointer stops
  at 77%. Tab reaches every control with a 2 px ring, and the zoom and tool buttons show their
  name above them on focus and hover.
- Full screen, by pointer in the page and by Enter in the frame: the browser allowed it. In the
  frame, the outer page's full screen element was the `iframe`, its header was gone and the floor
  filled the window; the button was pressed. The button again left it. A `requestFullscreen` made
  to reject showed "This browser won't go full screen." once. With `document.fullscreenEnabled`
  false the button was hidden and the bar closed up around the gap.
- Photo mode, by the button and by P, hides the bar, the chips and the bubbles, shows the photo
  bar with Take photo focused, and keeps the name tags. Names and Logo turn off and on. Escape and
  P leave it, and the bar comes back.
- Take photo, by pointer and by Enter: the download was named `office-2026-11-17-1522.png` and
  `office-2026-11-17-1523.png`, and "Saved a 1920 × 1200 photo to your Downloads." came up. The
  picture was opened in the page: the floor, the name tags, and "Flavours Kitchen" with the
  building mark at the bottom right; with Names and Logo off, neither.
- P typed into the text field outside the frame went into the field; photo mode did not start.
- At 390 px the views show their icons only and the bar spans 5 to 385 px; nothing is cut. Photo
  mode's bar wraps to two rows inside the frame.
- An incident set with `setIncidents` during photo mode: the banner is hidden, but the red glow
  around the stage stays on screen. The saved picture has no glow; its walls are pink from the
  alarm's light.

What did not come out as written:

- The zoom buttons leave the view pressed: Servers stayed pressed at 523% and at 77%, though the
  Pressed row says a zoom clears it.
- At 390 px the tooltip of the last button (Photo mode) runs past the frame's right edge and is
  cut. The tooltips make the page 404 px wide in a 390 px frame. In the page without the frame,
  after pointer clicks on the bar, the page was found scrolled 14 px to the right and the bar's
  left edge was cut; what scrolled it was not found. In the frame, keyboard focus did not scroll it.
- "Full HD" is 1920 px wide at the frame's shape, not 1920 x 1080: 1920 x 1200 at 1280 x 800, and
  1920 x 3988 at 390 x 844.
- Escape sent by the browser tool did not leave full screen; the browser's own Escape was not
  tried. Shift+Tab sent by the tool did not move focus.
- After Escape out of photo mode, focus goes to the page, not back to the Photo mode button.
- Whether the downloads reached a Downloads folder was not seen: the browser runs in another
  container. The download's name, size and picture were read in the page.
- A pointer click inside the frame was not made; the frame was driven by keyboard and by calls
  into its page.
