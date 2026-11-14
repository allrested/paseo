import type { Bridge, SelectionFacts } from "./bridge.js";
import type { DesignFile } from "./files-store.js";

export function buildSendPrompt(input: {
  fileName: string;
  fileId: string;
  ids: string[];
  code: string;
  note: string;
  facts: SelectionFacts;
}): string {
  const sizes = input.facts.layers.map(
    (layer) => `${JSON.stringify(layer.name)} ${layer.width} x ${layer.height} (${layer.id})`,
  );
  return [
    input.note.trim() || "Build this design.",
    "",
    `From the design ${JSON.stringify(input.fileName)} (design_join {"file":"${input.fileId}"} opens it), layers ${input.ids.join(", ")}.`,
    ...(sizes.length > 0 ? [`Sizes: ${sizes.join(", ")}.`] : []),
    input.facts.tokens.length > 0
      ? `Tokens they use: ${input.facts.tokens.join(", ")}. Use this project's tokens of the same names.`
      : "No tokens are bound in these layers.",
    "FigCraft's code export for them, as a reference only: write the code in this project's own stack and components.",
    "",
    "```tsx",
    input.code,
    "```",
  ].join("\n");
}

export async function sendSelection(input: {
  bridge: Pick<Bridge, "userSelection" | "code" | "picture" | "facts">;
  file: Pick<DesignFile, "id" | "name">;
  agentId: string;
  note: string;
  send(agentId: string, text: string, images: { mimeType: string; data: string }[]): Promise<void>;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const ids = await input.bridge.userSelection();
    if (ids.length === 0)
      return { ok: false, error: "Select a frame or layers in the design first" };
    const code = await input.bridge.code(ids);
    const picture = await input.bridge.picture(ids);
    const facts = await input.bridge.facts(ids);
    const text = buildSendPrompt({
      fileName: input.file.name,
      fileId: input.file.id,
      ids,
      code,
      note: input.note,
      facts,
    });
    const images = picture ? [{ mimeType: picture.mimeType, data: picture.data }] : [];
    await input.send(input.agentId, text, images);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
