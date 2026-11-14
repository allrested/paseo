# Office in the installed app, animated on the phone: design

Date: 2026-11-14. Fork: allrested/paseo. Status: draft, waiting for the user's approval.
Builds on [the streamed 3D view](2026-11-13-office-streamed-3d-design.md).

## Goal

The office in the installed app moves smoothly: robots type and wave without stutter, and
panning and zooming follow the finger.

The streamed view sends a whole picture for every frame. After the 2026-11-14 fix the host makes
about 12 a second, which a phone link then thins out, and each pan step is a round trip to the
host. The user saw it on the phone on 2026-11-14 ("working but not smooth, the agent did not seem
animated") and chose to have the phone do the moving, in the store app, on Android and iPhone.

## Decisions

| Subject    | Decision                                                                                                                        | Source                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| Approach   | The host draws the still parts and each robot once, as pictures; the app places and animates them itself.                       | user picked 2, 2026-11-14 |
| Look       | The pictures come from the same three.js scene, at its three-quarter camera, so the office looks as it does on the web.         | this spec                 |
| Truth      | The host says where everything is. The app does not lay the office out again: two layouts could seat a robot at two desks.      | this spec                 |
| Motion     | Robots animate on the phone from picture strips. Pan, pinch zoom and "go to this robot" move the composed picture on the phone. | this spec                 |
| Clients    | The installed app, and a browser without WebGL2. A browser with WebGL2 keeps drawing locally.                                   | follows the streamed spec |
| Old stream | The picture stream stays until the user has seen this view on the phone, then it is removed in a follow-up.                     | this spec                 |

## Approaches

- **A. Pictures of the parts, moved on the phone.** Picked. Smooth motion and gestures at the
  phone's own frame rate, little data (pictures are sent once and kept), same look as the web.
  The cost is new drawing code on both sides and some loss at the edges: a robot is a flat picture,
  so it cannot turn its body while it walks in.
- **B. A faster picture stream.** Shipped on 2026-11-14 as the first step. It cannot pass about 12
  pictures a second, and panning stays a round trip.
- **C. Draw the office from plain views, with no pictures from the host.** No host cost at all,
  but it is a second look to design and keep in step with the 3D scene. Rejected.
- **D. The fork's own Android APK with real 3D.** The user wants it after this one. It does not
  help the store app or an iPhone.

## What the user sees

The same office as on the web, in the app's theme. Robots at work type; a robot that starts to
wait waves once; a robot with an error slumps; lamps and lit screens show as on the web. A drag
pans and a pinch zooms, both at once with the fingers. A tap on a robot opens its card, a tap on a
board or a note opens the board sheet, and a tap in the attention strip glides to that robot.

Differences from the web view, accepted for this version:

- A robot that joins appears at its desk with a short fade; it does not walk in from the door.
- A paper plane flies in a straight arc between two points on the picture.
- Zoom has a limit: past about twice the starting size the picture goes soft.

```
┌──────────────────────────────┐
│ Office            3D [ on ]  │
├──────────────────────────────┤
│  backdrop picture (rooms,    │  one still picture
│  desks, boards, labels)      │
│    + one picture per robot,  │  each cycling its own strip of frames
│      back to front           │
│    + front walls on top      │  a picture with see-through parts
└──────────────────────────────┘
        pan / pinch move all three together
```

## How it works

```
host (render page)                         app (plugin client)
  backdrop     JPEG, rooms without robots ──▶ Image, kept
  overlay      PNG, front walls only      ──▶ Image on top, kept
  sprite(key)  PNG strip per robot kind   ──▶ kept by key, reused for every robot of that kind
  sheet        JSON: where each robot,    ──▶ places the sprites, starts their loops,
               board and room is, in          answers taps
               backdrop pixels
```

### What the host draws

All three kinds of picture come from the render page, with the scene's own meshes, materials and
camera angle. The camera is orthographic, so a robot looks the same wherever it sits: one picture
of a robot serves every seat.

- **Backdrop.** The whole office, without robots, lit screens or planes: floors, the far walls
  (back and left), boards with their notes, every main desk with a dark screen. JPEG.
  - The viewer sends its size and pixel ratio, as for the stream. The host lays the office out for
    that size, so a phone gets the column count the web gives a phone.
  - Framing: the scene's first view for that viewer, at its scale and as wide as the viewer, and
    carried on downwards until the whole office is in it. A deep office is taller than the screen
    and the user pans it.
  - Sharpness: the viewer's pixel ratio, 2 at most, lowered until the picture has at most 4
    million pixels, but not below 1 picture pixel per screen point; an office so deep that it
    would then pass 12 million pixels is drawn below that. A viewer is at most 4096 points a
    side.
  - Sent as tiles of at most 1024 pixels a side. Android's image loader shrinks a picture over
    2048 pixels, which would blur it and move every robot off its desk.
  - A new backdrop and overlay are made when the rooms, their sizes or arrangement, a label, a
    note, the theme or the viewer's size changes. A robot's change never makes one.
- **Overlay.** What stands in front of robots, on a transparent ground, in the same tiles: the
  near walls (right and front) with their rails, the notes on desk fronts, and the room name
  plates, which the web draws over everything. PNG. Without it a robot would hide the wall in
  front of it. The camera stands to the front right, so a room's right and front walls are in
  front of everything in that room and its back and left walls behind; rooms are 3 units apart,
  further than a wall or a robot reaches on screen, so one room never covers another's robots.
- **Sprite.** A robot with its desk, lit or dark screen, glow and shadow, on a transparent
  ground, at the backdrop's scale. The camera is orthographic, so one picture serves every seat;
  it is laid over the backdrop's own desk, at most half a pixel off. The key is what changes its
  look: pose, visor colour, lamp state and colour, lit screen, a side desk (`side`, drawn with
  its own desk shadow, since the backdrop has no side desks), and for `idle` the side its head
  lies to. Real offices need a few dozen; the page keeps at most 200 and drops the oldest.
  - Frames lie in a grid, row by row, with no side over 2000 pixels. Frames too large for any
    such grid are drawn smaller, and the app stretches every picture to the sheet's frame.
  - `typing`: 24 frames, 86 ms each, looping: three strokes of the arms and one sway of the
    head, so the loop has no jump. Each robot starts at its own frame (`phase`), as on the web.
  - `raised`: 20 frames, 70 ms each: the wave, ending on the raised hand; played once and held.
  - `idle`, `slumped`: 1 frame. The walk from the door is not drawn: a `walking` robot is 1
    frame, seated upright at its desk, and the sheet marks it `joining`, which the app shows as
    a fade in.
- **Plane.** One small picture of a paper plane, key `plane`, for mentions.
- **Sheet.** Plain data in backdrop pixels, made by the render page from the plan it draws, so
  the two cannot disagree: the picture's size and its pixels per screen point; the sprite frame's
  size and where the chest is in it; robots in back-to-front order, each with its agent id,
  sprite key, the top-left corner of its frame, `phase`, `joining` and `fresh` (its pose began
  less than the wave's length ago, by the page's clock); for each room its board's rectangle and
  its name plate's; for each note on a desk its rectangle and room; for each mention its post id
  and two end points.

### Wire contract (`shared/contracts.ts`)

- Subscription `office.sheet`. Input: the viewer's size, pixel ratio and theme colours. Events:
  `{ type: "ready", sheetId }`;
  `{ type: "tile", version, index, x, y, width, height, jpeg, overlay }` for each tile of a new
  backdrop (`overlay` is null for a tile with nothing in front);
  `{ type: "sheet", sheet }` after every office change, naming the backdrop version and tile
  count it belongs to; the app shows a version once it has all its tiles;
  `{ type: "problem", message }`.
- RPC `office.sheet.sprite.request`: `{ sheetId, key }` → the picture and its grid, or null when
  the page does not know the key.
- RPC `office.sheet.input.request`: `{ sheetId, resize? }`; an empty call says the viewer is
  still there. The stream's limits apply here in the same way: two viewers
  at most on a host, the 30-second silence rule (the app calls every 10 seconds), a page per
  viewer that is closed when the viewer leaves.

The host needs a page only to draw. A viewer's page stays open while the viewer watches, because a
change in the office needs a new sheet at once and sometimes a new backdrop.

### The app

- `client/sheet/`: the view, built from `Image`, `View` and `Animated` only.
  - Three stacked layers inside one transformed container: backdrop, sprites in sheet order,
    overlay.
  - A sprite is a clipped box one frame wide holding the strip; the strip steps sideways one frame
    at a time on a native-driver loop, so it keeps its pace when the app's JS is busy.
  - A robot whose key changes swaps strips. A once-only strip (`raised`) plays when the robot's
    key changes to it, or when the robot arrives marked `fresh`; otherwise it shows its last
    frame. A sheet that repeats a robot's key replays nothing.
  - A mention the view has not seen before flies the plane picture from one end point to the other
    on a straight arc, once.
  - The view starts as the web's first view does: the far end of the office at the top, filling
    the width. Zoom out stops when the whole office fits; zoom in stops at twice the backdrop's
    own scale.
  - Pan and pinch change the container's transform on the phone. The limits keep some of the
    office on screen. A tap is tested against the sheet's rectangles, front to back.
  - Sprites are asked for once per key and kept for the life of the view.
- `office-surface.tsx`: where the stream view is shown today, the sheet view is shown instead.
  The 3D switch, the fallback banner and the structure view behave as they do now: a `problem`
  from the sheet shows the structure view under "Try 3D again", not the old stream.
- The stream's own files and handlers are left as they are for this release and no surface uses
  them. Going back is one line in `office-surface.tsx`. They are deleted after the phone check.

## Constraints

- The store app cannot be changed: React Native primitives only, and pictures arrive as base64.
- A picture is sent once. Nothing is sent per frame.
- The host stays the only place that lays the office out.
- Daemon-process code must not throw out of a handler or a timer.
- Memory on the phone: one backdrop, one overlay and a few dozen small strips. The backdrop's 4
  million pixels bound it.

## Goals, non-goals, anti-goals

Goals: smooth robots and smooth gestures in the store app; far less data than the stream; the web
view's look.

Non-goals: walking robots; robots turning; exact paper-plane paths; zoom past twice the starting
size; the fork's own APK (next); removing the picture stream (follow-up, after the phone check).

Anti-goals: a robot drawn at a desk the host did not give it; a sprite or backdrop sent again
when nothing changed; an office that looks different from the web's at a glance.

## Risks

- **Fidelity at the seams.** A robot picture laid over the backdrop must line up to the pixel with
  the desk beneath it, and the back-to-front order must be right where rows overlap. The build
  composes a preview on the host from the same layers and compares it with the real scene at the
  same framing before any client code is written. The bar: desk edges under a sprite line up
  within one pixel; every row of the fake office overlaps in the right order; no wall edge is
  missing in front of a robot; lamps and lit screens are there. If the bar cannot be met, the
  build stops and the pictures go to the user; the client is not built on a known defect.
- **The scene is one large file.** Drawing "everything but robots" and "one robot alone" needs
  the scene to offer its parts, which means reshaping `office-scene.web.ts` without changing what
  the web UI draws. The existing real-browser tests guard that.
- **The store app's behaviour cannot be tried here.** Many `Image`s, native-driver loops and
  pinch through the responder are standard React Native, but the first real run is on the user's
  phone.

## Tests

- Host: the sheet from a plan (pure): positions in backdrop pixels, order, rectangles; a sprite
  key from a robot plan; strips cached by key.
- Render page, by hand against this instance's Chromium: a backdrop, an overlay, a strip, and the
  composed preview saved as pictures and looked at beside the real scene.
- Sessions: with a fake page, as the stream's are tested: backdrop only when the still parts
  changed, a sheet after every change, limits, silence, close on leave.
- App: pure functions for hit testing, pan and pinch limits, frame stepping, and which strip a
  robot shows; one mounted test that a tap on a robot's rectangle selects it.

## Left to the builder

- File and function names, and how the scene is reshaped to offer its parts.
- How the strips are cached on the host and when they are dropped.
- The fade for a robot that joins or leaves.

## Order of work

1. The scene offers its parts; the render page draws a backdrop, an overlay and a strip; the
   composed preview is compared with the real scene.
2. The sheet and the wire contract; sessions.
3. The app's sheet view, gestures and taps.
4. Docs.
