# Office List view as upstream's list mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office's List view gets filter tabs with counts, a search, and per row the context, the time and the cost.

**Architecture:** The office's server reads two more fields from the daemon's agent payload (`lastUsage.totalCostUsd`, `lastUserMessageAt`) onto `OfficeAgent`. A pure module, `client/list-text.ts`, decides the tab of an agent, the counts, the search match and the row's texts. `client/structure-view.tsx` draws the bar over the room cards and filters the rooms' rows. Piece 3 reuses `list-text.ts` for its Sessions panel.

**Tech Stack:** TypeScript, zod, React Native (react-native-web in a browser), vitest with jsdom for mounted tests, the plugin kit (`@getpaseo/plugin/client/ui`: `ScrollView`, `TextInput`).

**Spec:** `docs/superpowers/specs/2026-11-17-office-list-mode-design.md` (piece 1 of sub-project 7 of `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`).

## Global Constraints

- Work in your own worktree on branch `feat/office-list-mode`, made from `main`. Do not push. Do not write in any other worktree.
- Every subagent runs on Opus.
- No commit carries AI attribution: no `Co-Authored-By` trailer, no "Generated with" line.
- Run one test file at a time, from the repo root: `npx vitest run <file> --bail=1`. Never run a whole suite.
- After each task's code: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, then `npm run lint -- <changed .ts/.tsx files>`, then `npm run format:files -- <changed files>`.
- Never restart or touch the daemon on port 6767. No real agent is created or prompted.
- Snippets are in `text` fences on purpose, so the formatter leaves them as they are.

Binding values from the spec:

- Tabs, in order: `All`, `Needs you`, `Working`, `Resting`, each with its count. `All` is chosen at first.
- Needs you: `attentionReason(agent) !== null`. Working: status `running` or `initializing`, or an idle parent with `waitingOn > 0`. Resting: the rest.
- Search placeholder and label: `Search agents`. Every word must match one of: the title (`agentTitle`), the task (`agentTask`), the room's name, the room's project, the branch, `agentMeta`. Case and accents are ignored (NFD, strip `̀-ͯ`).
- A room with no matching row is left out while the tab is not `All` or the search is not empty. A sub-agent row shows when it matches; when its parent also shows, it stays under it.
- Nothing found: `No agent matches.`
- `/` focuses the search on web when focus is not in a field. Escape in the field clears it.
- The tab and the search live in the component's state; nothing is saved.
- Row order on the right: context, time, cost. Each left out when empty.
- Context: a bar and `NN%` (`contextPercent`). Tone: muted below 60, warning from 60, danger from 85 (`NEARLY_FULL`).
- Time while working: since `promptedAt`, `m:ss` under an hour, `h:mm:ss` from an hour. Ticks every second while a working row shows.
- Time while resting: since `idleSince`: `now` under a minute, `5m ago`, `2h ago`, `3d ago`. Ticks every minute.
- No time for an agent that needs you, is starting, or stopped on an error.
- Cost: `$0.42`, two decimals, only above zero.
- Compact layouts: the tabs on one row that scrolls sideways, the search under them at full width; the row's context, time and cost on their own line under the second line.
- The row's accessibility label: `Ali: Running, context 62%, 4:12, $0.42`, with absent parts left out.
- Second line: `agentMeta(agent)`, then ` · <branch>` when the room's workspace has one.
- No checklist count.

Decided in this plan, where the spec left it open:

- `costUsd` and `promptedAt` are read in `projectAgent`. `promptedAt` is kept only when the status is `running` or `initializing`.
- The clock is one `useNow(intervalMs)` hook in `structure-view.tsx`. It runs at 1000 ms while a working row is shown, at 60000 ms while only resting rows show, and not at all otherwise.
- `list-text.ts` takes `now: number` as a parameter everywhere it needs the time, so its tests use fixed times.

## Files shared with other branches

`feat/office-incidents` was merged into `main` at `d58c6f6ee`, after this plan's spec was written. Its changes are in your base. Where the table names it, it marks code of the incidents work in the same file: keep your change away from it.

| File                                       | Also edited by                                                                           | How to keep the merge small                                                    |
| ------------------------------------------ | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| `plugins/office/shared/contracts.ts`       | `feat/office-incidents` (an `incidents` field on the snapshot)                           | Add the two fields at the end of `OfficeAgentSchema` only.                     |
| `plugins/office/client/styles.ts`          | piece 3 `feat/office-side-panels` (its panels' styles)                                   | Add the new styles as one block, named `list*`, after the existing row styles. |
| `plugins/office/client/list-text.ts`       | piece 3 imports it and does not edit it                                                  | Keep the exports named in Task 2's Interfaces.                                 |
| `docs/plugins.md`                          | piece 3 (a sentence on the panels)                                                       | One sentence in the office's section, on its own line.                         |
| `plugins/office/client/office-surface.tsx` | `feat/office-incidents` (its card and banner), piece 3 (the header buttons and the link) | One line only: `compact={layout.compact}` on `StructureView`.                  |

Not touched by this plan: `hub.ts`, `index.server.ts`, `paseo-entry.js`, `import-upstream.mjs`, `MANIFEST.json`.

## Review Focus

1. **An agent whose room is the lobby has no workspace.** The second line has no branch, and the search does not throw on the missing project. Pinned in Task 2.
2. **A parent that does not match while its sub-agent does.** The sub-agent shows at depth 0, not indented under nothing. Pinned in Task 3.
3. **A provider that reports `totalCostUsd: 0` or a tiny cost.** `0` shows nothing, and `0.004` shows `$0.00`. Pinned in Task 2.
4. **A `promptedAt` in the future (clock skew).** The time reads `0:00`, never negative. Pinned in Task 2.
5. **Typing `/` inside the search field or the board's text box.** It types a slash and does not steal focus. Pinned in Task 3.

---

### Task 1: The cost and the prompt's time on the office's agent

**Files:**

- Modify: `plugins/office/shared/contracts.ts` (end of `OfficeAgentSchema`)
- Modify: `plugins/office/server/directory.ts` (`DirectoryAgentInput`, `projectAgent`)
- Test: `plugins/office/server/directory.test.ts`

**Interfaces:**

- Produces: `OfficeAgent.costUsd?: number` (finite, ≥ 0) and `OfficeAgent.promptedAt?: string` (ISO).
- `DirectoryAgentInput.lastUsage` gains `totalCostUsd?: number`. `DirectoryAgentInput` gains `lastUserMessageAt?: string | null`.

- [ ] **Step 1: Write the failing tests** in `directory.test.ts`, using its `agentInput` helper:

```text
test("an agent carries the cost its provider reports", () => {
  expect(projectAgent(agentInput({ lastUsage: { totalCostUsd: 1.5 } }))?.costUsd).toBe(1.5);
  expect(projectAgent(agentInput({ lastUsage: { totalCostUsd: 0 } }))?.costUsd).toBe(0);
  expect(projectAgent(agentInput({ lastUsage: { totalCostUsd: -1 } }))).not.toHaveProperty("costUsd");
  expect(projectAgent(agentInput({ lastUsage: { totalCostUsd: Number.NaN } }))).not.toHaveProperty("costUsd");
  expect(projectAgent(agentInput({}))).not.toHaveProperty("costUsd");
});

test("a running agent carries when it was last prompted, an idle one does not", () => {
  const at = "2026-11-17T09:00:00.000Z";
  expect(projectAgent(agentInput({ status: "running", lastUserMessageAt: at }))?.promptedAt).toBe(at);
  expect(projectAgent(agentInput({ status: "initializing", lastUserMessageAt: at }))?.promptedAt).toBe(at);
  expect(projectAgent(agentInput({ status: "idle", lastUserMessageAt: at }))).not.toHaveProperty("promptedAt");
  expect(projectAgent(agentInput({ status: "running", lastUserMessageAt: null }))).not.toHaveProperty("promptedAt");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run plugins/office/server/directory.test.ts --bail=1`
Expected: FAIL on `costUsd` being undefined.

- [ ] **Step 3: Add the fields.** In `contracts.ts`, at the end of `OfficeAgentSchema`: `costUsd: z.number().nonnegative().optional()` and `promptedAt: z.string().optional()`, each with a one-line comment. In `directory.ts`, add the input fields and spread them in `projectAgent` the way `context` and `idleSince` are spread.

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run plugins/office/server/directory.test.ts --bail=1`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
git add plugins/office/shared/contracts.ts plugins/office/server/directory.ts plugins/office/server/directory.test.ts
git commit -m "feat(office): an agent carries its cost and when it was last prompted"
```

### Task 2: The list's texts, pure

**Files:**

- Create: `plugins/office/client/list-text.ts`
- Test: `plugins/office/client/list-text.test.ts`

**Interfaces:**

- Consumes: `OfficeAgent`, `OfficeRow`, `OfficeRoom`, `agentTitle`, `agentTask`, `agentMeta`, `attentionReason` from `shared/model.ts`; `contextPercent` from `client/context-text.ts`.
- Produces (piece 3 imports these names):
  - `type ListTab = "all" | "attention" | "working" | "resting"`
  - `const LIST_TABS: readonly { tab: ListTab; label: string }[]`
  - `tabOf(row: OfficeRow): Exclude<ListTab, "all">`
  - `tabCounts(rows: readonly OfficeRow[]): Record<ListTab, number>`
  - `matchesQuery(row: OfficeRow, room: OfficeRoom, query: string): boolean`
  - `filterRooms(rooms: readonly OfficeRoom[], tab: ListTab, query: string): OfficeRoom[]`
  - `secondLine(agent: OfficeAgent, room: OfficeRoom): string`
  - `contextLevel(percent: number): "low" | "mid" | "high"`
  - `timeText(row: OfficeRow, now: number): string | null`
  - `costText(costUsd: number | undefined): string | null`
  - `rowLabel(row: OfficeRow, stateWord: string, now: number): string`
  - `const NO_MATCH = "No agent matches."`, `const SEARCH_LABEL = "Search agents"`

- [ ] **Step 1: Write the failing tests**, with a small `row()` and `room()` builder in the test file:

```text
test("an agent's tab", () => {
  expect(tabOf(row({ status: "running" }))).toBe("working");
  expect(tabOf(row({ status: "initializing" }))).toBe("working");
  expect(tabOf(row({ status: "idle" }, { waitingOn: 2 }))).toBe("working");
  expect(tabOf(row({ status: "idle" }))).toBe("resting");
  expect(tabOf(row({ status: "error" }))).toBe("attention");
  expect(tabOf(row({ status: "running", permissions: [permission()] }))).toBe("attention");
});
test("the counts", () => expect(tabCounts([run, run, idle, err])).toEqual({ all: 4, attention: 1, working: 2, resting: 1 }));
test("every word must match a field, without case or accents", () => {
  const r = room({ name: "shop-api", projectName: "Shop", branch: "feat/café" });
  expect(matchesQuery(row({ title: "Ali" }), r, "ali cafe")).toBe(true);
  expect(matchesQuery(row({ title: "Ali" }), r, "ali nope")).toBe(false);
  expect(matchesQuery(row({ title: "Ali", provider: "claude", model: "opus" }), r, "OPUS")).toBe(true);
  expect(matchesQuery(row({ title: "Ali" }), lobby(), "ali")).toBe(true);
});
test("a filter leaves out rooms with no match; All with no search keeps empty rooms", ...);
test("the second line adds the branch when the room has one", () => {
  expect(secondLine(agent({ provider: "claude", model: "opus" }), room({ branch: "main" }))).toBe("claude · opus · main");
  expect(secondLine(agent({ provider: "claude", model: null }), lobby())).toBe("claude");
});
test("the context's level", () => expect([59, 60, 84, 85].map(contextLevel)).toEqual(["low", "mid", "mid", "high"]));
test("a working agent's clock", () => {
  const at = Date.parse("2026-11-17T09:00:00Z");
  const r = row({ status: "running", promptedAt: "2026-11-17T09:00:00Z" });
  expect(timeText(r, at)).toBe("0:00");
  expect(timeText(r, at + 59_000)).toBe("0:59");
  expect(timeText(r, at + 3_600_000)).toBe("1:00:00");
  expect(timeText(r, at - 5_000)).toBe("0:00");
});
test("a resting agent's ago", () => {
  const r = row({ status: "idle", idleSince: "2026-11-17T09:00:00Z" });
  // 30 s, 5 min, 2 h, 3 d
  expect([30e3, 3e5, 72e5, 2592e5].map((d) => timeText(r, at + d))).toEqual(["now", "5m ago", "2h ago", "3d ago"]);
});
test("no time while it needs you, starts or has stopped", ...);
test("the cost", () => expect([undefined, 0, 0.004, 1.5].map(costText)).toEqual([null, null, "$0.00", "$1.50"]));
test("the row's label", () => expect(rowLabel(r, "Running", now)).toBe("Ali: Running, context 62%, 4:12, $0.42"));
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run plugins/office/client/list-text.test.ts --bail=1`
Expected: FAIL, the module does not exist.

- [ ] **Step 3: Write `list-text.ts`.** The agent's room for `matchesQuery` gives `room.name`, `room.subtitle` and `room.workspace?.branch`. `filterRooms` keeps each room's `rows` that match the tab and the query. A depth-1 row whose parent row is not kept becomes depth 0. `costText` uses `toFixed(2)` and returns `null` for `undefined` or `<= 0`.

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run plugins/office/client/list-text.test.ts --bail=1`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
git add plugins/office/client/list-text.ts plugins/office/client/list-text.test.ts
git commit -m "feat(office): the List view's tabs, search and row texts"
```

### Task 3: The bar and the rows in the List view

**Files:**

- Modify: `plugins/office/client/structure-view.tsx`
- Modify: `plugins/office/client/styles.ts` (a `list*` block)
- Modify: `plugins/office/client/web-env.web.ts` (one helper, `listenForSlash`)
- Modify: `docs/plugins.md` (one sentence in the office's section)
- Modify: `plugins/office/client/office-surface.tsx` (one line: `compact={layout.compact}`)
- Test: `plugins/office/client/structure-view.mounted.test.tsx` (new, in the style of `room-board.mounted.test.tsx`)

**Interfaces:**

- Consumes: everything Task 2 produces; `stateLabel` from `agent-card.tsx`.
- Produces: `listenForSlash(inputId: string): () => void` in `web-env.web.ts`. It focuses the element with that id on a `/` keydown whose target is not an `input`, `textarea`, `select` or `[contenteditable="true"]`, and has no Ctrl, Meta or Alt.
- `StructureViewProps` gains `compact: boolean`. `office-surface.tsx` passes `layout.compact` as `compact`. This is the one line the plan changes there; put it on its own line.

- [ ] **Step 1: Write the failing mounted tests**

```text
test("the tabs show their counts, and a tab leaves out rooms with no match", ...);
// rooms: shop (Ali running, Sara idle), lobby (Bob error). Press "Needs you (1)": only the lobby's card, with Bob.
test("a search keeps a matching sub-agent at the top level when its parent does not match", ...);
test("nothing found says No agent matches.", ...);
test("Escape in the search clears it", ...);
test("a slash typed in the search field is typed, not taken", ...);
test("a row shows its context, time and cost, and says them in its label", ...);
// Ali running, context 62/100, promptedAt 4:12 ago (vi.setSystemTime), costUsd 0.42:
// the row's accessibilityLabel is "Ali: Running, context 62%, 4:12, $0.42".
```

- [ ] **Step 2: Run it to see it fail**

Run: `npx vitest run plugins/office/client/structure-view.mounted.test.tsx --bail=1`
Expected: FAIL.

- [ ] **Step 3: Build the bar and the rows.** The bar is the first child of the `ScrollView`'s content: the tabs as pressables with `accessibilityRole="tab"` and `aria-selected`, then `TextInput` with `nativeID="office-list-search"`, `accessibilityLabel`/`placeholder` `SEARCH_LABEL`. On compact layouts the tabs sit in a horizontal `ScrollView` and the search goes on the next row. Rows render from `filterRooms(...)`. `listenForSlash` is called in an effect on web only. The context bar is a `View` track with an inner `View` at `percent%` width, toned by `contextLevel`.

- [ ] **Step 4: Run the test to see it pass**

Run: `npx vitest run plugins/office/client/structure-view.mounted.test.tsx --bail=1`
Expected: PASS.

- [ ] **Step 5: Typecheck, lint, format, commit**

```bash
git add plugins/office/client/structure-view.tsx plugins/office/client/structure-view.mounted.test.tsx plugins/office/client/styles.ts plugins/office/client/web-env.web.ts plugins/office/client/office-surface.tsx docs/plugins.md
git commit -m "feat(office): the List view has tabs, a search, and each agent's context, time and cost"
```

### Task 4: Live check and the cost's meaning

**Files:**

- Modify: `docs/superpowers/specs/2026-11-17-office-list-mode-design.md` (its "Not verified" section, and the Status line to "built")
- Modify: `docs/superpowers/specs/2026-11-16-office-owner-review-design.md` (the Status line: piece 1 built)

- [ ] **Step 1: Look at it.** Start a dev daemon of this worktree (`npm run dev`, never port 6767) with the office's fixtures, as the earlier office plans did. Open the office's List view at 1280 px and 390 px, light and dark. Check the tabs, the search, Escape, `/`, and a row's context, time and cost, by pointer and by keyboard.

- [ ] **Step 2: Settle the cost.** Read one Claude agent's `lastUsage.totalCostUsd` before and after a second turn, from a recorded fixture or the provider's test data, not a new agent. Write in the spec whether the figure is the session's total or the last turn's.

- [ ] **Step 3: Write what was seen and what was not** in the spec's "Not verified" section, in the style of the earlier office specs.

- [ ] **Step 4: Format and commit**

```bash
git add docs/superpowers/specs/2026-11-17-office-list-mode-design.md docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git commit -m "docs(office): the List view as upstream's list mode is built"
```

## Order

Tasks 1 and 2 can run in parallel. Task 3 needs both. Task 4 is last.
