# Brief for writing one implementation plan of the paseo-office roadmap

You write ONE implementation plan document. You change nothing else: no code, no commits, no
pushes, no `gh`, no `paseo` command, no daemon. Read-only everywhere except the one plan file you
are told to write.

## What you are planning for

`/workspace/QFlavours/paseo-office` is a public Paseo plugin (https://github.com/allrested/paseo-office),
the "office": every agent on the host at a desk. Its 3D scene is a port of my-office by khanh020905
(MIT), vendored under `vendor/my-office/`, built ahead into `server/world.generated.ts` by
`scripts/build-world.mjs`. A clone of my-office at the vendored commit is at
`/tmp/ref-office/my-office` (clone it there from https://github.com/khanh020905/my-office if it is
missing).

Read, in this order:

1. The roadmap: `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-paseo-office-roadmap-design.md`.
   It has the owner's decisions, what binds every piece, and one section per piece. Yours is named
   in your dispatch.
2. The survey of my-office: `/workspace/QFlavours/docs/superpowers/specs/2026-11-19-my-office-survey.md`.
3. In the repo: `README.md`, `docs/office.md`, `vendor/SOURCES.md`, `vendor/my-office/import-upstream.mjs`,
   `vendor/my-office/MANIFEST.json`, `vendor/my-office/src/office/paseo-entry.js`, `paseo-host.js`,
   `paseo-style.js`, `scripts/build-world.mjs`, `server/world-script.test.ts`,
   `client/world/world-api.ts`, `client/world/adapter.ts`, `shared/settings.ts`,
   `client/host-switches.tsx`, `client/office-settings.tsx`, `client/engine-compat.test.ts`,
   and whatever else your piece touches. Read the upstream files your piece takes, in full.
4. An example of the format and level of detail expected:
   `/workspace/QFlavours/docs/superpowers/plans/2026-11-19-paseo-office-piece-1-session-tabs.md`.

## What the plan must be

A document an engineer with no context can execute task by task. Format:

- Title `# paseo-office piece N: <name> Implementation Plan`, then the line
  `> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.`
- **Goal** (one sentence), **Architecture** (2-3 sentences), **Tech Stack**, **Spec** (the roadmap's
  path and your piece's section).
- **Decisions**: every choice the roadmap leaves to the plan, each with the choice, the reason in
  one sentence, and what it costs if wrong. Decide; do not leave options open.
- **Global Constraints**: copy the ones that bind your piece from the roadmap's "What binds every
  piece" and from piece 1's plan (the public repo's rules, the phone-engine rule, stock Paseo
  only, styles in `client/styles.ts`, the checks to run, the throwaway daemon's rules), and add
  your piece's own.
- **Tasks**, 3 to 8 of them, each with: **Files** (exact paths, create/modify/test),
  **Interfaces** (what it consumes from earlier tasks and produces for later ones, exact names and
  types), and **steps** as checkboxes, each one action: write the failing test, run it and see it
  fail (the command and what failure to expect), implement, run it and see it pass, commit (the
  commit message). A task ends with something testable on its own.
- Real content: for every NEW module give the code, or where it is long, its exact exported
  interface plus the test cases in full. For changes to existing files give the exact place (by
  the text there, not a line number alone) and what it becomes. For files taken from my-office
  give the exact import-tool steps (which `DENY` entry goes, which stand-in is deleted, what the
  tool then reports and what is done about each report), the changes by hand each needs with the
  reason (each starts `// PASEO:` and is listed in `vendor/SOURCES.md`), and what upstream's page
  markup, CSS, assets, `process.env` or network calls each expects and how that is met.
- No placeholders: no "TBD", "handle edge cases", "similar to Task N", "write tests for the above".
- The last task is always "A look, and what was seen": the plugin installed by Git on a throwaway
  stock daemon (rules in piece 1's plan), what to look at on desktop and phone widths, what cannot
  be seen there and so is the owner's to check on the host (name it), and the update of
  `docs/verified.md`, `README.md` and `docs/office.md`.
- End with "After the tasks (controller)": review, merge, push, CI, host update, the owner's look
  on desktop and phone, the version tag this piece gets (piece 1 is v0.2.0, piece 2 v0.3.0, and so
  on).

## Rules for what you write

- Verify every fact about the code by reading it. Quote real names. Where you could not verify
  something (a browser API inside an app's frame, behaviour on a phone), say so in a "Not
  verifiable until built" list with how the task finds out.
- Your piece comes after earlier pieces that are not built yet. Assume each earlier piece is built
  as its roadmap section says, and name every assumption you make about it under
  "Assumes from earlier pieces", so it can be re-checked when your piece's turn comes.
- Keep to your piece. Note anything it needs from another piece instead of pulling it in.
- Plain, short sentences. No marketing words.
- Nothing private: no internal product or company names, no host addresses or home paths.

Write the plan to the path your dispatch names, then reply with at most 20 lines: the tasks' names,
the decisions you made, what you assume from earlier pieces, what is not verifiable until built,
and any reason the piece is larger or riskier than the roadmap says.
