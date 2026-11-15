# The office's QA: design

Date: 2026-11-16. Status: built. Sub-project 8 of
[the office as my-office's 3D floor](2026-11-16-office-my-office-port-design.md), which has the
request, the owner's answers and the list of sub-projects.

## Request

From Hermes3D's list: "Monitor QA pipelines and logs without leaving the workspace."

## What was there

Hermes3D has a QA lab on its floor: an agent whose messages say it is testing is held there, and
a panel shows that hold. It reads no pipeline and no log.

Paseo has both. The workspace descriptor carries the checks of the workspace's pull request one
by one: name, status, the run's address, its workflow and how long it took. It carries the
workspace's scripts and services from the project's configuration: whether each runs, a
service's health and port, how the last run ended, and the terminal it runs in. The SDK reads a
terminal's rows. The office already reads when an agent is at a test run and how the run ended;
the 3D floor's test board and the 2D racks show it.

## Decisions

| Question                | Decision                                                                                                                                                                                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What a pipeline is      | The checks of a workspace's open or draft pull request. A merged or closed one has none to watch.                                                                                                                                                                         |
| Which checks are listed | The ones that fail, then the ones that run. The rest are counted in one line: "#128: 1 fail, 1 running, 3 pass, 1 skipped". A list of thirty green checks tells nothing.                                                                                                  |
| How many are carried    | At most 40 per pull request, the failing and the running first, so a cut list keeps what the card lists. With more than 40 the count of the passing ones is short.                                                                                                        |
| A check's log           | On the forge: a link opens the run's page. No SDK call fetches it.                                                                                                                                                                                                        |
| Test runs               | An agent whose step is a test run, from the step the office reads every 5 s: running, passed or failed. It is there only while the agent is at that step. Nothing is remembered.                                                                                          |
| What "logs" are         | The output of the workspace's scripts and services: the dev server, the test watcher, a build. It is what a workspace has that is a log.                                                                                                                                  |
| Reading a log           | On a press, `office.script.log.request` with the workspace and the script's name. The server finds the terminal in its own directory, so a client never names a terminal.                                                                                                 |
| How much of it          | The newest 40 lines with something on them. A line is a row of the terminal, so a line wider than the terminal is more than one. The server asks for the last 400 rows: the last rows of a terminal are the empty end of its screen, as a probe on the dev daemon showed. |
| Long lines              | Cut at 400 characters. The card wraps a line; it never scrolls sideways.                                                                                                                                                                                                  |
| Freshness               | A log is a reading with its time over it. "Refresh log" reads again. It does not stream: an open card would hold a terminal subscription per script.                                                                                                                      |
| What is kept            | Nothing. A log goes from the terminal to the card that asked. No agent tool reads one, and the office's state stream does not carry one.                                                                                                                                  |
| What is in trouble      | A failing check, a failed test run, a service that is unhealthy, a script whose last run ended with an error. They are in the warning tone and are what the strip counts.                                                                                                 |
| Where it shows          | A QA entry after Reviews in the attention strip, while a workspace has checks, a test run or a script: the number failing in the warning tone, else the number running, else "Nothing fails".                                                                             |

## Components

- `shared/contracts.ts`: `runs` on the pull request, `scripts` on the workspace,
  `office.script.log.request`.
- `server/directory.ts`: `projectWorkspace` reads the descriptor's `checks` and `scripts`.
- `server/script-log.ts`: `readScriptLog` over three ports (the script, the terminal's tail, the
  clock) and `logTail`, pure. `server/hub.ts` has `script(workspaceId, name)`, the directory's
  last report; `server/live-ports.ts` has the ports on the daemon's API.
- `client/qa-text.ts`: the teams, what is listed and counted, the strip's note and the card's
  words. `client/qa-card.tsx`: the card. `client/use-qa.ts` and `client/use-script-log.ts`: its
  state and its call.

## Errors

- A script the directory does not know is refused: "This host does not know the script". So is
  any script while no office is open, when the server has no directory.
- A script that never ran has no terminal and no "Show log" button. The server refuses it too.
- A terminal that cannot be read rejects the call; the failure shows under the script's buttons.

## Not built

- A check's log in the office, and running a check again.
- Starting, stopping or restarting a script from the office: the app's workspace has that.
- A streaming log, and searching one.
- Terminals that are not a script's.
- A history of test runs.
- Anything new on the floor: the test board and the racks already show a test run.

## Testing

Unit tests: the projection of checks and scripts and its cut at 40; `logTail` and
`readScriptLog` with every refusal; the hub's `script`; the call through the plugin entry; the
card's teams, counts, script lines, the strip's note and the line over a log.

Live, with fixtures in front of a dev daemon and no agent created: the entry and the card at
390 px (light) and 1280 px (dark); the refusal from the real daemon, which has no such script,
under the script's buttons; a log of 16 lines with a long one, written into the answer by the
test proxy, wrapped with no sideways scroll; "Refresh log" and "Hide log"; a test run that
started and failed; a check that turned green and left the list; Tab through the card.

On the dev daemon itself: a terminal was created with the CLI, three lines were printed in it,
and a capture of its last six rows gave six empty rows of 24. The terminal was then killed.

A log end to end, with no fixture between: a script was added to the dev daemon's project and
started with the CLI. The real projection carried it with its terminal, and "Show log" in the
card showed that terminal's rows. A line is a row of the terminal, so the command, wrapped at 80
columns, was two of the six. The first reading said "The terminal has 18 more above" over a log
of six lines: the empty rows under the output were counted as rows above it. The count now adds
the rows above the reading to the lines `logTail` left out, and two tests hold it, one for a
screen that is mostly empty and one for a long log. Read again, the card said "6 lines". The
script was stopped and its entry removed from the project afterwards.

## Not verified

- A service's log, and a log longer than the 400 rows the server asks for: the script read was a
  one-line command.
- Checks from a real forge.
- The installed app on a phone or a tablet.
