import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { z } from "zod";

// Finds every ssh-mcp entry in the Claude configs the daemon can read, taking a .mcp.json only
// where Claude Code trusts its folder. A config holds passwords and keys in its args and env, so
// nothing here logs or returns a config's text: a file that does not parse is reported by path
// only, and the RPC layer returns id, name and source only.

export interface SshServer {
  /** sha256(source key NUL entry name), first 16 hex characters: stable and free of secrets. */
  id: string;
  name: string;
  /** "User config", "Local config for <dir>" or "<dir>/.mcp.json". */
  source: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  /** Variables the entry names that the daemon's env does not set, with no default. */
  missingVariables: string[];
  /** sha256 of the expanded command, args and env. A change replaces the running session. */
  fingerprint: string;
}

export interface Discovery {
  servers: SshServer[];
  problems: string[];
}

export interface DiscoveryInput {
  claudeConfigFile: string;
  /** Each workspace's directory: its worktree, else its project root. */
  workspaceDirectories: readonly string[];
  env: NodeJS.ProcessEnv;
}

interface ConfigSource {
  key: string;
  label: string;
  servers: Record<string, unknown>;
}

// Entries are parsed one by one, so an HTTP entry or an odd one never hides the rest.
const ServerMapSchema = z.record(z.string(), z.unknown());

const StdioEntrySchema = z.object({
  type: z.literal("stdio").optional(),
  command: z.string().min(1),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
});

// projects is read per workspace for the same reason.
const ClaudeConfigSchema = z.object({
  mcpServers: ServerMapSchema.optional(),
  projects: z.record(z.string(), z.unknown()).optional(),
});

const ProjectSchema = z.object({ mcpServers: ServerMapSchema.optional() });

const McpJsonSchema = z.object({ mcpServers: ServerMapSchema.optional() });

const TrustSchema = z.object({ hasTrustDialogAccepted: z.literal(true) });

// Claude Code's syntax: ${VAR} and ${VAR:-default}.
const VARIABLE = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;
const SSH_MCP = "ssh-mcp";

function isMissing(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

// undefined when the file is missing (silently) or unusable (reported). JSON is never undefined.
async function readJson(file: string, problems: string[]): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (error) {
    if (!isMissing(error)) problems.push(`${file}: unreadable`);
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    // The parser's message quotes the text, which may hold a password.
    problems.push(`${file}: not valid JSON`);
    return undefined;
  }
}

function namesSshMcp(value: string): boolean {
  return value
    .split(/[\\/]/)
    .some((segment) => segment === SSH_MCP || segment.startsWith(`${SSH_MCP}@`));
}

// The command, or an argument before "--" that is not an option, is ssh-mcp's package or a path
// with a segment named ssh-mcp. Arguments after "--" are ssh-mcp's own (host, user, key path).
export function runsSshMcp(command: string, args: readonly string[]): boolean {
  if (namesSshMcp(command)) return true;
  for (const arg of args) {
    if (arg === "--") return false;
    if (!arg.startsWith("-") && namesSshMcp(arg)) return true;
  }
  return false;
}

export function expandVariables(
  value: string,
  env: NodeJS.ProcessEnv,
  missing: Set<string>,
): string {
  return value.replace(VARIABLE, (_match: string, name: string, fallback: string | undefined) => {
    // Object.prototype's members (constructor, __proto__) are never strings, so a variable named
    // after one counts as unset.
    const set = env[name];
    if (typeof set === "string") return set;
    if (fallback !== undefined) return fallback;
    missing.add(name);
    return "";
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function serverId(sourceKey: string, name: string): string {
  return sha256(`${sourceKey}\0${name}`).slice(0, 16);
}

function fingerprintOf(command: string, args: readonly string[], env: Record<string, string>) {
  const entries = Object.entries(env).sort(([a], [b]) => (a < b ? -1 : 1));
  return sha256(JSON.stringify([command, args, entries]));
}

function toServer(
  source: ConfigSource,
  name: string,
  raw: unknown,
  env: NodeJS.ProcessEnv,
): SshServer | null {
  const entry = StdioEntrySchema.safeParse(raw);
  if (!entry.success) return null;
  const missing = new Set<string>();
  const command = expandVariables(entry.data.command, env, missing);
  const args = (entry.data.args ?? []).map((arg) => expandVariables(arg, env, missing));
  if (!runsSshMcp(command, args)) return null;
  const serverEnv: Record<string, string> = {};
  for (const [key, value] of Object.entries(entry.data.env ?? {})) {
    serverEnv[key] = expandVariables(value, env, missing);
  }
  return {
    id: serverId(source.key, name),
    name,
    source: source.label,
    command,
    args,
    env: serverEnv,
    missingVariables: [...missing].sort(),
    fingerprint: fingerprintOf(command, args, serverEnv),
  };
}

// A .mcp.json comes with the repository, so its commands are the repository's code. As in Claude
// Code, they run only for a folder trusted there: hasTrustDialogAccepted on the folder or a parent
// in ~/.claude.json, which Claude Code sets when its trust dialog is accepted.
function isTrusted(projects: Record<string, unknown> | undefined, dir: string): boolean {
  for (let path = dir; ; path = dirname(path)) {
    if (TrustSchema.safeParse(projects?.[path]).success) return true;
    if (dirname(path) === path) return false;
  }
}

function listsSshMcp(source: ConfigSource, env: NodeJS.ProcessEnv): boolean {
  return Object.entries(source.servers).some(
    ([name, raw]) => toServer(source, name, raw, env) !== null,
  );
}

// null when the folder has no usable .mcp.json, or Claude Code does not trust the folder. An
// untrusted folder's ssh-mcp entries are named in one problem, so the user learns why they are
// missing.
async function readMcpJsonSource(
  dir: string,
  projects: Record<string, unknown> | undefined,
  env: NodeJS.ProcessEnv,
  problems: string[],
): Promise<ConfigSource | null> {
  const file = join(dir, ".mcp.json");
  const json = await readJson(file, problems);
  if (json === undefined) return null;
  const parsed = McpJsonSchema.safeParse(json);
  if (!parsed.success) {
    problems.push(`${file}: not an MCP config`);
    return null;
  }
  if (parsed.data.mcpServers === undefined) return null;
  const source: ConfigSource = {
    key: `project:${file}`,
    label: file,
    servers: parsed.data.mcpServers,
  };
  if (isTrusted(projects, dir)) return source;
  if (listsSshMcp(source, env)) {
    problems.push(`${file}: ssh-mcp entries skipped, Claude Code does not trust ${dir}`);
  }
  return null;
}

async function collectSources(input: DiscoveryInput, problems: string[]): Promise<ConfigSource[]> {
  const sources: ConfigSource[] = [];
  const json = await readJson(input.claudeConfigFile, problems);
  let claude: z.output<typeof ClaudeConfigSchema> | null = null;
  if (json !== undefined) {
    const parsed = ClaudeConfigSchema.safeParse(json);
    if (parsed.success) claude = parsed.data;
    else problems.push(`${input.claudeConfigFile}: not a Claude config`);
  }
  if (claude?.mcpServers !== undefined) {
    sources.push({ key: "user", label: "User config", servers: claude.mcpServers });
  }
  for (const dir of input.workspaceDirectories) {
    const project = ProjectSchema.safeParse(claude?.projects?.[dir]);
    if (project.success && project.data.mcpServers !== undefined) {
      sources.push({
        key: `local:${dir}`,
        label: `Local config for ${dir}`,
        servers: project.data.mcpServers,
      });
    }
    const mcpJson = await readMcpJsonSource(dir, claude?.projects, input.env, problems);
    if (mcpJson !== null) sources.push(mcpJson);
  }
  return sources;
}

// User scope first, then each workspace's local and project scope in the order Paseo lists them.
// Entries with the same expanded command, args and env are one server, under its first source.
// Unset variables expand to "", so they are part of the key: entries that differ only in which
// variables are unset stay apart.
export async function discoverSshServers(input: DiscoveryInput): Promise<Discovery> {
  const problems: string[] = [];
  const servers: SshServer[] = [];
  const seen = new Set<string>();
  for (const source of await collectSources(input, problems)) {
    for (const [name, raw] of Object.entries(source.servers)) {
      const server = toServer(source, name, raw, input.env);
      if (server === null) continue;
      const key = `${server.fingerprint}\0${server.missingVariables.join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      servers.push(server);
    }
  }
  return { servers, problems };
}
