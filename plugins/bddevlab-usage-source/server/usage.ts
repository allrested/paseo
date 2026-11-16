import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
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
const BDDEVLAB_HOST = "api.bddevlab.online";

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

type Env = Record<string, string | undefined>;

/** A provider entry whose `env` points Claude Code at the gateway: its id and its token. */
interface GatewayEntry {
  id: string;
  token: string;
}

const ProviderEntriesSchema = z.object({
  agents: z
    .object({
      providers: z.record(
        z.string(),
        z.object({ env: z.record(z.string(), z.string()).optional() }).passthrough(),
      ),
    })
    .partial()
    .optional(),
});

function isGateway(baseUrl: string | undefined): boolean {
  if (!baseUrl) return false;
  try {
    return new URL(baseUrl).host === BDDEVLAB_HOST;
  } catch {
    return false;
  }
}

function tokenOf(env: Env): string | undefined {
  return env.ANTHROPIC_AUTH_TOKEN || env.ANTHROPIC_API_KEY || undefined;
}

/** `$PASEO_HOME/config.json`; `PASEO_HOME` defaults to `~/.paseo`, and `~` expands. */
function configPath(env: Env): string {
  const home = env.PASEO_HOME?.trim() || "~/.paseo";
  const expanded = home === "~" ? homedir() : home.replace(/^~(?=\/)/, homedir());
  return join(resolve(expanded), "config.json");
}

/**
 * The host config's provider entries that send Claude Code to the gateway with a token of their
 * own. A host without the file, or one the schema does not read, has none.
 */
async function gatewayEntries(env: Env): Promise<GatewayEntry[]> {
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(configPath(env), "utf8"));
  } catch {
    return [];
  }
  const parsed = ProviderEntriesSchema.safeParse(raw);
  if (!parsed.success) return [];
  const entries: GatewayEntry[] = [];
  for (const [id, entry] of Object.entries(parsed.data.agents?.providers ?? {})) {
    const token = entry.env && tokenOf(entry.env);
    if (entry.env && token && isGateway(entry.env.ANTHROPIC_BASE_URL)) entries.push({ id, token });
  }
  return entries;
}

function entryAccount(entry: GatewayEntry): UsageAccount {
  return {
    // (a key is [A-Za-z0-9._-]{1,128}: packages/plugin/src/server/usage.ts)
    key: `provider.${entry.id.replace(/[^A-Za-z0-9._-]/g, "_")}`.slice(0, 128),
    label: entry.id,
    input: { store: "provider", locator: entry.id },
  };
}

const DAEMON_ACCOUNT: UsageAccount = {
  key: "default",
  input: { store: "env", locator: BDDEVLAB_API_KEY },
};

/**
 * Two ways to spend a BDDevLab balance. An agent on `opencode` with model `bddevlab/claude-opus-5`
 * bills the daemon's `BDDEVLAB_API_KEY`: the model id carries the gateway as the segment before
 * the slash. A Claude Code profile whose entry sets `ANTHROPIC_BASE_URL` to the gateway bills that
 * entry's own token, and its model ids have no prefix, so the session is matched by the endpoint
 * and token it was launched with. The input names the entry, never the token.
 */
export async function discover(
  scope: UsageScope,
  daemonEnv: Env = process.env,
): Promise<UsageAccount[]> {
  const hasKey = Boolean(daemonEnv[BDDEVLAB_API_KEY]);
  if (scope.kind === "global") {
    const entries = (await gatewayEntries(daemonEnv)).map(entryAccount);
    return hasKey ? [DAEMON_ACCOUNT, ...entries] : entries;
  }
  if (scope.model?.startsWith("bddevlab/")) return hasKey ? [DAEMON_ACCOUNT] : [];
  if (!isGateway(scope.env.ANTHROPIC_BASE_URL)) return [];
  const token = tokenOf(scope.env);
  if (!token) return [];
  const entry = (await gatewayEntries(daemonEnv)).find((candidate) => candidate.token === token);
  return entry ? [entryAccount(entry)] : [];
}

async function tokenFor(input: UsageInput, daemonEnv: Env): Promise<string | undefined> {
  if (input.store === "env") return daemonEnv[input.locator];
  return (await gatewayEntries(daemonEnv)).find((entry) => entry.id === input.locator)?.token;
}

export async function fetchUsage(
  input: UsageInput,
  fetchApi: typeof fetch = fetch,
  daemonEnv: Env = process.env,
): Promise<UsageReport> {
  const token = await tokenFor(input, daemonEnv);
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
