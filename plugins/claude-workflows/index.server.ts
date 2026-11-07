import { homedir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { runRpc } from "./shared/run.js";
import { createRunCache } from "./server/cache.js";
import { loadRun, newRunFiles } from "./server/run.js";

export default function contribute(server: PluginServerContext) {
  const cache = createRunCache({ create: newRunFiles, now: () => Date.now() });
  const home = homedir();
  server.handle(runRpc, (input, { paseo }) =>
    loadRun(input, { agents: paseo.agents, home, env: process.env, procRoot: "/proc", cache }),
  );
  // Nothing to stop: the plugin holds no timer, watcher or open file between calls.
  return () => {};
}
