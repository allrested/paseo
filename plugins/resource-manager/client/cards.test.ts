import { describe, expect, it } from "vitest";
import type { AgentUsage, GroupUsage, HostSummary, RemoteSnapshot } from "../shared/rpc.js";
import {
  DISK_CRITICAL,
  DISK_WARNING,
  EMPTY_OPEN,
  EMPTY_TREND,
  LOAD_CRITICAL,
  LOAD_WARNING,
  MEMORY_CRITICAL,
  MEMORY_WARNING,
  TREND_CAPACITY,
  agentsSummary,
  areAllOpen,
  formatAge,
  groupsSummary,
  instanceDetails,
  instanceSample,
  instanceSummary,
  levelOf,
  overviewText,
  recordTrend,
  setAllOpen,
  snapshotDetails,
  snapshotSample,
  snapshotSummary,
  sortWorstFirst,
  toggleOpen,
  trendLines,
  type CardStatus,
  type TrendPoint,
} from "./cards.js";

const GIB = 1024 ** 3;

const SNAPSHOT: RemoteSnapshot = {
  memTotalBytes: 16 * GIB,
  memAvailableBytes: 8 * GIB,
  swapTotalBytes: 4 * GIB,
  swapFreeBytes: 3 * GIB,
  load1: 0.5,
  load5: 0.4,
  load15: 0.3,
  cores: 4,
  mounts: [
    { mount: "/", totalBytes: 100 * GIB, usedBytes: 40 * GIB, availableBytes: 60 * GIB },
    { mount: "/data", totalBytes: 200 * GIB, usedBytes: 142 * GIB, availableBytes: 58 * GIB },
  ],
  processes: [{ pid: 164, rssBytes: 2 * GIB, command: "postgres" }],
};

const HOST: HostSummary = {
  memoryUsedBytes: 3 * GIB,
  memoryLimitBytes: 8 * GIB,
  swapUsedBytes: 0,
  swapTotalBytes: 12 * GIB,
  hostAvailableBytes: 6 * GIB,
  hostTotalBytes: 15 * GIB,
  load1: 1,
  load5: 1.5,
  load15: 2,
  cores: 4,
};

const AGENT: AgentUsage = {
  agentId: "agent-a",
  title: "Fix login",
  provider: "claude",
  status: "idle",
  rssBytes: GIB,
  cpuPercent: 0,
  idleSince: "2026-11-06T08:50:00.000Z",
  processCount: 2,
};

describe("thresholds", () => {
  it("reads a level from a value: warning and critical start at their thresholds", () => {
    expect(
      [null, 0.79, 0.8, 0.89, 0.9, 1.4].map((value) =>
        levelOf(value, MEMORY_WARNING, MEMORY_CRITICAL),
      ),
    ).toEqual(["ok", "ok", "warning", "warning", "critical", "critical"]);
  });

  it("keeps the thresholds explicit", () => {
    expect([MEMORY_WARNING, MEMORY_CRITICAL]).toEqual([0.8, 0.9]);
    expect([LOAD_WARNING, LOAD_CRITICAL]).toEqual([1, 2]);
    expect([DISK_WARNING, DISK_CRITICAL]).toEqual([0.85, 0.95]);
  });
});

describe("snapshot summary", () => {
  it("shows memory, load against cores and the fullest disk of a healthy host", () => {
    expect(snapshotSummary(SNAPSHOT, null)).toEqual({
      status: "ok",
      label: "OK",
      note: null,
      meters: [
        { key: "memory", label: "Memory", value: "50% · 8.0 GB", fraction: 0.5, level: "ok" },
        {
          key: "load",
          label: "Load",
          value: "13% · 0.50 on 4 cores",
          fraction: 0.125,
          level: "ok",
        },
        { key: "disk", label: "Disk", value: "71% · /data", fraction: 0.71, level: "ok" },
      ],
    });
  });

  it("takes the worst meter as the status and names every meter over a threshold", () => {
    const busy: RemoteSnapshot = {
      ...SNAPSHOT,
      memAvailableBytes: 2 * GIB,
      load1: 9,
      mounts: [{ mount: "/", totalBytes: 100 * GIB, usedBytes: 96 * GIB, availableBytes: 4 * GIB }],
    };

    const summary = snapshotSummary(busy, null);

    expect(summary.status).toBe("critical");
    expect(summary.label).toBe("Critical");
    expect(summary.note).toBe("Memory 88%, load 225% of 4 cores, disk / 96%");
    expect(summary.meters.map((meter) => [meter.level, meter.fraction])).toEqual([
      ["warning", 0.875],
      ["critical", 1],
      ["critical", 0.96],
    ]);
  });

  it("warns on one meter alone", () => {
    const summary = snapshotSummary({ ...SNAPSHOT, load1: 4, cores: 4 }, null);

    expect([summary.status, summary.label, summary.note]).toEqual([
      "warning",
      "Warning",
      "Load 100% of 4 cores",
    ]);
  });

  it("shows a host with no disks, and skips a mount with no size", () => {
    const empty = snapshotSummary({ ...SNAPSHOT, mounts: [] }, null);
    const pseudo = snapshotSummary(
      {
        ...SNAPSHOT,
        mounts: [{ mount: "/proc", totalBytes: 0, usedBytes: 0, availableBytes: 0 }],
      },
      null,
    );

    expect(empty.meters[2]).toEqual({
      key: "disk",
      label: "Disk",
      value: "No disks",
      fraction: null,
      level: "ok",
    });
    expect(pseudo.meters[2]).toEqual(empty.meters[2]);
  });

  it("puts an error over the last reading, whose meters stay", () => {
    const summary = snapshotSummary(SNAPSHOT, "Connection refused");

    expect([summary.status, summary.label, summary.note]).toEqual([
      "error",
      "Error",
      "Connection refused",
    ]);
    expect(summary.meters).toHaveLength(3);
  });

  it("waits while a host has neither a reading nor an error", () => {
    expect(snapshotSummary(null, null)).toEqual({
      status: "waiting",
      label: "Waiting",
      note: null,
      meters: [],
    });
    expect(snapshotSummary(null, "Timed out").status).toBe("error");
  });
});

describe("instance summary", () => {
  it("shows the container against its cap, load and host memory", () => {
    expect(instanceSummary(HOST, null)).toEqual({
      status: "ok",
      label: "OK",
      note: null,
      meters: [
        { key: "memory", label: "Memory", value: "38% · 3.0 GB", fraction: 0.375, level: "ok" },
        { key: "load", label: "Load", value: "25% · 1.00 on 4 cores", fraction: 0.25, level: "ok" },
        {
          key: "hostMemory",
          label: "Host memory",
          value: "60% · 9.0 GB",
          fraction: 0.6,
          level: "ok",
        },
      ],
    });
  });

  it("says what is missing, and puts a failed refresh over the last reading", () => {
    const bare: HostSummary = {
      ...HOST,
      memoryUsedBytes: null,
      memoryLimitBytes: null,
      hostAvailableBytes: null,
      hostTotalBytes: null,
      load1: null,
    };
    const uncapped = instanceSummary({ ...HOST, memoryLimitBytes: null }, null);
    const failed = instanceSummary(HOST, "Refresh failed: socket closed");

    expect(
      instanceSummary(bare, null).meters.map((meter) => [meter.value, meter.fraction]),
    ).toEqual([
      ["Not available", null],
      ["Not available", null],
      ["Not available", null],
    ]);
    expect(uncapped.meters[0].value).toBe("3.0 GB, no cap");
    expect(uncapped.meters[0].fraction).toBeNull();
    expect([failed.status, failed.note]).toEqual(["error", "Refresh failed: socket closed"]);
  });
});

describe("worst first", () => {
  it("orders error, critical, warning, waiting, ok and keeps ties in their order", () => {
    const hosts: { name: string; status: CardStatus }[] = [
      { name: "a", status: "ok" },
      { name: "b", status: "warning" },
      { name: "c", status: "waiting" },
      { name: "d", status: "error" },
      { name: "e", status: "warning" },
      { name: "f", status: "critical" },
    ];

    expect(sortWorstFirst(hosts, (host) => host.status).map((host) => host.name)).toEqual([
      "d",
      "f",
      "b",
      "e",
      "c",
      "a",
    ]);
    expect(hosts[0].name).toBe("a");
  });

  it("counts the hosts that need attention", () => {
    expect(overviewText(["ok", "error", "warning", "critical", "waiting"])).toBe(
      "5 hosts, 3 need attention",
    );
    expect(overviewText(["ok", "warning"])).toBe("2 hosts, 1 needs attention");
    expect(overviewText(["ok", "ok"])).toBe("2 hosts, all OK");
    expect(overviewText(["ok", "waiting"])).toBe("2 hosts, 1 waiting");
    expect(overviewText(["ok"])).toBe("1 host, all OK");
  });
});

describe("trend", () => {
  const at = (second: number) => `2026-11-06T09:00:${String(second).padStart(2, "0")}.000Z`;

  it("appends one point per new reading and ignores a reading it already has", () => {
    const first = recordTrend(EMPTY_TREND, [{ key: "a", at: at(0), memory: 0.5, load: 1 }]);
    const again = recordTrend(first, [{ key: "a", at: at(0), memory: 0.5, load: 1 }]);
    const second = recordTrend(first, [
      { key: "a", at: at(30), memory: 0.6, load: 2 },
      { key: "b", at: at(30), memory: 0.1, load: 0 },
      { key: "c", at: null, memory: null, load: null },
    ]);

    expect(again).toBe(first);
    expect(second.get("a")).toEqual([
      { at: at(0), memory: 0.5, load: 1 },
      { at: at(30), memory: 0.6, load: 2 },
    ]);
    expect(second.get("b")).toHaveLength(1);
    expect(second.has("c")).toBe(false);
    expect(first.get("a")).toHaveLength(1);
  });

  it("keeps the newest readings up to the capacity", () => {
    let history = EMPTY_TREND;
    for (let index = 0; index < TREND_CAPACITY + 5; index += 1) {
      history = recordTrend(history, [{ key: "a", at: `t${index}`, memory: index, load: 0 }]);
    }

    const points = history.get("a") ?? [];

    expect(points).toHaveLength(TREND_CAPACITY);
    expect(points[0].at).toBe("t5");
    expect(points[points.length - 1].at).toBe(`t${TREND_CAPACITY + 4}`);
  });

  it("samples a snapshot and this instance", () => {
    expect(snapshotSample("a", SNAPSHOT, at(0))).toEqual({
      key: "a",
      at: at(0),
      memory: 0.5,
      load: 0.5,
    });
    expect(snapshotSample("a", null, null)).toEqual({
      key: "a",
      at: null,
      memory: null,
      load: null,
    });
    expect(instanceSample("i", HOST, at(0))).toEqual({
      key: "i",
      at: at(0),
      memory: 0.375,
      load: 1,
    });
    // Without a cap the container has no share, so the trend follows host memory.
    expect(instanceSample("i", { ...HOST, memoryLimitBytes: null }, at(0)).memory).toBe(0.6);
  });

  it("draws nothing from one reading, then bars and a range per measure", () => {
    const points: TrendPoint[] = [
      { at: at(0), memory: 0.5, load: 1 },
      { at: at(30), memory: 0.25, load: 8 },
      { at: at(59), memory: 0.75, load: 2 },
    ];

    expect(trendLines(points.slice(0, 1), 4)).toEqual([]);
    const lines = trendLines(points, 4);

    expect(lines.map((line) => [line.key, line.label, line.range])).toEqual([
      ["memory", "Memory", "25% to 75%"],
      ["load", "Load", "1.00 to 8.00"],
    ]);
    expect(lines[0].bars).toEqual([
      { at: at(0), height: 0.5 },
      { at: at(30), height: 0.25 },
      { at: at(59), height: 0.75 },
    ]);
    // Load is drawn against the core count, or its own peak when that is higher.
    expect(lines[1].bars.map((bar) => bar.height)).toEqual([0.125, 1, 0.25]);
  });

  it("scales load to the cores while it stays under them, and says when a measure is flat", () => {
    const points: TrendPoint[] = [
      { at: at(0), memory: null, load: 1 },
      { at: at(30), memory: null, load: 1 },
    ];

    const lines = trendLines(points, 4);

    expect(lines.map((line) => [line.key, line.range])).toEqual([["load", "steady at 1.00"]]);
    expect(lines[0].bars.map((bar) => bar.height)).toEqual([0.25, 0.25]);
  });
});

describe("open cards", () => {
  it("opens and closes one card", () => {
    const one = toggleOpen(EMPTY_OPEN, "a");
    const two = toggleOpen(one, "b");

    expect([...two]).toEqual(["a", "b"]);
    expect([...toggleOpen(two, "a")]).toEqual(["b"]);
    expect([...EMPTY_OPEN]).toEqual([]);
    expect([...one]).toEqual(["a"]);
  });

  it("opens or closes a set of cards and leaves the others alone", () => {
    const open = toggleOpen(EMPTY_OPEN, "other");
    const all = setAllOpen(open, ["a", "b"], true);

    expect([...all].sort()).toEqual(["a", "b", "other"]);
    expect(areAllOpen(all, ["a", "b"])).toBe(true);
    expect(areAllOpen(toggleOpen(all, "a"), ["a", "b"])).toBe(false);
    expect([...setAllOpen(all, ["a", "b"], false)]).toEqual(["other"]);
    expect(areAllOpen(EMPTY_OPEN, [])).toBe(false);
  });
});

describe("reading age", () => {
  it("says how old a reading is", () => {
    const now = Date.parse("2026-11-06T09:10:00.000Z");
    const ages = [
      null,
      "2026-11-06T09:09:58.000Z",
      "2026-11-06T09:09:20.000Z",
      "2026-11-06T09:00:00.000Z",
      // A daemon clock ahead of this device's.
      "2026-11-06T09:10:30.000Z",
    ].map((readAt) => formatAge(readAt, now));

    expect(ages).toEqual(["No reading yet", "Just now", "40 s ago", "10 min ago", "Just now"]);
  });
});

describe("details", () => {
  it("lists usage, every disk and the top processes of a snapshot", () => {
    const readAt = new Date(2026, 10, 6, 9, 5, 3).toISOString();

    expect(snapshotDetails(SNAPSHOT, readAt)).toEqual([
      {
        key: "usage",
        title: "Usage",
        empty: null,
        rows: [
          { key: "memory", label: "Memory", value: "8.0 GB of 16 GB (50%)" },
          { key: "swap", label: "Swap", value: "1.0 GB of 4.0 GB (25%)" },
          { key: "load", label: "Load", value: "0.50, 0.40, 0.30 on 4 cores" },
          { key: "readAt", label: "Last reading", value: "09:05:03" },
        ],
      },
      {
        key: "disks",
        title: "Disks",
        empty: null,
        rows: [
          { key: "/", label: "/", value: "40 GB of 100 GB (40%)" },
          { key: "/data", label: "/data", value: "142 GB of 200 GB (71%)" },
        ],
      },
      {
        key: "processes",
        title: "Top processes",
        empty: null,
        rows: [{ key: "164", label: "postgres", value: "2.0 GB, pid 164" }],
      },
    ]);
  });

  it("says when a snapshot has no disks or processes", () => {
    const blocks = snapshotDetails({ ...SNAPSHOT, mounts: [], processes: [] }, null);

    expect(blocks.map((block) => [block.rows.length, block.empty])).toEqual([
      [4, null],
      [0, "No disks reported"],
      [0, "No processes reported"],
    ]);
    expect(blocks[0].rows[3].value).toBe("None yet");
  });

  it("lists this instance's rows", () => {
    const readAt = new Date(2026, 10, 6, 9, 5, 3).toISOString();

    expect(instanceDetails(HOST, readAt)[0].rows.map((row) => row.label)).toEqual([
      "Container memory",
      "Swap",
      "Available host memory",
      "Load",
      "Last reading",
    ]);
  });
});

describe("agent and group summaries", () => {
  it("sums the agents and counts the idle ones", () => {
    const running: AgentUsage = { ...AGENT, agentId: "agent-b", status: "running", rssBytes: GIB };

    expect(agentsSummary([AGENT, running])).toBe("2 agents, 1 idle, 2.0 GB");
    expect(agentsSummary([running])).toBe("1 agent, 0 idle, 1.0 GB");
    expect(agentsSummary([])).toBe("No agent processes");
  });

  it("sums the groups", () => {
    const groups: GroupUsage[] = [
      { kind: "daemon", rssBytes: GIB, cpuPercent: 0, processCount: 3 },
      { kind: "other", rssBytes: GIB, cpuPercent: null, processCount: 1 },
    ];

    expect(groupsSummary(groups)).toBe("4 processes, 2.0 GB");
  });
});
