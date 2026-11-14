import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

// The Stack tab: the parts of this instance's stack, each read from this host.

const ProbeSchema = z.object({
  ok: z.boolean(),
  /** How long the answer took. Null when there was none. */
  ms: z.number().nullable(),
  error: z.string().nullable(),
});
export type Probe = z.output<typeof ProbeSchema>;

const OffSchema = z.object({ status: z.literal("off") });

export const StackReadingSchema = z.object({
  readAt: z.string(),
  paseo: z.object({ version: z.string().nullable(), uptimeSeconds: z.number() }),
  figcraft: z.discriminatedUnion("status", [
    OffSchema,
    z.object({
      status: z.literal("on"),
      server: ProbeSchema,
      /** Null when FIGCRAFT_WEB_URL is not set. */
      web: ProbeSchema.nullable(),
      cliVersion: z.string().nullable(),
      /** Whether the key file is there; never its contents. */
      keyFile: z.enum(["present", "missing", "empty", "not set"]),
    }),
  ]),
  android: z.discriminatedUnion("status", [
    OffSchema,
    z.object({
      status: z.literal("on"),
      /** `adb get-state`, or null when adb did not answer. */
      state: z.string().nullable(),
      androidVersion: z.string().nullable(),
      maestro: z.boolean(),
      error: z.string().nullable(),
    }),
  ]),
  deploy: z.discriminatedUnion("status", [
    OffSchema,
    z.object({
      status: z.literal("on"),
      repo: z.string(),
      /** The newest v* tag with a Docker run. */
      tag: z.string().nullable(),
      runAt: z.string().nullable(),
      /** The run's conclusion, or its status while it runs. */
      docker: z.string().nullable(),
      /** The deploy job's conclusion, when the run has one. */
      deployJob: z.string().nullable(),
      error: z.string().nullable(),
    }),
  ]),
});
export type StackReading = z.output<typeof StackReadingSchema>;

export const stackRpc = defineRpc({
  name: "resource-manager.stack.request",
  input: z.object({}),
  output: StackReadingSchema,
});
