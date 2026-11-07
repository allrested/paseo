import { availableParallelism, homedir } from "node:os";
import { setTimeout as delay } from "node:timers/promises";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { paseoPorts } from "./server/paseo-ports.js";
import { createResourceManager } from "./server/plugin.js";
import { nodeTimers } from "./server/remote/sessions.js";
import { closeAgentRpc, localRpc, serverRpc, serversRpc } from "./shared/rpc.js";

// Runs inside the daemon: process.pid is the daemon worker, and process.env is the daemon's env
// (PASEO_* is stripped before config variables expand and before anything is spawned).
export default function contribute(server: PluginServerContext): () => Promise<void> {
  const manager = createResourceManager({
    env: process.env,
    home: homedir(),
    procRoot: "/proc",
    cgroupRoot: "/sys/fs/cgroup",
    daemonPid: process.pid,
    cores: availableParallelism(),
    now: () => Date.now(),
    sleep: (ms) => delay(ms, undefined, { ref: false }),
    timers: nodeTimers,
    log: (message) => console.error(message),
  });
  server.handle(localRpc, (_input, context) => manager.local(paseoPorts(context.paseo)));
  server.handle(serversRpc, (_input, context) => manager.servers(paseoPorts(context.paseo)));
  server.handle(serverRpc, ({ id }, context) => manager.server(paseoPorts(context.paseo), id));
  server.handle(closeAgentRpc, ({ agentId }, context) =>
    manager.closeAgent(paseoPorts(context.paseo), agentId),
  );
  // Signals every ssh-mcp group at once; a group that outlives the daemon's ~2 s wait is
  // reclaimed from its pid file at the next start.
  return () => manager.stop();
}
