# Editing a design on the phone: design

Approved by the owner on 2026-11-14. It reverses one line of
[the design mode spec](2026-11-13-design-mode-figcraft-design.md): the phone, and any view without
FigCraft's web editor, now edits as well as views and comments.

## Goal

On the phone, the user picks a layer in the design's picture and changes it: its text, its fill as
one of the project's colour tokens, its place and size, or duplicates or deletes it, with undo.

## The phone view

- A Comment / Edit switch above the picture. Comment works as before: a tap opens a comment there.
- In Edit, a tap asks the bridge for the layers under that spot. The front-most one is picked, the
  picture outlines it, and the Edit layer sheet opens.
- The sheet shows the layer's name, type and size, and lists the other layers under the spot to
  pick a deeper one. It edits:
  - Text, for a text layer: a field and Apply.
  - Fill: the token it is bound to, or its colour, then the project's `color/*` tokens; a tap binds
    the fill to that token.
  - Move (four arrows) and Size (W−, W+, H−, H+), by 1 or 10 px.
  - Duplicate and Delete.
  - Undo and Redo, on once the view has made an edit.
- After an edit, the sheet shows the layer as it now is, and the picture is redrawn without
  waiting for the 3 s poll.
- Not included: adding layers, picking several, dragging, fonts and text styles, auto layout.

## The bridge

- One RPC, `design.edit.request`, with an action: `pick` (a spot as 0..1 of the picture), `layer`
  (re-read one), `change` (text, fill token, move, resize, duplicate, delete), `undo` or `redo`.
- The bridge runs `collab.peers` first, so it changes the file as the others last left it, then
  one FigCraft command: `select.layersAt`, `get_node`, `node.set` (`fill: {$var: name}` for a
  token), `transform.nudge`, `transform.nudgeSize`, `edit.duplicate`, `edit.delete`, `edit.undo`,
  `edit.redo`.
- FigCraft 0.18.1 lists `select.layersAt` parent before child, with siblings front-most first,
  not front-most first overall as its docs say. The bridge puts the deepest first and keeps
  FigCraft's order among layers of one depth.
- Layer ids are the bridge's own. When the bridge has restarted since the pick, the sheet says the
  layer is gone and to tap it again.
- Undo and Redo are the bridge's own history. In the contract test, one member's undo leaves
  another member's edits alone. The bridge also places design_compare's pictures, so an Undo
  right after one of those takes it back.

## Tests

- Bridge and service tests against the fake FigCraft.
- A mounted test of the phone view: the switch, the pick, the sheet's edits.
- The real FigCraft contract test: the pick order, a token bound by name, nudge, and an undo that
  leaves another member's edit.
