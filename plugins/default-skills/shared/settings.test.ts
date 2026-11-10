import { readdir, readFile, lstat } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { SKILLS } from "./catalog.js";
import { defaultSkillsSettings } from "./settings.js";

const vendor = fileURLToPath(new URL("../vendor", import.meta.url));

describe("defaultSkillsSettings", () => {
  it("turns on the four reviewed skills by default and has no DensePack switch", () => {
    expect(defaultSkillsSettings.schema.parse({})).toEqual({
      "ub-mode": true,
      "ai-design-skills": true,
      "anti-slop": true,
      "ui-ux-pro-max": true,
    });
  });

  it("keeps a switch the user turned off", () => {
    expect(defaultSkillsSettings.schema.parse({ "anti-slop": false })["anti-slop"]).toBe(false);
  });
});

describe("vendor", () => {
  it("holds every catalog folder with its SKILL.md and licence, and only those folders", async () => {
    for (const skill of SKILLS) {
      expect((await readdir(join(vendor, skill.id))).sort()).toEqual([...skill.folders].sort());
      for (const folder of skill.folders) {
        const files = await readdir(join(vendor, skill.id, folder));
        expect(files).toContain("SKILL.md");
        expect(files).toContain("LICENSE");
        const skillFile = await readFile(join(vendor, skill.id, folder, "SKILL.md"), "utf8");
        expect(skillFile).toMatch(new RegExp(`^---\\nname: ${folder}\\n`));
      }
    }
  });

  it("holds no links, which the sync refuses to copy", async () => {
    const links: string[] = [];
    async function walk(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const path = join(directory, entry.name);
        if ((await lstat(path)).isSymbolicLink()) links.push(path);
        else if (entry.isDirectory()) await walk(path);
      }
    }
    await walk(vendor);
    expect(links).toEqual([]);
  });
});
