import { expect, test } from "vitest";
import type { WorkspaceScript } from "../shared/contracts.js";
import {
  LOG_LINES,
  LOG_LINE_MAX,
  LOG_READ_ROWS,
  logTail,
  readScriptLog,
  type ScriptLogPorts,
} from "./script-log.js";

const NOW = Date.parse("2026-11-16T09:00:00.000Z");

function script(patch: Partial<WorkspaceScript> = {}): WorkspaceScript {
  return {
    name: "dev",
    kind: "service",
    running: true,
    health: "healthy",
    exitCode: null,
    port: 5173,
    terminalId: "t1",
    ...patch,
  };
}

interface Asked {
  terminalId: string;
  rows: number;
}

function ports(
  known: WorkspaceScript | null,
  rows: readonly string[],
  total = rows.length,
): { ports: ScriptLogPorts; asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    ports: {
      script: (workspaceId, name) => (workspaceId === "w1" && name === known?.name ? known : null),
      tail: async (terminalId, count) => {
        asked.push({ terminalId, rows: count });
        return { lines: rows, total };
      },
      now: () => NOW,
    },
  };
}

test("the tail drops the empty end of the screen and keeps the newest lines", () => {
  expect(logTail([])).toEqual({ lines: [], above: 0 });
  expect(logTail(["", "  ", ""])).toEqual({ lines: [], above: 0 });
  expect(logTail(["a", "", "b", "", "   "])).toEqual({ lines: ["a", "", "b"], above: 0 });
  const many = Array.from({ length: LOG_LINES + 5 }, (_, index) => `line ${index}`);
  // The empty rows under the output are not rows over it.
  expect(logTail([...many, "", ""])).toEqual({ lines: many.slice(5), above: 5 });
});

test("a line longer than a log line is cut", () => {
  expect(logTail(["x".repeat(LOG_LINE_MAX + 50)]).lines).toEqual([
    `${"x".repeat(LOG_LINE_MAX - 1)}…`,
  ]);
  expect(logTail(["x".repeat(LOG_LINE_MAX)]).lines).toEqual(["x".repeat(LOG_LINE_MAX)]);
});

test("a script's log is the end of its own terminal", async () => {
  const fake = ports(script(), ["ready on 5173", "GET / 200", "", ""], 900);
  expect(await readScriptLog(fake.ports, "w1", "dev")).toEqual({
    ok: true,
    lines: ["ready on 5173", "GET / 200"],
    // The 896 rows the read did not ask for. The empty end of the screen is under the output.
    earlier: 896,
    readAt: "2026-11-16T09:00:00.000Z",
  });
  expect(fake.asked).toEqual([{ terminalId: "t1", rows: LOG_READ_ROWS }]);
});

test("a log that fits has nothing earlier, on a screen that is mostly empty too", async () => {
  const fake = ports(script(), ["one", "two"]);
  expect(await readScriptLog(fake.ports, "w1", "dev")).toMatchObject({ ok: true, earlier: 0 });
  const screen = ports(script(), ["$ run", "done", ...Array.from({ length: 22 }, () => "")]);
  expect(await readScriptLog(screen.ports, "w1", "dev")).toMatchObject({
    ok: true,
    lines: ["$ run", "done"],
    earlier: 0,
  });
});

test("a long log counts the rows over the lines shown", async () => {
  const rows = Array.from({ length: LOG_READ_ROWS }, (_, index) => `row ${index}`);
  const fake = ports(script(), rows, 1000);
  const result = await readScriptLog(fake.ports, "w1", "dev");
  expect(result).toMatchObject({
    ok: true,
    // 600 the read did not ask for, and 360 of its 400 over the 40 shown.
    earlier: 960,
  });
  expect(result.ok && result.lines).toEqual(rows.slice(-LOG_LINES));
});

test("a script the host does not know, and one that never ran, have no log", async () => {
  const unknown = ports(script(), ["x"]);
  expect(await readScriptLog(unknown.ports, "w1", "test")).toEqual({
    ok: false,
    error: "This host does not know the script",
  });
  expect(await readScriptLog(unknown.ports, "w2", "dev")).toEqual({
    ok: false,
    error: "This host does not know the script",
  });
  expect(unknown.asked).toEqual([]);

  const idle = ports(script({ terminalId: null, running: false }), ["x"]);
  expect(await readScriptLog(idle.ports, "w1", "dev")).toEqual({
    ok: false,
    error: "The script has not run on this host, so it has no output",
  });
  expect(idle.asked).toEqual([]);
});
