import type { GroupKind } from "../../shared/rpc.js";
import type { ProcessInfo } from "./process-table.js";

export interface AttributionContext {
  daemonPid: number;
  supervisorPid: number | null;
  /** Every pid in a shared-mcp server's tree (readSharedMcpPids). */
  sharedMcpPids: ReadonlySet<number>;
  liveAgentIds: ReadonlySet<string>;
}

export interface Attribution {
  agents: Map<string, number[]>;
  groups: Map<GroupKind, number[]>;
}

type Owner = { kind: "agent"; agentId: string } | { kind: "group"; group: GroupKind };

const DAEMON: Owner = { kind: "group", group: "daemon" };
const SHARED_MCP: Owner = { kind: "group", group: "sharedMcp" };
const HEAVY_GATE: Owner = { kind: "group", group: "heavyGate" };
const OTHER: Owner = { kind: "group", group: "other" };

// The gate holds a marked process only while its chain of marked processes hangs from a live gate
// shim, which stays the parent of a command it admitted. A process the command left running, such
// as a build daemon, and a command the shim ran after failing open (the shim replaced itself with
// it) have no shim at the top, and fall to their agent or "other".
function isHeldByGate(info: ProcessInfo, byPid: ReadonlyMap<number, ProcessInfo>): boolean {
  const seen = new Set<number>();
  let current = info;
  while (!seen.has(current.pid)) {
    seen.add(current.pid);
    const parent = byPid.get(current.ppid);
    if (parent === undefined) return false;
    if (!parent.heavyGate) return parent.gateShim;
    current = parent;
  }
  return false;
}

// A process's own owner, or null when it inherits its parent's. First match wins: shared-mcp
// servers strip PASEO_* from their env but are still listed by pid; a heavy command also carries
// its agent's PASEO_AGENT_ID, and the gate's group takes it.
function ownOwner(
  info: ProcessInfo,
  context: AttributionContext,
  byPid: ReadonlyMap<number, ProcessInfo>,
): Owner | null {
  if (context.sharedMcpPids.has(info.pid)) return SHARED_MCP;
  if (info.pid === context.daemonPid || info.pid === context.supervisorPid) return DAEMON;
  if (info.heavyGate && isHeldByGate(info, byPid)) return HEAVY_GATE;
  if (info.agentId === null) return null;
  return context.liveAgentIds.has(info.agentId) ? { kind: "agent", agentId: info.agentId } : OTHER;
}

function push<Key>(map: Map<Key, number[]>, key: Key, pid: number): void {
  const pids = map.get(key);
  if (pids) pids.push(pid);
  else map.set(key, [pid]);
}

// Each process gets exactly one owner. A process that inherits walks up its ppid chain until a
// process with an owner of its own; the tree root and a ppid cycle (a table read while processes
// were reparented) end at "other".
export function attribute(table: readonly ProcessInfo[], context: AttributionContext): Attribution {
  const byPid = new Map(table.map((info): [number, ProcessInfo] => [info.pid, info]));
  const owners = new Map<number, Owner>();

  const ownerOf = (start: ProcessInfo): Owner => {
    const chain: number[] = [];
    const seen = new Set<number>();
    let owner = OTHER;
    let current: ProcessInfo | undefined = start;
    while (current !== undefined && !seen.has(current.pid)) {
      const known = owners.get(current.pid);
      if (known !== undefined) {
        owner = known;
        break;
      }
      seen.add(current.pid);
      chain.push(current.pid);
      const own = ownOwner(current, context, byPid);
      if (own !== null) {
        owner = own;
        break;
      }
      current = byPid.get(current.ppid);
    }
    for (const pid of chain) owners.set(pid, owner);
    return owner;
  };

  const agents = new Map<string, number[]>();
  const groups = new Map<GroupKind, number[]>();
  for (const info of table) {
    const owner = ownerOf(info);
    if (owner.kind === "agent") push(agents, owner.agentId, info.pid);
    else push(groups, owner.group, info.pid);
  }
  return { agents, groups };
}
