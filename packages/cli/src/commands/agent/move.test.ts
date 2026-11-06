import { beforeEach, describe, expect, it, vi } from "vitest";

const daemonTarget = { kind: "endpoint" as const, host: "example.test:12345" };

import { runMoveBackCommand, runMoveCommand } from "./move.js";

const first = { id: "11111111-1111-4111-8111-111111111111", title: "first" };
const second = { id: "22222222-2222-4222-8222-222222222222", title: "second" };
const fetchAgents = vi.fn(async () => ({
  entries: [first, second].map((agent) => ({ agent })),
  pageInfo: { nextCursor: null },
}));
const moveAgent = vi.fn();
const moveAgentBack = vi.fn();
const close = vi.fn(async () => undefined);

vi.mock("../../utils/client.js", async () => ({
  ...(await vi.importActual<typeof import("../../utils/client.js")>("../../utils/client.js")),
  connectToDaemon: vi.fn(async () => ({ fetchAgents, moveAgent, moveAgentBack, close })),
}));

describe("agent move commands", () => {
  beforeEach(() => {
    moveAgent.mockReset();
    moveAgentBack.mockReset();
    close.mockClear();
  });

  it("move reports a native fallback", async () => {
    moveAgent.mockResolvedValue({ agentId: "new", strategy: "handoff", fellBackFromNative: true });

    const result = await runMoveCommand(
      second.id,
      { daemonTarget, to: "claude-work" },
      {} as never,
    );

    expect(moveAgent).toHaveBeenCalledWith(
      second.id,
      { provider: "claude-work" },
      { continueWork: true },
    );
    expect(result.data).toEqual({
      fromAgentId: second.id,
      agentId: "new",
      strategy: "handoff",
      fellBackFromNative: true,
    });
  });

  it("move-back forwards --to as the chain target", async () => {
    moveAgentBack.mockResolvedValue({
      agentId: first.id,
      strategy: "handoff",
      fellBackFromNative: false,
    });

    const result = await runMoveBackCommand(
      second.id,
      { daemonTarget, to: first.id.slice(0, 8) },
      {} as never,
    );

    expect(moveAgentBack).toHaveBeenCalledWith(second.id, {
      continueWork: true,
      toAgentId: first.id,
    });
    expect(result.data).toEqual({
      fromAgentId: second.id,
      agentId: first.id,
      strategy: "handoff",
      fellBackFromNative: false,
    });
  });

  it("a daemon error becomes MOVE_FAILED and closes the connection", async () => {
    moveAgent.mockRejectedValue(new Error("busy"));

    await expect(
      runMoveCommand(second.id, { daemonTarget, to: "codex" }, {} as never),
    ).rejects.toMatchObject({ code: "MOVE_FAILED", message: "Failed to move agent: busy" });
    expect(close).toHaveBeenCalled();
  });
});
