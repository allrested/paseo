import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { CdpConnection } from "./cdp-connection.js";

export interface CdpTargetInfo {
  id: string;
  type: string;
  url: string;
  title: string;
  openerId?: string;
}

export class CdpUnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CdpUnreachableError";
  }
}

export interface CdpEndpointOptions {
  url: string;
  lookup?: (hostname: string) => Promise<string>;
  fetchTimeoutMs?: number;
  commandTimeoutMs?: number;
  onError?: (error: unknown) => void;
}

const DEFAULT_FETCH_TIMEOUT_MS = 5_000;

export class CdpEndpoint {
  private readonly hostname: string;
  private readonly port: string;
  private readonly lookup: (hostname: string) => Promise<string>;

  constructor(private readonly options: CdpEndpointOptions) {
    const url = new URL(options.url);
    this.hostname = url.hostname;
    this.port = url.port || "80";
    this.lookup =
      options.lookup ?? (async (hostname) => (await dnsLookup(hostname, { family: 4 })).address);
  }

  async listTargets(): Promise<CdpTargetInfo[]> {
    const list = await this.getJson("/json/list");
    if (!Array.isArray(list)) throw new CdpUnreachableError("CDP /json/list did not return a list");
    const targets: CdpTargetInfo[] = [];
    for (const entry of list) {
      if (typeof entry !== "object" || entry === null) continue;
      const record = entry as Record<string, unknown>;
      if (record.type !== "page" || typeof record.id !== "string") continue;
      const target: CdpTargetInfo = {
        id: record.id,
        type: "page",
        url: typeof record.url === "string" ? record.url : "",
        title: typeof record.title === "string" ? record.title : "",
      };
      if (typeof record.openerId === "string") target.openerId = record.openerId;
      targets.push(target);
    }
    return targets;
  }

  async connectBrowser(): Promise<CdpConnection> {
    const version = await this.getJson("/json/version");
    const advertised =
      typeof version === "object" && version !== null
        ? (version as Record<string, unknown>).webSocketDebuggerUrl
        : undefined;
    if (typeof advertised !== "string") {
      throw new CdpUnreachableError("CDP /json/version has no webSocketDebuggerUrl");
    }
    let path: string;
    try {
      // Chrome advertises ws://127.0.0.1:9222/...; only the path is valid from here.
      path = new URL(advertised).pathname;
    } catch (error) {
      throw new CdpUnreachableError(
        `CDP /json/version has a bad webSocketDebuggerUrl: ${describe(error)}`,
      );
    }
    return this.connect(path);
  }

  connectTarget(targetId: string): Promise<CdpConnection> {
    return this.connect(`/devtools/page/${encodeURIComponent(targetId)}`);
  }

  /** `ip:port`, resolved now. Docker changes a container's IP on restart, so nothing caches this. */
  private async origin(): Promise<string> {
    if (this.hostname === "localhost" || isIP(this.hostname) !== 0)
      return `${this.hostname}:${this.port}`;
    try {
      return `${await this.lookup(this.hostname)}:${this.port}`;
    } catch (error) {
      throw new CdpUnreachableError(`Cannot resolve ${this.hostname}: ${describe(error)}`);
    }
  }

  private async getJson(path: string): Promise<unknown> {
    const origin = await this.origin();
    try {
      // Connecting to the IP makes the Host header an IP, which is the only kind Chrome accepts.
      const response = await fetch(`http://${origin}${path}`, {
        signal: AbortSignal.timeout(this.options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      throw new CdpUnreachableError(`CDP ${path} failed: ${describe(error)}`);
    }
  }

  private async connect(path: string): Promise<CdpConnection> {
    const origin = await this.origin();
    try {
      return await CdpConnection.open({
        url: `ws://${origin}${path}`,
        commandTimeoutMs: this.options.commandTimeoutMs,
        connectTimeoutMs: this.options.fetchTimeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS,
        onError: this.options.onError,
      });
    } catch (error) {
      throw new CdpUnreachableError(describe(error));
    }
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
