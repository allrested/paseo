import { describe, expect, it } from "vitest";
import { skillPaths } from "./paths.js";

describe("skillPaths", () => {
  it("uses ~/.claude/skills and ~/.paseo when the daemon sets neither variable", () => {
    expect(skillPaths({}, "/home/u")).toEqual({
      skillsDirectory: "/home/u/.claude/skills",
      recordFile: "/home/u/.paseo/default-skills/installed.json",
    });
  });

  it("follows the daemon's CLAUDE_CONFIG_DIR and PASEO_HOME", () => {
    expect(
      skillPaths({ CLAUDE_CONFIG_DIR: "/srv/claude", PASEO_HOME: "~/dev/paseo-home" }, "/home/u"),
    ).toEqual({
      skillsDirectory: "/srv/claude/skills",
      recordFile: "/home/u/dev/paseo-home/default-skills/installed.json",
    });
  });
});
