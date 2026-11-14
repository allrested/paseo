// The saved list read and written outside a settings screen: the composer's control and the
// slash command have no settings state to hold, so they ask the host each time.
import { settingsRpc } from "@getpaseo/plugin";
import { savedPromptsSettings, type Prompt } from "../shared/settings.js";
import { applyEdit } from "./edit.js";

export const promptsRpc = settingsRpc(savedPromptsSettings.id);

export type ReadResult =
  | { status: "ready"; revision: string; values: unknown }
  | { status: "invalid"; revision: string; error: string };

type WriteResult = { status: "saved" } | { status: "conflict" | "invalid"; error: string };

export interface Stored {
  revision: string;
  prompts: Prompt[];
}

/** The list a read returned, or the reason there is none, as a sentence for the user. */
export function stored(result: ReadResult): Stored {
  if (result.status !== "ready") {
    throw new Error(`The saved prompts cannot be read: ${result.error}`);
  }
  const { prompts } = savedPromptsSettings.schema.parse(result.values);
  return { revision: result.revision, prompts };
}

interface AppendInput {
  read(): Promise<ReadResult>;
  write(input: { revision: string; values: { prompts: Prompt[] } }): Promise<WriteResult>;
  name: string;
  text: string;
}

/** Adds one prompt to the list as it is now. Rejects with what the list refused. */
export async function appendPrompt({ read, write, name, text }: AppendInput): Promise<void> {
  const { revision, prompts } = stored(await read());
  const applied = applyEdit(prompts, { original: null, name, text });
  if (!applied.ok) throw new Error(applied.error);
  const result = await write({ revision, values: applied.values });
  if (result.status !== "saved") throw new Error(result.error);
}
