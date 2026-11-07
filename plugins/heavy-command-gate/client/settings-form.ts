import { gateSettings, type GateSettings, type HeavyPattern } from "../shared/settings.js";

/** What the Limits screen edits, as typed. */
export interface SettingsDraft {
  slots: string;
  reserveGb: string;
  /** One "<estimate GB> <command words>" per line. */
  patterns: string;
}

export interface DraftErrors {
  slots: string | null;
  reserveGb: string | null;
  /** One "Line N: ..." per problem, in line order. */
  patterns: string | null;
}

export type DraftResult = { ok: true; values: GateSettings } | { ok: false; errors: DraftErrors };

interface LineError {
  line: number;
  message: string;
}

const LINE_MESSAGE = "Write the estimate in GB, a space, then the command";
const PATTERN_LINE = /^(\S+)\s+(.+)$/;

export function formatPatterns(patterns: readonly HeavyPattern[]): string {
  return patterns.map((pattern) => `${pattern.estimateGb} ${pattern.command}`).join("\n");
}

export function toDraft(values: GateSettings): SettingsDraft {
  return {
    slots: String(values.slots),
    reserveGb: String(values.reserveGb),
    patterns: formatPatterns(values.patterns),
  };
}

// An empty field is not 0: NaN fails the schema's number check with the field's own message.
function toNumber(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? Number.NaN : Number(trimmed);
}

/** Validates the draft with the settings schema itself, so the screen and the store agree. */
export function parseDraft(draft: SettingsDraft, enabled: boolean): DraftResult {
  const lineErrors: LineError[] = [];
  const patterns: { command: string; estimateGb: number }[] = [];
  const lineNumbers: number[] = [];
  for (const [index, raw] of draft.patterns.split("\n").entries()) {
    const text = raw.trim();
    if (text === "" || text.startsWith("#")) continue;
    const match = PATTERN_LINE.exec(text);
    if (match === null) {
      lineErrors.push({ line: index + 1, message: LINE_MESSAGE });
      continue;
    }
    patterns.push({ estimateGb: toNumber(match[1]), command: match[2] });
    lineNumbers.push(index + 1);
  }
  const result = gateSettings.schema.safeParse({
    enabled,
    slots: toNumber(draft.slots),
    reserveGb: toNumber(draft.reserveGb),
    patterns,
  });
  if (result.success && lineErrors.length === 0) return { ok: true, values: result.data };
  const errors: DraftErrors = { slots: null, reserveGb: null, patterns: null };
  let listError: string | null = null;
  for (const issue of result.success ? [] : result.error.issues) {
    const [field, index] = issue.path;
    if (field === "slots") errors.slots ??= issue.message;
    else if (field === "reserveGb") errors.reserveGb ??= issue.message;
    else if (field === "patterns" && typeof index === "number") {
      lineErrors.push({ line: lineNumbers[index], message: issue.message });
    } else if (field === "patterns") listError = issue.message;
  }
  const lines = lineErrors
    .sort((a, b) => a.line - b.line)
    .map((error) => `Line ${error.line}: ${error.message}`);
  if (listError !== null) lines.unshift(listError);
  errors.patterns = lines.length === 0 ? null : lines.join("\n");
  return { ok: false, errors };
}

/** The settings requests the Limits screen starts. */
export type RequestKind = "save" | "reset";

/**
 * What `useSettings` reports. A save and a reset share one request object, so they share one
 * `saving` and one `saveError`.
 */
export interface RequestState {
  saving: boolean;
  saveError: string | null;
}

/** An edit in progress. */
export interface EditorDraft extends SettingsDraft {
  /** The revision the edit started from, so saving over another client's save is a conflict. */
  revision: string;
}

export interface EditorState {
  /** null: the fields show the saved settings and follow other clients' saves. */
  draft: EditorDraft | null;
  /** Bumped by Discard and Reset, so the uncontrolled inputs remount with the saved values. */
  generation: number;
  /** The request that `saving` and `saveError` describe; null before the first one. */
  lastRequest: RequestKind | null;
}

export type EditorAction =
  | { type: "edit"; patch: Partial<SettingsDraft>; saved: SettingsDraft; revision: string }
  | { type: "save-started" }
  | { type: "save-succeeded" }
  | { type: "discard" }
  | { type: "reset-started" };

export const INITIAL_EDITOR_STATE: EditorState = { draft: null, generation: 0, lastRequest: null };

export function editorReducer(state: EditorState, action: EditorAction): EditorState {
  switch (action.type) {
    case "edit": {
      // Only the first edit reads the saved text and revision; later edits keep the draft's own.
      const start: EditorDraft = { ...action.saved, revision: action.revision };
      return { ...state, draft: { ...(state.draft ?? start), ...action.patch } };
    }
    case "save-started":
      return { ...state, lastRequest: "save" };
    case "save-succeeded":
      return { ...state, draft: null };
    case "discard":
      // Discarding reloads the settings, which clears the request's progress and error.
      return { draft: null, generation: state.generation + 1, lastRequest: null };
    case "reset-started":
      return { draft: null, generation: state.generation + 1, lastRequest: "reset" };
  }
}

/** What an action row shows: the label of its button and the error under its title. */
export interface ActionRow {
  actionLabel: string;
  error: string | null;
}

/** Save shows the shared request's progress and error only when a save was the last request. */
export function saveRow(lastRequest: RequestKind | null, request: RequestState): ActionRow {
  const mine = lastRequest === "save";
  return {
    actionLabel: mine && request.saving ? "Saving..." : "Save",
    error: mine ? request.saveError : null,
  };
}

/**
 * Restore defaults shows the shared request's progress and error only when a reset was the last
 * request. Between its two presses the button reads "Confirm reset".
 */
export function resetRow(
  lastRequest: RequestKind | null,
  request: RequestState,
  armed: boolean,
): ActionRow {
  const mine = lastRequest === "reset";
  const idle = armed ? "Confirm reset" : "Reset";
  return {
    actionLabel: mine && request.saving ? "Resetting..." : idle,
    error: mine ? request.saveError : null,
  };
}
