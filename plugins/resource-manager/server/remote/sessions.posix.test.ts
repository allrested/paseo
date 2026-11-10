import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SshServer } from "./discovery.js";
import { startMcpStdioClient } from "./mcp-stdio-client.js";
import { REMOTE_COMMAND } from "./remote-output.js";
import { REMOTE_OUTPUT_SAMPLE, REMOTE_SNAPSHOT_SAMPLE } from "./remote-output-sample.js";
import { nodeTimers, RemoteSessions, type StartClient } from "./sessions.js";

const FAKE = fileURLToPath(new URL("../../test/fake-ssh-mcp.mjs", import.meta.url));

let dir: string;
let runDir: string;
let remote: RemoteSessions;

const startClient: StartClient = (server, signal) =>
  startMcpStdioClient(
    { command: server.command, args: server.args, env: server.env },
    {
      runDir,
      name: server.id,
      procRoot: "/proc",
      baseEnv: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      startTimeoutMs: 10_000,
      requestTimeoutMs: 10_000,
    },
    signal,
  );

function fakeServer(env: Record<string, string>): SshServer {
  return {
    id: "0123456789abcdef",
    name: "fake-box",
    source: "test",
    command: process.execPath,
    args: [FAKE],
    env,
    missingVariables: [],
    fingerprint: JSON.stringify(env),
  };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "rm-sessions-posix-"));
  runDir = join(dir, "run");
  remote = new RemoteSessions({
    runDir,
    procRoot: "/proc",
    startClient,
    timers: nodeTimers,
    log: () => {},
  });
});

afterEach(async () => {
  await remote.closeAll();
  rmSync(dir, { recursive: true, force: true });
});

describe("RemoteSessions with a real MCP client", () => {
  it("reads a server through ssh-mcp 2.x's run-command and stops it on closeAll", async () => {
    const outputFile = join(dir, "output.txt");
    const callLog = join(dir, "calls.jsonl");
    writeFileSync(outputFile, REMOTE_OUTPUT_SAMPLE);
    const server = fakeServer({
      FAKE_SSH_MCP_TOOL: "read-command,run-command",
      FAKE_SSH_MCP_STDERR: "warning: setlocale: LC_ALL: cannot change locale",
      FAKE_SSH_MCP_OUTPUT_FILE: outputFile,
      FAKE_SSH_MCP_CALL_LOG: callLog,
    });

    const reading = await remote.read(server);

    expect(reading).toMatchObject({ snapshot: REMOTE_SNAPSHOT_SAMPLE, error: null });
    expect(readFileSync(callLog, "utf8")).toBe(
      `${JSON.stringify({ name: "run-command", arguments: { command: REMOTE_COMMAND } })}\n`,
    );
    expect(readdirSync(runDir)).toHaveLength(1);

    await remote.closeAll();
    expect(readdirSync(runDir)).toEqual([]);
  });

  it("reads each profile of a multi-host ssh-mcp 2.x entry over one session", async () => {
    const outputFile = join(dir, "output.txt");
    const callLog = join(dir, "calls.jsonl");
    writeFileSync(outputFile, REMOTE_OUTPUT_SAMPLE);
    const server = fakeServer({
      FAKE_SSH_MCP_TOOL: "list-connections,read-command,run-command",
      FAKE_SSH_MCP_CONNECTIONS:
        "prod: deploy@10.0.0.1:22 [connected] sessions=0 role=operator\n" +
        "db: root@10.0.0.2:22 [disconnected] sessions=0 role=operator",
      FAKE_SSH_MCP_OUTPUT_FILE: outputFile,
      FAKE_SSH_MCP_CALL_LOG: callLog,
    });

    const reading = await remote.read(server);

    expect(reading).toMatchObject({
      snapshot: null,
      error: null,
      hosts: [
        { profile: "prod", label: "deploy@10.0.0.1:22", snapshot: REMOTE_SNAPSHOT_SAMPLE },
        { profile: "db", label: "root@10.0.0.2:22", snapshot: REMOTE_SNAPSHOT_SAMPLE },
      ],
    });
    const calls = readFileSync(callLog, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    expect(calls).toEqual([
      { name: "list-connections", arguments: {} },
      { name: "run-command", arguments: { command: REMOTE_COMMAND, profile: "prod" } },
      { name: "run-command", arguments: { command: REMOTE_COMMAND, profile: "db" } },
    ]);
    expect(readdirSync(runDir)).toHaveLength(1);
  });

  it("shows ssh-mcp's last stderr line when it exits on start", async () => {
    const reading = await remote.read(fakeServer({ FAKE_SSH_MCP_EXIT_ON_START: "3" }));

    expect(reading).toEqual({
      id: "0123456789abcdef",
      snapshot: null,
      readAt: null,
      error: "ssh-mcp exited (code 3): fatal: could not connect to 10.0.0.9",
    });
    expect(readdirSync(runDir)).toEqual([]);
  });
});
