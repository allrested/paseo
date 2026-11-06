import type { UsageInput } from "../shared/input.js";
import { z } from "zod";
import {
  toneFromUsedPct,
  unavailable,
  usedPctOf,
  type UsageAccount,
  type UsageDetail,
  type UsageReport,
  type UsageScope,
} from "@getpaseo/plugin/server/usage";

const BDDEVLAB_USAGE_URL = "https://api.bddevlab.online/api/usage/token/";
const BDDEVLAB_API_KEY = "BDDEVLAB_API_KEY";

/**
 * The gateway denominates everything in internal quota units and its own dashboard
 * divides by this constant to show Credits. Report Credits so the numbers match what
 * the customer sees on the vendor page.
 */
const QUOTA_PER_CREDIT = 100_000;

const ApiNumberSchema = z.coerce.number().finite();
const ApiOptionalStringSchema = z.preprocess(
  (value) => (value == null ? undefined : value),
  z.coerce.string().optional(),
);

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

function toCredits(quota: number | undefined): number | null {
  return typeof quota === "number" ? quota / QUOTA_PER_CREDIT : null;
}

/**
 * The agent's provider is the CLI running it, which is not always who bills the tokens: an
 * agent on `opencode` with model `bddevlab/claude-opus-5` spends a BDDevLab balance. Model ids
 * carry the gateway as the segment before the slash, so a session on any CLI matches by model.
 */
export async function discover(scope: UsageScope): Promise<UsageAccount[]> {
  if (scope.kind === "session" && !scope.model?.startsWith("bddevlab/")) return [];
  if (!process.env[BDDEVLAB_API_KEY]) return [];
  return [{ key: "default", input: { store: "env", locator: BDDEVLAB_API_KEY } }];
}

export async function fetchUsage(
  input: UsageInput,
  fetchApi: typeof fetch = fetch,
): Promise<UsageReport> {
  const token = process.env[input.locator];
  if (!token) throw new Error("BDDevLab login store no longer exists");

  const res = await fetchApi(BDDEVLAB_USAGE_URL, {
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  if (res.status === 401 || res.status === 403)
    return unavailable({ kind: "rejected", status: res.status });
  if (!res.ok) throw new Error(`BDDevLab usage API returned ${res.status}`);

  const data = BdDevLabUsageResponseSchema.parse(await res.json()).data;
  if (!data) return unavailable({ kind: "no_quota", detail: "No token quota" });

  const used = toCredits(data.total_used);
  const unlimited = data.unlimited_quota === true;
  const limit = unlimited ? null : toCredits(data.total_granted);
  const remaining = unlimited ? null : toCredits(data.total_available);
  const details: UsageDetail[] = unlimited
    ? [{ id: "quota", label: "Quota", value: "Unlimited" }]
    : [];

  return {
    status: "available",
    planLabel: data.name || undefined,
    windows: [],
    balances: [
      {
        id: "credits",
        label: "Credits",
        used,
        remaining,
        limit,
        unit: "credits",
        tone: toneFromUsedPct(usedPctOf(used, limit)),
      },
    ],
    details,
  };
}
