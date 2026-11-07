import { describe, expect, it } from "vitest";
import { parentAgentId, readAgentFacts, type AgentDirectory, type AgentSnapshot } from "./agent.js";

const SESSION_ID = "0f8c2d4e-1a2b-4c3d-8e9f-0123456789ab";

const claudeAgent: AgentSnapshot = {
  id: "agent-claude",
  cwd: "/work/project",
  persistence: { sessionId: SESSION_ID },
};

const plainAgent: AgentSnapshot = { id: "agent-plain", cwd: "/work/project", persistence: null };

interface FakeDirectory extends AgentDirectory {
  asked: string[];
}

/** `paseo.agents` in memory: answers like fetch_agent, null for an unknown id. */
function directory(snapshots: Map<string, AgentSnapshot>): FakeDirectory {
  const asked: string[] = [];
  return {
    asked,
    ref(agentId: string) {
      return {
        async refresh() {
          asked.push(agentId);
          const agent = snapshots.get(agentId);
          return agent === undefined ? null : { agent };
        },
      };
    },
  };
}

function failingDirectory(error: Error): AgentDirectory {
  return {
    ref() {
      return {
        async refresh() {
          throw error;
        },
      };
    },
  };
}

describe("parentAgentId", () => {
  it("keeps a plain agent id", () => {
    expect(parentAgentId("agent-claude")).toBe("agent-claude");
  });

  it("resolves a provider-subagent id to its decoded parent", () => {
    const id = `provider:${encodeURIComponent("agent/claude")}:${encodeURIComponent("sub:1")}`;
    expect(parentAgentId(id)).toBe("agent/claude");
  });

  it("rejects a parent that is not valid percent-encoding", () => {
    expect(parentAgentId("provider:%E0%A4%A:sub")).toBeNull();
  });
});

describe("readAgentFacts", () => {
  it("reads the Claude session id and cwd", async () => {
    const agents = directory(new Map([[claudeAgent.id, claudeAgent]]));
    await expect(readAgentFacts(agents, claudeAgent.id)).resolves.toEqual({
      kind: "claude",
      sessionId: SESSION_ID,
      cwd: "/work/project",
    });
    expect(agents.asked).toEqual(["agent-claude"]);
  });

  it("asks for the parent of a provider-subagent id", async () => {
    const agents = directory(new Map([[claudeAgent.id, claudeAgent]]));
    await expect(readAgentFacts(agents, "provider:agent-claude:sub-1")).resolves.toEqual({
      kind: "claude",
      sessionId: SESSION_ID,
      cwd: "/work/project",
    });
    expect(agents.asked).toEqual(["agent-claude"]);
  });

  it("reports an unknown agent", async () => {
    await expect(readAgentFacts(directory(new Map()), "agent-gone")).resolves.toEqual({
      kind: "unavailable",
      reason: "agent-not-found",
    });
  });

  it("does not take an agent that fetch_agent matched by prefix or title", async () => {
    const agents = directory(new Map([["agent", claudeAgent]]));
    await expect(readAgentFacts(agents, "agent")).resolves.toEqual({
      kind: "unavailable",
      reason: "agent-not-found",
    });
  });

  it("reports an agent without a provider session", async () => {
    const agents = directory(new Map([[plainAgent.id, plainAgent]]));
    await expect(readAgentFacts(agents, plainAgent.id)).resolves.toEqual({
      kind: "unavailable",
      reason: "not-claude",
    });
  });

  it("reports a malformed provider-subagent id without asking", async () => {
    const agents = directory(new Map());
    await expect(readAgentFacts(agents, "provider:%E0%A4%A:sub")).resolves.toEqual({
      kind: "unavailable",
      reason: "agent-not-found",
    });
    expect(agents.asked).toEqual([]);
  });

  it("lets a failed snapshot read reject, so the call fails instead of reporting a missing agent", async () => {
    const agents = failingDirectory(new Error("daemon connection closed"));
    await expect(readAgentFacts(agents, "agent-claude")).rejects.toThrow(
      "daemon connection closed",
    );
  });
});
