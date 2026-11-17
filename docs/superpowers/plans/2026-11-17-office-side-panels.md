# Office Sessions and Activity beside the floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two buttons in the office's header open upstream's Sessions and Activity panels in the side area, fed by Paseo's office state.

**Architecture:** The office adds two plugin screens, `office-sessions` and `office-activity`, and opens them with `navigation.showBeside({ kind: "screen", pluginId: "office", screenId })`. Each screen reads the office's state with `useOffice()`. A pure module derives feed events from each new state into one module-level store, shared by every subscription. A module-level channel (`office-link.ts`) lets a panel select an agent on the mounted office surface or open its session.

**Tech Stack:** TypeScript, React Native (react-native-web in a browser), vitest with jsdom for mounted tests, the plugin kit (`@getpaseo/plugin/client`, `@getpaseo/plugin/client/ui`).

**Spec:** `docs/superpowers/specs/2026-11-17-office-side-panels-design.md` (piece 3 of sub-project 7 of `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`). The side area it uses is sub-project 4, `docs/superpowers/specs/2026-11-17-office-one-page-design.md`, now on `main`.

## Global Constraints

- Work in your own worktree on branch `feat/office-side-panels`, made from `main`. Do not push. Do not write in any other worktree.
- Every subagent runs on Opus.
- No commit carries AI attribution: no `Co-Authored-By` trailer, no "Generated with" line.
- Run one test file at a time, from the repo root: `npx vitest run <file> --bail=1`. Never run a whole suite.
- After each task's code: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, then `npm run lint -- <changed .ts/.tsx files>`, then `npm run format:files -- <changed files>`.
- No change under `packages/`. The side area is used as built.
- Never restart or touch the daemon on port 6767. No real agent is created or prompted.
- Snippets are in `text` fences on purpose, so the formatter leaves them as they are.

Binding values from the spec:

- Screens: `office-sessions` titled `Sessions`, `office-activity` titled `Activity`. No sidebar or Command Center item for them.
- Header buttons, after the view switch: Sessions (Lucide `Users`), Activity (Lucide `Activity`), each with its title as `accessibilityLabel`. Shown on all three views. Hidden when `navigation?.showBeside` is absent. No pressed state.
- A press calls `showBeside({ kind: "screen", pluginId: "office", screenId })`.
- A row or card press selects the agent on the office surface (its card opens; in 3D the camera flies to it). "Open session" calls the surface's `openSession`, which replaces the panel with the session. With no surface registered, both call `navigation.openAgent({ agentId })`.
- Sessions: piece 1's tabs and search (`LIST_TABS`, `tabOf`, `tabCounts`, `matchesQuery`, `SEARCH_LABEL`, `NO_MATCH` from `client/list-text.ts`), one list across rooms. A row: dot, title, the room's name under it, the "doing now" line for a running agent, else the state's word (`stateLabel`). Order: Needs you, Working, Resting; within each, newest change first. Sub-agents indented under their parent. Empty: `No agents yet.`; with a filter: `No agent matches.`
- Activity events, from consecutive states: a new step key (`doing[agentId].key` changed: the line names `step.kind`), started working (to `running`), finished (`running` to `idle`), needs permission (a permission id not seen before), stopped on an error (to `error`), a sub-agent started (a new agent with `parentAgentId`).
- The feed keeps the newest 300 events, deduplicated by `agentId` + event key, from the first state of this app run. Not saved.
- Top: a `Live` tag while the subscription's status is live; tabs `All` and `Needs you` (with its count); chips `Commands`, `Edits`, `Reads`, `Web`, `Agents`, any number on, none means all.
- Chip kinds: Commands = `command`, `test`, `commit`, `push`, `deploy`; Edits = `edit`, `write`; Reads = `read`, `search`, `skill`; Web = `web`, `tool`; Agents = `subagent`, `plan` and the sub-agent-started event. Status events show under All only.
- Grouping: consecutive events of one agent within 4 minutes share a card: dot, title, `Working` while it runs, the first event's time (`HH:MM`), up to 4 lines, `+N more`. Needs permission and stopped on an error stand alone with `Open session`.
- Empty feed: `Nothing yet since the office opened.`
- The feed never names a file, a command or a prompt.
- Both panels use `layout.compact: true`, the office's styles, light and dark.

Decided in this plan, where the spec left it open:

- Event words, in `activity-feed-text.ts`: `Started working`, `Finished`, `Needs permission: <permission title>`, `Stopped on an error`, `Started <sub-agent title>`, and for a step `Reading`, `Searching`, `Using a skill`, `Editing`, `Writing`, `Running a command`, `Searching the web`, `Using a tool`, `Starting a sub-agent`, `Updating the plan`, `Running tests`, `Committing`, `Pushing`, `Deploying`, and for a step with `result: "failed"` the same verb plus ` failed`.
- The permission's title is the office's own short title (`OfficePermission.title`), as the agent card shows it; it is not a command.
- `office-link.ts` holds one registration: the last surface to mount wins, and its unmount clears it only if it is still the one registered.
- The feed store is a plain module with `subscribe`/`getSnapshot` for `useSyncExternalStore`.

## Files shared with other branches

`feat/office-incidents` was merged into `main` at `d58c6f6ee`, after this plan's spec was written. Its changes are in your base. Where the table names it, it marks code of the incidents work in the same file: keep your change away from it.

| File                                       | Also edited by                                                                       | How to keep the merge small                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `plugins/office/client/office-surface.tsx` | `feat/office-incidents` (its card and banner); piece 1 (one line on `StructureView`) | Two changes only: the two buttons as children after `ViewSwitch`, and one `useOfficeLink(...)` call beside `openSession`. |
| `plugins/office/client/use-office.ts`      | none                                                                                 | One call into the feed store in `onEvent`.                                                                                |
| `plugins/office/index.client.tsx`          | none                                                                                 | Two `addScreen` lines.                                                                                                    |
| `plugins/office/client/styles.ts`          | piece 1 (its `list*` block)                                                          | One block named `panel*` at the end.                                                                                      |
| `plugins/office/client/list-text.ts`       | piece 1 creates it                                                                   | Imported, never edited.                                                                                                   |
| `docs/plugins.md`                          | piece 1                                                                              | One sentence on its own line in the office's section.                                                                     |

Not touched by this plan: `contracts.ts`, `hub.ts`, `index.server.ts`, `paseo-entry.js`, `import-upstream.mjs`, `MANIFEST.json`. Piece 2 edits none of this plan's files.

## Review Focus

1. **The office closed while a panel stays open on its own route.** The panel's rows open the workspace instead of failing silently. Pinned in Task 2.
2. **Two subscriptions (surface and panel) seeing the same state.** The feed has one event, not two. Pinned in Task 1.
3. **The first snapshot.** It records the state and makes no events, so opening the office does not fill the feed with "Started working" for everyone. Pinned in Task 1.
4. **An agent that leaves while its card is in the feed.** The card keeps its last title and its press opens the workspace or does nothing harmful. Pinned in Task 1 (the event keeps the title) and Task 2.
5. **A surface remount (switching 3D and List) while a panel is open.** The link points at the new surface. Pinned in Task 2.

---

### Task 1: The feed's events, pure, and its store

**Files:**

- Create: `plugins/office/client/activity-feed.ts`, `plugins/office/client/activity-feed-text.ts`
- Modify: `plugins/office/client/use-office.ts` (one call in `onEvent`)
- Test: `plugins/office/client/activity-feed.test.ts`, `plugins/office/client/activity-feed-text.test.ts`

**Interfaces:**

- Produces:
  - `interface FeedEvent { id: string; agentId: string; title: string; at: number; kind: FeedKind; alert: boolean; text: string }` where `FeedKind = ActivityKind | "started" | "finished" | "permission" | "error" | "subagent-started"`.
  - `feedEvents(before: OfficeSnapshot | null, after: OfficeSnapshot, now: number): FeedEvent[]` (empty when `before` is null).
  - `type FeedChip = "cmd" | "edit" | "read" | "web" | "agent"`; `chipOf(kind: FeedKind): FeedChip | null`.
  - `interface FeedCard { agentId: string; title: string; at: number; lines: string[]; more: number; alert: boolean }`; `feedCards(events: readonly FeedEvent[], tab: "all" | "attention", chips: ReadonlySet<FeedChip>): FeedCard[]` (newest first; within 4 minutes grouped).
  - `feedStore`: `push(events: FeedEvent[])`, `subscribe(fn: () => void): () => void`, `getSnapshot(): readonly FeedEvent[]`, `reset()` (tests only). Cap 300, deduplicated by `id`.
  - `recordOfficeState(state: OfficeSnapshot, now?: number): void`: keeps the last state per caller key, derives, pushes. `use-office.ts` calls it after each `applyOfficeEvent`.
  - In `activity-feed-text.ts`: `eventText(kind, extra?: { title?: string; failed?: boolean }): string`, and `FEED_EMPTY = "Nothing yet since the office opened."`.

- [ ] **Step 1: Write the failing tests**

```text
test("the first state makes no events", () => expect(feedEvents(null, s({ ali: "running" }), t0)).toEqual([]));
test("a new step key is one event named for its kind", () => {
  const e = feedEvents(s({ ali: "running" }, { ali: { kind: "edit", key: "k1" } }), s({ ali: "running" }, { ali: { kind: "edit", key: "k2" } }), t0);
  expect(e.map((x) => x.text)).toEqual(["Editing"]);
});
test("a failed test run says so", ...);  // { kind: "test", key, result: "failed" } -> "Running tests failed"
test("status changes: started, finished, error", ...);
test("a new permission is an alert with its title", ...);
test("a new sub-agent is an event of its parent's kind Agents", ...);
test("the store keeps one of each event and the newest 300", () => {
  feedStore.push(events); feedStore.push(events);
  expect(feedStore.getSnapshot()).toHaveLength(events.length);
  feedStore.push(range(400)); expect(feedStore.getSnapshot()).toHaveLength(300);
});
test("two subscriptions recording the same state push it once", ...);
test("an event keeps the agent's title after the agent leaves", ...);
test("cards group one agent within four minutes and show four lines and +N more", ...);
test("alerts stand alone", ...);
test("the Needs you tab and the chips filter", ...);
test("no event text names a file, a command or a prompt", ...);  // every eventText output is from the fixed word list
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run plugins/office/client/activity-feed.test.ts --bail=1`
Expected: FAIL.

- [ ] **Step 3: Write the two modules and the call in `use-office.ts`.** An event's `id` is `${agentId}:${what}` where `what` is the step key, the permission id, or `${status}@${updatedAt ?? idleSince ?? at}`. Dedup by id makes two subscriptions safe.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run plugins/office/client/activity-feed.test.ts --bail=1`, then `npx vitest run plugins/office/client/activity-feed-text.test.ts --bail=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/client/activity-feed.ts plugins/office/client/activity-feed-text.ts plugins/office/client/activity-feed.test.ts plugins/office/client/activity-feed-text.test.ts plugins/office/client/use-office.ts
git commit -m "feat(office): derive an activity feed from the office's state"
```

### Task 2: The link and the header buttons

**Files:**

- Create: `plugins/office/client/office-link.ts`
- Modify: `plugins/office/client/office-surface.tsx` (the two buttons, the `useOfficeLink` call)
- Modify: `plugins/office/index.client.tsx` (two `addScreen` lines, each with a placeholder component until Tasks 3 and 4)
- Test: `plugins/office/client/office-link.test.ts`, `plugins/office/client/office-surface-panels.mounted.test.tsx`

**Interfaces:**

- Produces:
  - `interface OfficeLink { select(agentId: string): void; openSession(agentId: string): void }`
  - `useOfficeLink(link: OfficeLink): void` (registers on mount, clears on unmount if still registered).
  - `linkSelect(agentId: string, navigation: Navigation): void` and `linkOpenSession(agentId: string, navigation: Navigation): void`: call the registered surface, else `navigation?.openAgent({ agentId })`.
  - `const SESSIONS_SCREEN = "office-sessions"`, `const ACTIVITY_SCREEN = "office-activity"`.
- The surface's `select` is its `setSelectedId`; its `openSession` is today's `openSession` (`openSessionWith`).

- [ ] **Step 1: Write the failing tests**

```text
test("a panel selects on the registered surface", ...);
test("with no surface, a row opens the agent's workspace", () => {
  linkSelect("a1", nav); expect(nav.openAgent).toHaveBeenCalledWith({ agentId: "a1" });
});
test("the last surface to mount wins; an old surface's unmount leaves the new one", ...);
// mounted:
test("the header has Sessions and Activity when the side area exists, and they open their screens", () => {
  press("Sessions"); expect(showBeside).toHaveBeenCalledWith({ kind: "screen", pluginId: "office", screenId: "office-sessions" });
});
test("without showBeside the buttons are not there", ...);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run plugins/office/client/office-link.test.ts --bail=1`
Expected: FAIL.

- [ ] **Step 3: Write `office-link.ts`, the buttons and the screens' registration.** The buttons use the same pressable style as `ViewSwitch`'s segments and the kit's `Icon`. Check in the running app (Task 5) that the panel and the surface see one `office-link` module; Task 2's tests can only show it within one bundle. If they do not share it, stop and report before Task 3.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run plugins/office/client/office-link.test.ts --bail=1`, then `npx vitest run plugins/office/client/office-surface-panels.mounted.test.tsx --bail=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/client/office-link.ts plugins/office/client/office-link.test.ts plugins/office/client/office-surface.tsx plugins/office/client/office-surface-panels.mounted.test.tsx plugins/office/index.client.tsx
git commit -m "feat(office): Sessions and Activity buttons open their panels beside the floor"
```

### Task 3: The Activity panel

**Files:**

- Create: `plugins/office/client/activity-panel.tsx`
- Modify: `plugins/office/index.client.tsx` (the Activity screen's component), `plugins/office/client/styles.ts` (`panel*` block)
- Test: `plugins/office/client/activity-panel.mounted.test.tsx`

**Interfaces:**

- Consumes: Task 1's `feedStore`, `feedCards`, `FEED_EMPTY`; Task 2's `linkSelect`, `linkOpenSession`; `useOffice`.
- Produces: `ActivityPanel(props: PluginScreenProps)`.

- [ ] **Step 1: Write the failing mounted tests**

```text
test("empty: Nothing yet since the office opened.", ...);
test("cards with their lines and +N more; a press selects the agent", ...);
test("an alert card has Open session", ...);
test("Needs you and the chips filter the cards", ...);
test("the Live tag shows while the subscription is live", ...);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run plugins/office/client/activity-panel.mounted.test.tsx --bail=1`
Expected: FAIL.

- [ ] **Step 3: Write the panel.** `useSyncExternalStore(feedStore.subscribe, feedStore.getSnapshot)`. The tab and chips in component state. Times as `HH:MM` local.

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run plugins/office/client/activity-panel.mounted.test.tsx --bail=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/client/activity-panel.tsx plugins/office/client/activity-panel.mounted.test.tsx plugins/office/index.client.tsx plugins/office/client/styles.ts
git commit -m "feat(office): upstream's Activity panel, fed by the office's state"
```

### Task 4: The Sessions panel

Starts once piece 1's `client/list-text.ts` is on `main`: merge `main` in first.

**Files:**

- Create: `plugins/office/client/sessions-panel.tsx`, `plugins/office/client/sessions-text.ts`
- Modify: `plugins/office/index.client.tsx` (the Sessions screen's component), `plugins/office/client/styles.ts`
- Test: `plugins/office/client/sessions-text.test.ts`, `plugins/office/client/sessions-panel.mounted.test.tsx`

**Interfaces:**

- Consumes: `LIST_TABS`, `tabOf`, `tabCounts`, `matchesQuery`, `SEARCH_LABEL`, `NO_MATCH` from `list-text.ts`; `buildOfficeModel`; Task 2's link.
- Produces: `sessionRows(model: OfficeModel, tab: ListTab, query: string): { row: OfficeRow; room: OfficeRoom }[]` in `sessions-text.ts` (ordered: tab group, then newest change first: `idleSince` or `promptedAt` or `createdAt`, sub-agents right after their parent); `SessionsPanel(props: PluginScreenProps)`; `NO_AGENTS = "No agents yet."`.

- [ ] **Step 1: Write the failing tests**

```text
test("Needs you, then Working, then Resting, newest first, sub-agents under their parent", ...);
test("the tab and the search filter across rooms", ...);
// mounted:
test("a row shows the room's name and the doing-now line; a press selects", ...);
test("No agents yet. and No agent matches.", ...);
```

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run plugins/office/client/sessions-text.test.ts --bail=1`
Expected: FAIL.

- [ ] **Step 3: Write `sessions-text.ts` and the panel.**

- [ ] **Step 4: Run them to see them pass**

Run: `npx vitest run plugins/office/client/sessions-text.test.ts --bail=1`, then `npx vitest run plugins/office/client/sessions-panel.mounted.test.tsx --bail=1`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add plugins/office/client/sessions-panel.tsx plugins/office/client/sessions-text.ts plugins/office/client/sessions-text.test.ts plugins/office/client/sessions-panel.mounted.test.tsx plugins/office/index.client.tsx plugins/office/client/styles.ts
git commit -m "feat(office): upstream's Sessions panel beside the floor"
```

### Task 5: Live check and docs

**Files:**

- Modify: `docs/plugins.md` (one sentence on the panels)
- Modify: `docs/superpowers/specs/2026-11-17-office-side-panels-design.md` ("Not verified", Status to built; the Dependencies section now says the side area is on `main`)
- Modify: `docs/superpowers/specs/2026-11-16-office-owner-review-design.md` (Status: piece 3 built)

- [ ] **Step 1: Look at it.** Start a dev daemon of this worktree (`npm run dev`, never port 6767) with the office's fixtures. On the office screen and the office panel, at 1280 px and 390 px, light and dark: both buttons, both panels, a row press selecting the agent on the floor, "Open session" replacing the panel, "Open Sessions" in the area's header opening the full route, and the buttons hidden on a build without the side area (a mounted check is enough there). Confirm the panel and the surface share `office-link`.

- [ ] **Step 2: Write what was seen and what was not** in the spec's "Not verified".

- [ ] **Step 3: Format and commit**

```bash
git add docs/plugins.md docs/superpowers/specs/2026-11-17-office-side-panels-design.md docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git commit -m "docs(office): Sessions and Activity beside the floor are built"
```

## Order

Tasks 1 and 2 can run in parallel. Task 3 needs both. Task 4 needs Task 2 and piece 1's Task 2 on `main`. Task 5 is last.
