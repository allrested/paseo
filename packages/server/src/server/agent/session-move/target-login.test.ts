import { describe, expect, test } from "vitest";
import { probeTargetLogin, type CommandOutcome, type RunCommand } from "./target-login.js";

interface Call {
  command: string;
  args: string[];
  env: Record<string, string>;
}

function runner(outcome: CommandOutcome | Error): { run: RunCommand; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    run: async (command, args, env) => {
      calls.push({ command, args, env });
      if (outcome instanceof Error) throw outcome;
      return outcome;
    },
  };
}

const CLAUDE = { family: "claude", env: { CLAUDE_CONFIG_DIR: "/home/me/.claude-work" } };
const CODEX = { family: "codex", env: { CODEX_HOME: "/home/me/.codex-work" } };

describe("probeTargetLogin", () => {
  test("Claude that reports loggedIn false is signed out", async () => {
    const { run, calls } = runner({
      exitCode: 1,
      stdout: '{\n  "loggedIn": false,\n  "authMethod": "none"\n}',
      stderr: "",
    });

    expect(await probeTargetLogin(CLAUDE, run)).toBe("signed_out");
    expect(calls).toEqual([{ command: "claude", args: ["auth", "status"], env: CLAUDE.env }]);
  });

  test("Claude that reports loggedIn true is signed in", async () => {
    const { run } = runner({
      exitCode: 0,
      stdout: '{"loggedIn": true, "authMethod": "claude.ai"}',
      stderr: "",
    });

    expect(await probeTargetLogin(CLAUDE, run)).toBe("signed_in");
  });

  test("Claude output that is not the status JSON is unknown", async () => {
    for (const stdout of ["Usage: claude [options]", "{}", '{"loggedIn": "no"}', ""]) {
      const { run } = runner({ exitCode: 0, stdout, stderr: "" });
      expect(await probeTargetLogin(CLAUDE, run)).toBe("unknown");
    }
  });

  test("Codex that says Not logged in is signed out, on either stream", async () => {
    const onStdout = runner({ exitCode: 1, stdout: "Not logged in\n", stderr: "" });
    const onStderr = runner({ exitCode: 1, stdout: "", stderr: "WARNING: x\nNot logged in\n" });

    expect(await probeTargetLogin(CODEX, onStdout.run)).toBe("signed_out");
    expect(await probeTargetLogin(CODEX, onStderr.run)).toBe("signed_out");
    expect(onStdout.calls).toEqual([
      { command: "codex", args: ["login", "status"], env: CODEX.env },
    ]);
  });

  test("Codex that exits 0 is signed in", async () => {
    const { run } = runner({ exitCode: 0, stdout: "Logged in using ChatGPT\n", stderr: "" });

    expect(await probeTargetLogin(CODEX, run)).toBe("signed_in");
  });

  test("Codex that fails for another reason is unknown", async () => {
    const { run } = runner({
      exitCode: 1,
      stdout: "",
      stderr: "Error loading configuration: config.toml:8:12",
    });

    expect(await probeTargetLogin(CODEX, run)).toBe("unknown");
  });

  test("a command that cannot run, or runs out of time, is unknown", async () => {
    const missing = runner(new Error("spawn claude ENOENT"));
    const killed = runner({ exitCode: null, stdout: "", stderr: "" });

    expect(await probeTargetLogin(CLAUDE, missing.run)).toBe("unknown");
    expect(await probeTargetLogin(CLAUDE, killed.run)).toBe("unknown");
    expect(await probeTargetLogin(CODEX, killed.run)).toBe("unknown");
  });

  test("a family with no status command is unknown and runs nothing", async () => {
    const { run, calls } = runner({ exitCode: 0, stdout: "", stderr: "" });

    expect(await probeTargetLogin({ family: "opencode", env: {} }, run)).toBe("unknown");
    expect(calls).toEqual([]);
  });

  test("a replaced command is unknown and runs nothing", async () => {
    const { run, calls } = runner({ exitCode: 0, stdout: '{"loggedIn": false}', stderr: "" });
    const input = { ...CLAUDE, command: { mode: "replace" as const, argv: ["my-wrapper"] } };

    expect(await probeTargetLogin(input, run)).toBe("unknown");
    expect(calls).toEqual([]);
  });

  test("an appended command still probes the family binary", async () => {
    const { run, calls } = runner({ exitCode: 1, stdout: '{"loggedIn": false}', stderr: "" });
    const input = { ...CLAUDE, command: { mode: "append" as const, args: ["--verbose"] } };

    expect(await probeTargetLogin(input, run)).toBe("signed_out");
    expect(calls[0]?.command).toBe("claude");
    expect(calls[0]?.args).toEqual(["auth", "status"]);
  });
});
