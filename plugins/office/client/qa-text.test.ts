import { expect, test } from "vitest";
import type {
  ActivityStep,
  OfficeAgent,
  OfficeSnapshot,
  OfficeWorkspace,
  WorkspaceCheck,
  WorkspacePullRequest,
  WorkspaceScript,
} from "../shared/contracts.js";
import { buildOfficeModel } from "../shared/model.js";
import { logCaption, qaNote, qaSummary, qaTeams } from "./qa-text.js";

function agent(id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "running",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-16T00:00:01Z",
    ...patch,
  };
}

function run(name: string, status: WorkspaceCheck["status"], patch: Partial<WorkspaceCheck> = {}) {
  return { name, status, url: `https://ci.example/${name}`, ...patch };
}

function request(patch: Partial<WorkspacePullRequest> = {}): WorkspacePullRequest {
  return {
    number: 12,
    url: "https://forge.example/pull/12",
    title: "Fix checkout",
    base: "main",
    state: "open",
    checks: "none",
    runs: [],
    review: null,
    conflicts: false,
    ...patch,
  };
}

function script(name: string, patch: Partial<WorkspaceScript> = {}): WorkspaceScript {
  return {
    name,
    kind: "service",
    running: true,
    health: null,
    exitCode: null,
    port: null,
    terminalId: "t1",
    ...patch,
  };
}

function workspace(id: string, patch: Partial<OfficeWorkspace> = {}): OfficeWorkspace {
  return { id, name: id, projectName: "shop", ...patch };
}

function office(
  agents: OfficeAgent[],
  workspaces: OfficeWorkspace[],
  doing: Record<string, ActivityStep> = {},
): OfficeSnapshot {
  return {
    agents,
    workspaces,
    activity: {},
    doing,
    boards: {},
    wake: { paused: false, queued: {} },
  };
}

function teamsOf(
  agents: OfficeAgent[],
  workspaces: OfficeWorkspace[],
  doing: Record<string, ActivityStep> = {},
) {
  return qaTeams(buildOfficeModel(office(agents, workspaces, doing)));
}

test("a team's pipeline is counted, and what fails and what runs is listed", () => {
  const teams = teamsOf(
    [],
    [
      workspace("w1", {
        name: "shop-api",
        pullRequest: request({
          runs: [
            run("unit", "failure", { workflow: "CI", duration: "3m 12s" }),
            run("e2e", "pending", { workflow: "Nightly", url: null }),
            run("lint", "success"),
            run("types", "success"),
            run("docs", "skipped"),
            run("old", "cancelled"),
          ],
        }),
      }),
    ],
  );
  expect(teams).toEqual([
    {
      roomId: "w1",
      name: "shop-api (shop)",
      checks: "#12: 1 fail, 1 running, 2 pass, 1 skipped, 1 cancelled",
      checksFail: true,
      runs: [
        {
          name: "unit",
          detail: "Fails · CI · 3m 12s",
          failing: true,
          url: "https://ci.example/unit",
        },
        { name: "e2e", detail: "Running · Nightly", failing: false, url: null },
      ],
      tests: [],
      scripts: [],
    },
  ]);
});

test("a pipeline that passes lists no check, and a merged pull request has none", () => {
  const green = teamsOf(
    [],
    [workspace("w1", { pullRequest: request({ number: null, runs: [run("lint", "success")] }) })],
  );
  expect(green[0]).toMatchObject({
    checks: "The pull request: 1 pass",
    checksFail: false,
    runs: [],
  });
  expect(
    teamsOf(
      [],
      [
        workspace("w1", {
          pullRequest: request({ state: "merged", runs: [run("unit", "failure")] }),
        }),
        workspace("w2", { pullRequest: request({ state: "closed", runs: [run("x", "pending")] }) }),
        workspace("w3", { pullRequest: request() }),
        workspace("w4"),
      ],
    ),
  ).toEqual([]);
});

test("an agent at a test run is listed with how it stands", () => {
  const teams = teamsOf(
    [agent("Builder"), agent("Tester"), agent("Fixer"), agent("Editor"), agent("Idle")],
    [workspace("w1")],
    {
      Builder: { kind: "test", key: "t1" },
      Tester: { kind: "test", key: "t2", result: "passed" },
      Fixer: { kind: "test", key: "t3", result: "failed" },
      Editor: { kind: "edit", key: "e1" },
    },
  );
  expect(teams[0]?.tests).toEqual([
    // In the room's order: agents of one age by name.
    { agentId: "Builder", line: "Builder: tests running", state: "running" },
    { agentId: "Fixer", line: "Fixer: tests fail", state: "failed" },
    { agentId: "Tester", line: "Tester: tests pass", state: "passed" },
  ]);
});

test("a script says what it is, how it runs and whether its output can be read", () => {
  const scripts = (list: WorkspaceScript[]) =>
    teamsOf([], [workspace("w1", { scripts: list })])[0]?.scripts;
  expect(
    scripts([
      script("dev", { health: "healthy", port: 5173 }),
      script("api", { health: "unhealthy", port: 8080 }),
      script("worker"),
      script("test", { kind: "script", running: false, exitCode: 1, port: 9 }),
      script("build", { kind: "script", running: false, exitCode: 0 }),
      script("seed", { kind: "script", running: false, terminalId: null }),
      script("db", { running: false }),
    ]),
  ).toEqual([
    { name: "dev", line: "Service, running, healthy, port 5173", troubled: false, readable: true },
    { name: "api", line: "Service, running, unhealthy, port 8080", troubled: true, readable: true },
    { name: "worker", line: "Service, running", troubled: false, readable: true },
    {
      name: "test",
      line: "Script, ended with an error (exit 1)",
      troubled: true,
      readable: true,
    },
    { name: "build", line: "Script, ended", troubled: false, readable: true },
    { name: "seed", line: "Script, not started", troubled: false, readable: false },
    { name: "db", line: "Service, stopped", troubled: false, readable: true },
  ]);
});

test("the strip and the card's first line count what fails, then what runs", () => {
  const none = teamsOf([], [workspace("w1")]);
  expect(qaNote(none)).toBeNull();
  expect(qaSummary(none)).toBe("No checks, test runs or scripts on this host.");

  const quiet = teamsOf([], [workspace("w1", { scripts: [script("dev")] })]);
  expect(qaNote(quiet)).toEqual({ text: "Nothing fails", tone: "muted" });
  expect(qaSummary(quiet)).toBe("Nothing fails");

  const busy = teamsOf(
    [agent("a")],
    [workspace("w1", { pullRequest: request({ runs: [run("e2e", "pending")] }) })],
    { a: { kind: "test", key: "t" } },
  );
  expect(qaNote(busy)).toEqual({ text: "2 running", tone: "muted" });
  expect(qaSummary(busy)).toBe("Nothing fails, 2 running");

  const red = teamsOf(
    [agent("a")],
    [
      workspace("w1", {
        pullRequest: request({ runs: [run("unit", "failure"), run("e2e", "pending")] }),
        scripts: [script("test", { running: false, exitCode: 2 })],
      }),
    ],
    { a: { kind: "test", key: "t", result: "failed" } },
  );
  expect(qaNote(red)).toEqual({ text: "3 failing", tone: "warning" });
  expect(qaSummary(red)).toBe("3 failing, 1 running");
});

test("the line over a log says how much of it is shown", () => {
  expect(logCaption(0, 0, "09:00:00")).toBe("No output yet, read at 09:00:00");
  expect(logCaption(1, 0, "09:00:00")).toBe("1 line, read at 09:00:00");
  expect(logCaption(12, 0, "09:00:00")).toBe("12 lines, read at 09:00:00");
  expect(logCaption(40, 860, "09:00:00")).toBe(
    "The newest 40 lines, read at 09:00:00. The terminal has 860 more above.",
  );
});
