// The TCP ports this host listens on and the process that holds each: the kernel's socket tables
// give the port and the socket's inode, and a process's fd links name the inodes it holds.
import { readdir, readFile, readlink } from "node:fs/promises";
import { join } from "node:path";
import type { Port, PortReach } from "../../shared/rpc.js";

export interface ListeningSocket extends Port {
  inode: number;
}

export interface OwnedPort extends Port {
  /** Null when no process in the list holds the socket, as for another user's server. */
  pid: number | null;
}

const TABLES = ["tcp", "tcp6"];
const LISTENING = "0A";
const HEX = /^[0-9A-Fa-f]+$/;
const SOCKET_LINK = /^socket:\[(\d+)\]$/;
const V4_ANY = "00000000";
const V6_LOOPBACK = "00000000000000000000000001000000";
const V4_MAPPED = "0000000000000000FFFF0000";
const WIDTH: Record<PortReach, number> = { local: 0, one: 1, all: 2 };

// The kernel prints an address as 32-bit words in host byte order. On the little-endian hosts
// Paseo runs on, 127.0.0.1 reads 0100007F, so every 127.x address ends in 7F.
function v4Reach(word: string): PortReach {
  if (word === V4_ANY) return "all";
  return word.toUpperCase().endsWith("7F") ? "local" : "one";
}

function reachOf(address: string): PortReach | null {
  if (!HEX.test(address)) return null;
  if (address.length === 8) return v4Reach(address);
  if (address.length !== 32) return null;
  if (/^0+$/.test(address)) return "all";
  if (address === V6_LOOPBACK) return "local";
  return address.toUpperCase().startsWith(V4_MAPPED) ? v4Reach(address.slice(24)) : "one";
}

// A row is "sl local_address rem_address st ... inode ...": the local address is field 2, the
// state field 4 and the inode field 10.
function parseRow(line: string): ListeningSocket | null {
  const fields = line.trim().split(/\s+/);
  const local = fields[1];
  if (fields.length < 10 || local === undefined || fields[3] !== LISTENING) return null;
  const colon = local.lastIndexOf(":");
  const portText = local.slice(colon + 1);
  const reach = reachOf(local.slice(0, Math.max(colon, 0)));
  const inode = Number(fields[9]);
  if (reach === null || !HEX.test(portText) || !Number.isSafeInteger(inode)) return null;
  return { port: Number.parseInt(portText, 16), reach, inode };
}

/** The listening sockets of one /proc/net/tcp or tcp6 text. */
export function parseListening(text: string): ListeningSocket[] {
  const sockets: ListeningSocket[] = [];
  for (const line of text.split("\n")) {
    const socket = parseRow(line);
    if (socket !== null) sockets.push(socket);
  }
  return sockets;
}

/** Each port once, lowest first, at the widest reach any of its sockets has. */
export function mergePorts(ports: readonly Port[]): Port[] {
  const widest = new Map<number, PortReach>();
  for (const { port, reach } of ports) {
    const known = widest.get(port);
    if (known === undefined || WIDTH[reach] > WIDTH[known]) widest.set(port, reach);
  }
  return [...widest].map(([port, reach]) => ({ port, reach })).toSorted((a, b) => a.port - b.port);
}

// Any read error means the same here: the process ended, or it is another user's.
async function heldInodes(procRoot: string, pid: number): Promise<number[]> {
  const dir = join(procRoot, String(pid), "fd");
  const names = await readdir(dir).catch((): string[] => []);
  const links = await Promise.all(
    names.map((name) => readlink(join(dir, name)).catch((): null => null)),
  );
  const inodes: number[] = [];
  for (const link of links) {
    const match = link === null ? null : SOCKET_LINK.exec(link);
    if (match) inodes.push(Number(match[1]));
  }
  return inodes;
}

// One process at a time, in the order given, so a socket a parent shares with its workers goes
// to the parent, and the walk ends once every wanted socket has an owner.
async function socketOwners(
  procRoot: string,
  pids: readonly number[],
  wanted: ReadonlySet<number>,
): Promise<Map<number, number>> {
  const owners = new Map<number, number>();
  for (const pid of pids) {
    if (owners.size === wanted.size) break;
    for (const inode of await heldInodes(procRoot, pid)) {
      if (wanted.has(inode) && !owners.has(inode)) owners.set(inode, pid);
    }
  }
  return owners;
}

/**
 * Not blocking, unlike the process table: a busy host has thousands of fd links, and a port
 * whose owner started a moment ago only shows a reading late.
 */
export async function readListeningPorts(
  procRoot: string,
  pids: readonly number[],
): Promise<OwnedPort[]> {
  const texts = await Promise.all(
    TABLES.map((name) => readFile(join(procRoot, "net", name), "utf8").catch(() => "")),
  );
  const sockets = texts.flatMap(parseListening);
  if (sockets.length === 0) return [];
  const owners = await socketOwners(procRoot, pids, new Set(sockets.map((each) => each.inode)));
  return sockets.map(({ port, reach, inode }) => ({ port, reach, pid: owners.get(inode) ?? null }));
}
