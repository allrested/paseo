#!/usr/bin/env node
// stdio proxy in front of an agent's FigCraft:
//   node figcraft-guard.mjs --server <wss-url> [--name <agent>] -- <figcraft-cli> mcp <args...>
// Lines from the agent go to figcraft-cli, except a tools/call the policy refuses, which the guard
// answers itself. Once the agent's session is initialized, the guard points FigCraft's online
// sharing at our server and names the agent "<agent> (agent)", so the user's selection can be
// told from agents' in collab.peers; those calls' answers go to the guard only.
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { agentName, refusal, rewrite } from "./guard-policy.mjs";

const argv = process.argv.slice(2);
const split = argv.indexOf("--");
const option = (flag) => {
  const at = argv.indexOf(flag);
  return at === -1 || (split !== -1 && at > split) ? undefined : argv[at + 1];
};
const ourServer = option("--server");
if (split === -1 || !ourServer) {
  process.stderr.write(
    "usage: figcraft-guard --server <wss-url> [--name <agent>] -- <figcraft-cli> mcp ...\n",
  );
  process.exit(2);
}
const name = agentName(option("--name"));
const [command, ...args] = argv.slice(split + 1);
const child = spawn(command, args, { stdio: ["pipe", "pipe", "inherit"] });
child.on("exit", (code, signal) => process.exit(signal ? 1 : (code ?? 0)));
child.on("error", (error) => {
  process.stderr.write(`figcraft-guard: could not start ${command}: ${error.message}\n`);
  process.exit(1);
});
child.stdin.on("error", () => {
  // figcraft-cli went away; its exit ends the guard.
});
process.on("SIGTERM", () => child.kill("SIGTERM"));

const GUARD_ID = "figcraft-guard-";
let guardCalls = 0;

function send(message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

function guardCommand(commandId, params) {
  guardCalls += 1;
  send({
    jsonrpc: "2.0",
    id: `${GUARD_ID}${guardCalls}`,
    method: "tools/call",
    params: { name: "run_command", arguments: { command: commandId, params } },
  });
}

createInterface({ input: child.stdout, crlfDelay: Infinity }).on("line", (line) => {
  let message = null;
  try {
    message = JSON.parse(line);
  } catch {
    // Not JSON: pass it on as FigCraft wrote it.
  }
  if (typeof message?.id === "string" && message.id.startsWith(GUARD_ID)) return;
  process.stdout.write(`${line}\n`);
});

createInterface({ input: process.stdin, crlfDelay: Infinity }).on("line", (line) => {
  let message = null;
  try {
    message = JSON.parse(line);
  } catch {
    // Not ours to judge: FigCraft answers a malformed line itself.
  }
  if (message?.method === "tools/call") {
    const tool = message.params?.name;
    const why = refusal(tool, message.params?.arguments, ourServer);
    if (why) {
      process.stdout.write(
        `${JSON.stringify({
          jsonrpc: "2.0",
          id: message.id,
          result: { isError: true, content: [{ type: "text", text: why }] },
        })}\n`,
      );
      return;
    }
    const changed = rewrite(tool, message.params?.arguments);
    if (changed) {
      send({ ...message, params: { ...message.params, arguments: changed } });
      return;
    }
  }
  child.stdin.write(`${line}\n`);
  if (message?.method === "notifications/initialized") {
    guardCommand("pref.publishServer", { url: ourServer });
    guardCommand("pref.userName", { name });
  }
});
process.stdin.on("end", () => child.stdin.end());
