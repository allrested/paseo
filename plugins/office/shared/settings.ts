import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/**
 * Host-wide. `agentTools` off removes the office tools from agent sessions opened afterwards.
 * `notesFolder` is the absolute path the stand-up notes are written in, empty for none, and
 * `notesTimeZone` the IANA zone of their 8:00 run, empty for the host's.
 */
export const officeHostSettings = defineSettings({
  id: "office",
  scope: "host",
  version: 2,
  schema: z.object({
    agentTools: z.boolean().default(true),
    notesFolder: z.string().default(""),
    notesTimeZone: z.string().default(""),
  }),
  // Version 1 had only `agentTools`: it stays, and the notes fields take their defaults.
  migrate: (values) => values,
});

/** The office's views: the 3D floor, the 2D pixel floor and the list. */
export const OFFICE_VIEWS = ["3d", "2d", "list"] as const;
export type OfficeViewChoice = (typeof OFFICE_VIEWS)[number];

/**
 * Per device. `view` is the view somebody chose. A device that never chose has only `threeD`,
 * from when the office had a 3D switch: off is the list, on leaves the choice to the device. A
 * save writes both, so a client from before `view` still reads its switch.
 */
export const officeDeviceSettings = defineSettings({
  id: "office-device",
  scope: "device",
  version: 1,
  schema: z.object({
    threeD: z.boolean().default(true),
    view: z.enum(OFFICE_VIEWS).optional(),
  }),
});
