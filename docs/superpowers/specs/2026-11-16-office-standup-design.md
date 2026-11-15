# The office's stand-up: design

Date: 2026-11-16. Status: built. Sub-project 6 of
[the office as my-office's 3D floor](2026-11-16-office-my-office-port-design.md), which has the
request, the owner's answers and the list of sub-projects.

## Request

From Hermes3D's list: "Run standups with agents connected to GitHub and Jira."

## What was there

Hermes3D's stand-up is a meeting with phases (scheduled, gathering, in progress, complete). It
has its own Jira settings and reads GitHub, builds a card per agent with tickets, commits and
blockers, and gives each speaker a set number of seconds. The vendored my-office scene has a
bell on its meeting table: a ring calls everyone free to the table, each says a line about what
they are on, and the meeting ends by itself. Nothing rang it.

Paseo already has the links Hermes3D configures. The `tasks` built-in keeps the ticket a
workspace was started on in the workspace's metadata, from GitHub issues, Jira or another
tracker. The workspace descriptor has the branch and the pull request of that branch with its
checks, its review decision and whether it can be merged, from whichever forge the host uses.
The office has a board per room, agents with tools to post on it, and wakes that deliver a post
to the agent it names.

## Decisions

| Question           | Decision                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What a stand-up is | A report, one block per room that has an agent: branch, ticket, pull request, blockers, and each agent with what it is at and what it last said. It is derived from the office's state every time it is shown. Nothing is stored and there is no meeting to start or end.                                                                                    |
| "Connected to"     | The office calls no tracker and no forge and holds no token. The ticket is the one the Tasks built-in keeps on the workspace (`tasks.key`, `tasks.url`). The branch and the pull request come from the workspace descriptor. Both arrive with the workspace list the hub already subscribes to.                                                              |
| What blocks a team | An agent that waits for the user's answer, an agent stopped on an error, and for an open or draft pull request: failing checks, requested changes, conflicts. A merged or closed request blocks nothing.                                                                                                                                                     |
| What an agent says | Its newest note on its room's board from the last 24 hours, on one line, cut at 240 characters. A task is not what an agent says.                                                                                                                                                                                                                            |
| Asking for updates | One note per idle agent on its room's board, naming the agent: "Stand-up: post a note on this board, three lines at most: what you did, what is next, and what blocks you." A wake needs a name and a post names one agent, so a team of three gets three notes.                                                                                             |
| Who is asked       | An idle agent without an open permission. An agent at work is left to it. One that waits for an answer or stopped on an error is a blocker and is reported as one.                                                                                                                                                                                           |
| Asking twice       | An agent is asked once per opening of the card, also when it is idle again after its answer. The count on the button is the agents not asked yet.                                                                                                                                                                                                            |
| Wakes off          | The button is off and the line under it says why: with "Wake agents" off a post would wait.                                                                                                                                                                                                                                                                  |
| Where it shows     | A Stand-up entry after Janitor in the attention strip, in all three views: the number of blockers in the warning tone, else the number of teams. It opens the Stand-up card.                                                                                                                                                                                 |
| The card           | A line with the totals, then "Ask N agents for an update" (the sheet's one accent button) and "Copy as text", then the teams with a hairline between them. A team: its name and project, a row with the branch and links to the ticket and the pull request, the pull request in a sentence, the board's open tasks, the blockers, the agents.               |
| Copy as text       | The same report as plain text, for a chat or a ticket. A link is its address there, on a line under what it belongs to.                                                                                                                                                                                                                                      |
| In the 3D office   | Opening the card rings upstream's bell with a stand-up's opening line. The meeting is upstream's: whoever the scene counts as free walks to the table, also one that waits for an answer, and says a line. Upstream's toast for "nobody is free" is not passed on: the card is open and says who is at work. A second opening during a meeting does nothing. |
| In the 2D office   | While the card is open, whoever rests stands at the whiteboard, from a coffee break too. Work, a question and an error keep their places. When the card closes they walk back.                                                                                                                                                                               |
| Reduced motion     | Nobody walks to the whiteboard.                                                                                                                                                                                                                                                                                                                              |

## Components

- `shared/contracts.ts`: `branch`, `ticket` and `pullRequest` on the office's workspace, all
  optional.
- `server/directory.ts`: `projectWorkspace` reads them from the descriptor. The ticket's keys are
  the Tasks built-in's, repeated here because a built-in cannot import another's files.
- `client/model.ts`: a room carries its workspace.
- `client/standup-text.ts`: the teams, the blockers, what an agent said, the strip's note, the
  card's words and the plain text.
- `client/standup-card.tsx`: the card. `client/attention-strip.tsx` has the Stand-up entry, and
  `client/office-surface.tsx` posts the requests through the board's own `office.post.request`.
- `client/pixel/actors.ts`: `standingOf` and `castOf` take whether a stand-up is on.
- `client/world/world-api.ts`: `meet()`, optional. The scene's entry calls upstream's
  `ringBell`; the wording stand-in has the opening line.

## Errors

- A post that fails stops the round. The failure shows under the buttons, and the agents reached
  before it stay asked.
- A copy that fails shows under the buttons too.
- The answer to a post says it is on the board. Whether its agent woke shows as the agent's
  state.

## Not built

- Hermes3D's timed round with one speaker's card at a time, a scheduled stand-up, and a record
  of past ones.
- Reading a tracker or a forge from the office: an issue's status or assignee, the day's commits.
- A check that an agent has the board tools. With "Agent tools" off when its session opened, an
  asked agent answers in its own chat.
- One post for a whole team: a post names one agent.
- The pull request's checks one by one, and a review of it from the office. They are the next
  two sub-projects.
- A way to open the stand-up from the floor. The bell and the whiteboard keep what they do.

## Testing

Unit tests: the projection of branch, ticket and pull request; the room's workspace in the model;
the teams, the blockers, the note of the last day, the strip's note, the button and the line
under it, the plain text; who stands at the whiteboard.

Live, with fixtures in front of a dev daemon and no agent created: the strip entry and the card
at 390 px (light) and 1280 px (light and dark); the request for an update as it left the page,
one post per idle agent, and the card after it; a refused post, with the agent before it kept as
asked; the copied text; a note arriving while the card is open; a pull request turning green; an
agent that came to rest; wakes off; 320 px; Tab through the card and Escape;
reduced motion; the list view; an empty office, which has no entry; people walking to the
whiteboard and back in 2D; the bell and "Meeting? Coming!" in 3D. The dev daemon's own two
workspaces, one linked to a Jira issue and one to a GitHub issue by the Tasks built-in, came
through the real projection with their branch and ticket.

## Not verified

- A pull request from a real forge: the dev daemon's workspaces had none, so its facts were
  tested on the projection's input and in fixtures.
- A real agent answering: the hard rule of this build is that no agent is created or prompted.
  The posts went to boards whose agents did not exist on the dev daemon.
- The 3D meeting to its end. The test browser draws about 1.5 frames a second; the bell, the
  first lines and the walk were seen, the round at the table was not.
- The installed app on a phone or a tablet.
