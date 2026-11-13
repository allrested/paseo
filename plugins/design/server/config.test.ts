import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readDesignConfig } from "./config.js";

const dir = mkdtempSync(join(tmpdir(), "design-config-"));
const keyFile = join(dir, "server-key");
writeFileSync(keyFile, "k\n", { mode: 0o600 });

const full = {
  FIGCRAFT_URL: "wss://figcraft.dev.mtapp.dev/",
  FIGCRAFT_WEB_URL: "https://figcraft.dev.mtapp.dev/app/",
  FIGCRAFT_SERVER_KEY_FILE: keyFile,
};

describe("readDesignConfig", () => {
  it("reads the server, web build, key, CLI and cap", () => {
    expect(
      readDesignConfig({ ...full, FIGCRAFT_CLI: "/opt/figcraft-cli", DESIGN_MAX_BRIDGES: "2" }),
    ).toEqual({
      serverUrl: "wss://figcraft.dev.mtapp.dev/",
      webUrl: "https://figcraft.dev.mtapp.dev/app/",
      serverKey: "k",
      cliPath: "/opt/figcraft-cli",
      maxBridges: 2,
    });
  });
  it("defaults the CLI to figcraft-cli on PATH and the cap to 3", () => {
    expect(readDesignConfig(full)).toMatchObject({ cliPath: "figcraft-cli", maxBridges: 3 });
  });
  it("is off without a server or key, and says which", () => {
    expect(readDesignConfig({})).toEqual({ disabled: "FIGCRAFT_URL is not set on this host" });
    expect(readDesignConfig({ FIGCRAFT_URL: full.FIGCRAFT_URL })).toEqual({
      disabled: "FIGCRAFT_SERVER_KEY_FILE is not set on this host",
    });
  });
  it("is off when the key file cannot be read or is empty", () => {
    const empty = join(dir, "empty");
    writeFileSync(empty, "\n");
    expect(readDesignConfig({ ...full, FIGCRAFT_SERVER_KEY_FILE: join(dir, "missing") })).toEqual({
      disabled: "Unable to read FIGCRAFT_SERVER_KEY_FILE",
    });
    expect(readDesignConfig({ ...full, FIGCRAFT_SERVER_KEY_FILE: empty })).toEqual({
      disabled: "FIGCRAFT_SERVER_KEY_FILE is empty",
    });
  });
  it("ignores an empty FIGCRAFT_SERVER_KEY, which carries nothing", () => {
    expect(readDesignConfig({ ...full, FIGCRAFT_SERVER_KEY: "" })).toMatchObject({
      serverKey: "k",
    });
  });
  it("refuses the key itself in the env: every agent and terminal inherits the daemon's env", () => {
    expect(readDesignConfig({ ...full, FIGCRAFT_SERVER_KEY: "k" })).toEqual({
      disabled:
        "Put the server key in a file named by FIGCRAFT_SERVER_KEY_FILE, not in FIGCRAFT_SERVER_KEY: agents and terminals inherit the daemon's env",
    });
  });
  it("refuses FigCraft's public server", () => {
    expect(readDesignConfig({ ...full, FIGCRAFT_URL: "wss://collab.craftapps.dev/" })).toEqual({
      disabled: "FIGCRAFT_URL names FigCraft's public server; design mode uses your own",
    });
  });
  it("refuses an address that is not a ws:// or wss:// URL", () => {
    expect(readDesignConfig({ ...full, FIGCRAFT_URL: "figcraft.dev.mtapp.dev" })).toEqual({
      disabled: "FIGCRAFT_URL must be a ws:// or wss:// address",
    });
  });
  it("derives the web build from the server when FIGCRAFT_WEB_URL is absent", () => {
    const { FIGCRAFT_WEB_URL: _, ...rest } = full;
    expect(readDesignConfig(rest)).toMatchObject({ webUrl: "https://figcraft.dev.mtapp.dev/app/" });
  });
});
