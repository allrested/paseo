import { readFileSync } from "node:fs";

export interface DesignConfig {
  /** ws:// or wss:// address of our figcraft-server, without a query. */
  serverUrl: string;
  /** Where the browser build is served, ending in a slash. */
  webUrl: string;
  /** Publishes and manages files. Read from FIGCRAFT_SERVER_KEY_FILE; never leaves the daemon. */
  serverKey: string;
  cliPath: string;
  maxBridges: number;
}

const PUBLIC_SERVER = "collab.craftapps.dev";

function webUrlFor(server: URL): string {
  const url = new URL(server.toString());
  url.protocol = url.protocol === "ws:" ? "http:" : "https:";
  url.pathname = "/app/";
  url.search = "";
  return url.toString();
}

/** Built-ins run in the daemon, so `env` is the daemon's env. */
export function readDesignConfig(env: NodeJS.ProcessEnv): DesignConfig | { disabled: string } {
  const serverUrl = env.FIGCRAFT_URL?.trim();
  if (!serverUrl) return { disabled: "FIGCRAFT_URL is not set on this host" };
  let server: URL;
  try {
    server = new URL(serverUrl);
  } catch {
    return { disabled: "FIGCRAFT_URL must be a ws:// or wss:// address" };
  }
  if (server.protocol !== "ws:" && server.protocol !== "wss:") {
    return { disabled: "FIGCRAFT_URL must be a ws:// or wss:// address" };
  }
  if (server.hostname === PUBLIC_SERVER) {
    return { disabled: "FIGCRAFT_URL names FigCraft's public server; design mode uses your own" };
  }
  // A file, not the env: the daemon's env is every agent's and terminal's env.
  if (env.FIGCRAFT_SERVER_KEY?.trim()) {
    return {
      disabled:
        "Put the server key in a file named by FIGCRAFT_SERVER_KEY_FILE, not in FIGCRAFT_SERVER_KEY: agents and terminals inherit the daemon's env",
    };
  }
  const keyFile = env.FIGCRAFT_SERVER_KEY_FILE?.trim();
  if (!keyFile) return { disabled: "FIGCRAFT_SERVER_KEY_FILE is not set on this host" };
  let serverKey: string;
  try {
    serverKey = readFileSync(keyFile, "utf8").trim();
  } catch {
    return { disabled: "Unable to read FIGCRAFT_SERVER_KEY_FILE" };
  }
  if (!serverKey) return { disabled: "FIGCRAFT_SERVER_KEY_FILE is empty" };
  const cap = Number.parseInt(env.DESIGN_MAX_BRIDGES ?? "", 10);
  return {
    serverUrl,
    webUrl: env.FIGCRAFT_WEB_URL?.trim() || webUrlFor(server),
    serverKey,
    cliPath: env.FIGCRAFT_CLI?.trim() || "figcraft-cli",
    maxBridges: Number.isInteger(cap) && cap > 0 ? cap : 3,
  };
}
