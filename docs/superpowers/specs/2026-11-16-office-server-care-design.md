# The office looks after the host: design

Date: 2026-11-16. Status: built. Sub-project 3 of
[the office as my-office's 3D floor](2026-11-16-office-my-office-port-design.md), which has the
request, the owner's answers and the list of sub-projects.

## Request

"The office also looks after your Server: RAM per session, forgotten dev servers, one-click
cleanup."

## What was there

The Resources screen (`plugins/resource-manager`) already reads memory, CPU and listening ports
per agent and closes an idle agent's runtime. The office could not use it: a plugin's client
calls only its own plugin's RPCs, and the plugin compiler rejects an import that leaves the
plugin's directory. The scene from sub-project 1 has a server room whose racks, wall screen and
server boxes were furniture, waiting for readings.

## Decisions

| Question                | Decision                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Where the readings come | A reader of the office's own, of what the office shows and no more: the processes that carry an agent's id, their memory and their listening ports, the memory in use, the CPU. It counts a process for its agent as the Resources screen does and reads memory cgroup first, as that screen does. It has none of that screen's groups, so a command the heavy-command gate runs counts for its agent here. |
| How they arrive         | A subscription, `office.machine`: a reading at once, then one every 10 s while someone listens. The scene's wall screen and the header want them without the card being open.                                                                                                                                                                                                                               |
| A session's RAM         | The resident memory of every process that carries the agent's `PASEO_AGENT_ID`, children included. An agent without a process of its own (a provider that runs in a shared server) is not listed.                                                                                                                                                                                                           |
| A forgotten dev server  | An agent that has been idle for 30 minutes with a TCP port open, or one that is closed or archived with processes left. Half an hour, because an agent that just ended its turn has often started the server for the user to look at.                                                                                                                                                                       |
| Whose processes         | Only those of agents this daemon knows. An id it does not know is never shown and never signalled: a second daemon on the host would see the first one's agents that way.                                                                                                                                                                                                                                   |
| Cleanup                 | By agent, not by port. An idle agent's runtime is closed through the SDK, so the provider and its tools end together and the next prompt resumes them; then whatever still carries the id of an agent without a runtime gets SIGTERM. Stopping one listening process would leave an agent half alive.                                                                                                       |
| What cleanup refuses    | An agent that is not idle, one with no saved session to resume, an id the daemon does not know. The daemon's own pid and its ancestors are never signalled, whatever id they carry. A pid whose start time changed since it was listed is skipped.                                                                                                                                                          |
| One click               | The group of agents that left something running has one primary button for all of them, and each row has its own. With one agent in the group, its row's button is the primary one.                                                                                                                                                                                                                         |
| The other agents        | Listed by memory. An idle one has a Close button: the same call, which frees its memory until its next prompt.                                                                                                                                                                                                                                                                                              |
| Where it shows          | A Host entry at the end of the attention strip, in the list view and the 3D view alike: memory in use, or how many agents left something running. It opens the Host card.                                                                                                                                                                                                                                   |
| In the 3D office        | The server room's chip says the memory in use; the chip, the racks, the wall screen and the server boxes open the card. An agent with a port open has a box on its desk. What was left running stands in the server room under a red light, with a tag that is a button.                                                                                                                                    |
| Tones                   | A warning from 80% of memory and for anything left running, critical from 90%: the Resources screen's thresholds. Below that the meter is grey, so a colour means something.                                                                                                                                                                                                                                |
| Hosts without /proc     | The subscription answers `unavailable` once. No entry, no card, and the server room stays furniture.                                                                                                                                                                                                                                                                                                        |

## Components

- `server/machine/proc.ts`: the /proc reads and their parsers.
- `server/machine/reading.ts`: `buildMachine`, pure: who holds what, and who left something.
- `server/machine/machine.ts`: one reading, with the agents asked from the daemon. An id nobody
  has is asked about once.
- `server/machine/cleanup.ts`: `cleanUpAgent`.
- `server/machine/watch.ts`: reads while someone listens; `refresh` reads at once after a cleanup.
- `server/machine/live-ports.ts`: the daemon's API behind the ports the others take.
- `shared/contracts.ts`: `office.machine`, `office.machine.cleanup.request`.
- `client/use-machine.ts`, `client/machine-card.tsx`, `client/machine-text.ts`: the hook, the
  card and its words. `client/attention-strip.tsx` has the Host entry.
- `client/world/adapter.ts` `worldMachine`: the reading in the shape the scene reads.
- The scene's entry: `setMachine` shows or hides the server room's chip, sets the wall screen's
  readings and places the server boxes.

## Errors

- A reading that fails is logged and the next one still comes; the last reading stays on screen.
- A cleanup answers for each agent. One agent's reason shows under its button; for several, one
  sentence says how many were left and the first reason.
- A closed runtime gets three seconds for its processes to end before what is left is signalled.
  SIGTERM only: a process that ignores it is still listed at the next reading.

## Testing

- Unit, against a /proc built in a temporary directory: the parsers, the listeners, memory with
  and without a cgroup cap, the CPU share, ancestors. `buildMachine`: sums, the 30 minute rule,
  closed agents, strangers, the order. The cleanup: each refusal, the daemon's own line of
  processes, a pid that was reused. The watch: its timing, a refresh, an unreadable host.
- Live, on the dev daemon: a real reading in the header; with fixtures, the card in light and
  dark at 1280 and 390, the cleanup's failure sentence from the real daemon (it does not know the
  fixture agents), the card after a cleanup answered ok, the server room's chip, the tag over
  what was left by pointer and by keyboard, a host without readings, the list view.

## Not verified

- A cleanup that succeeds against a real agent. No agent may be created on the development
  daemons, so the live check rewrote the answer. The close and the signals are covered by unit
  tests with a fake process tree.
- macOS and Windows hosts.
- Whether a provider's runtime, when closed, takes a detached dev server with it. The code handles
  both: it waits, then signals what is left.
