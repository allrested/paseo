import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { FigcraftSession } from "./figcraft-session.js";

const FAKE = new URL("../test/fake-figcraft.mjs", import.meta.url).pathname;
const FIXTURES = new URL("../test/fixtures/", import.meta.url);

async function session(env: Record<string, string> = {}) {
  const dir = mkdtempSync(join(tmpdir(), "design-session-"));
  const logFile = join(dir, "calls.log");
  const s = await FigcraftSession.start({
    command: process.execPath,
    args: [FAKE],
    env: { FAKE_FIGCRAFT_LOG: logFile, ...env },
    runDir: dir,
    name: "test",
  });
  const calls = () =>
    readFileSync(logFile, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line) as { name: string; arguments: Record<string, unknown> });
  return { s, calls };
}

const commandOf = (call: { arguments: Record<string, unknown> }) => call.arguments.command;

describe("FigcraftSession", () => {
  it("publishes with the server and key it is given, then reads the links once live", async () => {
    const { s, calls } = await session();
    const links = await s.publish("wss://figcraft.example/?key=K", "Login");
    expect(links).toEqual({
      editLink: "figcraft://join?host=127.0.0.1:1&file=f1&token=e",
      viewLink: "figcraft://join?host=127.0.0.1:1&file=f1&token=v",
      ownerToken: null,
    });
    expect(calls()[0]).toEqual({
      name: "run_command",
      arguments: {
        command: "collab.publish",
        params: { server: "wss://figcraft.example/?key=K", name: "Login" },
      },
    });
    expect(calls().slice(1).map(commandOf)).toContain("collab.peers");
    await s.close();
  });
  it("names itself before it joins, and joins once the session is live", async () => {
    const { s, calls } = await session();
    await s.setName("Paseo (agent)");
    await s.join("figcraft://join?host=h&file=f&token=t");
    expect(calls().map(commandOf).slice(0, 2)).toEqual(["pref.userName", "collab.join"]);
    expect((await s.peers()).status).toBe("live");
    await s.close();
  });
  it("reads the other members' selections, with ids as strings", async () => {
    const { s } = await session({
      FAKE_FIGCRAFT_SELECTION: "4294967297,n2",
      FAKE_FIGCRAFT_AGENT_SELECTION: "7",
    });
    await s.join("figcraft://join?host=h&file=f&token=t");
    expect((await s.peers()).peers).toEqual([
      { id: "3", name: "Guest 3", selection: ["4294967297", "n2"] },
      { id: "4", name: "Claude (agent)", selection: ["7"] },
    ]);
    await s.close();
  });
  it("imports variables and exports them back, unwrapping the export's text", async () => {
    const { s } = await session();
    const json = { meta: { variableCollections: {}, variables: { "v:a": { id: "v:a" } } } };
    expect(await s.importVariables(json)).toEqual({ warnings: [] });
    expect(await s.exportVariables()).toMatchObject(json);
    await s.close();
  });
  it("lists comment threads in the recorded shape", async () => {
    const recorded = JSON.parse(readFileSync(new URL("comment-list.json", FIXTURES), "utf8")) as {
      comments: unknown[];
    };
    const { s } = await session({ FAKE_FIGCRAFT_COMMENTS: JSON.stringify(recorded.comments) });
    expect(await s.comments()).toEqual([
      {
        id: "4294967302",
        status: "open",
        author: "contract-a (agent)",
        agent: true,
        preview: "Make it rounder",
      },
    ]);
    await s.close();
  });
  it("adds a comment, and asks for a prompt and code with numeric ids", async () => {
    const { s, calls } = await session();
    expect(await s.addComment(10, 20, "rounder")).toBe("100");
    expect(await s.commentPrompt(["100"])).toMatch(/^# FigCraft feedback/);
    expect(await s.code("4294967297")).toContain("export function");
    const params = calls().map((call) => call.arguments.params);
    expect(params).toContainEqual({ ids: [100] });
    expect(params).toContainEqual({ id: 4294967297, language: "tailwind" });
    await s.close();
  });
  it("renders a PNG with its size; an empty page gives no picture", async () => {
    const { s, calls } = await session();
    expect(await s.screenshot(["4294967297"], 800)).toMatchObject({
      mimeType: "image/png",
      width: 320,
      height: 200,
    });
    expect(calls()[0].arguments).toEqual({ ids: [4294967297], maxSize: 800 });
    await s.close();
    const blank = await session({ FAKE_FIGCRAFT_EMPTY: "1" });
    expect(await blank.s.screenshot(undefined, 800)).toBeNull();
    await blank.s.close();
  });
  it("gives the page's bounds as the union of its top-level layers", async () => {
    const { s } = await session();
    expect(await s.pageBounds()).toEqual({ x: 40, y: 30, width: 320, height: 200 });
    await s.close();
    const blank = await session({ FAKE_FIGCRAFT_EMPTY: "1" });
    expect(await blank.s.pageBounds()).toBeNull();
    await blank.s.close();
  });
  it("reports a crash once, without the link FigCraft printed", async () => {
    const { s } = await session({ FAKE_FIGCRAFT_CRASH_AFTER: "1" });
    const reasons: string[] = [];
    s.onExit((reason) => reasons.push(reason));
    await s.peers();
    const error = await s.peers().catch((caught: unknown) => caught as Error);
    expect(error.message).toContain("token=<redacted>");
    expect(error.message).not.toContain("secret-token");
    expect(reasons).toEqual(["exited with code 3"]);
    expect(s.closed).toBe(true);
    await s.close();
  });
  it("rejects calls after close", async () => {
    const { s } = await session();
    await s.close();
    await expect(s.peers()).rejects.toThrow();
  });
});
