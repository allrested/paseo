import { defineSettings } from "@getpaseo/plugin";
import { z } from "zod";

export const MAX_NAME = 40;
export const MAX_TEXT = 20_000;
export const MAX_PROMPTS = 100;

// The messages are what the picker and the settings screen show, so each says what to change.
export const PromptSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Give the prompt a name")
    .max(MAX_NAME, `A name has at most ${MAX_NAME} characters`)
    .refine((name) => !/[\r\n]/.test(name), "A name is one line"),
  // Kept as written: a prompt's blank lines and indentation are part of it.
  text: z
    .string()
    .max(MAX_TEXT, `A prompt has at most ${MAX_TEXT.toLocaleString("en-US")} characters`)
    .refine((text) => text.trim().length > 0, "A prompt needs some text"),
});

export type Prompt = z.output<typeof PromptSchema>;

const ValuesSchema = z.object({
  prompts: z
    .array(PromptSchema)
    .max(MAX_PROMPTS, `The list holds at most ${MAX_PROMPTS} prompts`)
    .default([]),
});

export type SavedPrompts = z.output<typeof ValuesSchema>;

// "/prompt review" must mean one prompt, so names differ by more than case.
function rejectSameNames(values: SavedPrompts, context: z.RefinementCtx): void {
  const seen = new Map<string, string>();
  for (const [index, prompt] of values.prompts.entries()) {
    const key = prompt.name.toLowerCase();
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, prompt.name);
    } else {
      context.addIssue({
        code: "custom",
        path: ["prompts", index, "name"],
        message: `A prompt named "${first}" exists already`,
      });
    }
  }
}

/** One list for the host, so the web app and the phone on it show the same prompts. */
export const savedPromptsSettings = defineSettings({
  id: "prompts",
  scope: "host",
  version: 1,
  schema: ValuesSchema.superRefine(rejectSameNames),
});
