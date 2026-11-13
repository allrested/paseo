import type { PluginServerContext } from "@getpaseo/plugin/server";

export default function contribute(_server: PluginServerContext): () => Promise<void> {
  return async () => {};
}
