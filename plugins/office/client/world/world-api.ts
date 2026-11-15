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
  subs: never[];
}

/** Something a person did; `type` is a key of the scene's action table. */
export interface WorldEvent {
  sess: string;
  type: WorldEventType;
  label: string;
}

export type WorldEventType =
  | "prompt"
  | "stop"
  | "fail"
  | "read"
  | "grep"
  | "edit"
  | "write"
  | "bash"
  | "web"
  | "mcp"
  | "agent"
  | "plan"
  | "compact"
  | "commit"
  | "push"
  | "deploy"
  | "other";

export interface WorldBoardRow {
  id: string;
  name: string;
  text: string;
  state: "doing" | "wait" | "done";
}

export type WorldColors = PluginTheme["colors"];

export interface WorldStartOptions {
  plan: "pro" | "cozy";
  dark: boolean;
  colors: WorldColors;
  onSelect(agentId: string | null): void;
  /** A team's chip was chosen, or the whiteboard (null). */
  onBoard(project: string | null): void;
  onProblem(message: string): void;
  /** The server racks were chosen. Without it they are furniture: no hand, no tap. */
  onMachine?(): void;
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
    typeof api.select === "function"
  );
}
