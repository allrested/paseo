import { homedir } from "node:os";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { agentsPort } from "./server/agents.js";
import { searchChats } from "./server/search.js";
import { hostStores } from "./server/stores.js";
import { searchRpc } from "./shared/contracts.js";

export default function contribute(server: PluginServerContext): () => void {
  // Built-ins run in the daemon process, so process.env is the daemon's env. The stores are made
  // per search: an account added since the daemon started is searched too.
  server.handle(searchRpc, ({ query }, { paseo }) =>
    searchChats(query, {
      stores: hostStores(process.env, homedir()),
      agents: agentsPort(paseo),
    }),
  );
  return () => {};
}
