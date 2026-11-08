# Resource Manager — design

Date: 2026-11-06. Status: approved design; not yet planned.

## Problem

When an instance runs out of memory, nothing in Paseo shows where the memory went. Finding out means
a shell, `ps`, and summing process trees by hand, which is how the 2026-11-06 measurements were
made: about 770 MB per Claude agent, half of it MCP servers. One instance also reaches remote
servers through ssh-mcp, and their load is equally invisible from Paseo.

## Scope

In scope:

- A screen showing this instance's memory and CPU per agent, with a way to close an idle agent's
  runtime.
- One page per server reachable through ssh-mcp, read-only.

Out of scope: history graphs, alerts, actions on remote servers, and servers not configured in
ssh-mcp.

## Decisions

| Question            | Decision                                                                                                                                                                                 |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Remote metrics      | The plugin is an MCP client of each ssh-mcp entry and calls its exec tool with one fixed read-only command. It stores no credentials.                                                    |
| Server list         | Every MCP entry, in the Claude configs the daemon can read (user and local scope, and `.mcp.json` in folders Claude Code trusts), whose command runs `ssh-mcp`. One entry is one server. |
| No ssh-mcp          | Only the server tabs are hidden. The instance tab always shows.                                                                                                                          |
| Agent attribution   | A process belongs to the agent named by `PASEO_AGENT_ID` in its `/proc/<pid>/environ`; children inherit it, so MCP servers count against their agent.                                    |
| Close               | Ends the agent's runtime only. The agent stays, and its next prompt resumes it.                                                                                                          |
| Other plugins' data | The shared MCP and heavy-command gate plugins keep their own screens. This one only totals their processes as groups.                                                                    |

## Surface

A **Resources** sidebar item opens a screen with tabs: **This instance**, then one tab per ssh-mcp
server.

### This instance

- Header: container memory against its cap (`memory.current` and `memory.max`), swap, host
  `MemAvailable`, and load against the core count.
- One row per Paseo agent: title, provider, total RSS including its children, CPU %, idle time, and
  **Close**.
- Group rows for the daemon, the shared MCP servers, commands held by the heavy-command gate, and
  everything else.
- Refreshes every 5 s while open.

### Server tab

- Memory and swap used against total, load against core count, disk use per mount, and the top 10
  processes by RSS.
- The time of the last reading. An unreachable host or a host without `/proc` shows an error state
  with ssh-mcp's message.
- Polls every 30 s while the tab is open. The MCP client session closes after 2 minutes with the
  tab closed.

## Components

`plugins/resource-manager/`:

- `shared/`: RPC contracts.
- `server/local/`: `/proc` and cgroup readers and the process-to-agent mapping. The process-group
  RSS reader is shared with the shared MCP plugin's.
- `server/remote/`: ssh-mcp discovery, the MCP client sessions, and the parsers for the remote
  output.
- `index.client.tsx` and `client/`: the sidebar item and the screen.

RPCs: `resource-manager.local.request`, `resource-manager.servers.request` (the discovered list),
`resource-manager.server.request` (one server's reading), and `resource-manager.close_agent.request`.

## Safety

The remote command is a constant in the plugin code and takes no input. The plugin never writes to a
remote server. Close acts on local agents only and goes through the Paseo SDK, so it follows the same
permission checks as closing an agent from the app.

## Testing

- Unit: parsers for `meminfo`, `loadavg`, `df -P`, and `ps` output from real samples; the
  process-to-agent mapping over a fake `/proc` tree; ssh-mcp discovery from config fixtures, including
  entries that are not ssh-mcp.
- Integration: a fake ssh-mcp stdio server that answers the exec tool with canned output.
- Manual: on the instance with ssh-mcp, the server tabs appear and show live numbers. On this
  instance, only the instance tab shows. Close on an idle agent frees its memory, and its next prompt
  resumes it.
