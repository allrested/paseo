import { expect, test } from "vitest";
import { createAgentStats, type EndedTurn, type KnownWorkspace } from "./stats.js";
import type { StatsStore, StoredStats } from "./stats-store.js";

const at = (iso: string) => Date.parse(iso);

function setup(stored: StoredStats | null = null, start = "2026-11-15T10:00:00Z") {
  const saved: StoredStats[] = [];
  const logs: string[] = [];
  let failing = false;
  /** Saves wait here when a test holds them. */
  let gate: Promise<void> = Promise.resolve();
  const store: StatsStore = {
    load: async () => stored,
    save: async (stats) => {
      await gate;
      if (failing) throw new Error("disk full");
      saved.push(stats);
    },
  };
  const clock = { now: at(start) };
  const stats = createAgentStats({ store, now: () => clock.now, log: (line) => logs.push(line) });
  return {
    stats,
    saved,
    logs,
    fail: () => (failing = true),
    hold() {
      let release = () => {};
      gate = new Promise((resolve) => (release = resolve));
      return release;
    },
    /** Moves the clock. */
    to: (iso: string) => (clock.now = at(iso)),
  };
}

const turn = (extra: Partial<EndedTurn> = {}): EndedTurn => ({
  agentId: "a1",
  workspaceId: "w1",
  folder: "/work/shop",
  failed: false,
  ...extra,
});

const NO_WORKSPACES = async (): Promise<KnownWorkspace[]> => [];
const EVER = "2000-01-01T00";

test("a turn is counted in the hour it ended, with the time since it began", async () => {
  const { stats, to } = setup();
  stats.started("a1");
  to("2026-11-15T10:12:30Z");

  await stats.ended(turn());

  expect((await stats.read(EVER, NO_WORKSPACES)).hours).toEqual([
    { hour: "2026-11-15T10", workspaceId: "w1", turns: 1, failed: 0, workMs: 750_000 },
  ]);
});

test("a turn over several hours gives each its time, and counts where it ended", async () => {
  const { stats, to } = setup(null, "2026-11-15T22:45:00Z");
  stats.started("a1");
  to("2026-11-16T00:05:00Z");

  await stats.ended(turn({ failed: true }));

  const { hours } = await stats.read(EVER, NO_WORKSPACES);
  expect(hours.toSorted((a, b) => a.hour.localeCompare(b.hour))).toEqual([
    { hour: "2026-11-15T22", workspaceId: "w1", turns: 0, failed: 0, workMs: 900_000 },
    { hour: "2026-11-15T23", workspaceId: "w1", turns: 0, failed: 0, workMs: 3_600_000 },
    { hour: "2026-11-16T00", workspaceId: "w1", turns: 1, failed: 1, workMs: 300_000 },
  ]);
});

test("turns add up per workspace, and two agents at once count twice", async () => {
  const { stats, to } = setup();
  stats.started("a1");
  stats.started("a2");
  stats.started("b1");
  to("2026-11-15T10:10:00Z");

  await stats.ended(turn());
  await stats.ended(turn({ agentId: "a2" }));
  await stats.ended(turn({ agentId: "b1", workspaceId: null, folder: "/tmp/scratch" }));

  const { hours } = await stats.read(EVER, NO_WORKSPACES);
  expect(hours).toEqual([
    { hour: "2026-11-15T10", workspaceId: "w1", turns: 2, failed: 0, workMs: 1_200_000 },
    { hour: "2026-11-15T10", workspaceId: null, turns: 1, failed: 0, workMs: 600_000 },
  ]);
});

test("a turn that began before the daemon listened counts without a length", async () => {
  const { stats } = setup();

  await stats.ended(turn());

  expect((await stats.read(EVER, NO_WORKSPACES)).hours).toEqual([
    { hour: "2026-11-15T10", workspaceId: "w1", turns: 1, failed: 0, workMs: 0 },
  ]);
});

test("an agent that goes in a turn leaves no time behind, and its next turn starts fresh", async () => {
  const { stats, to } = setup();
  stats.started("a1");
  to("2026-11-15T10:30:00Z");
  stats.gone("a1");
  stats.started("a1");
  to("2026-11-15T10:31:00Z");

  await stats.ended(turn());

  expect((await stats.read(EVER, NO_WORKSPACES)).hours[0].workMs).toBe(60_000);
});

test("what is read starts at the asked hour", async () => {
  const stored: StoredStats = {
    countingSince: "2026-11-01T08:00:00.000Z",
    hours: [
      { hour: "2026-11-14T23", workspaceId: "w1", turns: 4, failed: 0, workMs: 1000 },
      { hour: "2026-11-15T00", workspaceId: "w1", turns: 2, failed: 1, workMs: 2000 },
    ],
    folders: { w1: "/work/shop" },
  };
  const { stats } = setup(stored);

  const read = await stats.read("2026-11-15T00", NO_WORKSPACES);

  expect(read.hours).toEqual([stored.hours[1]]);
  expect(read.countingSince).toBe("2026-11-01T08:00:00.000Z");
});

test("a host that never counted counts from now", async () => {
  const { stats } = setup();

  expect((await stats.read(EVER, NO_WORKSPACES)).countingSince).toBe("2026-11-15T10:00:00.000Z");
});

test("a workspace has its name now; one that is gone has its folder's, and cannot be opened", async () => {
  const { stats } = setup();
  await stats.ended(turn());
  await stats.ended(turn({ agentId: "a2", workspaceId: "w2", folder: "/work/old-api/" }));
  await stats.ended(turn({ agentId: "a3", workspaceId: null, folder: "/tmp/x" }));

  const { workspaces } = await stats.read(EVER, async () => [
    { id: "w1", name: "Checkout" },
    { id: "other", name: "Not asked about" },
  ]);

  expect(workspaces).toEqual([
    { id: "w1", name: "Checkout", open: true },
    { id: "w2", name: "old-api", open: false },
    { id: "", name: "No workspace", open: false },
  ]);
});

test("a host that cannot list its workspaces still answers with its counts", async () => {
  const { stats, logs } = setup();
  await stats.ended(turn());

  const read = await stats.read(EVER, () => Promise.reject(new Error("no list")));

  expect(read.hours).toHaveLength(1);
  expect(read.workspaces).toEqual([{ id: "w1", name: "shop", open: false }]);
  expect(logs).toEqual(["[agent-stats] the workspaces could not be listed: no list"]);
});

test("the workspaces are not asked for when no hour names one", async () => {
  const { stats } = setup();
  let asked = 0;

  await stats.read(EVER, async () => {
    asked += 1;
    return [];
  });

  expect(asked).toBe(0);
});

test("each turn is saved, with the folder of its workspace", async () => {
  const { stats, saved } = setup();
  stats.started("a1");

  await stats.ended(turn());

  expect(saved).toEqual([
    {
      countingSince: "2026-11-15T10:00:00.000Z",
      hours: [{ hour: "2026-11-15T10", workspaceId: "w1", turns: 1, failed: 0, workMs: 0 }],
      folders: { w1: "/work/shop" },
    },
  ]);
});

test("turns that end while a save runs share the next one", async () => {
  const { stats, saved, hold } = setup();
  const release = hold();

  const first = stats.ended(turn());
  const more = [stats.ended(turn({ agentId: "a2" })), stats.ended(turn({ agentId: "a3" }))];
  await Promise.all(more);
  release();
  await first;

  expect(saved).toHaveLength(2);
  expect(saved[1].hours[0].turns).toBe(3);
});

test("a save that fails is logged, and the count goes on", async () => {
  const { stats, logs, fail } = setup();
  fail();

  await stats.ended(turn());
  await stats.ended(turn());

  expect(logs).toEqual([
    "[agent-stats] the counts could not be saved: disk full",
    "[agent-stats] the counts could not be saved: disk full",
  ]);
  expect((await stats.read(EVER, NO_WORKSPACES)).hours[0].turns).toBe(2);
});

test("hours older than 120 days go, at start and as turns end, with their workspace's folder", async () => {
  const stored: StoredStats = {
    countingSince: "2026-01-01T00:00:00.000Z",
    hours: [
      { hour: "2026-07-01T10", workspaceId: "old", turns: 9, failed: 0, workMs: 9000 },
      { hour: "2026-11-01T10", workspaceId: "w1", turns: 1, failed: 0, workMs: 1000 },
    ],
    folders: { old: "/work/old", w1: "/work/shop" },
  };
  const { stats, saved, to } = setup(stored);
  expect((await stats.read(EVER, NO_WORKSPACES)).hours.map((hour) => hour.workspaceId)).toEqual([
    "w1",
  ]);

  // Four months on, the November hour is too old as well.
  to("2027-03-15T10:00:00Z");
  await stats.ended(turn({ workspaceId: "w3", folder: "/work/new" }));

  expect(saved.at(-1)?.hours.map((hour) => hour.hour)).toEqual(["2027-03-15T10"]);
  expect(saved.at(-1)?.folders).toEqual({ w3: "/work/new" });
});

test("a subscriber is told of each turn until it leaves", async () => {
  const { stats } = setup();
  const events: unknown[] = [];
  const controller = new AbortController();
  const attached = stats.attach({
    push: async (event) => void events.push(event),
    signal: controller.signal,
  });

  await stats.ended(turn());
  controller.abort();
  await attached;
  await stats.ended(turn());

  expect(events).toEqual([{ type: "changed" }]);
});

test("a subscriber whose push fails does not stop the count, and one that already left gets nothing", async () => {
  const { stats } = setup();
  void stats.attach({
    push: () => Promise.reject(new Error("gone")),
    signal: new AbortController().signal,
  });
  const left = new AbortController();
  left.abort();
  const events: unknown[] = [];
  await stats.attach({ push: async (event) => void events.push(event), signal: left.signal });

  await stats.ended(turn());

  expect(events).toEqual([]);
  expect((await stats.read(EVER, NO_WORKSPACES)).hours[0].turns).toBe(1);
});
