import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  createDaemonTestContext,
  type DaemonTestContext,
} from "../../test-utils/daemon-test-context.js";

let ctx: DaemonTestContext;
let cwd: string;
let mcp: Client;

beforeEach(async () => {
  cwd = await mkdtemp(path.join(os.tmpdir(), "move-agent-mcp-"));
  ctx = await createDaemonTestContext();
  mcp = new Client({ name: "move-agent-mcp-test", version: "1.0.0" });
  await mcp.connect(
    new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${ctx.daemon.port}/mcp/agents`)),
  );
});

afterEach(async () => {
  await mcp.close();
  await ctx.cleanup();
  await rm(cwd, { recursive: true, force: true });
});

it("move_agent hands the agent to another provider and archives the original", async () => {
  const agent = await ctx.client.createAgent({
    config: { provider: "claude", cwd, modeId: "bypassPermissions" },
  });
  await ctx.daemon.daemon.agentManager.runAgent(agent.id, "Reply with OK. Do not use tools.");

  const result = await mcp.callTool({
    name: "move_agent",
    arguments: { agentId: agent.id, provider: "codex", continueWork: false },
  });

  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toMatchObject({
    strategy: "handoff",
    fellBackFromNative: false,
  });
  const newId = (result.structuredContent as { agentId: string }).agentId;
  expect(newId).not.toBe(agent.id);
  const stored = await ctx.daemon.daemon.agentStorage.get(agent.id);
  expect(stored?.archivedAt).toBeTruthy();
});

it("move_agent passes the target model to the moved agent", async () => {
  const agent = await ctx.client.createAgent({
    config: { provider: "claude", cwd, modeId: "bypassPermissions" },
  });
  await ctx.daemon.daemon.agentManager.runAgent(agent.id, "Reply with OK. Do not use tools.");

  const result = await mcp.callTool({
    name: "move_agent",
    arguments: { agentId: agent.id, provider: "codex", model: "gpt-5.4-mini", continueWork: false },
  });

  expect(result.isError).toBeFalsy();
  const newId = (result.structuredContent as { agentId: string }).agentId;
  const moved = await ctx.daemon.daemon.agentStorage.get(newId);
  expect(moved?.config?.model).toBe("gpt-5.4-mini");
});

async function moveWithTool(agentId: string, provider: string): Promise<string> {
  const moved = await mcp.callTool({
    name: "move_agent",
    arguments: { agentId, provider, continueWork: false },
  });
  return (moved.structuredContent as { agentId: string }).agentId;
}

it("move_agent with back=true returns to an earlier agent in the chain", async () => {
  const agent = await ctx.client.createAgent({
    config: { provider: "claude", cwd, modeId: "bypassPermissions" },
  });
  await ctx.daemon.daemon.agentManager.runAgent(agent.id, "Reply with OK. Do not use tools.");
  const middleId = await moveWithTool(agent.id, "codex");
  const lastId = await moveWithTool(middleId, "claude");

  // Without toAgentId the move would return to the middle agent.
  const result = await mcp.callTool({
    name: "move_agent",
    arguments: { agentId: lastId, back: true, toAgentId: agent.id, continueWork: false },
  });

  expect(result.isError).toBeFalsy();
  expect(result.structuredContent).toMatchObject({ agentId: agent.id, strategy: "handoff" });
  expect((await ctx.daemon.daemon.agentStorage.get(lastId))?.archivedAt).toBeTruthy();
  expect((await ctx.daemon.daemon.agentStorage.get(agent.id))?.archivedAt ?? null).toBeNull();
});

it("move_agent refuses inputs that mix a forward move and a move back", async () => {
  const agent = await ctx.client.createAgent({
    config: { provider: "claude", cwd, modeId: "bypassPermissions" },
  });
  await ctx.daemon.daemon.agentManager.runAgent(agent.id, "Reply with OK. Do not use tools.");
  const movedId = await moveWithTool(agent.id, "codex");

  for (const mixed of [
    { back: true, provider: "claude" },
    { back: true, model: "m" },
    { provider: "claude", toAgentId: agent.id },
  ]) {
    const result = await mcp.callTool({
      name: "move_agent",
      arguments: { agentId: movedId, continueWork: false, ...mixed },
    });
    expect(result.isError).toBe(true);
  }

  expect((await ctx.daemon.daemon.agentStorage.get(movedId))?.archivedAt ?? null).toBeNull();
  expect((await ctx.daemon.daemon.agentStorage.get(agent.id))?.archivedAt).toBeTruthy();
});

it("move_agent requires a provider unless back=true", async () => {
  const result = await mcp.callTool({ name: "move_agent", arguments: { agentId: "x" } });
  expect(result.isError).toBe(true);
});
