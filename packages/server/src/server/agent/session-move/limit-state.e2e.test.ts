import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDaemonTestContext } from "../../test-utils/daemon-test-context.js";
import { createTestAgentClients } from "../../test-utils/fake-agent-client.js";
import { ensureAgentLoaded } from "../agent-loading.js";

// Turns run in the daemon; under load they take longer than the 1s waitFor default.
const WAIT = { timeout: 10_000 };

describe("limitReached", () => {
  it("is set when a turn fails with a usage-limit error and cleared on the next successful turn", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "limit-state-"));
    const ctx = await createDaemonTestContext({
      agentClients: createTestAgentClients({
        failureMessage: "Claude AI usage limit reached|1762300800",
      }),
    });
    try {
      const agent = await ctx.client.createAgent({
        config: { provider: "claude", cwd, modeId: "bypassPermissions" },
      });
      await ctx.daemon.daemon.agentManager
        .runAgent(agent.id, "emit a turn failure")
        .catch(() => {});
      await vi.waitFor(() => {
        expect(ctx.daemon.daemon.agentManager.getAgent(agent.id)?.limitReached?.message).toContain(
          "usage limit",
        );
      }, WAIT);
      await ctx.daemon.daemon.agentManager.runAgent(agent.id, "Reply with OK. Do not use tools.");
      expect(ctx.daemon.daemon.agentManager.getAgent(agent.id)?.limitReached ?? null).toBeNull();
    } finally {
      await ctx.cleanup();
    }
  });

  it("keeps an earlier limit when a later turn fails for another reason", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "limit-state-"));
    const ctx = await createDaemonTestContext({
      agentClients: createTestAgentClients({
        failureMessage: "Claude AI usage limit reached|1762300800",
      }),
    });
    try {
      const manager = ctx.daemon.daemon.agentManager;
      const agent = await ctx.client.createAgent({
        config: { provider: "claude", cwd, modeId: "bypassPermissions" },
      });
      await manager.runAgent(agent.id, "emit a turn failure").catch(() => {});
      await vi.waitFor(() => {
        expect(manager.getAgent(agent.id)?.limitReached?.message).toContain("usage limit");
      }, WAIT);

      await manager
        .runAgent(agent.id, "Emit a turn failure: connection reset by peer")
        .catch(() => {});
      await vi.waitFor(() => {
        expect(manager.getAgent(agent.id)?.lastError).toBe("connection reset by peer");
      }, WAIT);

      expect(manager.getAgent(agent.id)?.limitReached?.message).toContain("usage limit");
    } finally {
      await ctx.cleanup();
    }
  });

  it("survives closing the agent and loading it again from storage", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "limit-state-"));
    const ctx = await createDaemonTestContext({
      agentClients: createTestAgentClients({
        failureMessage: "Claude AI usage limit reached|1762300800",
      }),
    });
    try {
      const { agentManager: manager, agentStorage: storage } = ctx.daemon.daemon;
      const agent = await ctx.client.createAgent({
        config: { provider: "claude", cwd, modeId: "bypassPermissions" },
      });
      await manager.runAgent(agent.id, "emit a turn failure").catch(() => {});
      await vi.waitFor(() => {
        expect(manager.getAgent(agent.id)?.limitReached?.message).toContain("usage limit");
      }, WAIT);
      await manager.closeAgent(agent.id);
      expect((await storage.get(agent.id))?.limitReached?.message).toContain("usage limit");

      // The load a daemon restart takes when the agent is next opened.
      await ensureAgentLoaded(agent.id, {
        agentManager: manager,
        agentStorage: storage,
        logger: ctx.daemon.logger,
      });

      expect(manager.getAgent(agent.id)?.limitReached?.message).toContain("usage limit");
      await manager.flush();
      expect((await storage.get(agent.id))?.limitReached?.message).toContain("usage limit");
    } finally {
      await ctx.cleanup();
    }
  });

  it("survives a session reload", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "limit-state-"));
    const ctx = await createDaemonTestContext({
      agentClients: createTestAgentClients({
        failureMessage: "Claude AI usage limit reached|1762300800",
      }),
    });
    try {
      const manager = ctx.daemon.daemon.agentManager;
      const agent = await ctx.client.createAgent({
        config: { provider: "claude", cwd, modeId: "bypassPermissions" },
      });
      await manager.runAgent(agent.id, "emit a turn failure").catch(() => {});
      await vi.waitFor(() => {
        expect(manager.getAgent(agent.id)?.limitReached?.message).toContain("usage limit");
      }, WAIT);

      await manager.reloadAgentSession(agent.id);

      expect(manager.getAgent(agent.id)?.limitReached?.message).toContain("usage limit");
    } finally {
      await ctx.cleanup();
    }
  });
});
