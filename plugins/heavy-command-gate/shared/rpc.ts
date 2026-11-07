import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const RunningCommandSchema = z.object({
  id: z.string(),
  /** PASEO_AGENT_ID of the shim's environment; null when it had none. */
  agentId: z.string().nullable(),
  agentTitle: z.string().nullable(),
  command: z.string(),
  pid: z.number().int(),
  elapsedMs: z.number().int().nonnegative(),
  /** RSS of the shim's process tree; null when it runs in another pid namespace or has gone. */
  rssBytes: z.number().int().nonnegative().nullable(),
  estimateBytes: z.number().int().positive(),
  /** Started by the starvation guard without enough free memory. */
  forced: z.boolean(),
});

export type RunningCommand = z.output<typeof RunningCommandSchema>;

export const WaitingCommandSchema = z.object({
  id: z.string(),
  agentId: z.string().nullable(),
  agentTitle: z.string().nullable(),
  command: z.string(),
  pid: z.number().int(),
  /** 1 for the oldest waiter. */
  position: z.number().int().positive(),
  waitedMs: z.number().int().nonnegative(),
  estimateBytes: z.number().int().positive(),
  waitingOn: z.enum(["slot", "memory"]),
});

export type WaitingCommand = z.output<typeof WaitingCommandSchema>;

export const GateStatusSchema = z.object({
  state: z.enum(["on", "off", "unavailable"]),
  /** Why the gate is unavailable; null otherwise. */
  error: z.string().nullable(),
  slots: z.number().int().positive(),
  reserveBytes: z.number().int().nonnegative(),
  freeBytes: z.number().int().nonnegative().nullable(),
  running: z.array(RunningCommandSchema),
  waiting: z.array(WaitingCommandSchema),
});

export type GateStatus = z.output<typeof GateStatusSchema>;

export const statusRpc = defineRpc({
  name: "heavy-command-gate.status.request",
  input: z.object({}),
  output: GateStatusSchema,
});
