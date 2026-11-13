# Design mode on FigCraft design

Date: 2026-11-13. Fork: allrested/paseo. Status: approved by the user section by section and as
written ("LGTM") on 2026-11-13.
Part of sub-project 7 (next-version brainstorm), after [the web browser pane](2026-11-10-web-browser-pane-design.md).

## Goal

You and agents design screens together in a self-hosted FigCraft, inside Paseo, on each
project's own design system, and move between design and code in both directions.

- An agent draws a screen; you watch it live, comment, and the agent revises.
- You draw a screen, select it, and send it to an agent, who builds it in the project's code.
- The project's tokens file in the repo and the design file's variables stay in step.

## What FigCraft is

[FigCraft](https://github.com/storytold/figcraft) (storytold, MIT or Apache-2.0, Rust, first
commit 2026-10-09, v0.18.1 on 2026-11-12) is an open-source interface design tool: frames, auto
layout, components and variants, vector networks, variables, prototypes. Only the storytold repo
and getartcraft.com are official; figcraft.org, figcraft.net, figcraft.app and others are
lookalikes.

What this spec relies on, read from its docs at v0.18.1:

| Part                                    | What it gives                                                                                                                                                                                                                |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `figcraft-server` (linux-aarch64 build) | Keeps files, hands out share links, hosts live sessions over plain WebSocket; TLS from a reverse proxy; a server key publishes and manages files; `web_url` makes its links open the browser build (`<web_url>#join=<link>`) |
| `figcraft-web`                          | The whole editor as WebAssembly (WebGPU or WebGL2). Joins live sessions, cannot host them. Mouse and keyboard first                                                                                                          |
| `figcraft-cli mcp`                      | MCP server over stdio with 400+ commands, headless. Ships in the Linux tarball. `--automation-read-root` / `--automation-write-root` confine its file access                                                                 |
| Live sessions                           | `collab.join`, `collab.peers` (each member's `presence.selection`, cursor, viewport), every member's edits seen by all                                                                                                       |
| Comments                                | `comment.list`, `comment.add`, `comment.prompt` (open threads as one Markdown task brief)                                                                                                                                    |
| Variables                               | `variable.import`, `variable.export` (`json`, `css`, `tailwind`)                                                                                                                                                             |
| Code                                    | `inspect.code` (React + Tailwind for a layer tree; React, Vue, SwiftUI, Compose and others for components), `codeConnect` (a component's snippet in the project's own code)                                                  |

Its own status: alpha, about 49% of the way to replacing proprietary tools by its estimate; live
sessions and the server are a preview. There are no accounts: a file's edit link is its key.

## Decisions

| Subject                | Decision                                                                                                                                                | Source                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Design system          | Each project's own, not Paseo's                                                                                                                         | user, 2026-11-13             |
| Main flow              | Both ways: agent designs and you review, you design and an agent builds                                                                                 | user                         |
| Devices                | Edit on desktop (browser or Electron); view and comment on the phone                                                                                    | user                         |
| Tokens source          | One tokens file in the repo, `design/tokens.json`, W3C design-token format. Without one, an agent drafts it from the code once and the user approves it | user                         |
| Design files           | On our figcraft-server only, not in git                                                                                                                 | user                         |
| Hosting                | One figcraft-server with its own public HTTPS domain on the Oracle VM's Dokploy                                                                         | user                         |
| Depth                  | A built-in Paseo plugin with pick to code                                                                                                               | user                         |
| Approach               | A. Daemon bridge: one headless FigCraft per open file, joined to its live session                                                                       | user                         |
| Phone view             | Images rendered by the bridge, shown with React Native views. The store app's plugin code has no WebView                                                | follows the streamed-3D spec |
| Tokens direction       | Repo wins when a file opens; FigCraft token edits are written back as an uncommitted change                                                             | this spec, shown to the user |
| Public FigCraft server | Never used: every share and publish names our server                                                                                                    | this spec, shown to the user |
| Bridge cap             | At most 3 bridges at once, configurable; idle bridges stop                                                                                              | this spec, shown to the user |

## Approaches

The user picked A.

- **A. Daemon bridge.** The plugin runs a headless `figcraft-cli mcp` per open file, joined to the
  file's live session. It reads selection and comments, renders images, syncs tokens. Agents join
  with their own `figcraft-cli mcp`. Desktop edits in the FigCraft web editor in a workspace tab.
  Each device gets the right view, and pick to code rests on data FigCraft already gives.
- **B. Everything through the browser pane.** FigCraft web in the daemon's Docker Chromium,
  streamed to every device. Reuses code, but editing lags over a picture stream, and Chromium cannot
  see a selection on FigCraft's single canvas, so pick to code would still need a bridge.
- **C. FigCraft desktop app in Docker.** The app on a virtual display, agents attached, the window
  streamed. Heaviest, one shared window, the same lag as B.

## Parts

### Host: the `figcraft` service

- A compose service on the Oracle VM's Dokploy runs `figcraft-server` (pinned version,
  linux-aarch64) with its data on a volume and `web_url` set to the browser build.
- The same domain, `figcraft.dev.mtapp.dev`, serves the static `figcraft-web` build
  under `/app/`. Dokploy's Traefik gives TLS and passes WebSocket upgrades.
- The image is built in the fork's CI from the pinned release assets, checked against the
  release's `SHA256SUMS.txt`.
- The server key lives in Dokploy's env and in each Paseo instance's env (`FIGCRAFT_SERVER_KEY`,
  with `FIGCRAFT_URL`). Never in git.
- DNS: the wildcard `*.dev.mtapp.dev` already points at the VM (user, 2026-11-13).

### Paseo: the built-in plugin `design`

1. **Designs list.** Each workspace lists the files on our server that belong to its project,
   keyed by the repo's remote URL (the plugin keeps the map in `$PASEO_HOME/design/files.json`:
   project key, file id, name, owner token, links). Actions: New, Open, Rename, Remove. A file is
   marked when it is out of step (below).
2. **Bridge.** For each open file the daemon runs one `figcraft-cli mcp` child process, joined to
   the file's live session as a member named "Paseo", confined with
   `--automation-read-root`/`--automation-write-root` to the workspace's `design/` folder. It reads
   presence, selection and comments, renders pages and syncs tokens. It starts when a viewer or an
   agent opens the file and stops 5 minutes after the last one leaves.
3. **Tokens sync.** On open, imports `design/tokens.json` into the file's variables. When tokens
   change in FigCraft, writes the changed tokens to `design/tokens.json` in the workspace,
   uncommitted, and posts a notice in the workspace.
4. **Agent tools.** Claude sessions in the workspace get FigCraft's MCP server
   (`figcraft-cli mcp`, confined to `design/`) through the shared-mcp plugin, and one Paseo tool,
   `design_join {file?}`, that creates the file when needed, starts the bridge and returns the edit
   link for the agent's `collab.join`. The link goes only to that agent.
5. **Views.**
   - Desktop and web: a workspace tab with the FigCraft web editor joined to the file (iframe in a
     browser, webview in Electron), opened at `<web_url>#join=<edit link>`.
   - Phone (store app): a live image of the current page, rendered by the bridge, refreshed when the
     file changes. Tap to add a comment at that point; a list of open threads below the image.
6. **Pick to code.** On desktop, "Send to agent" in the tab's toolbar takes your current FigCraft
   selection (from the bridge's `collab.peers`), the code export for it and your note, and sends
   them to the workspace's agent as one prompt. On the phone, the same from a comment thread.

## How work moves

### Agent designs, you review

1. You ask an agent in a workspace for a screen design.
2. The agent calls `design_join`; the plugin creates the file on our server when needed, starts the
   bridge and returns the edit link.
3. The agent joins with `figcraft-cli mcp` and draws with the variables the bridge imported from
   `design/tokens.json`. On desktop you watch it live; on the phone the image refreshes.
4. You comment, on the canvas on desktop or by tapping the image on the phone. The bridge turns new
   threads into one prompt for the agent (`comment.prompt`), at most one per agent turn. The agent
   fixes, replies and resolves.

### You design, the agent builds

1. You draw on desktop, select a frame or layers, press "Send to agent" and add a note ("build
   this").
2. The bridge sends the agent the selection's layer ids, page and file, the code export for it
   (`codeConnect` snippets where components are mapped, otherwise React + Tailwind from the
   variables) and a rendered picture of it.
3. The agent writes the code in the repo in the project's own stack, with the export as a
   reference, not pasted.

### Tokens both ways

- Open: the repo's tokens file goes into the file's variables. The repo wins.
- Token edits in FigCraft: written to `design/tokens.json` as an uncommitted change, with a notice.
  Nothing is committed for you.

### Out of step

The Designs list marks a file when its variables differ from the repo's tokens file, and lists the
components with no `codeConnect` mapping. Mapping them is a task you can give an agent.

## Security

- The domain is public and FigCraft has no accounts, so a file's edit link is its key. Links stay
  in the daemon: given only to agents in that workspace and to your editor tab, never shown in
  chat, logs, the phone view or a client message other than the editor tab's.
- The server key stays in env; only the plugin uses it, to publish and manage files. It never
  reaches an agent or a client.
- Bridge and agent FigCraft processes may read and write only the workspace's `design/` folder.
- FigCraft's public server (`collab.craftapps.dev`) is never used: every share and publish names
  our server.

## Failures

| What                                    | What happens                                                                                                                                                      |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server down                             | The Designs list says so; open phone views keep their last image; agents get a tool error that names the server as unreachable. No retry loop                     |
| Bridge crash                            | Restarted once. A second crash marks the file "Bridge stopped" with the error in the plugin log. The bridge is a child process, so it never takes the daemon down |
| Agent edit lost on a dropped connection | FigCraft does not replay it; the agent re-reads the file before retrying, as FigCraft's docs require                                                              |
| Bad tokens file                         | Import refused with the reason; the file keeps its variables; nothing written back                                                                                |
| More than 3 open files                  | The fourth waits with "Too many open designs" until a bridge stops                                                                                                |

## Limits

- Phone: view and comment only.
- FigCraft is alpha. One version is pinned and upgraded on purpose, each upgrade through the real
  FigCraft test below.
- Live sessions are FigCraft's preview. Server data is on one volume with no backup until the user
  asks for one.
- Each open file costs one headless FigCraft process; bridges stop when idle, at most 3 at once.

## Testing

- **Unit (vitest, in the plugin)** against a fake FigCraft MCP process speaking the same JSON-RPC
  over stdio: tokens conversion (W3C file to FigCraft variables and back), the files map per
  project, bridge lifecycle (start, idle stop, one restart, the cap), comment-to-prompt batching,
  the Send to agent payload, and a check that no link appears in any log line or client message
  except the editor tab's.
- **One real FigCraft test (CI, linux-x64)** with the pinned `figcraft-cli` and `figcraft-server`:
  publish a file, join as two members, edit as one and read the change and the selection as the
  other, import a tokens file, export and render. It proves the bridge's assumptions and fails
  loudly when an upgrade changes them.
- **App:** the Designs list, the editor tab and the phone image view in the harness, at phone width
  first, then tablet and desktop.
- **Manual, on a dev daemon before release:** a real server in Docker, one agent, about 10 turns.
  The agent designs a card from a sample project's tokens; you comment on the phone and the agent
  fixes it; you Send to agent from desktop and code lands in the repo; a token edit in FigCraft
  shows as an uncommitted change. The agent turns need the user's yes at that time.

## Deploy

The `figcraft` compose service goes on the Oracle VM's Dokploy at `figcraft.dev.mtapp.dev`; the
plugin ships with the next fork tag.

## Out of scope

- Editing on the phone or tablet.
- Design files in git.
- Paseo's own design system as a default for projects without a tokens file.
- Backups of the server's volume.
- FigCraft plugins.
