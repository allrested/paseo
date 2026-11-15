import { join } from "node:path";

/** The entry of the page that draws the 3D office, under the plugin's folder. */
export const WORLD_ENTRY = ["vendor", "my-office", "src", "office", "paseo-entry.js"] as const;

export function worldEntryPath(pluginDirectory: string): string {
  return join(pluginDirectory, ...WORLD_ENTRY);
}

export interface WorldScriptPorts {
  /** Builds one self-contained browser script from an entry file. */
  bundle(entryPath: string): Promise<string>;
  entryPath: string;
}

export interface WorldScript {
  /** The script, built on the first call and kept; a failed build is tried again next time. */
  read(): Promise<string>;
}

export function createWorldScript(ports: WorldScriptPorts): WorldScript {
  let built: Promise<string> | null = null;
  return {
    read() {
      built ??= ports.bundle(ports.entryPath).catch((error: unknown) => {
        built = null;
        throw error;
      });
      return built;
    },
  };
}
