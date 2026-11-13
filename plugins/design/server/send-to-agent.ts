import type { Bridge } from "./bridge.js";
import type { DesignFile } from "./files-store.js";

export function buildSendPrompt(input: {
  fileName: string;
  fileId: string;
  ids: string[];
  code: string;
  note: string;
}): string {
  return [
    input.note.trim() || "Build this design.",
    "",
    `From the design ${JSON.stringify(input.fileName)} (design_join {"file":"${input.fileId}"} opens it), layers ${input.ids.join(", ")}.`,
    "FigCraft's code export for them, as a reference only: write the code in this project's own stack and components.",
    "",
    "```tsx",
    input.code,
    "```",
  ].join("\n");
}

export async function sendSelection(input: {
  bridge: Pick<Bridge, "userSelection" | "code" | "picture">;
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
    const text = buildSendPrompt({
      fileName: input.file.name,
      fileId: input.file.id,
      ids,
      code,
      note: input.note,
    });
    const images = picture ? [{ mimeType: picture.mimeType, data: picture.data }] : [];
    await input.send(input.agentId, text, images);
    return { ok: true };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
