import type { OfficeAgent, OfficeSnapshot, Post } from "../../shared/contracts.js";

type AgentFields = Partial<OfficeAgent> & Pick<OfficeAgent, "provider" | "status" | "workspaceId">;

// The fake agents use their titles as ids so a screenshot reads well; real ids are UUIDs.
function agent(id: string, minute: number, fields: AgentFields): OfficeAgent {
  return {
    id,
    title: id,
    model: null,
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-11T08:${String(minute).padStart(2, "0")}:00.000Z`,
    ...fields,
  };
}

function post(fields: Omit<Post, "createdAt" | "updatedAt">): Post {
  return {
    ...fields,
    createdAt: "2026-11-11T09:00:00.000Z",
    updatedAt: "2026-11-11T09:00:00.000Z",
  };
}

/** A fixed office for the look review and tests: every pose, a child, an overflow, posts. */
export function fakeOffice(): OfficeSnapshot {
  const crowd = Array.from({ length: 26 }, (_, index) =>
    agent(`load-${String(index + 1).padStart(2, "0")}`, 20 + index, {
      provider: index % 2 === 0 ? "claude" : "codex",
      status: index % 3 === 0 ? "running" : "idle",
      workspaceId: "w-load",
    }),
  );
  return {
    workspaces: [
      { id: "w-main", name: "main", projectName: "paseo" },
      { id: "w-docs", name: "docs-site", projectName: "docs" },
      { id: "w-infra", name: "terraform", projectName: "infra" },
      { id: "w-load", name: "load-test", projectName: "bench" },
    ],
    agents: [
      agent("Refactor hub", 0, { provider: "claude", status: "running", workspaceId: "w-main" }),
      agent("Review MR", 1, { provider: "codex", status: "idle", workspaceId: "w-main" }),
      agent("Hub tests", 2, {
        provider: "claude",
        status: "running",
        workspaceId: "w-main",
        parentAgentId: "Refactor hub",
      }),
      agent("Upgrade deps", 3, {
        provider: "opencode",
        status: "running",
        workspaceId: "w-main",
        permissions: [{ id: "perm-1", kind: "tool", title: "Run npm install" }],
      }),
      agent("Fix links", 4, { provider: "claude", status: "error", workspaceId: "w-docs" }),
      agent("New page", 5, { provider: "codex", status: "initializing", workspaceId: "w-docs" }),
      agent("Plan VPC", 6, { provider: "copilot", status: "running", workspaceId: "w-infra" }),
      agent("Triage", 7, { provider: "pi", status: "idle", workspaceId: null }),
      ...crowd,
    ],
    activity: {
      "Refactor hub": "Running Bash",
      "Hub tests": "Writing a reply",
      "Plan VPC": "Thinking",
    },
    boards: {
      lobby: [
        post({
          id: "p1",
          seq: 1,
          board: "lobby",
          kind: "task",
          text: "Rotate the staging certificate",
          author: "user",
          state: "open",
        }),
      ],
      "w-main": [
        post({
          id: "p2",
          seq: 2,
          board: "w-main",
          kind: "task",
          text: "Write hub tests",
          author: "Refactor hub",
          to: "Hub tests",
          state: "claimed",
          claimedBy: "Hub tests",
        }),
        post({
          id: "p3",
          seq: 3,
          board: "w-main",
          kind: "note",
          text: "Lint is green on main",
          author: "Review MR",
        }),
        post({
          id: "p4",
          seq: 4,
          board: "w-main",
          kind: "task",
          text: "Bump zod",
          author: "user",
          state: "open",
        }),
      ],
    },
    wake: { paused: false, queued: {} },
  };
}
