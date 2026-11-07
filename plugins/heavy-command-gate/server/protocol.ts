import { z } from "zod";
import type { PatternRule } from "./shim/classify.js";

/**
 * Set on every process of a command the shim let through after asking the gate, admitted or failed
 * open. A shim that sees it runs straight through, so `npm run typecheck` calling `tsc` cannot wait
 * on itself. The shim that asked the gate does not carry it. A shim started inside a held
 * command inherits it and execs the real binary in its place.
 */
export const HELD_ENV = "PASEO_HEAVY_GATE_HELD";

/** The longest line the gate reads from a shim. A longer one drops the connection. */
export const MAX_LINE_LENGTH = 64 * 1024;

// Read by the shim from its own /proc entries. pidNamespace, bootId and initStartTime say which
// processes its pid names: after a container restart or a reboot the same pid names another one.
export const ShimProcessSchema = z.object({
  pid: z.number().int().positive(),
  /** Field 22 of /proc/<pid>/stat; null without /proc. */
  startTime: z.number().int().nonnegative().nullable(),
  pidNamespace: z.string().nullable(),
  bootId: z.string().nullable(),
  initStartTime: z.number().int().nonnegative().nullable(),
});

export type ShimProcess = z.output<typeof ShimProcessSchema>;

export const ShimHelloSchema = z.object({
  type: z.literal("hello"),
  version: z.literal(1),
  command: z.string().min(1).max(4096),
  estimateBytes: z.number().int().positive(),
  agentId: z.string().min(1).max(200).nullable(),
  process: ShimProcessSchema,
});

export type ShimHello = z.output<typeof ShimHelloSchema>;

export interface WaitNotice {
  type: "wait";
  /** Commands queued before this one. */
  ahead: number;
  freeBytes: number | null;
  /** The command's estimate plus the reserve. */
  neededBytes: number;
  waitingOn: "slot" | "memory";
}

export interface GoNotice {
  type: "go";
  /** Started by the starvation guard without enough free memory. */
  forced: boolean;
  freeBytes: number | null;
  neededBytes: number;
  waitedMs: number;
}

export type ServerNotice = WaitNotice | GoNotice;

/** `config.json` in the gate home: what the shims classify against. */
export interface ShimConfig {
  version: 1;
  enabled: boolean;
  patterns: PatternRule[];
}
