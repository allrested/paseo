import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  V4_ANY,
  V4_LOOPBACK,
  V6_ANY,
  V6_LOOPBACK,
  writeFakeProc,
  writeFakeTcp,
} from "./fake-proc.js";
import { mergePorts, parseListening, readListeningPorts } from "./listening-ports.js";

const HEADER =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n";

function row(local: string, state: string, inode: number): string {
  return `   0: ${local} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000  1000        0 ${inode} 1 0000000000000000 100 0 0 10 0\n`;
}

describe("parseListening", () => {
  it("keeps listening sockets only, with the port and how far each can be reached", () => {
    const text =
      HEADER +
      row("0100007F:1A70", "0A", 11) +
      row("00000000:0BB8", "0A", 12) +
      row("020011AC:1F90", "0A", 13) +
      row("0100007F:C350", "01", 14);
    expect(parseListening(text)).toEqual([
      { port: 6768, reach: "local", inode: 11 },
      { port: 3000, reach: "all", inode: 12 },
      { port: 8080, reach: "one", inode: 13 },
    ]);
  });

  it("reads any 127.x address as local", () => {
    expect(parseListening(HEADER + row("3500007F:0035", "0A", 5))).toEqual([
      { port: 53, reach: "local", inode: 5 },
    ]);
  });

  it("reads tcp6 addresses: every interface, ::1, a mapped 127.0.0.1, and one address", () => {
    const text =
      HEADER +
      row(`${"0".repeat(32)}:1435`, "0A", 21) +
      row("00000000000000000000000001000000:24C1", "0A", 22) +
      row("0000000000000000FFFF00000100007F:1F90", "0A", 23) +
      row("000080FE00000000FF005450B6AD1DFE:0016", "0A", 24);
    expect(parseListening(text)).toEqual([
      { port: 5173, reach: "all", inode: 21 },
      { port: 9409, reach: "local", inode: 22 },
      { port: 8080, reach: "local", inode: 23 },
      { port: 22, reach: "one", inode: 24 },
    ]);
  });

  it("skips what is not a socket row", () => {
    expect(parseListening("")).toEqual([]);
    expect(parseListening(`${HEADER}garbage\n   0: nonsense 0A\n`)).toEqual([]);
    expect(parseListening(HEADER + row("0100007F:ZZZZ", "0A", 1))).toEqual([]);
  });
});

describe("mergePorts", () => {
  it("lists each port once, lowest first, at its widest reach", () => {
    expect(
      mergePorts([
        { port: 5173, reach: "local" },
        { port: 3000, reach: "one" },
        { port: 5173, reach: "all" },
        { port: 3000, reach: "local" },
        { port: 22, reach: "local" },
      ]),
    ).toEqual([
      { port: 22, reach: "local" },
      { port: 3000, reach: "one" },
      { port: 5173, reach: "all" },
    ]);
  });
});

describe("readListeningPorts", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rm-ports-"));
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("names the process that holds each listening socket", async () => {
    writeFakeProc(root, [
      { pid: 10, ppid: 1, sockets: [900, 500] },
      { pid: 20, ppid: 10, sockets: [501, 502] },
      { pid: 30, ppid: 1 },
    ]);
    writeFakeTcp(
      root,
      [
        { address: V4_LOOPBACK, port: 6767, inode: 500 },
        { address: V4_ANY, port: 3000, inode: 501 },
        { address: V4_LOOPBACK, port: 40000, inode: 900, state: "01" },
      ],
      [
        { address: V6_ANY, port: 3000, inode: 502 },
        { address: V6_LOOPBACK, port: 9229, inode: 777 },
      ],
    );
    expect(await readListeningPorts(root, [10, 20, 30])).toEqual([
      { port: 6767, reach: "local", pid: 10 },
      { port: 3000, reach: "all", pid: 20 },
      { port: 3000, reach: "all", pid: 20 },
      // No process this user can read holds it: another user's server.
      { port: 9229, reach: "local", pid: null },
    ]);
  });

  it("gives a socket two processes hold to the first of them", async () => {
    writeFakeProc(root, [
      { pid: 10, ppid: 1, sockets: [500] },
      { pid: 11, ppid: 10, sockets: [500] },
    ]);
    writeFakeTcp(root, [{ address: V4_ANY, port: 8080, inode: 500 }]);
    expect(await readListeningPorts(root, [10, 11])).toEqual([
      { port: 8080, reach: "all", pid: 10 },
    ]);
  });

  it("is empty where the kernel lists no sockets, as on a host without /proc", async () => {
    writeFakeProc(root, [{ pid: 10, ppid: 1, sockets: [500] }]);
    expect(await readListeningPorts(root, [10])).toEqual([]);
    expect(await readListeningPorts(join(root, "missing"), [10])).toEqual([]);
  });

  it("skips a process that ended or cannot be read", async () => {
    writeFakeProc(root, [{ pid: 10, ppid: 1, sockets: [500] }]);
    writeFakeTcp(root, [{ address: V4_ANY, port: 8080, inode: 500 }]);
    expect(await readListeningPorts(root, [99, 10])).toEqual([
      { port: 8080, reach: "all", pid: 10 },
    ]);
  });
});
