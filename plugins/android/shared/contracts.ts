import { defineRpc, defineSubscription } from "@getpaseo/plugin";
import { z } from "zod";

export const AndroidStateSchema = z.object({ available: z.boolean(), agentTools: z.boolean() });
export type AndroidState = z.output<typeof AndroidStateSchema>;

export const androidStateRpc = defineRpc({
  name: "android.state.request",
  input: z.object({}),
  output: AndroidStateSchema,
});

export const PointSchema = z.object({ x: z.number(), y: z.number() });
export type Point = z.output<typeof PointSchema>;

export const AndroidStreamEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("ready"),
    streamId: z.string(),
    /** The device's screen in pixels: what a tap's x and y are counted in. */
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  }),
  z.object({ type: z.literal("picture"), seq: z.number().int().positive(), png: z.string() }),
  z.object({ type: z.literal("problem"), message: z.string() }),
]);
export type AndroidStreamEvent = z.output<typeof AndroidStreamEventSchema>;

export const androidStreamSubscription = defineSubscription({
  name: "android.stream",
  input: z.object({}),
  event: AndroidStreamEventSchema,
});

export const ANDROID_KEYS = ["back", "home", "recents", "enter", "delete"] as const;
export type AndroidKey = (typeof ANDROID_KEYS)[number];

export const AndroidInputSchema = z.object({
  streamId: z.string(),
  /** The seq of the last picture the viewer has shown. */
  shown: z.number().int().positive().optional(),
  /** Device pixels. */
  tap: PointSchema.optional(),
  swipe: z
    .object({ from: PointSchema, to: PointSchema, durationMs: z.number().int().min(50).max(3000) })
    .optional(),
  key: z.enum(ANDROID_KEYS).optional(),
  text: z.string().max(500).optional(),
});
export type AndroidInput = z.output<typeof AndroidInputSchema>;

export const androidInputRpc = defineRpc({
  name: "android.stream.input.request",
  input: AndroidInputSchema,
  /** `message` says why the device refused an input that left the stream open. */
  output: z.object({ ok: z.boolean(), message: z.string().optional() }),
});
