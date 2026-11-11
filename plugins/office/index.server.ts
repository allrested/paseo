import type { PluginServerContext } from "@getpaseo/plugin/server";

// Runs inside the daemon process; see the plan's "Daemon process safety" rule before adding work.
export default function contribute(_server: PluginServerContext): () => Promise<void> {
  return async () => {};
}
