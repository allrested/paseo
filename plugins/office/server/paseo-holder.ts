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
  /** Resolves once a handler has brought the API: a run due before that waits for it. */
  wait(): Promise<Paseo>;
}

export function createPaseoHolder(): PaseoHolder {
  let held: Paseo | null = null;
  let arrived: (paseo: Paseo) => void = () => undefined;
  const first = new Promise<Paseo>((resolve) => {
    arrived = resolve;
  });
  return {
    remember(paseo) {
      held = paseo;
      arrived(paseo);
    },
    require() {
      if (held === null) throw new Error("The office has not received the Paseo API yet");
      return held;
    },
    wait: () => (held === null ? first : Promise.resolve(held)),
  };
}
