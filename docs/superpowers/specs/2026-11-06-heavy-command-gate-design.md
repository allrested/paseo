# Heavy-command gate — design

Date: 2026-11-06. Status: approved design; not yet planned.

## Problem

Agents start typechecks, builds, installs, and test suites whenever they like. Each one takes 2–3 GB
(`tsgo --noEmit` in `packages/app` peaked at 3.7 GB; an Expo web bundle at about 3 GB), so three or
four starting together push the 16 GB host into swap. That froze a fork instance on 2026-11-06. The
workaround so far is a convention: wrap heavy commands in `flock /tmp/paseo-heavy.lock`. Only agents
that were told about it follow it, and a lock file in one container cannot see the other instance or
the browser containers on the same host.

## Scope

In scope:

- Gate heavy commands run by agents that Paseo launches (Claude, Kiro, OpenCode, any provider), so
  they wait for a slot and for free memory.
- A status screen showing what runs and what waits.

Out of scope: commands typed in Paseo terminals, commands run by absolute path or straight from
`node_modules/.bin`, and killing or pausing commands that already run.

## Decisions

| Question                | Decision                                                                                                                                                                                      |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| How commands are caught | PATH shims, prepended for every agent by `agent.open.before`. `npm run` and `npx` put `node_modules/.bin` first, so `npm`, `npx`, and `pnpm` are shimmed and classify their arguments.        |
| Who decides             | The plugin's server process, over a Unix socket. One authority keeps the queue fair and gives the screen exact data.                                                                          |
| Release                 | The shim holds the socket open while its command runs. A closed socket releases the slot, so a crash or cancel never leaks one.                                                               |
| Plugin down             | Fail open: the shim runs the command ungated and prints one warning line. The gate never blocks work by being absent.                                                                         |
| Memory signal           | The smaller of host `MemAvailable` and the cgroup's `memory.max − memory.current`. Containers see host memory in `/proc/meminfo`, so the gate also feels the other instance and the browsers. |
| Nesting                 | An admitted command runs with `PASEO_HEAVY_GATE_HELD=1`; a shim that sees it runs straight through, so `npm run typecheck` calling `tsc` cannot deadlock.                                     |

## Components

`plugins/heavy-command-gate/`:

- `shared/`: the settings schema and the status RPC contract.
- `index.server.ts` and `server/`: the gate server, the admission function, the memory reader, and
  the `agent.open.before` hook that prepends the shim directory to `PATH`.
- `server/shim/gate.mjs`: the shim, installed into the plugin's data directory and linked as `npm`,
  `npx`, `pnpm`, `tsc`, `tsgo`, `vitest`, `jest`, `gradle`, `gradlew`, and `pytest`.
- `index.client.tsx` and `client/`: the status and settings screen.

## Shim

1. Find the real binary on `PATH`, skipping the shim directory.
2. Classify the arguments against the heavy patterns from settings. Each pattern carries a memory
   estimate. Defaults: `tsc`, `tsgo`, and `npm run typecheck` 3 GB; `expo export` 3 GB; `vitest`,
   `jest`, and `npm test` 2 GB; `gradle` and `gradlew` 2 GB; `npm ci` and `npm install` 1.5 GB.
3. Not heavy, or `PASEO_HEAVY_GATE_HELD=1` is set: exec the real binary.
4. Otherwise connect to the socket and send the command line, estimate, agent id (`PASEO_AGENT_ID`),
   and pid. While waiting, print `waiting for heavy-command slot (2 ahead, 1.8 GB free)` to stderr
   every 30 s, or `waiting for free memory (2 ahead, 1.8 GB free, 3.0 GB needed)` when the queue
   waits on memory.
5. On `go`, run the real binary with `PASEO_HEAVY_GATE_HELD=1`, pass signals through, keep the
   socket open, and exit with the command's exit code.

A socket that cannot be reached means step 5 runs at once, after one warning line. So does a gate
that sends no first answer within 10 s, or closes the socket before `go`, so a wedged daemon never
freezes a build. The gate drops a connection that sends no hello within 5 s.

## Admission

A pure function of the queue, the current holders, and a memory reading. It admits the oldest
waiter when:

- local holders are fewer than the slot count (default 1), and
- free memory, minus what running commands were promised but do not use yet (estimate minus
  current RSS, never below zero), is at least the waiter's estimate plus the reserve (default
  1 GB). Without the subtraction a second command could start before the first one grows into its
  estimate.

If nothing local runs and the oldest waiter has waited 5 minutes, it is admitted anyway, with a
warning in its stderr and in the screen. The memory is then held by something the gate cannot free,
and waiting longer helps nobody. The server re-evaluates every 2 s and on every release.

## Screen and RPC

`heavy-command-gate.status.request` returns the running commands (agent title, command, elapsed time,
RSS of the process tree) and the waiting ones (position, wait time, and whether they wait on a slot
or on memory). The screen polls it every 5 s while open. Settings cover the slot count, the reserve,
the patterns with their estimates, and an on/off switch.

## Testing

- Unit: the classifier (arguments to heavy or not, with an estimate, for each shimmed binary) and the
  admission function (slot limit, memory limit, FIFO order, the starvation guard).
- Integration: the real socket server and the shim running `sleep` in a temp directory. Two runs at
  once go one after the other; killing the holder frees its slot; a nested call passes straight
  through; with no server the command still runs.
- Manual: two agents run `npm run typecheck` at once; the second waits and the screen shows it.
