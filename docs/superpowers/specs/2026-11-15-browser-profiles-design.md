# Browser profiles and cookie import — design

Date: 2026-11-15. Status: design chosen by the build (program "Orca 1-9", sub-project G; the owner
asked to run every sub-project and review at the end). Builds on
[the web browser pane](2026-11-10-web-browser-pane-design.md).

## Problem

Every tab of the Docker browser pane opens in the Chromium's one shared profile. An agent that
tests a site as a test user signs the owner out of that site, two workspaces cannot be signed in to
one site as two users, and every agent tab can use every login the owner has in that Chromium.

## Scope

In scope:

- Named profiles for the Docker browser pane. A profile has its own cookies; the built-in Shared
  profile is the Chromium's own, as today.
- One profile per workspace: its new tabs open there, whether a person or an agent opens them.
- Cookie import into a named profile, from a cookie file or from the Shared profile for named
  sites.
- A profile's cookies survive a Chromium restart.

Out of scope: renaming a profile, moving an open tab to another profile, keeping site storage other
than cookies (localStorage, IndexedDB) across a Chromium restart, reading a browser's cookie
database from disk, exporting cookies, importing into the Shared profile, and the Electron pane.

## Decisions

| Question      | Decision                                                                                                                                                                                                                                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Isolation     | A profile is a CDP browser context (`Target.createBrowserContext`); its tabs are created with that `browserContextId`. One Chromium stays the rule, so a second `--user-data-dir` is not an option.                                                                                                               |
| Lifetime      | Chromium keeps a context in memory only. The daemon keeps each profile's cookies in a private file and writes them back when it creates the context again. Session cookies are kept too: a profile is a browser that never quits.                                                                                 |
| Unit          | The workspace. Agents open tabs with `browser_new_tab`, which names no profile, so the choice has to live where both people and agents open tabs. A tab keeps the profile it opened in.                                                                                                                           |
| Shared        | The default. A workspace with no choice behaves as before this change, and the daemon never writes cookies into the Shared profile.                                                                                                                                                                               |
| Import source | Text the client sends: a JSON cookie export or a Netscape `cookies.txt`. The daemon runs in a container, so the owner's browser profile is on another machine and its cookie database cannot be read. The other source is the Shared profile, for the sites the person names: the logins already made over noVNC. |
| Cookie values | They go from the client to the daemon and from the daemon to Chromium. No response, event or log line carries a value. An import answers with counts and site names.                                                                                                                                              |
| Packaging     | Fork core, next to the pane. Gate: `server_info.features.cdpBrowserProfiles`.                                                                                                                                                                                                                                     |
| Permissions   | Listing needs `workspace.read`. Create, delete, assign and import need `workspace.write`, as opening a tab does.                                                                                                                                                                                                  |
| Limits        | 12 profiles. A name is 1 to 40 characters and unique without regard to case. Import text is at most 1 MiB and 5,000 cookies.                                                                                                                                                                                      |

## Components

### Server: `packages/server/src/server/browser-tools/cdp/profiles/`

- `profile-store.ts`: `$PASEO_HOME/browser-tools/cdp-profiles.json` holds the profiles
  (`id`, `name`, `createdAt`, the last known `contextId`) and the workspace to profile map. Written
  atomically, like the tab registry.
- `cookie-vault.ts`: one file per profile under `$PASEO_HOME/browser-tools/cdp-profiles/`, mode
  0600 in a 0700 folder. It holds the cookies as `Storage.setCookies` takes them.
- `cookie-file.ts`: turns import text into cookies. It reads a JSON array, a JSON object with a
  `cookies` array (a Playwright storage state) and Netscape lines. A cookie Chromium would refuse
  is counted as skipped: `Storage.setCookies` fails the whole batch on one bad entry.
- `profiles.ts`: the running part. It maps a profile to its live context, creates the context and
  restores the vault when the context is gone, saves cookies, imports and deletes.
- `profile-session.ts`: the `browser.cdp.profile.*` handlers, which map every failure to a code.
- `CdpBrowserService` asks it for the workspace's context in `openTab`, records `profileId` on the
  tab's registry entry, gives a popup its opener's profile, and reports `profile` in the tab state.
- The tab registry entry gains an optional `profileId`.

### When cookies are saved

- Every 30 s for each profile with an open tab, when the cookies changed.
- When a tab of the profile closes, on import, and when the daemon stops.

A Chromium that dies loses at most the last 30 s of cookie changes.

### When a context is created

At the first tab opened in the profile after the daemon or Chromium started, and on import. At
connect the daemon asks `Target.getBrowserContexts` and keeps a stored `contextId` only when
Chromium still has it, so a daemon restart finds the contexts its open tabs live in. Before each
use it checks the same list again: headful Chromium may drop a context whose last window closed.

### Protocol

All new, all optional for old peers:

- `browser.cdp.profile.list.request { workspaceId? }` → profiles and the workspace's profile id.
- `browser.cdp.profile.create.request { name }` → the profile.
- `browser.cdp.profile.delete.request { profileId }`.
- `browser.cdp.profile.assign.request { workspaceId, profileId | null }`; null is Shared.
- `browser.cdp.profile.import.request { profileId, source }`, where `source` is
  `{ kind: "text", text }` or `{ kind: "shared", sites }` → `{ imported, skipped, sites, siteCount }`.
- The tab state gains `profile: { id, name } | null`, optional.
- Error codes: `browser_profile_not_found`, `browser_profile_name_invalid`,
  `browser_profile_name_taken`, `browser_profile_limit`, `browser_cookies_unreadable`,
  `browser_cookies_none`, `browser_cookies_too_large`.

### App

- The pane toolbar gets a profile button. It names the tab's profile, shows as selected when the
  tab is in a named profile, and opens one sheet.
- The sheet's first page has the choice for the workspace's new tabs, the named profiles with
  "Import cookies" and "Delete" (after a confirmation), and a field to add one. When the tab is in
  another profile than the one chosen, the page says the tab stays where it is.
- "Import cookies" is a second page of the same sheet: a cookie file, chosen or pasted, or the
  Shared profile for the sites typed. It shows what the import did.
- The sheet's state is a plain model (`profile-manager.ts`), made fresh at each open.

## Data flow

Open: workspace → profile id → context (created and restored when missing) →
`Target.createTarget { browserContextId }`. A workspace on Shared sends no `browserContextId`.

Import from text: client reads the file → request → parse and validate → `Storage.setCookies` in
one batch, and one by one when the batch fails → read back with `Storage.getCookies` to count what
Chromium kept → save the vault → counts.

Import from Shared: `Storage.getCookies` with no context → keep the cookies whose domain is a
named site or under it → the same write path.

Delete: the profile leaves the store, so its workspaces go back to Shared →
`Target.disposeBrowserContext`, which closes its tabs → delete the vault file.

## Errors and edge cases

- Chromium unreachable: every profile call answers `browser_no_host`, except list, create and
  assign, which need no Chromium.
- A vault file that does not parse is logged, and the profile starts with no cookies.
- A cookie that expired is not restored.
- Deleting a profile while its context is being made: the new context is disposed, and the caller
  that asked for it gets `browser_profile_not_found`.
- Two instances on one Chromium: each daemon has its own profiles and contexts. A context is not
  shared between daemons.

## Security

The vault holds session cookies in plain text, as the Chromium's own profile volume does. It sits
in `$PASEO_HOME`, which already holds provider credentials, with owner-only file modes. Copying
from Shared needs `workspace.write`, which already lets its holder drive Shared tabs.

## Testing

- Unit: cookie file formats and refusals, the vault's modes and round trip, the store's limits and
  names, and the running part against the fake Chromium, which gains contexts and cookie storage:
  open in a profile, restore after a restart, a dropped context, import counts, delete.
- Live, on the dev daemon against a private headless Chromium: two workspaces signed in to one
  local site as two users, an agent-free check of the toolbar and the sheet at 1280, 820 and 390,
  import from a file, and cookies that survive a Chromium restart.
