# Office small fixes, again Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A sub-agent shows in the office as its parent's name with a stable number (Mjd-1, Mjd-2, Mjd-2-1), the card strip is never cut off, and the 3D glide after a drag runs at full frame rate.

**Architecture:** All in the office plugin (`plugins/office`). The directory reads each agent's metadata; a numbering module on the server hands out numbers and writes them with `setMetadata`; the office's agent gets an optional `name` that `agentTitle` reads. The strip wraps on wide screens and fades on phones. The scene's entry overrides the frame's `document.hasFocus`.

**Tech Stack:** TypeScript, zod, React Native (react-native-web), vitest, the plugin kit, the vendored scene (plain JavaScript).

**Spec:** `docs/superpowers/specs/2026-11-16-office-small-fixes-again-design.md` (sub-project 6 of `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`).

## Global Constraints

- Work in `/workspace/QFlavours/paseo` on branch `feat/office-small-fixes-again`, from `main`. Do not push. Another builder may be on `feat/office-standup-notes` in the same checkout: use a worktree (`git worktree add`) if that branch is checked out.
- No commit carries AI attribution.
- One test file at a time: `npx vitest run <file> --bail=1`.
- After each task: `npm run typecheck --workspace=@getpaseo/builtin-plugins`, `npm run lint -- <changed files outside vendor/>`, `npm run format:files -- <changed files outside vendor/>`.
- No upstream file under `plugins/office/vendor/my-office/` is edited. Only `src/office/paseo-*.js`.
- Never touch the daemon on port 6767. No real agent is created for a check.

Binding values from the spec:

- The name: `<parent's office name>-<number>`. Without a shown parent, the agent's own title.
- Metadata keys: `office.subagent.number` on the sub-agent, `office.subagent.next` on the parent.
- A new number: the larger of the parent's `next` (1 when unset) and one more than its highest numbered shown child. Several at once in creation order.
- Numbers never change. An archived sibling's number is not reused.
- A failed write is logged and tried again on the directory's next change.
- The agent's card shows the task title under the name when they differ.
- Strip: wraps on a wide screen; on a phone scrolls with a 24 px fade at the right edge while more is past it.
- Glide: the frame's `document.hasFocus()` is true while the page the frame is in has focus.

Decided in this plan:

- A sub-agent's parent's name is the parent's office `name` if it has one, so Mjd-2's child is Mjd-2-1.
- The numbering runs on each directory change, before the hub emits. It never blocks the emit: writes are fire-and-forget, deduplicated by an in-flight set.

## Review Focus

1. **Two sub-agents created in the same second.** They get 1 and 2, never both 1. Pinned in Task 1.
2. **A parent with an archived child numbered 3 and `next` unset** (written by an older office). The next is 4. Pinned in Task 1.
3. **A sub-agent whose parent the office hides** (background or archived). It keeps its own title and gets no number. Pinned in Task 1.
4. **A metadata value that is not a positive integer.** Ignored as if unset. Pinned in Task 1.
5. **A frame whose parent page is cross-origin.** `hasFocus` falls back to the frame's own. Pinned in Task 3.

---

### Task 1: Sub-agent numbers on the server

**Files:**

- Create: `plugins/office/server/subagent-names.ts`
- Modify: `plugins/office/server/directory.ts` (`DirectoryAgentInput.metadata`, `projectAgent` keeps the number)
- Modify: `plugins/office/shared/contracts.ts` (`OfficeAgentSchema`: `number: z.number().int().positive().optional()`, `name: z.string().optional()`)
- Modify: `plugins/office/server/hub.ts` or `plugins/office/index.server.ts` (run the numbering on each directory view)
- Modify: `plugins/office/server/live-ports.ts` (`setAgentMetadata(agentId, patch)` through `holder.require().agents.ref(agentId).setMetadata(patch)`)
- Test: `plugins/office/server/subagent-names.test.ts`, `plugins/office/server/directory.test.ts`

**Interfaces:**

- Produces:

```text
export const NUMBER_KEY = "office.subagent.number";
export const NEXT_KEY = "office.subagent.next";
/** Numbers to write: for each parent, the next value, and for each new sub-agent, its number. */
export function planNumbers(agents: readonly NumberedAgent[]): { agentId: string; patch: Record<string, number> }[];
/** The office names: `<parent name>-<n>` for numbered sub-agents of shown parents, by id. */
export function officeNames(agents: readonly OfficeAgent[]): Map<string, string>;
interface NumberedAgent { id: string; parentAgentId: string | null; createdAt: string; number?: number; next?: number }
```

- `projectAgent` reads `metadata[NUMBER_KEY]` and `metadata[NEXT_KEY]` when they are positive integers. The hub's snapshot agents carry `name` from `officeNames`.

- [ ] **Step 1: Write the failing tests**

```text
test("two new sub-agents of one parent get 1 and 2 in creation order", () => {
  expect(planNumbers([parent("p"), child("a", "p", "10:00:01"), child("b", "p", "10:00:01.5")])).toEqual([
    { agentId: "a", patch: { [NUMBER_KEY]: 1 } },
    { agentId: "b", patch: { [NUMBER_KEY]: 2 } },
    { agentId: "p", patch: { [NEXT_KEY]: 3 } },
  ]);
});
test("a number is never reused: next wins over the shown children", () => {
  expect(planNumbers([parent("p", { next: 4 }), child("b", "p", "t", { number: 2 }), child("c", "p", "t2")]))
    .toContainEqual({ agentId: "c", patch: { [NUMBER_KEY]: 4 } });
});
test("without next, one more than the highest shown child", () => {
  expect(planNumbers([parent("p"), child("x", "p", "t", { number: 3 }), child("y", "p", "t2")]))
    .toContainEqual({ agentId: "y", patch: { [NUMBER_KEY]: 4 } });
});
test("a sub-agent of a hidden parent gets no number", () => {
  expect(planNumbers([child("a", "gone", "t")])).toEqual([]);
});
test("names nest: Mjd-2's child is Mjd-2-1", () => {
  const names = officeNames([agent("p", "Mjd"), agent("c", "task", { parent: "p", number: 2 }), agent("g", "task2", { parent: "c", number: 1 })]);
  expect(names.get("c")).toBe("Mjd-2");
  expect(names.get("g")).toBe("Mjd-2-1");
  expect(names.has("p")).toBe(false);
});
```

In `directory.test.ts`: `projectAgent` with `metadata: { "office.subagent.number": 2 }` gives `number: 2`; with `"2"`, `0` or `1.5` gives no number.

- [ ] **Step 2: Run them and see them fail**

Run: `npx vitest run plugins/office/server/subagent-names.test.ts --bail=1`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

Process parents in any order and each parent's unnumbered children by `createdAt` then `id`. Write the parent's `next` only when it changes. In the wiring, keep an in-flight set of agent ids so a write is not sent twice before the directory reports it back; a failed write is logged with `[office] subagent number failed` and dropped from the set.

- [ ] **Step 4: Run them and see them pass**

Run both test files. Expected: PASS. Also `npx vitest run plugins/office/server/hub.test.ts --bail=1`.

- [ ] **Step 5: Commit**

```bash
git add plugins/office
git commit -m "feat(office): sub-agents are numbered after their parent"
```

---

### Task 2: The name everywhere in the office

**Files:**

- Modify: `plugins/office/client/model.ts` (`agentTitle`)
- Modify: `plugins/office/client/agent-card.tsx` (the task under the name)
- Test: `plugins/office/client/model.test.ts`, `plugins/office/client/agent-card.test.ts`

**Interfaces:**

- Consumes: Task 1's `OfficeAgent.name`.
- Produces: `agentTitle(agent)` returns `agent.name` when set, else as today. `agentTask(agent): string | null` returns the trimmed title when `name` is set and differs from it.

- [ ] **Step 1: Write the failing tests**

```text
test("the office name comes first", () => {
  expect(agentTitle({ ...a, title: "Explore the cart API", name: "Mjd-1" })).toBe("Mjd-1");
  expect(agentTitle({ ...a, title: "Mjd" })).toBe("Mjd");
  expect(agentTask({ ...a, title: "Explore the cart API", name: "Mjd-1" })).toBe("Explore the cart API");
  expect(agentTask({ ...a, title: "Mjd" })).toBeNull();
});
```

In the card's test: with `name` set, the card's text has the name as its title and the task title under it.

- [ ] **Step 2 to 4: Fail, implement, pass**

Run each test file. Every caller of `agentTitle` (the 3D adapter, the 2D floor, the list, the strip, the cards, the stand-up) gets the name with no further change. Expected: FAIL before, PASS after.

- [ ] **Step 5: Commit**

```bash
git add plugins/office
git commit -m "feat(office): the office shows a sub-agent's number name"
```

---

### Task 3: The strip and the glide

**Files:**

- Modify: `plugins/office/client/attention-strip.tsx`, `plugins/office/client/styles.ts`
- Modify: `plugins/office/vendor/my-office/src/office/paseo-entry.js`
- Test: `plugins/office/client/office-surface.test.ts` (or a new `attention-strip.test.tsx`), and a pure helper test for the focus rule

**Interfaces:**

- Produces in `styles.ts`: `stripWrap: ViewStyle` (`flexDirection: "row", flexWrap: "wrap", gap: 8`) for the wide layout, `stripFade: ViewStyle` (absolute, right 0, 24 px wide, full height, `pointerEvents: "none"`).
- Produces in `paseo-entry.js`: `export function hostFocused(frameDoc, parentWin)`, which returns `parentWin.document.hasFocus()` when reachable, else `frameDoc` 's own original `hasFocus()`. At start: `const own = document.hasFocus.bind(document); document.hasFocus = () => hostFocused(own, window.parent);`.

- [ ] **Step 1: Write the failing tests**

```text
test("wide: the strip wraps and does not scroll", () => {
  // render with compact false: no horizontal ScrollView, the row style has flexWrap "wrap"
});
test("phone: the fade shows while more cards are past the edge", () => {
  // compact true, content 600 wide in a 375 rail: fade shown; scrolled to the end: fade gone
});
test("the scene counts as focused while Paseo's page has focus", () => {
  expect(hostFocused(() => false, { document: { hasFocus: () => true } })).toBe(true);
  expect(hostFocused(() => false, { document: { hasFocus: () => false } })).toBe(false);
  expect(hostFocused(() => true, { get document() { throw new Error("cross-origin"); } })).toBe(true);
});
```

Put the focus test where the scene's other pure tests run (`client/world/sign.test.ts` imports `paseo-sign.js`: follow that pattern, a new `client/world/focus.test.ts`).

- [ ] **Step 2 to 4: Fail, implement, pass**

The fade is a View with the surface colour at an opacity ramp: two or three stacked Views of falling opacity, since the kit has no gradient. Track `onScroll` and `onContentSizeChange` / `onLayout` to show it. Rebuild the scene's bundle through its build test and keep it under 1.2 MB. Expected: FAIL before, PASS after.

- [ ] **Step 5: Commit**

```bash
git add plugins/office
git commit -m "fix(office): the strip is never cut off and the glide runs at full rate"
```

---

### Task 4: Look at it, and mark it built

- [ ] **Step 1:** On an isolated dev daemon (`docs/ad-hoc-daemon-testing.md`, never port 6767), open the office in a browser with a parent agent and two sub-agents. Check the 3D tags read `<parent>-1` and `<parent>-2`, that archiving the first leaves the second's name, and that the agent's card shows the task under the name.
- [ ] **Step 2:** On a wide window, the strip wraps with no card cut. In a narrow window, the fade shows and goes at the end.
- [ ] **Step 3:** Drag the 3D floor and release: the glide is smooth. In the browser's performance panel, the frames during the glide come at about 16 ms.
- [ ] **Step 4:** In the spec set `Status: built.` with a short "Verified" list and a "Not verified" list. In the roadmap's Status line, add sub-project 6 as built.
- [ ] **Step 5: Commit**

```bash
npm run format:files -- docs/superpowers/specs/2026-11-16-office-small-fixes-again-design.md docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git add docs/superpowers/specs/2026-11-16-office-small-fixes-again-design.md docs/superpowers/specs/2026-11-16-office-owner-review-design.md
git commit -m "docs(office): the small fixes, again, are built"
```
