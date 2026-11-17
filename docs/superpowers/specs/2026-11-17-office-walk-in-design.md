# Walking in the office: design

Date: 2026-11-17. Status: designed. Piece 4 of sub-project 7 ("Upstream's controls") of
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
  V switches to third person, E or the hint button acts on the nearest thing, Escape or Exit leaves.
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

| Approach                                                                                             | Trade-off                                                                                                                      | Chosen |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------ |
| Upstream's `first-person.js` through `import-upstream.mjs`, the street cut by one `// PASEO:` change | Upstream's walking, keys, hint and games as they are; one marked change to compare on the next upstream.                       | Yes    |
| Keep the stand-in and write a smaller walk                                                           | Less code taken, but the games, the cat and the props' hints would need their hooks rewritten.                                 | No     |
| Take it with the street, and stand-ins for the city                                                  | Nothing to cut, but the street needs the backdrops and their shops, which Paseo does not take, so the lift would lead nowhere. | No     |

## Decisions

### The button

| Question | Decision                                                                                                                                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Where    | The camera bar's end, after Photo mode, in its own group: upstream's `btn-fp`, icon `walk`, `aria-label` and `title` "Walk in", `aria-pressed` while on. Built by the stand-in `camera-bar.js`'s `build()` with the rest of the bar. |
| Phones   | Shown only when `matchMedia('(pointer: fine)')` matches, and hidden when it stops matching. My call: upstream's walk needs keys; on touch it would only look around.                                                                 |
| Views    | A view press, Photo mode and the List (the office's view switch) leave walk-in first, as upstream.                                                                                                                                   |
| Zoom     | While walking, zoom in and out change `fpCam.fov` within 40 to 90 by 8, as upstream; the percent shows the field of view's zoom over 70.                                                                                             |

### Walking

| Question        | Decision                                                                                                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What is taken   | Upstream's `first-person.js`, copied by `import-upstream.mjs`: `DENY` lets `interact/first-person.js` through. It brings the English `fp` strings it names.                                                        |
| The street      | Cut in one `// PASEO:` change: `street()` returns null, so the door has no E action and `toStreet`, `toOffice`, the shops and the basket are never reached. The imports they need stay satisfied by the stand-ins. |
| Stand-ins       | `life/seasons.js` gains `export const floorBlocks = []`. `world/backdrops/index.js` keeps `THEMES` undefined, which `street()` already treats as no street.                                                        |
| Where you start | Upstream's: inside the lobby door, facing the floor.                                                                                                                                                               |
| Keys            | Upstream's: WASD or arrows, Shift to run, V third person, E act, Escape leave. Only while the frame has the keyboard. A text field outside the frame keeps its keys.                                               |
| Overlay         | Upstream's `FirstPersonHud` markup (crosshair, hint button, help line, Exit), built by `camera-bar.js`'s `build()`, in upstream's style. The touch line and joystick are left out.                                 |

### E on things

| Thing    | Decision                                                                                                                                                                                                                                                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A prop   | Upstream's `activateProp`: what a click on it does today (fish, arcade, coffee machine, the bell, the boards, the wall screen, the library).                                                                                                                                                                             |
| A game   | Upstream's: the games TV, pool, foosball and karaoke seat you; E or Escape stands you up.                                                                                                                                                                                                                                |
| The cat  | Upstream's `petCat`.                                                                                                                                                                                                                                                                                                     |
| A person | Opens that agent's session beside the floor, as the agent card's "Open session" does. `openSession` in the stand-in drawer gains `opts.open`: it calls `host.open(id)`, a new hook. The world API gains `onOpen(agentId)`, and `office-surface.tsx` calls the same handler as the card's Open session. Walk-in stays on. |

## Components

- `vendor/my-office/src/office/interact/first-person.js`: upstream's, with the one `// PASEO:` change.
  It keeps `floorBounds`, which `camera-bar.js` imports, as a second marked addition.
- `vendor/my-office/src/office/life/seasons.js`: `floorBlocks`.
- `vendor/my-office/src/office/ui/camera-bar.js`: the button, the overlay's markup and style, the
  pointer rule, the field-of-view zoom, leaving walk-in on a view.
- `vendor/my-office/src/office/ui/session-drawer.js`: `opts.open` calls `host.open`.
- `vendor/my-office/src/office/paseo-host.js` and `paseo-entry.js`: `open: null`, set from
  `options.onOpen`.
- `client/world/world-api.ts`, `client/office-surface.tsx`: `onOpen`.
- `vendor/my-office/import-upstream.mjs`: `DENY` lets `interact/first-person.js` through; its run
  rewrites `MANIFEST.json`, the English locale index and `paseo-modules.js`.
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
field of view within its limits; an entry test enters walk-in, walks, presses E by a person and sees
`onOpen` with its id.

Browser, the scene alone with software WebGL as piece 2 did: walk the floor, third person, E at a
prop, the cat, a person and the games TV; Escape out; 1280 x 800.

Live, against the daemon: Walk in on the office screen and in the panel, and E on an agent opening
its session beside the floor.
