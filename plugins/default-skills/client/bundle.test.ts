import { describe, expect, it } from "vitest";
import { DESIGN_BUNDLE, SKILLS } from "../shared/catalog.js";
import { defaultSkillsSettings, type SkillSwitches } from "../shared/settings.js";
import { countOn, describeBundle, switchBundle } from "./bundle.js";

function switches(change: Partial<SkillSwitches> = {}): SkillSwitches {
  return { ...defaultSkillsSettings.schema.parse({}), ...change };
}

const members = DESIGN_BUNDLE.members;

describe("the design bundle", () => {
  it("holds the four design entries of the catalog and leaves ub-mode out", () => {
    const ids = new Set<string>(SKILLS.map((skill) => skill.id));
    expect([...members].sort()).toEqual(
      ["ai-design-skills", "anti-slop", "ui-ux-pro-max", "unslop"].sort(),
    );
    expect(members.every((id) => ids.has(id))).toBe(true);
  });

  it("counts the members that are on", () => {
    expect(countOn(switches(), members)).toBe(4);
    expect(countOn(switches({ unslop: false, "anti-slop": false }), members)).toBe(2);
    expect(countOn(switches({ "ub-mode": false }), members)).toBe(4);
  });

  it("turns every member off and leaves the other skills as they were", () => {
    expect(switchBundle(switches(), members, false)).toEqual({
      "ub-mode": true,
      "ai-design-skills": false,
      "anti-slop": false,
      "ui-ux-pro-max": false,
      unslop: false,
    });
  });

  it("turns every member on from a mixed state and keeps ub-mode off", () => {
    const mixed = switches({ "ub-mode": false, unslop: false, "ui-ux-pro-max": false });
    expect(switchBundle(mixed, members, true)).toEqual({
      "ub-mode": false,
      "ai-design-skills": true,
      "anti-slop": true,
      "ui-ux-pro-max": true,
      unslop: true,
    });
  });

  it("does not change the switches it was given", () => {
    const before = switches();
    switchBundle(before, members, false);
    expect(before.unslop).toBe(true);
  });

  it("says how many are on, or Off", () => {
    expect(describeBundle(4, 4)).toBe("4 of 4 on");
    expect(describeBundle(1, 4)).toBe("1 of 4 on");
    expect(describeBundle(0, 4)).toBe("Off");
  });
});
