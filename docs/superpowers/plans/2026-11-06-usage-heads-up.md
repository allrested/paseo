# Usage Heads-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Warn before an account runs out: project each usage window's run-out, show a heads-up with a one-click move on the agent screen, and send one notification when an account window crosses 80% and again at 95%.

**Architecture:** A pace projection inside the daemon's `UsageSourceRegistry` fills `runsOutAt` and `shortfallPct` from two hours of fetch samples, so every usage surface shows it. Move targets carry the tightest window's `runsOutAt` and `windowLabel`; the app's move banner polls them every five minutes and puts a heads-up between the limit notice and "Moved from". A daemon usage watch tracks the level each account window has crossed and sends one `agent_attention_required` with reason `usage` through the existing attention pipeline, only to clients that advertise `usage_notifications`, plus a push.

**Tech Stack:** TypeScript (NodeNext, strict), zod, `@getpaseo/protocol`, `@getpaseo/client`, the daemon in `packages/server`, React Native with zustand and `@tanstack/react-query` in `packages/app`, i18next, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-06-usage-heads-up-design.md`

## Global Constraints

- **Host memory.** The 16 GB host froze on 2026-11-06 from parallel heavy commands. Run every typecheck, vitest run, build, npm install and `git commit` (its lefthook pre-commit typechecks every workspace) under `flock /tmp/paseo-heavy.lock`. Typecheck with `tsgo --singleThreaded`. Never run a whole workspace test suite.
- **One test file per run,** from the file's package directory, because each package has its own Vitest config: `cd /workspace/utils/paseo/packages/<pkg> && flock /tmp/paseo-heavy.lock npx vitest run <file> --bail=1`.
- **Pre-commit hook stays on.** Every commit runs the lefthook hook (format, lint, full typecheck) under the heavy lock. `LEFTHOOK=0` is not approved for this plan, and no step offers it. If the hook fails in a workspace the task did not touch, stop and report it.
- **Protocol and client resolve through `dist`.** `packages/protocol/package.json` exports `./*` from `dist`, and no tsconfig or Vitest alias points `@getpaseo/protocol` at `src`. After a task edits `packages/protocol/src`, run `flock /tmp/paseo-heavy.lock npm run build:protocol` before any server, client or app test, typecheck or commit. After it edits `packages/client/src`, also run `flock /tmp/paseo-heavy.lock npm run build:client`. The builds regenerate the gitignored zod-aot validators.
- **Daemon:** never restart or stop the Paseo daemon on port 6767. Manual tests use a dev daemon at `PASEO_HOME=/workspace/utils/paseo/.dev/paseo-home`, started with `env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD` and `PASEO_LISTEN=172.22.0.3:6768`, and they abort cleanly when `MemAvailable` drops below 2500 MB.
- **Pid files.** Every pid file a manual step writes holds one JSON line with the pid, its start time, the pid namespace, the boot id and pid 1's start time. A step signals a recorded pid only while all five still match, so a pid the kernel reused, or one from another boot or container, is never signalled.
- **Commits:** local only, never push (a push to main redeploys every instance through Dokploy). Author and committer `tatsuya <allrested@gmail.com>`, overriding the container's M-DAQ `GIT_*` env for that command only, and always with an explicit pathspec:
  `git -C /workspace/utils/paseo add <paths> && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "<message>" -- <paths>`
  then check `git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'`. This checkout is shared: if `git diff --cached --name-only` lists a path the task did not stage, stop and ask; never commit or unstage it.
- **In-process safety.** The usage watch runs inside the daemon, and an unhandled rejection or uncaught exception exits it (`packages/server/src/server/daemon-worker.ts:373-381`). Every timer callback and fire-and-forget promise is guarded and logged; the watch's interval is `unref()`ed and stops in `bootstrap`'s `stop()`.
- **No secrets in files, logs or chat.** No step prints `PASEO_PASSWORD`, `~/.claude/settings.json`, `config.json` values or tokens. The manual test's throwaway dev password is printed once, because the browser form needs it.
- **Protocol compatibility** (`docs/protocol-compatibility.md`): new fields are optional, nothing narrows, the new `usage` attention reason reaches only clients that advertise `CLIENT_CAPS.usageNotifications`, and the app gates the heads-up on `server_info.features.usageHeadsUp`. Each delta carries a `Fork delta (usage heads-up)` comment.
- **Copy** (`docs/design.md` §10): sentence case, `...` and never `…`, no trailing period on labels and single-clause hints, imperative buttons. New strings go only in `packages/app/src/i18n/resources/en.ts`; every other locale aliases `sessionMove: en.sessionMove`.
- **Code style** (`docs/coding-standards.md`): function declarations, `interface` over `type` where a union is not needed, no `as` casts that bypass a type error (tests included), no nested ternaries, one object parameter for three or more arguments or any optional or boolean argument. Relative server imports carry `.js`.
- **Tests** (`docs/testing.md`): ports and adapters, deterministic assertions, no `vi.mock`, `vi.spyOn` of own exports, fake timers or monkey-patched globals in new test files. `websocket-server.notifications.test.ts` already mocks `ws` and `./session.js` at module level; new cases there reuse that harness and add no mock. Fixtures are typed explicitly, never widened with a cast.
- **Lessons that do not apply here, and why:** no plugin settings page is added, so no Command Center item is needed; Dismiss and the heads-up Move are not destructive (the move dialog's Move has no confirm either), so neither uses the two-press confirm the plugin SDK forces for destructive actions.
- **Formatting and lint:** `npm run format:files -- <paths>` and `npm run lint -- <paths>` from the repo root.

## Cross-plan interfaces

Sub-project 5 (claude-accounts, `docs/superpowers/specs/2026-11-06-claude-accounts-design.md`) builds on this plan and lands after it. Its daemon side (`packages/server/src/server/session/usage/usage-session.ts`) imports what it needs from this plan. Its built-in plugin cannot import `@getpaseo/protocol`, so it reads the daemon's results and mirrors no value from this plan.

| Interface                                                                                                                                                                                          | Produced by                              | What sub-project 5 relies on                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `usageHeadsUpTone` and its danger thresholds (`USAGE_DANGER_PCT = 95`, `RUN_OUT_DANGER_MS = 30 * 60_000`) in `@getpaseo/protocol/usage-heads-up`                                                   | Task 1                                   | Auto skips an account whose tightest window has the `danger` tone: 95% or more, or on pace to run out within 30 minutes. Its usage RPC carries the tone that `chooseTightestWindow` judged, so the plugin keeps no copy of either threshold.                                                                                                                                                                                                                                                                                                                                                                                                  |
| `chooseTightestWindow(windows, now)` in `@getpaseo/protocol/usage-heads-up`: rank windows by heads-up tone (`danger` > `warning` > `none`), then `usedPct` descending, then the sooner `runsOutAt` | Task 1; Task 3's `toMoveTarget` calls it | Its `tightestUsageWindow(reports, now)` calls it, so the accounts screen, Auto and the move dialog name the same window. Below 80% with no run-out it equals the old "highest `usedPct`" rule.                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `UsageScopeQuery`, `MoveTargetUsageLookup` and `sharedMoveTargetUsage` in `packages/server/src/server/agent/session-move/list-move-targets.ts`                                                     | Task 3                                   | `usage-session.ts` imports the two types instead of declaring copies, and `session.ts` passes `sharedMoveTargetUsage` to its `UsageSession`, so the accounts screen and the move dialog share one 60 s cache per provider.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Projected `runsOutAt` and `shortfallPct` on every `UsageReportEntry` window from `UsageSourceRegistry.listReports` and `listReportsForScope`                                                       | Task 2                                   | Every usage read carries them. Sub-project 5 reads each account's usage through `paseo.providers.listUsageForProvider(provider)` over its new `usage.provider.list_reports` RPC, which reads `listReportsForScope` (the user's choice on 2026-11-07). The legacy `paseo.providers.listUsage` (`packages/client/src/index.ts:483, 800`) stays unused there: its entries name the usage source (`claude`), not a Paseo provider such as `claude-work`, and it is tagged `COMPAT(providerUsageList)` for removal after 2027-03-26. A window may carry a projected `runsOutAt` its source never set; `tightestUsageWindow` reads it for the tone. |
| `AgentMoveTarget.runsOutAt?: string \| null` and `windowLabel?: string \| null`                                                                                                                    | Tasks 1 and 3                            | Optional on the wire; hosts without `server_info.features.usageHeadsUp` leave them out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `server_info.features.usageHeadsUp`                                                                                                                                                                | Tasks 1 and 3                            | Not used: the accounts screen shows no run-out.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `agent.move` RPC with `continueWork: true`, as the heads-up's Move sends it through `client.moveAgent(agentId, { provider }, { continueWork })`                                                    | existing, used in Task 5                 | `PaseoAgentHandle.move({ to, continueWork })` calls the same RPC.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `chooseBestMoveTarget` (lowest known `usedPct`, ties to the current family, nothing at or above the current account's usage)                                                                       | Task 1                                   | Not Auto's rule (Auto also falls back to plain `claude`); keep the two separate.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## Decisions the spec leaves open

1. **Pipeline check (spec: "The plan starts by confirming the pipeline can carry this payload").** The push leg carries any `{ title, body, data }` (`packages/server/src/server/push/push-service.ts`), and a tap opens the agent from `data.serverId` and `data.agentId` alone (`packages/app/src/notification-open/model.ts`). The in-app leg does not: `AgentAttentionRequiredMessageSchema.payload.reason` and `notification.data.reason` are a closed `z.enum(["finished","error","permission"])` (`packages/protocol/src/messages.ts:5084-5103`), and an old client would reject `usage`. The plan widens only the dedicated `agent_attention_required` message and gates `usage` on a new client capability `CLIENT_CAPS.usageNotifications = "usage_notifications"`; the legacy `agent_stream` `attention_required` event never carries it. That is the existing pipeline with a capability gate, not a second path, so the notification stays in scope. Tasks 6 and 7 hold all of it; a reviewer who rejects the gate can drop both, as the spec allows.
2. **Projection placement and keys.** It runs in `UsageSourceRegistry.fetchId`, keyed `${entryId}:${windowId}` (entry id is `${sourceId}:${accountKey}`), for available reports of a source that is still registered. The sample time and the spec's "now" are the entry's `fetchedAt` (the attempt start). A sample older than the newest one is skipped; keys idle for 2 hours are pruned; `unregister` forgets the source's keys.
3. **`shortfallPct`.** The Usage screen shows a run-out only when both `runsOutAt` and `shortfallPct` are set (`packages/app/src/usage/window-bar.tsx:47-51`), so the projection also fills `shortfallPct = usedPct + rate × (resetsAt − now) − 100`, rounded to two decimals, when the source left it empty. Without it the spec's "without UI changes" claim fails.
4. **Tightest window.** The old rule (highest `usedPct`) would hide a window at 60% that runs out in 20 minutes behind one at 75%. Windows now rank by heads-up tone, then `usedPct`, then the sooner run-out. A used-up window (100% is danger) still wins, so the limit notice and Move back keep their behavior. `runsOutAt` is carried only when it falls before that window's reset. The rule is one exported function, `chooseTightestWindow` in `usage-heads-up.ts` (Task 1): `toMoveTarget` calls it, and so does sub-project 5's `tightestUsageWindow`, so both name the same window. It reads only window fields and the tone rules beside it, the protocol package depends on no server code (`docs/architecture.md`), and it is no message schema, so the schema rules of `docs/protocol-validation.md` do not reach it.
5. **Best target, beyond the spec's rule.** Targets at 100% or more, and targets at or above the current account's `usedPct`, are not suggested (moving to a fuller account gains nothing). A target with unknown usage ranks after every known one. Ties go to the current target's family, then list order.
6. **Window label.** Shown verbatim ("84% of Weekly"), never lowercased: sources use labels such as `GPT-5.3-Codex-Spark · 5-hour` and `Weekly · Fable`, which no case rule survives.
7. **Dismiss.** Keyed by host and account window (`provider` plus window label), shared by every agent on that account, kept in memory only (an app restart shows the heads-up again), and ended once the reset time stored at dismissal passes. A heads-up that shows below 80% (pace only) is level 0, so dismissing it hides it until 80%.
8. **Feature gate and polling.** On hosts with `usageHeadsUp`, the banner mounts for every live agent and polls its move targets every `MOVE_BACK_RECHECK_MS` (5 minutes) while the panel is active; the move dialog never polls. Hosts without the flag keep today's banner.
9. **Danger look.** Alert variant `error`, matching the move dialog's `danger` badge (`TONE_BADGE_VARIANT` in `packages/app/src/session-move/move-targets.ts`); warning is variant `warning`.
10. **Heads-up Move.** Sends the best target with `model: undefined` (the target's default) and `continueWork: true`, through `useAgentMove`'s mutation, the same path as the dialog.
11. **Notification details.** The watch runs every 310 s (just over the registry's 5-minute cache, so each check reads a fresh report). It checks the account of each provider that has a running, foreground (`background !== true`), non-delegated agent in a workspace, mirroring `AgentManager.broadcastAgentAttention`'s skips. It names the first such agent on that provider, by its stored title or "Agent". A drop to a lower level re-arms the window (the projection treats a drop as a reset too). The first observation after a daemon start counts as a crossing. The daemon writes the copy in English like every other daemon notification: title `<account label> <pct>% of <window label>`, body `<agent> · Move to <target> · <pct>%`, or `<agent>` alone without a target. It is push-eligible, and the presence plan only counts clients that can show it.
12. **Manual test target.** The dev daemon has the `mock` provider but no second mock family (`extends` accepts only built-ins and `acp`, `packages/protocol/src/provider-config.ts:98`; `mock-slow` cannot create sessions). A throwaway directory plugin reports usage for `mock` (rising), 12% for the `claude` family and 99% for every other provider, so only Claude-family targets have room (move targets read usage by family: `packages/server/src/server/session.ts:3067-3069` today, `list-move-targets.ts` after Task 3), and the successful Move costs one short real Claude turn.
13. **No rollout task.** The spec has no rollout section: the feature ships with the fork's code and needs no per-instance file or setting. Deploying the fork build to the instances is sub-project 6 (ops), deferred; nothing in this plan pushes.

## File Structure

Created:

- `packages/protocol/src/usage-heads-up.ts`: thresholds, levels, tone, run-out, tightest-window and best-target rules shared by the daemon and the app.
- `packages/protocol/src/usage-heads-up.test.ts`
- `packages/protocol/src/messages.usage-heads-up.test.ts`: wire compatibility of the new fields and the `usage` reason.
- `packages/server/src/server/plugins/usage-sources/pace.ts`: the pace projection.
- `packages/server/src/server/plugins/usage-sources/pace.test.ts`
- `packages/server/src/server/agent/session-move/list-move-targets.ts`: `listMoveTargets` moved out of `session.ts`, so the usage watch can reuse it.
- `packages/server/src/server/agent/session-move/list-move-targets.test.ts`
- `packages/server/src/server/agent/session-move/usage-watch.ts`: crossing tracker, notification copy and the interval.
- `packages/server/src/server/agent/session-move/usage-watch.test.ts`
- `packages/app/src/session-move/usage-heads-up.ts`: the heads-up model, dismiss rule and copy.
- `packages/app/src/session-move/usage-heads-up.test.ts`
- `packages/app/src/session-move/usage-heads-up-store.ts`: in-memory dismissals.
- `packages/app/src/session-move/usage-heads-up-store.test.ts`

Modified:

- `packages/protocol/src/messages.ts`: `AgentMoveTargetSchema`, `features.usageHeadsUp`, the `usage` reason on `AgentAttentionRequiredMessageSchema`.
- `packages/protocol/src/client-capabilities.ts`: `usageNotifications`.
- `packages/protocol/src/agent-attention-notification.ts`: `AgentAttentionNotificationReason` and generic payload types.
- `packages/client/src/connection/index.ts`, `packages/client/src/daemon-client.ts`, `packages/client/src/daemon-client.test.ts`
- `packages/server/src/server/plugins/usage-sources/index.ts` and `index.test.ts`
- `packages/server/src/server/agent/session-move/move-targets.ts` and `move-targets.test.ts`
- `packages/server/src/server/session.ts`, `packages/server/src/server/websocket-server.ts`, `packages/server/src/server/websocket-server.notifications.test.ts`, `packages/server/src/server/bootstrap.ts`
- `packages/app/src/session-move/move-banner-view.ts`, `move-banner-view.test.ts`, `move-banner.tsx`, `use-agent-move.ts`, `move-targets.ts`, `move-targets.test.ts`, `move-dialog.tsx`
- `packages/app/src/contexts/session-context.tsx`, `packages/app/src/i18n/resources/en.ts`
- `docs/agent-lifecycle.md` ("Moving a session") and `docs/plugins.md` ("Usage sources"), in Task 8

---

### Task 1: Shared heads-up rules and the move target fields

**Files:**

- Create: `packages/protocol/src/usage-heads-up.ts`
- Create: `packages/protocol/src/usage-heads-up.test.ts`
- Create: `packages/protocol/src/messages.usage-heads-up.test.ts`
- Modify: `packages/protocol/src/messages.ts:2177-2185` (`AgentMoveTargetSchema`) and `:3797-3798` (features, after `agentMove`)

**Interfaces:**

- Consumes: `AgentMoveTargetSchema` (`packages/protocol/src/messages.ts:2177`), `export type AgentMoveTarget = z.infer<typeof AgentMoveTargetSchema>` (`:7508`).
- Produces (`@getpaseo/protocol/usage-heads-up`):
  - `USAGE_HEADS_UP_PCT = 80`, `USAGE_DANGER_PCT = 95`, `USAGE_FULL_PCT = 100`, `RUN_OUT_HEADS_UP_MS = 10_800_000`, `RUN_OUT_DANGER_MS = 1_800_000`
  - `type UsageLevel = 0 | 1 | 2`, `type UsageHeadsUpTone = "none" | "warning" | "danger"`
  - `interface UsagePace { usedPct: number | null; resetsAt: string | null; runsOutAt: string | null }`
  - `interface UsageWindowPct { usedPct?: number | null; remainingPct?: number | null }`
  - `windowUsedPct(window: UsageWindowPct): number | null`
  - `usageLevel(usedPct: number | null): UsageLevel`
  - `msUntilRunOut(pace: UsagePace, now: number): number | null` (null without a run-out or when it is at or after the reset; 0 when it has passed)
  - `usageHeadsUpTone(pace: UsagePace, now: number): UsageHeadsUpTone`
  - `interface UsageWindowPace extends UsageWindowPct { resetsAt?: string | null; runsOutAt?: string | null }`
  - `interface TightestWindow<W extends UsageWindowPace> { window: W; usedPct: number; resetsAt: string | null; runsOutAt: string | null; tone: UsageHeadsUpTone }`
  - `chooseTightestWindow<W extends UsageWindowPace>(windows: readonly W[], now: number): TightestWindow<W> | null`: the nearer heads-up tone first, then `usedPct` descending, then the sooner `runsOutAt`, and the first of a full tie; a window without a used share is skipped, and `runsOutAt` is kept only before the reset. Task 3's `toMoveTarget` and sub-project 5's `tightestUsageWindow` call it.
  - `interface MoveTargetUsage { provider: string; family: string; available: boolean; current: boolean; usedPct: number | null }`
  - `chooseBestMoveTarget<T extends MoveTargetUsage>(targets: readonly T[]): T | null`
  - Wire: `AgentMoveTarget.runsOutAt?: string | null`, `AgentMoveTarget.windowLabel?: string | null`, `server_info.features.usageHeadsUp?: boolean`.

- [ ] **Step 1: Write the failing rules test.** Create `packages/protocol/src/usage-heads-up.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  RUN_OUT_DANGER_MS,
  RUN_OUT_HEADS_UP_MS,
  chooseBestMoveTarget,
  chooseTightestWindow,
  msUntilRunOut,
  usageHeadsUpTone,
  usageLevel,
  windowUsedPct,
  type MoveTargetUsage,
  type UsagePace,
  type UsageWindowPace,
} from "./usage-heads-up.js";

const NOW = Date.parse("2026-11-06T10:00:00.000Z");
const MINUTE = 60_000;
const LATE_RESET = "2026-11-07T10:00:00.000Z";

function at(offsetMs: number): string {
  return new Date(NOW + offsetMs).toISOString();
}

function pace(overrides: Partial<UsagePace>): UsagePace {
  return { usedPct: 50, resetsAt: LATE_RESET, runsOutAt: null, ...overrides };
}

function target(overrides: Partial<MoveTargetUsage> & { provider: string }): MoveTargetUsage {
  return { family: "claude", available: true, current: false, usedPct: null, ...overrides };
}

/** A usage window with the label its source gives it. */
interface LabelledWindow extends UsageWindowPace {
  label: string;
}

function usageWindow(label: string, fields: UsageWindowPace): LabelledWindow {
  return { label, ...fields };
}

describe("windowUsedPct", () => {
  it("reads used percent, or derives it from remaining percent", () => {
    expect(windowUsedPct({ usedPct: 40, remainingPct: 10 })).toBe(40);
    expect(windowUsedPct({ remainingPct: 75 })).toBe(25);
    expect(windowUsedPct({ usedPct: null, remainingPct: null })).toBeNull();
  });
});

describe("usageLevel", () => {
  it("steps at 80% and 95%", () => {
    expect([null, 79.9, 80, 94.9, 95, 100].map(usageLevel)).toEqual([0, 0, 1, 1, 2, 2]);
  });
});

describe("msUntilRunOut", () => {
  it("counts down to a run-out that comes before the reset", () => {
    expect(msUntilRunOut(pace({ runsOutAt: at(90 * MINUTE) }), NOW)).toBe(90 * MINUTE);
  });

  it("is null without a run-out, or with one at or after the reset", () => {
    expect(msUntilRunOut(pace({}), NOW)).toBeNull();
    expect(
      msUntilRunOut(pace({ runsOutAt: at(60 * MINUTE), resetsAt: at(60 * MINUTE) }), NOW),
    ).toBeNull();
    expect(
      msUntilRunOut(pace({ runsOutAt: at(61 * MINUTE), resetsAt: at(60 * MINUTE) }), NOW),
    ).toBeNull();
  });

  it("keeps a run-out without a known reset, and reads a passed one as now", () => {
    expect(msUntilRunOut(pace({ resetsAt: null, runsOutAt: at(5 * MINUTE) }), NOW)).toBe(
      5 * MINUTE,
    );
    expect(msUntilRunOut(pace({ runsOutAt: at(-5 * MINUTE) }), NOW)).toBe(0);
  });
});

describe("usageHeadsUpTone", () => {
  it("warns from 80% and turns to danger at 95%", () => {
    expect([79, 80, 94, 95].map((usedPct) => usageHeadsUpTone(pace({ usedPct }), NOW))).toEqual([
      "none",
      "warning",
      "warning",
      "danger",
    ]);
  });

  it("warns on pace to run out within 3 hours, and turns to danger within 30 minutes", () => {
    const runningOut = (ms: number) =>
      usageHeadsUpTone(pace({ usedPct: 60, runsOutAt: at(ms) }), NOW);
    expect(runningOut(RUN_OUT_HEADS_UP_MS + MINUTE)).toBe("none");
    expect(runningOut(RUN_OUT_HEADS_UP_MS)).toBe("warning");
    expect(runningOut(RUN_OUT_DANGER_MS + MINUTE)).toBe("warning");
    expect(runningOut(RUN_OUT_DANGER_MS)).toBe("danger");
  });

  it("ignores a run-out that falls after the reset", () => {
    expect(
      usageHeadsUpTone(
        pace({ usedPct: 60, runsOutAt: at(20 * MINUTE), resetsAt: at(10 * MINUTE) }),
        NOW,
      ),
    ).toBe("none");
  });
});

describe("chooseBestMoveTarget", () => {
  const current = target({ provider: "claude-work", current: true, usedPct: 84 });

  it("picks the available target with the lowest usage", () => {
    const kiro = target({ provider: "kiro", family: "kiro", usedPct: 12 });
    expect(
      chooseBestMoveTarget([
        current,
        target({ provider: "codex", family: "codex", usedPct: 40 }),
        kiro,
      ]),
    ).toBe(kiro);
  });

  it("skips the current, unavailable and used-up targets", () => {
    expect(
      chooseBestMoveTarget([
        current,
        target({ provider: "codex", family: "codex", usedPct: 5, available: false }),
        target({ provider: "kiro", family: "kiro", usedPct: 100 }),
      ]),
    ).toBeNull();
  });

  it("never suggests an account at or above the current one's usage", () => {
    expect(
      chooseBestMoveTarget([current, target({ provider: "codex", family: "codex", usedPct: 84 })]),
    ).toBeNull();
  });

  it("gives a tie to the current account's family, because that move is native", () => {
    const personal = target({ provider: "claude-personal", usedPct: 12 });
    expect(
      chooseBestMoveTarget([
        current,
        target({ provider: "kiro", family: "kiro", usedPct: 12 }),
        personal,
      ]),
    ).toBe(personal);
  });

  it("ranks a target with unknown usage after every known one, and offers it when nothing else has room", () => {
    const opencode = target({ provider: "opencode", family: "opencode", usedPct: null });
    const kiro = target({ provider: "kiro", family: "kiro", usedPct: 70 });
    expect(chooseBestMoveTarget([current, opencode, kiro])).toBe(kiro);
    expect(chooseBestMoveTarget([current, opencode])).toBe(opencode);
  });
});

describe("chooseTightestWindow", () => {
  it("picks the fullest window while none has a heads-up, and the first of a tie", () => {
    const session = usageWindow("Session", { usedPct: 40, resetsAt: LATE_RESET });
    const weekly = usageWindow("Weekly", { remainingPct: 30, resetsAt: LATE_RESET });
    const monthly = usageWindow("Monthly", { usedPct: 70, resetsAt: LATE_RESET });
    expect(chooseTightestWindow([session, weekly, monthly], NOW)).toEqual({
      window: weekly,
      usedPct: 70,
      resetsAt: LATE_RESET,
      runsOutAt: null,
      tone: "none",
    });
  });

  it("ranks a 60% window that runs out in 20 minutes above a 75% one with no run-out", () => {
    const weekly = usageWindow("Weekly", { usedPct: 75, resetsAt: LATE_RESET });
    const session = usageWindow("Session", {
      usedPct: 60,
      resetsAt: at(240 * MINUTE),
      runsOutAt: at(20 * MINUTE),
    });
    expect(chooseTightestWindow([weekly, session], NOW)).toEqual({
      window: session,
      usedPct: 60,
      resetsAt: at(240 * MINUTE),
      runsOutAt: at(20 * MINUTE),
      tone: "danger",
    });
  });

  it("keeps a used-up window tightest, and breaks a tie on the sooner run-out", () => {
    const usedUp = usageWindow("Session", { usedPct: 100, resetsAt: at(120 * MINUTE) });
    const runningOut = usageWindow("Weekly", {
      usedPct: 96,
      resetsAt: LATE_RESET,
      runsOutAt: at(10 * MINUTE),
    });
    expect(chooseTightestWindow([runningOut, usedUp], NOW)?.window).toBe(usedUp);

    const later = usageWindow("Weekly", {
      usedPct: 85,
      resetsAt: LATE_RESET,
      runsOutAt: at(150 * MINUTE),
    });
    const sooner = usageWindow("Monthly", {
      usedPct: 85,
      resetsAt: LATE_RESET,
      runsOutAt: at(100 * MINUTE),
    });
    expect(chooseTightestWindow([later, sooner], NOW)?.window).toBe(sooner);
  });

  it("skips a window without a used share and drops a run-out that falls after the reset", () => {
    const extra = usageWindow("Extra usage", {});
    expect(chooseTightestWindow([extra], NOW)).toBeNull();
    const weekly = usageWindow("Weekly", {
      usedPct: 50,
      resetsAt: at(60 * MINUTE),
      runsOutAt: at(90 * MINUTE),
    });
    expect(chooseTightestWindow([extra, weekly], NOW)).toEqual({
      window: weekly,
      usedPct: 50,
      resetsAt: at(60 * MINUTE),
      runsOutAt: null,
      tone: "none",
    });
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

```bash
cd /workspace/utils/paseo/packages/protocol && flock /tmp/paseo-heavy.lock npx vitest run src/usage-heads-up.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './usage-heads-up.js' imported from /workspace/utils/paseo/packages/protocol/src/usage-heads-up.test.ts`, and no test runs.

- [ ] **Step 3: Write the rules.** Create `packages/protocol/src/usage-heads-up.ts`:

```ts
/**
 * Fork delta (usage heads-up): the thresholds and rules that the daemon's usage notifications and
 * the app's heads-up notice share, so both step at the same levels.
 */

/** From this much usage of a window, the agent screen warns and the daemon notifies once. */
export const USAGE_HEADS_UP_PCT = 80;
/** From this much usage, the warning turns to danger and the daemon notifies again. */
export const USAGE_DANGER_PCT = 95;
/** An account at or past this much usage cannot take another turn. */
export const USAGE_FULL_PCT = 100;
/** A projected run-out this close warns, at any usage. */
export const RUN_OUT_HEADS_UP_MS = 3 * 60 * 60_000;
/** A projected run-out this close is danger, at any usage. */
export const RUN_OUT_DANGER_MS = 30 * 60_000;

/** 0 below the heads-up, 1 from 80%, 2 from 95%. Notifications and dismissals step on these. */
export type UsageLevel = 0 | 1 | 2;

export type UsageHeadsUpTone = "none" | "warning" | "danger";

/** What the rules read from one usage window. */
export interface UsagePace {
  usedPct: number | null;
  resetsAt: string | null;
  runsOutAt: string | null;
}

/** The percentages a usage window may report. */
export interface UsageWindowPct {
  usedPct?: number | null;
  remainingPct?: number | null;
}

/** A window's used percent, derived from its remaining percent when that is all it reports. */
export function windowUsedPct(window: UsageWindowPct): number | null {
  if (typeof window.usedPct === "number") return window.usedPct;
  return typeof window.remainingPct === "number" ? 100 - window.remainingPct : null;
}

export function usageLevel(usedPct: number | null): UsageLevel {
  if (usedPct === null) return 0;
  if (usedPct >= USAGE_DANGER_PCT) return 2;
  if (usedPct >= USAGE_HEADS_UP_PCT) return 1;
  return 0;
}

/**
 * Milliseconds until the window runs out at its current pace: null without a run-out or when the
 * run-out comes at or after the reset, and 0 once it has passed.
 */
export function msUntilRunOut(pace: UsagePace, now: number): number | null {
  if (pace.runsOutAt === null) return null;
  const runsOut = Date.parse(pace.runsOutAt);
  if (!Number.isFinite(runsOut)) return null;
  if (pace.resetsAt !== null) {
    const resets = Date.parse(pace.resetsAt);
    if (Number.isFinite(resets) && runsOut >= resets) return null;
  }
  return Math.max(0, runsOut - now);
}

/** Warning from 80% or a run-out within 3 hours; danger from 95% or a run-out within 30 minutes. */
export function usageHeadsUpTone(pace: UsagePace, now: number): UsageHeadsUpTone {
  const level = usageLevel(pace.usedPct);
  const runOutMs = msUntilRunOut(pace, now);
  if (level === 2 || (runOutMs !== null && runOutMs <= RUN_OUT_DANGER_MS)) return "danger";
  if (level === 1 || (runOutMs !== null && runOutMs <= RUN_OUT_HEADS_UP_MS)) return "warning";
  return "none";
}

/** What the tightest-window choice reads from a window: `UsagePace` as a source reports it. */
export interface UsageWindowPace extends UsageWindowPct {
  resetsAt?: string | null;
  runsOutAt?: string | null;
}

/** The tightest window and the values the choice judged it by. */
export interface TightestWindow<W extends UsageWindowPace> {
  window: W;
  usedPct: number;
  resetsAt: string | null;
  /** The window's run-out, kept only while it comes before the reset. */
  runsOutAt: string | null;
  tone: UsageHeadsUpTone;
}

const TONE_RANK: Record<UsageHeadsUpTone, number> = { none: 0, warning: 1, danger: 2 };

/**
 * The window closest to running out at `now`: the nearer heads-up first, then the fuller window,
 * then the sooner run-out, and the first of a full tie. Below any heads-up this is the fullest
 * window. Windows without a used share are skipped; null when none has one.
 */
export function chooseTightestWindow<W extends UsageWindowPace>(
  windows: readonly W[],
  now: number,
): TightestWindow<W> | null {
  let tightest: TightestWindow<W> | null = null;
  for (const window of windows) {
    const judged = judgeWindow(window, now);
    if (judged !== null && (tightest === null || isTighter(judged, tightest))) tightest = judged;
  }
  return tightest;
}

function judgeWindow<W extends UsageWindowPace>(window: W, now: number): TightestWindow<W> | null {
  const usedPct = windowUsedPct(window);
  if (usedPct === null) return null;
  const pace: UsagePace = {
    usedPct,
    resetsAt: window.resetsAt ?? null,
    runsOutAt: window.runsOutAt ?? null,
  };
  return {
    window,
    usedPct,
    resetsAt: pace.resetsAt,
    runsOutAt: msUntilRunOut(pace, now) === null ? null : pace.runsOutAt,
    tone: usageHeadsUpTone(pace, now),
  };
}

function runOutTime(window: TightestWindow<UsageWindowPace>): number {
  return window.runsOutAt === null ? Number.POSITIVE_INFINITY : Date.parse(window.runsOutAt);
}

function isTighter(
  candidate: TightestWindow<UsageWindowPace>,
  tightest: TightestWindow<UsageWindowPace>,
): boolean {
  if (candidate.tone !== tightest.tone) return TONE_RANK[candidate.tone] > TONE_RANK[tightest.tone];
  if (candidate.usedPct !== tightest.usedPct) return candidate.usedPct > tightest.usedPct;
  return runOutTime(candidate) < runOutTime(tightest);
}

/** What the best-target choice reads from a move target. */
export interface MoveTargetUsage {
  provider: string;
  family: string;
  available: boolean;
  current: boolean;
  usedPct: number | null;
}

/**
 * Where a one-click move goes: the available target with the lowest usage, ties going to the
 * current account's family because that move is native. A target with unknown usage comes after
 * every known one. Null when no target has room.
 */
export function chooseBestMoveTarget<T extends MoveTargetUsage>(targets: readonly T[]): T | null {
  const current = targets.find((target) => target.current) ?? null;
  let best: T | null = null;
  for (const candidate of targets) {
    if (!hasRoom({ candidate, current })) continue;
    if (best === null || ranksBefore({ candidate, best, family: current?.family ?? null })) {
      best = candidate;
    }
  }
  return best;
}

function hasRoom(input: { candidate: MoveTargetUsage; current: MoveTargetUsage | null }): boolean {
  const { candidate, current } = input;
  if (!candidate.available || candidate.current) return false;
  if (candidate.usedPct === null) return true;
  if (candidate.usedPct >= USAGE_FULL_PCT) return false;
  // A move to an account at least as used as the current one gains nothing.
  if (current === null || current.usedPct === null) return true;
  return candidate.usedPct < current.usedPct;
}

function ranksBefore(input: {
  candidate: MoveTargetUsage;
  best: MoveTargetUsage;
  family: string | null;
}): boolean {
  const { candidate, best, family } = input;
  if (candidate.usedPct !== best.usedPct) {
    if (candidate.usedPct === null) return false;
    if (best.usedPct === null) return true;
    return candidate.usedPct < best.usedPct;
  }
  return family !== null && candidate.family === family && best.family !== family;
}
```

- [ ] **Step 4: Run it to see it pass.** Same command as Step 2. Expected: PASS, 17 tests (4 of them for `chooseTightestWindow`).

- [ ] **Step 5: Write the failing wire test.** Create `packages/protocol/src/messages.usage-heads-up.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { AgentMoveTargetSchema, type AgentMoveTarget } from "./messages.js";

const TARGET: AgentMoveTarget = {
  provider: "claude-work",
  label: "Claude (work)",
  family: "claude",
  available: true,
  current: true,
  usedPct: 84,
  resetsAt: "2026-11-07T09:00:00.000Z",
};

describe("AgentMoveTargetSchema (usage heads-up)", () => {
  it("still reads a target from a host that sends no run-out or window label", () => {
    expect(AgentMoveTargetSchema.parse(TARGET)).toEqual(TARGET);
  });

  it("keeps the run-out and the window label", () => {
    const withPace = { ...TARGET, runsOutAt: "2026-11-06T14:00:00.000Z", windowLabel: "Weekly" };
    expect(AgentMoveTargetSchema.parse(withPace)).toEqual(withPace);
    const unknown = { ...TARGET, runsOutAt: null, windowLabel: null };
    expect(AgentMoveTargetSchema.parse(unknown)).toEqual(unknown);
  });
});
```

- [ ] **Step 6: Run it to see it fail.**

```bash
cd /workspace/utils/paseo/packages/protocol && flock /tmp/paseo-heavy.lock npx vitest run src/messages.usage-heads-up.test.ts --bail=1
```

Expected: FAIL on "keeps the run-out and the window label": zod strips the unknown keys, so the parsed value lacks `runsOutAt` and `windowLabel`. "still reads a target from a host that sends no run-out or window label" passes already: it guards the old shape, so it must keep passing after Step 7.

- [ ] **Step 7: Add the fields and the feature flag.** In `packages/protocol/src/messages.ts`, replace

```ts
  usedPct: z.number().nullable(),
  resetsAt: z.string().nullable(),
});

export const AgentMoveTargetsRequestMessageSchema = z.object({
```

with

```ts
  usedPct: z.number().nullable(),
  resetsAt: z.string().nullable(),
  // Fork delta (usage heads-up): the tightest window's projected run-out and label.
  runsOutAt: z.string().nullable().optional(),
  windowLabel: z.string().nullable().optional(),
});

export const AgentMoveTargetsRequestMessageSchema = z.object({
```

and replace

```ts
        agentMove: z.boolean().optional(),
```

with

```ts
        agentMove: z.boolean().optional(),
        // Fork delta (usage heads-up): move targets carry runsOutAt and windowLabel, and usage
        // windows a projected run-out.
        usageHeadsUp: z.boolean().optional(),
```

- [ ] **Step 8: Run both protocol tests.** Run Step 6's command, then Step 2's. Expected: PASS (2 tests), then PASS (17 tests).

- [ ] **Step 9: Format, lint, typecheck and build the protocol.**

```bash
cd /workspace/utils/paseo && npm run format:files -- packages/protocol/src/usage-heads-up.ts packages/protocol/src/usage-heads-up.test.ts packages/protocol/src/messages.usage-heads-up.test.ts packages/protocol/src/messages.ts && npm run lint -- packages/protocol/src/usage-heads-up.ts packages/protocol/src/usage-heads-up.test.ts packages/protocol/src/messages.usage-heads-up.test.ts packages/protocol/src/messages.ts && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/protocol -- --singleThreaded && flock /tmp/paseo-heavy.lock npm run build:protocol && ls packages/protocol/dist/usage-heads-up.js
```

Expected: every command exits 0 and the last prints `packages/protocol/dist/usage-heads-up.js`.

- [ ] **Step 10: Commit.**

```bash
git -C /workspace/utils/paseo add packages/protocol/src/usage-heads-up.ts packages/protocol/src/usage-heads-up.test.ts packages/protocol/src/messages.usage-heads-up.test.ts packages/protocol/src/messages.ts && git -C /workspace/utils/paseo diff --cached --name-only && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(protocol): usage heads-up rules and move target run-outs" -- packages/protocol/src/usage-heads-up.ts packages/protocol/src/usage-heads-up.test.ts packages/protocol/src/messages.usage-heads-up.test.ts packages/protocol/src/messages.ts && git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
```

Expected: the staged list is exactly the four paths, the hook passes, and the last line is `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.

---

### Task 2: Pace projection in the usage registry

**Files:**

- Create: `packages/server/src/server/plugins/usage-sources/pace.ts`
- Create: `packages/server/src/server/plugins/usage-sources/pace.test.ts`
- Modify: `packages/server/src/server/plugins/usage-sources/index.ts` (imports at 1-12, fields at 54-61, `unregister` at 75-88, `fetchId` at 292-337)
- Modify: `packages/server/src/server/plugins/usage-sources/index.test.ts` (append two tests)

**Interfaces:**

- Consumes: `windowUsedPct(window: UsageWindowPct): number | null` from `@getpaseo/protocol/usage-heads-up` (Task 1). `ProviderUsageWindow`, `UsageReport`, `UsageReportEntry` from `@getpaseo/protocol/messages` (`messages.ts:7561-7566`). `UsageSourceRegistry` (`index.ts:54`), its constructor `(now = Date.now, ttlMs = 300_000, logger, agents, deadlineMs = 20_000)` (`index.ts:62-68`), private `fetchId(id, known, forceRefresh)` (`index.ts:292`), and the test helper `source({ id, discover?, fetch? })` (`index.test.ts:69-82`).
- Produces:
  - `PACE_SAMPLE_MS = 7_200_000`, `PACE_MIN_SPAN_MS = 600_000`
  - `interface UsagePaceTracker { project(input: { key: string; window: ProviderUsageWindow; at: number }): ProviderUsageWindow; forget(prefix: string): void }`
  - `createUsagePace(): UsagePaceTracker`
  - Every available `UsageReportEntry` from `UsageSourceRegistry.listReports` and `listReportsForScope` has `runsOutAt` (to the second) and `shortfallPct` (two decimals) set on a window that the source left without `runsOutAt`, once two samples 10 minutes apart show usage rising and the run-out falls before `resetsAt`. Tasks 3 and 7 read them through `listReportsForScope`.

- [ ] **Step 1: Write the failing projection test.** Create `packages/server/src/server/plugins/usage-sources/pace.test.ts`:

```ts
import { describe, expect, test } from "vitest";
import type { ProviderUsageWindow } from "@getpaseo/protocol/messages";
import { createUsagePace, type UsagePaceTracker } from "./pace.js";

const T0 = Date.parse("2026-11-06T10:00:00.000Z");
const MINUTE = 60_000;
const RESETS_AT = "2026-11-06T14:00:00.000Z";
const KEY = "claude:work:weekly";

function weekly(overrides: Partial<ProviderUsageWindow> = {}): ProviderUsageWindow {
  return { id: "weekly", label: "Weekly", resetsAt: RESETS_AT, ...overrides };
}

/** Feeds `[minutes after T0, window]` samples in order and returns the last projection. */
function feed(
  pace: UsagePaceTracker,
  samples: Array<[number, ProviderUsageWindow]>,
): ProviderUsageWindow | null {
  let last: ProviderUsageWindow | null = null;
  for (const [minutes, window] of samples) {
    last = pace.project({ key: KEY, window, at: T0 + minutes * MINUTE });
  }
  return last;
}

describe("createUsagePace", () => {
  test("projects the run-out from the slope between the oldest and newest sample", () => {
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 50 })],
        [10, weekly({ usedPct: 58 })],
        [20, weekly({ usedPct: 60 })],
      ]),
    ).toEqual(weekly({ usedPct: 60, runsOutAt: "2026-11-06T11:40:00.000Z", shortfallPct: 70 }));
  });

  test("leaves a single sample unprojected", () => {
    expect(feed(createUsagePace(), [[0, weekly({ usedPct: 50 })]])).toEqual(
      weekly({ usedPct: 50 }),
    );
  });

  test("needs the oldest and newest sample ten minutes apart", () => {
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 50 })],
        [9, weekly({ usedPct: 60 })],
      ]),
    ).toEqual(weekly({ usedPct: 60 }));
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 50 })],
        [10, weekly({ usedPct: 60 })],
      ]),
    ).toEqual(weekly({ usedPct: 60, runsOutAt: "2026-11-06T10:50:00.000Z", shortfallPct: 190 }));
  });

  test("leaves runsOutAt empty when the run-out falls after the reset", () => {
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 10 })],
        [60, weekly({ usedPct: 11 })],
      ]),
    ).toEqual(weekly({ usedPct: 11 }));
  });

  test("starts the samples over after a drop, which is a reset", () => {
    const pace = createUsagePace();
    expect(
      feed(pace, [
        [0, weekly({ usedPct: 50 })],
        [20, weekly({ usedPct: 90 })],
        [30, weekly({ usedPct: 5 })],
        [35, weekly({ usedPct: 10 })],
      ]),
    ).toEqual(weekly({ usedPct: 10 }));
    expect(feed(pace, [[45, weekly({ usedPct: 15 })]])).toEqual(
      weekly({ usedPct: 15, runsOutAt: "2026-11-06T12:52:30.000Z", shortfallPct: 45 }),
    );
  });

  test("keeps the run-out a source set itself", () => {
    const own = weekly({ usedPct: 60, runsOutAt: "2026-11-06T13:00:00.000Z", shortfallPct: 3 });
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 50 })],
        [20, own],
      ]),
    ).toEqual(own);
  });

  test("derives used percent from remaining percent", () => {
    expect(
      feed(createUsagePace(), [
        [0, weekly({ remainingPct: 50 })],
        [20, weekly({ remainingPct: 40 })],
      ]),
    ).toEqual(
      weekly({ remainingPct: 40, runsOutAt: "2026-11-06T11:40:00.000Z", shortfallPct: 70 }),
    );
  });

  test("projects nothing without a reset time, for a used-up window, or for flat usage", () => {
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 50, resetsAt: null })],
        [20, weekly({ usedPct: 60, resetsAt: null })],
      ]),
    ).toEqual(weekly({ usedPct: 60, resetsAt: null }));
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 90 })],
        [20, weekly({ usedPct: 100 })],
      ]),
    ).toEqual(weekly({ usedPct: 100 }));
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 50 })],
        [20, weekly({ usedPct: 50 })],
      ]),
    ).toEqual(weekly({ usedPct: 50 }));
  });

  test("uses only the samples of the last two hours", () => {
    const late = (usedPct: number) => weekly({ usedPct, resetsAt: "2026-11-06T18:00:00.000Z" });
    expect(
      feed(createUsagePace(), [
        [0, late(20)],
        [90, late(50)],
        [130, late(60)],
      ]),
    ).toEqual({ ...late(60), runsOutAt: "2026-11-06T14:50:00.000Z", shortfallPct: 47.5 });
  });

  test("ignores a sample older than the newest instead of reading it as a reset", () => {
    expect(
      feed(createUsagePace(), [
        [0, weekly({ usedPct: 40 })],
        [20, weekly({ usedPct: 60 })],
        [10, weekly({ usedPct: 45 })],
      ]),
    ).toEqual(weekly({ usedPct: 45 }));
    const pace = createUsagePace();
    feed(pace, [
      [0, weekly({ usedPct: 40 })],
      [20, weekly({ usedPct: 60 })],
      [10, weekly({ usedPct: 45 })],
    ]);
    expect(feed(pace, [[30, weekly({ usedPct: 70 })]])).toEqual(
      weekly({ usedPct: 70, runsOutAt: "2026-11-06T11:00:00.000Z", shortfallPct: 180 }),
    );
  });

  test("keeps account windows apart and forgets a removed source's windows", () => {
    const pace = createUsagePace();
    pace.project({ key: "claude:work:weekly", window: weekly({ usedPct: 50 }), at: T0 });
    pace.project({ key: "codex:work:weekly", window: weekly({ usedPct: 10 }), at: T0 });
    pace.forget("claude:");
    const later = T0 + 20 * MINUTE;
    expect(
      pace.project({ key: "claude:work:weekly", window: weekly({ usedPct: 60 }), at: later }),
    ).toEqual(weekly({ usedPct: 60 }));
    expect(
      pace.project({ key: "codex:work:weekly", window: weekly({ usedPct: 20 }), at: later }),
    ).toEqual(weekly({ usedPct: 20, runsOutAt: "2026-11-06T13:00:00.000Z", shortfallPct: 30 }));
  });
});
```

The expected values: 10 points over 20 minutes is 0.5 per minute, so 40 points left run out in 80 minutes (10:20 + 80 = 11:40), and by the 14:00 reset usage would reach 60 + 0.5 × 220 = 170, a shortfall of 70. After the drop, 5 → 15 over 15 minutes leaves 85 points at 2/3 per minute, 127.5 minutes after 10:45. In the two-hour test the 10:00 sample is 130 minutes old, so the rate comes from 50 → 60 over 40 minutes.

- [ ] **Step 2: Run it to see it fail.**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/usage-sources/pace.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './pace.js' imported from /workspace/utils/paseo/packages/server/src/server/plugins/usage-sources/pace.test.ts`, and no test runs.

- [ ] **Step 3: Write the projection.** Create `packages/server/src/server/plugins/usage-sources/pace.ts`:

```ts
import type { ProviderUsageWindow } from "@getpaseo/protocol/messages";
import { windowUsedPct } from "@getpaseo/protocol/usage-heads-up";

/** Samples older than this are dropped, and a window idle this long is forgotten. */
export const PACE_SAMPLE_MS = 2 * 60 * 60_000;
/** The oldest and newest sample must be this far apart before they give a rate. */
export const PACE_MIN_SPAN_MS = 10 * 60_000;

interface PaceSample {
  at: number;
  usedPct: number;
}

export interface UsagePaceTracker {
  /**
   * Records the window's usage as fetched at `at`. Returns the window with `runsOutAt` and
   * `shortfallPct` filled in when the source left `runsOutAt` empty and the pace runs the window
   * out before it resets; otherwise returns it unchanged.
   */
  project(input: { key: string; window: ProviderUsageWindow; at: number }): ProviderUsageWindow;
  /** Drops the samples of every key that starts with `prefix`. */
  forget(prefix: string): void;
}

function roundPct(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Fork delta (usage heads-up): projects when a window runs out from how fast its usage rose over
 * the last two hours. A drop in usage means the window reset, so its samples start over.
 */
// ponytail: one map entry per account window; an entry idle for PACE_SAMPLE_MS is pruned.
export function createUsagePace(): UsagePaceTracker {
  const samples = new Map<string, PaceSample[]>();

  function prune(at: number): void {
    for (const [key, kept] of samples) {
      const newest = kept[kept.length - 1];
      if (!newest || at - newest.at > PACE_SAMPLE_MS) samples.delete(key);
    }
  }

  /** The window's samples with this one added, or null when a newer sample is already in. */
  function record(key: string, sample: PaceSample): PaceSample[] | null {
    const kept = (samples.get(key) ?? []).filter((old) => sample.at - old.at <= PACE_SAMPLE_MS);
    const newest = kept[kept.length - 1];
    if (newest && sample.at <= newest.at) return null;
    const next = newest && sample.usedPct < newest.usedPct ? [sample] : [...kept, sample];
    samples.set(key, next);
    return next;
  }

  return {
    project({ key, window, at }) {
      prune(at);
      const usedPct = windowUsedPct(window);
      if (usedPct === null) return window;
      const kept = record(key, { at, usedPct });
      if (kept === null || window.runsOutAt != null) return window;
      const resetsAt = window.resetsAt ? Date.parse(window.resetsAt) : Number.NaN;
      if (!Number.isFinite(resetsAt) || usedPct >= 100) return window;
      const oldest = kept[0];
      const newest = kept[kept.length - 1];
      if (!oldest || !newest || newest.at - oldest.at < PACE_MIN_SPAN_MS) return window;
      const ratePerMs = (newest.usedPct - oldest.usedPct) / (newest.at - oldest.at);
      if (ratePerMs <= 0) return window;
      // Usage is reported to the minute at best, so the run-out is kept to the second.
      const runsOut = Math.round((at + (100 - usedPct) / ratePerMs) / 1000) * 1000;
      if (runsOut >= resetsAt) return window;
      return {
        ...window,
        runsOutAt: new Date(runsOut).toISOString(),
        shortfallPct: window.shortfallPct ?? roundPct(usedPct + ratePerMs * (resetsAt - at) - 100),
      };
    },
    forget(prefix) {
      for (const key of samples.keys()) if (key.startsWith(prefix)) samples.delete(key);
    },
  };
}
```

- [ ] **Step 4: Run it to see it pass.** Same command as Step 2. Expected: PASS, 11 tests.

- [ ] **Step 5: Write the failing registry tests.** Append to `packages/server/src/server/plugins/usage-sources/index.test.ts`, and add `import type { ProviderUsageWindow, UsageReportEntry } from "@getpaseo/protocol/messages";` after the existing `import { UsageSourceRegistry } from "./index.js";` line:

```ts
const PACE_RESETS_AT = "2026-11-06T14:00:00.000Z";

/** A Claude account whose weekly usage takes the next value of `usedPcts` on every fetch. */
function risingSource(usedPcts: number[]) {
  return source({
    id: "claude",
    discover: async () => [{ key: "work", input: {} }],
    fetch: async () => ({
      status: "available",
      windows: [
        { id: "weekly", label: "Weekly", usedPct: usedPcts.shift(), resetsAt: PACE_RESETS_AT },
      ],
    }),
  });
}

function firstWindow(entries: UsageReportEntry[]): ProviderUsageWindow | undefined {
  const report = entries[0]?.report;
  if (report?.status !== "available") throw new Error("Expected an available usage report");
  return report.windows[0];
}

test("fills a rising window's run-out from its fetch history", async () => {
  let now = Date.parse("2026-11-06T10:00:00.000Z");
  const registry = new UsageSourceRegistry(() => now);
  registry.register(risingSource([50, 60]));

  expect(firstWindow(await registry.listReports())).toEqual({
    id: "weekly",
    label: "Weekly",
    usedPct: 50,
    resetsAt: PACE_RESETS_AT,
  });
  now += 20 * 60_000;
  expect(firstWindow(await registry.listReports({ forceRefresh: true }))).toEqual({
    id: "weekly",
    label: "Weekly",
    usedPct: 60,
    resetsAt: PACE_RESETS_AT,
    runsOutAt: "2026-11-06T11:40:00.000Z",
    shortfallPct: 70,
  });
});

test("a re-registered source starts its pace over", async () => {
  let now = Date.parse("2026-11-06T10:00:00.000Z");
  const usedPcts = [50, 60, 70];
  const registry = new UsageSourceRegistry(() => now);
  registry.register(risingSource(usedPcts));
  await registry.listReports();
  now += 20 * 60_000;
  await registry.listReports({ forceRefresh: true });

  registry.unregister("claude");
  registry.register(risingSource(usedPcts));
  now += 20 * 60_000;
  expect(firstWindow(await registry.listReports())).toEqual({
    id: "weekly",
    label: "Weekly",
    usedPct: 70,
    resetsAt: PACE_RESETS_AT,
  });
});
```

- [ ] **Step 6: Run the registry tests to see the projection test fail.**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/plugins/usage-sources/index.test.ts --bail=1
```

Expected: FAIL on "fills a rising window's run-out from its fetch history": the second window has no `runsOutAt` or `shortfallPct`. "a re-registered source starts its pace over" passes at this point, because nothing projects yet; Step 8 sees it fail.

- [ ] **Step 7: Wire the projection into the registry.** In `packages/server/src/server/plugins/usage-sources/index.ts`:

Add after the `@getpaseo/protocol/messages` import block (line 12):

```ts
import { createUsagePace } from "./pace.js";
```

Replace

```ts
  private readonly pending = new Map<string, Promise<UsageReportEntry>>();
```

with

```ts
  private readonly pending = new Map<string, Promise<UsageReportEntry>>();
  // Fork delta (usage heads-up): fetch samples behind each window's projected run-out.
  private readonly pace = createUsagePace();
```

In `fetchId`, replace

```ts
    const request = (async () => {
      const fetchedAt = new Date(this.now()).toISOString();
      const outcome = await this.fetchWithFallback(known);
      const completedAt = new Date(this.now()).toISOString();
      const entry: UsageReportEntry = {
        id,
        sourceId: known.source.id,
        sourceLabel: known.source.label,
        icon: known.source.icon,
        account: { label: known.label },
        fetchedAt,
        ...outcome,
      };
```

with

```ts
    const request = (async () => {
      const startedAt = this.now();
      const fetchedAt = new Date(startedAt).toISOString();
      const outcome = await this.fetchWithFallback(known);
      const completedAt = new Date(this.now()).toISOString();
      const entry: UsageReportEntry = {
        id,
        sourceId: known.source.id,
        sourceLabel: known.source.label,
        icon: known.source.icon,
        account: { label: known.label },
        fetchedAt,
        ...outcome,
        report: this.projectPace({ id, known, report: outcome.report, at: startedAt }),
      };
```

and add this method right after `fetchId` (before `private writeCache`):

```ts
  /**
   * Fork delta (usage heads-up): fills each window's projected run-out from its fetch history,
   * sampled at the fetch's start. A source replaced while the fetch ran adds no sample.
   */
  private projectPace(input: {
    id: string;
    known: KnownReport;
    report: UsageReport;
    at: number;
  }): UsageReport {
    const { id, known, report, at } = input;
    if (report.status !== "available" || this.sources.get(known.source.id) !== known.source) {
      return report;
    }
    return {
      ...report,
      windows: report.windows.map((window) =>
        this.pace.project({ key: `${id}:${window.id}`, window, at }),
      ),
    };
  }
```

- [ ] **Step 8: Run the registry tests to see the re-registration test fail.** Same command as Step 6. Expected: FAIL on "a re-registered source starts its pace over": the window also carries `runsOutAt: "2026-11-06T11:40:00.000Z"` and `shortfallPct: 70`, because the replaced source's samples at 50 (10:00) and 60 (10:20) still count, so 50 → 70 over 40 minutes gives 0.5 points a minute. "fills a rising window's run-out from its fetch history" passes now.

- [ ] **Step 9: Forget a replaced source's samples.** In `unregister`, replace

```ts
    for (const key of this.pending.keys()) if (key.startsWith(`${id}:`)) this.pending.delete(key);
  }
```

with

```ts
    for (const key of this.pending.keys()) if (key.startsWith(`${id}:`)) this.pending.delete(key);
    this.pace.forget(`${id}:`);
  }
```

- [ ] **Step 10: Run the registry and projection tests.** Run Step 6's command, then Step 2's. Expected: PASS for every test in `index.test.ts` (no existing fixture sets `resetsAt`, so none of them changes), then PASS, 11 tests.

- [ ] **Step 11: Format, lint and typecheck.**

```bash
cd /workspace/utils/paseo && npm run format:files -- packages/server/src/server/plugins/usage-sources/pace.ts packages/server/src/server/plugins/usage-sources/pace.test.ts packages/server/src/server/plugins/usage-sources/index.ts packages/server/src/server/plugins/usage-sources/index.test.ts && npm run lint -- packages/server/src/server/plugins/usage-sources/pace.ts packages/server/src/server/plugins/usage-sources/pace.test.ts packages/server/src/server/plugins/usage-sources/index.ts packages/server/src/server/plugins/usage-sources/index.test.ts && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/server -- --singleThreaded
```

Expected: exit 0.

- [ ] **Step 12: Commit.**

```bash
git -C /workspace/utils/paseo add packages/server/src/server/plugins/usage-sources/pace.ts packages/server/src/server/plugins/usage-sources/pace.test.ts packages/server/src/server/plugins/usage-sources/index.ts packages/server/src/server/plugins/usage-sources/index.test.ts && git -C /workspace/utils/paseo diff --cached --name-only && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(server): project usage run-outs from fetch history" -- packages/server/src/server/plugins/usage-sources/pace.ts packages/server/src/server/plugins/usage-sources/pace.test.ts packages/server/src/server/plugins/usage-sources/index.ts packages/server/src/server/plugins/usage-sources/index.test.ts && git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
```

Expected: exactly the four paths staged, the hook passes, `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.

---

### Task 3: Move targets carry the tightest window's run-out

**Files:**

- Modify: `packages/server/src/server/agent/session-move/move-targets.ts:1-54` (types and `toMoveTarget`; `createUsageLookup` at 56-102 is unchanged)
- Modify: `packages/server/src/server/agent/session-move/move-targets.test.ts:1-68`
- Create: `packages/server/src/server/agent/session-move/list-move-targets.ts`
- Create: `packages/server/src/server/agent/session-move/list-move-targets.test.ts`
- Modify: `packages/server/src/server/session.ts` (imports at 119-122 and 155-161, the shared lookup at 314-315, `listMoveTargets` and `moveTargetUsageWindows` at 3029-3076)
- Modify: `packages/server/src/server/websocket-server.ts:2018` (features)

**Interfaces:**

- Consumes: from Task 1, `chooseTightestWindow(windows, now)` and the optional wire fields `runsOutAt` and `windowLabel`. From Task 2, windows of `listReportsForScope` may carry a projected `runsOutAt`. Existing: `ProviderLaunchInfo { providerId; family; label; enabled; env: Record<string, string> }` (`provider-snapshot-manager.ts:114-120`), `ProviderSnapshotManager.getSnapshot(cwd)` (`:294`), `listRegisteredProviderIds()` (`:351`), `getProviderLaunchInfo(providerId): ProviderLaunchInfo | null` (`:367`), `createUsageLookup<T>(options)` (`move-targets.ts:69`), `AgentManager.getAgent(id)` (`agent-manager.ts:1419`), `AgentStorage.get(id)` (`agent-storage.ts:251`), `DaemonConfigStore.get()` (`daemon-config-store.ts:389`), `SessionOptions["pluginRuntime"].listUsageReportsForScope?(scope)` (`session.ts:570-575`).
- Produces:
  - `MoveTarget` gains `runsOutAt: string | null` and `windowLabel: string | null`; `UsageWindowLike` gains `label?: string` and `runsOutAt?: string | null`; `MoveTargetInput` gains `now: number`.
  - `list-move-targets.ts`: `interface UsageScopeQuery { provider: string; env: Record<string, string> }`, `type ListUsageReportsForScope = (scope: UsageScopeQuery) => Promise<UsageReportEntry[]>`, `type MoveTargetUsageLookup = (key: string, load: () => Promise<UsageReportEntry[]>) => Promise<UsageReportEntry[] | null>`, `const sharedMoveTargetUsage: MoveTargetUsageLookup`, `interface MoveTargetAgent { provider: string; cwd: string }`, `interface MoveTargetProviders { statusesIn(cwd: string): ReadonlyMap<string, ProviderSnapshotEntry["status"]>; launchInfos(): ProviderLaunchInfo[] }`, `interface ListMoveTargetsInput { agentId; findAgent; providers; usageEnabled; listUsageReportsForScope: ListUsageReportsForScope | null; usageLookup; logger: Pick<Logger, "warn">; now: number }`, `moveTargetProvidersFrom(manager): MoveTargetProviders`, `listAgentMoveTargets(input: ListMoveTargetsInput): Promise<MoveTarget[]>`. Task 7 calls `listAgentMoveTargets` from the usage watch.
  - `server_info.features.usageHeadsUp: true`.

- [ ] **Step 1: Write the failing ranking tests.** In `packages/server/src/server/agent/session-move/move-targets.test.ts`, replace lines 1-68 (from the imports through the availability test) with:

```ts
import { describe, expect, test } from "vitest";
import { createUsageLookup, toMoveTarget, type MoveTargetInput } from "./move-targets.js";

const NOW = Date.parse("2026-11-05T08:00:00.000Z");

const info = {
  providerId: "claude-work",
  family: "claude",
  label: "Claude (work)",
  enabled: true,
  env: {},
};

test("uses the tightest usage window", () => {
  expect(
    toMoveTarget({
      info,
      status: "ready",
      currentProvider: "claude",
      now: NOW,
      windows: [
        { usedPct: 40, resetsAt: "2026-11-05T10:00:00Z" },
        { usedPct: 100, resetsAt: "2026-11-05T14:00:00Z" },
      ],
    }),
  ).toEqual({
    provider: "claude-work",
    label: "Claude (work)",
    family: "claude",
    available: true,
    current: false,
    usedPct: 100,
    resetsAt: "2026-11-05T14:00:00Z",
    runsOutAt: null,
    windowLabel: null,
  });
});

test("reports unknown usage as null", () => {
  expect(
    toMoveTarget({
      info,
      status: "ready",
      currentProvider: "claude-work",
      now: NOW,
      windows: null,
    }),
  ).toMatchObject({
    current: true,
    usedPct: null,
  });
});

test("derives used percent from remaining percent when a window reports only that", () => {
  expect(
    toMoveTarget({
      info,
      status: "ready",
      currentProvider: "claude",
      now: NOW,
      windows: [
        { remainingPct: 75, resetsAt: "2026-11-05T10:00:00Z" },
        { usedPct: 10, remainingPct: 0, resetsAt: "2026-11-05T14:00:00Z" },
      ],
    }),
  ).toMatchObject({ usedPct: 25, resetsAt: "2026-11-05T10:00:00Z" });
});

test("marks a target unavailable when its CLI is missing or its catalog failed, and keeps a loading one selectable", () => {
  const availability = (status: MoveTargetInput["status"], enabled = true) =>
    toMoveTarget({
      info: { ...info, enabled },
      status,
      currentProvider: "claude",
      now: NOW,
      windows: null,
    }).available;

  expect(availability("ready")).toBe(true);
  expect(availability("loading")).toBe(true);
  expect(availability(null)).toBe(true);
  expect(availability("unavailable")).toBe(false);
  expect(availability("error")).toBe(false);
  expect(availability("ready", false)).toBe(false);
});

test("ranks a window on pace to run out soon above a fuller one that will not", () => {
  expect(
    toMoveTarget({
      info,
      status: "ready",
      currentProvider: "claude-work",
      now: NOW,
      windows: [
        { label: "Weekly", usedPct: 75, resetsAt: "2026-11-07T08:00:00.000Z" },
        {
          label: "Session",
          usedPct: 60,
          resetsAt: "2026-11-05T12:00:00.000Z",
          runsOutAt: "2026-11-05T08:20:00.000Z",
        },
      ],
    }),
  ).toEqual({
    provider: "claude-work",
    label: "Claude (work)",
    family: "claude",
    available: true,
    current: true,
    usedPct: 60,
    resetsAt: "2026-11-05T12:00:00.000Z",
    runsOutAt: "2026-11-05T08:20:00.000Z",
    windowLabel: "Session",
  });
});

test("keeps a used-up window tightest beside one that runs out soon", () => {
  expect(
    toMoveTarget({
      info,
      status: "ready",
      currentProvider: "claude-work",
      now: NOW,
      windows: [
        {
          label: "Weekly",
          usedPct: 96,
          resetsAt: "2026-11-07T08:00:00.000Z",
          runsOutAt: "2026-11-05T08:10:00.000Z",
        },
        { label: "Session", usedPct: 100, resetsAt: "2026-11-05T12:00:00.000Z" },
      ],
    }),
  ).toMatchObject({
    usedPct: 100,
    resetsAt: "2026-11-05T12:00:00.000Z",
    runsOutAt: null,
    windowLabel: "Session",
  });
});

test("drops a run-out that falls after its window resets", () => {
  expect(
    toMoveTarget({
      info,
      status: "ready",
      currentProvider: "claude-work",
      now: NOW,
      windows: [
        {
          label: "Weekly",
          usedPct: 50,
          resetsAt: "2026-11-05T09:00:00.000Z",
          runsOutAt: "2026-11-05T10:00:00.000Z",
        },
      ],
    }),
  ).toMatchObject({ usedPct: 50, runsOutAt: null, windowLabel: "Weekly" });
});
```

The `describe("createUsageLookup", ...)` block below stays as it is.

- [ ] **Step 2: Run it to see it fail.**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/agent/session-move/move-targets.test.ts --bail=1
```

Expected: FAIL on "uses the tightest usage window": the result has no `runsOutAt` or `windowLabel`.

- [ ] **Step 3: Rank windows with `chooseTightestWindow`.** In `packages/server/src/server/agent/session-move/move-targets.ts`, replace lines 1-54 (the imports through the end of `toMoveTarget`) with:

```ts
import { chooseTightestWindow } from "@getpaseo/protocol/usage-heads-up";
import type { ProviderSnapshotEntry } from "../agent-sdk-types.js";
import type { ProviderLaunchInfo } from "../provider-snapshot-manager.js";

export interface MoveTarget {
  provider: string;
  label: string;
  family: string;
  available: boolean;
  current: boolean;
  usedPct: number | null;
  resetsAt: string | null;
  /** When the tightest window runs out at its pace, only while that comes before its reset. */
  runsOutAt: string | null;
  windowLabel: string | null;
}

export interface UsageWindowLike {
  label?: string;
  usedPct?: number | null;
  remainingPct?: number | null;
  resetsAt?: string | null;
  runsOutAt?: string | null;
}

export interface MoveTargetInput {
  info: ProviderLaunchInfo;
  /** The provider's snapshot status in the agent's workspace; null when it has no entry yet. */
  status: ProviderSnapshotEntry["status"] | null;
  currentProvider: string;
  windows: readonly UsageWindowLike[] | null;
  /** The time each window's heads-up tone is judged at. */
  now: number;
}

/**
 * The tightest window decides whether a target has room and what its heads-up says. A window on
 * pace to run out soon outranks a fuller one that will not, and a used-up window always wins.
 */
export function toMoveTarget(input: MoveTargetInput): MoveTarget {
  // Fork delta (usage heads-up): the nearer heads-up first, then the fuller window, then the
  // sooner run-out. Below any heads-up this is the old rule, the fullest window.
  const tightest = chooseTightestWindow(input.windows ?? [], input.now);
  return {
    provider: input.info.providerId,
    label: input.info.label,
    family: input.info.family,
    // A loading target stays selectable: the move waits for it and refuses it if it fails.
    available: input.info.enabled && input.status !== "unavailable" && input.status !== "error",
    current: input.info.providerId === input.currentProvider,
    usedPct: tightest?.usedPct ?? null,
    resetsAt: tightest?.resetsAt ?? null,
    runsOutAt: tightest?.runsOutAt ?? null,
    windowLabel: tightest?.window.label ?? null,
  };
}
```

- [ ] **Step 4: Run it to see it pass.** Same command as Step 2. Expected: PASS, 11 tests (7 for `toMoveTarget`, 4 for `createUsageLookup`).

- [ ] **Step 5: Write the failing listing test.** Create `packages/server/src/server/agent/session-move/list-move-targets.test.ts`:

```ts
import { expect, test } from "vitest";
import type { ProviderUsageWindow, UsageReportEntry } from "@getpaseo/protocol/messages";
import type { ProviderSnapshotEntry } from "../agent-sdk-types.js";
import type { ProviderLaunchInfo } from "../provider-snapshot-manager.js";
import {
  listAgentMoveTargets,
  type ListMoveTargetsInput,
  type UsageScopeQuery,
} from "./list-move-targets.js";

const NOW = Date.parse("2026-11-06T10:00:00.000Z");
const WEEKLY_RESET = "2026-11-07T09:00:00.000Z";
const WORK_DIR = "/home/me/.claude-work";

const CLAUDE: ProviderLaunchInfo = {
  providerId: "claude",
  family: "claude",
  label: "Claude",
  enabled: true,
  env: {},
};

const WORK: ProviderLaunchInfo = {
  providerId: "claude-work",
  family: "claude",
  label: "Claude (work)",
  enabled: true,
  env: { CLAUDE_CONFIG_DIR: WORK_DIR },
};

const READY = new Map<string, ProviderSnapshotEntry["status"]>([
  ["claude", "ready"],
  ["claude-work", "ready"],
]);

function entry(windows: ProviderUsageWindow[]): UsageReportEntry {
  return {
    id: "claude:account",
    account: {},
    fetchedAt: "2026-11-06T09:59:00.000Z",
    sourceId: "claude",
    sourceLabel: "Claude",
    report: { status: "available", windows },
  };
}

function input(overrides: Partial<ListMoveTargetsInput>): ListMoveTargetsInput {
  return {
    agentId: "agent-1",
    findAgent: async () => ({ provider: "claude", cwd: "/repo" }),
    providers: { statusesIn: () => READY, launchInfos: () => [CLAUDE, WORK] },
    usageEnabled: true,
    listUsageReportsForScope: async () => [],
    usageLookup: (_key, load) => load(),
    logger: { warn: () => undefined },
    now: NOW,
    ...overrides,
  };
}

test("lists every provider with the tightest window of its own account, read by family and profile env", async () => {
  const scopes: UsageScopeQuery[] = [];
  const targets = await listAgentMoveTargets(
    input({
      listUsageReportsForScope: async (scope) => {
        scopes.push(scope);
        return scope.env.CLAUDE_CONFIG_DIR
          ? [entry([{ id: "weekly", label: "Weekly", usedPct: 12, resetsAt: WEEKLY_RESET }])]
          : [
              entry([
                {
                  id: "weekly",
                  label: "Weekly",
                  usedPct: 84,
                  resetsAt: WEEKLY_RESET,
                  runsOutAt: "2026-11-06T14:00:00.000Z",
                },
              ]),
            ];
      },
    }),
  );

  expect(scopes).toEqual([
    { provider: "claude", env: {} },
    { provider: "claude", env: { CLAUDE_CONFIG_DIR: WORK_DIR } },
  ]);
  expect(targets).toEqual([
    {
      provider: "claude",
      label: "Claude",
      family: "claude",
      available: true,
      current: true,
      usedPct: 84,
      resetsAt: WEEKLY_RESET,
      runsOutAt: "2026-11-06T14:00:00.000Z",
      windowLabel: "Weekly",
    },
    {
      provider: "claude-work",
      label: "Claude (work)",
      family: "claude",
      available: true,
      current: false,
      usedPct: 12,
      resetsAt: WEEKLY_RESET,
      runsOutAt: null,
      windowLabel: "Weekly",
    },
  ]);
});

test("judges availability from the provider snapshot of the agent's own directory", async () => {
  const cwds: string[] = [];
  const statuses = new Map<string, ProviderSnapshotEntry["status"]>([
    ["claude", "ready"],
    ["claude-work", "unavailable"],
  ]);
  const targets = await listAgentMoveTargets(
    input({
      providers: {
        statusesIn: (cwd) => {
          cwds.push(cwd);
          return statuses;
        },
        launchInfos: () => [CLAUDE, WORK],
      },
    }),
  );

  expect(cwds).toEqual(["/repo"]);
  expect(targets.map((target) => [target.provider, target.available])).toEqual([
    ["claude", true],
    ["claude-work", false],
  ]);
});

test("reads no usage while the host's usage check is off", async () => {
  const scopes: UsageScopeQuery[] = [];
  const targets = await listAgentMoveTargets(
    input({
      usageEnabled: false,
      listUsageReportsForScope: async (scope) => {
        scopes.push(scope);
        return [];
      },
    }),
  );

  expect(scopes).toEqual([]);
  expect(targets.map((target) => target.usedPct)).toEqual([null, null]);
});

test("lists a target with unknown usage when its lookup fails, and logs the failure", async () => {
  const warnings: string[] = [];
  const targets = await listAgentMoveTargets(
    input({
      listUsageReportsForScope: async () => {
        throw new Error("vendor down");
      },
      logger: {
        warn: (_details: unknown, message?: string) => {
          warnings.push(message ?? "");
        },
      },
    }),
  );

  expect(targets.map((target) => [target.provider, target.usedPct])).toEqual([
    ["claude", null],
    ["claude-work", null],
  ]);
  expect(warnings).toEqual([
    "move targets: usage lookup failed",
    "move targets: usage lookup failed",
  ]);
});

test("refuses an agent it cannot find", async () => {
  await expect(listAgentMoveTargets(input({ findAgent: async () => null }))).rejects.toThrow(
    "Agent not found: agent-1",
  );
});
```

- [ ] **Step 6: Run it to see it fail.**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/agent/session-move/list-move-targets.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './list-move-targets.js' imported from /workspace/utils/paseo/packages/server/src/server/agent/session-move/list-move-targets.test.ts`, and no test runs.

- [ ] **Step 7: Move the listing out of the session.** Create `packages/server/src/server/agent/session-move/list-move-targets.ts`:

```ts
import type { Logger } from "pino";
import type { UsageReportEntry } from "@getpaseo/protocol/messages";
import type { ProviderSnapshotEntry } from "../agent-sdk-types.js";
import type { ProviderLaunchInfo, ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import {
  createUsageLookup,
  toMoveTarget,
  type MoveTarget,
  type UsageWindowLike,
} from "./move-targets.js";

export interface UsageScopeQuery {
  provider: string;
  env: Record<string, string>;
}

export type ListUsageReportsForScope = (scope: UsageScopeQuery) => Promise<UsageReportEntry[]>;

export type MoveTargetUsageLookup = (
  key: string,
  load: () => Promise<UsageReportEntry[]>,
) => Promise<UsageReportEntry[] | null>;

/**
 * Shared by every session and the usage watch: usage is daemon-wide, and the move dialog asks for
 * it on each open.
 */
export const sharedMoveTargetUsage: MoveTargetUsageLookup = createUsageLookup<UsageReportEntry[]>();

/** The agent whose targets are listed. */
export interface MoveTargetAgent {
  provider: string;
  cwd: string;
}

/** The registered providers, as the move targets read them. */
export interface MoveTargetProviders {
  /** Each provider's snapshot status in `cwd`; a provider with no entry yet is absent. */
  statusesIn(cwd: string): ReadonlyMap<string, ProviderSnapshotEntry["status"]>;
  launchInfos(): ProviderLaunchInfo[];
}

export interface ListMoveTargetsInput {
  agentId: string;
  findAgent: (agentId: string) => Promise<MoveTargetAgent | null>;
  providers: MoveTargetProviders;
  usageEnabled: boolean;
  /** Null when no plugin runtime reports usage. */
  listUsageReportsForScope: ListUsageReportsForScope | null;
  usageLookup: MoveTargetUsageLookup;
  logger: Pick<Logger, "warn">;
  now: number;
}

export function moveTargetProvidersFrom(
  manager: Pick<
    ProviderSnapshotManager,
    "getSnapshot" | "listRegisteredProviderIds" | "getProviderLaunchInfo"
  >,
): MoveTargetProviders {
  return {
    statusesIn: (cwd) =>
      new Map(
        manager
          .getSnapshot(cwd)
          .records.map(({ entry }): [string, ProviderSnapshotEntry["status"]] => [
            entry.provider,
            entry.status,
          ]),
      ),
    launchInfos: () =>
      manager.listRegisteredProviderIds().flatMap((providerId) => {
        const info = manager.getProviderLaunchInfo(providerId);
        return info ? [info] : [];
      }),
  };
}

/** Every registered provider as a move target of the agent, with its tightest usage window. */
export async function listAgentMoveTargets(input: ListMoveTargetsInput): Promise<MoveTarget[]> {
  const agent = await input.findAgent(input.agentId);
  if (!agent) throw new Error(`Agent not found: ${input.agentId}`);
  // Does not wait: a provider still loading stays selectable, and the move itself waits.
  const statuses = input.providers.statusesIn(agent.cwd);
  return Promise.all(
    input.providers.launchInfos().map(async (info) =>
      toMoveTarget({
        info,
        status: statuses.get(info.providerId) ?? null,
        currentProvider: agent.provider,
        windows: input.usageEnabled ? await usageWindows(input, info) : null,
        now: input.now,
      }),
    ),
  );
}

/** Usage windows for one target, or null when unknown (no source, failed or too slow). */
async function usageWindows(
  input: ListMoveTargetsInput,
  info: ProviderLaunchInfo,
): Promise<UsageWindowLike[] | null> {
  const listReports = input.listUsageReportsForScope;
  if (!listReports) return null;
  // Agents run the family CLI with the profile env, so usage is keyed by family.
  const reports = await input
    .usageLookup(info.providerId, () => listReports({ provider: info.family, env: info.env }))
    .catch((err: unknown) => {
      input.logger.warn({ err, providerId: info.providerId }, "move targets: usage lookup failed");
      return null;
    });
  if (!reports || reports.length === 0) return null;
  return reports.flatMap((entry) =>
    entry.report.status === "available" ? entry.report.windows : [],
  );
}
```

- [ ] **Step 8: Run it to see it pass.** Same command as Step 6. Expected: PASS, 5 tests.

- [ ] **Step 9: Use it from the session.** In `packages/server/src/server/session.ts`:

Replace

```ts
import {
  ProviderSnapshotManager,
  type ProviderLaunchInfo,
} from "./agent/provider-snapshot-manager.js";
```

with

```ts
import { ProviderSnapshotManager } from "./agent/provider-snapshot-manager.js";
```

Replace

```ts
import {
  createUsageLookup,
  toMoveTarget,
  type MoveTarget,
  type UsageWindowLike,
} from "./agent/session-move/move-targets.js";
```

with

```ts
import type { MoveTarget } from "./agent/session-move/move-targets.js";
import {
  listAgentMoveTargets,
  moveTargetProvidersFrom,
  sharedMoveTargetUsage,
} from "./agent/session-move/list-move-targets.js";
```

Delete these two lines (314-315):

```ts
// Shared by every session: usage is daemon-wide, and the move dialog asks for it on each open.
const moveTargetUsage = createUsageLookup<UsageReportEntry[]>();
```

Replace the whole `listMoveTargets` method and the `moveTargetUsageWindows` method after it (from `  private async listMoveTargets(agentId: string): Promise<MoveTarget[]> {` through the closing brace of `moveTargetUsageWindows`, just before `  private dispatchAgentRelationshipMessage(`) with:

```ts
  private async listMoveTargets(agentId: string): Promise<MoveTarget[]> {
    const runtime = this.pluginRuntime;
    const listReports = runtime?.listUsageReportsForScope;
    return listAgentMoveTargets({
      agentId,
      findAgent: async (id) => this.agentManager.getAgent(id) ?? (await this.agentStorage.get(id)),
      providers: moveTargetProvidersFrom(this.providerSnapshotManager),
      usageEnabled: this.daemonConfigStore.get().usage?.enabled !== false,
      listUsageReportsForScope: listReports ? (scope) => listReports.call(runtime, scope) : null,
      usageLookup: sharedMoveTargetUsage,
      logger: this.sessionLogger,
      now: Date.now(),
    });
  }
```

`UsageReportEntry` stays imported: the `pluginRuntime` type at lines 570 and 575 still uses it.

- [ ] **Step 10: Advertise the feature.** In `packages/server/src/server/websocket-server.ts`, replace

```ts
        agentMove: true,
```

with

```ts
        agentMove: true,
        // Fork delta (usage heads-up): move targets carry runsOutAt and windowLabel.
        usageHeadsUp: true,
```

- [ ] **Step 11: Run the move tests again and typecheck.**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/agent/session-move/move-targets.test.ts --bail=1 && flock /tmp/paseo-heavy.lock npx vitest run src/server/agent/session-move/list-move-targets.test.ts --bail=1 && cd /workspace/utils/paseo && npm run format:files -- packages/server/src/server/agent/session-move/move-targets.ts packages/server/src/server/agent/session-move/move-targets.test.ts packages/server/src/server/agent/session-move/list-move-targets.ts packages/server/src/server/agent/session-move/list-move-targets.test.ts packages/server/src/server/session.ts packages/server/src/server/websocket-server.ts && npm run lint -- packages/server/src/server/agent/session-move/move-targets.ts packages/server/src/server/agent/session-move/move-targets.test.ts packages/server/src/server/agent/session-move/list-move-targets.ts packages/server/src/server/agent/session-move/list-move-targets.test.ts packages/server/src/server/session.ts packages/server/src/server/websocket-server.ts && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/server -- --singleThreaded
```

Expected: PASS (11 tests), PASS (5 tests), then format, lint and typecheck exit 0. A typecheck error naming `ProviderLaunchInfo`, `createUsageLookup`, `toMoveTarget` or `UsageWindowLike` in `session.ts` means a use outside the two removed methods; `grep -n` for it and keep that import.

- [ ] **Step 12: Commit.**

```bash
git -C /workspace/utils/paseo add packages/server/src/server/agent/session-move/move-targets.ts packages/server/src/server/agent/session-move/move-targets.test.ts packages/server/src/server/agent/session-move/list-move-targets.ts packages/server/src/server/agent/session-move/list-move-targets.test.ts packages/server/src/server/session.ts packages/server/src/server/websocket-server.ts && git -C /workspace/utils/paseo diff --cached --name-only && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(server): move targets carry the tightest window's run-out" -- packages/server/src/server/agent/session-move/move-targets.ts packages/server/src/server/agent/session-move/move-targets.test.ts packages/server/src/server/agent/session-move/list-move-targets.ts packages/server/src/server/agent/session-move/list-move-targets.test.ts packages/server/src/server/session.ts packages/server/src/server/websocket-server.ts && git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
```

Expected: exactly the six paths staged, the hook passes, `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.

---

### Task 4: The app's heads-up model, dismissals and copy

**Files:**

- Create: `packages/app/src/session-move/usage-heads-up.ts`
- Create: `packages/app/src/session-move/usage-heads-up.test.ts`
- Create: `packages/app/src/session-move/usage-heads-up-store.ts`
- Create: `packages/app/src/session-move/usage-heads-up-store.test.ts`
- Modify: `packages/app/src/i18n/resources/en.ts:1990-1991` (a `headsUp` block after `sessionMove.banner`)

**Interfaces:**

- Consumes: from Task 1, `chooseBestMoveTarget`, `msUntilRunOut`, `usageHeadsUpTone`, `usageLevel`, `type UsageLevel` and `AgentMoveTarget.runsOutAt` / `windowLabel`. Existing: `findCurrentTarget(view): AgentMoveTarget | null` and `type AgentMoveTargetsView` (`packages/app/src/session-move/move-targets.ts:18-23, 62-65`), `formatPct(value: number, locale?: string): string` (`packages/app/src/usage/format.ts:33`), `i18n` (`packages/app/src/i18n/i18next.ts`, `escapeValue: false` at :61-62).
- Produces (Task 5 renders them):
  - `interface UsageHeadsUp { windowKey: string; account: string; usedPct: number; windowLabel: string | null; resetsAt: string | null; runsOutAt: string | null; tone: "warning" | "danger"; level: UsageLevel; best: AgentMoveTarget | null }`
  - `resolveUsageHeadsUp(targets: AgentMoveTargetsView, now: number): UsageHeadsUp | null`
  - `interface UsageHeadsUpDismissal { level: UsageLevel; resetsAt: string | null }`
  - `isUsageHeadsUpDismissed(input: { headsUp: UsageHeadsUp; dismissal: UsageHeadsUpDismissal | null; now: number }): boolean`
  - `type FormatClock = (iso: string | null) => string | null`
  - `interface UsageHeadsUpCopy { message: string; moveLabel: string | null }`
  - `describeUsageHeadsUp(headsUp: UsageHeadsUp, options: { t: TFunction; formatClock: FormatClock; locale?: string }): UsageHeadsUpCopy`
  - `useUsageHeadsUpStore`, `interface UsageHeadsUpState { dismissals: Record<string, UsageHeadsUpDismissal> }`, `dismissUsageHeadsUp(input: { serverId: string; windowKey: string; dismissal: UsageHeadsUpDismissal }): void`, `selectUsageHeadsUpDismissal(state: UsageHeadsUpState, input: { serverId: string; windowKey: string | null }): UsageHeadsUpDismissal | null`
  - i18n keys `sessionMove.headsUp.{usage, usageOfWindow, withTiming, runsOutResets, runsOut, resets, moveTo, moveToUsage, moving, more, dismiss}`.

- [ ] **Step 1: Write the failing model test.** Create `packages/app/src/session-move/usage-heads-up.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import { i18n } from "@/i18n/i18next";
import type { AgentMoveTargetsView } from "./move-targets";
import {
  describeUsageHeadsUp,
  isUsageHeadsUpDismissed,
  resolveUsageHeadsUp,
  type FormatClock,
  type UsageHeadsUp,
  type UsageHeadsUpDismissal,
} from "./usage-heads-up";

// Thursday 2026-11-05, 08:00 UTC.
const NOW = Date.parse("2026-11-05T08:00:00.000Z");
const RUNS_OUT = "2026-11-05T14:00:00.000Z";
const RESETS = "2026-11-06T09:00:00.000Z";
const IN_TWO_HOURS = "2026-11-05T10:00:00.000Z";
const IN_TWENTY_MINUTES = "2026-11-05T08:20:00.000Z";
const PASSED = "2026-11-05T07:00:00.000Z";

const CLOCK = new Map<string, string>([
  [RUNS_OUT, "Thu 14:00"],
  [RESETS, "Fri 09:00"],
]);

const formatClock: FormatClock = (iso) => (iso === null ? null : (CLOCK.get(iso) ?? null));

function target(overrides: Partial<AgentMoveTarget> & { provider: string }): AgentMoveTarget {
  return {
    label: overrides.provider,
    family: "claude",
    available: true,
    current: false,
    usedPct: null,
    resetsAt: null,
    runsOutAt: null,
    windowLabel: null,
    ...overrides,
  };
}

function current(overrides: Partial<AgentMoveTarget> = {}): AgentMoveTarget {
  return target({
    provider: "claude-work",
    label: "Claude (work)",
    current: true,
    usedPct: 84,
    resetsAt: RESETS,
    runsOutAt: RUNS_OUT,
    windowLabel: "Weekly",
    ...overrides,
  });
}

const KIRO: AgentMoveTarget = target({
  provider: "kiro",
  label: "Kiro CLI",
  family: "kiro",
  usedPct: 12,
});

const CLAUDE: AgentMoveTarget = target({ provider: "claude", label: "Claude", usedPct: 30 });

function ready(...targets: AgentMoveTarget[]): AgentMoveTargetsView {
  return { kind: "ready", targets };
}

function headsUp(overrides: Partial<UsageHeadsUp> = {}): UsageHeadsUp {
  return {
    windowKey: "claude-work\nWeekly",
    account: "Claude (work)",
    usedPct: 84,
    windowLabel: "Weekly",
    resetsAt: RESETS,
    runsOutAt: RUNS_OUT,
    tone: "warning",
    level: 1,
    best: KIRO,
    ...overrides,
  };
}

beforeEach(async () => {
  await i18n.changeLanguage("en");
});

afterEach(async () => {
  await i18n.changeLanguage("en");
});

describe("resolveUsageHeadsUp", () => {
  it("warns about the agent's own account from 80% and suggests the target with the most room", () => {
    expect(resolveUsageHeadsUp(ready(current(), CLAUDE, KIRO), NOW)).toEqual(headsUp());
  });

  it("warns below 80% when the account runs out within 3 hours", () => {
    expect(
      resolveUsageHeadsUp(ready(current({ usedPct: 60, runsOutAt: IN_TWO_HOURS }), KIRO), NOW),
    ).toMatchObject({ tone: "warning", level: 0, runsOutAt: IN_TWO_HOURS });
  });

  it("turns danger at 95% or a run-out within 30 minutes", () => {
    expect(
      resolveUsageHeadsUp(ready(current({ usedPct: 95, runsOutAt: null }), KIRO), NOW),
    ).toMatchObject({ tone: "danger", level: 2 });
    expect(
      resolveUsageHeadsUp(ready(current({ usedPct: 60, runsOutAt: IN_TWENTY_MINUTES }), KIRO), NOW),
    ).toMatchObject({ tone: "danger", level: 0 });
  });

  it("shows nothing under 80% without a near run-out, with unknown usage or before the targets load", () => {
    expect(resolveUsageHeadsUp(ready(current({ usedPct: 79, runsOutAt: null }), KIRO), NOW)).toBe(
      null,
    );
    expect(resolveUsageHeadsUp(ready(current({ usedPct: null, runsOutAt: null })), NOW)).toBe(null);
    expect(resolveUsageHeadsUp(ready(KIRO), NOW)).toBeNull();
    expect(resolveUsageHeadsUp({ kind: "loading" }, NOW)).toBeNull();
  });

  it("suggests no move when every other target is full or fuller than the agent's account", () => {
    expect(
      resolveUsageHeadsUp(
        ready(current(), target({ provider: "kiro", usedPct: 100 }), { ...CLAUDE, usedPct: 90 }),
        NOW,
      ),
    ).toMatchObject({ best: null });
  });
});

describe("isUsageHeadsUpDismissed", () => {
  const dismissedAtWarning: UsageHeadsUpDismissal = { level: 1, resetsAt: RESETS };

  it("hides a dismissed heads-up until the window reaches the next level", () => {
    expect(
      isUsageHeadsUpDismissed({ headsUp: headsUp(), dismissal: dismissedAtWarning, now: NOW }),
    ).toBe(true);
    expect(
      isUsageHeadsUpDismissed({
        headsUp: headsUp({ tone: "danger", level: 2, usedPct: 96 }),
        dismissal: dismissedAtWarning,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("shows the heads-up again once the window has reset, and when it was never dismissed", () => {
    expect(
      isUsageHeadsUpDismissed({
        headsUp: headsUp(),
        dismissal: { level: 1, resetsAt: PASSED },
        now: NOW,
      }),
    ).toBe(false);
    expect(isUsageHeadsUpDismissed({ headsUp: headsUp(), dismissal: null, now: NOW })).toBe(false);
  });
});

describe("describeUsageHeadsUp", () => {
  it("names the account window, its run-out and reset, and the best target's usage", () => {
    expect(describeUsageHeadsUp(headsUp(), { t: i18n.t, formatClock, locale: "en" })).toEqual({
      message: "Claude (work) 84% of Weekly · on pace to run out Thu 14:00, resets Fri 09:00",
      moveLabel: "Move to Kiro CLI · 12%",
    });
  });

  it("leaves out what it does not know", () => {
    expect(
      describeUsageHeadsUp(
        headsUp({
          windowLabel: null,
          runsOutAt: null,
          resetsAt: null,
          best: { ...KIRO, usedPct: null },
        }),
        { t: i18n.t, formatClock, locale: "en" },
      ),
    ).toEqual({ message: "Claude (work) 84%", moveLabel: "Move to Kiro CLI" });
    expect(
      describeUsageHeadsUp(headsUp({ runsOutAt: PASSED, best: null }), {
        t: i18n.t,
        formatClock,
        locale: "en",
      }),
    ).toEqual({ message: "Claude (work) 84% of Weekly · resets Fri 09:00", moveLabel: null });
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

```bash
cd /workspace/utils/paseo/packages/app && flock /tmp/paseo-heavy.lock npx vitest run src/session-move/usage-heads-up.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './usage-heads-up' imported from /workspace/utils/paseo/packages/app/src/session-move/usage-heads-up.test.ts`, and no test runs.

- [ ] **Step 3: Add the copy.** In `packages/app/src/i18n/resources/en.ts`, replace

```ts
      moveBack: "Move back",
      movingBack: "Moving back...",
    },
```

with

```ts
      moveBack: "Move back",
      movingBack: "Moving back...",
    },
    headsUp: {
      usage: "{{account}} {{used}}",
      usageOfWindow: "{{account}} {{used}} of {{window}}",
      withTiming: "{{facts}} · {{timing}}",
      runsOutResets: "on pace to run out {{runsOut}}, resets {{reset}}",
      runsOut: "on pace to run out {{runsOut}}",
      resets: "resets {{reset}}",
      moveTo: "Move to {{label}}",
      moveToUsage: "Move to {{label}} · {{used}}",
      moving: "Moving...",
      more: "More...",
      dismiss: "Dismiss",
    },
```

Every other locale aliases `sessionMove: en.sessionMove`, so no other resource file changes.

- [ ] **Step 4: Write the model.** Create `packages/app/src/session-move/usage-heads-up.ts`:

```ts
import type { TFunction } from "i18next";
import type { AgentMoveTarget } from "@getpaseo/protocol/messages";
import {
  chooseBestMoveTarget,
  msUntilRunOut,
  usageHeadsUpTone,
  usageLevel,
  type UsageLevel,
} from "@getpaseo/protocol/usage-heads-up";
import { formatPct } from "@/usage/format";
import { findCurrentTarget, type AgentMoveTargetsView } from "./move-targets";

/** A warning about the agent's own account before it runs out. */
export interface UsageHeadsUp {
  /** The account window it is about; a dismissal holds for every agent on that window. */
  windowKey: string;
  account: string;
  usedPct: number;
  windowLabel: string | null;
  resetsAt: string | null;
  /** Only while the run-out comes before the reset. */
  runsOutAt: string | null;
  tone: "warning" | "danger";
  level: UsageLevel;
  /** Where the one-click Move goes; null when no target has room. */
  best: AgentMoveTarget | null;
}

/** The level a heads-up was dismissed at, and the reset after which the dismissal ends. */
export interface UsageHeadsUpDismissal {
  level: UsageLevel;
  resetsAt: string | null;
}

/** Formats a time on the clock, or null for none or one that has passed. */
export type FormatClock = (iso: string | null) => string | null;

export interface UsageHeadsUpCopy {
  message: string;
  /** Null when no target has room. */
  moveLabel: string | null;
}

interface CopyOptions {
  t: TFunction;
  formatClock: FormatClock;
  locale?: string;
}

/**
 * The heads-up for the agent's own account: from 80%, or below it when the account is on pace to
 * run out within 3 hours and before it resets. Null otherwise and until the targets load.
 */
export function resolveUsageHeadsUp(
  targets: AgentMoveTargetsView,
  now: number,
): UsageHeadsUp | null {
  if (targets.kind !== "ready") return null;
  const current = findCurrentTarget(targets);
  if (!current || current.usedPct === null) return null;
  const pace = {
    usedPct: current.usedPct,
    resetsAt: current.resetsAt,
    runsOutAt: current.runsOutAt ?? null,
  };
  const tone = usageHeadsUpTone(pace, now);
  if (tone === "none") return null;
  return {
    windowKey: `${current.provider}\n${current.windowLabel ?? ""}`,
    account: current.label,
    usedPct: current.usedPct,
    windowLabel: current.windowLabel ?? null,
    resetsAt: current.resetsAt,
    runsOutAt: msUntilRunOut(pace, now) === null ? null : pace.runsOutAt,
    tone,
    level: usageLevel(current.usedPct),
    best: chooseBestMoveTarget(targets.targets),
  };
}

/** A dismissal holds until the window reaches a higher level or the reset it named passes. */
export function isUsageHeadsUpDismissed(input: {
  headsUp: UsageHeadsUp;
  dismissal: UsageHeadsUpDismissal | null;
  now: number;
}): boolean {
  const { headsUp, dismissal, now } = input;
  if (!dismissal) return false;
  if (dismissal.resetsAt !== null && Date.parse(dismissal.resetsAt) <= now) return false;
  return headsUp.level <= dismissal.level;
}

function describeFacts(headsUp: UsageHeadsUp, options: CopyOptions): string {
  const used = formatPct(headsUp.usedPct, options.locale);
  // Shown verbatim: sources name windows such as "Weekly · Fable", which no case rule survives.
  if (headsUp.windowLabel === null) {
    return options.t("sessionMove.headsUp.usage", { account: headsUp.account, used });
  }
  return options.t("sessionMove.headsUp.usageOfWindow", {
    account: headsUp.account,
    used,
    window: headsUp.windowLabel,
  });
}

function describeTiming(headsUp: UsageHeadsUp, options: CopyOptions): string | null {
  const runsOut = options.formatClock(headsUp.runsOutAt);
  const reset = options.formatClock(headsUp.resetsAt);
  if (runsOut && reset) return options.t("sessionMove.headsUp.runsOutResets", { runsOut, reset });
  if (runsOut) return options.t("sessionMove.headsUp.runsOut", { runsOut });
  if (reset) return options.t("sessionMove.headsUp.resets", { reset });
  return null;
}

function describeMove(best: AgentMoveTarget | null, options: CopyOptions): string | null {
  if (!best) return null;
  if (best.usedPct === null) return options.t("sessionMove.headsUp.moveTo", { label: best.label });
  return options.t("sessionMove.headsUp.moveToUsage", {
    label: best.label,
    used: formatPct(best.usedPct, options.locale),
  });
}

/** "Claude (work) 84% of Weekly · on pace to run out Thu 14:00, resets Fri 09:00". */
export function describeUsageHeadsUp(
  headsUp: UsageHeadsUp,
  options: CopyOptions,
): UsageHeadsUpCopy {
  const facts = describeFacts(headsUp, options);
  const timing = describeTiming(headsUp, options);
  return {
    message: timing ? options.t("sessionMove.headsUp.withTiming", { facts, timing }) : facts,
    moveLabel: describeMove(headsUp.best, options),
  };
}
```

- [ ] **Step 5: Run it to see it pass.** Same command as Step 2. Expected: PASS, 9 tests. A failure on `84%` against a non-breaking space means the test runtime's ICU formats percents differently; check `formatPct(84, "en")` in `packages/app/src/usage/format.test.ts` and match what that suite expects instead of changing `formatPct`.

- [ ] **Step 6: Write the failing store test.** Create `packages/app/src/session-move/usage-heads-up-store.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import type { UsageHeadsUpDismissal } from "./usage-heads-up";
import {
  dismissUsageHeadsUp,
  selectUsageHeadsUpDismissal,
  useUsageHeadsUpStore,
} from "./usage-heads-up-store";

const AT_WARNING: UsageHeadsUpDismissal = { level: 1, resetsAt: "2026-11-06T09:00:00.000Z" };
const AT_DANGER: UsageHeadsUpDismissal = { level: 2, resetsAt: "2026-11-06T09:00:00.000Z" };
const WEEKLY = "claude-work\nWeekly";

function dismissalFor(serverId: string, windowKey: string | null) {
  return selectUsageHeadsUpDismissal(useUsageHeadsUpStore.getState(), { serverId, windowKey });
}

describe("usage heads-up store", () => {
  afterEach(() => {
    useUsageHeadsUpStore.setState({ dismissals: {} });
  });

  it("keeps a dismissal per host and account window", () => {
    dismissUsageHeadsUp({ serverId: "host-a", windowKey: WEEKLY, dismissal: AT_WARNING });

    expect(dismissalFor("host-a", WEEKLY)).toEqual(AT_WARNING);
    expect(dismissalFor("host-b", WEEKLY)).toBeNull();
    expect(dismissalFor("host-a", "claude-work\nSession")).toBeNull();
    expect(dismissalFor("host-a", null)).toBeNull();
  });

  it("replaces an earlier dismissal of the same window", () => {
    dismissUsageHeadsUp({ serverId: "host-a", windowKey: WEEKLY, dismissal: AT_WARNING });
    dismissUsageHeadsUp({ serverId: "host-a", windowKey: WEEKLY, dismissal: AT_DANGER });

    expect(dismissalFor("host-a", WEEKLY)).toEqual(AT_DANGER);
  });
});
```

- [ ] **Step 7: Run it to see it fail.**

```bash
cd /workspace/utils/paseo/packages/app && flock /tmp/paseo-heavy.lock npx vitest run src/session-move/usage-heads-up-store.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './usage-heads-up-store' imported from /workspace/utils/paseo/packages/app/src/session-move/usage-heads-up-store.test.ts`, and no test runs.

- [ ] **Step 8: Write the store.** Create `packages/app/src/session-move/usage-heads-up-store.ts`:

```ts
import { create } from "zustand";
import type { UsageHeadsUpDismissal } from "./usage-heads-up";

export interface UsageHeadsUpState {
  /** Keyed by host and account window. In memory only: an app restart shows each heads-up again. */
  dismissals: Record<string, UsageHeadsUpDismissal>;
}

export const useUsageHeadsUpStore = create<UsageHeadsUpState>(() => ({ dismissals: {} }));

function dismissalKey(input: { serverId: string; windowKey: string }): string {
  return `${input.serverId}\n${input.windowKey}`;
}

export function dismissUsageHeadsUp(input: {
  serverId: string;
  windowKey: string;
  dismissal: UsageHeadsUpDismissal;
}): void {
  useUsageHeadsUpStore.setState((state) => ({
    dismissals: { ...state.dismissals, [dismissalKey(input)]: input.dismissal },
  }));
}

export function selectUsageHeadsUpDismissal(
  state: UsageHeadsUpState,
  input: { serverId: string; windowKey: string | null },
): UsageHeadsUpDismissal | null {
  if (input.windowKey === null) return null;
  return (
    state.dismissals[dismissalKey({ serverId: input.serverId, windowKey: input.windowKey })] ?? null
  );
}
```

- [ ] **Step 9: Run it to see it pass.** Same command as Step 7. Expected: PASS, 2 tests.

- [ ] **Step 10: Format, lint and typecheck.**

```bash
cd /workspace/utils/paseo && npm run format:files -- packages/app/src/session-move/usage-heads-up.ts packages/app/src/session-move/usage-heads-up.test.ts packages/app/src/session-move/usage-heads-up-store.ts packages/app/src/session-move/usage-heads-up-store.test.ts packages/app/src/i18n/resources/en.ts && npm run lint -- packages/app/src/session-move/usage-heads-up.ts packages/app/src/session-move/usage-heads-up.test.ts packages/app/src/session-move/usage-heads-up-store.ts packages/app/src/session-move/usage-heads-up-store.test.ts packages/app/src/i18n/resources/en.ts && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/app -- --singleThreaded
```

Expected: exit 0. The protocol `dist` from Task 1 must be built, or `@getpaseo/protocol/usage-heads-up` does not resolve.

- [ ] **Step 11: Commit.**

```bash
git -C /workspace/utils/paseo add packages/app/src/session-move/usage-heads-up.ts packages/app/src/session-move/usage-heads-up.test.ts packages/app/src/session-move/usage-heads-up-store.ts packages/app/src/session-move/usage-heads-up-store.test.ts packages/app/src/i18n/resources/en.ts && git -C /workspace/utils/paseo diff --cached --name-only && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(app): usage heads-up model, dismissals and copy" -- packages/app/src/session-move/usage-heads-up.ts packages/app/src/session-move/usage-heads-up.test.ts packages/app/src/session-move/usage-heads-up-store.ts packages/app/src/session-move/usage-heads-up-store.test.ts packages/app/src/i18n/resources/en.ts && git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
```

Expected: exactly the five paths staged, the hook passes, `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.

---

### Task 5: The heads-up in the move banner

**Files:**

- Modify: `packages/app/src/session-move/move-banner-view.ts` (view union, input, order)
- Modify: `packages/app/src/session-move/move-banner-view.test.ts`
- Modify: `packages/app/src/session-move/move-targets.ts:12-16` (comment) and after `moveTargetsRecheckMs` (`:79-85`)
- Modify: `packages/app/src/session-move/move-targets.test.ts` (imports at 4-14, a new `describe` at the end)
- Modify: `packages/app/src/session-move/use-agent-move.ts:8, 38-46, 53-72`
- Modify: `packages/app/src/session-move/move-dialog.tsx:107-113`
- Modify: `packages/app/src/session-move/move-banner.tsx` (imports at 1-27, `MoveBanner` through `MoveBannerNotice` at 59-132, a new `UsageHeadsUpNotice` after `LimitReachedNotice` at 158)

**Interfaces:**

- Consumes: from Task 4, `resolveUsageHeadsUp`, `isUsageHeadsUpDismissed`, `describeUsageHeadsUp`, `type UsageHeadsUp`, `useUsageHeadsUpStore`, `selectUsageHeadsUpDismissal`, `dismissUsageHeadsUp` and the `sessionMove.headsUp.*` copy. From Task 1, `server_info.features.usageHeadsUp`. Existing: `useHostFeature(serverId, feature): boolean` (`packages/app/src/runtime/host-features.ts:34`), `useRelativeTimeTick({ enabled }): number` (`packages/app/src/usage/use-relative-time-tick.ts:5`), `formatResetTime(iso, now, t): string | null` (`packages/app/src/usage/format.ts:122`), `useAgentMove(input)` returning `{ canMove, targets, move, moveBack, status }` (`use-agent-move.ts:53-119`), `MoveRequest { target; model: string | undefined; continueWork: boolean }` (`move-model.ts:54-58`), `openMoveDialog(request)` (`move-dialog-store.ts:20`), `Alert` props `{ title?, description?, variant?: "default" | "info" | "success" | "warning" | "error", size?, children?, testID? }` with children laid out in a row (`components/ui/alert.tsx:12-22, 186-190`), `Button` variants `default | secondary | outline | ghost | destructive` with `loading` and `disabled`.
- Produces:
  - `MoveBannerView` gains `{ kind: "heads-up"; headsUp: UsageHeadsUp }`; `resolveMoveBannerView` takes a required `headsUp: UsageHeadsUp | null`.
  - `moveTargetsRefetchMs(input: { pollTargets: boolean; recheckProvider: string | null; targets: readonly AgentMoveTarget[] | undefined }): number | false`
  - `UseAgentMoveInput.pollTargets: boolean`.
  - Test ids `move-banner-heads-up`, `move-banner-heads-up-move`, `move-banner-heads-up-more`, `move-banner-heads-up-dismiss` (Task 8 drives them).

- [ ] **Step 1: Write the failing view tests.** In `packages/app/src/session-move/move-banner-view.test.ts`, give every existing call the new input first:

```bash
cd /workspace/utils/paseo/packages/app && sed -i 's/resolveMoveBannerView({/resolveMoveBannerView({ headsUp: null, /g' src/session-move/move-banner-view.test.ts && grep -c "headsUp: null" src/session-move/move-banner-view.test.ts
```

Expected: `9`. Then add `import type { UsageHeadsUp } from "./usage-heads-up";` after `import type { AgentMoveTargetsView } from "./move-targets";`, add this helper after `currentTarget`:

```ts
const HEADS_UP: UsageHeadsUp = {
  windowKey: "claude-work\nWeekly",
  account: "Claude (work)",
  usedPct: 84,
  windowLabel: "Weekly",
  resetsAt: TARGET_RESETS_AT,
  runsOutAt: null,
  tone: "warning",
  level: 1,
  best: null,
};
```

and add these tests inside `describe("resolveMoveBannerView", ...)`, before `describe("after a move", ...)`:

```ts
it("shows the heads-up for an agent that is neither limited nor moved", () => {
  expect(
    resolveMoveBannerView({
      headsUp: HEADS_UP,
      facts: facts(),
      targets: readyTargets(currentTarget(84)),
    }),
  ).toEqual({ kind: "heads-up", headsUp: HEADS_UP });
});

it("keeps the limit notice ahead of the heads-up", () => {
  expect(
    resolveMoveBannerView({
      headsUp: HEADS_UP,
      facts: limited,
      targets: readyTargets(currentTarget(100)),
    }),
  ).toEqual({ kind: "limit", account: "Claude (work)", resetsAt: TARGET_RESETS_AT });
});

it("puts the heads-up ahead of Moved from", () => {
  expect(
    resolveMoveBannerView({
      headsUp: HEADS_UP,
      facts: facts({ movedFromAgentId: "original", movedFromProvider: "claude" }),
      targets: readyTargets(currentTarget(84)),
    }),
  ).toEqual({ kind: "heads-up", headsUp: HEADS_UP });
});

it("shows no heads-up for an inactive agent", () => {
  expect(
    resolveMoveBannerView({
      headsUp: HEADS_UP,
      facts: INACTIVE,
      targets: readyTargets(currentTarget(84)),
    }),
  ).toEqual({ kind: "none" });
});
```

- [ ] **Step 2: Run it to see it fail.**

```bash
cd /workspace/utils/paseo/packages/app && flock /tmp/paseo-heavy.lock npx vitest run src/session-move/move-banner-view.test.ts --bail=1
```

Expected: FAIL on "shows the heads-up for an agent that is neither limited nor moved": received `{ kind: "none" }`. "puts the heads-up ahead of Moved from" fails as well (it gets the moved-from view), though `--bail=1` may stop the run before it. "keeps the limit notice ahead of the heads-up" and "shows no heads-up for an inactive agent" pass already: they guard the order and the inactive case, so they must keep passing after Step 3.

- [ ] **Step 3: Order the heads-up in the view.** In `packages/app/src/session-move/move-banner-view.ts`:

Replace

```ts
import type { MoveBannerFacts } from "./move-banner-facts";
```

with

```ts
import type { MoveBannerFacts } from "./move-banner-facts";
import type { UsageHeadsUp } from "./usage-heads-up";
```

Replace

```ts
export type MoveBannerView =
  | { kind: "none" }
  | { kind: "limit"; account: string; resetsAt: string | null }
  | { kind: "moved-from"; label: string | null; highlighted: boolean };

interface MoveBannerViewInput {
  facts: MoveBannerFacts;
  targets: AgentMoveTargetsView;
}
```

with

```ts
export type MoveBannerView =
  | { kind: "none" }
  | { kind: "limit"; account: string; resetsAt: string | null }
  | { kind: "heads-up"; headsUp: UsageHeadsUp }
  | { kind: "moved-from"; label: string | null; highlighted: boolean };

interface MoveBannerViewInput {
  facts: MoveBannerFacts;
  targets: AgentMoveTargetsView;
  /** The undismissed heads-up about the agent's own account; null on hosts without it. */
  headsUp: UsageHeadsUp | null;
}
```

Replace

```ts
/**
 * What the banner shows. A limit names the agent's own target and its reset; a move names the
 * original's target, highlighted once its usage is known to be under the limit.
 */
export function resolveMoveBannerView(input: MoveBannerViewInput): MoveBannerView {
  const { facts, targets } = input;
```

with

```ts
/**
 * What the banner shows, in this order: the limit, the usage heads-up, then "Moved from". A limit
 * names the agent's own target and its reset; a move names the original's target, highlighted
 * once its usage is known to be under the limit.
 */
export function resolveMoveBannerView(input: MoveBannerViewInput): MoveBannerView {
  const { facts, targets, headsUp } = input;
```

and replace

```ts
  if (kind === "moved-from") {
    const original = findTargetByProvider(targets, facts.movedFromProvider);
```

with

```ts
  // Fork delta (usage heads-up): after the limit, ahead of "Moved from".
  if (headsUp) return { kind: "heads-up", headsUp };
  if (kind === "moved-from") {
    const original = findTargetByProvider(targets, facts.movedFromProvider);
```

- [ ] **Step 4: Run it to see it pass.** Same command as Step 2. Expected: PASS, 22 tests.

- [ ] **Step 5: Write the failing poll test.** In `packages/app/src/session-move/move-targets.test.ts`, add `moveTargetsRefetchMs,` after `moveTargetsRecheckMs,` in the import list, and append:

```ts
describe("moveTargetsRefetchMs", () => {
  const usedUp = [target({ provider: "claude", usedPct: 100 })];

  it("polls every five minutes while the heads-up watches the agent's own account", () => {
    expect(
      moveTargetsRefetchMs({ pollTargets: true, recheckProvider: null, targets: undefined }),
    ).toBe(MOVE_BACK_RECHECK_MS);
  });

  it("otherwise polls only while the original's account is used up", () => {
    expect(
      moveTargetsRefetchMs({ pollTargets: false, recheckProvider: "claude", targets: usedUp }),
    ).toBe(MOVE_BACK_RECHECK_MS);
    expect(
      moveTargetsRefetchMs({
        pollTargets: false,
        recheckProvider: "claude",
        targets: [target({ provider: "claude", usedPct: 50 })],
      }),
    ).toBe(false);
    expect(
      moveTargetsRefetchMs({ pollTargets: false, recheckProvider: null, targets: usedUp }),
    ).toBe(false);
  });
});
```

- [ ] **Step 6: Run it to see it fail.**

```bash
cd /workspace/utils/paseo/packages/app && flock /tmp/paseo-heavy.lock npx vitest run src/session-move/move-targets.test.ts --bail=1
```

Expected: FAIL, `moveTargetsRefetchMs is not a function`.

- [ ] **Step 7: Add the poll rule.** In `packages/app/src/session-move/move-targets.ts`, replace

```ts
/**
 * How often a mounted Move back re-reads the original's account while it is used up. The daemon
 * caches each usage report for five minutes, so a faster poll would only re-read the cache.
 */
```

with

```ts
/**
 * How often a mounted Move back re-reads the original's account while it is used up, and a
 * usage heads-up re-reads the agent's own. The daemon caches each usage report for five minutes,
 * so a faster poll would only re-read the cache.
 */
```

and insert after the closing brace of `moveTargetsRecheckMs`:

```ts
/**
 * The targets query's refetch interval. Fork delta (usage heads-up): while `pollTargets` is set
 * the agent's own account is read every five minutes; otherwise only a Move back polls.
 */
export function moveTargetsRefetchMs(input: {
  pollTargets: boolean;
  recheckProvider: string | null;
  targets: readonly AgentMoveTarget[] | undefined;
}): number | false {
  if (input.pollTargets) return MOVE_BACK_RECHECK_MS;
  if (input.recheckProvider === null) return false;
  return moveTargetsRecheckMs(input.targets, input.recheckProvider);
}
```

- [ ] **Step 8: Run it to see it pass.** Same command as Step 6. Expected: PASS, 21 tests.

- [ ] **Step 9: Let the hook poll.** In `packages/app/src/session-move/use-agent-move.ts`:

Replace

```ts
import { moveTargetsRecheckMs, resolveMoveTargetsView } from "./move-targets";
```

with

```ts
import { moveTargetsRefetchMs, resolveMoveTargetsView } from "./move-targets";
```

Replace

```ts
/** While set, the targets are read again until this provider's account is under its limit. */
recheckProvider: string | null;
```

with

```ts
/** While set, the targets are read again until this provider's account is under its limit. */
recheckProvider: string | null;
/** While true, the targets are read again every five minutes for the usage heads-up. */
pollTargets: boolean;
```

Replace

```ts
const { serverId, agentId, targetsEnabled, recheckProvider, onMoved } = input;
```

with

```ts
const { serverId, agentId, targetsEnabled, recheckProvider, pollTargets, onMoved } = input;
```

Replace

```ts
    // Re-evaluated after each fetch, so the poll stops once the account is under its limit.
    refetchInterval: recheckProvider
      ? (query) => moveTargetsRecheckMs(query.state.data, recheckProvider)
      : false,
```

with

```ts
    // Re-evaluated after each fetch, so a Move back's poll stops once the account is under its limit.
    refetchInterval: (query) =>
      moveTargetsRefetchMs({ pollTargets, recheckProvider, targets: query.state.data }),
```

In `packages/app/src/session-move/move-dialog.tsx`, replace

```ts
    recheckProvider: null,
    onMoved: closeMoveDialog,
```

with

```ts
    recheckProvider: null,
    pollTargets: false,
    onMoved: closeMoveDialog,
```

- [ ] **Step 10: Render the heads-up.** In `packages/app/src/session-move/move-banner.tsx`, replace the import block (lines 1-27, through `import { useAgentMove, useSupportsAgentMove } from "./use-agent-move";`) with:

```tsx
import { useCallback, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useShallow } from "zustand/shallow";
import { useRetainedPanelActive } from "@/components/retained-panel";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useFetchQuery } from "@/data/query";
import { useHostFeature } from "@/runtime/host-features";
import { useHostRuntimeClient, useHostRuntimeIsConnected } from "@/runtime/host-runtime";
import { useSessionStore } from "@/stores/session-store";
import { formatResetLabel, formatResetTime } from "@/usage/format";
import { useRelativeTimeTick } from "@/usage/use-relative-time-tick";
import { storeFetchedAgentDetail } from "@/utils/fetched-agent-detail";
import {
  selectMoveBannerFacts,
  selectMovedFromAgentToFetch,
  type MoveBannerFacts,
} from "./move-banner-facts";
import {
  resolveMoveBannerKind,
  resolveMoveBannerView,
  upcomingLimitReset,
  type MoveBannerKind,
} from "./move-banner-view";
import { openMoveDialog } from "./move-dialog-store";
import { useAgentMove, useSupportsAgentMove } from "./use-agent-move";
import {
  describeUsageHeadsUp,
  isUsageHeadsUpDismissed,
  resolveUsageHeadsUp,
  type UsageHeadsUp,
} from "./usage-heads-up";
import {
  dismissUsageHeadsUp,
  selectUsageHeadsUpDismissal,
  useUsageHeadsUpStore,
} from "./usage-heads-up-store";
```

Replace everything from the doc comment above `export function MoveBanner` through the closing brace of `MoveBannerNotice` (lines 59-132) with:

```tsx
/**
 * The notice above an agent's composer about moving it: its account hit a limit, is about to run
 * out, or it was moved here from another account it can go back to. Nothing on hosts that cannot
 * move agents.
 */
export function MoveBanner(props: MoveBannerProps) {
  const supported = useSupportsAgentMove(props.serverId);
  if (!supported) return null;
  return <SupportedMoveBanner {...props} />;
}

function SupportedMoveBanner({ serverId, workspaceId, agentId }: MoveBannerProps) {
  const facts = useSessionStore(
    useShallow((state) => selectMoveBannerFacts(state.sessions[serverId], agentId)),
  );
  useLoadMovedFromAgent(serverId, selectMovedFromAgentToFetch(facts));
  // Fork delta (usage heads-up): a host that reports run-outs keeps the banner mounted for every
  // live agent, so it can read the agent's own account.
  const headsUpSupported = useHostFeature(serverId, "usageHeadsUp");
  const kind = resolveMoveBannerKind(facts);
  if (facts.kind === "inactive") return null;
  if (kind === "none" && !headsUpSupported) return null;
  // Keyed by kind, so a Move back notice that turns into a limit mounts a new targets observer,
  // which reads the targets again instead of naming a reset from the last Move back fetch.
  return (
    <MoveBannerNotice
      key={kind}
      serverId={serverId}
      workspaceId={workspaceId}
      agentId={agentId}
      facts={facts}
      kind={kind}
      headsUpSupported={headsUpSupported}
    />
  );
}

interface MoveBannerNoticeProps extends MoveBannerProps {
  facts: MoveBannerFacts;
  kind: MoveBannerKind;
  headsUpSupported: boolean;
}

function MoveBannerNotice({
  serverId,
  workspaceId,
  agentId,
  facts,
  kind,
  headsUpSupported,
}: MoveBannerNoticeProps) {
  const isPanelActive = useRetainedPanelActive();
  // A hidden tab fetches nothing, and only a Move back on screen polls the original's account.
  const isMoveBackOnScreen = kind === "moved-from" && isPanelActive;
  const isHeadsUpOnScreen = headsUpSupported && isPanelActive;
  const movedFromProvider = facts.kind === "live" ? facts.movedFromProvider : null;
  const { canMove, targets, move, moveBack, status } = useAgentMove({
    serverId,
    agentId,
    targetsEnabled: isPanelActive,
    recheckProvider: isMoveBackOnScreen ? movedFromProvider : null,
    pollTargets: isHeadsUpOnScreen,
  });
  const now = useRelativeTimeTick({ enabled: isHeadsUpOnScreen });
  const headsUp = useMemo(
    () => (headsUpSupported ? resolveUsageHeadsUp(targets, now) : null),
    [headsUpSupported, now, targets],
  );
  const dismissal = useUsageHeadsUpStore((state) =>
    selectUsageHeadsUpDismissal(state, { serverId, windowKey: headsUp?.windowKey ?? null }),
  );
  const visibleHeadsUp =
    headsUp && !isUsageHeadsUpDismissed({ headsUp, dismissal, now }) ? headsUp : null;
  const openDialog = useCallback(
    () => openMoveDialog({ serverId, workspaceId, agentId }),
    [agentId, serverId, workspaceId],
  );
  const moveBackAndContinue = useCallback(() => moveBack({ continueWork: true }), [moveBack]);
  const bestTarget = visibleHeadsUp?.best ?? null;
  // The dialog's path: the target's default model, and the agent continues on its own.
  const moveToBest = useCallback(() => {
    if (bestTarget) move({ target: bestTarget, model: undefined, continueWork: true });
  }, [bestTarget, move]);
  const dismissHeadsUp = useCallback(() => {
    if (!visibleHeadsUp) return;
    dismissUsageHeadsUp({
      serverId,
      windowKey: visibleHeadsUp.windowKey,
      dismissal: { level: visibleHeadsUp.level, resetsAt: visibleHeadsUp.resetsAt },
    });
  }, [serverId, visibleHeadsUp]);
  const view = resolveMoveBannerView({ facts, targets, headsUp: visibleHeadsUp });

  if (view.kind === "limit") {
    return (
      <LimitReachedNotice account={view.account} resetsAt={view.resetsAt} onMove={openDialog} />
    );
  }
  if (view.kind === "heads-up") {
    return (
      <UsageHeadsUpNotice
        headsUp={view.headsUp}
        now={now}
        canMove={canMove}
        isMoving={status.kind === "loading"}
        error={status.kind === "error" ? status.message : null}
        onMove={moveToBest}
        onMore={openDialog}
        onDismiss={dismissHeadsUp}
      />
    );
  }
  if (view.kind === "moved-from") {
    return (
      <MovedFromNotice
        label={view.label}
        highlighted={view.highlighted}
        canMoveBack={canMove}
        isMovingBack={status.kind === "loading"}
        error={status.kind === "error" ? status.message : null}
        onMoveBack={moveBackAndContinue}
      />
    );
  }
  return null;
}
```

Insert after the closing brace of `LimitReachedNotice`:

```tsx
interface UsageHeadsUpNoticeProps {
  headsUp: UsageHeadsUp;
  now: number;
  canMove: boolean;
  isMoving: boolean;
  error: string | null;
  onMove: () => void;
  onMore: () => void;
  onDismiss: () => void;
}

/** Fork delta (usage heads-up): the agent's account is about to run out. */
function UsageHeadsUpNotice({
  headsUp,
  now,
  canMove,
  isMoving,
  error,
  onMove,
  onMore,
  onDismiss,
}: UsageHeadsUpNoticeProps) {
  const { t } = useTranslation();
  const formatClock = useCallback((iso: string | null) => formatResetTime(iso, now, t), [now, t]);
  const { message, moveLabel } = describeUsageHeadsUp(headsUp, { t, formatClock });
  const isDanger = headsUp.tone === "danger";
  return (
    <NoticeRail>
      <Alert
        size="sm"
        variant={error || isDanger ? "error" : "warning"}
        title={error ? message : undefined}
        description={error ?? message}
        testID="move-banner-heads-up"
      >
        {moveLabel ? (
          <Button
            variant="outline"
            onPress={onMove}
            disabled={!canMove}
            loading={isMoving}
            testID="move-banner-heads-up-move"
          >
            {isMoving ? t("sessionMove.headsUp.moving") : moveLabel}
          </Button>
        ) : null}
        <Button variant="outline" onPress={onMore} testID="move-banner-heads-up-more">
          {t("sessionMove.headsUp.more")}
        </Button>
        <Button variant="ghost" onPress={onDismiss} testID="move-banner-heads-up-dismiss">
          {t("sessionMove.headsUp.dismiss")}
        </Button>
      </Alert>
    </NoticeRail>
  );
}
```

`MoveBannerProps` is an `interface`, so `MoveBannerNoticeProps extends` it.

- [ ] **Step 11: Run the app's move tests, format, lint and typecheck.**

```bash
cd /workspace/utils/paseo/packages/app && flock /tmp/paseo-heavy.lock npx vitest run src/session-move/move-banner-view.test.ts --bail=1 && flock /tmp/paseo-heavy.lock npx vitest run src/session-move/move-targets.test.ts --bail=1 && cd /workspace/utils/paseo && npm run format:files -- packages/app/src/session-move/move-banner-view.ts packages/app/src/session-move/move-banner-view.test.ts packages/app/src/session-move/move-targets.ts packages/app/src/session-move/move-targets.test.ts packages/app/src/session-move/use-agent-move.ts packages/app/src/session-move/move-dialog.tsx packages/app/src/session-move/move-banner.tsx && npm run lint -- packages/app/src/session-move/move-banner-view.ts packages/app/src/session-move/move-banner-view.test.ts packages/app/src/session-move/move-targets.ts packages/app/src/session-move/move-targets.test.ts packages/app/src/session-move/use-agent-move.ts packages/app/src/session-move/move-dialog.tsx packages/app/src/session-move/move-banner.tsx && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/app -- --singleThreaded
```

Expected: PASS (22 tests), PASS (21 tests), then format, lint and typecheck exit 0. The banner itself is checked in Task 8, on a dev daemon in the browser.

- [ ] **Step 12: Commit.**

```bash
git -C /workspace/utils/paseo add packages/app/src/session-move/move-banner-view.ts packages/app/src/session-move/move-banner-view.test.ts packages/app/src/session-move/move-targets.ts packages/app/src/session-move/move-targets.test.ts packages/app/src/session-move/use-agent-move.ts packages/app/src/session-move/move-dialog.tsx packages/app/src/session-move/move-banner.tsx && git -C /workspace/utils/paseo diff --cached --name-only && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(app): usage heads-up in the move banner" -- packages/app/src/session-move/move-banner-view.ts packages/app/src/session-move/move-banner-view.test.ts packages/app/src/session-move/move-targets.ts packages/app/src/session-move/move-targets.test.ts packages/app/src/session-move/use-agent-move.ts packages/app/src/session-move/move-dialog.tsx packages/app/src/session-move/move-banner.tsx && git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
```

Expected: exactly the seven paths staged, the hook passes, `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.

---

### Task 6: The `usage` attention reason, behind a client capability

**Files:**

- Modify: `packages/protocol/src/client-capabilities.ts:58` (before `browserHost`)
- Modify: `packages/protocol/src/messages.ts:5084-5103` (`AgentAttentionRequiredMessageSchema`)
- Modify: `packages/protocol/src/agent-attention-notification.ts:3-17, 196-198`
- Modify: `packages/protocol/src/messages.usage-heads-up.test.ts` (from Task 1)
- Modify: `packages/client/src/connection/index.ts:149` (`DEFAULT_CLIENT_CAPABILITIES`)
- Modify: `packages/client/src/daemon-client.ts:28, 479-485`
- Modify: `packages/client/src/daemon-client.test.ts` (imports at 4-14, the hello test at 1095-1153, a new test after the one at 548-582)
- Modify: `packages/app/src/contexts/session-context.tsx:21-26, 137-165, 257-262`

**Interfaces:**

- Consumes: `CLIENT_CAPS` and `type ClientCapability` (`packages/protocol/src/client-capabilities.ts:61`), `validateWSOutboundMessage` (the client checks every inbound frame with it, `packages/client/src/daemon-client.ts:45, 7115-7117`; the generated validator is rebuilt by `build:protocol`), `DaemonClient.onAgentAttentionRequired(handler)` (`daemon-client.ts:2040-2063`), the app's `notifyAgentAttention` and `resolveAgentAttentionNotification` (`session-context.tsx:148-165, 257-305`).
- Produces (Task 7 sends them):
  - `CLIENT_CAPS.usageNotifications = "usage_notifications"`, advertised by every `DaemonClient` through `DEFAULT_CLIENT_CAPABILITIES`.
  - `type AgentAttentionNotificationReason = AgentAttentionReason | "usage"`.
  - `AgentAttentionNotificationData<Reason extends AgentAttentionNotificationReason = AgentAttentionNotificationReason>` and `AgentAttentionNotificationPayload<Reason ...>`; `buildAgentAttentionNotificationPayload(input): AgentAttentionNotificationPayload<AgentAttentionReason>`.
  - `agent_attention_required.payload.reason` and `.notification.data.reason` accept `"usage"`; the legacy `agent_stream` `attention_required` event does not.
  - `AgentAttentionRequiredNotification.reason: AgentAttentionNotificationReason`.

- [ ] **Step 1: Write the failing client tests.** In `packages/client/src/daemon-client.test.ts`:

Add `type AgentAttentionRequiredNotification,` after `type CreateAgentRequestOptions,` in the `./daemon-client` import.

In the test "advertises client capabilities in hello", replace

```ts
      background_agents: true,
      browser_host: {
```

with

```ts
      background_agents: true,
      usage_notifications: true,
      browser_host: {
```

Insert after the test "normalizes legacy and dedicated agent attention notifications":

```ts
test("passes a usage attention notification through", async () => {
  const mock = createMockTransport();
  const client = new DaemonClient({
    url: "ws://test",
    clientId: "usage_attention",
    transportFactory: () => mock.transport,
    reconnect: { enabled: false },
  });
  clients.push(client);
  const connect = client.connect();
  mock.triggerOpen();
  await connect;
  const notifications: AgentAttentionRequiredNotification[] = [];
  client.onAgentAttentionRequired((notification) => notifications.push(notification));
  const payload: AgentAttentionRequiredNotification = {
    agentId: "agent-a",
    reason: "usage",
    timestamp: "2026-11-06T10:00:00.000Z",
    shouldNotify: true,
    notification: {
      title: "Claude (work) 81% of Weekly",
      body: "Fix login · Move to Claude · 12%",
      data: { serverId: "srv-a", workspaceId: "ws-1", agentId: "agent-a", reason: "usage" },
    },
  };

  mock.triggerMessage(wrapSessionMessage({ type: "agent_attention_required", payload }));

  expect(notifications).toEqual([payload]);
});
```

- [ ] **Step 2: Run them to see them fail.**

```bash
cd /workspace/utils/paseo/packages/client && flock /tmp/paseo-heavy.lock npx vitest run src/daemon-client.test.ts -t "advertises client capabilities in hello|passes a usage attention notification through"
```

Expected: FAIL, both: the hello lacks `usage_notifications`, and the usage notification is dropped by the inbound validator (`notifications` is `[]`).

- [ ] **Step 3: Write the failing wire tests.** In `packages/protocol/src/messages.usage-heads-up.test.ts`, replace

```ts
import { AgentMoveTargetSchema, type AgentMoveTarget } from "./messages.js";
```

with

```ts
import type { AgentAttentionNotificationPayload } from "./agent-attention-notification.js";
import {
  AgentAttentionRequiredMessageSchema,
  AgentMoveTargetSchema,
  AgentStreamEventPayloadSchema,
  type AgentMoveTarget,
} from "./messages.js";
```

and append:

```ts
const USAGE_NOTIFICATION: AgentAttentionNotificationPayload<"usage"> = {
  title: "Claude (work) 81% of Weekly",
  body: "Fix login · Move to Claude · 12%",
  data: { serverId: "srv-a", workspaceId: "ws-1", agentId: "agent-a", reason: "usage" },
};

describe("usage attention (usage heads-up)", () => {
  it("carries the usage reason on the dedicated attention message", () => {
    const message = {
      type: "agent_attention_required",
      payload: {
        agentId: "agent-a",
        reason: "usage",
        timestamp: "2026-11-06T10:00:00.000Z",
        shouldNotify: false,
        notification: USAGE_NOTIFICATION,
      },
    };
    expect(AgentAttentionRequiredMessageSchema.parse(message)).toEqual(message);
  });

  it("keeps the usage reason off the legacy agent stream event", () => {
    expect(
      AgentStreamEventPayloadSchema.safeParse({
        type: "attention_required",
        provider: "claude",
        reason: "usage",
        timestamp: "2026-11-06T10:00:00.000Z",
        shouldNotify: false,
        notification: USAGE_NOTIFICATION,
      }).success,
    ).toBe(false);
  });
});
```

- [ ] **Step 4: Run it to see it fail.**

```bash
cd /workspace/utils/paseo/packages/protocol && flock /tmp/paseo-heavy.lock npx vitest run src/messages.usage-heads-up.test.ts --bail=1
```

Expected: FAIL on "carries the usage reason on the dedicated attention message": `Invalid option: expected one of "finished"|"error"|"permission"`.

- [ ] **Step 5: Widen the dedicated message only.** In `packages/protocol/src/messages.ts`, replace

```ts
export const AgentAttentionRequiredMessageSchema = z.object({
  type: z.literal("agent_attention_required"),
  payload: z.object({
    subscriptionId: z.string().optional(),
    agentId: z.string(),
    reason: z.enum(["finished", "error", "permission"]),
    timestamp: z.string(),
    shouldNotify: z.boolean(),
    notification: z
      .object({
        title: z.string(),
        body: z.string(),
        data: z.object({
          serverId: z.string(),
          workspaceId: z.string().optional(),
          agentId: z.string(),
          reason: z.enum(["finished", "error", "permission"]),
        }),
      })
      .optional(),
  }),
});
```

with

```ts
// Fork delta (usage heads-up): "usage" is sent only to clients that advertise
// CLIENT_CAPS.usageNotifications; the legacy agent_stream attention event never carries it.
const AgentAttentionNotificationReasonSchema = z.enum(["finished", "error", "permission", "usage"]);

export const AgentAttentionRequiredMessageSchema = z.object({
  type: z.literal("agent_attention_required"),
  payload: z.object({
    subscriptionId: z.string().optional(),
    agentId: z.string(),
    reason: AgentAttentionNotificationReasonSchema,
    timestamp: z.string(),
    shouldNotify: z.boolean(),
    notification: z
      .object({
        title: z.string(),
        body: z.string(),
        data: z.object({
          serverId: z.string(),
          workspaceId: z.string().optional(),
          agentId: z.string(),
          reason: AgentAttentionNotificationReasonSchema,
        }),
      })
      .optional(),
  }),
});
```

In `packages/protocol/src/client-capabilities.ts`, replace

```ts
  backgroundAgents: "background_agents",
  browserHost: "browser_host",
```

with

```ts
  backgroundAgents: "background_agents",
  // COMPAT(usageNotifications): added after v0.15.2, remove the gate after 2027-05-07 once client
  // floor > v0.15.2. Fork delta (usage heads-up): the client reads reason "usage" on
  // agent_attention_required. Without it the daemon sends no usage notice to that client and does
  // not count it as present.
  usageNotifications: "usage_notifications",
  browserHost: "browser_host",
```

In `packages/protocol/src/agent-attention-notification.ts`, replace

```ts
export type AgentAttentionReason = "finished" | "error" | "permission";

export interface AgentAttentionNotificationData {
  [key: string]: unknown;
  serverId: string;
  workspaceId?: string;
  agentId: string;
  reason: AgentAttentionReason;
}

export interface AgentAttentionNotificationPayload {
  title: string;
  body: string;
  data: AgentAttentionNotificationData;
}
```

with

```ts
export type AgentAttentionReason = "finished" | "error" | "permission";

/**
 * Fork delta (usage heads-up): an account crossing a usage level. Only the dedicated
 * agent_attention_required message carries it, to clients that advertise usage_notifications;
 * an agent's own turn never raises it.
 */
export type AgentAttentionNotificationReason = AgentAttentionReason | "usage";

export interface AgentAttentionNotificationData<
  Reason extends AgentAttentionNotificationReason = AgentAttentionNotificationReason,
> {
  [key: string]: unknown;
  serverId: string;
  workspaceId?: string;
  agentId: string;
  reason: Reason;
}

export interface AgentAttentionNotificationPayload<
  Reason extends AgentAttentionNotificationReason = AgentAttentionNotificationReason,
> {
  title: string;
  body: string;
  data: AgentAttentionNotificationData<Reason>;
}
```

and replace

```ts
export function buildAgentAttentionNotificationPayload(
  input: BuildAgentAttentionNotificationPayloadInput,
): AgentAttentionNotificationPayload {
```

with

```ts
export function buildAgentAttentionNotificationPayload(
  input: BuildAgentAttentionNotificationPayloadInput,
): AgentAttentionNotificationPayload<AgentAttentionReason> {
```

- [ ] **Step 6: Run the wire tests and rebuild the protocol.**

```bash
cd /workspace/utils/paseo/packages/protocol && flock /tmp/paseo-heavy.lock npx vitest run src/messages.usage-heads-up.test.ts --bail=1 && flock /tmp/paseo-heavy.lock npx vitest run src/agent-attention-notification.test.ts --bail=1 && cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run build:protocol && grep -c 'values:\["finished","error","permission","usage"\]' packages/protocol/src/generated/validation/ws-outbound.aot.ts
```

Expected: PASS (4 tests), PASS (the builder tests are unchanged), the build exits 0, and the count is at least 2: the regenerated validator inlines the widened enum for `payload.reason` and `notification.data.reason`. Before this task the count is 0, while the three-value form `values:["finished","error","permission"]` appears 24 times (checked on 2026-11-07). Do not count bare `"usage"`: the validator already holds it 18 times for other messages, so that count proves nothing.

- [ ] **Step 7: Advertise the capability and widen the client type.** In `packages/client/src/connection/index.ts`, replace

```ts
  [CLIENT_CAPS.explicitEventSubscriptions]: true,
} satisfies Record<Exclude<ClientCapability, typeof CLIENT_CAPS.browserHost>, true>;
```

with

```ts
  [CLIENT_CAPS.explicitEventSubscriptions]: true,
  [CLIENT_CAPS.usageNotifications]: true,
} satisfies Record<Exclude<ClientCapability, typeof CLIENT_CAPS.browserHost>, true>;
```

In `packages/client/src/daemon-client.ts`, replace

```ts
import type { AgentAttentionNotificationPayload } from "@getpaseo/protocol/agent-attention-notification";
```

with

```ts
import type {
  AgentAttentionNotificationPayload,
  AgentAttentionNotificationReason,
} from "@getpaseo/protocol/agent-attention-notification";
```

and replace

```ts
export interface AgentAttentionRequiredNotification {
  agentId: string;
  reason: "finished" | "error" | "permission";
```

with

```ts
export interface AgentAttentionRequiredNotification {
  agentId: string;
  reason: AgentAttentionNotificationReason;
```

- [ ] **Step 8: Run the client tests and rebuild the client.**

```bash
cd /workspace/utils/paseo/packages/client && flock /tmp/paseo-heavy.lock npx vitest run src/daemon-client.test.ts -t "advertises client capabilities in hello|passes a usage attention notification through|normalizes legacy and dedicated agent attention notifications" && cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock npm run build:client
```

Expected: PASS (3 tests), the build exits 0.

- [ ] **Step 9: Let the app take the wider reason.** In `packages/app/src/contexts/session-context.tsx`, replace

```ts
  buildAgentAttentionNotificationPayload,
  type AgentAttentionReason,
  type AgentAttentionNotificationPayload,
```

with

```ts
  buildAgentAttentionNotificationPayload,
  type AgentAttentionNotificationReason,
  type AgentAttentionNotificationPayload,
```

replace

```ts
  notification?: AgentAttentionNotificationPayload;
  reason: AgentAttentionReason;
```

with

```ts
  notification?: AgentAttentionNotificationPayload;
  reason: AgentAttentionNotificationReason;
```

replace

```ts
  if (!input.workspaceId) {
    return null;
  }
  return buildAgentAttentionNotificationPayload({
```

with

```ts
  if (!input.workspaceId) {
    return null;
  }
  // Fork delta (usage heads-up): the daemon always writes a usage notice; there is no local copy.
  if (input.reason === "usage") {
    return null;
  }
  return buildAgentAttentionNotificationPayload({
```

and replace

```ts
agentId: string;
reason: "finished" | "error" | "permission";
timestamp: string;
```

with

```ts
agentId: string;
reason: AgentAttentionNotificationReason;
timestamp: string;
```

A usage notice then takes the same path as a finish: suppressed while the app is visible on that agent, deduplicated per agent by timestamp, shown through `sendOsNotification`, and a tap opens the agent from `data.serverId` and `data.agentId`.

- [ ] **Step 10: Format, lint and typecheck every workspace the types reach.**

```bash
cd /workspace/utils/paseo && npm run format:files -- packages/protocol/src/client-capabilities.ts packages/protocol/src/messages.ts packages/protocol/src/agent-attention-notification.ts packages/protocol/src/messages.usage-heads-up.test.ts packages/client/src/connection/index.ts packages/client/src/daemon-client.ts packages/client/src/daemon-client.test.ts packages/app/src/contexts/session-context.tsx && npm run lint -- packages/protocol/src/client-capabilities.ts packages/protocol/src/messages.ts packages/protocol/src/agent-attention-notification.ts packages/protocol/src/messages.usage-heads-up.test.ts packages/client/src/connection/index.ts packages/client/src/daemon-client.ts packages/client/src/daemon-client.test.ts packages/app/src/contexts/session-context.tsx && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/protocol -- --singleThreaded && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/client -- --singleThreaded && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/server -- --singleThreaded && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/app -- --singleThreaded
```

Expected: exit 0. The server still compiles unchanged: `buildAgentAttentionNotificationPayload` now returns the narrow payload, which both the dedicated and the legacy message accept.

- [ ] **Step 11: Commit.**

```bash
git -C /workspace/utils/paseo add packages/protocol/src/client-capabilities.ts packages/protocol/src/messages.ts packages/protocol/src/agent-attention-notification.ts packages/protocol/src/messages.usage-heads-up.test.ts packages/client/src/connection/index.ts packages/client/src/daemon-client.ts packages/client/src/daemon-client.test.ts packages/app/src/contexts/session-context.tsx && git -C /workspace/utils/paseo diff --cached --name-only && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(protocol): usage attention reason behind a client capability" -- packages/protocol/src/client-capabilities.ts packages/protocol/src/messages.ts packages/protocol/src/agent-attention-notification.ts packages/protocol/src/messages.usage-heads-up.test.ts packages/client/src/connection/index.ts packages/client/src/daemon-client.ts packages/client/src/daemon-client.test.ts packages/app/src/contexts/session-context.tsx && git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
```

Expected: exactly the eight paths staged, the hook passes, `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.

---

### Task 7: The daemon's usage watch and its notification

**Files:**

- Create: `packages/server/src/server/agent/session-move/usage-watch.ts`
- Create: `packages/server/src/server/agent/session-move/usage-watch.test.ts`
- Modify: `packages/server/src/server/websocket-server.ts` (imports at 32 and 97-100, a type after `TerminalAttentionReason` at 203, `broadcastAgentAttention` at 2876-2972)
- Modify: `packages/server/src/server/websocket-server.notifications.test.ts` (imports, `connectClient` at 185-215, new tests at the end of the `describe`)
- Modify: `packages/server/src/server/bootstrap.ts` (imports at 1-11, a `let` after `wsServer` at 750, the start after `wsServer.beginAcceptingConnections()` at 1902, the stop after `await idleRuntimeCleanup.close()` at 1989)

**Interfaces:**

- Consumes: from Task 1, `chooseBestMoveTarget`, `usageLevel`, `windowUsedPct`, `type UsageLevel`. From Task 3, `listAgentMoveTargets`, `moveTargetProvidersFrom`, `sharedMoveTargetUsage`, `type ListUsageReportsForScope`, `type UsageScopeQuery`, `type MoveTarget`. From Task 6, `CLIENT_CAPS.usageNotifications`, `AgentAttentionNotificationPayload<Reason>`, the widened `agent_attention_required`. Existing: `isDelegatedAgent(agent)` (`packages/protocol/src/agent-labels.ts:25`), `computeNotificationPlan({ allStates, focusTarget, pushEligible, nowMs })` and `isPushEligibleAttentionReason` (`packages/server/src/server/agent-attention-policy.ts:43, 78`), `Session.supportsForSource(capability, source)` (`session.ts:1495`), `Session.subscribesToAgent(agent, source)` (`session.ts:2384`), `Session.publishToSource(source, message)` (`session.ts:2401`), `PushNotificationSender.send(payload: PushPayload)` (`push/push-service.ts:3-7`), `AgentManager.listAgents()` (`agent-manager.ts:1224`, internal agents excluded), `AgentStorage.get(id)` (`agent-storage.ts:251`, `title` at 60), `ProviderSnapshotManager.getProviderLaunchInfo` (`:367`), `PluginService.listUsageReportsForScope(scope): Promise<UsageReportEntry[]>` (`plugins/index.ts:215`, `usage-sources/index.ts:121`).
- Produces:
  - `usage-watch.ts`: `USAGE_WATCH_INTERVAL_MS = 310_000`, `interface WatchedAgent { id; provider; title: string | null }`, `interface UsageNotice { agentId; provider; title; body }`, `interface UsageWatchDeps`, `interface CrossingTracker { observe(input: { key: string; usedPct: number }): UsageLevel | null }`, `createCrossingTracker()`, `interface UsageWatch { check(): Promise<void> }`, `createUsageWatch(deps): UsageWatch`, `interface WatchCandidate`, `isWatchedAgent(agent: WatchCandidate): boolean`, `interface IntervalTimer { every(input: { ms: number; tick: () => void }): () => void }`, `nodeIntervalTimer`, `startUsageWatch(input: { watch; logger; timer?; intervalMs? }): () => void`.
  - `VoiceAssistantWebSocketServer.broadcastUsageAttention(notice: UsageNotice): Promise<void>` (public; `bootstrap` calls it).
  - Log lines `usage watch: started` (with `intervalMs`), `usage watch: notified` (with `agentId`, `provider` and `usedPct`), `usage watch: check failed`, `usage watch: move targets failed`, `usage watch: tick failed`; Task 8 times its steps from the first, reads the second, and counts the last three, expecting none.

- [ ] **Step 1: Write the failing watch test.** Create `packages/server/src/server/agent/session-move/usage-watch.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { Logger } from "pino";
import { PARENT_AGENT_ID_LABEL } from "@getpaseo/protocol/agent-labels";
import type { ProviderUsageWindow, UsageReportEntry } from "@getpaseo/protocol/messages";
import type { ProviderLaunchInfo } from "../provider-snapshot-manager.js";
import type { UsageScopeQuery } from "./list-move-targets.js";
import type { MoveTarget } from "./move-targets.js";
import {
  USAGE_WATCH_INTERVAL_MS,
  createUsageWatch,
  isWatchedAgent,
  startUsageWatch,
  type IntervalTimer,
  type UsageNotice,
  type UsageWatch,
  type UsageWatchDeps,
  type WatchCandidate,
  type WatchedAgent,
} from "./usage-watch.js";

const RESETS = "2026-11-07T09:00:00.000Z";

const WORK: ProviderLaunchInfo = {
  providerId: "claude-work",
  family: "claude",
  label: "Claude (work)",
  enabled: true,
  env: { CLAUDE_CONFIG_DIR: "/home/me/.claude-work" },
};

const CODEX: ProviderLaunchInfo = {
  providerId: "codex",
  family: "codex",
  label: "Codex",
  enabled: true,
  env: {},
};

const FIX_LOGIN: WatchedAgent = { id: "agent-1", provider: "claude-work", title: "Fix login" };

function moveTarget(overrides: Partial<MoveTarget> & { provider: string }): MoveTarget {
  return {
    label: overrides.provider,
    family: "claude",
    available: true,
    current: false,
    usedPct: null,
    resetsAt: null,
    runsOutAt: null,
    windowLabel: null,
    ...overrides,
  };
}

const CURRENT: MoveTarget = moveTarget({
  provider: "claude-work",
  label: "Claude (work)",
  current: true,
  usedPct: 81,
});
const CLAUDE: MoveTarget = moveTarget({ provider: "claude", label: "Claude", usedPct: 12 });

function weeklyReport(usedPct: number): UsageReportEntry[] {
  const weekly: ProviderUsageWindow = { id: "weekly", label: "Weekly", usedPct, resetsAt: RESETS };
  return [
    {
      id: "claude:work",
      account: {},
      fetchedAt: "2026-11-06T10:00:00.000Z",
      sourceId: "claude",
      sourceLabel: "Claude",
      report: { status: "available", windows: [weekly] },
    },
  ];
}

function recordingLogger(logs: string[]): Pick<Logger, "info" | "warn"> {
  return {
    info: (_details: unknown, message?: string) => {
      logs.push(`info ${message ?? ""}`);
    },
    warn: (_details: unknown, message?: string) => {
      logs.push(`warn ${message ?? ""}`);
    },
  };
}

interface Harness {
  watch: UsageWatch;
  notices: UsageNotice[];
  scopes: UsageScopeQuery[];
  logs: string[];
  /** The weekly window's used percent, per CLI family; a family without one reports nothing. */
  usage: Map<string, number>;
}

function harness(overrides: Partial<UsageWatchDeps> = {}): Harness {
  const notices: UsageNotice[] = [];
  const scopes: UsageScopeQuery[] = [];
  const logs: string[] = [];
  const usage = new Map<string, number>();
  const deps: UsageWatchDeps = {
    runningAgents: async () => [FIX_LOGIN],
    launchInfo: (providerId) =>
      [WORK, CODEX].find((info) => info.providerId === providerId) ?? null,
    usageEnabled: () => true,
    listUsageReportsForScope: async (scope) => {
      scopes.push(scope);
      const usedPct = usage.get(scope.provider);
      return usedPct === undefined ? [] : weeklyReport(usedPct);
    },
    listMoveTargets: async () => [CURRENT, CLAUDE],
    notify: async (notice) => {
      notices.push(notice);
    },
    logger: recordingLogger(logs),
    ...overrides,
  };
  return { watch: createUsageWatch(deps), notices, scopes, logs, usage };
}

async function checkAt(subject: Harness, usedPcts: number[]): Promise<void> {
  for (const usedPct of usedPcts) {
    subject.usage.set("claude", usedPct);
    await subject.watch.check();
  }
}

describe("createUsageWatch", () => {
  it("notifies once when an account window crosses 80% and once more at 95%", async () => {
    const subject = harness();

    await checkAt(subject, [70, 81, 85, 96, 97]);

    expect(subject.notices).toEqual([
      {
        agentId: "agent-1",
        provider: "claude-work",
        title: "Claude (work) 81% of Weekly",
        body: "Fix login · Move to Claude · 12%",
      },
      {
        agentId: "agent-1",
        provider: "claude-work",
        title: "Claude (work) 96% of Weekly",
        body: "Fix login · Move to Claude · 12%",
      },
    ]);
    expect(subject.logs).toEqual(["info usage watch: notified", "info usage watch: notified"]);
  });

  it("counts the first reading as a crossing, and re-arms a window whose usage drops", async () => {
    const subject = harness();

    await checkAt(subject, [96, 10, 82]);

    expect(subject.notices.map((notice) => notice.title)).toEqual([
      "Claude (work) 96% of Weekly",
      "Claude (work) 82% of Weekly",
    ]);
  });

  it("reads each account once, for the first running agent on its provider", async () => {
    const subject = harness({
      runningAgents: async () => [
        FIX_LOGIN,
        { id: "agent-2", provider: "claude-work", title: "Docs" },
        { id: "agent-3", provider: "codex", title: null },
      ],
    });
    subject.usage.set("codex", 40);

    await checkAt(subject, [81]);

    expect(subject.scopes).toEqual([
      { provider: "claude", env: { CLAUDE_CONFIG_DIR: "/home/me/.claude-work" } },
      { provider: "codex", env: {} },
    ]);
    expect(subject.notices.map((notice) => notice.agentId)).toEqual(["agent-1"]);
  });

  it("reads nothing while usage is off or no agent runs", async () => {
    const off = harness({ usageEnabled: () => false });
    const idle = harness({ runningAgents: async () => [] });

    await checkAt(off, [99]);
    await checkAt(idle, [99]);

    expect([off.scopes, off.notices, idle.scopes, idle.notices]).toEqual([[], [], [], []]);
  });

  it("names an untitled agent, and leaves out the move when no target has room or the targets fail", async () => {
    const full = harness({
      runningAgents: async () => [{ ...FIX_LOGIN, title: null }],
      listMoveTargets: async () => [CURRENT, { ...CLAUDE, usedPct: 100 }],
    });
    const failing = harness({
      listMoveTargets: async () => {
        throw new Error("provider snapshot gone");
      },
    });

    await checkAt(full, [81]);
    await checkAt(failing, [81]);

    expect(full.notices.map((notice) => notice.body)).toEqual(["Agent"]);
    expect(failing.notices.map((notice) => notice.body)).toEqual(["Fix login"]);
    expect(failing.logs).toEqual([
      "warn usage watch: move targets failed",
      "info usage watch: notified",
    ]);
  });

  it("logs a failed account check and goes on to the next provider", async () => {
    const subject = harness({
      runningAgents: async () => [FIX_LOGIN, { id: "agent-3", provider: "codex", title: "Port" }],
      listUsageReportsForScope: async (scope) => {
        if (scope.provider === "claude") throw new Error("vendor down");
        return weeklyReport(81);
      },
      listMoveTargets: async () => [],
    });

    await subject.watch.check();

    expect(subject.notices).toEqual([
      { agentId: "agent-3", provider: "codex", title: "Codex 81% of Weekly", body: "Port" },
    ]);
    expect(subject.logs).toEqual(["warn usage watch: check failed", "info usage watch: notified"]);
  });
});

class ManualTimer implements IntervalTimer {
  readonly intervals: number[] = [];
  stops = 0;
  private readonly ticks: Array<() => void> = [];

  every(input: { ms: number; tick: () => void }): () => void {
    this.intervals.push(input.ms);
    this.ticks.push(input.tick);
    return () => {
      this.stops += 1;
    };
  }

  fire(): void {
    for (const tick of this.ticks) tick();
  }
}

function settle(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

describe("startUsageWatch", () => {
  it("checks on each tick, skips a tick while a check still runs, and stops", async () => {
    const timer = new ManualTimer();
    const logs: string[] = [];
    let checks = 0;
    let finish: () => void = () => {};
    const watch: UsageWatch = {
      check: () => {
        checks += 1;
        return new Promise<void>((resolve) => {
          finish = resolve;
        });
      },
    };

    const stop = startUsageWatch({ watch, logger: recordingLogger(logs), timer });
    timer.fire();
    await settle();
    timer.fire();
    await settle();
    const checksWhileBusy = checks;
    finish();
    await settle();
    timer.fire();
    await settle();
    stop();

    expect(timer.intervals).toEqual([USAGE_WATCH_INTERVAL_MS]);
    expect(logs).toEqual(["info usage watch: started"]);
    expect([checksWhileBusy, checks, timer.stops]).toEqual([1, 2, 1]);
  });

  it("logs a failed check instead of letting it escape", async () => {
    const timer = new ManualTimer();
    const logs: string[] = [];
    const watch: UsageWatch = {
      check: async () => {
        throw new Error("boom");
      },
    };

    startUsageWatch({ watch, logger: recordingLogger(logs), timer, intervalMs: 1_000 });
    timer.fire();
    await settle();

    expect(timer.intervals).toEqual([1_000]);
    expect(logs).toEqual(["info usage watch: started", "warn usage watch: tick failed"]);
  });
});

describe("isWatchedAgent", () => {
  const running: WatchCandidate = { lifecycle: "running", workspaceId: "ws-1", labels: {} };

  it("watches a running agent in a workspace", () => {
    expect(isWatchedAgent(running)).toBe(true);
  });

  it("skips idle, internal, background, delegated and workspace-less agents", () => {
    const skipped: WatchCandidate[] = [
      { ...running, lifecycle: "idle" },
      { ...running, internal: true },
      { ...running, background: true },
      { ...running, labels: { [PARENT_AGENT_ID_LABEL]: "parent-1" } },
      { ...running, workspaceId: undefined },
    ];
    expect(skipped.map((agent) => isWatchedAgent(agent))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });
});
```

- [ ] **Step 2: Run it to see it fail.**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/agent/session-move/usage-watch.test.ts --bail=1
```

Expected: FAIL with `Error: Cannot find module './usage-watch.js' imported from /workspace/utils/paseo/packages/server/src/server/agent/session-move/usage-watch.test.ts`, and no test runs.

- [ ] **Step 3: Write the watch.** Create `packages/server/src/server/agent/session-move/usage-watch.ts`:

```ts
import type { Logger } from "pino";
import { isDelegatedAgent } from "@getpaseo/protocol/agent-labels";
import {
  chooseBestMoveTarget,
  usageLevel,
  windowUsedPct,
  type UsageLevel,
} from "@getpaseo/protocol/usage-heads-up";
import type { ProviderLaunchInfo } from "../provider-snapshot-manager.js";
import type { ListUsageReportsForScope } from "./list-move-targets.js";
import type { MoveTarget } from "./move-targets.js";

/** Just over the usage registry's five-minute cache, so every check reads a fresh report. */
export const USAGE_WATCH_INTERVAL_MS = 310_000;

/** A running agent whose account the watch reads. */
export interface WatchedAgent {
  id: string;
  provider: string;
  title: string | null;
}

/** One notification: an account window crossed 80% or 95%. */
export interface UsageNotice {
  agentId: string;
  provider: string;
  title: string;
  body: string;
}

export interface UsageWatchDeps {
  /** Agents that pass `isWatchedAgent`, with their stored titles. */
  runningAgents(): Promise<WatchedAgent[]>;
  launchInfo(providerId: string): ProviderLaunchInfo | null;
  usageEnabled(): boolean;
  /** Null when no plugin runtime reports usage. */
  listUsageReportsForScope: ListUsageReportsForScope | null;
  listMoveTargets(agentId: string): Promise<MoveTarget[]>;
  notify(notice: UsageNotice): Promise<void>;
  logger: Pick<Logger, "info" | "warn">;
}

export interface CrossingTracker {
  /** The level this reading newly crossed, or null. */
  observe(input: { key: string; usedPct: number }): UsageLevel | null;
}

/**
 * The level each account window has crossed since its last reset. A reading below the last
 * level means the window reset, so it re-arms. The first reading after a daemon start counts.
 */
export function createCrossingTracker(): CrossingTracker {
  const levels = new Map<string, UsageLevel>();
  return {
    observe({ key, usedPct }) {
      const level = usageLevel(usedPct);
      const previous = levels.get(key) ?? 0;
      levels.set(key, level);
      return level > previous ? level : null;
    },
  };
}

export interface UsageWatch {
  /** Reads the account of each provider with a watched agent, and notifies new crossings. */
  check(): Promise<void>;
}

function describeMove(best: MoveTarget | null): string | null {
  if (!best) return null;
  if (best.usedPct === null) return `Move to ${best.label}`;
  return `Move to ${best.label} · ${Math.round(best.usedPct)}%`;
}

/**
 * English, like every daemon notification: "Claude (work) 81% of Weekly" over
 * "Fix login · Move to Claude · 12%".
 */
function describeUsageNotice(input: {
  agent: WatchedAgent;
  account: string;
  windowLabel: string;
  usedPct: number;
  best: MoveTarget | null;
}): UsageNotice {
  const agentName = input.agent.title?.trim() || "Agent";
  const move = describeMove(input.best);
  return {
    agentId: input.agent.id,
    provider: input.agent.provider,
    title: `${input.account} ${Math.round(input.usedPct)}% of ${input.windowLabel}`,
    body: move ? `${agentName} · ${move}` : agentName,
  };
}

export function createUsageWatch(deps: UsageWatchDeps): UsageWatch {
  const crossings = createCrossingTracker();

  async function notifyCrossing(input: {
    agent: WatchedAgent;
    account: string;
    windowLabel: string;
    usedPct: number;
  }): Promise<void> {
    const targets = await deps
      .listMoveTargets(input.agent.id)
      .catch((err: unknown): MoveTarget[] => {
        deps.logger.warn({ err, agentId: input.agent.id }, "usage watch: move targets failed");
        return [];
      });
    const notice = describeUsageNotice({ ...input, best: chooseBestMoveTarget(targets) });
    await deps.notify(notice);
    deps.logger.info(
      { agentId: notice.agentId, provider: notice.provider, usedPct: input.usedPct },
      "usage watch: notified",
    );
  }

  async function checkAccount(agent: WatchedAgent): Promise<void> {
    const info = deps.launchInfo(agent.provider);
    const listReports = deps.listUsageReportsForScope;
    if (!info || !listReports) return;
    // Agents run the family CLI with the profile env, as the move targets read it.
    const reports = await listReports({ provider: info.family, env: info.env });
    for (const entry of reports) {
      if (entry.report.status !== "available") continue;
      for (const window of entry.report.windows) {
        const usedPct = windowUsedPct(window);
        if (usedPct === null) continue;
        const key = `${agent.provider}\n${entry.id}\n${window.id}`;
        if (crossings.observe({ key, usedPct }) === null) continue;
        await notifyCrossing({ agent, account: info.label, windowLabel: window.label, usedPct });
      }
    }
  }

  async function check(): Promise<void> {
    if (!deps.usageEnabled()) return;
    // One account per provider: the first running agent on it is the one the notice names.
    const firstByProvider = new Map<string, WatchedAgent>();
    for (const agent of await deps.runningAgents()) {
      if (!firstByProvider.has(agent.provider)) firstByProvider.set(agent.provider, agent);
    }
    for (const agent of firstByProvider.values()) {
      try {
        await checkAccount(agent);
      } catch (err) {
        deps.logger.warn({ err, provider: agent.provider }, "usage watch: check failed");
      }
    }
  }

  return { check };
}

/** What `isWatchedAgent` reads from a managed agent. */
export interface WatchCandidate {
  lifecycle: string;
  internal?: boolean;
  background?: boolean;
  workspaceId?: string;
  labels: Record<string, string>;
}

/**
 * The agents whose accounts are watched, mirroring the agent attention rules
 * (`AgentManager.broadcastAgentAttention` and `raisesAttention`): running, in a workspace, and
 * neither internal, background nor delegated.
 */
export function isWatchedAgent(agent: WatchCandidate): boolean {
  return (
    agent.lifecycle === "running" &&
    !agent.internal &&
    !agent.background &&
    Boolean(agent.workspaceId) &&
    !isDelegatedAgent(agent)
  );
}

export interface IntervalTimer {
  /** Calls `tick` every `ms` until the returned function is called. */
  every(input: { ms: number; tick: () => void }): () => void;
}

export const nodeIntervalTimer: IntervalTimer = {
  every({ ms, tick }) {
    const handle = setInterval(tick, ms);
    // The watch alone never keeps the daemon running.
    handle.unref();
    return () => clearInterval(handle);
  },
};

export interface StartUsageWatchInput {
  watch: UsageWatch;
  logger: Pick<Logger, "info" | "warn">;
  timer?: IntervalTimer;
  intervalMs?: number;
}

/** Runs the watch every interval and returns the function that stops it. */
export function startUsageWatch(input: StartUsageWatchInput): () => void {
  const intervalMs = input.intervalMs ?? USAGE_WATCH_INTERVAL_MS;
  const timer = input.timer ?? nodeIntervalTimer;
  let checking = false;
  function tick(): void {
    // A check still running skips this tick rather than piling up behind it.
    if (checking) return;
    checking = true;
    // Never rejects or throws: either would exit the daemon (daemon-worker.ts:373-381).
    void Promise.resolve()
      .then(() => input.watch.check())
      .catch((err: unknown) => {
        input.logger.warn({ err }, "usage watch: tick failed");
      })
      .finally(() => {
        checking = false;
      });
  }
  const stop = timer.every({ ms: intervalMs, tick });
  input.logger.info({ intervalMs }, "usage watch: started");
  return stop;
}
```

- [ ] **Step 4: Run it to see it pass.** Same command as Step 2. Expected: PASS, 10 tests.

- [ ] **Step 5: Write the failing delivery tests.** In `packages/server/src/server/websocket-server.notifications.test.ts`:

Add after the `import type { WorkspaceAutoName } from "./workspace-auto-name.js";` line:

```ts
import type { AgentAttentionNotificationPayload } from "@getpaseo/protocol/agent-attention-notification";
import { CLIENT_CAPS } from "@getpaseo/protocol/client-capabilities";
import type { UsageNotice } from "./agent/session-move/usage-watch.js";
```

In `connectClient`, replace

```ts
  options: { subscribed?: boolean } = {},
```

with

```ts
  options: { subscribed?: boolean; capabilities?: readonly string[] } = {},
```

and replace

```ts
      ...createSessionWithActivity(activity, options.subscribed ?? true),
      delivery,
```

with

```ts
      ...createSessionWithActivity(activity, options.subscribed ?? true),
      supportsForSource: (capability: string) => (options.capabilities ?? []).includes(capability),
      delivery,
```

Add after `readAttentionRequiredMessage`:

```ts
function readDedicatedAttentionPayload(ws: ReturnType<typeof createOpenSocket>) {
  const rawMessage = ws.send.mock.calls[0]?.[0];
  expect(typeof rawMessage).toBe("string");
  if (typeof rawMessage !== "string") throw new Error("Expected string WebSocket frame");
  const message = JSON.parse(rawMessage);
  expect(message.type).toBe("session");
  expect(message.message.type).toBe("agent_attention_required");
  return message.message.payload;
}

const USAGE_NOTICE: UsageNotice = {
  agentId: "agent-1",
  provider: "claude-work",
  title: "Claude (work) 81% of Weekly",
  body: "Fix login · Move to Claude · 12%",
};

const USAGE_NOTIFICATION: AgentAttentionNotificationPayload<"usage"> = {
  title: "Claude (work) 81% of Weekly",
  body: "Fix login · Move to Claude · 12%",
  data: { serverId: "srv-test", workspaceId: WORKSPACE_ID, agentId: "agent-1", reason: "usage" },
};

interface ClientActivity {
  deviceType: "web" | "mobile";
  focusedAgentId: string | null;
  lastActivityAt: Date;
  appVisible: boolean;
}

function presentElsewhere(): ClientActivity {
  return {
    deviceType: "web",
    appVisible: true,
    focusedAgentId: "agent-2",
    lastActivityAt: new Date(),
  };
}
```

A fresh `lastActivityAt` per call keeps the client inside the 180 s presence window. Then append inside `describe("VoiceAssistantWebSocketServer notification payloads", ...)`:

```ts
it("sends a usage notice only to clients that advertise usage notifications, and pushes it", async () => {
  const { server, pushNotifications } = createServer();
  const capable = connectClient(server, null, {
    capabilities: [CLIENT_CAPS.usageNotifications],
  });
  const older = connectClient(server, null);

  await server.broadcastUsageAttention(USAGE_NOTICE);

  expect(readDedicatedAttentionPayload(capable)).toEqual({
    agentId: "agent-1",
    reason: "usage",
    timestamp: expect.any(String),
    shouldNotify: false,
    notification: USAGE_NOTIFICATION,
  });
  expect(older.send).not.toHaveBeenCalled();
  expect(pushNotifications.sent).toEqual([USAGE_NOTIFICATION]);
});

it("pushes a usage notice past a present client that cannot show it", async () => {
  const { server, pushNotifications } = createServer();
  const older = connectClient(server, presentElsewhere());

  await server.broadcastUsageAttention(USAGE_NOTICE);

  expect(older.send).not.toHaveBeenCalled();
  expect(pushNotifications.sent).toEqual([USAGE_NOTIFICATION]);
});

it("shows a usage notice in a present capable client instead of pushing it", async () => {
  const { server, pushNotifications } = createServer();
  const capable = connectClient(server, presentElsewhere(), {
    capabilities: [CLIENT_CAPS.usageNotifications],
  });

  await server.broadcastUsageAttention(USAGE_NOTICE);

  expect(readDedicatedAttentionPayload(capable).shouldNotify).toBe(true);
  expect(pushNotifications.sent).toEqual([]);
});

it("sends no usage notice for an agent outside a workspace", async () => {
  const { server, pushNotifications } = createServer({
    getAgent: vi.fn(() => ({ pendingPermissions: new Map() })),
  });
  const capable = connectClient(server, null, {
    capabilities: [CLIENT_CAPS.usageNotifications],
  });

  await server.broadcastUsageAttention(USAGE_NOTICE);

  expect(capable.send).not.toHaveBeenCalled();
  expect(pushNotifications.sent).toEqual([]);
});
```

`createSessionWithActivity` and `connectClient` already take the same inline activity shape, so `ClientActivity` matches both. `vi.fn` here only fills the harness's existing `createServer` override; no new module mock is added.

- [ ] **Step 6: Run it to see it fail.**

```bash
cd /workspace/utils/paseo/packages/server && flock /tmp/paseo-heavy.lock npx vitest run src/server/websocket-server.notifications.test.ts --bail=1
```

Expected: FAIL on the first usage test: `server.broadcastUsageAttention is not a function`.

- [ ] **Step 7: Deliver usage notices through the attention pipeline.** In `packages/server/src/server/websocket-server.ts`:

Replace

```ts
import type { AgentManager, AgentMetricsSnapshot } from "./agent/agent-manager.js";
```

with

```ts
import type { AgentManager, AgentMetricsSnapshot, ManagedAgent } from "./agent/agent-manager.js";
```

Replace

```ts
import {
  buildAgentAttentionNotificationPayload,
  findLatestPermissionRequest,
} from "@getpaseo/protocol/agent-attention-notification";
```

with

```ts
import {
  buildAgentAttentionNotificationPayload,
  findLatestPermissionRequest,
  type AgentAttentionNotificationPayload,
  type AgentAttentionReason,
} from "@getpaseo/protocol/agent-attention-notification";
import type { UsageNotice } from "./agent/session-move/usage-watch.js";
```

Replace

```ts
type TerminalAttentionReason = "finished" | "needs_input";
```

with

```ts
type TerminalAttentionReason = "finished" | "needs_input";

/**
 * One attention notice for an agent. Fork delta (usage heads-up): the usage watch sends reason
 * "usage" through the same delivery as an agent's own turn.
 */
type AgentAttentionDelivery = {
  agentId: string;
  agent: ManagedAgent;
  provider: AgentProvider;
} & (
  | {
      reason: AgentAttentionReason;
      pushEligible: boolean;
      notification: AgentAttentionNotificationPayload<AgentAttentionReason>;
    }
  | {
      reason: "usage";
      pushEligible: true;
      notification: AgentAttentionNotificationPayload<"usage">;
    }
);
```

Replace the whole `broadcastAgentAttention` method (from `  private async broadcastAgentAttention(params: {` through its closing brace, just before `  private async broadcastTerminalAttention(params: {`) with:

```ts
  private async broadcastAgentAttention(params: {
    agentId: string;
    provider: AgentProvider;
    reason: "finished" | "error" | "permission";
  }): Promise<void> {
    const agent = this.agentManager.getAgent(params.agentId);
    if (!agent?.workspaceId) {
      return;
    }
    const assistantMessage = await this.agentManager.getLastAssistantMessage(params.agentId);
    const notification = buildAgentAttentionNotificationPayload({
      reason: params.reason,
      serverId: this.serverId,
      workspaceId: agent.workspaceId,
      agentId: params.agentId,
      assistantMessage,
      permissionRequest: findLatestPermissionRequest(agent.pendingPermissions),
    });
    await this.deliverAgentAttention({
      agentId: params.agentId,
      agent,
      provider: params.provider,
      reason: params.reason,
      pushEligible: isPushEligibleAttentionReason(params.reason),
      notification,
    });
  }

  /**
   * Fork delta (usage heads-up): an agent's account crossed a usage level. In the app it reaches
   * only clients that advertise usage_notifications; otherwise it is pushed.
   */
  async broadcastUsageAttention(notice: UsageNotice): Promise<void> {
    const agent = this.agentManager.getAgent(notice.agentId);
    if (!agent?.workspaceId) {
      return;
    }
    await this.deliverAgentAttention({
      agentId: notice.agentId,
      agent,
      provider: notice.provider,
      reason: "usage",
      pushEligible: true,
      notification: {
        title: notice.title,
        body: notice.body,
        data: {
          serverId: this.serverId,
          workspaceId: agent.workspaceId,
          agentId: notice.agentId,
          reason: "usage",
        },
      },
    });
  }

  private async deliverAgentAttention(delivery: AgentAttentionDelivery): Promise<void> {
    const clientEntries: Array<{
      ws: WebSocketLike;
      state: ClientPresenceState;
    }> = [];

    for (const [ws, connection] of this.sessions) {
      // COMPAT(usageNotifications): added after v0.15.2, remove the gate after 2027-05-07 once
      // client floor > v0.15.2. A client that cannot read the usage reason neither gets it nor
      // counts as present for it.
      if (
        delivery.reason === "usage" &&
        !connection.session.supportsForSource(CLIENT_CAPS.usageNotifications, ws)
      )
        continue;
      if (
        connection.session.delivery.isModern(ws)
          ? !connection.session.wantsSourceEvent(ws, "agent_attention_required")
          : !(await connection.session.subscribesToAgent(delivery.agent, ws))
      )
        continue;
      clientEntries.push({
        ws,
        state: this.getClientActivityState(connection.session, ws),
      });
    }

    const notificationEntries = clientEntries.filter(({ ws }) =>
      this.sessions.get(ws)?.session.wantsSourceNotification(ws, "agent_attention_required"),
    );
    const plan = computeNotificationPlan({
      allStates: notificationEntries.map((entry) => entry.state),
      focusTarget: { kind: "agent", id: delivery.agentId },
      pushEligible: delivery.pushEligible,
      nowMs: Date.now(),
    });

    if (plan.shouldPush) {
      void this.pushNotificationSender.send(delivery.notification).catch((err) => {
        this.logger.warn({ err, agentId: delivery.agentId }, "Failed to send push notification");
      });
    }

    for (const { ws } of clientEntries) {
      const shouldNotify =
        plan.inAppRecipientIndex !== null &&
        notificationEntries[plan.inAppRecipientIndex]?.ws === ws;
      const message = wrapSessionMessage(
        this.agentAttentionMessage({
          delivery,
          ws,
          shouldNotify,
          timestamp: new Date().toISOString(),
        }),
      );
      const session = this.sessions.get(ws)?.session;
      if (message.type === "session" && session?.delivery.isModern(ws))
        session.publishToSource(ws, message.message);
      else this.sendToClient(ws, message);
    }
  }

  private agentAttentionMessage(input: {
    delivery: AgentAttentionDelivery;
    ws: WebSocketLike;
    shouldNotify: boolean;
    timestamp: string;
  }): SessionOutboundMessage {
    const { delivery, ws, shouldNotify, timestamp } = input;
    const session = this.sessions.get(ws)?.session;
    // The usage reason exists only on the dedicated message, which every client that advertises
    // usage_notifications reads.
    if (
      delivery.reason === "usage" ||
      session?.delivery.isModern(ws) ||
      session?.supportsForSource(CLIENT_CAPS.selectiveAgentTimeline, ws)
    ) {
      return {
        type: "agent_attention_required",
        payload: {
          agentId: delivery.agentId,
          reason: delivery.reason,
          timestamp,
          shouldNotify,
          notification: delivery.notification,
        },
      };
    }
    return {
      type: "agent_stream",
      payload: {
        agentId: delivery.agentId,
        event: {
          type: "attention_required",
          provider: delivery.provider,
          reason: delivery.reason,
          timestamp,
          shouldNotify,
          notification: delivery.notification,
        },
        timestamp,
      },
    };
  }
```

The old method's behavior is unchanged for the three agent reasons: the same clients, the same presence plan, the same message per client. It now reads the last assistant message before scanning the clients instead of after, which no caller observes.

- [ ] **Step 8: Run the delivery tests to see them pass.** Same command as Step 6. Expected: PASS, 10 tests (the six existing ones, which still read the legacy `agent_stream` event, and the four new ones).

- [ ] **Step 9: Start the watch with the daemon.** In `packages/server/src/server/bootstrap.ts`:

Replace

```ts
import { createIdleRuntimeCleanup } from "./agent/idle-runtime-cleanup/index.js";
```

with

```ts
import { createIdleRuntimeCleanup } from "./agent/idle-runtime-cleanup/index.js";
import {
  listAgentMoveTargets,
  moveTargetProvidersFrom,
  sharedMoveTargetUsage,
} from "./agent/session-move/list-move-targets.js";
import {
  createUsageWatch,
  isWatchedAgent,
  startUsageWatch,
} from "./agent/session-move/usage-watch.js";
```

Replace

```ts
let wsServer: VoiceAssistantWebSocketServer | null = null;
```

with

```ts
let wsServer: VoiceAssistantWebSocketServer | null = null;
let stopUsageWatch: (() => void) | null = null;
```

Replace

```ts
wsServer.beginAcceptingConnections();
```

with

```ts
wsServer.beginAcceptingConnections();
// Fork delta (usage heads-up): one notice when an account window crosses 80% and 95%.
const usageWatchLogger = logger.child({ module: "usage-watch" });
const isUsageEnabled = () => daemonConfigStore.get().usage?.enabled !== false;
stopUsageWatch = startUsageWatch({
  watch: createUsageWatch({
    runningAgents: async () =>
      Promise.all(
        agentManager
          .listAgents()
          .filter((agent) => isWatchedAgent(agent))
          .map(async (agent) => ({
            id: agent.id,
            provider: agent.provider,
            title: (await agentStorage.get(agent.id))?.title ?? null,
          })),
      ),
    launchInfo: (providerId) => providerSnapshotManager.getProviderLaunchInfo(providerId),
    usageEnabled: isUsageEnabled,
    listUsageReportsForScope: (scope) => pluginRuntime.listUsageReportsForScope(scope),
    listMoveTargets: (agentId) =>
      listAgentMoveTargets({
        agentId,
        findAgent: async (id) => agentManager.getAgent(id) ?? (await agentStorage.get(id)),
        providers: moveTargetProvidersFrom(providerSnapshotManager),
        usageEnabled: isUsageEnabled(),
        listUsageReportsForScope: (scope) => pluginRuntime.listUsageReportsForScope(scope),
        usageLookup: sharedMoveTargetUsage,
        logger: usageWatchLogger,
        now: Date.now(),
      }),
    notify: async (notice) => {
      await wsServer?.broadcastUsageAttention(notice);
    },
    logger: usageWatchLogger,
  }),
  logger: usageWatchLogger,
});
```

Replace

```ts
unsubscribeIdleRuntimeCleanup();
await idleRuntimeCleanup.close();
```

with

```ts
unsubscribeIdleRuntimeCleanup();
await idleRuntimeCleanup.close();
stopUsageWatch?.();
stopUsageWatch = null;
```

Before editing, confirm with `grep -n "beginAcceptingConnections()\|await idleRuntimeCleanup.close()\|let wsServer" packages/server/src/server/bootstrap.ts` that each anchor appears once.

- [ ] **Step 10: Format, lint and typecheck.**

```bash
cd /workspace/utils/paseo && npm run format:files -- packages/server/src/server/agent/session-move/usage-watch.ts packages/server/src/server/agent/session-move/usage-watch.test.ts packages/server/src/server/websocket-server.ts packages/server/src/server/websocket-server.notifications.test.ts packages/server/src/server/bootstrap.ts && npm run lint -- packages/server/src/server/agent/session-move/usage-watch.ts packages/server/src/server/agent/session-move/usage-watch.test.ts packages/server/src/server/websocket-server.ts packages/server/src/server/websocket-server.notifications.test.ts packages/server/src/server/bootstrap.ts && flock /tmp/paseo-heavy.lock npm run typecheck --workspace=@getpaseo/server -- --singleThreaded
```

Expected: exit 0. If the typecheck rejects `reason: delivery.reason` in the `agent_stream` branch, the narrowing after the `||` guard did not apply; add `if (delivery.reason === "usage") throw new Error("usage attention needs the dedicated message");` at the top of that branch rather than a cast.

- [ ] **Step 11: Commit.**

```bash
git -C /workspace/utils/paseo add packages/server/src/server/agent/session-move/usage-watch.ts packages/server/src/server/agent/session-move/usage-watch.test.ts packages/server/src/server/websocket-server.ts packages/server/src/server/websocket-server.notifications.test.ts packages/server/src/server/bootstrap.ts && git -C /workspace/utils/paseo diff --cached --name-only && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "feat(server): notify when an account window crosses 80% and 95%" -- packages/server/src/server/agent/session-move/usage-watch.ts packages/server/src/server/agent/session-move/usage-watch.test.ts packages/server/src/server/websocket-server.ts packages/server/src/server/websocket-server.notifications.test.ts packages/server/src/server/bootstrap.ts && git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
```

Expected: exactly the five paths staged, the hook passes, `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`.

---

### Task 8: Manual test on the dev daemon, docs, and commit

**Files:**

- Modify: `docs/agent-lifecycle.md:290-291` (section "Moving a session": the sentence that says Paseo only reacts once a turn has failed)
- Modify: `docs/plugins.md:603` (section "Usage sources": who owns the run-out projection)
- Test (manual, not committed): a fresh `.dev/paseo-home` (gitignored). Step 4 moves the old one aside to `.dev/paseo-home.before-usage-heads-up-<timestamp>` and seeds a copy of `~/.paseo/config.json` with `pluginsEnabled: true` and no installed plugins; Step 22 keeps the test home as `.dev/paseo-home.usage-heads-up-run-<timestamp>` and puts the old one back.
- Scratch (outside the repo, not committed): `/tmp/usage-heads-up-test.env`, `/tmp/usage-heads-up-pid.js`, `/tmp/usage-heads-up-selftest.pid` (removed in Step 1), `/tmp/usage-heads-up-dev-password` (mode 0600, removed in Step 22), `/tmp/usage-heads-up-fake/` (the throwaway plugin: `paseo-plugin.json`, `index.server.ts`, `server/usage.ts`, `shared/input.ts`), `/tmp/usage-heads-up-fake.json` (its control file), `/tmp/usage-heads-up-agent/` (the agents' cwd), `/tmp/usage-heads-up-build.out`, `/tmp/usage-heads-up-dev-daemon.pid`, `/tmp/usage-heads-up-dev-daemon.out`, `/tmp/usage-heads-up-dev-app.pid`, `/tmp/usage-heads-up-dev-app.out`, `/tmp/usage-heads-up-first.json`, `/tmp/usage-heads-up-s1`, `/tmp/usage-heads-up-bystander.json`, `/tmp/usage-heads-up-mock.json`, `/tmp/usage-heads-up-moved.id`, `/tmp/usage-heads-up-moved.log`, `/tmp/usage-heads-up-warning.png`, `/tmp/usage-heads-up-danger.png`

**Interfaces:**

- Consumes:
  - Task 2: a window gets `runsOutAt` and `shortfallPct` once two samples at least `PACE_MIN_SPAN_MS` (10 minutes) apart show usage rising. `paseo usage inspect` prints them as `Runs out:` and `Shortfall:` (`packages/cli/src/commands/usage/presentation.ts:140-141`), and the Usage modal's row reads `runs out in <duration>` when both are set (`packages/app/src/usage/window-bar.tsx:47-54`).
  - Tasks 3 to 5: the heads-up in the move banner, test ids `move-banner-heads-up`, `move-banner-heads-up-move`, `move-banner-heads-up-more` and `move-banner-heads-up-dismiss`, copy `<account> <pct>% of <window> · on pace to run out <time>, resets <time>` with `Move to <label> · <pct>%`, `More...`, `Dismiss` and `Moving...` (Task 4's `sessionMove.headsUp.*`), Alert variant `warning`, or `error` for danger.
  - Task 6: the app advertises `usage_notifications`, and a usage notice with `shouldNotify` reaches `sendOsNotification`, which calls `new globalThis.Notification(title, { body, data, icon })` at call time and turns a click into `dispatchWebNotificationClick({ data })` (`packages/app/src/utils/os-notifications.ts:144-171`); the app then opens the agent through `navigateToAgent` (`packages/app/src/notification-open/react/index.tsx:16`).
  - Task 7: `USAGE_WATCH_INTERVAL_MS = 310_000`, the log lines `usage watch: started` (`module: "usage-watch"`, `intervalMs`) and `usage watch: notified` (`agentId`, `provider`, `usedPct`), and a notice titled `<provider label> <pct>% of <window label>` over `<agent title> · Move to <target> · <pct>%`.
  - Existing: the plugin SDK's `UsageScope`, `UsageAccount`, `UsageReport` and `windowFromUsedPct` (`packages/plugin/src/server/usage.ts:5-110`); `zod`, `@getpaseo/plugin/*` and Node built-ins resolve in a directory plugin's server bundle (`packages/server/src/server/plugins/bundle-evaluator.ts:13-25`); report ids are `<source id>:<account key>` (`usage-sources/index.ts:240`); `paseo plugin install <dir>` prints a trust notice and asks nothing (`packages/cli/src/commands/plugin/index.ts:123-151`); plugin status is `running`, `disabled` or `failed` (`packages/protocol/src/messages.ts:6958`); the mock provider's label `Mock Load Test` (`packages/protocol/src/provider-manifest.ts:263`), its `ten-second-stream` model, and the synthetic questions it asks for a prompt that says "Emit a synthetic question", the first being "Which surface should this apply to?" (`packages/server/src/server/agent/providers/mock-load-test-agent.ts:141, 293-372`); `inspect --json` fields `Status`, `Archived` and `PendingPermissions` (`packages/cli/src/commands/agent/inspect.ts:130-152`); `ls --json` items `{ id, provider, cwd, ... }` (`ls.ts:103-116`); `logs --json` as `{ agentId, items }` with `user_message` and `assistant_message` items (`logs.ts:95`, `packages/protocol/src/messages.ts:717-727`); `wait --json` as `{ agentId, status, message }` (`wait.ts:13-17`); `MOVE_CONTINUE_PROMPT = "Continue where the previous agent stopped."` (`packages/server/src/server/agent/session-move/handoff-context.ts:11`); a move of a running agent cancels its run first (`move-agent.ts:118-125`); the app retargets the tab on `agent.moved` (`packages/app/src/session-move/use-follow-moved-agents.ts`); test ids `move-session-cancel` and `move-session-dialog` (`move-dialog.tsx:168, 193`), `move-banner-moved-from` (`move-banner.tsx:186`), `sidebar-usage` and `sidebar-usage-icon` (`packages/app/src/usage/sidebar-item.tsx:142`, `components/left-sidebar.tsx:453`), `usage-report-<id>` (`usage/card.tsx:81`), `command-center-agent-<serverId>:<agentId>` (`command-center/command-center.tsx:560`); a client is present for 180 s after its last activity, and the web app sends a heartbeat at once on a keydown (`packages/server/src/server/agent-attention-policy.ts:3, 51-72`, `packages/app/src/hooks/use-client-activity.ts:63-82`); `PASEO_RELAY_ENABLED` overrides the config's relay switch (`packages/server/src/server/config.ts:316-323`).
- Produces: the heads-up and projection sentences in `docs/agent-lifecycle.md` and `docs/plugins.md`. No code, no new exports.

Ground rules for every step of this task:

- Never signal the daemon on 6767, never send it a request, and never write under `~/.paseo`. The test reads two things there: `config.json` (copied in Step 4; Step 2 prints only its `pluginsEnabled` value) and the local speech models directory, which `scripts/dev-daemon.sh` also hands its dev daemon. Every pid this task signals comes from a five-field record that `recorded_pid` checks first (`/tmp/usage-heads-up-dev-daemon.pid`, `/tmp/usage-heads-up-dev-app.pid`), from `$DEV_HOME/paseo.pid` once `dev_home_process` and `in_dev_session` pass, from a process left in this run's recorded session that carries `PASEO_HOME=$DEV_HOME`, or from a process whose environment carries the `PASEO_AGENT_ID` of an agent this task created. Never use `pkill`, and never run `ps` or `pgrep` with `-a` or `-f`: Claude processes carry bearer tokens in their arguments. The helpers read `/proc` instead.
- The dev daemon runs with a random password that Step 1 writes to `/tmp/usage-heads-up-dev-password` (mode 0600) for this run only, binds only the Docker bridge address (172.22.0.3), and runs with `PASEO_RELAY_ENABLED=false`, so it never reaches the public relay whatever the copied config says. `start_dev_daemon` refuses any address outside 172.22.0.0/16, so the daemon never listens on the VPN overlay. The inherited real `PASEO_PASSWORD` never reaches the dev daemon or Metro.
- Plugins. `docs/plugins.md:80-82` forbids enabling plugins on a user's behalf without explicit permission. This task enables them only in the dev home's copy of the config, drops every installed plugin from that copy, and installs one throwaway directory plugin, whose server code runs unsandboxed on this host like any plugin. Approving this plan, whose Decision 12 names that plugin, approves the install. Step 2 prints the real config's `pluginsEnabled`: when it is `true`, the copy keeps the user's own choice; when it is `false` or unset, enabling it on the copy needs the user's explicit permission, so stop after Step 2 and ask unless that permission is on record.
- Shell state does not persist between Bash calls, so every shell step starts with `. /tmp/usage-heads-up-test.env && mem_ok`. `mem_ok` prints a `LOW MEMORY` line and fails when `MemAvailable` drops under 2500 MB. Wait loops call `bash -c`, because dash's `kill` cannot signal a process group. A wait that can run longer than 60 s starts with the Bash tool's `run_in_background: true`; shorter ones run in the foreground. Every wait either chains its follow-up with `&&` or prints a line starting with `TIMEOUT`, so a failed wait never prints output that looks normal.
- Heavy commands hold `/tmp/paseo-heavy.lock`: the server build (Step 3), Metro and the web bundle, about 3 GB (Step 8, which keeps the lock until Step 22), and the pre-commit typecheck (Step 26).
- Never print a secret. No step prints a `config.json` value other than the booleans and counts that Steps 2 and 4 name, and no step reads `~/.claude/settings.json` or a token. `/tmp/usage-heads-up-first.json` holds account labels, so Step 6 writes it with umask 077 and prints only numbers from it. The one value printed on purpose is this run's throwaway dev password, in Step 9, because the browser form needs it typed in.
- Never change an agent's model, mode, thinking option or effort. The moved agent runs on its target's defaults. That move spends one short real Claude turn (Step 19); nothing else calls a paid model.
- The browser is the shared CDP Chrome: open a tab of your own (Step 9) and never navigate another one. From the recorder's install in Step 10 to the end of Step 17, move inside the app only (Command Center, the notification click), never with `browser_navigate`: a page load drops the notification recorder.
- A `TIMEOUT` or `LOW MEMORY` line, or any output that differs from Expected, ends the run. Read the logs the step names, then run **Abort and clean up** below before doing anything else. Do not leave the run paused while you investigate: from Step 8 on, Metro holds the shared heavy lock, which blocks every other agent's typecheck, test and commit.

**Abort and clean up.** Run with `run_in_background: true` (it can take about 90 s):

```bash
. /tmp/usage-heads-up-test.env && abort_cleanup
```

Then call `mcp__playwright__browser_tabs` with `{"action": "list"}` and, if a `http://172.22.0.3:8081` tab is open, `{"action": "close", "index": <its index>}`.

Expected: one line per thing it stopped, then `abort cleanup done`, with no `LIVE GROUP`, `STILL LISTENING` or `TIMEOUT` line. `abort_cleanup` (defined in Step 1) works from any step and skips what was never started:

1. If the dev daemon answers, it archives every agent this run created: the two `run` results, the moved agent, and any agent whose cwd is `/tmp/usage-heads-up-agent`.
2. It stops the dev daemon as Step 21 does: SIGTERM to the supervisor in `$DEV_HOME/paseo.pid` when that pid carries this dev home and runs in this run's recorded session, then up to 30 s for it to exit. Then it sends SIGTERM to the recorded session group while the record still matches, or else to each process left in that session that carries `PASEO_HOME=$DEV_HOME`.
3. It sends SIGTERM to any process still carrying a created agent's `PASEO_AGENT_ID`.
4. It sends SIGTERM to the recorded Metro session group, and SIGKILL if the group is still alive 30 s later; either releases `/tmp/paseo-heavy.lock`. When Metro's leader is gone, it sends SIGTERM to the processes left in that session that carry `PASEO_HOME=$DEV_HOME`.
5. It deletes the dev password file and reports 6768 or 8081 if either still listens.

Every signal goes to a pid that one of those sources names, and only after the checks above. A dev daemon that another session started on the same dev home runs in another session, so it never matches. After an abort, start again from Step 1. Step 4 moves this run's dev home aside, so its `daemon.log` stays available for the investigation. To give up instead, run the last command of Step 22, which keeps this run's dev home aside, puts the previous one back and deletes the throwaway plugin.

- [ ] **Step 1: Write the scratch helpers, the pid recorder, the throwaway plugin and the password.** Run:

```bash
rm -rf /tmp/usage-heads-up-fake /tmp/usage-heads-up-agent
rm -f /tmp/usage-heads-up-fake.json /tmp/usage-heads-up-first.json /tmp/usage-heads-up-s1 \
  /tmp/usage-heads-up-bystander.json /tmp/usage-heads-up-mock.json /tmp/usage-heads-up-moved.id \
  /tmp/usage-heads-up-moved.log /tmp/usage-heads-up-warning.png /tmp/usage-heads-up-danger.png \
  /tmp/usage-heads-up-build.out /tmp/usage-heads-up-dev-daemon.out /tmp/usage-heads-up-dev-app.out
cat > /tmp/usage-heads-up-test.env <<'EOF'
# Scratch helpers for the usage heads-up manual test. Paths are the checkout's dev home or
# /tmp/usage-heads-up-*; nothing here writes under ~/.paseo or signals the daemon on 6767.
REPO=/workspace/utils/paseo
DEV_HOME=/workspace/utils/paseo/.dev/paseo-home
AGENT_DIR=/tmp/usage-heads-up-agent
FAKE_DIR=/tmp/usage-heads-up-fake
CONTROL_FILE=/tmp/usage-heads-up-fake.json
DAEMON_RECORD=/tmp/usage-heads-up-dev-daemon.pid
APP_RECORD=/tmp/usage-heads-up-dev-app.pid
# Random password for this run only, written by Step 1 (mode 0600). The inherited real
# PASEO_PASSWORD never reaches the dev daemon.
DEV_PASSWORD=$(cat /tmp/usage-heads-up-dev-password 2>/dev/null)
# The Docker bridge address. hostname -i also prints the VPN overlay, in an order nobody
# guarantees, so take the 172.22.* address by its prefix; start_dev_daemon refuses others.
DEV_IP=$(hostname -i | tr ' ' '\n' | grep -m1 '^172\.22\.')
export REPO DEV_HOME AGENT_DIR FAKE_DIR CONTROL_FILE DAEMON_RECORD APP_RECORD DEV_PASSWORD DEV_IP

# Fails, printing LOW MEMORY, when MemAvailable is under 2500 MB.
mem_ok() {
  awk '/^MemAvailable:/ { mb = int($2 / 1024)
    if (mb < 2500) { print "LOW MEMORY: " mb " MB available"; exit 1 } }' /proc/meminfo
}
# The pid a five-field record names, printed only while all five fields still match.
recorded_pid() { node /tmp/usage-heads-up-pid.js check "$1"; }
# The pid number a record names, matching or not. Only liveness probes and term_session_leftovers
# use it, and neither signals that number itself.
record_pid_field() {
  node -e 'try {
  const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  if (!Number.isInteger(v.pid) || v.pid <= 1) process.exit(1);
  console.log(v.pid);
} catch {
  process.exit(1);
}' "$1"
}
# Field $2 of /proc/$1/stat, numbered as proc(5) numbers it: 5 is the process group, 6 the session.
stat_field() {
  local s
  s=$(cat "/proc/$1/stat" 2>/dev/null) || return 1
  s=${s##*") "}
  echo "$s" | cut -d' ' -f$(($2 - 2))
}
group_alive() { kill -0 -- "-$1" 2>/dev/null; }
# True when something listens on TCP port $1, IPv4 or IPv6.
listening() {
  awk -v p="$(printf ':%04X' "$1")" \
    'FNR > 1 && $4 == "0A" && substr($2, length($2) - 4) == p { f = 1 } END { exit !f }' \
    /proc/net/tcp /proc/net/tcp6
}
# Supervisor pid from the dev home's pid lock (never ~/.paseo).
sup_pid() {
  node -e 'console.log(JSON.parse(require("fs").readFileSync(process.argv[1], "utf8")).pid)' \
    "$DEV_HOME/paseo.pid"
}
dev_health() {
  curl -s -m 2 -o /dev/null -w '%{http_code}' "http://$DEV_IP:6768/api/health"
}
# Waits up to 10 s for a file that a forked child writes; prints TIMEOUT and fails otherwise.
wait_for_file() {
  timeout 10 bash -c 'until [ -s "$1" ]; do sleep 0.2; done' _ "$1" ||
    { echo "TIMEOUT: $1 is still empty"; return 1; }
}
# True when pid $1 runs with this test's dev home. The daemon on 6767 has another PASEO_HOME.
dev_home_process() { grep -qzx "PASEO_HOME=$DEV_HOME" "/proc/$1/environ" 2>/dev/null; }
# True when pid $1 runs in the session that start_dev_daemon recorded, while that record still
# matches. A dev daemon that another session started on the same dev home never matches.
in_dev_session() {
  local leader
  leader=$(recorded_pid "$DAEMON_RECORD") || return 1
  [ "$(stat_field "$1" 6)" = "$leader" ]
}
# SIGTERM to every process in session $1 that carries this run's PASEO_HOME, for a session whose
# recorded leader is gone. Linux does not reuse a session id while any member of it lives.
term_session_leftovers() {
  local p pids=""
  for p in /proc/[0-9]*; do
    p=${p#/proc/}
    [ "$(stat_field "$p" 6 2>/dev/null)" = "$1" ] && dev_home_process "$p" && pids="$pids $p"
  done
  [ -n "$pids" ] || return 0
  kill -TERM $pids 2>/dev/null
  echo "sent SIGTERM to what is left of session $1:$pids"
}
# Dev daemon in its own session, without scripts/dev-daemon.sh: that script always execs
# dev:server:watch, which adds two tsc --watch processes outside the heavy-command lock. The session
# leader records itself before it execs; the banner feeds Step 5's grep.
start_dev_daemon() {
  case "$DEV_IP" in
    172.22.*) ;;
    *) echo "refusing to bind '$DEV_IP': not the Docker bridge"; return 1 ;;
  esac
  [ -n "$DEV_PASSWORD" ] || { echo "no dev password in /tmp/usage-heads-up-dev-password"; return 1; }
  rm -f "$DAEMON_RECORD"
  (cd "$REPO" && setsid -f sh -c 'node /tmp/usage-heads-up-pid.js record $$ "$4" || exit 1
echo "Home:    $1"
echo "Listen:  $2:6768"
exec env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_HOST PASEO_PASSWORD="$3" \
  PASEO_HOME="$1" PASEO_LISTEN="$2:6768" PASEO_CORS_ORIGINS="*" PASEO_NODE_INSPECT=--inspect=0 \
  PASEO_RELAY_ENABLED=false PASEO_LOCAL_MODELS_DIR="$HOME/.paseo/models/local-speech" \
  PASEO_LOG_FORMAT=json PASEO_LOG_LEVEL=info npm run dev:server:raw' \
    sh "$DEV_HOME" "$DEV_IP" "$DEV_PASSWORD" "$DAEMON_RECORD" \
    >> /tmp/usage-heads-up-dev-daemon.out 2>&1 < /dev/null)
}
# Repo CLI against the dev daemon only: explicit --host, the throwaway password, the dev home.
dev_cli() {
  (cd "$REPO" && env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_HOST PASEO_HOME="$DEV_HOME" \
    PASEO_PASSWORD="$DEV_PASSWORD" npm run --silent cli -- "$@" --host "$DEV_IP:6768")
}
# "<agentId> <status>" from a `run --json` result file.
run_result() {
  node -e 'const v = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log(v.agentId, v.status);' "$1"
}
# "<Status> pending=<n> archived=<true|false>" from `inspect --json`.
agent_state() {
  dev_cli inspect "$1" --json | node -e 'let text = "";
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  const a = JSON.parse(text);
  console.log(`${a.Status} pending=${a.PendingPermissions.length} archived=${a.Archived}`);
});'
}
# The throwaway plugin's status: running, disabled or failed; empty while it is not configured.
plugin_status() {
  dev_cli plugin ls usage-heads-up-fake --json 2>/dev/null | node -e 'let text = "";
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  try {
    console.log(JSON.parse(text)[0]?.status ?? "");
  } catch {
    console.log("");
  }
});'
}
# Processes whose environment carries PASEO_AGENT_ID=$1.
agent_proc_count() { grep -lzx "PASEO_AGENT_ID=$1" /proc/[0-9]*/environ 2>/dev/null | wc -l; }
# Agents this run created, one per line: the two run results, the moved agent and, while the dev
# daemon answers, every agent whose cwd is AGENT_DIR.
test_agent_ids() {
  {
    [ -s /tmp/usage-heads-up-bystander.json ] &&
      run_result /tmp/usage-heads-up-bystander.json | cut -d' ' -f1
    [ -s /tmp/usage-heads-up-mock.json ] && run_result /tmp/usage-heads-up-mock.json | cut -d' ' -f1
    [ -s /tmp/usage-heads-up-moved.id ] && cut -d' ' -f1 /tmp/usage-heads-up-moved.id
    [ "$(dev_health)" = 200 ] && dev_cli ls -a -g --json 2>/dev/null | node -e 'let text = "";
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  try {
    for (const agent of JSON.parse(text)) if (agent.cwd === process.argv[1]) console.log(agent.id);
  } catch {}
});' "$AGENT_DIR"
  } | sort -u
}
# Points the throwaway mock account at $1 percent; claude stays at 12% and every other provider at
# 99%. The first call puts the weekly reset two days out, and later calls keep it.
set_mock() {
  node -e 'const fs = require("fs");
const [file, pct] = process.argv.slice(1);
const resetsAt = fs.existsSync(file)
  ? JSON.parse(fs.readFileSync(file, "utf8")).resetsAt
  : new Date(Date.now() + 2 * 86_400_000).toISOString();
const control = { resetsAt, usedPct: { mock: Number(pct), claude: 12, other: 99 } };
fs.writeFileSync(`${file}.tmp`, `${JSON.stringify(control)}\n`);
fs.renameSync(`${file}.tmp`, file);
console.log(`control: mock ${pct}%, claude 12%, other 99%, resets ${resetsAt}`);' "$CONTROL_FILE" "$1"
}
# Fetches the mock account now, which also records a pace sample, and prints its window.
refresh_mock() {
  dev_cli usage inspect usage-heads-up-fake:mock --refresh | grep -E 'Weekly|Runs out:|Shortfall:'
}
# "notified <provider> <usedPct> <agentId>" for each usage notice the dev daemon sent.
notified_lines() {
  node -e 'const fs = require("fs");
for (const line of fs.readFileSync(process.argv[1], "utf8").split("\n")) {
  if (!line.includes("\"usage watch: notified\"")) continue;
  const entry = JSON.parse(line);
  console.log("notified", entry.provider, entry.usedPct, entry.agentId);
}' "$DEV_HOME/daemon.log"
}
notified_count() { notified_lines | wc -l; }
# Seconds until the usage watch's next tick: setInterval fires every intervalMs after the
# "usage watch: started" line, give or take a second.
next_tick_s() {
  node -e 'const fs = require("fs");
const started = fs.readFileSync(process.argv[1], "utf8").split("\n")
  .filter((line) => line.includes("\"usage watch: started\""));
if (started.length === 0) process.exit(1);
const entry = JSON.parse(started.at(-1));
const at = typeof entry.time === "number" ? entry.time : Date.parse(entry.time);
const elapsed = Date.now() - at;
console.log(Math.ceil((entry.intervalMs - (elapsed % entry.intervalMs)) / 1000));' \
    "$DEV_HOME/daemon.log"
}
# Waits until 900 s have passed since Step 6 recorded S1 and the watch's next tick is 60 to 150 s
# away, so a usage change made now has at least the 10-minute pace span and that tick reads it.
wait_tick_window() {
  local s1 next
  s1=$(cat /tmp/usage-heads-up-s1) || return 1
  while :; do
    mem_ok || return 1
    next=$(next_tick_s) || return 1
    if [ $(($(date +%s) - s1)) -ge 900 ] && [ "$next" -ge 60 ] && [ "$next" -le 150 ]; then
      echo "next watch tick in $next s"
      return 0
    fi
    sleep 5
  done
}
# The abort path in the ground rules. Safe to run from any step and more than once.
abort_cleanup() {
  local ids id sup g pids
  ids=$(test_agent_ids)
  if [ "$(dev_health)" = 200 ]; then
    for id in $ids; do
      dev_cli agent archive "$id" --force > /dev/null 2>&1 && echo "agent $id archived"
    done
  fi
  sup=$(sup_pid 2>/dev/null)
  if [ "${sup:-0}" -gt 1 ] 2>/dev/null && kill -0 "$sup" 2>/dev/null && dev_home_process "$sup"; then
    if in_dev_session "$sup"; then
      kill -TERM "$sup"
      if timeout 30 bash -c 'while kill -0 "$1" 2>/dev/null; do sleep 1; done' _ "$sup"; then
        echo "dev supervisor $sup exited"
      else
        echo "TIMEOUT: dev supervisor $sup still running after SIGTERM"
      fi
    else
      echo "dev supervisor $sup is not in a matching recorded session; the session sweep decides"
    fi
  fi
  if g=$(recorded_pid "$DAEMON_RECORD"); then
    if group_alive "$g"; then
      kill -TERM -- "-$g" && echo "sent SIGTERM to dev session group $g"
      sleep 2
    fi
  elif g=$(record_pid_field "$DAEMON_RECORD"); then
    term_session_leftovers "$g"
  fi
  for id in $ids; do
    pids=$(grep -lzx "PASEO_AGENT_ID=$id" /proc/[0-9]*/environ 2>/dev/null | cut -d/ -f3 | xargs)
    if [ -n "$pids" ]; then kill -TERM $pids 2>/dev/null; echo "sent SIGTERM to agent $id: $pids"; fi
  done
  if g=$(recorded_pid "$APP_RECORD") &&
    tr '\0' ' ' 2>/dev/null < "/proc/$g/cmdline" | grep -q 'scripts/dev-app.sh'; then
    kill -TERM -- "-$g"
    timeout 30 bash -c '. /tmp/usage-heads-up-test.env; while group_alive "$1"; do sleep 1; done' _ "$g" ||
      { kill -KILL -- "-$g" 2>/dev/null; sleep 1; }
    if group_alive "$g"; then
      echo "LIVE GROUP $g: Metro still running and holding /tmp/paseo-heavy.lock"
    else
      echo "Metro group $g stopped; /tmp/paseo-heavy.lock released"
    fi
  elif g=$(record_pid_field "$APP_RECORD"); then
    term_session_leftovers "$g"
  fi
  rm -f /tmp/usage-heads-up-dev-password
  for g in 6768 8081; do listening "$g" && echo "STILL LISTENING on $g"; done
  echo "abort cleanup done"
}
EOF
cat > /tmp/usage-heads-up-pid.js <<'EOF'
// Usage: node /tmp/usage-heads-up-pid.js record <pid> <file>
//        node /tmp/usage-heads-up-pid.js check <file>
// A record is one JSON line: the pid, its start time, this pid namespace, the boot id and pid 1's
// start time. `check` prints the pid only while all five still match and fails otherwise, so a
// pid the kernel reused, or one from another boot or container, is never signalled.
const fs = require("node:fs");

const FIELDS = ["pid", "startTime", "pidNamespace", "bootId", "initStartTime"];

function startTime(pid) {
  const stat = fs.readFileSync(`/proc/${pid}/stat`, "utf8");
  // Field 22 of proc(5); the fields after the command name start at field 3.
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
}

function identity(pid) {
  return {
    pid,
    startTime: startTime(pid),
    pidNamespace: fs.readlinkSync("/proc/self/ns/pid"),
    bootId: fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim(),
    initStartTime: startTime(1),
  };
}

const [command, ...args] = process.argv.slice(2);
if (command === "record") {
  const pid = Number(args[0]);
  if (!Number.isInteger(pid) || pid <= 1 || !args[1]) process.exit(2);
  fs.rmSync(args[1], { force: true });
  fs.writeFileSync(args[1], `${JSON.stringify(identity(pid))}\n`, { mode: 0o600 });
} else if (command === "check") {
  try {
    const recorded = JSON.parse(fs.readFileSync(args[0], "utf8"));
    if (!Number.isInteger(recorded.pid) || recorded.pid <= 1) process.exit(1);
    const live = identity(recorded.pid);
    if (FIELDS.some((field) => recorded[field] !== live[field])) process.exit(1);
    console.log(recorded.pid);
  } catch {
    process.exit(1);
  }
} else {
  process.exit(2);
}
EOF
mkdir -p /tmp/usage-heads-up-fake/server /tmp/usage-heads-up-fake/shared
cat > /tmp/usage-heads-up-fake/paseo-plugin.json <<'EOF'
{ "id": "usage-heads-up-fake", "requirements": { "paseo": ">=0.9.2" } }
EOF
cat > /tmp/usage-heads-up-fake/shared/input.ts <<'EOF'
import { z } from "zod";

/** Which throwaway account a fetch reads. */
export const inputSchema = z.object({ account: z.enum(["mock", "claude", "other"]) }).strict();
EOF
cat > /tmp/usage-heads-up-fake/server/usage.ts <<'EOF'
import { readFileSync } from "node:fs";
import {
  windowFromUsedPct,
  type UsageAccount,
  type UsageReport,
  type UsageScope,
} from "@getpaseo/plugin/server/usage";
import { inputSchema } from "../shared/input.js";

/** Written by the manual test's set_mock helper and read again on every fetch. */
const CONTROL_FILE = "/tmp/usage-heads-up-fake.json";

interface Control {
  resetsAt: string;
  usedPct: { mock: number; claude: number; other: number };
}

const MOCK: UsageAccount = { key: "mock", label: "mock, rising", input: { account: "mock" } };
const CLAUDE: UsageAccount = { key: "claude", label: "claude, fixed", input: { account: "claude" } };
const OTHER: UsageAccount = {
  key: "other",
  label: "every other provider, full",
  input: { account: "other" },
};

/** The mock account for mock agents, a roomy one for Claude, and a full one for the rest. */
export async function discover(scope: UsageScope): Promise<UsageAccount[]> {
  if (scope.kind === "global") return [MOCK, CLAUDE, OTHER];
  if (scope.provider === "mock") return [MOCK];
  if (scope.provider === "claude") return [CLAUDE];
  return [OTHER];
}

export async function fetchUsage(input: unknown): Promise<UsageReport> {
  const { account } = inputSchema.parse(input);
  const control: Control = JSON.parse(readFileSync(CONTROL_FILE, "utf8"));
  return {
    status: "available",
    planLabel: "Heads-up test",
    windows: [
      windowFromUsedPct({
        id: "weekly",
        label: "Weekly",
        utilizationPct: control.usedPct[account],
        resetsAt: control.resetsAt,
      }),
    ],
  };
}
EOF
cat > /tmp/usage-heads-up-fake/index.server.ts <<'EOF'
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { inputSchema } from "./shared/input.js";
import { discover, fetchUsage } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    id: "usage-heads-up-fake",
    label: "Heads-up fake",
    input: inputSchema,
    discover: (scope) => discover(scope),
    fetch: fetchUsage,
  });
  return () => {};
}
EOF
(umask 077 && node -e 'process.stdout.write(require("node:crypto").randomBytes(24).toString("base64url"))' > /tmp/usage-heads-up-dev-password)
bash -n /tmp/usage-heads-up-test.env && echo "helpers parse"
node --check /tmp/usage-heads-up-pid.js && echo "pid recorder parses"
. /tmp/usage-heads-up-test.env && echo "dev ip $DEV_IP" && echo "password length ${#DEV_PASSWORD}"
stat -c 'password mode %a' /tmp/usage-heads-up-dev-password
sleep 30 &
SELF=$!
node /tmp/usage-heads-up-pid.js record "$SELF" /tmp/usage-heads-up-selftest.pid &&
  stat -c 'record mode %a' /tmp/usage-heads-up-selftest.pid
[ "$(recorded_pid /tmp/usage-heads-up-selftest.pid)" = "$SELF" ] && echo "record matches the live pid"
kill "$SELF"
wait "$SELF" 2>/dev/null
recorded_pid /tmp/usage-heads-up-selftest.pid > /dev/null || echo "record refused once the pid exited"
rm -f /tmp/usage-heads-up-selftest.pid
find /tmp/usage-heads-up-fake -type f | sort
```

Expected:

```
helpers parse
pid recorder parses
dev ip 172.22.0.3
password length 32
password mode 600
record mode 600
record matches the live pid
record refused once the pid exited
/tmp/usage-heads-up-fake/index.server.ts
/tmp/usage-heads-up-fake/paseo-plugin.json
/tmp/usage-heads-up-fake/server/usage.ts
/tmp/usage-heads-up-fake/shared/input.ts
```

Step 1 leaves the two pid records alone: a record from an earlier run is the only safe handle on anything it left running, and Step 2 checks that its ports are free first. The plugin mirrors `plugins/claude-usage-source/` (an `index.server.ts` that registers the source, `server/usage.ts`, `shared/input.ts`, `.js` relative imports, the same `paseo` requirement). Its usage comes from `/tmp/usage-heads-up-fake.json` on every fetch, so `set_mock` changes it without a plugin reload. The plugin process validates each account's input against `inputSchema` (`docs/plugins.md:603`), and `fetchUsage` parses it again instead of casting it. A dev ip other than `172.22.0.3` means the bridge changed: use the printed address everywhere this task says `172.22.0.3`.

- [ ] **Step 2: Pre-flight: memory, ports and the plugin switch.** Run:

```bash
. /tmp/usage-heads-up-test.env && mem_ok && echo "memory ok"
awk '/^MemAvailable:/ { print "MemAvailable " int($2 / 1024) " MB" }' /proc/meminfo
listening 6767 && echo "6767 listening: the main daemon, which this task never touches"
for p in 6768 8081; do if listening "$p"; then echo "PORT $p BUSY"; else echo "port $p free"; fi; done
node -e 'const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
console.log(`real config pluginsEnabled: ${c.pluginsEnabled ?? "unset"}`);' "$HOME/.paseo/config.json"
```

Expected: `memory ok`; `MemAvailable <n> MB` with `<n>` at least 5000, because the build, Metro and the dev daemon need about 4 GB between them (under 5000, wait for other agents' heavy work to finish and run this step again; do not start); `6767 listening: ...`; `port 6768 free` and `port 8081 free`; `real config pluginsEnabled: <true, false or unset>`. A busy port means another dev daemon or Metro runs: stop and ask, and neither reuse nor stop it. If `pluginsEnabled` is not `true` and the user has not given explicit permission to enable plugins on the dev copy, stop here and ask, saying that plugins are trusted, unsandboxed code and that only the dev daemon's copied config changes.

- [ ] **Step 3: Build the server stack under the lock.** Run with `run_in_background: true`:

```bash
. /tmp/usage-heads-up-test.env && mem_ok && cd "$REPO" && flock /tmp/paseo-heavy.lock npm run build:server > /tmp/usage-heads-up-build.out 2>&1; echo "build exit=$?"
```

Expected: `build exit=0`, within about 5 minutes plus any time queued for the lock. The CLI and the dev daemon load `@getpaseo/protocol` and `@getpaseo/client` from `dist`, so they need the builds of Tasks 1, 6 and 7. On any other exit, read `tail -n 40 /tmp/usage-heads-up-build.out` and stop: a task before this one is incomplete. Nothing runs yet, so there is nothing to clean up.

- [ ] **Step 4: Give the dev daemon a fresh home with plugins on.** Run:

```bash
. /tmp/usage-heads-up-test.env
sup=$(sup_pid 2>/dev/null)
if ! mem_ok; then
  echo "stopped before touching the dev home"
elif [ "${sup:-0}" -gt 1 ] 2>/dev/null && kill -0 "$sup" 2>/dev/null && dev_home_process "$sup"; then
  echo "STOP: dev daemon $sup runs on $DEV_HOME; this task did not start it"
else
  if [ -e "$DEV_HOME/.usage-heads-up-test" ]; then
    # An earlier run of this test, aborted before Step 22 put things back.
    mv "$DEV_HOME" "$DEV_HOME.usage-heads-up-run-$(date +%Y%m%d%H%M%S)" &&
      echo "earlier test dev home moved aside"
  elif [ -e "$DEV_HOME" ]; then
    mv "$DEV_HOME" "$DEV_HOME.before-usage-heads-up-$(date +%Y%m%d%H%M%S)" &&
      echo "previous dev home moved aside"
  fi
  mkdir -p "$DEV_HOME" && chmod 700 "$DEV_HOME" && touch "$DEV_HOME/.usage-heads-up-test" &&
    install -m 600 "$HOME/.paseo/config.json" "$DEV_HOME/config.json" &&
    node -e 'const fs = require("fs");
const file = process.argv[1];
const config = JSON.parse(fs.readFileSync(file, "utf8"));
const installed = Object.keys(config.plugins ?? {}).length;
const hadHash = Boolean(config.daemon?.auth?.password);
if (config.daemon?.auth) delete config.daemon.auth.password;
config.pluginsEnabled = true;
config.plugins = {};
fs.writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
console.log(`plugins enabled in the copy: ${config.pluginsEnabled}`);
console.log(`installed plugins dropped from the copy: ${installed}`);
console.log(`password hash dropped from the copy: ${hadHash}`);
console.log(`check usage on: ${config.daemon?.usage?.enabled !== false}`);' "$DEV_HOME/config.json" &&
    stat -c '%n %a' "$DEV_HOME" "$DEV_HOME/config.json"
fi
```

Expected: `previous dev home moved aside` when there was one (`earlier test dev home moved aside` when an aborted run left its own), then `plugins enabled in the copy: true`, `installed plugins dropped from the copy: <n>`, `password hash dropped from the copy: <true or false>`, `check usage on: true`, `/workspace/utils/paseo/.dev/paseo-home 700` and `/workspace/utils/paseo/.dev/paseo-home/config.json 600`. The copy keeps the user's providers, so the move targets list the same providers as the real daemon. It drops installed plugins, so only the built-ins and the throwaway plugin run, and it drops a persisted password hash, though the env password wins over it anyway (`packages/server/src/server/config.ts:494-505`). `check usage on: false` means the user turned usage checks off: stop and ask, because the watch and the move targets then read nothing. On a `STOP` line, leave that daemon alone and ask.

- [ ] **Step 5: Start the dev daemon and wait for its usage watch.** Run:

```bash
. /tmp/usage-heads-up-test.env && mem_ok && start_dev_daemon && wait_for_file "$DAEMON_RECORD" && echo "dev session leader=$(recorded_pid "$DAEMON_RECORD")"
```

Expected: `dev session leader=<L>`. The daemon runs detached in its own session through `npm run dev:server:raw` (`packages/server/scripts/dev-runner.ts` with `PASEO_NODE_ENV=development`, which turns on the mock providers, then the supervisor, then the worker from source; none of them detaches, so all share the session and its process group), with `PASEO_HOME=$DEV_HOME`, `PASEO_LISTEN=172.22.0.3:6768`, the run's password, `PASEO_RELAY_ENABLED=false`, and `PASEO_AGENT_ID`, `PASEO_AGENT_CWD` and `PASEO_HOST` unset. No `tsc --watch` runs beside it.

Then run with `run_in_background: true`:

```bash
timeout 300 bash -c '. /tmp/usage-heads-up-test.env; until [ "$(dev_health)" = 200 ] && grep -q "\"usage watch: started\"" "$DEV_HOME/daemon.log" 2>/dev/null; do mem_ok || exit 1; sleep 2; done' && echo "dev daemon healthy; usage watch started" || echo "TIMEOUT waiting for the dev daemon and its usage watch"
```

Expected within about 2 minutes: `dev daemon healthy; usage watch started`. Then run:

```bash
. /tmp/usage-heads-up-test.env && mem_ok
grep -E "^(Home|Listen):" /tmp/usage-heads-up-dev-daemon.out | head -n 2
s=$(sup_pid) && echo "supervisor $s: dev home $(dev_home_process "$s" && echo yes || echo no), recorded session $(in_dev_session "$s" && echo yes || echo no)"
grep '"usage watch: started"' "$DEV_HOME/daemon.log" | tail -n 1 | node -e 'let text = "";
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  const entry = JSON.parse(text);
  console.log(`usage watch started, module ${entry.module}, intervalMs ${entry.intervalMs}`);
});'
echo "next watch tick in $(next_tick_s) s"
```

Expected: `Home:    /workspace/utils/paseo/.dev/paseo-home`, `Listen:  172.22.0.3:6768`, `supervisor <S>: dev home yes, recorded session yes`, `usage watch started, module usage-watch, intervalMs 310000`, and `next watch tick in <n> s` with `<n>` at most 310. On `TIMEOUT` or a `no`, read

```bash
tail -n 60 /tmp/usage-heads-up-dev-daemon.out
grep -v '^{' /workspace/utils/paseo/.dev/paseo-home/daemon.log | tail -n 40
```

and run **Abort and clean up**. The supervisor copies the worker's output into `daemon.log` and into its own stdout, which is the `.out` file (`packages/server/scripts/supervisor.ts:356-363`).

- [ ] **Step 6: Install the throwaway usage source and take the first sample.** Run:

```bash
. /tmp/usage-heads-up-test.env && mem_ok && set_mock 76 && dev_cli plugin install "$FAKE_DIR"
```

Expected: `control: mock 76%, claude 12%, other 99%, resets <ISO time two days out>`, the trust notice on stderr (`Trusting plugin code: ...`), and one row for `usage-heads-up-fake` whose source is `/tmp/usage-heads-up-fake`. The command asks nothing. Then run:

```bash
timeout 120 bash -c '. /tmp/usage-heads-up-test.env; until [ "$(plugin_status)" = running ]; do [ "$(plugin_status)" = failed ] && exit 1; sleep 2; done' && echo "plugin usage-heads-up-fake running" || (. /tmp/usage-heads-up-test.env; echo "TIMEOUT or failure: plugin status $(plugin_status)"; dev_cli plugin logs usage-heads-up-fake | tail -n 20)
```

Expected: `plugin usage-heads-up-fake running`. On failure the plugin log shows the compile or load error: run **Abort and clean up**, fix the scratch plugin, and start again from Step 1. Then run:

```bash
. /tmp/usage-heads-up-test.env && mem_ok && (umask 077 && dev_cli usage --json > /tmp/usage-heads-up-first.json) && date +%s > /tmp/usage-heads-up-s1 && node -e 'const entries = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
function usedPcts(entry) {
  if (entry.report.status !== "available") return [];
  return entry.report.windows
    .map((w) => w.usedPct ?? (w.remainingPct == null ? null : 100 - w.remainingPct))
    .filter((pct) => typeof pct === "number");
}
for (const entry of entries.filter((e) => e.sourceId === "usage-heads-up-fake"))
  console.log(entry.id, usedPcts(entry).join(","));
const claude = entries.filter((e) => e.sourceId === "claude").flatMap(usedPcts);
console.log("real Claude tightest usedPct:", claude.length ? Math.max(...claude) : "none");' /tmp/usage-heads-up-first.json
```

Expected, the first three lines in any order:

```
usage-heads-up-fake:mock 76
usage-heads-up-fake:claude 12
usage-heads-up-fake:other 99
real Claude tightest usedPct: <a number under 80, or none>
```

The listing fetched every account, so the registry now holds the mock window's first pace sample, and `/tmp/usage-heads-up-s1` holds the time right after it (S1). Steps 11 and 16 start no earlier than 900 s after S1. That covers the projection's 10-minute span, and it puts the run-out projected at 81% at least 57 minutes out (3.8 times the span), so the Step 12 heads-up stays a warning: a run-out within 30 minutes would make it a danger one (Task 1). A real Claude figure of 80 or more stops the run (**Abort and clean up**): the best target must sit below the mock account's 81%, so the heads-up would offer no Move. Run the test again once that window has reset.

- [ ] **Step 7: Start a bystander and the test agent on the mock provider.** Run:

```bash
. /tmp/usage-heads-up-test.env && mem_ok && rm -rf "$AGENT_DIR" && mkdir -p "$AGENT_DIR" && dev_cli run --provider mock/ten-second-stream --title "Usage heads-up bystander" --cwd "$AGENT_DIR" --wait-timeout 2m --json "Stream for ten seconds." > /tmp/usage-heads-up-bystander.json && run_result /tmp/usage-heads-up-bystander.json && dev_cli run --no-wait --provider mock --title "Usage heads-up test" --cwd "$AGENT_DIR" --json "Emit a synthetic question. This is a Paseo usage heads-up test: if you are a language model reading this after a move, reply with the single word ok and do nothing else." > /tmp/usage-heads-up-mock.json && run_result /tmp/usage-heads-up-mock.json
```

Expected: `<bystander id> completed`, then `<test agent id> running` or `<test agent id> created`. Then run:

```bash
timeout 60 bash -c '. /tmp/usage-heads-up-test.env; id=$(run_result /tmp/usage-heads-up-mock.json | cut -d" " -f1); until [ "$(agent_state "$id")" = "running pending=1 archived=false" ]; do sleep 2; done; echo "test agent $id: $(agent_state "$id")"' || echo "TIMEOUT: the test agent never reached running with one pending question"
```

Expected: `test agent <id>: running pending=1 archived=false`. The mock agent asks its synthetic questions and waits, so it stays in its turn: a running foreground agent in a workspace, which the usage watch watches (`isWatchedAgent`). The bystander is idle, so the watch ignores it; it gives the app an agent to sit on while the notification arrives, because a client that is visible and focused on the test agent suppresses the notice (`computeNotificationPlan`). Both agents share one workspace, because `run --cwd` resolves the workspace for that directory. The prompt's second sentence is for Step 19: the moved agent reads this transcript and should answer `ok`.

- [ ] **Step 8: Start Metro under the heavy-command lock.** Run:

```bash
. /tmp/usage-heads-up-test.env && mem_ok && rm -f "$APP_RECORD" && (cd "$REPO" && setsid -f sh -c 'node /tmp/usage-heads-up-pid.js record $$ "$3" || exit 1
exec flock /tmp/paseo-heavy.lock env -u PASEO_AGENT_ID -u PASEO_AGENT_CWD -u PASEO_PASSWORD PASEO_HOME="$1" PASEO_LISTEN="$2:6768" scripts/dev-app.sh' sh "$DEV_HOME" "$DEV_IP" "$APP_RECORD" > /tmp/usage-heads-up-dev-app.out 2>&1 < /dev/null) && wait_for_file "$APP_RECORD" && echo "metro session leader=$(recorded_pid "$APP_RECORD")"
```

Then run with `run_in_background: true`:

```bash
timeout 900 bash -c '. /tmp/usage-heads-up-test.env; until grep -q "Waiting on http://localhost:8081" /tmp/usage-heads-up-dev-app.out; do mem_ok || exit 1; sleep 2; done' && grep -m3 -E "Metro:|Daemon:|Waiting on" /tmp/usage-heads-up-dev-app.out || echo "TIMEOUT waiting for Metro"
```

Expected: `metro session leader=<M>`, then `Metro:   http://localhost:8081`, `Daemon:  172.22.0.3:6768` and `Waiting on http://localhost:8081`. The wait includes any time queued for the lock. Metro holds the lock until Step 22, so other agents' heavy commands wait; keep the browser steps short. The lock covers Metro's whole life, not only the bundle build, because Metro keeps its memory after the bundle is built. From here on, every failure goes through **Abort and clean up**, which stops Metro and so releases the lock.

- [ ] **Step 9: Open the app in a new tab and add the dev host with the throwaway password.** Call `mcp__playwright__browser_tabs` with `{"action": "new", "url": "http://172.22.0.3:8081/"}`. Then run with `run_in_background: true`:

```bash
timeout 900 bash -c '. /tmp/usage-heads-up-test.env; until grep -qE "Web Bundled|Bundling failed" /tmp/usage-heads-up-dev-app.out; do mem_ok || exit 1; sleep 3; done' && grep -m1 -E "Web Bundled|Bundling failed" /tmp/usage-heads-up-dev-app.out || echo "TIMEOUT waiting for the web bundle"
```

Expected: `Web Bundled <ms>ms ... (<n> modules)`, about 3 minutes on the first build. `Bundling failed` ends the run.

The app has no password prompt for the `EXPO_PUBLIC_LOCAL_DAEMON` override (`packages/app/src/runtime/host-runtime.ts:1860-1884`), and a host that an earlier dev run stored for the same address would only ask to be removed and added again, so clear the dev origin's host list and add the host by hand:

1. Call `mcp__playwright__browser_evaluate` with `{"function": "() => { localStorage.removeItem(\"@paseo:daemon-registry\"); return \"host registry cleared\"; }"}`. This touches only the `http://172.22.0.3:8081` origin.
2. Call `mcp__playwright__browser_navigate` with `{"url": "http://172.22.0.3:8081/"}` to reload.
3. Take `mcp__playwright__browser_snapshot`: it shows "Welcome to Paseo" with a `Direct connection` option. Click it.
4. Print the run's password with `cat /tmp/usage-heads-up-dev-password; echo`. Fill `Host` with `172.22.0.3`, `Port` with `6768` and `Password` with that value (`mcp__playwright__browser_fill_form`, or one `mcp__playwright__browser_type` per field), then click `Connect`. If a "Connect to this host?" dialog follows, click its `Connect`.

Expected: a fresh snapshot shows the app connected to the dev host, the agents' workspace in the sidebar, and no error overlay. The password now sits in the transcript. Step 1 made it for this run, it guards only this dev daemon on the Docker bridge, and Step 22 deletes the file once the daemon has stopped.

- [ ] **Step 10: See no heads-up on the flat account, install the notification recorder, and sit on the bystander.** Print the route parts:

```bash
. /tmp/usage-heads-up-test.env && mem_ok && echo "server-id=$(cat "$DEV_HOME/server-id")" && echo "test agent=$(run_result /tmp/usage-heads-up-mock.json | cut -d' ' -f1)" && echo "bystander=$(run_result /tmp/usage-heads-up-bystander.json | cut -d' ' -f1)"
```

Then:

1. Call `mcp__playwright__browser_navigate` with `{"url": "http://172.22.0.3:8081/h/<server-id>/agent/<test agent>"}`, then `mcp__playwright__browser_wait_for` with `{"text": "Which surface should this apply to?"}` (the mock's first synthetic question, so the test agent's screen is up), then `mcp__playwright__browser_wait_for` with `{"time": 10}`, so the banner's first move-target read lands.
2. Call `mcp__playwright__browser_evaluate` with `{"function": "() => [...document.querySelectorAll('[data-testid=\"move-banner-heads-up\"]')].filter((el) => el.getClientRects().length > 0).length"}`. Expected: `0`. The mock account sits at 76% with a flat history, so it is under 80% and has no run-out. Later steps call this the visible-banner count.
3. Install the recorder. Call `mcp__playwright__browser_evaluate` with:

```json
{
  "function": "() => { const notices = []; class RecordingNotification { static permission = \"granted\"; static async requestPermission() { return \"granted\"; } constructor(title, options = {}) { this.entry = { title, body: options.body ?? null, data: options.data ?? null, clicks: [] }; notices.push(this.entry); } addEventListener(type, listener) { if (type === \"click\") this.entry.clicks.push(listener); } close() {} } window.__usageNotices = notices; window.Notification = RecordingNotification; return `recorder installed, permission ${window.Notification.permission}`; }"
}
```

Expected: `recorder installed, permission granted`. `sendOsNotification` reads `globalThis.Notification` each time it runs and attaches its click handler with `addEventListener("click")`, so every notice the app shows from now on lands in `window.__usageNotices` with that handler. Chrome's own permission prompt never appears, and nothing reaches the desktop. 4. Press `Control+k` with `mcp__playwright__browser_press_key`, take `mcp__playwright__browser_snapshot`, type `Usage heads-up bystander` into the Command Center input with `mcp__playwright__browser_type`, and click `[data-testid="command-center-agent-<server-id>:<bystander>"]` with `mcp__playwright__browser_click`.

Expected: a snapshot shows the bystander's tab selected and no synthetic question on screen. Until Step 18, move only inside the app.

- [ ] **Step 11: Cross 80% and catch the notification.** Run with `run_in_background: true`:

```bash
timeout 1500 bash -c '. /tmp/usage-heads-up-test.env; wait_tick_window' || echo "TIMEOUT or LOW MEMORY waiting for the watch tick window"
```

Expected within 25 minutes: `next watch tick in <n> s` with `<n>` from 60 to 150. Then, at once, run

```bash
. /tmp/usage-heads-up-test.env && mem_ok && set_mock 81 && refresh_mock && echo "next watch tick in $(next_tick_s) s"
```

and press `Shift` with `mcp__playwright__browser_press_key`. Expected:

```
control: mock 81%, claude 12%, other 99%, resets <the same time as in Step 6>
  Weekly: 81% used, 19% remaining [weekly]
    Runs out: <an ISO time before the reset, at least 57 minutes from now>
    Shortfall: <a positive percent>
next watch tick in <n> s
```

`Runs out:` and `Shortfall:` come from the projection (Task 2): the source never sets them, and the samples at 76% and 81% lie at least 15 minutes apart, more than the 10 the projection needs. At the rate between them, the last 19 points take about 3.8 times the time since S1. The Shift press is user activity: the app sends a heartbeat at once, so the browser counts as present when the tick runs, at most 150 s later. Then run with `run_in_background: true`:

```bash
timeout 240 bash -c '. /tmp/usage-heads-up-test.env; until [ "$(notified_count)" -ge 1 ]; do mem_ok || exit 1; sleep 3; done; notified_lines' || echo "TIMEOUT waiting for the 81% notice"
```

Expected: `notified mock 81 <test agent id>`. Then call `mcp__playwright__browser_evaluate` with:

```json
{
  "function": "() => window.__usageNotices.filter((n) => n.data?.reason === \"usage\").map((n) => ({ title: n.title, body: n.body, serverId: n.data.serverId, workspaceId: n.data.workspaceId, agentId: n.data.agentId, clickHandlers: n.clicks.length }))"
}
```

Expected: exactly one entry: `title` `Mock Load Test 81% of Weekly`; `body` `Usage heads-up test · Move to <a Claude-family provider> · <n>%`, with `<n>` under 80 (12, or the real Claude account's figure when that is higher); `serverId` the server id from Step 10; a non-empty `workspaceId`; `agentId` the test agent; `clickHandlers` 1. The daemon delivered it in the app rather than as a push, because this capable client was present and not focused on the test agent. When `notified` printed but no usage entry arrived, the app dropped it: read `mcp__playwright__browser_console_messages` at level `error`, then abort.

- [ ] **Step 12: Open the agent from the notification and read the heads-up.** Call `mcp__playwright__browser_evaluate` with:

```json
{
  "function": "() => { const notice = window.__usageNotices.filter((n) => n.data?.reason === \"usage\").at(-1); notice.clicks.forEach((listener) => listener(new Event(\"click\"))); return `clicked ${notice.title}`; }"
}
```

Expected: `clicked Mock Load Test 81% of Weekly`. Then call `mcp__playwright__browser_wait_for` with `{"text": "Which surface should this apply to?"}` and with `{"time": 5}`, and call `mcp__playwright__browser_evaluate` with:

```json
{
  "function": "() => { const shown = (el) => el.getClientRects().length > 0; const banner = [...document.querySelectorAll('[data-testid=\"move-banner-heads-up\"]')].find(shown); if (!banner) return null; const label = (id) => [...banner.querySelectorAll(`[data-testid=\"${id}\"]`)].find(shown)?.innerText.trim() ?? null; const style = getComputedStyle(banner); return { text: banner.innerText, move: label(\"move-banner-heads-up-move\"), more: label(\"move-banner-heads-up-more\"), dismiss: label(\"move-banner-heads-up-dismiss\"), border: style.borderColor, background: style.backgroundColor }; }"
}
```

Expected: `text` contains `Mock Load Test 81% of Weekly · on pace to run out <time of day>, resets <weekday> <time of day>`; `move` is `Move to <the target from Step 11> · <n>%`; `more` is `More...`; `dismiss` is `Dismiss`. Write down `border` and `background` for Step 17. Save the evidence with `mcp__playwright__browser_take_screenshot` and `{"scale": "css", "type": "png", "filename": "/tmp/usage-heads-up-warning.png"}`. The click took a real notification's path: the app's handler dispatched the open event, and `navigateToAgent` focused the test agent's tab. Only the visible banner counts, because the bystander shares the mock account and its hidden tab can hold a heads-up as well.

- [ ] **Step 13: More... opens the move dialog.** Take `mcp__playwright__browser_snapshot` and click the visible `More...` button. Expected: the move dialog (`move-session-dialog`) lists `Mock Load Test` with the `Current` badge, the Step 12 target with a badge that starts `<n>%`, and every other provider that can launch here with one that starts `99%`; a provider that cannot shows `Unavailable` (`packages/app/src/session-move/move-targets.ts:110-117`). Click `Cancel` (`move-session-cancel`). Expected: the dialog closes, and the visible-banner count still returns `1`. The dialog's badges keep their own 70% and 90% tones (`packages/app/src/usage/tone.ts:13-17`); this plan leaves them alone.

- [ ] **Step 14: The Usage modal shows the projected run-out.** Click `[data-testid="sidebar-usage"]` with `mcp__playwright__browser_click`, or `[data-testid="sidebar-usage-icon"]` when the sidebar is collapsed. Then call `mcp__playwright__browser_evaluate` with `{"function": "() => document.querySelector('[data-testid=\"usage-report-usage-heads-up-fake:mock\"]')?.innerText ?? null"}`.

Expected: text that holds `Weekly`, its percent (`81%`, or `19%` when the app shows what remains) and `runs out in <duration>`. The row shows that countdown only when the window carries both `runsOutAt` and `shortfallPct` (`packages/app/src/usage/window-bar.tsx:47-54`), which the projection fills (Decision 3). Press `Escape` with `mcp__playwright__browser_press_key`: the modal closes and the test agent is back on screen.

- [ ] **Step 15: Dismiss hides the heads-up for every agent on the account.** Click the visible `Dismiss` button and run the visible-banner count. Expected: `0`. Open the bystander through the Command Center as in Step 10 item 4 and count again: `0`, because the dismissal belongs to the account window, which the bystander shares. Open the test agent the same way (type `Usage heads-up test`, click `command-center-agent-<server-id>:<test agent>`): `0`. Open the bystander once more and stay there, so Step 16's notice has an agent to be away from.

- [ ] **Step 16: Cross 95% and catch the second notification.** Run with `run_in_background: true`:

```bash
timeout 1500 bash -c '. /tmp/usage-heads-up-test.env; wait_tick_window' || echo "TIMEOUT or LOW MEMORY waiting for the watch tick window"
```

Expected: `next watch tick in <n> s` with `<n>` from 60 to 150. Then, at once, run

```bash
. /tmp/usage-heads-up-test.env && mem_ok && set_mock 96 && refresh_mock && echo "next watch tick in $(next_tick_s) s"
```

and press `Shift` with `mcp__playwright__browser_press_key`. Expected: `control: mock 96%, ...`, `Weekly: 96% used, 4% remaining [weekly]`, a `Runs out:` time a few minutes away (the last four points at the rate since S1), a `Shortfall:` line, and the next tick. Then run with `run_in_background: true`:

```bash
timeout 240 bash -c '. /tmp/usage-heads-up-test.env; until [ "$(notified_count)" -ge 2 ]; do mem_ok || exit 1; sleep 3; done; notified_lines' || echo "TIMEOUT waiting for the 95% notice"
```

Expected: `notified mock 81 <test agent id>` and `notified mock 96 <test agent id>`. Run Step 11's recorder evaluate again. Expected: two entries, the second with `title` `Mock Load Test 96% of Weekly`, the same `body` pattern, and `clickHandlers` 1.

- [ ] **Step 17: The danger heads-up returns past the dismissal.** Run Step 12's click evaluate, which clicks the last usage notice. Expected: `clicked Mock Load Test 96% of Weekly`. Wait for `Which surface should this apply to?` and 5 s as in Step 12, then run Step 12's banner evaluate. Expected: `text` contains `Mock Load Test 96% of Weekly · ` followed by `on pace to run out <time of day>, resets <weekday> <time of day>`, or by `resets <weekday> <time of day>` alone once the projected run-out has passed; `move`, `more` and `dismiss` as in Step 12; and `border` or `background` differs from Step 12's values (Alert variant `error` instead of `warning`). Step 15 dismissed the 80% level and 95% is the next one, so the heads-up shows again (Decision 7). Save `/tmp/usage-heads-up-danger.png` as in Step 12.

- [ ] **Step 18: Dismissals live in the app's memory.** Click the visible `Dismiss` and run the visible-banner count: `0`. Reload with `mcp__playwright__browser_navigate` and `{"url": "http://172.22.0.3:8081/h/<server-id>/agent/<test agent>"}`, wait for `Which surface should this apply to?` and 10 s, and count again. Expected: `1`, with Step 17's danger text. The reload drops the in-memory dismissals (Decision 7) and the recorder; the remaining steps need neither. If the reload lands on "Welcome to Paseo", add the host again as in Step 9 items 3 and 4, then navigate again.

- [ ] **Step 19: Move to the suggested target.** Take `mcp__playwright__browser_snapshot` and click the visible `Move to <target> · <n>%` button. Expected: the button reads `Moving...` while the move runs (a snapshot can miss it), and within about a minute the tab shows the moved agent, whose `move-banner-moved-from` notice reads `Moved from Mock Load Test` with a `Move back` button. When the target account's own window is past 80% or on pace to run out within three hours, its heads-up shows instead, because the limit notice and the heads-up come before "Moved from" (Task 5): note it; it is not a failure. Check with `mcp__playwright__browser_evaluate` and `{"function": "() => [...document.querySelectorAll('[data-testid=\"move-banner-moved-from\"], [data-testid=\"move-banner-heads-up\"]')].filter((el) => el.getClientRects().length > 0).map((el) => el.innerText)"}`. Then run:

```bash
. /tmp/usage-heads-up-test.env && mem_ok
TEST=$(run_result /tmp/usage-heads-up-mock.json | cut -d' ' -f1)
BYSTANDER=$(run_result /tmp/usage-heads-up-bystander.json | cut -d' ' -f1)
echo "test agent: $(agent_state "$TEST")"
dev_cli ls -a -g --json | node -e 'let text = "";
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => {
  const [dir, ...known] = process.argv.slice(1);
  for (const agent of JSON.parse(text)) {
    if (agent.cwd === dir && !known.includes(agent.id)) console.log(agent.id, agent.provider);
  }
});' "$AGENT_DIR" "$TEST" "$BYSTANDER" | tee /tmp/usage-heads-up-moved.id
```

Expected: `test agent: <status> pending=<n> archived=true` (the move cancelled the test agent's turn and archived it; its status and pending count may vary), then exactly one line `<moved id> <provider>/<model>` (`<moved id> <provider>` while the model is not known yet), where `<provider>` is the Step 12 target's id, `claude` for the plain Claude provider (`ls.ts:103-116`). Then run with `run_in_background: true`:

```bash
. /tmp/usage-heads-up-test.env && mem_ok && MOVED=$(cut -d' ' -f1 /tmp/usage-heads-up-moved.id) && dev_cli wait "$MOVED" --timeout 300 --json | node -e 'let text = "";
process.stdin.on("data", (chunk) => (text += chunk)).on("end", () => console.log("wait:", JSON.parse(text).status));' && dev_cli logs "$MOVED" --json > /tmp/usage-heads-up-moved.log && node -e 'const { items } = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
const continues = items.filter(
  (item) =>
    item.type === "user_message" && item.text.includes("Continue where the previous agent stopped."),
).length;
const reply = items
  .filter((item) => item.type === "assistant_message")
  .map((item) => item.text)
  .join("")
  .trim();
console.log("continue prompts:", continues);
console.log("reply:", reply.slice(0, 120));' /tmp/usage-heads-up-moved.log
```

Expected: `wait: idle`, `continue prompts: 1` (at least 1), and `reply: ok`, case and punctuation aside. The heads-up's Move sent `continueWork: true`, so the moved agent got `MOVE_CONTINUE_PROMPT` and answered with nobody typing. A different short reply is the model's wording, not this feature: note it and go on. On `wait: permission`, run `. /tmp/usage-heads-up-test.env && dev_cli permit deny "$(cut -d' ' -f1 /tmp/usage-heads-up-moved.id)" --all --interrupt`, note it, and go on, since the move itself worked. On `wait: timeout` or `wait: error`, read `/tmp/usage-heads-up-moved.log` and abort.

- [ ] **Step 20: Read what the daemon sent.** Run:

```bash
. /tmp/usage-heads-up-test.env && mem_ok
notified_lines
echo "notices: $(notified_count)"
echo "watch failures: $(grep -cE '"usage watch: (check failed|move targets failed|tick failed)"' "$DEV_HOME/daemon.log")"
```

Expected:

```
notified mock 81 <test agent id>
notified mock 96 <test agent id>
notices: 2
watch failures: 0
```

One notice per level and window, none repeated across the ticks between Steps 11 and 19 (Task 7's crossing tracker). An extra `notified claude <pct> <moved id>` line means the real Claude account crossed 80% during the run, which the watch reports as it should: note it. A failure line ends the run: read it with `grep -E '"usage watch: (check failed|move targets failed|tick failed)"' "$DEV_HOME/daemon.log" | tail -n 3`, then abort.

- [ ] **Step 21: Archive the agents and stop the dev daemon.** Run:

```bash
. /tmp/usage-heads-up-test.env && mem_ok
BYSTANDER=$(run_result /tmp/usage-heads-up-bystander.json | cut -d' ' -f1)
MOVED=$(cut -d' ' -f1 /tmp/usage-heads-up-moved.id)
dev_cli agent archive "$BYSTANDER" --force > /dev/null && dev_cli agent archive "$MOVED" --force > /dev/null && echo "bystander and moved agent archived"
timeout 30 bash -c '. /tmp/usage-heads-up-test.env; for id in $(test_agent_ids); do until [ "$(agent_proc_count "$id")" = 0 ]; do sleep 1; done; done' || echo "TIMEOUT: an agent process outlived its archive"
for id in $(test_agent_ids); do echo "$id $(agent_state "$id" | cut -d' ' -f3) processes=$(agent_proc_count "$id")"; done
```

Expected: `bystander and moved agent archived`, then three lines `<id> archived=true processes=0`, one each for the bystander, the test agent (archived by the move) and the moved agent. Then stop the daemon the way its own shutdown expects, SIGTERM to the supervisor:

```bash
. /tmp/usage-heads-up-test.env
s=$(sup_pid) && dev_home_process "$s" && in_dev_session "$s" && kill -TERM "$s" && echo "sent SIGTERM to dev supervisor $s" && timeout 30 bash -c 'while kill -0 "$1" 2>/dev/null; do sleep 1; done' _ "$s" && echo "dev supervisor exited" || echo "TIMEOUT or failed check stopping the dev supervisor"
```

Expected: `sent SIGTERM to dev supervisor <S>` and `dev supervisor exited`. Then empty the rest of the session, which is `npm` and the dev runner at most:

```bash
. /tmp/usage-heads-up-test.env
if g=$(recorded_pid "$DAEMON_RECORD") && group_alive "$g"; then kill -TERM -- "-$g" && echo "sent SIGTERM to dev session group $g"; fi
timeout 30 bash -c '. /tmp/usage-heads-up-test.env; g=$(record_pid_field "$DAEMON_RECORD"); while group_alive "$g" || listening 6768; do sleep 1; done' && echo "dev session empty; 6768 closed" || echo "TIMEOUT: the dev daemon session still runs"
```

Expected: `dev session empty; 6768 closed`, after a `sent SIGTERM to dev session group <L>` line when something outlived the supervisor. A `TIMEOUT` line sends you to **Abort and clean up**, which repeats these checks and also signals what is left of the session.

- [ ] **Step 22: Close the tab, stop Metro, and put the dev home back.** Call `mcp__playwright__browser_tabs` with `{"action": "list"}`, then `{"action": "close", "index": <index of the http://172.22.0.3:8081 tab>}`. Then run:

```bash
. /tmp/usage-heads-up-test.env
g=$(recorded_pid "$APP_RECORD") && tr '\0' ' ' < "/proc/$g/cmdline" | grep -q 'scripts/dev-app.sh' && kill -TERM -- "-$g" && echo "sent SIGTERM to Metro group $g" && timeout 30 bash -c '. /tmp/usage-heads-up-test.env; while group_alive "$1"; do sleep 1; done' _ "$g" && echo "Metro stopped; /tmp/paseo-heavy.lock released" || echo "TIMEOUT or failed check stopping Metro"
```

Expected: `sent SIGTERM to Metro group <M>` and `Metro stopped; /tmp/paseo-heavy.lock released`. The group's leader is `flock`, whose command line names `scripts/dev-app.sh`, so the check confirms the record still names the Metro this run started. On `TIMEOUT`, run **Abort and clean up**: it sends SIGKILL to the group when SIGTERM is not enough. Then run:

```bash
. /tmp/usage-heads-up-test.env
if listening 6768 || listening 8081; then
  echo "STOP: 6768 or 8081 still listens; leave the dev home alone and run Abort and clean up"
else
  rm -f /tmp/usage-heads-up-dev-password && echo "dev password deleted"
  if [ -e "$DEV_HOME/.usage-heads-up-test" ]; then
    run="$DEV_HOME.usage-heads-up-run-$(date +%Y%m%d%H%M%S)"
    mv "$DEV_HOME" "$run" && echo "test dev home kept at $run"
  fi
  prev=$(ls -d "$DEV_HOME".before-usage-heads-up-* 2>/dev/null | sort | tail -n 1)
  if [ -n "$prev" ] && [ ! -e "$DEV_HOME" ]; then
    mv "$prev" "$DEV_HOME" && echo "previous dev home restored from $prev"
  fi
  rm -rf "$FAKE_DIR" "$CONTROL_FILE" && echo "throwaway plugin deleted"
fi
```

Expected: `dev password deleted`, `test dev home kept at /workspace/utils/paseo/.dev/paseo-home.usage-heads-up-run-<timestamp>`, `previous dev home restored from ...` when Step 4 moved one aside, and `throwaway plugin deleted`. Nothing this run started is left: the next `npm run dev` gets the dev home it had before, without the copied config that turns plugins on and names the throwaway plugin. The kept test home holds `daemon.log` and the agents' records, and `/tmp/usage-heads-up-*.png`, `/tmp/usage-heads-up-moved.log` and `/tmp/usage-heads-up-dev-daemon.out` stay as evidence. Those are scratch files for the user's report and never go into a commit.

- [ ] **Step 23: Rewrite the move doc's sentence about who moves an agent.** In `docs/agent-lifecycle.md` ("Moving a session"), replace

```
Paseo never moves an agent by itself: a turn that fails with a usage-limit error only sets
`limitReached` on the agent, which offers a move in the app until a later turn completes.
```

with

```
Paseo never moves an agent by itself. A turn that fails with a usage-limit error sets `limitReached`
on the agent, which offers a move in the app until a later turn completes. Before an account runs
out, from 80% of a window or a projected run-out within three hours, the move banner shows a
heads-up with a one-click move, and the daemon sends one notification per account window at 80% and
again at 95% while an agent on that account is running; background agents and subagents do not
count. Dismissing the heads-up hides it for every agent on that account until the window passes the
next of 80% and 95%, or resets. Dismissals live in the app's memory and the notified levels in the
daemon's, so an app restart shows a dismissed heads-up again, and a daemon restart notifies again
for a window already past 80%. Only apps that advertise `usage_notifications` get the notification
in the app; when none of them is present, it goes out as a push. The thresholds and the best-target
rule are in `packages/protocol/src/usage-heads-up.ts`.
```

The old sentence said Paseo reacts only after a turn fails, which the heads-up makes wrong. The paragraph keeps to what the code cannot tell a reader: who acts, when, and what does not survive a restart (Decision 7).

- [ ] **Step 24: Name the projection's owner in the plugin doc.** In `docs/plugins.md` ("Usage sources", the paragraph at line 603), replace

```
the daemon owns account grouping and the fetch cache.
```

with

```
the daemon owns account grouping, the fetch cache, and the run-out projection. When a window has no `runsOutAt`, the daemon fills it and `shortfallPct` from its own fetches of that window over the last two hours, once two fetches at least 10 minutes apart show usage rising, and only when the run-out falls before `resetsAt`; a drop in usage starts the samples over. Set `runsOutAt` only from data the provider reports: the daemon never replaces a source's own value.
```

The replacement stays on line 603, which is one long line like the rest of that section. A source author needs this: a source that fills `runsOutAt` itself switches the daemon's projection off for that window (Task 2).

- [ ] **Step 25: Format and check the docs.** No code changed in this task, so there is no lint or typecheck step of its own; the pre-commit hook typechecks the tree in Step 26. Run:

```bash
cd /workspace/utils/paseo && npm run format:files -- docs/agent-lifecycle.md docs/plugins.md && npm run format:check:files -- docs/agent-lifecycle.md docs/plugins.md && git diff --stat -- docs/agent-lifecycle.md docs/plugins.md && grep -n "usage_notifications" docs/agent-lifecycle.md && grep -n "run-out projection" docs/plugins.md | cut -c1-60
```

Expected: both oxfmt runs exit 0; the diff stat lists `docs/agent-lifecycle.md | 13 +++++++++++--` and `docs/plugins.md | 2 +-`, with `2 files changed, 12 insertions(+), 3 deletions(-)`; the first grep prints line 298 (`for a window already past 80%. Only apps that advertise ...`), and the second prints `603:Register a usage source from ...`. These counts and line numbers were checked by applying both replacements to copies of the current docs, and `oxfmt --check` passed on those copies unchanged.

- [ ] **Step 26: Commit with the fork identity.** Metro and the dev daemon must be stopped first (Steps 21 and 22): Metro holds the lock, so a still-running Metro would block this commit. Stage the docs and list what is staged:

```bash
cd /workspace/utils/paseo && git add docs/agent-lifecycle.md docs/plugins.md && git diff --cached --name-only
```

Expected: exactly two lines, `docs/agent-lifecycle.md` and `docs/plugins.md`. This checkout is shared with other sessions, so another path in that list is someone else's staged work. Stop and ask the user; do not commit it and do not unstage it. Only when the list holds those two paths alone, run:

```bash
cd /workspace/utils/paseo && flock /tmp/paseo-heavy.lock env GIT_AUTHOR_NAME=tatsuya GIT_AUTHOR_EMAIL=allrested@gmail.com GIT_COMMITTER_NAME=tatsuya GIT_COMMITTER_EMAIL=allrested@gmail.com git -C /workspace/utils/paseo commit -m "docs(fork): document the usage heads-up and run-out projection" -- docs/agent-lifecycle.md docs/plugins.md
```

Expected: the pathspec limits the commit to the two docs even if something is staged between the two commands. The lefthook pre-commit runs `format:check:files` on the docs, skips lint (no code), and runs the full `npm run typecheck` under the lock (1-3 minutes). The commit prints `docs(fork): document the usage heads-up and run-out projection` and `2 files changed, 12 insertions(+), 3 deletions(-)`. This is a local commit only. Never push, and never set `LEFTHOOK=0`: a failing hook means a task before this one left the tree broken, so stop and report it.

- [ ] **Step 27: Verify the commit identity and report.** Run:

```bash
git -C /workspace/utils/paseo log -1 --format='%an <%ae> | %cn <%ce>'
```

Expected: `tatsuya <allrested@gmail.com> | tatsuya <allrested@gmail.com>`. Then tell the user what the run showed, step by step: the projected run-out (Step 11), both notifications and the click into the agent (Steps 11, 12, 16 and 17), More..., the Usage modal and both dismissals (Steps 13 to 18), the move and the moved agent's `ok` (Step 19), and the daemon's two notices (Step 20). Name the two screenshots and every deviation the steps told you to note: a real Claude notice, a different reply wording, a denied permission, or the target's own heads-up after the move. Native push was not exercised: the browser's notifications came through the recorder, and no app was absent, so no push went out.

## Self-review

**Spec coverage.**

| Spec requirement                                                                                                                                                                     | Where the plan meets it                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Projection: 2 hours of samples, a drop clears them, two samples 10 minutes apart, the slope from oldest to newest, a run-out only before `resetsAt`, a source's own `runsOutAt` kept | Task 2 (pace tests for the rate, a run-out after the reset, a single sample, a reset, a source's own value), Decision 2; Task 8 Steps 11 and 16 |
| The Usage screen and `paseo usage` show the projected run-out with no UI change                                                                                                      | Decision 3 (`shortfallPct` filled as well); Task 8 Step 11 (`paseo usage inspect`) and Step 14 (Usage modal)                                    |
| The notice from 80%, or on pace to run out before the reset and within 3 hours; danger at 95% or a run-out within 30 minutes                                                         | Task 1 (`usageHeadsUpTone`), Task 4; Task 8 Steps 10, 12 and 17                                                                                 |
| The banner reads the move targets while the panel is active, every 5 minutes; the current target carries the tightest window's `usedPct`, `resetsAt`, `runsOutAt` and `windowLabel`  | Task 1 (`chooseTightestWindow`), Tasks 3 and 5, Decisions 4 and 8                                                                               |
| Banner order: the limit notice, the heads-up, "Moved from"                                                                                                                           | Task 5 (`move-banner-view.test.ts`); Task 8 Step 19                                                                                             |
| Best target: available, not the current account, lowest `usedPct`, ties to the same family                                                                                           | Task 1 (`chooseBestMoveTarget`), Decision 5                                                                                                     |
| Move through the dialog's path, continuing automatically; More... opens the dialog; with no target, the facts and More... only                                                       | Task 5, Decision 10; Task 8 Steps 13 and 19                                                                                                     |
| Dismiss until the next level                                                                                                                                                         | Tasks 4 and 5, Decision 7; Task 8 Steps 15, 17 and 18                                                                                           |
| Optional `runsOutAt` and `windowLabel` on move targets                                                                                                                               | Tasks 1 and 3 (`messages.usage-heads-up.test.ts`)                                                                                               |
| One notification per account window at 80% and at 95% while an agent on it runs, naming the agent and the best target; a tap opens the agent                                         | Tasks 6 and 7, Decisions 1 and 11; Task 8 Steps 11, 12, 16, 17 and 20                                                                           |
| "The plan starts by confirming the pipeline can carry this payload"                                                                                                                  | Decision 1                                                                                                                                      |
| Unit tests for the projection, the heads-up rules and the best target; banner view tests                                                                                             | Tasks 1 (17 rules tests, 4 of them for the tightest window), 2, 4 and 5                                                                         |
| Manual test: a fake source whose usage rises; the heads-up at 80%, danger at 95%; the Usage screen's run-out; Move to the suggested target                                           | Task 8, Decision 12                                                                                                                             |

**Placeholder scan.** No step says TBD, TODO or "similar to Task N"; every code step shows its code and every command its expected output. The angle-bracket values in Task 8's Expected blocks are run-time values (ids, times, percentages) that the step says where to read.

**Type consistency.** Each Consumes line names something an earlier task Produces: Task 2 takes `windowUsedPct` from Task 1; Task 3 takes Task 1's `chooseTightestWindow` and wire fields and Task 2's projected windows; Task 4 takes Task 1's `chooseBestMoveTarget`, `usageLevel` and tone helpers; Task 5 takes Task 4's model, store and copy and Task 1's feature flag; Task 6 builds only on existing code; Task 7 takes Task 1's helpers, Task 3's `listAgentMoveTargets`, `moveTargetProvidersFrom`, `sharedMoveTargetUsage`, `ListUsageReportsForScope`, `UsageScopeQuery` and `MoveTarget`, and Task 6's capability and attention payload; Task 8 drives what Tasks 2 to 7 produce through their test ids, copy, log lines and CLI output.

**Where the plan departs from the spec, on purpose.**

- `More...`, not `More…`, and the window label verbatim (`84% of Weekly`), per `docs/design.md` §10 and Decision 6.
- The best target also skips targets at 100% or more and those at or above the current account's usage (Decision 5).
- Dismissals live in the app's memory only (Decision 7); the spec does not say how long they last.
- The `usage` notification reaches the app only on clients that advertise `usage_notifications`, plus a push (Decision 1), and it counts only foreground, non-delegated agents in a workspace (Decision 11).
- The move dialog's badges keep their 70% and 90% tones while the heads-up uses 80% and 95%. Out of scope: the spec does not touch the dialog (Controller resolutions, item 6).
- The manual test steps the fake source's usage by hand (76%, 81%, 96%) instead of letting it rise on its own, so each step knows the value it checks (Decision 12).

## Critique log

- Completeness: the plan had no final task. Tasks 5 and 7 sent their banner and notification checks to a Task 8 that did not exist, and the spec's manual test and the doc updates had no task. Added Task 8: an isolated dev daemon with a throwaway usage source and the mock provider, the heads-up at 80% and 95%, both notifications and their click, More..., the Usage modal, dismissals, the move and its `ok`, cleanup that restores the previous dev home, the two doc edits and the commit.
- Completeness: no Self-review section. Added one, with spec coverage, the placeholder scan, type consistency and the departures from the spec.
- Completeness: the plan did not say whether a rollout task was needed. The spec has no rollout section, so Decision 13 records that there is none and that deploying the fork build belongs to sub-project 6 (ops), deferred.
- Completeness: File Structure named no docs. It now lists `docs/agent-lifecycle.md` ("Moving a session") and `docs/plugins.md` ("Usage sources") under Task 8.
- Test design: Task 2 wrote the re-registration test together with the projection and the `forget` fix, so that test never failed first. Steps 7 to 10 now add the projection, watch the re-registration test fail, add `forget`, and watch it pass.
- Test design: Task 1 Step 6 included a guard test that passes before the change without saying so. The step now names it as a guard that is expected to pass.
- Test design: Task 5 Step 2 had two such guard tests, unflagged. The step now names both.
- Test design: Task 6 Step 6 checked `grep -c '"usage"'`, which already counted 18 before the change and proved nothing. It now counts the enum that gains `usage`: 0 before, at least 2 after.
- Protocol compatibility: `CLIENT_CAPS.usageNotifications` had no COMPAT tag. Added `COMPAT(usageNotifications)` with the removal date 2027-05-07.
- Protocol compatibility: the capability gate in `deliverAgentAttention` had no COMPAT tag. Added the same tag there, so `rg "COMPAT\("` finds both sites.
- Cross-plan: row 3 said sub-project 5 had no way to read usage. `paseo.providers.listUsage` exists (`packages/client/src/index.ts:483, 800`) over the legacy `provider.usage.list` RPC tagged `COMPAT(providerUsageList)`, and the claude-accounts draft proposes `listUsageForProvider` over a new `usage.provider.list_reports` RPC. Rewrote the row to say both carry the projection and that the choice is open.
- Cross-plan: row 2 said sub-project 5 could reuse the tightest-window ranking, which stays module-private (`rankWindow`, `isTighter`) while the claude-accounts draft re-implements the old rule. Amended the row and listed the ownership question below.
- Added: Task 7's Produces now names the log lines exactly as its code writes them (`usage watch: started` with `intervalMs`, `usage watch: notified` with `agentId`, `provider` and `usedPct`, and the three failure lines), because Task 8 times and counts them.
- Added: the dev daemon runs with `PASEO_RELAY_ENABLED=false` and a throwaway password, and its copied config drops the password hash and every installed plugin, so the test never reaches the public relay or runs the user's plugins.
- Added: Task 8 waits 900 s after the first sample, not 600, so the run-out projected at 81% lies at least 57 minutes out and the Step 12 heads-up cannot turn danger before it is read.
- Added: Step 22 keeps the test dev home aside and puts the previous one back, so the next `npm run dev` does not start with plugins on and the throwaway plugin configured.
- Added: Decision 12 now says the fake source gives the whole `claude` family 12%, since move targets read usage by family.

### Controller resolutions (2026-11-07)

1. Settled: sub-project 5 reads each account's usage through its new `usage.provider.list_reports` RPC and `listUsageForProvider` (the user's answer). The Cross-plan table names it.
2. Settled by exporting the rule: `chooseTightestWindow` in `usage-heads-up.ts` (Task 1). `toMoveTarget` and sub-project 5's `tightestUsageWindow` both call it.
3. Settled: Auto skips an account whose tightest window has the `danger` tone, 95% or more or a run-out within 30 minutes (the user's answer). Sub-project 5 builds it.
4. Settled in sub-project 5: its usage RPC carries the tightest window's tone, so the plugin mirrors no threshold and nothing can drift.
5. Approved by the user: Task 8 installs the throwaway usage plugin on the dev daemon only (Decision 12).
6. Accepted: the move dialog keeps its 70% and 90% badges. The spec does not touch the dialog, so the mismatch is out of scope.
7. Accepted: native push and its tap stay untested; Task 8 checks the tap in the web app only.
8. Approved by the user: Task 8 Step 19 spends one short real Claude turn.

### Controller amendments (2026-11-07)

- Task 1: exports `chooseTightestWindow(windows, now)`, with `UsageWindowPace` and `TightestWindow`, from `usage-heads-up.ts`, and adds four tests for it (13 to 17). Produces, Steps 4 and 8 and File Structure follow.
- Task 3: `toMoveTarget` calls `chooseTightestWindow`; the private `rankWindow`, `isTighter` and `TONE_RANK` are gone. Consumes and Step 3 follow; its 11 tests are unchanged.
- Decision 4 names the exported rule and why it sits in the protocol package.
- Cross-plan table: sub-project 5 lands after this plan, calls the ranking, imports `UsageScopeQuery` and `MoveTargetUsageLookup`, reads the daemon's `danger` tone instead of mirroring thresholds, and reads usage through `listUsageForProvider`.
- Tasks 1, 2, 3, 4 and 7: a missing module now fails with `Error: Cannot find module './x.js' imported from <test path>`, as Vitest 4.1.7 prints it.
- Self-review: spec coverage, the unit-test count and type consistency follow the export; the badge departure points at resolution 6.
- Checks: the new rules code with its tests and Task 3's `move-targets.ts` with its tests ran from a scratch tree. Vitest passes 17 rules tests and 11 move-target tests, `oxfmt --check` passes on the new code, `oxlint` reports 0 warnings and 0 errors, and `tsc --strict` passes on the rules file with two probes shaped like the calls in `toMoveTarget` and `tightestUsageWindow`.
- Open for the controller became Controller resolutions (2026-11-07).
