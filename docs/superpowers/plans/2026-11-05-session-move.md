# Session Move Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user move an agent to another account or provider without calling the agent's own (quota-exhausted) model, and move it back later.

**Architecture:** A daemon module `packages/server/src/server/agent/session-move/` implements the move as a sequence of existing AgentManager operations:

- **Native:** for the same CLI family (Claude to Claude), copy the transcript and resume the same session id.
- **History handoff:** for other providers, create an agent in the same workspace with a deterministic history attachment.

Both strategies then link the two agents with labels, archive the original, and broadcast an event. A new dotted RPC `agent.move.request` exposes it to the app, CLI and MCP. The app adds a tab-menu action, a move dialog, a limit banner, and a tab retarget on `agent_moved`.

**Tech Stack:** TypeScript, zod (protocol), Vitest, Expo/React Native (app), Commander (CLI), MCP SDK.

**Spec:** `docs/superpowers/specs/2026-11-05-session-move-design.md`

## Global Constraints

- **NO git commits.** The user asked that nothing is committed until all features are done. Each task ends with a "Checkpoint" step (typecheck, lint, format) instead of a commit.
- **Run only the test files you touch:** `npx vitest run <file> --bail=1`. Never run a whole workspace suite.
- **After every change:** run `npm run typecheck` and `npm run lint -- <paths>`. Then run `npm run format:files -- <paths>`.
- **Rebuild before cross-package typecheck.** If the server or app fails to typecheck after protocol or client changes, run `npm run build:client` (protocol + client) or `npm run build:server` first.
- **Protocol is backward-compatible.** New fields are optional, and new messages are additive. Do not use `.transform()`, `.catch()` or `.preprocess()` in new wire schemas. RPC names are dotted, as `x.y.request` / `x.y.response`.
- **Server imports:** shipped server code uses relative `.js` import paths, never `@server/*`.
- **Labels:** never use `paseo.parent-agent-id` to link moved agents. Archiving cascades to children.
- **New label constants:** `paseo.moved-from-agent-id` and `paseo.moved-to-agent-id`.
- **Feature flag:** `server_info.features.agentMove`. The app gates all move UI on it.

## File Structure

| File                                                                         | Responsibility                                              |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------- |
| `packages/protocol/src/agent-labels.ts` (modify)                             | Moved-from/to label constants and readers                   |
| `packages/server/src/server/agent/session-move/limit-matcher.ts` (new)       | Decides whether an error string is a usage/rate-limit error |
| `packages/server/src/server/agent/session-move/handoff-context.ts` (new)     | Builds the deterministic header and history attachment      |
| `packages/server/src/server/agent/session-move/claude-transcript.ts` (new)   | Copies a Claude transcript between config dirs              |
| `packages/server/src/server/agent/session-move/move-agent.ts` (new)          | Move and move-back orchestration                            |
| `packages/server/src/server/agent/provider-snapshot-manager.ts` (modify)     | Public `getProviderLaunchInfo(id)`                          |
| `packages/server/src/server/agent/agent-storage.ts` (modify)                 | `pendingMoveContext` on the stored record                   |
| `packages/server/src/server/agent/agent-prompt.ts` (modify)                  | Prepend and clear `pendingMoveContext` on the next prompt   |
| `packages/server/src/server/agent/agent-manager.ts` (modify)                 | `limitReached` state, `agent_moved` event                   |
| `packages/server/src/server/agent/agent-projections.ts` (modify)             | Project `limitReached` to records and payloads              |
| `packages/server/src/server/plugins/usage-sources/index.ts` (modify)         | Public `listReportsForScope`                                |
| `packages/protocol/src/messages.ts` (modify)                                 | Move RPCs, `agent_moved`, `limitReached`, feature flag      |
| `packages/server/src/server/session.ts` (modify)                             | Dispatch move RPCs, forward `agent_moved`                   |
| `packages/server/src/server/authorization/operation-permissions.ts` (modify) | Permissions for the new RPCs                                |
| `packages/server/src/server/websocket-server.ts` (modify)                    | `agentMove: true` feature flag                              |
| `packages/client/src/daemon-client.ts` (modify)                              | `moveAgent`, `moveAgentBack`, `listMoveTargets`             |
| `packages/server/src/server/agent/tools/paseo-tools.ts` (modify)             | MCP `move_agent`                                            |
| `packages/cli/src/commands/agent/move.ts` (new)                              | `paseo agent move` / `move-back`                            |
| `packages/app/src/session-move/` (new)                                       | Dialog, banner, retarget hook                               |
| `packages/app/src/screens/workspace/workspace-tab-menu.ts` (modify)          | "Move session…" menu entry                                  |
| `docs/agent-lifecycle.md` (modify)                                           | Document move semantics                                     |

---

### Task 1: Labels and limit matcher

**Files:**

- Modify: `packages/protocol/src/agent-labels.ts`
- Create: `packages/server/src/server/agent/session-move/limit-matcher.ts`
- Test: `packages/server/src/server/agent/session-move/limit-matcher.test.ts`

**Interfaces:**

- Produces:
  - `MOVED_FROM_AGENT_ID_LABEL`
  - `MOVED_TO_AGENT_ID_LABEL`
  - `getMovedFromAgentId(labels): string | null`
  - `getMovedToAgentId(labels): string | null` (from `@getpaseo/protocol/agent-labels`, using the same import path the server already uses for `PARENT_AGENT_ID_LABEL`)
  - `isUsageLimitError(message: string): boolean`

- [ ] **Step 1: Add the label constants.** Append to `packages/protocol/src/agent-labels.ts`:

```ts
export const MOVED_FROM_AGENT_ID_LABEL = "paseo.moved-from-agent-id";
export const MOVED_TO_AGENT_ID_LABEL = "paseo.moved-to-agent-id";

function readLabel(labels: Record<string, unknown> | null | undefined, key: string): string | null {
  const value = labels?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function getMovedFromAgentId(labels: Record<string, unknown> | null | undefined) {
  return readLabel(labels, MOVED_FROM_AGENT_ID_LABEL);
}

export function getMovedToAgentId(labels: Record<string, unknown> | null | undefined) {
  return readLabel(labels, MOVED_TO_AGENT_ID_LABEL);
}
```

- [ ] **Step 2: Write the failing matcher test.** Create `limit-matcher.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isUsageLimitError } from "./limit-matcher.js";

describe("isUsageLimitError", () => {
  it.each([
    "Claude AI usage limit reached|1762300800",
    "You've hit your 5-hour limit. Resets at 2pm",
    "Weekly limit reached for Opus",
    "You've hit your usage limit. Upgrade or try again in 3 hours.",
    "stream error: exceeded retry limit, last status: 429 Too Many Requests",
    "Rate limit reached for gpt-5.6-codex",
    "Error: insufficient_quota",
    "Monthly quota exceeded",
  ])("recognises %s", (message) => {
    expect(isUsageLimitError(message)).toBe(true);
  });

  it.each([
    "Requested fake provider failure",
    "ENOENT: no such file or directory",
    "Context window limit: compacting conversation",
    "Process exited with code 1",
  ])("ignores %s", (message) => {
    expect(isUsageLimitError(message)).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test and confirm it fails.**

Run: `cd packages/server && npx vitest run src/server/agent/session-move/limit-matcher.test.ts --bail=1`
Expected: FAIL, "Cannot find module './limit-matcher.js'".

- [ ] **Step 4: Implement the matcher.** Create `limit-matcher.ts`:

```ts
// Provider CLIs report an exhausted plan or rate limit only as free text on a failed turn.
// These patterns come from real Claude Code, Codex and OpenAI-compatible errors. "Context
// window limit" is deliberately not a usage limit: moving would not help it.
const USAGE_LIMIT_PATTERNS: readonly RegExp[] = [
  /usage limit/i,
  /\b(5|five)[- ]hour limit\b/i,
  /\bweekly limit\b/i,
  /\brate limit\b/i,
  /\b429\b/,
  /\bquota\b/i,
];

export function isUsageLimitError(message: string): boolean {
  return USAGE_LIMIT_PATTERNS.some((pattern) => pattern.test(message));
}
```

- [ ] **Step 5: Run the test and confirm it passes.** Same command. Expected: PASS, 12 tests.

- [ ] **Step 6: Checkpoint.** Run `npm run build:client`, then `npm run typecheck --workspace=@getpaseo/server`. Then run `npm run lint -- packages/protocol/src/agent-labels.ts packages/server/src/server/agent/session-move` and `npm run format:files -- <same paths>`.

---

### Task 2: Handoff context builder

**Files:**

- Create: `packages/server/src/server/agent/session-move/handoff-context.ts`
- Test: `packages/server/src/server/agent/session-move/handoff-context.test.ts`

**Interfaces:**

- Consumes: `buildAgentForkContextAttachment` (`../activity-curator.js`), `AgentTimelineRow` (`../agent-timeline-store-types.js`), `AgentAttachment` (`../agent-sdk-types.js`).
- Produces: the following function, which returns a `type: "text"` attachment with `contextKind: "chat_history"`:

  ```ts
  buildMoveHandoffAttachment(input: {
    rows: readonly AgentTimelineRow[];
    fromLabel: string;
    agentTitle: string | null;
    cwd: string;
    sinceSeq?: number;
  }): AgentAttachment
  ```

- [ ] **Step 1: Write the failing test.** Create `handoff-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";
import { buildMoveHandoffAttachment } from "./handoff-context.js";

function row(seq: number, item: AgentTimelineRow["item"]): AgentTimelineRow {
  return { seq, timestamp: new Date(1_000 * seq).toISOString(), item };
}

const rows: AgentTimelineRow[] = [
  row(1, { type: "user_message", text: "Fix the login redirect bug" }),
  row(2, { type: "assistant_message", text: "Looking at auth.ts" }),
  row(3, {
    type: "tool_call",
    callId: "c1",
    name: "Edit",
    status: "completed",
    detail: { type: "edit", filePath: "src/auth.ts" },
  } as AgentTimelineRow["item"]),
  row(4, {
    type: "tool_call",
    callId: "c2",
    name: "Write",
    status: "completed",
    detail: { type: "write", filePath: "src/auth.test.ts" },
  } as AgentTimelineRow["item"]),
  row(5, {
    type: "todo",
    items: [
      { text: "Reproduce", completed: true },
      { text: "Add regression test", completed: false },
    ],
  }),
  row(6, { type: "error", message: "Claude AI usage limit reached" }),
];

describe("buildMoveHandoffAttachment", () => {
  it("leads with a deterministic header before the chat history", () => {
    const attachment = buildMoveHandoffAttachment({
      rows,
      fromLabel: "Claude (personal)",
      agentTitle: "Login fix",
      cwd: "/workspace/app",
    });
    if (attachment.type !== "text") throw new Error("expected a text attachment");
    expect(attachment.contextKind).toBe("chat_history");
    const header = attachment.text.slice(0, attachment.text.indexOf("<chat-history"));
    expect(header).toContain("Moved from Claude (personal)");
    expect(header).toContain("Original task: Fix the login redirect bug");
    expect(header).toContain("- src/auth.ts");
    expect(header).toContain("- src/auth.test.ts");
    expect(header).toContain("- [ ] Add regression test");
    expect(header).not.toContain("Reproduce");
    expect(header).toContain("Last error: Claude AI usage limit reached");
    expect(attachment.text).toContain("Looking at auth.ts");
  });

  it("keeps only rows after sinceSeq in the history but the original task from the first row", () => {
    const attachment = buildMoveHandoffAttachment({
      rows,
      fromLabel: "Codex",
      agentTitle: null,
      cwd: "/workspace/app",
      sinceSeq: 2,
    });
    if (attachment.type !== "text") throw new Error("expected a text attachment");
    expect(attachment.text).toContain("Original task: Fix the login redirect bug");
    expect(attachment.text).not.toContain("Looking at auth.ts");
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `cd packages/server && npx vitest run src/server/agent/session-move/handoff-context.test.ts --bail=1`
Expected: FAIL, module not found. If it instead fails to compile on the `tool_call` fixture fields, open `packages/protocol/src/agent-types.ts:300-344` (`ToolCallBase`) and add the required base fields it lists (for example `callId`) to both fixtures.

- [ ] **Step 3: Implement the builder.** Create `handoff-context.ts`. The fork builder wraps its body in a `<chat-history…>` block, and the header is prepended before it:

```ts
import { buildAgentForkContextAttachment } from "../activity-curator.js";
import type { AgentAttachment } from "../agent-sdk-types.js";
import type { AgentTimelineRow } from "../agent-timeline-store-types.js";

export interface MoveHandoffInput {
  rows: readonly AgentTimelineRow[];
  fromLabel: string;
  agentTitle: string | null;
  cwd: string;
  /** Only rows after this seq go into the history (used by move back). */
  sinceSeq?: number;
}

function originalTask(rows: readonly AgentTimelineRow[]): string | null {
  for (const row of rows) {
    if (row.item.type === "user_message" && row.item.text.trim()) return row.item.text.trim();
  }
  return null;
}

function touchedFiles(rows: readonly AgentTimelineRow[]): string[] {
  const files = new Set<string>();
  for (const row of rows) {
    if (row.item.type !== "tool_call") continue;
    const detail = row.item.detail;
    if (detail.type === "edit" || detail.type === "write") files.add(detail.filePath);
  }
  return [...files];
}

function openTodos(rows: readonly AgentTimelineRow[]): string[] {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const item = rows[index]!.item;
    if (item.type === "todo")
      return item.items.filter((todo) => !todo.completed).map((todo) => todo.text);
  }
  return [];
}

function lastError(rows: readonly AgentTimelineRow[]): string | null {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const item = rows[index]!.item;
    if (item.type === "error") return item.message;
  }
  return null;
}

function buildHeader(input: MoveHandoffInput): string {
  const lines = [
    `Moved from ${input.fromLabel}. You are continuing another agent's work in ${input.cwd}.`,
  ];
  const task = originalTask(input.rows);
  if (task) lines.push(`Original task: ${task}`);
  const files = touchedFiles(input.rows);
  if (files.length > 0) lines.push("Files changed so far:", ...files.map((file) => `- ${file}`));
  const todos = openTodos(input.rows);
  if (todos.length > 0) lines.push("Open todos:", ...todos.map((todo) => `- [ ] ${todo}`));
  const error = lastError(input.rows);
  if (error) lines.push(`Last error: ${error}`);
  return lines.join("\n");
}

export function buildMoveHandoffAttachment(input: MoveHandoffInput): AgentAttachment {
  const historyRows =
    input.sinceSeq === undefined
      ? input.rows
      : input.rows.filter((row) => row.seq > input.sinceSeq!);
  const { attachment } = buildAgentForkContextAttachment({
    rows: historyRows,
    agentTitle: input.agentTitle,
    cwd: input.cwd,
  });
  return { ...attachment, text: `${buildHeader(input)}\n\n${attachment.text}` };
}
```

- [ ] **Step 4: Run the test and confirm it passes.** Same command. Expected: PASS, 2 tests. If the history marker is not `<chat-history`, read `buildForkContextText` in `activity-curator.ts` and adjust the test's `indexOf` marker to the real opening tag.

- [ ] **Step 5: Checkpoint.** Run typecheck, lint and format on `packages/server/src/server/agent/session-move`.

---

### Task 3: Claude transcript copy

**Files:**

- Create: `packages/server/src/server/agent/session-move/claude-transcript.ts`
- Test: `packages/server/src/server/agent/session-move/claude-transcript.test.ts`

**Interfaces:**

- Consumes: `claudeTranscriptPath` and `claudeProjectDir` from `../providers/claude/project-dir.js`.
- Produces: `copyClaudeTranscript(input: { cwd: string; sessionId: string; fromConfigDir: string; toConfigDir: string }): Promise<{ status: "copied"; path: string } | { status: "missing" }>`

- [ ] **Step 1: Write the failing test.** Create `claude-transcript.test.ts`:

```ts
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { claudeProjectDir } from "../providers/claude/project-dir.js";
import { copyClaudeTranscript } from "./claude-transcript.js";

describe("copyClaudeTranscript", () => {
  let root: string;
  let cwd: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "claude-move-"));
    cwd = join(root, "repo");
    await mkdir(cwd);
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("copies the session into the target config dir's project folder", async () => {
    const fromConfigDir = join(root, ".claude");
    const toConfigDir = join(root, ".claude-work");
    const sourceDir = await claudeProjectDir(cwd, { configDir: fromConfigDir });
    await mkdir(sourceDir, { recursive: true });
    await writeFile(join(sourceDir, "s-1.jsonl"), '{"type":"user"}\n');

    const result = await copyClaudeTranscript({
      cwd,
      sessionId: "s-1",
      fromConfigDir,
      toConfigDir,
    });

    const expected = join(await claudeProjectDir(cwd, { configDir: toConfigDir }), "s-1.jsonl");
    expect(result).toEqual({ status: "copied", path: expected });
    expect(await readFile(expected, "utf8")).toBe('{"type":"user"}\n');
  });

  it("overwrites an older copy so moving back carries the newer turns", async () => {
    const a = join(root, ".claude");
    const b = join(root, ".claude-work");
    for (const [dir, body] of [
      [a, "old\n"],
      [b, "old\nnew\n"],
    ] as const) {
      const projectDir = await claudeProjectDir(cwd, { configDir: dir });
      await mkdir(projectDir, { recursive: true });
      await writeFile(join(projectDir, "s-1.jsonl"), body);
    }
    await copyClaudeTranscript({ cwd, sessionId: "s-1", fromConfigDir: b, toConfigDir: a });
    const back = join(await claudeProjectDir(cwd, { configDir: a }), "s-1.jsonl");
    expect(await readFile(back, "utf8")).toBe("old\nnew\n");
  });

  it("reports a missing transcript instead of throwing", async () => {
    const result = await copyClaudeTranscript({
      cwd,
      sessionId: "nope",
      fromConfigDir: join(root, ".claude"),
      toConfigDir: join(root, ".claude-work"),
    });
    expect(result).toEqual({ status: "missing" });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `cd packages/server && npx vitest run src/server/agent/session-move/claude-transcript.test.ts --bail=1`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement the copy.** Create `claude-transcript.ts`:

```ts
import { access, copyFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { claudeProjectDir, claudeTranscriptPath } from "../providers/claude/project-dir.js";

export type CopyClaudeTranscriptResult = { status: "copied"; path: string } | { status: "missing" };

/**
 * Claude Code resumes a session only from its own config dir's projects folder, so moving a
 * session to another login (CLAUDE_CONFIG_DIR) means copying the transcript across first.
 */
export async function copyClaudeTranscript(input: {
  cwd: string;
  sessionId: string;
  fromConfigDir: string;
  toConfigDir: string;
}): Promise<CopyClaudeTranscriptResult> {
  const source = await claudeTranscriptPath({
    cwd: input.cwd,
    sessionId: input.sessionId,
    configDir: input.fromConfigDir,
  });
  try {
    await access(source);
  } catch {
    return { status: "missing" };
  }
  const targetDir = await claudeProjectDir(input.cwd, { configDir: input.toConfigDir });
  await mkdir(targetDir, { recursive: true });
  const target = join(targetDir, `${input.sessionId}.jsonl`);
  await copyFile(source, target);
  return { status: "copied", path: target };
}
```

- [ ] **Step 4: Run the test and confirm it passes.** Same command. Expected: PASS, 3 tests.

- [ ] **Step 5: Checkpoint.** Run typecheck, lint and format on the new files.

---

### Task 4: Provider launch info

**Files:**

- Modify: `packages/server/src/server/agent/provider-snapshot-manager.ts`
- Test: `packages/server/src/server/agent/provider-snapshot-manager.test.ts` (existing file; add a test)

**Interfaces:**

- Produces: `ProviderSnapshotManager.getProviderLaunchInfo(providerId: string): ProviderLaunchInfo | null`, where:

  ```ts
  interface ProviderLaunchInfo {
    providerId: string;
    family: string;
    label: string;
    enabled: boolean;
    env: Record<string, string>;
  }
  ```

  `family` is `derivedFromProviderId ?? providerId`.

- [ ] **Step 1: Write the failing test.** Open `provider-snapshot-manager.test.ts` and find how an existing test constructs a `ProviderSnapshotManager` with provider overrides. Search the file for `new ProviderSnapshotManager(`; reuse that setup, a `claude` provider plus an override. Add:

```ts
test("getProviderLaunchInfo resolves a derived provider's family and env", async () => {
  const manager = createManagerWithOverrides({
    "claude-work": {
      extends: "claude",
      label: "Claude (work)",
      env: { CLAUDE_CONFIG_DIR: "/home/me/.claude-work" },
    },
  });
  expect(manager.getProviderLaunchInfo("claude-work")).toEqual({
    providerId: "claude-work",
    family: "claude",
    label: "Claude (work)",
    enabled: true,
    env: { CLAUDE_CONFIG_DIR: "/home/me/.claude-work" },
  });
  expect(manager.getProviderLaunchInfo("claude")?.family).toBe("claude");
  expect(manager.getProviderLaunchInfo("missing")).toBeNull();
});
```

`createManagerWithOverrides` is a local helper. Write it from the file's existing construction code, passing the overrides map where the existing tests pass provider config.

- [ ] **Step 2: Run the test and confirm it fails.**

Run: `cd packages/server && npx vitest run src/server/agent/provider-snapshot-manager.test.ts -t getProviderLaunchInfo --bail=1`
Expected: FAIL, `getProviderLaunchInfo is not a function`.

- [ ] **Step 3: Implement the getter.** In `provider-snapshot-manager.ts`, next to `getProviderLabel`, add:

```ts
export interface ProviderLaunchInfo {
  providerId: string;
  family: string;
  label: string;
  enabled: boolean;
  env: Record<string, string>;
}

  getProviderLaunchInfo(providerId: string): ProviderLaunchInfo | null {
    const definition = this.generation.definitions[providerId];
    if (!definition) return null;
    return {
      providerId,
      family: definition.derivedFromProviderId ?? providerId,
      label: this.getProviderLabel(providerId),
      enabled: definition.enabled,
      env: { ...(definition.configuration?.runtimeSettings?.env ?? {}) },
    };
  }
```

Put the interface at module level and the method inside the class. If `getProviderLabel` has a different signature, call it the way the existing callers in this file do. If `runtimeSettings.env` is typed differently, read `ProviderRuntimeSettings` in `provider-launch-config.ts` and copy only the string entries.

- [ ] **Step 4: Run the test and confirm it passes.** Same command. Expected: PASS.

- [ ] **Step 5: Checkpoint.** Run typecheck, lint and format.

---

### Task 5: Pending move context on the next prompt

**Files:**

- Modify: `packages/server/src/server/agent/agent-storage.ts` (`STORED_AGENT_SCHEMA`, around `:45-79`)
- Modify: `packages/server/src/server/agent/agent-prompt.ts` (`sendPreparedPromptToAgent`, around `:325`)
- Create: `packages/server/src/server/agent/session-move/pending-context.ts`
- Test: `packages/server/src/server/agent/session-move/pending-context.test.ts`

**Interfaces:**

- Produces:
  - stored record field `pendingMoveContext?: { text: string; title: string } | null`
  - `withPendingMoveContext(prompt: AgentPromptInput, context: { text: string; title: string }): AgentPromptInput`

- [ ] **Step 1: Write the failing test.** Create `pending-context.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { withPendingMoveContext } from "./pending-context.js";

const context = { text: "Moved from Claude (personal)…", title: "Chat history" };

describe("withPendingMoveContext", () => {
  it("puts the history before a plain text prompt", () => {
    expect(withPendingMoveContext("continue please", context)).toEqual([
      {
        type: "text",
        mimeType: "text/plain",
        contextKind: "chat_history",
        title: "Chat history",
        text: context.text,
      },
      { type: "text", text: "continue please" },
    ]);
  });

  it("puts the history before existing blocks", () => {
    const prompt = [{ type: "text" as const, text: "hi" }];
    const result = withPendingMoveContext(prompt, context);
    expect(Array.isArray(result) && result[0]).toMatchObject({ contextKind: "chat_history" });
    expect(Array.isArray(result) && result[1]).toEqual({ type: "text", text: "hi" });
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `npx vitest run src/server/agent/session-move/pending-context.test.ts --bail=1`. Expected: FAIL.

- [ ] **Step 3: Implement the helper.** Create `pending-context.ts`:

```ts
import type { AgentPromptContentBlock, AgentPromptInput } from "../agent-sdk-types.js";

export interface PendingMoveContext {
  text: string;
  title: string;
}

export function withPendingMoveContext(
  prompt: AgentPromptInput,
  context: PendingMoveContext,
): AgentPromptInput {
  const history: AgentPromptContentBlock = {
    type: "text",
    mimeType: "text/plain",
    contextKind: "chat_history",
    title: context.title,
    text: context.text,
  };
  const blocks: AgentPromptContentBlock[] =
    typeof prompt === "string" ? [{ type: "text", text: prompt }] : prompt;
  return [history, ...blocks];
}
```

- [ ] **Step 4: Run the test and confirm it passes.**

- [ ] **Step 5: Add the stored field.** In `STORED_AGENT_SCHEMA` (`agent-storage.ts`), next to `lastError`, add:

```ts
    // Fork delta (session move): history waiting for the moved agent's next prompt.
    pendingMoveContext: z.object({ text: z.string(), title: z.string() }).nullable().optional(),
```

Check `toStoredAgentRecord` and the stored-record projection in `agent-projections.ts` (`:102`, `:263`). Copy `pendingMoveContext` through unchanged from the existing record wherever those functions rebuild a record from a previous one, so a projection never drops it.

- [ ] **Step 6: Consume it in `sendPreparedPromptToAgent`.** In `agent-prompt.ts`, after the `if (params.sessionMode) { … }` block and before `return await startAgentRun(...)`, add:

```ts
const pending = (await params.agentStorage.get(params.agentId))?.pendingMoveContext;
const prompt = pending ? withPendingMoveContext(params.prompt, pending) : params.prompt;
if (pending) {
  // Cleared before the run starts: a failed start must not resend the history twice.
  await params.agentStorage.update(params.agentId, { pendingMoveContext: null });
}
```

Change the `startAgentRun(...)` call to pass `prompt` instead of `params.prompt`. Import `withPendingMoveContext` from `./session-move/pending-context.js`.

Before writing this, check the exact method name `AgentStorage` uses to patch a record by searching `agent-storage.ts` for `async update` / `async patch` / `async upsert`. Use the existing patch method. If there is only a full-record `upsert`, read the record, spread it, set `pendingMoveContext: null`, and upsert.

- [ ] **Step 7: Integration test for the prompt hook.** Append to `pending-context.test.ts` a test using `createDaemonTestContext` (`../../test-utils/daemon-test-context.js`). It must:
  1. Create a `claude` agent.
  2. Write `pendingMoveContext: { text: "HANDOFF-MARKER", title: "Chat history" }` on its stored record through `daemon.daemon.agentStorage`.
  3. Send a prompt with `client.sendAgentMessage(agentId, "hi")`, or the method `daemon-client.ts` exposes for sending a message (search for `"send_agent_message_request"`).
  4. Assert that the stored record's `pendingMoveContext` is `null`.

  Note that `daemon.daemon.agentStorage` is the exposed storage handle on the test daemon; confirm the property name in `test-utils/paseo-daemon.ts`. If `FakeAgentClient` records received prompts (search `fake-agent-client.ts` for `lastPrompt` / `prompts`), also assert that the prompt contained "HANDOFF-MARKER".

- [ ] **Step 8: Run the tests and confirm they pass.** Then run the existing prompt tests: `npx vitest run src/server/agent/agent-prompt.test.ts --bail=1`, if that file exists.

- [ ] **Step 9: Checkpoint.**

---

### Task 6: Move orchestration in the daemon

**Files:**

- Modify: `packages/server/src/server/agent/agent-manager.ts` (event type `:243`, new `notifyAgentMoved`)
- Create: `packages/server/src/server/agent/session-move/move-agent.ts`
- Test: `packages/server/src/server/agent/session-move/move-agent.e2e.test.ts`

**Interfaces:**

- Consumes:
  - Tasks 1–5
  - `cancelAgentRunCommand`, `archiveAgentCommand` (`../lifecycle-command.js`)
  - `unarchiveAgentState`, `sendPromptToAgent` (`../agent-prompt.js`)
  - `ensureAgentLoaded` (`../agent-loading.js`)
  - `createAgentCommand` (`../create-agent/create.js`)
  - `claudeConfigDir` (`../providers/claude/project-dir.js`)
- Produces:

```ts
export interface MoveAgentDeps {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  providerSnapshotManager: ProviderSnapshotManager;
  logger: Logger;
  paseoHome?: string;
  worktreesRoot?: string;
}
export interface MoveAgentInput {
  agentId: string;
  target: { provider: string; model?: string };
  continueWork: boolean;
}
export interface MoveAgentResult {
  agentId: string;
  strategy: "native" | "handoff";
  fellBackFromNative: boolean;
}
export class MoveAgentError extends Error {
  readonly code: "busy" | "unavailable" | "not_found" | "failed";
}
export async function moveAgent(
  deps: MoveAgentDeps,
  input: MoveAgentInput,
): Promise<MoveAgentResult>;
export async function moveAgentBack(
  deps: MoveAgentDeps,
  input: { agentId: string; continueWork: boolean },
): Promise<MoveAgentResult>;
```

It also produces `AgentManager.notifyAgentMoved(fromAgentId: string, toAgentId: string): void` and the `AgentManagerEvent` variant `{ type: "agent_moved"; fromAgentId: string; toAgentId: string }`.

- [ ] **Step 1: Add the event.** In `agent-manager.ts`, add `| { type: "agent_moved"; fromAgentId: string; toAgentId: string }` to `AgentManagerEvent`. Next to `notifyAgentRemoved` (`:3627`), add:

```ts
  notifyAgentMoved(fromAgentId: string, toAgentId: string): void {
    this.dispatch({ type: "agent_moved", fromAgentId, toAgentId });
  }
```

Run `npm run typecheck --workspace=@getpaseo/server`. Fix any exhaustive `switch (event.type)` over `AgentManagerEvent` that now errors by adding `case "agent_moved": break;` (or `return;`, matching the surrounding style).

- [ ] **Step 2: Write the failing e2e test.** Create `move-agent.e2e.test.ts`:

```ts
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MOVED_FROM_AGENT_ID_LABEL,
  MOVED_TO_AGENT_ID_LABEL,
} from "@getpaseo/protocol/agent-labels";
import {
  createDaemonTestContext,
  type DaemonTestContext,
} from "../../test-utils/daemon-test-context.js";
import { moveAgent, moveAgentBack } from "./move-agent.js";

describe("moveAgent", () => {
  let ctx: DaemonTestContext;
  let cwd: string;
  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "move-agent-"));
    ctx = await createDaemonTestContext();
  });
  afterEach(async () => {
    await ctx.cleanup();
    await rm(cwd, { recursive: true, force: true });
  });

  function deps() {
    const daemon = ctx.daemon.daemon;
    return {
      agentManager: daemon.agentManager,
      agentStorage: daemon.agentStorage,
      providerSnapshotManager: daemon.providerSnapshotManager,
      logger: daemon.logger,
    };
  }

  it("hands a Claude agent to Codex in the same workspace and archives the original", async () => {
    const source = await ctx.client.createAgent({
      config: { provider: "claude", cwd, modeId: "bypassPermissions" },
    });
    await ctx.daemon.daemon.agentManager.runAgent(
      source.id,
      "Reply with MOVE_SOURCE_OK. Do not use tools.",
    );

    const result = await moveAgent(deps(), {
      agentId: source.id,
      target: { provider: "codex" },
      continueWork: false,
    });

    expect(result.strategy).toBe("handoff");
    const moved = await ctx.daemon.daemon.agentStorage.get(result.agentId);
    const original = await ctx.daemon.daemon.agentStorage.get(source.id);
    expect(moved?.provider).toBe("codex");
    expect(moved?.workspaceId).toBe(original?.workspaceId);
    expect(moved?.labels[MOVED_FROM_AGENT_ID_LABEL]).toBe(source.id);
    expect(moved?.pendingMoveContext?.text).toContain("Moved from");
    expect(original?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(result.agentId);
    expect(original?.archivedAt).toBeTruthy();
  });

  it("starts the moved agent immediately when continueWork is on", async () => {
    const source = await ctx.client.createAgent({
      config: { provider: "claude", cwd, modeId: "bypassPermissions" },
    });
    await ctx.daemon.daemon.agentManager.runAgent(
      source.id,
      "Reply with MOVE_SOURCE_OK. Do not use tools.",
    );
    const result = await moveAgent(deps(), {
      agentId: source.id,
      target: { provider: "codex" },
      continueWork: true,
    });
    const moved = await ctx.daemon.daemon.agentStorage.get(result.agentId);
    expect(moved?.pendingMoveContext ?? null).toBeNull();
    const rows = await ctx.daemon.daemon.agentManager.getTimelineRows(result.agentId);
    expect(rows.some((row) => row.item.type === "user_message")).toBe(true);
  });

  it("moves back to the original agent and archives the moved one", async () => {
    const source = await ctx.client.createAgent({
      config: { provider: "claude", cwd, modeId: "bypassPermissions" },
    });
    await ctx.daemon.daemon.agentManager.runAgent(
      source.id,
      "Reply with MOVE_SOURCE_OK. Do not use tools.",
    );
    const moved = await moveAgent(deps(), {
      agentId: source.id,
      target: { provider: "codex" },
      continueWork: false,
    });

    const back = await moveAgentBack(deps(), { agentId: moved.agentId, continueWork: false });

    expect(back.agentId).toBe(source.id);
    const original = await ctx.daemon.daemon.agentStorage.get(source.id);
    const left = await ctx.daemon.daemon.agentStorage.get(moved.agentId);
    expect(original?.archivedAt ?? null).toBeNull();
    expect(left?.archivedAt).toBeTruthy();
    expect(left?.labels[MOVED_TO_AGENT_ID_LABEL]).toBe(source.id);
  });

  it("refuses an unknown target without touching the original", async () => {
    const source = await ctx.client.createAgent({
      config: { provider: "claude", cwd, modeId: "bypassPermissions" },
    });
    await expect(
      moveAgent(deps(), { agentId: source.id, target: { provider: "nope" }, continueWork: false }),
    ).rejects.toMatchObject({ code: "unavailable" });
    const original = await ctx.daemon.daemon.agentStorage.get(source.id);
    expect(original?.archivedAt ?? null).toBeNull();
  });
});
```

Before running it, confirm the test-daemon property names: `agentStorage`, `providerSnapshotManager` and `logger` on `ctx.daemon.daemon`, in `packages/server/src/server/test-utils/paseo-daemon.ts`. If a property is missing, expose it there; it is test-only wiring. Also confirm the import path the server uses for `@getpaseo/protocol/agent-labels` (search for `PARENT_AGENT_ID_LABEL` imports) and use the same one.

- [ ] **Step 3: Run the test and confirm it fails.** Run `npx vitest run src/server/agent/session-move/move-agent.e2e.test.ts --bail=1`. Expected: FAIL, module not found.

- [ ] **Step 4: Implement `move-agent.ts`.**

```ts
import type { Logger } from "pino";
import {
  MOVED_FROM_AGENT_ID_LABEL,
  MOVED_TO_AGENT_ID_LABEL,
  getMovedFromAgentId,
} from "@getpaseo/protocol/agent-labels";
import { ensureAgentLoaded } from "../agent-loading.js";
import type { AgentManager, ManagedAgent } from "../agent-manager.js";
import { sendPromptToAgent, unarchiveAgentState } from "../agent-prompt.js";
import type { AgentStorage } from "../agent-storage.js";
import { createAgentCommand } from "../create-agent/create.js";
import { archiveAgentCommand, cancelAgentRunCommand } from "../lifecycle-command.js";
import type { ProviderLaunchInfo, ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import { claudeConfigDir } from "../providers/claude/project-dir.js";
import { copyClaudeTranscript } from "./claude-transcript.js";
import { buildMoveHandoffAttachment } from "./handoff-context.js";

const CONTINUE_PROMPT = "Continue where the previous agent stopped.";

export class MoveAgentError extends Error {
  constructor(
    readonly code: "busy" | "unavailable" | "not_found" | "failed",
    message: string,
  ) {
    super(message);
    this.name = "MoveAgentError";
  }
}

export interface MoveAgentDeps {
  agentManager: AgentManager;
  agentStorage: AgentStorage;
  providerSnapshotManager: ProviderSnapshotManager;
  logger: Logger;
  paseoHome?: string;
  worktreesRoot?: string;
}

export interface MoveAgentInput {
  agentId: string;
  target: { provider: string; model?: string };
  continueWork: boolean;
}

export interface MoveAgentResult {
  agentId: string;
  strategy: "native" | "handoff";
  fellBackFromNative: boolean;
}

function requireTarget(deps: MoveAgentDeps, provider: string): ProviderLaunchInfo {
  const info = deps.providerSnapshotManager.getProviderLaunchInfo(provider);
  if (!info || !info.enabled) {
    throw new MoveAgentError("unavailable", `Provider ${provider} is not available`);
  }
  return info;
}

async function settle(deps: MoveAgentDeps, agentId: string): Promise<ManagedAgent> {
  const agent = await ensureAgentLoaded(agentId, {
    agentManager: deps.agentManager,
    agentStorage: deps.agentStorage,
    logger: deps.logger,
  });
  const cancel = await cancelAgentRunCommand(
    { agentManager: deps.agentManager, logger: deps.logger },
    agentId,
  );
  if ("status" in cancel && cancel.status === "refused") {
    throw new MoveAgentError("busy", "Agent is busy; stop it first");
  }
  return agent;
}

function launchEnv(deps: MoveAgentDeps, agent: ManagedAgent): NodeJS.ProcessEnv {
  const info = deps.providerSnapshotManager.getProviderLaunchInfo(agent.provider);
  return { ...process.env, ...(info?.env ?? {}), ...(agent.launchEnv ?? {}) };
}

/** Same CLI family with a resumable session id: the target can resume the exact session. */
async function tryNativeMove(
  deps: MoveAgentDeps,
  source: ManagedAgent,
  target: ProviderLaunchInfo,
): Promise<ManagedAgent | null> {
  const sourceFamily = deps.providerSnapshotManager.getProviderLaunchInfo(source.provider)?.family;
  const sessionId = source.persistence?.sessionId;
  if (sourceFamily !== "claude" || target.family !== "claude" || !sessionId) return null;
  const copied = await copyClaudeTranscript({
    cwd: source.cwd,
    sessionId,
    fromConfigDir: claudeConfigDir(launchEnv(deps, source)),
    toConfigDir: claudeConfigDir({ ...process.env, ...target.env }),
  });
  if (copied.status === "missing") return null;
  const resumed = await deps.agentManager.resumeAgentFromPersistence(
    { ...source.persistence!, provider: target.providerId },
    undefined,
    undefined,
    {
      labels: { ...source.labels, [MOVED_FROM_AGENT_ID_LABEL]: source.id },
      workspaceId: source.workspaceId,
    },
  );
  await deps.agentManager.hydrateTimelineFromProvider(resumed.id);
  return resumed;
}

async function handoffMove(
  deps: MoveAgentDeps,
  source: ManagedAgent,
  target: ProviderLaunchInfo,
  model: string | undefined,
  continueWork: boolean,
  sinceSeq: number | undefined,
): Promise<ManagedAgent> {
  if (!source.workspaceId) {
    throw new MoveAgentError("failed", "Agent has no workspace to move within");
  }
  const rows = await deps.agentManager.getTimelineRows(source.id);
  const fromLabel =
    deps.providerSnapshotManager.getProviderLaunchInfo(source.provider)?.label ?? source.provider;
  const attachment = buildMoveHandoffAttachment({
    rows,
    fromLabel,
    agentTitle: source.config.title ?? null,
    cwd: source.cwd,
    sinceSeq,
  });
  if (attachment.type !== "text")
    throw new MoveAgentError("failed", "Handoff context was not text");
  const { snapshot } = await createAgentCommand(
    {
      agentManager: deps.agentManager,
      agentStorage: deps.agentStorage,
      logger: deps.logger,
      paseoHome: deps.paseoHome,
      worktreesRoot: deps.worktreesRoot,
      providerSnapshotManager: deps.providerSnapshotManager,
    },
    {
      kind: "session",
      config: {
        provider: target.providerId,
        cwd: source.cwd,
        ...(model ? { model } : {}),
        ...(source.config.title ? { title: source.config.title } : {}),
      },
      workspaceId: source.workspaceId,
      ...(continueWork ? { initialPrompt: CONTINUE_PROMPT, attachments: [attachment] } : {}),
      labels: { [MOVED_FROM_AGENT_ID_LABEL]: source.id },
      provisionalTitle: source.config.title ?? null,
      firstAgentContext: continueWork
        ? { prompt: CONTINUE_PROMPT, attachments: [attachment] }
        : { attachments: [] },
    },
  );
  if (!continueWork) {
    await deps.agentStorage.update(snapshot.id, {
      pendingMoveContext: { text: attachment.text, title: attachment.title ?? "Chat history" },
    });
  }
  return snapshot;
}

async function finish(deps: MoveAgentDeps, source: ManagedAgent, moved: ManagedAgent) {
  await deps.agentManager.setLabels(source.id, { [MOVED_TO_AGENT_ID_LABEL]: moved.id });
  await archiveAgentCommand(
    { agentManager: deps.agentManager, agentStorage: deps.agentStorage, logger: deps.logger },
    source.id,
  );
  deps.agentManager.notifyAgentMoved(source.id, moved.id);
}

async function rollback(deps: MoveAgentDeps, moved: ManagedAgent | null) {
  if (!moved) return;
  await deps.agentManager.closeAgent(moved.id).catch(() => {});
  await deps.agentManager.deleteAgentState(moved.id).catch(() => {});
  await deps.agentStorage.delete(moved.id).catch(() => {});
  deps.agentManager.notifyAgentRemoved({
    id: moved.id,
    workspaceId: moved.workspaceId,
    internal: false,
  });
}

async function performMove(
  deps: MoveAgentDeps,
  source: ManagedAgent,
  target: ProviderLaunchInfo,
  options: { model?: string; continueWork: boolean; sinceSeq?: number },
): Promise<MoveAgentResult> {
  let moved: ManagedAgent | null = null;
  try {
    moved = await tryNativeMove(deps, source, target);
    const native = moved !== null;
    const sourceFamily = deps.providerSnapshotManager.getProviderLaunchInfo(
      source.provider,
    )?.family;
    const fellBackFromNative = !native && sourceFamily === target.family;
    if (!moved) {
      moved = await handoffMove(
        deps,
        source,
        target,
        options.model,
        options.continueWork,
        options.sinceSeq,
      );
    } else if (options.continueWork) {
      await sendPromptToAgent({
        agentManager: deps.agentManager,
        agentStorage: deps.agentStorage,
        logger: deps.logger,
        agentId: moved.id,
        prompt: CONTINUE_PROMPT,
      });
    }
    await finish(deps, source, moved);
    return { agentId: moved.id, strategy: native ? "native" : "handoff", fellBackFromNative };
  } catch (error) {
    await rollback(deps, moved);
    if (error instanceof MoveAgentError) throw error;
    throw new MoveAgentError("failed", error instanceof Error ? error.message : String(error));
  }
}

export async function moveAgent(
  deps: MoveAgentDeps,
  input: MoveAgentInput,
): Promise<MoveAgentResult> {
  const target = requireTarget(deps, input.target.provider);
  if (!deps.agentManager.getAgent(input.agentId) && !(await deps.agentStorage.get(input.agentId))) {
    throw new MoveAgentError("not_found", `Agent not found: ${input.agentId}`);
  }
  const source = await settle(deps, input.agentId);
  return performMove(deps, source, target, {
    model: input.target.model,
    continueWork: input.continueWork,
  });
}

export async function moveAgentBack(
  deps: MoveAgentDeps,
  input: { agentId: string; continueWork: boolean },
): Promise<MoveAgentResult> {
  const current = await settle(deps, input.agentId);
  const originalId = getMovedFromAgentId(current.labels);
  if (!originalId)
    throw new MoveAgentError("not_found", "This agent was not moved from another agent");
  const record = await deps.agentStorage.get(originalId);
  if (!record) throw new MoveAgentError("not_found", `Original agent not found: ${originalId}`);
  await unarchiveAgentState(deps.agentStorage, deps.agentManager, originalId);
  const original = await ensureAgentLoaded(originalId, {
    agentManager: deps.agentManager,
    agentStorage: deps.agentStorage,
    logger: deps.logger,
  });
  const target = requireTarget(deps, original.provider);
  const currentFamily = deps.providerSnapshotManager.getProviderLaunchInfo(
    current.provider,
  )?.family;
  // Same family: the session file the current agent wrote holds everything, so copy it back.
  if (currentFamily === "claude" && target.family === "claude" && current.persistence?.sessionId) {
    await copyClaudeTranscript({
      cwd: current.cwd,
      sessionId: current.persistence.sessionId,
      fromConfigDir: claudeConfigDir(launchEnv(deps, current)),
      toConfigDir: claudeConfigDir(launchEnv(deps, original)),
    });
    await deps.agentManager.reloadAgentSession(originalId);
  } else {
    const rows = await deps.agentManager.getTimelineRows(current.id);
    const attachment = buildMoveHandoffAttachment({
      rows,
      fromLabel:
        deps.providerSnapshotManager.getProviderLaunchInfo(current.provider)?.label ??
        current.provider,
      agentTitle: current.config.title ?? null,
      cwd: current.cwd,
    });
    if (attachment.type === "text") {
      await deps.agentStorage.update(originalId, {
        pendingMoveContext: { text: attachment.text, title: attachment.title ?? "Chat history" },
      });
    }
  }
  if (input.continueWork) {
    await sendPromptToAgent({
      agentManager: deps.agentManager,
      agentStorage: deps.agentStorage,
      logger: deps.logger,
      agentId: originalId,
      prompt: CONTINUE_PROMPT,
    });
  }
  await finish(deps, current, original);
  return { agentId: originalId, strategy: "native", fellBackFromNative: false };
}
```

Wire-up notes to resolve while implementing, each against the real code:

- `sendPromptToAgent` parameters: read `SendPromptToAgentParams` in `agent-prompt.ts` and fill in every required field. `source` is required by `sendPromptToAgent`; pass the value the MCP `send_agent_prompt` tool passes in `paseo-tools.ts`.
- `reloadAgentSession`: confirm the public name of the reload entry point. Search `agent-manager.ts` for `reloadAgentSession` (the internal is `reloadAgentSessionInternal`). If it is private, find the public wrapper that `session.ts` calls for "reload agent", and call that.
- `agentStorage.update` / `agentStorage.delete`: use the method names confirmed in Task 5, Step 6.
- In move back, the moved agent's whole timeline is the delta since the move, so no `sinceSeq` is needed there. `sinceSeq` in `buildMoveHandoffAttachment` stays for callers that pass a shared timeline.
- `resumeAgentFromPersistence` with `agentId` `undefined`: confirm it allocates a new id. If it requires one, pass `randomUUID()` from `node:crypto`.

- [ ] **Step 5: Run the e2e tests until they pass.** Run `npx vitest run src/server/agent/session-move/move-agent.e2e.test.ts --bail=1`. Expected: PASS, 4 tests.

- [ ] **Step 6: Native-path test.** Add a test that configures a derived provider through `createDaemonTestContext({ providerOverrides: { "claude-work": { extends: "claude", label: "Claude (work)", env: { CLAUDE_CONFIG_DIR: join(cwd, ".claude-work") } } } })`. Confirm the option name in `TestPaseoDaemonOptions`. The test then:
  1. Creates a `claude` agent with `env: { CLAUDE_CONFIG_DIR: join(cwd, ".claude") }`.
  2. Writes a fake transcript at `claudeProjectDir(cwd, { configDir: join(cwd, ".claude") })/<sessionId>.jsonl`, with the session id read from `agentManager.getAgent(id).persistence.sessionId`.
  3. Moves the agent to `claude-work`.
  4. Expects `strategy: "native"` and the transcript to exist under `.claude-work`.

  If the fake client gives the agent no `persistence.sessionId`, assert `strategy: "handoff"` with `fellBackFromNative: true` instead. Document that in a comment; it still covers the fallback branch.

- [ ] **Step 7: Checkpoint.** Run typecheck, lint and format on `session-move/` and `agent-manager.ts`.

---

### Task 7: Limit state on agents

**Files:**

- Modify: `packages/server/src/server/agent/agent-manager.ts` (`ManagedAgentBase` `:418`; turn_failed handler `:4957`)
- Modify: `packages/server/src/server/agent/agent-storage.ts`, `agent-projections.ts`
- Modify: `packages/protocol/src/messages.ts` (`AgentSnapshotPayloadSchema` `:863`)
- Test: `packages/server/src/server/agent/session-move/limit-state.e2e.test.ts`

**Interfaces:**

- Consumes: `isUsageLimitError` (Task 1).
- Produces:
  - `ManagedAgent.limitReached?: { at: string; message: string } | null`
  - the stored record field of the same name
  - the wire field `limitReached?: { at: string; message: string }` on the agent snapshot payload

- [ ] **Step 1: Write the failing test.** Create `limit-state.e2e.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemonTestContext } from "../../test-utils/daemon-test-context.js";
import { createTestAgentClients } from "../../test-utils/fake-agent-client.js";

describe("limitReached", () => {
  it("is set when a turn fails with a usage-limit error and cleared on the next successful turn", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "limit-state-"));
    const ctx = await createDaemonTestContext({
      agentClients: createTestAgentClients({
        failureMessage: "Claude AI usage limit reached|1762300800",
      }),
    });
    try {
      const agent = await ctx.client.createAgent({
        config: { provider: "claude", cwd, modeId: "bypassPermissions" },
      });
      await ctx.daemon.daemon.agentManager
        .runAgent(agent.id, "emit a turn failure")
        .catch(() => {});
      await vi.waitFor(() => {
        expect(ctx.daemon.daemon.agentManager.getAgent(agent.id)?.limitReached?.message).toContain(
          "usage limit",
        );
      });
      await ctx.daemon.daemon.agentManager.runAgent(agent.id, "Reply with OK. Do not use tools.");
      expect(ctx.daemon.daemon.agentManager.getAgent(agent.id)?.limitReached ?? null).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });
});
```

The fake client's failure text is fixed at `"Requested fake provider failure"` (`fake-agent-client.ts:768`). Add an optional `failureMessage` to the options `createTestAgentClients` accepts and use it at that line, defaulting to the current string. This is test-only.

- [ ] **Step 2: Run the test and confirm it fails.**

- [ ] **Step 3: Implement.**
  - In `ManagedAgentBase`, add `limitReached?: { at: string; message: string } | null;`.
  - In the turn_failed handler, next to `agent.lastError = event.error;`, add:

```ts
// Fork delta (session move): offer a move when the provider's quota ran out.
agent.limitReached = isUsageLimitError(event.error)
  ? { at: new Date().toISOString(), message: event.error }
  : (agent.limitReached ?? null);
```

- Where a turn completes successfully (the `turn_completed` handling in the same event switch), set `agent.limitReached = null;`.
- Storage: add `limitReached: z.object({ at: z.string(), message: z.string() }).nullable().optional(),` to `STORED_AGENT_SCHEMA`.
- Projections: in `toStoredAgentRecord`, add `limitReached: agent.limitReached ?? undefined`. In `toAgentPayload`, add `if (agent.limitReached) payload.limitReached = agent.limitReached;`.
- Protocol: in `AgentSnapshotPayloadSchema`, add `limitReached: z.object({ at: z.string(), message: z.string() }).optional(),`.

- [ ] **Step 4: Rebuild and run.** Run `npm run build:client`, then run the test. Expected: PASS.

- [ ] **Step 5: Checkpoint.**

---

### Task 8: Protocol, session handlers and move targets

**Files:**

- Modify: `packages/protocol/src/messages.ts`
- Modify: `packages/server/src/server/plugins/usage-sources/index.ts`
- Modify: `packages/server/src/server/session.ts`
- Modify: `packages/server/src/server/authorization/operation-permissions.ts`
- Modify: `packages/server/src/server/websocket-server.ts` (`:2002`)
- Create: `packages/server/src/server/agent/session-move/move-targets.ts`
- Test: `packages/server/src/server/agent/session-move/move-targets.test.ts`, `packages/server/src/server/session.agent-move.e2e.test.ts`

**Interfaces:**

- Produces these wire messages:
  - `agent.move.request { requestId, agentId, target: { provider, model? }, continueWork }` → `agent.move.response { payload: { requestId, ok, agentId: string | null, strategy: "native" | "handoff" | null, fellBackFromNative: boolean, error: string | null } }`
  - `agent.move_back.request { requestId, agentId, continueWork }` → `agent.move_back.response` with the same payload
  - `agent.move.targets.request { requestId, agentId }` → `agent.move.targets.response { payload: { requestId, targets: MoveTarget[] } }`, where:

    ```ts
    MoveTarget = {
      provider: string;
      label: string;
      family: string;
      available: boolean;
      current: boolean;
      usedPct: number | null;
      resetsAt: string | null;
    }
    ```

  - the event `agent_moved { payload: { fromAgentId, toAgentId } }`
  - `server_info.features.agentMove?: boolean`

- Also produces `UsageSourceRegistry.listReportsForScope(scope: { provider: string; env: Record<string, string> }): Promise<UsageReportEntry[]>`.

- [ ] **Step 1: Add the registry scope lookup (TDD).** In `packages/server/src/server/plugins/usage-sources/index.test.ts`, add:

```ts
test("listReportsForScope reports usage for a provider/env without a live agent", async () => {
  const registry = new UsageSourceRegistry();
  registry.register(
    source({
      id: "claude",
      discover: async (scope) =>
        scope.kind === "session" &&
        (scope as { env: Record<string, string> }).env.CLAUDE_CONFIG_DIR === "/w"
          ? [{ key: "work", label: "work@example.test", input: { dir: "/w" } }]
          : [],
      fetch: async () => ({
        status: "available",
        windows: [{ id: "five_hour", label: "Session", usedPct: 100 }],
      }),
    }),
  );
  const [entry] = await registry.listReportsForScope({
    provider: "claude",
    env: { CLAUDE_CONFIG_DIR: "/w" },
  });
  expect(entry?.account.label).toBe("work@example.test");
  expect(entry?.report.status).toBe("available");
});
```

The `source()` helper's `discover` currently takes no argument. Widen its type to `(scope?: unknown) => Promise<…>` in the test helper. Then implement in `UsageSourceRegistry`:

```ts
  /** Usage for a launch scope that has no agent yet, e.g. a session-move target. */
  async listReportsForScope(scope: { provider: string; env: Record<string, string> }): Promise<UsageReportEntry[]> {
    const reports = await this.discover({ kind: "session", provider: scope.provider, env: scope.env });
    return Promise.all([...reports].map(([id, known]) => this.fetchId(id, known, false)));
  }
```

If `UsageScope`'s session variant requires more fields (for example `model`), pass `model: undefined` or the minimum the schema accepts.

- [ ] **Step 2: Write the move-targets builder (TDD).** Create `move-targets.ts`:

```ts
import type { ProviderLaunchInfo } from "../provider-snapshot-manager.js";

export interface MoveTarget {
  provider: string;
  label: string;
  family: string;
  available: boolean;
  current: boolean;
  usedPct: number | null;
  resetsAt: string | null;
}

export interface UsageWindowLike {
  usedPct?: number | null;
  resetsAt?: string | null;
}

/** The tightest window decides whether a target has room. */
export function toMoveTarget(input: {
  info: ProviderLaunchInfo;
  currentProvider: string;
  windows: readonly UsageWindowLike[] | null;
}): MoveTarget {
  let usedPct: number | null = null;
  let resetsAt: string | null = null;
  for (const window of input.windows ?? []) {
    if (typeof window.usedPct === "number" && (usedPct === null || window.usedPct > usedPct)) {
      usedPct = window.usedPct;
      resetsAt = window.resetsAt ?? null;
    }
  }
  return {
    provider: input.info.providerId,
    label: input.info.label,
    family: input.info.family,
    available: input.info.enabled,
    current: input.info.providerId === input.currentProvider,
    usedPct,
    resetsAt,
  };
}
```

Test it in `move-targets.test.ts`:

```ts
import { expect, test } from "vitest";
import { toMoveTarget } from "./move-targets.js";

const info = {
  providerId: "claude-work",
  family: "claude",
  label: "Claude (work)",
  enabled: true,
  env: {},
};

test("uses the tightest usage window", () => {
  expect(
    toMoveTarget({
      info,
      currentProvider: "claude",
      windows: [
        { usedPct: 40, resetsAt: "2026-11-05T10:00:00Z" },
        { usedPct: 100, resetsAt: "2026-11-05T14:00:00Z" },
      ],
    }),
  ).toEqual({
    provider: "claude-work",
    label: "Claude (work)",
    family: "claude",
    available: true,
    current: false,
    usedPct: 100,
    resetsAt: "2026-11-05T14:00:00Z",
  });
});

test("reports unknown usage as null", () => {
  expect(toMoveTarget({ info, currentProvider: "claude-work", windows: null })).toMatchObject({
    current: true,
    usedPct: null,
  });
});
```

- [ ] **Step 3: Add the protocol schemas.** In `messages.ts`, next to the `agent.rewind` schemas (`:2094`), add:

```ts
const AgentMoveResultPayloadSchema = z.object({
  requestId: z.string(),
  ok: z.boolean(),
  agentId: z.string().nullable(),
  strategy: z.enum(["native", "handoff"]).nullable(),
  fellBackFromNative: z.boolean(),
  error: z.string().nullable(),
});

export const AgentMoveRequestMessageSchema = z.object({
  type: z.literal("agent.move.request"),
  requestId: z.string(),
  agentId: z.string(),
  target: z.object({ provider: z.string(), model: z.string().optional() }),
  continueWork: z.boolean(),
});
export const AgentMoveResponseMessageSchema = z.object({
  type: z.literal("agent.move.response"),
  payload: AgentMoveResultPayloadSchema,
});

export const AgentMoveBackRequestMessageSchema = z.object({
  type: z.literal("agent.move_back.request"),
  requestId: z.string(),
  agentId: z.string(),
  continueWork: z.boolean(),
});
export const AgentMoveBackResponseMessageSchema = z.object({
  type: z.literal("agent.move_back.response"),
  payload: AgentMoveResultPayloadSchema,
});

export const AgentMoveTargetSchema = z.object({
  provider: z.string(),
  label: z.string(),
  family: z.string(),
  available: z.boolean(),
  current: z.boolean(),
  usedPct: z.number().nullable(),
  resetsAt: z.string().nullable(),
});
export const AgentMoveTargetsRequestMessageSchema = z.object({
  type: z.literal("agent.move.targets.request"),
  requestId: z.string(),
  agentId: z.string(),
});
export const AgentMoveTargetsResponseMessageSchema = z.object({
  type: z.literal("agent.move.targets.response"),
  payload: z.object({ requestId: z.string(), targets: z.array(AgentMoveTargetSchema) }),
});

export const AgentMovedMessageSchema = z.object({
  type: z.literal("agent_moved"),
  payload: z.object({ fromAgentId: z.string(), toAgentId: z.string() }),
});
```

Then wire them in:

- Add the three requests to `SessionInboundMessageSchema`, after the rewind entry at `:3386`.
- Add the three responses and `AgentMovedMessageSchema` to `SessionOutboundMessageSchema`, after the rewind entry at `:7132`.
- Add `"agent_moved"` to `SessionEventSubscriptionSchema` (`:3222`).
- Add type exports, following the pattern at `:7336`.
- In the `features` object (`:3664`), add:

```ts
        // Fork delta (session move): agent.move / agent.move_back / agent.move.targets.
        agentMove: z.boolean().optional(),
```

- [ ] **Step 4: Permissions.** In `operation-permissions.ts`, set the inbound permissions `"agent.move.request": "workspace.write"`, `"agent.move_back.request": "workspace.write"` and `"agent.move.targets.request": "workspace.read"`. If `workspace.read` is not a permission name there, use the one `fetch_agents` uses. Add the matching outbound entries for the three responses and `agent_moved`, mirroring how `agent.rewind.response` and `agent_archived` are listed.

- [ ] **Step 5: Session handlers.** In `session.ts`, add `?? this.dispatchAgentMoveMessage(msg, source)` to the dispatch chain at `:2463`. Then add:

```ts
  private dispatchAgentMoveMessage(msg: SessionInboundMessage, source?: object): Promise<void> | undefined {
    switch (msg.type) {
      case "agent.move.request":
        return this.handleAgentMoveRequest(msg, source);
      case "agent.move_back.request":
        return this.handleAgentMoveBackRequest(msg, source);
      case "agent.move.targets.request":
        return this.handleAgentMoveTargetsRequest(msg, source);
      default:
        return undefined;
    }
  }

  private moveDeps(): MoveAgentDeps {
    return {
      agentManager: this.agentManager,
      agentStorage: this.agentStorage,
      providerSnapshotManager: this.providerSnapshotManager,
      logger: this.sessionLogger,
      paseoHome: this.paseoHome,
      worktreesRoot: this.worktreesRoot,
    };
  }

  private async handleAgentMoveRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.move.request" }>,
    source?: object,
  ): Promise<void> {
    const payload = await runMove(() =>
      moveAgent(this.moveDeps(), { agentId: msg.agentId, target: msg.target, continueWork: msg.continueWork }),
    );
    this.emitForSource({ type: "agent.move.response", payload: { requestId: msg.requestId, ...payload } }, source);
  }

  private async handleAgentMoveBackRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.move_back.request" }>,
    source?: object,
  ): Promise<void> {
    const payload = await runMove(() =>
      moveAgentBack(this.moveDeps(), { agentId: msg.agentId, continueWork: msg.continueWork }),
    );
    this.emitForSource({ type: "agent.move_back.response", payload: { requestId: msg.requestId, ...payload } }, source);
  }

  private async handleAgentMoveTargetsRequest(
    msg: Extract<SessionInboundMessage, { type: "agent.move.targets.request" }>,
    source?: object,
  ): Promise<void> {
    const agent = this.agentManager.getAgent(msg.agentId) ?? (await this.agentStorage.get(msg.agentId));
    const currentProvider = agent?.provider ?? "";
    const targets = await Promise.all(
      this.providerSnapshotManager.listRegisteredProviderIds().map(async (providerId) => {
        const info = this.providerSnapshotManager.getProviderLaunchInfo(providerId)!;
        const reports = this.usageSources
          ? await this.usageSources.listReportsForScope({ provider: info.family, env: info.env }).catch(() => [])
          : [];
        const windows = reports.flatMap((entry) => (entry.report.status === "available" ? entry.report.windows : []));
        return toMoveTarget({ info, currentProvider, windows: reports.length > 0 ? windows : null });
      }),
    );
    this.emitForSource(
      { type: "agent.move.targets.response", payload: { requestId: msg.requestId, targets } },
      source,
    );
  }
```

At module level in `session.ts`, or in `session-move/move-agent.ts` exported as `runMove`, add:

```ts
async function runMove(action: () => Promise<MoveAgentResult>) {
  try {
    const result = await action();
    return {
      ok: true,
      agentId: result.agentId,
      strategy: result.strategy,
      fellBackFromNative: result.fellBackFromNative,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      agentId: null,
      strategy: null,
      fellBackFromNative: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
```

`this.usageSources` is the name assumed for the session's handle to the `UsageSourceRegistry`. Find how the session serves `usage.list_reports.request` and use that same reference. `listRegisteredProviderIds` returns the registered ids; confirm its exact return type. Agents run the provider's family CLI with the profile env, so usage is looked up with `provider: info.family`. Pass the family, because that is how `usageSession()` reports Claude profiles.

- [ ] **Step 6: Forward the event.** In the session's agent-manager subscriber (`session.ts:1989`), add before the `agent_state` branch:

```ts
if (event.type === "agent_moved") {
  this.emit({
    type: "agent_moved",
    payload: { fromAgentId: event.fromAgentId, toAgentId: event.toAgentId },
  });
  return;
}
```

Add `agent_moved` to `sessionEventCategory()` (`session.ts:8811`) in the same category as `agent_archived`.

- [ ] **Step 7: Feature flag.** In `websocket-server.ts` `buildServerInfoStatusPayload` (`:2002`), add `agentMove: true,` to `features`.

- [ ] **Step 8: Session e2e test.** Create `packages/server/src/server/session.agent-move.e2e.test.ts`. It uses `createDaemonTestContext` and the raw client request helper. Until Task 9 adds the client methods, use `ctx.client` through `sendCorrelatedSessionRequest`, if it is public; if not, write this test after Task 9 using `ctx.client.moveAgent`. The test must check that:
  - Creating a `claude` agent, running one turn, then sending `agent.move.request` to `codex` returns `ok: true` and a new agent id.
  - The client receives an `agent_moved` event with matching ids. Register `ctx.client.on("agent_moved", …)` before sending.
  - `agent.move.targets.request` returns a target list containing `claude` (`current: true`) and `codex` (`current: false`).

- [ ] **Step 9: Regenerate, build and run.** Run `npm run generate:validators --workspace=@getpaseo/protocol`, then `npm run build:client`. Then run the three test files from this task. Expected: all PASS.

- [ ] **Step 10: Checkpoint.** Run typecheck across all workspaces with `npm run typecheck`, which catches app/client fallout from the protocol changes. Then run lint and format.

---

### Task 9: Client, CLI and MCP

**Files:**

- Modify: `packages/client/src/daemon-client.ts`
- Create: `packages/cli/src/commands/agent/move.ts`
- Modify: `packages/cli/src/commands/agent/index.ts`
- Modify: `packages/server/src/server/agent/tools/paseo-tools.ts`
- Test: extend `session.agent-move.e2e.test.ts` (client); `packages/server/src/server/agent/session-move/move-agent.mcp.e2e.test.ts` (MCP)

**Interfaces:**

- Produces:
  - `DaemonClient.moveAgent(agentId: string, target: { provider: string; model?: string }, options: { continueWork: boolean }): Promise<{ agentId: string; strategy: "native" | "handoff"; fellBackFromNative: boolean }>`
  - `DaemonClient.moveAgentBack(agentId: string, options: { continueWork: boolean }): Promise<same>`
  - `DaemonClient.listMoveTargets(agentId: string): Promise<MoveTarget[]>`
  - MCP tool `move_agent`
  - CLI `paseo agent move` / `paseo agent move-back`

- [ ] **Step 1: Client methods.** In `daemon-client.ts`, next to `rewindAgent` (`:3926`), add:

```ts
  async moveAgent(
    agentId: string,
    target: { provider: string; model?: string },
    options: { continueWork: boolean },
  ): Promise<{ agentId: string; strategy: "native" | "handoff"; fellBackFromNative: boolean }> {
    const requestId = this.createRequestId();
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "agent.move.request", requestId, agentId, target, continueWork: options.continueWork },
      responseType: "agent.move.response",
      timeout: 120_000,
    });
    return unwrapMoveResult(payload, "Agent move failed");
  }

  async moveAgentBack(
    agentId: string,
    options: { continueWork: boolean },
  ): Promise<{ agentId: string; strategy: "native" | "handoff"; fellBackFromNative: boolean }> {
    const requestId = this.createRequestId();
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "agent.move_back.request", requestId, agentId, continueWork: options.continueWork },
      responseType: "agent.move_back.response",
      timeout: 120_000,
    });
    return unwrapMoveResult(payload, "Agent move back failed");
  }

  async listMoveTargets(agentId: string): Promise<AgentMoveTarget[]> {
    const requestId = this.createRequestId();
    const payload = await this.sendCorrelatedSessionRequest({
      requestId,
      message: { type: "agent.move.targets.request", requestId, agentId },
      responseType: "agent.move.targets.response",
    });
    return payload.targets;
  }
```

At module level:

```ts
function unwrapMoveResult(
  payload: {
    ok: boolean;
    agentId: string | null;
    strategy: "native" | "handoff" | null;
    fellBackFromNative: boolean;
    error: string | null;
  },
  fallback: string,
) {
  if (!payload.ok || !payload.agentId || !payload.strategy)
    throw new Error(payload.error ?? fallback);
  return {
    agentId: payload.agentId,
    strategy: payload.strategy,
    fellBackFromNative: payload.fellBackFromNative,
  };
}
```

Import `AgentMoveTarget` as `z.infer<typeof AgentMoveTargetSchema>`; export that type from `messages.ts` in Task 8, Step 3 if it isn't there yet. If `sendCorrelatedSessionRequest` has no `timeout` parameter, drop it.

- [ ] **Step 2: Client test.** In `session.agent-move.e2e.test.ts`, switch to `ctx.client.moveAgent(...)`, `moveAgentBack` and `listMoveTargets`, and assert the same results as in Task 8, Step 8. Run the file. Expected: PASS.

- [ ] **Step 3: MCP tool.** In `paseo-tools.ts`, next to `archive_agent` (`:2215`), add:

```ts
registerTool(
  "move_agent",
  {
    title: "Move agent",
    description:
      "Move an agent to another provider or account (e.g. when its quota is exhausted) without calling its model. " +
      "The original is archived and linked. Set back=true to move a moved agent back to its original.",
    inputSchema: {
      agentId: z.string(),
      provider: z.string().optional(),
      model: z.string().optional(),
      back: z.boolean().optional(),
      continueWork: z.boolean().optional(),
    },
    outputSchema: {
      agentId: z.string(),
      strategy: z.enum(["native", "handoff"]),
      fellBackFromNative: z.boolean(),
    },
  },
  async ({ agentId, provider, model, back, continueWork }) => {
    const deps = { agentManager, agentStorage, providerSnapshotManager, logger: childLogger };
    const result = back
      ? await moveAgentBack(deps, { agentId, continueWork: continueWork ?? true })
      : await moveAgent(deps, {
          agentId,
          target: { provider: requireProvider(provider), ...(model ? { model } : {}) },
          continueWork: continueWork ?? true,
        });
    return { content: [], structuredContent: ensureValidJson(result) };
  },
);
```

At module level:

```ts
function requireProvider(provider: string | undefined): string {
  if (!provider) throw new Error("provider is required unless back=true");
  return provider;
}
```

Confirm that `providerSnapshotManager` is in scope inside `createPaseoAgentToolManifest`. If not, add it to the manifest's deps type and pass it where the manifest is built; search for `createPaseoAgentToolManifest(`.

- [ ] **Step 4: MCP test.** Create `move-agent.mcp.e2e.test.ts`, modelled on `agent/archive-discovery.e2e.test.ts:24-70` (an MCP client over `/mcp/agents`). It should:
  1. Create a `claude` agent and run one turn.
  2. Call `move_agent` with `{ agentId, provider: "codex", continueWork: false }`.
  3. Assert that `structuredContent.strategy === "handoff"` and that the original is archived.

  Run it. Expected: PASS.

- [ ] **Step 5: CLI.** Create `packages/cli/src/commands/agent/move.ts`, modelled on `archive.ts`:

```ts
import type { Command } from "commander";
import { connectToDaemon, fetchAllAgents, resolveAgentId } from "../../utils/client.js";
import type {
  CommandError,
  CommandOptions,
  OutputSchema,
  SingleResult,
} from "../../output/index.js";

interface AgentMoveResult {
  fromAgentId: string;
  agentId: string;
  strategy: string;
}

const moveSchema: OutputSchema<AgentMoveResult> = {
  idField: "agentId",
  columns: [
    { header: "FROM", field: "fromAgentId" },
    { header: "AGENT ID", field: "agentId" },
    { header: "STRATEGY", field: "strategy" },
  ],
};

export interface AgentMoveOptions extends CommandOptions {
  to?: string;
  model?: string;
  continue?: boolean;
}

export function addMoveOptions(cmd: Command): Command {
  return cmd
    .description("Move an agent to another provider or account without calling its model")
    .argument("<id>", "Agent ID, prefix, or name")
    .requiredOption("--to <provider>", "Target provider id, e.g. codex or claude-work")
    .option("--model <model>", "Target model")
    .option("--no-continue", "Wait for your next message instead of continuing automatically");
}

export function addMoveBackOptions(cmd: Command): Command {
  return cmd
    .description("Move a moved agent back to its original agent")
    .argument("<id>", "Agent ID, prefix, or name")
    .option("--no-continue", "Wait for your next message instead of continuing automatically");
}

async function resolve(client: Awaited<ReturnType<typeof connectToDaemon>>, idArg: string) {
  const agents = await fetchAllAgents(client, { filter: { includeArchived: true } });
  const agentId = resolveAgentId(idArg, agents);
  if (!agentId) {
    throw {
      code: "AGENT_NOT_FOUND",
      message: `Agent not found: ${idArg}`,
      details: 'Use "paseo ls" to list agents',
    } as CommandError;
  }
  return agentId;
}

export async function runMoveCommand(
  idArg: string,
  options: AgentMoveOptions,
): Promise<SingleResult<AgentMoveResult>> {
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    const agentId = await resolve(client, idArg);
    const result = await client.moveAgent(
      agentId,
      { provider: options.to!, ...(options.model ? { model: options.model } : {}) },
      { continueWork: options.continue !== false },
    );
    await client.close();
    return {
      type: "single",
      data: { fromAgentId: agentId, agentId: result.agentId, strategy: result.strategy },
      schema: moveSchema,
    };
  } catch (err) {
    await client.close().catch(() => {});
    if (err && typeof err === "object" && "code" in err) throw err;
    throw {
      code: "MOVE_FAILED",
      message: `Failed to move agent: ${err instanceof Error ? err.message : String(err)}`,
    } as CommandError;
  }
}

export async function runMoveBackCommand(
  idArg: string,
  options: AgentMoveOptions,
): Promise<SingleResult<AgentMoveResult>> {
  const client = await connectToDaemon({ target: options.daemonTarget });
  try {
    const agentId = await resolve(client, idArg);
    const result = await client.moveAgentBack(agentId, {
      continueWork: options.continue !== false,
    });
    await client.close();
    return {
      type: "single",
      data: { fromAgentId: agentId, agentId: result.agentId, strategy: result.strategy },
      schema: moveSchema,
    };
  } catch (err) {
    await client.close().catch(() => {});
    if (err && typeof err === "object" && "code" in err) throw err;
    throw {
      code: "MOVE_FAILED",
      message: `Failed to move agent back: ${err instanceof Error ? err.message : String(err)}`,
    } as CommandError;
  }
}
```

Copy the exact import paths and type names (`CommandOptions`, `OutputSchema`, `SingleResult`, `CommandError`, `daemonTarget`) from the top of `archive.ts`; the paths above are the expected ones. Register both in `commands/agent/index.ts`, next to archive:

```ts
import { addMoveBackOptions, addMoveOptions, runMoveBackCommand, runMoveCommand } from "./move.js";
addJsonAndDaemonHostOptions(addMoveOptions(agent.command("move"))).action(
  withOutput(runMoveCommand),
);
addJsonAndDaemonHostOptions(addMoveBackOptions(agent.command("move-back"))).action(
  withOutput(runMoveBackCommand),
);
```

- [ ] **Step 6: CLI smoke test.** Run `npm run build:server`, then `npm run cli -- agent move --help`. Expected: the usage text shows `--to <provider>`, `--model` and `--no-continue`. If `packages/cli` has a command test file such as `commands/agent/archive.test.ts`, add a matching `move.test.ts` that asserts the options parse.

- [ ] **Step 7: Checkpoint.** Run `npm run typecheck`, then lint and format.

---

### Task 10: App — move dialog, menu entry, banner, tab retarget

**Files:**

- Create: `packages/app/src/session-move/use-agent-move.ts` (requests and state)
- Create: `packages/app/src/session-move/move-dialog.tsx`
- Create: `packages/app/src/session-move/move-banner.tsx`
- Create: `packages/app/src/session-move/use-follow-moved-agents.ts` (retarget)
- Test: `packages/app/src/session-move/use-follow-moved-agents.test.ts`
- Modify: `packages/app/src/screens/workspace/workspace-tab-menu.ts` (`:8`, `:24`, `:70`, `:89`, around `:302`)
- Modify: the callers listed below that build tab-menu entries
- Modify: the app i18n English file used by `workspace.tabs.menu.*`

**Interfaces:**

- Consumes: `DaemonClient.moveAgent`, `moveAgentBack`, `listMoveTargets`; the `agent_moved` event; `serverInfo.features.agentMove`; the agent snapshot's `labels` and `limitReached`.
- Produces: a "Move session…" tab-menu item (`key: "move-agent"`), the move dialog, the banner, and an automatic tab retarget.

Before starting, read `docs/design.md`, `docs/menus.md`, `docs/unistyles.md` and `docs/hover.md`. The app has strict UI rules, for example `useUnistyles()` is forbidden.

- [ ] **Step 1: Write the failing retarget test.** The retarget logic is a pure function so it can be tested without React:

```ts
import { describe, expect, it } from "vitest";
import { resolveMovedAgentId } from "./use-follow-moved-agents.js";

describe("resolveMovedAgentId", () => {
  const agents = new Map([
    [
      "a",
      { id: "a", archivedAt: "2026-11-05T00:00:00Z", labels: { "paseo.moved-to-agent-id": "b" } },
    ],
    [
      "b",
      { id: "b", archivedAt: "2026-11-05T01:00:00Z", labels: { "paseo.moved-to-agent-id": "c" } },
    ],
    ["c", { id: "c", archivedAt: null, labels: { "paseo.moved-from-agent-id": "b" } }],
  ]);
  it("follows a chain of moves to the live agent", () => {
    expect(resolveMovedAgentId("a", (id) => agents.get(id) ?? null)).toBe("c");
  });
  it("returns null for an agent that was not moved", () => {
    expect(resolveMovedAgentId("c", (id) => agents.get(id) ?? null)).toBeNull();
  });
  it("stops on a cycle", () => {
    const cyclic = new Map([
      ["x", { id: "x", archivedAt: "t", labels: { "paseo.moved-to-agent-id": "y" } }],
      ["y", { id: "y", archivedAt: "t", labels: { "paseo.moved-to-agent-id": "x" } }],
    ]);
    expect(resolveMovedAgentId("x", (id) => cyclic.get(id) ?? null)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test and confirm it fails.** Run `cd packages/app && npx vitest run src/session-move/use-follow-moved-agents.test.ts --bail=1`.

- [ ] **Step 3: Implement the resolver and the hook.** Create `use-follow-moved-agents.ts`:

```ts
import { useEffect } from "react";
import { getMovedToAgentId } from "@getpaseo/protocol/agent-labels";

interface MovableAgent {
  id: string;
  archivedAt?: string | null;
  labels?: Record<string, unknown> | null;
}

/** Follows paseo.moved-to-agent-id from an archived agent to the live one; null if not moved. */
export function resolveMovedAgentId(
  agentId: string,
  getAgent: (id: string) => MovableAgent | null,
): string | null {
  const seen = new Set<string>([agentId]);
  let current = getAgent(agentId);
  let next = current?.archivedAt ? getMovedToAgentId(current.labels) : null;
  let resolved: string | null = null;
  while (next) {
    if (seen.has(next)) return null;
    seen.add(next);
    resolved = next;
    current = getAgent(next);
    next = current?.archivedAt ? getMovedToAgentId(current.labels) : null;
  }
  return resolved;
}
```

Then add the hook `useFollowMovedAgents(serverId, workspaceKey)` in the same file. It:

1. Subscribes to the daemon client's `agent_moved` event. Find how other app hooks get the `DaemonClient` for a `serverId` by searching `packages/app/src` for `.on("agent_update"`.
2. On each event, finds tabs in that workspace whose target is `{ kind: "agent", agentId: fromAgentId }`, and calls `useWorkspaceLayoutStore.getState().replaceTab(workspaceKey, tabId, { kind: "agent", agentId: toAgentId })`.
3. On mount and whenever the agent list changes, runs `resolveMovedAgentId` for each agent tab and replaces the stale ones.

Mount the hook once per workspace screen, in `screens/workspace/workspace-screen.tsx`, next to other per-workspace effects.

- [ ] **Step 4: Run the test and confirm it passes.**

- [ ] **Step 5: Request hook.** Create `use-agent-move.ts`. It exposes:
  - `{ targets, loadTargets(), move(target, continueWork), moveBack(continueWork), status }`
  - `status` is a discriminated union: `{ kind: "idle" } | { kind: "loading" } | { kind: "error"; message: string } | { kind: "done"; agentId: string }`. Do not use a bag of booleans; see `docs/coding-standards.md`.
  - It calls `client.listMoveTargets`, `client.moveAgent` and `client.moveAgentBack`.
  - Gate it with `useSessionStore((s) => s.sessions[serverId]?.serverInfo?.features?.agentMove === true)`.

- [ ] **Step 6: Dialog.** Create `move-dialog.tsx` using the app's existing modal/sheet component for dialogs. Read `docs/menus.md` and copy the structure of an existing confirm dialog; search `packages/app/src` for a component used by the archive confirmation. Content:
  - Title "Move session".
  - One row per target from `listMoveTargets`:
    - Show the label, plus a usage pill "`{usedPct}%` used" when `usedPct !== null`.
    - When usage is 100% or more, append ", resets {time}", formatted with the app's existing relative-time helper from the usage screen.
    - Disable rows that are `current` or not `available`.
    - Group rows by `family`.
  - A "Continue automatically" checkbox, on by default.
  - The primary action "Move". Show a spinner while the request runs. On error, show the daemon's message inline.

- [ ] **Step 7: Tab-menu entry.** In `workspace-tab-menu.ts`:
  - Add `moveAgent: string` to `WorkspaceTabMenuLabels`.
  - Add `moveAgent: i18n.t("workspace.tabs.menu.moveAgent")` to `DEFAULT_WORKSPACE_TAB_MENU_LABELS`.
  - Add `onMoveAgent?: (agentId: string) => void` to both input interfaces.
  - Next to the reload-agent entry (`:302`), add:

```ts
if (onMoveAgent) {
  entries.push({
    kind: "item",
    key: "move-agent",
    label: labels.moveAgent,
    icon: "rotate-cw",
    testID: `${menuTestIDBase}-move-agent`,
    onSelect: () => {
      onMoveAgent(agentId);
    },
  });
}
```

Use a better-suited icon if the icon union in `WorkspaceTabMenuEntry` has one, such as an arrow or swap; do not add a new icon kind. Add `"moveAgent": "Move session…"` to the English locale file that holds `workspace.tabs.menu.reloadAgent`. Then thread `onMoveAgent` through the three callers: `workspace-desktop-tabs-row.tsx:1516`, `compact-workspace-header/tab-switcher.tsx:205` and `components/split-container.tsx:78`, following how `onReloadAgent` is threaded. Pass it only when the `agentMove` feature flag is on; the callback opens `MoveDialog`.

- [ ] **Step 8: Banner.** Create `move-banner.tsx`, rendered at the top of the agent chat screen; find where the agent screen renders error/notice rows. It shows:
  - When `agent.limitReached` is set, or the agent's own usage report (the usage hook the composer pill uses) has a window with `usedPct >= 100`: "{account} limit reached{, resets X} · **Move to…**", which opens `MoveDialog`.
  - When `getMovedFromAgentId(agent.labels)` is set: "Moved from {original label} · **Move back**", which calls `moveBack(true)`. Highlight it (`accent` style) when the original account's target row reports `usedPct < 100`.
  - Nothing otherwise.

- [ ] **Step 9: Manual verification on the dev daemon.** Run `npm run dev` and `npm run dev:desktop`. Then:
  1. Create a Claude agent and send one message.
  2. Open the tab menu → "Move session…". Pick Codex with "Continue automatically" off.
  3. Check that the tab switches to the Codex agent, shows "Moved from Claude", and that the first message you send includes the history.
  4. Click "Move back" and check the tab returns to the Claude agent.

  Capture screenshots for the PR, per `docs/qa.md`.

- [ ] **Step 10: Checkpoint.** Run `npm run typecheck`, `npm run lint -- packages/app/src/session-move packages/app/src/screens/workspace`, and `npm run format:files -- <changed app files>`.

---

### Task 11: Docs and final verification

**Files:**

- Modify: `docs/agent-lifecycle.md`
- Modify: `public-docs/cli.md` (the agent commands section)

- [ ] **Step 1: Document the move.** In `docs/agent-lifecycle.md`, add to the section that covers archive semantics. Integrate it rather than appending (see "Writing docs" in `CLAUDE.md`). Cover:
  - A move archives the original with `paseo.moved-to-agent-id` and labels the new agent `paseo.moved-from-agent-id`.
  - It never uses the parent label, because archive cascades to children.
  - Native versus handoff, and why native exists (Claude resumes only from its own config dir).
  - `pendingMoveContext` is cleared when the next prompt starts.

- [ ] **Step 2: Document the CLI.** In `public-docs/cli.md`, add `paseo agent move <id> --to <provider> [--model] [--no-continue]` and `paseo agent move-back <id>`, in the style of the existing entries.

- [ ] **Step 3: Full verification.** Run every test file created or changed in Tasks 1–10, one file per command, with `--bail=1`. Then run `npm run typecheck`, then `npm run lint` on all changed paths, then `npm run format:check`. Expected: all pass.

- [ ] **Step 4: Report.** List the changed files (`git status --porcelain`) and the test results. Do not commit.
