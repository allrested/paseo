import type { ProviderCommand } from "@getpaseo/protocol/provider-config";
import { execCommand } from "../../../utils/spawn.js";

export type TargetLogin = "signed_in" | "signed_out" | "unknown";

export interface LoginProbeInput {
  family: string;
  /** The provider's command override, when it has one. */
  command?: ProviderCommand;
  /** The provider's launch env, which is how a profile selects its login. */
  env: Record<string, string>;
}

/** `exitCode` is null when the command was killed, as on a timeout. */
export interface CommandOutcome {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Rejects only when the command could not be started. */
export type RunCommand = (
  command: string,
  args: string[],
  env: Record<string, string>,
) => Promise<CommandOutcome>;

interface StatusCommand {
  command: string;
  args: string[];
  read(outcome: CommandOutcome): TargetLogin;
}

/** `claude auth status` prints JSON with `loggedIn`, and exits 1 when it is false. */
function readClaudeStatus(outcome: CommandOutcome): TargetLogin {
  let status: unknown;
  try {
    status = JSON.parse(outcome.stdout);
  } catch {
    return "unknown";
  }
  if (typeof status !== "object" || status === null || !("loggedIn" in status)) return "unknown";
  if (status.loggedIn === true) return "signed_in";
  return status.loggedIn === false ? "signed_out" : "unknown";
}

/** `codex login status` exits 1 for a broken config too, so only its own words mean signed out. */
function readCodexStatus(outcome: CommandOutcome): TargetLogin {
  if (/not logged in/i.test(`${outcome.stdout}\n${outcome.stderr}`)) return "signed_out";
  return outcome.exitCode === 0 ? "signed_in" : "unknown";
}

const STATUS_COMMANDS: Record<string, StatusCommand> = {
  claude: { command: "claude", args: ["auth", "status"], read: readClaudeStatus },
  codex: { command: "codex", args: ["login", "status"], read: readCodexStatus },
};

/**
 * Asks the family's own CLI whether the login a provider would launch with is signed in. Never
 * rejects, and answers "unknown" for anything it cannot read: a move is refused only on a CLI
 * that says, in its own words, that nobody is signed in.
 */
export async function probeTargetLogin(
  input: LoginProbeInput,
  run: RunCommand,
): Promise<TargetLogin> {
  const status = STATUS_COMMANDS[input.family];
  // A replaced command may be a wrapper that does not take these arguments.
  if (!status || input.command?.mode === "replace") return "unknown";
  try {
    const outcome = await run(status.command, status.args, input.env);
    return outcome.exitCode === null ? "unknown" : status.read(outcome);
  } catch {
    return "unknown";
  }
}

const PROBE_TIMEOUT_MS = 5_000;

interface ExecFailure {
  code?: unknown;
  stdout?: unknown;
  stderr?: unknown;
}

/** Runs the CLI with the daemon's environment overlaid with the provider's. */
export const runStatusCommand: RunCommand = async (command, args, env) => {
  try {
    const { stdout, stderr } = await execCommand(command, args, {
      envOverlay: env,
      timeout: PROBE_TIMEOUT_MS,
    });
    return { exitCode: 0, stdout, stderr };
  } catch (error) {
    const failure = error as ExecFailure;
    // A numeric code is the CLI's own exit; anything else is a spawn failure or a kill.
    if (typeof failure.code !== "number") {
      if (typeof failure.stdout !== "string") throw error;
      return { exitCode: null, stdout: failure.stdout, stderr: String(failure.stderr ?? "") };
    }
    return {
      exitCode: failure.code,
      stdout: String(failure.stdout ?? ""),
      stderr: String(failure.stderr ?? ""),
    };
  }
};
