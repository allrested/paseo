import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { AgentPromptInput } from "../agent-sdk-types.js";
import {
  createDaemonTestContext,
  type DaemonTestContext,
} from "../../test-utils/daemon-test-context.js";
import { createTestAgentClients } from "../../test-utils/fake-agent-client.js";
import { withPendingMoveContext } from "./pending-context.js";

const context = { text: "Moved from Claude (personal)…", title: "Chat history" };

describe("withPendingMoveContext", () => {
  it("puts the history before a plain text prompt", () => {
    expect(withPendingMoveContext("continue please", context)).toEqual([
      {
        type: "text",
        mimeType: "text/plain",
        contextKind: "chat_history",
        title: "Chat history",
        text: context.text,
      },
      { type: "text", text: "continue please" },
    ]);
  });

  it("puts the history before existing blocks", () => {
    const prompt = [{ type: "text" as const, text: "hi" }];
    const result = withPendingMoveContext(prompt, context);
    expect(Array.isArray(result) && result[0]).toMatchObject({ contextKind: "chat_history" });
    expect(Array.isArray(result) && result[1]).toEqual({ type: "text", text: "hi" });
  });
});

describe("pending move context on the next prompt", () => {
  let ctx: DaemonTestContext;
  let cwd: string;
  const receivedPrompts: AgentPromptInput[] = [];

  beforeEach(async () => {
    receivedPrompts.length = 0;
    cwd = mkdtempSync(path.join(tmpdir(), "pending-move-context-"));
    ctx = await createDaemonTestContext({
      agentClients: createTestAgentClients({
        onStartTurn: (prompt) => {
          receivedPrompts.push(prompt);
        },
      }),
    });
  });

  afterEach(async () => {
    await ctx.cleanup();
    rmSync(cwd, { recursive: true, force: true });
  });

  it("sends the pending history with the next prompt and clears it", async () => {
    const agent = await ctx.client.createAgent({ provider: "claude", cwd, title: "moved" });
    const { agentStorage } = ctx.daemon.daemon;
    const record = await agentStorage.get(agent.id);
    if (!record) throw new Error("stored record missing");
    await agentStorage.upsert({
      ...record,
      pendingMoveContext: { text: "HANDOFF-MARKER", title: "Chat history" },
    });

    await ctx.client.sendAgentMessage(agent.id, "hi");
    await ctx.client.waitForFinish(agent.id, 30000);

    expect(JSON.stringify(receivedPrompts)).toContain("HANDOFF-MARKER");
    expect((await agentStorage.get(agent.id))?.pendingMoveContext).toBeNull();
  });
});
