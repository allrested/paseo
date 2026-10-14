import type { UsageInput } from "../shared/input.js";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import {
  toneFromUsedPct,
  unavailable,
  usedPctOf,
  type UsageAccount,
  type UsageBalance,
  type UsageReport,
  type UsageScope,
} from "@getpaseo/plugin/server/usage";

// Kiro CLI (the rebranded Amazon Q Developer CLI) keeps its IAM Identity Center
// session in a SQLite store rather than a JSON credentials file: the OIDC token
// lives in `auth_kv` under `kirocli:odic:token` (the vendor's spelling, not a
// typo here), and the CodeWhisperer profile in `state` under
// `api.codewhisperer.profile`. Read it with node:sqlite so we don't depend on a
// `sqlite3` CLI, matching how the Cursor source reads its state db.
const KIRO_TOKEN_KEY = "kirocli:odic:token";
const KIRO_PROFILE_KEY = "api.codewhisperer.profile";

// Usage comes from the same private CodeWhisperer endpoint the CLI's own
// `/usage` slash command calls: AWS JSON 1.0, bearer-authenticated with the
// Identity Center access token. Undocumented, so treat every field as optional.
const KIRO_USAGE_TARGET = "AmazonCodeWhispererService.GetUsageLimits";

// @types/node@20 predates the node:sqlite typings; declare the slice we use.
interface KiroStateStatement {
  get(...params: unknown[]): Record<string, unknown> | undefined;
}
interface KiroStateDatabase {
  prepare(sql: string): KiroStateStatement;
  close(): void;
}
interface NodeSqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => KiroStateDatabase;
}

const ApiNullableNumberSchema = z.preprocess(
  (value) => (value == null ? null : value),
  z.coerce.number().finite().nullable(),
);
const ApiOptionalStringSchema = z.preprocess(
  (value) => (value == null ? undefined : value),
  z.coerce.string().optional(),
);

const KiroTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_at: ApiOptionalStringSchema,
  region: ApiOptionalStringSchema,
});

const KiroProfileSchema = z.object({ arn: ApiOptionalStringSchema });

const KiroUsageBreakdownSchema = z.object({
  resourceType: ApiOptionalStringSchema,
  unit: ApiOptionalStringSchema,
  displayName: ApiOptionalStringSchema,
  displayNamePlural: ApiOptionalStringSchema,
  currentUsage: ApiNullableNumberSchema,
  currentUsageWithPrecision: ApiNullableNumberSchema,
  usageLimit: ApiNullableNumberSchema,
  usageLimitWithPrecision: ApiNullableNumberSchema,
  nextDateReset: ApiNullableNumberSchema,
});

const KiroUsageResponseSchema = z.object({
  nextDateReset: ApiNullableNumberSchema,
  subscriptionInfo: z.object({ subscriptionTitle: ApiOptionalStringSchema }).nullish(),
  usageBreakdownList: z.array(KiroUsageBreakdownSchema).nullish(),
});

// The API reports resource types like CREDIT; map onto the units the usage card
// knows how to render, defaulting to requests for anything unrecognised.
function balanceUnit(resourceType: string | undefined): UsageBalance["unit"] {
  switch ((resourceType ?? "").toUpperCase()) {
    case "CREDIT":
      return "credits";
    case "TOKEN":
      return "tokens";
    case "USD":
      return "usd";
    default:
      return "requests";
  }
}

// nextDateReset arrives as epoch seconds (often as a float, e.g. 1.7882208E9).
function resetIsoFromEpochSeconds(seconds: number | null): string | null {
  if (seconds === null) return null;
  const date = new Date(seconds * 1000);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function usageBalances(resp: z.infer<typeof KiroUsageResponseSchema>): UsageBalance[] {
  const planResetsAt = resetIsoFromEpochSeconds(resp.nextDateReset);
  const balances: UsageBalance[] = [];
  for (const [index, entry] of (resp.usageBreakdownList ?? []).entries()) {
    // The *WithPrecision variants carry the fractional value (49.32 vs 49);
    // prefer them and fall back to the rounded integers.
    const used = entry.currentUsageWithPrecision ?? entry.currentUsage;
    const limit = entry.usageLimitWithPrecision ?? entry.usageLimit;
    if (used === null && limit === null) continue;
    balances.push({
      id: (entry.resourceType ?? `usage_${index}`).toLowerCase(),
      label: entry.displayNamePlural ?? entry.displayName ?? "Usage",
      used,
      remaining: used !== null && limit !== null ? Math.max(0, limit - used) : null,
      limit,
      unit: balanceUnit(entry.resourceType ?? entry.unit),
      resetsAt: resetIsoFromEpochSeconds(entry.nextDateReset) ?? planResetsAt,
      tone: toneFromUsedPct(usedPctOf(used, limit)),
    });
  }
  return balances;
}

interface KiroSession {
  accessToken: string;
  expiresAt: string | undefined;
  region: string;
  profileArn: string | null;
}

export function kiroDatabasePath(home: string = homedir()): string {
  return join(home, ".local", "share", "kiro-cli", "data.sqlite3");
}

async function readKiroSession(path: string): Promise<KiroSession | null> {
  if (!existsSync(path)) return null;
  // Held in a variable so TypeScript skips module resolution: @types/node@20 has
  // no node:sqlite typings yet, while the runtime (Node 22+) provides it.
  const sqliteSpecifier: string = "node:sqlite";
  let sqlite: NodeSqliteModule;
  try {
    sqlite = (await import(sqliteSpecifier)) as unknown as NodeSqliteModule;
  } catch {
    return null; // runtime without node:sqlite
  }

  let db: KiroStateDatabase | undefined;
  try {
    db = new sqlite.DatabaseSync(path, { readOnly: true });
    const rawToken = db.prepare("SELECT value FROM auth_kv WHERE key = ?").get(KIRO_TOKEN_KEY)?.[
      "value"
    ];
    if (typeof rawToken !== "string") return null;
    const token = KiroTokenSchema.parse(JSON.parse(rawToken));

    let profileArn: string | null = null;
    const rawProfile = db.prepare("SELECT value FROM state WHERE key = ?").get(KIRO_PROFILE_KEY)?.[
      "value"
    ];
    if (typeof rawProfile === "string") {
      try {
        profileArn = KiroProfileSchema.parse(JSON.parse(rawProfile)).arn ?? null;
      } catch {
        // An unparseable profile still lets the request run without one.
      }
    }
    return {
      accessToken: token.access_token,
      expiresAt: token.expires_at,
      region: token.region ?? "us-east-1",
      profileArn,
    };
  } catch {
    return null; // locked, unreadable, or not a Kiro store
  } finally {
    db?.close();
  }
}

export async function discover(scope: UsageScope): Promise<UsageAccount[]> {
  if (scope.kind === "session" && scope.provider !== "kiro") return [];
  const home =
    scope.kind === "session" ? scope.env.HOME || scope.env.USERPROFILE || homedir() : homedir();
  const path = kiroDatabasePath(home);
  return (await readKiroSession(path))
    ? [{ key: "default", input: { store: "sqlite", locator: path } }]
    : [];
}

export async function fetchUsage(
  input: UsageInput,
  fetchApi: typeof fetch = fetch,
  now: () => number = Date.now,
): Promise<UsageReport> {
  const session = await readKiroSession(input.locator);
  if (!session) throw new Error("Kiro login store no longer exists");

  // An expired session would only earn a 403. Refreshing is the CLI's job: it owns the
  // refresh token, and redeeming it here would invalidate the CLI's copy.
  const expiresAt = session.expiresAt ? Date.parse(session.expiresAt) : Number.NaN;
  if (Number.isFinite(expiresAt) && expiresAt <= now())
    return unavailable({
      kind: "expired",
      expiresAt: new Date(expiresAt).toISOString(),
      refreshedBy: "kiro-cli",
    });

  const res = await fetchApi(`https://q.${session.region}.amazonaws.com/`, {
    signal: AbortSignal.timeout(15_000),
    method: "POST",
    headers: {
      Authorization: `Bearer ${session.accessToken}`,
      "Content-Type": "application/x-amz-json-1.0",
      "X-Amz-Target": KIRO_USAGE_TARGET,
    },
    body: JSON.stringify(session.profileArn ? { profileArn: session.profileArn } : {}),
  });
  if (res.status === 401 || res.status === 403)
    return unavailable({ kind: "rejected", status: res.status, refreshedBy: "kiro-cli" });
  if (!res.ok) throw new Error(`Kiro usage API returned ${res.status}`);

  const resp = KiroUsageResponseSchema.parse(await res.json());
  return {
    status: "available",
    planLabel: resp.subscriptionInfo?.subscriptionTitle || undefined,
    windows: [],
    balances: usageBalances(resp),
    details: [],
  };
}
