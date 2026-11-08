import type { ListUsageReportsOptions } from "../../plugins/usage-sources/index.js";
import type pino from "pino";
// Fork delta (claude accounts): the tightest window and the move dialog's scoped usage lookup.
import { chooseTightestWindow } from "@getpaseo/protocol/usage-heads-up";
import type {
  ProviderUsage,
  UsageReportEntry,
  UsageTightestWindow,
} from "@getpaseo/protocol/messages";
import type {
  MoveTargetUsageLookup,
  UsageScopeQuery,
} from "../../agent/session-move/list-move-targets.js";
import type { SessionInboundMessage, SessionOutboundMessage } from "../../messages.js";

export interface UsageSessionOptions {
  emit(message: SessionOutboundMessage): void;
  runtime?: {
    listUsageReports(options: ListUsageReportsOptions): Promise<UsageReportEntry[]>;
    listLegacyUsage(): Promise<{ fetchedAt: string; providers: ProviderUsage[] }>;
    // Fork delta (claude accounts): the runtime's scoped read, as the move dialog uses it.
    listUsageReportsForScope?(scope: UsageScopeQuery): Promise<UsageReportEntry[]>;
  };
  // Fork delta (claude accounts): a provider's launch scope, or null when no provider has the id.
  resolveProviderScope?: (provider: string) => UsageScopeQuery | null;
  // Fork delta (claude accounts): the move dialog's usage cache, so both read alike.
  scopeLookup?: MoveTargetUsageLookup;
  isEnabled: () => boolean;
  logger: pino.Logger;
}

// Fork delta (claude accounts): the usage.provider.list_reports request and its result.
type ProviderReportsRequest = Extract<
  SessionInboundMessage,
  { type: "usage.provider.list_reports.request" }
>;

interface ProviderReportsResult {
  reports: UsageReportEntry[];
  tightest: UsageTightestWindow | null;
  error: string | null;
}

export class UsageSession {
  constructor(private readonly options: UsageSessionOptions) {}

  async handleListReports(
    msg: Extract<SessionInboundMessage, { type: "usage.list_reports.request" }>,
  ): Promise<void> {
    try {
      if (!this.options.isEnabled()) throw new Error("Usage is off on this host.");
      if (!this.options.runtime) throw new Error("Plugin runtime is unavailable");
      await this.options.runtime.listUsageReports({
        forceRefresh: msg.forceRefresh,
        reportIds: msg.reportIds,
        agentId: msg.agentId,
        onReport: (report) =>
          this.options.emit({
            type: "usage.list_reports.update",
            payload: { requestId: msg.requestId, report },
          }),
      });
      this.options.emit({
        type: "usage.list_reports.response",
        payload: { requestId: msg.requestId, error: null },
      });
    } catch (error) {
      this.options.emit({
        type: "usage.list_reports.response",
        payload: {
          requestId: msg.requestId,
          error: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  // Fork delta (claude accounts): one provider's usage, read the way the move dialog reads a
  // target's, so the accounts screen and the dialog agree.
  async handleProviderReports(msg: ProviderReportsRequest): Promise<void> {
    try {
      if (!this.options.isEnabled()) throw new Error("Usage is off on this host.");
      const runtime = this.options.runtime;
      const listForScope = runtime?.listUsageReportsForScope;
      if (!runtime || !listForScope) throw new Error("Plugin runtime is unavailable");
      const scope = this.options.resolveProviderScope?.(msg.provider) ?? null;
      if (!scope) throw new Error(`Unknown provider: ${msg.provider}`);
      const lookup = this.options.scopeLookup ?? loadNow;
      const reports = (await lookup(msg.provider, () => listForScope.call(runtime, scope))) ?? [];
      this.emitProviderReports(msg, {
        reports,
        tightest: tightestUsageWindow(reports, Date.now()),
        error: null,
      });
    } catch (error) {
      this.emitProviderReports(msg, {
        reports: [],
        tightest: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  // COMPAT(providerUsageList): added in v0.9.3, remove after 2027-03-26.
  async handleLegacyList(
    msg: Extract<SessionInboundMessage, { type: "provider.usage.list.request" }>,
  ): Promise<void> {
    if (!this.options.isEnabled()) {
      this.options.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: "Usage is off on this host.",
          code: "provider_usage_list_failed",
        },
      });
      return;
    }
    try {
      if (!this.options.runtime) throw new Error("Plugin runtime is unavailable");
      const usage = await this.options.runtime.listLegacyUsage();
      this.options.emit({
        type: "provider.usage.list.response",
        payload: {
          requestId: msg.requestId,
          fetchedAt: usage.fetchedAt,
          providers: usage.providers,
        },
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.options.logger.error({ err }, "Failed to list provider usage");
      this.options.emit({
        type: "rpc_error",
        payload: {
          requestId: msg.requestId,
          requestType: msg.type,
          error: `Failed to list provider usage: ${err.message}`,
          code: "provider_usage_list_failed",
        },
      });
    }
  }

  // Fork delta (claude accounts): the usage.provider.list_reports reply.
  private emitProviderReports(msg: ProviderReportsRequest, result: ProviderReportsResult): void {
    this.options.emit({
      type: "usage.provider.list_reports.response",
      payload: { requestId: msg.requestId, provider: msg.provider, ...result },
    });
  }
}

// Fork delta (claude accounts): a lookup that always loads, for a session without the shared cache.
function loadNow(
  _key: string,
  load: () => Promise<UsageReportEntry[]>,
): Promise<UsageReportEntry[] | null> {
  return load();
}

// Fork delta (claude accounts): the tightest window the accounts screen and Auto read.
/**
 * The tightest window across the available reports, ranked as the move dialog ranks a target's
 * (`chooseTightestWindow`: heads-up tone, then used share, then the sooner run-out), with its
 * heads-up tone at `now`.
 */
export function tightestUsageWindow(
  reports: readonly UsageReportEntry[],
  now: number,
): UsageTightestWindow | null {
  const windows = reports.flatMap((entry) =>
    entry.report.status === "available" ? entry.report.windows : [],
  );
  const tightest = chooseTightestWindow(windows, now);
  if (tightest === null) return null;
  return {
    label: tightest.window.label,
    usedPct: tightest.usedPct,
    resetsAt: tightest.resetsAt,
    tone: tightest.tone,
  };
}
