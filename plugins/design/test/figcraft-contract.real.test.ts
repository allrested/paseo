import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

// The real FigCraft v0.18.1, measured: figcraft-server on a free loopback port and two headless
// `figcraft-cli mcp` sessions. Skipped unless FIGCRAFT_CLI and FIGCRAFT_SERVER_BIN name the
// binaries (test/install-figcraft.sh installs them). FIGCRAFT_RECORD=1 rewrites test/fixtures/,
// with every key, token and link replaced by "<redacted>".

const CLI = process.env.FIGCRAFT_CLI;
const SERVER_BIN = process.env.FIGCRAFT_SERVER_BIN;
const RECORD = process.env.FIGCRAFT_RECORD === "1";
const FIXTURES = new URL("./fixtures/", import.meta.url);

interface ToolAnswer {
  isError: boolean;
  text: string;
  parts: { type: string; mimeType?: string; data?: string; text?: string }[];
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => resolve(typeof address === "object" && address ? address.port : 0));
    });
  });
}

function redact(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value)
      .replace(/(key|token)=[^&"\s\\]+/g, "$1=<redacted>")
      .replace(/"(editCode|viewCode|commentCode|ownerToken)":"[^"]+"/g, '"$1":"<redacted>"')
      // A join code (K7M-2QX-9TD), not the code export, which is also under "code".
      .replace(/"code":"[A-Z0-9-]{5,40}"/g, '"code":"<redacted>"'),
  );
}

function record(name: string, value: unknown): void {
  if (!RECORD) return;
  mkdirSync(FIXTURES, { recursive: true });
  writeFileSync(new URL(name, FIXTURES), `${JSON.stringify(redact(value), null, 2)}\n`);
}

class Mcp {
  private nextId = 1;
  private readonly waiting = new Map<number, (message: Record<string, unknown>) => void>();

  private constructor(private readonly child: ChildProcessWithoutNullStreams) {
    createInterface({ input: child.stdout }).on("line", (line) => {
      const message = JSON.parse(line) as Record<string, unknown>;
      if (typeof message.id === "number") this.waiting.get(message.id)?.(message);
    });
  }

  static async start(cli: string, home: string, name: string, args: string[] = []): Promise<Mcp> {
    const child = spawn(cli, ["mcp", ...args], {
      env: { ...process.env, HOME: home },
      stdio: "pipe",
    });
    const mcp = new Mcp(child);
    await mcp.request("initialize", {
      protocolVersion: "2025-06-18",
      capabilities: {},
      clientInfo: { name, version: "1" },
    });
    child.stdin.write(
      `${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`,
    );
    return mcp;
  }

  request(method: string, params: unknown): Promise<Record<string, unknown>> {
    const id = this.nextId++;
    return new Promise((resolve) => {
      this.waiting.set(id, resolve);
      this.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
    });
  }

  async tool(name: string, args: Record<string, unknown>): Promise<ToolAnswer> {
    const message = await this.request("tools/call", { name, arguments: args });
    const result = (message.result ?? {}) as { content?: ToolAnswer["parts"]; isError?: boolean };
    const parts = result.content ?? [];
    return {
      isError: result.isError === true,
      text: parts
        .filter((part) => part.type === "text")
        .map((part) => part.text ?? "")
        .join("\n"),
      parts,
    };
  }

  async json(name: string, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const answer = await this.tool(name, args);
    if (answer.isError) throw new Error(answer.text);
    return JSON.parse(answer.text) as Record<string, unknown>;
  }

  command(command: string, params: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    return this.json("run_command", { command, params });
  }

  stop(): void {
    this.child.kill("SIGTERM");
  }
}

/** Every member's selected layer ids, from a collab.peers answer. */
function selectionOf(peers: Record<string, unknown>): number[] {
  const list = (peers.peers ?? []) as { presence?: { selection?: number[] } }[];
  return list.flatMap((peer) => peer.presence?.selection ?? []);
}

async function until<T>(read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
  let last: T | undefined;
  for (let i = 0; i < 60; i++) {
    last = await read();
    if (done(last)) return last;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`timed out; last answer: ${JSON.stringify(redact(last)).slice(0, 400)}`);
}

describe.skipIf(!CLI || !SERVER_BIN)("FigCraft v0.18.1 contract", () => {
  let server: ChildProcessWithoutNullStreams;
  let a: Mcp;
  let b: Mcp;
  let editLink = "";
  let cardId = 0;

  beforeAll(async () => {
    const data = mkdtempSync(join(tmpdir(), "figcraft-data-"));
    const port = await freePort();
    const config = join(data, "server.toml");
    writeFileSync(config, `listen = "127.0.0.1:${port}"\ndata = "${data}"\n`);
    server = spawn(SERVER_BIN as string, ["--config", config], { stdio: "pipe" });
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const keyText = execFileSync(SERVER_BIN as string, ["--config", config, "key"], {
      encoding: "utf8",
    });
    const address = /(ws:\/\/\S+\?key=\S+)/.exec(keyText)?.[1];
    if (!address) throw new Error("figcraft-server key printed no address");
    a = await Mcp.start(CLI as string, mkdtempSync(join(tmpdir(), "figcraft-a-")), "contract-a");
    b = await Mcp.start(CLI as string, mkdtempSync(join(tmpdir(), "figcraft-b-")), "contract-b");
    await a.command("pref.userName", { name: "Paseo (agent)" });
    record(
      "publish.json",
      await a.command("collab.publish", { server: address, name: "contract" }),
    );
  }, 60_000);

  afterAll(() => {
    a?.stop();
    b?.stop();
    server?.kill("SIGTERM");
  });

  it("publishes: once live, collab.peers gives the edit link as `link` and `published.edit`", async () => {
    const live = await until(
      () => a.command("collab.peers"),
      (value) => value.status === "live" && typeof value.link === "string",
    );
    record("peers-publisher.json", live);
    const published = live.published as { edit: string; view: string; file: string };
    expect(published.edit).toMatch(/^figcraft:\/\/join\?host=.+&file=.+&token=/);
    expect(published.view).toMatch(/^figcraft:\/\/join\?/);
    expect(live.link).toBe(published.edit);
    editLink = published.edit;
  }, 60_000);

  it("a member named with pref.userName joins, and sees another member's selection by global id", async () => {
    await b.command("pref.userName", { name: "Builder (agent)" });
    await b.command("collab.join", { link: editLink });
    await until(
      () => b.command("collab.peers"),
      (value) => value.status === "live",
    );
    const created = await a.json("create_node", {
      type: "frame",
      x: 40,
      y: 30,
      width: 320,
      height: 200,
      name: "Card",
    });
    cardId = created.id as number;
    await a.json("select", { ids: [cardId] });
    const seen = await until(
      () => b.command("collab.peers"),
      (value) => selectionOf(value).includes(cardId),
    );
    record("peers-member.json", seen);
    const fromA = await a.command("collab.peers");
    const names = ((fromA.peers ?? []) as { name: string }[]).map((peer) => peer.name);
    expect(names).toEqual(["Builder (agent)"]);
  }, 60_000);

  it("imports variables as local-variables JSON; export wraps the JSON in `text`", async () => {
    const variables = {
      meta: {
        variableCollections: {
          "c:1": {
            id: "c:1",
            name: "Tokens",
            modes: [{ modeId: "m:1", name: "Default" }],
            defaultModeId: "m:1",
            variableIds: ["v:1", "v:2"],
          },
        },
        variables: {
          "v:1": {
            id: "v:1",
            name: "color/accent",
            variableCollectionId: "c:1",
            resolvedType: "COLOR",
            valuesByMode: { "m:1": { r: 0.2, g: 0.4, b: 0.8, a: 1 } },
          },
          "v:2": {
            id: "v:2",
            name: "space/4",
            variableCollectionId: "c:1",
            resolvedType: "FLOAT",
            valuesByMode: { "m:1": 16 },
          },
        },
      },
    };
    const imported = await a.command("variable.import", { variables });
    record("variable-import.json", imported);
    expect(imported).toMatchObject({ collections: 1, variables: 2, warnings: [] });
    const exported = await a.command("variable.export", { format: "json" });
    record("variable-export.json", exported);
    const inner = JSON.parse(exported.text as string) as {
      meta: { variables: Record<string, { name: string }> };
    };
    expect(Object.values(inner.meta.variables).map((v) => v.name)).toEqual([
      "color/accent",
      "space/4",
    ]);
  }, 60_000);

  it("comments from an MCP session are flagged agent; resolved is a boolean", async () => {
    await a.command("comment.add", { x: 50, y: 40, text: "Make it rounder" });
    const comments = await a.command("comment.list", { page: "all", filter: "all" });
    record("comment-list.json", comments);
    expect(comments.comments).toEqual([
      expect.objectContaining({
        agent: true,
        author: "contract-a (agent)",
        resolved: false,
        text: "Make it rounder",
      }),
    ]);
    const prompt = await a.command("comment.prompt", {});
    record("comment-prompt.json", { ...prompt, text: `${String(prompt.text).slice(0, 200)}…` });
    expect(prompt.text).toMatch(/^# FigCraft feedback/);
  }, 60_000);

  it("exports code, renders a PNG with its size, and gives top-level layers' bounds", async () => {
    const code = await a.command("inspect.code", { id: cardId, language: "tailwind" });
    record("inspect-code.json", code);
    expect(code.code).toContain("export function Card");
    const shot = await a.tool("screenshot", { maxSize: 400 });
    record("screenshot.json", {
      parts: shot.parts.map((part) => ({
        type: part.type,
        mimeType: part.mimeType,
        text: part.text,
      })),
    });
    expect(shot.parts[0]).toMatchObject({ type: "image", mimeType: "image/png" });
    expect(JSON.parse(shot.text)).toMatchObject({ width: 320, height: 200, source: "page" });
    const doc = await a.json("inspect_document", { depth: 1 });
    record("inspect-document.json", doc);
    const page = (doc.pages as { children?: { absoluteBounds: unknown }[] }[])[0];
    expect(page.children?.[0]?.absoluteBounds).toEqual({ x: 40, y: 30, width: 320, height: 200 });
  }, 60_000);

  it("records codeConnect.export for a component (for the deferred unmapped-components mark)", async () => {
    await a.json("select", { ids: [cardId] });
    await a.command("component.create");
    record(
      "codeconnect.json",
      await a.tool("run_command", { command: "codeConnect.export", params: {} }),
    );
  }, 60_000);

  it("turns live sessions off in a session with automation roots, so Paseo passes none", async () => {
    const root = mkdtempSync(join(tmpdir(), "figcraft-root-"));
    const confined = await Mcp.start(CLI as string, root, "contract-c", [
      "--automation-write-root",
      root,
    ]);
    try {
      const answer = await confined.tool("run_command", {
        command: "collab.join",
        params: { link: editLink },
      });
      expect(answer.isError).toBe(true);
      expect(answer.text).toContain("automation roots are set");
    } finally {
      confined.stop();
    }
  }, 60_000);
});
