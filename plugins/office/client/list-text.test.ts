import { expect, test } from "vitest";
import type { OfficeAgent, OfficePermission } from "../shared/contracts.js";
import type { OfficeRoom, OfficeRow } from "../shared/model.js";
import {
  LIST_TABS,
  NO_MATCH,
  SEARCH_LABEL,
  contextLevel,
  costText,
  filterRooms,
  matchesQuery,
  rowLabel,
  secondLine,
  tabCounts,
  tabOf,
  timeText,
} from "./list-text.js";

const AT = Date.parse("2026-11-17T09:00:00Z");

function permission(overrides: Partial<OfficePermission> = {}): OfficePermission {
  return { id: "p1", kind: "tool", title: "Run the tests", ...overrides };
}

function agent(overrides: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id: "a1",
    title: "Ali",
    provider: "claude",
    model: null,
    status: "idle",
    workspaceId: "w1",
    parentAgentId: null,
    permissions: [],
    createdAt: "2026-11-17T08:00:00.000Z",
    ...overrides,
  };
}

type RowExtras = Partial<Omit<OfficeRow, "agent">>;

function row(overrides: Partial<OfficeAgent> = {}, extra: RowExtras = {}): OfficeRow {
  return { agent: agent(overrides), depth: 0, activity: null, step: null, waitingOn: 0, ...extra };
}

interface RoomOverrides {
  id?: string;
  name?: string;
  projectName?: string;
  branch?: string;
  rows?: OfficeRow[];
}

function room(overrides: RoomOverrides = {}): OfficeRoom {
  const id = overrides.id ?? "w1";
  const name = overrides.name ?? "shop-api";
  const projectName = overrides.projectName ?? "Shop";
  const branch = overrides.branch;
  return {
    id,
    name,
    subtitle: projectName,
    lobby: false,
    workspace: { id, name, projectName, ...(branch === undefined ? {} : { branch }) },
    rows: overrides.rows ?? [],
    posts: [],
    todos: [],
  };
}

function lobby(rows: OfficeRow[] = []): OfficeRoom {
  return {
    id: "lobby",
    name: "Lobby",
    subtitle: null,
    lobby: true,
    workspace: null,
    rows,
    posts: [],
    todos: [],
  };
}

test("the tabs, All first, and the words the view prints", () => {
  expect(LIST_TABS).toEqual([
    { tab: "all", label: "All" },
    { tab: "attention", label: "Needs you" },
    { tab: "working", label: "Working" },
    { tab: "resting", label: "Resting" },
  ]);
  expect(SEARCH_LABEL).toBe("Search agents");
  expect(NO_MATCH).toBe("No agent matches.");
});

test("an agent's tab", () => {
  expect(tabOf(row({ status: "running" }))).toBe("working");
  expect(tabOf(row({ status: "initializing" }))).toBe("working");
  expect(tabOf(row({ status: "idle" }, { waitingOn: 2 }))).toBe("working");
  expect(tabOf(row({ status: "idle" }))).toBe("resting");
  expect(tabOf(row({ status: "error" }))).toBe("attention");
  expect(tabOf(row({ status: "running", permissions: [permission()] }))).toBe("attention");
  // A question open on an idle agent, or an error that also asks something, is still "needs you".
  expect(tabOf(row({ status: "idle", permissions: [permission()] }))).toBe("attention");
  expect(tabOf(row({ status: "error", permissions: [permission()] }))).toBe("attention");
});

test("the counts", () => {
  const run = row({ status: "running" });
  const idle = row({ status: "idle" });
  const err = row({ status: "error" });
  expect(tabCounts([run, run, idle, err])).toEqual({
    all: 4,
    attention: 1,
    working: 2,
    resting: 1,
  });
  // A parent that waits on its sub-agents is at work, though its own turn has ended.
  expect(tabCounts([row({ status: "idle" }, { waitingOn: 2 })])).toEqual({
    all: 1,
    attention: 0,
    working: 1,
    resting: 0,
  });
  expect(tabCounts([])).toEqual({ all: 0, attention: 0, working: 0, resting: 0 });
});

test("every word must match a field, without case or accents", () => {
  const r = room({ name: "shop-api", projectName: "Shop", branch: "feat/café" });
  expect(matchesQuery(row({ title: "Ali" }), r, "ali cafe")).toBe(true);
  expect(matchesQuery(row({ title: "Ali" }), r, "ali nope")).toBe(false);
  expect(matchesQuery(row({ title: "Ali", provider: "claude", model: "opus" }), r, "OPUS")).toBe(
    true,
  );
  expect(matchesQuery(row({ title: "Ali" }), lobby(), "ali")).toBe(true);
  expect(matchesQuery(row({ title: "Ali" }), lobby(), "nope")).toBe(false);
  // The task, when a named sub-agent's title says more than its name.
  expect(matchesQuery(row({ name: "Ali", title: "Fix the checkout" }), r, "CHECKOUT")).toBe(true);
  // The room's own name, then its project.
  const harbour = room({ id: "w2", name: "harbour", projectName: "Lighthouse" });
  expect(matchesQuery(row({ title: "Ali" }), harbour, "harbour")).toBe(true);
  expect(matchesQuery(row({ title: "Ali" }), harbour, "lighthouse")).toBe(true);
  // The branch, without its accent and in any case.
  expect(matchesQuery(row({ title: "Ali" }), r, "FEAT")).toBe(true);
  // Every word: two that match, and one that does not.
  expect(matchesQuery(row({ title: "Ali" }), harbour, "ali lighthouse")).toBe(true);
  expect(matchesQuery(row({ title: "Ali" }), harbour, "ali harbour nope")).toBe(false);
  // A query of spaces matches everyone.
  expect(matchesQuery(row({ title: "Ali" }), lobby(), "   ")).toBe(true);
});

test("a filter leaves out rooms with no match; All with no search keeps empty rooms", () => {
  const ali = row({ id: "a1", title: "Ali", status: "running" });
  const bob = row({ id: "b1", title: "Bob", status: "error" });
  const shop = room({ id: "w1", name: "shop-api", rows: [ali] });
  const quiet = room({ id: "w2", name: "quiet" });
  const waiting = lobby([bob]);

  const places = (tab: "all" | "attention" | "working" | "resting", query: string) =>
    filterRooms([shop, quiet, waiting], tab, query).map((one) => one.id);

  expect(places("all", "")).toEqual(["w1", "w2", "lobby"]);
  expect(places("attention", "")).toEqual(["lobby"]);
  expect(places("working", "")).toEqual(["w1"]);
  expect(places("resting", "")).toEqual([]);
  // A search leaves out the empty room, which has nothing to match.
  expect(places("all", "ali")).toEqual(["w1"]);
  expect(places("all", "bob")).toEqual(["lobby"]);
  expect(places("all", "nope")).toEqual([]);

  // What comes back is the room with only its matching rows; the rest is kept.
  const [only] = filterRooms([shop, quiet, waiting], "attention", "");
  expect(only?.name).toBe("Lobby");
  expect(only?.rows.map((one) => one.agent.id)).toEqual(["b1"]);
  expect(only?.workspace).toBeNull();
  const [shopOnly] = filterRooms([shop], "working", "");
  expect(shopOnly?.workspace).toEqual(shop.workspace);
  expect(shopOnly?.posts).toEqual(shop.posts);
  // And the office's own rooms are left as they were.
  expect(shop.rows).toEqual([ali]);
});

test("a sub-agent whose parent is not kept moves to the top level", () => {
  const parent = row({ id: "a1", title: "Ali", status: "idle" });
  const child = row(
    { id: "a2", title: "Kid", status: "running", parentAgentId: "a1" },
    { depth: 1 },
  );
  const shop = room({ rows: [parent, child] });
  const kept = (tab: "all" | "attention" | "working" | "resting", query: string) =>
    filterRooms([shop], tab, query)[0]?.rows.map((one) => [one.agent.id, one.depth]);

  // No filter: the child stays under its parent.
  expect(kept("all", "")).toEqual([
    ["a1", 0],
    ["a2", 1],
  ]);
  // The tab keeps the child only, so it is a row of its own.
  expect(kept("working", "")).toEqual([["a2", 0]]);
  // A search keeps the child only, then the parent only.
  expect(kept("all", "kid")).toEqual([["a2", 0]]);
  expect(kept("all", "ali")).toEqual([["a1", 0]]);
  // Each row is matched on its own fields. When the parent matches too, the child stays under it.
  const both = room({
    rows: [parent, row({ id: "a2", title: "Ali two", parentAgentId: "a1" }, { depth: 1 })],
  });
  expect(
    filterRooms([both], "all", "ali")[0]?.rows.map((one) => [one.agent.id, one.depth]),
  ).toEqual([
    ["a1", 0],
    ["a2", 1],
  ]);
});

test("the second line adds the branch when the room has one", () => {
  expect(secondLine(agent({ provider: "claude", model: "opus" }), room({ branch: "main" }))).toBe(
    "claude · opus · main",
  );
  expect(secondLine(agent({ provider: "claude", model: null }), lobby())).toBe("claude");
  expect(secondLine(agent({ provider: "claude", model: "opus" }), room())).toBe("claude · opus");
  // The lobby has no workspace, so no branch.
  const inLobby = secondLine(agent({ provider: "codex", model: null }), lobby());
  expect(inLobby).toBe("codex");
});

test("the context's level", () => {
  expect([59, 60, 84, 85].map(contextLevel)).toEqual(["low", "mid", "mid", "high"]);
  expect([0, 84, 100].map(contextLevel)).toEqual(["low", "mid", "high"]);
});

test("a working agent's clock", () => {
  const r = row({ status: "running", promptedAt: "2026-11-17T09:00:00Z" });
  expect(timeText(r, AT)).toBe("0:00");
  expect(timeText(r, AT + 59_000)).toBe("0:59");
  expect(timeText(r, AT + 3_599_000)).toBe("59:59");
  expect(timeText(r, AT + 3_600_000)).toBe("1:00:00");
  expect(timeText(r, AT + 4 * 3_600_000 + 61_000)).toBe("4:01:01");
  // A host clock ahead of this device's is not a negative clock.
  expect(timeText(r, AT - 5_000)).toBe("0:00");
});

test("a resting agent's ago", () => {
  const r = row({ status: "idle", idleSince: "2026-11-17T09:00:00Z" });
  // 30 s, 5 min, 2 h, 3 d
  expect([30e3, 3e5, 72e5, 2592e5].map((d) => timeText(r, AT + d))).toEqual([
    "now",
    "5m ago",
    "2h ago",
    "3d ago",
  ]);
  // A host clock ahead of this device's is still "now".
  expect(timeText(r, AT - 5_000)).toBe("now");
});

test("no time while it needs you, starts or has stopped", () => {
  const at = "2026-11-17T09:00:00Z";
  expect(
    timeText(row({ status: "running", promptedAt: at, permissions: [permission()] }), AT),
  ).toBeNull();
  expect(timeText(row({ status: "initializing", promptedAt: at }), AT)).toBeNull();
  expect(timeText(row({ status: "error", promptedAt: at }), AT)).toBeNull();
  expect(
    timeText(row({ status: "idle", idleSince: at, permissions: [permission()] }), AT),
  ).toBeNull();
  // A time the host did not send, or sent as no date, leaves the part out.
  expect(timeText(row({ status: "running" }), AT)).toBeNull();
  expect(timeText(row({ status: "idle" }), AT)).toBeNull();
  expect(timeText(row({ status: "running", promptedAt: "not a date" }), AT)).toBeNull();
  expect(timeText(row({ status: "idle", idleSince: "not a date" }), AT)).toBeNull();
});

test("the cost", () => {
  expect([undefined, 0, 0.004, 1.5].map(costText)).toEqual([null, null, "$0.00", "$1.50"]);
  expect([-1, Number.NaN, Number.POSITIVE_INFINITY].map(costText)).toEqual([null, null, null]);
});

test("the row's label", () => {
  const r = row({
    status: "running",
    context: { usedTokens: 62_000, maxTokens: 100_000 },
    promptedAt: new Date(AT - 252_000).toISOString(),
    costUsd: 0.42,
  });
  expect(rowLabel(r, "Running", AT)).toBe("Ali: Running, context 62%, 4:12, $0.42");
  // Each part is left out when it has nothing.
  expect(rowLabel(row({ status: "idle" }), "Idle", AT)).toBe("Ali: Idle");
  expect(rowLabel(row({ context: { usedTokens: 1, maxTokens: 2 } }), "Idle", AT)).toBe(
    "Ali: Idle, context 50%",
  );
});
