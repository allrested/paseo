import { describe, expect, test } from "vitest";
import {
  probeTargetLogin,
  runStatusCommand,
  type CommandOutcome,
  type RunCommand,
} from "./target-login.js";

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

  test("Codex is not asked: its status command cannot see an API key or a custom provider", async () => {
    const { run, calls } = runner({ exitCode: 1, stdout: "Not logged in\n", stderr: "" });

    expect(await probeTargetLogin(CODEX, run)).toBe("unknown");
    expect(calls).toEqual([]);
  });

  test("a command that cannot run, or runs out of time, is unknown", async () => {
    const missing = runner(new Error("spawn claude ENOENT"));
    const killed = runner({ exitCode: null, stdout: "", stderr: "" });

    expect(await probeTargetLogin(CLAUDE, missing.run)).toBe("unknown");
    expect(await probeTargetLogin(CLAUDE, killed.run)).toBe("unknown");
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

describe("runStatusCommand", () => {
  test("reports a command's own exit code and output, with the given env laid over the daemon's", async () => {
    const outcome = await runStatusCommand(
      process.execPath,
      ["-e", "process.stdout.write(process.env.PROBE_MARK ?? ''); process.exit(3)"],
      { PROBE_MARK: "from-profile" },
    );

    expect(outcome).toEqual({ exitCode: 3, stdout: "from-profile", stderr: "" });
  });

  test("reports exit 0", async () => {
    const outcome = await runStatusCommand(process.execPath, ["-e", "console.log('ok')"], {});

    expect(outcome).toEqual({ exitCode: 0, stdout: "ok\n", stderr: "" });
  });

  test("a command that does not exist has no exit code, which the probe reads as unknown", async () => {
    const outcome = await runStatusCommand("paseo-no-such-cli", ["status"], {});

    expect(outcome.exitCode).toBeNull();
    expect(
      await probeTargetLogin({ family: "claude", env: {} }, (_command, args, env) =>
        runStatusCommand("paseo-no-such-cli", args, env),
      ),
    ).toBe("unknown");
  });
});
