import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// Agent statuses whose runtime can hold processes. A "closed" agent has none, so it gets no row.
export const LiveStatusSchema = z.enum(["initializing", "idle", "running", "error"]);
export type LiveStatus = z.output<typeof LiveStatusSchema>;

// Close ends a runtime only while the agent is idle. A starting, running or errored agent keeps it.
export const ClosableStatusSchema = z.enum(["idle"]);

export function isClosableStatus(status: string): boolean {
  return ClosableStatusSchema.safeParse(status).success;
}

// Display order of the group rows.
export const GroupKindSchema = z.enum(["daemon", "sharedMcp", "heavyGate", "other"]);
export type GroupKind = z.output<typeof GroupKindSchema>;

export const HostSummarySchema = z.object({
  /** cgroup v2 memory.current; null without cgroup v2. */
  memoryUsedBytes: z.number().nullable(),
  /** cgroup v2 memory.max; null when it reads "max" (no cap) or is missing. */
  memoryLimitBytes: z.number().nullable(),
  swapUsedBytes: z.number().nullable(),
  swapTotalBytes: z.number().nullable(),
  hostAvailableBytes: z.number().nullable(),
  hostTotalBytes: z.number().nullable(),
  load1: z.number().nullable(),
  load5: z.number().nullable(),
  load15: z.number().nullable(),
  cores: z.number().int().positive(),
});
export type HostSummary = z.output<typeof HostSummarySchema>;

export const AgentUsageSchema = z.object({
  agentId: z.string(),
  title: z.string().nullable(),
  provider: z.string(),
  status: LiveStatusSchema,
  rssBytes: z.number(),
  /** 100 is one core. Null when the sample window is empty. */
  cpuPercent: z.number().nullable(),
  /** The agent's updatedAt while it is idle, else null. */
  idleSince: z.string().nullable(),
  processCount: z.number().int(),
});
export type AgentUsage = z.output<typeof AgentUsageSchema>;

export const GroupUsageSchema = z.object({
  kind: GroupKindSchema,
  rssBytes: z.number(),
  cpuPercent: z.number().nullable(),
  processCount: z.number().int(),
});
export type GroupUsage = z.output<typeof GroupUsageSchema>;

export const LocalReadingSchema = z.object({
  readAt: z.string(),
  host: HostSummarySchema,
  agents: z.array(AgentUsageSchema),
  groups: z.array(GroupUsageSchema),
  /** Why the agent list failed. Agent processes then count under "other". */
  agentsError: z.string().nullable(),
});
export type LocalReading = z.output<typeof LocalReadingSchema>;

export const ServerEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  /** Where the entry was found, such as "User config" or "/repo/.mcp.json". */
  source: z.string(),
});
export type ServerEntry = z.output<typeof ServerEntrySchema>;

export const ServerListSchema = z.object({
  servers: z.array(ServerEntrySchema),
  /** Config files that could not be read, one line each, without their content. */
  problems: z.array(z.string()),
});
export type ServerList = z.output<typeof ServerListSchema>;

export const MountUsageSchema = z.object({
  mount: z.string(),
  totalBytes: z.number(),
  usedBytes: z.number(),
  availableBytes: z.number(),
});
export type MountUsage = z.output<typeof MountUsageSchema>;

export const RemoteProcessSchema = z.object({
  pid: z.number().int(),
  rssBytes: z.number(),
  command: z.string(),
});
export type RemoteProcess = z.output<typeof RemoteProcessSchema>;

export const RemoteSnapshotSchema = z.object({
  memTotalBytes: z.number(),
  memAvailableBytes: z.number(),
  swapTotalBytes: z.number(),
  swapFreeBytes: z.number(),
  load1: z.number(),
  load5: z.number(),
  load15: z.number(),
  cores: z.number().int().positive(),
  mounts: z.array(MountUsageSchema),
  processes: z.array(RemoteProcessSchema),
});
export type RemoteSnapshot = z.output<typeof RemoteSnapshotSchema>;

export const ServerReadingSchema = z.object({
  id: z.string(),
  /** The last reading that parsed. It stays while later readings fail. */
  snapshot: RemoteSnapshotSchema.nullable(),
  readAt: z.string().nullable(),
  error: z.string().nullable(),
});
export type ServerReading = z.output<typeof ServerReadingSchema>;

export const CloseAgentResultSchema = z.object({
  ok: z.boolean(),
  error: z.string().nullable(),
});
export type CloseAgentResult = z.output<typeof CloseAgentResultSchema>;

export const localRpc = defineRpc({
  name: "resource-manager.local.request",
  input: z.object({}),
  output: LocalReadingSchema,
});

export const serversRpc = defineRpc({
  name: "resource-manager.servers.request",
  input: z.object({}),
  output: ServerListSchema,
});

export const serverRpc = defineRpc({
  name: "resource-manager.server.request",
  input: z.object({ id: z.string().min(1) }),
  output: ServerReadingSchema,
});

export const closeAgentRpc = defineRpc({
  name: "resource-manager.close_agent.request",
  input: z.object({ agentId: z.string().min(1) }),
  output: CloseAgentResultSchema,
});
