import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { describe, expect, it } from "vitest";

const GUARD = new URL("./figcraft-guard.mjs", import.meta.url).pathname;
const FAKE = new URL("../test/fake-figcraft.mjs", import.meta.url).pathname;
const OURS = "wss://figcraft.dev.mtapp.dev/";

interface Answer {
  id: unknown;
  result?: { isError?: boolean; content?: { type: string; text?: string }[] };
}

function start() {
  const log = join(mkdtempSync(join(tmpdir(), "design-guard-")), "calls.log");
  const child = spawn(
    process.execPath,
    [GUARD, "--server", OURS, "--name", "Claude", "--", process.execPath, FAKE, "mcp"],
    { stdio: "pipe", env: { ...process.env, FAKE_FIGCRAFT_LOG: log } },
  );
  const answers: Answer[] = [];
  createInterface({ input: child.stdout }).on("line", (line) => {
    answers.push(JSON.parse(line) as Answer);
  });
  const send = (message: Record<string, unknown>) =>
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", ...message })}\n`);
  const call = async (id: number, method: string, params: unknown) => {
    send({ id, method, params });
    for (let i = 0; i < 200 && !answers.some((a) => a.id === id); i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    return answers.find((a) => a.id === id)?.result;
  };
  const calls = () =>
    readFileSync(log, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { name: string; arguments: Record<string, unknown> });
  return { child, send, call, calls, answers };
}

const runCommand = (command: string, params: Record<string, unknown> = {}) => ({
  name: "run_command",
  arguments: { command, params },
});

describe("figcraft-guard", () => {
  it("names the agent and points sharing at our server before the agent's first call", async () => {
    const { child, send, call, calls, answers } = start();
    await call(1, "initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name: "t", version: "1" },
    });
    send({ method: "notifications/initialized" });
    await call(2, "tools/call", runCommand("collab.peers"));
    expect(calls().slice(0, 3)).toEqual([
      runCommand("pref.publishServer", { url: OURS }),
      runCommand("pref.userName", { name: "Claude (agent)" }),
      runCommand("collab.peers"),
    ]);
    // The guard's own calls are answered to the guard only.
    expect(answers.map((a) => a.id)).toEqual([1, 2]);
    child.kill();
  });
  it("answers a refused call itself, and FigCraft never sees it", async () => {
    const { child, call, calls } = start();
    const refused = await call(3, "tools/call", runCommand("collab.share"));
    expect(refused).toEqual({
      isError: true,
      content: [
        {
          type: "text",
          text: "collab.share is not allowed here: Paseo shares design files for you",
        },
      ],
    });
    await call(4, "tools/call", runCommand("collab.peers"));
    expect(calls().map((c) => c.arguments.command)).not.toContain("collab.share");
    child.kill();
  });
  it("keeps an agent's own name marked as an agent's", async () => {
    const { child, call, calls } = start();
    await call(5, "tools/call", runCommand("pref.userName", { name: "Bob" }));
    expect(calls()).toContainEqual(runCommand("pref.userName", { name: "Bob (agent)" }));
    child.kill();
  });
  it("stops when the agent closes its end", async () => {
    const { child } = start();
    const exited = new Promise<number | null>((resolve) => child.once("exit", resolve));
    child.stdin.end();
    expect(await exited).toBe(0);
  });
});
