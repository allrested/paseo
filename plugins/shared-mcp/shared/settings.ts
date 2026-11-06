import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

// zod's default regex message prints the raw pattern. Other fields keep zod's text, which has no
// field name; the Definitions screen shows each issue's path next to its message.
const SERVER_ID_MESSAGE =
  "Server id must start with a lowercase letter and use only lowercase letters, digits, and dashes";

// agentEnv replaces that variable in every agent Paseo launches.
const RESERVED_ENV_NAME = /^(PATH|HOME|NODE_OPTIONS)$|^(PASEO_|LD_|DYLD_)/;
const EnvNameSchema = z
  .string()
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    "Use letters, digits and underscores, not starting with a digit",
  )
  .refine((name) => !RESERVED_ENV_NAME.test(name), {
    message: "PATH, HOME, NODE_OPTIONS and names starting with PASEO_, LD_ or DYLD_ are reserved",
  });

export const ServerDefinitionSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]*$/, SERVER_ID_MESSAGE),
  label: z.string().min(1),
  // Run with `sh -c`.
  command: z.string().min(1),
  cwd: z.string().optional(),
  env: z.record(z.string(), z.string()).default({}),
  port: z.number().int().min(1).max(65535),
  healthPath: z.string().startsWith("/").default("/mcp"),
  // Paths that must exist before the server starts.
  requires: z.array(z.string()).default([]),
  bearerToken: z.object({ serverEnv: EnvNameSchema, agentEnv: EnvNameSchema }).optional(),
  enabled: z.boolean().default(true),
});

export type ServerDefinition = z.output<typeof ServerDefinitionSchema>;

const SettingsValuesSchema = z.object({
  servers: z.array(ServerDefinitionSchema).default([]),
});

type SettingsValues = z.output<typeof SettingsValuesSchema>;

function rejectDuplicates(values: SettingsValues, context: z.RefinementCtx): void {
  const ids = new Set<string>();
  const portOwners = new Map<number, string>();
  for (const [index, server] of values.servers.entries()) {
    if (ids.has(server.id)) {
      context.addIssue({
        code: "custom",
        path: ["servers", index, "id"],
        message: `Server id "${server.id}" is used more than once`,
      });
    }
    ids.add(server.id);
    const owner = portOwners.get(server.port);
    if (owner === undefined) {
      portOwners.set(server.port, server.id);
    } else {
      context.addIssue({
        code: "custom",
        path: ["servers", index, "port"],
        message: `Port ${server.port} is used by both "${owner}" and "${server.id}"`,
      });
    }
  }
}

export const sharedMcpSettings = defineSettings({
  id: "servers",
  scope: "host",
  version: 1,
  schema: SettingsValuesSchema.superRefine(rejectDuplicates),
});
