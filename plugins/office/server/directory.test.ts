import { expect, test } from "vitest";
import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import {
  agentsFromSnapshot,
  applyAgentUpdate,
  applyWorkspaceUpdate,
  projectAgent,
  projectWorkspace,
  sortAgents,
  sortWorkspaces,
  workspacesFromSnapshot,
  type DirectoryAgentInput,
  type DirectoryWorkspaceInput,
} from "./directory.js";

function agentInput(overrides: Partial<DirectoryAgentInput>): DirectoryAgentInput {
  return {
    id: "a1",
    title: "Builder",
    provider: "claude",
    model: "opus",
    status: "idle",
    workspaceId: "w1",
    createdAt: "2026-11-11T08:00:00.000Z",
    labels: {},
    pendingPermissions: [],
    ...overrides,
  };
}

function officeAgent(overrides: Partial<OfficeAgent>): OfficeAgent {
  return {
    id: "a1",
    title: "Builder",
    provider: "claude",
    model: "opus",
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-11T08:00:00.000Z",
    ...overrides,
  };
}

function workspaceInput(overrides: Partial<DirectoryWorkspaceInput>): DirectoryWorkspaceInput {
  return { id: "w1", name: "main", projectDisplayName: "paseo", archivingAt: null, ...overrides };
}

test("projects an agent with its parent and pending permissions", () => {
  const projected = projectAgent(
    agentInput({
      status: "running",
      labels: { "paseo.parent-agent-id": " p0 " },
      pendingPermissions: [
        { id: "r1", name: "Bash", kind: "tool", title: "Run npm test" },
        { id: "r2", name: "ExitPlanMode", kind: "plan" },
        { id: "r3", name: "Odd", kind: "something-new" },
      ],
    }),
  );
  expect(projected).toEqual(
    officeAgent({
      status: "running",
      parentAgentId: "p0",
      permissions: [
        { id: "r1", kind: "tool", title: "Run npm test" },
        { id: "r2", kind: "plan", title: "ExitPlanMode" },
        { id: "r3", kind: "other", title: "Odd" },
      ],
    }),
  );
});

test("an agent without a workspace sits in the lobby", () => {
  expect(projectAgent(agentInput({ workspaceId: undefined }))).toEqual(
    officeAgent({ workspaceId: null }),
  );
});

test("closed, archived, internal, background and unknown agents are not shown", () => {
  expect(projectAgent(agentInput({ status: "closed" }))).toBe(null);
  expect(projectAgent(agentInput({ archivedAt: "2026-11-11T09:00:00.000Z" }))).toBe(null);
  expect(projectAgent(agentInput({ internal: true }))).toBe(null);
  expect(projectAgent(agentInput({ background: true }))).toBe(null);
  expect(projectAgent(agentInput({ status: "sleeping" }))).toBe(null);
});

test("updates replace, remove, and drop an agent that closed", () => {
  const start = agentsFromSnapshot([agentInput({}), agentInput({ id: "a2", status: "closed" })]);
  expect([...start.values()]).toEqual([officeAgent({})]);

  const running = applyAgentUpdate(start, {
    kind: "upsert",
    agent: agentInput({ status: "running" }),
  });
  expect([...running.values()]).toEqual([officeAgent({ status: "running" })]);
  expect([...start.values()]).toEqual([officeAgent({})]);

  const closed = applyAgentUpdate(running, {
    kind: "upsert",
    agent: agentInput({ status: "closed" }),
  });
  expect(closed.size).toBe(0);

  const removed = applyAgentUpdate(running, { kind: "remove", agentId: "a1" });
  expect(removed.size).toBe(0);
});

test("workspaces project, drop while archiving, and update", () => {
  expect(projectWorkspace(workspaceInput({}))).toEqual({
    id: "w1",
    name: "main",
    projectName: "paseo",
  });
  expect(projectWorkspace(workspaceInput({ archivingAt: "2026-11-11T09:00:00.000Z" }))).toBe(null);

  const start = workspacesFromSnapshot([
    workspaceInput({}),
    workspaceInput({ id: "w2", name: "docs" }),
  ]);
  const renamed = applyWorkspaceUpdate(start, {
    kind: "upsert",
    workspace: workspaceInput({ id: "w2", name: "guides" }),
  });
  expect(sortWorkspaces(renamed.values())).toEqual([
    { id: "w2", name: "guides", projectName: "paseo" },
    { id: "w1", name: "main", projectName: "paseo" },
  ]);
  expect([...applyWorkspaceUpdate(renamed, { kind: "remove", id: "w1" }).keys()]).toEqual(["w2"]);
});

test("agents sort by creation time, then id; workspaces by name, project, then id", () => {
  const later = officeAgent({ id: "a0", createdAt: "2026-11-11T09:00:00.000Z" });
  const first = officeAgent({ id: "b", createdAt: "2026-11-11T08:00:00.000Z" });
  const tie = officeAgent({ id: "a", createdAt: "2026-11-11T08:00:00.000Z" });
  expect(sortAgents([later, first, tie]).map((agent) => agent.id)).toEqual(["a", "b", "a0"]);

  const workspaces: OfficeWorkspace[] = [
    { id: "w3", name: "main", projectName: "web" },
    { id: "w2", name: "main", projectName: "api" },
    { id: "w1", name: "docs", projectName: "web" },
  ];
  expect(sortWorkspaces(workspaces).map((workspace) => workspace.id)).toEqual(["w1", "w2", "w3"]);
});
