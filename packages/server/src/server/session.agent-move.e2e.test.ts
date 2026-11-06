import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createDaemonTestContext,
  type DaemonTestContext,
} from "./test-utils/daemon-test-context.js";
import { DaemonClient } from "./test-utils/daemon-client.js";

describe("session agent move RPCs", () => {
  let ctx: DaemonTestContext;
  // A second client performs the moves so agent.moved must cross sockets to ctx.client.
  let peer: DaemonClient;
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "session-agent-move-"));
    ctx = await createDaemonTestContext();
    peer = new DaemonClient({ url: `ws://127.0.0.1:${ctx.daemon.port}/ws` });
    await peer.connect();
  });

  afterEach(async () => {
    await peer.close();
    await ctx.cleanup();
    await rm(cwd, { recursive: true, force: true });
  });

  async function createRanClaudeAgent(): Promise<string> {
    const agent = await ctx.client.createAgent({
      config: { provider: "claude", cwd, modeId: "bypassPermissions" },
    });
    await ctx.daemon.daemon.agentManager.runAgent(agent.id, "Reply with OK. Do not use tools.");
    return agent.id;
  }

  it("moves an agent to another provider and notifies subscribed clients", async () => {
    const sourceId = await createRanClaudeAgent();
    const moved: Array<{ fromAgentId: string; toAgentId: string }> = [];
    const unsubscribe = ctx.client.on("agent.moved", (message) => {
      if (message.type === "agent.moved") {
        const { fromAgentId, toAgentId } = message.payload;
        moved.push({ fromAgentId, toAgentId });
      }
    });
    const events = ctx.client.observeEvents(["agent.moved"]);
    await events.ready;

    const result = await peer.moveAgent(sourceId, { provider: "codex" }, { continueWork: false });

    expect(result).toMatchObject({ strategy: "handoff", fellBackFromNative: false });
    const newId = result.agentId;
    expect(newId).toBeTruthy();
    expect(newId).not.toBe(sourceId);
    // The event crosses a second socket; under load that takes longer than the 1s default.
    await expect
      .poll(() => moved, { timeout: 10_000 })
      .toEqual([{ fromAgentId: sourceId, toAgentId: newId }]);
    unsubscribe();
    await events.release();
  });

  it("rejects a failed move with the daemon's error", async () => {
    await expect(
      peer.moveAgent("missing-agent", { provider: "codex" }, { continueWork: false }),
    ).rejects.toThrow("missing-agent");
  });

  it("moves a moved agent back to its original", async () => {
    const sourceId = await createRanClaudeAgent();
    const moved = await peer.moveAgent(sourceId, { provider: "codex" }, { continueWork: false });

    const back = await peer.moveAgentBack(moved.agentId, { continueWork: false });

    expect(back.agentId).toBe(sourceId);
  });

  it("moves back past the direct original to an earlier agent in the chain", async () => {
    const sourceId = await createRanClaudeAgent();
    const first = await peer.moveAgent(sourceId, { provider: "codex" }, { continueWork: false });
    const second = await peer.moveAgent(
      first.agentId,
      { provider: "claude" },
      { continueWork: false },
    );

    const back = await peer.moveAgentBack(second.agentId, {
      continueWork: false,
      toAgentId: sourceId,
    });

    expect(back.agentId).toBe(sourceId);
  });

  it("lists move targets and marks the agent's own provider as current", async () => {
    const sourceId = await createRanClaudeAgent();

    const targets = await peer.listMoveTargets(sourceId);

    const byProvider = new Map(targets.map((target) => [target.provider, target]));
    expect(byProvider.get("claude")).toMatchObject({ current: true, family: "claude" });
    expect(byProvider.get("codex")).toMatchObject({ current: false, family: "codex" });
  });

  it("rejects move targets for an unknown agent with the daemon error", async () => {
    await expect(peer.listMoveTargets("missing-agent")).rejects.toThrow("missing-agent");
  });
});
