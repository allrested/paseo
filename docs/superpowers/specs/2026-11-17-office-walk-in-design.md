# Walking in the office: design

Date: 2026-11-17. Status: built. Piece 4 of sub-project 7 ("Upstream's controls") of
[the office after the owner's review](2026-11-16-office-owner-review-design.md). The owner's answers
on how sub-project 7 splits are in [piece 1's design](2026-11-17-office-list-mode-design.md#the-owners-answers).
It builds on [the camera toolbar](2026-11-17-office-camera-toolbar-design.md) (piece 2), which left
the bar's end for Walk in and a no-op `exitFp` for photo mode.

## Request

Point 13 of the owner's review, the part piece 2 left out:

13. Upstream's camera toolbar is missing: Overview, Desks, Meeting room, Servers, zoom,
    fullscreen, photo, and Walk in.

## What was there

- Upstream's walk-in (`src/office/interact/first-person.js`, 263 lines, and its overlay
  `src/components/office/FirstPersonHud.tsx`) puts you on the floor as your own chibi at the
  lobby door. WASD or the arrows walk, Shift runs, a drag looks (`pointerType` sets the speed),
  V switches to third person, E or the hint button acts on the nearest thing, Exit leaves. Escape
  leaves from `ui/topbar.js`, after its drawers and the place card; that file is not taken.
  The nearest thing is a prop (`PROPS`, `activateProp`, `propHint` from `interact/props.js`), the
  cat (`petCat`), a person (`openSession`), or, with the city backdrop, the lift down to the
  street. The street (`toStreet`, `toOffice`, the shops, the basket, the zebras) needs
  `world/backdrops/` and `life/seasons.js`'s `floorBlocks`.
- Upstream's camera bar ends with Walk in: `btn-fp`, icon `walk`, label "Walk in". With walk-in
  on, its zoom buttons change `fpCam.fov` (40 to 90, steps of 8) and a view press leaves walk-in.
- In the vendored scene, `interact/first-person.js` is a stand-in: `fp = { on: false, grid }`, a
  no-op `fpUpdate` and `exitFp`, and upstream's collision grid (`buildGrid`, `blocked`), which
  `people/navigation.js` uses. `core/loop.js` and `interact/props.js` are upstream's: the loop
  already draws through `fpCam` and calls `fpUpdate` while `fp.on`, and props ignore clicks then.
- The lounge's games are taken (`people/gaming.js`, `billiards.js`, `foosball.js`, `karaoke.js`)
  and already seat `fp` when you press E at them. With no walk-in, nobody can.
- `ui/icons.js` has `walk` and `x`. `ui/session-drawer.js` is a stand-in whose `openSession(id)`
  marks the person and calls `host.select(id)`; Paseo then shows the agent card.
- Paseo sends every agent to the scene as its own person (`subs: []`), so a sub-agent is a person
  with its own session.
- `world/backdrops/index.js` is a stand-in with no `THEMES`; `life/seasons.js` is a stand-in
  without `floorBlocks`; `audio/sfx.js` is upstream's, trimmed.

## Approaches

| Approach                                                                                   | Trade-off                                                                                                                                              | Chosen |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Upstream's `first-person.js` through `import-upstream.mjs`, with three `// PASEO:` changes | Upstream's walking, keys, hint and games as they are; three marked changes (the street, `floorBounds`, E on a person) to compare on the next upstream. | Yes    |
| Keep the stand-in and write a smaller walk                                                 | Less code taken, but the games, the cat and the props' hints would need their hooks rewritten.                                                         | No     |
| Take it with the street, and stand-ins for the city                                        | Nothing to cut, but the street needs the backdrops and their shops, which Paseo does not take, so the lift would lead nowhere.                         | No     |

## Decisions

### The button

| Question | Decision                                                                                                                                                                                                                                                                                                                                                       |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where    | The camera bar's end, after Photo mode, in its own group: upstream's `btn-fp`, icon `walk`, `aria-label` and `title` "Walk in", `aria-pressed` while on. Built by the stand-in `camera-bar.js`'s `build()` with the rest of the bar.                                                                                                                           |
| Phones   | Shown only when `matchMedia('(pointer: fine)')` matches, and hidden when it stops matching. My call: upstream's walk needs keys; on touch it would only look around.                                                                                                                                                                                           |
| Views    | A view press, Photo mode and the List (the office's view switch) leave walk-in first, as upstream.                                                                                                                                                                                                                                                             |
| Zoom     | While walking, zoom in and out change `fpCam.fov` within 40 to 90 by 8, as upstream; the percent shows the field of view's zoom over 70.                                                                                                                                                                                                                       |
| Narrow   | From 720 px down Walk in and the views show no names, and the pressed view loses its wider padding: upstream's 720 px rule, so a view under the mouse or the keyboard's focus does not slide its name out and push Walk in past the edge. From 520 px down the buttons are 30 px wide and the groups 4 px apart, so the whole bar fits at 390 px with a mouse. |

### Walking

| Question        | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What is taken   | Upstream's `first-person.js`, copied by `import-upstream.mjs`: `DENY` lets `interact/first-person.js` through. The English `fp` strings it names were already in the locale index.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| The street      | Cut in one `// PASEO:` change: `street()` returns null, so the door has no E action and `toStreet`, `toOffice`, the shops and the basket are never reached. Upstream's `street()` already returned null here, because the stand-in backdrops have no `THEMES`; the change keeps the street out if a later stand-in gains them. The imports they need stay satisfied by the stand-ins.                                                                                                                                                                                                                                  |
| Stand-ins       | `life/seasons.js` gains `export const floorBlocks = []`. `world/backdrops/index.js` keeps `THEMES` undefined.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Where you start | Upstream's: inside the lobby door, facing the floor. A later walk in the same page goes on from where the last one ended.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Keys            | Upstream's: WASD or arrows, Shift to run, V third person, E act. Escape leaves: upstream's Escape is in `ui/topbar.js`, which is not taken, so `camera-bar.js` has its own, and an open place card closes first, as upstream. At a game, the game's own Escape stands you up and stops the key there. Only while the frame has the keyboard. While walking, a press on the floor or a drag to look leaves it in the frame (`world-frame.web.ts` gives it to Paseo's page after other presses on the scene), so after E by a person a press on the floor brings it back. A text field outside the frame keeps its keys. |
| Overlay         | Upstream's `FirstPersonHud` markup (crosshair, hint button, help line, Exit), built by `camera-bar.js`'s `build()`, in upstream's style. The touch line is left out. The joystick `#fp-joy` is built and stays hidden: upstream's `setup()` wires it. The style also carries the pool table's score (`.bil-hud`, which `people/billiards.js` shows while you play) and `places.css`'s two `.is-fp` rules, which hide the team chips and the place chips while walking.                                                                                                                                                 |

### E on things

| Thing    | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A prop   | Upstream's `activateProp`: what a click on it does today (fish, arcade, coffee machine, the bell, the boards, the wall screen, the library).                                                                                                                                                                                                                                                                                                                                 |
| A game   | Upstream's: the games TV, pool, foosball and karaoke seat you; E or Escape stands you up.                                                                                                                                                                                                                                                                                                                                                                                    |
| The cat  | Upstream's `petCat`.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| A person | Opens that agent's session beside the floor, as the agent card's "Open session" does. A third `// PASEO:` change in `first-person.js`'s `interact()` passes `{ open: true }` to `openSession`, for a person and for a sub-agent's parent. `openSession` in the stand-in drawer gains `opts.open`: it calls `host.open(id)`, a new hook. The world API gains `onOpen(agentId)`, and `office-surface.tsx` calls the same handler as the card's Open session. Walk-in stays on. |

## Components

- `vendor/my-office/src/office/interact/first-person.js`: upstream's, with three `// PASEO:` changes:
  the street cut, `floorBounds` (which `camera-bar.js` imports), and `{ open: true }` for E on a person.
- `vendor/my-office/src/office/life/seasons.js`: `floorBlocks`.
- `vendor/my-office/src/office/ui/camera-bar.js`: the button, the overlay's markup and style, the
  pointer rule, the field-of-view zoom, leaving walk-in on a view, Escape, and the narrow rules.
- `vendor/my-office/src/office/ui/whiteboard.js` (a stand-in): the picking aims through `fpCam` while
  walking, as upstream's.
- `client/world/world-frame.web.ts`: no hand-back of the keyboard to Paseo's page while walking.
- `vendor/my-office/src/office/ui/session-drawer.js`: `opts.open` calls `host.open`.
- `vendor/my-office/src/office/paseo-host.js` and `paseo-entry.js`: `open: null`, set from
  `options.onOpen`.
- `client/world/world-api.ts`, `client/office-surface.tsx`: `onOpen`.
- `vendor/my-office/import-upstream.mjs`: `DENY` lets `interact/first-person.js` through; its run
  rewrites `MANIFEST.json` and `paseo-modules.js`.
- `vendor/SOURCES.md`: walk-in is taken, with its changes.

## Errors

- Pointer lock is not used, so there is nothing to refuse.
- A person who left while you stood by them: the hint clears on the next frame, as upstream.

## Not built

- The street, the lift trip and the shops.
- Walking on touch screens (upstream's joystick).

## Testing

Unit and bundle: `import-upstream --check` lists `interact/first-person.js` as kept with its note;
`world-script.test.ts` builds the entry with it; the bar has Walk in last, pressed while on, hidden
without a fine pointer; a view press and Photo mode leave walk-in; zoom while walking changes the
field of view within its limits; E by a person is pinned in three tests, because `entry.test.ts` stands
the whole scene in and cannot walk: `first-person.test.ts` walks and sees `openSession(id, { open: true })`,
`session-drawer.test.ts` sees `host.open(id)`, and `entry.test.ts` sees `onOpen(id)`. `entry.test.ts`
also sees the frame keep the keyboard on a press while the scene's body is `is-fp`, and hand it back
otherwise; `whiteboard.test.ts` sees a press and a hover aim through `fpCam` while walking; and
`camera-bar.test.ts` pins the 720 px and 520 px rules. jsdom lays nothing out, so the bar's widths are
measured in the browser.

Browser, the scene alone with software WebGL as piece 2 did: walk the floor, third person, E at a
prop, the cat, a person and the games TV; Escape out; 1280 x 800.

Live, against the daemon: Walk in on the office screen and in the panel, and E on an agent opening
its session beside the floor.

## Not verified

The office panel in a workspace and Electron were not tried: the walk was seen in the app on the
office screen only.

The scene's own script was looked at alone first, as piece 2 did. It was bundled with the options the
app uses (IIFE, es2020, minified, 1.11 MB), served as a static page from the build container at its
network address (Paseo's browser runs in another container and cannot reach this one's `localhost`),
and opened in Paseo's browser at 1280 x 800 and 390 x 844 with a mouse. The browser drew with software
WebGL (llvmpipe), about five frames a second. One page runs the script in the page itself: `start`
with the `pro` plan, the app's light colours, and an `onSelect`, `onToast` and `onOpen` that record
their calls, then `setSessions` with five made-up agents. A second page opens the script in a frame
with the app's own `world-frame.web.ts`, its `onOpen` and `onSelect` calling `focusApp()` first, as
`world-view.tsx` does. To go from one spot to the next, a second entry imported the scene's modules
once more and set the walker's position; the scene's code was the same. For the check after the
fixes below it also read what a pixel lands on through either camera. Keys and the mouse were real
input: the browser tool's key presses, and Chrome DevTools Protocol input for held keys, Shift and
drags. No page error came up in the page itself.

The app was then reached through a dev daemon of this worktree on port 6768, with its own home under
`/tmp`, listening on the build container's address with a password of its own, and serving the
installed 0.16.0 web build (`PASEO_WEB_UI_DIST_DIR`). The office's client code and the scene came from
this worktree. Three agents ran on the `mock` provider; that needs the design plugin off
(`FIGCRAFT_URL` unset), because it gives every interactive agent an MCP server, which the mock
provider refuses. The daemon was stopped and its home deleted afterwards.

What the scene alone showed:

- Walk in is last on the bar, in the app's accent; pressed, it turns to upstream's outlined orange.
  The overlay comes up (the help line, Exit, the crosshair), the team chips go, and the views and the
  zoom dim, as upstream. You stand inside the lobby door, facing the floor.
- W, A, S and D move you along the expected axis; the up and down arrows walk and the side arrows
  turn. Shift with W runs at 3.6 m/s of scene time against 2.0. A mouse drag turns 0.0042 rad a pixel,
  upstream's mouse speed.
- V shows your own chibi from behind with its "You" tag; V again goes back and hides both.
- Zoom in goes 70, 62, 54, 46 and 40 degrees (113% to 175%) and stops; zoom out goes to 90 (78%) and
  stops. Desks pressed while walking left the walk and flew to the desks, Desks pressed.
- E at the coffee machine: steam, and the Coffee corner card opens. At the arcade: the toast "The
  minigame is being built, it'll be playable soon." and the Lounge card. At the cat: hearts and
  "meow~".
- E by an awake person ("See what Ada is doing"): one `onOpen` with Ada's id, no `onSelect`, and the
  walk stays on. A click on the hint does the same. By a sleeping person ("Wake Di up"): they wake,
  and nothing opens.
- E at the games TV seats you on the sofa: the game's menu on the TV, the help line and the hint
  hidden, the field of view at 44. Escape stands you up ("Controller down") and the walk stays on.
  Seated again, E stands you up the same way.
- With the Coffee corner card open while walking, the first Escape closes the card and the second
  leaves the walk.
- Escape and Exit leave the walk; after Escape the camera is back at Overview, 100%. Photo mode while
  walking leaves the walk.
- With touch emulated at 390 x 844, `(pointer: fine)` stops matching, the button goes at once and the
  bar fits; without the emulation it comes back.
- In the page itself, W, V and E typed into a text field went into the field, and the walk did not
  move.

What the app showed, on the office screen at 1280 x 800:

- A click on Walk in starts the walk with the keyboard in the frame, and W walks.
- E by a person opens their session beside the floor, and the walk stays on. The keyboard goes to
  Paseo's page.
- The List view ends the walk: the frame is gone, and back in 3D a new frame starts without walking.
- With touch emulated, the button goes, and it comes back without the emulation.

Found in that check and fixed afterwards. Each was seen again with the same two pages and the
scene bundled afresh:

- A press on the floor while walking took the keyboard out of the frame. On a `pointerup` that leaves
  the frame's body focused, `world-frame.web.ts` gave the keyboard to Paseo's page, and a drag to look
  and a click on the floor both do that. In the app, after the first look around, W went to Paseo's
  page and the walker stood still, and after E by a person a click on the floor did not give the keys
  back. The frame now skips that hand-back while the scene's body is `is-fp`. In the frame page, with
  real input: after a drag to look, and after a click on the floor, the keyboard stayed in the frame
  and W walked. E by Ada called `onOpen` once and gave the keyboard to Paseo's page (W went there and
  the walker stood still); a click on the floor then gave it back, and W walked. After Exit, a click
  on the floor still gives the keyboard to Paseo's page. With the frame as it was before the fix, the
  same steps lost the keys at the drag. The fix was not seen again in the app.
- While walking, a click or a hover acted on what lies under the pointer in the hidden overview: the
  stand-in `ui/whiteboard.js` aimed from `camera`. It now aims from `fpCam` while walking, as
  upstream's does. Facing the coffee counter, at the two points of the first check, the overview's
  camera lands on Bo and on the aquarium, and the walk's on the counter both times. A real click
  there brewed a cup and opened the Coffee corner card, with no `onSelect`, and the walk stayed on; a
  real hover showed the counter's tip ("Dining room"). Out of the walk, a click on Ada still chose
  her. That click was not made in the app.
- At 390 px with a mouse, Walk in ran past the bar's end and was cut at the frame's edge (the button
  at 385 to 423 px), and at 530 px, with the names out, it reached 552 px. With the narrow rules (The
  button, Narrow), measured with a mouse away from the bar, the last control ends at 376 px at 390
  (also while walking), 411 at 460, 469 at 530, 506 at 600 and 564 at 720, whichever view is pressed,
  and at 910 and 925 px at 1280 with Overview and Meeting room pressed. At 530 and 600 px, with the
  mouse on a view's button or a view focused with Tab, the name stays hidden and Walk in ends at 471
  and 506 px at most; at 1280 px a hovered view's name still slides out. All nine controls show, and
  the page never scrolls sideways.

What did not come out as written:

- At 390 px the help line is a column 203 px wide and 296 px tall over the view: `left: 50%` with a
  transform caps its width at half the frame. Upstream's rule is the same.

Pool, foosball and karaoke were not tried, only the games TV; nor were a sub-agent's E, a person
leaving while you stand by them, or dark colours. In the app, touch was emulated at 1280 x 800, not at
a phone's size, and the app was the installed 0.16.0 web build, not this branch's.
