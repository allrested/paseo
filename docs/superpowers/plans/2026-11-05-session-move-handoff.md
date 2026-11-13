# Session move — handoff

Branch `wip/v0.15-session-move` holds the fork delta plus session-move work in progress, on upstream v0.15.2.
Plan: `docs/superpowers/plans/2026-11-05-session-move.md`. Spec: `docs/superpowers/specs/2026-11-05-session-move-design.md`.

## How to resume

1. Check out this branch in `/workspace/QFlavours/paseo`, then `npm ci` and `npm run build:server`.
2. Tasks 1–9 are done and reviewed. Do not redo them.
3. Task 10 (app UI) and Task 11 (docs) are done, in commits 988a6be31 and c96d2e9bd, with review fixes on top. Do not redo them.
4. The follow-ups are done on branch `feat/session-move-followups` (2026-11-13): F1 a browser test for move and move back (`packages/app/e2e/browser/session-move.spec.ts`), written but not yet run: the paseo container has no browser, so it needs a CI run, F2 an offline client keeps a moved subagent's tab after one move (`use-follow-moved-agents.ts`), F3 a failed turn with the account at 100% sets `limitReached` (`usage-limit-fallback.ts`). F4, `limitReached` in the stored snapshot, was already in `agent-projections.ts`. Moving a subagent on its own stays allowed (Q1, ruled 2026-11-06).
5. The "Minor (final review)" items below were checked against `main` on 2026-11-13 and are fixed or ruled as limits in the spec. The session-move work is part of the fork delta on `main`; nothing is left to squash.

## Progress ledger (copied from .superpowers/sdd/progress.md)

# Session move — SDD progress

Plan: docs/superpowers/plans/2026-11-05-session-move.md
No commits: per-task diffs use tree snapshots (/tmp/sdd-tools/snap).
Task 1: complete (trees 9767ddc..01dabdb, review clean after 1 fix)
Minor (final review): limit-matcher /\b429\b/ matches any standalone 429 (plan-mandated); matcher is English-only heuristic
Note for later tasks: AgentAttachment comes from @getpaseo/protocol/messages (not agent-sdk-types); fork wrapper tag is <chat-history-summary>
Task 2: complete (trees 01dabdb..650f580, review clean)
Minor (final review): handoff-context sinceSeq test does not pin that header fields read unfiltered rows; non-null assertion input.sinceSeq! cosmetic
Task 3: complete (trees 650f580..eb4fe89, review clean)
Minor (final review): claude-transcript bare catch maps EACCES/EIO to missing; project-folder fallback untested
Carry to Task 6: skip transcript copy when from/to config dirs resolve equal (copyFile onto itself)
Task 4: complete (trees eb4fe89..d20ec55, review clean)
Minor (final review): getProviderLaunchInfo test lacks enabled:false and empty-env assertions
Task 5: complete (trees d20ec55..3c4650e, review clean after 1 fix: queue-level takePendingMoveContext)
Minor (final review): pendingMoveContext delivered at-most-once (cleared before run, brief-mandated); {text,title} type duplicated in agent-storage.ts vs PendingMoveContext
Task 6: complete (trees 3c4650e..6929495, review clean after 1 fix: children re-parented to successor, rollback undo, move lock)
Minor (final review): undoFinish path untested; move lock keyed per agent id not per chain (moveAgentBack should also lock originalId); failed native move-back leaves copied transcript; spec "move back to any earlier agent in chain" not implemented (only direct moved-from)
Note: PaseoDaemon (bootstrap.ts) now exposes providerSnapshotManager; session.ts agent_removed handling extracted to forwardAgentRemoved
Task 7: complete (trees 6929495..fb70d94, review clean after adding stored-record projection)
Minor (final review): limitReached refresh/reload persistence paths untested; keep-on-non-limit-failure branch untested; managed.limitReached assignment at registerSession lacks comment
Carry to Task 10: toAgentListItemPayload does not carry limitReached — app banner must read from full agent snapshot, or add it there
Task 8: complete (trees fb70d94..0bf0f54, review clean)
Minor (final review, Task 8): legacyWantsEvent sends agent_moved to pre-owned_subscriptions clients (add case agent_moved: return false); move-target usage uncached per targets request (slow when rate-limited); toMoveTarget ignores remainingPct (use usedPct ?? 100-remainingPct); targets for unknown agent: no error field; targets handler has no own error handling (agentStorage.get throw -> no response); agent_moved emitted without internal-agent filter
Carry to Task 9: client must subscribe to "agent_moved" ONLY when serverInfo.features.agentMove is true, and in a SEPARATE set_subscription request (old daemon enum rejects whole request)
Task 9: complete (trees 0bf0f54..423f1ff, review clean)
Minor (final review): client e2e move-back asserts only id differs (should equal sourceId); no MCP test for back=true/model; CLI cast options.to as string; run{Move,MoveBack}Command duplicate scaffolding
Resume (2026-11-05 15:45, new controller): Task 10 implementer was cut off by session limit; app files written, typecheck clean, retarget test 3/3 pass.
Ruling: scope extended per user "all features": add dialog model picker (spec), chain move-back via optional toAgentId (spec), fix Task 6/8/9 deferred minors, then Task 11 — user request — costs extra review rounds if wrong
Ruling: chain move-back uses optional toAgentId with no new feature flag — agentMove is unreleased fork-only, so no daemon ships agentMove without it — cost if wrong: an old fork daemon silently moves back one hop
Ruling: Task 12 (server side) runs in parallel with Task 10 finish (app only) — disjoint files
Ruling: banner limit notice reads limitReached only; usage >= 100% before a failed turn is not detected (server follow-up F3) — cost if wrong: no notice until the next turn fails
Task 10 review R0: CHANGES_REQUESTED (Important: offline retarget ignores agentDetails; retargetAgentTabs untested). Fix round 1 -> ce8812c7
Task 12 impl: DONE_WITH_CONCERNS (43/43 tests; added missing native->handoff fallback; chain rollback label fix)
Task 12 review R0: CHANGES_REQUESTED (Important: chained-rollback fix untested). Fix round 1 -> cbd17896 incl. minors 1-6
Carry to Task 10/final: app must surface listMoveTargets throw (targets error) — use-agent-move maps query error to {kind:error}, verify in final review
Task 10 fix round 1 done (agentDetails lookup, store-backed retarget tests, minors)
Task 10 re-review R1: CHANGES_REQUESTED (banner never fetches original; targets query retry). Fix round 2 -> ce8812c7 (fetchAgent via shared storeFetchedAgentDetail)
Task 10: complete (988a6be31 banner view; review fixes in c96d2e9bd).
Task 11: complete (988a6be31 docs; review fixes in c96d2e9bd).
State committed as WIP on main (local only, not pushed) on 2026-11-05.
