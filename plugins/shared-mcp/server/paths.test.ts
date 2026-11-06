import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sharedMcpHome } from "./paths.js";

describe("sharedMcpHome", () => {
  it("uses an absolute PASEO_HOME as given", () => {
    const paseoHome = resolve("/srv/paseo-home");

    expect(sharedMcpHome({ PASEO_HOME: paseoHome })).toBe(join(paseoHome, "shared-mcp"));
  });

  it("expands a leading ~/ in PASEO_HOME to the user's home directory", () => {
    expect(sharedMcpHome({ PASEO_HOME: "~/paseo-dev" })).toBe(
      join(homedir(), "paseo-dev", "shared-mcp"),
    );
  });

  it("expands a bare ~ in PASEO_HOME", () => {
    expect(sharedMcpHome({ PASEO_HOME: "~" })).toBe(join(homedir(), "shared-mcp"));
  });

  it("resolves a relative PASEO_HOME against the working directory, as the daemon does", () => {
    expect(sharedMcpHome({ PASEO_HOME: ".dev/paseo-home" })).toBe(
      join(process.cwd(), ".dev", "paseo-home", "shared-mcp"),
    );
  });

  it("falls back to ~/.paseo when PASEO_HOME is unset", () => {
    expect(sharedMcpHome({})).toBe(join(homedir(), ".paseo", "shared-mcp"));
  });

  it("creates no directory, so a start that never needs the home leaves the disk alone", () => {
    const root = mkdtempSync(join(tmpdir(), "shared-mcp-paths-"));
    const paseoHome = join(root, "paseo-home");
    try {
      expect(sharedMcpHome({ PASEO_HOME: paseoHome })).toBe(join(paseoHome, "shared-mcp"));
      expect(existsSync(paseoHome)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
