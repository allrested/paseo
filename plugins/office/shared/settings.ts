import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** Host-wide. Off removes the office tools from agent sessions opened afterwards. */
export const officeHostSettings = defineSettings({
  id: "office",
  scope: "host",
  version: 1,
  schema: z.object({ agentTools: z.boolean().default(true) }),
});

/** Per device. Off shows the structure view and never loads three.js. */
export const officeDeviceSettings = defineSettings({
  id: "office-device",
  scope: "device",
  version: 1,
  schema: z.object({ threeD: z.boolean().default(true) }),
});
