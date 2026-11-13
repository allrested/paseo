import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createDesignService } from "./design.js";

const FAKE = new URL("../test/fake-figcraft.mjs", import.meta.url).pathname;

function fakePaseo(dir: string) {
  const sent: { agentId: string; text: string; options: unknown }[] = [];
  return {
    sent,
    paseo: {
      workspaces: {
        ref: () => ({
          refresh: async () => ({
            id: "w1",
            projectId: "p1",
            projectRootPath: "/elsewhere",
            workspaceDirectory: dir,
          }),
        }),
      },
      agents: {
        list: async () => ({
          entries: [
            { agent: { id: "a1", workspaceId: "w1", title: "Builder", archivedAt: null } },
            { agent: { id: "a2", workspaceId: "w2", title: "Other", archivedAt: null } },
            { agent: { id: "a3", workspaceId: "w1", title: "Gone", archivedAt: "2026-11-01" } },
          ],
        }),
        ref: (agentId: string) => ({
          refresh: async () => ({
            agent: { id: agentId, status: "idle", pendingPermissions: [], archivedAt: null },
          }),
          send: async (text: string, options: unknown) => {
            sent.push({ agentId, text, options });
          },
        }),
      },
    },
  };
}

function setup(env: Record<string, string> = {}, viewPollMs = 3000) {
  const home = mkdtempSync(join(tmpdir(), "design-home-"));
  const work = mkdtempSync(join(tmpdir(), "design-work-"));
  mkdirSync(join(work, "design"));
  writeFileSync(
    join(work, "design", "tokens.json"),
    JSON.stringify({ color: { $type: "color", accent: { $value: "#3366cc" } } }),
  );
  const { paseo, sent } = fakePaseo(work);
  const lines: string[] = [];
  const service = createDesignService({
    config: {
      serverUrl: "wss://figcraft.example/",
      webUrl: "https://figcraft.example/app/",
      serverKey: "SERVERKEY",
      cliPath: FAKE,
      maxBridges: 3,
    },
    env: { PASEO_HOME: home, ...env },
    home,
    cliCommand: { command: process.execPath, argsBefore: [FAKE] },
    paseo: () => paseo as never,
    log: (line) => lines.push(line),
    viewPollMs,
  });
  return { service, work, home, sent, lines };
}

describe("design service", () => {
  it("creates a file on the server and lists it for its project with no secrets", async () => {
    const { service } = setup();
    const created = await service.create("w1", "Login");
    expect(created).toMatchObject({ ok: true, file: { name: "Login", projectKey: "p1" } });
    const listed = await service.files("w1");
    expect(listed).toMatchObject({
      enabled: true,
      files: [{ name: "Login", status: "stopped", outOfStep: false }],
    });
    expect(JSON.stringify(listed)).not.toMatch(/token=|key=|editLink|ownerToken/);
  });
  it("gives the editor tab the web build's join URL, and nothing else carries it", async () => {
    const { service } = setup();
    const created = await service.create("w1", "Login");
    if (!created.ok) throw new Error(created.error);
    const link = await service.editorLink(created.file.id, "w1");
    expect(link).toMatchObject({
      ok: true,
      url: expect.stringMatching(/^https:\/\/figcraft\.example\/app\/#join=/),
    });
  });
  it("design_join returns the edit link to the agent, records it as the file's agent and holds the bridge", async () => {
    const { service } = setup();
    const result = await service.join({ id: "a1", workspaceId: "w1", cwd: "/x" } as never, {
      name: "Card",
    });
    expect(result.text).toContain("collab.join");
    expect(await service.files("w1")).toMatchObject({
      files: [{ name: "Card", lastAgentId: "a1", status: "running" }],
    });
  });
  it("adds the guarded FigCraft MCP server and the design_join tool to an interactive session", async () => {
    const { service, home } = setup();
    const request = {
      agentId: "a1",
      workspaceId: "w1",
      cwd: "/x",
      purpose: "interactive",
      background: false,
      title: null,
      provider: "claude",
      tools: [],
      env: {},
      mcpServers: {},
    };
    const next = await service.openSession(request as never);
    expect(next?.tools.map((t) => t.name)).toEqual(["design_join"]);
    expect(next?.mcpServers.figcraft).toMatchObject({
      type: "stdio",
      command: process.execPath,
      args: expect.arrayContaining([
        "--server",
        "wss://figcraft.example/",
        "--name",
        "Claude",
        "--automation-write-root",
        join(home, "design", "scratch", "p1"),
      ]),
    });
    expect(JSON.stringify(next)).not.toContain("SERVERKEY");
  });
  it("adds nothing to a history session, a background helper or a session with no workspace", async () => {
    const { service } = setup();
    expect(
      await service.openSession({
        purpose: "interactive",
        background: true,
        workspaceId: "w1",
        tools: [],
        mcpServers: {},
      } as never),
    ).toBeNull();
    expect(
      await service.openSession({
        purpose: "history",
        workspaceId: "w1",
        tools: [],
        mcpServers: {},
      } as never),
    ).toBeNull();
    expect(
      await service.openSession({
        purpose: "interactive",
        workspaceId: null,
        tools: [],
        mcpServers: {},
      } as never),
    ).toBeNull();
  });
  it("Send to agent sends the note, code and picture to the chosen agent without cutting its turn", async () => {
    const { service, sent } = setup({ FAKE_FIGCRAFT_SELECTION: "4294967297" });
    const created = await service.create("w1", "Login");
    if (!created.ok) throw new Error(created.error);
    await service.editorLink(created.file.id, "w1");
    const result = await service.send(created.file.id, "a1", "build this");
    expect(result).toEqual({ ok: true });
    expect(sent[0]).toMatchObject({
      agentId: "a1",
      options: {
        activeTurnBehavior: "steer",
        images: [expect.objectContaining({ mimeType: "image/png" })],
      },
    });
  });
  it("lists only the workspace's own agents for the picker", async () => {
    const { service } = setup();
    expect(await service.agents("w1")).toEqual({ agents: [{ id: "a1", title: "Builder" }] });
  });
  it("is off and says why when the config is missing", async () => {
    const service = createDesignService({
      config: { disabled: "FIGCRAFT_URL is not set on this host" },
    } as never);
    expect(await service.files("w1")).toEqual({
      enabled: false,
      reason: "FIGCRAFT_URL is not set on this host",
    });
    expect(
      await service.openSession({
        purpose: "interactive",
        workspaceId: "w1",
        tools: [],
        mcpServers: {},
      } as never),
    ).toBeNull();
  });
  it("never logs the server key or a link", async () => {
    const { service, lines } = setup();
    await service.create("w1", "Login");
    expect(lines.join("\n")).not.toMatch(/SERVERKEY|token=/);
  });
  it("writes FigCraft token edits to design/tokens.json uncommitted on a tick", async () => {
    // Use the bridge test's approach: change the variables through FigCraft, then tick.
    const { service, work } = setup();
    const created = await service.create("w1", "Login");
    if (!created.ok) throw new Error(created.error);
    await service.editorLink(created.file.id, "w1");
    await service.debugImportVariables(created.file.id, {
      meta: {
        variableCollections: {
          "c:tokens": {
            id: "c:tokens",
            name: "Tokens",
            modes: [{ modeId: "m:default", name: "Default" }],
            defaultModeId: "m:default",
            variableIds: ["v:color/accent"],
          },
        },
        variables: {
          "v:color/accent": {
            id: "v:color/accent",
            name: "color/accent",
            variableCollectionId: "c:tokens",
            resolvedType: "COLOR",
            valuesByMode: { "m:default": { r: 1, g: 0, b: 0, a: 1 } },
          },
        },
      },
    });
    await service.tick();
    expect(JSON.parse(readFileSync(join(work, "design", "tokens.json"), "utf8"))).toEqual({
      color: { $type: "color", accent: { $value: "#ff0000" } },
    });
  });
  it("keeps the server key out of every FigCraft process's env", async () => {
    const dir = mkdtempSync(join(tmpdir(), "design-env-"));
    const envLog = join(dir, "env.log");
    const { service } = setup({ FIGCRAFT_SERVER_KEY: "SERVERKEY", FAKE_FIGCRAFT_ENV_LOG: envLog });
    const created = await service.create("w1", "Login");
    if (!created.ok) throw new Error(created.error);
    await service.editorLink(created.file.id, "w1");
    const starts = readFileSync(envLog, "utf8").trim().split("\n");
    expect(starts.length).toBeGreaterThanOrEqual(2);
    expect(starts.every((line) => line === "key:absent")).toBe(true);
  });
  it("reads tokens from the workspace's own directory, not the project root", async () => {
    const { service } = setup();
    const created = await service.create("w1", "Login");
    if (!created.ok) throw new Error(created.error);
    const controller = new AbortController();
    let tokens: unknown = null;
    await service.view(
      { fileId: created.file.id, workspaceId: "w1", pictures: false },
      async (event) => {
        if (event.type !== "tokens") return;
        tokens = event.tokens;
        controller.abort();
      },
      controller.signal,
    );
    expect(tokens).toEqual({ status: "imported", warnings: [] });
  });
  it("lists comments and pictures to a viewer, with null for an empty page", async () => {
    const { service } = setup({ FAKE_FIGCRAFT_EMPTY: "1" });
    const created = await service.create("w1", "Login");
    if (!created.ok) throw new Error(created.error);
    const events: { type: string; uri?: string | null }[] = [];
    const controller = new AbortController();
    const view = service.view(
      { fileId: created.file.id, workspaceId: "w1", pictures: true },
      async (event) => {
        events.push(event);
        if (event.type === "picture") controller.abort();
      },
      controller.signal,
    );
    await view;
    const types = events.map((event) => event.type);
    expect(types).toContain("status");
    expect(types.filter((type) => type !== "status")).toEqual(["tokens", "threads", "picture"]);
    expect(events.at(-1)).toMatchObject({ type: "picture", seq: 1, uri: null });
  });
  it("ends a view with the error once the bridge failed twice, without starting a third", async () => {
    const { service } = setup({ FAKE_FIGCRAFT_CRASH_AFTER: "5" }, 20);
    const created = await service.create("w1", "Login");
    if (!created.ok) throw new Error(created.error);
    const events: { type: string; status?: string; error?: string | null }[] = [];
    await service.view(
      { fileId: created.file.id, workspaceId: "w1", pictures: true },
      async (event) => {
        events.push(event);
      },
      new AbortController().signal,
    );
    expect(events.at(-1)).toMatchObject({
      type: "status",
      status: "failed",
      error: expect.stringMatching(/^Bridge stopped: /),
    });
    expect((await service.files("w1")).enabled && (await service.files("w1"))).toMatchObject({
      files: [{ status: "failed" }],
    });
  });
  it("redacts keys and tokens in FigCraft errors it logs or returns", async () => {
    const { service, lines } = setup();
    const created = await service.create("w1", "Login");
    if (!created.ok) throw new Error(created.error);
    await service.remove(created.file.id);
    const result = await service.editorLink(created.file.id, "w1");
    expect(result).toEqual({ ok: false, error: "This design is no longer listed" });
    const joined = await service.join({ id: "a1", workspaceId: "w1" } as never, {
      file: "figcraft://join?host=h&file=f&token=leak",
    });
    expect(joined.text).not.toContain("leak");
    expect(lines.join("\n")).not.toContain("leak");
  });
});
