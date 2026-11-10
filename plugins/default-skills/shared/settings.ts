import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";
import { SKILLS, type SkillId } from "./catalog.js";

const SkillSwitchesSchema = z.object(
  Object.fromEntries(SKILLS.map((skill) => [skill.id, z.boolean().default(skill.defaultOn)])) as {
    [Id in SkillId]: z.ZodDefault<z.ZodBoolean>;
  },
);

export type SkillSwitches = z.output<typeof SkillSwitchesSchema>;

export const defaultSkillsSettings = defineSettings({
  id: "skills",
  scope: "host",
  version: 1,
  schema: SkillSwitchesSchema,
});
