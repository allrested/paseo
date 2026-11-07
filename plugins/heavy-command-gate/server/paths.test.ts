import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { gateHome, gatePaths } from "./paths.js";

describe("gateHome", () => {
  it("uses an absolute PASEO_HOME as given", () => {
    const paseoHome = resolve("/srv/paseo-home");
    expect(gateHome({ PASEO_HOME: paseoHome })).toBe(join(paseoHome, "heavy-command-gate"));
  });

  it("expands a leading ~/ in PASEO_HOME to the user's home directory", () => {
    expect(gateHome({ PASEO_HOME: "~/paseo-dev" })).toBe(
      join(homedir(), "paseo-dev", "heavy-command-gate"),
    );
  });

  it("expands a bare ~ in PASEO_HOME", () => {
    expect(gateHome({ PASEO_HOME: "~" })).toBe(join(homedir(), "heavy-command-gate"));
  });

  it("resolves a relative PASEO_HOME against the working directory, as the daemon does", () => {
    expect(gateHome({ PASEO_HOME: ".dev/paseo-home" })).toBe(
      join(process.cwd(), ".dev", "paseo-home", "heavy-command-gate"),
    );
  });

  it("falls back to ~/.paseo when PASEO_HOME is unset", () => {
    expect(gateHome({})).toBe(join(homedir(), ".paseo", "heavy-command-gate"));
  });

  it("creates no directory", () => {
    const root = mkdtempSync(join(tmpdir(), "heavy-gate-paths-"));
    const paseoHome = join(root, "paseo-home");
    try {
      expect(gateHome({ PASEO_HOME: paseoHome })).toBe(join(paseoHome, "heavy-command-gate"));
      expect(existsSync(paseoHome)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("gatePaths", () => {
  it("lays out the script, the shim directory, the config and the socket in the home", () => {
    expect(gatePaths("/srv/gate")).toEqual({
      home: "/srv/gate",
      script: join("/srv/gate", "gate.mjs"),
      binDir: join("/srv/gate", "bin"),
      configPath: join("/srv/gate", "config.json"),
      socketPath: join("/srv/gate", "gate.sock"),
    });
  });
});
