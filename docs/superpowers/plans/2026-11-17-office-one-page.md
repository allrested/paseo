# The office as one page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Open session" in the office shows the agent's real session beside the floor, and the server room's wall screen shows the Resources screen there, so the office stays on one page.

**Architecture:** The plugin kit's surface navigation gains an optional `showBeside(target)`. The app answers it with a side area it draws around a plugin screen and a plugin workspace panel: a resizable panel on the right on wide layouts, a sheet on the app-wide stack on compact ones. The area holds one target: an agent, run in the app's agent pane with a pane context built for the agent's own workspace, or another plugin's screen, run inside that plugin's own provider and error boundary. The office calls `showBeside` and falls back to today's behaviour when it is absent or answers `false`.

**Tech Stack:** TypeScript, React Native with react-native-web, Expo Router, zustand, react-native-unistyles, vitest, the plugin kit (`@getpaseo/plugin`), three.js r160 in the vendored scene (plain JavaScript).

**Spec:** `docs/superpowers/specs/2026-11-17-office-one-page-design.md` (sub-project 4 of `docs/superpowers/specs/2026-11-16-office-owner-review-design.md`).

## Global Constraints

- Work in your own worktree on a branch `feat/office-one-page` off `main`: `git -C /workspace/QFlavours/paseo worktree add -b feat/office-one-page /workspace/QFlavours/paseo-office-one-page main`, then `npm install` there. Never check out, stash, reset or commit in `/workspace/QFlavours/paseo` itself: another agent's uncommitted work is there. Do not push.
- No commit carries AI attribution: no `Co-Authored-By` trailer, no "Generated with" line.
- Run one test file at a time, from the repo root: `npx vitest run <file> --bail=1`. Never run a whole suite.
- After each task's code: `npm run build:client` when `packages/plugin` changed, the typecheck of each package touched (`npm run typecheck --workspace=<package>`), then `npm run lint -- <changed .ts/.tsx files outside plugins/office/vendor/>`, then `npm run format:files -- <changed files outside plugins/office/vendor/>`.
- No protocol change: `showBeside` is client-side. It is optional on `PluginSurfaceProps["navigation"]`, like `openBrowser`, so old apps and old plugins keep working without a COMPAT shim.
- Read `docs/expo-router.md` before Task 3. The area adds no route and is never restored on startup.
- No upstream file under `plugins/office/vendor/my-office/` is edited by hand. Only `src/office/paseo-*.js`. Code there keeps upstream's style.
- `useUnistyles()` is forbidden (`docs/unistyles.md`). Hover follows `docs/hover.md`.
- Never restart or touch the daemon on port 6767. Tests use fakes and the isolated daemon harness.

Binding values from the spec:

- Target: `{ kind: "agent", agentId, serverId? }` or `{ kind: "screen", pluginId, screenId, params?, serverId? }`. `serverId` defaults to the surface's `host.id`.
- `showBeside` returns `true` when shown, `false` for an unknown agent, a plugin not installed on that host, or a screen it lacks. It does not throw for those.
- Given to plugin screens and plugin workspace panels only.
- Wide: a panel on the right with a drag handle; starts at the Explorer's default width (`320`, `explorer-sidebar-layout.ts`); the width lives in memory only and never touches `explorerWidth`.
- Compact: an `IsolatedBottomSheetModal` on the app-wide stack with `SheetPane`'s header; drag down, Close, the backdrop and Android Back close it.
- One target at a time. A new target replaces it; the same target keeps it without a remount. Leaving the plugin's screen or panel closes it. Not restored.
- Agent header: the agent's title, under it the workspace's name, `Open in workspace` (calls `navigateToAgent` and closes the area), Close.
- Agent pane: `openTab`, `openFileInWorkspace` and `openPreferredTarget` go to the agent's workspace with that target. `openTargetToSide` is left out. `closeCurrentTab` closes the area. The tab id is the area's own and never a workspace tab's. Archived: the pane's archived state. Agent or workspace gone: the area closes.
- Screen: the named plugin's screen inside its own `PluginInstallationProvider` and `SurfaceErrorBoundary`, `layout.compact: true`. Header: the screen's title, the plugin's sidebar icon, `Open {title}` (opens the screen's route and closes the area), Close.
- Office: the agent card's "Open session", "Answer in the session" and the structure view's rows call `showBeside({ kind: "agent", agentId })`, else `openAgent`. The agent card stays open. The `tv` prop calls `onResources()`, which calls `showBeside({ kind: "screen", pluginId: "resource-manager", screenId: "resources" })`, else the Host card. The racks, the server room's chip and the dev box keep `onMachine()`.

Decided in this plan, where the spec left it open:

- The area's code lives in `packages/app/src/plugins/beside/`. Its state is a zustand store keyed by the surface's own key (screen route or panel tab), so a plugin screen and an office panel in a workspace do not share one area.
- The area's tab id is `beside:<surfaceKey>`.
- Two targets are the same when kind, serverId and agentId match, or kind, serverId, pluginId, screenId and the JSON of params match.
- The drag handle is the app's `ResizeHandle` (`packages/app/src/components/resize-handle.tsx`), clamped to `240` and the window's width minus `MIN_WORKSPACE_BODY_WIDTH`.

## Review Focus

1. **`showBeside` called twice in one frame with two different agents.** The second wins and only one pane mounts. Pinned in Task 2.
2. **The agent archived while shown, then unarchived.** The area shows the archived state and then the live pane, without closing. Pinned in Task 4.
3. **Resources throwing on mount.** The area shows the boundary's message, and the office's floor keeps running. Pinned in Task 5.
4. **The window narrowed under a wide area.** The area's width clamps so the plugin's content keeps its minimum width. Pinned in Task 3.
5. **The office opened as a workspace panel, with the area showing an agent of that same workspace.** Typing in the area and in the agent's own tab share one draft, and the two panes do not collide on tab id. Pinned in Task 4.

---

### Task 1: `showBeside` in the plugin kit and the navigation model

**Files:**

- Modify: `packages/plugin/src/client/contracts.ts` (`PluginNavigableHostProps`)
- Modify: `packages/plugin/src/client/index.ts` (export the target type)
- Modify: `packages/app/src/plugins/host-navigation-model.ts`
- Modify: `packages/app/src/plugins/host-navigation.ts`
- Test: `packages/app/src/plugins/host-navigation.test.ts`

**Interfaces:**

- Produces: `export type PluginBesideTarget = { readonly kind: "agent"; readonly agentId: string; readonly serverId?: string } | { readonly kind: "screen"; readonly pluginId: string; readonly screenId: string; readonly params?: PluginScreenParams; readonly serverId?: string }` in `@getpaseo/plugin/client`.
- Produces: `navigation.showBeside?: (target: PluginBesideTarget) => boolean`.
- Produces: in `HostNavigationOwner`, `showBeside?(target: ResolvedBesideTarget): boolean`, where `ResolvedBesideTarget` is the target with `serverId: string` filled in. `createPluginHostNavigation` sets `showBeside` only when the owner has one.
- Produces: `usePluginHostNavigation(serverId: string, showBeside?: (target: ResolvedBesideTarget) => boolean)`.

- [ ] **Step 1: Write the failing tests** in `host-navigation.test.ts`:
  - `it("exposes no showBeside when the owner has none")`: `navigation.showBeside` is `undefined`.
  - `it("fills the surface's host into a showBeside target")`: with serverId `"s1"`, `showBeside({ kind: "agent", agentId: "a1" })` reaches the owner as `{ kind: "agent", agentId: "a1", serverId: "s1" }`, and returns the owner's answer (`true`, then `false`).
  - `it("keeps an explicit serverId")`: `{ kind: "screen", pluginId: "resource-manager", screenId: "resources", serverId: "s2" }` reaches the owner with `serverId: "s2"`.
- [ ] **Step 2: Run** `npx vitest run packages/app/src/plugins/host-navigation.test.ts --bail=1`. Expected: FAIL on `showBeside`.
- [ ] **Step 3: Add the type and the field** in the plugin kit, with a doc comment: "Shows a session or a plugin's screen beside this surface. Absent on hosts without a side area; false when the target is unavailable." Add `showBeside` to the model and the hook's optional parameter.
- [ ] **Step 4: Run** the test file. Expected: PASS. `npm run build:client`, then typecheck `@getpaseo/plugin` and `@getpaseo/app`.
- [ ] **Step 5: Commit** `git commit -m "Add showBeside to plugin navigation"`.

### Task 2: The side area's store

**Files:**

- Create: `packages/app/src/plugins/beside/store.ts`
- Test: `packages/app/src/plugins/beside/store.test.ts`

**Interfaces:**

- Consumes: `ResolvedBesideTarget` from Task 1.
- Produces: `useBesideStore` (zustand) with state `{ areas: Record<string, { target: ResolvedBesideTarget; revision: number }>; width: number | null }` and actions `show(surfaceKey: string, target: ResolvedBesideTarget): void`, `close(surfaceKey: string): void`, `setWidth(width: number): void`. `revision` grows only when the target changes, so the area keys its content on it.
- Produces: `sameBesideTarget(a: ResolvedBesideTarget, b: ResolvedBesideTarget): boolean`, by the rule under "Decided in this plan".
- Produces: `besideTabId(surfaceKey: string): string`, returns `beside:${surfaceKey}`.

- [ ] **Step 1: Write the failing tests:**
  - `show` then `show` with a different agent: one area, the second target, `revision` 2.
  - `show` twice with the same agent: `revision` stays 1.
  - Two screen targets that differ only in params: not the same.
  - `close` removes the area; `close` of an unknown key does nothing.
  - Two surface keys hold two areas.
  - `width` starts `null`; `setWidth(400)` sets it for every area.
- [ ] **Step 2: Run** `npx vitest run packages/app/src/plugins/beside/store.test.ts --bail=1`. Expected: FAIL.
- [ ] **Step 3: Implement** `store.ts`. Not persisted.
- [ ] **Step 4: Run** the test file. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Add the plugin side area's store"`.

### Task 3: The side area around plugin screens and panels

**Files:**

- Create: `packages/app/src/plugins/beside/beside-area.tsx` (`BesideFrame`, the wide panel and the compact sheet)
- Create: `packages/app/src/plugins/beside/beside-header.tsx`
- Create: `packages/app/src/plugins/beside/beside-layout.ts` (pure width clamp)
- Modify: `packages/app/src/components/explorer-sidebar-layout.ts` (export `MIN_WORKSPACE_BODY_WIDTH`, today a private `360`)
- Modify: `packages/app/src/plugins/surface-screen.tsx` (`SurfaceRenderer`)
- Modify: `packages/app/src/plugins/workspace-panels/panel.tsx` (`PluginPanelBody`)
- Test: `packages/app/src/plugins/beside/beside-layout.test.ts`, `packages/app/src/plugins/beside/beside-area.mounted.test.tsx`

**Interfaces:**

- Consumes: Task 1's hook parameter, Task 2's store.
- Produces: `<BesideFrame surfaceKey={string} serverId={string}>{pluginContent}</BesideFrame>`. It owns `showBeside` for its surface: it resolves the target (Tasks 4 and 5 register the resolvers), calls `useBesideStore.show`, and returns the resolver's answer. It closes its area on unmount.
- Produces: `registerBesideKind(kind: "agent" | "screen", entry: { available(target): boolean; Header: ComponentType<{ target; close(): void }>; Body: ComponentType<{ target; surfaceKey: string; close(): void }> })` in `beside-area.tsx`. Tasks 4 and 5 call it.
- Produces: `BesideHeader` props `{ icon: ReactNode; title: string; subtitle?: string; action: { label: string; onPress(): void }; onClose(): void }`.
- Produces: `clampBesideWidth(width: number | null, windowWidth: number): number`. `null` gives `320`. The result is at least `240` and at most `windowWidth - MIN_WORKSPACE_BODY_WIDTH`.

- [ ] **Step 1: Write the failing tests:**
  - `beside-layout.test.ts`: `clampBesideWidth(null, 1280)` is `320`; `clampBesideWidth(100, 1280)` is `240`; `clampBesideWidth(2000, 1280)` is `1280 - MIN_WORKSPACE_BODY_WIDTH`.
  - `beside-area.mounted.test.tsx`, with a test kind registered: with nothing shown, the plugin's content is all there is. On wide, after `showBeside`, the header's title shows to the right of the content, and Close removes it. On compact, the same target opens a sheet, and Close dismisses it. An unavailable target returns `false` and shows nothing. Unmounting the frame clears its area in the store.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.** Wide: a row with the content (`flex: 1`), `ResizeHandle`, then the panel at `clampBesideWidth(store.width, windowWidth)`. Compact: an `IsolatedBottomSheetModal` whose header is `BesideHeader` inside `SheetDragArea`. The surface key is the route's `serverId:pluginId:contributionId` for a screen, and the pane's `serverId:workspaceId:tabId` for a panel. `SurfaceRenderer` and `PluginPanelBody` wrap the plugin's component in `BesideFrame` and pass its `showBeside` to `usePluginHostNavigation`.
- [ ] **Step 4: Run** both files. Expected: PASS. Typecheck and lint `@getpaseo/app`.
- [ ] **Step 5: Commit** `git commit -m "Draw a side area beside plugin screens and panels"`.

### Task 4: A session in the side area

**Files:**

- Create: `packages/app/src/plugins/beside/agent-beside.tsx`
- Create: `packages/app/src/plugins/beside/agent-pane-context.ts` (pure)
- Test: `packages/app/src/plugins/beside/agent-pane-context.test.ts`, `packages/app/src/plugins/beside/agent-beside.mounted.test.tsx`

**Interfaces:**

- Consumes: `registerBesideKind`, `besideTabId`, `BesideHeader`; `PaneProvider`, `PaneFocusProvider`, `createPaneFocusContextValue` (`packages/app/src/panels/pane-context.tsx`); `navigateToWorkspace`, `navigateToAgent`; the bridges of `useSheetPaneBridge` (`screens/workspace/sheet-pane/host.tsx`) for the compact sheet.
- Produces: `buildAgentBesidePaneContext(input: { serverId: string; workspaceId: string; agentId: string; tabId: string; close(): void; openInWorkspace(target: WorkspaceTabTarget): void; openFile(request: WorkspaceFileOpenRequest): void }): PaneContextValue`, with `target: { kind: "agent", agentId }`, `openTargetToSide` left out, `openTab` and `openPreferredTarget` both calling `openInWorkspace`, `closeCurrentTab` calling `close`, and `retargetCurrentTab`, `setCurrentTabState` and `openImportSheet` as no-ops.
- Produces: the `"agent"` kind. `available` is true when the session store knows the agent on that server and its workspace exists.

- [ ] **Step 1: Write the failing tests:**
  - `agent-pane-context.test.ts`: the context has the agent's workspace, the given tab id, no `openTargetToSide`; `openTab({ kind: "file", ... })` calls `openInWorkspace` with it; `closeCurrentTab` calls `close`.
  - `agent-beside.mounted.test.tsx`, with a fake session store: the header reads the agent's title and the workspace's name. `Open in workspace` calls `navigateToAgent({ serverId, agentId })` and closes the area. An agent marked archived shows the archived callout, and unarchiving shows the composer again without closing the area. Removing the agent closes the area, and so does removing its workspace. Unknown agent: `available` is false. Draft sharing: the pane's composer reads the draft keyed by `buildDraftStoreKey({ serverId, agentId })`, the same key a workspace tab uses, while its tab id is `beside:<surfaceKey>`.
- [ ] **Step 2: Run** both files. Expected: FAIL.
- [ ] **Step 3: Implement.** The body renders the agent panel's registered component under the providers, with the workspace's focus. The pane is focused while it has the keyboard.
- [ ] **Step 4: Run** both files. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Show an agent's session in the side area"`.

### Task 5: A plugin's screen in the side area

**Files:**

- Create: `packages/app/src/plugins/beside/screen-beside.tsx`
- Test: `packages/app/src/plugins/beside/screen-beside.mounted.test.tsx`

**Interfaces:**

- Consumes: `registerBesideKind`, `BesideHeader`; `useInstalledPlugin`, `PluginInstallationProvider`, `SurfaceErrorBoundary`, `resolvePluginScreenTitle`, `buildPluginSurfaceRoute`, `toPluginTheme`, `resolvePluginPlatform`.
- Produces: the `"screen"` kind. `available` is true when the plugin is installed on that server and has a screen with that id.

- [ ] **Step 1: Write the failing tests**, with a fake installed plugin: the screen mounts with `params` `{}` when none were given, `layout.compact: true`, and the host's id. The header shows the screen's title and `Open Resources` for a screen titled `Resources`. Pressing it calls `router.push(buildPluginSurfaceRoute(serverId, pluginId, { kind: "surface", id: screenId }, params))` and closes the area. A screen that throws shows the error boundary's message in the area, and the frame's content is still rendered. Missing plugin or screen: `available` is false.
- [ ] **Step 2: Run** the file. Expected: FAIL.
- [ ] **Step 3: Implement.** The screen gets no `showBeside` of its own: it is given `usePluginHostNavigation(serverId)` without one.
- [ ] **Step 4: Run** the file. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Show a plugin's screen in the side area"`.

### Task 6: The wall screen in the scene

**Files:**

- Modify: `plugins/office/client/world/world-api.ts` (start options)
- Modify: `plugins/office/vendor/my-office/src/office/paseo-host.js`
- Modify: `plugins/office/vendor/my-office/src/office/paseo-entry.js`
- Test: `plugins/office/server/world-script.test.ts`

**Interfaces:**

- Produces: `onResources?(): void` in the start options, beside `onLibrary`, documented as "The server room's wall screen was chosen. Absent while Paseo has nothing to show for it." The contract's version stays.
- Produces: `host.resources` in `paseo-host.js`, `null` while absent.

- [ ] **Step 1: Write the failing test** in `world-script.test.ts`, the way the library's case is written: with `onResources`, activating the `tv` prop calls it once and `onMachine` zero times; activating `racks` calls `onMachine`. Without `onResources`, the `tv` prop calls `onMachine`.
- [ ] **Step 2: Run** `npx vitest run plugins/office/server/world-script.test.ts --bail=1`. Expected: FAIL.
- [ ] **Step 3: Implement.** In `paseo-entry.js`, set `host.resources` from the option next to `host.library`. After the props are built, as for the bell, take `PROPS.get('tv')` and set its `act` to call `host.resources` when set, else `openMac()`. The place's chip keeps `openMac()`.
- [ ] **Step 4: Run** the test. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Let the office's wall screen ask for Resources"`.

### Task 7: The office shows sessions and Resources beside the floor

**Files:**

- Modify: `plugins/office/client/office-surface.tsx` (`openSession`, the 3D view's options)
- Modify: `plugins/office/client/world/world-view.tsx` (pass `onResources`)
- Create: `plugins/office/client/beside.ts` (pure)
- Test: `plugins/office/client/beside.test.ts`

**Interfaces:**

- Consumes: `navigation.showBeside` (Task 1), `onResources` (Task 6).
- Produces: `openSessionWith(navigation: PluginSurfaceProps["navigation"], agentId: string): void`. It calls `showBeside({ kind: "agent", agentId })` and, when that is absent or returns `false`, `openAgent({ agentId })`.
- Produces: `resourcesOpener(navigation: PluginSurfaceProps["navigation"], openMachine: () => void): (() => void) | undefined`. It is `undefined` when `showBeside` is absent. Otherwise it calls `showBeside({ kind: "screen", pluginId: "resource-manager", screenId: "resources" })` and `openMachine()` on `false`.

- [ ] **Step 1: Write the failing tests:** `openSessionWith` with `showBeside` returning `true` does not call `openAgent`; returning `false` calls it once; with no `showBeside` it calls `openAgent`; with no navigation it does nothing. `resourcesOpener` is `undefined` without `showBeside`, calls `showBeside` with the exact screen target, and calls `openMachine` once when it answers `false`.
- [ ] **Step 2: Run** `npx vitest run plugins/office/client/beside.test.ts --bail=1`. Expected: FAIL.
- [ ] **Step 3: Implement** `beside.ts`. `office-surface.tsx`'s `openSession` uses `openSessionWith`, so the agent card, `PermissionActions` and the structure view all get it unchanged. The card stays open. The 3D view gets `onResources: resourcesOpener(navigation, openMachine)`.
- [ ] **Step 4: Run** the file, then `plugins/office/client/agent-card.test.ts`. Expected: PASS.
- [ ] **Step 5: Commit** `git commit -m "Open sessions and Resources beside the office"`.

### Task 8: Docs, a look at it, and mark it built

**Files:**

- Modify: `docs/plugins.md` (navigation, where the surface navigation fields are described)
- Modify: `public-docs/plugins/reference.md` (beside `navigation.openBrowser`)
- Modify: `docs/explorer-sidebar.md` (the side area as a fourth surface in the table, one line, linking to `docs/plugins.md`)
- Modify: `docs/superpowers/specs/2026-11-16-office-owner-review-design.md` (Status: sub-project 4 is built)
- Modify: `docs/superpowers/specs/2026-11-17-office-one-page-design.md` (Status: built; a "Not verified" section as in sub-project 1)

- [ ] **Step 1: Write the docs.** `showBeside`'s target, its answer, who gets it, and the rule that a plugin checks the field and falls back. One example in the public reference, the way `openBrowser` has one.
- [ ] **Step 2: Look at it** against a dev daemon of your worktree (`npm run dev` on its own port, never 6767), with fixtures and no real agent prompted: the office screen and the office panel at 1280 px and 390 px, light and dark; "Open session" from the card and from "Answer in the session"; the drag handle; Close and Android Back on the sheet; the wall screen with Resources, and with the resource-manager plugin disabled (the Host card). Record what was seen and what was not, in the spec's "Not verified" section.
- [ ] **Step 3: Format** the docs: `npm run format:files -- <the files>`.
- [ ] **Step 4: Commit** `git commit -m "Document the side area and mark the office as one page built"`.
