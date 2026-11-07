import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

/** One GB in these settings is 2^30 bytes, the unit the memory readings are converted from. */
export const GIB = 1024 ** 3;

export const SLOTS_MESSAGE = "Slots must be a whole number from 1 to 16";
export const RESERVE_MESSAGE = "Reserve must be a number of GB from 0 to 64";
export const ESTIMATE_MESSAGE = "Estimate must be a number of GB from 0.1 to 1024";
export const COMMAND_MESSAGE =
  "Command must be words separated by single spaces, none starting with a dash";
export const PATTERNS_MESSAGE = "List at most 100 heavy commands";

// The shim compares words after it drops options, so a pattern holds no option words.
const COMMAND_WORDS = /^[^\s-]\S*(?: [^\s-]\S*)*$/;

export const HeavyPatternSchema = z.object({
  command: z.string().regex(COMMAND_WORDS, COMMAND_MESSAGE),
  estimateGb: z.number(ESTIMATE_MESSAGE).min(0.1, ESTIMATE_MESSAGE).max(1024, ESTIMATE_MESSAGE),
});

export type HeavyPattern = z.output<typeof HeavyPatternSchema>;

interface PatternList {
  patterns: HeavyPattern[];
}

/** The spec's defaults. A function, so every parse gets an array of its own. */
export function defaultPatterns(): HeavyPattern[] {
  return [
    { command: "tsc", estimateGb: 3 },
    { command: "tsgo", estimateGb: 3 },
    { command: "npm run typecheck", estimateGb: 3 },
    { command: "expo export", estimateGb: 3 },
    { command: "vitest", estimateGb: 2 },
    { command: "jest", estimateGb: 2 },
    { command: "npm test", estimateGb: 2 },
    { command: "gradle", estimateGb: 2 },
    { command: "gradlew", estimateGb: 2 },
    { command: "npm ci", estimateGb: 1.5 },
    { command: "npm install", estimateGb: 1.5 },
  ];
}

function rejectDuplicatePatterns(values: PatternList, context: z.RefinementCtx): void {
  const seen = new Set<string>();
  for (const [index, pattern] of values.patterns.entries()) {
    if (seen.has(pattern.command)) {
      context.addIssue({
        code: "custom",
        path: ["patterns", index, "command"],
        message: `Command "${pattern.command}" is listed more than once`,
      });
    }
    seen.add(pattern.command);
  }
}

const SettingsSchema = z
  .object({
    enabled: z.boolean().default(true),
    slots: z
      .number(SLOTS_MESSAGE)
      .int(SLOTS_MESSAGE)
      .min(1, SLOTS_MESSAGE)
      .max(16, SLOTS_MESSAGE)
      .default(1),
    reserveGb: z
      .number(RESERVE_MESSAGE)
      .min(0, RESERVE_MESSAGE)
      .max(64, RESERVE_MESSAGE)
      .default(1),
    patterns: z.array(HeavyPatternSchema).max(100, PATTERNS_MESSAGE).default(defaultPatterns),
  })
  .superRefine(rejectDuplicatePatterns);

export type GateSettingsSchema = typeof SettingsSchema;
export type GateSettings = z.output<GateSettingsSchema>;

export const gateSettings = defineSettings({
  id: "gate",
  scope: "host",
  version: 1,
  schema: SettingsSchema,
});

export function gbToBytes(gb: number): number {
  return Math.round(gb * GIB);
}
