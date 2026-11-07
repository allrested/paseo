import { describe, expect, it } from "vitest";
import { FakeAgents, FakeWorkspaces } from "./fake-ports.js";
import {
  closeIdleAgent,
  listLiveAgents,
  listWorkspaceDirectories,
  type AgentSummary,
  type LiveAgent,
} from "./paseo-ports.js";

function agent(id: string, status: string): AgentSummary {
  return {
    id,
    title: `Agent ${id}`,
    provider: "claude",
    status,
    updatedAt: "2026-11-06T09:00:00.000Z",
    persistence: { sessionId: `session-${id}` },
  };
}

describe("listLiveAgents", () => {
  it("follows every page and keeps only live agents", async () => {
    const agents = new FakeAgents(
      [
        agent("a", "idle"),
        agent("b", "running"),
        agent("c", "closed"),
        agent("d", "initializing"),
        agent("e", "error"),
      ],
      2,
    );

    const live = await listLiveAgents(agents);

    const expected: LiveAgent[] = [
      {
        id: "a",
        title: "Agent a",
        provider: "claude",
        status: "idle",
        updatedAt: "2026-11-06T09:00:00.000Z",
      },
      {
        id: "b",
        title: "Agent b",
        provider: "claude",
        status: "running",
        updatedAt: "2026-11-06T09:00:00.000Z",
      },
      {
        id: "d",
        title: "Agent d",
        provider: "claude",
        status: "initializing",
        updatedAt: "2026-11-06T09:00:00.000Z",
      },
      {
        id: "e",
        title: "Agent e",
        provider: "claude",
        status: "error",
        updatedAt: "2026-11-06T09:00:00.000Z",
      },
    ];
    expect(live).toEqual(expected);
    expect(agents.requests.map((request) => request.page.cursor)).toEqual([undefined, "2", "4"]);
    expect(agents.requests[0]).toEqual({
      includeBackground: true,
      filter: { statuses: ["initializing", "idle", "running", "error"], includeBackground: true },
      page: { limit: 200, cursor: undefined },
    });
  });

  it("passes a failed list through", async () => {
    const agents = new FakeAgents([]);
    agents.listError = new Error("daemon unavailable");

    await expect(listLiveAgents(agents)).rejects.toThrow("daemon unavailable");
  });
});

describe("listWorkspaceDirectories", () => {
  it("uses the workspace directory, else the project root, once each, over every page", async () => {
    const workspaces = new FakeWorkspaces(
      [
        { projectRootPath: "/repo", workspaceDirectory: "/repo/.paseo/worktrees/fix" },
        { projectRootPath: "/repo" },
        { projectRootPath: "/other" },
        { projectRootPath: "/repo" },
      ],
      3,
    );

    await expect(listWorkspaceDirectories(workspaces)).resolves.toEqual([
      "/repo/.paseo/worktrees/fix",
      "/repo",
      "/other",
    ]);
    expect(workspaces.requests).toEqual([
      { page: { limit: 200, cursor: undefined } },
      { page: { limit: 200, cursor: "3" } },
    ]);
  });
});

describe("closeIdleAgent", () => {
  it("closes an idle agent's runtime", async () => {
    const agents = new FakeAgents([agent("a", "idle")]);

    await expect(closeIdleAgent(agents, "a")).resolves.toEqual({ ok: true, error: null });
    expect(agents.closed).toEqual(["a"]);
  });

  it("refuses a running or starting agent and leaves it alone", async () => {
    const agents = new FakeAgents([agent("b", "running"), agent("d", "initializing")]);

    const busy = { ok: false, error: "Agent is busy; close it once it is idle" };
    await expect(closeIdleAgent(agents, "b")).resolves.toEqual(busy);
    await expect(closeIdleAgent(agents, "d")).resolves.toEqual(busy);
    expect(agents.closed).toEqual([]);
  });

  it("accepts an agent that is already closed without closing it again", async () => {
    const agents = new FakeAgents([agent("c", "closed")]);

    await expect(closeIdleAgent(agents, "c")).resolves.toEqual({ ok: true, error: null });
    expect(agents.closed).toEqual([]);
  });

  it("refuses an idle agent without a saved session to resume", async () => {
    const agents = new FakeAgents([{ ...agent("n", "idle"), persistence: null }]);

    await expect(closeIdleAgent(agents, "n")).resolves.toEqual({
      ok: false,
      error: "This agent has no saved session to resume, so it stays open",
    });
    expect(agents.closed).toEqual([]);
  });

  it("reports a missing agent, a failed refresh and a failed close", async () => {
    const agents = new FakeAgents([agent("a", "idle")]);
    await expect(closeIdleAgent(agents, "zz")).resolves.toEqual({
      ok: false,
      error: "Agent not found",
    });

    agents.closeError = new Error("Agent a not found");
    await expect(closeIdleAgent(agents, "a")).resolves.toEqual({
      ok: false,
      error: "Agent a not found",
    });

    agents.refreshError = new Error("socket closed");
    await expect(closeIdleAgent(agents, "a")).resolves.toEqual({
      ok: false,
      error: "socket closed",
    });
  });
});
