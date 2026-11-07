import type * as ChildProcessModule from "node:child_process";
import type * as FsModule from "node:fs";
import type * as NetModule from "node:net";
import type * as OsModule from "node:os";
import type * as PathModule from "node:path";
import type { ServerNotice, ShimConfig, ShimHello, WaitNotice } from "../protocol.js";
import type { PatternRule } from "./classify.js";

/** process.execve (Node 22.15+), missing from @types/node 20. Does not return on success. */
export type ExecveFunction = (file: string, args: string[], env: NodeJS.ProcessEnv) => void;

export interface ShimDeps {
  /** process.argv: node, the shim's path as invoked (`<bin>/<command>`), then the arguments. */
  argv: readonly string[];
  env: NodeJS.ProcessEnv;
  process: NodeJS.Process;
  childProcess: typeof ChildProcessModule;
  fs: typeof FsModule;
  net: typeof NetModule;
  os: typeof OsModule;
  path: typeof PathModule;
  execve: ExecveFunction | null;
  classify(
    invokedAs: string,
    args: readonly string[],
    patterns: readonly PatternRule[],
  ): number | null;
  socketPath: string;
  configPath: string;
  heldEnv: string;
  /** How long to wait for the gate's first answer before running ungated. */
  helloTimeoutMs: number;
}

/**
 * The whole shim. installShims copies this function into gate.mjs with
 * Function.prototype.toString(), so its body may use only `deps` and JavaScript globals: no
 * imports, no module-level constants, no helpers declared outside it.
 */
export function runShim(deps: ShimDeps): void {
  const { childProcess, env, fs, net, os, path } = deps;
  const proc: NodeJS.Process = deps.process;
  const scriptPath = deps.argv[1] ?? "";
  const args = deps.argv.slice(2);
  const invokedAs = path.basename(scriptPath);
  const FORWARDED_SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP", "SIGQUIT"];
  const GIB = 1024 ** 3;

  function writeLine(line: string): void {
    try {
      fs.writeSync(2, `${line}\n`);
    } catch {
      // stderr is closed or full: the line is lost, the command still runs.
    }
  }

  function warn(message: string): void {
    writeLine(`heavy-command gate: ${message}`);
  }

  function errorCode(error: unknown): string {
    if (error instanceof Error && "code" in error && typeof error.code === "string") {
      return error.code;
    }
    return error instanceof Error ? error.message : String(error);
  }

  function readOrNull(read: () => string): string | null {
    try {
      return read();
    } catch {
      return null;
    }
  }

  function realpathOrNull(file: string): string | null {
    return readOrNull(() => fs.realpathSync(file));
  }

  function isExecutableFile(file: string): boolean {
    try {
      fs.accessSync(file, fs.constants.X_OK);
      return fs.statSync(file).isFile();
    } catch {
      return false;
    }
  }

  // The binary a shell would run with the shim directory taken off PATH.
  function findRealBinary(): string | null {
    const shimDirectory = realpathOrNull(path.dirname(scriptPath));
    const shimScript = realpathOrNull(scriptPath);
    for (const entry of (env.PATH ?? "").split(path.delimiter)) {
      if (entry === "" || realpathOrNull(entry) === shimDirectory) continue;
      const candidate = path.join(entry, invokedAs);
      if (!isExecutableFile(candidate) || realpathOrNull(candidate) === shimScript) continue;
      return candidate;
    }
    return null;
  }

  function readConfig(): ShimConfig | null {
    try {
      const value: unknown = JSON.parse(fs.readFileSync(deps.configPath, "utf8"));
      if (typeof value !== "object" || value === null) return null;
      const enabled: unknown = Reflect.get(value, "enabled");
      const patterns: unknown = Reflect.get(value, "patterns");
      if (Reflect.get(value, "version") !== 1) return null;
      if (typeof enabled !== "boolean" || !Array.isArray(patterns)) return null;
      return { version: 1, enabled, patterns };
    } catch {
      return null;
    }
  }

  function startTimeOf(pid: string): number | null {
    const stat = readOrNull(() => fs.readFileSync(`/proc/${pid}/stat`, "utf8"));
    if (stat === null) return null;
    const commEnd = stat.lastIndexOf(")");
    const value = Number(stat.slice(commEnd + 2).split(" ")[19]);
    return commEnd >= 0 && Number.isSafeInteger(value) ? value : null;
  }

  function hello(estimateBytes: number): ShimHello {
    const agentId = env.PASEO_AGENT_ID;
    return {
      type: "hello",
      version: 1,
      command: [invokedAs, ...args].join(" ").slice(0, 4096),
      estimateBytes,
      agentId: agentId ? agentId.slice(0, 200) : null,
      process: {
        pid: proc.pid,
        startTime: startTimeOf("self"),
        pidNamespace: readOrNull(() => fs.readlinkSync("/proc/self/ns/pid")),
        bootId: readOrNull(() => fs.readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim()),
        initStartTime: startTimeOf("1"),
      },
    };
  }

  function numberOrNull(value: unknown): number | null {
    return typeof value === "number" ? value : null;
  }

  function parseNotice(line: string): ServerNotice | null {
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return null;
    }
    if (typeof value !== "object" || value === null) return null;
    const type: unknown = Reflect.get(value, "type");
    const freeBytes = numberOrNull(Reflect.get(value, "freeBytes"));
    const neededBytes = numberOrNull(Reflect.get(value, "neededBytes")) ?? 0;
    if (type === "wait") {
      const waitingOn = Reflect.get(value, "waitingOn") === "memory" ? "memory" : "slot";
      const ahead = numberOrNull(Reflect.get(value, "ahead")) ?? 0;
      return { type: "wait", ahead, freeBytes, neededBytes, waitingOn };
    }
    if (type === "go") {
      const forced = Reflect.get(value, "forced") === true;
      const waitedMs = numberOrNull(Reflect.get(value, "waitedMs")) ?? 0;
      return { type: "go", forced, freeBytes, neededBytes, waitedMs };
    }
    return null;
  }

  function gb(bytes: number): string {
    return (bytes / GIB).toFixed(1);
  }

  function freeText(freeBytes: number | null): string {
    return freeBytes === null ? "free memory unknown" : `${gb(freeBytes)} GB free`;
  }

  function waitLine(notice: WaitNotice): string {
    const free = freeText(notice.freeBytes);
    if (notice.waitingOn === "slot") {
      return `waiting for heavy-command slot (${notice.ahead} ahead, ${free})`;
    }
    return `waiting for free memory (${notice.ahead} ahead, ${free}, ${gb(notice.neededBytes)} GB needed)`;
  }

  // Runs the command as a child, passes signals through, and ends this process the way the
  // command ended. The socket, when given, stays open until then: its close releases the slot.
  function runChild(
    file: string,
    childEnv: NodeJS.ProcessEnv,
    socket: NetModule.Socket | null,
  ): void {
    const child = childProcess.spawn(file, args, {
      stdio: "inherit",
      env: childEnv,
      argv0: invokedAs,
    });
    function forward(signal: NodeJS.Signals): void {
      child.kill(signal);
    }
    for (const signal of FORWARDED_SIGNALS) proc.on(signal, forward);
    child.once("error", (error) => {
      warn(`cannot run ${file}: ${errorCode(error)}`);
      proc.exit(127);
    });
    child.once("exit", (code, signal) => {
      for (const forwarded of FORWARDED_SIGNALS) proc.off(forwarded, forward);
      socket?.destroy();
      if (signal === null) {
        proc.exit(code ?? 1);
        return;
      }
      // Die by the same signal. Its listener is gone, so the default action applies; the exit
      // below covers a signal Node ignores, such as SIGPIPE.
      proc.kill(proc.pid, signal);
      const signalNumber: unknown = Reflect.get(os.constants.signals, signal);
      proc.exit(128 + (typeof signalNumber === "number" ? signalNumber : 0));
    });
  }

  function execReal(file: string, childEnv: NodeJS.ProcessEnv): void {
    if (deps.execve !== null) {
      try {
        deps.execve(file, [invokedAs, ...args], childEnv);
        return;
      } catch {
        // Only the checks Node runs before the system call throw. A failed execve never returns:
        // Node prints "process.execve failed with error code <code>" and aborts with exit 134.
      }
    }
    runChild(file, childEnv, null);
  }

  function runGated(file: string, estimateBytes: number): void {
    const heldEnv: NodeJS.ProcessEnv = { ...env, [deps.heldEnv]: "1" };
    const socket = net.connect(deps.socketPath);
    let settled = false;
    let buffer = "";
    // Cleared by the first answer. A daemon that queued the command may keep it waiting.
    const answerTimer = setTimeout(
      () => fallOpen("no answer from the daemon"),
      deps.helloTimeoutMs,
    );

    function fallOpen(reason: string): void {
      if (settled) return;
      settled = true;
      clearTimeout(answerTimer);
      socket.destroy();
      warn(`not reachable (${reason}), running ${invokedAs} ungated`);
      execReal(file, heldEnv);
    }

    function handle(notice: ServerNotice): void {
      clearTimeout(answerTimer);
      if (notice.type === "wait") {
        writeLine(waitLine(notice));
        return;
      }
      settled = true;
      if (notice.forced) {
        const minutes = Math.round(notice.waitedMs / 60_000);
        const free = freeText(notice.freeBytes);
        const needed = gb(notice.neededBytes);
        warn(
          `started ${invokedAs} after ${minutes} min without enough free memory (${free}, ${needed} GB needed)`,
        );
      }
      runChild(file, heldEnv, socket);
    }

    socket.on("connect", () => {
      socket.write(`${JSON.stringify(hello(estimateBytes))}\n`);
    });
    socket.on("error", (error) => fallOpen(errorCode(error)));
    socket.on("close", () => fallOpen("the daemon closed the connection"));
    socket.setEncoding("utf8");
    socket.on("data", (chunk: Buffer | string) => {
      buffer += String(chunk);
      let end = buffer.indexOf("\n");
      while (end >= 0 && !settled) {
        const notice = parseNotice(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
        if (notice !== null) handle(notice);
        end = buffer.indexOf("\n");
      }
    });
  }

  const binary = findRealBinary();
  if (binary === null) {
    warn(`no ${invokedAs} on PATH after the shim directory`);
    proc.exit(127);
    return;
  }
  if (env[deps.heldEnv] === "1") {
    execReal(binary, env);
    return;
  }
  const config = readConfig();
  if (config === null) {
    warn(`cannot read ${deps.configPath}, running ${invokedAs} ungated`);
    execReal(binary, env);
    return;
  }
  let estimate: number | null = null;
  try {
    estimate = config.enabled ? deps.classify(invokedAs, args, config.patterns) : null;
  } catch (error) {
    warn(`cannot classify ${invokedAs} (${errorCode(error)}), running it ungated`);
  }
  if (estimate === null) {
    execReal(binary, env);
    return;
  }
  runGated(binary, estimate);
}
