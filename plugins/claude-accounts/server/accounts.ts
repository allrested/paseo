import { mkdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import type { Account, AccountList, ActionResult, MoveIdleResult } from "../shared/rpc.js";
import { MAIN_PROVIDER, accountProvider } from "../shared/settings.js";
import type {
  AccountsApi,
  AgentInfo,
  ProviderEntry,
  ProviderState,
  ProviderUsage,
  TerminalCommand,
} from "./api.js";
import {
  DECIDE_TIMEOUT_MS,
  chooseCreateProvider,
  summarizeUsage,
  type AccountHeadroom,
  type CreateRequest,
  type UsageSummary,
} from "./default-account.js";
import { errorCode, errorMessage } from "./errors.js";
import { watchMcpServers, type SyncTarget } from "./mcp-sync.js";
import { MoveIdleRunner, isIdle } from "./move-idle.js";
import {
  accountDirectory,
  claudeConfigFile,
  discoverProfiles,
  hasCredentials,
  isMainDirectory,
  readAddedAccounts,
  recordAddedAccount,
  type Profile,
  type ProfilePaths,
} from "./profiles.js";
import { applySetupLink, planSetupLink, setupProblems, type SetupStep } from "./setup-link.js";

export interface ClaudeAccountsOptions {
  paths: ProfilePaths;
  platform: NodeJS.Platform;
  /** The saved default account, or null when the stored setting is invalid. */
  readDefaultAccount(): Promise<string | null>;
  logError(message: string, error: unknown): void;
  /** How often the MCP sync runs; 5 s unless a test sets it. */
  syncIntervalMs?: number;
}

export interface ClaudeAccounts {
  list(api: AccountsApi): Promise<AccountList>;
  add(api: AccountsApi, name: string): Promise<ActionResult>;
  signIn(api: AccountsApi, provider: string): Promise<ActionResult>;
  moveIdle(api: AccountsApi, from: string, to: string): Promise<MoveIdleResult>;
  /** The provider for an `agent.create.before` request. Never rejects. */
  beforeCreate(api: AccountsApi, request: CreateRequest): Promise<string>;
  /** Runs an MCP sync pass after the one in flight. */
  syncNow(): Promise<void>;
  stop(): Promise<void>;
}

type SignInTarget = Pick<Profile, "name" | "directory" | "viaEnv">;

interface ViewOptions {
  /** One provider's profile, or every profile when null. */
  only: string | null;
  withAgents: boolean;
}

interface ProfileView {
  account: Account;
  headroom: AccountHeadroom;
}

interface ProfileViews {
  views: ProfileView[];
  usageError: string | null;
}

interface ProfileFacts {
  profile: Profile;
  entry: ProviderEntry | null;
  state: ProviderState | null;
  usage: ProviderUsage | null;
  links: readonly SetupStep[];
  syncProblem: string | null;
  agents: readonly AgentInfo[];
}

const SYNC_INTERVAL_MS = 5_000;
const MAIN_LABEL = "Main account";
const HAND_MADE_PROBLEM =
  "Paseo did not add this account, so it shares nothing with the main account. Add it again under the same name to share the main account's setup.";
const NO_WORKSPACE = "Open a project first. The sign-in terminal runs in a workspace.";
// PARENT_SESSION_ENV_VARS in packages/server/src/server/agent/provider-launch-config.ts: a daemon
// started from a Claude Code session carries these, and `claude` refuses to start under them.
const PARENT_SESSION_ENV_VARS = [
  "CLAUDECODE",
  "CLAUDE_CODE_ENTRYPOINT",
  "CLAUDE_CODE_SSE_PORT",
  "CLAUDE_AGENT_SDK_VERSION",
];
const NO_USAGE: UsageSummary = { known: false, expired: false, usage: null, tone: null };
const NO_AGENTS: AgentInfo[] = [];

export function createClaudeAccounts(options: ClaudeAccountsOptions): ClaudeAccounts {
  const { paths } = options;
  const runner = new MoveIdleRunner((error) =>
    options.logError("claude-accounts: moving idle agents failed", error),
  );
  const watcher = watchMcpServers({
    targets: () => syncTargets(paths),
    intervalMs: options.syncIntervalMs ?? SYNC_INTERVAL_MS,
    logError: options.logError,
  });
  // Adds run one after another, so two presses cannot interleave their writes.
  let adding: Promise<unknown> = Promise.resolve();

  async function viewProfiles(api: AccountsApi, view: ViewOptions): Promise<ProfileViews> {
    const added = await readAddedAccounts(paths.recordFile);
    const { main, accounts } = await discoverProfiles(paths, added);
    const profiles = [main, ...accounts].filter(
      (profile) => view.only === null || profile.provider === view.only,
    );
    const [entries, states, agents] = await Promise.all([
      api.providerEntries(),
      api.providerStates(),
      view.withAgents ? api.listAgents() : NO_AGENTS,
    ]);
    // A provider the host does not know has no launch scope, so its usage is not asked for.
    const usages = await Promise.all(
      profiles.map((profile) =>
        states.has(profile.provider) ? api.listUsage(profile.provider) : null,
      ),
    );
    const views: ProfileView[] = [];
    for (const [index, profile] of profiles.entries()) {
      views.push(
        describeProfile({
          profile,
          entry: entries.get(profile.provider) ?? null,
          state: states.get(profile.provider) ?? null,
          usage: usages[index] ?? null,
          links: profile.added ? await planSetupLink(paths.mainDirectory, profile.directory) : [],
          syncProblem: profile.added ? watcher.problem(profile.provider) : null,
          agents: agents.filter((agent) => agent.provider === profile.provider),
        }),
      );
    }
    return { views, usageError: usages.find((usage) => usage?.error)?.error ?? null };
  }

  async function addAccount(api: AccountsApi, name: string): Promise<ActionResult> {
    if (options.platform === "win32") return failure("Adding accounts needs macOS or Linux");
    const directory = accountDirectory(paths.home, name);
    const provider = accountProvider(name);
    if (await isMainDirectory(paths, directory)) {
      return failure(`${directory} is the main account's directory. Pick another name.`);
    }
    const entry = (await api.providerEntries()).get(provider) ?? null;
    if (entry !== null && !launchesDirectory(entry, directory)) {
      return failure(
        `${provider} already exists in the host config with other settings. Remove it or pick another name.`,
      );
    }
    await makeAccountDirectory(directory);
    await applySetupLink(await planSetupLink(paths.mainDirectory, directory), directory);
    await recordAddedAccount(paths.recordFile, name);
    await watcher.tick();
    if (entry === null) {
      await api.addProvider(provider, { label: `Claude (${name})`, configDirectory: directory });
    }
    if (await hasCredentials(directory)) return { ok: true, error: null, loginWorkspaceId: null };
    return signInResult(
      api,
      { name, directory, viaEnv: true },
      "The account was added, but its sign-in terminal did not open",
    );
  }

  return {
    async list(api) {
      const { views, usageError } = await viewProfiles(api, { only: null, withAgents: true });
      return { accounts: views.map((view) => view.account), usageError, moveJob: runner.current() };
    },
    add(api, name) {
      const run = adding
        .then(() => addAccount(api, name))
        .catch((error: unknown) => failure(errorMessage(error)));
      adding = run;
      return run;
    },
    async signIn(api, provider) {
      try {
        const added = await readAddedAccounts(paths.recordFile);
        const { main, accounts } = await discoverProfiles(paths, added);
        const profile = [main, ...accounts].find((candidate) => candidate.provider === provider);
        if (profile === undefined) return failure(`No account uses ${provider}`);
        return await signInResult(api, profile, "The sign-in terminal did not open");
      } catch (error) {
        return failure(errorMessage(error));
      }
    },
    async moveIdle(api, from, to) {
      if (from === to) return refusal("Pick another account to move to");
      try {
        // The RPC takes any string; only a Claude profile's agents move.
        const added = await readAddedAccounts(paths.recordFile);
        const { main, accounts } = await discoverProfiles(paths, added);
        if (![main, ...accounts].some((profile) => profile.provider === from)) {
          return refusal(`No account uses ${from}`);
        }
        const { views } = await viewProfiles(api, { only: to, withAgents: false });
        const target = views[0]?.account;
        if (target === undefined || !target.providerReady) {
          return refusal(`Agents cannot start on ${to} yet. Fix its problems first.`);
        }
        if (!target.signedIn || target.loginExpired) return refusal(`Sign in to ${to} first`);
        const started = await runner.start(api, from, to);
        return started.ok ? { ok: true, error: null, job: started.job } : refusal(started.error);
      } catch (error) {
        return refusal(errorMessage(error));
      }
    },
    beforeCreate(api, request) {
      return chooseCreateProvider(
        {
          setting: () => options.readDefaultAccount(),
          headroom: async (only) =>
            (await viewProfiles(api, { only, withAgents: false })).views.map(
              (view) => view.headroom,
            ),
          movingToMain: (cwd) => runner.movingToMain(cwd),
          onError: (error) =>
            options.logError("claude-accounts: choosing the account for a new agent failed", error),
          timeoutMs: DECIDE_TIMEOUT_MS,
        },
        request,
      );
    },
    syncNow: () => watcher.tick(),
    async stop() {
      runner.stop();
      await watcher.stop();
    },
  };
}

function describeProfile(facts: ProfileFacts): ProfileView {
  const { profile, state } = facts;
  const summary = facts.usage === null ? NO_USAGE : summarizeUsage(facts.usage);
  const entryProblems = providerProblems(profile, facts.entry);
  const providerReady = entryProblems.length === 0 && state?.status === "ready";
  const signedIn = profile.credentials || summary.known || summary.expired;
  const problems = [
    ...(profile.main || profile.added ? [] : [HAND_MADE_PROBLEM]),
    ...entryProblems,
    ...(entryProblems.length === 0 ? stateProblems(profile.provider, state) : []),
    ...setupProblems(facts.links),
    ...(facts.syncProblem === null ? [] : [facts.syncProblem]),
  ];
  const busy = facts.agents.filter((agent) => !isIdle(agent)).length;
  return {
    account: {
      provider: profile.provider,
      directory: profile.directory,
      label: profile.name ?? MAIN_LABEL,
      main: profile.main,
      signedIn,
      loginExpired: summary.expired,
      providerReady,
      usage: summary.usage,
      agents: { total: facts.agents.length, busy },
      problems,
    },
    headroom: {
      provider: profile.provider,
      usable: providerReady && signedIn && !summary.expired,
      usedPct: summary.usage?.usedPct ?? null,
      tone: summary.tone,
    },
  };
}

function providerProblems(profile: Profile, entry: ProviderEntry | null): string[] {
  const { provider } = profile;
  if (entry === null) {
    // The built-in claude provider needs no entry, and a hand-made account already says to add it.
    if (profile.main || !profile.added) return [];
    return [`No provider launches this account. Add the account again to create ${provider}.`];
  }
  if (!profile.main && entry.extends !== MAIN_PROVIDER) {
    return [`${provider} in the host config is not a Claude provider`];
  }
  if (!entry.enabled) return [`${provider} is turned off in the host config`];
  if (!launchesProfile(profile, entry)) {
    return [`${provider} in the host config does not launch this account's directory`];
  }
  return [];
}

// The main profile's entry may leave CLAUDE_CONFIG_DIR to the daemon's env.
function launchesProfile(profile: Profile, entry: ProviderEntry): boolean {
  if (entry.configDirectory === null) return profile.main;
  return resolve(entry.configDirectory) === profile.directory;
}

function launchesDirectory(entry: ProviderEntry, directory: string): boolean {
  return (
    entry.extends === MAIN_PROVIDER &&
    entry.configDirectory !== null &&
    resolve(entry.configDirectory) === directory
  );
}

function stateProblems(provider: string, state: ProviderState | null): string[] {
  if (state?.status === "error") return [state.error ?? `${provider} failed to load`];
  if (state?.status === "unavailable") {
    return [state.error ?? `${provider} is not available on this host`];
  }
  return [];
}

async function syncTargets(paths: ProfilePaths): Promise<SyncTarget[]> {
  const added = await readAddedAccounts(paths.recordFile);
  if (added.length === 0) return [];
  const { main, accounts } = await discoverProfiles(paths, added);
  const mainFile = await claudeConfigFile(main, paths.home);
  const targets: SyncTarget[] = [];
  for (const account of accounts) {
    if (!account.added) continue;
    const accountFile = await claudeConfigFile(account, paths.home);
    targets.push({ provider: account.provider, mainFile, accountFile });
  }
  return targets;
}

async function makeAccountDirectory(directory: string): Promise<void> {
  try {
    await mkdir(directory, { mode: 0o700 });
    return;
  } catch (error) {
    if (errorCode(error) !== "EEXIST") throw error;
  }
  if (!(await stat(directory)).isDirectory()) {
    throw new Error(`${directory} exists and is not a directory`);
  }
}

async function signInResult(
  api: AccountsApi,
  target: SignInTarget,
  failurePrefix: string,
): Promise<ActionResult> {
  try {
    return { ok: true, error: null, loginWorkspaceId: await openSignIn(api, target) };
  } catch (error) {
    return failure(`${failurePrefix}: ${errorMessage(error)}`);
  }
}

// A Paseo terminal needs a workspace, so the sign-in runs in the most recently active one.
async function openSignIn(api: AccountsApi, target: SignInTarget): Promise<string> {
  const workspaceId = await api.latestWorkspaceId();
  if (workspaceId === null) throw new Error(NO_WORKSPACE);
  await api.openTerminal(workspaceId, loginCommand(target));
  return workspaceId;
}

function loginCommand(target: SignInTarget): TerminalCommand {
  const args = PARENT_SESSION_ENV_VARS.flatMap((variable) => ["-u", variable]);
  if (target.viaEnv) args.push(`CLAUDE_CONFIG_DIR=${target.directory}`);
  args.push("claude", "auth", "login");
  const name = target.name === null ? "Claude sign-in" : `Claude sign-in: ${target.name}`;
  return { name, command: "env", args };
}

function failure(error: string): ActionResult {
  return { ok: false, error, loginWorkspaceId: null };
}

function refusal(error: string): MoveIdleResult {
  return { ok: false, error, job: null };
}
