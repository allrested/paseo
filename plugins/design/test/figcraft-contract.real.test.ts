import { type ChildProcessWithoutNullStreams, execFileSync, spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

interface PageLayer {
  name?: string;
  fills?: unknown;
}

/** The first page's top-level layer of that name, from an inspect_document answer. */
function topLayer(doc: Record<string, unknown>, name: string): PageLayer {
  const pages = (doc.pages ?? []) as { children?: PageLayer[] }[];
  return pages[0]?.children?.find((layer) => layer.name === name) ?? {};
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

  it("an image placed from a file by one member reaches the other (design_compare)", async () => {
    const png = join(mkdtempSync(join(tmpdir(), "figcraft-shot-")), "shot.png");
    writeFileSync(
      png,
      Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64",
      ),
    );
    const placed = await a.command("image.place", {
      path: png,
      x: 400,
      y: 30,
      width: 320,
      name: "Running app 12:00",
    });
    expect(placed).toMatchObject({ width: 320 });
    // Layer ids are each member's own, so the other member finds it by name. A headless member
    // takes in the others' edits only when it runs collab.peers, so each read runs it first.
    const seen = await until(
      async () => {
        await b.command("collab.peers");
        return topLayer(
          await b.json("inspect_document", { depth: 1, fields: ["name", "fills"] }),
          "Running app 12:00",
        );
      },
      (layer) => layer.name === "Running app 12:00",
    );
    expect(seen.fills).toEqual([expect.objectContaining({ type: "image" })]);
    // Later tests measure the page: take the picture off it again.
    expect((await a.tool("undo", {})).isError).toBe(false);
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

  it("takes Paseo's tokens with one mode per theme, the default mode first", async () => {
    const shipped = JSON.parse(
      readFileSync(new URL("../server/paseo-tokens.json", import.meta.url), "utf8"),
    ) as { meta: { variables: object } };
    const c = await Mcp.start(
      CLI as string,
      mkdtempSync(join(tmpdir(), "figcraft-c-")),
      "contract-c",
    );
    try {
      const imported = await c.command("variable.import", { variables: shipped });
      expect(imported).toMatchObject({
        collections: 1,
        variables: Object.keys(shipped.meta.variables).length,
        warnings: [],
      });
      const exported = await c.command("variable.export", { format: "json" });
      const inner = JSON.parse(exported.text as string) as {
        meta: {
          variableCollections: Record<
            string,
            { name: string; defaultModeId: string; modes: { modeId: string; name: string }[] }
          >;
          variables: Record<string, { id: string; name: string }>;
        };
      };
      const [collection] = Object.values(inner.meta.variableCollections);
      expect(collection.name).toBe("Tokens");
      expect(collection.modes.map((mode) => mode.name)).toEqual([
        "Paseo",
        "Light",
        "Zinc",
        "Midnight",
        "Claude",
        "Ghostty",
        "Pure Black",
      ]);
      expect(collection.defaultModeId).toBe(collection.modes[0].modeId);
      // Replacing them with a repo's tokens deletes the collection: a bound layer keeps its colour.
      const made = await c.json("create_node", {
        type: "FRAME",
        name: "Card",
        width: 100,
        height: 50,
        props: { fill: { $var: "color/accent" } },
      });
      const card = made.id as number;
      const fills = async () =>
        ((await c.json("get_node", { id: card })) as { fills: unknown }).fills;
      // Send to agent reads a layer's size and bindings with these fields.
      const accent = Object.values(inner.meta.variables).find((v) => v.name === "color/accent");
      expect(accent?.id).toMatch(/^VariableID:/);
      expect(
        await c.json("get_node", {
          id: card,
          depth: 8,
          fields: ["name", "width", "height", "boundVariables"],
        }),
      ).toMatchObject({
        name: "Card",
        width: 100,
        height: 50,
        boundVariables: { fill: accent?.id },
      });
      const before = await fills();
      expect(before).toEqual([expect.objectContaining({ type: "solid" })]);
      const [collectionId] = Object.keys(inner.meta.variableCollections);
      expect(await c.command("variable.deleteCollection", { collection: collectionId })).toEqual({
        deletedVariables: Object.keys(shipped.meta.variables).length,
      });
      expect(await fills()).toEqual(before);
    } finally {
      c.stop();
    }
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

  it("edits from the phone: layers under a point, a token by name, nudges, and an undo of one's own", async () => {
    const frame = (await a.command("node.create", {
      type: "frame",
      x: 2000,
      y: 0,
      width: 200,
      height: 100,
      name: "Phone",
    })) as { id: number };
    const back = (await a.command("node.create", {
      type: "rectangle",
      x: 10,
      y: 10,
      width: 50,
      height: 50,
      parent: frame.id,
      name: "Back",
    })) as { id: number };
    const front = (await a.command("node.create", {
      type: "rectangle",
      x: 20,
      y: 20,
      width: 50,
      height: 50,
      parent: frame.id,
      name: "Front",
    })) as { id: number };
    const here = (await a.command("select.layersAt", { x: 2030, y: 30 })) as {
      layers: { id: number; depth: number }[];
    };
    record("layers-at.json", here);
    // Not front-most first as the docs say: parent before child; siblings front-most first.
    expect(here.layers.map((layer) => [layer.id, layer.depth])).toEqual([
      [frame.id, 0],
      [front.id, 1],
      [back.id, 1],
    ]);

    await a.command("node.set", { ids: [front.id], fill: { $var: "color/accent" } });
    const bound = await a.json("get_node", {
      id: front.id,
      fields: ["type", "fills", "boundVariables", "absoluteBounds"],
    });
    record("get-node-edit.json", bound);
    expect(bound).toMatchObject({
      type: "RECTANGLE",
      fills: [{ color: "#3366CC", type: "solid" }],
      boundVariables: { fill: expect.any(String) },
    });
    await a.command("transform.nudge", { ids: [front.id], dx: 10, dy: 0 });
    await a.command("transform.nudgeSize", { ids: [front.id], dw: 0, dh: 10 });
    expect(await a.json("get_node", { id: front.id, fields: ["absoluteBounds"] })).toMatchObject({
      absoluteBounds: { x: 2030, y: 20, width: 50, height: 60 },
    });

    // b renames the frame after a's last edit; a's undo takes back a's resize, not b's rename.
    const seen = await until(
      () => b.command("node.find", { name: "Phone" }),
      (found) => (found.total as number) > 0,
    );
    await b.command("node.set", { ids: [(seen.ids as number[])[0]], name: "Phone B" });
    await until(
      async () => {
        await a.command("collab.peers");
        return a.json("get_node", { id: frame.id, fields: ["name"] });
      },
      (layer) => layer.name === "Phone B",
    );
    expect(await a.command("edit.undo")).toEqual({ undone: true });
    expect(await a.json("get_node", { id: front.id, fields: ["absoluteBounds"] })).toMatchObject({
      absoluteBounds: { height: 50 },
    });
    expect(await a.json("get_node", { id: frame.id, fields: ["name"] })).toMatchObject({
      name: "Phone B",
    });

    const copy = (await a.command("edit.duplicate", { ids: [back.id] })) as { ids: number[] };
    expect(copy.ids).toHaveLength(1);
    await a.command("edit.delete", { ids: [back.id] });
    await expect(a.json("get_node", { id: back.id, fields: ["name"] })).rejects.toThrow(
      /no such node/,
    );
  }, 120_000);

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
