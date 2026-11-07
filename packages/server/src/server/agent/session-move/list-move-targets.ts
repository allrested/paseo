import type { Logger } from "pino";
import type { UsageReportEntry } from "@getpaseo/protocol/messages";
import type { ProviderSnapshotEntry } from "../agent-sdk-types.js";
import type { ProviderLaunchInfo, ProviderSnapshotManager } from "../provider-snapshot-manager.js";
import {
  createUsageLookup,
  toMoveTarget,
  type MoveTarget,
  type UsageWindowLike,
} from "./move-targets.js";

export interface UsageScopeQuery {
  provider: string;
  env: Record<string, string>;
}

export type ListUsageReportsForScope = (scope: UsageScopeQuery) => Promise<UsageReportEntry[]>;

export type MoveTargetUsageLookup = (
  key: string,
  load: () => Promise<UsageReportEntry[]>,
) => Promise<UsageReportEntry[] | null>;

/**
 * Shared by every session and the usage watch: usage is daemon-wide, and the move dialog asks for
 * it on each open.
 */
export const sharedMoveTargetUsage: MoveTargetUsageLookup = createUsageLookup<UsageReportEntry[]>();

/** The agent whose targets are listed. */
export interface MoveTargetAgent {
  provider: string;
  cwd: string;
}

/** The registered providers, as the move targets read them. */
export interface MoveTargetProviders {
  /** Each provider's snapshot status in `cwd`; a provider with no entry yet is absent. */
  statusesIn(cwd: string): ReadonlyMap<string, ProviderSnapshotEntry["status"]>;
  launchInfos(): ProviderLaunchInfo[];
}

export interface ListMoveTargetsInput {
  agentId: string;
  findAgent: (agentId: string) => Promise<MoveTargetAgent | null>;
  providers: MoveTargetProviders;
  usageEnabled: boolean;
  /** Null when no plugin runtime reports usage. */
  listUsageReportsForScope: ListUsageReportsForScope | null;
  usageLookup: MoveTargetUsageLookup;
  logger: Pick<Logger, "warn">;
  now: number;
}

export function moveTargetProvidersFrom(
  manager: Pick<
    ProviderSnapshotManager,
    "getSnapshot" | "listRegisteredProviderIds" | "getProviderLaunchInfo"
  >,
): MoveTargetProviders {
  return {
    statusesIn: (cwd) =>
      new Map(
        manager
          .getSnapshot(cwd)
          .records.map(({ entry }): [string, ProviderSnapshotEntry["status"]] => [
            entry.provider,
            entry.status,
          ]),
      ),
    launchInfos: () =>
      manager.listRegisteredProviderIds().flatMap((providerId) => {
        const info = manager.getProviderLaunchInfo(providerId);
        return info ? [info] : [];
      }),
  };
}

/** Every registered provider as a move target of the agent, with its tightest usage window. */
export async function listAgentMoveTargets(input: ListMoveTargetsInput): Promise<MoveTarget[]> {
  const agent = await input.findAgent(input.agentId);
  if (!agent) throw new Error(`Agent not found: ${input.agentId}`);
  // Does not wait: a provider still loading stays selectable, and the move itself waits.
  const statuses = input.providers.statusesIn(agent.cwd);
  return Promise.all(
    input.providers.launchInfos().map(async (info) =>
      toMoveTarget({
        info,
        status: statuses.get(info.providerId) ?? null,
        currentProvider: agent.provider,
        windows: input.usageEnabled ? await usageWindows(input, info) : null,
        now: input.now,
      }),
    ),
  );
}

/** Usage windows for one target, or null when unknown (no source, failed or too slow). */
async function usageWindows(
  input: ListMoveTargetsInput,
  info: ProviderLaunchInfo,
): Promise<UsageWindowLike[] | null> {
  const listReports = input.listUsageReportsForScope;
  if (!listReports) return null;
  // Agents run the family CLI with the profile env, so usage is keyed by family.
  const reports = await input
    .usageLookup(info.providerId, () => listReports({ provider: info.family, env: info.env }))
    .catch((err: unknown) => {
      input.logger.warn({ err, providerId: info.providerId }, "move targets: usage lookup failed");
      return null;
    });
  if (!reports || reports.length === 0) return null;
  return reports.flatMap((entry) =>
    entry.report.status === "available" ? entry.report.windows : [],
  );
}
