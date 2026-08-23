import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Logger } from "pino";
import { z } from "zod";
import type { ProviderUsage, ProviderUsageBalance } from "../../../server/messages.js";
import type { ProviderApiFetch, ProviderUsageFetcher } from "../provider.js";
import {
  ApiNullableNumberSchema,
  ApiOptionalStringSchema,
  fetchProviderApi,
  toIsoStringOrNull,
  toneFromUsedPct,
  unavailableUsage,
  usedPctOf,
} from "../usage.js";

// Kiro CLI (the rebranded Amazon Q Developer CLI) keeps its IAM Identity Center
// session in a SQLite store rather than a JSON credentials file: the OIDC token
// lives in `auth_kv` under `kirocli:odic:token` (the vendor's spelling, not a
// typo here), and the CodeWhisperer profile in `state` under
// `api.codewhisperer.profile`. Read it with node:sqlite so we don't depend on a
// `sqlite3` CLI, matching how the Cursor fetcher reads its state db.
const KIRO_TOKEN_KEY = "kirocli:odic:token";
const KIRO_PROFILE_KEY = "api.codewhisperer.profile";

// Usage comes from the same private CodeWhisperer endpoint the CLI's own
// `/usage` slash command calls: AWS JSON 1.0, bearer-authenticated with the
// Identity Center access token. Undocumented, so treat every field as optional
// and degrade to an unavailable card rather than throwing.
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

const KiroTokenSchema = z.object({
  access_token: z.string().min(1),
  expires_at: ApiOptionalStringSchema,
  region: ApiOptionalStringSchema,
});

const KiroProfileSchema = z.object({
  arn: ApiOptionalStringSchema,
});

const KiroUsageBreakdownSchema = z.object({
  resourceType: ApiOptionalStringSchema,
  unit: ApiOptionalStringSchema,
  displayName: ApiOptionalStringSchema,
  displayNamePlural: ApiOptionalStringSchema,
  currentUsage: ApiNullableNumberSchema,
  currentUsageWithPrecision: ApiNullableNumberSchema,
  usageLimit: ApiNullableNumberSchema,
  usageLimitWithPrecision: ApiNullableNumberSchema,
  currentOverages: ApiNullableNumberSchema,
  nextDateReset: ApiNullableNumberSchema,
});

const KiroUsageResponseSchema = z.object({
  nextDateReset: ApiNullableNumberSchema,
  subscriptionInfo: z
    .object({
      subscriptionTitle: ApiOptionalStringSchema,
    })
    .nullish(),
  usageBreakdownList: z.array(KiroUsageBreakdownSchema).nullish(),
});

// The API reports resource types like CREDIT; map onto the units the usage card
// knows how to render, defaulting to requests for anything unrecognised.
function balanceUnit(resourceType: string | null | undefined): ProviderUsageBalance["unit"] {
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
function resetIsoFromEpochSeconds(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return toIsoStringOrNull(seconds * 1000);
}

function tokenIsExpired(expiresAt: string | null | undefined): boolean {
  if (!expiresAt) return false;
  const expiry = Date.parse(expiresAt);
  return Number.isFinite(expiry) && expiry <= Date.now();
}

interface KiroSession {
  accessToken: string;
  region: string;
  profileArn: string | null;
}

async function readKiroSession(homeDir: string, logger: Logger): Promise<KiroSession | null> {
  const dbPath = join(homeDir, ".local", "share", "kiro-cli", "data.sqlite3");
  if (!existsSync(dbPath)) return null;

  // Held in a variable so TypeScript skips module resolution: @types/node@20 has
  // no node:sqlite typings yet, while the runtime (Node 22+) provides it.
  const sqliteSpecifier: string = "node:sqlite";
  let sqlite: NodeSqliteModule;
  try {
    sqlite = (await import(sqliteSpecifier)) as unknown as NodeSqliteModule;
  } catch (err) {
    logger.debug({ err }, "node:sqlite unavailable; cannot read Kiro data.sqlite3");
    return null;
  }

  let db: KiroStateDatabase | undefined;
  try {
    db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
    const rawToken = db.prepare("SELECT value FROM auth_kv WHERE key = ?").get(KIRO_TOKEN_KEY)
      ?.["value"];
    if (typeof rawToken !== "string") return null;
    const token = KiroTokenSchema.parse(JSON.parse(rawToken));

    // An expired session would only earn a 403; surface it as unavailable
    // instead. Refreshing is the CLI's job — it owns the refresh token.
    if (tokenIsExpired(token.expires_at)) {
      logger.debug({ expiresAt: token.expires_at }, "Kiro session expired; skipping usage fetch");
      return null;
    }

    let profileArn: string | null = null;
    const rawProfile = db.prepare("SELECT value FROM state WHERE key = ?").get(KIRO_PROFILE_KEY)
      ?.["value"];
    if (typeof rawProfile === "string") {
      try {
        profileArn = KiroProfileSchema.parse(JSON.parse(rawProfile)).arn ?? null;
      } catch (err) {
        logger.debug({ err }, "Unparseable Kiro CodeWhisperer profile; querying without one");
      }
    }

    return { accessToken: token.access_token, region: token.region ?? "us-east-1", profileArn };
  } catch (err) {
    // Locked/permission/corrupt/schema failures all land here; log so an
    // unavailable Kiro card stays diagnosable.
    logger.debug({ err, path: dbPath }, "Failed to read Kiro session from data.sqlite3");
    return null;
  } finally {
    db?.close();
  }
}

export interface KiroQuotaProviderOptions {
  logger: Logger;
  fetch?: ProviderApiFetch;
  homeDir?: string;
}

export class KiroQuotaProvider implements ProviderUsageFetcher {
  readonly providerId = "kiro";
  readonly displayName = "Kiro CLI";

  private readonly logger: Logger;
  private readonly fetchApi: ProviderApiFetch;
  private readonly homeDir: string;

  constructor(options: KiroQuotaProviderOptions) {
    this.logger = options.logger;
    this.fetchApi = options.fetch ?? fetch;
    this.homeDir = options.homeDir ?? homedir();
  }

  async fetchUsage(): Promise<ProviderUsage> {
    const session = await readKiroSession(this.homeDir, this.logger);
    if (!session) return unavailableUsage(this);

    const res = await fetchProviderApi(this.fetchApi, `https://q.${session.region}.amazonaws.com/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.accessToken}`,
        "Content-Type": "application/x-amz-json-1.0",
        "X-Amz-Target": KIRO_USAGE_TARGET,
      },
      body: JSON.stringify(session.profileArn ? { profileArn: session.profileArn } : {}),
    });

    if (!res.ok) {
      this.logger.debug({ status: res.status }, "Kiro usage fetch failed");
      return unavailableUsage(this);
    }

    const resp = KiroUsageResponseSchema.parse(await res.json());
    const planResetsAt = resetIsoFromEpochSeconds(resp.nextDateReset);

    const balances: ProviderUsageBalance[] = [];
    for (const [index, entry] of (resp.usageBreakdownList ?? []).entries()) {
      // The *WithPrecision variants carry the fractional value (49.32 vs 49);
      // prefer them and fall back to the rounded integers.
      const used = entry.currentUsageWithPrecision ?? entry.currentUsage;
      const limit = entry.usageLimitWithPrecision ?? entry.usageLimit;
      if (used === null && limit === null) continue;

      const label = entry.displayNamePlural ?? entry.displayName ?? "Usage";
      balances.push({
        id: (entry.resourceType ?? `usage_${index}`).toLowerCase(),
        label,
        used,
        remaining:
          typeof used === "number" && typeof limit === "number" ? Math.max(0, limit - used) : null,
        limit,
        unit: balanceUnit(entry.resourceType ?? entry.unit),
        resetsAt: resetIsoFromEpochSeconds(entry.nextDateReset) ?? planResetsAt,
        tone: toneFromUsedPct(usedPctOf(used, limit)),
      });
    }

    return {
      providerId: this.providerId,
      displayName: this.displayName,
      status: "available",
      planLabel: resp.subscriptionInfo?.subscriptionTitle ?? null,
      windows: [],
      balances,
      details: [],
      error: null,
    };
  }
}
