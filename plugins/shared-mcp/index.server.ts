import type { PluginServerContext } from "@getpaseo/plugin/server";
import { sharedMcpHome } from "./server/paths.js";
import { createSharedMcp } from "./server/plugin.js";

export default function contribute(server: PluginServerContext) {
  return createSharedMcp({ server, home: sharedMcpHome() });
}
