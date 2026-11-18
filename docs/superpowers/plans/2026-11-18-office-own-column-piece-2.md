# The office's own column Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The office draws its own column beside the floor, with Attention, Sessions, Activity and Chat tabs, and opens it as a sheet on a phone, so the three panels work in every app.

**Architecture:** `OfficeSurface` lays out the floor and a new `OfficeColumn` in one row (wide) or the floor with a bottom bar and a sheet (compact). The three panels stop being screens with their own subscription: they become components that take the surface's office state and a link of two callbacks. Width and collapsed are a device setting of their own, so no other saver of the device's settings can drop them.

**Tech Stack:** React Native components in a Paseo built-in plugin (`plugins/office`), `@getpaseo/plugin/client` hooks, `PanResponder` for the drag, Vitest with jsdom for mounted tests.

**Spec:** `docs/superpowers/specs/2026-11-18-office-own-column-design.md` (piece 2 of its "Pieces" table; sections "The page" and "The column's tabs").

## Global Constraints

- Work in `/workspace/QFlavours/paseo-onepage-docs` on branch `feat/office-column`. Every path below is relative to it.
- The owner runs upstream's desktop app, which loads this plugin from the host. Use only client calls upstream's `@getpaseo/plugin/client` has (compare with `git show upstream/main:packages/plugin/src/client/contracts.ts`). The office calls `navigation.showBeside` only for Resources (`resourcesOpener`), never for its own panels.
- Tabs, in this order: Attention, Sessions, Activity, Chat. Session tabs are piece 3: do not build them. "Open session" keeps calling `openSessionWith(navigation, agentId)` until then.
- Open tab and whether the sheet is open are kept while the surface is mounted, not across a reload. Width and collapsed are kept per device.
- Column width: least 280, most 560, default 360, and the floor keeps at least 320.
- Above the floor: nothing. The corner keeps the view switch and the settings button; the Sessions, Activity and Chat buttons leave it.
- Cross-platform rules from `CLAUDE.md`: no `onPointerEnter`/`onPointerLeave`; DOM APIs only when `layout.platform === "web"`; hover controls always visible on touch. Hover follows `docs/hover.md`.
- Styles go in `plugins/office/client/styles.ts`, never inline objects.
- Run one test file at a time: `cd plugins && npx vitest run <file> --bail=1`. Never the whole suite.
- After each task, from the repo root: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, `npm run lint -- <changed files>`, `npm run format:files -- <changed files>`.
- Commits carry no `Co-Authored-By` trailer and no "Generated with" line. Messages follow the fork's style: `feat(office): ...`, `refactor(office): ...`, `docs(office): ...`.

---

### Task 1: The column's setting and its arithmetic

**Files:**

- Modify: `plugins/office/shared/settings.ts` (append one setting)
- Create: `plugins/office/client/column-model.ts`
- Test: `plugins/office/client/column-model.test.ts`

**Interfaces:**

- Produces:
  - `officeColumnSettings` (`defineSettings`, id `"office-column"`, scope `"device"`, values `{ width: number; collapsed: boolean }`)
  - `type ColumnTab = "attention" | "sessions" | "activity" | "chat"`
  - `COLUMN_TABS: readonly { tab: ColumnTab; label: string; icon: string }[]`
  - `COLUMN_MIN = 280`, `COLUMN_MAX = 560`, `COLUMN_DEFAULT = 360`, `FLOOR_MIN = 320`
  - `clampColumn(width: number, surface: number): number`
  - `countLabel(count: number): string | null`

- [ ] **Step 1: Write the failing test**

```ts
// plugins/office/client/column-model.test.ts
import { expect, test } from "vitest";
import { officeColumnSettings } from "../shared/settings.js";
import { COLUMN_TABS, clampColumn, countLabel } from "./column-model.js";

test("the tabs are Attention, Sessions, Activity and Chat, in that order", () => {
  expect(COLUMN_TABS.map((each) => each.label)).toEqual([
    "Attention",
    "Sessions",
    "Activity",
    "Chat",
  ]);
});

test("a width is kept between the least and the most", () => {
  expect(clampColumn(100, 1280)).toBe(280);
  expect(clampColumn(400, 1280)).toBe(400);
  expect(clampColumn(900, 1280)).toBe(560);
});

test("the floor keeps its least width on a narrow surface", () => {
  // 700 wide: the floor's 320 leaves 380 for the column.
  expect(clampColumn(500, 700)).toBe(380);
  // Too narrow for both: the column is at its least and the floor gives way.
  expect(clampColumn(500, 500)).toBe(280);
});

test("a surface not measured yet leaves the width within the column's own limits", () => {
  expect(clampColumn(400, 0)).toBe(400);
  expect(clampColumn(900, 0)).toBe(560);
});

test("a count shows as a number, capped, and nothing at zero", () => {
  expect(countLabel(0)).toBeNull();
  expect(countLabel(3)).toBe("3");
  expect(countLabel(120)).toBe("99+");
});

test("a device that never set the column has it open at the default width", () => {
  expect(officeColumnSettings.schema.parse({})).toEqual({ width: 360, collapsed: false });
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd plugins && npx vitest run office/client/column-model.test.ts --bail=1`
Expected: FAIL, cannot find `./column-model.js`.

- [ ] **Step 3: Add the setting**

Append to `plugins/office/shared/settings.ts`:

```ts
/**
 * The office's column on this device: its width beside the floor and whether it is collapsed to
 * its rail. A setting of its own: the view's and the incidents' saves write `office-device` whole,
 * and would drop a field of the column's.
 */
export const officeColumnSettings = defineSettings({
  id: "office-column",
  scope: "device",
  version: 1,
  schema: z.object({
    width: z.number().default(360),
    collapsed: z.boolean().default(false),
  }),
});
```

If `defineSettings` in this file's other two uses requires `migrate`, match them; version 1 has nothing to migrate.

- [ ] **Step 4: Write the model**

```ts
// plugins/office/client/column-model.ts
export type ColumnTab = "attention" | "sessions" | "activity" | "chat";

/** The column's tabs, in their order. The icons are Lucide names. */
export const COLUMN_TABS: readonly { tab: ColumnTab; label: string; icon: string }[] = [
  { tab: "attention", label: "Attention", icon: "Bell" },
  { tab: "sessions", label: "Sessions", icon: "Users" },
  { tab: "activity", label: "Activity", icon: "Activity" },
  { tab: "chat", label: "Chat", icon: "MessageCircle" },
];

export const COLUMN_MIN = 280;
export const COLUMN_MAX = 560;
export const COLUMN_DEFAULT = 360;
/** What the floor keeps beside the column, while the surface is wide enough for both. */
export const FLOOR_MIN = 320;

/**
 * The column's width on a surface of `surface` px. Zero is a surface not measured yet: only the
 * column's own limits apply then.
 */
export function clampColumn(width: number, surface: number): number {
  const room = surface > 0 ? surface - FLOOR_MIN : COLUMN_MAX;
  const most = Math.max(COLUMN_MIN, Math.min(COLUMN_MAX, room));
  return Math.round(Math.min(most, Math.max(COLUMN_MIN, width)));
}

/** A tab's badge: nothing at zero, and no more than two digits. */
export function countLabel(count: number): string | null {
  if (count <= 0) return null;
  return count > 99 ? "99+" : String(count);
}
```

- [ ] **Step 5: Run it and see it pass**

Run: `cd plugins && npx vitest run office/client/column-model.test.ts --bail=1`
Expected: 6 passed.

- [ ] **Step 6: Commit**

```bash
npm run format:files -- plugins/office/shared/settings.ts plugins/office/client/column-model.ts plugins/office/client/column-model.test.ts
npm run lint -- plugins/office/shared/settings.ts plugins/office/client/column-model.ts
git add plugins/office/shared/settings.ts plugins/office/client/column-model.ts plugins/office/client/column-model.test.ts
git commit -m "feat(office): the column's width and tabs"
```

---

### Task 2: The panels take the surface's state

The three panels are screens today: each calls `useOffice()` for a subscription of its own, builds its own styles, and reaches the surface through the registry in `office-link.ts`. This task makes them plain components of the surface. Nothing shows them between this task and Task 3.

**Files:**

- Modify: `plugins/office/client/office-link.ts` (keep only the `OfficeLink` type)
- Modify: `plugins/office/client/sessions-panel.tsx`, `plugins/office/client/activity-panel.tsx`, `plugins/office/client/chat-panel.tsx`
- Modify: `plugins/office/client/office-surface.tsx` (remove `PanelButtons` and the link's registry)
- Modify: `plugins/office/index.client.tsx` (remove the three screens)
- Modify tests: `plugins/office/client/sessions-panel.mounted.test.tsx`, `activity-panel.mounted.test.tsx`, `chat-panel.mounted.test.tsx`, `office-surface-panels.mounted.test.tsx`, `office-link.test.ts`

**Interfaces:**

- Produces, in `plugins/office/client/office-link.ts`:

```ts
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import type { OfficeStyles } from "./styles.js";
import type { OfficeState } from "./use-office.js";

/** What a panel of the column asks of the surface it is drawn in. */
export interface OfficeLink {
  /** Opens the agent's card, as a press on a List row does. */
  select(agentId: string): void;
  /** Shows the agent's session. */
  openSession(agentId: string): void;
}

/** What the surface hands each panel of its column. */
export interface ColumnPanelProps {
  /** The surface's one subscription to the office. */
  office: OfficeState;
  styles: OfficeStyles;
  theme: PluginTheme;
  layout: PluginSurfaceProps["layout"];
  link: OfficeLink;
}
```

- `SessionsPanel(props: ColumnPanelProps)`, `ActivityPanel(props: ColumnPanelProps)`, `ChatPanel(props: ColumnPanelProps)`.
- `Pill` and `loadProblem` stay exported from `activity-panel.tsx`.

- [ ] **Step 1: Change the panels' tests to the new props**

In each of the three panel test files, the mount helper renders the panel with `{ theme, layout, navigation }` and the file mocks `useSubscription` to deliver office events. Change each to:

- Build the office state in the test instead of delivering it: a helper
  `office(state: Partial<OfficeSnapshot>, extra?: Partial<OfficeState>): OfficeState` returning
  `{ state: { ...EMPTY_OFFICE, ...state }, loaded: true, subscription: { status: "live" }, chat: null, ...extra }`.
  Where a test delivers a second event to see the panel change, re-render with the next state.
- Mount with `createElement(Panel, { office: ..., styles, theme: THEME, layout, link })`, where `styles` comes from a small harness component that calls `useOfficeStyles(THEME, layout.compact, false)` (as `host-switches.mounted.test.tsx`'s `Harness` does), and `link = { select: (id) => selected.push(id), openSession: (id) => opened.push(id) }`.
- Replace every assertion on `navigation.openAgent`, `claimOfficeLink` or `linkSelect` with the same assertion on `selected` / `opened`.
- Delete tests that only exercised the registry ("on its own route the agent's workspace opens", "a panel beside another office reaches the one that claimed the link"): a panel has no route of its own any more. List each deleted test by name in your report.
- Keep the `useRpc` mock the Chat tests use; remove the `useSubscription` mock where nothing else in the file needs it.

Delete `plugins/office/client/office-link.test.ts`: the module keeps only types.

- [ ] **Step 2: Run one of them and see it fail**

Run: `cd plugins && npx vitest run office/client/sessions-panel.mounted.test.tsx --bail=1 > /tmp/office-t2.txt 2>&1; tail -20 /tmp/office-t2.txt`
Expected: FAIL (the panel still reads `useOffice` and `navigation`).

- [ ] **Step 3: Rewrite `office-link.ts`**

Replace the whole file with the code in "Interfaces" above. `useOfficeLink`, `claimOfficeLink`, `linkSelect`, `linkOpenSession`, `SESSIONS_SCREEN`, `ACTIVITY_SCREEN` and `CHAT_SCREEN` are gone.

- [ ] **Step 4: Change the three panels**

In each of `sessions-panel.tsx`, `activity-panel.tsx`, `chat-panel.tsx`:

- The exported component's signature becomes `({ office, styles, theme, layout, link }: ColumnPanelProps)`. Remove its `useOfficeStyles(...)` and `useOffice()` lines and the comment above the styles line; read `const { state, loaded, subscription, chat } = office;` (only the fields the panel used).
- Every inner component that took `navigation: Navigation` takes `link: OfficeLink` in its place, passed down the same way. `linkSelect(id, navigation)` becomes `link.select(id)`; `linkOpenSession(id, navigation)` becomes `link.openSession(id)`.
- Remove the local `type Navigation` and the imports left unused (`useOffice`, `useOfficeStyles`, `PluginScreenProps` where nothing else uses it, `linkSelect`, `linkOpenSession`).
- Rewrite each component's doc comment: it is a tab of the office's column, fed by the surface's subscription. `ActivityPanel`'s comment loses "Its own subscription ... keeps the feed filling while only the panel is open"; `ChatPanel`'s loses "Its own subscription ... brings the conversation".
- `ChatPanel` keeps its own `hasTouchScreen(...)` line: it decides whether the actions always show, which is not the styles' business.

- [ ] **Step 5: Take the buttons and the registry out of the surface**

In `plugins/office/client/office-surface.tsx`:

- Delete `PanelButtonsProps`, `PanelButtons` and their use in `ViewControls` (and `navigation`, `link`, `unread` from `ViewControlsProps` if nothing else there uses them). Keep `PanelButton`: `SettingsButton` uses it.
- Delete `useOfficeLink(link)` and the import of `claimOfficeLink`, `useOfficeLink`, `ACTIVITY_SCREEN`, `CHAT_SCREEN`, `SESSIONS_SCREEN`. Keep
  `const link = useMemo(() => ({ select: setSelectedId, openSession }), [openSession]);` typed as `OfficeLink`; Task 3 hands it to the column. Until then mark nothing unused: if the linter refuses the unused `link` and `unread`, remove them in this task and Task 3 adds them back.
- Keep `useUnread`.

In `plugins/office/index.client.tsx`: remove the three `client.addScreen` calls for Sessions, Activity and Chat, and the imports of the panels and of the screen ids.

In `plugins/office/client/office-surface-panels.mounted.test.tsx`: delete the tests about the header's Sessions, Activity and Chat buttons, `showBeside` for the panels and the link's claim (every test that uses `SESSIONS`, `ACTIVITY`, `CHAT`, `claimOfficeLink`, `linkSelect` or `chatButton`), and their helpers and imports. The expected `buttonLabels()` with the settings way becomes `["2D view", "List view", "Office settings"]`. Keep "a chat change does not rebuild the floor's model" by asserting on `buildOfficeModel`'s call count alone. List each deleted test by name in your report: Task 3 writes the column's tests in their place.

- [ ] **Step 6: Run the panels' and the surface's tests**

Run each, one at a time:

```bash
cd plugins
npx vitest run office/client/sessions-panel.mounted.test.tsx --bail=1
npx vitest run office/client/activity-panel.mounted.test.tsx --bail=1
npx vitest run office/client/chat-panel.mounted.test.tsx --bail=1
npx vitest run office/client/office-surface-panels.mounted.test.tsx --bail=1
```

Expected: all pass. Then `grep -rn "office-link" plugins/office --include=*.ts --include=*.tsx` shows only type imports.

- [ ] **Step 7: Typecheck, lint, format, commit**

```bash
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office
npm run format:files -- plugins/office/client plugins/office/index.client.tsx
git add -A plugins/office
git commit -m "refactor(office): the panels are components of the surface, fed by its one subscription"
```

---

### Task 3: The column beside the floor

**Files:**

- Create: `plugins/office/client/use-column.ts`
- Create: `plugins/office/client/office-column.tsx`
- Test: `plugins/office/client/office-column.mounted.test.tsx`
- Modify: `plugins/office/client/office-surface.tsx` (layout; the strip leaves the header)
- Modify: `plugins/office/client/styles.ts`
- Modify: `plugins/office/client/office-surface-panels.mounted.test.tsx`

**Interfaces:**

- Consumes: Task 1's `column-model.ts` and `officeColumnSettings`; Task 2's `ColumnPanelProps`, `OfficeLink` and the three panels; `AttentionStrip` (`{ entries, cards, styles, wrap, onSelect }`).
- Produces:

```ts
// use-column.ts
export interface ColumnState {
  tab: ColumnTab;
  /** The stored width, not yet clamped to a surface. */
  width: number;
  collapsed: boolean;
  /** Selects the tab and opens a collapsed column. */
  show(tab: ColumnTab): void;
  setCollapsed(next: boolean): void;
  setWidth(next: number): void;
}
export function useColumn(): ColumnState;

// office-column.tsx
export interface ColumnBadges {
  attention: string | null;
  chat: string | null;
}
export interface OfficeColumnProps {
  column: ColumnState;
  /** The surface's width, for the column's most; 0 until measured. */
  surfaceWidth: number;
  badges: ColumnBadges;
  /** The theme's foreground, which an icon-only control's glyph rests at. */
  color: string;
  iconSize: number;
  styles: OfficeStyles;
  /** The chosen tab's panel. */
  children: ReactNode;
}
export function OfficeColumn(props: OfficeColumnProps): ReactNode;
export function ColumnTabs(props: {
  tab: ColumnTab | null;
  badges: ColumnBadges;
  color: string;
  iconSize: number;
  /** Icons alone, for the rail and the phone's bar; with labels in the open column. */
  labels: boolean;
  vertical: boolean;
  onPress(tab: ColumnTab): void;
  styles: OfficeStyles;
}): ReactNode;
```

- [ ] **Step 1: Write the hook**

```ts
// plugins/office/client/use-column.ts
import { useCallback, useMemo, useState } from "react";
import { useSettings } from "@getpaseo/plugin/client";
import { officeColumnSettings } from "../shared/settings.js";
import { COLUMN_DEFAULT, type ColumnTab } from "./column-model.js";

interface ColumnValues {
  width: number;
  collapsed: boolean;
}

const DEFAULTS: ColumnValues = { width: COLUMN_DEFAULT, collapsed: false };

export interface ColumnState {
  tab: ColumnTab;
  /** The stored width, not yet clamped to a surface. */
  width: number;
  collapsed: boolean;
  /** Selects the tab and opens a collapsed column. */
  show(tab: ColumnTab): void;
  setCollapsed(next: boolean): void;
  setWidth(next: number): void;
}

/**
 * The column's state. The tab lives as long as the surface; the width and collapsed are the
 * device's. A change shows at once and is saved behind it; one the device refuses holds until the
 * office is closed.
 */
export function useColumn(): ColumnState {
  const settings = useSettings(officeColumnSettings);
  const stored = settings.status === "ready" ? settings.values : null;
  const revision =
    settings.status === "ready" || settings.status === "invalid" ? settings.revision : null;
  const { save } = settings;
  const [local, setLocal] = useState<Partial<ColumnValues>>({});
  const [tab, setTab] = useState<ColumnTab>("sessions");
  const width = local.width ?? stored?.width ?? DEFAULTS.width;
  const collapsed = local.collapsed ?? stored?.collapsed ?? DEFAULTS.collapsed;
  const change = useCallback(
    (patch: Partial<ColumnValues>) => {
      setLocal((current) => ({ ...current, ...patch }));
      if (revision !== null) void save({ width, collapsed, ...patch }, revision);
    },
    [save, revision, width, collapsed],
  );
  const show = useCallback(
    (next: ColumnTab) => {
      setTab(next);
      if (collapsed) change({ collapsed: false });
    },
    [collapsed, change],
  );
  const setCollapsed = useCallback((next: boolean) => change({ collapsed: next }), [change]);
  const setWidth = useCallback((next: number) => change({ width: next }), [change]);
  return useMemo(
    () => ({ tab, width, collapsed, show, setCollapsed, setWidth }),
    [tab, width, collapsed, show, setCollapsed, setWidth],
  );
}
```

- [ ] **Step 2: Write the column's failing mounted test**

```tsx
// plugins/office/client/office-column.mounted.test.tsx
/**
 * @vitest-environment jsdom
 */
// The column, mounted with a stand-in for the device's setting: its tabs, its badges, its rail.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Text } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useOfficeStyles } from "./styles.js";

let saves: unknown[];
let storedColumn: { width: number; collapsed: boolean };

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSettings: () => ({
    status: "ready",
    revision: "r1",
    values: storedColumn,
    saving: false,
    saveError: null,
    save: async (values: unknown) => {
      saves.push(values);
      return true;
    },
    reset: async () => true,
    reload: async () => undefined,
  }),
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { View } = await import("react-native");
  const Icon = (props: { name: string }) => createElement(View, { testID: `icon-${props.name}` });
  return { Icon };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
let container: HTMLElement;
let root: Root;

function Harness({ chat }: { chat: string | null }): ReactNode {
  // Imported inside so the mocks above are in place.
  const { OfficeColumn } = require_column();
  const { useColumn } = require_hook();
  const styles = useOfficeStyles(THEME, false, false);
  const column = useColumn();
  return createElement(
    OfficeColumn,
    {
      column,
      surfaceWidth: 1280,
      badges: { attention: "2", chat },
      color: "#000000",
      iconSize: 16,
      styles,
    },
    createElement(Text, null, `panel:${column.tab}`),
  );
}

let require_column: () => typeof import("./office-column.js");
let require_hook: () => typeof import("./use-column.js");

async function mount(chat: string | null = null): Promise<void> {
  const columnModule = await import("./office-column.js");
  const hookModule = await import("./use-column.js");
  require_column = () => columnModule;
  require_hook = () => hookModule;
  await act(async () => root.render(createElement(Harness, { chat })));
}

function tab(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[role="tab"][aria-label^="${label}"]`);
  if (!found) throw new Error(`No tab is labelled "${label}"`);
  return found;
}

beforeEach(() => {
  saves = [];
  storedColumn = { width: 360, collapsed: false };
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the column opens on Sessions, with four tabs in order", async () => {
  await mount();

  const labels = [...container.querySelectorAll('[role="tab"]')].map((each) =>
    each.getAttribute("aria-label"),
  );
  expect(labels).toEqual(["Attention, 2 new", "Sessions", "Activity", "Chat"]);
  expect(tab("Sessions").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("panel:sessions");
});

test("a tab press shows that tab's panel and saves nothing", async () => {
  await mount();
  await act(async () => tab("Activity").click());

  expect(tab("Activity").getAttribute("aria-selected")).toBe("true");
  expect(container.textContent).toContain("panel:activity");
  expect(saves).toEqual([]);
});

test("Chat carries its count in its name", async () => {
  await mount("3");
  expect(tab("Chat").getAttribute("aria-label")).toBe("Chat, 3 new");
});

test("Collapse leaves the rail and saves it; a rail press opens that tab again", async () => {
  await mount();
  const collapse = container.querySelector<HTMLElement>('[aria-label="Collapse the column"]');
  if (!collapse) throw new Error("There is no Collapse button");
  await act(async () => collapse.click());

  expect(container.textContent).not.toContain("panel:");
  expect(saves).toEqual([{ width: 360, collapsed: true }]);

  await act(async () => tab("Chat").click());
  expect(container.textContent).toContain("panel:chat");
  expect(saves).toEqual([
    { width: 360, collapsed: true },
    { width: 360, collapsed: false },
  ]);
});

test("a device that left the column collapsed opens the office on the rail", async () => {
  storedColumn = { width: 400, collapsed: true };
  await mount();

  expect(container.textContent).not.toContain("panel:");
  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
});
```

The `require_*` indirection is only there so the modules load after the mocks; if a plain `import` at the top of the file works with these `vi.mock` calls (they are hoisted), use that and delete the indirection.

- [ ] **Step 3: Run it and see it fail**

Run: `cd plugins && npx vitest run office/client/office-column.mounted.test.tsx --bail=1`
Expected: FAIL, cannot find `./office-column.js`.

- [ ] **Step 4: Add the styles**

In `plugins/office/client/styles.ts`, add to the `OfficeStyles` interface after `viewControls`:

```ts
/** The floor and the column, side by side. */
officeRow: ViewStyle;
/** The column beside the floor; its width is the device's. */
column: ViewStyle;
/** The column collapsed to its tabs' icons. */
columnRail: ViewStyle;
/** The strip between the floor and the column that is dragged to change the width. */
columnHandle: ViewStyle;
columnHandleLit: ViewStyle;
/** The tabs and the collapse button over a panel. */
columnHead: ViewStyle;
columnTabs: ViewStyle;
columnTabsVertical: ViewStyle;
/** The chosen tab's panel. */
columnBody: ViewStyle;
/** The Attention tab's list of cards. */
columnAttention: ViewStyle;
```

and to the object built in `useOfficeStyles`, after `viewControls` (`segments` is the existing row-of-pills style object in that function; `HANDLE` is a new module constant `const HANDLE = 8;`):

```ts
      officeRow: { flex: 1, flexDirection: "row" },
      column: {
        borderLeftWidth: 1,
        borderLeftColor: colors.border,
        backgroundColor: colors.surface0,
      },
      columnRail: {
        borderLeftWidth: 1,
        borderLeftColor: colors.border,
        backgroundColor: colors.surface0,
        paddingVertical: 8,
        paddingHorizontal: 4,
        alignItems: "center",
        gap: 8,
      },
      // Wider than it looks: the drag starts anywhere on it, and only its middle line is drawn.
      columnHandle: { width: HANDLE, marginRight: -HANDLE, zIndex: 1 },
      columnHandleLit: {
        width: HANDLE,
        marginRight: -HANDLE,
        zIndex: 1,
        backgroundColor: colors.border,
      },
      columnHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        paddingHorizontal: 8,
        paddingVertical: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      columnTabs: { ...segments, flexShrink: 1, flexWrap: "wrap" },
      columnTabsVertical: { alignItems: "center", gap: 4 },
      columnBody: { flex: 1 },
      columnAttention: { paddingVertical: 8 },
```

If `segments` in that function is not a spreadable plain object under that name, use the name it has (it backs `styles.segments` and `panelChips`).

- [ ] **Step 5: Write the column**

```tsx
// plugins/office/client/office-column.tsx
import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { PanResponder, Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { COLUMN_TABS, clampColumn, type ColumnTab } from "./column-model.js";
import type { OfficeStyles } from "./styles.js";
import type { ColumnState } from "./use-column.js";

export interface ColumnBadges {
  /** The Attention tab's cards; null at none. */
  attention: string | null;
  /** The chat's messages since it was last open on this device; null at none. */
  chat: string | null;
}

interface TabProps {
  tab: ColumnTab;
  label: string;
  icon: string;
  selected: boolean;
  count: string | null;
  showLabel: boolean;
  color: string;
  iconSize: number;
  onPress(tab: ColumnTab): void;
  styles: OfficeStyles;
}

function Tab({
  tab,
  label,
  icon,
  selected,
  count,
  showLabel,
  color,
  iconSize,
  onPress,
  styles,
}: TabProps) {
  const press = useCallback(() => onPress(tab), [onPress, tab]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  let fill = null;
  if (selected) fill = styles.segmentFill;
  else if (hovered || pressed) fill = styles.segmentHoverFill;
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityLabel={count ? `${label}, ${count} new` : label}
      aria-selected={selected}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.segment}
    >
      {fill === null ? null : <View style={fill} />}
      {/* The count sits on the icon's corner, inside the pill that clips. */}
      <View>
        <Icon name={icon} size={iconSize} color={color} />
        {count ? (
          <View style={styles.chatBadge}>
            <Text style={styles.chatBadgeText}>{count}</Text>
          </View>
        ) : null}
      </View>
      {showLabel ? (
        <Text style={selected ? styles.segmentTextSelected : styles.segmentText}>{label}</Text>
      ) : null}
    </Pressable>
  );
}

export interface ColumnTabsProps {
  /** The chosen tab; null where none shows as chosen (the rail, the phone's bar while closed). */
  tab: ColumnTab | null;
  badges: ColumnBadges;
  color: string;
  iconSize: number;
  /** Icons alone on the rail and the phone's bar; with the chosen tab's label in the column. */
  labels: boolean;
  vertical: boolean;
  onPress(tab: ColumnTab): void;
  styles: OfficeStyles;
}

/** The column's tabs: a row in the open column, a stack on its rail. */
export function ColumnTabs({
  tab,
  badges,
  color,
  iconSize,
  labels,
  vertical,
  onPress,
  styles,
}: ColumnTabsProps) {
  return (
    <View
      role="tablist"
      aria-label="Office column"
      style={vertical ? styles.columnTabsVertical : styles.columnTabs}
    >
      {COLUMN_TABS.map((each) => {
        let count: string | null = null;
        if (each.tab === "attention") count = badges.attention;
        if (each.tab === "chat") count = badges.chat;
        return (
          <Tab
            key={each.tab}
            tab={each.tab}
            label={each.label}
            icon={each.icon}
            selected={each.tab === tab}
            count={count}
            // Four labels do not fit a narrow column: the chosen tab alone says its name.
            showLabel={labels && each.tab === tab}
            color={color}
            iconSize={iconSize}
            onPress={onPress}
            styles={styles}
          />
        );
      })}
    </View>
  );
}

interface IconButtonProps {
  label: string;
  icon: string;
  color: string;
  iconSize: number;
  onPress(): void;
  styles: OfficeStyles;
}

function IconButton({ label, icon, color, iconSize, onPress, styles }: IconButtonProps) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={styles.segment}
    >
      <Icon name={icon} size={iconSize} color={color} />
    </Pressable>
  );
}

export interface OfficeColumnProps {
  column: ColumnState;
  /** The surface's width, for the column's most; 0 until measured. */
  surfaceWidth: number;
  badges: ColumnBadges;
  /** The theme's foreground, which an icon-only control's glyph rests at. */
  color: string;
  iconSize: number;
  styles: OfficeStyles;
  /** The chosen tab's panel. */
  children: ReactNode;
}

/**
 * The office's column beside the floor: its tabs over the chosen panel, a handle to drag its
 * width, and a rail of the tabs' icons when it is collapsed. The office draws it itself, so it is
 * there in an app with no side area of its own.
 */
export function OfficeColumn({
  column,
  surfaceWidth,
  badges,
  color,
  iconSize,
  styles,
  children,
}: OfficeColumnProps) {
  const { tab, collapsed, show, setCollapsed, setWidth } = column;
  const width = clampColumn(column.width, surfaceWidth);
  // The width while the handle is dragged; the device is told once, on release.
  const [dragged, setDragged] = useState<number | null>(null);
  const start = useRef(width);
  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          start.current = width;
          setDragged(width);
        },
        // The handle is on the column's left: a drag to the left widens it.
        onPanResponderMove: (_event, gesture) =>
          setDragged(clampColumn(start.current - gesture.dx, surfaceWidth)),
        onPanResponderRelease: (_event, gesture) => {
          setDragged(null);
          setWidth(clampColumn(start.current - gesture.dx, surfaceWidth));
        },
        onPanResponderTerminate: () => setDragged(null),
      }),
    [width, surfaceWidth, setWidth],
  );
  const collapse = useCallback(() => setCollapsed(true), [setCollapsed]);
  const sized = useMemo(() => ({ width: dragged ?? width }), [dragged, width]);
  if (collapsed) {
    return (
      <View style={styles.columnRail}>
        <ColumnTabs
          tab={null}
          badges={badges}
          color={color}
          iconSize={iconSize}
          labels={false}
          vertical
          onPress={show}
          styles={styles}
        />
      </View>
    );
  }
  return (
    <>
      <View
        accessibilityLabel="Drag to resize the column"
        style={dragged === null ? styles.columnHandle : styles.columnHandleLit}
        {...pan.panHandlers}
      />
      <View style={[styles.column, sized]}>
        <View style={styles.columnHead}>
          <ColumnTabs
            tab={tab}
            badges={badges}
            color={color}
            iconSize={iconSize}
            labels
            vertical={false}
            onPress={show}
            styles={styles}
          />
          <IconButton
            label="Collapse the column"
            icon="PanelRightClose"
            color={color}
            iconSize={iconSize}
            onPress={collapse}
            styles={styles}
          />
        </View>
        <View style={styles.columnBody}>{children}</View>
      </View>
    </>
  );
}
```

The one computed style (`sized`, a width that follows a drag) is the exception the styles file cannot hold; keep it memoised as written. If the lint rules refuse the style array, merge it with `useMemo(() => ({ ...styles.column, width: ... }), ...)`.

- [ ] **Step 6: Run the column's test**

Run: `cd plugins && npx vitest run office/client/office-column.mounted.test.tsx --bail=1`
Expected: 5 passed.

- [ ] **Step 7: Lay the surface out as floor and column**

In `plugins/office/client/office-surface.tsx`:

1. Imports: `OfficeColumn` and `type ColumnBadges` from `./office-column.js`; `useColumn` from `./use-column.js`; `countLabel`, `type ColumnTab` from `./column-model.js`; the three panels; `ScrollView` from `@getpaseo/plugin/client/ui`; `type ColumnPanelProps`, `type OfficeLink` from `./office-link.js`.

2. A component that draws the chosen tab's panel, above `OfficeSurface`:

```tsx
interface ColumnPanelSwitchProps extends ColumnPanelProps {
  tab: ColumnTab;
  /** The Attention tab's content. */
  attention: ReactNode;
}

/** The chosen tab's panel. Only that one is mounted: Chat counts as seen while it is. */
function ColumnPanel({ tab, attention, ...panel }: ColumnPanelSwitchProps) {
  if (tab === "attention") {
    return (
      <ScrollView contentContainerStyle={panel.styles.columnAttention}>{attention}</ScrollView>
    );
  }
  if (tab === "sessions") return <SessionsPanel {...panel} />;
  if (tab === "activity") return <ActivityPanel {...panel} />;
  return <ChatPanel {...panel} />;
}
```

3. In `OfficeSurface`: `const column = useColumn();`, a measured width
   `const [surfaceWidth, setSurfaceWidth] = useState(0);` with
   `const measure = useCallback((event: LayoutChangeEvent) => setSurfaceWidth(event.nativeEvent.layout.width), []);`
   (`LayoutChangeEvent` from `react-native`), and

```tsx
const badges = useMemo(
  (): ColumnBadges => ({
    attention: live ? countLabel(model.attention.length + cards.length) : null,
    chat: unread,
  }),
  [live, model.attention.length, cards.length, unread],
);
```

4. The header with the strip is removed. The strip becomes the Attention tab's content:

```tsx
const attention = live ? (
  <AttentionStrip
    entries={model.attention}
    cards={cards}
    styles={styles}
    wrap
    onSelect={selectFromStrip}
  />
) : null;
```

When `live` is false or the strip has nothing, the tab shows one muted line instead: add
`const NOTHING_WAITS = "Nothing needs you.";` and render
`<Text style={styles.sceneStatus}>{NOTHING_WAITS}</Text>` in its place
(`model.attention.length === 0 && cards.length === 0`).

5. The JSX between the scene's problem banner and the cards becomes, for the wide layout:

```tsx
      <View style={styles.officeRow} onLayout={measure}>
        <View style={styles.floor}>
          <ViewControls ... />   {/* as it is, without the panel buttons */}
          <SurfaceBody ... />    {/* as it is */}
        </View>
        {layout.compact ? null : (
          <OfficeColumn
            column={column}
            surfaceWidth={surfaceWidth}
            badges={badges}
            color={theme.colors.foreground}
            iconSize={touchScreen ? 20 : 16}
            styles={styles}
          >
            <ColumnPanel
              tab={column.tab}
              attention={attention}
              office={office}
              styles={styles}
              theme={theme}
              layout={layout}
              link={link}
            />
          </OfficeColumn>
        )}
      </View>
```

Task 4 fills in the compact layout; until then a compact surface has the floor alone.

6. Keep `OfficeSurface` within the lint complexity limit: if it goes over, move steps 3 and 4 into a hook `useColumnContent(...)` in this file, as `useSettingsEntry` was.

7. `selectFromStrip` and the cards' `onOpen` work as before. A card opened from the Attention tab is a `Modal` of the office over the page, so nothing else changes.

- [ ] **Step 8: The surface's mounted tests**

In `plugins/office/client/office-surface-panels.mounted.test.tsx`, where the `useSettings` mock chooses by `settings.id`, add a branch for `"office-column"` returning `{ ...DEVICE, values: { width: 360, collapsed: false } }`. `mount()` gains a `compact` flag (default `true`, as today) used in `layout`. Add:

```tsx
test("a wide office has the column, on Sessions, and no strip above the floor", async () => {
  compact = false;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  const tabs = [...container.querySelectorAll('[role="tab"]')].map((each) =>
    each.getAttribute("aria-label"),
  );
  expect(tabs).toEqual(["Attention", "Sessions", "Activity", "Chat"]);
  expect(labelled("Sessions")?.getAttribute("aria-selected")).toBe("true");
});

test("Attention counts the strip's cards and shows them", async () => {
  compact = false;
  await mount();
  const notes = {
    folderSet: true,
    writing: false,
    writtenAt: null,
    failedAgentId: null,
    problem: null,
    scheduleError: "unknown zone Mars/Olympus",
  };
  await act(async () => deliver?.({ type: "snapshot", state: { ...EMPTY_OFFICE, notes } }));

  const attention = container.querySelector<HTMLElement>('[role="tab"][aria-label^="Attention"]');
  expect(attention?.getAttribute("aria-label")).toBe("Attention, 1 new");
  await act(async () => attention?.click());
  expect(container.textContent).toContain("Settings");
});

test("Attention with nothing waiting says so", async () => {
  compact = false;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));
  await act(async () =>
    container.querySelector<HTMLElement>('[role="tab"][aria-label^="Attention"]')?.click(),
  );

  expect(container.textContent).toContain("Nothing needs you.");
});

test("Chat's tab shows the messages since the chat was last open", async () => {
  compact = false;
  resetChatSeen(1000);
  await mount();
  const messages = [chatMessage(2000, "a1"), chatMessage(5000, "a2")];
  await act(async () =>
    deliver?.({ type: "snapshot", state: { ...EMPTY_OFFICE, chat: { messages, typing: [] } } }),
  );

  const chat = container.querySelector<HTMLElement>('[role="tab"][aria-label^="Chat"]');
  expect(chat?.getAttribute("aria-label")).toBe("Chat, 2 new");
});
```

`labelled()` matches an exact `aria-label`; "Sessions" has no count, so it matches. Keep `chatMessage` and `resetChatSeen` (Task 2 may have removed them with the old Chat tests; restore them). The earlier test of the strip's Settings card ("a schedule the settings broke ...") now finds the card under the Attention tab on a wide layout: make it mount wide and press Attention first.

- [ ] **Step 9: Run, typecheck, lint, format, commit**

```bash
cd plugins
npx vitest run office/client/office-column.mounted.test.tsx --bail=1
npx vitest run office/client/office-surface-panels.mounted.test.tsx --bail=1 > /tmp/office-t3.txt 2>&1; tail -30 /tmp/office-t3.txt
npx vitest run office/client/office-surface.test.ts --bail=1
cd ..
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office
npm run format:files -- plugins/office/client
git add -A plugins/office
git commit -m "feat(office): the office draws its own column beside the floor"
```

Expected: every test passes.

---

### Task 4: The phone's bar and sheet

**Files:**

- Create: `plugins/office/client/column-sheet.tsx`
- Test: `plugins/office/client/column-sheet.mounted.test.tsx`
- Modify: `plugins/office/client/office-surface.tsx`, `plugins/office/client/styles.ts`
- Modify: `plugins/office/client/office-surface-panels.mounted.test.tsx`

**Interfaces:**

- Consumes: `ColumnTabs`, `ColumnBadges` (Task 3), `ColumnTab`.
- Produces:

```ts
export interface ColumnSheetProps {
  /** The tab the sheet shows; null while it is closed. */
  open: ColumnTab | null;
  badges: ColumnBadges;
  color: string;
  iconSize: number;
  /** "web" listens for Escape; an app has no keyboard to listen to. */
  platform: "ios" | "android" | "web";
  onOpen(tab: ColumnTab): void;
  onClose(): void;
  styles: OfficeStyles;
  /** The open tab's panel. */
  children: ReactNode;
}
export function ColumnSheet(props: ColumnSheetProps): ReactNode;
```

- [ ] **Step 1: Write the failing mounted test**

```tsx
// plugins/office/client/column-sheet.mounted.test.tsx
/**
 * @vitest-environment jsdom
 */
// The phone's column: a bar of the tabs under the floor and a sheet over it.
import { act, createElement, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Text } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { ColumnTab } from "./column-model.js";
import { ColumnSheet } from "./column-sheet.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { View } = await import("react-native");
  const Icon = (props: { name: string }) => createElement(View, { testID: `icon-${props.name}` });
  return { Icon };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
let container: HTMLElement;
let root: Root;

function Harness(): ReactNode {
  const styles = useOfficeStyles(THEME, true, true);
  const [open, setOpen] = useState<ColumnTab | null>(null);
  return (
    <ColumnSheet
      open={open}
      badges={{ attention: "1", chat: null }}
      color="#000000"
      iconSize={20}
      platform="web"
      onOpen={setOpen}
      onClose={() => setOpen(null)}
      styles={styles}
    >
      <Text>{`panel:${open}`}</Text>
    </ColumnSheet>
  );
}

const mount = () => act(async () => root.render(<Harness />));

function tab(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[role="tab"][aria-label^="${label}"]`);
  if (!found) throw new Error(`No tab is labelled "${label}"`);
  return found;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("closed, there is the bar of four tabs and no sheet", async () => {
  await mount();

  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
  expect(tab("Attention").getAttribute("aria-label")).toBe("Attention, 1 new");
  expect(container.textContent).not.toContain("panel:");
});

test("a bar press opens the sheet on that tab, and another tab changes it", async () => {
  await mount();
  await act(async () => tab("Chat").click());
  expect(container.textContent).toContain("panel:chat");
  expect(tab("Chat").getAttribute("aria-selected")).toBe("true");

  await act(async () => tab("Sessions").click());
  expect(container.textContent).toContain("panel:sessions");
});

test("Close, a press on the floor above the sheet, and Escape each close it", async () => {
  await mount();
  for (const close of [
    () => container.querySelector<HTMLElement>('[aria-label="Close"]')?.click(),
    () => container.querySelector<HTMLElement>('[aria-label="Close the column"]')?.click(),
    () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })),
  ]) {
    await act(async () => tab("Activity").click());
    expect(container.textContent).toContain("panel:activity");
    await act(async () => close());
    expect(container.textContent).not.toContain("panel:");
  }
});

test("the open tab's press closes the sheet", async () => {
  await mount();
  await act(async () => tab("Activity").click());
  await act(async () => tab("Activity").click());
  expect(container.textContent).not.toContain("panel:");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd plugins && npx vitest run office/client/column-sheet.mounted.test.tsx --bail=1`
Expected: FAIL, cannot find `./column-sheet.js`.

- [ ] **Step 3: Add the styles**

In `plugins/office/client/styles.ts`, interface, after `columnAttention`:

```ts
/** The phone's bar of the column's tabs, under the floor. */
columnBar: ViewStyle;
/** Over the floor above an open sheet: a press on it closes the sheet. */
sheetScrim: ViewStyle;
/** The phone's column: a sheet over the lower part of the floor. */
columnSheet: ViewStyle;
columnSheetHead: ViewStyle;
columnSheetTitle: TextStyle;
```

and in the object (`base` is the function's body text style):

```ts
      columnBar: {
        flexDirection: "row",
        justifyContent: "space-around",
        alignItems: "center",
        paddingVertical: 4,
        borderTopWidth: 1,
        borderTopColor: colors.border,
        backgroundColor: colors.surface0,
      },
      sheetScrim: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, zIndex: 2 },
      // The floor's top quarter stays in view over the sheet, so the office is still there.
      columnSheet: {
        position: "absolute",
        left: 0,
        right: 0,
        bottom: 0,
        height: "75%",
        zIndex: 3,
        borderTopLeftRadius: 12,
        borderTopRightRadius: 12,
        borderTopWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface0,
        overflow: "hidden",
      },
      columnSheetHead: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        paddingLeft: pad,
        paddingRight: 4,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      },
      columnSheetTitle: { ...base, color: colors.foreground, fontWeight: "500" },
```

- [ ] **Step 4: Write the sheet**

```tsx
// plugins/office/client/column-sheet.tsx
import { useCallback, useEffect, type ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon } from "@getpaseo/plugin/client/ui";
import { COLUMN_TABS, type ColumnTab } from "./column-model.js";
import { ColumnTabs, type ColumnBadges } from "./office-column.js";
import type { OfficeStyles } from "./styles.js";

export interface ColumnSheetProps {
  /** The tab the sheet shows; null while it is closed. */
  open: ColumnTab | null;
  badges: ColumnBadges;
  /** The theme's foreground, which an icon-only control's glyph rests at. */
  color: string;
  iconSize: number;
  /** "web" listens for Escape; an app has no keyboard to listen to. */
  platform: "ios" | "android" | "web";
  onOpen(tab: ColumnTab): void;
  onClose(): void;
  styles: OfficeStyles;
  /** The open tab's panel. */
  children: ReactNode;
}

/**
 * The column on a phone: a bar of its tabs under the floor, and the chosen tab as a sheet over
 * the floor. The office draws both, as it draws the column, so they are there in every app. The
 * sheet is absolutely placed in the surface: render this as the surface's last child.
 */
export function ColumnSheet({
  open,
  badges,
  color,
  iconSize,
  platform,
  onOpen,
  onClose,
  styles,
  children,
}: ColumnSheetProps) {
  // The open tab's own press closes the sheet, as a second press on a toggle does.
  const press = useCallback(
    (tab: ColumnTab) => {
      if (tab === open) onClose();
      else onOpen(tab);
    },
    [open, onOpen, onClose],
  );
  useEffect(() => {
    if (platform !== "web" || open === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [platform, open, onClose]);
  const title = COLUMN_TABS.find((each) => each.tab === open)?.label ?? "";
  return (
    <>
      {open === null ? null : (
        <>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the column"
            onPress={onClose}
            style={styles.sheetScrim}
          />
          <View style={styles.columnSheet}>
            <View style={styles.columnSheetHead}>
              <Text accessibilityRole="header" style={styles.columnSheetTitle}>
                {title}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close"
                onPress={onClose}
                style={styles.segment}
              >
                <Icon name="X" size={iconSize} color={color} />
              </Pressable>
            </View>
            <View style={styles.columnBody}>{children}</View>
          </View>
        </>
      )}
      <View style={styles.columnBar}>
        <ColumnTabs
          tab={open}
          badges={badges}
          color={color}
          iconSize={iconSize}
          labels={false}
          vertical={false}
          onPress={press}
          styles={styles}
        />
      </View>
    </>
  );
}
```

The sheet and the scrim are placed against the surface's root (`styles.screen`), and the bar is in the page's flow under the floor. With the bar in the flow below them, the sheet's `bottom: 0` covers the bar: if the tests or the look show the bar hidden while the sheet is open, wrap the floor and the sheet in one `View style={styles.floor}` so the sheet's bottom is the floor's bottom, and keep the bar outside it. Decide by what keeps the bar visible and pressable while the sheet is open, since the test "another tab changes it" presses the bar then.

- [ ] **Step 5: Run the sheet's test**

Run: `cd plugins && npx vitest run office/client/column-sheet.mounted.test.tsx --bail=1`
Expected: 4 passed.

- [ ] **Step 6: Use it on a compact surface**

In `plugins/office/client/office-surface.tsx`:

- `const [sheetTab, setSheetTab] = useState<ColumnTab | null>(null);` and
  `const closeSheet = useCallback(() => setSheetTab(null), []);`.
- On a compact layout, after the floor (see Step 4's note on where the sheet's bottom is):

```tsx
{
  layout.compact ? (
    <ColumnSheet
      open={sheetTab}
      badges={badges}
      color={theme.colors.foreground}
      iconSize={20}
      platform={layout.platform}
      onOpen={setSheetTab}
      onClose={closeSheet}
      styles={styles}
    >
      {sheetTab === null ? null : (
        <ColumnPanel
          tab={sheetTab}
          attention={attention}
          office={office}
          styles={styles}
          theme={theme}
          layout={layout}
          link={sheetLink}
        />
      )}
    </ColumnSheet>
  ) : null;
}
```

- On a phone a row press must not leave the agent's card under the sheet. `sheetLink` closes the sheet first:

```tsx
const sheetLink = useMemo(
  (): OfficeLink => ({
    select: (agentId) => {
      setSheetTab(null);
      link.select(agentId);
    },
    openSession: (agentId) => {
      setSheetTab(null);
      link.openSession(agentId);
    },
  }),
  [link],
);
```

The Attention tab's `selectFromStrip` and its cards' `onOpen` open a card of the office too: on a compact layout, close the sheet when one of them is pressed. The smallest way is to build the compact `attention` element with wrapped callbacks: `onSelect={(id) => { setSheetTab(null); selectFromStrip(id); }}` as a `useCallback`, and `cards` mapped once with `onOpen` wrapped the same way in a `useMemo`.

- The scene's own controls sit at the floor's bottom centre (the camera bar). The bar is below the floor, not over it, so they stay clear.
- Keep `OfficeSurface` within the lint complexity limit (move the sheet's state and `sheetLink` into a hook in this file if needed).

- [ ] **Step 7: The surface's mounted tests**

In `plugins/office/client/office-surface-panels.mounted.test.tsx` add:

```tsx
test("a phone has the bar under the floor, and no column beside it", async () => {
  compact = true;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  expect(container.querySelectorAll('[role="tab"]')).toHaveLength(4);
  expect(container.querySelector('[aria-label="Collapse the column"]')).toBeNull();
  expect(container.querySelector('[aria-label="Close"]')).toBeNull();
});

test("a phone's Sessions opens as a sheet, and a row press closes it for the agent's card", async () => {
  compact = true;
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: OFFICE_WITH_ONE_AGENT }));
  await act(async () =>
    container.querySelector<HTMLElement>('[role="tab"][aria-label="Sessions"]')?.click(),
  );
  expect(container.querySelector('[aria-label="Close"]')).not.toBeNull();

  const row = [...container.querySelectorAll<HTMLElement>('[role="button"]')].find((button) =>
    button.getAttribute("aria-label")?.startsWith("Ada"),
  );
  if (!row) throw new Error("The sheet has no row for the agent");
  await act(async () => row.click());
  expect(container.querySelector('[aria-label="Close"]')).toBeNull();
});
```

`OFFICE_WITH_ONE_AGENT` is `{ ...EMPTY_OFFICE, agents: [agent], workspaces: [workspace] }` with one agent titled "Ada" in one workspace: build `agent` and `workspace` from the shapes `sessions-panel.mounted.test.tsx` already uses for its rows, and copy them rather than inventing fields. The earlier compact tests' `buttonLabels()` expectations do not change: tabs have the role `tab`, not `button`.

- [ ] **Step 8: Run, typecheck, lint, format, commit**

```bash
cd plugins
npx vitest run office/client/column-sheet.mounted.test.tsx --bail=1
npx vitest run office/client/office-surface-panels.mounted.test.tsx --bail=1 > /tmp/office-t4.txt 2>&1; tail -30 /tmp/office-t4.txt
cd ..
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office
npm run format:files -- plugins/office/client
git add -A plugins/office
git commit -m "feat(office): a phone opens the office's column as a sheet over the floor"
```

---

### Task 5: The docs and a look

**Files:**

- Modify: `docs/plugins.md` (the office section)
- Modify: `docs/superpowers/specs/2026-11-18-office-own-column-design.md`
- Modify: `plugins/office/vendor/my-office/src/office/paseo-style.js` (only if the look says so)

**Interfaces:**

- Consumes: the built page from Tasks 1 to 4.
- Produces: nothing later tasks use.

- [ ] **Step 1: Rewrite what `docs/plugins.md` says of the panels**

In the office section, the paragraphs that say the Sessions and Activity buttons open panels "beside the floor", that the Activity feed "fills only while an office or a panel is open", and that the Chat button opens the chat beside the floor: rewrite them for the column. Say once: the office draws its own column (`plugins/office/client/office-column.tsx`) with Attention, Sessions, Activity and Chat tabs, because upstream's app has no side area; a phone gets a bar under the floor and a sheet (`column-sheet.tsx`); the panels read the surface's one subscription; width and collapsed are the `office-column` device setting, apart from `office-device` because that one is saved whole. Remove what is no longer true (the three screens, the link between two React trees). Follow the "Writing docs" and "Doc voice" rules in `CLAUDE.md`.

- [ ] **Step 2: Look at it in a browser**

The dev app cannot start from this checkout, and no Paseo daemon may be started, stopped or restarted. Bundle `OfficeSurface` into a static page under `/tmp` with the repo's esbuild, aliasing `react-native` to `react-native-web` and standing in for `@getpaseo/plugin/client` and `@getpaseo/plugin/client/ui` as the mounted tests do, with a state that has a few agents, a chat with messages and one attention entry. Serve it with `python3 -m http.server <port> --bind 0.0.0.0` and open it with the `mcp__paseo__browser_*` tools at the first address `hostname -i` prints.

At 1280 px and 390 px, light and dark, in the 2D and List views:

- 1280: the column is beside the floor, 360 wide; each tab shows its panel; the badges show; Collapse leaves the rail and a rail press opens the column; a drag of the handle changes the width and stops at 280 and 560; the view corner stays over the floor, not over the column.
- 390: the floor fills the page; the bar is under it; each tab opens the sheet; Close, a press above the sheet and Escape close it; the bar stays visible and pressable with the sheet open; Chat's text box is reachable.
- The walk-in Exit and the scene's top lines were moved down by `--corner-clear: 156px` in piece 1 for a corner that held three more buttons. The corner now holds the view switch and the settings button: one row. Work out its tallest height from `viewCorner`, `viewControls` and the control heights in `styles.ts` (touch control 44, the corner's padding and border, `top: pad`, and the unsaved-view line), set `--corner-clear` to that, and say the number and its sum in a comment there.

Fix what the look finds in the tasks' own files and re-run that file's tests. Spend at most about 30 minutes on the look; what could not be seen goes in the spec, truthfully.

- [ ] **Step 3: Record it in the spec**

Status line: "Status: pieces 1 and 2 built." Update "Not verified" with what this look did and did not see (at least: the 3D floor, and upstream's desktop app itself). In "The column's tabs", note that the chosen tab alone shows its label, since four labels do not fit a 280 px column.

- [ ] **Step 4: Commit**

```bash
npm run format:files -- docs/plugins.md docs/superpowers/specs/2026-11-18-office-own-column-design.md
git add -A docs plugins/office
git commit -m "docs(office): the office's own column"
```
