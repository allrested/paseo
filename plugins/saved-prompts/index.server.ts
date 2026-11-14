import type { PluginServerContext } from "@getpaseo/plugin/server";
import { savedPromptsSettings } from "./shared/settings.js";

// The list is the plugin's settings, which the host stores and serves; nothing else runs here.
export default function contribute(server: PluginServerContext): () => void {
  server.registerSettings(savedPromptsSettings);
  return () => {};
}
