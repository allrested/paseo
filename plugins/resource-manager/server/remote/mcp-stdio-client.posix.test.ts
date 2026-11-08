import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  McpSessionError,
  readLines,
  serverEnv,
  startMcpStdioClient,
  type McpServerCommand,
  type McpStdioClient,
  type McpStdioOptions,
} from "./mcp-stdio-client.js";
import { REMOTE_OUTPUT_SAMPLE } from "./remote-output-sample.js";

const FAKE = fileURLToPath(new URL("../../test/fake-ssh-mcp.mjs", import.meta.url));
const SERVER_ID = "0123456789abcdef";

let dir: string;
let runDir: string;
let clients: McpStdioClient[];

interface OptionOverrides {
  startTimeoutMs?: number;
  requestTimeoutMs?: number;
}

// A fixed base env, so the test does not depend on what the runner's env holds. PATH lets the
// fake start sleep.
function options(overrides: OptionOverrides = {}): McpStdioOptions {
  return {
    runDir,
    name: SERVER_ID,
    procRoot: "/proc",
    baseEnv: {
      PATH: process.env.PATH ?? "/usr/bin:/bin",
      PASEO_PASSWORD: "not-a-real-password",
      PASEO_AGENT_ID: "agent-x",
      CLAUDECODE: "1",
    },
    startTimeoutMs: overrides.startTimeoutMs ?? 10_000,
    requestTimeoutMs: overrides.requestTimeoutMs ?? 10_000,
  };
}

function fake(env: Record<string, string>): McpServerCommand {
  return { command: process.execPath, args: [FAKE], env };
}

async function start(
  env: Record<string, string>,
  overrides: OptionOverrides = {},
): Promise<McpStdioClient> {
  const client = await startMcpStdioClient(fake(env), options(overrides));
  clients.push(client);
  return client;
}

function readLog(file: string): unknown[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line): unknown => JSON.parse(line));
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitUntil(predicate: () => boolean, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) return false;
    await delay(50);
  }
  return true;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rm-mcp-"));
  runDir = join(dir, "run");
  clients = [];
});

afterEach(async () => {
  await Promise.all(clients.map((client) => client.close()));
  rmSync(dir, { recursive: true, force: true });
});

describe("serverEnv", () => {
  it("lays the entry's env over the base without PASEO_* or the parent-session keys", () => {
    expect(
      serverEnv(
        { OWN: "1", PATH: "/opt/bin" },
        {
          PATH: "/usr/bin",
          HOME: "/home/u",
          PASEO_HOME: "/p",
          CLAUDE_CODE_ENTRYPOINT: "cli",
          ESBUILD_BINARY_PATH: "/e",
        },
      ),
    ).toEqual({ PATH: "/opt/bin", HOME: "/home/u", OWN: "1" });
  });
});

// readline re-emits a stream error on its interface. Without a listener there, vitest reports it
// as an unhandled error and the run fails although the assertion holds.
describe("readLines", () => {
  it("delivers lines until its stream fails, and the failure does not escape", async () => {
    const stream = new PassThrough();
    const lines: string[] = [];
    readLines(stream, (line) => {
      lines.push(line);
    });

    stream.write("first\n");
    stream.destroy(new Error("stdout broke"));
    await delay(50);

    expect(lines).toEqual(["first"]);
  });
});

describe("startMcpStdioClient", () => {
  it("initializes, lists tools and returns a tool's text", async () => {
    const outputFile = join(dir, "output.txt");
    const callLog = join(dir, "calls.jsonl");
    writeFileSync(outputFile, REMOTE_OUTPUT_SAMPLE);

    const client = await start({
      FAKE_SSH_MCP_OUTPUT_FILE: outputFile,
      FAKE_SSH_MCP_CALL_LOG: callLog,
    });

    await expect(client.listTools()).resolves.toEqual(["exec"]);
    await expect(client.callTool("exec", { command: "echo hi" })).resolves.toEqual({
      isError: false,
      text: REMOTE_OUTPUT_SAMPLE,
    });
    expect(readLog(callLog)).toEqual([{ name: "exec", arguments: { command: "echo hi" } }]);
    expect(client.closed).toBe(false);
  });

  it("keeps a pid file for its group while it runs; close stops the group and removes it", async () => {
    const childPidFile = join(dir, "child.pid");
    const client = await start({ FAKE_SSH_MCP_CHILD_PID_FILE: childPidFile });
    const pidFile = `${SERVER_ID}-${client.pid}.pid`;

    expect(statSync(runDir).mode & 0o777).toBe(0o700);
    expect(readdirSync(runDir)).toEqual([pidFile]);
    expect(JSON.parse(readFileSync(join(runDir, pidFile), "utf8"))).toMatchObject({
      pgid: client.pid,
      ownerPid: process.pid,
    });
    const childPid = Number(readFileSync(childPidFile, "utf8"));
    expect(isAlive(childPid)).toBe(true);

    await client.close();

    expect(readdirSync(runDir)).toEqual([]);
    await expect(waitUntil(() => !isAlive(childPid))).resolves.toBe(true);
    expect(client.closed).toBe(true);
    await expect(client.listTools()).rejects.toThrow(
      new McpSessionError("The ssh-mcp session was closed"),
    );
  });

  it("stops the group and removes its pid file when ssh-mcp exits by itself", async () => {
    const childPidFile = join(dir, "child.pid");
    const client = await start({ FAKE_SSH_MCP_CHILD_PID_FILE: childPidFile });
    const childPid = Number(readFileSync(childPidFile, "utf8"));
    const pid = client.pid;
    if (pid === null) throw new Error("the fake started without a pid");

    process.kill(pid, "SIGKILL");

    await expect(waitUntil(() => client.closed)).resolves.toBe(true);
    await expect(waitUntil(() => readdirSync(runDir).length === 0)).resolves.toBe(true);
    await expect(waitUntil(() => !isAlive(childPid))).resolves.toBe(true);

    await expect(client.close()).resolves.toBeUndefined();
  });

  it("answers a server ping, refuses other server requests and skips non-JSON stdout", async () => {
    const callLog = join(dir, "calls.jsonl");
    const client = await start({ FAKE_SSH_MCP_NOISE: "1", FAKE_SSH_MCP_CALL_LOG: callLog });

    // One more round trip, so the fake has read the client's answers.
    await client.listTools();

    expect(readLog(callLog)).toEqual([{ pong: true }, { refused: -32601 }]);
  });

  it("returns a tool failure and a JSON-RPC error as isError, and stays open", async () => {
    const message = "Error (code 1): cat: /proc/meminfo: No such file or directory";
    const failing = await start({ FAKE_SSH_MCP_FAIL: message });
    const refusing = await start({ FAKE_SSH_MCP_RPC_ERROR: "Command timed out" });

    await expect(failing.callTool("exec", { command: "x" })).resolves.toEqual({
      isError: true,
      text: message,
    });
    await expect(refusing.callTool("exec", { command: "x" })).resolves.toEqual({
      isError: true,
      text: "Command timed out",
    });
    expect([failing.closed, refusing.closed]).toEqual([false, false]);
  });

  it("reports an exit during start with ssh-mcp's last stderr line and leaves no pid file", async () => {
    await expect(start({ FAKE_SSH_MCP_EXIT_ON_START: "3" })).rejects.toThrow(
      new McpSessionError("ssh-mcp exited (code 3): fatal: could not connect to 10.0.0.9"),
    );
    expect(readdirSync(runDir)).toEqual([]);
  });

  it("times out a request that gets no answer", async () => {
    const client = await start({ FAKE_SSH_MCP_HANG: "tools/call" }, { requestTimeoutMs: 300 });

    await expect(client.callTool("exec", { command: "x" })).rejects.toThrow(
      new McpSessionError("ssh-mcp did not answer tools/call within 0.3 s"),
    );
  });

  it("gives up a start that gets no answer and stops the process", async () => {
    await expect(
      start({ FAKE_SSH_MCP_HANG: "initialize" }, { startTimeoutMs: 300 }),
    ).rejects.toThrow(new McpSessionError("ssh-mcp did not answer initialize within 0.3 s"));
    expect(readdirSync(runDir)).toEqual([]);
  });

  it("stops a start when its signal aborts, and never starts one that is already aborted", async () => {
    const controller = new AbortController();
    const starting = startMcpStdioClient(
      fake({ FAKE_SSH_MCP_HANG: "initialize" }),
      options(),
      controller.signal,
    );
    setTimeout(() => controller.abort(), 200);

    await expect(starting).rejects.toThrow(new McpSessionError("The ssh-mcp session was closed"));
    expect(readdirSync(runDir)).toEqual([]);

    rmSync(runDir, { recursive: true });
    await expect(startMcpStdioClient(fake({}), options(), AbortSignal.abort())).rejects.toThrow(
      new McpSessionError("The ssh-mcp start was cancelled"),
    );
    expect(existsSync(runDir)).toBe(false);
  });

  it("reports a command that cannot be started, without its arguments", async () => {
    const missing = join(dir, "missing", "ssh-mcp");
    const secretArg = { command: missing, args: ["--password=hunter2"], env: {} };
    const nulArg = { command: missing, args: ["--password=nul\0hunter2"], env: {} };
    const nulEnv = { command: missing, args: [], env: { TOKEN: "nul\0hunter2" } };

    const notFound = await startMcpStdioClient(secretArg, options()).catch((error) => error);
    expect(notFound).toEqual(
      new McpSessionError(`Could not start ssh-mcp: spawn ${missing} ENOENT`),
    );
    expect(inspect(notFound)).not.toContain("hunter2");
    for (const command of [nulArg, nulEnv]) {
      const refused = await startMcpStdioClient(command, options()).catch((error) => error);
      expect(refused).toEqual(
        new McpSessionError(
          "Could not start ssh-mcp: the command, an argument or an env entry holds a NUL byte",
        ),
      );
      expect(inspect(refused)).not.toContain("hunter2");
    }
    expect(readdirSync(runDir)).toEqual([]);
  });

  it("starts ssh-mcp without PASEO_* or the parent-session keys", async () => {
    const envLog = join(dir, "env.json");

    await start({ FAKE_SSH_MCP_ENV_LOG: envLog, FAKE_SSH_MCP_OWN: "1" });

    expect(JSON.parse(readFileSync(envLog, "utf8"))).toEqual({
      paseo: 0,
      claudecode: null,
      own: "1",
    });
  });
});
