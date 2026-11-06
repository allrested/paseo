import type { output as ZodOutput } from "zod";
import { sharedMcpSettings, type ServerDefinition } from "../shared/settings.js";

export type SharedMcpSettingsValues = ZodOutput<typeof sharedMcpSettings.schema>;

export type ParsedDefinitions =
  | { ok: true; values: SharedMcpSettingsValues }
  | { ok: false; error: string };

interface SchemaIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/** The editor text for saved definitions: the servers array with every default written out. */
export function formatDefinitions(servers: readonly ServerDefinition[]): string {
  return JSON.stringify(servers, null, 2);
}

function describeIssue(issue: SchemaIssue): string {
  // Paths start at the settings document, so a field of the first entry reads "servers.0.port".
  const where = issue.path.map((segment) => String(segment)).join(".");
  return `${where}: ${issue.message}`;
}

/**
 * Parse editor text as the servers array and validate it as the whole settings document, so the
 * duplicate id and port checks run before save. The output has defaults filled and no key set to
 * undefined, which save() requires.
 */
export function parseDefinitions(text: string): ParsedDefinitions {
  let servers: unknown;
  try {
    servers = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `Invalid JSON: ${reason}` };
  }
  const parsed = sharedMcpSettings.schema.safeParse({ servers });
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => describeIssue(issue));
    return { ok: false, error: issues.join("\n") };
  }
  return { ok: true, values: parsed.data };
}

/** A copy of `servers` with one definition's `enabled` replaced. Throws for an unknown id. */
export function withServerEnabled(
  servers: readonly ServerDefinition[],
  id: string,
  enabled: boolean,
): ServerDefinition[] {
  const index = servers.findIndex((server) => server.id === id);
  if (index === -1) throw new Error(`Unknown server: ${id}`);
  const next = servers.slice();
  next[index] = { ...servers[index], enabled };
  return next;
}
