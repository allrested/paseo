# Office small fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Gym is named Library and the library on the 3D floor opens its card; a board's "Wake an agent with it" is a page with every agent in reach; the lobby's sign shows the host's brand.

**Architecture:** Everything is in the office plugin (`plugins/office`). Pure text modules carry the rules and have unit tests. Components are tested mounted in jsdom, with plain stand-ins for the host's kit. The 3D scene gets two optional start options and one new file of Paseo's beside upstream's files, which stay untouched.

**Tech Stack:** TypeScript, React Native (react-native-web under vitest), vitest, the plugin kit (`@getpaseo/plugin/client/ui`), three.js r160 in the vendored scene (plain JavaScript).

**Spec:** `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`, sub-project 1.

## Global Constraints

- Work in `/workspace/QFlavours/paseo` on branch `feat/office-owner-review`. Do not push.
- No commit carries AI attribution: no `Co-Authored-By` trailer, no "Generated with" line.
- Run one test file at a time, from the repo root: `npx vitest run <file> --bail=1`. Never run a whole suite.
- After each task's code: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, then `npm run lint -- <changed .ts/.tsx files>`, then `npm run format:files -- <changed files>`. The pre-commit hook runs the format check, the lint and the full typecheck (about 45 s).
- No upstream file under `plugins/office/vendor/my-office/` changes. Only Paseo's own files there (`src/office/paseo-*.js`) and `import-upstream.mjs`. The formatter and the linter skip `plugins/office/vendor/**`.
- No file, export or field keeps "gym" or "train". The skill request's text and its mark (`SKILL_MARK`, `skillAsk`) do not change.
- Copy, exactly: "Library", "N at a skill", "Teach a skill", "Wake an agent with it", "Wake an agent", "Nobody", "This room", "Other rooms", "No agent matches.", "Paseo".
- The search field shows when the office has more than eight agents.
- DOM access stays in `*.web.ts` files or in effects: the plugin's client is bundled for every platform.
- Never restart the daemon on port 6767. No agent is created or prompted for a check.

---

### Task 1: The Gym is named Library

**Files:**

- Rename: `plugins/office/client/gym-text.ts` → `library-text.ts`, `gym-text.test.ts` → `library-text.test.ts`, `gym-card.tsx` → `library-card.tsx`, `use-gym.ts` → `use-library.ts`
- Modify: `plugins/office/client/office-surface.tsx`
- Modify (one comment each): `plugins/office/index.server.ts:57`, `plugins/office/shared/contracts.ts:296`, `plugins/office/client/pixel/actors.ts:26`, `plugins/office/client/pixel/actors.test.ts:45`
- Modify: `docs/plugins.md` (the paragraph that starts "The Gym entry")
- Test: `plugins/office/client/library-text.test.ts`

**Interfaces:**

- Produces, from `./library-text.js`: `LibraryTeam { roomId; name; atSkill: string[]; writers: AskAgent[]; asked: LibraryAsked | null; skills }`, `LibraryAsked`, `libraryTeams(model, skills)`, `libraryNote(teams)`, `librarySummary(teams, skills, failed?)`, `LIBRARY_HELP`, `askHint(team, chosen, wakesPaused)`. Unchanged names: `skillAsk`, `skillWhere`, `topicOf`, `SKILL_MARK`, `TOPIC_MAX`, `HOST_SKILLS_SHOWN`.
- Produces, from `./library-card.js`: `LibraryCard`, `LibraryCardProps`. From `./use-library.js`: `useLibrary(input: LibraryInput): Library`.

- [ ] **Step 1: Rename the test and point it at the new names**

```bash
cd /workspace/QFlavours/paseo
git mv plugins/office/client/gym-text.test.ts plugins/office/client/library-text.test.ts
sed -i -E \
  -e 's/\$\{at\} training/${at} at a skill/' \
  -e 's/"1 training"/"1 at a skill"/' \
  -e 's/who trains now/who is at a skill now/g' \
  -e 's/who trains,/who is at a skill,/g' \
  -e 's/\bGymCardProps\b/LibraryCardProps/g' \
  -e 's/\bGymCard\b/LibraryCard/g' \
  -e 's/\bGymTeam\b/LibraryTeam/g' \
  -e 's/\bGymAsked\b/LibraryAsked/g' \
  -e 's/\bGymInput\b/LibraryInput/g' \
  -e 's/\bgymAskedOf\b/libraryAskedOf/g' \
  -e 's/\bgymTeams\b/libraryTeams/g' \
  -e 's/\bgymSummary\b/librarySummary/g' \
  -e 's/\bgymNote\b/libraryNote/g' \
  -e 's/\bGYM_HELP\b/LIBRARY_HELP/g' \
  -e 's/\buseGym\b/useLibrary/g' \
  -e 's/\bGym\b/Library/g' \
  -e 's/\bgym\b/library/g' \
  -e 's/\btrainHint\b/askHint/g' \
  -e 's/\btrainers\b/writers/g' \
  -e 's/\btrainer\b/writer/g' \
  -e 's/\btraining\b/atSkill/g' \
  plugins/office/client/library-text.test.ts
```

The first two expressions come first on purpose: they turn the strip's note into "N at a skill" before the last one renames the field `training`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run plugins/office/client/library-text.test.ts --bail=1`
Expected: FAIL, the import of `./library-text.js` cannot be resolved.

- [ ] **Step 3: Rename the three source files and their names**

```bash
cd /workspace/QFlavours/paseo
git mv plugins/office/client/gym-text.ts plugins/office/client/library-text.ts
git mv plugins/office/client/gym-card.tsx plugins/office/client/library-card.tsx
git mv plugins/office/client/use-gym.ts plugins/office/client/use-library.ts
sed -i -E \
  -e 's/\$\{at\} training/${at} at a skill/' \
  -e 's/"1 training"/"1 at a skill"/' \
  -e 's/who trains now/who is at a skill now/g' \
  -e 's/who trains,/who is at a skill,/g' \
  -e 's/\bGymCardProps\b/LibraryCardProps/g' \
  -e 's/\bGymCard\b/LibraryCard/g' \
  -e 's/\bGymTeam\b/LibraryTeam/g' \
  -e 's/\bGymAsked\b/LibraryAsked/g' \
  -e 's/\bGymInput\b/LibraryInput/g' \
  -e 's/\bgymAskedOf\b/libraryAskedOf/g' \
  -e 's/\bgymTeams\b/libraryTeams/g' \
  -e 's/\bgymSummary\b/librarySummary/g' \
  -e 's/\bgymNote\b/libraryNote/g' \
  -e 's/\bGYM_HELP\b/LIBRARY_HELP/g' \
  -e 's/\buseGym\b/useLibrary/g' \
  -e 's/\bGym\b/Library/g' \
  -e 's/\bgym\b/library/g' \
  -e 's/\btrainHint\b/askHint/g' \
  -e 's/\btrainers\b/writers/g' \
  -e 's/\btrainer\b/writer/g' \
  -e 's/\btraining\b/atSkill/g' \
  plugins/office/client/library-text.ts \
  plugins/office/client/library-card.tsx \
  plugins/office/client/use-library.ts \
  plugins/office/client/office-surface.tsx
```

What this leaves, to read once and confirm:

- `library-text.ts`: `libraryNote` returns `` `${at} at a skill` `` or `"Teach a skill"`; the private helper is `function atSkill(teams)` and reads `team.atSkill`.
- `library-card.tsx`: `<Modal title="Library" ...>`.
- `use-library.ts`: the strip's entry is `{ title: "Library", note, onOpen }`.
- `office-surface.tsx`: `const library = useLibrary({ ... })`, `library.entry` in the strip's cards, `<LibraryCard teams={library.teams} ... />`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run plugins/office/client/library-text.test.ts --bail=1`
Expected: PASS, every test of the file.

Run: `npx vitest run plugins/office/client/office-surface.test.ts --bail=1`
Expected: PASS (it loads `office-surface.tsx`, which imports the renamed modules).

- [ ] **Step 5: Say library in the four comments that say gym**

```bash
cd /workspace/QFlavours/paseo
sed -i "s|/\*\* The host's skills folders the gym lists. \*/|/** The host's skills folders the library lists. */|" plugins/office/index.server.ts
sed -i "s|/\*\* A skill as the gym lists it: one per name, with the folders it is in. \*/|/** A skill as the library lists it: one per name, with the folders it is in. */|" plugins/office/shared/contracts.ts
sed -i "s|// The library is the gym: my-office's own library is where a skill is opened.|// A skill is opened at the library, as in my-office.|" plugins/office/client/pixel/actors.ts
sed -i "s|// (the library is the gym: a skill is opened there, with the book that reading has)|// (a skill is opened at the library, with the book that reading has)|" plugins/office/client/pixel/actors.test.ts
grep -rniE "gym|train" plugins/office --include='*.ts' --include='*.tsx' --exclude-dir=vendor
```

Expected: the `grep` prints nothing.

- [ ] **Step 6: Describe the Library entry in `docs/plugins.md`**

In the paragraph that starts "The Gym entry is in the strip", replace its first sentence pair

```markdown
The Gym entry is in the strip while the office has a team. The library is the gym: an agent whose
step opens a skill (Claude Code's `Skill` tool), reads or writes a `SKILL.md`, or runs a command
that names one goes there, and the step's kind is `skill`.
```

with

```markdown
The Library entry is in the strip while the office has a team. An agent whose step opens a skill
(Claude Code's `Skill` tool), reads or writes a `SKILL.md`, or runs a command that names one goes
to the library, and the step's kind is `skill`.
```

and its last sentence

```markdown
Design: [the gym](superpowers/specs/2026-11-16-office-gym-design.md).
```

with

```markdown
Design: [the gym](superpowers/specs/2026-11-16-office-gym-design.md), named Library by
[the owner's review](superpowers/specs/2026-11-16-office-owner-review-design.md).
```

- [ ] **Step 7: Check and commit**

```bash
cd /workspace/QFlavours/paseo
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/client/library-text.ts plugins/office/client/library-text.test.ts plugins/office/client/library-card.tsx plugins/office/client/use-library.ts plugins/office/client/office-surface.tsx
npm run format:files -- plugins/office/client/library-text.ts plugins/office/client/library-text.test.ts plugins/office/client/library-card.tsx plugins/office/client/use-library.ts plugins/office/client/office-surface.tsx plugins/office/index.server.ts plugins/office/shared/contracts.ts plugins/office/client/pixel/actors.ts plugins/office/client/pixel/actors.test.ts docs/plugins.md
git add -A plugins/office docs/plugins.md
git commit -m "feat(office): the Gym is named Library"
```

Expected: typecheck and lint print no error; the commit succeeds.

---

### Task 2: The library on the floor opens the Library card

**Files:**

- Modify: `plugins/office/client/library-card.tsx` (the host's skills show without a team)
- Create: `plugins/office/client/library-card.mounted.test.tsx`
- Modify: `plugins/office/client/use-library.ts` (`show`)
- Modify: `plugins/office/client/world/world-api.ts` (`onLibrary`)
- Modify: `plugins/office/client/world/world-view.tsx` (`onOpenLibrary`)
- Modify: `plugins/office/client/office-surface.tsx`
- Modify: `plugins/office/vendor/my-office/src/office/paseo-host.js`, `plugins/office/vendor/my-office/src/office/paseo-entry.js`
- Modify: `plugins/office/server/world-script.test.ts`
- Modify: `plugins/office/vendor/SOURCES.md`, `docs/plugins.md`

**Interfaces:**

- Consumes: `LibraryCard`, `useLibrary` from Task 1.
- Produces: `Library.show(): void`; `WorldStartOptions.onLibrary?(): void`; `WorldViewProps.onOpenLibrary(): void`; in the scene, `host.library` (a function or `null`).

- [ ] **Step 1: Write the failing mounted test of the card**

Create `plugins/office/client/library-card.mounted.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
// The Library card, mounted. The sheet and its inputs are the host's, so plain stand-ins show
// what the card passed them.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { SkillsResult } from "../shared/contracts.js";
import { LibraryCard } from "./library-card.js";
import { useOfficeStyles } from "./styles.js";

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput } = await import("react-native");
  const Modal = (props: { title: string; open: boolean; children: ReactNode }) =>
    props.open ? createElement("section", { "aria-label": props.title }, props.children) : null;
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  // (board-sheet.tsx, which the card takes its chips from, draws an icon from Task 4 on)
  const Icon = () => null;
  return { Icon, Modal, ScrollView, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;
const SKILLS: SkillsResult = {
  host: [{ name: "deploy", description: "Ship a release", folders: [".claude"] }],
  workspaces: {},
  readAt: "2026-11-16T08:00:00.000Z",
};
const nothing = async () => undefined;
const ignore = () => undefined;

function Harness({ skills }: { skills: SkillsResult | null }) {
  const styles = useOfficeStyles(THEME, false, false);
  return (
    <LibraryCard
      teams={[]}
      skills={skills}
      readFailure={null}
      open
      read={nothing}
      teach={nothing}
      wakesPaused={false}
      onOpenBoard={ignore}
      styles={styles}
      onClose={ignore}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

test("an office without a team still lists the host's skills", async () => {
  await act(async () => root.render(<Harness skills={SKILLS} />));
  const card = container.querySelector('section[aria-label="Library"]');
  expect(card?.textContent).toContain("On this host");
  expect(card?.textContent).toContain("deploy");
});

test("before the first reading there is no list of the host's", async () => {
  await act(async () => root.render(<Harness skills={null} />));
  const card = container.querySelector('section[aria-label="Library"]');
  expect(card?.textContent).toContain("Reading the skills on this host.");
  expect(card?.textContent).not.toContain("On this host");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run plugins/office/client/library-card.mounted.test.tsx --bail=1`
Expected: FAIL in "an office without a team still lists the host's skills": the text has no "On this host".

- [ ] **Step 3: Show the host's skills without a team**

In `plugins/office/client/library-card.tsx`, in `LibraryCard`, replace

```tsx
          {teams.length === 0 ? null : (
            <View style={styles.standupTeams}>
```

with

```tsx
          {teams.length === 0 && skills === null ? null : (
            <View style={styles.standupTeams}>
```

and, a few lines below, replace

```tsx
{
  skills === null ? null : (
    <>
      <View style={styles.rowDivider} />
      <HostSkills skills={skills.host} styles={styles} />
    </>
  );
}
```

with

```tsx
{
  skills === null ? null : (
    <>
      {teams.length === 0 ? null : <View style={styles.rowDivider} />}
      <HostSkills skills={skills.host} styles={styles} />
    </>
  );
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run plugins/office/client/library-card.mounted.test.tsx --bail=1`
Expected: PASS, 2 tests.

- [ ] **Step 5: Ask the built scene for the new option (failing build test)**

In `plugins/office/server/world-script.test.ts`, in the test "builds into one script that sets the page's API and needs nothing a browser lacks", add after `expect(script).toContain("PaseoOfficeWorld");`:

```ts
// The library's chip and the bookshelf tell Paseo, which opens its Library card.
expect(script).toContain("onLibrary");
```

Run: `npx vitest run plugins/office/server/world-script.test.ts --bail=1`
Expected: FAIL: the script does not contain "onLibrary". (The build takes up to a minute.)

- [ ] **Step 6: Let the scene tell Paseo that the library was chosen**

In `plugins/office/vendor/my-office/src/office/paseo-host.js`, add after the `machine: null,` line:

```js
  /** The library's chip or the bookshelf was chosen; null while Paseo has nothing to open for them. */
  library: null,
```

In `plugins/office/vendor/my-office/src/office/paseo-entry.js`:

Replace the comment over `start`

```js
   * whiteboard), onProblem(message), and, when Paseo has something to show for them, onMachine()
   * (the server racks) and onToast(text). Throws when the world cannot be built (no WebGL, a
   * module failed).
```

with

```js
   * whiteboard), onProblem(message), and, when Paseo has something to show for them, onMachine()
   * (the server racks), onLibrary() (the library's chip and the bookshelf) and onToast(text).
   * Throws when the world cannot be built (no WebGL, a module failed).
```

After the line `host.toast = (text) => options.onToast?.(text);` add:

```js
host.library = typeof options.onLibrary === "function" ? () => options.onLibrary() : null;
```

After the line `if (PLACES?.board) PLACES.board.open = () => host.board();` add:

```js
// (the library's chip and the bookshelf open Paseo's Library card, which has the skills; upstream's card there
// lists what was read since the office opened)
if (PLACES?.library && host.library) PLACES.library.open = () => host.library();
```

A place with an `open` skips upstream's card for the chip (`place-chips.js`, the chip's click) and for the bookshelf (`interact/props.js` `activateProp` calls `openPlace`, which calls `open` first). Neither upstream file changes.

- [ ] **Step 7: Run the build test to verify it passes**

Run: `npx vitest run plugins/office/server/world-script.test.ts --bail=1`
Expected: PASS, 3 tests.

- [ ] **Step 8: Open the card from the 3D view**

In `plugins/office/client/use-library.ts`:

Add to `interface Library`, after `open: boolean;`:

```ts
  /** Opens the card: the strip's entry does, and the library on the 3D floor. */
  show(): void;
```

Replace `const onOpen = useCallback(() => setOpened(true), []);` with:

```ts
const show = useCallback(() => setOpened(true), []);
```

Replace

```ts
    return note === null ? null : { title: "Library", note, onOpen };
  }, [teams, onOpen]);
```

with

```ts
    return note === null ? null : { title: "Library", note, onOpen: show };
  }, [teams, show]);
```

Replace the hook's `return` with:

```ts
return { teams, skills, readFailure, entry, open, show, read, teach, openBoard, close };
```

In `plugins/office/client/world/world-api.ts`, add to `WorldStartOptions`, after `onMachine?(): void;`:

```ts
  /** The library was chosen: its chip or the bookshelf. Absent: the scene's own card opens. */
  onLibrary?(): void;
```

In `plugins/office/client/world/world-view.tsx`:

Add to `WorldViewProps`, after `onOpenMachine(): void;`:

```ts
  /** A tap on the library: its chip or the bookshelf. */
  onOpenLibrary(): void;
```

Add `onOpenLibrary,` after `onOpenMachine,` in four places: the component's destructured props, the object given to `useRef` for `latest`, the object assigned to `latest.current` in the effect, and that effect's dependency list.

In the options given to `api.start`, after the `onMachine` entry, add:

```ts
          onLibrary: () => {
            focusApp();
            latest.current.onOpenLibrary();
          },
```

In `plugins/office/client/office-surface.tsx`:

Add to `SurfaceBodyProps`, after `onOpenMachine(): void;`:

```ts
  onOpenLibrary(): void;
```

Add `onOpenLibrary,` after `onOpenMachine,` in `SurfaceBody`'s destructured props. In the `<WorldView ... />` it renders, add after `onOpenMachine={onOpenMachine}`:

```tsx
onOpenLibrary = { onOpenLibrary };
```

In `OfficeSurface`, in `<SurfaceBody ... />`, add after `onOpenMachine={openMachine}`:

```tsx
        onOpenLibrary={library.show}
```

- [ ] **Step 9: Say it in the two docs**

In `docs/plugins.md`, in the Library paragraph, after the sentence that ends "and the step's kind is `skill`." add:

```markdown
In the 3D office the library's chip and its bookshelf open the same card, also in an office
without a team, where it lists the host's skills.
```

In `plugins/office/vendor/SOURCES.md`, after the paragraph that starts "Paseo's own files sit beside upstream's", add a paragraph:

```markdown
The library's place card is not shown: `paseo-entry.js` gives the place an `open`, so its chip
and the bookshelf open Paseo's Library card.
```

- [ ] **Step 10: Check and commit**

```bash
cd /workspace/QFlavours/paseo
npx vitest run plugins/office/client/library-card.mounted.test.tsx --bail=1
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/client/library-card.tsx plugins/office/client/library-card.mounted.test.tsx plugins/office/client/use-library.ts plugins/office/client/world/world-api.ts plugins/office/client/world/world-view.tsx plugins/office/client/office-surface.tsx plugins/office/server/world-script.test.ts
npm run format:files -- plugins/office/client/library-card.tsx plugins/office/client/library-card.mounted.test.tsx plugins/office/client/use-library.ts plugins/office/client/world/world-api.ts plugins/office/client/world/world-view.tsx plugins/office/client/office-surface.tsx plugins/office/server/world-script.test.ts docs/plugins.md
git add -A plugins/office docs/plugins.md
git commit -m "feat(office): the library on the floor opens the Library card"
```

Expected: the test passes, typecheck and lint print no error, the commit succeeds.

---

### Task 3: The picker's rows

**Files:**

- Create: `plugins/office/client/agent-picker-text.ts`
- Test: `plugins/office/client/agent-picker-text.test.ts`

**Interfaces:**

- Consumes: `OfficeRoom`, `agentTitle`, `dotTone`, `DotTone`, `buildOfficeModel` from `./model.js`; `stateLabel` from `./agent-card.js`.
- Produces:
  - `NOBODY = ""`, `SEARCH_FROM = 9`
  - `interface PickerRow { agentId: string; title: string; detail: string; tone: DotTone }`
  - `interface PickerGroup { label: "This room" | "Other rooms"; rows: PickerRow[] }`
  - `pickerGroups(rooms: readonly OfficeRoom[], roomId: string, query: string): PickerGroup[]`
  - `showsSearch(rooms: readonly OfficeRoom[]): boolean`
  - `keptChoice(to: string, rooms: readonly OfficeRoom[]): string`
  - `choiceLabel(to: string, rooms: readonly OfficeRoom[]): string`
  - `closeStep(picking: boolean, compact: boolean): "back" | "close"`

- [ ] **Step 1: Write the failing test**

Create `plugins/office/client/agent-picker-text.test.ts`:

```ts
import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import {
  NOBODY,
  choiceLabel,
  closeStep,
  keptChoice,
  pickerGroups,
  showsSearch,
} from "./agent-picker-text.js";
import { buildOfficeModel, type OfficeRoom } from "./model.js";

function agent(id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: `Agent ${id}`,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-16T00:00:${id.padStart(2, "0")}Z`,
    ...patch,
  };
}

function rooms(agents: OfficeAgent[]): OfficeRoom[] {
  const snapshot: OfficeSnapshot = {
    agents,
    workspaces: [
      { id: "w1", name: "shop-api", projectName: "shop" },
      { id: "w2", name: "landing", projectName: "site" },
    ],
    activity: {},
    doing: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
  return buildOfficeModel(snapshot).rooms;
}

const permission = { id: "p1", kind: "tool" as const, title: "Run a command" };

function ids(all: OfficeRoom[], roomId: string, query: string): string[] {
  return pickerGroups(all, roomId, query).flatMap((group) => group.rows.map((row) => row.agentId));
}

test("the room's own agents come first, then the others in the office's order", () => {
  const all = rooms([
    agent("1", { workspaceId: null, permissions: [permission], status: "running" }),
    agent("2"),
    agent("3", { workspaceId: "w2", status: "running" }),
    agent("4", { status: "error" }),
    agent("5", { status: "initializing" }),
  ]);
  expect(pickerGroups(all, "w1", "")).toEqual([
    {
      label: "This room",
      rows: [
        { agentId: "2", title: "Agent 2", detail: "shop-api · Idle", tone: "idle" },
        { agentId: "4", title: "Agent 4", detail: "shop-api · Error", tone: "danger" },
        { agentId: "5", title: "Agent 5", detail: "shop-api · Starting", tone: "starting" },
      ],
    },
    {
      label: "Other rooms",
      rows: [
        { agentId: "1", title: "Agent 1", detail: "Lobby · Needs permission", tone: "warning" },
        { agentId: "3", title: "Agent 3", detail: "landing · Running", tone: "running" },
      ],
    },
  ]);
});

test("the lobby's board has the lobby's agents as its own", () => {
  const all = rooms([agent("1", { workspaceId: null }), agent("2")]);
  expect(pickerGroups(all, "lobby", "").map((group) => group.label)).toEqual([
    "This room",
    "Other rooms",
  ]);
  expect(ids(all, "lobby", "")).toEqual(["1", "2"]);
});

test("a room without agents of its own has only the others, and an empty office has no group", () => {
  const all = rooms([agent("1")]);
  expect(pickerGroups(all, "w2", "").map((group) => group.label)).toEqual(["Other rooms"]);
  expect(pickerGroups(rooms([]), "w1", "")).toEqual([]);
});

test("a search keeps the agents whose title or room has the words, without case", () => {
  const all = rooms([
    agent("1", { title: "Fix checkout" }),
    agent("2", { title: "Write docs", workspaceId: "w2" }),
    agent("3", { title: "Landing copy", workspaceId: null }),
  ]);
  expect(ids(all, "w1", "CHECK")).toEqual(["1"]);
  // One by its title, in the lobby, and one by its room.
  expect(ids(all, "w1", " landing ")).toEqual(["3", "2"]);
  expect(pickerGroups(all, "w1", "nothing")).toEqual([]);
});

test("the search field shows from nine agents", () => {
  const some = (count: number) =>
    rooms(Array.from({ length: count }, (_, index) => agent(String(index + 1))));
  expect(showsSearch(some(8))).toBe(false);
  expect(showsSearch(some(9))).toBe(true);
});

test("a chosen agent that left, or closed, is nobody again", () => {
  const all = rooms([agent("1", { title: "Builder" }), agent("2", { status: "closed" })]);
  expect(keptChoice("1", all)).toBe("1");
  expect(keptChoice("2", all)).toBe(NOBODY);
  expect(keptChoice("gone", all)).toBe(NOBODY);
  expect(keptChoice(NOBODY, all)).toBe(NOBODY);
  expect(choiceLabel("1", all)).toBe("Builder");
  expect(choiceLabel(NOBODY, all)).toBe("Nobody");
  expect(choiceLabel("gone", all)).toBe("Nobody");
});

test("a close goes back from the page of a wide sheet, and closes anywhere else", () => {
  expect(closeStep(true, false)).toBe("back");
  expect(closeStep(true, true)).toBe("close");
  expect(closeStep(false, false)).toBe("close");
  expect(closeStep(false, true)).toBe("close");
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run plugins/office/client/agent-picker-text.test.ts --bail=1`
Expected: FAIL, the import of `./agent-picker-text.js` cannot be resolved.

- [ ] **Step 3: Write the module**

Create `plugins/office/client/agent-picker-text.ts`:

```ts
import { stateLabel } from "./agent-card.js";
import { agentTitle, dotTone, type DotTone, type OfficeRoom } from "./model.js";

/** The choice that wakes no agent. */
export const NOBODY = "";
/** The search field shows from this many agents: more than eight. */
export const SEARCH_FROM = 9;

export interface PickerRow {
  agentId: string;
  title: string;
  /** The agent's room and its state, in the agent card's words: "shop-api · Idle". */
  detail: string;
  tone: DotTone;
}

export interface PickerGroup {
  label: "This room" | "Other rooms";
  rows: PickerRow[];
}

function rowsOf(room: OfficeRoom, wanted: string): PickerRow[] {
  const inRoom = room.name.toLowerCase().includes(wanted);
  return room.rows
    .filter(({ agent }) => inRoom || agentTitle(agent).toLowerCase().includes(wanted))
    .map(({ agent }) => ({
      agentId: agent.id,
      title: agentTitle(agent),
      detail: `${room.name} · ${stateLabel(agent)}`,
      tone: dotTone(agent),
    }));
}

/**
 * The agents a post on this room's board can wake: the room's own first, then every other
 * room's in the office's order. A query keeps the agents whose title or room has it.
 */
export function pickerGroups(
  rooms: readonly OfficeRoom[],
  roomId: string,
  query: string,
): PickerGroup[] {
  const wanted = query.trim().toLowerCase();
  const own = rooms.filter((room) => room.id === roomId).flatMap((room) => rowsOf(room, wanted));
  const others = rooms.filter((room) => room.id !== roomId).flatMap((room) => rowsOf(room, wanted));
  const groups: PickerGroup[] = [];
  if (own.length > 0) groups.push({ label: "This room", rows: own });
  if (others.length > 0) groups.push({ label: "Other rooms", rows: others });
  return groups;
}

/** With this many agents the page has a search field. */
export function showsSearch(rooms: readonly OfficeRoom[]): boolean {
  return rooms.reduce((sum, room) => sum + room.rows.length, 0) >= SEARCH_FROM;
}

function titleOf(to: string, rooms: readonly OfficeRoom[]): string | null {
  for (const room of rooms) {
    const row = room.rows.find((candidate) => candidate.agent.id === to);
    if (row) return agentTitle(row.agent);
  }
  return null;
}

/** The choice to keep: nobody once the chosen agent has left the office. */
export function keptChoice(to: string, rooms: readonly OfficeRoom[]): string {
  return to !== NOBODY && titleOf(to, rooms) !== null ? to : NOBODY;
}

/** What the form says is chosen: the agent's title, or "Nobody". */
export function choiceLabel(to: string, rooms: readonly OfficeRoom[]): string {
  return (to === NOBODY ? null : titleOf(to, rooms)) ?? "Nobody";
}

/**
 * What a close of the sheet does. A wide sheet is closed by Escape, its close button or a press
 * beside it: from the page these go back to the form. A phone's sheet is already swiped away when
 * it says so, and closes.
 */
export function closeStep(picking: boolean, compact: boolean): "back" | "close" {
  return picking && !compact ? "back" : "close";
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run plugins/office/client/agent-picker-text.test.ts --bail=1`
Expected: PASS, 7 tests.

- [ ] **Step 5: Check and commit**

```bash
cd /workspace/QFlavours/paseo
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/client/agent-picker-text.ts plugins/office/client/agent-picker-text.test.ts
npm run format:files -- plugins/office/client/agent-picker-text.ts plugins/office/client/agent-picker-text.test.ts
git add plugins/office/client/agent-picker-text.ts plugins/office/client/agent-picker-text.test.ts
git commit -m "feat(office): the rows of the page that chooses who a post wakes"
```

---

### Task 4: The picker page in the board's sheet

**Files:**

- Create: `plugins/office/client/agent-picker.tsx`
- Modify: `plugins/office/client/board-sheet.tsx`
- Modify: `plugins/office/client/styles.ts`
- Modify: `plugins/office/client/office-surface.tsx`
- Test: `plugins/office/client/board-sheet.mounted.test.tsx`

**Interfaces:**

- Consumes, from Task 3: `NOBODY`, `pickerGroups`, `showsSearch`, `keptChoice`, `choiceLabel`, `closeStep`, `PickerRow`.
- Produces:
  - `AgentPicker(props: { rooms: readonly OfficeRoom[]; roomId: string; value: string; onChoose(value: string): void; onBack(): void; styles: OfficeStyles })`
  - `BoardSheetProps`: `agents` is gone; new `rooms: readonly OfficeRoom[]` and `compact: boolean`.
  - `OfficeStyles`: `pickerField`, `pickerFieldBody`, `pickerRows`, `pickerRow`, `pickerRowSelected`, `pickerSearch`, `iconColor`.

- [ ] **Step 1: Write the failing mounted test**

Create `plugins/office/client/board-sheet.mounted.test.tsx`:

```tsx
/**
 * @vitest-environment jsdom
 */
// A board's sheet, mounted: its form, the page that chooses who a post wakes, and what is posted.
// The sheet, the inputs and the icon are the host's, so plain stand-ins show what they were given.
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { PluginTheme } from "@getpaseo/plugin";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import { BoardSheet } from "./board-sheet.js";
import { buildOfficeModel, type OfficeRoom } from "./model.js";
import { useOfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

/** What the host's sheet does when it is closed: Escape, its close button, a swipe. */
let dismiss: () => void = () => undefined;

vi.mock("@getpaseo/plugin/client/ui", async () => {
  const { ScrollView, TextInput } = await import("react-native");
  const Modal = (props: {
    title: string;
    open: boolean;
    onOpenChange(open: boolean): void;
    children: ReactNode;
  }) => {
    dismiss = () => props.onOpenChange(false);
    return props.open
      ? createElement("section", { "aria-label": props.title }, props.children)
      : null;
  };
  Modal.Content = (props: { children: ReactNode }) => createElement("div", null, props.children);
  const Icon = () => null;
  return { Icon, Modal, ScrollView, TextInput };
});

vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);

const THEME = { colors: new Proxy({}, { get: () => "#808080" }) } as unknown as PluginTheme;

function agent(id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: `Agent ${id}`,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-16T00:00:${id.padStart(2, "0")}Z`,
    ...patch,
  };
}

function officeRooms(agents: OfficeAgent[]): OfficeRoom[] {
  const snapshot: OfficeSnapshot = {
    agents,
    workspaces: [
      { id: "w1", name: "shop-api", projectName: "shop" },
      { id: "w2", name: "landing", projectName: "site" },
    ],
    activity: {},
    doing: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
  return buildOfficeModel(snapshot).rooms;
}

let posted: Array<Parameters<BoardActions["post"]>[0]>;
/** Set to make the host refuse the post. */
let refusal: Error | null;
let closed: number;

const ACTIONS: BoardActions = {
  post: async (input) => {
    if (refusal) throw refusal;
    posted.push(input);
  },
  markDone: async () => undefined,
  remove: async () => undefined,
  setWakesPaused: async () => undefined,
};
const nameOf = (author: string) => author;
const onClose = () => {
  closed += 1;
};

interface HarnessProps {
  rooms: OfficeRoom[];
  compact?: boolean;
  wakesPaused?: boolean;
}

function Harness({ rooms, compact = false, wakesPaused = false }: HarnessProps) {
  const styles = useOfficeStyles(THEME, compact, false);
  return (
    <BoardSheet
      room={rooms.find((room) => room.id === "w1") ?? null}
      rooms={rooms}
      name={nameOf}
      actions={ACTIONS}
      wakesPaused={wakesPaused}
      compact={compact}
      styles={styles}
      onClose={onClose}
    />
  );
}

let container: HTMLElement;
let root: Root;

beforeEach(() => {
  posted = [];
  refusal = null;
  closed = 0;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

const mount = (props: HarnessProps) => act(async () => root.render(<Harness {...props} />));
const settle = () => act(async () => void (await new Promise((done) => setTimeout(done, 0))));
const title = () => container.querySelector("section")?.getAttribute("aria-label");

function byLabel(label: string): HTMLElement {
  const found = container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  if (!found) throw new Error(`Nothing is labelled "${label}"`);
  return found;
}

async function press(label: string): Promise<void> {
  await act(async () => byLabel(label).click());
  await settle();
}

async function type(label: string, text: string): Promise<void> {
  const field = byLabel(label);
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, "value")?.set?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const radios = () =>
  [...container.querySelectorAll('[role="radio"]')].map((row) => row.getAttribute("aria-label"));

test("the form's row opens the page, which has the room's agents first", async () => {
  await mount({
    rooms: officeRooms([
      agent("1", { workspaceId: null }),
      agent("2"),
      agent("3", { workspaceId: "w2", status: "running" }),
    ]),
  });
  expect(title()).toBe("shop-api board");

  await press("Wake an agent with it: Nobody");

  expect(title()).toBe("Wake an agent");
  expect(radios()).toEqual([
    "Nobody: The post wakes no agent",
    "Agent 2: shop-api · Idle",
    "Agent 1: Lobby · Idle",
    "Agent 3: landing · Running",
  ]);
  expect(container.textContent).toContain("This room");
  expect(container.textContent).toContain("Other rooms");
  expect(container.querySelector('[aria-label="Search agents"]')).toBeNull();
});

test("a chosen agent is on the form with the text kept, and the post names it", async () => {
  await mount({ rooms: officeRooms([agent("1"), agent("2", { title: "Builder" })]) });
  await type("Task text", "Ship it");
  await press("Wake an agent with it: Nobody");

  await press("Builder: shop-api · Idle");

  expect(title()).toBe("shop-api board");
  expect((byLabel("Task text") as HTMLTextAreaElement).value).toBe("Ship it");
  await press("Wake an agent with it: Builder");
  expect(byLabel("Builder: shop-api · Idle").getAttribute("aria-checked")).toBe("true");
  await press("Back");

  await press("Post");

  expect(posted).toEqual([{ board: "w1", kind: "task", text: "Ship it", to: "2" }]);
  // A post that was sent starts the next one from nobody.
  byLabel("Wake an agent with it: Nobody");
});

test("a post the host refuses keeps the text and the chosen agent", async () => {
  await mount({ rooms: officeRooms([agent("2", { title: "Builder" })]) });
  await type("Task text", "Ship it");
  await press("Wake an agent with it: Nobody");
  await press("Builder: shop-api · Idle");
  refusal = new Error("the board is full");

  await press("Post");

  expect(posted).toEqual([]);
  expect(container.textContent).toContain("Unable to post: the board is full");
  expect((byLabel("Task text") as HTMLTextAreaElement).value).toBe("Ship it");
  byLabel("Wake an agent with it: Builder");
});

test("Back returns to the form without a change", async () => {
  await mount({ rooms: officeRooms([agent("1")]) });
  await press("Wake an agent with it: Nobody");

  await press("Back");

  expect(title()).toBe("shop-api board");
  byLabel("Wake an agent with it: Nobody");
});

test("from nine agents a search keeps the ones whose title or room has the words", async () => {
  const nine = Array.from({ length: 9 }, (_, index) =>
    agent(String(index + 1), index === 8 ? { workspaceId: "w2", title: "Copy" } : {}),
  );
  await mount({ rooms: officeRooms(nine) });
  await press("Wake an agent with it: Nobody");
  expect(radios()).toHaveLength(10);

  await type("Search agents", "landing");
  expect(radios()).toEqual(["Nobody: The post wakes no agent", "Copy: landing · Idle"]);

  await type("Search agents", "zzz");
  expect(container.textContent).toContain("No agent matches.");
});

test("thirty agents are all on the page", async () => {
  const thirty = Array.from({ length: 30 }, (_, index) => agent(String(index + 1)));
  await mount({ rooms: officeRooms(thirty) });
  await press("Wake an agent with it: Nobody");
  expect(radios()).toHaveLength(31);
});

test("a close from the page goes back on a wide sheet and closes a phone's", async () => {
  const rooms = officeRooms([agent("1")]);
  await mount({ rooms });
  await press("Wake an agent with it: Nobody");

  await act(async () => dismiss());
  expect(title()).toBe("shop-api board");
  expect(closed).toBe(0);
  await act(async () => dismiss());
  expect(closed).toBe(1);

  await mount({ rooms, compact: true });
  await press("Wake an agent with it: Nobody");
  await act(async () => dismiss());
  expect(closed).toBe(2);
});

test("a chosen agent that leaves the office is nobody again", async () => {
  await mount({ rooms: officeRooms([agent("1"), agent("2", { title: "Builder" })]) });
  await press("Wake an agent with it: Nobody");
  await press("Builder: shop-api · Idle");
  byLabel("Wake an agent with it: Builder");

  await mount({ rooms: officeRooms([agent("1")]) });

  byLabel("Wake an agent with it: Nobody");
});

test("with wakes off the form says that a named agent waits", async () => {
  await mount({ rooms: officeRooms([agent("2", { title: "Builder" })]), wakesPaused: true });
  expect(container.textContent).not.toContain("Wake agents is off");
  await press("Wake an agent with it: Nobody");
  await press("Builder: shop-api · Idle");
  expect(container.textContent).toContain(
    "Wake agents is off. The agent gets this post when you turn it on.",
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run plugins/office/client/board-sheet.mounted.test.tsx --bail=1`
Expected: FAIL in the first test: nothing is labelled "Wake an agent with it: Nobody".

- [ ] **Step 3: Add the styles**

In `plugins/office/client/styles.ts`:

In `interface OfficeStyles`, after `chipTextSelected: TextStyle;`, add:

```ts
/** A form's row that opens a page: what it chooses, the choice and a chevron. */
pickerField: ViewStyle;
pickerFieldBody: ViewStyle;
/** The rows of a page of choices, and one of them: an agent, or nobody. */
pickerRows: ViewStyle;
pickerRow: ViewStyle;
pickerRowSelected: ViewStyle;
/** The page's search field: one line, as tall as a control. */
pickerSearch: TextStyle;
iconColor: string;
```

In `useOfficeStyles`, after the `const stripItem: ViewStyle = { ... };` statement and before `return {`, add:

```ts
// The outline is there on every row, clear until the row is chosen, so choosing moves nothing.
const pickerRow: ViewStyle = {
  flexDirection: "row",
  alignItems: "flex-start",
  gap: DOT_GAP,
  minHeight: TOUCH_CONTROL,
  paddingVertical: 12,
  paddingHorizontal: 12,
  borderRadius: 8,
  borderWidth: 1,
  borderColor: "transparent",
  // Clips the pressed fill to the rounded corners.
  overflow: "hidden",
};
```

In the returned object, after `chipTextSelected: { ...base, color: colors.foreground },`, add:

```ts
      pickerField: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        minHeight: TOUCH_CONTROL,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        overflow: "hidden",
      },
      pickerFieldBody: { flex: 1, minWidth: 0 },
      pickerRows: { gap: 4 },
      pickerRow,
      // The chosen row differs by more than tone, as the chosen chip does: it has an outline.
      pickerRowSelected: {
        ...pickerRow,
        backgroundColor: colors.surface2,
        borderColor: colors.foregroundMuted,
      },
      pickerSearch: {
        ...prompt,
        minHeight: controlHeight,
        paddingVertical: 8,
        paddingHorizontal: 16,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        color: colors.foreground,
      },
      iconColor: colors.foregroundMuted,
```

- [ ] **Step 4: Write the page**

Create `plugins/office/client/agent-picker.tsx`:

```tsx
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { TextInput } from "@getpaseo/plugin/client/ui";
import { ActionButton } from "./action-button.js";
import { NOBODY, pickerGroups, showsSearch } from "./agent-picker-text.js";
import type { DotTone, OfficeRoom } from "./model.js";
import type { OfficeStyles } from "./styles.js";
import { listenForSpace } from "./web-env.web.js";

interface RowProps {
  value: string;
  title: string;
  detail: string;
  /** Null for the row that is nobody: it has no state to show. */
  tone: DotTone | null;
  selected: boolean;
  onChoose(value: string): void;
  styles: OfficeStyles;
}

/** One choice of the page: a radio drawn as a row. */
function Row({ value, title, detail, tone, selected, onChoose, styles }: RowProps) {
  const press = useCallback(() => onChoose(value), [onChoose, value]);
  // Enter presses any Pressable; Space, the key that picks a radio, only a button.
  const id = useId();
  useEffect(() => listenForSpace(id, press), [id, press]);
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const lit = pressed || hovered;
  return (
    <Pressable
      id={id}
      accessibilityRole="radio"
      aria-checked={selected}
      accessibilityLabel={`${title}: ${detail}`}
      onPress={press}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={selected ? styles.pickerRowSelected : styles.pickerRow}
    >
      {lit ? <View style={styles.pressedFill} /> : null}
      {/* The slot stays for nobody too, so every title starts on one rail. */}
      <View style={styles.lead}>{tone === null ? null : <View style={styles.dot[tone]} />}</View>
      <View style={styles.rowBody}>
        <Text style={styles.sheetText} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {detail}
        </Text>
      </View>
    </Pressable>
  );
}

export interface AgentPickerProps {
  /** Every room of the office. */
  rooms: readonly OfficeRoom[];
  /** The board's room: its agents come first. */
  roomId: string;
  /** The chosen agent's id, or NOBODY. */
  value: string;
  /** A row was pressed: the page's owner takes the choice and shows the form again. */
  onChoose(value: string): void;
  onBack(): void;
  styles: OfficeStyles;
}

/** The page of a board's sheet that chooses who a post wakes. */
export function AgentPicker({ rooms, roomId, value, onChoose, onBack, styles }: AgentPickerProps) {
  const [query, setQuery] = useState("");
  const searchable = showsSearch(rooms);
  const groups = useMemo(
    () => pickerGroups(rooms, roomId, searchable ? query : ""),
    [rooms, roomId, query, searchable],
  );
  return (
    <View style={styles.sheet}>
      <View style={styles.actions}>
        <ActionButton label="Back" pendingLabel="Back" onPress={onBack} styles={styles} />
      </View>
      {searchable ? (
        <TextInput
          accessibilityLabel="Search agents"
          value={query}
          onChangeText={setQuery}
          placeholder="Search by agent or room"
          placeholderTextColor={styles.placeholderColor}
          autoFocus
          style={styles.pickerSearch}
        />
      ) : null}
      <View
        accessibilityRole="radiogroup"
        accessibilityLabel="Wake an agent with it"
        style={styles.sheet}
      >
        <View style={styles.pickerRows}>
          <Row
            value={NOBODY}
            title="Nobody"
            detail="The post wakes no agent"
            tone={null}
            selected={value === NOBODY}
            onChoose={onChoose}
            styles={styles}
          />
        </View>
        {groups.map((group) => (
          <View key={group.label} style={styles.sheetField}>
            <Text style={styles.sheetLabel}>{group.label}</Text>
            <View style={styles.pickerRows}>
              {group.rows.map((row) => (
                <Row
                  key={row.agentId}
                  value={row.agentId}
                  title={row.title}
                  detail={row.detail}
                  tone={row.tone}
                  selected={value === row.agentId}
                  onChoose={onChoose}
                  styles={styles}
                />
              ))}
            </View>
          </View>
        ))}
        {searchable && query.trim() !== "" && groups.length === 0 ? (
          <Text style={styles.muted}>No agent matches.</Text>
        ) : null}
      </View>
    </View>
  );
}
```

- [ ] **Step 5: Put the page in the board's sheet**

In `plugins/office/client/board-sheet.tsx`:

Replace the import block at the top of the file with:

```tsx
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Icon, Modal, TextInput } from "@getpaseo/plugin/client/ui";
import { POST_TEXT_MAX, type Post, type PostKind } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { textAfterSend } from "./agent-card.js";
import { AgentPicker } from "./agent-picker.js";
import { NOBODY, choiceLabel, closeStep, keptChoice } from "./agent-picker-text.js";
import { orderBoardPosts } from "./board-text.js";
import type { OfficeRoom } from "./model.js";
import { PostRow } from "./room-board.js";
import { listenForSpace } from "./web-env.web.js";
import type { OfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";
```

`Chip` and `PostWithActions` stay as they are.

Delete the line `const NOBODY = "";`. Keep `KINDS`.

Replace everything from `interface SheetBodyProps {` to the end of the file with:

```tsx
interface ChoiceFieldProps {
  /** What the row chooses. */
  label: string;
  /** The choice now. */
  value: string;
  onOpen(): void;
  styles: OfficeStyles;
}

/** A form's row that opens a page: what it chooses, the choice, and a chevron. */
function ChoiceField({ label, value, onOpen, styles }: ChoiceFieldProps) {
  const [hovered, setHovered] = useState(false);
  const hoverIn = useCallback(() => setHovered(true), []);
  const hoverOut = useCallback(() => setHovered(false), []);
  const [pressed, setPressed] = useState(false);
  const pressIn = useCallback(() => setPressed(true), []);
  const pressOut = useCallback(() => setPressed(false), []);
  const lit = pressed || hovered;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      onPress={onOpen}
      onPressIn={pressIn}
      onPressOut={pressOut}
      onHoverIn={hoverIn}
      onHoverOut={hoverOut}
      style={styles.pickerField}
    >
      {lit ? <View style={styles.pressedFill} /> : null}
      <View style={styles.pickerFieldBody}>
        <Text style={styles.rowMeta} numberOfLines={1}>
          {label}
        </Text>
        <Text style={styles.sheetText} numberOfLines={1}>
          {value}
        </Text>
      </View>
      <Icon name="ChevronRight" size={16} color={styles.iconColor} />
    </Pressable>
  );
}

interface SheetBodyProps {
  room: OfficeRoom;
  rooms: readonly OfficeRoom[];
  name(author: string): string;
  actions: BoardActions;
  wakesPaused: boolean;
  /** The page that chooses the agent shows, not the form. */
  picking: boolean;
  onPicking(picking: boolean): void;
  styles: OfficeStyles;
}

function SheetBody({
  room,
  rooms,
  name,
  actions,
  wakesPaused,
  picking,
  onPicking,
  styles,
}: SheetBodyProps) {
  const [kind, setKind] = useState<PostKind>("task");
  const [text, setText] = useState("");
  const [picked, setPicked] = useState(NOBODY);
  // An agent that left the office cannot be woken: the choice is nobody again.
  const to = keptChoice(picked, rooms);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const selectKind = useCallback(
    (value: string) => setKind(value === "note" ? "note" : "task"),
    [],
  );
  const posts = useMemo(() => orderBoardPosts(room.posts), [room.posts]);
  const submit = useCallback(async () => {
    const sent = text.trim();
    await actions.post({ board: room.id, kind, text: sent, ...(to === NOBODY ? {} : { to }) });
    if (!mounted.current) return;
    // Cleared only if the box still holds what was posted, so later typing stays.
    setText((current) => textAfterSend(current, sent));
    setPicked(NOBODY);
  }, [actions, room.id, kind, text, to]);
  const openPage = useCallback(() => onPicking(true), [onPicking]);
  const back = useCallback(() => onPicking(false), [onPicking]);
  const choose = useCallback(
    (value: string) => {
      setPicked(value);
      onPicking(false);
    },
    [onPicking],
  );
  const chosen = KINDS.find((option) => option.kind === kind) ?? KINDS[0];
  // The form's state is kept here while the page shows, so the text typed is there on return.
  if (picking) {
    return (
      <AgentPicker
        rooms={rooms}
        roomId={room.id}
        value={to}
        onChoose={choose}
        onBack={back}
        styles={styles}
      />
    );
  }
  return (
    <View style={styles.sheet}>
      <View style={styles.sheetField}>
        <View accessibilityRole="radiogroup" accessibilityLabel="Kind of post" style={styles.chips}>
          {KINDS.map((option) => (
            <Chip
              key={option.kind}
              label={option.label}
              value={option.kind}
              selected={kind === option.kind}
              onSelect={selectKind}
              styles={styles}
            />
          ))}
        </View>
        <TextInput
          accessibilityLabel={chosen ? `${chosen.label} text` : undefined}
          value={text}
          onChangeText={setText}
          placeholder={chosen?.hint}
          placeholderTextColor={styles.placeholderColor}
          maxLength={POST_TEXT_MAX}
          multiline
          style={styles.input}
        />
      </View>
      <View style={styles.sheetField}>
        <ChoiceField
          label="Wake an agent with it"
          value={choiceLabel(to, rooms)}
          onOpen={openPage}
          styles={styles}
        />
        {to !== NOBODY && wakesPaused ? (
          <Text style={styles.muted}>
            Wake agents is off. The agent gets this post when you turn it on.
          </Text>
        ) : null}
      </View>
      <ActionButton
        label="Post"
        pendingLabel="Posting..."
        onPress={submit}
        disabled={text.trim().length === 0}
        styles={styles}
        primary
      />
      <View style={styles.boardPosts}>
        {posts.length === 0 ? (
          <Text style={styles.muted}>No posts</Text>
        ) : (
          <Text style={styles.sheetLabel}>Posts</Text>
        )}
        {posts.map((post) => (
          <PostWithActions
            key={post.id}
            post={post}
            name={name}
            actions={actions}
            styles={styles}
          />
        ))}
      </View>
    </View>
  );
}

export interface BoardSheetProps {
  room: OfficeRoom | null;
  /** Every room of the office: the agents a post can wake, and where each one sits. */
  rooms: readonly OfficeRoom[];
  name(author: string): string;
  actions: BoardActions;
  /** "Wake agents" is off: a post that names an agent waits. */
  wakesPaused: boolean;
  /** The phone's layout: its sheet is swiped away, so a close from the page closes the sheet. */
  compact: boolean;
  styles: OfficeStyles;
  onClose(): void;
}

/** Post a task or note, optionally waking an agent; mark a task done or delete a post. */
export function BoardSheet({
  room,
  rooms,
  name,
  actions,
  wakesPaused,
  compact,
  styles,
  onClose,
}: BoardSheetProps) {
  const [picking, setPicking] = useState(false);
  // Another room's sheet, and a sheet opened again, start on the form.
  const roomId = room?.id ?? null;
  useEffect(() => {
    setPicking(false);
  }, [roomId]);
  const change = useCallback(
    (open: boolean) => {
      if (open) return;
      if (closeStep(picking, compact) === "back") setPicking(false);
      else onClose();
    },
    [compact, onClose, picking],
  );
  const board = room ? `${room.name} board` : "Board";
  return (
    <Modal title={picking ? "Wake an agent" : board} open={room !== null} onOpenChange={change}>
      <Modal.Content>
        {room ? (
          <SheetBody
            key={room.id}
            room={room}
            rooms={rooms}
            name={name}
            actions={actions}
            wakesPaused={wakesPaused}
            picking={picking}
            onPicking={setPicking}
            styles={styles}
          />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
```

If the typecheck says `Post` or `useId` is unused in `board-sheet.tsx`, they are not: `PostWithActions` takes a `Post` and `Chip` calls `useId`. `ScrollView`, `LOBBY`, `OfficeAgent` and `agentTitle` are no longer imported there.

- [ ] **Step 6: Give the sheet the rooms and the layout**

In `plugins/office/client/office-surface.tsx`:

Delete the line

```tsx
const agentList = useMemo(() => [...model.agents.values()], [model.agents]);
```

Replace the `<BoardSheet ... />` element with:

```tsx
<BoardSheet
  room={board.room}
  rooms={model.rooms}
  name={name}
  actions={boardActions}
  wakesPaused={office.state.wake.paused}
  compact={layout.compact}
  styles={styles}
  onClose={board.close}
/>
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run plugins/office/client/board-sheet.mounted.test.tsx --bail=1`
Expected: PASS, 9 tests.

Run: `npx vitest run plugins/office/client/library-card.mounted.test.tsx --bail=1`
Expected: PASS (the Library card still takes `Chip` from `board-sheet.tsx`).

Run: `npx vitest run plugins/office/client/office-surface.test.ts --bail=1`
Expected: PASS.

- [ ] **Step 8: Check and commit**

```bash
cd /workspace/QFlavours/paseo
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/client/agent-picker.tsx plugins/office/client/board-sheet.tsx plugins/office/client/board-sheet.mounted.test.tsx plugins/office/client/styles.ts plugins/office/client/office-surface.tsx
npm run format:files -- plugins/office/client/agent-picker.tsx plugins/office/client/board-sheet.tsx plugins/office/client/board-sheet.mounted.test.tsx plugins/office/client/styles.ts plugins/office/client/office-surface.tsx
git add plugins/office/client
git commit -m "feat(office): a page of the board's sheet chooses who a post wakes"
```

---

### Task 5: The lobby's sign shows the host's brand

**Files:**

- Create: `plugins/office/client/brand.ts`, `plugins/office/client/brand.test.ts`
- Modify: `plugins/office/client/web-env.web.ts` (`readBrand`)
- Modify: `plugins/office/client/world/world-api.ts` (`WorldBrand`, `brand`)
- Modify: `plugins/office/client/world/adapter.ts` (`worldBrand`), `plugins/office/client/world/adapter.test.ts`
- Modify: `plugins/office/client/world/world-view.tsx`
- Create: `plugins/office/vendor/my-office/src/office/paseo-sign.js`
- Create: `plugins/office/client/world/sign.test.ts`
- Modify: `plugins/office/vendor/my-office/src/office/paseo-entry.js`
- Modify: `plugins/office/vendor/my-office/import-upstream.mjs` (the `OWN` list), `plugins/office/vendor/SOURCES.md`, `docs/docker.md`

**Interfaces:**

- Produces:
  - `interface OfficeBrand { name: string | null; logoUrl: string | null }`, `parseBrand(value: unknown, pageUrl: string): OfficeBrand | null` (`client/brand.ts`)
  - `readBrand(): OfficeBrand | null` (`client/web-env.web.ts`)
  - `interface WorldBrand { name: string; logoUrl: string | null }`, `WorldStartOptions.brand?: WorldBrand` (`client/world/world-api.ts`)
  - `worldBrand(brand: OfficeBrand | null): WorldBrand` (`client/world/adapter.ts`)
  - In the scene, `paseo-sign.js`: `SIGN = { width: 1024, height: 220 }`, `fitName(measure, name, maxWidth) → { size, text }`, `drawSign(g, w, h, { name, logo, mark })`.

- [ ] **Step 1: Write the failing tests of the brand**

Create `plugins/office/client/brand.test.ts`:

```ts
import { expect, test } from "vitest";
import { parseBrand } from "./brand.js";

const PAGE = "https://office.example/h/local/plugin/office/surface/office";

test("the page's brand has its name and its logo's address in full", () => {
  expect(
    parseBrand(
      { name: "Flavours", logoUrl: "/_brand/logo.svg", iconUrl: "/_brand/icon.png" },
      PAGE,
    ),
  ).toEqual({ name: "Flavours", logoUrl: "https://office.example/_brand/logo.svg" });
});

test("a name alone and a logo alone are each a brand", () => {
  expect(parseBrand({ name: "Flavours" }, PAGE)).toEqual({ name: "Flavours", logoUrl: null });
  expect(parseBrand({ logoUrl: "/_brand/logo.png" }, PAGE)).toEqual({
    name: null,
    logoUrl: "https://office.example/_brand/logo.png",
  });
});

test("anything else is no brand", () => {
  const not = [
    undefined,
    null,
    "Flavours",
    3,
    {},
    { name: "  " },
    { name: 3 },
    { logoUrl: "https://elsewhere.example/logo.svg" },
    { logoUrl: "//elsewhere.example/_brand/logo.svg" },
  ];
  for (const value of not) expect(parseBrand(value, PAGE)).toBeNull();
});
```

In `plugins/office/client/world/adapter.test.ts`, add `worldBrand,` to the import from `./adapter.js` (before `worldChanges,`) and add at the end of the file:

```ts
describe("the lobby's sign", () => {
  it("shows the host's brand, and the product's name where it has none", () => {
    const logoUrl = "https://office.example/_brand/logo.svg";
    expect(worldBrand({ name: "Flavours", logoUrl })).toEqual({ name: "Flavours", logoUrl });
    expect(worldBrand({ name: null, logoUrl })).toEqual({ name: "Paseo", logoUrl });
    expect(worldBrand(null)).toEqual({ name: "Paseo", logoUrl: null });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run plugins/office/client/brand.test.ts --bail=1`
Expected: FAIL, the import of `./brand.js` cannot be resolved.

Run: `npx vitest run plugins/office/client/world/adapter.test.ts --bail=1`
Expected: FAIL in "the lobby's sign": `worldBrand` is not a function.

- [ ] **Step 3: Read the brand and shape it for the scene**

Create `plugins/office/client/brand.ts`:

```ts
/** The host's brand, as the daemon writes it into the web page it serves. */
export interface OfficeBrand {
  /** Null keeps the product's name. */
  name: string | null;
  /** The logo's address in full; null when the brand has none. */
  logoUrl: string | null;
}

/** The daemon serves the brand's images under this path; any other address is not its own. */
const IMAGE_PATH_PREFIX = "/_brand/";

/**
 * Reads what the daemon wrote into the page (`window.__PASEO_BRAND__`), with the app's own checks
 * (packages/app/src/brand/brand.ts, which a plugin cannot import). Anything else is no brand. The
 * logo's address is made full against the page's: the 3D office's frame has no address of its own.
 */
export function parseBrand(value: unknown, pageUrl: string): OfficeBrand | null {
  if (typeof value !== "object" || value === null) return null;
  const { name, logoUrl } = value as Record<string, unknown>;
  const brand: OfficeBrand = {
    name: typeof name === "string" && name.trim() !== "" ? name : null,
    logoUrl:
      typeof logoUrl === "string" && logoUrl.startsWith(IMAGE_PATH_PREFIX)
        ? new URL(logoUrl, pageUrl).href
        : null,
  };
  return brand.name === null && brand.logoUrl === null ? null : brand;
}
```

In `plugins/office/client/web-env.web.ts`, add at the top `import { parseBrand, type OfficeBrand } from "./brand.js";` and at the end of the file:

```ts
/** The host's brand, as the daemon wrote it into this page; null on a page without one. */
export function readBrand(): OfficeBrand | null {
  if (typeof document === "undefined") return null;
  return parseBrand(Reflect.get(window, "__PASEO_BRAND__"), document.baseURI);
}
```

In `plugins/office/client/world/world-api.ts`, add before `export interface WorldStartOptions {`:

```ts
/** What the lobby's sign and the reception's plaque show. */
export interface WorldBrand {
  name: string;
  /** The logo's address in full; null draws the scene's own mark. */
  logoUrl: string | null;
}
```

and add to `WorldStartOptions`, after `colors: WorldColors;`:

```ts
  /** The lobby's sign. Absent: the scene's own. */
  brand?: WorldBrand;
```

In `plugins/office/client/world/adapter.ts`, add `import type { OfficeBrand } from "../brand.js";` to the imports, add `WorldBrand,` to the type import from `./world-api.js` (before `WorldBoardRow,`), and add at the end of the file:

```ts
/** The name on the lobby's sign of a host without a brand: the product's. */
const PRODUCT_NAME = "Paseo";

/** What the lobby's sign shows: the host's brand, or the product's name over the scene's mark. */
export function worldBrand(brand: OfficeBrand | null): WorldBrand {
  return { name: brand?.name ?? PRODUCT_NAME, logoUrl: brand?.logoUrl ?? null };
}
```

In `plugins/office/client/world/world-view.tsx`: add `import { readBrand } from "../web-env.web.js";`, add `worldBrand,` to the import from `./adapter.js` (before `worldChanges,`), and in the options given to `api.start`, after `colors,`, add:

```ts
          // Read when the office starts: a page's brand does not change while the page lives.
          brand: worldBrand(readBrand()),
```

- [ ] **Step 4: Run them to verify they pass**

Run: `npx vitest run plugins/office/client/brand.test.ts --bail=1`
Expected: PASS, 3 tests.

Run: `npx vitest run plugins/office/client/world/adapter.test.ts --bail=1`
Expected: PASS, every test of the file.

- [ ] **Step 5: Write the failing test of the sign's picture**

Create `plugins/office/client/world/sign.test.ts`:

```ts
import { expect, test } from "vitest";
import { SIGN, drawSign, fitName } from "../../vendor/my-office/src/office/paseo-sign.js";

// A letter is half its type size wide: enough to say when a name fits.
const measure = (text: string, size: number) => text.length * size * 0.5;
/** The sign's width less where the name starts and the margin at its end. */
const ROOM = 724;

test("a short name is drawn at upstream's size", () => {
  expect(fitName(measure, "Paseo", ROOM)).toEqual({ size: 92, text: "Paseo" });
});

test("a longer name is drawn smaller, as large as fits", () => {
  // 20 letters at 72: 720 wide. At 76 it would be 760.
  expect(fitName(measure, "Flavours Engineering", ROOM)).toEqual({
    size: 72,
    text: "Flavours Engineering",
  });
});

test("a name too long for the smallest type ends in an ellipsis", () => {
  const fitted = fitName(measure, "A".repeat(40), ROOM);
  expect(fitted).toEqual({ size: 48, text: `${"A".repeat(29)}…` });
  expect(measure(fitted.text, fitted.size)).toBeLessThanOrEqual(ROOM);
});

/** A 2D context that keeps what was drawn on it and measures as `measure` does. */
function fakeContext() {
  const calls: unknown[][] = [];
  const g = {
    font: "",
    fillStyle: "",
    textBaseline: "",
    fillRect: (...args: unknown[]) => void calls.push(["fillRect", g.fillStyle, ...args]),
    drawImage: (...args: unknown[]) => void calls.push(["drawImage", ...args]),
    fillText: (...args: unknown[]) => void calls.push(["fillText", g.font, ...args]),
    measureText: (text: string) => ({
      width: measure(text, Number(/(\d+)px/.exec(g.font)?.[1] ?? 0)),
    }),
  };
  return { g, calls };
}

test("without a logo the sign has the scene's mark and then the name", () => {
  const { g, calls } = fakeContext();
  let marks = 0;
  drawSign(g, SIGN.width, SIGN.height, {
    name: "Paseo",
    logo: null,
    mark: () => void (marks += 1),
  });
  expect(marks).toBe(1);
  expect(calls[0]).toEqual(["fillRect", "#1C2620", 0, 0, 1024, 220]);
  expect(calls.some(([kind]) => kind === "drawImage")).toBe(false);
  expect(calls.at(-1)).toEqual([
    "fillText",
    '800 92px "Be Vietnam Pro", system-ui, sans-serif',
    "Paseo",
    260,
    114,
  ]);
});

test("a logo is fitted into the mark's square, in place of the mark", () => {
  const { g, calls } = fakeContext();
  const logo = { width: 400, height: 200 };
  let marks = 0;
  drawSign(g, SIGN.width, SIGN.height, { name: "Flavours", logo, mark: () => void (marks += 1) });
  expect(marks).toBe(0);
  expect(calls.find(([kind]) => kind === "drawImage")).toEqual([
    "drawImage",
    logo,
    75.5,
    72.75,
    149,
    74.5,
  ]);
});

test("a logo that has no size of its own leaves the mark", () => {
  const { g, calls } = fakeContext();
  let marks = 0;
  drawSign(g, SIGN.width, SIGN.height, {
    name: "Flavours",
    logo: { width: 0, height: 0 },
    mark: () => void (marks += 1),
  });
  expect(marks).toBe(1);
  expect(calls.some(([kind]) => kind === "drawImage")).toBe(false);
});
```

Run: `npx vitest run plugins/office/client/world/sign.test.ts --bail=1`
Expected: FAIL, the import of `paseo-sign.js` cannot be resolved.

- [ ] **Step 6: Write the sign's picture**

Create `plugins/office/vendor/my-office/src/office/paseo-sign.js`:

```js
// PASEO: the picture on the lobby's sign and the reception's plaque, with the host's brand.
// Upstream draws "My Office" and its mark in world/pro/floor.js, which stays as it is:
// paseo-entry.js puts this picture on the same material once the floor is built. No imports, so
// a test runs it without a browser.

/** The sign's canvas, as upstream sizes it. */
export const SIGN = { width: 1024, height: 220 };
/** Upstream's type size on the sign, and the smallest a long name is drawn at. */
const TYPE_MAX = 92;
const TYPE_MIN = 48;
const TYPE_STEP = 4;
/** The mark's square, centred here; upstream's mark is 24 units drawn 6.2 times as large. */
const MARK_X = 150;
const MARK_BOX = 149;
/** Where the name starts, and the room kept at the sign's end. */
const NAME_X = 260;
const NAME_MARGIN = 40;
const font = (size) => `800 ${size}px "Be Vietnam Pro", system-ui, sans-serif`;

/**
 * The largest type a name fits a width at, and the name as it is drawn. `measure(text, size)` is
 * the text's width at a size. A name too long for the smallest type ends in an ellipsis.
 */
export function fitName(measure, name, maxWidth) {
  for (let size = TYPE_MAX; size >= TYPE_MIN; size -= TYPE_STEP) {
    if (measure(name, size) <= maxWidth) return { size, text: name };
  }
  let text = name;
  while (text.length > 1 && measure(`${text}…`, TYPE_MIN) > maxWidth) text = text.slice(0, -1);
  return { size: TYPE_MIN, text: `${text.trimEnd()}…` };
}

/**
 * Draws the sign on a 2D context: upstream's board, the mark, the name. `sign.logo` is a loaded
 * image and is fitted into the mark's square; without one, or with one that has no size of its
 * own, `sign.mark(g)` draws the scene's mark.
 */
export function drawSign(g, w, h, sign) {
  g.fillStyle = "#1C2620";
  g.fillRect(0, 0, w, h);
  const { logo } = sign;
  if (logo && logo.width > 0 && logo.height > 0) {
    const scale = Math.min(MARK_BOX / logo.width, MARK_BOX / logo.height);
    const lw = logo.width * scale,
      lh = logo.height * scale;
    g.drawImage(logo, MARK_X - lw / 2, h / 2 - lh / 2, lw, lh);
  } else {
    sign.mark(g);
  }
  const measure = (text, size) => {
    g.font = font(size);
    return g.measureText(text).width;
  };
  const fitted = fitName(measure, sign.name, w - NAME_X - NAME_MARGIN);
  g.fillStyle = "#F6EFE4";
  g.font = font(fitted.size);
  g.textBaseline = "middle";
  g.fillText(fitted.text, NAME_X, h / 2 + 4);
}
```

Run: `npx vitest run plugins/office/client/world/sign.test.ts --bail=1`
Expected: PASS, 6 tests.

- [ ] **Step 7: Put the picture on the sign**

In `plugins/office/vendor/my-office/src/office/paseo-entry.js`:

Add to the imports, after `import { renderer } from './scene/renderer.js';`:

```js
import { canvasTex } from "./scene/blocks.js";
```

and after `import { closePlace } from './interact/place-cards.js';`:

```js
import { OFFICE_MARK, PRO_FX } from "./world/pro/pieces.js";
import { SIGN, drawSign } from "./paseo-sign.js";
```

After the `showMachine` function, add:

```js
/** Upstream's mark on the sign, as world/pro/floor.js draws it: the sign of a host without a logo. */
function drawMark(g) {
  g.save();
  g.translate(150, SIGN.height / 2);
  g.scale(6.2, 6.2);
  g.translate(-12, -12);
  g.fillStyle = "#E8865F";
  g.fill(new Path2D(OFFICE_MARK), "evenodd");
  g.restore();
}
/**
 * The lobby's sign and the reception's plaque share one material (upstream's PRO_FX.logoM): its picture is drawn again
 * with the host's brand. The name shows at once over the scene's mark; the logo takes the mark's place when it has
 * loaded, and one that does not load leaves the mark. The one-room floor has no lobby and no sign.
 */
function showBrand(brand) {
  const material = PRO_FX.logoM;
  if (!material || !brand || typeof brand.name !== "string" || !brand.name) return;
  const paint = (logo) => {
    if (stopped) return;
    const old = material.map;
    material.map = canvasTex(SIGN.width, SIGN.height, (g, w, h) =>
      drawSign(g, w, h, { name: brand.name, logo, mark: drawMark }),
    );
    material.needsUpdate = true;
    old?.dispose();
  };
  paint(null);
  if (typeof brand.logoUrl !== "string" || !brand.logoUrl) return;
  const image = new Image();
  image.onload = () => paint(image);
  image.src = brand.logoUrl;
}
```

In `start`, after the line `showMachine(false);`, add:

```js
showBrand(options.brand);
```

In the comment over `start`, replace

```js
   * Builds the office. `options`: plan ('pro' | 'cozy'), dark, colors (the app theme), and what
```

with

```js
   * Builds the office. `options`: plan ('pro' | 'cozy'), dark, colors (the app theme), brand
   * ({ name, logoUrl }, for the lobby's sign), and what
```

In `plugins/office/vendor/my-office/import-upstream.mjs`, replace the `OWN` line with:

```js
const OWN = new Set([
  "office/paseo-entry.js",
  "office/paseo-host.js",
  "office/paseo-style.js",
  "office/paseo-modules.js",
  "office/paseo-sign.js",
]);
```

- [ ] **Step 8: Run the build test**

Run: `npx vitest run plugins/office/server/world-script.test.ts --bail=1`
Expected: PASS, 3 tests: the entry still builds into one script within the size the test allows.

- [ ] **Step 9: Say it in the docs**

In `plugins/office/vendor/SOURCES.md`, replace

```markdown
Paseo's design language), and `paseo-modules.js` (generated: the kept modules in start-up order).
```

with

```markdown
Paseo's design language), `paseo-modules.js` (generated: the kept modules in start-up order), and
`paseo-sign.js` (the picture on the lobby's sign and the reception's plaque, with the host's
brand; the entry puts it on the material upstream's floor made).
```

In `docs/docker.md`, in the brand's table, replace the `PASEO_BRAND_NAME` row's last cell

```markdown
The page title, the installed app's name, and "Paseo" in the app's text
```

with

```markdown
The page title, the installed app's name, "Paseo" in the app's text, and the sign over the lift in the 3D office
```

and the `PASEO_BRAND_LOGO` row's last cell

```markdown
The logo on the welcome, start-up, open-project and onboarding screens
```

with

```markdown
The logo on the welcome, start-up, open-project and onboarding screens, and the mark on the 3D office's sign
```

The formatter lines the table up again.

- [ ] **Step 10: Check and commit**

```bash
cd /workspace/QFlavours/paseo
npm run typecheck --workspace=@getpaseo/builtin-plugins
npm run lint -- plugins/office/client/brand.ts plugins/office/client/brand.test.ts plugins/office/client/web-env.web.ts plugins/office/client/world/world-api.ts plugins/office/client/world/adapter.ts plugins/office/client/world/adapter.test.ts plugins/office/client/world/world-view.tsx plugins/office/client/world/sign.test.ts
npm run format:files -- plugins/office/client/brand.ts plugins/office/client/brand.test.ts plugins/office/client/web-env.web.ts plugins/office/client/world/world-api.ts plugins/office/client/world/adapter.ts plugins/office/client/world/adapter.test.ts plugins/office/client/world/world-view.tsx plugins/office/client/world/sign.test.ts docs/docker.md
git add -A plugins/office docs/docker.md
git commit -m "feat(office): the lobby's sign shows the host's brand"
```

---

### Task 6: Look at it live, and write down what was seen

**Files:**

- Modify: `docs/superpowers/specs/2026-11-16-office-owner-review-design.md` (status, "Not verified")

**Interfaces:**

- Consumes: everything above, built.

The dev daemon has no agents and none is created, so the floor is empty: the sign, the library and the lobby's board are still there. The rows of the picker with 3, 9 and 30 agents are covered by `board-sheet.mounted.test.tsx`.

- [ ] **Step 1: Start the workspace's dev daemon and app**

Use Paseo's workspace scripts for this checkout (`paseo.json`): list them (`list_workspace_scripts`), start `daemon`, then `app` (`start_workspace_script`). Each answer has the service's address. They run a daemon of the checkout's own (`.dev/paseo-home`), not the one on port 6767.

Expected: both services report running; the app's address answers.

If the services cannot be started this way, do not start another daemon by hand: skip to Step 5
and write that the live check was not done, with the reason.

- [ ] **Step 2: Open the office in the browser, with a brand**

Open the app's address with the browser tools (`browser_new_tab`, `browser_navigate`), at 1280 px wide (`browser_resize`). Before opening the office, set the brand the daemon's own web UI would write (`browser_evaluate`):

```js
window.__PASEO_BRAND__ = { name: "Flavours Kitchen", logoUrl: "/_brand/logo.svg" };
```

Open Office from the sidebar and choose the 3D view.

Expected, each seen in a screenshot (`browser_screenshot`):

- The sign over the lift and the reception's plaque say "Flavours Kitchen" with the building mark. The dev app serves no `/_brand/logo.svg`, so this is also the case of a logo that does not load: the mark stays and no banner shows.
- The strip has no Library entry (no team), and no entry is named Gym.
- A click on the library's chip ("Library · lookups") opens the sheet titled "Library" with "On this host" in it. Close it. A click on the bookshelf opens it too.
- With the chip focused by Tab, Enter opens the sheet.
- A click on the whiteboard opens "Lobby board". Its row says "Wake an agent with it" and "Nobody". A click on the row shows "Wake an agent" with Back and Nobody. Escape returns to "Lobby board"; Escape again closes the sheet.
- `browser_logs` has no page error.

- [ ] **Step 3: The same without a brand, and on a phone's width**

Reload the page (the brand set by hand is gone) and open the office in 3D.

Expected: the sign says "Paseo" with the building mark.

Resize to 390 px wide, open the lobby's board from the list or the 2D view, press the row and then Back.

Expected: the form's row and the page fit the width, every row is at least 44 px tall, and the typed text is there after Back.

- [ ] **Step 4: Stop the services**

Stop `app` and `daemon` (`stop_workspace_script`).

- [ ] **Step 5: Write down the state in the spec**

In `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`, replace the status line's "the split and sub-project 1 are approved by the owner; nothing is built" with "sub-project 1 is built; the others are not". Under sub-project 1, after "### Testing", add a "### Not verified" section that lists only what was in fact not seen. At the time of writing that is:

```markdown
### Not verified

- A brand's logo on the sign in a browser: the dev app serves no `/_brand/` picture. The drawing
  is tested on a recorded context, and the page showed the mark staying when the logo did not load.
- A real graphics card: the test browser draws with software.
- The picker's page with real agents: its rows with 3, 9 and 30 agents are a mounted test.
- The installed app on a phone.
```

Remove a line that Step 2 or 3 did see, and add one for anything else that could not be checked, with the reason.

- [ ] **Step 6: Commit**

```bash
cd /workspace/QFlavours/paseo
npm run format:files -- docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git add docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git commit -m "docs(office): the small fixes of the owner's review are built"
```
