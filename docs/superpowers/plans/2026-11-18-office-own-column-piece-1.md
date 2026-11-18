# The office's settings screen and bare floor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the office's settings off the top of its page onto a Settings screen, and leave only a small view control over a corner of the floor.

**Architecture:** `HostSwitches` (the switches, the fields and their failures) is mounted unchanged by a new settings screen that the office registers with `client.addSettingsScreen`. `OfficeSurface` stops drawing it; the `ViewSwitch` and the panel buttons move into a corner of the floor, and the header keeps only the attention strip. A schedule that could not follow the settings adds a "Settings" card to the strip.

**Tech Stack:** React Native components in a Paseo built-in plugin (`plugins/office`), `@getpaseo/plugin/client` hooks, Vitest with jsdom for mounted tests.

**Spec:** `docs/superpowers/specs/2026-11-18-office-own-column-design.md` (piece 1 of its "Pieces" table).

## Global Constraints

- Work in `/workspace/QFlavours/paseo-onepage-docs` on branch `feat/office-own-column`. Every path below is relative to it.
- Use only client calls upstream's app has: `addSettingsScreen`, `useSettings`, `useSubscription`, `useRpc`. No new call on `navigation`.
- A plugin cannot open a settings screen: `navigation` has no such call. The "Settings" card opens a card of the office that names Settings > Office.
- The header keeps the attention strip and the corner keeps the Sessions, Activity and Chat buttons until piece 2 replaces both with the column.
- Run one test file at a time: `cd plugins && npx vitest run <file> --bail=1`. Never the whole suite.
- After each task: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, `npm run lint -- <changed files>`, `npm run format:files -- <changed files>` from the repo root.
- Commits carry no `Co-Authored-By` trailer and no "Generated with" line. Messages follow the fork's style: `feat(office): ...`, `docs(office): ...`.
- Follow `docs/coding-standards.md` and `docs/design.md`; styles go in `plugins/office/client/styles.ts`, never inline objects.

---

### Task 1: The strip's Settings card text

**Files:**

- Create: `plugins/office/client/settings-text.ts`
- Test: `plugins/office/client/settings-text.test.ts`

**Interfaces:**

- Consumes: `StripCard` from `./attention-strip.js` (`{ title: string; note: HostNote; onOpen(): void }`), `failureText(label, error)` from `./action-button.js`.
- Produces:
  - `settingsProblems(notesError: string | null, incidentsError: string | null): string[]`
  - `settingsEntry(problems: readonly string[], onOpen: () => void): StripCard | null`

- [ ] **Step 1: Write the failing test**

```ts
// plugins/office/client/settings-text.test.ts
import { expect, test } from "vitest";
import { settingsEntry, settingsProblems } from "./settings-text.js";

test("no schedule failure is no problem and no card", () => {
  expect(settingsProblems(null, null)).toEqual([]);
  expect(settingsEntry([], () => undefined)).toBeNull();
});

test("each schedule that could not follow the settings is a sentence", () => {
  expect(settingsProblems("unknown zone Mars/Olympus", "no such folder")).toEqual([
    "Unable to schedule the stand-up notes: unknown zone Mars/Olympus",
    "Unable to schedule the incidents check: no such folder",
  ]);
});

test("the card counts the problems, in the danger tone, and opens what it is given", () => {
  let opened = 0;
  const one = settingsEntry(["a"], () => {
    opened += 1;
  });
  expect(one?.title).toBe("Settings");
  expect(one?.note).toEqual({ text: "1 problem", tone: "danger" });
  one?.onOpen();
  expect(opened).toBe(1);
  expect(settingsEntry(["a", "b"], () => undefined)?.note.text).toBe("2 problems");
});
```

- [ ] **Step 2: Run it and see it fail**

Run: `cd plugins && npx vitest run office/client/settings-text.test.ts --bail=1`
Expected: FAIL, cannot find `./settings-text.js`.

- [ ] **Step 3: Write the module**

```ts
// plugins/office/client/settings-text.ts
import { failureText } from "./action-button.js";
import type { StripCard } from "./attention-strip.js";

/**
 * What the host could not do with the office's settings, one sentence each. Only the schedules:
 * a refused save or a failed switch shows on the settings screen as it happens.
 */
export function settingsProblems(
  notesError: string | null,
  incidentsError: string | null,
): string[] {
  const problems: string[] = [];
  if (notesError !== null) problems.push(failureText("Schedule the stand-up notes", notesError));
  if (incidentsError !== null) {
    problems.push(failureText("Schedule the incidents check", incidentsError));
  }
  return problems;
}

/** The strip's Settings card, while a schedule could not follow the settings. */
export function settingsEntry(problems: readonly string[], onOpen: () => void): StripCard | null {
  if (problems.length === 0) return null;
  const text = problems.length === 1 ? "1 problem" : `${problems.length} problems`;
  return { title: "Settings", note: { text, tone: "danger" }, onOpen };
}
```

- [ ] **Step 4: Run it and see it pass**

Run: `cd plugins && npx vitest run office/client/settings-text.test.ts --bail=1`
Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
npm run format:files -- plugins/office/client/settings-text.ts plugins/office/client/settings-text.test.ts
git add plugins/office/client/settings-text.ts plugins/office/client/settings-text.test.ts
git commit -m "feat(office): a schedule the settings broke has a card's words"
```

---

### Task 2: The Office settings screen

**Files:**

- Create: `plugins/office/client/office-settings.tsx`
- Test: `plugins/office/client/office-settings.mounted.test.tsx`
- Modify: `plugins/office/client/office-surface.tsx` (export `useViewChoice` at line 369 and `UNSAVED_VIEW` at line 323; nothing else)
- Modify: `plugins/office/index.client.tsx` (register the screen)

**Interfaces:**

- Consumes: `HostSwitches` (`./host-switches.js`, props unchanged), `ViewSwitch` (`./view-switch.js`), `useOffice` (`./use-office.js`), `useBoardActions` (`./use-board-actions.js`), `useOfficeStyles` (`./styles.js`), and from `./office-surface.js`: `useViewChoice(platform)`, `UNSAVED_VIEW`, `hasTouchScreen`, `readPointer`.
- Produces: `OfficeSettings` (a `ComponentType<PluginSurfaceProps>`), and the settings screen id `"office"`.

- [ ] **Step 1: Export the view choice from the surface**

In `plugins/office/client/office-surface.tsx` change

```ts
const UNSAVED_VIEW = "Unable to save the view on this device. It holds until the office is closed.";
```

to

```ts
export const UNSAVED_VIEW =
  "Unable to save the view on this device. It holds until the office is closed.";
```

and `function useViewChoice(platform: Platform): ViewChoiceState {` to
`export function useViewChoice(platform: Platform): ViewChoiceState {`. Export `ViewChoiceState` too.

- [ ] **Step 2: Write the failing mounted test**

```tsx
// plugins/office/client/office-settings.mounted.test.tsx
/**
 * @vitest-environment jsdom
 */
// The Office settings screen, mounted as the app mounts a settings screen. The host's hooks are
// stood in: the settings record what was saved, and the office's subscription speaks only when a
// test delivers an event.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeEvent } from "../shared/contracts.js";
import { officeHostSettings } from "../shared/settings.js";
import { EMPTY_OFFICE } from "./office-state.js";

let hostSaves: unknown[];
let deviceSaves: unknown[];
let deliver: ((event: OfficeEvent) => void) | null;

vi.mock("@getpaseo/plugin/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@getpaseo/plugin/client")>()),
  useSettings: (settings: { id: string }) => {
    const device = settings.id === "office-device";
    return {
      status: "ready",
      revision: "r1",
      values: device
        ? { threeD: true, view: "list", rungIncidents: {} }
        : officeHostSettings.schema.parse({}),
      saving: false,
      saveError: null,
      save: async (values: unknown) => {
        (device ? deviceSaves : hostSaves).push(values);
        return true;
      },
      reset: async () => true,
      reload: async () => undefined,
    };
  },
  useSubscription: (
    contract: { name: string },
    _input: unknown,
    onEvent: (event: OfficeEvent) => void,
  ) => {
    if (contract.name === "office.state") deliver = onEvent;
    return { status: "live" };
  },
  useRpc: () => async () => undefined,
  usePaseo: () => ({ agents: { ref: () => ({}) } }),
}));

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput, View } = await import("react-native");
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  const Icon = (props: { name: string }) => createElement(View, { testID: `icon-${props.name}` });
  return {
    ExternalLink: () => null,
    Icon,
    Markdown: () => null,
    Modal,
    ScrollView,
    TextInput,
    copyText: async () => undefined,
    useToast: () => ({ show: () => undefined, error: () => undefined }),
  };
});

vi.mock("./web-env.web.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./web-env.web.js")>()),
  hasWebGL2: () => false,
}));

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
let container: HTMLElement;
let root: Root;

async function mount(): Promise<void> {
  const { OfficeSettings } = await import("./office-settings.js");
  const props = {
    theme: THEME,
    layout: { compact: false, platform: "web" },
    host: { id: "host", label: "Host" },
  } as unknown as PluginSurfaceProps;
  await act(async () => root.render(createElement(OfficeSettings, props)));
}

function labelled(label: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(`[aria-label^="${label}"]`);
}

beforeEach(() => {
  hostSaves = [];
  deviceSaves = [];
  deliver = null;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("the screen holds the switches, the fields and the view", async () => {
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  expect(labelled("Wake agents")?.getAttribute("role")).toBe("switch");
  expect(labelled("Agent tools")?.getAttribute("role")).toBe("switch");
  for (const field of ["Notes folder", "Time zone", "Jira projects", "Sentry organisation"]) {
    expect(container.querySelector(`input[aria-label="${field}"]`)).not.toBeNull();
  }
  expect(labelled("List view")?.getAttribute("aria-selected")).toBe("true");
});

test("a view chosen here is saved on the device", async () => {
  await mount();
  await act(async () => labelled("2D view")?.click());

  expect(deviceSaves).toEqual([{ threeD: true, view: "2d", rungIncidents: {} }]);
  expect(hostSaves).toEqual([]);
});

test("the notes schedule's failure shows under the Time zone field", async () => {
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

  expect(container.textContent).toContain(
    "Unable to schedule the stand-up notes: unknown zone Mars/Olympus",
  );
});
```

If `NotesStateSchema` (`plugins/office/shared/contracts.ts:191`) has fields the object above lacks, add them with the schema's own empty values; do not cast.

- [ ] **Step 3: Run it and see it fail**

Run: `cd plugins && npx vitest run office/client/office-settings.mounted.test.tsx --bail=1`
Expected: FAIL, cannot find `./office-settings.js`.

- [ ] **Step 4: Write the screen**

```tsx
// plugins/office/client/office-settings.tsx
import { useMemo } from "react";
import { View } from "react-native";
import type { PluginSurfaceProps } from "@getpaseo/plugin/client";
import { HostSwitches } from "./host-switches.js";
import { UNSAVED_VIEW, hasTouchScreen, readPointer, useViewChoice } from "./office-surface.js";
import { useOfficeStyles } from "./styles.js";
import { useBoardActions } from "./use-board-actions.js";
import { useOffice } from "./use-office.js";
import { ViewSwitch } from "./view-switch.js";

/**
 * The office's settings, under the app's Settings: what the host holds (wakes, agent tools, the
 * stand-up notes, the incident trackers) and this device's view. The office's page shows none of
 * them, so a phone's floor is not covered.
 */
export function OfficeSettings({ theme, layout }: PluginSurfaceProps) {
  const touchScreen = useMemo(
    () => hasTouchScreen(layout.platform, layout.platform === "web" ? readPointer() : null),
    [layout.platform],
  );
  const styles = useOfficeStyles(theme, layout.compact, touchScreen);
  const office = useOffice();
  const actions = useBoardActions();
  const view = useViewChoice(layout.platform);
  // Frozen data says nothing of the wakes: the switch is then not usable.
  const live = office.subscription.status !== "error" && office.subscription.status !== "closed";
  return (
    <View style={styles.header}>
      <HostSwitches
        wake={office.loaded && live ? office.state.wake : null}
        actions={actions}
        styles={styles}
        deviceProblem={view.unsaved ? UNSAVED_VIEW : null}
        scheduleError={office.state.notes?.scheduleError ?? null}
        incidents={office.state.incidents}
      >
        <ViewSwitch
          options={view.options}
          value={view.choice}
          onChange={view.choose}
          styles={styles}
        />
      </HostSwitches>
    </View>
  );
}
```

- [ ] **Step 5: Register it**

In `plugins/office/index.client.tsx` add `import { OfficeSettings } from "./client/office-settings.js";` and, in `removers` after the Chat screen:

```tsx
    client.addSettingsScreen({
      id: SCREEN_ID,
      title: "Office",
      icon: ICON,
      Component: OfficeSettings,
    }),
```

Replace the comment above `contribute` with:

```ts
// The sidebar item and the Command Center item are the ways in; Settings > Sidebar can hide the
// item. The office's settings are a screen of the app's Settings.
```

- [ ] **Step 6: Run the test and the typecheck**

Run: `cd plugins && npx vitest run office/client/office-settings.mounted.test.tsx --bail=1`
Expected: 3 passed.
Run: `npm run typecheck --workspace=@getpaseo/builtin-plugins`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
npm run format:files -- plugins/office/client/office-settings.tsx plugins/office/client/office-settings.mounted.test.tsx plugins/office/client/office-surface.tsx plugins/office/index.client.tsx
npm run lint -- plugins/office/client/office-settings.tsx plugins/office/index.client.tsx
git add plugins/office/client/office-settings.tsx plugins/office/client/office-settings.mounted.test.tsx plugins/office/client/office-surface.tsx plugins/office/index.client.tsx
git commit -m "feat(office): the office's settings are a screen of Settings"
```

---

### Task 3: The bare floor

**Files:**

- Create: `plugins/office/client/settings-problems-card.tsx`
- Modify: `plugins/office/client/office-surface.tsx` (the header at lines 936-972, the body at 976-1004, the strip's cards at 912-933)
- Modify: `plugins/office/client/styles.ts` (three styles)
- Modify: `plugins/office/client/office-surface-panels.mounted.test.tsx`

**Interfaces:**

- Consumes: `settingsProblems`, `settingsEntry` (Task 1); `Modal` from `@getpaseo/plugin/client/ui`.
- Produces: `SettingsProblemsCard({ problems, open, styles, onClose })`; styles `floor`, `viewCorner`, `viewRow`.

- [ ] **Step 1: Change the mounted tests to the new page**

In `plugins/office/client/office-surface-panels.mounted.test.tsx`:

Replace the file's opening comment's first sentence with "The office's page, mounted as the app mounts the screen: nothing of the settings is on it, and the view switch and the panel buttons sit over the floor's corner."

Add these tests after `afterEach`:

```tsx
test("the page has no settings: no switch and no field", async () => {
  await mount();
  await act(async () => deliver?.({ type: "snapshot", state: EMPTY_OFFICE }));

  expect(container.querySelector('[role="switch"]')).toBeNull();
  expect(container.querySelector("input")).toBeNull();
});

test("a schedule the settings broke shows a Settings card that says where to fix it", async () => {
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

  const card = [...container.querySelectorAll<HTMLElement>('[role="button"]')].find((button) =>
    button.textContent?.includes("Settings"),
  );
  if (!card) throw new Error("The strip has no Settings card");
  await act(async () => card.click());

  const sheet = container.querySelector('section[aria-label="Office settings"]');
  expect(sheet?.textContent).toContain(
    "Unable to schedule the stand-up notes: unknown zone Mars/Olympus",
  );
  expect(sheet?.textContent).toContain("Settings, under Office");
});
```

In the test "the header has Chat after Activity, and a press opens the chat beside the floor" the expected `buttonLabels()` stays `["2D view", "List view", "Sessions", "Activity", "Chat"]`: the corner keeps the switch before the buttons, and with no snapshot delivered the strip draws nothing.

- [ ] **Step 2: Run them and see the two new tests fail**

Run: `cd plugins && npx vitest run office/client/office-surface-panels.mounted.test.tsx --bail=1 > /tmp/office-panels.txt 2>&1; tail -30 /tmp/office-panels.txt`
Expected: FAIL at "the page has no settings" (a switch is found).

- [ ] **Step 3: Add the styles**

In `plugins/office/client/styles.ts`, add to the `OfficeStyles` interface after `header`:

```ts
/** Holds the floor and what lies over its corner. */
floor: ViewStyle;
/** The view switch and the panel buttons over the floor's top right corner. */
viewCorner: ViewStyle;
/** The same controls in the page's flow, above a view that scrolls under them. */
viewRow: ViewStyle;
```

and to the object built in `useOfficeStyles`, after `header`:

```ts
      floor: { flex: 1 },
      // Top right: the scene's camera bar is at the bottom centre and its note bottom left.
      viewCorner: {
        position: "absolute",
        top: pad,
        right: pad,
        zIndex: 1,
        alignItems: "flex-end",
        gap: 4,
        maxWidth: 360,
      },
      viewRow: { ...column, alignItems: "flex-end", gap: 4, paddingHorizontal: pad, paddingTop: 8 },
```

- [ ] **Step 4: Write the problems card**

```tsx
// plugins/office/client/settings-problems-card.tsx
import { useCallback } from "react";
import { Text, View } from "react-native";
import { Modal } from "@getpaseo/plugin/client/ui";
import type { OfficeStyles } from "./styles.js";

export interface SettingsProblemsCardProps {
  /** What the host could not do with the office's settings, one sentence each. */
  problems: readonly string[];
  open: boolean;
  styles: OfficeStyles;
  onClose(): void;
}

/**
 * What the strip's Settings card opens. A plugin cannot open a screen of the app's Settings, so
 * the card says what failed and where the setting is.
 */
export function SettingsProblemsCard({
  problems,
  open,
  styles,
  onClose,
}: SettingsProblemsCardProps) {
  const change = useCallback(
    (next: boolean) => {
      if (!next) onClose();
    },
    [onClose],
  );
  return (
    <Modal title="Office settings" open={open} onOpenChange={change}>
      <Modal.Content>
        <View style={styles.sheet}>
          {problems.map((problem) => (
            <Text key={problem} accessibilityRole="alert" style={styles.actionError}>
              {problem}
            </Text>
          ))}
          <Text style={styles.rowMeta}>Change it in Settings, under Office.</Text>
        </View>
      </Modal.Content>
    </Modal>
  );
}
```

- [ ] **Step 5: Take the settings out of the surface's header**

In `plugins/office/client/office-surface.tsx`:

1. Remove `import { HostSwitches } from "./host-switches.js";`. Add
   `import { SettingsProblemsCard } from "./settings-problems-card.js";` and
   `import { settingsEntry, settingsProblems } from "./settings-text.js";`.

2. After `const incidentsStripEntry = useMemo(...)` (line 908) add:

```tsx
const notesScheduleError = office.state.notes?.scheduleError ?? null;
const incidentsScheduleError = incidents?.scheduleError ?? null;
const problems = useMemo(
  () => settingsProblems(notesScheduleError, incidentsScheduleError),
  [notesScheduleError, incidentsScheduleError],
);
const settingsCard = useCardOpening(live);
const { show: openSettingsProblems } = settingsCard;
const settingsStripEntry = useMemo(
  () => settingsEntry(problems, openSettingsProblems),
  [problems, openSettingsProblems],
);
```

3. In `cards` put `settingsStripEntry` after `incidentsStripEntry`, in both the array and the dependency list.

4. Replace the JSX from `<View style={styles.header}>` through the closing `/>` of `<SurfaceBody ... />` (lines 938-1004) with:

```tsx
{
  live ? (
    <View style={styles.header}>
      <AttentionStrip
        entries={model.attention}
        cards={cards}
        styles={styles}
        wrap={!layout.compact}
        onSelect={selectFromStrip}
      />
    </View>
  ) : null;
}
{
  viewChoice.choice === "3d" && sceneProblem !== null ? (
    <SceneProblem message={sceneProblem} onRetry={retryScene} styles={styles} />
  ) : null;
}
<View style={styles.floor}>
  {/* A floor is drawn under the corner; the list scrolls, so its controls take a row. */}
  <View style={view === "3d" || view === "2d" ? styles.viewCorner : styles.viewRow}>
    <View style={styles.headerControls}>
      <ViewSwitch
        options={viewChoice.options}
        value={viewChoice.choice}
        onChange={changeView}
        styles={styles}
      />
      <PanelButtons
        navigation={navigation}
        link={link}
        compact={layout.compact}
        touchScreen={touchScreen}
        color={theme.colors.foreground}
        unread={unread}
        styles={styles}
      />
    </View>
    {viewChoice.unsaved ? (
      <Text accessibilityRole="alert" style={styles.actionError}>
        {UNSAVED_VIEW}
      </Text>
    ) : null}
  </View>
  <SurfaceBody
    office={office}
    model={model}
    rooms={rooms}
    view={view}
    theme={theme}
    focusRoomId={focusRoomId}
    focusRequest={focusRequest}
    selectedAgentId={kept}
    styles={styles}
    compact={layout.compact}
    actions={actions}
    name={name}
    onSelectAgent={setSelectedId}
    onOpenSession={navigation ? openSession : undefined}
    onOpenBoard={board.open}
    machine={machine}
    onOpenMachine={openMachine}
    onOpenResources={openResources}
    onOpenLibrary={library.show}
    onOpenNotes={openNotes}
    janitor={janitorEntry?.note ?? null}
    onOpenJanitor={openJanitor}
    meeting={standup.open}
    incidents={incidents}
    onOpenIncidents={openIncidents}
    onSceneProblem={setSceneProblem}
    platform={layout.platform}
  />
</View>;
```

`styles.headerControls` has `paddingHorizontal: pad`; inside `viewCorner` that doubles the right inset. If the browser look in Task 4 shows the switch 2 × pad from the edge, give `viewCorner` `right: 0` and `viewRow` `paddingHorizontal: 0` rather than adding a style.

5. After `<IncidentsCard ... />` add:

```tsx
<SettingsProblemsCard
  problems={problems}
  open={settingsCard.open}
  styles={styles}
  onClose={settingsCard.close}
/>
```

6. `boardActions` is still used by the stand-up, the reviews, the library and the board sheet; leave it. Remove any import this change left unused (`type ReactNode` stays: `ProblemBanner` uses it).

- [ ] **Step 6: Run the surface's tests**

Run: `cd plugins && npx vitest run office/client/office-surface-panels.mounted.test.tsx --bail=1 > /tmp/office-panels.txt 2>&1; tail -30 /tmp/office-panels.txt`
Expected: every test passes, the two new ones included.
Run: `cd plugins && npx vitest run office/client/office-surface.test.ts office/client/host-switches.mounted.test.tsx office/client/office-settings.mounted.test.tsx --bail=1`
Expected: all pass (the pure tests and the settings are unchanged).

- [ ] **Step 7: Typecheck, lint, format, commit**

```bash
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/client/office-surface.tsx plugins/office/client/settings-problems-card.tsx plugins/office/client/styles.ts
npm run format:files -- plugins/office/client/office-surface.tsx plugins/office/client/settings-problems-card.tsx plugins/office/client/styles.ts plugins/office/client/office-surface-panels.mounted.test.tsx
git add plugins/office/client
git commit -m "feat(office): nothing of the settings is on the office's page, and the view switch sits over the floor's corner"
```

---

### Task 4: The docs and a look

**Files:**

- Modify: `docs/plugins.md` (the office section: lines 633-644, 747, 775, 925)
- Modify: `docs/superpowers/specs/2026-11-18-office-own-column-design.md` (its status line and a "Not verified" section)

**Interfaces:**

- Consumes: the built page from Tasks 2 and 3.
- Produces: nothing later tasks use.

- [ ] **Step 1: Rewrite what `docs/plugins.md` says of the header**

- Line 633: "The header's switch chooses one per device" becomes "A switch over the floor's top right corner chooses one per device; the Office screen of the app's Settings has the same switch".
- Line 644: "The header's Sessions and Activity buttons" becomes "The Sessions and Activity buttons beside that switch".
- Where the section names "Agent tools", "Wake agents", "Notes folder" and "the office's settings" (lines 747, 770, 775, 925), say once, at the first of them, that they are on the Office screen of the app's Settings (`plugins/office/client/office-settings.tsx`), and that a schedule that cannot follow them adds a Settings card to the office's strip. Do not repeat it at the others.

Follow the "Doc voice" rules in `CLAUDE.md`.

- [ ] **Step 2: Look at it in a browser**

Follow `docs/development.md` for the dev daemon and Expo web. If the dev app cannot start from this checkout, bundle `OfficeSurface` and `OfficeSettings` into a static page as the earlier office looks did, and say so in the spec. Never start or restart the daemon on port 6767.

Look at 1280 px and 390 px, light and dark, in the 3D, 2D and List views, with a `navigation` that has no `showBeside`:

- Nothing is above the floor except the strip when it has an entry.
- The view switch is in the top right corner of the 3D and 2D floors and covers none of the scene's own controls, walk-in's Exit included; above the List it is a row of its own.
- A tap on each view changes the view.
- Settings > Office shows the two switches, the six fields and the view switch, and a change there shows in the office.

Fix what the look finds in the task's own files, and re-run that file's tests.

- [ ] **Step 3: Record it in the spec**

Change the spec's status line to "Status: piece 1 built." Add a "Not verified" section listing what the look could not show (at least: upstream's desktop app itself, and anything Step 2 had to stand in for).

- [ ] **Step 4: Commit**

```bash
npm run format:files -- docs/plugins.md docs/superpowers/specs/2026-11-18-office-own-column-design.md
git add docs/plugins.md docs/superpowers/specs/2026-11-18-office-own-column-design.md
git commit -m "docs(office): the settings screen and the bare floor"
```
