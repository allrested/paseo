# Agent Office Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A built-in plugin `office` that shows every agent on the connected host as a small 3D office on the web (a 2D structure view elsewhere), lets the user act on an agent from it, and gives agents three board tools with wake-on-mention so they can hand work to each other.

**Architecture:** `plugins/office/` is a built-in plugin. Its server half runs inside the daemon: one in-process hub keeps a compact agent and workspace directory (from the SDK's subscribed `agents.list` and `workspaces.list`), the "doing now" lines, the boards and the wake state, and streams them to every open office surface over one plugin subscription, `office.state`. Boards live in `$PASEO_HOME/office/boards.json` behind a single-writer store; a mention queue wakes named agents through `paseo.agents.ref(id).send`. The client half registers one surface as a sidebar screen and as a workspace panel; it renders the structure view from a pure model, and on web, when 3D is on and WebGL2 exists, loads a vendored three.js r170 through a binary RPC, evaluates it from a Blob URL, and draws an instanced low-poly office whose look is decided by pure plan functions in this plan.

**Tech Stack:** TypeScript (NodeNext, strict), zod 4, `@getpaseo/plugin` server and client SDK, `@getpaseo/client` (one new member, `cancel()`), React Native and React Native Web, `@tanstack/react-query` 5, three.js 0.170.0 (vendored, MIT), Vitest 4, Node `fs/promises`.

**Spec:** `docs/superpowers/specs/2026-11-11-agent-office-design.md`

## Global Constraints

Every task's requirements include this section.

- **Branch.** Every task runs on the local branch `feat/agent-office`, which the controller cuts from local `main` before Task 1, at a time when no other session is using this checkout's working tree. Tasks never create, switch, check out, stash, reset or rebase a branch, and never run `git add -A` or `git add .`: they stage named files only. Every commit block starts with `test "$(git -C /workspace/utils/paseo branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }`; on `STOP` nothing was staged: report it and stop.
- **Nothing is pushed.** No step pushes any branch or tag. A push to `main` redeploys every instance.
- **Commit identity.** Author and committer `tatsuya <allrested@gmail.com>`, set per command through the environment, overriding the container's M-DAQ `GIT_*` variables for that command only:
  `env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "<message>" -- <paths>`
  then `git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'`, which must print `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`. Never set `user.email` in any git config.
- **`LEFTHOOK=0` only after the checks.** A commit skips the pre-commit hook only after the task's typecheck, `npm run lint` on its files, `npm run format:files` on its files and its tests passed on the same tree. Task 1 commits documents only and runs the format check alone.
- **Memory (6 GiB cap, one heavy command at a time).** Typecheck, vitest, build, `npm run lint` and the dev daemon are heavy. Run each as `flock -w 480 /tmp/paseo-heavy.lock <command>` with a 600000 ms tool timeout. If `flock` gives up after 480 s, wait a minute and run the same step again; the daemon's heavy-command gate can also hold a command for about 5 minutes, which is normal. After five failed tries report BLOCKED. Never stop a process you did not start to free memory. `npm run format:files` is light and runs without the lock.
  - Plugins typecheck: `cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded`.
  - Client typecheck: `cd /workspace/utils/paseo/packages/client && flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded`.
  - Never the root `npm run typecheck`, never a whole workspace test suite.
- **Tests, one file per run.** Plugin tests run from the repo root, whose `vitest.config.ts` covers `plugins/`: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/<path>.test.ts --bail=1`. Client tests run from `packages/client`. The built-in registry test runs from `packages/server` with `-t` naming its one test. Several files in one run only with `--no-file-parallelism --maxWorkers=1`. New plugin tests join the existing CI job (`fork-ci.yml` server-tests runs `npm run test --workspace=@getpaseo/builtin-plugins`); no new CI jobs or npm scripts.
- **Build order.** Plugins read `@getpaseo/client` types through `@getpaseo/plugin`'s declarations. After Task 2 changes `packages/client`, run `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npm run build:client` once before any plugins typecheck that uses `cancel()`.
- **Lint and format through npm scripts only**, from the repo root: `npm run format:files -- <paths>`, then `flock -w 480 /tmp/paseo-heavy.lock npm run lint -- <paths>`. Never `npx oxlint` or `npx oxfmt`.
- **Lint rules that shape the code** (`.oxlintrc.json`): `no-shadow`, `no-nested-ternary`, `complexity` 20, `max-depth` 4, `max-nested-callbacks` 3 (tests use top-level `test()` without `describe`, so callbacks stay shallow), `typescript/consistent-type-definitions` (`interface` for object types; unions stay `type`), `typescript/no-explicit-any`, `react/no-array-index-key`, `react/jsx-max-depth` 6, `react-hooks/exhaustive-deps`, and the `react-perf` rules (no new object, array, function or JSX as a prop: styles and handlers are memoized; the `jsx-no-new-array-as-prop` exemption covers `packages/app` only, not plugins).
- **Daemon process safety.** The plugin's server code runs inside the daemon, and an uncaught exception or unhandled rejection stops every agent. Every hook, RPC handler, timer callback, subscription callback and store write catches its errors and logs them with `console.error` through a `log(message)` function. No floating promise without a `.catch`. Every timer is `unref`'d (`server/timers.ts`) and cancelled by the plugin's cleanup.
- **Never touch the daemon on port 6767.** No step restarts, stops or signals it. The checkpoint tasks use a dev daemon on `127.0.0.1:6768` (`npm run dev:server`, checkout-local `.dev/paseo-home`) and Expo web on `http://localhost:8081` (`npm run dev:app`). Before starting either, run `ss -ltnp | grep -E ':(6768|8081) '`: if something you did not start already listens, stop and ask the controller.
- **Built-in import rules.** Server files import only `@getpaseo/plugin`, `@getpaseo/plugin/server`, `zod`, `node:*`, and types from `@getpaseo/protocol/*`; client files only `@getpaseo/plugin`, `@getpaseo/plugin/client`, `@getpaseo/plugin/client/ui`, `react`, `react-native`, `@tanstack/react-query` and `zod`; `shared/` only `@getpaseo/plugin` and `zod`. Relative imports carry a `.js` suffix (NodeNext). Code copied from the app or another plugin carries a comment naming its source.
- **Platform.** 3D runs only when `layout.platform === "web"`, WebGL2 is available, and the device's 3D switch is on. Plugin bundles are built by esbuild, not Metro, so `.web.ts` file names are a naming convention only: those files are imported explicitly, are evaluated on every platform, and must not touch `document`, `window` or any DOM API at module top level. Native and every device without WebGL2 get the structure view, and never load three.js.
- **Plugin UI.** Color every `Text` from `theme.colors.foreground` or `theme.colors.foregroundMuted` (status colors for state), size layout from `layout.compact`, build styles with `useMemo` from the theme (the plugin has no Unistyles). No hover-only UI: every control is visible on touch.
- **Copy** (`docs/design.md` section 10): sentence case; buttons imperative; in-flight labels end in a literal three-dot "..." ("Sending..."); no trailing period on labels and single-clause hints; errors start "Unable to ...".
- **Tests** (`docs/testing.md`): ports and adapters with typed in-memory fakes, real temp dirs, an injected fake clock (`server/fake-clock.ts`), deterministic `toEqual` assertions. No `vi.mock`, `vi.spyOn`, `vi.useFakeTimers`, monkey-patched globals, JSDOM or component tests. UI and three.js wiring are checked by hand in the checkpoint tasks.
- **Types.** No `as` cast that bypasses a type error (`as const` is fine). Test files are excluded from the plugins typecheck (`plugins/tsconfig.json`), so tests type their fixtures through typed helper functions.
- **Spec values, verbatim:** post text at most 2,000 characters; 200 posts per board, the oldest done tasks and notes dropped first; done tasks removed after 7 days; a board whose workspace was archived is removed; `office_read` returns up to 30 posts, newest last, with a cursor; at most 6 wakes per agent per rolling hour; the "doing now" line runs only while an office subscription is open, at most once per 5 s per agent; 24 desks drawn per room, the rest as "+N"; pixel ratio capped at 1.5 on a touch device and 2 elsewhere; the wake prompt is `Office board: <n> post(s) for you.` followed by one line per post with its id, author and text.
- **Docs voice.** Follow the repo `CLAUDE.md` "Writing docs" and "Doc voice" rules: integrate into the doc that owns the subject, plain sentences, no sales language.
- **Model tier.** Each task names the implementer tier it suits: cheap (transcription of complete code), standard (integration across files), most capable (design judgment).
- **Design runs on Fable 5.2.** Design decisions and design polish use Fable 5.2 (`claude-fable-5-2`, the most capable tier); those tasks say so in their tier note. The owner uses the web UI mostly on a phone and a tablet, so every visual decision is checked at phone width (390 x 844) first, then tablet (820 x 1180), then desktop (1440 x 900).

## Where the code disagrees with the survey or the spec

The code wins; these are settled here and every task follows them.

1. **Agent data does not come from `useAgents`/`useWorkspaces`.** The plugin hooks `useAgents` and `useWorkspaces` return refs, not snapshots (`packages/plugin/src/client/client-state.tsx`, `createCollectionHook` projects `item.ref`), and `PluginAgentSnapshot` has no pending permissions. The server hub instead keeps one compact directory from `paseo.agents.list({ subscribe: {} })` and `paseo.workspaces.list({ subscribe: {} })` (their `subscription.subscribe({ snapshot, update })` delivers the snapshot, then `agent_update`/`workspace_update` messages, `packages/client/src/index.ts` `listAgents`/`listWorkspaces`), projects each agent to `OfficeAgent` (with its pending permissions) and pushes it through `office.state`. One source serves the client, the activity poller and the wake checks, and phones receive a compact projection instead of full agent snapshots.
2. **RPC names.** `defineRpc` accepts only `^[a-z][a-z0-9._-]*$` (`packages/plugin/src/rpc.ts`), so `office.setWakesPaused` is impossible. Following `docs/rpc-namespacing.md` and `resource-manager`: `office.post.request`, `office.update.request`, `office.delete.request`, `office.set_wakes_paused.request`, `office.asset.request`; the subscription stays `office.state`.
3. **`scene/*.web.ts`.** Metro platform extensions do not apply to plugin bundles (`packages/server/src/server/plugins/compiler-build.ts` bundles with esbuild, `platform: "neutral"`), so web-only files are gated at run time (see Global Constraints, Platform).
4. **three.js "core module only".** Since r171 `build/three.module.js` imports `./three.core.js`, which a Blob URL import cannot resolve. r170 is the last release whose `build/three.module.min.js` (691,648 bytes, no imports, ends in one `export{...}`) is self-contained and includes `WebGLRenderer`. The plan vendors that file.
5. **The 3D switch is a device-scoped plugin setting** (`defineSettings({ scope: "device" })`, stored by the app in AsyncStorage, which is browser `localStorage` on web, `packages/app/src/plugins/settings/device.ts`), so the spec's `client/device-settings.ts` becomes `shared/settings.ts` beside the host setting.
6. **Provider colors.** The app has no provider color map (`packages/app/src/components/provider-icons.ts` draws monochrome icons). Visors use the app's identity color table and hash (`packages/app/src/styles/identity-colors.ts`), copied, keyed by provider id.
7. **Panel visibility.** Panel props have no `active` flag (`packages/plugin/src/client/contracts.ts`, `PluginPanelProps`); a hidden workspace stays mounted with `display: none`. The scene pauses on `document.visibilitychange` and an `IntersectionObserver` on its container.
8. **Server-wide `paseo`.** `PluginServerContext` has no `paseo`; each handler, hook and tool receives the plugin's one API object (`packages/server/src/server/plugins/plugin-process.ts`, `let paseo`). Timers that need it (wake retries, activity) read it from a holder that every handler refreshes.
9. **A subscription handler's promise closes the subscription when it settles** (`PluginServerContext.handle` doc). The hub's `attach` therefore resolves only when the subscriber's `signal` aborts, and rejects when the directory cannot start.
10. **Plugin tools may not reach every interactive session.** The spec gives "every interactive agent session" the three tools. The daemon serves plugin tools inside its own agent MCP server (`registerPluginTools` in `packages/server/src/server/agent/tools/paseo-tools.ts`, filtered by `isPaseoToolEnabled`), so a session without Paseo's agent tools, or with a policy that hides `office_*`, may not get them. Task 25, Step 1 confirms this; the plan does not change the daemon, and Task 29 documents the result.

## Decisions the spec leaves open

1. **Posts carry `seq`.** Every create or change gives the post the store's next sequence number; `office_read`'s cursor is the highest `seq` returned. Post ids are `p<seq at creation>`.
2. **Wake timing.** A delivery is tried at once; the target's status comes from `paseo.agents.ref(id).refresh()`: `idle` or `error` (with no pending permission) is wakeable; `running`, `initializing` or a pending permission is busy; `closed`, archived or unknown is gone (queue dropped, post stays). A busy target is checked again after 2 s, up to 3 times, which covers a `turn.after` hook that fires before the status settles; after that it waits for `agent.turn.after`. A target over its 6-per-hour limit gets one timer for when its oldest wake leaves the hour.
3. **The wake queue is in memory**; the pause switch is persisted in `boards.json`. A daemon restart drops queued deliveries, never posts.
4. **Agents in the office** are the first 200 non-archived, non-internal, non-background agents whose status is not `closed` (the directory's page limit is 200), as the sidebar shows them.
5. **Permission answers on the row and card** are Approve and Deny for kinds `tool`, `mode` and `other`. A `plan` or `question` request shows "Answer in the session" with Open session.
6. **three.js is kept in memory for the page's life**, not stored across reloads.
7. **Authors.** An agent posts as its id; the user posts as `user`. Agents can claim, finish and reopen; only the user deletes.
8. **The "doing now" line** names the newest timeline item's kind (`Running <tool>`, `Ran <tool>`, `Writing a reply`, `Thinking`, `Reading the prompt`); it never quotes prompt or tool text.
9. **`office_read` paging.** Without `since` it returns the newest 30 posts; with `since` it returns the next 30 after the cursor, oldest first, and says when more follow, so an agent can page forward without skipping posts. Both lists end with the newest post they hold.
10. **A full board.** When a new post would make 201, the oldest done tasks go, then the oldest notes; open and claimed tasks are never dropped, so a board of 200 of them refuses the post with an error.
11. **The whiteboard in 3D holds 8 notes** (oldest open tasks first, then notes); a claimed task lies on its claimer's desk when the claimer is seated. Every post is still in the structure view and the sheet.
12. **Names in prompts and tool text.** The server knows agent titles from hook payloads and tool calls only, so it labels an agent it has not seen by its id. A wake prompt names an agent author as `<title> (<id>)` so the woken agent can answer with `to`.
13. **Planes** fly only for posts that appear while a scene is open (the first plan seeds the seen posts), from the author's robot or, for the user or an unseated author, from the room's whiteboard.

## File structure

```
plugins/office/
  paseo-plugin.json            manifest
  index.server.ts              registration only: subscription, RPCs, hooks, settings
  index.client.tsx             registration only: screen, sidebar item, workspace panel, Command Center item
  vendor/three.module.min.js   three.js r170, unmodified
  vendor/LICENSE-three         three.js MIT licence
  vendor/SOURCES.md            where both came from, checksums
  shared/contracts.ts          wire contract: schemas, limits, subscription and RPCs
  shared/settings.ts           host setting (agent tools) and device setting (3D)
  server/paths.ts              $PASEO_HOME/office/boards.json
  server/errors.ts             errorMessage
  server/timers.ts             Timers port, unref'd node timers
  server/fake-clock.ts         deterministic clock and timers for tests
  server/directory.ts          pure: agent and workspace projection and updates
  server/paseo-directory.ts    live adapter: subscribed agent and workspace lists
  server/activity.ts           "doing now" line and its 5 s poller
  server/paseo-holder.ts       the plugin's paseo API, refreshed by every handler
  server/hub.ts                state, subscribers, start/stop of directory and activity
  server/live-ports.ts         hub ports and agent ports built on the paseo holder
  server/asset.ts              reads and checks the vendored three.js
  server/board-store.ts        boards.json: one writer, temp file then rename, corrupt file aside
  server/board-service.ts      post, claim, done, reopen, delete, limits, prune
  server/mention-queue.ts      deliveries, batching, hourly limit, pause, retries
  server/agent-tools.ts        office_read, office_post, office_update
  server/office.ts             composition of store, service, queue, hub and tools
  client/office-state.ts       pure reducer of office.state events
  client/use-office.ts         hook: subscription into reducer state
  client/model.ts              pure: rooms, rows, attention list, dot tones
  client/styles.ts             surface styles from the theme
  client/action-button.tsx     a button with pending and error states
  client/permission-actions.tsx  Approve and Deny, or "Answer in the session"
  client/use-agent-actions.ts  send, respond, cancel through usePaseo()
  client/office-surface.tsx    header, then the 3D view or the structure view
  client/attention-strip.tsx   agents that need the user
  client/structure-view.tsx    the 2D view
  client/agent-card.tsx        the agent's actions
  client/board-text.ts         pure: author names, post meta lines, board order, wake summary
  client/use-board-actions.ts  post, mark done, delete, pause wakes through the RPCs
  client/room-board.tsx        a room's posts in the structure view
  client/board-sheet.tsx       posting, mark done, delete
  client/host-switches.tsx     "Wake agents" and "Agent tools" switches
  client/layout.ts             pure: room grid and desk seats, stable
  client/scene/palette.ts      pure: theme to scene colors, provider visor color
  client/scene/scene-plan.ts   pure: robots, desks, poses, frames, notes, planes
  client/scene/camera.ts       pure: pan, zoom, focus
  client/scene/three-types.ts  the three.js surface the scene uses, and its guard
  client/scene/three-loader.ts pure: load state machine
  client/scene/web-env.web.ts  WebGL2, reduced motion, coarse pointer, module evaluation
  client/scene/office-scene.web.ts  three.js wiring
  client/scene/scene-view.tsx  React host of the scene
  client/scene/fake-office.ts  fake office for the screenshot gate and tests
```

Upstream files touched: `packages/client/src/index.ts` and its test (Task 2), `public-docs/sdk/reference.md` and `.zh-CN.md` (Task 2), `packages/server/src/server/plugins/builtin/index.ts` (Task 3), `.oxlintrc.json` and `.oxfmtrc.json` (Task 13), `docs/plugins.md` (Tasks 10, 20, 29). Docker needs no change: `docker/base/Dockerfile` copies the repo and builds the server, whose `build:lib` copies all of `plugins/` (minus tests) into `dist/server/builtin-plugins`.

## Task overview

| Phase                                          | Tasks | Ends with                                                                                                                                       |
| ---------------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Model, structure view, actions, both places | 1-10  | The office as a sidebar screen and a workspace tab, structure view of live agents, the agent card's four actions, then a design polish (Task 9) |
| 2. Scene                                       | 11-20 | 3D office on web with fake data, the owner's screenshot approval (Task 17), live data, then a design polish (Task 19)                           |
| 3. Boards, tools, wake                         | 21-29 | Boards in both views, three agent tools, wake on mention with limit and pause, then a design polish (Task 28)                                   |

---

# Phase 1: model, structure view, actions, both places

### Task 1: Put the spec and this plan in the docs

Tier: cheap.

**Files:**

- Create: `docs/superpowers/specs/2026-11-11-agent-office-design.md` (copied from `.superpowers/drafts/2026-11-11-agent-office-design.md`, which is git-ignored)
- Create: `docs/superpowers/plans/2026-11-11-agent-office.md` (copied from `.superpowers/drafts/2026-11-11-agent-office-plan.md`)
- Check, do not modify: `CLAUDE.md`

**Interfaces:**

- Consumes: nothing.
- Produces: the spec at the path this plan's header names.

- [ ] **Step 1: Copy both files**

```bash
cd /workspace/utils/paseo
mkdir -p docs/superpowers/specs docs/superpowers/plans
cp .superpowers/drafts/2026-11-11-agent-office-design.md docs/superpowers/specs/2026-11-11-agent-office-design.md
cp .superpowers/drafts/2026-11-11-agent-office-plan.md docs/superpowers/plans/2026-11-11-agent-office.md
```

- [ ] **Step 2: Check whether `CLAUDE.md` lists specs one by one**

Run: `grep -n "superpowers" /workspace/utils/paseo/CLAUDE.md`
Expected: one line, the docs table row for the folder `docs/superpowers/specs/`. The table lists the folder, not individual specs, so `CLAUDE.md` gets no row. If the output instead shows rows for individual spec files, add one for this spec in the same form, sorted with the others.

- [ ] **Step 3: Format**

```bash
cd /workspace/utils/paseo
npm run format:files -- docs/superpowers/specs/2026-11-11-agent-office-design.md docs/superpowers/plans/2026-11-11-agent-office.md
npm run format:check:files -- docs/superpowers/specs/2026-11-11-agent-office-design.md docs/superpowers/plans/2026-11-11-agent-office.md
```

Expected: the check exits 0.

- [ ] **Step 4: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add docs/superpowers/specs/2026-11-11-agent-office-design.md docs/superpowers/plans/2026-11-11-agent-office.md
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "docs(fork): agent office design and plan" -- docs/superpowers/specs/2026-11-11-agent-office-design.md docs/superpowers/plans/2026-11-11-agent-office.md
git log -1 --format='%an <%ae> | %cn <%ce>'
```

Expected: `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.

---

### Task 2: `cancel()` on the SDK's agent handle

Tier: cheap.

The spec's one core change. `cancel_agent_request` is an old message every daemon understands, so no capability gate and no `COMPAT` tag are needed (`docs/protocol-compatibility.md`: the feature contract gates new capabilities only). `PaseoAgentHandle` is implemented only in `packages/client/src/index.ts`; `PluginPaseoApi` (`packages/plugin/src/client/reference-api.ts`) reuses the type, so plugins get `cancel()` without a plugin package change. The public SDK reference lists the handle's members, so it gets the row.

**Files:**

- Modify: `packages/client/src/index.ts` (interface `PaseoAgentHandle`, after `send`; the handle object in `createAgentHandleFactory`, after `send`)
- Test: `packages/client/src/index.test.ts` (two tests after `agent handle closeRuntime fails fast on a host without agentRuntimeClose`)
- Modify: `public-docs/sdk/reference.md`, `public-docs/sdk/reference.zh-CN.md` (Agent handle table, after the `send` row)

**Interfaces:**

- Consumes: `DaemonClient.cancelAgent(agentId: string): Promise<void>` (`packages/client/src/daemon-client.ts`, throws `Error(payload.error)` when the response carries one).
- Produces: `PaseoAgentHandle.cancel(): Promise<void>`, used by Task 8 as `paseo.agents.ref(agentId).cancel()`.

- [ ] **Step 1: Write the failing tests**

Add after the test `agent handle closeRuntime fails fast on a host without agentRuntimeClose` in `packages/client/src/index.test.ts`:

```ts
test("agent handle cancel sends cancel_agent_request", async () => {
  const { client, ws } = await connectClient();
  const agent = client.agents.ref("agent_sdk");

  const cancelPromise = agent.cancel();
  await vi.waitFor(() =>
    expect(parseSentSessionMessage(ws.sent.at(-1))).toMatchObject({
      type: "cancel_agent_request",
      agentId: "agent_sdk",
    }),
  );
  const request = parseSentSessionMessage(ws.sent.at(-1));
  ws.message(
    sessionMessage({
      type: "cancel_agent_response",
      payload: { requestId: request.requestId, agentId: "agent_sdk", agent: null, error: null },
    }),
  );

  await expect(cancelPromise).resolves.toBeUndefined();
  await client.close();
});

test("agent handle cancel rejects with the daemon's error", async () => {
  const { client, ws } = await connectClient();
  const agent = client.agents.ref("agent_gone");

  const cancelPromise = agent.cancel();
  await vi.waitFor(() =>
    expect(parseSentSessionMessage(ws.sent.at(-1))).toMatchObject({
      type: "cancel_agent_request",
      agentId: "agent_gone",
    }),
  );
  const request = parseSentSessionMessage(ws.sent.at(-1));
  ws.message(
    sessionMessage({
      type: "cancel_agent_response",
      payload: {
        requestId: request.requestId,
        agentId: "agent_gone",
        agent: null,
        error: "Agent not found",
      },
    }),
  );

  await expect(cancelPromise).rejects.toThrow("Agent not found");
  await client.close();
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /workspace/utils/paseo/packages/client && flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/index.test.ts -t "agent handle cancel" --bail=1`
Expected: FAIL, `agent.cancel is not a function`.

- [ ] **Step 3: Add the member to the interface**

In `packages/client/src/index.ts`, interface `PaseoAgentHandle`, directly after `send(text: string, options?: PaseoAgentSendOptions): Promise<void>;`:

```ts
  // Fork delta (agent office): the cancel_agent_request message, as the cancel_agent tool sends it.
  /** Stops the agent's running turn. Rejects with the daemon's error. */
  cancel(): Promise<void>;
```

- [ ] **Step 4: Implement it**

In the same file, in the handle object built by `createAgentHandleFactory`, directly after the `send: async (text, options) => { ... },` entry:

```ts
      // Fork delta (agent office): the cancel_agent_request message.
      cancel: async () => {
        await daemonClient.cancelAgent(id);
      },
```

- [ ] **Step 5: Run the tests to see them pass**

Run: `cd /workspace/utils/paseo/packages/client && flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/index.test.ts -t "agent handle cancel" --bail=1`
Expected: PASS, 2 tests.

- [ ] **Step 6: Add the reference rows**

In `public-docs/sdk/reference.md`, Agent handle table, after the row that starts ``| `send(text, options?)` ``:

```markdown
| `cancel()` | `Promise<void>` | Stops the running turn, as the `cancel_agent` tool does. Rejects with the daemon's error. |
```

In `public-docs/sdk/reference.zh-CN.md`, same table, after the row that starts ``| `send(text, options?)` ``:

```markdown
| `cancel()` | `Promise<void>` | 停止正在运行的轮次，与 `cancel_agent` 工具相同。失败时带上 daemon 的错误。 |
```

The formatter in Step 7 pads the columns.

- [ ] **Step 7: Typecheck, lint, format, build**

```bash
cd /workspace/utils/paseo/packages/client && flock -w 480 /tmp/paseo-heavy.lock npx tsgo --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- packages/client/src/index.ts packages/client/src/index.test.ts public-docs/sdk/reference.md public-docs/sdk/reference.zh-CN.md
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- packages/client/src/index.ts packages/client/src/index.test.ts
flock -w 480 /tmp/paseo-heavy.lock npm run build:client
```

Expected: each exits 0. The build makes `cancel()` visible to the plugins typecheck from Task 8 on.

- [ ] **Step 8: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add packages/client/src/index.ts packages/client/src/index.test.ts public-docs/sdk/reference.md public-docs/sdk/reference.zh-CN.md
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): cancel() on the SDK agent handle" -- packages/client/src/index.ts packages/client/src/index.test.ts public-docs/sdk/reference.md public-docs/sdk/reference.zh-CN.md
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 3: Scaffold the office built-in and its wire contract

Tier: cheap.

The whole wire contract is defined here, once, so every later task imports the same names. Handlers for the RPCs arrive in Tasks 13 and 25.

**Files:**

- Create: `plugins/office/paseo-plugin.json`
- Create: `plugins/office/shared/contracts.ts`
- Test: `plugins/office/shared/contracts.test.ts`
- Create: `plugins/office/shared/settings.ts`
- Create: `plugins/office/server/paths.ts`
- Test: `plugins/office/server/paths.test.ts`
- Create: `plugins/office/server/errors.ts`
- Create: `plugins/office/index.server.ts`
- Modify: `packages/server/src/server/plugins/builtin/index.ts` (`builtinPlugins`, between `"muse-provider"` and `"opencode-go-usage-source"`)

**Interfaces:**

- Consumes: `defineRpc`, `defineSubscription`, `defineSettings` from `@getpaseo/plugin`.
- Produces (every later task uses these exact names):
  - Constants: `LOBBY = "lobby"`, `USER_AUTHOR = "user"`, `POST_TEXT_MAX = 2000`, `BOARD_POST_MAX = 200`, `DONE_TASK_TTL_MS = 604800000`, `READ_POST_MAX = 30`, `WAKES_PER_HOUR = 6`.
  - Types: `AgentStatus`, `PermissionKind`, `OfficePermission { id; kind; title }`, `OfficeAgent { id; title: string | null; provider; model: string | null; status: AgentStatus; workspaceId: string | null; parentAgentId: string | null; permissions: OfficePermission[]; createdAt }`, `OfficeWorkspace { id; name; projectName }`, `PostKind = "task" | "note"`, `TaskState = "open" | "claimed" | "done"`, `UpdateAction = "claim" | "done" | "reopen"`, `Post { id; seq; board; kind; text; author; to?; state?; claimedBy?; createdAt; updatedAt }`, `WakeState { paused: boolean; queued: Record<string, number> }`, `OfficeSnapshot { agents; workspaces; activity: Record<string, string>; boards: Record<string, Post[]>; wake }`, `OfficeEvent` (union on `type`: `snapshot`, `agents`, `workspaces`, `activity`, `board`, `board-removed`, `wake`), `PostResult = { ok: true; post: Post } | { ok: false; error: string }`, `DeleteResult = { ok: true } | { ok: false; error: string }`.
  - Contracts: `officeStateSubscription` (`office.state`, input `{}`, event `OfficeEvent`), `postRpc` (`office.post.request`, input `{ board, kind, text, to? }`, output `PostResult`), `updateRpc` (`office.update.request`, input `{ id, action }`, output `PostResult`), `deleteRpc` (`office.delete.request`, input `{ id }`, output `DeleteResult`), `setWakesPausedRpc` (`office.set_wakes_paused.request`, input `{ paused }`, output `WakeState`), `assetRpc` (`office.asset.request`, input `{}`, output `Uint8Array`).
  - Settings: `officeHostSettings` (id `office`, scope `host`, `{ agentTools: boolean }` default `true`), `officeDeviceSettings` (id `office-device`, scope `device`, `{ threeD: boolean }` default `true`).
  - `paseoHome(env, home): string`, `officeDir(env, home): string`, `boardsFile(env, home): string`, `errorMessage(error: unknown): string`.

- [ ] **Step 1: Write the failing tests**

`plugins/office/shared/contracts.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  OfficeEventSchema,
  PostSchema,
  assetRpc,
  deleteRpc,
  officeStateSubscription,
  postRpc,
  setWakesPausedRpc,
  updateRpc,
  type OfficeSnapshot,
} from "./contracts.js";

function emptySnapshot(): OfficeSnapshot {
  return {
    agents: [],
    workspaces: [],
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
}

test("contract names follow the dotted request convention", () => {
  expect([
    officeStateSubscription.name,
    postRpc.name,
    updateRpc.name,
    deleteRpc.name,
    setWakesPausedRpc.name,
    assetRpc.name,
  ]).toEqual([
    "office.state",
    "office.post.request",
    "office.update.request",
    "office.delete.request",
    "office.set_wakes_paused.request",
    "office.asset.request",
  ]);
});

test("a snapshot event and a note without state parse", () => {
  const note = {
    id: "p1",
    seq: 1,
    board: "lobby",
    kind: "note",
    text: "Build is green",
    author: "user",
    createdAt: "2026-11-11T00:00:00.000Z",
    updatedAt: "2026-11-11T00:00:00.000Z",
  };
  expect(PostSchema.parse(note)).toEqual(note);
  const snapshot = emptySnapshot();
  expect(OfficeEventSchema.parse({ type: "snapshot", state: snapshot })).toEqual({
    type: "snapshot",
    state: snapshot,
  });
});

test("a post longer than 2,000 characters is refused at the boundary", () => {
  const input = { board: "lobby", kind: "note", text: "x".repeat(2001) };
  expect(postRpc.input.safeParse(input).success).toBe(false);
  expect(postRpc.input.safeParse({ ...input, text: "x".repeat(2000) }).success).toBe(true);
});

test("the asset RPC returns bytes", () => {
  expect(assetRpc.output.safeParse(new Uint8Array([1, 2])).success).toBe(true);
  expect(assetRpc.output.safeParse("bytes").success).toBe(false);
});
```

`plugins/office/server/paths.test.ts`:

```ts
import { expect, test } from "vitest";
import { boardsFile, officeDir, paseoHome } from "./paths.js";

const HOME = "/home/u";

test("defaults PASEO_HOME to ~/.paseo and expands a leading ~/", () => {
  expect(paseoHome({}, HOME)).toBe("/home/u/.paseo");
  expect(paseoHome({ PASEO_HOME: "~/dev-home" }, HOME)).toBe("/home/u/dev-home");
  expect(paseoHome({ PASEO_HOME: "/srv/paseo" }, HOME)).toBe("/srv/paseo");
});

test("keeps the office's files under PASEO_HOME/office", () => {
  const env = { PASEO_HOME: "/srv/paseo" };
  expect(officeDir(env, HOME)).toBe("/srv/paseo/office");
  expect(boardsFile(env, HOME)).toBe("/srv/paseo/office/boards.json");
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/shared/contracts.test.ts --bail=1`
Expected: FAIL, cannot resolve `./contracts.js`.

- [ ] **Step 3: Write the manifest, contract, settings, paths and errors**

`plugins/office/paseo-plugin.json`:

```json
{ "id": "office", "requirements": { "paseo": ">=0.15.4" } }
```

`plugins/office/shared/contracts.ts`:

```ts
import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

/** The host-wide board. Every other board id is a workspace id. */
export const LOBBY = "lobby";
/** The author of a post the user made in the office. */
export const USER_AUTHOR = "user";
export const POST_TEXT_MAX = 2000;
export const BOARD_POST_MAX = 200;
export const DONE_TASK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const READ_POST_MAX = 30;
export const WAKES_PER_HOUR = 6;

export const AgentStatusSchema = z.enum(["initializing", "idle", "running", "error", "closed"]);
export type AgentStatus = z.output<typeof AgentStatusSchema>;

export const PermissionKindSchema = z.enum(["tool", "plan", "question", "mode", "other"]);
export type PermissionKind = z.output<typeof PermissionKindSchema>;

export const OfficePermissionSchema = z.object({
  id: z.string(),
  kind: PermissionKindSchema,
  title: z.string(),
});
export type OfficePermission = z.output<typeof OfficePermissionSchema>;

export const OfficeAgentSchema = z.object({
  id: z.string(),
  title: z.string().nullable(),
  provider: z.string(),
  model: z.string().nullable(),
  status: AgentStatusSchema,
  /** Null for an agent without a workspace; it sits in the lobby. */
  workspaceId: z.string().nullable(),
  parentAgentId: z.string().nullable(),
  permissions: z.array(OfficePermissionSchema),
  createdAt: z.string(),
});
export type OfficeAgent = z.output<typeof OfficeAgentSchema>;

export const OfficeWorkspaceSchema = z.object({
  id: z.string(),
  name: z.string(),
  projectName: z.string(),
});
export type OfficeWorkspace = z.output<typeof OfficeWorkspaceSchema>;

export const PostKindSchema = z.enum(["task", "note"]);
export type PostKind = z.output<typeof PostKindSchema>;

export const TaskStateSchema = z.enum(["open", "claimed", "done"]);
export type TaskState = z.output<typeof TaskStateSchema>;

export const UpdateActionSchema = z.enum(["claim", "done", "reopen"]);
export type UpdateAction = z.output<typeof UpdateActionSchema>;

export const PostSchema = z.object({
  /** `p` and the post's seq at creation. */
  id: z.string(),
  /** Raised on every change; office_read's cursor. */
  seq: z.number().int().nonnegative(),
  /** A workspace id, or "lobby". */
  board: z.string(),
  kind: PostKindSchema,
  text: z.string(),
  /** An agent id, or "user". */
  author: z.string(),
  to: z.string().optional(),
  /** Tasks only. */
  state: TaskStateSchema.optional(),
  claimedBy: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Post = z.output<typeof PostSchema>;

export const WakeStateSchema = z.object({
  paused: z.boolean(),
  /** Deliveries waiting, per agent id; agents with none are absent. */
  queued: z.record(z.string(), z.number().int().nonnegative()),
});
export type WakeState = z.output<typeof WakeStateSchema>;

export const OfficeSnapshotSchema = z.object({
  agents: z.array(OfficeAgentSchema),
  workspaces: z.array(OfficeWorkspaceSchema),
  /** The "doing now" line of each running agent that has one. */
  activity: z.record(z.string(), z.string()),
  boards: z.record(z.string(), z.array(PostSchema)),
  wake: WakeStateSchema,
});
export type OfficeSnapshot = z.output<typeof OfficeSnapshotSchema>;

export const OfficeEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), state: OfficeSnapshotSchema }),
  z.object({ type: z.literal("agents"), agents: z.array(OfficeAgentSchema) }),
  z.object({ type: z.literal("workspaces"), workspaces: z.array(OfficeWorkspaceSchema) }),
  z.object({ type: z.literal("activity"), activity: z.record(z.string(), z.string()) }),
  z.object({ type: z.literal("board"), board: z.string(), posts: z.array(PostSchema) }),
  z.object({ type: z.literal("board-removed"), board: z.string() }),
  z.object({ type: z.literal("wake"), wake: WakeStateSchema }),
]);
export type OfficeEvent = z.output<typeof OfficeEventSchema>;

export const PostResultSchema = z.union([
  z.object({ ok: z.literal(true), post: PostSchema }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type PostResult = z.output<typeof PostResultSchema>;

export const DeleteResultSchema = z.union([
  z.object({ ok: z.literal(true) }),
  z.object({ ok: z.literal(false), error: z.string() }),
]);
export type DeleteResult = z.output<typeof DeleteResultSchema>;

/** A snapshot, then changes. */
export const officeStateSubscription = defineSubscription({
  name: "office.state",
  input: z.object({}),
  event: OfficeEventSchema,
});

export const postRpc = defineRpc({
  name: "office.post.request",
  input: z.object({
    board: z.string().min(1),
    kind: PostKindSchema,
    text: z.string().min(1).max(POST_TEXT_MAX),
    to: z.string().min(1).optional(),
  }),
  output: PostResultSchema,
});

export const updateRpc = defineRpc({
  name: "office.update.request",
  input: z.object({ id: z.string().min(1), action: UpdateActionSchema }),
  output: PostResultSchema,
});

export const deleteRpc = defineRpc({
  name: "office.delete.request",
  input: z.object({ id: z.string().min(1) }),
  output: DeleteResultSchema,
});

export const setWakesPausedRpc = defineRpc({
  name: "office.set_wakes_paused.request",
  input: z.object({ paused: z.boolean() }),
  output: WakeStateSchema,
});

/** The vendored three.js build, as bytes. */
export const assetRpc = defineRpc({
  name: "office.asset.request",
  input: z.object({}),
  output: z.instanceof(Uint8Array),
});
```

The schemas stay plain (no `transform`, `trim` or `preprocess`); the board service rejects text that is blank after trimming.

`plugins/office/shared/settings.ts`:

```ts
import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Host-wide. Off removes the office tools from agent sessions opened afterwards. */
export const officeHostSettings = defineSettings({
  id: "office",
  scope: "host",
  version: 1,
  schema: z.object({ agentTools: z.boolean().default(true) }),
});

/** Per device. Off shows the structure view and never loads three.js. */
export const officeDeviceSettings = defineSettings({
  id: "office-device",
  scope: "device",
  version: 1,
  schema: z.object({ threeD: z.boolean().default(true) }),
});
```

`plugins/office/server/paths.ts`:

```ts
import { join, resolve } from "node:path";

// Copied from plugins/resource-manager/server/paths.ts, which mirrors resolvePaseoHome in
// packages/server/src/server/paseo-home.ts; a built-in can import neither.
function expandHomeDir(input: string, home: string): string {
  if (input.startsWith("~/")) return join(home, input.slice(2));
  if (input === "~") return home;
  return input;
}

/** Built-ins run in the daemon process, so the env is the daemon's. */
export function paseoHome(env: NodeJS.ProcessEnv, home: string): string {
  return resolve(expandHomeDir(env.PASEO_HOME ?? "~/.paseo", home));
}

export function officeDir(env: NodeJS.ProcessEnv, home: string): string {
  return join(paseoHome(env, home), "office");
}

export function boardsFile(env: NodeJS.ProcessEnv, home: string): string {
  return join(officeDir(env, home), "boards.json");
}
```

`plugins/office/server/errors.ts`:

```ts
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

`plugins/office/index.server.ts`:

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";

// Runs inside the daemon process; see the plan's "Daemon process safety" rule before adding work.
export default function contribute(_server: PluginServerContext): () => Promise<void> {
  return async () => {};
}
```

In `packages/server/src/server/plugins/builtin/index.ts`, `builtinPlugins`, insert between `"muse-provider",` and `"opencode-go-usage-source",`:

```ts
  "office",
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/shared/contracts.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/paths.test.ts --bail=1
cd packages/server && flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: PASS (4 tests, 2 tests, 1 test). The last one compiles every listed built-in, `office` included.

- [ ] **Step 5: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office packages/server/src/server/plugins/builtin/index.ts
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office packages/server/src/server/plugins/builtin/index.ts
```

Expected: each exits 0. If lint reports `no-unused-vars` for `_server`, drop the parameter (`export default function contribute(): () => Promise<void>`); the runtime still passes it.

- [ ] **Step 6: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/paseo-plugin.json plugins/office/index.server.ts plugins/office/shared/contracts.ts plugins/office/shared/contracts.test.ts plugins/office/shared/settings.ts plugins/office/server/paths.ts plugins/office/server/paths.test.ts plugins/office/server/errors.ts packages/server/src/server/plugins/builtin/index.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): scaffold the office built-in and its wire contract" -- plugins/office/paseo-plugin.json plugins/office/index.server.ts plugins/office/shared/contracts.ts plugins/office/shared/contracts.test.ts plugins/office/shared/settings.ts plugins/office/server/paths.ts plugins/office/server/paths.test.ts plugins/office/server/errors.ts packages/server/src/server/plugins/builtin/index.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 4: The agent and workspace directory (pure)

Tier: standard.

**Files:**

- Create: `plugins/office/server/directory.ts`
- Test: `plugins/office/server/directory.test.ts`

**Interfaces:**

- Consumes: `OfficeAgent`, `OfficeWorkspace`, `AgentStatusSchema`, `PermissionKindSchema`, `PermissionKind` (Task 3).
- Produces:
  - `PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id"`
  - `interface DirectoryPermissionInput { id: string; name: string; kind: string; title?: string }`
  - `interface DirectoryAgentInput { id; title: string | null; provider; model: string | null; status: string; workspaceId?: string; createdAt: string; labels?: Readonly<Record<string, string>>; pendingPermissions: readonly DirectoryPermissionInput[]; archivedAt?: string | null; internal?: boolean; background?: boolean }` (the real `AgentSnapshotPayload` satisfies it)
  - `type AgentUpdateInput = { kind: "upsert"; agent: DirectoryAgentInput } | { kind: "remove"; agentId: string }`
  - `interface DirectoryWorkspaceInput { id; name; projectDisplayName; archivingAt?: string | null }`
  - `type WorkspaceUpdateInput = { kind: "upsert"; workspace: DirectoryWorkspaceInput } | { kind: "remove"; id: string }`
  - `projectAgent(agent: DirectoryAgentInput): OfficeAgent | null`
  - `agentsFromSnapshot(agents: readonly DirectoryAgentInput[]): Map<string, OfficeAgent>`
  - `applyAgentUpdate(agents: ReadonlyMap<string, OfficeAgent>, update: AgentUpdateInput): Map<string, OfficeAgent>`
  - `projectWorkspace(workspace: DirectoryWorkspaceInput): OfficeWorkspace | null`
  - `workspacesFromSnapshot(workspaces: readonly DirectoryWorkspaceInput[]): Map<string, OfficeWorkspace>`
  - `applyWorkspaceUpdate(workspaces: ReadonlyMap<string, OfficeWorkspace>, update: WorkspaceUpdateInput): Map<string, OfficeWorkspace>`
  - `sortAgents(agents: Iterable<OfficeAgent>): OfficeAgent[]` (createdAt, then id)
  - `sortWorkspaces(workspaces: Iterable<OfficeWorkspace>): OfficeWorkspace[]` (name, then project name, then id)

- [ ] **Step 1: Write the failing test**

`plugins/office/server/directory.test.ts`:

```ts
import { expect, test } from "vitest";
import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import {
  agentsFromSnapshot,
  applyAgentUpdate,
  applyWorkspaceUpdate,
  projectAgent,
  projectWorkspace,
  sortAgents,
  sortWorkspaces,
  workspacesFromSnapshot,
  type DirectoryAgentInput,
  type DirectoryWorkspaceInput,
} from "./directory.js";

function agentInput(overrides: Partial<DirectoryAgentInput>): DirectoryAgentInput {
  return {
    id: "a1",
    title: "Builder",
    provider: "claude",
    model: "opus",
    status: "idle",
    workspaceId: "w1",
    createdAt: "2026-11-11T08:00:00.000Z",
    labels: {},
    pendingPermissions: [],
    ...overrides,
  };
}

function officeAgent(overrides: Partial<OfficeAgent>): OfficeAgent {
  return {
    id: "a1",
    title: "Builder",
    provider: "claude",
    model: "opus",
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
    ...overrides,
  };
}

function workspaceInput(overrides: Partial<DirectoryWorkspaceInput>): DirectoryWorkspaceInput {
  return { id: "w1", name: "main", projectDisplayName: "paseo", archivingAt: null, ...overrides };
}

test("projects an agent with its parent and pending permissions", () => {
  const projected = projectAgent(
    agentInput({
      status: "running",
      labels: { "paseo.parent-agent-id": " p0 " },
      pendingPermissions: [
        { id: "r1", name: "Bash", kind: "tool", title: "Run npm test" },
        { id: "r2", name: "ExitPlanMode", kind: "plan" },
        { id: "r3", name: "Odd", kind: "something-new" },
      ],
    }),
  );
  expect(projected).toEqual(
    officeAgent({
      status: "running",
      parentAgentId: "p0",
      permissions: [
        { id: "r1", kind: "tool", title: "Run npm test" },
        { id: "r2", kind: "plan", title: "ExitPlanMode" },
        { id: "r3", kind: "other", title: "Odd" },
      ],
    }),
  );
});

test("an agent without a workspace sits in the lobby", () => {
  expect(projectAgent(agentInput({ workspaceId: undefined }))).toEqual(
    officeAgent({ workspaceId: null }),
  );
});

test("closed, archived, internal, background and unknown agents are not shown", () => {
  expect(projectAgent(agentInput({ status: "closed" }))).toBe(null);
  expect(projectAgent(agentInput({ archivedAt: "2026-11-11T09:00:00.000Z" }))).toBe(null);
  expect(projectAgent(agentInput({ internal: true }))).toBe(null);
  expect(projectAgent(agentInput({ background: true }))).toBe(null);
  expect(projectAgent(agentInput({ status: "sleeping" }))).toBe(null);
});

test("updates replace, remove, and drop an agent that closed", () => {
  const start = agentsFromSnapshot([agentInput({}), agentInput({ id: "a2", status: "closed" })]);
  expect([...start.values()]).toEqual([officeAgent({})]);

  const running = applyAgentUpdate(start, {
    kind: "upsert",
    agent: agentInput({ status: "running" }),
  });
  expect([...running.values()]).toEqual([officeAgent({ status: "running" })]);
  expect([...start.values()]).toEqual([officeAgent({})]);

  const closed = applyAgentUpdate(running, {
    kind: "upsert",
    agent: agentInput({ status: "closed" }),
  });
  expect(closed.size).toBe(0);

  const removed = applyAgentUpdate(running, { kind: "remove", agentId: "a1" });
  expect(removed.size).toBe(0);
});

test("workspaces project, drop while archiving, and update", () => {
  expect(projectWorkspace(workspaceInput({}))).toEqual({
    id: "w1",
    name: "main",
    projectName: "paseo",
  });
  expect(projectWorkspace(workspaceInput({ archivingAt: "2026-11-11T09:00:00.000Z" }))).toBe(null);

  const start = workspacesFromSnapshot([
    workspaceInput({}),
    workspaceInput({ id: "w2", name: "docs" }),
  ]);
  const renamed = applyWorkspaceUpdate(start, {
    kind: "upsert",
    workspace: workspaceInput({ id: "w2", name: "guides" }),
  });
  expect(sortWorkspaces(renamed.values())).toEqual([
    { id: "w2", name: "guides", projectName: "paseo" },
    { id: "w1", name: "main", projectName: "paseo" },
  ]);
  expect([...applyWorkspaceUpdate(renamed, { kind: "remove", id: "w1" }).keys()]).toEqual(["w2"]);
});

test("agents sort by creation time, then id; workspaces by name, project, then id", () => {
  const later = officeAgent({ id: "a0", createdAt: "2026-11-11T09:00:00.000Z" });
  const first = officeAgent({ id: "b", createdAt: "2026-11-11T08:00:00.000Z" });
  const tie = officeAgent({ id: "a", createdAt: "2026-11-11T08:00:00.000Z" });
  expect(sortAgents([later, first, tie]).map((agent) => agent.id)).toEqual(["a", "b", "a0"]);

  const workspaces: OfficeWorkspace[] = [
    { id: "w3", name: "main", projectName: "web" },
    { id: "w2", name: "main", projectName: "api" },
    { id: "w1", name: "docs", projectName: "web" },
  ];
  expect(sortWorkspaces(workspaces).map((workspace) => workspace.id)).toEqual(["w1", "w2", "w3"]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/directory.test.ts --bail=1`
Expected: FAIL, cannot resolve `./directory.js`.

- [ ] **Step 3: Write the directory**

`plugins/office/server/directory.ts`:

```ts
import {
  AgentStatusSchema,
  PermissionKindSchema,
  type OfficeAgent,
  type OfficeWorkspace,
  type PermissionKind,
} from "../shared/contracts.js";

// PARENT_AGENT_ID_LABEL in packages/protocol/src/agent-labels.ts. Server code may import the
// protocol's types, not its values.
export const PARENT_AGENT_ID_LABEL = "paseo.parent-agent-id";

export interface DirectoryPermissionInput {
  id: string;
  name: string;
  kind: string;
  title?: string;
}

/** The fields the office reads from an agent snapshot (AgentSnapshotPayload satisfies it). */
export interface DirectoryAgentInput {
  id: string;
  title: string | null;
  provider: string;
  model: string | null;
  status: string;
  workspaceId?: string;
  createdAt: string;
  labels?: Readonly<Record<string, string>>;
  pendingPermissions: readonly DirectoryPermissionInput[];
  archivedAt?: string | null;
  internal?: boolean;
  background?: boolean;
}

export type AgentUpdateInput =
  | { kind: "upsert"; agent: DirectoryAgentInput }
  | { kind: "remove"; agentId: string };

/** The fields the office reads from a workspace descriptor. */
export interface DirectoryWorkspaceInput {
  id: string;
  name: string;
  projectDisplayName: string;
  archivingAt?: string | null;
}

export type WorkspaceUpdateInput =
  | { kind: "upsert"; workspace: DirectoryWorkspaceInput }
  | { kind: "remove"; id: string };

function permissionKind(kind: string): PermissionKind {
  const parsed = PermissionKindSchema.safeParse(kind);
  return parsed.success ? parsed.data : "other";
}

/** The office's view of an agent, or null when the office does not show it. */
export function projectAgent(agent: DirectoryAgentInput): OfficeAgent | null {
  if (agent.internal === true || agent.background === true || agent.archivedAt) return null;
  const status = AgentStatusSchema.safeParse(agent.status);
  if (!status.success || status.data === "closed") return null;
  const parent = agent.labels?.[PARENT_AGENT_ID_LABEL]?.trim() ?? "";
  return {
    id: agent.id,
    title: agent.title,
    provider: agent.provider,
    model: agent.model,
    status: status.data,
    workspaceId: agent.workspaceId ?? null,
    parentAgentId: parent === "" ? null : parent,
    permissions: agent.pendingPermissions.map((request) => ({
      id: request.id,
      kind: permissionKind(request.kind),
      title: request.title ?? request.name,
    })),
    createdAt: agent.createdAt,
  };
}

export function agentsFromSnapshot(
  agents: readonly DirectoryAgentInput[],
): Map<string, OfficeAgent> {
  const map = new Map<string, OfficeAgent>();
  for (const agent of agents) {
    const projected = projectAgent(agent);
    if (projected) map.set(projected.id, projected);
  }
  return map;
}

export function applyAgentUpdate(
  agents: ReadonlyMap<string, OfficeAgent>,
  update: AgentUpdateInput,
): Map<string, OfficeAgent> {
  const next = new Map(agents);
  if (update.kind === "remove") {
    next.delete(update.agentId);
    return next;
  }
  const projected = projectAgent(update.agent);
  if (projected) next.set(projected.id, projected);
  else next.delete(update.agent.id);
  return next;
}

export function projectWorkspace(workspace: DirectoryWorkspaceInput): OfficeWorkspace | null {
  if (workspace.archivingAt) return null;
  return { id: workspace.id, name: workspace.name, projectName: workspace.projectDisplayName };
}

export function workspacesFromSnapshot(
  workspaces: readonly DirectoryWorkspaceInput[],
): Map<string, OfficeWorkspace> {
  const map = new Map<string, OfficeWorkspace>();
  for (const workspace of workspaces) {
    const projected = projectWorkspace(workspace);
    if (projected) map.set(projected.id, projected);
  }
  return map;
}

export function applyWorkspaceUpdate(
  workspaces: ReadonlyMap<string, OfficeWorkspace>,
  update: WorkspaceUpdateInput,
): Map<string, OfficeWorkspace> {
  const next = new Map(workspaces);
  if (update.kind === "remove") {
    next.delete(update.id);
    return next;
  }
  const projected = projectWorkspace(update.workspace);
  if (projected) next.set(projected.id, projected);
  else next.delete(update.workspace.id);
  return next;
}

export function sortAgents(agents: Iterable<OfficeAgent>): OfficeAgent[] {
  return [...agents].sort(
    (left, right) =>
      left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

export function sortWorkspaces(workspaces: Iterable<OfficeWorkspace>): OfficeWorkspace[] {
  return [...workspaces].sort(
    (left, right) =>
      left.name.localeCompare(right.name) ||
      left.projectName.localeCompare(right.projectName) ||
      left.id.localeCompare(right.id),
  );
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/directory.test.ts --bail=1`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/server/directory.ts plugins/office/server/directory.test.ts
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/server/directory.ts plugins/office/server/directory.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/server/directory.ts plugins/office/server/directory.test.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office agent and workspace directory" -- plugins/office/server/directory.ts plugins/office/server/directory.test.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 5: Timers, a fake clock, and the "doing now" line

Tier: standard.

**Files:**

- Create: `plugins/office/server/timers.ts`
- Create: `plugins/office/server/fake-clock.ts`
- Test: `plugins/office/server/fake-clock.test.ts`
- Create: `plugins/office/server/activity.ts`
- Test: `plugins/office/server/activity.test.ts`

**Interfaces:**

- Consumes: `errorMessage` (Task 3).
- Produces:
  - `interface Timers { setTimeout(run: () => void, ms: number): () => void }`, `nodeTimers: Timers` (unref'd).
  - `interface FakeClock extends Timers { now(): number; advance(ms: number): void; pending(): number }`, `createFakeClock(start?: number): FakeClock`, `settle(): Promise<void>`.
  - `ACTIVITY_INTERVAL_MS = 5000`, `ACTIVITY_TAIL_LIMIT = 10`.
  - `interface ActivityItem { type: string; name?: unknown; status?: unknown }`
  - `describeActivity(items: readonly ActivityItem[]): string | null`
  - `interface ActivityPorts { running(): readonly string[]; tail(agentId: string): Promise<readonly ActivityItem[]>; timers: Timers; log(message: string): void; onChange(activity: Readonly<Record<string, string>>): void }`
  - `interface ActivityPoller { stop(): void }`, `startActivityPoller(ports: ActivityPorts): ActivityPoller`

- [ ] **Step 1: Write the failing tests**

`plugins/office/server/fake-clock.test.ts`:

```ts
import { expect, test } from "vitest";
import { createFakeClock } from "./fake-clock.js";

test("runs due timers in time order and moves now to each", () => {
  const clock = createFakeClock(1000);
  const ran: string[] = [];
  clock.setTimeout(() => ran.push(`b@${clock.now()}`), 20);
  clock.setTimeout(() => ran.push(`a@${clock.now()}`), 10);
  const cancel = clock.setTimeout(() => ran.push("never"), 15);
  cancel();
  clock.advance(15);
  expect(ran).toEqual(["a@1010"]);
  expect(clock.now()).toBe(1015);
  clock.advance(5);
  expect(ran).toEqual(["a@1010", "b@1020"]);
  expect(clock.pending()).toBe(0);
});

test("a timer scheduled by a running timer runs in the same advance when due", () => {
  const clock = createFakeClock();
  const ran: number[] = [];
  clock.setTimeout(() => {
    ran.push(clock.now());
    clock.setTimeout(() => ran.push(clock.now()), 5);
  }, 5);
  clock.advance(10);
  expect(ran).toEqual([5, 10]);
});
```

`plugins/office/server/activity.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  ACTIVITY_INTERVAL_MS,
  describeActivity,
  startActivityPoller,
  type ActivityItem,
  type ActivityPoller,
} from "./activity.js";
import { createFakeClock, settle, type FakeClock } from "./fake-clock.js";

test("names the newest item it knows", () => {
  expect(
    describeActivity([
      { type: "user_message" },
      { type: "tool_call", name: "Bash", status: "running" },
    ]),
  ).toBe("Running Bash");
  expect(describeActivity([{ type: "tool_call", name: "Read", status: "completed" }])).toBe(
    "Ran Read",
  );
  expect(
    describeActivity([
      { type: "tool_call", name: "Read", status: "completed" },
      { type: "assistant_message" },
    ]),
  ).toBe("Writing a reply");
  expect(describeActivity([{ type: "reasoning" }])).toBe("Thinking");
  expect(describeActivity([{ type: "user_message" }, { type: "todo" }])).toBe("Reading the prompt");
  expect(describeActivity([{ type: "todo" }])).toBe(null);
  expect(describeActivity([])).toBe(null);
});

test("cuts a tool name to 60 characters", () => {
  const name = "x".repeat(80);
  expect(describeActivity([{ type: "tool_call", name, status: "running" }])).toBe(
    `Running ${"x".repeat(60)}`,
  );
});

interface PollerHarness {
  clock: FakeClock;
  running: string[];
  tails: Map<string, ActivityItem[]>;
  reads: string[];
  changes: Record<string, string>[];
  logs: string[];
  poller: ActivityPoller;
}

function startHarness(running: string[], tails: Map<string, ActivityItem[]>): PollerHarness {
  const clock = createFakeClock();
  const reads: string[] = [];
  const changes: Record<string, string>[] = [];
  const logs: string[] = [];
  const poller = startActivityPoller({
    running: () => running,
    tail: async (agentId) => {
      reads.push(agentId);
      const items = tails.get(agentId);
      if (!items) throw new Error(`no timeline for ${agentId}`);
      return items;
    },
    timers: clock,
    log: (message) => logs.push(message),
    onChange: (activity) => changes.push({ ...activity }),
  });
  return { clock, running, tails, reads, changes, logs, poller };
}

test("reads each running agent once per interval and reports only changes", async () => {
  const tails = new Map<string, ActivityItem[]>([
    ["a", [{ type: "tool_call", name: "Bash", status: "running" }]],
  ]);
  const harness = startHarness(["a"], tails);
  await settle();
  expect(harness.changes).toEqual([{ a: "Running Bash" }]);

  harness.clock.advance(ACTIVITY_INTERVAL_MS - 1);
  await settle();
  expect(harness.reads).toEqual(["a"]);

  harness.clock.advance(1);
  await settle();
  expect(harness.reads).toEqual(["a", "a"]);
  expect(harness.changes).toEqual([{ a: "Running Bash" }]);

  tails.set("a", [{ type: "assistant_message" }]);
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  expect(harness.changes).toEqual([{ a: "Running Bash" }, { a: "Writing a reply" }]);
  harness.poller.stop();
});

test("an agent that stops running loses its line", async () => {
  const running = ["a"];
  const harness = startHarness(running, new Map([["a", [{ type: "reasoning" }]]]));
  await settle();
  running.length = 0;
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  expect(harness.changes).toEqual([{ a: "Thinking" }, {}]);
  harness.poller.stop();
});

test("a failed read keeps the agent's last line and is logged", async () => {
  const tails = new Map<string, ActivityItem[]>([["a", [{ type: "reasoning" }]]]);
  const harness = startHarness(["a"], tails);
  await settle();
  tails.delete("a");
  harness.clock.advance(ACTIVITY_INTERVAL_MS);
  await settle();
  expect(harness.changes).toEqual([{ a: "Thinking" }]);
  expect(harness.logs).toEqual(["[office] activity of a: no timeline for a"]);
  harness.poller.stop();
});

test("stop ends the reads and leaves no timer", async () => {
  const harness = startHarness(["a"], new Map([["a", [{ type: "reasoning" }]]]));
  await settle();
  harness.poller.stop();
  harness.clock.advance(ACTIVITY_INTERVAL_MS * 3);
  await settle();
  expect(harness.reads).toEqual(["a"]);
  expect(harness.clock.pending()).toBe(0);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/fake-clock.test.ts --bail=1`
Expected: FAIL, cannot resolve `./fake-clock.js`.

- [ ] **Step 3: Write timers, the fake clock and the activity poller**

`plugins/office/server/timers.ts`:

```ts
import { clearTimeout as clearNodeTimeout, setTimeout as setNodeTimeout } from "node:timers";

export interface Timers {
  /** Runs `run` once after `ms`; the returned function cancels it. */
  setTimeout(run: () => void, ms: number): () => void;
}

/** Node timers that never keep the daemon alive on their own. */
export const nodeTimers: Timers = {
  setTimeout(run, ms) {
    const timer = setNodeTimeout(run, ms);
    timer.unref();
    return () => clearNodeTimeout(timer);
  },
};
```

`plugins/office/server/fake-clock.ts`:

```ts
import type { Timers } from "./timers.js";

// Test helper. Lives beside the code so tests in several folders share it; nothing imports it
// from index.server.ts, so it is not in the bundle.
export interface FakeClock extends Timers {
  now(): number;
  /** Moves time forward, running each due timer in time order, then stops at now + ms. */
  advance(ms: number): void;
  pending(): number;
}

interface Scheduled {
  id: number;
  at: number;
  run: () => void;
}

export function createFakeClock(start = 0): FakeClock {
  let current = start;
  let nextId = 0;
  const scheduled = new Map<number, Scheduled>();
  function firstDue(limit: number): Scheduled | null {
    let first: Scheduled | null = null;
    for (const entry of scheduled.values()) {
      if (entry.at > limit) continue;
      if (first === null || entry.at < first.at || (entry.at === first.at && entry.id < first.id)) {
        first = entry;
      }
    }
    return first;
  }
  return {
    now: () => current,
    setTimeout(run, ms) {
      const id = nextId;
      nextId += 1;
      scheduled.set(id, { id, at: current + Math.max(0, ms), run });
      return () => {
        scheduled.delete(id);
      };
    },
    advance(ms) {
      const target = current + ms;
      for (let next = firstDue(target); next !== null; next = firstDue(target)) {
        scheduled.delete(next.id);
        current = next.at;
        next.run();
      }
      current = target;
    },
    pending: () => scheduled.size,
  };
}

/** Lets promise chains started by a timer or a call run until they wait on something new. */
export async function settle(): Promise<void> {
  for (let round = 0; round < 5; round += 1) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}
```

`plugins/office/server/activity.ts`:

```ts
import { errorMessage } from "./errors.js";
import type { Timers } from "./timers.js";

/** At most one read per agent per interval (spec: once per 5 s per agent). */
export const ACTIVITY_INTERVAL_MS = 5000;
/** Timeline items read from the tail of each running agent. */
export const ACTIVITY_TAIL_LIMIT = 10;
const TOOL_NAME_MAX = 60;

/** The fields read from a timeline item; every AgentTimelineItem satisfies it. */
export interface ActivityItem {
  type: string;
  name?: unknown;
  status?: unknown;
}

/** One line for the newest item it recognises. Never quotes prompt or tool text. */
export function describeActivity(items: readonly ActivityItem[]): string | null {
  for (const item of [...items].reverse()) {
    if (item.type === "tool_call" && typeof item.name === "string" && item.name.length > 0) {
      const verb = item.status === "running" ? "Running" : "Ran";
      return `${verb} ${item.name.slice(0, TOOL_NAME_MAX)}`;
    }
    if (item.type === "assistant_message") return "Writing a reply";
    if (item.type === "reasoning") return "Thinking";
    if (item.type === "user_message") return "Reading the prompt";
  }
  return null;
}

export interface ActivityPorts {
  /** Ids of the agents running now. */
  running(): readonly string[];
  tail(agentId: string): Promise<readonly ActivityItem[]>;
  timers: Timers;
  log(message: string): void;
  onChange(activity: Readonly<Record<string, string>>): void;
}

export interface ActivityPoller {
  stop(): void;
}

function sameLines(
  left: Readonly<Record<string, string>>,
  right: Readonly<Record<string, string>>,
) {
  const leftKeys = Object.keys(left);
  if (leftKeys.length !== Object.keys(right).length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

/** Reads now, then every interval after the previous read finished, until stopped. */
export function startActivityPoller(ports: ActivityPorts): ActivityPoller {
  let stopped = false;
  let cancel: (() => void) | null = null;
  let previous: Readonly<Record<string, string>> = {};

  async function readOne(agentId: string, next: Record<string, string>): Promise<void> {
    try {
      const line = describeActivity(await ports.tail(agentId));
      if (line !== null) next[agentId] = line;
    } catch (error) {
      ports.log(`[office] activity of ${agentId}: ${errorMessage(error)}`);
      const kept = previous[agentId];
      if (kept !== undefined) next[agentId] = kept;
    }
  }

  async function tick(): Promise<void> {
    const next: Record<string, string> = {};
    for (const agentId of ports.running()) {
      if (stopped) return;
      await readOne(agentId, next);
    }
    if (stopped || sameLines(previous, next)) return;
    previous = next;
    ports.onChange(next);
  }

  async function run(): Promise<void> {
    try {
      await tick();
    } catch (error) {
      ports.log(`[office] activity failed: ${errorMessage(error)}`);
    }
    if (!stopped) cancel = ports.timers.setTimeout(() => void run(), ACTIVITY_INTERVAL_MS);
  }

  void run();
  return {
    stop() {
      stopped = true;
      cancel?.();
      cancel = null;
    },
  };
}
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/fake-clock.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/activity.test.ts --bail=1
```

Expected: PASS, 2 tests and 6 tests.

- [ ] **Step 5: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/server/timers.ts plugins/office/server/fake-clock.ts plugins/office/server/fake-clock.test.ts plugins/office/server/activity.ts plugins/office/server/activity.test.ts
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/server/timers.ts plugins/office/server/fake-clock.ts plugins/office/server/fake-clock.test.ts plugins/office/server/activity.ts plugins/office/server/activity.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/server/timers.ts plugins/office/server/fake-clock.ts plugins/office/server/fake-clock.test.ts plugins/office/server/activity.ts plugins/office/server/activity.test.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office timers and doing-now line" -- plugins/office/server/timers.ts plugins/office/server/fake-clock.ts plugins/office/server/fake-clock.test.ts plugins/office/server/activity.ts plugins/office/server/activity.test.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 6: The hub and the `office.state` subscription

Tier: most capable.

**Files:**

- Create: `plugins/office/server/hub.ts`
- Test: `plugins/office/server/hub.test.ts`
- Create: `plugins/office/server/paseo-holder.ts`
- Create: `plugins/office/server/paseo-directory.ts`
- Create: `plugins/office/server/live-ports.ts`
- Modify: `plugins/office/index.server.ts` (whole file below)

**Interfaces:**

- Consumes: Task 3 contract types and `officeStateSubscription`; Task 4 `agentsFromSnapshot`, `applyAgentUpdate`, `workspacesFromSnapshot`, `applyWorkspaceUpdate`, `sortAgents`, `sortWorkspaces`; Task 5 `Timers`, `nodeTimers`, `createFakeClock`, `settle`, `startActivityPoller`, `ACTIVITY_TAIL_LIMIT`.
- Produces:
  - `DIRECTORY_FLUSH_MS = 300`
  - `interface DirectoryView { agents: readonly OfficeAgent[]; workspaces: readonly OfficeWorkspace[] }`
  - `interface HubSubscriber { push(event: OfficeEvent): Promise<void>; signal: AbortSignal }`
  - `interface HubPorts { openDirectory(onChange: (view: DirectoryView) => void): Promise<() => Promise<void>>; startActivity(running: () => readonly string[], onChange: (activity: Readonly<Record<string, string>>) => void): () => void; timers: Timers; log(message: string): void }`
  - `interface Hub { attach(subscriber: HubSubscriber): Promise<void>; setBoards(boards: Readonly<Record<string, readonly Post[]>>): void; setBoard(board: string, posts: readonly Post[]): void; removeBoard(board: string): void; setWake(wake: WakeState): void; stop(): Promise<void> }`, `createHub(ports: HubPorts): Hub`
  - `type Paseo = PluginHandlerContext["paseo"]`, `interface PaseoHolder { remember(paseo: Paseo): void; require(): Paseo }`, `createPaseoHolder(): PaseoHolder`
  - `openPaseoDirectory(paseo: Paseo, onChange: (view: DirectoryView) => void, log: (message: string) => void): Promise<() => Promise<void>>`
  - `liveHubPorts(holder: PaseoHolder, timers: Timers, log: (message: string) => void): HubPorts`

The hub owns everything the subscription shows. The directory and the activity poller run only while at least one subscriber is attached (spec: activity "runs only while an office subscription is open"). `attach` resolves when the subscriber's signal aborts, because a settled handler promise closes the subscription (Decision list, item 9 of the code notes).

- [ ] **Step 1: Write the failing test**

`plugins/office/server/hub.test.ts`:

```ts
import { expect, test } from "vitest";
import type { OfficeAgent, OfficeEvent, Post } from "../shared/contracts.js";
import { createFakeClock, settle, type FakeClock } from "./fake-clock.js";
import {
  DIRECTORY_FLUSH_MS,
  createHub,
  type DirectoryView,
  type Hub,
  type HubPorts,
} from "./hub.js";

function agent(id: string, status: OfficeAgent["status"]): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status,
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
  };
}

function note(id: string): Post {
  return {
    id,
    seq: 1,
    board: "lobby",
    kind: "note",
    text: "hello",
    author: "user",
    createdAt: "2026-11-11T08:00:00.000Z",
    updatedAt: "2026-11-11T08:00:00.000Z",
  };
}

interface FakeDirectory {
  opens: number;
  stops: number;
  failure: Error | null;
  emit(view: DirectoryView): void;
}

interface FakeActivity {
  starts: number;
  stops: number;
  running(): readonly string[];
  emit(activity: Readonly<Record<string, string>>): void;
}

interface Harness {
  hub: Hub;
  clock: FakeClock;
  directory: FakeDirectory;
  activity: FakeActivity;
}

function startHarness(initial: DirectoryView): Harness {
  const clock = createFakeClock();
  let directoryListener: ((view: DirectoryView) => void) | null = null;
  let activityListener: ((activity: Readonly<Record<string, string>>) => void) | null = null;
  let runningList: () => readonly string[] = () => [];
  const directory: FakeDirectory = {
    opens: 0,
    stops: 0,
    failure: null,
    emit: (view) => directoryListener?.(view),
  };
  const activity: FakeActivity = {
    starts: 0,
    stops: 0,
    running: () => runningList(),
    emit: (next) => activityListener?.(next),
  };
  const ports: HubPorts = {
    async openDirectory(listener) {
      directory.opens += 1;
      if (directory.failure) throw directory.failure;
      directoryListener = listener;
      listener(initial);
      return async () => {
        directory.stops += 1;
        directoryListener = null;
      };
    },
    startActivity(running, listener) {
      activity.starts += 1;
      runningList = running;
      activityListener = listener;
      return () => {
        activity.stops += 1;
        activityListener = null;
      };
    },
    timers: clock,
    log: () => undefined,
  };
  return { hub: createHub(ports), clock, directory, activity };
}

interface Subscriber {
  events: OfficeEvent[];
  controller: AbortController;
  done: Promise<void>;
}

function subscribe(hub: Hub): Subscriber {
  const events: OfficeEvent[] = [];
  const controller = new AbortController();
  const done = hub.attach({
    signal: controller.signal,
    push: async (event) => {
      events.push(event);
    },
  });
  return { events, controller, done };
}

const EMPTY_WAKE = { paused: false, queued: {} };

test("the first subscriber opens the directory and gets a snapshot; a second shares it", async () => {
  const harness = startHarness({ agents: [agent("a", "idle")], workspaces: [] });
  const first = subscribe(harness.hub);
  await settle();
  const snapshot: OfficeEvent = {
    type: "snapshot",
    state: {
      agents: [agent("a", "idle")],
      workspaces: [],
      activity: {},
      boards: {},
      wake: EMPTY_WAKE,
    },
  };
  expect(first.events).toEqual([snapshot]);

  const second = subscribe(harness.hub);
  await settle();
  expect(second.events).toEqual([snapshot]);
  expect(harness.directory.opens).toBe(1);
  expect(harness.activity.starts).toBe(1);

  first.controller.abort();
  await first.done;
  expect(harness.directory.stops).toBe(0);
  second.controller.abort();
  await second.done;
  await settle();
  expect(harness.directory.stops).toBe(1);
  expect(harness.activity.stops).toBe(1);

  const third = subscribe(harness.hub);
  await settle();
  expect(harness.directory.opens).toBe(2);
  third.controller.abort();
  await third.done;
});

test("directory changes reach subscribers once per flush window, and only when they differ", async () => {
  const harness = startHarness({ agents: [agent("a", "idle")], workspaces: [] });
  const subscriber = subscribe(harness.hub);
  await settle();
  harness.directory.emit({ agents: [agent("a", "running")], workspaces: [] });
  harness.directory.emit({
    agents: [agent("a", "running"), agent("b", "idle")],
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
  });
  expect(subscriber.events).toHaveLength(1);

  harness.clock.advance(DIRECTORY_FLUSH_MS);
  expect(subscriber.events.slice(1)).toEqual([
    { type: "agents", agents: [agent("a", "running"), agent("b", "idle")] },
    { type: "workspaces", workspaces: [{ id: "w1", name: "main", projectName: "paseo" }] },
  ]);

  harness.directory.emit({
    agents: [agent("a", "running"), agent("b", "idle")],
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
  });
  harness.clock.advance(DIRECTORY_FLUSH_MS);
  expect(subscriber.events).toHaveLength(3);
  subscriber.controller.abort();
  await subscriber.done;
});

test("activity covers the running agents and is pushed as it changes", async () => {
  const harness = startHarness({
    agents: [agent("a", "running"), agent("b", "idle")],
    workspaces: [],
  });
  const subscriber = subscribe(harness.hub);
  await settle();
  expect(harness.activity.running()).toEqual(["a"]);
  harness.activity.emit({ a: "Thinking" });
  expect(subscriber.events.at(-1)).toEqual({ type: "activity", activity: { a: "Thinking" } });
  subscriber.controller.abort();
  await subscriber.done;
});

test("boards and wake state reach subscribers and the next snapshot", async () => {
  const harness = startHarness({ agents: [], workspaces: [] });
  const first = subscribe(harness.hub);
  await settle();
  harness.hub.setBoard("lobby", [note("p1")]);
  harness.hub.setWake({ paused: true, queued: { a: 2 } });
  harness.hub.removeBoard("w-gone");
  expect(first.events.slice(1)).toEqual([
    { type: "board", board: "lobby", posts: [note("p1")] },
    { type: "wake", wake: { paused: true, queued: { a: 2 } } },
  ]);
  harness.hub.setBoard("w1", [note("p2")]);
  harness.hub.removeBoard("w1");
  expect(first.events.at(-1)).toEqual({ type: "board-removed", board: "w1" });

  const second = subscribe(harness.hub);
  await settle();
  expect(second.events).toEqual([
    {
      type: "snapshot",
      state: {
        agents: [],
        workspaces: [],
        activity: {},
        boards: { lobby: [note("p1")] },
        wake: { paused: true, queued: { a: 2 } },
      },
    },
  ]);
  first.controller.abort();
  second.controller.abort();
  await Promise.all([first.done, second.done]);
});

test("a directory that cannot open refuses the subscriber, and the next one tries again", async () => {
  const harness = startHarness({ agents: [], workspaces: [] });
  harness.directory.failure = new Error("directory down");
  const refused = subscribe(harness.hub);
  await expect(refused.done).rejects.toThrow("directory down");
  expect(refused.events).toEqual([]);

  harness.directory.failure = null;
  const next = subscribe(harness.hub);
  await settle();
  expect(harness.directory.opens).toBe(2);
  expect(next.events).toHaveLength(1);
  next.controller.abort();
  await next.done;
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/hub.test.ts --bail=1`
Expected: FAIL, cannot resolve `./hub.js`.

- [ ] **Step 3: Write the hub**

`plugins/office/server/hub.ts`:

```ts
import type {
  OfficeAgent,
  OfficeEvent,
  OfficeSnapshot,
  OfficeWorkspace,
  Post,
  WakeState,
} from "../shared/contracts.js";
import { errorMessage } from "./errors.js";
import type { Timers } from "./timers.js";

/** Directory updates come in bursts while agents stream; one event per window is enough. */
export const DIRECTORY_FLUSH_MS = 300;

export interface DirectoryView {
  agents: readonly OfficeAgent[];
  workspaces: readonly OfficeWorkspace[];
}

export interface HubSubscriber {
  push(event: OfficeEvent): Promise<void>;
  signal: AbortSignal;
}

export interface HubPorts {
  /** Starts the directory; calls onChange with the first view before it resolves. */
  openDirectory(onChange: (view: DirectoryView) => void): Promise<() => Promise<void>>;
  startActivity(
    running: () => readonly string[],
    onChange: (activity: Readonly<Record<string, string>>) => void,
  ): () => void;
  timers: Timers;
  log(message: string): void;
}

export interface Hub {
  /** Streams the office to one subscriber. Resolves when its signal aborts; rejects when the directory cannot start. */
  attach(subscriber: HubSubscriber): Promise<void>;
  setBoards(boards: Readonly<Record<string, readonly Post[]>>): void;
  setBoard(board: string, posts: readonly Post[]): void;
  removeBoard(board: string): void;
  setWake(wake: WakeState): void;
  stop(): Promise<void>;
}

const EMPTY_VIEW: DirectoryView = { agents: [], workspaces: [] };

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    signal.addEventListener("abort", () => resolve(), { once: true });
  });
}

export function createHub(ports: HubPorts): Hub {
  const subscribers = new Set<HubSubscriber>();
  let view = EMPTY_VIEW;
  let sentAgents = "";
  let sentWorkspaces = "";
  let activity: Readonly<Record<string, string>> = {};
  let boards: Record<string, readonly Post[]> = {};
  let wake: WakeState = { paused: false, queued: {} };
  let starting: Promise<void> | null = null;
  let stopDirectory: (() => Promise<void>) | null = null;
  let stopActivity: (() => void) | null = null;
  let cancelFlush: (() => void) | null = null;

  function snapshot(): OfficeSnapshot {
    const copy: Record<string, Post[]> = {};
    for (const [board, posts] of Object.entries(boards)) copy[board] = [...posts];
    return {
      agents: [...view.agents],
      workspaces: [...view.workspaces],
      activity: { ...activity },
      boards: copy,
      wake: { paused: wake.paused, queued: { ...wake.queued } },
    };
  }

  function broadcast(event: OfficeEvent): void {
    for (const subscriber of subscribers) {
      if (subscriber.signal.aborted) continue;
      subscriber
        .push(event)
        .catch((error: unknown) => ports.log(`[office] push failed: ${errorMessage(error)}`));
    }
  }

  function flushDirectory(): void {
    cancelFlush = null;
    const agents = JSON.stringify(view.agents);
    if (agents !== sentAgents) {
      sentAgents = agents;
      broadcast({ type: "agents", agents: [...view.agents] });
    }
    const workspaces = JSON.stringify(view.workspaces);
    if (workspaces !== sentWorkspaces) {
      sentWorkspaces = workspaces;
      broadcast({ type: "workspaces", workspaces: [...view.workspaces] });
    }
  }

  function onDirectory(next: DirectoryView): void {
    view = next;
    // Until the start finished, the first snapshot carries the view.
    if (stopDirectory === null || cancelFlush !== null) return;
    cancelFlush = ports.timers.setTimeout(() => {
      try {
        flushDirectory();
      } catch (error) {
        ports.log(`[office] directory flush failed: ${errorMessage(error)}`);
      }
    }, DIRECTORY_FLUSH_MS);
  }

  function onActivity(next: Readonly<Record<string, string>>): void {
    activity = next;
    broadcast({ type: "activity", activity: { ...next } });
  }

  function running(): readonly string[] {
    return view.agents.filter((agent) => agent.status === "running").map((agent) => agent.id);
  }

  async function start(): Promise<void> {
    const stop = await ports.openDirectory(onDirectory);
    if (subscribers.size === 0) {
      view = EMPTY_VIEW;
      await stop();
      return;
    }
    stopDirectory = stop;
    sentAgents = JSON.stringify(view.agents);
    sentWorkspaces = JSON.stringify(view.workspaces);
    stopActivity = ports.startActivity(running, onActivity);
  }

  async function ensureStarted(): Promise<void> {
    if (stopDirectory !== null) return;
    starting ??= start().finally(() => {
      starting = null;
    });
    await starting;
  }

  async function idle(): Promise<void> {
    cancelFlush?.();
    cancelFlush = null;
    stopActivity?.();
    stopActivity = null;
    activity = {};
    const stop = stopDirectory;
    stopDirectory = null;
    view = EMPTY_VIEW;
    if (stop === null) return;
    try {
      await stop();
    } catch (error) {
      ports.log(`[office] directory stop failed: ${errorMessage(error)}`);
    }
  }

  return {
    async attach(subscriber) {
      if (subscriber.signal.aborted) return;
      subscribers.add(subscriber);
      subscriber.signal.addEventListener(
        "abort",
        () => {
          subscribers.delete(subscriber);
          if (subscribers.size === 0) void idle();
        },
        { once: true },
      );
      try {
        await ensureStarted();
      } catch (error) {
        subscribers.delete(subscriber);
        ports.log(`[office] unable to start: ${errorMessage(error)}`);
        throw error;
      }
      if (subscriber.signal.aborted) return;
      await subscriber.push({ type: "snapshot", state: snapshot() });
      await waitForAbort(subscriber.signal);
    },
    setBoards(next) {
      boards = { ...next };
      broadcast({ type: "snapshot", state: snapshot() });
    },
    setBoard(board, posts) {
      boards = { ...boards, [board]: [...posts] };
      broadcast({ type: "board", board, posts: [...posts] });
    },
    removeBoard(board) {
      if (!Object.hasOwn(boards, board)) return;
      boards = Object.fromEntries(Object.entries(boards).filter(([key]) => key !== board));
      broadcast({ type: "board-removed", board });
    },
    setWake(next) {
      wake = { paused: next.paused, queued: { ...next.queued } };
      broadcast({ type: "wake", wake: { paused: wake.paused, queued: { ...wake.queued } } });
    },
    async stop() {
      subscribers.clear();
      await idle();
    },
  };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/hub.test.ts --bail=1`
Expected: PASS, 5 tests.

- [ ] **Step 5: Write the paseo holder, the live directory and the live ports**

`plugins/office/server/paseo-holder.ts`:

```ts
import type { PluginHandlerContext } from "@getpaseo/plugin/server";

export type Paseo = PluginHandlerContext["paseo"];

/**
 * The plugin's one Paseo API object. PluginServerContext has none of its own; every handler,
 * hook and tool receives the same object (plugin-process.ts) and remembers it here, so timers
 * started by those calls can use it.
 */
export interface PaseoHolder {
  remember(paseo: Paseo): void;
  require(): Paseo;
}

export function createPaseoHolder(): PaseoHolder {
  let held: Paseo | null = null;
  return {
    remember(paseo) {
      held = paseo;
    },
    require() {
      if (held === null) throw new Error("The office has not received the Paseo API yet");
      return held;
    },
  };
}
```

`plugins/office/server/paseo-directory.ts`:

```ts
import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import {
  agentsFromSnapshot,
  applyAgentUpdate,
  applyWorkspaceUpdate,
  sortAgents,
  sortWorkspaces,
  workspacesFromSnapshot,
} from "./directory.js";
import { errorMessage } from "./errors.js";
import type { DirectoryView } from "./hub.js";
import type { Paseo } from "./paseo-holder.js";

// FetchAgentsRequestMessageSchema and FetchWorkspacesRequestMessageSchema cap a page at 200.
const PAGE_LIMIT = 200;

/**
 * Subscribed agent and workspace lists. Each subscription delivers its snapshot to a new observer
 * at once, then every update in order (packages/client/src/connection/owned.ts), and again after a
 * reconnect.
 */
export async function openPaseoDirectory(
  paseo: Paseo,
  onChange: (view: DirectoryView) => void,
  log: (message: string) => void,
): Promise<() => Promise<void>> {
  let agents = new Map<string, OfficeAgent>();
  let workspaces = new Map<string, OfficeWorkspace>();
  function emit(): void {
    try {
      onChange({
        agents: sortAgents(agents.values()),
        workspaces: sortWorkspaces(workspaces.values()),
      });
    } catch (error) {
      log(`[office] directory change failed: ${errorMessage(error)}`);
    }
  }
  const agentList = await paseo.agents.list({
    subscribe: {},
    filter: { statuses: ["initializing", "idle", "running", "error"] },
    page: { limit: PAGE_LIMIT },
  });
  const workspaceList = await paseo.workspaces
    .list({ subscribe: {}, page: { limit: PAGE_LIMIT } })
    .catch(async (error: unknown) => {
      await agentList.subscription.release();
      throw error;
    });
  const stopAgents = agentList.subscription.subscribe({
    snapshot: (snapshot) => {
      agents = agentsFromSnapshot(snapshot.entries.map((entry) => entry.agent));
      emit();
    },
    update: (message) => {
      if (message.type !== "agent_update") return;
      agents = applyAgentUpdate(agents, message.payload);
      emit();
    },
  });
  const stopWorkspaces = workspaceList.subscription.subscribe({
    snapshot: (snapshot) => {
      workspaces = workspacesFromSnapshot(snapshot.entries);
      emit();
    },
    update: (message) => {
      if (message.type !== "workspace_update") return;
      workspaces = applyWorkspaceUpdate(workspaces, message.payload);
      emit();
    },
  });
  return async () => {
    stopAgents();
    stopWorkspaces();
    await Promise.all([agentList.subscription.release(), workspaceList.subscription.release()]);
  };
}
```

If the typecheck says `paseo.workspaces.list` with `subscribe` has no non-optional `subscription`, read `PaseoWorkspaceActions.list` in `packages/client/src/index.ts`: its first overload takes `{ subscribe: {} }` and returns a non-optional `subscription`, like `agents.list`. Pass the options object inline so that overload is chosen.

`plugins/office/server/live-ports.ts`:

```ts
import { ACTIVITY_TAIL_LIMIT, startActivityPoller } from "./activity.js";
import type { HubPorts } from "./hub.js";
import { openPaseoDirectory } from "./paseo-directory.js";
import type { PaseoHolder } from "./paseo-holder.js";
import type { Timers } from "./timers.js";

/** Hub ports on the daemon's own API. The holder is set before the first attach. */
export function liveHubPorts(
  holder: PaseoHolder,
  timers: Timers,
  log: (message: string) => void,
): HubPorts {
  return {
    openDirectory: (onChange) => openPaseoDirectory(holder.require(), onChange, log),
    startActivity: (running, onChange) => {
      const paseo = holder.require();
      const poller = startActivityPoller({
        running,
        tail: async (agentId) => {
          const page = await paseo.agents
            .ref(agentId)
            .timeline.refetch({ direction: "tail", limit: ACTIVITY_TAIL_LIMIT });
          return page.entries.map((entry) => entry.item);
        },
        timers,
        log,
        onChange,
      });
      return () => poller.stop();
    },
    timers,
    log,
  };
}
```

`plugins/office/index.server.ts` (replace the whole file):

```ts
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { createHub } from "./server/hub.js";
import { liveHubPorts } from "./server/live-ports.js";
import { createPaseoHolder } from "./server/paseo-holder.js";
import { nodeTimers } from "./server/timers.js";
import { officeStateSubscription } from "./shared/contracts.js";

// Runs inside the daemon process: every handler, hook and timer catches its own errors.
export default function contribute(server: PluginServerContext): () => Promise<void> {
  const log = (message: string) => console.error(message);
  const holder = createPaseoHolder();
  const hub = createHub(liveHubPorts(holder, nodeTimers, log));
  // The handler's promise settles when the subscriber leaves (or the directory cannot start),
  // and settling closes the subscription; see Hub.attach.
  server.handle(officeStateSubscription, (_input, context) => {
    holder.remember(context.paseo);
    return hub.attach(context);
  });
  return () => hub.stop();
}
```

- [ ] **Step 6: Typecheck, lint, format, and the built-in compile test**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/index.server.ts plugins/office/server/hub.ts plugins/office/server/hub.test.ts plugins/office/server/paseo-holder.ts plugins/office/server/paseo-directory.ts plugins/office/server/live-ports.ts
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/index.server.ts plugins/office/server/hub.ts plugins/office/server/hub.test.ts plugins/office/server/paseo-holder.ts plugins/office/server/paseo-directory.ts plugins/office/server/live-ports.ts
cd packages/server && flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: each exits 0; the compile test passes.

- [ ] **Step 7: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/index.server.ts plugins/office/server/hub.ts plugins/office/server/hub.test.ts plugins/office/server/paseo-holder.ts plugins/office/server/paseo-directory.ts plugins/office/server/live-ports.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office hub and state subscription" -- plugins/office/index.server.ts plugins/office/server/hub.ts plugins/office/server/hub.test.ts plugins/office/server/paseo-holder.ts plugins/office/server/paseo-directory.ts plugins/office/server/live-ports.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 7: The office model and the state reducer (pure)

Tier: standard.

**Files:**

- Create: `plugins/office/client/office-state.ts`
- Test: `plugins/office/client/office-state.test.ts`
- Create: `plugins/office/client/model.ts`
- Test: `plugins/office/client/model.test.ts`

**Interfaces:**

- Consumes: Task 3 `LOBBY`, `OfficeAgent`, `OfficeEvent`, `OfficeSnapshot`, `Post`.
- Produces:
  - `EMPTY_OFFICE: OfficeSnapshot`, `applyOfficeEvent(state: OfficeSnapshot, event: OfficeEvent): OfficeSnapshot`
  - `LOBBY_NAME = "Lobby"`
  - `interface OfficeRow { agent: OfficeAgent; depth: 0 | 1; activity: string | null }`
  - `interface OfficeRoom { id: string; name: string; subtitle: string | null; lobby: boolean; rows: OfficeRow[]; posts: Post[] }`
  - `type AttentionReason = "permission" | "error"`, `interface AttentionEntry { agentId: string; roomId: string; title: string; reason: AttentionReason }`
  - `interface OfficeModel { rooms: OfficeRoom[]; attention: AttentionEntry[]; agents: ReadonlyMap<string, OfficeAgent>; roomOfAgent: ReadonlyMap<string, string> }`
  - `type DotTone = "running" | "idle" | "starting" | "warning" | "danger"`
  - `agentTitle(agent: OfficeAgent): string`, `agentMeta(agent: OfficeAgent): string`, `dotTone(agent: OfficeAgent): DotTone`, `attentionReason(agent: OfficeAgent): AttentionReason | null`, `answerableInOffice(kind: string): boolean` (a `PermissionKind` is a string)
  - `buildOfficeModel(state: OfficeSnapshot): OfficeModel`
  - `orderRoomsForFocus(rooms: readonly OfficeRoom[], focusRoomId: string | null): OfficeRoom[]`

Rules: the lobby is the first room and holds every agent without a workspace or whose workspace the office does not know. Each workspace is a room, in the server's order. In a room, agents are ordered by creation time; an agent whose parent is in the same room follows its parent, indented one level (deeper descendants stay at one level); a parent chain that loops is shown flat. "Doing now" shows only for running agents. The attention list holds agents with a pending permission, then agents in error, each group by title. A room's posts leave out done tasks and are ordered by creation time, then seq.

- [ ] **Step 1: Write the failing tests**

`plugins/office/client/office-state.test.ts`:

```ts
import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot, Post } from "../shared/contracts.js";
import { EMPTY_OFFICE, applyOfficeEvent } from "./office-state.js";

function agent(id: string): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: null,
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
  };
}

function note(id: string, board: string): Post {
  return {
    id,
    seq: 1,
    board,
    kind: "note",
    text: "hi",
    author: "user",
    createdAt: "2026-11-11T08:00:00.000Z",
    updatedAt: "2026-11-11T08:00:00.000Z",
  };
}

test("a snapshot replaces the state and each change replaces its part", () => {
  const snapshot: OfficeSnapshot = {
    ...EMPTY_OFFICE,
    agents: [agent("a")],
    boards: { lobby: [note("p1", "lobby")], w1: [note("p2", "w1")] },
  };
  let state = applyOfficeEvent(EMPTY_OFFICE, { type: "snapshot", state: snapshot });
  expect(state).toEqual(snapshot);

  state = applyOfficeEvent(state, { type: "agents", agents: [agent("b")] });
  state = applyOfficeEvent(state, {
    type: "workspaces",
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
  });
  state = applyOfficeEvent(state, { type: "activity", activity: { b: "Thinking" } });
  state = applyOfficeEvent(state, { type: "board", board: "lobby", posts: [] });
  state = applyOfficeEvent(state, { type: "board-removed", board: "w1" });
  state = applyOfficeEvent(state, { type: "wake", wake: { paused: true, queued: { b: 1 } } });

  expect(state).toEqual({
    agents: [agent("b")],
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
    activity: { b: "Thinking" },
    boards: { lobby: [] },
    wake: { paused: true, queued: { b: 1 } },
  });
});
```

`plugins/office/client/model.test.ts`:

```ts
import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot, Post } from "../shared/contracts.js";
import {
  agentMeta,
  agentTitle,
  answerableInOffice,
  buildOfficeModel,
  dotTone,
  orderRoomsForFocus,
} from "./model.js";

function agent(id: string, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id.toUpperCase(),
    provider: "claude",
    model: "opus",
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
    ...overrides,
  };
}

function snapshot(overrides: Partial<OfficeSnapshot>): OfficeSnapshot {
  return {
    agents: [],
    workspaces: [
      { id: "w1", name: "main", projectName: "paseo" },
      { id: "w2", name: "docs", projectName: "site" },
    ],
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
    ...overrides,
  };
}

function post(id: string, overrides: Partial<Post>): Post {
  return {
    id,
    seq: 1,
    board: "w1",
    kind: "task",
    text: id,
    author: "user",
    state: "open",
    createdAt: "2026-11-11T08:00:00.000Z",
    updatedAt: "2026-11-11T08:00:00.000Z",
    ...overrides,
  };
}

function rowIds(model: ReturnType<typeof buildOfficeModel>, roomId: string): string[] {
  const room = model.rooms.find((candidate) => candidate.id === roomId);
  return room ? room.rows.map((row) => `${row.agent.id}:${row.depth}`) : [];
}

test("the lobby comes first and holds agents without a known workspace", () => {
  const model = buildOfficeModel(
    snapshot({
      agents: [
        agent("a", { workspaceId: null }),
        agent("b", { workspaceId: "w-unknown" }),
        agent("c", { workspaceId: "w2" }),
      ],
    }),
  );
  expect(model.rooms.map((room) => [room.id, room.name, room.subtitle, room.lobby])).toEqual([
    ["lobby", "Lobby", null, true],
    ["w1", "main", "paseo", false],
    ["w2", "docs", "site", false],
  ]);
  expect(rowIds(model, "lobby")).toEqual(["a:0", "b:0"]);
  expect(rowIds(model, "w2")).toEqual(["c:0"]);
  expect(model.roomOfAgent.get("b")).toBe("lobby");
});

test("children follow their parent, one level in; a parent elsewhere or a loop shows flat", () => {
  const model = buildOfficeModel(
    snapshot({
      agents: [
        agent("p", { createdAt: "2026-11-11T08:00:00.000Z" }),
        agent("q", { createdAt: "2026-11-11T08:01:00.000Z" }),
        agent("c1", { parentAgentId: "p", createdAt: "2026-11-11T08:02:00.000Z" }),
        agent("g1", { parentAgentId: "c1", createdAt: "2026-11-11T08:03:00.000Z" }),
        agent("x", { parentAgentId: "elsewhere", createdAt: "2026-11-11T08:04:00.000Z" }),
        agent("l1", { parentAgentId: "l2", createdAt: "2026-11-11T08:05:00.000Z" }),
        agent("l2", { parentAgentId: "l1", createdAt: "2026-11-11T08:06:00.000Z" }),
      ],
    }),
  );
  expect(rowIds(model, "w1")).toEqual(["p:0", "c1:1", "g1:1", "q:0", "x:0", "l1:0", "l2:1"]);
});

test("doing now shows for running agents only; closed agents are left out", () => {
  const model = buildOfficeModel(
    snapshot({
      agents: [agent("r", { status: "running" }), agent("i"), agent("z", { status: "closed" })],
      activity: { r: "Running Bash", i: "Thinking" },
    }),
  );
  const room = model.rooms[1];
  expect(room?.rows.map((row) => [row.agent.id, row.activity])).toEqual([
    ["i", null],
    ["r", "Running Bash"],
  ]);
  expect(model.agents.has("z")).toBe(false);
});

test("the attention list puts permissions before errors, each by title", () => {
  const permission = { id: "r1", kind: "tool" as const, title: "Run tests" };
  const model = buildOfficeModel(
    snapshot({
      agents: [
        agent("e", { status: "error", title: "Alpha" }),
        agent("p2", { status: "running", title: "Zed", permissions: [permission] }),
        agent("p1", {
          status: "running",
          title: "Beta",
          permissions: [permission],
          workspaceId: null,
        }),
      ],
    }),
  );
  expect(model.attention).toEqual([
    { agentId: "p1", roomId: "lobby", title: "Beta", reason: "permission" },
    { agentId: "p2", roomId: "w1", title: "Zed", reason: "permission" },
    { agentId: "e", roomId: "w1", title: "Alpha", reason: "error" },
  ]);
});

test("a room shows open and claimed tasks and notes, not done tasks or unknown boards", () => {
  const model = buildOfficeModel(
    snapshot({
      boards: {
        w1: [
          post("p3", {
            seq: 3,
            kind: "note",
            state: undefined,
            createdAt: "2026-11-11T08:03:00.000Z",
          }),
          post("p1", { seq: 1, state: "claimed", claimedBy: "a" }),
          post("p2", { seq: 2, state: "done" }),
        ],
        w9: [post("p9", { board: "w9" })],
      },
    }),
  );
  expect(model.rooms[1]?.posts.map((item) => item.id)).toEqual(["p1", "p3"]);
  expect(model.rooms.some((room) => room.id === "w9")).toBe(false);
});

test("titles, meta, dots and answerable kinds", () => {
  expect(agentTitle(agent("abcdef0123", { title: null }))).toBe("Agent abcdef01");
  expect(agentTitle(agent("a", { title: "  " }))).toBe("Agent a");
  expect(agentMeta(agent("a"))).toBe("claude · opus");
  expect(agentMeta(agent("a", { model: null }))).toBe("claude");
  expect(dotTone(agent("a", { status: "running" }))).toBe("running");
  expect(dotTone(agent("a", { status: "initializing" }))).toBe("starting");
  expect(dotTone(agent("a", { status: "error" }))).toBe("danger");
  expect(
    dotTone(
      agent("a", { status: "running", permissions: [{ id: "r", kind: "tool", title: "t" }] }),
    ),
  ).toBe("warning");
  expect(dotTone(agent("a"))).toBe("idle");
  expect(
    ["tool", "mode", "other", "plan", "question"].map((kind) => answerableInOffice(kind)),
  ).toEqual([true, true, true, false, false]);
});

test("a workspace tab shows its own room first, then the lobby, then the rest", () => {
  const rooms = buildOfficeModel(snapshot({})).rooms;
  expect(orderRoomsForFocus(rooms, "w2").map((room) => room.id)).toEqual(["w2", "lobby", "w1"]);
  expect(orderRoomsForFocus(rooms, null).map((room) => room.id)).toEqual(["lobby", "w1", "w2"]);
  expect(orderRoomsForFocus(rooms, "w-missing").map((room) => room.id)).toEqual([
    "lobby",
    "w1",
    "w2",
  ]);
});
```

`answerableInOffice` takes any string, so the test can pass plain strings and callers pass a `PermissionKind`.

- [ ] **Step 2: Run them to see them fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/model.test.ts --bail=1`
Expected: FAIL, cannot resolve `./model.js`.

- [ ] **Step 3: Write the reducer and the model**

`plugins/office/client/office-state.ts`:

```ts
import type { OfficeEvent, OfficeSnapshot } from "../shared/contracts.js";

export const EMPTY_OFFICE: OfficeSnapshot = {
  agents: [],
  workspaces: [],
  activity: {},
  boards: {},
  wake: { paused: false, queued: {} },
};

export function applyOfficeEvent(state: OfficeSnapshot, event: OfficeEvent): OfficeSnapshot {
  switch (event.type) {
    case "snapshot":
      return event.state;
    case "agents":
      return { ...state, agents: event.agents };
    case "workspaces":
      return { ...state, workspaces: event.workspaces };
    case "activity":
      return { ...state, activity: event.activity };
    case "board":
      return { ...state, boards: { ...state.boards, [event.board]: event.posts } };
    case "board-removed":
      return {
        ...state,
        boards: Object.fromEntries(
          Object.entries(state.boards).filter(([board]) => board !== event.board),
        ),
      };
    case "wake":
      return { ...state, wake: event.wake };
  }
}
```

`plugins/office/client/model.ts`:

```ts
import { LOBBY, type OfficeAgent, type OfficeSnapshot, type Post } from "../shared/contracts.js";

export const LOBBY_NAME = "Lobby";

export interface OfficeRow {
  agent: OfficeAgent;
  /** 1 for an agent whose parent is in the same room. */
  depth: 0 | 1;
  /** The "doing now" line; running agents only. */
  activity: string | null;
}

export interface OfficeRoom {
  /** A workspace id, or "lobby". */
  id: string;
  name: string;
  /** The project name of a workspace room. */
  subtitle: string | null;
  lobby: boolean;
  rows: OfficeRow[];
  /** Open and claimed tasks and notes. */
  posts: Post[];
}

export type AttentionReason = "permission" | "error";

export interface AttentionEntry {
  agentId: string;
  roomId: string;
  title: string;
  reason: AttentionReason;
}

export interface OfficeModel {
  rooms: OfficeRoom[];
  attention: AttentionEntry[];
  agents: ReadonlyMap<string, OfficeAgent>;
  roomOfAgent: ReadonlyMap<string, string>;
}

export type DotTone = "running" | "idle" | "starting" | "warning" | "danger";

const ANSWERABLE_KINDS: readonly string[] = ["tool", "mode", "other"];

export function agentTitle(agent: OfficeAgent): string {
  const title = agent.title?.trim();
  return title ? title : `Agent ${agent.id.slice(0, 8)}`;
}

export function agentMeta(agent: OfficeAgent): string {
  return agent.model ? `${agent.provider} · ${agent.model}` : agent.provider;
}

export function attentionReason(agent: OfficeAgent): AttentionReason | null {
  if (agent.permissions.length > 0) return "permission";
  if (agent.status === "error") return "error";
  return null;
}

export function dotTone(agent: OfficeAgent): DotTone {
  const reason = attentionReason(agent);
  if (reason === "permission") return "warning";
  if (reason === "error") return "danger";
  if (agent.status === "running") return "running";
  if (agent.status === "initializing") return "starting";
  return "idle";
}

/** Approve and Deny answer these kinds; a plan or a question needs the session. */
export function answerableInOffice(kind: string): boolean {
  return ANSWERABLE_KINDS.includes(kind);
}

function byCreation(left: OfficeAgent, right: OfficeAgent): number {
  return left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id);
}

function orderRows(
  agents: readonly OfficeAgent[],
  activity: Readonly<Record<string, string>>,
): OfficeRow[] {
  const sorted = [...agents].sort(byCreation);
  const ids = new Set(sorted.map((agent) => agent.id));
  const children = new Map<string, OfficeAgent[]>();
  const roots: OfficeAgent[] = [];
  for (const agent of sorted) {
    const parent = agent.parentAgentId;
    if (parent !== null && parent !== agent.id && ids.has(parent)) {
      children.set(parent, [...(children.get(parent) ?? []), agent]);
    } else {
      roots.push(agent);
    }
  }
  const rows: OfficeRow[] = [];
  const seen = new Set<string>();
  function visit(agent: OfficeAgent, depth: 0 | 1): void {
    if (seen.has(agent.id)) return;
    seen.add(agent.id);
    const line = agent.status === "running" ? (activity[agent.id] ?? null) : null;
    rows.push({ agent, depth, activity: line });
    for (const child of children.get(agent.id) ?? []) visit(child, 1);
  }
  for (const root of roots) visit(root, 0);
  // A parent chain that loops has no root; show what is left from its oldest agent.
  for (const agent of sorted) visit(agent, 0);
  return rows;
}

function visiblePosts(posts: readonly Post[]): Post[] {
  return posts
    .filter((post) => !(post.kind === "task" && post.state === "done"))
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt) || left.seq - right.seq);
}

function attentionList(
  agents: Iterable<OfficeAgent>,
  roomOfAgent: ReadonlyMap<string, string>,
): AttentionEntry[] {
  const entries: AttentionEntry[] = [];
  for (const agent of agents) {
    const reason = attentionReason(agent);
    if (reason === null) continue;
    entries.push({
      agentId: agent.id,
      roomId: roomOfAgent.get(agent.id) ?? LOBBY,
      title: agentTitle(agent),
      reason,
    });
  }
  const rank = (reason: AttentionReason) => (reason === "permission" ? 0 : 1);
  return entries.sort(
    (left, right) =>
      rank(left.reason) - rank(right.reason) || left.title.localeCompare(right.title),
  );
}

export function buildOfficeModel(state: OfficeSnapshot): OfficeModel {
  const workspaceIds = new Set(state.workspaces.map((workspace) => workspace.id));
  const agents = new Map<string, OfficeAgent>();
  for (const agent of state.agents) if (agent.status !== "closed") agents.set(agent.id, agent);
  const byRoom = new Map<string, OfficeAgent[]>();
  const roomOfAgent = new Map<string, string>();
  for (const agent of agents.values()) {
    const known = agent.workspaceId !== null && workspaceIds.has(agent.workspaceId);
    const roomId = known && agent.workspaceId !== null ? agent.workspaceId : LOBBY;
    roomOfAgent.set(agent.id, roomId);
    byRoom.set(roomId, [...(byRoom.get(roomId) ?? []), agent]);
  }
  function room(id: string, name: string, subtitle: string | null, lobby: boolean): OfficeRoom {
    return {
      id,
      name,
      subtitle,
      lobby,
      rows: orderRows(byRoom.get(id) ?? [], state.activity),
      posts: visiblePosts(state.boards[id] ?? []),
    };
  }
  const rooms = [
    room(LOBBY, LOBBY_NAME, null, true),
    ...state.workspaces.map((workspace) =>
      room(workspace.id, workspace.name, workspace.projectName, false),
    ),
  ];
  return { rooms, attention: attentionList(agents.values(), roomOfAgent), agents, roomOfAgent };
}

/** A workspace tab shows its own room first, then the lobby, then the rest in order. */
export function orderRoomsForFocus(
  rooms: readonly OfficeRoom[],
  focusRoomId: string | null,
): OfficeRoom[] {
  const focus = rooms.find((candidate) => candidate.id === focusRoomId && !candidate.lobby);
  if (!focus) return [...rooms];
  return [focus, ...rooms.filter((candidate) => candidate !== focus)];
}
```

- [ ] **Step 4: Run the tests to see them pass**

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/office-state.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/model.test.ts --bail=1
```

Expected: PASS, 1 test and 7 tests.

- [ ] **Step 5: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/client/office-state.ts plugins/office/client/office-state.test.ts plugins/office/client/model.ts plugins/office/client/model.test.ts
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/client/office-state.ts plugins/office/client/office-state.test.ts plugins/office/client/model.ts plugins/office/client/model.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/client/office-state.ts plugins/office/client/office-state.test.ts plugins/office/client/model.ts plugins/office/client/model.test.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office model and state reducer" -- plugins/office/client/office-state.ts plugins/office/client/office-state.test.ts plugins/office/client/model.ts plugins/office/client/model.test.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 8: The surface in both places: structure view and agent card

Tier: most capable: Fable 5.2 (`claude-fable-5-2`). This task decides how the office looks.

UI wiring is thin and has no unit tests (Global Constraints, Tests); Task 9 polishes its presentation and Task 10 checks it by hand.

**Files:**

- Create: `plugins/office/client/styles.ts`
- Create: `plugins/office/client/use-office.ts`
- Create: `plugins/office/client/use-agent-actions.ts`
- Create: `plugins/office/client/action-button.tsx`
- Create: `plugins/office/client/permission-actions.tsx`
- Create: `plugins/office/client/attention-strip.tsx`
- Create: `plugins/office/client/structure-view.tsx`
- Create: `plugins/office/client/agent-card.tsx`
- Create: `plugins/office/client/office-surface.tsx`
- Create: `plugins/office/index.client.tsx`

**Interfaces:**

- Consumes: Task 2 `PaseoAgentHandle.cancel()`; Task 3 contracts; Task 7 `EMPTY_OFFICE`, `applyOfficeEvent`, `buildOfficeModel`, `orderRoomsForFocus`, `agentTitle`, `agentMeta`, `dotTone`, `answerableInOffice`, `OfficeRoom`, `OfficeRow`, `AttentionEntry`, `DotTone`; SDK `useSubscription`, `usePaseo`, `Modal`, `TextInput`, `ScrollView`, `SidebarRow`.
- Produces:
  - `interface OfficeStyles` (fields below), `useOfficeStyles(theme: PluginTheme, compact: boolean): OfficeStyles`
  - `interface OfficeState { state: OfficeSnapshot; loaded: boolean; subscription: PluginSubscriptionState }`, `useOffice(): OfficeState`
  - `interface AgentActions { send(agentId: string, text: string): Promise<void>; respond(agentId: string, requestId: string, allow: boolean): Promise<void>; cancel(agentId: string): Promise<void> }`, `useAgentActions(): AgentActions`
  - `ActionButton(props: { label: string; pendingLabel: string; onPress(): void | Promise<void>; styles: OfficeStyles; primary?: boolean; disabled?: boolean })`
  - `PermissionActions(props: { agentId: string; permission: OfficePermission; actions: AgentActions; styles: OfficeStyles })`
  - `AttentionStrip(props: { entries: readonly AttentionEntry[]; styles: OfficeStyles; onSelect(agentId: string): void })`, `reasonLabel(reason: AttentionReason): string`
  - `StructureView(props: { rooms: readonly OfficeRoom[]; styles: OfficeStyles; actions: AgentActions; onSelectAgent(agentId: string): void })`
  - `AgentCard(props: { agent: OfficeAgent | null; activity: string | null; actions: AgentActions; navigation: PluginScreenProps["navigation"]; styles: OfficeStyles; onClose(): void })`
  - `type OfficeSurfaceProps = PluginScreenProps | PluginWorkspacePanelProps`, `OfficeSurface(props: OfficeSurfaceProps)`
  - Contribution ids: screen `office`, sidebar header item `office`, workspace panel `office`, Command Center item `open-office`; icon `Building2` (a Lucide export, checked in `lucide-react-native`).

One component is registered in both places, as `plugin-examples/translations` does: `OfficeSurface` takes the union of screen and panel props (a function of the union is assignable to both registration types), and a panel's `workspaceId` makes its room come first.

- [ ] **Step 1: Write the styles**

`plugins/office/client/styles.ts`:

```ts
import { useMemo } from "react";
import type { TextStyle, ViewStyle } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import type { DotTone } from "./model.js";

export interface OfficeStyles {
  screen: ViewStyle;
  header: ViewStyle;
  headerRow: ViewStyle;
  headerControls: ViewStyle;
  control: ViewStyle;
  controlLabel: TextStyle;
  switchTrack: { false: string; true: string };
  switchThumb: string;
  placeholderColor: string;
  content: ViewStyle;
  muted: TextStyle;
  error: TextStyle;
  banner: ViewStyle;
  bannerText: TextStyle;
  strip: ViewStyle;
  stripItem: ViewStyle;
  stripTitle: TextStyle;
  stripReason: TextStyle;
  card: ViewStyle;
  cardHeader: ViewStyle;
  cardTitle: TextStyle;
  cardSubtitle: TextStyle;
  empty: TextStyle;
  row: ViewStyle;
  rowChild: ViewStyle;
  rowBody: ViewStyle;
  rowTitle: TextStyle;
  rowMeta: TextStyle;
  rowActivity: TextStyle;
  permission: ViewStyle;
  permissionTitle: TextStyle;
  actions: ViewStyle;
  dot: Record<DotTone, ViewStyle>;
  button: ViewStyle;
  buttonPrimary: ViewStyle;
  buttonDisabled: ViewStyle;
  buttonPrimaryDisabled: ViewStyle;
  buttonText: TextStyle;
  buttonPrimaryText: TextStyle;
  actionError: TextStyle;
  sheet: ViewStyle;
  sheetLabel: TextStyle;
  sheetText: TextStyle;
  input: TextStyle;
  boardSection: ViewStyle;
  boardTitleRow: ViewStyle;
  boardTitle: TextStyle;
  post: ViewStyle;
  postMeta: TextStyle;
  postText: TextStyle;
  chips: ViewStyle;
  chip: ViewStyle;
  chipSelected: ViewStyle;
  chipText: TextStyle;
  chipTextSelected: TextStyle;
  scene: ViewStyle;
  sceneStatus: TextStyle;
}

/** Surface styles from the host theme. Spacing follows docs/design.md section 7. */
export function useOfficeStyles(theme: PluginTheme, compact: boolean): OfficeStyles {
  return useMemo((): OfficeStyles => {
    const { colors } = theme;
    const pad = compact ? 12 : 16;
    const dot = (backgroundColor: string): ViewStyle => ({
      width: 8,
      height: 8,
      borderRadius: 4,
      marginTop: 6,
      backgroundColor,
    });
    const button: ViewStyle = {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: 6,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
    };
    const buttonPrimary: ViewStyle = {
      ...button,
      backgroundColor: colors.accent,
      borderColor: colors.accent,
    };
    const chip: ViewStyle = {
      paddingVertical: 4,
      paddingHorizontal: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
    };
    const row: ViewStyle = {
      flexDirection: "row",
      alignItems: "flex-start",
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: pad,
    };
    return {
      screen: { flex: 1, backgroundColor: colors.surface0 },
      header: { paddingHorizontal: pad, paddingTop: 8, gap: 8 },
      headerRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "flex-end",
        gap: 16,
      },
      headerControls: { flexDirection: "row", alignItems: "center", gap: 16, flexWrap: "wrap" },
      control: { flexDirection: "row", alignItems: "center", gap: 6 },
      controlLabel: { color: colors.foregroundMuted, fontSize: 13 },
      switchTrack: { false: colors.border, true: colors.accent },
      switchThumb: colors.surface0,
      placeholderColor: colors.foregroundMuted,
      content: { padding: pad, gap: 12 },
      muted: { color: colors.foregroundMuted, fontSize: 13 },
      error: { color: colors.statusDanger, fontSize: 13, padding: pad },
      banner: {
        marginHorizontal: pad,
        marginTop: 8,
        padding: 10,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        gap: 8,
      },
      bannerText: { color: colors.foreground, fontSize: 13 },
      strip: { gap: 8, paddingVertical: 4 },
      stripItem: {
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingVertical: 8,
        paddingHorizontal: 12,
        borderRadius: 8,
        borderWidth: 1,
        borderColor: colors.border,
        backgroundColor: colors.surface1,
        maxWidth: 260,
      },
      stripTitle: { color: colors.foreground, fontSize: 13, fontWeight: "500", flexShrink: 1 },
      stripReason: { color: colors.foregroundMuted, fontSize: 12 },
      card: {
        backgroundColor: colors.surface1,
        borderRadius: 12,
        borderWidth: 1,
        borderColor: colors.border,
        overflow: "hidden",
      },
      cardHeader: { paddingVertical: 12, paddingHorizontal: pad, gap: 2 },
      cardTitle: { color: colors.foreground, fontSize: 15, fontWeight: "600" },
      cardSubtitle: { color: colors.foregroundMuted, fontSize: 12 },
      empty: {
        color: colors.foregroundMuted,
        fontSize: 13,
        paddingHorizontal: pad,
        paddingBottom: 12,
      },
      row,
      rowChild: { ...row, paddingLeft: pad + 24 },
      rowBody: { flex: 1, gap: 2 },
      rowTitle: { color: colors.foreground, fontSize: 14, fontWeight: "500" },
      rowMeta: { color: colors.foregroundMuted, fontSize: 12 },
      rowActivity: { color: colors.foreground, fontSize: 12 },
      permission: { paddingHorizontal: pad, paddingBottom: 10, gap: 6 },
      permissionTitle: { color: colors.statusWarning, fontSize: 13 },
      actions: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
      dot: {
        running: dot(colors.accent),
        idle: dot(colors.foregroundMuted),
        starting: dot(colors.border),
        warning: dot(colors.statusWarning),
        danger: dot(colors.statusDanger),
      },
      button,
      buttonPrimary,
      buttonDisabled: { ...button, opacity: 0.5 },
      buttonPrimaryDisabled: { ...buttonPrimary, opacity: 0.5 },
      buttonText: { color: colors.foreground, fontSize: 13, fontWeight: "500" },
      buttonPrimaryText: { color: colors.accentForeground, fontSize: 13, fontWeight: "500" },
      actionError: { color: colors.statusDanger, fontSize: 12, marginTop: 4 },
      sheet: { gap: 12 },
      sheetLabel: { color: colors.foregroundMuted, fontSize: 12 },
      sheetText: { color: colors.foreground, fontSize: 13 },
      input: {
        minHeight: 72,
        borderWidth: 1,
        borderColor: colors.border,
        borderRadius: 8,
        padding: 10,
        color: colors.foreground,
        fontSize: 14,
        textAlignVertical: "top",
      },
      boardSection: {
        borderTopWidth: 1,
        borderTopColor: colors.border,
        paddingVertical: 10,
        paddingHorizontal: pad,
        gap: 8,
      },
      boardTitleRow: {
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
      },
      boardTitle: { color: colors.foregroundMuted, fontSize: 12, fontWeight: "600" },
      post: { gap: 4, paddingVertical: 6 },
      postMeta: { color: colors.foregroundMuted, fontSize: 12 },
      postText: { color: colors.foreground, fontSize: 13 },
      chips: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
      chip,
      chipSelected: {
        ...chip,
        backgroundColor: colors.surface2,
        borderColor: colors.foregroundMuted,
      },
      chipText: { color: colors.foregroundMuted, fontSize: 12 },
      chipTextSelected: { color: colors.foreground, fontSize: 12 },
      scene: { flex: 1, minHeight: 240 },
      sceneStatus: { color: colors.foregroundMuted, fontSize: 13, padding: pad },
    };
  }, [theme, compact]);
}
```

- [ ] **Step 2: Write the hooks and the small components**

`plugins/office/client/use-office.ts`:

```ts
import { useCallback, useState } from "react";
import { useSubscription, type PluginSubscriptionState } from "@getpaseo/plugin/client";
import {
  officeStateSubscription,
  type OfficeEvent,
  type OfficeSnapshot,
} from "../shared/contracts.js";
import { EMPTY_OFFICE, applyOfficeEvent } from "./office-state.js";

const NO_INPUT = {};

export interface OfficeState {
  state: OfficeSnapshot;
  /** True once the first snapshot arrived. */
  loaded: boolean;
  subscription: PluginSubscriptionState;
}

export function useOffice(): OfficeState {
  const [state, setState] = useState<OfficeSnapshot>(EMPTY_OFFICE);
  const [loaded, setLoaded] = useState(false);
  const onEvent = useCallback((event: OfficeEvent) => {
    setState((current) => applyOfficeEvent(current, event));
    if (event.type === "snapshot") setLoaded(true);
  }, []);
  const subscription = useSubscription(officeStateSubscription, NO_INPUT, onEvent);
  return { state, loaded, subscription };
}
```

`plugins/office/client/use-agent-actions.ts`:

```ts
import { useMemo } from "react";
import { usePaseo } from "@getpaseo/plugin/client";

export interface AgentActions {
  send(agentId: string, text: string): Promise<void>;
  respond(agentId: string, requestId: string, allow: boolean): Promise<void>;
  /** Stops the running turn (the SDK's cancel(), added for the office). */
  cancel(agentId: string): Promise<void>;
}

export function useAgentActions(): AgentActions {
  const paseo = usePaseo();
  return useMemo(
    (): AgentActions => ({
      send: (agentId, text) => paseo.agents.ref(agentId).send(text),
      respond: (agentId, requestId, allow) =>
        paseo.agents.ref(agentId).respondToPermission({
          requestId,
          response: allow ? { behavior: "allow" } : { behavior: "deny" },
        }),
      cancel: (agentId) => paseo.agents.ref(agentId).cancel(),
    }),
    [paseo],
  );
}
```

`plugins/office/client/action-button.tsx`:

```tsx
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, Text, View } from "react-native";
import type { OfficeStyles } from "./styles.js";

export interface ActionButtonProps {
  label: string;
  /** Shown while the action runs, e.g. "Sending...". */
  pendingLabel: string;
  onPress(): void | Promise<void>;
  styles: OfficeStyles;
  primary?: boolean;
  disabled?: boolean;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function buttonStyle(styles: OfficeStyles, primary: boolean, dim: boolean) {
  if (primary) return dim ? styles.buttonPrimaryDisabled : styles.buttonPrimary;
  return dim ? styles.buttonDisabled : styles.button;
}

/** A button that shows its own pending state and keeps its error in place (docs/testing.md). */
export function ActionButton({
  label,
  pendingLabel,
  onPress,
  styles,
  primary = false,
  disabled = false,
}: ActionButtonProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );
  const press = useCallback(() => {
    if (pending) return;
    setPending(true);
    setError(null);
    Promise.resolve()
      .then(() => onPress())
      .then(
        () => {
          if (mounted.current) setPending(false);
          return undefined;
        },
        (failure: unknown) => {
          if (!mounted.current) return;
          setPending(false);
          setError(messageOf(failure));
        },
      );
  }, [onPress, pending]);
  const dim = disabled || pending;
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        disabled={dim}
        onPress={press}
        style={buttonStyle(styles, primary, dim)}
      >
        <Text style={primary ? styles.buttonPrimaryText : styles.buttonText}>
          {pending ? pendingLabel : label}
        </Text>
      </Pressable>
      {error ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {error}
        </Text>
      ) : null}
    </View>
  );
}
```

`plugins/office/client/permission-actions.tsx`:

```tsx
import { useCallback } from "react";
import { Text, View } from "react-native";
import type { OfficePermission } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { answerableInOffice } from "./model.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

export interface PermissionActionsProps {
  agentId: string;
  permission: OfficePermission;
  actions: AgentActions;
  styles: OfficeStyles;
}

export function PermissionActions({
  agentId,
  permission,
  actions,
  styles,
}: PermissionActionsProps) {
  const approve = useCallback(
    () => actions.respond(agentId, permission.id, true),
    [actions, agentId, permission.id],
  );
  const deny = useCallback(
    () => actions.respond(agentId, permission.id, false),
    [actions, agentId, permission.id],
  );
  return (
    <View style={styles.permission}>
      <Text style={styles.permissionTitle} numberOfLines={2}>
        {permission.title}
      </Text>
      {answerableInOffice(permission.kind) ? (
        <View style={styles.actions}>
          <ActionButton
            label="Approve"
            pendingLabel="Approving..."
            onPress={approve}
            styles={styles}
            primary
          />
          <ActionButton label="Deny" pendingLabel="Denying..." onPress={deny} styles={styles} />
        </View>
      ) : (
        <Text style={styles.muted}>Answer in the session</Text>
      )}
    </View>
  );
}
```

`plugins/office/client/attention-strip.tsx`:

```tsx
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import type { AttentionEntry, AttentionReason } from "./model.js";
import type { OfficeStyles } from "./styles.js";

export function reasonLabel(reason: AttentionReason): string {
  return reason === "permission" ? "Needs permission" : "Error";
}

interface AttentionItemProps {
  entry: AttentionEntry;
  styles: OfficeStyles;
  onSelect(agentId: string): void;
}

function AttentionItem({ entry, styles, onSelect }: AttentionItemProps) {
  const press = useCallback(() => onSelect(entry.agentId), [entry.agentId, onSelect]);
  const reason = reasonLabel(entry.reason);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}: ${reason}`}
      onPress={press}
      style={styles.stripItem}
    >
      <View style={entry.reason === "permission" ? styles.dot.warning : styles.dot.danger} />
      <Text style={styles.stripTitle} numberOfLines={1}>
        {entry.title}
      </Text>
      <Text style={styles.stripReason}>{reason}</Text>
    </Pressable>
  );
}

export interface AttentionStripProps {
  entries: readonly AttentionEntry[];
  styles: OfficeStyles;
  onSelect(agentId: string): void;
}

/** The agents that need the user. On a phone this is the fast path. */
export function AttentionStrip({ entries, styles, onSelect }: AttentionStripProps) {
  if (entries.length === 0) return null;
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.strip}
    >
      {entries.map((entry) => (
        <AttentionItem key={entry.agentId} entry={entry} styles={styles} onSelect={onSelect} />
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 3: Write the structure view**

`plugins/office/client/structure-view.tsx`:

```tsx
import { useCallback } from "react";
import { Pressable, Text, View } from "react-native";
import { ScrollView } from "@getpaseo/plugin/client/ui";
import { agentMeta, agentTitle, dotTone, type OfficeRoom, type OfficeRow } from "./model.js";
import { PermissionActions } from "./permission-actions.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

interface AgentRowProps {
  row: OfficeRow;
  styles: OfficeStyles;
  actions: AgentActions;
  onSelect(agentId: string): void;
}

function AgentRow({ row, styles, actions, onSelect }: AgentRowProps) {
  const { agent } = row;
  const press = useCallback(() => onSelect(agent.id), [agent.id, onSelect]);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={agentTitle(agent)}
        onPress={press}
        style={row.depth === 1 ? styles.rowChild : styles.row}
      >
        <View style={styles.dot[dotTone(agent)]} />
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {agentTitle(agent)}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {agentMeta(agent)}
          </Text>
          {row.activity ? (
            <Text style={styles.rowActivity} numberOfLines={1}>
              {row.activity}
            </Text>
          ) : null}
        </View>
      </Pressable>
      {agent.permissions.map((permission) => (
        <PermissionActions
          key={permission.id}
          agentId={agent.id}
          permission={permission}
          actions={actions}
          styles={styles}
        />
      ))}
    </View>
  );
}

interface RoomCardProps {
  room: OfficeRoom;
  styles: OfficeStyles;
  actions: AgentActions;
  onSelectAgent(agentId: string): void;
}

function RoomCard({ room, styles, actions, onSelectAgent }: RoomCardProps) {
  return (
    <View style={styles.card}>
      <View style={styles.cardHeader}>
        <Text style={styles.cardTitle}>{room.name}</Text>
        {room.subtitle ? <Text style={styles.cardSubtitle}>{room.subtitle}</Text> : null}
      </View>
      {room.rows.length === 0 ? <Text style={styles.empty}>No agents</Text> : null}
      {room.rows.map((row) => (
        <AgentRow
          key={row.agent.id}
          row={row}
          styles={styles}
          actions={actions}
          onSelect={onSelectAgent}
        />
      ))}
    </View>
  );
}

export interface StructureViewProps {
  rooms: readonly OfficeRoom[];
  styles: OfficeStyles;
  actions: AgentActions;
  onSelectAgent(agentId: string): void;
}

/** The office as cards: one per room, the lobby first (or the tab's own room). */
export function StructureView({ rooms, styles, actions, onSelectAgent }: StructureViewProps) {
  return (
    <ScrollView contentContainerStyle={styles.content}>
      {rooms.map((room) => (
        <RoomCard
          key={room.id}
          room={room}
          styles={styles}
          actions={actions}
          onSelectAgent={onSelectAgent}
        />
      ))}
    </ScrollView>
  );
}
```

- [ ] **Step 4: Write the agent card**

`plugins/office/client/agent-card.tsx`:

```tsx
import { useCallback, useState } from "react";
import { Text, View } from "react-native";
import type { PluginScreenProps } from "@getpaseo/plugin/client";
import { Modal, TextInput } from "@getpaseo/plugin/client/ui";
import type { AgentStatus, OfficeAgent } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { agentMeta, agentTitle } from "./model.js";
import { PermissionActions } from "./permission-actions.js";
import type { OfficeStyles } from "./styles.js";
import type { AgentActions } from "./use-agent-actions.js";

type Navigation = PluginScreenProps["navigation"];

const STATUS_LABELS: Record<AgentStatus, string> = {
  initializing: "Starting",
  idle: "Idle",
  running: "Running",
  error: "Error",
  closed: "Closed",
};

interface AgentCardBodyProps {
  agent: OfficeAgent;
  activity: string | null;
  actions: AgentActions;
  navigation: Navigation;
  styles: OfficeStyles;
  onClose(): void;
}

function AgentCardBody({
  agent,
  activity,
  actions,
  navigation,
  styles,
  onClose,
}: AgentCardBodyProps) {
  const [text, setText] = useState("");
  const openSession = useCallback(() => {
    navigation?.openAgent({ agentId: agent.id });
    onClose();
  }, [navigation, agent.id, onClose]);
  const stop = useCallback(() => actions.cancel(agent.id), [actions, agent.id]);
  const send = useCallback(async () => {
    await actions.send(agent.id, text.trim());
    setText("");
  }, [actions, agent.id, text]);
  return (
    <View style={styles.sheet}>
      <Text style={styles.sheetText}>
        {agentMeta(agent)} · {STATUS_LABELS[agent.status]}
      </Text>
      {activity ? <Text style={styles.rowActivity}>{activity}</Text> : null}
      {agent.permissions.map((permission) => (
        <PermissionActions
          key={permission.id}
          agentId={agent.id}
          permission={permission}
          actions={actions}
          styles={styles}
        />
      ))}
      <View style={styles.actions}>
        {navigation ? (
          <ActionButton
            label="Open session"
            pendingLabel="Opening..."
            onPress={openSession}
            styles={styles}
          />
        ) : null}
        {agent.status === "running" ? (
          <ActionButton label="Stop" pendingLabel="Stopping..." onPress={stop} styles={styles} />
        ) : null}
      </View>
      <Text style={styles.sheetLabel}>Send a prompt</Text>
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder="Message"
        placeholderTextColor={styles.placeholderColor}
        multiline
        style={styles.input}
      />
      <ActionButton
        label="Send"
        pendingLabel="Sending..."
        onPress={send}
        disabled={text.trim().length === 0}
        styles={styles}
        primary
      />
    </View>
  );
}

export interface AgentCardProps {
  agent: OfficeAgent | null;
  activity: string | null;
  actions: AgentActions;
  navigation: Navigation;
  styles: OfficeStyles;
  onClose(): void;
}

/** Open session, send a prompt, answer a permission, stop the running turn. */
export function AgentCard({
  agent,
  activity,
  actions,
  navigation,
  styles,
  onClose,
}: AgentCardProps) {
  const change = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  return (
    <Modal title={agent ? agentTitle(agent) : "Agent"} open={agent !== null} onOpenChange={change}>
      <Modal.Content>
        {agent ? (
          <AgentCardBody
            agent={agent}
            activity={activity}
            actions={actions}
            navigation={navigation}
            styles={styles}
            onClose={onClose}
          />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
```

- [ ] **Step 5: Write the surface and the client entry**

`plugins/office/client/office-surface.tsx`:

```tsx
import { useCallback, useMemo, useState } from "react";
import { Text, View } from "react-native";
import type { PluginScreenProps, PluginWorkspacePanelProps } from "@getpaseo/plugin/client";
import { AgentCard } from "./agent-card.js";
import { AttentionStrip } from "./attention-strip.js";
import { buildOfficeModel, orderRoomsForFocus, type OfficeRoom } from "./model.js";
import { StructureView } from "./structure-view.js";
import { useOfficeStyles, type OfficeStyles } from "./styles.js";
import { useAgentActions, type AgentActions } from "./use-agent-actions.js";
import { useOffice, type OfficeState } from "./use-office.js";

export type OfficeSurfaceProps = PluginScreenProps | PluginWorkspacePanelProps;

interface SurfaceBodyProps {
  office: OfficeState;
  rooms: readonly OfficeRoom[];
  styles: OfficeStyles;
  actions: AgentActions;
  onSelectAgent(agentId: string): void;
}

function SurfaceBody({ office, rooms, styles, actions, onSelectAgent }: SurfaceBodyProps) {
  if (office.subscription.status === "error") {
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        Unable to load the office: {office.subscription.error.message}
      </Text>
    );
  }
  if (!office.loaded) return <Text style={styles.sceneStatus}>Loading...</Text>;
  return (
    <StructureView rooms={rooms} styles={styles} actions={actions} onSelectAgent={onSelectAgent} />
  );
}

/** One surface for both places: the sidebar screen and a workspace tab. */
export function OfficeSurface(props: OfficeSurfaceProps) {
  const { theme, layout, navigation } = props;
  const focusRoomId = "workspaceId" in props ? props.workspaceId : null;
  const styles = useOfficeStyles(theme, layout.compact);
  const office = useOffice();
  const actions = useAgentActions();
  const model = useMemo(() => buildOfficeModel(office.state), [office.state]);
  const rooms = useMemo(
    () => orderRoomsForFocus(model.rooms, focusRoomId),
    [model.rooms, focusRoomId],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const closeCard = useCallback(() => setSelectedId(null), []);
  const selected = selectedId === null ? null : (model.agents.get(selectedId) ?? null);
  const selectedActivity = selectedId === null ? null : (office.state.activity[selectedId] ?? null);
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <AttentionStrip entries={model.attention} styles={styles} onSelect={setSelectedId} />
      </View>
      <SurfaceBody
        office={office}
        rooms={rooms}
        styles={styles}
        actions={actions}
        onSelectAgent={setSelectedId}
      />
      <AgentCard
        agent={selected}
        activity={selectedActivity}
        actions={actions}
        navigation={navigation}
        styles={styles}
        onClose={closeCard}
      />
    </View>
  );
}
```

`plugins/office/index.client.tsx`:

```tsx
import { useCallback } from "react";
import type { PluginClientContext, PluginSidebarItemProps } from "@getpaseo/plugin/client";
import { SidebarRow } from "@getpaseo/plugin/client/ui";
import { OfficeSurface } from "./client/office-surface.js";

const SCREEN_ID = "office";
const PANEL_ID = "office";
const ICON = "Building2";

function OfficeItem({ currentScreen, openScreen }: PluginSidebarItemProps) {
  const open = useCallback(() => openScreen({ screenId: SCREEN_ID }), [openScreen]);
  return <SidebarRow icon={ICON} active={currentScreen?.screenId === SCREEN_ID} onPress={open} />;
}

// A built-in has no row in Settings > Plugins: the sidebar item and the Command Center item are
// the ways in. Settings > Sidebar can hide the item.
export default function contribute(client: PluginClientContext) {
  const removers = [
    client.addScreen({ id: SCREEN_ID, title: "Office", Component: OfficeSurface }),
    client.addSidebarHeaderItem({ id: SCREEN_ID, title: "Office", Component: OfficeItem }),
    client.addWorkspacePanel({
      id: PANEL_ID,
      title: "Office",
      icon: ICON,
      Component: OfficeSurface,
    }),
    client.addCommandCenterItem({
      id: "open-office",
      title: "Open office",
      icon: ICON,
      context: "workspace",
      onSelect({ openPanel }) {
        openPanel(PANEL_ID);
      },
    }),
  ];
  return () => {
    for (const remove of removers) void remove();
  };
}
```

- [ ] **Step 6: Typecheck, lint, format, and the built-in compile test**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/index.client.tsx plugins/office/client
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/index.client.tsx plugins/office/client
cd packages/server && flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: each exits 0. If the typecheck says `cancel` does not exist on `PaseoAgentHandle`, run `npm run build:client` (Global Constraints, Build order) and typecheck again.

- [ ] **Step 7: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/index.client.tsx plugins/office/client/styles.ts plugins/office/client/use-office.ts plugins/office/client/use-agent-actions.ts plugins/office/client/action-button.tsx plugins/office/client/permission-actions.tsx plugins/office/client/attention-strip.tsx plugins/office/client/structure-view.tsx plugins/office/client/agent-card.tsx plugins/office/client/office-surface.tsx
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office structure view and agent card, as screen and workspace tab" -- plugins/office/index.client.tsx plugins/office/client/styles.ts plugins/office/client/use-office.ts plugins/office/client/use-agent-actions.ts plugins/office/client/action-button.tsx plugins/office/client/permission-actions.tsx plugins/office/client/attention-strip.tsx plugins/office/client/structure-view.tsx plugins/office/client/agent-card.tsx plugins/office/client/office-surface.tsx
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 9: Phase 1 design polish: structure view and agent card

Tier: most capable: Fable 5.2 (`claude-fable-5-2`). This task decides how the office looks.

Task 8 made the structure view and the card work; this task makes them look right on the owner's phone and tablet. It changes presentation only: spacing, type, colour through the theme tokens (`theme.colors.*` in `styles.ts`, no new hex values), motion, touch targets of at least 44 px, and the loading, empty and error states. It never changes behaviour or contracts: no change to props of exported components, hooks, RPCs, the model, ids, or what a button does.

**Files:**

- Modify (presentation only): `plugins/office/client/styles.ts`, `plugins/office/client/structure-view.tsx`, `plugins/office/client/agent-card.tsx`, `plugins/office/client/attention-strip.tsx`, `plugins/office/client/action-button.tsx`, `plugins/office/client/permission-actions.tsx`, `plugins/office/client/office-surface.tsx`
- Not touched: `shared/`, `server/`, `index.server.ts`, `index.client.tsx`, `client/model.ts`, `client/office-state.ts`, `client/use-*.ts`

**Interfaces:**

- Consumes: Task 8's components and `OfficeStyles`.
- Produces: the same exports with the same signatures. `OfficeStyles` may gain keys; none is removed or renamed without updating every use in the same commit.

- [ ] **Step 1: Load the design skills and the house rules**

Invoke, with the Skill tool, `antislop` (the core; its sub-skills say to load it with them), then `antislop-ui`, `antislop-layoutmobile` and `antislop-human`. `unslop` is loaded in Step 5. Read `docs/design.md` in full and `docs/unistyles.md`; the plugin has no Unistyles, so `docs/unistyles.md` applies through its token rules: every colour comes from `theme.colors` inside `useOfficeStyles`.

- [ ] **Step 2: Start the dev daemon and the web app**

```bash
ss -ltnp | grep -E ':(6768|8081) '
```

Expected: no output; otherwise stop and ask the controller. Then `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npm run build:server`, and start `npm run dev:server` and `npm run dev:app` as background commands. Never the daemon on 6767. Open `http://<container IP>:8081` in the Playwright browser (`hostname -I | awk '{print $1}'`). Use the agents that exist (`npm run cli -- ls -a -g`); before creating any, ask the controller, as in Task 10 Step 3.

- [ ] **Step 3: Take the before screenshots**

```bash
mkdir -p /workspace/utils/paseo/.superpowers/screenshots/agent-office/phase-1
```

At 390 x 844, then 820 x 1180, then 1440 x 900 (`browser_resize`), save with `browser_take_screenshot` into that folder:

- `before-structure-<width>.png`: the office screen with at least two rooms;
- `before-card-<width>.png`: the agent card of a running agent;
- `before-permission-390.png`: a row with Approve and Deny, if an agent is waiting on a permission;
- `before-dark-390.png`: the office screen in the dark theme (Settings > Appearance).

The folder is git-ignored; the owner reads the files there.

- [ ] **Step 4: Review against the rules, phone first**

List each finding in the task report as: what, where (file and style key), and the rule (a `docs/design.md` section or a skill rule). Check at least:

1. Touch targets: every `Pressable` (rows, strip entries, buttons) is at least 44 px tall at 390 px wide, measured with `browser_evaluate` on `getBoundingClientRect()`.
2. Contrast: `rowMeta`, `muted`, `stripReason`, `cardSubtitle` and button text against their real backgrounds (`surface1`, `surface0`, `accent`) in light and dark, with the `antislop-human` contrast checker; body text at least 4.5:1.
3. Rhythm and hierarchy (`docs/design.md` sections 3, 7, 12): row padding, gaps, title and meta sizes, room card header, the lobby card first.
4. Buttons and borders (sections 4, 5): primary only for the main action (Send, Approve), borders one weight.
5. States (section 11): "Loading...", the "No agents" empty room, the error line, a failed action's error under its button.
6. Copy (section 10): sentence case, "..." on in-flight labels, errors start "Unable to".
7. Phone layout (`antislop-layoutmobile`): no horizontal overflow at 390 px, the strip scrolls sideways, the card's input and buttons fit without the keyboard covering Send (check with a focused input).

- [ ] **Step 5: Apply the presentation changes, then a review pass**

Change only the files listed above, only in presentation. Where a finding would need a behaviour change, do not make it: list it in the report for the owner. Then invoke `unslop` and run its review pass over the same screens; fix what it finds within the same limits.

- [ ] **Step 6: Take the after screenshots**

The same set as Step 3, named `after-...`, in the same folder.

- [ ] **Step 7: Stop what you started**

Stop the dev app and the dev daemon you started. Do not delete `.dev/paseo-home`.

- [ ] **Step 8: Typecheck, lint, format, affected tests**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/client
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/client
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/model.test.ts --bail=1
cd packages/server && flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: each exits 0; `model.test.ts` passes unchanged (this task does not touch the model).

- [ ] **Step 9: Commit**

```bash
cd /workspace/utils/paseo
git status --short plugins/office
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/client/styles.ts plugins/office/client/structure-view.tsx plugins/office/client/agent-card.tsx plugins/office/client/attention-strip.tsx plugins/office/client/action-button.tsx plugins/office/client/permission-actions.tsx plugins/office/client/office-surface.tsx
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "style(fork): polish the office structure view and agent card" -- plugins/office/client/styles.ts plugins/office/client/structure-view.tsx plugins/office/client/agent-card.tsx plugins/office/client/attention-strip.tsx plugins/office/client/action-button.tsx plugins/office/client/permission-actions.tsx plugins/office/client/office-surface.tsx
git log -1 --format='%an <%ae> | %cn <%ce>'
```

`git status --short plugins/office` must show changes only in the listed files before the commit; anything else: undo it and report why it was needed. `git commit -- <paths>` commits only the listed files that changed.

The task report lists every change with its reason, the findings left for the owner, and the before and after screenshot paths.

---

### Task 10: Phase 1 checkpoint: hand test and docs

Tier: standard.

**Files:**

- Modify: `docs/plugins.md` (section "Built-in plugins": a new paragraph directly before the paragraph that starts "`scripts/builtin-plugins-dist.test.mjs` starts every built-in in process")

**Interfaces:**

- Consumes: everything from Tasks 1-9.
- Produces: evidence in the task report that Phase 1 works; the `office` paragraph that Tasks 20 and 29 rewrite.

- [ ] **Step 1: Write the docs paragraph**

Insert in `docs/plugins.md` before the paragraph that starts "`scripts/builtin-plugins-dist.test.mjs` starts every built-in in process":

```markdown
The `office` built-in shows every agent on the host in one place: an Office item in the sidebar
opens it as a screen, and "Open office" in the Command Center opens it as a workspace tab, which
lists that workspace's room first. Each workspace is a room, and the lobby holds agents without a
workspace. A row shows the agent's state, provider and model, and for a running agent a "doing
now" line taken from the newest timeline item's kind, never its text. Tapping a row opens a card
that opens the session, sends a prompt, answers a tool or mode permission, or stops the running
turn with the SDK's `cancel()`. The server keeps one directory from subscribed `agents.list` and
`workspaces.list` calls (the first 200 of each) and streams a compact projection over the
`office.state` subscription; the directory and the 5 s "doing now" reads run only while an office
surface is open. Design: [the spec](superpowers/specs/2026-11-11-agent-office-design.md).
```

- [ ] **Step 2: Start the dev daemon and the web app**

```bash
ss -ltnp | grep -E ':(6768|8081) '
```

Expected: no output. If something listens that you did not start, stop and ask the controller.

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npm run build:server
```

Then start `npm run dev:server` and `npm run dev:app` from `/workspace/utils/paseo`, each as a background command. Never the daemon on 6767. Open the web UI with the Playwright browser at `http://<container IP>:8081` (`hostname -I | awk '{print $1}'` gives the IP; the browser does not share this container's `localhost`).

- [ ] **Step 3: Make sure there are agents to look at**

Run: `cd /workspace/utils/paseo && npm run cli -- ls -a -g`
The test needs at least three agents across two workspaces, one with a child agent, and one that asks for a tool permission. Creating or prompting agents spends provider usage: before creating any, tell the controller how many agents and turns you need and wait for the owner's yes. On no, run the checks with the agents that exist and mark the rest not run.

- [ ] **Step 4: Run the checks in a phone-sized window, then a tablet-sized one**

`browser_resize` to 390 x 844, then repeat at 820 x 1180. Record pass or fail and one line of evidence for each:

1. The sidebar has an Office item; it opens the office screen with "Loading..." and then cards: Lobby first, then one card per workspace with its project name.
2. Each agent row shows a state dot, title, provider and model. A running agent shows a "doing now" line that changes as it works (within about 5 s).
3. A child agent is indented under its parent.
4. An agent waiting on a tool permission shows its request with Approve and Deny on the row, and an entry in the strip at the top. Approve answers it: the row's buttons and the strip entry go away.
5. Tapping a strip entry or a row opens the card. "Open session" opens that agent's chat and closes the card.
6. "Send" sends the prompt; the field clears; the agent starts running. A failed send keeps its error under the button.
7. "Stop" on a running agent stops its turn (the agent goes idle).
8. In a workspace, the Command Center (Cmd/Ctrl+K) item "Open office" opens the office as a tab, with that workspace's card first.
9. Switching to another workspace and back keeps the tab working; closing the office screen ends the subscription (the dev daemon's log shows no further timeline reads for "doing now" within 10 s).

- [ ] **Step 5: Stop what you started**

Stop the dev app and the dev daemon you started. Do not delete `.dev/paseo-home`.

- [ ] **Step 6: Format and commit the docs**

```bash
cd /workspace/utils/paseo
npm run format:files -- docs/plugins.md
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add docs/plugins.md
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "docs(fork): the office built-in" -- docs/plugins.md
git log -1 --format='%an <%ae> | %cn <%ce>'
```

**Phase 1 checkpoint:** the office opens from the sidebar and as a workspace tab, shows live agents by room with "doing now" lines and the attention strip, and its card opens a session, sends a prompt, answers a permission and stops a turn. No 3D yet; nothing else in the app changed except the SDK's new `cancel()`.

---

# Phase 2: the scene

The look, decided here so the scene tasks only transcribe it: a low-poly office seen from above at
about 50 degrees through an orthographic camera. Rooms are 12 x 11 floor tiles with low glass walls
(1.2 high, an opening in the front wall for the door), laid on a grid with the lobby in the middle
and the other rooms spiralling out from it. Each room has a whiteboard on its back wall and 12 desk
cells in 4 columns and 3 rows; a cell has a main seat and a side seat (for a child agent next to its
parent). A robot is a rounded body, a box head with a visor in its provider's colour, two arms and a
flat blob shadow; a small sphere above the head carries the amber or red state light. Colours come
from the app theme (light and dark), so the office matches the rest of the UI. Units are world
metres; the camera shows about 30 m of height at zoom 1.

### Task 11: Room grid and desk seats (pure)

Tier: most capable.

**Files:**

- Create: `plugins/office/client/layout.ts`
- Test: `plugins/office/client/layout.test.ts`

**Interfaces:**

- Consumes: Task 3 `LOBBY`; Task 7 `OfficeModel`, `OfficeRoom`, `OfficeRow`, `buildOfficeModel` (tests).
- Produces:
  - Constants: `DESKS_PER_ROOM = 24`, `CELL_COLUMNS = 4`, `CELL_ROWS = 3`, `CELL_SIZE = 2.5`, `ROOM_WIDTH = 12`, `ROOM_DEPTH = 11`, `ROOM_PITCH_X = 15`, `ROOM_PITCH_Z = 14`, `WALL_HEIGHT = 1.2`, `DOOR_WIDTH = 2`.
  - `interface Point { x: number; z: number }`, `interface GridCell { gx: number; gz: number }`, `interface Bounds { minX: number; maxX: number; minZ: number; maxZ: number }`
  - `interface SeatSlot extends Point { agentId: string; roomId: string; index: number; side: boolean }`
  - `interface RoomLayout { roomId: string; cell: GridCell; center: Point; seats: SeatSlot[]; overflow: number; board: Point; door: Point; label: Point }`
  - `interface OfficeLayout { rooms: RoomLayout[]; roomById: ReadonlyMap<string, RoomLayout>; seatOf: ReadonlyMap<string, SeatSlot>; bounds: Bounds }`
  - `interface LayoutMemory { roomCells: ReadonlyMap<string, GridCell>; seats: ReadonlyMap<string, ReadonlyMap<string, number>> }`, `EMPTY_LAYOUT_MEMORY: LayoutMemory`
  - `spiralCells(count: number): GridCell[]`, `seatPosition(center: Point, index: number): Point`
  - `layoutOffice(model: OfficeModel, memory: LayoutMemory): { layout: OfficeLayout; memory: LayoutMemory }`

Stability rules: the lobby is always cell (0, 0). A room keeps the cell it had in `memory`; a new room takes the first free cell in spiral order (ring by ring outward, each ring by angle from east). An agent keeps the seat it had; a new agent whose parent sits at a main seat takes the side seat next to it when free, otherwise the lowest free main seat, otherwise the lowest free side seat; with all 24 taken it counts toward "+N". Nothing moves when another agent or room appears or leaves.

- [ ] **Step 1: Write the failing test**

`plugins/office/client/layout.test.ts`:

```ts
import { expect, test } from "vitest";
import type { OfficeAgent, OfficeSnapshot } from "../shared/contracts.js";
import {
  DESKS_PER_ROOM,
  EMPTY_LAYOUT_MEMORY,
  ROOM_DEPTH,
  ROOM_PITCH_X,
  ROOM_PITCH_Z,
  ROOM_WIDTH,
  layoutOffice,
  seatPosition,
  spiralCells,
  type LayoutMemory,
} from "./layout.js";
import { buildOfficeModel } from "./model.js";

function agent(id: string, minute: number, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-11T08:${String(minute).padStart(2, "0")}:00.000Z`,
    ...overrides,
  };
}

function snapshot(workspaceIds: readonly string[], agents: readonly OfficeAgent[]): OfficeSnapshot {
  return {
    agents: [...agents],
    workspaces: workspaceIds.map((id) => ({ id, name: id, projectName: "p" })),
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
}

function run(state: OfficeSnapshot, memory: LayoutMemory = EMPTY_LAYOUT_MEMORY) {
  return layoutOffice(buildOfficeModel(state), memory);
}

test("spiral cells go ring by ring, each ring by angle from east", () => {
  expect(spiralCells(9)).toEqual([
    { gx: 0, gz: 0 },
    { gx: 1, gz: 0 },
    { gx: 1, gz: 1 },
    { gx: 0, gz: 1 },
    { gx: -1, gz: 1 },
    { gx: -1, gz: 0 },
    { gx: -1, gz: -1 },
    { gx: 0, gz: -1 },
    { gx: 1, gz: -1 },
  ]);
});

test("the lobby sits in the middle and rooms spiral out from it", () => {
  const { layout } = run(snapshot(["w1", "w2"], []));
  expect(layout.rooms.map((room) => [room.roomId, room.center])).toEqual([
    ["lobby", { x: 0, z: 0 }],
    ["w1", { x: ROOM_PITCH_X, z: 0 }],
    ["w2", { x: ROOM_PITCH_X, z: ROOM_PITCH_Z }],
  ]);
  const lobby = layout.roomById.get("lobby");
  expect(lobby?.board).toEqual({ x: 0, z: -ROOM_DEPTH / 2 + 0.35 });
  expect(lobby?.door).toEqual({ x: 0, z: ROOM_DEPTH / 2 });
});

test("rooms keep their cells when another room is added or removed", () => {
  const first = run(snapshot(["w1", "w2"], []));
  const added = run(snapshot(["w0", "w1", "w2"], []), first.memory);
  expect(added.layout.roomById.get("w1")?.cell).toEqual({ gx: 1, gz: 0 });
  expect(added.layout.roomById.get("w2")?.cell).toEqual({ gx: 1, gz: 1 });
  expect(added.layout.roomById.get("w0")?.cell).toEqual({ gx: 0, gz: 1 });
  const removed = run(snapshot(["w0", "w2"], []), added.memory);
  expect(removed.layout.roomById.get("w2")?.cell).toEqual({ gx: 1, gz: 1 });
  expect(removed.layout.roomById.get("w0")?.cell).toEqual({ gx: 0, gz: 1 });
});

test("agents take main seats in order and a child sits beside its parent", () => {
  const { layout } = run(
    snapshot(["w1"], [agent("a", 0), agent("b", 1), agent("c", 2, { parentAgentId: "a" })]),
  );
  expect(["a", "c", "b"].map((id) => layout.seatOf.get(id)?.index)).toEqual([0, 1, 2]);
  expect(layout.seatOf.get("c")?.side).toBe(true);
  expect(layout.seatOf.get("c")?.roomId).toBe("w1");
});

test("an agent that starts later, or earlier in time, does not move anyone", () => {
  const first = run(snapshot(["w1"], [agent("b", 5), agent("c", 6)]));
  expect([first.layout.seatOf.get("b")?.index, first.layout.seatOf.get("c")?.index]).toEqual([
    0, 2,
  ]);
  const next = run(snapshot(["w1"], [agent("a", 1), agent("b", 5), agent("c", 6)]), first.memory);
  expect(["a", "b", "c"].map((id) => next.layout.seatOf.get(id)?.index)).toEqual([4, 0, 2]);
});

test("a freed seat is reused by the next new agent", () => {
  const first = run(snapshot(["w1"], [agent("a", 0), agent("b", 1)]));
  const next = run(snapshot(["w1"], [agent("b", 1), agent("d", 3)]), first.memory);
  expect([next.layout.seatOf.get("b")?.index, next.layout.seatOf.get("d")?.index]).toEqual([2, 0]);
});

test("24 desks per room; the rest count as overflow", () => {
  const agents = Array.from({ length: 30 }, (_, index) => agent(`a${index}`, index));
  const { layout } = run(snapshot(["w1"], agents));
  const room = layout.roomById.get("w1");
  expect(room?.seats).toHaveLength(DESKS_PER_ROOM);
  expect(room?.overflow).toBe(6);
  expect(layout.seatOf.has("a29")).toBe(false);
});

test("every seat lies inside its room, and the bounds hold every room", () => {
  for (let index = 0; index < DESKS_PER_ROOM; index += 1) {
    const seat = seatPosition({ x: 100, z: 50 }, index);
    expect(Math.abs(seat.x - 100)).toBeLessThan(ROOM_WIDTH / 2);
    expect(Math.abs(seat.z - 50)).toBeLessThan(ROOM_DEPTH / 2);
  }
  const { layout } = run(snapshot(["w1", "w2"], []));
  expect(layout.bounds).toEqual({
    minX: -ROOM_WIDTH / 2 - 2,
    maxX: ROOM_PITCH_X + ROOM_WIDTH / 2 + 2,
    minZ: -ROOM_DEPTH / 2 - 2,
    maxZ: ROOM_PITCH_Z + ROOM_DEPTH / 2 + 2,
  });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/layout.test.ts --bail=1`
Expected: FAIL, cannot resolve `./layout.js`.

- [ ] **Step 3: Write the layout**

`plugins/office/client/layout.ts`:

```ts
import { LOBBY } from "../shared/contracts.js";
import type { OfficeModel, OfficeRoom, OfficeRow } from "./model.js";

export const DESKS_PER_ROOM = 24;
export const CELL_COLUMNS = 4;
export const CELL_ROWS = 3;
export const CELL_SIZE = 2.5;
export const ROOM_WIDTH = 12;
export const ROOM_DEPTH = 11;
export const ROOM_PITCH_X = 15;
export const ROOM_PITCH_Z = 14;
export const WALL_HEIGHT = 1.2;
export const DOOR_WIDTH = 2;
/** The strip at the back of a room that holds the whiteboard. */
const BOARD_STRIP = 2;
const MAIN_SEAT_OFFSET_X = -0.55;
const SIDE_SEAT_OFFSET_X = 0.65;
const BOUNDS_MARGIN = 2;

export interface Point {
  x: number;
  z: number;
}

export interface GridCell {
  gx: number;
  gz: number;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export interface SeatSlot extends Point {
  agentId: string;
  roomId: string;
  /** 0-23: even indexes are main seats, odd ones the side seat of the same cell. */
  index: number;
  side: boolean;
}

export interface RoomLayout {
  roomId: string;
  cell: GridCell;
  center: Point;
  seats: SeatSlot[];
  /** Agents without a desk, drawn as "+N". */
  overflow: number;
  board: Point;
  door: Point;
  label: Point;
}

export interface OfficeLayout {
  rooms: RoomLayout[];
  roomById: ReadonlyMap<string, RoomLayout>;
  seatOf: ReadonlyMap<string, SeatSlot>;
  bounds: Bounds;
}

/** What the next layout keeps: each room's cell and each agent's seat. */
export interface LayoutMemory {
  roomCells: ReadonlyMap<string, GridCell>;
  seats: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export const EMPTY_LAYOUT_MEMORY: LayoutMemory = { roomCells: new Map(), seats: new Map() };

function angleOf(cell: GridCell): number {
  const angle = Math.atan2(cell.gz, cell.gx);
  return angle < 0 ? angle + 2 * Math.PI : angle;
}

/** Grid cells ring by ring from (0, 0), each ring ordered by angle from east. */
export function spiralCells(count: number): GridCell[] {
  const cells: GridCell[] = [];
  for (let ring = 0; cells.length < count; ring += 1) {
    const ringCells: GridCell[] = [];
    for (let gx = -ring; gx <= ring; gx += 1) {
      for (let gz = -ring; gz <= ring; gz += 1) {
        if (Math.max(Math.abs(gx), Math.abs(gz)) === ring) ringCells.push({ gx, gz });
      }
    }
    ringCells.sort((left, right) => angleOf(left) - angleOf(right));
    cells.push(...ringCells);
  }
  return cells.slice(0, count);
}

function cellKey(cell: GridCell): string {
  return `${cell.gx},${cell.gz}`;
}

function assignCells(
  roomIds: readonly string[],
  previous: ReadonlyMap<string, GridCell>,
): Map<string, GridCell> {
  const cells = new Map<string, GridCell>([[LOBBY, { gx: 0, gz: 0 }]]);
  const taken = new Set<string>([cellKey({ gx: 0, gz: 0 })]);
  const pending: string[] = [];
  for (const roomId of roomIds) {
    if (roomId === LOBBY) continue;
    const kept = previous.get(roomId);
    if (kept && !taken.has(cellKey(kept))) {
      taken.add(cellKey(kept));
      cells.set(roomId, kept);
    } else {
      pending.push(roomId);
    }
  }
  // Of the first taken + pending spiral cells, at most `taken` are in use.
  const free = spiralCells(taken.size + pending.length).filter((cell) => !taken.has(cellKey(cell)));
  pending.forEach((roomId, index) => {
    const cell = free[index];
    if (cell) cells.set(roomId, cell);
  });
  return cells;
}

/** World position of seat `index` in a room centred at `center`. */
export function seatPosition(center: Point, index: number): Point {
  const cell = Math.floor(index / 2);
  const column = cell % CELL_COLUMNS;
  const row = Math.floor(cell / CELL_COLUMNS);
  const side = index % 2 === 1;
  const cellX = -ROOM_WIDTH / 2 + 1 + column * CELL_SIZE + CELL_SIZE / 2;
  const cellZ = -ROOM_DEPTH / 2 + BOARD_STRIP + 0.5 + row * CELL_SIZE + CELL_SIZE / 2;
  return {
    x: center.x + cellX + (side ? SIDE_SEAT_OFFSET_X : MAIN_SEAT_OFFSET_X),
    z: center.z + cellZ,
  };
}

function pickSeat(
  row: OfficeRow,
  seats: ReadonlyMap<string, number>,
  used: ReadonlySet<number>,
): number | null {
  const parentId = row.depth === 1 ? row.agent.parentAgentId : null;
  const parentSeat = parentId === null ? undefined : seats.get(parentId);
  if (parentSeat !== undefined && parentSeat % 2 === 0 && !used.has(parentSeat + 1)) {
    return parentSeat + 1;
  }
  for (let index = 0; index < DESKS_PER_ROOM; index += 2) if (!used.has(index)) return index;
  for (let index = 1; index < DESKS_PER_ROOM; index += 2) if (!used.has(index)) return index;
  return null;
}

function assignSeats(
  room: OfficeRoom,
  previous: ReadonlyMap<string, number> | undefined,
): { seats: Map<string, number>; overflow: number } {
  const seats = new Map<string, number>();
  const used = new Set<number>();
  for (const row of room.rows) {
    const kept = previous?.get(row.agent.id);
    if (kept !== undefined && kept < DESKS_PER_ROOM && !used.has(kept)) {
      seats.set(row.agent.id, kept);
      used.add(kept);
    }
  }
  let overflow = 0;
  for (const row of room.rows) {
    if (seats.has(row.agent.id)) continue;
    const index = pickSeat(row, seats, used);
    if (index === null) {
      overflow += 1;
      continue;
    }
    seats.set(row.agent.id, index);
    used.add(index);
  }
  return { seats, overflow };
}

function roomLayout(
  room: OfficeRoom,
  cell: GridCell,
  seats: ReadonlyMap<string, number>,
  overflow: number,
): RoomLayout {
  const center = { x: cell.gx * ROOM_PITCH_X, z: cell.gz * ROOM_PITCH_Z };
  const slots: SeatSlot[] = [];
  for (const [agentId, index] of seats) {
    slots.push({
      ...seatPosition(center, index),
      agentId,
      roomId: room.id,
      index,
      side: index % 2 === 1,
    });
  }
  slots.sort((left, right) => left.index - right.index);
  return {
    roomId: room.id,
    cell,
    center,
    seats: slots,
    overflow,
    board: { x: center.x, z: center.z - ROOM_DEPTH / 2 + 0.35 },
    door: { x: center.x, z: center.z + ROOM_DEPTH / 2 },
    label: { x: center.x - ROOM_WIDTH / 2 + 2.5, z: center.z + ROOM_DEPTH / 2 + 0.9 },
  };
}

function boundsOf(rooms: readonly RoomLayout[]): Bounds {
  const xs = rooms.map((room) => room.center.x);
  const zs = rooms.map((room) => room.center.z);
  return {
    minX: Math.min(...xs) - ROOM_WIDTH / 2 - BOUNDS_MARGIN,
    maxX: Math.max(...xs) + ROOM_WIDTH / 2 + BOUNDS_MARGIN,
    minZ: Math.min(...zs) - ROOM_DEPTH / 2 - BOUNDS_MARGIN,
    maxZ: Math.max(...zs) + ROOM_DEPTH / 2 + BOUNDS_MARGIN,
  };
}

export function layoutOffice(
  model: OfficeModel,
  memory: LayoutMemory,
): { layout: OfficeLayout; memory: LayoutMemory } {
  const cells = assignCells(
    model.rooms.map((room) => room.id),
    memory.roomCells,
  );
  const rooms: RoomLayout[] = [];
  const seatMemory = new Map<string, ReadonlyMap<string, number>>();
  for (const room of model.rooms) {
    const cell = cells.get(room.id);
    if (!cell) continue;
    const { seats, overflow } = assignSeats(room, memory.seats.get(room.id));
    seatMemory.set(room.id, seats);
    rooms.push(roomLayout(room, cell, seats, overflow));
  }
  const seatOf = new Map<string, SeatSlot>();
  for (const room of rooms) for (const seat of room.seats) seatOf.set(seat.agentId, seat);
  return {
    layout: {
      rooms,
      roomById: new Map(rooms.map((room) => [room.roomId, room])),
      seatOf,
      bounds: boundsOf(rooms),
    },
    memory: { roomCells: cells, seats: seatMemory },
  };
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/layout.test.ts --bail=1`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/client/layout.ts plugins/office/client/layout.test.ts
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/client/layout.ts plugins/office/client/layout.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/client/layout.ts plugins/office/client/layout.test.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office room grid and stable desk seats" -- plugins/office/client/layout.ts plugins/office/client/layout.test.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 12: Scene palette, robot poses and frames (pure)

Tier: most capable: Fable 5.2 (`claude-fable-5-2`). This task decides how the office looks.

**Files:**

- Create: `plugins/office/client/scene/palette.ts`
- Test: `plugins/office/client/scene/palette.test.ts`
- Create: `plugins/office/client/scene/scene-plan.ts`
- Test: `plugins/office/client/scene/scene-plan.test.ts`

**Interfaces:**

- Consumes: `PluginTheme` (`@getpaseo/plugin`); Task 7 `OfficeModel`; Task 11 `OfficeLayout`, `Point`, `Bounds`.
- Produces:
  - `interface ScenePalette { dark: boolean; background; floor; roomFloor; wall; wallOpacity: number; desk; monitorDim; monitorLit; robotBody; robotHead; shadowOpacity: number; lightWarning; lightDanger; board; noteTask; noteClaimed; noteNote; label; labelText; plane }` (colour fields are `#rrggbb` strings)
  - `parseColor(value: string): { r: number; g: number; b: number } | null`, `mix(from: string, to: string, amount: number): string`, `relativeLuminance(color: string): number`
  - `scenePalette(theme: PluginTheme): ScenePalette`, `visorColor(provider: string, dark: boolean): string`
  - `type RobotPose = "typing" | "idle" | "raised" | "slumped" | "walking"`
  - `interface RobotPlan { agentId: string; roomId: string; seat: Point; seatIndex: number; door: Point; side: boolean; pose: RobotPose; visor: string; light: string | null; screenLit: boolean }`
  - `interface DeskPlan { x: number; z: number; screenLit: boolean }`, `DESK_OFFSET_Z = 0.55`, `deskPlans(plan: ScenePlan): DeskPlan[]` (every main seat of every room, plus each side seat with a robot; the desk stands in front of its seat)
  - `interface RoomPlan { roomId: string; label: string; center: Point; board: Point; door: Point; labelAt: Point }`
  - `interface ScenePlan { rooms: RoomPlan[]; robots: RobotPlan[]; bounds: Bounds }`
  - `interface RobotFrame { x: number; z: number; lift: number; heading: number; lean: number; armLeft: number; armRight: number }`
  - `type AnimationNeed = "none" | "smooth" | "typing"`
  - `WALK_MS = 1500`, `TYPING_FRAME_MS = 50`
  - `robotPose(agent: OfficeAgent): RobotPose`, `roomLabel(name: string, overflow: number): string`, `buildScenePlan(model: OfficeModel, layout: OfficeLayout, palette: ScenePalette): ScenePlan`, `robotFrame(robot: RobotPlan, enteredAt: number, now: number, reducedMotion: boolean): RobotFrame`, `animationNeed(robots: readonly RobotPlan[], enteredAt: ReadonlyMap<string, number>, now: number, reducedMotion: boolean): AnimationNeed`

Pose table (spec "What the user sees"): running is typing with the screen lit; idle leans back with the screen dim; a pending permission stands with the right arm raised and an amber light; error slumps with a red light; initializing walks in from the door over 1.5 s; closed agents are not in the model. Reduced motion: no typing bob, no walk (the robot is at its desk), states still change. Angles are radians about the robot's own axes: `lean` tips the body forward (positive) or back (negative); an arm at 0 hangs down, at -1.2 reaches forward to the keyboard, at pi points up. A robot at its desk faces +z, towards the camera.

- [ ] **Step 1: Write the failing tests**

`plugins/office/client/scene/palette.test.ts`:

```ts
import { expect, test } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import { mix, parseColor, relativeLuminance, scenePalette, visorColor } from "./palette.js";

function theme(colors: Partial<PluginTheme["colors"]>): PluginTheme {
  return {
    colors: {
      surface0: "#ffffff",
      surface1: "#f6f6f7",
      surface2: "#ececee",
      border: "#dcdce0",
      foreground: "#18181b",
      foregroundMuted: "#71717a",
      accent: "#d97757",
      accentForeground: "#ffffff",
      statusSuccess: "#2f855a",
      statusWarning: "#b7791f",
      statusDanger: "#c53030",
      ...colors,
    },
  };
}

test("parses hex and rgb colours and ignores alpha", () => {
  expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255 });
  expect(parseColor("#10203a")).toEqual({ r: 16, g: 32, b: 58 });
  expect(parseColor("#10203aff")).toEqual({ r: 16, g: 32, b: 58 });
  expect(parseColor("rgba(1, 2, 3, 0.5)")).toEqual({ r: 1, g: 2, b: 3 });
  expect(parseColor("hsl(0 0% 0%)")).toBe(null);
});

test("mixes from one colour to another", () => {
  expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
  expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
  expect(mix("#000000", "#ffffff", 0.5)).toBe("#808080");
  expect(mix("not a colour", "#808080", 0.5)).toBe("#808080");
});

test("luminance tells light from dark", () => {
  expect(relativeLuminance("#ffffff")).toBeCloseTo(1);
  expect(relativeLuminance("#000000")).toBe(0);
});

test("the palette follows the theme in light and dark", () => {
  const light = scenePalette(theme({}));
  expect(light.dark).toBe(false);
  expect(light.background).toBe("#ffffff");
  expect(light.roomFloor).toBe("#f6f6f7");
  expect(light.monitorLit).toBe("#d97757");
  expect(light.lightWarning).toBe("#b7791f");
  expect(light.lightDanger).toBe("#c53030");

  const dark = scenePalette(
    theme({ surface0: "#0b0b0d", surface1: "#141417", surface2: "#1d1d21", foreground: "#f4f4f5" }),
  );
  expect(dark.dark).toBe(true);
  expect(dark.background).toBe("#0b0b0d");
  expect(dark.shadowOpacity).toBeGreaterThan(light.shadowOpacity);
});

test("visors take the app's identity colour of the provider, per scheme", () => {
  expect(visorColor("claude", false)).toBe("#3e6e5d");
  expect(visorColor("claude", true)).toBe("#6cae96");
  expect(visorColor("codex", false)).toBe("#3d6985");
  expect(visorColor("codex", false)).toBe(visorColor("codex", false));
});
```

`plugins/office/client/scene/scene-plan.test.ts`:

```ts
import { expect, test } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import type { OfficeAgent, OfficeSnapshot } from "../../shared/contracts.js";
import { EMPTY_LAYOUT_MEMORY, layoutOffice } from "../layout.js";
import { buildOfficeModel } from "../model.js";
import { scenePalette } from "./palette.js";
import {
  DESK_OFFSET_Z,
  WALK_MS,
  animationNeed,
  buildScenePlan,
  robotFrame,
  robotPose,
  roomLabel,
  deskPlans,
  type RobotPlan,
} from "./scene-plan.js";

const THEME: PluginTheme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f6f6f7",
    surface2: "#ececee",
    border: "#dcdce0",
    foreground: "#18181b",
    foregroundMuted: "#71717a",
    accent: "#d97757",
    accentForeground: "#ffffff",
    statusSuccess: "#2f855a",
    statusWarning: "#b7791f",
    statusDanger: "#c53030",
  },
};

function agent(id: string, overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
    ...overrides,
  };
}

function plan(agents: readonly OfficeAgent[]) {
  const state: OfficeSnapshot = {
    agents: [...agents],
    workspaces: [{ id: "w1", name: "main", projectName: "paseo" }],
    activity: {},
    boards: {},
    wake: { paused: false, queued: {} },
  };
  const model = buildOfficeModel(state);
  const { layout } = layoutOffice(model, EMPTY_LAYOUT_MEMORY);
  return buildScenePlan(model, layout, scenePalette(THEME));
}

function robot(overrides: Partial<RobotPlan>): RobotPlan {
  return {
    agentId: "a",
    roomId: "w1",
    seat: { x: 10, z: 4 },
    seatIndex: 0,
    door: { x: 10, z: 10 },
    side: false,
    pose: "idle",
    visor: "#3e6e5d",
    light: null,
    screenLit: false,
    ...overrides,
  };
}

const PERMISSION = { id: "r", kind: "tool" as const, title: "Run" };

test("each state maps to its pose", () => {
  expect(robotPose(agent("a", { status: "running" }))).toBe("typing");
  expect(robotPose(agent("a"))).toBe("idle");
  expect(robotPose(agent("a", { status: "running", permissions: [PERMISSION] }))).toBe("raised");
  expect(robotPose(agent("a", { status: "error" }))).toBe("slumped");
  expect(robotPose(agent("a", { status: "initializing" }))).toBe("walking");
});

test("the plan has a robot per seated agent with its light, screen and visor", () => {
  const scene = plan([
    agent("run", { status: "running" }),
    agent("ask", { status: "running", permissions: [PERMISSION] }),
    agent("err", { status: "error" }),
  ]);
  expect(
    scene.robots.map((item) => [item.agentId, item.pose, item.light, item.screenLit, item.visor]),
  ).toEqual([
    ["ask", "raised", "#b7791f", true, "#3e6e5d"],
    ["err", "slumped", "#c53030", false, "#3e6e5d"],
    ["run", "typing", null, true, "#3e6e5d"],
  ]);
  expect(scene.rooms.map((room) => [room.roomId, room.label])).toEqual([
    ["lobby", "Lobby"],
    ["w1", "main"],
  ]);
});

test("a room label counts the agents without a desk", () => {
  expect(roomLabel("main", 0)).toBe("main");
  expect(roomLabel("main", 6)).toBe("main +6");
});

test("typing bobs the arms unless motion is reduced", () => {
  const typing = robot({ pose: "typing" });
  const moving = robotFrame(typing, 0, 1000, false);
  const still = robotFrame(typing, 0, 1000, true);
  expect(moving.armLeft).not.toBe(moving.armRight);
  expect(still).toEqual({
    x: 10,
    z: 4,
    lift: 0,
    heading: 0,
    lean: 0.08,
    armLeft: -1.2,
    armRight: -1.2,
  });
});

test("a starting agent walks from the door to its desk, or is already there with reduced motion", () => {
  const walker = robot({ pose: "walking" });
  const half = robotFrame(walker, 0, WALK_MS / 2, false);
  expect([half.x, half.z]).toEqual([10, 7]);
  expect(half.heading).toBeCloseTo(Math.PI);
  const arrived = robotFrame(walker, 0, WALK_MS, false);
  expect(arrived).toEqual({ x: 10, z: 4, lift: 0, heading: 0, lean: 0, armLeft: 0, armRight: 0 });
  expect(robotFrame(walker, 0, 0, true)).toEqual(arrived);
});

test("the other poses are fixed", () => {
  expect(robotFrame(robot({ pose: "idle" }), 0, 0, false)).toEqual({
    x: 10,
    z: 4,
    lift: 0,
    heading: 0,
    lean: -0.3,
    armLeft: 0,
    armRight: 0,
  });
  expect(robotFrame(robot({ pose: "raised" }), 0, 0, false)).toEqual({
    x: 10,
    z: 4,
    lift: 0.12,
    heading: 0,
    lean: 0,
    armLeft: 0,
    armRight: Math.PI,
  });
  expect(robotFrame(robot({ pose: "slumped" }), 0, 0, false)).toEqual({
    x: 10,
    z: 4,
    lift: -0.08,
    heading: 0,
    lean: 0.55,
    armLeft: 0.25,
    armRight: 0.25,
  });
});

test("the scene animates smoothly while someone walks, slowly while someone types, else not at all", () => {
  const entered = new Map([["w", 0]]);
  const walker = robot({ agentId: "w", pose: "walking" });
  const typist = robot({ agentId: "t", pose: "typing" });
  expect(animationNeed([walker, typist], entered, WALK_MS / 2, false)).toBe("smooth");
  expect(animationNeed([walker, typist], entered, WALK_MS, false)).toBe("typing");
  expect(animationNeed([robot({})], entered, 0, false)).toBe("none");
  expect(animationNeed([walker, typist], entered, 0, true)).toBe("none");
});

test("every room has its 12 main desks, plus a side desk per seated child", () => {
  const scene = plan([agent("a", { status: "running" }), agent("c", { parentAgentId: "a" })]);
  const desks = deskPlans(scene);
  expect(desks).toHaveLength(2 * 12 + 1);
  const parent = scene.robots.find((item) => item.agentId === "a");
  expect(desks.filter((desk) => desk.screenLit)).toEqual([
    { x: parent?.seat.x, z: (parent?.seat.z ?? 0) + DESK_OFFSET_Z, screenLit: true },
  ]);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/palette.test.ts --bail=1`
Expected: FAIL, cannot resolve `./palette.js`.

- [ ] **Step 3: Write the palette**

`plugins/office/client/scene/palette.ts`:

```ts
import type { PluginTheme } from "@getpaseo/plugin";

export interface ScenePalette {
  dark: boolean;
  background: string;
  floor: string;
  roomFloor: string;
  wall: string;
  wallOpacity: number;
  desk: string;
  monitorDim: string;
  monitorLit: string;
  robotBody: string;
  robotHead: string;
  shadowOpacity: number;
  lightWarning: string;
  lightDanger: string;
  board: string;
  noteTask: string;
  noteClaimed: string;
  noteNote: string;
  label: string;
  labelText: string;
  plane: string;
}

interface Rgb {
  r: number;
  g: number;
  b: number;
}

const FALLBACK: Rgb = { r: 128, g: 128, b: 128 };

export function parseColor(value: string): Rgb | null {
  const text = value.trim().toLowerCase();
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) {
    const [, r = "0", g = "0", b = "0"] = short;
    return { r: parseInt(r + r, 16), g: parseInt(g + g, 16), b: parseInt(b + b, 16) };
  }
  const long = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})?$/.exec(text);
  if (long) {
    const [, r = "00", g = "00", b = "00"] = long;
    return { r: parseInt(r, 16), g: parseInt(g, 16), b: parseInt(b, 16) };
  }
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(text);
  if (rgb) {
    const [, r = "0", g = "0", b = "0"] = rgb;
    return { r: Number(r), g: Number(g), b: Number(b) };
  }
  return null;
}

function toHex({ r, g, b }: Rgb): string {
  const part = (channel: number) =>
    Math.round(Math.min(255, Math.max(0, channel)))
      .toString(16)
      .padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** `amount` 0 gives `from`, 1 gives `to`. An unreadable colour counts as mid grey. */
export function mix(from: string, to: string, amount: number): string {
  const a = parseColor(from) ?? FALLBACK;
  const b = parseColor(to) ?? FALLBACK;
  return toHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

/** WCAG relative luminance, 0 for black to 1 for white. */
export function relativeLuminance(color: string): number {
  const { r, g, b } = parseColor(color) ?? FALLBACK;
  const linear = (channel: number) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
}

export function scenePalette(theme: PluginTheme): ScenePalette {
  const c = theme.colors;
  const dark = relativeLuminance(c.surface0) < 0.4;
  return {
    dark,
    background: mix(c.surface0, c.surface0, 0),
    floor: mix(c.surface0, c.foreground, dark ? 0.06 : 0.04),
    roomFloor: mix(c.surface1, c.surface1, 0),
    wall: mix(c.accent, c.surface0, 0.6),
    wallOpacity: 0.28,
    desk: mix(c.surface2, c.foreground, 0.12),
    monitorDim: dark ? mix(c.surface0, "#000000", 0.35) : mix(c.foreground, c.surface0, 0.35),
    monitorLit: mix(c.accent, c.accent, 0),
    robotBody: dark ? mix(c.surface2, c.foreground, 0.35) : mix(c.surface0, c.foreground, 0.12),
    robotHead: dark ? mix(c.surface2, c.foreground, 0.45) : mix(c.surface0, c.foreground, 0.06),
    shadowOpacity: dark ? 0.35 : 0.18,
    lightWarning: mix(c.statusWarning, c.statusWarning, 0),
    lightDanger: mix(c.statusDanger, c.statusDanger, 0),
    board: dark ? mix(c.surface2, c.foreground, 0.55) : mix(c.surface0, "#ffffff", 0.8),
    noteTask: mix(c.statusWarning, c.surface0, 0.25),
    noteClaimed: mix(c.statusSuccess, c.surface0, 0.25),
    noteNote: mix(c.accent, c.surface0, 0.35),
    label: mix(c.surface1, c.surface1, 0),
    labelText: mix(c.foreground, c.foreground, 0),
    plane: dark ? mix(c.foreground, c.foreground, 0) : mix(c.surface0, "#ffffff", 0.9),
  };
}

// Copied from packages/app/src/styles/identity-colors.ts (IDENTITY_COLOR_NAMES,
// IDENTITY_FOREGROUND_LIGHT/DARK, hashIdentityKey); a plugin cannot import app code. Order is
// load-bearing there and here: the hash indexes into it.
const IDENTITY_NAMES = [
  "violet",
  "sky",
  "emerald",
  "orange",
  "pink",
  "indigo",
  "teal",
  "red",
  "amber",
  "blue",
] as const;
type IdentityName = (typeof IDENTITY_NAMES)[number];
const IDENTITY_LIGHT: Record<IdentityName, string> = {
  violet: "#6d49b5",
  sky: "#3d6985",
  emerald: "#3e6e5d",
  orange: "#845838",
  pink: "#974168",
  indigo: "#5251c2",
  teal: "#3e6d6c",
  red: "#9c4243",
  amber: "#716239",
  blue: "#39649e",
};
const IDENTITY_DARK: Record<IdentityName, string> = {
  violet: "#a392d5",
  sky: "#6aa6ce",
  emerald: "#6cae96",
  orange: "#cc8f64",
  pink: "#d87da3",
  indigo: "#9299d5",
  teal: "#6cacab",
  red: "#d88381",
  amber: "#b29d64",
  blue: "#7ba1d5",
};

function hashIdentityKey(key: string): number {
  let hash = 0;
  for (const character of key) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

/** The provider's identity colour, as a foreground for the current scheme. */
export function visorColor(provider: string, dark: boolean): string {
  const name = IDENTITY_NAMES[hashIdentityKey(provider) % IDENTITY_NAMES.length] ?? "violet";
  return dark ? IDENTITY_DARK[name] : IDENTITY_LIGHT[name];
}
```

`mix(x, x, 0)` normalises a theme colour to `#rrggbb` (theme tokens can be `rgb()`), which the scene's `Color` parses.

- [ ] **Step 4: Write the scene plan**

`plugins/office/client/scene/scene-plan.ts`:

```ts
import type { OfficeAgent } from "../../shared/contracts.js";
import {
  DESKS_PER_ROOM,
  seatPosition,
  type Bounds,
  type OfficeLayout,
  type Point,
} from "../layout.js";
import type { OfficeModel } from "../model.js";
import { visorColor, type ScenePalette } from "./palette.js";

export type RobotPose = "typing" | "idle" | "raised" | "slumped" | "walking";

/** A desk stands this far in front (+z) of its seat; robots at their desks face +z. */
export const DESK_OFFSET_Z = 0.55;

export interface RobotPlan {
  agentId: string;
  roomId: string;
  seat: Point;
  seatIndex: number;
  door: Point;
  side: boolean;
  pose: RobotPose;
  visor: string;
  /** Amber for a pending permission, red for an error, else none. */
  light: string | null;
  screenLit: boolean;
}

export interface RoomPlan {
  roomId: string;
  label: string;
  center: Point;
  board: Point;
  door: Point;
  labelAt: Point;
}

export interface ScenePlan {
  rooms: RoomPlan[];
  robots: RobotPlan[];
  bounds: Bounds;
}

export interface RobotFrame {
  x: number;
  z: number;
  /** Vertical offset of the whole robot. */
  lift: number;
  /** Rotation about the vertical axis; 0 faces +z (the camera). */
  heading: number;
  /** Forward tilt of the body; negative leans back. */
  lean: number;
  armLeft: number;
  armRight: number;
}

/** "smooth" draws every frame; "typing" draws every TYPING_FRAME_MS. */
export type AnimationNeed = "none" | "smooth" | "typing";

export const WALK_MS = 1500;
export const TYPING_FRAME_MS = 50;
const ARM_TYPING = -1.2;
const ARM_UP = Math.PI;

export function robotPose(agent: OfficeAgent): RobotPose {
  if (agent.permissions.length > 0) return "raised";
  if (agent.status === "error") return "slumped";
  if (agent.status === "initializing") return "walking";
  if (agent.status === "running") return "typing";
  return "idle";
}

export function roomLabel(name: string, overflow: number): string {
  return overflow > 0 ? `${name} +${overflow}` : name;
}

function lightFor(pose: RobotPose, palette: ScenePalette): string | null {
  if (pose === "raised") return palette.lightWarning;
  if (pose === "slumped") return palette.lightDanger;
  return null;
}

export function buildScenePlan(
  model: OfficeModel,
  layout: OfficeLayout,
  palette: ScenePalette,
): ScenePlan {
  const names = new Map(model.rooms.map((room) => [room.id, room.name]));
  const rooms = layout.rooms.map(
    (room): RoomPlan => ({
      roomId: room.roomId,
      label: roomLabel(names.get(room.roomId) ?? room.roomId, room.overflow),
      center: room.center,
      board: room.board,
      door: room.door,
      labelAt: room.label,
    }),
  );
  const robots: RobotPlan[] = [];
  for (const room of layout.rooms) {
    for (const seat of room.seats) {
      const agent = model.agents.get(seat.agentId);
      if (!agent) continue;
      const pose = robotPose(agent);
      robots.push({
        agentId: agent.id,
        roomId: room.roomId,
        seat: { x: seat.x, z: seat.z },
        seatIndex: seat.index,
        door: room.door,
        side: seat.side,
        pose,
        visor: visorColor(agent.provider, palette.dark),
        light: lightFor(pose, palette),
        screenLit: agent.status === "running",
      });
    }
  }
  robots.sort((left, right) => left.agentId.localeCompare(right.agentId));
  return { rooms, robots, bounds: layout.bounds };
}

export interface DeskPlan {
  x: number;
  z: number;
  screenLit: boolean;
}

/** Every main seat of every room gets a desk, so empty rooms still read as offices. */
export function deskPlans(plan: ScenePlan): DeskPlan[] {
  const lit = new Map(
    plan.robots.map((robot) => [`${robot.roomId}:${robot.seatIndex}`, robot.screenLit]),
  );
  const desks: DeskPlan[] = [];
  for (const room of plan.rooms) {
    for (let index = 0; index < DESKS_PER_ROOM; index += 2) {
      const seat = seatPosition(room.center, index);
      desks.push({
        x: seat.x,
        z: seat.z + DESK_OFFSET_Z,
        screenLit: lit.get(`${room.roomId}:${index}`) ?? false,
      });
    }
  }
  for (const robot of plan.robots) {
    if (!robot.side) continue;
    desks.push({ x: robot.seat.x, z: robot.seat.z + DESK_OFFSET_Z, screenLit: robot.screenLit });
  }
  return desks;
}

function seated(
  robot: RobotPlan,
  lean: number,
  armLeft: number,
  armRight: number,
  lift = 0,
): RobotFrame {
  return { x: robot.seat.x, z: robot.seat.z, lift, heading: 0, lean, armLeft, armRight };
}

function walkingFrame(robot: RobotPlan, enteredAt: number, now: number, reducedMotion: boolean) {
  const progress = reducedMotion ? 1 : Math.min(1, Math.max(0, (now - enteredAt) / WALK_MS));
  if (progress >= 1) return seated(robot, 0, 0, 0);
  const dx = robot.seat.x - robot.door.x;
  const dz = robot.seat.z - robot.door.z;
  const swing = Math.sin(now / 150) * 0.5;
  return {
    x: robot.door.x + dx * progress,
    z: robot.door.z + dz * progress,
    lift: Math.abs(Math.sin(now / 150)) * 0.05,
    heading: Math.atan2(dx, dz),
    lean: 0.05,
    armLeft: swing,
    armRight: -swing,
  };
}

/** The robot's transform at `now`; `enteredAt` is when the scene first saw the agent. */
export function robotFrame(
  robot: RobotPlan,
  enteredAt: number,
  now: number,
  reducedMotion: boolean,
): RobotFrame {
  switch (robot.pose) {
    case "typing": {
      const bob = reducedMotion ? 0 : Math.sin(now / 110) * 0.18;
      return seated(robot, 0.08, ARM_TYPING + bob, ARM_TYPING - bob);
    }
    case "idle":
      return seated(robot, -0.3, 0, 0);
    case "raised":
      return seated(robot, 0, 0, ARM_UP, 0.12);
    case "slumped":
      return seated(robot, 0.55, 0.25, 0.25, -0.08);
    case "walking":
      return walkingFrame(robot, enteredAt, now, reducedMotion);
  }
}

export function animationNeed(
  robots: readonly RobotPlan[],
  enteredAt: ReadonlyMap<string, number>,
  now: number,
  reducedMotion: boolean,
): AnimationNeed {
  if (reducedMotion) return "none";
  const walking = robots.some(
    (robot) => robot.pose === "walking" && now - (enteredAt.get(robot.agentId) ?? now) < WALK_MS,
  );
  if (walking) return "smooth";
  return robots.some((robot) => robot.pose === "typing") ? "typing" : "none";
}
```

The walking test's half-way point: door (10, 10), seat (10, 4), progress 0.5 gives (10, 7); heading `atan2(0, -6)` is pi.

- [ ] **Step 5: Run the tests to see them pass**

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/palette.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/scene-plan.test.ts --bail=1
```

Expected: PASS, 5 tests and 8 tests. In "the plan has a robot per seated agent", the plan sorts robots by agent id, so the order does not depend on how the room orders agents that share a `createdAt`.

- [ ] **Step 6: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/client/scene
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/client/scene
```

- [ ] **Step 7: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/client/scene/palette.ts plugins/office/client/scene/palette.test.ts plugins/office/client/scene/scene-plan.ts plugins/office/client/scene/scene-plan.test.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office scene palette, poses and frames" -- plugins/office/client/scene/palette.ts plugins/office/client/scene/palette.test.ts plugins/office/client/scene/scene-plan.ts plugins/office/client/scene/scene-plan.test.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 13: Vendor three.js r170 and serve it over `office.asset.request`

Tier: standard.

This task needs network access to the public npm registry. If the download fails, or a checksum below does not match, STOP: report what failed and change nothing. Do not take three.js from any other source, version or build file.

**Files:**

- Create: `plugins/office/vendor/three.module.min.js` (downloaded, unmodified)
- Create: `plugins/office/vendor/LICENSE-three` (downloaded `LICENSE`, unmodified)
- Create: `plugins/office/vendor/SOURCES.md`
- Create: `plugins/office/server/asset.ts`
- Test: `plugins/office/server/asset.test.ts`
- Modify: `plugins/office/index.server.ts` (whole file below)
- Modify: `.oxlintrc.json` (`ignorePatterns`), `.oxfmtrc.json` (`ignorePatterns`)

**Interfaces:**

- Consumes: Task 3 `assetRpc`, `errorMessage`; Task 6 `index.server.ts`.
- Produces:
  - `THREE_FILE = "three.module.min.js"`, `THREE_SHA256 = "08fd7545d13d2c7fb65ab691530a802dafefd638596501854f267d0fb13c39e7"`, `THREE_BYTES = 691648`
  - `readThreeAsset(vendorDirectory: string | null): Promise<Uint8Array>` (rejects when the directory is unknown or the file's sha256 differs)
  - `index.server.ts` default export `contribute(server: PluginServerContext, builtin?: { directory: string })`

Why this file: `build/three.module.min.js` of three 0.170.0 is the last self-contained ES module build (code note 4); the client evaluates it from a Blob URL (Task 14), and a Blob URL module cannot import siblings. Why bytes over RPC: plugins have no HTTP route, and a top-level `Uint8Array` result travels as one binary frame (`PluginSubscriptionContext.push` and RPC docs); 691,648 bytes is far under the daemon's 100 MiB and the relay's 32 MiB message limits (`packages/protocol/src/websocket-message-limit.ts`). The daemon reads the file on each request and keeps nothing in memory; the client keeps the evaluated module for the page's life (decision 6), so a device asks once per page load.

- [ ] **Step 1: Download into a fresh directory and check every checksum**

```bash
WORK="$(mktemp -d)" && cd "$WORK"
npm pack three@0.170.0 --registry https://registry.npmjs.org --json > pack.json
node -e 'const p=require(process.argv[1])[0]; console.log(p.filename, p.integrity)' "$WORK/pack.json"
```

Expected: `three-0.170.0.tgz sha512-FQK+LEpYc0fBD+J8g6oSEyyNzjp+Q7Ks1C568WWaoMRLW+TkNNWmenWeGgJjV105Gd+p/2ql1ZcjYvNiPZBhuQ==`. Anything else: STOP.

```bash
cd "$WORK"
mkdir unpacked && tar -xzf three-0.170.0.tgz -C unpacked package/build/three.module.min.js package/LICENSE
sha256sum unpacked/package/build/three.module.min.js unpacked/package/LICENSE
wc -c < unpacked/package/build/three.module.min.js
grep -c 'from"\|import(' unpacked/package/build/three.module.min.js || true
```

Expected:

```
08fd7545d13d2c7fb65ab691530a802dafefd638596501854f267d0fb13c39e7  unpacked/package/build/three.module.min.js
4c40a1ef62450b857c3b2aaf294936304cd552d965fbcd9d32d4c5bcf4ba4454  unpacked/package/LICENSE
691648
0
```

The last `0` confirms the file imports nothing. Any difference: STOP. Nothing from the tarball is run.

- [ ] **Step 2: Copy the two files in and write SOURCES.md**

```bash
mkdir -p /workspace/utils/paseo/plugins/office/vendor
cp "$WORK/unpacked/package/build/three.module.min.js" /workspace/utils/paseo/plugins/office/vendor/three.module.min.js
cp "$WORK/unpacked/package/LICENSE" /workspace/utils/paseo/plugins/office/vendor/LICENSE-three
sha256sum /workspace/utils/paseo/plugins/office/vendor/three.module.min.js /workspace/utils/paseo/plugins/office/vendor/LICENSE-three
rm -rf "$WORK"
```

Expected: the same two checksums as Step 1.

`plugins/office/vendor/SOURCES.md`:

```markdown
# Vendored files

The `office` built-in serves `three.module.min.js` to web clients over `office.asset.request`;
the client evaluates it only when the 3D view is shown. Nothing here runs in the daemon.

## three.js

- Package: `three@0.170.0` from https://registry.npmjs.org (tarball integrity
  `sha512-FQK+LEpYc0fBD+J8g6oSEyyNzjp+Q7Ks1C568WWaoMRLW+TkNNWmenWeGgJjV105Gd+p/2ql1ZcjYvNiPZBhuQ==`)
- Licence: MIT, Copyright © 2010-2024 three.js authors (`LICENSE-three`, the package's `LICENSE`,
  sha256 `4c40a1ef62450b857c3b2aaf294936304cd552d965fbcd9d32d4c5bcf4ba4454`)
- Kept: `build/three.module.min.js`, unmodified, 691,648 bytes, sha256
  `08fd7545d13d2c7fb65ab691530a802dafefd638596501854f267d0fb13c39e7` (checked again by
  `server/asset.ts` on every read).
- Why r170: from r171 on, `build/three.module.js` imports `./three.core.js`, and a module evaluated
  from a Blob URL cannot import a sibling file. r170's module build is self-contained.

To update the pin, download the new package into an empty temporary directory, confirm its module
build has no `import` or `from"` statements, copy the two files over these, and update the
version, sizes and checksums here and in `server/asset.ts`.
```

The copyright line must match `LICENSE-three`'s first line exactly: run `head -3 /workspace/utils/paseo/plugins/office/vendor/LICENSE-three` and copy its copyright line into `SOURCES.md` if it differs.

- [ ] **Step 3: Keep lint and format off the vendored files**

In `.oxlintrc.json`, change

```json
  "ignorePatterns": [".dev/**", "plugins/default-skills/vendor/**"],
```

to

```json
  "ignorePatterns": [".dev/**", "plugins/default-skills/vendor/**", "plugins/office/vendor/**"],
```

In `.oxfmtrc.json`, change

```json
  "ignorePatterns": ["*.lock", "**/*.gen.ts", "**/*.gen.tsx", "plugins/default-skills/vendor/**"]
```

to

```json
  "ignorePatterns": [
    "*.lock",
    "**/*.gen.ts",
    "**/*.gen.tsx",
    "plugins/default-skills/vendor/**",
    "plugins/office/vendor/**"
  ]
```

- [ ] **Step 4: Write the failing test**

`plugins/office/server/asset.test.ts`:

```ts
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "vitest";
import { THREE_BYTES, THREE_FILE, readThreeAsset } from "./asset.js";

const VENDOR = fileURLToPath(new URL("../vendor/", import.meta.url));

test("serves the vendored three.js build when its checksum matches", async () => {
  const bytes = await readThreeAsset(VENDOR);
  expect(bytes.byteLength).toBe(THREE_BYTES);
  expect(bytes).toBeInstanceOf(Uint8Array);
});

test("refuses a file whose checksum differs", async () => {
  const directory = await mkdtemp(join(tmpdir(), "office-asset-"));
  try {
    await writeFile(join(directory, THREE_FILE), "export const REVISION = '170';");
    await expect(readThreeAsset(directory)).rejects.toThrow(/^Unexpected three\.module\.min\.js/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("refuses when the daemon did not pass the plugin directory", async () => {
  await expect(readThreeAsset(null)).rejects.toThrow(
    "The office was started without its plugin directory",
  );
});
```

- [ ] **Step 5: Run it to see it fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/asset.test.ts --bail=1`
Expected: FAIL, cannot resolve `./asset.js`.

- [ ] **Step 6: Write the asset reader and register the RPC**

`plugins/office/server/asset.ts`:

```ts
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const THREE_FILE = "three.module.min.js";
/** Pinned in vendor/SOURCES.md; a different file is never served. */
export const THREE_SHA256 = "08fd7545d13d2c7fb65ab691530a802dafefd638596501854f267d0fb13c39e7";
export const THREE_BYTES = 691648;

/** Reads the vendored three.js on each call; the daemon keeps no copy in memory. */
export async function readThreeAsset(vendorDirectory: string | null): Promise<Uint8Array> {
  if (vendorDirectory === null) {
    throw new Error("The office was started without its plugin directory");
  }
  const bytes = await readFile(join(vendorDirectory, THREE_FILE));
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== THREE_SHA256) {
    throw new Error(`Unexpected ${THREE_FILE} (sha256 ${digest})`);
  }
  return bytes;
}
```

`plugins/office/index.server.ts` (replace the whole file):

```ts
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readThreeAsset } from "./server/asset.js";
import { errorMessage } from "./server/errors.js";
import { createHub } from "./server/hub.js";
import { liveHubPorts } from "./server/live-ports.js";
import { createPaseoHolder } from "./server/paseo-holder.js";
import { nodeTimers } from "./server/timers.js";
import { assetRpc, officeStateSubscription } from "./shared/contracts.js";

/** What the daemon passes a built-in beside the server context (as in plugins/default-skills). */
interface BuiltinPluginInfo {
  directory: string;
}

// Runs inside the daemon process: every handler, hook and timer catches its own errors.
export default function contribute(
  server: PluginServerContext,
  builtin?: BuiltinPluginInfo,
): () => Promise<void> {
  const log = (message: string) => console.error(message);
  const vendorDirectory = builtin ? join(builtin.directory, "vendor") : null;
  const holder = createPaseoHolder();
  const hub = createHub(liveHubPorts(holder, nodeTimers, log));
  // The handler's promise settles when the subscriber leaves (or the directory cannot start),
  // and settling closes the subscription; see Hub.attach.
  server.handle(officeStateSubscription, (_input, context) => {
    holder.remember(context.paseo);
    return hub.attach(context);
  });
  server.handle(assetRpc, async () => {
    try {
      return await readThreeAsset(vendorDirectory);
    } catch (error) {
      log(`[office] unable to serve three.js: ${errorMessage(error)}`);
      throw error;
    }
  });
  return () => hub.stop();
}
```

A handler that rejects answers the RPC with an error; the runtime catches it, so it cannot stop the daemon.

- [ ] **Step 7: Run the test to see it pass, and the built-in compile test**

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/asset.test.ts --bail=1
cd packages/server && flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: PASS, 3 tests; then 1 test.

- [ ] **Step 8: Verify first: the vendored file reaches the packaged daemon**

```bash
cd /workspace/utils/paseo
grep -n "builtin-plugins" packages/server/package.json | head -3
git check-ignore -v plugins/office/vendor/three.module.min.js || echo "not ignored"
```

Expected: `build:lib` copies `../../plugins` with a filter that drops only `node_modules`, `test` folders, test files and `.tsbuildinfo`, so `vendor/` ships; and `not ignored`. If a `.gitignore` rule matches the file, STOP and report the rule: the file must be committed.

- [ ] **Step 9: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/server/asset.ts plugins/office/server/asset.test.ts plugins/office/index.server.ts .oxlintrc.json .oxfmtrc.json
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/server/asset.ts plugins/office/server/asset.test.ts plugins/office/index.server.ts plugins/office/vendor
git diff --stat -- plugins/office/vendor
```

Expected: lint reports nothing for `plugins/office/vendor` (ignored); the vendored files are untouched by the formatter (`git status --short plugins/office/vendor` shows them as new files only).

- [ ] **Step 10: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/vendor/three.module.min.js plugins/office/vendor/LICENSE-three plugins/office/vendor/SOURCES.md plugins/office/server/asset.ts plugins/office/server/asset.test.ts plugins/office/index.server.ts .oxlintrc.json .oxfmtrc.json
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): vendor three.js r170 and serve it to the office" -- plugins/office/vendor/three.module.min.js plugins/office/vendor/LICENSE-three plugins/office/vendor/SOURCES.md plugins/office/server/asset.ts plugins/office/server/asset.test.ts plugins/office/index.server.ts .oxlintrc.json .oxfmtrc.json
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 14: The three.js surface, its loader, and the web environment

Tier: most capable.

**Files:**

- Create: `plugins/office/client/scene/three-types.ts`
- Test: `plugins/office/client/scene/three-types.test.ts`
- Create: `plugins/office/client/scene/three-loader.ts`
- Test: `plugins/office/client/scene/three-loader.test.ts`
- Create: `plugins/office/client/scene/web-env.web.ts`

**Interfaces:**

- Consumes: Task 3 `assetRpc` (only through the `fetchBytes` port).
- Produces:
  - `three-types.ts`: the structural types the scene uses (`Vector2Like`, `Vector3Like`, `EulerLike`, `ColorLike`, `Matrix4Like`, `Object3DLike`, `GeometryLike`, `MaterialLike`, `ColorMaterialLike`, `TextureLike`, `SpriteMaterialLike`, `BufferAttributeLike`, `InstancedMeshLike`, `MeshLike`, `SpriteLike`, `SceneLike`, `CameraLike`, `RendererLike`, `IntersectionLike`, `RaycasterLike`, `ThreeModule`), `THREE_REVISION = "170"`, `THREE_EXPORTS: readonly (keyof ThreeModule)[]`, `isThreeModule(value: unknown): value is ThreeModule`
  - `three-loader.ts`: `type ThreeLoadState = { status: "idle" } | { status: "loading" } | { status: "ready"; three: ThreeModule } | { status: "failed"; error: string }`, `interface ThreeLoaderPorts { fetchBytes(): Promise<Uint8Array<ArrayBuffer>>; evaluate(bytes: Uint8Array<ArrayBuffer>): Promise<unknown> }`, `interface ThreeLoader { state(): ThreeLoadState; subscribe(listener: () => void): () => void; load(ports: ThreeLoaderPorts): Promise<void> }`, `createThreeLoader(): ThreeLoader`, `sharedThreeLoader: ThreeLoader`
  - `web-env.web.ts`: `hasWebGL2(): boolean`, `prefersReducedMotion(): boolean`, `isCoarsePointer(): boolean`, `evaluateModule(bytes: Uint8Array<ArrayBuffer>): Promise<unknown>`

**The evaluation method, chosen:** `evaluateModule` wraps the bytes in a `Blob` of type `text/javascript`, makes an object URL, and imports it with a function built at run time, `new Function("url", "return import(url);")`, called through `Reflect.apply`; it revokes the URL once the import settles. The three.js file is an ES module (it ends in `export{...}`), so `eval` and plain `new Function` cannot run it: `export` is a syntax error outside a module. A literal `import()` in the plugin source does not survive the build: esbuild's CJS output (`compiler-build.ts`, `format: "cjs"`) rewrites it to a `require`, which the app's evaluator (`packages/app/src/plugins/evaluate.ts`) answers only from its fixed allowlist; and Hermes would reject the syntax when the same bundle is evaluated on native. Inside a string the import is parsed by the browser only, only when called, and only on web. The rejected alternatives: rewriting `export{...}` into a `return` (string surgery on a minified file, breaks on any upgrade), a `<script type="module">` tag (no way to get the exports back without a global), and an HTTP route on the daemon (plugins have none, and it would need its own auth). No CSP header was found in the app or the daemon's web responses; if a deployment adds one without `blob:` in `script-src` or without `'unsafe-eval'`, the import fails, the loader reports `failed`, and the office shows the **structure view** with the error and "Try 3D again". That structure view is the fallback for every failure in this chain.

- [ ] **Step 1: Write the failing tests**

`plugins/office/client/scene/three-types.test.ts`:

```ts
import { expect, test } from "vitest";
import { THREE_EXPORTS, THREE_REVISION, isThreeModule } from "./three-types.js";

function fakeModule(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const module: Record<string, unknown> = { REVISION: THREE_REVISION, SRGBColorSpace: "srgb" };
  for (const name of THREE_EXPORTS) module[name] = function Fake() {};
  return { ...module, ...overrides };
}

test("accepts a module with every export the scene uses, at r170", () => {
  expect(isThreeModule(fakeModule())).toBe(true);
});

test("refuses another revision, a missing export, or no module at all", () => {
  expect(isThreeModule(fakeModule({ REVISION: "171" }))).toBe(false);
  expect(isThreeModule(fakeModule({ InstancedMesh: undefined }))).toBe(false);
  expect(isThreeModule(null)).toBe(false);
  expect(isThreeModule("three")).toBe(false);
});
```

`plugins/office/client/scene/three-loader.test.ts`:

```ts
import { expect, test } from "vitest";
import { createThreeLoader, type ThreeLoaderPorts } from "./three-loader.js";
import { THREE_EXPORTS, THREE_REVISION } from "./three-types.js";

function fakeThree(): Record<string, unknown> {
  const module: Record<string, unknown> = { REVISION: THREE_REVISION, SRGBColorSpace: "srgb" };
  for (const name of THREE_EXPORTS) module[name] = function Fake() {};
  return module;
}

interface FakePorts extends ThreeLoaderPorts {
  fetches: number;
}

function ports(evaluate: () => Promise<unknown>): FakePorts {
  const fake: FakePorts = {
    fetches: 0,
    fetchBytes: async () => {
      fake.fetches += 1;
      return new Uint8Array([1]);
    },
    evaluate,
  };
  return fake;
}

test("loads once, even when two views ask at the same time", async () => {
  const loader = createThreeLoader();
  const fake = ports(async () => fakeThree());
  const states: string[] = [];
  loader.subscribe(() => states.push(loader.state().status));
  await Promise.all([loader.load(fake), loader.load(fake)]);
  await loader.load(fake);
  expect(fake.fetches).toBe(1);
  expect(states).toEqual(["loading", "ready"]);
});

test("a failed load reports its error, and a later load tries again", async () => {
  const loader = createThreeLoader();
  await loader.load(ports(() => Promise.reject(new Error("blocked by CSP"))));
  expect(loader.state()).toEqual({ status: "failed", error: "blocked by CSP" });
  await loader.load(ports(async () => fakeThree()));
  expect(loader.state().status).toBe("ready");
});

test("a module that is not three.js r170 is a failure", async () => {
  const loader = createThreeLoader();
  await loader.load(ports(async () => ({ REVISION: "171" })));
  expect(loader.state()).toEqual({ status: "failed", error: "Unexpected three.js build" });
});

test("an unsubscribed listener hears nothing", async () => {
  const loader = createThreeLoader();
  let calls = 0;
  const unsubscribe = loader.subscribe(() => {
    calls += 1;
  });
  unsubscribe();
  await loader.load(ports(async () => fakeThree()));
  expect(calls).toBe(0);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/three-types.test.ts --bail=1`
Expected: FAIL, cannot resolve `./three-types.js`.

- [ ] **Step 3: Write the three.js surface and its guard**

`plugins/office/client/scene/three-types.ts`:

```ts
// The part of three.js r170 the office scene uses, typed structurally: the library is evaluated at
// run time from the vendored bytes in ../../vendor, so its own types are not a dependency. Each
// member below exists in r170 with this shape.

export interface Vector2Like {
  x: number;
  y: number;
  set(x: number, y: number): this;
}

export interface Vector3Like {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): this;
}

export interface EulerLike {
  x: number;
  y: number;
  z: number;
  set(x: number, y: number, z: number): this;
}

export interface ColorLike {
  set(value: string): this;
}

/** Opaque here; the scene only passes matrices from objects to instanced meshes. */
export interface Matrix4Like {
  readonly elements: ArrayLike<number>;
}

export interface Object3DLike {
  position: Vector3Like;
  rotation: EulerLike;
  scale: Vector3Like;
  readonly matrixWorld: Matrix4Like;
  visible: boolean;
  renderOrder: number;
  add(...objects: Object3DLike[]): this;
  remove(...objects: Object3DLike[]): this;
  updateMatrixWorld(force?: boolean): void;
  lookAt(x: number, y: number, z: number): void;
}

export interface DisposableLike {
  dispose(): void;
}

export interface GeometryLike extends DisposableLike {
  rotateX(angle: number): this;
  translate(x: number, y: number, z: number): this;
  scale(x: number, y: number, z: number): this;
}

export interface MaterialLike extends DisposableLike {
  opacity: number;
  transparent: boolean;
  depthWrite: boolean;
}

export interface ColorMaterialLike extends MaterialLike {
  readonly color: ColorLike;
}

export interface TextureLike extends DisposableLike {
  needsUpdate: boolean;
  colorSpace: string;
}

export interface SpriteMaterialLike extends MaterialLike {
  map: TextureLike | null;
}

export interface BufferAttributeLike {
  needsUpdate: boolean;
}

export interface InstancedMeshLike extends Object3DLike, DisposableLike {
  count: number;
  frustumCulled: boolean;
  readonly instanceMatrix: BufferAttributeLike;
  readonly instanceColor: BufferAttributeLike | null;
  setMatrixAt(index: number, matrix: Matrix4Like): void;
  setColorAt(index: number, color: ColorLike): void;
  computeBoundingSphere(): void;
}

export type MeshLike = Object3DLike;

export interface SpriteLike extends Object3DLike {
  readonly center: Vector2Like;
  readonly material: SpriteMaterialLike;
}

export interface SceneLike extends Object3DLike {
  background: ColorLike | null;
}

export interface CameraLike extends Object3DLike {
  left: number;
  right: number;
  top: number;
  bottom: number;
  zoom: number;
  updateProjectionMatrix(): void;
}

export interface RendererLike extends DisposableLike {
  outputColorSpace: string;
  setPixelRatio(ratio: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  render(scene: SceneLike, camera: CameraLike): void;
}

export interface IntersectionLike {
  readonly object: Object3DLike;
  readonly instanceId?: number;
}

export interface RaycasterLike {
  setFromCamera(coords: Vector2Like, camera: CameraLike): void;
  intersectObject(object: Object3DLike, recursive?: boolean): IntersectionLike[];
  intersectObjects(objects: Object3DLike[], recursive?: boolean): IntersectionLike[];
}

export interface MaterialOptions {
  color: string;
  transparent?: boolean;
  opacity?: number;
  depthWrite?: boolean;
}

export interface ThreeModule {
  readonly REVISION: string;
  readonly SRGBColorSpace: string;
  readonly WebGLRenderer: new (parameters: {
    canvas: HTMLCanvasElement;
    antialias: boolean;
    alpha: boolean;
    powerPreference: "low-power" | "default" | "high-performance";
  }) => RendererLike;
  readonly Scene: new () => SceneLike;
  readonly Group: new () => Object3DLike;
  readonly Object3D: new () => Object3DLike;
  readonly OrthographicCamera: new (
    left: number,
    right: number,
    top: number,
    bottom: number,
    near: number,
    far: number,
  ) => CameraLike;
  readonly HemisphereLight: new (sky: string, ground: string, intensity: number) => Object3DLike;
  readonly DirectionalLight: new (color: string, intensity: number) => Object3DLike;
  readonly Color: new (value: string) => ColorLike;
  readonly Vector2: new (x: number, y: number) => Vector2Like;
  readonly BoxGeometry: new (width: number, height: number, depth: number) => GeometryLike;
  readonly CylinderGeometry: new (
    radiusTop: number,
    radiusBottom: number,
    height: number,
    radialSegments: number,
  ) => GeometryLike;
  readonly SphereGeometry: new (
    radius: number,
    widthSegments: number,
    heightSegments: number,
  ) => GeometryLike;
  readonly PlaneGeometry: new (width: number, height: number) => GeometryLike;
  readonly CircleGeometry: new (radius: number, segments: number) => GeometryLike;
  readonly ConeGeometry: new (
    radius: number,
    height: number,
    radialSegments: number,
  ) => GeometryLike;
  readonly MeshLambertMaterial: new (options: MaterialOptions) => ColorMaterialLike;
  readonly MeshBasicMaterial: new (options: MaterialOptions) => ColorMaterialLike;
  readonly SpriteMaterial: new (options: {
    map: TextureLike;
    transparent: boolean;
    depthWrite: boolean;
  }) => SpriteMaterialLike;
  readonly Mesh: new (geometry: GeometryLike, material: MaterialLike) => MeshLike;
  readonly InstancedMesh: new (
    geometry: GeometryLike,
    material: MaterialLike,
    count: number,
  ) => InstancedMeshLike;
  readonly Sprite: new (material: SpriteMaterialLike) => SpriteLike;
  readonly CanvasTexture: new (canvas: HTMLCanvasElement) => TextureLike;
  readonly Raycaster: new () => RaycasterLike;
}

export const THREE_REVISION = "170";

/** Every constructor in ThreeModule; the guard checks each is a function. */
export const THREE_EXPORTS: readonly (keyof ThreeModule)[] = [
  "WebGLRenderer",
  "Scene",
  "Group",
  "Object3D",
  "OrthographicCamera",
  "HemisphereLight",
  "DirectionalLight",
  "Color",
  "Vector2",
  "BoxGeometry",
  "CylinderGeometry",
  "SphereGeometry",
  "PlaneGeometry",
  "CircleGeometry",
  "ConeGeometry",
  "MeshLambertMaterial",
  "MeshBasicMaterial",
  "SpriteMaterial",
  "Mesh",
  "InstancedMesh",
  "Sprite",
  "CanvasTexture",
  "Raycaster",
];

/** True for the r170 module namespace (or anything with the same exports). */
export function isThreeModule(value: unknown): value is ThreeModule {
  if (typeof value !== "object" || value === null) return false;
  if (Reflect.get(value, "REVISION") !== THREE_REVISION) return false;
  if (typeof Reflect.get(value, "SRGBColorSpace") !== "string") return false;
  return THREE_EXPORTS.every((name) => typeof Reflect.get(value, name) === "function");
}
```

- [ ] **Step 4: Write the loader**

`plugins/office/client/scene/three-loader.ts`:

```ts
import { isThreeModule, type ThreeModule } from "./three-types.js";

export type ThreeLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; three: ThreeModule }
  | { status: "failed"; error: string };

export interface ThreeLoaderPorts {
  fetchBytes(): Promise<Uint8Array<ArrayBuffer>>;
  evaluate(bytes: Uint8Array<ArrayBuffer>): Promise<unknown>;
}

export interface ThreeLoader {
  state(): ThreeLoadState;
  subscribe(listener: () => void): () => void;
  /** Loads once; a later call after a failure tries again. Never rejects. */
  load(ports: ThreeLoaderPorts): Promise<void>;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createThreeLoader(): ThreeLoader {
  let current: ThreeLoadState = { status: "idle" };
  let pending: Promise<void> | null = null;
  const listeners = new Set<() => void>();
  function set(next: ThreeLoadState): void {
    current = next;
    for (const listener of listeners) listener();
  }
  async function run(ports: ThreeLoaderPorts): Promise<void> {
    set({ status: "loading" });
    try {
      const module = await ports.evaluate(await ports.fetchBytes());
      set(
        isThreeModule(module)
          ? { status: "ready", three: module }
          : { status: "failed", error: "Unexpected three.js build" },
      );
    } catch (error) {
      set({ status: "failed", error: messageOf(error) });
    }
  }
  return {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    load(ports) {
      if (current.status === "ready") return Promise.resolve();
      pending ??= run(ports).finally(() => {
        pending = null;
      });
      return pending;
    },
  };
}

/** One per page: three.js stays in memory for the page's life once a device has loaded it. */
export const sharedThreeLoader: ThreeLoader = createThreeLoader();
```

- [ ] **Step 5: Write the web environment**

`plugins/office/client/scene/web-env.web.ts`:

```ts
// Web only. Every function is called only when Platform.OS === "web" (office-surface.tsx), and
// none touches the DOM at module top level, because esbuild bundles this file for every platform.

export function hasWebGL2(): boolean {
  if (typeof document === "undefined") return false;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("webgl2");
    if (context === null) return false;
    context.getExtension("WEBGL_lose_context")?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function matches(query: string): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    ? window.matchMedia(query).matches
    : false;
}

export function prefersReducedMotion(): boolean {
  return matches("(prefers-reduced-motion: reduce)");
}

export function isCoarsePointer(): boolean {
  return matches("(pointer: coarse)");
}

/**
 * Evaluates an ES module from bytes and returns its namespace. The import lives in a string so
 * esbuild's CJS output does not rewrite it into a require() the app's evaluator would refuse,
 * and only a browser ever parses it. The three.js build is an ES module, which eval cannot run.
 */
export async function evaluateModule(bytes: Uint8Array<ArrayBuffer>): Promise<unknown> {
  const url = URL.createObjectURL(new Blob([bytes], { type: "text/javascript" }));
  try {
    const importModule = new Function("url", "return import(url);");
    const namespace: unknown = await Reflect.apply(importModule, undefined, [url]);
    return namespace;
  } finally {
    URL.revokeObjectURL(url);
  }
}
```

- [ ] **Step 6: Run the tests to see them pass**

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/three-types.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/three-loader.test.ts --bail=1
```

Expected: PASS, 2 tests and 4 tests.

- [ ] **Step 7: Verify first: the loader against the real file**

The guard's export list and the evaluation method are checked against the vendored bytes before any scene code depends on them. Node 22 imports ES modules from `data:` URLs, which exercises the same "module from bytes, no siblings" path as a Blob URL:

```bash
cd /workspace/utils/paseo && node --input-type=module -e '
import { readFileSync } from "node:fs";
const bytes = readFileSync("plugins/office/vendor/three.module.min.js");
const ns = await import("data:text/javascript;base64," + bytes.toString("base64"));
const need = ["WebGLRenderer","Scene","Group","Object3D","OrthographicCamera","HemisphereLight","DirectionalLight","Color","Vector2","BoxGeometry","CylinderGeometry","SphereGeometry","PlaneGeometry","CircleGeometry","ConeGeometry","MeshLambertMaterial","MeshBasicMaterial","SpriteMaterial","Mesh","InstancedMesh","Sprite","CanvasTexture","Raycaster"];
console.log(ns.REVISION, ns.SRGBColorSpace, need.filter((n) => typeof ns[n] !== "function"));
const m = new ns.InstancedMesh(new ns.BoxGeometry(1,1,1), new ns.MeshBasicMaterial({ color: "#fff" }), 2);
console.log(typeof m.computeBoundingSphere, typeof m.setColorAt, typeof new ns.Object3D().updateMatrixWorld);
'
```

Expected:

```
170 srgb []
function function function
```

Any other output: STOP and report it; the type surface or the pin is wrong. This runs the vendored library in Node without a DOM; it constructs no renderer.

- [ ] **Step 8: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/client/scene
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/client/scene
```

Expected: exit 0. If the typecheck rejects `new Blob([bytes])` for the buffer type, the parameter type is wrong somewhere upstream: `useRpc(assetRpc)` returns `Uint8Array<ArrayBuffer>` (`z.instanceof(Uint8Array)`'s output, `packages/plugin/src/rpc.ts` comment), so keep `Uint8Array<ArrayBuffer>` on every signature in the chain rather than casting.

- [ ] **Step 9: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/client/scene/three-types.ts plugins/office/client/scene/three-types.test.ts plugins/office/client/scene/three-loader.ts plugins/office/client/scene/three-loader.test.ts plugins/office/client/scene/web-env.web.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): load three.js from bytes on web, once per page" -- plugins/office/client/scene/three-types.ts plugins/office/client/scene/three-types.test.ts plugins/office/client/scene/three-loader.ts plugins/office/client/scene/three-loader.test.ts plugins/office/client/scene/web-env.web.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 15: Camera maths (pure)

Tier: standard.

**Files:**

- Create: `plugins/office/client/scene/camera.ts`
- Test: `plugins/office/client/scene/camera.test.ts`

**Interfaces:**

- Consumes: Task 11 `Bounds`, `Point`.
- Produces:
  - Constants: `CAMERA_HEIGHT = 26`, `CAMERA_BACK = 22`, `VIEW_HEIGHT = 30`, `ZOOM_MIN = 0.35`, `ZOOM_MAX = 3`, `FOCUS_ZOOM = 1.6`, `CAMERA_EASE_MS = 450`, `TAP_SLOP_PX = 8`, `GROUND_SCALE` (`hypot(26, 22) / 26`)
  - `interface CameraView { x: number; z: number; zoom: number }` (the ground point the camera looks at, and its zoom), `interface Viewport { width: number; height: number }`, `interface Frustum { left: number; right: number; top: number; bottom: number }`
  - `pixelRatioFor(devicePixelRatio: number, coarsePointer: boolean): number`
  - `frustumFor(viewport: Viewport): Frustum`, `cameraPosition(view: CameraView): { x: number; y: number; z: number }`
  - `frameBounds(bounds: Bounds, viewport: Viewport): CameraView`
  - `panBy(view: CameraView, dx: number, dy: number, viewport: Viewport, bounds: Bounds): CameraView`
  - `zoomBy(view: CameraView, factor: number): CameraView`, `wheelFactor(deltaY: number): number`
  - `focusOn(view: CameraView, point: Point): CameraView`, `easeView(from: CameraView, to: CameraView, progress: number): CameraView`

The camera is orthographic, fixed at `CAMERA_HEIGHT` above and `CAMERA_BACK` behind (+z) the point it looks at, about 50 degrees down. At zoom 1 it shows `VIEW_HEIGHT` world units from top to bottom; a ground distance `d` along z shows as `d / GROUND_SCALE` on screen. Dragging moves the office with the finger. Spec "Pixel ratio capped at 1.5 on a touch device and 2 elsewhere" is `pixelRatioFor`.

- [ ] **Step 1: Write the failing test**

`plugins/office/client/scene/camera.test.ts`:

```ts
import { expect, test } from "vitest";
import {
  CAMERA_BACK,
  CAMERA_HEIGHT,
  FOCUS_ZOOM,
  GROUND_SCALE,
  VIEW_HEIGHT,
  ZOOM_MAX,
  ZOOM_MIN,
  cameraPosition,
  easeView,
  focusOn,
  frameBounds,
  frustumFor,
  panBy,
  pixelRatioFor,
  wheelFactor,
  zoomBy,
} from "./camera.js";

const BOUNDS = { minX: -8, maxX: 8, minZ: -7.5, maxZ: 7.5 };
const PHONE = { width: 390, height: 844 };

test("pixel ratio is capped at 1.5 on touch and 2 elsewhere", () => {
  expect(pixelRatioFor(3, true)).toBe(1.5);
  expect(pixelRatioFor(3, false)).toBe(2);
  expect(pixelRatioFor(1, true)).toBe(1);
});

test("the frustum keeps the viewport's aspect", () => {
  expect(frustumFor({ width: 800, height: 400 })).toEqual({
    left: -VIEW_HEIGHT,
    right: VIEW_HEIGHT,
    top: VIEW_HEIGHT / 2,
    bottom: -VIEW_HEIGHT / 2,
  });
});

test("the camera sits above and behind the point it looks at", () => {
  expect(cameraPosition({ x: 3, z: 4, zoom: 1 })).toEqual({
    x: 3,
    y: CAMERA_HEIGHT,
    z: 4 + CAMERA_BACK,
  });
});

test("framing fits the office into a phone screen, centred", () => {
  const view = frameBounds(BOUNDS, PHONE);
  expect([view.x, view.z]).toEqual([0, 0]);
  expect(view.zoom).toBeCloseTo((VIEW_HEIGHT * (390 / 844)) / 16, 6);
  expect(frameBounds({ minX: -500, maxX: 500, minZ: -500, maxZ: 500 }, PHONE).zoom).toBe(ZOOM_MIN);
});

test("dragging moves the office with the finger and stays over the office", () => {
  const start = { x: 0, z: 0, zoom: 1 };
  const viewport = { width: 600, height: 600 };
  const perPixel = VIEW_HEIGHT / 600;
  expect(panBy(start, 100, 0, viewport, BOUNDS)).toEqual({ x: -100 * perPixel, z: 0, zoom: 1 });
  const down = panBy(start, 0, 40, viewport, BOUNDS);
  expect(down.z).toBeCloseTo(-40 * perPixel * GROUND_SCALE, 6);
  expect(panBy(start, -1000, 1000, viewport, BOUNDS)).toEqual({ x: 8, z: -7.5, zoom: 1 });
});

test("zoom stays within its limits; a wheel step up zooms out", () => {
  expect(zoomBy({ x: 0, z: 0, zoom: 2 }, 10).zoom).toBe(ZOOM_MAX);
  expect(zoomBy({ x: 0, z: 0, zoom: 1 }, 0.01).zoom).toBe(ZOOM_MIN);
  expect(wheelFactor(100)).toBeLessThan(1);
  expect(wheelFactor(-100)).toBeGreaterThan(1);
  expect(wheelFactor(0)).toBe(1);
});

test("focusing centres the point and zooms in, never out", () => {
  expect(focusOn({ x: 0, z: 0, zoom: 1 }, { x: 15, z: 14 })).toEqual({
    x: 15,
    z: 14,
    zoom: FOCUS_ZOOM,
  });
  expect(focusOn({ x: 0, z: 0, zoom: 2.5 }, { x: 15, z: 14 }).zoom).toBe(2.5);
});

test("easing starts at the old view, ends at the new one, and is half-way in the middle", () => {
  const from = { x: 0, z: 0, zoom: 1 };
  const to = { x: 10, z: -4, zoom: 2 };
  expect(easeView(from, to, 0)).toEqual(from);
  expect(easeView(from, to, 1)).toEqual(to);
  expect(easeView(from, to, 0.5)).toEqual({ x: 5, z: -2, zoom: 1.5 });
  expect(easeView(from, to, 3)).toEqual(to);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/camera.test.ts --bail=1`
Expected: FAIL, cannot resolve `./camera.js`.

- [ ] **Step 3: Write the camera maths**

`plugins/office/client/scene/camera.ts`:

```ts
import type { Bounds, Point } from "../layout.js";

export const CAMERA_HEIGHT = 26;
export const CAMERA_BACK = 22;
/** World units shown from top to bottom at zoom 1. */
export const VIEW_HEIGHT = 30;
export const ZOOM_MIN = 0.35;
export const ZOOM_MAX = 3;
export const FOCUS_ZOOM = 1.6;
export const CAMERA_EASE_MS = 450;
/** A pointer that moved less than this between down and up is a tap. */
export const TAP_SLOP_PX = 8;
/** Ground distance along z per unit of screen height (1 / sin of the camera's elevation). */
export const GROUND_SCALE = Math.hypot(CAMERA_HEIGHT, CAMERA_BACK) / CAMERA_HEIGHT;

export interface CameraView {
  /** The ground point the camera looks at. */
  x: number;
  z: number;
  zoom: number;
}

export interface Viewport {
  width: number;
  height: number;
}

export interface Frustum {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Spec: at most 1.5 on a touch device, 2 elsewhere. */
export function pixelRatioFor(devicePixelRatio: number, coarsePointer: boolean): number {
  return Math.min(devicePixelRatio, coarsePointer ? 1.5 : 2);
}

export function frustumFor(viewport: Viewport): Frustum {
  const aspect = viewport.width / Math.max(1, viewport.height);
  const halfHeight = VIEW_HEIGHT / 2;
  return {
    left: -halfHeight * aspect,
    right: halfHeight * aspect,
    top: halfHeight,
    bottom: -halfHeight,
  };
}

export function cameraPosition(view: CameraView): { x: number; y: number; z: number } {
  return { x: view.x, y: CAMERA_HEIGHT, z: view.z + CAMERA_BACK };
}

export function frameBounds(bounds: Bounds, viewport: Viewport): CameraView {
  const aspect = viewport.width / Math.max(1, viewport.height);
  const width = Math.max(1, bounds.maxX - bounds.minX);
  const depth = Math.max(1, bounds.maxZ - bounds.minZ);
  const zoom = Math.min((VIEW_HEIGHT * aspect) / width, (VIEW_HEIGHT * GROUND_SCALE) / depth);
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    z: (bounds.minZ + bounds.maxZ) / 2,
    zoom: clamp(zoom, ZOOM_MIN, ZOOM_MAX),
  };
}

/** `dx`/`dy` are the pointer's movement in CSS pixels since the last call. */
export function panBy(
  view: CameraView,
  dx: number,
  dy: number,
  viewport: Viewport,
  bounds: Bounds,
): CameraView {
  const perPixel = VIEW_HEIGHT / view.zoom / Math.max(1, viewport.height);
  return {
    x: clamp(view.x - dx * perPixel, bounds.minX, bounds.maxX),
    z: clamp(view.z - dy * perPixel * GROUND_SCALE, bounds.minZ, bounds.maxZ),
    zoom: view.zoom,
  };
}

export function zoomBy(view: CameraView, factor: number): CameraView {
  return { x: view.x, z: view.z, zoom: clamp(view.zoom * factor, ZOOM_MIN, ZOOM_MAX) };
}

/** A wheel step down (positive deltaY) zooms out. */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-deltaY * 0.0015);
}

export function focusOn(view: CameraView, point: Point): CameraView {
  return { x: point.x, z: point.z, zoom: Math.max(view.zoom, FOCUS_ZOOM) };
}

export function easeView(from: CameraView, to: CameraView, progress: number): CameraView {
  const t = clamp(progress, 0, 1);
  const eased = t * t * (3 - 2 * t);
  return {
    x: from.x + (to.x - from.x) * eased,
    z: from.z + (to.z - from.z) * eased,
    zoom: from.zoom + (to.zoom - from.zoom) * eased,
  };
}
```

The framing test's second bound is ground depth: 15 units of z show as `15 / GROUND_SCALE` screen units, so depth allows zoom up to `VIEW_HEIGHT * GROUND_SCALE / 15` (about 2.6 on a phone), and width (16 units at aspect 0.46, about 0.87) decides.

- [ ] **Step 4: Run the test to see it pass**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/camera.test.ts --bail=1`
Expected: PASS, 8 tests.

- [ ] **Step 5: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/client/scene/camera.ts plugins/office/client/scene/camera.test.ts
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/client/scene/camera.ts plugins/office/client/scene/camera.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/client/scene/camera.ts plugins/office/client/scene/camera.test.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office camera framing, pan, zoom and focus" -- plugins/office/client/scene/camera.ts plugins/office/client/scene/camera.test.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 16: The scene on web, with fake data, behind the 3D switch

Tier: most capable: Fable 5.2 (`claude-fable-5-2`). This task decides how the office looks.

Until the owner approves the look (Task 17), the 3D view draws a fixed fake office; the structure view keeps showing live data. Task 18 switches the scene to live data.

**Files:**

- Create: `plugins/office/client/scene/fake-office.ts`
- Test: `plugins/office/client/scene/fake-office.test.ts`
- Create: `plugins/office/client/scene/office-scene.web.ts`
- Create: `plugins/office/client/scene/scene-view.tsx`
- Modify: `plugins/office/client/office-surface.tsx` (whole file below)

**Interfaces:**

- Consumes: Task 3 `assetRpc`, `officeDeviceSettings`, `OfficeSnapshot`; Task 7 `buildOfficeModel`, `OfficeModel`; Task 8 `OfficeStyles`, `ActionButton`, `AgentCard`, `AttentionStrip`, `StructureView`, `useOffice`, `useAgentActions`; Task 11 `layoutOffice`, `EMPTY_LAYOUT_MEMORY`, `LayoutMemory`, `ROOM_WIDTH`, `ROOM_DEPTH`, `WALL_HEIGHT`, `DOOR_WIDTH`; Task 12 `scenePalette`, `ScenePalette`, `buildScenePlan`, `deskPlans`, `robotFrame`, `animationNeed`, `TYPING_FRAME_MS`, `ScenePlan`, `RobotPlan`; Task 14 `ThreeModule` and the `*Like` types, `sharedThreeLoader`, `hasWebGL2`, `prefersReducedMotion`, `isCoarsePointer`, `evaluateModule`; Task 15 camera functions.
- Produces:
  - `fakeOffice(): OfficeSnapshot`
  - `interface OfficeSceneOptions { three: ThreeModule; container: HTMLElement; coarsePointer: boolean; reducedMotion: boolean; onSelectAgent(agentId: string): void; onContextLost(): void }`
  - `interface OfficeScene { update(plan: ScenePlan, palette: ScenePalette): void; focusRoom(roomId: string): void; focusAgent(agentId: string): void; dispose(): void }`, `createOfficeScene(options: OfficeSceneOptions): OfficeScene`
  - `interface FocusRequest { agentId: string; nonce: number }`
  - `SceneView(props: { model: OfficeModel; theme: PluginTheme; styles: OfficeStyles; focusRoomId: string | null; focusRequest: FocusRequest | null; onSelectAgent(agentId: string): void; onProblem(message: string): void })`
  - `OfficeSurface` gains the 3D switch (`ThreeDSwitch`), the 3D/structure choice, and the "Try 3D again" banner.

Performance rules this task implements (spec "Performance"): one canvas; every repeated part is one `InstancedMesh` (desks, monitors, robot bodies, heads, visors, arms, lights, blob shadows, room floors, wall segments, boards); no shadow maps; `pixelRatioFor` caps the pixel ratio; frames are drawn only on demand: after a change, while the camera eases, while a robot walks in (every frame), while one types (every 50 ms), and never while the canvas is off screen (`IntersectionObserver`, which also sees a hidden workspace's `display: none`) or the page is hidden (`visibilitychange`); `dispose()` frees every geometry, material, texture, mesh and the renderer, and removes the canvas. A lost WebGL context calls `onContextLost`, and the surface falls back to the structure view with "Try 3D again". With reduced motion, robots do not type or walk and the camera jumps instead of easing.

- [ ] **Step 1: Write the failing test**

`plugins/office/client/scene/fake-office.test.ts`:

```ts
import { expect, test } from "vitest";
import type { PluginTheme } from "@getpaseo/plugin";
import { EMPTY_LAYOUT_MEMORY, layoutOffice } from "../layout.js";
import { buildOfficeModel } from "../model.js";
import { fakeOffice } from "./fake-office.js";
import { scenePalette } from "./palette.js";
import { buildScenePlan } from "./scene-plan.js";

const THEME: PluginTheme = {
  colors: {
    surface0: "#ffffff",
    surface1: "#f6f6f7",
    surface2: "#ececee",
    border: "#dcdce0",
    foreground: "#18181b",
    foregroundMuted: "#71717a",
    accent: "#d97757",
    accentForeground: "#ffffff",
    statusSuccess: "#2f855a",
    statusWarning: "#b7791f",
    statusDanger: "#c53030",
  },
};

test("the fake office shows every pose, a side desk, an overflow and the lobby", () => {
  const model = buildOfficeModel(fakeOffice());
  const { layout } = layoutOffice(model, EMPTY_LAYOUT_MEMORY);
  const plan = buildScenePlan(model, layout, scenePalette(THEME));
  expect(new Set(plan.robots.map((robot) => robot.pose))).toEqual(
    new Set(["typing", "idle", "raised", "slumped", "walking"]),
  );
  expect(plan.robots.some((robot) => robot.side)).toBe(true);
  expect(plan.rooms.map((room) => room.label)).toEqual([
    "Lobby",
    "main",
    "docs-site",
    "terraform",
    "load-test +2",
  ]);
  expect(model.attention.map((entry) => entry.reason)).toEqual(["permission", "error"]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/fake-office.test.ts --bail=1`
Expected: FAIL, cannot resolve `./fake-office.js`.

- [ ] **Step 3: Write the fake office**

`plugins/office/client/scene/fake-office.ts`:

```ts
import type { OfficeAgent, OfficeSnapshot, Post } from "../../shared/contracts.js";

/** A fixed office for the look review and tests: every pose, a child, an overflow, posts. */
export function fakeOffice(): OfficeSnapshot {
  const agent = (
    id: string,
    minute: number,
    fields: Partial<OfficeAgent> & Pick<OfficeAgent, "provider" | "status" | "workspaceId">,
  ): OfficeAgent => ({
    id,
    title: id,
    model: null,
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-11T08:${String(minute).padStart(2, "0")}:00.000Z`,
    ...fields,
  });
  const crowd = Array.from({ length: 26 }, (_, index) =>
    agent(`load-${String(index + 1).padStart(2, "0")}`, 20 + index, {
      provider: index % 2 === 0 ? "claude" : "codex",
      status: index % 3 === 0 ? "running" : "idle",
      workspaceId: "w-load",
    }),
  );
  const post = (fields: Omit<Post, "createdAt" | "updatedAt">): Post => ({
    ...fields,
    createdAt: "2026-11-11T09:00:00.000Z",
    updatedAt: "2026-11-11T09:00:00.000Z",
  });
  return {
    workspaces: [
      { id: "w-main", name: "main", projectName: "paseo" },
      { id: "w-docs", name: "docs-site", projectName: "docs" },
      { id: "w-infra", name: "terraform", projectName: "infra" },
      { id: "w-load", name: "load-test", projectName: "bench" },
    ],
    agents: [
      agent("Refactor hub", 0, { provider: "claude", status: "running", workspaceId: "w-main" }),
      agent("Review MR", 1, { provider: "codex", status: "idle", workspaceId: "w-main" }),
      agent("Hub tests", 2, {
        provider: "claude",
        status: "running",
        workspaceId: "w-main",
        parentAgentId: "Refactor hub",
      }),
      agent("Upgrade deps", 3, {
        provider: "opencode",
        status: "running",
        workspaceId: "w-main",
        permissions: [{ id: "perm-1", kind: "tool", title: "Run npm install" }],
      }),
      agent("Fix links", 4, { provider: "claude", status: "error", workspaceId: "w-docs" }),
      agent("New page", 5, { provider: "codex", status: "initializing", workspaceId: "w-docs" }),
      agent("Plan VPC", 6, { provider: "copilot", status: "running", workspaceId: "w-infra" }),
      agent("Triage", 7, { provider: "pi", status: "idle", workspaceId: null }),
      ...crowd,
    ],
    activity: {
      "Refactor hub": "Running Bash",
      "Hub tests": "Writing a reply",
      "Plan VPC": "Thinking",
    },
    boards: {
      lobby: [
        post({
          id: "p1",
          seq: 1,
          board: "lobby",
          kind: "task",
          text: "Rotate the staging certificate",
          author: "user",
          state: "open",
        }),
      ],
      "w-main": [
        post({
          id: "p2",
          seq: 2,
          board: "w-main",
          kind: "task",
          text: "Write hub tests",
          author: "Refactor hub",
          to: "Hub tests",
          state: "claimed",
          claimedBy: "Hub tests",
        }),
        post({
          id: "p3",
          seq: 3,
          board: "w-main",
          kind: "note",
          text: "Lint is green on main",
          author: "Review MR",
        }),
        post({
          id: "p4",
          seq: 4,
          board: "w-main",
          kind: "task",
          text: "Bump zod",
          author: "user",
          state: "open",
        }),
      ],
    },
    wake: { paused: false, queued: {} },
  };
}
```

The fake agents use their titles as ids so the screenshot reads well; real ids are UUIDs.

- [ ] **Step 4: Run the test to see it pass**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/fake-office.test.ts --bail=1`
Expected: PASS, 1 test. ("Upgrade deps" is the permission entry, "Fix links" the error entry.)

- [ ] **Step 5: Write the three.js wiring**

`plugins/office/client/scene/office-scene.web.ts`:

```ts
// Web only: created by scene-view.tsx after three.js loaded. Nothing here runs at import time.
import { DOOR_WIDTH, ROOM_DEPTH, ROOM_WIDTH, WALL_HEIGHT, type Bounds } from "../layout.js";
import {
  CAMERA_EASE_MS,
  TAP_SLOP_PX,
  cameraPosition,
  easeView,
  focusOn,
  frameBounds,
  frustumFor,
  panBy,
  pixelRatioFor,
  wheelFactor,
  zoomBy,
  type CameraView,
  type Viewport,
} from "./camera.js";
import type { ScenePalette } from "./palette.js";
import {
  TYPING_FRAME_MS,
  animationNeed,
  deskPlans,
  robotFrame,
  type RobotPlan,
  type ScenePlan,
} from "./scene-plan.js";
import type {
  CameraLike,
  ColorLike,
  ColorMaterialLike,
  GeometryLike,
  InstancedMeshLike,
  MaterialLike,
  Object3DLike,
  SpriteLike,
  TextureLike,
  ThreeModule,
} from "./three-types.js";

export interface OfficeSceneOptions {
  three: ThreeModule;
  container: HTMLElement;
  coarsePointer: boolean;
  reducedMotion: boolean;
  onSelectAgent(agentId: string): void;
  onContextLost(): void;
}

export interface OfficeScene {
  update(plan: ScenePlan, palette: ScenePalette): void;
  focusRoom(roomId: string): void;
  focusAgent(agentId: string): void;
  dispose(): void;
}

const WALL_THICKNESS = 0.12;
const DESK_SIZE = { width: 1, height: 0.7, depth: 0.6 };
const MONITOR_SIZE = { width: 0.5, height: 0.34, depth: 0.06 };
const BOARD_SIZE = { width: 4, height: 1.6, depth: 0.08 };
const LABEL_PIXELS = { width: 512, height: 128 };
const LABEL_SIZE = { width: 4.8, height: 1.2 };
const INITIAL_CAPACITY = 32;
const WHITE = "#ffffff";

interface Layer {
  mesh: InstancedMeshLike;
  capacity: number;
  readonly geometry: GeometryLike;
  readonly material: MaterialLike;
}

interface Materials {
  ground: ColorMaterialLike;
  roomFloor: ColorMaterialLike;
  wall: ColorMaterialLike;
  desk: ColorMaterialLike;
  board: ColorMaterialLike;
  robotBody: ColorMaterialLike;
  robotHead: ColorMaterialLike;
  /** White; each instance carries its own colour (screens, visors, lights). */
  tinted: ColorMaterialLike;
  shadow: ColorMaterialLike;
}

interface Layers {
  floors: Layer;
  walls: Layer;
  boards: Layer;
  desks: Layer;
  monitors: Layer;
  bodies: Layer;
  heads: Layer;
  visors: Layer;
  arms: Layer;
  lights: Layer;
  shadows: Layer;
}

interface Rig {
  root: Object3DLike;
  hip: Object3DLike;
  body: Object3DLike;
  head: Object3DLike;
  visor: Object3DLike;
  light: Object3DLike;
  armLeft: Object3DLike;
  armRight: Object3DLike;
}

interface Label {
  sprite: SpriteLike;
  texture: TextureLike;
  canvas: HTMLCanvasElement;
  drawn: string;
}

interface Placement {
  x: number;
  y: number;
  z: number;
  sx?: number;
  sy?: number;
  sz?: number;
}

function createMaterials(three: ThreeModule): Materials {
  const lambert = (transparent = false) =>
    new three.MeshLambertMaterial({ color: WHITE, transparent, depthWrite: !transparent });
  return {
    ground: lambert(),
    roomFloor: lambert(),
    wall: lambert(true),
    desk: lambert(),
    board: lambert(),
    robotBody: lambert(),
    robotHead: lambert(),
    tinted: new three.MeshBasicMaterial({ color: WHITE }),
    shadow: new three.MeshBasicMaterial({ color: "#000000", transparent: true, depthWrite: false }),
  };
}

function applyPalette(materials: Materials, palette: ScenePalette): void {
  materials.ground.color.set(palette.floor);
  materials.roomFloor.color.set(palette.roomFloor);
  materials.wall.color.set(palette.wall);
  materials.wall.opacity = palette.wallOpacity;
  materials.desk.color.set(palette.desk);
  materials.board.color.set(palette.board);
  materials.robotBody.color.set(palette.robotBody);
  materials.robotHead.color.set(palette.robotHead);
  materials.shadow.opacity = palette.shadowOpacity;
}

function createLayer(
  three: ThreeModule,
  parent: Object3DLike,
  geometry: GeometryLike,
  material: MaterialLike,
): Layer {
  const mesh = new three.InstancedMesh(geometry, material, INITIAL_CAPACITY);
  mesh.count = 0;
  mesh.frustumCulled = false;
  parent.add(mesh);
  return { mesh, capacity: INITIAL_CAPACITY, geometry, material };
}

/** Grows a layer by replacing its mesh; geometry and material are shared and kept. */
function ensureCapacity(three: ThreeModule, parent: Object3DLike, layer: Layer, count: number) {
  if (count <= layer.capacity) return;
  parent.remove(layer.mesh);
  layer.mesh.dispose();
  layer.capacity = Math.max(count, layer.capacity * 2);
  layer.mesh = new three.InstancedMesh(layer.geometry, layer.material, layer.capacity);
  layer.mesh.frustumCulled = false;
  parent.add(layer.mesh);
}

function finishLayer(layer: Layer, count: number): void {
  layer.mesh.count = count;
  layer.mesh.instanceMatrix.needsUpdate = true;
  if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
  layer.mesh.computeBoundingSphere();
}

function place(dummy: Object3DLike, at: Placement): Object3DLike {
  dummy.position.set(at.x, at.y, at.z);
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(at.sx ?? 1, at.sy ?? 1, at.sz ?? 1);
  dummy.updateMatrixWorld(true);
  return dummy;
}

function createLayers(three: ThreeModule, parent: Object3DLike, materials: Materials): Layers {
  const flat = new three.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const unitBox = new three.BoxGeometry(1, 1, 1);
  const layer = (geometry: GeometryLike, material: MaterialLike) =>
    createLayer(three, parent, geometry, material);
  return {
    floors: layer(flat, materials.roomFloor),
    walls: layer(unitBox, materials.wall),
    boards: layer(
      new three.BoxGeometry(BOARD_SIZE.width, BOARD_SIZE.height, BOARD_SIZE.depth),
      materials.board,
    ),
    desks: layer(
      new three.BoxGeometry(DESK_SIZE.width, DESK_SIZE.height, DESK_SIZE.depth),
      materials.desk,
    ),
    monitors: layer(
      new three.BoxGeometry(MONITOR_SIZE.width, MONITOR_SIZE.height, MONITOR_SIZE.depth),
      materials.tinted,
    ),
    bodies: layer(new three.CylinderGeometry(0.24, 0.3, 0.6, 10), materials.robotBody),
    heads: layer(new three.BoxGeometry(0.44, 0.36, 0.4), materials.robotHead),
    visors: layer(new three.BoxGeometry(0.36, 0.12, 0.04), materials.tinted),
    arms: layer(new three.BoxGeometry(0.1, 0.42, 0.1).translate(0, -0.21, 0), materials.robotBody),
    lights: layer(new three.SphereGeometry(0.08, 10, 8), materials.tinted),
    shadows: layer(new three.CircleGeometry(0.42, 16).rotateX(-Math.PI / 2), materials.shadow),
  };
}

function createRig(three: ThreeModule): Rig {
  const part = (x: number, y: number, z: number) => {
    const object = new three.Object3D();
    object.position.set(x, y, z);
    return object;
  };
  const root = part(0, 0, 0);
  const hip = part(0, 0.35, 0);
  const body = part(0, 0.3, 0);
  const head = part(0, 0.8, 0);
  const visor = part(0, 0.82, 0.21);
  const light = part(0, 1.18, 0);
  const armLeft = part(-0.34, 0.55, 0);
  const armRight = part(0.34, 0.55, 0);
  hip.add(body, head, visor, light, armLeft, armRight);
  root.add(hip);
  return { root, hip, body, head, visor, light, armLeft, armRight };
}

function truncate(context: CanvasRenderingContext2D, text: string, width: number): string {
  if (context.measureText(text).width <= width) return text;
  let cut = text;
  while (cut.length > 1 && context.measureText(`${cut}…`).width > width) cut = cut.slice(0, -1);
  return `${cut}…`;
}

function drawLabel(label: Label, text: string, palette: ScenePalette): void {
  const key = `${text}|${palette.label}|${palette.labelText}`;
  if (label.drawn === key) return;
  const context = label.canvas.getContext("2d");
  if (context === null) return;
  const { width, height } = LABEL_PIXELS;
  context.clearRect(0, 0, width, height);
  context.fillStyle = palette.label;
  context.beginPath();
  context.roundRect(4, 4, width - 8, height - 8, 28);
  context.fill();
  context.fillStyle = palette.labelText;
  context.font = "600 48px system-ui, -apple-system, sans-serif";
  context.textBaseline = "middle";
  context.fillText(truncate(context, text, width - 64), 32, height / 2);
  label.texture.needsUpdate = true;
  label.drawn = key;
}

export function createOfficeScene(options: OfficeSceneOptions): OfficeScene {
  const { three, container } = options;
  const canvas = document.createElement("canvas");
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  canvas.style.display = "block";
  canvas.style.touchAction = "none";
  container.appendChild(canvas);

  const renderer = new three.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: "low-power",
  });
  renderer.outputColorSpace = three.SRGBColorSpace;
  const scene = new three.Scene();
  const background: ColorLike = new three.Color(WHITE);
  scene.background = background;
  const camera: CameraLike = new three.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  const hemisphere = new three.HemisphereLight(WHITE, "#808080", 2.2);
  const sun = new three.DirectionalLight(WHITE, 1.2);
  sun.position.set(8, 20, 12);
  scene.add(hemisphere, sun);

  const materials = createMaterials(three);
  const world = new three.Group();
  scene.add(world);
  const layers = createLayers(three, world, materials);
  const groundGeometry = new three.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const ground = new three.Mesh(groundGeometry, materials.ground);
  ground.position.set(0, -0.01, 0);
  world.add(ground);
  const dummy = new three.Object3D();
  const rig = createRig(three);
  const tint = new three.Color(WHITE);
  const raycaster = new three.Raycaster();
  const pointer = new three.Vector2(0, 0);
  const labels = new Map<string, Label>();
  const labelRooms = new Map<Object3DLike, string>();

  let plan: ScenePlan = { rooms: [], robots: [], bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 } };
  const enteredAt = new Map<string, number>();
  let viewport: Viewport = { width: 0, height: 0 };
  let view: CameraView = { x: 0, z: 0, zoom: 1 };
  let easing: { from: CameraView; to: CameraView; start: number } | null = null;
  let framed = false;
  let pendingFocus: string | null = null;
  let onScreen = true;
  let visible = true;
  let disposed = false;
  let frameRequest: number | null = null;
  let typingTimer: ReturnType<typeof setTimeout> | null = null;

  function cancelFrames(): void {
    if (frameRequest !== null) cancelAnimationFrame(frameRequest);
    frameRequest = null;
    if (typingTimer !== null) clearTimeout(typingTimer);
    typingTimer = null;
  }

  function invalidate(): void {
    if (disposed || !visible || frameRequest !== null) return;
    frameRequest = requestAnimationFrame(frame);
  }

  function setView(next: CameraView): void {
    easing = null;
    view = next;
    invalidate();
  }

  function moveTo(next: CameraView): void {
    if (options.reducedMotion) {
      setView(next);
      return;
    }
    easing = { from: view, to: next, start: performance.now() };
    invalidate();
  }

  function applyCamera(now: number): boolean {
    if (easing !== null) {
      const progress = (now - easing.start) / CAMERA_EASE_MS;
      view = easeView(easing.from, easing.to, progress);
      if (progress >= 1) easing = null;
    }
    const position = cameraPosition(view);
    camera.position.set(position.x, position.y, position.z);
    camera.lookAt(view.x, 0, view.z);
    camera.zoom = view.zoom;
    camera.updateProjectionMatrix();
    return easing !== null;
  }

  function writeRooms(bounds: Bounds): void {
    const { floors, walls, boards } = layers;
    const count = plan.rooms.length;
    ensureCapacity(three, world, floors, count);
    ensureCapacity(three, world, boards, count);
    ensureCapacity(three, world, walls, count * 5);
    const sideWidth = (ROOM_WIDTH - DOOR_WIDTH) / 2;
    const y = WALL_HEIGHT / 2;
    plan.rooms.forEach((room, index) => {
      const { x, z } = room.center;
      floors.mesh.setMatrixAt(
        index,
        place(dummy, { x, y: 0, z, sx: ROOM_WIDTH, sz: ROOM_DEPTH }).matrixWorld,
      );
      boards.mesh.setMatrixAt(
        index,
        place(dummy, { x: room.board.x, y: 1.3, z: room.board.z }).matrixWorld,
      );
      const segments: Placement[] = [
        { x, y, z: z - ROOM_DEPTH / 2, sx: ROOM_WIDTH, sy: WALL_HEIGHT, sz: WALL_THICKNESS },
        { x: x - ROOM_WIDTH / 2, y, z, sx: WALL_THICKNESS, sy: WALL_HEIGHT, sz: ROOM_DEPTH },
        { x: x + ROOM_WIDTH / 2, y, z, sx: WALL_THICKNESS, sy: WALL_HEIGHT, sz: ROOM_DEPTH },
        {
          x: x - ROOM_WIDTH / 2 + sideWidth / 2,
          y,
          z: z + ROOM_DEPTH / 2,
          sx: sideWidth,
          sy: WALL_HEIGHT,
          sz: WALL_THICKNESS,
        },
        {
          x: x + ROOM_WIDTH / 2 - sideWidth / 2,
          y,
          z: z + ROOM_DEPTH / 2,
          sx: sideWidth,
          sy: WALL_HEIGHT,
          sz: WALL_THICKNESS,
        },
      ];
      segments.forEach((segment, offset) => {
        walls.mesh.setMatrixAt(index * 5 + offset, place(dummy, segment).matrixWorld);
      });
    });
    finishLayer(floors, count);
    finishLayer(boards, count);
    finishLayer(walls, count * 5);
    const width = bounds.maxX - bounds.minX + 40;
    const depth = bounds.maxZ - bounds.minZ + 40;
    ground.position.set((bounds.minX + bounds.maxX) / 2, -0.01, (bounds.minZ + bounds.maxZ) / 2);
    ground.scale.set(width, 1, depth);
  }

  function writeDesks(colors: ScenePalette): void {
    const { desks, monitors } = layers;
    const all = deskPlans(plan);
    ensureCapacity(three, world, desks, all.length);
    ensureCapacity(three, world, monitors, all.length);
    all.forEach((desk, index) => {
      desks.mesh.setMatrixAt(
        index,
        place(dummy, { x: desk.x, y: DESK_SIZE.height / 2, z: desk.z }).matrixWorld,
      );
      const screen = {
        x: desk.x + 0.22,
        y: DESK_SIZE.height + MONITOR_SIZE.height / 2 + 0.02,
        z: desk.z + 0.12,
      };
      monitors.mesh.setMatrixAt(index, place(dummy, screen).matrixWorld);
      monitors.mesh.setColorAt(
        index,
        tint.set(desk.screenLit ? colors.monitorLit : colors.monitorDim),
      );
    });
    finishLayer(desks, all.length);
    finishLayer(monitors, all.length);
  }

  function writeLabels(colors: ScenePalette): void {
    const seen = new Set<string>();
    for (const room of plan.rooms) {
      seen.add(room.roomId);
      let label = labels.get(room.roomId);
      if (!label) {
        const labelCanvas = document.createElement("canvas");
        labelCanvas.width = LABEL_PIXELS.width;
        labelCanvas.height = LABEL_PIXELS.height;
        const texture = new three.CanvasTexture(labelCanvas);
        texture.colorSpace = three.SRGBColorSpace;
        const material = new three.SpriteMaterial({
          map: texture,
          transparent: true,
          depthWrite: false,
        });
        const sprite = new three.Sprite(material);
        sprite.scale.set(LABEL_SIZE.width, LABEL_SIZE.height, 1);
        world.add(sprite);
        label = { sprite, texture, canvas: labelCanvas, drawn: "" };
        labels.set(room.roomId, label);
        labelRooms.set(sprite, room.roomId);
      }
      drawLabel(label, room.label, colors);
      label.sprite.position.set(room.labelAt.x, 0.7, room.labelAt.z);
    }
    for (const [roomId, label] of labels) {
      if (seen.has(roomId)) continue;
      world.remove(label.sprite);
      label.sprite.material.dispose();
      label.texture.dispose();
      labelRooms.delete(label.sprite);
      labels.delete(roomId);
    }
  }

  function writeRobot(robot: RobotPlan, index: number, now: number, lit: number): number {
    const { bodies, heads, visors, arms, lights, shadows } = layers;
    const motion = robotFrame(
      robot,
      enteredAt.get(robot.agentId) ?? now,
      now,
      options.reducedMotion,
    );
    rig.root.position.set(motion.x, motion.lift, motion.z);
    rig.root.rotation.set(0, motion.heading, 0);
    rig.hip.rotation.set(motion.lean, 0, 0);
    rig.armLeft.rotation.set(motion.armLeft, 0, 0);
    rig.armRight.rotation.set(motion.armRight, 0, 0);
    rig.root.updateMatrixWorld(true);
    bodies.mesh.setMatrixAt(index, rig.body.matrixWorld);
    heads.mesh.setMatrixAt(index, rig.head.matrixWorld);
    visors.mesh.setMatrixAt(index, rig.visor.matrixWorld);
    visors.mesh.setColorAt(index, tint.set(robot.visor));
    arms.mesh.setMatrixAt(index * 2, rig.armLeft.matrixWorld);
    arms.mesh.setMatrixAt(index * 2 + 1, rig.armRight.matrixWorld);
    shadows.mesh.setMatrixAt(
      index,
      place(dummy, { x: motion.x, y: 0.02, z: motion.z }).matrixWorld,
    );
    if (robot.light === null) return lit;
    lights.mesh.setMatrixAt(lit, rig.light.matrixWorld);
    lights.mesh.setColorAt(lit, tint.set(robot.light));
    return lit + 1;
  }

  function writeRobots(now: number): void {
    const { bodies, heads, visors, arms, lights, shadows } = layers;
    const count = plan.robots.length;
    for (const layer of [bodies, heads, visors, lights, shadows])
      ensureCapacity(three, world, layer, count);
    ensureCapacity(three, world, arms, count * 2);
    let lit = 0;
    plan.robots.forEach((robot, index) => {
      lit = writeRobot(robot, index, now, lit);
    });
    for (const layer of [bodies, heads, visors, shadows]) finishLayer(layer, count);
    finishLayer(arms, count * 2);
    finishLayer(lights, lit);
  }

  function draw(now: number): { easing: boolean; need: ReturnType<typeof animationNeed> } {
    const moving = applyCamera(now);
    writeRobots(now);
    renderer.render(scene, camera);
    return {
      easing: moving,
      need: animationNeed(plan.robots, enteredAt, now, options.reducedMotion),
    };
  }

  function frame(now: number): void {
    frameRequest = null;
    if (disposed || !visible) return;
    try {
      const result = draw(now);
      if (result.easing || result.need === "smooth") {
        invalidate();
      } else if (result.need === "typing" && typingTimer === null) {
        typingTimer = setTimeout(() => {
          typingTimer = null;
          invalidate();
        }, TYPING_FRAME_MS);
      }
    } catch (error) {
      console.error("[office] scene frame failed", error);
    }
  }

  function frameOffice(): void {
    if (framed || viewport.width === 0 || plan.rooms.length === 0) return;
    framed = true;
    view = frameBounds(plan.bounds, viewport);
    if (pendingFocus !== null) {
      const room = plan.rooms.find((candidate) => candidate.roomId === pendingFocus);
      if (room) view = focusOn(view, room.center);
      pendingFocus = null;
    }
  }

  function resizeToContainer(): void {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width === 0 || height === 0) return;
    viewport = { width, height };
    renderer.setPixelRatio(pixelRatioFor(window.devicePixelRatio || 1, options.coarsePointer));
    renderer.setSize(width, height, false);
    const frustum = frustumFor(viewport);
    camera.left = frustum.left;
    camera.right = frustum.right;
    camera.top = frustum.top;
    camera.bottom = frustum.bottom;
    frameOffice();
    invalidate();
  }

  function refreshVisible(): void {
    const next = onScreen && document.visibilityState === "visible";
    if (next === visible) return;
    visible = next;
    if (visible) invalidate();
    else cancelFrames();
  }

  function pick(clientX: number, clientY: number): void {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    pointer.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const robotHit = raycaster.intersectObjects([layers.bodies.mesh, layers.heads.mesh], false)[0];
    const robot = robotHit?.instanceId === undefined ? undefined : plan.robots[robotHit.instanceId];
    if (robot) {
      options.onSelectAgent(robot.agentId);
      return;
    }
    const labelHit = raycaster.intersectObjects([...labelRooms.keys()], false)[0];
    const roomId = labelHit ? labelRooms.get(labelHit.object) : undefined;
    if (roomId !== undefined) focusRoom(roomId);
  }

  const pointers = new Map<number, { x: number; y: number }>();
  let gesture: { startX: number; startY: number; moved: boolean; multi: boolean } | null = null;
  let pinchDistance: number | null = null;

  function spread(): number | null {
    const [first, second] = [...pointers.values()];
    return first && second ? Math.hypot(first.x - second.x, first.y - second.y) : null;
  }

  function onPointerDown(event: PointerEvent): void {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 1) {
      gesture = { startX: event.clientX, startY: event.clientY, moved: false, multi: false };
    } else if (gesture) {
      gesture.multi = true;
    }
    pinchDistance = pointers.size === 2 ? spread() : null;
  }

  function onPointerMove(event: PointerEvent): void {
    const last = pointers.get(event.pointerId);
    if (!last) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (
      gesture &&
      Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > TAP_SLOP_PX
    ) {
      gesture.moved = true;
    }
    if (pointers.size === 1 && gesture?.moved) {
      setView(panBy(view, event.clientX - last.x, event.clientY - last.y, viewport, plan.bounds));
      return;
    }
    const distance = pointers.size === 2 ? spread() : null;
    if (distance !== null && pinchDistance !== null && pinchDistance > 0) {
      setView(zoomBy(view, distance / pinchDistance));
      pinchDistance = distance;
    }
  }

  function onPointerUp(event: PointerEvent): void {
    pointers.delete(event.pointerId);
    if (gesture && pointers.size === 0) {
      if (!gesture.moved && !gesture.multi && event.type === "pointerup")
        pick(event.clientX, event.clientY);
      gesture = null;
    }
    pinchDistance = pointers.size === 2 ? spread() : null;
  }

  function onWheel(event: WheelEvent): void {
    event.preventDefault();
    setView(zoomBy(view, wheelFactor(event.deltaY)));
  }

  function onContextLost(event: Event): void {
    event.preventDefault();
    cancelFrames();
    options.onContextLost();
  }

  function onVisibility(): void {
    refreshVisible();
  }

  function focusRoom(roomId: string): void {
    const room = plan.rooms.find((candidate) => candidate.roomId === roomId);
    if (!room || !framed) {
      pendingFocus = roomId;
      return;
    }
    moveTo(focusOn(view, room.center));
  }

  const resizeObserver = new ResizeObserver(() => resizeToContainer());
  resizeObserver.observe(container);
  const intersectionObserver = new IntersectionObserver((entries) => {
    onScreen = entries.some((entry) => entry.isIntersecting);
    refreshVisible();
  });
  intersectionObserver.observe(container);
  document.addEventListener("visibilitychange", onVisibility);
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  canvas.addEventListener("webglcontextlost", onContextLost);
  resizeToContainer();

  return {
    update(nextPlan, nextPalette) {
      const now = performance.now();
      for (const robot of nextPlan.robots)
        if (!enteredAt.has(robot.agentId)) enteredAt.set(robot.agentId, now);
      const present = new Set(nextPlan.robots.map((robot) => robot.agentId));
      for (const agentId of enteredAt.keys()) if (!present.has(agentId)) enteredAt.delete(agentId);
      plan = nextPlan;
      applyPalette(materials, nextPalette);
      background.set(nextPalette.background);
      writeRooms(nextPlan.bounds);
      writeDesks(nextPalette);
      writeLabels(nextPalette);
      frameOffice();
      if (pendingFocus !== null && framed) focusRoom(pendingFocus);
      invalidate();
    },
    focusRoom(roomId) {
      focusRoom(roomId);
    },
    focusAgent(agentId) {
      const robot = plan.robots.find((candidate) => candidate.agentId === agentId);
      if (robot && framed) moveTo(focusOn(view, robot.seat));
    },
    dispose() {
      disposed = true;
      cancelFrames();
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      canvas.removeEventListener("wheel", onWheel);
      canvas.removeEventListener("webglcontextlost", onContextLost);
      for (const label of labels.values()) {
        label.sprite.material.dispose();
        label.texture.dispose();
      }
      labels.clear();
      labelRooms.clear();
      for (const layer of Object.values(layers)) {
        layer.mesh.dispose();
        layer.geometry.dispose();
      }
      groundGeometry.dispose();
      for (const material of Object.values(materials)) material.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
```

Notes for the implementer, each checked against the code above:

- `focusRoom` with a pending room: `update` calls `focusRoom(pendingFocus)` after framing; `frameOffice` already consumed the pending room when it framed in the same call, so this only fires for a focus requested after framing but before that room existed.
- `writeRobots` rewrites robot matrices on every frame (at most 200 robots, 9 instanced writes each); rooms, desks and labels are written only in `update`.
- A shared geometry (`flat`, `unitBox`) is disposed once per layer that uses it; `dispose()` on a disposed geometry is a no-op in three.js.
- If the lint `complexity` or `max-lines-per-function` rule (if enabled) flags `createOfficeScene`, move `writeRooms`, `writeDesks`, `writeLabels` and the pointer handlers into top-level functions that take a small context object `{ three, world, layers, dummy, tint }`; keep behaviour identical.

- [ ] **Step 6: Write the React host**

`plugins/office/client/scene/scene-view.tsx`:

```tsx
import { useCallback, useEffect, useId, useMemo, useRef, useSyncExternalStore } from "react";
import { Text, View } from "react-native";
import type { PluginTheme } from "@getpaseo/plugin";
import { useRpc } from "@getpaseo/plugin/client";
import { assetRpc } from "../../shared/contracts.js";
import { EMPTY_LAYOUT_MEMORY, layoutOffice, type LayoutMemory } from "../layout.js";
import type { OfficeModel } from "../model.js";
import type { OfficeStyles } from "../styles.js";
import { createOfficeScene, type OfficeScene } from "./office-scene.web.js";
import { scenePalette } from "./palette.js";
import { buildScenePlan } from "./scene-plan.js";
import { sharedThreeLoader } from "./three-loader.js";
import { evaluateModule, isCoarsePointer, prefersReducedMotion } from "./web-env.web.js";

export interface FocusRequest {
  agentId: string;
  /** Changes on every request, so selecting the same agent twice moves the camera again. */
  nonce: number;
}

export interface SceneViewProps {
  model: OfficeModel;
  theme: PluginTheme;
  styles: OfficeStyles;
  /** The workspace tab's room; the camera starts on it. */
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  onSelectAgent(agentId: string): void;
  /** three.js could not load, or the WebGL context was lost. */
  onProblem(message: string): void;
}

const subscribe = (listener: () => void) => sharedThreeLoader.subscribe(listener);
const read = () => sharedThreeLoader.state();

/** Web only (office-surface.tsx renders it only on web with WebGL2 and the 3D switch on). */
export function SceneView({
  model,
  theme,
  styles,
  focusRoomId,
  focusRequest,
  onSelectAgent,
  onProblem,
}: SceneViewProps) {
  const containerId = useId();
  const loadState = useSyncExternalStore(subscribe, read, read);
  const fetchAsset = useRpc(assetRpc);
  const sceneRef = useRef<OfficeScene | null>(null);
  const memoryRef = useRef<LayoutMemory>(EMPTY_LAYOUT_MEMORY);
  const handlers = useRef({ onSelectAgent, onProblem });
  const palette = useMemo(() => scenePalette(theme), [theme]);
  const environment = useMemo(
    () => ({ reducedMotion: prefersReducedMotion(), coarsePointer: isCoarsePointer() }),
    [],
  );

  useEffect(() => {
    handlers.current = { onSelectAgent, onProblem };
  }, [onSelectAgent, onProblem]);

  const fetchBytes = useCallback(() => fetchAsset({}), [fetchAsset]);
  useEffect(() => {
    void sharedThreeLoader.load({ fetchBytes, evaluate: evaluateModule });
  }, [fetchBytes]);

  useEffect(() => {
    if (loadState.status === "failed") handlers.current.onProblem(loadState.error);
  }, [loadState]);

  const three = loadState.status === "ready" ? loadState.three : null;
  useEffect(() => {
    if (three === null) return undefined;
    const container = document.getElementById(containerId);
    if (container === null) return undefined;
    let scene: OfficeScene;
    try {
      scene = createOfficeScene({
        three,
        container,
        ...environment,
        onSelectAgent: (agentId) => handlers.current.onSelectAgent(agentId),
        onContextLost: () => handlers.current.onProblem("The 3D view lost its graphics context"),
      });
    } catch (error) {
      handlers.current.onProblem(error instanceof Error ? error.message : String(error));
      return undefined;
    }
    sceneRef.current = scene;
    if (focusRoomId !== null) scene.focusRoom(focusRoomId);
    return () => {
      sceneRef.current = null;
      scene.dispose();
    };
  }, [three, containerId, environment, focusRoomId]);

  useEffect(() => {
    const scene = sceneRef.current;
    if (scene === null) return;
    const result = layoutOffice(model, memoryRef.current);
    memoryRef.current = result.memory;
    scene.update(buildScenePlan(model, result.layout, palette), palette);
  }, [model, palette, three]);

  useEffect(() => {
    if (focusRequest !== null) sceneRef.current?.focusAgent(focusRequest.agentId);
  }, [focusRequest]);

  return (
    <View nativeID={containerId} style={styles.scene}>
      {loadState.status === "ready" ? null : (
        <Text style={styles.sceneStatus}>Loading the 3D view...</Text>
      )}
    </View>
  );
}
```

Effect order matters: React runs effects in declaration order, so on the render where `three` becomes ready the scene is created first and the update effect (which lists `three` as a dependency for that reason) fills it in the same commit.

- [ ] **Step 7: Put the switch and the scene in the surface**

`plugins/office/client/office-surface.tsx` (replace the whole file):

```tsx
import { useCallback, useMemo, useState } from "react";
import { Platform, Switch, Text, View } from "react-native";
import {
  useSettings,
  type PluginScreenProps,
  type PluginWorkspacePanelProps,
} from "@getpaseo/plugin/client";
import { officeDeviceSettings } from "../shared/settings.js";
import { ActionButton } from "./action-button.js";
import { AgentCard } from "./agent-card.js";
import { AttentionStrip } from "./attention-strip.js";
import {
  buildOfficeModel,
  orderRoomsForFocus,
  type OfficeModel,
  type OfficeRoom,
} from "./model.js";
import { fakeOffice } from "./scene/fake-office.js";
import { SceneView, type FocusRequest } from "./scene/scene-view.js";
import { hasWebGL2 } from "./scene/web-env.web.js";
import { StructureView } from "./structure-view.js";
import { useOfficeStyles, type OfficeStyles } from "./styles.js";
import { useAgentActions, type AgentActions } from "./use-agent-actions.js";
import { useOffice, type OfficeState } from "./use-office.js";

export type OfficeSurfaceProps = PluginScreenProps | PluginWorkspacePanelProps;

interface ThreeDState {
  /** Web with WebGL2: the switch is shown. */
  available: boolean;
  on: boolean;
  toggle(next: boolean): void;
}

/** The per-device 3D switch. Off, and everywhere 3D is unavailable, three.js is never loaded. */
function useThreeD(): ThreeDState {
  const settings = useSettings(officeDeviceSettings);
  const available = useMemo(() => Platform.OS === "web" && hasWebGL2(), []);
  const ready = settings.status === "ready";
  const on = ready && settings.values.threeD;
  const revision = ready ? settings.revision : null;
  const { save } = settings;
  const toggle = useCallback(
    (next: boolean) => {
      if (revision !== null) void save({ threeD: next }, revision);
    },
    [save, revision],
  );
  return { available, on: available && on, toggle };
}

interface ThreeDSwitchProps {
  value: boolean;
  onChange(next: boolean): void;
  styles: OfficeStyles;
}

function ThreeDSwitch({ value, onChange, styles }: ThreeDSwitchProps) {
  return (
    <View style={styles.control}>
      <Text style={styles.controlLabel}>3D</Text>
      <Switch
        accessibilityLabel="3D view"
        value={value}
        onValueChange={onChange}
        trackColor={styles.switchTrack}
        thumbColor={styles.switchThumb}
      />
    </View>
  );
}

interface SceneProblemProps {
  message: string;
  onRetry(): void;
  styles: OfficeStyles;
}

function SceneProblem({ message, onRetry, styles }: SceneProblemProps) {
  return (
    <View style={styles.banner}>
      <Text style={styles.bannerText}>Unable to show the 3D view: {message}</Text>
      <View style={styles.actions}>
        <ActionButton
          label="Try 3D again"
          pendingLabel="Trying..."
          onPress={onRetry}
          styles={styles}
        />
      </View>
    </View>
  );
}

interface SurfaceBodyProps {
  office: OfficeState;
  rooms: readonly OfficeRoom[];
  sceneModel: OfficeModel | null;
  props: OfficeSurfaceProps;
  focusRoomId: string | null;
  focusRequest: FocusRequest | null;
  styles: OfficeStyles;
  actions: AgentActions;
  onSelectAgent(agentId: string): void;
  onSceneProblem(message: string): void;
}

function SurfaceBody({
  office,
  rooms,
  sceneModel,
  props,
  focusRoomId,
  focusRequest,
  styles,
  actions,
  onSelectAgent,
  onSceneProblem,
}: SurfaceBodyProps) {
  if (office.subscription.status === "error") {
    return (
      <Text accessibilityRole="alert" style={styles.error}>
        Unable to load the office: {office.subscription.error.message}
      </Text>
    );
  }
  if (!office.loaded) return <Text style={styles.sceneStatus}>Loading...</Text>;
  if (sceneModel !== null) {
    return (
      <SceneView
        model={sceneModel}
        theme={props.theme}
        styles={styles}
        focusRoomId={focusRoomId}
        focusRequest={focusRequest}
        onSelectAgent={onSelectAgent}
        onProblem={onSceneProblem}
      />
    );
  }
  return (
    <StructureView rooms={rooms} styles={styles} actions={actions} onSelectAgent={onSelectAgent} />
  );
}

/** One surface for both places: the sidebar screen and a workspace tab. */
export function OfficeSurface(props: OfficeSurfaceProps) {
  const { theme, layout, navigation } = props;
  const focusRoomId = "workspaceId" in props ? props.workspaceId : null;
  const styles = useOfficeStyles(theme, layout.compact);
  const office = useOffice();
  const actions = useAgentActions();
  const threeD = useThreeD();
  const model = useMemo(() => buildOfficeModel(office.state), [office.state]);
  const rooms = useMemo(
    () => orderRoomsForFocus(model.rooms, focusRoomId),
    [model.rooms, focusRoomId],
  );
  // Until the owner approves the look, the scene draws a fixed fake office.
  const fakeModel = useMemo(() => buildOfficeModel(fakeOffice()), []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sceneProblem, setSceneProblem] = useState<string | null>(null);
  const [focusRequest] = useState<FocusRequest | null>(null);
  const closeCard = useCallback(() => setSelectedId(null), []);
  const retryScene = useCallback(() => setSceneProblem(null), []);
  const showScene = threeD.on && sceneProblem === null;
  const selected = selectedId === null ? null : (model.agents.get(selectedId) ?? null);
  const selectedActivity = selectedId === null ? null : (office.state.activity[selectedId] ?? null);
  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        {threeD.available ? (
          <View style={styles.headerRow}>
            <ThreeDSwitch value={threeD.on} onChange={threeD.toggle} styles={styles} />
          </View>
        ) : null}
        <AttentionStrip entries={model.attention} styles={styles} onSelect={setSelectedId} />
      </View>
      {sceneProblem !== null && threeD.on ? (
        <SceneProblem message={sceneProblem} onRetry={retryScene} styles={styles} />
      ) : null}
      <SurfaceBody
        office={office}
        rooms={rooms}
        sceneModel={showScene ? fakeModel : null}
        props={props}
        focusRoomId={focusRoomId}
        focusRequest={focusRequest}
        styles={styles}
        actions={actions}
        onSelectAgent={setSelectedId}
        onSceneProblem={setSceneProblem}
      />
      <AgentCard
        agent={selected}
        activity={selectedActivity}
        actions={actions}
        navigation={navigation}
        styles={styles}
        onClose={closeCard}
      />
    </View>
  );
}
```

In this task a tap on a fake robot opens no card (fake ids are not in the live model); Task 18 wires live data and takes the fake office out of the surface.

- [ ] **Step 8: Typecheck, lint, format, and the built-in compile test**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/client
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/client
cd packages/server && flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: each exits 0. Where lint flags a rule, fix the cause the smallest way that keeps the behaviour (Global Constraints); never disable a rule inline. Known shapes: `useId` values contain `:`, which `document.getElementById` accepts.

- [ ] **Step 9: Verify first: the bundle carries no import expression and no three.js**

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npm run build:server
ls packages/server/dist/server/builtin-plugins/office/vendor/
```

Expected: `LICENSE-three  SOURCES.md  three.module.min.js`.

Then bundle the client entry the way the daemon does (`compiler-build.ts`: esbuild, `format: "cjs"`, `platform: "neutral"`, SDK and React external) and inspect the text:

```bash
cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock node -e '
require("esbuild").build({
  entryPoints: ["plugins/office/index.client.tsx"], bundle: true, write: false, format: "cjs",
  platform: "neutral", mainFields: ["browser", "module", "main"], jsx: "automatic", logLevel: "error",
  external: ["react", "react/jsx-runtime", "react-native", "@getpaseo/plugin", "@getpaseo/plugin/*", "@tanstack/react-query", "zod"],
}).then((result) => {
  const text = result.outputFiles[0].text;
  console.log(text.length < 200000, text.includes("\"return import(url);\""), text.includes("THREE.WebGLRenderer:"), /\bimport\(/.test(text.replaceAll("\"return import(url);\"", "")));
});'
```

Expected: `true true false false`: under 200 KB, the import sits only in its string, no three.js code (its renderer's log prefix `THREE.WebGLRenderer:` is absent), and no other `import(` survived. Anything else: STOP and report it; something pulls the vendored file or a dynamic import into the bundle.

- [ ] **Step 10: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/client/scene/fake-office.ts plugins/office/client/scene/fake-office.test.ts plugins/office/client/scene/office-scene.web.ts plugins/office/client/scene/scene-view.tsx plugins/office/client/office-surface.tsx
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office 3D scene on web, with fake data" -- plugins/office/client/scene/fake-office.ts plugins/office/client/scene/fake-office.test.ts plugins/office/client/scene/office-scene.web.ts plugins/office/client/scene/scene-view.tsx plugins/office/client/office-surface.tsx
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 17: Screenshot gate: the owner approves the look

Tier: standard.

The spec: "The user sees a screenshot with fake data before the rest of the scene is built." This task takes the screenshots and then STOPS until the owner answers. Nothing is committed.

**Files:**

- Create (git-ignored, for the owner): `/workspace/utils/paseo/.superpowers/screenshots/agent-office/phase-2/gate-*.png`, `/workspace/utils/paseo/.superpowers/screenshots/agent-office/phase-2/owner-answer.md`

**Interfaces:**

- Consumes: Task 16 (the scene with the fake office).
- Produces: the owner's answer, verbatim, in `owner-answer.md`; Task 19 takes it as input.

- [ ] **Step 1: Start the dev daemon and the web app**

```bash
ss -ltnp | grep -E ':(6768|8081) '
```

Expected: no output; otherwise stop and ask the controller. Then `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npm run build:server`, and start `npm run dev:server` and `npm run dev:app` as background commands. Never the daemon on 6767. Open `http://<container IP>:8081` in the Playwright browser and open the office from the sidebar. The 3D switch is on by default; wait until "Loading the 3D view..." is gone.

- [ ] **Step 2: Take the gate screenshots**

```bash
mkdir -p /workspace/utils/paseo/.superpowers/screenshots/agent-office/phase-2
```

Save with `browser_take_screenshot` into that folder:

1. `gate-phone-light.png` at 390 x 844, light theme, the whole office as first framed.
2. `gate-phone-dark.png` at 390 x 844, dark theme (Settings > Appearance), same view.
3. `gate-phone-room.png` at 390 x 844: tap the "main" room label so the camera centres on it, then capture (shows the typing, raised-hand and side-desk robots up close).
4. `gate-tablet.png` at 820 x 1180, light theme.
5. `gate-desktop.png` at 1440 x 900, light theme.

Also record, with `browser_evaluate`, `const c = document.querySelector("canvas"); [c.width, c.clientWidth, window.devicePixelRatio]` at 390 x 844, for the report.

- [ ] **Step 3: Stop what you started**

Stop the dev app and the dev daemon you started.

- [ ] **Step 4: STOP for the owner's approval**

Report to the controller: the five file paths, one line on what each shows, and the canvas sizes from Step 2. Then STOP. Do not start Task 18 or any later task until the controller relays the owner's answer.

When the answer arrives, write it verbatim into `/workspace/utils/paseo/.superpowers/screenshots/agent-office/phase-2/owner-answer.md` under a heading with the date. If the owner rejects the direction as a whole (not a list of changes), stop again and ask the controller how to proceed; do not start Task 18. Comments that ask for changes to colours, shapes, poses, motion or framing are applied in Task 19, after live data is wired in.

---

### Task 18: The scene on live data

Tier: standard.

**Files:**

- Modify: `plugins/office/client/office-surface.tsx`

**Interfaces:**

- Consumes: Task 16 `SceneView`, `FocusRequest`, the surface.
- Produces: the scene draws the live office model; a strip entry moves the camera to that robot and opens its card; a robot tap opens its card; a room label tap centres the room (inside the scene since Task 16); a workspace tab starts on its room (`focusRoomId`, since Task 16). `fake-office.ts` stays for its test and the look reviews.

- [ ] **Step 1: Switch the scene to the live model**

In `plugins/office/client/office-surface.tsx`:

Delete the import line:

```tsx
import { fakeOffice } from "./scene/fake-office.js";
```

Delete these two lines:

```tsx
// Until the owner approves the look, the scene draws a fixed fake office.
const fakeModel = useMemo(() => buildOfficeModel(fakeOffice()), []);
```

Replace

```tsx
const [focusRequest] = useState<FocusRequest | null>(null);
const closeCard = useCallback(() => setSelectedId(null), []);
```

with

```tsx
const [focusRequest, setFocusRequest] = useState<FocusRequest | null>(null);
const closeCard = useCallback(() => setSelectedId(null), []);
// The strip is the phone's fast path: it opens the card and moves the camera to the robot.
const selectFromStrip = useCallback((agentId: string) => {
  setSelectedId(agentId);
  setFocusRequest((previous) => ({ agentId, nonce: (previous?.nonce ?? 0) + 1 }));
}, []);
```

Replace

```tsx
<AttentionStrip entries={model.attention} styles={styles} onSelect={setSelectedId} />
```

with

```tsx
<AttentionStrip entries={model.attention} styles={styles} onSelect={selectFromStrip} />
```

Replace

```tsx
        sceneModel={showScene ? fakeModel : null}
```

with

```tsx
        sceneModel={showScene ? model : null}
```

- [ ] **Step 2: Typecheck, lint, format, and the fake office test**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/client/office-surface.tsx
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/client/office-surface.tsx
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/fake-office.test.ts --bail=1
grep -n "fakeOffice" plugins/office/client/office-surface.tsx || echo "no fake data in the surface"
```

Expected: exit 0 each; the last line prints `no fake data in the surface`.

- [ ] **Step 3: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/client/office-surface.tsx
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office scene draws live agents" -- plugins/office/client/office-surface.tsx
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 19: Phase 2 design polish: the 3D scene

Tier: most capable: Fable 5.2 (`claude-fable-5-2`). This task decides how the office looks.

Input: the owner's answer from Task 17 (`/workspace/utils/paseo/.superpowers/screenshots/agent-office/phase-2/owner-answer.md`). Every comment there is either applied here or listed in the report with the reason it could not be (for example, it needs a behaviour change). Then the scene gets its own design pass on live data. Presentation only: colours (through `scenePalette`, from theme tokens), shapes and sizes, light intensities, pose angles and motion timing, label drawing, the loading and problem states, the header's switch layout, and touch targets of at least 44 px. Never behaviour or contracts: no change to what a tap, drag, pinch, wheel or switch does, to the plan types, the camera rules, the loader, the RPCs or the performance rules in Task 16.

**Files:**

- Modify (presentation only): `plugins/office/client/scene/palette.ts`, `plugins/office/client/scene/scene-plan.ts` (only the pose and motion constants: `ARM_TYPING`, `ARM_UP`, lean, lift and bob values, `WALK_MS`, `TYPING_FRAME_MS`), `plugins/office/client/scene/office-scene.web.ts` (sizes, offsets, materials, light intensities, label drawing), `plugins/office/client/scene/camera.ts` (only `CAMERA_HEIGHT`, `CAMERA_BACK`, `VIEW_HEIGHT`, `FOCUS_ZOOM`, `CAMERA_EASE_MS`), `plugins/office/client/scene/scene-view.tsx` (loading state), `plugins/office/client/styles.ts`, `plugins/office/client/office-surface.tsx` (header and banner layout only)
- Tests that may change: `palette.test.ts`, `scene-plan.test.ts`, `camera.test.ts`, only where an expected value is one of the constants above and the constant changed. No assertion is removed or loosened; the pixel ratio caps (1.5 touch, 2 elsewhere) and `TAP_SLOP_PX` do not change.

**Interfaces:**

- Consumes: Tasks 12, 15, 16, 18.
- Produces: the same exports and signatures.

- [ ] **Step 1: Load the design skills and the house rules**

Invoke, with the Skill tool, `antislop`, `antislop-ui`, `antislop-layoutmobile` and `antislop-human`; `unslop` is loaded in Step 5. Read `docs/design.md` and `docs/unistyles.md` (token rules), and the owner's answer.

- [ ] **Step 2: Start the dev daemon and the web app**

```bash
ss -ltnp | grep -E ':(6768|8081) '
```

Expected: no output; otherwise stop and ask the controller. Then `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npm run build:server`, start `npm run dev:server` and `npm run dev:app` as background commands (never the daemon on 6767), and open `http://<container IP>:8081` in the Playwright browser (`hostname -I | awk '{print $1}'` gives the IP). The scene now shows live agents: use the ones that exist; before creating any, ask the controller (Task 10 Step 3 rule). For poses no live agent shows, compare against the gate screenshots.

- [ ] **Step 3: Take the before screenshots**

Into `/workspace/utils/paseo/.superpowers/screenshots/agent-office/phase-2/`: `before-polish-<width>-<theme>.png` at 390 x 844 (light and dark), 820 x 1180 (light) and 1440 x 900 (light), plus `before-polish-room-390.png` with the camera centred on the busiest room.

- [ ] **Step 4: Review, phone first**

List each finding in the task report (what, where, rule or owner comment). Check at least: every owner comment; robot readability at 390 px (a pose must be recognisable at first framing and at `FOCUS_ZOOM`); visor colours distinct from walls and floors in both themes; amber and red lights visible against both floors; room labels legible (contrast of `label` vs `labelText` with the `antislop-human` checker) and not covered by walls; glass walls not hiding robots; the 3D switch and the attention strip as 44 px touch targets; the "Loading the 3D view..." and problem banner states; motion (`antislop-ui` motion rules): typing and walking calm, nothing flashing.

- [ ] **Step 5: Apply, then a review pass**

Make the changes within the limits above. Then invoke `unslop` and run its review pass over the same screens; fix what it finds within the same limits.

- [ ] **Step 6: Take the after screenshots**

The same set as Step 3, named `after-polish-...`.

- [ ] **Step 7: Stop what you started**

Stop the dev app and the dev daemon you started.

- [ ] **Step 8: Typecheck, lint, format, affected tests**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/client
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/client
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/palette.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/scene-plan.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/camera.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/fake-office.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/layout.test.ts --bail=1
```

Expected: exit 0 each.

- [ ] **Step 9: Commit**

```bash
cd /workspace/utils/paseo
git status --short plugins/office
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/client/scene/palette.ts plugins/office/client/scene/palette.test.ts plugins/office/client/scene/scene-plan.ts plugins/office/client/scene/scene-plan.test.ts plugins/office/client/scene/office-scene.web.ts plugins/office/client/scene/camera.ts plugins/office/client/scene/camera.test.ts plugins/office/client/scene/scene-view.tsx plugins/office/client/styles.ts plugins/office/client/office-surface.tsx
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "style(fork): polish the office scene" -- plugins/office/client/scene/palette.ts plugins/office/client/scene/palette.test.ts plugins/office/client/scene/scene-plan.ts plugins/office/client/scene/scene-plan.test.ts plugins/office/client/scene/office-scene.web.ts plugins/office/client/scene/camera.ts plugins/office/client/scene/camera.test.ts plugins/office/client/scene/scene-view.tsx plugins/office/client/styles.ts plugins/office/client/office-surface.tsx
git log -1 --format='%an <%ae> | %cn <%ce>'
```

`git status --short plugins/office` must show changes only in the listed files; `git commit -- <paths>` commits the listed files that changed.

The task report lists each owner comment and what was done with it, every other change with its reason, findings left for the owner, and the before and after screenshot paths.

---

### Task 20: Phase 2 checkpoint: hand test and docs

Tier: standard.

**Files:**

- Modify: `docs/plugins.md` (the `office` paragraph from Task 10)

**Interfaces:**

- Consumes: everything from Tasks 11-19.
- Produces: evidence in the task report that Phase 2 works; the updated paragraph.

- [ ] **Step 1: Update the docs paragraph**

In `docs/plugins.md`, replace the sentence

```markdown
Design: [the spec](superpowers/specs/2026-11-11-agent-office-design.md).
```

at the end of the `office` paragraph with

```markdown
On web, with WebGL2, the office draws the same model as a small 3D office, one glass room per
workspace and one robot per agent whose pose shows its state; a per-device "3D" switch turns it
off. The 3D view loads the plugin's vendored three.js r170 (`plugins/office/vendor`) through the
`office.asset.request` RPC the first time it is shown on a page, evaluates it from a Blob URL, and
draws only while something moves; native clients, devices without WebGL2 and a lost graphics
context get the list. Design: [the spec](superpowers/specs/2026-11-11-agent-office-design.md).
```

- [ ] **Step 2: Start the dev daemon and the web app**

```bash
ss -ltnp | grep -E ':(6768|8081) '
```

Expected: no output; otherwise stop and ask the controller. Then `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npm run build:server`, start `npm run dev:server` and `npm run dev:app` as background commands (never the daemon on 6767), and open `http://<container IP>:8081` in the Playwright browser (`hostname -I | awk '{print $1}'` gives the IP). Agents needed: at least one running, one idle, one waiting on a tool permission, one child agent, and a workspace with no agents. Before creating or prompting any, tell the controller how many agents and turns you need and wait for the owner's yes; on no, run the checks the existing agents allow and mark the rest not run.

- [ ] **Step 3: Run the checks, phone first (390 x 844), then tablet (820 x 1180) and desktop (1440 x 900)**

Record pass or fail and one line of evidence for each:

1. On web, the header shows a "3D" switch, on by default; "Loading the 3D view..." gives way to the office.
2. Each live agent is a robot at a desk in its workspace's room; the lobby holds agents without a workspace; a child sits at the side desk next to its parent.
3. Poses: running types with its screen lit; idle leans back; a pending permission stands with a raised hand and an amber light; an error slumps with a red light; a new agent walks in from the door.
4. Drag pans; the mouse wheel zooms (desktop). Pinch zoom: mark "owner check on a phone" if the browser cannot emulate two touches.
5. Tapping a robot opens its card; tapping a room label centres that room.
6. Tapping a strip entry moves the camera to that robot and opens its card.
7. "Open office" from the Command Center in a workspace starts the camera on that workspace's room.
8. Switching 3D off shows the structure view; after a reload it is still off on this browser, and `document.querySelectorAll("canvas").length` is `0`. Switch it back on.
9. A quiet office draws nothing: with no running or starting agent visible, count frames for 3 s with `browser_evaluate` (`let n = 0; const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => { n += 1; return raf(cb); }; await new Promise((r) => setTimeout(r, 3000)); window.requestAnimationFrame = raf; n`), then repeat while an agent runs (expect about 60), and while the office tab is hidden behind another workspace (expect close to the quiet count). Record the three counts; the hidden and quiet counts must not grow with the number of running agents.
10. Context loss: `browser_evaluate` `document.querySelector("canvas").getContext("webgl2").getExtension("WEBGL_lose_context").loseContext()`: the structure view appears with "Unable to show the 3D view: The 3D view lost its graphics context" and "Try 3D again"; pressing it brings the 3D view back.
11. Reduced motion: emulate it (`browser_run_code_unsafe` with `await page.emulateMedia({ reducedMotion: "reduce" })`), reload: robots do not type or walk, states still show, the camera jumps when centring.
12. Dark theme: the scene follows it after a theme change.
13. Pixel ratio: `canvas.width / canvas.clientWidth` is at most 2 on desktop; on a coarse pointer it is at most 1.5 (mark "owner check on a phone" if the browser cannot emulate a coarse pointer).

- [ ] **Step 4: Stop what you started**

Stop the dev app and the dev daemon you started.

- [ ] **Step 5: Format and commit the docs**

```bash
cd /workspace/utils/paseo
npm run format:files -- docs/plugins.md
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add docs/plugins.md
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "docs(fork): the office's 3D view" -- docs/plugins.md
git log -1 --format='%an <%ae> | %cn <%ce>'
```

**Phase 2 checkpoint:** on web the office is a 3D scene of live agents that follows the theme, draws only while something moves, pauses when hidden, falls back to the structure view on any failure, and loads three.js only when shown. The owner approved the look at the gate and the polish applied their comments.

---

# Phase 3: boards, tools, wake

### Task 21: The board store: one writer, temp file then rename

Tier: standard.

**Files:**

- Create: `plugins/office/server/board-store.ts`
- Test: `plugins/office/server/board-store.test.ts`

**Interfaces:**

- Consumes: Task 3 `PostSchema`, `Post`, `errorMessage`.
- Produces:
  - `BoardsFileSchema` (zod), `interface BoardsFile { version: 1; nextSeq: number; wakesPaused: boolean; posts: Post[] }`, `EMPTY_BOARDS: BoardsFile`
  - `interface BoardStore { load(): Promise<BoardsFile>; save(data: BoardsFile): Promise<void> }`
  - `createBoardStore(options: { file: string; now(): number; log(message: string): void }): BoardStore`

Rules (spec "board-store.ts"): one writer at a time (saves run one after another, in call order); each save writes `<file>.tmp-<n>` and renames it over the file, so a crash leaves the old or the new file, never half of one; a missing file is an empty store; a file that does not parse, or parses to the wrong shape, is renamed to `<file>.corrupt-<ms>` and an empty store starts. `load` never rejects for a bad file; `save` rejects when the disk write fails (the caller decides).

- [ ] **Step 1: Write the failing test**

`plugins/office/server/board-store.test.ts`:

```ts
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test } from "vitest";
import type { Post } from "../shared/contracts.js";
import { EMPTY_BOARDS, createBoardStore, type BoardsFile } from "./board-store.js";

let directory = "";
let logs: string[] = [];

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "office-store-"));
  logs = [];
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function store(file = join(directory, "office", "boards.json")) {
  return createBoardStore({ file, now: () => 1700000000000, log: (message) => logs.push(message) });
}

function note(seq: number): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "lobby",
    kind: "note",
    text: `note ${seq}`,
    author: "user",
    createdAt: "2026-11-11T09:00:00.000Z",
    updatedAt: "2026-11-11T09:00:00.000Z",
  };
}

function data(seq: number): BoardsFile {
  return { version: 1, nextSeq: seq + 1, wakesPaused: false, posts: [note(seq)] };
}

test("a missing file is an empty store", async () => {
  expect(await store().load()).toEqual(EMPTY_BOARDS);
  expect(logs).toEqual([]);
});

test("what is saved loads back, and no temp file is left", async () => {
  const boards = store();
  await boards.save(data(1));
  expect(await store().load()).toEqual(data(1));
  expect(await readdir(join(directory, "office"))).toEqual(["boards.json"]);
});

test("concurrent saves run one at a time, in call order", async () => {
  const boards = store();
  await Promise.all([1, 2, 3, 4, 5].map((seq) => boards.save(data(seq))));
  expect(await store().load()).toEqual(data(5));
  expect(await readdir(join(directory, "office"))).toEqual(["boards.json"]);
});

test("a file that does not parse is moved aside and an empty store starts", async () => {
  const file = join(directory, "boards.json");
  await writeFile(file, "{ not json");
  expect(await store(file).load()).toEqual(EMPTY_BOARDS);
  expect((await readdir(directory)).sort()).toEqual(["boards.json.corrupt-1700000000000"]);
  expect(await readFile(join(directory, "boards.json.corrupt-1700000000000"), "utf8")).toBe(
    "{ not json",
  );
  expect(logs).toHaveLength(1);
});

test("a file with the wrong shape is moved aside too", async () => {
  const file = join(directory, "boards.json");
  await writeFile(file, JSON.stringify({ version: 2, posts: "none" }));
  expect(await store(file).load()).toEqual(EMPTY_BOARDS);
  expect(await readdir(directory)).toEqual(["boards.json.corrupt-1700000000000"]);
});

test("a failed save rejects and does not block the next one", async () => {
  const file = join(directory, "missing-parent-is-a-file", "boards.json");
  await writeFile(join(directory, "missing-parent-is-a-file"), "x");
  const blocked = store(file);
  await expect(blocked.save(data(1))).rejects.toThrow();
  await expect(blocked.save(data(2))).rejects.toThrow();
  const good = store();
  await good.save(data(3));
  expect(await good.load()).toEqual(data(3));
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/board-store.test.ts --bail=1`
Expected: FAIL, cannot resolve `./board-store.js`.

- [ ] **Step 3: Write the store**

`plugins/office/server/board-store.ts`:

```ts
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { z } from "zod";
import { PostSchema, type Post } from "../shared/contracts.js";
import { errorMessage } from "./errors.js";

export const BoardsFileSchema = z.object({
  version: z.literal(1),
  /** The next post or change gets this seq. */
  nextSeq: z.number().int().nonnegative(),
  wakesPaused: z.boolean(),
  posts: z.array(PostSchema),
});

export interface BoardsFile {
  version: 1;
  nextSeq: number;
  wakesPaused: boolean;
  posts: Post[];
}

export const EMPTY_BOARDS: BoardsFile = { version: 1, nextSeq: 1, wakesPaused: false, posts: [] };

export interface BoardStore {
  /** Never rejects for a missing or broken file; a broken one is moved aside. */
  load(): Promise<BoardsFile>;
  /** Runs after every earlier save; rejects when the write fails. */
  save(data: BoardsFile): Promise<void>;
}

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

function emptyBoards(): BoardsFile {
  return { ...EMPTY_BOARDS, posts: [] };
}

export function createBoardStore(options: {
  file: string;
  now(): number;
  log(message: string): void;
}): BoardStore {
  const { file, log } = options;
  let chain: Promise<void> = Promise.resolve();
  let temp = 0;

  async function moveAside(reason: string): Promise<void> {
    const target = `${file}.corrupt-${options.now()}`;
    log(`[office] ${file} is unreadable (${reason}); moved to ${target}, starting empty`);
    try {
      await rename(file, target);
    } catch (error) {
      log(`[office] unable to move ${file} aside: ${errorMessage(error)}`);
    }
  }

  async function write(data: BoardsFile): Promise<void> {
    temp += 1;
    const tempFile = `${file}.tmp-${temp}`;
    await mkdir(dirname(file), { recursive: true });
    try {
      await writeFile(tempFile, `${JSON.stringify(data)}\n`, "utf8");
      await rename(tempFile, file);
    } catch (error) {
      await rm(tempFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  return {
    async load() {
      let text: string;
      try {
        text = await readFile(file, "utf8");
      } catch (error) {
        if (isMissing(error)) return emptyBoards();
        log(`[office] unable to read ${file}: ${errorMessage(error)}`);
        return emptyBoards();
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch (error) {
        await moveAside(errorMessage(error));
        return emptyBoards();
      }
      const parsed = BoardsFileSchema.safeParse(json);
      if (!parsed.success) {
        await moveAside("unexpected shape");
        return emptyBoards();
      }
      return parsed.data;
    },
    save(data) {
      const run = chain.then(() => write(data));
      chain = run.catch(() => undefined);
      return run;
    },
  };
}
```

`BoardsFileSchema`'s output type equals `BoardsFile` (`version` is the literal `1`), so `parsed.data` needs no cast. A read error other than "missing" (permissions, a directory in the way) logs and starts empty without moving anything; the next save then reports its own error to the caller.

- [ ] **Step 4: Run the test to see it pass**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/board-store.test.ts --bail=1`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/server/board-store.ts plugins/office/server/board-store.test.ts
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/server/board-store.ts plugins/office/server/board-store.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/server/board-store.ts plugins/office/server/board-store.test.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office board store with one writer and atomic saves" -- plugins/office/server/board-store.ts plugins/office/server/board-store.test.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 22: The board service: posts, claims, limits

Tier: most capable.

**Files:**

- Modify: `plugins/office/server/timers.ts` (add `Clock` and `nodeClock`)
- Create: `plugins/office/server/board-service.ts`
- Test: `plugins/office/server/board-service.test.ts`

**Interfaces:**

- Consumes: Task 3 constants and types; Task 5 `Timers`, `nodeTimers`, `createFakeClock`; Task 21 `BoardStore`, `BoardsFile`, `EMPTY_BOARDS`.
- Produces:
  - In `timers.ts`: `interface Clock extends Timers { now(): number }`, `nodeClock: Clock`. (`FakeClock` already satisfies `Clock`.)
  - `interface NewPost { board: string; kind: PostKind; text: string; to?: string; author: string }`, `interface PostUpdate { id: string; action: UpdateAction; actor: string }`, `interface ReadResult { posts: Post[]; cursor: number; more: boolean }`
  - `interface BoardServicePorts { store: BoardStore; clock: Clock; log(message: string): void; label(author: string): string; onBoard(board: string, posts: readonly Post[]): void; onBoardRemoved(board: string): void }`
  - `interface BoardService { start(): Promise<void>; boards(): Record<string, Post[]>; wakesPaused(): boolean; post(input: NewPost): Promise<PostResult>; update(input: PostUpdate): Promise<PostResult>; remove(id: string): Promise<DeleteResult>; read(board: string, since: number | null): ReadResult; removeBoard(board: string): Promise<void>; setWakesPaused(paused: boolean): Promise<void>; prune(): Promise<void> }`
  - `trimBoard(posts: readonly Post[], max: number): Post[]`, `createBoardService(ports: BoardServicePorts): BoardService`

Rules: every create or change takes the next `seq` and sets `updatedAt`; text is trimmed and must be 1-2,000 characters; a board keeps at most 200 posts: when a post would exceed that, the oldest done tasks go first, then the oldest notes; open and claimed tasks are never dropped, so a board of 200 open or claimed tasks refuses the new post. Done tasks are removed 7 days after they were finished (`updatedAt`). Claiming a task claimed by another is refused with that claimer's name; claiming your own claim again is a no-op; a done task cannot be claimed; notes have no state. `reopen` clears the claimer. Mutations run one at a time and change memory only after the store saved; a failed save returns `Unable to save the board: ...` and leaves everything as it was. `setWakesPaused` rejects when the save fails. Who may delete is decided by the caller (only the user's RPC calls `remove`).

- [ ] **Step 1: Add the clock to the timers port**

Append to `plugins/office/server/timers.ts`:

```ts
export interface Clock extends Timers {
  now(): number;
}

export const nodeClock: Clock = {
  setTimeout: (run, ms) => nodeTimers.setTimeout(run, ms),
  now: () => Date.now(),
};
```

- [ ] **Step 2: Write the failing test**

`plugins/office/server/board-service.test.ts`:

```ts
import { expect, test } from "vitest";
import type { Post } from "../shared/contracts.js";
import { EMPTY_BOARDS, type BoardStore, type BoardsFile } from "./board-store.js";
import { createBoardService, trimBoard, type BoardService } from "./board-service.js";
import { createFakeClock, type FakeClock } from "./fake-clock.js";

const T0 = Date.parse("2026-11-11T09:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const NAMES = new Map([
  ["a", "Alice"],
  ["b", "Bob"],
]);

interface MemoryStore extends BoardStore {
  saved: BoardsFile[];
  failNext: boolean;
}

function memoryStore(initial: BoardsFile = EMPTY_BOARDS): MemoryStore {
  let current = initial;
  const store: MemoryStore = {
    saved: [],
    failNext: false,
    load: async () => current,
    save: async (data) => {
      if (store.failNext) {
        store.failNext = false;
        throw new Error("disk full");
      }
      current = data;
      store.saved.push(data);
    },
  };
  return store;
}

interface Harness {
  service: BoardService;
  store: MemoryStore;
  clock: FakeClock;
  events: string[];
}

async function harness(initial?: BoardsFile): Promise<Harness> {
  const store = memoryStore(initial);
  const clock = createFakeClock(T0);
  const events: string[] = [];
  const service = createBoardService({
    store,
    clock,
    log: (message) => events.push(`log ${message}`),
    label: (author) => NAMES.get(author) ?? author,
    onBoard: (board, posts) =>
      events.push(`board ${board} ${posts.map((post) => post.id).join(",")}`),
    onBoardRemoved: (board) => events.push(`removed ${board}`),
  });
  await service.start();
  return { service, store, clock, events };
}

function post(seq: number, fields: Partial<Post> = {}): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "w1",
    kind: "note",
    text: `post ${seq}`,
    author: "user",
    createdAt: new Date(T0 + seq * 1000).toISOString(),
    updatedAt: new Date(T0 + seq * 1000).toISOString(),
    ...fields,
  };
}

function file(posts: Post[]): BoardsFile {
  return { version: 1, nextSeq: posts.length + 1, wakesPaused: false, posts };
}

test("a post gets the next seq, an id, trimmed text and an open state", async () => {
  const { service, events } = await harness();
  const result = await service.post({
    board: "w1",
    kind: "task",
    text: "  Write tests  ",
    author: "a",
    to: "b",
  });
  expect(result).toEqual({
    ok: true,
    post: {
      id: "p1",
      seq: 1,
      board: "w1",
      kind: "task",
      text: "Write tests",
      author: "a",
      to: "b",
      state: "open",
      createdAt: "2026-11-11T09:00:00.000Z",
      updatedAt: "2026-11-11T09:00:00.000Z",
    },
  });
  expect(events).toEqual(["board w1 p1"]);
  expect(service.boards()).toEqual({ w1: [result.ok ? result.post : null] });
});

test("blank and overlong text is refused", async () => {
  const { service, store } = await harness();
  expect(await service.post({ board: "lobby", kind: "note", text: "   ", author: "user" })).toEqual(
    {
      ok: false,
      error: "Unable to post: the text is empty",
    },
  );
  expect(
    await service.post({ board: "lobby", kind: "note", text: "x".repeat(2001), author: "user" }),
  ).toEqual({
    ok: false,
    error: "Unable to post: the text is longer than 2,000 characters",
  });
  expect(store.saved).toEqual([]);
});

test("claim rules: one claimer, a repeat claim is a no-op, done cannot be claimed, reopen clears", async () => {
  const { service } = await harness();
  await service.post({ board: "w1", kind: "task", text: "Ship it", author: "user" });
  const claimed = await service.update({ id: "p1", action: "claim", actor: "a" });
  expect(claimed).toEqual({
    ok: true,
    post: expect.objectContaining({ state: "claimed", claimedBy: "a", seq: 2 }),
  });
  expect(await service.update({ id: "p1", action: "claim", actor: "b" })).toEqual({
    ok: false,
    error: "Unable to claim p1: claimed by Alice",
  });
  expect(await service.update({ id: "p1", action: "claim", actor: "a" })).toEqual(claimed);
  expect(await service.update({ id: "p1", action: "done", actor: "a" })).toEqual({
    ok: true,
    post: expect.objectContaining({ state: "done", claimedBy: "a", seq: 3 }),
  });
  expect(await service.update({ id: "p1", action: "claim", actor: "b" })).toEqual({
    ok: false,
    error: "Unable to claim p1: it is done",
  });
  const reopened = await service.update({ id: "p1", action: "reopen", actor: "b" });
  expect(reopened.ok && reopened.post).toEqual({
    id: "p1",
    seq: 4,
    board: "w1",
    kind: "task",
    text: "Ship it",
    author: "user",
    state: "open",
    createdAt: "2026-11-11T09:00:00.000Z",
    updatedAt: "2026-11-11T09:00:00.000Z",
  });
});

test("notes have no state, and unknown ids are refused", async () => {
  const { service } = await harness();
  await service.post({ board: "w1", kind: "note", text: "fyi", author: "a" });
  expect(await service.update({ id: "p1", action: "claim", actor: "b" })).toEqual({
    ok: false,
    error: "Unable to claim p1: it is a note",
  });
  expect(await service.update({ id: "p9", action: "done", actor: "b" })).toEqual({
    ok: false,
    error: "Unable to update p9: no such post",
  });
});

test("a full board drops its oldest done tasks, then its oldest notes", () => {
  const posts = [
    post(1, { kind: "note" }),
    post(2, { kind: "task", state: "done" }),
    post(3, { kind: "task", state: "open" }),
    post(4, { kind: "note" }),
  ];
  expect(trimBoard(posts, 3).map((item) => item.id)).toEqual(["p1", "p3", "p4"]);
  expect(trimBoard(posts, 2).map((item) => item.id)).toEqual(["p3", "p4"]);
  expect(trimBoard(posts, 1).map((item) => item.id)).toEqual(["p3"]);
});

test("a board of 200 open tasks refuses a new post; one with a note makes room", async () => {
  const open = Array.from({ length: 200 }, (_, index) =>
    post(index + 1, { kind: "task", state: "open" }),
  );
  const full = await harness(file(open));
  expect(
    await full.service.post({ board: "w1", kind: "note", text: "hi", author: "user" }),
  ).toEqual({
    ok: false,
    error: "Unable to post: the board holds 200 open or claimed tasks",
  });
  const withNote = await harness(file([post(1, { kind: "note" }), ...open.slice(1)]));
  const result = await withNote.service.post({
    board: "w1",
    kind: "note",
    text: "hi",
    author: "user",
  });
  expect(result.ok).toBe(true);
  expect(
    withNote.service
      .boards()
      .w1?.map((item) => item.id)
      .includes("p1"),
  ).toBe(false);
  expect(withNote.service.boards().w1).toHaveLength(200);
});

test("done tasks are removed 7 days after they were finished", async () => {
  const { service, clock } = await harness();
  await service.post({ board: "w1", kind: "task", text: "Old", author: "user" });
  await service.update({ id: "p1", action: "done", actor: "user" });
  clock.advance(7 * DAY);
  await service.prune();
  expect(service.boards().w1).toHaveLength(1);
  clock.advance(1);
  await service.prune();
  expect(service.boards()).toEqual({});
});

test("read returns the newest 30, or the next 30 after a cursor, newest last", async () => {
  const { service } = await harness(
    file(Array.from({ length: 40 }, (_, index) => post(index + 1))),
  );
  const first = service.read("w1", null);
  expect([
    first.posts[0]?.id,
    first.posts.at(-1)?.id,
    first.posts.length,
    first.cursor,
    first.more,
  ]).toEqual(["p11", "p40", 30, 40, false]);
  const paged = service.read("w1", 5);
  expect([paged.posts[0]?.id, paged.posts.at(-1)?.id, paged.cursor, paged.more]).toEqual([
    "p6",
    "p35",
    35,
    true,
  ]);
  expect(service.read("w1", 40)).toEqual({ posts: [], cursor: 40, more: false });
  expect(service.read("lobby", null)).toEqual({ posts: [], cursor: 0, more: false });
});

test("a failed save changes nothing and says so", async () => {
  const { service, store, events } = await harness();
  store.failNext = true;
  expect(await service.post({ board: "w1", kind: "note", text: "hi", author: "user" })).toEqual({
    ok: false,
    error: "Unable to save the board: disk full",
  });
  expect(service.boards()).toEqual({});
  expect(events).toEqual(["log [office] unable to save the board: disk full"]);
  expect((await service.post({ board: "w1", kind: "note", text: "hi", author: "user" })).ok).toBe(
    true,
  );
});

test("deleting a post, removing a board, and the persisted wake pause", async () => {
  const { service, store, events } = await harness();
  await service.post({ board: "w1", kind: "note", text: "one", author: "user" });
  await service.post({ board: "w2", kind: "note", text: "two", author: "user" });
  expect(await service.remove("p1")).toEqual({ ok: true });
  expect(await service.remove("p1")).toEqual({
    ok: false,
    error: "Unable to delete p1: no such post",
  });
  await service.removeBoard("w2");
  await service.removeBoard("w3");
  expect(service.boards()).toEqual({});
  expect(events.slice(-3)).toEqual(["board w1 ", "removed w2", "removed w3"]);
  await service.setWakesPaused(true);
  expect(service.wakesPaused()).toBe(true);
  expect(store.saved.at(-1)?.wakesPaused).toBe(true);
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/board-service.test.ts --bail=1`
Expected: FAIL, cannot resolve `./board-service.js`.

- [ ] **Step 4: Write the service**

`plugins/office/server/board-service.ts`:

```ts
import {
  BOARD_POST_MAX,
  DONE_TASK_TTL_MS,
  POST_TEXT_MAX,
  READ_POST_MAX,
  type DeleteResult,
  type Post,
  type PostKind,
  type PostResult,
  type UpdateAction,
} from "../shared/contracts.js";
import type { BoardStore, BoardsFile } from "./board-store.js";
import { errorMessage } from "./errors.js";
import type { Clock } from "./timers.js";

export interface NewPost {
  board: string;
  kind: PostKind;
  text: string;
  to?: string;
  /** An agent id, or "user". */
  author: string;
}

export interface PostUpdate {
  id: string;
  action: UpdateAction;
  actor: string;
}

export interface ReadResult {
  posts: Post[];
  /** The highest seq returned; pass it as `since` for newer posts only. */
  cursor: number;
  /** More posts after `cursor` than one read returns. */
  more: boolean;
}

export interface BoardServicePorts {
  store: BoardStore;
  clock: Clock;
  log(message: string): void;
  /** A readable name for an agent id or "user". */
  label(author: string): string;
  onBoard(board: string, posts: readonly Post[]): void;
  onBoardRemoved(board: string): void;
}

export interface BoardService {
  start(): Promise<void>;
  boards(): Record<string, Post[]>;
  wakesPaused(): boolean;
  post(input: NewPost): Promise<PostResult>;
  update(input: PostUpdate): Promise<PostResult>;
  remove(id: string): Promise<DeleteResult>;
  read(board: string, since: number | null): ReadResult;
  removeBoard(board: string): Promise<void>;
  setWakesPaused(paused: boolean): Promise<void>;
  prune(): Promise<void>;
}

type Outcome<T> = { ok: true; value: T } | { ok: false; error: string };

const VERBS: Record<UpdateAction, string> = { claim: "claim", done: "finish", reopen: "reopen" };

function byAge(left: Post, right: Post): number {
  return left.createdAt.localeCompare(right.createdAt) || left.seq - right.seq;
}

/** Drops the oldest done tasks, then the oldest notes, until `max` posts are left or none can go. */
export function trimBoard(posts: readonly Post[], max: number): Post[] {
  if (posts.length <= max) return [...posts];
  const done = posts.filter((item) => item.kind === "task" && item.state === "done").sort(byAge);
  const notes = posts.filter((item) => item.kind === "note").sort(byAge);
  const drop = new Set([...done, ...notes].slice(0, posts.length - max).map((item) => item.id));
  return posts.filter((item) => !drop.has(item.id));
}

function withoutClaim(post: Post): Post {
  const next: Post = {
    id: post.id,
    seq: post.seq,
    board: post.board,
    kind: post.kind,
    text: post.text,
    author: post.author,
    createdAt: post.createdAt,
    updatedAt: post.updatedAt,
  };
  if (post.to !== undefined) next.to = post.to;
  if (post.state !== undefined) next.state = post.state;
  return next;
}

export function createBoardService(ports: BoardServicePorts): BoardService {
  let data: BoardsFile = { version: 1, nextSeq: 1, wakesPaused: false, posts: [] };
  let chain: Promise<unknown> = Promise.resolve();

  function exclusive<T>(work: () => Promise<T>): Promise<T> {
    const run = chain.then(work);
    chain = run.catch(() => undefined);
    return run;
  }

  function postsOf(board: string, posts: readonly Post[] = data.posts): Post[] {
    return posts.filter((item) => item.board === board).sort((left, right) => left.seq - right.seq);
  }

  function now(): string {
    return new Date(ports.clock.now()).toISOString();
  }

  /** Saves `next`, then makes it current and announces the touched boards. */
  async function commit(next: BoardsFile, touched: readonly string[]): Promise<Outcome<null>> {
    try {
      await ports.store.save(next);
    } catch (error) {
      ports.log(`[office] unable to save the board: ${errorMessage(error)}`);
      return { ok: false, error: `Unable to save the board: ${errorMessage(error)}` };
    }
    data = next;
    for (const board of new Set(touched)) {
      try {
        ports.onBoard(board, postsOf(board));
      } catch (error) {
        ports.log(`[office] board listener failed: ${errorMessage(error)}`);
      }
    }
    return { ok: true, value: null };
  }

  function validText(text: string): Outcome<string> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return { ok: false, error: "Unable to post: the text is empty" };
    if (trimmed.length > POST_TEXT_MAX) {
      return { ok: false, error: "Unable to post: the text is longer than 2,000 characters" };
    }
    return { ok: true, value: trimmed };
  }

  async function createPost(input: NewPost): Promise<PostResult> {
    const text = validText(input.text);
    if (!text.ok) return text;
    const seq = data.nextSeq;
    const stamp = now();
    const created: Post = {
      id: `p${seq}`,
      seq,
      board: input.board,
      kind: input.kind,
      text: text.value,
      author: input.author,
      createdAt: stamp,
      updatedAt: stamp,
    };
    if (input.to !== undefined) created.to = input.to;
    if (input.kind === "task") created.state = "open";
    // Make room among the existing posts, so the new one is never the one dropped.
    const kept = trimBoard(postsOf(input.board), BOARD_POST_MAX - 1);
    if (kept.length >= BOARD_POST_MAX) {
      return { ok: false, error: "Unable to post: the board holds 200 open or claimed tasks" };
    }
    const others = data.posts.filter((item) => item.board !== input.board);
    const posts = [...others, ...kept, created];
    const saved = await commit({ ...data, nextSeq: seq + 1, posts }, [input.board]);
    return saved.ok ? { ok: true, post: created } : saved;
  }

  function nextState(post: Post, input: PostUpdate): Outcome<Post | null> {
    const refuse = (reason: string): Outcome<Post | null> => ({
      ok: false,
      error: `Unable to ${VERBS[input.action]} ${post.id}: ${reason}`,
    });
    if (post.kind !== "task") return refuse("it is a note");
    if (input.action === "claim") {
      if (post.state === "done") return refuse("it is done");
      if (post.state === "claimed" && post.claimedBy === input.actor)
        return { ok: true, value: null };
      if (post.state === "claimed" && post.claimedBy !== undefined) {
        return refuse(`claimed by ${ports.label(post.claimedBy)}`);
      }
      return { ok: true, value: { ...post, state: "claimed", claimedBy: input.actor } };
    }
    if (input.action === "done") {
      return post.state === "done"
        ? { ok: true, value: null }
        : { ok: true, value: { ...post, state: "done" } };
    }
    return { ok: true, value: { ...withoutClaim(post), state: "open" } };
  }

  async function updatePost(input: PostUpdate): Promise<PostResult> {
    const post = data.posts.find((item) => item.id === input.id);
    if (!post) return { ok: false, error: `Unable to update ${input.id}: no such post` };
    const next = nextState(post, input);
    if (!next.ok) return next;
    if (next.value === null) return { ok: true, post };
    const changed: Post = { ...next.value, seq: data.nextSeq, updatedAt: now() };
    const posts = data.posts.map((item) => (item.id === post.id ? changed : item));
    const saved = await commit({ ...data, nextSeq: data.nextSeq + 1, posts }, [post.board]);
    return saved.ok ? { ok: true, post: changed } : saved;
  }

  async function prunePosts(): Promise<void> {
    const cutoff = ports.clock.now() - DONE_TASK_TTL_MS;
    const expired = data.posts.filter(
      (item) =>
        item.kind === "task" && item.state === "done" && Date.parse(item.updatedAt) < cutoff,
    );
    if (expired.length === 0) return;
    const gone = new Set(expired.map((item) => item.id));
    const boards = expired.map((item) => item.board);
    await commit({ ...data, posts: data.posts.filter((item) => !gone.has(item.id)) }, boards);
  }

  return {
    // Queued like every mutation, so a post made while the file loads waits for it.
    start: () =>
      exclusive(async () => {
        data = await ports.store.load();
        await prunePosts();
      }),
    boards() {
      const grouped: Record<string, Post[]> = {};
      for (const board of new Set(data.posts.map((item) => item.board)))
        grouped[board] = postsOf(board);
      return grouped;
    },
    wakesPaused: () => data.wakesPaused,
    post: (input) => exclusive(() => createPost(input)),
    update: (input) => exclusive(() => updatePost(input)),
    remove: (id) =>
      exclusive(async (): Promise<DeleteResult> => {
        const post = data.posts.find((item) => item.id === id);
        if (!post) return { ok: false, error: `Unable to delete ${id}: no such post` };
        const posts = data.posts.filter((item) => item.id !== id);
        const saved = await commit({ ...data, posts }, [post.board]);
        return saved.ok ? { ok: true } : saved;
      }),
    read(board, since) {
      const posts = postsOf(board);
      if (since === null) {
        const page = posts.slice(-READ_POST_MAX);
        return { posts: page, cursor: page.at(-1)?.seq ?? 0, more: false };
      }
      const newer = posts.filter((item) => item.seq > since);
      const page = newer.slice(0, READ_POST_MAX);
      return { posts: page, cursor: page.at(-1)?.seq ?? since, more: newer.length > page.length };
    },
    removeBoard: (board) =>
      exclusive(async () => {
        const posts = data.posts.filter((item) => item.board !== board);
        if (posts.length !== data.posts.length) {
          const saved = await commit({ ...data, posts }, []);
          if (!saved.ok) return;
        }
        ports.onBoardRemoved(board);
      }),
    setWakesPaused: (paused) =>
      exclusive(async () => {
        const saved = await commit({ ...data, wakesPaused: paused }, []);
        if (!saved.ok) throw new Error(saved.error);
      }),
    prune: () => exclusive(prunePosts),
  };
}
```

Two expectations in the test follow from this code: deleting `p1` announces board `w1` with no posts (`"board w1 "`), and `removeBoard("w3")` on a board with no posts still announces the removal (the hub ignores boards it does not hold).

- [ ] **Step 5: Run the test to see it pass**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/board-service.test.ts --bail=1`
Expected: PASS, 10 tests.

- [ ] **Step 6: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/server/timers.ts plugins/office/server/board-service.ts plugins/office/server/board-service.test.ts
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/server/timers.ts plugins/office/server/board-service.ts plugins/office/server/board-service.test.ts
```

- [ ] **Step 7: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/server/timers.ts plugins/office/server/board-service.ts plugins/office/server/board-service.test.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office board service with claim rules and limits" -- plugins/office/server/timers.ts plugins/office/server/board-service.ts plugins/office/server/board-service.test.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 23: The mention queue: wake, batch, limit, pause

Tier: most capable.

**Files:**

- Create: `plugins/office/server/mention-queue.ts`
- Test: `plugins/office/server/mention-queue.test.ts`

**Interfaces:**

- Consumes: Task 3 `WAKES_PER_HOUR`, `WakeState`; Task 5 `createFakeClock`, `settle`; Task 22 `Clock`.
- Produces:
  - `WAKE_WINDOW_MS = 3600000`, `BUSY_RETRY_MS = 2000`, `BUSY_RETRIES = 3`
  - `type WakeTarget = "wakeable" | "busy" | "gone"`
  - `interface WakeSnapshotInput { status: string; archivedAt?: string | null; pendingPermissions: readonly unknown[] }`, `wakeTargetOf(agent: WakeSnapshotInput | null): WakeTarget`
  - `interface Delivery { postId: string; author: string; authorLabel: string; text: string }`, `wakePrompt(deliveries: readonly Delivery[]): string`
  - `interface MentionQueuePorts { clock: Clock; status(agentId: string): Promise<WakeTarget>; send(agentId: string, prompt: string): Promise<void>; log(message: string): void; onChange(state: WakeState): void }`
  - `interface MentionQueue { enqueue(agentId: string, delivery: Delivery): void; turnEnded(agentId: string): void; agentGone(agentId: string): void; setPaused(paused: boolean): void; state(): WakeState; stop(): void }`, `createMentionQueue(ports: MentionQueuePorts, paused: boolean): MentionQueue`

Rules (spec "Wake" and decision 2): a delivery for the post's own author is dropped; everything queued for one agent goes out as one prompt; a delivery is tried at once and again when the agent's turn ends; `wakeable` sends, `busy` retries every 2 s up to 3 times and then waits for the turn's end, `gone` drops the queue (the post stays on the board); at most 6 wakes per agent in any rolling hour, and over the limit one timer waits for the oldest wake to leave the hour; while paused nothing is sent and deliveries stay queued; unpausing tries every queued agent. A wake only calls `send`; it never answers a permission or changes a mode. Every timer goes through the injected clock; every async path catches and logs.

- [ ] **Step 1: Write the failing test**

`plugins/office/server/mention-queue.test.ts`:

```ts
import { expect, test } from "vitest";
import type { WakeState } from "../shared/contracts.js";
import { createFakeClock, settle, type FakeClock } from "./fake-clock.js";
import {
  BUSY_RETRY_MS,
  createMentionQueue,
  wakePrompt,
  wakeTargetOf,
  type Delivery,
  type MentionQueue,
  type WakeTarget,
} from "./mention-queue.js";

interface Harness {
  queue: MentionQueue;
  clock: FakeClock;
  targets: Map<string, WakeTarget>;
  sent: [string, string][];
  logs: string[];
  changes: WakeState[];
  statusCalls: string[];
  failSends: { count: number };
}

function harness(paused = false): Harness {
  const clock = createFakeClock(0);
  const targets = new Map<string, WakeTarget>([["b", "wakeable"]]);
  const sent: [string, string][] = [];
  const logs: string[] = [];
  const changes: WakeState[] = [];
  const statusCalls: string[] = [];
  const failSends = { count: 0 };
  const queue = createMentionQueue(
    {
      clock,
      status: async (agentId) => {
        statusCalls.push(agentId);
        return targets.get(agentId) ?? "gone";
      },
      send: async (agentId, prompt) => {
        if (failSends.count > 0) {
          failSends.count -= 1;
          throw new Error("agent is busy");
        }
        sent.push([agentId, prompt]);
      },
      log: (message) => logs.push(message),
      onChange: (state) => changes.push(state),
    },
    paused,
  );
  return { queue, clock, targets, sent, logs, changes, statusCalls, failSends };
}

function delivery(n: number, author = "a"): Delivery {
  return { postId: `p${n}`, author, authorLabel: `Agent ${author}`, text: `text ${n}` };
}

test("wake targets: idle or error wake, running or asking wait, closed or archived are gone", () => {
  expect(wakeTargetOf({ status: "idle", pendingPermissions: [] })).toBe("wakeable");
  expect(wakeTargetOf({ status: "error", pendingPermissions: [] })).toBe("wakeable");
  expect(wakeTargetOf({ status: "idle", pendingPermissions: [{}] })).toBe("busy");
  expect(wakeTargetOf({ status: "running", pendingPermissions: [] })).toBe("busy");
  expect(wakeTargetOf({ status: "initializing", pendingPermissions: [] })).toBe("busy");
  expect(wakeTargetOf({ status: "closed", pendingPermissions: [] })).toBe("gone");
  expect(
    wakeTargetOf({
      status: "idle",
      archivedAt: "2026-11-11T09:00:00.000Z",
      pendingPermissions: [],
    }),
  ).toBe("gone");
  expect(wakeTargetOf(null)).toBe("gone");
});

test("the prompt counts the posts and gives each id, author and text", () => {
  expect(
    wakePrompt([
      delivery(1),
      { ...delivery(2, "user"), authorLabel: "the user", text: "two\nlines" },
    ]),
  ).toBe(
    "Office board: 2 post(s) for you.\n- p1 from Agent a: text 1\n- p2 from the user: two\n  lines",
  );
});

test("an idle agent is woken at once", async () => {
  const { queue, sent, changes } = harness();
  queue.enqueue("b", delivery(1));
  await settle();
  expect(sent).toEqual([["b", "Office board: 1 post(s) for you.\n- p1 from Agent a: text 1"]]);
  expect(queue.state()).toEqual({ paused: false, queued: {} });
  expect(changes).toEqual([
    { paused: false, queued: { b: 1 } },
    { paused: false, queued: {} },
  ]);
});

test("a busy agent is retried 3 times, then everything goes out as one prompt when its turn ends", async () => {
  const { queue, clock, targets, sent, statusCalls } = harness();
  targets.set("b", "busy");
  queue.enqueue("b", delivery(1));
  queue.enqueue("b", delivery(2, "c"));
  await settle();
  for (let round = 0; round < 3; round += 1) {
    clock.advance(BUSY_RETRY_MS);
    await settle();
  }
  expect(sent).toEqual([]);
  expect(clock.pending()).toBe(0);
  expect(statusCalls).toEqual(["b", "b", "b", "b"]);
  targets.set("b", "wakeable");
  queue.turnEnded("b");
  await settle();
  expect(sent).toEqual([
    ["b", "Office board: 2 post(s) for you.\n- p1 from Agent a: text 1\n- p2 from Agent c: text 2"],
  ]);
});

test("an agent is never woken by its own post", async () => {
  const { queue, sent, changes } = harness();
  queue.enqueue("b", delivery(1, "b"));
  await settle();
  expect(sent).toEqual([]);
  expect(changes).toEqual([]);
});

test("a closed agent is not woken and its queue is dropped", async () => {
  const { queue, targets, sent } = harness();
  targets.set("b", "gone");
  queue.enqueue("b", delivery(1));
  await settle();
  expect(sent).toEqual([]);
  expect(queue.state()).toEqual({ paused: false, queued: {} });
});

test("at most 6 wakes per agent per rolling hour; the 7th waits for the oldest to leave the hour", async () => {
  const { queue, clock, sent } = harness();
  for (let n = 1; n <= 6; n += 1) {
    queue.enqueue("b", delivery(n));
    await settle();
    clock.advance(60_000);
  }
  expect(sent).toHaveLength(6);
  queue.enqueue("b", delivery(7));
  await settle();
  expect(sent).toHaveLength(6);
  expect(queue.state()).toEqual({ paused: false, queued: { b: 1 } });
  clock.advance(3_600_000 - 360_000 - 1);
  await settle();
  expect(sent).toHaveLength(6);
  clock.advance(1);
  await settle();
  expect(sent).toHaveLength(7);
});

test("pausing holds every delivery; unpausing sends what waited", async () => {
  const { queue, sent } = harness(true);
  queue.enqueue("b", delivery(1));
  await settle();
  expect(sent).toEqual([]);
  expect(queue.state()).toEqual({ paused: true, queued: { b: 1 } });
  queue.setPaused(false);
  await settle();
  expect(sent).toHaveLength(1);
  expect(queue.state()).toEqual({ paused: false, queued: {} });
});

test("a failed send is logged, kept, and retried", async () => {
  const { queue, clock, sent, logs, failSends } = harness();
  failSends.count = 1;
  queue.enqueue("b", delivery(1));
  await settle();
  expect(sent).toEqual([]);
  expect(logs).toEqual(["[office] unable to wake b: agent is busy"]);
  expect(queue.state().queued).toEqual({ b: 1 });
  clock.advance(BUSY_RETRY_MS);
  await settle();
  expect(sent).toHaveLength(1);
});

test("stop cancels every timer and sends nothing more", async () => {
  const { queue, clock, targets, sent } = harness();
  targets.set("b", "busy");
  queue.enqueue("b", delivery(1));
  await settle();
  queue.stop();
  expect(clock.pending()).toBe(0);
  targets.set("b", "wakeable");
  queue.turnEnded("b");
  await settle();
  expect(sent).toEqual([]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/mention-queue.test.ts --bail=1`
Expected: FAIL, cannot resolve `./mention-queue.js`.

- [ ] **Step 3: Write the queue**

`plugins/office/server/mention-queue.ts`:

```ts
import { WAKES_PER_HOUR, type WakeState } from "../shared/contracts.js";
import { errorMessage } from "./errors.js";
import type { Clock } from "./timers.js";

export const WAKE_WINDOW_MS = 60 * 60 * 1000;
export const BUSY_RETRY_MS = 2000;
export const BUSY_RETRIES = 3;

export type WakeTarget = "wakeable" | "busy" | "gone";

/** The part of an agent snapshot that decides whether it can be woken (AgentSnapshotPayload fits). */
export interface WakeSnapshotInput {
  status: string;
  archivedAt?: string | null;
  pendingPermissions: readonly unknown[];
}

export function wakeTargetOf(agent: WakeSnapshotInput | null): WakeTarget {
  if (agent === null || agent.archivedAt || agent.status === "closed") return "gone";
  if (agent.pendingPermissions.length > 0) return "busy";
  return agent.status === "idle" || agent.status === "error" ? "wakeable" : "busy";
}

export interface Delivery {
  postId: string;
  /** An agent id, or "user". */
  author: string;
  /** How the prompt names the author, e.g. "Review MR (agent 1a2b3c4d)". */
  authorLabel: string;
  text: string;
}

/** Spec: `Office board: <n> post(s) for you.` then one line per post with its id, author and text. */
export function wakePrompt(deliveries: readonly Delivery[]): string {
  const lines = deliveries.map(
    (delivery) =>
      `- ${delivery.postId} from ${delivery.authorLabel}: ${delivery.text.replaceAll("\n", "\n  ")}`,
  );
  return [`Office board: ${deliveries.length} post(s) for you.`, ...lines].join("\n");
}

export interface MentionQueuePorts {
  clock: Clock;
  status(agentId: string): Promise<WakeTarget>;
  send(agentId: string, prompt: string): Promise<void>;
  log(message: string): void;
  onChange(state: WakeState): void;
}

export interface MentionQueue {
  enqueue(agentId: string, delivery: Delivery): void;
  /** From agent.turn.after: the agent may be idle now. */
  turnEnded(agentId: string): void;
  /** From agent.close.after and agent.archive.after. */
  agentGone(agentId: string): void;
  setPaused(paused: boolean): void;
  state(): WakeState;
  stop(): void;
}

export function createMentionQueue(ports: MentionQueuePorts, paused: boolean): MentionQueue {
  const queues = new Map<string, Delivery[]>();
  const wakes = new Map<string, number[]>();
  const retries = new Map<string, number>();
  const timers = new Map<string, () => void>();
  const inFlight = new Set<string>();
  let isPaused = paused;
  let stopped = false;

  function state(): WakeState {
    const queued: Record<string, number> = {};
    for (const [agentId, list] of queues) if (list.length > 0) queued[agentId] = list.length;
    return { paused: isPaused, queued };
  }

  function changed(): void {
    try {
      ports.onChange(state());
    } catch (error) {
      ports.log(`[office] wake listener failed: ${errorMessage(error)}`);
    }
  }

  function clearTimer(agentId: string): void {
    timers.get(agentId)?.();
    timers.delete(agentId);
  }

  function schedule(agentId: string, ms: number): void {
    clearTimer(agentId);
    const cancel = ports.clock.setTimeout(() => {
      timers.delete(agentId);
      attempt(agentId);
    }, ms);
    timers.set(agentId, cancel);
  }

  function recentWakes(agentId: string): number[] {
    const cutoff = ports.clock.now() - WAKE_WINDOW_MS;
    const recent = (wakes.get(agentId) ?? []).filter((at) => at > cutoff);
    wakes.set(agentId, recent);
    return recent;
  }

  function retryLater(agentId: string): void {
    const count = (retries.get(agentId) ?? 0) + 1;
    retries.set(agentId, count);
    if (count <= BUSY_RETRIES) schedule(agentId, BUSY_RETRY_MS);
  }

  async function targetOf(agentId: string): Promise<WakeTarget> {
    try {
      return await ports.status(agentId);
    } catch (error) {
      ports.log(`[office] unable to read the state of ${agentId}: ${errorMessage(error)}`);
      return "busy";
    }
  }

  async function wake(agentId: string): Promise<void> {
    const target = await targetOf(agentId);
    if (stopped || isPaused) return;
    if (target === "gone") {
      queues.delete(agentId);
      retries.delete(agentId);
      clearTimer(agentId);
      changed();
      return;
    }
    if (target === "busy") {
      retryLater(agentId);
      return;
    }
    const batch = queues.get(agentId) ?? [];
    if (batch.length === 0) return;
    queues.delete(agentId);
    try {
      await ports.send(agentId, wakePrompt(batch));
    } catch (error) {
      ports.log(`[office] unable to wake ${agentId}: ${errorMessage(error)}`);
      queues.set(agentId, [...batch, ...(queues.get(agentId) ?? [])]);
      retryLater(agentId);
      return;
    }
    wakes.set(agentId, [...recentWakes(agentId), ports.clock.now()]);
    retries.delete(agentId);
    changed();
  }

  async function deliver(agentId: string): Promise<void> {
    if (stopped || isPaused || inFlight.has(agentId)) return;
    if ((queues.get(agentId) ?? []).length === 0) return;
    const recent = recentWakes(agentId);
    if (recent.length >= WAKES_PER_HOUR) {
      const oldest = recent[0] ?? ports.clock.now();
      schedule(agentId, oldest + WAKE_WINDOW_MS - ports.clock.now());
      return;
    }
    inFlight.add(agentId);
    try {
      await wake(agentId);
    } finally {
      inFlight.delete(agentId);
    }
  }

  function attempt(agentId: string): void {
    deliver(agentId).catch((error: unknown) => {
      ports.log(`[office] wake of ${agentId} failed: ${errorMessage(error)}`);
    });
  }

  return {
    enqueue(agentId, delivery) {
      if (stopped || delivery.author === agentId) return;
      queues.set(agentId, [...(queues.get(agentId) ?? []), delivery]);
      changed();
      attempt(agentId);
    },
    turnEnded(agentId) {
      retries.delete(agentId);
      attempt(agentId);
    },
    agentGone(agentId) {
      clearTimer(agentId);
      retries.delete(agentId);
      if (queues.delete(agentId)) changed();
    },
    setPaused(next) {
      isPaused = next;
      changed();
      if (!next) for (const agentId of [...queues.keys()]) attempt(agentId);
    },
    state,
    stop() {
      stopped = true;
      for (const cancel of timers.values()) cancel();
      timers.clear();
    },
  };
}
```

Checked against the tests: the failed send re-queues and schedules one retry (`retryLater`), and `changed()` is not called on that path because the queue count is unchanged; the busy test makes 4 status calls (the first try and 3 retries) and leaves no timer; the limit test's 7th wake fires exactly when the first wake (at 0) leaves the hour (at 3,600,000), because `recentWakes` keeps only wakes after `now - WAKE_WINDOW_MS`.

- [ ] **Step 4: Run the test to see it pass**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/mention-queue.test.ts --bail=1`
Expected: PASS, 10 tests.

- [ ] **Step 5: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/server/mention-queue.ts plugins/office/server/mention-queue.test.ts
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/server/mention-queue.ts plugins/office/server/mention-queue.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/server/mention-queue.ts plugins/office/server/mention-queue.test.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office wake queue with batching, hourly limit and pause" -- plugins/office/server/mention-queue.ts plugins/office/server/mention-queue.test.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 24: The three agent tools

Tier: standard.

**Files:**

- Create: `plugins/office/server/agent-tools.ts`
- Test: `plugins/office/server/agent-tools.test.ts`

**Interfaces:**

- Consumes: `defineAgentTool`, `AgentToolDefinition`, `AgentToolResult`, `PluginHookAgent` (`@getpaseo/plugin/server`); Task 3 `LOBBY`, `POST_TEXT_MAX`, `PostKindSchema`, `UpdateActionSchema`, `Post`; Task 22 `BoardService`, `ReadResult`, `createBoardService`; Task 21 `EMPTY_BOARDS`; Task 5 `createFakeClock`.
- Produces:
  - `type ToolAgent = Pick<PluginHookAgent, "id" | "workspaceId" | "title">`
  - `interface OfficeToolPorts { service: BoardService; mentioned(post: Post): void; seen(agent: ToolAgent): void; label(author: string): string }`
  - `ReadInputSchema`, `PostInputSchema`, `UpdateInputSchema` (zod), and their output types `ReadInput`, `PostInput`, `UpdateInput`
  - `boardFor(agent: Pick<ToolAgent, "workspaceId">, choice: "room" | "lobby" | undefined): string`
  - `postLine(post: Post, label: (author: string) => string): string`, `readText(board: string, result: ReadResult, label: (author: string) => string): string`
  - `runRead(ports: OfficeToolPorts, agent: ToolAgent, input: ReadInput): AgentToolResult`, `runPost(...): Promise<AgentToolResult>`, `runUpdate(...): Promise<AgentToolResult>`
  - `officeTools(ports: OfficeToolPorts): AgentToolDefinition[]` (`office_read`, `office_post`, `office_update`)

The spec's table, exactly: `office_read` takes `board?` (`"room"` default, `"lobby"`) and `since?`, and returns up to 30 posts as compact text, newest last, with a cursor; `office_post` takes `kind`, `text`, `to?`, `board?` and returns the post id, waking `to`; `office_update` takes `id` and `action` and returns the post's new state, refusing a claim on another agent's task with its name. "room" is the caller's workspace board; an agent without a workspace uses the lobby. Descriptions stay short because every session pays for them. The tool runtime already parses input with the tool's schema and turns a thrown error into an `isError` result (`packages/server/src/server/plugins/agent-tools.ts`, `call`); the `run*` functions take parsed input and are tested directly.

- [ ] **Step 1: Write the failing test**

`plugins/office/server/agent-tools.test.ts`:

```ts
import { expect, test } from "vitest";
import type { Post } from "../shared/contracts.js";
import {
  boardFor,
  officeTools,
  postLine,
  runPost,
  runRead,
  runUpdate,
  type OfficeToolPorts,
  type ToolAgent,
} from "./agent-tools.js";
import { createBoardService } from "./board-service.js";
import { EMPTY_BOARDS, type BoardStore } from "./board-store.js";
import { createFakeClock } from "./fake-clock.js";

const ALICE: ToolAgent = { id: "a", workspaceId: "w1", title: "Alice" };
const BOB: ToolAgent = { id: "b", workspaceId: "w1", title: "Bob" };
const LONER: ToolAgent = { id: "c", workspaceId: null, title: null };

function memoryStore(): BoardStore {
  let current = EMPTY_BOARDS;
  return {
    load: async () => current,
    save: async (data) => {
      current = data;
    },
  };
}

interface Harness {
  ports: OfficeToolPorts;
  mentions: string[];
  seen: string[];
}

async function harness(): Promise<Harness> {
  const names = new Map<string, string>([["user", "the user"]]);
  const mentions: string[] = [];
  const seen: string[] = [];
  const label = (author: string) => names.get(author) ?? author;
  const service = createBoardService({
    store: memoryStore(),
    clock: createFakeClock(Date.parse("2026-11-11T09:00:00.000Z")),
    log: () => undefined,
    label,
    onBoard: () => undefined,
    onBoardRemoved: () => undefined,
  });
  await service.start();
  const ports: OfficeToolPorts = {
    service,
    mentioned: (post) => mentions.push(`${post.id}->${post.to ?? ""}`),
    seen: (agent) => {
      seen.push(agent.id);
      if (agent.title) names.set(agent.id, agent.title);
    },
    label,
  };
  return { ports, mentions, seen };
}

test("room is the caller's workspace; no workspace or lobby means the lobby", () => {
  expect(boardFor(ALICE, undefined)).toBe("w1");
  expect(boardFor(ALICE, "room")).toBe("w1");
  expect(boardFor(ALICE, "lobby")).toBe("lobby");
  expect(boardFor(LONER, "room")).toBe("lobby");
});

test("a post line names kind, state, claimer, author and target", () => {
  const post: Post = {
    id: "p3",
    seq: 5,
    board: "w1",
    kind: "task",
    text: "Write tests",
    author: "a",
    to: "b",
    state: "claimed",
    claimedBy: "b",
    createdAt: "2026-11-11T09:00:00.000Z",
    updatedAt: "2026-11-11T09:00:00.000Z",
  };
  const names = new Map([
    ["a", "Alice"],
    ["b", "Bob"],
  ]);
  expect(postLine(post, (author) => names.get(author) ?? author)).toBe(
    "p3 task claimed by Bob, from Alice to Bob: Write tests",
  );
});

test("posting returns the id, wakes the named agent, and the board reads back", async () => {
  const { ports, mentions, seen } = await harness();
  expect(await runPost(ports, ALICE, { kind: "task", text: "Write tests", to: "b" })).toEqual({
    text: "Posted p1. b is woken with it when idle.",
    structuredContent: { id: "p1" },
  });
  expect(mentions).toEqual(["p1->b"]);
  expect(seen).toEqual(["a"]);
  expect(runRead(ports, BOB, {})).toEqual({
    text: "Board w1: 1 post(s), cursor 1.\np1 task open, from Alice to Bob: Write tests",
  });
  expect(runRead(ports, BOB, { since: 1 })).toEqual({ text: "Board w1: 0 post(s), cursor 1." });
});

test("a post to yourself or to nobody wakes nobody", async () => {
  const { ports, mentions } = await harness();
  expect(
    await runPost(ports, ALICE, { kind: "note", text: "Lint is green", board: "lobby" }),
  ).toEqual({
    text: "Posted p1.",
    structuredContent: { id: "p1" },
  });
  expect(await runPost(ports, ALICE, { kind: "note", text: "Note to self", to: "a" })).toEqual({
    text: "Posted p2.",
    structuredContent: { id: "p2" },
  });
  expect(mentions).toEqual(["p1->", "p2->a"]);
  expect(runRead(ports, LONER, {}).text).toBe(
    "Board lobby: 1 post(s), cursor 1.\np1 note, from Alice: Lint is green",
  );
});

test("claiming another agent's task is refused with its name", async () => {
  const { ports } = await harness();
  await runPost(ports, ALICE, { kind: "task", text: "Ship it" });
  expect(await runUpdate(ports, BOB, { id: "p1", action: "claim" })).toEqual({
    text: "p1 task claimed by Bob, from Alice: Ship it",
  });
  expect(await runUpdate(ports, ALICE, { id: "p1", action: "claim" })).toEqual({
    text: "Unable to claim p1: claimed by Bob",
    isError: true,
  });
  expect(await runUpdate(ports, BOB, { id: "p1", action: "done" })).toEqual({
    text: "p1 task done by Bob, from Alice: Ship it",
  });
});

test("the three tools are named and their inputs follow the spec", async () => {
  const { ports } = await harness();
  const tools = officeTools(ports);
  expect(tools.map((tool) => tool.name)).toEqual(["office_read", "office_post", "office_update"]);
  const [read, post, update] = tools;
  expect(read?.input.safeParse({ board: "room", since: 4 }).success).toBe(true);
  expect(read?.input.safeParse({ board: "kitchen" }).success).toBe(false);
  expect(post?.input.safeParse({ kind: "task", text: "x".repeat(2001) }).success).toBe(false);
  expect(update?.input.safeParse({ id: "p1", action: "close" }).success).toBe(false);
  for (const tool of tools) expect(tool.description.length).toBeLessThan(200);
});
```

`seen` records the caller and its title, so an agent is labelled by name once it has called a tool: the post result still names `b` by id, and Bob's read, which records Bob first, names him. In the composition (Task 25) labels also come from the directory and the hook payloads.

- [ ] **Step 2: Run it to see it fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/agent-tools.test.ts --bail=1`
Expected: FAIL, cannot resolve `./agent-tools.js`.

- [ ] **Step 3: Write the tools**

`plugins/office/server/agent-tools.ts`:

```ts
import {
  defineAgentTool,
  type AgentToolDefinition,
  type AgentToolResult,
  type PluginHookAgent,
} from "@getpaseo/plugin/server";
import { z } from "zod";
import {
  LOBBY,
  POST_TEXT_MAX,
  PostKindSchema,
  UpdateActionSchema,
  type Post,
} from "../shared/contracts.js";
import type { BoardService, ReadResult } from "./board-service.js";

export type ToolAgent = Pick<PluginHookAgent, "id" | "workspaceId" | "title">;

export interface OfficeToolPorts {
  service: BoardService;
  /** Queues the wake of the post's `to`, if any (the queue drops a post to its own author). */
  mentioned(post: Post): void;
  /** Remembers the caller's title for labels. */
  seen(agent: ToolAgent): void;
  label(author: string): string;
}

const BoardChoiceSchema = z.enum(["room", "lobby"]);

export const ReadInputSchema = z.object({
  board: BoardChoiceSchema.optional(),
  since: z.number().int().nonnegative().optional(),
});
export type ReadInput = z.output<typeof ReadInputSchema>;

export const PostInputSchema = z.object({
  kind: PostKindSchema,
  text: z.string().min(1).max(POST_TEXT_MAX),
  to: z.string().min(1).optional(),
  board: BoardChoiceSchema.optional(),
});
export type PostInput = z.output<typeof PostInputSchema>;

export const UpdateInputSchema = z.object({ id: z.string().min(1), action: UpdateActionSchema });
export type UpdateInput = z.output<typeof UpdateInputSchema>;

/** "room" is the caller's workspace board; without a workspace it is the lobby. */
export function boardFor(
  agent: Pick<ToolAgent, "workspaceId">,
  choice: "room" | "lobby" | undefined,
): string {
  return choice === "lobby" || agent.workspaceId === null ? LOBBY : agent.workspaceId;
}

export function postLine(post: Post, label: (author: string) => string): string {
  const state = post.state ? ` ${post.state}` : "";
  const claim = post.claimedBy ? ` by ${label(post.claimedBy)}` : "";
  const to = post.to ? ` to ${label(post.to)}` : "";
  return `${post.id} ${post.kind}${state}${claim}, from ${label(post.author)}${to}: ${post.text}`;
}

export function readText(
  board: string,
  result: ReadResult,
  label: (author: string) => string,
): string {
  const more = result.more ? ", more after it" : "";
  const header = `Board ${board}: ${result.posts.length} post(s), cursor ${result.cursor}${more}.`;
  return [header, ...result.posts.map((post) => postLine(post, label))].join("\n");
}

export function runRead(
  ports: OfficeToolPorts,
  agent: ToolAgent,
  input: ReadInput,
): AgentToolResult {
  ports.seen(agent);
  const board = boardFor(agent, input.board);
  return { text: readText(board, ports.service.read(board, input.since ?? null), ports.label) };
}

export async function runPost(
  ports: OfficeToolPorts,
  agent: ToolAgent,
  input: PostInput,
): Promise<AgentToolResult> {
  ports.seen(agent);
  const result = await ports.service.post({
    board: boardFor(agent, input.board),
    kind: input.kind,
    text: input.text,
    author: agent.id,
    ...(input.to === undefined ? {} : { to: input.to }),
  });
  if (!result.ok) return { text: result.error, isError: true };
  ports.mentioned(result.post);
  const target = result.post.to;
  const wake =
    target !== undefined && target !== agent.id
      ? ` ${ports.label(target)} is woken with it when idle.`
      : "";
  return { text: `Posted ${result.post.id}.${wake}`, structuredContent: { id: result.post.id } };
}

export async function runUpdate(
  ports: OfficeToolPorts,
  agent: ToolAgent,
  input: UpdateInput,
): Promise<AgentToolResult> {
  ports.seen(agent);
  const result = await ports.service.update({
    id: input.id,
    action: input.action,
    actor: agent.id,
  });
  if (!result.ok) return { text: result.error, isError: true };
  return { text: postLine(result.post, ports.label) };
}

export function officeTools(ports: OfficeToolPorts): AgentToolDefinition[] {
  return [
    defineAgentTool({
      name: "office_read",
      description:
        "Read your workspace's office board (or board: lobby). Up to 30 posts, newest last, and a cursor; pass it as since for newer posts only.",
      input: ReadInputSchema,
      execute: (input, { agent }) => runRead(ports, agent, input),
    }),
    defineAgentTool({
      name: "office_post",
      description:
        "Post a task or note to your workspace's office board (or board: lobby). Set to to an agent id from list_agents to wake it with the post.",
      input: PostInputSchema,
      execute: (input, { agent }) => runPost(ports, agent, input),
    }),
    defineAgentTool({
      name: "office_update",
      description: "Claim, finish (done) or reopen a task on an office board, by post id.",
      input: UpdateInputSchema,
      execute: (input, { agent }) => runUpdate(ports, agent, input),
    }),
  ];
}
```

The claim test: Bob claims `p1` (posted by Alice, who is labelled by name because `seen` recorded her title), and Bob's own title is recorded when he calls, so the result reads "claimed by Bob".

- [ ] **Step 4: Run the test to see it pass**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/agent-tools.test.ts --bail=1`
Expected: PASS, 6 tests.

- [ ] **Step 5: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/server/agent-tools.ts plugins/office/server/agent-tools.test.ts
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/server/agent-tools.ts plugins/office/server/agent-tools.test.ts
```

- [ ] **Step 6: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/server/agent-tools.ts plugins/office/server/agent-tools.test.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office_read, office_post and office_update agent tools" -- plugins/office/server/agent-tools.ts plugins/office/server/agent-tools.test.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 25: Server wiring: boards, RPCs, hooks, the host setting

Tier: most capable.

**Files:**

- Create: `plugins/office/server/office.ts`
- Test: `plugins/office/server/office.test.ts`
- Modify: `plugins/office/server/live-ports.ts` (add `liveAgentPorts`)
- Modify: `plugins/office/index.server.ts` (whole file below)

**Interfaces:**

- Consumes: Task 3 contracts and `officeHostSettings`, `boardsFile`; Task 6 `Hub`, `createHub`, `PaseoHolder`, `liveHubPorts`; Task 13 `readThreeAsset`; Tasks 21-24.
- Produces:
  - `PRUNE_INTERVAL_MS = 3600000`
  - `interface OfficeAgentPorts { status(agentId: string): Promise<WakeTarget>; send(agentId: string, prompt: string): Promise<void> }`
  - `type OfficeHub = Pick<Hub, "setBoards" | "setBoard" | "removeBoard" | "setWake">`
  - `interface OfficeDeps { store: BoardStore; clock: Clock; hub: OfficeHub; agents: OfficeAgentPorts; log(message: string): void }`
  - `interface Office { ready: Promise<void>; tools: AgentToolDefinition[]; noteAgent(agent: ToolAgent): void; post(input: { board: string; kind: PostKind; text: string; to?: string }): Promise<PostResult>; update(input: { id: string; action: UpdateAction }): Promise<PostResult>; remove(id: string): Promise<DeleteResult>; setWakesPaused(paused: boolean): Promise<WakeState>; turnEnded(agentId: string): void; agentGone(agentId: string): void; workspaceArchived(workspaceId: string): Promise<void>; stop(): void }`, `createOffice(deps: OfficeDeps): Office`
  - `wakeAuthorLabel(author: string, title: string | undefined): string`
  - `liveAgentPorts(holder: PaseoHolder): OfficeAgentPorts`

The composition: the board service announces each changed board to the hub; a post with `to` (from the user or a tool) is queued for that agent with an author label the prompt can quote (`the user`, or `<title> (<agent id>)` so the woken agent can answer with `to`); the queue's state goes to the hub; the pause switch is saved in `boards.json` and applied to the queue; done tasks are pruned on start and every hour; an archived workspace's board is removed. The hooks: `agent.open.before` adds the three tools to interactive sessions while the host setting `agentTools` is on; `agent.turn.after` tells the queue the agent may be idle; `agent.close.after` and `agent.archive.after` drop its queue; `workspace.archive.after` removes the board. Every hook, RPC and timer catches its own errors.

- [ ] **Step 1: Verify first: what `refresh()` does for a closed or unknown agent, and which sessions get plugin tools**

```bash
cd /workspace/utils/paseo
grep -n "refresh(requestId" -A25 packages/client/src/index.ts | grep -n "return\|throw\|null" | head -20
sed -n 3355,3380p packages/server/src/server/agent/tools/paseo-tools.ts
grep -n "registerPluginTools\|function createPaseoMcpServer\|isPaseoToolEnabled\|paseoToolPolicy" packages/server/src/server/agent/tools/paseo-tools.ts | head -20
```

Record in the task report:

1. Whether `PaseoAgentHandle.refresh()` resolves `null` or rejects for an unknown, closed or archived agent. If it rejects with a recognisable "not found" error, make `liveAgentPorts().status` return `"gone"` for that error (keep `"busy"` for any other failure, as the queue's `targetOf` does), and add one line saying so in the report. If it resolves `null`, the code below already maps it to `"gone"`.
2. Whether plugin tools reach a session only through Paseo's own agent MCP server (`registerPluginTools` inside `paseo-tools.ts`, filtered by `isPaseoToolEnabled`), so an agent whose provider has Paseo's tools off, or whose policy hides `office_*`, does not get the office tools. The plan does not change that; Task 29 documents what you find, in one sentence.

- [ ] **Step 2: Write the failing test**

`plugins/office/server/office.test.ts`:

```ts
import { expect, test } from "vitest";
import type { Post, WakeState } from "../shared/contracts.js";
import { EMPTY_BOARDS, type BoardStore, type BoardsFile } from "./board-store.js";
import { createFakeClock, settle } from "./fake-clock.js";
import { PRUNE_INTERVAL_MS, createOffice, wakeAuthorLabel, type OfficeHub } from "./office.js";
import type { WakeTarget } from "./mention-queue.js";

interface RecordingHub extends OfficeHub {
  events: string[];
}

function recordingHub(): RecordingHub {
  const events: string[] = [];
  return {
    events,
    setBoards: (boards) => events.push(`boards ${Object.keys(boards).join(",")}`),
    setBoard: (board, posts: readonly Post[]) => events.push(`board ${board} ${posts.length}`),
    removeBoard: (board) => events.push(`removed ${board}`),
    setWake: (wake: WakeState) => events.push(`wake ${wake.paused} ${JSON.stringify(wake.queued)}`),
  };
}

function memoryStore(initial: BoardsFile = EMPTY_BOARDS): BoardStore & { current(): BoardsFile } {
  let current = initial;
  return {
    current: () => current,
    load: async () => current,
    save: async (data) => {
      current = data;
    },
  };
}

function setup(initial?: BoardsFile) {
  const clock = createFakeClock(Date.parse("2026-11-11T09:00:00.000Z"));
  const hub = recordingHub();
  const store = memoryStore(initial);
  const targets = new Map<string, WakeTarget>([["b", "wakeable"]]);
  const prompts: string[] = [];
  const office = createOffice({
    store,
    clock,
    hub,
    agents: {
      status: async (agentId) => targets.get(agentId) ?? "gone",
      send: async (agentId, prompt) => {
        prompts.push(`${agentId}: ${prompt}`);
      },
    },
    log: () => undefined,
  });
  return { office, clock, hub, store, targets, prompts };
}

test("author labels name the user, or the agent's title and id", () => {
  expect(wakeAuthorLabel("user", undefined)).toBe("the user");
  expect(wakeAuthorLabel("a1", "Review MR")).toBe("Review MR (a1)");
  expect(wakeAuthorLabel("a1", undefined)).toBe("agent a1");
});

test("on start the hub gets the boards and the wake state", async () => {
  const { office, hub } = setup();
  await office.ready;
  expect(hub.events).toEqual(["boards ", "wake false {}"]);
});

test("a user post that names an agent lands on the board and wakes it", async () => {
  const { office, hub, prompts } = setup();
  await office.ready;
  expect((await office.post({ board: "w1", kind: "task", text: "Review this", to: "b" })).ok).toBe(
    true,
  );
  await settle();
  expect(prompts).toEqual(["b: Office board: 1 post(s) for you.\n- p1 from the user: Review this"]);
  expect(hub.events.slice(2)).toEqual(["board w1 1", 'wake false {"b":1}', "wake false {}"]);
});

test("an agent's tool post is labelled with its title and id", async () => {
  const { office, prompts } = setup();
  await office.ready;
  const post = office.tools.find((tool) => tool.name === "office_post");
  office.noteAgent({ id: "a", workspaceId: "w1", title: "Planner" });
  await post?.execute(
    { kind: "note", text: "Your turn", to: "b" },
    {
      agent: {
        id: "a",
        workspaceId: "w1",
        parentAgentId: null,
        provider: "claude",
        cwd: "/",
        title: "Planner",
        metadata: {},
      },
      paseo: undefined,
      signal: new AbortController().signal,
    },
  );
  await settle();
  expect(prompts).toEqual([
    "b: Office board: 1 post(s) for you.\n- p1 from Planner (a): Your turn",
  ]);
});

test("pausing is saved and holds wakes until resumed", async () => {
  const { office, store, prompts } = setup();
  await office.ready;
  expect(await office.setWakesPaused(true)).toEqual({ paused: true, queued: {} });
  expect(store.current().wakesPaused).toBe(true);
  await office.post({ board: "w1", kind: "note", text: "Later", to: "b" });
  await settle();
  expect(prompts).toEqual([]);
  expect(await office.setWakesPaused(false)).toEqual({ paused: false, queued: { b: 1 } });
  await settle();
  expect(prompts).toHaveLength(1);
});

test("an archived workspace loses its board; done tasks are pruned every hour", async () => {
  const { office, hub, clock, store } = setup();
  await office.ready;
  await office.post({ board: "w1", kind: "note", text: "one" });
  await office.workspaceArchived("w1");
  expect(hub.events.at(-1)).toBe("removed w1");
  await office.post({ board: "w2", kind: "task", text: "two" });
  await office.update({ id: "p2", action: "done" });
  clock.advance(7 * 24 * 60 * 60 * 1000);
  await settle();
  expect(store.current().posts).toHaveLength(1);
  clock.advance(PRUNE_INTERVAL_MS);
  await settle();
  expect(store.current().posts).toEqual([]);
  office.stop();
  expect(clock.pending()).toBe(0);
});
```

The tool test passes `paseo: undefined` in the tool context; the office tools never read it, and test files are outside the plugins typecheck.

- [ ] **Step 3: Run it to see it fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/office.test.ts --bail=1`
Expected: FAIL, cannot resolve `./office.js`.

- [ ] **Step 4: Write the composition**

`plugins/office/server/office.ts`:

```ts
import type { AgentToolDefinition } from "@getpaseo/plugin/server";
import {
  USER_AUTHOR,
  type DeleteResult,
  type Post,
  type PostKind,
  type PostResult,
  type UpdateAction,
  type WakeState,
} from "../shared/contracts.js";
import { officeTools, type ToolAgent } from "./agent-tools.js";
import { createBoardService } from "./board-service.js";
import type { BoardStore } from "./board-store.js";
import { errorMessage } from "./errors.js";
import type { Hub } from "./hub.js";
import { createMentionQueue, type MentionQueue, type WakeTarget } from "./mention-queue.js";
import type { Clock } from "./timers.js";

export const PRUNE_INTERVAL_MS = 60 * 60 * 1000;

export interface OfficeAgentPorts {
  status(agentId: string): Promise<WakeTarget>;
  send(agentId: string, prompt: string): Promise<void>;
}

export type OfficeHub = Pick<Hub, "setBoards" | "setBoard" | "removeBoard" | "setWake">;

export interface OfficeDeps {
  store: BoardStore;
  clock: Clock;
  hub: OfficeHub;
  agents: OfficeAgentPorts;
  log(message: string): void;
}

export interface Office {
  /** Settles once boards.json is loaded; never rejects (a failure is logged). */
  ready: Promise<void>;
  tools: AgentToolDefinition[];
  noteAgent(agent: ToolAgent): void;
  post(input: { board: string; kind: PostKind; text: string; to?: string }): Promise<PostResult>;
  update(input: { id: string; action: UpdateAction }): Promise<PostResult>;
  remove(id: string): Promise<DeleteResult>;
  setWakesPaused(paused: boolean): Promise<WakeState>;
  turnEnded(agentId: string): void;
  agentGone(agentId: string): void;
  workspaceArchived(workspaceId: string): Promise<void>;
  stop(): void;
}

/** How a wake prompt names a post's author; the id lets the woken agent answer with `to`. */
export function wakeAuthorLabel(author: string, title: string | undefined): string {
  if (author === USER_AUTHOR) return "the user";
  return title ? `${title} (${author})` : `agent ${author}`;
}

export function createOffice(deps: OfficeDeps): Office {
  const { clock, hub, log } = deps;
  const titles = new Map<string, string>();
  let queue: MentionQueue | null = null;
  let stopped = false;
  let cancelPrune: (() => void) | null = null;

  const label = (author: string) =>
    author === USER_AUTHOR ? "the user" : (titles.get(author) ?? author);

  const service = createBoardService({
    store: deps.store,
    clock,
    log,
    label,
    onBoard: (board, posts) => hub.setBoard(board, posts),
    onBoardRemoved: (board) => hub.removeBoard(board),
  });

  function noteAgent(agent: ToolAgent): void {
    const title = agent.title?.trim();
    if (title) titles.set(agent.id, title);
  }

  function mentioned(post: Post): void {
    if (post.to === undefined || queue === null) return;
    queue.enqueue(post.to, {
      postId: post.id,
      author: post.author,
      authorLabel: wakeAuthorLabel(post.author, titles.get(post.author)),
      text: post.text,
    });
  }

  function schedulePrune(): void {
    if (stopped) return;
    cancelPrune = clock.setTimeout(() => {
      cancelPrune = null;
      service
        .prune()
        .catch((error: unknown) => log(`[office] prune failed: ${errorMessage(error)}`))
        .finally(schedulePrune);
    }, PRUNE_INTERVAL_MS);
  }

  const ready = service
    .start()
    .then(() => {
      if (stopped) return;
      queue = createMentionQueue(
        {
          clock,
          status: (agentId) => deps.agents.status(agentId),
          send: (agentId, prompt) => deps.agents.send(agentId, prompt),
          log,
          onChange: (wake) => hub.setWake(wake),
        },
        service.wakesPaused(),
      );
      hub.setBoards(service.boards());
      hub.setWake(queue.state());
      schedulePrune();
    })
    .catch((error: unknown) => log(`[office] unable to start the boards: ${errorMessage(error)}`));

  async function requireQueue(): Promise<MentionQueue> {
    await ready;
    if (queue === null) throw new Error("The office boards did not start");
    return queue;
  }

  return {
    ready,
    tools: officeTools({ service, mentioned, seen: noteAgent, label }),
    noteAgent,
    async post(input) {
      await ready;
      const result = await service.post({ ...input, author: USER_AUTHOR });
      if (result.ok) mentioned(result.post);
      return result;
    },
    async update(input) {
      await ready;
      return service.update({ ...input, actor: USER_AUTHOR });
    },
    async remove(id) {
      await ready;
      return service.remove(id);
    },
    async setWakesPaused(paused) {
      const wakeQueue = await requireQueue();
      await service.setWakesPaused(paused);
      wakeQueue.setPaused(paused);
      return wakeQueue.state();
    },
    turnEnded(agentId) {
      queue?.turnEnded(agentId);
    },
    agentGone(agentId) {
      queue?.agentGone(agentId);
    },
    async workspaceArchived(workspaceId) {
      await ready;
      await service.removeBoard(workspaceId);
    },
    stop() {
      stopped = true;
      cancelPrune?.();
      cancelPrune = null;
      queue?.stop();
    },
  };
}
```

Checked against the test: the hub sees `boards ` (no boards yet) and `wake false {}` on start; a user post to `b` gives `board w1 1`, then the queue's `wake false {"b":1}` and, after the send, `wake false {}`; `setWakesPaused(false)` returns the state before the resumed send runs, so it still counts `b: 1`; the prune timer fires at `PRUNE_INTERVAL_MS` steps, and the done task finished at T0 goes at the first tick after T0 + 7 days.

Then append to `plugins/office/server/live-ports.ts`:

```ts
import { wakeTargetOf } from "./mention-queue.js";
import type { OfficeAgentPorts } from "./office.js";

/** Wake ports on the daemon's own API; the holder is set by every hook and handler. */
export function liveAgentPorts(holder: PaseoHolder): OfficeAgentPorts {
  return {
    async status(agentId) {
      const result = await holder.require().agents.ref(agentId).refresh();
      return wakeTargetOf(result === null ? null : result.agent);
    },
    send: (agentId, prompt) => holder.require().agents.ref(agentId).send(prompt),
  };
}
```

Move the two new `import` lines to the top of `live-ports.ts` with the others (lint `import/first`). Apply the Step 1 finding about `refresh()` here if it applies.

- [ ] **Step 5: Wire the plugin entry**

`plugins/office/index.server.ts` (replace the whole file):

```ts
import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { readThreeAsset } from "./server/asset.js";
import { createBoardStore } from "./server/board-store.js";
import { errorMessage } from "./server/errors.js";
import { createHub } from "./server/hub.js";
import { liveAgentPorts, liveHubPorts } from "./server/live-ports.js";
import { createOffice } from "./server/office.js";
import { createPaseoHolder } from "./server/paseo-holder.js";
import { boardsFile } from "./server/paths.js";
import { nodeClock, nodeTimers } from "./server/timers.js";
import {
  assetRpc,
  deleteRpc,
  officeStateSubscription,
  postRpc,
  setWakesPausedRpc,
  updateRpc,
} from "./shared/contracts.js";
import { officeHostSettings } from "./shared/settings.js";

/** What the daemon passes a built-in beside the server context (as in plugins/default-skills). */
interface BuiltinPluginInfo {
  directory: string;
}

// Runs inside the daemon process: every handler, hook and timer catches its own errors.
export default function contribute(
  server: PluginServerContext,
  builtin?: BuiltinPluginInfo,
): () => Promise<void> {
  const log = (message: string) => console.error(message);
  const vendorDirectory = builtin ? join(builtin.directory, "vendor") : null;
  const holder = createPaseoHolder();
  const hub = createHub(liveHubPorts(holder, nodeTimers, log));
  const office = createOffice({
    // Built-ins run in the daemon process, so process.env is the daemon's env.
    store: createBoardStore({
      file: boardsFile(process.env, homedir()),
      now: () => Date.now(),
      log,
    }),
    clock: nodeClock,
    hub,
    agents: liveAgentPorts(holder),
    log,
  });

  let agentTools = true;
  const settings = server.registerSettings(officeHostSettings);
  const applySettings = (state: Awaited<ReturnType<typeof settings.read>>) => {
    if (state.status === "ready") agentTools = state.values.agentTools;
  };
  settings
    .read()
    .then(applySettings)
    .catch((error: unknown) => log(`[office] unable to read settings: ${errorMessage(error)}`));
  const stopSettings = settings.subscribe(applySettings);

  async function guarded<T>(name: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      log(`[office] ${name} failed: ${errorMessage(error)}`);
      throw error;
    }
  }

  server.handle(officeStateSubscription, (_input, context) => {
    holder.remember(context.paseo);
    return hub.attach(context);
  });
  server.handle(assetRpc, () => guarded("asset", () => readThreeAsset(vendorDirectory)));
  server.handle(postRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("post", () => office.post(input));
  });
  server.handle(updateRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("update", () => office.update(input));
  });
  server.handle(deleteRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("delete", () => office.remove(input.id));
  });
  server.handle(setWakesPausedRpc, (input, context) => {
    holder.remember(context.paseo);
    return guarded("pause", () => office.setWakesPaused(input.paused));
  });

  const removeHooks = [
    server.addHook("agent.open.before", async ({ request }, context) => {
      try {
        holder.remember(context.paseo);
        office.noteAgent({
          id: request.agentId,
          workspaceId: request.workspaceId,
          title: request.title,
        });
        if (request.purpose !== "interactive" || !agentTools) return undefined;
        return { ...request, tools: [...request.tools, ...office.tools] };
      } catch (error) {
        log(`[office] agent.open.before failed: ${errorMessage(error)}`);
        return undefined;
      }
    }),
    server.addHook("agent.turn.after", async ({ agent }, context) => {
      try {
        holder.remember(context.paseo);
        office.noteAgent(agent);
        office.turnEnded(agent.id);
      } catch (error) {
        log(`[office] agent.turn.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.close.after", async ({ agent }) => {
      try {
        office.agentGone(agent.id);
      } catch (error) {
        log(`[office] agent.close.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("agent.archive.after", async ({ agent }) => {
      try {
        office.agentGone(agent.id);
      } catch (error) {
        log(`[office] agent.archive.after failed: ${errorMessage(error)}`);
      }
    }),
    server.addHook("workspace.archive.after", async ({ workspace }) => {
      try {
        await office.workspaceArchived(workspace.id);
      } catch (error) {
        log(`[office] workspace.archive.after failed: ${errorMessage(error)}`);
      }
    }),
  ];

  return async () => {
    for (const remove of removeHooks) remove();
    await stopSettings();
    office.stop();
    await hub.stop();
  };
}
```

`ToolAgent` is `Pick<PluginHookAgent, "id" | "workspaceId" | "title">`, so `noteAgent(agent)` takes the hook's agent directly. A tool call made before `ready` settles waits in the board service's queue (Task 22, `start` is queued like every mutation), so it cannot lose a post to the initial load.

- [ ] **Step 6: Run the tests to see them pass, and the built-in compile test**

```bash
cd /workspace/utils/paseo
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/office.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/server/hub.test.ts --bail=1
cd packages/server && flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: PASS, 6 tests; 5 tests; 1 test.

- [ ] **Step 7: Typecheck, lint, format**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/index.server.ts plugins/office/server/office.ts plugins/office/server/office.test.ts plugins/office/server/live-ports.ts
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/index.server.ts plugins/office/server/office.ts plugins/office/server/office.test.ts plugins/office/server/live-ports.ts
```

Expected: exit 0. If the typecheck rejects the `agent.open.before` return because `request` carries a readonly `metadata`, return `{ ...request, metadata: { ...request.metadata }, tools: [...request.tools, ...office.tools] }`; the hook result type allows `metadata`.

- [ ] **Step 8: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/index.server.ts plugins/office/server/office.ts plugins/office/server/office.test.ts plugins/office/server/live-ports.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office boards, tools and wake wired into the daemon" -- plugins/office/index.server.ts plugins/office/server/office.ts plugins/office/server/office.test.ts plugins/office/server/live-ports.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 26: Boards in the structure view, the board sheet, and the two host switches

Tier: most capable: Fable 5.2 (`claude-fable-5-2`). This task decides how the boards and the board sheet look.

**Files:**

- Create: `plugins/office/client/board-text.ts`
- Test: `plugins/office/client/board-text.test.ts`
- Create: `plugins/office/client/use-board-actions.ts`
- Create: `plugins/office/client/room-board.tsx`
- Create: `plugins/office/client/board-sheet.tsx`
- Create: `plugins/office/client/host-switches.tsx`
- Modify: `plugins/office/client/structure-view.tsx`, `plugins/office/client/office-surface.tsx`

**Interfaces:**

- Consumes: Task 3 `postRpc`, `updateRpc`, `deleteRpc`, `setWakesPausedRpc`, `officeHostSettings`, `USER_AUTHOR`, `POST_TEXT_MAX`, `Post`, `PostKind`, `WakeState`, `OfficeAgent`; Task 7 `agentTitle`, `OfficeRoom`; Task 8 `ActionButton`, `OfficeStyles` (its board, post and chip keys exist since Task 8).
- Produces:
  - `board-text.ts`: `authorName(author: string, agents: ReadonlyMap<string, OfficeAgent>): string`, `postStateLabel(post: Post, name: (author: string) => string): string`, `postMeta(post: Post, name: (author: string) => string): string`, `orderBoardPosts(posts: readonly Post[]): Post[]`, `queuedWakes(wake: WakeState): number`, `wakeSummary(wake: WakeState): string | null`
  - `interface BoardActions { post(input: { board: string; kind: PostKind; text: string; to?: string }): Promise<void>; markDone(id: string): Promise<void>; remove(id: string): Promise<void>; setWakesPaused(paused: boolean): Promise<void> }`, `useBoardActions(): BoardActions`
  - `RoomBoard(props: { room: OfficeRoom; name(author: string): string; styles: OfficeStyles; onOpenBoard(roomId: string): void })`
  - `BoardSheet(props: { room: OfficeRoom | null; agents: readonly OfficeAgent[]; name(author: string): string; actions: BoardActions; styles: OfficeStyles; onClose(): void })`
  - `HostSwitches(props: { wake: WakeState; actions: BoardActions; styles: OfficeStyles })` (the "Wake agents" and "Agent tools" switches)
  - `StructureView` gains `name(author: string): string` and `onOpenBoard(roomId: string): void` props.

Spec "Structure view": under the agents, the room's board: open tasks, claimed tasks with the claimer's name, notes; a post that names an agent shows "from → to"; the lobby board is the first card. Spec "Acting": the board sheet posts a task or note to a room or the lobby, optionally naming an agent, and marks a task done or deletes a post. Spec "Wake": a switch pauses every wake; spec "Tools": a setting turns the tools off for the host. Both switches are host-wide and sit in the header next to the 3D switch.

- [ ] **Step 1: Write the failing test**

`plugins/office/client/board-text.test.ts`:

```ts
import { expect, test } from "vitest";
import type { OfficeAgent, Post } from "../shared/contracts.js";
import {
  authorName,
  orderBoardPosts,
  postMeta,
  postStateLabel,
  queuedWakes,
  wakeSummary,
} from "./board-text.js";

const AGENTS = new Map<string, OfficeAgent>([
  [
    "a1",
    {
      id: "a1",
      title: "Planner",
      provider: "claude",
      model: null,
      status: "idle",
      workspaceId: "w1",
      parentAgentId: null,
      permissions: [],
      createdAt: "2026-11-11T08:00:00.000Z",
    },
  ],
]);
const name = (author: string) => authorName(author, AGENTS);

function post(seq: number, fields: Partial<Post>): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "w1",
    kind: "task",
    text: "t",
    author: "user",
    state: "open",
    createdAt: `2026-11-11T09:0${seq}:00.000Z`,
    updatedAt: `2026-11-11T09:0${seq}:00.000Z`,
    ...fields,
  };
}

test("authors read as You, the agent's title, or a short id", () => {
  expect(name("user")).toBe("You");
  expect(name("a1")).toBe("Planner");
  expect(name("0123456789abcdef")).toBe("Agent 01234567");
});

test("a post's meta line gives its state, the claimer, and from → to", () => {
  expect(postStateLabel(post(1, {}), name)).toBe("Task · open");
  expect(postMeta(post(1, { state: "claimed", claimedBy: "a1", to: "a1" }), name)).toBe(
    "Task · claimed by Planner · You → Planner",
  );
  expect(postMeta(post(2, { kind: "note", state: undefined, author: "a1" }), name)).toBe(
    "Note · Planner",
  );
});

test("a board lists open tasks, then claimed tasks, then notes, each oldest first", () => {
  const posts = [
    post(1, { kind: "note", state: undefined }),
    post(2, { state: "claimed", claimedBy: "a1" }),
    post(3, {}),
    post(4, {}),
  ];
  expect(orderBoardPosts(posts).map((item) => item.id)).toEqual(["p3", "p4", "p2", "p1"]);
});

test("the wake summary counts what waits", () => {
  expect(queuedWakes({ paused: false, queued: { a: 2, b: 1 } })).toBe(3);
  expect(wakeSummary({ paused: false, queued: {} })).toBe(null);
  expect(wakeSummary({ paused: false, queued: { a: 2 } })).toBe("2 waiting");
  expect(wakeSummary({ paused: true, queued: {} })).toBe("Paused");
  expect(wakeSummary({ paused: true, queued: { a: 1 } })).toBe("Paused, 1 waiting");
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/board-text.test.ts --bail=1`
Expected: FAIL, cannot resolve `./board-text.js`.

- [ ] **Step 3: Write the board text helpers**

`plugins/office/client/board-text.ts`:

```ts
import { USER_AUTHOR, type OfficeAgent, type Post, type WakeState } from "../shared/contracts.js";
import { agentTitle } from "./model.js";

/** The user sees their own posts as "You". */
export function authorName(author: string, agents: ReadonlyMap<string, OfficeAgent>): string {
  if (author === USER_AUTHOR) return "You";
  const agent = agents.get(author);
  return agent ? agentTitle(agent) : `Agent ${author.slice(0, 8)}`;
}

export function postStateLabel(post: Post, name: (author: string) => string): string {
  if (post.kind === "note") return "Note";
  if (post.state === "claimed" && post.claimedBy !== undefined) {
    return `Task · claimed by ${name(post.claimedBy)}`;
  }
  return `Task · ${post.state ?? "open"}`;
}

/** Spec: a post that names an agent shows "from → to". */
export function postMeta(post: Post, name: (author: string) => string): string {
  const people =
    post.to === undefined ? name(post.author) : `${name(post.author)} → ${name(post.to)}`;
  return `${postStateLabel(post, name)} · ${people}`;
}

function rank(post: Post): number {
  if (post.kind === "note") return 2;
  return post.state === "claimed" ? 1 : 0;
}

/** Open tasks, then claimed tasks, then notes; oldest first within each. */
export function orderBoardPosts(posts: readonly Post[]): Post[] {
  return [...posts].sort(
    (left, right) =>
      rank(left) - rank(right) ||
      left.createdAt.localeCompare(right.createdAt) ||
      left.seq - right.seq,
  );
}

export function queuedWakes(wake: WakeState): number {
  return Object.values(wake.queued).reduce((sum, count) => sum + count, 0);
}

export function wakeSummary(wake: WakeState): string | null {
  const queued = queuedWakes(wake);
  if (wake.paused) return queued > 0 ? `Paused, ${queued} waiting` : "Paused";
  return queued > 0 ? `${queued} waiting` : null;
}
```

- [ ] **Step 4: Run the test to see it pass**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/board-text.test.ts --bail=1`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the board actions, the room board and the host switches**

`plugins/office/client/use-board-actions.ts`:

```ts
import { useMemo } from "react";
import { useRpc } from "@getpaseo/plugin/client";
import {
  deleteRpc,
  postRpc,
  setWakesPausedRpc,
  updateRpc,
  type PostKind,
} from "../shared/contracts.js";

export interface BoardActions {
  post(input: { board: string; kind: PostKind; text: string; to?: string }): Promise<void>;
  markDone(id: string): Promise<void>;
  remove(id: string): Promise<void>;
  setWakesPaused(paused: boolean): Promise<void>;
}

/** Each action rejects with the server's message, which ActionButton shows under the button. */
export function useBoardActions(): BoardActions {
  const post = useRpc(postRpc);
  const update = useRpc(updateRpc);
  const remove = useRpc(deleteRpc);
  const pause = useRpc(setWakesPausedRpc);
  return useMemo(
    (): BoardActions => ({
      async post(input) {
        const result = await post(input);
        if (!result.ok) throw new Error(result.error);
      },
      async markDone(id) {
        const result = await update({ id, action: "done" });
        if (!result.ok) throw new Error(result.error);
      },
      async remove(id) {
        const result = await remove({ id });
        if (!result.ok) throw new Error(result.error);
      },
      async setWakesPaused(paused) {
        await pause({ paused });
      },
    }),
    [post, update, remove, pause],
  );
}
```

`plugins/office/client/room-board.tsx`:

```tsx
import { useCallback, useMemo } from "react";
import { Text, View } from "react-native";
import type { Post } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { orderBoardPosts, postMeta } from "./board-text.js";
import type { OfficeRoom } from "./model.js";
import type { OfficeStyles } from "./styles.js";

interface PostRowProps {
  post: Post;
  name(author: string): string;
  styles: OfficeStyles;
}

export function PostRow({ post, name, styles }: PostRowProps) {
  return (
    <View style={styles.post}>
      <Text style={styles.postMeta} numberOfLines={1}>
        {postMeta(post, name)}
      </Text>
      <Text style={styles.postText} numberOfLines={3}>
        {post.text}
      </Text>
    </View>
  );
}

export interface RoomBoardProps {
  room: OfficeRoom;
  name(author: string): string;
  styles: OfficeStyles;
  onOpenBoard(roomId: string): void;
}

/** The room's board under its agents: open tasks, claimed tasks, notes. */
export function RoomBoard({ room, name, styles, onOpenBoard }: RoomBoardProps) {
  const open = useCallback(() => onOpenBoard(room.id), [onOpenBoard, room.id]);
  const posts = useMemo(() => orderBoardPosts(room.posts), [room.posts]);
  return (
    <View style={styles.boardSection}>
      <View style={styles.boardTitleRow}>
        <Text style={styles.boardTitle}>{room.lobby ? "Lobby board" : "Board"}</Text>
        <ActionButton label="Open board" pendingLabel="Opening..." onPress={open} styles={styles} />
      </View>
      {posts.length === 0 ? <Text style={styles.muted}>No posts</Text> : null}
      {posts.map((post) => (
        <PostRow key={post.id} post={post} name={name} styles={styles} />
      ))}
    </View>
  );
}
```

`plugins/office/client/host-switches.tsx`:

```tsx
import { useCallback, useState } from "react";
import { Switch, Text, View } from "react-native";
import { useSettings } from "@getpaseo/plugin/client";
import type { WakeState } from "../shared/contracts.js";
import { officeHostSettings } from "../shared/settings.js";
import { wakeSummary } from "./board-text.js";
import type { OfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export interface HostSwitchesProps {
  wake: WakeState;
  actions: BoardActions;
  styles: OfficeStyles;
}

/** Host-wide: "Wake agents" pauses every wake; "Agent tools" adds the board tools to new sessions. */
export function HostSwitches({ wake, actions, styles }: HostSwitchesProps) {
  const settings = useSettings(officeHostSettings);
  const [error, setError] = useState<string | null>(null);
  const toggleWakes = useCallback(
    (next: boolean) => {
      setError(null);
      actions
        .setWakesPaused(!next)
        .catch((failure: unknown) => setError(`Unable to change wakes: ${messageOf(failure)}`));
    },
    [actions],
  );
  const ready = settings.status === "ready";
  const revision = ready ? settings.revision : null;
  const { save } = settings;
  const toggleTools = useCallback(
    (next: boolean) => {
      if (revision === null) return;
      void save({ agentTools: next }, revision);
    },
    [save, revision],
  );
  const summary = wakeSummary(wake);
  return (
    <>
      <View style={styles.control}>
        <Text style={styles.controlLabel}>Wake agents</Text>
        <Switch
          accessibilityLabel="Wake agents"
          value={!wake.paused}
          onValueChange={toggleWakes}
          trackColor={styles.switchTrack}
          thumbColor={styles.switchThumb}
        />
        {summary ? <Text style={styles.controlLabel}>{summary}</Text> : null}
      </View>
      <View style={styles.control}>
        <Text style={styles.controlLabel}>Agent tools</Text>
        <Switch
          accessibilityLabel="Agent tools"
          disabled={!ready}
          value={ready ? settings.values.agentTools : true}
          onValueChange={toggleTools}
          trackColor={styles.switchTrack}
          thumbColor={styles.switchThumb}
        />
      </View>
      {error ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          {error}
        </Text>
      ) : null}
      {settings.saveError ? (
        <Text accessibilityRole="alert" style={styles.actionError}>
          Unable to save the setting: {settings.saveError}
        </Text>
      ) : null}
    </>
  );
}
```

"Agent tools" applies to sessions opened after the change (the hook reads it at `agent.open.before`); Task 29 documents that.

- [ ] **Step 6: Write the board sheet**

`plugins/office/client/board-sheet.tsx`:

```tsx
import { useCallback, useMemo, useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Modal, ScrollView, TextInput } from "@getpaseo/plugin/client/ui";
import { POST_TEXT_MAX, type OfficeAgent, type Post, type PostKind } from "../shared/contracts.js";
import { ActionButton } from "./action-button.js";
import { orderBoardPosts } from "./board-text.js";
import { agentTitle, type OfficeRoom } from "./model.js";
import { PostRow } from "./room-board.js";
import type { OfficeStyles } from "./styles.js";
import type { BoardActions } from "./use-board-actions.js";

interface ChipProps {
  label: string;
  value: string;
  selected: boolean;
  onSelect(value: string): void;
  styles: OfficeStyles;
}

function Chip({ label, value, selected, onSelect, styles }: ChipProps) {
  const press = useCallback(() => onSelect(value), [onSelect, value]);
  const accessibilityState = useMemo(() => ({ selected }), [selected]);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={accessibilityState}
      onPress={press}
      style={selected ? styles.chipSelected : styles.chip}
    >
      <Text style={selected ? styles.chipTextSelected : styles.chipText} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

interface PostActionsProps {
  post: Post;
  name(author: string): string;
  actions: BoardActions;
  styles: OfficeStyles;
}

function PostWithActions({ post, name, actions, styles }: PostActionsProps) {
  const done = useCallback(() => actions.markDone(post.id), [actions, post.id]);
  const remove = useCallback(() => actions.remove(post.id), [actions, post.id]);
  return (
    <View>
      <PostRow post={post} name={name} styles={styles} />
      <View style={styles.actions}>
        {post.kind === "task" ? (
          <ActionButton label="Mark done" pendingLabel="Saving..." onPress={done} styles={styles} />
        ) : null}
        <ActionButton label="Delete" pendingLabel="Deleting..." onPress={remove} styles={styles} />
      </View>
    </View>
  );
}

const NOBODY = "";
const KINDS: readonly { kind: PostKind; label: string }[] = [
  { kind: "task", label: "Task" },
  { kind: "note", label: "Note" },
];

interface SheetBodyProps {
  room: OfficeRoom;
  agents: readonly OfficeAgent[];
  name(author: string): string;
  actions: BoardActions;
  styles: OfficeStyles;
}

function SheetBody({ room, agents, name, actions, styles }: SheetBodyProps) {
  const [kind, setKind] = useState<PostKind>("task");
  const [text, setText] = useState("");
  const [to, setTo] = useState(NOBODY);
  const selectKind = useCallback(
    (value: string) => setKind(value === "note" ? "note" : "task"),
    [],
  );
  // The room's own agents first: they are the usual addressees.
  const people = useMemo(() => {
    const own = agents.filter((agent) => (agent.workspaceId ?? "lobby") === room.id);
    const others = agents.filter((agent) => (agent.workspaceId ?? "lobby") !== room.id);
    return [...own, ...others];
  }, [agents, room.id]);
  const posts = useMemo(() => orderBoardPosts(room.posts), [room.posts]);
  const submit = useCallback(async () => {
    await actions.post({
      board: room.id,
      kind,
      text: text.trim(),
      ...(to === NOBODY ? {} : { to }),
    });
    setText("");
    setTo(NOBODY);
  }, [actions, room.id, kind, text, to]);
  return (
    <View style={styles.sheet}>
      <View style={styles.chips}>
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
        value={text}
        onChangeText={setText}
        placeholder={kind === "task" ? "What needs doing" : "Note"}
        placeholderTextColor={styles.placeholderColor}
        maxLength={POST_TEXT_MAX}
        multiline
        style={styles.input}
      />
      <Text style={styles.sheetLabel}>Wake an agent with it</Text>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
      >
        <Chip
          label="Nobody"
          value={NOBODY}
          selected={to === NOBODY}
          onSelect={setTo}
          styles={styles}
        />
        {people.map((agent) => (
          <Chip
            key={agent.id}
            label={agentTitle(agent)}
            value={agent.id}
            selected={to === agent.id}
            onSelect={setTo}
            styles={styles}
          />
        ))}
      </ScrollView>
      <ActionButton
        label="Post"
        pendingLabel="Posting..."
        onPress={submit}
        disabled={text.trim().length === 0}
        styles={styles}
        primary
      />
      {posts.length === 0 ? <Text style={styles.muted}>No posts</Text> : null}
      {posts.map((post) => (
        <PostWithActions key={post.id} post={post} name={name} actions={actions} styles={styles} />
      ))}
    </View>
  );
}

export interface BoardSheetProps {
  room: OfficeRoom | null;
  agents: readonly OfficeAgent[];
  name(author: string): string;
  actions: BoardActions;
  styles: OfficeStyles;
  onClose(): void;
}

/** Post a task or note, optionally waking an agent; mark a task done or delete a post. */
export function BoardSheet({ room, agents, name, actions, styles, onClose }: BoardSheetProps) {
  const change = useCallback(
    (open: boolean) => {
      if (!open) onClose();
    },
    [onClose],
  );
  const title = room ? `${room.name} board` : "Board";
  return (
    <Modal title={title} open={room !== null} onOpenChange={change}>
      <Modal.Content>
        {room ? (
          <SheetBody
            key={room.id}
            room={room}
            agents={agents}
            name={name}
            actions={actions}
            styles={styles}
          />
        ) : null}
      </Modal.Content>
    </Modal>
  );
}
```

`setTo` and `setKind`-style setters are stable, so passing `setTo` as `onSelect` creates no new function per render. A done task leaves the board (the model hides done tasks), so the sheet has no Reopen button; agents reopen through `office_update`.

- [ ] **Step 7: Put the board under each room and the sheet and switches in the surface**

In `plugins/office/client/structure-view.tsx` (Task 8, as changed by Task 9; apply each change at the equivalent place if Task 9 moved the JSX):

1. Add `import { RoomBoard } from "./room-board.js";`.
2. Add to `RoomCardProps` and `StructureViewProps`:
   ```ts
     name(author: string): string;
     onOpenBoard(roomId: string): void;
   ```
3. In `RoomCard`, destructure `name` and `onOpenBoard`, and after the `room.rows.map(...)` block render:
   ```tsx
   <RoomBoard room={room} name={name} styles={styles} onOpenBoard={onOpenBoard} />
   ```
4. In `StructureView`, destructure `name` and `onOpenBoard` and pass them to each `RoomCard` (`name={name} onOpenBoard={onOpenBoard}`).

In `plugins/office/client/office-surface.tsx` (as of Task 19):

1. Add imports:
   ```tsx
   import { BoardSheet } from "./board-sheet.js";
   import { authorName } from "./board-text.js";
   import { HostSwitches } from "./host-switches.js";
   import { useBoardActions, type BoardActions } from "./use-board-actions.js";
   ```
2. Add to `SurfaceBodyProps`: `name(author: string): string;` and `onOpenBoard(roomId: string): void;`; destructure both in `SurfaceBody` and pass them to `StructureView` (`name={name} onOpenBoard={onOpenBoard}`).
3. In `OfficeSurface`, after `const actions = useAgentActions();` add:
   ```tsx
   const boardActions: BoardActions = useBoardActions();
   ```
   and after the `rooms` memo add:
   ```tsx
   const name = useCallback((author: string) => authorName(author, model.agents), [model.agents]);
   const agentList = useMemo(() => [...model.agents.values()], [model.agents]);
   const [boardRoomId, setBoardRoomId] = useState<string | null>(null);
   const closeBoard = useCallback(() => setBoardRoomId(null), []);
   const boardRoom =
     boardRoomId === null ? null : (model.rooms.find((room) => room.id === boardRoomId) ?? null);
   ```
4. Replace the header's switch row

   ```tsx
   {
     threeD.available ? (
       <View style={styles.headerRow}>
         <ThreeDSwitch value={threeD.on} onChange={threeD.toggle} styles={styles} />
       </View>
     ) : null;
   }
   ```

   with

   ```tsx
   <View style={styles.headerControls}>
     {threeD.available ? (
       <ThreeDSwitch value={threeD.on} onChange={threeD.toggle} styles={styles} />
     ) : null}
     <HostSwitches wake={office.state.wake} actions={boardActions} styles={styles} />
   </View>
   ```

5. Pass `name={name}` and `onOpenBoard={setBoardRoomId}` to `SurfaceBody`.
6. After `<AgentCard ... />` render:
   ```tsx
   <BoardSheet
     room={boardRoom}
     agents={agentList}
     name={name}
     actions={boardActions}
     styles={styles}
     onClose={closeBoard}
   />
   ```

- [ ] **Step 8: Typecheck, lint, format, tests, and the built-in compile test**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/client
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/client
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/board-text.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/model.test.ts --bail=1
cd packages/server && flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: exit 0 each. If `react/jsx-max-depth` (6) flags the sheet, move the post list into its own component; if `complexity` flags `OfficeSurface`, move the board state (`boardRoomId`, `closeBoard`, `boardRoom`) into a `useBoardSheet(model)` hook in `office-surface.tsx`.

- [ ] **Step 9: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/client/board-text.ts plugins/office/client/board-text.test.ts plugins/office/client/use-board-actions.ts plugins/office/client/room-board.tsx plugins/office/client/board-sheet.tsx plugins/office/client/host-switches.tsx plugins/office/client/structure-view.tsx plugins/office/client/office-surface.tsx
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office boards, board sheet, wake and tool switches" -- plugins/office/client/board-text.ts plugins/office/client/board-text.test.ts plugins/office/client/use-board-actions.ts plugins/office/client/room-board.tsx plugins/office/client/board-sheet.tsx plugins/office/client/host-switches.tsx plugins/office/client/structure-view.tsx plugins/office/client/office-surface.tsx
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 27: Notes and paper planes in the 3D view

Tier: most capable: Fable 5.2 (`claude-fable-5-2`). This task decides how notes and planes look and move.

**Files:**

- Modify: `plugins/office/client/scene/scene-plan.ts`, `plugins/office/client/scene/scene-plan.test.ts`
- Modify: `plugins/office/client/scene/office-scene.web.ts`, `plugins/office/client/scene/scene-view.tsx`, `plugins/office/client/office-surface.tsx`

**Interfaces:**

- Consumes: Task 12 scene plan; Task 16 scene; Task 26 `orderBoardPosts`, the surface's `setBoardRoomId`.
- Produces:
  - `NOTE_SLOTS = 8`, `NOTE_FADE_MS = 800`, `PLANE_MS = 1400`, `DESK_TOP_Y = 0.72`
  - `interface NotePlan { postId: string; roomId: string; x: number; y: number; z: number; color: string; onDesk: boolean }`
  - `interface MentionPlan { postId: string; from: Point; to: Point }`
  - `ScenePlan` gains `notes: NotePlan[]` and `mentions: MentionPlan[]`, filled by `buildScenePlan`
  - `interface PlaneFrame { x: number; y: number; z: number; heading: number; done: boolean }`, `planeFrame(mention: MentionPlan, startedAt: number, now: number): PlaneFrame`, `noteFade(startedAt: number, now: number): number`
  - `OfficeSceneOptions` and `SceneViewProps` gain `onSelectBoard(roomId: string): void`

Spec "What the user sees": a task is a sticky note on the room's whiteboard; a claimed task's note sits on the claimer's desk; a done task's note fades and is removed; a post that names an agent flies as a paper plane from the poster (or from the board, when the user posted it) to that agent; reduced motion turns planes off. A whiteboard holds 8 notes (4 by 2), oldest open tasks first; the rest stay in the structure view and the sheet. Tapping a whiteboard or a note opens that room's board sheet. Planes fly only for posts that appear while the scene is open: the first plan seeds the seen posts.

- [ ] **Step 1: Write the failing tests**

Append to `plugins/office/client/scene/scene-plan.test.ts`:

```ts
import { fakeOffice } from "./fake-office.js";
import { NOTE_FADE_MS, PLANE_MS, noteFade, planeFrame } from "./scene-plan.js";

function fakePlan() {
  const model = buildOfficeModel(fakeOffice());
  const { layout } = layoutOffice(model, EMPTY_LAYOUT_MEMORY);
  return buildScenePlan(model, layout, scenePalette(THEME));
}

test("tasks and notes sit on the whiteboard; a claimed task sits on its claimer's desk", () => {
  const scene = fakePlan();
  const palette = scenePalette(THEME);
  const notes = new Map(scene.notes.map((note) => [note.postId, note]));
  const claimer = scene.robots.find((robot) => robot.agentId === "Hub tests");
  expect(notes.get("p2")).toEqual({
    postId: "p2",
    roomId: "w-main",
    x: (claimer?.seat.x ?? 0) - 0.3,
    y: 0.72,
    z: (claimer?.seat.z ?? 0) + 0.55,
    color: palette.noteClaimed,
    onDesk: true,
  });
  const main = scene.rooms.find((room) => room.roomId === "w-main");
  expect(notes.get("p4")).toEqual({
    postId: "p4",
    roomId: "w-main",
    x: (main?.board.x ?? 0) - 1.5,
    y: 1.3 + 0.4,
    z: (main?.board.z ?? 0) + 0.06,
    color: palette.noteTask,
    onDesk: false,
  });
  expect([notes.get("p3")?.onDesk, notes.get("p3")?.color, notes.get("p1")?.roomId]).toEqual([
    false,
    palette.noteNote,
    "lobby",
  ]);
});

test("a post that names a seated agent is a mention from its author's seat to the target's", () => {
  const scene = fakePlan();
  const seat = (id: string) => scene.robots.find((robot) => robot.agentId === id)?.seat;
  expect(scene.mentions).toEqual([
    { postId: "p2", from: seat("Refactor hub"), to: seat("Hub tests") },
  ]);
});

test("a plane arcs from start to end and then is done", () => {
  const mention = { postId: "p9", from: { x: 0, z: 0 }, to: { x: 10, z: 0 } };
  expect(planeFrame(mention, 0, 0)).toEqual({
    x: 0,
    y: 1.4,
    z: 0,
    heading: Math.PI / 2,
    done: false,
  });
  const middle = planeFrame(mention, 0, PLANE_MS / 2);
  expect([middle.x, middle.y, middle.done]).toEqual([5, 3.4, false]);
  expect(planeFrame(mention, 0, PLANE_MS).done).toBe(true);
});

test("a removed note fades from full to nothing", () => {
  expect(noteFade(0, 0)).toBe(1);
  expect(noteFade(0, NOTE_FADE_MS / 2)).toBe(0.5);
  expect(noteFade(0, NOTE_FADE_MS * 2)).toBe(0);
});
```

Move the two new `import` lines to the top of the test file with the others.

- [ ] **Step 2: Run them to see them fail**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/scene-plan.test.ts --bail=1`
Expected: FAIL, `noteFade` is not exported (and `scene.notes` is undefined).

- [ ] **Step 3: Add notes and mentions to the plan**

In `plugins/office/client/scene/scene-plan.ts`:

Add imports:

```ts
import type { Post } from "../../shared/contracts.js";
import { orderBoardPosts } from "../board-text.js";
import type { OfficeRoom } from "../model.js";
```

(merge `OfficeRoom` into the existing `../model.js` type import).

Replace

```ts
export interface ScenePlan {
  rooms: RoomPlan[];
  robots: RobotPlan[];
  bounds: Bounds;
}
```

with

```ts
export interface NotePlan {
  postId: string;
  roomId: string;
  x: number;
  y: number;
  z: number;
  color: string;
  /** Lies flat on the claimer's desk; otherwise stands on the whiteboard. */
  onDesk: boolean;
}

export interface MentionPlan {
  postId: string;
  from: Point;
  to: Point;
}

export interface ScenePlan {
  rooms: RoomPlan[];
  robots: RobotPlan[];
  bounds: Bounds;
  notes: NotePlan[];
  mentions: MentionPlan[];
}

export interface PlaneFrame {
  x: number;
  y: number;
  z: number;
  heading: number;
  done: boolean;
}

export const NOTE_SLOTS = 8;
export const NOTE_FADE_MS = 800;
export const PLANE_MS = 1400;
export const DESK_TOP_Y = 0.72;
const BOARD_CENTER_Y = 1.3;
const PLANE_Y = 1.4;
const PLANE_ARC = 2;

function boardSlot(board: Point, index: number): { x: number; y: number; z: number } {
  const column = index % 4;
  const row = Math.floor(index / 4);
  return { x: board.x - 1.5 + column, y: BOARD_CENTER_Y + 0.4 - row * 0.8, z: board.z + 0.06 };
}

function noteColor(post: Post, palette: ScenePalette): string {
  if (post.kind === "note") return palette.noteNote;
  return post.state === "claimed" ? palette.noteClaimed : palette.noteTask;
}

function roomNotes(
  room: OfficeRoom,
  board: Point,
  robots: ReadonlyMap<string, RobotPlan>,
  palette: ScenePalette,
): NotePlan[] {
  const notes: NotePlan[] = [];
  let slot = 0;
  for (const post of orderBoardPosts(room.posts)) {
    const base = { postId: post.id, roomId: room.id, color: noteColor(post, palette) };
    const claimer =
      post.state === "claimed" && post.claimedBy !== undefined
        ? robots.get(post.claimedBy)
        : undefined;
    if (claimer) {
      notes.push({
        ...base,
        x: claimer.seat.x - 0.3,
        y: DESK_TOP_Y,
        z: claimer.seat.z + DESK_OFFSET_Z,
        onDesk: true,
      });
    } else if (slot < NOTE_SLOTS) {
      notes.push({ ...base, ...boardSlot(board, slot), onDesk: false });
      slot += 1;
    }
  }
  return notes;
}

function roomMentions(
  room: OfficeRoom,
  board: Point,
  robots: ReadonlyMap<string, RobotPlan>,
): MentionPlan[] {
  const mentions: MentionPlan[] = [];
  for (const post of room.posts) {
    const target = post.to === undefined ? undefined : robots.get(post.to);
    if (!target) continue;
    const from = robots.get(post.author)?.seat ?? board;
    mentions.push({ postId: post.id, from, to: target.seat });
  }
  return mentions;
}

export function planeFrame(mention: MentionPlan, startedAt: number, now: number): PlaneFrame {
  const t = Math.min(1, Math.max(0, (now - startedAt) / PLANE_MS));
  const dx = mention.to.x - mention.from.x;
  const dz = mention.to.z - mention.from.z;
  return {
    x: mention.from.x + dx * t,
    y: PLANE_Y + Math.sin(Math.PI * t) * PLANE_ARC,
    z: mention.from.z + dz * t,
    heading: Math.atan2(dx, dz),
    done: t >= 1,
  };
}

/** Opacity of a removed note, 1 down to 0 over NOTE_FADE_MS. */
export function noteFade(startedAt: number, now: number): number {
  return 1 - Math.min(1, Math.max(0, (now - startedAt) / NOTE_FADE_MS));
}
```

In `buildScenePlan`, replace

```ts
robots.sort((left, right) => left.agentId.localeCompare(right.agentId));
return { rooms, robots, bounds: layout.bounds };
```

with

```ts
robots.sort((left, right) => left.agentId.localeCompare(right.agentId));
const byAgent = new Map(robots.map((robot) => [robot.agentId, robot]));
const notes: NotePlan[] = [];
const mentions: MentionPlan[] = [];
for (const room of model.rooms) {
  const placed = layout.roomById.get(room.id);
  if (!placed) continue;
  notes.push(...roomNotes(room, placed.board, byAgent, palette));
  mentions.push(...roomMentions(room, placed.board, byAgent));
}
return { rooms, robots, bounds: layout.bounds, notes, mentions };
```

The test's expected values: `p4` (open, oldest open task in `w-main`) takes board slot 0, at `board.x - 1.5`, `y = 1.3 + 0.4 = 1.7`; `p3` (a note) takes slot 1; `p2` is claimed by "Hub tests", which is seated, so it lies on that desk; the lobby's `p1` is in room `lobby`. The planes test: from (0, 0) to (10, 0), the heading is `atan2(10, 0) = pi/2`, and half-way the arc adds `sin(pi/2) * 2 = 2` to 1.4.

- [ ] **Step 4: Run the tests to see them pass**

Run: `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/scene-plan.test.ts --bail=1`
Expected: PASS, 12 tests.

- [ ] **Step 5: Draw the notes, fade them, fly the planes, and open a board on tap**

In `plugins/office/client/scene/office-scene.web.ts`:

1. Extend the scene-plan import with `NOTE_FADE_MS`, `noteFade`, `planeFrame`, `type MentionPlan`, `type NotePlan`, and the three-types import with `type MeshLike`.
2. Add `onSelectBoard(roomId: string): void;` to `OfficeSceneOptions`.
3. Give `Placement` two optional rotations and use them in `place`:
   ```ts
   interface Placement {
     x: number;
     y: number;
     z: number;
     rx?: number;
     ry?: number;
     sx?: number;
     sy?: number;
     sz?: number;
   }
   ```
   and in `place`, replace `dummy.rotation.set(0, 0, 0);` with `dummy.rotation.set(at.rx ?? 0, at.ry ?? 0, 0);`.
4. Add `notes: Layer;` and `planes: Layer;` to `Layers`, and to the object `createLayers` returns:
   ```ts
       notes: layer(new three.BoxGeometry(0.62, 0.5, 0.02), materials.tinted),
       planes: layer(new three.ConeGeometry(0.16, 0.5, 3).rotateX(Math.PI / 2), materials.tinted),
   ```
5. Replace the initial plan literal
   ```ts
   let plan: ScenePlan = {
     rooms: [],
     robots: [],
     bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
   };
   ```
   with
   ```ts
   let plan: ScenePlan = {
     rooms: [],
     robots: [],
     bounds: { minX: -1, maxX: 1, minZ: -1, maxZ: 1 },
     notes: [],
     mentions: [],
   };
   const seenMentions = new Set<string>();
   let seeded = false;
   const flights: { mention: MentionPlan; start: number }[] = [];
   const fades: { mesh: MeshLike; material: ColorMaterialLike; start: number }[] = [];
   ```
6. Add these functions inside `createOfficeScene`, after `writeLabels`:

   ```ts
   function writeNotes(): void {
     const { notes } = layers;
     ensureCapacity(three, world, notes, plan.notes.length);
     plan.notes.forEach((note, index) => {
       const at = { x: note.x, y: note.y, z: note.z, rx: note.onDesk ? -Math.PI / 2 : 0 };
       notes.mesh.setMatrixAt(index, place(dummy, at).matrixWorld);
       notes.mesh.setColorAt(index, tint.set(note.color));
     });
     finishLayer(notes, plan.notes.length);
   }

   function startFades(previous: readonly NotePlan[], next: readonly NotePlan[]): void {
     if (options.reducedMotion) return;
     const kept = new Set(next.map((note) => note.postId));
     for (const note of previous) {
       if (kept.has(note.postId)) continue;
       const material = new three.MeshBasicMaterial({
         color: note.color,
         transparent: true,
         depthWrite: false,
       });
       const mesh = new three.Mesh(layers.notes.geometry, material);
       mesh.position.set(note.x, note.y, note.z);
       mesh.rotation.set(note.onDesk ? -Math.PI / 2 : 0, 0, 0);
       world.add(mesh);
       fades.push({ mesh, material, start: performance.now() });
     }
   }

   function startFlights(mentions: readonly MentionPlan[]): void {
     for (const mention of mentions) {
       if (seenMentions.has(mention.postId)) continue;
       seenMentions.add(mention.postId);
       if (seeded && !options.reducedMotion) flights.push({ mention, start: performance.now() });
     }
     seeded = true;
   }

   function stepFades(now: number): boolean {
     for (let index = fades.length - 1; index >= 0; index -= 1) {
       const fade = fades[index];
       if (!fade) continue;
       const opacity = noteFade(fade.start, now);
       fade.material.opacity = opacity;
       if (opacity > 0) continue;
       world.remove(fade.mesh);
       fade.material.dispose();
       fades.splice(index, 1);
     }
     return fades.length > 0;
   }

   function writePlanes(now: number, colors: ScenePalette): boolean {
     const { planes } = layers;
     const live = flights.filter((flight) => !planeFrame(flight.mention, flight.start, now).done);
     flights.splice(0, flights.length, ...live);
     ensureCapacity(three, world, planes, flights.length);
     flights.forEach((flight, index) => {
       const frame = planeFrame(flight.mention, flight.start, now);
       planes.mesh.setMatrixAt(
         index,
         place(dummy, { x: frame.x, y: frame.y, z: frame.z, ry: frame.heading }).matrixWorld,
       );
       planes.mesh.setColorAt(index, tint.set(colors.plane));
     });
     finishLayer(planes, flights.length);
     return flights.length > 0;
   }
   ```

   `NOTE_FADE_MS` is used through `noteFade`; drop it from the import if lint reports it unused.

7. In `draw`, replace
   ```ts
   const moving = applyCamera(now);
   writeRobots(now);
   ```
   with
   ```ts
   let moving = applyCamera(now);
   writeRobots(now);
   if (palette !== null) moving = writePlanes(now, palette) || moving;
   moving = stepFades(now) || moving;
   ```
8. Next to `let plan: ScenePlan = ...`, add `let palette: ScenePalette | null = null;`. In `update`, before `plan = nextPlan;` add `startFades(plan.notes, nextPlan.notes);`, after it add `palette = nextPalette;`, and after `writeLabels(nextPalette);` add:
   ```ts
   writeNotes();
   startFlights(nextPlan.mentions);
   ```
9. In `pick`, after the robot branch's `return;` block and before the label lookup, add:
   ```ts
   const boardHit = raycaster.intersectObjects([layers.boards.mesh, layers.notes.mesh], false)[0];
   if (boardHit?.instanceId !== undefined) {
     const roomId =
       boardHit.object === layers.boards.mesh
         ? plan.rooms[boardHit.instanceId]?.roomId
         : plan.notes[boardHit.instanceId]?.roomId;
     if (roomId !== undefined) {
       options.onSelectBoard(roomId);
       return;
     }
   }
   ```
10. In `dispose`, before `for (const label of labels.values())`, add:

```ts
for (const fade of fades) fade.material.dispose();
fades.length = 0;
```

`layers.notes.mesh` is compared by identity; `ensureCapacity` may replace a layer's mesh, and `pick` always reads the current one.

In `plugins/office/client/scene/scene-view.tsx`: add `onSelectBoard(roomId: string): void;` to `SceneViewProps`, destructure it, add it to the `handlers` ref object (initial value and the effect that refreshes it, plus its dependency list), and pass `onSelectBoard: (roomId) => handlers.current.onSelectBoard(roomId),` to `createOfficeScene`.

In `plugins/office/client/office-surface.tsx`: add `onSelectBoard={onOpenBoard}` to the `<SceneView ... />` element in `SurfaceBody`.

- [ ] **Step 6: Typecheck, lint, format, tests**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/client
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/client
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/scene-plan.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/fake-office.test.ts --bail=1
cd packages/server && flock -w 480 /tmp/paseo-heavy.lock npx vitest run src/server/plugins/builtin/index.test.ts -t "listed built-ins resolve to matching manifests and compile" --bail=1
```

Expected: exit 0 each. If `complexity` flags `createOfficeScene`, apply the split described in Task 16, Step 5.

- [ ] **Step 7: Commit**

```bash
cd /workspace/utils/paseo
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/client/scene/scene-plan.ts plugins/office/client/scene/scene-plan.test.ts plugins/office/client/scene/office-scene.web.ts plugins/office/client/scene/scene-view.tsx plugins/office/client/office-surface.tsx
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "feat(fork): office notes and paper planes in 3D" -- plugins/office/client/scene/scene-plan.ts plugins/office/client/scene/scene-plan.test.ts plugins/office/client/scene/office-scene.web.ts plugins/office/client/scene/scene-view.tsx plugins/office/client/office-surface.tsx
git log -1 --format='%an <%ae> | %cn <%ce>'
```

---

### Task 28: Phase 3 design polish: boards, notes, planes, the board sheet

Tier: most capable: Fable 5.2 (`claude-fable-5-2`). This task decides how the office looks.

Tasks 26 and 27 made the boards work in both views; this task makes them look right on the owner's phone and tablet. Presentation only: spacing, type, colour through the theme tokens (`theme.colors.*` via `styles.ts` and `scenePalette`), note and plane sizes and colours, motion timing, touch targets of at least 44 px, and the empty, loading and error states. Never behaviour or contracts: no change to what a post, claim, done, delete, switch or tap does, to RPCs, the board rules, the wake rules, or the tools.

**Files:**

- Modify (presentation only): `plugins/office/client/styles.ts`, `plugins/office/client/room-board.tsx`, `plugins/office/client/board-sheet.tsx`, `plugins/office/client/host-switches.tsx`, `plugins/office/client/office-surface.tsx` (header layout only), `plugins/office/client/scene/palette.ts` (note and plane colours), `plugins/office/client/scene/scene-plan.ts` (only `NOTE_SLOTS` layout offsets, `NOTE_FADE_MS`, `PLANE_MS`, `PLANE_Y`, `PLANE_ARC`), `plugins/office/client/scene/office-scene.web.ts` (note and plane geometry sizes)
- Tests that may change: `scene-plan.test.ts` and `palette.test.ts`, only where an expected value is one of those constants and it changed; no assertion is removed or loosened.

**Interfaces:**

- Consumes: Tasks 26 and 27.
- Produces: the same exports and signatures.

- [ ] **Step 1: Load the design skills and the house rules**

Invoke, with the Skill tool, `antislop`, `antislop-ui`, `antislop-layoutmobile` and `antislop-human`; `unslop` is loaded in Step 5. Read `docs/design.md` and `docs/unistyles.md` (token rules).

- [ ] **Step 2: Start the dev daemon and the web app**

```bash
ss -ltnp | grep -E ':(6768|8081) '
```

Expected: no output; otherwise stop and ask the controller. Then `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npm run build:server`, start `npm run dev:server` and `npm run dev:app` as background commands (never the daemon on 6767), and open `http://<container IP>:8081` in the Playwright browser. Post from the board sheet as the user to fill boards (an open task, a note, a task naming an agent); posting costs nothing, but naming an idle agent wakes it and spends a turn: name only an agent the controller agreed to, or set "Wake agents" off first.

- [ ] **Step 3: Take the before screenshots**

```bash
mkdir -p /workspace/utils/paseo/.superpowers/screenshots/agent-office/phase-3
```

At 390 x 844 (light and dark), 820 x 1180 and 1440 x 900: `before-structure-<width>.png` (a room card with its board), `before-sheet-<width>.png` (the board sheet with posts), `before-header-<width>.png` (the three switches), `before-scene-<width>.png` (3D with notes on a whiteboard and a desk). Capture one plane in flight at 390 x 844 as `before-plane-390.png` (post a note that names an agent while the scene is open, with "Wake agents" off so nothing is spent).

- [ ] **Step 4: Review, phone first**

List each finding in the task report (what, where, rule). Check at least: the header's three switches at 390 px (wrap cleanly, labels readable, 44 px targets); chips in the sheet (44 px tall, the selected state visible without colour alone, `antislop-human`); the sheet's input, chips and Post button with the keyboard open; post rows (meta line contrast, "from → to" readable, three-line clamp); the empty board ("No posts"); notes legible as colours against the whiteboard in both themes; planes visible but calm (`antislop-ui` motion); a fading note not flashing.

- [ ] **Step 5: Apply, then a review pass**

Make the changes within the limits above. Then invoke `unslop` and run its review pass over the same screens; fix what it finds within the same limits.

- [ ] **Step 6: Take the after screenshots**

The same set as Step 3, named `after-...`.

- [ ] **Step 7: Stop what you started**

Stop the dev app and the dev daemon you started. Delete nothing in `.dev/paseo-home`.

- [ ] **Step 8: Typecheck, lint, format, affected tests**

```bash
cd /workspace/utils/paseo/plugins && flock -w 480 /tmp/paseo-heavy.lock npx tsgo -p tsconfig.json --noEmit --singleThreaded
cd /workspace/utils/paseo
npm run format:files -- plugins/office/client
flock -w 480 /tmp/paseo-heavy.lock npm run lint -- plugins/office/client
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/board-text.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/scene-plan.test.ts --bail=1
flock -w 480 /tmp/paseo-heavy.lock npx vitest run plugins/office/client/scene/palette.test.ts --bail=1
```

Expected: exit 0 each.

- [ ] **Step 9: Commit**

```bash
cd /workspace/utils/paseo
git status --short plugins/office
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add plugins/office/client/styles.ts plugins/office/client/room-board.tsx plugins/office/client/board-sheet.tsx plugins/office/client/host-switches.tsx plugins/office/client/office-surface.tsx plugins/office/client/scene/palette.ts plugins/office/client/scene/palette.test.ts plugins/office/client/scene/scene-plan.ts plugins/office/client/scene/scene-plan.test.ts plugins/office/client/scene/office-scene.web.ts
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "style(fork): polish the office boards, notes and planes" -- plugins/office/client/styles.ts plugins/office/client/room-board.tsx plugins/office/client/board-sheet.tsx plugins/office/client/host-switches.tsx plugins/office/client/office-surface.tsx plugins/office/client/scene/palette.ts plugins/office/client/scene/palette.test.ts plugins/office/client/scene/scene-plan.ts plugins/office/client/scene/scene-plan.test.ts plugins/office/client/scene/office-scene.web.ts
git log -1 --format='%an <%ae> | %cn <%ce>'
```

`git status --short plugins/office` must show changes only in the listed files; `git commit -- <paths>` commits the listed files that changed.

The task report lists every change with its reason, findings left for the owner, and the before and after screenshot paths.

---

### Task 29: Phase 3 checkpoint: hand test and docs

Tier: standard.

**Files:**

- Modify: `docs/plugins.md` (the `office` paragraph)

**Interfaces:**

- Consumes: everything from Tasks 21-28.
- Produces: evidence in the task report that Phase 3 works; the finished paragraph.

- [ ] **Step 1: Update the docs paragraph**

In `docs/plugins.md`, replace the sentence

```markdown
Design: [the spec](superpowers/specs/2026-11-11-agent-office-design.md).
```

at the end of the `office` paragraph with

```markdown
Each room has a board, and the lobby has one for the host: posts are tasks (open, claimed, done)
or notes, kept in `$PASEO_HOME/office/boards.json` (200 per board, done tasks dropped after 7
days, a board removed with its workspace). Interactive agent sessions get three tools,
`office_read`, `office_post` and `office_update`, unless the host's "Agent tools" switch is off
when the session opens. A post that names an agent wakes it with one prompt when it is idle, at
most 6 times an hour per agent; the "Wake agents" switch holds every wake until it is turned back
on. Design: [the spec](superpowers/specs/2026-11-11-agent-office-design.md).
```

Add one sentence after "when the session opens." with what Task 25, Step 1 found about which sessions receive plugin tools (for example: "Plugin tools reach an agent through Paseo's own agent tools, so a provider with those off does not get them."), worded from the finding.

- [ ] **Step 2: Start the dev daemon and the web app**

```bash
ss -ltnp | grep -E ':(6768|8081) '
```

Expected: no output; otherwise stop and ask the controller. Then `cd /workspace/utils/paseo && flock -w 480 /tmp/paseo-heavy.lock npm run build:server`, start `npm run dev:server` and `npm run dev:app` as background commands (never the daemon on 6767), and open `http://<container IP>:8081` in the Playwright browser.

Agents needed: two agents in one workspace (A and B), new sessions opened after this build so they carry the tools, and enough turns for: A posting a task to B, B being woken twice (once idle, once while running), and the limit check. Before creating or prompting any agent, tell the controller how many agents and turns you need (about 2 agents and 10 short turns) and wait for the owner's yes. On no, run checks 1-3 and 8-10 only and mark the rest not run.

- [ ] **Step 3: Run the checks, phone first (390 x 844), then tablet (820 x 1180)**

Record pass or fail and one line of evidence for each:

1. Structure view: each room card ends with its board; the lobby card is first with "Lobby board"; posts list open tasks, then claimed tasks with the claimer's name, then notes; a post naming an agent shows "from → to".
2. Board sheet: "Open board" opens it; post a task, then a note; "Mark done" removes a task from the board; "Delete" removes a post; a 2,001-character paste is cut at 2,000 by the input.
3. 3D: notes appear on the whiteboard, a claimed task on its claimer's desk; tapping a whiteboard opens its sheet; marking a task done fades its note.
4. Tools: in agent A's session, ask it to call `office_read`, then `office_post` a task to B's id: the post appears in both views and a paper plane flies from A to B in 3D.
5. Wake while idle: B, idle, receives one prompt that starts `Office board: 1 post(s) for you.` and names the post's id, author and text.
6. Wake while running: post two notes naming B (from the sheet) while B runs a turn; when the turn ends B receives one prompt with `2 post(s)`.
7. Claim rule: ask B to claim the task, then A to claim it: A gets "Unable to claim pN: claimed by <B's title>".
8. Pause: switch "Wake agents" off; post a note naming B: the header shows "Paused, 1 waiting" and B is not woken; switch it on: B is woken.
9. Agent tools off: switch "Agent tools" off, open a new agent session, ask it to list its tools: no `office_*`; switch it back on.
10. Restart survival: stop and start the dev daemon only: the boards and the pause state are still there; the wake queue is empty (decision 3).
11. Limit (if the owner agreed to the turns): name B in 7 quick posts with B idle between them; the 7th waits ("1 waiting" in the header) and the dev daemon log shows no seventh wake within the hour. Record the times; do not wait the hour.

- [ ] **Step 4: Stop what you started**

Stop the dev app and the dev daemon you started. Archive the agents you created for the test only if the controller asks.

- [ ] **Step 5: Format and commit the docs**

```bash
cd /workspace/utils/paseo
npm run format:files -- docs/plugins.md
test "$(git branch --show-current)" = feat/agent-office || { echo "STOP: not on feat/agent-office"; exit 1; }
git add docs/plugins.md
env LEFTHOOK=0 GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git commit -m "docs(fork): office boards, tools and wake" -- docs/plugins.md
git log -1 --format='%an <%ae> | %cn <%ce>'
```

**Phase 3 checkpoint:** boards work in both views and survive a restart; agents read, post and claim through three tools; a post that names an agent wakes it once when idle, batched, at most 6 times an hour, never by its own post, and the pause switch holds every wake. Nothing in the app changed outside the `office` plugin except the SDK's `cancel()`.

---

# Self-review

## Spec coverage

| Spec item                                                                                                                                                               | Where                                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Goal: one place for every agent on a host, act on it, agents coordinate                                                                                                 | Tasks 3-8 (office, card), 21-26 (boards, tools, wake)                                                                            |
| Touch web first                                                                                                                                                         | Global Constraints ("Design runs on Fable 5.2", phone width first); checks at 390 x 844 first in Tasks 9, 10, 17, 19, 20, 28, 29 |
| Renderer: three.js, web only, no WASM                                                                                                                                   | Tasks 13, 14, 16; code note 4 (r170)                                                                                             |
| 3D switch per device; off never loads three.js                                                                                                                          | Task 3 (`officeDeviceSettings`), Task 16 (`useThreeD`, `SceneView` mounted only when on), Task 20 check 8                        |
| 3D default on; no WebGL2 gives the structure view                                                                                                                       | Task 3 (default `true`), Task 16 (`hasWebGL2`)                                                                                   |
| Scope: the connected host's agents, one room per workspace, lobby                                                                                                       | Tasks 4, 6, 7; decision 4                                                                                                        |
| Places: sidebar screen and workspace tab, one surface                                                                                                                   | Task 8 (`OfficeSurface` registered twice, Command Center item)                                                                   |
| Boards per workspace plus lobby; a post may name any agent                                                                                                              | Tasks 22, 26 (sheet lists every agent, room first)                                                                               |
| Posts: tasks (open, claimed, done) and notes                                                                                                                            | Tasks 3, 22                                                                                                                      |
| Wake: delivered when idle, at once or from `agent.turn.after`; batched; never own post; never closed or archived                                                        | Tasks 23, 25; decision 2                                                                                                         |
| Wake limits: 6 per agent per rolling hour; pause switch                                                                                                                 | Tasks 23, 25, 26 (`HostSwitches`)                                                                                                |
| A wake never answers a permission or changes a mode                                                                                                                     | Task 23 (send only)                                                                                                              |
| Look: low-poly office from above, small robots; screenshot before the rest                                                                                              | Tasks 11, 12, 16, then the gate in Task 17 (executor STOPS), then Tasks 18, 19                                                   |
| Packaging: built-in `office`, three.js vendored, fetched on first use                                                                                                   | Tasks 3, 13, 14                                                                                                                  |
| Native: structure view only                                                                                                                                             | Task 16 (`Platform.OS === "web"` gate)                                                                                           |
| Core change: `cancel()` on the SDK agent handle, docs, compatibility                                                                                                    | Task 2                                                                                                                           |
| 3D: glass rooms in a grid, labels, lobby in the middle                                                                                                                  | Tasks 11, 16                                                                                                                     |
| Robot per agent, provider visor colour, child at a side desk                                                                                                            | Tasks 11, 12, 16; code note 6                                                                                                    |
| State poses and lights (table)                                                                                                                                          | Task 12 (`robotPose`, `robotFrame`), Task 16                                                                                     |
| Sticky notes; claimed on the claimer's desk; done fades                                                                                                                 | Task 27; decision 11                                                                                                             |
| Paper plane from poster or board to the named agent                                                                                                                     | Task 27; decision 13                                                                                                             |
| Camera: fixed angle, drag, pinch or wheel, tap a label, tab starts on its room                                                                                          | Tasks 15, 16, 18                                                                                                                 |
| Attention strip: moves the camera and opens the card                                                                                                                    | Tasks 8, 18                                                                                                                      |
| Structure view: room cards, indented children, state dot, provider and model, "doing now", Approve and Deny                                                             | Tasks 5, 7, 8; decisions 5, 8                                                                                                    |
| Structure view: board with open, claimed (claimer), notes; "from → to"; lobby first                                                                                     | Tasks 7, 26                                                                                                                      |
| Agent card: open session, send, approve or deny, stop                                                                                                                   | Tasks 2, 8                                                                                                                       |
| Board sheet: post task or note to a room or lobby, name an agent, mark done, delete                                                                                     | Task 26                                                                                                                          |
| Tools: `office_read`, `office_post`, `office_update` with the spec's inputs and results; short descriptions                                                             | Task 24 (descriptions tested under 200 characters)                                                                               |
| "room" is the caller's workspace; no workspace means lobby; ids from `list_agents`                                                                                      | Task 24 (`boardFor`, `office_post` description)                                                                                  |
| Host setting turns the tools off; the office still works                                                                                                                | Tasks 3, 25, 26; code note 10                                                                                                    |
| Server files: paths, board-store, board-service, mention-queue, agent-tools, activity, index.server                                                                     | Tasks 3, 21, 22, 23, 24, 5, 6/13/25                                                                                              |
| Wire contract: `office.state`, post, update, delete, set wakes paused, asset                                                                                            | Task 3; code note 2 (names)                                                                                                      |
| Limits: 2,000 characters, 200 per board (done and notes first), done removed after 7 days, archived workspace's board removed                                           | Tasks 3, 22, 25; decision 10                                                                                                     |
| Post shape                                                                                                                                                              | Task 3 (plus `seq`, decision 1)                                                                                                  |
| Client files: index.client, model, layout, office-surface, structure-view, agent-card, board-sheet, device settings, scene                                              | Tasks 7, 8, 11, 13-16, 26; code notes 3 and 5                                                                                    |
| Agent data source                                                                                                                                                       | Tasks 4, 6; code note 1                                                                                                          |
| Performance: not in the bundle, one canvas, instancing, no shadows, pixel ratio caps, draw on demand, pause when hidden, dispose, context loss fallback, reduced motion | Task 14 (loader), Task 15 (`pixelRatioFor`), Task 16 (all the rest; bundle check in Step 9), Task 20 checks 8-13                 |
| Safety: every hook, handler, timer and store write catches and logs                                                                                                     | Global Constraints; Tasks 6, 13, 21, 22, 23, 25                                                                                  |
| Safety: text and counts bounded                                                                                                                                         | Tasks 3, 22, 24                                                                                                                  |
| Unit tests: store, service, queue (fake clock), tools, model, layout                                                                                                    | Tasks 21, 22, 23, 24, 7, 11                                                                                                      |
| Hand tests in a touch-sized browser                                                                                                                                     | Tasks 10, 20, 29                                                                                                                 |
| Order of work: three phases                                                                                                                                             | Phases 1-3, each ending with a checkpoint (Tasks 10, 20, 29)                                                                     |
| Design polish on Fable 5.2 (owner addition)                                                                                                                             | Tasks 9, 19, 28; Fable tier on Tasks 8, 12, 16, 26, 27                                                                           |
| Not in this version                                                                                                                                                     | Nothing planned for it                                                                                                           |

Not fully plannable, and why:

- Pinch zoom and the 1.5 pixel ratio cap on a coarse pointer cannot be exercised in the container's Playwright browser without touch emulation; Task 20 marks them "owner check on a phone".
- The hourly limit is checked up to the held seventh wake; nobody waits the hour by hand (Task 29 check 11). The unit test covers the release.
- Whether every interactive session receives plugin tools is decided by the daemon (code note 10); the plan verifies and documents it, it does not change the daemon.
- The wake queue does not survive a daemon restart (decision 3); the spec does not say it must.

## Placeholder scan

Searched for "TBD", "TODO", "fill in", "similar to Task", "as above", "appropriate" and "etc.": no hits outside test data (`{ type: "todo" }` is a timeline item kind in Task 5). Steps that point at another task's step were replaced with the commands themselves. The three conditional instructions that remain are deliberate and bounded: Task 25 Step 1 (map a "not found" rejection to `gone` if `refresh()` rejects), Task 29 Step 1 (one sentence from that finding), and the lint fallbacks that name the exact split to make.

## Type consistency

Checked across tasks:

- Contract names from Task 3 are used unchanged in Tasks 6, 8, 13, 14, 16, 25, 26: `officeStateSubscription`, `postRpc`, `updateRpc`, `deleteRpc`, `setWakesPausedRpc`, `assetRpc`, `officeHostSettings`, `officeDeviceSettings`, `LOBBY`, `USER_AUTHOR`, `POST_TEXT_MAX`, `BOARD_POST_MAX`, `DONE_TASK_TTL_MS`, `READ_POST_MAX`, `WAKES_PER_HOUR`.
- `Timers` (Task 5) gains `Clock` and `nodeClock` in Task 22; `FakeClock` satisfies `Clock`; Tasks 23 and 25 take `Clock`.
- `BoardStore`/`BoardsFile` (Task 21) → `createBoardService` ports (Task 22) → `createOffice` (Task 25). `BoardService.start` is queued with mutations (Task 22) so Task 25's early tool calls wait for the load.
- `Hub` (Task 6) → `OfficeHub = Pick<Hub, "setBoards" | "setBoard" | "removeBoard" | "setWake">` (Task 25).
- `WakeTarget`, `wakeTargetOf`, `Delivery` (Task 23) → `OfficeAgentPorts` and `liveAgentPorts` (Task 25).
- `ToolAgent = Pick<PluginHookAgent, "id" | "workspaceId" | "title">` (Task 24) takes the hook's agent directly in Task 25.
- `assetRpc` output: the server handler may return any `Uint8Array` (`PluginWireInput`); the client receives `Uint8Array<ArrayBuffer>`, which `ThreeLoaderPorts` and `evaluateModule` take (Tasks 14, 16).
- `ScenePlan` (Task 12) gains `notes` and `mentions` in Task 27, which also updates the one plan literal in `office-scene.web.ts`. `RobotPlan.seatIndex` and `deskPlans` (Task 12) feed `writeDesks` (Task 16).
- `OfficeStyles` keys used in Tasks 16, 26 and 27 (`headerRow`, `headerControls`, `control`, `controlLabel`, `switchTrack`, `switchThumb`, `banner`, `bannerText`, `actions`, `scene`, `sceneStatus`, `boardSection`, `boardTitleRow`, `boardTitle`, `post`, `postMeta`, `postText`, `chips`, `chip`, `chipSelected`, `chipText`, `chipTextSelected`, `sheet`, `sheetLabel`, `input`, `placeholderColor`, `muted`, `actionError`) all exist since Task 8; the polish tasks may add keys, never remove one.
- `SceneView` props grow in Task 27 (`onSelectBoard`); `StructureView` props grow in Task 26 (`name`, `onOpenBoard`); both tasks update every caller.
