import { expect, test } from "vitest";
import { fakeHost } from "./fake-proc.js";
import {
  cpuPercent,
  parseAgentId,
  parseCpuTimes,
  parseListening,
  parseMeminfo,
  parseRssBytes,
  parseStat,
  readAgentProcesses,
  readAncestors,
  readCpuTimes,
  readListeners,
  readMemory,
  readStartTime,
} from "./proc.js";

test("the agent id is read from the environment, and only a whole key counts", () => {
  expect(parseAgentId("HOME=/h\0PASEO_AGENT_ID=a-1\0PATH=/bin\0")).toBe("a-1");
  expect(parseAgentId("HOME=/h\0NOT_PASEO_AGENT_ID=a-1\0")).toBe(null);
  expect(parseAgentId("PASEO_AGENT_ID=\0")).toBe(null);
  expect(parseAgentId("")).toBe(null);
});

test("a stat line is read around a name that holds spaces and parentheses", () => {
  const fields = Array.from({ length: 30 }, (_value, index) => String(index));
  fields[1] = "41";
  fields[19] = "9000";
  expect(parseStat(`77 (tmux: server (1)) S ${fields.slice(1).join(" ")}`)).toEqual({
    name: "tmux: server (1)",
    ppid: 41,
    startTime: 9000,
  });
  expect(parseStat("garbage")).toBe(null);
  expect(parseStat("77 (node) S x y")).toBe(null);
});

test("resident memory is the VmRSS line, and a process without one has none", () => {
  expect(parseRssBytes("Name:\tnode\nVmRSS:\t   2048 kB\nThreads:\t4\n")).toBe(2048 * 1024);
  expect(parseRssBytes("Name:\tkthreadd\n")).toBe(0);
});

test("only the processes an agent started are listed, lowest pid first", async () => {
  const { procRoot } = await fakeHost({
    processes: [
      { pid: 300, ppid: 200, agentId: "b", name: "vite", rssKb: 100, startTime: 5 },
      { pid: 100, name: "systemd" },
      { pid: 200, ppid: 100, agentId: "a", name: "claude", rssKb: 400, startTime: 4 },
    ],
  });
  expect(await readAgentProcesses(procRoot)).toEqual([
    { pid: 200, ppid: 100, agentId: "a", name: "claude", rssBytes: 400 * 1024, startTime: 4 },
    { pid: 300, ppid: 200, agentId: "b", name: "vite", rssBytes: 100 * 1024, startTime: 5 },
  ]);
  expect(await readAgentProcesses("/nonexistent-proc")).toEqual([]);
});

test("a listening row gives its port and inode; other states and broken rows give nothing", () => {
  const text = [
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode",
    "   0: 00000000:1435 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 555 1 0 100 0 0 10 0",
    "   1: 0100007F:1F90 0100007F:C350 01 00000000:00000000 00:00000000 00000000  1000        0 556 1 0 100 0 0 10 0",
    "   2: short row",
  ].join("\n");
  expect(parseListening(text)).toEqual([{ port: 5173, inode: 555 }]);
});

test("a port goes to the process that holds its socket, the first asked when several do", async () => {
  const { procRoot } = await fakeHost({
    processes: [
      { pid: 10, agentId: "a", sockets: [501, 502] },
      { pid: 11, agentId: "a", sockets: [501] },
      { pid: 12, agentId: "b", sockets: [999] },
      { pid: 13, agentId: "b", sockets: [503] },
    ],
    listening: [
      { port: 5173, inode: 501 },
      { port: 3000, inode: 502, v6: true },
      { port: 8000, inode: 503 },
      { port: 22, inode: 700 },
    ],
  });
  expect(await readListeners(procRoot, [10, 11, 12, 13])).toEqual(
    new Map([
      [10, [3000, 5173]],
      [13, [8000]],
    ]),
  );
  expect(await readListeners(procRoot, [])).toEqual(new Map());
});

test("memory is the cgroup's when it has a cap, else the host's", async () => {
  const capped = await fakeHost({
    cgroup: { max: "1000", current: 400 },
    meminfo: { totalKb: 9000, availableKb: 1000 },
  });
  expect(await readMemory(capped.procRoot, capped.cgroupRoot)).toEqual({
    usedBytes: 400,
    totalBytes: 1000,
  });
  const open = await fakeHost({
    cgroup: { max: "max", current: 400 },
    meminfo: { totalKb: 9000, availableKb: 1000 },
  });
  expect(await readMemory(open.procRoot, open.cgroupRoot)).toEqual({
    usedBytes: 8000 * 1024,
    totalBytes: 9000 * 1024,
  });
  const none = await fakeHost({});
  expect(await readMemory(none.procRoot, none.cgroupRoot)).toBe(null);
  expect(parseMeminfo("MemTotal: 0 kB\nMemAvailable: 0 kB\n")).toBe(null);
});

test("CPU use is the busy share of the time between two readings", async () => {
  const { procRoot } = await fakeHost({ cpu: [100, 0, 50, 800, 50, 0, 0, 0] });
  const before = await readCpuTimes(procRoot);
  expect(before).toEqual({ busy: 150, total: 1000 });
  expect(cpuPercent(before, { busy: 200, total: 1100 })).toBe(50);
  expect(cpuPercent(before, before)).toBe(null);
  expect(cpuPercent(null, before)).toBe(null);
  expect(parseCpuTimes("intr 1 2 3")).toBe(null);
});

test("the ancestors of a process are found by the ppid links, and a start time by pid", async () => {
  const { procRoot } = await fakeHost({
    processes: [
      { pid: 1, ppid: 0, name: "init" },
      { pid: 40, ppid: 1, name: "paseo" },
      { pid: 41, ppid: 40, name: "worker", startTime: 123 },
      { pid: 50, ppid: 1, name: "other" },
    ],
  });
  expect(await readAncestors(procRoot, 41)).toEqual(new Set([41, 40, 1]));
  expect(await readStartTime(procRoot, 41)).toBe(123);
  expect(await readStartTime(procRoot, 4242)).toBe(null);
});
