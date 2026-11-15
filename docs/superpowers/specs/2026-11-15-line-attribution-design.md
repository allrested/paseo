# Line attribution — design

Date: 2026-11-15. Status: design chosen by the build (program "Orca 1-9", sub-project H; the owner
asked to run every sub-project and review at the end).

## Problem

A workspace's diff shows what changed, and Git blame shows who committed it. Neither says which
agent wrote a line: several agents work in one folder, the person edits between their turns, and
everything lands in commits under one name. Before a merge, the reviewer wants to know which lines
came from which agent, and which nobody but a person touched.

## Scope

In scope:

- The daemon records which lines each agent turn wrote, per working folder, for Git checkouts.
- An Attribution panel in a workspace: the files agents changed, and for one file each line with
  the agent that wrote it, when, and a way to open that agent.

Out of scope: following a line through a merge into another checkout, syntax highlighting,
exporting attribution to Git (notes, trailers, co-author lines), turns that ran before this
version was installed, folders that are not Git checkouts, files over 1 MiB, and binary files.

## Decisions

| Question            | Decision                                                                                                                                                                                                                                                |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| What marks a line   | The turn. The daemon takes a snapshot of the folder when a turn starts and when it ends; what changed in between is that agent's. It works for every provider and for edits made through a shell command, where a per-tool-call record would miss them. |
| Where it is kept    | A shadow Git history per working folder under `$PASEO_HOME/attribution/`. Each recorded change is a commit there, so `git blame` answers "who wrote this line" and follows a line across later edits. Only the files agents changed enter it.           |
| The person's repo   | Never written. Snapshots use their own index file and their own object directory, with the repository's objects as an alternate. No ref, object, index entry or hook of the repository changes.                                                         |
| Edits between turns | Read as "not by an agent". They enter the shadow history when an agent next changes that file, as a commit of their own before the agent's.                                                                                                             |
| Two agents at once  | A change made while several agents run in one folder is attributed to all of them: the snapshots cannot tell their edits apart.                                                                                                                         |
| Helper agents       | A background agent's edits count for its parent, whose turn they are part of.                                                                                                                                                                           |
| Renames             | A file an agent moves keeps its lines' attribution: the move is recorded apart from the edit.                                                                                                                                                           |
| Packaging           | Built-in plugin `attribution`: the daemon part hooks `agent.turn.before` and `agent.turn.after`, the client part is a workspace panel and a Command Center item.                                                                                        |
| Limits              | Files over 1 MiB are not tracked. A snapshot that finds more than 20,000 changed paths, or a turn that changes more than 300 files, is not recorded. Git commands time out after 60 s.                                                                  |
| Colour              | One accent for every agent line, stronger for the chosen agent. An agent is told apart by its number and name, never by hue alone: the panel has to read in every theme.                                                                                |

## Components

### Server: `plugins/attribution/server/`

- `git.ts` runs Git with the daemon's `GIT_*` variables removed, a timeout and a typed error.
- `work-tree.ts` finds the checkout a folder belongs to: its top folder, object directory and
  index. A folder outside a checkout, or in a bare repository, has none.
- `shadow.ts` owns `$PASEO_HOME/attribution/<key>/`, where the key is a hash of the top folder:
  a bare repository (`git/`), the snapshot index (`snap.index`) and the folder's path
  (`folder.json`). At start it removes the stores of folders that no longer exist.
- `snapshot.ts` writes the folder's state as a tree. It keeps its own index, seeded from the
  repository's, so a snapshot hashes only what changed since the last one. Objects go to the
  shadow store; ignored files stay out.
- `record.ts` turns two snapshots into shadow commits: it lists the changed files, copies the
  blobs the shadow store lacks, commits the state before the turn when it differs from the
  shadow's ("outside"), and commits the agents' change on top.
- `tracker.ts` is the rule: which agents run in which folder, when to snapshot, whom to credit.
- `reader.ts` answers the panel: the files agents changed, and one file's lines with their turns.
  It blames a commit of the file as it is on disk, so lines changed since the last turn read as
  "not by an agent".
- `blame.ts` parses `git blame --porcelain`.

### The rule

For each working folder the tracker keeps the set of agents with a running turn and the last
snapshot. At every turn start and end in that folder, in order:

1. Take a snapshot.
2. If agents were running since the last snapshot and the tree changed, record the change for
   those agents.
3. Add or remove the agent. With no agent left, forget the snapshot.

An agent that is closed or archived leaves the set. A turn the daemon did not see start is not
recorded.

### Protocol (plugin RPCs)

- `attribution.files.read.request { workspaceId }` → `{ status: "ready", files }`, or
  `"no_checkout"`. A file has its path, the time of the last agent change and the agents of its
  turns.
- `attribution.file.read.request { workspaceId, path }` → `{ status: "ready", lines, marks, turns }`,
  or `"untracked"`, `"missing"`, `"binary"`, `"too_large"`. A mark is a run of lines and the
  turn that wrote them.
- `attribution.changes` tells a panel that a change was recorded for a workspace.

The daemon resolves the folder from the workspace. A path is relative, and its real location has
to be inside the checkout.

### Client: `plugins/attribution/client/`

- A workspace panel, "Attribution", and the Command Center item "Show line attribution".
- First view: the files agents changed, newest first, each with its agents and when.
- Second view: one file. A legend numbers the agents and counts their lines; choosing one makes
  its lines stand out. Each line has its number, the agent's number in the gutter and the text.
  Choosing a line shows its turn: agents, time, and "Open agent".

## Errors and edge cases

- A snapshot or a record that fails is logged, and that turn is not recorded. Nothing an agent
  does waits for it: both hooks are notifications.
- A daemon restart during a turn loses that turn's attribution.
- A branch switch between turns records nothing. A file reads against the shadow's last version
  of it: lines the two share keep their agent.
- A shell command the person runs while an agent's turn is under way counts as the agent's.

## Testing

- Unit, against real Git in temporary folders: a snapshot leaves the repository untouched and
  skips ignored and oversized files; a recorded turn blames to its agent; an edit between turns
  blames to nobody; a rename keeps its lines; two agents share a change; the porcelain parser.
- The tracker's rule against fake snapshots.
- Live, on the dev daemon: a history seeded through the plugin's own recorder, then the panel at
  1280, 820 and 390. The hooks fire on real turns only, which this build does not start.
