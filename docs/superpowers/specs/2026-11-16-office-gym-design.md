# The office's gym: design

Date: 2026-11-16. Status: built. Sub-project 9 of
[the office as my-office's 3D floor](2026-11-16-office-my-office-port-design.md), which has the
request, the owner's answers and the list of sub-projects.

## Request

From Hermes3D's list: "Train agents in the gym to develop new skills."

## What was there

Hermes3D has a gym room on its floor and a skills marketplace beside it. The marketplace lists
the skills its gateway knows, whether each is ready, and installs or removes one for an agent.
An agent walks to the gym while a skill is installed for it, when the user's message talks about
building or installing a skill, and for a minute after the user says "go to the gym".

The vendored my-office scene has no gym. Its library is where an agent goes to open a skill:
upstream's action table sends a `skill` event to the library with a book, and the library's card
says "Agents come here to read files, search code and open skills". Nothing sent that event.

Paseo's agents use skills: folders with a `SKILL.md` whose front matter has a name and a
description. Claude Code reads them from its config folder's `skills/` and a project's
`.claude/skills/`. Paseo installs its own orchestration skills into `~/.claude/skills`,
`~/.codex/skills` and `~/.agents/skills`, and the `default-skills` built-in copies reviewed
third-party skills into the Claude config folder. A Claude Code agent opens a skill with its
`Skill` tool, which reaches the office's activity poller as a tool call of that name.

## Decisions

| Question                 | Decision                                                                                                                                                                                                                                                                    |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the gym is         | The library. The owner chose the office floor only, and my-office's library is already the place where skills are opened. No room is added.                                                                                                                                 |
| Who is at the gym        | An agent whose newest tool call opens a skill (Claude Code's `Skill`), reads or writes a `SKILL.md`, or runs a command that names one. A new step kind, `skill`, says so. The file and the command stay on the host.                                                        |
| How it looks             | In 3D, upstream's own `skill` action: the library, the reading pose and its book. In 2D, the library with the open book that reading has. Nothing new is drawn.                                                                                                             |
| What "train" is          | The user names what a skill should teach and picks an idle agent of the team. The office posts a note on the team's board that names the agent. The agent writes the skill into the workspace and answers with one note.                                                    |
| Where a new skill goes   | Into the workspace, so it is part of the diff to review before anyone else gets it. A Claude Code agent is told `.claude/skills/<name>/SKILL.md`; an agent of another provider is told to use the folder its tool reads.                                                    |
| The request              | First line `Skill request: ` and the topic, on one line, at most 200 characters. Then what to write: a folder with a `SKILL.md` whose front matter has a name and a description, the steps taken from the work in this workspace, no other file changed, and one note back. |
| Finding it again         | As the review's: the newest note from the user on the team's board that starts with the mark and names an agent is the request, and that agent's first note after it is the answer, cut at 600 characters. The review and the gym share this code.                          |
| Who can be asked         | The team's idle agents without an open permission, as chips. The newest is chosen at first. A team without one has no form and a line that says so.                                                                                                                         |
| Asking while one trains  | Allowed. The agent already asked is at work, so it is not a chip; the card shows the newest request.                                                                                                                                                                        |
| Wakes off                | The button is off and the line under it says why.                                                                                                                                                                                                                           |
| Which skills are listed  | Each team's from its workspace's `.claude/skills`, `.agents/skills` and `.codex/skills`. The host's from the Claude config folder's `skills/` (`CLAUDE_CONFIG_DIR`, else `~/.claude`), `~/.agents/skills` and `~/.codex/skills`.                                            |
| One skill in two folders | One row per name, with the folders it is in: "In .claude and .agents".                                                                                                                                                                                                      |
| Reading them             | `office.skills.request`, on opening the card and with "Read again". The server reads only those folders and finds a workspace's folder through the SDK; a client sends no path. Nothing is stored or watched.                                                               |
| How much of each         | At most 100 skills per folder, by folder name. Of each `SKILL.md`, the first 8 KB: the front matter's `name` (else the folder's name) and `description`, cut at 300 characters. A folder without a `SKILL.md` is not a skill.                                               |
| The host's list          | Hidden behind "Show N skills" when there are more than six: the teams come first.                                                                                                                                                                                           |
| Where it shows           | A Gym entry after QA in the attention strip, while the office has a team: "N training" while agents are at a skill, else "Teach a skill".                                                                                                                                   |

## Components

- `shared/names.ts`: `skill` in the step kinds. `shared/contracts.ts`: `office.skills.request`
  and its answer.
- `server/activity.ts`: the `skill` kind. `server/skills.ts`: `parseSkill`, `readSkillFolder`,
  `mergeSkills` and `readSkills` over ports (the folders, a folder's entries, a file's head, the
  clock); `server/live-ports.ts` has the ports on node's file system and the daemon's API.
  `server/hub.ts` has `workspaceIds()`.
- `client/ask-text.ts`: finding a request and its answer on a board, and the team's idle agents,
  moved out of `review-text.ts` for both cards.
- `client/gym-text.ts`: the teams, who trains, the request's text, the strip's note and the
  card's words. `client/gym-card.tsx`: the card. `client/use-gym.ts`: its state and its calls.
  `Chip` is exported from `client/board-sheet.tsx`.
- `client/pixel/actors.ts` and `client/world/adapter.ts`: where the `skill` kind goes.

## Errors

- A folder that does not exist has no skills. One that cannot be read is skipped and logged,
  and the rest are listed.
- A workspace whose folder the SDK cannot find has no skills of its own in the answer.
- A refused post shows under the team's button; a failed read shows under "Read again".

## Not built

- Installing, removing or editing a skill from the office. The `default-skills` built-in has its
  Skills screen, and a plugin's client can call only its own plugin's RPCs.
- A gym room on the floor, Hermes3D's "go to the gym" command, and its skill trigger blocks.
- Which agent used which skill, and how often.
- Skills of plugins and of other providers' folders than the three named.

## Testing

Unit tests: the `skill` kind from each of its three sources; reading real folders in a temporary
directory (front matter, a folded description, no front matter, no `SKILL.md`, a hidden folder,
the cut, the cap); one row per name across folders; the hub's ids; the call through the plugin
entry; the request and its answer, the shared finder still holding the review's cases; the
teams, the chips' agents, the strip's note, the summary and the lines under the button.

Live, with fixtures in front of a dev daemon and no agent created: on a phone (390 px, light, 2D)
an agent at a skill standing at the library with the book, the strip's "1 training", the card
with a team's skills, a workspace with none, one the host has no folder for, a team with no idle
agent; the chips with the newest idle agent chosen first, another chosen, the topic typed, the
request as it left the page (a Codex agent, so the folder its tool reads), the card while it
waits, the agent's note arriving as the answer, wakes off, the host's eight skills folded and
shown, every target at least 44 px. The placeholder was cut in a one-line field, so the field
wraps now. On a desktop (1280 px, dark, 3D) the scene got upstream's `skill` event and the agent
walked to the library by the windows, the card, Tab through it, Escape; muted text 6.97 to 1 on
the dark sheet. A reading the page could not use, forced by the test proxy: "The skills could not
be read." over the failure, "Not read." for each team, and "Read again" bringing the skills back.
"Show 8 skills" and "Hide the host's skills", and "Open board" showing the request on the board.
The delivery check found the topic field with a placeholder and no visible label, so it has one
now.

End to end on the dev daemon with no fixture: a `SKILL.md` put into its project's
`.claude/skills` showed under both of its workspaces, which share the folder, with its name and
description, and the host's skills were read from the daemon's own folders. The probe was removed
afterwards.

## Not verified

- A real agent writing a skill: the hard rule of this build is that no agent is created or
  prompted. The request went to a board whose agent did not exist on the dev daemon, and the answer
  was a fixture note.
- The `skill` kind from a real agent's tool call: it was tested on the timeline items the host
  normalises, and on the floor with a fixture step.
- A Codex agent finding `.agents/skills` or `.codex/skills` in a workspace: the request leaves
  the folder to the agent's tool.
- The installed app on a phone or a tablet.
