import { startMcpStdioClient, type McpStdioClient } from "./mcp-stdio-client.js";

// Typed calls to one `figcraft-cli mcp` child. The shapes follow what FigCraft 0.18.1 answered in
// the contract test (test/fixtures/, differences from its docs in test/README.md).

export interface SessionStartOptions {
  command: string;
  args: readonly string[];
  env: Record<string, string>;
  runDir: string;
  /** Pid-file name; never a file name or link. */
  name: string;
  startTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export interface PeersState {
  status: string;
  /** The other members of the live session; FigCraft does not list the caller. */
  peers: { id: string; name: string; selection: string[] }[];
}

export interface CommentThread {
  id: string;
  status: "open" | "resolved";
  author: string;
  agent: boolean;
  preview: string;
}

export interface Picture {
  mimeType: string;
  data: string;
  width: number;
  height: number;
}

export interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RawPeers {
  status?: unknown;
  reason?: unknown;
  published?: { edit?: unknown; view?: unknown; owner?: unknown } | null;
  peers?: { id?: unknown; name?: unknown; presence?: { selection?: unknown[] } }[];
}

const POLL_MS = 200;
const POLLS = 50;

/** FigCraft's layer and comment ids are numbers; Paseo carries them as strings. */
function figcraftId(id: string): number | string {
  return /^\d+$/.test(id) ? Number(id) : id;
}

function parseText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms).unref());
}

export class FigcraftSession {
  private constructor(private readonly client: McpStdioClient) {}

  static async start(options: SessionStartOptions): Promise<FigcraftSession> {
    const client = await startMcpStdioClient(
      { command: options.command, args: options.args, env: options.env },
      {
        runDir: options.runDir,
        name: options.name,
        procRoot: "/proc",
        baseEnv: process.env,
        startTimeoutMs: options.startTimeoutMs ?? 20_000,
        requestTimeoutMs: options.requestTimeoutMs ?? 60_000,
      },
    );
    return new FigcraftSession(client);
  }

  get closed(): boolean {
    return this.client.closed;
  }

  onExit(listener: (reason: string) => void): void {
    this.client.onExit(listener);
  }

  private async tool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const result = await this.client.callToolRaw(name, args);
    if (result.isError) throw new Error(result.text || `${name} failed`);
    return parseText(result.text);
  }

  private command(command: string, params: Record<string, unknown> = {}): Promise<unknown> {
    return this.tool("run_command", { command, params });
  }

  /** The name other members see. Must run before publish or join, or FigCraft says "Guest N". */
  async setName(name: string): Promise<void> {
    await this.command("pref.userName", { name });
  }

  /** Polls collab.peers until the session is live and `done` holds; publish and join return at once. */
  private async untilLive(what: string, done: (peers: RawPeers) => boolean): Promise<RawPeers> {
    for (let i = 0; i < POLLS; i++) {
      const peers = (await this.command("collab.peers")) as RawPeers;
      if (peers.status === "live" && done(peers)) return peers;
      if (peers.status === "failed" || peers.status === "closed") {
        throw new Error(`FigCraft could not ${what}: ${String(peers.reason ?? peers.status)}`);
      }
      await sleep(POLL_MS);
    }
    throw new Error(`FigCraft did not ${what} within ${(POLL_MS * POLLS) / 1000} seconds`);
  }

  async publish(serverWithKey: string, name: string) {
    await this.command("collab.publish", { server: serverWithKey, name });
    const live = await this.untilLive(
      "publish the file",
      (peers) => typeof peers.published?.edit === "string",
    );
    const published = live.published ?? {};
    const editLink = String(published.edit);
    return {
      editLink,
      viewLink: typeof published.view === "string" ? published.view : editLink,
      ownerToken: typeof published.owner === "string" ? published.owner : null,
    };
  }

  async join(link: string): Promise<void> {
    await this.command("collab.join", { link });
    await this.untilLive("join the file", () => true);
  }

  async peers(): Promise<PeersState> {
    const answer = (await this.command("collab.peers")) as RawPeers;
    return {
      status: String(answer.status ?? "unknown"),
      peers: (answer.peers ?? []).map((peer) => ({
        id: String(peer.id),
        name: String(peer.name ?? ""),
        selection: (peer.presence?.selection ?? []).map(String),
      })),
    };
  }

  async importVariables(json: unknown): Promise<{ warnings: string[] }> {
    const answer = (await this.command("variable.import", { variables: json })) as {
      warnings?: string[];
    };
    return { warnings: answer.warnings ?? [] };
  }

  /** Deletes a variable collection; layers bound to its variables keep their values. */
  async deleteCollection(id: string): Promise<void> {
    await this.command("variable.deleteCollection", { collection: id });
  }

  /** The local-variables JSON; FigCraft wraps it in `text`. */
  async exportVariables(): Promise<unknown> {
    const answer = (await this.command("variable.export", { format: "json" })) as { text?: string };
    if (typeof answer.text !== "string") throw new Error("FigCraft exported no variables");
    return JSON.parse(answer.text) as unknown;
  }

  async comments(): Promise<CommentThread[]> {
    const answer = (await this.command("comment.list", { page: "all", filter: "all" })) as {
      comments?: {
        id?: unknown;
        resolved?: unknown;
        author?: unknown;
        agent?: unknown;
        text?: unknown;
      }[];
    };
    return (answer.comments ?? []).map((c) => ({
      id: String(c.id),
      status: c.resolved === true ? "resolved" : "open",
      author: String(c.author ?? ""),
      agent: c.agent === true,
      preview: String(c.text ?? ""),
    }));
  }

  async addComment(x: number, y: number, text: string): Promise<string> {
    const answer = (await this.command("comment.add", { x, y, text })) as { id: unknown };
    return String(answer.id);
  }

  /** FigCraft's Markdown task brief for these threads. */
  async commentPrompt(ids: string[]): Promise<string> {
    const answer = (await this.command("comment.prompt", { ids: ids.map(figcraftId) })) as {
      text: string;
    };
    return answer.text;
  }

  async code(id: string): Promise<string> {
    const answer = (await this.command("inspect.code", {
      id: figcraftId(id),
      language: "tailwind",
    })) as { code?: unknown };
    return String(answer.code ?? "");
  }

  /** The layers, or the current page; null when the page has nothing to render. */
  async screenshot(ids?: string[], maxSize = 1600): Promise<Picture | null> {
    const result = await this.client.callToolRaw(
      "screenshot",
      ids ? { ids: ids.map(figcraftId), maxSize } : { maxSize },
    );
    if (result.isError && /is empty/.test(result.text)) return null;
    const image = result.images[0];
    if (result.isError || !image) throw new Error(result.text || "FigCraft returned no picture");
    const size = parseText(result.text) as { width?: number; height?: number };
    return { ...image, width: Number(size.width ?? 0), height: Number(size.height ?? 0) };
  }

  /** The current page's picture area: the union of its top-level layers, as the page screenshot. */
  async pageBounds(): Promise<Bounds | null> {
    const doc = (await this.tool("inspect_document", { depth: 1 })) as {
      currentPage?: unknown;
      pages?: { id?: unknown; children?: { absoluteBounds?: Bounds }[] }[];
    };
    const page = doc.pages?.find((p) => p.id === doc.currentPage) ?? doc.pages?.[0];
    const boxes = (page?.children ?? []).flatMap((child) =>
      child.absoluteBounds ? [child.absoluteBounds] : [],
    );
    if (boxes.length === 0) return null;
    const x = Math.min(...boxes.map((b) => b.x));
    const y = Math.min(...boxes.map((b) => b.y));
    const right = Math.max(...boxes.map((b) => b.x + b.width));
    const bottom = Math.max(...boxes.map((b) => b.y + b.height));
    return { x, y, width: right - x, height: bottom - y };
  }

  close(): Promise<void> {
    return this.client.close();
  }
}
