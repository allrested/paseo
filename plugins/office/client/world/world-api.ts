import type { PluginTheme } from "@getpaseo/plugin";

/**
 * The plugin's side of the page that draws the 3D office. The page's side is
 * vendor/my-office/src/office/paseo-entry.js, which sets `PaseoOfficeWorld` on its window.
 */

/** A person in the office, in the shape the vendored scene reads. */
export interface WorldSession {
  id: string;
  name: string;
  title: string;
  /** The project's folder; the scene seats a project's people together. */
  dir: string;
  git: { repo: string };
  /** At work, waiting for the user's answer, or resting. */
  status: "work" | "wait" | "rest";
  /** Which mark the scene puts on the person's screen. */
  agent: "claude" | "codex" | "gemini";
  lastPrompt: string;
  /** A red name tag: the agent ended in an error. */
  stuck: boolean;
  /**
   * How many sub-agents the agent waits on, set when its own turn has ended and they are still
   * at work: `status` is `work` then. Paseo's own: upstream's scene does not read it;
   * Paseo's `paseo-entry.js` does, for the `subwait` bubble.
   */
  waitingOn?: number;
  subs: never[];
  /**
   * The context window, in tokens: the paper on the desk grows with it, and a flag stands in it
   * from 85%. Absent when the provider has not said.
   */
  usage?: { ctx: number; ctxMax: number };
}

/**
 * Something a person did; `type` is a key of the scene's action table. No text goes with it:
 * the scene says "a file" and "a command", never which.
 */
export interface WorldEvent {
  sess: string;
  type: WorldEventType;
  /** On a `fail` that is not the agent's own: what failed. The scene words the bubble by it. */
  of?: "deploy";
}

export type WorldEventType =
  | "prompt"
  | "stop"
  | "fail"
  | "read"
  | "grep"
  /** A skill was opened, read or written: upstream's action for it is at the library. */
  | "skill"
  | "edit"
  | "write"
  | "bash"
  | "web"
  | "mcp"
  | "agent"
  | "plan"
  | "test"
  | "commit"
  | "push"
  | "deploy"
  | "testok"
  | "testfail"
  | "testend"
  /** The conversation was compacted or started over: the person takes the paper to the shredder. */
  | "compact"
  /** Paseo's own: the agent's turn has ended and it waits at its desk on its sub-agents. */
  | "subwait";

export interface WorldBoardRow {
  id: string;
  name: string;
  text: string;
  state: "doing" | "wait" | "done";
}

/** Something an agent left listening, as the scene draws it: a small server box. */
export interface WorldDevServer {
  /** Whose it is. Not alive: forgotten, so the box stands in the server room with a red light. */
  owner: { alive: boolean; sid: string };
  /** The box's tooltip starts with it. */
  label: string;
  ports: number[];
  cpu: number;
}

/** The host's readings, in the shape the scene's wall screen, racks and boxes read. */
export interface WorldMachine {
  mem: { used: number; total: number; pressure: "normal" | "critical" } | null;
  cpu: { percent: number };
  devServers: WorldDevServer[];
}

export type WorldColors = PluginTheme["colors"];

/** What the lobby's sign and the reception's plaque show. */
export interface WorldBrand {
  name: string;
  /** The logo's address in full; null draws the scene's own mark. */
  logoUrl: string | null;
}

export interface WorldStartOptions {
  plan: "pro" | "cozy";
  dark: boolean;
  colors: WorldColors;
  /** The lobby's sign. Absent: the scene's own. */
  brand?: WorldBrand;
  onSelect(agentId: string | null): void;
  /** A team's chip was chosen, or the whiteboard (null). */
  onBoard(project: string | null): void;
  onProblem(message: string): void;
  /** The server room was chosen: its chip, the racks, the wall screen or a server box. */
  onMachine?(): void;
  /** The library was chosen: its chip or the bookshelf. Absent: the scene's own card opens. */
  onLibrary?(): void;
  /** A short line the office says once. */
  onToast?(text: string): void;
}

export interface WorldApi {
  version: number;
  start(options: WorldStartOptions): void;
  /** Gives the graphics context back; the page is thrown away after it. */
  stop(): void;
  setTheme(theme: { dark: boolean; colors: WorldColors }): void;
  setSessions(sessions: readonly WorldSession[]): void;
  event(event: WorldEvent): void;
  select(agentId: string | null): void;
  focusProject(project: string): void;
  setBoardRows(rows: readonly WorldBoardRow[]): void;
  /**
   * The host's readings. With null the server room is furniture: no chip, no hand, no tap, and
   * the wall screen shows no memory.
   */
  setMachine(machine: WorldMachine | null): void;
  /**
   * Rings the bell on the meeting table for a stand-up: everyone free walks there and says what
   * they are on. Nothing happens while another gathering is on, or when nobody is free.
   */
  meet?(): void;
}

/** The version of the contract above; the page says which it speaks. */
export const WORLD_API_VERSION = 1;

export function isWorldApi(value: unknown): value is WorldApi {
  if (typeof value !== "object" || value === null) return false;
  const api = value as Partial<Record<keyof WorldApi, unknown>>;
  return (
    api.version === WORLD_API_VERSION &&
    typeof api.start === "function" &&
    typeof api.stop === "function" &&
    typeof api.setSessions === "function" &&
    typeof api.event === "function" &&
    typeof api.select === "function" &&
    typeof api.setMachine === "function"
  );
}
