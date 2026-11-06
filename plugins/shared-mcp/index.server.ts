import type { PluginServerContext } from "@getpaseo/plugin/server";
import { sharedMcpSettings } from "./shared/settings.js";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(sharedMcpSettings);
  return () => {};
}
