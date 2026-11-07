import type { PluginServerContext } from "@getpaseo/plugin/server";
import { claudeAccountsSettings } from "./shared/settings.js";

export default function contribute(server: PluginServerContext) {
  server.registerSettings(claudeAccountsSettings);
  return () => {};
}
