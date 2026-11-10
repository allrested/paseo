import { homedir } from "node:os";
import { join } from "node:path";
import type { PluginServerContext } from "@getpaseo/plugin/server";
import { skillPaths } from "./server/paths.js";
import { startDefaultSkills } from "./server/plugin.js";
import { statusRpc } from "./shared/rpc.js";
import { defaultSkillsSettings } from "./shared/settings.js";

/** What the daemon passes a built-in beside the server context. */
interface BuiltinPluginInfo {
  directory: string;
}

export default function contribute(server: PluginServerContext, builtin?: BuiltinPluginInfo) {
  // Built-ins run in the daemon process, so process.env is the daemon's env.
  const skills = startDefaultSkills({
    settings: server.registerSettings(defaultSkillsSettings),
    paths: skillPaths(process.env, homedir()),
    vendorDirectory: builtin ? join(builtin.directory, "vendor") : null,
    log: (message) => console.error(message),
  });
  server.handle(statusRpc, () => skills.status());
  return async function cleanup(): Promise<void> {
    await skills.stop();
  };
}
