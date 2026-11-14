// "/prompt <name>": the composer is already cleared when this runs, so the prompt replaces it.
import type { PluginComposer } from "@getpaseo/plugin/client";
import { findPrompt } from "../shared/prompts.js";
import type { Prompt } from "../shared/settings.js";
import { stored, type ReadResult } from "./store.js";

const MAX_LISTED = 8;

interface InsertInput {
  /** What the user typed after the command name. */
  args: string;
  read(): Promise<ReadResult>;
  composer: Pick<PluginComposer, "setPrompt" | "focus"> | undefined;
}

function listed(names: readonly string[]): string {
  const shown = names.slice(0, MAX_LISTED).join(", ");
  const more = names.length - MAX_LISTED;
  return more > 0 ? `${shown} and ${more} more` : shown;
}

function choose(prompts: readonly Prompt[], args: string): Prompt {
  if (prompts.length === 0) {
    throw new Error("No saved prompts yet. Add one in Settings, under Saved prompts");
  }
  const found = findPrompt(prompts, args);
  if (found.status === "found") return found.prompt;
  if (found.status === "several") {
    throw new Error(`"${args}" starts several saved prompts: ${listed(found.names)}`);
  }
  const saved = `Saved: ${listed(prompts.map((prompt) => prompt.name))}`;
  throw new Error(
    args === ""
      ? `Type a name after /prompt. ${saved}`
      : `No saved prompt starts with "${args}". ${saved}`,
  );
}

/** Rejects with a sentence for the user; Paseo shows it as the command's error. */
export async function insertSavedPrompt({ args, read, composer }: InsertInput): Promise<void> {
  if (!composer) throw new Error("This agent has no composer to put the prompt in");
  const { prompts } = stored(await read());
  composer.setPrompt(choose(prompts, args.trim()).text);
  await composer.focus();
}
