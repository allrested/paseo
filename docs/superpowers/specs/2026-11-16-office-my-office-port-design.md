# The office as my-office's 3D floor: design

Date: 2026-11-16. Status: design chosen by the build. The owner picked the direction and the
scope in four answers and asked for every sub-project to be built before a review.

## Request

Make the 3D office look like [my-office](https://github.com/khanh020905/my-office): each session
a character at a desk who walks to the library to read, types while it edits, goes to the server
room to run commands and launches a rocket on a deploy, in an office that also looks after the
machine. Add what [Hermes3D](https://github.com/iamlukethedev/Hermes3D) lists: a 2D pixel office
for weak devices, standups, pull request review, QA pipelines and logs, a gym, a janitor.

## The owner's answers

| Question    | Answer                                                                                        |
| ----------- | --------------------------------------------------------------------------------------------- |
| The 3D look | Port my-office's three.js code (MIT, credit kept). Its panels, chat and server are not taken. |
| The world   | The office floor only: no street, no shops, no daily-life scenes.                             |
| The phone   | A 2D pixel office drawn by the phone, also the low-power view on web behind a 3D/2D switch.   |
| How to run  | Build every sub-project in order, one commit each, one question before anything is pushed.    |

## Sub-projects

1. The 3D look: my-office's floor, fed with Paseo's agents. This document.
2. Activity places: the library, the desk, the server room and the rocket follow what an agent does.
3. Server care: memory per session, forgotten dev servers, cleanup.
4. The 2D pixel office and the 3D/2D switch. It replaces the pictures the host draws for phones.
5. The janitor: reset a session and clean its context.
6. Standups with GitHub and Jira.
7. Pull request review.
8. QA pipelines and logs.
9. The gym: skills.

Each later sub-project gets its own spec.

## Sub-project 1

### Decisions

| Question                | Decision                                                                                                                                                                                                                                                      |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Copy or rebuild         | Copy upstream's scene files unchanged and put stand-ins at the paths of the parts not taken. A newer upstream is then one tool run and a short list to look at. A rebuild in the old instanced scene would not look like my-office.                           |
| Where it runs           | In an `<iframe srcdoc>`. The scene is one app per page: module state, a stylesheet for `html` and `body`, listeners on its window. Removing the frame ends it, which is what 3D off, a lost context and closing the surface need.                             |
| How the script arrives  | The daemon bundles the entry with `bundleBrowserScript` once per run and serves the text over `office.world.request`. The app's bundle does not grow, and a client always runs the scene its daemon has.                                                      |
| Who is a person         | An agent. A workspace is a team: its agents sit together, under a chip with the workspace's name. Agents without a workspace are the lobby's team.                                                                                                            |
| States                  | A pending permission is a raised hand and "Needs approval". Running is at work. Idle is resting. An agent that ended in an error has a red name tag.                                                                                                          |
| Changes                 | A turn that starts is a prompt carried to the desk. A turn that ends is reported to the director, then a rest. A new error is a failure. Reading, editing and commands are sub-project 2: they need the kind of the tool, which the office state lacks today. |
| More agents than desks  | The Company floor has 12 desks. Agents that need the user sit first, then the ones at work, then the resting ones; the rest are only in the list, and a line over the scene says how many.                                                                    |
| Selection               | A tap on a person opens Paseo's agent card and the view moves to them. Closing the card puts the view back.                                                                                                                                                   |
| Boards                  | A team's chip opens that workspace's board. The whiteboard opens the tab's board, else the chosen agent's, else the lobby's. The board itself stays Paseo's sheet.                                                                                            |
| Theme                   | The dark theme is the office by night. The backdrop is the app's surface colour. Labels use the theme's surface, border, text and status colours.                                                                                                             |
| Labels                  | Paseo's design language: one radius scale, no glow, nothing that moves by itself, line icons, no emoji. Upstream ends many lines in emoji; the English stand-in drops them.                                                                                   |
| The opening view        | The floor fitted to the frame, because the frame is a screen or a tab of any shape. A frame much taller than the floor fills its height and is moved with a finger.                                                                                           |
| Keyboard                | A press on the scene, and anything the scene opens in the app, returns focus to the app's window: keys pressed in a frame do not reach the app's shortcuts. Team chips and place chips are buttons with a focus ring.                                         |
| Things with nothing yet | The server racks, the wall screen and the server room's chip open the machine panel of sub-project 3. Until then they are furniture: no hand, no tap, no chip.                                                                                                |
| The phone and no WebGL2 | Unchanged: the pictures the host draws from the first scene. Sub-project 4 replaces them.                                                                                                                                                                     |

### Components

- `plugins/office/vendor/my-office/`: the scene, its three.js r160, the stand-ins, and Paseo's
  four files there (`paseo-entry.js`, `paseo-host.js`, `paseo-style.js`, `paseo-modules.js`).
  `import-upstream.mjs` copies a newer upstream. `plugins/office/vendor/SOURCES.md` has the detail.
- `server/world-script.ts`: builds the script on the first request and keeps it; a failed build is
  tried again.
- `shared/contracts.ts`: `office.world.request`. `office.asset.request` is gone with the scene it
  served.
- `client/world/world-api.ts`: the contract with the page, checked at run time by `isWorldApi`.
- `client/world/adapter.ts`: pure. The office model to people, board rows and events; which room's
  board a tap opens; day or night.
- `client/world/world-loader.ts`: the script, loaded once per page.
- `client/world/world-frame.web.ts`: the frame.
- `client/world/world-view.tsx`: the React side. It replaces `client/scene/scene-view.tsx`.

The first scene's files stay under `client/scene` for the host's pictures until sub-project 4.

### Errors

- The host cannot bundle (a directory plugin, no esbuild): the RPC fails with "This host cannot
  build the 3D office", and the surface shows its "Unable to show the 3D view" banner over the list.
- The script throws while it is evaluated, or sets no `PaseoOfficeWorld` of the expected version:
  the same banner, with the script's own message when there is one.
- The WebGL context is lost, or the scene throws later: the same banner. "Try 3D again" builds a
  new frame.
- A graphics card without acceleration: upstream's light mode (half the pixels, no shadows, no
  post effects).

### Testing

- Unit: the adapter (people, overflow order, board rows, events, board choice, day and night), the
  loader, the script cache, the contracts, the server entry's handler list.
- Build: `server/world-script.test.ts` bundles the real entry and checks it sets the API and
  needs nothing a browser lacks.
- Browser, with software WebGL: the frame module against the bundled scene (start, a tap on a
  person, a team chip by pointer and by keyboard, focus back to the page, dispose without a
  reported problem).
- Live, on the dev daemon with the office state swapped for fixtures by a WebSocket proxy, so no
  agent is created: light and dark at 1280, 768 and 390; the agent card from a tap and the view
  back after it closes; a team's board and the lobby's from the whiteboard; a place card; agents
  starting, stopping, failing, arriving and leaving; 15 agents on 12 desks; 3D off and on.

### Not verified

- A real graphics card: shadows, post effects, full resolution and frame rate. The private
  browser draws with SwiftShader, so every picture taken is upstream's light mode.
- The desktop app (Electron) and a phone's browser by hand.
