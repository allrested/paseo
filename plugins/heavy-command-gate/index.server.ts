import type { PluginServerContext } from "@getpaseo/plugin/server";
import { gateSettings } from "./shared/settings.js";

// The gate, its hook and its RPC arrive in Task 8.
export default function contribute(server: PluginServerContext): () => void {
  server.registerSettings(gateSettings);
  return () => undefined;
}
