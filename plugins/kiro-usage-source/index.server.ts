import type { PluginServerContext } from "@getpaseo/plugin/server";
import { inputSchema } from "./shared/input.js";
import { discover, fetchUsage } from "./server/usage.js";

export default function contribute(server: PluginServerContext) {
  server.registerUsageSource({
    id: "kiro",
    label: "Kiro CLI",
    input: inputSchema,
    discover: (scope) => discover(scope),
    fetch: fetchUsage,
  });
  return () => {};
}
