# Claude accounts — design

Date: 2026-11-06. Status: approved design; not yet planned. Builds on
[session move](2026-11-05-session-move-design.md) and
[usage heads-up](2026-11-06-usage-heads-up-design.md).

## Problem

A second Claude login works today, but only by hand: create `~/.claude-work`, run
`CLAUDE_CONFIG_DIR=~/.claude-work claude /login` in a shell, add a provider entry that extends
`claude` with that variable, and copy settings, skills, hooks, and MCP servers across so the second
account behaves like the first. New agents always start on whichever provider was picked, even when
that account is nearly used up, and moving several agents off a full account is one move at a time.

## Scope

In scope:

- An accounts screen listing every Claude profile with its login, usage, and running agents.
- Adding an account from Paseo, with the main profile's setup shared into it.
- A default account for new Claude agents, including an automatic pick by headroom.
- Moving all idle agents from one account to another.

Out of scope: Codex and other providers' accounts, removing an account's files, and moving agents
in the middle of a turn.

## Decisions

| Question           | Decision                                                                                                                                                                                                                                                           |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Form               | A built-in fork plugin, `plugins/claude-accounts/`, plus `move()` on the client SDK's agent handle.                                                                                                                                                                |
| What an account is | A profile directory (`~/.claude` or `~/.claude-<name>`) and, apart from the main one, a provider `claude-<name>` that extends `claude` with `CLAUDE_CONFIG_DIR`.                                                                                                   |
| Shared setup       | Linked from `~/.claude`: `settings.json`, `CLAUDE.md`, `skills/`, `plugins/`, `commands/`, `agents/`. Copied and kept in sync: the user-scope `mcpServers` in the profile's `.claude.json`. Separate per account: credentials, `projects/` (transcripts), history. |
| Existing files     | Linking never overwrites. A file that already exists in the profile is reported on the screen and left alone.                                                                                                                                                      |
| Default account    | A specific account, or Auto. It applies only when an agent is created with the plain `claude` provider; an explicit account is kept.                                                                                                                               |
| Auto               | The signed-in account with the lowest `usedPct` in its tightest window, skipping accounts at 95% or more. With none left, the plain `claude` provider is kept.                                                                                                     |
| Moving agents      | Only idle agents move, natively and without continuing. Agents in a turn are skipped and counted.                                                                                                                                                                  |

## Components

`plugins/claude-accounts/`:

- `shared/`: settings (default account) and RPC contracts.
- `server/profiles.ts`: profile discovery and login state (the credential file's presence and the
  usage source's account label).
- `server/setup-link.ts`: computes the link, copy, and keep plan for a profile and applies it; it
  also watches the main profile's `mcpServers` and copies changes into every account.
- `server/default-account.ts`: the `agent.create.before` hook and the Auto choice, reading usage
  through `paseo.providers.listUsage`.
- `server/move-idle.ts`: moves an account's idle agents through the new SDK `move()`.
- `index.client.tsx` and `client/`: the accounts screen and a sidebar item.

In `packages/client`: `PaseoAgentHandle.move({ to, continueWork })`, calling the existing
`agent.move` RPC. The SDK checks `server_info.features.agentMove` and throws a clear error on hosts
without it.

## Accounts screen

One row per profile: label (email or directory name), plan, the tightest window's usage, signed-in
state, running agents, and setup-link problems if any. Actions: **Add account**, **Sign in** (for a
profile without a login), and **Move idle agents to…**. The default account picker sits at the top.

**Add account** asks for a name, creates `~/.claude-<name>`, applies the setup-link plan, patches
the provider into the daemon config, and opens a Paseo terminal running
`CLAUDE_CONFIG_DIR=~/.claude-<name> claude /login`. The row switches to signed in when the credential
file appears.

## Testing

- Unit: profile discovery; the setup-link plan (link, copy, and keep sets; an existing file is never
  overwritten); the Auto choice (headroom, skipping expired logins and accounts at 95% or more,
  falling back to `claude`, keeping an explicit account); the idle-agent selection for a move.
- Integration: Add account in a temp home creates the directory and links, patches the provider, and
  copies `mcpServers`; a change to the main profile's `mcpServers` reaches the account.
- Manual: add a second Claude login and check that its first prompt sees the same skills and hooks;
  with Auto on, a new agent lands on the emptier account; move idle agents between accounts and
  resume one.
