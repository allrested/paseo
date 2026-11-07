import { spawnSync } from "node:child_process";
import {
  lstatSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { gateSettings, gbToBytes } from "../../shared/settings.js";
import { gatePaths, type GatePaths } from "../paths.js";
import type { ShimConfig } from "../protocol.js";
import {
  SHIMMED_COMMANDS,
  buildShimScript,
  installShims,
  resolveShimInterpreter,
  toShimConfig,
  writeShimConfig,
  type InterpreterProbe,
} from "./install.js";

let root = "";
let paths: GatePaths = gatePaths("");

function probe(overrides: Partial<InterpreterProbe>): InterpreterProbe {
  return {
    execPath: "/usr/local/bin/node",
    isElectron: false,
    pathEnv: "/usr/bin:/bin",
    platform: "linux",
    isExecutable: () => false,
    ...overrides,
  };
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "heavy-gate-install-"));
  paths = gatePaths(join(root, "heavy-command-gate"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("resolveShimInterpreter", () => {
  it("uses the daemon's own node", () => {
    expect(resolveShimInterpreter(probe({}))).toEqual({ ok: true, path: "/usr/local/bin/node" });
  });

  it("uses the first absolute node on PATH under Electron", () => {
    const electron = probe({
      execPath: "/opt/Paseo/paseo",
      isElectron: true,
      pathEnv: "bin:/opt/missing:/usr/bin:/usr/local/bin",
      isExecutable: (file) => file === "bin/node" || file.endsWith("/bin/node"),
    });
    expect(resolveShimInterpreter(electron)).toEqual({ ok: true, path: "/usr/bin/node" });
  });

  it("refuses under Electron without node on PATH", () => {
    expect(resolveShimInterpreter(probe({ isElectron: true }))).toEqual({
      ok: false,
      reason: "no node binary on the daemon PATH",
    });
  });

  it("refuses on Windows", () => {
    expect(resolveShimInterpreter(probe({ platform: "win32" }))).toEqual({
      ok: false,
      reason: "PATH shims need a POSIX system",
    });
  });

  it("refuses a node path with whitespace, which a #! line cannot hold", () => {
    expect(resolveShimInterpreter(probe({ execPath: "/Applications/My Apps/node" }))).toEqual({
      ok: false,
      reason:
        "the node path /Applications/My Apps/node contains whitespace, which a #! line cannot hold",
    });
  });

  it("refuses a node path longer than 200 characters", () => {
    expect(resolveShimInterpreter(probe({ execPath: `/${"n".repeat(200)}` }))).toEqual({
      ok: false,
      reason: "the node path is longer than 200 characters, more than a #! line can hold",
    });
  });
});

describe("toShimConfig", () => {
  it("turns settings into word lists and byte estimates", () => {
    const values = gateSettings.schema.parse({
      enabled: false,
      patterns: [{ command: "npm run typecheck", estimateGb: 3 }],
    });
    const expected: ShimConfig = {
      version: 1,
      enabled: false,
      patterns: [{ words: ["npm", "run", "typecheck"], estimateBytes: gbToBytes(3) }],
    };
    expect(toShimConfig(values)).toEqual(expected);
  });
});

describe("buildShimScript", () => {
  it("starts with the #! line and embeds the paths, the variable name and the timeout", () => {
    const script = buildShimScript({
      interpreter: "/usr/local/bin/node",
      socketPath: '/tmp/a "b"/gate.sock',
      configPath: "/tmp/a/config.json",
    });
    expect(script.split("\n")[0]).toBe("#!/usr/local/bin/node");
    expect(script).toContain('  socketPath: "/tmp/a \\"b\\"/gate.sock",');
    expect(script).toContain('  configPath: "/tmp/a/config.json",');
    expect(script).toContain('  heldEnv: "PASEO_HEAVY_GATE_HELD",');
    expect(script).toContain("  helloTimeoutMs: 10000,");
  });

  it("is a module node can parse", () => {
    const file = join(root, "gate.mjs");
    writeFileSync(file, buildShimScript({ interpreter: process.execPath, ...paths }));
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});

describe("installShims", () => {
  it("writes gate.mjs and links every shimmed command to it", async () => {
    await installShims({ paths, interpreter: process.execPath });
    expect(modeOf(paths.home)).toBe(0o700);
    expect(modeOf(paths.binDir)).toBe(0o700);
    expect(modeOf(paths.script)).toBe(0o700);
    expect(readdirSync(paths.binDir).sort()).toEqual([...SHIMMED_COMMANDS].sort());
    for (const name of SHIMMED_COMMANDS) {
      const link = join(paths.binDir, name);
      expect(lstatSync(link).isSymbolicLink()).toBe(true);
      expect(readlinkSync(link)).toBe("../gate.mjs");
    }
  });

  it("rewrites the script and the links on the next start and leaves no temporary file", async () => {
    await installShims({ paths, interpreter: process.execPath });
    writeFileSync(paths.script, "edited by hand\n");
    await installShims({ paths, interpreter: process.execPath });
    expect(readFileSync(paths.script, "utf8")).toBe(
      buildShimScript({ interpreter: process.execPath, ...paths }),
    );
    expect(readdirSync(paths.home).sort()).toEqual(["bin", "gate.mjs"]);
    expect(readdirSync(paths.binDir).sort()).toEqual([...SHIMMED_COMMANDS].sort());
  });
});

describe("writeShimConfig", () => {
  it("writes the config with mode 0600 and replaces it whole", async () => {
    await installShims({ paths, interpreter: process.execPath });
    const first: ShimConfig = {
      version: 1,
      enabled: true,
      patterns: [{ words: ["tsc"], estimateBytes: 1 }],
    };
    const second: ShimConfig = { version: 1, enabled: false, patterns: [] };
    await writeShimConfig(paths.configPath, first);
    await writeShimConfig(paths.configPath, second);
    expect(modeOf(paths.configPath)).toBe(0o600);
    expect(JSON.parse(readFileSync(paths.configPath, "utf8"))).toEqual(second);
    expect(readdirSync(paths.home).sort()).toEqual(["bin", "config.json", "gate.mjs"]);
  });
});
