import type { Bounds, CommentThread, FigcraftSession, Picture } from "./figcraft-session.js";
import type { DesignFile } from "./files-store.js";
import { CLIENT_NAME } from "./mcp-stdio-client.js";
import { fromVariables, sameTokens, toVariables, TokensError, type TokenFile } from "./tokens.js";

export interface TokensPort {
  /** The workspace's design/tokens.json, or null when the repo has none. Throws on bad JSON. */
  read(): Promise<TokenFile | null>;
  write(file: TokenFile): Promise<void>;
  /** Paseo's design system as FigCraft variables, for a repo without tokens; null when not shipped. */
  defaults(): Promise<unknown | null>;
}

export type TokensState =
  | { status: "none" }
  | { status: "imported"; warnings: string[] }
  /** The repo has no tokens file: the Tokens collection holds Paseo's, edited only in FigCraft. */
  | { status: "default" }
  | { status: "refused"; reason: string }
  | { status: "written-back" };

/** What the user's editor and the other members see the bridge as. */
const BRIDGE_NAME = "Paseo (agent)";
/**
 * FigCraft flags every comment made over MCP as an agent's and signs it with the client's name.
 * Comments the user makes on the phone go through the bridge, so they carry this author.
 */
export const BRIDGE_AUTHOR = `${CLIENT_NAME} (agent)`;
const AGENT_NAME = / \(agent\)$/;
const MAX_CODE_LAYERS = 3;

function hasTokensCollection(exported: unknown): boolean {
  const collections = (exported as { meta?: { variableCollections?: object } }).meta
    ?.variableCollections;
  return Object.values(collections ?? {}).some(
    (collection) => (collection as { name?: unknown }).name === "Tokens",
  );
}

export class Bridge {
  tokens: TokensState = { status: "none" };
  private repoTokens: TokenFile | null = null;

  private constructor(
    private readonly session: FigcraftSession,
    private readonly port: TokensPort,
    private readonly log: (line: string) => void,
    private readonly fileId: string,
  ) {}

  /** Joins the file's live session, then loads the repo's tokens: the repo wins on open. */
  static async open(options: {
    session: FigcraftSession;
    file: DesignFile;
    tokens: TokensPort;
    log(line: string): void;
  }): Promise<Bridge> {
    const bridge = new Bridge(options.session, options.tokens, options.log, options.file.id);
    try {
      await options.session.setName(BRIDGE_NAME);
      await options.session.join(options.file.secrets.editLink);
    } catch (error) {
      await options.session.close();
      throw new Error(`Could not open the design: ${(error as Error).message}`, { cause: error });
    }
    await bridge.importTokens();
    return bridge;
  }

  private async importTokens(): Promise<void> {
    let file: TokenFile | null;
    try {
      file = await this.port.read();
    } catch (error) {
      this.refuse(`design/tokens.json is not valid JSON (${(error as Error).message})`);
      return;
    }
    if (file === null) {
      await this.importDefaults();
      return;
    }
    try {
      const { variables, warnings } = toVariables(file);
      const answer = await this.session.importVariables(variables);
      this.repoTokens = file;
      this.tokens = { status: "imported", warnings: [...warnings, ...answer.warnings] };
    } catch (error) {
      this.refuse(
        error instanceof TokensError
          ? error.message
          : `FigCraft refused the tokens: ${(error as Error).message}`,
      );
    }
  }

  /** Paseo's tokens, unless the file already has a Tokens collection: edits to it live only there. */
  private async importDefaults(): Promise<void> {
    try {
      const defaults = await this.port.defaults();
      if (defaults === null) return;
      if (!hasTokensCollection(await this.session.exportVariables())) {
        await this.session.importVariables(defaults);
      }
      this.tokens = { status: "default" };
    } catch (error) {
      this.refuse(`FigCraft refused Paseo's tokens: ${(error as Error).message}`);
    }
  }

  private refuse(reason: string): void {
    this.tokens = { status: "refused", reason };
    this.log(`[design] tokens not imported for ${this.fileId}: ${reason}`);
  }

  /** What the people in the file have selected; agents' members are named "<name> (agent)". */
  async userSelection(): Promise<string[]> {
    const { peers } = await this.session.peers();
    const people = peers.filter((peer) => !AGENT_NAME.test(peer.name));
    return [...new Set(people.flatMap((peer) => peer.selection))];
  }

  /** The layers, or the current page; null when the page is empty. */
  picture(ids?: string[]): Promise<Picture | null> {
    return this.session.screenshot(ids, 1600);
  }

  pageBounds(): Promise<Bounds | null> {
    return this.session.pageBounds();
  }

  async outOfStep(): Promise<boolean> {
    if (this.repoTokens === null) return false;
    return !sameTokens(this.repoTokens, await this.session.exportVariables());
  }

  /** Writes FigCraft's token edits to the repo (uncommitted). True when the file changed. */
  async syncTokensBack(): Promise<boolean> {
    if (this.repoTokens === null) return false;
    const exported = await this.session.exportVariables();
    if (sameTokens(this.repoTokens, exported)) return false;
    const next = fromVariables(exported, this.repoTokens);
    await this.port.write(next);
    this.repoTokens = next;
    this.tokens = { status: "written-back" };
    return true;
  }

  /** Open threads by people: not by an agent, or made from the phone through this bridge. */
  async openThreads(): Promise<CommentThread[]> {
    return (await this.session.comments()).filter(
      (thread) => thread.status === "open" && (!thread.agent || thread.author === BRIDGE_AUTHOR),
    );
  }

  commentPrompt(ids: string[]): Promise<string> {
    return this.session.commentPrompt(ids);
  }

  async addComment(x: number, y: number, text: string): Promise<void> {
    await this.session.addComment(x, y, text);
  }

  async code(ids: string[]): Promise<string> {
    const parts: string[] = [];
    for (const id of ids.slice(0, MAX_CODE_LAYERS)) {
      parts.push(`// layer ${id}\n${await this.session.code(id)}`);
    }
    if (ids.length > MAX_CODE_LAYERS) {
      parts.push(`// ${ids.length - MAX_CODE_LAYERS} more layers not exported`);
    }
    return parts.join("\n\n");
  }

  onExit(listener: (reason: string) => void): void {
    this.session.onExit(listener);
  }

  close(): Promise<void> {
    return this.session.close();
  }
}
