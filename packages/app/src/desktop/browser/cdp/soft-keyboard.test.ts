import { describe, expect, it } from "vitest";
import { softKeyboardStep } from "./soft-keyboard";

const press = (key: "Enter" | "Backspace") => [
  { kind: "key", type: "down", key, code: key, modifiers: 0 },
  { kind: "key", type: "up", key, code: key, modifiers: 0 },
];

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
});
