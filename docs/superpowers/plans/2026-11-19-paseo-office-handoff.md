# paseo-office: where the roadmap stands, and how to carry on

Written 2026-11-19 so the work can continue from another Paseo instance. The plugin's code is in
https://github.com/allrested/paseo-office (`main`). Everything else needed is in this folder and
in `docs/superpowers/specs/`.

## State

- `main` of paseo-office is at package version 0.2.0, pushed, CI green, **not tagged**. The last
  tag is `v0.1.0`.
- The owner's host runs it by Git (`paseo plugin update office --ref <commit>`), shown as
  "Office 3D" (the plugin id is still `office`).
- Done: piece 1 of the roadmap (session tabs in the column, the session panel, "Open session"
  stays in the office, New agent), the rename to Office 3D, the package made ready for npm, and
  a workflow that publishes to npm when a `vX.Y.Z` tag is pushed.

## The owner's decisions that bind what is left

- Ship every remaining piece before tagging. One tag, `v0.2.0`, at the end; the per-piece tags the
  plans name (`v0.3.0` to `v0.10.0`) are not made. Each plan's last "tag" step becomes "merge to
  main, push, update the host".
- npm: the Plugins page shows a version only for an npm install. Publishing needs an `NPM_TOKEN`
  secret on the paseo-office repo, which the owner adds. Then the tag publishes, and the host
  moves from the Git install to `npm:paseo-office` (back up
  `~/.paseo/plugin-settings/office/office.json` first: removing a plugin deletes its settings).
- The Atlassian variables for the incident alarm are set by the owner in the daemon's
  environment. No work.
- Languages: Paseo's app has no Vietnamese, Thai or Indonesian, so the office gets its own
  setting, "Language of the 3D office" (approved).
- Weather comes from an address the user enters, off by default. Sound is off until turned on.
  Signs are generic: no real brand name, logo or tune ships.
- my-office's author asks: keep the MIT licence and copyright notice, link back to
  https://github.com/khanh020905/my-office in the README, present the plugin as a community port,
  and send him the link once released.

## What is left, in order

1. **Real brand names already in the shipped scene.** The scene's English text carries about 25
   mentions inherited from my-office (a tea chain, a convenience store, ride and delivery apps, a
   marketplace, a medicine, a video app). Swap them for made-up names and add a scan to the
   bundle's test. The street plan (piece 8, Task 1) has the table and the script to reuse.
2. **Piece 2, sounds**: `2026-11-19-paseo-office-piece-2-sounds.md`.
3. **Piece 3, the Cozy floor plan**: `...-piece-3-floor-plans.md`.
4. **Piece 4, camera extras** (photo mode's day and night, the automatic camera, the tour, clip
   recording): `...-piece-4-camera-extras.md`.
5. **Piece 5, staff and daily life indoors**: `...-piece-5-staff-indoors.md`. The largest piece.
6. **Piece 6, Headquarters**: `...-piece-6-headquarters.md`.
7. **Piece 7, seasons, rain and weather**: `...-piece-7-weather.md`.
8. **Piece 8, the street**: `...-piece-8-street.md`.
9. **Piece 9, languages, with Indonesian**: `...-piece-9-languages.md`.
10. **README media**: screenshots of each feature, and a short clip if a recorder is at hand
    (this machine has no `ffmpeg`). Made-up names only in what is shown.
11. **Release**: the owner's check on desktop and phone, tag `v0.2.0`, release notes, npm, the
    host moved to the npm install, the message to my-office's author.

Small things left from piece 1's reviews, none blocking: a session tab's close button is 28 px
wide on a tablet; `onSession` and `onClose` could be optional on `ColumnTabs`; the "Agent
abcdefgh" fallback name and the `KeyPress` type are each written twice; a session tab's label
leaves out the agent's status; focus is lost after a tab is closed; on a phone the Sessions list
does not mark which sessions are open.

Not yet seen on a real host (the owner's check): a conversation, a reply while an agent works, a
permission answer, Stop, New agent, the tab row with many sessions, a long session on the phone.

## How each piece is done

The process that piece 1 used, and that the plans are written for:

1. Read the piece's plan. Each was written before the pieces ahead of it were built: check its
   "Assumes from earlier pieces" against the code first, and correct the plan where the code
   differs.
2. A branch per piece in paseo-office. One implementer per task, test first; one reviewer per
   task, reading the task's diff; then a whole-branch review, one fix pass, a re-review of the
   fixes.
3. Before merging: install the branch **by Git** on a throwaway stock daemon and look at it in a
   browser at 1280 and 390 px. A Git install has no `node_modules`; piece 1 passed every test and
   still failed to install until this was tried.
4. Merge to `main`, push, wait for CI, `paseo plugin update office --ref <commit>` on the host.

The briefs the helpers were given are in `paseo-office-sdd/`: `rules.md` (binding rules for work
in the repo), `reviewer.md` (how one task is reviewed), `piece-1-progress.md` (piece 1's ledger,
as an example of what to record), and `_plan-writer-brief.md` beside this file.

## Rules that are easy to break

- The repo is public. Nothing private in files, fixtures or commit messages; no AI attribution on
  commits.
- Never run a bare `paseo` command from a helper: it talks to the live daemon. A throwaway daemon
  gets its own `PASEO_HOME` and port, started with a clean environment, and is stopped by its
  supervisor's process id.
- App-side code (`client/`, `shared/`) runs on a phone's engine: no `toSorted`, `toReversed`,
  `findLast`, `Object.groupBy`. `client/engine-compat.test.ts` guards it.
- Non-test code imports only what a stock host supplies. `client/import-boundary.test.ts` guards
  it.
- Only what stock Paseo 0.16's SDK has. Read the installed types; do not guess a field.
- An additive optional field in a settings document takes no version bump.
- The scene makes no network call and never receives file names, commands or prompts.

## Paths

The plans name files under `/workspace/QFlavours/docs/superpowers/` and
`/workspace/QFlavours/.sdd-paseo-office/`, where they were written. The copies in this repo are
the same files: read `docs/superpowers/specs/2026-11-19-paseo-office-roadmap-design.md`,
`docs/superpowers/specs/2026-11-19-my-office-survey.md` and the plans in this folder instead. A
clone of my-office at the vendored commit is expected at `/tmp/ref-office/my-office`; clone it
again where it is missing.
