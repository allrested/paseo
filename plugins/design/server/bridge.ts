import type {
  Bounds,
  CommentThread,
  FigcraftSession,
  Picture,
  RawLayer,
} from "./figcraft-session.js";
import type { Change, EditAction, EditResult, Layer } from "../shared/contracts.js";
import type { DesignFile } from "./files-store.js";
import { colorTokens, frontFirst, layerView } from "./layer-edit.js";
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
const MAX_FACT_LAYERS = 10;
/** Space between a frame and the picture of the running app placed beside it. */
const COMPARE_GAP = 40;
/** How deep under a selected layer to look for bound variables. */
const FACT_DEPTH = 8;
const GONE = "This layer is gone. Tap it again";

export interface SelectionFacts {
  layers: { id: string; name: string; width: number; height: number }[];
  tokens: string[];
}

function variableNames(exported: unknown): Map<string, string> {
  const variables = (exported as { meta?: { variables?: object } }).meta?.variables ?? {};
  return new Map(
    (Object.values(variables) as { id: string; name: string }[]).map((v) => [v.id, v.name]),
  );
}

/** Every variable id a layer or its children are bound to, wherever the binding sits. */
function boundIds(layer: RawLayer): string[] {
  const ids: string[] = [];
  const collect = (value: unknown): void => {
    if (typeof value === "string") ids.push(value);
    else if (Array.isArray(value)) value.forEach(collect);
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(layer.boundVariables);
  for (const child of layer.children ?? []) ids.push(...boundIds(child));
  return ids;
}

type RepoRead = { kind: "same" } | { kind: "bad" } | { kind: "file"; file: TokenFile | null };

interface ExportedCollection {
  id: string;
  name: string;
  modes: { name: string }[];
}

function tokensCollections(exported: unknown): ExportedCollection[] {
  const collections = (exported as { meta?: { variableCollections?: object } }).meta
    ?.variableCollections;
  return (Object.values(collections ?? {}) as ExportedCollection[]).filter(
    (collection) => collection.name === "Tokens",
  );
}

function hasTokensCollection(exported: unknown): boolean {
  return tokensCollections(exported).length > 0;
}

export class Bridge {
  tokens: TokensState = { status: "none" };
  private repoTokens: TokenFile | null = null;
  /** The repo file as last read (JSON), null for no file, or the reason it did not parse. */
  private lastSeen: string | null = null;

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
    const read = await this.readRepo();
    if (read.kind !== "file") return;
    const { file } = read;
    if (file === null) {
      await this.importDefaults();
      return;
    }
    await this.importRepo(file);
  }

  /**
   * Takes an edit of the repo's design/tokens.json made since the last read or write-back: the
   * repo wins, as on open. True when the tokens state changed, so viewers need it again.
   */
  async syncTokensFromRepo(): Promise<boolean> {
    const read = await this.readRepo();
    if (read.kind === "same") return false;
    if (read.kind === "bad") return true;
    if (read.file === null) {
      if (this.repoTokens === null) return false;
      // Deleted: FigCraft keeps the variables and nothing is written back any more.
      this.repoTokens = null;
      this.tokens = { status: "none" };
      return true;
    }
    await this.importRepo(read.file);
    return true;
  }

  /** The repo's file (null: it has none), unless it is as last seen or does not parse. */
  private async readRepo(): Promise<RepoRead> {
    let file: TokenFile | null;
    try {
      file = await this.port.read();
    } catch (error) {
      const reason = `design/tokens.json is not valid JSON (${(error as Error).message})`;
      if (this.lastSeen === reason) return { kind: "same" };
      this.lastSeen = reason;
      this.refuse(reason);
      return { kind: "bad" };
    }
    const seen = file === null ? null : JSON.stringify(file);
    if (seen !== null && seen === this.lastSeen) return { kind: "same" };
    this.lastSeen = seen;
    return { kind: "file", file };
  }

  private async importRepo(file: TokenFile): Promise<void> {
    try {
      const { variables, warnings } = toVariables(file);
      await this.dropPaseoTokens();
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

  /** Deletes Paseo's Tokens collection before the repo's own tokens go in: none of it may reach the repo. */
  private async dropPaseoTokens(): Promise<void> {
    const paseo = tokensCollections(await this.session.exportVariables()).filter(
      (collection) => collection.modes?.length > 1 && collection.modes[0]?.name === "Paseo",
    );
    for (const collection of paseo) await this.session.deleteCollection(collection.id);
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
  async picture(ids?: string[]): Promise<Picture | null> {
    // A headless member takes in the other members' edits only when it reads collab.peers.
    await this.session.peers();
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
    this.lastSeen = JSON.stringify(next);
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

  /** Each layer's size and the tokens bound in the layers and their children, by name. */
  async facts(ids: string[]): Promise<SelectionFacts> {
    const names = variableNames(await this.session.exportVariables());
    const layers: SelectionFacts["layers"] = [];
    const tokens = new Set<string>();
    for (const id of ids.slice(0, MAX_FACT_LAYERS)) {
      const layer = await this.session.layer(id, FACT_DEPTH);
      layers.push({
        id,
        name: String(layer.name ?? ""),
        width: Number(layer.width ?? 0),
        height: Number(layer.height ?? 0),
      });
      for (const variableId of boundIds(layer)) {
        const name = names.get(variableId);
        if (name) tokens.add(name);
      }
    }
    return { layers, tokens: [...tokens].sort() };
  }

  /** The phone's edits: one FigCraft command each, on the file as the others last left it. */
  async edit(action: EditAction): Promise<EditResult> {
    // A headless member takes in the other members' edits only when it reads collab.peers.
    await this.session.peers();
    if (action.type === "pick") return this.pick(action.x, action.y);
    let show: string | null;
    if (action.type === "layer") {
      show = action.id;
    } else if (action.type === "change") {
      show = await this.change(action.id, action.change);
    } else {
      await (action.type === "undo" ? this.session.undo() : this.session.redo());
      show = action.id;
    }
    const layer = show === null ? null : await this.view(show);
    if (layer === null && action.type === "layer") throw new Error(GONE);
    return { ok: true, layer, here: [], colors: [] };
  }

  /** The layers under a spot given as 0..1 of the picture, which is the page's top-level box. */
  private async pick(x: number, y: number): Promise<EditResult> {
    const page = await this.session.pageBounds();
    if (page === null) return { ok: true, layer: null, here: [], colors: [] };
    const here = frontFirst(
      await this.session.layersAt(page.x + x * page.width, page.y + y * page.height),
    );
    const exported = await this.session.exportVariables();
    const layer = here[0] ? await this.view(here[0].id, exported) : null;
    return { ok: true, layer, here, colors: colorTokens(exported) };
  }

  /** The layer to show afterwards: the copy after a duplicate, none after a delete. */
  private async change(id: string, change: Change): Promise<string | null> {
    if ((await this.find(id)) === null) throw new Error(GONE);
    switch (change.kind) {
      case "text":
        await this.session.setProperties(id, { characters: change.text });
        return id;
      case "fill":
        await this.session.setProperties(id, { fill: { $var: change.token } });
        return id;
      case "move":
        await this.session.nudge(id, change.dx, change.dy);
        return id;
      case "resize":
        await this.session.nudgeSize(id, change.dw, change.dh);
        return id;
      case "duplicate":
        return this.session.duplicate(id);
      case "delete":
        await this.session.remove(id);
        return null;
    }
  }

  private async find(id: string): Promise<RawLayer | null> {
    try {
      return await this.session.node(id);
    } catch (error) {
      if (/no such node/i.test((error as Error).message)) return null;
      throw error;
    }
  }

  private async view(id: string, exported?: unknown): Promise<Layer | null> {
    const raw = await this.find(id);
    if (raw === null) return null;
    const names = variableNames(exported ?? (await this.session.exportVariables()));
    return layerView(id, raw, await this.session.pageBounds(), names);
  }

  /** Places a picture of the running app right of a frame, at the frame's width. */
  async compare(
    frame: string,
    image: string,
    now: Date,
  ): Promise<{ id: string; name: string; frame: string }> {
    const layer = await this.session.layer(frame, 0);
    const box = layer.absoluteBounds;
    if (!box) throw new Error(`Layer ${frame} has no bounds on the page`);
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    const name = `Running app ${time}`;
    const id = await this.session.placeImage({
      path: image,
      x: box.x + box.width + COMPARE_GAP,
      y: box.y,
      width: box.width,
      name,
    });
    return { id, name, frame: String(layer.name ?? "") };
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
