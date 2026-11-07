# Claude accounts — design

Date: 2026-11-06. Status: approved design, amended on 2026-11-07 with the user's answers to the
plan's open questions. Builds on [session move](2026-11-05-session-move-design.md) and
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

| Question           | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Form               | A built-in fork plugin, `plugins/claude-accounts/`, plus `move()` on the client SDK's agent handle.                                                                                                                                                                                                                                                                                                                                          |
| What an account is | A profile directory (`~/.claude` or `~/.claude-<name>`) and, apart from the main one, a provider `claude-<name>` that extends `claude` with `CLAUDE_CONFIG_DIR`.                                                                                                                                                                                                                                                                             |
| Shared setup       | Linked from `~/.claude`: `settings.json`, `CLAUDE.md`, `skills/`, `plugins/`, `commands/`, `agents/`. Copied and kept in sync: the user-scope `mcpServers` in the `.claude.json` of each account Paseo added, which it records in `$PASEO_HOME/claude-accounts/added.json`; a profile made by hand shows a problem and gets nothing until it is added under its name. Separate per account: credentials, `projects/` (transcripts), history. |
| Existing files     | Linking never overwrites. A file that already exists in the profile is reported on the screen and left alone.                                                                                                                                                                                                                                                                                                                                |
| Default account    | A specific account, or Auto. It applies only when an agent is created with the plain `claude` provider; an explicit account is kept. A move to plain `claude` from the Move dialog or the CLI that falls back to a history handoff creates its successor through the same choice; a move the plugin itself makes to plain `claude` keeps plain `claude`.                                                                                     |
| Auto               | The signed-in account with the lowest `usedPct` in its tightest window, skipping accounts whose tightest window has the usage heads-up's `danger` tone: 95% or more, or on pace to run out within 30 minutes. The daemon picks the tightest window with the heads-up's ranking and sends its tone. An account with unknown usage is never picked. With none left, the plain `claude` provider is kept.                                       |
| Moving agents      | Only idle agents move, without continuing: natively, or through a history handoff when the daemon cannot move one natively, which the job counts. Agents in a turn are skipped and counted.                                                                                                                                                                                                                                                  |

## Components

`plugins/claude-accounts/`:

- `shared/`: settings (default account) and RPC contracts.
- `server/profiles.ts`: profile discovery and login state: signed in when the credential file
  exists or the usage source reports a login for the account's provider, expired when no report is
  available and one says the login expired or was rejected.
- `server/setup-link.ts`: computes the link, copy, and keep plan for a profile and applies it; it
  also watches the main profile's `mcpServers` and copies changes into every account Paseo added.
- `server/default-account.ts`: the `agent.create.before` hook and the Auto choice, reading each
  account's usage through `paseo.providers.listUsageForProvider`.
- `server/move-idle.ts`: moves an account's idle agents through the new SDK `move()`.
- `index.client.tsx` and `client/`: the accounts screen and a sidebar item.

In `packages/client`: `PaseoAgentHandle.move({ to, continueWork })`, calling the existing
`agent.move` RPC. The SDK checks `server_info.features.agentMove` and throws a clear error on hosts
without it.

Also in `packages/client`: `paseo.providers.listUsageForProvider(provider)`, calling a new daemon
RPC, `usage.provider.list_reports`, that reads one provider's usage through its launch scope, the
way the Move dialog reads a target's. It returns the reports and the tightest window with its
heads-up tone, and the SDK gates it on `server_info.features.usageProviderReports`. The host-wide
`paseo.providers.listUsage` cannot serve here: its entries name the usage source, not a Paseo
provider, and it is tagged for removal.

## Accounts screen

One row per profile: label (the account's name, or "Main account"; never an email), plan, the
tightest window's usage, signed-in state, running agents, and setup-link problems if any. Actions:
**Add account**, **Sign in** (for a profile without a login), and **Move idle agents to…**. The
default account picker sits at the top.

**Add account** asks for a name, creates `~/.claude-<name>`, applies the setup-link plan, patches
the provider into the daemon config, and opens a Paseo terminal in the most recent workspace
running `CLAUDE_CONFIG_DIR=~/.claude-<name> claude auth login`, which signs in without starting a
chat session. Adding the name of an existing `~/.claude-<name>` adopts it. The row switches to
signed in when the credential file appears or the usage source reports the login.

## Testing

- Unit: profile discovery; the setup-link plan (link, copy, and keep sets; an existing file is never
  overwritten); the daemon's tightest window (a 60% window that runs out in 20 minutes ranks above
  a 75% one that will not); the Auto choice (headroom, skipping expired logins and accounts with
  the `danger` tone, at 95% or more or on pace to run out within 30 minutes, never picking an
  account with unknown usage, falling back to `claude`, keeping an explicit account); the
  idle-agent selection for a move.
- Integration: Add account in a temp home creates the directory and links, patches the provider
  through a fake Paseo port, and copies `mcpServers`; a change to the main profile's
  `mcpServers` reaches the account. The real config patch first runs when the accounts roll out
  on a host.
- Manual: skipped by the user on 2026-11-07. A second login's skills and hooks, Auto's pick and a
  move between accounts are first seen when the accounts roll out on a host.
