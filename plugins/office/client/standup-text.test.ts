import { expect, test } from "vitest";
import type {
  OfficeAgent,
  OfficeSnapshot,
  OfficeWorkspace,
  Post,
  WorkspacePullRequest,
} from "../shared/contracts.js";
import { buildOfficeModel } from "./model.js";
import {
  askHint,
  askLabel,
  pullRequestLine,
  pullRequestLinkText,
  standupNote,
  standupSummary,
  standupTeams,
  standupText,
  teamHeading,
  teamName,
} from "./standup-text.js";

const NOW = Date.parse("2026-11-16T09:00:00.000Z");

function agent(id: string, patch: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id,
    title: id,
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: `2026-11-16T00:00:0${id.length}Z`,
    ...patch,
  };
}

function request(patch: Partial<WorkspacePullRequest> = {}): WorkspacePullRequest {
  return {
    number: 12,
    url: "https://forge.example/pull/12",
    title: "Fix checkout",
    base: "main",
    state: "open",
    checks: "none",
    review: null,
    conflicts: false,
    ...patch,
  };
}

function post(seq: number, patch: Partial<Post>): Post {
  return {
    id: `p${seq}`,
    seq,
    board: "w1",
    kind: "note",
    text: "hello",
    author: "user",
    createdAt: "2026-11-16T08:00:00.000Z",
    updatedAt: "2026-11-16T08:00:00.000Z",
    ...patch,
  };
}

function office(
  agents: OfficeAgent[],
  workspaces: OfficeWorkspace[],
  boards: Record<string, Post[]> = {},
  activity: Record<string, string> = {},
): OfficeSnapshot {
  return { agents, workspaces, activity, doing: {}, boards, wake: { paused: false, queued: {} } };
}

const SHOP: OfficeWorkspace = { id: "w1", name: "shop-api", projectName: "shop" };

test("a pull request reads as its number, its title and how it stands", () => {
  expect(pullRequestLine(request())).toBe("#12 Fix checkout: open");
  expect(
    pullRequestLine(
      request({ state: "draft", checks: "failure", review: "changes_requested", conflicts: true }),
    ),
  ).toBe("#12 Fix checkout: draft, checks fail, changes requested, has conflicts");
  expect(pullRequestLine(request({ checks: "pending", review: "pending" }))).toBe(
    "#12 Fix checkout: open, checks running, review pending",
  );
  expect(pullRequestLine(request({ checks: "success", review: "approved" }))).toBe(
    "#12 Fix checkout: open, checks pass, approved",
  );
  // Once it is merged or closed, its checks are history.
  expect(pullRequestLine(request({ state: "merged", checks: "failure" }))).toBe(
    "#12 Fix checkout: merged",
  );
  expect(pullRequestLine(request({ number: null }))).toBe("Fix checkout: open");
});

test("a pull request's link reads as its number, or says what it is without one", () => {
  expect(pullRequestLinkText(request())).toBe("#12");
  expect(pullRequestLinkText(request({ number: null }))).toBe("Pull request");
});

test("a team is named with its project, and the lobby without one", () => {
  expect(teamName({ name: "shop-api", project: "shop" })).toBe("shop-api (shop)");
  expect(teamName({ name: "Lobby", project: null })).toBe("Lobby");
});

test("the stand-up has a team for every room with an agent, with what each agent is at", () => {
  const model = buildOfficeModel(
    office(
      [
        agent("Builder", { status: "running" }),
        agent("Tester"),
        agent("Asker", {
          status: "running",
          permissions: [{ id: "p", kind: "tool", title: "Bash" }],
        }),
        agent("Broken", { status: "error" }),
        agent("Loner", { workspaceId: null, status: "initializing" }),
      ],
      [
        {
          ...SHOP,
          branch: "feat/checkout",
          ticket: { key: "SHOP-41", url: "https://jira.example/browse/SHOP-41" },
          pullRequest: request({ checks: "failure" }),
        },
        { id: "w2", name: "empty", projectName: "site" },
      ],
      {},
      { Builder: "Running Bash" },
    ),
  );

  const teams = standupTeams(model, NOW);

  expect(teams.map((team) => team.name)).toEqual(["Lobby", "shop-api"]);
  expect(teams[0]).toMatchObject({
    project: null,
    branch: null,
    ticket: null,
    pullRequest: null,
    review: null,
    blockers: [],
    people: [{ agentId: "Loner", line: "Starting", free: false }],
  });
  const shop = teams[1];
  expect(shop && teamHeading(shop)).toBe("shop-api (shop) · SHOP-41 · feat/checkout");
  expect(shop?.review).toBe("#12 Fix checkout: open, checks fail");
  expect(shop?.people.map((person) => [person.title, person.line, person.free])).toEqual([
    ["Asker", "Waiting for your answer", false],
    ["Broken", "Stopped on an error", false],
    ["Tester", "Idle", true],
    ["Builder", "Running Bash", false],
  ]);
  expect(shop?.blockers).toEqual([
    "Asker waits for your answer",
    "Broken stopped on an error",
    "Checks fail on #12",
  ]);
});

test("review and conflicts block an open request, and nothing blocks a merged one", () => {
  const blockers = (pullRequest: WorkspacePullRequest) =>
    standupTeams(buildOfficeModel(office([agent("a")], [{ ...SHOP, pullRequest }])), NOW)[0]
      ?.blockers;
  expect(blockers(request({ review: "changes_requested", conflicts: true }))).toEqual([
    "Changes requested on #12",
    "#12 has conflicts",
  ]);
  expect(blockers(request({ number: null, conflicts: true }))).toEqual([
    "The pull request has conflicts",
  ]);
  expect(blockers(request({ state: "merged", checks: "failure", conflicts: true }))).toEqual([]);
});

test("an agent says its newest note of the last day, and the board's tasks are counted", () => {
  const model = buildOfficeModel(
    office([agent("a"), agent("bb")], [SHOP], {
      w1: [
        post(1, { author: "a", text: "Old\nnote" }),
        post(2, { author: "a", text: "  Did the  parser.\nNext: tests. " }),
        post(3, { author: "user", text: "Stand-up?" }),
        post(4, { author: "bb", createdAt: "2026-11-14T08:00:00.000Z" }),
        post(5, { kind: "task", state: "open", author: "user" }),
        post(6, { kind: "task", state: "open", author: "user" }),
        post(7, { kind: "task", state: "claimed", claimedBy: "a", author: "user" }),
        post(8, { kind: "task", state: "done", author: "user" }),
      ],
    }),
  );
  const [team] = standupTeams(model, NOW);
  expect(team?.people.map((person) => person.said)).toEqual(["Did the parser. Next: tests.", null]);
  expect(team?.tasks).toBe("2 open tasks, 1 claimed");
});

test("the strip counts the blockers, else the teams, and says nothing of an empty office", () => {
  const teams = (agents: OfficeAgent[]) =>
    standupTeams(buildOfficeModel(office(agents, [SHOP])), NOW);
  expect(standupNote(teams([]))).toBeNull();
  expect(standupNote(teams([agent("a")]))).toEqual({ text: "1 team", tone: "muted" });
  expect(standupNote(teams([agent("a"), agent("bb", { workspaceId: null })]))).toEqual({
    text: "2 teams",
    tone: "muted",
  });
  expect(standupNote(teams([agent("a", { status: "error" })]))).toEqual({
    text: "1 blocker",
    tone: "warning",
  });
});

test("the stand-up as text names each team, its request, its blockers and its people", () => {
  const model = buildOfficeModel(
    office(
      [agent("Builder", { status: "error" }), agent("Tester")],
      [
        {
          ...SHOP,
          branch: "main",
          ticket: { key: "SHOP-41", url: "https://tracker.test/SHOP-41" },
          pullRequest: request({ checks: "success" }),
        },
      ],
      {
        w1: [
          post(1, { author: "Tester", text: "All green." }),
          post(2, { kind: "task", state: "open" }),
        ],
      },
    ),
  );
  expect(standupText(standupTeams(model, NOW))).toBe(
    [
      "Stand-up, 1 team",
      "",
      "shop-api (shop) · SHOP-41 · main",
      "SHOP-41: https://tracker.test/SHOP-41",
      "Pull request #12 Fix checkout: open, checks pass",
      "#12: https://forge.example/pull/12",
      "Board: 1 open task",
      "Blocked: Builder stopped on an error",
      "- Tester: Idle. Said: All green.",
      "- Builder: Stopped on an error",
    ].join("\n"),
  );
});

test("the stand-up's first line counts teams, agents and blockers", () => {
  const teams = (agents: OfficeAgent[]) =>
    standupTeams(buildOfficeModel(office(agents, [SHOP])), NOW);
  expect(standupSummary(teams([]))).toBe("No agents on this host yet.");
  expect(standupSummary(teams([agent("a")]))).toBe("1 team, 1 agent, nothing blocked");
  expect(
    standupSummary(teams([agent("a", { status: "error" }), agent("bb", { workspaceId: null })])),
  ).toBe("2 teams, 2 agents, 1 blocker");
});

test("the button says how many idle agents it would reach", () => {
  expect(askLabel(0)).toBe("Ask for an update");
  expect(askLabel(1)).toBe("Ask 1 agent for an update");
  expect(askLabel(3)).toBe("Ask 3 agents for an update");
});

test("the line under the buttons says why nobody is asked, or what asking does", () => {
  const does =
    "An idle agent gets a post on its team's board and answers there with a note. An agent at work is not asked.";
  expect(askHint({ free: 2, asked: 0, wakesPaused: false })).toBe(does);
  expect(askHint({ free: 0, asked: 0, wakesPaused: false })).toBe(
    "Nobody is idle. An agent at work is not asked.",
  );
  expect(askHint({ free: 0, asked: 2, wakesPaused: false })).toBe(
    "Asked 2 agents. Each answers on its team's board, and its note shows here.",
  );
  expect(askHint({ free: 1, asked: 1, wakesPaused: false })).toBe(
    `Asked 1 agent. Each answers on its team's board, and its note shows here. ${does}`,
  );
  expect(askHint({ free: 2, asked: 1, wakesPaused: true })).toBe(
    "Wake agents is off, so a post would wait. Turn it on to ask for updates.",
  );
});
