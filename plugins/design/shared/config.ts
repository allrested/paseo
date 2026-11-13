export interface DesignConfig {
  /** ws:// or wss:// address of our figcraft-server, without a query. */
  serverUrl: string;
  /** Where the browser build is served, ending in a slash. */
  webUrl: string;
  /** Publishes and manages files. Never leaves the daemon. */
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
  const serverKey = env.FIGCRAFT_SERVER_KEY?.trim();
  if (!serverKey) return { disabled: "FIGCRAFT_SERVER_KEY is not set on this host" };
  const cap = Number.parseInt(env.DESIGN_MAX_BRIDGES ?? "", 10);
  return {
    serverUrl,
    webUrl: env.FIGCRAFT_WEB_URL?.trim() || webUrlFor(server),
    serverKey,
    cliPath: env.FIGCRAFT_CLI?.trim() || "figcraft-cli",
    maxBridges: Number.isInteger(cap) && cap > 0 ? cap : 3,
  };
}
