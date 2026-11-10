import type { PluginHandlerContext } from "@getpaseo/plugin/server";

type PaseoApi = PluginHandlerContext["paseo"];

/** What `paseo.providers.listUsageForProvider` resolves to. */
export type ProviderUsageReports = Awaited<
  ReturnType<PaseoApi["providers"]["listUsageForProvider"]>
>;
export type UsageReportEntry = ProviderUsageReports["reports"][number];
export type UsageTightestWindow = NonNullable<ProviderUsageReports["tightest"]>;
/**
 * The daemon's heads-up tone for the tightest window: `danger` from 95% or a run-out within 30
 * minutes.
 */
export type UsageTone = UsageTightestWindow["tone"];
export type AgentSnapshot = Awaited<
  ReturnType<PaseoApi["agents"]["list"]>
>["entries"][number]["agent"];
export type ProviderSnapshotEntry = Awaited<
  ReturnType<PaseoApi["providers"]["snapshot"]>
>["entries"][number];

export interface ProviderUsage {
  reports: UsageReportEntry[];
  tightest: UsageTightestWindow | null;
  /** The lookup's error, such as "Usage is off on this host.", or null. */
  error: string | null;
}

export interface AgentInfo {
  id: string;
  provider: string;
  cwd: string;
  status: AgentSnapshot["status"];
  /** A turn is running or a permission request is waiting. */
  inTurn: boolean;
}

export interface MoveOutcome {
  /** The successor; the moved agent is archived. */
  agentId: string;
  strategy: "native" | "handoff";
}

/** One `agents.providers` entry of the host config, as far as this plugin reads it. */
export interface ProviderEntry {
  extends: string | null;
  enabled: boolean;
  /** The entry's `env.CLAUDE_CONFIG_DIR`, or null. */
  configDirectory: string | null;
}

export interface NewProvider {
  label: string;
  configDirectory: string;
}

export interface ProviderState {
  status: ProviderSnapshotEntry["status"];
  error: string | null;
}

export interface TerminalCommand {
  name: string;
  command: string;
  args: string[];
}

/** Everything the service needs from Paseo. `paseo-port.ts` implements it over `PaseoApi`. */
export interface AccountsApi {
  /** Every agent that is not archived, internal or in the background. */
  listAgents(): Promise<AgentInfo[]>;
  /** The agent as it is now, or null when it is gone or archived. */
  getAgent(agentId: string): Promise<AgentInfo | null>;
  /** Moves without a continue prompt and resolves with the successor. */
  moveAgent(agentId: string, provider: string): Promise<MoveOutcome>;
  /** Never rejects: a failed lookup comes back in `error`. */
  listUsage(provider: string): Promise<ProviderUsage>;
  /** The host config's provider entries, by provider id. */
  providerEntries(): Promise<Map<string, ProviderEntry>>;
  /** The provider snapshot, by provider id. */
  providerStates(): Promise<Map<string, ProviderState>>;
  addProvider(provider: string, entry: NewProvider): Promise<void>;
  /** Deletes the provider's host config entry; a provider without one is left as it is. */
  removeProvider(provider: string): Promise<void>;
  /** The most recently active workspace, or null when there is none. */
  latestWorkspaceId(): Promise<string | null>;
  openTerminal(workspaceId: string, command: TerminalCommand): Promise<void>;
}
