import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Host-wide. Off removes the Android tools from agent sessions opened afterwards. */
export const androidHostSettings = defineSettings({
  id: "android",
  scope: "host",
  version: 1,
  schema: z.object({ agentTools: z.boolean().default(true) }),
});
