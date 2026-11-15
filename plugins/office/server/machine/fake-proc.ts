import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface FakeProcess {
  pid: number;
  ppid?: number;
  name?: string;
  startTime?: number;
  /** Omitted for a process no agent started. */
  agentId?: string;
  rssKb?: number;
  /** Inodes of the sockets it holds. */
  sockets?: number[];
}

export interface FakeHost {
  processes?: FakeProcess[];
  /** Listening sockets: port and inode. */
  listening?: { port: number; inode: number; v6?: boolean }[];
  meminfo?: { totalKb: number; availableKb: number };
  /** cgroup v2 files; `max` is "max" for no cap. */
  cgroup?: { max: string; current: number };
  /** user nice system idle iowait irq softirq steal. */
  cpu?: number[];
}

export interface FakeRoots {
  procRoot: string;
  cgroupRoot: string;
}

function statLine(process: FakeProcess): string {
  const fields = Array.from({ length: 50 }, () => "0");
  fields[1] = String(process.ppid ?? 1);
  fields[19] = String(process.startTime ?? process.pid * 10);
  return `${process.pid} (${process.name ?? "node"}) S ${fields.slice(1).join(" ")}\n`;
}

function tcpRow(port: number, inode: number, v6: boolean): string {
  const address = v6 ? "0".repeat(32) : "00000000";
  const hex = port.toString(16).toUpperCase().padStart(4, "0");
  return `   0: ${address}:${hex} ${address}:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 ${inode} 1 0000000000000000 100 0 0 10 0`;
}

/** A /proc and a cgroup directory in a new temporary directory, holding what the reader reads. */
export async function fakeHost(host: FakeHost): Promise<FakeRoots> {
  const root = await mkdtemp(join(tmpdir(), "office-proc-"));
  const procRoot = join(root, "proc");
  const cgroupRoot = join(root, "cgroup");
  await mkdir(join(procRoot, "net"), { recursive: true });
  await mkdir(cgroupRoot, { recursive: true });
  for (const process of host.processes ?? []) {
    const dir = join(procRoot, String(process.pid));
    await mkdir(join(dir, "fd"), { recursive: true });
    const env = ["HOME=/home/user", "PASEO_AGENT_CWD=/repo"];
    if (process.agentId !== undefined) env.push(`PASEO_AGENT_ID=${process.agentId}`);
    await writeFile(join(dir, "environ"), `${env.join("\0")}\0`);
    await writeFile(join(dir, "stat"), statLine(process));
    await writeFile(join(dir, "status"), `Name:\tnode\nVmRSS:\t${process.rssKb ?? 0} kB\n`);
    await symlink("/dev/null", join(dir, "fd", "0"));
    for (const [index, inode] of (process.sockets ?? []).entries()) {
      await symlink(`socket:[${inode}]`, join(dir, "fd", String(index + 3)));
    }
  }
  const header =
    "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode";
  const rows = (v6: boolean) =>
    (host.listening ?? [])
      .filter((socket) => (socket.v6 ?? false) === v6)
      .map((socket) => tcpRow(socket.port, socket.inode, v6));
  await writeFile(join(procRoot, "net", "tcp"), `${[header, ...rows(false)].join("\n")}\n`);
  await writeFile(join(procRoot, "net", "tcp6"), `${[header, ...rows(true)].join("\n")}\n`);
  if (host.meminfo) {
    await writeFile(
      join(procRoot, "meminfo"),
      `MemTotal:       ${host.meminfo.totalKb} kB\nMemFree:        1 kB\nMemAvailable:   ${host.meminfo.availableKb} kB\n`,
    );
  }
  if (host.cgroup) {
    await writeFile(join(cgroupRoot, "memory.max"), `${host.cgroup.max}\n`);
    await writeFile(join(cgroupRoot, "memory.current"), `${host.cgroup.current}\n`);
  }
  if (host.cpu)
    await writeFile(join(procRoot, "stat"), `cpu  ${host.cpu.join(" ")} 0 0\ncpu0 1 2 3\n`);
  return { procRoot, cgroupRoot };
}
