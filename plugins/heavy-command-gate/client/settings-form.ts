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

const LINE_MESSAGE = "write the estimate in GB, a space, then the command";
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
