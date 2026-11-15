# The 2D pixel office: design

Date: 2026-11-16. Status: built. Sub-project 4 of
[the office as my-office's 3D floor](2026-11-16-office-my-office-port-design.md), which has the
request, the owner's answers and the list of sub-projects.

## Request

"Switch to the 2D pixel office", which the request describes as "a Gather-style pixel-art view of
the same live agents for low-power machines (Settings → Office renderer, or the 2D button in the
office toolbar)". The owner chose it for the phone as well, in place of the pictures the host
drew.

## What was there

The 3D floor runs only in a browser with WebGL2. The installed app and a browser without WebGL2
got an office composed from pictures the host drew in its own Chromium (`office.sheet`), which
needed a Chromium with WebGL beside the daemon, drew the plugin's first robot scene and not the
floor of sub-project 1, and showed the list on every host without that Chromium. A per-device "3D
view" switch chose between a floor and the list.

## Decisions

| Question                  | Decision                                                                                                                                                                                                                                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What draws it             | Plain React Native views, one per rectangle of colour. Plugin code in the installed app has no canvas and no SVG, and an image scaled up is smoothed there. Views are sharp on every platform and need nothing from the host.                                                                                                |
| The pictures              | The plugin's own, written as grids of letters in `client/pixel/art.ts` and compiled to rectangles: a run of one colour is one view, and a run that repeats in the row below grows down. A person is about 27 views, a desk 14. Nothing is copied from my-office or Hermes3D.                                                 |
| Day and night             | Two sets of tones for the room and its furniture, chosen by the theme's surface as the 3D floor chooses. Shirts, hair and skin are the same in both; trousers and shoes change, since the day's would vanish on the night floor.                                                                                             |
| Size                      | One art pixel is a whole number of screen pixels: 2 on a phone, as many as keep the room about 340 art pixels wide on a wider surface, 4 at most. The room is as wide as the surface and scrolls down only.                                                                                                                  |
| Who has a desk            | 40 agents, the ones that need the user and the ones at work first, as on the 3D floor. A line under the room counts the rest. More desks would cost a phone thousands more views.                                                                                                                                            |
| Teams                     | A workspace with agents is a team under a plate with its name and count; a workspace tab's own team comes first. A workspace without agents has no plate: its board opens from the list.                                                                                                                                     |
| Places                    | The 3D floor's: the library for a read or a search, the racks for a command or a test run, the whiteboard for a plan or a subagent, the pad for a push or a deploy, the desk for an edit, a commit, a web call or another tool. A bubble over the head says which, and for a test run how it ended.                          |
| Who needs the user        | Stays at the desk with an amber question mark or a red exclamation mark and a screen in the same colour: the desk is where a tap opens the card.                                                                                                                                                                             |
| What is remembered        | Only the coffee break, 30 seconds away from the desk after a turn ends. Everything else follows from the agent's state, so an office opened in the middle of a turn shows everyone in place, and no event can be missed.                                                                                                     |
| Walking                   | Every aisle, the floor in front of the wall and the lounge are lines across the room, and one lane at the left joins them. A walk leaves its line for the lane and turns in again, so nobody walks through a desk and a person on the way can turn round where they are.                                                     |
| The rocket                | Lifts off when somebody starts a push or a deploy, and is back on its pad for the next one.                                                                                                                                                                                                                                  |
| The host                  | The racks open the Host card and blink while somebody works. A bubble beside them says something was left running or memory is high. An agent with a port open has a small server on its desk.                                                                                                                               |
| Taps                      | A desk opens its agent's card; a team's plate and the whiteboard open a board; the racks open the Host card. Every one is at least 44 px on a touch screen. A person away from the desk can be tapped too, but is hidden from the keyboard and a screen reader, where the desk already names them and says what they are at. |
| Names                     | Under each desk, two lines at most, under a bar in the person's shirt colour: the bar says whose desk it is while its chair is empty.                                                                                                                                                                                        |
| Reduced motion            | Nobody walks, nobody takes a break, screens and lamps stand still and the rocket stays on its pad.                                                                                                                                                                                                                           |
| Choosing a view           | A segmented switch in the header, "3D", "2D" and "List", in place of the "3D view" switch. "3D" is offered only where the device can draw it. The choice is kept per device in `office-device` as `view`.                                                                                                                    |
| A device that never chose | 3D where it can draw it, else 2D. A setting saved by the old switch still counts: off is the list. A save writes `threeD` too, so a client from before `view` reads its switch as before.                                                                                                                                    |
| When 3D fails             | The 2D floor shows under the banner with "Try 3D again". It showed the list before.                                                                                                                                                                                                                                          |
| The host's pictures       | Removed: `office.sheet` and its two calls, the page that drew them, the robot scene it drew, the copy of three.js r170 it needed, and `render.available` in the office's state. The 3D floor has its own three.js in the vendored scene.                                                                                     |

## Components

- `client/pixel/sprite.ts`: a grid of letters to rectangles.
- `client/pixel/art.ts`: the pictures and the two sets of tones; `lookOf` gives an agent the same
  person on every device.
- `client/pixel/floor-plan.ts`: `planFloor`, pure: where everything stands for a width and a
  list of teams, and `routeBetween`, the corners of a walk.
- `client/pixel/actors.ts`: `standingOf`, where a person is from the agent's state; the breaks.
- `client/pixel/room.ts`: what never moves.
- `client/pixel/ticker.ts`: one frame count for legs, screens and lamps, running only while
  something listens.
- `client/pixel/sprite-view.tsx`, `client/pixel/pixel-office.tsx`: the views.
- `client/view-switch.tsx`: the switch. `client/office-surface.tsx` has the choice: what a device
  saved, what that means on the device, and the save against the device's store.
- `shared/settings.ts`: `view` beside `threeD`.

## Not built

- The daemon still hands built-ins `offscreenPages`. No built-in uses it now.
- A separate lamp for test runs: the bubble at the racks says how a run ended.
- A side view of a person: walking across the room uses the front view.

## Testing

Unit: `sprite.test.ts`, `floor-plan.test.ts` (nothing overlaps and nothing leaves the room at ten
widths), `actors.test.ts`, `ticker.test.ts`, and the view choice in `office-surface.test.ts`.

Live, in the dev daemon's web UI with fixtures and no agent created: 390 x 844 and 320 x 640 with
touch, 768 x 1024, 844 x 390, 1280 x 800, light and dark; with WebGL2 hidden (the office opens
in 2D and offers "2D" and "List") and with it (three choices, 3D first, the choice kept over a
reload); people walking to each place and back, a test run that ends, the rocket, a coffee
break, 47 agents, an empty office, reduced motion; a desk, a plate, the whiteboard, the racks
and a person away from the desk each opening what they should; Tab through the floor with a
visible focus ring and Enter opening a card.

## Not verified

- The installed app on a phone or a tablet, where the platform draws the same views and not a
  browser.
- How smoothly a phone scrolls a floor of 40 desks.
- Electron.
