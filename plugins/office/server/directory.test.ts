import { expect, test } from "vitest";
import type { OfficeAgent, OfficeWorkspace } from "../shared/contracts.js";
import {
  agentsFromSnapshot,
  applyAgentUpdate,
  applyWorkspaceUpdate,
  projectAgent,
  projectWorkspace,
  settleResets,
  sortAgents,
  sortWorkspaces,
  workspacesFromSnapshot,
  type DirectoryAgentInput,
  type DirectoryPermissionInput,
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

test("an agent's stored sub-agent number and next are read when they are positive integers", () => {
  expect(
    projectAgent(
      agentInput({ metadata: { "office.subagent.number": 2, "office.subagent.next": 5 } }),
    ),
  ).toEqual(officeAgent({ number: 2, next: 5 }));
  for (const bad of ["2", 0, 1.5, -1, null]) {
    expect(projectAgent(agentInput({ metadata: { "office.subagent.number": bad } }))).toEqual(
      officeAgent({}),
    );
  }
});

test("a permission says what is asked: the command, the file, the address or the description", () => {
  const asked = (request: Partial<DirectoryPermissionInput>) =>
    projectAgent(
      agentInput({ pendingPermissions: [{ id: "r", name: "Bash", kind: "tool", ...request }] }),
    )?.permissions[0];

  expect(asked({ detail: { type: "shell", command: "npm run\n  build" } })).toEqual({
    id: "r",
    kind: "tool",
    title: "Bash",
    detail: "npm run build",
  });
  expect(asked({ name: "Edit", detail: { type: "edit", filePath: "/work/a.ts" } })?.detail).toBe(
    "/work/a.ts",
  );
  expect(
    asked({ name: "Fetch", detail: { type: "fetch", url: "https://example.com/x" } })?.detail,
  ).toBe("https://example.com/x");
  expect(asked({ description: "Reads the board" })?.detail).toBe("Reads the board");
  // Nothing more to say than the title already does.
  expect(asked({ title: "npm test", detail: { type: "shell", command: "npm test" } })).toEqual({
    id: "r",
    kind: "tool",
    title: "npm test",
  });
  expect(asked({ detail: { type: "unknown" }, description: "  " })).toEqual({
    id: "r",
    kind: "tool",
    title: "Bash",
  });
  const long = asked({ detail: { type: "shell", command: "x".repeat(400) } })?.detail;
  expect(long).toBe(`${"x".repeat(299)}…`);
});

test("an idle agent carries when the host last changed it, and a busy one carries nothing", () => {
  const at = "2026-11-17T18:00:00.000Z";
  expect(projectAgent(agentInput({ updatedAt: at }))?.idleSince).toBe(at);
  // A running agent's time moves with each step of its turn: every step would be an update.
  expect(projectAgent(agentInput({ status: "running", updatedAt: at }))).not.toHaveProperty(
    "idleSince",
  );
  expect(projectAgent(agentInput({ status: "error", updatedAt: at }))).not.toHaveProperty(
    "idleSince",
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

test("an agent carries how full its context is when its provider says both numbers", () => {
  const context = (lastUsage: DirectoryAgentInput["lastUsage"]) =>
    projectAgent(agentInput({ lastUsage }))?.context;
  expect(context({ contextWindowUsedTokens: 164_000, contextWindowMaxTokens: 200_000 })).toEqual({
    usedTokens: 164_000,
    maxTokens: 200_000,
  });
  expect(context({ contextWindowUsedTokens: 0, contextWindowMaxTokens: 200_000 })).toEqual({
    usedTokens: 0,
    maxTokens: 200_000,
  });
  expect(context(undefined)).toBeUndefined();
  expect(context({ contextWindowUsedTokens: 9000 })).toBeUndefined();
  expect(context({ contextWindowMaxTokens: 200_000 })).toBeUndefined();
  expect(context({ contextWindowUsedTokens: 9000, contextWindowMaxTokens: 0 })).toBeUndefined();
  expect(context({ contextWindowUsedTokens: -1, contextWindowMaxTokens: 200_000 })).toBeUndefined();
});

test("a reset agent's context reads empty until its provider says another number", () => {
  const full = { usedTokens: 164_000, maxTokens: 200_000 };
  const agents = [
    officeAgent({ id: "a1", context: full }),
    officeAgent({ id: "a2", context: full }),
  ];
  const resets = new Map([["a1", 164_000]]);

  const stale = settleResets(agents, resets);
  expect(stale.agents).toEqual([
    officeAgent({ id: "a1", context: { usedTokens: 0, maxTokens: 200_000 } }),
    officeAgent({ id: "a2", context: full }),
  ]);
  expect([...stale.resets]).toEqual([["a1", 164_000]]);

  const next = settleResets(
    [officeAgent({ id: "a1", context: { usedTokens: 2100, maxTokens: 200_000 } })],
    stale.resets,
  );
  expect(next.agents).toEqual([
    officeAgent({ id: "a1", context: { usedTokens: 2100, maxTokens: 200_000 } }),
  ]);
  expect(next.resets.size).toBe(0);
});

test("a reset is forgotten with its agent, and with a context nobody reports any more", () => {
  const resets = new Map([
    ["gone", 5000],
    ["silent", 7000],
  ]);
  const settled = settleResets([officeAgent({ id: "silent" })], resets);
  expect(settled.agents).toEqual([officeAgent({ id: "silent" })]);
  expect(settled.resets.size).toBe(0);
});

test("a workspace carries its branch, the ticket it was started on and its pull request", () => {
  const projected = projectWorkspace(
    workspaceInput({
      metadata: { "tasks.key": "SHOP-41", "tasks.url": "https://jira.example/browse/SHOP-41" },
      gitRuntime: { currentBranch: "feat/checkout" },
      diffStat: { additions: 120, deletions: 30 },
      githubRuntime: {
        pullRequest: {
          number: 12,
          url: "https://github.example/shop/pull/12",
          title: "Fix checkout",
          state: "OPEN",
          baseRefName: "main",
          isMerged: false,
          isDraft: true,
          mergeable: "CONFLICTING",
          checks: [
            { name: "lint", status: "success", url: "https://ci.example/1", duration: "41s" },
            { name: "unit", status: "failure", url: "https://ci.example/2", workflow: "CI" },
            { name: "e2e", status: "pending", url: null },
          ],
          checksStatus: "failure",
          reviewDecision: "changes_requested",
        },
      },
      scripts: [
        {
          scriptName: "dev",
          lifecycle: "running",
          health: "healthy",
          port: 5173,
          terminalId: "t1",
        },
        {
          scriptName: "test",
          type: "script",
          lifecycle: "stopped",
          health: null,
          exitCode: 1,
          port: null,
        },
      ],
    }),
  );
  expect(projected).toEqual({
    id: "w1",
    name: "main",
    projectName: "paseo",
    branch: "feat/checkout",
    ticket: { key: "SHOP-41", url: "https://jira.example/browse/SHOP-41" },
    changes: { additions: 120, deletions: 30 },
    pullRequest: {
      number: 12,
      url: "https://github.example/shop/pull/12",
      title: "Fix checkout",
      base: "main",
      state: "draft",
      checks: "failure",
      runs: [
        { name: "unit", status: "failure", url: "https://ci.example/2", workflow: "CI" },
        { name: "e2e", status: "pending", url: null },
        { name: "lint", status: "success", url: "https://ci.example/1", duration: "41s" },
      ],
      review: "changes_requested",
      conflicts: true,
    },
    scripts: [
      {
        name: "dev",
        kind: "service",
        running: true,
        health: "healthy",
        exitCode: null,
        port: 5173,
        terminalId: "t1",
      },
      {
        name: "test",
        kind: "script",
        running: false,
        health: null,
        exitCode: 1,
        port: null,
        terminalId: null,
      },
    ],
  });
});

test("a pull request is merged, closed, a draft or open, whatever its forge calls the state", () => {
  const state = (pullRequest: object) =>
    projectWorkspace(
      workspaceInput({
        githubRuntime: {
          pullRequest: { url: "u", title: "t", state: "OPEN", isMerged: false, ...pullRequest },
        },
      }),
    )?.pullRequest;
  expect(state({})).toEqual({
    number: null,
    url: "u",
    title: "t",
    base: null,
    state: "open",
    checks: "none",
    runs: [],
    review: null,
    conflicts: false,
  });
  expect(state({ isMerged: true })?.state).toBe("merged");
  expect(state({ state: "merged" })?.state).toBe("merged");
  expect(state({ state: "CLOSED", isDraft: true })?.state).toBe("closed");
  expect(state({ state: "opened", isDraft: true })?.state).toBe("draft");
});

test("a workspace without a branch, a ticket or a pull request carries none", () => {
  const plain = { id: "w1", name: "main", projectName: "paseo" };
  expect(
    projectWorkspace(
      workspaceInput({
        metadata: { "tasks.key": "", "other.key": "x" },
        gitRuntime: { currentBranch: null },
        diffStat: null,
        scripts: [],
        githubRuntime: { pullRequest: null },
      }),
    ),
  ).toEqual(plain);
  // A checkout that changes nothing has no size to show.
  expect(projectWorkspace(workspaceInput({ diffStat: { additions: 0, deletions: 0 } }))).toEqual(
    plain,
  );
  expect(projectWorkspace(workspaceInput({ gitRuntime: null, githubRuntime: null }))).toEqual(
    plain,
  );
  // A ticket whose address was not kept still has its key.
  expect(projectWorkspace(workspaceInput({ metadata: { "tasks.key": "#9" } }))?.ticket).toEqual({
    key: "#9",
    url: null,
  });
});

test("a long list of checks keeps what fails and what runs", () => {
  const passing = Array.from({ length: 60 }, (_, index) => ({
    name: `pass ${index}`,
    status: "success" as const,
    url: null,
  }));
  const runs = projectWorkspace(
    workspaceInput({
      githubRuntime: {
        pullRequest: {
          url: "u",
          title: "t",
          state: "OPEN",
          isMerged: false,
          checks: [
            ...passing,
            { name: "slow", status: "pending", url: null },
            { name: "broken", status: "failure", url: null },
          ],
        },
      },
    }),
  )?.pullRequest?.runs;
  expect(runs).toHaveLength(40);
  expect(runs?.slice(0, 3).map((run) => run.name)).toEqual(["broken", "slow", "pass 0"]);
});
