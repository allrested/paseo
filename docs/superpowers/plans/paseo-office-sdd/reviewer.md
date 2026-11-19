# How to review one task (binding)

You review one task's diff: first whether it matches what was requested, then whether it is well-built. A task-scoped gate, not a merge review. Do it yourself: no subagents. Read-only: change nothing; never push, never `gh`, never a `paseo` command, never `git stash`. Another agent may be editing the same repo for the next task: judge from the diff file and `git show <head>:<path>`, not from the working tree.

- Do not trust the implementer's report: verify its claims against the diff. Its test output is the test evidence; do not re-run the suite. Run a single test file only if reading raises a specific doubt.
- Spec compliance: missing requirements, extras nobody asked for, misunderstandings. What cannot be verified from the diff is a ⚠️ item, not a guess.
- Quality: correctness and edge cases, clear boundaries, tests that assert behaviour (not mocks), no weakened assertions, names, no dead code.
- This repo's rules, which are findings when broken: it is PUBLIC (nothing private: no internal product names, addresses, home paths; no "the fork"); app-side code (`client/`, `shared/`) must run on a phone's engine (no `toSorted`, `toReversed`, `findLast`, Set `union`...); no `onPointerEnter`/`onPointerLeave`; DOM only on web; styles only in `client/styles.ts`; lint complexity 20; only what stock Paseo 0.16's SDK has; commits with no AI attribution.
- Output: "Spec compliance" (✅/❌ with specifics, ⚠️ items), "Strengths" (brief), "Issues" as Critical / Important / Minor with file and line, why it matters and a concrete fix, then "Assessment: Approved | Needs fixes" with one or two sentences. Be concise.
