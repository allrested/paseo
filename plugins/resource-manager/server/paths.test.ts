import { describe, expect, it } from "vitest";
import {
  claudeConfigFile,
  expandHomeDir,
  heavyGateBinDir,
  paseoHome,
  resourceManagerRunDir,
  sharedMcpRunDir,
} from "./paths.js";

const HOME = "/home/u";

describe("paths", () => {
  it("expands only ~ and a leading ~/", () => {
    expect(expandHomeDir("~", HOME)).toBe("/home/u");
    expect(expandHomeDir("~/x", HOME)).toBe("/home/u/x");
    expect(expandHomeDir("/srv/~x", HOME)).toBe("/srv/~x");
  });

  it("defaults PASEO_HOME to ~/.paseo and resolves a relative one", () => {
    expect(paseoHome({}, HOME)).toBe("/home/u/.paseo");
    expect(paseoHome({ PASEO_HOME: "~/dev-home" }, HOME)).toBe("/home/u/dev-home");
    expect(paseoHome({ PASEO_HOME: "/srv/paseo" }, HOME)).toBe("/srv/paseo");
  });

  it("puts the run and shim directories under PASEO_HOME", () => {
    const env = { PASEO_HOME: "/srv/paseo" };
    expect(resourceManagerRunDir(env, HOME)).toBe("/srv/paseo/resource-manager/run");
    expect(sharedMcpRunDir(env, HOME)).toBe("/srv/paseo/shared-mcp/run");
    expect(heavyGateBinDir(env, HOME)).toBe("/srv/paseo/heavy-command-gate/bin");
  });

  it("finds .claude.json under CLAUDE_CONFIG_DIR when set, else in the home directory", () => {
    expect(claudeConfigFile({}, HOME)).toBe("/home/u/.claude.json");
    expect(claudeConfigFile({ CLAUDE_CONFIG_DIR: "~/claude" }, HOME)).toBe(
      "/home/u/claude/.claude.json",
    );
  });
});
