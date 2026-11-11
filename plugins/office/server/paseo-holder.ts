import type { PluginHandlerContext } from "@getpaseo/plugin/server";

export type Paseo = PluginHandlerContext["paseo"];

/**
 * The plugin's one Paseo API object. PluginServerContext has none of its own; every handler,
 * hook and tool receives the same object (plugin-process.ts) and remembers it here, so timers
 * started by those calls can use it.
 */
export interface PaseoHolder {
  remember(paseo: Paseo): void;
  require(): Paseo;
}

export function createPaseoHolder(): PaseoHolder {
  let held: Paseo | null = null;
  return {
    remember(paseo) {
      held = paseo;
    },
    require() {
      if (held === null) throw new Error("The office has not received the Paseo API yet");
      return held;
    },
  };
}
