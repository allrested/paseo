import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BRIDGE_AUTHOR, Bridge, type TokensPort } from "./bridge.js";
import type { DesignFile } from "./files-store.js";
import { FigcraftSession } from "./figcraft-session.js";
import type { TokenFile } from "./tokens.js";

const FAKE = new URL("../test/fake-figcraft.mjs", import.meta.url).pathname;
const FILE: DesignFile = {
  id: "f1",
  projectKey: "p1",
  name: "Login",
  createdAt: 1,
  lastAgentId: null,
  secrets: {
    editLink: "figcraft://join?host=figcraft.example&file=f1&token=e",
    viewLink: "figcraft://join?host=figcraft.example&file=f1&token=v",
    ownerToken: null,
  },
};

async function open(tokens: TokenFile | null, env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "design-bridge-"));
  const logFile = join(dir, "calls.log");
  const session = await FigcraftSession.start({
    command: process.execPath,
    args: [FAKE],
    env: { FAKE_FIGCRAFT_LOG: logFile, ...env },
    runDir: dir,
    name: "b",
  });
  let written: TokenFile | null = null;
  const port: TokensPort = {
    read: async () => tokens,
    write: async (file) => {
      written = file;
    },
  };
  const lines: string[] = [];
  const bridge = await Bridge.open({
    session,
    file: FILE,
    tokens: port,
    log: (line) => lines.push(line),
  });
  const calls = () =>
    readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as { name: string; arguments: Record<string, unknown> });
  return { bridge, session, calls, written: () => written, lines };
}

const TOKENS = { color: { $type: "color", accent: { $value: "#3366cc" } } };
const commandOf = (call: { arguments: Record<string, unknown> }) => call.arguments.command;

describe("Bridge", () => {
  it("names itself, joins with the edit link, then imports the repo's tokens", async () => {
    const { bridge, calls } = await open(TOKENS);
    expect(calls()[0].arguments).toEqual({
      command: "pref.userName",
      params: { name: "Paseo (agent)" },
    });
    expect(calls()[1].arguments).toEqual({
      command: "collab.join",
      params: { link: FILE.secrets.editLink },
    });
    expect(calls().map(commandOf)).toContain("variable.import");
    expect(bridge.tokens).toEqual({ status: "imported", warnings: [] });
    await bridge.close();
  });
  it("opens without tokens when the repo has none", async () => {
    const { bridge } = await open(null);
    expect(bridge.tokens).toEqual({ status: "none" });
    expect(await bridge.outOfStep()).toBe(false);
    await bridge.close();
  });
  it("refuses a bad tokens file with the reason and imports nothing", async () => {
    const { bridge, calls } = await open({ x: { $value: "#fff" } });
    expect(bridge.tokens).toEqual({
      status: "refused",
      reason: "x: no $type on the token or its groups",
    });
    expect(calls().map(commandOf)).not.toContain("variable.import");
    await bridge.close();
  });
  it("writes FigCraft's token edits back to the repo, once", async () => {
    const { bridge, session, written } = await open(TOKENS);
    expect(await bridge.outOfStep()).toBe(false);
    expect(await bridge.syncTokensBack()).toBe(false);
    // A token edit in FigCraft, made through the same fake.
    await session.importVariables({
      meta: {
        variableCollections: {
          "VariableCollectionId:1": {
            id: "VariableCollectionId:1",
            name: "Tokens",
            modes: [{ modeId: "VariableCollectionId:1/mode1", name: "Default" }],
            defaultModeId: "VariableCollectionId:1/mode1",
            variableIds: ["VariableID:2"],
          },
        },
        variables: {
          "VariableID:2": {
            id: "VariableID:2",
            name: "color/accent",
            variableCollectionId: "VariableCollectionId:1",
            resolvedType: "COLOR",
            valuesByMode: { "VariableCollectionId:1/mode1": { r: 1, g: 0, b: 0, a: 1 } },
          },
        },
      },
    });
    expect(await bridge.outOfStep()).toBe(true);
    expect(await bridge.syncTokensBack()).toBe(true);
    expect(written()).toEqual({ color: { $type: "color", accent: { $value: "#ff0000" } } });
    expect(bridge.tokens).toEqual({ status: "written-back" });
    expect(await bridge.syncTokensBack()).toBe(false);
    await bridge.close();
  });
  it("reads the user's selection, not an agent's", async () => {
    const { bridge } = await open(null, {
      FAKE_FIGCRAFT_SELECTION: "4294967297",
      FAKE_FIGCRAFT_AGENT_SELECTION: "4294967300",
    });
    expect(await bridge.userSelection()).toEqual(["4294967297"]);
    await bridge.close();
  });
  it("lists open threads by people, counting comments made from the phone through the bridge", async () => {
    const comments = JSON.stringify([
      { id: 1, resolved: false, author: "Guest 3", agent: false, text: "rounder" },
      { id: 2, resolved: false, author: "claude-code (agent)", agent: true, text: "done" },
      { id: 3, resolved: true, author: "Guest 3", agent: false, text: "old" },
      { id: 4, resolved: false, author: BRIDGE_AUTHOR, agent: true, text: "from the phone" },
    ]);
    const { bridge } = await open(null, { FAKE_FIGCRAFT_COMMENTS: comments });
    expect((await bridge.openThreads()).map((t) => t.id)).toEqual(["1", "4"]);
    await bridge.close();
  });
  it("exports code for at most three layers and says how many it left out", async () => {
    const { bridge } = await open(null);
    const code = await bridge.code(["1", "2", "3", "4", "5"]);
    expect(code.match(/^\/\/ layer /gm)).toHaveLength(3);
    expect(code).toContain("// 2 more layers not exported");
    await bridge.close();
  });
  it("never logs the edit link", async () => {
    const { bridge, lines } = await open({ x: { $value: "#fff" } });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.join("\n")).not.toContain("token=e");
    await bridge.close();
  });
});
