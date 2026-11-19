# Rules for work in /workspace/QFlavours/paseo-office (binding)

- The repo is PUBLIC (https://github.com/allrested/paseo-office). Nothing private in files, fixtures or commit messages: no internal product or company names (use "Acme", `SHOP-…` keys, made-up paths), no host addresses (10.x.x.x), no `/home/paseo`, no agent or workspace ids, no "the fork".
- Work on the branch you are told. Never push, never run `gh`, never switch another checkout, never touch other folders under /workspace/QFlavours.
- Commits carry NO `Co-Authored-By` trailer and NO "Generated with" line. Use the git identity already configured; do not set user.name or user.email.
- NEVER run a bare `paseo` command: it talks to the owner's live daemon on port 6767, which manages every running agent including you. Never start, stop or restart that daemon. A task that needs a daemon says how to run a throwaway one.
- Never use `git stash`. To see a test fail before the change, write the test first and record its failing output.
- App-side code (`client/`, `shared/`, `index.client.tsx`) must run on a phone's JavaScript engine (Hermes): no `toSorted`, `toReversed`, `toSpliced`, `findLast`, `findLastIndex`, `Object.groupBy`, Set methods like `union`. `client/engine-compat.test.ts` guards it and must stay green.
- No `onPointerEnter`/`onPointerLeave`; DOM APIs only when `layout.platform === "web"`. Styles in `client/styles.ts`, never inline objects. The lint complexity limit is 20 per function.
- Use only what stock Paseo 0.16's SDK has (`node_modules/@getpaseo/plugin`, `@getpaseo/client`). Read the installed types; do not guess a shape.
- Checks: `npm run format:check && npm run lint && npm run typecheck && npm run check:world && npm run test:scripts`; single test files with `npx vitest run <file>`; the whole suite with `npm test -- --maxWorkers=4` (output to a file under /tmp) before each commit. Before each commit also `git diff --cached | grep -inE "token|password|secret|10\.0\.|/home/paseo|flavours|qoyod"` and read every hit.
- You do not dispatch subagents. Ask if something is unclear; report BLOCKED rather than guess.
- Report format: write your full report to the file you are given (what you did, the failing output of each new test before its code, the checks' results, files changed, concerns), then reply with at most 15 lines: Status (DONE | DONE_WITH_CONCERNS | BLOCKED | NEEDS_CONTEXT), commits (short SHA + subject), test totals, concerns, the report path.
