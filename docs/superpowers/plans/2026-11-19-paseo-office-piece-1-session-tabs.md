# paseo-office piece 1: session tabs and New agent Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A session opens as a tab of the office's column in every app, with the conversation, a reply box, permission answers and Stop; and an agent can be started from the Sessions tab.

**Architecture:** The column's state gains a list of open sessions beside its four fixed tabs. A pure model turns an agent's timeline items into conversation rows; a hook reads the latest page through the SDK's timeline handle, follows live events, and loads earlier pages. A session panel draws rows, the pending permissions and a composer, reusing the actions the agent card already has. New agent is a form in the Sessions tab over the SDK's `workspaces.list`, `providers.snapshot` and `agents.create`.

**Tech Stack:** TypeScript and React Native in a Paseo plugin (`/workspace/QFlavours/paseo-office`), `@getpaseo/plugin` 0.16.2 and its `@getpaseo/client` types, Vitest with jsdom.

**Spec:** `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-paseo-office-roadmap-design.md` (piece 1), which points at `/workspace/QFlavours/paseo-onepage-docs/docs/superpowers/specs/2026-11-18-office-own-column-design.md` ("A session tab", "New agent", "Working in every app", "Errors").

## Global Constraints

- Work in `/workspace/QFlavours/paseo-office` on a branch `feat/session-tabs` cut from `main`. The repo is public: nothing private in files, fixtures or commit messages (fixtures use "Acme", `SHOP-…`, made-up paths); no AI attribution on commits; never push, never `gh` (the controller publishes).
- Only calls stock Paseo 0.16's SDK has. Stopping a turn is `extra(ref, "cancel")` from `shared/host-extras.ts`: offered only where the host has it.
- App-side code (`client/`, `shared/`) uses nothing a phone's engine lacks: `client/engine-compat.test.ts` must stay green. No `toSorted`, `toReversed`, `findLast`, `at()` is fine.
- Cross-platform: no `onPointerEnter`/`onPointerLeave`; DOM only when `layout.platform === "web"`; hover controls always visible on touch.
- Styles in `client/styles.ts`, never inline objects. `OfficeSurface` stays under the lint complexity limit of 20: new logic goes in hooks and small components, in their own files.
- The conversation shows the owner's messages and the agent's replies as text and a tool call as one line. It never shows reasoning. Not included: attachments, images, slash commands, drafts kept across reloads, changing the model or mode, sub-agent tracks, file links that open panes.
- Open session tabs and the chosen tab last while the surface is mounted, not across a reload.
- Never run a bare `paseo` command and never start, stop or restart the daemon on port 6767. A throwaway daemon uses `PASEO_HOME=/tmp/office-stock-home`, port 6798, `env -i`, and the CLI at `/tmp/paseo-stock/node_modules/.bin/paseo`.
- Checks after each task: `npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts`, and the test files touched; the whole suite (`npm test -- --maxWorkers=4`, output to a file under /tmp) before each commit.

---

### Task 1: Conversation rows from timeline items

**Files:**

- Create: `client/conversation-model.ts`
- Test: `client/conversation-model.test.ts`

**Interfaces:**

- Consumes: `AgentTimelineItem` from `@getpaseo/protocol` (read its exact shape in `node_modules/@getpaseo/protocol/dist/agent-types.d.ts`: `user_message`, `assistant_message`, `reasoning`, tool call, `todo`, `error`, `notification`, compaction, plugin item).
- Produces:

```ts
export type ConversationRow =
  | { kind: "you"; key: string; text: string }
  | { kind: "agent"; key: string; text: string }
  | { kind: "tool"; key: string; text: string }
  | { kind: "notice"; key: string; text: string; tone: "muted" | "danger" };

/** One timeline entry as the hook keeps it: the item and the sequence number it arrived with. */
export interface TimelineEntry {
  seq: number;
  item: AgentTimelineItem;
}

export function conversationRows(entries: readonly TimelineEntry[]): ConversationRow[];
/** A tool call as one line: its name and a short summary, never its input or output in full. */
export function toolLine(item: Extract<AgentTimelineItem, { type: "tool_call" }>): string;
```

- [ ] **Step 1: Write the failing tests**

Cover, with entries built from the protocol's real types (no casts to `any`):

- A `user_message` is a `you` row with its text; an `assistant_message` an `agent` row.
- Consecutive `assistant_message` entries with the same `messageId` are one `agent` row whose text is theirs joined in order (streamed text arrives in pieces); a different or absent `messageId` starts a new row.
- `reasoning` gives no row.
- A tool call gives one `tool` row: the tool's name and a summary no longer than 120 characters, with no line break. Read the tool call item's fields (`name`, a status, a detail or summary field) and build the line from what is there; a call that failed says so.
- `todo`, compaction and plugin items give no row.
- `error` is a `notice` row with tone `danger`; a `notification` is a `notice` whose tone follows its level (`error` is `danger`, the others `muted`).
- Empty text gives no row. Rows keep the entries' order. Each row's `key` is stable and unique across a list (from `seq`, and the first `seq` of a joined run).

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/conversation-model.test.ts`
Expected: FAIL, cannot find `./conversation-model.js`.

- [ ] **Step 3: Write the model**

Pure functions, no React. Keep `conversationRows` one pass over the entries. `toolLine` trims and cuts with an ellipsis at 120 characters. Doc comments say what a row is for, and that reasoning is left out on purpose.

- [ ] **Step 4: Run, check, commit**

```bash
npx vitest run client/conversation-model.test.ts
npx vitest run client/engine-compat.test.ts
npm run format:check && npm run lint && npm run typecheck
git add -A && git commit -m "feat: an agent's timeline as conversation rows"
```

---

### Task 2: Reading and following a conversation

**Files:**

- Create: `client/use-conversation.ts`
- Test: `client/use-conversation.mounted.test.tsx`

**Interfaces:**

- Consumes: `usePaseo()` from `@getpaseo/plugin/client`; `paseo.agents.ref(agentId).timeline` with `refetch(options)` and `subscribe(handler)` (read `PaseoAgentTimelineHandle`, `PaseoAgentTimelineRefetchOptions`, `FetchAgentTimelinePayload`, `PaseoAgentTimelineEvent` and `PaseoAgentTimelineSubscription` in `node_modules/@getpaseo/client/dist/index.d.ts` and `daemon-client.d.ts`); Task 1's `TimelineEntry`, `conversationRows`.
- Produces:

```ts
export interface Conversation {
  rows: ConversationRow[];
  /** "loading" until the first page arrived; "error" when it could not be read. */
  status: "loading" | "ready" | "error";
  error: string | null;
  /** True while there are earlier entries not loaded yet. */
  hasEarlier: boolean;
  loadingEarlier: boolean;
  loadEarlier(): void;
  retry(): void;
}
export function useConversation(agentId: string): Conversation;
```

- [ ] **Step 1: Write the failing mounted tests**

With a fake `usePaseo` whose timeline handle records calls and lets the test push events (as the repo's other mounted tests stand in for the host; see `client/use-agent-actions.mounted.test.tsx` and `client/office-surface-panels.mounted.test.tsx`):

- On mount it subscribes first and then asks for the latest page (`direction: "tail"`, a limit of 60, whole turns): the rows are the page's.
- A live timeline event appends its item; the same sequence number arriving twice is kept once.
- A `subscription_restored` or a `replacement` event makes it read the latest page again and replace what it holds.
- `loadEarlier` asks for the page before the earliest entry held (`direction: "before"` with that cursor) and puts it in front; `hasEarlier` follows what the page says; a second call while one is in flight asks nothing.
- A failed first read gives `status: "error"` with the failure as one sentence (`failureText` from `client/action-button.tsx`); `retry` reads again.
- Unmount unsubscribes, and a page that arrives afterwards sets nothing.
- Changing `agentId` drops the old rows and starts again for the new agent.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/use-conversation.mounted.test.tsx`
Expected: FAIL, cannot find `./use-conversation.js`.

- [ ] **Step 3: Write the hook**

Entries are kept in a ref-backed list ordered by `seq`, with rows derived by `useMemo`. Read the payload's own fields for the entries, the cursor and whether earlier entries exist; do not guess a shape. Await the subscription's `ready` before the first read, as the handle's doc comment says, so nothing between the read and the subscription is missed. Every async step checks that the hook is still mounted and still for the same `agentId`.

- [ ] **Step 4: Run, check, commit**

```bash
npx vitest run client/use-conversation.mounted.test.tsx
npm run format:check && npm run lint && npm run typecheck
git add -A && git commit -m "feat: a conversation is read, followed live and paged back"
```

---

### Task 3: Session tabs in the column

**Files:**

- Modify: `client/column-model.ts`, `client/use-column.ts`, `client/office-column.tsx`, `client/column-sheet.tsx`, `client/styles.ts`
- Tests: `client/column-model.test.ts`, `client/office-column.mounted.test.tsx`, `client/column-sheet.mounted.test.tsx`

**Interfaces:**

- Produces, in `client/column-model.ts`:

```ts
/** What the column shows: one of its fixed tabs, or an open session. */
export type ColumnView = { kind: "tab"; tab: ColumnTab } | { kind: "session"; agentId: string };

export interface SessionTabs {
  /** Open sessions, in the order they were opened. */
  open: readonly string[];
  view: ColumnView;
}
export const NO_SESSIONS: SessionTabs;
/** Opens the agent's session, or selects its tab when it is open already. */
export function openSession(tabs: SessionTabs, agentId: string): SessionTabs;
/** Closes it. When it was showing, the tab to its left shows: a session, or Sessions. */
export function closeSession(tabs: SessionTabs, agentId: string): SessionTabs;
export function showTab(tabs: SessionTabs, tab: ColumnTab): SessionTabs;
/** Drops sessions whose agent is gone from `known`; the view moves as `closeSession` moves it. */
export function keepKnown(tabs: SessionTabs, known: ReadonlySet<string>): SessionTabs;
```

- `ColumnState` (`client/use-column.ts`) replaces `tab: ColumnTab` with `view: ColumnView` and gains `sessions: readonly string[]`, `openSession(agentId)`, `closeSession(agentId)`; `show(tab)` keeps its meaning. Opening a session opens a collapsed column, as `show` does.
- `ColumnTabs` takes `sessions: readonly { agentId: string; title: string; tone: DotTone }[]`, `view`, `onSession(agentId)`, `onClose(agentId)`.

- [ ] **Step 1: Write the failing model tests**

```ts
// added to client/column-model.test.ts
import { NO_SESSIONS, closeSession, keepKnown, openSession, showTab } from "./column-model.js";

const view = (agentId: string) => ({ kind: "session" as const, agentId });

test("the column starts on Sessions with no session open", () => {
  expect(NO_SESSIONS).toEqual({ open: [], view: { kind: "tab", tab: "sessions" } });
});

test("opening a session adds its tab at the end and shows it", () => {
  const one = openSession(NO_SESSIONS, "a");
  const two = openSession(one, "b");
  expect(two).toEqual({ open: ["a", "b"], view: view("b") });
});

test("opening a session that is open selects its tab and keeps the order", () => {
  const tabs = openSession(openSession(openSession(NO_SESSIONS, "a"), "b"), "a");
  expect(tabs).toEqual({ open: ["a", "b"], view: view("a") });
});

test("closing the shown session shows the one to its left, or Sessions", () => {
  const two = openSession(openSession(NO_SESSIONS, "a"), "b");
  expect(closeSession(two, "b")).toEqual({ open: ["a"], view: view("a") });
  expect(closeSession(closeSession(two, "b"), "a")).toEqual(NO_SESSIONS);
});

test("closing the first of several shown sessions shows the next one", () => {
  const two = openSession(openSession(NO_SESSIONS, "a"), "b");
  const onFirst = openSession(two, "a");
  expect(closeSession(onFirst, "a")).toEqual({ open: ["b"], view: view("b") });
});

test("closing a session that is not shown leaves the view", () => {
  const two = openSession(openSession(NO_SESSIONS, "a"), "b");
  expect(closeSession(two, "a")).toEqual({ open: ["b"], view: view("b") });
  expect(closeSession(two, "zz")).toBe(two);
});

test("a fixed tab shows without closing any session", () => {
  const one = openSession(NO_SESSIONS, "a");
  expect(showTab(one, "chat")).toEqual({ open: ["a"], view: { kind: "tab", tab: "chat" } });
});

test("a session whose agent is gone is dropped", () => {
  const two = openSession(openSession(NO_SESSIONS, "a"), "b");
  expect(keepKnown(two, new Set(["a"]))).toEqual({ open: ["a"], view: view("a") });
  expect(keepKnown(two, new Set(["a", "b"]))).toBe(two);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run client/column-model.test.ts`
Expected: FAIL, `openSession` is not exported.

- [ ] **Step 3: Write the model functions**

Pure, returning the same object when nothing changes (the tests use `toBe` for that). `closeSession` of the shown session picks the tab to its left in `open`; when it was first, the one that takes its place; when none is left, `{ kind: "tab", tab: "sessions" }`.

- [ ] **Step 4: The column's state and tabs**

- `use-column.ts`: hold `SessionTabs` in one `useState`, expose `view`, `sessions`, `show`, `openSession`, `closeSession`. Width and collapsed stay the device setting, unchanged.
- `office-column.tsx`: after the four fixed tabs, one tab per open session: its status dot (`styles.dot[tone]`), its title cut to fit (`numberOfLines={1}`, a max width in styles), and a close button inside the tab (`accessibilityLabel` "Close <title>"), always visible on touch and on hover or when chosen with a pointer. Role `tab`, `aria-selected`. With many sessions the tab row scrolls sideways (a horizontal `ScrollView` from the kit) rather than wrapping. The collapsed rail shows the fixed tabs' icons and a count of open sessions.
- `column-sheet.tsx`: the phone's bar keeps the four fixed tabs. An open session shows in the sheet, whose header carries the session's title, a way back to Sessions, and Close. With sessions open, the bar's Sessions tab carries their count.
- Mounted tests for each: opening shows the session tab chosen; pressing a fixed tab leaves the session tab there; Close removes it and shows the tab to its left; the rail's count; the sheet's header for a session.

- [ ] **Step 5: Run, check, commit**

```bash
npx vitest run client/column-model.test.ts
npx vitest run client/office-column.mounted.test.tsx
npx vitest run client/column-sheet.mounted.test.tsx
npm run format:check && npm run lint && npm run typecheck
git add -A && git commit -m "feat: the column keeps open sessions as tabs"
```

---

### Task 4: The session panel

**Files:**

- Create: `client/session-panel.tsx`, `client/session-text.ts`
- Tests: `client/session-panel.mounted.test.tsx`, `client/session-text.test.ts`
- Modify: `client/styles.ts`

**Interfaces:**

- Consumes: `useConversation` (Task 2); `AgentActions` from `client/use-agent-actions.ts` (`send`, `respond`, `cancel` which is null where the host cannot stop a turn); `PermissionActions` from `client/permission-actions.tsx`; the office's agent model (`shared/model.ts`: the agent's title, status, pending permissions, room).
- Produces:

```ts
export interface SessionPanelProps {
  /** Null once the agent has left the office: the panel says so and offers Close. */
  agent: OfficeAgent | null;
  agentId: string;
  /** The room's name, for the header. */
  room: string | null;
  actions: AgentActions;
  styles: OfficeStyles;
  theme: PluginTheme;
  layout: PluginSurfaceProps["layout"];
  /** Leaves the office for the agent's workspace; absent where the host cannot. */
  onOpenWorkspace: (() => void) | undefined;
  onClose(): void;
}
export function SessionPanel(props: SessionPanelProps): ReactNode;
```

- [ ] **Step 1: Write the failing tests**

`session-text.test.ts` (pure): the header's status line from the agent's status (reuse `stateLabel` from `client/agent-card.tsx`); the composer's placeholder for an agent at work ("Add to the running turn") and at rest ("Message <name>"); the line for an agent that is gone.

`session-panel.mounted.test.tsx`, with `useConversation` stood in:

- The header shows the agent's title, its room and its status; "Open in workspace" calls `onOpenWorkspace` and is not drawn when it is absent; Close calls `onClose`.
- Rows draw in order; a `you` row and an `agent` row are told apart by a screen reader (their accessible names start "You:" and "<agent>:"); a tool row is one line.
- While loading: "Loading…". On error: the sentence and a Retry that calls `retry`.
- With earlier entries: a "Show earlier" control at the top calls `loadEarlier`, and it is disabled while a page loads.
- A pending permission draws Allow and Deny (through `PermissionActions`) above the composer, and a press calls `actions.respond` with the request's id.
- Send calls `actions.send(agentId, text)` with the trimmed text and clears the box; empty text sends nothing; a failed send shows its reason under the box and keeps the text.
- Stop is drawn only while the agent is running and `actions.cancel` is not null; a press calls it.
- With `agent` null: the panel says the agent has left the office and offers Close; no composer.
- On a touch screen Send is a button; with a keyboard, Enter sends and Shift+Enter makes a new line (as `client/chat-panel.tsx` decides with `hasTouchScreen`).

- [ ] **Step 2: Run them and see them fail**

Run each file; expected: FAIL, modules missing.

- [ ] **Step 3: Write the panel**

One file for the panel, small inner components for the header, a row and the composer. The list is a `ScrollView` that stays at the bottom while the reader is there, as `chat-panel.tsx` does (reuse its approach; do not copy its code into a third place if a small shared helper can be lifted without changing the chat's behaviour: if lifting it is not small, say so and keep two copies). Text is selectable. Long agent replies are plain text: no Markdown rendering in this piece.

- [ ] **Step 4: Run, check, commit**

```bash
npx vitest run client/session-text.test.ts
npx vitest run client/session-panel.mounted.test.tsx
npm run format:check && npm run lint && npm run typecheck
git add -A && git commit -m "feat: a session's conversation, permissions and reply in the column"
```

---

### Task 5: "Open session" stays in the office

**Files:**

- Modify: `client/office-surface.tsx`, `client/beside.ts`, `client/agent-card.tsx` (only if its "Open session" needs a new callback), `docs/office.md`, `README.md`
- Tests: `client/office-surface-panels.mounted.test.tsx`, `client/beside.test.ts`

**Interfaces:**

- Consumes: Tasks 3 and 4.
- Produces: one `openSession(agentId)` in the surface that every way in calls.

- [ ] **Step 1: Change the surface's tests first**

- Wide: "Open session" on the agent card opens a session tab in the column, chosen, and `navigation.openAgent` is not called; the column opens when it was collapsed.
- A Sessions row press still opens the agent's card; the card's "Open session" then opens the tab. An Activity card's "Open session", an Attention entry's, the List's "Answer in the session", and the scene's open-session callback (`onOpenSession` of the 3D view, which walk-in's E uses) all open the tab.
- Compact: the same press opens the sheet on the session.
- The session panel's "Open in workspace" calls `navigation.openAgent` once.
- An agent that leaves the office while its tab is open: the tab stays and says so; closing it removes it. (The tab is dropped only by Close, so a blip in the list does not lose a conversation being read: `keepKnown` is not used for this. Remove `keepKnown` from Task 3's model if nothing else needs it, and say so.)
- With `navigation` absent the tab still opens (the conversation needs only the SDK); "Open in workspace" is not drawn.

- [ ] **Step 2: See them fail, then wire it**

`openSessionWith` in `client/beside.ts` loses its session path: it was the app's side area or the workspace. `resourcesOpener` stays. The surface's `link.openSession` and every `onOpenSession` prop call `column.openSession`; on a compact layout the sheet opens on it. `ColumnPanel` (or a sibling) draws `SessionPanel` for a session view, with the agent from the surface's model.

- [ ] **Step 3: Docs**

`README.md`: the "What it does" line about the column names sessions; the "What works where" row for stock Paseo 0.16 says what is true now (a session opens in the office everywhere; Stop needs a host that can stop a turn). `docs/office.md`: the column's section gains session tabs (what a tab shows, what it leaves out, that tabs last while the office is open). Integrate; do not append.

- [ ] **Step 4: Run, check, commit**

Run the surface's test file, `client/beside.test.ts`, the full chain and the whole suite, then:

```bash
git add -A && git commit -m "feat: a session opens in the office, in every app"
```

---

### Task 6: New agent

**Files:**

- Create: `client/new-agent-model.ts`, `client/new-agent-form.tsx`, `client/use-new-agent.ts`
- Tests: `client/new-agent-model.test.ts`, `client/new-agent-form.mounted.test.tsx`
- Modify: `shared/settings.ts` (the device setting gains the last choice), `client/sessions-panel.tsx`, `client/styles.ts`, `docs/office.md`, `README.md`

**Interfaces:**

- Consumes: `usePaseo()`: `workspaces.list`, `providers.snapshot` (or `waitForReady`), `agents.create` (read `PaseoWorkspaceListResult`, `PaseoWorkspace`, `PaseoProviderSnapshotResult`, `PaseoAgentCreateOptions` and `PaseoAgentConfig` in `node_modules/@getpaseo/client/dist/index.d.ts`).
- Produces:

```ts
export interface NewAgentChoice {
  workspaceId: string | null;
  provider: string | null;
  model: string | null;
  prompt: string;
}
/** Why Create is not offered yet; null when the form can be sent. */
export function newAgentProblem(choice: NewAgentChoice): string | null;
/** Workspaces grouped by project, each group and each list in name order, filtered by a search. */
export function workspaceGroups(
  workspaces: readonly WorkspaceOption[],
  query: string,
): WorkspaceGroup[];
/** The provider and model to start with: the last choice if it is still offered, else the first available provider and its default model. */
export function startingAgent(
  providers: readonly ProviderOption[],
  last: LastAgent | null,
): { provider: string | null; model: string | null };
```

- [ ] **Step 1: The model, test first**

Tests for the three functions: a missing workspace, provider, model or an empty prompt each name what is missing, in that order; grouping and search (by workspace and project name, case-insensitive); a last choice that is no longer offered falls back; no available provider gives nulls. Only providers that are available are options.

- [ ] **Step 2: The last choice is a device setting**

`officeDeviceSettings` (`shared/settings.ts`) gains an optional `lastAgent: { provider: string; model: string }`. Read how that setting's version and `migrate` were handled before and follow it: a new optional field must not make an older document invalid, and every existing saver of the device setting must carry the field through (the view's save writes the document whole: find each `save(` of this setting and keep `lastAgent`). Tests in `shared/settings.test.ts` and for each saver.

- [ ] **Step 3: The form, test first**

Mounted tests with the host stood in: the Sessions tab has a "New agent" button; it opens the form in the tab's place with Back; the workspaces list with its search; provider then model, pre-filled from the last choice; Create is disabled with the reason shown until the form is complete; Create calls `agents.create` with the workspace's folder as `cwd`, the provider and model as the config, and the prompt; on success the form closes, the last choice is saved, and `openSession` is called with the new agent's id; on failure the reason shows and everything typed stays; while it is being created the button says so and takes no second press; Back keeps what was typed for the next time the form opens while the office is mounted.

- [ ] **Step 4: Write the hook and the form**

`use-new-agent.ts` loads the workspaces and providers when the form opens (not when the office opens), holds the choice, and creates. `new-agent-form.tsx` draws it with the office's own controls (the text field and pills the settings page uses), not inline styles. A project's workspaces can be many: the list scrolls inside the form.

- [ ] **Step 5: Docs, run, check, commit**

`README.md` and `docs/office.md`: starting an agent from the office, and what stays in the app's own screen (a new project folder, a new worktree, attachments, modes). Then the full chain and the whole suite, and:

```bash
git add -A && git commit -m "feat: an agent is started from the office's Sessions tab"
```

---

### Task 7: A look, and what was seen

**Files:**

- Modify: `docs/verified.md`

- [ ] **Step 1: A stock daemon with the branch installed**

As `docs/verified.md` describes the earlier looks: a clean `/tmp/office-stock-home`, the published 0.16.2 daemon on port 6798 with a clean environment, the plugin installed by Git from the local repo at the branch's commit. `daemon status` must show 6798 and that home before any plugin command.

- [ ] **Step 2: Look, at 1280 and 390 px**

The throwaway daemon has no provider signed in, so no agent can run there. What can be seen: the "New agent" button and its form with no provider available (it must say so plainly, not fail); a workspace list if a workspace is added by opening a folder (do so with a scratch folder under /tmp); the column with no session open; the engine guard. What cannot be seen there, and is recorded as such: a conversation, a reply, a permission answer, Stop, a created agent. Those are looked at on the owner's host after the update, by the owner.

- [ ] **Step 3: Record and commit**

`docs/verified.md` gains this piece's look and its "not seen" list. Stop the daemon by its pid; confirm 6798 is closed and 6767 untouched. Commit `docs: what was seen of session tabs on a stock daemon`.

---

### After the tasks (controller, with the owner's go-ahead)

Final whole-branch review; fixes; merge to `main`; push; CI green; `paseo plugin update office --ref <commit>` on the owner's host; the owner looks on desktop and on the phone (a session from each way in, a reply, a permission answer, Stop, New agent); then tag `v0.2.0` and write its release notes.
