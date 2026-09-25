import type { Logger } from "pino";
import { z } from "zod";
import type {
  ProviderUsage,
  ProviderUsageBalance,
  ProviderUsageDetail,
} from "../../../server/messages.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "../provider.js";
import {
  ApiNumberSchema,
  ApiOptionalStringSchema,
  fetchProviderApi,
  toneFromUsedPct,
  unavailableUsage,
  usedPctOf,
} from "../usage.js";

const BDDEVLAB_USAGE_URL = "https://api.bddevlab.online/api/usage/token/";

/**
 * The gateway denominates everything in internal quota units and its own dashboard
 * divides by this constant to show Credits. Report Credits so the numbers match what
 * the customer sees on the vendor page.
 */
const QUOTA_PER_CREDIT = 100_000;

const BdDevLabUsageResponseSchema = z.object({
  data: z
    .object({
      name: ApiOptionalStringSchema,
      total_granted: ApiNumberSchema.optional(),
      total_used: ApiNumberSchema.optional(),
      total_available: ApiNumberSchema.optional(),
      unlimited_quota: z.boolean().optional(),
    })
    .optional(),
});

interface BdDevLabQuotaProviderOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  env?: NodeJS.ProcessEnv;
}

function toCredits(quota: number | undefined): number | null {
  if (typeof quota !== "number") return null;
  return quota / QUOTA_PER_CREDIT;
}

export class BdDevLabQuotaProvider implements ProviderUsageFetcher {
  readonly providerId = "bddevlab";
  readonly displayName = "BDDevLab";

  private readonly logger: Logger;
  private readonly fetchApi: ProviderApiFetch;
  private readonly env: NodeJS.ProcessEnv;

  constructor(options: BdDevLabQuotaProviderOptions) {
    this.logger = options.logger;
    this.fetchApi = options.fetch ?? fetch;
    this.env = options.env ?? process.env;
  }

  async fetchUsage(): Promise<ProviderUsage> {
    const token = this.env["BDDEVLAB_API_KEY"];
    if (!token) return unavailableUsage(this);

    const res = await fetchProviderApi(this.fetchApi, BDDEVLAB_USAGE_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      this.logger.debug({ status: res.status }, "BDDevLab usage fetch failed");
      return unavailableUsage(this);
    }

    const resp = BdDevLabUsageResponseSchema.parse(await res.json());
    const data = resp.data;
    if (!data) return unavailableUsage(this);

    const used = toCredits(data.total_used);
    const unlimited = data.unlimited_quota === true;
    const limit = unlimited ? null : toCredits(data.total_granted);
    const remaining = unlimited ? null : toCredits(data.total_available);

    const balances: ProviderUsageBalance[] = [
      {
        id: "credits",
        label: "Credits",
        used,
        remaining,
        limit,
        unit: "credits",
        tone: toneFromUsedPct(usedPctOf(used, limit)),
      },
    ];

    const details: ProviderUsageDetail[] = unlimited
      ? [{ id: "quota", label: "Quota", value: "Unlimited" }]
      : [];

    return {
      providerId: this.providerId,
      displayName: this.displayName,
      status: "available",
      planLabel: data.name || null,
      windows: [],
      balances,
      details,
      error: null,
    };
  }
}
