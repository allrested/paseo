# The office's reviews: design

Date: 2026-11-16. Status: built. Sub-project 7 of
[the office as my-office's 3D floor](2026-11-16-office-my-office-port-design.md), which has the
request, the owner's answers and the list of sub-projects.

## Request

From Hermes3D's list: "Review pull requests from inside the office."

## What was there

Hermes3D has a code review room. It runs the `gh` command on its host for the review queue and
for one pull request's checks, reviews, comments and files with their diffs, and it submits a
verdict (approve, comment, request changes) and line comments. Its agents can walk to the room
and review through a skill.

Paseo has the diff already: a workspace's changes pane, with the pull request's status beside
it. The workspace descriptor carries the pull request of the workspace's branch, which the
[stand-up](2026-11-16-office-standup-design.md) projects. The plugin SDK has no call that
fetches a pull request's diff, its comments or its reviews, and none that submits a verdict. A
plugin's client can open a workspace and open a link.

## Decisions

| Question                 | Decision                                                                                                                                                                                                                                               |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| What the office reviews  | The open and draft pull requests of the host's workspaces: one per workspace, the one of its branch. A merged or closed one is not in the queue.                                                                                                       |
| The order                | What waits for a review first (no decision yet, or the forge says pending), then what was sent back with changes requested, then the approved, then the drafts.                                                                                        |
| What a row says          | The number and title; the team, the branch and its base, and the lines the checkout adds and removes; then where it stands with its checks and conflicts. The line is in the warning tone when changes were requested, checks fail or it conflicts.    |
| Reading the changes      | "Open workspace" shows the workspace in the app, where the diff is. The office does not draw a diff of its own.                                                                                                                                        |
| The verdict              | Given on the forge: a link opens the pull request there. The office holds no token and the SDK has no call for it.                                                                                                                                     |
| An agent's review        | "Ask for a review" posts a note on the team's board that names one agent, as the stand-up's request does. The agent reads the diff and answers with one note, which the card shows under the pull request.                                             |
| Who is asked             | The team's newest idle agent without an open permission: where a team has an author and a reviewer, the reviewer came later. The line under the buttons names it before the press. A team without an idle agent has no button and a line that says so. |
| Finding the review again | The request's first line starts with `Review request:` and its second is the pull request's address. The newest such note from the user is the request, and the asked agent's first note after it is the review. Nothing else is stored.               |
| Asking twice             | While a request has no answer and its agent is still in the room, nobody else is asked. After an answer the button reads "Ask for another review".                                                                                                     |
| A long review            | Cut at 600 characters, with a line that says the board has the rest and a button that opens the board.                                                                                                                                                 |
| Wakes off                | The button is off and the line under it says why.                                                                                                                                                                                                      |
| Where it shows           | A Reviews entry after Stand-up in the attention strip, only while a pull request is open: the number that waits for a review in the warning tone, else the number of pull requests.                                                                    |
| The strip                | It takes a list of cards now, each present only while it has something to say, so an office without pull requests has no Reviews entry.                                                                                                                |

## Components

- `shared/contracts.ts`: `base` on the pull request, `changes` on the workspace.
- `server/directory.ts`: `projectWorkspace` reads `baseRefName` and `diffStat`.
- `client/review-text.ts`: the queue's rows and order, the request's text, finding a request and
  its answer among a board's posts, who would be asked, the strip's note and the card's words.
- `client/review-card.tsx`: the card. `client/attention-strip.tsx` takes its cards as a list.
- `client/use-reviews.ts`: the card's state. The request goes out through the board's
  `office.post.request`; "Open workspace" is the host's `navigation.openWorkspace`. The
  stand-up's state moved to `client/use-standup.ts` beside it, out of the surface.

## Errors

- A refused post shows under the row's buttons.
- A host without `navigation` has no "Open workspace" button.
- A request whose agent left the room stays on the board; the card says "An agent that left" and
  lets another agent be asked.

## Not built

- A diff, a file list, comments or line comments in the office, and a verdict from it. They
  need daemon calls the SDK does not have.
- A new agent started for the review. An agent of the team is asked, which may be the author.
  The SDK can create an agent in a workspace, but it needs a provider and a model the office has
  no place to choose.
- Pull requests of repositories that are not a workspace on this host, and other people's
  review requests: Hermes3D lists both from `gh`.
- More than one pull request per workspace: the descriptor has the one of the current branch.
- Anything on the floor. A reviewer is seen at the library while it reads.

## Testing

Unit tests: the projection of the base branch and the size of the changes; the queue's rows and
order; who would be asked; the request's text; a pending request, an answered one, a second
request, a request whose agent left, posts that are not requests, a long review; the strip's
note, the card's first line, the button and the line under it.

Live, with fixtures in front of a dev daemon and no agent created: the entry and the card at
390 px (light) and 1280 px (dark); the request as it left the page; the card while the request
waits; a note from the asked agent arriving and shown as the review; a pull request turning
approved; a team without an idle agent; wakes off; "Open board"; "Open workspace", which went to
the workspace's route; Tab through the card; the entry leaving the strip with the last pull
request and returning with a new one.

## Not verified

- A pull request from a real forge: the dev daemon's workspaces had none.
- A real agent reviewing: the hard rule of this build is that no agent is created or prompted.
  The request went to a board whose agent did not exist on the dev daemon, and the answer was a
  fixture note.
- "Open workspace" for a real workspace: the fixture's workspace does not exist, so only the
  route was seen.
- The installed app on a phone or a tablet.
