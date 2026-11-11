import type { CdpBrowserViewInput } from "@getpaseo/protocol/browser-automation/cdp-view-schemas";
import { beforeEach, describe, expect, it } from "vitest";
import { createSoftKeyboard, type SoftKeyboard, type SoftKeyboardEvent } from "./soft-keyboard";

const press = (key: "Enter" | "Backspace") => [
  { kind: "key", type: "down", key, code: key, modifiers: 0 },
  { kind: "key", type: "up", key, code: key, modifiers: 0 },
];
const backspaces = (count: number) =>
  Array.from({ length: count }, () => press("Backspace")).flat();
const text = (value: string) => ({ kind: "text", text: value });

let keyboard: SoftKeyboard;
beforeEach(() => {
  keyboard = createSoftKeyboard();
});
const softKeyboardStep = (event: SoftKeyboardEvent) => keyboard.step(event);

/** What a page input holds after these inputs: text appends, Backspace removes one code point. */
function pageAfter(inputs: CdpBrowserViewInput[]): string {
  const chars: string[] = [];
  for (const input of inputs) {
    if (input.kind === "text") chars.push(...input.text);
    if (input.kind === "key" && input.type === "down" && input.key === "Backspace") chars.pop();
  }
  return chars.join("");
}

describe("soft keyboard field", () => {
  it("sends typed text once and keeps it out of the field", () => {
    expect(
      softKeyboardStep({
        type: "beforeinput",
        inputType: "insertText",
        data: "a",
        isComposing: false,
      }),
    ).toEqual({ inputs: [{ kind: "text", text: "a" }], cancel: true });
  });

  it("sends nothing for an insertText without data", () => {
    expect(
      softKeyboardStep({
        type: "beforeinput",
        inputType: "insertText",
        data: null,
        isComposing: false,
      }),
    ).toEqual({ inputs: [], cancel: true });
    expect(
      softKeyboardStep({
        type: "beforeinput",
        inputType: "insertText",
        data: "",
        isComposing: false,
      }),
    ).toEqual({ inputs: [], cancel: true });
  });

  it("leaves a composition to the browser and sends the committed text at its end", () => {
    expect(
      softKeyboardStep({
        type: "beforeinput",
        inputType: "insertCompositionText",
        data: "hel",
        isComposing: true,
      }),
    ).toEqual({ inputs: [], cancel: false });
    expect(softKeyboardStep({ type: "compositionend", data: "hello" })).toEqual({
      inputs: [{ kind: "text", text: "hello" }],
      cancel: false,
    });
  });

  it("sends nothing for an empty or cancelled composition", () => {
    expect(softKeyboardStep({ type: "compositionend", data: "" })).toEqual({
      inputs: [],
      cancel: false,
    });
  });

  it("does not send the commit again through Safari's composition input types", () => {
    for (const inputType of ["insertFromComposition", "deleteCompositionText"]) {
      expect(
        softKeyboardStep({ type: "beforeinput", inputType, data: "hello", isComposing: false }),
      ).toEqual({ inputs: [], cancel: false });
    }
  });

  it("sends Backspace as a key press from a keydown and cancels it", () => {
    expect(softKeyboardStep({ type: "keydown", key: "Backspace", isComposing: false })).toEqual({
      inputs: press("Backspace"),
      cancel: true,
    });
  });

  it("sends Backspace as a key press from deleteContentBackward", () => {
    expect(
      softKeyboardStep({
        type: "beforeinput",
        inputType: "deleteContentBackward",
        data: null,
        isComposing: false,
      }),
    ).toEqual({ inputs: press("Backspace"), cancel: true });
  });

  it("leaves Backspace inside a composition to the browser", () => {
    expect(softKeyboardStep({ type: "keydown", key: "Backspace", isComposing: true })).toEqual({
      inputs: [],
      cancel: false,
    });
    expect(
      softKeyboardStep({
        type: "beforeinput",
        inputType: "deleteContentBackward",
        data: null,
        isComposing: true,
      }),
    ).toEqual({ inputs: [], cancel: false });
  });

  it("sends Enter as a key press from a keydown or a line break", () => {
    expect(softKeyboardStep({ type: "keydown", key: "Enter", isComposing: false })).toEqual({
      inputs: press("Enter"),
      cancel: true,
    });
    for (const inputType of ["insertLineBreak", "insertParagraph"]) {
      expect(
        softKeyboardStep({ type: "beforeinput", inputType, data: null, isComposing: false }),
      ).toEqual({ inputs: press("Enter"), cancel: true });
    }
  });

  it("leaves other keydowns to the input events that follow them", () => {
    for (const key of ["a", "Unidentified", "Process", "ArrowLeft", "Shift"]) {
      expect(softKeyboardStep({ type: "keydown", key, isComposing: false })).toEqual({
        inputs: [],
        cancel: false,
      });
    }
  });

  it("sends a paste into the field as inserted text once", () => {
    expect(softKeyboardStep({ type: "paste", text: "pasted text" })).toEqual({
      inputs: [{ kind: "text", text: "pasted text" }],
      cancel: true,
    });
    // The paste event was cancelled; should the browser still raise its input event, it sends nothing.
    expect(
      softKeyboardStep({
        type: "beforeinput",
        inputType: "insertFromPaste",
        data: "pasted text",
        isComposing: false,
      }),
    ).toEqual({ inputs: [], cancel: true });
  });

  it("sends nothing for an empty paste", () => {
    expect(softKeyboardStep({ type: "paste", text: "" })).toEqual({ inputs: [], cancel: true });
  });

  it("drops edits it cannot map to a page input", () => {
    for (const inputType of [
      "insertReplacementText",
      "insertFromDrop",
      "deleteWordBackward",
      "deleteContentForward",
      "historyUndo",
    ]) {
      expect(
        softKeyboardStep({ type: "beforeinput", inputType, data: "word", isComposing: false }),
      ).toEqual({ inputs: [], cancel: true });
    }
  });

  describe("composition", () => {
    const update = (data: string) => softKeyboardStep({ type: "compositionupdate", data });
    const start = () => softKeyboardStep({ type: "compositionstart" });
    const end = (data: string) => softKeyboardStep({ type: "compositionend", data });

    it("sends a word typed letter by letter as it is typed, and nothing more at its end", () => {
      expect(start()).toEqual({ inputs: [], cancel: false });
      expect(update("h")).toEqual({ inputs: [text("h")], cancel: false });
      expect(update("he")).toEqual({ inputs: [text("e")], cancel: false });
      expect(update("hel")).toEqual({ inputs: [text("l")], cancel: false });
      expect(end("hel")).toEqual({ inputs: [], cancel: false });
    });

    it("deletes back to the common prefix for a correction in the middle of a word", () => {
      start();
      update("helo");
      expect(update("hello")).toEqual({ inputs: [...backspaces(1), text("lo")], cancel: false });
      expect(update("hallo")).toEqual({ inputs: [...backspaces(4), text("allo")], cancel: false });
    });

    it("corrects the sent word when the commit differs from the composition", () => {
      start();
      update("teh");
      expect(end("the")).toEqual({ inputs: [...backspaces(2), text("he")], cancel: false });
    });

    it("replaces the whole string when the keyboard swaps it", () => {
      start();
      update("かんじ");
      expect(update("漢字")).toEqual({ inputs: [...backspaces(3), text("漢字")], cancel: false });
      expect(end("漢字")).toEqual({ inputs: [], cancel: false });
    });

    it("removes what a cancelled composition inserted", () => {
      start();
      update("abc");
      expect(end("")).toEqual({ inputs: backspaces(3), cancel: false });
    });

    it("counts astral characters as one code point", () => {
      start();
      expect(update("😀")).toEqual({ inputs: [text("😀")], cancel: false });
      expect(update("😀a")).toEqual({ inputs: [text("a")], cancel: false });
      expect(update("😀")).toEqual({ inputs: backspaces(1), cancel: false });
      // Same high surrogate, different character: one Backspace, not half a character kept.
      expect(update("😁")).toEqual({ inputs: [...backspaces(1), text("😁")], cancel: false });
      expect(end("")).toEqual({ inputs: backspaces(1), cancel: false });
    });

    it("starts a new composition from nothing after a commit", () => {
      start();
      update("hi");
      end("hi");
      start();
      expect(update("yo")).toEqual({ inputs: [text("yo")], cancel: false });
    });

    it("sends the typed text exactly once across compositions, corrections and spaces", () => {
      const inputs: CdpBrowserViewInput[] = [];
      const run = (event: SoftKeyboardEvent) => inputs.push(...softKeyboardStep(event).inputs);
      run({ type: "compositionstart" });
      for (const data of ["h", "he", "hel", "helo", "hell", "hello"]) {
        run({ type: "compositionupdate", data });
      }
      run({ type: "compositionend", data: "hello" });
      run({ type: "beforeinput", inputType: "insertText", data: " ", isComposing: false });
      run({ type: "compositionstart" });
      for (const data of ["w", "wo", "wro"]) run({ type: "compositionupdate", data });
      run({ type: "compositionend", data: "world" });
      expect(pageAfter(inputs)).toBe("hello world");
    });
  });
});
