import { expect, test } from "vitest";
import { daemonPid } from "./host-process.js";

test("in the daemon's own process the daemon is this process", () => {
  expect(daemonPid({ pid: 100, ppid: 1, inDaemon: true })).toBe(100);
});

test("in a subprocess the daemon is found from the parent", () => {
  expect(daemonPid({ pid: 200, ppid: 100, inDaemon: false })).toBe(100);
});

test("a subprocess with no parent to name protects itself", () => {
  expect(daemonPid({ pid: 200, ppid: 0, inDaemon: false })).toBe(200);
});
