import type { PluginServerContext } from "@getpaseo/plugin/server";
import { fetchAgentTitle } from "./server/agent-title.js";
import { gateHome, gatePaths } from "./server/paths.js";
import { startGatePlugin } from "./server/plugin.js";
import { resolveShimInterpreter } from "./server/shim/install.js";
import { statusRpc } from "./shared/rpc.js";
import { gateSettings } from "./shared/settings.js";

// Everything the runtime snapshots at "ready" (the settings, the hook, the RPC) is registered
// before this returns; the gate starts behind it.
export default function contribute(server: PluginServerContext): () => Promise<void> {
  const gate = startGatePlugin({
    paths: gatePaths(gateHome()),
    settings: server.registerSettings(gateSettings),
    interpreter: resolveShimInterpreter(),
    daemonPath: process.env.PATH,
  });
  // One hook for the plugin's lifetime: adding or removing a hook reloads every agent's session.
  const removeHook = server.addHook("agent.open.before", ({ request }) => gate.openHook(request));
  server.handle(statusRpc, (_input, { paseo }) =>
    gate.status((agentId) => fetchAgentTitle(paseo, agentId)),
  );
  return async function cleanup(): Promise<void> {
    removeHook();
    await gate.stop();
  };
}
