# The lobby board's to-do list Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The lobby board shows one to-do list for the office (add field, checkboxes, "Clear finished", notes under it) and a read-only section with each agent's own unfinished checklist steps. Every other room keeps its posts board.

**Architecture:** A to-do is a lobby task post, so storage, wakes and agent tools stay as they are; the board service gains one bulk delete of a board's done tasks behind a new RPC. The activity poller, which already reads each running agent's newest 10 timeline items every 5 s, also reads the newest `todo` item; the hub owns the checklist map in memory and sends it whole on the snapshot and on every `activity` event. The client's model gives the lobby room its to-dos (done ones included) and the office its agent task groups, and the board sheet renders a lobby body instead of the posts body when the room is the lobby.

**Tech Stack:** TypeScript, zod, React Native (react-native-web in a browser), vitest, the plugin kit (`@getpaseo/plugin`, `@getpaseo/plugin/client/ui`; `Icon` takes Lucide names).

**Spec:** `docs/superpowers/specs/2026-11-17-office-lobby-todo-design.md`

## Global Constraints

- Work in your own worktree on a new branch off main: `git -C /workspace/QFlavours/paseo-onepage-docs worktree add /workspace/QFlavours/paseo-lobby-todo -b feat/office-lobby-todo main`. Link `node_modules` from `/workspace/QFlavours/paseo` (the root one and each package's and `plugins/node_modules`) as symlinks. Do not write in `/workspace/QFlavours/paseo` or in any other worktree. Do not push.
- No commit carries AI attribution: no `Co-Authored-By` trailer, no "Generated with" line. Commits run the pre-commit hook; do not skip it.
- Run one test file at a time, from the worktree root: `npx vitest run <file> --bail=1`. Never run a whole suite.
- After each task's code: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, then `npm run lint -- <changed .ts/.tsx files>`, then `npm run format:files -- <changed files>`.
- Nothing in `packages/` changes. The office's wire schemas are its own (`plugins/office/shared/contracts.ts`); new fields there are optional and stay pure (no `.transform()`, `.catch()`, `.preprocess()`).
- `boards.json`'s shape, the 200-post cap, the 7-day drop of done tasks and the agent tools (`server/agent-tools.ts`) do not change.
- Server code cannot import from `client/`. Shared code goes in `shared/`.
- Never restart or touch the daemon on port 6767. No real agent is created or prompted: tests use fakes.
- Snippets are in `text` fences on purpose, so the formatter leaves them as they are.

Binding values from the spec:

- Only the lobby board (`LOBBY`, `"lobby"`) gets the to-do view. Other boards, and the stand-up's reading of `room.posts`, are unchanged.
- Add field: one line, placeholder `Add a to-do`, Enter adds, an `Add` button (the sheet's one primary button), off while the field is empty. It posts `{ board: "lobby", kind: "task", text }`, plus `to` when an agent is chosen. "Wake an agent with it" stays under the field with today's "Wake agents is off" line. The field clears with `textAfterSend`; the agent choice returns to nobody. No Task/Note chips on the lobby.
- List: open and claimed first, then done; oldest first within each (`createdAt`, then `seq`). A claimed to-do says who claimed it; one with `to` says whom it names. Done: ticked, text dimmed.
- Tick sends `done`, untick sends `reopen` (`office.update.request`). Any to-do can be ticked. The server is unchanged: a reopened to-do is open and unclaimed.
- Each to-do and each note keeps Delete with "Delete this post?".
- `Clear finished`: off with no done to-do; asks `Delete N finished to-dos?` (`Delete 1 finished to-do?` for one) with Delete and Keep; deletes the lobby's done tasks in one save.
- Notes: under the list, oldest first, with Delete; the section is absent with no notes.
- Empty list: `No to-dos`. No checklists: `No agent tasks`.
- Agent tasks: one group per agent with an unfinished step, every agent in the office including sub-agents, in the model's room order and each room's row order. Each group shows the agent's name (`authorName`), then its steps in the agent's order, `◐` for `in_progress`, `○` for `pending`. Read only.
- Lobby room card: the first three open or claimed to-dos (`CARD_POSTS`), `N more` counting only the other open or claimed ones, `No to-dos` when none.
- A checklist step is unfinished when `completed !== true` and `status !== "completed"`. An item without a string `text` is skipped. At most 50 steps per agent.
- The checklist map is kept in memory only, replaced per agent on each poll round that read a `todo` item for it, kept when the agent stops or the item leaves the tail, dropped when the agent leaves the office's agent list, emptied when the directory stops.

Decided in this plan, where the spec left it open:

- Step text: the first line, trimmed; an empty line skips the item; longer than 200 characters is cut to 199 and `…`.
- The poller reports, per agent whose tail has a `todo` item, its unfinished steps, an empty array when all are finished. The hub deletes an agent whose report is empty, so a finished checklist leaves the section on the next round.
- The new RPC is `office.board.clear_done.request`, input `{ board: string }` (min 1), output `DeleteResultSchema`. With no done task it answers `{ ok: true }` and saves nothing.
- The lobby body lives in a new `client/lobby-board.tsx`; `board-sheet.tsx` picks it when `room.lobby`. The agent picker page and the close steps stay in `board-sheet.tsx`'s flow.
- The checkbox is a `Pressable` with `accessibilityRole="checkbox"`, `aria-checked`, icons `Square` and `SquareCheck`, Space through `listenForSpace` as `Chip` does, off while its change is pending, its failure under the row via `failureText`.
- To-do meta line: `claimed by <name>` when `state === "claimed"`, `for <name>` when `to` is set, joined with `·`; no line when neither.

## Review Focus

1. **An agent adds or ticks a lobby to-do while the sheet is open with text typed.** The new row shows, the typed text and the agent choice stay. Pinned in Task 5.
2. **An agent finishes every step of its checklist.** It leaves the section on the next round, not after a restart. Pinned in Task 3.
3. **A provider's `todo` item with bad entries** (not an array, a number as `text`, multi-line or 5,000-character text, 80 steps). Bad entries are skipped, text is one line of 200 at most, 50 steps are sent. Pinned in Task 3.
4. **A double tap on a checkbox.** One update is sent; the box is off until the answer. Pinned in Task 5.
5. **Clear finished's question while another to-do is ticked elsewhere.** The count in the question follows the live board. Pinned in Task 5.
6. **An archived agent with a checklist.** Its group disappears without waiting for a poll round. Pinned in Task 3.

---

### Task 1: The contracts

**Files:**

- Modify: `plugins/office/shared/contracts.ts`
- Test: `plugins/office/shared/contracts.test.ts`

**Interfaces:**

- Produces:

```text
export const CHECKLIST_STEP_MAX = 50;
export const CHECKLIST_TEXT_MAX = 200;
export const ChecklistStepSchema = z.object({ text: z.string(), status: z.enum(["pending", "in_progress"]) });
export type ChecklistStep = z.output<typeof ChecklistStepSchema>;
export const ChecklistsSchema = z.record(z.string(), z.array(ChecklistStepSchema));
export type Checklists = z.output<typeof ChecklistsSchema>;
// OfficeSnapshotSchema and the "activity" event: checklists: ChecklistsSchema.optional()
export const clearDoneRpc = defineRpc({
  name: "office.board.clear_done.request",
  input: z.object({ board: z.string().min(1) }),
  output: DeleteResultSchema,
});
```

- [ ] **Step 1: Write the failing tests**

```text
test("a snapshot and an activity event carry checklists, and parse without them", () => {
  const steps = { a1: [{ text: "Run typecheck", status: "in_progress" }] };
  expect(OfficeSnapshotSchema.parse({ ...emptySnapshot, checklists: steps }).checklists).toEqual(steps);
  expect(OfficeSnapshotSchema.parse(emptySnapshot).checklists).toBeUndefined();
  expect(OfficeEventSchema.parse({ type: "activity", activity: {}, checklists: steps })).toMatchObject({ checklists: steps });
});
test("a step is pending or in progress, never completed", () => {
  expect(ChecklistStepSchema.safeParse({ text: "x", status: "completed" }).success).toBe(false);
});
test("clear done names its RPC and needs a board", () => {
  expect(clearDoneRpc.name).toBe("office.board.clear_done.request");
  expect(clearDoneRpc.input.safeParse({ board: "" }).success).toBe(false);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run plugins/office/shared/contracts.test.ts --bail=1`
Expected: FAIL, `ChecklistStepSchema` is not exported.

- [ ] **Step 3: Implement** the schemas above in `contracts.ts`, beside `ActivityStepSchema` and the board RPCs.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run plugins/office/shared/contracts.test.ts --bail=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/shared/contracts.ts plugins/office/shared/contracts.test.ts
git commit -m "feat(office): contracts for agent checklists and clearing done tasks"
```

---

### Task 2: Clearing a board's done tasks

**Files:**

- Modify: `plugins/office/server/board-service.ts`, `plugins/office/server/office.ts`, `plugins/office/index.server.ts`
- Test: `plugins/office/server/board-service.test.ts`, `plugins/office/index.server.test.ts`

**Interfaces:**

- Consumes: Task 1's `clearDoneRpc`.
- Produces: `BoardService.clearDone(board: string): Promise<DeleteResult>` and the same on the office's service interface in `office.ts` (`await ready`, then `service.clearDone(board)`, as `remove` does). `index.server.ts` handles `clearDoneRpc` right after `deleteRpc`: `holder.remember(context.paseo)`, then `guarded("clear", () => office.clearDone(input.board))`.

- [ ] **Step 1: Write the failing tests**

In `board-service.test.ts`, with the file's existing setup:

```text
test("clearing a board deletes its done tasks in one save and leaves the rest", async () => {
  // lobby: p1 task done, p2 task open, p3 note, p4 task done; w1: p5 task done
  const saves = store.saves.length;
  expect(await service.clearDone("lobby")).toEqual({ ok: true });
  expect(store.saves.length).toBe(saves + 1);
  expect(service.boards().lobby.map((post) => post.id)).toEqual(["p2", "p3"]);
  expect(service.boards().w1.map((post) => post.id)).toEqual(["p5"]);
  expect(events.at(-1)).toMatch(/^board lobby /);
});
test("clearing a board with no done task saves nothing", async () => {
  const saves = store.saves.length;
  expect(await service.clearDone("lobby")).toEqual({ ok: true });
  expect(store.saves.length).toBe(saves);
});
test("a clear that cannot save keeps the posts", async () => {
  store.failNextSave();
  expect(await service.clearDone("lobby")).toEqual({ ok: false, error: expect.stringMatching(/^Unable to save the board/) });
  expect(service.boards().lobby).toHaveLength(4);
});
```

Use the store fake the file already has; add a save counter or a failing save to it if it lacks one. In `index.server.test.ts`, the handler list in the "the entry serves ..." test gains `"office.board.clear_done.request"` after `"office.delete.request"` (rename the test's "four board calls" to "five").

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run plugins/office/server/board-service.test.ts --bail=1`
Expected: FAIL, `service.clearDone is not a function`.

- [ ] **Step 3: Implement** `clearDone` inside `exclusive`, with one `commit(next, [board])` when something goes, as `remove` does.

- [ ] **Step 4: Run them and see them pass**

Run: `npx vitest run plugins/office/server/board-service.test.ts --bail=1`, then `npx vitest run plugins/office/index.server.test.ts --bail=1`
Expected: PASS for both.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/server/board-service.ts plugins/office/server/board-service.test.ts plugins/office/server/office.ts plugins/office/index.server.ts plugins/office/index.server.test.ts
git commit -m "feat(office): clear a board's done tasks in one save"
```

---

### Task 3: Agent checklists on the server

**Files:**

- Modify: `plugins/office/server/activity.ts`, `plugins/office/server/hub.ts`, `plugins/office/server/live-ports.ts` (the `onChange` type only)
- Test: `plugins/office/server/activity.test.ts`, `plugins/office/server/hub.test.ts`

**Interfaces:**

- Consumes: Task 1's `ChecklistStep`, `Checklists`, `CHECKLIST_STEP_MAX`, `CHECKLIST_TEXT_MAX`.
- Produces in `activity.ts`:

```text
// ActivityItem gains: items?: unknown
/** The unfinished steps of the newest todo item in a tail; null when the tail has none. */
export function readChecklist(items: readonly ActivityItem[]): ChecklistStep[] | null;
// ActivityPorts.onChange(activity, doing, checklists: Readonly<Record<string, ChecklistStep[]>>)
```

The third argument holds every agent read this round whose tail has a `todo` item, `[]` when all its steps are finished. An agent whose read failed or whose tail has none is absent. A round calls `onChange` when its lines, its steps or its checklists differ from the round before (compare checklists with `JSON.stringify`).

- Produces in `hub.ts`: `HubPorts.startActivity`'s `onChange` takes the same three arguments. The hub keeps `checklists: Record<string, ChecklistStep[]>`; each report replaces the agents it names, deleting those with `[]`. `onDirectory` deletes agents not in `next.agents` and, when that removed one and the directory has started, broadcasts an `activity` event. Every `activity` event and the snapshot carry `checklists: { ...checklists }`. The map is emptied where `activity = {}` is set when the directory stops.

- [ ] **Step 1: Write the failing tests**

In `activity.test.ts`:

```text
test("a checklist is the newest todo item's unfinished steps", () => {
  const items = [
    { type: "todo", items: [{ text: "Old", completed: false }] },
    { type: "tool_call", name: "Edit", status: "completed" },
    { type: "todo", items: [
      { text: "Write the test", completed: true },
      { text: "Run typecheck", completed: false, status: "in_progress" },
      { text: "Commit", completed: false, status: "completed" },
      { text: "Open the PR", completed: false },
    ] },
  ];
  expect(readChecklist(items)).toEqual([
    { text: "Run typecheck", status: "in_progress" },
    { text: "Open the PR", status: "pending" },
  ]);
});
test("a tail without a todo item has no checklist; an all-finished one is empty", () => {
  expect(readChecklist([{ type: "assistant_message" }])).toBeNull();
  expect(readChecklist([{ type: "todo", items: [{ text: "x", completed: true }] }])).toEqual([]);
});
test("bad steps are skipped, text is one line of 200 at most, 50 steps at most", () => {
  const long = "a".repeat(5000);
  const steps = readChecklist([{ type: "todo", items: [
    { text: 7, completed: false }, null, { text: "  \n second line", completed: false },
    { text: "First\nSecond", completed: false }, { text: long, completed: false },
    ...Array.from({ length: 80 }, (_, i) => ({ text: `s${i}`, completed: false })),
  ] }]);
  expect(steps?.[0]).toEqual({ text: "First", status: "pending" });
  expect(steps?.[1].text).toBe(`${"a".repeat(199)}…`);
  expect(steps).toHaveLength(50);
  expect(readChecklist([{ type: "todo", items: "nope" }])).toEqual([]);
});
test("the poller reports checklists, and a checklist change alone is a change", async () => {
  // two rounds with the same lines and steps, the second with one more step: onChange runs twice,
  // the third argument holds the agent's steps; an agent whose tail rejects is absent from it
});
```

In `hub.test.ts`, with the file's `startActivity` fake:

```text
test("a checklist stays after its agent stops and goes when the agent leaves", async () => {
  // report { a1: [step] } -> snapshot and the activity event carry checklists.a1
  // report {} on the next round (a1 stopped, not read) -> checklists.a1 still sent
  // directory view without a1 -> an activity event without a1, before any poll round
});
test("an empty report removes the agent's checklist", async () => {
  // report { a1: [step] }, then { a1: [] } -> checklists is {}
});
test("stopping the directory empties the checklists", async () => { /* as the activity lines' test */ });
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run plugins/office/server/activity.test.ts --bail=1`, then `npx vitest run plugins/office/server/hub.test.ts --bail=1`
Expected: FAIL, `readChecklist` is not exported; the hub's events have no `checklists`.

- [ ] **Step 3: Implement** `readChecklist` and the third `onChange` argument in `activity.ts`, then the map in `hub.ts` as the Interfaces say. `live-ports.ts` passes `onChange` through unchanged; only its type follows.

- [ ] **Step 4: Run them and see them pass**

Run both files again. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/server/activity.ts plugins/office/server/activity.test.ts plugins/office/server/hub.ts plugins/office/server/hub.test.ts plugins/office/server/live-ports.ts
git commit -m "feat(office): the server keeps each agent's checklist"
```

---

### Task 4: The model and the board's words

**Files:**

- Modify: `plugins/office/client/office-state.ts`, `plugins/office/shared/model.ts`, `plugins/office/client/board-text.ts`, `plugins/office/client/use-board-actions.ts`
- Test: `plugins/office/client/office-state.test.ts`, `plugins/office/shared/model.test.ts`, `plugins/office/client/board-text.test.ts`

**Interfaces:**

- Consumes: Task 1's `Checklists`, `ChecklistStep`, `clearDoneRpc`.
- Produces in `office-state.ts`: the `activity` case sets `checklists: event.checklists ?? {}`.
- Produces in `shared/model.ts`:

```text
// OfficeRoom gains:
/** The lobby's task posts, done ones included, in to-do order; [] for every other room. */
todos: Post[];
export interface AgentTaskGroup { agentId: string; steps: ChecklistStep[] }
// OfficeModel gains: agentTasks: AgentTaskGroup[]
/** Open and claimed first, then done; oldest first within each. */
export function orderTodos(posts: readonly Post[]): Post[];
```

`agentTasks` walks `rooms` in order and each room's `rows` in order, keeping agents with a non-empty `state.checklists?.[id]`. `room.posts` keeps hiding done tasks.

- Produces in `board-text.ts`:

```text
export function todoMeta(post: Post, name: (author: string) => string): string | null;
export function clearQuestion(count: number): string;
export function todoPreview(todos: readonly Post[], max?: number): BoardPreview; // open and claimed only
export function stepMark(status: ChecklistStep["status"]): string; // "◐" | "○"
```

- Produces on `BoardActions`: `reopen(id: string): Promise<void>` (update with `reopen`) and `clearDone(board: string): Promise<void>` (`clearDoneRpc`), each rejecting with the server's message as the others do.

- [ ] **Step 1: Write the failing tests**

```text
test("an activity event replaces the checklists, and one without them clears them", () => {
  const withSteps = applyOfficeEvent(EMPTY_OFFICE, { type: "activity", activity: {}, checklists: { a1: [step] } });
  expect(withSteps.checklists).toEqual({ a1: [step] });
  expect(applyOfficeEvent(withSteps, { type: "activity", activity: {} }).checklists).toEqual({});
});
test("the lobby's to-dos include done ones in to-do order; other rooms have none", () => {
  // lobby: done p1 (oldest), open p2, note p3, claimed p4; w1: open p5
  const model = buildOfficeModel(state);
  expect(lobbyOf(model).todos.map((post) => post.id)).toEqual(["p2", "p4", "p1"]);
  expect(lobbyOf(model).posts.map((post) => post.id)).toEqual(["p2", "p3", "p4"]);
  expect(roomOf(model, "w1").todos).toEqual([]);
});
test("agent tasks follow rooms and rows, sub-agents under parents, and skip empty checklists", () => {
  // lobby agent l1, workspace w1 with parent a1 and child a2; checklists for a2, l1, a1, and x: []
  expect(buildOfficeModel(state).agentTasks.map((group) => group.agentId)).toEqual(["l1", "a1", "a2"]);
});
test("a to-do's meta names who claimed it and whom it names", () => {
  expect(todoMeta(claimed("a1"), name)).toBe("claimed by Ali");
  expect(todoMeta({ ...open, to: "a2" }, name)).toBe("for Sara");
  expect(todoMeta({ ...claimed("a1"), to: "a2" }, name)).toBe("claimed by Ali · for Sara");
  expect(todoMeta({ ...done, claimedBy: "a1" }, name)).toBeNull();
});
test("the clear question counts finished to-dos", () => {
  expect(clearQuestion(1)).toBe("Delete 1 finished to-do?");
  expect(clearQuestion(3)).toBe("Delete 3 finished to-dos?");
});
test("the lobby card counts open and claimed to-dos only", () => {
  // 5 open, 2 done -> shown 3, more 2
});
```

- [ ] **Step 2: Run them and see them fail**

Run each of the three test files with `npx vitest run <file> --bail=1`.
Expected: FAIL, `todos` is undefined and the helpers are not exported.

- [ ] **Step 3: Implement** as the Interfaces say. Every place that builds an `OfficeRoom` (fixtures in other tests included) gets `todos`; typecheck finds them.

- [ ] **Step 4: Run them and see them pass**

Run the three files again. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/client plugins/office/shared
git commit -m "feat(office): the lobby's to-dos and the agents' tasks in the model"
```

---

### Task 5: The lobby board

**Files:**

- Create: `plugins/office/client/lobby-board.tsx`
- Modify: `plugins/office/client/board-sheet.tsx`, `plugins/office/client/office-surface.tsx` (pass `agentTasks={model.agentTasks}`)
- Test: `plugins/office/client/board-sheet.mounted.test.tsx`

**Interfaces:**

- Consumes: Task 4's `room.todos`, `AgentTaskGroup`, `todoMeta`, `clearQuestion`, `stepMark`, `BoardActions.reopen` and `clearDone`.
- Produces: `BoardSheetProps.agentTasks: readonly AgentTaskGroup[]`. `LobbyBody` takes `SheetBodyProps` plus `agentTasks`; `BoardSheet` renders it instead of `SheetBody` when `room.lobby`, with the same `picking` handling and `AgentPicker` page.
- Layout, top to bottom: the add field and `Add`; the "Wake an agent with it" row and its paused line; a `To-do` heading with `Clear finished` on its right (or its question with Delete and Keep in its place); the rows, or `No to-dos`; `Notes` and the notes (the `kind === "note"` posts of `room.posts`, already oldest first) with `PostWithActions` (only with notes); `Agent tasks` and the groups, or `No agent tasks`. A to-do row: the checkbox, the text (dimmed when done), the meta line when `todoMeta` returns one, and Delete with its question. Reuse the sheet's existing styles; add a style only for the checkbox row and the dimmed text.

- [ ] **Step 1: Write the failing tests**

In `board-sheet.mounted.test.tsx`, with the file's render setup and a fake `BoardActions` that records calls (add `reopen` and `clearDone` to it):

```text
test("the lobby adds a to-do with Enter and with Add, and keeps the agent choice to the form", ...)
  // type "Rotate keys", Enter -> post({ board: "lobby", kind: "task", text: "Rotate keys" }); field empty
  // Add is disabled while the field is blank; no Task/Note radio group on the lobby
test("ticking sends done, unticking sends reopen, and a pending box takes no second tap", ...)
  // the open row's checkbox (role checkbox, aria-checked false) pressed twice while the fake's promise waits -> one markDone("p2")
  // a done row's checkbox -> reopen("p1")
  // a rejected change shows "Unable to finish p2: ..." under the row
test("Clear finished asks with the live count and clears the lobby", ...)
  // off with no done to-do; with two -> "Delete 2 finished to-dos?"; a rerender with three done -> "Delete 3 finished to-dos?"
  // Delete -> clearDone("lobby"); Keep -> the button is back
test("a to-do arriving while typing keeps the typed text", ...)
  // type "half", rerender with one more todo -> the new row shows, the field still says "half"
test("notes show under the list only when there are notes", ...)
test("agent tasks show each agent's steps, or say there are none", ...)
  // groups for a1 (["◐ Run typecheck", "○ Commit"]) and a2; with [] -> "No agent tasks"
test("another room's board still shows the posts form", ...)
  // w1 sheet: the Task/Note radio group and "Post" are there; no "Clear finished"
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run plugins/office/client/board-sheet.mounted.test.tsx --bail=1`
Expected: FAIL, no `Add a to-do` field on the lobby.

- [ ] **Step 3: Implement** `LobbyBody` in `lobby-board.tsx` and the switch in `BoardSheet`. Submit on Enter with `onSubmitEditing` and `submitBehavior="submit"` (keep the focus in the field). The add form's state follows `SheetBody`'s (`mounted` ref, `textAfterSend`, `keptChoice`).

- [ ] **Step 4: Run them and see them pass**

Run the file again. Expected: PASS, including the existing tests.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/client/lobby-board.tsx plugins/office/client/board-sheet.tsx plugins/office/client/board-sheet.mounted.test.tsx plugins/office/client/office-surface.tsx plugins/office/client/styles.ts
git commit -m "feat(office): the lobby board is a to-do list with the agents' tasks"
```

---

### Task 6: The lobby's room card

**Files:**

- Modify: `plugins/office/client/room-board.tsx`
- Test: `plugins/office/client/room-board.mounted.test.tsx` (new, following `board-sheet.mounted.test.tsx`'s render setup)

**Interfaces:**

- Consumes: Task 4's `room.todos` and `todoPreview`.
- Produces: `RoomBoard` on the lobby shows the title `To-do`, `No to-dos` when the preview is empty, the preview rows with `PostRow brief`, and `N more`. Other rooms are unchanged.

- [ ] **Step 1: Write the failing test**

```text
test("the lobby card previews open to-dos and counts only open ones", ...)
  // 5 open, 2 done -> 3 rows, "2 more"; no to-dos -> "No to-dos"
test("a workspace card still previews its posts", ...)
```

- [ ] **Step 2: Run it and see it fail**

Run: `npx vitest run plugins/office/client/room-board.mounted.test.tsx --bail=1`
Expected: FAIL, the lobby card says `Board`.

- [ ] **Step 3: Implement** the lobby branch in `RoomBoard`.

- [ ] **Step 4: Run it and see it pass**

Run the file again. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/client/room-board.tsx plugins/office/client/room-board.mounted.test.tsx
git commit -m "feat(office): the lobby's card previews its to-dos"
```

---

### Task 7: The docs, a look at it, and mark it built

**Files:**

- Modify: `docs/plugins.md` (the board paragraph that starts "Each room has a board")
- Modify: `docs/superpowers/specs/2026-11-17-office-lobby-todo-design.md` (Status, and a "Not verified" section)

- [ ] **Step 1: Rewrite the board paragraph.** Say that the lobby's board is the office's to-do list (a to-do is a lobby task; "Clear finished" deletes its done ones), and that it shows each agent's unfinished checklist steps, read from the newest `todo` timeline item by the activity read, kept in memory only and back after a restart when the agent next updates it. Link the spec. Keep the rest of the paragraph as it is; follow CLAUDE.md's doc voice.

- [ ] **Step 2: Look at it.** Start a dev daemon and the web app from your worktree (`npm run dev`, `npm run dev:app`; never the daemon on 6767). Create no agent. Post fixture to-dos and notes on the lobby from the sheet. Check at 390 px (light) and 1280 px (light and dark): the lobby board opened from the 3D scene, the 2D floor and the structure view; add with Enter and Add; tick and untick; Clear finished and its question; Delete; the Notes section; `No agent tasks`; the lobby card; a workspace's board unchanged; Tab through the sheet and Escape. The agent tasks section with steps is covered by the mounted test, since no agent may be created.

- [ ] **Step 3: Mark it built.** Set the spec's Status to `built`, and add a "Not verified" section listing what Step 2 could not show (a real agent's checklist, the installed app on a phone).

- [ ] **Step 4: Commit**

```bash
npm run format:files -- docs/plugins.md docs/superpowers/specs/2026-11-17-office-lobby-todo-design.md
git add docs/plugins.md docs/superpowers/specs/2026-11-17-office-lobby-todo-design.md
git commit -m "docs(office): the lobby board's to-do list"
```

## Order and parallel work

- Task 1 first: every other task imports its contracts.
- After Task 1, Tasks 2, 3 and 4 touch separate files and can be built in parallel.
- Task 5 needs Task 4. Task 6 needs Task 4 and can be built in parallel with Task 5.
- Task 7 last.
