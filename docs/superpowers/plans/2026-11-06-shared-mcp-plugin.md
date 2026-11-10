# Shared MCP Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run each shared MCP server once per instance over loopback HTTP, supervised by a built-in Paseo plugin, so agents stop spawning private stdio copies.

**Architecture:** A built-in plugin `plugins/shared-mcp/` runs inside the daemon process. A supervisor state machine starts each configured server in its own process group, probes it with an MCP `initialize` POST, restarts it with backoff, and exposes status and restart RPCs to two settings screens. One `agent.open.before` hook hands every agent the bearer token that guarded servers (mcp-gitlab) require.

**Tech Stack:** TypeScript (NodeNext, strict), zod, `@getpaseo/plugin` server and client SDK, React Native settings UI with `@tanstack/react-query`, Vitest, Node 22 `child_process` and `/proc`.

**Spec:** `docs/superpowers/specs/2026-11-06-shared-mcp-plugin-design.md`

## Global Constraints

- **Host memory.** The 16 GB host froze on 2026-11-06 from parallel heavy commands. Run every typecheck, vitest run, build, npm install and `git commit` (its lefthook pre-commit typechecks every workspace) under `flock /tmp/paseo-heavy.lock`. Typecheck with `tsgo --singleThreaded`. Never run a whole workspace test suite.
- **One test file per run:** `flock /tmp/paseo-heavy.lock npx vitest run <file> --bail=1`.
- **Pre-commit hook stays on.** Every commit runs the lefthook hook (format, lint, full typecheck) under the heavy lock. `LEFTHOOK=0` is not approved for this plan; if the hook fails in a workspace the task did not touch, stop and report it.
- **Untracked plan file.** `docs/superpowers/plans/2026-11-06-shared-mcp-plugin.md` is committed before Task 1; status gates that expect a clean tree assume that.
- **Daemon:** never restart or stop the Paseo daemon on port 6767. Manual tests use a dev daemon with its own `PASEO_HOME`.
- **Commits:** local only, never push (a push to main redeploys every instance through Dokploy). Author and committer `tatsuya <allrested@gmail.com>`, overriding the container's M-DAQ `GIT_*` env for that command only:
  `flock /tmp/paseo-heavy.lock env GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit --author='tatsuya <allrested@gmail.com>' -m "<message>"`
- **Built-in import rules:** server files import only `@getpaseo/plugin/*`, `zod` and `node:*`; client files only `@getpaseo/plugin`, `@getpaseo/plugin/client*`, `react`, `react-native`, `@tanstack/react-query`, `zod`; `shared/` only `@getpaseo/plugin` and `zod`. Relative imports carry a `.js` suffix everywhere (NodeNext).
- **In-process safety.** The plugin runs inside the daemon, and an uncaught exception or unhandled rejection exits the daemon. Every timer callback, child-process and stream `error` event, fetch, and fire-and-forget promise is guarded and reports into `lastError`.
- **Never kill what this daemon does not own.** Pid files record the owning daemon pid and the leader's start time; reclaim only when that owner is dead and the start time matches. `external` servers are never stopped.
- **No secrets in files, logs or chat.** Spawned servers get the daemon env minus `PASEO_*` and the parent-session keys. The bearer token lives only in `<home>/token` (mode 0600) and in process env.
- **Ports:** playwright 8931, context7 8932, gitlab 8933, serena 8000, graphify 8080, pia-mcp 8090, all on 127.0.0.1.
- **Health rule:** a probe is alive when any HTTP response arrives with status below 500 other than 404. A returned `mcp-session-id` is closed with `DELETE`, resending the probe's `Authorization` header.
- **Formatting and lint:** `npm run format:files -- <paths>` and `npm run lint -- <paths>` from the repo root.

---

### Task 1: Scaffold, settings schema, RPC contracts, registry entry

**Files:**

- Create: `plugins/shared-mcp/paseo-plugin.json`
- Create: `plugins/shared-mcp/index.server.ts`
- Create: `plugins/shared-mcp/shared/settings.ts`
- Create: `plugins/shared-mcp/shared/rpc.ts`
- Modify: `packages/server/src/server/plugins/builtin/index.ts` (the `builtinPlugins` array: add `"shared-mcp"` between `"opencode-go-usage-source"` and `"worktree-include"`)
- Test: `plugins/shared-mcp/shared/settings.test.ts` (new)
- Test: `packages/server/src/server/plugins/builtin/index.test.ts` (existing, unchanged; it reads every listed manifest and compiles every listed built-in)

**Interfaces:**

Consumes (read from source, not memory):

- `defineSettings<Schema extends ZodType>(definition: SettingsDefinition<Schema>): SettingsDefinition<Schema>` from `@getpaseo/plugin` (`packages/plugin/src/settings.ts:14`). `SettingsDefinition` is `{ id: string; scope: "host"; version: number; schema: Schema; migrate?: ... }`; the id must match `^[a-z][a-z0-9_-]*$`.
- `defineRpc<InputSchema extends ZodType, OutputSchema extends ZodType>(definition: { name: string; input: InputSchema; output: OutputSchema }): PluginRpcContract<InputSchema, OutputSchema>` from `@getpaseo/plugin` (`packages/plugin/src/rpc.ts:29`). Names must match `^[a-z][a-z0-9._-]*$`.
- `PluginServerContext.registerSettings<Schema extends ZodType>(definition: SettingsDefinition<Schema>): PluginSettings<Schema>` from `@getpaseo/plugin/server` (`packages/plugin/src/server/contracts.ts:43`). It registers `settings.servers.read`, `settings.servers.write` and `settings.servers.reset`.
- `z.RefinementCtx` from `zod` 4.4.3, used the same way as `packages/server/src/server/agent/tools/paseo-tools.ts:487`.

Produces:

- `plugins/shared-mcp/shared/settings.ts`
  - `export const ServerDefinitionSchema: z.ZodObject<...>` with fields `id`, `label`, `command`, `cwd?`, `env` (default `{}`), `port`, `healthPath` (default `"/mcp"`), `requires` (default `[]`), `bearerToken?: { serverEnv; agentEnv }`, `enabled` (default `true`). Only `id` carries a custom message; every other field keeps zod's default text.
  - `export type ServerDefinition = z.output<typeof ServerDefinitionSchema>`
  - `export const sharedMcpSettings = defineSettings({ id: "servers", scope: "host", version: 1, schema })`, where `schema` is `z.object({ servers: z.array(ServerDefinitionSchema).default([]) })` with a `superRefine` that rejects duplicate ids and duplicate ports
- `plugins/shared-mcp/shared/rpc.ts`
  - `export const ServerStateSchema = z.enum(["starting","healthy","unhealthy","backoff","failing","blocked","external","disabled"])`
  - `export const ServerStatusSchema` with fields `id, label, port, state, pid|null, startedAt|null, restarts, rssBytes|null, lastError|null, nextRetryAt|null, logTail: string[]`
  - `export type ServerStatus = z.output<typeof ServerStatusSchema>`
  - `export const statusRpc` named `"shared-mcp.status.request"`, input `{}`, output `{ servers: ServerStatus[] }`
  - `export const restartRpc` named `"shared-mcp.restart.request"`, input `{ id: string }`, output `{ ok: boolean; error: string | null }`
- `plugins/shared-mcp/index.server.ts`: `export default function contribute(server: PluginServerContext): () => void`. It only registers the settings. Supervisor wiring, `handle(statusRpc)`, `handle(restartRpc)` and the hook come in a later task.
- Built-in id `"shared-mcp"` in `builtinPlugins`.
- Obligation on the later Definitions screen task: render each issue from its local `sharedMcpSettings.schema.safeParse` as its `issue.path` joined with `.` plus `issue.message` (for example `servers.1.healthPath: Invalid string: must start with "/"`). The settings host drops paths, so that screen is the only place a field name reaches the user for fields other than `id`.

- [ ] **Step 1: Write the failing settings test**

Create `plugins/shared-mcp/shared/settings.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { ServerDefinitionSchema, sharedMcpSettings } from "./settings.js";

const SERVER_ID_MESSAGE =
  "Server id must start with a lowercase letter and use only lowercase letters, digits, and dashes";

const context7 = {
  id: "context7",
  label: "Context7",
  command: "npx -y @upstash/context7-mcp@4.0.4 --transport http --port 8932",
  port: 8932,
};

const gitlab = {
  id: "gitlab",
  label: "GitLab",
  command: "npx -y @zereight/mcp-gitlab@2.1.52",
  port: 8933,
};

interface Issue {
  path: PropertyKey[];
  message: string;
}

function settingsIssues(input: unknown): Issue[] {
  const result = sharedMcpSettings.schema.safeParse(input);
  if (result.success) return [];
  return result.error.issues.map((issue) => ({ path: issue.path, message: issue.message }));
}

describe("sharedMcpSettings", () => {
  it("defaults to no servers", () => {
    expect(sharedMcpSettings.schema.parse({})).toEqual({ servers: [] });
  });

  it("fills definition defaults and leaves unset optional fields out", () => {
    expect(ServerDefinitionSchema.parse(context7)).toStrictEqual({
      ...context7,
      env: {},
      healthPath: "/mcp",
      requires: [],
      enabled: true,
    });
  });

  it("accepts servers with distinct ids and ports", () => {
    expect(settingsIssues({ servers: [context7, gitlab] })).toEqual([]);
  });

  it("rejects a duplicate id", () => {
    expect(settingsIssues({ servers: [context7, { ...gitlab, id: "context7" }] })).toEqual([
      { path: ["servers", 1, "id"], message: 'Server id "context7" is used more than once' },
    ]);
  });

  it("rejects a duplicate port", () => {
    expect(settingsIssues({ servers: [context7, { ...gitlab, port: 8932 }] })).toEqual([
      {
        path: ["servers", 1, "port"],
        message: 'Port 8932 is used by both "context7" and "gitlab"',
      },
    ]);
  });

  it.each(["Context7", "7up", "has_underscore", "-dash", ""])("rejects the id %j", (id) => {
    expect(settingsIssues({ servers: [{ ...context7, id }] })).toEqual([
      { path: ["servers", 0, "id"], message: SERVER_ID_MESSAGE },
    ]);
  });
});
```

The `toStrictEqual` in the second test also checks that an absent `cwd` or `bearerToken` stays absent rather than becoming `undefined`. The client's `save()` runs `z.json()`, which rejects keys set to `undefined`.

- [ ] **Step 2: Run the settings test and confirm it fails**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/shared/settings.test.ts --bail=1
```

Expected: FAIL at import with `Failed to resolve import "./settings.js" from "plugins/shared-mcp/shared/settings.test.ts". Does the file exist?`. No tests run.

- [ ] **Step 3: Write the settings schema**

Create `plugins/shared-mcp/shared/settings.ts`:

```ts
import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// zod's default regex message prints the raw pattern. Other fields keep zod's text, which has no
// field name; the Definitions screen shows each issue's path next to its message.
const SERVER_ID_MESSAGE =
  "Server id must start with a lowercase letter and use only lowercase letters, digits, and dashes";

export const ServerDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, SERVER_ID_MESSAGE),
  label: z.string().min(1),
  // Run with `sh -c`.
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).default({}),
  port: z.number().int().min(1).max(65535),
  healthPath: z.string().startsWith("/").default("/mcp"),
  // Paths that must exist before the server starts.
  requires: z.array(z.string()).default([]),
  bearerToken: z.object({ serverEnv: z.string().min(1), agentEnv: z.string().min(1) }).optional(),
  enabled: z.boolean().default(true),
});

export type ServerDefinition = z.output<typeof ServerDefinitionSchema>;

const SettingsValuesSchema = z.object({
  servers: z.array(ServerDefinitionSchema).default([]),
});

type SettingsValues = z.output<typeof SettingsValuesSchema>;

function rejectDuplicates(values: SettingsValues, context: z.RefinementCtx): void {
  const ids = new Set<string>();
  const portOwners = new Map<number, string>();
  for (const [index, server] of values.servers.entries()) {
    if (ids.has(server.id)) {
      context.addIssue({
        code: "custom",
        path: ["servers", index, "id"],
        message: `Server id "${server.id}" is used more than once`,
      });
    }
    ids.add(server.id);
    const owner = portOwners.get(server.port);
    if (owner === undefined) {
      portOwners.set(server.port, server.id);
    } else {
      context.addIssue({
        code: "custom",
        path: ["servers", index, "port"],
        message: `Port ${server.port} is used by both "${owner}" and "${server.id}"`,
      });
    }
  }
}

export const sharedMcpSettings = defineSettings({
  id: "servers",
  scope: "host",
  version: 1,
  schema: SettingsValuesSchema.superRefine(rejectDuplicates),
});
```

Why only `id` has a custom message: the settings host joins issue messages without their paths (`packages/server/src/server/plugins/settings/index.ts:10` for `read()` and writes, `packages/app/src/plugins/settings/use-settings.ts:12` for `saveError`). A bad `label`, `port` or `healthPath` therefore reads as zod's default, such as `Too small: expected string to have >=1 characters` or `Invalid string: must start with "/"`, with no field named. Per-field messages would still leave the server index out and would not cover wrong JSON types (`"port": "8932"` gives `Invalid input: expected number, received string`), so the plan shows paths instead. The Definitions screen (later task) validates its draft with this same schema before saving and prints `issue.path` with each message. The enable switch re-saves already valid values with one boolean changed. So `saveError` never carries schema messages in practice, and path-less messages reach the user only from `read()` of a hand-edited `servers.json`.

- [ ] **Step 4: Run the settings test and confirm it passes**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/shared/settings.test.ts --bail=1
```

Expected: PASS, 1 file and 10 tests (5 `it` plus 5 `it.each` cases). The messages and paths were checked against zod 4.4.3 and the built `@getpaseo/plugin` `defineSettings` with a node script while drafting this plan.

- [ ] **Step 5: Write the RPC contracts**

Create `plugins/shared-mcp/shared/rpc.ts`. Nothing imports it until the wiring task, and it has no runtime behaviour beyond zod, so Step 12's typecheck is its only check.

```ts
import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const ServerStateSchema = z.enum([
  "starting",
  "healthy",
  "unhealthy",
  "backoff",
  "failing",
  "blocked",
  "external",
  "disabled",
]);

export const ServerStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  port: z.number(),
  state: ServerStateSchema,
  pid: z.number().nullable(),
  startedAt: z.string().nullable(),
  restarts: z.number(),
  rssBytes: z.number().nullable(),
  lastError: z.string().nullable(),
  nextRetryAt: z.string().nullable(),
  logTail: z.array(z.string()),
});

export type ServerStatus = z.output<typeof ServerStatusSchema>;

export const statusRpc = defineRpc({
  name: "shared-mcp.status.request",
  input: z.object({}),
  output: z.object({ servers: z.array(ServerStatusSchema) }),
});

export const restartRpc = defineRpc({
  name: "shared-mcp.restart.request",
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
});
```

- [ ] **Step 6: Add the built-in to the registry**

In `packages/server/src/server/plugins/builtin/index.ts`, change the `builtinPlugins` array so it reads:

```ts
export const builtinPlugins = [
  "antigravity-provider",
  "bddevlab-usage-source",
  "claude-usage-source",
  "codex-usage-source",
  "copilot-usage-source",
  "cursor-usage-source",
  "grok-usage-source",
  "hoplite-provider",
  "kimi-usage-source",
  "kiro-usage-source",
  "minimax-usage-source",
  "muse-provider",
  "opencode-go-usage-source",
  "shared-mcp",
  "worktree-include",
  "zai-usage-source",
] as const;
```

No type depends on the union of this array. Its users are `BuiltinPluginLoader`, `builtin/index.test.ts`, `scripts/builtin-plugins-dist.test.mjs` and `packages/desktop/e2e/packaged-app-smoke.js`, all of which only iterate it.

- [ ] **Step 7: Run the built-in compile test and confirm it fails**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: FAIL with `Error: Plugin manifest is missing: /workspace/utils/paseo/plugins/shared-mcp/paseo-plugin.json`, thrown from `readPluginManifest` (`packages/server/src/server/plugins/manifest.ts:44`).

- [ ] **Step 8: Write the manifest and the minimal server entry**

Create `plugins/shared-mcp/paseo-plugin.json`. It uses the one-line form of the other built-in manifests; `server.addHook` shipped in 0.15.0 and the fork reports 0.15.2.

```json
{ "id": "shared-mcp", "requirements": { "paseo": ">=0.15.0" } }
```

Create `plugins/shared-mcp/index.server.ts`:

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { sharedMcpSettings } from "./shared/settings.js";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(sharedMcpSettings);
  return () => {};
}
```

Built-ins start in every daemon whatever `pluginsEnabled` says, including `lifecycle.e2e.test.ts` and the packaged-app smoke. With this entry, startup only registers `settings.servers.*`, and an absent `$PASEO_HOME/plugin-settings/shared-mcp/servers.json` reads as `{ servers: [] }`, so it writes nothing and spawns nothing.

- [ ] **Step 9: Run the built-in registry test file and confirm it passes**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts --bail=1
```

Expected: PASS, 4 tests. "listed built-ins resolve to matching manifests and compile" now reads `plugins/shared-mcp/paseo-plugin.json` with id `shared-mcp` and compiles `index.server.ts` through `shared/settings.ts` with the esbuild boundary checks; `client` is `null` because no `index.client.tsx` exists yet. The other three fixture tests are unaffected.

- [ ] **Step 10: Format the new and changed files**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/shared-mcp/paseo-plugin.json plugins/shared-mcp/index.server.ts plugins/shared-mcp/shared/settings.ts plugins/shared-mcp/shared/settings.test.ts plugins/shared-mcp/shared/rpc.ts packages/server/src/server/plugins/builtin/index.ts
```

Expected: oxfmt exits 0. If it rewrote anything, `git -C /workspace/utils/paseo diff --stat` shows only whitespace or wrapping in those files. Re-run Step 4 if `settings.test.ts` or `settings.ts` changed.

- [ ] **Step 11: Lint the new and changed files**

```bash
cd /workspace/utils/paseo && npm run lint -- plugins/shared-mcp packages/server/src/server/plugins/builtin/index.ts
```

Expected: `Found 0 warnings and 0 errors.` The rules most likely to fire here are `no-shadow`, `typescript/consistent-type-definitions` (object type aliases fail, while `z.output<...>` aliases pass) and `max-nested-callbacks` 3. The test keeps `.map` inside the module-level `settingsIssues` helper to stay under that limit.

- [ ] **Step 12: Typecheck the plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: exit 0 with no diagnostics. This runs `tsgo -p tsconfig.json --noEmit --singleThreaded` in `plugins/` and covers `settings.ts`, `rpc.ts` and `index.server.ts`. Test files are excluded by `plugins/tsconfig.json`. The server package typecheck is not needed for Step 6, which adds one string literal with no type consumers.

- [ ] **Step 13: Commit with the fork identity (local only, never push)**

Stage these six paths explicitly, not with `-A`, and end the commit command with the same pathspec. Other sessions share this checkout: the pathspec commits only these files, and anything another session staged stays staged and out of this commit. The untracked plan file `docs/superpowers/plans/2026-11-06-shared-mcp-plugin.md` stays out too.

The lefthook pre-commit hook runs `format:check:files` and `lint` on the staged files, then a full `npm run typecheck` across every workspace (`packages/app` included, without `--singleThreaded`, about 3.7 GB). The commit therefore uses the header's form and holds `/tmp/paseo-heavy.lock` until the hook finishes, which can take several minutes. The `env` overrides apply to this command only.

```bash
git -C /workspace/utils/paseo add plugins/shared-mcp/paseo-plugin.json plugins/shared-mcp/index.server.ts plugins/shared-mcp/shared/settings.ts plugins/shared-mcp/shared/settings.test.ts plugins/shared-mcp/shared/rpc.ts packages/server/src/server/plugins/builtin/index.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): scaffold shared-mcp built-in plugin" -- plugins/shared-mcp/paseo-plugin.json plugins/shared-mcp/index.server.ts plugins/shared-mcp/shared/settings.ts plugins/shared-mcp/shared/settings.test.ts plugins/shared-mcp/shared/rpc.ts packages/server/src/server/plugins/builtin/index.ts
```

Expected: lefthook reports the `format`, `lint` and `typecheck` jobs as passing, then git prints `[main <sha>] feat(fork): scaffold shared-mcp built-in plugin` and `6 files changed`. If a hook job fails, git creates no commit. Report the hook output and stop: do not fix files outside this task, and do not bypass the hook.

Then check the commit and the tree:

```bash
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages
```

Expected: `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`. `show` prints the subject followed by exactly the six paths above. The `status` command prints nothing. It is scoped to `plugins/` and `packages/`, because the untracked plan file under `docs/superpowers/plans/` shows up in an unscoped `status` until someone commits it, and it is not this task's file.

Skipping the hook is the user's call, made once for the whole plan. Do not add `LEFTHOOK=0` on your own. Only if the plan header records that the user approved skipping the hook, run the same commit command with `LEFTHOOK=0` added to the `env` list (`flock /tmp/paseo-heavy.lock env LEFTHOOK=0 GIT_AUTHOR_NAME=...`), keeping the lock and the pathspec. The hook script exits 0 when `LEFTHOOK=0` (`.git/hooks/pre-commit:7-9`). The only check skipped is the full multi-workspace typecheck: Steps 10 to 12 already ran the hook's format and lint jobs on these files and the singleThreaded typecheck of the touched workspace.

### Task 2: Process-tree RSS reader

**Files:**

- Create: `plugins/shared-mcp/server/procfs.ts`
- Test: `plugins/shared-mcp/server/procfs.test.ts`
- Modify: `docs/superpowers/specs/2026-11-06-shared-mcp-plugin-design.md` (Components, Supervisor stop and RSS bullets only)

**Interfaces:**

- Consumes: nothing from other tasks. It uses Node built-ins only: `readdirSync` and `readFileSync` from `node:fs`, and `join` from `node:path`. The task does not depend on Task 1 and can run in any order.
- Produces (all in `plugins/shared-mcp/server/procfs.ts`):
  - `export interface ProcStat { ppid: number; pgrp: number; startTime: number }` (`startTime` is field 22 of `/proc/<pid>/stat`, in clock ticks since boot)
  - `export class ProcStatParseError extends Error { readonly stat: string }`
  - `export function parseStat(stat: string): ProcStat` (fields are counted after the LAST `)`. Throws `ProcStatParseError` when there is no `)` or when ppid, pgrp or starttime is not an integer.)
  - `export function parseVmRssBytes(status: string): number | null` (`"VmRSS:  1234 kB"` gives `1234 * 1024`. Returns null when there is no VmRSS line, as for kernel threads and zombies.)
  - `export async function listProcessTree(pgid: number, procRoot = "/proc"): Promise<number[]>` (every pid whose pgrp is `pgid`, plus all their descendants by ppid, in no fixed order. Returns `[]` when `procRoot` is missing. The `/proc` scan is synchronous and ends before the promise is returned, so the result is the tree as it was at the call, even when the caller signals the group before it awaits the promise. A scan of the 109 processes on this host blocks for about 1.3 ms.)
  - `export async function readProcessGroupRss(pgid: number, procRoot = "/proc"): Promise<number | null>` (sum of VmRSS bytes over `listProcessTree(pgid)`. Returns null when no process of the tree could be read, including when `procRoot` is missing, as on any OS without /proc. A tree whose readable members all lack VmRSS returns 0.)
  - Error behaviour of `listProcessTree` and `readProcessGroupRss`. A process that exits mid-scan (ENOENT or ESRCH) is passed over, and so is a missing `procRoot`. A `/proc/<pid>/stat` line that does not parse is skipped: without ppid and pgrp the entry cannot be placed in any tree, and one odd entry must not fail the scan for every server. Both functions reject only on any other filesystem error, such as EACCES. The supervisor's `readRss` dependency must still wrap the call and map a rejection to `rssBytes: null` plus `lastError`.
  - For Task 4 (process-runner): `stop()` and `killProcessGroup` must take the tree before the first signal. When a group member exits, its setsid'd children are reparented to init and the ppid link is gone. On this host, a scan started right after `process.kill(-pgid, "SIGTERM")` found the setsid'd child of a node group member in 0 of 10 runs, and a scan started before the signal found it in 10 of 10. Because `listProcessTree` finishes its scan before it returns, the runner keeps Task 6's "SIGTERM before the first `await`" and still gets the tree from before the signal: `const tree = listProcessTree(pgid); process.kill(-pgid, "SIGTERM"); for (const pid of await tree) ...`. Send SIGTERM to `-pgid` and to every listed pid, and after the grace period send SIGKILL to the same set, ignoring ESRCH. Await the promise in the same function, so a rejection never goes unhandled. `reclaimOrphan` reads the leader's start time with `parseStat(...).startTime` and, once it matches, stops the group the same way.

- [ ] **Step 1: Write the failing parser tests**

Create `plugins/shared-mcp/server/procfs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseStat, parseVmRssBytes, ProcStatParseError } from "./procfs.js";

// comm "x) R 1 700 (y": a parser that splits at the first ")" reads ppid 1 and pgrp 700.
const TRICKY_COMM_STAT =
  "4242 (x) R 1 700 (y) S 501 500 500 0 -1 4194304 2283 0 0 0 9 2 0 0 20 0 11 0 5339488 " +
  "1236512768 10960 18446744073709551615 1 1 0 0 0 0 0 16781312 17442 0 0 0 17 3 0 0 0 0 0 0 0 " +
  "0 0 0 0 0 0\n";

const KERNEL_THREAD_STAT =
  "37 (kworker/0:1-events) I 2 0 0 0 -1 69238880 0 0 0 0 0 4 0 0 20 0 1 0 312 0 0 " +
  "18446744073709551615 0 0 0 0 0 0 0 2147483647 0 0 0 0 17 0 0 0 0 0 0 0 0 0 0 0 0 0 0\n";

// VmHWM sits right before VmRSS in a real status file, so the parser must not take it.
const PROCESS_STATUS =
  "Name:\tnode\nUmask:\t0022\nState:\tS (sleeping)\nTgid:\t4242\nPid:\t4242\nPPid:\t1\n" +
  "VmPeak:\t 1236512 kB\nVmSize:\t 1207532 kB\nVmHWM:\t   61236 kB\nVmRSS:\t   43840 kB\n" +
  "RssAnon:\t   30212 kB\nThreads:\t11\n";

const KERNEL_THREAD_STATUS =
  "Name:\tkworker/0:1-events\nUmask:\t0000\nState:\tI (idle)\nTgid:\t37\nPid:\t37\nPPid:\t2\n" +
  "Kthread:\t1\nThreads:\t1\n";

describe("parseStat", () => {
  it("counts fields from the last parenthesis, so comm may hold spaces and parentheses", () => {
    expect(parseStat(TRICKY_COMM_STAT)).toEqual({ ppid: 501, pgrp: 500, startTime: 5339488 });
  });

  it("reads a kernel thread", () => {
    expect(parseStat(KERNEL_THREAD_STAT)).toEqual({ ppid: 2, pgrp: 0, startTime: 312 });
  });

  it("rejects a line without a comm field or cut short before starttime", () => {
    expect(() => parseStat("4242 truncated")).toThrow(ProcStatParseError);
    expect(() => parseStat("4242 (node) S 1 4242 4242 0 -1\n")).toThrow(ProcStatParseError);
  });
});

describe("parseVmRssBytes", () => {
  it("converts the VmRSS line from kB to bytes, ignoring VmHWM", () => {
    expect(parseVmRssBytes(PROCESS_STATUS)).toBe(43840 * 1024);
  });

  it("reads a zero VmRSS as zero bytes", () => {
    expect(parseVmRssBytes("Name:\tsleep\nVmRSS:\t       0 kB\nThreads:\t1\n")).toBe(0);
  });

  it("returns null for a kernel thread, which has no VmRSS line", () => {
    expect(parseVmRssBytes(KERNEL_THREAD_STATUS)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the parser tests and watch them fail**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/procfs.test.ts --bail=1`

Expected: FAIL, because the suite does not load: `Error: Cannot find module '.../plugins/shared-mcp/server/procfs.js' imported from .../plugins/shared-mcp/server/procfs.test.ts`. Vitest 4.1.7 catches Vite's load failure and rethrows it as ERR_MODULE_NOT_FOUND. The id inside the quotes may print as the relative `./procfs.js`, so match on the stable parts, `Cannot find module` and `procfs.js`. The summary shows `Test Files  1 failed`, and no test runs.

- [ ] **Step 3: Write the parsers**

Create `plugins/shared-mcp/server/procfs.ts`:

```ts
export interface ProcStat {
  ppid: number;
  pgrp: number;
  startTime: number;
}

export class ProcStatParseError extends Error {
  readonly stat: string;

  constructor(stat: string) {
    super(`Unrecognised /proc/<pid>/stat line: ${stat.slice(0, 120)}`);
    this.name = "ProcStatParseError";
    this.stat = stat;
  }
}

const VM_RSS_LINE = /^VmRSS:\s+(\d+) kB$/m;

// Field 2 (comm) is the raw process name and may hold spaces and parentheses, so fields are
// counted from the last ")". After ") " come 3 state, 4 ppid, 5 pgrp ... 22 starttime (ticks).
export function parseStat(stat: string): ProcStat {
  const commEnd = stat.lastIndexOf(")");
  const fields = stat.slice(commEnd + 2).split(" ");
  const ppid = Number(fields[1]);
  const pgrp = Number(fields[2]);
  const startTime = Number(fields[19]);
  if (commEnd < 0 || ![ppid, pgrp, startTime].every(Number.isSafeInteger)) {
    throw new ProcStatParseError(stat);
  }
  return { ppid, pgrp, startTime };
}

export function parseVmRssBytes(status: string): number | null {
  const match = VM_RSS_LINE.exec(status);
  return match ? Number(match[1]) * 1024 : null;
}
```

- [ ] **Step 4: Run the parser tests and watch them pass**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/procfs.test.ts --bail=1`

Expected: PASS, 6 tests (3 in `parseStat`, 3 in `parseVmRssBytes`).

- [ ] **Step 5: Write the failing process-tree tests**

In `plugins/shared-mcp/server/procfs.test.ts`, replace the two import lines at the top with:

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  listProcessTree,
  parseStat,
  parseVmRssBytes,
  ProcStatParseError,
  readProcessGroupRss,
} from "./procfs.js";
```

Then append this to the end of the file:

```ts
interface FakeProcess {
  pid: number;
  comm: string;
  ppid: number;
  pgrp: number;
  state: string;
  rssKb: number | null;
}

function statLine(fake: FakeProcess): string {
  return (
    `${fake.pid} (${fake.comm}) ${fake.state} ${fake.ppid} ${fake.pgrp} ${fake.pgrp} 0 -1 ` +
    `4194560 964 0 2 0 20 56 0 0 20 0 1 0 ${fake.pid * 10} 2273280 121 18446744073709551615 ` +
    "1 1 0 0 0 0 0 3145728 0 0 0 0 17 1 0 0 0 0 0 0 0 0 0 0 0 0 0\n"
  );
}

function statusText(fake: FakeProcess): string {
  const memory =
    fake.rssKb === null
      ? ""
      : `VmHWM:\t ${fake.rssKb * 2} kB\nVmRSS:\t ${fake.rssKb} kB\nRssAnon:\t ${fake.rssKb} kB\n`;
  return (
    `Name:\t${fake.comm}\nState:\t${fake.state}\nTgid:\t${fake.pid}\nPid:\t${fake.pid}\n` +
    `PPid:\t${fake.ppid}\n${memory}Threads:\t1\n`
  );
}

function writeProcess(procRoot: string, entry: string, fake: FakeProcess): void {
  mkdirSync(join(procRoot, entry), { recursive: true });
  writeFileSync(join(procRoot, entry, "stat"), statLine(fake));
  writeFileSync(join(procRoot, entry, "status"), statusText(fake));
}

function ascending(a: number, b: number): number {
  return a - b;
}

// Group 500 is the server: sh -> npm exec -> a child with a hostile comm, plus a zombie. 600 and
// 601 are a language server that called setsid, so they sit in their own group under 501.
const FAKE_PROCESSES: FakeProcess[] = [
  { pid: 1, comm: "tini", ppid: 0, pgrp: 1, state: "S", rssKb: 484 },
  { pid: 2, comm: "kthreadd", ppid: 0, pgrp: 0, state: "S", rssKb: null },
  { pid: 37, comm: "kworker/0:1-events", ppid: 2, pgrp: 0, state: "I", rssKb: null },
  { pid: 500, comm: "sh", ppid: 1, pgrp: 500, state: "S", rssKb: 1000 },
  { pid: 501, comm: "npm exec @upsta", ppid: 500, pgrp: 500, state: "S", rssKb: 50000 },
  { pid: 502, comm: "x) R 1 700 (y", ppid: 501, pgrp: 500, state: "S", rssKb: 2000 },
  { pid: 503, comm: "node", ppid: 500, pgrp: 500, state: "Z", rssKb: null },
  { pid: 600, comm: "uvx", ppid: 501, pgrp: 600, state: "S", rssKb: 40000 },
  { pid: 601, comm: "pyright-langse", ppid: 600, pgrp: 600, state: "S", rssKb: 4000 },
  { pid: 700, comm: "bash", ppid: 1, pgrp: 700, state: "S", rssKb: 3000 },
  { pid: 701, comm: "tail (logs)", ppid: 700, pgrp: 700, state: "S", rssKb: 900 },
  { pid: 900, comm: "sh", ppid: 1, pgrp: 900, state: "Z", rssKb: null },
];

describe("process tree over a fake /proc", () => {
  let procRoot: string;

  beforeEach(() => {
    procRoot = mkdtempSync(join(tmpdir(), "shared-mcp-proc-"));
    for (const fake of FAKE_PROCESSES) writeProcess(procRoot, String(fake.pid), fake);
    // Exited between readdir and the stat read.
    mkdirSync(join(procRoot, "504"));
    // Exited between the stat read and the status read.
    mkdirSync(join(procRoot, "505"));
    writeFileSync(
      join(procRoot, "505", "stat"),
      statLine({ pid: 505, comm: "node", ppid: 500, pgrp: 500, state: "S", rssKb: null }),
    );
    // A stat line cut short before pgrp: skipped, and it must not fail the scan of the others.
    mkdirSync(join(procRoot, "506"));
    writeFileSync(join(procRoot, "506", "stat"), "506 (node) S 500\n");
    // Non-numeric entries holding pid-like files must be skipped, or group 500 double-counts.
    const impostor: FakeProcess = {
      pid: 500,
      comm: "sh",
      ppid: 1,
      pgrp: 500,
      state: "S",
      rssKb: 99999,
    };
    writeProcess(procRoot, "self", impostor);
    writeProcess(procRoot, "1x", impostor);
    mkdirSync(join(procRoot, "sys"));
    writeFileSync(join(procRoot, "uptime"), "5339.48 21003.11\n");
  });

  afterEach(() => {
    rmSync(procRoot, { recursive: true, force: true });
  });

  it("lists the group's members and their descendants in other groups", async () => {
    expect((await listProcessTree(500, procRoot)).toSorted(ascending)).toEqual([
      500, 501, 502, 503, 505, 600, 601,
    ]);
    expect((await listProcessTree(700, procRoot)).toSorted(ascending)).toEqual([700, 701]);
  });

  it("scans before it returns, so a signal sent on the next line cannot hide a child", async () => {
    const pending = listProcessTree(500, procRoot);
    // What a SIGTERM to group 500 can do before a scan that yields gets there: 501 exits, and its
    // setsid'd child 600 is reparented to init.
    rmSync(join(procRoot, "501"), { recursive: true });
    writeProcess(procRoot, "600", {
      pid: 600,
      comm: "uvx",
      ppid: 1,
      pgrp: 600,
      state: "S",
      rssKb: 40000,
    });
    expect((await pending).toSorted(ascending)).toEqual([500, 501, 502, 503, 505, 600, 601]);
    // A scan that starts after the signal no longer reaches 600 and 601.
    expect((await listProcessTree(500, procRoot)).toSorted(ascending)).toEqual([
      500, 502, 503, 505,
    ]);
  });

  it("sums VmRSS over the tree; members without VmRSS or already gone add zero", async () => {
    expect(await readProcessGroupRss(500, procRoot)).toBe(
      (1000 + 50000 + 2000 + 40000 + 4000) * 1024,
    );
    expect(await readProcessGroupRss(700, procRoot)).toBe((3000 + 900) * 1024);
  });

  it("returns zero for a group whose only member is a zombie", async () => {
    expect(await readProcessGroupRss(900, procRoot)).toBe(0);
  });

  it("returns null for a group with no process", async () => {
    expect(await listProcessTree(800, procRoot)).toEqual([]);
    expect(await readProcessGroupRss(800, procRoot)).toBeNull();
  });

  it("returns null when the /proc root does not exist", async () => {
    const missing = join(procRoot, "missing");
    expect(await listProcessTree(500, missing)).toEqual([]);
    expect(await readProcessGroupRss(500, missing)).toBeNull();
  });
});

describe("process tree over the real /proc", () => {
  it.runIf(process.platform === "linux")("finds this process in its own group", async () => {
    const ownPgid = parseStat(await readFile("/proc/self/stat", "utf8")).pgrp;
    const pidMax = Number((await readFile("/proc/sys/kernel/pid_max", "utf8")).trim());

    expect(await listProcessTree(ownPgid)).toContain(process.pid);
    const rss = await readProcessGroupRss(ownPgid);
    expect(rss).toBeGreaterThan(0);
    expect((rss ?? Number.NaN) % 1024).toBe(0);
    // A pgid is a pid, and no pid exceeds pid_max.
    expect(await readProcessGroupRss(pidMax + 1)).toBeNull();
  });
});
```

- [ ] **Step 6: Run the tests and watch the tree tests fail**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/procfs.test.ts --bail=1`

Expected: FAIL. The 6 parser tests pass. The first fake-tree test fails with `TypeError: ... listProcessTree is not a function`: vitest inlines `procfs.ts`, so a missing named export reads as undefined. `--bail=1` stops the run there.

- [ ] **Step 7: Write the process-tree reader**

Replace the whole content of `plugins/shared-mcp/server/procfs.ts` with:

```ts
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface ProcStat {
  ppid: number;
  pgrp: number;
  startTime: number;
}

interface ProcEntry extends ProcStat {
  pid: number;
}

export class ProcStatParseError extends Error {
  readonly stat: string;

  constructor(stat: string) {
    super(`Unrecognised /proc/<pid>/stat line: ${stat.slice(0, 120)}`);
    this.name = "ProcStatParseError";
    this.stat = stat;
  }
}

const PID_ENTRY = /^\d+$/;
const VM_RSS_LINE = /^VmRSS:\s+(\d+) kB$/m;

// Field 2 (comm) is the raw process name and may hold spaces and parentheses, so fields are
// counted from the last ")". After ") " come 3 state, 4 ppid, 5 pgrp ... 22 starttime (ticks).
export function parseStat(stat: string): ProcStat {
  const commEnd = stat.lastIndexOf(")");
  const fields = stat.slice(commEnd + 2).split(" ");
  const ppid = Number(fields[1]);
  const pgrp = Number(fields[2]);
  const startTime = Number(fields[19]);
  if (commEnd < 0 || ![ppid, pgrp, startTime].every(Number.isSafeInteger)) {
    throw new ProcStatParseError(stat);
  }
  return { ppid, pgrp, startTime };
}

export function parseVmRssBytes(status: string): number | null {
  const match = VM_RSS_LINE.exec(status);
  return match ? Number(match[1]) * 1024 : null;
}

// ENOENT: the entry is gone, or /proc itself is missing (not Linux). ESRCH: the task exited
// after its /proc directory was looked up.
function isGone(error: unknown): boolean {
  return (
    error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ESRCH")
  );
}

function unlessGone<T>(read: () => T): T | null {
  try {
    return read();
  } catch (error) {
    if (isGone(error)) return null;
    throw error;
  }
}

// A stat line that does not parse gives no ppid or pgrp to place the entry by, so it is skipped
// instead of failing the scan for every other process.
function toProcEntry(name: string, stat: string): ProcEntry | null {
  try {
    return { pid: Number(name), ...parseStat(stat) };
  } catch (error) {
    if (error instanceof ProcStatParseError) return null;
    throw error;
  }
}

// Synchronous on purpose. When a process exits, its children are reparented to init, so a scan
// that yields while a stop signal is on its way loses the server's setsid'd children. /proc reads
// never wait on a disk: 109 processes took about 1.3 ms here, and one read at a time keeps a
// single file descriptor open.
function readProcTable(procRoot: string): ProcEntry[] {
  const table: ProcEntry[] = [];
  for (const name of unlessGone(() => readdirSync(procRoot)) ?? []) {
    if (!PID_ENTRY.test(name)) continue;
    const stat = unlessGone(() => readFileSync(join(procRoot, name, "stat"), "utf8"));
    const entry = stat === null ? null : toProcEntry(name, stat);
    if (entry !== null) table.push(entry);
  }
  return table;
}

// The group's members plus everything descended from them by ppid. Some servers start children
// in a session of their own (Serena does this with its language servers), and those still belong
// to the server. The scan ends before this returns its promise, so a caller can signal the group
// on the next line and still get the tree as it was before the signal.
export async function listProcessTree(pgid: number, procRoot = "/proc"): Promise<number[]> {
  const table = readProcTable(procRoot);
  const children = new Map<number, number[]>();
  for (const entry of table) {
    const siblings = children.get(entry.ppid);
    if (siblings) siblings.push(entry.pid);
    else children.set(entry.ppid, [entry.pid]);
  }
  const tree = new Set(table.filter((entry) => entry.pgrp === pgid).map((entry) => entry.pid));
  // A Set iterator also visits members added during the loop, so this walks the whole subtree.
  for (const pid of tree) {
    for (const child of children.get(pid) ?? []) tree.add(child);
  }
  return [...tree];
}

// null when no process of the tree could be read. A zombie or a kernel thread has no VmRSS line
// and adds 0.
export async function readProcessGroupRss(
  pgid: number,
  procRoot = "/proc",
): Promise<number | null> {
  let total: number | null = null;
  for (const pid of await listProcessTree(pgid, procRoot)) {
    const status = unlessGone(() => readFileSync(join(procRoot, String(pid), "status"), "utf8"));
    if (status !== null) total = (total ?? 0) + (parseVmRssBytes(status) ?? 0);
  }
  return total;
}
```

- [ ] **Step 8: Run the tests and watch them pass**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/procfs.test.ts --bail=1`

Expected: PASS on Linux, 13 tests: 6 parser tests, 6 fake-tree tests and 1 real-/proc test. On any other OS the real-/proc test is skipped. The suite targets four specific bugs:

- A parser that splits at the first `)` fails the tricky-comm parser test and the list, scan-before-return and sum tests, because pid 502 lands in group 700.
- A walk that stops at the process group (the original contract) fails the list, scan-before-return and sum tests, because 600 and 601 go missing.
- A reader that lets one unparseable stat line abort the scan fails five fake-tree tests, every one but the missing-root test, because entry 506 rejects every scan.
- A scan that awaits each read (`readdir` and `readFile` from `node:fs/promises`) fails only the scan-before-return test: by the time it reads them, 501 is gone and 600 has been reparented, so it returns `[500, 502, 503, 505]`.

- [ ] **Step 9: Update the spec's RSS and stop bullets**

Run: `git -C /workspace/utils/paseo status --short -- docs/superpowers/specs/2026-11-06-shared-mcp-plugin-design.md`

Expected: no output. The earlier spec edit landed in commit 252f099b0, and on 2026-11-06 the spec had no uncommitted change (the only untracked file was the plan under `docs/superpowers/plans/`). If it prints ` M`, the file holds someone else's uncommitted edit, and staging it in Step 11 would sweep that edit into this commit. Stop and ask before touching the file.

Then make three replacements in `docs/superpowers/specs/2026-11-06-shared-mcp-plugin-design.md`. Each line stays within 100 columns, and oxfmt keeps prose wrapping as written.

In the Components section, replace:

```md
- `index.server.ts` and `server/`: the supervisor, the health probe, process-group RSS, and log
  capture.
```

with:

```md
- `index.server.ts` and `server/`: the supervisor, the health probe, process-tree RSS, and log
  capture.
```

In the Supervisor section, replace:

```md
- A server spawns in its own process group so `npx` and `uvx` children die with it. Stopping sends
  SIGTERM to the group, then SIGKILL after 5 s. Disabling or removing the plugin stops every server
  it started; `external` servers are left alone.
```

with:

```md
- A server spawns in its own process group so `npx` and `uvx` children die with it. Some children
  leave the group: Serena starts each language server in a session of its own. Stopping lists the
  server's process tree before the first signal, sends SIGTERM to the group and to every listed
  process outside it, then SIGKILL to the same set after 5 s. Disabling or removing the plugin
  stops every server it started; `external` servers are left alone.
```

and replace:

```md
- RSS is the sum over the process group, read from `/proc`. The Resource Manager plugin reuses this
  reader.
```

with:

```md
- RSS is the sum over the server's process tree, read from `/proc`: every member of its process
  group plus their descendants by parent pid in other groups, such as Serena's language servers.
  The Resource Manager plugin reuses this reader.
```

Run: `git -C /workspace/utils/paseo diff --stat -- docs/superpowers/specs/2026-11-06-shared-mcp-plugin-design.md`

Expected: one file changed with 3 hunks, about 7 insertions and 5 deletions, and nothing outside the three bullets.

- [ ] **Step 10: Format, lint and typecheck**

Run:

```
cd /workspace/utils/paseo
npm run format:files -- plugins/shared-mcp/server/procfs.ts plugins/shared-mcp/server/procfs.test.ts docs/superpowers/specs/2026-11-06-shared-mcp-plugin-design.md
npm run format:check:files -- plugins/shared-mcp/server/procfs.ts plugins/shared-mcp/server/procfs.test.ts docs/superpowers/specs/2026-11-06-shared-mcp-plugin-design.md
npm run lint -- plugins/shared-mcp/server/procfs.ts plugins/shared-mcp/server/procfs.test.ts
flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected:

- `format:files` leaves all three files unchanged, and `format:check:files` passes.
- Lint prints `Found 0 warnings and 0 errors.`
- The typecheck (`tsgo -p tsconfig.json --noEmit --singleThreaded` in `plugins/`) exits 0. It checks `procfs.ts`; `plugins/tsconfig.json` excludes `procfs.test.ts`.

- [ ] **Step 11: Commit (local only, never push)**

Run:

```
git -C /workspace/utils/paseo add plugins/shared-mcp/server/procfs.ts plugins/shared-mcp/server/procfs.test.ts docs/superpowers/specs/2026-11-06-shared-mcp-plugin-design.md
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): shared-mcp process-tree RSS reader" -m "RSS and stop now cover descendants that left the server's process group." -- plugins/shared-mcp/server/procfs.ts plugins/shared-mcp/server/procfs.test.ts docs/superpowers/specs/2026-11-06-shared-mcp-plugin-design.md
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format= HEAD
```

Expected:

- The lefthook pre-commit runs under the heavy-command lock and passes. It runs format check and lint on the staged files, then a full `npm run typecheck` across every workspace, which can take several minutes. If that typecheck fails on files this task did not touch, do not commit around it: stop and report the failure.
- `log -1` prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.
- `show --name-only` lists exactly `docs/superpowers/specs/2026-11-06-shared-mcp-plugin-design.md`, `plugins/shared-mcp/server/procfs.test.ts` and `plugins/shared-mcp/server/procfs.ts`. The pathspec after `--` limits the commit to these three files, so anything another session staged in this shared checkout stays staged and out of this commit. The `git add` is still needed, because `git commit -- <path>` refuses a file git does not track yet.

Skip the hook only if the plan header records that the user approved it. In that case, run the same commit command with `LEFTHOOK=0` added to the `env` list; Step 10 already ran the targeted format, lint and typecheck.

### Task 3: MCP health probe

**Files:**

- Create: `plugins/shared-mcp/server/probe.ts`
- Test: `plugins/shared-mcp/server/probe.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks. `probe.ts` imports only `node:http`, and its timeout uses the Node 22 global `AbortSignal.timeout`.
- Order: no code here depends on Tasks 1 and 2, but Step 30 typechecks every file under `plugins/`, and the pre-commit hook in Step 31 runs a full `npm run typecheck` over the whole working tree, not only the staged files. Run the tasks one after another in this checkout. Start this task only when `git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages` prints nothing, which means Tasks 1 and 2 are either committed or not started. The check is scoped to `plugins/` and `packages/` because every npm workspace the typechecks cover lives there, and because the untracked plan file `docs/superpowers/plans/2026-11-06-shared-mcp-plugin.md` shows up in an unscoped `status` until someone commits it. That file is not this task's, and it does not touch any typecheck. Never run this task while another task's unfinished files sit in the same checkout.
- Produces (from `plugins/shared-mcp/server/probe.ts`):
  - `export interface ProbeTarget { port: number; healthPath: string; bearerToken?: string }`
  - `export type ProbeResult = { ok: true; status: number } | { ok: false; error: string };`
  - `export interface ProbeOptions { timeoutMs?: number }`. This is the contract's inline options type with a name and without `fetchImpl` (see the contract deviations).
  - `export async function probeMcp(target: ProbeTarget, options?: ProbeOptions): Promise<ProbeResult>`
  - Behaviour callers can rely on:
    - It never rejects.
    - It POSTs an MCP `initialize` to `http://127.0.0.1:<port><healthPath>` through `node:http`. The default timeout is 5000 ms. It does not use `fetch`: on this container's Node v22.23.3, undici's fetch refuses the Fetch spec's "bad ports" with `bad port` (6000 and 10080 among them, plus 1719, 4190, 5060, 5061, 6566, 6665-6669, 6679, 6697 and dozens of ports below 1024), while the settings schema accepts every port from 1 to 65535. `node:http` has no port blocklist, so every port the schema accepts can probe healthy.
    - The result is ok when the status is below 500 and is not 404.
    - When the response carries `mcp-session-id`, the probe awaits a DELETE with that header and the same `Authorization` header. The DELETE has its own `timeoutMs`, and nothing it does changes the result: any status, a dropped connection and a timeout are all ignored. A probe can therefore take up to 2 × `timeoutMs`, so the supervisor must await one probe before it starts the next.
    - Each request's socket is destroyed as soon as the response headers arrive. The body, an SSE stream for most servers, is never read.
    - The failure strings are `HTTP <status>`, `timed out after <ms> ms`, or the message of the error Node raised: `connect ECONNREFUSED 127.0.0.1:<port>` for a closed port, `socket hang up` when the server drops the connection before answering, or a request validation message such as `Request path contains unescaped characters` for a `healthPath` with a space in it. `bad port` cannot occur.

TDD runs as seven red/green slices, as `docs/testing.md` asks: one test, then the code that passes it. Slices 3 and 6 add cases that already pass next to the one that fails, and slice 7 is a guard that passes at once. Each of those cases pins a boundary that later changes must keep. Every red and green state below was replayed on this container's Node v22.23.3 with a stand-in for vitest that follows `--bail=1`. Each red run failed as stated, and each green run passed with no unhandled rejection and no socket left open. Vitest globals are off in the root config, so the test imports from `"vitest"`. The tests use real `node:http` servers on `127.0.0.1`.

- [ ] **Step 1: Write the first failing test.** Create `plugins/shared-mcp/server/probe.test.ts`. It covers the main path: an initialize that opens a session, and the DELETE that closes it.

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { probeMcp } from "./probe.js";

interface RecordedRequest {
  method: string | undefined;
  url: string | undefined;
  accept: string | undefined;
  contentType: string | undefined;
  authorization: string | undefined;
  sessionId: string | undefined;
  body: unknown;
}

interface TestServer {
  port: number;
  requests: RecordedRequest[];
}

type Respond = (request: RecordedRequest, res: ServerResponse) => void;

const SESSION_ID = "probe-session-1";

const INITIALIZE_BODY = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "paseo-shared-mcp-probe", version: "1.0.0" },
  },
};

const servers: Server[] = [];

function header(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name];
  return typeof value === "string" ? value : undefined;
}

async function recordRequest(req: IncomingMessage): Promise<RecordedRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  const text = Buffer.concat(chunks).toString("utf8");
  const body: unknown = text === "" ? null : JSON.parse(text);
  return {
    method: req.method,
    url: req.url,
    accept: header(req, "accept"),
    contentType: header(req, "content-type"),
    authorization: header(req, "authorization"),
    sessionId: header(req, "mcp-session-id"),
    body,
  };
}

async function listen(server: Server, port: number): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("expected a TCP address");
  return address.port;
}

async function closeServer(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve) => {
    server.close(() => resolve());
  });
}

async function startServer(respond: Respond, port = 0): Promise<TestServer> {
  const requests: RecordedRequest[] = [];
  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    let request: RecordedRequest;
    try {
      request = await recordRequest(req);
    } catch {
      // The probe gave up before its body arrived: record nothing.
      res.destroy();
      return;
    }
    requests.push(request);
    respond(request, res);
  }
  const server = createServer((req, res) => {
    void handle(req, res);
  });
  servers.push(server);
  return { port: await listen(server, port), requests };
}

function respondWith(status: number): Respond {
  return (_request, res) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end("{}");
  };
}

// Answers like a streamable-HTTP server: initialize opens a session and an SSE stream that
// stays open. The DELETE that closes the session gets answerDelete.
function withSession(answerDelete: Respond): Respond {
  return (request, res) => {
    if (request.method === "DELETE") {
      answerDelete(request, res);
      return;
    }
    res.writeHead(200, { "Content-Type": "text/event-stream", "mcp-session-id": SESSION_ID });
    res.write('event: message\ndata: {"jsonrpc":"2.0","id":1,"result":{}}\n\n');
  };
}

function initializeRequest(authorization?: string): RecordedRequest {
  return {
    method: "POST",
    url: "/mcp",
    accept: "application/json, text/event-stream",
    contentType: "application/json",
    authorization,
    sessionId: undefined,
    body: INITIALIZE_BODY,
  };
}

// node:http sends no Accept or Content-Type on a DELETE without a body.
function deleteRequest(authorization?: string): RecordedRequest {
  return {
    method: "DELETE",
    url: "/mcp",
    accept: undefined,
    contentType: undefined,
    authorization,
    sessionId: SESSION_ID,
    body: null,
  };
}

describe("probeMcp", () => {
  afterEach(async () => {
    const started = servers.splice(0);
    await Promise.all(started.map(closeServer));
  });

  it("deletes the session an initialize opened, without reading its stream", async () => {
    const server = await startServer(withSession(respondWith(200)));

    const result = await probeMcp({ port: server.port, healthPath: "/mcp" });

    expect(result).toEqual({ ok: true, status: 200 });
    expect(server.requests).toEqual([initializeRequest(), deleteRequest()]);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: FAIL before any test runs. Vitest's module runner reports a `Cannot find module` error that names `./probe.js` and says it was imported from `…/plugins/shared-mcp/server/probe.test.ts` (`Error: Cannot find module './probe.js' imported from '…/plugins/shared-mcp/server/probe.test.ts'`). The summary reads `Test Files  1 failed (1)` and `Tests  no tests`.

- [ ] **Step 3: Write the probe's main path.** Create `plugins/shared-mcp/server/probe.ts`:

```ts
import { request, type IncomingHttpHeaders, type OutgoingHttpHeaders } from "node:http";

export interface ProbeTarget {
  port: number;
  healthPath: string;
  bearerToken?: string;
}

export type ProbeResult = { ok: true; status: number } | { ok: false; error: string };

interface ProbeRequest {
  port: number;
  path: string;
}

interface ProbeCall {
  method: "POST" | "DELETE";
  headers: OutgoingHttpHeaders;
  body?: string;
}

interface ProbeAnswer {
  status: number;
  sessionId: string | undefined;
}

// initialize is the one request every MCP server must answer, so the probe needs no
// per-server knowledge. 2025-03-26 is the first protocol version with streamable HTTP; a
// server on a newer version negotiates instead of refusing it.
const INITIALIZE: ProbeCall = {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "paseo-shared-mcp-probe", version: "1.0.0" },
    },
  }),
};

export async function probeMcp(target: ProbeTarget): Promise<ProbeResult> {
  const probe: ProbeRequest = { port: target.port, path: target.healthPath };
  const answer = await send(probe, INITIALIZE);
  if (answer.sessionId) await closeSession(probe, answer.sessionId);
  return { ok: true, status: answer.status };
}

// node:http, not fetch: undici's fetch refuses the Fetch spec's "bad ports" (6000, 10080 and
// more) with "bad port", and a definition may use any port. Only the status and the session id
// matter, and an SSE answer can stay open, so the socket is destroyed once the headers arrive.
function send(probe: ProbeRequest, call: ProbeCall): Promise<ProbeAnswer> {
  return new Promise<ProbeAnswer>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: probe.port,
        path: probe.path,
        method: call.method,
        headers: call.headers,
      },
      (res) => {
        // Node always sets statusCode on a client response; the fallback only satisfies the type.
        resolve({ status: res.statusCode ?? 502, sessionId: sessionIdOf(res.headers) });
        req.destroy();
      },
    );
    req.on("error", reject);
    req.end(call.body);
  });
}

function sessionIdOf(headers: IncomingHttpHeaders): string | undefined {
  const value = headers["mcp-session-id"];
  return typeof value === "string" ? value : undefined;
}

// Serena's python mcp 1.x keeps an undeleted session until the server exits, so each probe
// closes the session it opened.
async function closeSession(probe: ProbeRequest, sessionId: string): Promise<void> {
  await send(probe, { method: "DELETE", headers: { "mcp-session-id": sessionId } });
}
```

- [ ] **Step 4: Run the test and confirm it passes.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: PASS with `Test Files  1 passed (1)` and `Tests  1 passed (1)`.

- [ ] **Step 5: Write the failing bearer-token test.** In `probe.test.ts`, add this case at the end of the `describe("probeMcp", ...)` block, after the last `it`:

```ts
it("sends the bearer token on the initialize and on the session DELETE", async () => {
  const server = await startServer(withSession(respondWith(200)));

  const result = await probeMcp({
    port: server.port,
    healthPath: "/mcp",
    bearerToken: "probe-token",
  });

  expect(result).toEqual({ ok: true, status: 200 });
  expect(server.requests).toEqual([
    initializeRequest("Bearer probe-token"),
    deleteRequest("Bearer probe-token"),
  ]);
});
```

- [ ] **Step 6: Run the test and confirm it fails.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: FAIL. `sends the bearer token on the initialize and on the session DELETE` fails at `expect(server.requests).toEqual(...)`. The diff shows the expected `authorization: "Bearer probe-token"` on both requests, and the probe sent neither. The summary reads `Test Files  1 failed (1)` and `Tests  1 failed | 1 passed (2)`.

- [ ] **Step 7: Send the bearer token.** Make three edits in `plugins/shared-mcp/server/probe.ts`.

First, add the `auth` field to `ProbeRequest`, so it reads:

```ts
interface ProbeRequest {
  port: number;
  path: string;
  auth: OutgoingHttpHeaders;
}
```

Second, replace the whole `probeMcp` function with the following, which also adds `authHeader` right below it:

```ts
export async function probeMcp(target: ProbeTarget): Promise<ProbeResult> {
  const probe: ProbeRequest = {
    port: target.port,
    path: target.healthPath,
    auth: authHeader(target.bearerToken),
  };
  const answer = await send(probe, INITIALIZE);
  if (answer.sessionId) await closeSession(probe, answer.sessionId);
  return { ok: true, status: answer.status };
}

// The initialize and the session DELETE both carry it: mcp-gitlab answers 401 to either
// without the bearer.
function authHeader(bearerToken: string | undefined): OutgoingHttpHeaders {
  if (!bearerToken) return {};
  return { Authorization: `Bearer ${bearerToken}` };
}
```

Third, in `send`, replace the line `headers: call.headers,` with:

```ts
        headers: { ...probe.auth, ...call.headers },
```

- [ ] **Step 8: Run the test and confirm it passes.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: PASS with `Test Files  1 passed (1)` and `Tests  2 passed (2)`.

- [ ] **Step 9: Write the failing status tests.** In `probe.test.ts`, add these cases at the end of the `describe` block. The 401 and 403 cases record that a server refusing the request is still alive, and the 404 and 500 cases that it is down. Every case asserts the single initialize and no DELETE.

```ts
it.each([401, 403])("counts HTTP %i as alive with no session to delete", async (status) => {
  const server = await startServer(respondWith(status));

  const result = await probeMcp({ port: server.port, healthPath: "/mcp" });

  expect(result).toEqual({ ok: true, status });
  expect(server.requests).toEqual([initializeRequest()]);
});

it.each([404, 500])("reports HTTP %i as down", async (status) => {
  const server = await startServer(respondWith(status));

  const result = await probeMcp({ port: server.port, healthPath: "/mcp" });

  expect(result).toEqual({ ok: false, error: `HTTP ${status}` });
  expect(server.requests).toEqual([initializeRequest()]);
});
```

- [ ] **Step 10: Run the test and confirm it fails.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: FAIL. `reports HTTP 404 as down` fails with `AssertionError: expected { ok: true, status: 404 } to deeply equal { ok: false, error: 'HTTP 404' }`. The 401 and 403 cases pass already, because every status still counts as alive. `--bail=1` skips the 500 case. The summary reads `Test Files  1 failed (1)` and `Tests  1 failed | 4 passed | 1 skipped (6)`.

- [ ] **Step 11: Count 404 and 5xx as down.** In `probe.ts`, replace the whole `probeMcp` function with:

```ts
export async function probeMcp(target: ProbeTarget): Promise<ProbeResult> {
  const probe: ProbeRequest = {
    port: target.port,
    path: target.healthPath,
    auth: authHeader(target.bearerToken),
  };
  const answer = await send(probe, INITIALIZE);
  if (answer.sessionId) await closeSession(probe, answer.sessionId);
  if (isAlive(answer.status)) return { ok: true, status: answer.status };
  return { ok: false, error: `HTTP ${answer.status}` };
}
```

Then add `isAlive` at the end of the file, after `closeSession`:

```ts
// Below 500 the server is listening: mcp-gitlab answers 401 without its bearer, playwright-mcp
// 403 to a Host it does not allow, the Python servers 406 or 421 to a request they reject, and
// a rate-limited server 429. A 404 means a wrong healthPath or another service on the port.
function isAlive(status: number): boolean {
  return status < 500 && status !== 404;
}
```

- [ ] **Step 12: Run the test and confirm it passes.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: PASS with `Test Files  1 passed (1)` and `Tests  6 passed (6)`.

- [ ] **Step 13: Write the failing refused-connection test.** In `probe.test.ts`, add `closedPort` right after the `startServer` function:

```ts
// Bound once to learn a free port number, then released, so nothing listens on it.
async function closedPort(): Promise<number> {
  const server = createServer();
  const port = await listen(server, 0);
  await closeServer(server);
  return port;
}
```

Then add this case at the end of the `describe` block:

```ts
it("reports a refused connection with the socket error", async () => {
  const port = await closedPort();

  const result = await probeMcp({ port, healthPath: "/mcp" });

  expect(result).toEqual({ ok: false, error: `connect ECONNREFUSED 127.0.0.1:${port}` });
});
```

- [ ] **Step 14: Run the test and confirm it fails.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: FAIL. `reports a refused connection with the socket error` fails with `Error: connect ECONNREFUSED 127.0.0.1:<port>`, because `probeMcp` rejects instead of returning a result. The summary reads `Test Files  1 failed (1)` and `Tests  1 failed | 6 passed (7)`.

- [ ] **Step 15: Return socket errors as results.** In `probe.ts`, replace the whole `probeMcp` function with the following, which adds a comment above it:

```ts
// The probe runs inside the daemon, where an unhandled rejection exits the process, so every
// failure comes back as { ok: false } instead of a throw.
export async function probeMcp(target: ProbeTarget): Promise<ProbeResult> {
  const probe: ProbeRequest = {
    port: target.port,
    path: target.healthPath,
    auth: authHeader(target.bearerToken),
  };
  let answer: ProbeAnswer;
  try {
    answer = await send(probe, INITIALIZE);
  } catch (error) {
    return { ok: false, error: describeError(error) };
  }
  if (answer.sessionId) await closeSession(probe, answer.sessionId);
  if (isAlive(answer.status)) return { ok: true, status: answer.status };
  return { ok: false, error: `HTTP ${answer.status}` };
}
```

Then add `describeError` at the end of the file, after `isAlive`:

```ts
function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 16: Run the test and confirm it passes.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: PASS with `Test Files  1 passed (1)` and `Tests  7 passed (7)`.

- [ ] **Step 17: Write the failing timeout test.** In `probe.test.ts`, add `neverAnswer` right before the `initializeRequest` function:

```ts
// Holds every request open, so only the probe's own timeout ends it.
function neverAnswer(): void {}
```

Then add this case at the end of the `describe` block:

```ts
it("gives up on a server that never answers once timeoutMs passes", async () => {
  const server = await startServer(neverAnswer);

  const result = await probeMcp({ port: server.port, healthPath: "/mcp" }, { timeoutMs: 500 });

  expect(result).toEqual({ ok: false, error: "timed out after 500 ms" });
  expect(server.requests).toEqual([initializeRequest()]);
});
```

- [ ] **Step 18: Run the test and confirm it fails.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: FAIL after about 5 s. `gives up on a server that never answers once timeoutMs passes` fails with `Error: Test timed out in 5000ms.`, because the probe has no timeout yet. The `afterEach` hook then closes the server, and the abandoned probe resolves to `{ ok: false, error: "socket hang up" }`, so no unhandled rejection follows. The summary reads `Test Files  1 failed (1)` and `Tests  1 failed | 7 passed (8)`.

- [ ] **Step 19: Add the timeout.** Make six edits in `probe.ts`.

First, add `ProbeOptions` right after the `ProbeResult` type:

```ts
export interface ProbeOptions {
  timeoutMs?: number;
}
```

Second, add the `timeoutMs` field to `ProbeRequest`, so it reads:

```ts
interface ProbeRequest {
  port: number;
  path: string;
  auth: OutgoingHttpHeaders;
  timeoutMs: number;
}
```

Third, add this constant, followed by a blank line, right above the `// initialize is the one request every MCP server must answer` comment:

```ts
const DEFAULT_TIMEOUT_MS = 5_000;
```

Fourth, replace the whole `probeMcp` function and the two comment lines above it with:

```ts
// The probe runs inside the daemon, where an unhandled rejection exits the process, so every
// failure comes back as { ok: false } instead of a throw.
export async function probeMcp(
  target: ProbeTarget,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const probe: ProbeRequest = {
    port: target.port,
    path: target.healthPath,
    auth: authHeader(target.bearerToken),
    timeoutMs,
  };
  let answer: ProbeAnswer;
  try {
    answer = await send(probe, INITIALIZE);
  } catch (error) {
    return { ok: false, error: describeError(error, timeoutMs) };
  }
  if (answer.sessionId) await closeSession(probe, answer.sessionId);
  if (isAlive(answer.status)) return { ok: true, status: answer.status };
  return { ok: false, error: `HTTP ${answer.status}` };
}
```

Fifth, in `send`, add this line right after `headers: { ...probe.auth, ...call.headers },`:

```ts
        signal: AbortSignal.timeout(probe.timeoutMs),
```

Sixth, replace the whole `describeError` function with:

```ts
function describeError(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) return String(error);
  // The request's only abort signal is its timeout.
  if (error.name === "AbortError") return `timed out after ${timeoutMs} ms`;
  return error.message;
}
```

- [ ] **Step 20: Run the test and confirm it passes.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: PASS with `Test Files  1 passed (1)` and `Tests  8 passed (8)`. The never-answers case takes about 500 ms.

- [ ] **Step 21: Write the failing best-effort DELETE tests.** In `probe.test.ts`, add `dropConnection` right before the `// Holds every request open` comment above `neverAnswer`:

```ts
// Closes the connection without an answer.
function dropConnection(_request: RecordedRequest, res: ServerResponse): void {
  res.destroy();
}
```

Then add these cases at the end of the `describe` block. Each server answers the initialize with 200 and a session, then answers the DELETE with 405, drops its connection, or never answers it. The result must stay `{ ok: true, status: 200 }`, and both requests must be recorded.

```ts
it("ignores a DELETE the server refuses with 405", async () => {
  const server = await startServer(withSession(respondWith(405)));

  const result = await probeMcp({ port: server.port, healthPath: "/mcp" });

  expect(result).toEqual({ ok: true, status: 200 });
  expect(server.requests).toEqual([initializeRequest(), deleteRequest()]);
});

it("ignores a DELETE whose connection drops", async () => {
  const server = await startServer(withSession(dropConnection));

  const result = await probeMcp({ port: server.port, healthPath: "/mcp" });

  expect(result).toEqual({ ok: true, status: 200 });
  expect(server.requests).toEqual([initializeRequest(), deleteRequest()]);
});

it("gives up on a DELETE that never answers once timeoutMs passes", async () => {
  const server = await startServer(withSession(neverAnswer));

  const result = await probeMcp({ port: server.port, healthPath: "/mcp" }, { timeoutMs: 500 });

  expect(result).toEqual({ ok: true, status: 200 });
  expect(server.requests).toEqual([initializeRequest(), deleteRequest()]);
});
```

- [ ] **Step 22: Run the test and confirm it fails.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: FAIL. `ignores a DELETE whose connection drops` fails with `Error: socket hang up`, because the DELETE's error escapes `probeMcp`. The 405 case passes already, because `send` resolves on any status. `--bail=1` skips the never-answering DELETE case. The summary reads `Test Files  1 failed (1)` and `Tests  1 failed | 9 passed | 1 skipped (11)`.

- [ ] **Step 23: Make the DELETE best effort.** In `probe.ts`, replace the whole `closeSession` function and the two comment lines above it with:

```ts
// Serena's python mcp 1.x keeps an undeleted session until the server exits, so each probe
// closes the session it opened. The DELETE is best effort: the initialize already proved the
// server alive, and a failed DELETE only leaves one session behind.
async function closeSession(probe: ProbeRequest, sessionId: string): Promise<void> {
  try {
    await send(probe, { method: "DELETE", headers: { "mcp-session-id": sessionId } });
  } catch {
    // A refused, dropped or timed-out DELETE changes nothing, like any status it answers with.
  }
}
```

- [ ] **Step 24: Run the test and confirm it passes.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: PASS with `Test Files  1 passed (1)` and `Tests  11 passed (11)`. The never-answering DELETE case takes about 500 ms and still returns ok.

- [ ] **Step 25: Write the fetch-blocked port guard.** In `probe.test.ts`, add this constant right before `const servers: Server[] = [];`:

```ts
// undici's fetch refuses this port, one of the Fetch spec's "bad ports", with "bad port".
const FETCH_BLOCKED_PORT = 10080;
```

Then add this case at the end of the `describe` block:

```ts
it("probes a port that fetch refuses as a bad port", async () => {
  const server = await startServer(withSession(respondWith(200)), FETCH_BLOCKED_PORT);

  const result = await probeMcp({ port: FETCH_BLOCKED_PORT, healthPath: "/mcp" });

  expect(result).toEqual({ ok: true, status: 200 });
  expect(server.requests).toEqual([initializeRequest(), deleteRequest()]);
});
```

The case binds port 10080 on `127.0.0.1`. Nothing listens there in this container (checked in `/proc/net/tcp` and `/proc/net/tcp6`). If another process holds the port, `listen` rejects with `EADDRINUSE` and the case fails with that message instead of hanging.

- [ ] **Step 26: Run the guard and confirm the whole file passes.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/probe.test.ts --bail=1`
Expected: PASS at once with `Test Files  1 passed (1)` and `Tests  12 passed (12)`. The guard passes without a code change because `node:http` has no port blocklist. A fetch-based probe returns `{ ok: false, error: "bad port" }` on this port (checked on Node v22.23.3), so the case fails if the probe is ever moved back to `fetch`. The two timeout cases take about 500 ms each, and the others well under 100 ms each.

After this step `plugins/shared-mcp/server/probe.ts` reads exactly:

```ts
import { request, type IncomingHttpHeaders, type OutgoingHttpHeaders } from "node:http";

export interface ProbeTarget {
  port: number;
  healthPath: string;
  bearerToken?: string;
}

export type ProbeResult = { ok: true; status: number } | { ok: false; error: string };

export interface ProbeOptions {
  timeoutMs?: number;
}

interface ProbeRequest {
  port: number;
  path: string;
  auth: OutgoingHttpHeaders;
  timeoutMs: number;
}

interface ProbeCall {
  method: "POST" | "DELETE";
  headers: OutgoingHttpHeaders;
  body?: string;
}

interface ProbeAnswer {
  status: number;
  sessionId: string | undefined;
}

const DEFAULT_TIMEOUT_MS = 5_000;

// initialize is the one request every MCP server must answer, so the probe needs no
// per-server knowledge. 2025-03-26 is the first protocol version with streamable HTTP; a
// server on a newer version negotiates instead of refusing it.
const INITIALIZE: ProbeCall = {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream" },
  body: JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2025-03-26",
      capabilities: {},
      clientInfo: { name: "paseo-shared-mcp-probe", version: "1.0.0" },
    },
  }),
};

// The probe runs inside the daemon, where an unhandled rejection exits the process, so every
// failure comes back as { ok: false } instead of a throw.
export async function probeMcp(
  target: ProbeTarget,
  options: ProbeOptions = {},
): Promise<ProbeResult> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS } = options;
  const probe: ProbeRequest = {
    port: target.port,
    path: target.healthPath,
    auth: authHeader(target.bearerToken),
    timeoutMs,
  };
  let answer: ProbeAnswer;
  try {
    answer = await send(probe, INITIALIZE);
  } catch (error) {
    return { ok: false, error: describeError(error, timeoutMs) };
  }
  if (answer.sessionId) await closeSession(probe, answer.sessionId);
  if (isAlive(answer.status)) return { ok: true, status: answer.status };
  return { ok: false, error: `HTTP ${answer.status}` };
}

// The initialize and the session DELETE both carry it: mcp-gitlab answers 401 to either
// without the bearer.
function authHeader(bearerToken: string | undefined): OutgoingHttpHeaders {
  if (!bearerToken) return {};
  return { Authorization: `Bearer ${bearerToken}` };
}

// node:http, not fetch: undici's fetch refuses the Fetch spec's "bad ports" (6000, 10080 and
// more) with "bad port", and a definition may use any port. Only the status and the session id
// matter, and an SSE answer can stay open, so the socket is destroyed once the headers arrive.
function send(probe: ProbeRequest, call: ProbeCall): Promise<ProbeAnswer> {
  return new Promise<ProbeAnswer>((resolve, reject) => {
    const req = request(
      {
        host: "127.0.0.1",
        port: probe.port,
        path: probe.path,
        method: call.method,
        headers: { ...probe.auth, ...call.headers },
        signal: AbortSignal.timeout(probe.timeoutMs),
      },
      (res) => {
        // Node always sets statusCode on a client response; the fallback only satisfies the type.
        resolve({ status: res.statusCode ?? 502, sessionId: sessionIdOf(res.headers) });
        req.destroy();
      },
    );
    req.on("error", reject);
    req.end(call.body);
  });
}

function sessionIdOf(headers: IncomingHttpHeaders): string | undefined {
  const value = headers["mcp-session-id"];
  return typeof value === "string" ? value : undefined;
}

// Serena's python mcp 1.x keeps an undeleted session until the server exits, so each probe
// closes the session it opened. The DELETE is best effort: the initialize already proved the
// server alive, and a failed DELETE only leaves one session behind.
async function closeSession(probe: ProbeRequest, sessionId: string): Promise<void> {
  try {
    await send(probe, { method: "DELETE", headers: { "mcp-session-id": sessionId } });
  } catch {
    // A refused, dropped or timed-out DELETE changes nothing, like any status it answers with.
  }
}

// Below 500 the server is listening: mcp-gitlab answers 401 without its bearer, playwright-mcp
// 403 to a Host it does not allow, the Python servers 406 or 421 to a request they reject, and
// a rate-limited server 429. A 404 means a wrong healthPath or another service on the port.
function isAlive(status: number): boolean {
  return status < 500 && status !== 404;
}

function describeError(error: unknown, timeoutMs: number): string {
  if (!(error instanceof Error)) return String(error);
  // The request's only abort signal is its timeout.
  if (error.name === "AbortError") return `timed out after ${timeoutMs} ms`;
  return error.message;
}
```

- [ ] **Step 27: Format the two files.**

Run: `cd /workspace/utils/paseo && npm run format:files -- plugins/shared-mcp/server/probe.ts plugins/shared-mcp/server/probe.test.ts`
Expected: exit 0. The code above keeps every line within 100 columns and uses double quotes, semicolons and trailing commas. If oxfmt changes a line anyway, rerun the Step 26 command before going on.

- [ ] **Step 28: Lint the two files.**

Run: `cd /workspace/utils/paseo && npm run lint -- plugins/shared-mcp/server/probe.ts plugins/shared-mcp/server/probe.test.ts`
Expected: `Found 0 warnings and 0 errors.` Callbacks nest at most two deep (`describe` > `it`, and the Promise executor > the response callback). The code has no `.then` chains, no async promise executor, no object type aliases (`ProbeResult` is a union and `Respond` a function type), no `any`, and no name that shadows the imported `request`.

- [ ] **Step 29: Confirm the working tree holds only this task's files.**

Run: `git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages`
Expected, exactly:

```
?? plugins/shared-mcp/server/probe.test.ts
?? plugins/shared-mcp/server/probe.ts
```

The pathspec limits the check to the two directories that hold every npm workspace, so the untracked plan file under `docs/superpowers/plans/` is not listed. If any other path is listed, stop. Another task's files are in the checkout, and Steps 30 and 31 would check them too. Finish and commit that task first, then come back to this step.

- [ ] **Step 30: Typecheck the plugins workspace.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded`
Expected: exit 0 with no diagnostics. `plugins/tsconfig.json` excludes `**/*.test.ts`, so only `probe.ts` is new to the checker. The `request` options type comes from `@types/node` 20.19.37, whose `ClientRequestArgs` declares `headers` and `signal`. `AbortSignal.timeout` resolves the same way as in the five usage-source plugins that already pass it to `fetch`.

- [ ] **Step 31: Commit with the fork identity (local only, never push).** Stage the two paths only, and end the commit command with the same pathspec. Other sessions share this checkout: the pathspec commits only these two files, and anything another session staged stays staged and out of this commit. The untracked plan file `docs/superpowers/plans/2026-11-06-shared-mcp-plugin.md` stays out too. The lefthook pre-commit hook runs format check and lint on the staged files and then a full `npm run typecheck`, so hold the heavy lock for the whole commit. The `env` overrides apply to this command only.

```bash
git -C /workspace/utils/paseo add plugins/shared-mcp/server/probe.ts plugins/shared-mcp/server/probe.test.ts
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): shared-mcp MCP health probe" -- plugins/shared-mcp/server/probe.ts plugins/shared-mcp/server/probe.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --name-only --format=%s HEAD
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages
```

Expected:

- The hook's format, lint and typecheck jobs pass. If a hook job fails, git creates no commit. Report the hook output and stop: do not fix files outside this task, and do not bypass the hook.
- The commit reports `2 files changed`.
- The `log` command prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.
- The `show` command prints the subject `feat(fork): shared-mcp MCP health probe` followed by exactly `plugins/shared-mcp/server/probe.test.ts` and `plugins/shared-mcp/server/probe.ts`.
- The `status` command prints nothing: neither probe file is listed any more. It is scoped to `plugins/` and `packages/` for the same reason as Step 29, so the untracked plan file is not listed.

### Task 4: Process runner: process groups, logs, pid files, orphan reclaim

**Files:**

- Create: `plugins/shared-mcp/server/process-runner.ts`
- Test: `plugins/shared-mcp/server/process-runner.test.ts`

**Interfaces:**

- Consumes: `parseStat(stat: string): ProcStat` and `interface ProcStat { ppid: number; pgrp: number; startTime: number }` from Task 2's `plugins/shared-mcp/server/procfs.ts` (`startTime` is field 22 of `/proc/<pid>/stat`; `parseStat` throws `ProcStatParseError` on a line it cannot read). Otherwise Node built-ins (`node:child_process`, `node:fs`, `node:fs/promises`, `node:path`, `node:readline`, `node:stream`, `node:timers/promises`) and `zod`. Task 2 asks this runner to list the tree with `listProcessTree(pgid)` before the first signal, but that function is async, and Task 6 needs `stop()` to send SIGTERM before its first `await`. Listing after the SIGTERM instead loses processes: `sh` dies at once on SIGTERM, and a setsid'd child it started moves to init before the scan reaches it. So the runner walks the same tree synchronously (`readdirSync` and `readFileSync` over `/proc`, each line read with `parseStat`). One scan took about 2 ms for the 110 processes in this container.
- Produces (exact exports of `plugins/shared-mcp/server/process-runner.ts`):

```ts
export class LogRing {
  constructor(limit = 200);
  push(line: string): void;
  lines(): string[];
}
export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}
export interface RunningProcess {
  pid: number;
  exited: Promise<ExitInfo>;
  stop(graceMs?: number): Promise<void>;
}
export interface SpawnSpec {
  command: string;
  cwd?: string;
  env: Record<string, string>;
  logFile: string;
  pidFile: string;
  onLine(line: string): void;
}
export function spawnServer(spec: SpawnSpec): RunningProcess;
export async function killProcessGroup(pgid: number, graceMs = 5000): Promise<void>;
export async function reclaimOrphan(pidFile: string): Promise<boolean>;
```

Behaviour later tasks rely on:

- `spawnServer` runs `/bin/sh -c <command>` detached (pgid == pid), creates `dirname(logFile)` and `dirname(pidFile)`, checks that `cwd` is a directory, and passes `{ ...process.env minus every PASEO_* key, ...spec.env }`. Besides the whole `PASEO_` prefix (`PASEO_PASSWORD` and `PASEO_HOME` included), it drops the runtime keys Paseo strips from every child (`ELECTRON_RUN_AS_NODE`, `ELECTRON_NO_ATTACH_CONSOLE`, `ESBUILD_BINARY_PATH`) and the parent-session keys (`CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_CODE_SSE_PORT`, `CLAUDE_AGENT_SDK_VERSION`). A key set in `spec.env` is passed even when it starts with `PASEO_`.
- `spawnServer` throws when the server cannot start, and the reason always reaches `onLine` as `spawn error: <message>`. For a failed mkdir, a missing or non-directory `cwd`, an error `spawn()` throws itself (a NUL byte in `env`, ENOTDIR) or a failed pid-file write, `onLine` gets the reason before the throw and the thrown message is `Could not start /bin/sh for: <command>: <message>`. ENOENT, EACCES, EAGAIN, EMFILE and ENFILE from the spawn itself arrive from Node on the next tick: the thrown message is then `Could not start /bin/sh for: <command> (the reason follows in the log tail)` and `onLine` receives the reason after the throw. The supervisor counts a throw from `deps.spawn` as a crash, copies the message into `lastError`, and keeps routing that server's `onLine` into its log ring after the throw.
- Every output line is cut to 4,000 characters plus `…` before it reaches `onLine` and the log file. readline still holds an unfinished line in memory until its newline arrives.
- Killing covers the server's process tree, as Task 2's spec edit describes. Before the first signal the runner lists every process outside the group that descends by parent pid from a group member, such as Serena's setsid'd pyright-langserver and terraform-ls. It sends SIGTERM to `-pgid` and to each listed pid, then SIGKILL to the same set at the deadline. A listed pid is signalled only while its start time still matches, so a reused pid is never hit. A process that left the group and whose parent exited before the stop is linked to nothing: it is not signalled, and if it holds the server's pipes, `exited` waits `STDIO_DRAIN_MS` (1 s) for it. `stop()`, the cleanup after a leader exits on its own, `killProcessGroup` and `reclaimOrphan` all use this one path.
- `exited` resolves only after the leader has exited, the rest of the tree is killed (SIGTERM, then SIGKILL after 5 s or earlier if a `stop()` asked for less), output is flushed to `onLine` and the log, the log is closed and the pid file is removed. It never rejects.
- `stop(graceMs)` lists the tree and sends SIGTERM before its first `await`, so `Promise.all(procs.map((proc) => proc.stop(800)))` signals every group at once. Calling it again while a stop is pending is safe. A shorter grace moves the SIGKILL to graceMs after that call, and it lands within one 50 ms poll of the new deadline. A longer grace changes nothing. Every call resolves with `exited`, which can take graceMs + 2 s (`KILL_WAIT_MS`, members still unreaped after SIGKILL) + 1 s (`STDIO_DRAIN_MS`, pipes held by a process the tree no longer reaches). The daemon waits only 2 s for an in-process plugin's cleanup (`SOFT_SHUTDOWN_TIMEOUT_MS` in `packages/server/src/server/plugins/runtime.ts`), so the supervisor's `stopAll` passes 800. Measured on this host with a group that ignores SIGTERM: when its setsid'd child is still linked to the group, `stop(800)` took 864 ms and `stop(1_500)` 1,561 ms. When the child's parent had exited first, so the child is unreachable and holds the pipes, `stop(800)` took 1,858 ms and `stop(1_500)` 2,565 ms, past the budget. If shutdown still cuts the cleanup off, the signals have already gone out and only the pid file stays behind; the next start's `reclaimOrphan` removes it because its owner is dead. Once `exited` has settled, `stop` signals nothing and resolves, because the group id may be reused.
- The pid file is one JSON line `{ pgid, startTime, ownerPid, ownerStartTime }`, where the start times are `parseStat(...).startTime`, field 22 of `/proc/<pid>/stat` (null without `/proc`). It is written to `<pidFile>.tmp` and renamed into place, so a crash mid-write never leaves a truncated pid file. A crash between write and rename can leave `<pidFile>.tmp` behind; the reclaim scan must match `*.pid` only.
- `reclaimOrphan` returns true only when it killed a group, and it kills the group's tree the same way `stop()` does, so the language servers of an orphaned Serena go with it. It removes the pid file whenever the writing daemon is gone (killed, stale or reused pid), and leaves file and group alone while that daemon is alive. A file that does not parse names no group: it removes the file and rejects with `Removed unreadable pid file <path>`. It also rejects on any other file error. The plugin catches every call and reports the message.
- `onLine` runs inside the daemon and must not throw.

- [ ] **Step 1: Write the failing test**

Create `plugins/shared-mcp/server/process-runner.test.ts`:

```ts
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseStat, type ProcStat } from "./procfs.js";
import {
  LogRing,
  reclaimOrphan,
  spawnServer,
  type RunningProcess,
  type SpawnSpec,
} from "./process-runner.js";

const onLinux = process.platform === "linux";
const isRoot = process.getuid?.() === 0;
// Odd durations mark this suite's processes, so a leak check can tell them from other sleeps.
const LONG_SLEEP = "sleep 30.123";
const SHORT_SLEEP = "sleep 0.123";

let dir: string;
let running: RunningProcess[];
let groups: number[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "shared-mcp-runner-"));
  running = [];
  groups = [];
});

afterEach(async () => {
  vi.unstubAllEnvs();
  for (const pgid of groups) signalQuietly(-pgid, "SIGKILL");
  await Promise.all(running.map((proc) => proc.stop(0)));
  rmSync(dir, { recursive: true, force: true });
});

function logFile(): string {
  return join(dir, "logs", "test.log");
}

function pidFile(): string {
  return join(dir, "run", "test.pid");
}

function spec(command: string, lines: string[], env: Record<string, string> = {}): SpawnSpec {
  return {
    command,
    env,
    logFile: logFile(),
    pidFile: pidFile(),
    onLine: (line) => lines.push(line),
  };
}

function start(command: string, lines: string[], env: Record<string, string> = {}): RunningProcess {
  const proc = spawnServer(spec(command, lines, env));
  running.push(proc);
  return proc;
}

// A detached group started outside spawnServer, standing in for one a previous daemon left behind.
function startGroup(command: string): ChildProcess {
  const child = spawn("/bin/sh", ["-c", command], { detached: true, stdio: "ignore" });
  groups.push(child.pid!);
  return child;
}

function writePidRecord(record: object): void {
  mkdirSync(dirname(pidFile()), { recursive: true });
  writeFileSync(pidFile(), JSON.stringify(record));
}

// A pid that just exited and was reaped stands in for a dead daemon or a stale server.
function deadPid(): number {
  return spawnSync("true").pid;
}

function statOf(pid: number): ProcStat | null {
  try {
    return parseStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}

function startTimeOf(pid: number): number {
  return statOf(pid)!.startTime;
}

// setsid moves a process into a group of its own, whose id is its pid.
async function waitForOwnGroup(pid: number): Promise<void> {
  await waitFor(() => statOf(pid)?.pgrp === pid);
}

function isAlive(pid: number): boolean {
  return signalQuietly(pid, 0);
}

function signalQuietly(target: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(target, signal);
    return true;
  } catch {
    return false;
  }
}

function backgroundPid(lines: string[]): number | null {
  const line = lines.find((entry) => entry.startsWith("bg="));
  return line === undefined ? null : Number(line.slice(3));
}

async function waitFor(check: () => boolean, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`condition not met within ${timeoutMs} ms`);
    await delay(20);
  }
}

describe("LogRing", () => {
  it("keeps the last 200 lines", () => {
    const ring = new LogRing();
    for (let index = 0; index < 250; index += 1) ring.push(`line ${index}`);

    const expected = Array.from({ length: 200 }, (_, offset) => `line ${offset + 50}`);
    expect(ring.lines()).toEqual(expected);
  });
});

describe.runIf(onLinux)("spawnServer", () => {
  it("sends stdout and stderr lines to onLine and appends them to the log file", async () => {
    mkdirSync(dirname(logFile()), { recursive: true });
    writeFileSync(logFile(), "earlier run\n");
    const lines: string[] = [];

    const proc = start("printf 'one\\ntwo\\n'; echo three >&2", lines);

    expect(await proc.exited).toEqual({ code: 0, signal: null });
    expect([...lines].sort()).toEqual(["one", "three", "two"]);
    const logged = readFileSync(logFile(), "utf8").split("\n");
    expect(logged[0]).toBe("earlier run");
    expect(logged.slice(1).sort()).toEqual(["", "one", "three", "two"]);
  }, 15_000);

  it("cuts an output line at 4,000 characters in onLine and the log file", async () => {
    const lines: string[] = [];

    const proc = start("head -c 5000 /dev/zero | tr '\\0' x; echo; echo after", lines);

    await proc.exited;
    const cut = `${"x".repeat(4_000)}…`;
    expect(lines).toEqual([cut, "after"]);
    expect(readFileSync(logFile(), "utf8")).toBe(`${cut}\nafter\n`);
  }, 15_000);

  it("drops PASEO_* and the parent-session variables from the server environment", async () => {
    vi.stubEnv("PASEO_PASSWORD", "not-a-real-password");
    vi.stubEnv("PASEO_HOME", dir);
    vi.stubEnv("PASEO_SUPERVISED", "1");
    vi.stubEnv("CLAUDECODE", "1");
    const lines: string[] = [];

    const proc = start(
      "echo \"paseo=$(env | grep -c '^PASEO_') claudecode=${CLAUDECODE:-unset} own=$OWN\"",
      lines,
      { OWN: "set" },
    );

    await proc.exited;
    expect(lines).toEqual(["paseo=0 claudecode=unset own=set"]);
  }, 15_000);

  it("renames the pid file into place and removes it after the server exits", async () => {
    const proc = start(LONG_SLEEP, []);

    expect(readdirSync(dirname(pidFile()))).toEqual(["test.pid"]);
    expect(JSON.parse(readFileSync(pidFile(), "utf8"))).toEqual({
      pgid: proc.pid,
      startTime: startTimeOf(proc.pid),
      ownerPid: process.pid,
      ownerStartTime: startTimeOf(process.pid),
    });
    await proc.stop();
    expect(existsSync(pidFile())).toBe(false);
  }, 15_000);

  it("stop() kills every process in the group", async () => {
    const lines: string[] = [];
    const proc = start(`${LONG_SLEEP} & echo "bg=$!"; ${LONG_SLEEP}`, lines);
    await waitFor(() => backgroundPid(lines) !== null);
    const background = backgroundPid(lines)!;

    await proc.stop();

    expect(await proc.exited).toEqual({ code: null, signal: "SIGTERM" });
    expect(isAlive(proc.pid)).toBe(false);
    expect(isAlive(background)).toBe(false);
  }, 15_000);

  it("stop() also kills a descendant that left the group with setsid", async () => {
    const lines: string[] = [];
    const proc = start(`setsid ${LONG_SLEEP} & echo "bg=$!"; ${LONG_SLEEP}`, lines);
    await waitFor(() => backgroundPid(lines) !== null);
    const escaped = backgroundPid(lines)!;
    // Its own group, so afterEach can kill it if stop() does not.
    groups.push(escaped);
    await waitForOwnGroup(escaped);

    await proc.stop();

    expect(await proc.exited).toEqual({ code: null, signal: "SIGTERM" });
    expect(isAlive(escaped)).toBe(false);
  }, 15_000);

  it("sends SIGKILL after the grace period to a group that traps SIGTERM", async () => {
    const lines: string[] = [];
    const proc = start(
      `trap 'echo got-term' TERM; echo ready; while :; do ${SHORT_SLEEP}; done`,
      lines,
    );
    await waitFor(() => lines.includes("ready"));
    const startedAt = Date.now();

    await proc.stop(1_000);

    expect(Date.now() - startedAt).toBeGreaterThanOrEqual(1_000);
    expect(lines).toContain("got-term");
    expect(await proc.exited).toEqual({ code: null, signal: "SIGKILL" });
    expect(isAlive(proc.pid)).toBe(false);
  }, 15_000);

  it("brings the SIGKILL forward when a later stop() passes a shorter grace", async () => {
    const lines: string[] = [];
    const proc = start(
      `trap 'echo got-term' TERM; echo ready; while :; do ${SHORT_SLEEP}; done`,
      lines,
    );
    await waitFor(() => lines.includes("ready"));
    const startedAt = Date.now();

    const slow = proc.stop(5_000);
    const fast = proc.stop(300);
    await Promise.all([slow, fast]);

    const elapsed = Date.now() - startedAt;
    expect(elapsed).toBeGreaterThanOrEqual(300);
    expect(elapsed).toBeLessThan(2_000);
    expect(lines).toContain("got-term");
    expect(await proc.exited).toEqual({ code: null, signal: "SIGKILL" });
    // Once exited has settled, stop() signals nothing and resolves.
    await expect(proc.stop()).resolves.toBeUndefined();
  }, 15_000);

  it("kills what the leader left running when it exits on its own", async () => {
    const lines: string[] = [];
    const proc = start(`${LONG_SLEEP} & echo "bg=$!"; exit 3`, lines);

    expect(await proc.exited).toEqual({ code: 3, signal: null });
    expect(isAlive(backgroundPid(lines)!)).toBe(false);
    expect(existsSync(pidFile())).toBe(false);
  }, 15_000);

  it("throws on a missing cwd and passes the same reason to onLine first", () => {
    const lines: string[] = [];
    const cwd = join(dir, "missing");
    const reason = `ENOENT: no such file or directory, stat '${cwd}'`;

    expect(() => spawnServer({ ...spec(LONG_SLEEP, lines), cwd })).toThrow(
      `Could not start /bin/sh for: ${LONG_SLEEP}: ${reason}`,
    );
    expect(lines).toEqual([`spawn error: ${reason}`]);
    expect(existsSync(pidFile())).toBe(false);
  });

  it("throws when the cwd is a file", () => {
    const lines: string[] = [];
    const cwd = join(dir, "a-file");
    writeFileSync(cwd, "");

    expect(() => spawnServer({ ...spec(LONG_SLEEP, lines), cwd })).toThrow(
      `Could not start /bin/sh for: ${LONG_SLEEP}: cwd is not a directory: ${cwd}`,
    );
    expect(lines).toEqual([`spawn error: cwd is not a directory: ${cwd}`]);
  });

  it("passes an error spawn() throws itself to onLine and the thrown message", () => {
    const lines: string[] = [];
    const reason =
      "The property 'options.env['BAD']' must be a string without null bytes. Received 'a\\x00b'";

    expect(() => spawnServer(spec(LONG_SLEEP, lines, { BAD: "a\0b" }))).toThrow(
      `Could not start /bin/sh for: ${LONG_SLEEP}: ${reason}`,
    );
    expect(lines).toEqual([`spawn error: ${reason}`]);
    expect(existsSync(pidFile())).toBe(false);
  });

  // Root ignores directory permissions, so the shell would start there.
  it.runIf(!isRoot)("passes an error Node reports on the next tick to onLine", async () => {
    const lines: string[] = [];
    const cwd = join(dir, "locked");
    mkdirSync(cwd, { mode: 0o000 });

    expect(() => spawnServer({ ...spec(LONG_SLEEP, lines), cwd })).toThrow(
      `Could not start /bin/sh for: ${LONG_SLEEP} (the reason follows in the log tail)`,
    );
    expect(lines).toEqual([]);
    await waitFor(() => lines.length > 0);
    expect(lines).toEqual(["spawn error: spawn /bin/sh EACCES"]);
    expect(existsSync(pidFile())).toBe(false);
  });
});

describe.runIf(onLinux)("reclaimOrphan", () => {
  it("kills a group whose daemon died and removes the pid file", async () => {
    const leader = startGroup(`${LONG_SLEEP} & ${LONG_SLEEP}`);
    writePidRecord({
      pgid: leader.pid,
      startTime: startTimeOf(leader.pid!),
      ownerPid: deadPid(),
      ownerStartTime: null,
    });

    expect(await reclaimOrphan(pidFile())).toBe(true);
    expect(isAlive(-leader.pid!)).toBe(false);
    expect(existsSync(pidFile())).toBe(false);
  }, 15_000);

  it("also kills the descendants that left the orphaned group with setsid", async () => {
    const bgFile = join(dir, "bg");
    const leader = startGroup(`setsid ${LONG_SLEEP} & echo $! > ${bgFile}; ${LONG_SLEEP}`);
    await waitFor(() => existsSync(bgFile) && readFileSync(bgFile, "utf8").endsWith("\n"));
    const escaped = Number(readFileSync(bgFile, "utf8"));
    groups.push(escaped);
    await waitForOwnGroup(escaped);
    writePidRecord({
      pgid: leader.pid,
      startTime: startTimeOf(leader.pid!),
      ownerPid: deadPid(),
      ownerStartTime: null,
    });

    expect(await reclaimOrphan(pidFile())).toBe(true);
    expect(isAlive(-leader.pid!)).toBe(false);
    expect(isAlive(escaped)).toBe(false);
  }, 15_000);

  it("kills a group whose leader already exited", async () => {
    const leader = startGroup(`${LONG_SLEEP} & exit 0`);
    const startTime = startTimeOf(leader.pid!);
    await once(leader, "exit");
    expect(isAlive(-leader.pid!)).toBe(true);
    writePidRecord({ pgid: leader.pid, startTime, ownerPid: deadPid(), ownerStartTime: null });

    expect(await reclaimOrphan(pidFile())).toBe(true);
    expect(isAlive(-leader.pid!)).toBe(false);
  }, 15_000);

  it("leaves a group alone while the daemon that started it is alive", async () => {
    const leader = startGroup(LONG_SLEEP);
    writePidRecord({
      pgid: leader.pid,
      startTime: startTimeOf(leader.pid!),
      ownerPid: process.ppid,
      ownerStartTime: startTimeOf(process.ppid),
    });

    expect(await reclaimOrphan(pidFile())).toBe(false);
    expect(isAlive(-leader.pid!)).toBe(true);
    expect(existsSync(pidFile())).toBe(true);
  }, 15_000);

  it("returns false for a stale pid and removes its file", async () => {
    writePidRecord({ pgid: deadPid(), startTime: 1, ownerPid: deadPid(), ownerStartTime: null });

    expect(await reclaimOrphan(pidFile())).toBe(false);
    expect(existsSync(pidFile())).toBe(false);
  });

  it("does not kill a process that reused the recorded pid", async () => {
    const leader = startGroup(LONG_SLEEP);
    writePidRecord({
      pgid: leader.pid,
      startTime: startTimeOf(leader.pid!) - 1,
      ownerPid: deadPid(),
      ownerStartTime: null,
    });

    expect(await reclaimOrphan(pidFile())).toBe(false);
    expect(isAlive(-leader.pid!)).toBe(true);
    expect(existsSync(pidFile())).toBe(false);
  }, 15_000);

  it("removes a pid file it cannot parse and rejects with its path", async () => {
    mkdirSync(dirname(pidFile()), { recursive: true });
    writeFileSync(pidFile(), '{"pgid":12');

    await expect(reclaimOrphan(pidFile())).rejects.toThrow(
      `Removed unreadable pid file ${pidFile()}`,
    );
    expect(existsSync(pidFile())).toBe(false);
  });

  it("returns false when there is no pid file", async () => {
    expect(await reclaimOrphan(join(dir, "run", "missing.pid"))).toBe(false);
  });
});
```

Notes: vitest globals are off in the root config, so the file imports from `"vitest"`. Tests that need `/proc` and `kill(-pgid)` are gated with `describe.runIf(onLinux)`. The EACCES test also skips as root, because root ignores directory permissions and the shell would start. Each process test sets a 15 s timeout because the root config keeps the 5 s default. `afterEach` SIGKILLs every raw group and stops every runner process before removing the temp dir; `rmSync` removes the empty mode-000 directory without a chmod. The reclaim tests write pid records by hand so they pin the file format. `sleep 30.123` and `sleep 0.123` mark this suite's processes for the leak check in Step 4. The two setsid tests use util-linux `setsid`, which Linux CI images and this container (`/usr/bin/setsid`) ship. Each waits until the background process sits in a group of its own before it stops anything, so it exercises the tree walk and not the group signal, and it adds that pid to `groups` so `afterEach` kills it if the runner did not. The environment test prints only a count of `PASEO_` keys, never a value. The test file imports `parseStat` from Task 2's `procfs.js` to read pgrp and start times. The exact Node error texts (`spawn /bin/sh EACCES`, the NUL-byte message, the `stat` ENOENT message) were checked on Node 22.23.3, the major version fork CI uses.

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/process-runner.test.ts --bail=1`

Expected: FAIL. The suite cannot load `./process-runner.js` because the module does not exist yet (vitest reports `Cannot find module ... process-runner.js` or `Failed to load url ./process-runner.js`), and no test runs. If the message names `procfs.js` instead, Task 2 has not landed: stop and finish Task 2 first.

- [ ] **Step 3: Write the implementation**

Create `plugins/shared-mcp/server/process-runner.ts`:

```ts
import { spawn, type ChildProcessByStdio } from "node:child_process";
import {
  createWriteStream,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  type WriteStream,
} from "node:fs";
import { readFile, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { parseStat, type ProcStat } from "./procfs.js";

const DEFAULT_GRACE_MS = 5_000;
// SIGKILL cannot be caught; this only bounds the wait for members nobody has reaped yet.
const KILL_WAIT_MS = 2_000;
const POLL_MS = 50;
// A process that left the group after its parent exited is no longer linked to the tree, so it is
// never signalled, and it can hold the pipes open after the group is gone.
const STDIO_DRAIN_MS = 1_000;
const LOG_RING_LIMIT = 200;
// Bounds what one line costs in the ring, the log file and the status payload. readline itself
// still holds an unfinished line in memory until its newline arrives.
const MAX_LINE_CHARS = 4_000;
const PID_ENTRY = /^\d+$/;

// Paseo's own variables, PASEO_PASSWORD and PASEO_HOME among them, never reach a server: most are
// third-party npx and uvx packages. The keys below are the rest of what Paseo removes from every
// process it launches (packages/server/src/server/paseo-env.ts and PARENT_SESSION_ENV_VARS in
// agent/provider-launch-config.ts). Plugins cannot import server code.
const STRIPPED_ENV_PREFIX = "PASEO_";
const STRIPPED_ENV_KEYS = new Set([
  "ELECTRON_RUN_AS_NODE",
  "ELECTRON_NO_ATTACH_CONSOLE",
  "ESBUILD_BINARY_PATH",
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_AGENT_SDK_VERSION",
]);

// startTime is field 22 of /proc/<pid>/stat. With ownerPid it tells a pid file left by a dead
// daemon apart from one a live daemon (or a test pointed at the same home) still owns, and a group
// apart from a later process that reuses its pid. Both are null where /proc does not exist.
const PidRecordSchema = z.object({
  pgid: z.number().int().positive(),
  startTime: z.number().int().nullable(),
  ownerPid: z.number().int().positive(),
  ownerStartTime: z.number().int().nullable(),
});
type PidRecord = z.output<typeof PidRecordSchema>;

type ServerChild = ChildProcessByStdio<null, Readable, Readable>;

interface ProcEntry extends ProcStat {
  pid: number;
}

// One kill of a server's process tree. The SIGKILL deadline can only move earlier.
interface Termination {
  /** Resolves once the group and every listed process outside it are gone. Never rejects. */
  done: Promise<void>;
  /** Moves the SIGKILL to graceMs from now when that is earlier than the current deadline. */
  hurry(graceMs: number): void;
}

export class LogRing {
  private readonly entries: string[] = [];

  constructor(private readonly limit = LOG_RING_LIMIT) {}

  push(line: string): void {
    this.entries.push(line);
    if (this.entries.length > this.limit) this.entries.shift();
  }

  lines(): string[] {
    return [...this.entries];
  }
}

export interface ExitInfo {
  code: number | null;
  signal: NodeJS.Signals | null;
}

export interface RunningProcess {
  pid: number;
  /** Resolves when the group is gone, output is flushed and the pid file removed. Never rejects. */
  exited: Promise<ExitInfo>;
  /**
   * Lists the process tree and sends SIGTERM before the first await, SIGKILL after graceMs, then
   * waits for `exited`. A later call with a shorter grace brings the SIGKILL forward. That can take
   * graceMs + 2 s (members still unreaped after SIGKILL) + 1 s (pipes held by a process the tree
   * no longer reaches).
   */
  stop(graceMs?: number): Promise<void>;
}

export interface SpawnSpec {
  command: string;
  cwd?: string;
  env: Record<string, string>;
  logFile: string;
  pidFile: string;
  /** Receives every output line and every runner error. Runs inside the daemon: must not throw. */
  onLine(line: string): void;
}

// The server runs as `sh -c` in its own process group (pgid == pid), so the npx or uvx children it
// starts die with it. The setup is synchronous on purpose: the pid file exists before the child can
// exit, so the exit path never races its removal.
export function spawnServer(spec: SpawnSpec): RunningProcess {
  const child = startShell(spec);
  const pid = child.pid;
  // Node reports ENOENT, EACCES, EAGAIN, EMFILE and ENFILE from the spawn itself as an "error"
  // event on the next tick, with no pid. The listener in startShell passes that reason to onLine.
  if (pid === undefined) {
    throw new Error(
      `Could not start /bin/sh for: ${spec.command} (the reason follows in the log tail)`,
    );
  }
  writePidFile(spec, pid);
  return watchChild(child, pid, spec);
}

function startShell(spec: SpawnSpec): ServerChild {
  try {
    mkdirSync(dirname(spec.logFile), { recursive: true });
    mkdirSync(dirname(spec.pidFile), { recursive: true });
    if (spec.cwd !== undefined) assertDirectory(spec.cwd);
    const child = spawn("/bin/sh", ["-c", spec.command], {
      cwd: spec.cwd,
      env: serverEnv(spec.env),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    // An unlistened "error" would crash the daemon this plugin runs in.
    child.on("error", (error) => spec.onLine(`spawn error: ${error.message}`));
    return child;
  } catch (error) {
    throw startFailure(spec, error);
  }
}

// spawn() reports a missing cwd only on the next tick, as a bare `spawn /bin/sh ENOENT`, and throws
// a bare `spawn ENOTDIR` for a file. Checking first puts the path into the message.
function assertDirectory(cwd: string): void {
  if (!statSync(cwd).isDirectory()) throw new Error(`cwd is not a directory: ${cwd}`);
}

// The reason goes to onLine and into the thrown message, so it reaches both the log tail and the
// supervisor's lastError.
function startFailure(spec: SpawnSpec, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error);
  spec.onLine(`spawn error: ${reason}`);
  return new Error(`Could not start /bin/sh for: ${spec.command}: ${reason}`, { cause: error });
}

function watchChild(child: ServerChild, pid: number, spec: SpawnSpec): RunningProcess {
  const log = createWriteStream(spec.logFile, { flags: "a" });
  log.on("error", (error) => spec.onLine(`log file error: ${error.message}`));
  function emit(line: string): void {
    spec.onLine(line);
    if (log.writable) log.write(`${line}\n`);
  }
  forwardLines(child.stdout, emit);
  forwardLines(child.stderr, emit);
  const closed = new Promise<void>((resolve) => {
    child.once("close", () => resolve());
  });
  const leaderExit = new Promise<ExitInfo>((resolve) => {
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let termination: Termination | null = null;
  let reaped = false;

  // One termination per group. A later call can only bring its SIGKILL forward.
  function terminateGroup(graceMs: number): Termination {
    if (termination !== null) {
      termination.hurry(graceMs);
      return termination;
    }
    termination = terminate(pid, graceMs);
    return termination;
  }

  async function settle(): Promise<ExitInfo> {
    const info = await leaderExit;
    // Members the leader started can outlive it and keep holding the port and the pipes.
    await terminateGroup(DEFAULT_GRACE_MS).done;
    reaped = true;
    await waitAtMost(closed, STDIO_DRAIN_MS);
    child.stdout.destroy();
    child.stderr.destroy();
    await closeLog(log);
    await removePidFile(spec.pidFile, spec.onLine);
    return info;
  }

  const exited = settle();
  return {
    pid,
    exited,
    async stop(graceMs = DEFAULT_GRACE_MS) {
      // Once the group is gone its id can be reused by another process: never signal it again.
      if (!reaped) terminateGroup(graceMs);
      await exited;
    },
  };
}

// SIGTERM to the group and to the processes outside it that descend from its members, SIGKILL to
// the same set after graceMs. Resolves once none is left, or KILL_WAIT_MS after the SIGKILL.
export async function killProcessGroup(pgid: number, graceMs = DEFAULT_GRACE_MS): Promise<void> {
  await terminate(pgid, graceMs).done;
}

// A daemon that died without cleanup leaves its groups running with their pid files. Kill such a
// group only when the daemon that wrote the file is gone and the group is still the one it started.
// Rejects after removing a pid file that does not parse, and on any other file error.
export async function reclaimOrphan(pidFile: string): Promise<boolean> {
  const record = await readPidRecord(pidFile);
  if (record === null || ownerIsAlive(record)) return false;
  const orphan = isRecordedGroup(record);
  if (orphan) await killProcessGroup(record.pgid);
  await rm(pidFile, { force: true });
  return orphan;
}

// The tree is listed before the first signal: once a member dies, the processes it started in a
// session of their own (Serena's language servers) move to init, and nothing links them to the
// server any more. Listing and every SIGTERM finish before this returns, so stop() signals before
// its first await.
function terminate(pgid: number, graceMs: number): Termination {
  // A group without members has no tree left to list or signal.
  if (!sendSignal(-pgid, 0)) return { done: Promise.resolve(), hurry: () => undefined };
  const outside = listOutsideGroup(pgid);
  signalTree(pgid, outside, "SIGTERM");
  let killAt = Date.now() + graceMs;
  const alive = (): boolean => sendSignal(-pgid, 0) || outside.some(isStillRunning);
  async function escalate(): Promise<void> {
    if (await waitUntilGone(alive, () => killAt)) return;
    signalTree(pgid, outside, "SIGKILL");
    const killWaitEnd = Date.now() + KILL_WAIT_MS;
    await waitUntilGone(alive, () => killWaitEnd);
  }
  return {
    done: escalate(),
    hurry(nextGraceMs) {
      killAt = Math.min(killAt, Date.now() + nextGraceMs);
    },
  };
}

function signalTree(pgid: number, outside: ProcEntry[], signal: NodeJS.Signals): void {
  sendSignal(-pgid, signal);
  for (const entry of outside) {
    if (isStillRunning(entry)) sendSignal(entry.pid, signal);
  }
}

// A listed pid can belong to another process by now; the start time tells them apart.
function isStillRunning(entry: ProcEntry): boolean {
  return readStat(entry.pid)?.startTime === entry.startTime;
}

// The processes outside the group that descend by parent pid from one of its members. procfs.ts's
// listProcessTree walks the same tree, but asynchronously, and stop() must signal before its first
// await. One /proc scan takes about 2 ms for the 110 processes in this container. Empty without
// /proc.
function listOutsideGroup(pgid: number): ProcEntry[] {
  const table = readProcTable();
  const children = new Map<number, ProcEntry[]>();
  for (const entry of table) {
    const siblings = children.get(entry.ppid);
    if (siblings) siblings.push(entry);
    else children.set(entry.ppid, [entry]);
  }
  const tree = new Set(table.filter((entry) => entry.pgrp === pgid));
  // A Set iterator also visits members added during the loop, so this walks the whole subtree.
  for (const entry of tree) {
    for (const child of children.get(entry.pid) ?? []) tree.add(child);
  }
  return [...tree].filter((entry) => entry.pgrp !== pgid);
}

function readProcTable(): ProcEntry[] {
  const table: ProcEntry[] = [];
  for (const name of readProcNames()) {
    const stat = PID_ENTRY.test(name) ? readStat(Number(name)) : null;
    if (stat !== null) table.push({ pid: Number(name), ...stat });
  }
  return table;
}

function readProcNames(): string[] {
  try {
    return readdirSync("/proc");
  } catch {
    return [];
  }
}

// null when the process is gone, when /proc does not exist, or when the line does not parse.
// stop() runs this inside the daemon, so no read error may escape.
function readStat(pid: number): ProcStat | null {
  try {
    return parseStat(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return null;
  }
}

function readStartTime(pid: number): number | null {
  return readStat(pid)?.startTime ?? null;
}

function serverEnv(overrides: Record<string, string>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith(STRIPPED_ENV_PREFIX) || STRIPPED_ENV_KEYS.has(key)) continue;
    env[key] = value;
  }
  return { ...env, ...overrides };
}

function forwardLines(stream: Readable, emit: (line: string) => void): void {
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  lines.on("line", (line) => emit(capLine(line)));
  lines.on("error", (error) => emit(`output error: ${error.message}`));
}

function capLine(line: string): string {
  return line.length > MAX_LINE_CHARS ? `${line.slice(0, MAX_LINE_CHARS)}…` : line;
}

// Written through a rename, so a daemon that dies mid-write leaves a stray .tmp file and never a
// truncated pid file.
function writePidFile(spec: SpawnSpec, pgid: number): void {
  const record: PidRecord = {
    pgid,
    startTime: readStartTime(pgid),
    ownerPid: process.pid,
    ownerStartTime: readStartTime(process.pid),
  };
  const tmpFile = `${spec.pidFile}.tmp`;
  try {
    writeFileSync(tmpFile, `${JSON.stringify(record)}\n`);
    renameSync(tmpFile, spec.pidFile);
  } catch (error) {
    // Without its pid file nothing could reclaim the group after a daemon crash.
    sendSignal(-pgid, "SIGKILL");
    throw startFailure(spec, error);
  }
}

// spawnServer never leaves a file that does not parse, so one names no group of ours. It is removed
// and the call rejects, so the caller can report it.
async function readPidRecord(pidFile: string): Promise<PidRecord | null> {
  const text = await readTextIfExists(pidFile);
  if (text === null) return null;
  const record = PidRecordSchema.safeParse(parseJson(text));
  if (record.success) return record.data;
  await rm(pidFile, { force: true });
  throw new Error(`Removed unreadable pid file ${pidFile}`);
}

async function readTextIfExists(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

// The same pid as this process means an earlier plugin run in this daemon, or a dead daemon whose
// pid this one reused: both are gone.
function ownerIsAlive(record: PidRecord): boolean {
  if (record.ownerPid === process.pid) return false;
  if (record.ownerStartTime === null) return sendSignal(record.ownerPid, 0);
  return readStartTime(record.ownerPid) === record.ownerStartTime;
}

// The kernel does not reuse a pid while a process group with that id exists, so a live group whose
// leader has exited is still the recorded one. A live leader must match the recorded start time.
function isRecordedGroup(record: PidRecord): boolean {
  if (record.startTime === null || !sendSignal(-record.pgid, 0)) return false;
  const leaderStartTime = readStartTime(record.pgid);
  return leaderStartTime === null || leaderStartTime === record.startTime;
}

// false when the target is gone (ESRCH) or belongs to someone else (EPERM).
function sendSignal(target: number, signal: NodeJS.Signals | 0): boolean {
  try {
    process.kill(target, signal);
    return true;
  } catch {
    return false;
  }
}

// Polls until nothing is left or the deadline passes. The deadline is read on every poll, so a
// later stop() with a shorter grace brings the SIGKILL forward, at most POLL_MS after the deadline.
async function waitUntilGone(alive: () => boolean, deadline: () => number): Promise<boolean> {
  while (alive()) {
    if (Date.now() >= deadline()) return false;
    await delay(POLL_MS);
  }
  return true;
}

async function waitAtMost(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<void>((resolve) => {
    timer = setTimeout(() => resolve(), timeoutMs);
  });
  await Promise.race([promise, timeout]);
  clearTimeout(timer);
}

function closeLog(log: WriteStream): Promise<void> {
  if (log.closed) return Promise.resolve();
  return new Promise((resolve) => {
    log.once("close", () => resolve());
    log.end();
  });
}

async function removePidFile(pidFile: string, onLine: (line: string) => void): Promise<void> {
  try {
    await rm(pidFile, { force: true });
  } catch (error) {
    onLine(`pid file not removed: ${error instanceof Error ? error.message : String(error)}`);
  }
}
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/process-runner.test.ts --bail=1`

Expected on Linux as a non-root user: PASS, 22 tests (1 LogRing, 13 spawnServer, 8 reclaimOrphan) in about 2.5 s plus vitest startup; the SIGKILL test alone takes about 1.1 s and the shorter-grace test about 0.4 s. As root the EACCES test is skipped (21 pass, 1 skipped). On other platforms 21 are skipped. These counts and times come from two runs of this code under a minimal vitest stand-in on this host, because vitest itself was not run while the plan was written.

Then check that the suite left nothing running: `pgrep -ax sleep | grep -E 'sleep (30|0)\.123$'` prints nothing (exit 1). `pgrep -x sleep` lists only processes named `sleep`, so the shell that runs the check never matches, and the odd durations exclude other sessions' sleeps. If another session is running this same suite at that moment, its processes match too: wait for it to finish and check again.

- [ ] **Step 5: Format the new files**

Run: `cd /workspace/utils/paseo && npm run format:files -- plugins/shared-mcp/server/process-runner.ts plugins/shared-mcp/server/process-runner.test.ts && npm run format:check:files -- plugins/shared-mcp/server/process-runner.ts plugins/shared-mcp/server/process-runner.test.ts`

Expected: `All matched files use the correct format.` Both files were checked with the repo's `oxfmt` and `.oxfmtrc.json`, and linted with the repo's `.oxlintrc.json`, so the first command changes nothing.

- [ ] **Step 6: Lint the new files**

Run: `cd /workspace/utils/paseo && npm run lint -- plugins/shared-mcp/server/process-runner.ts plugins/shared-mcp/server/process-runner.test.ts`

Expected: `Found 0 warnings and 0 errors.`

- [ ] **Step 7: Typecheck the plugins workspace**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded`

Expected: exit 0, no diagnostics. `plugins/tsconfig.json` excludes `**/*.test.ts`, so this checks `process-runner.ts` and the `procfs.ts` it imports; the test file is checked by running it.

- [ ] **Step 8: Commit with the fork identity**

First check what is staged: `git -C /workspace/utils/paseo diff --cached --name-only`. Other sessions share this checkout and stage their own files in it: on 2026-11-06 one left `docker/Dockerfile.agents` staged until it committed 4cea87cf2. Each commit command below ends with a pathspec, so it commits only the two process-runner files and anything else staged stays staged and out of this commit.

The lefthook pre-commit hook runs format and lint on the staged files plus a full `npm run typecheck` across every workspace (about 3.7 GB). Steps 5 to 7 already ran its format, lint and typecheck jobs for these two files. Skipping the hook is the user's call: ask which of the two commits below they want, wait for the answer, and run only that one.

If the user approves skipping the hook:

```bash
git -C /workspace/utils/paseo add plugins/shared-mcp/server/process-runner.ts plugins/shared-mcp/server/process-runner.test.ts
LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): shared-mcp process runner" -- plugins/shared-mcp/server/process-runner.ts plugins/shared-mcp/server/process-runner.test.ts
```

If the user wants the hook to run, hold the heavy-command lock so its full typecheck does not run alongside another one:

```bash
git -C /workspace/utils/paseo add plugins/shared-mcp/server/process-runner.ts plugins/shared-mcp/server/process-runner.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): shared-mcp process runner" -- plugins/shared-mcp/server/process-runner.ts plugins/shared-mcp/server/process-runner.test.ts
```

If the hook fails in a workspace this task did not touch, report it to the user rather than switching to `LEFTHOOK=0` on your own.

Then verify:

```bash
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo show --stat --format= HEAD
```

Expected: the first command prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`, and the stat lists exactly `plugins/shared-mcp/server/process-runner.ts` and `plugins/shared-mcp/server/process-runner.test.ts`. The identity variables apply to that one command only. Local commit only, do not push.

### Task 5: Data paths and bearer token store

**Files:**

- Create: `plugins/shared-mcp/server/paths.ts`
- Create: `plugins/shared-mcp/server/token-store.ts`
- Test: `plugins/shared-mcp/server/paths.test.ts`
- Test: `plugins/shared-mcp/server/token-store.test.ts`

**Interfaces:**

- Consumes: nothing from earlier tasks. Only `node:crypto`, `node:fs/promises`, `node:os` and `node:path`.
- Produces:
  - `export function sharedMcpHome(env: NodeJS.ProcessEnv = process.env): string` returns `<PASEO_HOME or ~/.paseo, "~" and "~/" expanded, path.resolve'd>/shared-mcp`. This mirrors `resolvePaseoHome` in `packages/server/src/server/paseo-home.ts:4-18`, which the plugin bundle cannot import. Pure path math: it creates no directory.
  - `export async function loadOrCreateToken(file: string): Promise<string>` returns the 64-char lowercase hex token stored in `file`. If nothing is at `file`, it creates missing parent directories and a token from 32 random bytes, stored as `<token>\n` with mode 0600. Concurrent callers get the same token. An existing valid token file that group or others can read is tightened to 0600 (best effort, skipped on Windows).
  - `export class InvalidTokenFileError extends Error { readonly file: string }` is thrown when `file` exists but does not hold a 64-char hex token (the file is left untouched), and when the name stays unreadable after one creation attempt, such as a dangling symlink. (Addition to the contract, see contractDeviations.)
  - The wiring task (server/plugin.ts, Task 7) calls `loadOrCreateToken(join(home, "token"))` lazily, on the first apply or agent open that needs it. An agent open needs it as soon as any definition, enabled or disabled, has `bearerToken`, because the hook hands agents the token of disabled bearer servers too, so the enable switch works for agents opened while the server was off. An apply needs it when some definition has `bearerToken` and some definition is enabled. With no `bearerToken` definition the token file is never created. Task 7 caches the promise so every caller in the daemon shares one load. It catches a rejection, logs it, clears the cached promise so the next caller retries, and makes the hook return `undefined`.

- [ ] **Step 1: Write the failing paths test**

Create `plugins/shared-mcp/server/paths.test.ts`:

```ts
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sharedMcpHome } from "./paths.js";

describe("sharedMcpHome", () => {
  it("uses an absolute PASEO_HOME as given", () => {
    const paseoHome = resolve("/srv/paseo-home");

    expect(sharedMcpHome({ PASEO_HOME: paseoHome })).toBe(join(paseoHome, "shared-mcp"));
  });

  it("expands a leading ~/ in PASEO_HOME to the user's home directory", () => {
    expect(sharedMcpHome({ PASEO_HOME: "~/paseo-dev" })).toBe(
      join(homedir(), "paseo-dev", "shared-mcp"),
    );
  });

  it("expands a bare ~ in PASEO_HOME", () => {
    expect(sharedMcpHome({ PASEO_HOME: "~" })).toBe(join(homedir(), "shared-mcp"));
  });

  it("resolves a relative PASEO_HOME against the working directory, as the daemon does", () => {
    expect(sharedMcpHome({ PASEO_HOME: ".dev/paseo-home" })).toBe(
      join(process.cwd(), ".dev", "paseo-home", "shared-mcp"),
    );
  });

  it("falls back to ~/.paseo when PASEO_HOME is unset", () => {
    expect(sharedMcpHome({})).toBe(join(homedir(), ".paseo", "shared-mcp"));
  });
});
```

- [ ] **Step 2: Run the paths test and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/paths.test.ts --bail=1`

Expected: FAIL. The suite cannot load `./paths.js` because the file does not exist yet (vitest reports `Failed to resolve import "./paths.js"` or `Failed to load url ./paths.js`), and 0 tests run.

- [ ] **Step 3: Implement `server/paths.ts`**

Create `plugins/shared-mcp/server/paths.ts`:

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

// The plugin SDK exposes no data directory, so the token, pid files and logs live next to the
// daemon's own state. Built-ins run in the daemon process, so process.env is the daemon's env.
export function sharedMcpHome(env: NodeJS.ProcessEnv = process.env): string {
  const paseoHome = resolve(expandHomeDir(env.PASEO_HOME ?? "~/.paseo"));
  return join(paseoHome, "shared-mcp");
}
```

- [ ] **Step 4: Run the paths test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/paths.test.ts --bail=1`

Expected: PASS. `Test Files  1 passed (1)`, `Tests  5 passed (5)`.

- [ ] **Step 5: Write the failing token store test**

Create `plugins/shared-mcp/server/token-store.test.ts`. `link` is wrapped in a `vi.fn` that calls the real `link`, so one test can make it fail the way a filesystem without hard links does, and the other tests can assert how often the store tried to link:

```ts
import { mkdtempSync, rmSync } from "node:fs";
import { chmod, link, lstat, readdir, readFile, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InvalidTokenFileError, loadOrCreateToken } from "./token-store.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, link: vi.fn(actual.link) };
});

describe("loadOrCreateToken", () => {
  let dir: string;
  let file: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "shared-mcp-token-"));
    file = join(dir, "token");
    vi.mocked(link).mockClear();
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("creates a 64-character hex token and stores it in the file", async () => {
    const token = await loadOrCreateToken(file);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(await readFile(file, "utf8")).toBe(`${token}\n`);
    expect(link).toHaveBeenCalledOnce();
    expect(link).toHaveBeenCalledWith(expect.stringMatching(/\.tmp$/), file);
  });

  it.runIf(process.platform !== "win32")("creates the token file with mode 0600", async () => {
    await loadOrCreateToken(file);

    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it("returns the stored token on the next call", async () => {
    const first = await loadOrCreateToken(file);

    expect(await loadOrCreateToken(file)).toBe(first);
    expect(link).toHaveBeenCalledOnce();
  });

  it("creates missing parent directories", async () => {
    const nested = join(dir, "paseo-home", "shared-mcp", "token");

    const token = await loadOrCreateToken(nested);

    expect((await stat(join(dir, "paseo-home", "shared-mcp"))).isDirectory()).toBe(true);
    expect(await readFile(nested, "utf8")).toBe(`${token}\n`);
  });

  it("gives concurrent callers one token and leaves no temp files behind", async () => {
    const [first, second, third] = await Promise.all([
      loadOrCreateToken(file),
      loadOrCreateToken(file),
      loadOrCreateToken(file),
    ]);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(await readdir(dir)).toEqual(["token"]);
  });

  it.each(["EPERM", "ENOTSUP", "ENOSYS"])(
    "creates the token without a hard link when link() fails with %s",
    async (code) => {
      vi.mocked(link).mockRejectedValueOnce(Object.assign(new Error("no hard links"), { code }));

      const token = await loadOrCreateToken(file);

      expect(link).toHaveBeenCalledOnce();
      expect(token).toMatch(/^[0-9a-f]{64}$/);
      expect(await readFile(file, "utf8")).toBe(`${token}\n`);
      expect(await readdir(dir)).toEqual(["token"]);
    },
  );

  it.runIf(process.platform !== "win32")("tightens a readable token file to 0600", async () => {
    const stored = "ab".repeat(32);
    await writeFile(file, `${stored}\n`);
    await chmod(file, 0o644);

    expect(await loadOrCreateToken(file)).toBe(stored);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(link).not.toHaveBeenCalled();
  });

  it("rejects a token file that does not hold a hex token and leaves it alone", async () => {
    await writeFile(file, "not-a-token\n");

    await expect(loadOrCreateToken(file)).rejects.toBeInstanceOf(InvalidTokenFileError);
    expect(await readFile(file, "utf8")).toBe("not-a-token\n");
    expect(link).not.toHaveBeenCalled();
  });

  it.runIf(process.platform !== "win32")("rejects a dangling token symlink", async () => {
    await symlink(join(dir, "missing-target"), file);

    await expect(loadOrCreateToken(file)).rejects.toBeInstanceOf(InvalidTokenFileError);
    expect(link).toHaveBeenCalledOnce();
    expect((await lstat(file)).isSymbolicLink()).toBe(true);
    expect(await readdir(dir)).toEqual(["token"]);
  });
});
```

The dangling-symlink case is the one that used to loop: `open`/`readFile` follow the link and get ENOENT, while `link()` does not follow it and gets EEXIST. `toHaveBeenCalledOnce()` on `link` proves the store makes one creation attempt and then gives up.

- [ ] **Step 6: Run the token store test and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/token-store.test.ts --bail=1`

Expected: FAIL. The suite cannot load `./token-store.js` (vitest reports `Failed to resolve import "./token-store.js"` or `Failed to load url ./token-store.js`), and 0 tests run.

- [ ] **Step 7: Implement `server/token-store.ts`**

Create `plugins/shared-mcp/server/token-store.ts`. The token is written in full to a private temp file and hard-linked into place. Where the filesystem has no hard links (`link()` fails with EPERM, ENOTSUP or ENOSYS), an exclusive `wx` create stands in. A caller that loses the creation race reads the file once more; a second miss throws `InvalidTokenFileError` instead of recursing, so the `agent.open.before` hook that awaits the token can never hang on it. A valid token that group or others can read is tightened to 0600, best effort, the way `packages/server/src/server/private-files.ts` treats the daemon's own private files.

```ts
import { randomBytes, randomUUID } from "node:crypto";
import { link, mkdir, open, rm, writeFile, type FileHandle } from "node:fs/promises";
import { dirname } from "node:path";

const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^[0-9a-f]{64}$/;
const TOKEN_FILE_MODE = 0o600;
// link() fails with one of these on filesystems without hard links: exFAT, some FUSE and network
// mounts, some container volume drivers.
const NO_HARD_LINK_CODES = new Set(["EPERM", "ENOTSUP", "ENOSYS"]);

export class InvalidTokenFileError extends Error {
  readonly file: string;

  constructor(file: string) {
    super(`${file} does not hold a 64-character hex token; delete it to create a new one`);
    this.name = "InvalidTokenFileError";
    this.file = file;
  }
}

function errnoCode(error: unknown): string | undefined {
  if (error instanceof Error && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return undefined;
}

async function openIfPresent(file: string): Promise<FileHandle | null> {
  try {
    return await open(file, "r");
  } catch (error) {
    if (errnoCode(error) === "ENOENT") {
      return null;
    }
    throw error;
  }
}

// A token copied in or restored from a backup can arrive readable by others. Tighten it the way
// the daemon's private-files.ts does: skip Windows and ignore filesystems that refuse chmod.
async function restrictMode(handle: FileHandle): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  const { mode } = await handle.stat();
  if ((mode & 0o077) !== 0) {
    await handle.chmod(TOKEN_FILE_MODE).catch(() => {});
  }
}

// Null means nothing readable sits at the path, which includes a symlink to a missing target.
async function readToken(file: string): Promise<string | null> {
  const handle = await openIfPresent(file);
  if (handle === null) {
    return null;
  }
  try {
    const token = (await handle.readFile("utf8")).trim();
    if (!TOKEN_PATTERN.test(token)) {
      throw new InvalidTokenFileError(file);
    }
    await restrictMode(handle);
    return token;
  } finally {
    await handle.close();
  }
}

async function createExclusive(file: string, token: string): Promise<boolean> {
  try {
    await writeFile(file, `${token}\n`, { flag: "wx", mode: TOKEN_FILE_MODE });
    return true;
  } catch (error) {
    if (errnoCode(error) === "EEXIST") {
      return false;
    }
    throw error;
  }
}

// link() fails when the target exists, so racing callers all keep the token that linked first,
// and a reader never sees a half-written file. Without hard links, an exclusive create stands in;
// a reader can then catch the file half-written, which the wiring avoids by sharing one promise.
async function placeToken(tempFile: string, file: string, token: string): Promise<boolean> {
  try {
    await link(tempFile, file);
    return true;
  } catch (error) {
    const code = errnoCode(error);
    if (code === "EEXIST") {
      return false;
    }
    if (code !== undefined && NO_HARD_LINK_CODES.has(code)) {
      return createExclusive(file, token);
    }
    throw error;
  }
}

async function createTokenIfAbsent(file: string): Promise<string | null> {
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const tempFile = `${file}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempFile, `${token}\n`, { mode: TOKEN_FILE_MODE });
    return (await placeToken(tempFile, file, token)) ? token : null;
  } finally {
    await rm(tempFile, { force: true });
  }
}

// One token per daemon home. Servers adopted as external and agents launched before a daemon
// restart still hold it, so it is read back on every start instead of being replaced.
export async function loadOrCreateToken(file: string): Promise<string> {
  const existing = await readToken(file);
  if (existing !== null) {
    return existing;
  }
  await mkdir(dirname(file), { recursive: true });
  const created = await createTokenIfAbsent(file);
  if (created !== null) {
    return created;
  }
  // Another caller linked its token first, so one more read finds it. A second miss means the
  // name is taken by something unreadable, such as a dangling symlink: fail instead of looping.
  const raced = await readToken(file);
  if (raced === null) {
    throw new InvalidTokenFileError(file);
  }
  return raced;
}
```

- [ ] **Step 8: Run the token store test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/token-store.test.ts --bail=1`

Expected: PASS. `Test Files  1 passed (1)`, `Tests  11 passed (11)` on Linux. (On Windows the three POSIX-only tests, mode 0600, tightening and the dangling symlink, are skipped: 8 passed, 3 skipped.)

- [ ] **Step 9: Format the new files**

Run: `cd /workspace/utils/paseo && npm run format:files -- plugins/shared-mcp/server/paths.ts plugins/shared-mcp/server/paths.test.ts plugins/shared-mcp/server/token-store.ts plugins/shared-mcp/server/token-store.test.ts && npm run format:check:files -- plugins/shared-mcp/server/paths.ts plugins/shared-mcp/server/paths.test.ts plugins/shared-mcp/server/token-store.ts plugins/shared-mcp/server/token-store.test.ts`

Expected: oxfmt rewrites nothing, or only whitespace, and the check exits 0. If it changed code, re-run Steps 4 and 8.

- [ ] **Step 10: Lint the new files**

Run: `cd /workspace/utils/paseo && npm run lint -- plugins/shared-mcp/server/paths.ts plugins/shared-mcp/server/paths.test.ts plugins/shared-mcp/server/token-store.ts plugins/shared-mcp/server/token-store.test.ts`

Expected: `Found 0 warnings and 0 errors.` The rules that bear on this code: no `any`; no shadowed names; every `throw` inside a `catch` rethrows the caught error itself, which preserve-caught-error allows; the deepest test nesting is describe > `it.each(...)` > async callback, within max-nested-callbacks 3, and the `vi.mock` factory sits at top level.

- [ ] **Step 11: Typecheck the builtin-plugins workspace**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded`

Expected: exit 0 with no diagnostics. This runs `tsgo -p tsconfig.json --noEmit --singleThreaded` in `plugins/` and checks `paths.ts` and `token-store.ts`. Test files are excluded by `plugins/tsconfig.json`. `"code" in error` narrows `Error` to `Error & Record<"code", unknown>`, and `typeof error.code === "string"` narrows the property to `string`, so `errnoCode` needs no cast.

- [ ] **Step 12: Commit with the fork identity (local only, never push)**

Other sessions share this checkout and stage their own files in it (Task 4 records one that left `docker/Dockerfile.agents` staged). First list what is staged:

```bash
git -C /workspace/utils/paseo diff --cached --name-only
```

Any path listed that is not one of this task's four files belongs to another session: leave it staged, and do not unstage, commit or revert it. The commit command below ends with a pathspec, so it commits only the four files, and anything else staged stays staged and out of this commit. Git rejects a pathspec that names an untracked file (`pathspec ... did not match any file(s) known to git`), so the `git add` runs first.

The lefthook pre-commit hook runs format:check and lint on the files being committed (with a pathspec, the hook's staged list holds only those four) and a full `npm run typecheck` across every workspace, so the commit runs under the heavy lock. Do not add `LEFTHOOK=0` on your own: skipping the hook is the user's call.

```bash
git -C /workspace/utils/paseo add plugins/shared-mcp/server/paths.ts plugins/shared-mcp/server/paths.test.ts plugins/shared-mcp/server/token-store.ts plugins/shared-mcp/server/token-store.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): shared-mcp data paths and bearer token store" -- plugins/shared-mcp/server/paths.ts plugins/shared-mcp/server/paths.test.ts plugins/shared-mcp/server/token-store.ts plugins/shared-mcp/server/token-store.test.ts
```

Expected: the lefthook jobs format, lint and typecheck all pass, and git reports one new commit with `4 files changed`. If the hook fails in a workspace this task did not touch, report it to the user rather than switching to `LEFTHOOK=0`.

- [ ] **Step 13: Verify the commit identity and contents**

Run: `git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>' && git -C /workspace/utils/paseo show --stat --format=%s HEAD && git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins/shared-mcp`

Expected: `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`, the subject `feat(fork): shared-mcp data paths and bearer token store` and exactly the four files above. The scoped `git status` prints nothing: nothing under `plugins/shared-mcp` is left uncommitted. The check covers only `plugins/shared-mcp` on purpose. The whole checkout need not be clean: it holds the untracked plan file (`?? docs/superpowers/plans/2026-11-06-shared-mcp-plugin.md`) unless the plan was committed first, and another session's staged or modified files may sit next to it. Leave both alone.

### Task 6: Supervisor state machine

**Files:**

- Create: `plugins/shared-mcp/server/supervisor.ts`
- Test: `plugins/shared-mcp/server/supervisor.test.ts`

**Interfaces:**

- Consumes:
  - `ServerDefinitionSchema`, `type ServerDefinition` from `plugins/shared-mcp/shared/settings.ts`
  - `type ServerStatus` from `plugins/shared-mcp/shared/rpc.ts` (the state union is read as `ServerStatus["state"]`)
  - `type ProbeResult = { ok: true; status: number } | { ok: false; error: string }` from `plugins/shared-mcp/server/probe.ts`
  - `class LogRing { constructor(limit = 200); push(line: string): void; lines(): string[] }`, `interface ExitInfo { code: number | null; signal: NodeJS.Signals | null }`, `interface RunningProcess { pid: number; exited: Promise<ExitInfo>; stop(graceMs?: number): Promise<void> }` from `plugins/shared-mcp/server/process-runner.ts`. This task relies on five properties of `exited` and `stop()`. Task 4 provides each one; see its Behaviour list:
    1. `stop()` lists the server's process tree and sends SIGTERM before its first `await`.
    2. `exited` resolves only after the leader has exited and the runner has killed the rest of its tree (SIGTERM, then SIGKILL after 5 s, or earlier if a `stop()` asked for less), and it never rejects. When `exited` resolves on a crash, nothing of the server is left to stop, so the supervisor does not call `stop()` for that process.
    3. Calling `stop()` after `exited` has settled is a no-op that resolves at once. `exited` already removed the leftover members, and the group id may belong to another process by then.
    4. `stop()` resolves with `exited`, so only once the whole tree is gone (or 2 s after the SIGKILL, `KILL_WAIT_MS`), never just because the `sh` leader exited. On SIGTERM `sh` dies at once, while an npx/node or uvx/python member runs its SIGTERM handler and can still answer on the port.
    5. Calling `stop()` again while a stop is pending is safe. A shorter grace moves the SIGKILL to graceMs after that call; a longer grace changes nothing. Every pending call resolves with `exited`.
       One `stop(graceMs)` can take graceMs + 2 s (`KILL_WAIT_MS`) + 1 s (`STDIO_DRAIN_MS`). `stop()` is not expected to reject. The supervisor still turns a rejection into `lastError`, because the plugin runs inside the daemon.
- Produces (in `plugins/shared-mcp/server/supervisor.ts`):
  - `interface SupervisorDeps { now(): number; setTimer(fn: () => void, ms: number): () => void; spawn(def: ServerDefinition, onLine: (line: string) => void): RunningProcess; probe(def: ServerDefinition): Promise<ProbeResult>; pathExists(path: string): Promise<boolean>; readRss(pgid: number): Promise<number | null> }`
  - `const TIMING` with the contract keys plus `shutdownGraceMs: 800`
  - `class Supervisor { constructor(deps: SupervisorDeps); apply(defs: ServerDefinition[]): Promise<void>; restart(id: string): Promise<void>; status(): Promise<ServerStatus[]>; stopAll(): Promise<void> }`
  - `type RestartRefusal = "unknown" | "external" | "disabled"` and `class RestartRefusedError extends Error { readonly serverId: string; readonly reason: RestartRefusal }`. `restart()` throws it. The plugin's restart RPC maps it to `{ ok: false, error: error.message }`.

Behaviour this task settles (the tests pin each one):

- The port is probed before every spawn: the first start, each backoff or failing retry, `restart(id)`, and a takeover from `external`. If something already answers, the server is adopted as `external` and no second copy starts.
- The exception is the first pre-spawn probe after Paseo stopped its own process (restart, changed definition, crash, forced kill). An answer then means that process may still be shutting down. Adopting it would leave it running as `external`, out of reach of `restart()` and `stopAll()`. The server instead goes to `backoff` with `lastError` "Port <n> still in use after stop" and probes again after 2 s.
- Two failed health probes in a row kill the process, and the kill counts as a crash. The first retry therefore comes after the 2 s backoff, and a server that keeps hanging reaches `failing` the same way as one that keeps exiting.
- A crash reaches the supervisor when `exited` resolves. That is after the runner has killed what the leader left running: within one 50 ms poll when the members exit on SIGTERM, up to about 8 s (5 s grace, 2 s kill wait, 1 s drain) when one ignores it. Until then `status()` keeps the old state and pid. The supervisor never calls `stop()` on a process whose `exited` has resolved.
- A step that rejects (a probe, `pathExists`, an exit watcher) also counts as a crash. Its process, if any, is stopped and the server backs off. A rejected `stop()` becomes `lastError`. Nothing the supervisor schedules can reject, because an unhandled rejection exits the daemon.
- `restarts` is the number of spawns minus one. `lastError` is not cleared when the server turns healthy, so the UI can still show why it last restarted. `restart(id)` and a definition change that restarts the server clear it.
- Only a change to `command`, `cwd`, `env` (key order ignored), `port`, `requires`, `bearerToken.serverEnv` or `enabled` restarts a server. `label`, `healthPath` and `bearerToken.agentEnv` are updated in place, so editing them does not drop the agents connected to the server.
- `apply()` waits for every stop it starts (removed servers, and the old process of changed ones) before it starts anything, because a new or renamed definition can reuse a port that is still held.
- A removed definition disappears from `status()`. A disabled one stays listed as `disabled`.
- `apply()` and `restart()` share an internal promise queue. `stopAll()` skips the queue. Before its first `await` it calls `stop(TIMING.shutdownGraceMs)` on every owned group and on every group that a restart, an unhealthy kill or an `apply()` is still stopping with `TIMING.stopGraceMs`. For those, the second call brings the SIGKILL forward to 800 ms (property 5). The daemon waits only 2 s for an in-process plugin's cleanup (`SOFT_SHUTDOWN_TIMEOUT_MS` in `packages/server/src/server/plugins/runtime.ts`). `shutdownGraceMs` is 800, the value Task 4 sizes for that budget: for a group that ignores SIGTERM and whose setsid'd child holds its pipes after the child's parent exited, `stop(800)` took 1,858 ms on this host and `stop(1_500)` 2,565 ms. The research note's 1,500 ms predates that measurement.
- When the wiring task implements `SupervisorDeps.setTimer`, it must `unref()` the timer and pass `TIMING.probeTimeoutMs` to `probeMcp`.

- [ ] **Step 1: Write the failing test.** Create `plugins/shared-mcp/server/supervisor.test.ts`. The supervisor is one state machine, so its tests go in as one file. They drive it through a manual clock with a timer queue, fake processes whose exit the test triggers, and a fake port model. A port answers when an outside server holds it, or when a live fake process on that port is answering. The model keys on the port, not the id, so a process that is still shutting down can answer for a new definition.

```ts
import { describe, expect, it, vi, type Mock } from "vitest";
import type { ServerStatus } from "../shared/rpc.js";
import { ServerDefinitionSchema, type ServerDefinition } from "../shared/settings.js";
import type { ExitInfo, RunningProcess } from "./process-runner.js";
import type { ProbeResult } from "./probe.js";
import { Supervisor, TIMING, type SupervisorDeps } from "./supervisor.js";

const T0 = Date.parse("2026-11-06T00:00:00.000Z");

interface FakeTimer {
  at: number;
  seq: number;
  fn: () => void;
  cancelled: boolean;
}

class FakeClock {
  time = T0;
  private seq = 0;
  private timers: FakeTimer[] = [];

  setTimer(fn: () => void, ms: number): () => void {
    const timer: FakeTimer = { at: this.time + ms, seq: this.seq, fn, cancelled: false };
    this.seq += 1;
    this.timers.push(timer);
    return () => {
      timer.cancelled = true;
    };
  }

  pending(): number {
    return this.timers.filter((timer) => !timer.cancelled).length;
  }

  // Fires every timer due by now + ms in order, letting each callback's promises settle first.
  async advance(ms: number): Promise<void> {
    const end = this.time + ms;
    await flush();
    for (let timer = this.nextDue(end); timer !== null; timer = this.nextDue(end)) {
      this.time = timer.at;
      timer.cancelled = true;
      timer.fn();
      await flush();
    }
    this.time = end;
  }

  private nextDue(end: number): FakeTimer | null {
    const due = this.timers.filter((timer) => !timer.cancelled && timer.at <= end);
    due.sort((a, b) => a.at - b.at || a.seq - b.seq);
    return due[0] ?? null;
  }
}

interface FakeProcess extends RunningProcess {
  def: ServerDefinition;
  answering: boolean;
  alive: boolean;
  stop: Mock<RunningProcess["stop"]>;
  emit(line: string): void;
  exit(info: ExitInfo): void;
}

interface FakeProcessSpec {
  pid: number;
  def: ServerDefinition;
  answering: boolean;
  onLine: (line: string) => void;
}

interface World {
  processes: FakeProcess[];
  externalPorts: Set<number>;
  existingPaths: Set<string>;
  listening: boolean;
}

interface FakeDeps extends SupervisorDeps {
  spawn: Mock<SupervisorDeps["spawn"]>;
  probe: Mock<SupervisorDeps["probe"]>;
  pathExists: Mock<SupervisorDeps["pathExists"]>;
  readRss: Mock<SupervisorDeps["readRss"]>;
}

interface Harness {
  clock: FakeClock;
  world: World;
  deps: FakeDeps;
  supervisor: Supervisor;
}

function flush(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function createFakeProcess(spec: FakeProcessSpec): FakeProcess {
  let resolveExit: (info: ExitInfo) => void = () => {};
  const exited = new Promise<ExitInfo>((resolve) => {
    resolveExit = resolve;
  });
  const proc: FakeProcess = {
    pid: spec.pid,
    def: spec.def,
    exited,
    answering: spec.answering,
    alive: true,
    emit: spec.onLine,
    exit(info) {
      proc.alive = false;
      resolveExit(info);
    },
    stop: vi.fn<RunningProcess["stop"]>(async () => {
      proc.exit({ code: null, signal: "SIGTERM" });
    }),
  };
  return proc;
}

// A port answers when an outside server holds it or a live fake process on it answers. Keying on
// the port, not the id, lets a process that is still shutting down answer for a new definition.
function probeFake(world: World, def: ServerDefinition): ProbeResult {
  const isExternal = world.externalPorts.has(def.port);
  const isAnswering = world.processes.some(
    (proc) => proc.def.port === def.port && proc.alive && proc.answering,
  );
  if (isExternal || isAnswering) return { ok: true, status: 200 };
  return { ok: false, error: `connect ECONNREFUSED 127.0.0.1:${def.port}` };
}

function createHarness(): Harness {
  const clock = new FakeClock();
  const world: World = {
    processes: [],
    externalPorts: new Set(),
    existingPaths: new Set(),
    listening: true,
  };
  const deps: FakeDeps = {
    now: () => clock.time,
    setTimer: (fn, ms) => clock.setTimer(fn, ms),
    spawn: vi.fn<SupervisorDeps["spawn"]>((def, onLine) => {
      const pid = 4000 + world.processes.length;
      const proc = createFakeProcess({ pid, def, answering: world.listening, onLine });
      world.processes.push(proc);
      return proc;
    }),
    probe: vi.fn<SupervisorDeps["probe"]>(async (def) => probeFake(world, def)),
    pathExists: vi.fn<SupervisorDeps["pathExists"]>(async (path) => world.existingPaths.has(path)),
    readRss: vi.fn<SupervisorDeps["readRss"]>(async (pgid) => pgid * 1024),
  };
  return { clock, world, deps, supervisor: new Supervisor(deps) };
}

function definition(overrides: Partial<ServerDefinition> = {}): ServerDefinition {
  return ServerDefinitionSchema.parse({
    id: "ctx",
    label: "Context7",
    command: "npx -y @upstash/context7-mcp --transport http --port 8932",
    port: 8932,
    ...overrides,
  });
}

function latest(world: World, id = "ctx"): FakeProcess {
  const spawned = world.processes.filter((proc) => proc.def.id === id);
  return spawned[spawned.length - 1];
}

async function statusOf(supervisor: Supervisor, id = "ctx"): Promise<ServerStatus> {
  const statuses = await supervisor.status();
  const found = statuses.find((status) => status.id === id);
  if (found === undefined) throw new Error(`no status for ${id}`);
  return found;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

async function retryDelay(harness: Harness): Promise<number> {
  const { nextRetryAt } = await statusOf(harness.supervisor);
  if (nextRetryAt === null) throw new Error("no retry scheduled");
  return Date.parse(nextRetryAt) - harness.clock.time;
}

async function crashNow(harness: Harness): Promise<void> {
  latest(harness.world).exit({ code: 1, signal: null });
  await flush();
}

// Makes the next stop() of this process wait until the returned function is called.
function holdStop(proc: FakeProcess): () => void {
  let release: () => void = () => {};
  proc.stop.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      }),
  );
  return () => release();
}

async function crashAndRetry(harness: Harness): Promise<void> {
  await crashNow(harness);
  await harness.clock.advance(await retryDelay(harness));
}

describe("Supervisor", () => {
  it("checks the port, spawns, probes every second until healthy, then every 30 s", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    world.listening = false;
    const ctx = definition();

    await supervisor.apply([ctx]);

    expect(deps.probe).toHaveBeenCalledTimes(1);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(deps.spawn).toHaveBeenCalledWith(ctx, expect.any(Function));
    expect((await statusOf(supervisor)).state).toBe("starting");

    await clock.advance(TIMING.startupProbeMs);
    expect(deps.probe).toHaveBeenCalledTimes(2);
    expect((await statusOf(supervisor)).state).toBe("starting");

    latest(world).answering = true;
    await clock.advance(TIMING.startupProbeMs);
    expect(deps.probe).toHaveBeenCalledTimes(3);
    expect((await statusOf(supervisor)).state).toBe("healthy");

    await clock.advance(TIMING.probeIntervalMs - 1);
    expect(deps.probe).toHaveBeenCalledTimes(3);
    await clock.advance(1);
    expect(deps.probe).toHaveBeenCalledTimes(4);
    expect(deps.probe).toHaveBeenLastCalledWith(ctx);
    expect((await statusOf(supervisor)).state).toBe("healthy");
  });

  it("reports pid, start time, restarts, RSS and the log tail", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    latest(world).emit("listening on 8932");
    latest(world).emit("ready");
    await clock.advance(TIMING.startupProbeMs);

    expect(await supervisor.status()).toEqual([
      {
        id: "ctx",
        label: "Context7",
        port: 8932,
        state: "healthy",
        pid: 4000,
        startedAt: "2026-11-06T00:00:00.000Z",
        restarts: 0,
        rssBytes: 4000 * 1024,
        lastError: null,
        nextRetryAt: null,
        logTail: ["listening on 8932", "ready"],
      },
    ]);
    expect(deps.readRss).toHaveBeenCalledWith(4000);
  });

  it("kills and restarts a server after two failed probes in a row", async () => {
    const { clock, world, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const first = latest(world);
    first.answering = false;

    await clock.advance(TIMING.probeIntervalMs);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "unhealthy",
      pid: 4000,
      lastError: "Health check failed: connect ECONNREFUSED 127.0.0.1:8932",
    });
    expect(first.stop).not.toHaveBeenCalled();

    await clock.advance(TIMING.probeIntervalMs);
    expect(first.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      lastError: "Health check failed 2 times in a row: connect ECONNREFUSED 127.0.0.1:8932",
      nextRetryAt: iso(clock.time + TIMING.backoffStartMs),
    });

    await clock.advance(TIMING.backoffStartMs);
    expect(world.processes).toHaveLength(2);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", pid: 4001, restarts: 1 });
  });

  it("only restarts on consecutive failed probes", async () => {
    const { clock, world, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const first = latest(world);

    first.answering = false;
    await clock.advance(TIMING.probeIntervalMs);
    first.answering = true;
    await clock.advance(TIMING.probeIntervalMs);
    expect((await statusOf(supervisor)).state).toBe("healthy");
    first.answering = false;
    await clock.advance(TIMING.probeIntervalMs);

    expect((await statusOf(supervisor)).state).toBe("unhealthy");
    expect(first.stop).not.toHaveBeenCalled();
    expect(world.processes).toHaveLength(1);
  });

  it("counts a server that is not healthy within 120 s as a crash", async () => {
    const { clock, world, supervisor } = createHarness();
    world.listening = false;
    await supervisor.apply([definition()]);

    await clock.advance(TIMING.startupTimeoutMs - TIMING.startupProbeMs);
    expect(latest(world).stop).not.toHaveBeenCalled();
    expect((await statusOf(supervisor)).state).toBe("starting");

    await clock.advance(TIMING.startupProbeMs);
    expect(latest(world).stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      startedAt: null,
      lastError: "Not healthy within 120 s: connect ECONNREFUSED 127.0.0.1:8932",
      nextRetryAt: iso(clock.time + TIMING.backoffStartMs),
    });
  });

  it("does not stop a process again after its exit is reported", async () => {
    const harness = createHarness();
    const { clock, world, supervisor } = harness;
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const first = latest(world);

    await crashNow(harness);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      startedAt: null,
      lastError: "Exited with code 1",
    });

    await clock.advance(TIMING.backoffStartMs);
    await supervisor.stopAll();
    expect(first.stop).not.toHaveBeenCalled();
    expect(latest(world).stop).toHaveBeenCalledWith(TIMING.shutdownGraceMs);
  });

  it("backs off from 2 s, doubling to 60 s, and resets after 10 minutes healthy", async () => {
    const harness = createHarness();
    const { clock, supervisor } = harness;
    await supervisor.apply([definition()]);
    const delays: number[] = [];
    for (let crash = 0; crash < 7; crash += 1) {
      await clock.advance(TIMING.startupProbeMs);
      await clock.advance(5 * 60_000);
      await crashNow(harness);
      const delay = await retryDelay(harness);
      delays.push(delay);
      await clock.advance(delay);
    }
    expect(delays).toEqual([2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000]);

    await clock.advance(TIMING.startupProbeMs);
    await clock.advance(TIMING.backoffResetAfterHealthyMs);
    await crashNow(harness);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      restarts: 7,
      lastError: "Exited with code 1",
    });
    expect(await retryDelay(harness)).toBe(TIMING.backoffStartMs);
  });

  it("marks a server failing after five crashes in ten minutes and retries every five minutes", async () => {
    const harness = createHarness();
    const { clock, world, supervisor } = harness;
    await supervisor.apply([definition()]);
    for (let crash = 1; crash < TIMING.crashLimit; crash += 1) await crashAndRetry(harness);
    expect(world.processes).toHaveLength(TIMING.crashLimit);

    await crashNow(harness);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "failing",
      pid: null,
      lastError: "Exited with code 1",
      nextRetryAt: iso(clock.time + TIMING.failingRetryMs),
    });

    await clock.advance(TIMING.failingRetryMs - 1);
    expect(world.processes).toHaveLength(TIMING.crashLimit);
    await clock.advance(1);
    expect(world.processes).toHaveLength(TIMING.crashLimit + 1);
    expect((await statusOf(supervisor)).state).toBe("starting");

    await crashNow(harness);
    expect((await statusOf(supervisor)).state).toBe("failing");
  });

  it("treats a spawn that throws as a crash", async () => {
    const { clock, deps, supervisor } = createHarness();
    deps.spawn.mockImplementationOnce(() => {
      throw new Error("spawn sh EACCES");
    });

    await supervisor.apply([definition()]);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      lastError: "spawn sh EACCES",
      nextRetryAt: iso(clock.time + TIMING.backoffStartMs),
    });

    await clock.advance(TIMING.backoffStartMs);
    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", restarts: 0 });
  });

  it("treats a pre-spawn check that rejects as a crash and retries", async () => {
    const { clock, deps, supervisor } = createHarness();
    deps.probe.mockRejectedValueOnce(new Error("probe exploded"));

    await supervisor.apply([definition()]);
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      lastError: "probe exploded",
      nextRetryAt: iso(clock.time + TIMING.backoffStartMs),
    });

    await clock.advance(TIMING.backoffStartMs);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", restarts: 0 });
  });

  it("stops the process and retries when a health probe rejects", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const first = latest(world);
    deps.probe.mockRejectedValueOnce(new Error("probe exploded"));

    await clock.advance(TIMING.probeIntervalMs);
    expect(first.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      lastError: "probe exploded",
    });

    await clock.advance(TIMING.backoffStartMs);
    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", pid: 4001, restarts: 1 });
  });

  it("waits as blocked while a required path is missing and starts once it appears", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    world.existingPaths.add("/opt/uv");
    await supervisor.apply([definition({ requires: ["/opt/uv", "/opt/serena"] })]);

    expect(deps.pathExists).toHaveBeenCalledWith("/opt/serena");
    expect(deps.probe).not.toHaveBeenCalled();
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(await statusOf(supervisor)).toMatchObject({
      state: "blocked",
      pid: null,
      lastError: "Required path missing: /opt/serena",
      nextRetryAt: null,
    });

    await clock.advance(TIMING.probeIntervalMs);
    expect(deps.pathExists).toHaveBeenCalledTimes(4);
    expect(deps.spawn).not.toHaveBeenCalled();

    world.existingPaths.add("/opt/serena");
    await clock.advance(TIMING.probeIntervalMs);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", restarts: 0 });
  });

  it("does not respawn a crashed server while a required path is missing", async () => {
    const harness = createHarness();
    const { clock, world, deps, supervisor } = harness;
    world.existingPaths.add("/opt/serena");
    await supervisor.apply([definition({ requires: ["/opt/serena"] })]);
    await clock.advance(TIMING.startupProbeMs);

    world.existingPaths.delete("/opt/serena");
    await crashNow(harness);
    await clock.advance(TIMING.backoffStartMs);

    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "blocked",
      lastError: "Required path missing: /opt/serena",
    });
  });

  it("adopts a server that already answers on its port and takes over when it goes away", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    world.externalPorts.add(8932);
    await supervisor.apply([definition()]);

    expect(deps.spawn).not.toHaveBeenCalled();
    expect(await statusOf(supervisor)).toMatchObject({
      state: "external",
      pid: null,
      startedAt: null,
      rssBytes: null,
    });
    expect(deps.readRss).not.toHaveBeenCalled();

    await clock.advance(TIMING.probeIntervalMs);
    expect(deps.probe).toHaveBeenCalledTimes(2);
    expect((await statusOf(supervisor)).state).toBe("external");

    world.externalPorts.delete(8932);
    await clock.advance(TIMING.probeIntervalMs);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", pid: 4000, restarts: 0 });
  });

  it("keeps a disabled server stopped until it is enabled", async () => {
    const { deps, supervisor } = createHarness();
    await supervisor.apply([definition({ enabled: false })]);

    expect(deps.probe).not.toHaveBeenCalled();
    expect(deps.spawn).not.toHaveBeenCalled();
    expect(await statusOf(supervisor)).toMatchObject({ state: "disabled", pid: null });

    await supervisor.apply([definition()]);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", restarts: 0 });
  });

  it("apply leaves unchanged servers alone, restarts changed ones and stops removed or disabled ones", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([
      definition({ id: "a", label: "A", port: 8931 }),
      definition({ id: "b", label: "B", port: 8933 }),
    ]);
    await clock.advance(TIMING.startupProbeMs);
    const [firstA, firstB] = world.processes;

    await supervisor.apply([
      definition({ id: "a", label: "A", port: 8931 }),
      definition({ id: "b", label: "B", port: 8933 }),
    ]);
    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(firstA.stop).not.toHaveBeenCalled();

    const changedA = definition({ id: "a", label: "A", port: 8931, command: "npx a --v2" });
    await supervisor.apply([
      changedA,
      definition({ id: "b", label: "B", port: 8933, enabled: false }),
    ]);
    expect(firstA.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(firstB.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(deps.spawn).toHaveBeenCalledTimes(3);
    expect(deps.spawn).toHaveBeenLastCalledWith(changedA, expect.any(Function));
    expect(await supervisor.status()).toMatchObject([
      { id: "a", state: "starting", pid: 4002, restarts: 1 },
      { id: "b", state: "disabled", pid: null },
    ]);

    await supervisor.apply([]);
    expect(latest(world, "a").stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(await supervisor.status()).toEqual([]);
  });

  it("apply updates label, healthPath and env key order in place without a restart", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([definition({ env: { A: "1", B: "2" } })]);
    await clock.advance(TIMING.startupProbeMs);
    const first = latest(world);

    const relabelled = definition({
      label: "Context 7",
      healthPath: "/health",
      env: { B: "2", A: "1" },
    });
    await supervisor.apply([relabelled]);
    expect(first.stop).not.toHaveBeenCalled();
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({
      label: "Context 7",
      state: "healthy",
      pid: 4000,
    });

    await clock.advance(TIMING.probeIntervalMs);
    expect(deps.probe).toHaveBeenLastCalledWith(relabelled);
  });

  it("apply waits for a removed server to stop before starting one on the same port", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const old = latest(world);
    const finishStop = holdStop(old);

    const renaming = supervisor.apply([definition({ id: "ctx2" })]);
    await flush();
    expect(old.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(deps.probe).toHaveBeenCalledTimes(2);
    expect(deps.spawn).toHaveBeenCalledTimes(1);

    old.exit({ code: null, signal: "SIGTERM" });
    finishStop();
    await renaming;

    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(await supervisor.status()).toMatchObject([
      { id: "ctx2", state: "starting", pid: 4001, restarts: 0 },
    ]);
  });

  it("restart(id) stops the server, respawns it at once and counts the restart", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const first = latest(world);

    await supervisor.restart("ctx");

    expect(first.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "starting",
      pid: 4001,
      restarts: 1,
      startedAt: iso(clock.time),
    });
  });

  it("restart(id) does not adopt its own process that still answers after stop() resolves", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const old = latest(world);
    // stop() resolves while the process keeps running and answering on the port.
    old.stop.mockResolvedValueOnce(undefined);

    await supervisor.restart("ctx");
    expect(old.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    expect(deps.spawn).toHaveBeenCalledTimes(1);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      pid: null,
      lastError: "Port 8932 still in use after stop",
      nextRetryAt: iso(clock.time + TIMING.backoffStartMs),
    });

    old.exit({ code: null, signal: "SIGTERM" });
    await clock.advance(TIMING.backoffStartMs);
    expect(deps.spawn).toHaveBeenCalledTimes(2);
    expect(await statusOf(supervisor)).toMatchObject({ state: "starting", pid: 4001, restarts: 1 });
  });

  it("does not count the exit that restart(id) causes as a crash", async () => {
    const { clock, world, supervisor } = createHarness();
    await supervisor.apply([definition()]);
    await clock.advance(TIMING.startupProbeMs);
    const old = latest(world);
    const finishStop = holdStop(old);

    const restarting = supervisor.restart("ctx");
    await flush();
    // The server exits with an error code while restart(id) still waits on stop().
    old.exit({ code: 1, signal: null });
    await flush();
    finishStop();
    await restarting;

    expect(await statusOf(supervisor)).toMatchObject({
      state: "starting",
      pid: 4001,
      restarts: 1,
      lastError: null,
      nextRetryAt: null,
    });
  });

  it("restart(id) clears a failing server's crash history", async () => {
    const harness = createHarness();
    const { clock, supervisor } = harness;
    await supervisor.apply([definition()]);
    for (let crash = 1; crash < TIMING.crashLimit; crash += 1) await crashAndRetry(harness);
    await crashNow(harness);
    expect((await statusOf(supervisor)).state).toBe("failing");

    await supervisor.restart("ctx");
    expect(await statusOf(supervisor)).toMatchObject({
      state: "starting",
      lastError: null,
      nextRetryAt: null,
    });

    await crashNow(harness);
    expect(await statusOf(supervisor)).toMatchObject({
      state: "backoff",
      nextRetryAt: iso(clock.time + TIMING.backoffStartMs),
    });
  });

  it("restart(id) refuses unknown, external and disabled servers", async () => {
    const { world, deps, supervisor } = createHarness();
    world.externalPorts.add(8931);
    await supervisor.apply([
      definition({ id: "ext", port: 8931 }),
      definition({ id: "off", port: 8933, enabled: false }),
    ]);

    await expect(supervisor.restart("nope")).rejects.toMatchObject({
      name: "RestartRefusedError",
      serverId: "nope",
      reason: "unknown",
      message: 'Server "nope" is not defined',
    });
    await expect(supervisor.restart("ext")).rejects.toMatchObject({
      serverId: "ext",
      reason: "external",
      message: 'Server "ext" is external: Paseo did not start it, so it cannot restart it',
    });
    await expect(supervisor.restart("off")).rejects.toMatchObject({
      serverId: "off",
      reason: "disabled",
      message: 'Server "off" is disabled: enable it to start it',
    });
    expect(deps.spawn).not.toHaveBeenCalled();
  });

  it("stopAll shortens running stops and stops every owned group at once", async () => {
    const { clock, world, deps, supervisor } = createHarness();
    world.externalPorts.add(8931);
    await supervisor.apply([
      definition({ id: "ext", port: 8931 }),
      definition({ id: "a", port: 8932 }),
      definition({ id: "b", port: 8933 }),
      definition({ id: "c", port: 8934 }),
    ]);
    await clock.advance(TIMING.startupProbeMs);
    const [a, b, c] = world.processes;
    // restart("a") waits on a stop with the 5 s grace.
    const finishRestart = holdStop(a);
    const restarting = supervisor.restart("a");
    await flush();
    expect(a.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);
    // Two failed probes start a kill of b that also waits on a stop with the 5 s grace.
    const finishKill = holdStop(b);
    b.answering = false;
    await clock.advance(2 * TIMING.probeIntervalMs);
    expect(b.stop).toHaveBeenCalledWith(TIMING.stopGraceMs);

    // Before its first await, stopAll calls stop() again on the two pending stops, which brings
    // their SIGKILL forward, and once on c.
    const stopping = supervisor.stopAll();
    expect(a.stop).toHaveBeenCalledTimes(2);
    expect(a.stop).toHaveBeenLastCalledWith(TIMING.shutdownGraceMs);
    expect(b.stop).toHaveBeenCalledTimes(2);
    expect(b.stop).toHaveBeenLastCalledWith(TIMING.shutdownGraceMs);
    expect(c.stop).toHaveBeenCalledTimes(1);
    expect(c.stop).toHaveBeenCalledWith(TIMING.shutdownGraceMs);
    // It does not wait for the queued restart.
    await stopping;
    finishRestart();
    finishKill();
    await restarting;
    await flush();

    expect(clock.pending()).toBe(0);
    expect(deps.spawn).toHaveBeenCalledTimes(3);
    expect((await statusOf(supervisor, "ext")).state).toBe("external");
    await supervisor.apply([definition({ id: "d", port: 8935 })]);
    await clock.advance(TIMING.failingRetryMs);
    expect(deps.spawn).toHaveBeenCalledTimes(3);
    expect(deps.probe).toHaveBeenCalledTimes(13);
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/supervisor.test.ts --bail=1`
Expected: FAIL. The suite does not load because `./supervisor.js` does not exist yet (Vitest reports that it cannot resolve or find `./supervisor.js`), so no tests run.

- [ ] **Step 3: Implement the supervisor.** Create `plugins/shared-mcp/server/supervisor.ts`:

```ts
import type { ServerStatus } from "../shared/rpc.js";
import type { ServerDefinition } from "../shared/settings.js";
import type { ProbeResult } from "./probe.js";
import { LogRing, type ExitInfo, type RunningProcess } from "./process-runner.js";

export interface SupervisorDeps {
  now(): number;
  setTimer(fn: () => void, ms: number): () => void;
  spawn(def: ServerDefinition, onLine: (line: string) => void): RunningProcess;
  probe(def: ServerDefinition): Promise<ProbeResult>;
  pathExists(path: string): Promise<boolean>;
  readRss(pgid: number): Promise<number | null>;
}

export const TIMING = {
  probeIntervalMs: 30_000,
  probeTimeoutMs: 5_000,
  failedProbesBeforeRestart: 2,
  startupProbeMs: 1_000,
  startupTimeoutMs: 120_000,
  backoffStartMs: 2_000,
  backoffMaxMs: 60_000,
  backoffResetAfterHealthyMs: 600_000,
  crashWindowMs: 600_000,
  crashLimit: 5,
  failingRetryMs: 300_000,
  stopGraceMs: 5_000,
  // The daemon waits 2 s for an in-process plugin's cleanup (SOFT_SHUTDOWN_TIMEOUT_MS). stop(g) can
  // take g + 1 s when a setsid'd child whose parent exited holds the pipes: the process-runner
  // measurement was 1,858 ms for stop(800) and 2,565 ms for stop(1_500).
  shutdownGraceMs: 800,
} as const;

type ServerState = ServerStatus["state"];

export type RestartRefusal = "unknown" | "external" | "disabled";

const REFUSALS: Record<RestartRefusal, string> = {
  unknown: "is not defined",
  external: "is external: Paseo did not start it, so it cannot restart it",
  disabled: "is disabled: enable it to start it",
};

export class RestartRefusedError extends Error {
  readonly serverId: string;
  readonly reason: RestartRefusal;

  constructor(serverId: string, reason: RestartRefusal) {
    super(`Server "${serverId}" ${REFUSALS[reason]}`);
    this.name = "RestartRefusedError";
    this.serverId = serverId;
    this.reason = reason;
  }
}

interface ServerEntry {
  def: ServerDefinition;
  state: ServerState;
  child: RunningProcess | null;
  // Set when Paseo's own process is stopped or exits. The next pre-spawn probe can still reach
  // that process while it shuts down, so an answer then must not adopt the port as "external".
  stoppedOwnChild: boolean;
  startedAt: number | null;
  healthySince: number | null;
  nextRetryAt: number | null;
  lastError: string | null;
  spawns: number;
  failedProbes: number;
  crashes: number[];
  backoffMs: number;
  // Bumped when the entry is stopped, replaced or restarted. An async step that began under an
  // older epoch drops its result instead of acting on a server that has moved on.
  epoch: number;
  cancelTimer: (() => void) | null;
  log: LogRing;
}

export class Supervisor {
  private entries = new Map<string, ServerEntry>();
  // Groups whose stop() has not settled. An entry lets go of its process before stopping it, so
  // this is the only place stopAll() can still find them.
  private stopping = new Set<RunningProcess>();
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly deps: SupervisorDeps) {}

  apply(defs: ServerDefinition[]): Promise<void> {
    return this.serialize(() => this.reconcile(defs));
  }

  restart(id: string): Promise<void> {
    return this.serialize(() => this.restartNow(id));
  }

  status(): Promise<ServerStatus[]> {
    const entries = [...this.entries.values()];
    return Promise.all(entries.map((entry) => this.toStatus(entry)));
  }

  // Every group gets stop(shutdownGraceMs) before the first await, because the daemon gives plugin
  // cleanup 2 s. A group that a restart, a kill or apply() is already stopping with stopGraceMs
  // gets a second call, which brings its SIGKILL forward. stopAll() skips the queue so a slow
  // apply() cannot hold shutdown back.
  async stopAll(): Promise<void> {
    this.stopped = true;
    const inFlight = [...this.stopping].map((child) => child.stop(TIMING.shutdownGraceMs));
    const owned = [...this.entries.values()].map((entry) =>
      this.stopEntry(entry, TIMING.shutdownGraceMs),
    );
    await Promise.all([...inFlight, ...owned]);
  }

  // A failed call rejects for its own caller; later calls still run.
  private serialize(work: () => Promise<void>): Promise<void> {
    const result = this.queue.then(work);
    this.queue = result.catch(() => undefined);
    return result;
  }

  // A new or changed server can reuse the port of one that is still stopping, so every stop
  // finishes before anything starts.
  private async reconcile(defs: ServerDefinition[]): Promise<void> {
    const previous = this.entries;
    this.entries = new Map();
    const stops: Promise<void>[] = [];
    const starts: ServerEntry[] = [];
    for (const def of defs) {
      const existing = previous.get(def.id);
      const entry = existing ?? createEntry(def);
      this.entries.set(def.id, entry);
      if (existing === undefined) {
        starts.push(entry);
      } else if (needsRestart(existing.def, def)) {
        resetFailures(entry);
        stops.push(this.stopEntry(entry, TIMING.stopGraceMs));
        starts.push(entry);
      }
      entry.def = def;
    }
    for (const [id, entry] of previous) {
      if (!this.entries.has(id)) stops.push(this.stopEntry(entry, TIMING.stopGraceMs));
    }
    await Promise.all(stops);
    await Promise.all(starts.map((entry) => this.start(entry)));
  }

  private async restartNow(id: string): Promise<void> {
    const entry = this.entries.get(id);
    if (entry === undefined) throw new RestartRefusedError(id, "unknown");
    if (entry.state === "external" || entry.state === "disabled") {
      throw new RestartRefusedError(id, entry.state);
    }
    resetFailures(entry);
    await this.stopEntry(entry, TIMING.stopGraceMs);
    await this.start(entry);
  }

  private async start(entry: ServerEntry): Promise<void> {
    entry.state = entry.def.enabled ? "starting" : "disabled";
    if (entry.def.enabled) await this.run(entry, () => this.launch(entry));
  }

  private async launch(entry: ServerEntry): Promise<void> {
    const epoch = entry.epoch;
    entry.nextRetryAt = null;
    const missing = await this.findMissingPath(entry.def.requires);
    if (!this.isCurrent(entry, epoch)) return;
    if (missing !== null) {
      this.block(entry, missing);
      return;
    }
    const probe = await this.deps.probe(entry.def);
    if (!this.isCurrent(entry, epoch)) return;
    const afterOwnStop = entry.stoppedOwnChild;
    entry.stoppedOwnChild = false;
    if (!probe.ok) this.spawn(entry);
    else if (afterOwnStop) this.portStillHeld(entry);
    else this.adopt(entry);
  }

  private async findMissingPath(paths: string[]): Promise<string | null> {
    for (const path of paths) {
      if (!(await this.deps.pathExists(path))) return path;
    }
    return null;
  }

  private block(entry: ServerEntry, path: string): void {
    entry.state = "blocked";
    entry.lastError = `Required path missing: ${path}`;
    this.schedule(entry, TIMING.probeIntervalMs, () => this.launch(entry));
  }

  // Adopting the answer would leave Paseo's own process running as "external", where restart()
  // and stopAll() never reach it. One backoff gives it time to finish shutting down.
  private portStillHeld(entry: ServerEntry): void {
    entry.lastError = `Port ${entry.def.port} still in use after stop`;
    this.retryLater(entry, "backoff", TIMING.backoffStartMs);
  }

  private adopt(entry: ServerEntry): void {
    entry.state = "external";
    this.schedule(entry, TIMING.probeIntervalMs, () => this.checkExternal(entry));
  }

  // launch() probes again before it spawns, so one missed probe does not start a second server.
  private async checkExternal(entry: ServerEntry): Promise<void> {
    const epoch = entry.epoch;
    const probe = await this.deps.probe(entry.def);
    if (!this.isCurrent(entry, epoch)) return;
    if (probe.ok) this.adopt(entry);
    else await this.launch(entry);
  }

  private spawn(entry: ServerEntry): void {
    let child: RunningProcess;
    try {
      child = this.deps.spawn(entry.def, (line) => entry.log.push(line));
    } catch (error) {
      // Opening the log file or the spawn itself can throw; retry it like any other crash.
      this.crash(entry, errorMessage(error));
      return;
    }
    const startedAt = this.deps.now();
    entry.child = child;
    entry.state = "starting";
    entry.startedAt = startedAt;
    entry.spawns += 1;
    void this.run(entry, () => this.watchExit(entry, child));
    const deadline = startedAt + TIMING.startupTimeoutMs;
    this.schedule(entry, TIMING.startupProbeMs, () => this.checkStartup(entry, deadline));
  }

  // exited resolves only after the runner has killed what the leader left running, so nothing is
  // left to stop, and the group id may already belong to another process. A stop the supervisor
  // started (restart, kill, apply, stopAll) has already let go of the child, so that exit is not a
  // crash.
  private async watchExit(entry: ServerEntry, child: RunningProcess): Promise<void> {
    const exit = await child.exited;
    if (entry.child !== child) return;
    this.invalidate(entry);
    entry.child = null;
    entry.stoppedOwnChild = true;
    this.crash(entry, describeExit(exit));
  }

  private async checkStartup(entry: ServerEntry, deadline: number): Promise<void> {
    const epoch = entry.epoch;
    const probe = await this.deps.probe(entry.def);
    if (!this.isCurrent(entry, epoch)) return;
    if (probe.ok) {
      this.markHealthy(entry);
      return;
    }
    if (this.deps.now() < deadline) {
      this.schedule(entry, TIMING.startupProbeMs, () => this.checkStartup(entry, deadline));
      return;
    }
    const seconds = TIMING.startupTimeoutMs / 1000;
    await this.kill(entry, `Not healthy within ${seconds} s: ${probe.error}`);
  }

  private markHealthy(entry: ServerEntry): void {
    entry.state = "healthy";
    entry.healthySince = this.deps.now();
    entry.failedProbes = 0;
    this.scheduleHealthCheck(entry);
  }

  private scheduleHealthCheck(entry: ServerEntry): void {
    this.schedule(entry, TIMING.probeIntervalMs, () => this.checkHealth(entry));
  }

  private async checkHealth(entry: ServerEntry): Promise<void> {
    const epoch = entry.epoch;
    const probe = await this.deps.probe(entry.def);
    if (!this.isCurrent(entry, epoch)) return;
    if (probe.ok) {
      entry.state = "healthy";
      entry.failedProbes = 0;
      this.scheduleHealthCheck(entry);
      return;
    }
    entry.failedProbes += 1;
    if (entry.failedProbes >= TIMING.failedProbesBeforeRestart) {
      const reason = `Health check failed ${entry.failedProbes} times in a row: ${probe.error}`;
      await this.kill(entry, reason);
      return;
    }
    entry.state = "unhealthy";
    entry.lastError = `Health check failed: ${probe.error}`;
    this.scheduleHealthCheck(entry);
  }

  // A forced restart counts as a crash, so a server that keeps hanging backs off and reaches
  // "failing" the same way as one that keeps exiting.
  private async kill(entry: ServerEntry, reason: string): Promise<void> {
    const epoch = entry.epoch;
    entry.state = "unhealthy";
    await this.stopProcess(entry, TIMING.stopGraceMs);
    if (this.isCurrent(entry, epoch)) this.crash(entry, reason);
  }

  private crash(entry: ServerEntry, reason: string): void {
    const now = this.deps.now();
    const healthyLongEnough =
      entry.healthySince !== null && now - entry.healthySince >= TIMING.backoffResetAfterHealthyMs;
    if (healthyLongEnough) entry.backoffMs = TIMING.backoffStartMs;
    entry.startedAt = null;
    entry.healthySince = null;
    entry.lastError = reason;
    entry.crashes = entry.crashes.filter((at) => now - at < TIMING.crashWindowMs);
    entry.crashes.push(now);
    if (entry.crashes.length >= TIMING.crashLimit) {
      this.retryLater(entry, "failing", TIMING.failingRetryMs);
      return;
    }
    const delayMs = entry.backoffMs;
    entry.backoffMs = Math.min(delayMs * 2, TIMING.backoffMaxMs);
    this.retryLater(entry, "backoff", delayMs);
  }

  private retryLater(entry: ServerEntry, state: "backoff" | "failing", delayMs: number): void {
    entry.state = state;
    entry.nextRetryAt = this.deps.now() + delayMs;
    this.schedule(entry, delayMs, () => this.launch(entry));
  }

  private async stopEntry(entry: ServerEntry, graceMs: number): Promise<void> {
    this.invalidate(entry);
    entry.startedAt = null;
    entry.healthySince = null;
    entry.nextRetryAt = null;
    await this.stopProcess(entry, graceMs);
  }

  // Lets go of the entry's process, then stops its whole group. stop() is not expected to reject,
  // but a rejection here would either exit the daemon or leave the server with no process and no
  // retry, so it becomes lastError instead.
  private async stopProcess(entry: ServerEntry, graceMs: number): Promise<void> {
    const child = entry.child;
    if (child === null) return;
    entry.child = null;
    entry.stoppedOwnChild = true;
    this.stopping.add(child);
    try {
      await child.stop(graceMs);
    } catch (error) {
      entry.lastError = `Stopping process group ${child.pid} failed: ${errorMessage(error)}`;
    } finally {
      this.stopping.delete(child);
    }
  }

  private invalidate(entry: ServerEntry): void {
    entry.epoch += 1;
    entry.cancelTimer?.();
    entry.cancelTimer = null;
  }

  private isCurrent(entry: ServerEntry, epoch: number): boolean {
    return !this.stopped && entry.epoch === epoch;
  }

  private schedule(entry: ServerEntry, delayMs: number, step: () => Promise<void>): void {
    entry.cancelTimer?.();
    entry.cancelTimer = this.deps.setTimer(() => {
      entry.cancelTimer = null;
      void this.run(entry, step);
    }, delayMs);
  }

  // This plugin runs inside the daemon, where an unhandled rejection exits the whole process. A
  // step that rejects counts as a crash, so the server backs off and retries instead of stalling
  // with no process and no timer. kill() never rejects, so neither does run().
  private async run(entry: ServerEntry, step: () => Promise<void>): Promise<void> {
    const epoch = entry.epoch;
    try {
      await step();
    } catch (error) {
      if (this.isCurrent(entry, epoch)) await this.kill(entry, errorMessage(error));
    }
  }

  private async toStatus(entry: ServerEntry): Promise<ServerStatus> {
    const pid = entry.child === null ? null : entry.child.pid;
    // A spawned server leads its own process group, so its pid is also the group id.
    const rssBytes = pid === null ? null : await this.deps.readRss(pid);
    const restarts = Math.max(entry.spawns - 1, 0);
    return {
      id: entry.def.id,
      label: entry.def.label,
      port: entry.def.port,
      state: entry.state,
      pid,
      startedAt: toIso(entry.startedAt),
      restarts,
      rssBytes,
      lastError: entry.lastError,
      nextRetryAt: toIso(entry.nextRetryAt),
      logTail: entry.log.lines(),
    };
  }
}

function createEntry(def: ServerDefinition): ServerEntry {
  return {
    def,
    state: def.enabled ? "starting" : "disabled",
    child: null,
    stoppedOwnChild: false,
    startedAt: null,
    healthySince: null,
    nextRetryAt: null,
    lastError: null,
    spawns: 0,
    failedProbes: 0,
    crashes: [],
    backoffMs: TIMING.backoffStartMs,
    epoch: 0,
    cancelTimer: null,
    log: new LogRing(),
  };
}

function resetFailures(entry: ServerEntry): void {
  entry.crashes = [];
  entry.backoffMs = TIMING.backoffStartMs;
  entry.lastError = null;
}

// Only fields that shape the process restart it. label and healthPath are read where they are
// used, and agentEnv only names the agents' variable, so editing those never drops the agents
// connected to the server.
function needsRestart(a: ServerDefinition, b: ServerDefinition): boolean {
  return (
    a.command !== b.command ||
    a.cwd !== b.cwd ||
    a.port !== b.port ||
    a.enabled !== b.enabled ||
    a.bearerToken?.serverEnv !== b.bearerToken?.serverEnv ||
    !sameEnv(a.env, b.env) ||
    !sameList(a.requires, b.requires)
  );
}

// Key order does not matter: the settings editor can reorder keys without changing the process.
function sameEnv(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((key) => b[key] === a[key]);
}

function sameList(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((item, index) => item === b[index]);
}

function describeExit(exit: ExitInfo): string {
  if (exit.signal !== null) return `Killed by ${exit.signal}`;
  return `Exited with code ${exit.code}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toIso(ms: number | null): string | null {
  return ms === null ? null : new Date(ms).toISOString();
}
```

- [ ] **Step 4: Run the test and confirm it passes.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/supervisor.test.ts --bail=1`
Expected: PASS, `Test Files 1 passed (1)`, `Tests 24 passed (24)`.

- [ ] **Step 5: Lint both files.**

Run: `cd /workspace/utils/paseo && npm run lint -- plugins/shared-mcp/server/supervisor.ts plugins/shared-mcp/server/supervisor.test.ts`
Expected: `Found 0 warnings and 0 errors.` This includes complexity 20, max-nested-callbacks 3, no-shadow, no-map-spread and consistent-type-definitions.

- [ ] **Step 6: Format both files and check them.**

Run: `cd /workspace/utils/paseo && npm run format:files -- plugins/shared-mcp/server/supervisor.ts plugins/shared-mcp/server/supervisor.test.ts && npm run format:check:files -- plugins/shared-mcp/server/supervisor.ts plugins/shared-mcp/server/supervisor.test.ts`
Expected: the code above is already oxfmt-formatted, so nothing changes, and the check prints `All matched files use the correct format.`

- [ ] **Step 7: Typecheck the plugins workspace.**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded`
Expected: exit 0 with no errors. `supervisor.ts` is checked here. `supervisor.test.ts` is not, because `plugins/tsconfig.json` excludes `**/*.test.ts`.

- [ ] **Step 8: Commit locally with the fork identity.** Stage only these two paths: the working tree has other uncommitted changes. The lefthook pre-commit hook runs format and lint on the staged files plus an unscoped `npm run typecheck` over every workspace, so the commit runs under the heavy-command lock. Do not add `LEFTHOOK=0`: skipping the hook is the user's call, and the user has not approved it for this plan. If a hook job fails, stop and report it rather than bypassing the hook. Do not push.

```bash
git -C /workspace/utils/paseo add plugins/shared-mcp/server/supervisor.ts plugins/shared-mcp/server/supervisor.test.ts
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): shared-mcp supervisor state machine"
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
```

Expected: the hook's format, lint and typecheck jobs pass, the commit is created, and the last command prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.

### Task 7: Server wiring: settings, RPCs, agent env hook, cleanup

**Files:**

- Create: `plugins/shared-mcp/server/plugin.ts`
- Modify: `plugins/shared-mcp/index.server.ts`. Task 1 created it as a stub that only calls `server.registerSettings(sharedMcpSettings)` and returns a no-op cleanup (exact content in Step 4). This task replaces the whole file. Task 1 also put `"shared-mcp"` in `builtinPlugins`, so nothing in `packages/server` changes here.
- Test: `plugins/shared-mcp/server/plugin.test.ts` (new: unit tests against a fake `PluginServerContext` and a real temp home, plus one Linux-only integration test with real processes)
- Test: `packages/server/src/server/plugins/builtin/index.test.ts` (existing, unchanged: it compiles every listed built-in's server entry, which now pulls in every `server/` module)

**Interfaces:**

Consumes (from the SDK and the revised Tasks 1 to 6):

- `@getpaseo/plugin/server`: `PluginServerContext`, `PluginSessionOpenRequest`, `PluginSettings<Schema>` (`read(): Promise<PluginSettingsState<Schema>>`, `subscribe(listener): PluginCleanup`), `PluginSettingsState<Schema>` (`{ status: "ready"; revision; values } | { status: "invalid"; revision; error }`). `server.addHook("agent.open.before", (payload: { request: PluginSessionOpenRequest }, context: PluginHookContext) => Promise<PluginSessionOpenRequest | void>): () => void`. `server.handle(contract, handler)` picks its RPC overload because `restartRpc` and `statusRpc` have no `event` schema.
- `@getpaseo/plugin`: `type RpcOutput<Contract>`.
- Task 1, `shared/settings.ts`: `sharedMcpSettings` (settings id `"servers"`), `type ServerDefinition`. Task 1, `shared/rpc.ts`: `statusRpc` (`shared-mcp.status.request`, output `{ servers: ServerStatus[] }`), `restartRpc` (`shared-mcp.restart.request`, input `{ id: string }`, output `{ ok: boolean; error: string | null }`), `type ServerStatus`.
- Task 2, `server/procfs.ts`: `readProcessGroupRss(pgid: number, procRoot = "/proc"): Promise<number | null>`. It rejects on a filesystem error such as EACCES, and Task 6's `status()` calls `deps.readRss` without a catch, so the `readRss` dep built here maps a rejection to `null` and logs it.
- Task 3, `server/probe.ts`: `interface ProbeTarget { port: number; healthPath: string; bearerToken?: string }`, `type ProbeResult`, `interface ProbeOptions { timeoutMs?: number }`, `probeMcp(target: ProbeTarget, options?: ProbeOptions): Promise<ProbeResult>` (never rejects).
- Task 4, `server/process-runner.ts`: `interface ExitInfo`, `interface RunningProcess { pid; exited; stop(graceMs?) }`, `spawnServer(spec: SpawnSpec): RunningProcess` (throws when the server cannot start; the supervisor counts that as a crash), `reclaimOrphan(pidFile: string): Promise<boolean>`. `reclaimOrphan` reclaims only when the daemon that wrote the pid file is dead, so the dist test and the lifecycle e2e can start this built-in against the live `PASEO_HOME`. It rejects with `Removed unreadable pid file <path>` and on other file errors, so every call here is caught and logged. Pid files are written to `<id>.pid.tmp` and renamed, so the reclaim scan matches `*.pid` only.
- Task 5, `server/paths.ts`: `sharedMcpHome(env: NodeJS.ProcessEnv = process.env): string`. `server/token-store.ts`: `loadOrCreateToken(file: string): Promise<string>`, which can throw `InvalidTokenFileError`. One cached promise is shared by every caller in the daemon.
- Task 6, `server/supervisor.ts`: `interface SupervisorDeps { now(); setTimer(fn, ms): () => void; spawn(def, onLine): RunningProcess; probe(def): Promise<ProbeResult>; pathExists(path): Promise<boolean>; readRss(pgid): Promise<number | null> }`, `TIMING`, `class Supervisor { constructor(deps); apply(defs): Promise<void>; restart(id): Promise<void>; status(): Promise<ServerStatus[]>; stopAll(): Promise<void> }`. `restart()` throws `RestartRefusedError` with a message such as `Server "nope" is not defined`.

The tests rely on this Task 6 behaviour:

- `apply()` probes the port and spawns inside the call, and resolves without waiting for health. Timers drive only later probes, backoff and crash restarts.
- `apply()` compares definitions by value. A definition that is deep-equal to the running one, even as a new object parsed from a later save, leaves its server alone.
- `restart()` stops, then spawns at once, and its error names an unknown id.
- `stopAll()` may be called twice and while an `apply()` is running. It calls `stop()` at most once per `RunningProcess`: once a `stopAll()` has resolved, a second one does nothing for a process the first one stopped.
- A disabled definition reports `"disabled"`.
- The methods live on the prototype, where the tests spy on `apply` and `restart`.

Produces:

- `export interface SharedMcpOptions { server: PluginServerContext; home: string; deps?: Partial<SupervisorDeps> }`
- `export function createSharedMcp(options: SharedMcpOptions): () => Promise<void>` in `server/plugin.ts`
- `export function startTimer(fn: () => void, ms: number): () => void` in `server/plugin.ts`: the real `SupervisorDeps.setTimer`. It `unref()`s the timer and catches both a synchronous throw and a rejected promise from `fn`, logging `shared-mcp: supervisor timer failed`. Either one escaping would reach `daemon-worker.ts:373-381`, which calls `process.exit(1)`.
- `export default function contribute(server: PluginServerContext): () => Promise<void>` in `index.server.ts`
- Runtime surface, all registered before `createSharedMcp` returns: `settings.servers.read|write|reset` (through `registerSettings`), `shared-mcp.status.request`, `shared-mcp.restart.request`, and one `agent.open.before` hook for the plugin's whole lifetime.
- The hook adds `{ [bearerToken.agentEnv]: token }` for every definition that has `bearerToken`, enabled or not, on top of `request.env`. It returns `undefined` when no definition has one or the token cannot be loaded, and it never throws.
- The restart RPC runs in the same queue as the settings applies. It answers `{ ok: false, error }` for a refused id, and `{ ok: false, error: "shared-mcp is stopping" }` once cleanup has begun.
- A probe carries the bearer token only while the plugin holds that server's process: from the spawn until the supervisor calls `stop()` on it or its `exited` settles. That is the span in which Task 6's entry has a `child`. The pre-spawn probe, every probe of an `external` server and the first probe after a stop go without it, so a local program that holds a bearer server's port never receives the token. mcp-gitlab answers an initialize without the token with 401, which the health rule counts as alive, so adopting a port and the "still in use after stop" check behave as before.
- Files under `<home>`: `token` (once some definition has `bearerToken`, enabled or not, created by the first agent open or apply that needs it), `logs/<id>.log` and `run/<id>.pid` (only once a definition is enabled). An empty server list writes nothing.

Limits to carry into the docs task:

- An agent gets the token env only when its session opens (create, resume or refresh). The hook never changes presence after startup, so nothing reloads agents that are already running. That is why a disabled bearer server still hands out its token: the Servers screen's enable switch then works for agents opened while it was off.
- Adding a brand-new bearer definition, or renaming an `agentEnv`, reaches only agents opened afterwards. Agents already running get 401 from that server until their session reloads for another reason.

Every red and green state below, except the bearer scoping in the next paragraph, was replayed on this container's Node v22.23.3 with a stand-in for vitest (an esbuild bundle using `@vitest/expect` and `@vitest/spy` 4.1.7, with the two `vi.mock` wrappers rebuilt as esbuild modules) against the code that the revised Tasks 1 to 6 write. The green run passed 22 of 22 with no unhandled rejection, three runs in a row. Each new test also failed against `plugin.ts` with its fix reverted. Lint and format were checked on copies outside the checkout with the repo's `.oxlintrc.json` and `.oxfmtrc.json`.

The bearer scoping was added in review, after that replay, and has not been run: `holdWhileRunning`, the `probe` dep and `createDeps`'s `overrides` in `plugin.ts`, plus the test "sends the token only to a server process it started and still holds" and its `startRecordingServer` helper. It was checked by reading against Task 3's `probeMcp`, Task 4's `RunningProcess` and Task 6's `launch`, `spawn`, `stopProcess` and `watchExit`. Against the replayed `plugin.ts`, which sends the token on every probe, that test fails with `Bearer <token>` in all three recorded slots. Step 5 now expects 23 tests.

- [ ] **Step 1: Write the failing test**

Create `plugins/shared-mcp/server/plugin.test.ts`:

```ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginRpcContract } from "@getpaseo/plugin";
import type {
  PluginServerContext,
  PluginSessionOpenRequest,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest";
import type { input as ZodInput, output as ZodOutput } from "zod";
import contribute from "../index.server.js";
import { restartRpc, statusRpc, type ServerStatus } from "../shared/rpc.js";
import { sharedMcpSettings, type ServerDefinition } from "../shared/settings.js";
import { createSharedMcp, startTimer } from "./plugin.js";
import type { ProbeResult } from "./probe.js";
import { reclaimOrphan, type ExitInfo, type RunningProcess } from "./process-runner.js";
import { readProcessGroupRss } from "./procfs.js";
import { Supervisor, type SupervisorDeps } from "./supervisor.js";

// Wrapped, not replaced: the real functions run unless a test overrides one. process-runner.test.ts
// and procfs.test.ts cover what the real ones do.
vi.mock("./process-runner.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./process-runner.js")>();
  return { ...actual, reclaimOrphan: vi.fn(actual.reclaimOrphan) };
});
vi.mock("./procfs.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./procfs.js")>();
  return { ...actual, readProcessGroupRss: vi.fn(actual.readProcessGroupRss) };
});

type SettingsState = PluginSettingsState<typeof sharedMcpSettings.schema>;
type SettingsListener = (state: SettingsState) => void | Promise<void>;
type RpcHandler = (input: unknown, context: object) => unknown;
type OpenHook = (
  payload: { request: PluginSessionOpenRequest },
  context: { signal: AbortSignal },
) => Promise<PluginSessionOpenRequest | undefined>;

interface Deferred<Value> {
  promise: Promise<Value>;
  resolve(value: Value): void;
}

interface FakeServer {
  context: PluginServerContext;
  settingsIds: string[];
  listeners: Set<SettingsListener>;
  hooks: Map<string, OpenHook>;
  rpcs: Map<string, RpcHandler>;
  resolveRead(state: SettingsState): void;
  emit(state: SettingsState): void;
  call<Contract extends PluginRpcContract>(
    contract: Contract,
    input: ZodInput<Contract["input"]>,
  ): Promise<ZodOutput<Contract["output"]>>;
  openAgent(request: PluginSessionOpenRequest): Promise<PluginSessionOpenRequest | undefined>;
}

interface FakeProcess extends RunningProcess {
  stopCalls: number;
}

interface Spawned {
  def: ServerDefinition;
  proc: FakeProcess;
}

interface FakeDeps {
  deps: Partial<SupervisorDeps>;
  spawned: Spawned[];
}

interface HeldProbe {
  calls: number;
  probe: SupervisorDeps["probe"];
  answer(result: ProbeResult): void;
}

interface RecordingServer {
  port: number;
  authorizations: (string | undefined)[];
  close(): Promise<void>;
}

// Above Linux pid_max, so a group signal sent by mistake can never reach a real process.
const FAKE_PID_BASE = 2_000_000_000;
const GITLAB_BEARER = { serverEnv: "STREAMABLE_HTTP_AUTH_TOKEN", agentEnv: "SHARED_MCP_TOKEN" };
const ALPHA_BEARER = { serverEnv: "ALPHA_SERVER_TOKEN", agentEnv: "ALPHA_TOKEN" };
const BETA_BEARER = { serverEnv: "BETA_SERVER_TOKEN", agentEnv: "BETA_TOKEN" };
const OFF_BEARER = { serverEnv: "OFF_SERVER_TOKEN", agentEnv: "OFF_TOKEN" };
const ECHO_BEARER = { serverEnv: "ECHO_TOKEN", agentEnv: "ECHO_AGENT_TOKEN" };
const REFUSED: ProbeResult = { ok: false, error: "connect ECONNREFUSED" };
const THROWN = new Error("thrown by a timer callback");
const REJECTED = new Error("rejected by a timer callback");
// Answers every POST like an MCP initialize and logs whether the probe sent the plugin's token.
const ECHO_SERVER = `
const http = require("node:http");
let sessions = 0;
http
  .createServer((request, response) => {
    request.resume();
    if (request.method === "DELETE") {
      response.writeHead(200);
      response.end();
      return;
    }
    const expected = "Bearer " + process.env.ECHO_TOKEN;
    console.log(request.headers.authorization === expected ? "auth ok" : "auth missing");
    sessions += 1;
    const headers = { "content-type": "application/json", "mcp-session-id": "s" + sessions };
    response.writeHead(200, headers);
    response.end(JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }));
  })
  .listen(Number(process.env.ECHO_PORT), "127.0.0.1");
`;

function noop(): void {}

function throwNow(): void {
  throw THROWN;
}

async function rejectLater(): Promise<void> {
  throw REJECTED;
}

function nextMacrotask(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function deferred<Value>(): Deferred<Value> {
  let settle: (value: Value) => void = noop;
  const promise = new Promise<Value>((resolve) => {
    settle = resolve;
  });
  return {
    promise,
    resolve(value) {
      settle(value);
    },
  };
}

function ready(servers: object[]): SettingsState {
  const values = sharedMcpSettings.schema.parse({ servers });
  return { status: "ready", revision: "test", values };
}

function serverDef(id: string, port: number, extra: object = {}): object {
  return { id, label: id, command: `serve-${id}`, port, ...extra };
}

function openRequest(env: Record<string, string> = {}): PluginSessionOpenRequest {
  return {
    agentId: "agent-1",
    workspaceId: null,
    provider: "claude",
    cwd: "/workspace",
    reason: "create",
    purpose: "interactive",
    title: null,
    labels: {},
    tools: [],
    env,
    mcpServers: {},
  };
}

function readToken(home: string): string {
  return readFileSync(join(home, "token"), "utf8").trim();
}

function fakeProcess(pid: number): FakeProcess {
  const exit = deferred<ExitInfo>();
  const proc: FakeProcess = {
    pid,
    exited: exit.promise,
    stopCalls: 0,
    async stop() {
      proc.stopCalls += 1;
      exit.resolve({ code: null, signal: "SIGTERM" });
      await exit.promise;
    },
  };
  return proc;
}

async function refuse(): Promise<ProbeResult> {
  return REFUSED;
}

function fakeDeps(probe: SupervisorDeps["probe"] = refuse): FakeDeps {
  const spawned: Spawned[] = [];
  return {
    spawned,
    deps: {
      // Timers never fire, so the state after apply() holds still while the test looks at it.
      setTimer: () => noop,
      spawn(def) {
        const proc = fakeProcess(FAKE_PID_BASE + spawned.length);
        spawned.push({ def, proc });
        return proc;
      },
      probe,
      pathExists: async () => true,
      readRss: async () => null,
    },
  };
}

function heldProbe(): HeldProbe {
  const pending = deferred<ProbeResult>();
  const held: HeldProbe = {
    calls: 0,
    probe() {
      held.calls += 1;
      return pending.promise;
    },
    answer: pending.resolve,
  };
  return held;
}

function spawnedIds(spawned: Spawned[]): string[] {
  return spawned.map((entry) => entry.def.id);
}

function isRunning(entry: Spawned): boolean {
  return entry.proc.stopCalls === 0;
}

function createFakeServer(initial?: SettingsState): FakeServer {
  const settingsIds: string[] = [];
  const listeners = new Set<SettingsListener>();
  const hooks = new Map<string, OpenHook>();
  const rpcs = new Map<string, RpcHandler>();
  const stored = deferred<SettingsState>();
  if (initial) stored.resolve(initial);
  const settings = {
    read: () => stored.promise,
    subscribe(listener: SettingsListener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  // Implements only what createSharedMcp calls.
  const context = {
    registerSettings(definition: { id: string }) {
      settingsIds.push(definition.id);
      return settings;
    },
    handle(contract: { name: string }, handler: RpcHandler) {
      rpcs.set(contract.name, handler);
    },
    addHook(name: string, handler: OpenHook) {
      hooks.set(name, handler);
      return () => {
        hooks.delete(name);
      };
    },
  } as unknown as PluginServerContext;
  return {
    context,
    settingsIds,
    listeners,
    hooks,
    rpcs,
    resolveRead: stored.resolve,
    emit(state) {
      for (const listener of listeners) void listener(state);
    },
    async call(contract, input) {
      const handler = rpcs.get(contract.name);
      if (handler === undefined) throw new Error(`No handler for ${contract.name}`);
      const output = await handler(contract.input.parse(input), {});
      return contract.output.parse(output);
    },
    openAgent(request) {
      const hook = hooks.get("agent.open.before");
      if (hook === undefined) throw new Error("No agent.open.before hook");
      return hook({ request: structuredClone(request) }, { signal: new AbortController().signal });
    },
  };
}

async function statusOf(server: FakeServer, id: string): Promise<ServerStatus | undefined> {
  const { servers } = await server.call(statusRpc, {});
  return servers.find((entry) => entry.id === id);
}

function waitForServer(
  server: FakeServer,
  id: string,
  accept: (status: ServerStatus) => boolean,
  timeout = 1_000,
): Promise<ServerStatus> {
  return vi.waitFor(
    async () => {
      const status = await statusOf(server, id);
      if (status === undefined || !accept(status)) {
        throw new Error(`${id} is not there yet: ${JSON.stringify(status)}`);
      }
      return status;
    },
    { timeout, interval: 50 },
  );
}

async function waitForLogLine(server: FakeServer, id: string, line: string): Promise<void> {
  await vi.waitFor(
    async () => {
      const status = await statusOf(server, id);
      expect(status?.logTail).toContain(line);
    },
    { timeout: 5_000, interval: 50 },
  );
}

function groupOf(status: ServerStatus): number {
  if (status.pid === null) throw new Error(`${status.id} has no pid`);
  return status.pid;
}

function isHealthy(status: ServerStatus): boolean {
  return status.state === "healthy";
}

function isRestarted(status: ServerStatus): boolean {
  return status.state === "healthy" && status.restarts === 1;
}

function isBlocked(status: ServerStatus): boolean {
  return status.state === "blocked";
}

async function freePort(): Promise<number> {
  const listener = createServer();
  await new Promise<void>((resolve) => {
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  await new Promise<void>((resolve) => {
    listener.close(() => resolve());
  });
  if (address === null || typeof address === "string") throw new Error("No TCP port assigned");
  return address.port;
}

// Records each request's Authorization header. The first answer is 503, which a probe counts as
// down, so the supervisor spawns. Every later one is 401, as mcp-gitlab answers a request without
// the token, and a probe counts that as alive.
async function startRecordingServer(): Promise<RecordingServer> {
  const authorizations: (string | undefined)[] = [];
  const listener = createHttpServer((request, response) => {
    request.resume();
    authorizations.push(request.headers.authorization);
    response.writeHead(authorizations.length === 1 ? 503 : 401);
    response.end();
  });
  await new Promise<void>((resolve) => {
    listener.listen(0, "127.0.0.1", resolve);
  });
  const address = listener.address();
  if (address === null || typeof address === "string") throw new Error("No TCP port assigned");
  return {
    port: address.port,
    authorizations,
    close() {
      return new Promise<void>((resolve) => {
        listener.close(() => resolve());
      });
    },
  };
}

describe("createSharedMcp", () => {
  let root: string;
  let home: string;
  let fake: FakeServer | null;
  let stop: (() => Promise<void>) | null;
  let apply: MockInstance<Supervisor["apply"]>;

  function start(initial: SettingsState | undefined, deps: Partial<SupervisorDeps>): FakeServer {
    const server = createFakeServer(initial);
    fake = server;
    stop = createSharedMcp({ server: server.context, home, deps });
    return server;
  }

  async function stopNow(): Promise<void> {
    const cleanup = stop;
    stop = null;
    await cleanup?.();
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "shared-mcp-"));
    home = join(root, "home");
    fake = null;
    stop = null;
    vi.mocked(reclaimOrphan).mockReset();
    vi.mocked(readProcessGroupRss).mockReset();
    apply = vi.spyOn(Supervisor.prototype, "apply");
  });

  afterEach(async () => {
    fake?.resolveRead(ready([]));
    await stopNow();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  });

  it("registers its settings, both RPCs and one agent.open.before hook before returning", () => {
    const server = start(undefined, fakeDeps().deps);
    expect(server.settingsIds).toEqual(["servers"]);
    expect([...server.rpcs.keys()]).toEqual([
      "shared-mcp.status.request",
      "shared-mcp.restart.request",
    ]);
    expect([...server.hooks.keys()]).toEqual(["agent.open.before"]);
  });

  it("starts the stored servers once the settings are read", async () => {
    const { deps, spawned } = fakeDeps();
    const stored = ready([serverDef("alpha", 18_101)]);
    const server = start(stored, deps);
    await vi.waitFor(() => expect(spawnedIds(spawned)).toEqual(["alpha"]));
    expect(apply).toHaveBeenCalledWith(stored.values.servers);
    expect(existsSync(join(home, "logs"))).toBe(true);
    expect(existsSync(join(home, "run"))).toBe(true);
    expect(await statusOf(server, "alpha")).toMatchObject({
      label: "alpha",
      port: 18_101,
      state: "starting",
      pid: FAKE_PID_BASE,
      restarts: 0,
    });
  });

  it("re-applies every saved settings state", async () => {
    const { deps, spawned } = fakeDeps();
    const alpha = serverDef("alpha", 18_101);
    const beta = serverDef("beta", 18_102);
    const server = start(ready([alpha]), deps);
    await vi.waitFor(() => expect(spawnedIds(spawned)).toEqual(["alpha"]));
    server.emit(ready([alpha, beta]));
    await vi.waitFor(() => expect(spawnedIds(spawned)).toEqual(["alpha", "beta"]));
    server.emit(ready([beta]));
    await vi.waitFor(() => expect(spawned[0].proc.stopCalls).toBe(1));
    server.emit(ready([{ ...beta, enabled: false }]));
    await vi.waitFor(() => expect(spawned[1].proc.stopCalls).toBe(1));
    expect(spawned).toHaveLength(2);
    expect(await statusOf(server, "beta")).toMatchObject({ state: "disabled" });
  });

  it("applies only the newest of several saves that arrive together", async () => {
    const server = start(undefined, fakeDeps().deps);
    server.emit(ready([serverDef("alpha", 18_101)]));
    server.emit(ready([serverDef("beta", 18_102)]));
    const newest = ready([serverDef("gamma", 18_103)]);
    server.emit(newest);
    await vi.waitFor(() => expect(apply).toHaveBeenCalled());
    server.resolveRead(ready([]));
    await stopNow();
    expect(apply.mock.calls).toEqual([[newest.values.servers]]);
  });

  it("keeps a save that lands before the stored settings are read", async () => {
    const server = start(undefined, fakeDeps().deps);
    const saved = ready([serverDef("beta", 18_102, { bearerToken: BETA_BEARER })]);
    server.emit(saved);
    server.resolveRead(ready([serverDef("alpha", 18_101, { bearerToken: ALPHA_BEARER })]));
    const request = openRequest();
    expect(await server.openAgent(request)).toEqual({
      ...request,
      env: { BETA_TOKEN: readToken(home) },
    });
    await vi.waitFor(() => expect(apply).toHaveBeenCalled());
    await stopNow();
    expect(apply.mock.calls).toEqual([[saved.values.servers]]);
  });

  it("keeps waiting for a valid save when the stored settings are invalid", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(noop);
    const server = start(
      { status: "invalid", revision: "bad", error: "Duplicate server port 8931" },
      fakeDeps().deps,
    );
    await server.openAgent(openRequest());
    expect(error).toHaveBeenCalledWith(
      "shared-mcp: settings are invalid: Duplicate server port 8931",
    );
    expect(apply).not.toHaveBeenCalled();
    const saved = ready([serverDef("alpha", 18_101)]);
    server.emit(saved);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(saved.values.servers));
  });

  it("reclaims every leftover pid file before the first apply", async () => {
    const run = join(home, "run");
    mkdirSync(run, { recursive: true });
    for (const name of ["alpha.pid", "beta.pid", "gamma.pid.tmp", "notes.txt"]) {
      writeFileSync(join(run, name), "");
    }
    const reclaimed = deferred<boolean>();
    vi.mocked(reclaimOrphan).mockReturnValue(reclaimed.promise);
    const server = start(ready([serverDef("alpha", 18_101)]), fakeDeps().deps);
    await vi.waitFor(() => expect(reclaimOrphan).toHaveBeenCalledTimes(2));
    expect(reclaimOrphan).toHaveBeenCalledWith(join(run, "alpha.pid"));
    expect(reclaimOrphan).toHaveBeenCalledWith(join(run, "beta.pid"));
    await server.openAgent(openRequest());
    expect(apply).not.toHaveBeenCalled();
    reclaimed.resolve(true);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
  });

  it("logs a pid file it cannot reclaim and still applies the settings", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(noop);
    const run = join(home, "run");
    mkdirSync(run, { recursive: true });
    writeFileSync(join(run, "alpha.pid"), "");
    const unreadable = new Error("Removed unreadable pid file");
    vi.mocked(reclaimOrphan).mockRejectedValue(unreadable);
    const stored = ready([serverDef("alpha", 18_101)]);
    start(stored, fakeDeps().deps);
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith(stored.values.servers));
    expect(error).toHaveBeenCalledWith(
      "shared-mcp: reclaiming an orphaned server failed",
      unreadable,
    );
  });

  it("adds the token to the launch env for every bearer server, enabled or not", async () => {
    const server = start(
      ready([
        serverDef("gitlab", 18_103, { bearerToken: GITLAB_BEARER }),
        serverDef("context7", 18_102),
        serverDef("off", 18_104, { enabled: false, bearerToken: OFF_BEARER }),
      ]),
      fakeDeps().deps,
    );
    const request = openRequest({ USER_SET: "1" });
    const opened = await server.openAgent(request);
    const token = readToken(home);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(opened).toEqual({
      ...request,
      env: { USER_SET: "1", SHARED_MCP_TOKEN: token, OFF_TOKEN: token },
    });
    expect(await server.openAgent(request)).toEqual(opened);
  });

  // An agent opened now still has the token when the Servers screen switches the server on.
  it("gives agents the token of a bearer server that is disabled", async () => {
    const server = start(
      ready([serverDef("off", 18_104, { enabled: false, bearerToken: OFF_BEARER })]),
      fakeDeps().deps,
    );
    const request = openRequest();
    expect(await server.openAgent(request)).toEqual({
      ...request,
      env: { OFF_TOKEN: readToken(home) },
    });
    expect(existsSync(join(home, "logs"))).toBe(false);
    expect(existsSync(join(home, "run"))).toBe(false);
  });

  it("leaves the request alone and writes no token without a bearer server", async () => {
    const server = start(
      ready([serverDef("context7", 18_102), serverDef("off", 18_104, { enabled: false })]),
      fakeDeps().deps,
    );
    expect(await server.openAgent(openRequest())).toBeUndefined();
    expect(existsSync(join(home, "token"))).toBe(false);
  });

  it("writes nothing under its home while the server list is empty", async () => {
    const server = start(ready([]), fakeDeps().deps);
    expect(await server.openAgent(openRequest())).toBeUndefined();
    await vi.waitFor(() => expect(apply).toHaveBeenCalledWith([]));
    expect(existsSync(home)).toBe(false);
  });

  it("still opens agents when the token cannot be stored", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(noop);
    writeFileSync(home, "a file where the home directory should be");
    const server = start(
      ready([serverDef("gitlab", 18_103, { bearerToken: GITLAB_BEARER })]),
      fakeDeps().deps,
    );
    expect(await server.openAgent(openRequest())).toBeUndefined();
    expect(error).toHaveBeenCalledWith("shared-mcp: token unavailable", expect.any(Error));
  });

  it("reports no RSS instead of failing the status RPC when /proc cannot be read", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(noop);
    const denied = new Error("EACCES: permission denied, scandir '/proc'");
    vi.mocked(readProcessGroupRss).mockRejectedValue(denied);
    const { deps, spawned } = fakeDeps();
    delete deps.readRss;
    const server = start(ready([serverDef("alpha", 18_101)]), deps);
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    expect(await statusOf(server, "alpha")).toMatchObject({ pid: FAKE_PID_BASE, rssBytes: null });
    expect(readProcessGroupRss).toHaveBeenCalledWith(FAKE_PID_BASE);
    expect(error).toHaveBeenCalledWith("shared-mcp: reading RSS failed", denied);
  });

  it("restarts a server through the restart RPC and reports an unknown id", async () => {
    const { deps, spawned } = fakeDeps();
    const server = start(ready([serverDef("alpha", 18_101)]), deps);
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    expect(await server.call(restartRpc, { id: "alpha" })).toEqual({ ok: true, error: null });
    expect(spawned).toHaveLength(2);
    expect(spawned[0].proc.stopCalls).toBe(1);
    expect(await statusOf(server, "alpha")).toMatchObject({
      pid: FAKE_PID_BASE + 1,
      restarts: 1,
    });
    expect(await server.call(restartRpc, { id: "nope" })).toEqual({
      ok: false,
      error: expect.stringContaining("nope"),
    });
  });

  it("queues a restart behind an apply that is still running", async () => {
    const held = heldProbe();
    const { deps, spawned } = fakeDeps(held.probe);
    const restart = vi.spyOn(Supervisor.prototype, "restart");
    const server = start(ready([serverDef("alpha", 18_101)]), deps);
    await vi.waitFor(() => expect(held.calls).toBe(1));
    const restarting = server.call(restartRpc, { id: "alpha" });
    await nextMacrotask();
    // Read before the probe answers, but asserted after, so a failure cannot leave apply() hanging.
    const restartsWhileApplying = restart.mock.calls.length;
    held.answer(REFUSED);
    expect(await restarting).toEqual({ ok: true, error: null });
    expect(restartsWhileApplying).toBe(0);
    expect(restart).toHaveBeenCalledTimes(1);
    expect(spawnedIds(spawned)).toEqual(["alpha", "alpha"]);
    expect(spawned[0].proc.stopCalls).toBe(1);
  });

  it("refuses a restart once cleanup has begun", async () => {
    const { deps, spawned } = fakeDeps();
    const server = start(ready([serverDef("alpha", 18_101)]), deps);
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    const stopping = stopNow();
    expect(await server.call(restartRpc, { id: "alpha" })).toEqual({
      ok: false,
      error: "shared-mcp is stopping",
    });
    await stopping;
    expect(spawned).toHaveLength(1);
    expect(spawned[0].proc.stopCalls).toBe(1);
  });

  it("cleanup stops what it started, removes its hook and stops listening for saves", async () => {
    const { deps, spawned } = fakeDeps();
    const server = start(ready([serverDef("alpha", 18_101)]), deps);
    await vi.waitFor(() => expect(spawned).toHaveLength(1));
    await stopNow();
    expect(spawned[0].proc.stopCalls).toBe(1);
    expect(server.hooks.size).toBe(0);
    expect(server.listeners.size).toBe(0);
  });

  it("cleanup also stops a server that an apply in flight starts", async () => {
    const held = heldProbe();
    const { deps, spawned } = fakeDeps(held.probe);
    start(ready([serverDef("alpha", 18_101)]), deps);
    await vi.waitFor(() => expect(held.calls).toBe(1));
    const stopping = stopNow();
    held.answer(REFUSED);
    await stopping;
    expect(spawned.filter(isRunning)).toEqual([]);
  });

  it("sends the token only to a server process it started and still holds", async () => {
    const recorder = await startRecordingServer();
    try {
      const { deps } = fakeDeps();
      // The real probe and timers run against a fake process.
      delete deps.probe;
      delete deps.setTimer;
      const gitlab = serverDef("gitlab", recorder.port, { bearerToken: GITLAB_BEARER });
      const server = start(ready([gitlab]), deps);
      await waitForServer(server, "gitlab", isHealthy, 5_000);
      expect(await server.call(restartRpc, { id: "gitlab" })).toEqual({ ok: true, error: null });
      // Before the spawn, while the process runs, and after the restart has stopped it.
      const bearer = `Bearer ${readToken(home)}`;
      expect(recorder.authorizations).toEqual([undefined, bearer, undefined]);
      expect(await statusOf(server, "gitlab")).toMatchObject({
        state: "backoff",
        lastError: `Port ${recorder.port} still in use after stop`,
      });
    } finally {
      await stopNow();
      await recorder.close();
    }
  }, 10_000);

  it("keeps its token, log and pid-file directories under $PASEO_HOME/shared-mcp", async () => {
    vi.stubEnv("PASEO_HOME", root);
    const entryHome = join(root, "shared-mcp");
    const missing = join(root, "missing");
    const gitlab = serverDef("gitlab", await freePort(), {
      requires: [missing],
      bearerToken: GITLAB_BEARER,
    });
    const server = createFakeServer(ready([gitlab]));
    fake = server;
    stop = contribute(server.context);
    const request = openRequest();
    expect(await server.openAgent(request)).toEqual({
      ...request,
      env: { SHARED_MCP_TOKEN: readToken(entryHome) },
    });
    const blocked = await waitForServer(server, "gitlab", isBlocked, 5_000);
    expect(blocked.lastError).toContain(missing);
    expect(existsSync(join(entryHome, "logs"))).toBe(true);
    expect(existsSync(join(entryHome, "run"))).toBe(true);
  }, 15_000);

  it.runIf(process.platform === "linux")(
    "keeps a real server healthy and restarts it after its process group is killed",
    async () => {
      writeFileSync(join(root, "echo-server.cjs"), ECHO_SERVER);
      const port = await freePort();
      const echo = serverDef("echo", port, {
        // exec makes node the direct child, so the test process reaps it and the group empties.
        command: `exec ${JSON.stringify(process.execPath)} echo-server.cjs`,
        cwd: root,
        env: { ECHO_PORT: String(port) },
        bearerToken: ECHO_BEARER,
      });
      const server = start(ready([echo]), {});
      const first = await waitForServer(server, "echo", isHealthy, 15_000);
      expect(first.restarts).toBe(0);
      await waitForLogLine(server, "echo", "auth ok");
      process.kill(-groupOf(first), "SIGKILL");
      const second = await waitForServer(server, "echo", isRestarted, 15_000);
      const secondGroup = groupOf(second);
      expect(secondGroup).not.toBe(groupOf(first));
      await stopNow();
      expect(() => process.kill(-secondGroup, 0)).toThrow(/ESRCH/);
    },
    30_000,
  );
});

describe("startTimer", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs a callback that throws or rejects instead of letting it reach the daemon", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(noop);
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      startTimer(throwNow, 0);
      startTimer(rejectLater, 0);
      await vi.waitFor(() => expect(error).toHaveBeenCalledTimes(2));
      await nextMacrotask();
      expect(error.mock.calls).toEqual([
        ["shared-mcp: supervisor timer failed", THROWN],
        ["shared-mcp: supervisor timer failed", REJECTED],
      ]);
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/plugin.test.ts --bail=1`

Expected: FAIL before any test runs. `../index.server.js` still loads (Task 1's stub), but `./plugin.js` does not exist. Vitest's module runner turns Vite's "Failed to load url ... Does the file exist?" into `Error: Cannot find module './plugin.js' imported from …/plugins/shared-mcp/server/plugin.test.ts`, and the summary reads `Test Files  1 failed (1)` and `Tests  no tests`.

- [ ] **Step 3: Write `plugins/shared-mcp/server/plugin.ts`**

```ts
import { access, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";
import type { RpcOutput } from "@getpaseo/plugin";
import type {
  PluginServerContext,
  PluginSessionOpenRequest,
  PluginSettings,
  PluginSettingsState,
} from "@getpaseo/plugin/server";
import { restartRpc, statusRpc } from "../shared/rpc.js";
import { sharedMcpSettings, type ServerDefinition } from "../shared/settings.js";
import { probeMcp, type ProbeTarget } from "./probe.js";
import { readProcessGroupRss } from "./procfs.js";
import { reclaimOrphan, spawnServer, type RunningProcess } from "./process-runner.js";
import { Supervisor, TIMING, type SupervisorDeps } from "./supervisor.js";
import { loadOrCreateToken } from "./token-store.js";

type SettingsSchema = typeof sharedMcpSettings.schema;
type SettingsState = PluginSettingsState<SettingsSchema>;
type RestartResult = RpcOutput<typeof restartRpc>;

export interface SharedMcpOptions {
  server: PluginServerContext;
  home: string;
  deps?: Partial<SupervisorDeps>;
}

interface TokenSource {
  current(): string | null;
  load(): Promise<string | null>;
}

interface SharedMcp {
  readonly home: string;
  readonly token: TokenSource;
  readonly supervisor: Supervisor;
  current: ServerDefinition[];
  pending: ServerDefinition[] | null;
  applying: Promise<void>;
  stopped: boolean;
}

/**
 * Registers everything the runtime snapshots at "ready" (settings, both RPCs, the agent hook)
 * before returning. Reading settings, reclaiming orphans and starting servers run afterwards.
 */
export function createSharedMcp(options: SharedMcpOptions): () => Promise<void> {
  const { server, home } = options;
  const token = createTokenSource(home);
  const mcp: SharedMcp = {
    home,
    token,
    supervisor: new Supervisor(createDeps(home, token, options.deps)),
    current: [],
    pending: null,
    // Applies and restarts queue behind the reclaim, so a group left by a dead daemon frees its
    // port first.
    applying: reclaimOrphans(join(home, "run")),
    stopped: false,
  };
  const settings = server.registerSettings(sharedMcpSettings);
  let superseded = false;
  // subscribe() never replays the stored value: read() supplies it unless a save arrived first.
  const unsubscribe = settings.subscribe((state) => {
    superseded = true;
    acceptSettings(mcp, state);
  });
  const initialRead = readStoredSettings(settings, (state) => {
    if (!superseded) acceptSettings(mcp, state);
  });
  // One hook for the plugin's lifetime: adding or removing it reloads every agent's session.
  const removeHook = server.addHook("agent.open.before", async ({ request }) => {
    await initialRead;
    return addAgentTokens(mcp, request);
  });
  server.handle(statusRpc, async () => ({ servers: await mcp.supervisor.status() }));
  server.handle(restartRpc, ({ id }) => restartServer(mcp, id));
  return async function cleanup(): Promise<void> {
    mcp.stopped = true;
    unsubscribe();
    removeHook();
    // The daemon waits only about 2 s for an in-process plugin: signal every group first.
    await mcp.supervisor.stopAll();
    await initialRead;
    await mcp.applying;
    // An apply that was already running may have started a server after the first stopAll.
    await mcp.supervisor.stopAll();
  };
}

function acceptSettings(mcp: SharedMcp, state: SettingsState): void {
  if (state.status === "invalid") {
    // Running servers stay up; the Definitions screen shows the same error.
    console.error(`shared-mcp: settings are invalid: ${state.error}`);
    return;
  }
  mcp.current = state.values.servers;
  mcp.pending = state.values.servers;
  mcp.applying = mcp.applying.then(() => applyPending(mcp));
}

// Listeners are not awaited or serialized, so saves queue here and only the newest applies.
async function applyPending(mcp: SharedMcp): Promise<void> {
  const defs = mcp.pending;
  mcp.pending = null;
  if (defs === null) return;
  if (mcp.stopped) return;
  try {
    await prepareHome(mcp, defs);
    if (mcp.stopped) return;
    await mcp.supervisor.apply(defs);
  } catch (error) {
    // The plugin runs inside the daemon, which exits on an unhandled rejection.
    console.error("shared-mcp: applying servers failed", error);
  }
}

// Logs and pid files appear only once something will run; an empty list writes nothing.
async function prepareHome(mcp: SharedMcp, defs: ServerDefinition[]): Promise<void> {
  if (!defs.some((def) => def.enabled)) return;
  await mkdir(join(mcp.home, "logs"), { recursive: true, mode: 0o700 });
  await mkdir(join(mcp.home, "run"), { recursive: true, mode: 0o700 });
  // spawn() is synchronous, so the token has to be in memory before the supervisor starts.
  if (hasBearerServer(defs)) await mcp.token.load();
}

// Queued with the applies, so a Restart click cannot interleave with a settings save.
async function restartServer(mcp: SharedMcp, id: string): Promise<RestartResult> {
  const run = mcp.applying.then(() => restartUnlessStopped(mcp, id));
  mcp.applying = run.catch(() => undefined);
  try {
    await run;
    return { ok: true, error: null };
  } catch (error) {
    // A refusal comes back as data, so the screen shows it without the RPC error prefix.
    return { ok: false, error: describeError(error) };
  }
}

async function restartUnlessStopped(mcp: SharedMcp, id: string): Promise<void> {
  // Past this point cleanup's last stopAll may already have run and would miss the new process.
  if (mcp.stopped) throw new Error("shared-mcp is stopping");
  await mcp.supervisor.restart(id);
}

// Disabled servers count too. Agents get their env only when they open, and the hook never
// changes presence, so an agent opened while a server is disabled must already hold its token
// when the server is switched back on.
async function addAgentTokens(
  mcp: SharedMcp,
  request: PluginSessionOpenRequest,
): Promise<PluginSessionOpenRequest | undefined> {
  if (!hasBearerServer(mcp.current)) return undefined;
  const token = await mcp.token.load();
  if (token === null) return undefined;
  // The daemon replaces env with the returned map, so the launch env is carried over.
  const env = { ...request.env, ...agentTokenEnv(mcp.current, token) };
  return { ...request, env };
}

function hasBearerServer(defs: ServerDefinition[]): boolean {
  return defs.some((def) => def.bearerToken !== undefined);
}

function agentTokenEnv(defs: ServerDefinition[], token: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const def of defs) {
    if (def.bearerToken) env[def.bearerToken.agentEnv] = token;
  }
  return env;
}

function serverEnv(def: ServerDefinition, token: string | null): Record<string, string> {
  if (def.bearerToken === undefined || token === null) return def.env;
  return { ...def.env, [def.bearerToken.serverEnv]: token };
}

// bearer is null unless the plugin holds the process on this port (createDeps).
function probeTarget(def: ServerDefinition, bearer: string | null): ProbeTarget {
  const target: ProbeTarget = { port: def.port, healthPath: def.healthPath };
  if (def.bearerToken !== undefined && bearer !== null) target.bearerToken = bearer;
  return target;
}

async function readStoredSettings(
  settings: PluginSettings<SettingsSchema>,
  accept: (state: SettingsState) => void,
): Promise<void> {
  try {
    accept(await settings.read());
  } catch (error) {
    console.error("shared-mcp: reading settings failed", error);
  }
}

async function reclaimOrphans(runDirectory: string): Promise<void> {
  const pidFiles = await listPidFiles(runDirectory);
  const reclaims = pidFiles.map((name) => reclaimOrphan(join(runDirectory, name)));
  const results = await Promise.allSettled(reclaims);
  for (const result of results) {
    if (result.status === "rejected") {
      console.error("shared-mcp: reclaiming an orphaned server failed", result.reason);
    }
  }
}

// Only "*.pid": a "<id>.pid.tmp" left by a crash mid-write names no group.
async function listPidFiles(runDirectory: string): Promise<string[]> {
  try {
    const names = await readdir(runDirectory);
    return names.filter((name) => name.endsWith(".pid"));
  } catch (error) {
    if (!isMissing(error)) console.error("shared-mcp: listing pid files failed", error);
    return [];
  }
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function createTokenSource(home: string): TokenSource {
  let value: string | null = null;
  let loading: Promise<string | null> | null = null;
  async function read(): Promise<string | null> {
    try {
      await mkdir(home, { recursive: true, mode: 0o700 });
      value = await loadOrCreateToken(join(home, "token"));
      return value;
    } catch (error) {
      // Agents keep opening; the servers that need the token report their own failure.
      console.error("shared-mcp: token unavailable", error);
      loading = null;
      return null;
    }
  }
  return {
    current() {
      return value;
    },
    load() {
      loading ??= read();
      return loading;
    },
  };
}

function createDeps(
  home: string,
  token: TokenSource,
  overrides: Partial<SupervisorDeps> = {},
): SupervisorDeps {
  // Ids whose process this plugin spawned and has not let go of, the span in which the supervisor's
  // entry holds a child. Only their probes carry the token: whatever else answers on the port, an
  // "external" server or a process still there after a stop, may be any local program. A bearer
  // server answers a probe without the token with 401, which still counts as alive.
  const owned = new Map<string, RunningProcess>();
  const deps: SupervisorDeps = {
    now() {
      return Date.now();
    },
    setTimer: startTimer,
    spawn(def, onLine) {
      return spawnServer({
        command: def.command,
        cwd: def.cwd,
        env: serverEnv(def, token.current()),
        logFile: join(home, "logs", `${def.id}.log`),
        pidFile: join(home, "run", `${def.id}.pid`),
        onLine,
      });
    },
    probe(def) {
      const bearer = owned.has(def.id) ? token.current() : null;
      return probeMcp(probeTarget(def, bearer), { timeoutMs: TIMING.probeTimeoutMs });
    },
    pathExists,
    async readRss(pgid) {
      try {
        return await readProcessGroupRss(pgid);
      } catch (error) {
        // procfs.ts rejects on errors such as EACCES. One unreadable /proc must not fail status().
        console.error("shared-mcp: reading RSS failed", error);
        return null;
      }
    },
    ...overrides,
  };
  const startProcess = deps.spawn;
  // Wrapped after the overrides, so a test's fake process is tracked like a spawned one.
  deps.spawn = (def, onLine) => holdWhileRunning(owned, def.id, startProcess(def, onLine));
  return deps;
}

// The supervisor lets go of a process just before it calls stop() and once exited settles, so the
// id leaves `owned` at the same two points. An old process that exits after its replacement was
// spawned leaves the replacement's entry alone.
function holdWhileRunning(
  owned: Map<string, RunningProcess>,
  id: string,
  proc: RunningProcess,
): RunningProcess {
  owned.set(id, proc);
  function release(): void {
    if (owned.get(id) === proc) owned.delete(id);
  }
  // exited never rejects (process-runner.ts), and release cannot throw.
  void proc.exited.then(release);
  return {
    pid: proc.pid,
    exited: proc.exited,
    stop(graceMs) {
      release();
      return proc.stop(graceMs);
    },
  };
}

/** The real SupervisorDeps.setTimer. */
export function startTimer(fn: () => void, ms: number): () => void {
  const timer = setTimeout(() => runGuarded(fn), ms);
  // A pending probe must not keep the daemon, or a test process, alive.
  timer.unref();
  return () => clearTimeout(timer);
}

// A throw from a timer callback is an uncaught exception, and a rejection from an async one is an
// unhandled rejection. The daemon exits on either, so both are caught here.
function runGuarded(fn: () => void): void {
  try {
    const result: unknown = fn();
    if (result instanceof Promise) result.catch(reportTimerFailure);
  } catch (error) {
    reportTimerFailure(error);
  }
}

function reportTimerFailure(error: unknown): void {
  console.error("shared-mcp: supervisor timer failed", error);
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

- [ ] **Step 4: Replace `plugins/shared-mcp/index.server.ts`**

Task 1 left this file reading exactly:

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { sharedMcpSettings } from "./shared/settings.js";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(sharedMcpSettings);
  return () => {};
}
```

Replace the whole file with the version below. `createSharedMcp` now calls `registerSettings` itself, and the settings RPC names must be unique, so the stub's own `registerSettings` call has to go: keeping it would make `contribute` throw on the duplicate `settings.servers.*` methods.

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { sharedMcpHome } from "./server/paths.js";
import { createSharedMcp } from "./server/plugin.js";

export default function contribute(server: PluginServerContext) {
  return createSharedMcp({ server, home: sharedMcpHome() });
}
```

- [ ] **Step 5: Run the test and confirm it passes**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/server/plugin.test.ts --bail=1`

Expected: PASS, `Test Files  1 passed (1)` and `Tests  23 passed (23)` on Linux. The real-process test takes about 4 to 6 s (4.1 to 4.2 s in the replay): one startup probe after 1 s, then a 2 s backoff and another startup probe after the kill. The bearer test takes about 1 s, for its one startup probe. On other platforms the real-process test is skipped (`22 passed | 1 skipped (23)`). If the bearer test fails, its message shows the three recorded `Authorization` values: `Bearer` in the first or third slot means a probe of a process the plugin does not hold carried the token, and `undefined` in the second means the startup probe of its own process lost it. If only the real-process test fails, read its `lastError` and `logTail` in the failure message before touching `plugin.ts`; the cause is usually in `process-runner.ts`, `probe.ts` or `supervisor.ts`.

- [ ] **Step 6: Run the built-in registry test**

Run: `cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts --bail=1`

Expected: PASS, 4 tests. "listed built-ins resolve to matching manifests and compile" now bundles `plugins/shared-mcp/index.server.ts` through `server/plugin.ts` and every other `server/` module with the esbuild boundary checks, which allow only `@getpaseo/plugin/*`, `zod` and `node:*` in server code. `client` is still `null`, because `index.client.tsx` arrives in Task 8.

- [ ] **Step 7: Format the three files**

Run: `cd /workspace/utils/paseo && npm run format:files -- plugins/shared-mcp/index.server.ts plugins/shared-mcp/server/plugin.ts plugins/shared-mcp/server/plugin.test.ts && npm run format:check:files -- plugins/shared-mcp/index.server.ts plugins/shared-mcp/server/plugin.ts plugins/shared-mcp/server/plugin.test.ts`

Expected: oxfmt leaves all three files unchanged, and the check exits 0. Every line, the `ECHO_SERVER` template included, is within 100 columns.

- [ ] **Step 8: Lint the three files**

Run: `cd /workspace/utils/paseo && npm run lint -- plugins/shared-mcp/index.server.ts plugins/shared-mcp/server/plugin.ts plugins/shared-mcp/server/plugin.test.ts`

Expected: `Found 0 warnings and 0 errors.` The rules most likely to fire are max-nested-callbacks 3 (the test helpers sit at module scope for that reason), promise/always-return (both inline `.then` callbacks return the next step, and `holdWhileRunning` passes the named `release`) and no-shadow.

- [ ] **Step 9: Confirm the workspaces hold only this task's changes**

Run: `git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages`

The pathspec covers every npm workspace (the root `package.json` lists only paths under `plugins` and `packages`), which is all that Step 10's typecheck and the pre-commit hook's `npm run typecheck` read. The plan itself, `docs/superpowers/plans/2026-11-06-shared-mcp-plugin.md`, sits untracked under `docs/` and is left out on purpose: no check reads it, and Step 11 commits by pathspec.

Expected, exactly:

```
 M plugins/shared-mcp/index.server.ts
?? plugins/shared-mcp/server/plugin.test.ts
?? plugins/shared-mcp/server/plugin.ts
```

If any other path is listed, stop. Another task's files are in the workspaces, and Steps 10 and 11 would check them too. Finish and commit that task first, then come back to this step.

- [ ] **Step 10: Typecheck the builtin-plugins workspace**

Run: `cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded`

Expected: exit 0 with no diagnostics. This checks `plugin.ts` and `index.server.ts`; `plugins/tsconfig.json` excludes `*.test.ts`, so the test file is checked only by lint and by running it.

- [ ] **Step 11: Commit with the fork identity (local only, never push)**

Stage the three paths and commit them by pathspec, so nothing another session staged lands in this commit. The lefthook pre-commit hook runs format check and lint on the staged files and then a full `npm run typecheck` over every workspace, so the whole commit holds the heavy lock. The `env` overrides apply to this command only. Do not add `LEFTHOOK=0` on your own: skipping the hook is the user's call, asked once for the whole plan.

```bash
git -C /workspace/utils/paseo add plugins/shared-mcp/index.server.ts plugins/shared-mcp/server/plugin.ts plugins/shared-mcp/server/plugin.test.ts
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): wire the shared MCP plugin into the daemon" -- plugins/shared-mcp/index.server.ts plugins/shared-mcp/server/plugin.ts plugins/shared-mcp/server/plugin.test.ts
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
git -C /workspace/utils/paseo status --short --untracked-files=all -- plugins packages
```

Expected:

- The hook's format, lint and typecheck jobs pass.
- The commit reports `3 files changed`.
- The `log` command prints `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.
- The `status` command, scoped to the workspaces as in Step 9, prints nothing. An unscoped `git status` still lists the untracked plan file under `docs/superpowers/plans/`; that is expected.

### Task 8: Client settings screens

**Files:**

- Create: `plugins/shared-mcp/index.client.tsx`
- Create: `plugins/shared-mcp/client/format.ts`
- Create: `plugins/shared-mcp/client/definitions.ts`
- Create: `plugins/shared-mcp/client/styles.ts`
- Create: `plugins/shared-mcp/client/servers-screen.tsx`
- Create: `plugins/shared-mcp/client/definitions-screen.tsx`
- Test: `plugins/shared-mcp/client/format.test.ts`
- Test: `plugins/shared-mcp/client/definitions.test.ts`
- Verify only (unchanged): `packages/server/src/server/plugins/builtin/index.test.ts` (compiles every listed built-in's client entry)

**Interfaces:**

Consumes (from earlier tasks, exact contract names):

- `plugins/shared-mcp/shared/settings.ts`: `export const sharedMcpSettings` (`defineSettings({ id: "servers", scope: "host", version: 1, schema: z.object({ servers: z.array(ServerDefinitionSchema).default([]) }).superRefine(/* duplicate ids and ports */) })`) and `export type ServerDefinition = z.output<typeof ServerDefinitionSchema>`.
- `plugins/shared-mcp/shared/rpc.ts`: `export const statusRpc` (input `z.object({})`, output `{ servers: ServerStatus[] }`), `export const restartRpc` (input `{ id: string }`, output `{ ok: boolean; error: string | null }`), `export type ServerStatus` (`id, label, port, state, pid, startedAt, restarts, rssBytes, lastError, nextRetryAt, logTail`).
- `plugins/shared-mcp/paseo-plugin.json`, `plugins/shared-mcp/index.server.ts`, and `"shared-mcp"` in `builtinPlugins` (`packages/server/src/server/plugins/builtin/index.ts`), so the builtin compile test covers this client entry.
- SDK (`@getpaseo/plugin/client`): `PluginClientContext.addSettingsScreen(contribution: { id: string; title: PluginText; icon: PluginIcon; Component: ComponentType<PluginSurfaceProps> }): PluginCleanup`; `addCommandCenterItem({ id, title, icon, keywords?, context: "global", onSelect(context: PluginGlobalCommandContext) })`; `useRpc(contract): (input) => Promise<output>`; `useSettings(definition): SettingsState<Schema>` with `save(values, revision): Promise<boolean>` (never throws), `reset(): Promise<boolean>`, `reload(): Promise<void>`, `saving`, `saveError`. `@getpaseo/plugin/client/ui`: `SettingsSection`, `SettingsCard`, `SettingsSwitch`, `SettingsAction`, `TextInput` (`SettingsRowProps` = `{ label: string; hint?: string; error?: string | null }`, `SettingsActionProps` adds `{ actionLabel: string; onPress(): void; disabled?: boolean }`). `@tanstack/react-query`: `useQuery`, `useMutation`, `useQueryClient`. `react-native`: `Text`, `View`, `Platform`.

Produces:

- `plugins/shared-mcp/index.client.tsx`: `export default function contribute(client: PluginClientContext): () => void` registering settings screens `"servers"` (title "Servers", icon "Server") and `"definitions"` (title "Definitions", icon "FileBraces"), plus global Command Center item `"open-servers"` that calls `openSettings("servers")`.
- `client/servers-screen.tsx`: `export function ServersScreen({ theme }: PluginSurfaceProps)`.
- `client/definitions-screen.tsx`: `export function DefinitionsScreen({ theme }: PluginSurfaceProps)`.
- `client/format.ts`: `export function formatBytes(bytes: number): string`, `export function formatUptime(ms: number): string`, `export function describeServer(server: ServerStatus, now: number): string`, `export function formatLogTail(lines: readonly string[], limit: number): string`.
- `client/definitions.ts`: `export type SharedMcpSettingsValues`, `export type ParsedDefinitions = { ok: true; values: SharedMcpSettingsValues } | { ok: false; error: string }`, `export function formatDefinitions(servers: readonly ServerDefinition[]): string`, `export function parseDefinitions(text: string): ParsedDefinitions`, `export function withServerEnabled(servers: readonly ServerDefinition[], id: string, enabled: boolean): ServerDefinition[]`.
- `client/styles.ts`: `export function useScreenStyles(theme: PluginTheme)`, `export type ScreenStyles = ReturnType<typeof useScreenStyles>`.

- [ ] **Step 1: Confirm the earlier tasks left what this task consumes**

Run:

```bash
cd /workspace/utils/paseo && ls plugins/shared-mcp/paseo-plugin.json plugins/shared-mcp/index.server.ts plugins/shared-mcp/shared/settings.ts plugins/shared-mcp/shared/rpc.ts && grep -n '"shared-mcp"' packages/server/src/server/plugins/builtin/index.ts && grep -nE 'export (const|type) (sharedMcpSettings|ServerDefinition|statusRpc|restartRpc|ServerStatus)\b' plugins/shared-mcp/shared/settings.ts plugins/shared-mcp/shared/rpc.ts
```

Expected: the four paths, one `  "shared-mcp",` line from `builtin/index.ts`, and five export lines (`sharedMcpSettings`, `ServerDefinition`, `ServerStatus`, `statusRpc`, `restartRpc`). If anything is missing, stop: an earlier task is not done.

- [ ] **Step 2: Write the failing test for the presentational helpers**

There is no vitest config under `plugins/`; vitest walks up to `/workspace/utils/paseo/vitest.config.ts`, whose default include picks up `plugins/**/client/*.test.ts`, so the helpers live in `client/`. Globals are off, so import from `"vitest"`. Create `plugins/shared-mcp/client/format.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { describeServer, formatBytes, formatLogTail, formatUptime } from "./format.js";

const healthy = {
  id: "context7",
  label: "Context7",
  port: 8932,
  state: "healthy",
  pid: 4321,
  startedAt: "2026-11-06T10:00:00.000Z",
  restarts: 1,
  rssBytes: 125_829_120,
  lastError: null,
  nextRetryAt: null,
  logTail: [],
};
const fetchedAt = Date.parse("2026-11-06T12:05:30.000Z");

describe("formatBytes", () => {
  it("keeps bytes whole and shows one decimal below ten of a larger unit", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10_240)).toBe("10 KB");
    expect(formatBytes(125_829_120)).toBe("120 MB");
    expect(formatBytes(1_610_612_736)).toBe("1.5 GB");
  });

  it("stops at terabytes", () => {
    expect(formatBytes(2048 * 1024 ** 4)).toBe("2048 TB");
  });
});

describe("formatUptime", () => {
  it("shows the two largest units", () => {
    expect(formatUptime(45_000)).toBe("45s");
    expect(formatUptime(192_000)).toBe("3m 12s");
    expect(formatUptime(7_530_000)).toBe("2h 5m");
    expect(formatUptime(273_600_000)).toBe("3d 4h");
  });

  it("clamps a negative duration from clock skew to zero", () => {
    expect(formatUptime(-5_000)).toBe("0s");
  });
});

describe("describeServer", () => {
  it("summarizes a running server against the fetch time", () => {
    expect(describeServer(healthy, fetchedAt)).toBe(
      "healthy · port 8932 · pid 4321 · up 2h 5m · 1 restart · 120 MB",
    );
  });

  it("shows the retry countdown and no uptime while backing off", () => {
    const backoff = {
      ...healthy,
      state: "backoff",
      pid: null,
      startedAt: null,
      restarts: 3,
      rssBytes: null,
      nextRetryAt: "2026-11-06T12:05:38.000Z",
    };
    expect(describeServer(backoff, fetchedAt)).toBe(
      "backoff · port 8932 · 3 restarts · retry in 8s",
    );
  });
});

describe("formatLogTail", () => {
  it("keeps the last lines in order", () => {
    expect(formatLogTail(["one", "two", "three"], 2)).toBe("two\nthree");
  });

  it("says when the server has written nothing", () => {
    expect(formatLogTail([], 20)).toBe("No output yet.");
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/client/format.test.ts --bail=1
```

Expected: FAIL at import. Vitest cannot resolve `./format.js` because `client/format.ts` does not exist yet; no test runs and the summary shows `Test Files  1 failed (1)`.

- [ ] **Step 4: Write `client/format.ts`**

```ts
import type { ServerStatus } from "../shared/rpc.js";

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/** Binary units, as `free` and `ps` count RSS: "512 B", "1.5 KB", "120 MB". */
export function formatBytes(bytes: number): string {
  let value = Math.max(0, bytes);
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  if (unit === 0) return `${Math.round(value)} B`;
  const amount = value < 10 ? value.toFixed(1) : String(Math.round(value));
  return `${amount} ${BYTE_UNITS[unit]}`;
}

/** The two largest units of a duration: "45s", "3m 12s", "2h 5m", "3d 4h". */
export function formatUptime(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(seconds / 86_400);
  const hours = Math.floor((seconds % 86_400) / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function parseTime(value: string | null): number | null {
  if (value === null) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

/**
 * One status line for a server row. `now` is when the status was fetched, so uptime and the
 * retry countdown agree with the rest of the row.
 */
export function describeServer(server: ServerStatus, now: number): string {
  const parts: string[] = [server.state, `port ${server.port}`];
  const running = server.pid !== null;
  const startedAt = parseTime(server.startedAt);
  if (running) parts.push(`pid ${server.pid}`);
  if (running && startedAt !== null) parts.push(`up ${formatUptime(now - startedAt)}`);
  parts.push(server.restarts === 1 ? "1 restart" : `${server.restarts} restarts`);
  if (server.rssBytes !== null) parts.push(formatBytes(server.rssBytes));
  const retryAt = parseTime(server.nextRetryAt);
  if (retryAt !== null) parts.push(`retry in ${formatUptime(retryAt - now)}`);
  return parts.join(" · ");
}

/** The last `limit` lines of a server's output, or a note that it has written none. */
export function formatLogTail(lines: readonly string[], limit: number): string {
  if (lines.length === 0) return "No output yet.";
  return lines.slice(-limit).join("\n");
}
```

- [ ] **Step 5: Run the test and watch it pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/client/format.test.ts --bail=1
```

Expected: PASS, `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 6: Write the failing test for the definitions helpers**

Create `plugins/shared-mcp/client/definitions.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatDefinitions, parseDefinitions, withServerEnabled } from "./definitions.js";

const context7 = {
  id: "context7",
  label: "Context7",
  command: "npx -y @upstash/context7-mcp@4.0.4 --transport http --port 8932",
  port: 8932,
};
const context7Saved = { ...context7, env: {}, healthPath: "/mcp", requires: [], enabled: true };
const gitlabSaved = {
  id: "gitlab",
  label: "GitLab",
  command: "npx -y @zereight/mcp-gitlab@2.1.52",
  env: { STREAMABLE_HTTP: "true" },
  port: 8933,
  healthPath: "/mcp",
  requires: [],
  bearerToken: { serverEnv: "STREAMABLE_HTTP_AUTH_TOKEN", agentEnv: "SHARED_MCP_TOKEN" },
  enabled: true,
};

describe("parseDefinitions", () => {
  it("returns the settings document with schema defaults filled and no undefined keys", () => {
    expect(parseDefinitions(JSON.stringify([context7]))).toStrictEqual({
      ok: true,
      values: { servers: [context7Saved] },
    });
  });

  it("reports malformed JSON", () => {
    expect(parseDefinitions("[{")).toStrictEqual({
      ok: false,
      error: expect.stringMatching(/^Invalid JSON: /),
    });
  });

  it("names the full path of a schema issue", () => {
    expect(parseDefinitions(JSON.stringify([{ ...context7, port: 0 }]))).toStrictEqual({
      ok: false,
      error: "servers.0.port: Too small: expected number to be >=1",
    });
  });

  it("rejects a document that is not an array", () => {
    expect(parseDefinitions("{}")).toStrictEqual({
      ok: false,
      error: "servers: Invalid input: expected array, received object",
    });
  });

  it("runs the document-level duplicate check before save", () => {
    // ServerDefinitionSchema accepts each entry; only the settings superRefine rejects the pair.
    const twin = { ...context7, id: "context7-copy" };
    expect(parseDefinitions(JSON.stringify([context7, twin]))).toStrictEqual({
      ok: false,
      error: 'servers.1.port: Port 8932 is used by both "context7" and "context7-copy"',
    });
  });
});

describe("formatDefinitions", () => {
  it("round-trips through parseDefinitions", () => {
    const servers = [context7Saved, gitlabSaved];
    expect(parseDefinitions(formatDefinitions(servers))).toStrictEqual({
      ok: true,
      values: { servers },
    });
  });
});

describe("withServerEnabled", () => {
  it("changes only the named server and leaves the input untouched", () => {
    const servers = [context7Saved, gitlabSaved];
    expect(withServerEnabled(servers, "gitlab", false)).toStrictEqual([
      context7Saved,
      { ...gitlabSaved, enabled: false },
    ]);
    expect(servers[1]?.enabled).toBe(true);
  });

  it("throws for an id that is not defined", () => {
    expect(() => withServerEnabled([context7Saved], "playwright", true)).toThrow(
      "Unknown server: playwright",
    );
  });
});
```

- [ ] **Step 7: Run the test and watch it fail**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/client/definitions.test.ts --bail=1
```

Expected: FAIL at import. Vitest cannot resolve `./definitions.js` because `client/definitions.ts` does not exist yet; `Test Files  1 failed (1)`.

- [ ] **Step 8: Write `client/definitions.ts`**

Each schema issue prints as its full `issue.path` joined with `.`, then the message (`servers.0.port: Too small: ...`). That is the format Task 1 asks this screen for, because the settings host drops paths.

```ts
import type { output as ZodOutput } from "zod";
import { sharedMcpSettings, type ServerDefinition } from "../shared/settings.js";

export type SharedMcpSettingsValues = ZodOutput<typeof sharedMcpSettings.schema>;

export type ParsedDefinitions =
  | { ok: true; values: SharedMcpSettingsValues }
  | { ok: false; error: string };

interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** The editor text for saved definitions: the servers array with every default written out. */
export function formatDefinitions(servers: readonly ServerDefinition[]): string {
  return JSON.stringify(servers, null, 2);
}

function describeIssue(issue: SchemaIssue): string {
  // Paths start at the settings document, so a field of the first entry reads "servers.0.port".
  const where = issue.path.map((segment) => String(segment)).join(".");
  return `${where}: ${issue.message}`;
}

/**
 * Parse editor text as the servers array and validate it as the whole settings document, so the
 * duplicate id and port checks run before save. The output has defaults filled and no key set to
 * undefined, which save() requires.
 */
export function parseDefinitions(text: string): ParsedDefinitions {
  let servers: unknown;
  try {
    servers = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Invalid JSON: ${reason}` };
  }
  const parsed = sharedMcpSettings.schema.safeParse({ servers });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => describeIssue(issue));
    return { ok: false, error: issues.join("\n") };
  }
  return { ok: true, values: parsed.data };
}

/** A copy of `servers` with one definition's `enabled` replaced. Throws for an unknown id. */
export function withServerEnabled(
  servers: readonly ServerDefinition[],
  id: string,
  enabled: boolean,
): ServerDefinition[] {
  const index = servers.findIndex((server) => server.id === id);
  if (index === -1) throw new Error(`Unknown server: ${id}`);
  const next = servers.slice();
  next[index] = { ...servers[index], enabled };
  return next;
}
```

- [ ] **Step 9: Run the test and watch it pass**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npx vitest run plugins/shared-mcp/client/definitions.test.ts --bail=1
```

Expected: PASS, `Test Files  1 passed (1)`, `Tests  8 passed (8)`.

- [ ] **Step 10: Write `client/styles.ts`**

Lint bans inline style objects as JSX props (react-perf), so both screens take memoized styles from one hook.

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
      log: { color: theme.colors.foregroundMuted, fontFamily: MONOSPACE, fontSize: 12 },
      // A web textarea does not grow with its text, so the editor needs its own height.
      editor: {
        minHeight: 320,
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

- [ ] **Step 11: Write `client/servers-screen.tsx`**

Status comes from `useQuery` with `refetchInterval: 5_000`; the interval belongs to the query observer, so polling stops when the screen unmounts. The query also sets `retry: false`. The per-installation QueryClient is a bare `new QueryClient()` (`packages/app/src/plugins/registry.ts:121`), so TanStack's default would retry a failed fetch three times with 1 s, 2 s and 4 s backoff, and the screen would show "Loading servers…" or stale rows for about 7 s before the error appears. The next 5 s poll is the retry. No vertical `ScrollView` (the settings shell owns page scrolling) and no `Loading` from `client/ui` (it is the file-panel overlay). Each server is one `SettingsCard`: an enable switch whose hint carries state, port, pid, uptime, restarts and RSS and whose error is `lastError`; a Restart action; and the last 20 log lines as one selectable monospace `Text`.

```tsx
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { Text, View } from "react-native";
import {
  useRpc,
  useSettings,
  type PluginSurfaceProps,
  type SettingsState,
} from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  SettingsSwitch,
} from "@getpaseo/plugin/client/ui";
import { restartRpc, statusRpc, type ServerStatus } from "../shared/rpc.js";
import { sharedMcpSettings, type ServerDefinition } from "../shared/settings.js";
import { withServerEnabled } from "./definitions.js";
import { describeServer, formatLogTail } from "./format.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

const STATUS_KEY = ["shared-mcp", "status"] as const;
const POLL_MS = 5_000;
const LOG_TAIL_LINES = 20;
const NO_DEFINITIONS: readonly ServerDefinition[] = [];
const EMPTY_MESSAGE = "No servers are defined. Add them on the Definitions tab.";

type SharedMcpSettingsState = SettingsState<typeof sharedMcpSettings.schema>;

interface ServerCardProps {
  server: ServerStatus;
  definitions: readonly ServerDefinition[];
  settings: SharedMcpSettingsState;
  /** When the status was fetched. Uptime and retry countdowns are measured from it. */
  now: number;
  styles: ScreenStyles;
}

interface StatusUnavailableProps {
  message: string;
  onRetry(): void;
  styles: ScreenStyles;
}

function restartBlockedReason(state: ServerStatus["state"]): string | undefined {
  if (state === "external") return "Paseo did not start this server, so it leaves it alone.";
  if (state === "disabled") return "Turn the server on to start it.";
  return undefined;
}

function settingsMessage(settings: SharedMcpSettingsState): string | null {
  if (settings.status === "invalid") {
    return `The saved definitions are invalid. Fix them on the Definitions tab.\n${settings.error}`;
  }
  if (settings.status === "error") return settings.error;
  return settings.saveError;
}

function ServerCard({ server, definitions, settings, now, styles }: ServerCardProps) {
  const callRestart = useRpc(restartRpc);
  const queryClient = useQueryClient();
  const restart = useMutation({
    mutationFn: () => callRestart({ id: server.id }),
    onSettled: () => queryClient.invalidateQueries({ queryKey: STATUS_KEY }),
  });
  const { mutate } = restart;
  const restartServer = useCallback(() => mutate(), [mutate]);
  const changeEnabled = useCallback(
    (next: boolean) => {
      if (settings.status !== "ready") return;
      const servers = withServerEnabled(settings.values.servers, server.id, next);
      void settings.save({ ...settings.values, servers }, settings.revision);
    },
    [settings, server.id],
  );
  const definition = definitions.find((candidate) => candidate.id === server.id);
  // Until the definition loads, or once it is removed, the switch mirrors the process state.
  const enabled = definition ? definition.enabled : server.state !== "disabled";
  const canToggle = definition !== undefined && !settings.saving;
  const blockedReason = restartBlockedReason(server.state);
  const canRestart = blockedReason === undefined && !restart.isPending;
  const reply = restart.data;
  const rejection = reply?.ok === false ? reply.error : null;
  const restartError = restart.error?.message ?? rejection;
  const summary = describeServer(server, now);
  return (
    <SettingsCard>
      <SettingsSwitch
        label={server.label}
        hint={summary}
        error={server.lastError}
        value={enabled}
        disabled={!canToggle}
        onValueChange={changeEnabled}
      />
      <SettingsAction
        label="Restart server"
        hint={blockedReason}
        error={restartError}
        actionLabel={restart.isPending ? "Restarting…" : "Restart"}
        disabled={!canRestart}
        onPress={restartServer}
      />
      <View style={styles.block}>
        <Text selectable style={styles.log}>
          {formatLogTail(server.logTail, LOG_TAIL_LINES)}
        </Text>
      </View>
    </SettingsCard>
  );
}

function StatusUnavailable({ message, onRetry, styles }: StatusUnavailableProps) {
  return (
    <SettingsSection title="Servers">
      <Text accessibilityRole="alert" style={styles.error}>
        {message}
      </Text>
      <SettingsAction label="Server status" actionLabel="Try again" onPress={onRetry} />
    </SettingsSection>
  );
}

export function ServersScreen({ theme }: PluginSurfaceProps) {
  const styles = useScreenStyles(theme);
  const settings = useSettings(sharedMcpSettings);
  const fetchStatus = useRpc(statusRpc);
  // The interval belongs to the query observer, so polling stops when the screen unmounts.
  // The installation's QueryClient keeps TanStack's default of 3 retries with backoff, which
  // would hide a failed fetch for about 7 s; the next poll is the retry.
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
  const servers = status.data?.servers;
  if (servers === undefined) {
    if (status.isError) {
      return <StatusUnavailable message={status.error.message} onRetry={retry} styles={styles} />;
    }
    return <Text style={styles.muted}>Loading servers…</Text>;
  }
  const definitions = settings.status === "ready" ? settings.values.servers : NO_DEFINITIONS;
  const refreshError = status.isError ? `Status refresh failed: ${status.error.message}` : null;
  const settingsError = settingsMessage(settings);
  return (
    <SettingsSection title="Servers">
      {refreshError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {refreshError}
        </Text>
      ) : null}
      {settingsError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {settingsError}
        </Text>
      ) : null}
      {servers.length === 0 ? <Text style={styles.muted}>{EMPTY_MESSAGE}</Text> : null}
      {servers.map((server) => (
        <ServerCard
          key={server.id}
          server={server}
          definitions={definitions}
          settings={settings}
          now={status.dataUpdatedAt}
          styles={styles}
        />
      ))}
    </SettingsSection>
  );
}
```

- [ ] **Step 12: Write `client/definitions-screen.tsx`**

The editor holds a draft only while the user has unsaved edits. The draft keeps the revision it started from, so a save over another client's change is rejected and both versions survive. Discard drops the draft and reloads. `settings.reset()` (restore defaults, an empty list that stops every server) is offered only when the stored document is invalid.

```tsx
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import { useSettings, type PluginSurfaceProps, type SettingsState } from "@getpaseo/plugin/client";
import {
  SettingsAction,
  SettingsCard,
  SettingsSection,
  TextInput,
} from "@getpaseo/plugin/client/ui";
import { sharedMcpSettings } from "../shared/settings.js";
import { formatDefinitions, parseDefinitions } from "./definitions.js";
import { useScreenStyles, type ScreenStyles } from "./styles.js";

type ReadySettings = Extract<SettingsState<typeof sharedMcpSettings.schema>, { status: "ready" }>;

const EDITOR_INFO =
  "A JSON array of server definitions. Saving starts, restarts, or stops servers to match.";
const STALE_HINT = "The saved definitions changed after you started editing. Discard to load them.";
const RESET_HINT = "Replaces the stored file with an empty server list, which stops every server.";

interface Draft {
  text: string;
  /** The revision the edit started from, so saving over another client's save is a conflict. */
  revision: string;
}

interface DefinitionsEditorProps {
  settings: ReadySettings;
  styles: ScreenStyles;
}

function DefinitionsEditor({ settings, styles }: DefinitionsEditorProps) {
  // No draft means the editor shows the saved definitions and follows other clients' saves.
  const [draft, setDraft] = useState<Draft | null>(null);
  const { revision } = settings;
  const text = draft?.text ?? formatDefinitions(settings.values.servers);
  const parsed = useMemo(() => parseDefinitions(text), [text]);
  const changeText = useCallback(
    (next: string) =>
      setDraft((current) => ({ text: next, revision: current?.revision ?? revision })),
    [revision],
  );
  const save = useCallback(async () => {
    if (draft === null || !parsed.ok) return;
    if (await settings.save(parsed.values, draft.revision)) setDraft(null);
  }, [draft, parsed, settings]);
  const discard = useCallback(() => {
    setDraft(null);
    void settings.reload();
  }, [settings]);
  const stale = draft !== null && draft.revision !== revision;
  const canSave = draft !== null && parsed.ok && !settings.saving;
  const canDiscard = draft !== null && !settings.saving;
  return (
    <SettingsSection title="Server definitions" info={EDITOR_INFO}>
      <SettingsCard>
        <View style={styles.block}>
          <TextInput
            multiline
            value={text}
            onChangeText={changeText}
            editable={!settings.saving}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            accessibilityLabel="Server definitions as JSON"
            style={styles.editor}
          />
          {parsed.ok ? null : (
            <Text accessibilityRole="alert" style={styles.error}>
              {parsed.error}
            </Text>
          )}
        </View>
        <SettingsAction
          label="Save definitions"
          hint={stale ? STALE_HINT : undefined}
          error={settings.saveError}
          actionLabel={settings.saving ? "Saving…" : "Save"}
          disabled={!canSave}
          onPress={save}
        />
        <SettingsAction
          label="Discard changes"
          actionLabel="Discard"
          disabled={!canDiscard}
          onPress={discard}
        />
      </SettingsCard>
    </SettingsSection>
  );
}

export function DefinitionsScreen({ theme }: PluginSurfaceProps) {
  const styles = useScreenStyles(theme);
  const settings = useSettings(sharedMcpSettings);
  if (settings.status === "loading") {
    return <Text style={styles.muted}>Loading definitions…</Text>;
  }
  if (settings.status === "ready") return <DefinitionsEditor settings={settings} styles={styles} />;
  return (
    <SettingsSection title="Server definitions">
      <Text accessibilityRole="alert" style={styles.error}>
        {settings.error}
      </Text>
      <SettingsAction
        label="Read the saved definitions again"
        actionLabel="Reload"
        onPress={settings.reload}
      />
      {settings.status === "invalid" ? (
        <SettingsAction
          label="Restore defaults"
          hint={RESET_HINT}
          error={settings.saveError}
          actionLabel="Reset"
          disabled={settings.saving}
          onPress={settings.reset}
        />
      ) : null}
    </SettingsSection>
  );
}
```

- [ ] **Step 13: Write `index.client.tsx`**

Built-ins are not in `listPlugins()`, so Settings > Plugins never shows their row or cog. The global Command Center item is the way in; `openSettings` resolves the route from the catalog.

```tsx
import type { PluginClientContext } from "@getpaseo/plugin/client";
import { DefinitionsScreen } from "./client/definitions-screen.js";
import { ServersScreen } from "./client/servers-screen.js";

export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addSettingsScreen({
      id: "servers",
      title: "Servers",
      icon: "Server",
      Component: ServersScreen,
    }),
    client.addSettingsScreen({
      id: "definitions",
      title: "Definitions",
      icon: "FileBraces",
      Component: DefinitionsScreen,
    }),
    // Built-ins have no row in Settings > Plugins, so this item is the way to their settings.
    client.addCommandCenterItem({
      id: "open-servers",
      title: "Shared MCP servers",
      icon: "Server",
      keywords: ["mcp"],
      context: "global",
      onSelect({ openSettings }) {
        openSettings("servers");
      },
    }),
  ];
  return () => {
    for (const remove of removers) remove();
  };
}
```

- [ ] **Step 14: Format the new files**

```bash
cd /workspace/utils/paseo && npm run format:files -- plugins/shared-mcp/index.client.tsx plugins/shared-mcp/client/format.ts plugins/shared-mcp/client/format.test.ts plugins/shared-mcp/client/definitions.ts plugins/shared-mcp/client/definitions.test.ts plugins/shared-mcp/client/styles.ts plugins/shared-mcp/client/servers-screen.tsx plugins/shared-mcp/client/definitions-screen.tsx
```

Expected: oxfmt rewrites the files in place (line wrapping only) and exits 0.

- [ ] **Step 15: Lint the new files**

```bash
cd /workspace/utils/paseo && npm run lint -- plugins/shared-mcp/index.client.tsx plugins/shared-mcp/client/format.ts plugins/shared-mcp/client/format.test.ts plugins/shared-mcp/client/definitions.ts plugins/shared-mcp/client/definitions.test.ts plugins/shared-mcp/client/styles.ts plugins/shared-mcp/client/servers-screen.tsx plugins/shared-mcp/client/definitions-screen.tsx
```

Expected: `Found 0 warnings and 0 errors.` The rules this code is shaped around: no inline function, object or array JSX props (react-perf), no spread inside `map` (oxc/no-map-spread, hence `withServerEnabled`), no shadowed names, max 3 nested callbacks.

- [ ] **Step 16: Typecheck the builtin-plugins workspace**

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/builtin-plugins -- --singleThreaded
```

Expected: npm prints its two banner lines first,

```
> @getpaseo/builtin-plugins@0.15.2 typecheck
> tsgo -p tsconfig.json --noEmit --singleThreaded
```

then no diagnostics, and the command exits 0 (`echo $?` prints `0`). These are the first `.tsx` files in `plugins/`; `react`, `react-native`, `@types/react` and `@tanstack/react-query` resolve from the hoisted root `node_modules`. If tsgo reports `Cannot find module 'react'` (or `react-native`, `@tanstack/react-query`), stop and report it; do not edit `plugins/package.json` or run `npm install` in this task.

- [ ] **Step 17: Run the builtin compile test**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: PASS, `Test Files  1 passed (1)`, `Tests  1 passed | 3 skipped (4)`. The file holds four tests and `-t` runs only the first; the other three ("listed client bundle is published…", "a repeated catalog fetch…", "directory, Git, and npm installs reject a built-in ID") show as skipped. The test now compiles `plugins/shared-mcp/index.client.tsx` with the client boundary checks, so a forbidden import (`node:*`, `@getpaseo/plugin/server*`, an npm package outside the host modules) or a module outside `client/`, `server/`, `shared/` fails here.

- [ ] **Step 18: Stage the eight new files**

Stage explicit paths only, never `-A`. Other sessions share this checkout, and the untracked plan file `docs/superpowers/plans/2026-11-06-shared-mcp-plugin.md` stays out.

```bash
git -C /workspace/utils/paseo add plugins/shared-mcp/index.client.tsx plugins/shared-mcp/client/format.ts plugins/shared-mcp/client/format.test.ts plugins/shared-mcp/client/definitions.ts plugins/shared-mcp/client/definitions.test.ts plugins/shared-mcp/client/styles.ts plugins/shared-mcp/client/servers-screen.tsx plugins/shared-mcp/client/definitions-screen.tsx && git -C /workspace/utils/paseo diff --cached --name-only
```

Expected: exactly the eight `plugins/shared-mcp/...` paths above. If any other path is staged, stop and report it; do not unstage or commit someone else's change.

- [ ] **Step 19: Checkpoint: ask the user how to run the pre-commit hook, then commit**

The lefthook pre-commit hook (`lefthook.yml`) runs three jobs in parallel: `format:check:files` and `lint` on the staged files, and a full `npm run typecheck`, which is `npm run typecheck --workspaces --if-present` across every workspace, `packages/app` included, without `--singleThreaded` (about 3.7 GB on this host). Steps 14 and 15 already ran the format and lint checks on these files, and Step 16 typechecked the builtin-plugins workspace. Skipping the hook therefore loses only the full multi-workspace typecheck.

Skipping hooks is the user's decision. Stop and ask: "Commit with `LEFTHOOK=0` to skip the pre-commit hook (the only check lost is the full multi-workspace typecheck), or run the hook under `/tmp/paseo-heavy.lock`?" Wait for the answer. Do not choose option A on your own.

Both options end with the eight paths as a pathspec, as Tasks 1, 4 and 7 do. Another session can stage a file while this step waits for the answer, and the pathspec keeps that file out of this commit.

Option A, only if the user approves skipping the hook:

```bash
LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): shared-mcp settings screens" -- plugins/shared-mcp/index.client.tsx plugins/shared-mcp/client/format.ts plugins/shared-mcp/client/format.test.ts plugins/shared-mcp/client/definitions.ts plugins/shared-mcp/client/definitions.test.ts plugins/shared-mcp/client/styles.ts plugins/shared-mcp/client/servers-screen.tsx plugins/shared-mcp/client/definitions-screen.tsx
```

Option B, if the user declines: run the hook. The command holds the heavy lock for the whole commit, so it waits for other agents' heavy commands and blocks them while the full multi-workspace typecheck runs.

```bash
flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(fork): shared-mcp settings screens" -- plugins/shared-mcp/index.client.tsx plugins/shared-mcp/client/format.ts plugins/shared-mcp/client/format.test.ts plugins/shared-mcp/client/definitions.ts plugins/shared-mcp/client/definitions.test.ts plugins/shared-mcp/client/styles.ts plugins/shared-mcp/client/servers-screen.tsx plugins/shared-mcp/client/definitions-screen.tsx
```

Expected: one commit, `feat(fork): shared-mcp settings screens`, with `8 files changed`. With option B, lefthook first reports the format, lint and typecheck jobs as passing. If the hook fails, git creates no commit: report the hook output and stop. Do not fix files outside this task, and do not fall back to `LEFTHOOK=0` without asking again. Do not push.

- [ ] **Step 20: Verify the commit identity and contents**

```bash
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>' && git -C /workspace/utils/paseo show --stat --format= HEAD
```

Expected: `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`, then the eight `plugins/shared-mcp/...` paths and nothing else (no `docs/superpowers/plans/...`).

### Task 9: Docs and manual test on the dev daemon

**Files:**

- Modify: `docs/plugins.md` (section "Built-in plugins": a new `shared-mcp` paragraph after the `worktree-include` paragraph at lines 102-104, and the import-rule sentence at lines 109-111, which stops being true once a built-in ships client code)
- Test (manual, not committed): `.dev/paseo-home/plugin-settings/shared-mcp/servers.json` (gitignored dev home, seeded before the daemon starts)
- Scratch (outside the repo, not committed): `/tmp/shared-mcp-test.env`, `/tmp/shared-mcp-dev-password` (mode 0600, removed in Step 44), `/tmp/shared-mcp-dist.out`, `/tmp/shared-mcp-dist-home.*` (removed in Step 3), `/tmp/shared-mcp-pre-edit`, `/tmp/shared-mcp-envcheck.js`, `/tmp/shared-mcp-ext-server.js`, `/tmp/shared-mcp-ext.pid`, `/tmp/shared-mcp-ext.out`, `/tmp/shared-mcp-serena.pid`, `/tmp/shared-mcp-c7.pgid`, `/tmp/shared-mcp-groups`, `/tmp/shared-mcp-orphans`, `/tmp/shared-mcp-token.sha`, `/tmp/shared-mcp-settings.sha`, `/tmp/shared-mcp-dev-daemon.pid`, `/tmp/shared-mcp-dev-daemon.out`, `/tmp/shared-mcp-dev-app.pid`, `/tmp/shared-mcp-dev-app.out`, `/tmp/shared-mcp-build.out`, `/tmp/shared-mcp-agent/` (agent cwd holding `.mcp.json` and `.claude/settings.local.json`), `/tmp/shared-mcp-claude.json`, `/tmp/shared-mcp-claude.id`, `/tmp/shared-mcp-claude-send.json`, `/tmp/shared-mcp-kiro.json`, `/tmp/shared-mcp-edit.json`, `/tmp/shared-mcp-saved.json`, `/tmp/shared-mcp-dup.json`

**Interfaces:**

- Consumes:
  - `sharedMcpSettings = defineSettings({ id: "servers", scope: "host", version: 1, schema: z.object({ servers: z.array(ServerDefinitionSchema).default([]) }) })` (with the duplicate-id and duplicate-port superRefine) from `plugins/shared-mcp/shared/settings.ts`. The daemon stores it at `$PASEO_HOME/plugin-settings/shared-mcp/servers.json` as `{ "version": 1, "values": { "servers": ServerDefinition[] } }`. Nothing watches that file: it is read through `read()` at plugin start and rewritten by `settings.servers.write` (`packages/server/src/server/plugins/settings/index.ts` notifies only at lines 128 and 163).
  - `ServerDefinitionSchema` fields `id`, `label`, `command`, `cwd?`, `env` (default `{}`), `port`, `healthPath` (default `"/mcp"`), `requires` (default `[]`), `bearerToken?: { serverEnv: string; agentEnv: string }`, `enabled` (default `true`).
  - `statusRpc` (`"shared-mcp.status.request"`, `{}` -> `{ servers: ServerStatus[] }`) and `restartRpc` (`"shared-mcp.restart.request"`, `{ id: string }` -> `{ ok: boolean; error: string | null }`), through the Servers screen.
  - `ServerStateSchema = z.enum(["starting","healthy","unhealthy","backoff","failing","blocked","external","disabled"])`.
  - `sharedMcpHome(env: NodeJS.ProcessEnv = process.env): string` -> `<PASEO_HOME>/shared-mcp`, holding `run/<id>.pid`, `logs/<id>.log` and `token`.
  - `loadOrCreateToken(file: string): Promise<string>` -> `<home>/token`, mode 0600, reused across daemon restarts.
  - `probeMcp(target: ProbeTarget, options?: ProbeOptions): Promise<ProbeResult>` with `ProbeTarget { port: number; healthPath: string; bearerToken?: string }` and `ProbeOptions { timeoutMs?: number }` (Task 3: no `fetchImpl`, the probe uses `node:http`): the initialize POST and the session DELETE both carry `Authorization: Bearer <token>`.
  - `spawnServer` (Task 4) passes the daemon env minus every `PASEO_*` key and the parent-session keys, plus the definition's `env`. Each pid file under `run/` is one JSON line `{ pgid, startTime, ownerPid, ownerStartTime }`.
  - `reclaimOrphan(pidFile: string): Promise<boolean>`, `Supervisor.stopAll(): Promise<void>`, `createSharedMcp(options: { server: PluginServerContext; home: string; deps?: Partial<SupervisorDeps> }): () => Promise<void>`, and the single `agent.open.before` hook that returns `{ ...request, env: { ...request.env, [agentEnv]: token } }`. An agent gets the token only when its session opens (Task 7's limits).
  - Task 6's `apply()` rules: only a change to `command`, `cwd`, `env` (key order ignored), `port`, `requires`, `bearerToken.serverEnv` or `enabled` restarts a server. `label`, `healthPath` and `bearerToken.agentEnv` are updated in place, with the same process group. `restarts` is the number of spawns minus one, so a restart for a changed definition adds one, and it clears `lastError`.
  - Client (Task 8): `addSettingsScreen({ id: "servers", title: "Servers", icon: "Server", ... })`, `addSettingsScreen({ id: "definitions", title: "Definitions", icon: "FileBraces", ... })` and `addCommandCenterItem({ id: "open-servers", title: "Shared MCP servers", icon: "Server", keywords: ["mcp"], context: "global", onSelect({ openSettings }) { openSettings("servers"); } })`. The steps match the item by its title.
  - External: `@upstash/context7-mcp@4.0.4` (`--transport http --port <p>`; `app.listen(port)` with no host, so it binds `[::]`, and it moves to port+1 on EADDRINUSE). `@zereight/mcp-gitlab@2.1.52` (`STREAMABLE_HTTP`, `HOST` (default 127.0.0.1), `PORT`, `STREAMABLE_HTTP_AUTH_TOKEN`; unauthenticated `GET /health` returns `{ activeSessions, uptime, ... }`; every new session logs `Streamable HTTP session initialized: <id>`).
- Produces: the `shared-mcp` paragraph and the rewritten import rule in `docs/plugins.md`. No code, no new exports.

Ground rules for every step of this task:

- Never signal the daemon on 6767 and never write under `~/.paseo`. The test only reads two things there: `config.json` (copied in Step 4) and the local speech models directory, which `scripts/dev-daemon.sh` also hands its dev daemon. Every pid this task signals comes from `$DEV_HOME/paseo.pid`, from a pid file under `$DEV_HOME/shared-mcp/run/`, or from a `/tmp/shared-mcp-*` file written by this task. The abort path below also signals processes whose environment carries the `PASEO_AGENT_ID` of an agent this task created. Never use `pkill` or a broad `pkill -f`.
- The dev daemon runs with a random password that Step 1 writes to `/tmp/shared-mcp-dev-password` (mode 0600) for this run only. It binds only the Docker bridge address (172.22.0.3), so the password keeps the browser container, the other Paseo instance and the VPN container from driving it. `start_dev_daemon` refuses any address outside 172.22.0.0/16, so the daemon never listens on the VPN overlay. The inherited real `PASEO_PASSWORD` never reaches the dev daemon.
- Shell state does not persist between Bash calls, so every shell step starts with `. /tmp/shared-mcp-test.env`. Wait loops call `bash -c`, because dash's `kill` cannot signal a process group (`kill -0 -- -<pgid>` fails in `/bin/sh`). A wait loop that can run longer than 60 s starts with the Bash tool's `run_in_background: true`; shorter ones run in the foreground. Every wait loop either chains its follow-up with `&&` or prints a line starting with `TIMEOUT`, so a failed wait never prints output that looks normal.
- Heavy commands hold `/tmp/paseo-heavy.lock`: the server build and the dist test (Step 3), Metro and the web bundle, about 3 GB (Step 11, which keeps the lock until Step 44), and the pre-commit typecheck (Step 48).
- Never print a secret. No step reads `config.json`, `~/.claude/settings.json` or `<home>/token` aloud, and tokens are compared by sha256 without printing either value or hash. The one value printed on purpose is this run's throwaway dev password, in Step 12, because the browser form needs it typed in.
- A `TIMEOUT` line, or any output that differs from Expected, ends the run. Read the logs the step names, then run **Abort and clean up** below before doing anything else. Do not leave the run paused while you investigate: from Step 11 on, Metro holds the shared heavy lock, which blocks every other agent's typecheck, test and commit, and the dev daemon keeps its MCP servers running.

**Abort and clean up.** Run with `run_in_background: true` (it can take about 90 s):

```bash
. /tmp/shared-mcp-test.env && abort_cleanup
```

Then call `mcp__playwright__browser_tabs` with `{"action": "list"}` and, if a `http://172.22.0.3:8081` tab is open, `{"action": "close", "index": <its index>}`.

Expected: one line per thing it stopped, then `abort cleanup done`, with no `LIVE GROUP`, `STILL LISTENING` or `TIMEOUT` line. `abort_cleanup` (defined in Step 1) works from any step and skips what was never started:

1. It sends SIGCONT to the context7 group named in `/tmp/shared-mcp-c7.pgid`, so a group that Step 25 froze can exit.
2. If the dev daemon answers, it archives the agents recorded in `/tmp/shared-mcp-claude.id` and `/tmp/shared-mcp-kiro.json`.
3. It stops the dev daemon as Step 36 does: SIGTERM to the supervisor in `$DEV_HOME/paseo.pid`, then up to 30 s for it to exit. Then it sends SIGTERM to whatever is left of the dev session group in `/tmp/shared-mcp-dev-daemon.pid`.
4. It runs the Step 37 orphan check over every group named in `$SMCP/run/*.pid`, `/tmp/shared-mcp-c7.pgid`, `/tmp/shared-mcp-groups` and `/tmp/shared-mcp-orphans`. A group still alive gets SIGTERM, then SIGKILL after 5 s.
5. It sends SIGTERM to any process still carrying a recorded agent's `PASEO_AGENT_ID`.
6. It sends SIGTERM to the Metro session group in `/tmp/shared-mcp-dev-app.pid`, and SIGKILL if the group is still alive 30 s later. Either releases `/tmp/paseo-heavy.lock`. Then it stops the hand-run ext server in `/tmp/shared-mcp-ext.pid`.
7. It reports any test port still listening.

Every signal goes to a pid that one of those files names, and only after a check that the pid still belongs to this test. The supervisor must run in the session that `start_dev_daemon` recorded, and it and that session must carry `PASEO_HOME=$DEV_HOME`, so another session's dev daemon on the same dev home is left alone. A server group must run context7 on `--port 18932`, mcp-gitlab with `PORT=18950`, or `shared-mcp-ext-server.js`. Metro's group leader must run `scripts/dev-app.sh`. A pid the kernel reused for something else is left alone and reported. serena on 8000 never matches, so it is never touched. After an abort, start again from Step 1. Step 4 moves this run's dev home aside, so its logs stay available for the investigation.

- [ ] **Step 1: Write the scratch helpers.** Run:

```bash
cat > /tmp/shared-mcp-test.env <<'EOF'
# Scratch helpers for the shared-mcp manual test. Paths are the checkout's dev home or
# /tmp/shared-mcp-*; nothing here writes under ~/.paseo or signals the daemon on 6767.
REPO=/workspace/utils/paseo
DEV_HOME=/workspace/utils/paseo/.dev/paseo-home
SMCP=/workspace/utils/paseo/.dev/paseo-home/shared-mcp
C7_PID_FILE=/workspace/utils/paseo/.dev/paseo-home/shared-mcp/run/context7.pid
GL_PID_FILE=/workspace/utils/paseo/.dev/paseo-home/shared-mcp/run/gitlab.pid
EXT_PID_FILE=/workspace/utils/paseo/.dev/paseo-home/shared-mcp/run/ext-test.pid
SETTINGS_FILE=/workspace/utils/paseo/.dev/paseo-home/plugin-settings/shared-mcp/servers.json
AGENT_DIR=/tmp/shared-mcp-agent
# Random password for this run only, written by Step 1 (mode 0600). It keeps other containers on
# the Docker bridge out of the dev daemon. The inherited real PASEO_PASSWORD never reaches it.
DEV_PASSWORD=$(cat /tmp/shared-mcp-dev-password 2>/dev/null)
# The Docker bridge address. hostname -i also prints the VPN overlay (10.200.0.24), in an order
# nobody guarantees, so take the 172.22.* address by its prefix; start_dev_daemon refuses others.
DEV_IP=$(hostname -i | tr ' ' '\n' | grep -m1 '^172\.22\.')
export REPO DEV_HOME SMCP C7_PID_FILE GL_PID_FILE EXT_PID_FILE SETTINGS_FILE AGENT_DIR
export DEV_PASSWORD DEV_IP

# Process group named by a shared-mcp pid file: JSON {"pgid": ...} or a bare number.
pgid_of() {
  node -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const g = typeof v === "number" ? v : (v.pgid ?? v.pid);
if (!Number.isInteger(g)) process.exit(1);
console.log(g);' "$1" 2>/dev/null
}
group_alive() { kill -0 -- "-$1" 2>/dev/null; }
# True when something listens on TCP port $1, IPv4 or IPv6.
listening() {
  awk -v p="$(printf ':%04X' "$1")" \
    'FNR > 1 && $4 == "0A" && substr($2, length($2) - 4) == p { f = 1 } END { exit !f }' \
    /proc/net/tcp /proc/net/tcp6
}
# True when TCP port $1 listens on the IPv6 wildcard [::], which takes every interface.
bound_everywhere() {
  awk -v a="00000000000000000000000000000000$(printf ':%04X' "$1")" \
    'FNR > 1 && $4 == "0A" && $2 == a { f = 1 } END { exit !f }' /proc/net/tcp6
}
# VmRSS summed over every process whose pgrp is $1.
group_rss_mb() {
  node -e 'const fs = require("fs"); const g = Number(process.argv[1]); let kb = 0;
for (const p of fs.readdirSync("/proc")) {
  if (!/^\d+$/.test(p)) continue;
  try {
    const s = fs.readFileSync(`/proc/${p}/stat`, "utf8");
    if (Number(s.slice(s.lastIndexOf(")") + 2).split(" ")[2]) !== g) continue;
    const m = /VmRSS:\s+(\d+)/.exec(fs.readFileSync(`/proc/${p}/status`, "utf8"));
    if (m) kb += Number(m[1]);
  } catch {}
}
console.log((kb / 1024).toFixed(1) + " MB");' "$1"
}
# Supervisor pid from the dev home's pid lock (never ~/.paseo).
sup_pid() {
  node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pid)' \
    "$DEV_HOME/paseo.pid"
}
dev_health() {
  curl -s -m 2 -o /dev/null -w '%{http_code}' "http://$DEV_IP:6768/api/health"
}
# Waits up to 10 s for a pid file that a forked child writes; prints TIMEOUT and fails otherwise.
wait_for_file() {
  timeout 10 bash -c 'until [ -s "$1" ]; do sleep 0.2; done' _ "$1" ||
    { echo "TIMEOUT: $1 is still empty"; return 1; }
}
# Dev daemon in its own session, without scripts/dev-daemon.sh: that script always execs
# dev:server:watch, which adds two tsc --watch processes outside the heavy-command lock. The
# session's pgid goes to /tmp/shared-mcp-dev-daemon.pid; the banner feeds Step 10's grep.
start_dev_daemon() {
  case "$DEV_IP" in
    172.22.*) ;;
    *) echo "refusing to bind '$DEV_IP': not the Docker bridge"; return 1 ;;
  esac
  [ -n "$DEV_PASSWORD" ] || { echo "no dev password in /tmp/shared-mcp-dev-password"; return 1; }
  : > /tmp/shared-mcp-dev-daemon.pid
  (cd "$REPO" && setsid -f sh -c 'echo $$ > /tmp/shared-mcp-dev-daemon.pid
echo "Home:    $1"
echo "Listen:  $2:6768"
exec env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_HOST PASEO_PASSWORD="$3" \
  PASEO_HOME="$1" PASEO_LISTEN="$2:6768" PASEO_CORS_ORIGINS="*" PASEO_NODE_INSPECT=--inspect=0 \
  PASEO_LOCAL_MODELS_DIR="$HOME/.paseo/models/local-speech" PASEO_LOG_FORMAT=json \
  PASEO_LOG_LEVEL=info npm run dev:server:raw' sh "$DEV_HOME" "$DEV_IP" "$DEV_PASSWORD" \
    >> /tmp/shared-mcp-dev-daemon.out 2>&1 < /dev/null)
}
# Repo CLI against the dev daemon only: explicit --host, the throwaway password, the dev home.
dev_cli() {
  (cd "$REPO" && env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_HOST PASEO_HOME="$DEV_HOME" \
    PASEO_PASSWORD="$DEV_PASSWORD" npm run --silent cli -- "$@" --host "$DEV_IP:6768")
}
# Prints "<agentId> <status>" from a `run --json` result file.
run_result() {
  node -e 'const r = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const v = Array.isArray(r) ? r[0] : r;
console.log(v.agentId, v.status);' "$1"
}
# Distinct completed resolve-library-id tool calls in an agent's timeline.
resolve_calls() {
  dev_cli logs "$1" --json | node -e 'let text = "";
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  const ids = new Set();
  for (const item of JSON.parse(text).items ?? []) {
    const named = JSON.stringify(item).includes("resolve-library-id");
    if (item.type === "tool_call" && item.status === "completed" && named) ids.add(item.callId);
  }
  console.log(ids.size);
});'
}
# Processes whose environment carries PASEO_AGENT_ID=$1.
agent_proc_count() { grep -lzx "PASEO_AGENT_ID=$1" /proc/[0-9]*/environ 2>/dev/null | wc -l; }
# "<activeSessions> <uptime s>" from mcp-gitlab's unauthenticated /health.
gitlab_health() {
  curl -s -m 2 http://127.0.0.1:18950/health | node -e 'let text = "";
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  try {
    const health = JSON.parse(text);
    console.log(health.activeSessions, Math.floor(health.uptime));
  } catch {
    console.log("unreachable");
  }
});'
}
# Token check by sha256; prints verdicts only. Args: <env var> <pgrp|agent> <pgid|agentId>.
token_check() { node /tmp/shared-mcp-envcheck.js "$SMCP/token" "$@"; }
# True when every group in /tmp/shared-mcp-orphans is gone and its server runs in a new group.
all_reclaimed() {
  local id old new
  while read -r id old; do
    group_alive "$old" && return 1
    new=$(pgid_of "$SMCP/run/$id.pid") || return 1
    [ "$new" != "$old" ] || return 1
    group_alive "$new" || return 1
  done < /tmp/shared-mcp-orphans
}
# "processes <n>, with a PASEO_ variable <m>" for group $1. Prints no name or value.
paseo_env_count() {
  local p n=0 hits=0
  for p in $(pgrep -g "$1"); do
    n=$((n + 1))
    grep -qz '^PASEO_' "/proc/$p/environ" 2>/dev/null && hits=$((hits + 1))
  done
  echo "processes $n, with a PASEO_ variable $hits"
}
# True when pid $1 runs with this test's dev home. The daemon on 6767 has another PASEO_HOME.
dev_home_process() { grep -qzx "PASEO_HOME=$DEV_HOME" "/proc/$1/environ" 2>/dev/null; }
# True when pid $1 runs in the dev session that start_dev_daemon recorded. Another session's dev
# daemon on the same dev home runs in a different session, so it never matches.
in_dev_session() {
  local want got
  want=$(cat /tmp/shared-mcp-dev-daemon.pid 2>/dev/null)
  got=$(ps -o pgid= -p "$1" 2>/dev/null | tr -d ' ')
  [ -n "$want" ] && [ "$got" = "$want" ]
}
dev_home_group() {
  local p
  for p in $(pgrep -g "$1"); do dev_home_process "$p" && return 0; done
  return 1
}
# True when group $1 runs one of this test's servers: context7 on test port 18932, mcp-gitlab with
# PORT=18950, or the throwaway ext server. A group id the kernel reused fails this check.
test_server_group() {
  local p
  for p in $(pgrep -g "$1"); do
    tr '\0' ' ' 2>/dev/null < "/proc/$p/cmdline" |
      grep -qE -e '--port 18932|shared-mcp-ext-server' && return 0
    grep -qzx 'PORT=18950' "/proc/$p/environ" 2>/dev/null && return 0
  done
  return 1
}
# SIGTERM, then SIGKILL after 5 s, for a live group that test_server_group recognises.
stop_test_group() {
  [ "${1:-0}" -gt 1 ] 2>/dev/null && group_alive "$1" || return 0
  if ! test_server_group "$1"; then echo "left group $1 alone: it runs no test server"; return 0; fi
  kill -CONT -- "-$1" 2>/dev/null
  kill -TERM -- "-$1" 2>/dev/null
  timeout 5 bash -c '. /tmp/shared-mcp-test.env; while group_alive "$1"; do sleep 0.2; done' _ "$1" ||
    kill -KILL -- "-$1" 2>/dev/null
  sleep 0.5
  if group_alive "$1"; then echo "LIVE GROUP $1 after SIGKILL"; else echo "test server group $1 stopped"; fi
}
# Agent ids recorded by Steps 16 and 18, one per line.
test_agent_ids() {
  [ -s /tmp/shared-mcp-claude.id ] && cut -d' ' -f1 /tmp/shared-mcp-claude.id
  [ -s /tmp/shared-mcp-kiro.json ] && run_result /tmp/shared-mcp-kiro.json 2>/dev/null | cut -d' ' -f1
  return 0
}
# The abort path in the ground rules. Safe to run from any step and more than once.
abort_cleanup() {
  local g f id sup pids
  g=$(cat /tmp/shared-mcp-c7.pgid 2>/dev/null)
  if [ "${g:-0}" -gt 1 ] 2>/dev/null && group_alive "$g" && test_server_group "$g"; then
    kill -CONT -- "-$g" && echo "context7 group $g resumed"
  fi
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
  g=$(cat /tmp/shared-mcp-dev-daemon.pid 2>/dev/null)
  if [ "${g:-0}" -gt 1 ] 2>/dev/null && group_alive "$g" && dev_home_group "$g"; then
    kill -TERM -- "-$g" && echo "sent SIGTERM to dev session group $g"
    sleep 2
  fi
  for f in "$SMCP"/run/*.pid; do [ -e "$f" ] && stop_test_group "$(pgid_of "$f")"; done
  for g in $(cat /tmp/shared-mcp-c7.pgid /tmp/shared-mcp-groups /tmp/shared-mcp-orphans 2>/dev/null |
    awk '{ print $NF }' | sort -u); do
    stop_test_group "$g"
  done
  for id in $(test_agent_ids); do
    pids=$(grep -lzx "PASEO_AGENT_ID=$id" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3 | xargs)
    if [ -n "$pids" ]; then kill -TERM $pids 2>/dev/null; echo "sent SIGTERM to agent $id: $pids"; fi
  done
  g=$(cat /tmp/shared-mcp-dev-app.pid 2>/dev/null)
  if [ "${g:-0}" -gt 1 ] 2>/dev/null && group_alive "$g" &&
    tr '\0' ' ' 2>/dev/null < "/proc/$g/cmdline" | grep -q 'scripts/dev-app.sh'; then
    kill -TERM -- "-$g"
    timeout 30 bash -c '. /tmp/shared-mcp-test.env; while group_alive "$1"; do sleep 1; done' _ "$g" ||
      { kill -KILL -- "-$g" 2>/dev/null; sleep 1; }
    if group_alive "$g"; then
      echo "TIMEOUT: Metro group $g still running and holding /tmp/paseo-heavy.lock"
    else
      echo "Metro group $g stopped; /tmp/paseo-heavy.lock released"
    fi
  fi
  g=$(cat /tmp/shared-mcp-ext.pid 2>/dev/null)
  if [ "${g:-0}" -gt 1 ] 2>/dev/null && kill -0 "$g" 2>/dev/null &&
    tr '\0' ' ' 2>/dev/null < "/proc/$g/cmdline" | grep -q 'shared-mcp-ext-server'; then
    kill -TERM "$g" && echo "hand-run ext server $g stopped"
  fi
  for f in 6768 8081 18932 18933 18950 18951; do listening "$f" && echo "STILL LISTENING on $f"; done
  echo "abort cleanup done"
}
EOF
cat > /tmp/shared-mcp-envcheck.js <<'EOF'
// Usage: node /tmp/shared-mcp-envcheck.js <tokenFile> <envVar> <pgrp|agent> <pgid|agentId>
// One line per process in scope: pid, comm, and whether <envVar> holds the token, compared by
// sha256. In agent scope it also flags a process that runs its own context7 or gitlab copy.
// Never prints the token, its hash, or any other environment value.
const fs = require("node:fs");
const { createHash } = require("node:crypto");

const [tokenFile, envVar, scope, key] = process.argv.slice(2);
const sha = (value) => createHash("sha256").update(value).digest("hex");
const wanted = sha(fs.readFileSync(tokenFile, "utf8").trim());

function read(pid, name) {
  try {
    return fs.readFileSync(`/proc/${pid}/${name}`, "utf8");
  } catch {
    return null;
  }
}

let inScope = 0;
let matches = 0;
let ownCopies = 0;
for (const pid of fs.readdirSync("/proc").filter((entry) => /^\d+$/.test(entry))) {
  const environ = read(pid, "environ");
  const stat = read(pid, "stat");
  if (environ === null || stat === null) continue;
  const vars = environ.split("\0");
  const pgrp = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[2]);
  const selected =
    scope === "pgrp" ? pgrp === Number(key) : vars.includes(`PASEO_AGENT_ID=${key}`);
  if (!selected) continue;
  inScope += 1;
  const entry = vars.find((item) => item.startsWith(`${envVar}=`));
  let verdict = "missing";
  if (entry !== undefined) {
    verdict = sha(entry.slice(envVar.length + 1)) === wanted ? "match" : "MISMATCH";
  }
  if (verdict === "match") matches += 1;
  const cmdline = (read(pid, "cmdline") ?? "").split("\0").join(" ");
  const ownCopy = scope === "agent" && /context7-mcp|mcp-gitlab/.test(cmdline);
  if (ownCopy) ownCopies += 1;
  const comm = (read(pid, "comm") ?? "?").trim();
  console.log(`${pid} ${comm} ${envVar}=${verdict}${ownCopy ? " OWN-MCP-COPY" : ""}`);
}
console.log(`in scope: ${inScope}, token match: ${matches}, own context7/gitlab copies: ${ownCopies}`);
process.exit(matches > 0 ? 0 : 1);
EOF
cat > /tmp/shared-mcp-ext-server.js <<'EOF'
// Throwaway HTTP server for the shared-mcp manual test. It answers every request with 200, so
// the plugin's probe counts it as alive. Usage: node /tmp/shared-mcp-ext-server.js <port>
const http = require("node:http");

const port = Number(process.argv[2]);
const server = http.createServer((request, response) => {
  request.resume();
  request.on("end", () => {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"jsonrpc":"2.0","id":1,"result":{}}');
  });
});
server.listen(port, "127.0.0.1", () => console.log(`ext-test listening on 127.0.0.1:${port}`));
EOF
: > /tmp/shared-mcp-dev-daemon.out
(umask 077; node -e 'process.stdout.write(require("node:crypto").randomBytes(16).toString("hex"))' > /tmp/shared-mcp-dev-password)
bash -n /tmp/shared-mcp-test.env && node --check /tmp/shared-mcp-envcheck.js && node --check /tmp/shared-mcp-ext-server.js && . /tmp/shared-mcp-test.env && case "$DEV_IP" in 172.22.*) echo "DEV_IP=$DEV_IP" ;; *) echo "refusing to bind '$DEV_IP': not the Docker bridge"; exit 1 ;; esac && stat -c 'dev password file mode %a, %s bytes' /tmp/shared-mcp-dev-password
```

Expected: `DEV_IP=172.22.0.3`, the Docker bridge address the Playwright browser container reaches, then `dev password file mode 600, 32 bytes`. `hostname -i` prints `172.22.0.3 10.200.0.24` on 2026-11-06; the second address is the VPN overlay, and binding it would expose a daemon that creates agents to the corporate network. The env file picks the address by its `172.22.` prefix rather than by position, and both this check and `start_dev_daemon` stop on anything else. On `refusing to bind`, stop: nothing has started yet, so there is nothing to clean up. The password is 32 random hex characters, new for every run of this step, and nothing prints it before Step 12. `npm run dev:server` and `npm run dev:app` cannot be used because their `cross-env` pins `PASEO_LISTEN=127.0.0.1:6768`; `scripts/dev-app.sh` and `npm run dev:server:raw` read `PASEO_LISTEN` from the environment. `start_dev_daemon` skips `scripts/dev-daemon.sh` because it always execs `dev:server:watch` (`scripts/dev-daemon.sh` last lines, `package.json:41`), which runs `watch:protocol` and `watch:client` beside the daemon, outside the lock. The helper sets the same `PASEO_CORS_ORIGINS`, `PASEO_NODE_INSPECT` and `PASEO_LOCAL_MODELS_DIR` the script sets, and pins `PASEO_LOG_FORMAT=json` so the `daemon.log` greps below hold.

- [ ] **Step 2: Pre-flight ports, paths, memory and serena.** Run:

```bash
. /tmp/shared-mcp-test.env
for p in 6767 6768 8000 8081 18932 18933 18950 18951 18952; do if listening "$p"; then echo "$p up"; else echo "$p free"; fi; done
test -e /tmp/shared-mcp-missing-requires || echo "requires path absent"
free -m | awk 'NR == 2 { print "available MB:", $7 }'
pgrep -o -f 'serena start-mcp-server' > /tmp/shared-mcp-serena.pid
echo "serena pid=$(cat /tmp/shared-mcp-serena.pid)"
curl -s -m 2 -o /dev/null -w 'serena GET /mcp %{http_code}\n' http://127.0.0.1:8000/mcp
```

Expected:

```
6767 up
6768 free
8000 up
8081 free
18932 free
18933 free
18950 free
18951 free
18952 free
requires path absent
available MB: <at least 5000>
serena pid=<the uvx root pid, 2856 on 2026-11-06>
serena GET /mcp 406
```

6767 is the live daemon (leave it alone). 18933 must be free too, because context7 silently moves to port+1 when its port is taken. Use a bare GET on serena, never an `initialize` POST: Serena (python mcp 1.28.1) has no session idle timeout, so every POST would leak a session. If any test port is taken, stop and find the owner. When the owner is left over from an earlier run of this task, run **Abort and clean up** and repeat this step. If less than 5000 MB is available, wait: Metro takes about 3 GB and the two test agents about 1 GB.

- [ ] **Step 3: Build the server stack under the lock.** Run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run build:server > /tmp/shared-mcp-build.out 2>&1; echo "exit=$?"; tail -n 5 /tmp/shared-mcp-build.out
```

Expected: `exit=0`. This builds the client, protocol, highlight, plugin SDK and relay `dist` that the dev daemon and Step 6 import, plus the server and CLI `dist`: `npm run cli` runs the CLI source through tsx, but it imports `@getpaseo/server/daemon-control` and `@getpaseo/server/agent-activity`, which resolve to `packages/server/dist`. The daemon itself runs from source, so nothing builds again outside the lock.

Then run the CI gate that starts every built-in from that build, with a throwaway `PASEO_HOME`:

```bash
cd /workspace/utils/paseo && ls -d packages/server/dist/server/builtin-plugins/shared-mcp && node --input-type=module -e 'const { builtinPlugins } = await import("/workspace/utils/paseo/packages/server/dist/server/server/plugins/builtin/index.js"); console.log("shared-mcp listed in the dist build:", builtinPlugins.includes("shared-mcp"));'
H=$(mktemp -d /tmp/shared-mcp-dist-home.XXXXXX) || exit 1
PASEO_HOME="$H" flock /tmp/paseo-heavy.lock timeout 300 node --test --test-reporter=tap scripts/builtin-plugins-dist.test.mjs > /tmp/shared-mcp-dist.out 2>&1; echo "dist test exit=$?"
grep -E '^# (pass|fail|duration_ms)' /tmp/shared-mcp-dist.out
test -e "$H/shared-mcp" && echo "WROTE $H/shared-mcp" || echo "nothing written under the temp home's shared-mcp"
rm -rf "$H"
```

Expected:

```
packages/server/dist/server/builtin-plugins/shared-mcp
shared-mcp listed in the dist build: true
dist test exit=0
# pass 1
# fail 0
# duration_ms <well under 300000>
nothing written under the temp home's shared-mcp
```

`scripts/builtin-plugins-dist.test.mjs` is the gate fork CI runs right after `npm run build:server` (`.github/workflows/fork-ci.yml:95-97`). It compiles every listed built-in from the dist copy, starts each one in this process through `runtime.startBuiltinPlugin` with a temp settings directory, so shared-mcp reads `{ servers: [] }`, and ends with `runtime.stopAll()`. Exit `124` means the run hung at the 300 s `timeout`: a supervisor timer that is not `unref()`ed or a cleanup that never resolves holds the process open, and the daemon's shutdown would hang the same way. `node --test` runs the file in a child process, so after a `124` run `pgrep -af 'builtin-plugins-dist.test.mjs'` and send SIGTERM to any pid it lists, which this step started. Fix the hang in Task 6 or 7 before going on. The last line shows that a start with no servers writes nothing, as Task 7 promises.

`PASEO_HOME` must be a temp dir. The test runs with the shell's own env, and in this container `PASEO_HOME` is `/home/paseo/.paseo`, the live 6767 daemon's home. With it, shared-mcp in the test process would resolve `sharedMcpHome()` to the live `~/.paseo/shared-mcp` and scan its `run/` pid files. The same applies to any local run of `packages/server/src/server/plugins/lifecycle.e2e.test.ts`, which loads the built-ins through `new BuiltinPluginLoader()` (line 1163). Step 45 documents both.

- [ ] **Step 4: Prepare a fresh dev home holding only a copied config.json.** Run:

```bash
. /tmp/shared-mcp-test.env
cd "$REPO"
if [ -f "$DEV_HOME/paseo.pid" ] && kill -0 "$(sup_pid)" 2>/dev/null; then echo "a dev daemon is running on $DEV_HOME; stop it first"; exit 1; fi
if [ -d "$DEV_HOME" ]; then mv "$DEV_HOME" "$REPO/.dev/paseo-home.before-shared-mcp-$(date +%Y%m%d%H%M%S)"; fi
mkdir -p "$DEV_HOME" && chmod 700 "$DEV_HOME"
install -m 600 "$HOME/.paseo/config.json" "$DEV_HOME/config.json"
ls -A "$DEV_HOME"; ls -d "$REPO"/.dev/paseo-home.before-shared-mcp-* 2>/dev/null
node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); console.log("persisted daemon password:", Boolean(c.daemon?.auth?.password))' "$DEV_HOME/config.json"
```

Expected: `config.json` is the only entry, and `persisted daemon password: false`, so the throwaway env password is the only one the dev daemon checks (`packages/server/src/server/config.ts:494-505`). The earlier dev home, which held the session-move test's four agent records, is kept as `.dev/paseo-home.before-shared-mcp-<timestamp>` and not deleted. A missing `~/.paseo/config.json` is not expected in this container; if it happens, stop.

- [ ] **Step 5: Seed the shared-mcp settings file.** Run:

```bash
. /tmp/shared-mcp-test.env
mkdir -p "$(dirname "$SETTINGS_FILE")"
cat > "$SETTINGS_FILE" <<'EOF'
{
  "version": 1,
  "values": {
    "servers": [
      {
        "id": "context7",
        "label": "Context7 (test port 18932)",
        "command": "exec npx -y @upstash/context7-mcp@4.0.4 --transport http --port 18932",
        "port": 18932
      },
      {
        "id": "serena",
        "label": "Serena (external)",
        "command": "echo 'serena must stay external in this test; this command never runs' >&2; exit 1",
        "port": 8000
      },
      {
        "id": "gitlab",
        "label": "GitLab (dummy credentials, test port 18950)",
        "command": "exec npx -y @zereight/mcp-gitlab@2.1.52",
        "env": {
          "STREAMABLE_HTTP": "true",
          "HOST": "127.0.0.1",
          "PORT": "18950",
          "GITLAB_API_URL": "http://127.0.0.1:9/api/v4",
          "GITLAB_PERSONAL_ACCESS_TOKEN": "dummy-not-a-secret",
          "GITLAB_DISABLE_VERSION_CHECK": "true",
          "MAX_REQUESTS_PER_MINUTE": "1000",
          "LOG_FORMAT": "json"
        },
        "port": 18950,
        "bearerToken": { "serverEnv": "STREAMABLE_HTTP_AUTH_TOKEN", "agentEnv": "SHARED_MCP_TEST_TOKEN" }
      },
      {
        "id": "ext-test",
        "label": "Throwaway HTTP server (test port 18951)",
        "command": "exec node /tmp/shared-mcp-ext-server.js 18951",
        "port": 18951
      },
      {
        "id": "blocked-test",
        "label": "Blocked (missing requires path)",
        "command": "echo 'blocked-test must never run' >&2; exit 1",
        "port": 18952,
        "requires": ["/tmp/shared-mcp-missing-requires"]
      }
    ]
  }
}
EOF
chmod 600 "$SETTINGS_FILE"
node -e 'const e = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")); for (const s of e.values.servers) console.log(e.version, s.id, s.port)' "$SETTINGS_FILE"
```

Expected:

```
1 context7 18932
1 serena 8000
1 gitlab 18950
1 ext-test 18951
1 blocked-test 18952
```

Seed the file before the daemon starts. Nothing watches it, and `subscribe()` fires only after a save through the settings RPC. What each definition covers:

- `context7`: an owned server. In `--transport http`, context7 4.0.4 ignores `CONTEXT7_API_KEY` and serves `/mcp` anonymously (`dist/index.js:276-283, 363-365`; the env var is read only in the stdio branch at `:444`), so the command needs no `read-mcp-env.js`.
- `serena`: an external server. Its command is harmless on purpose: if one probe of the live serena failed, the supervisor would start "its own", and on this host that must not be a second uvx serena with language servers.
- `gitlab`: the bearer path. The credentials are dummies and the API URL points at the closed port 9, as in the research spike, so no GitLab call leaves the container. `HOST` is pinned because mcp-gitlab binds whatever `HOST` says. `LOG_FORMAT=json` makes its session log lines plain JSON for the greps in Step 14.
- `ext-test`: external first (Step 7 starts it by hand), then the plugin's own once the hand-run copy dies (Step 27).
- `blocked-test`: the `blocked` state.

- [ ] **Step 6: Parse the seeded file with the real settings schema.** Run:

```bash
. /tmp/shared-mcp-test.env
cd "$REPO" && node --import tsx --input-type=module -e '
import { readFileSync } from "node:fs";
const { sharedMcpSettings } = await import("/workspace/utils/paseo/plugins/shared-mcp/shared/settings.ts");
const envelope = JSON.parse(readFileSync(process.argv[1], "utf8"));
console.log("version matches:", envelope.version === sharedMcpSettings.version);
for (const s of sharedMcpSettings.schema.parse(envelope.values).servers) {
  const bearer = s.bearerToken ? `${s.bearerToken.serverEnv}->${s.bearerToken.agentEnv}` : "no-bearer";
  console.log(s.id, s.port, s.healthPath, s.enabled, Object.keys(s.env).length, JSON.stringify(s.requires), bearer);
}' "$SETTINGS_FILE"
```

Expected:

```
version matches: true
context7 18932 /mcp true 0 [] no-bearer
serena 8000 /mcp true 0 [] no-bearer
gitlab 18950 /mcp true 8 [] STREAMABLE_HTTP_AUTH_TOKEN->SHARED_MCP_TEST_TOKEN
ext-test 18951 /mcp true 0 [] no-bearer
blocked-test 18952 /mcp true 0 ["/tmp/shared-mcp-missing-requires"] no-bearer
```

A ZodError here means the file or Task 1's schema is wrong. Fix it before starting the daemon, or the daemon's `read()` returns `invalid` and nothing starts.

- [ ] **Step 7: Start the throwaway external server by hand.** Run:

```bash
. /tmp/shared-mcp-test.env
: > /tmp/shared-mcp-ext.pid
setsid -f sh -c 'echo $$ > /tmp/shared-mcp-ext.pid; exec node /tmp/shared-mcp-ext-server.js 18951' >> /tmp/shared-mcp-ext.out 2>&1 < /dev/null
wait_for_file /tmp/shared-mcp-ext.pid && timeout 10 bash -c '. /tmp/shared-mcp-test.env; until listening 18951; do sleep 0.2; done' && echo "throwaway pid=$(cat /tmp/shared-mcp-ext.pid) listening on 18951" && curl -s -o /dev/null -w 'probe-like POST %{http_code}\n' -X POST http://127.0.0.1:18951/mcp -H 'content-type: application/json' -d '{}'
```

Expected: `throwaway pid=<H> listening on 18951` and `probe-like POST 200`. `setsid` makes `<H>` its own process group, and `exec` makes it the node process itself.

- [ ] **Step 8: Start the dev daemon.** Run:

```bash
. /tmp/shared-mcp-test.env && start_dev_daemon && wait_for_file /tmp/shared-mcp-dev-daemon.pid && echo "dev session pgid=$(cat /tmp/shared-mcp-dev-daemon.pid)"
```

Expected: `dev session pgid=<N>`. The daemon runs detached in its own session through `npm run dev:server:raw` (`npm run dev --workspace=@getpaseo/server`, so `scripts/dev-runner.ts`, then the supervisor, then the worker from source), with `PASEO_HOME=$DEV_HOME`, `PASEO_LISTEN=172.22.0.3:6768`, `PASEO_PASSWORD` set to the run's random password from `/tmp/shared-mcp-dev-password`, and `PASEO_AGENT_ID`, `PASEO_AGENT_CWD` and `PASEO_HOST` unset. No `tsc --watch` runs beside it.

- [ ] **Step 9: Wait for the daemon, context7 and gitlab.** Run with `run_in_background: true`:

```bash
timeout 300 bash -c '. /tmp/shared-mcp-test.env; until [ "$(dev_health)" = 200 ] && [ -s "$C7_PID_FILE" ] && listening 18932 && [ -s "$GL_PID_FILE" ] && listening 18950; do sleep 2; done' && echo "dev daemon healthy; context7 on 18932, gitlab on 18950" || echo "TIMEOUT waiting for the dev daemon, context7 and gitlab"
```

Expected within about 2 minutes: `dev daemon healthy; context7 on 18932, gitlab on 18950`. `/api/health` needs no password (`packages/server/src/server/auth.ts:117-119`). On `TIMEOUT`, read:

```bash
tail -n 60 /tmp/shared-mcp-dev-daemon.out
grep -v '^{' /workspace/utils/paseo/.dev/paseo-home/daemon.log | tail -n 40
grep shared-mcp /workspace/utils/paseo/.dev/paseo-home/daemon.log | tail -n 20
tail -n 20 /workspace/utils/paseo/.dev/paseo-home/shared-mcp/logs/*.log
```

Then run **Abort and clean up**: the dev daemon and any server it started are still running. The supervisor copies the worker's stdout and stderr into both `daemon.log` and its own stdout, which is the `.out` file (`packages/server/scripts/supervisor.ts:356-363`). The plugin's `console.*` lines arrive there as raw text without a `pluginId` field, so the `grep -v '^{'` pass finds them; `paseo plugin logs shared-mcp` never shows them.

- [ ] **Step 10: Check the plugin load, its files, the process groups and the server token.** Run:

```bash
. /tmp/shared-mcp-test.env
grep -E "^(Home|Listen):" /tmp/shared-mcp-dev-daemon.out | head -n 2
grep '"msg":"Loaded plugin"' "$DEV_HOME/daemon.log" | grep '"pluginId":"shared-mcp"' | grep -o '"methods":\[[^]]*\]'
grep '"msg":"Failed to start built-in plugin"' "$DEV_HOME/daemon.log" | grep -c '"pluginId":"shared-mcp"'
C7=$(pgid_of "$C7_PID_FILE"); GL=$(pgid_of "$GL_PID_FILE"); echo "context7 pgid=$C7 gitlab pgid=$GL"
pgrep -g "$C7" | xargs -r ps -o pid=,ppid=,pgid=,args= -p
echo "context7 $(group_rss_mb "$C7"), gitlab $(group_rss_mb "$GL")"
ls "$SMCP/run" "$SMCP/logs"
grep -c "running on HTTP at http://localhost:18932/mcp" "$SMCP/logs/context7.log"
grep -c "running with Streamable HTTP transport" "$SMCP/logs/gitlab.log"
bound_everywhere 18932 && echo "context7 listens on [::]:18932, every interface"
stat -c 'token mode %a' "$SMCP/token"
(umask 077; sha256sum "$SMCP/token" | cut -d' ' -f1 > /tmp/shared-mcp-token.sha)
token_check STREAMABLE_HTTP_AUTH_TOKEN pgrp "$GL"
echo "context7 group: $(paseo_env_count "$C7")"; echo "gitlab group: $(paseo_env_count "$GL")"
for id in serena ext-test blocked-test; do test -e "$SMCP/logs/$id.log" || echo "$id never spawned"; done
curl -s -o /dev/null -w 'context7 initialize %{http_code}\n' -X POST http://127.0.0.1:18932/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"shared-mcp-manual-test","version":"0"}}}'
curl -s -o /dev/null -w 'gitlab initialize without bearer %{http_code}\n' -X POST http://127.0.0.1:18950/mcp -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"shared-mcp-manual-test","version":"0"}}}'
```

Expected:

- `Home:    /workspace/utils/paseo/.dev/paseo-home` and `Listen:  172.22.0.3:6768`.
- `"methods":[...]` holds `shared-mcp.status.request`, `shared-mcp.restart.request`, `settings.servers.read`, `settings.servers.write` and `settings.servers.reset`, in any order. That proves `handle()` and `registerSettings()` ran before `ready`.
- `0` failed starts.
- `context7 pgid=<P> gitlab pgid=<G>`. Every listed context7 process (`npm exec @upstash/context7-mcp@4.0.4 ...`, then `sh -c context7-mcp ...`, then `node .../context7-mcp --transport http --port 18932`) has pgid `<P>`, and the leader's pid equals `<P>`.
- RSS around 80-200 MB for context7 and 80-250 MB for gitlab.
- `run`: `context7.pid` and `gitlab.pid` only. `logs`: `context7.log` and `gitlab.log` only.
- Both log line counts `1`.
- `context7 listens on [::]:18932, every interface`: context7 4.0.4 calls `app.listen(port)` with no host and has no host option, so it also answers on 172.22.0.3 and the VPN address. This is a known gap against the spec's "All bound to 127.0.0.1" (see the deviations), not a plugin bug.
- `token mode 600`.
- One line per gitlab process, each `STREAMABLE_HTTP_AUTH_TOKEN=match`, then `in scope: <n>, token match: <n>` with both numbers equal. The server env holds exactly the token file's value.
- `context7 group: processes <n>, with a PASEO_ variable 0` and `gitlab group: processes <n>, with a PASEO_ variable 0`, with `<n>` at least 1 in each. The dev daemon runs with `PASEO_PASSWORD`, `PASEO_HOME`, `PASEO_LISTEN` and more, so `0` proves `spawnServer` strips every `PASEO_*` key before it starts a server (Task 4). The helper prints counts only, never a name or value. Any other count is a Task 4 bug: the daemon password would reach third-party `npx` packages.
- `serena never spawned`, `ext-test never spawned` (the hand-run copy answers, so the plugin adopted it as `external`) and `blocked-test never spawned`.
- `context7 initialize 200`. context7 is stateless: it returns no `mcp-session-id`, so the probe sends it no DELETE.
- `gitlab initialize without bearer 401`: the server refuses requests without the token.

- [ ] **Step 11: Start Metro under the heavy-command lock.** Run:

```bash
. /tmp/shared-mcp-test.env
: > /tmp/shared-mcp-dev-app.pid
(cd "$REPO" && setsid -f sh -c 'echo $$ > /tmp/shared-mcp-dev-app.pid; exec flock /tmp/paseo-heavy.lock env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_PASSWORD PASEO_HOME="$1" PASEO_LISTEN="$2:6768" scripts/dev-app.sh' sh "$DEV_HOME" "$DEV_IP" > /tmp/shared-mcp-dev-app.out 2>&1 < /dev/null)
wait_for_file /tmp/shared-mcp-dev-app.pid && echo "metro session pgid=$(cat /tmp/shared-mcp-dev-app.pid)"
```

Then run with `run_in_background: true`:

```bash
timeout 900 bash -c 'until grep -q "Waiting on http://localhost:8081" /tmp/shared-mcp-dev-app.out; do sleep 2; done' && grep -m3 -E "Metro:|Daemon:|Waiting on" /tmp/shared-mcp-dev-app.out || echo "TIMEOUT waiting for Metro"
```

Expected: `Metro:   http://localhost:8081`, `Daemon:  172.22.0.3:6768` and `Waiting on http://localhost:8081`. The wait includes any time spent queued for the lock. Metro holds the lock until Step 44, so other agents' heavy commands wait; keep the browser steps short. The lock covers Metro's whole life, not only the bundle build, because Metro keeps its memory after the bundle is built, and a typecheck started beside it is what froze the host. From here on, every failure goes through **Abort and clean up**, which stops Metro and so releases the lock.

- [ ] **Step 12: Open the app in a new tab and add the dev host with the throwaway password.** The Playwright browser is the shared CDP Chrome, so open a tab of your own and do not navigate an existing one. Call `mcp__playwright__browser_tabs` with `{"action": "new", "url": "http://172.22.0.3:8081/"}`. Then run with `run_in_background: true`:

```bash
timeout 900 bash -c 'until grep -qE "Web Bundled|Bundling failed" /tmp/shared-mcp-dev-app.out; do sleep 3; done' && grep -m1 -E "Web Bundled|Bundling failed" /tmp/shared-mcp-dev-app.out || echo "TIMEOUT waiting for the web bundle"
```

Expected: `Web Bundled <ms>ms ... (<n> modules)`, about 3 minutes on the first build.

The app has no password prompt for the `EXPO_PUBLIC_LOCAL_DAEMON` override: `runConfiguredOverrideBootstrap` retries forever without a password (`packages/app/src/runtime/host-runtime.ts:1860-1884`), and a host stored by an earlier dev run for the same address would only show "Remove this host and add it again with the password this daemon asks for" (`packages/app/src/i18n/resources/en.ts:2846`). So clear the dev origin's host list and add the host by hand:

1. Call `mcp__playwright__browser_evaluate` with `{"function": "() => { localStorage.removeItem(\"@paseo:daemon-registry\"); return \"host registry cleared\"; }"}`. This touches only the `http://172.22.0.3:8081` origin.
2. Call `mcp__playwright__browser_navigate` with `{"url": "http://172.22.0.3:8081/"}` to reload.
3. Take `mcp__playwright__browser_snapshot`: it shows "Welcome to Paseo" with a `Direct connection` option. Click it.
4. Print the run's password with `cat /tmp/shared-mcp-dev-password; echo`. Fill `Host` with `172.22.0.3`, `Port` with `6768` and `Password` with that value (`mcp__playwright__browser_fill_form` or one `mcp__playwright__browser_type` per field), then click `Connect`. If a "Connect to this host?" dialog follows, click its `Connect`.

Expected: a fresh snapshot shows the Paseo app connected to the dev host, with no error overlay. The password now appears in the transcript, because the form needs it typed in. It was made by Step 1 for this run, guards only this dev daemon on the Docker bridge, and guards nothing once Step 43 stops it; Step 44 deletes the file.

- [ ] **Step 13: Open the Servers screen from the Command Center.** Print the expected route parts first:

```bash
. /tmp/shared-mcp-test.env && echo "server-id=$(cat "$DEV_HOME/server-id")" && echo "context7 rss now: $(group_rss_mb "$(pgid_of "$C7_PID_FILE")"), gitlab rss now: $(group_rss_mb "$(pgid_of "$GL_PID_FILE")")"
```

Then call `mcp__playwright__browser_press_key` with `{"key": "Control+k"}` (the non-Mac Command Center binding, `packages/app/src/keyboard/keyboard-shortcuts.ts:876-885`). Take `mcp__playwright__browser_snapshot`, type `Shared MCP` into the Command Center input with `mcp__playwright__browser_type`, and click the item `Shared MCP servers` with `mcp__playwright__browser_click`.

Expected: the URL is `http://172.22.0.3:8081/settings/hosts/<server-id>/plugins/shared-mcp/servers`. The header reads `shared-mcp`, because built-ins have no list entry and the header falls back to the plugin id. Two tabs show, `Servers` and `Definitions`. The snapshot shows five rows:

- `Context7 (test port 18932)`: state `healthy`, restarts `0`, uptime under a few minutes, RSS within about 10% of the shell figure above, no last error, a log tail holding `Context7 Documentation MCP Server v4.0.4 running on HTTP at http://localhost:18932/mcp`, a `Restart` button, and the enable switch on.
- `Serena (external)`: state `external`, restarts `0`, no pid or RSS, no last error.
- `GitLab (dummy credentials, test port 18950)`: state `healthy`, restarts `0`, RSS within about 10% of the shell figure, no last error, a log tail holding `GitLab MCP Server running with Streamable HTTP transport`.
- `Throwaway HTTP server (test port 18951)`: state `external`, no pid or RSS.
- `Blocked (missing requires path)`: state `blocked`, no pid or RSS, a last error naming `/tmp/shared-mcp-missing-requires`.

Built-ins have no row in Settings > Plugins, so this Command Center item is the only way in. If it is missing, Task 8 is incomplete: run **Abort and clean up** first, because Metro holds the heavy lock that Task 8's typecheck needs, then fix Task 8 and start again from Step 1.

- [ ] **Step 14: Prove the gitlab probe sends the bearer token on both requests, and record RSS before the agents.** Run:

```bash
. /tmp/shared-mcp-test.env
if timeout 60 bash -c '. /tmp/shared-mcp-test.env; until set -- $(gitlab_health) && [ "${2:-0}" -gt 65 ]; do sleep 2; done'; then
  echo "gitlab activeSessions uptime: $(gitlab_health)"
  echo "sessions opened by probes: $(grep -c 'Streamable HTTP session initialized' "$SMCP/logs/gitlab.log")"
else
  echo "TIMEOUT: gitlab /health unreachable or uptime still under 65 s"
fi
echo "RSS before agents: context7 $(group_rss_mb "$(pgid_of "$C7_PID_FILE")"), gitlab $(group_rss_mb "$(pgid_of "$GL_PID_FILE")")"
```

Expected: `gitlab activeSessions uptime: 0 <seconds, over 65>`, `sessions opened by probes: <at least 3, about one per 30 s of uptime>`, and the two RSS figures. mcp-gitlab opens a session only for an initialize that passed bearer auth, and logs each one; a DELETE without the bearer gets 401 and leaves the session open. So a count of 3 or more with `activeSessions` 0 proves the probe sends `Authorization: Bearer` on the POST and again on the DELETE. A count of `0` means the probe's initialize never opened a session: check that `probeMcp` sends the bearer header and `accept: application/json, text/event-stream`. An `activeSessions` that grows with uptime means the DELETE lacks the header.

- [ ] **Step 15: Prepare the agents' project directory.** Run:

```bash
. /tmp/shared-mcp-test.env
rm -rf "$AGENT_DIR" && mkdir -p "$AGENT_DIR/.claude"
cat > "$AGENT_DIR/.mcp.json" <<'JSON'
{
  "mcpServers": {
    "shared-context7": { "type": "http", "url": "http://127.0.0.1:18932/mcp" },
    "shared-gitlab": {
      "type": "http",
      "url": "http://127.0.0.1:18950/mcp",
      "headers": { "Authorization": "Bearer ${SHARED_MCP_TEST_TOKEN}" }
    }
  }
}
JSON
cat > "$AGENT_DIR/.claude/settings.local.json" <<'JSON'
{ "enabledMcpjsonServers": ["shared-context7", "shared-gitlab"] }
JSON
grep -c 'SHARED_MCP_TEST_TOKEN' "$AGENT_DIR/.mcp.json"; ls -A "$AGENT_DIR"
```

Expected: `1` (the literal `${SHARED_MCP_TEST_TOKEN}` reference; no token is written anywhere) and `.claude .mcp.json`. The names `shared-context7` and `shared-gitlab` do not collide with the user-scope servers. `/tmp` has no parent `.mcp.json`, so the agent loads no stdio context7 or gitlab of its own.

- [ ] **Step 16: Create one Claude agent through the CLI on the dev daemon.** Run with `run_in_background: true`:

```bash
. /tmp/shared-mcp-test.env && dev_cli run --provider claude --mode bypassPermissions --cwd "$AGENT_DIR" --title shared-mcp-claude --wait-timeout 5m --json "Call the resolve-library-id tool of the shared-context7 MCP server with libraryName zod and query 'zod schema validation'. Reply with the first library ID it returns and nothing else." > /tmp/shared-mcp-claude.json; echo "exit=$?"; run_result /tmp/shared-mcp-claude.json | tee /tmp/shared-mcp-claude.id; echo "resolve-library-id calls completed: $(resolve_calls "$(cut -d' ' -f1 /tmp/shared-mcp-claude.id)")"
```

Expected: `exit=0`, `<claude agent id> completed`, and `resolve-library-id calls completed: 1`. The agent opened through `agent.open.before`, reached context7 over HTTP, and ran one tool call. If the status is `permission`, run `. /tmp/shared-mcp-test.env && dev_cli permit allow "$(cut -d' ' -f1 /tmp/shared-mcp-claude.id)" --all && dev_cli wait "$(cut -d' ' -f1 /tmp/shared-mcp-claude.id)"` once. If the count is `0`, read `dev_cli logs <id>`: a reply saying the tool is unavailable means Claude Code did not load the project servers, so check `$AGENT_DIR/.claude/settings.local.json`.

- [ ] **Step 17: Confirm the Claude agent's env carries the token and its gitlab session uses it.** Run:

```bash
. /tmp/shared-mcp-test.env
CL=$(cut -d' ' -f1 /tmp/shared-mcp-claude.id)
token_check SHARED_MCP_TEST_TOKEN agent "$CL"
echo "gitlab activeSessions uptime: $(gitlab_health)"
```

Expected: one line per process carrying `PASEO_AGENT_ID=<claude agent id>`. The Claude Code process shows `SHARED_MCP_TEST_TOKEN=match`; children it started may show `match` or `missing`, and none shows `MISMATCH` or `OWN-MCP-COPY`. The summary reads `in scope: <n>, token match: <at least 1>, own context7/gitlab copies: 0`. `activeSessions` is at least `1`: Claude Code expanded `${SHARED_MCP_TEST_TOKEN}` in the header and gitlab accepted it. A literal or wrong token would get 401 and open no session.

- [ ] **Step 18: Create one Kiro agent through the CLI on the dev daemon.** Run with `run_in_background: true`:

```bash
. /tmp/shared-mcp-test.env && dev_cli run --provider kiro --cwd "$AGENT_DIR" --title shared-mcp-kiro --wait-timeout 5m --json "Reply with the single word ready. Do not call any tool." > /tmp/shared-mcp-kiro.json; echo "exit=$?"; run_result /tmp/shared-mcp-kiro.json
```

Expected: `exit=0` and `<kiro agent id> completed`. If it ends in `error`, read `dev_cli logs <id>`; a kiro-cli login error means this container's Kiro session expired. Record it, skip Step 19's token line, and keep going: the docs already call Kiro's header expansion unverified.

- [ ] **Step 19: Confirm the Kiro agent's env carries the token, then archive it.** Run:

```bash
. /tmp/shared-mcp-test.env
KI=$(run_result /tmp/shared-mcp-kiro.json | cut -d' ' -f1)
token_check SHARED_MCP_TEST_TOKEN agent "$KI"
dev_cli agent archive "$KI" --force
if timeout 30 bash -c '. /tmp/shared-mcp-test.env; until [ "$(agent_proc_count "$1")" = 0 ]; do sleep 1; done' _ "$KI"; then echo "no process left for kiro agent $KI"; else echo "TIMEOUT: kiro agent $KI still has processes"; fi
```

Expected: the `kiro-cli` processes show `SHARED_MCP_TEST_TOKEN=match`, and the summary has `token match: <at least 1>`. Lines marked `OWN-MCP-COPY` are expected for Kiro: `~/.kiro/settings/mcp.json` still links to `/workspace/.agent-tools/mcp.json`, which lists stdio context7 and gitlab until the rollout. Then `no process left for kiro agent <id>`. This proves the hook's env reaches the Kiro ACP spawn. It does not test whether Kiro CLI expands `${VAR}` in MCP headers; the docs state that as unverified.

- [ ] **Step 20: Record RSS after the agents connected.** Run:

```bash
. /tmp/shared-mcp-test.env
echo "RSS after agents: context7 $(group_rss_mb "$(pgid_of "$C7_PID_FILE")"), gitlab $(group_rss_mb "$(pgid_of "$GL_PID_FILE")")"
token_check SHARED_MCP_TEST_TOKEN agent "$(cut -d' ' -f1 /tmp/shared-mcp-claude.id)" | tail -n 1
```

Expected: each shared group within about 30 MB of its Step 14 figure, and `own context7/gitlab copies: 0` for the Claude agent. Today every agent starts its own stdio copies, measured at about 80 MB for context7 and 150 MB for gitlab per agent (8 context7-mcp at 655 MB and 6 mcp-gitlab at 900 MB on 2026-11-06).

- [ ] **Step 21: Kill context7's process group mid-session and wait for the restart.** Run:

```bash
. /tmp/shared-mcp-test.env
OLD=$(pgid_of "$C7_PID_FILE"); echo "old pgid=$OLD at $(date +%T)"
[ "${OLD:-0}" -gt 1 ] && kill -KILL -- "-$OLD"
if timeout 60 bash -c '. /tmp/shared-mcp-test.env; until NEW=$(pgid_of "$C7_PID_FILE") && [ "$NEW" != "$1" ] && group_alive "$NEW" && listening 18932; do sleep 1; done' _ "$OLD"; then
  echo "new pgid=$(pgid_of "$C7_PID_FILE") at $(date +%T)"
  group_alive "$OLD" || echo "old group $OLD gone"
  grep -c "running on HTTP at http://localhost:18932/mcp" "$SMCP/logs/context7.log"
else
  echo "TIMEOUT: context7 did not come back within 60 s"
fi
```

Expected: a new pgid different from the old one, about 5-10 s later (2 s backoff, npx start, then the 1 s startup probe), `old group <OLD> gone`, and a log line count of `2`, because the log file is appended across restarts. The Claude agent's session stays open throughout.

- [ ] **Step 22: Confirm the restart on the Servers screen.** Call `mcp__playwright__browser_wait_for` with `{"time": 10}` (the screen polls every 5 s), then `mcp__playwright__browser_snapshot`.

Expected: context7 shows state `healthy`, restarts `1`, and an uptime that restarted from zero. The last error may name the SIGKILL exit. gitlab is still `healthy` with restarts `0`; serena and the throwaway server are still `external`.

- [ ] **Step 23: Confirm the Claude agent's next MCP call succeeds.** Run with `run_in_background: true`:

```bash
. /tmp/shared-mcp-test.env && CL=$(cut -d' ' -f1 /tmp/shared-mcp-claude.id) && dev_cli send "$CL" --prompt "Call the resolve-library-id tool of the shared-context7 MCP server again, with libraryName react and query 'react hooks'. Reply with the first library ID it returns and nothing else." --json > /tmp/shared-mcp-claude-send.json; echo "exit=$?"; echo "resolve-library-id calls completed: $(resolve_calls "$CL")"
```

Expected: `exit=0` and `resolve-library-id calls completed: 2`. The agent reached the restarted context7 without being reopened.

- [ ] **Step 24: Archive the Claude agent.** Run:

```bash
. /tmp/shared-mcp-test.env
CL=$(cut -d' ' -f1 /tmp/shared-mcp-claude.id)
dev_cli agent archive "$CL" --force
if timeout 30 bash -c '. /tmp/shared-mcp-test.env; until [ "$(agent_proc_count "$1")" = 0 ]; do sleep 1; done' _ "$CL"; then echo "no process left for claude agent $CL"; else echo "TIMEOUT: claude agent $CL still has processes"; fi
```

Expected: `no process left for claude agent <id>`. Archived agents are not resumed when the dev daemon restarts in Steps 38 and 41.

- [ ] **Step 25: Freeze context7 so its probes fail, and watch the unhealthy restart.** Run:

```bash
. /tmp/shared-mcp-test.env
OLD=$(pgid_of "$C7_PID_FILE"); echo "$OLD" > /tmp/shared-mcp-c7.pgid; echo "stopping context7 group $OLD at $(date +%T)"
[ "${OLD:-0}" -gt 1 ] && kill -STOP -- "-$OLD"
```

Then run with `run_in_background: true`:

```bash
. /tmp/shared-mcp-test.env; OLD=$(cat /tmp/shared-mcp-c7.pgid); if timeout 150 bash -c '. /tmp/shared-mcp-test.env; until ! group_alive "$1" && NEW=$(pgid_of "$C7_PID_FILE") && [ "$NEW" != "$1" ] && group_alive "$NEW" && listening 18932; do sleep 2; done' _ "$OLD"; then echo "unhealthy restart: group $OLD gone, new pgid $(pgid_of "$C7_PID_FILE") at $(date +%T)"; listening 18933 || echo "18933 free"; else echo "TIMEOUT: group $OLD was not replaced and is still frozen; run Abort and clean up, which resumes it"; fi
```

While it runs, call `mcp__playwright__browser_evaluate` with:

```json
{
  "function": "async () => { const deadline = Date.now() + 90000; while (Date.now() < deadline) { if (document.body.innerText.includes(\"unhealthy\")) return \"unhealthy shown\"; await new Promise((resolve) => setTimeout(resolve, 1000)); } return \"unhealthy not shown within 90 s\"; }"
}
```

Expected: the evaluate returns `unhealthy shown` within about 40 s (the next 30 s tick plus the 5 s probe timeout plus the 5 s screen poll). The background loop then prints `unhealthy restart: group <OLD> gone, new pgid <N>` between about 45 s and 100 s after the STOP, and `18933 free`. A stopped process still holds its listening socket, so the loop also requires the old group to be gone, and `18933 free` shows the new context7 got 18932 rather than moving up a port. The process never exited, so only the two failed probes in a row can have triggered this restart, and the stop's SIGKILL after the 5 s grace removed the frozen group.

- [ ] **Step 26: Confirm the unhealthy restart on the Servers screen.** Call `mcp__playwright__browser_wait_for` with `{"time": 10}`, then `mcp__playwright__browser_snapshot`.

Expected: context7 shows `healthy`, restarts `2`, and the last error names the failed probe (a timeout). The other four rows are unchanged.

- [ ] **Step 27: Kill the hand-run external server and let the plugin start its own.** Run:

```bash
. /tmp/shared-mcp-test.env
HAND=$(cat /tmp/shared-mcp-ext.pid); echo "throwaway pid=$HAND"
[ "${HAND:-0}" -gt 1 ] && kill -TERM "$HAND"
```

Then run with `run_in_background: true`:

```bash
. /tmp/shared-mcp-test.env; HAND=$(cat /tmp/shared-mcp-ext.pid); timeout 120 bash -c '. /tmp/shared-mcp-test.env; until ! kill -0 "$1" 2>/dev/null && N=$(pgid_of "$EXT_PID_FILE") && [ "$N" != "$1" ] && group_alive "$N" && listening 18951; do sleep 2; done' _ "$HAND" && echo "plugin started its own ext-test as pgid $(pgid_of "$EXT_PID_FILE")" || echo "TIMEOUT: the plugin did not start its own ext-test"
```

Expected: `plugin started its own ext-test as pgid <E>` within about one or two 30 s probe ticks. Then call `mcp__playwright__browser_wait_for` with `{"time": 10}` and `mcp__playwright__browser_snapshot`: the throwaway row shows `healthy` with a pid and RSS instead of `external`, and a log tail holding `ext-test listening on 127.0.0.1:18951`.

- [ ] **Step 28: Change only the context7 label in the Definitions tab, and confirm it applies in place.** Task 6 updates `label` without a restart, so this edit must keep context7's process group, and with it every agent session connected to it. Record the groups and print the edited definitions first:

```bash
. /tmp/shared-mcp-test.env
pgid_of "$C7_PID_FILE" | tee /tmp/shared-mcp-c7.pgid
for id in gitlab ext-test; do echo "$id $(pgid_of "$SMCP/run/$id.pid")"; done | tee /tmp/shared-mcp-pre-edit
node -e 'const fs = require("fs"); const e = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const servers = e.values.servers.map((s) => (s.id === "context7" ? Object.assign({}, s, { label: "Context7 (edited in Definitions)" }) : s));
fs.writeFileSync("/tmp/shared-mcp-edit.json", JSON.stringify(servers, null, 2) + "\n");' "$SETTINGS_FILE"
cat /tmp/shared-mcp-edit.json
```

Then click the `Definitions` tab and take `mcp__playwright__browser_snapshot`. The JSON editor shows all five definitions with the schema defaults filled in by `read()` (`"env": {}`, `"healthPath": "/mcp"`, `"requires": []` and `"enabled": true` where the seed left them out). Call `mcp__playwright__browser_type` on the editor with the full text printed above (Playwright's fill replaces the editor content), then click `Save` in the `Save definitions` row. Expected: no validation error, and the save completes. The printed JSON holds only the dummy gitlab credential, no secret.

Click the `Servers` tab, call `mcp__playwright__browser_wait_for` with `{"time": 10}` and take `mcp__playwright__browser_snapshot`. Expected: the first row reads `Context7 (edited in Definitions)`, state `healthy`, restarts still `2` as in Step 26. The label on this screen comes from the status RPC, which reads the supervisor's own copy of the definition, so the new label shows only once `apply()` has run. Then run:

```bash
. /tmp/shared-mcp-test.env
node -e 'for (const s of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).values.servers) console.log(s.id, "label:", s.label)' "$SETTINGS_FILE"
P=$(cat /tmp/shared-mcp-c7.pgid)
if [ "$(pgid_of "$C7_PID_FILE")" = "$P" ] && group_alive "$P" && listening 18932; then echo "context7 kept pgid $P: the label changed in place"; else echo "RESTARTED: context7 left group $P for a label-only edit"; fi
```

Expected:

```
context7 label: Context7 (edited in Definitions)
serena label: Serena (external)
gitlab label: GitLab (dummy credentials, test port 18950)
ext-test label: Throwaway HTTP server (test port 18951)
blocked-test label: Blocked (missing requires path)
context7 kept pgid <P>: the label changed in place
```

The check runs at least 10 s after the save. A restart would have replaced the pid file within a few seconds of the save, because context7 exits on SIGTERM at once and the pid file names the new group as soon as it spawns, and the screen would show restarts `3`. A `RESTARTED` line, or restarts `3`, means Task 6 treats `label` as a process field, so a rename would drop every connected agent: stop and run **Abort and clean up**.

- [ ] **Step 29: Add an env entry to context7 in the Definitions tab, and confirm it restarts.** `env` is a process field, so this edit must replace context7's group and leave the other servers alone. Print the edited definitions first:

```bash
. /tmp/shared-mcp-test.env
pgid_of "$C7_PID_FILE" | tee /tmp/shared-mcp-c7.pgid
node -e 'const fs = require("fs"); const e = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
const servers = e.values.servers.map((s) => (s.id === "context7" ? Object.assign({}, s, { env: Object.assign({}, s.env, { SHARED_MCP_EDIT_TEST: "1" }) }) : s));
fs.writeFileSync("/tmp/shared-mcp-edit.json", JSON.stringify(servers, null, 2) + "\n");' "$SETTINGS_FILE"
cat /tmp/shared-mcp-edit.json
```

Then click the `Definitions` tab, call `mcp__playwright__browser_type` on the editor with the full text printed above, and click `Save` in the `Save definitions` row. Expected: no validation error, and the save completes. Then run:

```bash
. /tmp/shared-mcp-test.env
node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).values.servers.find((s) => s.id === "context7"); console.log("context7 label:", c.label, "env:", JSON.stringify(c.env))' "$SETTINGS_FILE"
OLD=$(cat /tmp/shared-mcp-c7.pgid)
if timeout 60 bash -c '. /tmp/shared-mcp-test.env; until N=$(pgid_of "$C7_PID_FILE") && [ "$N" != "$1" ] && group_alive "$N" && listening 18932; do sleep 1; done' _ "$OLD"; then
  N=$(pgid_of "$C7_PID_FILE"); echo "context7 restarted for its changed env as pgid $N"
  group_alive "$OLD" || echo "old group $OLD gone"
  grep -qzx 'SHARED_MCP_EDIT_TEST=1' "/proc/$N/environ" && echo "the new leader has SHARED_MCP_EDIT_TEST=1"
  while read -r id g; do if [ "$(pgid_of "$SMCP/run/$id.pid")" = "$g" ]; then echo "$id kept pgid $g"; else echo "$id RESTARTED"; fi; done < /tmp/shared-mcp-pre-edit
else
  echo "TIMEOUT: context7 kept its old group after an env change"
fi
```

Expected:

```
context7 label: Context7 (edited in Definitions) env: {"SHARED_MCP_EDIT_TEST":"1"}
context7 restarted for its changed env as pgid <N>
old group <P> gone
the new leader has SHARED_MCP_EDIT_TEST=1
gitlab kept pgid <G>
ext-test kept pgid <E>
```

`apply()` waits for the old group to stop before it spawns, so the old group is gone by the time the pid file names the new one. The leader's environment shows the new entry reached the spawn. Click the `Servers` tab, call `mcp__playwright__browser_wait_for` with `{"time": 10}` and take a snapshot. Expected: the first row reads `Context7 (edited in Definitions)`, state `healthy`, restarts `3`, and no last error. Task 6 counts the spawn for a changed definition, and that restart clears the probe timeout Step 26 left as the last error. The gitlab and ext-test rows are unchanged.

- [ ] **Step 30: Try to save a duplicate port in the Definitions tab.** Prepare the drafts:

```bash
. /tmp/shared-mcp-test.env
sha256sum "$SETTINGS_FILE" | cut -d' ' -f1 > /tmp/shared-mcp-settings.sha
node -e 'const fs = require("fs"); const e = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
fs.writeFileSync("/tmp/shared-mcp-saved.json", JSON.stringify(e.values.servers, null, 2) + "\n");
const dup = e.values.servers.map((s) => (s.id === "blocked-test" ? Object.assign({}, s, { port: 18932 }) : s));
fs.writeFileSync("/tmp/shared-mcp-dup.json", JSON.stringify(dup, null, 2) + "\n");' "$SETTINGS_FILE"
cat /tmp/shared-mcp-dup.json
```

Then click the `Definitions` tab, call `mcp__playwright__browser_type` on the editor with the full text of `/tmp/shared-mcp-dup.json`, click the save button, and take `mcp__playwright__browser_snapshot`.

Expected: the editor shows a validation error about the duplicate port 18932 (the superRefine message from the full settings schema), and nothing is saved.

- [ ] **Step 31: Revert the draft and confirm nothing was written.** Call `mcp__playwright__browser_type` on the editor with the full text of `/tmp/shared-mcp-saved.json` (print it with `cat` first), do not save, and click the `Servers` tab. Then run:

```bash
. /tmp/shared-mcp-test.env
[ "$(sha256sum "$SETTINGS_FILE" | cut -d' ' -f1)" = "$(cat /tmp/shared-mcp-settings.sha)" ] && echo "servers.json unchanged" || echo "servers.json CHANGED"
node -e 'for (const s of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).values.servers) console.log(s.id, s.port)' "$SETTINGS_FILE"
```

Expected: `servers.json unchanged`, and the ports read `context7 18932`, `serena 8000`, `gitlab 18950`, `ext-test 18951`, `blocked-test 18952`. The Servers screen still shows `blocked-test` as `blocked`.

- [ ] **Step 32: Record context7's group, then disable it from the screen.** Run:

```bash
. /tmp/shared-mcp-test.env && pgid_of "$C7_PID_FILE" | tee /tmp/shared-mcp-c7.pgid
```

Then find the context7 enable switch in a fresh snapshot and click it off with `mcp__playwright__browser_click`.

Expected: the switch is off. This saves `settings.servers.write` with the current revision. The saved state reaches `subscribe()`, and the plugin calls `Supervisor.apply()`.

- [ ] **Step 33: Confirm the process is gone.** Run:

```bash
. /tmp/shared-mcp-test.env
P=$(cat /tmp/shared-mcp-c7.pgid)
timeout 30 bash -c '. /tmp/shared-mcp-test.env; until ! group_alive "$1" && ! listening 18932; do sleep 1; done' _ "$P" && echo "context7 group $P gone, 18932 closed" || echo "TIMEOUT: context7 group $P still alive"
test -e "$C7_PID_FILE" || echo "no context7 pid file"
node -e 'for (const s of JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).values.servers) console.log(s.id, "enabled:", s.enabled)' "$SETTINGS_FILE"
```

Expected:

```
context7 group <P> gone, 18932 closed
no context7 pid file
context7 enabled: false
serena enabled: true
gitlab enabled: true
ext-test enabled: true
blocked-test enabled: true
```

A snapshot after `{"time": 10}` shows context7 as `disabled`, with no pid or RSS. The other rows are unchanged.

- [ ] **Step 34: Re-enable context7.** Click the context7 switch on. Then run:

```bash
timeout 60 bash -c '. /tmp/shared-mcp-test.env; until N=$(pgid_of "$C7_PID_FILE") && group_alive "$N" && listening 18932; do sleep 1; done' && . /tmp/shared-mcp-test.env && echo "context7 back as pgid $(pgid_of "$C7_PID_FILE")" || echo "TIMEOUT: context7 did not come back"
```

Expected: `context7 back as pgid <new>`. After `{"time": 10}`, the snapshot shows context7 as `healthy` with the switch on, and `servers.json` has `context7 enabled: true`.

- [ ] **Step 35: Restart context7 from its button.** Run `. /tmp/shared-mcp-test.env && pgid_of "$C7_PID_FILE" | tee /tmp/shared-mcp-c7.pgid`, note the restarts count shown on the screen, and click context7's `Restart`. Then run:

```bash
timeout 60 bash -c '. /tmp/shared-mcp-test.env; until N=$(pgid_of "$C7_PID_FILE") && [ "$N" != "$1" ] && group_alive "$N" && listening 18932; do sleep 1; done' _ "$(cat /tmp/shared-mcp-c7.pgid)" && echo "restart RPC replaced the group" || echo "TIMEOUT: the restart RPC did not replace the group"
```

Expected: `restart RPC replaced the group`. The click shows no error, because `restartRpc` returned `{ ok: true, error: null }` after stop plus spawn. After `{"time": 10}`, the snapshot shows the restarts count up by exactly 1 and the state `healthy`.

- [ ] **Step 36: Stop the dev daemon gracefully by PID.** Run:

```bash
. /tmp/shared-mcp-test.env
SUP=$(sup_pid)
for f in "$SMCP"/run/*.pid; do echo "$(basename "$f" .pid) $(pgid_of "$f")"; done | tee /tmp/shared-mcp-groups
echo "supervisor=$SUP dev session=$(cat /tmp/shared-mcp-dev-daemon.pid)"
[ "${SUP:-0}" -gt 1 ] && kill -TERM "$SUP"
if timeout 30 bash -c 'while kill -0 "$1" 2>/dev/null; do sleep 1; done' _ "$SUP"; then echo "supervisor $SUP exited"; else echo "TIMEOUT: supervisor $SUP still running"; fi
```

Expected: three group lines, `context7 <pgid>`, `ext-test <pgid>` and `gitlab <pgid>`, then `supervisor <SUP> exited` within about 10 s. SIGTERM goes to the supervisor, which owns `paseo.pid`; it asks the worker to shut down, the worker calls `daemon.stop()`, and the plugin cleanup runs inside the 2 s in-process budget.

- [ ] **Step 37: Confirm no orphan after the graceful stop.** Run:

```bash
. /tmp/shared-mcp-test.env
DEVG=$(cat /tmp/shared-mcp-dev-daemon.pid)
if timeout 30 bash -c '. /tmp/shared-mcp-test.env; while group_alive "$1"; do sleep 1; done' _ "$DEVG"; then echo "dev session group $DEVG empty"; else echo "TIMEOUT: dev session group $DEVG still has processes"; fi
while read -r id g; do if group_alive "$g"; then echo "LIVE GROUP $g ($id)"; else echo "$id group $g gone"; fi; done < /tmp/shared-mcp-groups
for p in 18932 18950 18951; do listening "$p" || echo "$p closed"; done
grep -c '"msg":"Server closed"' "$DEV_HOME/daemon.log"
S=$(cat /tmp/shared-mcp-serena.pid); kill -0 "$S" && echo "serena $S untouched"; listening 8000 && echo "8000 still up"
```

Expected:

```
dev session group <DEVG> empty
context7 group <C> gone
ext-test group <E> gone
gitlab group <G> gone
18932 closed
18950 closed
18951 closed
1
serena <pid from Step 2> untouched
8000 still up
```

No `LIVE GROUP` line may appear. Pid files may remain under `run/` if the 2 s budget ended before the exit handlers ran; the next start cleans them up, because their owner pid is dead and their groups are gone. With `dev:server:raw` the dev session holds only npm, the dev runner, the supervisor and the worker, so a `TIMEOUT` on it is a dev-script finding: list the group with `pgrep -g "$DEVG" | xargs -r ps -o pid=,comm= -p`, then run `kill -TERM -- -$DEVG`.

- [ ] **Step 38: Start the dev daemon again and wait for all three owned servers.** Run `. /tmp/shared-mcp-test.env && start_dev_daemon && wait_for_file /tmp/shared-mcp-dev-daemon.pid && echo "dev session pgid=$(cat /tmp/shared-mcp-dev-daemon.pid)"`, then run with `run_in_background: true`:

```bash
timeout 300 bash -c '. /tmp/shared-mcp-test.env; until [ "$(dev_health)" = 200 ] && [ -s "$C7_PID_FILE" ] && listening 18932 && [ -s "$GL_PID_FILE" ] && listening 18950 && [ -s "$EXT_PID_FILE" ] && listening 18951; do sleep 2; done' && echo "dev daemon healthy; context7, gitlab and ext-test listening" || echo "TIMEOUT waiting for the restarted dev daemon"
```

Expected: `dev daemon healthy; context7, gitlab and ext-test listening`. ext-test starts as the plugin's own at once, since nothing answers on 18951 now.

- [ ] **Step 39: Confirm the token survived the restart and the screen reconnected.** Run:

```bash
. /tmp/shared-mcp-test.env
[ "$(sha256sum "$SMCP/token" | cut -d' ' -f1)" = "$(cat /tmp/shared-mcp-token.sha)" ] && echo "token reused across the restart" || echo "TOKEN CHANGED"
token_check STREAMABLE_HTTP_AUTH_TOKEN pgrp "$(pgid_of "$GL_PID_FILE")" | tail -n 1
```

Expected: `token reused across the restart`, and `in scope: <n>, token match: <n>` with both numbers equal. The browser tab reconnects by itself with the stored password; after `{"time": 10}`, a snapshot shows context7, gitlab and ext-test `healthy` with restarts `0`, serena `external`, and blocked-test `blocked`.

- [ ] **Step 40: Crash the daemon with kill -9 and confirm the orphans.** Run:

```bash
. /tmp/shared-mcp-test.env
SUP=$(sup_pid); WORKER=$(pgrep -P "$SUP" -f daemon-worker); DEVG=$(cat /tmp/shared-mcp-dev-daemon.pid)
for f in "$SMCP"/run/*.pid; do echo "$(basename "$f" .pid) $(pgid_of "$f")"; done | tee /tmp/shared-mcp-orphans
echo "supervisor=$SUP worker=$WORKER"
[ "${SUP:-0}" -gt 1 ] && [ "${WORKER:-0}" -gt 1 ] && kill -KILL "$WORKER" "$SUP"
if timeout 30 bash -c '. /tmp/shared-mcp-test.env; while group_alive "$1"; do sleep 1; done' _ "$DEVG"; then echo "dev session group $DEVG empty"; else echo "TIMEOUT: dev session group $DEVG still has processes"; fi
while read -r id g; do group_alive "$g" && echo "$id group $g survived the crash"; done < /tmp/shared-mcp-orphans
for p in 18932 18950 18951; do listening "$p" && echo "$p still served by an orphan"; done
```

Expected: three orphan lines (`context7`, `ext-test`, `gitlab` with their pgids), a single worker pid, `dev session group <DEVG> empty`, all three `survived the crash` lines, and all three ports `still served by an orphan`. SIGKILL skips every cleanup path, which is the case `reclaimOrphan` exists for. The servers' groups are their own sessions (`detached: true`), so killing the dev session leaves them running.

- [ ] **Step 41: Restart the dev daemon and confirm reclaimOrphan.** Run `. /tmp/shared-mcp-test.env && start_dev_daemon && wait_for_file /tmp/shared-mcp-dev-daemon.pid && echo "dev session pgid=$(cat /tmp/shared-mcp-dev-daemon.pid)"`, then run with `run_in_background: true`:

```bash
. /tmp/shared-mcp-test.env; if timeout 300 bash -c '. /tmp/shared-mcp-test.env; until [ "$(dev_health)" = 200 ] && all_reclaimed && listening 18932 && listening 18950 && listening 18951; do sleep 2; done'; then while read -r id old; do echo "$id: orphan group $old reclaimed, new pgid $(pgid_of "$SMCP/run/$id.pid")"; done < /tmp/shared-mcp-orphans; listening 18933 || echo "18933 free: the new context7 got 18932"; else echo "TIMEOUT: an orphan group was not reclaimed"; fi
```

Expected: one `orphan group <old> reclaimed, new pgid <new>` line each for context7, ext-test and gitlab, with every `<new>` different from its `<old>`, then `18933 free: the new context7 got 18932`. On `TIMEOUT` with an old group still alive, reclaim did not run; the plugin would then have adopted the orphan as `external` (the probe answers), which the next step would also show.

- [ ] **Step 42: Confirm the reclaim on the Servers screen.** Call `mcp__playwright__browser_wait_for` with `{"time": 10}`, then `mcp__playwright__browser_snapshot`.

Expected: context7, gitlab and ext-test show `healthy`, not `external`, with restarts `0` and pids equal to the new pgids from Step 41. serena is still `external` and blocked-test still `blocked`.

- [ ] **Step 43: Final graceful stop and orphan check.** Run the Step 36 commands, then the Step 37 commands.

Expected: the same output as Step 37, except that the `"Server closed"` count is `2` (the kill -9 run logged none). serena is still untouched on its Step 2 pid.

- [ ] **Step 44: Close the browser tab, stop Metro and confirm the throwaway server is gone.** Call `mcp__playwright__browser_tabs` with `{"action": "list"}`, then `{"action": "close", "index": <index of the http://172.22.0.3:8081 tab>}`. Then run:

```bash
. /tmp/shared-mcp-test.env
APPG=$(cat /tmp/shared-mcp-dev-app.pid)
[ "${APPG:-0}" -gt 1 ] && kill -TERM -- "-$APPG"
if timeout 30 bash -c '. /tmp/shared-mcp-test.env; while group_alive "$1"; do sleep 1; done' _ "$APPG"; then echo "Metro group $APPG stopped"; else echo "TIMEOUT: Metro group $APPG still running"; fi
listening 8081 || echo "8081 closed"
kill -0 "$(cat /tmp/shared-mcp-ext.pid)" 2>/dev/null || echo "hand-run ext server gone"
rm -f /tmp/shared-mcp-dev-password && echo "dev password file removed"
```

Expected: `Metro group <APPG> stopped`, `8081 closed`, `hand-run ext server gone` and `dev password file removed`. That releases `/tmp/paseo-heavy.lock`. On a `TIMEOUT`, run **Abort and clean up**, which checks that the group still runs `scripts/dev-app.sh` before it signals it again. The test dev home stays in place for inspection; the earlier one stays at `.dev/paseo-home.before-shared-mcp-<timestamp>`.

- [ ] **Step 45: Write the shared-mcp paragraph.** In `docs/plugins.md`, replace

```
The `worktree-include` built-in copies gitignored files selected by
[`.worktreeinclude`](../public-docs/worktrees.md#copy-local-files-with-worktreeinclude)
before setup and agents, through `worktree.create.after`.
```

with

```
The `worktree-include` built-in copies gitignored files selected by
[`.worktreeinclude`](../public-docs/worktrees.md#copy-local-files-with-worktreeinclude)
before setup and agents, through `worktree.create.after`.

The `shared-mcp` built-in runs each MCP server in its settings once, over HTTP on the server's own
port, so agents connect to one copy instead of each starting its own. A server that already
answers on its port shows as `external` and keeps running when the daemon stops. A definition with
`bearerToken` gets the plugin's token in the server's env, and every agent gets the same token in
its env under the `agentEnv` name, for configs that send `Authorization: Bearer ${VAR}`. Claude
Code expands that header; Kiro CLI expansion is unverified. An agent receives the token only when
its session opens, so after adding a `bearerToken` definition or renaming an `agentEnv`, reload
the agents that were already running. The settings screens open from the "Shared MCP servers"
Command Center item, because built-ins have no row in Settings > Plugins. Nothing watches
`$PASEO_HOME/plugin-settings/shared-mcp/servers.json`, so a hand edit applies at the next daemon
start. Each server's output goes to `$PASEO_HOME/shared-mcp/logs/<id>.log`, and its tail to the
Servers tab. The plugin's own messages go to the daemon log, not to `paseo plugin logs shared-mcp`.
Local runs of `scripts/builtin-plugins-dist.test.mjs` and
`packages/server/src/server/plugins/lifecycle.e2e.test.ts` start this built-in in process, so give
them `PASEO_HOME=$(mktemp -d)`; otherwise it works in the real `$PASEO_HOME/shared-mcp`. Probe,
restart, and backoff rules are in the
[design](superpowers/specs/2026-11-06-shared-mcp-plugin-design.md#supervisor).
```

Each claim maps to a step of this task or to its source: one HTTP copy per server (Steps 10, 13), `external` and left running (Steps 13, 37), the token in the server's env (Steps 10, 39), the token in every agent's env (Steps 17, 19), Claude Code expanding the header (Step 17), the Command Center item (Step 13), per-server logs and their tail on the Servers tab (Steps 10, 13), and the temp `PASEO_HOME` for local test runs (Step 3). Kiro CLI header expansion was not tested, so the paragraph says so. The token arriving only at session open is Task 7's limit: the hook runs on `agent.open.before` (create, resume or reload) and nothing reloads running agents. This test opens both agents after the definitions exist, so it does not exercise that case. Reload agent is the app's action for it (`reloadAgent` in `packages/app/src/i18n/resources/en.ts`). The plugin's own messages reach the daemon log because the supervisor copies the worker's stdout and stderr into `daemon.log` (`packages/server/scripts/supervisor.ts:356-363`), while an in-process plugin's `stdout` and `stderr` are `PassThrough`s that nothing writes to (`packages/server/src/server/plugins/internal-child.ts:10-11`), so `paseo plugin logs` never sees them. The unwatched file comes from `packages/server/src/server/plugins/settings/index.ts`, which reads on demand and notifies only after a write or a read-time migration (lines 128 and 163). The paragraph leaves the supervisor rules to the spec, per CLAUDE.md's "don't document logic". It passed `check_prose` (no dashes, stock words, bold labels or curly quotes) and every line is under 100 columns.

- [ ] **Step 46: Rewrite the import-rule sentence.** shared-mcp is the first built-in with client code, so the current rule ("host modules (`@getpaseo/plugin/*`, `zod`) and Node built-ins") is now wrong for client bundles. In `docs/plugins.md`, replace

```
Built-ins can import only host modules (`@getpaseo/plugin/*`, `zod`) and Node built-ins:
outside the archive, nothing resolves an npm dependency, and the dist build test cannot catch
one because it resolves through the repository's `node_modules`.
```

with

```
Built-ins can import only host modules. Server code may import `@getpaseo/plugin`,
`@getpaseo/plugin/server*`, `zod`, and Node built-ins. Client code may import `@getpaseo/plugin`,
`@getpaseo/plugin/client`, `@getpaseo/plugin/client/ui`, `zod`, `react`, `react-native`, and
`@tanstack/react-query`. Shared code may import `@getpaseo/plugin` and `zod`. Outside the archive,
nothing resolves an npm dependency, and the dist build test cannot catch one because it resolves
through the repository's `node_modules`.
```

The client externals come from `packages/server/src/server/plugins/compiler-build.ts:367-377`, and the per-target rule (no Node built-ins or server SDK entries in client and shared code, no client SDK entries, React or TanStack in server and shared code) from `runtimeSpecifierError` at `compiler-build.ts:276-311`.

- [ ] **Step 47: Format and check the doc.** No code changed in this task, so there is no lint or typecheck step of its own; the pre-commit hook typechecks the tree in Step 48. Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- docs/plugins.md && npm run format:check:files -- docs/plugins.md && git diff --stat -- docs/plugins.md && grep -nE 'shared-mcp. built-in runs|Shared code may import' docs/plugins.md
```

Expected: both oxfmt runs exit 0, and the diff is `docs/plugins.md` only, 24 insertions and 3 deletions. The grep finds the new paragraph at line 106 and the rewritten rule's `Shared code may import` at line 130. Both counts were checked by applying the two replacements to a copy of the current `docs/plugins.md`, and `oxfmt --check` passed on that copy unchanged.

- [ ] **Step 48: Commit with the fork identity.** Metro and the dev daemon must be stopped first: Metro holds the lock, so a still-running Metro would block this commit. Stage the doc and list what is staged:

```bash
cd /workspace/utils/paseo && git add docs/plugins.md && git diff --cached --name-only
```

Expected: exactly one line, `docs/plugins.md`. This checkout is shared with other sessions, so another path in that list is someone else's staged work. Stop and ask the user; do not commit it and do not unstage it. Only when the list is `docs/plugins.md` alone, run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "docs(fork): document the shared-mcp built-in" -- docs/plugins.md
```

Expected: the `-- docs/plugins.md` pathspec limits the commit to the doc even if something is staged between the two commands. The lefthook pre-commit runs `format:check:files` on the doc, skips lint (no code), and runs the full `npm run typecheck` under the lock (1-3 minutes). The commit prints `docs(fork): document the shared-mcp built-in` and `1 file changed`. This is a local commit only. Never push: a push to the fork's main redeploys this container through Dokploy.

- [ ] **Step 49: Verify the commit identity.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
```

Expected: `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.

### Task 10: Roll the shared MCP servers out on each instance

Run this during sub-project 6, after the deployed daemon has the plugin. Repeat the whole task on each instance. No file in the repository changes, so the task has no repository commit (Step 28 checks the tree instead). Do not restart the daemon on 6767 at any point.

**Files:** (none in the repository; every path is absolute and changed per instance)

- Create: `/workspace/.agent-tools/bin/shared-mcp-check.js` (the rollout check)
- Create: `/workspace/.agent-tools/shared-mcp-servers.json` (source copy of the six definitions, no secrets)
- Create: `/workspace/.agent-tools/backups/<YYYYMMDD-HHMMSS>-shared-mcp/` (backup, plus `context7-choice`, `memory-before.txt` and `memory-after.txt`)
- Modify: `$PASEO_HOME/plugin-settings/shared-mcp/servers.json` (written by the Definitions screen, not by hand)
- Modify: `/workspace/.agent-tools/mcp.json` (also seen as `/workspace/.mcp.json`, `/workspace/.kiro/settings/mcp.json`, `~/.kiro/settings/mcp.json`)
- Modify: `/home/paseo/.claude/.claude.json` (user-scope `playwright`, through `claude mcp`)
- Modify: `/workspace/.agent-tools/opencode/opencode.jsonc`
- Modify: `/home/paseo/.claude/settings.json` (`hooks.SessionStart` only)
- Modify: `/workspace/paseo.json`
- Modify: `/home/paseo/.bashrc`
- Modify: `/workspace/CLAUDE.md`, `/workspace/.agent-tools/README.md`
- Modify: `/home/paseo/.claude/projects/-workspace/memory/mdaq-serena-code-graph.md`, `/home/paseo/.claude/projects/-workspace/memory/mdaq-workspace-mcp-setup.md`, `/home/paseo/.claude/projects/-workspace/memory/MEMORY.md`
- Create, then remove in Step 24: `/tmp/shared-mcp-check/` (the Step 21 agents' working directory, holding only the three new MCP entries) and `/tmp/shared-mcp-check.workspace` (the id of its Paseo workspace)
- Test: `node /workspace/.agent-tools/bin/shared-mcp-check.js`

**Interfaces:**

- Consumes (Tasks 1 to 9, as deployed):
  - `ServerDefinition` from `shared/settings.ts`: `{ id: /^[a-z][a-z0-9-]*$/, label, command (sh -c), cwd?, env: Record<string,string> = {}, port, healthPath = "/mcp", requires: string[] = [], bearerToken?: { serverEnv, agentEnv }, enabled = true }`, saved through `sharedMcpSettings` (`id: "servers"`, `scope: "host"`, `version: 1`; duplicate ids or ports rejected). Stored at `$PASEO_HOME/plugin-settings/shared-mcp/servers.json` as `{ "version": 1, "values": { "servers": [...] } }`. Nothing watches the file; the plugin only sees saves made through `settings.servers.write` (the Definitions screen) or the file as it was at daemon start.
  - `statusRpc` `"shared-mcp.status.request"` -> `{ servers: ServerStatus[] }`, `state` in `starting | healthy | unhealthy | backoff | failing | blocked | external | disabled`, plus `pid`, `restarts`, `lastError`, `nextRetryAt`, shown on the Servers screen. `restartRpc` `"shared-mcp.restart.request"` `{ id }` -> `{ ok, error }`, the Restart button.
  - `Supervisor` crash path (`TIMING`): process exit -> `backoff` starting at `backoffStartMs` 2 000, doubling to 60 000, reset after 10 min healthy; `restarts` increments on every restart; health is an HTTP `initialize` probe only.
  - `sharedMcpHome()` = `$PASEO_HOME/shared-mcp`: `token` (from `loadOrCreateToken`, mode 0600), `logs/<id>.log`, `run/<id>.pid`.
  - The single `agent.open.before` hook, which adds `{ SHARED_MCP_TOKEN: <token> }` to the env of every agent Paseo opens (create, resume, refresh).
  - Settings screens `servers` ("Servers") and `definitions` ("Definitions"), opened from the Command Center item "Shared MCP servers" or the route `/settings/hosts/<server-id>/plugins/shared-mcp/<screen>`.
- Produces: `node /workspace/.agent-tools/bin/shared-mcp-check.js` exits 0 when every check passes, 1 when any fails, and 2 on a crash. Every client config points at `http://127.0.0.1:{8931,8932,8933,8000,8080,8090}/mcp`.

- [ ] **Step 1: Confirm the deployed daemon has the plugin**

```bash
node -p 'require("/usr/local/lib/node_modules/@getpaseo/server/package.json").version'
node -p 'JSON.stringify(require("/usr/local/lib/node_modules/@getpaseo/server/dist/server/builtin-plugins/shared-mcp/paseo-plugin.json"))'
ls -la "$PASEO_HOME/shared-mcp" 2>&1
```

Expected: a version at 0.15.0 or later (the fork is 0.15.2), then `{"id":"shared-mcp","requirements":{"paseo":">=0.15.0"}}` (printed through `JSON.stringify`, so the file's oxfmt spacing does not matter), then `No such file or directory`, because a start with no servers writes nothing. In the Paseo app the Command Center lists "Shared MCP servers" and its Servers tab is empty. Today this container prints `0.11.1` and the second command fails with `Cannot find module`. If you see that, stop: the sub-project 6 deploy has not happened yet.

- [ ] **Step 2: Back up the files this task edits**

Full copies are made only of files that hold no credential. From `settings.json` and `.claude.json`, which do hold credentials, only the fragment being removed is saved.

```bash
B="/workspace/.agent-tools/backups/$(date +%Y%m%d-%H%M%S)-shared-mcp"
mkdir -p "$B"
cp -p /workspace/.agent-tools/mcp.json "$B/agent-tools.mcp.json"
cp -p /workspace/.agent-tools/opencode/opencode.jsonc "$B/agent-tools.opencode.jsonc"
cp -p /workspace/.agent-tools/README.md "$B/agent-tools.README.md"
cp -p /workspace/paseo.json "$B/workspace.paseo.json"
cp -p /workspace/CLAUDE.md "$B/workspace.CLAUDE.md"
node -e '
const fs = require("fs");
const dir = process.argv[1];
const settings = JSON.parse(fs.readFileSync("/home/paseo/.claude/settings.json", "utf8"));
const hooks = JSON.stringify(settings.hooks.SessionStart, null, 2) + "\n";
fs.writeFileSync(`${dir}/claude-settings.SessionStart.json`, hooks);
const user = JSON.parse(fs.readFileSync("/home/paseo/.claude/.claude.json", "utf8"));
fs.writeFileSync(`${dir}/claude-user-playwright.json`, JSON.stringify(user.mcpServers.playwright) + "\n");
' "$B"
ls -la "$B"
```

Expected: seven files. Later steps find the directory again with `B=$(ls -d /workspace/.agent-tools/backups/*-shared-mcp | tail -1)` and add `memory-before.txt` (Step 5), `context7-choice` (Step 6) and `memory-after.txt` (Step 25).

- [ ] **Step 3: Write the rollout check (the failing test)**

Create `/workspace/.agent-tools/bin/shared-mcp-check.js`. It follows the style of `read-mcp-env.js` next to it (CommonJS, single quotes) because it lives outside the repository. It reads the token but never prints it, and it DELETEs every session it opens, sending the same Authorization header. The gitlab refusal check has its own try, so an error on the unauthenticated request is reported under its own label.

```js
#!/usr/bin/env node
// Checks the shared-mcp rollout on this instance: the six MCP servers answer on
// loopback and every client config points at them. Prints no secret values.

const fs = require("fs");
const os = require("os");
const path = require("path");

const home = os.homedir();
const paseoHome = process.env.PASEO_HOME || path.join(home, ".paseo");
const claudeDir = process.env.CLAUDE_CONFIG_DIR || path.join(home, ".claude");
const claudeJson = process.env.CLAUDE_CONFIG_DIR
  ? path.join(claudeDir, ".claude.json")
  : path.join(home, ".claude.json");
const tokenFile = path.join(paseoHome, "shared-mcp", "token");
const agentTools = "/workspace/.agent-tools";

const SERVERS = [
  { id: "playwright", port: 8931 },
  { id: "context7", port: 8932 },
  { id: "gitlab", port: 8933, bearer: true },
  { id: "serena", port: 8000 },
  { id: "graphify", port: 8080 },
  { id: "pia-mcp", port: 8090 },
];

const INITIALIZE = JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-03-26",
    capabilities: {},
    clientInfo: { name: "shared-mcp-check", version: "1" },
  },
});

let failures = 0;

function report(ok, label, detail) {
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${label}${detail ? ` (${detail})` : ""}`);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function describeError(error) {
  return error.cause?.code || error.message;
}

function readToken() {
  try {
    const stat = fs.statSync(tokenFile);
    report((stat.mode & 0o077) === 0, "token file is private", tokenFile);
    return fs.readFileSync(tokenFile, "utf8").trim();
  } catch (error) {
    report(false, "token file exists", error.code || error.message);
    return null;
  }
}

async function initialize(port, token) {
  const url = `http://127.0.0.1:${port}/mcp`;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(url, {
    method: "POST",
    headers,
    body: INITIALIZE,
    signal: AbortSignal.timeout(5000),
  });
  await response.body?.cancel();
  const session = response.headers.get("mcp-session-id");
  if (session) {
    await fetch(url, {
      method: "DELETE",
      headers: { ...headers, "mcp-session-id": session },
      signal: AbortSignal.timeout(5000),
    })
      .then((reply) => reply.body?.cancel())
      .catch(() => {});
  }
  return response.status;
}

async function checkRefusal(server) {
  const label = `${server.id} refuses a request without the token`;
  try {
    const status = await initialize(server.port, null);
    report(status === 401, label, `HTTP ${status}`);
  } catch (error) {
    report(false, label, describeError(error));
  }
}

async function checkServer(server, token) {
  const label = `${server.id} answers on 127.0.0.1:${server.port}`;
  try {
    const status = await initialize(server.port, server.bearer ? token : null);
    report(status === 200, label, `HTTP ${status}`);
  } catch (error) {
    report(false, label, describeError(error));
    return;
  }
  if (server.bearer) await checkRefusal(server);
}

function expectEntry(label, entry, expected) {
  const ok =
    entry !== undefined &&
    entry.command === undefined &&
    Object.entries(expected).every(
      ([key, value]) => JSON.stringify(entry[key]) === JSON.stringify(value),
    );
  report(ok, label);
}

function checkConfigs() {
  const http = (port) => ({ type: "http", url: `http://127.0.0.1:${port}/mcp` });
  const remote = (port) => ({ type: "remote", url: `http://127.0.0.1:${port}/mcp` });
  const mcp = readJson(path.join(agentTools, "mcp.json")).mcpServers;
  expectEntry("mcp.json playwright is HTTP", mcp.playwright, http(8931));
  // Step 6 answer (b) adds the Context7 key header; answer (a) sends none.
  const context7Key = { "X-Context7-API-Key": "${CONTEXT7_API_KEY}" };
  const context7 =
    mcp.context7?.headers === undefined ? http(8932) : { ...http(8932), headers: context7Key };
  expectEntry("mcp.json context7 is HTTP", mcp.context7, context7);
  expectEntry("mcp.json gitlab is HTTP with the token header", mcp.gitlab, {
    ...http(8933),
    headers: { Authorization: "Bearer ${SHARED_MCP_TOKEN}" },
  });
  const opencode = readJson(path.join(agentTools, "opencode", "opencode.jsonc")).mcp;
  expectEntry("opencode playwright is remote", opencode.playwright, remote(8931));
  expectEntry("opencode context7 is remote", opencode.context7, remote(8932));
  expectEntry("opencode gitlab is remote with the token header", opencode.gitlab, {
    ...remote(8933),
    headers: { Authorization: "Bearer {env:SHARED_MCP_TOKEN}" },
    oauth: false,
  });
  const user = readJson(claudeJson).mcpServers || {};
  expectEntry("Claude user-scope playwright is HTTP", user.playwright, http(8931));
  const hooks = JSON.stringify(readJson(path.join(claudeDir, "settings.json")).hooks || {});
  report(!hooks.includes("-autostart.sh"), "Claude settings start no MCP server");
  const scripts = Object.keys(readJson("/workspace/paseo.json").scripts || {});
  report(scripts.join(",") === "auth-proxy", "paseo.json keeps only auth-proxy", scripts.join(","));
}

async function main() {
  const token = readToken();
  for (const server of SERVERS) await checkServer(server, token);
  checkConfigs();
  const summary = failures === 0 ? "all checks pass" : `${failures} check(s) failed`;
  console.log(`shared-mcp rollout: ${summary}`);
  process.exitCode = failures === 0 ? 0 : 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
```

```bash
chmod 755 /workspace/.agent-tools/bin/shared-mcp-check.js
node --check /workspace/.agent-tools/bin/shared-mcp-check.js
```

Expected: `node --check` prints nothing and exits 0.

- [ ] **Step 4: Run the check and confirm it fails**

```bash
node /workspace/.agent-tools/bin/shared-mcp-check.js; echo "exit=$?"
```

Expected (dry-run in this container on 2026-11-06; the other instance differs if its Python servers are down). gitlab gets no refusal line here because its first request already failed:

```
FAIL token file exists (ENOENT)
FAIL playwright answers on 127.0.0.1:8931 (ECONNREFUSED)
FAIL context7 answers on 127.0.0.1:8932 (ECONNREFUSED)
FAIL gitlab answers on 127.0.0.1:8933 (ECONNREFUSED)
ok   serena answers on 127.0.0.1:8000 (HTTP 200)
ok   graphify answers on 127.0.0.1:8080 (HTTP 200)
ok   pia-mcp answers on 127.0.0.1:8090 (HTTP 200)
FAIL mcp.json playwright is HTTP
FAIL mcp.json context7 is HTTP
FAIL mcp.json gitlab is HTTP with the token header
FAIL opencode playwright is remote
FAIL opencode context7 is remote
FAIL opencode gitlab is remote with the token header
FAIL Claude user-scope playwright is HTTP
FAIL Claude settings start no MCP server
FAIL paseo.json keeps only auth-proxy (serena,graphify,auth-proxy,pia-mcp)
shared-mcp rollout: 13 check(s) failed
exit=1
```

- [ ] **Step 5: Record memory before the rollout**

This splits MCP processes by ancestry. Anything under a `claude`, `kiro-cli-chat` or `opencode` process is a per-agent copy; anything else is shared. The bracketed first letters stop awk from matching its own command line. The figures go to `memory-before.txt` for the Step 27 report.

```bash
B=$(ls -d /workspace/.agent-tools/backups/*-shared-mcp | tail -1)
{
  ps -eo pid=,ppid=,rss=,args= | awk '
  { pp[$1] = $2; rss[$1] = $3; a = $0; sub(/^ *[0-9]+ +[0-9]+ +[0-9]+ +/, "", a); cmd[$1] = a }
  END {
    for (p in cmd) {
      if (cmd[p] !~ /[p]laywright-mcp|[c]ontext7-mcp|[m]cp-gitlab|[n]pm exec @|[s]erena|[g]raphify-mcp|[s]rc\.server|[p]yright|[t]erraform-ls/) continue
      for (q = pp[p]; q > 1 && cmd[q] !~ /(^|\/)(claude|kiro-cli-chat|opencode)( |$)/; q = pp[q]) ;
      if (q > 1) { s += rss[p]; ns++ } else { h += rss[p]; nh++ }
    }
    printf "per-agent MCP copies: %d processes, %d MB\nshared MCP servers: %d processes, %d MB\n", ns, s / 1024, nh, h / 1024
  }'
  free -m | awk 'NR == 2 { print "available:", $7, "MB" }'
} | tee "$B/memory-before.txt"
```

Expected: three lines, also saved in the backup directory. On 2026-11-06 this container showed `per-agent MCP copies: 78 processes, 3263 MB`, `shared MCP servers: 8 processes, 309 MB` and `available: 6303 MB`.

- [ ] **Step 6: Ask the user how Context7 should authenticate, and record the answer**

Today every stdio Context7 copy reads `CONTEXT7_API_KEY` through `read-mcp-env.js` and runs keyed. The shared server cannot do that. `@upstash/context7-mcp` 4.0.4 refuses `--api-key` together with `--transport http` (dist/index.js:37-38), reads `CONTEXT7_API_KEY` from its env only in stdio mode (:444), and in HTTP mode takes the key from each request's headers (`Authorization: Bearer`, `X-Context7-API-Key`, `Context7-API-Key`, `X-API-Key`; :276-282). So the server definition in Step 7 carries no key under either answer; the answer decides what `mcp.json` sends. Ask the user these two options and do not pick for them:

- (a) Anonymous. `mcp.json` sends no key, and every agent on this instance shares Context7's anonymous rate limit.
- (b) Keyed header. `mcp.json` sends `X-Context7-API-Key: ${CONTEXT7_API_KEY}`. Claude agents expand it from the `env` block of `~/.claude/settings.json` and stay keyed as today. Kiro agents have no `CONTEXT7_API_KEY` (the daemon's env lacks it), and kiro-cli 2.28.0 sends an unset `${VAR}` as its literal text, so Context7 gets `${CONTEXT7_API_KEY}` as the key and passes it upstream; expect Kiro's Context7 calls to be refused (not tested).

OpenCode stays anonymous under both answers, because its agents have no `CONTEXT7_API_KEY` either. On the second instance, ask again unless the user said the answer covers both.

Record the answer for Steps 13 and 18. For answer (a):

```bash
B=$(ls -d /workspace/.agent-tools/backups/*-shared-mcp | tail -1)
printf '%s\n' anonymous > "$B/context7-choice"
cat "$B/context7-choice"
```

For answer (b):

```bash
B=$(ls -d /workspace/.agent-tools/backups/*-shared-mcp | tail -1)
printf '%s\n' keyed > "$B/context7-choice"
cat "$B/context7-choice"
```

Expected: `anonymous` or `keyed`, matching the user's answer.

- [ ] **Step 7: Write the six definitions to their source file**

Create `/workspace/.agent-tools/shared-mcp-servers.json`. The commands are copied from today's `mcp.json` and `paseo.json`, with these exceptions. Playwright gains `--host 127.0.0.1 --port 8931 --allowed-hosts localhost:8931,127.0.0.1:8931`. Each allowed-hosts entry needs its port, and the probe and clients then get 200 on `127.0.0.1`. Context7 drops the key read, for the reasons in Step 6. GitLab gains `STREAMABLE_HTTP`, `HOST`, `PORT`, `MAX_REQUESTS_PER_MINUTE` (1000 is the maximum 2.1.52 accepts; the default of 60 a minute would be shared by every agent and the probe, all from 127.0.0.1) and `bearerToken`. `requires` repeats the guards from the old `*-autostart.sh` scripts. Defaults (`env`, `healthPath`, `requires`, `enabled`) are left out where they apply.

```json
[
  {
    "id": "playwright",
    "label": "Playwright",
    "command": "exec /usr/local/bin/playwright-mcp --cdp-endpoint http://$(getent hosts mdaq-browser | head -1 | cut -d\" \" -f1):9223 --host 127.0.0.1 --port 8931 --allowed-hosts localhost:8931,127.0.0.1:8931",
    "cwd": "/workspace",
    "port": 8931,
    "requires": ["/usr/local/bin/playwright-mcp"]
  },
  {
    "id": "context7",
    "label": "Context7",
    "command": "exec /usr/local/bin/context7-mcp --transport http --port 8932",
    "cwd": "/workspace",
    "port": 8932,
    "requires": ["/usr/local/bin/context7-mcp"]
  },
  {
    "id": "gitlab",
    "label": "GitLab",
    "command": "TOKEN=\"$(node /workspace/.agent-tools/bin/read-mcp-env.js GITLAB_PERSONAL_ACCESS_TOKEN)\" || exit 1; export GITLAB_PERSONAL_ACCESS_TOKEN=\"$TOKEN\"; exec /usr/local/bin/mcp-gitlab",
    "cwd": "/workspace",
    "env": {
      "GITLAB_API_URL": "https://git.sg.m-daq.net/api/v4",
      "GITLAB_PERMISSION_MODE": "modify",
      "GITLAB_TOOLSETS": "merge_requests,issues,repositories,branches,projects,labels,ci,users,groups,pipelines,search",
      "GITLAB_DISABLE_VERSION_CHECK": "true",
      "STREAMABLE_HTTP": "true",
      "HOST": "127.0.0.1",
      "PORT": "8933",
      "MAX_REQUESTS_PER_MINUTE": "1000"
    },
    "port": 8933,
    "requires": ["/workspace/.agent-tools/bin/read-mcp-env.js", "/usr/local/bin/mcp-gitlab"],
    "bearerToken": { "serverEnv": "STREAMABLE_HTTP_AUTH_TOKEN", "agentEnv": "SHARED_MCP_TOKEN" }
  },
  {
    "id": "serena",
    "label": "Serena",
    "command": "exec env PATH=/home/paseo/.local/bin:$PATH /home/paseo/.local/bin/uvx --from serena-agent==1.7.0 serena start-mcp-server --project /workspace --context claude-code --enable-web-dashboard false --transport streamable-http --host 127.0.0.1 --port 8000",
    "cwd": "/workspace",
    "port": 8000,
    "requires": ["/home/paseo/.local/bin/uvx"]
  },
  {
    "id": "graphify",
    "label": "Graphify",
    "command": "exec env PATH=/home/paseo/.local/bin:$PATH /home/paseo/.local/bin/graphify-mcp --graph /workspace/graphify-out/graph.json --transport http --host 127.0.0.1 --port 8080 --path /mcp",
    "cwd": "/workspace",
    "port": 8080,
    "requires": ["/home/paseo/.local/bin/graphify-mcp", "/workspace/graphify-out/graph.json"]
  },
  {
    "id": "pia-mcp",
    "label": "PIA-MCP",
    "command": "cd /workspace/pr/utilities/pia-mcp && export GITLAB_PERSONAL_ACCESS_TOKEN=\"$(/usr/local/bin/node /workspace/.agent-tools/bin/read-mcp-env.js GITLAB_PERSONAL_ACCESS_TOKEN 2>/dev/null)\" && exec env PIA_MCP_CONTENT_ROOT=/workspace/pr/utilities/pia-mcp PIA_MCP_WORKSPACE_ROOT=/workspace PIA_MCP_LOG_FILE=/tmp/pia-mcp.log /home/paseo/.venvs/pia-mcp/bin/python -m src.server",
    "cwd": "/workspace/pr/utilities/pia-mcp",
    "port": 8090,
    "requires": ["/home/paseo/.venvs/pia-mcp/bin/python", "/workspace/pr/utilities/pia-mcp"]
  }
]
```

Validate it. On 2026-11-06 this check passed against the contract schema, and the gitlab, serena, graphify and pia-mcp commands were byte-identical to today's. On 2026-11-10 the playwright, context7 and gitlab commands moved from `npx -y <pkg>@<version>` to the bins that `docker/Dockerfile.agents` installs at those same versions, because the `npm exec` parent adds about 165 MB per server. Their `requires` entries name the bins, so on an image older than that change the three servers show `blocked` instead of crash-looping; the `npx -y` form still works there.

```bash
node -e '
const defs = require("/workspace/.agent-tools/shared-mcp-servers.json");
const ids = new Set(defs.map((d) => d.id));
const ports = new Set(defs.map((d) => d.port));
const missing = defs.flatMap((d) => (d.requires ?? []).filter((p) => !require("fs").existsSync(p)));
console.log(defs.length, ids.size, ports.size, missing.length ? `missing: ${missing}` : "requires ok");
'
```

Expected: `6 6 6 requires ok`. A missing path is not fatal: that server shows `blocked` with the path until it exists.

- [ ] **Step 8: Load the definitions into the plugin**

Open the Command Center in the Paseo app on this instance, choose "Shared MCP servers", and switch to the Definitions tab. The direct route is `/settings/hosts/$(cat "$PASEO_HOME/server-id")/plugins/shared-mcp/definitions`. Replace the editor's `[]` with the output of `cat /workspace/.agent-tools/shared-mcp-servers.json` and press Save. Expected: no validation error, and the editor reloads showing defaults filled in.

The first saved definition with `bearerToken` creates `$PASEO_HOME/shared-mcp/token`. Saving the definitions reloads no agent. The runtime reloads open agents only when a plugin's `agent.open.before` hook appears or disappears (`packages/server/src/server/plugins/runtime.ts:1042-1051`), and Task 7 registers that hook once at plugin start and keeps it for the plugin's lifetime, so a save never flips it. Running agents get `SHARED_MCP_TOKEN` only after a reload or reopen (Step 25); until then they stay on the old stdio config, so nothing breaks.

Fallback, only if the user approves a restart of the 6767 daemon (for example, folded into the deploy restart): seed the file and restart. A file written while the daemon runs is not read until the next start.

```bash
node -e '
const fs = require("fs");
const path = require("path");
const dir = path.join(process.env.PASEO_HOME, "plugin-settings", "shared-mcp");
fs.mkdirSync(dir, { recursive: true });
const servers = require("/workspace/.agent-tools/shared-mcp-servers.json");
const body = JSON.stringify({ version: 1, values: { servers } }, null, 2) + "\n";
fs.writeFileSync(path.join(dir, "servers.json"), body, { mode: 0o600 });
'
```

- [ ] **Step 9: Wait for the servers, then rerun the check**

On the Servers tab, within about a minute: playwright, context7 and gitlab are `healthy` with a pid, an RSS and 0 restarts. serena, graphify and pia-mcp are `external` with no pid, because the old `paseo.json` scripts still serve those ports. Then:

```bash
node /workspace/.agent-tools/bin/shared-mcp-check.js; echo "exit=$?"
```

Expected: `ok` on `token file is private`, on all six `answers` lines (HTTP 200) and on `gitlab refuses a request without the token (HTTP 401)`. The nine config lines still FAIL: `shared-mcp rollout: 9 check(s) failed`, `exit=1`. If a server is not healthy, read its last error and log tail on the Servers tab, or `tail -n 50 "$PASEO_HOME/shared-mcp/logs/<id>.log"`. Read logs locally; do not paste them into tickets.

- [ ] **Step 10: Remove the three SessionStart autostart hooks**

Before (`hooks.SessionStart` in `/home/paseo/.claude/settings.json`):

```json
"SessionStart": [
  {
    "matcher": "",
    "hooks": [
      { "type": "command", "command": "/workspace/.agent-tools/bin/serena-autostart.sh", "timeout": 10 },
      { "type": "command", "command": "/workspace/.agent-tools/bin/graphify-autostart.sh" },
      { "type": "command", "command": "/workspace/.agent-tools/bin/pia-mcp-autostart.sh" }
    ]
  }
]
```

After: the `SessionStart` key is gone, and the other five hook events are untouched. The file round-trips through `JSON.stringify(…, null, 2) + "\n"`, so only those lines change. The guard stops if anything else has been added to SessionStart.

```bash
node -e '
const fs = require("fs");
const file = "/home/paseo/.claude/settings.json";
const settings = JSON.parse(fs.readFileSync(file, "utf8"));
const groups = settings.hooks.SessionStart ?? [];
const commands = groups.flatMap((group) => group.hooks.map((hook) => hook.command));
const autostart = /^\/workspace\/\.agent-tools\/bin\/(serena|graphify|pia-mcp)-autostart\.sh$/;
if (commands.length !== 3 || !commands.every((command) => autostart.test(command))) {
  throw new Error("SessionStart holds other hooks; remove the three autostart hooks by hand");
}
delete settings.hooks.SessionStart;
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
console.log("hooks left:", Object.keys(settings.hooks).join(","));
'
```

Expected: `hooks left: UserPromptSubmit,Stop,StopFailure,SessionEnd,Notification`. Claude sessions already running keep their startup snapshot of these hooks until they restart. After Step 11 those hooks can no longer start a script.

- [ ] **Step 11: Remove the serena, graphify and pia-mcp scripts from /workspace/paseo.json**

Do this before stopping them in Step 12. A running session that compacts or resumes during the takeover gap would otherwise run `paseo script start` and bring the old copy back.

```bash
node -e '
const fs = require("fs");
const file = "/workspace/paseo.json";
const config = JSON.parse(fs.readFileSync(file, "utf8"));
for (const name of ["serena", "graphify", "pia-mcp"]) delete config.scripts[name];
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
'
cat /workspace/paseo.json
```

Expected after:

```json
{
  "scripts": {
    "auth-proxy": {
      "command": "exec /workspace/docs/M-DAQ/PROXY/m-daq-auth-proxy_linux_arm64 -p 9999 -k /workspace/utils/m-daq-auth-proxy/keys/private_key_mdaq_generic.pem -t https://services-dev.m-daq.com -v"
    }
  }
}
```

- [ ] **Step 12: Stop the three running scripts so the plugin owns those servers**

Do this one server at a time, at a quiet moment: each one is unreachable for up to about 30 s plus its startup. `paseo script stop` kills the terminal first and only then looks the script up (workspace-scripts-service.ts:216-240). Because of Step 11 it may report `did not produce a status record` after it has stopped the script.

```bash
WS=$(sed -n 's/^WORKSPACE=//p' /workspace/.agent-tools/bin/serena-autostart.sh)
pgrep -fa serena-healthcheck.sh || echo "no healthcheck running"
paseo script stop serena --workspace "$WS"
```

If a healthcheck is listed, wait for it to exit before stopping serena, because it restarts serena through `paseo script`. On the Servers tab, serena moves from `external` to `starting` and then `healthy` with a pid within about a minute. Repeat with `graphify`, then `pia-mcp`. Then:

```bash
ps -o pid=,pgid=,rss=,etime=,args= --ppid "$(pgrep -x 'Paseo Daemon')" | awk '$1 == $2' | cut -c1-150
ps -eo pid=,ppid=,args= | awk '$2 == 1' | grep -E '[p]yright|[t]erraform-ls|[s]erena|[g]raphify-mcp|[s]rc\.server' || echo "no orphans"
```

Expected: six process-group leaders owned by the daemon: `node /usr/local/bin/playwright-mcp …`, `node /usr/local/bin/context7-mcp …` and `node /usr/local/bin/mcp-gitlab`, one `uv tool uvx … serena`, one `…/python …/graphify-mcp`, and one `…/pia-mcp/bin/python -m src.server`. The second command prints `no orphans`. Serena's pyright-langserver and terraform-ls run in their own groups, so `kill <pid>` any that the old serena left behind with ppid 1. If `paseo script stop` refuses and the old process is still listed under the terminal worker (`ps -o pid=,pgid=,args= --ppid "$(pgrep -f terminal-worker-process.js)"`), stop its group with `kill -TERM -- -<pgid>`.

- [ ] **Step 13: Point /workspace/.agent-tools/mcp.json at the HTTP servers**

Before:

```json
"context7": {
  "command": "sh",
  "args": ["-c", "KEY=\"$(node /workspace/.agent-tools/bin/read-mcp-env.js CONTEXT7_API_KEY)\" || exit 1; export CONTEXT7_API_KEY=\"$KEY\"; exec npx -y @upstash/context7-mcp@4.0.4 --transport stdio"]
},
"gitlab": {
  "command": "sh",
  "args": ["-c", "TOKEN=\"$(node /workspace/.agent-tools/bin/read-mcp-env.js GITLAB_PERSONAL_ACCESS_TOKEN)\" || exit 1; export GITLAB_PERSONAL_ACCESS_TOKEN=\"$TOKEN\"; exec npx -y @zereight/mcp-gitlab@2.1.52"],
  "env": { "GITLAB_API_URL": "https://git.sg.m-daq.net/api/v4", "GITLAB_PERMISSION_MODE": "modify", "GITLAB_TOOLSETS": "merge_requests,issues,repositories,branches,projects,labels,ci,users,groups,pipelines,search", "GITLAB_DISABLE_VERSION_CHECK": "true" }
},
"playwright": {
  "command": "sh",
  "args": ["-c", "exec npx -y @playwright/mcp@0.0.81 --cdp-endpoint http://$(getent hosts mdaq-browser | head -1 | cut -d\" \" -f1):9223"]
},
```

After (key order and the other four entries unchanged). `context7` with Step 6 answer (a):

```json
"context7": {
  "type": "http",
  "url": "http://127.0.0.1:8932/mcp"
},
```

`context7` with Step 6 answer (b):

```json
"context7": {
  "type": "http",
  "url": "http://127.0.0.1:8932/mcp",
  "headers": {
    "X-Context7-API-Key": "${CONTEXT7_API_KEY}"
  }
},
```

Under both answers:

```json
"gitlab": {
  "type": "http",
  "url": "http://127.0.0.1:8933/mcp",
  "headers": {
    "Authorization": "Bearer ${SHARED_MCP_TOKEN}"
  }
},
"playwright": {
  "type": "http",
  "url": "http://127.0.0.1:8931/mcp"
},
```

Edit the real file, not the `/workspace/.mcp.json` symlink. The script reads the answer recorded in Step 6. The single shell quotes keep both `${…}` strings literal for the shell, and JavaScript double-quoted strings do not expand them.

```bash
B=$(ls -d /workspace/.agent-tools/backups/*-shared-mcp | tail -1)
node -e '
const fs = require("fs");
const choice = fs.readFileSync(process.argv[1], "utf8").trim();
if (choice !== "anonymous" && choice !== "keyed") {
  throw new Error(`unknown Context7 choice: ${choice}; redo Step 6`);
}
const file = "/workspace/.agent-tools/mcp.json";
const config = JSON.parse(fs.readFileSync(file, "utf8"));
const servers = config.mcpServers;
servers.context7 = { type: "http", url: "http://127.0.0.1:8932/mcp" };
if (choice === "keyed") {
  servers.context7.headers = { "X-Context7-API-Key": "${CONTEXT7_API_KEY}" };
}
servers.gitlab = {
  type: "http",
  url: "http://127.0.0.1:8933/mcp",
  headers: { Authorization: "Bearer ${SHARED_MCP_TOKEN}" },
};
servers.playwright = { type: "http", url: "http://127.0.0.1:8931/mcp" };
fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n");
console.log("context7:", choice);
' "$B/context7-choice"
```

Then confirm no real secret value was written into the file. It prints names only, never values:

```bash
node -e '
const fs = require("fs");
const text = fs.readFileSync("/workspace/.agent-tools/mcp.json", "utf8");
const token = fs.readFileSync(`${process.env.PASEO_HOME}/shared-mcp/token`, "utf8").trim();
const secrets = {
  CONTEXT7_API_KEY: process.env.CONTEXT7_API_KEY,
  GITLAB_PERSONAL_ACCESS_TOKEN: process.env.GITLAB_PERSONAL_ACCESS_TOKEN,
  SHARED_MCP_TOKEN: token,
};
const leaked = Object.entries(secrets)
  .filter(([, value]) => value && text.includes(value))
  .map(([name]) => name);
console.log(leaked.length ? `LEAKED into mcp.json: ${leaked.join(",")}` : "no secret value in mcp.json");
'
```

Expected: `context7: anonymous` or `context7: keyed`, then `no secret value in mcp.json`. On `LEAKED`, restore `$B/agent-tools.mcp.json` and redo this step. Claude and Kiro read this file only when a session starts, so running agents keep their stdio copies until they reload (Step 25). The project approval list in `/workspace/.claude/settings.local.json` (`enabledMcpjsonServers`) is keyed by name and needs no change.

- [ ] **Step 14: Replace the Claude user-scope playwright entry**

It lives in `/home/paseo/.claude/.claude.json` (`CLAUDE_CONFIG_DIR=/home/paseo/.claude`) as `{"type":"stdio","command":"sh","args":["-c","exec npx -y @playwright/mcp@0.0.81 --cdp-endpoint http://$(getent hosts mdaq-browser | head -1 | cut -d\" \" -f1):9223"],"env":{}}`. Agents in Paseo worktrees run under `/home/paseo/.paseo/worktrees/…`, outside `/workspace`, and see only user scope. They also get serena, graphify and pia-mcp from there. So replace the entry instead of only removing it. Under `/workspace` the project entry of the same name wins, and both point at the same URL.

```bash
claude mcp remove -s user playwright
claude mcp add -s user -t http playwright http://127.0.0.1:8931/mcp
```

Expected: one line reporting the removal from user config, then one reporting that an HTTP server `playwright` was added to user config. Running Claude processes also rewrite this file, so Step 25 checks the entry again.

- [ ] **Step 15: Point OpenCode at the HTTP servers**

OpenCode 1.18.35 substitutes `{env:VAR}` across the config text before parsing; an unset variable becomes empty. Its remote entries accept `headers`, `oauth` and `timeout`. `"oauth": false` stops OpenCode from trying OAuth discovery when gitlab answers 401. The edit replaces only the `mcp` block and refuses if that block's layout differs. This keeps the inline `models` entries as they are. Context7 gets no key header under either Step 6 answer, because OpenCode agents have no `CONTEXT7_API_KEY`.

Before: `context7`, `gitlab` and `playwright` are `"type": "local"` with the same `sh -c` commands as Step 13's "before" (gitlab exports its four `GITLAB_*` variables inside the command), each with `"enabled": true, "timeout": 120000`. After:

```jsonc
"context7": {
  "type": "remote",
  "url": "http://127.0.0.1:8932/mcp",
  "enabled": true,
  "timeout": 120000
},
"gitlab": {
  "type": "remote",
  "url": "http://127.0.0.1:8933/mcp",
  "headers": {
    "Authorization": "Bearer {env:SHARED_MCP_TOKEN}"
  },
  "oauth": false,
  "enabled": true,
  "timeout": 120000
},
"playwright": {
  "type": "remote",
  "url": "http://127.0.0.1:8931/mcp",
  "enabled": true,
  "timeout": 120000
}
```

```bash
node -e '
const fs = require("fs");
const file = "/workspace/.agent-tools/opencode/opencode.jsonc";
const text = fs.readFileSync(file, "utf8");
const config = JSON.parse(text);
const indent = (value) => JSON.stringify(value, null, 2).replace(/\n/g, "\n  ");
const before = `"mcp": ${indent(config.mcp)},\n`;
if (!text.includes(before)) throw new Error("mcp block is not in the expected layout; edit by hand");
const remote = { enabled: true, timeout: 120000 };
config.mcp.context7 = { type: "remote", url: "http://127.0.0.1:8932/mcp", ...remote };
config.mcp.gitlab = {
  type: "remote",
  url: "http://127.0.0.1:8933/mcp",
  headers: { Authorization: "Bearer {env:SHARED_MCP_TOKEN}" },
  oauth: false,
  ...remote,
};
config.mcp.playwright = { type: "remote", url: "http://127.0.0.1:8931/mcp", ...remote };
fs.writeFileSync(file, text.replace(before, `"mcp": ${indent(config.mcp)},\n`));
'
```

Expected: no output (the layout guard passed on 2026-11-06 in this container). Paseo's OpenCode agents receive the token through the hook. Because the token is a launch-env key, each OpenCode agent gets its own `opencode serve` process (see Operator notes).

- [ ] **Step 16: Export SHARED_MCP_TOKEN in terminals**

Shells that Paseo did not open as an agent (Paseo terminals, SSH) lack the variable. In them, gitlab gets the literal `Bearer ${SHARED_MCP_TOKEN}` and answers 401. Append the one-line fix to `~/.bashrc`; it holds no secret, only a path:

```bash
printf '%s\n' '[ -r "${PASEO_HOME:-$HOME/.paseo}/shared-mcp/token" ] && export SHARED_MCP_TOKEN="$(cat "${PASEO_HOME:-$HOME/.paseo}/shared-mcp/token")"' >> /home/paseo/.bashrc
tail -1 /home/paseo/.bashrc
```

Expected: the appended line, printed back. In a shell opened before this step, run `export SHARED_MCP_TOKEN="$(cat "${PASEO_HOME:-$HOME/.paseo}/shared-mcp/token")"` or `source ~/.bashrc`.

- [ ] **Step 17: Update /workspace/CLAUDE.md**

Use the Edit tool. If the old text differs on this instance, adapt it rather than forcing the edit, but keep the `auth-proxy` sentence: archiving workspace `wks_88daa379783a712d` would stop `auth-proxy` and break the rollback. old_string:

```
- pia-mcp, Serena and Graphify run here as HTTP servers from `paseo.json`,
  started by SessionStart hooks, so the pia-mcp plugin is not installed here.
  They belong to paseo workspace `wks_88daa379783a712d`; never archive it.
```

new_string:

```
- Playwright, Context7, GitLab, Serena, Graphify and pia-mcp each run once
  here as HTTP servers that agents reach on 127.0.0.1, supervised by Paseo's
  `shared-mcp` built-in plugin, so the pia-mcp plugin is not installed here.
  Command Center > Shared MCP servers shows their state, RSS and logs,
  restarts one, and edits the definitions (source copy:
  `/workspace/.agent-tools/shared-mcp-servers.json`). GitLab needs
  `SHARED_MCP_TOKEN`: Paseo adds it to every agent it opens, and `~/.bashrc`
  exports it for terminals. Restart playwright there after mdaq-browser
  changes IP; it resolves the address only at start. The supervisor checks
  only the HTTP layer: when Serena symbol queries return errors, press
  Restart on serena there.
- `auth-proxy` still runs as a script in paseo workspace
  `wks_88daa379783a712d`, which the rollback also uses; never archive it.
```

- [ ] **Step 18: Update /workspace/.agent-tools/README.md**

Use the Edit tool for three replacements. First, line 22, old:

```
- `mcp.json`: Atlassian, Context7, GitLab, and Playwright MCP servers for Claude and Kiro.
```

new:

```
- `mcp.json`: MCP servers for Claude and Kiro. Context7, GitLab, Playwright, Serena, Graphify and PIA-MCP are HTTP URLs on 127.0.0.1, served by Paseo's `shared-mcp` plugin; the GitLab header reads `${SHARED_MCP_TOKEN}`.
- `shared-mcp-servers.json`: the six server definitions pasted into Command Center > Shared MCP servers > Definitions on a new container.
```

Second, after line 27 (`- \`bin/read-mcp-env.js\`: …`), add:

```
- `bin/shared-mcp-check.js`: checks that the six shared MCP servers answer and that every client config points at them. Exits 1 when a check fails.
```

Third, lines 56-59. Read the answer first with `cat "$(ls -d /workspace/.agent-tools/backups/*-shared-mcp | tail -1)/context7-choice"`. Old:

```
Set `GITLAB_PERSONAL_ACCESS_TOKEN`, `CONTEXT7_API_KEY`, and
`BDDEVLAB_API_KEY` in the environment as applicable. GitLab and Context7 also
fall back to values under `env` in `~/.claude/settings.json`. Atlassian requires
separate OAuth authorization in each client.
```

new, when the answer is `anonymous`:

```
Set `GITLAB_PERSONAL_ACCESS_TOKEN` and `BDDEVLAB_API_KEY` in the environment as
applicable. The shared GitLab and PIA-MCP servers fall back to the value under
`env` in `~/.claude/settings.json`. Context7 runs without a key: in HTTP mode it
takes the key from each request's headers, and `mcp.json` sends none. Atlassian
requires separate OAuth authorization in each client.
```

new, when the answer is `keyed`:

```
Set `GITLAB_PERSONAL_ACCESS_TOKEN`, `CONTEXT7_API_KEY`, and `BDDEVLAB_API_KEY`
in the environment as applicable. The shared GitLab and PIA-MCP servers fall
back to the value under `env` in `~/.claude/settings.json`. Context7 takes its
key from each request's headers: `mcp.json` sends
`X-Context7-API-Key: ${CONTEXT7_API_KEY}`, which Claude fills from that `env`
block. Kiro sends the text unexpanded, and OpenCode sends no key. Atlassian
requires separate OAuth authorization in each client.
```

- [ ] **Step 19: Run the check and confirm it passes**

```bash
node /workspace/.agent-tools/bin/shared-mcp-check.js; echo "exit=$?"
```

Expected: 17 `ok` lines (`token file is private`, six servers at HTTP 200, gitlab refusing at HTTP 401, and nine config lines, the last reading `paseo.json keeps only auth-proxy (auth-proxy)`), then `shared-mcp rollout: all checks pass` and `exit=0`. `mcp.json context7 is HTTP` passes under both Step 6 answers and fails if a header other than the Step 13 one is present.

- [ ] **Step 20: Check Claude's view with and without the token**

Every server is HTTP now, so `claude mcp list` starts no stdio processes. The first command runs an interactive shell, which reads `~/.bashrc` and so sets `SHARED_MCP_TOKEN`; ignore a `no job control` warning. The second strips the variable.

```bash
bash -ic 'cd /workspace && claude mcp list'
cd /workspace && env -u SHARED_MCP_TOKEN claude mcp list
```

Expected: the first run shows playwright, context7, gitlab, serena, graphify and pia-mcp connected (atlassian depends on its own OAuth state), and playwright carries no `[Conflicting scopes]` tag. The second shows gitlab failed or needing authentication and the rest connected. That proves the `${SHARED_MCP_TOKEN}` header is what admits a client. If playwright shows `[Conflicting scopes]`, compare its entry in `/workspace/.agent-tools/mcp.json` with the one in `/home/paseo/.claude/.claude.json` and make them identical.

- [ ] **Step 21: Call the three new servers from two Claude agents**

These agents run on the live 6767 daemon, so every tool call they make waits for your approval, and you approve only the three calls the check needs. Two things would otherwise let a call through unasked:

- Mode. Without `--mode`, the fork starts Claude in `auto` (`packages/server/src/server/agent/providers/claude/agent.ts:1053-1060`), where a classifier approves tool calls, and `bypassPermissions` skips every prompt. `--mode default` ("Always Ask") prompts.
- Directory. `/workspace/.claude/settings.local.json` pre-allows write tools such as `mcp__gitlab__create_merge_request_note`, `mcp__gitlab__create_merge_request_thread` and Playwright's `browser_click` and `browser_evaluate` on the live mdaq-browser, so in `/workspace` those would run with no prompt even in Always Ask. The agents therefore run in a new directory, `/tmp/shared-mcp-check`, whose `.mcp.json` holds only the playwright, context7 and gitlab entries copied from the real `mcp.json` and whose `.claude/settings.local.json` enables only those. The user-scope servers (atlassian, serena, graphify, pia-mcp, and the identical playwright) still load there, but `~/.claude/settings.json` allows no MCP tool, so a call to any of them waits for approval too.

Without `--workspace`, `paseo run` takes its workspace from `PASEO_WORKSPACE_ID` (and then runs in that workspace's directory, not `--cwd`) or from the agent that calls it (`packages/cli/src/commands/agent/run.ts:520-565`). So the step creates a workspace for the directory and names it with `--workspace`, which wins over both.

```bash
mkdir /tmp/shared-mcp-check /tmp/shared-mcp-check/.claude
node -e '
const fs = require("fs");
const dir = "/tmp/shared-mcp-check";
const { mcpServers } = JSON.parse(fs.readFileSync("/workspace/.agent-tools/mcp.json", "utf8"));
const names = ["playwright", "context7", "gitlab"];
const picked = Object.fromEntries(names.map((name) => [name, mcpServers[name]]));
fs.writeFileSync(`${dir}/.mcp.json`, JSON.stringify({ mcpServers: picked }, null, 2) + "\n");
const local = { enabledMcpjsonServers: names };
fs.writeFileSync(`${dir}/.claude/settings.local.json`, JSON.stringify(local, null, 2) + "\n");
console.log("entries:", Object.keys(picked).join(","));
'
paseo workspace create --isolation local --path /tmp/shared-mcp-check --title "shared-mcp check" --json \
  | node -e '
const { workspaceId } = JSON.parse(require("fs").readFileSync(0, "utf8"));
if (!workspaceId) throw new Error("paseo workspace create returned no workspaceId");
console.log(workspaceId);
' > /tmp/shared-mcp-check.workspace
WS=$(cat /tmp/shared-mcp-check.workspace)
echo "workspace: $WS"
PROMPT='Call these MCP tools once each and nothing else, then answer in three lines: (1) gitlab get_project with project_id pr/utilities/pia-mcp: the numeric id; (2) context7 resolve-library-id with libraryName react: the first library id; (3) playwright browser_tabs with action list: the number of tabs.'
paseo run --provider claude --mode default --workspace "$WS" --title "shared-mcp check 1" --no-wait "$PROMPT"
paseo run --provider claude --mode default --workspace "$WS" --title "shared-mcp check 2" --no-wait "$PROMPT"
```

Expected: `mkdir` prints nothing (if `/tmp/shared-mcp-check` already exists, an earlier run did not reach Step 24: do Step 24's cleanup first), then `entries: playwright,context7,gitlab`, `workspace: <id>`, and one agent id from each `paseo run`. If `workspace:` is empty or the node script throws, stop: do not run the agents without their own workspace. The copied entries hold no secret: Step 13 checked the file they come from.

Approve each agent's calls one at a time. For each printed agent id:

```bash
paseo agent wait <id> --timeout 300
paseo permit ls
```

When `wait` reports `permission`, `paseo permit ls` lists the pending request with the agent's id prefix, a REQ_ID and the TOOL. Allow it only when TOOL is `mcp__gitlab__get_project`, `mcp__context7__resolve-library-id` or `mcp__playwright__browser_tabs`:

```bash
paseo permit allow <id> <req-id>
```

Deny anything else, which stops the agent, and report the tool name to the user:

```bash
paseo permit deny <id> <req-id> --interrupt
```

Run `paseo agent wait <id> --timeout 300` again after each answer, until it reports the agent idle. Each agent asks three times. Then `paseo agent logs <id> --filter tools --tail 10`. Expected: both agents answer all three lines, and their logs show three tool calls with no error. The gitlab call proves the hook gave a Paseo-launched Claude the token, because the daemon's own env has none.

- [ ] **Step 22: Call gitlab from a Kiro agent**

```bash
paseo run --provider kiro --cwd /workspace --title "shared-mcp kiro check" --wait-timeout 5m "Use the gitlab MCP server's get_project tool with project_id pr/utilities/pia-mcp, call no other tool, and reply with the numeric project id only."
```

If it returns with status `permission`, run `paseo permit ls` and treat the request as in Step 21: `paseo permit allow <id> <req-id>` only when its TOOL is gitlab's `get_project`, otherwise `paseo permit deny <id> <req-id> --interrupt` and report it. Do not use `--all`, which approves whatever is pending. Then `paseo agent wait <id> --timeout 300`. Expected: the same numeric id as Step 21, and `paseo agent logs <id> --filter tools --tail 5` shows one gitlab tool call with no error. Kiro reads the same `mcp.json` through `~/.kiro/settings/mcp.json`.

- [ ] **Step 23: Kill a server mid-session and confirm the agents recover**

This exercises the supervisor's crash path (process exit, `backoff` from 2 s, respawn), which is what agents hit when a shared server dies. Keep one Claude check agent from Step 21 and the Kiro agent from Step 22 open.

On the Servers tab, note gitlab's pid and its `restarts` count; an earlier startup crash may already have raised it above 0. Confirm the pid is the group leader the daemon spawned:

```bash
ps -o pid=,pgid=,args= --ppid "$(pgrep -x 'Paseo Daemon')" | awk '$1 == $2 && /mcp-gitlab/' | cut -c1-120
```

Expected: one line, `<pid> <pid> node /usr/local/bin/mcp-gitlab`, with the same pid as the tab. The pid is also the process-group id. Kill the whole group with SIGKILL, so nothing shuts down cleanly (put that number in place of `<pid>`):

```bash
kill -KILL -- -<pid>
```

Expected on the Servers tab within a few seconds: gitlab goes to `backoff` with its next retry about 2 s after the kill (longer if gitlab crashed in the last 10 minutes, because the backoff doubles), then `starting`, then `healthy` with a new pid. The tab polls every 5 s, so it may skip the short `backoff` state. `restarts` is one more than the count you noted, and `lastError` describes the exit (SIGKILL). Rerun the `ps` command: one line with the new pid. Then:

```bash
paseo agent send <claude-id> "Call gitlab get_project with project_id pr/utilities/pia-mcp again and reply with the numeric id only."
paseo agent send <kiro-id> "Call gitlab get_project with project_id pr/utilities/pia-mcp again and reply with the numeric id only."
```

Expected: both reply with the same id as Steps 21 and 22, without being reloaded. When either agent stops at `permission` (the Claude agent can ask again in Always Ask), run `paseo permit ls`, allow the request only when its TOOL is gitlab's `get_project` (`paseo permit allow <agent-id> <req-id>`), deny anything else with `--interrupt` as in Step 21, and then `paseo agent wait <agent-id> --timeout 300`. If either agent answers with a session or connection error, write down the client and the error text for Step 27. The spike says both reconnect, so that is a finding to report, not something to fix in this task.

Optional extra check of the graceful path: press Restart on gitlab, wait for `healthy` with `restarts` one higher again, and repeat the two `paseo agent send` commands. Expected: the same id from both.

- [ ] **Step 24: Archive the three test agents and remove the check directory**

```bash
paseo agent archive <claude-id-1>
paseo agent archive <claude-id-2>
paseo agent archive <kiro-id>
paseo workspace archive "$(cat /tmp/shared-mcp-check.workspace)"
rm -rf /tmp/shared-mcp-check /tmp/shared-mcp-check.workspace
```

Expected: each archive command confirms the archive; the workspace one prints the workspace id with status `archived`. Archiving a local workspace leaves its directory on disk (`packages/server/src/server/workspace-archive-service.ts:313-321` marks it not Paseo-owned, and `:395` removes only Paseo-owned worktrees), so `rm -rf` removes it. Archive only the id in `/tmp/shared-mcp-check.workspace`, never `wks_88daa379783a712d`, which still runs `auth-proxy`.

- [ ] **Step 25: Reload agents that predate the switch, record memory after, and rerun the check**

Agents opened before Step 13 still hold their own stdio copies. List them with `paseo agent ls -g`. Reload the idle ones the user picks with `paseo agent reload <id>`, which restarts the process; the reload runs `agent.open.before` again, so the agent gets the token. Leave busy ones until they finish or close. Then:

```bash
B=$(ls -d /workspace/.agent-tools/backups/*-shared-mcp | tail -1)
{
  ps -eo pid=,ppid=,rss=,args= | awk '
  { pp[$1] = $2; rss[$1] = $3; a = $0; sub(/^ *[0-9]+ +[0-9]+ +[0-9]+ +/, "", a); cmd[$1] = a }
  END {
    for (p in cmd) {
      if (cmd[p] !~ /[p]laywright-mcp|[c]ontext7-mcp|[m]cp-gitlab|[n]pm exec @|[s]erena|[g]raphify-mcp|[s]rc\.server|[p]yright|[t]erraform-ls/) continue
      for (q = pp[p]; q > 1 && cmd[q] !~ /(^|\/)(claude|kiro-cli-chat|opencode)( |$)/; q = pp[q]) ;
      if (q > 1) { s += rss[p]; ns++ } else { h += rss[p]; nh++ }
    }
    printf "per-agent MCP copies: %d processes, %d MB\nshared MCP servers: %d processes, %d MB\n", ns, s / 1024, nh, h / 1024
  }'
  free -m | awk 'NR == 2 { print "available:", $7, "MB" }'
} | tee "$B/memory-after.txt"
node /workspace/.agent-tools/bin/shared-mcp-check.js; echo "exit=$?"
```

Expected: `per-agent MCP copies: 0 processes, 0 MB` once every old agent has reloaded or closed. `shared MCP servers` is about the sum of the Servers tab RSS column. That column already includes serena's language servers: they run in their own process groups, but Task 2's reader also counts every descendant of the group by parent pid. `available` rises by roughly the Step 5 per-agent figure. The check ends with `shared-mcp rollout: all checks pass` and `exit=0` again. If `Claude user-scope playwright is HTTP` fails, a running Claude process saved an old copy of `/home/paseo/.claude/.claude.json`: repeat Step 14 and rerun the check.

- [ ] **Step 26: Update the two memory entries and their index lines**

Use the Read tool and then the Edit tool on each file under `/home/paseo/.claude/projects/-workspace/memory/`. Other sessions edit these files too, so match the text as it stands now. Where a block below no longer matches word for word, replace the block that holds the same facts. Write today's date (`date +%F`) wherever the text says `<today>`.

`mdaq-serena-code-graph.md`, edit 1. Replace the `description:` line in the front matter with:

```
description: "Serena MCP gives cross-repo symbol navigation over all 38 Python repos; one shared HTTP instance supervised by Paseo's shared-mcp built-in plugin, the GitNexus alternative that runs on ARM64"
```

Edit 2. Replace the paragraph that starts `**Start it with \`paseo script start serena\`\*\*`and ends`configs hardcode.` with:

```
**Paseo's `shared-mcp` built-in plugin runs it** (since <today>), along with
playwright, context7, gitlab, graphify and pia-mcp. Its definition is in
`/workspace/.agent-tools/shared-mcp-servers.json`, loaded through Command
Center > Shared MCP servers > Definitions; the plugin stores it in
`$PASEO_HOME/plugin-settings/shared-mcp/servers.json`. The daemon starts it at
boot and restarts it when it exits or fails two health probes in a row. The
Servers tab shows its state, pid, RSS, restart count, last error and log tail,
and has a Restart button. The serena script is gone from `/workspace/paseo.json`.
```

Edit 3. Replace the paragraph that starts `**The launcher must extend PATH.**` and ends `` `/tmp/serena-health.log`. `` with:

```
**The launcher must extend PATH.** Paseo's own PATH has no
`/home/paseo/.local/bin`, so the python language server dies with
`Could not find 'uvx' or 'uv' in PATH` even though the server itself starts
(the definition calls uvx by absolute path). The command is therefore
`exec env PATH=/home/paseo/.local/bin:$PATH /home/paseo/.local/bin/uvx ...`.
This broke silently for a while: the HTTP endpoint answers 406 and looks
healthy while every symbol tool returns a language-server error. **Health-check
with a real `get_symbols_overview` call, not just the port.** The shared-mcp
supervisor does not: its probe is an MCP `initialize` POST, so it reports
`healthy` while the language servers are dead. When symbol tools return errors,
press Restart on serena in Command Center > Shared MCP servers.
`/workspace/.agent-tools/bin/serena-healthcheck.sh` still holds the deep check
(one `get_symbols_overview` per language, log at `/tmp/serena-health.log`), but
it is kept only for rollback: its restart branch calls `paseo script stop/start
serena`, that script no longer exists, and the output is discarded, so it
restarts nothing.
```

Edit 4. Replace the block from the line `Two limits that follow from that:` through the line ending `` `--workspace wks_88daa379783a712d`. `` with:

```
Before <today> serena ran as a `paseo.json` script in workspace
`wks_88daa379783a712d`, started by a SessionStart hook (`serena-autostart.sh`),
because Paseo scripts have no boot path. That hook is gone from
`~/.claude/settings.json`; `serena-autostart.sh` stays only for rollback.
```

Edit 5. Replace the paragraph that starts ``Never kill it with `pkill -f 'serena start-mcp-server'` `` and ends ``Use `paseo script stop serena`.`` with:

```
Never kill it with `pkill -f 'serena start-mcp-server'`: the pattern appears in
the killing shell's own command line, so pkill kills that shell before the next
command runs (exit 144). Press Restart on the Servers tab instead, or turn off
its enable switch there to stop it. Its pyright-langserver and terraform-ls run
in their own process groups, but the plugin follows them by parent pid: the
tab's RSS includes them, and every stop the plugin makes signals them with
serena. They are orphaned only when serena exits first (a crash, or a group
kill from outside the plugin), because they then belong to init; find those with
`ps -eo pid=,ppid=,args= | awk '$2 == 1' | grep -E '[p]yright|[t]erraform-ls'`.
```

`mdaq-workspace-mcp-setup.md`, edit 1. Replace these two lines:

```
connect from any directory. Their SessionStart autostart hooks are the
`/workspace/.agent-tools/bin/*-autostart.sh` scripts.
```

with:

```
connect from any directory. Since <today> Paseo's `shared-mcp` plugin runs
them (see below); their SessionStart autostart hooks are gone.
```

Edit 2. Replace the paragraph that starts `**All three run as scripts of one paseo workspace,` and ends `approval".` with the text below. Use the first Context7 sentence for the `anonymous` answer from Step 6 and the second for `keyed`, and drop the other.

```
**Since <today> Paseo's `shared-mcp` built-in plugin supervises six MCP
servers**: playwright (8931), context7 (8932), gitlab (8933), serena (8000),
graphify (8080) and pia-mcp (8090), one process each for every agent. Command
Center > Shared MCP servers has two tabs: Servers (state, pid, RSS, restarts,
last error, log tail, a Restart button and an enable switch) and Definitions
(the JSON the plugin stores in
`$PASEO_HOME/plugin-settings/shared-mcp/servers.json`; the source copy, with no
secrets, is `/workspace/.agent-tools/shared-mcp-servers.json`). Nothing watches
that file: change definitions on the Definitions tab, or the daemon reads them
only at its next start. `mcp.json`, the user-scope playwright entry and
OpenCode's config point at `http://127.0.0.1:<port>/mcp`. gitlab requires
`Authorization: Bearer ${SHARED_MCP_TOKEN}`: the plugin keeps the token in
`$PASEO_HOME/shared-mcp/token` (0600) and adds `SHARED_MCP_TOKEN` to every
agent Paseo opens, and `~/.bashrc` exports it for terminals; without it gitlab
answers 401. Context7 runs anonymous (the user's choice at rollout).
Context7 is keyed through an `X-Context7-API-Key: ${CONTEXT7_API_KEY}` header
in `mcp.json`, which only Claude expands (the user's choice at rollout). Logs
are in `$PASEO_HOME/shared-mcp/logs/<id>.log`. The `*-autostart.sh` and
`serena-healthcheck.sh` scripts and the backups in
`/workspace/.agent-tools/backups/*-shared-mcp/` are kept only for rollback.
`auth-proxy` is still a script of paseo workspace `wks_88daa379783a712d`
"Shared MCP servers (do not archive)", and the rollback starts the old scripts
there, so never archive it. `context7` and `gitlab` are still project scope
only, so a sub-repo session shows them as "pending approval".
```

Edit 3. In the `**The two MCP definitions must be byte-identical**` paragraph, replace the text from `` `claude mcp add` normalises quoting `` through the closing fence of the `jq` example with:

```
Since <today> both playwright entries are the URL
`http://127.0.0.1:8931/mcp`, so no stdio quoting is left to copy; if
`claude mcp list` flags `[Conflicting scopes]`, compare the two `playwright`
entries and make them identical.
```

`MEMORY.md`: replace the line that starts `- [Workspace MCP & PATH setup](mdaq-workspace-mcp-setup.md)` with the line below, keeping any fact the current line has that this one lacks:

```
- [Workspace MCP & PATH setup](mdaq-workspace-mcp-setup.md) — jq 1.7.1 in ~/.local/bin since 2026-11-06; user scope is `claude mcp add -s user` (settings.json mcpServers is ignored); secrets in settings.json; ~/.local/bin NOT on PATH; six shared MCP servers supervised by Paseo's shared-mcp plugin (Command Center > Shared MCP servers: state, Restart, definitions), gitlab needs SHARED_MCP_TOKEN; autostart/healthcheck scripts kept only for rollback; auth-proxy still in workspace wks_88daa379783a712d, never archive it
```

and the line that starts `- [Serena code graph](mdaq-serena-code-graph.md)` with:

```
- [Serena code graph](mdaq-serena-code-graph.md) — cross-repo symbol nav, python + terraform; one shared HTTP server supervised by Paseo's shared-mcp plugin; its probe is HTTP only, so port answering ≠ healthy: probe a symbol, press Restart on the Servers tab; needs terraform on PATH, reinstalled 2026-10-26 in ~/.local/bin (survives rebuild)
```

Expected: `grep -c 'shared-mcp' /home/paseo/.claude/projects/-workspace/memory/{mdaq-serena-code-graph,mdaq-workspace-mcp-setup,MEMORY}.md` prints a count above 0 for each file, and `grep -n 'paseo script start serena' /home/paseo/.claude/projects/-workspace/memory/mdaq-serena-code-graph.md` prints nothing.

- [ ] **Step 27: Report to the user**

```bash
B=$(ls -d /workspace/.agent-tools/backups/*-shared-mcp | tail -1)
cat "$B/context7-choice" "$B/memory-before.txt" "$B/memory-after.txt"
```

Tell the user in chat:

- the before and after figures and the change in `available`;
- the Context7 answer from Step 6;
- that the old automatic Serena language-server restart is gone. `serena-healthcheck.sh` ran a real `get_symbols_overview` per language and restarted Serena through `paseo script` when one failed. The shared-mcp supervisor checks only the HTTP layer, the spec does not cover a deeper check, and the script is kept only for rollback with a restart branch that no longer works. Until something replaces it, the fix is Restart on serena in Command Center > Shared MCP servers. Ask whether a follow-up should add a deeper probe;
- any client error written down in Step 23.

- [ ] **Step 28: Confirm the repository is untouched**

```bash
git -C /workspace/utils/paseo status --short
```

Expected: no path from this task. There is nothing to commit: every change in this task lives outside the repository, on this instance.

#### Rollback (only if a check fails and cannot be fixed forward)

Restore client configs first, so new sessions stop asking for the HTTP servers. Then stop the plugin's servers, and only then restart the old scripts, which need the ports free.

```bash
B=$(ls -d /workspace/.agent-tools/backups/*-shared-mcp | tail -1)
cp -p "$B/agent-tools.mcp.json" /workspace/.agent-tools/mcp.json
cp -p "$B/agent-tools.opencode.jsonc" /workspace/.agent-tools/opencode/opencode.jsonc
cp -p "$B/agent-tools.README.md" /workspace/.agent-tools/README.md
cp -p "$B/workspace.CLAUDE.md" /workspace/CLAUDE.md
claude mcp remove -s user playwright
claude mcp add-json -s user playwright "$(cat "$B/claude-user-playwright.json")"
node -e '
const fs = require("fs");
const file = "/home/paseo/.claude/settings.json";
const settings = JSON.parse(fs.readFileSync(file, "utf8"));
settings.hooks.SessionStart = JSON.parse(fs.readFileSync(process.argv[1], "utf8"));
fs.writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
' "$B/claude-settings.SessionStart.json"
sed -i '/SHARED_MCP_TOKEN=/d' /home/paseo/.bashrc
```

1. In Command Center > Shared MCP servers > Definitions, save `[]`. The plugin stops the six servers it owns; the Servers tab empties.
2. Restore the scripts and start them in the workspace that still runs `auth-proxy`:
   ```bash
   cp -p "$B/workspace.paseo.json" /workspace/paseo.json
   WS=$(sed -n 's/^WORKSPACE=//p' /workspace/.agent-tools/bin/serena-autostart.sh)
   for name in serena graphify pia-mcp; do paseo script start "$name" --workspace "$WS"; done
   ```
3. Run `node /workspace/.agent-tools/bin/shared-mcp-check.js`. Expected: 8931 to 8933 `ECONNREFUSED`; 8000, 8080 and 8090 `ok`; the config lines FAIL as in Step 4. The token line now reads `ok`, and the token file can stay.
4. Rerun the orphan check from Step 12, then reload the agents opened on the HTTP config with `paseo agent reload <id>`.
5. If Step 26 has run, undo its memory edits with the Edit tool. Do not copy old files back: other sessions may have changed them since.

#### Operator notes

- Context7 authentication follows the Step 6 answer, recorded in `$B/context7-choice`. `@upstash/context7-mcp` 4.0.4 in HTTP mode takes the key only from request headers (dist/index.js:276-282), reads `CONTEXT7_API_KEY` from env only in stdio mode (:444), and refuses `--api-key` with `--transport http` (:37-38). Its `/mcp` route serves anonymous requests (:362-365).
- Context7 listens on every interface (`[::]:8932`, from `app.listen(port)` at :426; there is no host option), so other containers on the Docker network can reach it. If 8932 is taken it moves to the next free port, up to 8942 (:428-430). Without a key it exposes no credential; with answer (b) the key still never sits on the server, because each request carries it.
- Playwright resolves `mdaq-browser` once, at start. After the browser container changes IP, press Restart on playwright. The health probe never opens the browser, so the supervisor cannot notice a stale address.
- GitLab's limit is per client IP. Every agent and the probe share the 1000-per-minute bucket from 127.0.0.1, and a 429 means it is exhausted.
- The supervisor checks only the HTTP layer: a Serena whose language servers are dead still shows `healthy`. When Serena symbol queries return errors, press Restart on serena in Command Center > Shared MCP servers. `serena-healthcheck.sh` is kept only for rollback. Its restart branch (`paseo script stop/start serena --workspace wks_88daa379783a712d`, lines 83-84) fails after Step 11, and its output goes to `/dev/null`, so the failure is silent. The spec does not cover a deeper probe; Step 27 asks the user about a follow-up.
- Claude sessions started before Step 10 still run the old autostart hooks on compact or resume. With the ports up, those scripts exit at once, except that `serena-autostart.sh` backgrounds `serena-healthcheck.sh`. That one opens one Serena session without closing it, at most every 30 minutes, until those sessions end. Keep the `*-autostart.sh` and healthcheck scripts in place for rollback.
- Serena's pyright-langserver and terraform-ls run in their own process groups. The plugin still follows them by parent pid: the Servers tab RSS includes them (Task 2), and every stop it makes (Restart, the enable switch, an unhealthy kill, daemon shutdown, orphan reclaim) lists them before the first signal and sends them SIGTERM and then SIGKILL with the group (Task 4). They are orphaned only when serena exits before a stop lists them, for example on a crash or a group kill from outside the plugin, because they then belong to init and nothing links them to the server. The orphan check in Step 12 finds them; `kill <pid>` each one.
- OpenCode agents each get their own `opencode serve` process, because `SHARED_MCP_TOKEN` is a launch-env key.
