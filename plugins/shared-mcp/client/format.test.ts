import { describe, expect, it } from "vitest";
import type { ServerStatus } from "../shared/rpc.js";
import { describeServer, formatBytes, formatLogTail, formatUptime } from "./format.js";

const healthy: ServerStatus = {
  id: "context7",
  label: "Context7",
  port: 8932,
  state: "healthy",
  pid: 4321,
  startedAt: "2026-11-06T10:00:00.000Z",
  restarts: 1,
  rssBytes: 125_829_120,
  lastError: null,
  nextRetryAt: null,
  logTail: [],
};
const fetchedAt = Date.parse("2026-11-06T12:05:30.000Z");

describe("formatBytes", () => {
  it("keeps bytes whole and shows one decimal below ten of a larger unit", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1023)).toBe("1023 B");
    expect(formatBytes(1024)).toBe("1.0 KB");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(10_240)).toBe("10 KB");
    expect(formatBytes(125_829_120)).toBe("120 MB");
    expect(formatBytes(1_610_612_736)).toBe("1.5 GB");
  });

  it("stops at terabytes", () => {
    expect(formatBytes(2048 * 1024 ** 4)).toBe("2048 TB");
  });
});

describe("formatUptime", () => {
  it("shows the two largest units", () => {
    expect(formatUptime(45_000)).toBe("45s");
    expect(formatUptime(192_000)).toBe("3m 12s");
    expect(formatUptime(7_530_000)).toBe("2h 5m");
    expect(formatUptime(273_600_000)).toBe("3d 4h");
  });

  it("clamps a negative duration from clock skew to zero", () => {
    expect(formatUptime(-5_000)).toBe("0s");
  });
});

describe("describeServer", () => {
  it("summarizes a running server against the fetch time", () => {
    expect(describeServer(healthy, fetchedAt)).toBe(
      "healthy · port 8932 · pid 4321 · up 2h 5m · 1 restart · 120 MB",
    );
  });

  it("shows the retry countdown and no uptime while backing off", () => {
    const backoff: ServerStatus = {
      ...healthy,
      state: "backoff",
      pid: null,
      startedAt: null,
      restarts: 3,
      rssBytes: null,
      nextRetryAt: "2026-11-06T12:05:38.000Z",
    };
    expect(describeServer(backoff, fetchedAt)).toBe(
      "backoff · port 8932 · 3 restarts · retry in 8s",
    );
  });
});

describe("formatLogTail", () => {
  it("keeps the last lines in order", () => {
    expect(formatLogTail(["one", "two", "three"], 2)).toBe("two\nthree");
  });

  it("says when the server has written nothing", () => {
    expect(formatLogTail([], 20)).toBe("No output yet.");
  });
});
