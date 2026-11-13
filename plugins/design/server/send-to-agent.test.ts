import { describe, expect, it } from "vitest";
import { buildSendPrompt, sendSelection } from "./send-to-agent.js";

describe("Send to agent", () => {
  it("builds one prompt with the note, the file, the layers and the code", () => {
    expect(
      buildSendPrompt({
        fileName: "Login",
        fileId: "f1",
        ids: ["n1", "n2"],
        code: "<div/>",
        note: "build this",
      }),
    ).toBe(
      [
        "build this",
        "",
        'From the design "Login" (design_join {"file":"f1"} opens it), layers n1, n2.',
        "FigCraft's code export for them, as a reference only: write the code in this project's own stack and components.",
        "",
        "```tsx",
        "<div/>",
        "```",
      ].join("\n"),
    );
  });
  it("sends the prompt and a picture of the selection", async () => {
    const calls: unknown[] = [];
    const bridge = {
      userSelection: async () => ["n1"],
      code: async () => "<div/>",
      picture: async (ids?: string[]) => ({ mimeType: "image/png", data: `png:${ids?.join(",")}` }),
    };
    const result = await sendSelection({
      bridge: bridge as never,
      file: { id: "f1", name: "Login" } as never,
      agentId: "a1",
      note: "build this",
      send: async (...args) => {
        calls.push(args);
      },
    });
    expect(result).toEqual({ ok: true });
    expect(calls[0]).toEqual([
      "a1",
      expect.stringContaining("layers n1"),
      [{ mimeType: "image/png", data: "png:n1" }],
    ]);
  });
  it("says so when nothing is selected", async () => {
    const bridge = { userSelection: async () => [] };
    expect(
      await sendSelection({
        bridge: bridge as never,
        file: { id: "f1", name: "L" } as never,
        agentId: "a1",
        note: "",
        send: async () => {},
      }),
    ).toEqual({ ok: false, error: "Select a frame or layers in the design first" });
  });
  it("sends the picture as an image only, and no image when the page renders nothing", async () => {
    const calls: unknown[][] = [];
    const send = async (...args: unknown[]) => {
      calls.push(args);
    };
    const withPicture = {
      userSelection: async () => ["4294967297"],
      code: async () => "<div/>",
      picture: async () => ({ mimeType: "image/png", data: "png", width: 320, height: 200 }),
    };
    const file = { id: "f1", name: 'The "Login"' } as never;
    await sendSelection({ bridge: withPicture as never, file, agentId: "a1", note: "", send });
    expect(calls[0][2]).toEqual([{ mimeType: "image/png", data: "png" }]);
    expect(calls[0][1]).toContain('From the design "The \\"Login\\""');
    const blank = { ...withPicture, picture: async () => null };
    await sendSelection({ bridge: blank as never, file, agentId: "a1", note: "", send });
    expect(calls[1][2]).toEqual([]);
  });
});
