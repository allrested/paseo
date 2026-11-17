import { expect, test } from "vitest";
import { officeHostSettings } from "./settings.js";

test("version 1 settings keep their Agent tools choice and have no notes folder", async () => {
  // As the daemon reads a stored document of an older version: migrate, then parse.
  const migrated = await officeHostSettings.migrate?.({ agentTools: false }, 1);
  expect(officeHostSettings.version).toBe(2);
  expect(await officeHostSettings.schema.parseAsync(migrated)).toEqual({
    agentTools: false,
    notesFolder: "",
    notesTimeZone: "",
  });
});
