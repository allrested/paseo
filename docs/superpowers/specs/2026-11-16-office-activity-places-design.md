# The office's places follow what an agent does: design

Date: 2026-11-16. Status: built. Sub-project 2 of
[the office as my-office's 3D floor](2026-11-16-office-my-office-port-design.md), which has the
request, the owner's answers and the list of sub-projects.

## Request

"It walks to the library to read files; it types at its desk while it edits; it goes to the server
room to run commands; it launches a rocket when you deploy."

## What the office knew before

A state per agent (running, idle, error, a pending permission) and a "doing now" line built from
the kind of the newest timeline item. The line names a tool, which is not enough to pick a place:
a shell call is a command, a test run, a commit, a push or a deploy, depending on what it runs.

## Decisions

| Question                 | Decision                                                                                                                                                                                                                                              |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the kind is made   | On the host, in the 5 s read the office already does. It reads the tool call's normalised detail, and for a shell call the command. Only the kind, the call's id and a test run's result leave the host: no file name, command, query or address.     |
| The kinds                | read, search, edit, write, command, web, tool, subagent, plan, test, commit, push, deploy. A tool the host has no detail for is placed by its name (a to-do tool is a plan, a task tool a subagent), else it is a tool.                               |
| A deploy                 | A push of a version tag or `--tags`, a package script named deploy or publish, a hosting tool's deploy, `kubectl apply`, `helm upgrade`, `terraform apply`, `terraspace up`, `docker push`, `gh release create`. A plain `git push` is a push.        |
| A step                   | The newest timeline item, when it is a tool call. An agent that writes or thinks is at no step. A new call id is a new step, so two reads in a row send two events.                                                                                   |
| Where a person goes      | Upstream's table: the library for a read or a search, the desk for an edit, a write or a commit, the server room for a command or a deploy, the globe for the web or another tool, the whiteboard for a plan or a subagent, the test board for tests. |
| The rocket               | A push and a deploy both launch it, as upstream does. A commit prints a page.                                                                                                                                                                         |
| A test run               | Told when it starts, which blinks its lamp on the test board, and when it ends: a zero exit code or a completed call is a pass, a non-zero exit code or a failed call is a fail. The board writes the time it ended beside the result.                |
| A test run that got away | An agent has often moved on by the next read. The host looks the run up again in the timeline's tail and reports its end for one read, before the step after it. A cancelled run, or one out of the tail, has no result: its lamp goes out.           |
| An agent that waits      | No step is sent while an agent waits for the user. The call it waits for is sent once it works again, because the approval is usually for that call.                                                                                                  |
| First sight              | What each agent is at is sent at once, so an office that was just opened shows it. Turn starts and ends are still not said of someone seen for the first time.                                                                                        |
| What the labels say      | The scene runs in upstream's streamer mode: "Read a file", "Run a command", "Deploying a new version". Paseo has no label to give, and a name over a person's head would show a file name on a shared screen.                                         |
| The place cards          | The library, the launch pad and the others list the last events and a count. Upstream's server keeps both; here the scene's entry keeps them from the moment the office opens, and the cards say "since the office opened", not "today".              |
| The launch pad's card    | No repository rows. Upstream lists each repository's branch and unpushed commits; a team here is a workspace and Paseo sends no repository state.                                                                                                     |

## Components

- `shared/names.ts`, `shared/contracts.ts`: `ActivityStep { kind, key, result? }`; the snapshot
  and the `activity` event carry `doing`, a step per running agent. The field is optional, so a
  client that predates it parses the same messages.
- `server/activity.ts`: `describeStep` (the kind and the key), `nextStep` (the look back for a
  test run's end), and the poller, which now reports when a line or a step changes.
- `server/hub.ts`: keeps `doing` beside `activity` and clears both when no surface is open.
- `client/model.ts`: a row has its agent's step; an agent that is not running has none.
- `client/world/adapter.ts`: `worldChanges(before, people)` returns the events to send and what
  the scene then knows. It is pure, so every rule above has a unit test.
- The scene's entry (`vendor/my-office/src/office/paseo-entry.js`): records each event for the
  place cards, turns streamer mode on, and handles `testend`.

## Limits

- A tool call that starts and ends between two reads is never seen. The reads are 5 s apart per
  agent, as before, and no faster: each is a timeline request to the daemon.
- A provider that numbers no tool calls gives the kind as the key, so two calls of the same kind
  in a row are one step.
- The scene moves people in simulated time, which upstream caps at a tenth of a second per frame.
  At a low frame rate people walk slowly in real time, and a bubble appears when its person
  arrives, so it can be late.

## Testing

- Unit: the kinds (`server/activity.test.ts`), the look back and the poller's reports, the hub's
  snapshot and events, the state reducer, the model's rows, and the adapter's events.
- Live, on the dev daemon with the office state swapped for fixtures: the events the app sends to
  the scene for a scripted run (a read, a search, the web, a test run that passes, fails and gets
  away, a stop, a command held back until its approval); a person at the library with "Read a
  file", at the test board with "All green!", the rocket after a deploy; the library's and the
  launch pad's cards with their events and counts; light and dark; no page error.

## Not verified

- A real graphics card. The private browser draws about 1.5 frames a second, so every walk seen
  took several times longer than it does at 60 frames a second.
- Real agents: the fixtures stand in for them. The kinds are tested against the shapes in
  `packages/protocol`, and no agent was started to produce them.
