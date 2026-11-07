# Heavy-Command Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every agent Paseo launches queue its memory-heavy commands (typechecks, test suites, builds, installs) behind a slot count and a free-memory check, with a screen that shows what runs and what waits.

**Architecture:** A built-in plugin `plugins/heavy-command-gate/` runs inside the daemon. At start it claims `$PASEO_HOME/heavy-command-gate/gate.sock`, writes one Node script `gate.mjs` (generated from two self-contained TypeScript functions) and links it as `npm`, `npx`, `pnpm`, `tsc`, `tsgo`, `vitest`, `jest`, `gradle`, `gradlew` and `pytest` in `bin/`, which an `agent.open.before` hook puts first on every agent's `PATH`. A shim classifies its arguments against the settings' heavy patterns; a heavy command connects to the socket, waits for `go` from a pure FIFO admission function (slots, free memory, starvation guard), runs with `PASEO_HEAVY_GATE_HELD=1`, and holds the connection open until it exits, so a closed socket releases the slot.

**Tech Stack:** TypeScript (NodeNext, strict), zod 4, `@getpaseo/plugin` server and client SDK, React Native settings UI with `@tanstack/react-query`, Vitest 4, Node 22 `net` Unix sockets, `child_process`, `/proc` and cgroup v2.

**Spec:** `docs/superpowers/specs/2026-11-06-heavy-command-gate-design.md`

## Global Constraints

- **Host memory.** The 16 GB host froze on 2026-11-06 from parallel heavy commands. Run every typecheck, vitest run, build, npm install and `git commit` (its lefthook pre-commit typechecks every workspace) under `flock /tmp/paseo-heavy.lock`. Typecheck with `tsgo --singleThreaded`. Never run a whole workspace test suite.
- **One test file per run:** `flock /tmp/paseo-heavy.lock npx vitest run <file> --bail=1`.
- **Pre-commit hook stays on.** Every commit runs the lefthook hook (format, lint, full typecheck) under the heavy lock. `LEFTHOOK=0` is not approved for this plan and is not an option to offer. If the hook fails in a workspace the task did not touch, stop and report it.
- **Plan file.** This plan is drafted at `.superpowers/plan-drafts/2026-11-06-heavy-command-gate.md` (gitignored). The controller cuts the local branch `feat/heavy-command-gate`, copies the plan to `docs/superpowers/plans/2026-11-06-heavy-command-gate.md` and commits it on that branch before Task 1; until then it shows in an unscoped `git status`, which is why every status check below is scoped to `plugins packages`.
- **Branches.** Every task runs on the local branch `feat/heavy-command-gate`, which the controller cuts from `main` (`1eaa71b2f` when this plan was written, with shared-mcp merged) before Task 1. Tasks never create, switch, check out or rebase a branch, and no step commits to, checks out or pushes `main`. Every commit block starts with a branch check; on `STOP: not on feat/heavy-command-gate` nothing was staged or committed: report it and stop.
- **Daemon:** never restart, stop or signal the Paseo daemon on port 6767. Manual tests use a dev daemon with `PASEO_HOME=/workspace/utils/paseo/.dev/paseo-home`, started with `env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD`, listening on `172.22.0.3:6768`. Abort the manual test and clean up whenever `MemAvailable` drops below 2500 MB.
- **Commits:** local only, on `feat/heavy-command-gate`. No step pushes any branch, that one included (a push to main redeploys every instance through Dokploy). Author and committer `tatsuya <allrested@gmail.com>`, overriding the container's M-DAQ `GIT_*` env for that command only, by explicit pathspec:
  `flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "<message>" -- <paths>`
- **Built-in import rules:** server files import only `@getpaseo/plugin/*`, `zod` and `node:*`; client files only `@getpaseo/plugin`, `@getpaseo/plugin/client*`, `react`, `react-native`, `@tanstack/react-query`, `zod`; `shared/` only `@getpaseo/plugin` and `zod`. Relative imports carry a `.js` suffix everywhere (NodeNext). No import from another plugin's directory.
- **Shim serialization rule.** `classifyCommand` (`server/shim/classify.ts`) and `runShim` (`server/shim/run-shim.ts`) are copied into `gate.mjs` with `Function.prototype.toString()`. Their bodies may use only their parameters and JavaScript or Node globals (`JSON`, `Number`, `Reflect`, `setTimeout`, `clearTimeout`): no value imports, no module-level constants, no helpers declared outside the function, no timers imported from `node:timers`. Type-only imports are fine.
- **In-process safety.** The plugin runs inside the daemon, and an uncaught exception or unhandled rejection exits the daemon. Every timer callback, socket and server `error` event, gate call from a socket callback and fire-and-forget promise is guarded and logged with `console.error` (it reaches the daemon log).
- **Fail open.** A shim that cannot reach the gate runs its command at once after exactly one warning line. A plugin that cannot claim its socket or find a usable node adds nothing to `PATH`.
- **No secrets in files, logs or chat.** The plugin never logs a command line (the screen shows it to signed-in users only). No step prints `PASEO_PASSWORD`, tokens, `~/.claude/settings.json` values or `config.json`. Steps find processes by pid file, `pgrep -P`, `pgrep -g`, or `grep -l` and `grep -q` over `/proc/<pid>/environ` and `/proc/<pid>/cmdline`. They never run `pgrep -a`, `pgrep -f`, `ps -f` or a `ps` format with `args`: Claude processes carry bearer tokens in their arguments.
- **Types.** No `as` casts that bypass an error (`as const` is fine). Test files are excluded from the plugins typecheck (`plugins/tsconfig.json`), so tests type their fixtures with interfaces and typed helpers, never with casts, and never with `vi.mock` or `vi.spyOn` (docs/testing.md).
- **Test env.** Tests that spawn a shim build its env from scratch. They never inherit `PASEO_HEAVY_GATE_HELD` or `PASEO_AGENT_ID` from the process running vitest, which may itself run under a gate.
- **Copy rules (docs/design.md section 10):** sentence case, a literal three-dot "..." in in-flight labels ("Saving..."), no trailing period on a single-clause hint.
- **Spec values:** default slots 1, reserve 1 GB, starvation guard 5 minutes, re-evaluation every 2 s and on every release, a wait line every 30 s, screen poll every 5 s, RPC `heavy-command-gate.status.request`, nesting variable `PASEO_HEAVY_GATE_HELD=1`, wait line `waiting for heavy-command slot (2 ahead, 1.8 GB free)`, or `waiting for free memory (2 ahead, 1.8 GB free, 3.0 GB needed)` when the queue waits on memory. A shim also falls open when the gate sends no first answer within 10 s, or closes the socket before `go`; the gate drops a connection that sends no hello within 5 s. Admission subtracts what running commands were promised but do not use yet (estimate minus current RSS, never below zero). Default estimates: `tsc`, `tsgo`, `npm run typecheck` 3 GB; `expo export` 3 GB; `vitest`, `jest`, `npm test` 2 GB; `gradle`, `gradlew` 2 GB; `npm ci`, `npm install` 1.5 GB.
- **Formatting and lint:** `npm run format:files -- <paths>` and `npm run lint -- <paths>` from the repo root.

## Decisions the spec leaves open

These are settled here; every task follows them.

1. **How the shim reaches the disk.** A built-in runs as an esbuild CJS bundle evaluated in the daemon and cannot read a file shipped next to it. The shim therefore has no source file of its own: `installShims` writes `$PASEO_HOME/heavy-command-gate/gate.mjs` at every start from a short bootstrap plus `classifyCommand.toString()` and `runShim.toString()`, and links `bin/<name> -> ../gate.mjs`. The spec's `server/shim/gate.mjs` is that generated file.
2. **Home layout.** `<PASEO_HOME>/heavy-command-gate/` (mode 0700) holds `gate.mjs` (0700), `bin/`, `config.json` (0600, the settings the shims read, rewritten atomically on every save) and `gate.sock`.
3. **Interpreter.** The `#!` line names `process.execPath`, except under Electron (`process.versions.electron` set), where it names the first `node` on the daemon's `PATH`. A path with whitespace, longer than 200 characters, or Windows makes the plugin unavailable.
4. **Socket ownership.** The plugin listens on `gate.sock`. On `EADDRINUSE` it probes the path: a live answer means another daemon on the same home owns it, and this plugin stands down (no files written, no `PATH` entry, status `unavailable`); a refused connection means a stale file, which it removes and listens again.
5. **Wire protocol.** One JSON line per message. The shim sends `hello { version 1, command, estimateBytes, agentId, process: { pid, startTime, pidNamespace, bootId, initStartTime } }`. The gate answers `wait { ahead, freeBytes, neededBytes, waitingOn }` at once and every 30 s, then `go { forced, freeBytes, neededBytes, waitedMs }`. The gate drops a connection that sends no hello within 5 s, a malformed hello, and a line over 64 KB. A socket that cannot be reached means the shim runs the command at once, after one warning line. So does a gate that sends no first answer within 10 s, or closes the socket before `go`. The user approved both timeouts on 2026-11-07, and the spec's Shim section states them.
6. **What "free" means.** `freeBytes` is the spec's signal (cgroup v2 only; cgroup v1 or no limit falls back to `MemAvailable`; no `/proc` means null and slots alone gate). Admission subtracts what running commands were promised but do not use yet (estimate minus current RSS, never below zero: `max(0, estimate - RSS)`), so a second command cannot start before the first one grows into its estimate. The user approved this on 2026-11-07, and the spec's Admission section states it.
7. **FIFO and starvation.** Admission walks the queue oldest first and stops at the first command that cannot start; every waiter reports the head's reason (`slot` or `memory`). The starvation guard admits the head, marked `forced`, only when nothing is running.
8. **Classification.** Patterns are word lists matched as a prefix of the command's words after options are dropped (npm, npx and pnpm value options consume their value). npm aliases (`run-script`, `t`, `i`, `ci` aliases, `x`), `npm run test` = `npm test`, `npx`/`npm exec`/`pnpm exec`/`pnpm dlx` classify their target with any `@version` removed, and a pnpm word that is not a pnpm command means `npm run <word>`. The longest matching pattern wins; ties go to the earlier one. `pytest` is shimmed but has no default pattern, as in the spec.
9. **Light and nested commands** replace the shim with `process.execve` (Node 22.15+), or run as a child when `process.execve` is missing. A heavy command runs as a child with `stdio: "inherit"`; SIGINT, SIGTERM, SIGHUP and SIGQUIT are forwarded, and the child's exit code (or signal) becomes the shim's. A failed `execve` system call does not throw: Node prints `process.execve failed with error code <code>` and aborts with exit 134 (checked on Node 22.23.3 against a missing file). `findRealBinary` has already found an executable regular file, so only rarer causes reach that abort (`ENOEXEC`, `E2BIG`, `ETXTBSY`, a seccomp filter). The `catch` in `execReal` sees only the argument checks Node makes before the call.
10. **Switched off.** The hook keeps adding `PATH` while the gate is off; shims read `enabled: false` from `config.json` and exec straight (no `PASEO_HEAVY_GATE_HELD`). Turning the gate off admits every waiter.
11. **Settings.** Document id `gate`, version 1: `enabled` (true), `slots` 1 to 16 (1), `reserveGb` 0 to 64 (1), `patterns` up to 100 of `{ command, estimateGb }` with estimates 0.1 to 1024 GB and no duplicate command. GB means 2^30 bytes. Invalid stored settings keep the values in force.
12. **Screens.** Built-ins have no row in Settings > Plugins, so a "Heavy commands" Command Center item (`context: "global"`, visible once a workspace is open) opens two settings screens: Commands (on/off switch, Running, Waiting) and Limits (slots, reserve, the pattern list as `<GB> <command words>` lines, Save, Discard, a two-press Restore defaults because the SDK has no confirm dialog).
13. **Agent titles** come from `paseo.agents.ref(id).refresh()` per status request; a failed lookup shows the agent id's first 8 characters.
14. **Contract for sub-project 3 (Resource Manager).** Every process of a command the shim let through after asking (admitted or failed open) carries `PASEO_HEAVY_GATE_HELD=1` in `/proc/<pid>/environ`; the shim that asked the gate does not. A shim started inside a held command inherits the flag, never asks, and replaces itself with the real binary at the same pid, so it is part of the held command. `HELD_ENV` in `server/protocol.ts`, the `GateStatus` types in `shared/rpc.ts` and `gatePaths()` in `server/paths.ts` are the stable names. Task 10 documents the variable in `docs/plugins.md`.
15. **Not here.** No rollout task: the spec edits no instance files. Retiring the `flock /tmp/paseo-heavy.lock` convention is left to sub-project 6.

## File structure

```
plugins/heavy-command-gate/
  paseo-plugin.json                 manifest (Task 1)
  index.server.ts                   registers settings, hook, status RPC, cleanup (Task 1, final in Task 8)
  index.client.tsx                  two settings screens and the Command Center item (Task 9)
  shared/settings.ts                settings schema, defaults, GB conversion (Task 1)
  shared/rpc.ts                     status RPC contract and its types (Task 1)
  server/shim/classify.ts           classifyCommand: args -> estimate or null, self-contained (Task 2)
  server/protocol.ts                HELD_ENV, hello schema, notices, shim config type (Task 3)
  server/memory.ts                  readFreeMemory: MemAvailable and cgroup v2 headroom (Task 3)
  server/procfs.ts                  pid space, start time, process-tree RSS (Task 3)
  server/admission.ts               decideAdmission: pure FIFO admission (Task 4)
  server/gate.ts                    createGate: queue, holders, notices, timer, snapshot (Task 5)
  server/socket-server.ts           listenGateSocket: claim, hello parsing, close (Task 6)
  server/paths.ts                   gateHome, gatePaths (Task 7)
  server/shim/run-shim.ts           runShim: the shim's whole runtime, self-contained (Task 7)
  server/shim/install.ts            buildShimScript, installShims, writeShimConfig, interpreter (Task 7)
  server/agent-title.ts             fetchAgentTitle through the Paseo SDK (Task 8)
  server/plugin.ts                  startGatePlugin: wiring, hook, status assembly (Task 8)
  client/format.ts                  row and hint text (Task 9)
  client/settings-form.ts           draft <-> settings, line-numbered errors (Task 9)
  client/styles.ts                  screen styles from the host theme (Task 9)
  client/commands-screen.tsx        Commands screen (Task 9)
  client/limits-screen.tsx          Limits screen (Task 9)
packages/server/src/server/plugins/builtin/index.ts   registry entry (Task 1)
docs/plugins.md                                        built-in paragraph (Task 10)
```

Every module has a collocated test: `*.test.ts`, or `*.posix.test.ts` where it needs Unix sockets, symlinks or file modes.

---

### Task 1: Scaffold, settings schema, status RPC contract, registry entry

**Files:**

- Create: `plugins/heavy-command-gate/paseo-plugin.json`
- Create: `plugins/heavy-command-gate/index.server.ts`
- Create: `plugins/heavy-command-gate/shared/settings.ts`
- Create: `plugins/heavy-command-gate/shared/rpc.ts`
- Modify: `packages/server/src/server/plugins/builtin/index.ts` (the `builtinPlugins` array: add `"heavy-command-gate"` between `"grok-usage-source"` and `"hoplite-provider"`)
- Test: `plugins/heavy-command-gate/shared/settings.test.ts` (new)
- Test: `packages/server/src/server/plugins/builtin/index.test.ts` (existing, unchanged; its first test reads every listed manifest and compiles every listed built-in)

**Interfaces:**

Consumes (read from source, not memory):

- `defineSettings<Schema extends ZodType>(definition: SettingsDefinition<Schema>): SettingsDefinition<Schema>` from `@getpaseo/plugin` (`packages/plugin/src/settings.ts:14`). The id must match `^[a-z][a-z0-9_-]*$`; scope `"host"`; version a safe integer of at least 1.
- `defineRpc({ name, input, output })` from `@getpaseo/plugin` (`packages/plugin/src/rpc.ts:29`). Names match `^[a-z][a-z0-9._-]*$`.
- `PluginServerContext.registerSettings(definition): PluginSettings<Schema>` from `@getpaseo/plugin/server` (`packages/plugin/src/server/contracts.ts:43`). It registers `settings.gate.read`, `settings.gate.write` and `settings.gate.reset`.
- `z.RefinementCtx` from `zod` 4.4.3, used as in `plugins/shared-mcp/shared/settings.ts`.

Produces:

- `plugins/heavy-command-gate/shared/settings.ts`
  - `export const GIB = 1024 ** 3`
  - `export const SLOTS_MESSAGE`, `RESERVE_MESSAGE`, `ESTIMATE_MESSAGE`, `COMMAND_MESSAGE`, `PATTERNS_MESSAGE` (strings, exact text in Step 3)
  - `export const HeavyPatternSchema` (`{ command: string; estimateGb: number }`), `export type HeavyPattern = z.output<typeof HeavyPatternSchema>`
  - `export function defaultPatterns(): HeavyPattern[]` (the spec's 11 defaults, a fresh array per call)
  - `export type GateSettingsSchema` (the schema type), `export type GateSettings = z.output<GateSettingsSchema>` = `{ enabled: boolean; slots: number; reserveGb: number; patterns: HeavyPattern[] }`
  - `export const gateSettings = defineSettings({ id: "gate", scope: "host", version: 1, schema })`
  - `export function gbToBytes(gb: number): number` (rounds `gb * GIB`)
- `plugins/heavy-command-gate/shared/rpc.ts`
  - `RunningCommandSchema` / `export type RunningCommand = { id: string; agentId: string | null; agentTitle: string | null; command: string; pid: number; elapsedMs: number; rssBytes: number | null; estimateBytes: number; forced: boolean }`
  - `WaitingCommandSchema` / `export type WaitingCommand = { id: string; agentId: string | null; agentTitle: string | null; command: string; pid: number; position: number; waitedMs: number; estimateBytes: number; waitingOn: "slot" | "memory" }`
  - `GateStatusSchema` / `export type GateStatus = { state: "on" | "off" | "unavailable"; error: string | null; slots: number; reserveBytes: number; freeBytes: number | null; running: RunningCommand[]; waiting: WaitingCommand[] }`
  - `export const statusRpc` named `"heavy-command-gate.status.request"`, input `{}`, output `GateStatus`
- `plugins/heavy-command-gate/index.server.ts`: `export default function contribute(server: PluginServerContext): () => void`, registering the settings only. Task 8 replaces it.
- Built-in id `"heavy-command-gate"` in `builtinPlugins`.

- [ ] **Step 1: Write the failing settings test**

Create `plugins/heavy-command-gate/shared/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  COMMAND_MESSAGE,
  ESTIMATE_MESSAGE,
  GIB,
  PATTERNS_MESSAGE,
  RESERVE_MESSAGE,
  SLOTS_MESSAGE,
  defaultPatterns,
  gateSettings,
  gbToBytes,
} from "./settings.js";

const SPEC_DEFAULTS = [
  { command: "tsc", estimateGb: 3 },
  { command: "tsgo", estimateGb: 3 },
  { command: "npm run typecheck", estimateGb: 3 },
  { command: "expo export", estimateGb: 3 },
  { command: "vitest", estimateGb: 2 },
  { command: "jest", estimateGb: 2 },
  { command: "npm test", estimateGb: 2 },
  { command: "gradle", estimateGb: 2 },
  { command: "gradlew", estimateGb: 2 },
  { command: "npm ci", estimateGb: 1.5 },
  { command: "npm install", estimateGb: 1.5 },
];

// Each issue as "<path>: <message>", the form the Limits screen relies on.
function issues(input: unknown): string[] {
  const result = gateSettings.schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
}

describe("gateSettings", () => {
  it("is the host-scoped settings document gate at version 1", () => {
    expect(gateSettings.id).toBe("gate");
    expect(gateSettings.scope).toBe("host");
    expect(gateSettings.version).toBe(1);
  });

  it("defaults to the gate on, one slot, a 1 GB reserve and the spec's heavy commands", () => {
    expect(gateSettings.schema.parse({})).toEqual({
      enabled: true,
      slots: 1,
      reserveGb: 1,
      patterns: SPEC_DEFAULTS,
    });
  });

  it("gives every parse a default list of its own", () => {
    gateSettings.schema.parse({}).patterns.pop();
    expect(gateSettings.schema.parse({}).patterns).toEqual(SPEC_DEFAULTS);
    expect(defaultPatterns()).not.toBe(defaultPatterns());
  });

  it("accepts the bounds", () => {
    expect(
      issues({
        slots: 16,
        reserveGb: 0,
        patterns: [{ command: "npm run typecheck", estimateGb: 0.1 }],
      }),
    ).toEqual([]);
    expect(
      issues({ slots: 1, reserveGb: 64, patterns: [{ command: "tsc", estimateGb: 1024 }] }),
    ).toEqual([]);
  });

  it.each([[0], [17], [1.5], ["2"]])("rejects %j slots", (slots) => {
    expect(issues({ slots })).toEqual([`slots: ${SLOTS_MESSAGE}`]);
  });

  it.each([[-1], [65], ["1"]])("rejects a %j GB reserve", (reserveGb) => {
    expect(issues({ reserveGb })).toEqual([`reserveGb: ${RESERVE_MESSAGE}`]);
  });

  it.each([[""], [" tsc"], ["npm  test"], ["npm test "], ["npm --workspace test"], ["-x"]])(
    "rejects the command %j",
    (command) => {
      expect(issues({ patterns: [{ command, estimateGb: 1 }] })).toEqual([
        `patterns.0.command: ${COMMAND_MESSAGE}`,
      ]);
    },
  );

  it.each([[0], [0.05], [1025], ["3"]])("rejects a %j GB estimate", (estimateGb) => {
    expect(issues({ patterns: [{ command: "tsc", estimateGb }] })).toEqual([
      `patterns.0.estimateGb: ${ESTIMATE_MESSAGE}`,
    ]);
  });

  it("rejects more than 100 commands", () => {
    const patterns = Array.from({ length: 101 }, (_, index) => ({
      command: `tool${index}`,
      estimateGb: 1,
    }));
    expect(issues({ patterns })).toEqual([`patterns: ${PATTERNS_MESSAGE}`]);
  });

  it("rejects a command listed twice", () => {
    expect(
      issues({
        patterns: [
          { command: "tsc", estimateGb: 3 },
          { command: "vitest", estimateGb: 2 },
          { command: "tsc", estimateGb: 1 },
        ],
      }),
    ).toEqual(['patterns.2.command: Command "tsc" is listed more than once']);
  });
});

describe("gbToBytes", () => {
  it("counts a GB as 2^30 bytes and rounds to whole bytes", () => {
    expect(GIB).toBe(1_073_741_824);
    expect(gbToBytes(1.5)).toBe(1_610_612_736);
    expect(gbToBytes(0.1)).toBe(107_374_182);
    expect(gbToBytes(0)).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/shared/settings.test.ts --bail=1`

Expected: FAIL, `Cannot find module './settings.js'` (the module does not exist yet).

- [ ] **Step 3: Write the settings schema**

Create `plugins/heavy-command-gate/shared/settings.ts`:

```ts
import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** One GB in these settings is 2^30 bytes, the unit the memory readings are converted from. */
export const GIB = 1024 ** 3;

export const SLOTS_MESSAGE = "Slots must be a whole number from 1 to 16";
export const RESERVE_MESSAGE = "Reserve must be a number of GB from 0 to 64";
export const ESTIMATE_MESSAGE = "Estimate must be a number of GB from 0.1 to 1024";
export const COMMAND_MESSAGE =
  "Command must be words separated by single spaces, none starting with a dash";
export const PATTERNS_MESSAGE = "List at most 100 heavy commands";

// The shim compares words after it drops options, so a pattern holds no option words.
const COMMAND_WORDS = /^[^\s-]\S*(?: [^\s-]\S*)*$/;

export const HeavyPatternSchema = z.object({
  command: z.string().regex(COMMAND_WORDS, COMMAND_MESSAGE),
  estimateGb: z.number(ESTIMATE_MESSAGE).min(0.1, ESTIMATE_MESSAGE).max(1024, ESTIMATE_MESSAGE),
});

export type HeavyPattern = z.output<typeof HeavyPatternSchema>;

interface PatternList {
  patterns: HeavyPattern[];
}

/** The spec's defaults. A function, so every parse gets an array of its own. */
export function defaultPatterns(): HeavyPattern[] {
  return [
    { command: "tsc", estimateGb: 3 },
    { command: "tsgo", estimateGb: 3 },
    { command: "npm run typecheck", estimateGb: 3 },
    { command: "expo export", estimateGb: 3 },
    { command: "vitest", estimateGb: 2 },
    { command: "jest", estimateGb: 2 },
    { command: "npm test", estimateGb: 2 },
    { command: "gradle", estimateGb: 2 },
    { command: "gradlew", estimateGb: 2 },
    { command: "npm ci", estimateGb: 1.5 },
    { command: "npm install", estimateGb: 1.5 },
  ];
}

function rejectDuplicatePatterns(values: PatternList, context: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const [index, pattern] of values.patterns.entries()) {
    if (seen.has(pattern.command)) {
      context.addIssue({
        code: "custom",
        path: ["patterns", index, "command"],
        message: `Command "${pattern.command}" is listed more than once`,
      });
    }
    seen.add(pattern.command);
  }
}

const SettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    slots: z
      .number(SLOTS_MESSAGE)
      .int(SLOTS_MESSAGE)
      .min(1, SLOTS_MESSAGE)
      .max(16, SLOTS_MESSAGE)
      .default(1),
    reserveGb: z
      .number(RESERVE_MESSAGE)
      .min(0, RESERVE_MESSAGE)
      .max(64, RESERVE_MESSAGE)
      .default(1),
    patterns: z.array(HeavyPatternSchema).max(100, PATTERNS_MESSAGE).default(defaultPatterns),
  })
  .superRefine(rejectDuplicatePatterns);

export type GateSettingsSchema = typeof SettingsSchema;
export type GateSettings = z.output<GateSettingsSchema>;

export const gateSettings = defineSettings({
  id: "gate",
  scope: "host",
  version: 1,
  schema: SettingsSchema,
});

export function gbToBytes(gb: number): number {
  return Math.round(gb * GIB);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/shared/settings.test.ts --bail=1`

Expected: PASS, 24 tests. If a `rejects ... slots` case reports two issues, zod ran both `int` and `min` on one value: check that the case value violates only one check (0 fails `min` only, 1.5 fails `int` only).

- [ ] **Step 5: Write the status RPC contract**

Create `plugins/heavy-command-gate/shared/rpc.ts`:

```ts
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const RunningCommandSchema = z.object({
  id: z.string(),
  /** PASEO_AGENT_ID of the shim's environment; null when it had none. */
  agentId: z.string().nullable(),
  agentTitle: z.string().nullable(),
  command: z.string(),
  pid: z.number().int(),
  elapsedMs: z.number().int().nonnegative(),
  /** RSS of the shim's process tree; null when it runs in another pid namespace or has gone. */
  rssBytes: z.number().int().nonnegative().nullable(),
  estimateBytes: z.number().int().positive(),
  /** Started by the starvation guard without enough free memory. */
  forced: z.boolean(),
});

export type RunningCommand = z.output<typeof RunningCommandSchema>;

export const WaitingCommandSchema = z.object({
  id: z.string(),
  agentId: z.string().nullable(),
  agentTitle: z.string().nullable(),
  command: z.string(),
  pid: z.number().int(),
  /** 1 for the oldest waiter. */
  position: z.number().int().positive(),
  waitedMs: z.number().int().nonnegative(),
  estimateBytes: z.number().int().positive(),
  waitingOn: z.enum(["slot", "memory"]),
});

export type WaitingCommand = z.output<typeof WaitingCommandSchema>;

export const GateStatusSchema = z.object({
  state: z.enum(["on", "off", "unavailable"]),
  /** Why the gate is unavailable; null otherwise. */
  error: z.string().nullable(),
  slots: z.number().int().positive(),
  reserveBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative().nullable(),
  running: z.array(RunningCommandSchema),
  waiting: z.array(WaitingCommandSchema),
});

export type GateStatus = z.output<typeof GateStatusSchema>;

export const statusRpc = defineRpc({
  name: "heavy-command-gate.status.request",
  input: z.object({}),
  output: GateStatusSchema,
});
```

- [ ] **Step 6: Write the manifest and a server entry that registers the settings**

Create `plugins/heavy-command-gate/paseo-plugin.json`:

```json
{ "id": "heavy-command-gate", "requirements": { "paseo": ">=0.15.0" } }
```

Create `plugins/heavy-command-gate/index.server.ts`:

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { gateSettings } from "./shared/settings.js";

// The gate, its hook and its RPC arrive in Task 8.
export default function contribute(server: PluginServerContext): () => void {
  server.registerSettings(gateSettings);
  return () => undefined;
}
```

- [ ] **Step 7: Add the registry entry**

In `packages/server/src/server/plugins/builtin/index.ts`, replace

```ts
  "grok-usage-source",
  "hoplite-provider",
```

with

```ts
  "grok-usage-source",
  "heavy-command-gate",
  "hoplite-provider",
```

- [ ] **Step 8: Run the registry compile test**

Run: `cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1`

Expected: PASS, 1 test (the others in the file are skipped by `-t`). It reads `plugins/heavy-command-gate/paseo-plugin.json` and compiles `index.server.ts` with the built-in import boundaries.

- [ ] **Step 9: Format and lint**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/heavy-command-gate packages/server/src/server/plugins/builtin/index.ts && npm run lint -- plugins/heavy-command-gate packages/server/src/server/plugins/builtin/index.ts
```

Expected: oxfmt exits 0, then `Found 0 warnings and 0 errors.` The rules most likely to fire are `no-shadow` and `typescript/consistent-type-definitions` (object type aliases fail; `z.output<...>` aliases pass).

- [ ] **Step 10: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics. Test files are excluded by `plugins/tsconfig.json`.

- [ ] **Step 11: Commit with the fork identity (local only, never push)**

Stage these six paths explicitly and end the commit command with the same pathspec. Other sessions share this checkout: the pathspec commits only these files, and anything another session staged stays staged and out of this commit. The lefthook pre-commit hook runs format check and lint on the staged files, then a full `npm run typecheck` across every workspace, so the commit holds the heavy lock until the hook finishes (several minutes).

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/heavy-command-gate || { echo "STOP: not on feat/heavy-command-gate"; exit 1; }
git -C /workspace/utils/paseo add plugins/heavy-command-gate/paseo-plugin.json plugins/heavy-command-gate/index.server.ts plugins/heavy-command-gate/shared/settings.ts plugins/heavy-command-gate/shared/settings.test.ts plugins/heavy-command-gate/shared/rpc.ts packages/server/src/server/plugins/builtin/index.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): scaffold heavy-command-gate built-in plugin" -- plugins/heavy-command-gate/paseo-plugin.json plugins/heavy-command-gate/index.server.ts plugins/heavy-command-gate/shared/settings.ts plugins/heavy-command-gate/shared/settings.test.ts plugins/heavy-command-gate/shared/rpc.ts packages/server/src/server/plugins/builtin/index.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages
```

Expected:

- The hook's format, lint and typecheck jobs pass, and git prints `6 files changed`. If a hook job fails, git creates no commit: report the hook output and stop. Do not fix files outside this task and do not bypass the hook.
- `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.
- `show` prints the subject `feat(fork): scaffold heavy-command-gate built-in plugin` followed by exactly the six paths.
- `status` prints nothing.

---

### Task 2: Command classifier

**Files:**

- Create: `plugins/heavy-command-gate/server/shim/classify.ts`
- Test: `plugins/heavy-command-gate/server/shim/classify.test.ts`

**Interfaces:**

Consumes:

- `defaultPatterns(): HeavyPattern[]` and `gbToBytes(gb: number): number` from `plugins/heavy-command-gate/shared/settings.ts` (Task 1), in the test only.

Produces:

- `export interface PatternRule { words: readonly string[]; estimateBytes: number }`
- `export function classifyCommand(invokedAs: string, args: readonly string[], patterns: readonly PatternRule[]): number | null` returns the estimate in bytes of the longest pattern whose words are a prefix of the command's words, or null for a light command. `invokedAs` is the name the shim was called by (`npm`, `npx`, `pnpm`, `tsc`, ...); `args` excludes it. Self-contained under the shim serialization rule: Task 7 embeds `classifyCommand.toString()` in `gate.mjs`.

- [ ] **Step 1: Write the failing classifier test**

Create `plugins/heavy-command-gate/server/shim/classify.test.ts`:

```ts
import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { defaultPatterns, gbToBytes } from "../../shared/settings.js";
import { classifyCommand, type PatternRule } from "./classify.js";

interface Case {
  name: string;
  invokedAs: string;
  args: string[];
  expected: number | null;
}

const DEFAULT_RULES: PatternRule[] = defaultPatterns().map((pattern) => ({
  words: pattern.command.split(" "),
  estimateBytes: gbToBytes(pattern.estimateGb),
}));

const GB3 = gbToBytes(3);
const GB2 = gbToBytes(2);
const GB1_5 = gbToBytes(1.5);

// gate.mjs runs a copy rebuilt from source text, so every case also runs against such a copy.
// A reference to anything outside the function body throws a ReferenceError in this copy.
const serialized: typeof classifyCommand = runInNewContext(`(${classifyCommand.toString()})`);

function command(line: string, expected: number | null): Case {
  const [invokedAs, ...args] = line.split(" ");
  return { name: line, invokedAs, args, expected };
}

function rule(words: string, estimateBytes: number): PatternRule {
  return { words: words.split(" "), estimateBytes };
}

const CASES: Case[] = [
  command("npm run typecheck", GB3),
  command("npm run-script typecheck", GB3),
  command("npm --workspace=@getpaseo/server run typecheck", GB3),
  command("npm run typecheck --workspace @getpaseo/server -- --singleThreaded", GB3),
  command("npm -w @getpaseo/server run typecheck", GB3),
  command("npm test", GB2),
  command("npm t", GB2),
  command("npm run test -- --run", GB2),
  command("npm install", GB1_5),
  command("npm i -D zod", GB1_5),
  command("npm ci", GB1_5),
  command("npm clean-install", GB1_5),
  command("npm exec tsc", GB3),
  command("npm x -- vitest run", GB2),
  command("npm run lint", null),
  command("npm run", null),
  command("npm --version", null),
  command("npm", null),
  command("npx tsc --noEmit", GB3),
  command("npx -p typescript tsc", GB3),
  command("npx --package=typescript tsc", GB3),
  command("npx -y vitest@4.1.6 run", GB2),
  command("npx -- jest --ci", GB2),
  command("npx expo export --platform web", GB3),
  command("npx expo start", null),
  command("npx prettier --check .", null),
  command("npx", null),
  command("pnpm typecheck", GB3),
  command("pnpm run typecheck", GB3),
  command("pnpm -r run typecheck", GB3),
  command("pnpm --filter app typecheck", GB3),
  command("pnpm test", GB2),
  command("pnpm install --frozen-lockfile", GB1_5),
  command("pnpm add zod", GB1_5),
  command("pnpm exec tsc", GB3),
  command("pnpm dlx vitest@4 run", GB2),
  command("pnpm list", null),
  command("pnpm lint", null),
  command("tsc --noEmit -p tsconfig.json", GB3),
  command("tsgo --singleThreaded", GB3),
  command("vitest run src/a.test.ts", GB2),
  command("jest --ci", GB2),
  command("gradle build", GB2),
  command("gradlew assemble", GB2),
  command("pytest -x", null),
];

describe.each([
  ["the module", classifyCommand],
  ["a copy rebuilt from its source text", serialized],
])("classifyCommand, %s", (_label, classify) => {
  it.each(CASES)("$name", ({ invokedAs, args, expected }) => {
    expect(classify(invokedAs, args, DEFAULT_RULES)).toBe(expected);
  });

  it("picks the longest matching pattern", () => {
    const rules = [rule("npm", 1), rule("npm run typecheck", 3), rule("npm run", 2)];
    expect(classify("npm", ["run", "typecheck"], rules)).toBe(3);
  });

  it("picks the earlier of two equally long matches", () => {
    expect(classify("tsc", [], [rule("tsc", 1), rule("tsc", 2)])).toBe(1);
  });

  it("gates pytest once a pattern names it", () => {
    expect(classify("pytest", ["-x"], [rule("pytest", 5)])).toBe(5);
  });

  it("never matches a pattern with no words", () => {
    expect(classify("tsc", [], [{ words: [], estimateBytes: 1 }])).toBeNull();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/shim/classify.test.ts --bail=1`

Expected: FAIL, `Cannot find module './classify.js'`.

- [ ] **Step 3: Write the classifier**

Create `plugins/heavy-command-gate/server/shim/classify.ts`:

```ts
export interface PatternRule {
  /** The command's leading words once options are dropped, such as ["npm", "run", "typecheck"]. */
  words: readonly string[];
  estimateBytes: number;
}

/**
 * The memory estimate, in bytes, of the longest heavy pattern the command matches, or null for a
 * light command.
 *
 * installShims copies this function into gate.mjs with Function.prototype.toString(), so its body
 * may use only its parameters and JavaScript globals: no imports, no module-level constants, no
 * helpers declared outside it. classify.test.ts runs every case against such a copy as well.
 */
export function classifyCommand(
  invokedAs: string,
  args: readonly string[],
  patterns: readonly PatternRule[],
): number | null {
  // npm options that take the next argument as their value unless written --name=value.
  const NPM_VALUE_OPTIONS = [
    "-w",
    "--workspace",
    "--prefix",
    "-C",
    "--loglevel",
    "--userconfig",
    "--cache",
    "--registry",
  ];
  const NPX_VALUE_OPTIONS = ["-p", "--package", "-c", "--call", ...NPM_VALUE_OPTIONS];
  // pnpm's -w is --workspace-root, a flag, so it is not listed.
  const PNPM_VALUE_OPTIONS = [
    "-C",
    "--dir",
    "-F",
    "--filter",
    "--filter-prod",
    "--loglevel",
    "--reporter",
    "--package",
  ];
  const NPM_ALIASES = new Map([
    ["run-script", "run"],
    ["rum", "run"],
    ["urn", "run"],
    ["t", "test"],
    ["tst", "test"],
    ["i", "install"],
    ["in", "install"],
    ["ins", "install"],
    ["inst", "install"],
    ["insta", "install"],
    ["instal", "install"],
    ["isnt", "install"],
    ["isnta", "install"],
    ["isntal", "install"],
    ["isntall", "install"],
    ["add", "install"],
    ["clean-install", "ci"],
    ["ic", "ci"],
    ["install-clean", "ci"],
    ["isntall-clean", "ci"],
    ["x", "exec"],
  ]);
  // pnpm commands that are not scripts. Any other first word runs the package script of that name.
  const PNPM_COMMANDS = new Set([
    "audit",
    "bin",
    "cache",
    "config",
    "create",
    "deploy",
    "doctor",
    "env",
    "fetch",
    "import",
    "init",
    "licenses",
    "link",
    "list",
    "ls",
    "outdated",
    "pack",
    "patch",
    "prune",
    "publish",
    "rebuild",
    "remove",
    "rm",
    "root",
    "server",
    "setup",
    "store",
    "unlink",
    "update",
    "up",
    "why",
  ]);

  function isOption(token: string): boolean {
    return token.length > 1 && token.startsWith("-");
  }

  // Index of the first positional argument, skipping options and their values; -1 when none.
  function firstPositional(tokens: readonly string[], valueOptions: readonly string[]): number {
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index];
      if (token === "--") return index + 1 < tokens.length ? index + 1 : -1;
      if (!isOption(token)) return index;
      index += valueOptions.includes(token) ? 2 : 1;
    }
    return -1;
  }

  // Every positional argument. After "--" the arguments belong to another program, so only the
  // ones that do not look like options count.
  function positionals(tokens: readonly string[], valueOptions: readonly string[]): string[] {
    const words: string[] = [];
    let index = 0;
    while (index < tokens.length) {
      const token = tokens[index];
      if (token === "--") {
        for (const rest of tokens.slice(index + 1)) {
          if (!isOption(rest)) words.push(rest);
        }
        return words;
      }
      if (isOption(token)) {
        index += valueOptions.includes(token) ? 2 : 1;
      } else {
        words.push(token);
        index += 1;
      }
    }
    return words;
  }

  // npx, npm exec and pnpm exec or dlx: the target command without its @version, then its words.
  function execWords(tokens: readonly string[], valueOptions: readonly string[]): string[] {
    const at = firstPositional(tokens, valueOptions);
    if (at < 0) return [];
    const target = tokens[at];
    const versionAt = target.indexOf("@", 1);
    const name = versionAt > 0 ? target.slice(0, versionAt) : target;
    return [name, ...positionals(tokens.slice(at + 1), [])];
  }

  // `npm run test` is the same command as `npm test`.
  function npmRun(words: readonly string[]): string[] {
    if (words[0] === "test") return ["npm", "test", ...words.slice(1)];
    return ["npm", "run", ...words];
  }

  function npmWords(tokens: readonly string[]): string[] {
    const at = firstPositional(tokens, NPM_VALUE_OPTIONS);
    if (at < 0) return ["npm"];
    const command = NPM_ALIASES.get(tokens[at]) ?? tokens[at];
    const rest = tokens.slice(at + 1);
    if (command === "exec") return execWords(rest, NPX_VALUE_OPTIONS);
    const words = positionals(rest, NPM_VALUE_OPTIONS);
    if (command === "run") return npmRun(words);
    return ["npm", command, ...words];
  }

  function pnpmWords(tokens: readonly string[]): string[] {
    const at = firstPositional(tokens, PNPM_VALUE_OPTIONS);
    if (at < 0) return ["pnpm"];
    const command = tokens[at];
    const rest = tokens.slice(at + 1);
    if (command === "exec" || command === "dlx") return execWords(rest, PNPM_VALUE_OPTIONS);
    const words = positionals(rest, PNPM_VALUE_OPTIONS);
    if (command === "run" || command === "run-script") return npmRun(words);
    if (command === "test" || command === "t") return ["npm", "test", ...words];
    if (command === "install" || command === "i" || command === "add") {
      return ["npm", "install", ...words];
    }
    if (PNPM_COMMANDS.has(command)) return ["pnpm", command, ...words];
    return npmRun([command, ...words]);
  }

  function commandWords(): string[] {
    if (invokedAs === "npm") return npmWords(args);
    if (invokedAs === "npx") return execWords(args, NPX_VALUE_OPTIONS);
    if (invokedAs === "pnpm") return pnpmWords(args);
    return [invokedAs, ...positionals(args, [])];
  }

  function startsWithWords(words: readonly string[], prefix: readonly string[]): boolean {
    if (prefix.length === 0 || prefix.length > words.length) return false;
    return prefix.every((word, index) => words[index] === word);
  }

  const words = commandWords();
  let best: PatternRule | null = null;
  for (const pattern of patterns) {
    if (!startsWithWords(words, pattern.words)) continue;
    if (best === null || pattern.words.length > best.words.length) best = pattern;
  }
  return best === null ? null : best.estimateBytes;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/shim/classify.test.ts --bail=1`

Expected: PASS, 98 tests (45 command cases and 4 rule cases, each against the module and the rebuilt copy). A failure only in the rebuilt copy with `ReferenceError` means the body reaches outside itself: move that name inside the function.

- [ ] **Step 5: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/heavy-command-gate/server/shim && npm run lint -- plugins/heavy-command-gate/server/shim
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: `Found 0 warnings and 0 errors.`, then a typecheck with exit 0. `complexity` (20) is per function, so the nested helpers keep `classifyCommand` itself small. The `perf` category is an error in `.oxlintrc.json`, so a list read only through `.includes()` fails `unicorn/prefer-set-has`; that is why `PNPM_COMMANDS` is a `Set`.

- [ ] **Step 6: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/heavy-command-gate || { echo "STOP: not on feat/heavy-command-gate"; exit 1; }
git -C /workspace/utils/paseo add plugins/heavy-command-gate/server/shim/classify.ts plugins/heavy-command-gate/server/shim/classify.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): heavy-command-gate command classifier" -- plugins/heavy-command-gate/server/shim/classify.ts plugins/heavy-command-gate/server/shim/classify.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages
```

Expected: the hook passes and git prints `2 files changed`; the identity line is `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` lists exactly the two paths; `status` prints nothing. On a hook failure, report and stop.

---

### Task 3: Wire protocol, memory reader, /proc readers

**Files:**

- Create: `plugins/heavy-command-gate/server/protocol.ts`
- Create: `plugins/heavy-command-gate/server/memory.ts`
- Create: `plugins/heavy-command-gate/server/procfs.ts`
- Test: `plugins/heavy-command-gate/server/memory.test.ts`
- Test: `plugins/heavy-command-gate/server/procfs.posix.test.ts` (POSIX only: the fake `/proc` holds a symlink)

**Interfaces:**

Consumes:

- `PatternRule { words: readonly string[]; estimateBytes: number }` from `plugins/heavy-command-gate/server/shim/classify.ts` (Task 2), type only.

Produces:

- `plugins/heavy-command-gate/server/protocol.ts`
  - `export const HELD_ENV = "PASEO_HEAVY_GATE_HELD"` (the spec's nesting variable; sub-project 3 reads this name)
  - `export const MAX_LINE_LENGTH = 64 * 1024`
  - `export const ShimProcessSchema`, `export type ShimProcess = { pid: number; startTime: number | null; pidNamespace: string | null; bootId: string | null; initStartTime: number | null }`
  - `export const ShimHelloSchema`, `export type ShimHello = { type: "hello"; version: 1; command: string; estimateBytes: number; agentId: string | null; process: ShimProcess }`
  - `export interface WaitNotice { type: "wait"; ahead: number; freeBytes: number | null; neededBytes: number; waitingOn: "slot" | "memory" }`
  - `export interface GoNotice { type: "go"; forced: boolean; freeBytes: number | null; neededBytes: number; waitedMs: number }`
  - `export type ServerNotice = WaitNotice | GoNotice`
  - `export interface ShimConfig { version: 1; enabled: boolean; patterns: PatternRule[] }` (the `config.json` the shims read)
- `plugins/heavy-command-gate/server/memory.ts`
  - `export interface MemoryRoots { procRoot: string; cgroupRoot: string }`
  - `export function parseMemAvailableBytes(meminfo: string): number | null`
  - `export function parseCgroupV2Path(cgroup: string): string | null`
  - `export function readFreeMemory(roots?: MemoryRoots): number | null` (defaults `/proc`, `/sys/fs/cgroup`)
- `plugins/heavy-command-gate/server/procfs.ts`
  - `export interface PidSpace { pidNamespace: string | null; bootId: string | null; initStartTime: number | null }`
  - `export function parseStatPpid(stat: string): number | null`, `export function parseStatStartTime(stat: string): number | null`, `export function parseVmRssBytes(status: string): number | null`
  - `export function readStartTime(pid: number, procRoot?: string): number | null`
  - `export function readPidSpace(procRoot?: string): PidSpace`
  - `export function samePidSpace(a: PidSpace, b: PidSpace): boolean`
  - `export function readTreeRss(rootPid: number, procRoot?: string): number | null`
  - `export function readShimRss(shim: ShimProcess, procRoot?: string): number | null` (null unless the shim runs in this pid namespace, boot and container run, and its pid still names the process that sent the hello)

- [ ] **Step 1: Write the protocol module**

It holds only schemas and types, so the socket server (Task 6) and the shim (Task 7) test it. Create `plugins/heavy-command-gate/server/protocol.ts`:

```ts
import { z } from "zod";
import type { PatternRule } from "./shim/classify.js";

/**
 * Set on every process of a command the shim let through after asking the gate, admitted or failed
 * open. A shim that sees it runs straight through, so `npm run typecheck` calling `tsc` cannot wait
 * on itself. The shim that asked the gate does not carry it. A shim started inside a held
 * command inherits it and execs the real binary in its place.
 */
export const HELD_ENV = "PASEO_HEAVY_GATE_HELD";

/** The longest line the gate reads from a shim. A longer one drops the connection. */
export const MAX_LINE_LENGTH = 64 * 1024;

// Read by the shim from its own /proc entries. pidNamespace, bootId and initStartTime say which
// processes its pid names: after a container restart or a reboot the same pid names another one.
export const ShimProcessSchema = z.object({
  pid: z.number().int().positive(),
  /** Field 22 of /proc/<pid>/stat; null without /proc. */
  startTime: z.number().int().nonnegative().nullable(),
  pidNamespace: z.string().nullable(),
  bootId: z.string().nullable(),
  initStartTime: z.number().int().nonnegative().nullable(),
});

export type ShimProcess = z.output<typeof ShimProcessSchema>;

export const ShimHelloSchema = z.object({
  type: z.literal("hello"),
  version: z.literal(1),
  command: z.string().min(1).max(4096),
  estimateBytes: z.number().int().positive(),
  agentId: z.string().min(1).max(200).nullable(),
  process: ShimProcessSchema,
});

export type ShimHello = z.output<typeof ShimHelloSchema>;

export interface WaitNotice {
  type: "wait";
  /** Commands queued before this one. */
  ahead: number;
  freeBytes: number | null;
  /** The command's estimate plus the reserve. */
  neededBytes: number;
  waitingOn: "slot" | "memory";
}

export interface GoNotice {
  type: "go";
  /** Started by the starvation guard without enough free memory. */
  forced: boolean;
  freeBytes: number | null;
  neededBytes: number;
  waitedMs: number;
}

export type ServerNotice = WaitNotice | GoNotice;

/** `config.json` in the gate home: what the shims classify against. */
export interface ShimConfig {
  version: 1;
  enabled: boolean;
  patterns: PatternRule[];
}
```

- [ ] **Step 2: Write the failing memory reader test**

Create `plugins/heavy-command-gate/server/memory.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  parseCgroupV2Path,
  parseMemAvailableBytes,
  readFreeMemory,
  type MemoryRoots,
} from "./memory.js";

const GIB = 1024 ** 3;
const KIB_PER_GIB = 1024 * 1024;

let root = "";
let roots: MemoryRoots = { procRoot: "", cgroupRoot: "" };

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

function meminfo(availableGib: number): string {
  return [
    "MemTotal:       16303932 kB",
    "MemFree:          811244 kB",
    `MemAvailable:   ${availableGib * KIB_PER_GIB} kB`,
    "Buffers:          120000 kB",
    "",
  ].join("\n");
}

// The daemon's cgroup v2 entry and its memory files, as a container sees them.
function writeCgroup(path: string, max: string, currentGib: number): void {
  write(join(roots.procRoot, "self", "cgroup"), `0::${path}\n`);
  const directory = join(roots.cgroupRoot, path);
  write(join(directory, "memory.max"), `${max}\n`);
  write(join(directory, "memory.current"), `${currentGib * GIB}\n`);
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "heavy-gate-memory-"));
  roots = { procRoot: join(root, "proc"), cgroupRoot: join(root, "cgroup") };
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("parseMemAvailableBytes", () => {
  it("reads the MemAvailable line in bytes", () => {
    expect(parseMemAvailableBytes(meminfo(4))).toBe(4 * GIB);
  });

  it("returns null without a MemAvailable line", () => {
    expect(parseMemAvailableBytes("MemTotal:       16303932 kB\n")).toBeNull();
  });
});

describe("parseCgroupV2Path", () => {
  it("reads the unified hierarchy path", () => {
    expect(parseCgroupV2Path("0::/system.slice/docker-abc.scope\n")).toBe(
      "/system.slice/docker-abc.scope",
    );
  });

  it("returns null on a cgroup v1 system", () => {
    expect(parseCgroupV2Path("12:memory:/docker/abc\n11:cpu,cpuacct:/docker/abc\n")).toBeNull();
  });
});

describe("readFreeMemory", () => {
  it("takes the cgroup headroom when it is smaller than MemAvailable", () => {
    write(join(roots.procRoot, "meminfo"), meminfo(4));
    writeCgroup("/paseo", String(6 * GIB), 5);
    expect(readFreeMemory(roots)).toBe(GIB);
  });

  it("takes MemAvailable when it is smaller than the cgroup headroom", () => {
    write(join(roots.procRoot, "meminfo"), meminfo(2));
    writeCgroup("/", String(8 * GIB), 1);
    expect(readFreeMemory(roots)).toBe(2 * GIB);
  });

  it("uses MemAvailable alone when the cgroup has no limit", () => {
    write(join(roots.procRoot, "meminfo"), meminfo(4));
    writeCgroup("/paseo", "max", 5);
    expect(readFreeMemory(roots)).toBe(4 * GIB);
  });

  it("uses MemAvailable alone on a cgroup v1 system", () => {
    write(join(roots.procRoot, "meminfo"), meminfo(4));
    write(join(roots.procRoot, "self", "cgroup"), "12:memory:/docker/abc\n");
    expect(readFreeMemory(roots)).toBe(4 * GIB);
  });

  it("counts a cgroup above its limit as no headroom", () => {
    write(join(roots.procRoot, "meminfo"), meminfo(4));
    writeCgroup("/paseo", String(2 * GIB), 3);
    expect(readFreeMemory(roots)).toBe(0);
  });

  it("returns null without /proc", () => {
    expect(readFreeMemory(roots)).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/memory.test.ts --bail=1`

Expected: FAIL, `Cannot find module './memory.js'`.

- [ ] **Step 4: Write the memory reader**

Create `plugins/heavy-command-gate/server/memory.ts`:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface MemoryRoots {
  procRoot: string;
  cgroupRoot: string;
}

const DEFAULT_ROOTS: MemoryRoots = { procRoot: "/proc", cgroupRoot: "/sys/fs/cgroup" };
const MEM_AVAILABLE_LINE = /^MemAvailable:\s+(\d+) kB$/m;
// The unified (v2) hierarchy is the line with hierarchy id 0 and no controller list.
const CGROUP_V2_LINE = /^0::(\/.*)$/m;
const COUNT = /^\d+$/;

export function parseMemAvailableBytes(meminfo: string): number | null {
  const match = MEM_AVAILABLE_LINE.exec(meminfo);
  return match ? Number(match[1]) * 1024 : null;
}

/** This process's cgroup v2 path from /proc/self/cgroup; null on a cgroup v1 system. */
export function parseCgroupV2Path(cgroup: string): string | null {
  const match = CGROUP_V2_LINE.exec(cgroup);
  return match ? match[1] : null;
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

// "max" (no limit), a missing file and anything that is not a byte count read as null.
function readCount(path: string): number | null {
  const text = readText(path)?.trim();
  if (text === undefined || !COUNT.test(text)) return null;
  const value = Number(text);
  return Number.isSafeInteger(value) ? value : null;
}

// memory.max minus memory.current of the daemon's own cgroup. Agents and their commands are the
// daemon's descendants, so they share it. A hybrid v1/v2 host has no memory files in the v2
// hierarchy and falls back to MemAvailable alone.
function readCgroupHeadroom(roots: MemoryRoots): number | null {
  const cgroup = readText(join(roots.procRoot, "self", "cgroup"));
  const path = cgroup === null ? null : parseCgroupV2Path(cgroup);
  if (path === null) return null;
  const directory = join(roots.cgroupRoot, path);
  const max = readCount(join(directory, "memory.max"));
  const current = readCount(join(directory, "memory.current"));
  if (max === null || current === null) return null;
  return Math.max(0, max - current);
}

/**
 * The spec's memory signal: the smaller of the host's MemAvailable (a container sees the host's
 * /proc/meminfo, so the other instance and the browsers count) and the cgroup v2 headroom. Null
 * without /proc, and the gate then admits on slots alone. Synchronous: /proc and cgroupfs reads
 * never wait on a disk, and the gate calls this every 2 s at most.
 */
export function readFreeMemory(roots: MemoryRoots = DEFAULT_ROOTS): number | null {
  const meminfo = readText(join(roots.procRoot, "meminfo"));
  const available = meminfo === null ? null : parseMemAvailableBytes(meminfo);
  const headroom = readCgroupHeadroom(roots);
  if (available === null) return headroom;
  if (headroom === null) return available;
  return Math.min(available, headroom);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/memory.test.ts --bail=1`

Expected: PASS, 10 tests.

- [ ] **Step 6: Write the failing /proc reader test**

Create `plugins/heavy-command-gate/server/procfs.posix.test.ts`:

```ts
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ShimProcess } from "./protocol.js";
import {
  parseStatPpid,
  parseStatStartTime,
  parseVmRssBytes,
  readPidSpace,
  readShimRss,
  readStartTime,
  readTreeRss,
  samePidSpace,
  type PidSpace,
} from "./procfs.js";

const MIB = 1024 * 1024;
const SPACE: PidSpace = { pidNamespace: "pid:[4026531836]", bootId: "boot-1", initStartTime: 7 };
const UNKNOWN_SPACE: PidSpace = { pidNamespace: null, bootId: null, initStartTime: null };

let procRoot = "";

function write(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

// A /proc/<pid>/stat line: after "(comm) " come state, ppid, pgrp ... and field 22, starttime.
function statLine(pid: number, comm: string, ppid: number, startTime: number): string {
  const fields = ["S", ppid, pid, pid, 0, -1, 4194560, 100, 0, 0, 0, 5, 2, 0, 0, 20, 0, 1, 0];
  fields.push(startTime, 1000, 200);
  return `${pid} (${comm}) ${fields.join(" ")}\n`;
}

// rssKb null writes a status without VmRSS, as a zombie or a kernel thread has.
function addProcess(pid: number, ppid: number, startTime: number, rssKb: number | null): void {
  write(join(procRoot, String(pid), "stat"), statLine(pid, "node", ppid, startTime));
  const rss = rssKb === null ? "State:\tZ (zombie)\n" : `VmRSS:\t  ${rssKb} kB\n`;
  write(join(procRoot, String(pid), "status"), `Name:\tnode\n${rss}`);
}

function writePidSpace(space: PidSpace): void {
  mkdirSync(join(procRoot, "self", "ns"), { recursive: true });
  symlinkSync(space.pidNamespace ?? "", join(procRoot, "self", "ns", "pid"));
  write(join(procRoot, "sys", "kernel", "random", "boot_id"), `${space.bootId}\n`);
  addProcess(1, 0, space.initStartTime ?? 0, 1000);
}

function shim(pid: number, startTime: number, space: PidSpace = SPACE): ShimProcess {
  return { pid, startTime, ...space };
}

beforeEach(() => {
  procRoot = join(mkdtempSync(join(tmpdir(), "heavy-gate-procfs-")), "proc");
  mkdirSync(procRoot);
});

afterEach(() => {
  rmSync(dirname(procRoot), { recursive: true, force: true });
});

describe("stat and status parsers", () => {
  it("count fields from the last parenthesis, past a name holding spaces and parentheses", () => {
    const stat = statLine(42, "my (odd) name", 7, 123456);
    expect(parseStatPpid(stat)).toBe(7);
    expect(parseStatStartTime(stat)).toBe(123456);
  });

  it("return null for a line without a name", () => {
    expect(parseStatPpid("42 S 7")).toBeNull();
    expect(parseStatStartTime("42 S 7")).toBeNull();
  });

  it("read VmRSS in bytes, and null without the line", () => {
    expect(parseVmRssBytes("Name:\tnode\nVmRSS:\t  2048 kB\n")).toBe(2 * MIB);
    expect(parseVmRssBytes("Name:\tnode\n")).toBeNull();
  });
});

describe("readStartTime", () => {
  it("reads a pid's start time, and null once the pid is gone", () => {
    addProcess(500, 1, 9000, 10);
    expect(readStartTime(500, procRoot)).toBe(9000);
    expect(readStartTime(501, procRoot)).toBeNull();
  });
});

describe("readPidSpace", () => {
  it("reads the pid namespace, the boot id and the start time of pid 1", () => {
    writePidSpace(SPACE);
    expect(readPidSpace(procRoot)).toEqual(SPACE);
  });

  it("reads nulls without /proc", () => {
    expect(readPidSpace(join(procRoot, "missing"))).toEqual(UNKNOWN_SPACE);
  });
});

describe("samePidSpace", () => {
  it("needs every field known and equal", () => {
    expect(samePidSpace(SPACE, { ...SPACE })).toBe(true);
    expect(samePidSpace(SPACE, { ...SPACE, bootId: "boot-2" })).toBe(false);
    expect(samePidSpace(SPACE, { ...SPACE, initStartTime: 8 })).toBe(false);
    expect(samePidSpace(UNKNOWN_SPACE, UNKNOWN_SPACE)).toBe(false);
  });
});

describe("readTreeRss", () => {
  it("sums the pid and every descendant, and nothing else", () => {
    addProcess(100, 1, 10, 1024);
    addProcess(101, 100, 11, 2048);
    addProcess(102, 101, 12, 4096);
    addProcess(200, 1, 13, 8192);
    expect(readTreeRss(100, procRoot)).toBe(7 * MIB);
  });

  it("counts a process without VmRSS as 0, and returns null once the pid is gone", () => {
    addProcess(100, 1, 10, 1024);
    addProcess(101, 100, 11, null);
    expect(readTreeRss(100, procRoot)).toBe(MIB);
    expect(readTreeRss(300, procRoot)).toBeNull();
  });
});

describe("readShimRss", () => {
  it("reads the shim's tree when its pid space and start time match", () => {
    writePidSpace(SPACE);
    addProcess(100, 1, 10, 1024);
    addProcess(101, 100, 11, 3072);
    expect(readShimRss(shim(100, 10), procRoot)).toBe(4 * MIB);
  });

  it("returns null once the pid names a later process", () => {
    writePidSpace(SPACE);
    addProcess(100, 1, 99, 1024);
    expect(readShimRss(shim(100, 10), procRoot)).toBeNull();
  });

  it("returns null for a shim from another pid namespace", () => {
    writePidSpace(SPACE);
    addProcess(100, 1, 10, 1024);
    const elsewhere = { ...SPACE, pidNamespace: "pid:[4026532999]" };
    expect(readShimRss(shim(100, 10, elsewhere), procRoot)).toBeNull();
  });
});
```

- [ ] **Step 7: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/procfs.posix.test.ts --bail=1`

Expected: FAIL, `Cannot find module './procfs.js'`.

- [ ] **Step 8: Write the /proc readers**

Create `plugins/heavy-command-gate/server/procfs.ts`:

```ts
import { readFileSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";
import type { ShimProcess } from "./protocol.js";

export interface PidSpace {
  pidNamespace: string | null;
  bootId: string | null;
  initStartTime: number | null;
}

const PID_ENTRY = /^\d+$/;
const VM_RSS_LINE = /^VmRSS:\s+(\d+) kB$/m;

// Field 2 (comm) is the raw process name and may hold spaces and parentheses, so fields are counted
// from the last ")". After ") " come [0] state, [1] ppid ... [19] starttime (field 22).
function statField(stat: string, index: number): number | null {
  const commEnd = stat.lastIndexOf(")");
  if (commEnd < 0) return null;
  const value = Number(stat.slice(commEnd + 2).split(" ")[index]);
  return Number.isSafeInteger(value) ? value : null;
}

export function parseStatPpid(stat: string): number | null {
  return statField(stat, 1);
}

export function parseStatStartTime(stat: string): number | null {
  return statField(stat, 19);
}

export function parseVmRssBytes(status: string): number | null {
  const match = VM_RSS_LINE.exec(status);
  return match ? Number(match[1]) * 1024 : null;
}

function readOrNull(read: () => string): string | null {
  try {
    return read();
  } catch {
    return null;
  }
}

export function readStartTime(pid: number, procRoot = "/proc"): number | null {
  const stat = readOrNull(() => readFileSync(join(procRoot, String(pid), "stat"), "utf8"));
  return stat === null ? null : parseStatStartTime(stat);
}

/** Which processes pids name here; each field is null without /proc. */
export function readPidSpace(procRoot = "/proc"): PidSpace {
  return {
    pidNamespace: readOrNull(() => readlinkSync(join(procRoot, "self", "ns", "pid"))),
    bootId: readOrNull(() =>
      readFileSync(join(procRoot, "sys", "kernel", "random", "boot_id"), "utf8").trim(),
    ),
    initStartTime: readStartTime(1, procRoot),
  };
}

// A namespace inode can be reissued to a restarted container on the same boot, and that
// container's pid 1 always starts later, so all three must match. Unknown never matches.
export function samePidSpace(a: PidSpace, b: PidSpace): boolean {
  return (
    a.pidNamespace !== null &&
    a.bootId !== null &&
    a.initStartTime !== null &&
    a.pidNamespace === b.pidNamespace &&
    a.bootId === b.bootId &&
    a.initStartTime === b.initStartTime
  );
}

/**
 * VmRSS of the pid and every descendant by ppid; null when none of them could be read. A process
 * without VmRSS (a zombie) adds 0. One /proc scan per call, synchronous like shared-mcp's walk.
 */
export function readTreeRss(rootPid: number, procRoot = "/proc"): number | null {
  let names: string[];
  try {
    names = readdirSync(procRoot);
  } catch {
    return null;
  }
  const children = new Map<number, number[]>();
  for (const name of names) {
    if (!PID_ENTRY.test(name)) continue;
    const stat = readOrNull(() => readFileSync(join(procRoot, name, "stat"), "utf8"));
    const ppid = stat === null ? null : parseStatPpid(stat);
    if (ppid === null) continue;
    const siblings = children.get(ppid);
    if (siblings) siblings.push(Number(name));
    else children.set(ppid, [Number(name)]);
  }
  // A Set iterator also visits members added during the loop, so this walks the whole subtree.
  const tree = new Set([rootPid]);
  for (const pid of tree) {
    for (const child of children.get(pid) ?? []) tree.add(child);
  }
  let total: number | null = null;
  for (const pid of tree) {
    const status = readOrNull(() => readFileSync(join(procRoot, String(pid), "status"), "utf8"));
    if (status !== null) total = (total ?? 0) + (parseVmRssBytes(status) ?? 0);
  }
  return total;
}

/** The RSS of a shim's process tree, or null when its pid may name another process by now. */
export function readShimRss(shim: ShimProcess, procRoot = "/proc"): number | null {
  if (shim.startTime === null) return null;
  if (!samePidSpace(shim, readPidSpace(procRoot))) return null;
  if (readStartTime(shim.pid, procRoot) !== shim.startTime) return null;
  return readTreeRss(shim.pid, procRoot);
}
```

- [ ] **Step 9: Run the test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/procfs.posix.test.ts --bail=1`

Expected: PASS, 12 tests.

- [ ] **Step 10: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/heavy-command-gate/server && npm run lint -- plugins/heavy-command-gate/server
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: `Found 0 warnings and 0 errors.`, then a typecheck with exit 0.

- [ ] **Step 11: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/heavy-command-gate || { echo "STOP: not on feat/heavy-command-gate"; exit 1; }
git -C /workspace/utils/paseo add plugins/heavy-command-gate/server/protocol.ts plugins/heavy-command-gate/server/memory.ts plugins/heavy-command-gate/server/memory.test.ts plugins/heavy-command-gate/server/procfs.ts plugins/heavy-command-gate/server/procfs.posix.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): heavy-command-gate protocol, memory and /proc readers" -- plugins/heavy-command-gate/server/protocol.ts plugins/heavy-command-gate/server/memory.ts plugins/heavy-command-gate/server/memory.test.ts plugins/heavy-command-gate/server/procfs.ts plugins/heavy-command-gate/server/procfs.posix.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages
```

Expected: the hook passes and git prints `5 files changed`; the identity line is `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` lists exactly the five paths; `status` prints nothing. On a hook failure, report and stop.

---

### Task 4: Admission function

**Files:**

- Create: `plugins/heavy-command-gate/server/admission.ts`
- Test: `plugins/heavy-command-gate/server/admission.test.ts`

**Interfaces:**

Consumes: nothing from earlier tasks.

Produces (`plugins/heavy-command-gate/server/admission.ts`):

- `export type BlockReason = "slot" | "memory"`
- `export interface QueuedCommand { id: string; estimateBytes: number; queuedAt: number }`
- `export interface HeldCommand { estimateBytes: number; rssBytes: number | null }`
- `export interface AdmissionInput { queue: readonly QueuedCommand[]; held: readonly HeldCommand[]; slots: number; reserveBytes: number; freeBytes: number | null; now: number; starvationMs: number }`
- `export interface Admission { id: string; forced: boolean }`
- `export interface AdmissionDecision { admitted: Admission[]; blockedOn: BlockReason | null }`
- `export function decideAdmission(input: AdmissionInput): AdmissionDecision` (pure; `admitted` is always a prefix of `queue`, oldest first)

- [ ] **Step 1: Write the failing admission test**

Create `plugins/heavy-command-gate/server/admission.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  decideAdmission,
  type AdmissionInput,
  type HeldCommand,
  type QueuedCommand,
} from "./admission.js";

const GIB = 1024 ** 3;
const NOW = 10_000_000;
const STARVATION_MS = 300_000;

function queued(id: string, estimateGb: number, waitedMs = 0): QueuedCommand {
  return { id, estimateBytes: estimateGb * GIB, queuedAt: NOW - waitedMs };
}

function held(estimateGb: number, rssGb: number | null): HeldCommand {
  return { estimateBytes: estimateGb * GIB, rssBytes: rssGb === null ? null : rssGb * GIB };
}

// One slot, a 1 GB reserve and 8 GB free unless a test says otherwise.
function input(overrides: Partial<AdmissionInput>): AdmissionInput {
  return {
    queue: [],
    held: [],
    slots: 1,
    reserveBytes: GIB,
    freeBytes: 8 * GIB,
    now: NOW,
    starvationMs: STARVATION_MS,
    ...overrides,
  };
}

describe("decideAdmission", () => {
  it("admits the oldest waiter when a slot is free and its memory fits", () => {
    expect(decideAdmission(input({ queue: [queued("a", 3)] }))).toEqual({
      admitted: [{ id: "a", forced: false }],
      blockedOn: null,
    });
  });

  it("waits on a slot while every slot is held", () => {
    expect(decideAdmission(input({ queue: [queued("a", 2)], held: [held(3, 3)] }))).toEqual({
      admitted: [],
      blockedOn: "slot",
    });
  });

  it("fills the free slots in queue order", () => {
    const queue = [queued("a", 1), queued("b", 1), queued("c", 1)];
    expect(decideAdmission(input({ queue, slots: 2, freeBytes: 16 * GIB }))).toEqual({
      admitted: [
        { id: "a", forced: false },
        { id: "b", forced: false },
      ],
      blockedOn: "slot",
    });
  });

  it("waits on memory while free memory is below the estimate plus the reserve", () => {
    const decision = decideAdmission(input({ queue: [queued("a", 3)], freeBytes: 3.5 * GIB }));
    expect(decision).toEqual({ admitted: [], blockedOn: "memory" });
  });

  it("admits at exactly the estimate plus the reserve", () => {
    const decision = decideAdmission(input({ queue: [queued("a", 3)], freeBytes: 4 * GIB }));
    expect(decision.admitted).toEqual([{ id: "a", forced: false }]);
  });

  it("gates on slots alone when free memory is unknown", () => {
    const decision = decideAdmission(input({ queue: [queued("a", 1024)], freeBytes: null }));
    expect(decision).toEqual({ admitted: [{ id: "a", forced: false }], blockedOn: null });
  });

  it("keeps back what a running command was promised and has not used yet", () => {
    // 3 GB promised, 1 GB in use: 2 GB of the 4.5 GB free is spoken for.
    const decision = decideAdmission(
      input({ queue: [queued("a", 2)], held: [held(3, 1)], slots: 2, freeBytes: 4.5 * GIB }),
    );
    expect(decision).toEqual({ admitted: [], blockedOn: "memory" });
  });

  it("keeps back the whole estimate of a running command whose RSS is unknown", () => {
    const decision = decideAdmission(
      input({ queue: [queued("a", 2)], held: [held(3, null)], slots: 2, freeBytes: 5.5 * GIB }),
    );
    expect(decision).toEqual({ admitted: [], blockedOn: "memory" });
  });

  it("keeps back what it promised to commands admitted in the same pass", () => {
    const queue = [queued("a", 2), queued("b", 2), queued("c", 2)];
    expect(decideAdmission(input({ queue, slots: 3, freeBytes: 6 * GIB }))).toEqual({
      admitted: [
        { id: "a", forced: false },
        { id: "b", forced: false },
      ],
      blockedOn: "memory",
    });
  });

  it("keeps FIFO order: a small command behind a blocked one waits too", () => {
    const queue = [queued("a", 3), queued("b", 0.5)];
    expect(decideAdmission(input({ queue, freeBytes: 3 * GIB }))).toEqual({
      admitted: [],
      blockedOn: "memory",
    });
  });

  it("forces the oldest waiter after the starvation time when nothing runs", () => {
    const queue = [queued("a", 3, STARVATION_MS), queued("b", 3, STARVATION_MS)];
    expect(decideAdmission(input({ queue, slots: 2, freeBytes: GIB }))).toEqual({
      admitted: [{ id: "a", forced: true }],
      blockedOn: "memory",
    });
  });

  it("never forces while a command holds a slot", () => {
    const decision = decideAdmission(
      input({
        queue: [queued("a", 3, 2 * STARVATION_MS)],
        held: [held(1, 1)],
        slots: 2,
        freeBytes: GIB,
      }),
    );
    expect(decision).toEqual({ admitted: [], blockedOn: "memory" });
  });

  it("decides nothing for an empty queue", () => {
    expect(decideAdmission(input({ held: [held(3, 3)] }))).toEqual({
      admitted: [],
      blockedOn: null,
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/admission.test.ts --bail=1`

Expected: FAIL, `Cannot find module './admission.js'`.

- [ ] **Step 3: Write the admission function**

Create `plugins/heavy-command-gate/server/admission.ts`:

```ts
export type BlockReason = "slot" | "memory";

export interface QueuedCommand {
  id: string;
  estimateBytes: number;
  queuedAt: number;
}

export interface HeldCommand {
  estimateBytes: number;
  /** RSS of its process tree; null when the gate cannot read it. */
  rssBytes: number | null;
}

export interface AdmissionInput {
  /** Oldest first. */
  queue: readonly QueuedCommand[];
  held: readonly HeldCommand[];
  slots: number;
  reserveBytes: number;
  /** null when no reading exists: slots alone decide. */
  freeBytes: number | null;
  now: number;
  starvationMs: number;
}

export interface Admission {
  id: string;
  /** Started by the starvation guard without enough free memory. */
  forced: boolean;
}

export interface AdmissionDecision {
  /** A prefix of the queue, oldest first. */
  admitted: Admission[];
  /** Why the oldest command left waits; null when none is left. */
  blockedOn: BlockReason | null;
}

/**
 * Admits waiters in queue order while a slot is free and free memory covers the estimate plus the
 * reserve. Free memory is a reading of what processes use now, so memory promised to a running
 * command that it has not touched yet (its estimate minus its RSS) is kept back, as is the whole
 * estimate of a command admitted in this pass. A waiter older than the starvation time starts when
 * nothing holds a slot: the memory is then held by something the gate cannot free.
 */
export function decideAdmission(input: AdmissionInput): AdmissionDecision {
  const admitted: Admission[] = [];
  let holders = input.held.length;
  let promised = 0;
  for (const command of input.held) {
    promised += Math.max(0, command.estimateBytes - (command.rssBytes ?? 0));
  }
  for (const command of input.queue) {
    if (holders >= input.slots) return { admitted, blockedOn: "slot" };
    const needed = command.estimateBytes + input.reserveBytes;
    const fits = input.freeBytes === null || input.freeBytes - promised >= needed;
    const starved = holders === 0 && input.now - command.queuedAt >= input.starvationMs;
    if (!fits && !starved) return { admitted, blockedOn: "memory" };
    admitted.push({ id: command.id, forced: !fits });
    holders += 1;
    promised += command.estimateBytes;
  }
  return { admitted, blockedOn: null };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/admission.test.ts --bail=1`

Expected: PASS, 13 tests.

- [ ] **Step 5: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/heavy-command-gate/server/admission.ts plugins/heavy-command-gate/server/admission.test.ts && npm run lint -- plugins/heavy-command-gate/server/admission.ts plugins/heavy-command-gate/server/admission.test.ts
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: `Found 0 warnings and 0 errors.`, then a typecheck with exit 0.

- [ ] **Step 6: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/heavy-command-gate || { echo "STOP: not on feat/heavy-command-gate"; exit 1; }
git -C /workspace/utils/paseo add plugins/heavy-command-gate/server/admission.ts plugins/heavy-command-gate/server/admission.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): heavy-command-gate admission function" -- plugins/heavy-command-gate/server/admission.ts plugins/heavy-command-gate/server/admission.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages
```

Expected: the hook passes and git prints `2 files changed`; the identity line is `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` lists exactly the two paths; `status` prints nothing. On a hook failure, report and stop.

---

### Task 5: Gate core

**Files:**

- Create: `plugins/heavy-command-gate/server/gate.ts`
- Test: `plugins/heavy-command-gate/server/gate.test.ts`

**Interfaces:**

Consumes:

- `decideAdmission(input: AdmissionInput): AdmissionDecision` and `BlockReason` from `server/admission.ts` (Task 4).
- `ShimHello`, `ShimProcess`, `ServerNotice` from `server/protocol.ts` (Task 3).
- `RunningCommand`, `WaitingCommand` from `shared/rpc.ts` (Task 1).

Produces (`plugins/heavy-command-gate/server/gate.ts`):

- `export const TICK_MS = 2_000`, `export const NOTICE_MS = 30_000`, `export const STARVATION_MS = 300_000`
- `export interface GateConfig { enabled: boolean; slots: number; reserveBytes: number }`
- `export interface GatePeer { send(notice: ServerNotice): void }`
- `export interface GateMembership { join(hello: ShimHello, peer: GatePeer): string; leave(id: string): void }` (what Task 6's socket server needs; `join` sends `go` or `wait` through the peer before it returns and throws once the gate is stopped)
- `export interface GateDeps { now(): number; readFreeMemory(): number | null; readRss(shim: ShimProcess): number | null; startTimer(callback: () => void, ms: number): () => void; log(message: string): void }`
- `export interface GateSnapshot { freeBytes: number | null; running: RunningCommand[]; waiting: WaitingCommand[] }` (`agentTitle` is always null here; Task 8 fills it)
- `export interface Gate extends GateMembership { configure(config: GateConfig): void; snapshot(): GateSnapshot; stop(): void }`
- `export interface GateOptions { config: GateConfig; deps: GateDeps }`
- `export function createGate(options: GateOptions): Gate`

- [ ] **Step 1: Write the failing gate test**

Create `plugins/heavy-command-gate/server/gate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createGate, type Gate, type GateConfig, type GateDeps } from "./gate.js";
import type { ServerNotice, ShimHello } from "./protocol.js";

const GIB = 1024 ** 3;
const START = 1_000_000;

interface TimerState {
  callback: (() => void) | null;
  ms: number | null;
  starts: number;
  stops: number;
}

interface Joined {
  id: string;
  pid: number;
  notices: ServerNotice[];
}

interface Harness {
  gate: Gate;
  clock: { now: number };
  memory: { free: number | null };
  rss: Map<number, number>;
  timer: TimerState;
  logs: string[];
  join(command: string, estimateGb: number, agentId?: string | null): Joined;
  advance(ms: number): void;
  /** Runs the gate's 2 s tick as its timer would. */
  tick(): void;
}

function hello(
  command: string,
  estimateGb: number,
  pid: number,
  agentId: string | null,
): ShimHello {
  return {
    type: "hello",
    version: 1,
    command,
    estimateBytes: estimateGb * GIB,
    agentId,
    process: {
      pid,
      startTime: 100 + pid,
      pidNamespace: "pid:[1]",
      bootId: "boot",
      initStartTime: 1,
    },
  };
}

// One slot and a 1 GB reserve, 16 GB free, unless a test changes them.
function createHarness(config: Partial<GateConfig> = {}): Harness {
  const clock = { now: START };
  const memory: { free: number | null } = { free: 16 * GIB };
  const rss = new Map<number, number>();
  const timer: TimerState = { callback: null, ms: null, starts: 0, stops: 0 };
  const logs: string[] = [];
  let nextPid = 1000;
  const deps: GateDeps = {
    now: () => clock.now,
    readFreeMemory: () => memory.free,
    readRss: (shim) => rss.get(shim.pid) ?? null,
    startTimer(callback, ms) {
      timer.callback = callback;
      timer.ms = ms;
      timer.starts += 1;
      return () => {
        timer.callback = null;
        timer.stops += 1;
      };
    },
    log(message) {
      logs.push(message);
    },
  };
  const gate = createGate({
    config: { enabled: true, slots: 1, reserveBytes: GIB, ...config },
    deps,
  });
  return {
    gate,
    clock,
    memory,
    rss,
    timer,
    logs,
    join(command, estimateGb, agentId = "agent-1") {
      const notices: ServerNotice[] = [];
      nextPid += 1;
      const id = gate.join(hello(command, estimateGb, nextPid, agentId), {
        send(notice) {
          notices.push(notice);
        },
      });
      return { id, pid: nextPid, notices };
    },
    advance(ms) {
      clock.now += ms;
    },
    tick() {
      if (timer.callback === null) throw new Error("the gate's timer is not running");
      timer.callback();
    },
  };
}

describe("createGate", () => {
  it("starts a command at once when a slot is free", () => {
    const h = createHarness();
    const a = h.join("tsc --noEmit", 3);
    expect(a.notices).toEqual([
      { type: "go", forced: false, freeBytes: 16 * GIB, neededBytes: 4 * GIB, waitedMs: 0 },
    ]);
  });

  it("queues a second command and tells it that it waits on the slot", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2);
    expect(b.notices).toEqual([
      { type: "wait", ahead: 0, freeBytes: 16 * GIB, neededBytes: 3 * GIB, waitingOn: "slot" },
    ]);
  });

  it("tells a third command how many wait ahead of it", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    h.join("vitest run", 2);
    const c = h.join("jest", 2);
    expect(c.notices).toEqual([
      { type: "wait", ahead: 1, freeBytes: 16 * GIB, neededBytes: 3 * GIB, waitingOn: "slot" },
    ]);
  });

  it("starts the next waiter when the running command leaves", () => {
    const h = createHarness();
    const a = h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2);
    h.advance(5_000);
    h.gate.leave(a.id);
    expect(b.notices[1]).toEqual({
      type: "go",
      forced: false,
      freeBytes: 16 * GIB,
      neededBytes: 3 * GIB,
      waitedMs: 5_000,
    });
  });

  it("waits on memory when the estimate and the reserve do not fit", () => {
    const h = createHarness();
    h.memory.free = 3.5 * GIB;
    const a = h.join("tsc --noEmit", 3);
    expect(a.notices).toEqual([
      { type: "wait", ahead: 0, freeBytes: 3.5 * GIB, neededBytes: 4 * GIB, waitingOn: "memory" },
    ]);
  });

  it("reads memory again on every tick and starts the command once it fits", () => {
    const h = createHarness();
    h.memory.free = 3.5 * GIB;
    const a = h.join("tsc --noEmit", 3);
    h.memory.free = 8 * GIB;
    h.advance(2_000);
    h.tick();
    expect(a.notices[1]).toEqual({
      type: "go",
      forced: false,
      freeBytes: 8 * GIB,
      neededBytes: 4 * GIB,
      waitedMs: 2_000,
    });
  });

  it("repeats the wait notice every 30 s, not on every tick", () => {
    const h = createHarness();
    h.memory.free = GIB;
    const a = h.join("tsc --noEmit", 3);
    for (let tick = 0; tick < 14; tick += 1) {
      h.advance(2_000);
      h.tick();
    }
    expect(a.notices).toHaveLength(1);
    h.advance(2_000);
    h.tick();
    expect(a.notices).toHaveLength(2);
    expect(a.notices[1]).toMatchObject({ type: "wait", waitingOn: "memory" });
  });

  it("runs its 2 s timer only while commands wait", () => {
    const h = createHarness();
    const a = h.join("tsc --noEmit", 3);
    expect(h.timer.starts).toBe(0);
    h.join("vitest run", 2);
    expect(h.timer).toMatchObject({ starts: 1, ms: 2_000, stops: 0 });
    h.gate.leave(a.id);
    expect(h.timer).toMatchObject({ starts: 1, stops: 1, callback: null });
  });

  it("starts the oldest waiter after 5 minutes with nothing running, and logs no command line", () => {
    const h = createHarness();
    h.memory.free = GIB;
    const a = h.join("tsc --project secret-name", 3);
    h.advance(300_000);
    h.tick();
    expect(a.notices[1]).toEqual({
      type: "go",
      forced: true,
      freeBytes: GIB,
      neededBytes: 4 * GIB,
      waitedMs: 300_000,
    });
    expect(h.logs).toEqual([
      "heavy-command-gate: started a command after 5 min without enough free memory",
    ]);
    expect(h.gate.snapshot().running[0]?.forced).toBe(true);
  });

  it("starts every waiter when switched off, and gates again when switched on", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2);
    const c = h.join("jest", 2);
    h.gate.configure({ enabled: false, slots: 1, reserveBytes: GIB });
    expect(b.notices[1]).toMatchObject({ type: "go", forced: false });
    expect(c.notices[1]).toMatchObject({ type: "go", forced: false });
    h.gate.configure({ enabled: true, slots: 1, reserveBytes: GIB });
    const d = h.join("tsc --noEmit", 3);
    expect(d.notices).toEqual([
      { type: "wait", ahead: 0, freeBytes: 16 * GIB, neededBytes: 4 * GIB, waitingOn: "slot" },
    ]);
  });

  it("starts a waiter at once when the slot count goes up", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2);
    h.gate.configure({ enabled: true, slots: 2, reserveBytes: GIB });
    expect(b.notices[1]).toMatchObject({ type: "go", forced: false });
  });

  it("drops a waiter that leaves and moves the ones behind it up", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2);
    const c = h.join("jest", 2);
    h.gate.leave(b.id);
    const { waiting } = h.gate.snapshot();
    expect(waiting.map((command) => [command.id, command.position])).toEqual([[c.id, 1]]);
  });

  it("reports running and waiting commands with their agents, pids, times and memory", () => {
    const h = createHarness();
    const a = h.join("tsc --noEmit", 3);
    const b = h.join("vitest run", 2, null);
    h.rss.set(a.pid, 2.5 * GIB);
    h.advance(7_000);
    expect(h.gate.snapshot()).toEqual({
      freeBytes: 16 * GIB,
      running: [
        {
          id: a.id,
          agentId: "agent-1",
          agentTitle: null,
          command: "tsc --noEmit",
          pid: a.pid,
          elapsedMs: 7_000,
          rssBytes: 2.5 * GIB,
          estimateBytes: 3 * GIB,
          forced: false,
        },
      ],
      waiting: [
        {
          id: b.id,
          agentId: null,
          agentTitle: null,
          command: "vitest run",
          pid: b.pid,
          position: 1,
          waitedMs: 7_000,
          estimateBytes: 2 * GIB,
          waitingOn: "slot",
        },
      ],
    });
  });

  it("clears everything when stopped and refuses new commands", () => {
    const h = createHarness();
    h.join("tsc --noEmit", 3);
    h.join("vitest run", 2);
    h.gate.stop();
    expect(h.timer.stops).toBe(1);
    expect(h.gate.snapshot()).toMatchObject({ running: [], waiting: [] });
    expect(() => h.join("jest", 2)).toThrow("the heavy-command gate is stopped");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/gate.test.ts --bail=1`

Expected: FAIL, `Cannot find module './gate.js'`.

- [ ] **Step 3: Write the gate**

Create `plugins/heavy-command-gate/server/gate.ts`:

```ts
import type { RunningCommand, WaitingCommand } from "../shared/rpc.js";
import { decideAdmission, type BlockReason } from "./admission.js";
import type { ServerNotice, ShimHello, ShimProcess } from "./protocol.js";

/** The spec re-evaluates every 2 s and on every release. */
export const TICK_MS = 2_000;
/** A waiting shim prints its wait line every 30 s. */
export const NOTICE_MS = 30_000;
/** With nothing local running, the oldest waiter starts after 5 minutes anyway. */
export const STARVATION_MS = 300_000;

export interface GateConfig {
  enabled: boolean;
  slots: number;
  reserveBytes: number;
}

export interface GatePeer {
  send(notice: ServerNotice): void;
}

/** What the socket server needs: one join per shim connection, one leave when it closes. */
export interface GateMembership {
  /** Queues the command and returns its id. Sends `go` or `wait` through the peer first. */
  join(hello: ShimHello, peer: GatePeer): string;
  leave(id: string): void;
}

export interface GateDeps {
  now(): number;
  readFreeMemory(): number | null;
  readRss(shim: ShimProcess): number | null;
  /** Calls back every `ms` until the returned function is called. */
  startTimer(callback: () => void, ms: number): () => void;
  log(message: string): void;
}

export interface GateSnapshot {
  freeBytes: number | null;
  running: RunningCommand[];
  waiting: WaitingCommand[];
}

export interface Gate extends GateMembership {
  configure(config: GateConfig): void;
  snapshot(): GateSnapshot;
  stop(): void;
}

export interface GateOptions {
  config: GateConfig;
  deps: GateDeps;
}

interface Member {
  id: string;
  hello: ShimHello;
  peer: GatePeer;
  queuedAt: number;
  lastNoticeAt: number;
  startedAt: number;
  forced: boolean;
}

export function createGate(options: GateOptions): Gate {
  const { deps } = options;
  let config = options.config;
  const waiting: Member[] = [];
  const running = new Map<string, Member>();
  let nextId = 1;
  // Every waiter reports the reason the oldest one waits: FIFO means none starts before it.
  let blockedOn: BlockReason = "slot";
  let freeBytes: number | null = null;
  let stopTimer: (() => void) | null = null;
  let stopped = false;

  function neededBytes(member: Member): number {
    return member.hello.estimateBytes + config.reserveBytes;
  }

  function sendWait(member: Member, position: number): void {
    member.lastNoticeAt = deps.now();
    member.peer.send({
      type: "wait",
      ahead: position - 1,
      freeBytes,
      neededBytes: neededBytes(member),
      waitingOn: blockedOn,
    });
  }

  function admit(member: Member, forced: boolean): void {
    const now = deps.now();
    member.startedAt = now;
    member.forced = forced;
    running.set(member.id, member);
    const waitedMs = Math.max(0, now - member.queuedAt);
    if (forced) {
      // The command line can hold paths and arguments, so the daemon log never gets it.
      const minutes = Math.round(waitedMs / 60_000);
      deps.log(
        `heavy-command-gate: started a command after ${minutes} min without enough free memory`,
      );
    }
    member.peer.send({ type: "go", forced, freeBytes, neededBytes: neededBytes(member), waitedMs });
  }

  function admitWaiters(): void {
    freeBytes = deps.readFreeMemory();
    if (!config.enabled) {
      for (const member of waiting.splice(0)) admit(member, false);
      return;
    }
    const decision = decideAdmission({
      queue: waiting.map((member) => ({
        id: member.id,
        estimateBytes: member.hello.estimateBytes,
        queuedAt: member.queuedAt,
      })),
      held: [...running.values()].map((member) => ({
        estimateBytes: member.hello.estimateBytes,
        rssBytes: deps.readRss(member.hello.process),
      })),
      slots: config.slots,
      reserveBytes: config.reserveBytes,
      freeBytes,
      now: deps.now(),
      starvationMs: STARVATION_MS,
    });
    // decideAdmission admits a prefix of the queue, in order.
    const admitted = waiting.splice(0, decision.admitted.length);
    for (const [index, member] of admitted.entries()) {
      admit(member, decision.admitted[index].forced);
    }
    if (decision.blockedOn !== null) blockedOn = decision.blockedOn;
  }

  function syncTimer(): void {
    if (waiting.length > 0 && stopTimer === null && !stopped) {
      stopTimer = deps.startTimer(tick, TICK_MS);
    }
    if (waiting.length === 0 && stopTimer !== null) {
      stopTimer();
      stopTimer = null;
    }
  }

  function evaluate(): void {
    if (waiting.length > 0) admitWaiters();
    syncTimer();
  }

  function tick(): void {
    evaluate();
    const now = deps.now();
    for (const [index, member] of waiting.entries()) {
      if (now - member.lastNoticeAt >= NOTICE_MS) sendWait(member, index + 1);
    }
  }

  return {
    join(hello, peer) {
      if (stopped) throw new Error("the heavy-command gate is stopped");
      const now = deps.now();
      const member: Member = {
        id: String(nextId),
        hello,
        peer,
        queuedAt: now,
        lastNoticeAt: now,
        startedAt: now,
        forced: false,
      };
      nextId += 1;
      waiting.push(member);
      evaluate();
      const index = waiting.indexOf(member);
      if (index >= 0) sendWait(member, index + 1);
      return member.id;
    },
    leave(id) {
      if (running.delete(id)) {
        evaluate();
        return;
      }
      const index = waiting.findIndex((member) => member.id === id);
      if (index < 0) return;
      waiting.splice(index, 1);
      evaluate();
    },
    configure(next) {
      config = next;
      evaluate();
    },
    snapshot() {
      const now = deps.now();
      return {
        freeBytes: deps.readFreeMemory(),
        running: [...running.values()].map((member) => ({
          id: member.id,
          agentId: member.hello.agentId,
          agentTitle: null,
          command: member.hello.command,
          pid: member.hello.process.pid,
          elapsedMs: Math.max(0, now - member.startedAt),
          rssBytes: deps.readRss(member.hello.process),
          estimateBytes: member.hello.estimateBytes,
          forced: member.forced,
        })),
        waiting: waiting.map((member, index) => ({
          id: member.id,
          agentId: member.hello.agentId,
          agentTitle: null,
          command: member.hello.command,
          pid: member.hello.process.pid,
          position: index + 1,
          waitedMs: Math.max(0, now - member.queuedAt),
          estimateBytes: member.hello.estimateBytes,
          waitingOn: blockedOn,
        })),
      };
    },
    stop() {
      stopped = true;
      waiting.length = 0;
      running.clear();
      syncTimer();
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/gate.test.ts --bail=1`

Expected: PASS, 14 tests.

- [ ] **Step 5: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/heavy-command-gate/server/gate.ts plugins/heavy-command-gate/server/gate.test.ts && npm run lint -- plugins/heavy-command-gate/server/gate.ts plugins/heavy-command-gate/server/gate.test.ts
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: `Found 0 warnings and 0 errors.`, then a typecheck with exit 0.

- [ ] **Step 6: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/heavy-command-gate || { echo "STOP: not on feat/heavy-command-gate"; exit 1; }
git -C /workspace/utils/paseo add plugins/heavy-command-gate/server/gate.ts plugins/heavy-command-gate/server/gate.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): heavy-command-gate queue and holders" -- plugins/heavy-command-gate/server/gate.ts plugins/heavy-command-gate/server/gate.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages
```

Expected: the hook passes and git prints `2 files changed`; the identity line is `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` lists exactly the two paths; `status` prints nothing. On a hook failure, report and stop.

---

### Task 6: Gate socket server

**Files:**

- Create: `plugins/heavy-command-gate/server/socket-server.ts`
- Test: `plugins/heavy-command-gate/server/socket-server.posix.test.ts` (Unix sockets)

**Interfaces:**

Consumes:

- `GateMembership { join(hello: ShimHello, peer: GatePeer): string; leave(id: string): void }` from `server/gate.ts` (Task 5).
- `ShimHelloSchema`, `ShimHello`, `ServerNotice`, `MAX_LINE_LENGTH` from `server/protocol.ts` (Task 3).

Produces (`plugins/heavy-command-gate/server/socket-server.ts`):

- `export interface GateSocketServer { close(): Promise<void> }` (destroys every connection, then the listener; Node removes the socket file; never rejects)
- `export interface GateSocketOptions { socketPath: string; gate: GateMembership; helloTimeoutMs?: number }` (default 5000)
- `export function listenGateSocket(options: GateSocketOptions): Promise<GateSocketServer | null>`: null when a live listener already answers on `socketPath` (another daemon on the same home); a socket file that refuses connections is removed and claimed. Rejects on any other listen error.

- [ ] **Step 1: Write the failing socket server test**

Create `plugins/heavy-command-gate/server/socket-server.posix.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GateMembership, GatePeer } from "./gate.js";
import { MAX_LINE_LENGTH, type ShimHello } from "./protocol.js";
import { listenGateSocket, type GateSocketServer } from "./socket-server.js";

interface FakeMembership extends GateMembership {
  joins: ShimHello[];
  leaves: string[];
  peers: GatePeer[];
  failNextJoin: boolean;
}

interface Client {
  socket: Socket;
  lines: string[];
  closed: Promise<void>;
}

const HELLO: ShimHello = {
  type: "hello",
  version: 1,
  command: "tsc --noEmit",
  estimateBytes: 3 * 1024 ** 3,
  agentId: "agent-1",
  process: { pid: 4242, startTime: 99, pidNamespace: "pid:[1]", bootId: "boot", initStartTime: 1 },
};

let root = "";
let socketPath = "";
const servers: GateSocketServer[] = [];
const clients: Socket[] = [];

// Answers every join with one wait notice, as the real gate does for a queued command.
function createMembership(): FakeMembership {
  const membership: FakeMembership = {
    joins: [],
    leaves: [],
    peers: [],
    failNextJoin: false,
    join(hello, peer) {
      if (membership.failNextJoin) {
        membership.failNextJoin = false;
        throw new Error("join failed on purpose");
      }
      membership.joins.push(hello);
      membership.peers.push(peer);
      peer.send({ type: "wait", ahead: 0, freeBytes: null, neededBytes: 1, waitingOn: "slot" });
      return `m${membership.joins.length}`;
    },
    leave(id) {
      membership.leaves.push(id);
    },
  };
  return membership;
}

async function listen(
  membership: GateMembership,
  helloTimeoutMs?: number,
): Promise<GateSocketServer> {
  const server = await listenGateSocket({ socketPath, gate: membership, helloTimeoutMs });
  if (server === null) throw new Error("the test socket is taken");
  servers.push(server);
  return server;
}

function connectClient(): Promise<Client> {
  return new Promise((resolve, reject) => {
    const socket = connect(socketPath);
    clients.push(socket);
    const lines: string[] = [];
    let buffer = "";
    let connected = false;
    const closed = new Promise<void>((done) => {
      socket.once("close", () => done());
    });
    socket.setEncoding("utf8");
    socket.on("data", (chunk: Buffer | string) => {
      buffer += String(chunk);
      let end = buffer.indexOf("\n");
      while (end >= 0) {
        lines.push(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        end = buffer.indexOf("\n");
      }
    });
    // A reset from the server after connect is expected in these tests.
    socket.on("error", (error) => {
      if (!connected) reject(error);
    });
    socket.once("connect", () => {
      connected = true;
      resolve({ socket, lines, closed });
    });
  });
}

// A socket file with no listener, as a daemon killed with SIGKILL leaves it.
function leaveStaleSocket(): void {
  const script =
    'const s = require("node:net").createServer(); s.listen(process.argv[1], () => process.kill(process.pid, "SIGKILL"));';
  const result = spawnSync(process.execPath, ["-e", script, socketPath], {
    stdio: "ignore",
    timeout: 10_000,
  });
  if (result.signal !== "SIGKILL" || !existsSync(socketPath)) {
    throw new Error("could not leave a stale socket file");
  }
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "heavy-gate-socket-"));
  socketPath = join(root, "gate.sock");
});

afterEach(async () => {
  for (const socket of clients.splice(0)) socket.destroy();
  for (const server of servers.splice(0)) await server.close();
  rmSync(root, { recursive: true, force: true });
});

describe("listenGateSocket", () => {
  it("passes a valid hello to the gate and the gate's notices back as JSON lines", async () => {
    const membership = createMembership();
    await listen(membership);
    const client = await connectClient();
    client.socket.write(`${JSON.stringify(HELLO)}\n`);
    await vi.waitFor(() => expect(client.lines).toHaveLength(1));
    expect(membership.joins).toEqual([HELLO]);
    expect(JSON.parse(client.lines[0])).toEqual({
      type: "wait",
      ahead: 0,
      freeBytes: null,
      neededBytes: 1,
      waitingOn: "slot",
    });
  });

  it("calls leave once when the shim's connection closes", async () => {
    const membership = createMembership();
    await listen(membership);
    const client = await connectClient();
    client.socket.write(`${JSON.stringify(HELLO)}\n`);
    await vi.waitFor(() => expect(membership.joins).toHaveLength(1));
    client.socket.end();
    await vi.waitFor(() => expect(membership.leaves).toEqual(["m1"]));
  });

  it("drops a first line that is not JSON", async () => {
    const membership = createMembership();
    await listen(membership);
    const client = await connectClient();
    client.socket.write("hello\n");
    await client.closed;
    expect(membership.joins).toEqual([]);
    expect(membership.leaves).toEqual([]);
  });

  it("drops a hello that fails the schema", async () => {
    const membership = createMembership();
    await listen(membership);
    const client = await connectClient();
    client.socket.write(`${JSON.stringify({ ...HELLO, version: 2 })}\n`);
    await client.closed;
    expect(membership.joins).toEqual([]);
  });

  it("drops a connection that sends no hello in time", async () => {
    const membership = createMembership();
    await listen(membership, 100);
    const client = await connectClient();
    await client.closed;
    expect(membership.joins).toEqual([]);
  });

  it("drops a line longer than 64 KB", async () => {
    const membership = createMembership();
    await listen(membership);
    const client = await connectClient();
    client.socket.write("x".repeat(MAX_LINE_LENGTH + 1));
    await client.closed;
    expect(membership.joins).toEqual([]);
  });

  it("closes a connection whose join throws, and keeps serving the next one", async () => {
    const membership = createMembership();
    membership.failNextJoin = true;
    await listen(membership);
    const first = await connectClient();
    first.socket.write(`${JSON.stringify(HELLO)}\n`);
    await first.closed;
    const second = await connectClient();
    second.socket.write(`${JSON.stringify(HELLO)}\n`);
    await vi.waitFor(() => expect(membership.joins).toHaveLength(1));
  });

  it("claims a socket file that a dead daemon left behind", async () => {
    leaveStaleSocket();
    const membership = createMembership();
    await listen(membership);
    const client = await connectClient();
    client.socket.write(`${JSON.stringify(HELLO)}\n`);
    await vi.waitFor(() => expect(membership.joins).toHaveLength(1));
  });

  it("stands down while another live server owns the socket", async () => {
    const owner = createMembership();
    await listen(owner);
    expect(await listenGateSocket({ socketPath, gate: createMembership() })).toBeNull();
    const client = await connectClient();
    client.socket.write(`${JSON.stringify(HELLO)}\n`);
    await vi.waitFor(() => expect(owner.joins).toHaveLength(1));
  });

  it("closes every connection and removes the socket file on close", async () => {
    const membership = createMembership();
    const server = await listen(membership);
    const client = await connectClient();
    client.socket.write(`${JSON.stringify(HELLO)}\n`);
    await vi.waitFor(() => expect(membership.joins).toHaveLength(1));
    await server.close();
    await client.closed;
    expect(membership.leaves).toEqual(["m1"]);
    expect(existsSync(socketPath)).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/socket-server.posix.test.ts --bail=1`

Expected: FAIL, `Cannot find module './socket-server.js'`.

- [ ] **Step 3: Write the socket server**

Create `plugins/heavy-command-gate/server/socket-server.ts`:

```ts
import { unlink } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import { clearTimeout, setTimeout } from "node:timers";
import type { GateMembership } from "./gate.js";
import { MAX_LINE_LENGTH, ShimHelloSchema, type ServerNotice, type ShimHello } from "./protocol.js";

export interface GateSocketServer {
  close(): Promise<void>;
}

export interface GateSocketOptions {
  socketPath: string;
  gate: GateMembership;
  /** How long a connection may stay silent before its hello. */
  helloTimeoutMs?: number;
}

const HELLO_TIMEOUT_MS = 5_000;
const PROBE_TIMEOUT_MS = 1_000;

function errorCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

function listenOnce(server: Server, socketPath: string): Promise<Error | null> {
  return new Promise((resolve) => {
    function onError(error: Error): void {
      server.off("listening", onListening);
      resolve(error);
    }
    function onListening(): void {
      server.off("error", onError);
      resolve(null);
    }
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

// True when something accepts a connection on the path, or does not refuse one within a second:
// a daemon too busy to accept still owns its socket.
function answers(socketPath: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = connect(socketPath);
    const timer = setTimeout(() => {
      probe.destroy();
      resolve(true);
    }, PROBE_TIMEOUT_MS);
    probe.once("connect", () => {
      clearTimeout(timer);
      probe.destroy();
      resolve(true);
    });
    probe.once("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

// false: another live server owns the path. A file nobody answers on is what a killed daemon
// leaves behind, so it is removed and claimed.
async function claim(server: Server, socketPath: string): Promise<boolean> {
  const first = await listenOnce(server, socketPath);
  if (first === null) return true;
  if (errorCode(first) !== "EADDRINUSE") throw first;
  if (await answers(socketPath)) return false;
  await unlink(socketPath).catch((error: unknown) => {
    if (errorCode(error) !== "ENOENT") throw error;
  });
  const second = await listenOnce(server, socketPath);
  if (second === null) return true;
  if (errorCode(second) === "EADDRINUSE") return false;
  throw second;
}

function parseHello(line: string): ShimHello | null {
  try {
    const result = ShimHelloSchema.safeParse(JSON.parse(line));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// A shim killed mid-write leaves a destroyed socket; its notice has nowhere to go.
function writeNotice(socket: Socket, notice: ServerNotice): void {
  if (socket.destroyed || !socket.writable) return;
  socket.write(`${JSON.stringify(notice)}\n`);
}

// Every gate call runs in a socket callback inside the daemon, so a throw is caught and logged:
// an uncaught exception would end the daemon.
function acceptShim(socket: Socket, options: GateSocketOptions, connections: Set<Socket>): void {
  connections.add(socket);
  let buffer = "";
  let memberId: string | null = null;
  const helloTimer = setTimeout(() => socket.destroy(), options.helloTimeoutMs ?? HELLO_TIMEOUT_MS);
  socket.setEncoding("utf8");
  // ECONNRESET from a killed shim: the close below releases its slot.
  socket.on("error", () => socket.destroy());
  socket.on("close", () => {
    clearTimeout(helloTimer);
    connections.delete(socket);
    if (memberId === null) return;
    try {
      options.gate.leave(memberId);
    } catch (error) {
      console.error("heavy-command-gate: releasing a command failed", error);
    }
  });
  socket.on("data", (chunk: Buffer | string) => {
    // The shim sends nothing after its hello.
    if (memberId !== null) return;
    buffer += String(chunk);
    const end = buffer.indexOf("\n");
    if (end < 0 && buffer.length <= MAX_LINE_LENGTH) return;
    clearTimeout(helloTimer);
    const hello = end < 0 || end > MAX_LINE_LENGTH ? null : parseHello(buffer.slice(0, end));
    buffer = "";
    if (hello === null) {
      socket.destroy();
      return;
    }
    try {
      memberId = options.gate.join(hello, { send: (notice) => writeNotice(socket, notice) });
    } catch (error) {
      console.error("heavy-command-gate: queueing a command failed", error);
      socket.destroy();
    }
  });
}

export async function listenGateSocket(
  options: GateSocketOptions,
): Promise<GateSocketServer | null> {
  const connections = new Set<Socket>();
  const server = createServer((socket) => acceptShim(socket, options, connections));
  if (!(await claim(server, options.socketPath))) return null;
  // A listener error after the claim would otherwise be an uncaught exception in the daemon.
  server.on("error", (error) => console.error("heavy-command-gate: gate socket failed", error));
  return {
    close() {
      return new Promise((resolve) => {
        // The callback runs once every connection is gone; Node also removes the socket file.
        server.close(() => resolve());
        for (const socket of connections) socket.destroy();
      });
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/socket-server.posix.test.ts --bail=1`

Expected: PASS, 10 tests, in a few seconds (the stand-down probe and the stale-socket child are the slow ones).

- [ ] **Step 5: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/heavy-command-gate/server/socket-server.ts plugins/heavy-command-gate/server/socket-server.posix.test.ts && npm run lint -- plugins/heavy-command-gate/server/socket-server.ts plugins/heavy-command-gate/server/socket-server.posix.test.ts
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: `Found 0 warnings and 0 errors.`, then a typecheck with exit 0.

- [ ] **Step 6: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/heavy-command-gate || { echo "STOP: not on feat/heavy-command-gate"; exit 1; }
git -C /workspace/utils/paseo add plugins/heavy-command-gate/server/socket-server.ts plugins/heavy-command-gate/server/socket-server.posix.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): heavy-command-gate socket server" -- plugins/heavy-command-gate/server/socket-server.ts plugins/heavy-command-gate/server/socket-server.posix.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages
```

Expected: the hook passes and git prints `2 files changed`; the identity line is `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` lists exactly the two paths; `status` prints nothing. On a hook failure, report and stop.

---

### Task 7: Shim runtime, installer and the integration test

**Files:**

- Create: `plugins/heavy-command-gate/server/paths.ts`
- Create: `plugins/heavy-command-gate/server/shim/run-shim.ts`
- Create: `plugins/heavy-command-gate/server/shim/install.ts`
- Test: `plugins/heavy-command-gate/server/paths.test.ts`
- Test: `plugins/heavy-command-gate/server/shim/install.posix.test.ts` (file modes, symlinks)
- Test: `plugins/heavy-command-gate/server/shim/shim.posix.test.ts` (the spec's integration test: the real socket server and the generated shim running stand-in tools in a temp directory)

**Interfaces:**

Consumes:

- `classifyCommand(invokedAs, args, patterns): number | null` and `PatternRule` from `server/shim/classify.ts` (Task 2), embedded by source text.
- `HELD_ENV`, `ShimConfig`, `ShimHello`, `ServerNotice`, `WaitNotice` from `server/protocol.ts` (Task 3).
- `createGate`, `Gate`, `GateDeps` (Task 5) and `listenGateSocket`, `GateSocketServer` (Task 6), in `shim.posix.test.ts` only.
- `GateSettings`, `gbToBytes`, `gateSettings` from `shared/settings.ts` (Task 1).

Produces:

- `plugins/heavy-command-gate/server/paths.ts`
  - `export function gateHome(env?: NodeJS.ProcessEnv): string` (`<PASEO_HOME, ~ expanded, resolved>/heavy-command-gate`; creates nothing)
  - `export interface GatePaths { home: string; script: string; binDir: string; configPath: string; socketPath: string }` and `export function gatePaths(home: string): GatePaths` (`gate.mjs`, `bin`, `config.json`, `gate.sock` under `home`). Sub-project 3 locates the gate through these names.
- `plugins/heavy-command-gate/server/shim/run-shim.ts`
  - `export type ExecveFunction = (file: string, args: string[], env: NodeJS.ProcessEnv) => void`
  - `export interface ShimDeps { argv: readonly string[]; env: NodeJS.ProcessEnv; process: NodeJS.Process; childProcess: typeof import("node:child_process"); fs: typeof import("node:fs"); net: typeof import("node:net"); os: typeof import("node:os"); path: typeof import("node:path"); execve: ExecveFunction | null; classify(invokedAs: string, args: readonly string[], patterns: readonly PatternRule[]): number | null; socketPath: string; configPath: string; heldEnv: string; helloTimeoutMs: number }`
  - `export function runShim(deps: ShimDeps): void` (self-contained under the shim serialization rule)
- `plugins/heavy-command-gate/server/shim/install.ts`
  - `export const SHIMMED_COMMANDS: readonly string[]` (`npm`, `npx`, `pnpm`, `tsc`, `tsgo`, `vitest`, `jest`, `gradle`, `gradlew`, `pytest`)
  - `export const HELLO_TIMEOUT_MS = 10_000`
  - `export type InterpreterResult = { ok: true; path: string } | { ok: false; reason: string }`
  - `export interface InterpreterProbe { execPath: string; isElectron: boolean; pathEnv: string | undefined; platform: NodeJS.Platform; isExecutable(file: string): boolean }` and `export function currentInterpreterProbe(): InterpreterProbe`
  - `export function resolveShimInterpreter(probe?: InterpreterProbe): InterpreterResult`
  - `export function toShimConfig(values: GateSettings): ShimConfig`
  - `export interface ShimScriptOptions { interpreter: string; socketPath: string; configPath: string }` and `export function buildShimScript(options: ShimScriptOptions): string`
  - `export interface InstallOptions { paths: GatePaths; interpreter: string }` and `export function installShims(options: InstallOptions): Promise<void>`
  - `export function writeShimConfig(path: string, config: ShimConfig): Promise<void>` (atomic, mode 0600)

Shim behavior (the generated `gate.mjs`), which `shim.posix.test.ts` checks end to end:

- The real binary is the first executable named like the shim on `PATH` after dropping the shim's own directory and anything that resolves to `gate.mjs`. None: `heavy-command gate: no <name> on PATH after the shim directory` on stderr, exit 127.
- `PASEO_HEAVY_GATE_HELD=1`, a light command, or `enabled: false` in `config.json`: exec the real binary with the env unchanged.
- An unreadable `config.json`: one warning line, then exec unchanged.
- A heavy command: connect, send the hello, print each wait notice as the spec's line (`waiting for heavy-command slot (2 ahead, 1.8 GB free)`, or `waiting for free memory (2 ahead, 1.8 GB free, 3.0 GB needed)` when the queue waits on memory; `free memory unknown` without a reading), and on `go` run the binary as a child with `PASEO_HEAVY_GATE_HELD=1`, forwarding SIGINT, SIGTERM, SIGHUP and SIGQUIT, keeping the socket open, then exit with its code or die by its signal.
- A socket that cannot be reached, a gate that sends no first answer within 10 s, or a gate that closes the socket before `go`: `heavy-command gate: not reachable (<code or reason>), running <name> ungated`, then exec with `PASEO_HEAVY_GATE_HELD=1`.

- [ ] **Step 1: Write the failing paths test**

Create `plugins/heavy-command-gate/server/paths.test.ts`:

```ts
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gateHome, gatePaths } from "./paths.js";

describe("gateHome", () => {
  it("uses an absolute PASEO_HOME as given", () => {
    const paseoHome = resolve("/srv/paseo-home");
    expect(gateHome({ PASEO_HOME: paseoHome })).toBe(join(paseoHome, "heavy-command-gate"));
  });

  it("expands a leading ~/ in PASEO_HOME to the user's home directory", () => {
    expect(gateHome({ PASEO_HOME: "~/paseo-dev" })).toBe(
      join(homedir(), "paseo-dev", "heavy-command-gate"),
    );
  });

  it("expands a bare ~ in PASEO_HOME", () => {
    expect(gateHome({ PASEO_HOME: "~" })).toBe(join(homedir(), "heavy-command-gate"));
  });

  it("resolves a relative PASEO_HOME against the working directory, as the daemon does", () => {
    expect(gateHome({ PASEO_HOME: ".dev/paseo-home" })).toBe(
      join(process.cwd(), ".dev", "paseo-home", "heavy-command-gate"),
    );
  });

  it("falls back to ~/.paseo when PASEO_HOME is unset", () => {
    expect(gateHome({})).toBe(join(homedir(), ".paseo", "heavy-command-gate"));
  });

  it("creates no directory", () => {
    const root = mkdtempSync(join(tmpdir(), "heavy-gate-paths-"));
    const paseoHome = join(root, "paseo-home");
    try {
      expect(gateHome({ PASEO_HOME: paseoHome })).toBe(join(paseoHome, "heavy-command-gate"));
      expect(existsSync(paseoHome)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("gatePaths", () => {
  it("lays out the script, the shim directory, the config and the socket in the home", () => {
    expect(gatePaths("/srv/gate")).toEqual({
      home: "/srv/gate",
      script: join("/srv/gate", "gate.mjs"),
      binDir: join("/srv/gate", "bin"),
      configPath: join("/srv/gate", "config.json"),
      socketPath: join("/srv/gate", "gate.sock"),
    });
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/paths.test.ts --bail=1`

Expected: FAIL, `Cannot find module './paths.js'`.

- [ ] **Step 3: Write the paths module**

Create `plugins/heavy-command-gate/server/paths.ts`:

```ts
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// Mirrors resolvePaseoHome in packages/server/src/server/paseo-home.ts, which a plugin bundle
// cannot import: only "~" and a leading "~/" expand, and an unset PASEO_HOME means ~/.paseo.
function expandHomeDir(input: string): string {
  if (input.startsWith("~/")) {
    return join(homedir(), input.slice(2));
  }
  if (input === "~") {
    return homedir();
  }
  return input;
}

// The plugin SDK exposes no data directory, so the gate lives next to the daemon's own state.
// Built-ins run in the daemon process, so process.env is the daemon's env.
export function gateHome(env: NodeJS.ProcessEnv = process.env): string {
  const paseoHome = resolve(expandHomeDir(env.PASEO_HOME ?? "~/.paseo"));
  return join(paseoHome, "heavy-command-gate");
}

export interface GatePaths {
  home: string;
  /** The shim, written at every start. */
  script: string;
  /** One symlink per shimmed command, first on every agent's PATH. */
  binDir: string;
  /** The settings the shims classify against (ShimConfig). */
  configPath: string;
  socketPath: string;
}

export function gatePaths(home: string): GatePaths {
  return {
    home,
    script: join(home, "gate.mjs"),
    binDir: join(home, "bin"),
    configPath: join(home, "config.json"),
    socketPath: join(home, "gate.sock"),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/paths.test.ts --bail=1`

Expected: PASS, 7 tests.

- [ ] **Step 5: Write the failing installer test**

Create `plugins/heavy-command-gate/server/shim/install.posix.test.ts`:

```ts
import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gateSettings, gbToBytes } from "../../shared/settings.js";
import { gatePaths, type GatePaths } from "../paths.js";
import type { ShimConfig } from "../protocol.js";
import {
  SHIMMED_COMMANDS,
  buildShimScript,
  installShims,
  resolveShimInterpreter,
  toShimConfig,
  writeShimConfig,
  type InterpreterProbe,
} from "./install.js";

let root = "";
let paths: GatePaths = gatePaths("");

function probe(overrides: Partial<InterpreterProbe>): InterpreterProbe {
  return {
    execPath: "/usr/local/bin/node",
    isElectron: false,
    pathEnv: "/usr/bin:/bin",
    platform: "linux",
    isExecutable: () => false,
    ...overrides,
  };
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "heavy-gate-install-"));
  paths = gatePaths(join(root, "heavy-command-gate"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveShimInterpreter", () => {
  it("uses the daemon's own node", () => {
    expect(resolveShimInterpreter(probe({}))).toEqual({ ok: true, path: "/usr/local/bin/node" });
  });

  it("uses the first absolute node on PATH under Electron", () => {
    const electron = probe({
      execPath: "/opt/Paseo/paseo",
      isElectron: true,
      pathEnv: "bin:/opt/missing:/usr/bin:/usr/local/bin",
      isExecutable: (file) => file === "bin/node" || file.endsWith("/bin/node"),
    });
    expect(resolveShimInterpreter(electron)).toEqual({ ok: true, path: "/usr/bin/node" });
  });

  it("refuses under Electron without node on PATH", () => {
    expect(resolveShimInterpreter(probe({ isElectron: true }))).toEqual({
      ok: false,
      reason: "no node binary on the daemon PATH",
    });
  });

  it("refuses on Windows", () => {
    expect(resolveShimInterpreter(probe({ platform: "win32" }))).toEqual({
      ok: false,
      reason: "PATH shims need a POSIX system",
    });
  });

  it("refuses a node path with whitespace, which a #! line cannot hold", () => {
    expect(resolveShimInterpreter(probe({ execPath: "/Applications/My Apps/node" }))).toEqual({
      ok: false,
      reason:
        "the node path /Applications/My Apps/node contains whitespace, which a #! line cannot hold",
    });
  });

  it("refuses a node path longer than 200 characters", () => {
    expect(resolveShimInterpreter(probe({ execPath: `/${"n".repeat(200)}` }))).toEqual({
      ok: false,
      reason: "the node path is longer than 200 characters, more than a #! line can hold",
    });
  });
});

describe("toShimConfig", () => {
  it("turns settings into word lists and byte estimates", () => {
    const values = gateSettings.schema.parse({
      enabled: false,
      patterns: [{ command: "npm run typecheck", estimateGb: 3 }],
    });
    const expected: ShimConfig = {
      version: 1,
      enabled: false,
      patterns: [{ words: ["npm", "run", "typecheck"], estimateBytes: gbToBytes(3) }],
    };
    expect(toShimConfig(values)).toEqual(expected);
  });
});

describe("buildShimScript", () => {
  it("starts with the #! line and embeds the paths, the variable name and the timeout", () => {
    const script = buildShimScript({
      interpreter: "/usr/local/bin/node",
      socketPath: '/tmp/a "b"/gate.sock',
      configPath: "/tmp/a/config.json",
    });
    expect(script.split("\n")[0]).toBe("#!/usr/local/bin/node");
    expect(script).toContain('  socketPath: "/tmp/a \\"b\\"/gate.sock",');
    expect(script).toContain('  configPath: "/tmp/a/config.json",');
    expect(script).toContain('  heldEnv: "PASEO_HEAVY_GATE_HELD",');
    expect(script).toContain("  helloTimeoutMs: 10000,");
  });

  it("is a module node can parse", () => {
    const file = join(root, "gate.mjs");
    writeFileSync(file, buildShimScript({ interpreter: process.execPath, ...paths }));
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("installShims", () => {
  it("writes gate.mjs and links every shimmed command to it", async () => {
    await installShims({ paths, interpreter: process.execPath });
    expect(modeOf(paths.home)).toBe(0o700);
    expect(modeOf(paths.binDir)).toBe(0o700);
    expect(modeOf(paths.script)).toBe(0o700);
    expect(readdirSync(paths.binDir).sort()).toEqual([...SHIMMED_COMMANDS].sort());
    for (const name of SHIMMED_COMMANDS) {
      const link = join(paths.binDir, name);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe("../gate.mjs");
    }
  });

  it("rewrites the script and the links on the next start and leaves no temporary file", async () => {
    await installShims({ paths, interpreter: process.execPath });
    writeFileSync(paths.script, "edited by hand\n");
    await installShims({ paths, interpreter: process.execPath });
    expect(readFileSync(paths.script, "utf8")).toBe(
      buildShimScript({ interpreter: process.execPath, ...paths }),
    );
    expect(readdirSync(paths.home).sort()).toEqual(["bin", "gate.mjs"]);
    expect(readdirSync(paths.binDir).sort()).toEqual([...SHIMMED_COMMANDS].sort());
  });
});

describe("writeShimConfig", () => {
  it("writes the config with mode 0600 and replaces it whole", async () => {
    await installShims({ paths, interpreter: process.execPath });
    const first: ShimConfig = {
      version: 1,
      enabled: true,
      patterns: [{ words: ["tsc"], estimateBytes: 1 }],
    };
    const second: ShimConfig = { version: 1, enabled: false, patterns: [] };
    await writeShimConfig(paths.configPath, first);
    await writeShimConfig(paths.configPath, second);
    expect(modeOf(paths.configPath)).toBe(0o600);
    expect(JSON.parse(readFileSync(paths.configPath, "utf8"))).toEqual(second);
    expect(readdirSync(paths.home).sort()).toEqual(["bin", "config.json", "gate.mjs"]);
  });
});
```

The Electron case lists `bin` (relative, so skipped even though the probe calls it executable), `/opt/missing` (no executable node), then `/usr/bin` and `/usr/local/bin`, which both have one: the first of those wins.

- [ ] **Step 6: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/shim/install.posix.test.ts --bail=1`

Expected: FAIL, `Cannot find module './install.js'`.

- [ ] **Step 7: Write the failing integration test**

This runs the spec's integration cases against the generated `gate.mjs`, a real gate and the real socket server. Stand-in tools in a temp `real/` directory log each run to a file. Every shim gets an env built from scratch, so a gate around the vitest process cannot leak `PASEO_HEAVY_GATE_HELD` in. Create `plugins/heavy-command-gate/server/shim/shim.posix.test.ts`:

```ts
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearInterval, clearTimeout, setInterval, setTimeout } from "node:timers";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGate, type Gate, type GateDeps } from "../gate.js";
import { gatePaths, type GatePaths } from "../paths.js";
import type { ShimConfig } from "../protocol.js";
import { listenGateSocket, type GateSocketServer } from "../socket-server.js";
import { installShims, writeShimConfig } from "./install.js";

const GIB = 1024 ** 3;
const SYSTEM_PATH = "/usr/local/bin:/usr/bin:/bin";
const WAIT = { timeout: 5_000, interval: 50 };

// Logs its start, with whether it runs held, and its end. GATE_TEST_SLEEP and GATE_TEST_EXIT
// shape the run.
const LOGGING_TOOL = [
  "#!/bin/sh",
  'echo "start $(basename "$0") $* held=${PASEO_HEAVY_GATE_HELD:-unset}" >> "$GATE_TEST_LOG"',
  'sleep "${GATE_TEST_SLEEP:-0}"',
  'echo "end $(basename "$0") $*" >> "$GATE_TEST_LOG"',
  'exit "${GATE_TEST_EXIT:-0}"',
  "",
].join("\n");
// Replaced by sleep itself, so a signal the shim forwards reaches the sleeping process.
const SLEEPING_TOOL = "#!/bin/sh\nexec sleep 30\n";

const CONFIG: ShimConfig = {
  version: 1,
  enabled: true,
  patterns: [
    { words: ["tsc"], estimateBytes: 3 * GIB },
    { words: ["jest"], estimateBytes: 2 * GIB },
    { words: ["npm", "run", "typecheck"], estimateBytes: 3 * GIB },
  ],
};

interface ShimResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stderr: string;
}

interface ShimRun {
  child: ChildProcess;
  result: Promise<ShimResult>;
}

let root = "";
let paths: GatePaths = gatePaths("");
let realBin = "";
let logFile = "";
let gate: Gate | null = null;
let server: GateSocketServer | null = null;
const children: ChildProcess[] = [];

function writeTool(name: string, text: string): void {
  const file = join(realBin, name);
  writeFileSync(file, text);
  chmodSync(file, 0o755);
}

function readLog(): string[] {
  return existsSync(logFile) ? readFileSync(logFile, "utf8").trim().split("\n") : [];
}

// Slots only (no memory reading), one slot, a 1 GB reserve.
async function startGate(): Promise<Gate> {
  const deps: GateDeps = {
    now: () => Date.now(),
    readFreeMemory: () => null,
    readRss: () => null,
    startTimer(callback, ms) {
      const timer = setInterval(callback, ms);
      return () => clearInterval(timer);
    },
    log: () => undefined,
  };
  const created = createGate({ config: { enabled: true, slots: 1, reserveBytes: GIB }, deps });
  gate = created;
  server = await listenGateSocket({ socketPath: paths.socketPath, gate: created });
  if (server === null) throw new Error("the test socket is taken");
  return created;
}

function runShim(name: string, args: string[], env: Record<string, string> = {}): ShimRun {
  const child = spawn(join(paths.binDir, name), args, {
    cwd: root,
    env: {
      PATH: `${paths.binDir}:${realBin}:${SYSTEM_PATH}`,
      GATE_TEST_LOG: logFile,
      PASEO_AGENT_ID: "agent-1",
      ...env,
    },
    stdio: ["ignore", "ignore", "pipe"],
  });
  children.push(child);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });
  const result = new Promise<ShimResult>((resolve) => {
    child.once("close", (code, signal) => resolve({ code, signal, stderr }));
  });
  return { child, result };
}

// SIGTERM goes through the shim to the stand-in tool, so no sleep outlives the test.
function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(() => child.kill("SIGKILL"), 5_000);
    child.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGTERM");
  });
}

// A socket file with no listener, as a daemon killed with SIGKILL leaves it.
function leaveStaleSocket(): void {
  const script =
    'const s = require("node:net").createServer(); s.listen(process.argv[1], () => process.kill(process.pid, "SIGKILL"));';
  const result = spawnSync(process.execPath, ["-e", script, paths.socketPath], {
    stdio: "ignore",
    timeout: 10_000,
  });
  if (result.signal !== "SIGKILL") throw new Error("could not leave a stale socket file");
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), "heavy-gate-shim-"));
  paths = gatePaths(join(root, "home"));
  realBin = join(root, "real");
  logFile = join(root, "runs.log");
  mkdirSync(paths.home, { mode: 0o700 });
  mkdirSync(realBin);
  writeTool("tsc", LOGGING_TOOL);
  writeTool("npm", LOGGING_TOOL);
  writeTool("jest", SLEEPING_TOOL);
  await installShims({ paths, interpreter: process.execPath });
  await writeShimConfig(paths.configPath, CONFIG);
});

afterEach(async () => {
  await Promise.all(children.splice(0).map(stopChild));
  await server?.close();
  gate?.stop();
  server = null;
  gate = null;
  rmSync(root, { recursive: true, force: true });
});

describe("the generated shim", () => {
  it("runs a light command straight, with its arguments and its exit code, without the gate", async () => {
    const run = runShim("npm", ["--version"], { GATE_TEST_EXIT: "3" });
    expect(await run.result).toEqual({ code: 3, signal: null, stderr: "" });
    expect(readLog()).toEqual(["start npm --version held=unset", "end npm --version"]);
  });

  it("runs a heavy command once the gate says go, with PASEO_HEAVY_GATE_HELD=1", async () => {
    await startGate();
    const run = runShim("tsc", ["--noEmit"]);
    expect(await run.result).toEqual({ code: 0, signal: null, stderr: "" });
    expect(readLog()).toEqual(["start tsc --noEmit held=1", "end tsc --noEmit"]);
  });

  it("classifies npm run typecheck as heavy", async () => {
    await startGate();
    const run = runShim("npm", ["run", "typecheck"]);
    expect(await run.result).toEqual({ code: 0, signal: null, stderr: "" });
    expect(readLog()).toEqual(["start npm run typecheck held=1", "end npm run typecheck"]);
  });

  it("tells the gate its command line, agent and pid while it runs", async () => {
    const running = await startGate();
    const run = runShim("tsc", ["--noEmit"], { GATE_TEST_SLEEP: "2" });
    await vi.waitFor(() => expect(running.snapshot().running).toHaveLength(1), WAIT);
    expect(running.snapshot().running[0]).toMatchObject({
      agentId: "agent-1",
      command: "tsc --noEmit",
      pid: run.child.pid,
      estimateBytes: 3 * GIB,
    });
    await run.result;
  });

  it("runs two heavy commands one after the other", async () => {
    await startGate();
    const first = runShim("tsc", ["first"], { GATE_TEST_SLEEP: "1" });
    await vi.waitFor(() => expect(readLog()).toContain("start tsc first held=1"), WAIT);
    const second = runShim("tsc", ["second"]);
    expect((await first.result).code).toBe(0);
    expect(await second.result).toEqual({
      code: 0,
      signal: null,
      stderr: "waiting for heavy-command slot (0 ahead, free memory unknown)\n",
    });
    expect(readLog()).toEqual([
      "start tsc first held=1",
      "end tsc first",
      "start tsc second held=1",
      "end tsc second",
    ]);
  });

  it("frees the slot when the holding shim is killed", async () => {
    const running = await startGate();
    const holder = runShim("tsc", ["holder"], { GATE_TEST_SLEEP: "2" });
    await vi.waitFor(() => expect(running.snapshot().running).toHaveLength(1), WAIT);
    const waiter = runShim("tsc", ["waiter"]);
    await vi.waitFor(() => expect(running.snapshot().waiting).toHaveLength(1), WAIT);
    holder.child.kill("SIGKILL");
    expect((await holder.result).signal).toBe("SIGKILL");
    expect((await waiter.result).code).toBe(0);
    expect(readLog()).toContain("start tsc waiter held=1");
  });

  it("lets a nested command through while the slot is held", async () => {
    const running = await startGate();
    runShim("jest", []);
    await vi.waitFor(() => expect(running.snapshot().running).toHaveLength(1), WAIT);
    const nested = runShim("tsc", ["nested"], { PASEO_HEAVY_GATE_HELD: "1" });
    expect(await nested.result).toEqual({ code: 0, signal: null, stderr: "" });
    expect(readLog()).toContain("start tsc nested held=1");
    expect(running.snapshot().waiting).toEqual([]);
  });

  it("passes a signal to the command, dies by it and frees the slot", async () => {
    const running = await startGate();
    const run = runShim("jest", []);
    await vi.waitFor(() => expect(running.snapshot().running).toHaveLength(1), WAIT);
    run.child.kill("SIGTERM");
    expect(await run.result).toEqual({ code: null, signal: "SIGTERM", stderr: "" });
    await vi.waitFor(() => expect(running.snapshot().running).toEqual([]), WAIT);
  });

  it("runs the command after one warning line when no gate listens", async () => {
    const run = runShim("tsc", ["offline"]);
    expect(await run.result).toEqual({
      code: 0,
      signal: null,
      stderr: "heavy-command gate: not reachable (ENOENT), running tsc ungated\n",
    });
    expect(readLog()).toEqual(["start tsc offline held=1", "end tsc offline"]);
  });

  it("runs the command after one warning line when the socket refuses connections", async () => {
    leaveStaleSocket();
    const run = runShim("tsc", ["stale"]);
    expect(await run.result).toEqual({
      code: 0,
      signal: null,
      stderr: "heavy-command gate: not reachable (ECONNREFUSED), running tsc ungated\n",
    });
  });

  it("runs heavy commands straight when the gate is switched off", async () => {
    await startGate();
    await writeShimConfig(paths.configPath, { ...CONFIG, enabled: false });
    const run = runShim("tsc", ["off"]);
    expect(await run.result).toEqual({ code: 0, signal: null, stderr: "" });
    expect(readLog()).toEqual(["start tsc off held=unset", "end tsc off"]);
  });

  it("exits 127 when no real binary follows the shim directory", async () => {
    const run = runShim("pytest", [], { PATH: `${paths.binDir}:${realBin}` });
    expect(await run.result).toEqual({
      code: 127,
      signal: null,
      stderr: "heavy-command gate: no pytest on PATH after the shim directory\n",
    });
  });
});
```

- [ ] **Step 8: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/shim/shim.posix.test.ts --bail=1`

Expected: FAIL, `Cannot find module './install.js'`. The file's other imports (`../gate.js`, `../paths.js`, `../protocol.js` and `../socket-server.js`) exist from Tasks 3, 5 and 6 and Step 3, so the installer is the only missing module.

- [ ] **Step 9: Write the shim runtime**

`runShim` is never imported by the plugin at run time: `buildShimScript` (Step 10) copies its source text into `gate.mjs`. Its body uses only `deps` and JavaScript globals. Warnings go through `fs.writeSync(2, ...)`, because `process.stderr` on a pipe is asynchronous on some platforms and `execve` would drop a pending write. Create `plugins/heavy-command-gate/server/shim/run-shim.ts`:

```ts
import type * as ChildProcessModule from "node:child_process";
import type * as FsModule from "node:fs";
import type * as NetModule from "node:net";
import type * as OsModule from "node:os";
import type * as PathModule from "node:path";
import type { ServerNotice, ShimConfig, ShimHello, WaitNotice } from "../protocol.js";
import type { PatternRule } from "./classify.js";

/** process.execve (Node 22.15+), missing from @types/node 20. Does not return on success. */
export type ExecveFunction = (file: string, args: string[], env: NodeJS.ProcessEnv) => void;

export interface ShimDeps {
  /** process.argv: node, the shim's path as invoked (`<bin>/<command>`), then the arguments. */
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  process: NodeJS.Process;
  childProcess: typeof ChildProcessModule;
  fs: typeof FsModule;
  net: typeof NetModule;
  os: typeof OsModule;
  path: typeof PathModule;
  execve: ExecveFunction | null;
  classify(
    invokedAs: string,
    args: readonly string[],
    patterns: readonly PatternRule[],
  ): number | null;
  socketPath: string;
  configPath: string;
  heldEnv: string;
  /** How long to wait for the gate's first answer before running ungated. */
  helloTimeoutMs: number;
}

/**
 * The whole shim. installShims copies this function into gate.mjs with
 * Function.prototype.toString(), so its body may use only `deps` and JavaScript globals: no
 * imports, no module-level constants, no helpers declared outside it.
 */
export function runShim(deps: ShimDeps): void {
  const { childProcess, env, fs, net, os, path } = deps;
  const proc: NodeJS.Process = deps.process;
  const scriptPath = deps.argv[1] ?? "";
  const args = deps.argv.slice(2);
  const invokedAs = path.basename(scriptPath);
  const FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];
  const GIB = 1024 ** 3;

  function writeLine(line: string): void {
    try {
      fs.writeSync(2, `${line}\n`);
    } catch {
      // stderr is closed or full: the line is lost, the command still runs.
    }
  }

  function warn(message: string): void {
    writeLine(`heavy-command gate: ${message}`);
  }

  function errorCode(error: unknown): string {
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      return error.code;
    }
    return error instanceof Error ? error.message : String(error);
  }

  function readOrNull(read: () => string): string | null {
    try {
      return read();
    } catch {
      return null;
    }
  }

  function realpathOrNull(file: string): string | null {
    return readOrNull(() => fs.realpathSync(file));
  }

  function isExecutableFile(file: string): boolean {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }

  // The binary a shell would run with the shim directory taken off PATH.
  function findRealBinary(): string | null {
    const shimDirectory = realpathOrNull(path.dirname(scriptPath));
    const shimScript = realpathOrNull(scriptPath);
    for (const entry of (env.PATH ?? "").split(path.delimiter)) {
      if (entry === "" || realpathOrNull(entry) === shimDirectory) continue;
      const candidate = path.join(entry, invokedAs);
      if (!isExecutableFile(candidate) || realpathOrNull(candidate) === shimScript) continue;
      return candidate;
    }
    return null;
  }

  function readConfig(): ShimConfig | null {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(deps.configPath, "utf8"));
      if (typeof value !== "object" || value === null) return null;
      const enabled: unknown = Reflect.get(value, "enabled");
      const patterns: unknown = Reflect.get(value, "patterns");
      if (Reflect.get(value, "version") !== 1) return null;
      if (typeof enabled !== "boolean" || !Array.isArray(patterns)) return null;
      return { version: 1, enabled, patterns };
    } catch {
      return null;
    }
  }

  function startTimeOf(pid: string): number | null {
    const stat = readOrNull(() => fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
    if (stat === null) return null;
    const commEnd = stat.lastIndexOf(")");
    const value = Number(stat.slice(commEnd + 2).split(" ")[19]);
    return commEnd >= 0 && Number.isSafeInteger(value) ? value : null;
  }

  function hello(estimateBytes: number): ShimHello {
    const agentId = env.PASEO_AGENT_ID;
    return {
      type: "hello",
      version: 1,
      command: [invokedAs, ...args].join(" ").slice(0, 4096),
      estimateBytes,
      agentId: agentId ? agentId.slice(0, 200) : null,
      process: {
        pid: proc.pid,
        startTime: startTimeOf("self"),
        pidNamespace: readOrNull(() => fs.readlinkSync("/proc/self/ns/pid")),
        bootId: readOrNull(() => fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()),
        initStartTime: startTimeOf("1"),
      },
    };
  }

  function numberOrNull(value: unknown): number | null {
    return typeof value === "number" ? value : null;
  }

  function parseNotice(line: string): ServerNotice | null {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return null;
    }
    if (typeof value !== "object" || value === null) return null;
    const type: unknown = Reflect.get(value, "type");
    const freeBytes = numberOrNull(Reflect.get(value, "freeBytes"));
    const neededBytes = numberOrNull(Reflect.get(value, "neededBytes")) ?? 0;
    if (type === "wait") {
      const waitingOn = Reflect.get(value, "waitingOn") === "memory" ? "memory" : "slot";
      const ahead = numberOrNull(Reflect.get(value, "ahead")) ?? 0;
      return { type: "wait", ahead, freeBytes, neededBytes, waitingOn };
    }
    if (type === "go") {
      const forced = Reflect.get(value, "forced") === true;
      const waitedMs = numberOrNull(Reflect.get(value, "waitedMs")) ?? 0;
      return { type: "go", forced, freeBytes, neededBytes, waitedMs };
    }
    return null;
  }

  function gb(bytes: number): string {
    return (bytes / GIB).toFixed(1);
  }

  function freeText(freeBytes: number | null): string {
    return freeBytes === null ? "free memory unknown" : `${gb(freeBytes)} GB free`;
  }

  function waitLine(notice: WaitNotice): string {
    const free = freeText(notice.freeBytes);
    if (notice.waitingOn === "slot") {
      return `waiting for heavy-command slot (${notice.ahead} ahead, ${free})`;
    }
    return `waiting for free memory (${notice.ahead} ahead, ${free}, ${gb(notice.neededBytes)} GB needed)`;
  }

  // Runs the command as a child, passes signals through, and ends this process the way the
  // command ended. The socket, when given, stays open until then: its close releases the slot.
  function runChild(
    file: string,
    childEnv: NodeJS.ProcessEnv,
    socket: NetModule.Socket | null,
  ): void {
    const child = childProcess.spawn(file, args, {
      stdio: "inherit",
      env: childEnv,
      argv0: invokedAs,
    });
    function forward(signal: NodeJS.Signals): void {
      child.kill(signal);
    }
    for (const signal of FORWARDED_SIGNALS) proc.on(signal, forward);
    child.once("error", (error) => {
      warn(`cannot run ${file}: ${errorCode(error)}`);
      proc.exit(127);
    });
    child.once("exit", (code, signal) => {
      for (const forwarded of FORWARDED_SIGNALS) proc.off(forwarded, forward);
      socket?.destroy();
      if (signal === null) {
        proc.exit(code ?? 1);
        return;
      }
      // Die by the same signal. Its listener is gone, so the default action applies; the exit
      // below covers a signal Node ignores, such as SIGPIPE.
      proc.kill(proc.pid, signal);
      const signalNumber: unknown = Reflect.get(os.constants.signals, signal);
      proc.exit(128 + (typeof signalNumber === "number" ? signalNumber : 0));
    });
  }

  function execReal(file: string, childEnv: NodeJS.ProcessEnv): void {
    if (deps.execve !== null) {
      try {
        deps.execve(file, [invokedAs, ...args], childEnv);
        return;
      } catch {
        // Only the checks Node runs before the system call throw. A failed execve never returns:
        // Node prints "process.execve failed with error code <code>" and aborts with exit 134.
      }
    }
    runChild(file, childEnv, null);
  }

  function runGated(file: string, estimateBytes: number): void {
    const heldEnv: NodeJS.ProcessEnv = { ...env, [deps.heldEnv]: "1" };
    const socket = net.connect(deps.socketPath);
    let settled = false;
    let buffer = "";
    // Cleared by the first answer. A daemon that queued the command may keep it waiting.
    const answerTimer = setTimeout(
      () => fallOpen("no answer from the daemon"),
      deps.helloTimeoutMs,
    );

    function fallOpen(reason: string): void {
      if (settled) return;
      settled = true;
      clearTimeout(answerTimer);
      socket.destroy();
      warn(`not reachable (${reason}), running ${invokedAs} ungated`);
      execReal(file, heldEnv);
    }

    function handle(notice: ServerNotice): void {
      clearTimeout(answerTimer);
      if (notice.type === "wait") {
        writeLine(waitLine(notice));
        return;
      }
      settled = true;
      if (notice.forced) {
        const minutes = Math.round(notice.waitedMs / 60_000);
        const free = freeText(notice.freeBytes);
        const needed = gb(notice.neededBytes);
        warn(
          `started ${invokedAs} after ${minutes} min without enough free memory (${free}, ${needed} GB needed)`,
        );
      }
      runChild(file, heldEnv, socket);
    }

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(hello(estimateBytes))}\n`);
    });
    socket.on("error", (error) => fallOpen(errorCode(error)));
    socket.on("close", () => fallOpen("the daemon closed the connection"));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: Buffer | string) => {
      buffer += String(chunk);
      let end = buffer.indexOf("\n");
      while (end >= 0 && !settled) {
        const notice = parseNotice(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (notice !== null) handle(notice);
        end = buffer.indexOf("\n");
      }
    });
  }

  const binary = findRealBinary();
  if (binary === null) {
    warn(`no ${invokedAs} on PATH after the shim directory`);
    proc.exit(127);
    return;
  }
  if (env[deps.heldEnv] === "1") {
    execReal(binary, env);
    return;
  }
  const config = readConfig();
  if (config === null) {
    warn(`cannot read ${deps.configPath}, running ${invokedAs} ungated`);
    execReal(binary, env);
    return;
  }
  let estimate: number | null = null;
  try {
    estimate = config.enabled ? deps.classify(invokedAs, args, config.patterns) : null;
  } catch (error) {
    warn(`cannot classify ${invokedAs} (${errorCode(error)}), running it ungated`);
  }
  if (estimate === null) {
    execReal(binary, env);
    return;
  }
  runGated(binary, estimate);
}
```

- [ ] **Step 10: Write the installer**

Create `plugins/heavy-command-gate/server/shim/install.ts`:

```ts
import { accessSync, constants, statSync } from "node:fs";
import { chmod, mkdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { gbToBytes, type GateSettings } from "../../shared/settings.js";
import type { GatePaths } from "../paths.js";
import { HELD_ENV, type ShimConfig } from "../protocol.js";
import { classifyCommand } from "./classify.js";
import { runShim } from "./run-shim.js";

/** The spec's shimmed commands. `pytest` has no default pattern; a user pattern can gate it. */
export const SHIMMED_COMMANDS: readonly string[] = [
  "npm",
  "npx",
  "pnpm",
  "tsc",
  "tsgo",
  "vitest",
  "jest",
  "gradle",
  "gradlew",
  "pytest",
];

/** How long a shim waits for the gate's first answer before it runs the command ungated. */
export const HELLO_TIMEOUT_MS = 10_000;

// Linux reads at most 255 bytes of a #! line (BINPRM_BUF_SIZE 256), macOS about 510.
const MAX_INTERPRETER_LENGTH = 200;

export type InterpreterResult = { ok: true; path: string } | { ok: false; reason: string };

export interface InterpreterProbe {
  execPath: string;
  isElectron: boolean;
  pathEnv: string | undefined;
  platform: NodeJS.Platform;
  isExecutable(file: string): boolean;
}

export function currentInterpreterProbe(): InterpreterProbe {
  return {
    execPath: process.execPath,
    isElectron: process.versions.electron !== undefined,
    pathEnv: process.env.PATH,
    platform: process.platform,
    isExecutable(file) {
      try {
        accessSync(file, constants.X_OK);
        return statSync(file).isFile();
      } catch {
        return false;
      }
    },
  };
}

// Under Electron, execPath is the app binary, which runs as node only with ELECTRON_RUN_AS_NODE
// set, and a #! line cannot set it.
function findNodeOnPath(probe: InterpreterProbe): string | null {
  for (const entry of (probe.pathEnv ?? "").split(delimiter)) {
    if (!entry.startsWith("/")) continue;
    const candidate = join(entry, "node");
    if (probe.isExecutable(candidate)) return candidate;
  }
  return null;
}

/** The node the #! line names, or why the gate cannot run on this system. */
export function resolveShimInterpreter(
  probe: InterpreterProbe = currentInterpreterProbe(),
): InterpreterResult {
  if (probe.platform === "win32") return { ok: false, reason: "PATH shims need a POSIX system" };
  const path = probe.isElectron ? findNodeOnPath(probe) : probe.execPath;
  if (path === null) return { ok: false, reason: "no node binary on the daemon PATH" };
  if (/\s/.test(path)) {
    return {
      ok: false,
      reason: `the node path ${path} contains whitespace, which a #! line cannot hold`,
    };
  }
  if (path.length > MAX_INTERPRETER_LENGTH) {
    return {
      ok: false,
      reason: `the node path is longer than ${MAX_INTERPRETER_LENGTH} characters, more than a #! line can hold`,
    };
  }
  return { ok: true, path };
}

export function toShimConfig(values: GateSettings): ShimConfig {
  return {
    version: 1,
    enabled: values.enabled,
    patterns: values.patterns.map((pattern) => ({
      words: pattern.command.split(" "),
      estimateBytes: gbToBytes(pattern.estimateGb),
    })),
  };
}

export interface ShimScriptOptions {
  interpreter: string;
  socketPath: string;
  configPath: string;
}

/** gate.mjs: a bootstrap around the source text of classifyCommand and runShim. */
export function buildShimScript(options: ShimScriptOptions): string {
  return [
    `#!${options.interpreter}`,
    "// Written by the Paseo heavy-command-gate plugin at every daemon start. Edits are overwritten.",
    'import * as childProcess from "node:child_process";',
    'import * as fs from "node:fs";',
    'import * as net from "node:net";',
    'import * as os from "node:os";',
    'import * as path from "node:path";',
    "",
    `const classify = ${classifyCommand.toString()};`,
    "",
    `const runShim = ${runShim.toString()};`,
    "",
    "runShim({",
    "  argv: process.argv,",
    "  env: process.env,",
    "  process,",
    "  childProcess,",
    "  fs,",
    "  net,",
    "  os,",
    "  path,",
    '  execve: typeof process.execve === "function" ? process.execve.bind(process) : null,',
    "  classify,",
    `  socketPath: ${JSON.stringify(options.socketPath)},`,
    `  configPath: ${JSON.stringify(options.configPath)},`,
    `  heldEnv: ${JSON.stringify(HELD_ENV)},`,
    `  helloTimeoutMs: ${HELLO_TIMEOUT_MS},`,
    "});",
    "",
  ].join("\n");
}

// A shim starting mid-write sees the old file or the new one, never half of one.
async function writeAtomic(path: string, text: string, mode: number): Promise<void> {
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, text, { mode });
  // writeFile's mode passes through the umask; chmod sets it exactly.
  await chmod(temporary, mode);
  await rename(temporary, path);
}

export interface InstallOptions {
  paths: GatePaths;
  interpreter: string;
}

export async function installShims(options: InstallOptions): Promise<void> {
  const { paths } = options;
  await mkdir(paths.binDir, { recursive: true, mode: 0o700 });
  const script = buildShimScript({
    interpreter: options.interpreter,
    socketPath: paths.socketPath,
    configPath: paths.configPath,
  });
  await writeAtomic(paths.script, script, 0o700);
  for (const name of SHIMMED_COMMANDS) {
    const link = join(paths.binDir, name);
    const temporary = `${link}.${process.pid}.tmp`;
    await rm(temporary, { force: true });
    // Relative, so the links keep working when the home is moved.
    await symlink("../gate.mjs", temporary);
    await rename(temporary, link);
  }
}

export async function writeShimConfig(path: string, config: ShimConfig): Promise<void> {
  await writeAtomic(path, `${JSON.stringify(config)}\n`, 0o600);
}
```

- [ ] **Step 11: Run the installer test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/shim/install.posix.test.ts --bail=1`

Expected: PASS, 12 tests. A failure in "is a module node can parse" means the generated text does not parse, such as a quoting slip in `buildShimScript` or two top-level declarations of one name. `node --check` only parses, so a name that a copied body uses without declaring it passes here and shows up as a `ReferenceError` in Step 12.

- [ ] **Step 12: Run the integration test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/shim/shim.posix.test.ts --bail=1`

Expected: PASS, 12 tests, in about 15 s (each shim starts a node process of about 40 MB, at most three at once). Failures to read:

- `ReferenceError` in a shim's stderr: the copied source of `runShim` or `classifyCommand` names something outside its body.
- `SyntaxError: Cannot use import statement`: the symlink did not resolve to `gate.mjs`; check `readlink <bin>/<name>`.
- The signal test reports `code: 143` instead of `signal: "SIGTERM"`: the `exit` handler raised the signal before removing its own listener.

- [ ] **Step 13: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/heavy-command-gate/server && npm run lint -- plugins/heavy-command-gate/server
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: `Found 0 warnings and 0 errors.`, then a typecheck with exit 0. After formatting, rerun Step 11 and Step 12 once each: oxfmt may rewrap the bodies, and only the tests prove the rewrapped source still runs standalone.

- [ ] **Step 14: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/heavy-command-gate || { echo "STOP: not on feat/heavy-command-gate"; exit 1; }
git -C /workspace/utils/paseo add plugins/heavy-command-gate/server/paths.ts plugins/heavy-command-gate/server/paths.test.ts plugins/heavy-command-gate/server/shim/run-shim.ts plugins/heavy-command-gate/server/shim/install.ts plugins/heavy-command-gate/server/shim/install.posix.test.ts plugins/heavy-command-gate/server/shim/shim.posix.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): heavy-command-gate shim and installer" -- plugins/heavy-command-gate/server/paths.ts plugins/heavy-command-gate/server/paths.test.ts plugins/heavy-command-gate/server/shim/run-shim.ts plugins/heavy-command-gate/server/shim/install.ts plugins/heavy-command-gate/server/shim/install.posix.test.ts plugins/heavy-command-gate/server/shim/shim.posix.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages
```

Expected: the hook passes and git prints `6 files changed`; the identity line is `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` lists exactly the six paths; `status` prints nothing. On a hook failure, report and stop.

---

### Task 8: Server wiring: start, agent PATH hook, status RPC, cleanup

**Files:**

- Create: `plugins/heavy-command-gate/server/plugin.ts`
- Create: `plugins/heavy-command-gate/server/agent-title.ts`
- Modify: `plugins/heavy-command-gate/index.server.ts` (replace the Task 1 stub whole)
- Test: `plugins/heavy-command-gate/server/plugin.posix.test.ts` (Unix sockets, file modes)

**Interfaces:**

Consumes:

- `PluginServerContext` (`registerSettings`, `addHook`, `handle`), `PluginSettings<Schema>` (`read(): Promise<PluginSettingsState<Schema>>`, `subscribe(listener): PluginCleanup`; `subscribe` never replays the stored value), `PluginSettingsState<Schema>` (`{ status: "ready"; revision; values } | { status: "invalid"; revision; error }`), `PluginSessionOpenRequest` (`env: Record<string, string>` is the launch overlay only, usually without `PATH`) and `PluginHandlerContext` (`paseo: PaseoApi`) from `@getpaseo/plugin/server`. `addHook("agent.open.before", handler)` takes `(payload: { request }, context) => Promise<PluginSessionOpenRequest | void>` and returns its remover; adding or removing it reloads every agent's session.
- `paseo.agents.ref(id).refresh(): Promise<{ agent: { title: string | null } } | null>` from `@getpaseo/client` (through `PaseoApi`).
- `gateSettings`, `GateSettings`, `GateSettingsSchema`, `gbToBytes` (Task 1); `statusRpc`, `GateStatus` (Task 1).
- `createGate`, `GateConfig`, `GateDeps` (Task 5); `listenGateSocket`, `GateSocketServer` (Task 6); `readFreeMemory` (Task 3); `readShimRss` (Task 3).
- `gateHome`, `gatePaths`, `GatePaths` (Task 7); `resolveShimInterpreter`, `InterpreterResult`, `installShims`, `toShimConfig`, `writeShimConfig`, `SHIMMED_COMMANDS` (Task 7).

Produces:

- `plugins/heavy-command-gate/server/plugin.ts`
  - `export function withShimPath(request: PluginSessionOpenRequest, binDir: string, daemonPath: string | undefined): PluginSessionOpenRequest | undefined`
  - `export interface GatePluginOptions { paths: GatePaths; settings: PluginSettings<GateSettingsSchema>; interpreter: InterpreterResult; daemonPath: string | undefined; deps?: Partial<GateDeps> }`
  - `export interface GatePlugin { openHook(request: PluginSessionOpenRequest): Promise<PluginSessionOpenRequest | undefined>; status(resolveTitle: (agentId: string) => Promise<string | null>): Promise<GateStatus>; stop(): Promise<void> }`
  - `export function startGatePlugin(options: GatePluginOptions): GatePlugin` (synchronous; the start runs behind it, and `openHook` and `stop` wait for it)
- `plugins/heavy-command-gate/server/agent-title.ts`: `export function fetchAgentTitle(paseo: PluginHandlerContext["paseo"], agentId: string): Promise<string | null>`
- `plugins/heavy-command-gate/index.server.ts`: `export default function contribute(server: PluginServerContext): () => Promise<void>`. It registers the settings (`settings.gate.read`, `settings.gate.write`, `settings.gate.reset`), one `agent.open.before` hook and `heavy-command-gate.status.request` before returning.
- For sub-project 3 (Resource Manager): `GateStatus`, `RunningCommand` and `WaitingCommand` in `shared/rpc.ts` through `heavy-command-gate.status.request`; `HELD_ENV` in `server/protocol.ts`; `gatePaths()` in `server/paths.ts`. No other export of this plugin is meant to be stable.

- [ ] **Step 1: Write the failing wiring test**

Create `plugins/heavy-command-gate/server/plugin.posix.test.ts`:

```ts
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { connect, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
  PluginSessionOpenRequest,
  PluginSettings,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GateStatus } from "../shared/rpc.js";
import { gateSettings, type GateSettingsSchema } from "../shared/settings.js";
import { createGate, type GateDeps } from "./gate.js";
import { gatePaths, type GatePaths } from "./paths.js";
import { startGatePlugin, withShimPath, type GatePlugin } from "./plugin.js";
import type { ShimConfig, ShimHello } from "./protocol.js";
import { SHIMMED_COMMANDS, toShimConfig, type InterpreterResult } from "./shim/install.js";
import { listenGateSocket } from "./socket-server.js";

type SettingsState = PluginSettingsState<GateSettingsSchema>;
type SettingsListener = (state: SettingsState) => void | Promise<void>;

interface FakeSettings extends PluginSettings<GateSettingsSchema> {
  resolveRead(state: SettingsState): void;
  emit(state: SettingsState): void;
}

const GIB = 1024 ** 3;
const DAEMON_PATH = "/usr/local/bin:/usr/bin:/bin";
const NODE: InterpreterResult = { ok: true, path: process.execPath };

let root = "";
let paths: GatePaths = gatePaths("");
const logs: string[] = [];
const plugins: GatePlugin[] = [];
const sockets: Socket[] = [];

function ready(values: object, revision = "r1"): SettingsState {
  return { status: "ready", revision, values: gateSettings.schema.parse(values) };
}

// read() resolves when the test says so; subscribe() never replays, as the SDK's does not.
function createFakeSettings(): FakeSettings {
  const listeners = new Set<SettingsListener>();
  let resolveStored: (state: SettingsState) => void = () => undefined;
  const stored = new Promise<SettingsState>((resolve) => {
    resolveStored = resolve;
  });
  return {
    read: () => stored,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    resolveRead(state) {
      resolveStored(state);
    },
    emit(state) {
      for (const listener of listeners) void listener(state);
    },
  };
}

function start(settings: FakeSettings, interpreter: InterpreterResult = NODE): GatePlugin {
  const plugin = startGatePlugin({
    paths,
    settings,
    interpreter,
    daemonPath: DAEMON_PATH,
    deps: {
      readFreeMemory: () => 8 * GIB,
      readRss: () => null,
      log(message) {
        logs.push(message);
      },
    },
  });
  plugins.push(plugin);
  return plugin;
}

function openRequest(env: Record<string, string> = {}): PluginSessionOpenRequest {
  return {
    agentId: "agent-1",
    workspaceId: null,
    provider: "claude",
    cwd: "/tmp",
    reason: "create",
    purpose: "interactive",
    title: null,
    labels: {},
    tools: [],
    env,
    mcpServers: {},
  };
}

function readConfig(): unknown {
  return JSON.parse(readFileSync(paths.configPath, "utf8"));
}

function hello(agentId: string, command: string): ShimHello {
  return {
    type: "hello",
    version: 1,
    command,
    estimateBytes: GIB,
    agentId,
    process: { pid: 4242, startTime: 1, pidNamespace: null, bootId: null, initStartTime: null },
  };
}

// A shim's side of the protocol: connect, send the hello, keep the connection.
function sendHello(message: ShimHello): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = connect(paths.socketPath);
    sockets.push(socket);
    socket.on("error", reject);
    socket.once("connect", () => {
      socket.write(`${JSON.stringify(message)}\n`);
      resolve(socket);
    });
  });
}

function idleDeps(): GateDeps {
  return {
    now: () => Date.now(),
    readFreeMemory: () => null,
    readRss: () => null,
    startTimer: () => () => undefined,
    log: () => undefined,
  };
}

async function noTitle(): Promise<string | null> {
  return null;
}

function waitForStatus(
  plugin: GatePlugin,
  accept: (status: GateStatus) => boolean,
  resolveTitle: (agentId: string) => Promise<string | null> = noTitle,
): Promise<GateStatus> {
  return vi.waitFor(
    async () => {
      const status = await plugin.status(resolveTitle);
      if (!accept(status)) throw new Error(`not there yet: ${JSON.stringify(status)}`);
      return status;
    },
    { timeout: 5_000, interval: 50 },
  );
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "heavy-gate-plugin-"));
  paths = gatePaths(join(root, "heavy-command-gate"));
  logs.length = 0;
});

afterEach(async () => {
  for (const socket of sockets.splice(0)) socket.destroy();
  for (const plugin of plugins.splice(0)) await plugin.stop();
  rmSync(root, { recursive: true, force: true });
});

describe("withShimPath", () => {
  it("keeps the launch env and moves an existing shim entry to the front", () => {
    const request = openRequest({ PATH: `/opt/tools:${paths.binDir}:/usr/bin`, FOO: "bar" });
    expect(withShimPath(request, paths.binDir, DAEMON_PATH)).toEqual({
      ...request,
      env: { PATH: `${paths.binDir}:/opt/tools:/usr/bin`, FOO: "bar" },
    });
  });

  it("leaves a request alone when neither it nor the daemon has a PATH", () => {
    expect(withShimPath(openRequest(), paths.binDir, undefined)).toBeUndefined();
  });
});

describe("startGatePlugin", () => {
  it("installs the shims and the config from the stored settings, then puts them first on PATH", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    settings.resolveRead(ready({ slots: 2, patterns: [{ command: "tsc", estimateGb: 3 }] }));
    const opened = await plugin.openHook(openRequest());
    expect(opened?.env).toEqual({ PATH: `${paths.binDir}:${DAEMON_PATH}` });
    expect(readFileSync(paths.script, "utf8").split("\n")[0]).toBe(`#!${process.execPath}`);
    for (const name of SHIMMED_COMMANDS) {
      expect(lstatSync(join(paths.binDir, name)).isSymbolicLink()).toBe(true);
    }
    const expected: ShimConfig = {
      version: 1,
      enabled: true,
      patterns: [{ words: ["tsc"], estimateBytes: 3 * GIB }],
    };
    expect(readConfig()).toEqual(expected);
    expect(logs).toEqual([]);
  });

  it("puts the shims before the PATH an agent was launched with, once the gate is ready", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    const opening = plugin.openHook(openRequest({ PATH: "/custom/bin" }));
    settings.resolveRead(ready({}));
    expect((await opening)?.env.PATH).toBe(`${paths.binDir}:/custom/bin`);
  });

  it("rewrites config.json and reconfigures the gate when the settings are saved", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    settings.resolveRead(ready({}));
    await plugin.openHook(openRequest());
    settings.emit(ready({ enabled: false, slots: 3, reserveGb: 2 }, "r2"));
    await vi.waitFor(() => expect(readConfig()).toMatchObject({ enabled: false }), {
      timeout: 5_000,
    });
    expect(await plugin.status(noTitle)).toMatchObject({
      state: "off",
      error: null,
      slots: 3,
      reserveBytes: 2 * GIB,
    });
  });

  it("keeps the settings in force when the stored ones are invalid", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    settings.resolveRead({ status: "invalid", revision: "r1", error: "slots: Slots out of range" });
    await plugin.openHook(openRequest());
    expect(readConfig()).toEqual(toShimConfig(gateSettings.schema.parse({})));
    expect(await plugin.status(noTitle)).toMatchObject({
      state: "on",
      slots: 1,
      reserveBytes: GIB,
    });
    expect(logs).toEqual([
      "heavy-command-gate: settings are invalid, keeping the ones in force: slots: Slots out of range",
    ]);
  });

  it("lets a save that arrives before the stored settings are read win over them", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    settings.emit(ready({ slots: 4 }, "r2"));
    settings.resolveRead(ready({ slots: 2 }));
    await plugin.openHook(openRequest());
    expect((await plugin.status(noTitle)).slots).toBe(4);
    expect(readConfig()).toEqual(toShimConfig(gateSettings.schema.parse({ slots: 4 })));
  });

  it("stands down when another daemon's gate owns the socket", async () => {
    mkdirSync(paths.home, { recursive: true });
    const otherGate = createGate({
      config: { enabled: true, slots: 1, reserveBytes: GIB },
      deps: idleDeps(),
    });
    const other = await listenGateSocket({ socketPath: paths.socketPath, gate: otherGate });
    try {
      const settings = createFakeSettings();
      const plugin = start(settings);
      settings.resolveRead(ready({}));
      expect(await plugin.openHook(openRequest())).toBeUndefined();
      expect(existsSync(paths.script)).toBe(false);
      expect(existsSync(paths.configPath)).toBe(false);
      const reason = `another Paseo daemon owns ${paths.socketPath}`;
      expect(await plugin.status(noTitle)).toMatchObject({ state: "unavailable", error: reason });
      expect(logs).toEqual([`heavy-command-gate: unavailable, agents get no shims: ${reason}`]);
    } finally {
      await other?.close();
      otherGate.stop();
    }
  });

  it("is unavailable without a usable node, and writes nothing", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings, { ok: false, reason: "no node binary on the daemon PATH" });
    expect(await plugin.openHook(openRequest())).toBeUndefined();
    expect(existsSync(paths.home)).toBe(false);
    expect(await plugin.status(noTitle)).toMatchObject({
      state: "unavailable",
      error: "no node binary on the daemon PATH",
      running: [],
      waiting: [],
    });
    expect(logs).toEqual([
      "heavy-command-gate: unavailable, agents get no shims: no node binary on the daemon PATH",
    ]);
  });

  it("reports running and waiting commands with agent titles, null where the lookup fails", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    settings.resolveRead(ready({}));
    await plugin.openHook(openRequest());
    await sendHello(hello("agent-1", "tsc --noEmit"));
    await waitForStatus(plugin, (status) => status.running.length === 1);
    await sendHello(hello("agent-2", "vitest run"));
    async function resolveTitle(agentId: string): Promise<string | null> {
      if (agentId === "agent-1") return "Fix the parser";
      throw new Error("no such agent");
    }
    const status = await waitForStatus(plugin, (next) => next.waiting.length === 1, resolveTitle);
    expect(status).toMatchObject({ state: "on", freeBytes: 8 * GIB });
    expect(status.running).toEqual([
      expect.objectContaining({
        agentId: "agent-1",
        agentTitle: "Fix the parser",
        command: "tsc --noEmit",
      }),
    ]);
    expect(status.waiting).toEqual([
      expect.objectContaining({
        agentId: "agent-2",
        agentTitle: null,
        position: 1,
        waitingOn: "slot",
      }),
    ]);
  });

  it("stop ends every shim connection, removes the socket and can run twice", async () => {
    const settings = createFakeSettings();
    const plugin = start(settings);
    settings.resolveRead(ready({}));
    await plugin.openHook(openRequest());
    await sendHello(hello("agent-1", "tsc --noEmit"));
    const waiter = await sendHello(hello("agent-2", "vitest run"));
    await waitForStatus(plugin, (status) => status.waiting.length === 1);
    const closed = new Promise<void>((resolve) => {
      waiter.once("close", () => resolve());
    });
    await Promise.all([plugin.stop(), plugin.stop()]);
    await closed;
    expect(existsSync(paths.socketPath)).toBe(false);
    expect(await plugin.openHook(openRequest())).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/plugin.posix.test.ts --bail=1`

Expected: FAIL, `Cannot find module './plugin.js'`.

- [ ] **Step 3: Write the wiring**

Create `plugins/heavy-command-gate/server/plugin.ts`:

```ts
import { mkdir } from "node:fs/promises";
import { delimiter } from "node:path";
import { clearInterval, setInterval } from "node:timers";
import type {
  PluginSessionOpenRequest,
  PluginSettings,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import type { GateStatus } from "../shared/rpc.js";
import {
  gateSettings,
  gbToBytes,
  type GateSettings,
  type GateSettingsSchema,
} from "../shared/settings.js";
import { createGate, type GateConfig, type GateDeps } from "./gate.js";
import { readFreeMemory } from "./memory.js";
import type { GatePaths } from "./paths.js";
import { readShimRss } from "./procfs.js";
import {
  installShims,
  toShimConfig,
  writeShimConfig,
  type InterpreterResult,
} from "./shim/install.js";
import { listenGateSocket, type GateSocketServer } from "./socket-server.js";

type SettingsState = PluginSettingsState<GateSettingsSchema>;
type Phase = "starting" | "ready" | "unavailable";

export interface GatePluginOptions {
  paths: GatePaths;
  settings: PluginSettings<GateSettingsSchema>;
  interpreter: InterpreterResult;
  /** The daemon's PATH: the base for agents launched without a PATH of their own. */
  daemonPath: string | undefined;
  deps?: Partial<GateDeps>;
}

export interface GatePlugin {
  /** The agent.open.before handler: the request with the shim directory first on PATH. */
  openHook(request: PluginSessionOpenRequest): Promise<PluginSessionOpenRequest | undefined>;
  status(resolveTitle: (agentId: string) => Promise<string | null>): Promise<GateStatus>;
  stop(): Promise<void>;
}

/**
 * request.env is only the launch overlay, so PATH is usually absent and the agent inherits the
 * daemon's. The hook then sets PATH from the daemon's with the shim directory first. Returns
 * undefined, leaving the request alone, when there is no PATH to extend.
 */
export function withShimPath(
  request: PluginSessionOpenRequest,
  binDir: string,
  daemonPath: string | undefined,
): PluginSessionOpenRequest | undefined {
  const base = request.env.PATH ?? daemonPath;
  if (base === undefined) return undefined;
  const entries = base.split(delimiter).filter((entry) => entry !== binDir);
  // The daemon replaces env with the returned map, so the launch env is carried over.
  return { ...request, env: { ...request.env, PATH: [binDir, ...entries].join(delimiter) } };
}

function toGateConfig(values: GateSettings): GateConfig {
  return {
    enabled: values.enabled,
    slots: values.slots,
    reserveBytes: gbToBytes(values.reserveGb),
  };
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function titleOrNull(
  resolveTitle: (agentId: string) => Promise<string | null>,
  agentId: string,
): Promise<string | null> {
  try {
    return await resolveTitle(agentId);
  } catch {
    // An agent the daemon no longer knows, such as a shim run from a shell with a stale id.
    return null;
  }
}

function defaultGateDeps(): GateDeps {
  return {
    now: () => Date.now(),
    readFreeMemory: () => readFreeMemory(),
    readRss: (shim) => readShimRss(shim),
    startTimer(callback, ms) {
      const timer = setInterval(() => {
        // The plugin runs inside the daemon, which exits on an uncaught exception.
        try {
          callback();
        } catch (error) {
          console.error("heavy-command-gate: re-evaluating the queue failed", error);
        }
      }, ms);
      // Waiting shims must not keep the daemon, or a test process, alive.
      timer.unref();
      return () => clearInterval(timer);
    },
    log: (message) => console.error(message),
  };
}

/**
 * Starts the gate behind the returned handle. Order: refuse without a usable node; claim the socket
 * (a live owner means another daemon on this home, so stand down and write nothing); read the
 * settings unless a save arrived first; write gate.mjs, the links and config.json; then ready.
 * Only a ready gate puts the shims on an agent's PATH, so an agent never meets a missing config.
 */
export function startGatePlugin(options: GatePluginOptions): GatePlugin {
  const { paths, settings } = options;
  const deps: GateDeps = { ...defaultGateDeps(), ...options.deps };
  let values: GateSettings = gateSettings.schema.parse({});
  let phase: Phase = "starting";
  let unavailableReason: string | null = null;
  let server: GateSocketServer | null = null;
  let installed = false;
  let superseded = false;
  let stopped = false;
  let writing: Promise<void> = Promise.resolve();
  let stopping: Promise<void> | null = null;
  const gate = createGate({ config: toGateConfig(values), deps });

  function markUnavailable(reason: string): void {
    phase = "unavailable";
    unavailableReason = reason;
    deps.log(`heavy-command-gate: unavailable, agents get no shims: ${reason}`);
  }

  // Saves queue here, so config.json always ends with the newest settings.
  function queueConfigWrite(): void {
    const config = toShimConfig(values);
    writing = writing
      .then(() => writeShimConfig(paths.configPath, config))
      .catch((error: unknown) => {
        deps.log(`heavy-command-gate: writing ${paths.configPath} failed: ${describeError(error)}`);
      });
  }

  function applySettings(state: SettingsState): void {
    if (state.status === "invalid") {
      // The Limits screen shows the same error and offers Restore defaults.
      deps.log(
        `heavy-command-gate: settings are invalid, keeping the ones in force: ${state.error}`,
      );
      return;
    }
    values = state.values;
    gate.configure(toGateConfig(values));
    if (installed) queueConfigWrite();
  }

  // subscribe() never replays the stored value: read() supplies it unless a save arrived first.
  const unsubscribe = settings.subscribe((state) => {
    superseded = true;
    applySettings(state);
  });

  async function readStoredSettings(): Promise<void> {
    try {
      const state = await settings.read();
      if (!superseded) applySettings(state);
    } catch (error) {
      deps.log(`heavy-command-gate: reading settings failed: ${describeError(error)}`);
    }
  }

  async function start(): Promise<void> {
    const { interpreter } = options;
    if (!interpreter.ok) {
      markUnavailable(interpreter.reason);
      return;
    }
    try {
      await mkdir(paths.home, { recursive: true, mode: 0o700 });
      server = await listenGateSocket({ socketPath: paths.socketPath, gate });
      if (server === null) {
        markUnavailable(`another Paseo daemon owns ${paths.socketPath}`);
        return;
      }
      await readStoredSettings();
      if (stopped) return;
      await installShims({ paths, interpreter: interpreter.path });
      const first = values;
      await writeShimConfig(paths.configPath, toShimConfig(first));
      installed = true;
      // A save that arrived during the first write queues behind it.
      if (values !== first) queueConfigWrite();
      phase = "ready";
    } catch (error) {
      markUnavailable(`cannot start: ${describeError(error)}`);
    }
  }

  const ready = start();

  function gateState(): GateStatus["state"] {
    if (phase === "unavailable") return "unavailable";
    return values.enabled ? "on" : "off";
  }

  async function shutdown(): Promise<void> {
    stopped = true;
    unsubscribe();
    await ready;
    // Stopping the gate first makes the leaves that closing the connections triggers no-ops, so
    // nothing is admitted on the way out. Waiting shims see the close and run ungated.
    gate.stop();
    await server?.close();
    await writing;
  }

  return {
    async openHook(request) {
      await ready;
      if (phase !== "ready" || stopped) return undefined;
      return withShimPath(request, paths.binDir, options.daemonPath);
    },
    async status(resolveTitle) {
      const snapshot = gate.snapshot();
      // One lookup per agent per request, however many commands it has.
      const titles = new Map<string, Promise<string | null>>();
      function titleOf(agentId: string | null): Promise<string | null> {
        if (agentId === null) return Promise.resolve(null);
        const known = titles.get(agentId);
        if (known !== undefined) return known;
        const title = titleOrNull(resolveTitle, agentId);
        titles.set(agentId, title);
        return title;
      }
      const running = await Promise.all(
        snapshot.running.map(async (command) => ({
          ...command,
          agentTitle: await titleOf(command.agentId),
        })),
      );
      const waiting = await Promise.all(
        snapshot.waiting.map(async (command) => ({
          ...command,
          agentTitle: await titleOf(command.agentId),
        })),
      );
      return {
        state: gateState(),
        error: phase === "unavailable" ? unavailableReason : null,
        slots: values.slots,
        reserveBytes: gbToBytes(values.reserveGb),
        freeBytes: snapshot.freeBytes,
        running,
        waiting,
      };
    },
    stop() {
      stopping ??= shutdown();
      return stopping;
    },
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/server/plugin.posix.test.ts --bail=1`

Expected: PASS, 11 tests.

- [ ] **Step 5: Write the agent title lookup**

Create `plugins/heavy-command-gate/server/agent-title.ts`:

```ts
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

/** The agent's title as the app shows it; null when it has none or the daemon does not know it. */
export async function fetchAgentTitle(
  paseo: PluginHandlerContext["paseo"],
  agentId: string,
): Promise<string | null> {
  const result = await paseo.agents.ref(agentId).refresh();
  return result?.agent.title ?? null;
}
```

- [ ] **Step 6: Replace the server entry**

Replace the whole of `plugins/heavy-command-gate/index.server.ts` with:

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { fetchAgentTitle } from "./server/agent-title.js";
import { gateHome, gatePaths } from "./server/paths.js";
import { startGatePlugin } from "./server/plugin.js";
import { resolveShimInterpreter } from "./server/shim/install.js";
import { statusRpc } from "./shared/rpc.js";
import { gateSettings } from "./shared/settings.js";

// Everything the runtime snapshots at "ready" (the settings, the hook, the RPC) is registered
// before this returns; the gate starts behind it.
export default function contribute(server: PluginServerContext): () => Promise<void> {
  const gate = startGatePlugin({
    paths: gatePaths(gateHome()),
    settings: server.registerSettings(gateSettings),
    interpreter: resolveShimInterpreter(),
    daemonPath: process.env.PATH,
  });
  // One hook for the plugin's lifetime: adding or removing a hook reloads every agent's session.
  const removeHook = server.addHook("agent.open.before", ({ request }) => gate.openHook(request));
  server.handle(statusRpc, (_input, { paseo }) =>
    gate.status((agentId) => fetchAgentTitle(paseo, agentId)),
  );
  return async function cleanup(): Promise<void> {
    removeHook();
    await gate.stop();
  };
}
```

- [ ] **Step 7: Run the registry compile test**

Run: `cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1`

Expected: PASS, 1 test. The built-in compiler applies the server import boundaries: an import outside `@getpaseo/plugin/*`, `zod` and `node:*` fails here.

- [ ] **Step 8: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/heavy-command-gate && npm run lint -- plugins/heavy-command-gate
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: `Found 0 warnings and 0 errors.`, then a typecheck with exit 0. A type error on the `server.handle(statusRpc, ...)` line means `GateStatus` no longer matches `GateStatusSchema`'s input; fix the schema or `status()`, never with a cast. If formatting touched `server/shim/`, rerun `plugins/heavy-command-gate/server/shim/shim.posix.test.ts` once.

- [ ] **Step 9: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/heavy-command-gate || { echo "STOP: not on feat/heavy-command-gate"; exit 1; }
git -C /workspace/utils/paseo add plugins/heavy-command-gate/server/plugin.ts plugins/heavy-command-gate/server/plugin.posix.test.ts plugins/heavy-command-gate/server/agent-title.ts plugins/heavy-command-gate/index.server.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): wire the heavy-command gate into the daemon" -- plugins/heavy-command-gate/server/plugin.ts plugins/heavy-command-gate/server/plugin.posix.test.ts plugins/heavy-command-gate/server/agent-title.ts plugins/heavy-command-gate/index.server.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages
```

Expected: the hook passes and git prints `4 files changed`; the identity line is `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` lists exactly the four paths; `status` prints nothing. On a hook failure, report and stop.

---

### Task 9: Client screens and the Command Center item

**Files:**

- Create: `plugins/heavy-command-gate/client/format.ts`
- Create: `plugins/heavy-command-gate/client/settings-form.ts`
- Create: `plugins/heavy-command-gate/client/styles.ts`
- Create: `plugins/heavy-command-gate/client/commands-screen.tsx`
- Create: `plugins/heavy-command-gate/client/limits-screen.tsx`
- Create: `plugins/heavy-command-gate/index.client.tsx`
- Test: `plugins/heavy-command-gate/client/format.test.ts`
- Test: `plugins/heavy-command-gate/client/settings-form.test.ts`

**Interfaces:**

Consumes:

- `PluginClientContext` (`addSettingsScreen({ id, title, icon, Component })`, `addCommandCenterItem({ id, title, icon, keywords, context: "global", onSelect({ openSettings }) })`, both returning a cleanup), `PluginSurfaceProps` (`theme: PluginTheme`), `useSettings(definition): SettingsState<Schema>` (`{ status: "loading" } | { status: "error"; error } | { status: "invalid"; error; revision } | { status: "ready"; values; revision }`, each with `saving`, `saveError`, `save(values, revision): Promise<boolean>` that never throws, `reset(): Promise<boolean>`, `reload(): Promise<void>`) and `useRpc(contract)` from `@getpaseo/plugin/client`.
- `SettingsSection`, `SettingsCard`, `SettingsRow`, `SettingsSwitch`, `SettingsInput` (`initialValue`, `onChangeText`, `error`, `disabled`; uncontrolled), `SettingsAction`, `TextInput` from `@getpaseo/plugin/client/ui`. The SDK has no confirm dialog.
- `PluginTheme` from `@getpaseo/plugin` (`colors.foreground`, `foregroundMuted`, `statusDanger`, `border`, `surface0`).
- `statusRpc`, `GateStatus`, `RunningCommand`, `WaitingCommand` (Task 1); `gateSettings`, `GateSettings`, `HeavyPattern`, `GIB` (Task 1).
- Lucide icons `Hourglass` and `SlidersHorizontal` (present in `packages/app/node_modules/lucide-react-native`).

Produces:

- `plugins/heavy-command-gate/client/format.ts`: `formatGb(bytes: number): string`, `formatDuration(ms: number): string`, `agentLabel(command: { agentId: string | null; agentTitle: string | null }): string`, `describeRunning(command: RunningCommand): string`, `describeWaiting(command: WaitingCommand): string`, `describeGate(status: GateStatus): string`
- `plugins/heavy-command-gate/client/settings-form.ts`: `interface SettingsDraft { slots: string; reserveGb: string; patterns: string }`, `interface DraftErrors { slots: string | null; reserveGb: string | null; patterns: string | null }`, `type DraftResult = { ok: true; values: GateSettings } | { ok: false; errors: DraftErrors }`, `formatPatterns(patterns: readonly HeavyPattern[]): string`, `toDraft(values: GateSettings): SettingsDraft`, `parseDraft(draft: SettingsDraft, enabled: boolean): DraftResult`
- Settings screens `commands` ("Commands") and `limits` ("Limits"), and the Command Center item `open-commands` titled "Heavy commands", which opens `commands`.

- [ ] **Step 1: Write the failing formatting test**

Create `plugins/heavy-command-gate/client/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GateStatus, RunningCommand, WaitingCommand } from "../shared/rpc.js";
import {
  agentLabel,
  describeGate,
  describeRunning,
  describeWaiting,
  formatDuration,
  formatGb,
} from "./format.js";

const GIB = 1024 ** 3;

const RUNNING: RunningCommand = {
  id: "1",
  agentId: "0f3a9c2e-1111-2222-3333-444455556666",
  agentTitle: "Fix the parser",
  command: "npm run typecheck",
  pid: 4242,
  elapsedMs: 125_000,
  rssBytes: 2.5 * GIB,
  estimateBytes: 3 * GIB,
  forced: false,
};

const WAITING: WaitingCommand = {
  id: "2",
  agentId: null,
  agentTitle: null,
  command: "vitest run",
  pid: 4343,
  position: 2,
  waitedMs: 40_000,
  estimateBytes: 2 * GIB,
  waitingOn: "memory",
};

const STATUS: GateStatus = {
  state: "on",
  error: null,
  slots: 1,
  reserveBytes: GIB,
  freeBytes: 6.25 * GIB,
  running: [],
  waiting: [],
};

describe("format", () => {
  it("formats bytes as GB with one decimal", () => {
    expect(formatGb(1.5 * GIB)).toBe("1.5 GB");
    expect(formatGb(0)).toBe("0.0 GB");
    expect(formatGb(-5)).toBe("0.0 GB");
  });

  it("formats durations in their two largest units", () => {
    expect(formatDuration(42_900)).toBe("42 s");
    expect(formatDuration(125_000)).toBe("2 min 5 s");
    expect(formatDuration(3_725_000)).toBe("1 h 2 min");
    expect(formatDuration(-1)).toBe("0 s");
  });

  it("labels an agent by title, then by the start of its id, then as no agent", () => {
    expect(agentLabel(RUNNING)).toBe("Fix the parser");
    expect(agentLabel({ agentId: "0f3a9c2e-1111", agentTitle: null })).toBe("Agent 0f3a9c2e");
    expect(agentLabel({ agentId: null, agentTitle: null })).toBe("No agent");
  });

  it("describes a running command, with the starvation note when it was forced", () => {
    expect(describeRunning(RUNNING)).toBe(
      "Fix the parser, running 2 min 5 s, 2.5 GB in use, estimate 3.0 GB",
    );
    expect(describeRunning({ ...RUNNING, rssBytes: null, forced: true })).toBe(
      "Fix the parser, running 2 min 5 s, memory unknown, estimate 3.0 GB, started without enough free memory",
    );
  });

  it("describes a waiting command with its place and what it waits for", () => {
    expect(describeWaiting(WAITING)).toBe("#2, No agent, waiting 40 s for memory, estimate 2.0 GB");
    expect(describeWaiting({ ...WAITING, waitingOn: "slot" })).toBe(
      "#2, No agent, waiting 40 s for a slot, estimate 2.0 GB",
    );
  });

  it("describes the gate in each state", () => {
    expect(describeGate(STATUS)).toBe("6.3 GB free, 1.0 GB reserve, 1 slot");
    expect(describeGate({ ...STATUS, slots: 2, freeBytes: null })).toBe(
      "Free memory unknown, 1.0 GB reserve, 2 slots",
    );
    expect(describeGate({ ...STATUS, state: "off" })).toBe(
      "Heavy commands run at once, without waiting",
    );
    expect(
      describeGate({ ...STATUS, state: "unavailable", error: "PATH shims need a POSIX system" }),
    ).toBe("PATH shims need a POSIX system");
    expect(describeGate({ ...STATUS, state: "unavailable" })).toBe("The gate is not running");
  });
});
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/client/format.test.ts --bail=1`

Expected: FAIL, `Cannot find module './format.js'`.

- [ ] **Step 3: Write the formatting helpers**

Create `plugins/heavy-command-gate/client/format.ts`:

```ts
import type { GateStatus, RunningCommand, WaitingCommand } from "../shared/rpc.js";
import { GIB } from "../shared/settings.js";

interface AgentRef {
  agentId: string | null;
  agentTitle: string | null;
}

/** GB as the settings count them (2^30 bytes), one decimal: "1.5 GB". */
export function formatGb(bytes: number): string {
  return `${(Math.max(0, bytes) / GIB).toFixed(1)} GB`;
}

/** The two largest units of a duration: "42 s", "2 min 5 s", "1 h 2 min". */
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${seconds % 60} s`;
  return `${seconds} s`;
}

export function agentLabel(command: AgentRef): string {
  if (command.agentTitle) return command.agentTitle;
  if (command.agentId) return `Agent ${command.agentId.slice(0, 8)}`;
  return "No agent";
}

export function describeRunning(command: RunningCommand): string {
  const memory =
    command.rssBytes === null ? "memory unknown" : `${formatGb(command.rssBytes)} in use`;
  const parts = [
    agentLabel(command),
    `running ${formatDuration(command.elapsedMs)}`,
    memory,
    `estimate ${formatGb(command.estimateBytes)}`,
  ];
  if (command.forced) parts.push("started without enough free memory");
  return parts.join(", ");
}

export function describeWaiting(command: WaitingCommand): string {
  const reason = command.waitingOn === "slot" ? "for a slot" : "for memory";
  return [
    `#${command.position}`,
    agentLabel(command),
    `waiting ${formatDuration(command.waitedMs)} ${reason}`,
    `estimate ${formatGb(command.estimateBytes)}`,
  ].join(", ");
}

/** The hint under the on/off switch. */
export function describeGate(status: GateStatus): string {
  if (status.state === "unavailable") return status.error ?? "The gate is not running";
  if (status.state === "off") return "Heavy commands run at once, without waiting";
  const free =
    status.freeBytes === null ? "Free memory unknown" : `${formatGb(status.freeBytes)} free`;
  const slots = status.slots === 1 ? "1 slot" : `${status.slots} slots`;
  return `${free}, ${formatGb(status.reserveBytes)} reserve, ${slots}`;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/client/format.test.ts --bail=1`

Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing settings form test**

Create `plugins/heavy-command-gate/client/settings-form.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  COMMAND_MESSAGE,
  ESTIMATE_MESSAGE,
  RESERVE_MESSAGE,
  SLOTS_MESSAGE,
  gateSettings,
} from "../shared/settings.js";
import { parseDraft, toDraft, type SettingsDraft } from "./settings-form.js";

const LINE_MESSAGE = "write the estimate in GB, a space, then the command";
const DEFAULTS = gateSettings.schema.parse({});

function draft(patterns: string, slots = "1", reserveGb = "1"): SettingsDraft {
  return { slots, reserveGb, patterns };
}

describe("toDraft", () => {
  it("shows slots, the reserve and one line per pattern, estimate first", () => {
    const values = gateSettings.schema.parse({
      slots: 2,
      reserveGb: 0.5,
      patterns: [
        { command: "npm run typecheck", estimateGb: 3 },
        { command: "npm ci", estimateGb: 1.5 },
      ],
    });
    expect(toDraft(values)).toEqual({
      slots: "2",
      reserveGb: "0.5",
      patterns: "3 npm run typecheck\n1.5 npm ci",
    });
  });
});

describe("parseDraft", () => {
  it("reads the default settings back unchanged", () => {
    expect(parseDraft(toDraft(DEFAULTS), true)).toEqual({ ok: true, values: DEFAULTS });
  });

  it("keeps the on/off value it is given", () => {
    const result = parseDraft(draft("3 tsc"), false);
    expect(result).toEqual({
      ok: true,
      values: {
        enabled: false,
        slots: 1,
        reserveGb: 1,
        patterns: [{ command: "tsc", estimateGb: 3 }],
      },
    });
  });

  it("skips blank lines and # comments, and accepts an empty list", () => {
    expect(parseDraft(draft("# typecheckers\n\n  3 tsc  \n"), true)).toMatchObject({
      ok: true,
      values: { patterns: [{ command: "tsc", estimateGb: 3 }] },
    });
    expect(parseDraft(draft(""), true)).toMatchObject({ ok: true, values: { patterns: [] } });
  });

  it("names the line of a pattern without a command", () => {
    expect(parseDraft(draft("3 tsc\n2"), true)).toEqual({
      ok: false,
      errors: { slots: null, reserveGb: null, patterns: `Line 2: ${LINE_MESSAGE}` },
    });
  });

  it("names the line of a bad estimate and a bad command, counting comment lines", () => {
    expect(parseDraft(draft("# heavy\nlots tsc\n2 npm --workspace x test"), true)).toEqual({
      ok: false,
      errors: {
        slots: null,
        reserveGb: null,
        patterns: `Line 2: ${ESTIMATE_MESSAGE}\nLine 3: ${COMMAND_MESSAGE}`,
      },
    });
  });

  it("names the later line of a command listed twice", () => {
    expect(parseDraft(draft("3 tsc\n2 vitest\n1 tsc"), true)).toEqual({
      ok: false,
      errors: {
        slots: null,
        reserveGb: null,
        patterns: 'Line 3: Command "tsc" is listed more than once',
      },
    });
  });

  it("reports slot and reserve errors in their own fields", () => {
    expect(parseDraft(draft("3 tsc", "", "65"), true)).toEqual({
      ok: false,
      errors: { slots: SLOTS_MESSAGE, reserveGb: RESERVE_MESSAGE, patterns: null },
    });
  });

  it("reads a slot count with surrounding spaces", () => {
    expect(parseDraft(draft("3 tsc", " 2 ", "0"), true)).toMatchObject({
      ok: true,
      values: { slots: 2, reserveGb: 0 },
    });
  });
});
```

- [ ] **Step 6: Run it to make sure it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/client/settings-form.test.ts --bail=1`

Expected: FAIL, `Cannot find module './settings-form.js'`.

- [ ] **Step 7: Write the settings form**

Create `plugins/heavy-command-gate/client/settings-form.ts`:

```ts
import { gateSettings, type GateSettings, type HeavyPattern } from "../shared/settings.js";

/** What the Limits screen edits, as typed. */
export interface SettingsDraft {
  slots: string;
  reserveGb: string;
  /** One "<estimate GB> <command words>" per line. */
  patterns: string;
}

export interface DraftErrors {
  slots: string | null;
  reserveGb: string | null;
  /** One "Line N: ..." per problem, in line order. */
  patterns: string | null;
}

export type DraftResult = { ok: true; values: GateSettings } | { ok: false; errors: DraftErrors };

interface LineError {
  line: number;
  message: string;
}

const LINE_MESSAGE = "write the estimate in GB, a space, then the command";
const PATTERN_LINE = /^(\S+)\s+(.+)$/;

export function formatPatterns(patterns: readonly HeavyPattern[]): string {
  return patterns.map((pattern) => `${pattern.estimateGb} ${pattern.command}`).join("\n");
}

export function toDraft(values: GateSettings): SettingsDraft {
  return {
    slots: String(values.slots),
    reserveGb: String(values.reserveGb),
    patterns: formatPatterns(values.patterns),
  };
}

// An empty field is not 0: NaN fails the schema's number check with the field's own message.
function toNumber(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/** Validates the draft with the settings schema itself, so the screen and the store agree. */
export function parseDraft(draft: SettingsDraft, enabled: boolean): DraftResult {
  const lineErrors: LineError[] = [];
  const patterns: { command: string; estimateGb: number }[] = [];
  const lineNumbers: number[] = [];
  for (const [index, raw] of draft.patterns.split("\n").entries()) {
    const text = raw.trim();
    if (text === "" || text.startsWith("#")) continue;
    const match = PATTERN_LINE.exec(text);
    if (match === null) {
      lineErrors.push({ line: index + 1, message: LINE_MESSAGE });
      continue;
    }
    patterns.push({ estimateGb: toNumber(match[1]), command: match[2] });
    lineNumbers.push(index + 1);
  }
  const result = gateSettings.schema.safeParse({
    enabled,
    slots: toNumber(draft.slots),
    reserveGb: toNumber(draft.reserveGb),
    patterns,
  });
  if (result.success && lineErrors.length === 0) return { ok: true, values: result.data };
  const errors: DraftErrors = { slots: null, reserveGb: null, patterns: null };
  let listError: string | null = null;
  for (const issue of result.success ? [] : result.error.issues) {
    const [field, index] = issue.path;
    if (field === "slots") errors.slots ??= issue.message;
    else if (field === "reserveGb") errors.reserveGb ??= issue.message;
    else if (field === "patterns" && typeof index === "number") {
      lineErrors.push({ line: lineNumbers[index], message: issue.message });
    } else if (field === "patterns") listError = issue.message;
  }
  const lines = lineErrors
    .sort((a, b) => a.line - b.line)
    .map((error) => `Line ${error.line}: ${error.message}`);
  if (listError !== null) lines.unshift(listError);
  errors.patterns = lines.length === 0 ? null : lines.join("\n");
  return { ok: false, errors };
}
```

- [ ] **Step 8: Run the test to verify it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/heavy-command-gate/client/settings-form.test.ts --bail=1`

Expected: PASS, 9 tests.

- [ ] **Step 9: Write the styles and the Commands screen**

Create `plugins/heavy-command-gate/client/styles.ts`:

```ts
import { useMemo } from "react";
import { Platform } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";

const MONOSPACE = Platform.select({ ios: "Menlo", default: "monospace" });

/** Styles both settings screens share, derived from the host theme. */
export function useScreenStyles(theme: PluginTheme) {
  return useMemo(
    () => ({
      muted: { color: theme.colors.foregroundMuted },
      error: { color: theme.colors.statusDanger },
      // SettingsCard has no padding of its own; its rows use 16.
      block: { padding: 16, gap: 8 },
      // A web textarea does not grow with its text, so the editor needs its own height.
      editor: {
        minHeight: 240,
        padding: 12,
        borderWidth: 1,
        borderRadius: 8,
        borderColor: theme.colors.border,
        backgroundColor: theme.colors.surface0,
        color: theme.colors.foreground,
        fontFamily: MONOSPACE,
        fontSize: 12,
        textAlignVertical: "top" as const,
      },
    }),
    [theme],
  );
}

export type ScreenStyles = ReturnType<typeof useScreenStyles>;
```

Create `plugins/heavy-command-gate/client/commands-screen.tsx`:

```tsx
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { Text } from "react-native";
import {
  useRpc,
  useSettings,
  type PluginSurfaceProps,
  type SettingsState,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsRow,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { statusRpc, type GateStatus } from "../shared/rpc.js";
import { gateSettings } from "../shared/settings.js";
import { describeGate, describeRunning, describeWaiting } from "./format.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

const STATUS_KEY = ["heavy-command-gate", "status"] as const;
const POLL_MS = 5_000;
const COMMANDS_INFO =
  "Heavy commands that agents start through npm, npx, pnpm, tsc, tsgo, vitest, jest, gradle, gradlew or pytest wait here for a slot and for free memory. The lists refresh every 5 s.";

type GateSettingsState = SettingsState<typeof gateSettings.schema>;

interface GateSwitchProps {
  settings: GateSettingsState;
  status: GateStatus;
}

interface CommandListProps {
  status: GateStatus;
  styles: ScreenStyles;
}

interface StatusUnavailableProps {
  message: string;
  onRetry(): void;
  styles: ScreenStyles;
}

function settingsMessage(settings: GateSettingsState): string | null {
  if (settings.status === "invalid") {
    return `The saved settings are invalid. Fix them on the Limits tab.\n${settings.error}`;
  }
  if (settings.status === "error") return settings.error;
  return settings.saveError;
}

function GateSwitch({ settings, status }: GateSwitchProps) {
  const queryClient = useQueryClient();
  const changeEnabled = useCallback(
    async (next: boolean) => {
      if (settings.status !== "ready") return;
      const saved = await settings.save({ ...settings.values, enabled: next }, settings.revision);
      // Refetch now, so the switch and its hint agree before the next poll.
      if (saved) await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    [settings, queryClient],
  );
  // Until the settings load, the switch mirrors what the gate reports.
  const enabled = settings.status === "ready" ? settings.values.enabled : status.state !== "off";
  return (
    <SettingsSwitch
      label="Gate heavy commands"
      hint={describeGate(status)}
      error={settingsMessage(settings)}
      value={enabled}
      disabled={settings.status !== "ready" || settings.saving}
      onValueChange={changeEnabled}
    />
  );
}

function RunningList({ status, styles }: CommandListProps) {
  return (
    <SettingsSection title="Running">
      {status.running.length === 0 ? (
        <Text style={styles.muted}>Nothing running</Text>
      ) : (
        <SettingsCard>
          {status.running.map((command) => (
            <SettingsRow key={command.id} label={command.command} hint={describeRunning(command)} />
          ))}
        </SettingsCard>
      )}
    </SettingsSection>
  );
}

function WaitingList({ status, styles }: CommandListProps) {
  return (
    <SettingsSection title="Waiting">
      {status.waiting.length === 0 ? (
        <Text style={styles.muted}>Nothing waiting</Text>
      ) : (
        <SettingsCard>
          {status.waiting.map((command) => (
            <SettingsRow key={command.id} label={command.command} hint={describeWaiting(command)} />
          ))}
        </SettingsCard>
      )}
    </SettingsSection>
  );
}

function StatusUnavailable({ message, onRetry, styles }: StatusUnavailableProps) {
  return (
    <SettingsSection title="Heavy commands">
      <Text accessibilityRole="alert" style={styles.error}>
        {message}
      </Text>
      <SettingsAction label="Gate status" actionLabel="Try again" onPress={onRetry} />
    </SettingsSection>
  );
}

export function CommandsScreen({ theme }: PluginSurfaceProps) {
  const styles = useScreenStyles(theme);
  const settings = useSettings(gateSettings);
  const fetchStatus = useRpc(statusRpc);
  // The interval belongs to the query observer, so polling stops when the screen unmounts. The
  // next poll is the retry: TanStack's default retries would hide a failed fetch for about 7 s.
  const status = useQuery({
    queryKey: STATUS_KEY,
    queryFn: () => fetchStatus({}),
    refetchInterval: POLL_MS,
    retry: false,
  });
  const { refetch } = status;
  const retry = useCallback(() => {
    void refetch();
  }, [refetch]);
  const data = status.data;
  if (data === undefined) {
    if (status.isError) {
      return <StatusUnavailable message={status.error.message} onRetry={retry} styles={styles} />;
    }
    return <Text style={styles.muted}>Loading heavy commands...</Text>;
  }
  const refreshError = status.isError ? `Status refresh failed: ${status.error.message}` : null;
  return (
    <>
      <SettingsSection title="Heavy commands" info={COMMANDS_INFO}>
        {refreshError ? (
          <Text accessibilityRole="alert" style={styles.error}>
            {refreshError}
          </Text>
        ) : null}
        <SettingsCard>
          <GateSwitch settings={settings} status={data} />
        </SettingsCard>
      </SettingsSection>
      <RunningList status={data} styles={styles} />
      <WaitingList status={data} styles={styles} />
    </>
  );
}
```

- [ ] **Step 10: Write the Limits screen**

The SDK has no confirm dialog, so Restore defaults asks for a second press within 5 s. Create `plugins/heavy-command-gate/client/limits-screen.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsInput,
  SettingsSection,
  TextInput,
} from "@getpaseo/plugin/client/ui";
import { gateSettings } from "../shared/settings.js";
import { parseDraft, toDraft, type SettingsDraft } from "./settings-form.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

type GateSettingsState = SettingsState<typeof gateSettings.schema>;
type ReadySettings = Extract<GateSettingsState, { status: "ready" }>;
type ResettableSettings = Extract<GateSettingsState, { status: "ready" | "invalid" }>;

const LIMITS_INFO =
  "A heavy command starts when a slot is free and free memory covers its estimate plus the reserve.";
const PATTERNS_INFO =
  "One command per line: its estimate in GB, a space, then the words the command starts with. Lines starting with # are skipped. The longest match wins.";
const STALE_HINT = "The saved settings changed after you started editing. Discard to load them.";
const RESET_HINT =
  "Puts back the defaults: the gate on, one slot, a 1 GB reserve and the default heavy commands";
const RESET_CONFIRM_MS = 5_000;
const RESET_CONFIRM_HINT = `Press again within ${RESET_CONFIRM_MS / 1000} s to replace every limit and heavy command with the defaults`;

interface Draft extends SettingsDraft {
  /** The revision the edit started from, so saving over another client's save is a conflict. */
  revision: string;
}

interface ResetActionProps {
  settings: ResettableSettings;
  onReset(): void;
}

interface LimitsEditorProps {
  settings: ReadySettings;
  styles: ScreenStyles;
}

function ResetAction({ settings, onReset }: ResetActionProps) {
  // The first press arms the reset; the timer, an unmount, or the reset itself disarms it.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const timer = setTimeout(() => setArmed(false), RESET_CONFIRM_MS);
    return () => clearTimeout(timer);
  }, [armed]);
  const press = useCallback(() => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    onReset();
    void settings.reset();
  }, [armed, settings, onReset]);
  return (
    <SettingsAction
      label="Restore defaults"
      hint={armed ? RESET_CONFIRM_HINT : RESET_HINT}
      error={settings.saveError}
      actionLabel={armed ? "Confirm reset" : "Reset"}
      disabled={settings.saving}
      onPress={press}
    />
  );
}

function LimitsEditor({ settings, styles }: LimitsEditorProps) {
  // No draft means the fields show the saved settings and follow other clients' saves.
  const [draft, setDraft] = useState<Draft | null>(null);
  // Bumped by Discard and Reset, so the uncontrolled inputs remount with the saved values.
  const [generation, setGeneration] = useState(0);
  const { revision, values } = settings;
  const saved = useMemo(() => toDraft(values), [values]);
  const shown: SettingsDraft = draft ?? saved;
  const parsed = useMemo(() => parseDraft(shown, values.enabled), [shown, values.enabled]);
  const update = useCallback(
    (patch: Partial<SettingsDraft>) => {
      setDraft((current) => ({ ...(current ?? { ...saved, revision }), ...patch }));
    },
    [saved, revision],
  );
  const changeSlots = useCallback((text: string) => update({ slots: text }), [update]);
  const changeReserve = useCallback((text: string) => update({ reserveGb: text }), [update]);
  const changePatterns = useCallback((text: string) => update({ patterns: text }), [update]);
  const save = useCallback(async () => {
    if (draft === null || !parsed.ok) return;
    if (await settings.save(parsed.values, draft.revision)) setDraft(null);
  }, [draft, parsed, settings]);
  const clearDraft = useCallback(() => {
    setDraft(null);
    setGeneration((current) => current + 1);
  }, []);
  const discard = useCallback(() => {
    clearDraft();
    void settings.reload();
  }, [clearDraft, settings]);
  const errors = parsed.ok ? null : parsed.errors;
  const stale = draft !== null && draft.revision !== revision;
  const canSave = draft !== null && parsed.ok && !settings.saving;
  const canDiscard = draft !== null && !settings.saving;
  const inputKey = `${generation}:${draft?.revision ?? revision}`;
  return (
    <>
      <SettingsSection title="Limits" info={LIMITS_INFO}>
        <SettingsCard>
          <SettingsInput
            key={`slots:${inputKey}`}
            label="Slots"
            hint="How many heavy commands run at once"
            initialValue={shown.slots}
            error={errors?.slots}
            disabled={settings.saving}
            onChangeText={changeSlots}
          />
          <SettingsInput
            key={`reserve:${inputKey}`}
            label="Reserve in GB"
            hint="Memory kept free beside each command's estimate"
            initialValue={shown.reserveGb}
            error={errors?.reserveGb}
            disabled={settings.saving}
            onChangeText={changeReserve}
          />
        </SettingsCard>
      </SettingsSection>
      <SettingsSection title="Heavy commands" info={PATTERNS_INFO}>
        <SettingsCard>
          <View style={styles.block}>
            <TextInput
              multiline
              value={shown.patterns}
              onChangeText={changePatterns}
              editable={!settings.saving}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              accessibilityLabel="Heavy commands, one per line"
              style={styles.editor}
            />
            {errors?.patterns ? (
              <Text accessibilityRole="alert" style={styles.error}>
                {errors.patterns}
              </Text>
            ) : null}
          </View>
          <SettingsAction
            label="Save settings"
            hint={stale ? STALE_HINT : undefined}
            error={settings.saveError}
            actionLabel={settings.saving ? "Saving..." : "Save"}
            disabled={!canSave}
            onPress={save}
          />
          <SettingsAction
            label="Discard changes"
            actionLabel="Discard"
            disabled={!canDiscard}
            onPress={discard}
          />
          <ResetAction settings={settings} onReset={clearDraft} />
        </SettingsCard>
      </SettingsSection>
    </>
  );
}

function noop(): void {}

export function LimitsScreen({ theme }: PluginSurfaceProps) {
  const styles = useScreenStyles(theme);
  const settings = useSettings(gateSettings);
  if (settings.status === "loading") {
    return <Text style={styles.muted}>Loading settings...</Text>;
  }
  if (settings.status === "ready") return <LimitsEditor settings={settings} styles={styles} />;
  return (
    <SettingsSection title="Limits">
      <Text accessibilityRole="alert" style={styles.error}>
        {settings.error}
      </Text>
      <SettingsAction
        label="Read the saved settings again"
        actionLabel="Reload"
        onPress={settings.reload}
      />
      {settings.status === "invalid" ? <ResetAction settings={settings} onReset={noop} /> : null}
    </SettingsSection>
  );
}
```

- [ ] **Step 11: Write the client entry**

Create `plugins/heavy-command-gate/index.client.tsx`:

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { CommandsScreen } from "./client/commands-screen.js";
import { LimitsScreen } from "./client/limits-screen.js";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addSettingsScreen({
      id: "commands",
      title: "Commands",
      icon: "Hourglass",
      Component: CommandsScreen,
    }),
    client.addSettingsScreen({
      id: "limits",
      title: "Limits",
      icon: "SlidersHorizontal",
      Component: LimitsScreen,
    }),
    // Built-ins have no row in Settings > Plugins, so this item is the way to their settings. A
    // global item shows once a workspace on the host is open.
    client.addCommandCenterItem({
      id: "open-commands",
      title: "Heavy commands",
      icon: "Hourglass",
      keywords: ["gate", "typecheck", "memory"],
      context: "global",
      onSelect({ openSettings }) {
        openSettings("commands");
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
```

- [ ] **Step 12: Run the registry compile test, which now compiles the client too**

Run: `cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1`

Expected: PASS, 1 test. A client import the plugin compiler cannot bundle fails here; type errors surface in Step 13.

- [ ] **Step 13: Format, lint and typecheck**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/heavy-command-gate && npm run lint -- plugins/heavy-command-gate
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: `Found 0 warnings and 0 errors.`, then a typecheck with exit 0. If formatting touched `server/shim/`, rerun `plugins/heavy-command-gate/server/shim/shim.posix.test.ts` once.

- [ ] **Step 14: Commit with the fork identity (local only, never push)**

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/heavy-command-gate || { echo "STOP: not on feat/heavy-command-gate"; exit 1; }
git -C /workspace/utils/paseo add plugins/heavy-command-gate/client/format.ts plugins/heavy-command-gate/client/format.test.ts plugins/heavy-command-gate/client/settings-form.ts plugins/heavy-command-gate/client/settings-form.test.ts plugins/heavy-command-gate/client/styles.ts plugins/heavy-command-gate/client/commands-screen.tsx plugins/heavy-command-gate/client/limits-screen.tsx plugins/heavy-command-gate/index.client.tsx
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): heavy-command gate settings screens" -- plugins/heavy-command-gate/client/format.ts plugins/heavy-command-gate/client/format.test.ts plugins/heavy-command-gate/client/settings-form.ts plugins/heavy-command-gate/client/settings-form.test.ts plugins/heavy-command-gate/client/styles.ts plugins/heavy-command-gate/client/commands-screen.tsx plugins/heavy-command-gate/client/limits-screen.tsx plugins/heavy-command-gate/index.client.tsx
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages
```

Expected: the hook passes and git prints `8 files changed`; the identity line is `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` lists exactly the eight paths; `status` prints nothing. On a hook failure, report and stop.

---

### Task 10: Manual test on the dev daemon, and the docs

**Files:**

- Modify: `docs/plugins.md:135-137` (the "Local runs of ..." paragraph at the end of the `shared-mcp` part of "Built-in plugins", replaced by three paragraphs)
- Test (manual, not committed): `.dev/paseo-home/plugin-settings/heavy-command-gate/gate.json` (gitignored dev home, seeded before the daemon starts)
- Scratch (outside the repo, not committed): `/tmp/heavy-gate-test.env`, `/tmp/heavy-gate-dev-password` (mode 0600, removed in Step 20), `/tmp/heavy-gate-build.out`, `/tmp/heavy-gate-dist.out`, `/tmp/heavy-gate-dist-home` and the `/tmp/heavy-gate-dist-home.*` it names (removed in Step 4), `/tmp/heavy-gate-light.err`, `/tmp/heavy-gate-agent/` (`package.json`, `typecheck.sh`, `runs.log`), `/tmp/heavy-gate-dev-daemon.pid`, `/tmp/heavy-gate-dev-daemon.out`, `/tmp/heavy-gate-dev-app.pid`, `/tmp/heavy-gate-dev-app.out`, `/tmp/heavy-gate-holder.pid`, `/tmp/heavy-gate-probe.pid`, `/tmp/heavy-gate-shim.out`, `/tmp/heavy-gate-a.json`, `/tmp/heavy-gate-b.json`, `/tmp/heavy-gate-kiro.json`, `/tmp/heavy-gate-opencode.json`, `/tmp/heavy-gate-agents`

**Interfaces:**

Consumes:

- The settings store: `$PASEO_HOME/plugin-settings/heavy-command-gate/gate.json` holds `{ "version": 1, "values": GateSettings }`. Nothing watches it, so a hand edit applies at the next daemon start. Restore defaults persists the parsed defaults, all four fields with 11 patterns, not `{}` (`packages/server/src/server/plugins/settings/index.ts`, `write()` then `persist()`).
- The gate home (Decision 2, `gatePaths` from Task 7): `<PASEO_HOME>/heavy-command-gate/` at 0700 with `gate.mjs` (0700), `bin/<npm|npx|pnpm|tsc|tsgo|vitest|jest|gradle|gradlew|pytest> -> ../gate.mjs`, `config.json` (0600, `{ version: 1, enabled, patterns: [{ words, estimateBytes }] }`) and `gate.sock` while the plugin runs.
- Shim stderr (Task 7): `waiting for heavy-command slot (<n> ahead, <X.X> GB free)`, `waiting for free memory (<n> ahead, <X.X> GB free, <X.X> GB needed)`, `heavy-command gate: not reachable (<reason>), running <name> ungated`. A held command carries `PASEO_HEAVY_GATE_HELD=1` (`HELD_ENV`, Task 3); the shim that asked the gate does not.
- Plugin log lines (Task 8), printed with `console.error`, so they reach the supervisor's stdout as raw text: `heavy-command-gate: unavailable, agents get no shims: <reason>` (including `another Paseo daemon owns <socket>`) and `heavy-command-gate: settings are invalid, keeping the ones in force: <error>`.
- Methods the plugin registers (Tasks 1 and 8): `heavy-command-gate.status.request`, `settings.gate.read`, `settings.gate.write`, `settings.gate.reset`.
- Client (Task 9): the Command Center item `Heavy commands`; screens `Commands` (`/plugins/heavy-command-gate/commands`) and `Limits`; the switch `Gate heavy commands` with the `describeGate` hint; sections `Running` and `Waiting` with `describeRunning` and `describeWaiting` hints, `Nothing running`, `Nothing waiting`; on Limits the inputs `Slots` and `Reserve in GB`, the text box `Heavy commands, one per line` (`<GB> <command>` lines), and the actions `Save`, `Discard`, `Reset` then `Confirm reset`.
- The repo CLI: `paseo run --no-wait --json` prints `{ agentId, status }`; `paseo run --wait-timeout <duration> --json` waits first and reports `completed`, `permission`, `timeout` or `error`; `paseo wait <id> --timeout <seconds>`; `paseo logs <id> --json`; `paseo permit allow <id> --all`; `paseo agent archive <id> --force`.

Produces: the `heavy-command-gate` paragraphs in `docs/plugins.md`, which name `PASEO_HEAVY_GATE_HELD=1` as the contract sub-project 3 reads. No code, no exports.

Ground rules for every step of this task:

- Never signal the daemon on 6767 and never write under `~/.paseo`. The test reads one file there, `config.json`, which Step 6 copies without printing. Every pid this task signals comes from `$DEV_HOME/paseo.pid`, from a `/tmp/heavy-gate-*` pid file this task wrote, or from a process whose environment carries `PASEO_AGENT_ID=heavy-gate-manual` or the id of an agent this task created. Never use `pkill`.
- The dev daemon runs with a random password from `/tmp/heavy-gate-dev-password` (Step 1), binds only the Docker bridge address 172.22.0.3, and starts with `env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_HOST -u PASEO_HEAVY_GATE_HELD`. An inherited `PASEO_HEAVY_GATE_HELD=1` would reach every dev agent and make every shim run straight through.
- `CLEAN_PATH` is this shell's `PATH` without any `*/heavy-command-gate/bin` entry. The dev daemon and every hand-run shim get it, so a gate on the daemon that runs this session (once this built-in ships there) cannot answer for the dev gate: a shim skips only its own directory when it looks for the real binary.
- Shell state does not persist between Bash calls, so every shell step starts with `. /tmp/heavy-gate-test.env`. Wait loops run under `bash -c` and either chain their follow-up with `&&` or print a line starting with `TIMEOUT`. A loop that can run longer than 60 s starts with the Bash tool's `run_in_background: true`.
- Memory: from Step 9 on, every shell step starts with `mem_ok`. It prints `LOW MEMORY` and fails below 2500 MB of `MemAvailable`; then run **Abort and clean up** at once.
- Heavy commands hold `/tmp/paseo-heavy.lock`: the server build and the dist test (Step 3), Metro and the web bundle (Step 9, which keeps the lock until Step 20), and the pre-commit hook (Step 22). The stand-in `typecheck.sh` takes no lock and no memory.
- Never print a secret. No step prints `config.json`, `~/.claude/settings.json`, a token or `PASEO_PASSWORD`. Environment reads print only `PASEO_AGENT_ID`, `PASEO_HEAVY_GATE_HELD` and the first `PATH` entry. The one value printed on purpose is this run's throwaway dev password, in Step 9, because the browser form needs it.
- A `TIMEOUT` or `LOW MEMORY` line, or any output that differs from Expected, ends the run: read the logs the step names, then run **Abort and clean up** before investigating. From Step 9 on, Metro holds the shared heavy lock and blocks every other agent's typecheck, test and commit.

**Abort and clean up.** Run with `run_in_background: true` (up to about 90 s):

```bash
bash -c '. /tmp/heavy-gate-test.env && abort_cleanup'
```

Then call `mcp__playwright__browser_tabs` with `{"action": "list"}` and, if a `http://172.22.0.3:8081` tab is open, `{"action": "close", "index": <its index>}`.

Expected: one line per thing it stopped, then `abort cleanup done`, with no `STILL LISTENING` or `TIMEOUT` line. `abort_cleanup` (Step 1) works from any step and skips what never started: it archives the agents in `/tmp/heavy-gate-agents` while the dev daemon answers; sends SIGTERM to the dev supervisor, but only one that carries `PASEO_HOME=$DEV_HOME` and runs in the session `start_dev_daemon` recorded, and waits up to 30 s; sends SIGTERM to what is left of that session; sends SIGTERM to every process carrying `PASEO_AGENT_ID=heavy-gate-manual` or a recorded agent's id; stops the Metro session group (SIGKILL after 30 s), which releases the heavy lock; and reports ports 6768 and 8081. After an abort, start again from Step 1; Step 6 moves the run's dev home aside, so its logs stay available.

- [ ] **Step 1: Write the scratch helpers.** Run:

```bash
cat > /tmp/heavy-gate-test.env <<'EOF'
# Scratch helpers for the heavy-command gate manual test. Paths are the checkout's dev home or
# /tmp/heavy-gate-*; nothing here writes under ~/.paseo or signals the daemon on 6767.
REPO=/workspace/utils/paseo
DEV_HOME=/workspace/utils/paseo/.dev/paseo-home
GATE_HOME=/workspace/utils/paseo/.dev/paseo-home/heavy-command-gate
SETTINGS_FILE=/workspace/utils/paseo/.dev/paseo-home/plugin-settings/heavy-command-gate/gate.json
AGENT_DIR=/tmp/heavy-gate-agent
DEV_PASSWORD=$(cat /tmp/heavy-gate-dev-password 2>/dev/null)
# The Docker bridge address. hostname -i also prints the VPN overlay, in no guaranteed order.
DEV_IP=$(hostname -i | tr ' ' '\n' | grep -m1 '^172\.22\.')
# PATH without any heavy-command gate's shim directory (see the ground rules).
CLEAN_PATH=$(printf '%s' "$PATH" | tr ':' '\n' | grep -v '/heavy-command-gate/bin$' | paste -sd: -)
export REPO DEV_HOME GATE_HOME SETTINGS_FILE AGENT_DIR DEV_PASSWORD DEV_IP CLEAN_PATH

mem_ok() {
  local mb
  mb=$(awk '/^MemAvailable:/ { print int($2 / 1024) }' /proc/meminfo)
  if [ "$mb" -lt 2500 ]; then echo "LOW MEMORY: $mb MB available, run Abort and clean up"; return 1; fi
  echo "memory ok: $mb MB available"
}
group_alive() { kill -0 -- "-$1" 2>/dev/null; }
# True when something listens on TCP port $1, IPv4 or IPv6.
listening() {
  awk -v p="$(printf ':%04X' "$1")" \
    'FNR > 1 && $4 == "0A" && substr($2, length($2) - 4) == p { f = 1 } END { exit !f }' \
    /proc/net/tcp /proc/net/tcp6
}
# Supervisor pid from the dev home's pid lock (never ~/.paseo).
sup_pid() {
  node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pid)' \
    "$DEV_HOME/paseo.pid"
}
dev_health() { curl -s -m 2 -o /dev/null -w '%{http_code}' "http://$DEV_IP:6768/api/health"; }
wait_for_file() {
  timeout 10 bash -c 'until [ -s "$1" ]; do sleep 0.2; done' _ "$1" ||
    { echo "TIMEOUT: $1 is still empty"; return 1; }
}
# The dev daemon in its own session, as the shared-mcp manual test starts it, plus the two env
# rules of this task: no inherited PASEO_HEAVY_GATE_HELD, and CLEAN_PATH as the daemon's PATH.
start_dev_daemon() {
  case "$DEV_IP" in
    172.22.*) ;;
    *) echo "refusing to bind '$DEV_IP': not the Docker bridge"; return 1 ;;
  esac
  [ -n "$DEV_PASSWORD" ] || { echo "no dev password in /tmp/heavy-gate-dev-password"; return 1; }
  : > /tmp/heavy-gate-dev-daemon.pid
  (cd "$REPO" && setsid -f sh -c 'echo $$ > /tmp/heavy-gate-dev-daemon.pid
echo "Home:    $1"
echo "Listen:  $2:6768"
exec env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_HOST -u PASEO_HEAVY_GATE_HELD \
  PATH="$4" PASEO_PASSWORD="$3" PASEO_HOME="$1" PASEO_LISTEN="$2:6768" PASEO_CORS_ORIGINS="*" \
  PASEO_NODE_INSPECT=--inspect=0 PASEO_LOCAL_MODELS_DIR="$HOME/.paseo/models/local-speech" \
  PASEO_LOG_FORMAT=json PASEO_LOG_LEVEL=info npm run dev:server:raw' sh "$DEV_HOME" "$DEV_IP" \
    "$DEV_PASSWORD" "$CLEAN_PATH" >> /tmp/heavy-gate-dev-daemon.out 2>&1 < /dev/null)
}
# Repo CLI against the dev daemon only: explicit --host, the throwaway password, the dev home.
dev_cli() {
  (cd "$REPO" && env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_HOST -u PASEO_HEAVY_GATE_HELD \
    PASEO_HOME="$DEV_HOME" PASEO_PASSWORD="$DEV_PASSWORD" npm run --silent cli -- "$@" \
    --host "$DEV_IP:6768")
}
# Prints "<agentId> <status>" from a `run --json` result file.
run_result() {
  node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const v = Array.isArray(r) ? r[0] : r;
console.log(v.agentId, v.status);' "$1"
}
# Starts `npm run typecheck` in the agent dir through the dev gate's shims, detached, as agent
# heavy-gate-manual. Args: <seconds the stand-in sleeps> <pid file>. env and the #! line exec in
# place, so the pid file names the shim itself. Output goes to /tmp/heavy-gate-shim.out.
shim_run() {
  : > "$2"
  (cd "$AGENT_DIR" && setsid -f sh -c 'echo $$ > "$1"
exec env -u PASEO_AGENT_CWD -u PASEO_PASSWORD -u PASEO_HEAVY_GATE_HELD \
  PASEO_AGENT_ID=heavy-gate-manual HEAVY_GATE_SLEEP="$2" PATH="$3" npm run typecheck' \
    sh "$2" "$1" "$GATE_HOME/bin:$CLEAN_PATH" >> /tmp/heavy-gate-shim.out 2>&1 < /dev/null)
  wait_for_file "$2"
}
# Runs one 1 s stand-in through the dev gate, waits for it to end, prints its start line.
run_once() {
  local before
  before=$(grep -c '^end ' "$AGENT_DIR/runs.log")
  shim_run 1 /tmp/heavy-gate-probe.pid || return 1
  timeout 30 bash -c 'until [ "$(grep -c "^end " "$1")" -gt "$2" ]; do sleep 0.5; done' \
    _ "$AGENT_DIR/runs.log" "$before" || { echo "TIMEOUT: the run did not end"; return 1; }
  grep '^start ' "$AGENT_DIR/runs.log" | tail -n 1 | cut -d' ' -f1-3
}
# SIGTERM to the shim named in pid file $1, only while it still runs one of the dev gate's links.
stop_shim() {
  local p
  p=$(cat "$1" 2>/dev/null)
  if [ "${p:-0}" -gt 1 ] 2>/dev/null &&
    tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -qF "$GATE_HOME/bin/"; then
    kill -TERM "$p" && echo "sent SIGTERM to shim $p"
  else
    echo "no dev gate shim at pid ${p:-none}"
  fi
}
# One line per live shim of the dev gate: "<pid> <PASEO_AGENT_ID or none> <running|waiting>". A
# shim with a child runs its command; a shim without one waits for the gate.
gate_shims() {
  local f p id state
  # grep -l prints file names only, so no process's arguments reach the output. The whole-argument
  # match (-x) skips grep's own pattern argument: its "[^/]+" holds a slash.
  for f in $(grep -lzxE -- "$GATE_HOME/bin/[^/]+" /proc/[0-9]*/cmdline 2>/dev/null); do
    p=${f#/proc/}; p=${p%/cmdline}
    id=$(tr '\0' '\n' < "/proc/$p/environ" 2>/dev/null | grep -m1 '^PASEO_AGENT_ID=' | cut -d= -f2)
    if [ -n "$(pgrep -P "$p")" ]; then state=running; else state=waiting; fi
    echo "$p ${id:-none} $state"
  done
}
held_of() {
  if grep -qzx 'PASEO_HEAVY_GATE_HELD=1' "/proc/$1/environ" 2>/dev/null; then echo 1; else echo unset; fi
}
# The process tree under pid $1, depth first: "<comm> held=<1|unset>".
held_tree() {
  local c
  echo "$(cat "/proc/$1/comm" 2>/dev/null) held=$(held_of "$1")"
  for c in $(pgrep -P "$1"); do held_tree "$c"; done
}
# For each process carrying PASEO_AGENT_ID=$1: its comm and its first PATH entry, counted.
agent_path_heads() {
  local f p first
  for f in $(grep -lzx "PASEO_AGENT_ID=$1" /proc/[0-9]*/environ 2>/dev/null); do
    p=${f#/proc/}; p=${p%/environ}
    first=$(tr '\0' '\n' < "$f" 2>/dev/null | grep -m1 '^PATH=' | cut -d= -f2- | cut -d: -f1)
    echo "$(cat "/proc/$p/comm" 2>/dev/null) ${first:-no PATH}"
  done | sort | uniq -c
}
# runs.log without timestamps, with an OVERLAP line wherever a run started while another ran.
runs_report() {
  awk '$1 == "start" { if (n > 0) print "OVERLAP: " $2 " started while another run was going"; n++; print "start", $2, $3 }
    $1 == "end" { n--; print "end", $2 ($4 == "term" ? " term" : "") }' "$AGENT_DIR/runs.log"
}
settings_summary() {
  node -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).values;
const p = v.patterns[0];
console.log(`enabled=${v.enabled} slots=${v.slots} reserveGb=${v.reserveGb} patterns=${v.patterns.length} first=${p.command}:${p.estimateGb}`);' \
    "$SETTINGS_FILE"
}
# Summary of a shim config.json (default: the dev gate's). Prints no other field.
shim_config_summary() {
  node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const p = c.patterns[0];
console.log(`enabled=${c.enabled} patterns=${c.patterns.length} first=${p ? p.words.join(" ") + ":" + p.estimateBytes : "none"}`);' \
    "${1:-$GATE_HOME/config.json}"
}
dev_home_process() { grep -qzx "PASEO_HOME=$DEV_HOME" "/proc/$1/environ" 2>/dev/null; }
in_dev_session() {
  local want got
  want=$(cat /tmp/heavy-gate-dev-daemon.pid 2>/dev/null)
  got=$(ps -o pgid= -p "$1" 2>/dev/null | tr -d ' ')
  [ -n "$want" ] && [ "$got" = "$want" ]
}
dev_home_group() {
  local p
  for p in $(pgrep -g "$1"); do dev_home_process "$p" && return 0; done
  return 1
}
test_agent_ids() {
  [ -s /tmp/heavy-gate-agents ] && cut -d' ' -f2 /tmp/heavy-gate-agents
  return 0
}
abort_cleanup() {
  local id sup g pids
  if [ "$(dev_health)" = 200 ]; then
    for id in $(test_agent_ids); do
      dev_cli agent archive "$id" --force > /dev/null 2>&1 && echo "agent $id archived"
    done
  fi
  sup=$(sup_pid 2>/dev/null)
  if [ "${sup:-0}" -gt 1 ] 2>/dev/null && dev_home_process "$sup" && ! in_dev_session "$sup"; then
    echo "left dev supervisor $sup alone: this task did not start it"
  elif [ "${sup:-0}" -gt 1 ] 2>/dev/null && dev_home_process "$sup"; then
    kill -TERM "$sup"
    if timeout 30 bash -c 'while kill -0 "$1" 2>/dev/null; do sleep 1; done' _ "$sup"; then
      echo "dev supervisor $sup exited"
    else
      echo "dev supervisor $sup still running after SIGTERM"
    fi
  fi
  g=$(cat /tmp/heavy-gate-dev-daemon.pid 2>/dev/null)
  if [ "${g:-0}" -gt 1 ] 2>/dev/null && group_alive "$g" && dev_home_group "$g"; then
    kill -TERM -- "-$g" && echo "sent SIGTERM to dev session group $g"
  fi
  for id in heavy-gate-manual $(test_agent_ids); do
    pids=$(grep -lzx "PASEO_AGENT_ID=$id" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3 | xargs)
    if [ -n "$pids" ]; then kill -TERM $pids 2>/dev/null; echo "sent SIGTERM to $id: $pids"; fi
  done
  g=$(cat /tmp/heavy-gate-dev-app.pid 2>/dev/null)
  if [ "${g:-0}" -gt 1 ] 2>/dev/null && group_alive "$g" &&
    tr '\0' ' ' 2>/dev/null < "/proc/$g/cmdline" | grep -q 'scripts/dev-app.sh'; then
    kill -TERM -- "-$g"
    timeout 30 bash -c '. /tmp/heavy-gate-test.env; while group_alive "$1"; do sleep 1; done' _ "$g" ||
      { kill -KILL -- "-$g" 2>/dev/null; sleep 1; }
    if group_alive "$g"; then
      echo "TIMEOUT: Metro group $g still running and holding /tmp/paseo-heavy.lock"
    else
      echo "Metro group $g stopped; /tmp/paseo-heavy.lock released"
    fi
  fi
  for g in 6768 8081; do listening "$g" && echo "STILL LISTENING on $g"; done
  echo "abort cleanup done"
}
EOF
: > /tmp/heavy-gate-dev-daemon.out
: > /tmp/heavy-gate-shim.out
(umask 077; node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))' > /tmp/heavy-gate-dev-password)
bash -n /tmp/heavy-gate-test.env && . /tmp/heavy-gate-test.env && case "$DEV_IP" in 172.22.*) echo "DEV_IP=$DEV_IP" ;; *) echo "refusing to bind '$DEV_IP': not the Docker bridge"; exit 1 ;; esac && stat -c 'dev password file mode %a, %s bytes' /tmp/heavy-gate-dev-password && echo "PATH entries dropped: $(( $(printf '%s' "$PATH" | tr ':' '\n' | wc -l) - $(printf '%s' "$CLEAN_PATH" | tr ':' '\n' | wc -l) ))"
```

Expected: `DEV_IP=172.22.0.3`, `dev password file mode 600, 32 bytes`, and `PATH entries dropped: 0` while no gate runs for this session (`1` once the daemon that runs this session has the built-in). On `refusing to bind`, stop: nothing has started.

- [ ] **Step 2: Pre-flight ports and memory.** Run:

```bash
. /tmp/heavy-gate-test.env
for p in 6767 6768 8081; do if listening "$p"; then echo "$p up"; else echo "$p free"; fi; done
awk '/^MemAvailable:/ { print "available MB:", int($2 / 1024) }' /proc/meminfo
echo "held in this shell: ${PASEO_HEAVY_GATE_HELD:-unset}"
```

Expected: `6767 up` (the live daemon, left alone), `6768 free`, `8081 free`, `available MB: <at least 5000>` and `held in this shell: unset`. If a port is taken by a leftover of an earlier run, run **Abort and clean up** and repeat. Below 5000 MB, wait: Metro takes about 3 GB and the two Claude agents about 1.5 GB. `held in this shell: 1` means this session runs inside an admitted command; every helper unsets it, so go on.

- [ ] **Step 3: Build the server stack and run the dist gate with a throwaway home.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run build:server > /tmp/heavy-gate-build.out 2>&1; echo "exit=$?"; tail -n 5 /tmp/heavy-gate-build.out
```

Expected: `exit=0`. Then run:

```bash
cd /workspace/utils/paseo && ls -d packages/server/dist/server/builtin-plugins/heavy-command-gate && node --input-type=module -e 'const { builtinPlugins } = await import("/workspace/utils/paseo/packages/server/dist/server/server/plugins/builtin/index.js"); console.log("heavy-command-gate listed in the dist build:", builtinPlugins.includes("heavy-command-gate"));'
H=$(mktemp -d /tmp/heavy-gate-dist-home.XXXXXX) || exit 1
echo "$H" > /tmp/heavy-gate-dist-home
PASEO_HOME="$H" flock /tmp/paseo-heavy.lock timeout 300 node --test --test-reporter=tap scripts/builtin-plugins-dist.test.mjs > /tmp/heavy-gate-dist.out 2>&1; echo "dist test exit=$?"
grep -E '^# (pass|fail|duration_ms)' /tmp/heavy-gate-dist.out
```

Expected:

```
packages/server/dist/server/builtin-plugins/heavy-command-gate
heavy-command-gate listed in the dist build: true
dist test exit=0
# pass 1
# fail 0
# duration_ms <well under 300000>
```

The dist test starts every listed built-in in this process and ends with `runtime.stopAll()`. Exit `124` means a hang at the 300 s timeout: a gate timer without `unref()` or a cleanup that never resolves holds the process open, and the daemon's shutdown would hang the same way. List what the run left with `grep -lzx "PASEO_HOME=$(cat /tmp/heavy-gate-dist-home)" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3`, which prints pids only, send SIGTERM to those pids (this step started them), and fix Task 5, 6 or 8 before going on. Never look them up with `pgrep -a`, `pgrep -f` or `ps -f`: those print or match the arguments of every process, and Claude processes carry bearer tokens in theirs. `PASEO_HOME` must be the temp dir: in this container the shell's `PASEO_HOME` is the live daemon's home, and the plugin would rewrite the shims its agents use.

- [ ] **Step 4: Check what the dist run left in the temp home, and the shim with no gate.** Run:

```bash
. /tmp/heavy-gate-test.env
H=$(cat /tmp/heavy-gate-dist-home); G="$H/heavy-command-gate"
ls -A "$G"; ls "$G/bin" | xargs; readlink "$G/bin/npm"
stat -c '%a %n' "$G" "$G/gate.mjs" "$G/config.json" | sed "s#$H#<home>#"
node --check "$G/gate.mjs" && echo "gate.mjs parses"
head -n 1 "$G/gate.mjs"
shim_config_summary "$G/config.json"
cd "$REPO" && env -u PASEO_HEAVY_GATE_HELD PATH="$G/bin:$CLEAN_PATH" npm --version 2> /tmp/heavy-gate-light.err; echo "light exit=$? stderr lines=$(wc -l < /tmp/heavy-gate-light.err)"
cd "$REPO" && env -u PASEO_HEAVY_GATE_HELD PATH="$G/bin:$CLEAN_PATH" npx tsc --version 2>&1; echo "heavy exit=$?"
rm -rf "$H" /tmp/heavy-gate-dist-home
```

Expected:

```
bin
config.json
gate.mjs
gradle gradlew jest npm npx pnpm pytest tsc tsgo vitest
../gate.mjs
700 <home>/heavy-command-gate
700 <home>/heavy-command-gate/gate.mjs
600 <home>/heavy-command-gate/config.json
gate.mjs parses
#!<the absolute path of node, no spaces>
enabled=true patterns=11 first=tsc:3221225472
<the npm version>
light exit=0 stderr lines=0
heavy-command gate: not reachable (ENOENT), running npx ungated
Version <x.y.z>
heavy exit=0
```

No `gate.sock` is listed: the plugin's cleanup closed the server, which removes the socket file. `npm --version` is light, so the shim replaced itself with the real npm without a word. `npx tsc` classifies as `tsc` (3 GB), finds no socket, warns once and runs. This is the spec's "with no server the command still runs", through the dist build.

- [ ] **Step 5: Prepare the agents' project directory.** Run:

```bash
. /tmp/heavy-gate-test.env
rm -rf "$AGENT_DIR" && mkdir -p "$AGENT_DIR"
cat > "$AGENT_DIR/package.json" <<'JSON'
{
  "name": "heavy-gate-agent",
  "version": "0.0.0",
  "private": true,
  "scripts": { "typecheck": "exec sh ./typecheck.sh" }
}
JSON
cat > "$AGENT_DIR/typecheck.sh" <<'SH'
#!/bin/sh
# Stand-in for a typecheck in the heavy-command gate manual test. It records when it starts and
# ends, with the agent id and the held flag, then sleeps; SIGTERM ends it early.
log=/tmp/heavy-gate-agent/runs.log
agent=${PASEO_AGENT_ID:-none}
echo "start $agent held=${PASEO_HEAVY_GATE_HELD:-unset} $(date +%s)" >> "$log"
sleep "${HEAVY_GATE_SLEEP:-20}" &
pid=$!
trap 'kill "$pid" 2>/dev/null; echo "end $agent $(date +%s) term" >> "$log"; exit 143' TERM
wait "$pid"
echo "end $agent $(date +%s)"  >> "$log"
SH
: > "$AGENT_DIR/runs.log"
sh -n "$AGENT_DIR/typecheck.sh" && ls -A "$AGENT_DIR"
```

Expected: `package.json runs.log typecheck.sh`. The script is `exec sh ./typecheck.sh`, so npm's `sh -c` becomes the stand-in itself and npm's forwarded SIGTERM reaches the trap. Agents A and B run it for 20 s; the hand-run shims set `HEAVY_GATE_SLEEP`.

- [ ] **Step 6: Prepare a fresh dev home and seed the gate settings.** Run:

```bash
. /tmp/heavy-gate-test.env
cd "$REPO"
if [ -f "$DEV_HOME/paseo.pid" ] && kill -0 "$(sup_pid)" 2>/dev/null; then echo "a dev daemon is running on $DEV_HOME; stop it first"; exit 1; fi
if [ -d "$DEV_HOME" ]; then mv "$DEV_HOME" "$REPO/.dev/paseo-home.before-heavy-gate-$(date +%Y%m%d%H%M%S)"; fi
mkdir -p "$DEV_HOME" && chmod 700 "$DEV_HOME"
install -m 600 "$HOME/.paseo/config.json" "$DEV_HOME/config.json"
node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("persisted daemon password:", Boolean(c.daemon?.auth?.password))' "$DEV_HOME/config.json"
mkdir -p "$(dirname "$SETTINGS_FILE")"
(umask 077; cat > "$SETTINGS_FILE" <<'JSON'
{
  "version": 1,
  "values": {
    "enabled": true,
    "slots": 1,
    "reserveGb": 0.5,
    "patterns": [{ "command": "npm run typecheck", "estimateGb": 0.5 }]
  }
}
JSON
)
settings_summary
```

Expected: `persisted daemon password: false` and `enabled=true slots=1 reserveGb=0.5 patterns=1 first=npm run typecheck:0.5`. The daemon validates the seed when it starts: Step 8 expects no `settings are invalid` line. The 0.5 GB estimate and reserve keep the test admissible on a busy host; only `npm run typecheck` is heavy, so the agents' other commands never wait.

- [ ] **Step 7: Start the dev daemon and wait for it.** Run:

```bash
. /tmp/heavy-gate-test.env && start_dev_daemon && wait_for_file /tmp/heavy-gate-dev-daemon.pid && echo "dev session pgid=$(cat /tmp/heavy-gate-dev-daemon.pid)"
```

Then run with `run_in_background: true`:

```bash
timeout 300 bash -c '. /tmp/heavy-gate-test.env; until [ "$(dev_health)" = 200 ] && [ -S "$GATE_HOME/gate.sock" ]; do sleep 2; done' && echo "dev daemon healthy; gate.sock listening" || echo "TIMEOUT waiting for the dev daemon and gate.sock"
```

Expected: `dev session pgid=<N>`, then `dev daemon healthy; gate.sock listening` within about 2 minutes. On `TIMEOUT`, read `tail -n 60 /tmp/heavy-gate-dev-daemon.out` and `grep heavy-command-gate /tmp/heavy-gate-dev-daemon.out`, then run **Abort and clean up**.

- [ ] **Step 8: Check the plugin load and the dev gate's files.** Run:

```bash
. /tmp/heavy-gate-test.env
grep -E "^(Home|Listen):" /tmp/heavy-gate-dev-daemon.out | head -n 2
grep '"msg":"Loaded plugin"' "$DEV_HOME/daemon.log" | grep '"pluginId":"heavy-command-gate"' | grep -o '"methods":\[[^]]*\]'
grep -c '"msg":"Failed to start built-in plugin"' "$DEV_HOME/daemon.log"
grep -c 'heavy-command-gate: ' /tmp/heavy-gate-dev-daemon.out
ls -A "$GATE_HOME"; stat -c '%a %F' "$GATE_HOME" "$GATE_HOME/gate.mjs" "$GATE_HOME/config.json" "$GATE_HOME/gate.sock"
shim_config_summary
"$(head -n 1 "$GATE_HOME/gate.mjs" | cut -c3-)" --version
```

Expected:

- `Home:    /workspace/utils/paseo/.dev/paseo-home` and `Listen:  172.22.0.3:6768`.
- `"methods":[...]` holds `heavy-command-gate.status.request`, `settings.gate.read`, `settings.gate.write` and `settings.gate.reset`, in any order.
- `0` failed starts and `0` plugin log lines: no `unavailable` and no `settings are invalid`.
- `bin config.json gate.mjs gate.sock`, then `700 directory`, `700 regular file`, `600 regular file`, and `socket` for `gate.sock` (its mode depends on the umask).
- `enabled=true patterns=1 first=npm run typecheck:536870912` (0.5 GiB).
- The `#!` interpreter prints a Node version: the dev worker runs on plain Node, so it is `process.execPath`.

- [ ] **Step 9: Start Metro under the heavy-command lock and connect the browser.** Run:

```bash
. /tmp/heavy-gate-test.env && mem_ok || exit 1
: > /tmp/heavy-gate-dev-app.pid
(cd "$REPO" && setsid -f sh -c 'echo $$ > /tmp/heavy-gate-dev-app.pid; exec flock /tmp/paseo-heavy.lock env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_PASSWORD -u PASEO_HEAVY_GATE_HELD PASEO_HOME="$1" PASEO_LISTEN="$2:6768" scripts/dev-app.sh' sh "$DEV_HOME" "$DEV_IP" > /tmp/heavy-gate-dev-app.out 2>&1 < /dev/null)
wait_for_file /tmp/heavy-gate-dev-app.pid && echo "metro session pgid=$(cat /tmp/heavy-gate-dev-app.pid)"
```

Then run with `run_in_background: true`:

```bash
timeout 900 bash -c 'until grep -q "Waiting on http://localhost:8081" /tmp/heavy-gate-dev-app.out; do sleep 2; done' && grep -m3 -E "Metro:|Daemon:|Waiting on" /tmp/heavy-gate-dev-app.out || echo "TIMEOUT waiting for Metro"
```

Expected: `Metro:   http://localhost:8081`, `Daemon:  172.22.0.3:6768` and `Waiting on http://localhost:8081`. Metro keeps the lock until Step 20, so keep the browser steps short.

The Playwright browser is the shared CDP Chrome: open a tab of your own with `mcp__playwright__browser_tabs` `{"action": "new", "url": "http://172.22.0.3:8081/"}` and do not navigate any other tab. Run with `run_in_background: true`:

```bash
timeout 900 bash -c 'until grep -qE "Web Bundled|Bundling failed" /tmp/heavy-gate-dev-app.out; do sleep 3; done' && grep -m1 -E "Web Bundled|Bundling failed" /tmp/heavy-gate-dev-app.out || echo "TIMEOUT waiting for the web bundle"
```

Expected: `Web Bundled <ms>ms ...`. Then add the dev host by hand, because the override bootstrap never prompts for a password:

1. `mcp__playwright__browser_evaluate` with `{"function": "() => { localStorage.removeItem(\"@paseo:daemon-registry\"); return \"host registry cleared\"; }"}` (this origin only).
2. `mcp__playwright__browser_navigate` with `{"url": "http://172.22.0.3:8081/"}`.
3. `mcp__playwright__browser_snapshot`: "Welcome to Paseo" with `Direct connection`. Click it.
4. Print the password with `cat /tmp/heavy-gate-dev-password; echo`. Fill `Host` `172.22.0.3`, `Port` `6768` and `Password` with that value, click `Connect`, and click `Connect` again if "Connect to this host?" follows.

Expected: a snapshot of the app connected to the dev host, with no error overlay. The password guards only this dev daemon and stops guarding anything once Step 19 stops it; Step 20 deletes the file.

- [ ] **Step 10: Hold the slot by hand and check the held flag.** Run:

```bash
. /tmp/heavy-gate-test.env && mem_ok || exit 1
: > "$AGENT_DIR/runs.log"
shim_run 900 /tmp/heavy-gate-holder.pid && timeout 15 bash -c 'until grep -q "^start heavy-gate-manual" "$1"; do sleep 0.5; done' _ "$AGENT_DIR/runs.log" || echo "TIMEOUT: the holder did not start"
runs_report
gate_shims
held_tree "$(cat /tmp/heavy-gate-holder.pid)"
grep -c 'heavy-command gate:' /tmp/heavy-gate-shim.out
```

Expected: `start heavy-gate-manual held=1`; one `gate_shims` line, `<holder pid> heavy-gate-manual running`; a `held_tree` whose first line (the shim) ends `held=unset` and whose later lines (npm, the stand-in `sh`, `sleep`; names vary with how npm sets its title) all end `held=1`; and `0` warning lines, because the gate answered. That is the sub-project 3 contract: held commands carry the flag, the shim that asked the gate does not.

- [ ] **Step 11: Start two Claude agents that both run the heavy command.** Run:

```bash
. /tmp/heavy-gate-test.env || exit 1
PROMPT='Run exactly one shell command with the Bash tool, with a timeout of 600000 ms: npm run typecheck. Run nothing else. When it finishes, reply with the word done.'
: > /tmp/heavy-gate-agents
for name in a b; do
  mem_ok || exit 1
  dev_cli run --no-wait --provider claude --mode bypassPermissions --cwd "$AGENT_DIR" --title "heavy-gate-$name" --json "$PROMPT" > "/tmp/heavy-gate-$name.json"; echo "run $name exit=$?"
  echo "$name $(run_result "/tmp/heavy-gate-$name.json")" | tee -a /tmp/heavy-gate-agents
done
```

Expected: a `memory ok` line before each agent is created, then `run a exit=0`, `a <agent id> running` (or `created`), `run b exit=0`, `b <agent id> running`. Then run with `run_in_background: true`:

```bash
timeout 300 bash -c '. /tmp/heavy-gate-test.env; until [ "$(gate_shims | grep -c " waiting$")" -ge 2 ]; do sleep 2; done' && bash -c '. /tmp/heavy-gate-test.env; gate_shims; for id in $(test_agent_ids); do echo "agent $id:"; agent_path_heads "$id"; done' || echo "TIMEOUT waiting for both agents to queue"
```

Expected within about 2 minutes: three `gate_shims` lines, the holder `running` and one `waiting` line for each agent id in `/tmp/heavy-gate-agents`. For each agent, every counted process whose PATH does not start with `/tmp/heavy-gate-agent/node_modules/.bin` (npm's own prefix, which appears only once a command runs) starts with `/workspace/utils/paseo/.dev/paseo-home/heavy-command-gate/bin`: the hook put the shims first. On `TIMEOUT` with the agents' runs already in `runs.log` as `held=unset`, the provider's shell rebuilt `PATH` without the shim directory; read `dev_cli logs <id>`, record it as a finding against the hook, and run **Abort and clean up**.

- [ ] **Step 12: Watch the queue on the Commands screen.** In the app's sidebar, open the workspace for `/tmp/heavy-gate-agent` (the agents created it; the Command Center item appears only inside a workspace). Press `Control+k` with `mcp__playwright__browser_press_key`, type `Heavy commands` with `mcp__playwright__browser_type`, and click the item `Heavy commands`. Take `mcp__playwright__browser_snapshot`.

Expected: the URL ends `/plugins/heavy-command-gate/commands`; the header reads `heavy-command-gate`; two tabs show, `Commands` and `Limits`. Under `Heavy commands`, the switch `Gate heavy commands` is on, with the hint `<X.X> GB free, 0.5 GB reserve, 1 slot`. `Running` has one row labelled `npm run typecheck` with the hint `Agent heavy-ga, running <d>, <about 0.1> GB in use, estimate 0.5 GB` (the hand-run id is not an agent the daemon knows, so its label is the id's first 8 characters). `Waiting` has two rows labelled `npm run typecheck`, with the hints `#1, heavy-gate-<a or b>, waiting <d> for a slot, estimate 0.5 GB` and `#2, heavy-gate-<the other>, waiting <d> for a slot, estimate 0.5 GB`. Wait 10 s (`mcp__playwright__browser_wait_for` `{"time": 10}`) and snapshot again: the durations grew, which is the 5 s poll. Built-ins have no row in Settings > Plugins, so if the item is missing inside a workspace, Task 9 is incomplete: run **Abort and clean up**, fix Task 9, start again from Step 1.

- [ ] **Step 13: Release the holder and watch the agents run one after the other.** Run:

```bash
. /tmp/heavy-gate-test.env && mem_ok && stop_shim /tmp/heavy-gate-holder.pid
```

Then run with `run_in_background: true`:

```bash
timeout 240 bash -c '. /tmp/heavy-gate-test.env; until [ "$(grep -c "^end " "$AGENT_DIR/runs.log")" -ge 3 ]; do sleep 2; done' && bash -c '. /tmp/heavy-gate-test.env; runs_report; gate_shims | wc -l' || echo "TIMEOUT waiting for both agents' runs to end"
```

Expected:

```
start heavy-gate-manual held=1
end heavy-gate-manual term
start <first agent id> held=1
end <first agent id>
start <second agent id> held=1
end <second agent id>
0
```

No `OVERLAP` line: each agent started only after the run before it ended, and the holder's SIGTERM reached the stand-in through the shim and npm. Then run:

```bash
. /tmp/heavy-gate-test.env && mem_ok || exit 1
for id in $(test_agent_ids); do dev_cli wait "$id" --timeout 300 > /dev/null; echo "$id wait exit=$? slot wait lines: $(dev_cli logs "$id" --json | grep -c 'waiting for heavy-command slot')"; done
for id in $(test_agent_ids); do dev_cli agent archive "$id" --force > /dev/null && echo "agent $id archived"; done
```

Expected: for each agent, `wait exit=0 slot wait lines: 1` or more (the wait line reached the agent's tool output), then both `archived`. Archiving frees about 1.5 GB for the rest of the run. Snapshot the Commands tab: `Nothing running` and `Nothing waiting`.

- [ ] **Step 14: Make the estimate unaffordable and watch a memory wait.** Click the `Limits` tab and snapshot. Expected: `Slots` shows `1`, `Reserve in GB` shows `0.5`, and the text box `Heavy commands, one per line` holds `0.5 npm run typecheck`. Type `900 npm run typecheck` into that text box with `mcp__playwright__browser_type` (it replaces the text) and click `Save`. Then run:

```bash
. /tmp/heavy-gate-test.env && mem_ok || exit 1
settings_summary; shim_config_summary
shim_run 20 /tmp/heavy-gate-probe.pid && timeout 10 bash -c 'until grep -q "waiting for free memory" /tmp/heavy-gate-shim.out; do sleep 0.5; done' && grep 'waiting for free memory' /tmp/heavy-gate-shim.out | tail -n 1 || echo "TIMEOUT: no memory wait line"
gate_shims
```

Expected: `enabled=true slots=1 reserveGb=0.5 patterns=1 first=npm run typecheck:900`, `enabled=true patterns=1 first=npm run typecheck:966367641600`, then `waiting for free memory (0 ahead, <X.X> GB free, 900.5 GB needed)` and one line `<pid> heavy-gate-manual waiting`. Click the `Commands` tab and snapshot: `Nothing running`, and one waiting row with the hint `#1, Agent heavy-ga, waiting <d> for memory, estimate 900.0 GB`.

Finish this step within 5 minutes of `shim_run`: after 5 minutes with nothing running, the starvation guard starts the command anyway (`forced`). Then run:

```bash
. /tmp/heavy-gate-test.env && stop_shim /tmp/heavy-gate-probe.pid && timeout 10 bash -c '. /tmp/heavy-gate-test.env; while [ -n "$(gate_shims)" ]; do sleep 0.5; done' && echo "waiter gone" && grep -c '^start ' "$AGENT_DIR/runs.log"
```

Expected: `sent SIGTERM to shim <pid>`, `waiter gone` and `3`: the waiter left the queue without running. The next Commands poll shows `Nothing waiting`.

- [ ] **Step 15: Switch the gate off and on.** On `Limits`, type `0.5 npm run typecheck` into the text box and click `Save`. On `Commands`, click the switch `Gate heavy commands` off and snapshot. Expected: the switch is off with the hint `Heavy commands run at once, without waiting`. Then run:

```bash
. /tmp/heavy-gate-test.env && mem_ok || exit 1
settings_summary; shim_config_summary
run_once
```

Expected: `enabled=false slots=1 reserveGb=0.5 patterns=1 first=npm run typecheck:0.5`, `enabled=false patterns=1 first=npm run typecheck:536870912` and `start heavy-gate-manual held=unset`: switched off, the shim runs the command straight, without the flag. Click the switch on again, snapshot (the hint shows free memory again), then run:

```bash
. /tmp/heavy-gate-test.env && mem_ok && shim_config_summary && run_once
```

Expected: `enabled=true patterns=1 first=npm run typecheck:536870912` and `start heavy-gate-manual held=1`. No agent was reloaded: shims read `config.json` on every run.

- [ ] **Step 15a: One Kiro agent, then one OpenCode agent, runs the heavy command.** The spec gates the agents of every provider, and Steps 11 to 13 drive only Claude. This container has `kiro-cli` 2.28.0 at `/usr/local/bin/kiro-cli` and OpenCode 1.18.35 at `/usr/local/bin/opencode`. Run the three parts below once with `P=kiro`, then again with `P=opencode`, one agent at a time, each created right after `mem_ok`. In each pass a hand-run holder keeps the slot, so the agent's `npm run typecheck` has to wait at the gate. A `waiting` line under the agent's id proves that the shim directory reached the agent's shell and that the gate holds the command; its `held=1` start after the holder ends proves the gate admitted it. The step is numbered 15a so that Steps 16 to 22 keep the numbers the Resource Manager plan cites (its Step 21).

Part 1, with `run_in_background: true` (up to about 3 minutes). For the second pass, change `P=kiro` to `P=opencode`:

```bash
. /tmp/heavy-gate-test.env && mem_ok || exit 1
P=kiro
shim_run 900 /tmp/heavy-gate-holder.pid && timeout 15 bash -c '. /tmp/heavy-gate-test.env; until gate_shims | grep -q " heavy-gate-manual running$"; do sleep 0.5; done' || { echo "TIMEOUT: the holder did not start"; exit 1; }
dev_cli run --provider "$P" --cwd "$AGENT_DIR" --title "heavy-gate-$P" --wait-timeout 2m --json 'Run exactly one shell command: npm run typecheck. If your shell tool takes a timeout, give it 600000 ms. Run nothing else. When it finishes, reply with the word done.' > "/tmp/heavy-gate-$P.json"; echo "run $P exit=$?"
echo "$P $(run_result "/tmp/heavy-gate-$P.json")" | tee -a /tmp/heavy-gate-agents
```

Expected: `memory ok: <MB> MB available`, `run kiro exit=0`, then `kiro <agent id> permission` (the agent asks before it runs a shell command) or `kiro <agent id> timeout` (it asked nothing, and its command waits behind the holder). On `permission`, allow it once, as the shared-mcp manual test did for its Kiro agent: `. /tmp/heavy-gate-test.env && set -- $(tail -n 1 /tmp/heavy-gate-agents) && dev_cli permit allow "$2" --all`. Two outcomes are findings, not aborts. Record them, run `. /tmp/heavy-gate-test.env && stop_shim /tmp/heavy-gate-holder.pid`, archive the agent if it has an id (`dev_cli agent archive <agent id> --force`), and go on to the next pass, or to Step 16 after the OpenCode pass:

- An `error` status or a nonzero exit: read `dev_cli logs <agent id>`. A login or model error means that provider is not set up in this container; record `<P> not covered: <the error line>`.
- `completed`: the command did not wait for the holder. If `runs_report | tail -n 2` shows `start <agent id> held=unset`, the provider's shell rebuilt `PATH` without the shim directory: record it as a finding against the hook for that provider.

Part 2, with `run_in_background: true`:

```bash
timeout 180 bash -c '. /tmp/heavy-gate-test.env; set -- $(tail -n 1 /tmp/heavy-gate-agents); until gate_shims | grep -q " $2 waiting$"; do sleep 2; done' && bash -c '. /tmp/heavy-gate-test.env; set -- $(tail -n 1 /tmp/heavy-gate-agents); gate_shims; agent_path_heads "$2"' || echo "TIMEOUT waiting for the agent's command to queue"
```

Expected within about 2 minutes: two `gate_shims` lines, `<holder pid> heavy-gate-manual running` and `<pid> <agent id> waiting`. Every process that `agent_path_heads` counts has `/workspace/utils/paseo/.dev/paseo-home/heavy-command-gate/bin` as its first `PATH` entry, except heads that end in `node_modules/.bin`: both providers' user configs start the stdio MCP servers `context7`, `gitlab` and `playwright` through `npx`, which puts its own `node_modules/.bin` first. The shim-first ones include, for Kiro, `kiro-cli`, `kiro-cli-chat` and the waiting shim, and for OpenCode the agent's own `opencode` server (the hook's `PATH` makes Paseo start a dedicated one) and the waiting shim; names vary. Any other head is a finding to record, not an abort. On `TIMEOUT`, run `. /tmp/heavy-gate-test.env && dev_cli permit ls`: a request from this agent means it asked after Part 1 returned, so allow it as above and run Part 2 again. With no request, handle it as Part 1's `completed`.

Part 3, with `run_in_background: true` (up to about 9 minutes):

```bash
. /tmp/heavy-gate-test.env && mem_ok && stop_shim /tmp/heavy-gate-holder.pid || exit 1
set -- $(tail -n 1 /tmp/heavy-gate-agents)
if timeout 240 bash -c '. /tmp/heavy-gate-test.env; until grep -q "^end $1 " "$AGENT_DIR/runs.log"; do sleep 2; done' _ "$2"; then
  runs_report | tail -n 4; echo "overlaps: $(runs_report | grep -c '^OVERLAP')"
  dev_cli wait "$2" --timeout 300 > /dev/null; echo "wait exit=$?"
  dev_cli agent archive "$2" --force > /dev/null && echo "agent $2 archived"
  echo "live shims: $(gate_shims | wc -l)"
else
  echo "TIMEOUT waiting for the agent's run to end"
fi
```

Expected:

```
memory ok: <MB> MB available
sent SIGTERM to shim <holder pid>
start heavy-gate-manual held=1
end heavy-gate-manual term
start <agent id> held=1
end <agent id>
overlaps: 0
wait exit=0
agent <agent id> archived
live shims: 0
```

The agent's run started only after the holder's ended, and it carries the flag: the gate admitted it when the slot freed. Then run the OpenCode pass from Part 1.

- [ ] **Step 16: Stop the dev daemon gracefully and check that shims fall open.** Run:

```bash
. /tmp/heavy-gate-test.env
SUP=$(sup_pid); echo "supervisor=$SUP dev session=$(cat /tmp/heavy-gate-dev-daemon.pid)"
[ "${SUP:-0}" -gt 1 ] && kill -TERM "$SUP"
if timeout 30 bash -c 'while kill -0 "$1" 2>/dev/null; do sleep 1; done' _ "$SUP"; then echo "supervisor $SUP exited"; else echo "TIMEOUT: supervisor $SUP still running"; fi
timeout 30 bash -c '. /tmp/heavy-gate-test.env; while group_alive "$1"; do sleep 1; done' _ "$(cat /tmp/heavy-gate-dev-daemon.pid)" && echo "dev session group empty" || echo "TIMEOUT: dev session group still has processes"
test -e "$GATE_HOME/gate.sock" && echo "SOCKET LEFT" || echo "gate.sock removed"
run_once; grep 'heavy-command gate:' /tmp/heavy-gate-shim.out | tail -n 1
```

Expected: `supervisor <SUP> exited`, `dev session group empty`, `gate.sock removed`, then `start heavy-gate-manual held=1` and `heavy-command gate: not reachable (ENOENT), running npm ungated`. The cleanup closed the socket server, and a command run with no daemon still runs after one warning line, carrying the flag. `SOCKET LEFT` means the cleanup did not finish within the daemon's 2 s budget: record it, and Step 17 shows the next start reclaiming the file.

- [ ] **Step 17: Restart, then crash the daemon with kill -9.** Run `. /tmp/heavy-gate-test.env && start_dev_daemon && wait_for_file /tmp/heavy-gate-dev-daemon.pid`, then with `run_in_background: true` the Step 7 wait loop. Expected: `dev daemon healthy; gate.sock listening`. Then run:

```bash
. /tmp/heavy-gate-test.env && mem_ok || exit 1
WARN=$(grep -c 'heavy-command gate:' /tmp/heavy-gate-shim.out)
run_once; echo "new warnings: $(( $(grep -c 'heavy-command gate:' /tmp/heavy-gate-shim.out) - WARN ))"
SUP=$(sup_pid); DEVG=$(cat /tmp/heavy-gate-dev-daemon.pid)
WORKER=$(for c in $(pgrep -P "$SUP"); do grep -qzF daemon-worker "/proc/$c/cmdline" 2>/dev/null && echo "$c"; done)
echo "supervisor=$SUP worker=$WORKER"
[ "${SUP:-0}" -gt 1 ] && [ "${WORKER:-0}" -gt 1 ] && kill -KILL "$WORKER" "$SUP"
timeout 30 bash -c '. /tmp/heavy-gate-test.env; while group_alive "$1"; do sleep 1; done' _ "$DEVG" && echo "dev session group empty" || echo "TIMEOUT: dev session group still has processes"
test -S "$GATE_HOME/gate.sock" && echo "stale gate.sock left"
run_once; grep 'heavy-command gate:' /tmp/heavy-gate-shim.out | tail -n 1
```

Expected: `start heavy-gate-manual held=1` and `new warnings: 0` (the restarted gate admitted it), a single worker pid, `dev session group empty`, `stale gate.sock left`, then `start heavy-gate-manual held=1` and `heavy-command gate: not reachable (ECONNREFUSED), running npm ungated`. SIGKILL skips every cleanup, so the file stays and nothing listens on it.

- [ ] **Step 18: Restart and confirm the stale socket is reclaimed, then restore the defaults.** Run `. /tmp/heavy-gate-test.env && start_dev_daemon && wait_for_file /tmp/heavy-gate-dev-daemon.pid`, then with `run_in_background: true` the Step 7 wait loop. Then run:

```bash
. /tmp/heavy-gate-test.env && mem_ok || exit 1
grep -c 'another Paseo daemon owns' /tmp/heavy-gate-dev-daemon.out
WARN=$(grep -c 'heavy-command gate:' /tmp/heavy-gate-shim.out)
run_once; echo "new warnings: $(( $(grep -c 'heavy-command gate:' /tmp/heavy-gate-shim.out) - WARN ))"
```

Expected: `0`, `start heavy-gate-manual held=1` and `new warnings: 0`: the plugin probed the stale file, found nothing listening, removed it and listened again.

The browser tab reconnects on its own. Snapshot it, open the `Limits` tab (through the Command Center item again if the screen closed), click `Reset`, and within 5 s click `Confirm reset`. Snapshot. Expected: `Slots` `1`, `Reserve in GB` `1`, and eleven lines in the text box, starting `3 tsc`. Then run:

```bash
. /tmp/heavy-gate-test.env && settings_summary && shim_config_summary
```

Expected: `enabled=true slots=1 reserveGb=1 patterns=11 first=tsc:3` and `enabled=true patterns=11 first=tsc:3221225472`. The reset wrote the parsed defaults and the plugin rewrote `config.json` from them.

- [ ] **Step 19: Final graceful stop.** Run the first six lines of Step 16 (through the `gate.sock removed` check). Expected: `supervisor <SUP> exited`, `dev session group empty` and `gate.sock removed`. Then run:

```bash
. /tmp/heavy-gate-test.env
grep -c 'heavy-command-gate: unavailable' /tmp/heavy-gate-dev-daemon.out
for id in heavy-gate-manual $(test_agent_ids); do echo "$id processes: $(grep -lzx "PASEO_AGENT_ID=$id" /proc/[0-9]*/environ 2>/dev/null | wc -l)"; done
```

Expected: `0` (no start of this run was unavailable), and `0` processes for `heavy-gate-manual` and for each agent id.

- [ ] **Step 20: Close the tab, stop Metro, remove the password.** Call `mcp__playwright__browser_tabs` with `{"action": "list"}`, then `{"action": "close", "index": <index of the http://172.22.0.3:8081 tab>}`. Then run:

```bash
. /tmp/heavy-gate-test.env
APPG=$(cat /tmp/heavy-gate-dev-app.pid)
[ "${APPG:-0}" -gt 1 ] && kill -TERM -- "-$APPG"
if timeout 30 bash -c '. /tmp/heavy-gate-test.env; while group_alive "$1"; do sleep 1; done' _ "$APPG"; then echo "Metro group $APPG stopped"; else echo "TIMEOUT: Metro group $APPG still running"; fi
for p in 6768 8081; do listening "$p" || echo "$p closed"; done
rm -f /tmp/heavy-gate-dev-password && echo "dev password file removed"
```

Expected: `Metro group <APPG> stopped`, `6768 closed`, `8081 closed` and `dev password file removed`. That releases `/tmp/paseo-heavy.lock`. On `TIMEOUT`, run **Abort and clean up**. The test dev home stays for inspection, and the earlier one stays at `.dev/paseo-home.before-heavy-gate-<timestamp>`.

- [ ] **Step 21: Write the docs.** In `docs/plugins.md`, replace

```
Local runs of `scripts/builtin-plugins-dist.test.mjs` and
`packages/server/src/server/plugins/lifecycle.e2e.test.ts` start this built-in in process, so give
them `PASEO_HOME=$(mktemp -d)`; otherwise it works in the real `$PASEO_HOME/shared-mcp`.
```

with

```
The `heavy-command-gate` built-in queues the memory-heavy commands that agents start, such as
typechecks, test suites and installs. By default one runs at a time, and only while free memory
covers its estimate plus a 1 GB reserve. At every start the plugin writes
`$PASEO_HOME/heavy-command-gate/gate.mjs`, links it as `npm`, `npx`, `pnpm`, `tsc`, `tsgo`,
`vitest`, `jest`, `gradle`, `gradlew` and `pytest` in `bin/`, and puts that directory first on the
`PATH` of every agent session that opens. A shim asks the plugin over `gate.sock` before a heavy
command starts and keeps the connection open until the command exits, so a crash or a cancel frees
the slot. When nothing answers on the socket, the command runs at once after one warning line.
Admission rules are in the
[design](superpowers/specs/2026-11-06-heavy-command-gate-design.md#admission).

Every process of a heavy command that a shim started carries `PASEO_HEAVY_GATE_HELD=1`, whether
the gate admitted it or did not answer. A shim that sees it runs straight through, and other tools
can find held commands by it in `/proc/<pid>/environ`. The shim that asked does not carry it.
Agents get the shim directory only when their session opens, so reload the agents that were
running before the first daemon start with this built-in. Commands typed in Paseo terminals, run by
absolute path, or run from `node_modules/.bin` directly do not pass the gate. Free memory is the
smaller of `MemAvailable` and the cgroup v2 headroom (`memory.max` minus `memory.current`); without
`/proc`, only the slot count applies. The shims run on the daemon's own `node`, or under the
desktop app on the first `node` on the daemon's `PATH`. Without one, and on Windows, the gate
reports itself unavailable and agents run unchanged. Open the Commands and Limits screens from the
"Heavy commands" Command Center item, which appears once a workspace on that host is open.

Local runs of `scripts/builtin-plugins-dist.test.mjs` and
`packages/server/src/server/plugins/lifecycle.e2e.test.ts` start `shared-mcp` and
`heavy-command-gate` in process, so give them `PASEO_HOME=$(mktemp -d)`. Otherwise they work in the
real `$PASEO_HOME/shared-mcp` and `$PASEO_HOME/heavy-command-gate`, and can rewrite the shims that
live agents use.
```

The first two paragraphs follow design.md section 10 (sentence case, no dashes, plain prose). If the steps above showed a deviation that stays, such as Step 16's `SOCKET LEFT`, add one sentence stating it next to the rule it qualifies rather than leaving the paragraph wrong.

- [ ] **Step 22: Format, then commit with the fork identity (local only, never push).** Metro and the dev daemon are stopped (Steps 19 and 20), so the hook can take the lock. Run:

```bash
test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/heavy-command-gate || { echo "STOP: not on feat/heavy-command-gate"; exit 1; }
cd /workspace/utils/paseo && npm run format:files -- docs/plugins.md && git -C /workspace/utils/paseo diff --stat -- docs/plugins.md
git -C /workspace/utils/paseo add docs/plugins.md
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "docs(fork): document the heavy-command gate built-in" -- docs/plugins.md
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages docs/plugins.md
```

Expected: `docs/plugins.md | <n> ++++---`, `1 file changed`; the hook passes; the identity line is `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`; `show` lists only `docs/plugins.md`; `status` prints nothing. On a hook failure, report and stop. The plan itself is not committed here: the controller committed it before Task 1.

---

## Self-Review

**1. Spec coverage** (`docs/superpowers/specs/2026-11-06-heavy-command-gate-design.md`):

| Spec requirement                                                                                                                                                                                | Task                                                                                                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope: gate heavy commands of every agent Paseo launches                                                                                                                                        | Task 8 (`agent.open.before` on every provider's session), Task 10 Steps 11-13 (Claude) and Step 15a (Kiro, OpenCode)                                                                    |
| Scope: a status screen of what runs and what waits                                                                                                                                              | Task 9, Task 10 Steps 12-15                                                                                                                                                             |
| Out of scope: terminals, absolute paths, `node_modules/.bin`, no killing                                                                                                                        | No code; stated in the docs (Task 10 Step 21)                                                                                                                                           |
| Decision: PATH shims prepended by `agent.open.before`; `npm`, `npx`, `pnpm` classify their arguments                                                                                            | Task 7 (links), Task 8 (`withShimPath`), Task 2 (npm/npx/pnpm rules)                                                                                                                    |
| Decision: the plugin's server decides over a Unix socket                                                                                                                                        | Task 5 (`createGate`), Task 6 (`listenGateSocket`)                                                                                                                                      |
| Decision: a closed socket releases the slot                                                                                                                                                     | Task 5 (`leave`), Task 6, Task 7 integration test, Task 10 Step 13                                                                                                                      |
| Decision: fail open with one warning line                                                                                                                                                       | Task 7 (`fallOpen`), Task 10 Steps 4, 16, 17                                                                                                                                            |
| Decision: memory signal min(`MemAvailable`, `memory.max - memory.current`)                                                                                                                      | Task 3 (`readFreeMemory`)                                                                                                                                                               |
| Decision: nesting through `PASEO_HEAVY_GATE_HELD=1`                                                                                                                                             | Task 3 (`HELD_ENV`), Task 7 (nested test), Task 10 Step 10                                                                                                                              |
| Components: `shared/`, `server/`, `server/shim/gate.mjs`, `client/`                                                                                                                             | Tasks 1, 3-8, 7 (generated `gate.mjs`, Decision 1), 9                                                                                                                                   |
| Shim 1: real binary on `PATH` without the shim directory                                                                                                                                        | Task 7 (`findRealBinary`)                                                                                                                                                               |
| Shim 2: patterns with estimates; the spec's defaults                                                                                                                                            | Task 1 (`defaultPatterns`), Task 2 (`classifyCommand`)                                                                                                                                  |
| Shim 3: light or held, exec the real binary                                                                                                                                                     | Task 7 (`execReal` with `execve`)                                                                                                                                                       |
| Shim 4: hello with command, estimate, agent id, pid; the slot wait line every 30 s, or the memory wait line when the queue waits on memory                                                      | Task 3 (`ShimHello`), Task 5 (`NOTICE_MS`), Task 7 (`waitLine`), Task 10 Step 14 (memory line)                                                                                          |
| Shim 5: run with the flag, pass signals, hold the socket, exit with its code                                                                                                                    | Task 7 (`runChild`)                                                                                                                                                                     |
| Shim: fall open when the socket cannot be reached, when the gate sends no first answer within 10 s or closes the socket before `go`; the gate drops a connection that sends no hello within 5 s | Task 7 (`fallOpen`, `answerTimer`, `HELLO_TIMEOUT_MS` 10 s; tests cover only the unreachable socket), Task 6 (`HELLO_TIMEOUT_MS` 5 s, "drops a connection that sends no hello in time") |
| Admission: slots (default 1), free memory minus what running commands were promised but do not use yet, reserve (default 1 GB), FIFO                                                            | Task 4 (`decideAdmission`, the three "keeps back" tests), Task 1 (defaults)                                                                                                             |
| Admission: 5 min starvation guard, warning in stderr and on the screen                                                                                                                          | Task 4, Task 5 (`STARVATION_MS`, log), Task 7 (forced warning), Task 9 (`describeRunning`)                                                                                              |
| Admission: re-evaluate every 2 s and on every release                                                                                                                                           | Task 5 (`TICK_MS`, `leave`)                                                                                                                                                             |
| RPC `heavy-command-gate.status.request` with running (title, command, elapsed, tree RSS) and waiting (position, wait time, slot or memory)                                                      | Task 1 (`statusRpc`), Task 3 (`readTreeRss`), Task 5 (`snapshot`), Task 8 (`status`, `fetchAgentTitle`)                                                                                 |
| Screen polls every 5 s; settings: slots, reserve, patterns with estimates, on/off                                                                                                               | Task 9 (`POLL_MS`, Limits, switch), Task 1 (schema)                                                                                                                                     |
| Testing: classifier and admission unit tests                                                                                                                                                    | Task 2, Task 4                                                                                                                                                                          |
| Testing: integration with the real socket server and the shim in a temp directory                                                                                                               | Task 7 (`shim.posix.test.ts`)                                                                                                                                                           |
| Testing: manual, two agents run `npm run typecheck`, the second waits, the screen shows it                                                                                                      | Task 10 Steps 11-13                                                                                                                                                                     |

Kiro and OpenCode, which the spec names: Task 10 Step 15a runs one agent of each behind a held slot. The hook is provider-neutral. OpenCode gets the shim `PATH` through a dedicated `opencode serve` per agent, because any launch env key besides `PASEO_AGENT_ID` and `PASEO_AGENT_CWD` makes Paseo start one (`requiresDedicatedOpenCodeServer` in `packages/server/src/server/agent/providers/opencode-agent.ts`).

**2. Placeholder scan.** No "TBD", "TODO", "implement later", "similar to Task N" or step without its code. Angle-bracket values in Expected blocks (`<pid>`, `<X.X>`, `<d>`) stand for run-time values the step prints, not for missing content.

**3. Type consistency.**

- `GateSettings` (`enabled`, `slots`, `reserveGb`, `patterns: HeavyPattern[]`) and `HeavyPattern` (`command`, `estimateGb`) are used with the same names in Tasks 1, 7 (`toShimConfig`), 8 and 9 (`toDraft`, `parseDraft`).
- `RunningCommand` (`id`, `agentId`, `agentTitle`, `command`, `pid`, `elapsedMs`, `rssBytes`, `estimateBytes`, `forced`), `WaitingCommand` (`position`, `waitedMs`, `waitingOn: "slot" | "memory"`) and `GateStatus` (`state`, `error`, `slots`, `reserveBytes`, `freeBytes`, `running`, `waiting`) match across Task 1, Task 5 (`GateSnapshot`, with `agentTitle` null), Task 8 (`status`) and Task 9 (`format.ts` fixtures).
- `ShimConfig` (`version: 1`, `enabled`, `patterns: PatternRule[]` with `words` and `estimateBytes`) matches across Task 3, Task 7 (`toShimConfig`, `readConfig`) and Task 10 (`shim_config_summary`).
- `GatePaths` (`home`, `script`, `binDir`, `configPath`, `socketPath`) matches across Tasks 7 and 8; `InterpreterResult` (`ok`, `path` or `reason`) across Tasks 7 and 8.
- The messages match where they are asserted: `SLOTS_MESSAGE`, `RESERVE_MESSAGE`, `ESTIMATE_MESSAGE`, `COMMAND_MESSAGE`, `PATTERNS_MESSAGE` and the duplicate-command text (Tasks 1 and 9); `heavy-command gate: not reachable (<reason>), running <name> ungated` and the wait lines (Tasks 7 and 10); `heavy-command-gate: unavailable, agents get no shims: <reason>` (Tasks 8 and 10).
- Test counts: settings 24 and registry 1 (Task 1); classify 98 (Task 2); memory 10 and procfs 12 (Task 3); admission 13 (Task 4); gate 14 (Task 5); socket server 10 (Task 6); paths 7, install 12 and shim 12 (Task 7); plugin 11 and registry 1 (Task 8); format 6, settings form 9 and registry 1 (Task 9).
- Commit sizes: 6, 2, 5, 2, 2, 2, 6, 4, 8 and 1 files for Tasks 1 to 10.

---

## Critique log

Evidence used for each check:

1. Spec coverage: every line of `docs/superpowers/specs/2026-11-06-heavy-command-gate-design.md` against the Self-Review table and the tasks. All covered; Kiro and OpenCode were exercised by no step until the controller fixes below added Task 10 Step 15a.
2. API reality, on `main` at `1eaa71b2f`: `defineRpc` and its name pattern (`packages/plugin/src/rpc.ts:27-35`), `registerSettings` and the hook types (`packages/plugin/src/server/contracts.ts:42-67`, `server/lifecycle.ts:73-85` and `:174-189`), the launch env (`packages/server/src/server/agent/agent-manager.ts:5800-5850`), built-ins going through `launchPlugin`, which logs `Loaded plugin` with `methods` (`plugins/runtime.ts:348-366`, `:975-978`), `Failed to start built-in plugin` (`plugins/index.ts:235`), the settings path (`bootstrap.ts:686`, `plugins/settings/index.ts:94`, `:174`), `PaseoAgentHandle.refresh` (`packages/client/src/index.ts:380`), the root `--json` option (`packages/cli/src/cli.ts:170-180`), Claude's `bypassPermissions` mode, Lucide names looked up by export name (`packages/app/src/plugins/icons.ts:22-26`), shared-mcp's `procfs.ts` exports (`listProcessTree` gone) and pid records with `initStartTime` (`process-runner.ts:56-70`), and a `process.execve` probe on Node 22.23.3.
3. Placeholders: none. Angle-bracket values appear only in Expected blocks, for values a step prints.
4. Type consistency: the Produces and Consumes lists of Tasks 1 to 9 against each other and against the code they show. No mismatch.
5. Test design: every test traced to the code it runs; the counts 24, 98, 10 + 12, 13, 14, 10, 7 + 12 + 12, 11 and 6 + 9 hold. No `vi.mock`, `vi.spyOn` or `as` cast in the 34 TypeScript files the plan creates (grep over a copy in `/tmp`).
6. Repo rules: oxlint 1.61.0 with the repo's `.oxlintrc.json` over a copy of all 34 TypeScript files, with the Task 8 server entry (2 errors before the fixes below, 0 after); import lists and `.js` suffixes against the Global Constraints; the RPC name against the `defineRpc` pattern; UI strings against `docs/design.md` section 10 (info tooltips end with a period, as the app's `info:` strings in `packages/app/src/i18n/resources/en.ts` do; hints and labels do not).
7. Host safety: every vitest, typecheck, build and commit runs under `flock`; all ten commits use the tatsuya env and an explicit pathspec; no `LEFTHOOK=0`; port 6767 is only probed; the dev daemon recipe is shared-mcp's plus `-u PASEO_HEAVY_GATE_HELD` and `CLEAN_PATH`, with `mem_ok` at 2500 MB; no agent's model or effort changes; process lookups fixed below.
8. Cross-plan: `.superpowers/plan-drafts/2026-11-06-resource-manager.md` lines 13-25 (interfaces table), 67 (attribution order), 2335 and 2514 (`HEAVY_GATE_ENV`), 8509 (dist recovery) and 9014-9031 (docs edit).
9. Task size: each task has its own red and green cycle; the paths module stays in Task 7 with the installer that first needs it.

Defects found and fixed:

1. Repo rules: Task 2's `PNPM_COMMANDS` was an array read only through `.includes()`, which fails `unicorn/prefer-set-has` (the `perf` category is an error), so Step 5 could never print 0 errors. It is now a `Set` read with `.has()`, and Step 5 says why.
2. Repo rules: Task 3's `statLine` spread an array literal into an array literal, which fails `unicorn/no-useless-spread`. It is now one literal plus `fields.push(startTime, 1000, 200)`, with `startTime` still field 22.
3. Repo rules: Task 5 Step 5 and Task 7's lint step planned for `max-lines-per-function`, a rule `.oxlintrc.json` does not enable (the lint run reports nothing on `createGate` or `runShim`), and Task 7's told the implementer to add a disable comment. Both contingencies are removed.
4. Test design: Task 7 wrote `run-shim.ts` and `install.ts` before the integration test and expected that test to pass on its first run, so the shim's behaviour was never seen failing. The integration test is now Step 7 and fails in Step 8 on `Cannot find module './install.js'`, before the runtime (Step 9) and the installer (Step 10); the later steps and their cross-references are renumbered to 11-14.
5. Test design: the installer step said a "node can parse" failure that names an identifier means a copied body reaches outside itself, but `node --check` only parses. The note now lists what that test catches and sends undeclared names to the integration run (Step 12).
6. API reality: Decision 9 and the comment in `execReal` promised a child-process fallback when `execve` is refused. A failed `process.execve` call aborts Node instead of throwing (probe: `process.execve failed with error code ENOENT`, exit 134), so the `catch` sees only Node's argument checks. Decision 9 and the comment now say so and name the causes left after `findRealBinary`.
7. Host safety: Task 10 Step 3 recovered from a hang with `pgrep -af`, which prints the arguments of every matching process, and Claude processes carry bearer tokens in theirs. It now takes the pids from the run's temp `PASEO_HOME` in `/proc/<pid>/environ`.
8. Host safety: `gate_shims` ran `pgrep -f` over every process and Step 17 ran `pgrep -P ... -f`, the flag the host rules forbid. `gate_shims` now uses `grep -lzxE` over `/proc/[0-9]*/cmdline` with a pattern that cannot match grep's own argument, Step 17 checks the supervisor's children with `grep -qzF`, and the Global Constraints name the allowed lookups.
9. Contract wording: Decision 14, the `HELD_ENV` comment, the Task 10 notes and the Step 21 docs text said the shim never carries `PASEO_HEAVY_GATE_HELD`. A shim started inside a held command inherits it and execs the real binary in place. They now say that the shim that asked the gate does not carry it.

Open for the controller:

- Resource manager, variable: settled. Both plans use `PASEO_HEAVY_GATE_HELD` with the exact value `1`, so RM's `HEAVY_GATE_ENV` and `parseMarkers` stand. RM's table row (line 19) still says "the shim's own node process does not"; it should say "the shim that asked the gate does not". RM's attribution is unaffected, because a nested shim belongs to a held command.
- Resource manager, registry: no conflict. The gate inserts between `grok-usage-source` and `hoplite-provider`, RM between `opencode-go-usage-source` and `shared-mcp`.
- Resource manager, host safety: RM line 8509 has the same `pgrep -af 'builtin-plugins-dist.test.mjs'` recovery that item 7 removed here.
- Fall-open tests: the spec now states the 10 s first-answer timeout and the fall-open on a close before `go`, but no test runs either. Task 7's shim tests cover only an unreachable socket (`ENOENT`, `ECONNREFUSED`), and its installer test only checks that `gate.mjs` holds `helloTimeoutMs: 10000`. Add a shim test for each, or accept the gap.
- Task 10 Step 11, `PATH` heads: it exempts only `/tmp/heavy-gate-agent/node_modules/.bin`. Kiro's and OpenCode's user configs start `context7`, `gitlab` and `playwright` through `npx`, whose servers put the npx cache's `node_modules/.bin` first, so Step 15a exempts any head ending in `node_modules/.bin`. If Claude agents also start npx MCP servers, Step 11 shows heads its Expected does not list; widen it the same way.

### Controller fixes (2026-11-07)

1. Spec extensions: the user approved promised-memory accounting, the memory wait line and the 10 s and 5 s timeouts on 2026-11-07, and the spec's Shim and Admission sections now state them. Decisions 5 and 6, the Spec values constraint, Task 7's shim behaviour list and the Self-Review table say so in the spec's words, and the "Spec sign-off" open item is gone.
2. Expected failure texts: all 14 quotes of `Failed to resolve import "./x.js"` (13 `Expected: FAIL` lines in Tasks 1 to 9, and defect 4 above) now read `Cannot find module './x.js'`. They were one kind, a test importing a module that does not exist yet. A probe under `/tmp` with the repo's root config (`vitest run --root /workspace/utils/paseo --dir <probe dir>`) printed `Error: Cannot find module './probe-module.js' imported from <path>`, the text Vitest 4.1.7's module runner builds (`startVitestModuleRunner` in `node_modules/vitest/dist/chunks`). Vite raises `Failed to resolve import` only outside SSR, and every one of these tests runs in the node environment.
3. Manual test coverage: new Task 10 Step 15a runs one Kiro agent (`kiro-cli` 2.28.0) and then one OpenCode agent (`/usr/local/bin/opencode` 1.18.35, installed) behind a held slot. It is created and driven as the shared-mcp Task 9 run did with Kiro (`run --wait-timeout`, then `permit allow --all` on `permission`). It proves the shim `PATH` reached the agent with a `waiting` line under the agent's id, then a `held=1` start once the holder ends. Step 11 now runs `mem_ok` before each agent, and the Kiro and OpenCode spec-coverage open item is gone. The step is numbered 15a because the Resource Manager plan cites this plan's Task 10 Step 21.
4. Branch: the plan runs on the local branch `feat/heavy-command-gate`, cut from `main`. The Global Constraints say no step commits to, checks out or pushes `main`, and no step pushes at all. Each of the ten commit blocks starts with a branch check that stops before `git add` anywhere else (dry run on this `main` checkout: `STOP: not on feat/heavy-command-gate`, exit 1).
5. Controller ruling, procfs: the gate keeps its own `server/procfs.ts`, and the Resource Manager (sub-project 3) will not need a copy from the gate.
6. Controller ruling, `docs/plugins.md`: the gate lands first, so Task 10 Step 21 rewrites the "Local runs" lines as written, and the Resource Manager plan re-anchors later.
