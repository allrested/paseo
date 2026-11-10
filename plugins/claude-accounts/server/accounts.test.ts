import { mkdir, mkdtemp, readFile, readlink, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Account, ActionResult, MoveJob } from "../shared/rpc.js";
import { createClaudeAccounts, type ClaudeAccounts } from "./accounts.js";
import type {
  AccountsApi,
  AgentInfo,
  MoveOutcome,
  NewProvider,
  ProviderEntry,
  ProviderState,
  ProviderUsage,
  TerminalCommand,
  UsageReportEntry,
  UsageTone,
} from "./api.js";
import type { CreateRequest } from "./default-account.js";
import { profilePaths } from "./profiles.js";

/** A user-scope MCP server as Claude Code stores it; the plugin copies these as opaque JSON. */
interface McpServerFixture {
  type: string;
  url: string;
}

const READY: ProviderState = { status: "ready", error: null };
const NO_USAGE: ProviderUsage = { reports: [], tightest: null, error: null };
const SERVERS: Record<string, McpServerFixture> = {
  context7: { type: "http", url: "http://127.0.0.1:8932/mcp" },
};
const HAND_MADE =
  "Paseo did not add this account, so it shares nothing with the main account. Add it again under the same name to share the main account's setup.";

interface OpenedTerminal {
  workspaceId: string;
  command: TerminalCommand;
}

interface AddedProvider {
  provider: string;
  entry: NewProvider;
}

class FakeApi implements AccountsApi {
  agents: AgentInfo[] = [];
  workspaceId: string | null = "ws-1";
  readonly entries = new Map<string, ProviderEntry>();
  readonly states = new Map<string, ProviderState>([["claude", READY]]);
  readonly usage = new Map<string, ProviderUsage>();
  readonly added: AddedProvider[] = [];
  readonly removed: string[] = [];
  readonly terminals: OpenedTerminal[] = [];
  readonly moves: string[] = [];
  /** Each move waits for it, so a test can hold a move job open. */
  moveGate: Promise<void> = Promise.resolve();
  removeError: Error | null = null;
  /** Runs while the provider is removed, after the plugin's checks and before its other writes. */
  onRemoveProvider: () => Promise<void> = async () => undefined;

  async listAgents(): Promise<AgentInfo[]> {
    return this.agents;
  }

  async getAgent(agentId: string): Promise<AgentInfo | null> {
    return this.agents.find((candidate) => candidate.id === agentId) ?? null;
  }

  async moveAgent(agentId: string, provider: string): Promise<MoveOutcome> {
    await this.moveGate;
    this.moves.push(`${agentId}->${provider}`);
    return { agentId: `${agentId}-next`, strategy: "native" };
  }

  async listUsage(provider: string): Promise<ProviderUsage> {
    return this.usage.get(provider) ?? NO_USAGE;
  }

  async providerEntries(): Promise<Map<string, ProviderEntry>> {
    return new Map(this.entries);
  }

  async providerStates(): Promise<Map<string, ProviderState>> {
    return new Map(this.states);
  }

  async addProvider(provider: string, entry: NewProvider): Promise<void> {
    this.added.push({ provider, entry });
    this.entries.set(provider, {
      extends: "claude",
      enabled: true,
      configDirectory: entry.configDirectory,
    });
    this.states.set(provider, READY);
  }

  async removeProvider(provider: string): Promise<void> {
    if (this.removeError !== null) throw this.removeError;
    await this.onRemoveProvider();
    this.removed.push(provider);
    this.entries.delete(provider);
    this.states.delete(provider);
  }

  async latestWorkspaceId(): Promise<string | null> {
    return this.workspaceId;
  }

  async openTerminal(workspaceId: string, command: TerminalCommand): Promise<void> {
    this.terminals.push({ workspaceId, command });
  }
}

interface SavedSetting {
  value: string | null;
}

interface Setup {
  home: string;
  main: string;
  accounts: ClaudeAccounts;
  api: FakeApi;
  saved: SavedSetting;
}

const services: ClaudeAccounts[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function setup(platform: NodeJS.Platform = "linux"): Promise<Setup> {
  const home = await mkdtemp(join(tmpdir(), "claude-accounts-"));
  roots.push(home);
  const main = join(home, ".claude");
  await mkdir(join(main, "skills"), { recursive: true });
  await mkdir(join(main, "plugins"));
  await writeFile(join(main, "settings.json"), "{}");
  await writeFile(
    join(main, ".claude.json"),
    JSON.stringify({ numStartups: 4, mcpServers: SERVERS }),
  );
  const saved: SavedSetting = { value: "claude" };
  const accounts = createClaudeAccounts({
    paths: profilePaths({ CLAUDE_CONFIG_DIR: main, PASEO_HOME: join(home, "paseo-home") }, home),
    platform,
    readDefaultAccount: async () => saved.value,
    logError: (message, error) => {
      throw new Error(`${message}: ${String(error)}`);
    },
    syncIntervalMs: 60_000,
  });
  services.push(accounts);
  return { home, main, accounts, api: new FakeApi(), saved };
}

function agent(id: string, provider: string, overrides: Partial<AgentInfo> = {}): AgentInfo {
  return { id, provider, cwd: "/repo", status: "idle", inTurn: false, ...overrides };
}

function usageEntry(report: UsageReportEntry["report"]): UsageReportEntry {
  return {
    id: "claude:test",
    account: {},
    fetchedAt: "2026-11-06T00:00:00.000Z",
    sourceId: "claude",
    sourceLabel: "Claude",
    report,
  };
}

function usageAt(usedPct: number, tone: UsageTone): ProviderUsage {
  return {
    reports: [
      usageEntry({ status: "available", windows: [{ id: "weekly", label: "Weekly", usedPct }] }),
    ],
    tightest: { label: "Weekly", usedPct, resetsAt: null, tone },
    error: null,
  };
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

describe("adding an account", () => {
  it("shares the main setup, adds its provider and opens its sign-in terminal", async () => {
    const { home, main, accounts, api } = await setup();
    const account = join(home, ".claude-work");

    expect(await accounts.add(api, "work")).toEqual({
      ok: true,
      error: null,
      loginWorkspaceId: "ws-1",
    });

    expect((await stat(account)).mode & 0o777).toBe(0o700);
    expect(await readlink(join(account, "settings.json"))).toBe(join(main, "settings.json"));
    expect(await readlink(join(account, "skills"))).toBe(join(main, "skills"));
    expect(await readlink(join(account, "plugins"))).toBe(join(main, "plugins"));
    expect(await readJson(join(account, ".claude.json"))).toEqual({ mcpServers: SERVERS });
    expect(await readJson(join(home, "paseo-home", "claude-accounts", "added.json"))).toEqual({
      version: 1,
      names: ["work"],
    });
    expect(api.added).toEqual([
      { provider: "claude-work", entry: { label: "Claude (work)", configDirectory: account } },
    ]);
    expect(api.terminals).toEqual([
      {
        workspaceId: "ws-1",
        command: {
          name: "Claude sign-in: work",
          command: "env",
          args: [
            "-u",
            "CLAUDECODE",
            "-u",
            "CLAUDE_CODE_ENTRYPOINT",
            "-u",
            "CLAUDE_CODE_SSE_PORT",
            "-u",
            "CLAUDE_AGENT_SDK_VERSION",
            `CLAUDE_CONFIG_DIR=${account}`,
            "claude",
            "auth",
            "login",
          ],
        },
      },
    ]);
  });

  it("copies a later change to the main profile's MCP servers on the next pass", async () => {
    const { home, main, accounts, api } = await setup();
    await accounts.add(api, "work");
    const changed: Record<string, McpServerFixture> = {
      ...SERVERS,
      gitlab: { type: "http", url: "http://127.0.0.1:8933/mcp" },
    };
    await writeFile(join(main, ".claude.json"), JSON.stringify({ mcpServers: changed }));

    await accounts.syncNow();

    expect(await readJson(join(home, ".claude-work", ".claude.json"))).toEqual({
      mcpServers: changed,
    });
  });

  it("opens no terminal for an account that is already signed in", async () => {
    const { home, accounts, api } = await setup();
    await accounts.add(api, "work");
    await writeFile(join(home, ".claude-work", ".credentials.json"), "{}");

    expect(await accounts.add(api, "work")).toEqual({
      ok: true,
      error: null,
      loginWorkspaceId: null,
    });
    expect(api.terminals).toHaveLength(1);
    expect(api.added).toHaveLength(1);
  });

  it("refuses a name whose provider exists with other settings, before writing anything", async () => {
    const { home, accounts, api } = await setup();
    api.entries.set("claude-team", { extends: "codex", enabled: true, configDirectory: null });

    expect(await accounts.add(api, "team")).toEqual({
      ok: false,
      error:
        "claude-team already exists in the host config with other settings. Remove it or pick another name.",
      loginWorkspaceId: null,
    });
    await expect(stat(join(home, ".claude-team"))).rejects.toThrow("ENOENT");
  });

  it("keeps the account when no workspace can run its sign-in terminal", async () => {
    const { accounts, api } = await setup();
    api.workspaceId = null;

    expect(await accounts.add(api, "work")).toEqual({
      ok: false,
      error:
        "The account was added, but its sign-in terminal did not open: Open a project first. The sign-in terminal runs in a workspace.",
      loginWorkspaceId: null,
    });
    expect(api.added).toHaveLength(1);
  });
});

describe("listing accounts", () => {
  it("shows each profile's login, usage, agents and problems, and leaves hand-made ones alone", async () => {
    const { home, main, accounts, api } = await setup();
    await accounts.add(api, "work");
    await mkdir(join(home, ".claude-old"));
    await writeFile(join(home, ".claude-old", "settings.json"), "{}");
    await writeFile(join(main, ".credentials.json"), "{}");
    api.usage.set("claude", {
      reports: [
        usageEntry({
          status: "available",
          planLabel: "Max",
          windows: [{ id: "five_hour", label: "Session", usedPct: 62 }],
        }),
      ],
      tightest: { label: "Session", usedPct: 62, resetsAt: null, tone: "none" },
      error: null,
    });
    api.usage.set("claude-work", {
      reports: [usageEntry({ status: "unavailable", problem: { kind: "rejected", status: 401 } })],
      tightest: null,
      error: null,
    });
    api.agents = [
      agent("a", "claude"),
      agent("b", "claude", { inTurn: true }),
      agent("c", "claude", { status: "closed" }),
    ];

    const expected: Account[] = [
      {
        provider: "claude",
        directory: main,
        label: "Main account",
        main: true,
        signedIn: true,
        loginExpired: false,
        providerReady: true,
        usage: { usedPct: 62, windowLabel: "Session", planLabel: "Max" },
        agents: { total: 3, busy: 1 },
        problems: [],
      },
      {
        provider: "claude-old",
        directory: join(home, ".claude-old"),
        label: "old",
        main: false,
        signedIn: false,
        loginExpired: false,
        providerReady: false,
        usage: null,
        agents: { total: 0, busy: 0 },
        problems: [HAND_MADE],
      },
      {
        provider: "claude-work",
        directory: join(home, ".claude-work"),
        label: "work",
        main: false,
        signedIn: true,
        loginExpired: true,
        providerReady: true,
        usage: null,
        agents: { total: 0, busy: 0 },
        problems: [],
      },
    ];
    expect(await accounts.list(api)).toEqual({
      accounts: expected,
      usageError: null,
      moveJob: null,
    });
    await expect(stat(join(home, ".claude-old", ".claude.json"))).rejects.toThrow("ENOENT");
  });
});

describe("new agents and moves", () => {
  it("rewrites only plain claude creations, following the saved default", async () => {
    const { home, accounts, api, saved } = await setup();
    await accounts.add(api, "work");
    await writeFile(join(home, ".claude-work", ".credentials.json"), "{}");
    api.usage.set("claude", usageAt(80, "warning"));
    api.usage.set("claude-work", usageAt(20, "none"));
    const plain: CreateRequest = { provider: "claude", cwd: "/repo" };

    expect(await accounts.beforeCreate(api, plain)).toBe("claude");
    saved.value = "auto";
    expect(await accounts.beforeCreate(api, plain)).toBe("claude-work");
    expect(await accounts.beforeCreate(api, { provider: "codex", cwd: "/repo" })).toBe("codex");
    saved.value = "claude-work";
    expect(await accounts.beforeCreate(api, plain)).toBe("claude-work");
  });

  it("refuses an unknown source and a target that cannot take agents, then moves idle agents", async () => {
    const { home, accounts, api } = await setup();
    await accounts.add(api, "work");
    api.agents = [agent("a", "claude"), agent("b", "claude", { inTurn: true })];

    expect(await accounts.moveIdle(api, "claude", "claude-work")).toEqual({
      ok: false,
      error: "Sign in to claude-work first",
      job: null,
    });
    expect(await accounts.moveIdle(api, "claude", "claude")).toEqual({
      ok: false,
      error: "Pick another account to move to",
      job: null,
    });
    expect(await accounts.moveIdle(api, "codex", "claude-work")).toEqual({
      ok: false,
      error: "No account uses codex",
      job: null,
    });
    api.states.delete("claude-work");
    expect(await accounts.moveIdle(api, "claude", "claude-work")).toEqual({
      ok: false,
      error: "Agents cannot start on claude-work yet. Fix its problems first.",
      job: null,
    });

    api.states.set("claude-work", READY);
    await writeFile(join(home, ".claude-work", ".credentials.json"), "{}");
    const started = await accounts.moveIdle(api, "claude", "claude-work");

    const job: MoveJob = {
      from: "claude",
      to: "claude-work",
      total: 1,
      busy: 1,
      moved: 0,
      handedOff: 0,
      skipped: 0,
      failed: [],
      done: false,
    };
    expect(started).toEqual({ ok: true, error: null, job });
    await vi.waitFor(async () => {
      expect((await accounts.list(api)).moveJob?.done).toBe(true);
    });
    expect(api.moves).toEqual(["a->claude-work"]);
  });

  it("never lets Auto pick a disabled, danger or unknown account, and falls back from a named one", async () => {
    const { home, accounts, api, saved } = await setup();
    for (const name of ["fresh", "full", "off"]) {
      await accounts.add(api, name);
      await writeFile(join(home, `.claude-${name}`, ".credentials.json"), "{}");
    }
    const disabled: ProviderEntry = {
      extends: "claude",
      enabled: false,
      configDirectory: join(home, ".claude-off"),
    };
    api.entries.set("claude-off", disabled);
    api.usage.set("claude", usageAt(80, "warning"));
    api.usage.set("claude-full", usageAt(60, "danger"));
    api.usage.set("claude-off", usageAt(5, "none"));
    const plain: CreateRequest = { provider: "claude", cwd: "/repo" };

    saved.value = "auto";
    expect(await accounts.beforeCreate(api, plain)).toBe("claude");
    saved.value = "claude-off";
    expect(await accounts.beforeCreate(api, plain)).toBe("claude");
    const explicit: CreateRequest = { provider: "claude-full", cwd: "/repo" };
    expect(await accounts.beforeCreate(api, explicit)).toBe("claude-full");
  });
});

describe("removing an account", () => {
  // The renamed folder carries the UTC time of the removal.
  const MOVED_SUFFIX = ".removed-20261110-070809";

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T07:08:09.500Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function failed(error: string): ActionResult {
    return { ok: false, error, loginWorkspaceId: null };
  }

  function recordFile(home: string): string {
    return join(home, "paseo-home", "claude-accounts", "added.json");
  }

  /** Nothing was removed: the provider, the record entry and the folder are all still there. */
  async function expectKept(home: string, api: FakeApi, name: string): Promise<void> {
    expect(api.removed).toEqual([]);
    expect(await readJson(recordFile(home))).toMatchObject({
      names: expect.arrayContaining([name]),
    });
    expect((await stat(join(home, `.claude-${name}`))).isDirectory()).toBe(true);
  }

  it("deletes its provider, drops its record and moves its folder out of discovery", async () => {
    const { home, accounts, api } = await setup();
    await accounts.add(api, "work");
    await accounts.add(api, "team");
    const folder = join(home, ".claude-work");
    await writeFile(join(folder, ".credentials.json"), "{}");
    await mkdir(join(folder, "projects"));
    await writeFile(join(folder, "projects", "chat.jsonl"), "{}\n");

    expect(await accounts.remove(api, "claude-work")).toEqual({
      ok: true,
      error: null,
      loginWorkspaceId: null,
    });

    const moved = `${folder}${MOVED_SUFFIX}`;
    expect(api.removed).toEqual(["claude-work"]);
    expect(api.entries.has("claude-work")).toBe(false);
    expect(await readJson(recordFile(home))).toEqual({ version: 1, names: ["team"] });
    await expect(stat(folder)).rejects.toThrow("ENOENT");
    expect(await readFile(join(moved, "projects", "chat.jsonl"), "utf8")).toBe("{}\n");
    expect((await stat(join(moved, ".credentials.json"))).isFile()).toBe(true);
    const listed = (await accounts.list(api)).accounts.map((account) => account.provider);
    expect(listed).toEqual(["claude", "claude-team"]);
  });

  it("refuses the main account, an unknown provider and an account Paseo did not add", async () => {
    const { home, accounts, api } = await setup();
    const handMade = join(home, ".claude-old");
    await mkdir(handMade);

    expect(await accounts.remove(api, "claude")).toEqual(
      failed("The main account cannot be removed"),
    );
    expect(await accounts.remove(api, "codex")).toEqual(failed("No account uses codex"));
    expect(await accounts.remove(api, "claude-old")).toEqual(
      failed(
        `Paseo did not add claude-old, so it cannot remove it. Add it again to adopt it first, or delete ${handMade} by hand.`,
      ),
    );
    expect(api.removed).toEqual([]);
    expect((await stat(handMade)).isDirectory()).toBe(true);
  });

  it("refuses while agents are on the account or moving to it", async () => {
    const { home, accounts, api } = await setup();
    await accounts.add(api, "work");
    await writeFile(join(home, ".claude-work", ".credentials.json"), "{}");

    api.agents = [agent("a", "claude-work"), agent("b", "claude-work", { inTurn: true })];
    expect(await accounts.remove(api, "claude-work")).toEqual(
      failed("Move or archive its 2 agents first"),
    );
    api.agents = [agent("a", "claude-work", { status: "closed" })];
    expect(await accounts.remove(api, "claude-work")).toEqual(
      failed("Move or archive its agent first"),
    );

    let release: () => void = () => undefined;
    api.moveGate = new Promise((resolve) => {
      release = resolve;
    });
    api.agents = [agent("c", "claude")];
    expect((await accounts.moveIdle(api, "claude", "claude-work")).ok).toBe(true);
    expect(await accounts.remove(api, "claude-work")).toEqual(
      failed("Agents are moving to or from claude-work. Wait for that move to finish."),
    );
    release();
    await vi.waitFor(async () => {
      expect((await accounts.list(api)).moveJob?.done).toBe(true);
    });
    await expectKept(home, api, "work");
  });

  it("refuses when the folder's new name is taken, before changing anything", async () => {
    const { home, accounts, api } = await setup();
    await accounts.add(api, "work");
    const taken = join(home, `.claude-work${MOVED_SUFFIX}`);
    await mkdir(taken);

    expect(await accounts.remove(api, "claude-work")).toEqual(
      failed(`${taken} already exists. Try again in a second.`),
    );
    await expectKept(home, api, "work");
  });

  it("keeps the account when the host config cannot drop its provider", async () => {
    const { home, accounts, api } = await setup();
    await accounts.add(api, "work");
    api.removeError = new Error("config.json is read-only");

    expect(await accounts.remove(api, "claude-work")).toEqual(
      failed(
        "The claude-work provider was not removed, so the account stays: config.json is read-only",
      ),
    );
    await expectKept(home, api, "work");
  });

  it("says what is left when the folder cannot move", async () => {
    const { home, accounts, api } = await setup();
    await accounts.add(api, "work");
    const folder = join(home, ".claude-work");
    const moved = `${folder}${MOVED_SUFFIX}`;
    // A file takes the new name after the checks, so the rename itself fails.
    api.onRemoveProvider = () => writeFile(moved, "");

    expect(await accounts.remove(api, "claude-work")).toEqual(
      failed(
        `Removed the claude-work provider and its record, but its folder did not move: ENOTDIR: not a directory, rename '${folder}' -> '${moved}'. Rename or delete it by hand.`,
      ),
    );
    expect(api.removed).toEqual(["claude-work"]);
    expect(await readJson(recordFile(home))).toEqual({ version: 1, names: [] });
    expect((await stat(folder)).isDirectory()).toBe(true);
  });
});

describe("platform gates", () => {
  it("refuses to add an account or sign in on Windows", async () => {
    const { home, accounts, api } = await setup("win32");

    expect(await accounts.add(api, "work")).toEqual({
      ok: false,
      error: "Adding accounts needs macOS or Linux",
      loginWorkspaceId: null,
    });
    expect(await accounts.signIn(api, "claude")).toEqual({
      ok: false,
      error: "Signing in from Paseo needs macOS or Linux",
      loginWorkspaceId: null,
    });

    expect(api.terminals).toEqual([]);
    expect(api.added).toEqual([]);
    await expect(stat(join(home, ".claude-work"))).rejects.toThrow("ENOENT");
  });
});
