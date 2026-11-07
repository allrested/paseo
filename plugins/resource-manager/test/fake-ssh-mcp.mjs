// A stand-in for ssh-mcp: MCP JSON-RPC over stdio with one or more tools that return canned
// output. The resource-manager tests and its manual test run it; the plugin never imports it.
// FAKE_SSH_MCP_* variables pick the behaviour (see Task 9 of the resource-manager plan).
import { spawn } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";

const env = process.env;
const toolNames = (env.FAKE_SSH_MCP_TOOL ?? "exec").split(",").filter((name) => name !== "");

function log(entry) {
  if (env.FAKE_SSH_MCP_CALL_LOG)
    appendFileSync(env.FAKE_SSH_MCP_CALL_LOG, `${JSON.stringify(entry)}\n`);
}

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

if (env.FAKE_SSH_MCP_ENV_LOG) {
  const names = Object.keys(env);
  const seen = {
    paseo: names.filter((name) => name.startsWith("PASEO_")).length,
    claudecode: env.CLAUDECODE ?? null,
    own: env.FAKE_SSH_MCP_OWN ?? null,
  };
  writeFileSync(env.FAKE_SSH_MCP_ENV_LOG, JSON.stringify(seen));
}

process.stderr.write("SSH MCP Server running on stdio\n");

if (env.FAKE_SSH_MCP_EXIT_ON_START) {
  process.stderr.write("fatal: could not connect to 10.0.0.9\n");
  process.exit(Number(env.FAKE_SSH_MCP_EXIT_ON_START));
}

if (env.FAKE_SSH_MCP_CHILD_PID_FILE) {
  // Stays in this process group, like the ssh client ssh-mcp starts.
  const child = spawn("sleep", ["300"], { stdio: "ignore" });
  writeFileSync(env.FAKE_SSH_MCP_CHILD_PID_FILE, String(child.pid));
}

const tools = toolNames.map((name) => ({
  name,
  description: "Run a shell command on the remote host",
  inputSchema: {
    type: "object",
    properties: { command: { type: "string" } },
    required: ["command"],
  },
}));

// ssh-mcp 2.x (build/tools/results.js commandOutput) joins stdout and "[stderr]\n<stderr>" with a
// blank line and adds "[exit N]" only on failure, so a clean run ends with stdout or its stderr.
function output(toolName) {
  const text = env.FAKE_SSH_MCP_OUTPUT_FILE
    ? readFileSync(env.FAKE_SSH_MCP_OUTPUT_FILE, "utf8")
    : "no output configured\n";
  if (toolName !== "run-command" || !env.FAKE_SSH_MCP_STDERR) return text;
  return `${text}\n\n[stderr]\n${env.FAKE_SSH_MCP_STDERR}\n`;
}

function callTool(id, params) {
  log({ name: params.name, arguments: params.arguments });
  if (!toolNames.includes(params.name)) {
    send({ jsonrpc: "2.0", id, error: { code: -32602, message: `Unknown tool: ${params.name}` } });
  } else if (env.FAKE_SSH_MCP_RPC_ERROR) {
    send({ jsonrpc: "2.0", id, error: { code: -32603, message: env.FAKE_SSH_MCP_RPC_ERROR } });
  } else if (env.FAKE_SSH_MCP_FAIL) {
    send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: env.FAKE_SSH_MCP_FAIL }], isError: true },
    });
  } else {
    send({
      jsonrpc: "2.0",
      id,
      result: { content: [{ type: "text", text: output(params.name) }] },
    });
  }
}

function initialize(id, params) {
  if (env.FAKE_SSH_MCP_NOISE === "1") {
    process.stdout.write("not json: starting up\n");
    send({
      jsonrpc: "2.0",
      method: "notifications/message",
      params: { level: "info", data: "hi" },
    });
    send({ jsonrpc: "2.0", id: "srv-ping", method: "ping" });
    send({ jsonrpc: "2.0", id: "srv-sampling", method: "sampling/createMessage", params: {} });
  }
  send({
    jsonrpc: "2.0",
    id,
    result: {
      protocolVersion: params.protocolVersion,
      capabilities: { tools: {} },
      serverInfo: { name: "fake-ssh-mcp", version: "0.0.0" },
    },
  });
}

// Answers to this server's own requests are logged, so a test can see what the client sent.
function handleResponse(message) {
  if (message.id === "srv-ping") log({ pong: message.result !== undefined });
  if (message.id === "srv-sampling") log({ refused: message.error?.code ?? null });
}

function handle(message) {
  if (message.method === undefined) {
    handleResponse(message);
    return;
  }
  if (message.id === undefined || env.FAKE_SSH_MCP_HANG === message.method) return;
  if (message.method === "initialize") initialize(message.id, message.params);
  else if (message.method === "tools/list")
    send({ jsonrpc: "2.0", id: message.id, result: { tools } });
  else if (message.method === "tools/call") callTool(message.id, message.params);
  else
    send({ jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "Method not found" } });
}

const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => handle(JSON.parse(line)));
lines.on("close", () => process.exit(0));
