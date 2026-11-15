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
  reviewAsk,
  reviewAskLabel,
  reviewHint,
  reviewNote,
  reviewRows,
  reviewSummary,
  reviewTitle,
} from "./review-text.js";

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
    createdAt: "2026-11-16T00:00:01Z",
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

function workspace(id: string, patch: Partial<OfficeWorkspace> = {}): OfficeWorkspace {
  return { id, name: id, projectName: "shop", ...patch };
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
): OfficeSnapshot {
  return { agents, workspaces, activity: {}, boards, wake: { paused: false, queued: {} } };
}

function rowsOf(
  agents: OfficeAgent[],
  workspaces: OfficeWorkspace[],
  boards: Record<string, Post[]> = {},
) {
  return reviewRows(buildOfficeModel(office(agents, workspaces, boards)));
}

test("a pull request is named by its number and title, or by its title alone", () => {
  expect(reviewTitle(request())).toBe("#12 Fix checkout");
  expect(reviewTitle(request({ number: null }))).toBe("Fix checkout");
});

test("the queue has every open or draft pull request with what stands in its way", () => {
  const rows = rowsOf(
    [agent("a")],
    [
      workspace("w1", {
        name: "shop-api",
        branch: "feat/checkout",
        changes: { additions: 120, deletions: 30 },
        pullRequest: request({ checks: "failure", conflicts: true }),
      }),
      workspace("w2", { pullRequest: request({ state: "merged" }) }),
      workspace("w3", { pullRequest: request({ state: "closed" }) }),
      workspace("w4"),
    ],
  );
  expect(rows).toEqual([
    {
      roomId: "w1",
      title: "#12 Fix checkout",
      meta: "shop-api (shop) · feat/checkout into main · +120\u00a0−30",
      url: "https://forge.example/pull/12",
      linkText: "#12",
      stand: "review",
      status: "Waiting for a review, checks fail, has conflicts",
      troubled: true,
      asked: null,
      reviewer: { agentId: "a", title: "a" },
    },
  ]);
});

test("a row says no more of its branch than is known", () => {
  const meta = (patch: Partial<OfficeWorkspace>, base: string | null = null) =>
    rowsOf([], [workspace("w1", { pullRequest: request({ base }), ...patch })])[0]?.meta;
  expect(meta({})).toBe("w1 (shop)");
  expect(meta({ branch: "fix" })).toBe("w1 (shop) · fix");
  expect(meta({ branch: "fix" }, "main")).toBe("w1 (shop) · fix into main");
});

test("the queue starts with what waits for a review, then sent back, approved and drafts", () => {
  const rows = rowsOf(
    [],
    [
      workspace("draft", { pullRequest: request({ state: "draft", review: "approved" }) }),
      workspace("approved", { pullRequest: request({ review: "approved", checks: "success" }) }),
      workspace("changes", { pullRequest: request({ review: "changes_requested" }) }),
      workspace("pending", { pullRequest: request({ review: "pending", checks: "pending" }) }),
      workspace("fresh", { pullRequest: request() }),
    ],
  );
  expect(rows.map((row) => [row.roomId, row.status, row.troubled])).toEqual([
    ["pending", "Waiting for a review, checks running", false],
    ["fresh", "Waiting for a review", false],
    ["changes", "Changes requested", true],
    ["approved", "Approved, checks pass", false],
    ["draft", "Draft", false],
  ]);
});

test("a request goes to the team's newest idle agent", () => {
  const reviewer = (agents: OfficeAgent[]) =>
    rowsOf(agents, [workspace("w1", { pullRequest: request() })])[0]?.reviewer;
  expect(reviewer([])).toBeNull();
  expect(reviewer([agent("busy", { status: "running" })])).toBeNull();
  expect(reviewer([agent("broken", { status: "error" })])).toBeNull();
  expect(
    reviewer([agent("asks", { permissions: [{ id: "p", kind: "tool", title: "Bash" }] })]),
  ).toBeNull();
  expect(reviewer([agent("elsewhere", { workspaceId: "w2" })])).toBeNull();
  expect(
    reviewer([
      agent("author", { createdAt: "2026-11-16T00:00:01Z" }),
      agent("second", { createdAt: "2026-11-16T00:00:09Z" }),
      agent("third", { createdAt: "2026-11-16T00:00:05Z" }),
    ]),
  ).toEqual({ agentId: "second", title: "second" });
});

test("what an agent is asked names the pull request, its address and its base", () => {
  expect(reviewAsk(request())).toBe(
    [
      "Review request: #12 Fix checkout",
      "https://forge.example/pull/12",
      "Read the diff of this branch against main, then post one note on this board with what you found, the worst first, each with its file and line. Change no files.",
    ].join("\n"),
  );
  expect(reviewAsk(request({ base: null })).split("\n")[2]).toBe(
    "Read the diff of this branch, then post one note on this board with what you found, the worst first, each with its file and line. Change no files.",
  );
});

test("the newest request and the asked agent's first note after it are the review", () => {
  const ask = reviewAsk(request());
  const board = (posts: Post[]) =>
    rowsOf(
      [agent("a"), agent("b", { createdAt: "2026-11-16T00:00:02Z" })],
      [workspace("w1", { pullRequest: request() })],
      { w1: posts },
    )[0];

  // Asked and not answered: the request is with its agent, and nobody else is asked.
  const pending = board([
    post(1, { author: "b", text: "An older note." }),
    post(2, { text: ask, to: "b" }),
  ]);
  expect(pending?.asked).toEqual({ agentId: "b", title: "b", text: null, cut: false });
  expect(pending?.reviewer).toBeNull();

  // Answered: the first note after the request, not a later one, and not another agent's.
  const answered = board([
    post(1, { text: ask, to: "b" }),
    post(2, { author: "a", text: "Not the reviewer." }),
    post(3, { author: "b", text: "  One defect: cart.ts:40 rounds twice.  " }),
    post(4, { author: "b", text: "Stand-up: reviewed #12." }),
  ]);
  expect(answered?.asked).toEqual({
    agentId: "b",
    title: "b",
    text: "One defect: cart.ts:40 rounds twice.",
    cut: false,
  });
  expect(answered?.reviewer).toEqual({ agentId: "b", title: "b" });

  // A second request starts over.
  const again = board([
    post(1, { text: ask, to: "b" }),
    post(2, { author: "b", text: "First review." }),
    post(3, { text: ask, to: "a" }),
  ]);
  expect(again?.asked).toEqual({ agentId: "a", title: "a", text: null, cut: false });
});

test("a request for another pull request, a task and an agent's own post are not requests", () => {
  const ask = reviewAsk(request());
  const asked = (posts: Post[]) =>
    rowsOf([agent("a")], [workspace("w1", { pullRequest: request() })], { w1: posts })[0]?.asked;
  expect(
    asked([post(1, { text: reviewAsk(request({ url: "https://other" })), to: "a" })]),
  ).toBeNull();
  expect(asked([post(1, { text: ask })])).toBeNull();
  expect(asked([post(1, { text: ask, to: "a", author: "a" })])).toBeNull();
  expect(asked([post(1, { text: ask, to: "a", kind: "task", state: "open" })])).toBeNull();
  expect(asked([post(1, { text: "Review request: something else", to: "a" })])).toBeNull();
});

test("a request whose agent left can go to another, and a long review is cut", () => {
  const ask = reviewAsk(request());
  const row = rowsOf([agent("a")], [workspace("w1", { pullRequest: request() })], {
    w1: [post(1, { text: ask, to: "gone" })],
  })[0];
  expect(row?.asked).toEqual({
    agentId: "gone",
    title: "An agent that left",
    text: null,
    cut: false,
  });
  expect(row?.reviewer).toEqual({ agentId: "a", title: "a" });

  const long = rowsOf([agent("a")], [workspace("w1", { pullRequest: request() })], {
    w1: [post(1, { text: ask, to: "a" }), post(2, { author: "a", text: "x".repeat(700) })],
  })[0]?.asked;
  expect(long?.cut).toBe(true);
  expect(long?.text).toBe(`${"x".repeat(599)}…`);
});

test("the strip counts what waits for a review, else the open pull requests", () => {
  const note = (requests: WorkspacePullRequest[]) =>
    reviewNote(
      rowsOf(
        [],
        requests.map((pullRequest, index) => workspace(`w${index}`, { pullRequest })),
      ),
    );
  expect(note([])).toBeNull();
  expect(note([request({ state: "merged" })])).toBeNull();
  expect(
    note([request(), request({ review: "pending" }), request({ review: "approved" })]),
  ).toEqual({ text: "2 to review", tone: "warning" });
  expect(note([request({ review: "approved" })])).toEqual({
    text: "1 pull request",
    tone: "muted",
  });
  expect(note([request({ state: "draft" }), request({ review: "changes_requested" })])).toEqual({
    text: "2 pull requests",
    tone: "muted",
  });
});

test("the card's first line counts the open pull requests and the ones to review", () => {
  const summary = (requests: WorkspacePullRequest[]) =>
    reviewSummary(
      rowsOf(
        [],
        requests.map((pullRequest, index) => workspace(`w${index}`, { pullRequest })),
      ),
    );
  expect(summary([])).toBe("No open pull requests.");
  expect(summary([request()])).toBe("1 open pull request, 1 to review");
  expect(summary([request(), request({ state: "draft" })])).toBe(
    "2 open pull requests, 1 to review",
  );
  expect(summary([request({ review: "approved" })])).toBe(
    "1 open pull request, none waiting for a review",
  );
});

test("the button asks again once a review came in, and the line under it says who is asked", () => {
  const reviewer = { agentId: "a", title: "Tester" };
  const pending = { agentId: "a", title: "Tester", text: null, cut: false };
  const done = { ...pending, text: "Fine." };
  expect(reviewAskLabel({ asked: null })).toBe("Ask for a review");
  expect(reviewAskLabel({ asked: pending })).toBe("Ask for a review");
  expect(reviewAskLabel({ asked: done })).toBe("Ask for another review");

  expect(reviewHint({ asked: null, reviewer }, false)).toBe(
    "Tester is idle and gets the request on the team's board.",
  );
  expect(reviewHint({ asked: null, reviewer }, true)).toBe(
    "Wake agents is off, so a request would wait. Turn it on to ask.",
  );
  expect(reviewHint({ asked: null, reviewer: null }, false)).toBe(
    "No agent of this team is idle, so nobody can be asked.",
  );
  expect(reviewHint({ asked: done, reviewer: null }, false)).toBe(
    "No agent of this team is idle, so nobody can be asked.",
  );
  // The line about the request itself says that it waits.
  expect(reviewHint({ asked: pending, reviewer: null }, false)).toBeNull();
});
