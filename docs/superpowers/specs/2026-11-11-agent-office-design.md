# Agent Office design

Date: 2026-11-11. Fork: allrested/paseo. Status: approved by the user on 2026-11-11 ("Plan and build").

## Goal

One place to see every agent on a host, what each is doing, and how agents hand work to each
other. The user can act on an agent from it. Agents coordinate through boards they read and write.
It is drawn as a small 3D office, with a low-memory structure view for when 3D is off.

The owner uses Paseo mostly as the web UI in a phone browser and a tablet browser. Touch web is the
first target for every decision here.

## Decisions

| Subject     | Decision                                                                                                                                            | Source                                        |
| ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| Renderer    | three.js, in the web UI on phone, tablet and desktop. No Rust, no WASM.                                                                             | user, 2026-11-10                              |
| 3D switch   | A switch in the office turns 3D on or off, remembered per device. Off shows the structure view and never loads three.js.                            | user, 2026-11-11                              |
| Role        | Watch, act, and agents coordinate in it.                                                                                                            | user, 2026-11-11                              |
| Scope       | The agents of the connected host. One room per workspace.                                                                                           | user, 2026-11-11                              |
| Places      | A screen opened from the sidebar, and a workspace tab.                                                                                              | user, 2026-11-11                              |
| Boards      | One board per workspace room, plus one lobby board for the host. A post may name any agent on the host.                                             | user, 2026-11-11                              |
| Posts       | Tasks (open, claimed, done) and notes.                                                                                                              | user, 2026-11-11                              |
| Wake        | A post that names an agent is delivered to it as a prompt when it is idle. Posts without a name wake nobody.                                        | user, 2026-11-11                              |
| Wake limits | At most 6 wakes per agent per hour, and a switch that pauses every wake.                                                                            | user, 2026-11-11                              |
| 3D default  | On. A device without WebGL gets the structure view.                                                                                                 | user, 2026-11-11                              |
| Look        | A scale model of a small studio, seen from a three-quarter angle; small robots. Direction below, approved from screenshots with fake data.          | user: "surprise me", then approved 2026-11-11 |
| Packaging   | A built-in plugin, `office`, so every instance has it. three.js is vendored in the plugin and fetched on first use.                                 | earlier decision                              |
| Native app  | Structure view only. Plugins cannot draw WebGL on native, and the owner does not use the native app.                                                | this spec                                     |
| Core change | One: `cancel()` on the plugin SDK's agent handle (`packages/client/src/index.ts`, next to `send`), calling the existing `DaemonClient.cancelAgent`. | this spec                                     |

## What the user sees

### 3D view

The look follows one direction, approved by the user on 2026-11-11 after the first render:

- Character: calm, watchful, a little playful.
- World: an architect's scale model of a small studio, the kind that sits on a desk. Matte card
  and painted wood, nothing glossy. In the dark theme it is the model at night, lit only by what
  happens in it; in the light theme it is the same model by day.
- Two moments carry the colour and the light, and everything else stays quiet: a working robot's
  screen lights its desk while an idle desk is dark, and the agent that waits for the user is the
  one warm spot on the screen.
- Signature: one lamp on each robot with four states (off, steady, amber, red). The state dot in
  the structure view and the attention strip is the same lamp.
- Every part of a robot carries information: the pose is the state, the visor is the provider,
  the screen is the activity.
- The camera looks from a three-quarter angle. A room is only as big as its agents need, and the
  first view fills a phone screen.

- A floor with one glass-walled room per workspace, labelled with the workspace name, laid out in a
  grid. The lobby sits in the middle and holds the host-wide board.
- One robot per agent, at a desk. The visor takes the provider's colour. An agent created by another
  agent sits at a side desk next to its parent.
- State is shown by pose and by the robot's lamp:

| Agent state      | Robot                              |
| ---------------- | ---------------------------------- |
| running          | typing, screen lit                 |
| idle             | leaning back, screen dim           |
| needs permission | standing, hand raised, amber light |
| error            | slumped, red light                 |
| initializing     | walking in from the door           |
| closed           | not shown                          |

- A task is a sticky note on the room's whiteboard. A claimed task's note sits on the desk of the
  agent that claimed it. A done task's note fades and is removed.
- A post that names an agent flies as a paper plane from the poster (or from the board, when the
  user posted it) to that agent.
- Camera: fixed angle, drag to pan, pinch or wheel to zoom, tap a room label to centre it. Opened as
  a workspace tab, the camera starts on that workspace's room.
- A strip above the scene lists the agents that need the user (pending permission, error). Tapping
  an entry moves the camera to that robot and opens its card. On a phone this strip is the fast
  path; the scene is the overview.

### Structure view (3D off)

The same model as a 2D list, built from plain app components:

- One card per room: workspace name, then its agents as rows. A child agent is indented under its
  parent.
- Each row: state dot, title, provider and model, and a one-line "doing now" text for a running
  agent. A pending permission shows Approve and Deny on the row.
- Under the agents, the room's board: open tasks, claimed tasks with the claimer's name, notes. A
  post that names an agent shows "from → to".
- The lobby board is the first card.

The structure view is also what the native app shows, and what a device without WebGL or one that
lost its WebGL context shows.

### Acting

Tapping a robot or a row opens the agent card:

- Open session (`navigation.openAgent`).
- Send a prompt (`agent.send`).
- Approve or deny a pending permission (`agent.respondToPermission`).
- Stop the running turn (`agent.cancel`, the core change).

The board sheet lets the user post a task or a note to a room or the lobby, optionally naming an
agent, and mark a task done or delete a post.

## How agents coordinate

### Tools

Every interactive agent session on the host gets three tools through the `agent.open.before` hook
(`defineAgentTool`). Descriptions are kept short, because every session pays for them.

| Tool            | Input                                                       | Result                                                                                    |
| --------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `office_read`   | `board?` (`"room"` default, `"lobby"`), `since?` (cursor)   | Up to 30 posts as compact text, newest last, with a cursor for the next call.             |
| `office_post`   | `kind` (`task`, `note`), `text`, `to?` (agent id), `board?` | The post id. With `to`, the named agent is woken (see Wake).                              |
| `office_update` | `id`, `action` (`claim`, `done`, `reopen`)                  | The post's new state. Claiming a task claimed by another agent is refused, with its name. |

"room" is the board of the calling agent's workspace. An agent without a workspace reads and posts
to the lobby. Agents find each other's ids with the existing `list_agents` tool.

A setting turns the tools off for the whole host. The office then still shows agents and lets the
user post.

### Wake

- A post with `to` puts a delivery in the named agent's queue. `to` is resolved to the agent's full id
  first; a post that names an unknown agent is refused.
- A delivery is sent when the agent is idle: at once if it is idle now, otherwise from the
  `agent.turn.after` hook when its turn ends.
- Everything waiting for one agent from one author goes out as one prompt:
  `Office board: <n> post(s) for you.` followed by one line per post with its id, author and text.
  At most 30 posts go in one prompt; the rest stay queued.
- Posts written by an agent are delivered as a message from that agent, the same way the existing
  `send_agent_prompt` tool delivers one. Only the user's own posts arrive as a user prompt. Posts from
  several authors go out as one prompt per author, and each prompt counts as one wake.
- An agent is never woken by its own post. A closed or archived agent is not woken; the post stays
  on the board.
- Limit: 6 wakes per agent per rolling hour. Deliveries over the limit wait and go out with the
  next allowed wake. This stops two agents from answering each other without end.
- A switch in the office pauses every wake on the host. Posts still land on the board; queued
  deliveries go out when the switch is turned back on.
- A wake never answers a permission request and never changes an agent's mode.

### Cost

- Three tool definitions in every session.
- One turn of the named agent per wake, at most 6 per agent per hour.
- Reading a board costs what the 30 posts cost; `since` keeps repeat reads small.
- Nothing is added to a turn that does not use the board.

## Components

Built-in plugin at `plugins/office/`, registered in
`packages/server/src/server/plugins/builtin/index.ts` like `resource-manager`.

### Server (`plugins/office/server/`)

| File               | Responsibility                                                                                                                                              |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paths.ts`         | `$PASEO_HOME/office/`.                                                                                                                                      |
| `board-store.ts`   | Loads and saves `boards.json`. One writer at a time, write to a temp file then rename. A file that does not parse is moved aside and an empty store starts. |
| `board-service.ts` | Post, claim, done, reopen, delete. Validation and limits. Emits change events.                                                                              |
| `mention-queue.ts` | Deliveries per agent, the hourly limit, the pause switch, batching. Sends through `paseo.agents.ref(id).send`. Clock injected for tests.                    |
| `agent-tools.ts`   | The three tools.                                                                                                                                            |
| `activity.ts`      | The "doing now" line of each running agent, from the tail of its timeline. Runs only while an office subscription is open, at most once per 5 s per agent.  |
| `index.server.ts`  | Hooks (`agent.open.before`, `agent.turn.after`, `agent.close.after`, `workspace.archive.after`), RPCs, the state subscription, settings.                    |

Wire contract (`contracts.ts`, shared with the client):

- Subscription `office.state`: a snapshot, then changes: boards, activity lines, wake state
  (paused, queued count per agent).
- RPCs: `office.post`, `office.update`, `office.delete`, `office.setWakesPaused`.
- RPC `office.asset`: returns the vendored three.js build as bytes.

Limits: post text 2,000 characters; 200 posts per board, the oldest done tasks and notes dropped
first; done tasks removed after 7 days; a board whose workspace was archived is removed.

Post shape: `id`, `board` (workspace id or `lobby`), `kind`, `text`, `author` (agent id or `user`),
`to?`, `state` (`open`, `claimed`, `done`; notes have none), `claimedBy?`, `createdAt`, `updatedAt`.

### Client (`plugins/office/client/`)

| File                 | Responsibility                                                                                                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.client.tsx`   | Registers one surface as a screen (`addScreen` + `addSidebarHeaderItem`), as a workspace panel (`addWorkspacePanel`), and a Command Center item that opens the panel.         |
| `model.ts`           | Pure. Builds the office model from agents, workspaces, pending permissions, boards and activity: rooms, agents with parent and children, the attention list.                  |
| `layout.ts`          | Pure. Room grid and desk positions, stable for the same ids so robots do not jump when another agent starts. 24 desks drawn per room, the rest as "+N".                       |
| `office-surface.tsx` | Header (3D switch, wake switch, attention strip), then the 3D view or the structure view.                                                                                     |
| `structure-view.tsx` | The 2D view.                                                                                                                                                                  |
| `agent-card.tsx`     | The actions.                                                                                                                                                                  |
| `board-sheet.tsx`    | Posting and task changes.                                                                                                                                                     |
| `device-settings.ts` | The 3D switch, per device (browser storage on web).                                                                                                                           |
| `scene/*.web.ts`     | Web only. Loads three.js through `office.asset` on first use and keeps it; builds and updates the scene from model changes; instanced robots; camera; picking; the draw loop. |

Agent data comes from the SDK's live `useAgents` and `useWorkspaces`, and pending permissions from
`paseo.agents.list({ subscribe })`.

## Performance

- three.js is not in the plugin's client bundle. It is fetched and evaluated the first time 3D is
  shown on a device, so app start and the structure view pay nothing for it.
- One canvas. Robots, desks and notes are instanced. No shadows; a flat blob under each robot.
- Pixel ratio capped at 1.5 on a touch device and 2 elsewhere.
- Draw on demand: a frame is drawn only while something animates or the camera moves. A quiet
  office draws nothing.
- The loop stops when the screen or tab is hidden, and everything is disposed on unmount.
- A lost WebGL context switches to the structure view, with a button to try 3D again.
- `prefers-reduced-motion` turns off walking and planes; states still change.

## Safety

- The plugin's server code runs inside the daemon process. Every hook, handler, timer and store
  write catches its errors and logs them; a broken board file cannot stop the daemon.
- A plugin loads only for a client with `daemon.manage`, as today.
- Board text from an agent reaches another agent as a message from that agent, never as a user
  prompt. Agents can already prompt each other with `send_agent_prompt`, so this adds no new reach;
  the delivered text names its author. A provider set up without `send_agent_prompt` needs
  `office_post` turned off as well.
- Text and counts are bounded as listed under Limits.

## Tests

- Unit: board store (corrupt file, concurrent writes), board service (limits, claim rules), mention
  queue with a fake clock (batching, limit, pause, own post, closed agent), tools, `model.ts`,
  `layout.ts` (stability, overflow).
- By hand in a touch-sized browser: structure view with live agents, each action on the card,
  posting and claiming, a wake arriving at an idle agent and at a running one, the limit, the pause
  switch, 3D on and off, a hidden tab drawing nothing.
- The screenshot gate: the scene with fake data, shown to the user before live data is wired in.

## Order of work

1. Model, structure view, actions, both places. Useful on its own.
2. Scene with fake data, then the screenshot for the user, then live data.
3. Boards, tools, wake, and how they show in both views.

## Not in this version

Several hosts on one floor, 3D in the native app, custom avatars, robots walking between rooms,
sound, agents posting files.
