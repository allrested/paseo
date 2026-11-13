import { defineRpc } from "@getpaseo/plugin";
import { z } from "zod";

export const AndroidStateSchema = z.object({ available: z.boolean(), agentTools: z.boolean() });
export type AndroidState = z.output<typeof AndroidStateSchema>;

export const androidStateRpc = defineRpc({
  name: "android.state.request",
  input: z.object({}),
  output: AndroidStateSchema,
});
