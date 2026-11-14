import type { FileRow, ViewEvent } from "../shared/contracts.js";

export type Tone = "muted" | "warning" | "danger";
export type Tokens = Extract<ViewEvent, { type: "tokens" }>["tokens"];

const STATUS: Record<FileRow["status"], string> = {
  stopped: "Closed",
  starting: "Opening...",
  running: "Open",
  failed: "Failed",
};

export function rowLabel(row: FileRow): { title: string; detail: string; tone: Tone } {
  if (row.status === "failed") {
    return { title: row.name, detail: row.error ?? "Failed", tone: "danger" };
  }
  if (row.outOfStep) {
    return {
      title: row.name,
      detail: `${STATUS[row.status]} · tokens differ from design/tokens.json`,
      tone: "warning",
    };
  }
  return { title: row.name, detail: STATUS[row.status], tone: "muted" };
}

/** The line under the editor's header about the project's tokens, or null when all is well. */
export function tokensBanner(
  tokens: Tokens | null,
  written: boolean,
): { text: string; tone: Tone } | null {
  if (written || tokens?.status === "written-back") {
    return { text: "Token edits written to design/tokens.json, not committed", tone: "muted" };
  }
  if (tokens?.status === "default") {
    return { text: "Paseo's tokens: this repo has no design/tokens.json", tone: "muted" };
  }
  if (tokens?.status === "refused") {
    return { text: `Tokens not loaded: ${tokens.reason}`, tone: "warning" };
  }
  if (tokens?.status === "imported" && tokens.warnings.length > 0) {
    const count = tokens.warnings.length;
    return {
      text: `${count} ${count === 1 ? "token" : "tokens"} kept out of FigCraft: ${tokens.warnings[0]}`,
      tone: "muted",
    };
  }
  return null;
}

export interface PointerFacts {
  anyCoarse: boolean;
  touchPoints: number;
}

/** As the office's: the apps are touch; web is touch with a coarse pointer or touch points. */
export function hasTouchScreen(
  platform: "ios" | "android" | "web",
  pointer: PointerFacts | null,
): boolean {
  if (platform !== "web") return true;
  return pointer !== null && (pointer.anyCoarse || pointer.touchPoints > 0);
}

// Web only: asked when layout.platform is "web", never at module top level.
export function readPointer(): PointerFacts | null {
  if (typeof window === "undefined") return null;
  return {
    anyCoarse:
      typeof window.matchMedia === "function" && window.matchMedia("(any-pointer: coarse)").matches,
    touchPoints: typeof navigator === "undefined" ? 0 : (navigator.maxTouchPoints ?? 0),
  };
}
