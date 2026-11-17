# The office's incidents: design

Date: 2026-11-17. Status: built. Sub-project 8 of
[the office after the owner's review](2026-11-16-office-owner-review-design.md), which has the
request, what the code did before, and the list of sub-projects.

## Request

Point 17 of the owner's review:

17. A new Jira bug or Sentry issue sets off upstream's incident alarm. The office checks Jira and
    Sentry itself every few minutes.

## The owner's answers

| Question                         | Answer                                                                                                                                                                                                                |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which Jira issues ring           | A new issue of type Bug in a project listed in the office's settings.                                                                                                                                                 |
| Where the tokens come from       | The daemon's environment. Jira: `ATLASSIAN_BASE_URL`, `ATLASSIAN_EMAIL`, `ATLASSIAN_API_TOKEN`. Sentry: `SENTRY_AUTH_TOKEN`, with the organisation in the office's settings. Changing a token means a daemon restart. |
| Which Sentry issues ring         | My proposal, accepted: a new unresolved issue, first seen since the last check, in a Sentry project listed in the office's settings.                                                                                  |
| The first check                  | My proposal, accepted: it records what exists and rings nothing. After it, the time of the last check is kept on disk, so a restart rings nothing again.                                                              |
| An incident while nobody watches | It stays open on the host until dismissed or a day old. The next viewer gets the alarm and a banner naming the bug with a link. A strip card lists the open incidents, so the 2D floor and the list show them too.    |
| How incidents reach the screen   | On the office's existing `office.state`, as an optional field. One new call on the scene's API. A strip card with Dismiss, through an RPC, as the Janitor's actions are.                                              |
| The cadence                      | Every 5 minutes.                                                                                                                                                                                                      |
| How much of upstream's alarm     | The red light, the red room, the fail bubbles, the banner, and upstream's siren sound. Not the errand for headache pills: it needs upstream's outings module and the street.                                          |
| The design as a whole            | Approved as played back, with the calls marked below.                                                                                                                                                                 |

## What was there

- The scene's `life/incidents.js` is a stand-in whose `updateIncident()` does nothing; the loop
  calls it each frame (`core/loop.js`). Upstream's module (95 lines, in the version
  `vendor/SOURCES.md` names) keeps `state.incidentUntil`, a red `PointLight` that pulses, the
  `is-incident` class on the stage, the `#incident` banner ("Incident: 3 failures in 5 minutes"),
  a fail bubble for every person at work, `sfx.play('siren')`, and `headache()` from
  `people/outings.js`. It starts on three `fail` events in five minutes. The rest of its
  `onEvent` is already Paseo's, in `paseo-entry.js`.
- The scene's `audio/sfx.js` is a stand-in (`sfx = { play() {} }`) that 18 kept modules call.
  Upstream's synthesises every sound with Web Audio, no files: an `AudioContext` made on the first
  `pointerdown` or `keydown` in the page, a gap per sound (the siren's is 4 s), a switch kept in
  `localStorage` under `office-sound`, and no sound during a replay. The siren is six square-wave
  tones over 1.8 s.
- `people/outings.js` is a stand-in too. Upstream's is 600 lines and imports the street, the lift,
  the weather and some 20 other modules.
- The office has no tracker client. The `tasks` built-in has one for Jira (`plugins/tasks/server/jira.ts`,
  `/rest/api/3/search/jql`) and its own token file; the office cannot call another plugin's RPCs.
- Built-ins run in the daemon's process, so the office's server reads the daemon's environment
  (`plugins/office/index.server.ts`). On this host the three `ATLASSIAN_*` variables were set in a
  process the daemon started; `SENTRY_AUTH_TOKEN` is set nowhere, and no Sentry organisation is
  configured.
- Plugin schedules ([docs/plugins.md](../../plugins.md#schedules)) run a plugin's handler on a
  cadence, survive a restart, skip runs missed while the daemon was down, and fail a run after
  10 minutes. `server/notes-schedule.ts` keeps one in step with the settings.
- `office.state` sends a snapshot, then changes; the stand-up notes' state already rides it as an
  optional `notes`. The Janitor card acts through `office.janitor.request`.

## Approaches

| Approach                    | Trade-off                                                                                       | Chosen |
| --------------------------- | ----------------------------------------------------------------------------------------------- | ------ |
| Incidents on `office.state` | Open clients see a new incident at once; 2D and the list get it free. One optional field more.  | Yes    |
| A subscription of its own   | Leaves the main state alone. One more stream per client for a list that is nearly always empty. | No     |
| The client polls an RPC     | Least server work. Up to a minute late, and every open device keeps asking.                     | No     |

Token sources considered: the daemon's environment (chosen), the `tasks` plugin's token file
(couples two plugins, and has no Sentry), and a token file of the office's own (no restart to
change a token; the most work).

## Decisions

### Settings

| Question   | Decision                                                                                                                                                                                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The fields | Host-wide office settings gain `jiraProjects` (project keys, comma separated, empty by default), `sentryOrg` (a slug, empty), `sentryProjects` (slugs, comma separated, empty) and `sentryUrl` (default `https://sentry.io`). `officeHostSettings` goes to version 3; version 2's values stay. |
| Validation | My call: a Jira key matches `^[A-Z][A-Z0-9_]+$` and a Sentry slug `^[a-z0-9][a-z0-9_-]*$`; a value that does not is refused on save. They are put in a JQL query and a Sentry query, so nothing else may reach them. `sentryUrl` is https (http on loopback only), as the `tasks` trackers'.   |
| On or off  | A tracker is checked when its token variables are set and it has a project (Sentry: and an organisation). Each field's hint says which variable it needs; a field set while its variable is not shows "`SENTRY_AUTH_TOKEN` is not set on this host" under it. The value is never shown.        |

### The check

| Question        | Decision                                                                                                                                                                                                                                                                                                                                                                                                  |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The schedule    | One plugin schedule, `incidents`, every 5 minutes, kept while at least one tracker is on and removed when none is. It follows the settings the way `createNotesSchedule` does: in order, unchanged schedules left alone, a failure kept for the settings screen.                                                                                                                                          |
| Jira            | `GET /rest/api/3/search/jql` with `project in (<keys>) AND issuetype = Bug AND created >= "<time>" ORDER BY created ASC`, fields `summary` and `created`. The issue's link is `<ATLASSIAN_BASE_URL>/browse/<key>`.                                                                                                                                                                                        |
| Sentry          | `GET <sentryUrl>/api/0/organizations/<org>/issues/` with `query=is:unresolved firstSeen:>=<time>` and the listed projects, newest first. The link is the issue's `permalink`.                                                                                                                                                                                                                             |
| The time window | My call: `<time>` is the last successful check less 10 minutes. Jira compares `created` to the minute and in the time zone of the token user's Jira profile, so a window to the second would miss issues. Keys seen in the last 2 days are kept, and an issue whose key was seen is not an incident again, dismissed or not.                                                                              |
| The first check | A tracker with no saved time saves the check's time and the keys found, and opens nothing. A tracker whose projects change keeps its time, so a project added later rings only for issues from then on less the margin. My call. Decided while building: a tracker that is off at a check forgets its time, so turned on again its next check is a first check and rings nothing for the time it was off. |
| Limits          | At most 20 incidents opened per tracker per check, the oldest first; the rest wait for the next check, which reads from the `created` of the last one opened, less the margin. Each request ends after 30 s and follows no redirect. My call.                                                                                                                                                             |
| A failed check  | The tracker's saved time does not move. The error (status and the tracker's message, never a header or a token) is logged once per change and kept as the tracker's `problem` until a check succeeds.                                                                                                                                                                                                     |
| The store       | `$PASEO_HOME/office/incidents.json`, written whole through a temp file as `boards.json` is: per tracker the last check's time and the seen keys with when they were seen; the open incidents. An incident is `{ id, source: "jira" \| "sentry", key, title, url, createdAt, foundAt }`. A title is cut at 200 characters.                                                                                 |
| Closing         | An incident closes when it is dismissed or 24 hours after `foundAt`. Closed incidents are dropped from the file; their keys stay seen.                                                                                                                                                                                                                                                                    |

### On the screen

| Question     | Decision                                                                                                                                                                                                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| The state    | The snapshot gains optional `incidents: { open: Incident[], problems: { jira?: string, sentry?: string } }`. A change in either is sent as a change, as `notes` is.                                                                                                                              |
| The strip    | An Incidents entry, marked as needing attention, while an incident is open or a tracker has a problem. My call: a failing check is otherwise invisible. Its count is the open incidents.                                                                                                         |
| The card     | The open incidents, newest first: the source, the key, the title as a link that opens the issue, how long ago it was found, and Dismiss. "Dismiss all" under them. A tracker's problem as a line at the bottom. Dismiss sends `office.incidents.dismiss.request` with ids, or with none for all. |
| The 2D floor | Only the strip entry. No alarm on the floor.                                                                                                                                                                                                                                                     |

### The 3D alarm

| Question            | Decision                                                                                                                                                                                                                                                                                                                                          |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The scene's call    | `setIncidents(incidents)` on `PaseoOfficeWorld`, with each open incident and whether this device has rung for it. `WORLD_API_VERSION` stays 1 if the call is optional to the client, as `meet` is.                                                                                                                                                |
| What rings          | An incident this device has not rung for: 25 s of upstream's red pulsing light and red stage, a fail bubble for each person at work, and the siren. Several new at once ring once.                                                                                                                                                                |
| Rung on this device | The client keeps the ids this device rang for, for 2 days, so opening the office again does not ring again. Where it keeps them is the builder's (below). My call.                                                                                                                                                                                |
| The banner          | Upstream's `#incident` banner while any incident is open, not only during the 25 s: "Incident: <key> <title>" for the newest, and "+N more" for the rest. A click opens the Incidents card through a new `onIncidents()` start option; the scene opens no link itself.                                                                            |
| Upstream's trigger  | Not taken: three failures in five minutes no longer ring. My call, so the alarm means a tracker incident and nothing else. The per-person slam on a second failure stays as it is.                                                                                                                                                                |
| Reduced motion      | The light stays a steady red rather than pulsing, and the siren plays. My call.                                                                                                                                                                                                                                                                   |
| The siren           | `audio/sfx.js` takes upstream's engine (the context, its unlock, `tone`, the gap per sound, the `office-sound` switch) with only the siren in `SOUNDS`. Every other name still plays nothing, so the 18 callers stay silent. `noise` and the other sounds are not taken. `vendor/SOURCES.md` moves `sfx.js` from the stand-ins to a trimmed file. |
| Taken from upstream | `life/incidents.js`'s `startIncident`, `updateIncident` and `setup`, with `headache()` cut, and the `#incident` banner and `is-incident` style if the vendored page and `paseo-style.js` lack them. The file keeps upstream's shape; `onEvent` stays in `paseo-entry.js`.                                                                         |

## Errors

- A schedule that fails to save shows in the office's settings, under the incidents fields.
- A tracker that fails a check shows its problem on the Incidents card; the strip entry shows while
  it does.
- A dismiss that fails shows its error on the card, and the incident stays.
- A missing or broken `incidents.json` is an empty store, and its kind (not its text) is logged:
  the next check is then a first check and rings nothing.

## Not built

- Upstream's errand for headache pills, and every other sound.
- A notification from the host with the office closed.
- Closing an incident when the issue is resolved in its tracker.
- An alarm on the 2D floor.
- Incidents in upstream's activity panel: sub-project 7 can list `incidents.open` when it takes the
  panel. Nothing here touches the toolbar, the walk-in or the panels.

## Left to the builder

- The names and shape of the scene's call and the start option, within the above.
- Where a device keeps the ids it rang for: the `office-device` setting, or the frame's storage if
  it survives reopening in the app and on the web. It must survive closing and reopening the office.
- Sentry's project filter: slugs in the query, or the projects' ids looked up once per check.
- How the strip entry and the card fit `attention-strip.tsx` and `janitor-card.tsx`'s pattern.
- The texts' wording, in the office's voice.

## Limits to know

- Browsers start audio only after a click or key press in the page. The siren is in the scene's
  frame, and the office hands focus back to the app, so an office opened and not clicked rings
  silently until the next alarm after a click on the scene.
- A token changed in the environment takes effect at the next daemon restart.
- `ATLASSIAN_*` were seen in a process the daemon started, not on the daemon process itself. If
  the daemon lacks them, the settings say the variable is not set.
- `SENTRY_AUTH_TOKEN` is not set on this host: Sentry stays off until it is, and no Sentry check
  can be seen working here before then.

## Testing

- Unit tests beside the code: the JQL and Sentry query built from settings and a time; the window
  and the seen keys (a repeat, a dismissed key, an issue at the margin); the first check; a failed
  check keeping the time; the cap of 20; the 24-hour close; the store's read of a broken file;
  settings validation and the version 3 migration; the schedule kept, changed and removed.
- The trackers' clients against a local HTTP server standing in for Jira and Sentry, as
  `plugins/tasks/server/jira.test.ts` does; no test calls the real trackers.
- The card and the strip mounted, as `attention-strip.mounted.test.tsx`.
- The scene: `setIncidents` rings once per new id and not for an id already rung; the banner's
  text and its click.
- On a dev daemon, never the one on 6767: the real Jira read with the host's `ATLASSIAN_*`, read only,
  with the saved time set back so existing bugs count as new (nothing is filed in Jira); the alarm and siren seen and heard
  in the 3D view after a click on it. Sentry only if a token is provided for the test.

## Verified

What the daemon does was seen on a separate dev daemon reading the real Jira. The strip, the card
and the 3D alarm were seen on a static page fed by that daemon's state.

### On a dev daemon

A dev daemon of this checkout on `127.0.0.1:6768`, started with `npm run dev` in `packages/server`,
with its own `PASEO_HOME` under `/tmp`, the container's `PASEO_*` variables unset and the three
`ATLASSIAN_*` variables passed through. `SENTRY_AUTH_TOKEN` was not set. The daemon at 6767 was not
touched. The office was driven through its RPCs with the CLI's client, and its state read from its
`office.state` subscription, the schedule's file and `incidents.json`. On 17 November 2026 from
07:56 to 08:14 in Asia/Riyadh:

- The project: a read-only search beforehand found 42 bugs created in the last week in `FP`, more
  than one check opens, so "Jira projects" was set to `FP`. The office's Jira reader sends only
  GET requests, to `/myself` and `/search/jql`: nothing was filed or changed in Jira.
- Before the save the snapshot had `jiraReady` true, `sentryReady` false and no incidents. After
  it, one schedule in the daemon's store: `incidents`, cadence `every` 300000 ms, targeting the
  office's `incidents` handler. Its first run started when it was saved, at 07:57:30, not 5
  minutes later: the daemon runs a new `every` schedule at once. It succeeded and opened nothing:
  Jira's mark was the run's time with no keys seen, since no bug came in the 10 minutes before.
- The daemon stopped, the mark set back a week with `seen` emptied, and started again. The
  schedule kept its next run, 08:02:30. That run opened 20 incidents, from `FP-1369` to `FP-1407`,
  created from 10 November 22:18 to 16 November 09:48, the oldest first, each with its title and
  `<ATLASSIAN_BASE_URL>/browse/<key>`; the mark moved to the 20th's `created`. The run at 08:07:30
  opened 20 more, and the one at 08:12:30 the last 2, with the mark back at the run's time: 42 in
  all, the search's count. The 40 dismissed by then did not open again, though the last read's
  window held at least one of them, `FP-1435`.
- Dismiss, from the card through the page below: one id answered `{ dismissed: 1 }` and the next
  snapshot had 39; Dismiss all (no ids) answered `{ dismissed: 39 }` and the snapshot had none.
  With the CLI's client on the last 2: one id answered 1, the same id again 0, all answered 1, and
  all again 0. The 42 keys stayed seen in `incidents.json`, which is mode 600.
- "Jira projects" cleared: the schedule left the daemon's store, Jira's mark stayed, and no
  problem was set. Since then, a tracker turned off forgets its mark (The first check, above).
- No log line of the daemon held the token or the Basic header made from it, checked by count.

### On a static page

The plugin's real `OfficeSurface`, bundled with the repo's esbuild with `react-native` aliased to
`react-native-web`, as sub-project 3's pages were. The plugin kit was a stand-in, except that the
`office.state` events and two RPCs, `office.world.request` and `office.incidents.dismiss.request`,
went to the dev daemon above through a small bridge on `127.0.0.1` using the CLI's client. The 3D
view ran the script the dev daemon served. The browser was a local headless Chromium 145 driven by
Playwright, with WebGL on SwiftShader, at 1280 x 800. Its clicks are trusted pointer events. A
spy recorded each `AudioContext` and oscillator in every frame.

- Opened after the 08:02:30 run, light: the strip's Incidents entry read "20 open", the stage
  was red (`is-incident`), and the banner read "Incident: FP-1407 <its title> · +19 more", the
  newest created first. One save of `office-device` added the 20 ids. No `AudioContext` was made.
- A pointer click at the middle of the banner, inside the scene's frame, opened the Incidents
  card: 20 rows, "Jira FP-1407 · just now" first and FP-1369 last, each title a link. Focus went
  back to the page, and the click made the frame's `AudioContext`, running.
- Reloaded, the office opened again on that device: no red and no save; the banner stayed.
- Left open through the 08:07:30 run: "40 open", the stage red again, "Incident: FP-1435 <its
  title> · +39 more", one save adding the 20 new ids, and six square-wave oscillators: one siren
  for 20 new incidents. The spy did not read their pitch: the siren sets it on a timeline.
- The card from the strip: 40 rows, the earlier 20 "5 min ago". Dismiss on the first row, then
  "Dismiss all", as above. Then the card read "No open incidents", the strip entry was gone and
  the banner hidden.
- Reduced motion, dark, a second device, on the scene bundled from the same source with a probe
  for the light: the light read 14 at each of six reads, and the red edge's animation was `none`.
  Without reduced motion the light read 19.6 and 21.7, and the animation was `incident-blink`.

What did not come out as the check was written:

- Jira does not refuse a project key it does not know. Read only, `project in ("FP", "ZZNOPE")`
  answered 200 with FP's issues, and `"ZZNOPE"` alone 200 with none. A mistyped key rings nothing
  and shows no problem, and no failed check could be caused against the real Jira.
- The stage stayed red after "Dismiss all" until its 25 s ran out. Since then, a list with no open
  incident ends the red at the next frame (below, under Not verified).

## Not verified

Tests cover each of these; the live check did not reach them:

- Sentry: `SENTRY_AUTH_TOKEN` was not given for the test.
  `plugins/office/server/incidents-sentry.test.ts` runs the reader against a local server.
- A failed check: its problem on the card and in the strip, the mark kept, the problem cleared by
  the next success. `plugins/office/server/incidents-check.test.ts`,
  `plugins/office/server/incidents-jira.test.ts`, `plugins/office/client/incidents-card.mounted.test.tsx`,
  `plugins/office/client/incidents-text.test.ts`.
- An incident closing 24 hours after it was found: `incidents-check.test.ts`. The daemon ran for
  less than 20 minutes.
- A Jira user whose profile zone is far from the host's: the query's time is written in the zone
  `/myself` gives. `plugins/office/server/incidents-jira.test.ts`.
- `incidents.json` deleted or broken while the daemon runs: the next check is a first check and
  opens nothing for the backlog. A file that cannot be read skips the check and is not
  overwritten. `plugins/office/server/incidents-store.test.ts`, `incidents-check.test.ts`.
- A fail bubble over each person at work: nobody was at work on the dev daemon.
  `plugins/office/client/world/entry.test.ts`.
- "Dismiss all" ending a ring under way, built after the live check: `entry.test.ts`.

Not seen for other reasons:

- The siren heard: the browser was headless, and the spy only counted its oscillators.
- The click on the banner in Paseo's app, on the web or on desktop, and a click with a mouse in a
  headed browser. The click above was Playwright's mouse in headless Chromium.
- The host's sheet around the card, the app around the office, the settings screen saving the
  fields, the 2D floor and the Android app: the page had stand-ins, and the settings were saved
  with the CLI's client through the same RPC.
