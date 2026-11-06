import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const ServerStateSchema = z.enum([
  "starting",
  "healthy",
  "unhealthy",
  "backoff",
  "failing",
  "blocked",
  "external",
  "disabled",
]);

export const ServerStatusSchema = z.object({
  id: z.string(),
  label: z.string(),
  port: z.number(),
  state: ServerStateSchema,
  pid: z.number().nullable(),
  startedAt: z.string().nullable(),
  restarts: z.number(),
  rssBytes: z.number().nullable(),
  lastError: z.string().nullable(),
  nextRetryAt: z.string().nullable(),
  logTail: z.array(z.string()),
});

export type ServerStatus = z.output<typeof ServerStatusSchema>;

export const statusRpc = defineRpc({
  name: "shared-mcp.status.request",
  input: z.object({}),
  output: z.object({ servers: z.array(ServerStatusSchema) }),
});

export const restartRpc = defineRpc({
  name: "shared-mcp.restart.request",
  input: z.object({ id: z.string() }),
  output: z.object({ ok: z.boolean(), error: z.string().nullable() }),
});
